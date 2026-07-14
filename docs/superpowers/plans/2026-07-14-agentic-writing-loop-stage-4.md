# Agentic Writing Loop Stage 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add project-scoped multi-conversation persistence, navigation, archive/restore, search, and bounded cross-run context without changing Stage 1-3 write, version, recovery, or undo semantics.

**Architecture:** Add an application-level Conversation aggregate backed by a dedicated project-root repository. New Agent runs carry one `conversationId`; Conversation metadata never duplicates Change Set, Version Group, or journal state. A project-scoped desktop runtime manager keeps Conversation and Agent Run sessions bound to the active canonical project root.

**Tech Stack:** TypeScript strict mode, Electron main/preload/renderer, React 19, Lucide, Vitest, Playwright Electron E2E, existing Agent Run/Repository/Result contracts.

**Execution constraint:** Do not create commits, push, rewrite history, or open a browser manually. Electron UI verification runs only through Playwright.

---

## File Ownership Map

**Task 1 owner: Conversation repository**

- Create `packages/repository/src/agent-conversation-repository.ts`
- Create `packages/repository/test/agent-conversation-repository.test.ts`
- Modify `packages/repository/src/index.ts`

**Task 2 owner: Conversation application service**

- Create `packages/application/src/agent-conversation-session.ts`
- Create `packages/application/test/agent-conversation-session.test.ts`
- Modify `packages/application/src/index.ts`, `browser-index.ts`

**Task 3 owner: Agent Run association**

- Modify `packages/agent-engine/src/agent-run-types.ts`, `agent-run-coordinator.ts`
- Modify `packages/application/src/agent-run-session.ts`
- Modify focused Agent Run tests and fixture builders

**Task 4 owner: Desktop runtime and IPC**

- Create `apps/desktop/src/main/agent-runtime-manager.ts`
- Modify `apps/desktop/src/main/agent-run-runtime.ts`, `index.ts`, `ipc-handlers.ts`, `ipc-allowlist.ts`
- Modify `packages/application/src/novel-studio-api.ts`, `ipc-contract.ts`
- Modify `apps/desktop/src/preload/api.ts`, `index.cts`
- Modify IPC/runtime/security tests

**Task 5 owner: Renderer and UI**

- Create `apps/desktop/src/renderer/agent-conversation-bridge.ts`
- Create `packages/ui/src/agent-conversation-navigator.tsx`, `agent-conversation-view.tsx`
- Create matching unit tests
- Modify `App.tsx`, `workspace-shell.tsx`, `workspace-shell-ai.tsx`, `workspace-shell-types.ts`, `styles.css`, package UI exports

**Task 6 owner: Summary and search**

- Modify Conversation Repository/Application/Agent Run integration files
- Add focused summary/search tests

**Task 7 owner: Acceptance and release gate**

- Create `apps/desktop/test/agent-conversations.e2e.ts`
- Modify `scripts/package-check.mjs`, `apps/desktop/test/m98-v1-ship-readiness.test.ts`

## Stage 4A

### Task 1: Persist Conversation metadata and immutable summary revisions

**Files:**

- Create: `packages/repository/src/agent-conversation-repository.ts`
- Create: `packages/repository/test/agent-conversation-repository.test.ts`
- Modify: `packages/repository/src/index.ts`

- [ ] **Step 1: Write failing Repository tests**

Cover create/read/list, stable newest-first ordering, command receipt idempotency, expected revision conflict, archive/restore, invalid safe IDs, one corrupted record not blocking the list, and immutable summary revisions.

```ts
const created = await repository.createConversation({
  schemaVersion: "1.0",
  conversationId: "conv_01",
  projectId: "project_01",
  revision: 1,
  title: "新会话",
  status: "active",
  createdAt: "2026-07-14T00:00:00.000Z",
  updatedAt: "2026-07-14T00:00:00.000Z"
});
expect(created.ok).toBe(true);
expect(await repository.listConversations({ projectId: "project_01" })).toMatchObject({
  ok: true,
  value: [{ conversationId: "conv_01" }]
});
```

- [ ] **Step 2: Run tests and confirm red state**

Run: `npm test -- packages/repository/test/agent-conversation-repository.test.ts`

Expected: FAIL because `AgentConversationFileRepository` does not exist.

- [ ] **Step 3: Implement the project-root Repository**

Implement safe ID validation, fixed `history/conversations` paths, atomic JSON writes, immutable summary revision checks, receipts, stable pagination, and partial diagnostics.

