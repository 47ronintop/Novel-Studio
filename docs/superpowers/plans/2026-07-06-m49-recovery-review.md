# M49 Recovery Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a chapter recovery review loop with preview, apply, and discard actions.

**Architecture:** Recovery commands live in Application/ProjectWorkspaceSession and use the existing RecoveryRepository and ChapterEditorSession paths. Desktop IPC/preload expose typed project commands. UI receives a callback-only recovery review DTO and does not read files or mutate project data directly.

**Tech Stack:** TypeScript strict, Vitest, React static rendering tests, Electron Playwright E2E, existing repository/application/UI layering.

---

### Task 1: Application Recovery Contract

**Files:**

- Modify: `packages/application/src/project-workspace-session.ts`
- Modify: `packages/application/src/desktop-application.ts`
- Modify: `packages/application/src/novel-studio-api.ts`
- Modify: `packages/application/test/project-workflow-session.test.ts`

- [x] Write failing Application tests for previewing, applying, and discarding a dirty chapter recovery draft.
- [x] Add recovery preview/apply/discard types and methods to `ProjectWorkspaceSession`.
- [x] Apply inline draft content through the active chapter editor as an unsaved edit.
- [x] Mark applied or discarded records clean by writing a recovery record with `dirty: false`.
- [x] Expose the commands through `DesktopApplication`.
- [x] Run `npm run test -- packages/application/test/project-workflow-session.test.ts`.

### Task 2: Desktop IPC and Preload

**Files:**

- Modify: `packages/application/src/ipc-contract.ts`
- Modify: `apps/desktop/src/main/ipc-handlers.ts`
- Modify: `apps/desktop/src/preload/api.ts`
- Modify: `apps/desktop/test/project-workflow-ipc.test.ts`
- Modify: `apps/desktop/test/electron-security.test.ts`

- [x] Write failing IPC/security tests for the three recovery channels.
- [x] Add `preview-recovery-draft`, `apply-recovery-draft`, and `discard-recovery-draft` allowlisted channels.
- [x] Route handlers to DesktopApplication recovery methods.
- [x] Add preload project API methods.
- [x] Run `npm run test -- apps/desktop/test/project-workflow-ipc.test.ts apps/desktop/test/electron-security.test.ts`.

### Task 3: Renderer Bridge and Workspace UI

**Files:**

- Modify: `apps/desktop/src/renderer/project-workflow-bridge.ts`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `packages/ui/src/workspace-shell.tsx`
- Modify: `packages/ui/src/styles.css`
- Modify: `packages/ui/test/workspace-shell.test.tsx`
- Modify: `apps/desktop/test/project-workflow-bridge.test.ts`

- [x] Write failing bridge and UI tests for recovery review preview/apply/discard.
- [x] Add recovery review DTOs and buttons to the recovery notice.
- [x] Store selected preview state in the bridge and surface project workflow feedback on errors.
- [x] Wire `App` callbacks through the bridge.
- [x] Run `npm run test -- packages/ui/test/workspace-shell.test.tsx apps/desktop/test/project-workflow-bridge.test.ts`.

### Task 4: E2E and Productization Docs

**Files:**

- Create: `docs/productization/m49-recovery-review.md`
- Modify: `apps/desktop/test/project-workflow.e2e.ts`
- Modify: `ROADMAP.md`
- Modify: `INDEX.md`
- Modify: `CHANGELOG.md`
- Modify: `TECH_DEBT.md`
- Modify: `docs/productization/m35-constitution-gap-audit.md`
- Modify: `docs/superpowers/plans/2026-07-06-m49-recovery-review.md`

- [x] Write an E2E test that opens a project with a dirty recovery record, previews it, applies it, saves it, and verifies the chapter file.
- [x] Document M49 scope, data flow, risks, and acceptance.
- [x] Update roadmap/index/changelog and plan the next product-ready tasks after M49.
- [x] Run `npm run typecheck`.
- [x] Run `npm run lint`.
- [x] Run `npm run format`.
- [x] Run `npm run test`.
- [x] Run `npm run test:e2e`.
- [x] Run `git diff --check`.
- [x] Commit with `feat: add recovery review`.
