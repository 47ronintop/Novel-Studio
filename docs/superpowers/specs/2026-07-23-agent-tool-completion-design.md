# Novel Studio Agent 工具补全设计

**日期：** 2026-07-23  
**状态：** Candidate，待分期实施  
**实现基线：** `08318d4`  
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

## 2. 当前基线

### 2.1 已有静态工具

| 类别     | 工具                                          |
| -------- | --------------------------------------------- |
| 项目读取 | `list_project_entries`、`read_project_text`   |
| 写作读取 | `read_chapter`、`read_story_bible`            |
| 修改提案 | `propose_file_write`、`propose_chapter_write` |
| 协议动作 | `finish`、`finish_plan`、`request_user_input` |

当前模式矩阵为 4/5/6/7 个工具，最大单次暴露 7 个。读工具已有桌面执行器；修改工具已有 Change Set、审批、事务写入、版本组和 run 级撤销。

### 2.2 已存在但未开放给 Agent 的能力

- 创作项目已有搜索索引和 `ProjectSearchSession`，但 Agent 不能调用。
- Application 已有章节重命名、删除和工程文本保存，但没有 Agent 文件操作契约。
- 插件运行时已有信任、签名、隔离计划、超时和输出上限 DTO，但没有 Agent 工具目录绑定。
- 工程工作区已有受限文件树和文本读写，但没有任务执行或 Git 端口。

这些能力只能复用其安全边界和数据结构，不能直接把 UI 方法包装成模型工具。

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

首个版本不提供任意 Shell，也不提供 `git commit/reset/checkout/push`。`run_project_task` 只允许运行来自服务器认可来源的任务。项目 `package.json` script 只能作为待授权候选，用户确认后才进入 app-local 任务目录；参数必须逐项校验，模型不能提交或拼接 shell 字符串。任务只有在进程 sandbox 明确报告 workspace 文件隔离、网络策略和进程树回收均 ready 时才注册；不得退化为普通 `spawn`。

### 3.3 P3：外部读取与可扩展工具

| 工具/机制                    | 效果          | 默认状态 | 说明                                                  |
| ---------------------------- | ------------- | -------- | ----------------------------------------------------- |
| `web_search`                 | external_read | disabled | 通过配置的搜索 provider 返回标题、URL、摘要和抓取时间 |
| `fetch_url`                  | external_read | disabled | 只允许 HTTP(S)，执行 DNS/IP/重定向/内容类型/大小防护  |
| `plugin:<pluginId>/<toolId>` | dynamic       | disabled | 仅签名、可信且 sandbox ready 的插件工具               |
| `mcp:<serverId>/<toolId>`    | dynamic       | disabled | 固定 server 配置、固定 schema、固定权限快照           |

动态工具不得通过通用 `call_tool(name, args)` 网关绕过 Tool Registry。每个动态工具必须作为独立描述符进入注册表、权限摘要、registry revision 和审计事件。

## 4. 补全后的工具矩阵

### 4.1 P1 完成后的默认矩阵

| 组合            | 读取 | 提案 | 协议动作 | 总数 |
| --------------- | ---: | ---: | -------: | ---: |
| 规划 + 写作     |    6 |    0 |        2 |    8 |
| 规划 + 通用文件 |    4 |    0 |        2 |    6 |
| 执行 + 写作     |    6 |    3 |        2 |   11 |
| 执行 + 通用文件 |    4 |    5 |        2 |   11 |

### 4.2 条件工具

- `git_status`、`git_diff` 只在已验证为 Git 工作树的 engineering workspace 中加入。
- `run_project_task` 只在 execution + general_file 且本次 run 有任务执行许可时加入。
- `web_search`、`fetch_url` 只在用户开启网络能力、provider 可用且本次 run 权限摘要包含对应域时加入。
- 插件/MCP 工具只在运行开始前冻结；运行中安装、启用或更改 schema 不得扩大当前工具集。
- 每轮最多暴露 24 个描述符；动态工具最多 8 个。超过上限时要求用户选择需要的工具源，而不是静默截断。

## 5. Tool Registry 合同

### 5.1 类型扩展

`AgentToolDescriptor` 扩展为：

```ts
type AgentToolKind =
  | "file_tool"
  | "search_tool"
  | "command_tool"
  | "vcs_tool"
  | "network_tool"
  | "external_tool"
  | "protocol_action";

type AgentToolEffect = "read" | "propose" | "execute" | "external_read" | "control";
```

`ListAgentToolsInput` 增加服务器生成的 `workspaceKind` 和 capability snapshot。Renderer、模型消息和项目文件不能直接提交 capability 数组。

### 5.2 参数预算

