# M65-M67 Sandbox Inspector Visual Diff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add M65 sandbox RFC documentation, M66 structured Workflow Studio inspector editing, and M67 preview-only editor visual diff runtime metadata.

**Architecture:** M65 is document-first. M66 introduces workflow-engine DTO helpers and renderer bridge draft updates while keeping persistence on the existing config asset save path. M67 extends the renderer editor runtime and UI status strip with bounded preview-only visual diff metadata.

**Tech Stack:** TypeScript strict, React server-render UI tests, Vitest, Prettier.

---

### Task 1: Documentation Baseline

**Files:**

- Create: `docs/rfcs/RFC-0004-plugin-runtime-sandbox.md`
- Create: `docs/productization/m65-m67-sandbox-inspector-visual-diff.md`
- Modify: `ROADMAP.md`, `INDEX.md`, `CHANGELOG.md`, `TECH_DEBT.md`

- [x] Record M65-M67 design scope and non-goals.
- [x] Draft the sandbox RFC as policy only, with no runtime execution.
- [x] Update roadmap/index/changelog/tech debt after implementation passes.

### Task 2: Workflow Node Inspector Editing

**Files:**

- Modify: `packages/workflow-engine/src/workflow-graph.ts`
- Modify: `packages/workflow-engine/src/index.ts`
- Modify: `packages/workflow-engine/test/workflow-graph.test.ts`
- Modify: `apps/desktop/src/renderer/studio-bridge.ts`
- Modify: `apps/desktop/test/studio-bridge.test.ts`
- Modify: `packages/ui/src/config-studio-panel.tsx`
- Modify: `packages/ui/test/settings-and-studio.test.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`

- [x] Write failing workflow-engine tests for applying agent/plugin/transition inspector edits and missing node errors.
- [x] Implement `WorkflowNodeInspectorEdit` and `applyWorkflowNodeInspectorEdit()`.
- [x] Write failing Studio bridge tests for draft JSON mutation and graph validation refresh.
- [x] Implement `StudioBridge.applyWorkflowNodeEdit()`.
- [x] Write failing UI tests for inspector edit controls.
- [x] Implement callback-driven inspector edit form.
- [x] Wire App handler to the bridge.

### Task 3: Editor Visual Diff Runtime

**Files:**

- Modify: `apps/desktop/src/renderer/editor-runtime.ts`
- Modify: `apps/desktop/test/editor-runtime.test.ts`
- Modify: `packages/ui/src/chapter-editor.tsx`
- Modify: `packages/ui/test/chapter-editor.test.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`

- [x] Write failing editor runtime tests for visual diff review metadata and preview-only decorations.
- [x] Implement `EditorVisualDiffReview` derivation and runtime props label.
- [x] Write failing UI test for runtime visual diff label.
- [x] Render the runtime visual diff label in the status strip.
- [x] Pass `diffPreview` into runtime prop creation from the renderer App.

### Task 4: Verification and Commit

**Files:**

- All touched files.

- [x] Run focused tests for workflow graph, studio bridge, UI studio, editor runtime, and chapter editor.
- [x] Run `npm run typecheck`.
- [x] Run `npm run lint`.
- [x] Run `npm run format`.
- [x] Run `npm run test`.
- [x] Run `npm run build`.
- [x] Run `git diff --check`.
- [x] Commit as `feat: add sandbox rfc inspector editing visual diff`.
