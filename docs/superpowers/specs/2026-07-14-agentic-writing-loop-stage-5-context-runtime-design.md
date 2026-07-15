# Agentic Writing Loop Stage 5 上下文与运行控制设计

版本：1.2
日期：2026-07-15
状态：已确认，实施计划已编写

## 1. 背景与结论

Stage 0 至 Stage 4 已经建立了 Agent Run、Context Snapshot、只读规划模式、Plan Artifact、plan-to-execution handoff、Change Set、Version Group、Conversation 和 Electron E2E 基础。下一阶段不再扩展新的写入能力，也不重新实现规划模式，而是补齐 Agent 在长篇项目中的上下文生命周期、权限可见性、计划执行反馈、错误诊断和用量分析。

本方案先通过 Stage 5.0 单一会话界面基线门禁，再进入三个连续但可独立验收的功能子阶段：

- **Stage 5A：Context Runtime**：写作/通用文件上下文、显式引用、上下文计量、手动压缩和自动压缩。
- **Stage 5B：Permission and Plan Execution Control**：能力边界摘要、确认/自动执行策略，以及现有 Plan Mode 的执行进度和偏离审批增强。
- **Stage 5C：Diagnostics and Usage**：分层错误处理、可复制诊断、单次 run 用量和设置页日用量图。

三个子阶段共享同一个 `AgentRunEvent`、`AgentRunSnapshot` 和 `Context Snapshot` 合同。Stage 5 不改变 Stage 2-3 的 Change Set、Version Group、事务 journal、冲突处理和 run undo 语义。

## 2. 目标

- 根据 provider/model 的实际上下文窗口动态计算本次 run 的安全上下文预算。
- 让写作模式和通用文件模式拥有不同的初始上下文、工具清单和压缩规则。
- 支持 `@章节`、`@Story Bible 资产`、`@文件`、当前选区等显式引用，并允许用户移除引用。
- 在输入区提供紧凑的上下文状态入口；只有接近预算、来源过期或存在 dirty source 时才主动显示提醒。
- 在达到预算阈值时自动压缩；用户也可以随时手动压缩。
- 清晰区分“系统能力边界”和“本次修改审批策略”，避免把自动修改误解为扩大权限。
- 保持 Stage 1 已实现的只读规划模式和 plan-to-execution handoff，并补充计划执行步骤、偏离、阻塞和验证结果。
- 把错误变成可恢复的操作，而不是只显示一句失败文本。
- 在设置页提供按日、provider、model、项目的 token 用量和成本趋势；聊天主界面不常驻展示本轮 token、成本或运行历史。

## 3. 非目标

- 不增加 Shell、终端、Git、MCP、浏览器、网络研究、插件或远程数据源工具。
- 不增加删除、移动、重命名、创建目录或二进制编辑能力。
- 不允许上下文压缩改变项目文件、编辑器内容、Change Set 或版本历史。
- 不把“本次运行自动修改”升级为项目级永久默认；仍然只能由用户对当前 execution run 明确授权。
- 不实现供应商账单 API；成本在无法取得真实价格或真实 usage 时必须标记为估算或未知。
- 不在 Stage 5 引入多 Agent 并行、后台无人值守或应用关闭后继续运行。

## 4. 设计原则

### 4.1 三轴模式保持正交

每个 run 继续携带三个独立维度：

| 维度 | 选项 | 影响 |
| --- | --- | --- |
| 运行模式 | `planning` / `execution` | 是否允许产生可应用的 Change Set |
| 上下文模式 | `writing` / `general_file` | 初始上下文、提示规则和可见读取工具 |
| 写入策略 | `write_before_confirmation` / `user_preapproved_run` | Change Set 如何获得批准 |

Stage 1 已实现的规划模式继续保持只读，不显示或接受自动修改策略。上下文模式不改变安全级别；写作模式和通用文件模式都受同一 Path Guard、工具注册表和 Repository 边界约束。UI 延续 Stage 1-4 的“通用文件”名称，不另引入“普通文件”模式标识。

### 4.2 能力边界与审批策略分离

能力边界由主进程和 Application 层固定决定：项目根目录、允许的工具、文件类型、大小和 reparse/TOCTOU 检查不能由模型或文件内容改变。审批策略只决定一个 execution run 中候选 Change Set 是否需要用户点击确认。

因此：

- “每次修改前确认”不是低权限模式，而是默认审批方式。
- “本次运行自动修改”不是扩大工具或路径权限，而是当前 run 的显式预授权。
- `planning` 不产生可应用变更，也不能通过计划内容切换成 execution。

### 4.3 事实、估算和未知必须显式区分

上下文 token、provider usage、成本和压缩效果都带有来源：

- `reported`：provider 返回的 usage。
- `estimated`：本地 tokenizer 或稳定估算器计算的值。
- `unknown`：无法可靠计算的值。

UI 不得把估算值标成精确值，也不得用没有价格依据的数字伪装账单金额。

### 4.4 方案取舍

考虑过三种落地方式：

- **把六类能力做成一个大 Stage 5**：入口少，但上下文、权限、计划和用量互相阻塞，任何一个门禁失败都会拖住全部交付。
- **继续扩展现有普通 AI 写作流**：改动入口少，但会重新形成一套错误、usage 和上下文状态源，无法复用 Agent Run 的审计合同。
- **以 Agent Run 为唯一事实源，拆成 5A/5B/5C**：实现顺序更长，但每个阶段都能独立验证，且不会绕过现有 Change Set 和 Version Group。

本方案选择第三种。借鉴 Codex、Claude Code、Cline 等工具的交互原则只限于显式计划、上下文可见性、审批边界、压缩入口和错误恢复，不复制 Shell、Git、网络或编程工具权限。

### 4.5 单一会话表面与极简 composer

Stage 5 同时纠正 Stage 1-4 UI 中新旧 AI 表面并存造成的重复输入框、重复 assistant 内容和默认展开诊断。最终工作区采用“中央编辑器 + 右侧 AI 会话”：

