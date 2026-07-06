# M84-M85 Workflow Canvas Editor Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add workflow designer canvas readiness/interaction contracts and editor runtime default readiness evaluation.

**Architecture:** Application derives workflow designer availability from graph snapshots, renderer bridge owns transient selections and layout drag commits, and editor readiness remains inside the renderer editor runtime adapter boundary. Existing Studio save and editor resolver behavior remain the persistence/runtime authority.

**Tech Stack:** TypeScript strict, React, Vitest, Electron renderer bridge contracts.

---

### Task 1: Documentation

**Files:**

- Create: `docs/productization/m84-m85-workflow-canvas-editor-readiness.md`
- Create: `docs/superpowers/specs/2026-07-06-m84-m85-workflow-canvas-editor-readiness-design.md`
- Create: `docs/superpowers/plans/2026-07-06-m84-m85-workflow-canvas-editor-readiness.md`

- [x] Write M84-M85 productization record.
- [x] Write M84-M85 design spec.
- [x] Write this implementation plan.

### Task 2: M84 Workflow Designer Canvas

**Files:**

- Modify: `packages/application/src/config-studio-session.ts`
- Modify: `packages/application/src/index.ts`
- Modify: `apps/desktop/src/renderer/studio-bridge.ts`
- Modify: `packages/ui/src/config-studio-panel.tsx`
- Modify: related tests.

- [x] Add failing tests for designer availability, edge selection, and structured drag commit.
- [x] Implement Application availability DTO and export it.
- [x] Add bridge state for selected edge and drag commit.
- [x] Render a canvas-like graph surface with coordinate attributes, edge selection, and drag commit controls.

### Task 3: M85 Editor Runtime Default Readiness

**Files:**

- Modify: `apps/desktop/src/renderer/editor-runtime.ts`
- Modify: `apps/desktop/test/editor-runtime.test.ts`

- [x] Add failing readiness tests for blocker and ready paths.
- [x] Implement readiness evaluator with explicit blockers, warnings, fallback runtime, and recommendation.
- [x] Keep `resolveEditorRuntimeAdapter()` default behavior unchanged unless explicitly requested and enabled.

### Task 4: Tracking and Verification

**Files:**

- Modify: `ROADMAP.md`
- Modify: `INDEX.md`
- Modify: `CHANGELOG.md`
- Modify: `TECH_DEBT.md`

- [x] Update milestone tracking docs for M84-M85.
- [x] Run focused tests.
- [x] Run `npm run typecheck`.
- [x] Run `npm run lint`.
- [x] Run `npm run format`.
- [x] Run `npm run build`.
- [x] Run `npm run test`.
- [x] Run `git diff --check`.
- [x] Commit as `feat: add workflow canvas editor readiness`.