```ts
export class AgentConversationFileRepository {
  createConversation(record: JsonObject): Promise<Result<JsonObject, UnifiedError>>;
  readConversation(id: string): Promise<Result<JsonObject | undefined, UnifiedError>>;
  listConversations(input: JsonObject): Promise<Result<JsonObject[], UnifiedError>>;
  updateConversation(input: JsonObject): Promise<Result<JsonObject, UnifiedError>>;
  writeCommandReceipt(id: string, commandId: string, receipt: JsonObject): Promise<Result<JsonObject, UnifiedError>>;
  readCommandReceipt(id: string, commandId: string): Promise<Result<JsonObject | undefined, UnifiedError>>;
  writeSummary(summary: JsonObject): Promise<Result<JsonObject, UnifiedError>>;
  readLatestSummary(id: string): Promise<Result<JsonObject | undefined, UnifiedError>>;
}
```

- [ ] **Step 4: Verify Task 1**

Run: `npm test -- packages/repository/test/agent-conversation-repository.test.ts && npm run typecheck`

Expected: PASS.

### Task 2: Add Conversation contracts and Application session

**Files:**

- Create: `packages/application/src/agent-conversation-session.ts`
- Create: `packages/application/test/agent-conversation-session.test.ts`
- Modify: `packages/application/src/index.ts`
- Modify: `packages/application/src/browser-index.ts`

- [ ] **Step 1: Write failing service tests**

Cover create idempotency, list/read, deterministic first-request title, archive/restore revision conflicts, archive refusal for active/pending runs, current-project isolation, empty conversation recovery, and legacy virtual conversation synthesis.

```ts
const created = await session.createConversation({
  projectId: "project_01",
  commandId: "cmd_create_01"
});
expect(created).toMatchObject({ ok: true, value: { title: "新会话", revision: 1 } });

const archived = await session.archiveConversation({
  projectId: "project_01",
  conversationId: created.value.conversationId,
  commandId: "cmd_archive_01",
  expectedConversationRevision: 1
});
expect(archived).toMatchObject({ ok: true, value: { status: "archived", revision: 2 } });
```

- [ ] **Step 2: Run tests and confirm red state**

Run: `npm test -- packages/application/test/agent-conversation-session.test.ts`

Expected: FAIL because the session module does not exist.

- [ ] **Step 3: Implement strong DTOs and session**

```ts
export interface AgentConversationSession {
  createConversation(command: CreateAgentConversationCommand): Promise<AgentConversationResult>;
  listConversations(query: ListAgentConversationsQuery): Promise<AgentConversationListResult>;
  readConversation(query: ReadAgentConversationQuery): Promise<AgentConversationReadResult>;
  archiveConversation(command: ChangeAgentConversationStatusCommand): Promise<AgentConversationResult>;
  restoreConversation(command: ChangeAgentConversationStatusCommand): Promise<AgentConversationResult>;
  searchConversations(query: SearchAgentConversationsQuery): Promise<AgentConversationSearchResult>;
  assertRunMayStart(input: { projectId: string; conversationId: string }): Promise<Result<AgentConversationSummary, UnifiedError>>;
  noteRunStarted(snapshot: AgentRunSnapshot): Promise<Result<AgentConversationSummary, UnifiedError>>;
}
```

Use `commandId` receipts and `expectedConversationRevision`. Generate IDs and timestamps through injectable functions. Do not call an LLM.

- [ ] **Step 4: Verify Task 2**

Run: `npm test -- packages/application/test/agent-conversation-session.test.ts packages/repository/test/agent-conversation-repository.test.ts && npm run typecheck`

Expected: PASS.

### Task 3: Bind every new Run to one Conversation

**Files:**

- Modify: `packages/agent-engine/src/agent-run-types.ts`
- Modify: `packages/agent-engine/src/agent-run-coordinator.ts`
- Modify: `packages/application/src/agent-run-session.ts`
- Modify: `packages/agent-engine/test/agent-run-coordinator.test.ts`
- Modify: `packages/application/test/agent-run-session.test.ts`
- Modify: `packages/application/test/agent-run-stage2-integration.test.ts`

- [ ] **Step 1: Add failing association tests**

Assert new starts require `conversationId`, persisted snapshots contain it, planning-to-execution inherits it, restore maps old records to `null`, conversation validation happens before run persistence, duplicate starts do not create two runs, and a post-start metadata failure preserves the run.