- 中央主编辑区继续承载文档、Plan Artifact 详情和 Diff Review；
- 右侧 AI 会话是唯一日常输入与对话入口；
- `AgentRunPanel` 只渲染当前 assistant 输出、活动步骤和必要的阻塞交互，不再拥有 textarea、发送按钮或一套独立模式控件；
- Conversation 表面拥有唯一 `AgentComposer`，整个可见工作区只能存在一个 `Agent 请求` textbox 和一个发送/停止控件；
- 旧 `AiWritingAssistantPanel` 不与 Agent Conversation 同屏。兼容期可以保留底层旧 workflow，但不能继续渲染第二套 composer、消息流或运行详情；
- 当前 run 的内容只投影一次：活动 run 由运行视图显示，固化为 Conversation turn 后不再同时重复渲染同一 assistant 文本和事件。

Composer 结构固定为：

```text
┌──────────────────────────────────────────────────────────────┐
│ 输入消息……                                                   │
│ @当前章节  @人物设定                                          │
│                                                              │
│ +  执行 · 写作⌄  每次修改前确认⌄       模型⌄  推理度⌄  [发送] │
└──────────────────────────────────────────────────────────────┘
```

- 左下角放引用入口、运行/上下文模式和修改权限。`执行 · 写作` 是一个紧凑入口，展开后仍以两个独立分组修改 `operationMode` 与 `contextMode`，不能合并底层语义；
- `执行 · 写作` 必须是输入框内左下角的单一弹层触发器，不在消息区标题、运行卡或输入框上方常驻两组 segmented control。触发器使用当前值作为短标签并带展开图标，弹层分为“运行方式”和“上下文”两个键盘可操作分组：运行方式为“执行 / 规划（只读）”，上下文为“写作 / 通用文件”；选择后更新同一个 `AgentRunDraft` revision 并关闭弹层；
- 权限菜单只控制 execution run 的 Change Set 审批，选项为“每次修改前确认”和“本次运行自动修改”。不使用“完全授权”，因为 Stage 5 不提供 Shell、网络、Git、删除或项目外访问；
- planning 时隐藏输入框底栏中的修改权限触发器，并在模式弹层的规划选项中显示“只读”；从 execution 切换到 planning 时，草稿写入策略归一化为人工确认且风险勾选复位；切回 execution 不恢复旧的自动修改授权；
- 右下角发送按钮左侧依次放模型和推理度。模型菜单只列出已配置且可用的 model profile；推理度只在当前 provider/model 支持时显示；
- 切换 model 或推理度会重新执行 capability preflight 和上下文预算计算。活动 run 创建后锁定选择，不能在同一 run 中途切换；
- run 创建前，请求、三轴模式、model profile ID、推理度和 Context Draft 引用统一保存在当前 Conversation 的 `AgentRunDraft` revision 中。新 Conversation 从项目默认 model profile、该模型声明的默认推理度和默认人工确认策略初始化；切换到不支持当前推理度的 model 时，草稿归一化为该模型默认值或隐藏推理度，不能继续提交旧值。应用重载恢复草稿；`startRun` 原子绑定 draft ID/revision/checksum；
- 活动 run 创建后，底栏选择器保持可查看但禁止修改；停止按钮占用发送按钮的同一固定位置，不在运行卡或问题卡中再出现第二个停止按钮；
- 窄侧栏把模型与推理度合并为一个紧凑入口，例如 `GPT-5 · 高`，模式和权限控件允许换行，但发送按钮尺寸与位置保持稳定。底栏不得退化为纵向表单，也不能让模式、权限或模型标签把发送按钮挤出输入框。

聊天消息流默认只显示用户消息、assistant 正文、当前动作和必要的阻塞卡。问题、计划审批、上下文过期、Change Set、错误重试与 recovery 必须在发生时内联；模型、token、成本、context trace、workflow history 和完整工具历史不作为常驻区块。

工具活动遵循渐进披露：运行中只展开当前动作；完成后聚合为“已读取 4 项 · 修改 2 个文件”等单行摘要，点击后才展开真实工具步骤。后台 `AgentRunRecord`、事件、版本和诊断仍按原合同持久化，用于恢复、撤销和审计，但不新增独立的“详细运行记录”主界面。

右侧会话只有一个纵向滚动容器，composer 固定在该容器底部。`AgentRunPanel` 是当前 assistant 消息内部的运行投影，不得再呈现为第二个会话框、嵌套聊天面板或带独立滚动条的卡片。每个 turn 的默认层级固定为“用户请求 -> assistant 正文 -> 当前动作/折叠活动摘要 -> 必要交互”；provider 名称、上下文 source/token、模型、Token、成本、文风规则命中、observability 和 workflow history 不得在发送后自动追加为同级大区块。文风结果只有在用户明确请求或需要决策时以内联摘要出现，详细数据继续留在专用审阅面或按需弹层。

## 5. Stage 5A：Context Runtime

### 5.1 上下文层次

每次模型轮次的输入由以下层组成，顺序固定并记录在 Context Snapshot：

1. Agent 系统规则和当前三轴模式。
2. 用户当前请求。
3. 当前 Conversation 的受限摘要和最近若干已完成 run。
4. 已批准且仍有效的 Plan Artifact 结论、未决问题和执行步骤。
5. 用户显式添加的 source refs。
6. 活动编辑器内容和当前选区，明确标记 `editor_buffer` 与 dirty 状态。
7. Agent 本次 run 实际读取的工具结果摘要。
8. 待审批 Change Set 的摘要；不把候选正文隐式塞回下一轮上下文。

文件正文仍然是不可信数据。所有文件内容以 data envelope 进入模型，文件中的“忽略规则”“扩大权限”“写入其他路径”等文本永远不能改变系统规则。

### 5.2 写作模式

写作模式的默认上下文为：

- 当前章节全文或当前选区；
- Story Bible 索引摘要；
- 用户显式引用的人物、世界观、时间线或其他资产；
- 模型通过只读工具实际读取的相关章节和设定；
- 与当前目标直接相关的 context trace。

写作模式不自动预读整部小说。读取范围、source checksum、dirty 状态和排除原因都写入 Context Snapshot。普通项目文件只有在用户明确引用或模型给出可审计理由时才读取。

