# M23 Studio 体验补齐

Version: 1.0 | Status: Accepted for M23 | Phase: Post-M18 Productization

## 目标

M23 将 M8/M15 已具备的 Prompt、Agent、Workflow 配置资产能力产品化为可直接使用的 Studio 工作台。用户进入“创作系统”后，应能看到默认审稿 Prompt、默认审稿 Agent 和审稿当前章节 Workflow，选择资产、编辑 JSON、保存并从版本快照恢复。

M23 不新增配置 schema，不扩大 AI 自动写入范围。它复用现有 Application `ConfigStudioSession`、Repository `ConfigAssetRepository` 和 Desktop preload/IPCs，让 UI 始终通过受控边界访问项目配置资产。

## 范围

M23 包含：

- 新建项目默认创建可编辑的 Studio 配置资产：`prompts/prompt_reviewer_default.json`、`agents/agent_reviewer_default.json`、`workflow/wf_review_chapter.json`。
- Studio Activity 从中文空状态升级为真实工作台，包含配置资产列表、JSON 编辑器、保存按钮和版本历史区域。
- Renderer 新增 Studio bridge，负责加载默认配置资产、切换资产、更新草稿、保存和恢复版本。
- 保存前先解析 JSON；无效 JSON 不调用 preload save API，并以中文反馈提示用户修正。
- Desktop 组合接入当前项目根目录下的 `ConfigAssetRepository`，保存和恢复仍生成历史快照。
- UI 不直接访问文件系统；所有读写通过 preload API、IPC allowlist、Application Session 和 Repository 完成。

M23 不包含：

- 复杂可视化 Workflow 编排器。
- Prompt 变量表单编辑器。
- Agent 工具链高级授权 UI。
- 结构化 diff 预览。
- AI 自动生成或自动改写 Prompt/Agent/Workflow。
- 真实模型 endpoint 调用。

## 交互设计

Studio 工作台采用三栏工具布局：

- 左侧为配置资产列表，显示 Prompt、Agent、Workflow 三类默认资产。
- 中央为 JSON 编辑器，显示当前资产标题、类型、ID、schema 状态和保存入口。
- 右侧为版本历史，保存后显示可恢复的快照入口。

用户点击资产时，Renderer bridge 通过 `studio.loadConfigAsset` 加载内容。用户编辑 JSON 后，面板进入未保存状态；保存时先在 renderer 解析 JSON，再交给 Application/Repository 做 schema-first 校验与写入。恢复历史版本时，通过 `studio.restoreConfigAssetVersion` 读取历史快照并重新显示为当前内容。

## 数据与安全边界

Renderer 只持有字符串草稿和结构化 props，不直接读取或写入项目文件。配置资产的真实读写由 `ConfigAssetRepository` 完成，路径仍限制在 `prompts/`、`agents/`、`workflow/` 目录内。

密钥和模型凭证不属于 M23 Studio 草稿内容；模型 profile 仍由 Settings 管理。M23 不显示、不记录、不写入明文 API Key，不新增 telemetry，也不访问真实模型服务。

## 验收标准

- Repository 测试覆盖新建项目时默认 Studio 资产落盘。
- UI 测试覆盖 Studio 工作台、资产选择按钮、JSON 编辑器、保存按钮和版本恢复入口。
- Renderer bridge 测试覆盖加载默认资产、无效 JSON 阻止保存、保存与恢复版本。
- WorkspaceShell 在 `studio` 活动下渲染真实工作台，而不是旧空状态。
- `format`、`typecheck`、`lint`、unit、contract、E2E、release、package、alpha、installer 和 artifact secret scan 均通过。
- 不 push；如需推送，必须先由用户确认。
