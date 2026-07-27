# Novel Studio 双工作台上下文工程设计

**日期：** 2026-07-26
**更新：** 2026-07-27（补充 standalone 会话、创作项目文件模式与 Provider prompt cache 合同）
**状态：** Ready（上位计划批次 1-5 已完成；下一步 C1A，上下文能力尚未实现）
**实现基线：** `7626853`（Provider、v2 工具目录、网络/MCP 与审批前置合同已冻结）
**实施计划：** `docs/superpowers/plans/2026-07-26-context-engineering-two-workbenches.md`
**范围：** 未打开项目时的应用级 standalone 会话、创作工作台的项目文件模式，以及 Agent 运行的系统提示装配、初始上下文、项目约定文件、工作区定向块、上下文预算、Provider prompt cache 与压缩模板；不改变工具安全边界与审批链路。本文定义目标合同，不表示 C1-C6 已实现。

---

## 1. 背景与问题

Novel Studio 有两个工作台：创作工作台（`creativeProject`）与工程工作台（`engineeringWorkspace`），并有一个未绑定工作区的 Shell 状态（`workspaceContext.kind === "none"`）。`none` 不是第三个工作台；它需要一个应用级 standalone 会话作用域。

当前 `none` 只是禁用态：Renderer 把 `activeProjectId` 置为 `undefined`（`apps/desktop/src/renderer/App.tsx:119-122`），不创建 conversation bridge（`agent-conversation-workspace.ts:229-268`），UI 显示但禁用 composer（`packages/ui/src/workspace-shell.tsx:247-274`）；Main 的 runtime binding 仅接受两类 workspace，生产启动还会默认创建并绑定 `minimal-chapter`（`apps/desktop/src/main/index.ts:70-108,300-314`）。因此现在并不存在“无项目会话的空上下文”，而是根本没有可运行会话。

创作工作台的 `general_file` 也只有底层零件，没有完整用户路径：Agent 类型、指导文字和工具过滤已支持 `general_file`（`agent-run-types.ts:7`、`agent-run-session.ts:921-942`），但创作导航只显示“写作/故事资料”（`creative-workspace-navigator.tsx:64-110`），Composer 刻意不渲染 context mode 选择器（`agent-composer.test.tsx:423-438`），现有 `navigateToFile` 还会把 Shell 切到工程工作台（`workspace-navigation.ts:135-147`）。所以当前不能把 `creative_general` 视为已实现：用户在创作工作台里没有项目文件树、创建/打开文件入口，也无法通过活动界面稳定触发该 profile。

两个工作台的 Agent 走**同一条运行时代码路径**（`createDesktopAgentRuntime`，`apps/desktop/src/main/agent-run-runtime.ts:99`），当前的"上下文差异"只有四处：

| 差异点     | 现状                                                                                                                                     | 佐证                                                                        |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 系统指导   | `buildAgentSystemGuidance(contextMode)` 按 writing/general_file 给约 4 行文字；writing 附加硬编码的 `DEFAULT_AI_WRITING_STYLE_RULE_PACK` | `packages/application/src/agent-run-session.ts:905-934`                     |
| 初始上下文 | 只有渲染层塞入的当前章节引用（`contextDraftRefs` 仅返回活动章节）；工程工作台没有章节 → **初始上下文为零**                               | `apps/desktop/src/renderer/agent-run-bridge.ts:2247-2257`                   |
| 模式强制   | 工程工作台把 contextMode 强制为 `general_file`（bridge 归一 + main 预检拒绝 writing）                                                    | `agent-run-bridge.ts:1033-1041`、`agent-run-runtime.ts:1612-1614,1687-1689` |
| 工具子集   | tool-registry 按 contextMode 过滤工具（v1 22 个静态工具 / v2 精简门面）                                                                  | `packages/agent-engine/src/tool-registry.ts:152-302`                        |

除此之外，**写作与工程共用同一套装配管线、同一份指导措辞结构、同一个压缩分类器、同一个预算公式参数**。具体缺口：

1. **系统提示过薄且不可定制。** 4 行指导 + 风格包就是全部；没有类 CLAUDE.md/AGENTS.md 的用户可写项目约定文件（Task 1.7 时已把它列为 P1 延期项）。
2. **初始上下文没有"定向"层。** Claude Code/Codex 启动即注入环境块（cwd、目录感、git 状态）；本项目工程工作台 Agent 启动时对工作区结构一无所知，只能靠 `list_project_entries` 一层层摸（`packages/repository/src/agent-project-read-repository.ts:79-109` 每次只列一个目录）。写作模式也没有章节清单或 Story Bible 索引，模型不知道项目里有什么可查。
3. **预算不诚实。** `toolReserve: 0` 写死（`agent-run-runtime.ts:805,890`）；`systemReserve` 只计当前 4 行指导。工具 schema（v1 最多 15-16 个工具的 JSON schema）实际占用完全未计入。
4. **压缩不分模式。** `agent-compaction-composer.ts` 的保护/驱逐分类和（预留的）模型辅助摘要对写作与工程一视同仁；写作被压掉的可能是伏笔与人物状态，工程被压掉的可能是"改过哪些文件"。
5. **检索引导缺失。** 指导文字没有教模型"先搜后写/先读后改"的 JIT 检索策略，而这是 Claude Code/Codex 上下文工程的核心行为约束。
6. **Provider 缓存只记账、不可控。** `LlmUsage` 只有混合的 `cachedTokens`；Anthropic 把 cache creation/read 合并，Gemini 只读取返回的 cached token，OpenAI-compatible 尚未解析 cached-token detail。`LlmRequest` 没有 cache policy、稳定前缀身份、TTL 或 Provider cache handle，无法证明或验收缓存命中率。
7. **无项目会话缺失。** Conversation/Run/Draft/Context 均以 `projectId` 绑定，Agent `workspaceKind` 排除 `none`，且无“关闭当前工作区”返回未绑定态的生产流程。不能通过伪造 projectId、沿用上一个 cwd 或把 `general_file` 当作纯会话来规避这个缺口。
8. **创作通用文件只有不可达的底层模式。** 现有创作导航没有普通文件树，`contextDraftRefs` 只自动引用活动章节（`agent-run-bridge.ts:2246-2256`），普通文件读写 API 又由 attached engineering session 提供。缺少创作项目专属的文件策略、活动文件上下文、模式切换与安全验收。

`packages/context-engine`（workflow 步骤用的 Context Bundle，见 `CONTEXT_ENGINE.md`）与 Agent 运行上下文是**两套独立系统**，本设计不合并它们；Context Engine 的"显式候选 + 预算 + 排除 trace"原则被本设计沿用到 Agent 侧。

