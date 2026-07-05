# M31/M32 搜索跳转与时间线主视图设计

## 背景

M30 已让底部面板可切换，但用户试用时仍会遇到可见功能缺口。当前最影响连续使用的是：搜索结果只能看不能跳转，时间线入口仍不是主视图。

## 目标

M31 补齐搜索结果点击跳转。M32 补齐时间线主视图。两个里程碑合并开发，但保留独立文档、测试和提交边界。

## 架构

搜索结果跳转不新增 Application 方法。章节结果复用 `ProjectWorkflowBridge.selectChapter`，Story Bible 和 memory 结果复用 `StoryBibleBridge.selectEntry`。`WorkspaceShell` 只暴露 `onSearchResultOpen` 和 `onTimelineEntryOpen` 回调，renderer `App` 负责状态切换。

时间线主视图消费现有 `StoryBibleEditorProps.entries`，筛选 `kind === "timeline"`。点击条目后切到故事圣经，并选中对应条目。M32 不改变 Story Bible schema，也不引入时间轴画布。

## 数据流

1. 用户在搜索视图点击结果。
2. UI 回传 `ProjectSearchResultItem`。
3. renderer 根据 `sourceRef.kind` 决定跳转：
   - `chapter`：切到工作区并调用 `projectWorkflowBridge.selectChapter(id)`。
   - `story-asset` 或 `memory`：切到故事圣经并调用 `storyBibleBridge.selectEntry(id)`。
4. 用户在时间线视图点击条目。
5. renderer 切到故事圣经并调用 `storyBibleBridge.selectEntry(id)`。

## 测试策略

- WorkspaceShell 测试覆盖搜索结果按钮点击回传 result。
- WorkspaceShell 测试覆盖时间线主视图条目展示和点击回调。
- renderer 目标行为通过类型检查和现有 bridge 测试保护。
- 全量门禁仍包括 format、typecheck、lint、test、contract、audit、release、package、alpha、E2E 和安装包 smoke。
