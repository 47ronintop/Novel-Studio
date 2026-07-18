# Agentic Writing Loop Stage 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the Stage 5 v1.3 context runtime, compact Codex/Claude Code-style Agent conversation, permission and plan-execution controls, recoverable diagnostics, and settings-level usage analytics without changing the existing Change Set, Version Group, recovery, or undo safety boundaries.

**Architecture:** Keep `AgentRunSession` and the main process as the source of truth. First remove the duplicate renderer surfaces and establish one right-side `AgentComposer`; then extend the run/context contracts to v1.1, build context draft/budget/compaction services, add permission and plan-execution facts, and finally persist redacted diagnostics and usage. Renderer components consume validated snapshots and events only; model capability, context, permission, cost, and recovery facts are never authored by the renderer or model.

**Tech Stack:** TypeScript strict mode, React 19, Electron main/preload/renderer, existing Agent Engine/Application/Repository layering, LLM Adapter, Vitest, jsdom, Playwright Electron E2E, CodeMirror 6, CSS, and existing `Result`/`UnifiedError` contracts.

---

## Scope and Gates

- Implement the approved design in `docs/superpowers/specs/2026-07-14-agentic-writing-loop-stage-5-context-runtime-design.md` version 1.3.
- Deliver in four independently testable gates: Stage 5.0 conversation UI baseline, Stage 5A Context Runtime, Stage 5B Permission and Plan Execution Control, and Stage 5C Diagnostics and Usage.
- Do not add Shell, Git, MCP, browser tools, network research, plugins, deletion/move/rename, directory creation, binary editing, multi-Agent execution, or unattended background work.
- **Deferred to P1 (not Stage 5), recorded here so context engineering does not silently pull them in):**
  - A cross-chapter/project full-text **search tool** (`search_project_text`). Writing-mode continuity checking ("where was this character detail first written") is meaningfully weaker without it, because Stage 5 tools only read by chapter ID / path. It needs its own permission, audit, and result-truncation contract, so it stays P1 per design v1.4 §12.8. Task 1.7 raises writing/general-file context quality within the *existing* read tools; it does not add search.
  - A **user-writable writing-conventions file** (a persistent, editable "novel project CLAUDE.md": persona/tense/naming/tone rules). Task 1.7 injects the built-in `DEFAULT_AI_WRITING_STYLE_RULE_PACK` as persistent guidance; letting the user author/override that pack per project is the P1 follow-up.
- Do not manually open a browser. All Electron UI verification uses Playwright automation.
- Preserve Stage 2-4 Change Set, Approval Gate, Version Group, transaction journal, recovery, conflict, and run-undo semantics.
- Use TDD for every task. Each task must leave its focused tests green before its commit.
- Do not delete the legacy AI workflow service in Stage 5. Remove it from the Agent Conversation rendering path and retain only the compatibility APIs still covered by non-Agent tests.

## File Ownership Map

**Stage 5.0 conversation UI baseline**

- Create `packages/ui/src/agent-composer.tsx` for the one request textbox, mode/permission controls, model/reasoning controls, and send/stop command.
- Create `packages/ui/src/agent-activity-summary.tsx` for current-step and collapsed completed-step presentation.
- Modify `packages/ui/src/agent-run-panel.tsx` so it owns run projection and blocking actions only.
- Modify `packages/ui/src/agent-conversation-view.tsx`, `packages/ui/src/workspace-shell.tsx`, `packages/ui/src/workspace-shell-types.ts`, `packages/ui/src/index.ts`, and `packages/ui/src/styles.css` for the central editor plus right-side conversation layout.
- Modify `apps/desktop/src/renderer/App.tsx`, `agent-conversation-bridge.ts`, `agent-conversation-workspace.ts`, and `renderer-workspace-shell.tsx` to stop injecting the active run into the legacy workflow and stop projecting one terminal run twice.

**Stage 5A Context Runtime**

- Modify `packages/agent-engine/src/context-snapshot.ts` and `agent-run-types.ts` for v1.1 contracts and v1.0 normalization.
- Create `packages/agent-engine/src/agent-run-draft.ts`, `context-draft.ts`, `context-budget.ts`, `context-compaction.ts`, and the minimal `agent-usage-record.ts` contract required by compaction.
- Create `packages/application/src/agent-run-draft-session.ts` and `agent-context-session.ts`.
- Extend `packages/application/src/agent-run-model-driver.ts`, `agent-run-session.ts`, `agent-model-capabilities.ts`, `novel-studio-api.ts`, `ipc-contract.ts`, and exports.
- Extend `packages/repository/src/agent-run-repository.ts` for context drafts, budget snapshots, and compaction revisions.
- Modify Electron main/preload/renderer bridges for draft updates, model/reasoning selection, context status, and compaction commands.
- Create `packages/ui/src/agent-popover.tsx` (shared trigger + dialog + keyboard/focus primitive) and `packages/ui/src/agent-context-menu.tsx`; extend the single composer with grouped sub-object props (`model`/`reasoning`/`references`/`contextStatus`) for reference chips and warning-only context status; refactor the Stage 5.0 mode popover onto the shared primitive.
- Differentiate the two context modes (Task 1.7) via mode-specific system guidance and writing style-pack injection in `packages/application/src/agent-run-session.ts`, `agent-run-model-driver.ts`, and `ai-writing-style-rules.ts`; keep initial context minimal and tool-pulled.

**Stage 5B Permission and Plan Execution Control**

- Create `packages/agent-engine/src/permission-summary.ts` and `plan-execution.ts`.
- Create `packages/application/src/agent-permission-session.ts` and `agent-plan-execution-session.ts`.
- Extend run snapshots/events, persistence, IPC, bridge state, composer permission menu, plan review, and timeline projection.

**Stage 5C Diagnostics and Usage**

- Create `packages/agent-engine/src/agent-run-error.ts`.
- Create `packages/application/src/agent-diagnostics-session.ts`, `agent-usage-session.ts`, and `agent-usage-types.ts`.
- Create `packages/repository/src/agent-usage-repository.ts` for redacted user-data usage records and daily aggregates.
- Create `packages/ui/src/agent-error-card.tsx` and `agent-usage-settings.tsx`.
- Extend LLM stream usage forwarding, Agent Runtime composition, settings navigation, preload/API contracts, and package/release gates.

## Stage 5.0: Single Conversation Surface

### Task 0.1: Extract the one Agent Composer

**Files:**
- Create: `packages/ui/src/agent-composer.tsx`
- Modify: `packages/ui/src/agent-conversation-view.tsx`
- Modify: `packages/ui/src/agent-run-panel.tsx`
- Modify: `packages/ui/src/workspace-shell-types.ts`
- Modify: `packages/ui/src/index.ts`
- Modify: `apps/desktop/src/renderer/agent-run-bridge.ts`
- Modify: `apps/desktop/src/renderer/agent-conversation-bridge.ts`
- Modify: `apps/desktop/src/renderer/agent-conversation-workspace.ts`
- Test: `packages/ui/test/agent-conversation-view.test.tsx`
- Test: `packages/ui/test/agent-run-panel.test.tsx`
- Create: `packages/ui/test/agent-composer.test.tsx`
- Test: `apps/desktop/test/agent-run-bridge.test.ts`
- Test: `apps/desktop/test/agent-conversation-bridge.test.ts`

- [ ] **Step 1: Write failing ownership tests**

Add assertions that `AgentRunPanel` contains no textarea, send button, stop button, mode segmented control, or write-policy fieldset and that `AgentConversationView` contains exactly one composer:

```tsx
expect(container.querySelectorAll('textarea[aria-label="Agent 请求"]')).toHaveLength(1);
expect(container.querySelectorAll('[aria-label="会话输入区"]')).toHaveLength(1);
expect(container.querySelectorAll('button[aria-label="启动 Agent 运行"]')).toHaveLength(1);

const runPanel = container.querySelector(".ns-agent-run");
expect(runPanel?.querySelector("textarea")).toBeNull();
expect(runPanel?.querySelector(".ns-agent-composer")).toBeNull();
expect(runPanel?.querySelector('[aria-label="运行模式"]')).toBeNull();
expect(runPanel?.querySelector('[aria-label="上下文模式"]')).toBeNull();
```

Test Enter to send, Shift+Enter to insert a newline, whitespace-only requests, archived/virtual conversations, active-run disablement, and stop replacing send while a run is active. Assert exactly one `执行 · 写作` trigger, no permanent mode control group outside its closed popover, and exactly one stop control across planning, execution, pending question, stale context, plan-ready, and recovery states. Open the trigger and assert the two labelled groups, planning's read-only label, keyboard selection, focus return, acknowledgement reset, and Escape behavior.

- [ ] **Step 2: Run the tests and verify the current duplicate contract fails**

Run:

```powershell
npx vitest run packages/ui/test/agent-composer.test.tsx packages/ui/test/agent-conversation-view.test.tsx packages/ui/test/agent-run-panel.test.tsx
```

Expected: FAIL because `AgentRunPanel` still renders its own composer and its tests still expect the nested composer.

- [ ] **Step 3: Introduce the focused composer contract**

Add this public UI contract to `workspace-shell-types.ts` and implement it in `agent-composer.tsx`:

```ts
export interface AgentComposerProps {
  readonly request: string;
  readonly operationMode: AgentOperationMode;
  readonly contextMode: AgentContextMode;
  readonly writePolicy: AgentWritePolicy;
  readonly writePolicyAcknowledged: boolean;
  readonly active: boolean;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  readonly onRequestChange: (request: string) => void;
  readonly onOperationModeChange: (mode: AgentOperationMode) => void;
  readonly onContextModeChange: (mode: AgentContextMode) => void;
  readonly onWritePolicyChange: (policy: AgentWritePolicy) => void;
  readonly onWritePolicyAcknowledgedChange: (acknowledged: boolean) => void;
  readonly onSend: (request: string) => void;
  readonly onStop: () => void;
}
```

`AgentComposer` owns only draft UI state and delegates all semantic changes through callbacks. Render exactly one `执行 · 写作` trigger inside the lower-left composer toolbar. Opening it renders one popover with two separately labelled groups: `运行方式` contains `执行` and `规划（只读）`; `上下文` contains `写作` and `通用文件`. Do not render permanent mode segmented controls above the textarea or inside `AgentRunPanel`. Selecting either option updates the same draft revision, returns focus to the trigger, and closes the popover; Enter/Space opens it, arrow keys move within a group, and Escape closes it.

In planning mode render `只读规划` and omit the write-policy selector. Switching from execution to planning resets the pre-run draft to `write_before_confirmation` and clears `writePolicyAcknowledged`; returning to execution cannot restore a previous acknowledgement. Rename visible policies to `每次修改前确认` and `本次运行自动修改`; retain the existing enum values. Active runs keep the toolbar readable but disabled, and the one stop control replaces send in the same fixed button slot.

- [ ] **Step 4: Remove composer ownership from `AgentRunPanel`**

Remove request state, composer effects, mode controls, policy controls, textarea, send button, all stop buttons, and Plan Artifact decision UI from `agent-run-panel.tsx`. Keep assistant text, timeline, retry, question answer, context refresh, Change Set status, rollback status, and undo actions. The one stop control belongs to `AgentComposer`; the detailed Plan Artifact and its approve/reject actions belong to the central review. Remove `onSend`, `onStop`, `onDecidePlan`, and the three mode-change callbacks from `AgentRunPanelProps`; project them through `AgentConversationViewProps.composer` / central review in `agent-run-bridge.ts`, `agent-conversation-bridge.ts`, and `agent-conversation-workspace.ts` instead. `workspace-shell-types.ts` owns the public composer contract; no bridge may reconstruct a second legacy composer shape.

- [ ] **Step 5: Run focused tests**

Run:

```powershell
npx vitest run packages/ui/test/agent-composer.test.tsx packages/ui/test/agent-conversation-view.test.tsx packages/ui/test/agent-run-panel.test.tsx apps/desktop/test/agent-run-bridge.test.ts apps/desktop/test/agent-conversation-bridge.test.ts
npm run typecheck
```

Expected: PASS; exactly one textbox and one send/stop command exist.

- [ ] **Step 6: Commit**

```powershell
git add packages/ui/src/agent-composer.tsx packages/ui/src/agent-conversation-view.tsx packages/ui/src/agent-run-panel.tsx packages/ui/src/workspace-shell-types.ts packages/ui/src/index.ts apps/desktop/src/renderer/agent-run-bridge.ts apps/desktop/src/renderer/agent-conversation-bridge.ts apps/desktop/src/renderer/agent-conversation-workspace.ts packages/ui/test/agent-composer.test.tsx packages/ui/test/agent-conversation-view.test.tsx packages/ui/test/agent-run-panel.test.tsx apps/desktop/test/agent-run-bridge.test.ts apps/desktop/test/agent-conversation-bridge.test.ts
git commit -m "refactor: establish one agent composer"
```

### Task 0.2: Move Conversation to the right panel and remove duplicate projections