## 2. 对标结论

只吸收已验证的共性机制，不复制任何私有实现。

### 2.1 Claude Code

- **分层系统提示**：内置 system prompt（身份/安全/工具规约）＋ 环境块（cwd、平台、git status 快照、近期提交）＋ 记忆层级（enterprise → 项目 CLAUDE.md → 用户级 → 子目录 CLAUDE.md 按需加载），支持 `@path` import。来源：<https://code.claude.com/docs/en/memory>
- **最小预载 + JIT 检索**：启动不预载任何文件正文；靠 Read/Grep/Glob 按需拉取。CLAUDE.md 官方建议短小、声明式、写"禁止事项"与常用命令。
- **压缩**：接近窗口上限自动 compact（保留关键决定、改过的文件、下一步）；microcompact 只裁剪旧工具结果；`/compact` 可带指示。来源：<https://code.claude.com/docs/en/context-window>
- **子代理隔离**：探索类工作交给独立上下文的子代理，只回结论——上下文隔离手段（本设计列为非目标）。
- **system-reminder**：运行时动态注入的状态提醒（todo 变化、文件被外部修改）。本项目已有等价物（`context_stale` 事件流，`agent-run-session.ts:1860-1889`）。

### 2.2 Codex CLI

- **AGENTS.md 层级发现**：`~/.codex/AGENTS.md`（全局）→ 仓库根 → 沿路径到 cwd 的子目录，深层优先，逐层合并。AGENTS.md 已成跨工具事实标准。来源：<https://github.com/openai/codex>、<https://agents.md>
- **环境上下文**：每会话注入 cwd、沙箱模式、审批策略、网络可用性——模型开局就知道"我在哪、能做什么"。
- **极简工具面**：shell + `apply_patch` 为核心；工具越少，schema 占用越小、行为越可控（与本项目 v2 门面方向一致）。

### 2.3 其他编码 Agent

- **Aider repo map**：tree-sitter 提取符号 + 图排名，在固定 token 预算内给出"结构地图"而非文件正文。来源：<https://aider.chat/docs/repomap.html>。对本项目的启示是**定向块**：极小的结构索引（章节清单/目录骨架）就能大幅减少盲目 list/read。
- **Cline/Roo/Cursor**：项目规则文件目录化（`.clinerules/`、`.roo/rules/`、`.cursor/rules`），支持按需附加；上下文接近上限时"condense"（模型摘要）而非裸截断。
- **Anthropic 有效上下文工程原则**：注意力预算有限；最小高信号 token 集；预载与 JIT 混合；压缩、结构化笔记、子代理隔离是长任务三件套。来源：<https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents>

### 2.4 写作类产品

- **NovelCrafter Codex**：设定条目带别名，正文**提及检测**时选择性注入，支持"always include"标记——不是把整本设定塞进去。来源：<https://www.novelcrafter.com>（Codex 文档）
- **Sudowrite Story Bible**：结构化字段（风格、梗概、人物、世界观、大纲）按生成场景选择性喂入；章节连续性靠大纲 + 前章摘要，而非前文全文。
- **结论**：写作上下文工程 = 结构化设定索引 + 提及驱动的选择性注入 + 前情摘要，与代码 Agent 的 repo map + JIT 检索同构。

## 3. 目标与非目标

**目标**

1. 把“会话作用域 + 工作台 + contextMode”升级为**四个显式的 Context Profile**：应用级 `standalone`，以及工作区级 `writing | creative_general | engineering`。
2. 未打开项目时提供可创建、继续、搜索、归档和删除的 standalone 会话；它使用应用级持久化根，不伪造项目身份，不获得项目文件或执行工具。
3. 在创作导航增加**项目文件**模式：用户可浏览、创建、打开、编辑、重命名和删除受支持的项目文本文件；打开文件自动解析为 `creative_general`，不切换到工程工作台。
4. 引入**用户可写的项目约定文件**（工程 = `AGENTS.md`，创作 = `conventions/writing.md`），以受信任的用户/数据层注入；不得借助文本声明把仓库文件提升为 system role。
5. 引入**工作区定向块**：极小、确定性、服务器构建的结构索引（写作 = 章节清单 + Story Bible 索引；创作通用/工程 = 各自策略下的有界目录骨架）。
6. 预算诚实化：`toolReserve` 按冻结工具目录实计，`systemReserve` 覆盖全部注入层。
7. 压缩按 profile 分类与出摘要：standalone 保用户目标/决定/未决问题，writing 保情节/人物/伏笔，creative_general 保正在处理的文件/用户决定/未完成项，engineering 保文件改动/待办/错误。
8. 指导文字 v2：加入 JIT 检索行为约束（先搜后写、先读后改、不臆造未读内容）；standalone 明确告知模型当前无项目、无可读文件。
9. 建立 Provider-capability-aware prompt cache：稳定前缀可验证、缓存读/写分开记账、命中率可观测，不支持的 Provider 确定性降级为无缓存。

**非目标**

- 不做向量检索、语义排序、自动注入（提及检测只产生**建议**，注入仍需用户确认）——`2026-07-26-agent-tool-functional-priorities.md` §12 对这些的延期继续有效。
- 不做子代理/多 Agent 上下文隔离。
- 不改变 untrusted-data envelope、审批、Change Set、事务与撤销链路。
- 不合并 `packages/context-engine` 与 Agent 运行上下文。
- 不新增模型可见工具（复用 v2 门面）。
- 不自建跨 Provider/跨账户/跨工作区的共享 prompt cache，不宣称一个对所有 Provider 都可保证的固定命中率。
- Standalone 首个竖切不开放项目文件、shell/任务、Git、Change Set、网络或 MCP 工具，不把 standalone 会话自动迁移/合并到后续打开的工作区会话。
- 项目文件模式不是第三个工作台，也不复制工程工作台的 Shell、任务或 Git 能力；首个竖切只处理受支持的 UTF-8 文本文件，不预览图片、音视频、PDF 或二进制文件。

## 4. Context Profile

### 4.1 定义

```
AgentContextScope =
  | { kind: "standalone"; scopeId: "standalone" }
  | { kind: "workspace"; workspaceKind: "creativeProject" | "engineeringWorkspace"; workspaceId: string }

AgentOperationMode = "conversation" | "planning" | "execution"
AgentContextMode = "standalone_chat" | "writing" | "general_file"
AgentContextProfileId = "standalone" | "writing" | "creative_general" | "engineering"
resolveAgentContextProfile(scope, operationMode, contextMode) → AgentContextProfile
```

