# M86-M88 Plugin Workflow Editor Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add plugin runtime hardening reports, workflow semantic edit helpers, and editor local diff review readiness metadata.

**Architecture:** Keep plugin hardening as deterministic Application DTOs, workflow semantic editing as JSON draft helpers in Config Studio, and local diff review as renderer runtime/UI metadata. Existing save, plugin execution, and editor fallback boundaries remain unchanged.

**Tech Stack:** TypeScript strict, React, Vitest, Electron renderer bridge contracts.

---

### Task 1: Documentation

**Files:**

- Create: `docs/productization/m86-m88-plugin-workflow-editor-hardening.md`
- Create: `docs/superpowers/specs/2026-07-06-m86-m88-plugin-workflow-editor-hardening-design.md`
- Create: `docs/superpowers/plans/2026-07-06-m86-m88-plugin-workflow-editor-hardening.md`

- [x] Write M86-M88 productization record.
- [x] Write M86-M88 design spec.
- [x] Write this implementation plan.

### Task 2: M86 Plugin Runtime Hardening

**Files:**

- Modify: `packages/application/src/plugin-runtime-session.ts`
- Modify: `packages/application/src/index.ts`
- Modify: `packages/application/test/plugin-runtime-session.test.ts`

- [x] Add failing tests for hardening report readiness, trust policy, and audit retention.
- [x] Implement hardening report DTO and export it.
- [x] Keep executable plugin runtime behavior unchanged.

### Task 3: M87 Workflow Designer Semantic Editing

**Files:**

- Modify: `packages/application/src/config-studio-session.ts`
- Modify: `packages/application/src/index.ts`
- Modify: `packages/application/test/config-studio-session.test.ts`

- [x] Add failing tests for add node, delete node, retarget edge, and branch edit helpers.
- [x] Implement semantic workflow edit helpers that return draft JSON and refreshed graph validation.
- [x] Preserve layout metadata for existing nodes.

### Task 4: M88 Editor Local Diff Review

**Files:**

- Modify: `apps/desktop/src/renderer/editor-runtime.ts`
- Modify: `packages/ui/src/chapter-editor.tsx`
- Modify: `apps/desktop/test/editor-runtime.test.ts`
- Modify: `packages/ui/test/chapter-editor.test.tsx`

- [x] Add failing tests for local diff review metadata, large-document smoke, fallback rollback, and UI rendering.
- [x] Implement local diff review DTO and runtime prop mapping.
- [x] Render compact local diff review state in the editor runtime strip.

### Task 5: Tracking and Verification

**Files:**

- Modify: `ROADMAP.md`
- Modify: `INDEX.md`
- Modify: `CHANGELOG.md`
- Modify: `TECH_DEBT.md`

- [x] Update milestone tracking docs for M86-M88.
- [x] Run focused tests.
- [x] Run `npm run typecheck`.
- [x] Run `npm run lint`.
- [x] Run `npm run format`.
- [x] Run `npm run build`.
- [x] Run `npm run test`.
- [x] Run `git diff --check`.
- [x] Commit as `feat: add plugin workflow editor hardening`.
