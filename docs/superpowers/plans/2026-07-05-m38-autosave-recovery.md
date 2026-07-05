# M38 Autosave Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist chapter draft recovery records and surface available recovery state in the workspace.

**Architecture:** Shared defines the recovery contract, Repository reads/writes records under `history/recovery/`, Application injects recovery ports into chapter editor sessions, and UI receives recovery state through existing project/chapter props. Renderer remains filesystem-free.

**Tech Stack:** TypeScript strict, Vitest, React, Electron IPC, JSON schema-backed Repository.

---

### Task 1: Recovery Repository Read Contract

**Files:**

- Modify: `packages/shared/src/recovery.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/repository/src/recovery-repository.ts`
- Test: `packages/repository/test/repository-core.test.ts`

- [x] Write failing repository test for listing dirty recovery records newest first.
- [x] Implement `RecoveryRepositoryPort.listRecoveryRecords()`.
- [x] Verify focused repository test passes.

### Task 2: Chapter Editor Recovery Writes

**Files:**

- Modify: `packages/application/src/chapter-editor-session.ts`
- Test: `packages/application/test/chapter-autosave-recovery.test.ts`

- [x] Write failing Application test proving edit writes dirty recovery and save writes clean recovery.
- [x] Implement recovery port injection and record generation.
- [x] Verify focused Application test passes.

### Task 3: Project Workspace Recovery Summary

**Files:**

- Modify: `packages/application/src/project-workspace-session.ts`
- Modify: `apps/desktop/src/main/application-composition.ts`
- Test: `packages/application/test/project-workflow-session.test.ts`

- [x] Write failing test proving project open exposes dirty recovery items.
- [x] Inject `RecoveryRepository` in desktop composition.
- [x] Verify focused tests pass.

### Task 4: Renderer and UI Recovery Notice

**Files:**

- Modify: `apps/desktop/src/renderer/project-workflow-bridge.ts`
- Modify: `packages/ui/src/workspace-shell.tsx`
- Modify: `packages/ui/src/styles.css`
- Test: `apps/desktop/test/project-workflow-bridge.test.ts`
- Test: `packages/ui/test/workspace-shell.test.tsx`

- [x] Write failing renderer/UI tests for recovery notice and dirty tab ids.
- [x] Implement prop mapping and notice rendering.
- [x] Verify focused tests pass.

### Task 5: Documentation and Gates

**Files:**

- Modify: `ROADMAP.md`
- Modify: `INDEX.md`
- Modify: `CHANGELOG.md`
- Modify: `TECH_DEBT.md`

- [x] Update roadmap/index/changelog.
- [x] Run `npm run typecheck`, `npm run lint`, `npm run format`, `npm run test`, `npm run test:e2e`.