```ts
expect(session.startAgentRun({
  ...startCommand,
  conversationId: "conv_01"
})).resolves.toMatchObject({
  ok: true,
  value: { conversationId: "conv_01" }
});
```

- [ ] **Step 2: Run focused tests and confirm red state**

Run: `npm test -- packages/agent-engine/test/agent-run-coordinator.test.ts packages/application/test/agent-run-session.test.ts`

Expected: FAIL on the missing field and lifecycle port.

- [ ] **Step 3: Implement association and transcript boundaries**

Add `conversationId` to start/snapshot contracts, legacy normalization, and a narrow lifecycle port.

```ts
export interface AgentConversationLifecyclePort {
  assertRunMayStart(input: { projectId: string; conversationId: string }): Promise<Result<JsonObject, UnifiedError>>;
  loadContext(input: { projectId: string; conversationId: string }): Promise<Result<readonly AgentModelMessage[], UnifiedError>>;
  noteRunStarted(snapshot: AgentRunSnapshot): Promise<Result<void, UnifiedError>>;
  noteRunTerminal(snapshot: AgentRunSnapshot): Promise<Result<void, UnifiedError>>;
}
```

Emit one `assistant_text_completed` event per model round. Context messages precede the current user request and are explicitly labeled as untrusted conversation data. Keep write policy validation unchanged.

- [ ] **Step 4: Update fixture builders mechanically**

Centralize default `conversationId: "conv_test"` in test helpers rather than duplicating literal edits. Tests that restore Stage 1-3 fixtures explicitly omit the field and assert `null`.

- [ ] **Step 5: Verify Task 3**

Run: `npm test -- packages/agent-engine/test packages/application/test/agent-run-session.test.ts packages/application/test/agent-run-stage2-integration.test.ts`

Expected: PASS with Stage 2-3 approval and undo assertions unchanged.

### Task 4: Add project-scoped runtime manager and clone-safe IPC

**Files:**

- Create: `apps/desktop/src/main/agent-runtime-manager.ts`
- Create: `apps/desktop/test/agent-runtime-manager.test.ts`
- Modify: `apps/desktop/src/main/agent-run-runtime.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/main/ipc-handlers.ts`
- Modify: `apps/desktop/src/main/ipc-allowlist.ts`
- Modify: `packages/application/src/novel-studio-api.ts`
- Modify: `packages/application/src/ipc-contract.ts`
- Modify: `apps/desktop/src/preload/api.ts`
- Modify: `apps/desktop/src/preload/index.cts`
- Modify: `apps/desktop/test/agent-run-ipc.test.ts`
- Modify: `apps/desktop/test/electron-security.test.ts`
- Modify: `apps/desktop/test/desktop-agent-run-runtime.test.ts`

- [ ] **Step 1: Add failing runtime/IPC tests**

Cover initial binding, successful project-open rebind, refusal while an old project has an active run, all conversation commands, strict parser rejection, structured cloning, preload parity, and event forwarding after rebind.

```ts
await manager.bindProject({ projectId: "project_a", projectRoot: rootA, activeChapterId });
await manager.bindProject({ projectId: "project_b", projectRoot: rootB, activeChapterId });
expect(manager.currentProject()).toEqual({ projectId: "project_b", projectRoot: rootB });
```

- [ ] **Step 2: Run tests and confirm red state**

Run: `npm test -- apps/desktop/test/agent-runtime-manager.test.ts apps/desktop/test/agent-run-ipc.test.ts`

Expected: FAIL because runtime manager and channels do not exist.

- [ ] **Step 3: Implement runtime manager**

The manager owns `{ agentRunSession, agentConversationSession }`, binds them from main-owned canonical workspace state, forwards events, and disposes old subscriptions. It exposes no project-root setter to renderer.

```ts
export interface DesktopAgentRuntimeManager {
  bindProject(snapshot: ProjectWorkspaceSnapshot): Promise<Result<void, UnifiedError>>;
  current(): DesktopAgentRuntime | undefined;
  hasActiveRun(): Promise<boolean>;
  dispose(): void;
}
```

- [ ] **Step 4: Add typed API and IPC channels**

Add `agentConversations.create/list/read/archive/restore/search` to `NovelStudioApi`. Add strict DTO parsers in main, mirror both preload files, and add allowlist channels. Make successful `project:open`/`project:create` call `bindProject` before returning the workspace snapshot.

- [ ] **Step 5: Verify Stage 4A backend**

