# Story Bible 核心资料重设计实施计划

**日期：** 2026-07-29

**状态：** Ready

**设计依据：** `docs/superpowers/specs/2026-07-29-story-bible-focused-redesign-design.md`

**实现基线：** `fb48f8c`

## 1. 交付原则

- 只交付人物、世界观、大纲、伏笔、时间线五类；不顺手增加其他资料模块。
- 先完成手动资料闭环，再接 AI 识别和 Agent 刷新，避免模型能力掩盖基础数据问题。
- Story Bible 文件继续由 Repository 校验并原子写入；Renderer 不直接访问文件系统。
- 所有模型结果先处于候选或 Change Set 状态，用户确认前不得写入项目。
- 现有 story asset v1.0 合同保持不变；伏笔使用独立 schema，打开或保存旧项目均不触发批量迁移。
- 每个批次完成后运行最窄测试；全部批次结束后再跑完整门禁和视觉验收。

## 2. 批次总览

| 批次 | 结果                     | 主要边界                                         |
| ---- | ------------------------ | ------------------------------------------------ |
| A    | 伏笔数据合同与持久化     | schemas、repository、application、search/context |
| B    | 五类 UI 信息架构         | UI DTO、导航、主区列表到详情、结构化草稿         |
| C    | 分类专属视图             | 世界观筛选、大纲树、伏笔追踪、时间线详情         |
| D    | AI 伏笔候选识别          | 分析 session、IPC/preload、候选确认 UI           |
| E    | Agent 伏笔写入与安全刷新 | tool allowlist、Change Set、dirty guard、定位    |
| F    | 回归与视觉验收           | 兼容、主题、响应式、全量门禁                     |

## 3. 批次 A：数据合同与持久化

### A1. 新增 Foreshadow asset v1.0

涉及：`packages/schemas`、Application/Repository Story Bible 类型。

- [ ] 保持 `story-asset.schema.json` v1.0 不变，新增 `foreshadow.schema.json` v1.0。
- [ ] 在 Application/Repository 的 Story Bible 资产联合类型中增加 `foreshadow`，并按 type 选择对应 schema。
- [ ] Foreshadow schema 要求公共资产外壳和 `details.trackingStatus`，允许保留未知用户字段。
- [ ] 校验伏笔章节 ID、来源引用、SHA-256 哈希和 `paid-off` 的实际回收章节。
- [ ] 定义共享的伏笔详情、来源引用和跟踪状态 TypeScript 类型，避免 UI、Application、Repository 各自声明不同枚举。
- [ ] 定义证据规范化 helper：Unicode NFC、CRLF/CR 转 LF、首尾 trim 后计算 UTF-8 SHA-256；读取时校验，写入和 AI 候选确认时复用。
- [ ] 现有资产读写继续保留未知根字段和未知 `details` 字段，不因本功能升级 schemaVersion。

测试：

- v1.0 人物、世界观、大纲、时间线继续通过且保存后 schemaVersion 不变。
- 合法 foreshadow v1.0 通过；缺失跟踪状态、非法章节 ID、非法哈希和已回收无实际章节被拒绝。
- 旧资产显式保存后未知字段未丢失。

### A2. Repository 与 Snapshot

- [ ] `StoryBibleFileRepository` 读取 `foreshadows/**/*.json`，按标题稳定排序。
- [ ] `saveStoryAsset` 将 `foreshadow` 仅写入 `foreshadows/<id>.json`，继续使用原子写。
- [ ] `StoryBibleSnapshot` 增加 `foreshadows`，保留 `memories`。
- [ ] 为 `StoryBibleSessionOptions` 增加只读 Chapter Catalog port；生产组合注入项目章节 catalog，测试使用 in-memory port。
- [ ] 一致性检查通过 catalog 识别失效章节引用、重复 `chapterId + excerptHash` 和已回收缺失实际章节；重复问题只报一次。
- [ ] `latestUpdatedAt`、摘要计数和项目 outline index 纳入伏笔，memory 行为不变。

测试：

- 空目录返回空集合。
- 伏笔保存、加载、非法路径/非法内容拒绝。
- 旧项目没有 `foreshadows/` 时 snapshot 正常。
- 重复来源和失效引用生成稳定 issue ID。

