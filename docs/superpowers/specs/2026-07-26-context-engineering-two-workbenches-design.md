# Novel Studio 双工作台上下文工程设计

**日期：** 2026-07-26
**状态：** Ready（上位计划批次 1-5 已完成；下一步 C1，上下文能力尚未实现）
**实现基线：** `7626853`（Provider、v2 工具目录、网络/MCP 与审批前置合同已冻结）
**实施计划：** `docs/superpowers/plans/2026-07-26-context-engineering-two-workbenches.md`
**范围：** Agent 运行的系统提示装配、初始上下文、项目约定文件、工作区定向块、上下文预算、压缩模板；不改变工具安全边界与审批链路。本文定义目标合同，不表示 C1-C5 已实现。

---

## 1. 背景与问题

Novel Studio 有两个工作台：创作工作台（`creativeProject`）与工程工作台（`engineeringWorkspace`）。两者的 Agent 走**同一条运行时代码路径**（`createDesktopAgentRuntime`，`apps/desktop/src/main/agent-run-runtime.ts:99`），当前的"上下文差异"只有四处：

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

1. 把"(工作台, contextMode)"升级为**三个显式的 Context Profile**，每个 profile 拥有自己的系统提示装配、初始上下文最小集、预算参数与压缩模板。
2. 引入**用户可写的项目约定文件**（工程 = `AGENTS.md`，创作 = `conventions/writing.md`），以受信任的用户/数据层注入；不得借助文本声明把仓库文件提升为 system role。
3. 引入**工作区定向块**：极小、确定性、服务器构建的结构索引（写作 = 章节清单 + Story Bible 索引；工程 = 有界目录骨架）。
4. 预算诚实化：`toolReserve` 按冻结工具目录实计，`systemReserve` 覆盖全部注入层。
5. 压缩按 profile 分类与出摘要：写作保情节/人物/伏笔/用户决定，工程保文件改动/待办/错误。
6. 指导文字 v2：加入 JIT 检索行为约束（先搜后写、先读后改、不臆造未读内容）。

**非目标**

- 不做向量检索、语义排序、自动注入（提及检测只产生**建议**，注入仍需用户确认）——`2026-07-26-agent-tool-functional-priorities.md` §12 对这些的延期继续有效。
- 不做子代理/多 Agent 上下文隔离。
- 不改变 untrusted-data envelope、审批、Change Set、事务与撤销链路。
- 不合并 `packages/context-engine` 与 Agent 运行上下文。
- 不新增模型可见工具（复用 v2 门面）。

## 4. Context Profile

### 4.1 定义

```
AgentContextProfileId = "writing" | "creative_general" | "engineering"
resolveAgentContextProfile(workspaceKind, contextMode) → AgentContextProfile
```

|              | `writing`                                                      | `creative_general`                       | `engineering`                               |
| ------------ | -------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------- |
| 触发         | creativeProject × writing                                      | creativeProject × general_file           | engineeringWorkspace ×（恒）general_file    |
| 身份指导     | 小说协作者：叙事连续性、人物一致、不臆造设定                   | 创作项目内的文件助手：忠实文本、最小改动 | 工程助手：读改分离、最小 diff、遵守项目约定 |
| 风格包       | `DEFAULT_AI_WRITING_STYLE_RULE_PACK`（保留）                   | 无                                       | 无                                          |
| 约定文件     | `conventions/writing.md`（content root）                       | `conventions/writing.md`                 | `AGENTS.md`（workspace root）               |
| 定向块       | 章节清单（id/标题/字数）+ Story Bible 资产索引（id/名称/类型） | 目录骨架（有界）                         | 目录骨架（有界，深 2 层、条目封顶）         |
| 初始正文     | 当前章节（现状保留）                                           | 当前打开文件（现状保留）                 | 无正文——全部 JIT 检索                       |
| 检索指导     | 先查设定/前文再落笔                                            | 先读后改                                 | 先搜索后读取，先读取后提改                  |
| 压缩摘要模板 | 情节事实/人物状态/伏笔/用户决定                                | 通用（文件与决定）                       | 改过的文件/待办/报错/下一步                 |

