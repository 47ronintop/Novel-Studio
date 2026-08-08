# Novel Studio 会话式审稿中心 V1 设计

**日期：** 2026-08-08

**状态：** Proposed

**前置设计：**

- `docs/superpowers/specs/2026-07-12-agentic-writing-loop-design.md`
- `docs/superpowers/specs/2026-07-31-story-bible-maturity-design.md`
- `docs/superpowers/specs/2026-08-02-agent-completion-and-system-guidance-v3-design.md`

**实施约束：** 当前 Agent 完善计划尚未结束。本文是后续产品扩展，不修改 B7/B8/B9 的完成定义；Reviewer 生产代码只能在共享 Agent Runtime、Composer 和 Main composition 热点稳定并提交后开始。

**范围：** 交付当前章节和当前选区的只读编辑审稿；右侧会话显示紧凑总览，完整详情复用中央 review 区，并可跳回编辑器；用户选择问题后，另行生成可审查的修改 diff。V1 不建设多 Reviewer、自定义 Studio Workflow 执行或全书级自动审稿。

---

## 1. 结论

Reviewer V1 使用一个 Application-owned `EditorialReviewSession` 和一份持久化 `EditorialReviewArtifactV1`。以下入口必须落到同一个 session、artifact 和状态机：

1. 右侧 Agent 输入自然语言审稿请求。
2. Composer `+` 菜单选择“审稿当前章节”或“审稿当前选区”。
3. 审稿总览或中央详情中的“重新审稿”。

V1 不新增左侧 Activity，也不把结果放进“创作系统” Studio。Studio 继续管理配置资产；审稿结果属于当前写作会话和章节。

审稿运行始终只读：模型只能返回结构化问题，不能返回 patch、replacement 或工具调用。用户点击“按建议修改”后才启动独立 rewrite 流程，复用现有 AI 写作预览、diff、明确接受和保存协调链；不为 Reviewer 新建 apply backend。

## 2. 当前基线与复用边界

| 当前能力                              | 现状                                                          | V1 决定                                                                 |
| ------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Studio 默认审稿 Prompt/Agent/Workflow | 可编辑、校验、保存和恢复，但无 production run API             | 不执行任意 Studio JSON；不以配置资产授予工具或 system authority         |
| 通用 Writing Agent                    | 能读取章节/Story Bible，并通过提案工具修改                    | 只在后续 rewrite 阶段复用；Reviewer 阶段不公开写工具                    |
| Story Analysis                        | 已有章后事实提取、资料建议、一致性问题、历史和 stale 检查     | 只引用相同章节 checksum 的最新结果，不复制或重跑其模型逻辑              |
| 文风 2.0                              | 已有 diff-aware UTF-16 finding 和 advisory UI                 | 用同一 evaluator 做静态 observation 映射，不改变其 generation diff 合同 |
| Composer quick actions                | Renderer 已生成“改写当前选区 / 检查文风与一致性”，UI 尚未渲染 | 放入现有 `+` popover；`review_style` 改接同一个只读 Reviewer session    |
| AI 写作 selection/chapter preview     | 已有候选正文、diff、接受/拒绝和 editor session apply          | 只在显式“生成修改”后复用；Reviewer issue 的接受不等于接受正文 diff      |

不得新建第二套通用 Agent runtime、模型设置、权限系统、事务容器或编辑器保存协调器。

## 3. V1 目标与非目标

### 3.1 目标

- 审稿范围固定为 `current_chapter | current_selection`。
- 编辑审稿覆盖情节因果、人物动机/行为、节奏、对白和表达清晰度。
- 文风问题来自现有 Writing Style 2.0 evaluator 的 Reviewer observation adapter；不把静态正文问题称为“本次新增”。
- 资料连续性引用现有 Story Analysis 的同基线结果；没有新鲜结果时明确显示“资料一致性尚未分析”。
- 每个问题包含可验证的 UTF-16 正文范围、严重度、置信度、说明和修改方向。
- 每次运行保存可查看的“审稿依据”manifest，明确带入了哪些正文、故事资料及资料覆盖度。
- 会话中可追问、接受方向、忽略、标记已解决、重新审稿或生成修改。
- 点击问题使用现有编辑器 selection/scroll 能力定位正文。
- 结果绑定章节 checksum；正文变化后自动进入 `stale`，禁止直接生成修改。
- 审稿和 rewrite 的模型用量、取消、错误与历史均可追踪。