| profile            | 触发                                              | 身份/工具策略                                      | 约定/定向块                                      | 初始正文       | 压缩摘要模板                       |
| ------------------ | ------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------- | -------------- | -------------------------------------- |
| `standalone`       | standalone × conversation × standalone_chat     | 通用对话助手；明确无项目/文件；模型工具目录为空 | 无                                                 | 无             | 用户目标/已确定决定/未决问题/下一步 |
| `writing`          | creativeProject × planning/execution × writing    | 小说协作者；写作风格包；先查设定/前文再落笔         | `conventions/writing.md` + 章节/Story Bible 索引 | 当前章节         | 情节事实/人物状态/伏笔/用户决定      |
| `creative_general` | creativeProject × planning/execution × general_file（创作导航“项目文件”） | 创作项目文件助手；忠实文本、最小改动；先读后改；无 Shell/任务/Git | `conventions/writing.md` + 用户文件目录骨架 | 当前打开文件（可选） | 文件/用户决定/未完成项                |
| `engineering`      | engineeringWorkspace × planning/execution × general_file | 工程助手；读改分离、最小 diff；先搜索后读取             | `AGENTS.md` + 有界目录骨架                   | 无，全部 JIT 检索 | 改过的文件/待办/报错/下一步           |

Profile 由服务器解析。Workspace profile 的 `workspaceKind` 取自冻结 capability snapshot，`contextMode` 取自 run snapshot；创作项目只有活动界面为“项目文件”且活动资源为空或为允许的普通文本文件时才能解析 `creative_general`，章节/故事资料界面解析为 `writing`。standalone scope 只能解析为 `conversation + standalone_chat`，不允许 renderer 把它切成 writing/general_file/planning/execution。Main 同时冻结紧凑 runtime facts：standalone 为 `workspaceBound=false`、`cwd/projectRoot=null`、project trust/write approval 为 `not_applicable`、tool catalog 为空；workspace profile 则冻结 cwd/root、活动资源身份、sandbox/trust、approval、write policy、network/MCP availability、provider/model 与 tool catalog revision。创作通用 profile 的 capability snapshot 必须固定 `controlledExecutionEnabled=false`、`gitReadEnabled=false`；网络/MCP 仍只按创作项目既有设置与审批启用。

渲染层无法伪造 scope、profile 或 runtime facts。Profile 带版本号（`AGENT_SYSTEM_GUIDANCE_VERSION` → `2.0`），system_guidance 审计源 refId 为 `system_guidance:{profileId}@{version}`。新 run 的 scope/profile/template/artifact 版本在 start 时冻结；旧 run 只从持久化 artifact 恢复，不能用当前 builder 重写原输入。

### 4.2 分层系统提示（信任分层）

应用自有的身份、安全和工具规约沿现有 **trusted systemPrompt seam**（`agent-run-session.ts:1908-1911`）注入。Standalone system prompt 必须明示 `workspaceBound=false`、当前没有可读写项目，不得声称已查看本地文件或可执行项目操作。

项目约定文件不能进入同一个 system role；当前 model driver 只有一个真正的 system message，头部声明不能在消息内部建立低于 system 的权限。约定文件应作为带来源、版本、checksum 和 `instructionPolicy` 的用户/数据消息注入，并受 workspace trust 与显式启用状态约束：

```
[1 系统层]   身份 + 安全边界 + 工具行为约束（app authored，随 profile 版本冻结）
[2 检索层]   JIT 检索策略（app authored）
[3 风格层]   写作风格包（writing 专属，app authored）
[4 约定层]   用户项目约定文件全文（user/data message；不得覆盖系统层安全规则）
```

关键信任决定：约定文件是**用户/数据层上下文**，不是 system authority；workspace trust 和显式启用是必要前置条件。约定层有 token 上限（默认 4000 token，超限截断并在 UI 提示），持久化为不可变 Context Artifact，记录原文 checksum、实际注入片段 checksum、截断范围和 profile/template 版本，参与 staleness 检测。项目里其他文件内容仍一律走 `untrusted_project_data` 封套（`agent-run-session.ts:2727-2735`），本设计不开任何口子。Standalone 没有约定层，也不读取用户上次打开的项目约定。

### 4.3 工作区定向块

服务器构建、确定性、封顶的结构索引，作为**初始上下文数据消息**注入（与现有 initialContextSources 同一机制，`agent-run-session.ts:3925-3944`），sourceKind 新增 `workspace_outline`：

- **Standalone**：不创建 `workspace_outline`，不调用任何 project reader/index port，不把最近工作区或进程 cwd 当成隐式根目录。
- **创作通用**：从 `CreativeProjectFileTreeSnapshot` 派生用户文件目录骨架，只含创作项目文件策略允许的文本文件与未被策略阻断的目录；不混入章节、故事资料、Studio 配置或内部状态目录。
- **工程**：从受 canonical-root/no-symlink 守卫保护的 metadata/index port 派生有界树——深度 ≤ 2，总条目 ≤ 200，扫描同时受 entry/byte/time 上限约束，超出以 `…(+N)` 标注；不得直接调用绕过守卫的领域 repository。
- **写作**：章节清单（通过受守卫的 metadata port：id、标题、字数）+ Story Bible 资产索引（assetId、名称、类型；**不含正文**）。索引不得为构建列表而读取整章正文。
- 定向块是**数据**不是权威：仍包 `untrusted_project_data` 封套（内容源自项目元数据）；压缩时归类为可驱逐、可重读（模型可用 list/search 工具重新获取）。
- 预算：定向块计入 usedTokens，目标 ≤ 1500 token/块；超预算时定向块先于一切被裁（它是最便宜的可重建层）。

`packages/application` 定义只读 `WorkspaceOutlineReader` 端口，Main 按 profile 注入实现；端口接收服务器解析的 workspace identity、profile 与硬限制，不接受 renderer 提供的根路径或正文。返回值除结构化条目和已装配文本外，还必须包含不可变 dependency manifest：`readerVersion`、profile、canonical root identity、限制参数、截断状态，以及工程目录条目集合 revision/checksum、创作文件结构 tree revision/policy version/visible-node checksum，或写作章节索引与 Story Bible 索引 revision/checksum。创作 visible-node checksum 只覆盖相对路径/类型，不含正文或文件 checksum；artifact 保存 manifest checksum，不能只保存最终文本 checksum。

定向块只在 run start 或用户确认的 context refresh 时重建。stale reader 用 dependency manifest 与当前 metadata revision 比较；任何依赖新增、删除、重命名或 revision 变化都触发现有 `context_stale -> awaiting_context_refresh`，不得在运行中静默替换冻结 artifact。确认 refresh 后生成新 artifact/source revision；依赖缺失时生成可审计的空/降级块。compaction 驱逐正文时只保留 manifest/pointer 和重读提示，不能让旧正文在 hydrate 时复活。