### A3. 搜索与 Context

- [ ] 搜索类型增加 `story.foreshadow`，索引标题、摘要、证据和备注。
- [ ] 搜索缓存 schema 升级；旧缓存触发安全重建，不影响源文件。
- [ ] 为搜索 session/repository 增加显式 invalidation；手动 Story Bible 保存和 Agent 应用受管资料变更后标记失效，下一次查询前自动重建。
- [ ] 搜索结果点击打开伏笔详情。
- [ ] active 且未放弃的伏笔映射为 `goal` candidate，source entity type 为 `foreshadow`；不扩展 Context Engine 公共 ref 枚举。
- [ ] memories 继续构建 candidate，但不进入新的故事资料 UI DTO。

定向验证：

```powershell
npm exec vitest -- packages/schemas/test/schema-contract.test.ts packages/repository/test/story-bible-repository.test.ts packages/repository/test/search-index-repository.test.ts packages/application/test/story-bible-session.test.ts
```

## 4. 批次 B：五类导航与主区骨架

### B1. 重构 UI DTO

涉及：`packages/ui/src/workspace-shell-types.ts`、Renderer Story Bible bridge。

- [ ] `StoryBibleEditorKind` 固定为 `character | world | outline | foreshadow | timeline`。
- [ ] 从作者 UI DTO 移除 memory entry；不得删除 Application snapshot 中的 memories。
- [ ] Entry DTO 增加底层 asset type、结构化 details、别名、关联 ID 和时间戳。
- [ ] Editor DTO 接收只含 ID、标题、order、状态的章节选项和当前章节 ID，不向 UI Story Bible 层传递章节正文。
- [ ] Draft 使用可辨识联合类型，分类字段由类型约束；Bridge 保存时合并原始资产，保留所有未知字段。
- [ ] Bridge 增加 `viewMode: list | detail`、`dirty`、分类筛选和外部更新状态。
- [ ] 新建集合资产使用可注入身份工厂生成 32 位小写十六进制 ID；前缀固定为 `chr_ | loc_ | fac_ | rule_ | term_ | fsh_`，移除标题 slug 作为 ID 的逻辑，旧 ID 不变。
- [ ] `selectKind` 打开列表，`selectEntry` 打开详情，保存后保持当前详情，新建取消后回列表。

### B2. 精简左侧导航

- [ ] `CreativeWorkspaceNavigator` 只渲染五个类目和计数。
- [ ] 删除左侧当前分类条目列表和重复的新建区域。
- [ ] 保留现有“写作 / 故事资料 / 项目文件”标签、键盘导航和搜索状态隔离。
- [ ] 记忆不出现在故事资料分类、计数和筛选占位文案中。

### B3. 主区列表到详情

- [ ] 用单一 Story Bible 标题栏承载返回、标题、搜索、筛选和新建。
- [ ] 分类处于 list 模式时渲染分类主视图；detail 模式时渲染结构化表单。
- [ ] 移除主区现有五类 tabs 和重复条目 aside。
- [ ] 保存失败保留 draft；有未保存修改时返回列表需要“保存 / 放弃 / 取消”守门。
- [ ] 采用现有图标库和表单组件；不创建卡片墙或嵌套卡片。

定向验证：

```powershell
npm exec vitest -- packages/ui/test/workspace-navigator.test.tsx packages/ui/test/workspace-shell.test.tsx apps/desktop/test/story-bible-bridge.test.ts
```

## 5. 批次 C：分类专属视图

### C1. 人物与世界观

- [ ] 人物列表显示姓名、身份、状态、摘要；详情显示核心人物字段和折叠补充设定。
- [ ] 世界观统一列表提供全部/地点/势力/规则/术语筛选，筛选不改变一级类目。
- [ ] 世界观新建必须先选已有四种 asset type；不提供泛化 world 或物品类型。
- [ ] 类型切换只允许新草稿使用；已有资产不可在 UI 中跨类型改写。

### C2. 大纲卷章树