**Files:**
- Modify: `packages/ui/src/workspace-shell.tsx`
- Modify: `packages/ui/src/agent-conversation-view.tsx`
- Modify: `packages/ui/src/agent-conversation-inspector.tsx`
- Modify: `packages/ui/src/plan-artifact-review.tsx`
- Modify: `packages/ui/src/workspace-shell-types.ts`
- Modify: `packages/ui/src/styles.css`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/agent-conversation-bridge.ts`
- Modify: `apps/desktop/src/renderer/renderer-workspace-shell.tsx`
- Test: `packages/ui/test/workspace-shell.test.tsx`
- Test: `packages/ui/test/agent-conversation-workspace.test.tsx`
- Test: `apps/desktop/test/agent-conversation-bridge.test.ts`

- [ ] **Step 1: Write failing layout and de-duplication tests**

Assert AI activity keeps `WorkspaceEditorSurface` in the main editor, renders `AgentConversationView` in `aria-label="AI 对话面板"`, and does not render `AgentConversationInspector` or `AiWritingAssistantPanel` alongside it. Assert Plan Artifact detail, Diff Review, and Rollback Review still replace the central editor when selected. Add a bridge test with `conversation.lastRunId === agentRun.runId` and assert only one assistant projection is returned.

```ts
const visibleTurns = detail.turns.filter((turn) => turn.runId !== activeRun?.runId);
expect(visibleTurns.map((turn) => turn.runId)).not.toContain(activeRun?.runId);
```

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```powershell
npx vitest run packages/ui/test/workspace-shell.test.tsx packages/ui/test/agent-conversation-workspace.test.tsx apps/desktop/test/agent-conversation-bridge.test.ts
```

Expected: FAIL because Conversation occupies the center, Inspector occupies the right, and the last run appears as both a turn and an active run.

- [ ] **Step 3: Change the shell ownership**

In `workspace-shell.tsx`:

- keep `WorkspaceEditorSurface`, `PlanArtifactReview`, `DiffReview`, and `RollbackReview` in the central editor;
- render `AgentConversationView` inside the right AI panel when an Agent workspace exists;
- do not render `AgentConversationInspector` as a permanent panel;
- do not render legacy `AiWritingAssistantPanel` in the same branch;
- keep the conversation navigator in the existing navigator region.

Export `PlanArtifactReviewProps` from `plan-artifact-review.tsx`, then add a central-review projection to `AgentConversationWorkspaceShellProps` instead of reading legacy workflow state:

```ts
export type AgentConversationMainReview =
  | { readonly kind: "plan"; readonly props: PlanArtifactReviewProps }
  | { readonly kind: "change_set"; readonly props: ChangeSetReviewProps }
  | { readonly kind: "rollback"; readonly props: RollbackReviewProps };

export interface AgentConversationWorkspaceShellProps {
  readonly navigator: AgentConversationNavigatorProps;
  readonly view: AgentConversationViewProps;
  readonly mainReview?: AgentConversationMainReview;
}
```

`agent-conversation-bridge.ts` derives this union from the selected/current run. `WorkspaceShell` uses the fixed priority `rollback > change_set > plan > editor`, switches on `kind`, and provides a return-to-editor/conversation action. It never reads `aiWritingWorkflow.agentRun` for Agent reviews.

In `App.tsx`, remove the merge that injects `agentRun` into `workspaceAiWritingWorkflow`. Pass the legacy workflow unchanged only to legacy compatibility routes.

- [ ] **Step 4: De-duplicate terminal and active run projection**

Make `agent-conversation-bridge.ts` omit a run from persisted turns only while it has a live projection: a non-terminal run, or a terminal run with an open Change Set, rollback, undo, plan, or recovery review. An ordinary terminal run immediately becomes a Conversation turn and no longer renders a run panel. Use `runId` as the identity; never compare assistant text. Add cases for ordinary terminal, terminal with undo available, and terminal with rollback review.

- [ ] **Step 5: Add responsive right-panel rules**

Replace the existing `<1280px` rule that hides the whole AI panel. Preserve a usable `280px` minimum, allow the bottom toolbar to wrap, keep the send button fixed at `32px`, and prevent nested vertical scroll containers. At widths where editor and AI panel cannot coexist, collapse the navigator before hiding the Agent conversation.

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```powershell
npx vitest run packages/ui/test/workspace-shell.test.tsx packages/ui/test/agent-conversation-workspace.test.tsx apps/desktop/test/agent-conversation-bridge.test.ts packages/ui/test/ai-writing-workflow.test.tsx
npm run typecheck
```

Expected: PASS; legacy workflow tests remain valid outside the Agent Conversation branch.

- [ ] **Step 7: Commit**

```powershell
git add packages/ui/src/workspace-shell.tsx packages/ui/src/agent-conversation-view.tsx packages/ui/src/agent-conversation-inspector.tsx packages/ui/src/plan-artifact-review.tsx packages/ui/src/workspace-shell-types.ts packages/ui/src/styles.css apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/agent-conversation-bridge.ts apps/desktop/src/renderer/renderer-workspace-shell.tsx packages/ui/test/workspace-shell.test.tsx packages/ui/test/agent-conversation-workspace.test.tsx apps/desktop/test/agent-conversation-bridge.test.ts
git commit -m "feat: move agent conversation to the right panel"
```

### Task 0.3: Collapse completed activity and lock the UI baseline with Electron

**Files:**
- Create: `packages/ui/src/agent-activity-summary.tsx`
- Modify: `packages/ui/src/agent-run-timeline.tsx`
- Modify: `packages/ui/src/agent-run-panel.tsx`
- Modify: `packages/ui/src/workspace-shell-ai.tsx`
- Modify: `packages/ui/src/styles.css`
- Test: `packages/ui/test/agent-run-panel.test.tsx`
- Test: `apps/desktop/test/agent-conversations.e2e.ts`
- Test: `apps/desktop/test/agent-run.e2e.ts`

- [ ] **Step 1: Write failing activity-summary tests**

Test these presentation rules:

```text
running: current action expanded, previous actions summarized
completed: "已读取 4 项 · 修改 2 个文件" collapsed by default
expanded: exact persisted tool steps visible in sequence order
blocking: question/plan/context/change-set/error card remains inline
```

Assert raw tool arguments, provider frames, token totals, cost, context trace, workflow history, style-rule detail, provider/model observability, and the old workflow's independent message/composer surface are absent from the default Agent conversation stream. The active run must be an inline assistant projection without its own conversation border or nested vertical scroller.

- [ ] **Step 2: Implement event classification and summary rendering**

`AgentActivitySummary` must accept `readonly AgentRunEvent[]`, derive counts from event types, render the active event separately, and use native `<details>` for completed facts. Do not create a second event state store. Keep only one conversation-level vertical scroller; `AgentRunPanel` supplies message content, not another framed chat surface. Legacy `workspace-shell-ai.tsx` may remain for compatibility routes, but its context trace, observability, style review, history, and composer cannot render inside the Agent Conversation branch.

- [ ] **Step 3: Add Electron assertions**

In the existing real Electron tests add:

```ts
await expect(page.getByLabel("Agent 请求")).toHaveCount(1);
await expect(page.getByRole("button", { name: /启动 Agent 运行|停止 Agent 运行/ })).toHaveCount(1);
await expect(page.getByLabel("AI 对话面板")).toBeVisible();
await expect(page.getByLabel("会话运行历史")).not.toContainText("tokens");
await expect(page.getByRole("button", { name: /执行 · 写作|规划 · 写作|执行 · 通用文件|规划 · 通用文件/ })).toHaveCount(1);
```

Open the mode trigger, select planning and writing, assert the trigger becomes `规划 · 写作`, the permission trigger is absent, and no permanent mode segmented controls appear above the textbox. Return to execution, send one request, wait for a terminal event, and assert the assistant answer and each `runId` appear once. After send, assert the visible conversation does not automatically add blocks labelled `文风规则`, `上下文`, `模型`, `Token`, `成本`, `运行历史`, or `Observability`.

- [ ] **Step 4: Run Stage 5.0 gate**

Run:

```powershell
npx vitest run packages/ui/test/agent-composer.test.tsx packages/ui/test/agent-conversation-view.test.tsx packages/ui/test/agent-conversation-workspace.test.tsx packages/ui/test/agent-run-panel.test.tsx packages/ui/test/workspace-shell.test.tsx apps/desktop/test/agent-conversation-bridge.test.ts
npm run typecheck
npm run build
npx playwright test apps/desktop/test/agent-conversations.e2e.ts apps/desktop/test/agent-run.e2e.ts
```

Expected: PASS with one visible composer, one assistant projection, and a central editor plus right-side conversation.

- [ ] **Step 5: Commit**

```powershell
git add packages/ui/src/agent-activity-summary.tsx packages/ui/src/agent-run-timeline.tsx packages/ui/src/agent-run-panel.tsx packages/ui/src/workspace-shell-ai.tsx packages/ui/src/styles.css packages/ui/test/agent-run-panel.test.tsx apps/desktop/test/agent-conversations.e2e.ts apps/desktop/test/agent-run.e2e.ts
git commit -m "test: lock the compact agent conversation baseline"
```

## Stage 5A: Context Runtime

### Task 1.1: Define and normalize the v1.1 run and context contracts

**Files:**
- Modify: `packages/agent-engine/src/context-snapshot.ts`
- Modify: `packages/agent-engine/src/agent-run-types.ts`
- Modify: `packages/agent-engine/src/index.ts`
- Modify: `packages/agent-engine/test/context-snapshot.test.ts`
- Modify: `packages/agent-engine/test/agent-run-coordinator.test.ts`
- Create: `packages/agent-engine/test/stage5-event-contract.test.ts`
- Modify: `packages/repository/src/agent-run-repository.ts`
- Modify: `packages/repository/test/agent-run-repository.test.ts`
- Modify: `packages/application/src/agent-run-session.ts`
- Modify: `packages/application/test/agent-run-session.test.ts`
- Modify: `packages/application/src/ipc-contract.ts`
- Modify: `apps/desktop/src/main/ipc-handlers.ts`
- Modify: `apps/desktop/src/main/ipc-allowlist.ts`
- Modify: `apps/desktop/src/preload/api.ts`
- Modify: `apps/desktop/src/preload/index.cts`
- Modify: `apps/desktop/src/renderer/agent-run-bridge.ts`
- Test: `apps/desktop/test/agent-run-ipc.test.ts`
- Test: `apps/desktop/test/agent-run-bridge.test.ts`

- [ ] **Step 1: Add failing v1.0/v1.1 normalization tests**

Cover a v1.0 snapshot/event/context snapshot loaded as a v1.1 internal view, a complete v1.1 snapshot/event/context snapshot, unknown future non-terminal events, invalid future terminal events, `context_compacting`, and `awaiting_plan_revision`. Assert every DTO passes `structuredClone`. Restore a v1.0 active run through Repository -> Application -> IPC -> preload -> renderer and exercise resume, retry, cancel, pending Change Set, and undo without rewriting the old JSON.

- [ ] **Step 2: Define the exact additions**

Use these discriminated fields:

```ts
export type AgentContextLayer =
  | "system"
  | "user_request"
  | "conversation_summary"
  | "plan"
  | "explicit_ref"
  | "editor"
  | "tool_result"
  | "change_set_summary";

export type AgentContextPrecision = "reported" | "estimated" | "unknown";
export type AgentContextSourceState = "active" | "stale" | "excluded";
export type AgentReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface AgentRunUsageSummary {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedTokens?: number;
  readonly reasoningTokens?: number;
  readonly totalTokens: number;
  readonly usageStatus: "actual" | "estimated" | "missing";
}