### 4.4 初始上下文最小集

| profile          | app-authored system prompt | 数据消息（稳定前缀在前）                                |
| ---------------- | -------------------------- | ------------------------------------------------------------ |
| standalone       | standalone 层 1/2           | 用户请求 → 会话摘要（如有）                          |
| writing          | 层 1/2/3                   | 约定 → 定向块 → 用户请求 → 会话摘要（如有）→ 当前章节    |
| creative_general | 层 1/2                     | 约定 → 用户文件定向块 → 用户请求 → 会话摘要（如有）→ 当前文件（如有） |
| engineering      | 层 1/2                     | 约定 → 定向块 → 用户请求 → 会话摘要（如有）（无正文预载） |

其余一切靠工具拉取。C1 将 Stage 5 消息顺序升级为两段式 materialization：app-authored system prompt 和冻结工具目录之后，先放置带 `untrusted_project_data` 封套的 `project_conventions` 与 `workspace_outline`，形成稳定 `project_context_prefix`；`user_request` 仍是第一条用户创作的任务指令，但不再是第一条非 system 数据消息。可选 `conversation_summary` 只位于用户请求之后，随后是显式引用与当前正文。这个顺序不提升项目数据权限；更晚的用户请求仍优先于项目约定，系统安全规则仍最高。

start、refresh、exclude、compact 与 hydrate 必须从持久化 artifact 按同一顺序 materialize。Workspace profile 的 `project_context_prefix` 逻辑 checksum 由 scope/profile/template 版本、Provider connection/account/model/policy、tool catalog revision、信任状态、约定 artifact checksum 和定向块 manifest/materialized checksum 共同决定；standalone 的稳定前缀只包含 standalone system prompt、空工具目录与同样的 Provider/scope 身份。任一输入变化必须生成新前缀身份，禁止将旧缓存当成新上下文。

`creative_general` 有活动文件时必须把该文件作为 `project_file` source 冻结；Main 通过创作项目文件会话重新读取并校验 relative path、checksum 与大小，不能信任 renderer 正文。活动编辑器有未保存内容时禁止用旧磁盘正文启动 run：用户必须先保存、放弃更改或取消启动。没有活动文件时允许从“项目文件”空态启动，初始正文为空，依靠用户文件定向块与 JIT 工具创建/查找目标。

### 4.5 预算诚实化

现有公式不变：`safeInputBudget = contextWindow − outputReserve − toolReserve − systemReserve`（`packages/agent-engine/src/context-budget.ts`）。修正操作数：

- `systemReserve` = 对 app-authored system prompt、固定 conversation/control wrapper 以及约定 user/data envelope 的完整装配估算，替换现在只算指导文字的 `estimateAgentSystemReserveTokens(contextMode)`（`agent-run-session.ts:941-947`）。签名升级为接收 profile + 约定 artifact。
- `toolReserve` = 对该 run 冻结的 provider-specific 工具目录（包括批次 4 的多 Provider schema/count 能力和批次 5 的网络/MCP descriptors）及最大工具结果摘要的确定性估算，替换写死的 0（`agent-run-runtime.ts:805,890`）。以 `7626853` 的 Provider 与动态 descriptor 合同作为 C4 计算基线。
- Standalone 的工具目录为空，所以 `toolReserve=0` 是有冻结 catalog checksum 作证的正常结果，不是未计算占位值；其 system/conversation wrapper 仍完整计入 `systemReserve`/usedTokens。
- `previewContextBudget`（desktop `agent-run-runtime.ts:844-901`）、run start、每轮 round 与 compaction 重算四处必须用同一套解析函数，禁止各自复算。
- 预算必须覆盖 conversation envelope、JSON 包装、system/data message、工具 schema、结果摘要、summary/pointer artifact，并使用 Provider 可验证的 tokenizer；未知 context window 必须 fail closed。

### 4.6 Provider Prompt Cache 与可观测性

缓存是 Provider 能力，不是本地 Context Artifact 的别名。Artifact 保证恢复与审计，prompt cache 减少 Provider 重复处理的输入 token；两者必须分开建模。

1. **能力模式**：Provider 快照增加 `PromptCacheMode = "none" | "automatic_prefix" | "explicit_breakpoints" | "explicit_resource"`，并冻结 policy version、TTL 上限、最小可缓存 token 与用量字段语义。未验证、未报告或不支持时一律使用 `none`，不向兼容端点盲发 Provider 私有字段。
2. **缓存边界**：可缓存区只包含 app-authored system prompt、冻结工具 schema 和 workspace profile 的 `project_context_prefix`；standalone 只有 system/空工具前缀。用户请求、conversation history、当前章节/文件正文、工具结果与模型摘要默认属动态后缀。Provider 若只支持自动前缀缓存，只依赖精确字节前缀；若支持显式 breakpoint/resource，由 adapter 在同一权限角色内标注缓存边界，不能为缓存把项目数据移入 system role。
3. **服务器权威与失效**：cache identity 只能由 Main 使用冻结 runtime facts 与 artifact checksum 派生，renderer/模型/项目文件不能指定 cache key/handle。Provider connection/account/model、adapter/policy version、tool catalog、profile/template、scope，以及 workspace trust、约定或定向块任一变化都必须 miss/新建；`creative_general` 的用户文件树 manifest 是定向块依赖，因此树结构变化也会产生新前缀。当前文件 artifact/checksum 只绑定动态后缀与 run 恢复，不进入稳定 prefix identity；只改当前文件正文不得无谓冲掉仍相同的前缀缓存。standalone 与任何 workspace 缓存永不共用。显式资源按 TTL 过期，工作区切换或信任撤销后禁止继续引用。
4. **Provider 适配**：Anthropic adapter 分开处理 cache creation/read 并仅在能力已验证时发送 cache-control block；Gemini 只在 cached-content 资源创建、TTL、失效和清理全部接线时使用 `explicit_resource`；OpenAI-compatible 默认仅使用已验证的自动前缀能力，并解析端点实际返回的 cached-token detail。任一 Provider 缓存错误只允许在确认请求未产生外部副作用时降级为无缓存重试。
5. **用量与定价**：统一用量增加可选 `cacheReadTokens`、`cacheWriteTokens`、`cacheEligibleInputTokens`、`cacheOutcome = hit | miss | bypass | unknown`、`cacheBypassReason` 与 `cacheUsageStatus = actual | derived | unavailable`，保留 `cachedTokens` 仅作旧记录兼容派生值。Outcome 描述本次请求是否使用缓存，usage status 描述 token 口径是否可验证，两者不得混用。仅在 Provider 有可验证分母时展示 `cacheHitRate = cacheReadTokens / cacheEligibleInputTokens`；否则显示“不可用”，禁止用混合 token 猜测。定价分开 cache read/write 单价，并标注 actual/estimated/unknown。
6. **UI 与审计**：用量页按 run/日显示缓存读取、写入、命中率（可计算时）和估算节省；Run 详情显示模式、prefix checksum 短摘要、hit/miss/bypass 原因。持久化不得包含 prompt 原文、原始路径、密钥或 Provider 资源秘密；远程 handle 只能作为 Main-owned opaque ref 保存。

