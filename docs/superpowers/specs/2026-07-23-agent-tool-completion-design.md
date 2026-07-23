# Novel Studio Agent 工具补全设计

**日期：** 2026-07-23  
**状态：** Candidate，核心合同与 Phase C 安全验证口径已补全，待分期实施<br>
**实现基线：** `5a9a72b`<br>
**实施计划：** `docs/superpowers/plans/2026-07-23-agent-tool-completion.md`  
**范围：** Agent Tool Registry、权限摘要、搜索、文件生命周期、受控任务、Git 只读、网络读取、插件/MCP 工具接入、审计与恢复

## 1. 目标

当前 Agent 已有 9 个静态工具 ID：6 个文件工具和 3 个协议动作。它满足既定 v1 写作闭环，但与完整工程 Agent 相比，仍缺项目搜索、文件生命周期、受控任务、Git、网络和外部工具六类能力。

本设计把这六类缺口补成可实施、可审计、可逐步发布的目标工具面，同时保持以下不变量：

- Agent 只能看到服务器按当前运行、工作区和权限生成的工具清单。
- 项目内容、模型输出、renderer 或插件不能扩大权限。
- 所有项目内变更先形成可审阅提案，再经过现有审批、事务、版本点和撤销链路。
- Shell、Git 写操作、网络和第三方工具不得因为“自动修改”而获得隐式授权。
- 每个阶段独立可发布、可回滚；后续阶段不能成为前一阶段的隐藏依赖。
- 内部工具 ID、模型 provider 可接受的工具名和用户可读名称是三个不同字段；任何名称映射都必须冻结、可审计且不能碰撞。
- “读取”不等于“无副作用”：向 provider、网站或远程工具发送查询属于数据外发，必须单独授权；外部写操作必须有独立副作用和重试语义。

## 2. 当前基线

### 2.1 已有静态工具

| 类别     | 工具                                          |
| -------- | --------------------------------------------- |
| 项目读取 | `list_project_entries`、`read_project_text`   |
| 写作读取 | `read_chapter`、`read_story_bible`            |
| 修改提案 | `propose_file_write`、`propose_chapter_write` |
| 协议动作 | `finish`、`finish_plan`、`request_user_input` |

当前模式矩阵为 planning + writing/general_file `6/4`、execution + writing/general_file `7/5`，最大单次暴露 7 个。读工具已有桌面执行器；修改工具已有 Change Set、审批、事务写入、版本组和 run 级撤销。

### 2.2 已存在但未开放给 Agent 的能力

- 创作项目已有搜索索引和 `ProjectSearchSession`，但 Agent 不能调用。
- Application 已有章节重命名、删除和工程文本保存，但没有 Agent 文件操作契约。
- 插件运行时已有信任、签名、隔离计划、超时和输出上限 DTO，但当前所谓 worker 仍是 deterministic fixture/prototype，不执行任意第三方源码，也不能为 Phase C 生成 OS sandbox 证明。
- 工程工作区已有受限文件树和文本读写，但没有任务执行或 Git 端口。
- Electron renderer 已启用 Chromium sandbox，Agent 文件 Repository 也有 canonical root/path guard；两者分别只约束 renderer 和宿主代理的文件调用，不能约束将来启动的项目子进程。

这些能力只能复用其安全边界和数据结构，不能直接把 UI 方法包装成模型工具。

### 2.3 对标成熟工程 Agent 时采用的共性原则

本设计不复制某个产品的私有实现，也不以竞品名称替代安全证明；只吸收 Codex、Claude Code、Cline、Cursor 等成熟工程 Agent 已验证过的共性产品模式：

- 工具按运行模式、工作区、来源和用户授权动态过滤，而不是把完整工具箱永久暴露给模型。
- 高风险操作在执行前展示具体目标、参数摘要和影响范围；“本次允许”是有边界、有过期时间的授权，不是永久提权。
- 文件改动以 diff/Change Set 审阅并保留恢复点；外部副作用不能伪装成文件 diff，也不能承诺本地 undo。
- 命令执行使用受控任务/策略，而不是把任意 shell 字符串交给模型；执行输出有超时、取消、截断和进程树终止。
- MCP/插件按来源独立配置、独立信任、独立权限和独立审计；项目文本和第三方输出始终是不可信数据。
- 会话恢复保留历史事实，但不会把历史批准重新解释为当前仍有效的能力。

这些原则只说明产品形态应达到的成熟度；本设计的安全结论仍必须由本项目自己的契约测试、黑盒探针和打包产物证据给出。

## 3. 完成口径与目标工具集

补齐六类能力不等于把每个竞品工具名原样复制。目标采用最小、领域化的静态工具面：新增 13 个静态工具，最终为 **22 个静态工具 ID**；插件/MCP 工具是运行时命名空间描述符，不计入静态数量。

### 3.1 P1：本地、可回滚能力

| 工具                        | 效果    | 可用上下文             | 说明                                                      |
| --------------------------- | ------- | ---------------------- | --------------------------------------------------------- |
| `search_project_text`       | read    | writing/general_file   | 有界全文搜索；支持 include/exclude glob、结果数和字节上限 |
| `find_project_references`   | read    | writing/general_file   | 查找章节、Story Bible 资产或文本路径的引用                |
| `propose_chapter_create`    | propose | writing execution      | 生成新章节候选，不直接创建文件                            |
| `propose_story_bible_write` | propose | writing execution      | 结构化新增或修改 Story Bible 资产                         |
| `propose_file_create`       | propose | general_file execution | 创建 UTF-8 文本文件候选                                   |
| `propose_file_move`         | propose | general_file execution | 移动文件；同目录移动即重命名                              |
| `propose_file_delete`       | propose | general_file execution | 删除候选；始终需要人工确认                                |
| `propose_directory_create`  | propose | general_file execution | 创建项目内目录候选                                        |

