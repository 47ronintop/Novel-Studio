# M50/M51 Preferences and Recovery Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist user-level UI preferences and harden recovery behavior around processed and unsupported recovery records.

**Architecture:** Preferences are user-level JSON accessed through Repository/Application/IPC/preload. Recovery hardening stays in Application/Repository tests and keeps protected records in `history/recovery/`.

**Tech Stack:** TypeScript strict, Vitest, Electron Playwright E2E, existing Repository/Application/Renderer layering.

---

### Task 1: User Preferences Repository and Session

**Files:**

- Create: `packages/application/src/user-preferences-session.ts`
- Create: `packages/repository/src/user-preferences-repository.ts`
- Modify: `packages/application/src/index.ts`
- Modify: `packages/repository/src/index.ts`
- Test: `packages/application/test/user-preferences-session.test.ts`
- Test: `packages/repository/test/user-preferences-repository.test.ts`

- [x] Write failing tests for default load and save/readback.
- [x] Implement user preferences DTOs and session.
- [x] Implement JSON file repository with atomic writes.
- [x] Export types and repository.
- [x] Run focused tests.

### Task 2: Desktop API and Renderer Persistence

**Files:**

- Modify: `packages/application/src/desktop-application.ts`
- Modify: `packages/application/src/novel-studio-api.ts`
- Modify: `packages/application/src/ipc-contract.ts`
- Modify: `apps/desktop/src/main/ipc-handlers.ts`
- Modify: `apps/desktop/src/main/application-composition.ts`
- Modify: `apps/desktop/src/preload/api.ts`
- Modify: `apps/desktop/src/preload/index.cts`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Test: `apps/desktop/test/electron-security.test.ts`
- Test: `apps/desktop/test/project-workflow.e2e.ts`

- [x] Write failing IPC/security and E2E tests for persisted onboarding dismissal.
- [x] Add `preferences.load` and `preferences.save` preload methods.
- [x] Load preferences on renderer startup.
- [x] Save preferences after onboarding dismiss, layout commands, activity selection, and bottom panel tab selection.
- [x] Run focused desktop tests and E2E.

### Task 3: Recovery Hardening

**Files:**

- Modify: `packages/application/test/project-workflow-session.test.ts`
- Modify: `docs/productization/m51-recovery-hardening.md`

- [x] Add tests proving clean recovery records remain hidden from dirty summary.
- [x] Add tests proving file-ref recovery preview/apply returns `RECOVERY_DRAFT_CONTENT_UNAVAILABLE`.
- [x] Document remaining Recovery Hardening tasks.
- [x] Run focused Application tests.

### Task 4: Docs, Gates, Commit

**Files:**

- Create: `docs/productization/m50-user-preferences.md`
- Create: `docs/productization/m51-recovery-hardening.md`
- Modify: `ROADMAP.md`
- Modify: `INDEX.md`
- Modify: `CHANGELOG.md`
- Modify: `TECH_DEBT.md`
- Modify: `docs/productization/m35-constitution-gap-audit.md`
- Modify: `docs/superpowers/plans/2026-07-06-m50-m51-preferences-recovery-hardening.md`

- [x] Update productization docs and next task plan.
- [x] Run `npm run typecheck`.
- [x] Run `npm run lint`.
- [x] Run `npm run format`.
- [x] Run `npm run test`.
- [x] Run `npm run test:e2e`.
- [x] Run `git diff --check`.
- [x] Commit with `feat: add preferences and recovery hardening`.
