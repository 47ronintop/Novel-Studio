# Unified Workbench and Project Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one safe Novel Studio shell with top-level creative/engineering workbench selection, a focused creative Navigator, a formal engineering file workspace, and exactly one right-side Agent without losing any existing writing, Studio, Change Set, Version Group, journal, recovery, or undo capability.

**Architecture:** Introduce a renderer-safe shared `WorkspaceContextDto` plus a main/Application-only `WorkspaceActivationContext` that owns `contentRoot` and `stateRoot`. Move directory traversal and text-file reads/writes from Electron handlers into Repository implementations, keep Desktop responsible for native pickers, IPC conversion, and dependency composition, and bind Agent reads/writes to separate content/state roots without exposing `stateRoot` through IPC. Renderer components emit semantic navigation intents through one coordinator; the existing Stage 5 `AgentComposer` remains the only composer, while Plan/Diff/Change Set/Rollback/Recovery reviews stay in the central editor area.

**Tech Stack:** TypeScript strict mode, React 19, Electron main/preload/renderer, existing Agent Engine/Application/Repository layering, CodeMirror 6, Vitest 4, jsdom, Playwright Electron E2E, CSS, and existing `Result`/`UnifiedError` contracts.

---

## Scope Lock and Current-Feature Decisions

Implement the approved design in `docs/superpowers/specs/2026-07-18-unified-workbench-project-navigation-design.md` from baseline `25a9006f41ee7cd8e836885314bfb6a5d2b68021`.

| Capability                                                                                                                  | Decision in this plan                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stage 5 `AgentComposer`, Plan/Act, `writing/general_file`, approval, model, reasoning, references                           | Keep the existing contracts and behavior; only add workspace-aware availability and move the surface                                                        |
| Change Set, Approval Gate, Version Group, transaction journal, recovery, rollback, undo                                     | Preserve unchanged semantics and run their existing regression suites at the final gate                                                                     |
| Current ordinary-folder tree and `PlainFileEditor`                                                                          | Migrate into formal Engineering Application/Repository boundaries; do not delete                                                                            |
| Current project creation inside a selected folder                                                                           | Replace with parent-directory + unique child-directory creation; remove in-place initialization                                                             |
| Current nine-section project Navigator                                                                                      | Replace visually with writing/story tabs while preserving chapter and Story Bible repositories and actions                                                  |
| Current `AiWritingAssistantPanel`                                                                                           | Remove the duplicate composer only after selection preview, style review, Diff/Rollback/Undo, diagnostics, and run history still have reachable projections |
| Recent workspaces, engineering full-text search, engineering Studio, file create/delete/move/rename, controlled shell tools | Necessary follow-ups recorded at the end of this plan; do not add fake or empty permanent entries in this implementation                                    |
| LSP, Git UI, debugger, terminal emulator                                                                                    | Not part of this implementation plan; require separate product and security designs                                                                         |

Execution constraints:

- Use strict TDD for every task: add a focused failing test, run it and record the expected failure, add the minimum implementation, then rerun the focused suite.
- Only one implementation agent may write the shared worktree at a time. Read-only specification and quality reviews may run in parallel with explicit time limits.
- Preserve unrelated user changes in a dirty worktree. Do not use destructive Git commands.
- On Windows, if Vitest or Playwright fails with `spawn EPERM`, rerun the exact same command outside the sandbox after approval.
- Full Vitest verification always uses `--no-file-parallelism`.

## Delivery Gates

1. **Gate A — State and storage boundaries:** Tasks 1-3 establish workspace state, engineering repositories, app-local state roots, and split Agent roots without visual redesign.
2. **Gate B — Safe lifecycle:** Tasks 4-5 replace in-place initialization and make open/create/runtime binding atomic.
3. **Gate C — Navigation and workbenches:** Tasks 6-8 replace the Navigator, centralize navigation, and expose the top workbench selector plus engineering Explorer.
4. **Gate D — One Agent surface:** Task 9 removes duplicate AI entry points only after capability reachability tests pass.
5. **Gate E — Product-quality closeout:** Task 10 completes settings/layout/accessibility work and runs every safety and release gate on the final worktree.

## File Ownership Map

**Shared state and preferences**

- Create `packages/shared/src/workspace-context.ts` as the single source for `WorkbenchMode`, `CreativeNavigatorMode`, renderer-safe capabilities, and `WorkspaceContextDto`.
- Create `packages/application/src/workspace-activation-context.ts` for main/Application-only roots and conversion to `WorkspaceContextDto`; this type is never added to `NovelStudioApi`.
- Modify `packages/shared/src/user-preferences.ts` to persist workbench and Navigator state while retaining legacy-read compatibility.
- Modify `packages/application/src/user-preferences-session.ts`, `desktop-application.ts`, and `apps/desktop/src/renderer/app-shell-support.ts` to consume shared defaults instead of maintaining three divergent arrays.

**Engineering workspace and app-local state**

- Create `packages/application/src/engineering-workspace-session.ts` for workspace orchestration, conflict-aware text saves, and DTOs.
- Create `packages/repository/src/engineering-workspace-repository.ts` for canonical path guards, bounded traversal, UTF-8 reads, checksum conflict detection, and atomic saves.
- Create `packages/repository/src/workspace-state-repository.ts` for stable hashed workspace IDs and app-local `stateRoot` resolution.
- Modify `apps/desktop/src/main/agent-run-runtime.ts` and `agent-runtime-manager.ts` so content reads/writes use `contentRoot` while Agent metadata, history, journal, recovery, and lock files use `stateRoot`.

**Project lifecycle and Desktop integration**

- Create `packages/repository/src/project-creation-repository.ts` for fail-closed parent/child project creation.
- Create `apps/desktop/src/main/workspace-activation.ts` for prepared, atomic Application + Agent runtime activation.
- Modify Application API/IPC contracts, Electron handlers/preload, and renderer bridges to expose explicit creative-open, engineering-open, and creative-create operations.

**Renderer navigation and UI**

- Create `apps/desktop/src/renderer/workspace-navigation.ts` as the only cross-surface navigation coordinator.
- Create `apps/desktop/src/renderer/engineering-workspace-bridge.ts` for formal engineering tree/editor state.
- Create `packages/ui/src/creative-workspace-navigator.tsx`, `engineering-workspace-navigator.tsx`, and `workbench-switcher.tsx` as focused UI units.
- Keep `packages/ui/src/workspace-navigator.tsx` as a thin context switcher and `workspace-shell.tsx` as the layout owner.
- Create `packages/ui/src/agent-conversation-history-drawer.tsx` to reuse the existing Conversation list/search/archive behavior inside the one right panel.

## Task 1: Establish Workspace Context and One Preference Default Source

**Files:**

- Create: `packages/shared/src/workspace-context.ts`
- Create: `packages/application/src/workspace-activation-context.ts`
- Modify: `packages/shared/src/user-preferences.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/application/src/user-preferences-session.ts`
- Modify: `packages/application/src/desktop-application.ts`
- Modify: `packages/application/src/index.ts`
- Modify: `apps/desktop/src/renderer/app-shell-support.ts`
- Test: `packages/application/test/user-preferences-session.test.ts`
- Test: `packages/application/test/desktop-application.test.ts`
- Test: `apps/desktop/test/app-shell-support.test.ts`

- [ ] **Step 1: Write failing state and migration tests**

Add tests that require all three defaults to agree, preserve explicit empty engineering expansion state, normalize unknown modes, and force an engineering workspace away from creative mode:

```ts
expect(createDefaultUserPreferences().shell).toMatchObject({
  workbenchMode: "creative",
  creativeNavigatorMode: "writing",
  engineeringExpandedPathIds: [],
  inspectorCollapsed: false
});

const saved = await session.save({
  shell: {
    engineeringExpandedPathIds: []
  }
});
expect(saved).toMatchObject({
  ok: true,
  value: { shell: { engineeringExpandedPathIds: [] } }
});

expect(
  resolveWorkbenchModeForContext("creative", {
    kind: "engineeringWorkspace",
    workspaceId: "ws_01",
    displayName: "example",
    capabilities: ["engineeringWorkbench", "generalFileContext"]
  })
).toBe("engineering");

const dto = toWorkspaceContextDto({
  kind: "engineeringWorkspace",
  workspaceId: "ws_01",
  displayName: "example",
  contentRoot: "D:/code/example",
  stateRoot: "C:/user-data/workspaces/ws_01",
  capabilities: ["engineeringWorkbench", "generalFileContext"]
});
expect(dto).not.toHaveProperty("contentRoot");
expect(dto).not.toHaveProperty("stateRoot");
```

Add a legacy preference fixture with no new fields and `inspectorCollapsed: true`; assert it migrates to a visible Agent panel because the old renderer never honored that field. Add a modern fixture with `workbenchMode` present and assert an explicit `inspectorCollapsed: true` remains true.

- [ ] **Step 2: Run the focused tests and verify the expected red state**

Run:

```powershell
npm test -- packages/application/test/user-preferences-session.test.ts packages/application/test/desktop-application.test.ts apps/desktop/test/app-shell-support.test.ts
```

Expected: FAIL because the new workspace types and preference fields do not exist, explicit empty arrays are currently replaced by the legacy nine-section defaults, and renderer/application defaults disagree.

- [ ] **Step 3: Add the shared workspace contracts**

Create `packages/shared/src/workspace-context.ts` with these exact public types and helper:

```ts
export type WorkbenchMode = "creative" | "engineering";
export type CreativeNavigatorMode = "writing" | "story";

export type WorkspaceCapability =
  | "creativeWorkbench"
  | "engineeringWorkbench"
  | "writingContext"
  | "generalFileContext"
  | "creativeSearch"
  | "creativeStudio";

export type WorkspaceContextDto =
  | { readonly kind: "none" }
  | {
      readonly kind: "creativeProject";
      readonly workspaceId: string;
      readonly projectId: string;
      readonly displayName: string;
      readonly capabilities: readonly WorkspaceCapability[];
    }
  | {
      readonly kind: "engineeringWorkspace";
      readonly workspaceId: string;
      readonly displayName: string;
      readonly capabilities: readonly WorkspaceCapability[];
    };

export const EMPTY_WORKSPACE_CONTEXT: WorkspaceContextDto = { kind: "none" };

export function resolveWorkbenchModeForContext(
  preferred: WorkbenchMode,
  context: WorkspaceContextDto
): WorkbenchMode {
  return context.kind === "engineeringWorkspace" ? "engineering" : preferred;
}
```

Export the DTO types and helper from `packages/shared/src/index.ts` and re-export them from `packages/application/src/index.ts` for renderer consumers. Create `packages/application/src/workspace-activation-context.ts` with the internal contract:

```ts
export type WorkspaceActivationContext =
  | {
      readonly kind: "creativeProject";
      readonly workspaceId: string;
      readonly projectId: string;
      readonly displayName: string;
      readonly contentRoot: string;
      readonly stateRoot: string;
      readonly capabilities: readonly WorkspaceCapability[];
    }
  | {
      readonly kind: "engineeringWorkspace";
      readonly workspaceId: string;
      readonly displayName: string;
      readonly contentRoot: string;
      readonly stateRoot: string;
      readonly capabilities: readonly WorkspaceCapability[];
    };

export function toWorkspaceContextDto(context: WorkspaceActivationContext): WorkspaceContextDto {
  return context.kind === "creativeProject"
    ? {
        kind: context.kind,
        workspaceId: context.workspaceId,
        projectId: context.projectId,
        displayName: context.displayName,
        capabilities: context.capabilities
      }
    : {
        kind: context.kind,
        workspaceId: context.workspaceId,
        displayName: context.displayName,
        capabilities: context.capabilities
      };
}
```

`WorkspaceActivationContext` may be exported from the Application package for Desktop main composition, but it must not appear in `NovelStudioApi`, preload declarations, renderer props, persisted preferences, or `DesktopShellState`.

- [ ] **Step 4: Define and normalize one shell preference shape**

Extend `UserShellPreferences` and add one exported default constant in `packages/shared/src/user-preferences.ts`:

```ts
export interface UserShellPreferences {
  readonly workbenchMode: WorkbenchMode;
  readonly creativeNavigatorMode: CreativeNavigatorMode;
  readonly engineeringExpandedPathIds: readonly string[];
  readonly navigatorCollapsed: boolean;
  readonly navigatorExpandedSectionIds?: readonly string[];
  readonly inspectorCollapsed: boolean;
  readonly bottomPanelVisible: boolean;
  readonly activeBottomPanelTab: string;
  readonly focusMode: boolean;
  readonly workspaceLayout: UserWorkspaceLayoutPreferences;
}

export const DEFAULT_USER_SHELL_PREFERENCES: UserShellPreferences = {
  workbenchMode: "creative",
  creativeNavigatorMode: "writing",
  engineeringExpandedPathIds: [],
  navigatorCollapsed: false,
  navigatorExpandedSectionIds: [],
  inspectorCollapsed: false,
  bottomPanelVisible: false,
  activeBottomPanelTab: "工作流运行",
  focusMode: false,
  workspaceLayout: {
    splitView: false,
    navigatorWidth: 260,
    inspectorWidth: 320,
    bottomPanelHeight: 180
  }
};
```

In `user-preferences-session.ts`, normalize `workbenchMode` to `creative | engineering`, `creativeNavigatorMode` to `writing | story`, and both expansion arrays with de-duplication while preserving `[]`. Detect a legacy shell by absence of `workbenchMode`; only that migration sets `inspectorCollapsed: false`.

- [ ] **Step 5: Extend `DesktopShellState` without changing activity behavior yet**

Add these fields to `DesktopShellState` and initialize them from the shared constant:

```ts
readonly workspaceContext: WorkspaceContextDto;
readonly workbenchMode: WorkbenchMode;
readonly creativeNavigatorMode: CreativeNavigatorMode;
readonly engineeringExpandedPathIds: readonly string[];
```

Update `rendererShellState`, `shellPreferencesFromState`, and `applyShellPreferences` to use `DEFAULT_USER_SHELL_PREFERENCES`. Keep `navigatorExpandedSectionIds` only as a temporary legacy-read field until Task 6 removes the old section tree from rendering.

- [ ] **Step 6: Run the focused tests and typecheck**

Run:

```powershell
npm test -- packages/application/test/user-preferences-session.test.ts packages/application/test/desktop-application.test.ts apps/desktop/test/app-shell-support.test.ts
npm run typecheck
```

Expected: PASS; all shell defaults are identical, unknown values fall back safely, and explicit empty arrays round-trip unchanged.

- [ ] **Step 7: Commit Gate A state foundations**