`search_project_text` 加现有 `propose_file_write` 已覆盖“搜索后替换”；不增加一个可绕过 Change Set 的批量替换工具。`propose_file_move` 同时覆盖移动和重命名，避免两个具有相同事务语义的工具。

### 3.2 P2：工程工作区受控执行

| 工具               | 效果    | 可用上下文                           | 说明                                          |
| ------------------ | ------- | ------------------------------------ | --------------------------------------------- |
| `run_project_task` | execute | engineering + general_file execution | 运行服务器解析的任务 ID，不接收原始命令字符串 |
| `git_status`       | read    | engineering + general_file           | 返回有界、结构化仓库状态                      |
| `git_diff`         | read    | engineering + general_file           | 返回限定路径、限定大小的文本 diff             |

首个版本不提供任意 Shell，也不提供 `git commit/reset/checkout/push`。`run_project_task` 只允许运行来自服务器认可来源的任务。项目 `package.json` script 只能作为待授权候选，用户确认后才进入 app-local 任务目录；参数必须逐项校验，模型不能提交或拼接 shell 字符串。

Phase C 首版只在受支持的 Windows x64 环境交付，任务网络模式固定为 `none`。任务必须由受信的原生 sandbox host 使用 AppContainer/LowBox 文件与网络边界以及 Windows Job Object 进程树 containment 启动；Node `spawn`、cwd、环境清理、Electron renderer sandbox 或旧插件 fixture 均不能单独构成任务隔离。其他平台在有等价、经独立验证的 OS adapter 前不注册任务工具。

工具注册要求的是不可由 adapter 自报的 `verified` sandbox attestation，而不是布尔 `ready`。证明必须绑定宿主二进制摘要、平台、策略 revision、测试向量 revision 和有效期，并同时通过打包产物资格测试与当前机器的独立黑盒探针；任一维度为 missing、unknown、stale 或 drift 都必须 fail closed，且不得退化为普通 `spawn`。

### 3.3 P3：外部读取与可扩展工具

| 工具/机制                    | 效果          | 默认状态 | 说明                                                  |
| ---------------------------- | ------------- | -------- | ----------------------------------------------------- |
| `web_search`                 | external_read | disabled | 通过配置的搜索 provider 返回标题、URL、摘要和抓取时间 |
| `fetch_url`                  | external_read | disabled | 只允许 HTTP(S)，执行 DNS/IP/重定向/内容类型/大小防护  |
| `plugin:<pluginId>/<toolId>` | dynamic       | disabled | 仅签名、可信且有 verified sandbox attestation 的工具  |
| `mcp:<serverId>/<toolId>`    | dynamic       | disabled | 固定 server 配置、固定 schema、固定权限快照           |

表中的 `plugin:...`/`mcp:...` 是只在应用内部使用的 canonical tool ID，不直接发送给模型 provider。运行开始时，Main 为每个工具生成只含 ASCII 字母、数字、下划线和连字符且不超过 provider 限制的稳定 `providerName`；静态工具默认沿用原名。canonical ID、providerName、来源和 descriptor digest 的双向映射随 run 冻结，provider 返回未知名、碰撞名或旧映射时直接拒绝。

动态工具不得通过通用 `call_tool(name, args)` 网关绕过 Tool Registry。每个动态工具必须作为独立描述符进入注册表、权限摘要、registry revision 和审计事件。来源提供的 description、schema、read-only/destructive/idempotent 注解都按不可信元数据处理；最终 effect、数据外发和审批策略只能由 Main 的来源策略与实际授予权限收窄计算，不能由插件/MCP 自报扩大。

## 4. 补全后的工具矩阵

### 4.1 P1 完成后的默认矩阵

| 组合            | 读取 | 提案 | 协议动作 | 总数 |
| --------------- | ---: | ---: | -------: | ---: |
| 规划 + 写作     |    6 |    0 |        2 |    8 |
| 规划 + 通用文件 |    4 |    0 |        2 |    6 |
| 执行 + 写作     |    6 |    3 |        2 |   11 |
| 执行 + 通用文件 |    4 |    5 |        2 |   11 |

### 4.2 条件工具

- `git_status`、`git_diff` 只在已验证为 Git 工作树、完整 Git 存储边界位于允许范围且只读 Git sandbox attestation 有效的 engineering workspace 中加入。
- `run_project_task` 只在 execution + general_file、本次 run 有任务执行许可且 sandbox attestation 与冻结策略完全匹配时加入。
- `web_search`、`fetch_url` 只在用户开启网络能力、provider 可用且本次 run 权限摘要包含对应域时加入。
- 插件/MCP 工具只在运行开始前冻结；运行中安装、启用或更改 schema 不得扩大当前工具集。
- 每轮最多暴露 24 个描述符；动态工具最多 8 个。超过上限时要求用户选择需要的工具源，而不是静默截断。
- 工具数量还要受当前模型 provider 的名称、schema、单请求字节和 tool-count 限制；无法生成无碰撞 provider 映射时阻断 run start。

## 5. Tool Registry 合同