- [ ] 解析 `outline.details.volumes` 和 `chapterOutlines`，与真实章节 catalog 按 ID 联结。
- [ ] 卷树顺序使用 volumes 顺序，章顺序使用各卷 `chapterIds` 顺序；未引用章节进入“未归卷”。
- [ ] 支持新增、重命名、排序卷，向卷中加入/移出真实章节，并编辑卷摘要与章纲。
- [ ] 同一章节不得同时属于两个卷；保存前验证重复和不存在的章节 ID。
- [ ] 已不存在章节保留占位与章纲，用户显式清理后才删除引用。

### C3. 伏笔追踪

- [ ] 列表实现状态、章节、更新时间列和派生“逾期”标识。
- [ ] 详情实现六种状态、章节选择器、证据列表、备注和关联资料。
- [ ] 手动新建默认 `planned`；切到 `paid-off` 时实际回收章节必填。
- [ ] 章节选择器按真实章节 order 排序并显示标题，文件中只存稳定 ID。
- [ ] 重复来源在保存前给出明确错误，不自动合并。

### C4. 时间线详情

- [ ] 将现有时间线事件轨道纳入新的 list 模式。
- [ ] 详情支持顺序、时间标签、摘要、章节、人物、地点、前因和后果。
- [ ] 保持时间线单例和既有搜索/Activity Bar 跳转。

定向验证：

```powershell
npm exec vitest -- packages/ui/test/workspace-shell.test.tsx packages/ui/test/workspace-navigator.test.tsx apps/desktop/test/story-bible-bridge.test.ts apps/desktop/test/workspace-navigation.test.ts
```

## 6. 批次 D：AI 伏笔候选识别

### D1. Application 分析合同

- [ ] 新建只读 `ForeshadowAnalysisSession`，依赖 Chapter Repository、Story Bible Repository、模型 profile resolver 和 LLM adapter。
- [ ] 输入为 1–5 个已保存章节 ID；输出包含 analysis ID、候选数组、使用量和可诊断错误。
- [ ] 候选联合类型固定为 `new | progress | payoff`；均包含证据、理由、章节 ID、建议字段和稳定 candidate ID。
- [ ] 请求中指示只返回 JSON，并在 Provider 支持时设置 `responseFormat=json_object`；无论能力声明如何都对实际响应执行 candidate schema 校验，失败时返回 `FORESHADOW_SCAN_OUTPUT_INVALID`，不得保存半结构化结果。
- [ ] 将现有未删除伏笔的标题、摘要和来源哈希作为有界去重上下文；正文超过模型预算时整体失败并提示减少选择，不截断。
- [ ] 测试只使用 mock provider，CI 不调用真实模型。

### D2. API、IPC 与 preload

- [ ] 在 `NovelStudioApi.storyBible` 增加 `detectForeshadows(input)` 只读方法。
- [ ] Main handler 对 chapter ID 数量、格式和结构化返回值再次收窄；白名单和 Electron security 测试同步更新。
- [ ] Renderer 只接收候选 DTO，不接收文件路径或模型密钥。
- [ ] 取消或关闭候选审查不产生持久化副作用。

### D3. 候选审查 UI

- [ ] “AI 识别”打开章节选择器，默认选中当前章节；最多五章。
- [ ] 只有所选章节包含当前 dirty 章节时才要求保存或取消；未选择的 dirty 章节不阻止扫描。
- [ ] 候选列表显示类型、原文证据、理由、建议变更和重复提示。
- [ ] 用户逐项勾选；确认时 new 创建 `planted` 伏笔，progress/payoff 生成目标字段 diff 后保存。
- [ ] 同一目标伏笔的已选 progress/payoff 按章节 order 合并为一次更新，来源证据去重，最后一个 payoff 决定最终回收章节；确认前展示合并后的单一 diff。
- [ ] 部分保存失败时逐项显示结果，已成功项不重复提交，失败项可重试。
- [ ] AI 不改变右侧 Agent 的会话、运行模式或上下文草稿。

定向验证：

```powershell
npm exec vitest -- packages/application/test/foreshadow-analysis-session.test.ts apps/desktop/test/story-bible-ipc.test.ts apps/desktop/test/electron-security.test.ts packages/ui/test/workspace-shell.test.tsx
```

## 7. 批次 E：现有 Agent 闭环

### E1. 工具与路径