export interface AgentRunSnapshotV11 extends Omit<AgentRunSnapshotV10, "schemaVersion" | "status"> {
  readonly schemaVersion: "1.1";
  readonly modelProfileId: string;
  readonly reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
  readonly permissionSummaryId: string | null;
  readonly permissionSummaryChecksum: string | null;
  readonly contextBudgetSnapshotId: string | null;
  readonly activeCompactionId: string | null;
  readonly planExecutionId: string | null;
  readonly planExecutionRevision: number | null;
  readonly activeErrorId: string | null;
  readonly recoveryState: "none" | "retryable" | "awaiting_context_refresh" | "recovery_review" | "terminal";
  readonly usageSummary: AgentRunUsageSummary;
  readonly status: AgentRunStatus | "context_compacting" | "awaiting_plan_revision";
}
```

Define `AgentContextSnapshotV11` with layers, source revision/token/precision/state fields and define `AgentRunEventV11` with the Stage 5 event union. Retain exported v1.0 types for persisted compatibility and export `normalizeAgentRunSnapshot()`, `normalizeAgentRunEvent()`, and `normalizeAgentContextSnapshot()` returning v1.1 views. Missing v1.0 fields map to `modelProfileId = providerCapabilitySnapshot.profileId`, `reasoningEffort = undefined`, nullable Stage 5 IDs, `recoveryState = "none"`, zero/unknown usage summary, source `layer = "tool_result"`, `tokenCount = null`, `precision = "unknown"`, and `state = "active"`.

**Implementation constraints (resolve these before writing code — verified against the current source):**

1. **`AgentRunSnapshotV10` does not exist as a name.** The current type in `agent-run-types.ts` is `AgentRunSnapshot` (`schemaVersion: "1.0"`), exported from `index.ts` and consumed by the coordinator, session, and `AgentRunCommandResult`. First rename/alias `AgentRunSnapshot` → `AgentRunSnapshotV10` (keep an `AgentRunSnapshot` alias pointing at the normalized v1.1 view for existing consumers), then declare `AgentRunSnapshotV11 extends Omit<AgentRunSnapshotV10, "schemaVersion" | "status">`. The `Omit` idiom already appears in this package (`CreatePlanArtifactInput = Omit<PlanArtifact, "schemaVersion" | "revision" | "status">`).
2. **Coordinator ownership decision (REVISED during implementation 2026-07-16 — supersedes the earlier "Application normalizes-before-write" note).** The earlier draft assumed the coordinator "cannot populate" Stage 5 pointer fields, so it proposed keeping the coordinator on a v1.0 literal and normalizing at the Application persistence boundary. Reading the code disproved the premise: (a) `recordRunEvent` applies `{ ...snapshot, ...input.snapshotPatch, status, ... }` and stores the result in the coordinator's `runs` map — the coordinator's map **is** the in-memory snapshot authority, so Stage 5 patch fields (constraint #3) MUST be type-visible on the coordinator's snapshot type or they are dropped at the type level; (b) every new field has a deterministic default the coordinator already has in hand (`modelProfileId = command.providerCapabilitySnapshot.profileId`, pointers `null`, `recoveryState "none"`, zeroed `usageSummary`, `reasoningEffort undefined`). The Application-normalizes-before-write design was also measured to force a *split* `AgentRunCommandResult` (V10 for the coordinator, V11 for the exposed API) plus a normalize step at ~20 scattered session return sites, because the coordinator constructs the result wrapper itself and the session passes it through untransformed. **Decision for Stage 5: the coordinator authors a complete `AgentRunSnapshotV11` literal (`schemaVersion: "1.1"`) at `startRun`, its `runs` map is `Map<string, AgentRunSnapshotV11>`, and `AgentRunCommandResult.value` is the V11 alias.** Normalization collapses to a single read-path concern: old v1.0 files are normalized to the V11 view on restore/list (`normalizeAgentRunSnapshot`), never rewritten. `AgentRunSnapshot` aliases V11 so the session/api/preload/renderer adopt the richer type with zero churn (they consume only the v1.0 subset today). Add `agent-run-coordinator.ts` to this task's file list. Add a focused test asserting a freshly started run is `schemaVersion: "1.1"` straight from the coordinator, and that a restored v1.0 disk record surfaces as a normalized v1.1 view.
3. **Widen the mutation surface now.** `AgentRunSnapshotPatch` currently carries only pending-change-set/plan/version-group fields; widen it to accept the new Stage 5 pointer fields (`contextBudgetSnapshotId`, `activeCompactionId`, `planExecutionId`/`planExecutionRevision`, `activeErrorId`, `permissionSummaryId`/`permissionSummaryChecksum`, `recoveryState`, `usageSummary`). Widen `RecordAgentRunEventInput.status` to accept `context_compacting` and `awaiting_plan_revision`. These land in Task 1.1's type edits so Tasks 1.4/1.5/2.x compile against the coordinator.
4. **Name collision on `normalizeAgentRunSnapshot`.** An existing function of this name already lives in `agent-run-session.ts` and is wired into `listAgentRuns` (it only backfills `conversationId`). Replace that local helper with the new agent-engine export rather than shipping two divergent normalizers; update `listAgentRuns` to call the engine version.
5. **`modelProfileId` is a deliberate hoist**, not net-new data: it duplicates `providerCapabilitySnapshot.profileId`. Keep the normalization rule and do not treat it as a second source of truth.
6. Use the `AgentReasoningEffort` alias (defined above) in `AgentRunSnapshotV11.reasoningEffort?` rather than re-inlining the union.

- [ ] **Step 3: Add schema-aware repository reads**

Make `AgentRunFileRepository`, Application restore, IPC validators, preload event guards, and renderer bridge accept v1.0 and v1.1 records, reject malformed versions, and write only v1.1 for new Stage 5 runs. Normalize at the owning boundary; do not rewrite old files during read.

- [ ] **Step 4: Run contract tests**

Run:

```powershell
npx vitest run packages/agent-engine/test/context-snapshot.test.ts packages/agent-engine/test/agent-run-coordinator.test.ts packages/agent-engine/test/stage5-event-contract.test.ts packages/repository/test/agent-run-repository.test.ts packages/application/test/agent-run-session.test.ts apps/desktop/test/agent-run-ipc.test.ts apps/desktop/test/agent-run-bridge.test.ts
npm run typecheck
```

Expected: PASS; old run records remain readable.

- [ ] **Step 5: Commit**

```powershell
git add packages/agent-engine/src/context-snapshot.ts packages/agent-engine/src/agent-run-types.ts packages/agent-engine/src/index.ts packages/agent-engine/test/context-snapshot.test.ts packages/agent-engine/test/agent-run-coordinator.test.ts packages/agent-engine/test/stage5-event-contract.test.ts packages/repository/src/agent-run-repository.ts packages/repository/test/agent-run-repository.test.ts packages/application/src/agent-run-session.ts packages/application/test/agent-run-session.test.ts packages/application/src/ipc-contract.ts apps/desktop/src/main/ipc-handlers.ts apps/desktop/src/preload/api.ts apps/desktop/src/preload/index.cts apps/desktop/src/renderer/agent-run-bridge.ts apps/desktop/test/agent-run-ipc.test.ts apps/desktop/test/agent-run-bridge.test.ts
git commit -m "feat: add stage 5 run and context contracts"
```

### Task 1.2: Create the unified Agent Run Draft and explicit context references

**Files:**
- Create: `packages/agent-engine/src/agent-run-draft.ts`
- Create: `packages/agent-engine/test/agent-run-draft.test.ts`
- Create: `packages/agent-engine/src/context-draft.ts`
- Create: `packages/agent-engine/test/context-draft.test.ts`
- Create: `packages/application/src/agent-run-draft-session.ts`
- Create: `packages/application/test/agent-run-draft-session.test.ts`
- Modify: `packages/application/src/agent-model-capabilities.ts`
- Modify: `packages/agent-engine/src/agent-run-types.ts`
- Modify: `packages/agent-engine/src/index.ts`
- Modify: `packages/application/src/index.ts`
- Modify: `packages/repository/src/agent-run-repository.ts`
- Modify: `packages/repository/test/agent-run-repository.test.ts`

- [ ] **Step 1: Write failing unified draft tests**

Cover request/mode/policy/model/reasoning/ref mutations, duplicate refs, editor selection revision, stale expected revision, checksum changes, Path Guard rejection, dirty flags, general-file rejection of chapter/Story Bible refs, unsupported reasoning normalization, new Conversation defaults, reload, and automatic-modification acknowledgement reset. Assert every mutation produces one immutable revision and one command receipt.

- [ ] **Step 2: Implement the two focused value objects**

```ts
export interface AgentRunDraft {
  readonly schemaVersion: "1.0";
  readonly runDraftId: string;
  readonly projectId: string;
  readonly conversationId: string;
  readonly revision: number;
  readonly checksum: string;
  readonly userRequest: string;
  readonly operationMode: AgentOperationMode;
  readonly contextMode: AgentContextMode;
  readonly writePolicy: AgentWritePolicy;
  readonly writePolicyAcknowledged: boolean;
  readonly modelProfileId: string;
  readonly reasoningEffort?: AgentReasoningEffort;
  readonly contextDraftId: string;
  readonly contextDraftRevision: number;
  readonly contextDraftChecksum: string;
  readonly contextBudgetSnapshotId: string | null;
  readonly updatedAt: string;
}
```

Retain the `ContextDraft` / `ContextDraftRef` contract defined below as the reference-only child object. `AgentRunDraft` owns every pre-run composer fact and points to exactly one Context Draft revision/checksum.

```ts
export interface AgentContextRange {
  readonly start: number;
  readonly end: number;
}

export type ContextDraftRef =
  | { readonly kind: "chapter"; readonly refId: string; readonly chapterId: string; readonly label: string; readonly range?: AgentContextRange }
  | { readonly kind: "story_bible"; readonly refId: string; readonly assetId: string; readonly label: string }
  | { readonly kind: "project_file"; readonly refId: string; readonly relativePath: string; readonly label: string; readonly range?: AgentContextRange }
  | { readonly kind: "editor_selection"; readonly refId: string; readonly editorRevision: number; readonly label: string; readonly range: AgentContextRange };

export interface ContextDraft {
  readonly schemaVersion: "1.0";
  readonly contextDraftId: string;
  readonly conversationId: string;
  readonly projectId: string;
  readonly contextMode: AgentContextMode;
  readonly revision: number;
  readonly refs: readonly ContextDraftRef[];
  readonly checksum: string;
  readonly updatedAt: string;
}

export interface UpdateAgentRunDraftCommand {
  readonly projectId: string;
  readonly conversationId: string;
  readonly commandId: string;
  readonly runDraftId: string;
  readonly expectedDraftRevision: number;
  readonly mutation:
    | { readonly kind: "set_request"; readonly request: string }
    | { readonly kind: "set_operation_mode"; readonly operationMode: AgentOperationMode }
    | { readonly kind: "set_context_mode"; readonly contextMode: AgentContextMode }
    | { readonly kind: "set_write_policy"; readonly writePolicy: AgentWritePolicy; readonly acknowledged: boolean }
    | { readonly kind: "set_model"; readonly modelProfileId: string; readonly reasoningEffort?: AgentReasoningEffort }
    | { readonly kind: "set_reasoning"; readonly reasoningEffort: AgentReasoningEffort };
}

export interface UpdateContextDraftCommand {
  readonly projectId: string;
  readonly conversationId: string;
  readonly commandId: string;
  readonly contextDraftId: string;
  readonly expectedDraftRevision: number;
  readonly mutation:
    | { readonly kind: "add_ref"; readonly ref: ContextDraftRef }
    | { readonly kind: "remove_ref"; readonly refId: string }
    | { readonly kind: "set_selection"; readonly ref: Extract<ContextDraftRef, { readonly kind: "editor_selection" }> | null };
}