### 5.1 类型扩展

`AgentToolDescriptor` 的分类字段扩展为：

```ts
type AgentToolKind =
  | "file_tool"
  | "search_tool"
  | "command_tool"
  | "vcs_tool"
  | "network_tool"
  | "external_tool"
  | "protocol_action";
```

扩展后的完整合同为：

```ts
type AgentToolEffect =
  "read" | "propose" | "execute" | "external_read" | "external_action" | "control";

type AgentToolDataEgress = "none" | "provider_query" | "remote_tool_arguments";
type AgentToolRetrySemantics = "safe" | "idempotency_key_required" | "never_automatic";

interface AgentToolDescriptor {
  readonly id: CoreAgentToolName | NamespacedExternalToolId;
  readonly providerName: string;
  readonly displayName: string;
  readonly description: string;
  readonly kind: AgentToolKind;
  readonly effect: AgentToolEffect;
  readonly dataEgress: AgentToolDataEgress;
  readonly destructive: boolean;
  readonly retrySemantics: AgentToolRetrySemantics;
  readonly source: { readonly kind: "core" | "plugin" | "mcp"; readonly id: string };
  readonly inputSchema: JsonObject;
  readonly descriptorDigest: string;
}
```

`external_read` 只表示宿主预期不会改变远端状态，不代表没有数据外发；`external_action` 表示可能改变外部状态或远端没有可验证的只读保证。远程工具失败、断线或超时后，如果不能证明请求未送达，终态必须为 `outcome_unknown`，不得自动重试。

`ListAgentToolsInput` 增加 Main 生成的 `workspaceKind`、provider capability snapshot 和 tool capability snapshot。Renderer、模型消息、项目文件和普通 IPC JSON 不能直接提交 capability 数组或 providerName 映射。

静态 registry revision 从未过滤的 canonical static catalog 计算，不能通过调用“缺少 capability snapshot 时隐藏新工具”的 `listAgentTools` 间接枚举。动态 revision 单独覆盖冻结后的完整描述符与 providerName 映射；即使某个静态工具被 feature flag 隐藏，其 schema/description 变化仍必须改变静态 revision。

### 5.2 Schema 与描述安全

- 静态和动态工具统一使用经过测试的严格 JSON Schema validator；未知关键字不能静默忽略。
- 动态 schema 只接受明确定义的本地子集，限制总字节、深度、属性数、枚举数和组合分支；拒绝远程 `$ref`、递归引用、未知 format 和未经安全检查的正则。
- description、title 和 schema 内说明文字限制长度、去除控制字符并标记来源；它们是供模型参考的不可信目录元数据，不能成为系统指令。
- provider adapter 在 run start 预编译并验证 schema；无法无损映射到当前 provider 支持子集时不注册该工具，不做弱化后继续。

### 5.3 参数与上下文预算

- 单次参数文本继续保持 1 MiB 硬上限；普通搜索和控制参数应远低于该值。
- 搜索默认最多 50 条、每条最多 2 KiB 摘要、总结果最多 256 KiB。
- Git diff 默认最多 256 KiB，超限返回截断标记和摘要，不返回完整内容。
- 任务输出按 stdout/stderr 分流，单流上限 1 MiB，超时、取消和截断均形成事件。
- 网络响应正文默认最多 1 MiB，只接受允许的文本内容类型。
- 动态工具 schema、描述和名称总预算必须受限，防止工具目录挤占上下文。
- 参数字节上限在流式组装阶段、JSON parse 之前执行；超限立即终止该 tool call。
- 除单次上限外，run 和 model round 还必须有累计工具结果字节/token 预算。原始有界结果可持久化为 `toolResultRef`，回填模型的始终是适配剩余上下文预算的摘要、来源、digest 和截断信息。

### 5.4 运行期冻结

Run start 把以下内容绑定到 Permission Summary：

- 静态 registry revision；
- 工作区类型和能力快照；
- 允许的任务 ID、网络域和外部工具描述符摘要；
- canonical root fingerprint；
- sandbox host digest、attestation ID、policy/test-vector revision 和有效期；
- Git worktree/gitdir/common-dir/object-store 边界 fingerprint；
- read/propose/execute/external/forbidden capability 列表；
- provider capability snapshot、canonical ID/providerName 映射和 descriptor digest；
- 数据外发授权、外部副作用授权及其目标/参数策略。

任一内容在开始前发生漂移则阻断启动；运行开始后只允许缩权或终止，不允许扩权。旧摘要或缺少 attestation 的摘要不得被归一化成任务/Git 已授权。

Permission Summary 是“run 开始时用户批准了什么”的不可变历史记录，持久化后不因 attestation 过期而改写。运行期另维护 `EffectiveCapabilityState`，记录当前仍有效的能力、撤销原因、revision 和检查时间；模型请求、直接调用和 UI 当前状态均以二者交集为准。App 重启后历史摘要仍可读，但未重新取得的 session attestation、网络许可和外部连接一律视为已撤销。

## 6. 权限与审批

### 6.1 Permission Summary v1.1

新增字段：

- `operationMode`
- `workspaceKind`
- `executionCapabilities`
- `externalReadCapabilities`
- `externalActionCapabilities`
- `dataEgressCapabilities`
- `taskAllowlistRevision`
- `externalToolRegistryRevision`
- `networkPolicyRevision`
- `providerToolMappingRevision`
- `featureFlagRevision`