Run: `npm test -- packages/repository/test/agent-conversation-repository.test.ts packages/application/test/agent-conversation-session.test.ts apps/desktop/test/agent-runtime-manager.test.ts apps/desktop/test/agent-run-ipc.test.ts apps/desktop/test/electron-security.test.ts apps/desktop/test/desktop-agent-run-runtime.test.ts && npm run typecheck && npm run build`

Expected: PASS.

### Task 5: Build Conversation bridge and work-focused UI

**Files:**

- Create: `apps/desktop/src/renderer/agent-conversation-bridge.ts`
- Create: `apps/desktop/test/agent-conversation-bridge.test.ts`
- Create: `packages/ui/src/agent-conversation-navigator.tsx`
- Create: `packages/ui/src/agent-conversation-view.tsx`
- Create: `packages/ui/test/agent-conversation-navigator.test.tsx`
- Create: `packages/ui/test/agent-conversation-view.test.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `packages/ui/src/workspace-shell.tsx`
- Modify: `packages/ui/src/workspace-shell-ai.tsx`
- Modify: `packages/ui/src/workspace-shell-types.ts`
- Modify: `packages/ui/src/styles.css`
- Modify: `packages/ui/src/index.ts`

- [ ] **Step 1: Add failing bridge/UI tests**

Cover empty state, new/select, active/archive filters, archive/restore, legacy virtual item, explicit run hydration, project switch reset, active-run banner, disabled composer outside the active conversation, write-policy acknowledgement reset, keyboard navigation, and `aria-current`.

```tsx
render(<AgentConversationNavigator {...props} />);
fireEvent.click(screen.getByRole("button", { name: "新建会话" }));
expect(props.onCreate).toHaveBeenCalledTimes(1);
expect(screen.getByRole("option", { name: /当前会话/ })).toHaveAttribute("aria-current", "true");
```

- [ ] **Step 2: Run tests and confirm red state**

Run: `npm test -- packages/ui/test/agent-conversation-navigator.test.tsx packages/ui/test/agent-conversation-view.test.tsx apps/desktop/test/agent-conversation-bridge.test.ts`

Expected: FAIL because the components and bridge do not exist.

- [ ] **Step 3: Implement the bridge**

Keep selected conversation in renderer state only. Resolve incoming run events through run-to-conversation mapping; update inactive conversation status without overwriting the selected conversation. Delegate run actions to the existing `AgentRunBridge`.

```ts
export interface AgentConversationWorkspaceProps {
  readonly projectId: string;
  readonly conversations: readonly AgentConversationSummary[];
  readonly selectedConversationId?: string;
  readonly activeConversationId?: string;
  readonly selectedConversation?: AgentConversationReadResult;
  readonly searchQuery: string;
  readonly includeArchived: boolean;
  readonly loading: boolean;
  readonly errorMessage?: string;
}

export interface AgentConversationBridge {
  load(projectId: string): Promise<AgentConversationWorkspaceProps>;
  create(): Promise<AgentConversationWorkspaceProps>;
  select(conversationId: string): Promise<AgentConversationWorkspaceProps>;
  archive(conversationId: string): Promise<AgentConversationWorkspaceProps>;
  restore(conversationId: string): Promise<AgentConversationWorkspaceProps>;
  search(query: string, includeArchived?: boolean): Promise<AgentConversationWorkspaceProps>;
}
```

- [ ] **Step 4: Implement UI components and workspace routing**

Use a compact list, Search/Plus/Archive/ArchiveRestore/MoreHorizontal Lucide icons, tooltips, no nested cards, and a stable main conversation area. In AI activity, render the conversation navigator once and avoid duplicating the full assistant panel in the inspector.

- [ ] **Step 5: Verify Task 5**

Run: `npm test -- packages/ui/test/agent-conversation-navigator.test.tsx packages/ui/test/agent-conversation-view.test.tsx packages/ui/test/agent-run-panel.test.tsx apps/desktop/test/agent-conversation-bridge.test.ts apps/desktop/test/agent-run-bridge.test.ts && npm run typecheck && npm run build`

Expected: PASS and existing Agent Run UI tests remain unchanged.

## Stage 4B

### Task 6: Add bounded summaries, search, and context injection

**Files:**

- Modify: `packages/application/src/agent-conversation-session.ts`
- Modify: `packages/application/src/agent-run-session.ts`
- Modify: `packages/repository/src/agent-conversation-repository.ts`
- Modify: `packages/application/test/agent-conversation-session.test.ts`
- Modify: `packages/application/test/agent-run-session.test.ts`
- Modify: `packages/repository/test/agent-conversation-repository.test.ts`
- Modify: `apps/desktop/src/renderer/agent-conversation-bridge.ts`
- Modify: `packages/ui/src/agent-conversation-navigator.tsx`

- [ ] **Step 1: Add failing summary/search tests**

Cover one completed transcript boundary per model round, delta fallback for legacy runs, immutable revisions bound to run revision/sequence, 8 KiB cap, six recent run turns, stale after undo audit, current-conversation-only injection, summary failure fallback, Chinese search, archived filtering, stable pagination, and cache rebuild.

```ts
expect(context.value.messages).toEqual(expect.arrayContaining([
  expect.objectContaining({
    role: "system",
    content: expect.stringContaining("Untrusted conversation context")
  })
]));
expect(context.value.messages.join("\n")).not.toContain("other conversation secret");
```

- [ ] **Step 2: Run tests and confirm red state**

Run: `npm test -- packages/application/test/agent-conversation-session.test.ts packages/application/test/agent-run-session.test.ts packages/repository/test/agent-conversation-repository.test.ts`

Expected: FAIL on summary generation/search behavior.

- [ ] **Step 3: Implement deterministic summary builder**

Build from persisted user requests, completed assistant text, tool summaries, Plan/Change Set targets, write/undo outcomes, and terminal status. Never include raw provider frames, hidden reasoning, credentials, or candidate file bodies.

```ts
const MAX_SUMMARY_BYTES = 8 * 1024;
const RECENT_RUN_LIMIT = 6;

