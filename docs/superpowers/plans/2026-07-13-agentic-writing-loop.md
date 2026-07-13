# Agentic Writing Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Agentic Writing Loop described in design v1.4, beginning with a verified Electron streaming baseline and ending with an explicitly user-authorized full-autonomy write mode, while preserving project-root isolation, approval, versioning, recovery, idempotency, and event contracts.

**Architecture:** Keep Renderer as an event consumer and move loop control into an application-level Agent Run Coordinator. Main/preload expose a push-oriented, clone-safe event DTO and snapshot recovery contract; Repository owns path checks, snapshots, journals, and durable project-root data; Change Set and Version Group services make candidate diffs and real writes auditable. Planning/execution, writing/general-file context, and write-before-confirmation/this-run-auto-write remain three independent axes.

**Tech Stack:** TypeScript strict mode, Electron main/preload/renderer, React 19, CodeMirror 6, Vitest, Playwright Electron E2E, existing LLM Adapter, Context Engine, Repository, History, Recovery, and shared `Result`/`UnifiedError` contracts.

---

## Scope and Gates

- Implement only stages 0, 1, 2, and 3 from design v1.4. Stage 4 multi-session management is explicitly out of scope.
- Do not add Shell, Git, MCP, browser, network research, plugins, multi-agent execution, background unattended work, deletion, move/rename, directory creation, binary editing, or full conversation-sidebar management.
- Do not open a browser for demonstration. Playwright is used only for automated Electron acceptance tests.
- Stage 0 must pass before any Agent Run loop code is enabled or advertised. A failing stage-0 gate blocks stages 1–3.
- All new project file access uses a bound canonical project root and project-relative paths/stable asset IDs. Model-authored file text is data, never authorization.

## File Ownership Map

**Stage 0 baseline files**

- Modify: `packages/application/src/ai-writing-workflow-types.ts`, `packages/application/src/ai-writing-streaming-session.ts`, `packages/application/src/novel-studio-api.ts` for clone-safe stream DTOs and provider capability results.
- Modify: `apps/desktop/src/main/ipc-handlers.ts`, `apps/desktop/src/main/ipc-allowlist.ts`, `apps/desktop/src/preload/api.ts`, `apps/desktop/src/preload/index.cts` for one-way stream event delivery and explicit stream snapshot fallback.
- Modify: `packages/shared/src/errors.ts` and `apps/desktop/src/renderer/ai-writing-workflow-bridge.ts` for renderer-safe error creation.
- Modify: `packages/application/src/user-preferences-session.ts` and `packages/repository/src/user-preferences-repository.ts` for legacy `appearance` normalization.
- Modify: `apps/desktop/src/main/application-composition.ts`, `apps/desktop/src/main/index.ts`, `apps/desktop/vite.config.ts`, and `scripts/package-check.mjs` for one-source-revision build metadata.
- Modify: `apps/desktop/test/ai-writing-workflow-ipc.test.ts`, `apps/desktop/test/ai-writing-workflow-bridge.test.ts`, `apps/desktop/test/ai-writing-workflow.e2e.ts`, `apps/desktop/test/m95-real-provider-runtime.test.ts`, `apps/desktop/test/m95-provider-runtime-routing.test.ts`, `packages/application/test/user-preferences-session.test.ts`, and add `apps/desktop/test/stream-build-consistency.test.ts`.

**Stage 1 read-only Agent Run files**

- Create: `packages/agent-engine/src/agent-run-types.ts`, `agent-run-coordinator.ts`, `tool-registry.ts`, `path-guard.ts`, `context-snapshot.ts`, `plan-artifact.ts`, `agent-run-store.ts`, and `index.ts` exports.
- Create: `packages/agent-engine/test/agent-run-coordinator.test.ts`, `tool-registry.test.ts`, `path-guard.test.ts`, `plan-artifact.test.ts`, and `event-contract.test.ts`.
- Create: `packages/repository/src/agent-run-repository.ts`, `packages/repository/src/agent-run-paths.ts`, and `packages/repository/test/agent-run-repository.test.ts`.
- Create: `packages/application/src/agent-run-session.ts`, `packages/application/src/agent-run-ipc.ts`, and `packages/application/test/agent-run-session.test.ts`.
- Modify: `packages/application/src/ipc-contract.ts`, `packages/application/src/novel-studio-api.ts`, `packages/application/src/desktop-application.ts`, `packages/application/src/index.ts`, `apps/desktop/src/main/application-composition.ts`, `apps/desktop/src/main/ipc-handlers.ts`, `apps/desktop/src/preload/api.ts`, `apps/desktop/src/preload/index.cts`, and `apps/desktop/src/main/ipc-allowlist.ts`.
- Create/modify UI: `packages/ui/src/agent-run-panel.tsx`, `packages/ui/src/agent-run-timeline.tsx`, `packages/ui/src/plan-artifact-review.tsx`, `packages/ui/src/workspace-shell-ai.tsx`, `packages/ui/src/workspace-shell-types.ts`, `packages/ui/src/styles.css`, `packages/ui/test/agent-run-panel.test.tsx`, and `apps/desktop/test/agent-run.e2e.ts`.