- 单次参数文本继续保持 1 MiB 硬上限；普通搜索和控制参数应远低于该值。
- 搜索默认最多 50 条、每条最多 2 KiB 摘要、总结果最多 256 KiB。
- Git diff 默认最多 256 KiB，超限返回截断标记和摘要，不返回完整内容。
- 任务输出按 stdout/stderr 分流，单流上限 1 MiB，超时、取消和截断均形成事件。
- 网络响应正文默认最多 1 MiB，只接受允许的文本内容类型。
- 动态工具 schema、描述和名称总预算必须受限，防止工具目录挤占上下文。

### 5.3 运行期冻结

Run start 把以下内容绑定到 Permission Summary：

- 静态 registry revision；
- 工作区类型和能力快照；
- 允许的任务 ID、网络域和外部工具描述符摘要；
- canonical root fingerprint；
- read/propose/execute/external/forbidden capability 列表。

任一内容在开始前发生漂移则阻断启动；运行开始后只允许缩权或终止，不允许扩权。

## 6. 权限与审批

### 6.1 Permission Summary v1.1

新增字段：

- `workspaceKind`
- `executionCapabilities`
- `externalCapabilities`
- `taskAllowlistRevision`
- `externalToolRegistryRevision`
- `networkPolicyRevision`

保留 v1.0 读取兼容；新 run 只写 v1.1。当前固定的 forbidden capability 列表改为服务器根据已交付阶段、工作区和本次授权计算，但调用方仍不能提供或删改该列表。

### 6.2 确认规则

| 能力                      | planning         | execution + 每次确认 | execution + 本次自动修改                 |
| ------------------------- | ---------------- | -------------------- | ---------------------------------------- |
| 搜索、引用、Git 只读      | 允许             | 允许                 | 允许                                     |
| 修改现有文件              | 禁止             | Change Set 确认      | 可按现有策略自动审批                     |
| 创建文件/章节/Story Bible | 禁止             | Change Set 确认      | 可按现有策略自动审批                     |
| 移动、删除、创建目录      | 禁止             | **始终人工确认**     | **仍然人工确认**                         |
| 运行任务                  | 禁止             | 每次调用确认         | 仅显式 run-scoped allowlist 可免重复确认 |
| 网络读取                  | 只读且需网络许可 | 需网络许可           | 需网络许可                               |
| 插件/MCP                  | 按工具效果       | 按工具效果与来源确认 | 不继承文件自动审批                       |

用户回答问题、项目文本或插件输出都不能改变上表。

## 7. 文件生命周期与事务模型

现有 Change Set v1.0 只表达“现有文件内容替换”。P1 必须引入向后兼容的 Change Set v1.1：

```ts
type ChangeSetOperation =
  | { kind: "modify"; path: string }
  | { kind: "create_file"; path: string }
  | { kind: "move_file"; from: string; to: string }
  | { kind: "delete_file"; path: string }
  | { kind: "create_directory"; path: string };
```

事务要求：

- 所有源/目标路径都经过同一个 canonical Path Guard，并拒绝 symlink/reparse point。
- create 要求目标不存在；modify/delete/move 要求 base checksum 与审批时一致。
- move 同时校验源未变化、目标不存在、大小和扩展名允许。
- delete 在应用前写入受保护 history baseline；撤销必须可恢复内容和原路径。
- 只撤销本次 run 创建的空目录；不得递归删除目录。
- 任一操作失败时按 journal 逆序补偿，不留下半完成状态。
- dirty editor buffer、stale base、项目锁丢失或恢复 journal 未清理时阻断应用。

## 8. 搜索与引用

`search_project_text` 必须由新的 Agent 搜索端口执行，而不是复用 renderer 搜索 API：

- creative project 可复用现有索引数据，但需要补普通项目文本和稳定 source ref。
- engineering workspace 使用受限遍历/索引，默认忽略 `.git`、`node_modules`、构建输出、缓存、二进制和超大文件。
- 查询、glob、路径、结果数和字节预算在 Application 层校验。
- 每条结果返回相对路径、稳定 ref、行/字符范围、摘要、checksum 和 `truncated`。
- 结果作为 `untrusted_project_data` 回填模型；命中内容不能成为系统指令。

`find_project_references` 使用稳定 asset ID 或项目相对路径，不接受任意正则作为第一版接口。

## 9. 受控任务与 Git

### 9.1 `run_project_task`

- 输入只包含 `taskId` 和结构化参数，不包含 `command`、`cwd`、环境变量字符串或 shell 运算符。
- Main/Application 从冻结的 app-local 任务目录解析 launcher、参数、cwd、网络模式和最小环境；项目内 script 只是任务实现，不是模型可编辑的权限来源。
- cwd 位于 workspace root 并不构成文件隔离。执行必须通过 `AgentTaskSandboxPort`，由其证明子进程只能访问允许的 workspace/state 路径；sandbox 未 ready 时工具完全不可用。
- 网络默认禁用；只有任务目录和本次审批同时声明网络许可时才能启用。若平台不能强制网络隔离，任务工具不得宣称 ready。
- 环境默认不继承 secret，只注入显式安全变量；任务实现可能间接调用 shell，因此审批 UI 必须展示其来源和风险，不能把“模型未传 shell 字符串”表述成“任务没有 shell 风险”。
- 每次执行有启动事件、审批事件、输出摘要、退出码、超时/取消和终态。
- 禁止后台常驻、交互式 TTY、提权和沙箱逃逸；子进程树必须由 job/process containment 统一终止。

