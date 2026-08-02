# Story Bible 成熟化完善方案

**日期：** 2026-07-31

**状态：** Implemented（2026-08-02 补齐章后资料维护模式）

**前置设计：** `docs/superpowers/specs/2026-07-29-story-bible-focused-redesign-design.md`

**实施基线：** `9fe1d9d`

**范围：** 在 7.29 五类故事资料重设计已经完成的基础上，补齐长篇小说所需的数据合同、Agent 全量发现与安全 CRUD、章节完成后的资料更新建议，以及大项目下的可扩展性。不增加新的一级资料入口；AI 不得绕过作者选择的维护模式修改事实，安全自动更新仅应用作者预授权、可验证且可撤销的低风险建议。

---

## 1. 目标与结论

### 1.1 产品目标

Story Bible 应同时满足四个目标：

1. 五类资料能够持续承载完整长篇小说，而不是只保存摘要。
2. 作者和右侧 Agent 能发现并操作任意资料条目，不受项目规模和上下文目录截断影响。
3. 完成章节后，系统能主动发现应更新的资料；作者可以逐次审查确认，也可以显式预授权严格受限的安全自动更新。
4. UI、Agent、Repository、搜索和 Context 使用同一份数据合同，不允许出现“UI 能保存、Agent 能写入，但其他入口无法正确读取”的分叉。

### 1.2 已确认的一级信息架构

一级类目继续固定为：

1. 人物
2. 世界观
3. 大纲
4. 伏笔
5. 时间线

物品、人物关系、场景节拍和章节状态变化不新增一级入口：

- 关键物品作为 `world.item` 世界观子类型。
- 历史沿革、制度、风俗和体系背景作为 `world.lore` 世界观子类型。
- 人物关系使用跨资料的结构化关系。
- 场景与节拍放入章纲。
- 章节造成的状态变化记录在对应人物、世界资料和时间线事件中。

### 1.3 非目标

- 不建设自由画布、关系图谱编辑器或世界地图编辑器。
- 不在每次普通保存时启动模型分析。
- 不允许 Agent 把资料“删除”实现为物理删除；仅在作者确认 v1.0 懒升级后，允许同组事务在规范文件已安全创建的前提下移除已被替代的旧路径。
- 不把 AI 建议直接视为作者事实。
- 不要求打开旧项目时一次性迁移所有资料。

## 2. 实施前缺口（已关闭）

以下 12 项是实施基线 `9fe1d9d` 当时的成熟度缺口，用于保留设计决策的追溯依据；它们已由第 11 节批次 A–E 关闭，不是当前待办：

1. 人物、世界观、大纲和时间线的 `details` 只验证为任意 JSON 对象。
2. UI 保存路径存在业务校验，但 Agent 只经过通用 story asset schema，可能写入业务结构无效的数据。
3. Agent 的工作区目录最多提供 200 个条目，并且章节排在 Story Bible 之前；长篇项目可能看不到资料目录。
4. 创作项目的通用搜索会过滤受管 Story Bible 路径，不能补偿目录截断。
5. Agent 没有专用的 Story Bible 删除和恢复语义。
6. 章节保存不触发资料分析；人物、世界观、大纲和时间线没有章节后更新流程。
7. `relatedEntityIds` 是裸 ID 列表，没有关系类型、选择器和完整引用校验。
8. 大纲与时间线的固定单例 ID 只是 UI 约定，没有成为持久化合同。
9. 大纲章项、节拍和时间线事件没有独立 revision，无关子项修改也可能制造整份单例冲突。
10. `AgentContextSnapshot` 已记录 checksum、revision、token、截断和排除状态，但这些数据尚未形成作者可用的按需检查器；现有显式引用和 `excludedSources` 也没有统一表达召回原因、固定策略、项目默认和最终发送预览。
11. 现有 Version Group、transaction journal、recovery 和 undo 已能保护多文件写入，但尚未定义 Story Bible 语义一致性组如何映射到这条链路，以及如何生成面向字段 diff 的只读回执投影。
12. 旧数据宽松兼容与新数据严格写入尚未分开，继续允许任意字段会让 UI、Agent 和 Repository 再次分叉。

## 3. 设计原则

### 3.1 五类资料是作者控制的事实来源

- Story Bible 是作者确认或按其安全策略预授权写入的结构化事实；正文是证据来源，不因“写进正文”就自动成为客观事实。
- 分析必须区分客观叙述、人物对白、人物认知、传闻、模型推断和无法判断。人物说过一句话，只能直接证明“人物说过/相信过”，不能直接证明话中内容为真。
- AI 从正文提取出的观察和事实变更先进入建议队列；只有人工确认或通过安全自动策略并完成事务提交后，才进入正式 Story Bible Context。
- 发现正文与资料矛盾时生成一致性问题，由作者判断哪一方需要修正；系统不得静默以正文覆盖旧资料，也不得以旧资料否定正文。
- 大纲中的“计划”与正文中的“实际结果”必须分开保存，禁止 AI 用已写正文覆盖原计划。

### 3.2 自动分析，作者控制写入

- 系统可以自动启动只读分析。
- 模型只能返回结构化候选。
- Application 必须验证、去重并生成字段差异。
- 默认由作者确认后进入 Change Set 和 Repository。
- 作者显式开启安全自动更新后，只有完整一致性组内全部满足高置信度、客观叙述、证据/章节依赖、无开放冲突、非创建、非删除和路径白名单的建议，才能获得一次性内部授权；其余建议继续留在人工审查队列。
- 安全自动更新仍必须经过同一 Change Set、Version Group、transaction journal、History、Recovery 和 undo 链路，不允许模型直接写文件。
- 自动分析不得提出物理删除；低置信度建议默认不选中。

### 3.3 单一验证路径

所有写入入口必须复用相同验证器：

```text
Renderer 手动编辑 ─┐
Agent 结构化修改 ──┼─> Application candidate validator
章节更新建议 ─────┘            │
                               v
                     Repository schema + 引用校验
```

Renderer 只能进行即时表单提示，不能成为唯一的业务校验层。

### 3.4 兼容优先，按条目懒升级

- Repository 同时读取 v1.0 和 v1.1。
- 新建资产一律写入 v1.1。
- 作者或 Agent 首次修改 v1.0 资产时，只升级该资产。
- 不执行打开项目即批量重写。
- 兼容读取使用 `readCompatible`：识别已知字段，把旧未知根字段和未知 `details` 字段捕获到只读 `passthrough`，不得丢弃。
- 新建、手动修改、Agent patch 和章后建议使用 `writeStrict` 候选 schema：候选中不允许 `passthrough`，除声明的 `extensions` 命名空间外，未知字段必须拒绝。
- Repository 在候选通过后，从旧资产复制系统托管的 `passthrough`，组装并验证 `persistedStrict` v1.1；UI、模型和普通 patch 均不能创建、替换或删除该字段。
- 有意扩展的数据必须写入命名空间化的 `extensions`。旧字段只有在显式迁移器接管后才能从 `passthrough` 移入已注册扩展，避免兼容数据成为绕过严格 schema 的写入口。
- 升级失败必须保留原文件并返回可诊断错误。

### 3.5 观察、建议与事实分层

章节分析产生三层不同数据：

```text
正文证据 -> StoryObservation -> StoryFactDelta / review_issue -> 人工确认 / 安全策略预授权 -> Story Bible
```

- `StoryObservation` 只描述“文本中出现了什么”，不宣称其为作者事实。
- `StoryFactDelta` 描述“如果作者认可，应如何改变资料”，必须包含目标、前后值和写入前置条件。
- `review_issue` 承载冲突、歧义、无法解析实体和逾期伏笔，不强行伪装成可应用 patch。
- 观察、Delta 和问题属于可重建的分析记录，不是第六类资料，也不能被普通写作 Context 当作已确认事实召回。

## 4. Story Asset v1.1 数据合同

### 4.1 公共外壳

所有 v1.1 资料使用统一外壳：

```json
{
  "schemaVersion": "1.1",
  "id": "chr_0123456789abcdef0123456789abcdef",
  "type": "character",
  "title": "林砚",
  "status": "active",
  "summary": "调查旧港失踪案的记者。",
  "aliases": ["阿砚"],
  "relations": [],
  "details": {},
  "extensions": {},
  "createdAt": "2026-07-31T00:00:00.000Z",
  "updatedAt": "2026-07-31T00:00:00.000Z",
  "revision": 1
}
```

由 v1.0 懒升级的资产可以额外包含系统托管字段：

```json
{
  "passthrough": {
    "sourceSchemaVersion": "1.0",
    "rootFields": { "legacyFlag": true },
    "detailFieldsByPointer": { "/legacyField": { "value": "保留内容" } }
  }
}
```

公共约束：