### 3.2 非目标

- 全书级人物弧线、跨卷节奏和全项目批量改写。
- 多 Reviewer 投票、子 Agent、并行模型评审或自动裁决。
- 执行任意 `agent_reviewer_default.json` 或 `wf_review_chapter.json`。
- Reviewer 自动修改正文或 Story Bible。
- Reviewer 输出可直接应用的 patch/replacement。
- 新建左侧“审稿”Activity、独立全屏工作台或第二套会话。
- V1 常驻渲染所有问题的 CodeMirror 波浪线、gutter marker 或 textarea decoration。
- 新建审稿专用模型设置、权限设置或独立计费系统。
- 把整部小说正文或整个 Story Bible 无差别塞入一次模型请求。

## 4. 信息架构与交互

### 4.1 三层展示

1. **编辑器：** 保持正文为主，只显示一个紧凑的审稿状态/count；V1 不做全量常驻标记。
2. **右侧 Agent：** 只显示运行状态、严重度/count、最多 3 个 open issue 摘要，以及“查看完整审稿/重新审稿”。这里继续以会话为主，不放完整 evidence、历史和全部动作。
3. **中央 review 区：** 复用现有 `mainReview` surface 显示完整问题列表、证据、筛选、历史和动作；不新增左侧 Activity 或独立页面。

`EditorialReviewPanel` 作为新的 `AgentConversationMainReview` variant 在中央渲染。点击右侧摘要或编辑器 count 打开中央详情；在详情中点击“查看原文”会关闭中央 review、回到编辑器并选择/滚动到对应 UTF-16 range。编辑器正文变化后，右侧摘要和中央详情都显示“正文已变化，请重新审稿”。

“查看原文”由 app-owned `closeMainReviewAndLocateEvidence` 协调：先清除 current/pending main review，再等待同 chapter/checksum 的 editor surface 完成注册，最后调用现有 selection/scroll callback。Panel 不直接访问编辑器 DOM；若返回期间章节或 checksum 已变化，则丢弃待定位 range 并显示 stale，不在错误正文上选择。

### 4.2 Composer `+` 菜单

复用现有 `AgentPopover`。面板固定宽度和最大高度，内容区滚动；不通过缩小字体容纳更多操作。V1 使用现有 flat panel 中的三个分组，不增加 submenu/back 状态机：

```text
 添加
├─ 快捷操作
│  ├─ 审稿当前章节
│  ├─ 审稿当前选区（有选区时显示）
│  ├─ 检查文风与一致性
│  └─ 改写当前选区（有选区时显示）
├─ 上下文引用
└─ 执行与审批
```

- 标签保持正常可读字号；较长说明使用次级文本。
- 点击快捷操作只冻结 action/scope 并显示可移除 chip，不立即产生模型费用。
- `检查文风与一致性` 是 Reviewer focus preset：有选区时审查选区，否则审查当前章节；不得再进入 selection rewrite preview。
- 用户可以继续输入重点要求，按发送后才启动。
- 列表超过可视高度时滚动；不让 popover 随项目引用数量无限增长。
- 复用现有 Escape、焦点返回、键盘 roving 和 viewport positioning。

### 4.3 自然语言调用

强审稿词包括“审稿、审阅、校对、点评当前章”和明确的 review 请求。快捷操作在发送前显示可移除的 `审稿 · 当前章节/选区` task chip；纯自然语言请求在发送时分类，并在会话 run header 显示相同标签，不引入实时输入分类状态。