### 4.7 压缩按 profile

现有三阶段合同不变（确定性清理 → 有限模型摘要 → awaiting_context_refresh；阈值 WARN 0.7 / COMPACT 0.85，`agent-run-session.ts:510-519`），但压缩必须通过同一 prompt materializer 更新真实 model input。本设计只加两点：

1. **分类扩展**（`apps/desktop/src/main/agent-compaction-composer.ts`）：`project_conventions` → 受保护事实（映射 `explicit_ref` 类）；`workspace_outline` → 可驱逐 `rereadable_body`（指针留"可用 list_project_entries 重读"）。
2. **摘要模板按 profile**：`CompactionModelAssistantPort` 的摘要指令由 profile 提供——standalone 保留用户目标、已确定决定、约束、未决问题与下一步，不生成虚假文件/工作区状态；writing 保留已确立情节事实、人物当前状态、未回收伏笔、用户明确决定；creative_general 保留正在处理的文件、用户决定、未完成项与下一步；engineering 保留已修改文件与改动意图、未完成任务、最近错误输出要点、下一步。端口必须返回摘要正文、provenance、tokenCount、checksum 和 precision，摘要作为新的不可变 source/artifact 写入结果 Snapshot；未达目标且没有可验证摘要时 fail closed，不得提交伪成功 revision。

### 4.8 提及建议（P2，确定性）

对标 NovelCrafter：在 composer 的引用建议里增加**别名提及扫描**——用 Story Bible 资产名称/别名对当前章节与用户请求做纯字符串匹配，命中者作为"建议引用"chips 出现，**用户点选才注入**（复用现有 ContextDraft refs 管线与 `queueDraftMutation`）。无向量、无模型调用、无自动注入，不触碰 §12 延期红线。

### 4.9 创作项目文件模式

`creative_general` 必须由一个用户可见、可完成任务的创作界面触发，不能继续依赖隐藏 draft 值或计划审批中的间接选项。合同如下：

它承载不适合放入章节或 Story Bible 的用户自有材料，例如研究笔记、投稿要求、宣传文案、资料清单以及辅助 JSON/YAML；章节、人物、世界观、大纲等受管资产仍只通过现有专用界面维护。

1. **信息架构**：`CreativeNavigatorMode` 扩展为 `writing | story | files`，创作导航固定显示“写作 / 故事资料 / 项目文件”三个标签。“项目文件”是创作工作台内的第三个导航视图，不改变 `WorkbenchMode="creative"`，也不创建新的 workspace identity。
2. **服务器权威文件会话**：`packages/application` 新增 `CreativeProjectFileSession`，Main 从当前已激活 `creativeProject` 派生 canonical project root，并返回版本化 `CreativeProjectFileTreeSnapshot`。Renderer 只能传 project-relative path/command，不得传根目录。受守卫的树、read/save/lifecycle repository 可从现有 `EngineeringWorkspaceFileRepository` 提取共享原语，但不得用 `engineeringWorkspace` activation 或 attached engineering runtime 伪装创作文件模式。
3. **可见范围**：新增单一、版本化 `CreativeProjectFilePolicy`，树只显示允许的 UTF-8 文本扩展（首版 `.md/.txt/.json/.yaml/.yml/.toml/.csv`）和未被策略阻断的目录（包括用户新建的空目录，不显示不支持的文件）。路径先统一分隔符、折叠 `.` 并按平台规则规范大小写后，再按完整 segment 匹配策略。`project.json`、`settings.json` 和 `chapters/characters/world/outline/timeline/memories/prompts/agents/workflow/workflows/plugins/history/cache/.novel-studio` 属 managed/内部路径，必须在树中隐藏，read/save/create/rename/delete 与 Agent general-file mutation 即使绕过 UI 直调也要拒绝。`.git/.svn/.hg/node_modules/dist/release/build/out/coverage/.cache/__pycache__`、符号链接/reparse point、设备名、绝对路径与 `..` 同样拒绝。
4. **文件树与编辑器**：从 `EngineeringWorkspaceNavigator` 提取无 workspace 语义的树行组件，在“项目文件”面板复用；面板提供筛选、刷新、新建文件、新建目录、重命名和删除。打开文件复用参数化后的 `PlainFileEditorBridge` 与现有 UTF-8、大小上限、expected-checksum 冲突处理，但 bridge 必须显式绑定 `creativeProjectFile` 或 `engineeringWorkspaceFile` scope，禁止用同名相对路径串用 API。一个创作项目同时只维护一个普通文件编辑器实例，不新增多文件编辑器系统。
5. **生命周期命令**：Main-owned commands 至少覆盖 `createTextFile`、`createDirectory`、`renamePath`、`deleteFile`、`deleteEmptyDirectory`，具备 command id/幂等 receipt、名称校验、目标不存在/expected tree revision 校验与原子写；重命名或删除还必须携带并校验树节点的 Main-generated `expectedSourceRevision`，无需为列树读取全文。删除必须二次确认；重命名只能由用户直接发起或经 Agent Change Set 批准。首版拒绝递归删除非空目录；非空目录重命名前，Main 必须有界遍历并确认整棵子树均通过同一 policy、没有隐藏/不支持节点或 symlink/reparse point，否则拒绝。活动或 dirty 文件被移动/删除前走现有保存/关闭守门，成功后刷新树并更新/关闭 editor identity。
6. **导航、活动文件与 profile 映射**：选择“项目文件”或打开普通文件时保持创作工作台，清除活动章节主编辑器并把新 draft 的 context mode 设为 `general_file`；打开章节/故事资料时恢复 `writing` 并清空普通文件 `activeResourceRef`。打开文件后 draft 的独立 `activeResourceRef` 自动指向该 `project_file`，start 时 Main 按当前 creative project identity 与策略重新读取并冻结 `disk_file` source/checksum；它不删除用户手动加入的其他普通文件 refs，没有活动文件时为 `null`。从 dirty 普通文件打开另一文件、切换到写作/故事资料或离开项目时，必须先走“保存 / 放弃 / 取消”守门；启动 Agent 前同样必须先保存或放弃，禁止静默读取旧磁盘正文。已启动 run 的 profile/source 保持冻结，导航只影响下一次 run。Composer 不再增加第二个“写作/通用文件”选择器；Inspector/权限摘要显示服务器解析后的 `creative_general`。计划执行不得凭 radio 把 writing 计划静默改成 general-file，跨 profile 必须重新 preflight 并验证活动界面/资源。
7. **Agent 能力**：`creative_general` 冻结的模型工具只允许 list/read/search、普通文本 edit，以及 feature flag/审批允许的普通文件 create/manage；managed asset mutation、章节/Story Bible 专用写入、Shell/任务和 Git 恒为 forbidden。网络/MCP 仍遵守创作项目既有设置、数据外发审批与工具目录冻结。Agent 修改继续生成 Change Set，不因 UI 能直接保存文件而绕过审批。
8. **状态与外部变化**：用户偏好显式支持 `creativeNavigatorMode="files"` 与独立 `creativeFileExpandedPathIds`；只持久化 project-relative UI identity，不保存 root。创建、移动、删除或刷新发现路径/类型/可见性变化时更新结构 `treeRevision`；普通文件保存只更新该文档 checksum/content revision，不改结构版本。定向块的 visible-node checksum 只覆盖相对路径、节点类型、截断状态与 policy version，不含文件正文/checksum。活动文件被外部修改时进入 conflict/context stale，目录结构被外部修改时使定向块 stale；两者都不得静默替换 editor buffer 或运行中的 Context Artifact。
9. **空态与降级**：新项目没有用户文件时显示“还没有项目文件”及新建入口，Agent 仍可在无活动文件的 `creative_general` 下规划/提议创建文件。树被截断、文件不支持、过大、非 UTF-8、会话初始化失败或路径被拒绝时显示可诊断原因；不得自动切到工程工作台作为降级。