**Stage 2 Change Set and confirmed-write files**

- Create: `packages/agent-engine/src/change-set.ts`, `version-group.ts`, `approval-gate.ts`, `transaction-journal.ts` and matching tests.
- Modify: `packages/repository/src/history-repository.ts`, `packages/repository/src/recovery-repository.ts`, `packages/repository/src/atomic-write.ts`, `packages/repository/src/ports.ts`, `packages/repository/src/index.ts`, and add `packages/repository/test/agent-write-transaction.test.ts`.
- Create: `packages/application/src/change-set-session.ts`, `packages/application/src/version-group-session.ts`, `packages/application/test/change-set-session.test.ts`, and `version-group-session.test.ts`.
- Modify: `packages/application/src/desktop-application.ts`, `packages/application/src/novel-studio-api.ts`, `apps/desktop/src/main/ipc-handlers.ts`, `apps/desktop/src/preload/api.ts`, `apps/desktop/src/preload/index.cts`.
- Create/modify UI: `packages/ui/src/change-set-review.tsx`, `packages/ui/src/diff-review.tsx`, `packages/ui/test/change-set-review.test.tsx`, `packages/ui/test/diff-review.test.tsx`, `packages/ui/src/workspace-shell-ai.tsx`, and `packages/ui/src/styles.css`.

**Stage 3 explicit full-autonomy files**

- Modify: `packages/agent-engine/src/agent-run-types.ts`, `approval-gate.ts`, `version-group.ts`, `packages/application/src/agent-run-session.ts`, `change-set-session.ts`, and `version-group-session.ts` to carry `writePolicy` and `approvalSource` without bypassing the same diff/apply path.
- Modify: `packages/ui/src/workspace-shell-ai.tsx`, `packages/ui/src/change-set-review.tsx`, `packages/ui/src/styles.css` for the per-run policy menu, warning, and run-level undo affordance.
- Add: `packages/agent-engine/test/full-autonomy-policy.test.ts`, `packages/application/test/run-undo-conflict.test.ts`, and `apps/desktop/test/agent-run-autonomy.e2e.ts`.

## Stage 0: Repair and Lock the Existing Runtime Baseline

### Task 0.1: Define and test clone-safe streaming DTOs

**Files:**
- Modify: `packages/application/src/ai-writing-workflow-types.ts`
- Modify: `packages/application/src/ai-writing-streaming-session.ts`
- Modify: `apps/desktop/src/main/ipc-handlers.ts`
- Modify: `apps/desktop/src/preload/api.ts`
- Modify: `apps/desktop/src/preload/index.cts`
- Test: `apps/desktop/test/ai-writing-workflow-ipc.test.ts`
- Test: `apps/desktop/test/ai-writing-workflow-bridge.test.ts`
- Add: `packages/application/test/stream-dto-contract.test.ts`

