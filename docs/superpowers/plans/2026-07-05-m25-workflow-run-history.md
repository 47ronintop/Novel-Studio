# M25 工作流运行历史 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 AI 写作工作流增加本地运行历史，让用户能查看最近运行、失败摘要、trace 摘要和脱敏模型/用量信息。

**Architecture:** 历史记录由 Application 在 AI suggestion 生成后写入 Repository，落点在项目 `history/workflows/runs/`，不进入 `cache/`。Renderer 只通过 preload/IPC 获取 Application DTO，不直接访问文件系统。

**Tech Stack:** TypeScript strict、JSON Schema、Vitest、Electron IPC、React UI。

---

### Task 1: 文档与 Schema

**Files:**

- Create: `docs/productization/m25-workflow-run-history.md`
- Create: `packages/schemas/schema/workflow-run-record.schema.json`
- Create: `fixtures/schemas/valid/workflow-run-record.json`
- Create: `fixtures/schemas/invalid/workflow-run-record.json`
- Modify: `packages/schemas/test/schema-contract.test.ts`

- [ ] **Step 1: Write the failing contract test**

Add `workflow-run-record` to the schema contract cases and expect the valid fixture to pass and invalid fixture to fail.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:contract`

Expected: FAIL because `workflow-run-record.schema.json` does not exist yet.

- [ ] **Step 3: Add schema and fixtures**

Define a strict record with `schemaVersion`, `workflowRunId`, `workflowId`, `workflowTitle`, `status`, `startedAt`, `updatedAt`, `context`, `model`, `usage`, `steps`, and optional `error`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:contract`

Expected: PASS.

### Task 2: Repository

**Files:**

- Modify: `packages/repository/src/ports.ts`
- Modify: `packages/repository/src/history-repository.ts`
- Modify: `packages/repository/src/index.ts`
- Test: `packages/repository/test/workflow-run-history.test.ts`

- [ ] **Step 1: Write failing repository tests**

Cover writing a workflow run record under `history/workflows/runs/<run-id>.json`, listing newest records first, reading a detail record, returning an empty list when no history exists, and rejecting invalid records without writing partial files.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- packages/repository/test/workflow-run-history.test.ts`

Expected: FAIL because workflow run history APIs do not exist.

- [ ] **Step 3: Implement repository APIs**

Add `recordWorkflowRun`, `listWorkflowRuns`, and `readWorkflowRun` to the existing `HistoryRepository`, using schema validation before atomic write.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- packages/repository/test/workflow-run-history.test.ts`

Expected: PASS.

### Task 3: Application And Desktop IPC

**Files:**

- Modify: `packages/application/src/ai-writing-workflow-session.ts`
- Modify: `packages/application/src/desktop-application.ts`
- Modify: `packages/application/src/novel-studio-api.ts`
- Modify: `packages/application/src/ipc-contract.ts`
- Modify: `apps/desktop/src/main/application-composition.ts`
- Modify: `apps/desktop/src/main/ipc-allowlist.ts`
- Modify: `apps/desktop/src/main/ipc-handlers.ts`
- Modify: `apps/desktop/src/preload/api.ts`
- Tests: `packages/application/test/ai-writing-workflow-session.test.ts`, `apps/desktop/test/ai-writing-workflow-ipc.test.ts`

- [ ] **Step 1: Write failing application/IPC tests**

Assert AI suggestion generation records a workflow run history entry and desktop IPC can list history through a new allowlisted channel.

- [ ] **Step 2: Run targeted tests to verify failure**

Run: `npm run test -- packages/application/test/ai-writing-workflow-session.test.ts apps/desktop/test/ai-writing-workflow-ipc.test.ts`

Expected: FAIL because session and IPC history APIs are missing.

- [ ] **Step 3: Implement Application and IPC**

Inject the workflow history repository port into the AI writing session and expose list/read methods through DesktopApplication and preload.

- [ ] **Step 4: Run targeted tests to verify pass**

Run: `npm run test -- packages/application/test/ai-writing-workflow-session.test.ts apps/desktop/test/ai-writing-workflow-ipc.test.ts`

Expected: PASS.

### Task 4: Renderer Bridge And UI

**Files:**

- Modify: `apps/desktop/src/renderer/ai-writing-workflow-bridge.ts`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `packages/ui/src/workspace-shell.tsx`
- Modify: `packages/ui/src/styles.css`
- Modify: `packages/ui/src/index.ts`
- Tests: `apps/desktop/test/ai-writing-workflow-bridge.test.ts`, `packages/ui/test/ai-writing-workflow.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Assert the AI Workflow panel renders “工作流运行历史”, recent run rows, status, model, token/cost, and selected detail steps.

- [ ] **Step 2: Run targeted tests to verify failure**

Run: `npm run test -- apps/desktop/test/ai-writing-workflow-bridge.test.ts packages/ui/test/ai-writing-workflow.test.tsx`

Expected: FAIL because history props and UI are missing.

- [ ] **Step 3: Implement bridge and UI props**

Map Application history DTOs to UI labels and render a compact history list in the AI Workflow panel.

- [ ] **Step 4: Run targeted tests to verify pass**

Run: `npm run test -- apps/desktop/test/ai-writing-workflow-bridge.test.ts packages/ui/test/ai-writing-workflow.test.tsx`

Expected: PASS.

### Task 5: Verification And Commit

**Files:**

- Modify: `ROADMAP.md`
- Modify: `INDEX.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/releases/v0.1.0-beta.md`
- Modify: `docs/releases/v0.1.0-beta-readiness.md`

- [ ] **Step 1: Run full verification**

Run: `npm run format`, `npm run typecheck`, `npm run lint`, `npm run test`, `npm run test:contract`, `npm audit`, `npm run release:check`, `npm run package:check`, `npm run alpha:check`, `npm run test:e2e`, `npm run package:installer`, `npm run package:artifact-check`.

- [ ] **Step 2: Commit locally**

Run: `git commit -m "feat: add workflow run history"`.

- [ ] **Step 3: Do not push**

Report commit hash, validation evidence, total progress, current progress, and next suggested milestone.