- `revision` 是单资产单调递增整数，所有结构化修改必须携带 `baseRevision`。
- `status` 继续使用 `active | draft | archived | deleted`。
- `deleted` 是软删除，文件仍保留并可恢复。
- `type` 在资产创建后不可修改。
- `id` 和 `createdAt` 在资产创建后不可修改。
- `updatedAt`、`revision` 由 Application 或 Repository 生成，模型不得自行决定。
- v1.1 作者可写的核心对象逐层使用 `additionalProperties: false`。只有两个明确声明的映射容器允许动态键：作者可写的命名空间 `extensions`，以及 Repository 独占的只读 `passthrough`。
- `extensions` 键使用反向域名或已登记插件 ID；只有已注册 schema 和写权限的命名空间可由 UI/Agent 修改，未注册扩展只能兼容读取和原样保留。
- `passthrough` 是 `persistedStrict` 明确声明的可选只读字段，按原字段名或原 JSON Pointer 保存旧 JSON 值；新资产默认不写该字段。
- `passthrough.rootFields` 和 `detailFieldsByPointer` 允许旧字段名/Pointer 到 JSON 值的映射，但整个容器有独立的 JSON 深度、节点数和序列化大小限制，且不进入模型提示或普通搜索索引。
- `writeStrict` 候选 DTO 不包含 `passthrough`。Repository 必须先验证候选，再注入旧值并执行 `persistedStrict` 验证，不能让调用方提交带有该字段的“完整资产”绕过限制。

### 4.2 类型分派

Repository 必须按 `type` 选择独立 schema，不再只验证通用 `details`：

```text
character          -> story-character.schema.json
world.location     -> story-world-location.schema.json
world.faction      -> story-world-faction.schema.json
world.rule         -> story-world-rule.schema.json
world.glossary     -> story-world-glossary.schema.json
world.item         -> story-world-item.schema.json
world.lore         -> story-world-lore.schema.json
outline            -> story-outline.schema.json
foreshadow         -> story-foreshadow.schema.json
timeline.events    -> story-timeline.schema.json
```

每种类型共享同一份核心字段定义，并提供三个用途明确的验证入口。其中兼容读取是 Repository 适配器边界，另外两个是严格 schema 模式：

- `readCompatible`：Repository 只读兼容适配器；复用 v1.1 已知字段合同识别旧资产，把未知字段捕获到只读 `passthrough`，不属于可写 schema 模式。
- `writeStrict`：用于所有外部候选，验证类型、枚举、ID、字段组合、引用和扩展命名空间，拒绝 `passthrough` 与任何未声明字段。
- `persistedStrict`：仅供 Repository 在注入已有 `passthrough` 后做最终落盘验证，不作为 IPC、Agent 工具或 Renderer 表单输入 schema。

三个入口必须共享同一组核心字段与类型分派，不能维护三份会漂移的手写字段表。兼容职责只存在于读取适配器、系统托管字段和懒升级流程中，不能通过放宽候选 schema 实现。

### 4.3 ID 与路径约束

新资产 ID：

| 类型     | ID 规则                   | 路径                    |
| -------- | ------------------------- | ----------------------- |
| 人物     | `chr_<32 lowercase hex>`  | `characters/<id>.json`  |
| 地点     | `loc_<32 lowercase hex>`  | `world/<id>.json`       |
| 势力     | `fac_<32 lowercase hex>`  | `world/<id>.json`       |
| 规则     | `rule_<32 lowercase hex>` | `world/<id>.json`       |
| 术语     | `term_<32 lowercase hex>` | `world/<id>.json`       |
| 物品     | `item_<32 lowercase hex>` | `world/<id>.json`       |
| 背景资料 | `lore_<32 lowercase hex>` | `world/<id>.json`       |
| 伏笔     | `fsh_<32 lowercase hex>`  | `foreshadows/<id>.json` |
| 大纲     | `outline_main`            | `outline/outline.json`  |
| 时间线   | `timeline_main`           | `timeline/events.json`  |

内部可独立引用的关系和子项也使用稳定 ID：`rel_<32 lowercase hex>`、`vol_<32 lowercase hex>`、`cho_<32 lowercase hex>`、`beat_<32 lowercase hex>`、`evt_<32 lowercase hex>`、`knw_<32 lowercase hex>` 和 `fsm_<32 lowercase hex>`。这些 ID 一旦写入不得因排序或标题变化而重用。

兼容规则：

- 旧集合资产的 legacy ID 继续可读可改，不强制重命名。
- 新建集合资产必须使用新规则。
- 集合文件名必须与资产 ID 一致。
- 单例资产必须使用固定 ID；发现异常单例 ID 时进入显式修复流程，原子更新引用后再改 ID。

### 4.4 结构化关系

v1.1 使用 `relations` 作为关系事实来源：

```json
{
  "relationId": "rel_0123456789abcdef0123456789abcdef",
  "sourceId": "chr_0123456789abcdef0123456789abcdef",
  "targetId": "fac_0123456789abcdef0123456789abcdef",
  "relationType": "character.opposes-faction",
  "direction": "directed",
  "status": "active",
  "validFromChapterId": "ch_01",
  "validToChapterId": null,
  "inversePolicy": "derived",
  "inverseRelationId": null,
  "evidence": [{ "chapterId": "ch_01", "start": 128, "end": 143, "excerptHash": "..." }],
  "note": "第一章确认敌对关系"
}
```

规则：

- `relationId` 在项目内唯一、稳定且不可复用；更新关系状态时修改同一关系，不用删除后新建来丢失历史。
- 有向关系保存在 `sourceId` 资产中，`sourceId` 必须等于所属资产 ID，`targetId` 必须指向存在的 Story Bible 资产。
- `direction` 使用 `directed | symmetric`。对称关系按资产 ID 的二进制升序规范化端点，较小 ID 固定为 `sourceId` 和持久化所有者；查询层向两端投影同一 `relationId`，不得在另一端复制记录。
- `status` 使用 `active | ended | uncertain`，有效范围用 `validFromChapterId` / `validToChapterId` 表达。
- `inversePolicy` 使用 `derived | explicit | none`。`derived` 只在查询时投影；`explicit` 必须创建另一条有自己 `relationId` 的关系，并通过双方的 `inverseRelationId` 互相引用，两端更新属于同一一致性组。
- `symmetric` 关系强制使用 `inversePolicy: derived` 且 `inverseRelationId: null`；只有有向关系允许显式逆关系。
- 证据章节存在时必须指向有效章节；旧失效引用可以保留但必须显示警告。
- `relationType` 使用命名空间枚举，例如 `character.ally`、`character.parent`、`world.located-in`、`outline.uses-foreshadow`。
- Repository 的派生关系索引必须校验项目级 `relationId` 唯一性，并支持从任一端点定位规范记录。
- v1.1 写入时可继续生成 `relatedEntityIds` 兼容投影，但 UI 不再独立编辑该字段。
- 新建或修改的引用若无效，保存必须失败；从旧资产继承的无效引用允许保留并进入一致性问题列表。

## 5. 五类详情模型

### 5.1 人物

核心字段：

- `role`：身份定位。
- `personality`：性格特征、价值观、恐惧和欲望。
- `voice`：措辞、语气、口头禅和禁用表达。
- `goals.external`、`goals.internal`。
- `conflicts`。
- `arc.start`、`arc.turningPoints`、`arc.targetState`。
- `secrets`：内容、知情人物、揭示状态。
- `abilities`、`limitations`。
- `currentState`：位置、身体状态、情绪状态、持有物品和 `asOfChapterId` / `asOfEventId`。
- `knowledgeStates[]`：人物对某条信息的认知状态、来源和生效范围。
- `stateHistory[]`：按事件保存已确认的状态变化索引。

人物知识不能用一个“掌握信息”字符串表达。每条知识状态使用稳定 `knowledgeStateId` 和 `entryRevision`，状态至少区分：

- `known`：人物已获得且系统认为人物明确知道。
- `believed`：人物相信，但客观真假未确认。
- `suspected`：人物怀疑或正在验证。
- `misunderstood`：人物持有已确认的错误理解。
- `forgotten`：人物曾经知道，但当前无法调用或已经遗忘。

人物状态变化必须保留章节或事件来源，不能只覆盖 `currentState`。`stateHistory` 优先引用 `timelineEventId`，仅保存人物视角的补充说明，不再复制一份完整事件事实。

### 5.2 世界观

现有四个子类型继续保留，并增加 `world.item` 和 `world.lore`：

- 地点：地理、文化、限制、所属区域、相关势力。
- 势力：目标、结构、成员、资源、盟友、敌对关系和影响范围。
- 规则：可判定的规则正文、适用范围、代价、限制、例外和已知破例。
- 术语：定义、别名、首次出现、相关规则。
- 物品：外观、来源、能力、限制、持有者、当前位置、状态和状态历史。
- 背景资料：历史时期、社会制度、风俗、传说，以及科技或魔法体系的整体说明。