V1 使用独立、窄范围的 Reviewer request classifier，并在通用 `WritingTaskIntent@1.0` 之前运行；不向现有 Writing Task Intent 枚举追加新 kind，也不改变 Writing Generation Guidance 2.0 的生成判定。classifier 未命中时，原请求按现有通用会话路径继续处理。

普通“分析、讨论、为什么”仍是通用 `analysis`，不能因为存在当前章节就静默升级为 Reviewer。包含“审稿并修改”的请求也先只运行审稿；完成后提供“按建议生成修改”，不得在一个隐式步骤中写正文。

### 4.4 Issue 动作语义

Reviewer issue 支持：

- `查看原文`：定位编辑器。
- `解释`：在当前会话追问，不改变 issue。
- `接受方向`：记录作者认可该问题，不改变正文。
- `忽略`：记录作者决定，不改变正文。
- `标记已解决`：只改变 review disposition。
- `按建议生成修改`：启动新的 rewrite proposal。
- `重新审稿`：对新基线生成新 artifact，旧 artifact 保留但 stale。

只有 rewrite diff 上出现“应用修改”；Reviewer issue 卡不能出现会直接写正文的“应用”按钮。

## 5. 合同

### 5.1 Invocation

```ts
interface EditorialReviewInvocationV1 {
  schemaVersion: "1.0";
  scope: "current_chapter" | "current_selection";
  source: "composer_action" | "bounded_request_classifier" | "reanalyze";
  focus: readonly (
    "plot_logic" | "character" | "pacing" | "dialogue" | "clarity" | "style" | "continuity"
  )[];
  userInstruction: string;
}
```

- `current_selection` 必须有非空 UTF-16 range。
- `focus` 去重并按固定顺序 canonicalize。
- “审稿当前章节/选区”和未限定重点的自然语言审稿默认包含全部七类 focus，其中 `style` 即“文风与 AI 痕迹”；`检查文风与一致性` 固定为 `style + continuity`。只有用户明确要求“只看……”时才缩小 focus。
- 快捷操作是 app-owned 信号；项目正文、Prompt 或模型输出不能创建 invocation。

### 5.2 Frozen baseline

```ts
interface EditorialReviewBaselineV1 {
  projectId: string;
  chapterId: string;
  chapterRevision: number;
  chapterChecksum: string;
  bodyUtf16Length: number;
  selection: null | { startOffset: number; endOffset: number };
}
```

V1 只审查已保存正文。编辑器 dirty 时先复用现有“保存并继续 / 取消”守门；不新增 dirty buffer authority。selection 必须在保存后的同一正文内重新校验。

### 5.3 审稿判定准则

Reviewer 使用 app-owned、版本化的 `editorial-review-rubric@1`；项目 Prompt、Story Bible 和用户 instruction 可以限定关注点，但不能改写 rubric、输出合同或只读边界。V1 的判定范围固定为：

- `plot_logic`：本章内的因果断裂、前提缺失、铺垫/回收不成立、场景目标—冲突—结果不连贯。
- `character`：人物动机、已知状态、关系、POV 和行为之间的可定位矛盾；依赖资料时必须引用对应 basis。
- `pacing`：重复表达/事件、无推进段落、转折过急、信息密度失衡；只判断当前范围，不声称完成全书节奏评估。
- `dialogue`：说话人难辨、意图/潜台词缺失、说明腔、回应关系断裂；不以单一审美强制所有人物同一种说话方式。
- `clarity`：指代不明、时空关系混乱、动作主体缺失或句意歧义。
- `style`（UI 标签“文风与 AI 痕迹”）：只由 Writing Style 2.0 local evaluator 产生，覆盖已资格化的模板化表达、机械情绪、堆叠比喻等规则；editorial model 不能自行发明新的“文风规则”。
- `continuity`：editorial model 只能依据本次传入的 active Story Bible/outline/timeline basis 提出；fresh Story Analysis 可以作为独立来源补充。

