# Novel Studio Agent Tool 功能完成优先级

- **日期：** 2026-07-26
- **状态：** Active（Pi packages 对照、取消原生工具链范围后修订）
- **实现基线：** `171ea3e`
- **参考实现：** `earendil-works/pi@5bc1c2c0a6f07e00e8c240304182f213ab8d311f`
- **目标合同：** `docs/superpowers/plans/2026-07-23-agent-tool-completion.md`
- **设计依据：** `docs/superpowers/specs/2026-07-23-agent-tool-completion-design.md`

## 1. 当前决定

本计划只安排当前最需要完成的 Agent 用户功能，不进入发布收尾。

- 智能上下文继续延期。只修复会阻断运行、越界、泄漏或损坏显式引用的问题。
- 暂不执行 Phase F、发布、签名、安装包推广或部署。
- 当前产品范围正式取消 Rust 原生文件宿主、AppContainer 任务沙箱、内置 Git runtime、插件进程和本地 stdio MCP，不安装 Rust、MSVC、Windows SDK、容器或相关本地工具。
- 基础创作写入不得依赖用户或普通开发环境现场编译原生程序。
- 模型可见工具不再与内部领域 operation 一一对应；内部仍保留 Change Set、审批、版本组、事务日志、恢复和撤销。
- 只提供应用管理的可信创作写入和受控远程能力；不以普通 Node `spawn` 或裸 Shell 替代已取消的原生安全合同。

本修订正式取消旧计划“先构建原生文件宿主才能恢复写入”的产品范围。若旧目标合同、设计文档或发布证据与本计划在 Rust、AppContainer、工程任务、Agent Git、插件或本地 MCP 上冲突，以本计划为当前实施依据。已提交的原生代码先保持停用，不回退混合提交；`trusted_creative` 替代路径验证后，再用独立清理提交移除原生源码、构建与打包链路。

## 2. Pi packages 对照结论

本次不仅检查了 `packages/coding-agent`，还检查了截图中三层核心包。

| Pi 层                        | 实现方式                                                                                                                 | Novel Studio 借鉴点                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `packages/ai`                | 统一 `Model`、`Context`、`Tool`、流事件和 Provider；各 Provider 自己转换消息、工具 schema、thinking、tool-call ID 和错误 | Provider 差异留在 LLM adapter，不进入 Agent 运行会话       |
| `packages/agent`             | 小型 Agent loop；统一参数校验、顺序/并行执行、取消、事件、`beforeToolCall`/`afterToolCall`、steer/follow-up              | 抽出通用工具调用管道，不继续扩大单个运行会话               |
| `packages/agent/src/harness` | 工具依赖 `ExecutionEnv`，同一工具可连接本机、远程或沙箱；会话树持久化消息、模型、thinking 和 active tools                | 把模型工具、领域处理器、执行环境分层；每轮只激活需要的工具 |
| `packages/coding-agent`      | 默认只启用 `read`、`bash`、`edit`、`write`；`grep/find/ls` 可选；扩展动态注册                                            | 核心工具集保持小，外部能力按运行选择                       |

Pi 中不能照搬的部分：

- `write` 直接 `fs.writeFile`，允许相对或绝对路径并覆盖文件。
- `bash` 使用当前用户权限运行 Shell。
- 文件 mutation queue 只串行化同一文件，不提供审批、事务或安全隔离。
- Project Trust 主要控制项目扩展和资源加载，不限制基础文件工具。
- Docker、Gondolin/QEMU、OpenShell 是用户自行选择的隔离层。

因此，Novel Studio 应借鉴 Pi 的分层、事件循环、工具环境抽象和 active-tools 机制，但保留自身更强的项目边界与可撤销写入。

Pi 的 deferred tools/tool reference 只在部分 Anthropic、OpenAI Responses 和 Kimi 模型可用。本项目不把它作为基础能力；先保证所有 Provider 都能使用小型 active tool set，再把 deferred loading 作为可选优化。