export function buildAgentConversationContext(input: ConversationContextInput): ConversationContext {
  return compactConversationFacts(input, { maxBytes: MAX_SUMMARY_BYTES, recentRuns: RECENT_RUN_LIMIT });
}
```

- [ ] **Step 4: Implement search index and UI search state**

Index title, latest summary, and run user requests only. Treat the cache as disposable; rebuild after parse failure. Return snippets and partial diagnostics without blocking valid records.

- [ ] **Step 5: Verify Task 6**

Run: `npm test -- packages/repository/test/agent-conversation-repository.test.ts packages/application/test/agent-conversation-session.test.ts packages/application/test/agent-run-session.test.ts apps/desktop/test/agent-conversation-bridge.test.ts packages/ui/test/agent-conversation-navigator.test.tsx`

Expected: PASS.

### Task 7: Add Electron acceptance and release gate

**Files:**

- Create: `apps/desktop/test/agent-conversations.e2e.ts`
- Modify: `scripts/package-check.mjs`
- Modify: `apps/desktop/test/m98-v1-ship-readiness.test.ts`

- [ ] **Step 1: Add failing package/E2E assertions**

Add a local SSE provider and cover conversation A multi-run context, empty B context, switch/reload, archive/search/restore, pending review ownership, run undo after archive, auto-write reset, single active run, and project-root rebind.

- [ ] **Step 2: Run the new E2E and confirm red state**

Run: `npm run build && npx playwright test apps/desktop/test/agent-conversations.e2e.ts --workers=1`

Expected: FAIL until the full desktop wiring is complete.

- [ ] **Step 3: Complete integration gaps and package gate**

Make `package:check` require the Conversation repository/application/bridge/UI suites, new E2E file presence, project isolation, and all Stage 2-3 transaction/autonomy gates.

- [ ] **Step 4: Run Stage 4 acceptance**

Run: `npm run lint && npm run typecheck && npm run build`

Run: `npm test`

Run: `npx playwright test apps/desktop/test/agent-run.e2e.ts apps/desktop/test/agent-write.e2e.ts apps/desktop/test/agent-run-autonomy.e2e.ts apps/desktop/test/agent-conversations.e2e.ts --workers=1`

Run: `npm run package:check`

Run: `git diff --check`

Expected: every command exits 0; full Vitest and all four Electron Agent suites report zero failures.

## Final Self-Review

- [ ] Every Stage 4 design section maps to a task: project binding (Task 4), Conversation persistence (Tasks 1-2), run association (Task 3), UI/restore (Task 5), summary/search (Task 6), release gates (Task 7).
- [ ] Stage 2-3 contracts remain run-scoped and appear in focused/full/E2E regression gates.
- [ ] No task adds delete, cross-project sync, background queue, application-closed execution, conversation-level write authorization, or conversation-level undo.
- [ ] No commit step exists because the user explicitly prohibited commits without separate authorization.