### 5.3 通用文件模式

通用文件模式的默认上下文为：

- 当前普通文本文件和当前选区；
- 同目录文件名摘要；
- 用户显式引用的项目内文本；
- 与当前文件相关的工具结果。

通用文件模式不自动注入 Story Bible、人物设定或其他章节正文。用户请求转向剧情分析时，UI 建议切换写作模式；系统不能静默扩大上下文工具集。

### 5.4 显式引用

输入区提供引用入口和引用 chip，支持：

- `@章节`：按 chapter ID 绑定章节或段落范围；
- `@Story Bible`：按 asset ID 绑定人物、世界观、时间线等资产；
- `@文件`：绑定项目内允许的 UTF-8 文本；
- 当前编辑器选区：记录编辑器版本、范围、checksum 和 dirty 状态。

每个引用必须显示类型、名称、相对路径或稳定 ID、来源状态和移除按钮。引用不等于授权：它只能扩大本次上下文来源，不能扩大可用工具、项目根目录或写入策略。

`@章节` 和 `@Story Bible` 只在写作模式可选。用户在通用文件模式选择这类资产时，UI 先建议切换写作模式，不直接把资产注入当前 run。`@文件` 在两种上下文模式都可用，但仍受允许目录、文本类型和大小限制。

引用的 dirty 目标可以用于对话和规划，但不能直接生成对该文件可应用的 Change Set。用户保存并刷新上下文后，旧候选必须标记 stale。

引用在 run 创建前保存为 `ContextDraft`，而不是由 Renderer 传入正文。Renderer 只发送稳定 ref 和编辑器 selection revision；Application 通过 Repository/Editor port 解析内容、校验 Path Guard 并返回新的不可变 draft revision。命令为：

- `updateContextDraft(add_ref)`
- `updateContextDraft(remove_ref)`
- `updateContextDraft(set_selection)`
- `refreshContextDraft`

命令都携带 `commandId + expectedDraftRevision`。`startRun` 绑定 `contextDraftId + revision + checksum`；Application 在创建 Context Snapshot 前重新解析引用并拒绝 stale draft。相同 ref 重复添加只返回首次回执，不重复占用预算。

### 5.5 Provider-aware 预算

每个 model profile 必须把 provider 能力规范化为“输入与最大输出共享的总窗口” `contextWindow`，同时记录 `maxOutputTokens` 和能力来源。provider 只公布输入上限、未公布窗口或语义不明确时，profile 必须显式配置；否则 capability preflight 阻止 Agent run，不猜测窗口大小。

每个 run 创建时从规范化的 capability snapshot 获取模型窗口，并计算：

```text
safeInputBudget = contextWindow - outputReserve - toolReserve - systemReserve
```

默认保留策略：

- `outputReserve`：优先使用 model profile 声明的最大输出；缺失时使用 `min(16K, max(4K, floor(contextWindow * 15%)))`；
- `toolReserve`：由 Tool Registry 按当前可见工具 schema 和最大结果摘要计算，不能是 UI 常量；
- `systemReserve`：由版本化 system guidance 和错误恢复协议的实际 token 计量得出。

任一保留项变化都重新计算预算。`requiredContextTokens` 由上下文模式和显式引用预算计算，最低为 8K；若 `safeInputBudget < requiredContextTokens`，provider capability preflight 直接阻止 run，而不是产生负数或依赖压缩强行启动。所有减法使用非负安全整数并在 DTO 验证阶段拒绝溢出、NaN 和负值。

模型窗口、保留预算、当前输入预算、精度来源和最后计算时间写入 snapshot。切换 provider/model 必须重新计算，不能复用旧模型的剩余百分比。

计量优先级：provider usage > provider 对应 tokenizer > 统一估算器。无法计量时显示“无法精确估算”，但仍按字符/字节上限执行安全裁剪。

### 5.6 手动与自动压缩

手动压缩入口位于 Agent composer 的上下文状态弹层中，按钮名为“压缩上下文”。点击后直接进入短暂的 `context_compacting` 状态，不再弹出重复确认；用户可先通过“查看来源”检查将参与压缩的范围。压缩不与普通模型轮次并行，也不产生文件副作用。

自动压缩规则：

- 使用量达到安全预算的 70%：显示黄色提醒；
- 使用量达到安全预算的 85%：自动触发一次压缩；
- 压缩后仍超过预算：只保留用户目标、计划结论、未决问题、source refs、工具摘要和待审批对象；
- 连续压缩仍无法满足预算：暂停到 `awaiting_context_refresh`，要求用户移除引用、切换模型或开始新 run；
- 不允许通过压缩删除审批、版本、错误或恢复事实。

压缩产生不可变 `ContextCompactionRevision`，包含原始 snapshot ID、保留 source refs、摘要 checksum、输入/输出 token、触发原因和压缩时间。事件流新增：

- `context_compaction_started`
- `context_compaction_completed`
- `context_compaction_failed`

重载后从 snapshot 和 compaction revision 恢复同一个模型输入边界；压缩失败不能让 run 永久停在 running。

压缩由独立 `Context Compactor` 执行两级处理：

1. 先确定性去重和裁剪已经结构化的旧工具结果、重复事件、过期 transient 文本和可由 source ref 重新读取的正文；
2. 如果仍然超过目标预算，再使用当前 provider/model 发起一次无工具的专用摘要请求，并把该请求的 usage 计入 run。

因此 `context_compacting` 不占用普通模型轮次，但第二级压缩可能占用一个 provider 请求。压缩请求不能调用工具、产生 Plan Artifact 或 Change Set。provider 不可用时只执行第一级确定性压缩；仍无法满足预算则进入 `awaiting_context_refresh`。用户停止压缩时保留上一个已提交的 Context Snapshot，不写入半成品 revision。

### 5.7 Context UI

Composer 不常驻显示精确 token 数字。正常状态只保留一个可访问的上下文入口；点击后显示：

```text
上下文 62K / 96K · 已估算       [查看来源] [压缩上下文]
```

