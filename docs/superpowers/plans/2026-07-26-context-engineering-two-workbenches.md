# Novel Studio 双工作台上下文工程实施计划

- **日期：** 2026-07-26
- **更新：** 2026-07-27（补充 standalone 会话与 Provider prompt cache 批次）
- **状态：** Ready（前置批次 1-5 已完成；下一步 C1，C1-C6 尚未实现）
- **实现基线：** `7626853`（Provider、v2 工具目录、网络/MCP 与审批合同已冻结）
- **设计依据：** `docs/superpowers/specs/2026-07-26-context-engineering-two-workbenches-design.md`
- **上位计划：** `docs/superpowers/plans/2026-07-26-agent-tool-functional-priorities.md`（批次 1-5 Complete；代码提交 `7626853`）

## 1. 当前决定

- 产品仍是创作、工程两个工作台；未绑定项目的 Shell `none` 状态不是第三个工作台。上下文解析改为四个显式 Context Profile：应用级 `standalone`，以及 workspace 级 `writing | creative_general | engineering`。
- Standalone 仅允许 `conversation × standalone_chat`，使用 `userDataRoot` 下的应用级持久化根，不伪造 `projectId`，不继承最近工作区、cwd、项目正文或工具；其模型工具目录恒为空。
- 未打开项目时用户可新建、继续、搜索、归档、删除并发送 standalone 会话。生产启动不再无条件打开 `minimal-chapter`；新增“关闭当前项目/工作区”流程，打开工作区时隐藏但保留 standalone，关闭后恢复，不自动迁移上下文。
- 规划两类用户可写项目约定文件：工程 `AGENTS.md`、创作 `conventions/writing.md`，以 workspace trust 约束的 user/data message 注入；不得进入同一个 trusted system role。
- 引入服务器构建的定向块（章节清单 + Story Bible 索引 / 有界目录骨架），作为初始上下文数据消息。
- `toolReserve`/`systemReserve` 诚实化。
- 建立稳定 `project_context_prefix` 和 Provider-capability-aware prompt cache；缓存读/写 token 分开记账，命中率只在 Provider 给出可验证分母时展示。
- Provider、工具目录、网络/MCP 与审批前置已在 `7626853` 关闭；本文件现在允许从 C1 开始，但不把任何 C1-C6 能力标成已实现。向量/语义检索、自动注入、跨模型降级、记忆自动写入继续延期。
- 前置最终门禁：`typecheck`、`lint`、`build`、`git diff --check` 通过，全量 `189` 个测试文件、`1870/1870` 项测试通过；真实外部 Provider/MCP canary 仍需要凭据与网络。
- 不新增模型可见工具、不改审批/Change Set/事务链路；所有项目文件仍走 data envelope，约定文件也不获得 system authority（见设计 §4.2/§6）。

## 2. 批次划分

执行顺序：C1 →（C2 ∥ C3）→ C4 → C5 → C6。C1 先完成 scope/profile/schema 基础，再交付 standalone 纵向闭环；C2-C3 只处理三个 workspace profile。上位计划批次 4/5 已完成；C4 直接使用 `7626853` 的 Provider、冻结工具目录、网络/MCP descriptor 和审批合同，C5 再基于 C1-C4 的稳定 materialization/artifact/预算合同接入 prompt cache。

### 批次 C0：运行时上下文闭环与延期期间修复（吸收到 C1-C4，不再单独排期）

**状态：** 已吸收到后续批次，不能据此声称上下文闭环已实现。C0 用于批次 4/5 完成前界定允许的阻断修复；新序列不再创建独立 C0 提交，其 prompt materialization/恢复不变量归 C1，stale/显式引用不变量归 C2-C3，预算不变量归 C4。任一批次发现泄漏、负预算、旧内容复活或显式引用损坏，仍按阻断级回归立即修复。

**目标：** 只修复上位计划 §12 允许的运行阻断，不引入 Context Profile 或新的自动检索能力。