## 3. 当前项目基线与主要问题

| 能力                                     | 当前状态                                                                               | 本计划处理方式                     |
| ---------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------- |
| Change Set、审批、版本组、事务恢复和撤销 | 合同和测试较完整                                                                       | 保留，不降级为 Pi 式直接写入       |
| Phase A 搜索与引用                       | Desktop runtime 已启用                                                                 | 保留，合并模型工具门面             |
| Agent 运行会话                           | `agent-run-session.ts` 约 6198 行，混合模型循环、持久化、审批和全部工具分派            | 先抽出通用工具调用管道             |
| 工具目录                                 | 22 个静态工具按模式最多暴露约 15–16 个，存在领域重复                                   | 新运行使用 v2 精简门面             |
| 不完整工具调用                           | OpenAI-compatible adapter 只终结 `stop/tool_calls`，未显式建模 `length` 等终态         | 首批 fail closed，截断参数不得执行 |
| 基础 Agent 写入                          | 被原生文件操作 manifest `unavailable` 阻断                                             | 增加独立的可信创作写入后端         |
| Provider                                 | 目录声明多 Provider，实际 Agent transport 主要是 OpenAI-compatible `/chat/completions` | 校正支持矩阵，再补专用协议 adapter |
| Phase B 生命周期                         | 内部 operation 和事务已有较多实现，生产工具隐藏                                        | 通过精简门面接通                   |
| 网络与远程 MCP                           | 真实路径存在，设置闭环不完整                                                           | 在核心写入之后完成                 |
| 任务、Agent Git、插件、本地 MCP          | 依赖未资格化原生沙箱                                                                   | 当前产品范围取消并安排清理         |

## 4. 目标分层

### 4.1 Provider Runtime

只负责 Provider 认证、请求转换、流式文本、tool-call delta、usage、终止原因和错误归一化。Provider 失败通过稳定事件或统一错误返回，不把半截工具调用交给执行层。

### 4.2 Agent Loop

只负责轮次、消息、工具调用组装、限制、取消和继续条件。它不读取文件、不决定网络策略、不直接操作 Change Set。

### 4.3 Tool Runtime

每个工具由 descriptor、handler、effect、execution mode 组成，统一经过：

`provider name 映射 -> 完整性检查 -> 严格 schema 校验 -> capability 重检 -> 审批策略 -> handler -> 结果包络 -> Run Event/持久化`

纯读取批次可以并行；只要批次包含写入、任务或外部 action，就按模型源顺序串行，并在审批点暂停。写入和外部 action 不得与后续调用越过审批并行执行。

### 4.4 Domain Handlers

读取、搜索、Change Set、网络和远程 MCP 各自拥有小型 handler。现有审批 binding、幂等键、恢复和审计逻辑继续由对应领域模块负责。

### 4.5 Execution Environments

- `trusted_creative`：仅用于应用管理的 `creativeProject` 内容根，提供基础文本 mutation。
- `remote`：受控网络和远程 MCP，不依赖本地进程沙箱。

当前不提供本地进程执行环境。`trusted_creative` 不运行项目命令、不加载插件进程，也不连接本地 stdio MCP。

运行开始时冻结 capability 和工具目录；运行中只允许缩权。新增工具或 schema 变化进入下一次运行，旧审批不能扩大当前运行。

## 5. 模型可见工具 v2

### 创作核心

