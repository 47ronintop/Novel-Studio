# M28 全局功能可用性盘点

版本：1.0 | 状态：M28 已采纳 | 阶段：Post-M18 产品化打磨

## 目标

M28 解决安装版和桌面主界面里“看起来能点，但点了没有反馈”的问题。所有高可见入口必须满足其中之一：

- 已接入真实行为。
- 明确禁用，并用中文 `title` / `aria-label` 说明原因。
- 显示中文空状态和下一步行动。

本里程碑不补齐所有大型功能本身，也不改变数据写入边界；它优先降低半成品感，让用户知道哪些入口现在可用，哪些入口仍待后续里程碑实现。

## 范围

M28 包含：

- 标题栏“命令面板”按钮接入打开行为，并补齐可访问名称和 tooltip。
- 当前唯一打开资产的编辑器 tab 标记为禁用，说明多 tab 切换将在后续补齐。
- 底部面板 tab 标记为禁用，说明底部面板切换将在后续补齐。
- WorkspaceShell 增加静态测试，防止高可见入口回退成无反馈按钮。
- 路线图、索引、changelog 和 beta release notes 同步当前状态。

M28 不包含：

- M27 安装后首次使用引导。
- 多 tab 编辑器。
- 底部面板真实内容切换。
- Timeline 可视化编辑器。
- 完整问题面板、日志面板或工作流 DAG 画布。

## UI 行为

命令面板按钮：

- 显示为可点击按钮。
- 点击后打开命令面板。
- 保留 `Ctrl/Cmd+K` 快捷键提示。

暂不可用 tab：

- 保留视觉位置，帮助用户理解未来布局。
- 使用 `disabled`、`aria-disabled` 或明确 `aria-label` 标记不可用。
- tooltip 使用中文说明具体原因，不让用户误以为软件卡住。

## 验收标准

- WorkspaceShell 测试覆盖命令面板按钮的可访问名称和 tooltip。
- WorkspaceShell 测试覆盖编辑器 tab 的禁用状态和中文原因。
- WorkspaceShell 测试覆盖底部面板 tab 的禁用状态和中文原因。
- Renderer App 将命令面板按钮接入现有 command palette 状态。
- UI 不直接访问文件系统，不新增真实模型调用，不新增 AI 自动写入。
- `format`、`typecheck`、`lint`、unit、contract、E2E、release、package、alpha、installer 和 artifact secret scan 均通过。
- 不 push；如需推送，必须先由用户确认。
