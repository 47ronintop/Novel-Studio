# M36-M37 Workspace Layout 与编辑器标签

版本：1.0 | 状态：M36/M37 已采纳 | 阶段：Post-M18 产品化打磨

## 目标

M36/M37 合并处理 M35 排在最前面的两个可见缺口：工作区布局和编辑器标签。目标不是一次完成完整 VS Code 级 Dock 系统，而是建立可继续扩展的最小产品闭环：

- 工作区支持 Split View、面板尺寸状态和安全命令入口。
- 编辑器标签从“章节列表切换”升级为运行期打开标签集合，支持关闭非唯一标签和 dirty 标记。

## 范围

包含：

- `DesktopShellState` 增加工作区布局状态，包含 Split View 开关、导航宽度、检查器宽度、底部面板高度。
- `ApplicationCommand` 增加布局相关 safe command，用于切换 Split View、调整导航宽度和调整检查器宽度。
- `WorkspaceShell` 根据布局状态渲染 CSS 变量、Split View 双栏和布局工具按钮。
- `ProjectWorkflowBridge` 维护运行期打开章节标签集合，打开/创建/选择章节时加入标签，关闭标签时更新集合。
- 关闭当前活动标签时，选择相邻标签；只剩一个标签时不关闭，避免空编辑器状态。
- 文档、路线图、索引、变更记录同步 M36/M37。

不包含：

- 拖拽排序。
- 跨资产标签。
- 关闭未保存标签时的冲突弹窗。
- 布局状态写入项目文件或用户配置文件。
- 多窗口布局同步。

## 设计原因

当前 `WorkspaceShell` 已经有固定的 Activity Bar、Navigator、Editor、Inspector 和 Bottom Panel，适合先用 CSS 变量和 Application shell state 扩展，不需要引入新的 dock layout 库。编辑器标签当前从 `projectWorkflow.chapters` 直接渲染，导致“所有章节都是打开标签”，不符合 IDE 心智；M37 先让 renderer bridge 维护打开集合，后续再扩展到跨资产标签和持久化。

## 验收标准

- 新 safe commands 全部仍为 `safe`，执行后不访问文件系统。
- Shell state 默认包含布局状态。
- UI 渲染 `data-split-view`、布局 CSS 变量和 Split View 辅助栏。
- 标签只显示打开集合，不再默认显示全部章节。
- 点击关闭标签回调会关闭目标标签；关闭当前标签会选择相邻标签。
- 相关单元测试、类型检查、lint 和格式检查通过。
