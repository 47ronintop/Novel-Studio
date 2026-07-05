# M30 Bottom Panel Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让底部面板 tabs 从禁用说明升级为可切换的最小真实内容面板。

**Architecture:** 在 `DesktopShellState` 增加 `activeBottomPanelTab`，UI 点击通过 renderer 内存状态切换。底部内容只消费现有 UI props，不新增 Repository、IPC、真实模型调用或文件系统访问。

**Tech Stack:** TypeScript strict、React、Vitest、Electron renderer。

---

### Task 1: 文档

**Files:**

- Create: `docs/productization/m30-bottom-panel-workspace.md`
- Create: `docs/superpowers/specs/2026-07-05-m30-bottom-panel-workspace-design.md`
- Create: `docs/superpowers/plans/2026-07-05-m30-bottom-panel-workspace.md`

- [x] **Step 1: 定义 M30 范围**

记录底部面板真实切换、最小内容和非范围。

### Task 2: Shell State TDD

**Files:**

- Modify: `packages/application/src/desktop-application.ts`
- Modify: `packages/application/test/desktop-application.test.ts`
- Modify: `apps/desktop/src/renderer/App.tsx`

- [x] **Step 1: 写失败测试**

断言默认 `DesktopShellState` 包含 `activeBottomPanelTab: "工作流运行"`，并且 `workspace.toggle-bottom-panel` 不改变 active tab。

- [x] **Step 2: 验证红灯**

运行：`npm run test -- packages/application/test/desktop-application.test.ts`

- [x] **Step 3: 最小实现**

在 shell state 类型和默认值中加入 `activeBottomPanelTab`。

- [x] **Step 4: 验证绿灯**

运行：`npm run test -- packages/application/test/desktop-application.test.ts`

### Task 3: WorkspaceShell UI TDD

**Files:**

- Modify: `packages/ui/src/workspace-shell.tsx`
- Modify: `packages/ui/src/styles.css`
- Modify: `packages/ui/test/workspace-shell.test.tsx`

- [x] **Step 1: 写失败测试**

断言底部 tabs 不再 disabled，点击“搜索”会回传 tab，并渲染搜索面板摘要。

- [x] **Step 2: 验证红灯**

运行：`npm run test -- packages/ui/test/workspace-shell.test.tsx`

- [x] **Step 3: 最小实现**

添加 `onBottomPanelTabSelect`，渲染四个底部面板内容。

- [x] **Step 4: 验证绿灯**

运行：`npm run build:types` 和 `npm run test -- packages/ui/test/workspace-shell.test.tsx`

### Task 4: Renderer 接线

**Files:**

- Modify: `apps/desktop/src/renderer/App.tsx`

- [x] **Step 1: 接入 tab 切换 handler**

新增 `handleBottomPanelTabSelect`，更新 `shellState.activeBottomPanelTab`，并传给 `WorkspaceShell`。

- [x] **Step 2: 目标验证**

运行：`npm run typecheck` 和 `npm run test -- packages/ui/test/workspace-shell.test.tsx packages/application/test/desktop-application.test.ts`

### Task 5: 路线图、验证和提交

**Files:**

- Modify: `ROADMAP.md`
- Modify: `INDEX.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/releases/v0.1.0-beta.md`
- Modify: `docs/releases/v0.1.0-beta-readiness.md`

- [x] **Step 1: 更新文档**

标记 M30 完成并说明 M27 仍暂缓。

- [x] **Step 2: 运行全量验证**

运行：`npm run format`、`npm run typecheck`、`npm run lint`、`npm run test`、`npm run test:contract`、`npm audit`、`npm run release:check`、`npm run package:check`、`npm run alpha:check`、`npm run test:e2e`。

- [x] **Step 3: 本地提交**

运行：`git commit -m "feat: add bottom panel workspace"`。

- [x] **Step 4: 不 push**

报告提交哈希、验证证据、当前进度和下一步建议。
