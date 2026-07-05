# M21 故事圣经编辑体验

Version: 1.0 | Status: Accepted for M21 | Phase: Post-M18 Productization

## 目标

M21 将 M16 的 Story Bible 数据闭环和 M20 的搜索来源，推进为作者可直接使用的编辑界面。用户可以在桌面 UI 中新增或编辑人物、世界观、大纲、时间线和记忆，并通过现有 Application/IPC 边界保存到项目文件。

## 范围

M21 包含：

- 左侧 Activity Bar 新增“故事圣经”入口。
- Story Bible 主视图显示人物、世界观、大纲、时间线、记忆五类资产。
- 编辑表单支持选择分类、选择已有条目、新建草稿、编辑标题与正文摘要/内容。
- 保存人物、世界观、大纲和时间线时调用 `storyBible.saveAsset`。
- 保存记忆时调用 `storyBible.saveMemory`，默认写入用户确认的长期记忆。
- 保存后重新加载 Story Bible snapshot，并刷新 Inspector 摘要与导航计数。

M21 不包含：

- AI 自动抽取或自动写入 Story Bible。
- 人物关系图、时间线可视化画布或复杂结构化字段编辑器。
- 批量导入、批量删除、合并冲突处理。
- 插件访问 Story Bible 编辑能力。

## 交互设计

Story Bible 视图采用产品工具界面，而不是营销式页面：

- 顶部标题说明当前项目设定库。
- 左侧为五类资产的分组列表。
- 右侧为单一编辑表单，避免弹窗。
- “新建”重置草稿；“保存”执行显式用户操作。
- 保存成功或失败显示中文反馈。

## 数据与安全边界

Renderer 只持有结构化草稿，不直接访问项目文件。保存经 preload API、Desktop IPC 和 Application Story Bible Session。密钥、模型配置和日志不参与 Story Bible 编辑流程。

AI 输出仍只能作为建议态出现在 AI workflow；M21 不允许模型结果自动写入 Story Bible。

## 验收标准

- UI 测试覆盖“故事圣经”入口、编辑表单、分组列表和保存按钮。
- Bridge 测试覆盖加载 snapshot、选择条目、更新草稿、保存 asset、保存 memory。
- IPC 仍通过既有 Story Bible allowlist channels，renderer 不访问文件系统。
- 保存后刷新摘要数据，Inspector 与主视图看到同一份 Story Bible 状态。
