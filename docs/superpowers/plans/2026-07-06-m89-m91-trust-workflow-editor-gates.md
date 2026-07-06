# M89-M91 Trust Workflow Editor Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add M89 plugin trust/audit persistence DTOs, M90 workflow product editing affordances, and M91 CodeMirror default migration gate evidence.

**Architecture:** Application owns structured contracts and validation; renderer bridges draft edits only through Application helpers; UI remains callback-driven and does not touch filesystem, model calls, or plugin execution.

**Tech Stack:** TypeScript strict, React, Vitest, existing Application/UI/Desktop packages.

---

### Task 1: Documentation

**Files:**

- Create: `docs/productization/m89-m91-trust-workflow-editor-gates.md`
- Create: `docs/superpowers/specs/2026-07-06-m89-m91-trust-workflow-editor-gates-design.md`
- Create: `docs/superpowers/plans/2026-07-06-m89-m91-trust-workflow-editor-gates.md`

- [x] Write productization record.
- [x] Write design spec.
- [x] Write implementation plan.

### Task 2: M89 Plugin Trust Store and Audit DTOs

**Files:**

- Modify: `packages/application/src/plugin-runtime-session.ts`
- Modify: `packages/application/src/index.ts`
- Modify: `packages/application/test/plugin-runtime-session.test.ts`

- [x] Add failing tests for trust-store snapshot upsert/revoke and JSONL audit record projection.
- [x] Implement deterministic trust-store and audit helpers.
- [x] Keep arbitrary plugin execution and marketplace blocked.

### Task 3: M90 Workflow Product Editing

**Files:**

- Modify: `packages/application/src/config-studio-session.ts`
- Modify: `packages/application/test/config-studio-session.test.ts`
- Modify: `packages/ui/src/config-studio-panel.tsx`
- Modify: `packages/ui/test/settings-and-studio.test.tsx`
- Modify: `packages/ui/src/styles.css`

- [x] Add failing tests for product edit node type, edge retarget, branch form, and delete confirmation UI.
- [x] Implement structured workflow product edit helper.
- [x] Render compact product editing controls without nested cards or filesystem access.

### Task 4: M91 CodeMirror Migration Gate

**Files:**

- Modify: `apps/desktop/src/renderer/editor-runtime.ts`
- Modify: `apps/desktop/test/editor-runtime.test.ts`
- Modify: `packages/ui/src/chapter-editor.tsx`
- Modify: `packages/ui/test/chapter-editor.test.tsx`

- [x] Add failing tests for migration gate opt-in, parity, benchmark, rollback, and UI strip label.
- [x] Implement migration gate DTO and runtime prop mapping.
- [x] Keep textarea default when any gate is missing.

### Task 5: Tracking and Verification

**Files:**

- Modify: `ROADMAP.md`
- Modify: `INDEX.md`
- Modify: `CHANGELOG.md`
- Modify: `TECH_DEBT.md`

- [x] Update milestone tracking docs for M89-M91.
- [x] Run focused tests.
- [x] Run `npm run lint`.
- [x] Run `npm run format`.
- [x] Run `npm run typecheck -- --pretty false`.
- [x] Run `npm run build`.
- [x] Run `npm run test`.
- [x] Run `git diff --check`.
- [x] Commit as `feat: add trust workflow editor gates`.