1. 建立唯一 server-side prompt materializer；start、每轮调用、refresh、exclude、compact、hydrate 都从活动 source/artifact 重新生成真实 model messages。
2. 修复 start budget binding、运行时压力接线、preview/start/round 的 fail-closed 行为；在 context window 未验证时不得猜测可用预算。
3. 修复 stale reader、旧内容错误复活、显式 Story Bible/selection 引用和 Context Draft/Run Draft 绑定校验。
4. 增加 spy model driver 的 start/refresh/exclude/compact/reload 测试，断言 Provider 实际收到的消息和工具目录。

**完成条件：** 现有功能链路中不存在“snapshot 已排除但 prompt 仍有正文”“reload 丢失初始 refs”“预算为空仍可启动/压缩”的路径；不改变工具集合。

### 批次 C1：Scope/Profile 基础、Standalone 会话纵向闭环与指导 v2（批次 4/5 后）

**目标：** 四个 profile 显式化并交付“未打开项目也能持久会话”的完整路径；不新增项目文件或外部工具 IO，不新增 workspace 模型可见工具。

**C1A：Scope/Profile 与持久化合同**

1. 由 `packages/application` 拥有策略并新增 `agent-context-profile.ts`：`AgentContextScope`、`AgentOperationMode`、`AgentContextMode`、`AgentContextProfileId`、`resolveAgentContextProfile(scope, operationMode, contextMode)`、冻结 runtime facts 和 profile 元数据。只允许 `standalone × conversation × standalone_chat`、`creativeProject × planning/execution × writing/general_file`、`engineeringWorkspace × planning/execution × general_file`；其余组合预检拒绝。`packages/agent-engine` 只承载无 IO 的共享值对象/校验，不决定选择策略。
2. `buildAgentSystemGuidance` 重构为 `buildAgentSystemPrompt(profile, { conventionsArtifact? })`：system role 只装配 app-authored 层；约定 artifact 作为 user/data message 接入，`AGENT_SYSTEM_GUIDANCE_VERSION` → `2.0`；风格包仅 writing。Standalone prompt 明示无项目/文件/工具，不得声称已读取本地内容。保留旧函数导出别名直到调用点全部迁移。
3. system_guidance 审计源 refId 升级为 `system_guidance:{profileId}@{version}`；新 run 的 scope/profile/template/artifact 版本在 start 时冻结，hydrate 只恢复持久化 artifact，不能用当前 builder 重写旧 run 输入。
4. prompt materializer 建立两段式顺序：app-authored system prompt/冻结工具目录后，workspace profile 先放置带 data envelope 的约定与定向块，形成稳定 `project_context_prefix`；再放置用户请求、conversation summary、显式引用与当前正文。Standalone 只有 system/空工具稳定前缀，随后是用户请求和会话摘要。start/refresh/exclude/compact/hydrate 必须同序，项目数据不得因前缀位置提升为 system authority。
5. 显式升级持久化合同：conversation record `1.1` 以 scope 取代必填 `projectId`；`AgentRunSnapshot 1.2`、`AgentContextSnapshot 1.2` 和 `AgentRunEvent 1.3` 增加 scope/profile/conversation 所需字段。补 validator、旧版本 normalizer 和 repository 可读版本；旧记录只规范化为 workspace scope，不迁移或复制到 standalone，未知版本 fail closed。
6. `estimateAgentSystemReserveTokens` 升级为按完整装配文本估算（签名接收 profile；约定文本参数 C2 接通）；standalone 的 `toolReserve=0` 必须来自冻结空 catalog 及其 checksum，而不是沿用占位常量。

**C1B：Standalone 真实用户纵向闭环**