export interface RefreshContextDraftCommand {
  readonly projectId: string;
  readonly conversationId: string;
  readonly commandId: string;
  readonly contextDraftId: string;
  readonly expectedDraftRevision: number;
}
```

- [ ] **Step 3: Add Application ownership and storage**

Expose `readAgentRunDraft`, `updateAgentRunDraft`, `updateContextDraft`, and `refreshContextDraft`. New Conversations initialize from the project default profile, the model's declared default reasoning effort, planning/execution default, context inferred from the editor, and `write_before_confirmation`. Store revisions under `history/conversations/<conversationId>/run-drafts` and `context-drafts`. Resolve document content only when creating a Context Snapshot; never persist renderer-provided document content.

**Repository ownership and path-guard (resolve before coding):** The `history/conversations/<conversationId>/` tree is currently owned exclusively by `AgentConversationFileRepository`, which guards every write with a `ProjectPathGuard` (`verifyProjectStoragePath`) and already uses the `<revision>.json` numbering convention (`summaries/`, scan by `/^[1-9][0-9]*\.json$/`). `AgentRunFileRepository` uses **no** path guard. Do NOT let `AgentRunFileRepository` write run-drafts/context-drafts into the conversation-owned subtree unguarded. Decision: **add `run-drafts/` and `context-drafts/` as new siblings of `summaries/` on `AgentConversationFileRepository`**, reusing its existing `ProjectPathGuard` and revision-numbering helpers; the Application draft session calls the conversation repository for draft persistence. Update this task's file list accordingly (add `packages/repository/src/agent-conversation-repository.ts`, drop the run-repository from draft persistence). This keeps one guarded owner for the conversation subtree.

- [ ] **Step 4: Run focused tests and commit**

Run:

```powershell
npx vitest run packages/agent-engine/test/agent-run-draft.test.ts packages/agent-engine/test/context-draft.test.ts packages/application/test/agent-run-draft-session.test.ts packages/repository/test/agent-run-repository.test.ts
npm run typecheck
```

Expected: PASS; one checksum binds all pre-run choices.

```powershell
git add packages/agent-engine/src/agent-run-draft.ts packages/agent-engine/src/context-draft.ts packages/agent-engine/src/agent-run-types.ts packages/agent-engine/src/index.ts packages/agent-engine/test/agent-run-draft.test.ts packages/agent-engine/test/context-draft.test.ts packages/application/src/agent-run-draft-session.ts packages/application/src/agent-model-capabilities.ts packages/application/src/index.ts packages/application/test/agent-run-draft-session.test.ts packages/repository/src/agent-run-repository.ts packages/repository/test/agent-run-repository.test.ts
git commit -m "feat: add unified agent run drafts"
```

### Task 1.3: Make model profile and reasoning selection server-authoritative

**Files:**
- Modify: `packages/agent-engine/src/agent-run-types.ts`
- Modify: `packages/application/src/agent-model-capabilities.ts`
- Modify: `packages/application/src/agent-run-draft-session.ts`
- Modify: `packages/application/src/agent-run-session.ts`
- Modify: `packages/application/src/agent-run-model-driver.ts`
- Modify: `packages/application/src/ipc-contract.ts`
- Modify: `apps/desktop/src/main/agent-run-runtime.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/main/ipc-handlers.ts`
- Modify: `apps/desktop/src/preload/api.ts`
- Modify: `apps/desktop/src/preload/index.cts`
- Modify: `apps/desktop/src/renderer/agent-run-bridge.ts`
- Modify: `apps/desktop/src/renderer/agent-conversation-bridge.ts`
- Modify: `apps/desktop/src/renderer/agent-conversation-workspace.ts`
- Test: `packages/application/test/agent-model-capabilities.test.ts`
- Test: `packages/application/test/agent-run-model-driver.test.ts`
- Test: `packages/application/test/agent-run-session.test.ts`
- Test: `apps/desktop/test/agent-run-ipc.test.ts`
- Test: `apps/desktop/test/agent-run-bridge.test.ts`
- Test: `apps/desktop/test/agent-conversation-bridge.test.ts`

- [x] **Step 1: Write failing authority and capability tests**

Assert `StartAgentRunCommand` carries only `runDraftId + runDraftRevision + runDraftChecksum`, not a renderer-authored `providerCapabilitySnapshot`, scattered mode/model/context fields, or `initialContextSources`. Test unknown profile, hidden reasoning control, unsupported effort, context window below 8K, a stale run draft, and a valid supported model.

- [x] **Step 2: Change the public start command atomically**

```ts
export interface StartAgentRunCommand {
  readonly projectId: string;
  readonly conversationId: string;
  readonly commandId: string;
  readonly expectedRunRevision: 0;
  readonly runDraftId: string;
  readonly runDraftRevision: number;
  readonly runDraftChecksum: string;
  readonly limits?: Partial<AgentRunLimits>;
  readonly sourcePlanId?: string;
  readonly sourcePlanRevision?: number;
}
```

Application reloads the run draft, Context Draft, editor content, model profile, discovery/capability facts, and context window in one preflight. It populates the existing `AgentProviderCapabilitySnapshot` type (it already exists in `agent-run-types.ts`; the preflight fills it, it is not a new type). Renderer cannot submit provider, model name, context window, capabilities, or document content.

**Blast radius — do NOT skip this (verified against the current source):** Narrowing the *public* `StartAgentRunCommand` breaks two internal callers that still consume the wide field set, and neither is mentioned in the naive file list:

1. **`AgentRunCoordinator.startRun` still needs the resolved fields.** `coordinator.startRun` (in `agent-engine`) consumes `operationMode`, `contextMode`, `providerCapabilitySnapshot`, `userRequest`, and `initialContextSources`. Do NOT push draft IDs into the coordinator. Introduce an **internal `ResolvedAgentRunStartInput`** type (the old wide shape, minus renderer authority) that the Application preflight builds server-side from the draft + Context Draft + editor + profile, and change `coordinator.startRun` to accept `ResolvedAgentRunStartInput`. The public IPC command stays draft-only; the coordinator stays field-based. Add `packages/agent-engine/src/agent-run-types.ts` (already listed) plus an explicit note that `coordinator.startRun`'s signature changes to the resolved-input type.
2. **The `decidePlan` plan→execution handoff re-calls `coordinator.startRun`** (in `agent-run-session.ts`, ~lines 1817-1834) reusing the parent run's `providerCapabilitySnapshot` and context sources. Under the draft-only command this path has no run draft. Migrate it to build a `ResolvedAgentRunStartInput` **server-side** from: the approved plan's `handoffContextMode`/`handoffWritePolicy`, the parent run's model profile + reasoning (or the conversation's current draft model), and a freshly re-derived capability snapshot + context. State explicitly that an execution run started from an approved plan obtains model/reasoning/context authority from the server preflight, never from a renderer command.
3. **Replay compatibility.** Old persisted command receipts referencing the wide `StartAgentRunCommand` remain readable (they are receipts, not replayed as new starts); add a test asserting a legacy receipt read does not attempt to re-validate against the narrowed command shape.

- [x] **Step 3: Forward reasoning to the model driver**

Extend resolved runtime parameters with the validated effort, bind model/reasoning into the run snapshot, and reject attempts to change either on resume/retry. Update IPC validators and preload guards in the same task so no intermediate build rejects the new start shape.

- [x] **Step 4: Run focused tests**

Run:

```powershell
npx vitest run packages/application/test/agent-model-capabilities.test.ts packages/application/test/agent-run-model-driver.test.ts packages/application/test/agent-run-session.test.ts apps/desktop/test/agent-run-ipc.test.ts apps/desktop/test/agent-run-bridge.test.ts
npm run typecheck
```

Expected: PASS; unsupported reasoning never reaches provider parameters.

- [x] **Step 5: Commit**

```powershell
git add packages/agent-engine/src/agent-run-types.ts packages/application/src/agent-model-capabilities.ts packages/application/src/agent-run-draft-session.ts packages/application/src/agent-run-session.ts packages/application/src/agent-run-model-driver.ts packages/application/src/ipc-contract.ts apps/desktop/src/main/agent-run-runtime.ts apps/desktop/src/main/index.ts apps/desktop/src/main/ipc-handlers.ts apps/desktop/src/preload/api.ts apps/desktop/src/preload/index.cts apps/desktop/src/renderer/agent-run-bridge.ts packages/application/test/agent-model-capabilities.test.ts packages/application/test/agent-run-model-driver.test.ts packages/application/test/agent-run-session.test.ts apps/desktop/test/agent-run-ipc.test.ts apps/desktop/test/agent-run-bridge.test.ts
git commit -m "feat: bind agent runs to model and reasoning selections"
```

### Task 1.4: Calculate provider-aware context budgets

**Files:**
- Create: `packages/agent-engine/src/context-budget.ts`
- Create: `packages/agent-engine/test/context-budget.test.ts`
- Create: `packages/application/src/agent-context-session.ts`
- Create: `packages/application/test/agent-context-session.test.ts`
- Modify: `packages/application/src/agent-run-session.ts`
- Modify: `packages/application/src/index.ts`
- Modify: `packages/agent-engine/src/index.ts`
- Modify (deviation — Step 4 binding seam): `packages/agent-engine/src/agent-run-types.ts` (add `contextBudgetSnapshotId?` to `ResolvedAgentRunStartInput`), `packages/agent-engine/src/agent-run-coordinator.ts` (bind it at `startRun`), `packages/application/test/agent-run-session.test.ts` (budget-binding test)

**Implementation note (DONE 2026-07-16):** Binding the budget id at start required a server-authoritative seam the file list omitted: the coordinator authors `contextBudgetSnapshotId` on the V11 snapshot, so `ResolvedAgentRunStartInput` gained an optional `contextBudgetSnapshotId?` and `startRun` binds `command.contextBudgetSnapshotId ?? null`. `AgentRunStartFacts` gained an optional `contextBudgetSnapshotId?` that `resolveStartInput` forwards, so the preflight is where the budget is recalculated at start (renderer previews are never trusted). `previewContextBudget` is read-only over `resolveStartDraft` (verifies id/rev/checksum) and a `AgentContextBudgetInputsPort` that resolves model facts + ref content; token estimation uses the injected `AgentTokenEstimator` or the deterministic UTF-8 fallback (always `estimated`, never `reported`). Desktop wiring of `previewContextBudget` + start-time budget recompute is deferred to Task 1.6 (composer); the `decidePlan` execution handoff leaves the budget id unset (recomputed there in 1.5/1.6). Persisting the budget-snapshot body is a repository concern (not in 1.4).

- [x] **Step 1: Write failing arithmetic and precision tests**

Test 8K/32K/128K windows, explicit maximum output, fallback output reserve, tool-schema reserve, system reserve, negative/NaN/overflow rejection, required budget below 8K, reported/estimated/unknown precision, and model switching.

- [x] **Step 2: Implement the pure budget function**

```ts
export interface ContextBudgetSnapshot {
  readonly schemaVersion: "1.0";
  readonly contextBudgetSnapshotId: string;
  readonly contextWindow: number;
  readonly maxOutputTokens: number;
  readonly contextWindowSemantics: "shared_input_output_window";
  readonly safeInputBudget: number;
  readonly requiredContextTokens: number;
  readonly outputReserve: number;
  readonly toolReserve: number;
  readonly systemReserve: number;
  readonly usedTokens: number;
  readonly remainingTokens: number;
  readonly precision: AgentContextPrecision;
  readonly provider: string;
  readonly model: string;
  readonly calculatedAt: string;
}

export interface PreviewContextBudgetCommand {
  readonly projectId: string;
  readonly conversationId: string;
  readonly commandId: string;
  readonly runDraftId: string;
  readonly expectedDraftRevision: number;
  readonly runDraftChecksum: string;
}
```

Compute `safeInputBudget = contextWindow - outputReserve - toolReserve - systemReserve`; reject invalid operands before subtraction. Use `min(16K, max(4K, floor(contextWindow * 0.15)))` only when the profile lacks a valid maximum output.

- [x] **Step 3: Integrate the estimator port**

Define `AgentTokenEstimator.count(text, modelProfileId)` returning `{ tokens, precision }`. Use provider/tokenizer implementations when injected; otherwise use one deterministic UTF-8 estimator marked `estimated`. Do not label local estimates as reported usage.

- [x] **Step 4: Bind budgets to run draft and snapshot**

Calculate a preview budget when model, request, refs, editor, or modes change. Recalculate during start preflight and bind `contextBudgetSnapshotId`; reject a mismatched draft preview rather than trusting renderer percentages.

- [x] **Step 5: Run focused tests**

Run:

```powershell
npx vitest run packages/agent-engine/test/context-budget.test.ts packages/application/test/agent-context-session.test.ts packages/application/test/agent-run-session.test.ts
npm run typecheck
```

Expected: PASS; all arithmetic is finite and non-negative.

- [x] **Step 6: Commit**

```powershell
git add packages/agent-engine/src/context-budget.ts packages/agent-engine/src/index.ts packages/agent-engine/test/context-budget.test.ts packages/application/src/agent-context-session.ts packages/application/src/agent-run-session.ts packages/application/src/index.ts packages/application/test/agent-context-session.test.ts packages/application/test/agent-run-session.test.ts
git commit -m "feat: calculate agent context budgets"
```

### Task 1.5: Implement deterministic and model-assisted compaction

**Files:**
- Create: `packages/agent-engine/src/agent-usage-record.ts`
- Create: `packages/agent-engine/test/agent-usage-record.test.ts`
- Modify: `packages/agent-engine/src/index.ts`
- Create: `packages/repository/src/agent-usage-repository.ts`
- Create: `packages/repository/test/agent-usage-repository.test.ts`
- Modify: `packages/repository/src/index.ts`
- Create: `packages/agent-engine/src/context-compaction.ts`
- Create: `packages/agent-engine/test/context-compaction.test.ts`
- Modify: `packages/application/src/agent-context-session.ts`
- Modify: `packages/application/src/agent-run-session.ts`
- Modify: `packages/application/test/agent-context-session.test.ts`
- Modify: `packages/application/test/agent-run-session.test.ts`
- Modify: `packages/repository/src/agent-run-repository.ts`
- Modify: `packages/repository/test/agent-run-repository.test.ts`
- Modify: `apps/desktop/src/main/agent-run-runtime.ts`
- Modify: `apps/desktop/src/main/agent-runtime-manager.ts`
- Modify: `apps/desktop/src/main/index.ts`

- [ ] **Step 1: Write failing compaction tests**

Cover manual trigger, 70% warning, one 85% automatic trigger, the exact deterministic eviction order, protected fact provenance, manifest persistence before compaction work, model-assisted fallback limited to evictable sources, pointer metadata token accounting, provider unavailable, cancellation, failed compaction rollback, reload, repeated compaction, chronological protocol preservation, and a second compaction still exceeding budget. Assert protected fact IDs/checksums, pending Change Set identity, recovery/undo references, and `throughSequence` remain unchanged or advance monotonically; do not use a nondeterministic “model remembers a sentence” assertion as the only gate.

- [ ] **Step 2: Define the final usage record shape and the minimal sink**

Define the one forward-compatible record now so compaction and normal model rounds never create competing usage types. Stage 5A writes `pricingVersion = null`, `unitPrices = null`, and `cost.status = "unknown"` when no provider cost exists; Task 3.2 activates registry pricing, retention, aggregation, and query behavior without replacing this contract.

```ts
import type { Result, UnifiedError } from "@novel-studio/shared";
import type { LlmCost } from "@novel-studio/llm-adapter";

export interface AgentUsageUnitPriceSnapshot {
  readonly inputPerMillion: number;
  readonly outputPerMillion: number;
  readonly cachedPerMillion?: number;
  readonly reasoningPerMillion?: number;
  readonly currency: string;
}

export interface AgentUsageRecord {
  readonly schemaVersion: "1.0";
  readonly usageId: string;
  readonly runId: string;
  readonly conversationId: string;
  readonly projectId: string;
  readonly roundId: string;
  readonly finalSequence: number;
  readonly provider: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedTokens?: number;
  readonly reasoningTokens?: number;
  readonly totalTokens: number;
  readonly usageStatus: "actual" | "estimated" | "missing";
  readonly precision: AgentContextPrecision;
  readonly pricingVersion: string | null;
  readonly unitPrices: AgentUsageUnitPriceSnapshot | null;
  readonly cost: LlmCost;
  readonly contextWindow: number;
  readonly safeInputBudget: number;
  readonly compactionBeforeTokens?: number;
  readonly compactionAfterTokens?: number;
  readonly terminationReason: string;
  readonly timestamp: string;
  readonly localDate: string;
  readonly timezone: string;
  readonly utcOffsetMinutes: number;
}