- [ ] **Step 1: Add a failing contract test** that calls `structuredClone` on every public stream result (`start`, `next`, `event`, `done`, and `UnifiedError`) and asserts rejection for `AbortSignal`, `Error`, functions, class instances, and async iterators.
- [ ] **Step 2: Run the focused tests** with `npm test -- packages/application/test/stream-dto-contract.test.ts apps/desktop/test/ai-writing-workflow-ipc.test.ts`; confirm the current iterator payload fails at the Electron clone boundary.
- [ ] **Step 3: Introduce plain DTO guards** (`isAiWritingSuggestionStreamEvent`, `isAiWritingSuggestionStreamNext`, `assertCloneSafeDto`) that copy only strings, numbers, booleans, null, arrays, and records; never return the iterator, `AbortController`, `Error`, or provider object through IPC.
- [ ] **Step 4: Replace preload polling as the source of truth** with a main-owned stream record that emits clone-safe event envelopes and retains the latest `{ runId, sequence, status, snapshot }` for reconnect/fallback. Keep `cancel` as an explicit command.
- [ ] **Step 5: Add tests for first-delta delivery, terminal delivery, rejected payloads, cancellation, and a late event after cancellation**; assert no event is emitted after the terminal sequence.
- [ ] **Step 6: Run `npm test -- packages/application/test/stream-dto-contract.test.ts apps/desktop/test/ai-writing-workflow-ipc.test.ts apps/desktop/test/ai-writing-workflow-bridge.test.ts` and `npm run typecheck`; expected result is PASS with no clone error.

### Task 0.2: Remove renderer Node-only error dependencies

**Files:**
- Modify: `packages/shared/src/errors.ts`
- Modify: `packages/shared/test/result-and-errors.test.ts`
- Modify: `apps/desktop/src/renderer/ai-writing-workflow-bridge.ts`
- Test: `apps/desktop/test/ai-writing-workflow-bridge.test.ts`

- [ ] **Step 1: Add a failing renderer test** that makes the stream iterator throw before its first delta and asserts a visible failed state, restored send control, stable `errorId`, and no second exception.
- [ ] **Step 2: Run `npm test -- apps/desktop/test/ai-writing-workflow-bridge.test.ts`; confirm the current `randomUUID is not a function` failure.
- [ ] **Step 3: Change `createUnifiedError` to accept an injected `createErrorId`/clock and use a browser-safe fallback (`crypto.randomUUID` when available, otherwise a monotonic counter) without importing `node:crypto` in renderer-bundled code.
- [ ] **Step 4: Make main/application create canonical error IDs and make renderer wrapping use a tiny browser-safe DTO factory; preserve `UnifiedError` schema and redacted details.
- [ ] **Step 5: Run `npm test -- packages/shared/test/result-and-errors.test.ts apps/desktop/test/ai-writing-workflow-bridge.test.ts` and `npm run build:renderer`; expected result is PASS and the renderer bundle contains no `node:crypto` import.

### Task 0.3: Normalize legacy preferences and verify build consistency

**Files:**
- Modify: `packages/application/src/user-preferences-session.ts`
- Modify: `packages/repository/src/user-preferences-repository.ts`
- Modify: `packages/application/test/user-preferences-session.test.ts`
- Modify: `packages/repository/test/user-preferences-repository.test.ts`
- Add: `apps/desktop/test/stream-build-consistency.test.ts`
- Modify: `apps/desktop/src/main/application-composition.ts`, `apps/desktop/src/main/index.ts`, `apps/desktop/vite.config.ts`, `scripts/package-check.mjs`

- [ ] **Step 1: Add a failing legacy fixture** with no `appearance` field and with `appearance: { theme: "system" }`; assert `load()` returns the full default `{ theme: "dark", accentColor: "teal" }` or preserves valid `theme` while defaulting the missing accent.
- [ ] **Step 2: Run `npm test -- packages/application/test/user-preferences-session.test.ts packages/repository/test/user-preferences-repository.test.ts`; confirm the old object is dereferenced before normalization.
- [ ] **Step 3: Normalize through `createDefaultUserPreferences()` before spreading persisted values, validate each appearance field, and keep the persisted schema at `1.0`.
- [ ] **Step 4: Add a build manifest containing the current source revision and identical build ID for main, preload, renderer, and workspace package artifacts; make startup/package checks reject mixed IDs.
- [ ] **Step 5: Run `npm run build`, then `npm test -- apps/desktop/test/stream-build-consistency.test.ts`; expected result is PASS and the manifest reports one source revision for all three Electron layers.

### Task 0.4: Update real Electron E2E and provider capability preflight

**Files:**
- Modify: `apps/desktop/test/ai-writing-workflow.e2e.ts`
- Modify: `apps/desktop/test/m95-real-provider-runtime.test.ts`
- Modify: `apps/desktop/test/m95-provider-runtime-routing.test.ts`
- Modify: `packages/application/src/model-settings-session.ts`
- Modify: `packages/application/src/ai-writing-workflow-session.ts`
- Add: `packages/application/test/provider-capability-preflight.test.ts`