Active Story Bible 的人物/世界/时间线记录是“当前资料基线”；outline 表示创作意图，不是正文必须服从的事实。偏离 outline 只能作为 `notice/warning` 提醒作者确认，不能单凭偏离判定为 `critical`。只有存在具体正文 evidence 和可说明的影响时才生成 issue；纯偏好、无法定位或依据不足的意见不进入 artifact。用户仍可选择忽略问题或反向更新故事资料。

artifact 保存 rubric version/checksum，中央“审稿依据”同时显示 rubric、focus 和实际资料来源，确保用户知道结果是按什么标准得出的。

### 5.4 审稿依据与上下文预算

Reviewer 不只“凭当前文字猜”。Main-owned `EditorialReviewContextBuilder` 在每次运行冻结一份 `EditorialReviewContextManifestV1`，Renderer 不能提交或扩充模型上下文：

```ts
interface EditorialReviewContextManifestV1 {
  contextSnapshotId: string;
  contextChecksum: string;
  contextBudgetSnapshotId: string;
  targetRange: { startOffset: number; endOffset: number };
  localContextRange: { startOffset: number; endOffset: number };
  storyCoverage: "sufficient" | "partial" | "unavailable";
  basisCatalog: readonly EditorialReviewBasisRefV1[];
  omittedStoryCandidateCount: number;
}

interface EditorialReviewBasisRefV1 {
  refId: string;
  kind:
    | "chapter_body"
    | "chapter_local_context"
    | "outline_entry"
    | "story_bible_asset"
    | "timeline_event"
    | "style_rule"
    | "story_analysis_issue";
  label: string;
  revision: string;
  checksum: string;
  delivery: "model_input" | "local_evaluator" | "post_review_projection";
}
```

上下文按以下规则构建：

1. **正文是必带依据。** 当前章节审稿带入完整已保存章节，且作为 atomic required source；若完整章节放不进当前模型的 safe input budget，则 fail closed，并建议改审选区或换更大上下文模型。当前选区审稿使用 Reviewer 新增的 Main-owned paragraph-window helper，带入选区及前后各最多 2,000 UTF-16 code units 的段落边界局部上下文；issue evidence 仍必须完全位于选区内。
2. **故事资料会带，但不带整库。** Builder 只复用 Story Analysis 已有的 Story Bible catalog/read ports，不能调用其会读取 `active/draft/archived` 全目录资产的 `loadStoryAnalysisContext/recallReasons`。Builder 自己以 `statuses: ["active"]` 列 catalog，只读取确定候选；`draft/archived/deleted` 不作为审稿事实。优先级固定为 Composer 明确引用的 asset → 当前章 frontmatter/大纲显式 ID → active catalog title 命中 → 已读取资料的一跳 relation。V1 不承诺 alias 全库召回，因为现有 catalog 不提供 alias 索引。
3. **结构资料做字段级投影。** `outline_entry` 和 `timeline_event` 不是独立 asset：Main 分别读取并 schema-validate `outline_main`、`timeline_main`，再从 parent singleton 投影条目。synthetic ref 同时绑定 parent asset ID/checksum、entry ID 和 entry revision。最多带当前章及相邻前/后章共 3 个 outline entry、与当前章/已召回资料关联的最多 8 个 timeline event，以及最多 16 个角色、地点、阵营、规则、术语、物品、lore 或伏笔 asset。相邻章节只带 outline entry，不带相邻章节原文；这保持 V1 的当前章节边界。
4. **预算由现有 provider-aware contract 计算。** Reviewer 复用同一 tokenizer、`calculateContextBudget` 和 deterministic packer，但 3/8/16 item cap 与 Story Bible aggregate quota 由 builder 在调用 packer 前先执行；现有 packer 本身没有 story-source 分组额度。正文/选区、用户本次要求是 required；用户明确引用的 active Story Bible asset 是 pinned；自动召回资料是 automatic。故事资料总额不得超过 `min(12_000 tokens, floor(safeInputBudget * 0.25), required sources 后的剩余预算)`。pinned source 计入 item/token cap，超限或放不下时 preflight 失败；automatic source 放不下时按稳定顺序省略并记录数量。
5. **不把旧模型文本当故事事实。** 既往会话 assistant 文本和普通 conversation summary 不进入 Reviewer 事实上下文；只带本次用户要求。fresh Story Analysis 也不再喂给 editorial model，而是在模型结果校验后作为独立 issue source 合并，避免模型输出互相背书。