默认折叠是为了避免把 token 仪表变成聊天主信息。只有使用量达到 70%、模型窗口未知、引用过期、存在 dirty source 或压缩失败时，composer 才主动显示“上下文较多”“上下文需刷新”等短提示；精确值、估算标记和保留预算继续留在弹层中。点击“查看来源”打开只读面板，列出每个 source 的类型、范围、checksum、token 占用、dirty/stale 状态和排除原因。

尚未启动 run 时，meter 根据当前草稿请求、所选 model profile、显式引用和活动编辑器预估；run 创建后改为服务端 `ContextBudgetSnapshot`，Renderer 不能继续使用自己的百分比作为事实源。

当前 run 的压缩事件显示在时间线中，但不播报每个 token。压缩不改变 Conversation 原始 transcript，也不删除历史 run。

## 6. Stage 5B：Permission and Plan Execution Control

### 6.1 权限摘要

Composer 左下角权限菜单提供“本次权限摘要”入口，开始前和运行中都可打开：

- 项目根目录的安全名称和相对范围；
- 当前上下文模式；
- 可读工具和只读范围；
- 可提案的文件类型/目录；
- 是否允许生成 Change Set；
- 写入策略，以及已经发生审批时的 approval source；run 创建前显示“尚未批准”，规划模式显示“不适用”；
- 明确列出不可用能力：Shell、Git、网络、删除、移动、重命名、创建目录。

摘要是事实 DTO，不由模型生成。它默认不占用消息流，也不能只放在设置页；用户在发送、等待审批和自动修改期间都能从权限入口打开查看。权限预检失败时，相关摘要以内联阻塞卡出现，而不是要求用户自己寻找诊断。

### 6.2 审批策略

执行模式提供两个互斥选项：

- `每次修改前确认`：每个 checkpoint 生成 Change Set，目标文件不变，用户在 Diff Review 中确认。
- `本次运行自动修改`：用户必须先看到风险说明并勾选确认；每个 Change Set 仍经过同一 diff、校验、快照、journal、Version Group 和 undo 管线。

自动修改只绑定当前 run。应用重启、创建新 run 或切换 Conversation 时，只把下一次 run 的 composer 草稿和风险确认复位为默认人工确认；已经创建并从 snapshot 恢复的活动 run 保留其持久化 `writePolicy` 和审批审计，不能因重载被静默降级或升级。模型文本、工具参数、文件正文、历史记录和项目偏好都不能改变它。该菜单在 UI 上扮演 Codex/Claude Code 类工具的权限选择器，但不会把 Stage 5 没有的 Shell、网络、Git 或项目外能力包装成“完全授权”。

权限摘要中的“可读/可提案/可写入”三个范围必须与 Tool Registry、Approval Gate 和 Version Group 的实际能力一致；任何不一致都阻止 run 创建。

### 6.3 现有 Plan Mode 合同保持不变

Stage 1 已实现 Novel Studio 的只读 Plan Mode：规划 run 使用读取工具调查上下文，通过 `finish_plan` 产出结构化 Plan Artifact，用户批准后创建新的 execution run 并绑定 `sourcePlanId/sourcePlanRevision`。Stage 5 不重建或替换这条链路。

以下既有合同保持不变并纳入 Stage 5 回归门：

- 只注册读取工具和 `finish_plan`、`request_user_input`；
- 不注册任何 `propose_*` 或 apply 工具；
- 计划结果写入系统元数据区，不写目标文件；
- blocking open question 未解决时，“按此方案执行”禁用。

用户点击“按此方案执行”时冻结 plan revision，创建新的 execution run，携带 `sourcePlanId` 和 `sourcePlanRevision`，并再次选择上下文模式和写入策略。批准计划不等于批准具体 Change Set：默认人工确认策略仍需用户审阅实际 diff；`user_preapproved_run` 仍生成、校验和记录同一个 Change Set/diff，但按当前 run 的显式预授权通过 Approval Gate。

### 6.4 Stage 5 新增：计划执行步骤与偏离

执行 run 为每个 Plan Artifact step 建立独立状态：

```text
pending -> running -> completed
                    -> blocked
                    -> skipped
```

每次状态变化写入事件并显示在时间线。完成摘要列出：按计划完成、轻微偏离、实质偏离、跳过、阻塞和验证结果。

允许的轻微偏离包括多读取一个相关 source、调整读取顺序和重试失败读取。

以下情况进入 `awaiting_plan_revision`：

- 新增计划之外的文件或章节；
- 改变成功标准、明确非目标或写入策略；
- 从局部修改扩大为跨章节重构；
- 跳过关键验证、版本快照或回滚步骤；
- 发现原计划依据错误，继续执行会产生明显不同的结果。

修订卡显示原计划、新发现、建议修订和受影响步骤。用户批准后生成新的不可变 Plan Artifact revision；拒绝后停止或执行仍然安全的部分。

### 6.5 计划执行 UI

计划详情和运行时间线共享同一 step ID。用户可看到：

- 当前正在执行的步骤；
- 已完成和验证方式；
- blocked 原因和需要的用户决策；
- 轻微偏离记录；
- 实质偏离修订卡；
- 最终 Change Set、Version Group 和 undo 状态。

不能用一段“计划已完成”的模型文本伪装真实执行进度。

## 7. Stage 5C：Diagnostics and Usage

### 7.1 统一错误对象

所有可见 Agent 错误都归一化为：

```text
errorId
runId
projectId
sequence
category
code
message
recoverability
suggestedAction
provider
model
redactedDetail
```

错误 ID 在 main/application 层生成。Renderer 只能消费 browser-safe DTO，不能导入 Node-only 错误工厂，也不能因为错误渲染失败而再次抛错。

### 7.2 错误分层

错误显示分为三层：

1. **步骤卡**：简短说明、影响范围、下一步按钮。
2. **运行摘要**：run 状态、是否写入、是否回滚、是否需要刷新上下文。
3. **内联技术详情**：只在用户点击“查看详情”后展开可复制 error ID、run ID、provider/model、事件序号、脱敏细节和重试/恢复记录。

Stage 5 不新增常驻诊断抽屉或“详细运行记录”面板。错误未发生时看不到技术诊断；错误发生后，步骤卡先提供可理解的原因与重试/停止操作，技术字段留在同一张卡的折叠区。