### 4.10 Standalone 会话生命周期

Standalone 是应用级会话作用域，不是伪工作区。下列合同必须同时成立：

1. **持久化与身份**：Main 从 Electron `userDataRoot` 派生固定、受守卫的 standalone state root（如 `agent/standalone`），存放 conversation、run、draft、context、artifact、usage 与幂等 command receipt。conversation/run/context 数据合同共用 discriminated `AgentContextScope`，禁止使用伪 `projectId="standalone"` 兼容。旧会话均 normalize 为 workspace scope，不迁移、不复制到 standalone。
2. **运行时**：`DesktopAgentRuntimeManager` 拥有一个常驻 standalone runtime 和最多一个 active workspace runtime；Shell `kind=none` 时 IPC 只路由到 standalone，工作区激活时只路由到该 workspace。两个 scope 的 active run、conversation selection、draft、event stream 与 cache 不共享，切换不得让隐藏 runtime 继续执行。
3. **模型与工具**：standalone 只要求对话所需的文本生成/流式能力，不因没有 tool calling/structured arguments 而拒绝支持文本对话的模型。工具目录冻结为空，`conversation` 模式以正常 assistant completion 结束，不要求 `finish_plan`，不产生可执行 Plan Artifact。
4. **UI**：未打开项目时保留现有完整 Agent Conversation View，但启用新建/选择/搜索/归档/删除与发送。Composer 固定显示“会话”模式，隐藏计划/执行、写入授权、项目引用与工作区来源控件；模型未配置时禁用原因应指向模型设置，不再提示必须打开项目。
5. **启动与切换**：生产启动不再无条件创建/打开 `minimal-chapter`；fixture/demo bootstrap 与 production startup 分离。若不存在可恢复的最近工作区，或用户未选择/未允许恢复，Shell 保持 `none` 并载入 standalone 会话。应用新增“关闭当前项目/工作区”命令，经现有未保存、active run、lock 与 runtime prepare/commit 守门后返回 `none`。
6. **连续性**：打开项目时 standalone 会话持久化但从当前工作区 UI 隐藏；关闭工作区后恢复 standalone 会话列表与上次选中项。不将 standalone summary/history 自动注入新 workspace run。未来如需“带上下文打开项目”，必须以用户明确选择的可审计 handoff artifact 单独设计。
7. **关闭/失败**：切换 scope 前若有 active run，必须先完成、用户停止或明确取消切换；不得将运行中 run 静默遗留在隐藏 scope。Standalone repository/runtime 初始化失败时 fail closed 并保留打开/创建项目入口，不回退到伪内存会话。

## 5. 数据合同变化

