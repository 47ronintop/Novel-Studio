# M22 设置体验补齐

Version: 1.0 | Status: Accepted for M22 | Phase: Post-M18 Productization

## 目标

M22 将 M8/M15 已具备的模型设置能力产品化为可直接使用的桌面设置页。用户可以在“设置”视图中查看、编辑、保存、设为默认并测试模型 profile，同时明确看到自动保存、历史和隐私安全边界。

## 范围

M22 包含：

- Settings Activity 从中文空状态升级为正式设置主视图。
- 模型 profile 列表展示 provider、模型名、默认状态、连接测试状态和安全密钥提示。
- 模型编辑表单支持 `openai-compatible`、`openai`、`ollama`、Base URL、模型名、temperature、max tokens、top P、timeout 和 `secret://` 密钥引用。
- 保存通过 renderer bridge 调用 `settings.saveModelProfile`，可保留已有密钥引用，也可显式输入新的 `secret://` 引用。
- 设为默认通过同一 Application settings session 保存，不直接改写项目文件。
- 连接测试通过 `settings.testModelProfileConnection` 调用桌面端注入 tester，CI 不访问真实模型 endpoint。
- 设置页补齐“自动保存与历史”和“隐私与安全”中文说明，避免用户误以为功能按钮无响应。

M22 不包含：

- 真实系统密钥管理器写入 UI。
- Provider marketplace 或自动发现模型。
- 快捷键重绑定完整编辑器。
- 插件设置的完整权限授权 UI。
- 对真实模型 endpoint 的 CI 验证。

## 交互设计

设置页采用高密度工具界面：

- 左侧为设置分区导航。
- 主区域先展示“模型配置”，再展示“自动保存与历史”“隐私与安全”。
- 列表项用于选择已有 profile，右侧表单用于编辑当前草稿。
- “新建模型”创建本地草稿；“保存模型配置”才写入项目 settings。
- “测试连接”只调用注入 tester，并显示中文状态。

## 数据与安全边界

Renderer 不直接访问文件系统，也不直接修改 `settings.json`。所有保存、设默认和连接测试都经 preload API、IPC allowlist 和 Application `ModelSettingsSession`。

UI 不显示明文 API Key；列表只提示“已保存密钥引用”。编辑表单留空时沿用已有 `apiKeyRef`，输入时只接受 `secret://` 引用。真实密钥值不得出现在日志、错误、UI 或 fixture 中。

## 验收标准

- UI 测试覆盖设置页分区、模型列表、编辑表单、安全提示和密钥不泄露。
- Renderer bridge 测试覆盖加载、编辑草稿、保存、设默认和连接测试。
- TypeScript strict、lint、format、unit、contract、E2E、package、alpha 和 artifact secret scan 均通过。
- 不新增真实模型调用，不新增 telemetry，不 push。