7. Main 从 Electron `userDataRoot` 派生固定且受守卫的 standalone state root，复用 scope-aware conversation/run/draft/context/artifact/usage/command-receipt repositories。Renderer 不提供路径；不得读取或改写任何 workspace state root。
8. `DesktopAgentRuntimeManager` 管理一个常驻 standalone runtime 和最多一个 active workspace runtime；Shell `none` 时 IPC 只路由 standalone，工作区激活时只路由该 workspace。两者的选中会话、active run、draft、event stream、artifact、usage 与 cache 隔离。
9. Standalone 冻结空工具目录，只要求模型具备文本生成/流式能力；`conversation` 模式以普通 assistant completion 结束，不要求 `finish_plan`，不生成 Plan Artifact。任何 project reader、文件、shell/任务、Git、Change Set、网络或 MCP 工具调用都必须拒绝。
10. Renderer 在 Shell `none` 时建立 standalone conversation bridge，启用新建、选择、搜索、归档、删除和发送。Composer 固定“会话”模式，隐藏计划/执行、写入授权、项目引用与工作区来源；未配置模型时给出模型设置原因，不再提示必须打开项目。
11. 分离 production startup 与 fixture/demo bootstrap：不存在可恢复工作区，或用户未选择/未允许恢复时保持 `none`，不得自动创建/打开 `minimal-chapter`。新增“关闭当前项目/工作区”命令，复用未保存、lock、active run 及 runtime prepare/commit 守门后返回 standalone；打开工作区时隐藏并持久化 standalone，关闭后恢复上次选中项，不自动搬运 summary/history。
12. Scope 切换前若有 active run，必须等待完成、由用户停止或取消切换；不得留下隐藏后台 run。Standalone repository/runtime 初始化失败时 fail closed，保留打开/创建工作区入口，不回退到不可恢复的内存会话。
13. 测试：四个 profile 的合法/非法组合、固定消息顺序、稳定前缀边界/checksum、冻结 runtime facts、版本/normalizer/artifact 恢复；fresh production start 无默认项目；standalone 新建/发送/搜索/归档/删除、重启恢复、文本模型能力、空工具请求；打开/关闭 workspace 的路由与选择恢复、active run 守门、两个 scope 数据/事件/cache 不串用；工程 × writing 拒绝回归保持绿。

**完成条件：** 未打开项目时用户可完成并恢复真实会话，Provider 看不到项目上下文或工具；打开/关闭工作区后两个 scope 各自连续且不串流。每轮 system prompt 由 profile 驱动，start/refresh/exclude/compact/hydrate 从冻结 artifact 生成同序 model input，全量套件绿。

### 批次 C2：项目约定文件（受信任的用户/数据层）

**目标：** 用户可写约定文件端到端注入 + 审计 + staleness。

1. main 侧 start preflight 读取约定文件：路径固定（AGENTS.md / conventions/writing.md），只经 `AgentProjectReadRepository.readText`（守卫复用，`.md` 已在允许扩展名内）；缺失 → 静默无约定层；超 4000 token → 截断 + 结果里标记。
2. 注入：作为带 `instructionPolicy`、workspace trust 状态和来源信息的 user/data message；同时记为 Context Snapshot 新 sourceKind `project_conventions`。保存原文 checksum、注入片段 checksum、截断范围和 artifact id。
3. staleness：`findStaleContextSources` 对 `project_conventions` 参与比较（它不在 `layer==="system"` 跳过名单）；运行中被改 → 现有 `context_stale` → `awaiting_context_refresh` 流程。
4. 预算：约定文本进 `systemReserve`（C1 预留的参数接通）；`previewContextBudget` 与 start 用同一解析函数。
5. UI（小步）：composer 上下文菜单"查看来源"显示约定文件条目；设置或项目面板提供"创建约定文件"入口（可延到 C6 一并做）。
6. 测试：存在/缺失/超限/运行中修改/staleness 恢复/路径越界拒绝/工程与创作各自路径正确；schema 校验新 sourceKind。

**完成条件：** 用户在项目里写约定文件，新 run 的 user/data context 可见（审计源可证）、改文件触发 stale；无任何新文件系统权限面。