| 合同                             | 变化                                                                                                                             | 兼容性                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `AgentContextScope` / mode        | 新增 standalone/workspace discriminated scope、`AgentOperationMode="conversation"` 与 `AgentContextMode="standalone_chat"` | 旧 mode 保持；workspace 拒绝 standalone_chat，standalone 拒绝 planning/execution/writing/general_file |
| `CreativeNavigatorMode` / 用户偏好 | 增加 `files` 与独立 `creativeFileExpandedPathIds`；偏好快照升 `1.1` | `1.0` 读取时 mode 保持原值、展开列表补 `[]`；未知 mode 回退 `writing` |
| `CreativeProjectFilePolicy`      | 新 `1.0`：允许扩展、managed/ignored roots、大小/深度/条目上限、路径与 symlink/reparse-point 规则的单一策略版本 | Tree/read/save/lifecycle/Agent mutation 共用同一 policy；未知版本 fail closed |
| `CreativeProjectFileTreeSnapshot` | 新 `1.0`：project/workspace identity、policy version、结构 tree revision、带 opaque `nodeRevision` 的节点、截断原因，以及只含路径/类型的 dependency manifest checksum；不含文件正文/checksum 或绝对根路径 | 只由活动 `CreativeProjectFileSession` 生成；切换项目后旧 snapshot/command 拒绝；纯正文保存不改变结构 identity，node revision 可独立变化 |
| 创作文件生命周期 command/receipt | 新 `1.0` discriminated command：create text/directory、rename、delete file/empty directory；含 command id、project identity、expected tree revision，move/delete 另含 expected source node revision；receipt 记录结果 revision/受影响相对路径 | Main 幂等执行；旧/重复 command 返回同 receipt，身份、tree/node revision 不符不产生副作用 |
| Agent Run Draft / Context Draft  | 两者升 `1.1` 并以 scope 取代必填 `projectId`；Context Draft 增加独立 `activeResourceRef`，`creative_general` 自动维护至多一个活动 `project_file` 与 expected disk checksum，start 产出不可变 `disk_file` source/artifact | 旧 `1.0 projectId` 归一为 workspace scope、原 refs 保持用户选择；standalone 的 refs/activeResourceRef 恒为空；dirty editor 不回退旧磁盘内容 |
| Agent conversation record        | 新 `1.1` 以 scope 取代必填 `projectId`；standalone 可持久化而不伪造项目 | `1.0 projectId -> 1.1 workspace scope`；旧记录只读 normalize，不复制到 standalone |
| `AgentContextSnapshot` / source  | 新 `1.2` 增加 scope/profile、`project_conventions`、`workspace_outline`、dependency manifest 与 materialization provenance | reader 显式 normalize `1.0/1.1 -> 1.2`；旧记录归 workspace scope，新 run 只写 `1.2` |
| layer 映射                       | `project_conventions` → `explicit_ref`；`workspace_outline` → `tool_result`                                                      | 在 `1.2` source validator/default layer 中显式处理                   |
| `AGENT_SYSTEM_GUIDANCE_VERSION`  | `1.0` → `2.0`，refId 固定为 `system_guidance:{profileId}@{version}`                                                              | 旧 run 只重放持久化 artifact，不用当前模板重写旧输入                 |
| `AgentRunSnapshot`               | 新 `1.2` 增加 scope、`contextProfileId`、`profileVersion`、`guidanceTemplateChecksum`、`conventionsArtifactId`、`promptCachePolicyVersion`、`cachePrefixChecksum`；standalone 不必填 projectId | reader 显式 normalize `1.0/1.1 -> 1.2`；旧 run 归 workspace scope；新 run 只写 `1.2` |
| `AgentRunEvent` / status          | 新 event `1.3` 允许 `conversation_model` 状态与 standalone scope facts，不改写已发布 1.2 严格枚举 | 1.0/1.1/1.2 保持可读；只有新 conversation 事件写 1.3 |
| Context materialization artifact | 新独立 `1.0` artifact 保存 source/artifact ID、reader/dependency identity、原文与注入 checksum、tokenCount、truncationRange      | 正文或摘要只经不可变 artifact 引用；hydrate 不从当前文件重写历史输入 |
| 约定文件路径                     | 固定：工程 `AGENTS.md`、创作 `conventions/writing.md`；只经受守卫的 project instruction reader 读取，须 workspace trust/显式启用 | 不提升为 system authority；无新文件系统权限面                        |
| 预算输入                         | `resolveBudgetInputs` 增加约定文本与工具目录输入                                                                                 | desktop 内部seam，`AgentContextBudgetInputsPort` 加法扩展            |
| `LlmRequest` / Provider 能力      | 加法增加 prompt cache mode/policy、稳定前缀身份与可选 opaque resource ref；能力快照冻结语义 | 默认 `none`；旧 Provider/fixture 不发送任何缓存字段                  |
| `LlmUsage` / usage record         | 新增 cache read/write/eligible、outcome/bypass reason 与 usage status，`cachedTokens` 仅作兼容派生值；定价拆分 cache read/write | 旧记录读取为 `cacheOutcome=unknown`、`cacheUsageStatus=unavailable`；不伪造命中率 |
| Prompt cache artifact             | 新 `1.0` 保存 Provider connection/account isolation identity、model/scope、policy version、prefix checksum、TTL/时间戳与 Main-owned opaque ref | 不保存账户秘密、prompt 原文或密钥；未知版本 fail closed                     |
| Standalone state root             | Main 从 `userDataRoot` 派生固定 scope root，复用 scope-aware conversation/run/draft/context/artifact/usage/command-receipt ports | 不接受 renderer 路径，不读项目根，不改写旧 workspace 数据 |

兼容规则是硬约束：任何新增持久化字段、枚举值或结构都必须声明新 schema 版本、validator、normalizer 和 repository 可读版本；禁止把上述字段静默塞进现有 `AgentRunSnapshot 1.1` 或 `AgentContextSnapshot 1.1`。旧文件只读规范化，不批量改写；未知版本 fail closed。

## 6. 安全与信任边界（不变量）

1. 项目内容永不成为系统权威；约定文件也不进入 system role，只能作为受 workspace trust 约束的用户/数据层上下文，带 token 封顶、artifact checksum 和 staleness 审计。
2. 定向块与一切文件正文继续走 `untrusted_project_data` 封套。
3. 所有新读取通过受 canonical-root/no-symlink 守卫保护的 project reader/index port，不直接使用绕过守卫的领域 repository，不新增文件系统访问面。
4. 工程工作台遵循现有“提案 + 审批后应用”的写入合同；本设计不扩大工具能力或绕过 Change Set/审批。
5. Profile、约定文本、定向块全部在 run 启动时服务器解析并冻结；运行中只随 compaction/refresh 按既有合同变化。
6. Prompt cache 不得跨 Provider、账户、model、scope/workspace identity 或 trust revision 复用；缓存 hit/miss/bypass 只影响性能与费用，不得改变模型可见内容、角色、工具、审批或恢复语义。
7. Standalone scope 没有 project/workspace identity、root、cwd、trust 或写入授权；任何要求 workspace identity 的 reader、工具或 IPC 必须拒绝 standalone。其冻结工具目录恒为空，Provider adapter 不得补入文件、shell/任务、Git、Change Set、网络或 MCP 工具。
8. Standalone 与 workspace 的 state root、conversation/run/draft/context/artifact/usage、事件订阅和 cache identity 必须隔离；scope 切换不能串用选中会话、摘要、工具结果或 active run，也不得把隐藏 scope 的内容自动注入当前 scope。
9. 生产启动与“关闭当前项目/工作区”不能创建默认项目、复用最近 cwd 或用内存会话掩盖 standalone 初始化失败；失败时应保持可诊断的禁用态并保留打开/创建工作区入口。
10. 创作项目文件的 tree/read/save/lifecycle/Agent mutation 必须同时验证当前 active `creativeProject` identity、版本化 `CreativeProjectFilePolicy`、canonical root containment 与 no-symlink/reparse-point；Renderer 提供的绝对根、过期 tree revision、跨项目 path/snapshot 一律拒绝。
11. managed/内部路径必须在树中隐藏并在 Main 的所有直接与 Agent 写入口拒绝，不能只依赖 UI 过滤；`creative_general` 的冻结工具目录不得包含 Shell、任务、Git 或章节/Story Bible 专用 mutation，普通文件 Agent 写入仍必须走 Change Set 与审批。
12. 活动创作普通文件有 dirty buffer 时不得启动新 run、移动或删除；保存/放弃后 Main 再按磁盘 checksum 冻结 source。外部变化必须触发 conflict/context stale，不能静默替换 buffer、artifact 或运行中的模型输入。