`world.lore` 用于需要成段表达、但又不是可判定规则或词条定义的背景知识。规则仍放 `world.rule`，名词定义仍放 `world.glossary`；三者通过关系关联，不增加世界观之外的一级入口。物品的持有者、位置和状态历史优先引用时间线事件 ID，避免在人物、物品和时间线中复制三份互相漂移的事实。

### 5.3 大纲

大纲保持单例，结构扩展为：

- `volumes[]`：包含稳定 `volumeId`、`entryRevision`、卷标题、摘要、目标和章节顺序。
- `chapterOutlines[]`：包含稳定 `chapterOutlineId`、`chapterId`、`entryRevision`、目标、冲突、转折和备注。
- `chapterOutlines[].povCharacterId`。
- `chapterOutlines[].characterIds`、`locationIds`、`foreshadowIds`。
- `chapterOutlines[].beats[]`：每项包含稳定 `beatId`、`entryRevision`、场景或节拍标题、目的和结果。
- `chapterOutlines[].expectedStateChanges[]`。
- `chapterOutlines[].actualOutcome`：正文完成后的实际结果。
- `chapterOutlines[].deviations[]`：实际内容与计划的差异。

所有数组内可独立编辑的对象都使用稳定 ID，patch 以 ID 寻址，禁止依赖可变化的数组下标。修改章纲或节拍时携带对应 `baseEntryRevision`；外层单例 revision 已变化但目标子项未变化时，可以重新校验后安全应用，避免无关章节编辑制造冲突。

章后分析只能建议更新 `actualOutcome`、`deviations` 和明确确认的关联，不得自动覆盖目标、冲突和计划转折。

### 5.4 伏笔

保留现有跟踪状态，并增加结构化推进节点：

```json
{
  "milestoneId": "fsm_0123456789abcdef0123456789abcdef",
  "entryRevision": 1,
  "kind": "plant",
  "chapterId": "ch_01",
  "timelineEventId": "evt_xxx",
  "evidence": {
    "start": 128,
    "end": 143,
    "excerptHash": "..."
  },
  "note": "首次埋设"
}
```

`kind` 使用 `plan | plant | progress | payoff | abandon`。总体 `trackingStatus` 由作者确认的节点派生或在保存时校验一致，不能出现总体已回收但没有 payoff 节点的状态。正文证据保存字符范围与 hash，预览摘录可按需生成，避免把正文副本长期塞入资料文件。

### 5.5 时间线

事件继续保持有序列表，每个事件包含稳定 `eventId` 和 `entryRevision`，时间不再只依赖自由文本：

```json
{
  "eventId": "evt_0123456789abcdef0123456789abcdef",
  "entryRevision": 3,
  "time": {
    "mode": "relative",
    "label": "第二日午夜",
    "anchorEventId": "evt_xxx",
    "offset": { "value": 1, "unit": "day" },
    "uncertain": false
  }
}
```

时间模式：

- `absolute`：明确日期或世界内历法时间。
- `relative`：相对另一事件或章节。
- `sequence-only`：只确认先后关系。
- `unknown`：尚未确定。

事件还应支持持续时间、并行事件、参与人物、地点、章节、前因、后果和状态变化。Repository 必须校验重复 ID、自引用、循环依赖和无效事件引用；跨资产引用进入一致性检查。修改单个事件时使用 `eventId + baseEntryRevision`，不因时间线中其他事件被编辑而无条件冲突。

### 5.6 内部观察与事实 Delta

章后分析统一输出 `StoryObservation`，领域限定为九类：人物行为、位置、资源、关系、情绪、信息、伏笔、时间和身体状态。它是内部分析合同，不新增一级资料入口。

```json
{
  "observationId": "obs_0123456789abcdef0123456789abcdef",
  "analysisRunId": "run_0123456789abcdef0123456789abcdef",
  "sourceChapter": { "chapterId": "ch_01", "checksum": "..." },
  "domain": "character.location",
  "subjectId": "chr_0123456789abcdef0123456789abcdef",
  "operation": "observe",
  "before": null,
  "after": { "locationId": "loc_0123456789abcdef0123456789abcdef" },
  "epistemicStatus": "narrator_asserted",
  "evidence": [{ "start": 128, "end": 143, "excerptHash": "..." }],
  "entityCandidates": [{ "assetId": "chr_0123456789abcdef0123456789abcdef", "confidence": 0.98 }],
  "confidence": 0.93
}
```

`epistemicStatus` 至少支持 `narrator_asserted | dialogue_claim | character_belief | rumor | model_inference | uncertain`。只有经过实体解析和确定性规则校验的观察才能形成 `StoryFactDelta`：

```json
{
  "deltaId": "dlt_0123456789abcdef0123456789abcdef",
  "observationIds": ["obs_0123456789abcdef0123456789abcdef"],
  "domain": "character.location",
  "subjectId": "chr_0123456789abcdef0123456789abcdef",
  "targetAssetId": "chr_0123456789abcdef0123456789abcdef",
  "targetBaseRevision": 7,
  "operation": "replace",
  "path": "/details/currentState/locationId",
  "before": { "value": "loc_old", "checksum": "..." },
  "after": { "value": "loc_new" },
  "epistemicStatus": "narrator_asserted",
  "sourceChapter": { "chapterId": "ch_01", "checksum": "..." },
  "evidence": [{ "start": 128, "end": 143, "excerptHash": "..." }],
  "entityCandidates": [],
  "confidence": 0.93,
  "consistencyGroupId": "cgrp_0123456789abcdef0123456789abcdef"
}
```

Delta 的 `before` 是 stale 检测和逆向 patch 的依据，`after` 仍只是候选值。对白、传闻和人物认知默认只能更新关系证据或人物知识状态；除非有独立客观证据，否则不得路由到客观位置、持有者或世界规则字段。

## 6. Agent 完整 CRUD

### 6.1 专用工具

writing profile 增加结构化 Story Bible 工具：

| 工具                         | 效果    | 说明                                              |
| ---------------------------- | ------- | ------------------------------------------------- |
| `describe_story_bible_type`  | read    | 返回类型版本、可写字段、枚举、默认值和引用约束    |
| `list_story_bible`           | read    | 按类型、状态、关键词和稳定游标分页列出资产        |
| `read_story_bible`           | read    | 返回完整资产、revision、子项 revision 和 checksum |
| `get_story_bible_references` | read    | 返回入向/出向引用和删除影响                       |
| `create_story_bible`         | propose | 服务端生成 ID、时间戳、revision 和默认字段        |
| `patch_story_bible`          | propose | 对允许字段或指定稳定子项应用结构化 patch          |
| `set_story_bible_status`     | propose | 归档、软删除或重新启用资产                        |
| `restore_story_bible`        | propose | 恢复软删除资产                                    |

`describe_story_bible_type` 从与 Repository 相同的严格 schema 生成结果，不维护第二份手写字段说明。这样 Agent 在创建 `world.lore`、修改人物知识状态或定位章纲子项前可以先查询合同，避免猜测字段。现有通用 `read_resource` 和 `create_resource` 可以保留兼容，但模型系统提示应优先使用专用工具。

`read_story_bible` 对 Agent 返回规范化核心字段、已注册 extensions、revision 和 checksum；存在遗留 `passthrough` 时只返回 `passthroughPresent`、来源 schema、字段数量和指针摘要，不把原始未知值注入模型上下文或作为可复制的 patch 输入。Renderer 可在只读迁移诊断中查看原值，迁移器仍由 Application/Repository 控制。

### 6.2 全量发现

- `list_story_bible` 必须使用游标分页，默认 50 条，最大 100 条。
- 固定排序为 `type + normalizedTitle + assetId`；游标绑定查询条件、排序规则、最后一项和 `indexRevision`，不得只保存 offset。
- 索引 revision 改变后旧游标返回 `cursor_stale` 并要求从第一页重试，不能在修改中的结果集上静默跳项或重复。
- 返回 `assetId`、`type`、`title`、`status`、`summary`、`revision`、`indexRevision` 和下一页游标。
- `query` 搜索标题、别名、摘要和严格 schema 中的已知可检索字段。
- writing profile 的 `search_project` 必须使用完整创作搜索索引，能够返回 `story_bible:<id>` 稳定引用。
- general-file profile 继续使用普通项目文件白名单，两者不能共用错误的搜索路由。
- Workspace outline 继续提供轻量目录，但不得再承担“发现所有资料”的唯一职责。

### 6.3 结构化修改

`patch_story_bible` 使用受限 JSON Patch：

```json
{
  "assetId": "chr_xxx",
  "baseRevision": 7,
  "entryRef": null,
  "operations": [
    {
      "op": "replace",
      "path": "/details/currentState/locationId",
      "value": "loc_xxx"
    }
  ]
}
```

限制：