`storyCoverage` 只描述本次召回候选是否全部装入，不表示“全书资料完整”。`partial/unavailable` 必须在 UI 的“审稿依据”中可见；没有故事资料依据时，Reviewer 不得宣称“与全书设定一致”。`delivery` 明确资料是否真的传给 editorial model：章节/Story Bible/outline/timeline 是 `model_input`，Style 规则是 `local_evaluator`，fresh Story Analysis 是 `post_review_projection`。任何 continuity/character 结论若依赖 Story Bible，模型候选必须返回已提供且 delivery 为 `model_input` 的 `basisRefIds`，Application 拒绝未知 ref；Style/Story Analysis issue 的 basis 由 Application 赋值，模型不能冒用。纯文本问题至少引用 chapter basis。中央详情按 delivery 分组显示资料名称和覆盖度，右侧总览只显示“资料充分/有限/不可用”徽标。

### 5.5 Artifact 与 issue

```ts
interface EditorialReviewArtifactV1 {
  schemaVersion: "1.0";
  /** 与现有 Workflow Run 使用同一 ID，不创建平行 run identity。 */
  reviewRunId: string;
  conversationId: string;
  baseline: EditorialReviewBaselineV1;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  model: { profileId: string; provider: string; modelName: string };
  rubric: { version: "editorial-review-rubric@1"; checksum: string };
  promptArtifactId: string;
  usageRecordId: string | null;
  contextManifest: EditorialReviewContextManifestV1;
  issues: readonly EditorialReviewIssueV1[];
  storyAnalysisRunRef: null | { workflowRunId: string; chapterChecksum: string };
  recordRevision: number;
  recordChecksum: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

interface EditorialReviewIssueV1 {
  issueId: string;
  source: "editorial_model" | "style_evaluator" | "story_analysis";
  category: "plot_logic" | "character" | "pacing" | "dialogue" | "clarity" | "style" | "continuity";
  severity: "notice" | "warning" | "critical";
  confidence: "low" | "medium" | "high";
  title: string;
  explanation: string;
  suggestion: string;
  evidence: readonly {
    startOffset: number;
    endOffset: number;
    excerpt: string;
  }[];
  basisRefIds: readonly string[];
  disposition: "open" | "accepted" | "ignored" | "resolved";
}
```

`recordChecksum` 按 canonical artifact fields 计算并排除自身；任何 status/disposition 更新都会递增 `recordRevision` 并生成新 checksum，handoff 必须绑定当前值。

模型只返回 `category/confidence/title/explanation/suggestion/evidence/basisRefIds` 候选。Application 将 basis IDs 解析到 artifact 的 frozen catalog，并生成 ID、source、severity、disposition 和时间字段。`editorial_model` 只允许 plot/character/pacing/dialogue/clarity/continuity，且其去重后的 basis IDs 必须非空、全部是 `delivery: "model_input"`，并至少包含当前 chapter basis；模型不能引用 Style/Story Analysis post-source。`style_evaluator` 只允许 style，`story_analysis` 只允许 continuity，二者的 basis 仅由 Application 赋值。未知 source-category pairing、basis/delivery、字段、无法锚定的 evidence、selection 越界、过量 issue/evidence 或任何 patch/replacement 字段均拒绝。

统一 artifact evidence 始终使用章节正文的绝对 UTF-16 `[startOffset, endOffset)`，且 `excerpt === body.slice(startOffset, endOffset)`。各来源先经过 effect-specific adapter，再进入同一 validator：

