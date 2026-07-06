# M70-M71 CodeMirror Selection Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add package-backed CodeMirror 6 headless parity and selection-aware preview-only AI diff DTO/UI support.

**Architecture:** M70 keeps CodeMirror behind the existing flagged renderer adapter and uses `@codemirror/state` only inside that boundary. M71 adds preview-only selection command DTOs and a callback-driven UI button without persistence or automatic apply.

**Tech Stack:** TypeScript strict, React server-render UI tests, Vitest, `@codemirror/state`.

---

### Task 1: Documentation Baseline

**Files:**

- Create: `docs/productization/m70-m71-codemirror-selection-preview.md`
- Create: `docs/superpowers/specs/2026-07-06-m70-m71-codemirror-selection-preview-design.md`
- Create: `docs/superpowers/plans/2026-07-06-m70-m71-codemirror-selection-preview.md`
- Modify: `ROADMAP.md`, `INDEX.md`, `CHANGELOG.md`, `TECH_DEBT.md`

- [x] Record M70/M71 scope and non-goals.
- [x] Update roadmap/index/changelog/tech debt after implementation passes.

### Task 2: CodeMirror Package Parity

**Files:**

- Modify: `apps/desktop/package.json`
- Modify: `package-lock.json`
- Modify: `apps/desktop/src/renderer/editor-runtime.ts`
- Modify: `apps/desktop/test/editor-runtime.test.ts`

- [x] Write failing tests for package-backed CodeMirror adapter metadata and event parity.
- [x] Add `@codemirror/state` to desktop dependencies.
- [x] Implement headless CodeMirror adapter state updates behind the existing adapter contract.
- [x] Verify focused runtime tests pass.

### Task 3: Selection-aware Preview DTO/UI

**Files:**

- Modify: `apps/desktop/src/renderer/editor-runtime.ts`
- Modify: `apps/desktop/test/editor-runtime.test.ts`
- Modify: `packages/ui/src/chapter-editor.tsx`
- Modify: `packages/ui/test/chapter-editor.test.tsx`

- [x] Write failing runtime tests for preview draft creation and collapsed-selection rejection.
- [x] Implement `createSelectionAwareAiPreviewDraft()`.
- [x] Write failing UI tests for runtime selection preview command button.
- [x] Add callback-driven `onSelectionAiPreview` UI path.

### Task 4: Verification and Commit

**Files:**

- All touched files.

- [x] Run focused tests for editor runtime and chapter editor UI.
- [x] Run `npm run typecheck`.
- [x] Run `npm run lint`.
- [x] Run `npm run format`.
- [x] Run `npm run build`.
- [x] Run `npm run test`.
- [x] Run `git diff --check`.
- [x] Commit as `feat: add codemirror parity selection preview`.
