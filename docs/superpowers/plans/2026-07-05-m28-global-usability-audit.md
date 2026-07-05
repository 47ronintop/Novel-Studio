# M28 全局功能可用性盘点实施计划

> **执行约束：** 按任务逐项实施；涉及实现时遵守 TDD、TypeScript strict、禁止 `any`、UI 不直接访问文件系统、AI 输出写入前必须用户确认。

**目标：** 清理桌面主界面高可见无反馈入口，让可见控件要么可用，要么明确禁用并说明原因。
**架构：** 只改 UI/renderer 层的交互接线和可访问状态，不新增 Repository/Application 文件系统能力，不新增模型调用。命令面板继续使用现有 renderer state；暂未实现的 tab 使用禁用态和中文原因。
**技术栈：** TypeScript strict、React、Vitest static markup tests、Electron renderer。

---

### 任务 1：文档

**文件：**

- 新增：`docs/productization/m28-global-usability-audit.md`
- 新增：`docs/superpowers/plans/2026-07-05-m28-global-usability-audit.md`

- [x] **步骤 1：定义 M28 范围**

记录 M28 是可用性 affordance 清理，不是一次性补齐所有待实现功能。

### 任务 2：UI 红灯测试

**文件：**

- 修改：`packages/ui/test/workspace-shell.test.tsx`

- [x] **步骤 1：编写失败测试**

断言命令面板按钮具备可访问名称和 tooltip，编辑器 tab 以中文原因禁用，底部面板 tab 以中文原因禁用。

- [x] **步骤 2：运行测试确认红灯**

运行：`npm run test -- packages/ui/test/workspace-shell.test.tsx`

预期：实现 UI 属性和禁用态之前失败。

### 任务 3：UI 实现

**文件：**

- 修改：`packages/ui/src/workspace-shell.tsx`
- 修改：`apps/desktop/src/renderer/App.tsx`

- [x] **步骤 1：实现命令面板按钮**

在 `WorkspaceShell` 暴露 `onCommandPaletteOpen`，并在 `App` 中接入现有命令面板状态。

- [x] **步骤 2：明确标记未完成 tab**

用中文 `title` / `aria-label` 原因禁用单个编辑器 tab 和底部面板 tabs。

- [x] **步骤 3：运行目标测试**

运行：`npm run test -- packages/ui/test/workspace-shell.test.tsx`

预期：通过。

### 任务 4：路线图和验证

**文件：**

- 修改：`ROADMAP.md`
- 修改：`INDEX.md`
- 修改：`CHANGELOG.md`
- 修改：`docs/releases/v0.1.0-beta.md`
- 修改：`docs/releases/v0.1.0-beta-readiness.md`

- [x] **步骤 1：更新里程碑文档**

标记 M28 完成，说明用户明确跳到 M28 因此 M27 仍待回补，并将下一建议里程碑设为 M27。

- [x] **步骤 2：运行完整验证**

运行：`npm run format`、`npm run typecheck`、`npm run lint`、`npm run test`、`npm run test:contract`、`npm audit`、`npm run release:check`、`npm run package:check`、`npm run alpha:check`、`npm run test:e2e`、`npm run package:installer`、`npm run package:artifact-check`。

- [ ] **步骤 3：本地提交**

运行：`git commit -m "feat: add global usability audit"`。

- [ ] **步骤 4：不 push**

报告提交哈希、验证证据、总进度、当前进度和下一里程碑。
