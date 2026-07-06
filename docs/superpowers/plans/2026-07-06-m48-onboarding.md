# M48 Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a workspace-native onboarding panel with example project, create/open project, and first chapter actions.

**Architecture:** Onboarding remains a renderer/UI DTO. The UI invokes callbacks only; project creation still goes through `ProjectWorkflowBridge`, preload IPC, Application, and Repository. Example content is fixture-like local text and does not call models.

**Tech Stack:** TypeScript strict, React static rendering tests, Vitest, Electron Playwright E2E, existing CSS.

---

### Task 1: UI Onboarding Surface

**Files:**

- Modify: `packages/ui/src/workspace-shell.tsx`
- Modify: `packages/ui/src/styles.css`
- Modify: `packages/ui/test/workspace-shell.test.tsx`

- [x] Write failing UI tests for the onboarding panel, action callbacks, and empty workspace first-chapter action.
- [x] Add `OnboardingProps` and render a compact “快速开始” panel inside the workspace editor surface.
- [x] Add styles for the onboarding panel without introducing a landing page.
- [x] Run `npm run test -- packages/ui/test/workspace-shell.test.tsx`.

### Task 2: Example Project Bridge

**Files:**

- Modify: `apps/desktop/src/renderer/project-workflow-bridge.ts`
- Modify: `apps/desktop/test/project-workflow-bridge.test.ts`

- [x] Write failing bridge tests for `createExampleProject()`.
- [x] Implement `createExampleProject()` by creating a project and then creating a sample chapter.
- [x] Keep all file effects behind `api.project.*`.
- [x] Run `npm run test -- apps/desktop/test/project-workflow-bridge.test.ts`.

### Task 3: Renderer Wiring and E2E

**Files:**

- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/test/project-workflow.e2e.ts`

- [x] Write failing E2E coverage for creating an example project from onboarding using a typed temp path.
- [x] Wire onboarding callbacks in `App`.
- [x] Run `npm run test:e2e`.

### Task 4: Productization Docs and Gates

**Files:**

- Create: `docs/productization/m48-onboarding.md`
- Modify: `ROADMAP.md`
- Modify: `INDEX.md`
- Modify: `CHANGELOG.md`
- Modify: `TECH_DEBT.md`
- Modify: `docs/productization/m35-constitution-gap-audit.md`
- Modify: `docs/superpowers/plans/2026-07-06-m48-onboarding.md`

- [x] Mark M48 complete in productization docs and roadmap.
- [x] Run `npm run typecheck`.
- [x] Run `npm run lint`.
- [x] Run `npm run format`.
- [x] Run `npm run test`.
- [x] Run `npm run test:e2e`.
- [x] Run `git diff --check`.
- [x] Commit with `feat: add onboarding quick start`.
