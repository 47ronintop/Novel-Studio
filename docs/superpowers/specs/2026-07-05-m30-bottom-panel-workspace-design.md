# M30 底部面板真实切换与最小内容闭环设计

## 背景

M28 将底部面板 tabs 标记为禁用，避免它们表现为无反馈按钮。M29 已补齐命令面板执行闭环。M30 继续处理高可见半成品入口，把底部面板从“禁用说明”推进到“可切换、可理解、有内容”。

## 用户目标

用户需要看到底部面板是真实工作区的一部分。点击“工作流运行 / 问题 / 搜索 / 日志”后，界面应切换到对应内容，说明当前项目运行状态、可见问题、搜索摘要和本地 beta 运行边界。

## 架构

`DesktopShellState` 增加 `activeBottomPanelTab`，默认值为 `工作流运行`。Application 和 renderer 默认 shell state 都维护该字段。`WorkspaceShell` 增加 `onBottomPanelTabSelect` 回调，点击 tab 时由 renderer 更新内存 shell state。

底部内容不新增 repository 或 IPC。它只消费当前已经传入 `WorkspaceShell` 的 `aiWritingWorkflow` 和 `search` props，以及固定的 beta 状态文案。M30 因此不需要 schema 变更，也不扩大文件系统或模型调用边界。

## 数据流

1. 初始 shell state 设置 `activeBottomPanelTab: "工作流运行"`。
2. 用户点击底部 tab。
3. `WorkspaceShell` 调用 `onBottomPanelTabSelect(tab)`。
4. Renderer `App` 更新 `shellState.activeBottomPanelTab`。
5. `WorkspaceShell` 根据 active tab 渲染对应面板内容。

## 测试策略

- Application 测试确认默认 shell state 包含 `activeBottomPanelTab`，并且 toggle bottom panel 不改变 active tab。
- WorkspaceShell 测试确认底部 tabs 可点击、不再 disabled，并渲染四类内容。
- Renderer shortcut / command 既有测试继续覆盖底部面板显隐命令。
- 全量验证沿用现有 gate。