```powershell
git add packages/shared/src/workspace-context.ts packages/shared/src/user-preferences.ts packages/shared/src/index.ts packages/application/src/workspace-activation-context.ts packages/application/src/user-preferences-session.ts packages/application/src/desktop-application.ts packages/application/src/index.ts apps/desktop/src/renderer/app-shell-support.ts packages/application/test/user-preferences-session.test.ts packages/application/test/desktop-application.test.ts apps/desktop/test/app-shell-support.test.ts
git commit -m "feat: add unified workspace context state"
```

## Task 2: Move Engineering Tree and Text Saves into Repository and Application

**Files:**

- Create: `packages/application/src/engineering-workspace-session.ts`
- Modify: `packages/application/src/index.ts`
- Create: `packages/application/test/engineering-workspace-session.test.ts`
- Create: `packages/repository/src/engineering-workspace-repository.ts`
- Modify: `packages/repository/src/index.ts`
- Create: `packages/repository/test/engineering-workspace-repository.test.ts`

- [ ] **Step 1: Write failing repository and session tests**

Cover bounded traversal, ignored directories, dotfile visibility, symlink/path escape rejection, UTF-8 text reads, oversized files, atomic saves, and an external-edit conflict:

```ts
if (!opened.ok) throw new Error(opened.error.message);
expect(opened.value.tree).toMatchObject({
  truncated: true,
  nodes: expect.arrayContaining([
    expect.objectContaining({ path: "src/index.ts", kind: "file" }),
    expect.objectContaining({ path: ".editorconfig", kind: "file" })
  ])
});
expect(flatten(opened.value.tree.nodes).map((node) => node.path)).not.toContain(".git");
expect(flatten(opened.value.tree.nodes).map((node) => node.path)).not.toContain("node_modules");

const original = await session.readTextFile("src/index.ts");
if (!original.ok) throw new Error(original.error.message);
await writeFile(join(contentRoot, "src", "index.ts"), "external change\n", "utf8");
const conflict = await session.saveTextFile({
  path: "src/index.ts",
  content: "editor draft\n",
  expectedChecksum: original.value.checksum
});
expect(conflict).toMatchObject({
  ok: true,
  value: {
    kind: "conflict",
    current: { content: "external change\n" },
    attemptedContent: "editor draft\n"
  }
});
expect(await readFile(join(contentRoot, "src", "index.ts"), "utf8")).toBe("external change\n");
```

The Application test must also prove a failed open leaves the previously active `EngineeringWorkspaceSnapshot` unchanged.

- [ ] **Step 2: Run focused tests and verify the current Desktop-owned implementation fails**

Run:

```powershell
npm test -- packages/application/test/engineering-workspace-session.test.ts packages/repository/test/engineering-workspace-repository.test.ts
```

Expected: FAIL because neither class exists and current directory traversal/text I/O live only in `apps/desktop/src/main/ipc-handlers.ts` without checksum conflict results.

- [ ] **Step 3: Define the Application DTOs and ports**

Create `engineering-workspace-session.ts` with these public contracts:

```ts
export interface EngineeringWorkspaceTreeNode {
  readonly id: string;
  readonly name: string;
  readonly kind: "directory" | "file";
  readonly path: string;
  readonly readOnlyReason?: string;
  readonly children?: readonly EngineeringWorkspaceTreeNode[];
}

export interface EngineeringWorkspaceTreeSnapshot {
  readonly nodes: readonly EngineeringWorkspaceTreeNode[];
  readonly truncated: boolean;
}

export interface EngineeringTextFileSnapshot {
  readonly path: string;
  readonly content: string;
  readonly checksum: string;
  readonly byteLength: number;
  readonly readOnlyReason?: string;
}

export type EngineeringTextFileSaveResult =
  | { readonly kind: "saved"; readonly document: EngineeringTextFileSnapshot }
  | {
      readonly kind: "conflict";
      readonly current: EngineeringTextFileSnapshot;
      readonly attemptedContent: string;
    };

export interface EngineeringWorkspaceSnapshot {
  readonly workspaceId: string;
  readonly displayName: string;
  readonly tree: EngineeringWorkspaceTreeSnapshot;
}

export interface EngineeringWorkspaceActivation {
  readonly context: Extract<WorkspaceActivationContext, { readonly kind: "engineeringWorkspace" }>;
  readonly snapshot: EngineeringWorkspaceSnapshot;
}

export interface EngineeringWorkspaceRepositoryPort {
  openWorkspace(): Promise<
    Result<
      {
        readonly canonicalContentRoot: string;
        readonly displayName: string;
        readonly tree: EngineeringWorkspaceTreeSnapshot;
      },
      UnifiedError
    >
  >;
  readTextFile(path: string): Promise<Result<EngineeringTextFileSnapshot, UnifiedError>>;
  saveTextFile(input: {
    readonly path: string;
    readonly content: string;
    readonly expectedChecksum: string;
  }): Promise<Result<EngineeringTextFileSaveResult, UnifiedError>>;
}

export interface EngineeringWorkspaceStatePort {
  resolveState(
    canonicalContentRoot: string
  ): Promise<Result<{ readonly workspaceId: string; readonly stateRoot: string }, UnifiedError>>;
}

export interface EngineeringWorkspaceLockPort {
  acquireWorkspaceLock(): Promise<Result<void, UnifiedError>>;
  releaseWorkspaceLock(): Promise<Result<void, UnifiedError>>;
}

export interface CreateEngineeringWorkspaceSessionOptions {
  readonly createRepository: (contentRoot: string) => EngineeringWorkspaceRepositoryPort;
  readonly createStatePort: () => EngineeringWorkspaceStatePort;
  readonly createLockPort: (stateRoot: string) => EngineeringWorkspaceLockPort;
  readonly now?: () => string;
}
```

`createEngineeringWorkspaceSession(options: CreateEngineeringWorkspaceSessionOptions)` uses these factories. It opens and locks a candidate first, then swaps active repository/activation only after every operation succeeds; on failure it releases the candidate lock and retains the old activation. `openEngineeringWorkspace` and `attachCreativeProject` return `EngineeringWorkspaceActivation` internally; only its `snapshot` and `toWorkspaceContextDto(context)` cross IPC.

Expose two session entry paths: `openEngineeringWorkspace(contentRoot)` resolves a new app-local state root and acquires its lock; `attachCreativeProject({ projectId, projectRoot })` reuses `workspaceId: projectId` and `contentRoot === stateRoot === projectRoot` without acquiring a second lock. The latter supplies the formal file tree when a creative project switches to engineering workbench.

- [ ] **Step 4: Implement the bounded filesystem repository**

Implement `EngineeringWorkspaceFileRepository` with these fixed limits and ignored directories:

```ts
const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_MAX_ITEMS = 300;
const DEFAULT_MAX_TEXT_BYTES = 5 * 1024 * 1024;
const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "release",
  "build",
  "out",
  "coverage"
]);
```

Canonicalize the root with `realpath`. For every read or save, reject absolute paths, `..` escapes, directories, symlink escapes, and targets outside the canonical root. Compute SHA-256 over file bytes. Before saving, re-read the file and compare its checksum to `expectedChecksum`; return the `conflict` union without writing when it differs. On a match, call the existing `writeTextAtomically`, re-read the saved document, and return `kind: "saved"`.

In Application, mark Novel Studio managed paths read-only when the session is attached to a creative project: `project.json`, `settings.json`, `chapters/**`, `characters/**`, `world/**`, `outline/**`, `timeline/**`, `memories/**`, `prompts/**`, `agents/**`, `workflow/**`, `plugins/**`, `history/**`, `cache/**`, and `.novel-studio/**`. Reads remain available for inspection; manual saves return `ENGINEERING_MANAGED_ASSET_WRITE_REJECTED` with guidance to use the chapter, Story Bible, Studio, version, or recovery surface. Agent writes remain governed separately by Change Set and Version Group.

- [ ] **Step 5: Run focused tests and verify the layer boundary**

Run:

```powershell
npm test -- packages/application/test/engineering-workspace-session.test.ts packages/repository/test/engineering-workspace-repository.test.ts
npm run typecheck
```

Expected: PASS; no Electron import appears in either new module and no test writes outside its temporary content/state roots.

- [ ] **Step 6: Commit the engineering Application/Repository boundary**

```powershell
git add packages/application/src/engineering-workspace-session.ts packages/application/src/index.ts packages/application/test/engineering-workspace-session.test.ts packages/repository/src/engineering-workspace-repository.ts packages/repository/src/index.ts packages/repository/test/engineering-workspace-repository.test.ts
git commit -m "feat: add engineering workspace session"
```

## Task 3: Add App-Local Workspace State and Split Agent Content/State Roots

**Files:**

- Create: `packages/repository/src/workspace-state-repository.ts`
- Modify: `packages/repository/src/index.ts`
- Create: `packages/repository/test/workspace-state-repository.test.ts`
- Modify: `apps/desktop/src/main/agent-runtime-manager.ts`
- Modify: `apps/desktop/src/main/agent-run-runtime.ts`
- Modify: `apps/desktop/src/main/application-composition.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Test: `apps/desktop/test/agent-runtime-manager.test.ts`
- Test: `apps/desktop/test/desktop-agent-run-runtime.test.ts`
- Create: `apps/desktop/test/engineering-agent-runtime.test.ts`
- Test: `packages/repository/test/agent-write-transaction.test.ts`
- Test: `packages/application/test/version-group-session.test.ts`
- Test: `packages/application/test/run-undo-conflict.test.ts`

- [ ] **Step 1: Write failing state-root and Agent safety tests**

Add a stable-ID test:

```ts
const first = await repository.resolveState(await realpath(contentRoot));
const second = await repository.resolveState(await realpath(contentRoot));
if (!first.ok) throw new Error(first.error.message);
if (!second.ok) throw new Error(second.error.message);
expect(first).toEqual(second);
expect(first.value.workspaceId).toMatch(/^ws_[a-f0-9]{24}$/u);
expect(first.value.stateRoot).toBe(join(userDataRoot, "workspaces", first.value.workspaceId));
```

Add an engineering Agent runtime test that starts with an ordinary folder containing only `src/index.ts`, binds the runtime, proposes/applies a `general_file` Change Set, and asserts:

```ts
expect(await readFile(join(contentRoot, "src", "index.ts"), "utf8")).toBe("after\n");
expect(await pathExists(join(contentRoot, ".novel-studio"))).toBe(false);
expect(await pathExists(join(contentRoot, "history"))).toBe(false);
expect(await pathExists(join(stateRoot, ".novel-studio", "project-lock.json"))).toBe(true);
expect(await pathExists(join(stateRoot, "history", "agent-runs"))).toBe(true);
expect(await pathExists(join(stateRoot, "history", "agent-transactions"))).toBe(true);
```

Also assert a `writing` draft in an engineering workspace fails before model execution with stable code `AGENT_CONTEXT_MODE_UNAVAILABLE`, while `general_file` remains available.

Add a creative identity regression asserting that a project with `projectId: "prj_changan"` binds `workspaceId: "prj_changan"`. Only ordinary engineering roots use the `ws_<hash>` mapping; this preserves existing Stage 5 Agent Run, Conversation, usage, recovery, and Version Group record keys without a migration.

- [ ] **Step 2: Run focused tests and verify the single-root runtime fails**

Run:

```powershell
npm test -- packages/repository/test/workspace-state-repository.test.ts apps/desktop/test/agent-runtime-manager.test.ts apps/desktop/test/engineering-agent-runtime.test.ts
```

Expected: FAIL because the state repository does not exist and `createDesktopAgentRuntime` currently sends Agent run, Conversation, history, recovery, lock, and content operations to one `projectRoot`.

- [ ] **Step 3: Implement stable app-local workspace state resolution**

Create `WorkspaceStateFileRepository` with this deterministic mapping:

```ts
const digest = createHash("sha256").update(canonicalContentRoot, "utf8").digest("hex");
const workspaceId = `ws_${digest.slice(0, 24)}`;
const stateRoot = join(userDataRoot, "workspaces", workspaceId);
await mkdir(stateRoot, { recursive: true });
return ok({ workspaceId, stateRoot });
```

Reject a non-canonical or missing content root, never serialize the absolute content path as the public ID, and never create files under `contentRoot`.

- [ ] **Step 4: Replace project-only runtime bindings with workspace bindings**

Use these exact main-process contracts:

```ts
export interface DesktopAgentWorkspaceBinding {
  readonly kind: "creativeProject" | "engineeringWorkspace";
  readonly workspaceId: string;
  readonly contentRoot: string;
  readonly stateRoot: string;
  readonly activeChapterId?: string;
}