- [ ] **Step 1: Replace textarea-only E2E interaction** with CodeMirror DOM input (`.cm-content[contenteditable="true"]`), assert the accessible label, and keep a separate fallback test only for the explicitly configured textarea runtime.
- [ ] **Step 2: Add a local OpenAI-compatible SSE test server** in the test file that records the request path/body and returns two SSE deltas plus `[DONE]`; assert the request reaches the server and the UI shows `providerMode=real`.
- [ ] **Step 3: Add a capability preflight result containing `streaming`, `toolCalling`, `structuredOutput`, and `contextBudget`; block agent-run creation when any required capability is false and expose an actionable error instead of silently using ordinary text generation.
- [ ] **Step 4: Add demo-provider assertions so the UI explicitly says demo mode and does not imply a network request.
- [ ] **Step 5: Run `npm run build && npx playwright test apps/desktop/test/ai-writing-workflow.e2e.ts`; expected result is PASS for CodeMirror, demo stream, local SSE stream, visible terminal state, and no page error.

### Stage 0 Gate

- [ ] Run `npm run typecheck`.
- [ ] Run `npm test -- packages/application/test/stream-dto-contract.test.ts packages/application/test/provider-capability-preflight.test.ts packages/application/test/user-preferences-session.test.ts packages/repository/test/user-preferences-repository.test.ts apps/desktop/test/ai-writing-workflow-ipc.test.ts apps/desktop/test/ai-writing-workflow-bridge.test.ts apps/desktop/test/stream-build-consistency.test.ts`.
- [ ] Run `npm run build`.
- [ ] Run `npx playwright test apps/desktop/test/ai-writing-workflow.e2e.ts`.
- [ ] Acceptance: first visible status arrives after send; success and failure both reach exactly one terminal state; renderer recovers from an injected clone failure; no `randomUUID` renderer error; no page error; demo and real provider modes are explicit; main/preload/renderer share one build ID.
- [ ] Do not start Stage 1 until every command above exits 0.

## Stage 1: Event Stream and Read-Only Agent Run

### Task 1.1: Add Agent Run contracts, snapshots, limits, and idempotent commands

**Files:**
- Create: `packages/agent-engine/src/agent-run-types.ts`
- Create: `packages/agent-engine/src/agent-run-coordinator.ts`
- Create: `packages/agent-engine/src/agent-run-store.ts`
- Create: `packages/agent-engine/test/event-contract.test.ts`
- Create: `packages/agent-engine/test/agent-run-coordinator.test.ts`

- [ ] **Step 1: Write failing tests** for states `created`, `planning_model`, `executing_model`, `awaiting_user_input`, `awaiting_context_refresh`, `plan_ready`, `completed`, `cancelled`, `failed`, and `limit_reached`; assert one terminal event and monotonic `sequence`/`runRevision`.
- [ ] **Step 2: Define DTOs** for `AgentRunRecord`, `AgentRunEvent`, `AgentRunSnapshot`, `AgentRunCommand`, `ContextSnapshotRef`, `ProviderCapabilitySnapshot`, and `RunLimits`. Every command carries `commandId` and `expectedRunRevision`; every event carries `runId`, `sequence`, and `runRevision`.
- [ ] **Step 3: Implement command receipts** keyed by `projectId + commandId`; a duplicate returns the original result, and a stale revision returns the latest snapshot with a stable conflict code.
- [ ] **Step 4: Implement one-active-run-per-project** covering all running and awaiting states; reject a second run without queueing.
- [ ] **Step 5: Run `npm test -- packages/agent-engine/test/event-contract.test.ts packages/agent-engine/test/agent-run-coordinator.test.ts`; expected result is PASS.

### Task 1.2: Add path guard, context snapshots, and the six-tool registry

**Files:**
- Create: `packages/agent-engine/src/path-guard.ts`
- Create: `packages/agent-engine/src/context-snapshot.ts`
- Create: `packages/agent-engine/src/tool-registry.ts`
- Create: `packages/agent-engine/test/path-guard.test.ts`
- Create: `packages/agent-engine/test/tool-registry.test.ts`
- Create: `packages/repository/src/agent-run-paths.ts`
- Create: `packages/repository/src/agent-run-repository.ts`
- Create: `packages/repository/test/agent-run-repository.test.ts`

