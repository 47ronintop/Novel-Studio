# M75-M77 Selection Apply Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire real editor selections into selection AI preview, add explicit selection preview apply, and define plugin sandbox isolation readiness contracts.

**Architecture:** Keep UI selection state in renderer runtime metadata, route AI through Application/IPC/LLM Adapter, and keep plugin isolation as a structured plan without executing third-party code.

**Tech Stack:** TypeScript strict, React server-render tests, Vitest, Electron IPC allowlist tests.

---

### Task 1: Documentation Baseline

**Files:**

- Create: `docs/productization/m75-m77-selection-apply-sandbox-isolation.md`
- Create: `docs/superpowers/specs/2026-07-06-m75-m77-selection-apply-isolation-design.md`
- Create: `docs/superpowers/plans/2026-07-06-m75-m77-selection-apply-isolation.md`
- Modify after implementation: `ROADMAP.md`, `INDEX.md`, `CHANGELOG.md`, `TECH_DEBT.md`

- [x] Record M75-M77 scope and non-goals.
- [x] Update roadmap/index/changelog/tech debt after implementation passes.

### Task 2: M75 Selection Event UI Wiring

**Files:**

- Modify: `packages/ui/src/chapter-editor.tsx`
- Modify: `packages/ui/test/chapter-editor.test.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/editor-runtime.ts`
- Modify: related renderer tests

- [x] Write failing UI test for textarea selection callback.
- [x] Add `onSelectionChange` to `ChapterEditor`.
- [x] Store active selection in `App` and feed it to `createTextareaChapterEditorRuntimeProps()`.
- [x] Wire `onSelectionAiPreview` to the AI workflow bridge.
- [x] Verify focused UI and renderer tests pass.

### Task 3: M76 Selection Preview Apply Confirmation

**Files:**

- Modify: `packages/application/src/chapter-editor-session.ts`
- Modify: `packages/application/src/ai-writing-workflow-session.ts`
- Modify: `packages/application/src/desktop-application.ts`
- Modify: `packages/application/src/novel-studio-api.ts`
- Modify: `packages/application/src/ipc-contract.ts`
- Modify: `apps/desktop/src/main/ipc-handlers.ts`
- Modify: `apps/desktop/src/preload/api.ts`
- Modify: `apps/desktop/src/renderer/ai-writing-workflow-bridge.ts`
- Modify: related tests

- [x] Write failing Application test for applying a stored selection preview.
- [x] Add `ChapterEditorSession.applyAiEdit()` with before-AI snapshot when history is available.
- [x] Store selection previews and implement `applySelectionPreview()`.
- [x] Route apply through DesktopApplication, NovelStudioApi, IPC, preload, and renderer bridge.
- [x] Verify focused Application, IPC, security, and bridge tests pass.

### Task 4: M77 Plugin Sandbox Isolation Spike

**Files:**

- Modify: `packages/application/src/plugin-runtime-session.ts`
- Modify: `packages/application/src/index.ts`
- Modify: `packages/application/test/plugin-runtime-session.test.ts`

- [x] Write failing tests for isolation plan DTO.
- [x] Implement `createPluginSandboxIsolationPlan()` without executing plugin code.
- [x] Verify plugin runtime focused tests pass.

### Task 5: Verification and Commit

**Files:**

- All touched files.

- [x] Run focused tests for chapter editor, editor runtime/App bridge, AI workflow, IPC, security, and plugin runtime.
- [x] Run `npm run typecheck`.
- [x] Run `npm run lint`.
- [x] Run `npm run format`.
- [x] Run `npm run build`.
- [x] Run `npm run test`.
- [x] Run `git diff --check`.
- [x] Commit as `feat: wire selection apply isolation flow`.