Profile 由服务器解析：`workspaceKind` 取自冻结的 capability snapshot（`agent-tool-capabilities` 里已有该字段，desktop 在 `agent-run-runtime.ts:254` 写入），`contextMode` 取自 run snapshot；同时冻结紧凑的 runtime facts（cwd/project root、sandbox/trust、approval、write policy、network/MCP availability、provider/model、tool catalog revision）。渲染层无法伪造 profile 或 runtime facts。Profile 带版本号（沿用并提升 `AGENT_SYSTEM_GUIDANCE_VERSION` → `2.0`），system_guidance 审计源的 refId 升级为 `system_guidance:{profileId}@{version}`。新 run 的 profile/template/artifact 版本在 start 时冻结；旧 run 只从持久化 artifact 恢复，不能用当前 builder 重写原输入。

### 4.2 分层系统提示（信任分层）

应用自有的身份、安全和工具规约沿现有 **trusted systemPrompt seam**（`agent-run-session.ts:1908-1911`）注入。项目约定文件不能进入同一个 system role；当前 model driver 只有一个真正的 system message，头部声明不能在消息内部建立低于 system 的权限。约定文件应作为带来源、版本、checksum 和 `instructionPolicy` 的用户/数据消息注入，并受 workspace trust 与显式启用状态约束：

```
[1 系统层]   身份 + 安全边界 + 工具行为约束（app authored，随 profile 版本冻结）
[2 检索层]   JIT 检索策略（app authored）
[3 风格层]   写作风格包（writing 专属，app authored）
[4 约定层]   用户项目约定文件全文（user/data message；不得覆盖系统层安全规则）
```

关键信任决定：约定文件是**用户/数据层上下文**，不是 system authority；workspace trust 和显式启用是必要前置条件。约定层有 token 上限（默认 4000 token，超限截断并在 UI 提示），持久化为不可变 Context Artifact，记录原文 checksum、实际注入片段 checksum、截断范围和 profile/template 版本，参与 staleness 检测。项目里其他文件内容仍一律走 `untrusted_project_data` 封套（`agent-run-session.ts:2727-2735`），本设计不开任何口子。

### 4.3 工作区定向块

服务器构建、确定性、封顶的结构索引，作为**初始上下文数据消息**注入（与现有 initialContextSources 同一机制，`agent-run-session.ts:3925-3944`），sourceKind 新增 `workspace_outline`：

- **工程**：从受 canonical-root/no-symlink 守卫保护的 metadata/index port 派生有界树——深度 ≤ 2，总条目 ≤ 200，扫描同时受 entry/byte/time 上限约束，超出以 `…(+N)` 标注；不得直接调用绕过守卫的领域 repository。
- **写作**：章节清单（通过受守卫的 metadata port：id、标题、字数）+ Story Bible 资产索引（assetId、名称、类型；**不含正文**）。索引不得为构建列表而读取整章正文。
- 定向块是**数据**不是权威：仍包 `untrusted_project_data` 封套（内容源自项目元数据）；压缩时归类为可驱逐、可重读（模型可用 list/search 工具重新获取）。
- 预算：定向块计入 usedTokens，目标 ≤ 1500 token/块；超预算时定向块先于一切被裁（它是最便宜的可重建层）。

`packages/application` 定义只读 `WorkspaceOutlineReader` 端口，Main 按 profile 注入实现；端口接收服务器解析的 workspace identity、profile 与硬限制，不接受 renderer 提供的根路径或正文。返回值除结构化条目和已装配文本外，还必须包含不可变 dependency manifest：`readerVersion`、profile、canonical root identity、限制参数、截断状态，以及工程目录条目集合 revision/checksum，或写作章节索引与 Story Bible 索引 revision/checksum。artifact 保存 manifest checksum，不能只保存最终文本 checksum。

定向块只在 run start 或用户确认的 context refresh 时重建。stale reader 用 dependency manifest 与当前 metadata revision 比较；任何依赖新增、删除、重命名或 revision 变化都触发现有 `context_stale -> awaiting_context_refresh`，不得在运行中静默替换冻结 artifact。确认 refresh 后生成新 artifact/source revision；依赖缺失时生成可审计的空/降级块。compaction 驱逐正文时只保留 manifest/pointer 和重读提示，不能让旧正文在 hydrate 时复活。

### 4.4 初始上下文最小集

| profile          | app-authored system prompt | 数据消息（含约定/定向块）                                |
| ---------------- | -------------------------- | -------------------------------------------------------- |
| writing          | 层 1/2/3                   | 用户请求 → 会话摘要（如有）→ 约定 → 定向块 → 当前章节    |
| creative_general | 层 1/2                     | 用户请求 → 会话摘要（如有）→ 约定 → 定向块 → 当前文件    |
| engineering      | 层 1/2                     | 用户请求 → 会话摘要（如有）→ 约定 → 定向块（无正文预载） |