- [ ] **Step 1: Add path tests** for absolute paths, `..`, mixed separators, UNC, ADS, device names, case/normalization escapes, symlink/junction traversal, `history/**`, credentials, binaries, and project-external targets; assert stable redacted errors.
- [ ] **Step 2: Implement `PathGuard`** bound to a canonical root at project-open time; reject reparse points at every path segment and re-check realpath during read, proposal validation, and final apply.
- [ ] **Step 3: Define exact tool matrices**: planning+writing exposes four read tools plus `finish_plan`/`request_user_input`; planning+general exposes two read tools plus those two actions; execution+writing adds `propose_chapter_write` and `finish`; execution+general adds `propose_file_write` and `finish`. Keep apply/save/undo/mode-switch out of model tools.
- [ ] **Step 4: Implement read envelopes** with source kind, relative ref, checksum, capture time, dirty flag, and bounded content; treat file text as untrusted data and never merge instructions from it into permissions.
- [ ] **Step 5: Persist run/snapshot/event/command-receipt data** only under project-root `history/agent-runs`, `history/plans`, and system-owned transaction paths; never persist API keys or raw provider frames.
- [ ] **Step 6: Run `npm test -- packages/agent-engine/test/path-guard.test.ts packages/agent-engine/test/tool-registry.test.ts packages/repository/test/agent-run-repository.test.ts`; expected result is PASS.

### Task 1.3: Implement the read-only loop and protocol actions

**Files:**
- Modify: `packages/agent-engine/src/agent-run-coordinator.ts`, `tool-registry.ts`, `context-snapshot.ts`
- Create: `packages/agent-engine/src/plan-artifact.ts`
- Create: `packages/agent-engine/test/plan-artifact.test.ts`
- Create: `packages/application/src/agent-run-session.ts`
- Create: `packages/application/test/agent-run-session.test.ts`
- Modify: `packages/application/src/desktop-application.ts`, `packages/application/src/index.ts`

- [ ] **Step 1: Test a scripted provider** that emits text, three read calls, `request_user_input`, an answer, `finish_plan`, and a terminal event; assert the exact visible step order and no raw tool JSON.
- [ ] **Step 2: Implement tool-call assembly** in the adapter boundary; incomplete JSON, unknown tools, duplicate `toolCallId`, schema errors, and budget overflow produce `tool_failed` before Repository access.
- [ ] **Step 3: Implement `request_user_input`** as a durable pause; answering resumes the same run and preserves the decision summary, while stop prevents resumption.
- [ ] **Step 4: Implement `PlanArtifact` immutable revisions** with facts, assumptions, blocking/non-blocking questions, target refs, stable step IDs, verification, risks, source refs, resource estimates, and `finish_plan` validation. Blocking questions disable execution.
- [ ] **Step 5: Implement context-stale handling**: a changed critical source or dirty target transitions to `awaiting_context_refresh`, invalidates old plan/candidates, and requires save-and-refresh or explicit exclusion.
- [ ] **Step 6: Run `npm test -- packages/agent-engine/test/plan-artifact.test.ts packages/application/test/agent-run-session.test.ts`; expected result is PASS.

### Task 1.4: Wire push IPC, snapshot recovery, and read-only UI

**Files:**
- Modify: `packages/application/src/ipc-contract.ts`, `packages/application/src/novel-studio-api.ts`
- Modify: `apps/desktop/src/main/ipc-handlers.ts`, `apps/desktop/src/main/ipc-allowlist.ts`, `apps/desktop/src/preload/api.ts`, `apps/desktop/src/preload/index.cts`
- Create/modify: `packages/ui/src/agent-run-panel.tsx`, `packages/ui/src/agent-run-timeline.tsx`, `packages/ui/src/plan-artifact-review.tsx`, `packages/ui/src/workspace-shell-ai.tsx`, `packages/ui/src/workspace-shell-types.ts`, `packages/ui/src/styles.css`
- Test: `packages/ui/test/agent-run-panel.test.tsx`, `apps/desktop/test/agent-run.e2e.ts`