不同错误提供不同操作：

- provider 能力错误：更换模型或改为普通回答；
- provider 断流：重试当前步骤或从安全 checkpoint 恢复；
- context stale：刷新、排除 source 或取消；
- base hash 冲突：重新生成或重新对比；
- 写入 partial failure：进入 recovery review，不显示成功；
- IPC clone/renderer 错误：进入 failed/cancelled，恢复发送控制，不永久停留在 streaming。

所有 retry/resume 命令继续使用 `commandId + expectedRunRevision`，重复点击不能重复副作用。

### 7.3 Run 用量

每个 model round 记录：

- provider、model、projectId、conversationId、runId；
- input、output、cached、reasoning（provider 提供时）；
- total tokens 和精度来源；
- context window、safe input budget、压缩前后 token；
- 成本金额、货币、估算/真实/未知状态；
- 时间和终止原因。

API key、请求正文、完整文件内容和原始 provider 帧不写入用量记录。

### 7.4 设置页日用量

设置页增加“Agent 用量”视图，数据来自本机用户数据目录的脱敏聚合记录，不依赖项目是否打开。提供：

- 今日、近 7 天、近 30 天切换；
- 每日 token 折线/柱状图；
- 按 provider、model、项目筛选；
- 输入/输出/缓存 token 分项；
- 估算成本和“部分 provider 未返回价格”的提示；
- 点击某天查看 run 列表，但不显示请求正文或文件内容。

provider 返回实际 cost 时直接记录为 `actual`；否则才使用版本化本地 pricing registry 估算。估算记录保存 pricing version 和当时的单位价格快照。没有匹配价格时显示 `未知`，不得用旧价格静默推算；更新价格不会重写历史记录。不同货币分别汇总，不进行没有汇率来源的自动换算。

Stage 5 只定义 usage 数据保留，不顺带实现完整 run 清理：模型轮次明细默认保留 30 天，每日聚合保留 365 天；用户可清理 usage 记录。该操作不得删除 AgentRun、Change Set、Version Group、transaction journal 或 undo 所需数据。

日分桶在记录产生时使用系统 IANA 时区和当时的 UTC offset 计算 `localDate`，并把两者写入记录。之后修改系统时区不会重新归档历史日期；DST 重复小时按 UTC timestamp 去重并仍归入记录时的 localDate。测试通过注入 clock/timezone provider 固定边界。

### 7.5 单次 run 用量

Agent composer 的上下文入口只表达当前输入预算和是否需要处理，不显示单次 run 的累计 token、成本或逐轮明细。完整 usage 仍按同一 Usage DTO 记录并进入设置页聚合；错误诊断需要定位 provider/model 时可以引用相关 usage ID，但聊天主界面不提供独立 run 用量面板。

## 8. 数据合同

新增或扩展以下对象：

### 8.1 `AgentContextSnapshot` v1.1

Stage 5 把 snapshot schema 升级到 `1.1`。在现有字段上增加：

- `contextMode`、`contextDraftId/revision/checksum`；
- `budgetSnapshotId`、`activeCompactionId`；
- 有序 `layers[]`，取值为 `system/user_request/conversation_summary/plan/explicit_ref/editor/tool_result/change_set_summary`；
- 每个 source 的 `layer`、`sourceRevision`、`tokenCount`、`precision`、`state(active/stale/excluded)`、`exclusionReason` 和 `lastValidatedAt`。

旧 `1.0` snapshot 在读取时规范化为 `1.1` 内部对象：保留原 source/checksum/dirty/range，缺少的 token 标记 `unknown`，不批量改写旧文件。新 run 只写 `1.1`。

Snapshot 不复制完整项目正文。恢复时按稳定 ref 重新读取并比较 checksum；generated summary、tool summary 和 compaction summary 作为系统元数据单独持久化并由 ID 引用。

### 8.2 `ContextDraft`

包含 `contextDraftId`、`conversationId`、`projectId`、`contextMode`、不可变 `revision`、`refs[]`、selection revision、checksum 和 `updatedAt`。每个 ref 使用明确类型 `chapter/story_bible/project_file/editor_selection`，并携带稳定 ID、范围和用户可见 label；不携带 renderer 提供的文件正文。

`ContextDraft` 只负责引用集合，由 `AgentRunDraft` 引用。`AgentRunDraft` 包含 `runDraftId`、Conversation/project 关联、不可变 revision/checksum、用户请求、运行模式、上下文模式、写入策略与确认状态、model profile ID、可选推理度，以及 `contextDraftId/revision/checksum` 和最新预算预览 ID。所有 composer 变更先生成新的 run draft revision；`startRun` 只接收并重新验证这一整组 draft 事实，避免模式、模型、权限和上下文来自不同 revision。

### 8.3 `ContextBudgetSnapshot`

包含 `contextWindow`、`maxOutputTokens`、`contextWindowSemantics`、`safeInputBudget`、`requiredContextTokens`、`outputReserve`、`toolReserve`、`systemReserve`、`usedTokens`、`remainingTokens`、`precision`、`provider`、`model` 和 `calculatedAt`。`contextWindowSemantics` 在 Stage 5 固定为 `shared_input_output_window`；其他语义必须先由 model profile 规范化。

### 8.4 `ContextCompactionRevision`

包含 `compactionId`、`runId`、`sourceSnapshotId`、`revision`、`trigger(manual/automatic/recovery)`、`strategy(deterministic/model_assisted)`、`keptFacts`、`excludedSources`、`inputTokens`、`outputTokens`、`usageRecordId`、`precision`、`summaryChecksum`、`status` 和 `createdAt`。只有 `completed` revision 可成为 snapshot 的 `activeCompactionId`，记录不可原地修改。

### 8.5 `PermissionSummary`

包含 `permissionSummaryId`、`projectId`、`runDraftId`、可选 `runId`、`contextMode`、`writePolicy`、`toolRegistryRevision`、`rootFingerprint`、`readCapabilities[]`、`proposalCapabilities[]`、`forbiddenCapabilities[]`、checksum 和 `generatedAt`。