export interface AgentUsageSink {
  writeFinal(record: AgentUsageRecord): Promise<Result<AgentUsageRecord, UnifiedError>>;
}

export interface CompactContextCommand {
  readonly projectId: string;
  readonly runId: string;
  readonly commandId: string;
  readonly expectedRunRevision: number;
  readonly contextBudgetSnapshotId: string;
  readonly trigger: "manual" | "automatic" | "recovery";
}
```

Create `AgentUsageFileRepository` with idempotent `writeFinal/readById` under the Electron user-data root. Key idempotency by `runId:roundId:finalSequence`; validate finite non-negative token/budget values and reject prompt text, file contents, absolute paths, credentials, authorization headers, and raw provider frames. `UserPreferencesFileRepository` is the direct template: same `{ userDataRoot }` option, same guard-free `writeTextAtomically`. Wire `userDataRoot` through `main/index.ts`, runtime manager, and runtime composition (the preferences repo already threads it — follow that precedent). Export `AgentUsageFileRepositoryOptions` from `packages/repository/src/index.ts` alongside the class. Task 3.2 extends this same repository with retention and query APIs.

**Daily-aggregate seam (avoid write-path rework in 5C):** Task 3.2 introduces 365-day daily aggregates while detail records retain only 30 days. If 5A's `writeFinal` writes only detail records, aggregates for records aged past 30 days can never be backfilled. Therefore **5A's `writeFinal` already maintains the daily aggregate** (incrementally update the `localDate` bucket in the same call, keyed off the record's stored `localDate/timezone/utcOffsetMinutes`), so Task 3.2 only adds query/retention/clear on top and never rewrites the write path.

- [ ] **Step 3: Implement immutable compaction revisions**

```ts
export type ProtectedContextFactKind =
  | "run_goal"
  | "user_decision"
  | "approved_plan"
  | "plan_execution"
  | "unresolved_question"
  | "explicit_ref"
  | "pending_change_set"
  | "recovery"
  | "undo";

interface ProtectedContextFactBase {
  readonly kind: ProtectedContextFactKind;
  readonly factId: string;
  readonly sourceId: string;
  readonly checksum: string;
}

export type ProtectedContextFact =
  | (ProtectedContextFactBase & { readonly sourceRevision: number; readonly eventSequence?: never })
  | (ProtectedContextFactBase & { readonly sourceRevision?: never; readonly eventSequence: number });

export interface EvictableContextSource {
  readonly sourceId: string;
  readonly sourceRevision: number;
  readonly layer: AgentContextLayer;
  readonly checksum: string;
  readonly tokenCount: number;
  readonly evictionReason: "duplicate" | "raw_result" | "rereadable_body" | "superseded_transient";
  readonly pointerTokenCount: number;
}

export interface CompactionInputManifest {
  readonly schemaVersion: "1.0";
  readonly compactionId: string;
  readonly runId: string;
  readonly sourceSnapshotId: string;
  readonly throughSequence: number;
  readonly protectedFacts: readonly ProtectedContextFact[];
  readonly evictableSources: readonly EvictableContextSource[];
  readonly checksum: string;
  readonly createdAt: string;
}

export interface ContextCompactionRevision {
  readonly schemaVersion: "1.0";
  readonly compactionId: string;
  readonly runId: string;
  readonly sourceSnapshotId: string;
  readonly resultSnapshotId: string | null;
  readonly budgetSnapshotId: string | null;
  readonly inputManifestId: string;
  readonly inputManifestChecksum: string;
  readonly revision: number;
  readonly throughSequence: number;
  readonly trigger: "manual" | "automatic" | "recovery";
  readonly strategy: "deterministic" | "model_assisted";
  readonly protectedFactIds: readonly string[];
  readonly evictedSourceIds: readonly string[];
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly usageRecordId: string | null;
  readonly precision: AgentContextPrecision;
  readonly summaryChecksum: string;
  readonly status: "completed" | "failed" | "cancelled";
  readonly createdAt: string;
}
```

Build the manifest from canonical stores before any deterministic pass or provider call. Require exactly one of `sourceRevision` and `eventSequence` on each protected fact, validate all fact/source checksums, and retain pointer metadata in the active budget. The deterministic pass evicts in the documented order. The model-assisted request receives only `evictableSources`; merge protected facts back from their source IDs and reject a result whose `throughSequence` or protected fact checksums regress. Only `completed` revisions can become `activeCompactionId`; always preserve the user goal, approved plan facts, unresolved questions, source refs, tool summaries needed for the next action, pending Change Set identity, and recovery/undo facts.

- [ ] **Step 4: Add state/events and persistence ordering**

Add `context_compaction_started/completed/failed`; persist the manifest before publishing `context_compaction_started`.

**The compaction "commit" is cross-repository and Application-orchestrated — not a single repository method (verified against the current source).** The usage record lives in `AgentUsageFileRepository` (Electron user-data root), while the compaction revision, result snapshot, budget snapshot, and the `activeCompactionId` pointer live in `AgentRunFileRepository` (project `history`). Two repositories, two roots — the ordering guarantee cannot be one repo method. Sequence it in `agent-context-session` (Application layer) using the rename-based `writeTextAtomically` primitive (there is no multi-file transaction or fsync barrier available):

1. write the usage record to `AgentUsageFileRepository`, capture its `usageId`;
2. write the completed `ContextCompactionRevision` (with `usageRecordId` pointing at that id), the result snapshot, and the budget snapshot to `AgentRunFileRepository`;
3. **last**, rewrite `run.json` with the new `activeCompactionId` as the commit marker.

A crash before step 3 leaves orphaned-but-harmless artifacts and the prior `activeCompactionId` intact. The **read path** must cross-validate that the revision + result/budget snapshots referenced by `activeCompactionId` all exist before honoring the pointer (today `readSnapshot` does zero cross-reference validation — this is new read-path logic). Give the pointer rewrite the `writeChangeSet` read-before-write + JSON-equality idempotency pattern so a replayed commit returns the first result. Publish completion only after the commit marker succeeds. Model-assisted compaction uses a no-tools request, receives only evictable material, cannot produce a plan or Change Set, and records usage. Cancellation or failure restores the last committed snapshot/budget and never publishes a completion event for an uncommitted revision.

- [ ] **Step 5: Run focused tests**

Run:

```powershell
npx vitest run packages/agent-engine/test/agent-usage-record.test.ts packages/agent-engine/test/context-compaction.test.ts packages/application/test/agent-context-session.test.ts packages/application/test/agent-run-session.test.ts packages/repository/test/agent-run-repository.test.ts packages/repository/test/agent-usage-repository.test.ts
npm run typecheck
```

Expected: PASS; failed compaction never replaces the active context.

- [ ] **Step 6: Commit**

```powershell
git add packages/agent-engine/src/agent-usage-record.ts packages/agent-engine/src/context-compaction.ts packages/agent-engine/src/index.ts packages/agent-engine/test/agent-usage-record.test.ts packages/agent-engine/test/context-compaction.test.ts packages/application/src/agent-context-session.ts packages/application/src/agent-run-session.ts packages/application/test/agent-context-session.test.ts packages/application/test/agent-run-session.test.ts packages/repository/src/agent-run-repository.ts packages/repository/src/agent-usage-repository.ts packages/repository/src/index.ts packages/repository/test/agent-run-repository.test.ts packages/repository/test/agent-usage-repository.test.ts apps/desktop/src/main/agent-run-runtime.ts apps/desktop/src/main/agent-runtime-manager.ts apps/desktop/src/main/index.ts
git commit -m "feat: compact agent context safely"
```

### Task 1.6: Wire context/model controls through IPC and the compact composer

**Files:**
- Modify: `packages/application/src/novel-studio-api.ts`
- Modify: `packages/application/src/ipc-contract.ts`
- Modify: `packages/application/src/desktop-application.ts`
- Modify: `apps/desktop/src/main/agent-run-runtime.ts`
- Modify: `apps/desktop/src/main/ipc-handlers.ts`
- Modify: `apps/desktop/src/main/ipc-allowlist.ts`
- Modify: `apps/desktop/src/preload/api.ts`
- Modify: `apps/desktop/src/preload/index.cts`
- Modify: `apps/desktop/src/renderer/agent-run-bridge.ts`
- Modify: `apps/desktop/src/renderer/agent-conversation-bridge.ts`
- Modify: `apps/desktop/src/renderer/agent-conversation-workspace.ts`
- Create: `packages/ui/src/agent-popover.tsx`
- Create: `packages/ui/src/agent-context-menu.tsx`
- Modify: `packages/ui/src/agent-composer.tsx`
- Modify: `packages/ui/src/workspace-shell-types.ts`
- Modify: `packages/ui/src/styles.css`
- Test: `packages/ui/test/agent-popover.test.tsx`
- Test: `apps/desktop/test/agent-run-ipc.test.ts`
- Test: `apps/desktop/test/agent-run-bridge.test.ts`
- Test: `packages/ui/test/agent-composer.test.tsx`
- Create: `apps/desktop/test/agent-context-runtime.e2e.ts`

- [ ] **Step 1: Write failing IPC and UI tests**

Cover `read/updateAgentRunDraft`, `update/refreshContextDraft`, `previewContextBudget`, and `compactContext` with clone-safe DTOs, allowlist validation, command idempotency, stale revision conflict, and reload. UI tests cover `+` reference menu, removable chips, warning-only context status, source details, manual compact, model profile selector, reasoning selector visibility/default normalization, and locked controls during an active run.

- [ ] **Step 2: Add the typed API**

Extend `agentRuns` with:

```ts
readRunDraft(conversationId: string): Promise<Result<AgentRunDraft, UnifiedError>>;
updateRunDraft(command: UpdateAgentRunDraftCommand): Promise<Result<AgentRunDraft, UnifiedError>>;
readContextDraft(conversationId: string): Promise<Result<ContextDraft, UnifiedError>>;
updateContextDraft(command: UpdateContextDraftCommand): Promise<Result<ContextDraft, UnifiedError>>;
refreshContextDraft(command: RefreshContextDraftCommand): Promise<Result<ContextDraft, UnifiedError>>;
previewContextBudget(command: PreviewContextBudgetCommand): Promise<Result<ContextBudgetSnapshot, UnifiedError>>;
compactContext(command: CompactContextCommand): Promise<AgentRunCommandResult>;
```

Validate every payload in main before calling Application. Preload exposes no raw IPC.

- [ ] **Step 3: Complete the composer toolbar**

Place references/modes/permission on the left and model/reasoning/send on the right. Populate model profiles from the existing Settings snapshot, but write selections to `AgentRunDraft` rather than mutating the project default profile. A model change atomically chooses that profile's supported/default reasoning value and invalidates the old budget preview; reload restores the draft. The context button is quiet in normal state; show only `上下文较多`, `上下文需刷新`, or `上下文压缩失败` proactively. The popover contains exact usage, precision, sources, and compact command.

**Prop-grouping contract (avoid prop explosion — verified against the Stage 5.0 composer):** `AgentComposerProps` is today a flat 8-data + 7-callback object. Do NOT flat-add references, model, reasoning, and context-status (that roughly doubles the surface). Add them as **nested sub-objects** following the existing `AgentRunPanelProps` precedent (which nests `changeSetReview`/`rollbackReview`): `composer.model` (`profiles`, `selectedProfileId`, `onSelect`), `composer.reasoning` (`values`, `current`, `visible`, `onSelect`), `composer.references` (`chips`, `available`, `onAdd`, `onRemove`), `composer.contextStatus` (`state`, `usage`, `precision`, `sources`, `onCompact`, `onRefresh`). Each sub-object stays clone-safe for the DTO forwarders.

**Projection point (correcting the plan's prose):** the composer props do NOT originate in `agent-conversation-bridge.ts`. They are built by `agent-run-bridge.ts::toComposerProps()` from `BridgeState`; `agent-conversation-workspace.ts` and `agent-conversation-bridge.ts` are agnostic forwarders (`view.composer`). So implement the new draft facts in `toComposerProps()`; the two conversation files change only to keep the enlarged (grouped) composer object flowing through as clone-safe DTOs. `toComposerProps` currently does not read `context.settings` — populating the model selector adds that read (the `ModelSettingsPanelProps` snapshot is already on `AgentRunBridgeContext.settings`, and reasoning allowed-values come from `modelDiscovery`, not the profile object).

**Draft dependency and async conversion:** Task 1.6 hard-depends on Task 1.2 (`AgentRunDraft` + `updateAgentRunDraft`) and Task 1.3 (server-authoritative model/reasoning) landing first — `AgentRunDraft` does not exist in renderer code today, and composer edits currently mutate synchronous in-memory `BridgeState`. Converting `toComposerProps` callbacks to async draft-update commands must follow the existing `updateChangeSetSelection` in-flight/optimistic guard as the template; do not leave a synchronous-local-state fallback that diverges from the persisted draft.

**Shared popover primitive:** the Stage 5.0 mode popover's open/close/auto-focus/arrow-roving/Escape logic is hand-rolled inline in `agent-composer.tsx`, and no shared popover component exists anywhere in the repo. Rather than reimplementing that logic in the reference menu, context-status menu, model menu, reasoning menu, and (Task 2.3) permission menu, extract one `agent-popover.tsx` primitive (trigger + `role="dialog"` panel + keyboard/focus contract) in this task and **refactor the existing mode popover to use it too**, so there is one popover behavior, not five divergent ones.

- [ ] **Step 4: Run Stage 5A gate**

Run:

```powershell
npx vitest run packages/agent-engine/test/agent-run-draft.test.ts packages/agent-engine/test/context-draft.test.ts packages/agent-engine/test/context-budget.test.ts packages/agent-engine/test/context-compaction.test.ts packages/application/test/agent-run-draft-session.test.ts packages/application/test/agent-context-session.test.ts apps/desktop/test/agent-run-ipc.test.ts apps/desktop/test/agent-run-bridge.test.ts apps/desktop/test/agent-conversation-bridge.test.ts packages/ui/test/agent-composer.test.tsx
npm run typecheck
npm run build
npx playwright test apps/desktop/test/agent-context-runtime.e2e.ts
```

Expected: PASS for references, model/reasoning changes, budget recalculation, manual/automatic compaction, stale context, protected fact continuity, repeated-compaction monotonicity, reload recovery, and (Task 1.7) writing-vs-general-file guidance/style-pack/initial-context differentiation.

- [ ] **Step 5: Commit**

```powershell
git add packages/application/src/novel-studio-api.ts packages/application/src/ipc-contract.ts packages/application/src/desktop-application.ts apps/desktop/src/main/agent-run-runtime.ts apps/desktop/src/main/ipc-handlers.ts apps/desktop/src/main/ipc-allowlist.ts apps/desktop/src/preload/api.ts apps/desktop/src/preload/index.cts apps/desktop/src/renderer/agent-run-bridge.ts apps/desktop/src/renderer/agent-conversation-bridge.ts apps/desktop/src/renderer/agent-conversation-workspace.ts packages/ui/src/agent-popover.tsx packages/ui/src/agent-context-menu.tsx packages/ui/src/agent-composer.tsx packages/ui/src/workspace-shell-types.ts packages/ui/src/styles.css packages/ui/test/agent-popover.test.tsx apps/desktop/test/agent-run-ipc.test.ts apps/desktop/test/agent-run-bridge.test.ts apps/desktop/test/agent-conversation-bridge.test.ts packages/ui/test/agent-composer.test.tsx apps/desktop/test/agent-context-runtime.e2e.ts
git commit -m "feat: expose stage 5 context controls"
```

### Task 1.7: Make writing and general-file genuinely different context engineering

This task turns the two context modes from "different tool subset" into two distinct context-engineering profiles, matching the Claude Code / Codex principle of minimal preloaded context + mode-specific persistent guidance. It adds no new file tool and no new safety boundary; all changes stay inside context assembly.

**Files:**
- Modify: `packages/application/src/agent-run-session.ts` (initial message assembly and the `systemPrompt` seam)
- Modify: `packages/application/src/agent-run-model-driver.ts` (pass mode-specific `systemPrompt`)
- Modify: `packages/application/src/ai-writing-style-rules.ts` (expose the pack for the Agent path; reuse `formatAiWritingStyleRulesForPrompt`)
- Modify: `packages/agent-engine/src/context-snapshot.ts` (record which guidance/style layer participated, as an auditable source)
- Test: `packages/application/test/agent-run-session.test.ts`
- Test: `packages/application/test/agent-run-model-driver.test.ts`

- [ ] **Step 1: Write failing context-engineering tests**

Assert that a `writing` run and a `general_file` run produce **different** system guidance and different initial context, and that both keep the untrusted-data envelope. Concretely:

```text
writing:      system guidance emphasizes narrative continuity, character consistency,
              and "do not invent unread settings"; the writing style pack is injected
              as persistent guidance; initial context is current chapter/selection +
              Story Bible INDEX (not full-novel bodies).