保留 v1.0 读取兼容；新 run 只写 v1.1。当前固定的 forbidden capability 列表改为服务器根据已交付阶段、工作区和本次授权计算，但调用方仍不能提供或删改该列表。

### 6.2 确认规则

| 能力                      | planning                 | execution + 每次确认     | execution + 本次自动修改                      |
| ------------------------- | ------------------------ | ------------------------ | --------------------------------------------- |
| 搜索、引用、Git 只读      | 允许                     | 允许                     | 允许                                          |
| 修改现有文件              | 禁止                     | Change Set 确认          | 可按现有策略自动审批                          |
| 创建文件/章节/Story Bible | 禁止                     | Change Set 确认          | 可按现有策略自动审批                          |
| 移动、删除、创建目录      | 禁止                     | **始终人工确认**         | **仍然人工确认**                              |
| 运行任务                  | 禁止                     | 每次调用确认             | 仅精确 run-scoped task grant 可免重复确认     |
| 网络读取/搜索             | 需网络和数据外发许可     | 需网络和数据外发许可     | 不继承文件自动审批                            |
| 插件/MCP 只读             | 按来源与数据外发策略确认 | 按来源与数据外发策略确认 | 不继承文件自动审批                            |
| 插件/MCP 外部动作         | 禁止或每次确认           | **每次确认**             | 仅精确 run-scoped external grant 可免重复确认 |

用户回答问题、项目文本或插件输出都不能改变上表。

### 6.3 工具审批合同

工具审批使用可辨识联合，而不是把任务字段硬编码进通用事件：

```ts
type ToolApprovalBinding =
  | {
      kind: "task";
      taskId: string;
      sourceDigest: string;
      argvPolicyDigest: string;
      fileProfileDigest: string;
    }
  | { kind: "network"; destination: string; requestDigest: string; egressClass: string }
  | {
      kind: "external";
      sourceId: string;
      descriptorDigest: string;
      argumentDigest: string;
      idempotencyKey?: string;
    };
```

所有 binding 还必须覆盖 run/revision、toolCallId、providerName mapping revision、过期时间和当前 Effective Capability revision。task grant 不能只绑定 task ID：免重复确认的范围必须是同一 source digest、文件 profile 和明确参数策略；超出参数策略时重新确认。外部动作只有在来源支持并验证 idempotency key 时才允许受控重试，否则失败/超时后进入 `outcome_unknown`。

同一模型轮次最多进入一个待审批副作用调用。若模型同时返回多个需要审批的调用，系统按 descriptor 顺序保留第一个并把其余调用持久化为未执行/需重新规划，不能在内存中静默丢失，也不能在恢复后自动执行。

### 6.4 用户控制面

所有会扩大工具面的配置都由 Main 持有、默认关闭，并通过专用管理流程产生 revision：

- feature flag/kill switch：每个 Phase 独立、默认 false，来源和 revision 可审计；renderer 只能读取有效状态。
- Task Catalog：用户查看候选来源、准确的规范化 launcher/argv、cwd、文件 profile、风险和 source digest 后授权、撤销或刷新。
- Network：用户配置 provider、允许域、数据外发策略和 secret ref；允许域使用规范化精确 host/port，通配规则必须显式。
- Plugin/MCP：用户安装或配置来源、查看身份和权限、测试连接、启停、撤销信任并选择本次 run 暴露的工具。
- 超过每轮/来源上限时 Composer 必须提供明确的工具源选择器；不得只返回内部预算错误。

secret 只以 `secret://` 引用穿过 Application/Repository DTO，密文复用 Electron `safeStorage` 边界；renderer、事件和模型消息永不获得明文。

## 7. 文件生命周期与事务模型

现有 Change Set v1.0 只表达“现有文件内容替换”。P1 必须引入向后兼容的 Change Set v1.1：

```ts
type ChangeSetOperation =
  | { operationId: string; kind: "modify"; path: string; dependsOn: readonly string[] }
  | { operationId: string; kind: "create_file"; path: string; dependsOn: readonly string[] }
  | {
      operationId: string;
      kind: "move_file";
      from: string;
      to: string;
      dependsOn: readonly string[];
    }
  | { operationId: string; kind: "delete_file"; path: string; dependsOn: readonly string[] }
  | { operationId: string; kind: "create_directory"; path: string; dependsOn: readonly string[] };
```

事务要求：

- 所有源/目标路径都经过同一个 canonical Path Guard，并拒绝 symlink/reparse point。
- create 要求目标不存在；modify/delete/move 要求 base checksum 与审批时一致。
- move 同时校验源未变化、目标不存在、大小和扩展名允许。
- delete 在应用前写入受保护 history baseline；撤销必须可恢复内容和原路径。
- 只撤销本次 run 创建的空目录；不得递归删除目录。
- 任一操作失败时按 journal 逆序补偿，不留下半完成状态。
- dirty editor buffer、stale base、项目锁丢失或恢复 journal 未清理时阻断应用。
- 在审批前对全部 operation 构建依赖图并执行整体 preflight；拒绝环、交换移动、同一路径冲突、未选择的依赖和隐式父目录创建。部分选择必须自动包含依赖闭包，否则不可应用。
- 每个 operation 绑定原始 toolCallId/idempotency key；重放同一调用只能返回已有提案或终态，不能分配第二个章节 ID 或重复创建。
- 首版 create/modify/move/delete 只处理策略允许的 UTF-8 文本文件；二进制文件即使只移动或删除也保持不可用，避免“不能编辑但可以破坏”的权限歧义。
- move/delete/create 的最终 mutation 必须使用平台可证明的 no-follow、句柄级文件操作或等价原语。仅在 `lstat/realpath` 后按字符串路径执行 rename/remove 存在路径替换竞态，不能满足 destructive operation 的安全门；适配器不可用时这些工具保持隐藏。