- 禁止修改 `/id`、`/type`、`/schemaVersion`、`/createdAt`、`/revision`。
- patch 应用后必须对完整候选重新执行类型 schema 和引用校验。
- 普通资产、单例根字段以及一次涉及多个子项的 patch 使用严格资产级 CAS；`baseRevision` 不一致时返回冲突并要求重新读取。
- 只修改一个大纲章项、节拍或时间线事件时，使用 `entryRef: { collection, entryId, baseEntryRevision }` 寻址，操作路径相对于该子项，禁止 Agent 使用数组下标。
- 稳定子项 patch 中，`baseRevision` 表示发现候选时的外层版本，`baseEntryRevision` 才是目标子项的语义前置条件。外层 revision 改变但目标 `entryRevision` 和依赖字段 checksum 均未改变时，Application 可以在最新资产上重新构造并验证候选。
- 安全 rebase 后必须把最新外层 revision/checksum 交给现有 Version Group 事务做最终 CAS；从重建候选到事务替换之间再次变化时仍返回冲突。目标子项或依赖已经变化时不得自动合并。
- Change Set 展示字段级差异，不要求作者审查整份 JSON 文本。
- 一条自然语言命令涉及多个资产时必须形成同一 Change Set，并为有关联约束的修改分配同一 `consistencyGroupId`。
- 作者只能按一致性组选择，不能只接受“人物到了新地点”而拒绝同组的时间线事件或物品持有者变化。只有互不依赖的组之间允许部分选择和部分成功。
- 任何工具结果都返回机器可读 validation errors、受影响引用和生成的字段 diff，Agent 不以自由文本宣称写入成功。

### 6.4 删除语义

- 自然语言“删除人物/设定/伏笔”统一映射为 `set_story_bible_status(status=deleted)`。
- UI 和 Change Set 使用“移入已删除”措辞，不能暗示物理删除。
- 进入确认前必须调用相同的引用影响查询，返回会失效的关系、章纲、伏笔和事件；默认不级联修改或删除引用方。
- `restore_story_bible` 恢复到删除前状态；删除前状态记录在 Change Set 或历史版本中。
- 大纲和时间线单例默认不允许删除，只允许归档、清空受管子项或重新启用。
- `outline_main` 和 `timeline_main` 已存在时，create 工具只能返回“使用 patch 修改单例”的结构化提示，不得创建第二份单例文件。
- 物理文件清理由独立维护功能负责，不向 Agent 暴露。

### 6.5 模式与审批

- planning 模式只能列出、读取和生成计划。
- execution 模式才能创建、修改、软删除和恢复。
- 默认写入继续经过 Change Set 确认。
- 预授权运行仍必须通过 schema、引用、revision 和路径验证。
- 当前资料有 dirty draft 时，运行前继续要求保存、放弃或取消。

## 7. 章节完成后的资料更新建议

### 7.1 触发方式

章节完成分析设置提供三档：

1. `off`：关闭自动分析，保留手动分析。
2. `prompt`：标记章节完成后询问是否分析，默认值。
3. `background-review`：标记章节完成后自动分析；分析结果随后按资料维护模式处理。

资料维护模式是与分析触发方式正交的第二个设置：

1. `review`：默认值。建议进入审查队列，作者确认后写入。
2. `safe-auto`：分析完成后自动尝试应用安全完整组；未通过安全策略或应用失败的建议保留给作者审查。

运行必须在分析结束后重新读取维护模式，使作者在分析期间修改的设置立即生效。关闭自动分析不禁止作者手动分析；手动分析同样遵循当前资料维护模式。

普通 `Ctrl+S` 不触发分析。触发条件是章节状态从非完成变为完成，或作者显式选择“分析本章资料更新”。

### 7.2 `analysisRun` 审计合同

每次分析先创建 `analysisRun`，把“分析了哪一版章节、实际看到了哪些资料、使用了什么提取器”固定下来：

```json
{
  "analysisRunId": "run_0123456789abcdef0123456789abcdef",
  "createdAt": "2026-07-31T00:00:00.000Z",
  "startedAt": "2026-07-31T00:00:01.000Z",
  "completedAt": "2026-07-31T00:00:08.000Z",
  "chapter": { "chapterId": "ch_01", "checksum": "..." },
  "contextSnapshot": {
    "contextSnapshotId": "ctx_0123456789abcdef0123456789abcdef",
    "checksum": "..."
  },
  "recalledAssets": [
    {
      "assetId": "chr_0123456789abcdef0123456789abcdef",
      "revision": 7,
      "checksum": "...",
      "reason": "alias-match",
      "truncated": false
    }
  ],
  "runtime": {
    "providerId": "configured-provider",
    "modelId": "configured-model",
    "promptVersion": "story-observer-v1",
    "promptChecksum": "...",
    "extractorVersion": "story-fact-router-v1"
  },
  "validation": {
    "observationCount": 12,
    "acceptedCount": 10,
    "rejectedCount": 2,
    "errors": []
  },
  "usage": {
    "usageRecordId": "usage_0123456789abcdef0123456789abcdef",
    "inputTokens": 8200,
    "outputTokens": 1900,
    "estimatedCost": null
  },
  "status": "completed",
  "failure": null
}
```

- `status` 使用 `queued | running | completed | partial | failed | cancelled`。
- `createdAt`、`startedAt` 和 `completedAt` 由运行器生成；未开始或未完成的阶段使用 `null`，不能由模型伪造。
- 失败记录错误码、可重试性和经过脱敏的原因；失败不能改变章节或 Story Bible。
- `analysisRun` 作为现有 workflow/run history 下的领域审计记录持久化，不创建第二套 Agent Conversation、运行状态机或 History Repository。
- `recalledAssets` 是从最终 `AgentContextSnapshot` 生成并由 snapshot checksum 锁定的不可变审计投影，不是可独立修改的召回清单；实际来源身份、截断和 materialization 仍以该 Context Snapshot 为准。
- `usage` 引用现有 Agent usage record，并保存分析所需的不可变摘要；计费聚合仍以既有 usage 管线为准。
- 审计记录保存实际发送的召回结果，而不是只保存“理论上可能发送”的目录；模型密钥、隐藏安全指令和不属于作者项目的数据不得写入记录。

### 7.3 Observer 与确定性路由

```text
章节完成并保存
  -> 固化 chapter checksum
  -> 确定性召回并生成 AgentContextSnapshot
  -> 一次 Story Observer 提取九类 StoryObservation
  -> schema、证据范围和实体候选校验
  -> 确定性解析、认知层级判断和领域路由
  -> 必要时仅对缺口执行领域补充分析
  -> 生成 StoryFactDelta 或 review_issue
  -> 去重、冲突和 stale 前置检查
  -> 写入待审查队列
  -> 作者选择后创建 Change Set
  -> 按一致性组事务写入并刷新索引、Context 和 UI
```

- 默认使用一次结构化 Observer 覆盖九类领域，不为人物、世界观、大纲、伏笔和时间线固定执行五次独立模型调用。
- 超长章节可以在同一个 `analysisRun` 内按稳定字符范围分块；分块结果必须确定性合并和去重。
- 只有输出缺少必要领域、证据不完整或实体无法消歧时，才执行有明确目标的补充分析，并记录附加调用。
- Observer 只能产生观察，不能直接生成作者确认事实或调用写工具。
- 不得把完整 Story Bible 无界注入模型。Application 先用标题、别名、正文显式引用和搜索索引召回，再按 token 预算加载必要字段。

### 7.4 建议与问题合同

可应用建议使用 `recordType: change`：

```json
{
  "schemaVersion": "1.1",
  "suggestionId": "sug_0123456789abcdef0123456789abcdef",
  "recordType": "change",
  "status": "pending",
  "revision": 1,
  "createdAt": "2026-07-31T00:00:09.000Z",
  "updatedAt": "2026-07-31T00:00:09.000Z",
  "analysisRunId": "run_0123456789abcdef0123456789abcdef",
  "chapter": { "chapterId": "ch_01", "checksum": "..." },
  "domain": "character.location",
  "action": "patch",
  "target": {
    "assetId": "chr_0123456789abcdef0123456789abcdef",
    "baseRevision": 7,
    "entryRef": null
  },
  "proposedAssetType": null,
  "proposedAssetId": null,
  "createValue": null,
  "dependencies": [
    {
      "kind": "asset_fields",
      "assetId": "loc_0123456789abcdef0123456789abcdef",
      "baseRevision": 2,
      "selectors": ["/title", "/aliases", "/status"],
      "valueChecksum": "..."
    }
  ],
  "consistencyGroupId": "cgrp_0123456789abcdef0123456789abcdef",
  "operations": [
    {
      "op": "replace",
      "path": "/details/currentState/locationId",
      "beforeValueChecksum": "...",
      "value": "loc_0123456789abcdef0123456789abcdef"
    }
  ],
  "evidence": [{ "start": 128, "end": 143, "excerptHash": "..." }],
  "epistemicStatus": "narrator_asserted",
  "confidence": 0.91,
  "reason": "本章客观叙述确认人物抵达新地点"
}
```