| v2 工具                   | 替代现有工具                                                                 | 说明                                                         |
| ------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `list_project_entries`    | 保留                                                                         | 浏览项目条目                                                 |
| `read_resource`           | `read_chapter`、`read_story_bible`、`read_project_text`                      | 使用 `chapter:`、`story_bible:`、`file:` 稳定引用            |
| `search_project`          | `search_project_text`、`find_project_references`                             | `mode=text/references`，返回有界结果和来源摘要               |
| `edit_text`               | `propose_chapter_write`、`propose_file_write`、已有 Story Bible 修改         | 修改已有文本，必须绑定 base hash 和范围                      |
| `create_resource`         | `propose_chapter_create`、`propose_story_bible_write`、`propose_file_create` | 创建章节、Story Bible 资产或普通文本                         |
| `manage_path`             | `propose_file_move`、`propose_file_delete`、`propose_directory_create`       | `move_file/delete_file/create_directory`，破坏性操作始终确认 |
| `request_user_input`      | 保留                                                                         | 请求用户决定                                                 |
| `finish` 或 `finish_plan` | 保留                                                                         | 每种模式只暴露一个终止工具                                   |

目标：创作规划模式约 5 个工具，创作执行模式约 8 个；联网研究时再增加 `web_search`、`fetch_url`。

### 高级与外部能力

- `web_search` 与 `fetch_url` 保持分离，因为输入、结果和数据外发含义不同。
- 远程 MCP 工具只注入用户为本次运行选择的来源；不把全部动态目录塞给模型。
- `run_project_task`、Agent Git 工具、插件工具和本地 stdio MCP 不进入当前产品工具目录。

旧 run 继续按冻结的 v1 descriptor 恢复和重放；只有新 run 使用 v2 名称。内部 Change Set operation 类型不随模型工具重命名。

## 6. 批次 1：修正工具调用内核

**目标：** 先解决会执行不完整调用的风险，并从运行会话中抽出可复用分派管道，不改变现有用户行为。

1. 扩展 Provider/round 终态，至少区分 `stop`、`tool_calls`、`length`、`content_filter`、`aborted`、`error` 和未知终态。
2. 只有完整 `tool_calls` 终态允许执行工具；截断、流中断、名称不完整或参数不完整统一返回错误 tool result，不能尝试补全后执行。
3. 抽出 tool-call assembler 和 dispatcher，集中处理大小限制、providerName 映射、严格 schema、capability 漂移和连续失败计数。
4. 建立类似 Pi `beforeToolCall/afterToolCall` 的内部中间件，但审批、审计和结果包络使用现有强类型端口，不开放任意扩展绕过。
5. 纯读取批次并行执行并按模型源顺序写回 tool results；含副作用的批次全部串行。
6. 为未知工具、重复 ID、截断 JSON、多调用顺序、取消、审批暂停和恢复增加定向测试。

**完成条件：** `agent-run-session.ts` 不再包含每种工具的完整横切流程；不完整工具调用在任何 Provider 路径下都不会产生副作用。

**额外下载：** 无。

## 7. 批次 2：恢复基础创作写入

**目标：** 用户不安装编译工具，也能完成“Agent 提案 -> 审阅 -> 应用 -> 撤销”。

1. 新增独立 `trusted_creative` 文件 mutation 端口，不注入现有 `NoFollowNativeFileOperationPort`，避免虚假满足 handle-based 安全合同。
2. 只允许 `creativeProject`、应用管理的内容根、规范化项目相对路径和允许的文本资产；工程工作区不属于可信创作写入范围，保持只读。
3. 每次 mutation 前重检根路径和路径段，拒绝 symlink/reparse point、设备名、ADS、越界路径和非普通目标。
4. 使用临时文件、flush/close、同目录替换、base checksum 和目标 checksum；失败仍进入现有事务补偿与恢复流程。
5. 保留 Change Set Review、自动写入政策、破坏性确认、Version Group、journal、单次撤销和 run 撤销。
6. UI 和诊断明确显示 `standard trusted creative` 或 `hardened native`，不得把前者描述为可抵御恶意本地路径竞争。
7. 增加真实 Desktop 纵向测试以及越界、普通 reparse、并发编辑、崩溃恢复测试。