## 8. 搜索与引用

`search_project_text` 必须由新的 Agent 搜索端口执行，而不是复用 renderer 搜索 API：

- creative project 可复用现有索引数据，但需要补普通项目文本和稳定 source ref。
- engineering workspace 使用受限遍历/索引，默认忽略 `.git`、`node_modules`、构建输出、缓存、二进制和超大文件。
- 查询、glob、路径、结果数和字节预算在 Application 层校验。
- 每条结果返回相对路径、稳定 ref、UTF-16/行范围的明确单位、摘要、source checksum、result digest 和 `truncated`。
- 结果作为 `untrusted_project_data` 回填模型；命中内容不能成为系统指令。
- 搜索工具只回填有界 snippet/元数据；需要完整正文时由模型再调用既有读取工具。所有实际回填的 snippet 都计入本轮工具结果预算和 Context Snapshot，不能声称模型“未读取”已经进入 tool message 的内容。
- 搜索索引是可重建缓存；新增普通工程文本后升级 cache schema/version，旧索引必须确定地重建，不能原地按新结构解释。

`find_project_references` 使用稳定 asset ID 或项目相对路径，不接受任意正则作为第一版接口。

## 9. 受控任务与 Git

### 9.1 `run_project_task`

- 输入只包含 `taskId` 和结构化参数，不包含 `command`、`cwd`、环境变量字符串或 shell 运算符。
- Main/Application 从冻结的 app-local 任务目录解析 launcher、参数、cwd、文件访问 profile、最小环境和 task source digest；项目内 script 只是任务实现，不是模型可编辑的权限来源。script、launcher、参数 schema、入口源码、lockfile、解析后的 package-manager shim/runtime 或 projection manifest 任一漂移后必须重新授权。
- 每次待执行调用先生成不可变 `TaskExecutionSnapshot`，至少绑定规范化 executable/argv、参数策略与实际参数 digest、入口和相关任务源码 manifest、runtime digest、projection manifest、cwd、文件 profile、workspace identity 和 catalog revision。审批 UI 向用户显示准确的脱敏命令与来源；模型只看到 task ID、结构化参数和风险摘要。
- cwd 位于 workspace root 不构成文件隔离。执行必须通过 `AgentTaskSandboxPort`，由 OS boundary 约束子进程只能访问声明的 workspace/state/runtime 路径；sandbox 未 verified 时工具完全不可用。
- Phase C 首版任务网络模式固定为 `none`。声明网络需求的 task candidate 不得进入目录；域级网络能力只能在后续 RFC 证明“直接 socket 被禁止且流量强制经过宿主 broker”后开放，不能用 URL 字符串校验替代 egress isolation。
- 环境默认不继承 secret，只注入显式安全变量；任务实现可能间接调用 shell，因此审批 UI 必须展示其来源和风险，不能把“模型未传 shell 字符串”表述成“任务没有 shell 风险”。
- 每次执行有启动事件、审批事件、输出摘要、退出码、超时/取消和终态。
- 禁止后台常驻、交互式 TTY、提权和沙箱逃逸；子进程必须 suspended 创建、在首次执行用户代码前加入禁止 breakaway 且 `KILL_ON_JOB_CLOSE` 的 Job Object，取消、超时、宿主断联和崩溃都必须统一终止整棵树。
- 首版任务定位为验证、分析和可丢弃构建：只能写 per-run scratch/output，projection 变更和生成物不会自动导入项目。需要导入生成文件时必须通过后续独立的 artifact-to-Change-Set 设计，不能从任务目录直接复制覆盖。
- 除进程树 containment 外，Job/profile 还必须限制活动进程数、CPU 时间/速率、提交内存、句柄、I/O、stdout/stderr、scratch 磁盘和墙钟时间；任一资源超限形成稳定终态并执行完整 teardown。

#### 9.1.1 Windows 强制边界

- 受信的原生 sandbox host 是唯一可以启动项目任务的组件。Desktop TypeScript adapter 只可摘要校验并启动该 host；项目任务本身由 host 使用 Windows API 创建，绝不由 JavaScript fallback launcher 创建。App 以 elevated token 运行、host 继承了非 IPC handle 或任务请求提权时直接 unavailable。
- 每次执行使用独立 AppContainer/LowBox identity 或等价隔离身份。首版优先把经过 no-follow 校验的普通文件从已打开 handle 复制到 disposable workspace projection，不用 hardlink，也不直接给 live workspace 递归授权；projection builder 必须校验 volume/file identity、link count、逐文件 digest 和整棵 manifest，竞争或漂移即失败。任务只写 per-run state/output，结果不会自动回写项目。确需 direct-read 的只读 runtime/dependency 路径必须逐项授权并拒绝 hardlink/reparse point。临时 ACL/grant 必须在 teardown 中撤销并验证。
- AppContainer 不授予 internet/private-network capability，并拒绝存在 loopback exemption 的 profile。父进程的 proxy、credential、`HOME`、`USERPROFILE`、`APPDATA` 和 secret 环境变量不继承。
- 如果平台 API、原生 host、ACL、网络隔离、Job Object、teardown 或 grant 回收任一项无法证明，attestation 状态只能是 `unavailable`，不能以“部分保护”注册工具。