约束：

- `action` 只允许 `create | patch`，不得由 AI 产生 delete。
- suggestion 持久化状态使用 `pending | accepted | applied | rejected | stale | failed`，`revision` 在审查操作或状态变化时递增；模型输出不能直接设置状态或时间戳。
- create 建议使用 `target: null`、空 operations 和 `createValue`。Application 在规范化建议时生成 `proposedAssetId`，模型不能提供该 ID；同一一致性组中的其他建议可以引用这个临时保留 ID。
- `createValue` 只包含 title、status、summary、aliases、relations、details 和允许的 extensions，并通过对应类型的严格创建 schema；时间戳、revision 和最终外壳由 Application/Repository 生成。
- create 建议记录目标类型、查询签名和索引 revision，用于应用前重新检查 ID 碰撞、同名或同实体重复项；未应用/拒绝建议的保留 ID 可以废弃但不得复用。
- patch 记录目标 `baseRevision`、可选子项 `baseEntryRevision`、每个操作的 before value checksum，以及真正参与判断的字段依赖集合。
- `asset_fields` 依赖必须保存 JSON Pointer selectors 和这些值规范化后的 `valueChecksum`；`baseRevision` 只用于审计和快速路径，不能因同一资产的无关字段变化直接判 stale。
- 索引依赖使用 `kind: type_index`，保存资产类型、查询签名和 `indexRevision`；章节依赖使用固定 chapter checksum，不把不同语义塞进通用 asset checksum。
- patch 必须通过和 Agent 相同的结构化候选验证器。
- 所有事实建议必须有可回到原文的字符范围与 checksum；预览摘录不是唯一证据。
- `confidence` 只影响默认选中状态，不能绕过确认。
- 同一章节 checksum、prompt/extractor 版本和候选语义使用稳定幂等键去重。

冲突、歧义、逾期伏笔和无法解析实体使用独立问题合同：

```json
{
  "schemaVersion": "1.1",
  "issueId": "issue_0123456789abcdef0123456789abcdef",
  "recordType": "review_issue",
  "revision": 1,
  "createdAt": "2026-07-31T00:00:09.000Z",
  "updatedAt": "2026-07-31T00:00:09.000Z",
  "analysisRunId": "run_0123456789abcdef0123456789abcdef",
  "chapter": { "chapterId": "ch_01", "checksum": "..." },
  "issueType": "conflict",
  "status": "open",
  "claims": [
    {
      "value": { "locationId": "loc_xxx" },
      "evidence": [{ "start": 128, "end": 143, "excerptHash": "..." }]
    }
  ],
  "affectedRefs": ["story_bible:chr_xxx"],
  "dependencies": [],
  "idempotencyKey": "...",
  "resolution": null,
  "supersededByIssueId": null
}
```

- `issueType` 使用 `conflict | ambiguity | unresolved_entity | overdue_foreshadow`。
- issue 的 `revision` 在解决、忽略、重新分析关联或 stale 时递增；状态、时间戳和 resolution 均由 Application 生成。
- 状态流为 `open -> resolved | dismissed | stale`；重新分析产生新问题时，旧问题标记 stale 并通过 `supersededByIssueId` 指向新记录。
- `resolved` 必须保存作者决定、关联 `changeSetId`（如有）、操作者和时间；`dismissed` 保存作用于当前 `idempotencyKey` 的理由。正文或相关字段证据变化后使用新 key，不能永久吞掉新证据。
- issue 使用与 change suggestion 相同的字段级依赖和 chapter checksum stale 规则，但不包含可直接应用的 operations，也不进入 accepted/applied 状态。
- 作者解决问题后可以显式创建修订建议；系统不得为了让流程可应用而猜测一个“正确事实”。

### 7.5 五类路由规则

人物候选：

- 新人物与别名。
- 身份、目标、秘密或能力的明确变化。
- 人物关系变化。
- 位置、身体状态、心理状态、掌握信息和持有物品变化。

世界观候选：

- 新地点、势力、规则、术语、关键物品或背景资料。
- 已有设定被明确补充或修正。
- 物品持有者、位置或状态变化。

大纲候选：

- 本章实际结果。
- 与原章纲的偏离。
- 实际 POV、人物、地点、伏笔关联和状态变化。
- 不自动重写计划目标、冲突和预定转折。

伏笔候选：

- 新埋设、推进、回收或放弃证据。
- 与已有伏笔重复的证据。
- 超过计划章节仍未回收时生成 `review_issue`，不能自行把伏笔标为放弃或回收。

时间线候选：

- 新事件、相对或绝对时间信息。
- 人物、地点和章节关联。
- 前因、后果和并行关系。
- 已有事件时间冲突时生成 `review_issue`，不能自动选择新旧时间。

路由还必须遵守认知层级：对白和传闻可以更新人物的 `knowledgeStates` 或关系证据，但只有客观叙述、作者明确确认或已有可验证事实链才能更新客观时间、地点、持有者和世界规则。

### 7.6 精确 stale 判定

建议不能只依赖一个全局 `storyBibleSnapshotRevision`：

- 章节 checksum 改变时，该章节的未应用建议全部 stale。
- 目标资产保存 `baseRevision`，每个操作保存 before value checksum；普通资产目标 revision 改变时该建议标记 stale/conflict 并要求重新读取，稳定子项按 6.3 的 entry-level CAS 规则重新验证。
- `asset_fields` 只比较 selectors 对应值的 checksum。资产 revision 改变而选择字段未变时更新审计基线并安全 rebase，选择字段改变才 stale。
- create 和实体去重建议额外依赖对应类型、查询签名和 `indexRevision`。索引变化时先重新做实体解析；只有出现重复、歧义或目标改变时才 stale。
- 依赖集合只记录实际参与实体解析、引用校验或推理的字段。无关资产或同一资产无关字段变化不得让建议过期。
- `AgentContextSnapshot` 的 checksum、compaction revision 和 materialization provenance 只用于审计，不作为建议 stale 的一票否决条件。
- `review_issue` 使用相同依赖判定；证据或依赖变化时旧问题 stale，新分析通过 `supersededByIssueId` 关联。
- stale 建议或问题保留原始证据和 diff，可一键以新基线重新分析，但不得静默套用。

### 7.7 审查与原子应用

建议队列状态：

```text
pending -> accepted -> applied
        -> rejected
        -> stale
        -> failed
```

一致性问题状态独立为：

```text
open -> resolved
     -> dismissed
     -> stale -> superseded issue
```

- 按目标资产合并兼容 patch，冲突 patch 必须分开显示。
- 同一资产的多个建议显示最终字段差异和每条证据。
- 作者可以逐项、按领域或按一致性组批量选择；同一一致性组内不能拆分接受。
- 人物位置、物品持有者、关系逆向项和时间线事件等跨资产事实必须进入同一 `consistencyGroupId`。
- 应用前按 7.6 重新检查章节、目标字段、子项和依赖基线。
- 每个选中的一致性组映射为一个现有 Version Group，通过既有 `VersionGroupSession -> AgentWriteTransaction -> transaction journal / History` 链路提交；不得为 Story Bible 新建第二套事务 manifest。
- Change Set 的 file/operation 增加 `consistencyGroupId`，approval binding 增加选中组 ID 列表及其 selection checksum。Application 只验证一次用户 approval，再为每组派生绑定原 Change Set checksum 的一次性内部授权。
- 一次批量接受使用 `applyBatchId` 关联多个 `consistencyGroupId -> versionGroupId`。各组独立提交，因此只有互不依赖的组之间允许部分成功；已 applied 的 Version Group 在重试时不得重复提交。
- `(applyBatchId, consistencyGroupId)` 是组级幂等键，重复命令必须返回首次 Version Group 结果。Version Group v1.1 增加 `applyBatchId`、`consistencyGroupId` 和 Story Bible domain metadata，旧 v1.0 继续兼容读取。
- transaction journal v1.1 同步保存可选的 `applyBatchId` 和 `consistencyGroupId`，恢复、补偿和重试以 journal 中的组级幂等键为准；旧 journal 只按 `versionGroupId` 兼容读取。
- 每组先完成全部候选、引用和 CAS 预检。写入中途失败时由现有 journal 执行补偿；补偿成功记为 `rolled_back`，补偿失败沿用 `partial_failure / awaiting_review` 和 recovery review，任何非 `applied` 结果都不能对外宣称成功。
- `StoryBibleApplyReceipt` 持久化为 Version Group 的受限领域元数据，并可从 Version Group、journal 和 History 重建展示投影；它记录 `changeSetId`、`consistencyGroupId`、before/after revision/checksum、History 版本和供 UI 展示的 inverse patch，但不替代这些权威记录。
- 搜索索引、Context 成功发布和 Renderer 成功通知只能在对应 Version Group 进入 `applied` 后发生；`rolled_back` 或 recovery review 只发恢复状态，不把半套事实宣称为成功。`partial_failure` 可能已经留下未能补偿的磁盘写入，因此必须对分析启动时捕获的原项目保守失效 Story Bible 缓存与搜索绑定，并提示恢复检查；这种失效只防止继续使用旧缓存，不代表确认或发布半套事实。
- 安全自动更新使用独立审计来源 `project_safe_auto_update`，不得伪装成 `human_confirmation` 或复用 Agent 的 `user_preapproved_run`。
- 公共 approval gate 仍只能生成 `human_confirmation`；Application 仅在安全策略选中完整组后，用不可外部构造的一次性对象授权升级来源，Version Group 消费授权后立即失效。伪造相同字符串必须在事务开始前拒绝。
- `project_safe_auto_update` 禁止所有文件生命周期 operation，只允许带完整 `applyBatchId + consistencyGroupId + selectionChecksum`、非空 suggestion IDs 和 Story Bible receipt 的 patch 写入。Recovery 必须验证这些字段，undo 行为与人工 Version Group 相同。
- 安全策略采用 fail-closed：置信度至少 `0.95`、`narrator_asserted`、有正文证据及匹配章节 checksum、目标已是 revision 大于等于 1 的 v1.1 资料、无开放问题、仅 `add/replace` 且命中人物/物品当前状态、伏笔跟踪状态或章纲实际结果白名单；任一组员不满足时整组转人工审查。时间线、状态历史、知识状态、伏笔节点和 deviations 等集合在具备“旧条目全部保留”的单调追加证明前继续人工审查，禁止用整数组 replace 绕过 remove 限制。