general_file: system guidance emphasizes faithful text handling, format preservation,
              and minimal edits; NO Story Bible / character / other-chapter bodies are
              injected; initial context is current file + same-directory name summary.
```

Assert the style pack text is present in a writing run's system messages and absent in a general-file run. Assert neither mode injects full non-current chapter bodies at start (bodies come from read tools, not eager preload). Assert the Context Snapshot records the guidance/style layer as an auditable source with a checksum.

- [ ] **Step 2: Fill the mode-specific `systemPrompt` seam**

Today the Agent loop injects only the untrusted-data envelope and restored read summaries — there is **no** mode-specific narrative/faithful-text guidance, and `agent-run-model-driver.ts` exposes an unused `systemPrompt?: string`. Build a versioned, mode-specific guidance string in `agent-run-session.ts` and pass it as `systemPrompt`. The guidance is system-authored and fixed; file content remains data-not-authority. Count its tokens into `systemReserve` (Task 1.4) so the budget stays honest.

- [ ] **Step 3: Inject the writing style pack as persistent guidance (writing mode only)**

Reuse `DEFAULT_AI_WRITING_STYLE_RULE_PACK` and `formatAiWritingStyleRulesForPrompt` from `ai-writing-style-rules.ts` (currently wired only into the legacy AI writing workflow, not the Agent path). Inject the formatted pack into writing-mode runs as persistent guidance — the CLAUDE.md-equivalent for a novel project's conventions. Do not inject it in general-file mode. Record it as a Context Snapshot source so "查看来源" shows it.

- [ ] **Step 4: Make initial context minimal, tool-pulled thereafter**

Align the start-preflight context assembly (Task 1.3) with the design's "写作模式不自动预读整部小说": writing mode seeds only the current chapter/selection + Story Bible index summary; general-file mode seeds only the current file + same-directory name summary. Everything else is pulled by the read tools already registered per mode. This also removes the current eager smell where full chapter bodies enter context at start (already being removed by the `ContextDraft` ref-only approach in Task 1.2).

- [ ] **Step 5: Run focused tests and commit**

```powershell
npx vitest run packages/application/test/agent-run-session.test.ts packages/application/test/agent-run-model-driver.test.ts packages/agent-engine/test/context-snapshot.test.ts
npm run typecheck
```

Expected: PASS; writing and general-file runs differ in guidance, style-pack presence, and initial context, while both preserve the untrusted-data envelope and neither eagerly preloads non-current bodies.

```powershell
git add packages/application/src/agent-run-session.ts packages/application/src/agent-run-model-driver.ts packages/application/src/ai-writing-style-rules.ts packages/agent-engine/src/context-snapshot.ts packages/application/test/agent-run-session.test.ts packages/application/test/agent-run-model-driver.test.ts
git commit -m "feat: differentiate writing and general-file context engineering"
```

## Stage 5B: Permission and Plan Execution Control

### Task 2.1: Generate and bind server-owned Permission Summaries

**Files:**
- Create: `packages/agent-engine/src/permission-summary.ts`
- Create: `packages/agent-engine/test/permission-summary.test.ts`
- Create: `packages/application/src/agent-permission-session.ts`
- Create: `packages/application/test/agent-permission-session.test.ts`
- Modify: `packages/application/src/agent-run-draft-session.ts`
- Modify: `packages/application/src/agent-run-session.ts`
- Modify: `packages/repository/src/agent-run-repository.ts`
- Modify: `packages/agent-engine/src/index.ts`
- Modify: `packages/application/src/index.ts`

- [ ] **Step 1: Write failing permission consistency tests**

Test all operation/context/write-policy combinations, planning read-only behavior, root fingerprint changes, Tool Registry revision changes, renderer capability-array injection, model/file-content attempts to change policy, and automatic-modification acknowledgement.

- [ ] **Step 2: Implement the facts DTO**

```ts
export interface PermissionSummary {
  readonly schemaVersion: "1.0";
  readonly permissionSummaryId: string;
  readonly projectId: string;
  readonly runDraftId: string;
  readonly runId?: string;
  readonly contextMode: AgentContextMode;
  readonly writePolicy: AgentWritePolicy;
  readonly toolRegistryRevision: string;
  readonly rootFingerprint: string;
  readonly readCapabilities: readonly string[];
  readonly proposalCapabilities: readonly string[];
  readonly forbiddenCapabilities: readonly string[];
  readonly checksum: string;
  readonly generatedAt: string;
}
```

Generate arrays from the actual Tool Registry and Path Guard configuration. On start, regenerate and compare every field/checksum. Planning always uses `write_before_confirmation` internally and exposes no auto-modification choice.

- [ ] **Step 3: Persist and bind summary identity**

Store summaries with run-draft facts; add `permission_summary_ready` only after persistence. Bind ID/checksum to the run snapshot. Approval source remains absent until a real Change Set approval.

- [ ] **Step 4: Run focused tests and commit**

Run:

```powershell
npx vitest run packages/agent-engine/test/permission-summary.test.ts packages/application/test/agent-permission-session.test.ts packages/application/test/agent-run-session.test.ts
npm run typecheck
```

Expected: PASS; stale summaries block run creation.

```powershell
git add packages/agent-engine/src/permission-summary.ts packages/agent-engine/src/index.ts packages/agent-engine/test/permission-summary.test.ts packages/application/src/agent-permission-session.ts packages/application/src/agent-run-draft-session.ts packages/application/src/agent-run-session.ts packages/application/src/index.ts packages/application/test/agent-permission-session.test.ts packages/application/test/agent-run-session.test.ts packages/repository/src/agent-run-repository.ts
git commit -m "feat: bind agent runs to permission summaries"
```

### Task 2.2: Track immutable plan execution and deviation decisions

**Files:**
- Create: `packages/agent-engine/src/plan-execution.ts`
- Create: `packages/agent-engine/test/plan-execution.test.ts`
- Create: `packages/application/src/agent-plan-execution-session.ts`
- Create: `packages/application/test/agent-plan-execution-session.test.ts`
- Modify: `packages/application/src/agent-run-session.ts`
- Modify: `packages/repository/src/agent-run-repository.ts`
- Modify: `packages/agent-engine/src/agent-run-types.ts`
- Modify: `packages/agent-engine/src/index.ts`
- Modify: `packages/application/src/index.ts`

- [ ] **Step 1: Write failing plan execution tests**

Cover handoff revision 1, stable step IDs, pending/running/completed/blocked/skipped transitions, verification evidence, minor read-order deviation, new-target material deviation, policy-change deviation, `awaiting_plan_revision`, approve/reject, reload, and terminal summary.

- [ ] **Step 2: Implement immutable records**

```ts
export interface PlanExecutionRecord {
  readonly schemaVersion: "1.0";
  readonly planExecutionId: string;
  readonly runId: string;
  readonly planId: string;
  readonly planRevision: number;
  readonly handoffContextMode: AgentContextMode;
  readonly handoffWritePolicy: AgentWritePolicy;
  readonly revision: number;
  readonly steps: readonly PlanExecutionStep[];
}

export type PlanExecutionStepStatus = "pending" | "running" | "completed" | "blocked" | "skipped";