Permission Summary 由 Application 生成并签入 run 创建命令的 checksum。创建 run 时 Application 根据当前 Tool Registry、canonical root 和用户选择重新生成并逐字段比较；不接受 Renderer 传入的 capability arrays。`approvalSource` 不属于 run 创建前摘要，它只在 Change Set/Version Group 实际批准后记录为 `human_confirmation` 或 `user_preapproved_run`。

### 8.6 `PlanExecutionRecord`

包含 `planExecutionId`、`runId`、`planId/revision`、`handoffContextMode`、`handoffWritePolicy`、不可变 `revision` 和 `steps[]`。每个 step 包含稳定 `stepId`、`status`、`startedAt`、`completedAt`、`verification[]`、`deviationKind`、`blockedReason`、checkpoint ID 和关联事件序号。

从 plan 进入 execution 时选择上下文模式和写入策略属于合法 handoff，并固化在 revision 1，不算偏离。execution run 创建之后再新增目标、改变目标/成功标准/非目标/写入策略或跳过验证，才进入偏离判断。计划 revision 变化时旧 execution revision 和步骤状态保留，不覆盖旧审计。

### 8.7 `AgentRunErrorRecord`

包含 `errorId`、`projectId`、`runId` 或 `runDraftId`、可选 sequence/checkpoint/toolCall/planStep 绑定、category/code/message、recoverability、suggested actions、provider/model、`redactedDetail`、`recoveryState` 和时间。序列化后的 `redactedDetail` 上限为 8 KiB，超出时保存字段级截断摘要；默认不持久化 stack。run 创建后的错误必须有 runId；capability/permission preflight 错误使用 runDraftId，二者不能同时缺失。

run 错误保存到自己的系统目录；preflight 错误保存到项目的 `history/agent-diagnostics` 并受数量/保留上限约束。snapshot 增加 `activeErrorId` 和 `recoveryState(none/retryable/awaiting_context_refresh/recovery_review/terminal)`。重载后内联技术详情必须展示相同 error ID。transaction partial failure 继续以 recovery journal 为事实源，error record 只引用它，不复制或替代 journal。

### 8.8 `AgentUsageRecord`

保留现有 LLM Adapter 的 `usageStatus = actual/estimated/missing`，Stage 5 UI 映射为 `reported/estimated/unknown`，不直接修改旧 provider 合同。新增的 cached/reasoning token 为 optional，缺失时不从 total 反推。

每个完成的 model round 或 compaction request 写一个不可变记录，包含：

- `usageId = runId:roundId:finalSequence`、round ID 和最终事件 sequence；
- 时间、provider/model、项目/conversation/run 关联；
- token 分项、usageStatus 和 precision；
- `pricingVersion`、单位价格快照、计算出的 cost 和 cost status；
- context window、safe budget、压缩前后 token 和终止原因。

流式 partial usage 只更新当前 round 内存聚合和 `usage_updated` 事件；该事件仅驱动上下文阈值提醒或设置页数据，不在默认聊天区渲染 token/cost 区块。round 结束时才持久化最终记录。相同 usage ID 重放返回首次记录，不重复计费。记录不包含 API key、提示词、文件正文或隐藏推理。

### 8.9 `AgentRunSnapshot` v1.1

Stage 5 新 run 写 `AgentRunSnapshot schemaVersion: 1.1`，在现有字段上增加 `modelProfileId`、可选 `reasoningEffort`、`permissionSummaryId/checksum`、`contextBudgetSnapshotId`、`activeCompactionId`、`planExecutionId/revision`、`activeErrorId`、`recoveryState` 和累计 usage 摘要，并扩展 `status` 支持 `context_compacting` 与 `awaiting_plan_revision`。Renderer 只提交已配置 profile ID 和受支持的推理度枚举；Application 解析 provider/model、验证能力并生成 capability snapshot，不能接受 Renderer 伪造窗口或能力字段。

读取旧 `1.0` run 时缺失字段规范化为 null/none/unknown；旧终态和 Stage 2-4 的 pending Change Set、Version Group、undo 字段保持原义。新 Renderer 同时接受 1.0/1.1 DTO，内部只消费规范化后的 1.1 view model。

## 9. 事件与状态扩展

新事件只写 `AgentRunEvent schemaVersion: 1.1`。旧 `1.0` 事件在读取时规范化；Repository 不批量重写旧记录。Renderer 遇到未来未知的非终态事件时保留 sequence、显示“未识别步骤”并请求最新 snapshot，不能崩溃或猜测成功；未知终态必须视为合同错误并进入诊断状态。

| 事件 | 必需 detail | snapshot/state 结果 |
| --- | --- | --- |
| `context_compaction_started` | compactionId、sourceSnapshotId、trigger、strategy | `context_compacting` |
| `context_compaction_completed` | compactionId、revision、budgetSnapshotId、summaryChecksum、usageRecordId | 返回原 model 状态，更新 activeCompactionId |
| `context_compaction_failed` | compactionId、errorId、fallbackResult | 恢复原 snapshot 或 `awaiting_context_refresh` |
| `permission_summary_ready` | permissionSummaryId、checksum、toolRegistryRevision | 不改变 run 状态 |
| `plan_step_started` | planExecutionId、stepId、checkpointId | 对应 step=`running` |
| `plan_step_completed` | planExecutionId、stepId、verification[] | 对应 step=`completed` |
| `plan_step_blocked` | planExecutionId、stepId、errorId/reason | 对应 step=`blocked` |
| `plan_step_skipped` | planExecutionId、stepId、reason | 对应 step=`skipped` |
| `plan_deviation_recorded` | planExecutionId、stepId、kind、summary | 轻微偏离不暂停 |
| `plan_revision_requested` | requestId、planId/revision、affectedStepIds、discovery、proposal | `awaiting_plan_revision` |
| `error_recorded` | errorId、code、recoverability、recoveryState | 更新 activeErrorId |
| `usage_updated` | roundId、partial token、usageStatus | 不持久化最终 usage 前只更新内存聚合、上下文提醒或设置页，不渲染默认聊天区块 |