- [ ] **Step 1: Add API commands** `startAgentRun`, `stopAgentRun`, `answerUserInput`, `resumeAgentRun`, `retryStep`, `readAgentRun`, `listAgentRuns`, and a subscription returning clone-safe events plus the latest snapshot.
- [ ] **Step 2: Render conversation text plus an embedded timeline**; current step is expanded, completed reads collapse, repeated reads aggregate after three, `aria-live="polite"` announces only step changes, and diagnostics stay collapsed.
- [ ] **Step 3: Add planning/execution and writing/general segmented controls**; planning hides write policy and all propose tools; user-triggered mode changes create explicit events.
- [ ] **Step 4: Render Plan Artifact summary/detail and disable “按此方案执行” for unresolved blocking questions; execution creates a new run linked to the approved plan revision.
- [ ] **Step 5: Add keyboard-accessible stop, question-card answer/stop, retry-failed-step, and reload recovery tests.
- [ ] **Step 6: Run `npm test -- packages/ui/test/agent-run-panel.test.tsx apps/desktop/test/agent-run.e2e.ts` and `npm run typecheck`; expected result is PASS.

### Stage 1 Gate

- [ ] Run `npm run typecheck` and `npm test -- packages/agent-engine/test packages/application/test/agent-run-session.test.ts packages/repository/test/agent-run-repository.test.ts packages/ui/test/agent-run-panel.test.tsx`.
- [ ] Run `npm run build && npx playwright test apps/desktop/test/agent-run.e2e.ts`.
- [ ] Acceptance: multiple real read tools stream in order; stop isolates late events; restart restores snapshot/question/plan; planning never exposes propose/apply; one active run per project; all commands are idempotent; no write tool is reachable.

## Stage 2: Change Set, Human Approval, and Version Groups

### Task 2.1: Build immutable Change Set revisions and proposal tools

**Files:**
- Create: `packages/agent-engine/src/change-set.ts`
- Create: `packages/agent-engine/src/approval-gate.ts`
- Create: `packages/agent-engine/test/change-set.test.ts`
- Create: `packages/application/src/change-set-session.ts`
- Create: `packages/application/test/change-set-session.test.ts`
- Modify: `packages/agent-engine/src/tool-registry.ts`, `packages/agent-engine/src/agent-run-coordinator.ts`

- [ ] **Step 1: Add tests** for chapter paragraph patches and ordinary UTF-8 text patches using base checksum, candidate checksum, immutable hunks, schema/syntax validation, and default all-selected state; assert target bytes do not change during proposal.
- [ ] **Step 2: Implement `propose_chapter_write`** using chapter ID/range/base hash/replacement and `propose_file_write` using project-relative path/base hash/replacement; reject absolute paths, dirty target buffers, unsupported files, and stale bases.
- [ ] **Step 3: Merge repeated proposals for the same run/file into a new revision rather than mutating an approved revision; bind every revision to the context snapshot and checkpoint.
- [ ] **Step 4: Implement hunk/file selection to create a new revision and recompute checksum, syntax/schema validation, and approval token.
- [ ] **Step 5: Run `npm test -- packages/agent-engine/test/change-set.test.ts packages/application/test/change-set-session.test.ts`; expected result is PASS.

### Task 2.2: Implement transactional Version Group, journal, recovery, and ordinary-file history

**Files:**
- Create: `packages/agent-engine/src/version-group.ts`
- Create: `packages/agent-engine/src/transaction-journal.ts`
- Create: `packages/agent-engine/test/version-group.test.ts`
- Modify: `packages/repository/src/history-repository.ts`, `packages/repository/src/recovery-repository.ts`, `packages/repository/src/atomic-write.ts`, `packages/repository/src/ports.ts`, `packages/repository/src/index.ts`
- Create: `packages/repository/test/agent-write-transaction.test.ts`
- Create: `packages/application/src/version-group-session.ts`
- Create: `packages/application/test/version-group-session.test.ts`

