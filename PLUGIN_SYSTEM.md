# PLUGIN_SYSTEM - Novel Studio

Version: 1.1 | Status: Updated for Stage 5 (E.1) | Phase: 7 Formal Development

## 1. 目的

M18 建立 Novel Studio v1 的插件系统边界。插件系统的目标不是实现完整市场或执行任意第三方代码，而是先定义可验证、可审计、最小权限的插件契约，让后续地图、人物关系图、TTS、翻译、发布平台、知识库和第三方 Agent 能通过统一边界接入。

插件是非可信边界。任何插件访问项目数据、注册命令、接入 workflow 或调用外部工具，都必须声明能力和权限，并经过 Schema 校验与运行时权限检查。

## 2. 范围

M18 落地：

- `plugin-manifest` JSON Schema：声明插件 id、版本、入口、能力、权限、兼容 app 版本和贡献点。
- `plugin-registry` JSON Schema：记录项目级插件启用状态、manifest 路径和授权状态，落点为项目 `plugins/plugins.json`。
- `@novel-studio/plugin-engine`：提供 manifest 解析前后的类型边界、注册表构建、兼容性检查和权限授权检查。
- package boundary tests：插件引擎不得依赖 Repository、Application、UI、LLM Adapter、Agent/Context/Workflow Engine 或 Electron。
- 文档与路线图同步。

M18 不落地：

- 远程插件市场。
- 自动下载、安装或更新插件。
- 执行任意第三方 JavaScript/Python。
- 插件 UI iframe/webview 沙箱。
- 插件访问真实文件系统或网络。

## 3. 插件 Manifest

插件 manifest 是插件的唯一入口契约。它必须是结构化 JSON，并至少声明：

- `id`
- `displayName`
- `version`
- `entry`
- `capabilities`
- `permissions`
- `compatibleAppVersion`
- `contributes`

插件 id 使用稳定命名，建议格式为 `publisher.plugin-name`。manifest 不允许保存密钥、token 或用户正文。

## 4. 能力与权限

能力描述插件能做什么，权限描述插件允许访问什么。能力不能自动授予权限。

M18 首批能力：

- `command`：注册命令。
- `workflow-step`：声明可被 workflow 调用的步骤。
- `asset-view`：声明只读资产视图。

M18 首批权限：

- `project:read`：读取项目摘要和已授权资产 DTO。
- `asset:read`：读取声明 scope 内的资产。
- `asset:write`：写入声明 scope 内的资产，必须经 Repository 和用户确认流程。
- `workflow:invoke`：被 workflow 调用。

权限必须带 `scope`，例如 `characters`、`world`、`outline`、`timeline`、`memories`、`chapters`。插件不得默认访问整个项目。

## 5. 注册表

项目级插件注册表存放于 `plugins/plugins.json`。注册表只保存启用状态、manifest 引用和授权策略，不复制插件 manifest 内容，不保存密钥。

禁用插件不得注册命令、不得进入 workflow、不得访问项目数据。缺少 manifest 或 schema 校验失败的插件进入 `invalid` 状态。

## 6. 运行时边界

`@novel-studio/plugin-engine` 是纯策略层：

- 不读写项目文件。
- 不执行插件代码。
- 不调用模型。
- 不访问 Electron API。
- 不依赖 Repository、Application、UI 或其他 Engine。

文件读写由 Repository 或上层 Adapter 负责；插件引擎只接收已经读取并通过 Schema 校验的数据。

## 7. 错误策略

插件错误使用 stable code：

- `PLUGIN_INVALID_MANIFEST`
- `PLUGIN_INCOMPATIBLE_APP_VERSION`
- `PLUGIN_DUPLICATE_ID`
- `PLUGIN_PERMISSION_DENIED`
- `PLUGIN_CAPABILITY_MISSING`
- `PLUGIN_DISABLED`

错误 detail 不得包含密钥、用户正文或未脱敏外部错误。

## 8. 测试要求

M18 必须覆盖：

- valid/invalid plugin manifest schema fixtures。
- valid/invalid plugin registry schema fixtures。
- 缺少权限时拒绝访问。
- 缺少能力时拒绝操作。
- disabled 插件不得授权。
- incompatible app version 被拒绝。
- duplicate plugin id 被拒绝。
- package boundary 不依赖 Repository/UI/Electron/LLM/Agent/Context/Workflow。

## 9. 验收标准

- 插件 manifest 和 registry 均为 schema-first。
- 插件运行时策略可在 CI 中离线、确定性测试。
- 插件不能绕过 Repository 写项目文件。
- 插件不能默认读取全项目。
- M18 不引入真实第三方插件执行，也不新增网络访问。

## 10. Stage 5 E.1 扩展：插件工具贡献类型（2026-07-24）

**新增能力类型**

- `"tool"` 加入 `capabilities[].type` 枚举：插件可声明供 Agent（LLM）调用的工具贡献，与 UI 命令面板的 `command`/`workflow-step` 完全独立。

**新增权限**

- `"tool:invoke"` 加入 `permissions[].permission` 枚举（scope 规则与现有权限相同，需声明 `project` 或具体资产 scope）。

**`contributes.tools` 数组（可选，向后兼容）**

- 每项必须包含 `id`、`title`、`description`、`inputSchema`（严格子集：顶层必须 `type: "object"` + `additionalProperties: false`，禁止 `$ref`/`definitions`/`$defs`）。
- 可选 `timeoutMs`（100-30000ms）和 `maxOutputBytes`（1-1048576 bytes），默认 2000ms / 32768 bytes。
- 对现有不含 `contributes.tools` 的 manifest 向后兼容（代码层默认 `[]`）。

**`PluginSandboxPort` 合同（`packages/application/src/plugin-sandbox-port.ts`）**

- `authorizePluginToolCall`：纯函数、无 I/O 的硬拒绝门，任意缺失/不信任/未验证条件均 deny，无降级路径（按计划原则9）。
- `PluginSandboxPort.callTool`：端口接口，只有通过授权后才可调用。
- 生产 adapter（`apps/desktop/src/main/plugin-sandbox-runtime.ts`）通过注入的 `PluginSandboxHostLauncher` 与原生 host 通信，不直接 import `node:child_process`（该文件专属权仍属 `agent-task-sandbox.ts`）。

**真实沙箱执行当前状态**

- 原生 host stub（`apps/desktop/native/agent-task-sandbox/host/src/main.rs`）仍输出 unavailable 并 exit 1 — fail-closed 是正确行为，等待真实 Windows AppContainer 二进制打包。
- 所有插件工具调用路径均以 `PLUGIN_SANDBOX_UNAVAILABLE` 错误告终，直到打包并签名真实 host binary 后方可通过。
- 因 C.0 尚未资格认证，E.1 当前状态为 `Blocked`，而非可发布插件工具；权威状态和证据见 `docs/releases/stage5-agent-tool-evidence.json`。