**完成条件：** 当前 `propose_chapter_write`、`propose_file_write` 在可信创作项目中真实可用；原生 manifest 仍可保持 `unavailable`；项目外文件不因普通输入或已存在 reparse path 被修改。

**已知边界：** Node 路径 API 无法关闭恶意本地进程制造的 Windows junction/reparse TOCTOU 窗口。当前产品不承诺抵御已能在同一用户权限下持续篡改项目目录的本地恶意进程；通过限定应用管理的创作根、拒绝已有 reparse path、事务写入和不开放本地进程工具缩小边界。

**额外下载：** 无。

## 8. 批次 3：接入 v2 工具门面和文件生命周期

1. 实现 `read_resource`、`search_project`、`edit_text`、`create_resource`、`manage_path` descriptor 和 handler。
2. 将 v2 调用映射到现有读取、搜索、`AgentFileOperationSession`、Change Set v1.1、Version Group 和 transaction journal。
3. 完成章节、Story Bible、普通文件创建，以及移动、删除、建目录的确认、拒绝、补偿、恢复和撤销。
4. `manage_path` 的 move/delete 始终人工确认；自动写入授权不得绕过。
5. Change Set Review 展示领域资源、内部 operation、源/目标、依赖和影响范围，不因模型工具合并而丢失细节。
6. 增加 v1 旧 run 恢复、v2 新 run、工具数量预算和不同 Provider schema 兼容测试。

**完成条件：** 创作执行模式默认不超过 8 个核心工具；创建、修改、移动、删除和建目录都有真实 Desktop 闭环。

**额外下载：** 无。

## 9. 批次 4：校正多 Provider 工具调用

1. 建立真实 Agent Provider 支持矩阵；没有运行适配器的 Provider 不得仅因出现在设置目录中就宣称支持 Agent。
2. OpenAI-compatible 保持一个明确 adapter；Anthropic、Gemini 等使用各自原生消息和工具格式，未实现前在 Agent 入口显示不可用原因。
3. 统一 tool-call ID、名称限制、strict schema、thinking、usage、缓存和 abort/timeout 终态，不把 Provider 特例写入 Tool Runtime。
4. 维护经过验证的 `contextWindow`、最大输出和工具 schema/count 能力元数据；这里只用于请求安全和工具兼容，不启动智能上下文项目。
5. active tool set 是所有 Provider 的基础方案；deferred tools 只在模型明确支持且有回退时启用。
6. 每个宣称支持 Agent 的 Provider 至少有一条“流式文本 -> 工具调用 -> tool result -> 最终回答”合同测试。

**完成条件：** 设置界面显示的 Agent 支持状态与真实 adapter 一致，不再把所有 Provider 当作 `/chat/completions` 兼容端点。

**额外下载：** 无本地可执行程序；只需要相应 Provider 凭据和网络。

## 10. 批次 5：网络读取与远程 MCP

### 网络读取

1. 完成 Network Provider 新增、编辑、删除、默认选择、连接测试和 endpoint 校验。
2. API Key 进入 Main secret store；renderer 和设置 JSON 只保留 `secret://` 引用。
3. 保留 allowed-host、固定 dialer、DNS/IP/重定向/解压大小/超时限制和 run-scoped 数据外发审批。
4. 完成 `web_search`、`fetch_url` 的真实设置到工具结果纵向测试。

### 远程 MCP

1. 完成远程 MCP secret 保存、server 管理、连接测试、启停和撤销。
2. run start 冻结用户选定的少量 descriptors、providerName 映射和 revision。
3. 验证 `outcome_unknown`、schema 漂移、断线、超时和 teardown。

**额外下载：** 无本地可执行程序；需要远程服务配置、凭据和网络。

## 11. 已取消范围与原生代码清理

原“批次 6：强化原生与工程能力”从当前产品目标中取消，不再作为延期批次或发布前置条件：