- [ ] **Step 1: Add failing transaction tests** for multi-file preflight, all-before snapshots, atomic per-file replacement, Nth-file failure compensation, journal recovery, and partial-failure reporting.
- [ ] **Step 2: Extend text asset history** so ordinary allowed UTF-8 files receive the same before-write version semantics as chapters; keep legacy `before-ai-apply` records readable.
- [ ] **Step 3: Implement `VersionGroup`** with `runId/checkpointId/writeId`, baseline-by-path, transaction status, per-write checksum, and undo status; acquire project lock before preflight and re-check path/reparse/base hash immediately before each replace.
- [ ] **Step 4: Write the journal before the first replace**, mark each path `applied` or `rolled_back`, and make startup recovery resume compensation without pretending partial success is success.
- [ ] **Step 5: Synchronize editor/autosave/recovery**: pause autosave during apply, update editor to Saved on success, keep dirty content on non-write failure, and surface recovery review on partial failure.
- [ ] **Step 6: Run `npm test -- packages/repository/test/agent-write-transaction.test.ts packages/application/test/version-group-session.test.ts packages/agent-engine/test/version-group.test.ts`; expected result is PASS.

### Task 2.3: Wire human approval and Diff Review UI

**Files:**
- Modify: `packages/application/src/desktop-application.ts`, `packages/application/src/novel-studio-api.ts`, `packages/application/src/ipc-contract.ts`
- Modify: `apps/desktop/src/main/ipc-handlers.ts`, `apps/desktop/src/preload/api.ts`, `apps/desktop/src/preload/index.cts`, `apps/desktop/src/main/ipc-allowlist.ts`
- Create/modify: `packages/ui/src/change-set-review.tsx`, `packages/ui/src/diff-review.tsx`, `packages/ui/src/workspace-shell-ai.tsx`, `packages/ui/src/styles.css`
- Test: `packages/ui/test/change-set-review.test.tsx`, `packages/ui/test/diff-review.test.tsx`, `apps/desktop/test/agent-write.e2e.ts`

- [ ] **Step 1: Add IPC commands** `decideChangeSet` and `undoRun`, each carrying `commandId`, `expectedRunRevision`, `changeSetId`, revision, and selected checksum; duplicate commands return the first receipt.
- [ ] **Step 2: Render one Change Set summary and one main Diff Review** with “尚未写入”, file/hunk selection, revision/checksum, base-hash conflict state, and only “应用所选 / 拒绝全部 / 返回对话”.
- [ ] **Step 3: Apply selected hunks through the Version Group only**; never write from a UI diff object, never auto-save dirty editor buffers, and never let model output invoke apply.
- [ ] **Step 4: Add E2E coverage** for proposal-without-write, hunk deselection/revision, double-click idempotency, base-hash conflict, successful multi-file apply, and Nth-file rollback.
- [ ] **Step 5: Run `npm test -- packages/ui/test/change-set-review.test.tsx packages/ui/test/diff-review.test.tsx apps/desktop/test/agent-write.e2e.ts` and `npm run typecheck`; expected result is PASS.

### Stage 2 Gate

- [ ] Run `npm run typecheck` and the full focused Change Set/Repository/UI test set.
- [ ] Run `npm run build && npx playwright test apps/desktop/test/agent-write.e2e.ts`.
- [ ] Acceptance: proposals never mutate target bytes; approved revision/checksum exactly matches applied content; file/hunk partial selection creates a new revision; double-click/IPC retry writes once; every write has a before snapshot; single-write and run-level undo metadata exist; conflicts and partial failures are explicit and recoverable.

## Stage 3: Explicit Full-Autonomy Mode

### Task 3.1: Add per-run preapproval without bypassing Change Set/apply

**Files:**
- Modify: `packages/agent-engine/src/agent-run-types.ts`, `packages/agent-engine/src/approval-gate.ts`, `packages/agent-engine/src/version-group.ts`, `packages/agent-engine/src/agent-run-coordinator.ts`
- Modify: `packages/application/src/agent-run-session.ts`, `packages/application/src/change-set-session.ts`, `packages/application/src/version-group-session.ts`
- Create: `packages/agent-engine/test/full-autonomy-policy.test.ts`

- [ ] **Step 1: Add a failing policy test** proving the default is `write_before_confirmation`, planning cannot select an auto-write policy, and only an explicit renderer command can select `user_preapproved_run` for the current run.
- [ ] **Step 2: Carry `writePolicy` and `approvalSource` through AgentRun/ChangeSet/VersionGroup records; keep every proposal, diff, validation, snapshot, journal, and apply event identical to Stage 2.
- [ ] **Step 3: Auto-approve only after the user-facing warning is acknowledged; emit an explicit `change_set_auto_approved` event and retain the same revision/checksum binding.
- [ ] **Step 4: Reject attempts by model text, tool arguments, file content, history, or persisted project preferences to change write policy.
- [ ] **Step 5: Run `npm test -- packages/agent-engine/test/full-autonomy-policy.test.ts packages/application/test/agent-run-session.test.ts`; expected result is PASS.

