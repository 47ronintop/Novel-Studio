# M72-M74 Runtime Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add fixture sandbox worker enforcement, CodeMirror DOM mount planning, and Application-backed selection-aware AI preview.

**Architecture:** Keep runtime side effects behind Application adapters or renderer adapter contracts. The plugin fixture worker is deterministic and does not execute plugin code. Selection preview goes through Application/LLM Adapter and remains preview-only.

**Tech Stack:** TypeScript strict, Vitest, React server-render tests, Electron IPC allowlist tests.

---

### Task 1: Documentation Baseline

**Files:**

- Create: `docs/productization/m72-m74-sandbox-codemirror-selection-ai.md`
- Create: `docs/superpowers/specs/2026-07-06-m72-m74-runtime-preview-design.md`
- Create: `docs/superpowers/plans/2026-07-06-m72-m74-runtime-preview.md`
- Modify after implementation: `ROADMAP.md`, `INDEX.md`, `CHANGELOG.md`, `TECH_DEBT.md`

- [x] Record M72-M74 scope and non-goals.
- [x] Update roadmap/index/changelog/tech debt after implementation passes.

### Task 2: M72 Plugin Sandbox Fixture Worker

**Files:**

- Modify: `packages/application/src/plugin-runtime-session.ts`
- Modify: `packages/application/src/index.ts`
- Modify: `packages/application/test/plugin-runtime-session.test.ts`

- [x] Write failing tests for fixture worker success, timeout, and max output bytes.
- [x] Implement fixture worker adapter and structured timeout/output errors.
- [x] Verify plugin runtime focused tests pass.

### Task 3: M73 CodeMirror DOM Mount Plan

**Files:**

- Modify: `apps/desktop/src/renderer/editor-runtime.ts`
- Modify: `apps/desktop/test/editor-runtime.test.ts`

- [x] Write failing tests for CodeMirror DOM mount plan metadata and default fallback.
- [x] Implement DOM mount target descriptor and snapshot metadata.
- [x] Verify editor runtime focused tests pass.

### Task 4: M74 Selection-aware AI Application Flow

**Files:**

- Modify: `packages/application/src/ai-writing-workflow-session.ts`
- Modify: `packages/application/src/desktop-application.ts`
- Modify: `packages/application/src/novel-studio-api.ts`
- Modify: `packages/application/src/ipc-contract.ts`
- Modify: `packages/application/src/index.ts`
- Modify: `apps/desktop/src/main/ipc-handlers.ts`
- Modify: `apps/desktop/src/preload/api.ts`
- Modify: `apps/desktop/src/renderer/ai-writing-workflow-bridge.ts`
- Modify: related tests

- [x] Write failing Application workflow test for selection preview generation without chapter writes.
- [x] Implement `generateSelectionPreview()` on `AiWritingWorkflowSession`.
- [x] Add DesktopApplication, NovelStudioApi, IPC contract, main handler, and preload routing.
- [x] Add renderer bridge method that does not set an applyable suggestion id.
- [x] Verify focused AI workflow, IPC, security, and bridge tests pass.

### Task 5: Verification and Commit

**Files:**

- All touched files.

- [x] Run focused tests for plugin runtime, editor runtime, AI workflow, IPC, security, and bridge.
- [x] Run `npm run typecheck`.
- [x] Run `npm run lint`.
- [x] Run `npm run format`.
- [x] Run `npm run build`.
- [x] Run `npm run test`.
- [x] Run `git diff --check`.
- [x] Commit as `feat: add runtime selection preview batch`.