- 不构建 Rust `agent-file-operations-host`、AppContainer host/probe。
- 不提供 `run_project_task`、Agent Git、插件进程或本地 stdio MCP。
- 不安装或打包 Rust、Cargo、MSVC、Windows SDK、Git runtime、Docker、QEMU 或 OpenShell。
- 不用普通 Node `spawn`、裸 Shell 或宽权限文件写入冒充上述安全边界。

现有 Rust 与原生接线已包含在混合功能提交中，禁止整体回退这些提交，也不单独裸删 `.rs` 文件。完成批次 2 的 `trusted_creative` 纵向闭环后、进入批次 3 前，执行一次聚焦清理：

1. 移除 Rust workspace、Cargo 配置、原生 host/probe/file-operations 源码及占位 manifest。
2. 移除原生构建、审计、资格脚本，删除 `package.json` 对应命令和 CI Rust/cargo-deny/build/qualify 步骤。
3. 移除 Electron 原生资源打包项，以及只服务已取消能力的 Main runtime 接线、设置项和测试。
4. 保留并重新接线创作写入所需的 Change Set、审批、版本组、事务、恢复、撤销及通用端口。
5. 用 targeted tests、typecheck、lint 和 package check 证明普通开发与打包流程不再需要原生工具链。

**完成条件：** 新 checkout 只安装项目现有 Node 依赖即可开发和验证当前 Agent 功能；仓库、CI 与打包流程不再引用 Rust/MSVC/SDK 或等待原生资格。

**清理状态（2026-07-26）：Complete。** Rust/AppContainer/file-operations host、内置 Git runtime、对应 Desktop adapter、构建/资格脚本、CI 安装步骤和 Electron 资源打包项均已移除。创作项目继续使用 `standard_trusted_creative`，远程网络/MCP 与通用事务/策略端口保留。

## 12. 明确延期：智能上下文

以下内容继续延期：

- 竞品上下文选择、压缩和恢复机制调研。
- 按模型动态分配上下文预算和安全余量。
- Story Bible、人物、世界观、记忆、时间线和编辑器选择器。
- 自动检索、排序、向量检索和来源选择 trace。
- 模型辅助摘要、跨模型压缩和降级策略。

延期期间只处理运行阻断、上下文越界/泄漏、预算为负、旧内容错误复活和显式引用损坏。

## 13. 下载与安装政策

| 能力                                      | 普通用户            | 当前开发阶段   |
| ----------------------------------------- | ------------------- | -------------- |
| 核心读取、搜索、写入、审批、撤销          | 只安装 Novel Studio | 无新增下载     |
| OpenAI-compatible/Anthropic/Gemini 等模型 | API Key 或本地服务  | 无新增本地工具 |
| 网络读取、远程 MCP                        | 服务配置和凭据      | 无新增本地工具 |
| 工程任务、Agent Git、插件、本地 MCP       | 当前不提供          | 当前不实现     |

下载的 Rust 源码压缩包不放入项目，也不作为开发步骤；本计划不要求安装 Rust、MSVC、Windows SDK、Git runtime、Docker、QEMU 或 OpenShell。

## 14. 执行与验证原则

1. 每个批次先完成一个真实用户纵向闭环，再进入下一批次。
2. 开发中运行最窄相关测试；批次结束运行对应测试、typecheck 和 lint。
3. 工具门面精简不能删除内部审计、审批 binding、幂等、恢复或撤销语义。
4. Provider 兼容必须由真实 payload/stream 合同证明，不能只靠目录配置或 Mock。
5. `trusted_creative` 必须明确其可信本地边界，不宣称具备 handle-based/AppContainer 抵御能力。
6. 网络和远程 MCP 继续使用真实边界测试；当前运行不得注册已取消的本地进程工具。
7. Phase F 和发布继续延期。

## 15. 下一步

批次 1、批次 2 与第 11 节原生链路清理均已完成。下一步执行批次 3：收敛模型可见工具门面；不进入智能上下文、发布或本地进程能力。