export interface DesktopAgentRuntime {
  readonly workspaceId: string;
  readonly contentRoot: string;
  readonly stateRoot: string;
  readonly agentRunSession: AgentRunSession;
  readonly agentConversationSession: AgentConversationSession;
  readonly agentRunDraftSession: AgentRunDraftSession;
  readonly agentContextSession: AgentContextSession;
  readonly agentPermissionSession: AgentPermissionSession;
  readonly agentPlanExecutionSession: AgentPlanExecutionSession;
  readonly agentUsageSession?: AgentUsageSession;
  readonly prepare: () => Promise<Result<void, UnifiedError>>;
  readonly dispose?: () => void;
}
```

Rename `bindProject` to `bindWorkspace`, `currentProject` to `currentWorkspace`, and update every existing call site in this task; do not add a compatibility wrapper. Runtime construction must be side-effect-free. `prepare()` awaits and caches `recoverOnStartup()` plus any other fallible preflight exactly once. Only after `prepare()` succeeds may the manager swap the runtime and subscribe to `agentRunSession`; no fire-and-forget recovery remains.

- [ ] **Step 5: Route every Agent repository to the correct root**

Change `DesktopAgentRunSessionOptions` to:

```ts
export interface DesktopAgentRunSessionOptions {
  readonly workspaceKind: "creativeProject" | "engineeringWorkspace";
  readonly projectId: string;
  readonly contentRoot: string;
  readonly stateRoot: string;
  readonly activeChapterId?: string;
}
```

Replace only the current `projectRoot/projectId/activeChapterId` root fields with this block; retain the existing model, usage, editor-sync, timing, and test-injection fields unchanged.

Wire roots exactly as follows:

```ts
const projectReads = new AgentProjectReadRepository({ projectRoot: options.contentRoot });
const runRepository = new AgentRunFileRepository({ projectRoot: options.stateRoot });
const conversationRepository = new AgentConversationFileRepository({
  projectRoot: options.stateRoot
});
const recoveryRepository = new RecoveryRepository({ projectRoot: options.stateRoot });
const historyRepository = new HistoryRepository({ projectRoot: options.stateRoot });
const workspaceLock = new ProjectLockFileRepository({
  projectRoot: options.stateRoot,
  ownerId: options.projectLockOwnerId ?? ""
});
const transaction = new AgentWriteTransaction({
  projectRoot: options.contentRoot,
  projectLock: workspaceLock,
  historyRepository,
  recoveryRepository
});
```

Construct `ChapterFileRepository` and `StoryBibleFileRepository` only for `creativeProject`. In `engineeringWorkspace`, reject `writing` context during start preflight. For `general_file`, preserve the existing Tool Registry matrix exactly: planning exposes only `list_project_entries`, `read_project_text`, `finish_plan`, and `request_user_input`; execution additionally exposes `propose_file_write`, `finish`, and the existing approval flow. Continue passing `projectId: workspaceId` into existing Agent Engine records so Stage 5 schemas do not require a rename.

- [ ] **Step 6: Run transaction and runtime regressions**

Run:

```powershell
npm test -- packages/repository/test/workspace-state-repository.test.ts apps/desktop/test/agent-runtime-manager.test.ts apps/desktop/test/desktop-agent-run-runtime.test.ts apps/desktop/test/engineering-agent-runtime.test.ts packages/repository/test/agent-write-transaction.test.ts packages/application/test/version-group-session.test.ts packages/application/test/run-undo-conflict.test.ts
npm run typecheck
rg -n "bindProject|currentProject|DesktopAgentProjectBinding" apps/desktop/src apps/desktop/test
```

Expected: tests and typecheck PASS; the final `rg` exits 1 with no matches. Creative projects retain `workspaceId === projectId` and `contentRoot === stateRoot`, engineering workspaces keep metadata app-local, execution can propose `general_file` writes through Change Set, planning stays read-only, and existing transaction/undo behavior remains green.

- [ ] **Step 7: Commit the split-root Agent runtime**

```powershell
git add packages/repository/src/workspace-state-repository.ts packages/repository/src/index.ts packages/repository/test/workspace-state-repository.test.ts apps/desktop/src/main/agent-runtime-manager.ts apps/desktop/src/main/agent-run-runtime.ts apps/desktop/src/main/application-composition.ts apps/desktop/src/main/index.ts apps/desktop/test/agent-runtime-manager.test.ts apps/desktop/test/desktop-agent-run-runtime.test.ts apps/desktop/test/engineering-agent-runtime.test.ts packages/repository/test/agent-write-transaction.test.ts packages/application/test/version-group-session.test.ts packages/application/test/run-undo-conflict.test.ts
git commit -m "feat: separate agent content and state roots"
```

## Task 4: Replace In-Place Initialization with Safe Child-Directory Project Creation

**Files:**

- Create: `packages/repository/src/project-creation-repository.ts`
- Modify: `packages/repository/src/index.ts`
- Create: `packages/repository/test/project-creation-repository.test.ts`
- Modify: `packages/application/src/project-workspace-session.ts`
- Modify: `packages/application/src/desktop-application.ts`
- Modify: `packages/application/src/novel-studio-api.ts`
- Modify: `packages/application/src/index.ts`
- Test: `packages/application/test/project-workflow-session.test.ts`
- Test: `packages/application/test/desktop-project-workflow.test.ts`
- Test: `packages/repository/test/project-workflow.test.ts`

- [ ] **Step 1: Write failing parent/child creation tests**

Add table-driven validation for blank names, separators, Windows reserved names, control characters, trailing spaces/dots, `.`/`..`, and an existing destination. Add a success case that proves only one child directory is created and all Novel Studio files stay inside it:

```ts
const created = await repository.createProjectInParent({
  parentDirectory,
  folderName: "长安旧梦",
  projectId: "prj_changan",
  title: "长安旧梦：第一部",
  language: "zh-CN"
});

expect(created).toMatchObject({
  ok: true,
  value: {
    projectRoot: join(parentDirectory, "长安旧梦"),
    snapshot: { project: { title: "长安旧梦：第一部" } }
  }
});
expect(await readdir(parentDirectory)).toEqual(["长安旧梦"]);
expect(await pathExists(join(parentDirectory, "project.json"))).toBe(false);
expect(await pathExists(join(parentDirectory, "长安旧梦", "project.json"))).toBe(true);
```

Add a failure-injection case after the child directory is created; assert cleanup removes only that child and leaves pre-existing siblings untouched.

- [ ] **Step 2: Run focused tests and verify current root semantics fail**

Run:

```powershell
npm test -- packages/repository/test/project-creation-repository.test.ts packages/application/test/project-workflow-session.test.ts packages/application/test/desktop-project-workflow.test.ts packages/repository/test/project-workflow.test.ts
```

Expected: FAIL because creation currently treats the selected directory as `projectRoot` and has no separate `folderName` or parent-directory contract.

- [ ] **Step 3: Add the creation port and input contract**

Define these types in `project-workspace-session.ts`:

```ts
export interface CreateCreativeProjectInput {
  readonly parentDirectory: string;
  readonly folderName: string;
  readonly projectId: string;
  readonly title: string;
  readonly language: string;
  readonly projectType?: string;
  readonly targetWordCount?: number;
}

export interface ProjectCreationResult {
  readonly projectRoot: string;
  readonly snapshot: ProjectSnapshot;
}

export interface ProjectCreationPreview {
  readonly parentDirectory: string;
  readonly folderName: string;
  readonly projectRoot: string;
  readonly parentDisplayName: string;
  readonly targetDisplayName: string;
}