## 8. UI 完善

### 8.1 关系与引用选择器

- 用可搜索、多选的资产选择器替换“每行一个资料 ID”。
- 选择后显示标题、类型、关系方向、有效章节范围和状态，不要求作者记住 ID。
- 已删除和缺失引用分别显示明确状态。
- 允许从选择器直接打开目标资料，但不嵌套编辑器。
- 对称关系和派生逆关系只编辑规范记录；显式双向关系在一个一致性组中预览两端 diff。

### 8.2 建议队列

- 在故事资料标题栏显示“资料更新建议”及待处理数量。
- 主区使用领域、章节、记录类型和状态筛选。
- 变更建议显示目标资料、字段差异、正文证据、事实认知层级、理由、置信度和一致性组。
- 一致性问题并列显示冲突声明及各自证据，操作是“解决/忽略/重新分析”，不是接受一个预选答案。
- 不使用独立第六类导航；建议队列是跨五类的临时审查视图。

### 8.3 Agent 上下文编排与预览

右侧 Agent 在 composer 的紧凑 Context 入口中提供按需检查器；它不作为消息流常驻卡片，也不在每次发送后自动展开，继续遵守现有 Stage 5 会话信息层级。检查器复用现有 `AgentContextSnapshot`：

- 按来源展示当前章节、近期章节、章纲片段、人物、世界资料、伏笔和时间线事件。
- 直接展示 snapshot 已有的 checksum、`sourceRevision`、`tokenCount`、precision、state、truncation range、materialization order 和 `excludedSources`，不复制同义字段。
- snapshot 只新增当前缺少的 `selectionReason`、`selectionPolicy: automatic | explicit | pinned` 和同层 `priority`；项目默认固定/排除保存在现有项目偏好入口，snapshot 只冻结本次解析后的结果。
- 现有显式引用映射为 `explicit`，现有 `excludedSources` 映射为排除结果。作者可以固定或排除具体章节、资料、伏笔和世界规则，并调整同类来源优先级；作用范围明确区分“仅本次”和“项目默认”。
- 固定项优先进入预算但仍受硬上限约束。固定内容超过预算时阻止发送并要求作者调整，不能静默截断固定项。
- Context packer 生成一个不可变 `PackedAgentContext`，包含最终 blocks、token 统计和 payload checksum；预览与 Provider Adapter 必须消费同一个对象，不能分别重新拼装。作者在发送前改变来源或正文时使该对象失效并重新打包。
- snapshot 持久化 block manifest、顺序、截断和 checksum，不额外复制完整正文。历史预览只有在按 manifest 重建并校验成功时显示，否则明确标记 unavailable/stale。
- 隐藏安全指令、供应商内部元数据和密钥不进入预览；预览范围清楚标为“作者项目上下文”。
- 排除或固定只影响当前 Context 组合，不改变 Story Bible 事实。UI 必须明确“排除上下文不等于禁止工具读取”；工具按需读取继续受 profile、权限和审计约束。

### 8.4 删除与恢复

- 列表默认隐藏 `deleted`，状态筛选可查看。
- 详情提供“移入已删除”和“恢复”命令，二者均进入确认或 Change Set。
- 被其他资料引用时，删除确认必须显示入向引用、受影响字段和处理建议；默认保留引用并标记失效，不自动级联。

### 8.5 章后反馈

- 章节完成后只显示非阻塞结果，例如“发现 7 条资料更新建议”。
- 分析失败不影响章节保存和完成状态。
- 作者可以关闭提示、稍后审查、打开本次 `analysisRun` 详情或重新分析。
- 审查页同时展示“章节完成后”和“资料写入方式”两个独立选项，并明确安全自动更新只处理高置信、无冲突、可撤销建议。
- 人工模式成功应用建议后，在结果旁提供“开启安全自动更新”引导；切换设置时保存完整的两个维度，不能互相覆盖。
- 人工模式下，进入更后章节或新建下一章前，如果上一已完成章节仍有未应用建议、开放问题或未完成/失败分析，显示一次非阻断软提醒。作者可以继续，且同一来源到目标在当前会话不重复提醒；取消则留在当前章。
- 安全自动模式或提醒检查暂时不可用时不阻断写作；自动应用失败也不影响章节保存，并继续保留可人工处理的分析记录。
- 后台分析在真正写入 queued run 前先登记 Renderer 本地 scheduled 标记；完成事件到达后再清除，避免用户立刻进入下一章时出现检查空窗。人工触发的完成事件不得误清后台 scheduled 标记。
- 成功分析统一发布带 `projectId / chapterId / workflowRunId / storyBibleChanged` 的 clone-safe 完成事件。Renderer 只接收当前 project/workspace scope 的事件，刷新全部分析运行概览；Story Bible 无未保存草稿时刷新权威快照，有 dirty 草稿时保留草稿并显示外部更新提示。
- 软提醒检查同一章节的全部分析运行，不能只看最新一次；较旧运行中的 `pending / accepted / failed` 建议、开放问题和未完成/失败运行仍算待处理。
- Version Group 已经 durable 提交后，即使建议状态投影同步失败，也返回 batch 和最后持久化的分析记录，并显示“资料已写入、状态同步待恢复”，不得把它降级成普通未写入失败或诱导重复提交。

## 9. 分层职责

### 9.1 Repository

- 读取 v1.0/v1.1。
- 提供 `readCompatible` 和 `persistedStrict` 验证、ID/路径、单例、稳定子项和引用校验。
- 管理系统托管 `passthrough`、命名空间 `extensions`、revision、checksum 和单资产 CAS；未经 Application 严格候选验证的数据仍必须拒绝。
- 将已验证的 Story Bible 候选作为普通受管 JSON 写入接入现有 `AgentWriteTransaction`、History 和 recovery ports，不创建 Story Bible 专用事务 journal。
- 提供分页查询所需的稳定排序和 `indexRevision` 端口。

### 9.2 Application

- 统一 candidate validator。
- 结构化 patch、软删除和恢复语义。
- `StoryObservation` 解析、事实认知层级路由、Delta、review issue 和实体消歧。
- 章节更新建议状态机、去重、合并、精确 stale 检查、一致性组和 Change Set 生成。
- 解析人工/安全自动维护模式，执行 fail-closed 安全组选择，并为自动来源签发和消费进程内一次性授权。
- 扩展现有 `VersionGroupSession` 的批量应用：一次验证 group-aware approval，生成不可复用的组级内部授权，再按一致性组调用既有事务；不得重复消费同一个用户 approval token。
- 搜索和 Context invalidation。

### 9.3 Main

- Repository、搜索索引、模型 Provider 和 Agent 工具编排。
- writing/general-file 搜索路由隔离。
- `AgentContextSnapshot` 构建、项目级 Context 选择偏好、`PackedAgentContext`、预览 checksum 和来源策略。
- 模型预算、结构化 Observer、响应 schema 校验、`analysisRun` 审计和持久化建议队列。

### 9.4 Renderer

- 结构化表单、关系选择器、建议/问题审查、字段 diff 和上下文检查器。
- dirty draft 保护和外部更新提示。
- 不持有权威 schema、revision、stale 判定或自动写入逻辑。

## 10. 兼容与迁移

### 10.1 v1.0 读取