其余一切靠工具拉取。必须保持 Stage 5 的固定消息顺序：app-authored system prompt 之后，`user_request` 是第一条非 system 事实消息；可选 `conversation_summary` 只能位于用户请求之后，不能为方便装配而前移。随后依次注入约定、定向块和显式引用；start、refresh、exclude、compact 与 hydrate 都从持久化 artifact 按同一顺序 materialize。这与现有 `initialContextSources` 管线兼容：定向块由 main 侧在 start preflight 时追加为一个 source，渲染层 `contextDraftRefs` 不变。

### 4.5 预算诚实化

现有公式不变：`safeInputBudget = contextWindow − outputReserve − toolReserve − systemReserve`（`packages/agent-engine/src/context-budget.ts`）。修正操作数：

- `systemReserve` = 对 app-authored system prompt、固定 conversation/control wrapper 以及约定 user/data envelope 的完整装配估算，替换现在只算指导文字的 `estimateAgentSystemReserveTokens(contextMode)`（`agent-run-session.ts:941-947`）。签名升级为接收 profile + 约定 artifact。
- `toolReserve` = 对该 run 冻结的 provider-specific 工具目录（包括批次 4 的多 Provider schema/count 能力和批次 5 的网络/MCP descriptors）及最大工具结果摘要的确定性估算，替换写死的 0（`agent-run-runtime.ts:805,890`）。以 `7626853` 的 Provider 与动态 descriptor 合同作为 C4 计算基线。
- `previewContextBudget`（desktop `agent-run-runtime.ts:844-901`）与 run 启动、compaction 重算三处必须用同一套解析函数，禁止各自复算。
- 预算必须覆盖 conversation envelope、JSON 包装、system/data message、工具 schema、结果摘要、summary/pointer artifact，并使用 Provider 可验证的 tokenizer；未知 context window 必须 fail closed。

### 4.6 压缩按 profile

现有三阶段合同不变（确定性清理 → 有限模型摘要 → awaiting_context_refresh；阈值 WARN 0.7 / COMPACT 0.85，`agent-run-session.ts:510-519`），但压缩必须通过同一 prompt materializer 更新真实 model input。本设计只加两点：

1. **分类扩展**（`apps/desktop/src/main/agent-compaction-composer.ts`）：`project_conventions` → 受保护事实（映射 `explicit_ref` 类）；`workspace_outline` → 可驱逐 `rereadable_body`（指针留"可用 list_project_entries 重读"）。
2. **摘要模板按 profile**：`CompactionModelAssistantPort` 的摘要指令由 profile 提供——writing 模板要求保留：已确立的情节事实、人物当前状态、未回收伏笔、用户明确决定；engineering 模板要求保留：已修改文件与改动意图、未完成任务、最近错误输出要点、下一步。端口必须返回摘要正文、provenance、tokenCount、checksum 和 precision，摘要作为新的不可变 source/artifact 写入结果 Snapshot；未达目标且没有可验证摘要时 fail closed，不得提交伪成功 revision。

### 4.7 提及建议（P2，确定性）

对标 NovelCrafter：在 composer 的引用建议里增加**别名提及扫描**——用 Story Bible 资产名称/别名对当前章节与用户请求做纯字符串匹配，命中者作为"建议引用"chips 出现，**用户点选才注入**（复用现有 ContextDraft refs 管线与 `queueDraftMutation`）。无向量、无模型调用、无自动注入，不触碰 §12 延期红线。

## 5. 数据合同变化

