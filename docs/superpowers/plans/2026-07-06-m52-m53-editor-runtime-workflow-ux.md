# M52/M53 Editor Runtime and Workflow UX Implementation Plan

> Implement with TDD. Each behavior gets a failing test before production changes.

**Goal:** Add a visible editor runtime surface and workflow rail UX without changing storage, model calls, or layer boundaries.

## Task 1: M52 Editor Runtime

**Files:**

- Modify: `packages/ui/src/chapter-editor.tsx`
- Modify: `packages/ui/src/index.ts`
- Modify: `packages/ui/src/styles.css`
- Modify: `packages/ui/test/chapter-editor.test.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`

- [x] Write failing UI test for `Editor Runtime` strip.
- [x] Add `ChapterEditorRuntimeProps` and optional `runtime`.
- [x] Render adapter, mode, active range, autosave, shortcut profile, and warnings.
- [x] Compute runtime props in renderer from existing chapter editor state.
- [x] Run focused UI test.

## Task 2: M53 Workflow Rail

**Files:**

- Modify: `packages/ui/src/workspace-shell.tsx`
- Modify: `packages/ui/src/index.ts`
- Modify: `packages/ui/src/styles.css`
- Modify: `packages/ui/test/ai-writing-workflow.test.tsx`

- [x] Write failing UI test for live workflow rail with branch choices.
- [x] Write failing UI test for selected history workflow rail.
- [x] Extend workflow observed step props with branch metadata.
- [x] Render reusable workflow rail for live observability and history detail.
- [x] Run focused workflow UI test.

## Task 3: Documentation and Gates

**Files:**

- Create: `docs/productization/m52-editor-runtime.md`
- Create: `docs/productization/m53-workflow-ux.md`
- Modify: `ROADMAP.md`
- Modify: `INDEX.md`
- Modify: `CHANGELOG.md`
- Modify: `TECH_DEBT.md`
- Modify: `docs/productization/m35-constitution-gap-audit.md`

- [x] Update productization docs and roadmap progress.
- [x] Run `npm run typecheck`.
- [x] Run `npm run lint`.
- [x] Run `npm run format`.
- [x] Run `npm run test`.
- [x] Run `npm run test:e2e`.
- [x] Run `git diff --check`.
- [x] Commit with `feat: add editor runtime and workflow rail`.
