# Story Bible 核心资料重设计

**日期：** 2026-07-29

**状态：** Ready for implementation

**实现基线：** `fb48f8c`

**实施计划：** `docs/superpowers/plans/2026-07-29-story-bible-focused-redesign.md`

**范围：** 重做创作工作台中的故事资料信息架构、结构化编辑、伏笔追踪、AI 辅助识别和现有 Agent 写入后的刷新闭环；不新增第二套资料入口，不扩张为完整世界百科或关系图系统。

---

## 1. 背景与现状

当前故事资料已经具备 local-first 的 Repository、Application、IPC 和 Renderer 闭环，但产品形态仍是最小编辑器：

- 一级类目固定为人物、世界观、大纲、时间线、记忆。
- 左侧创作导航和主区重复展示相同分类与条目。
- 主区只编辑标题和一段摘要，已有的世界观子类型、关联 ID、大纲卷数据和时间线事件没有被完整展示。
- `MemoryRecord` 是 AI 上下文资产，却与作者资料并列，概念不一致。
- Story asset schema 已支持 `world.location`、`world.faction`、`world.rule`、`world.glossary`、`details` 和 `relatedEntityIds`，但 UI 将它们压成统一的“世界观摘要”。
- 右侧 Agent 在创作项目的 writing profile 下已经能读取、提议修改和创建 Story Bible 资产；默认写入经 Change Set 确认，但尚不支持伏笔类型，应用后也不会主动刷新资料主区。

竞品只吸收与当前产品定位匹配的共同做法：国内写作软件强调人物卡、卷章大纲、长篇伏笔和写作不中断；Plottr 强调情节追踪与章节节点；Scrivener 强调左侧资料组织和主区编辑。为了避免臃肿，本设计不复制其完整模块集合。

## 2. 已确认的产品决策

### 2.1 一级类目固定为五个

1. 人物
2. 世界观
3. 大纲
4. 伏笔
5. 时间线

类目数量与当前保持一致，只用“伏笔”替换面向 AI 的“记忆”。`MemoryRecord` 数据、Repository、IPC 和 Context candidate 能力全部保留，但不再出现在故事资料导航、条目列表或故事资料编辑器中。

地点、势力、规则和术语是世界观内部类型，不增加二级导航树。物品、情节线、灵感、关系图等不进入本期范围。

### 2.2 只保留现有入口

- 保留创作导航中的“写作 / 故事资料 / 项目文件”三个标签。
- 右侧 Agent 会话框保持原位置和交互，不增加“资料 / Agent”切换。
- Activity Bar 的 Story Bible 和时间线跳转继续复用现有导航行为。

### 2.3 主区采用“列表到详情”

- 左侧故事资料投影只显示五个类目、图标、数量和当前选中状态。
- 点击类目后，主区先显示该类目的紧凑列表或结构视图。
- 点击条目后，主区切换到详情编辑；面包屑和返回按钮回到该类目列表。
- 不在主区再次显示五类标签，不在左侧重复显示条目列表。
- 新建入口放在主区标题栏，使用加号菜单或带图标命令按钮。

## 3. 分类展示与编辑

### 3.1 公共外壳

所有列表共享标题栏、当前类目数量、搜索、状态筛选和新建命令。所有详情共享：

- 标题、别名、资产状态、摘要。
- 关联资料 `relatedEntityIds`。
- 创建时间、更新时间只读展示。
- 保存、放弃修改和返回列表。

资产状态继续使用 `active | draft | archived | deleted`。业务状态（例如伏笔是否已回收）不得复用资产状态字段。

UI 新建集合资产使用类型前缀加 32 位小写十六进制随机 ID，不再从中文标题生成 slug；前缀固定为人物 `chr_`、地点 `loc_`、势力 `fac_`、规则 `rule_`、术语 `term_`、伏笔 `fsh_`。旧 ID 原样保留，大纲和时间线继续使用固定单例 ID。

### 3.2 人物

人物默认使用紧凑列表，显示姓名、身份定位、资产状态和摘要。详情中的核心字段为：

- 姓名、别名、身份定位、简介。
- 外在目标、内在目标、主要冲突。
- 人物弧起点、转折、目标状态。
- 关联人物与关联章节。

扩展内容放入可折叠的“补充设定”，不让空字段占据首屏。旧人物根级未知字段和 `details` 未识别字段必须原样保留。

### 3.3 世界观

世界观只显示一份统一列表。列表顶部提供类型筛选：全部、地点、势力、规则、术语；行内显示类型标识、标题、状态和摘要。

创建时必须选择已有四种类型之一，不新增泛化 `world` 类型。详情按类型显示最少字段：

- 地点：地理、文化、限制。
- 势力：目标、结构、成员或影响范围。
- 规则：规则正文、适用范围、限制或例外。
- 术语：定义、别名、首次出现说明。

字段继续存入 `details`，公共关联使用 `relatedEntityIds`。

### 3.4 大纲

大纲仍是 `outline/outline.json` 单例。主区显示“卷章树 + 详情”：

