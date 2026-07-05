# M26 工作流失败诊断与重试策略 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 AI 写作工作流补齐失败诊断、失败历史记录、重试策略展示和用户触发重试入口。

**Architecture:** Application 在工作流已经启动且模型/Agent 步骤失败时写入脱敏 `failed` run record。Renderer bridge 将失败 Result 转为 UI 状态并加载最近历史，UI 只调用 preload API，不直接访问文件系统。

**Tech Stack:** TypeScript strict、JSON Schema、Vitest、Electron IPC、React UI。

---

### Task 1: 文档与 Schema

**Files:**

- Create: `docs/productization/m26-workflow-failure-retry.md`
- Modify: `packages/schemas/schema/workflow-run-record.schema.json`
- Modify: `fixtures/schemas/valid/workflow-run-record.json`
- Modify: `packages/schemas/test/schema-contract.test.ts`

- [ ] **Step 1: Write failing contract coverage**

Extend the valid workflow run fixture with `error.recoverability`, `error.suggestedAction`, `error.retryable`, and `retryPolicy`.

- [ ] **Step 2: Run test to verify failure**

Run: `npm run test:contract`

Expected: FAIL before the schema accepts the new fields.

- [ ] **Step 3: Implement schema extension**

Allow optional retry policy and expanded error summary while keeping `additionalProperties: false`.

- [ ] **Step 4: Run test to verify pass**

Run: `npm run test:contract`

Expected: PASS.

### Task 2: Application Failure History

**Files:**

- Modify: `packages/application/src/ai-writing-workflow-session.ts`
- Test: `packages/application/test/ai-writing-workflow-session.test.ts`

- [ ] **Step 1: Write failing application test**

Assert a model/Agent failure returns an error and writes a `failed` workflow run record with redacted diagnostics and retry policy.

- [ ] **Step 2: Run targeted test to verify failure**

Run: `npm run test -- packages/application/test/ai-writing-workflow-session.test.ts`

Expected: FAIL before failure history is written.

- [ ] **Step 3: Implement failure record creation**

Create failed records after context/model information is available. Mark context completed, agent failed, confirmation pending, and attach only stable error fields.

- [ ] **Step 4: Run targeted test to verify pass**

Run: `npm run test -- packages/application/test/ai-writing-workflow-session.test.ts`

Expected: PASS.

### Task 3: Renderer Bridge And UI

**Files:**

- Modify: `apps/desktop/src/renderer/ai-writing-workflow-bridge.ts`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `packages/ui/src/workspace-shell.tsx`
- Modify: `packages/ui/src/styles.css`
- Tests: `apps/desktop/test/ai-writing-workflow-bridge.test.ts`, `packages/ui/test/ai-writing-workflow.test.tsx`

- [ ] **Step 1: Write failing bridge/UI tests**

Assert failed generation returns UI props with status `failed`, failure diagnostic labels, retry policy labels, history detail, and a retry button.

- [ ] **Step 2: Run targeted tests to verify failure**

Run: `npm run test -- apps/desktop/test/ai-writing-workflow-bridge.test.ts packages/ui/test/ai-writing-workflow.test.tsx`

Expected: FAIL before bridge/UI support failed status.

- [ ] **Step 3: Implement bridge/UI**

Map failed Result into UI props, load latest workflow history, render failure diagnostic and retry policy, and wire retry to the existing generation path.

- [ ] **Step 4: Run targeted tests to verify pass**

Run: `npm run test -- apps/desktop/test/ai-writing-workflow-bridge.test.ts packages/ui/test/ai-writing-workflow.test.tsx`

Expected: PASS.

### Task 4: Roadmap And Verification

**Files:**

- Modify: `ROADMAP.md`
- Modify: `INDEX.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/releases/v0.1.0-beta.md`
- Modify: `docs/releases/v0.1.0-beta-readiness.md`

- [ ] **Step 1: Update milestone docs**

Mark M26 complete and set the next suggested milestone to M27 安装后首次使用引导。

- [ ] **Step 2: Run full verification**

Run: `npm run format`, `npm run typecheck`, `npm run lint`, `npm run test`, `npm run test:contract`, `npm audit`, `npm run release:check`, `npm run package:check`, `npm run alpha:check`, `npm run test:e2e`, `npm run package:installer`, `npm run package:artifact-check`.

- [ ] **Step 3: Commit locally**

Run: `git commit -m "feat: add workflow failure retry ux"`.

- [ ] **Step 4: Do not push**

Report commit hash, validation evidence, total progress, current progress, and next milestone.