### 批次 C3：工作区定向块

**目标：** 三个 workspace profile 的初始上下文最小集成型；standalone 不读取项目定向块。

1. `packages/application` 定义 `WorkspaceOutlineReader` 只读端口，Main 注入受 canonical-root/no-symlink 守卫保护的 metadata/index 实现；输入只接受服务器解析的 workspace identity、profile 和硬限制，不接受 renderer 根路径或正文：
   - 工程/创作通用：递归深 ≤ 2、条目 ≤ 200，并同时限制扫描 entry/byte/time；
   - 写作：章节清单（id/标题/字数）+ Story Bible 资产索引（assetId/名称/类型，无正文），不得为索引读取整章正文。
2. reader 返回结构化条目、装配文本与 dependency manifest；manifest 至少记录 `readerVersion`、profile、canonical root identity、限制/截断状态，以及工程目录条目集合 revision/checksum，或章节索引与 Story Bible 索引 revision/checksum。artifact 同时保存 manifest checksum 与 materialized checksum。
3. start preflight 把定向块追加为 initialContextSources 之一：sourceKind `workspace_outline`，走现有 `untrusted_project_data` 数据消息管线；目标 ≤ 1500 token，超预算先裁定向块。
4. 只在 start 或用户确认的 context refresh 重建。stale reader 比较 dependency manifest；新增、删除、重命名或 revision 变化触发 `context_stale -> awaiting_context_refresh`，不得静默替换。refresh 写新 artifact/source revision；依赖缺失产生可审计降级块。
5. 压缩分类：`agent-compaction-composer.ts` 把 `workspace_outline` 归可驱逐 `rereadable_body`，只保留 dependency manifest/pointer 与 list/search 重读提示；`project_conventions` 归受保护事实。hydrate 不得从旧正文复活已驱逐内容。
6. 测试：封顶与截断标注、blockedRoots 过滤、manifest 变化/stale/refresh/reload、无 Story Bible 降级、空目录、压缩驱逐与指针、E2E（工程新 run 首轮含目录骨架；写作新 run 含章节清单 + 设定索引）。

**完成条件：** 工程 Agent 不再从零摸目录；写作 Agent 开局知道有哪些章节与设定可查；压缩正确分类两种新源。

### 批次 C4：预算诚实化（排在上位计划批次 4/5 后）

**目标：** 预算操作数与真实注入一致。

1. `toolReserve`：对 run 冻结的 provider-specific 工具目录（含 v2、网络/MCP descriptors）及最大工具结果摘要做确定性估算，替换 `agent-run-runtime.ts` 两处写死的 0。
2. Standalone 的冻结工具目录为空，`toolReserve=0` 由 catalog checksum 作证；仍完整估算 system/conversation wrapper、历史和摘要，不把“无工具”误当成“无上下文成本”。
3. 四处（preview / start / round / compaction 重算）统一走同一 `resolveBudgetInputs` 扩展，计入 wrapper、conversation、system/data message、schema、结果摘要和 artifact pointer，禁止分叉。
4. 压缩摘要模板按四个 profile 接入 `CompactionModelAssistantPort`；standalone 摘要不得产生虚假文件/工作区状态。端口必须返回摘要正文、provenance、tokenCount、checksum 和 precision，结果 Snapshot 写入新的 summary artifact。
5. 测试：toolReserve 随 Provider/v2/network/MCP 目录变化、standalone 空 catalog、preview=start=round=compaction、四个 profile 摘要关键字段、未达目标 fail-closed、预算不足错误路径回归。

**完成条件：** `safeInputBudget` 的每个操作数可解释、可审计；同一 run 的 preview/start/round/compaction 四处预算一致。

### 批次 C5：Provider Prompt Cache 与可观测性

**目标：** 在不改变 prompt 语义与安全边界的前提下，使支持缓存的 Provider 可复用稳定前缀，并将 hit/miss/bypass、缓存读/写 token 与费用语义做到可验证。

