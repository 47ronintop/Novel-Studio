# M78-M80 Runtime Isolation Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a flagged CodeMirror DOM view path, a deterministic plugin isolation worker prototype, and workflow graph layout draft persistence.

**Architecture:** Keep all three features behind existing boundaries: renderer editor runtime adapter, Application plugin runtime adapter, and Studio graph projection props. Do not change project file truth or default editor behavior.

**Tech Stack:** TypeScript strict, React, Vitest, CodeMirror 6, Electron renderer bridge contracts.

---

### Task 1: Documentation

**Files:**

- Create: `PRODUCT.md`
- Create: `docs/productization/m78-m80-codemirror-isolation-workflow-layout.md`
- Create: `docs/superpowers/specs/2026-07-06-m78-m80-runtime-isolation-layout-design.md`
- Create: `docs/superpowers/plans/2026-07-06-m78-m80-runtime-isolation-layout.md`

- [x] Write `PRODUCT.md` for Impeccable product-context setup.
- [x] Write M78-M80 productization record.
- [x] Write M78-M80 design spec.
- [x] Write this implementation plan.

### Task 2: M78 CodeMirror DOM View

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `apps/desktop/src/renderer/editor-runtime.ts`
- Modify: `apps/desktop/test/editor-runtime.test.ts`

- [x] Add failing tests for mounted CodeMirror DOM view metadata.
- [x] Install `@codemirror/view`.
- [x] Implement explicit DOM view mount lifecycle behind `EditorRuntimeHandle`.
- [x] Verify focused/destroyed states preserve fallback behavior.

### Task 3: M79 Plugin Isolation Worker Prototype

**Files:**

- Modify: `packages/application/src/plugin-runtime-session.ts`
- Modify: `packages/application/src/index.ts`
- Modify: `packages/application/test/plugin-runtime-session.test.ts`

- [x] Add failing tests for signed executable isolation worker prototype.
- [x] Add failing tests for unsigned blocked workers and timeout teardown.
- [x] Implement deterministic isolated worker prototype adapter.
- [x] Keep arbitrary plugin source execution out of scope.

### Task 4: M80 Workflow Layout Persistence

**Files:**

- Modify: `packages/application/src/config-studio-session.ts`
- Modify: `apps/desktop/src/renderer/studio-bridge.ts`
- Modify: `packages/ui/src/config-studio-panel.tsx`
- Modify: `packages/ui/test/settings-and-studio.test.tsx`
- Modify: `apps/desktop/test/studio-bridge.test.ts`

- [x] Add failing tests for graph node positions and layout edit callback.
- [x] Add layout view model and deterministic default positions.
- [x] Add bridge draft layout update and UI controls.
- [x] Preserve existing invalid graph save gate.

### Task 5: Tracking and Verification

**Files:**

- Modify: `ROADMAP.md`
- Modify: `INDEX.md`
- Modify: `CHANGELOG.md`
- Modify: `TECH_DEBT.md`

- [x] Update roadmap/index/changelog/tech debt for M78-M80.
- [x] Run focused tests.
- [x] Run `npm run typecheck`.
- [x] Run `npm run lint`.
- [x] Run `npm run format`.
- [x] Run `npm run build`.
- [x] Run `npm run test`.
- [x] Run `git diff --check`.
- [x] Commit as `feat: add codemirror isolation workflow layout`.