- 卷节点显示卷名和卷摘要。
- 章节点解析项目中的真实章节标题，不复制章节正文。
- 章纲编辑目标、冲突、转折和备注。
- 未被任何卷引用的真实章节集中显示在“未归卷”。

本期以 `outline.details.volumes[].chapterIds` 作为大纲树的分卷和排序事实来源；章节 frontmatter 的可选 `volumeId` 不在本功能中自动重写。章纲字段存入 `outline.details.chapterOutlines[]`，以 `chapterId` 关联真实章节。删除章节后保留章纲数据但标记为“章节已不存在”，由用户决定移除，禁止静默丢弃。

### 3.5 伏笔

伏笔是集合资产，默认主视图为紧凑追踪列表，列为：标题、跟踪状态、埋设章节、计划回收章节、实际回收章节、更新时间。小窗口隐藏实际回收和更新时间列，将其放入行内次要信息。

跟踪状态固定为：

| 内部值            | 中文显示 |
| ----------------- | -------- |
| `planned`         | 待埋     |
| `planted`         | 已埋     |
| `progressing`     | 推进中   |
| `ready-to-payoff` | 待回收   |
| `paid-off`        | 已回收   |
| `abandoned`       | 已放弃   |

详情字段为摘要、跟踪状态、埋设章节、计划回收章节、实际回收章节、原文证据、备注和关联资料。手动新建默认 `planned`；状态改为 `paid-off` 时必须选择实际回收章节。

当项目当前章节顺序已经超过计划回收章节，且状态仍为 `planted | progressing | ready-to-payoff` 时，列表显示“逾期”标识。逾期是派生 UI 状态，不写入文件。

### 3.6 时间线

时间线仍是 `timeline/events.json` 单例。现有事件轨道保留，补齐事件编辑：顺序、时间标签、摘要、关联章节、人物、地点、前因和后果。主区列表到详情的规则与其他类目一致；不引入画布、缩放或自由拖拽系统。

## 4. 数据合同与兼容

### 4.1 Foreshadow asset v1.0

现有 `story-asset.schema.json` v1.0 和人物、世界观、大纲、时间线文件合同保持不变。新增独立的 `foreshadow.schema.json` v1.0，并在 Application 的 Story Bible 资产联合类型中增加 `foreshadow`：

```json
{
  "schemaVersion": "1.0",
  "id": "fsh_018f12a7b91c4a2f9437c3d764e9a120",
  "type": "foreshadow",
  "title": "旧钥匙的来源",
  "status": "active",
  "summary": "第一章出现的旧钥匙将在第五章揭示来源。",
  "details": {
    "trackingStatus": "planted",
    "plantedChapterId": "ch_01",
    "plannedPayoffChapterId": "ch_05",
    "sourceRefs": [
      {
        "chapterId": "ch_01",
        "excerpt": "他把那把生锈的钥匙收进袖口。",
        "excerptHash": "56374e8b304affcc245b8066dead2589da2d2ca3da274d3134024df81733b5b8"
      }
    ],
    "origin": "ai-confirmed",
    "notes": ""
  },
  "relatedEntityIds": ["chr_hero"],
  "createdAt": "2026-07-29T00:00:00.000Z",
  "updatedAt": "2026-07-29T00:00:00.000Z"
}
```

规则：

- 现有人物、世界观、大纲和时间线继续由 story asset v1.0 校验；不做 schema 升级或批量迁移。
- `type=foreshadow` 只由 foreshadow v1.0 schema 校验；其他类型不得写入伏笔目录。
- `foreshadows/<id>.json` 是唯一伏笔持久化路径。
- 伏笔 ID 使用 `fsh_<32-lowercase-hex>`，由应用身份工厂生成，并继续经过路径和 schema 校验。
- 证据原文先执行 Unicode NFC、换行归一为 LF、去除首尾空白，再对 UTF-8 字节计算 SHA-256；存储规范化后的原文和 64 位小写十六进制哈希。
- 非删除伏笔中相同 `chapterId + excerptHash` 视为重复来源。
- UI 修改现有 story asset 时必须合并原始对象，保留未知根字段和未知 `details` 字段。
- `MemoryRecord` schema 和目录不变。

### 4.2 Snapshot、搜索与 Context

- `StoryBibleSnapshot` 增加 `foreshadows` 集合，保留 `memories` 集合。
- 搜索索引增加 `story.foreshadow`；旧索引视为可重建缓存。任何手动或 Agent Story Bible 写入成功后都标记索引失效，下一次查询前自动重建。
- 伏笔搜索文本由标题、摘要、证据、备注和关联标题组成。
- Context Engine 不增加新的 `ContextRefType`。处于 `active` 且未放弃的伏笔映射为 `goal` candidate，`sourceRefs.entityType` 使用 `foreshadow`，仍由现有预算和显式选择策略决定是否注入。
- “记忆”仍可作为 AI candidate，但不回到作者资料 UI。
- `StoryBibleSession` 通过只读 Chapter Catalog port 获得稳定章节 ID 和顺序，用于引用校验与逾期判断；不得由 Story Bible Repository 直接读取章节文件。

