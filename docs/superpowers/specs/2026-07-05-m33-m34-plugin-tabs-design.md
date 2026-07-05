# M33/M34 插件管理与多标签编辑设计

## 背景

M31/M32 已补齐搜索跳转和时间线主视图。剩余高可见缺口中，插件系统已有 M18 底层边界但没有 UI；编辑器顶部 tab 仍是单一禁用标签，用户会直观看到“功能未完成”。

## 目标

M33 补齐只读插件管理 UI。M34 补齐章节标签切换。两个里程碑合并开发，但保留独立产品化文档、测试和提交边界。

## M33 设计

Application 新增插件注册表摘要读取接口，Repository 从项目 `plugins/plugins.json` 读取并按 `plugin-registry` schema 校验。Desktop IPC/preload 增加只读通道。Renderer 新增 `PluginSettingsBridge`，Settings 视图显示插件管理区。

M33 只显示注册表条目：plugin id、enabled/disabled、manifest path、granted permissions。M33 不读取 manifest、不执行插件代码、不安装插件、不改写注册表。

## M34 设计

`WorkspaceShell` 的工作区顶部 tab 从单一禁用按钮改为章节标签列表。标签来源使用现有 `ProjectWorkflowProps.chapters`，当前章节由 `activeChapterId` 标记。点击标签调用现有 `projectWorkflow.onSelectChapter`，renderer 已有 `handleSelectChapter` 负责调用 preload/Application 并刷新章节编辑器。

M34 不新增持久化 tab 数据结构。它先解决“顶部标签能点、能切换”的可见体验，后续再扩展关闭 tab、跨资产 tab 和 Split View。

## 测试策略

- Application 测试覆盖插件注册表读取和缺失 port 的稳定错误。
- IPC/preload 测试覆盖插件注册表通道在 allowlist 与 API 中可用。
- Settings bridge 测试覆盖加载插件注册表、刷新和错误反馈。
- WorkspaceShell 测试覆盖章节标签可点击切换。
- 全量门禁继续包括 format、typecheck、lint、unit、contract、E2E、audit、package 和 artifact scan。