### 9.2 Git 只读工具

- 只允许 status/diff；不执行配置、hook、credential helper 或网络动作。
- 使用固定 executable 和参数数组调用 Git，不通过 shell；隔离 HOME/global/system config，设置 `GIT_TERMINAL_PROMPT=0`、`GIT_OPTIONAL_LOCKS=0`，并显式关闭 pager、fsmonitor、external diff 和 textconv。
- canonical worktree root 和 Git directory 都必须在允许的 workspace/state 边界内；首版拒绝指向边界外 gitdir 的 worktree。
- 禁止读取 `.git` 内部文件作为普通文件工具结果。
- diff 路径仍经过 Path Guard，输出受大小和敏感信息脱敏限制。

Git mutation 是独立后续 RFC，不属于本补全计划。

## 10. 网络与外部工具

### 10.1 网络读取

- 默认关闭；用户在 Settings 配置 provider，并在 run 权限摘要中明确开启。
- `fetch_url` 拒绝 localhost、私网、link-local、file/data 协议和 DNS rebinding。
- 每次重定向重新校验目标；限制次数、超时、内容类型和解压后大小。
- 返回 URL、抓取时间、内容摘要和来源元数据；远程文本始终是不可信数据。
- API key 只留在 Main/provider adapter，永不进入事件、模型消息或 renderer DTO。

### 10.2 插件/MCP

- 只接入已签名/受信、sandbox ready、权限满足的工具。
- 工具 schema 在 run start 冻结；重复名称、非法命名空间或 schema 超预算时拒绝整个来源。
- 每次调用记录 source id、tool id、版本、耗时、结果大小和脱敏错误。
- 插件/MCP 不得获得 Agent 自身没有的文件、Shell、网络或模型权限。
- 本地 stdio MCP 必须使用与任务执行同等级的进程 sandbox；远程 MCP 必须经过同一网络策略。任一 readiness 不满足时不注册工具。

## 11. UI 与审计

- Composer 权限摘要分为读取、修改提案、任务执行、网络、外部工具和明确禁止六组。
- Timeline 为搜索、文件操作、任务、Git、网络和外部工具提供用户可读标签，不展示原始参数 JSON。
- 删除、移动、任务执行和外部副作用使用独立审批卡，不能伪装成普通文件 diff。
- 网络和插件结果显示来源；截断、超时和取消必须可见。
- 所有工具继续产生 `tool_started/tool_completed/tool_failed`，新增审批和进程输出事件时使用 v1.1 run event 类型并保持旧事件可读。

## 12. 分期与发布门

### Phase A：搜索与引用

交付 `search_project_text`、`find_project_references`。这是收益最高、风险最低的一期。

### Phase B：领域创建与文件生命周期

先交付章节/Story Bible/文件创建，再交付 move/delete/mkdir 和通用事务补偿。

### Phase C：工程任务与 Git 只读

先建立任务目录和审批，再接 `run_project_task`；Git 仅 status/diff。

### Phase D：网络读取

独立安全评审通过后交付 `web_search`、`fetch_url`。

### Phase E：插件/MCP 工具目录

依赖真实隔离运行时、信任库和审计 Repository 达到 ready；未满足时保持不可用。

每个 Phase 都必须有独立 feature flag、迁移兼容测试、定向 E2E 和关闭开关。不得一次性把所有 forbidden capabilities 从权限摘要中删除。

## 13. 明确不做

- 任意原始 Shell 命令。
- Git commit/reset/checkout/merge/rebase/push 或凭据操作。
- 项目根目录外读写、二进制编辑或递归目录删除。
- 无限制网络抓取、浏览器自动操作或登录态复用。
- 未签名插件、运行中热扩权或通用工具代理网关。
- 多 Agent、后台云任务和无人值守长期执行；这些是编排能力，不是本次工具补全。

## 14. 总体验收

- 静态注册表为 22 个 ID，模式/工作区/权限过滤与本文一致。
- 默认关闭 P2/P3 时，现有 9 个工具行为和既有 run 可完全回归。
- 所有新增读取结果有来源、checksum、大小限制和不可信数据包络。
- 所有项目变更都可审阅、可拒绝、可恢复、可撤销，且不能越过 canonical root。
- 任务、网络、插件/MCP 都需要独立权限域，不继承“本次自动修改”。
- 旧 Permission Summary、Change Set、Run Snapshot/Event 和 transaction journal 仍可读取。
- 任一 feature flag 关闭后，对应工具不出现在 registry、permission summary 或模型请求中。