### Task 3.2: Implement run-level undo and post-write conflict handling

**Files:**
- Modify: `packages/agent-engine/src/version-group.ts`, `packages/application/src/version-group-session.ts`, `packages/repository/src/recovery-repository.ts`
- Create: `packages/application/test/run-undo-conflict.test.ts`
- Modify: `packages/ui/src/change-set-review.tsx`, `packages/ui/src/workspace-shell-ai.tsx`, `packages/ui/src/styles.css`

- [ ] **Step 1: Add tests** for undo restoring each file's first-run baseline, creating `before-agent-session-undo`, refusing silent overwrite after a user edit, and retrying per-file rollback failures.
- [ ] **Step 2: Implement `undoRun` with command idempotency and expected revision; compare each file against the run's last-write hash before restoring.
- [ ] **Step 3: On mismatch, create a rollback diff and expose per-file choices; never overwrite the later user edit silently.
- [ ] **Step 4: Display risk warning, auto-write event, version points, and “撤销本次运行” only for an execution run; keep planning read-only.
- [ ] **Step 5: Run `npm test -- packages/application/test/run-undo-conflict.test.ts packages/agent-engine/test/full-autonomy-policy.test.ts`; expected result is PASS.

### Task 3.3: Add dedicated autonomy E2E and release gate

**Files:**
- Create: `apps/desktop/test/agent-run-autonomy.e2e.ts`
- Modify: `scripts/package-check.mjs`, `apps/desktop/test/m98-v1-ship-readiness.test.ts`

- [ ] **Step 1: Start a real Electron app with a local SSE provider**, choose “本次运行自动写入”, assert the warning, perform two proposals, observe two version points, and verify the target files changed only through the Version Group.
- [ ] **Step 2: Click “撤销本次运行”, verify baseline restoration and the undo snapshot; edit one file before undo and assert rollback diff rather than silent overwrite.
- [ ] **Step 3: Add a release check that autonomy is unavailable unless Stage 2 transaction, ordinary-file history, conflict, and data-loss suites pass; keep the default policy as manual confirmation.
- [ ] **Step 4: Run `npm run build && npx playwright test apps/desktop/test/agent-run-autonomy.e2e.ts`; expected result is PASS.

### Stage 3 Gate

- [ ] Run `npm run typecheck`.
- [ ] Run `npm test -- packages/agent-engine/test packages/application/test/agent-run-session.test.ts packages/application/test/change-set-session.test.ts packages/application/test/version-group-session.test.ts packages/application/test/run-undo-conflict.test.ts packages/repository/test/agent-write-transaction.test.ts packages/ui/test/change-set-review.test.tsx packages/ui/test/agent-run-panel.test.tsx`.
- [ ] Run `npm run build && npx playwright test apps/desktop/test/agent-run.e2e.ts apps/desktop/test/agent-write.e2e.ts apps/desktop/test/agent-run-autonomy.e2e.ts`.
- [ ] Run `npm run package:check`.
- [ ] Acceptance: manual confirmation remains default; autonomy is per-run and explicit; planning cannot auto-write; all writes use the same Change Set/diff/version/journal path; run undo is available and conflict-aware; no out-of-scope capability appears.

## Final Spec Self-Review

- [ ] Verify every design v1.4 requirement maps to a task above: clone-safe push stream, single event contract, provider preflight, three-axis modes, six tools plus three protocol actions, path/reparse/TOCTOU guards, Context Snapshot and dirty-source handling, Plan Artifact revisions, request-user-input pause/resume, command idempotency, one active run, Change Set/hunk approval, version groups, transaction journal, recovery, ordinary-file history, run undo, and real Electron E2E.
- [ ] Search the plan for placeholder markers, deferred-work wording, and vague validation instructions; none may remain.
- [ ] Run `rg -n "Shell|Git|MCP|browser|multi-agent|conversation sidebar|后台无人值守" docs/superpowers/plans/2026-07-13-agentic-writing-loop.md` and confirm each occurrence is an explicit exclusion rather than an implementation task.
- [ ] Save this plan only. Do not modify implementation files or start a dev server as part of this planning turn.