| 合同                             | 变化                                                                                                                             | 兼容性                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `AgentContextSnapshot` / source  | 新 `1.2` 增加 `project_conventions`、`workspace_outline`、dependency manifest 与 materialization provenance                      | reader 显式 normalize `1.0/1.1 -> 1.2`；新 run 只写 `1.2`            |
| layer 映射                       | `project_conventions` → `explicit_ref`；`workspace_outline` → `tool_result`                                                      | 在 `1.2` source validator/default layer 中显式处理                   |
| `AGENT_SYSTEM_GUIDANCE_VERSION`  | `1.0` → `2.0`，refId 固定为 `system_guidance:{profileId}@{version}`                                                              | 旧 run 只重放持久化 artifact，不用当前模板重写旧输入                 |
| `AgentRunSnapshot`               | 新 `1.2` 增加 `contextProfileId`、`profileVersion`、`guidanceTemplateChecksum`、`conventionsArtifactId`（均绑定 start 时冻结值） | reader 显式 normalize `1.0/1.1 -> 1.2`；新 run 只写 `1.2`            |
| Context materialization artifact | 新独立 `1.0` artifact 保存 source/artifact ID、reader/dependency identity、原文与注入 checksum、tokenCount、truncationRange      | 正文或摘要只经不可变 artifact 引用；hydrate 不从当前文件重写历史输入 |
| 约定文件路径                     | 固定：工程 `AGENTS.md`、创作 `conventions/writing.md`；只经受守卫的 project instruction reader 读取，须 workspace trust/显式启用 | 不提升为 system authority；无新文件系统权限面                        |
| 预算输入                         | `resolveBudgetInputs` 增加约定文本与工具目录输入                                                                                 | desktop 内部seam，`AgentContextBudgetInputsPort` 加法扩展            |

兼容规则是硬约束：任何新增持久化字段、枚举值或结构都必须声明新 schema 版本、validator、normalizer 和 repository 可读版本；禁止把上述字段静默塞进现有 `AgentRunSnapshot 1.1` 或 `AgentContextSnapshot 1.1`。旧文件只读规范化，不批量改写；未知版本 fail closed。

## 6. 安全与信任边界（不变量）

1. 项目内容永不成为系统权威；约定文件也不进入 system role，只能作为受 workspace trust 约束的用户/数据层上下文，带 token 封顶、artifact checksum 和 staleness 审计。
2. 定向块与一切文件正文继续走 `untrusted_project_data` 封套。
3. 所有新读取通过受 canonical-root/no-symlink 守卫保护的 project reader/index port，不直接使用绕过守卫的领域 repository，不新增文件系统访问面。
4. 工程工作台遵循现有“提案 + 审批后应用”的写入合同；本设计不扩大工具能力或绕过 Change Set/审批。
5. Profile、约定文本、定向块全部在 run 启动时服务器解析并冻结；运行中只随 compaction/refresh 按既有合同变化。

## 7. 与既有计划的关系

- 上位计划批次 1-5 已在 `7626853` 前完成；Anthropic/Gemini 原生 adapter、OpenAI-compatible 合同、v2 工具目录、网络/MCP descriptors 与数据外发审批现在是本设计的冻结前置基线。
- 本次只把设计状态推进到 Ready，不把 Context Profile、约定文件、定向块、动态预算或模型摘要标成已实现；下一实现批次是 C1。
- C4 直接消费 `7626853` 的 Provider/tool-schema/network/MCP 合同，不再保留“批次 4/5 未定”的占位数字。
- 实施时必须以当前 Stage 5A 代码重新建立差异基线，并遵守 §5 的显式 schema 升级。继续延期：向量/语义检索、自动注入、记忆自动写入和跨模型降级。

## 8. 测试与验收要点

1. **profile 解析**：三组合各自快照测试；工程 × writing 被预检拒绝的现有测试保持绿。
2. **系统提示装配**：system role 只含 app-authored 层；约定文件以 user/data message 注入，断言 workspace trust、显式启用、超限截断和恶意指令不能改变安全/审批策略。
3. **约定文件**：存在/缺失/超限/运行中被改（触发 context_stale）/staleness 恢复；路径越界拒绝。
4. **定向块**：条目封顶、blockedRoots 过滤、无 Story Bible 时写作定向块降级为仅章节清单；工程空目录不报错。
5. **预算**：toolReserve 随 Provider、v2、网络/MCP 目录变化；systemReserve 覆盖实际 wrapper；preview/start/round/compaction 同值，未知能力 fail closed。
6. **压缩**：conventions 受保护、outline 被驱逐且留指针；摘要正文/provenance/tokenCount 写入 artifact；两套模板断言关键字段；真实 prompt 随结果 Snapshot 更新。
7. **E2E**：真实 Electron 下，工程工作台新 run 首轮消息含目录骨架，创作写作 run 首轮消息含章节清单 + Story Bible 索引；`查看来源` 面板出现新 source kinds。
8. 真实 Electron 下断言 start、refresh、exclude、compact、reload 后 Provider 收到的完整消息；C4 以 `7626853` 为基线覆盖多 Provider、网络/MCP 与数据外发审批 E2E。
9. 全量 `--no-file-parallelism` 套件、typecheck、lint、既有 agent-context-runtime E2E 全绿。