- `editorial_model`：候选 evidence 提供 exact excerpt 和可选 scope-local offset hint。hint 与 frozen scope 精确匹配时使用；否则只接受 scope 内唯一 exact match。选区结果加上 selection start 转成章节绝对 offset；多重或零匹配则丢弃该 issue。
- `style_evaluator`：以 `baselineText: ""`、`candidateText: targetText` 调用现有 evaluator 作为全量规则扫描，但 adapter 丢弃 `introduced/pre_existing` 和 `hitCount` 语义；使用 hit 的 matched range/exact `matchedText`，选区时平移到章节 offset。medium/high 默认展开，low 默认折叠，不修改 Style 2.0 的 generation diff API、规则或语料。
- `story_analysis`：只有同 chapter checksum、`completed` 且记录仍可读的 run 才 fresh；将其 code-point offset 在相同正文上转换为 UTF-16，再重新 slice 校验。selection review 只保留完全落在 frozen selection 内的 evidence。转换/校验失败的 evidence 不投影，不重跑 Story Analysis，也不写回其权威记录或 disposition。

冻结上限为每次模型最多 24 个 issue、最终 artifact 最多 48 个 issue、每个 issue 最多 4 个 evidence、exact excerpt 最多 512 UTF-16 code units。相同 source/category/range/title 的 issue 和相同 range evidence 去重；最终按 severity、正文范围、source、issue ID 稳定排序。

severity 映射由 Application 固定：editorial/style 的 low confidence 为 `notice`、medium/high 为 `warning`；Story Analysis 的 `conflict` 为 `critical`，其余 review issue 为 `warning`。Story Analysis 无可比 confidence 时固定投影为 `medium`，不能由 Renderer猜测。

## 6. 运行路径

```text
Composer action / bounded review request
  -> Main preflight：活动章节、保存守门、selection、model、预算
  -> EditorialReviewContextBuilder：冻结 baseline、依据 manifest、context snapshot/budget
  -> EditorialReviewSession
       -> app-owned system contract
       -> active chapter/selection + 最小 writing context
       -> 非流式 JSON model call
       -> strict candidate validator
       -> Writing Style 2.0 observation adapter
       -> optional fresh Story Analysis adapter/reference
  -> 复用 Workflow Run/Prompt Artifact/usage 存储并持久化 EditorialReviewArtifactV1
  -> 右侧 compact summary + 中央 mainReview 投影
  -> issue 点击时定位 editor range
```

Reviewer 不是 provider-visible tool，避免在 Agent 工具调用中嵌套另一轮隐藏模型执行。自然语言和快捷操作都在 run preflight 前由应用路由到 typed session。session 必须调用现有 model driver、Prompt Artifact、usage 和 cancellation ports；不得直接创建 provider client 或平行模型运行账本。

V1 的三个入口都属于当前会话，统一使用当前 Composer 选择的模型；“重新审稿”也读取该会话当前模型选择。Reviewer 不增加独立模型 profile。

## 7. Rewrite handoff

“按建议生成修改”创建新的、显式 body-generation 请求，包含：

- fresh review artifact ID/record checksum；
- 一个或多个已选 issue ID；
- 当前章节 fresh revision/checksum；
- 用户补充要求。

Application 重新读取当前正文并复验 record checksum、issue/evidence 和正文 baseline。artifact view 为 stale、issue 不存在、正文 checksum 变化或 selection 不再有效时拒绝 handoff，并要求重新审稿。模型生成的 title/explanation/suggestion 始终是 untrusted data，只能作为 rewrite 输入资料，不能成为 system authority、工具/能力请求或正文审批。