export interface PlanExecutionStep {
  readonly stepId: string;
  readonly title: string;
  readonly status: PlanExecutionStepStatus;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly verification: readonly string[];
  readonly deviationKind: "none" | "minor" | "material";
  readonly blockedReason: string | null;
  readonly checkpointId: string | null;
  readonly eventSequence: number | null;
}
```

Every transition creates a new record revision. Handoff choices are facts, not deviation. Material deviation emits `plan_revision_requested` and releases the provider connection.

- [ ] **Step 3: Register plan execution as a protected compaction fact**

Extend the context session/compactor integration so an execution run contributes a `plan_execution` fact containing `planExecutionId`, the immutable `PlanExecutionRecord` revision, each step status/verification, and the latest checkpoint/event sequence. During compaction, merge this record by source ID and reject any result whose plan execution revision or completed-step status is lower than the manifest. Add a regression test for a run that compacts after a late plan step: the step remains `completed` (or its newer `blocked/skipped` state), and the execution record never jumps backward. This step modifies `packages/agent-engine/src/context-compaction.ts`, `packages/agent-engine/test/context-compaction.test.ts`, `packages/application/src/agent-context-session.ts`, and `packages/application/test/agent-context-session.test.ts` in addition to the files listed above.

- [ ] **Step 4: Add events and command**

Add `plan_step_started/completed/blocked/skipped`, `plan_deviation_recorded`, and `plan_revision_requested`. Add `decidePlanRevision` with `commandId + expectedRunRevision + requestId + planId/revision + decision`. Duplicate commands return the first receipt.

- [ ] **Step 5: Run focused tests and commit**

Run:

```powershell
npx vitest run packages/agent-engine/test/plan-execution.test.ts packages/application/test/agent-plan-execution-session.test.ts packages/application/test/agent-run-session.test.ts packages/agent-engine/test/plan-artifact.test.ts
npm run typecheck
```

Expected: PASS; plan approval still does not approve Change Set bytes.

```powershell
git add packages/agent-engine/src/plan-execution.ts packages/agent-engine/src/agent-run-types.ts packages/agent-engine/src/index.ts packages/agent-engine/test/plan-execution.test.ts packages/application/src/agent-plan-execution-session.ts packages/application/src/agent-run-session.ts packages/application/src/index.ts packages/application/test/agent-plan-execution-session.test.ts packages/application/test/agent-run-session.test.ts packages/repository/src/agent-run-repository.ts
git commit -m "feat: track plan execution and deviations"
```

### Task 2.3: Add compact permission and plan controls to the conversation

**Files:**
- Modify: `packages/application/src/novel-studio-api.ts`
- Modify: `packages/application/src/ipc-contract.ts`
- Modify: `packages/application/src/desktop-application.ts`
- Modify: `apps/desktop/src/main/agent-run-runtime.ts`
- Modify: `apps/desktop/src/main/ipc-handlers.ts`
- Modify: `apps/desktop/src/main/ipc-allowlist.ts`
- Modify: `apps/desktop/src/preload/api.ts`
- Modify: `apps/desktop/src/preload/index.cts`
- Modify: `apps/desktop/src/renderer/agent-run-bridge.ts`
- Modify: `apps/desktop/src/renderer/agent-conversation-bridge.ts`
- Modify: `apps/desktop/src/renderer/agent-conversation-workspace.ts`
- Modify: `packages/ui/src/agent-composer.tsx`
- Create: `packages/ui/src/agent-permission-menu.tsx`
- Modify: `packages/ui/src/agent-run-panel.tsx`
- Modify: `packages/ui/src/agent-run-timeline.tsx`
- Modify: `packages/ui/src/plan-artifact-review.tsx`
- Modify: `packages/ui/src/styles.css`
- Modify: `packages/ui/src/workspace-shell-types.ts`
- Test: `apps/desktop/test/agent-run-ipc.test.ts`
- Test: `apps/desktop/test/agent-run-bridge.test.ts`
- Test: `apps/desktop/test/agent-conversation-bridge.test.ts`
- Test: `packages/ui/test/agent-composer.test.tsx`
- Test: `packages/ui/test/agent-run-panel.test.tsx`
- Create: `apps/desktop/test/agent-permission-plan.e2e.ts`

- [ ] **Step 1: Write failing UI/IPC tests**

Assert the left permission menu uses `每次修改前确认` / `本次运行自动修改`, planning shows `只读规划`, the summary is closed by default, forbidden capabilities are visible on demand, automatic modification requires risk acknowledgement, and plan steps/deviation cards reflect persisted IDs. Permission state is projected through `AgentConversationViewProps.composer`; `AgentRunPanelProps` does not regain mode, permission, send, or stop ownership.

- [ ] **Step 2: Wire typed commands and bridge projection**

Expose `readPermissionSummary` and `decidePlanRevision`. Compose the permission and plan sessions in `agent-run-runtime.ts` with the canonical root fingerprint and Tool Registry revision. Map plan events by `planExecutionId + stepId`; never infer completion from assistant prose. Keep Change Set approval separate.

- [ ] **Step 3: Implement the compact UI**

Permission details open from the composer only, using the shared `agent-popover.tsx` primitive extracted in Task 1.6 (do not reimplement open/close/focus/Escape). The permission menu largely relocates controls that already exist verbatim in the Stage 5.0 composer (`每次修改前确认` / `本次运行自动修改` write-policy select and the `只读规划` fallback), plus permission-summary projection. Preflight failures appear inline. Active plan step stays expanded; completed steps collapse. A material deviation card shows original plan, discovery, proposed revision, affected steps, approve, and reject.

- [ ] **Step 4: Run Stage 5B gate**

Run:

```powershell
npx vitest run packages/agent-engine/test/permission-summary.test.ts packages/agent-engine/test/plan-execution.test.ts packages/application/test/agent-permission-session.test.ts packages/application/test/agent-plan-execution-session.test.ts apps/desktop/test/agent-run-ipc.test.ts apps/desktop/test/agent-run-bridge.test.ts apps/desktop/test/agent-conversation-bridge.test.ts packages/ui/test/agent-composer.test.tsx packages/ui/test/agent-run-panel.test.tsx
npm run typecheck
npm run build
npx playwright test apps/desktop/test/agent-permission-plan.e2e.ts apps/desktop/test/agent-write.e2e.ts apps/desktop/test/agent-run-autonomy.e2e.ts
```

Expected: PASS; planning remains read-only and automatic modification uses the existing Version Group path.

- [ ] **Step 5: Commit**

```powershell
git add packages/application/src/novel-studio-api.ts packages/application/src/ipc-contract.ts packages/application/src/desktop-application.ts apps/desktop/src/main/agent-run-runtime.ts apps/desktop/src/main/ipc-handlers.ts apps/desktop/src/main/ipc-allowlist.ts apps/desktop/src/preload/api.ts apps/desktop/src/preload/index.cts apps/desktop/src/renderer/agent-run-bridge.ts apps/desktop/src/renderer/agent-conversation-bridge.ts apps/desktop/src/renderer/agent-conversation-workspace.ts packages/ui/src/agent-composer.tsx packages/ui/src/agent-permission-menu.tsx packages/ui/src/agent-run-panel.tsx packages/ui/src/agent-run-timeline.tsx packages/ui/src/plan-artifact-review.tsx packages/ui/src/workspace-shell-types.ts packages/ui/src/styles.css apps/desktop/test/agent-run-ipc.test.ts apps/desktop/test/agent-run-bridge.test.ts apps/desktop/test/agent-conversation-bridge.test.ts packages/ui/test/agent-composer.test.tsx packages/ui/test/agent-run-panel.test.tsx apps/desktop/test/agent-permission-plan.e2e.ts
git commit -m "feat: add compact permission and plan controls"
```

## Stage 5C: Diagnostics and Usage

### Task 3.1: Persist normalized errors and retry explicit targets

**Files:**
- Create: `packages/agent-engine/src/agent-run-error.ts`
- Modify: `packages/agent-engine/src/index.ts`
- Create: `packages/agent-engine/test/agent-run-error.test.ts`
- Create: `packages/application/src/agent-diagnostics-session.ts`
- Create: `packages/application/test/agent-diagnostics-session.test.ts`
- Modify: `packages/application/src/agent-run-session.ts`
- Test: `packages/application/test/agent-run-session.test.ts`
- Modify: `packages/repository/src/agent-run-repository.ts`
- Modify: `packages/application/src/novel-studio-api.ts`
- Modify: `packages/application/src/ipc-contract.ts`
- Modify: `packages/application/src/desktop-application.ts`
- Modify: `packages/application/src/index.ts`
- Modify: `apps/desktop/src/main/agent-run-runtime.ts`
- Modify: `apps/desktop/src/main/ipc-handlers.ts`
- Modify: `apps/desktop/src/main/ipc-allowlist.ts`
- Modify: `apps/desktop/src/preload/api.ts`
- Modify: `apps/desktop/src/preload/index.cts`
- Modify: `apps/desktop/src/renderer/agent-run-bridge.ts`
- Create: `packages/ui/src/agent-error-card.tsx`
- Modify: `packages/ui/src/agent-run-panel.tsx`
- Modify: `packages/ui/src/index.ts`
- Test: `packages/ui/test/agent-run-panel.test.tsx`
- Test: `apps/desktop/test/agent-run-ipc.test.ts`
- Test: `apps/desktop/test/agent-run-bridge.test.ts`
- Create: `apps/desktop/test/agent-diagnostics.e2e.ts`

- [ ] **Step 1: Write failing diagnostic tests**

Cover preflight errors with `runDraftId`, run errors with `runId`, 8 KiB redacted-detail limit, no persisted stack, provider disconnect, context stale, base conflict, partial failure journal reference, renderer-safe display fallback, reload, duplicate retry, stale target, and legacy `retryStep` ambiguity.

- [ ] **Step 2: Implement the normalized record**

```ts
export interface AgentRunErrorRecord {
  readonly schemaVersion: "1.0";
  readonly errorId: string;
  readonly projectId: string;
  readonly runId?: string;
  readonly runDraftId?: string;
  readonly sequence?: number;
  readonly checkpointId?: string;
  readonly toolCallId?: string;
  readonly planStepId?: string;
  readonly category: string;
  readonly code: string;
  readonly message: string;
  readonly recoverability: UnifiedError["recoverability"];
  readonly suggestedActions: readonly string[];
  readonly provider?: string;
  readonly model?: string;
  readonly redactedDetail: JsonObject;
  readonly recoveryState: AgentRunSnapshotV11["recoveryState"];
  readonly createdAt: string;
}
```

Normalize once at the source boundary. Store run errors under the run directory and preflight errors under `history/agent-diagnostics` with count/size retention limits.

- [ ] **Step 3: Replace ambiguous retry with explicit target**

```ts
export interface RetryRunTargetCommand {
  readonly runId: string;
  readonly projectId: string;
  readonly commandId: string;
  readonly expectedRunRevision: number;
  readonly errorId: string;
  readonly target: {
    readonly kind: "model_round" | "tool_call" | "checkpoint" | "plan_step";
    readonly id: string;
  };
}
```

Keep `retryStep` for one compatibility cycle; map only when one target is unambiguous, otherwise reject with refresh guidance.

- [ ] **Step 4: Render inline errors**

Show message, impact, and actions by default. Put error ID, run ID, provider/model, sequence, a `复制错误 ID` button, and redacted detail in a closed `<details>` region. Do not add a permanent diagnostics drawer. The clipboard action copies only the stable error ID from the already-redacted renderer DTO.

- [ ] **Step 5: Add real Electron diagnostics coverage**

Inject provider disconnect, retryable tool error, context stale, and partial-failure reference cases. Through Playwright expand details, copy the error ID, retry/resume the explicit target, reload, and assert the same ID/recovery state returns. Assert the default conversation contains no permanent token, cost, run-history, or diagnostics panel.

- [ ] **Step 6: Run focused tests and commit**

Run:

```powershell
npx vitest run packages/agent-engine/test/agent-run-error.test.ts packages/application/test/agent-diagnostics-session.test.ts packages/application/test/agent-run-session.test.ts apps/desktop/test/agent-run-ipc.test.ts apps/desktop/test/agent-run-bridge.test.ts packages/ui/test/agent-run-panel.test.tsx
npm run typecheck
npm run build
npx playwright test apps/desktop/test/agent-diagnostics.e2e.ts
```

Expected: PASS; error rendering cannot leave the run indefinitely active.

```powershell
git add packages/agent-engine/src/agent-run-error.ts packages/agent-engine/src/index.ts packages/agent-engine/test/agent-run-error.test.ts packages/application/src/agent-diagnostics-session.ts packages/application/src/agent-run-session.ts packages/application/src/novel-studio-api.ts packages/application/src/ipc-contract.ts packages/application/src/desktop-application.ts packages/application/src/index.ts packages/application/test/agent-diagnostics-session.test.ts packages/application/test/agent-run-session.test.ts packages/repository/src/agent-run-repository.ts apps/desktop/src/main/agent-run-runtime.ts apps/desktop/src/main/ipc-handlers.ts apps/desktop/src/main/ipc-allowlist.ts apps/desktop/src/preload/api.ts apps/desktop/src/preload/index.cts apps/desktop/src/renderer/agent-run-bridge.ts packages/ui/src/agent-error-card.tsx packages/ui/src/agent-run-panel.tsx packages/ui/src/index.ts packages/ui/test/agent-run-panel.test.tsx apps/desktop/test/agent-run-ipc.test.ts apps/desktop/test/agent-run-bridge.test.ts apps/desktop/test/agent-diagnostics.e2e.ts
git commit -m "feat: add recoverable agent diagnostics"
```

### Task 3.2: Record redacted per-round usage and pricing snapshots

**Files:**
- Create: `packages/application/src/agent-usage-types.ts`
- Create: `packages/application/src/agent-usage-session.ts`
- Create: `packages/application/test/agent-usage-session.test.ts`
- Modify: `packages/agent-engine/src/agent-usage-record.ts`
- Modify: `packages/agent-engine/test/agent-usage-record.test.ts`
- Modify: `packages/repository/src/agent-usage-repository.ts`
- Modify: `packages/repository/test/agent-usage-repository.test.ts`
- Create: `packages/application/src/agent-pricing-registry.ts`
- Create: `packages/application/test/agent-pricing-registry.test.ts`
- Modify: `packages/application/src/agent-run-model-driver.ts`
- Modify: `packages/application/src/agent-run-session.ts`
- Test: `packages/application/test/agent-run-model-driver.test.ts`
- Test: `packages/application/test/agent-run-session.test.ts`
- Modify: `packages/agent-engine/src/agent-run-types.ts`
- Modify: `packages/agent-engine/src/index.ts`
- Modify: `packages/llm-adapter/src/types.ts`
- Modify: `apps/desktop/src/main/agent-run-runtime.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `packages/repository/src/index.ts`
- Modify: `packages/application/src/index.ts`

`agent-usage-types.ts` owns only query/filter/report/clear-command DTOs. The persisted `AgentUsageRecord` remains exclusively in `packages/agent-engine/src/agent-usage-record.ts`.

Define the query/report contract once in `agent-usage-types.ts`; Task 3.3 exposes these exact types through IPC and renders them:

```ts
import type { LlmCost } from "@novel-studio/llm-adapter";

export interface AgentUsageDateRange {
  readonly fromLocalDate: string;
  readonly toLocalDate: string;
}

export interface AgentUsageQuery {
  readonly range: AgentUsageDateRange;
  readonly provider?: string;
  readonly model?: string;
  readonly projectId?: string;
  readonly detailLocalDate?: string;
}

export interface AgentUsageCostTotal {
  readonly currency: string;
  readonly actualAmount: number;
  readonly estimatedAmount: number;
}

export interface AgentUsageDailyBucket {
  readonly localDate: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedTokens: number;
  readonly reasoningTokens: number;
  readonly totalTokens: number;
  readonly costs: readonly AgentUsageCostTotal[];
  readonly hasUnknownCost: boolean;
}

export interface AgentUsageRunSummary {
  readonly usageId: string;
  readonly runId: string;
  readonly conversationId: string;
  readonly projectId: string;
  readonly provider: string;
  readonly model: string;
  readonly totalTokens: number;
  readonly usageStatus: "actual" | "estimated" | "missing";
  readonly cost: LlmCost;
  readonly timestamp: string;
}

export interface AgentUsageReport {
  readonly query: AgentUsageQuery;
  readonly days: readonly AgentUsageDailyBucket[];
  readonly runs: readonly AgentUsageRunSummary[];
  readonly generatedAt: string;
}

export interface ClearAgentUsageCommand {
  readonly commandId: string;
  readonly range: AgentUsageDateRange;
}
```

`runs` is empty unless `detailLocalDate` is present. It never contains the user request, prompt, document text, path, provider frame, or hidden reasoning. Validate ISO local-date strings and require a bounded inclusive range before Repository access.

- [ ] **Step 1: Write failing usage tests**

Cover actual/estimated/missing usage, optional cached/reasoning tokens, one final record per `runId:roundId:finalSequence`, partial usage not persisted, compaction usage, pricing version snapshot, unknown price, separate currencies, secret/body redaction, 30-day detail retention, 365-day aggregate retention, localDate/timezone/UTC offset, DST duplicate hour, and a pricing registry update that does not rewrite old records.

- [ ] **Step 2: Extend usage without breaking old providers**

Add optional fields only:

```ts
export interface LlmUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly cachedTokens?: number;
  readonly reasoningTokens?: number;
  readonly usageStatus: LlmUsageStatus;
  readonly cost: LlmCost;
}
```

Do not derive missing cached/reasoning tokens from total.

- [ ] **Step 3: Implement the versioned pricing registry**

Define `AgentPricingRegistry` as an injected, versioned table keyed by exact provider/model with input/output/cached/reasoning per-million prices and currency. Reject negative/non-finite prices and ambiguous wildcard matches. When provider cost is absent, snapshot `pricingVersion` and the exact matched unit prices into the usage record before calculating estimated cost. No match yields `cost.status = "unknown"`; registry updates never recalculate stored records.

- [ ] **Step 4: Enforce pricing and retention on the existing immutable record**

Keep the `AgentUsageRecord` and `AgentUsageUnitPriceSnapshot` defined in Task 1.5. When provider cost is actual, preserve it and leave registry-derived fields null unless the provider supplied an exact price snapshot. When cost is estimated, require a matching `pricingVersion`, non-null `unitPrices`, matching currency, and a reproducible calculation from the stored token fields. Unknown cost uses amount `0`, an empty currency, null pricing fields, and status `unknown`.

Extend `AgentUsageFileRepository` with bounded detail/aggregate query and clear operations. Persist under the Electron user-data root, not project `history`; store stable project ID only. Retain details for 30 days and daily aggregates for 365 days using the record's stored `localDate/timezone/utcOffsetMinutes`, so DST changes do not regroup historical records. Registry updates and retention never mutate surviving records.

- [ ] **Step 5: Forward usage through Agent rounds**

Extend `AgentModelStreamEvent` with usage. Emit `usage_updated` for partial UI aggregation, then write exactly one final usage record when the round ends. Idempotent replay returns the existing record.

- [ ] **Step 6: Run focused tests and commit**

Run:

```powershell
npx vitest run packages/llm-adapter/test packages/agent-engine/test/agent-usage-record.test.ts packages/application/test/agent-pricing-registry.test.ts packages/application/test/agent-usage-session.test.ts packages/repository/test/agent-usage-repository.test.ts packages/application/test/agent-run-model-driver.test.ts packages/application/test/agent-run-session.test.ts
npm run typecheck
```

Expected: PASS; no sensitive content exists in serialized usage fixtures.

```powershell
git add packages/llm-adapter/src/types.ts packages/agent-engine/src/agent-run-types.ts packages/agent-engine/src/agent-usage-record.ts packages/agent-engine/src/index.ts packages/agent-engine/test/agent-usage-record.test.ts packages/application/src/agent-pricing-registry.ts packages/application/src/agent-usage-types.ts packages/application/src/agent-usage-session.ts packages/application/src/agent-run-model-driver.ts packages/application/src/agent-run-session.ts packages/application/src/index.ts packages/application/test/agent-pricing-registry.test.ts packages/application/test/agent-usage-session.test.ts packages/application/test/agent-run-model-driver.test.ts packages/application/test/agent-run-session.test.ts packages/repository/src/agent-usage-repository.ts packages/repository/src/index.ts packages/repository/test/agent-usage-repository.test.ts apps/desktop/src/main/agent-run-runtime.ts apps/desktop/src/main/index.ts
git commit -m "feat: persist redacted agent usage"
```

### Task 3.3: Add settings-level daily usage analytics

**Files:**
- Modify: `packages/application/src/agent-usage-session.ts`
- Modify: `packages/application/src/novel-studio-api.ts`
- Modify: `packages/application/src/desktop-application.ts`
- Modify: `packages/application/src/ipc-contract.ts`
- Modify: `apps/desktop/src/main/ipc-handlers.ts`
- Modify: `apps/desktop/src/main/ipc-allowlist.ts`
- Modify: `apps/desktop/src/preload/api.ts`
- Modify: `apps/desktop/src/preload/index.cts`
- Modify: `apps/desktop/src/renderer/settings-bridge.ts`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `packages/ui/src/settings-panel-tabs.tsx`
- Modify: `packages/ui/src/model-settings-panel.tsx`
- Create: `packages/ui/src/agent-usage-settings.tsx`
- Modify: `packages/ui/src/styles.css`
- Test: `packages/application/test/agent-usage-session.test.ts`
- Test: `apps/desktop/test/settings-bridge.test.ts`
- Test: `packages/ui/test/settings-and-studio.test.tsx`
- Create: `apps/desktop/test/agent-usage-settings.e2e.ts`

- [ ] **Step 1: Write failing aggregation and UI tests**

Test today/7/30-day ranges, provider/model/project filters, input/output/cached series, empty data, estimated cost, unknown cost, separate currencies, day run list without request or document content, clearing usage only, and retention of AgentRun/Change Set/Version Group/journal data.

- [ ] **Step 2: Add query APIs**

```ts
listAgentUsage(query: AgentUsageQuery): Promise<Result<AgentUsageReport, UnifiedError>>;
clearAgentUsage(command: ClearAgentUsageCommand): Promise<Result<AgentUsageReport, UnifiedError>>;
```

`ClearAgentUsageCommand` carries `commandId` and a bounded date range. It cannot address project history paths.

- [ ] **Step 3: Add the `Agent 用量` settings section**

Extend `SettingsPanelSection` with `usage`. Render a restrained work-focused chart using CSS/SVG only if the existing UI has no chart dependency: stable plot dimensions, accessible table fallback, no decorative cards, and separate actual/estimated/unknown labels. This view is the only normal UI location for token and cost trends.

- [ ] **Step 4: Run focused and Electron tests**

Run:

```powershell
npx vitest run packages/application/test/agent-usage-session.test.ts packages/repository/test/agent-usage-repository.test.ts apps/desktop/test/settings-bridge.test.ts packages/ui/test/settings-and-studio.test.tsx
npm run typecheck
npm run build
npx playwright test apps/desktop/test/agent-usage-settings.e2e.ts
```

Expected: PASS for empty/actual/estimated/unknown/multi-currency data and clearing usage without deleting recovery facts.

- [ ] **Step 5: Commit**

```powershell
git add packages/application/src/agent-usage-session.ts packages/application/src/novel-studio-api.ts packages/application/src/desktop-application.ts packages/application/src/ipc-contract.ts apps/desktop/src/main/ipc-handlers.ts apps/desktop/src/main/ipc-allowlist.ts apps/desktop/src/preload/api.ts apps/desktop/src/preload/index.cts apps/desktop/src/renderer/settings-bridge.ts apps/desktop/src/renderer/App.tsx packages/ui/src/settings-panel-tabs.tsx packages/ui/src/model-settings-panel.tsx packages/ui/src/agent-usage-settings.tsx packages/ui/src/styles.css packages/application/test/agent-usage-session.test.ts apps/desktop/test/settings-bridge.test.ts packages/ui/test/settings-and-studio.test.tsx apps/desktop/test/agent-usage-settings.e2e.ts
git commit -m "feat: add agent usage settings"
```

### Task 3.4: Run the final Stage 5 acceptance and release gate

**Files:**
- Modify: `apps/desktop/test/m98-v1-ship-readiness.test.ts`
- Modify: `scripts/package-check.mjs`
- Modify: `docs/superpowers/plans/2026-07-15-agentic-writing-loop-stage-5.md` only to mark completed checkboxes during execution

- [x] **Step 1: Add release readiness assertions**

Require the Stage 5.0 single-composer suite, v1.0/v1.1 contract suite, 5A context suite, 5B permission/plan suite, 5C diagnostics/usage suite, and all existing Agent write/undo/conversation E2Es. Assert package output contains no API keys, prompt bodies, file bodies, or raw provider frames in usage/diagnostic fixtures.

- [x] **Step 2: Run the full static and unit gate**

Run:

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run package:check
```

Expected: every command exits `0`.

- [x] **Step 3: Run all Agent Electron E2E tests**

Run:

```powershell
npx playwright test apps/desktop/test/agent-conversations.e2e.ts apps/desktop/test/agent-run.e2e.ts apps/desktop/test/agent-write.e2e.ts apps/desktop/test/agent-run-autonomy.e2e.ts apps/desktop/test/agent-context-runtime.e2e.ts apps/desktop/test/agent-permission-plan.e2e.ts apps/desktop/test/agent-diagnostics.e2e.ts apps/desktop/test/agent-usage-settings.e2e.ts
```

Expected: PASS with no page errors, one composer, one assistant projection, and all write/undo safety assertions intact.

- [x] **Step 4: Repeat the complete Agent Electron set once**

Run:

```powershell
npx playwright test apps/desktop/test/agent-conversations.e2e.ts apps/desktop/test/agent-run.e2e.ts apps/desktop/test/agent-write.e2e.ts apps/desktop/test/agent-run-autonomy.e2e.ts apps/desktop/test/agent-context-runtime.e2e.ts apps/desktop/test/agent-permission-plan.e2e.ts apps/desktop/test/agent-diagnostics.e2e.ts apps/desktop/test/agent-usage-settings.e2e.ts
```

Expected: PASS again, detecting no event-order or reload timing instability.

- [x] **Step 5: Commit the release gate**

```powershell
git add apps/desktop/test/m98-v1-ship-readiness.test.ts scripts/package-check.mjs docs/superpowers/plans/2026-07-15-agentic-writing-loop-stage-5.md
git commit -m "test: complete stage 5 acceptance gate"
```

## Final Plan Self-Review

- [x] Verify every Stage 5 v1.3 requirement maps to a task: one right-side composer, one lower-left grouped mode popover, no duplicate assistant/run projection or nested chat surface, model/reasoning placement, explicit refs, context modes, provider-aware budget, manifest-backed three-stage compaction, permission checksum, existing Plan Mode regression, plan execution/deviation, inline recoverable errors, redacted usage, and settings daily analytics.
- [x] Verify the pre-implementation decisions are captured and non-contradictory: `AgentRunSnapshotV10` alias/rename + Application-boundary normalize-before-write (Task 1.1); `ResolvedAgentRunStartInput` internal type + `decidePlan` server-side handoff migration (Task 1.3); conversation-repository ownership of run/context drafts with its path guard (Task 1.2); cross-repository, Application-orchestrated compaction commit with pointer-last marker (Task 1.5); grouped composer sub-objects + shared `agent-popover.tsx` primitive (Tasks 1.6/2.3); 5A `writeFinal` maintains the daily aggregate (Task 1.5).
- [x] Verify Task 1.7 makes writing vs general-file two real context-engineering profiles (mode-specific guidance, writing style-pack injection, minimal tool-pulled initial context) without adding a search tool or a user-writable conventions file — both explicitly deferred to P1.
- [x] Search this plan for `TBD`, `TODO`, `implement later`, `fill in`, and vague “add tests” language; none may remain.
- [x] Verify type names remain consistent across tasks: `AgentRunDraft`, `AgentReasoningEffort`, `ContextDraft`, `ContextBudgetSnapshot`, `ContextCompactionRevision`, `PermissionSummary`, `PlanExecutionRecord`, `AgentRunErrorRecord`, `AgentUsageUnitPriceSnapshot`, `AgentUsageRecord`, and `RetryRunTargetCommand`.
- [x] Verify no task adds Shell, Git, MCP, browser, network research, plugins, multi-Agent execution, or another file-write path.
- [x] Verify every UI task preserves keyboard operation, one composer, narrow-panel layout, and Playwright-only Electron acceptance.
- [x] Verify every real write and undo test still runs through the existing Change Set, Version Group, transaction journal, conflict, and recovery implementation.