#### 9.1.2 可证伪的 sandbox attestation

`SandboxAttestation` 由 Main 的 qualification service 生成，不能由 renderer、模型、项目文件、任务目录或 sandbox adapter 调用方直接构造。它至少绑定：

- sandbox host SHA-256、签名/打包身份和协议版本；
- OS/架构、policy revision、独立 probe/test-vector revision；
- workspace 文件 profile、网络模式、环境 profile 和 Job Object profile；
- package qualification evidence、当前机器 session probe evidence、生成时间和失效时间；
- 每个维度的 `verified | unavailable` 结果；不接受 `assumed`、`partial` 或未知枚举。

威胁模型必须在 ADR 中明确区分“恶意项目/模型/插件代码”和“可修改已安装应用的本地管理员”。如果生产安全声明包含安装包篡改，则 host digest 必须锚定到 Authenticode/发布签名或另一个不与可执行文件同权限修改的可信 manifest；把期望 hash 与 host 一起放在可同时改写的未签名目录不能证明身份。开发/CI 的 unsigned build 只能生成 development qualification，不得被生产通道接受。

Attestation 不跨 App restart 持久化；每个 session 重新验证 host 摘要、OS profile、提权状态、loopback exemption 和策略 revision，并在每次任务启动前检查有效期与 drift。package evidence 只能证明该构建通过发布资格，不能替代当前机器 probe。

Tool Registry/Permission Session 只接收 Main 已解析的 capability 和 attestation ID/digest；执行时必须回查当前进程内 qualification store。任何从 IPC、持久化记录或普通 JSON 反序列化得到的“attestation”都只是历史证据，不能授权启动。

资格验证必须使用不导入生产 path guard/readiness 逻辑的独立恶意 probe，并只操作 harness 创建、带随机 nonce 的临时 canary/监听器/进程，以外部可观察事实判定：