所有 detail 使用独立 JSON Schema 和大小上限，不使用任意 `JsonObject` 作为无约束协议。任何新事件都必须先持久化，再发送到 Renderer；迟发事件按 run generation token 丢弃。终态仍只有既有四种 `run_*` 事件。

状态机新增两个状态：

- `context_compacting`：活动状态，可取消；取消后恢复最近已提交 snapshot。
- `awaiting_plan_revision`：持久化暂停状态，不保持 provider 连接，等待用户批准或拒绝计划修订。

Stage 5 命令新增或扩展：

- `compactContext`：携带 runId、commandId、expectedRunRevision、sourceSnapshotId 和 trigger=`manual`；重复命令返回首次 receipt。
- `decidePlanRevision`：携带 requestId、planId/revision、decision 和 expectedRunRevision。
- `retryRunTarget`：替代含义模糊的“重试最后一步”，明确携带 errorId 和目标 `{ kind: model_round/tool_call/checkpoint/plan_step, id }`；Application 校验目标仍是当前 active error 的可恢复对象。
- `copyDiagnostic` 不经过 IPC 读取敏感记录；Renderer 只复制 snapshot 已带的脱敏 Diagnostic DTO。

旧 `retryStep` IPC 在一个兼容周期内映射到当前 `activeErrorId` 的默认 target；若无法唯一确定则拒绝并提示刷新，不猜测 last failed call。

## 10. 安全与隐私

- Context Snapshot、Plan Artifact、Change Set 和错误继续位于 canonical project root 的 `history/**`。usage 是唯一允许写入用户数据目录的 Stage 5 运行记录，用于跨项目设置页聚合；它只保存稳定 project ID，不保存项目绝对路径、API key 或正文。
- 压缩摘要只使用已授权的当前 run 上下文，不能跨 Conversation 混入其他项目内容。
- 权限摘要不能由模型或文件文本生成；UI 展示必须来自主进程 DTO。
- 成本图表默认显示本地聚合，允许用户清理 usage 明细，但不能清理仍支持恢复的版本/journal 数据。
- 诊断复制功能只复制脱敏摘要；原始 provider 帧始终折叠并有敏感字段清理。
- 自动压缩、重试、恢复、计划修订和自动修改都必须具备 command idempotency。

## 11. 验收策略

### 11.1 Context Runtime

- 写作/通用文件模式产生不同且可审计的 source refs 与工具清单。
- `@章节`、`@Story Bible`、`@文件`、选区引用可以添加、移除和刷新；dirty source 不能直接产生可应用 Change Set。
- 不同 context window 得到不同 safe input budget；切换 model 后重新计算。
- reported/estimated/unknown 三种计量状态显示正确。
- 手动压缩产生新 revision；自动阈值触发一次且不删除审计事实。
- 压缩失败、重载和取消都不会让 run 永久停在 running。
- Renderer 重载后 meter、引用、压缩 revision 与 snapshot 一致。

### 11.2 Permission and Plan Execution Control

- 规划模式永远看不到 propose/apply 工具和自动修改策略。
- 权限摘要与 Tool Registry、Approval Gate、Version Group 实际能力一致。
- 自动修改只能由当前 run 的用户命令授权，模型输出和文件内容不能改变策略。
- Plan Artifact 的 blocking question 会阻止执行。
- 执行步骤按真实事件更新，轻微偏离记录，实质偏离进入 plan revision 审批。
- plan -> execution handoff 中首次选择上下文模式和写入策略不会产生 deviation；execution run 创建后再次修改才会被拒绝或进入修订流程。
- 计划批准不等于批准具体 Change Set；人工策略仍需确认，预授权策略仍完整生成/校验/记录 diff 后自动通过 Approval Gate。

### 11.3 Diagnostics and Usage

- 每个错误都能在有限时间内进入 failed/cancelled/recovery 状态，并可复制 error ID。
- retry/resume/refresh 命令幂等，错误处理本身不产生二次异常。
- 后台 run usage 与设置页聚合使用同一 DTO；聊天主界面不常驻显示逐轮 token 或成本，每日图表按本地时区稳定分桶。
- 真实 usage、估算 usage 和未知 cost 不混淆；更新 pricing registry 不改历史记录。
- usage 记录不包含 API key、请求正文、文件正文、隐藏推理或未脱敏 provider 帧。

### 11.4 Conversation and Composer UI

- 中央主编辑区保留文档、计划详情和 Diff Review，右侧 Agent Conversation 是唯一日常会话入口。
- 可见工作区恰好存在一个 `Agent 请求` textbox 和一个发送/停止控件；`AgentRunPanel` 与 legacy AI workflow 都不能再渲染第二套 composer。
- 运行/上下文模式只通过 composer 左下角的 `执行 · 写作` 紧凑触发器展开；默认视图不存在输入框上方的常驻“规划/执行”和“写作/通用文件”控件组。
- 模式弹层分组显示两个正交维度，支持键盘打开、移动、选择和 Escape 关闭；planning 明确标注只读且隐藏修改权限，execution 才显示审批策略。
- 当前 run 的 assistant 文本和事件只出现一次；完成 run 固化为 Conversation turn 后不与运行面板重复。
- Composer 左下角提供引用、运行/上下文模式和修改权限；planning 隐藏修改权限并保持只读。
- Composer 右下角的模型与推理度位于发送按钮左侧；不支持推理度的 model 不显示伪选项，切换选择会重新计算 capability 和上下文预算。
- 默认消息流不显示模型、token、成本、context trace、workflow history 或完整工具历史大块内容。
- 发送一条消息后不会自动追加文风规则、上下文、模型、Token、成本、观测和运行历史卡；非阻塞事实只能进入一个折叠活动摘要或按需弹层。
- 当前工具动作展开，完成动作聚合为可键盘展开的单行摘要；问题、计划审批、上下文过期、Change Set、错误和 recovery 仍以内联卡片展示。
- 错误技术详情默认折叠；后台 run/event/usage 持久化不依赖用户是否展开。
- 会话正文与 composer 共用一个外层纵向布局；运行投影不能形成第二个会话边框或嵌套滚动区，composer 在滚动内容下方保持可达。
- 窄侧栏中模式、权限、模型和推理度不与发送按钮重叠，最长标签能够换行或合并为紧凑入口。