- 继续读取现有人物、世界观、大纲、时间线和伏笔。
- 将旧字段适配为 v1.1 draft，但不立即写盘。
- 资产保持 v1.0 时原文件字节不因读取而变化。发生懒升级时，兼容适配器按原字段名/JSON Pointer 捕获未知值，并移动到 v1.1 明确声明的只读 `passthrough` 后再执行 `persistedStrict` 验证。
- Application 只接收不含 `passthrough` 的 `writeStrict` 候选；Repository 从当前 v1.0/兼容视图注入系统值，避免调用方伪造或删除遗留内容。
- v1.0 没有 `revision` 或子项 `entryRevision` 时，兼容视图使用 `0` 作为显示基线，同时保存原文件 checksum；首次升级必须以该 checksum 做 CAS，成功后从资产 revision `1` 和子项 revision `1` 开始，不能只依赖合成的 `0`。
- v1.0 数组子项缺少稳定 ID 时，升级预览先根据原顺序、章节/事件语义和内容 checksum 生成候选 ID；作者确认后才落盘，排序变化本身不能重新生成 ID。
- 新建和普通 patch 不能写 `passthrough`；需要保留的第三方扩展迁移到有命名空间的 `extensions` 后才成为正式可写数据。
- 旧 `relatedEntityIds` 生成未分类关系草稿，作者可稍后补充关系类型。

### 10.2 懒升级

升级发生在以下时机之一：

- 作者保存该资产。
- 作者确认针对该资产的 Agent Change Set。
- 作者确认章节更新建议，或已是 v1.1 的目标通过作者预授权的安全自动策略；v1.0 懒升级仍必须人工预览确认。

升级预览必须显示结构变化；如果只是规范化且不改变作者语义，可以与当前字段修改合并为一次保存。

Agent 和章后建议的候选准备必须只读，不得在提案阶段移动或删除旧文件。非规范路径的升级在人工确认后建模为同一一致性组：先创建最终 v1.1 规范文件，再删除依赖该创建操作的旧路径；组内任一步失败均按 journal 补偿。旧资产的 status/delete/restore 不在迁移提案中复用提案期授权，必须先通过普通 patch 完成升级后再执行专用状态命令。手工保存同样先完成旧路径 checksum CAS 与 History 快照，再写最终规范文件并移除旧路径；History 或写入失败时旧路径保持不变。

### 10.3 选择性版本组与回滚

- 不在每章完成后复制一份完整 Story Bible。`analysisRun` 只保存章节 checksum、实际召回资产的 revision/checksum manifest 和 Context Snapshot 引用。
- 每个一致性组使用一个现有 Version Group；一次接受多个独立组时，由 `applyBatchId` 关联多个 Version Group，不扩张出另一套版本容器。
- `StoryBibleApplyReceipt` 是 Version Group 上受限持久化的领域元数据，并提供只读投影，连接 Change Set、结构化字段 diff、History 版本、before/after checksum 和 inverse patch；它不能替代 journal baseline 或 undo metadata。
- 撤销调用现有 `undoVersionGroup`，只恢复该一致性组实际触及的资产和子项，不回退分析后由作者完成的其他资料修改。
- 如果目标资产当前 checksum 已不是 Version Group 的 last-write checksum，沿用现有 rollback review/冲突流程，禁止用旧快照覆盖新工作。
- 懒升级的 History 必须保留 v1.0 原文，因此 Change Set undo 可以恢复升级前内容。
- 章节重新分析不会自动回滚上一次已确认结果；它只使相关未应用建议 stale，并产生新的建议或问题。
- 搜索缓存、Context Snapshot 派生索引和待审查分析结果不是事实来源，损坏后均可从章节、Story Bible、History 与 receipts 重建。

## 11. 实施批次

### 批次 A：数据完整性基础（已完成，2026-08-02）

- 增加 v1.1 联合类型和十个严格写入 schema。
- 增加 `world.item` 和 `world.lore`。
- 从同一核心 schema 派生 `readCompatible` / `writeStrict` / `persistedStrict`，增加系统托管 `passthrough` 和命名空间 `extensions`。
- 强制新 ID、文件名一致性、单例 ID，以及章纲、节拍和时间线事件的稳定 ID / `entryRevision`。
- 增加完整关系合同、知识状态、revision、checksum 和统一 candidate validator。
- 实现 v1.0 兼容读取与按条目懒升级。

完成标准：UI、Agent 和 Repository 对同一候选返回一致验证结果；旧未知字段无损保留，新未知字段无法写入。

### 批次 B：Agent 全量发现、CRUD 与 Context（已完成，2026-08-02）

- 增加 schema 描述、稳定分页、完整读取和引用影响查询。
- 修正 writing profile 搜索路由。
- 增加结构化 create、patch、status 和 restore 工具。
- 多资产命令生成同一 Change Set 和一致性组，Change Set 显示字段级差异。
- 暴露 `AgentContextSnapshot` 已有来源元数据，只新增选择原因/策略；复用显式引用和 `excludedSources`，增加项目默认、`PackedAgentContext` 与按需实际发送预览。
- 补齐人物、世界观、大纲、伏笔、时间线的自然语言 CRUD E2E。

完成标准：300 章、500 个资料条目的项目中，Agent 可以通过名称发现并修改任意目标；预览内容与实际打包的作者项目上下文 checksum 一致。

### 批次 C：Observer 与建议引擎（已完成，2026-08-02）

- 增加章节完成触发和项目设置。
- 在现有 run history/usage 基础上增加 `analysisRun`、`StoryObservation`、`StoryFactDelta`、suggestion 和带完整生命周期的 `review_issue` schema。
- 实现一次 Observer、九类观察、确定性实体解析、事实认知层级路由和按需补充分析。
- 实现证据范围、去重、冲突、相关依赖和精确 stale 检测。
- 持久化待审查队列和状态机；本批次只产出建议，安全自动写入在批次 D 接入既有事务后开放。

完成标准：分析失败不影响章节保存；未确认观察和建议绝不改变 Story Bible；对白或传闻不会被误写成客观事实。

### 批次 D：事务应用与作者工作流（已完成，2026-08-02）

- 扩展现有 Change Set、group-aware approval、Version Group 和 transaction journal 的可选 v1.1 组元数据，使每个一致性组复用既有事务、recovery 与 undo；增加非权威 `StoryBibleApplyReceipt` 投影和 inverse patch 展示。
- 关系与引用选择器。
- 资料更新建议与一致性问题审查视图。
- 人物当前状态与状态历史。
- 大纲 actual outcome/deviations 和场景节拍。
- 伏笔推进节点与结构化时间编辑。
- 人工审查 / 安全自动维护模式、开启引导和进入下一章的非阻断软提醒。

完成标准：作者无需手写任何资产 ID 或 JSON；跨人物、物品和时间线的同组更新不会部分落盘。

### 批次 E：兼容、性能和完整门禁（已完成，2026-08-02）

- v1.0/v1.1 混合项目测试。
- 300 章、500 资料规模测试。
- Agent 稳定分页、搜索截断、上下文预算/预览和并发 revision / entryRevision 冲突测试。
- Observer 固定样本、实体歧义、认知层级、重复分析、相关/无关依赖 stale 测试。
- Change Set apply/undo、事务故障注入、dirty draft、外部更新和搜索失效测试。
- 三主题、三个视口和键盘可访问性验收。

## 12. 验收标准

### 12.1 数据

- 所有十个 v1.1 类型都有独立严格写入 schema。
- Agent 无法写入 UI 会丢弃或无法展示的数据结构。
- v1.0 未知字段在未升级时保持原文件不变，升级后进入 `persistedStrict` 声明的系统托管 `passthrough`；外部候选不能写该字段，v1.1 未知新字段被拒绝。
- v1.0 首次升级必须以原文件 checksum 做 CAS，并从 revision/entryRevision `1` 开始；失败时原文件和 passthrough 内容均保持不变。
- 新资产 ID、路径和类型始终一致。
- 关系、章纲项、节拍、伏笔节点和时间线事件都有稳定 ID；可并发编辑的子项有 `entryRevision`。
- 任何无效新引用都在写入前被拒绝。
- 旧资产未知字段和原始内容可以通过 History 恢复。

### 12.2 Agent

- planning 模式无法写入。
- execution 模式可以查询、创建、修改、软删除和恢复五类资料。
- 500 个资料条目下仍能通过名称找到任意条目。
- Agent 可以查询当前类型 schema；分页过程中索引变化会显式返回 stale cursor，不会漏项。
- 所有写入经过完整候选验证和 Change Set。
- 多资产命令按一致性组审查，删除前可看到完整引用影响。
- create 建议只提交严格 `createValue`，ID、时间戳和 revision 始终由服务端生成；单例不会被重复创建。
- 自然语言“删除”不会物理删除文件。

### 12.3 章节更新