- 文件 probe 在允许范围内成功，同时尝试父目录、用户目录、AppData、绝对/UNC/`\\?\`/8.3 路径、symlink/junction/reparse point、hardlink 和验证后路径替换；外部 sentinel 必须不可读且 checksum 不变。
- 网络 probe 尝试 IPv4/IPv6 loopback、DNS、局域网监听器、直接 IP 和继承 proxy；测试监听器观测到的连接数必须为零。
- 进程 probe 创建子进程、孙进程、shell wrapper、detached child 和 spawn storm；正常结束、取消、超时、host 断联和 host 崩溃后，独立观察者必须确认所有 PID 消失且 heartbeat/外部 marker 不再变化。
- 环境 probe 枚举环境和已知 secret canary；只允许显式 allowlist，输出和文件中不得出现 canary。

CI/package qualification harness 必须先运行普通 `spawn` 负对照并观测到外部读取、网络连接或残留进程，再清理负对照进程和 canary，从而证明测试能识别未隔离执行。当前机器 session probe 只运行生产 sandbox 路径，并绑定已经由 package qualification 证明敏感度的 test-vector revision。只断言 adapter 返回 `ready`、只 mock `AgentTaskSandboxPort` 或只检查代码分支都不能生成 qualification evidence。

#### 9.1.3 Fail-closed 与无 fallback

- host 缺失/被篡改、签名或摘要不符、握手畸形、probe 超时、任一维度 unavailable、attestation 过期、policy/task catalog/workspace fingerprint 漂移时，`run_project_task` 必须同时从 registry、Effective Capability State 和模型请求消失；历史 Permission Summary 标记为已撤销但不改写。
- 即使通过伪造 IPC、恢复旧审批或重放持久化 tool call 直接调用，Application 也必须在创建任何进程前返回 `AGENT_TASK_SANDBOX_UNAVAILABLE`。
- Application、Agent Runtime 和任务 session 不得导入 `node:child_process`；唯一例外是经过边界测试的 Desktop host adapter，而且它只能启动摘要匹配的 sandbox host。源码依赖测试和打包后 main bundle 检查必须共同执行。
- 审批绑定 attestation ID、host digest、policy/task source/catalog revision 和文件访问 profile；任一变化立即失效，不能沿用旧 allowlist。
- 故障注入必须覆盖 host 缺失/篡改、部分 readiness、未知字段、握手中断、启动竞争、teardown 失败、App 重启和运行中 revision drift，并断言不产生任务 PID。

### 9.2 Git 只读工具

- 只允许 status/diff；不执行配置、hook、credential helper 或网络动作。Git discovery 和 Git 命令都必须运行在 Phase C 同一原生 host 的只读、无网络 profile 中，不能在路径检查后裸 `spawn` Git。
- 在首次调用 Git 前使用 no-follow/reparse-safe 解析验证 canonical worktree root、`.git` file/directory、gitdir、common-dir、object database 和 alternates 全部位于允许的 workspace/state 边界。首版拒绝任何外置 gitdir/common-dir/object store、外部 `core.worktree`、config `include/includeIf`、symlink/junction/reparse point 和边界不确定的 linked worktree。
- 使用摘要匹配的固定 Git executable 和参数数组，不通过 shell；清空继承的 `GIT_*`、`HOME`、`XDG_CONFIG_HOME` 和 proxy 环境，禁用 system/global config、可交互输入、pager、credential helper、hooks、fsmonitor、external diff 和 textconv，并启用 literal pathspec、`GIT_TERMINAL_PROMPT=0`、`GIT_OPTIONAL_LOCKS=0`。
- 首版使用随应用打包、版本和许可清晰、纳入 build manifest/SBOM 的固定 Git runtime；不从项目 PATH、用户 PATH、Git 配置或任意系统安装位置发现 executable。Git runtime 及其加载的 DLL/资源摘要随 sandbox policy 和 attestation 绑定，升级后使旧审批失效。
- Git sandbox 只授予 worktree 和已验证内部 Git 存储的读取权限以及独立临时输出目录；即使边界检查有 bug 或发生 TOCTOU 替换，OS policy 也必须阻止读取边界外配置、对象、脚本和用户文件。
- 禁止读取 `.git` 内部文件作为普通文件工具结果。
- diff 路径仍经过 Path Guard，输出受大小和敏感信息脱敏限制。
- 恶意仓库矩阵必须覆盖外置/相对 gitdir、commondir、object alternates、`core.worktree`、`config.worktree`、submodule gitdir、config include、fsmonitor、external diff、textconv、pager、credential helper、父进程环境注入、hardlink/reparse point、UNC/device/8.3 路径、pathspec magic 和验证后替换。通过条件是工具拒绝或安全完成、外部 sentinel/marker 不变、测试监听器连接数为零、输出不含 canary，且 worktree/Git 存储内容 checksum 不变。

Git mutation 是独立后续 RFC，不属于本补全计划。

## 10. 网络与外部工具

### 10.1 网络读取

- 默认关闭；用户在 Settings 配置 provider，并在 run 权限摘要中明确开启。
- `fetch_url` 拒绝 localhost、私网、link-local、file/data 协议和 DNS rebinding。
- `fetch_url` 首版只允许 GET/HEAD，不携带 cookie、浏览器登录态、Authorization 或请求正文；URL userinfo 永远拒绝。
- DNS 解析与实际连接必须使用同一受控 dialer：校验全部候选地址后把 socket 固定到已批准 IP，同时保留正确 TLS SNI/Host；不能“先校验 DNS，再交给会重新解析的普通 fetch”。每次重定向重新执行完整流程。
- 限制重定向次数、连接/总超时、内容类型、并发和解压后的流式字节数；达到上限立即中止读取，不能先完整缓冲再截断。
- 返回 URL、抓取时间、内容摘要和来源元数据；远程文本始终是不可信数据。
- API key 只留在 Main/provider adapter，永不进入事件、模型消息或 renderer DTO。
- 搜索 query、URL/path/query 和远程 MCP 参数都可能承载项目数据。默认 network grant 只允许用户输入/公共关键词；任何可能包含项目正文的 payload 需要逐次确认或显式 run-scoped egress grant，并在审批卡显示目标、payload 类别、长度和脱敏摘要。

### 10.2 插件/MCP

- 插件工具只接入已签名/明确受信、由真实 `PluginSandboxPort` 通过 Phase C 原生 host 执行并持有对应 verified attestation 的来源。现有 deterministic fixture/prototype 不能生成该证明，也不能启用第三方代码执行；只增加 manifest contribution 而没有生产执行器不算交付插件工具。
- 本地 stdio MCP 必须使用与任务执行同等级但策略独立的进程 sandbox attestation；远程 MCP 不要求本地进程 attestation，但必须通过 Phase D 网络策略、TLS/endpoint 身份、secret ref 和连接 revision 门禁。三类来源不能共享一个含义模糊的 `sandboxReady` 布尔值。
- 工具 schema 在 run start 冻结；重复名称、非法命名空间或 schema 超预算时拒绝整个来源。
- 每次调用记录 source id、tool id、版本、耗时、结果大小和脱敏错误。
- 插件/MCP 不得获得 Agent 自身没有的文件、Shell、网络或模型权限。
- MCP 首版只启用 tools/list 与 tools/call 所需最小能力；客户端不提供 roots、sampling、elicitation、任意 resources/prompts 注入或 server 发起的模型调用。未知通知、分页失控和协议版本漂移均 fail closed。
- 本地 stdio server 生命周期最多绑定到单个 run，受健康检查、输出/资源配额和 run 结束 teardown 约束，不成为后台常驻服务。远程连接重连、TLS identity、endpoint 或 schema 变化只会撤销当前能力，不会静默切换 transport。
- 来源的 readOnly/destructive/idempotent hint 只用于 UI 辅助；远程 MCP 默认按 `external_action + remote_tool_arguments + never_automatic` 处理，只有 Main 配置的可信策略能够收窄。

## 11. UI 与审计

- Composer 权限摘要分为读取、修改提案、任务执行、网络、外部工具和明确禁止六组。
- Composer 同时区分“run 开始时已授权”和“当前仍有效”；被 feature flag、attestation、连接或策略漂移撤销的能力显示原因，不改写历史授权记录。
- Timeline 为搜索、文件操作、任务、Git、网络和外部工具提供用户可读标签，不展示原始参数 JSON。
- 删除、移动、任务执行和外部副作用使用独立审批卡，不能伪装成普通文件 diff。
- 任务审批卡向用户显示准确的规范化 executable/argv、相对 cwd、来源、参数策略和影响范围；“不向模型展示命令”不能变成“不向用户展示命令”。
- 网络/远程工具审批卡显示目标、数据外发类别和脱敏 payload 摘要；网络和插件结果显示来源，截断、超时、取消和 `outcome_unknown` 必须可见。
- 所有工具继续产生 `tool_started/tool_completed/tool_failed`。现有 Run Snapshot/Event v1.1 已投入使用，新增 `awaiting_tool_approval`、审批、进程输出、能力撤销和不确定外部终态时必须升级为 v1.2，并保持 v1.0/v1.1 可读；不得向既有 v1.1 严格枚举追加新值。

## 12. 分期与发布门

分期使用依赖图而不是强制串行队列：Phase 0 是共同基座；A、B、D 可在各自依赖满足后独立推进；C.0 是所有本地第三方进程能力的前置资格门；插件、本地 MCP、远程 MCP 分别依赖不同边界。Phase C 的高风险原生工作不得阻塞与它无依赖的 Phase D。

每个 Phase 都必须交付完整纵向闭环：registry/权限、Application/Main 执行、用户配置或审批 UI、持久化恢复、诊断、feature flag、文档和定向门禁。最终汇总任务只能做跨 Phase 回归，不能把某一期发布所需的 UI 或恢复语义推迟到最后。

### Phase A：搜索与引用

交付 `search_project_text`、`find_project_references`。这是收益最高、风险最低的一期。

### Phase B：领域创建与文件生命周期

先交付章节/Story Bible/文件创建，再交付 move/delete/mkdir 和通用事务补偿。

### Phase C：工程任务与 Git 只读

先完成 Windows 原生 sandbox host、独立 probe、普通 spawn 负对照、故障注入和打包产物 qualification；只有这些门禁可证伪地通过后，才建立任务目录和审批并接 `run_project_task`。Git 仅 status/diff，且必须复用只读 sandbox profile。无法达到 verified 的机器可以交付 Phase A/B，但 Phase C 工具保持完全不可见。

### Phase D：网络读取

依赖 Phase 0，不依赖 Phase C。独立数据外发/SSRF 安全评审通过后交付 `web_search`、`fetch_url`。

### Phase E：插件/MCP 工具目录

拆成三条门禁：插件工具依赖 C.0、真实 PluginSandboxPort、签名/信任库和审计 Repository；本地 stdio MCP 依赖 C.0 的独立 MCP sandbox profile；远程 MCP 依赖 Phase D 网络策略和 endpoint/secret 控制面。未满足的来源单独保持不可用，不得用旧 fixture/prototype 或另一 transport 的证明代替。

每个 Phase 都必须有 Main-owned、默认关闭的独立 feature flag、迁移兼容测试、定向 E2E 和 kill switch。不得一次性把所有 forbidden capabilities 从权限摘要中删除。

## 13. 明确不做

- 任意原始 Shell 命令。
- Phase C 首版的联网项目任务，以及在未验证平台上降级执行任务。
- Git commit/reset/checkout/merge/rebase/push 或凭据操作。
- 项目根目录外读写、二进制编辑或递归目录删除。
- 无限制网络抓取、浏览器自动操作或登录态复用。
- 未签名插件、运行中热扩权或通用工具代理网关。
- 任务 projection/输出目录自动回写项目；生成物导入需要后续 artifact-to-Change-Set 设计。
- MCP roots、sampling、elicitation、任意 resources/prompts 注入或 server 发起的模型调用。
- 多 Agent、后台云任务和无人值守长期执行；这些是编排能力，不是本次工具补全。

## 14. 总体验收

- 静态注册表为 22 个 ID，模式/工作区/权限过滤与本文一致。
- 默认关闭 P2/P3 时，现有 9 个工具行为和既有 run 可完全回归。
- 所有新增读取结果有来源、content/result digest、单次与累计预算、截断状态和不可信数据包络。
- 所有项目变更都可审阅、可拒绝、可恢复、可撤销，且不能越过 canonical root。
- 任务、网络、插件/MCP 都需要独立权限域，不继承“本次自动修改”。
- canonical tool ID/providerName 映射满足 provider 限制、无碰撞并随 run 冻结；动态 description/schema 不能绕过严格子集校验或注入系统指导。
- Permission Summary 保持不可变历史，Effective Capability State 只缩权；App 重启、attestation/连接过期和 feature flag 关闭不会复活旧批准。
- Task Catalog、Network、Plugin/MCP 和工具源选择均有可用的 Main-owned 用户控制面，不要求手工修改项目 JSON 才能使用。
- Phase C 的 package qualification、当前机器黑盒 probe 和普通 spawn 负对照共同通过；任一 attestation 异常时 registry、Effective Capability State、模型请求和直接调用四层均 fail closed，历史 Permission Summary 只显示已撤销，且无任务 PID 产生。
- 取消、超时、host 断联和崩溃后，独立观察者证明完整进程树消失；workspace 外文件/secret 不可读写，网络监听器连接数为零，临时 ACL/grant 已回收。
- Git 恶意仓库矩阵证明 gitdir/common-dir/object/config/执行器路径不能越界，外部 marker 与仓库 checksum 不变；路径检查绕过或 TOCTOU 也由只读 OS sandbox 拦截。
- 打包后的应用实际包含摘要匹配的 sandbox host/probe policy，并重复通过资格验证；只测源码、Mock Port 或未打包 helper 不算完成。
- 旧 Permission Summary、Change Set、Run Snapshot/Event 和 transaction journal 仍可读取；新增 run 状态/事件写 v1.2。
- 任一 feature flag 关闭后，对应工具不出现在 registry、新 Permission Summary、Effective Capability State 或模型请求中；旧摘要只保留历史事实，不能授权新调用。