## 5. AI 辅助识别

伏笔列表标题栏提供“AI 识别”命令。它是独立的只读分析流程，不直接调用保存接口：

1. 用户选择当前章节或最多五个指定章节。
2. Main/Application 从 Chapter Repository 读取已保存正文；只有被选中的章节正处于未保存编辑状态时，才要求先保存或取消扫描。
3. 分析请求同时携带现有未删除伏笔的 ID、标题、摘要和来源哈希，供模型判断重复、推进或回收。
4. 请求提示模型只返回 JSON，并在 Provider 支持时附带 `responseFormat=json_object`；Application 始终对实际响应执行 foreshadow candidate schema 校验，不能信任 Provider 声明。解析或校验失败时不产生任何写入。
5. 候选分为 `new | progress | payoff`，展示原文证据、判断理由、建议状态和目标伏笔。
6. 用户逐项勾选并确认；未勾选候选直接丢弃。
7. 新候选保存为 `planted`，自动写入埋设章节和 `origin=ai-confirmed`；推进和回收候选显示字段差异，确认后才更新目标伏笔。
8. 同一次分析中指向同一伏笔的已选推进/回收候选按章节 order 合并为一次更新：追加去重后的来源证据，以最后的回收候选决定 `paid-off` 和实际回收章节，再展示一份最终 diff。

模型不得自动创建、自动改变状态或后台持续扫描。扫描上下文超过当前模型预算时返回可诊断错误，提示减少章节选择，不静默截断正文。

## 6. 现有 Agent 集成

右侧 Agent 继续使用现有 writing profile 和 Change Set：

- planning 模式只能读取和提出方案。
- execution 模式可读取、创建和修改五类 Story Bible 资产。
- 默认 `write_before_confirmation` 仍等待作者审批；用户明确预授权的 run 继续遵守现有策略。
- Agent 的 Story Bible 创建 allowlist 和路径解析增加 `foreshadow -> foreshadows/<id>.json`。
- Agent 新建或修改伏笔必须通过 foreshadow v1.0 schema；其他 Story Bible 类型继续通过原 story asset v1.0 schema，不能绕过 Repository/Change Set 验证。

进入某个资料详情时，该 `story_bible:<assetId>` 作为下一次 Agent run 的活动资料引用，当前章节引用仍保留；返回分类列表时移除活动资料引用。若当前详情存在未保存修改，启动任何会读取该资料的 Agent run 前统一要求“保存 / 放弃 / 取消”，不得让 Agent 静默读取旧磁盘版本。

Agent Change Set 应用后，Renderer 根据受影响的 Story Bible 路径使搜索索引失效并重新加载 snapshot。若资料编辑器没有未保存修改，则刷新并定位到唯一的新建或修改条目；若存在未保存修改，则保持当前草稿并显示“资料已在外部更新”，由用户选择重新加载或继续编辑，禁止静默覆盖。

## 7. 空态、错误与响应式

- 空分类显示一句状态和唯一的新建命令，不显示功能说明墙。
- 搜索无结果提供清除筛选操作。
- 章节引用失效时显示“章节已不存在”，但仍允许编辑和清理引用。
- 保存失败保留表单内容；AI 扫描失败保留已选择章节；Agent 外部更新不得丢失本地草稿。
- 1440×900 使用完整列；1024×900 隐藏次要列；720×640 使用堆叠行和单列详情。
- 覆盖浅色、深色和 ink-gold 主题；不增加卡片墙、嵌套卡片或横向溢出。

## 8. 非目标

- 不新增物品、情节线、灵感等一级或二级类目。
- 不做人物关系图、世界地图、自由画布或伏笔看板。
- 不做正文实体高亮、后台持续扫描或未经确认的 AI 写入。
- 不迁移或删除 memories，不重构 Agent 会话系统。
- 不改变章节正文格式，不批量改写旧项目资料。

## 9. 验收标准

1. 故事资料一级导航只显示人物、世界观、大纲、伏笔、时间线。
2. 左侧无条目重复列表，主区完成列表到详情的完整新增、编辑和保存流程。
3. 世界观四种既有类型可筛选并显示对应字段。
4. 大纲按卷章树展示真实章节，未归卷和失效引用可辨识。
5. 伏笔可从待埋流转到已回收，逾期状态正确派生。
6. AI 扫描只生成候选，作者确认前项目文件零变化，重复来源不重复创建。
7. 右侧 Agent 可以通过审批链新增或修改伏笔，应用后主区安全刷新。
8. v1.0 项目无损打开，memory 数据继续参与既有 AI 上下文但不显示在故事资料 UI。
9. 搜索、Context candidate、IPC 安全白名单和 Agent general-file 隔离保持有效。
10. 三种主题与三个目标窗口尺寸下无文本截断、控件重叠或不可访问操作。