1. Provider capability snapshot 增加 `PromptCacheMode = none | automatic_prefix | explicit_breakpoints | explicit_resource`、policy version、TTL/最小 token 限制与 usage 语义；未验证能力默认 `none`。
2. C1 materializer 输出逻辑 prefix identity，Provider adapter 输出物理 payload checksum；identity 绑定 provider/account/model、adapter/policy version、scope、profile/template 与 tool catalog revision；workspace profile 再绑定 workspace/trust、conventions artifact 和 outline manifest/materialized checksum。Standalone 与任何 workspace 永不共用 identity。
3. 扩展 `LlmRequest`：仅由 Main 注入 cache policy/前缀身份/可选 opaque resource ref；Anthropic 接 cache-control block，Gemini 只在 cached-content 资源全生命周期完成时启用，OpenAI-compatible 只使用端点已验证的自动前缀/用量字段；不向其他端点盲发私有字段。
4. 扩展 `LlmUsage`、Run usage summary、usage repository 与 pricing registry：分开 `cacheReadTokens`、`cacheWriteTokens`、`cacheEligibleInputTokens`、`cacheOutcome`、`cacheBypassReason`、`cacheUsageStatus` 及 read/write 单价；`cachedTokens` 仅作旧数据兼容派生值。Outcome 表示 hit/miss/bypass，usage status 表示 actual/derived/unavailable，不得混为一个状态。
5. 只在分母可验证时计算 `cacheHitRate`；用量页和 Run 详情显示 cache mode、hit/miss/bypass 原因、读/写 token、命中率（可用时）和 actual/estimated 节省，不显示原始 cache handle/prompt/路径。
6. 显式 cache resource 的创建、复用、TTL 过期、scope/工作区切换、trust 撤销和应用关闭清理均由 Main 拥有；远程删除结果不可证时保留可审计状态，不自动重试外部副作用。
7. 测试：稳定前缀 byte/checksum，用户请求只改后缀，约定/outline/tools/provider/model/trust 变化必须失效；standalone/workspace 不共享缓存；三类 Provider 请求合同与 usage 归一化；不支持 Provider 不发缓存字段；缓存失败不改变模型输入、审批与工具语义。

**完成条件：** 同一冻结前缀在同一 Provider connection/account/model/scope/policy 下可重用；任意身份或信任变化必然 miss/bypass；不支持缓存的 Provider 与旧 run 行为保持不变；缓存读/写与命中率可审计。

### 批次 C6：提及建议与 UI 收尾（P2，可裁剪）

1. 确定性别名提及扫描（Story Bible 资产名/别名 × 当前章节与用户请求的字符串匹配）→ composer"建议引用"chips，用户点选才注入（复用 ContextDraft refs 管线）。
2. 约定文件创建入口、定向块与约定层在"查看来源"面板的完整展示。
3. E2E 补全 + 全量门禁（`--no-file-parallelism` 套件、typecheck、lint、agent-context-runtime E2E）。

**完成条件：** 建议不自动注入；全部门禁绿。

## 3. 风险与回退