## 7. 与既有计划的关系

- 上位计划批次 1-5 已在 `7626853` 前完成；Anthropic/Gemini 原生 adapter、OpenAI-compatible 合同、v2 工具目录、网络/MCP descriptors 与数据外发审批现在是本设计的冻结前置基线。
- 本次只把设计状态推进到 Ready，不把 Context Profile、约定文件、定向块、动态预算、prompt cache 或模型摘要标成已实现；下一实现批次是 C1。
- C1A 交付 scope/profile/schema 基础；C1B 交付 standalone 会话纵向闭环（应用级存储、空工具 runtime、IPC/UI、启动/关闭工作区与恢复）；C1C 交付创作项目文件纵向闭环（策略、文件会话、第三导航标签、编辑器、活动文件上下文与受限工具）。Standalone 不是第三个工作台，“项目文件”也只是创作工作台内的第三个导航视图；两者都不是可推迟到 C6 的 UI 收尾。
- C2-C3 只作用于三个 workspace profile；standalone 不读取项目约定、不生成工作区定向块。
- C4 直接消费 `7626853` 的 Provider/tool-schema/network/MCP 合同，不再保留“批次 4/5 未定”的占位数字。
- C5 在 C1 的稳定前缀 seam 和 C2-C4 的 artifact/预算之上接入 Provider cache；C6 承载可裁剪的提及建议与 UI 收尾。
- 实施时必须以当前 Stage 5A 代码重新建立差异基线，并遵守 §5 的显式 schema 升级。继续延期：向量/语义检索、自动注入、记忆自动写入和跨模型降级。

## 8. 测试与验收要点

1. **scope/profile 解析**：四个合法 profile 组合各自快照测试；standalone 只接受 `conversation × standalone_chat`，workspace 拒绝 `standalone_chat`，standalone 拒绝 planning/execution/writing/general_file，工程 × writing 被预检拒绝的现有测试保持绿。
2. **standalone 隔离**：scope-aware repository/runtime/IPC 测试断言应用级 state root 可持久化且不伪造 `projectId`；standalone 与 workspace 的会话、draft、run、event、artifact、usage 和 cache 不串用，任何 project reader 与工具调用均被拒绝。
3. **系统提示装配**：system role 只含 app-authored 层；standalone 明示无项目且工具目录为空；约定文件以 user/data message 注入，断言 workspace trust、显式启用、超限截断和恶意指令不能改变安全/审批策略。
4. **约定文件**：存在/缺失/超限/运行中被改（触发 context_stale）/staleness 恢复；路径越界拒绝。
5. **创作项目文件策略与生命周期**：第三个“项目文件”标签、空态、筛选/刷新与偏好恢复；允许扩展可见，managed/ignored/unsupported/absolute/`..`/设备名/symlink/reparse-point 在 tree/read/save/create/rename/delete/Agent mutation 全入口一致拒绝。覆盖 command 幂等、旧 tree/node revision、目标冲突、文件创建/重命名/删除、空目录创建/重命名/删除、经完整 policy 验证的非空目录重命名，以及非空目录删除拒绝。
6. **创作活动文件上下文**：打开普通文件不切换工程工作台并自动解析 `creative_general`；当前文件自动成为唯一 `activeResourceRef`/source，但不删除用户手动加入的其他文件 refs，切回章节/故事资料恢复 `writing` 并清空该 active ref。dirty 文件在打开另一文件、切换创作标签、离开项目、启动 Agent、移动或删除前进入保存/放弃/取消守门；expected checksum 冲突和外部修改进入 conflict/context stale，不向 Provider 发送旧磁盘正文。
7. **定向块**：条目封顶、blockedRoots 过滤、无 Story Bible 时写作定向块降级为仅章节清单；工程空目录与创作用户文件空目录不报错；创作目录骨架不泄露 managed/内部路径；standalone 不调用 outline reader。
8. **预算**：toolReserve 随 Provider、v2、网络/MCP 目录变化；standalone 的空 catalog 产生可证的 `toolReserve=0`；systemReserve 覆盖实际 wrapper；preview/start/round/compaction 同值，未知能力 fail closed。
9. **Prompt cache**：相同冻结输入产生相同逻辑/物理 prefix checksum；改用户请求或创作当前文件正文只改动态后缀，改约定/定向块（含创作用户文件树 manifest）/tool catalog/provider connection/account/model/scope/trust 必须失效。覆盖 `none`、显式 breakpoint、显式 resource 与不支持字段的确定性降级；断言 standalone/workspace 不共用缓存，Anthropic/Gemini/OpenAI-compatible 请求及用量归一化，命中率无可验证分母时为 unavailable。
10. **压缩**：conventions 受保护、outline 被驱逐且留指针；摘要正文/provenance/tokenCount 写入 artifact；四个 profile 的模板断言关键字段，standalone 摘要不得生成文件/工作区事实；真实 prompt 随结果 Snapshot 更新，前缀变化产生新 cache identity。
11. **workspace E2E**：真实 Electron 下，工程工作台新 run 首轮消息含目录骨架，创作写作 run 首轮消息含章节清单 + Story Bible 索引；创作“项目文件”可完成文件/空目录生命周期并在新 run 首轮注入当前文件；三种创作标签往返不切换工作台且恢复各自状态；`查看来源` 面板出现新 source kinds。
12. **standalone E2E**：无恢复工作区的生产首次启动停留在 `none` 且不创建 `minimal-chapter`；用户可新建、发送、搜索、归档、删除，重启后恢复列表与上次选中项。Provider 请求不含工具 schema、项目 source、旧 cwd 或最近工作区内容；只具文本生成/流式能力的模型可完成会话。
13. **scope 切换 E2E**：打开项目后隐藏但保留 standalone，会话/事件只路由到 workspace；关闭工作区后恢复 standalone 选择。active run 或未保存状态按既有守门阻止/确认切换，不发生后台隐藏 run 或自动上下文迁移。
14. 真实 Electron 下断言 start、refresh、exclude、compact、reload 后 Provider 收到的完整消息；C4 以 `7626853` 为基线覆盖多 Provider、网络/MCP 与数据外发审批 E2E，C5 覆盖缓存 hit/miss/bypass 和 TTL/失效 E2E。
15. 全量 `--no-file-parallelism` 套件、typecheck、lint、既有 agent-context-runtime E2E 全绿。