export interface ProjectCreationRepositoryPort {
  previewProjectInParent(input: {
    readonly parentDirectory: string;
    readonly folderName: string;
  }): Promise<Result<ProjectCreationPreview, UnifiedError>>;
  createProjectInParent(
    input: CreateCreativeProjectInput
  ): Promise<Result<ProjectCreationResult, UnifiedError>>;
  cleanupCreatedProject(projectRoot: string): Promise<Result<void, UnifiedError>>;
}
```

`ProjectCreationPreview` is an internal Application/Repository value. Its canonical path fields never appear in `NovelStudioApi`; Task 5 converts it to `ProjectCreationPreviewDto` and resolves the parent through an opaque main-process selection token.

Add one unbound `projectCreationRepository: ProjectCreationRepositoryPort` to `ProjectWorkspaceSessionOptions`; the repository receives `parentDirectory` only through the full input above. Add `createProjectInParent(input: CreateCreativeProjectInput)` to the session and Application contracts.

The only temporary compatibility operation is the existing desktop-facing `project.create` chain (`DesktopApplication.createProject(CreateProjectInput)` and `NovelStudioApi.project.create`). Leave it unchanged solely so Task 4 can remain type-safe before Desktop integration changes. Do not add a second Repository signature or factory bound to `parentDirectory`. Task 5 must replace this IPC chain with `createCreativeProject` and delete `CreateProjectInput` from desktop-facing contracts, verified by an explicit zero-reference scan.

- [ ] **Step 4: Implement fail-closed folder validation and creation**

Create `ProjectCreationFileRepository` with this validation order:

```ts
const normalized = input.folderName.normalize("NFKC");
if (normalized.length === 0 || normalized !== normalized.trim()) return invalidName();
if (normalized === "." || normalized === "..") return invalidName();
if (/[<>:"/\\|?*\u0000-\u001f]/u.test(normalized)) return invalidName();
if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu.test(normalized)) {
  return invalidName();
}
if (/[. ]$/u.test(normalized)) return invalidName();
```

Then:

1. Resolve and `realpath` the parent directory and verify it is a directory.
2. Compute `targetRoot = resolve(canonicalParent, normalized)` and require `dirname(targetRoot) === canonicalParent`.
3. Reject any existing target with `PROJECT_CREATE_TARGET_EXISTS`.
4. Create the target with `mkdir(targetRoot, { recursive: false })`.
5. Construct `ProjectFileRepository({ projectRoot: targetRoot })` and call its existing schema-validating `createProject`.
6. If any later step fails, remove only `targetRoot`; never remove or rewrite the parent.
7. Return the complete `ProjectCreationResult`; never append a random suffix.

`previewProjectInParent` runs steps 1-3 without creating anything and returns the exact canonical target path. Creation calls the same private validation function again immediately before `mkdir`; the preview is informational and never acts as stale authorization.

- [ ] **Step 5: Keep title and folder name independent in Application state**

Make `ProjectWorkspaceSession.createProjectInParent` pass the complete input to the single repository port and activate the returned root through the existing chapter/history/recovery/lock path. The metadata title must remain `input.title`; the folder name is used only for disk placement. On validation or Repository failure, retain the old workspace snapshot and active chapter session.

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```powershell
npm test -- packages/repository/test/project-creation-repository.test.ts packages/application/test/project-workflow-session.test.ts packages/application/test/desktop-project-workflow.test.ts packages/repository/test/project-workflow.test.ts
npm run typecheck
```

Expected: PASS; creating a project never initializes the selected parent folder in place and all existing chapter/project lock/recovery tests remain green.

- [ ] **Step 7: Commit safe creative project creation**

```powershell
git add packages/repository/src/project-creation-repository.ts packages/repository/src/index.ts packages/repository/test/project-creation-repository.test.ts packages/application/src/project-workspace-session.ts packages/application/src/desktop-application.ts packages/application/src/novel-studio-api.ts packages/application/src/index.ts packages/application/test/project-workflow-session.test.ts packages/application/test/desktop-project-workflow.test.ts packages/repository/test/project-workflow.test.ts
git commit -m "feat: create projects in dedicated folders"
```

## Task 5: Add Explicit Workspace APIs and Atomic Application/Agent Activation

**Files:**

- Create: `apps/desktop/src/main/workspace-activation.ts`
- Create: `apps/desktop/test/workspace-activation.test.ts`
- Modify: `packages/application/src/desktop-application.ts`
- Modify: `packages/application/src/novel-studio-api.ts`
- Modify: `packages/application/src/ipc-contract.ts`
- Modify: `packages/application/src/index.ts`
- Modify: `apps/desktop/src/main/ipc-handlers.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/main/agent-runtime-manager.ts`
- Modify: `apps/desktop/src/preload/api.ts`
- Modify: `apps/desktop/src/preload/index.cts`
- Modify: `apps/desktop/src/renderer/project-workflow-bridge.ts`
- Modify: `apps/desktop/src/renderer/project-workflow-actions.ts`
- Create: `apps/desktop/src/renderer/engineering-workspace-bridge.ts`
- Modify: `apps/desktop/src/renderer/plain-file-editor-bridge.ts`
- Modify: `packages/ui/src/workspace-shell-types.ts`
- Test: `apps/desktop/test/project-workflow-ipc.test.ts`
- Test: `apps/desktop/test/project-workflow-bridge.test.ts`
- Create: `apps/desktop/test/engineering-workspace-bridge.test.ts`
- Test: `apps/desktop/test/plain-file-editor-bridge.test.ts`
- Test: `apps/desktop/test/agent-runtime-manager.test.ts`
- Test: `apps/desktop/test/project-workflow.e2e.ts`

- [ ] **Step 1: Write failing explicit-operation and atomicity tests**

Require three separate user operations:

```ts
const creative = await api.project.chooseOpenCreativeDirectory();
await api.project.openCreativeProject(creative.value.selectionId);
const engineering = await api.workspace.chooseEngineeringDirectory();
await api.workspace.openEngineeringWorkspace(engineering.value.selectionId);
await api.project.createCreativeProject({
  parentSelectionId: (await api.project.chooseCreateParentDirectory()).value.selectionId,
  folderName: "新书",
  projectId: "prj_new",
  title: "新书",
  language: "zh-CN"
});
```

Add assertions that opening an invalid creative root returns `PROJECT_OPEN_FAILED` without falling back to a file tree or exposing `canInitializeProject`. Add an injected Agent runtime preparation failure and assert the Application shell context, renderer project/workspace bridge, current Agent runtime, draft editor, and Conversation all remain bound to the old workspace. For failed project creation, assert the candidate child directory is cleaned.

Add a main-handler boundary test that scans `ipc-handlers.ts` behavior through its public handlers and verifies directory traversal, `readFile`, `writeTextAtomically`, and path business validation are no longer performed there.

- [ ] **Step 2: Run focused tests and verify the mixed ordinary-folder path fails**

Run:

```powershell
npm test -- apps/desktop/test/workspace-activation.test.ts apps/desktop/test/project-workflow-ipc.test.ts apps/desktop/test/project-workflow-bridge.test.ts apps/desktop/test/engineering-workspace-bridge.test.ts apps/desktop/test/plain-file-editor-bridge.test.ts apps/desktop/test/agent-runtime-manager.test.ts
```

Expected: FAIL because current `project.open` converts an invalid project into a renderer-owned ordinary-folder tree, exposes in-place initialization, and mutates Application state before Agent binding succeeds.

- [ ] **Step 3: Add prepared Application activation candidates**

Define the renderer-safe project projection beside the existing main/Application snapshot types:

```ts
export interface ProjectWorkspaceSnapshotDto {
  readonly project: ProjectMetadata;
  readonly settings: WorkspaceProjectSettings;
  readonly chapters: readonly ChapterSummary[];
  readonly recovery: ProjectWorkspaceRecoverySummary;
  readonly health: ProjectWorkspaceHealth;
  readonly lock?: {
    readonly schemaVersion: "1.0";
    readonly ownerId: string;
    readonly acquiredAt: string;
  };
  readonly activeChapterId?: string;
}

export interface ProjectRecoveryApplyResultDto {
  readonly workspace: ProjectWorkspaceSnapshotDto;
  readonly chapterEditor: ChapterEditorSnapshot;
}

export interface ProjectCreationPreviewDto {
  readonly folderName: string;
  readonly parentDisplayName: string;
  readonly targetDisplayName: string;
}

export function toProjectCreationPreviewDto(
  preview: ProjectCreationPreview
): ProjectCreationPreviewDto {
  return {
    folderName: preview.folderName,
    parentDisplayName: preview.parentDisplayName,
    targetDisplayName: preview.targetDisplayName
  };
}

export function toProjectWorkspaceSnapshotDto(
  snapshot: ProjectWorkspaceSnapshot
): ProjectWorkspaceSnapshotDto {
  return {
    project: snapshot.project,
    settings: snapshot.settings,
    chapters: snapshot.chapters,
    recovery: snapshot.recovery,
    health: snapshot.health,
    ...(snapshot.lock === undefined
      ? {}
      : {
          lock: {
            schemaVersion: snapshot.lock.schemaVersion,
            ownerId: snapshot.lock.ownerId,
            acquiredAt: snapshot.lock.acquiredAt
          }
        }),
    ...(snapshot.activeChapterId === undefined ? {} : { activeChapterId: snapshot.activeChapterId })
  };
}
```

`PreparedWorkspaceActivation` keeps the full snapshot only in main/Application memory. The committed DTO, preload return type, and renderer bridge never contain `projectRoot`, `contentRoot`, or `stateRoot`.

Extend `DesktopApplication` with internal main-process methods:

```ts
export type PreparedWorkspaceActivation =
  | {
      readonly activationId: string;
      readonly context: Extract<
        WorkspaceActivationContext,
        { readonly kind: "creativeProject" }
      >;
      readonly creativeProject: ProjectWorkspaceSnapshot;
    }
  | {
      readonly activationId: string;
      readonly context: Extract<
        WorkspaceActivationContext,
        { readonly kind: "engineeringWorkspace" }
      >;
      readonly engineeringWorkspace: EngineeringWorkspaceSnapshot;
    };

export type WorkspaceActivationDto =
  | {
      readonly context: Extract<WorkspaceContextDto, { readonly kind: "creativeProject" }>;
      readonly creativeProject: ProjectWorkspaceSnapshotDto;
    }
  | {
      readonly context: Extract<WorkspaceContextDto, { readonly kind: "engineeringWorkspace" }>;
      readonly engineeringWorkspace: EngineeringWorkspaceSnapshot;
    };

prepareOpenCreativeProject(projectRoot: string): Promise<
  Result<PreparedWorkspaceActivation, UnifiedError>
>;
prepareCreateCreativeProject(input: CreateCreativeProjectInput): Promise<
  Result<PreparedWorkspaceActivation, UnifiedError>
>;
prepareOpenEngineeringWorkspace(contentRoot: string): Promise<
  Result<PreparedWorkspaceActivation, UnifiedError>
>;
commitWorkspaceActivation(activationId: string): WorkspaceActivationDto;
discardWorkspaceActivation(activationId: string): Promise<Result<void, UnifiedError>>;
```

Use fresh candidate `ProjectWorkspaceSession` / `EngineeringWorkspaceSession` instances. Preparation performs all fallible opens, validation, state-root resolution, and lock acquisition without replacing the active sessions or `DesktopShellState`. `commitWorkspaceActivation` only swaps already-prepared references, converts the internal context through `toWorkspaceContextDto`, and stores the DTO in shell state; it performs no filesystem or runtime operation. `discardWorkspaceActivation` releases candidate locks and cleans a newly created project root when applicable. Neither `contentRoot` nor `stateRoot` appears in the committed DTO or any preload/renderer type.

- [ ] **Step 4: Add prepared Agent runtime activation**

Extend `DesktopAgentRuntimeManager` with:

```ts
export interface PreparedDesktopAgentWorkspace {
  readonly binding: DesktopAgentWorkspaceBinding;
  readonly runtime: DesktopAgentRuntime;
}

prepareWorkspace(
  binding: DesktopAgentWorkspaceBinding
): Promise<Result<PreparedDesktopAgentWorkspace, UnifiedError>>;
commitPreparedWorkspace(prepared: PreparedDesktopAgentWorkspace): void;
discardPreparedWorkspace(prepared: PreparedDesktopAgentWorkspace): void;
```

`prepareWorkspace` canonicalizes roots, checks for an active run, creates the inactive runtime, awaits `runtime.prepare()` (including cached `recoverOnStartup()` and preflight), and leaves the current runtime/subscription untouched. A failed prepare disposes only the candidate. `commitPreparedWorkspace` swaps subscriptions, disposes the old runtime, and stores the prepared runtime; no awaited/fallible work occurs during commit.

- [ ] **Step 5: Coordinate the two prepared resources in Desktop**

Implement `createWorkspaceActivationCoordinator` with this exact failure order:

```ts
const candidate = await application.prepareOpenEngineeringWorkspace(contentRoot);
if (!candidate.ok) return candidate;

const preparedRuntime = await runtimeManager.prepareWorkspace(toBinding(candidate.value));
if (!preparedRuntime.ok) {
  await application.discardWorkspaceActivation(candidate.value.activationId);
  return err(preparedRuntime.error);
}

const committed = application.commitWorkspaceActivation(candidate.value.activationId);
runtimeManager.commitPreparedWorkspace(preparedRuntime.value);
return ok(committed);
```

Use the same coordinator for creative open and create. `toBinding` reads only the internal `candidate.value.context`: creative maps `workspaceId === projectId`, `contentRoot/stateRoot/activeChapterId`; engineering maps hashed `workspaceId/contentRoot/stateRoot` without a fake chapter or fallback project ID. The returned `WorkspaceActivationDto` contains only the renderer-safe context and the appropriate UI snapshot.

- [ ] **Step 6: Replace the mixed IPC contract with explicit APIs**

Define the renderer-safe directory selection and creation request. The Desktop main process keeps the selected canonical path in an expiring in-memory token; the Renderer receives only an opaque token and display name:

```ts
export interface ProjectDirectorySelectionDto {
  readonly canceled: boolean;
  readonly selectionId?: string;
  readonly displayName?: string;
}

export interface CreateCreativeProjectRequest {
  readonly parentSelectionId: string;
  readonly folderName: string;
  readonly projectId: string;
  readonly title: string;
  readonly language: string;
  readonly projectType?: string;
  readonly targetWordCount?: number;
}
```

`chooseOpenCreativeDirectory`, `chooseCreateParentDirectory`, and `chooseEngineeringDirectory` issue these tokens. `openCreativeProject`, `openEngineeringWorkspace`, `previewCreativeProject`, and `createCreativeProject` resolve and validate the token in main before calling Application; the internal Application/Repository contracts continue to use canonical paths. `DesktopApplication.previewCreativeProject` calls the internal Repository port and returns `toProjectCreationPreviewDto`; no absolute parent or target path crosses the IPC boundary:

```ts
project: {
  chooseOpenCreativeDirectory(): Promise<Result<ProjectDirectorySelectionDto, UnifiedError>>;
  chooseCreateParentDirectory(): Promise<Result<ProjectDirectorySelectionDto, UnifiedError>>;
  openCreativeProject(selectionId: string): Promise<Result<WorkspaceActivationDto, UnifiedError>>;
  previewCreativeProject(input: {
    readonly parentSelectionId: string;
    readonly folderName: string;
  }): Promise<Result<ProjectCreationPreviewDto, UnifiedError>>;
  createCreativeProject(
    input: CreateCreativeProjectRequest
  ): Promise<Result<WorkspaceActivationDto, UnifiedError>>;
  previewRecoveryDraft(
    sessionId: string
  ): Promise<Result<ProjectRecoveryDraftPreview, UnifiedError>>;
  applyRecoveryDraft(
    sessionId: string
  ): Promise<Result<ProjectRecoveryApplyResultDto, UnifiedError>>;
  discardRecoveryDraft(
    sessionId: string
  ): Promise<Result<ProjectWorkspaceSnapshotDto, UnifiedError>>;
};
workspace: {
  chooseEngineeringDirectory(): Promise<Result<ProjectDirectorySelectionDto, UnifiedError>>;
  openEngineeringWorkspace(
    selectionId: string
  ): Promise<Result<WorkspaceActivationDto, UnifiedError>>;
  refreshEngineeringTree(): Promise<Result<EngineeringWorkspaceSnapshot, UnifiedError>>;
  readTextFile(path: string): Promise<Result<EngineeringTextFileSnapshot, UnifiedError>>;
  saveTextFile(input: {
    readonly path: string;
    readonly content: string;
    readonly expectedChecksum: string;
  }): Promise<Result<EngineeringTextFileSaveResult, UnifiedError>>;
};
```

Remove `application:project:read-directory`, `application:file:read-text`, `application:file:write-text`, and the old create-directory meaning after preload, bridge, and tests use the new channels. Delete the Task 4 compatibility chain `DesktopApplication.createProject(CreateProjectInput)` / `NovelStudioApi.project.create`; only `createCreativeProject(CreateCreativeProjectRequest)` remains at IPC, while its main/Application adapter constructs the internal `CreateCreativeProjectInput` with the resolved parent path. Main handlers validate clone-safe shapes and delegate to Application; they do not call `readdir`, `readFile`, `stat`, path resolution, or atomic write helpers.

- [ ] **Step 7: Split renderer bridges and surface file conflicts**

In `project-workflow-bridge.ts`, remove `fileTree`, `canInitializeProject`, `initializeProject`, and ordinary-folder fallback state. Store explicit creation form state:

```ts
readonly projectTitleInput: string;
readonly projectFolderNameInput: string;
readonly selectedParentSelectionId?: string;
readonly selectedParentDisplayName?: string;
readonly creationPreview?: ProjectCreationPreviewDto;
readonly onProjectTitleChange: (title: string) => void;
readonly onProjectFolderNameChange: (folderName: string) => void;
```

Before the folder name has been edited manually, title edits mirror into the folder-name field. After manual folder-name editing, title changes no longer overwrite it. Selecting a parent directory stores only `selectionId/displayName`; editing the folder name calls `previewCreativeProject({ parentSelectionId, folderName })`; render only the returned parent/target display names next to the create action, never the absolute parent or canonical target. Creation revalidates in Repository and never trusts the preview as authorization.

Create `engineering-workspace-bridge.ts` for open/refresh/tree props. Update `PlainFileEditorBridge` to store `checksum` and call `workspace.saveTextFile`. Extend `PlainFileEditorProps` with:

```ts
readonly conflict?: {
  readonly diskContent: string;
  readonly draftContent: string;
  readonly diskChecksum: string;
};
readonly onReloadFromDisk?: () => void;
readonly onKeepDraft?: () => void;
```

On `kind: "conflict"`, keep the editor dirty, preserve the user's draft, and expose the disk content for central review. Do not add a force-overwrite action in this task.

- [ ] **Step 8: Run focused integration tests and Electron project workflow**

Run:

```powershell
npm test -- packages/application/test/desktop-project-workflow.test.ts packages/application/test/engineering-workspace-session.test.ts apps/desktop/test/workspace-activation.test.ts apps/desktop/test/project-workflow-ipc.test.ts apps/desktop/test/project-workflow-bridge.test.ts apps/desktop/test/engineering-workspace-bridge.test.ts apps/desktop/test/plain-file-editor-bridge.test.ts apps/desktop/test/agent-runtime-manager.test.ts
npm run typecheck
npm run build
npx playwright test apps/desktop/test/project-workflow.e2e.ts
rg -n "CreateProjectInput|DesktopApplication\.createProject|project\.create\(" packages/application/src apps/desktop/src apps/desktop/test
```

Expected: tests, typecheck, build, and Playwright PASS; the final `rg` exits 1 with no legacy desktop-create matches. Cancel/failure retains the old context, normal engineering open writes nothing to `contentRoot`, renderer payloads contain no `stateRoot`, and project creation produces one dedicated child directory.

- [ ] **Step 9: Commit Gate B lifecycle integration**

```powershell
git add apps/desktop/src/main/workspace-activation.ts apps/desktop/test/workspace-activation.test.ts packages/application/src/desktop-application.ts packages/application/src/novel-studio-api.ts packages/application/src/ipc-contract.ts packages/application/src/index.ts apps/desktop/src/main/ipc-handlers.ts apps/desktop/src/main/index.ts apps/desktop/src/main/agent-runtime-manager.ts apps/desktop/src/preload/api.ts apps/desktop/src/preload/index.cts apps/desktop/src/renderer/project-workflow-bridge.ts apps/desktop/src/renderer/project-workflow-actions.ts apps/desktop/src/renderer/engineering-workspace-bridge.ts apps/desktop/src/renderer/plain-file-editor-bridge.ts packages/ui/src/workspace-shell-types.ts apps/desktop/test/project-workflow-ipc.test.ts apps/desktop/test/project-workflow-bridge.test.ts apps/desktop/test/engineering-workspace-bridge.test.ts apps/desktop/test/plain-file-editor-bridge.test.ts apps/desktop/test/agent-runtime-manager.test.ts apps/desktop/test/project-workflow.e2e.ts
git commit -m "feat: activate creative and engineering workspaces safely"
```

## Task 6: Replace the Nine-Section Project Tree with a Creative Navigator

**Files:**

- Create: `packages/ui/src/creative-workspace-navigator.tsx`
- Modify: `packages/ui/src/workspace-navigator.tsx`
- Modify: `packages/ui/src/workspace-shell-types.ts`
- Modify: `packages/ui/src/index.ts`
- Modify: `packages/ui/src/styles.css`
- Modify: `apps/desktop/src/renderer/renderer-workspace-shell.tsx`
- Test: `packages/ui/test/workspace-navigator.test.tsx`
- Test: `packages/ui/test/workspace-shell.test.tsx`
- Test: `apps/desktop/test/story-bible-bridge.test.ts`
- Test: `apps/desktop/test/project-workflow-bridge.test.ts`

- [ ] **Step 1: Write failing creative Navigator behavior tests**

Assert a valid creative project renders exactly two top-level tabs and none of the removed groups:

```tsx
expect(screen.getByRole("tab", { name: "写作" })).toHaveAttribute("aria-selected", "true");
expect(screen.getByRole("tab", { name: "故事资料" })).toBeTruthy();
expect(screen.queryByText("Novel Studio")).toBeNull();
expect(screen.queryByText("提示词")).toBeNull();
expect(screen.queryByText("Agent")).toBeNull();
expect(screen.queryByText("工作流")).toBeNull();
expect(container.querySelector('[data-project-file-tree="true"]')).toBeNull();
```

Cover these behaviors:

- writing shows only chapters, their real count, active/dirty state, and one create action;
- an empty project shows `还没有章节`, while a non-empty filtered list shows `未找到匹配章节` and `清除筛选`;
- rename/duplicate/delete menu clicks do not call chapter open;
- story shows character/world/outline/timeline/memory with real counts and one active category;
- outline/timeline hide create when their singleton already exists;
- timeline asset click calls `onStoryEntryOpen("timeline_main")`, not a global timeline activity callback;
- both tablists support ArrowLeft/ArrowRight/Home/End, visible focus, and unique `tabpanel` IDs.

- [ ] **Step 2: Run focused UI tests and verify the old tree fails**

Run:

```powershell
npm test -- packages/ui/test/workspace-navigator.test.tsx packages/ui/test/workspace-shell.test.tsx apps/desktop/test/story-bible-bridge.test.ts apps/desktop/test/project-workflow-bridge.test.ts
```

Expected: FAIL because `WorkspaceNavigator` still renders the duplicate root, nine expandable sections, project files, Studio assets, and in-place initialization.

- [ ] **Step 3: Define a presentation-only creative Navigator contract**

Add this contract to `workspace-shell-types.ts`:

```ts
export interface CreativeWorkspaceNavigatorProps {
  readonly projectTitle: string;
  readonly mode: CreativeNavigatorMode;
  readonly searchQuery: string;
  readonly chapters: readonly ChapterSummary[];
  readonly activeChapterId?: string;
  readonly dirtyChapterIds: readonly string[];
  readonly storyBible: StoryBibleEditorProps;
  readonly onModeSelect: (mode: CreativeNavigatorMode) => void;
  readonly onSearchQueryChange: (query: string) => void;
  readonly onCreateChapter: () => void;
  readonly onChapterOpen: (chapterId: string) => void;
  readonly onChapterRename: (chapterId: string, title: string) => void;
  readonly onChapterDuplicate: (chapterId: string) => void;
  readonly onChapterDelete: (chapterId: string) => void;
  readonly onStoryKindOpen: (kind: StoryBibleEditorKind) => void;
  readonly onStoryEntryOpen: (entryId: string) => void;
  readonly onStoryEntryCreate: (kind: StoryBibleEditorKind) => void;
}
```

The component receives DTOs and semantic callbacks only. It must not import Desktop bridges, Application sessions, filesystem APIs, or `setShellState`.

- [ ] **Step 4: Implement writing and story projections**

Use this exact kind order and singleton set:

```ts
const STORY_KINDS: readonly StoryBibleEditorKind[] = [
  "character",
  "world",
  "outline",
  "timeline",
  "memory"
];
const SINGLETON_KINDS = new Set<StoryBibleEditorKind>(["outline", "timeline"]);
```

Writing filters chapter titles case-insensitively. Story filters only the active kind. The create button and empty-state button call the same callback. Use real buttons for rows and a floating menu for low-frequency chapter actions; call `event.stopPropagation()` before rename/duplicate/delete. Keep row height in the existing dense 28-30px range.

- [ ] **Step 5: Make `WorkspaceNavigator` a context switcher**

Change `WorkspaceNavigator` to accept `workspaceContext`, optional `creative`, optional `engineering`, and explicit none-state actions. During this task it renders `CreativeWorkspaceNavigator` for `creativeProject`, preserves the old engineering branch only until Task 8 supplies the formal component, and renders open/create actions for `none`. Stop reading `shellState.navigatorSections` and `navigatorExpandedSectionIds` in the creative branch.

- [ ] **Step 6: Run focused UI and bridge regressions**

Run:

```powershell
npm test -- packages/ui/test/workspace-navigator.test.tsx packages/ui/test/workspace-shell.test.tsx apps/desktop/test/story-bible-bridge.test.ts apps/desktop/test/project-workflow-bridge.test.ts
npm run typecheck
```

Expected: PASS; chapter maintenance and Story Bible bridge tests remain green while the creative Navigator contains no file tree or Studio configuration entries.

- [ ] **Step 7: Commit the creative Navigator**

```powershell
git add packages/ui/src/creative-workspace-navigator.tsx packages/ui/src/workspace-navigator.tsx packages/ui/src/workspace-shell-types.ts packages/ui/src/index.ts packages/ui/src/styles.css apps/desktop/src/renderer/renderer-workspace-shell.tsx packages/ui/test/workspace-navigator.test.tsx packages/ui/test/workspace-shell.test.tsx apps/desktop/test/story-bible-bridge.test.ts apps/desktop/test/project-workflow-bridge.test.ts
git commit -m "feat: add focused creative navigator"
```

## Task 7: Centralize Every Cross-Surface Navigation Intent

**Files:**

- Modify: `packages/application/src/project-workspace-session.ts`
- Modify: `packages/application/src/desktop-application.ts`
- Modify: `packages/application/src/novel-studio-api.ts`
- Modify: `packages/application/src/index.ts`
- Test: `packages/application/test/project-workflow-session.test.ts`
- Test: `packages/application/test/desktop-project-workflow.test.ts`
- Modify: `apps/desktop/src/main/ipc-handlers.ts`
- Modify: `apps/desktop/src/preload/api.ts`
- Create: `apps/desktop/src/renderer/workspace-navigation.ts`
- Create: `apps/desktop/test/workspace-navigation.test.ts`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/project-workflow-bridge.ts`
- Modify: `apps/desktop/src/renderer/chapter-editor-bridge.ts`
- Modify: `apps/desktop/src/renderer/project-workflow-actions.ts`
- Modify: `apps/desktop/src/renderer/renderer-workspace-shell.tsx`
- Modify: `apps/desktop/src/renderer/project-search-bridge.ts`
- Modify: `apps/desktop/src/renderer/story-bible-bridge.ts`
- Create: `apps/desktop/test/project-search-bridge.test.ts`
- Test: `apps/desktop/test/project-workflow-ipc.test.ts`
- Test: `apps/desktop/test/project-workflow-bridge.test.ts`
- Test: `apps/desktop/test/story-bible-bridge.test.ts`
- Test: `packages/ui/test/workspace-shell.test.tsx`

- [ ] **Step 1: Write failing order and failure-atomicity tests**

Use an operation log and require these exact sequences:

```ts
await navigation.navigateToChapter("ch_01");
expect(log).toEqual([
  "project.selectChapterAndLoad:ch_01",
  "state.workbench:creative",
  "state.navigator:writing",
  "state.activity:workspace",
  "state.surface:editor"
]);

navigation.navigateToStoryEntry("timeline_main");
expect(log).toEqual([
  "story.selectEntry:timeline_main",
  "state.workbench:creative",
  "state.navigator:story",
  "state.activity:storyBible"
]);
```

Add a chapter-load failure after the requested chapter has been validated. Assert `ProjectWorkspaceSession.getSnapshot()`, the active chapter editor session/snapshot, `projectWorkflowBridge.getProps()`, the open tab, and every shell state field all remain on the old chapter. Add a Timeline event fixture `{ id: "event_01", parentEntryId: "timeline_main" }` and assert the coordinator receives `timeline_main`. Add an engineering file open failure and assert workbench mode, active file tab, and editor remain unchanged.

- [ ] **Step 2: Run the focused tests and verify current scattered callbacks fail**

Run:

```powershell
npm test -- packages/application/test/project-workflow-session.test.ts packages/application/test/desktop-project-workflow.test.ts apps/desktop/test/project-workflow-ipc.test.ts apps/desktop/test/project-workflow-bridge.test.ts apps/desktop/test/workspace-navigation.test.ts apps/desktop/test/project-search-bridge.test.ts apps/desktop/test/story-bible-bridge.test.ts packages/ui/test/workspace-shell.test.tsx
```

Expected: FAIL because no atomic chapter selection/load operation exists and `App.tsx`, Search, Timeline, consistency links, and Navigator currently compose state changes independently.

- [ ] **Step 3: Add one atomic Application chapter-selection operation**

Define and export:

```ts
export interface ProjectChapterSelectionResult {
  readonly workspace: ProjectWorkspaceSnapshot;
  readonly chapterEditor: ChapterEditorSnapshot;
}

export interface ProjectChapterSelectionDto {
  readonly workspace: ProjectWorkspaceSnapshotDto;
  readonly chapterEditor: ChapterEditorSnapshot;
}

selectChapterAndLoad(
  chapterId: string
): Promise<Result<ProjectChapterSelectionResult, UnifiedError>>;
```

Inside `ProjectWorkspaceSession`, list/validate the chapter and load recovery metadata, construct a candidate `ChapterEditorSession`, and await its `load()` before assigning `state` or `activeChapterEditorSession`. Only after all reads succeed, assign the new workspace state and editor session together and return both snapshots. On any failure, retain the previous Application state and editor session. `DesktopApplication.selectProjectChapterAndLoad` converts the internal result with `toProjectWorkspaceSnapshotDto` and exposes `ProjectChapterSelectionDto` through preload; Renderer never receives the full `ProjectWorkspaceSnapshot` and never calls `chapter.load` as a second transaction step.

- [ ] **Step 4: Define the one renderer navigation interface**

Create `workspace-navigation.ts` with this public interface:

```ts
export interface WorkspaceNavigation {
  selectWorkbench(mode: WorkbenchMode): void;
  openCreativeProject(): void;
  openEngineeringWorkspace(): void;
  createCreativeProject(): void;
  navigateToChapter(chapterId: string): Promise<void>;
  navigateToStoryKind(kind: StoryBibleEditorKind): void;
  navigateToStoryEntry(entryId: string): void;
  createStoryEntry(kind: StoryBibleEditorKind): void;
  navigateToFile(path: string): Promise<void>;
  openMainReview(review: AgentConversationMainReview): void;
}
```

Its dependency object receives bridge methods plus narrow setters for shell state, project props, story props, file editor props, and main review. Components receive only methods from this interface.

`projectWorkflowBridge.selectChapterAndLoad` is the renderer adapter. It invokes the safe `ProjectChapterSelectionDto`, maps `workspace` to the existing `ProjectWorkflowProps`, maps `chapterEditor` to `ChapterEditorProps`, and returns:

```ts
interface ProjectChapterSelectionBridgeResult {
  readonly projectWorkflow: ProjectWorkflowProps;
  readonly chapterEditor: ChapterEditorProps;
}
```

- [ ] **Step 5: Implement prepare-then-commit renderer transitions**

For async object opens, call the bridge first and update all renderer state only after it succeeds:

```ts
async function navigateToChapter(chapterId: string): Promise<void> {
  const next = await projectWorkflowBridge.selectChapterAndLoad(chapterId);
  setProjectWorkflow(next.projectWorkflow);
  setChapterEditor(next.chapterEditor);
  setFileEditor(undefined);
  setShellState((current) => ({
    ...current,
    workbenchMode: "creative",
    creativeNavigatorMode: "writing",
    activeActivity: "workspace"
  }));
}
```

Use the same pattern for files. Story selection is synchronous but still commits bridge result before shell state. `selectWorkbench("creative")` is a no-op with visible feedback when the current context is `engineeringWorkspace`; it must not synthesize creative assets. A bridge or Application failure returns before any setter runs.

- [ ] **Step 6: Route all current entry points through the coordinator**

Replace direct navigation logic in:

- creative Navigator chapter and story callbacks;
- project Search results;
- Timeline events, using `parentEntryId`;
- Story Bible consistency source/target links;
- project/Explorer Activity selection;
- central Agent “open review” actions;
- engineering file rows.

Remove direct combinations of `setShellState`, `projectWorkflowBridge.selectChapterAndLoad`, `storyBibleBridge.selectEntry`, and `plainFileBridge.openFile` from `App.tsx` after each path is covered by the coordinator.

- [ ] **Step 7: Run focused navigation tests and typecheck**

Run:

```powershell
npm test -- packages/application/test/project-workflow-session.test.ts packages/application/test/desktop-project-workflow.test.ts apps/desktop/test/project-workflow-ipc.test.ts apps/desktop/test/project-workflow-bridge.test.ts apps/desktop/test/workspace-navigation.test.ts apps/desktop/test/project-search-bridge.test.ts apps/desktop/test/story-bible-bridge.test.ts packages/ui/test/workspace-shell.test.tsx
npm run typecheck
```

Expected: PASS; every tested source reaches the same real surface, and a failed chapter/file open leaves Application state, bridge snapshots, tabs, editor content, and shell projection intact.

- [ ] **Step 8: Commit the navigation coordinator**

```powershell
git add packages/application/src/project-workspace-session.ts packages/application/src/desktop-application.ts packages/application/src/novel-studio-api.ts packages/application/src/index.ts packages/application/test/project-workflow-session.test.ts packages/application/test/desktop-project-workflow.test.ts apps/desktop/src/main/ipc-handlers.ts apps/desktop/src/preload/api.ts apps/desktop/src/renderer/workspace-navigation.ts apps/desktop/test/workspace-navigation.test.ts apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/project-workflow-bridge.ts apps/desktop/src/renderer/chapter-editor-bridge.ts apps/desktop/src/renderer/project-workflow-actions.ts apps/desktop/src/renderer/renderer-workspace-shell.tsx apps/desktop/src/renderer/project-search-bridge.ts apps/desktop/src/renderer/story-bible-bridge.ts apps/desktop/test/project-workflow-ipc.test.ts apps/desktop/test/project-workflow-bridge.test.ts apps/desktop/test/project-search-bridge.test.ts apps/desktop/test/story-bible-bridge.test.ts packages/ui/test/workspace-shell.test.tsx
git commit -m "refactor: centralize workspace navigation"
```

## Task 8: Add the Top Workbench Selector and Formal Engineering Explorer

**Files:**

- Create: `packages/ui/src/workbench-switcher.tsx`
- Create: `packages/ui/src/engineering-workspace-navigator.tsx`
- Create: `packages/ui/src/plain-file-conflict-review.tsx`
- Modify: `packages/ui/src/workspace-navigator.tsx`
- Modify: `packages/ui/src/workspace-shell.tsx`
- Modify: `packages/ui/src/workspace-shell-types.ts`
- Modify: `packages/ui/src/workspace-status-bar.tsx`
- Modify: `packages/ui/src/index.ts`
- Modify: `packages/ui/src/styles.css`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/renderer-workspace-shell.tsx`
- Test: `packages/ui/test/workspace-shell.test.tsx`
- Test: `packages/ui/test/workspace-navigator.test.tsx`
- Create: `packages/ui/test/workbench-switcher.test.tsx`
- Create: `packages/ui/test/plain-file-conflict-review.test.tsx`
- Test: `apps/desktop/test/engineering-workspace-bridge.test.ts`
- Create: `apps/desktop/test/unified-workbench.e2e.ts`

- [ ] **Step 1: Write failing shell, engineering Explorer, and conflict-review tests**

Require a visible title-bar control with full labels:

```tsx
expect(screen.getByRole("button", { name: "当前工作台：创作工作台" })).toBeTruthy();
await user.click(screen.getByRole("button", { name: "当前工作台：创作工作台" }));
expect(screen.getByRole("menuitemradio", { name: "创作工作台" })).toHaveAttribute(
  "aria-checked",
  "true"
);
expect(screen.getByRole("menuitemradio", { name: "工程工作台" })).toBeTruthy();
```

For an `engineeringWorkspace`, assert creative is disabled with its reason, the Navigator renders a bounded file tree and truncation notice, directories only expand/collapse, and files call `onFileOpen(path)`. Assert no chapter, Story Bible, Search, Timeline, or Studio entries are rendered. For a creative project in engineering mode, assert the same formal file tree is allowed while the creative mode remains selectable, managed Novel Studio paths show a read-only indicator, and their editor has no content-change/save callback.

Until Task 9 mounts the Agent permanently at the right, assert the existing `ai` Activity remains reachable in both creative and engineering contexts. This is an explicit one-task compatibility bridge, not the final information architecture.

Render a `PlainFileEditorProps.conflict` and assert the central area shows disk content versus draft content with only `重新载入磁盘版本` and `保留当前草稿` actions; no force-overwrite button exists.

- [ ] **Step 2: Run focused UI tests and verify missing workbench controls fail**

Run:

```powershell
npm test -- packages/ui/test/workbench-switcher.test.tsx packages/ui/test/workspace-navigator.test.tsx packages/ui/test/workspace-shell.test.tsx packages/ui/test/plain-file-conflict-review.test.tsx apps/desktop/test/engineering-workspace-bridge.test.ts
```

Expected: FAIL because there is no top workbench switcher, no formal engineering component, and file conflicts are only generic save errors.

- [ ] **Step 3: Implement the accessible workbench switcher**

Use this focused contract:

```ts
export interface WorkbenchSwitcherProps {
  readonly mode: WorkbenchMode;
  readonly creativeDisabledReason?: string;
  readonly onSelect: (mode: WorkbenchMode) => void;
}
```

The trigger text is always `创作工作台` or `工程工作台`, not an icon-only control. Use a button plus `menu`/`menuitemradio`, support ArrowUp/ArrowDown/Home/End/Escape, return focus to the trigger on close, and expose the creative-disabled reason through visible text and `aria-describedby`.

- [ ] **Step 4: Implement the engineering tree as a controlled component**

Define:

```ts
export interface EngineeringWorkspaceNavigatorProps {
  readonly displayName: string;
  readonly tree: EngineeringWorkspaceTreeSnapshot;
  readonly expandedPathIds: readonly string[];
  readonly activeFilePath?: string;
  readonly onExpandedPathIdsChange: (pathIds: readonly string[]) => void;
  readonly onFileOpen: (path: string) => void;
  readonly onRefresh: () => void;
}
```

Directory rows toggle only their own `folder:<path>` ID. File rows use buttons and never expose create/delete/move/rename menus. Show `列表已截断，请缩小目录范围` once when `tree.truncated` is true. Persist expansion through `engineeringExpandedPathIds`; never read legacy creative section IDs.

When `readOnlyReason` exists, show a quiet lock indicator and include the reason in the accessible name/tooltip. Opening that file is allowed for inspection, but `PlainFileEditorProps` omits `onContentChange` and `onSave` and displays the Application-provided guidance. Do not implement a renderer-side path list; Application remains the policy owner.

- [ ] **Step 5: Rebuild the Shell activity and layout projection**

Move `WorkbenchSwitcher` into `ns-titlebar` immediately after the project/workspace name. Build Activity descriptors from context:

```ts
export type WorkspaceActivityId = "project" | "search" | "timeline" | "ai" | "studio" | "settings";

const projectActivities = ["project", "search", "timeline", "ai"] as const;
const bottomActivities = ["studio", "settings"] as const;
```

Use `WorkspaceActivityId` for UI callbacks and map logical `project` selection to internal `workspace | storyBible`. In engineering context, render Explorer, the temporary existing AI Activity, and Settings; Search and engineering Studio remain documented P1 capabilities and must not appear as dead buttons. In creative context retain the existing AI Activity through this commit. Task 9 removes it only in the same commit that makes the right Agent independent of `activeActivity`. Remove the standalone Story Bible icon. Keep layout controls at the right.

When a `creativeProject` changes from creative to engineering workbench, call `EngineeringWorkspaceSession.attachCreativeProject` through `engineeringWorkspaceBridge` and commit the returned tree before changing the visible Navigator. This does not replace `WorkspaceContextDto`, acquire a second project lock, reload Conversation, or clear chapter/file tabs. Switching back to creative reuses the existing project and Story Bible bridge state.

Honor `inspectorCollapsed` in the grid width calculation and hide the resize handle when its panel is collapsed. Apply the small-window order Bottom Panel → Navigator → Agent, leaving the editor visible.

- [ ] **Step 6: Add the file conflict review and context-aware status bar**

When `fileEditor.conflict` exists, central priority becomes file conflict review before the text editor. `重新载入磁盘版本` replaces content/checksum with the current disk snapshot; `保留当前草稿` closes the review and leaves the draft dirty. A later save rechecks the checksum and may surface a fresh conflict.

For plain files, status bar shows save state, line/column or selection, `UTF-8` (the enforced repository encoding), detected `LF | CRLF`, and a filename-extension mode label. For chapters, keep word count, reading time, cursor, and document mode. Do not place these metrics in the editor toolbar.

- [ ] **Step 7: Run focused tests and the new Electron workbench flow**

Run:

```powershell
npm test -- packages/ui/test/workbench-switcher.test.tsx packages/ui/test/workspace-navigator.test.tsx packages/ui/test/workspace-shell.test.tsx packages/ui/test/plain-file-conflict-review.test.tsx apps/desktop/test/engineering-workspace-bridge.test.ts apps/desktop/test/app-shell-support.test.ts
npm run typecheck
npm run build
npx playwright test apps/desktop/test/unified-workbench.e2e.ts apps/desktop/test/project-workflow.e2e.ts
```

Expected: PASS; top workbench selection is discoverable, engineering open/edit/save works without project initialization, creative project switching preserves open editor state, and Agent remains reachable through the temporary AI Activity until Task 9.

- [ ] **Step 8: Commit Gate C workbench UI**

```powershell
git add packages/ui/src/workbench-switcher.tsx packages/ui/src/engineering-workspace-navigator.tsx packages/ui/src/plain-file-conflict-review.tsx packages/ui/src/workspace-navigator.tsx packages/ui/src/workspace-shell.tsx packages/ui/src/workspace-shell-types.ts packages/ui/src/workspace-status-bar.tsx packages/ui/src/index.ts packages/ui/src/styles.css apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/renderer-workspace-shell.tsx packages/ui/test/workspace-shell.test.tsx packages/ui/test/workspace-navigator.test.tsx packages/ui/test/workbench-switcher.test.tsx packages/ui/test/plain-file-conflict-review.test.tsx apps/desktop/test/engineering-workspace-bridge.test.ts apps/desktop/test/unified-workbench.e2e.ts
git commit -m "feat: add creative and engineering workbenches"
```

## Task 9: Make the Right Panel the Permanent, Unique Agent Surface

**Files:**

- Create: `packages/ui/src/agent-conversation-history-drawer.tsx`
- Create: `packages/ui/src/ai-selection-review.tsx`
- Create: `packages/ui/src/ai-workflow-history-panel.tsx`
- Create: `packages/ui/src/recovery-review.tsx`
- Modify: `packages/ui/src/agent-composer.tsx`
- Modify: `packages/ui/src/agent-conversation-view.tsx`
- Modify: `packages/ui/src/agent-conversation-navigator.tsx`
- Modify: `packages/ui/src/workspace-shell.tsx`
- Modify: `packages/ui/src/workspace-shell-types.ts`
- Modify: `packages/ui/src/agent-run-panel.tsx`
- Delete after migration gates pass: `packages/ui/src/workspace-shell-ai.tsx`
- Modify: `packages/ui/src/index.ts`
- Modify: `packages/ui/src/styles.css`
- Modify: `packages/application/src/desktop-application.ts`
- Test: `packages/application/test/desktop-application.test.ts`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/app-shell-support.ts`
- Modify: `apps/desktop/src/renderer/agent-run-bridge.ts`
- Modify: `apps/desktop/src/renderer/agent-conversation-bridge.ts`
- Modify: `apps/desktop/src/renderer/agent-conversation-workspace.ts`
- Modify: `apps/desktop/src/renderer/ai-writing-workflow-actions.ts`
- Modify: `apps/desktop/src/renderer/renderer-workspace-shell.tsx`
- Test: `packages/ui/test/agent-composer.test.tsx`
- Test: `packages/ui/test/agent-conversation-view.test.tsx`
- Test: `packages/ui/test/agent-conversation-navigator.test.tsx`
- Test: `packages/ui/test/agent-conversation-workspace.test.tsx`
- Test: `packages/ui/test/agent-run-panel.test.tsx`
- Test: `packages/ui/test/ai-writing-workflow.test.tsx`
- Test: `packages/ui/test/editor-runtime-workflow-ux.test.tsx`
- Test: `packages/ui/test/workspace-shell.test.tsx`
- Create: `packages/ui/test/recovery-review.test.tsx`
- Test: `apps/desktop/test/app-shell-support.test.ts`
- Test: `apps/desktop/test/agent-run-bridge.test.ts`
- Test: `apps/desktop/test/agent-conversation-bridge.test.ts`
- Test: `apps/desktop/test/ai-writing-workflow-bridge.test.ts`
- Test: `apps/desktop/test/agent-conversations.e2e.ts`
- Test: `apps/desktop/test/agent-run.e2e.ts`
- Test: `apps/desktop/test/agent-write.e2e.ts`
- Test: `apps/desktop/test/agent-run-autonomy.e2e.ts`
- Test: `apps/desktop/test/agent-context-runtime.e2e.ts`
- Test: `apps/desktop/test/agent-permission-plan.e2e.ts`
- Test: `apps/desktop/test/agent-diagnostics.e2e.ts`
- Test: `apps/desktop/test/ai-writing-workflow.e2e.ts`

- [ ] **Step 1: Write failing one-surface and capability-reachability tests**

Across creative writing, Story Bible, engineering file, Search, Timeline, Studio, Plan, Change Set, rollback, recovery, and active-run states, assert:

```tsx
expect(container.querySelectorAll('textarea[aria-label="Agent 请求"]')).toHaveLength(1);
expect(container.querySelectorAll('[aria-label="会话输入区"]')).toHaveLength(1);
expect(container.querySelectorAll('[aria-label="AI 对话面板"]')).toHaveLength(1);
expect(container.querySelector('[data-activity-id="ai"]')).toBeNull();
expect(container.querySelector('[aria-label="AI 写作工作流"]')).toBeNull();
```

Add reachability tests proving:

- Conversation list/search/archive/restore opens from a right-panel history button and does not replace the project Navigator;
- Plan, Change Set, Diff, rollback, recovery, and selection review open in the central area;
- chapter autosave recovery still exposes preview/apply/discard, while Agent transaction recovery remains visibly `recovery_required` and links to the existing rollback/retry path rather than displaying success;
- Composer still contains Plan/Act, `writing/general_file`, approval, model, reasoning, references, context status, and one send/stop slot;
- engineering exposes only `general_file`; creative exposes both contexts;
- current selection rewrite and style review can be triggered from an Agent quick action and accept/reject/undo remain available;
- workflow run history remains reachable from the existing Bottom Panel projection;
- no hardcoded `prj_minimal_chapter` Conversation or run is created when context is `none`.

- [ ] **Step 2: Run focused tests and verify duplicate routing fails**

Run:

```powershell
npm test -- packages/application/test/desktop-application.test.ts packages/ui/test/agent-composer.test.tsx packages/ui/test/agent-conversation-view.test.tsx packages/ui/test/agent-conversation-navigator.test.tsx packages/ui/test/agent-conversation-workspace.test.tsx packages/ui/test/agent-run-panel.test.tsx packages/ui/test/ai-writing-workflow.test.tsx packages/ui/test/editor-runtime-workflow-ux.test.tsx packages/ui/test/recovery-review.test.tsx packages/ui/test/workspace-shell.test.tsx apps/desktop/test/app-shell-support.test.ts apps/desktop/test/agent-run-bridge.test.ts apps/desktop/test/agent-conversation-bridge.test.ts apps/desktop/test/ai-writing-workflow-bridge.test.ts
```

Expected: FAIL because `ai` still changes Navigator ownership, the right panel alternates between two assistants, and legacy workflow UI contains another textarea/model/reasoning surface.

- [ ] **Step 3: Add workspace-aware Composer availability without changing Stage 5 enums**

Extend `AgentComposerProps` only with optional presentation controls:

```ts
export interface AgentComposerQuickAction {
  readonly id: "rewrite_selection" | "review_style";
  readonly label: string;
  readonly disabledReason?: string;
  readonly onSelect: () => void;
}

export interface AgentComposerProps {
  readonly availableContextModes?: readonly AgentContextMode[];
  readonly quickActions?: readonly AgentComposerQuickAction[];
}
```

Add these two optional fields to the current interface without changing or removing any existing Stage 5 field.

Default `availableContextModes` to both existing modes so current tests and creative behavior remain stable. Hide a mode only when it is absent from the array; do not add a third mode or rename the underlying enums. Render quick actions next to existing reference/context controls, not above the composer as a second toolbar.

- [ ] **Step 4: Move Conversation history inside the right panel**

Create `AgentConversationHistoryDrawer` as a wrapper around the existing `AgentConversationNavigator` props. Add one `历史会话` button in the Agent panel header; opening it displays list/search/archive/restore in an overlay/drawer within the same right region. Escape closes the drawer and returns focus. The project Navigator remains mounted and unchanged.

`AgentConversationView` owns this drawer, the current conversation turns, `AgentRunPanel`, and the one `AgentComposer`. It does not render another Inspector or ask `WorkspaceShell` to replace the left Navigator.

- [ ] **Step 5: Move every review to central ownership**

Extend `AgentConversationMainReview` with the compatibility selection review:

```ts
export type RecoveryReviewProps =
  | {
      readonly source: "chapter_autosave";
      readonly recovery: ProjectWorkflowRecoveryProps;
      readonly chapters: ProjectWorkflowProps["chapters"];
      readonly onPreview: (sessionId: string) => void;
      readonly onApply: (sessionId: string) => void;
      readonly onDiscard: (sessionId: string) => void;
    }
  | {
      readonly source: "agent_transaction";
      readonly runId: string;
      readonly versionGroupId?: string;
      readonly errorCode: string;
      readonly message: string;
      readonly failedHooks: readonly string[];
      readonly onOpenRollback?: () => void;
      readonly onRetry?: () => void;
    };

export type AgentConversationMainReview =
  | { readonly kind: "plan"; readonly props: PlanArtifactReviewProps }
  | { readonly kind: "change_set"; readonly props: ChangeSetReviewProps }
  | { readonly kind: "rollback"; readonly props: RollbackReviewProps }
  | { readonly kind: "recovery"; readonly props: RecoveryReviewProps }
  | { readonly kind: "selection"; readonly props: AiSelectionReviewProps };
```

Create `AiSelectionReview` by extracting the existing selection diff, style hits, accept, reject, undo, diagnostic, and retry presentation from `workspace-shell-ai.tsx`. Create `RecoveryReview` as a central projection: chapter autosave retains the existing preview/apply/discard callbacks; Agent transaction recovery displays the existing run/version-group diagnostic and only routes to already-supported rollback/retry actions. It must not invent a direct filesystem repair or mark partial failure successful. Wire the current autosave recovery notice to open this central review, and map existing Agent `recoveryState === "recovery_review"` / synchronization facts into the transaction variant. Use fixed central priority `recovery > rollback > change_set > selection > plan > active editor`. The right Conversation shows a compact summary plus `在中央查看` action.

- [ ] **Step 6: Preserve legacy writing workflow capabilities without preserving its composer**

Keep `ai-writing-workflow-session.ts`, its IPC, bridge, and focused tests as compatibility services. Change renderer use as follows:

- free-form current-chapter requests start from the existing Agent Composer in `writing` context;
- `改写当前选区` calls the existing selection preview action with the current editor selection, then opens `kind: "selection"` centrally;
- `检查文风与一致性` uses the same existing selection/style workflow and central review;
- model and reasoning selection come only from `AgentComposer`;
- old workflow errors appear in the central selection review or a compact Agent notice;
- `AiWorkflowRunHistory` moves to `ai-workflow-history-panel.tsx` and remains in Bottom Panel.

Only after these focused tests pass, delete `workspace-shell-ai.tsx`, remove its second textarea/send/model/reasoning DOM, and stop passing `aiWritingWorkflow` as a right-panel assistant prop. Do not delete Application workflow/session APIs in this plan.

- [ ] **Step 7: Remove the independent AI Activity and fallback IDs**

Remove `"ai"` from `ActivityId`, application activity arrays, the temporary Task 8 `WorkspaceActivityId` union and `projectActivities` array, command/activity transition tests, `apps/desktop/src/renderer/app-shell-support.ts`, `renderer-workspace-shell.tsx`, and `workspace-shell.tsx`. Update all fixtures that currently set `activeActivity: "ai"`, including `desktop-application.test.ts`, `app-shell-support.test.ts`, `agent-conversation-workspace.test.tsx`, `ai-writing-workflow.test.tsx`, `editor-runtime-workflow-ux.test.tsx`, and `workspace-shell.test.tsx`. Do not delete unrelated identifiers such as the onboarding step `{ id: "ai" }` or IPC channel names. The Agent panel renders whenever `workspaceContext.kind !== "none"`, independent of `activeActivity`. It remains mounted when the workbench, Search, Timeline, Story Bible, Studio, or central review changes.

In `App.tsx`, derive Conversation/Agent `projectId` from `workspaceContext.workspaceId`. When context is `none`, do not instantiate/load a virtual project Conversation and do not call Agent APIs.

- [ ] **Step 8: Run focused one-surface tests and typecheck**

Run:

```powershell
npm test -- packages/application/test/desktop-application.test.ts packages/ui/test/agent-composer.test.tsx packages/ui/test/agent-conversation-view.test.tsx packages/ui/test/agent-conversation-navigator.test.tsx packages/ui/test/agent-conversation-workspace.test.tsx packages/ui/test/agent-run-panel.test.tsx packages/ui/test/ai-writing-workflow.test.tsx packages/ui/test/editor-runtime-workflow-ux.test.tsx packages/ui/test/recovery-review.test.tsx packages/ui/test/workspace-shell.test.tsx apps/desktop/test/app-shell-support.test.ts apps/desktop/test/agent-run-bridge.test.ts apps/desktop/test/agent-conversation-bridge.test.ts apps/desktop/test/ai-writing-workflow-bridge.test.ts
npm run typecheck
rg -n 'activeActivity[^\n]*"ai"|activityId === "ai"|case "ai"|data-activity-id="ai"|projectActivities[^\n]*"ai"|WorkspaceActivityId[^\n]*"ai"' packages/application/src packages/application/test apps/desktop/src apps/desktop/test packages/ui/src packages/ui/test
```

Expected: tests and typecheck PASS; the final `rg` exits 1 with no Activity-related matches. Global DOM has one composer, recovery remains actionable, all existing writing review actions are reachable, and Stage 5 composer/permission/context behavior remains unchanged.

- [ ] **Step 9: Run the Agent Electron regression set**

Run:

```powershell
npm run build
npx playwright test apps/desktop/test/agent-conversations.e2e.ts apps/desktop/test/agent-run.e2e.ts apps/desktop/test/agent-write.e2e.ts apps/desktop/test/agent-run-autonomy.e2e.ts apps/desktop/test/agent-context-runtime.e2e.ts apps/desktop/test/agent-permission-plan.e2e.ts apps/desktop/test/agent-diagnostics.e2e.ts apps/desktop/test/ai-writing-workflow.e2e.ts
```

Expected: PASS; Plan/Act, approval, context, Conversation history, Change Set apply, auto-approval scope, recovery, and undo remain valid in the one Agent surface.

- [ ] **Step 10: Commit Gate D single-Agent ownership**

```powershell
git add packages/ui/src/agent-conversation-history-drawer.tsx packages/ui/src/ai-selection-review.tsx packages/ui/src/ai-workflow-history-panel.tsx packages/ui/src/recovery-review.tsx packages/ui/src/agent-composer.tsx packages/ui/src/agent-conversation-view.tsx packages/ui/src/agent-conversation-navigator.tsx packages/ui/src/workspace-shell.tsx packages/ui/src/workspace-shell-types.ts packages/ui/src/agent-run-panel.tsx packages/ui/src/workspace-shell-ai.tsx packages/ui/src/index.ts packages/ui/src/styles.css packages/application/src/desktop-application.ts packages/application/test/desktop-application.test.ts apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/app-shell-support.ts apps/desktop/src/renderer/agent-run-bridge.ts apps/desktop/src/renderer/agent-conversation-bridge.ts apps/desktop/src/renderer/agent-conversation-workspace.ts apps/desktop/src/renderer/ai-writing-workflow-actions.ts apps/desktop/src/renderer/renderer-workspace-shell.tsx packages/ui/test/agent-composer.test.tsx packages/ui/test/agent-conversation-view.test.tsx packages/ui/test/agent-conversation-navigator.test.tsx packages/ui/test/agent-conversation-workspace.test.tsx packages/ui/test/agent-run-panel.test.tsx packages/ui/test/ai-writing-workflow.test.tsx packages/ui/test/editor-runtime-workflow-ux.test.tsx packages/ui/test/recovery-review.test.tsx packages/ui/test/workspace-shell.test.tsx apps/desktop/test/app-shell-support.test.ts apps/desktop/test/agent-run-bridge.test.ts apps/desktop/test/agent-conversation-bridge.test.ts apps/desktop/test/ai-writing-workflow-bridge.test.ts apps/desktop/test/agent-conversations.e2e.ts apps/desktop/test/agent-run.e2e.ts apps/desktop/test/agent-write.e2e.ts apps/desktop/test/agent-run-autonomy.e2e.ts apps/desktop/test/agent-context-runtime.e2e.ts apps/desktop/test/agent-permission-plan.e2e.ts apps/desktop/test/agent-diagnostics.e2e.ts apps/desktop/test/ai-writing-workflow.e2e.ts
git commit -m "refactor: unify the agent conversation surface"
```

## Task 10: Complete Native Project Entry, Stable Agent Surface, Visual Hierarchy, Settings, Accessibility, and Release Gates

**Files:**

- Modify: `packages/application/src/command-registry.ts`
- Modify: `packages/application/src/ipc-contract.ts`
- Modify: `packages/application/src/novel-studio-api.ts`
- Modify: `apps/desktop/src/main/menu.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/preload/index.cts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/preload/api.ts`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/agent-conversation-workspace.ts`
- Modify: `apps/desktop/src/renderer/renderer-workspace-shell.tsx`
- Modify: `apps/desktop/src/renderer/workspace-navigation.ts`
- Modify: `apps/desktop/electron-builder.config.cjs`
- Modify: `packages/ui/src/styles.css`
- Modify: `packages/ui/src/settings-workspace.tsx`
- Modify: `packages/ui/src/settings-panel-tabs.tsx`
- Modify: `packages/ui/src/model-settings-panel.tsx`
- Modify: `packages/ui/src/agent-usage-settings.tsx`
- Modify: `packages/ui/src/agent-composer.tsx`
- Modify: `packages/ui/src/agent-conversation-view.tsx`
- Modify: `packages/ui/src/creative-workspace-navigator.tsx`
- Modify: `packages/ui/src/workspace-navigator.tsx`
- Modify: `packages/ui/src/workspace-shell.tsx`
- Modify: `packages/ui/src/workspace-shell-project-assist.tsx`
- Modify: `packages/ui/src/workspace-shell-types.ts`
- Modify: `packages/ui/src/workspace-status-bar.tsx`
- Create: `packages/ui/src/project-create-dialog.tsx`
- Create: `packages/ui/test/project-create-dialog.test.tsx`
- Modify: `apps/desktop/test/application-menu.test.ts`
- Modify: `apps/desktop/test/app-shell-support.test.ts`
- Modify: `apps/desktop/test/beta-packaging.test.ts`
- Modify: `packages/ui/test/agent-composer.test.tsx`
- Modify: `packages/ui/test/agent-conversation-view.test.tsx`
- Modify: `packages/ui/test/agent-conversation-workspace.test.tsx`
- Modify: `packages/ui/test/workspace-navigator.test.tsx`
- Modify: `packages/ui/test/settings-and-studio.test.tsx`
- Modify: `packages/ui/test/workspace-shell.test.tsx`
- Modify: `apps/desktop/test/project-workflow.e2e.ts`
- Modify: `apps/desktop/test/settings-editor-chrome.e2e.ts`
- Modify: `apps/desktop/test/agent-usage-settings.e2e.ts`
- Modify: `apps/desktop/test/unified-workbench.e2e.ts`
- Test: all files listed in the final verification matrix below

**Mature-product design audit applied by this task:**

- VS Code assigns Explorer to the Primary Side Bar, Chat to the Secondary Side Bar, and keeps the Editor as the largest remaining region; Novel Studio keeps the same stable ownership.
- VS Code opens a workspace through `File > Open Folder...` and restores workspace-specific UI state. Novel Studio uses the Electron native “文件” menu plus a central welcome surface for global project lifecycle commands, while Navigator owns only current content.
- Codex-style project/task binding keeps the conversation surface stable while the bound project and task context change. Novel Studio therefore keeps one Agent shell visible, but does not invent a Conversation or Run before a workspace is bound.
- `WorkbenchMode` remains a layout/navigation state and `AgentContextMode` remains a per-run context-engineering state. The UI uses “写作上下文 / 文件上下文” labels instead of presenting them as a second pair of workbench names.

Review evidence: [VS Code User Interface](https://code.visualstudio.com/docs/editing/userinterface) and [VS Code Workspaces](https://code.visualstudio.com/docs/editing/workspaces/workspaces).

- [ ] **Step 1: Write failing ownership, native-menu, stable-Agent, layout, focus, and packaging tests**

Add jsdom assertions for:

- the Electron native “文件” submenu contains “新建创作项目… / 打开创作项目… / 打开工程文件夹…” before “关闭窗口” and exposes stable semantic command IDs;
- invoking a native project command reaches the focused Renderer command subscription exactly once and reuses `WorkspaceNavigation`; `menu.ts` has no Repository, filesystem, selection-token, or project-session dependency;
- repeated Renderer mounts/subscriptions do not duplicate one native-menu click, and a missing/destroyed focused window is a safe no-op;
- the empty and creative Navigators contain no application-level “打开项目 / 创建项目 / 打开工程目录” buttons and no persistent project title/folder/parent-directory creation form;
- the central create dialog owns project title, folder name, parent-directory selection, cancel, create, busy, failure, Escape, and focus-return behavior;
- `workspaceContext.kind === "none"` still renders exactly one `AgentConversationView` and one `aria-label="会话输入区"`, with send/create/history/model/context actions disabled and no Conversation/Run callbacks;
- opening Settings changes only the central Editor Area and keeps the same Navigator, Agent Surface, Status Bar, active Conversation, and run state mounted;
- a bound creative or engineering workspace reuses that single Agent region; there is never a second textarea or a second Agent panel;
- Composer presents “写作上下文 / 文件上下文”; creative projects keep both Stage 5 contexts, engineering workspaces expose only file context, and workbench switching does not rewrite an active run or persisted Plan;
- settings uses one main form column and no two-column summary card;
- labels and their controls stay in a grid that permits wrapping without placing an action button on the same constrained text line;
- no settings root has `scrollWidth > clientWidth` in the 220px Navigator / narrow-shell fixture;
- editor document bar contains tabs, find, save, and layout actions only, with no model/run/word-count badge stack;
- model, reasoning, mode, approval, references, and send remain inside `aria-label="会话输入区"`;
- collapsed Navigator/Agent hide their resize handles;
- every icon-only button has an accessible name and visible `:focus-visible` style;
- CSS contains a `@media (prefers-reduced-motion: reduce)` override that disables non-essential transitions;
- Electron Builder keeps only `zh-CN` and `en-US` locale packs, while settings do not expose a fake UI-language selector without translation catalogs.

Add Playwright/Electron assertions for native File-menu routing, central create/open flows, no-workspace Agent rendering without Agent API calls, creative/engineering binding, settings overflow, Agent composer grouping, editor toolbar cleanliness, and status bar visibility at normal and narrow window sizes.

- [ ] **Step 2: Run the focused ownership/visual collection and verify the new tests fail**

Run:

```powershell
npm test -- apps/desktop/test/application-menu.test.ts apps/desktop/test/app-shell-support.test.ts apps/desktop/test/beta-packaging.test.ts packages/ui/test/project-create-dialog.test.tsx packages/ui/test/agent-composer.test.tsx packages/ui/test/agent-conversation-view.test.tsx packages/ui/test/agent-conversation-workspace.test.tsx packages/ui/test/workspace-navigator.test.tsx packages/ui/test/settings-and-studio.test.tsx packages/ui/test/workspace-shell.test.tsx
npm run build
npx playwright test apps/desktop/test/project-workflow.e2e.ts apps/desktop/test/settings-editor-chrome.e2e.ts apps/desktop/test/agent-usage-settings.e2e.ts apps/desktop/test/unified-workbench.e2e.ts
```

Expected: FAIL because the File menu only closes the window, project lifecycle controls still live in Navigator, no-workspace Agent uses a replacement placeholder, locale packs are unrestricted, and the current settings/layout grouping still overflows or exposes dead handles.

- [ ] **Step 3: Move project lifecycle commands into the native File menu and central task surfaces**

Add a closed `NativeMenuCommandId` union for create creative project, open creative project, and open engineering folder. Build the Electron menu from injected semantic command handlers; each click resolves the current focused, non-destroyed Novel Studio window at click time and otherwise safely no-ops. Main sends only an allowlisted command over a narrow channel, preload exposes subscribe/unsubscribe, and `App.tsx` dispatches into the existing `WorkspaceNavigation` handlers exactly once. Do not accept arbitrary channel payloads or call dialog, Repository, project workflow Session, or activation coordinator from `menu.ts`.

Move the current creation form out of `CreativeWorkspaceNavigator` into `ProjectCreateDialog` (or an equivalent central modal editor). The native menu opens that surface; the central no-workspace welcome surface may open the same surface. Opening a creative project or engineering folder may proceed directly to the existing secure selection-token flow. Remove all three application lifecycle buttons from `WorkspaceNavigator` and remove persistent create controls from the bound creative Navigator. A menu-triggered failure preserves the old workspace and reports through the same workflow feedback.

Do not add “最近打开”, “全部保存”, or “关闭工作区” until their repositories/commands exist. Preserve the existing “关闭窗口” item and localized Edit/View/Window/Help menus.

- [ ] **Step 4: Keep one complete Agent surface mounted before and after workspace binding**

Represent Agent availability explicitly as `unbound | loading | ready` in UI props. `WorkspaceShell` always renders the same `AgentConversationView` region, including while Settings or another central surface is open. In `unbound`, render the Conversation header/empty state and the full Composer group with inert disabled controls and a precise disabled reason. Do not instantiate `createAgentConversationBridge`, load a draft, call Agent IPC, or create any Conversation/Run/virtual project ID until a real `workspaceId` exists.

This intentionally supersedes Task 9 Step 7's temporary presentation rule that rendered the Agent only for `workspaceContext.kind !== "none"`; it does not supersede Task 9's no-virtual-Conversation/no-Agent-API invariant.

Keep `WorkbenchMode` and `AgentContextMode` separate. Rename the visible context choices to “写作上下文 / 文件上下文”; creative projects retain both and default to writing, engineering workspaces retain only file context. Switching workbench must not alter an active run, persisted Plan, Conversation sequence, or Context Snapshot. Existing draft normalization for a real engineering workspace continues through the Application draft mutation rather than presentation-only state.

- [ ] **Step 5: Apply the restrained professional visual system**

Keep standard DOM/CSS and the existing second-version IDE structure. Use the current neutral dark/light tokens and restrained teal accent; do not add decorative textures, particles, continuous animation, Canvas text, or a broad “Chinese skin.” Chinese context is expressed through clear Chinese labels and long-form typography, not ornamental chrome.

Use these layout constraints:

```css
.ns-titlebar {
  min-height: 38px;
}
.ns-activity-bar {
  width: 46px;
}
.ns-workspace-navigator {
  min-width: 220px;
  max-width: 420px;
}
.ns-ai-panel {
  min-width: 280px;
  max-width: 520px;
}
.ns-status-bar {
  min-height: 24px;
}
.ns-editor-area {
  min-width: 0;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
```

Use flex/grid children with `min-width: 0`, ellipsis for long project/file names, and overlay menus/drawers that do not resize adjacent rows.

Match the approved workbench reference at the level of hierarchy and proportion rather than pixel-copying it: native application menu above the custom Title Bar; project identity, workbench selector, Command Center, and layout controls in the Title Bar; Activity Bar + content-only Navigator on the left; tabbed Editor as the largest region; one stable Agent conversation with Composer on the right; Status Bar at the bottom. The bound creative Navigator starts with writing/story tabs and content filtering, not project creation controls.

- [ ] **Step 6: Rebuild settings as category navigation plus one form column and constrain packaged locales**

Keep existing settings categories and behavior, but render Settings inside the central Editor Area rather than replacing the entire Workbench Shell. The selected category uses one main column. Labels occupy their own row or a stable label column; connection test/save/default actions live in a separate action row. Preserve model profiles, model discovery, secrets, plugin settings, Agent usage settings, appearance, editor preferences, the surrounding Navigator/Agent/Status Bar, and the pre-Settings central-surface focus target. Do not remove a setting to solve overflow.

Set Electron Builder `electronLanguages` to `['zh-CN', 'en-US']` and extend packaging tests to prove other `.pak` files are omitted. Treat this only as Chromium/Electron resource trimming. Do not add a UI language selector until a separate i18n contract provides translation catalogs, fallback behavior, an app-local locale preference, and restart semantics for native UI.

- [ ] **Step 7: Verify the requested UI problem list explicitly**

Add named Playwright assertions and screenshots proving:

```ts
await expect(settingsRoot).toHaveJSProperty(
  "scrollWidth",
  await settingsRoot.evaluate((el) => el.clientWidth)
);
await expect(page.locator('[aria-label="会话输入区"]')).toContainText("规划");
await expect(page.locator('[aria-label="会话输入区"]')).toContainText("模型");
await expect(page.getByLabel("Agent 会话主视图")).toBeVisible();
await expect(page.locator('[aria-label="会话输入区"]')).toBeVisible();
await expect(page.getByRole("button", { name: "启动 Agent 运行" })).toBeDisabled();
const navigator = page.getByLabel("工作区导航");
await expect(navigator.getByRole("button", { name: "打开项目" })).toHaveCount(0);
await expect(navigator.getByRole("button", { name: "创建项目" })).toHaveCount(0);
await expect(page.locator('[aria-label="编辑区"] .ns-editor-document-bar')).not.toContainText(
  "运行状态"
);
await expect(page.locator('[aria-label="状态栏"]')).toBeVisible();
```

Use Electron `Menu.getApplicationMenu()` assertions to prove the native “文件” submenu and click routing; page screenshots cannot capture native window chrome and are not a substitute for menu assertions. Capture normal-window and narrow-window evidence for the unbound welcome surface, creative workbench, engineering workbench, settings page, and Agent composer. Store screenshots in Playwright output, not as committed product assets, and attach them to the implementation handoff.

- [ ] **Step 8: Run the focused closeout tests**

Run:

```powershell
npm test -- apps/desktop/test/application-menu.test.ts apps/desktop/test/app-shell-support.test.ts apps/desktop/test/beta-packaging.test.ts packages/ui/test/project-create-dialog.test.tsx packages/ui/test/settings-and-studio.test.tsx packages/ui/test/workspace-shell.test.tsx packages/ui/test/workspace-navigator.test.tsx packages/ui/test/agent-composer.test.tsx packages/ui/test/agent-conversation-view.test.tsx packages/ui/test/agent-conversation-workspace.test.tsx
npm run build
npx playwright test apps/desktop/test/project-workflow.e2e.ts apps/desktop/test/settings-editor-chrome.e2e.ts apps/desktop/test/agent-usage-settings.e2e.ts apps/desktop/test/unified-workbench.e2e.ts
npm run typecheck
npm run lint
```

Expected: PASS with semantic native-menu routing, no project lifecycle form in Navigator, one stable Agent surface in unbound/bound states, no virtual Conversation/Run, only supported locale packs, and no horizontal overflow, clipped labels, duplicate Agent controls, dead resize handles, or inaccessible icon buttons.

- [ ] **Step 9: Run the complete final verification on the final worktree**

Run the required focused integration set:

```powershell
npm test -- packages/application/test/user-preferences-session.test.ts packages/repository/test/project-workflow.test.ts packages/application/test/project-workflow-session.test.ts packages/application/test/desktop-project-workflow.test.ts packages/application/test/engineering-workspace-session.test.ts packages/repository/test/engineering-workspace-repository.test.ts packages/repository/test/workspace-state-repository.test.ts packages/ui/test/project-create-dialog.test.tsx packages/ui/test/workspace-navigator.test.tsx packages/ui/test/workspace-shell.test.tsx packages/ui/test/agent-composer.test.tsx packages/ui/test/agent-conversation-view.test.tsx packages/ui/test/agent-conversation-workspace.test.tsx apps/desktop/test/application-menu.test.ts apps/desktop/test/app-shell-support.test.ts apps/desktop/test/beta-packaging.test.ts apps/desktop/test/project-workflow-bridge.test.ts apps/desktop/test/project-workflow-ipc.test.ts apps/desktop/test/engineering-workspace-bridge.test.ts apps/desktop/test/workspace-activation.test.ts
```

Run static and full-unit gates:

```powershell
npm run typecheck
npm run lint
npm test -- --no-file-parallelism
npm run build
npm run package:check
```

Run Electron acceptance:

```powershell
npm run build
npx playwright test apps/desktop/test/project-workflow.e2e.ts apps/desktop/test/unified-workbench.e2e.ts apps/desktop/test/agent-conversations.e2e.ts apps/desktop/test/agent-run.e2e.ts apps/desktop/test/agent-write.e2e.ts apps/desktop/test/agent-run-autonomy.e2e.ts apps/desktop/test/agent-context-runtime.e2e.ts apps/desktop/test/agent-permission-plan.e2e.ts apps/desktop/test/agent-diagnostics.e2e.ts apps/desktop/test/ai-writing-workflow.e2e.ts apps/desktop/test/settings-editor-chrome.e2e.ts apps/desktop/test/agent-usage-settings.e2e.ts
```

Expected: every command exits 0. If any command fails, identify and fix the root cause, then rerun that command and every later gate on the resulting final worktree. Do not report completion from an earlier intermediate tree.

- [ ] **Step 10: Commit Gate E unified-workbench closeout**

```powershell
git add packages/application/src/command-registry.ts packages/application/src/ipc-contract.ts packages/application/src/novel-studio-api.ts apps/desktop/src/main/menu.ts apps/desktop/src/main/index.ts apps/desktop/src/preload/index.cts apps/desktop/src/preload/index.ts apps/desktop/src/preload/api.ts apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/agent-conversation-workspace.ts apps/desktop/src/renderer/renderer-workspace-shell.tsx apps/desktop/src/renderer/workspace-navigation.ts apps/desktop/electron-builder.config.cjs packages/ui/src/project-create-dialog.tsx packages/ui/src/agent-composer.tsx packages/ui/src/agent-conversation-view.tsx packages/ui/src/creative-workspace-navigator.tsx packages/ui/src/workspace-navigator.tsx packages/ui/src/workspace-shell.tsx packages/ui/src/workspace-shell-project-assist.tsx packages/ui/src/workspace-shell-types.ts packages/ui/src/workspace-status-bar.tsx packages/ui/src/settings-workspace.tsx packages/ui/src/settings-panel-tabs.tsx packages/ui/src/model-settings-panel.tsx packages/ui/src/agent-usage-settings.tsx packages/ui/src/styles.css apps/desktop/test/application-menu.test.ts apps/desktop/test/app-shell-support.test.ts apps/desktop/test/beta-packaging.test.ts packages/ui/test/project-create-dialog.test.tsx packages/ui/test/agent-composer.test.tsx packages/ui/test/agent-conversation-view.test.tsx packages/ui/test/agent-conversation-workspace.test.tsx packages/ui/test/workspace-navigator.test.tsx packages/ui/test/settings-and-studio.test.tsx packages/ui/test/workspace-shell.test.tsx apps/desktop/test/project-workflow.e2e.ts apps/desktop/test/settings-editor-chrome.e2e.ts apps/desktop/test/agent-usage-settings.e2e.ts apps/desktop/test/unified-workbench.e2e.ts
git commit -m "feat: complete the unified workbench experience"
```

## Required Follow-Up Capability Ledger

These are retained product requirements, not deleted ideas. They are intentionally separated because each needs its own data, permission, and test contract.

| Priority | Capability                                                 | Why it matters                                                                         | Required boundary before implementation                                                                                                                          |
| -------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1       | Engineering full-text search + Agent `search_project_text` | Large projects cannot rely on browsing filenames or reading one known file at a time   | Search index ownership, ignore rules, result limits, binary exclusion, permission/audit contract, Search Activity and central result navigation                  |
| P1       | Recent creative projects and engineering workspaces        | Removes repeated directory selection in normal daily use                               | App-local recent-item repository, context kind, canonical root validation, missing-path handling, welcome-page/open-menu UI                                      |
| P1       | Engineering Prompt/Agent/Workflow Studio                   | Enables reusable code-review, refactor, testing, and multi-step automation presets     | Store config under engineering `stateRoot`, define engineering schemas/defaults, retain Studio version restore, never write Novel assets into `contentRoot`      |
| P1       | Existing-file create/delete/move/rename                    | Needed for a mature engineering Explorer                                               | Application/Repository commands, canonical path guard, confirmation and conflict rules, Agent Change Set integration, recovery/undo semantics                    |
| P2       | Controlled command execution and task running              | Needed for full Codex/Cline-style coding loops                                         | Shell-tool specification, per-command approval, cwd/environment isolation, output limits, timeout/cancel, audit and recovery; no unrestricted terminal shortcut  |
| P2       | Application UI internationalization and language selection | A real language selector must translate the complete product, not only Electron chrome | App-local locale preference, translation catalogs, fallback/missing-key policy, live-vs-restart behavior, supported-locale packaging, full UI and Electron tests |
| P2/P3    | Git UI, LSP, debugger                                      | Improves engineering productivity after core workspace safety is stable                | Separate provider/process contracts and product prioritization; must not be hidden inside this Navigator redesign                                                |

## Completion Definition

This plan is complete only when:

- creating a creative project produces one new child folder and never initializes the selected parent;
- opening an ordinary engineering folder writes no Novel Studio structure into it;
- creative projects switch between creative and engineering workbenches without losing drafts, tabs, Conversation, active run, Plan, Change Set, or review state;
- the Electron native File menu owns create/open project commands, the central welcome surface can repeat them, and Navigator contains no persistent project lifecycle form;
- the creative Navigator contains only writing/story projections and the engineering Navigator contains only the formal file tree;
- the application renders one stable right-side Agent surface before and after workspace binding; the unbound Composer is visible but inert and creates no virtual Conversation/Run;
- Workbench and Agent context remain separate state dimensions, with unambiguous “写作上下文 / 文件上下文” labels and unchanged active-run/Plan semantics;
- packaged Electron locales are limited to `zh-CN` and `en-US`, without claiming application-level i18n;
- existing selection review, style review, Plan, Diff, Change Set, rollback, recovery, undo, Studio, Search, Timeline, and chapter operations remain reachable where their current data model supports them;
- all focused, full Vitest, typecheck, lint, build, package, and Electron commands above pass on the final worktree.