| 风险 | 缓解 |
| --- | --- |
| Standalone 误继承最近项目根或工具 | scope runtime facts 固定 `cwd/root=null`、空 tool catalog；project reader/工具/IPC 拒绝 standalone，并对 Provider payload 做 E2E 断言 |
| Standalone 与 workspace 会话或事件串流 | 应用级与 workspace state root 分离，runtime/IPC 按 scope 路由；conversation/run/draft/event/artifact/usage/cache 隔离测试 |
| 打开/关闭工作区遗留隐藏 active run 或丢失选择 | 复用 prepare/commit、未保存、lock 与 active run 守门；切换失败保持原 scope，重启/往返测试恢复各自上次选中项 |
| 生产启动仍被 fixture 强制打开默认项目 | production startup 与 fixture/demo bootstrap 分离；fresh-profile Electron E2E 断言 `none` 且不存在 `minimal-chapter` 副作用 |
| Standalone 初始化失败退化为易丢失内存会话 | fail closed，显示可诊断禁用原因并保留打开/创建工作区入口，不创建临时伪 scope |
| 约定文件被用于提示注入攻击 | 不进入 system role；workspace trust + 显式启用 + data envelope + token 封顶 + 恶意约定/网络/写入工具测试 |
| 定向块超预算挤占正文 | 1500 token 封顶 + 最先被裁 + 可驱逐可重读 |
| guidance/profile/约定版本升级破坏旧 run 恢复 | 保存 scope/profileVersion、template checksum、conventions artifact、原文/注入 checksum；旧 run 只重放不可变 artifact |
| systemReserve 增大导致小窗口模型预算不足 | 现有 `AGENT_CONTEXT_BUDGET_INSUFFICIENT` fail-closed 路径已覆盖；约定层超限先截断 |
| Provider/网络合同后续演进 | C4 以 `7626853` 的冻结 tool catalog revision 与动态 descriptor checksum 为输入；变化只影响新 run |
| 动态内容进入前缀导致命中率虚高/失效 | C1 只将冻结约定与定向块纳入 `project_context_prefix`；快照测试断言用户请求/正文/工具结果均在后缀 |
| 缓存跨 scope 或信任边界复用 | cache identity 强绑定 Provider/account/model/scope/workspace/trust/policy 与 artifact checksum；任一变化必须 miss/bypass |
| Provider 缓存语义不一致 | capability snapshot + provider-native adapter；无可验证分母不显示命中率，未知能力降级 `none` |
| 显式远程 cache 资源泄漏或清理结果不明 | Main-owned opaque ref + TTL + lifecycle journal；不持久化 prompt/密钥，结果不可证时不自动重试 |

## 4. 执行与验证原则

1. 每批次先完成一个真实用户纵向闭环再进入下一批次；开发中跑最窄相关测试，批次结束跑对应套件 + typecheck + lint。
2. 全量 Vitest 验证一律 `--no-file-parallelism`（已知两个负载敏感用例）。
3. application 测试依赖 agent-engine 编译产物：改 agent-engine 后先 `npx tsc -b packages/agent-engine` 再跑 application 测试。
4. 所有新文本（指导、模板、头部声明）随 profile 版本冻结，改文字必须升版本。
5. 不得以任何形式把项目文件内容提升为系统权威；约定文件只能作为受信任的 user/data context，必须有 workspace trust、显式启用和可审计 artifact。
6. 文档 Ready 不等于代码已实现；只有对应代码、schema migration 和验收提交完成后，才能逐批把 C1-C6 标成 Complete。
7. 任何新增持久化字段、枚举或结构必须升 schema 版本并提供 validator/normalizer；不得静默扩展 `AgentRunSnapshot 1.1` 或 `AgentContextSnapshot 1.1`。
8. Prompt cache 是可选 Provider 优化；hit/miss/bypass 不得改变模型可见内容与 run 结果。不支持缓存的 Provider 是正常降级路径，不是启动失败。
9. Standalone 只提供纯会话：不得伪造 projectId/cwd，不得接入项目、shell/任务、Git、Change Set、网络或 MCP 工具；仅具文本生成/流式能力的模型不应因缺少 tool calling 而被拒绝。
10. Scope 切换不得自动迁移 history/summary、留下隐藏 active run 或回退到内存会话；C1 的 standalone 存储、运行时和 UI 必须作为同一纵向闭环完成。

## 5. 下一步

从 C1A（Scope/Profile 与持久化合同）开始，再完成 C1B（Standalone 真实用户纵向闭环）；C1 的 fresh-start、会话恢复、空工具请求和 scope 往返 E2E 全绿后，才并行进入 C2 + C3，随后 C4、C5，最后 C6。本轮只更新设计与实施文档，不包含 C1-C6 代码。