rewrite 复用现有 `AiWritingWorkflowSession` 章节/选区生成路径，输出候选正文和 diff；只有用户在现有 AI 写作 review 上明确接受后，才调用既有 editor session apply/save 协调。V1 不为 Reviewer 额外包装 Change Set，也不声称 legacy AI 写作 apply 已经过 Agent Approval Ledger/Version Group。Reviewer artifact 不能作为 apply capability 或 approval proof。

## 8. 历史、取消与 stale

- 复用现有项目 History/Workflow Run 存储模式，通过窄 `EditorialReviewHistoryPort` 读写；不新建第二个数据库或通用事件系统。
- `reviewRunId` 就是现有 Workflow Run ID，并引用 Prompt Artifact、usage、terminal/error/cancel evidence；每个 artifact 绑定 project、conversation、chapter 和 baseline checksum。
- queued/running/terminal status 与 issue disposition 通过 `recordRevision + recordChecksum` CAS 更新；completed issue 内容和 baseline 不可替换。
- 同章节正文 checksum 改变时只在 DTO/view 投影 `isStale: true`，不把 `stale` 写入 artifact status/disposition。stale 记录仍可查看，但 disposition transition 和 rewrite handoff 全部拒绝；只能重新审稿。
- 取消只终止 review model request，不影响正文、Story Bible 或其他 Agent run。
- 同一章节同一 conversation 只允许一个 active Reviewer run；重复启动返回稳定 conflict，新 run 使用新 Workflow Run ID，旧 run 保留在历史中。

## 9. 安全与 Prompt authority

- Reviewer 模型请求只包含 app-owned system contract 和明确标为 untrusted 的章节/上下文数据。
- Story Bible、outline、timeline 和用户 instruction 都是 untrusted context，不因进入 basis manifest 而成为 system authority。
- V1 不执行 Studio Agent/Workflow，也不把其 `status: active`、tools、schema ID 或 Prompt 当成 runtime authority。
- Reviewer 不公开 mutation tool catalog；模型输出没有 patch/replacement 槽位。
- 项目文本中的“忽略前述规则”“调用工具”等内容均是证据数据。
- Reviewer failure、malformed output、budget overflow 和模型未配置全部 fail closed，并保留可诊断错误。
- 接受/忽略/解决 issue 只写审稿历史状态；它们不是正文审批。
- Story Analysis 投影和 Reviewer disposition 绝不能写回 Story Analysis 权威记录。

## 10. 最小验收

Reviewer V1 只有在以下行为同时成立时才算完成：

1. `+` 菜单能选择章节/选区审稿，固定大小、键盘可用、内容可滚动。
2. 明确自然语言审稿请求进入同一 typed session；普通分析不误路由。
3. dirty chapter 先保存或取消；review artifact 绑定保存后的 checksum。
4. 审稿依据按固定召回/预算规则冻结并可查看；整库、相邻章节原文和旧 assistant 文本不会被隐式带入，资料覆盖不足会明确显示。
5. malformed、未知 basis、越界或带 patch 的模型输出被拒绝。
6. 文风 2.0 以静态 observation 语义复用；fresh Story Analysis 完成 code-point→UTF-16 校验，二者都不重复持久化权威记录。
7. 右侧显示紧凑总览，中央 review 显示完整结构化问题；“查看原文”能回到编辑器并定位 UTF-16 range。
8. Reviewer 卡没有直接写正文的“应用”操作。
9. 生成修改必须创建独立 AI 写作 rewrite diff，并经过现有明确接受和 editor session apply/save 链。
10. 正文变化后旧结果 stale，不能继续生成修改。
11. 当前 Agent 完善计划的 B7/B8/B9 测试与能力门禁不因 Reviewer 改动而降级。

## 11. 后续但不阻塞 V1

- 全书/卷级审稿和跨章节节奏、人物弧线分析。
- 常驻 CodeMirror 多问题 decorations 和 gutter markers。
- 多 Reviewer、模型对比或质量 owner 裁决。
- 将经过单独 authority 设计的 Studio reviewer preset 接入运行。
- 自动生成审稿报告、导出 PDF/Word 或编辑交付清单。