- 普通保存不触发模型。
- 完成章节按项目设置触发或提示分析。
- 分析触发方式与资料维护方式可以独立设置；旧设置缺少维护字段时默认 `review`。
- 一个逻辑分析运行覆盖九类观察，只有明确缺口才触发领域补充分析。
- 每次运行可追溯章节 checksum、实际召回资产 revision/checksum、模型、提示词、提取器、验证结果、用量和失败原因。
- 实际召回清单与发送 payload 绑定 Context Snapshot checksum，prompt checksum 和 usage record 可跨重启追溯。
- 五类建议均有正文字符范围、认知层级和字段 diff。
- 人工模式下未确认、已拒绝或已过期建议不改变资料；安全自动模式下只有满足完整安全策略的一致性组可以改变资料。
- 安全自动应用失败不影响章节完成和分析结果；未自动应用的建议仍可人工审查。
- 安全自动来源不可由公共 approval API 伪造，且创建、删除、关系、核心设定、敏感路径、低置信度、非客观叙述和开放冲突不会自动写入。
- 重复分析不会生成重复建议。
- 矛盾、歧义和逾期伏笔进入 `review_issue`，系统不擅自选择事实。
- `review_issue` 的解决、忽略、stale 和 supersede 均可跨重启恢复，且不会进入 change suggestion 的 accepted/applied 状态。
- 修改章节或 selector 指向的相关字段后旧建议可靠标记为 stale；修改无关资产或同一资产无关字段不会使建议过期。

### 12.4 一致性与回滚

- 同一一致性组内任一预检失败时不启动写入；写入中途失败时由现有 journal 补偿，只有所有目标成功时 Version Group 才能进入 `applied`。
- 补偿失败进入现有 `partial_failure / awaiting_review` 和 recovery review，不能误报成功或发布 Context 成功更新；同时必须保守失效原项目缓存和搜索绑定，避免后续写作继续读取事务前旧快照。
- 只有独立一致性组可以在同一 apply batch 中部分成功，重试不会重复已 applied 的 Version Group。
- Version Group 的 Story Bible receipt 投影包含所有目标的 before/after revision/checksum、History 版本和 inverse patch，但事务与撤销仍以既有 journal/undo metadata 为准。
- `project_safe_auto_update` journal 必须包含完整组绑定、非空建议 ID 和有效 Story Bible receipt；破坏性 operation 或缺失字段的 journal 在写入和恢复读取时均被拒绝。
- 回滚只触及对应版本组；基线之后又被修改时必须重新审查，不能覆盖新内容。
- 进程在事务任一阶段中断后，重启沿用现有 transaction recovery，最终进入 `applied`、`rolled_back` 或明确的 recovery review，不存在被当作成功使用的半套事实。

### 12.5 用户体验

- 作者无需输入 ID。
- 已删除、缺失和冲突引用有不同视觉状态。
- 建议队列不增加第六个故事资料一级类目。
- 作者能在审查页切换“审查后写入 / 安全自动更新”，并能看到自动更新的限制说明和快捷开启引导。
- 人工模式带未处理资料进入下一章时收到一次软提醒；继续写作不被硬阻断，安全自动模式不显示该人工确认提醒。
- 作者可以从按需 Context 检查器查看资料为何进入、固定或排除来源，并预览最终打包后的作者项目上下文；消息流不常驻 context/token 大卡片。
- 固定内容超出预算时有明确阻断，不会静默截断或用摘要替换。
- 小窗口和 Agent 面板开启时无横向滚动、遮挡或文本截断。
- 键盘可以完成查找资料、选择关系、审查建议和确认 Change Set。

## 13. 外部参考采用边界

本方案参考以下固定源码版本，仅借鉴问题拆分和交互原则，不复制其源码、协议、数据结构或界面：

- [Narcooo/inkos](https://github.com/Narcooo/inkos)，审查 commit `b0cc9a54fc7ee2c14664d192c2c9d5f65e09dafd`。
- [5JXZY/AI-Writing-Helper](https://github.com/5JXZY/AI-Writing-Helper)，审查 commit `9f4ef64eefe065f96614285b68e51e963f26f454`。

| 参考              | 借鉴原则                                         | 在本项目中的重构方式                                                                                                                                      | 明确不采用                                                                 |
| ----------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| InkOS             | 将章节观察与事实更新分开，保留证据和状态变化过程 | 使用 `StoryObservation -> StoryFactDelta -> review -> Change Set -> existing Version Group transaction`，并接入现有 History、revision 和 Context Snapshot | AI 自动写真相文件、JSON/Markdown 双权威、宽松 Delta、按章节破坏性回滚      |
| AI Writing Helper | 作者可控制上下文来源，并在发送前看到组合结果     | 暴露现有 `AgentContextSnapshot` 元数据和排除状态，只增加选择原因/固定策略、项目默认及同一 `PackedAgentContext` 驱动的按需预览                             | 正则解析工具指令、按标题静默覆盖、无 revision 写入、让模型直接操作文件路径 |

本项目继续以现有 `packages/repository/src/story-bible-repository.ts`、`packages/agent-engine/src/tool-registry.ts`、`packages/agent-engine/src/context-snapshot.ts`、`packages/agent-engine/src/version-group.ts`、`packages/agent-engine/src/transaction-journal.ts`、`packages/application/src/version-group-session.ts`、Change Set、History、Recovery 和 undo 为实施基线。外部参考不成为运行时依赖，也不引入第二份权威存储、第二套事务、第二套工具协议或第二套 Context 管线。

采用判断遵循三条标准：能否解决当前已确认缺口，能否落入现有架构边界，能否维持作者授权、revision 校验和可逆写入。仅仅因为参考项目存在某项功能，不构成本项目增加该功能的理由。

## 14. 最终产品判断

7.29 版本解决了五类资料的入口、展示和基础编辑问题。本方案完成后，Story Bible 才具备以下成熟能力：

- 数据结构能够长期承载完整长篇小说。
- Agent 能可靠发现并安全操作所有条目。
- 章节完成后资料维护由系统主动发现；作者可以集中确认，也可以显式开启受限、可审计、可撤销的安全自动更新，不再依赖完全手工维护。
- AI 提供自动化效率，但作者始终通过维护模式和安全边界控制事实写入。
- 大项目、旧项目和多入口修改使用同一份可验证合同；跨资产事实具有原子性、审计记录和选择性回滚能力。
- Agent Context 的来源、取舍和实际发送内容对作者可解释、可调整、可复现。

## 15. 2026-08-02 实施验证记录

本方案全部批次及最终收口完成后，按风险边界执行了以下验证：

| 验证项                                                          | 结果                                              |
| --------------------------------------------------------------- | ------------------------------------------------- |
| 本次变更文件 Prettier                                           | 通过                                              |
| `npm run typecheck`                                             | 通过                                              |
| `npm run lint`                                                  | 通过                                              |
| `npm run build`                                                 | 通过；仅保留 Vite 既有的大 chunk 提示，无构建错误 |
| 最终 Story Bible / transaction / Renderer 聚焦测试              | 17 个文件、390 项通过                             |
| Electron E2E：`agent-write.e2e.ts`、`story-bible-visual.e2e.ts` | 7/7 通过                                          |
| `npm test` 全仓测试                                             | 242 个文件、2694 项通过                           |
| `git diff --check`                                              | 通过                                              |

验证覆盖安全自动来源伪造、破坏性 operation 和不完整组拒绝、Recovery 收据/写入项一一绑定及 v1.1 Story Bible 候选严格校验、事务故障与恢复、post-commit 状态同步失败、`partial_failure` 缓存失效、完成事件 IPC 校验、后台 scheduled 空窗、旧分析运行待审、人工确认引导与软提醒。

最终收口另覆盖以下边界：

- 打开、创建、示例创建、关闭和切换项目，以及创建/进入章节前，都会先保护 dirty Story Bible 草稿；保存失败、作者保留草稿或显式逆向预览拒绝取消时不会启动切换或清空投影。
- Agent 与 Story Analysis 对 v1.0 非规范路径只做只读候选准备；create→delete 完整 DAG 经一次校验、一个 Change Set revision 和一次持久化原子提案，半批次、语义冲突、未授权预审批拼接及持久化失败均 fail-closed；磁盘在确认前不变，确认后的同组事务由 History、receipt、Recovery、补偿和 undo 保留升级前原文字节。
- 手工保存非规范 v1.0 资料会先完成旧路径 CAS 与 History，再写最终 v1.1 规范文件并删除旧路径；History 失败时两条路径均不变化。
- Recovery 会拒绝伪造的迁移依赖、consistency group、asset ID、checksum、History 绑定及将迁移伪装成普通 create 的收据；普通 create 与安全自动生命周期禁令保持原行为。
- `get_story_bible_references` 使用权威章节目录，章节目录读取失败会显式传播，不会返回缺少章节影响的成功结果。
- Electron E2E 继续证明五类资料自然语言 CRUD、三主题×三视口和键盘工作流。

全仓历史格式债务不在本功能范围内；本次实际修改文件均单独通过格式检查。