- [ ] `propose_story_bible_write` / v2 `create_resource` 接受 `assetType=foreshadow`。
- [ ] 创建路径严格解析为 `foreshadows/<id>.json`；未知类型必须显式拒绝，禁止兜底到时间线文件。
- [ ] Agent managed-resource 路径识别、schema 分类、搜索引用和 workspace outline 索引纳入 foreshadows。
- [ ] writing profile 可读写伏笔；general_file 和 standalone 继续拒绝所有 Story Bible 专用操作。
- [ ] 新建和编辑继续生成 Change Set；伏笔通过 foreshadow v1.0 schema，其他类型通过原 story asset v1.0 schema。
- [ ] 更新 writing guidance 和工具说明，明确伏笔 ID/字段合同以及“先读后改、确认前只提案”；不把字段规则复制成第二套运行时 validator。

### E2. Renderer 刷新与冲突

- [ ] 资料详情打开时把 `story_bible:<assetId>` 同步为下一次 writing Agent run 的活动资料引用，同时保留当前章节引用；返回列表后移除。
- [ ] 当前资料 dirty 时，Agent run 启动前复用“保存 / 放弃 / 取消”守门，禁止模型读取旧磁盘资产。
- [ ] 监听已应用 Change Set 的受影响路径并以 version group ID 去重刷新。
- [ ] 受管 Story Bible 路径应用成功后使搜索索引失效；无 dirty 草稿时重新加载 snapshot，若只有一个资产受影响则定位到该详情。
- [ ] 有 dirty 草稿时不覆盖，显示外部更新提示以及“重新加载 / 继续编辑”。
- [ ] 继续编辑后保存使用最新基线校验；基线已变化时显示冲突，不覆盖 Agent 结果。
- [ ] Agent 创建、修改、拒绝和撤销后，导航计数、索引失效状态和主区状态保持一致；拒绝不触发虚假刷新。

定向验证：

```powershell
npm exec vitest -- packages/agent-engine/test/tool-registry.test.ts packages/application/test/agent-run-session.test.ts apps/desktop/test/desktop-agent-run-runtime.test.ts apps/desktop/test/agent-run-bridge.test.ts
```

## 8. 批次 F：兼容、视觉与完整门禁

### F1. 兼容场景

- [ ] 无 Story Bible、只有 v1.0 资产、包含未知字段、缺少 foreshadows 目录的项目均可打开。
- [ ] memories 文件仍可读写、可构建 Context candidate，且故事资料 UI 中完全不可见。
- [ ] 旧搜索 cache 可重建；清理 cache 不影响任何 Story Bible 源数据。
- [ ] Agent planning、execution/default approval、preapproved、general_file 和 standalone 权限矩阵无回归。

### F2. 视觉与可访问性

- [ ] Playwright 验收 1440×900、1024×900、720×640。
- [ ] 每个尺寸覆盖人物列表、世界观筛选、大纲树、伏笔列表/详情和时间线。
- [ ] 覆盖浅色、深色、ink-gold；检查无水平滚动、重叠、截断和布局跳动。
- [ ] 键盘可完成类目切换、搜索、列表选择、返回、保存和候选确认。
- [ ] 图标按钮具有可访问名称和 tooltip，状态不只依赖颜色表达。

### F3. 门禁

先运行受影响包，再运行完整检查：

```powershell
npm run typecheck
npm run lint
npm run test -- --no-file-parallelism
npm run test:contract
npm run build
npm run package:check
```

检查最终 diff，确认没有：

- [ ] 新增未批准的故事资料类目。
- [ ] Renderer 文件系统访问或绕过 schema 的写入。
- [ ] memory 数据删除或静默迁移。
- [ ] AI/Agent 未经确认写入。
- [ ] 未知字段丢失、旧项目批量改写或缓存成为事实来源。

## 9. 完成定义

只有以下条件全部满足才能标记完成：

1. 五类导航与主区列表到详情在真实创作项目中可用。
2. 四种世界观类型、大纲卷章、伏笔闭环和时间线编辑均能持久化并恢复。
3. AI 扫描的候选确认前零写入，确认后可审计且可去重。
4. 右侧 Agent 能在现有审批链中新增和修改伏笔，主区不会因刷新丢失草稿。
5. v1.0 项目和 memories 行为兼容，搜索与 Context 能识别伏笔。
6. 定向测试、完整门禁和三个尺寸/主题的视觉验收全部通过。