### 11.5 核心合同矩阵

| 场景 | 关键事件顺序 | 最终状态 | 必须持久化 |
| --- | --- | --- | --- |
| 手动压缩成功 | compaction_started -> usage_updated* -> compaction_completed | 返回压缩前活动/暂停状态 | compaction revision、budget snapshot、final usage |
| 自动压缩后仍超限 | compaction_started -> compaction_completed/failed -> context_stale | awaiting_context_refresh | 已完成 revision 或 error record |
| 压缩中停止 | compaction_started -> run_cancelled | cancelled | 上一个 committed snapshot、cancel receipt |
| 权限摘要过期 | permission_summary_ready 后 registry/root revision 变化 | run 不创建 | rejected command receipt、error record |
| 计划轻微偏离 | plan_step_started -> deviation_recorded -> plan_step_completed | execution 继续 | execution revision、deviation |
| 计划实质偏离 | plan_step_started -> plan_revision_requested | awaiting_plan_revision | revision request、受影响步骤 |
| 可重试工具错误 | tool_failed -> error_recorded -> tool_retry_requested | 原 run 恢复 | error record、retry receipt、目标 ID |
| partial failure | write_failed -> error_recorded -> run_failed | failed/recovery_review | transaction journal、error reference |
| provider usage 缺失 | assistant/tool 事件 -> usage_updated(unknown) | 不受影响 | final usageStatus=missing、cost=unknown |

`usage_updated*` 表示 provider 支持流式 usage 时可出现零到多次；最终持久化记录仍只能有一个。

## 12. 交付顺序与门禁

### Stage 5.0 UI Baseline Gate

- 中央编辑区保留文档、计划和 Diff Review，右侧 Agent Conversation 成为唯一日常会话入口。
- 可见工作区只有一个 Agent textbox 和一个发送/停止控件；active run 与 Conversation turn 不重复投影。
- composer 左下角通过一个 `执行 · 写作` 弹层触发器切换规划/执行和写作/通用文件；输入框上方没有常驻模式控件组，planning 隐藏审批策略。
- 当前工具动作展开，完成活动默认折叠；发送后不自动堆叠文风、上下文、模型、token、成本、observability 或 run-history 区块。
- 右侧会话只有一个滚动表面；当前 run 以内联 assistant 投影出现，不形成第二个会话框或独立 composer。
- 该门禁必须先通过，Stage 5A 的引用、上下文、模型和推理度控件才能接入 composer。

### Stage 5A Gate

- Context Snapshot、ContextBudgetSnapshot、ContextCompactionRevision 合同测试通过。
- 写作/通用文件、显式引用、dirty/stale、手动压缩、自动压缩和重载恢复测试通过。
- 真实 Electron Playwright 覆盖添加/移除引用、预算 meter、手动压缩和自动压缩恢复。
- `npm run typecheck`、`npm run build` 和 Context Runtime focused tests 通过。

### Stage 5B Gate

- Permission Summary、三轴模式、既有 Plan Mode 回归、执行步骤、偏离和权限隔离测试通过。
- 真实 Electron Playwright 覆盖右侧单一 composer、规划、执行、计划修订、自动修改授权、权限摘要、模型/推理度选择和 plan-step 状态。
- Stage 2-4 的写入、undo、Conversation 和项目隔离回归通过。

### Stage 5C Gate

- 统一错误 DTO、retry/resume、诊断复制、usage 聚合和 pricing registry 测试通过。
- 设置页日用量图覆盖空数据、估算数据、未知成本、本地时区与夏令时边界和多 provider。
- 真实 Electron Playwright 覆盖内联错误详情、复制 error ID、重试/恢复、按需上下文状态和设置页用量图，并断言聊天主界面没有常驻 token、成本或 run-history 区块。
- 完整 `npm test`、`npm run build`、`npm run package:check`、现有四组 Agent Electron E2E 和 Stage 5 专项 E2E 通过，并连续重复一次以检测时序不稳定。

## 13. 明确不改变的合同

- Stage 2-3 的 Change Set、Approval Gate、Version Group、transaction journal、recovery 和 undo 不被上下文压缩绕过。
- Stage 4 的 Conversation 只提供会话聚合，不改变 run、权限、计划、写入和撤销边界。
- Renderer 仍然是事件消费者，不控制 Agent loop，不直接访问文件系统。
- 所有文件访问继续绑定 canonical project root，并在读取、审批预检和最终写入时复检路径与 reparse 状态。
- 模型不能通过上下文内容、工具参数、计划文本、错误恢复或摘要改变工具权限和写入策略。

## 14. 自审结论

- 本方案覆盖上下文模式、上下文压缩、权限/审批、现有 Plan Mode 的执行增强、错误处理和 Token 用量六类需求。
- “上下文大小”同时定义为当前输入预算和 provider usage；两者不会混为一个不准确的百分比。
- “自动执行”只改变当前 execution run 的审批来源，不改变安全能力边界。
- Stage 1 的规划模式继续作为协调器级只读状态；Stage 5 只扩展新 execution run 对冻结 plan revision 的步骤跟踪和偏离控制。
- 成本统计允许未知和估算，不假装提供供应商真实账单。
- Context Snapshot/Event v1.1、旧 v1.0 读取兼容、引用 draft、权限 checksum、错误持久化和 usage 幂等键均有明确合同。
- plan -> execution 的合法 handoff 与 execution 期间实质偏离已分开定义。
- 右侧 Agent Conversation 是唯一会话入口；规划/执行与写作/通用文件通过 composer 左下角的单一分组弹层切换，权限位于同一左侧工具区，模型/推理度位于发送按钮左侧，运行事实按需折叠且不再常驻 token、成本或运行历史。
- Stage 5A、5B、5C 可以独立验收，任何一个 gate 失败都不能宣传 Stage 5 完成。
- 文档没有定义 Stage 6，也不把 P2 能力偷偷纳入 Stage 5。
