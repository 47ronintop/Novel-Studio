# M29 Functional Completion Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 M29 功能完成度审计，并让命令面板 safe commands 能真实执行并同步桌面 shell state。

**Architecture:** `CommandPalette` 只负责把点击的 safe command ID 传给宿主；renderer `App` 调用 preload API 的 `commands.execute` 并更新 `shellState`。Application 层已有 safe command allowlist，M29 不新增文件系统、模型或 AI 自动写入能力。

**Tech Stack:** TypeScript strict、React、Vitest、Electron preload API、schema-first 文档门禁。

---

### Task 1: 文档

**Files:**

- Create: `docs/productization/m29-functional-completion-audit.md`
- Create: `docs/superpowers/specs/2026-07-05-m29-functional-completion-audit-design.md`
- Create: `docs/superpowers/plans/2026-07-05-m29-functional-completion-audit.md`

- [x] **Step 1: 写 M29 产品化说明**

记录 M29 的范围、非范围、功能完成度审计表和命令面板验收标准。

- [x] **Step 2: 写设计规格**

记录用户目标、架构、数据流、测试策略和范围取舍。

- [x] **Step 3: 写实施计划**

把实现拆成文档、UI TDD、renderer TDD、路线图更新和验证。

### Task 2: CommandPalette UI TDD

**Files:**

- Modify: `packages/ui/src/command-palette.tsx`
- Modify: `packages/ui/test/command-palette.test.tsx`

- [x] **Step 1: 写失败测试**

新增测试：点击“切换项目导航”命令按钮后，`onCommandExecute` 收到 `workspace.toggle-navigator`。

- [x] **Step 2: 验证红灯**

运行：`npm run test -- packages/ui/test/command-palette.test.tsx`

预期：失败，因为 `CommandPalette` 当前不接受 `onCommandExecute`，命令项也不是按钮。

- [x] **Step 3: 最小实现**

给 `CommandPaletteProps` 增加 `onCommandExecute?: (commandId: ApplicationCommand["id"]) => void`，将 safe command 渲染为按钮，点击时调用回调。

- [x] **Step 4: 验证绿灯**

运行：`npm run test -- packages/ui/test/command-palette.test.tsx`

预期：通过。

### Task 3: Renderer 命令执行 TDD

**Files:**

- Create: `apps/desktop/src/renderer/command-execution-bridge.ts`
- Create: `apps/desktop/test/command-execution-bridge.test.ts`
- Modify: `apps/desktop/src/renderer/App.tsx`

- [x] **Step 1: 写失败测试**

新增测试：bridge 执行 safe command 时调用 `api.commands.execute`，成功后返回 `DesktopShellState`。

- [x] **Step 2: 验证红灯**

运行：`npm run test -- apps/desktop/test/command-execution-bridge.test.ts`

预期：失败，因为 bridge 文件尚未存在。

- [x] **Step 3: 最小实现 bridge**

实现 `createCommandExecutionBridge(api)`，暴露 `execute(commandId)`，透传 API result。

- [x] **Step 4: App 接线**

`App.tsx` 创建 bridge，新增 `handleCommandExecute`，成功时 `setShellState(result.value)` 并关闭 `shortcutState.commandPaletteOpen`。

- [x] **Step 5: 验证绿灯**

运行：`npm run test -- apps/desktop/test/command-execution-bridge.test.ts packages/ui/test/command-palette.test.tsx`

预期：通过。

### Task 4: 路线图和发布文档

**Files:**

- Modify: `ROADMAP.md`
- Modify: `INDEX.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/releases/v0.1.0-beta.md`
- Modify: `docs/releases/v0.1.0-beta-readiness.md`

- [x] **Step 1: 更新 M29 状态**

标记 M29 完成，说明 M27 因核心功能补齐优先级被暂缓。

- [x] **Step 2: 更新 beta 说明**

记录 M29 包含功能完成度审计和命令面板执行闭环，不包含欢迎页。

### Task 5: 验证和提交

**Files:**

- No production file changes beyond previous tasks.

- [x] **Step 1: 运行目标验证**

运行：`npm run test -- packages/ui/test/command-palette.test.tsx apps/desktop/test/command-execution-bridge.test.ts`

- [x] **Step 2: 运行全量验证**

运行：`npm run format`、`npm run typecheck`、`npm run lint`、`npm run test`、`npm run test:contract`、`npm audit`、`npm run release:check`、`npm run package:check`、`npm run alpha:check`、`npm run test:e2e`、`npm run package:installer`、`npm run package:artifact-check`。

- [x] **Step 3: 本地提交**

运行：`git commit -m "feat: add functional completion audit"`。

- [x] **Step 4: 不 push**

报告提交哈希、验证证据、当前总进度、当前进度和下一步建议。
