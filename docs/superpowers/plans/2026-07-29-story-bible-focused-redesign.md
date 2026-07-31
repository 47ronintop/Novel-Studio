# Story Bible 核心资料重设计实施计划

**日期：** 2026-07-29

**状态：** Ready

**设计依据：** `docs/superpowers/specs/2026-07-29-story-bible-focused-redesign-design.md`

**实现基线：** `64da637`

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
| A    | 伏笔数据合同与持久化     | schema、repository、search/context、缓存生命周期 |
| B    | 五类 UI 信息架构         | UI DTO、导航、列表到详情、结构化草稿、样式       |
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

- [ ] `StoryBibleFileRepository` 只读取直接子文件 `foreshadows/<id>.json`；集合使用固定 `zh-CN` 排序器并以 ID 作为同名兜底，不接受嵌套路径作为伏笔资产。
- [ ] `saveStoryAsset` 将 `foreshadow` 仅写入 `foreshadows/<id>.json`，继续使用原子写。
- [ ] `StoryBibleSnapshot` 增加 `foreshadows`，保留 `memories`。
- [ ] 为 `StoryBibleSessionOptions` 增加 `Pick<ChapterCatalogRepositoryPort, "listChapters">` 等价的只读窄接口；不得注入 `createChapter`，生产组合注入项目章节 catalog，测试使用 in-memory port。
- [ ] 一致性检查通过 catalog 识别失效章节引用、重复 `chapterId + excerptHash` 和已回收缺失实际章节；重复问题只报一次。
- [ ] `latestUpdatedAt`、摘要计数和项目 outline index 纳入伏笔，memory 行为不变。

测试：

- 空目录返回空集合。
- 伏笔保存、加载、非法路径/非法内容拒绝。
- 旧项目没有 `foreshadows/` 时 snapshot 正常。
- 重复来源和失效引用生成稳定 issue ID。

### A3. 搜索与 Context

- [ ] 搜索类型增加 `story.foreshadow`，索引标题、摘要、证据和备注。
- [ ] `search-index.schema.json` 和 `ProjectSearchIndex` 保持 `schemaVersion=1.0`，只扩展 entry type enum；不得为新增枚举值迁移或批量改写旧缓存。
- [ ] 搜索结果点击打开伏笔详情。
- [ ] active 且未放弃的伏笔映射为 `goal` candidate，source entity type 为 `foreshadow`；不扩展 Context Engine 公共 ref 枚举。
- [ ] memories 继续构建 candidate 并保留 `memory` 搜索类型；搜索/Context 类型不得与不含 memory 的 UI kind 合并。

### A4. 搜索索引失效所有权

- [ ] DesktopApplication 在项目激活时创建并持有唯一的项目级 `ProjectSearchSession`，切换或关闭项目时释放；不再由每次 search/rebuild 调用临时创建 session。
- [ ] Session 增加 `invalidate(reason)`、`clean | dirty` 状态和共享的 in-flight rebuild promise；dirty 状态下的并发查询只触发一次重建。invalidation 必须串行排在正在执行的 rebuild 之后，并在后续查询前完成，旧 rebuild 不得在失效后重新发布缓存。
- [ ] `ProjectSearchRepositoryPort.invalidate()` 清空内存 snapshot，并仅移除可重建的 `cache/indexes/search.json`；文件不存在时幂等成功，失败时 Session 保持 dirty 并返回可诊断警告，不得删除或改写任何源文件，也不得把已经成功的 Story Bible 写入反报为失败。
- [ ] 手动 Story Bible 保存和 AI 候选确认写入成功后由 Application 置 dirty；失败写入不得置 dirty。
- [ ] Agent Change Set apply 或 undo 成功后，只有受影响路径属于受管 Story Bible 时置 dirty；reject、失败 apply 和失败 undo 不得触发失效。
- [ ] Renderer 只消费刷新结果，不保存搜索 dirty flag，也不直接删除或改写索引文件。
- [ ] 测试覆盖持久 session 生命周期、并发查询只重建一次、rebuild 期间发生 invalidation、invalidate 后缓存文件消失、重启不读取旧缓存，以及失败/reject 不触发失效。

定向验证：

```powershell
npm exec vitest -- packages/schemas/test/schema-contract.test.ts packages/repository/test/story-bible-repository.test.ts packages/repository/test/search-index-repository.test.ts packages/application/test/story-bible-session.test.ts packages/application/test/project-search-session.test.ts packages/application/test/desktop-project-search.test.ts
```

## 4. 批次 B：五类导航与主区骨架

### B1. 重构 UI DTO

涉及：`packages/ui/src/workspace-shell-types.ts`、Renderer Story Bible bridge。

- [ ] `StoryBibleEditorKind` 固定为 `character | world | outline | foreshadow | timeline`。
- [ ] 从作者 UI DTO 移除 memory entry；不得删除 Application snapshot 中的 memories。
- [ ] 明确类型分叉：`StoryBibleEditorKind` 不含 memory；`ProjectSearchEntryType` 保留 memory 并增加 `story.foreshadow`；`searchResultTypeLabel("memory")` 和 memory Context 映射不得被顺手删除。
- [ ] Application consistency ref 可继续包含 memory，但 Renderer 的 Story Bible consistency DTO 不得把它强转为 UI kind；memory-backed issue 不进入故事资料的可导航问题列表。
- [ ] Entry DTO 增加底层 asset type、结构化 details、别名、关联 ID 和时间戳。
- [ ] Editor DTO 接收只含 ID、标题、order、状态的章节选项和当前章节 ID，不向 UI Story Bible 层传递章节正文。
- [ ] Draft 使用可辨识联合类型，分类字段由类型约束；`onDraftChange`/Bridge patch 与当前 kind 绑定，运行时拒绝修改 kind 或混入其他分类字段；保存时合并原始资产并保留所有未知字段。
- [ ] Bridge 增加 `viewMode: list | detail`、`dirty`、分类筛选和外部更新状态。
- [ ] 新建集合资产使用可注入身份工厂生成 32 位小写十六进制 ID；前缀固定为 `chr_ | loc_ | fac_ | rule_ | term_ | fsh_`，移除标题 slug 作为 ID 的逻辑，旧 ID 不变。
- [ ] `selectKind` 打开列表，`selectEntry` 打开详情，保存后保持当前详情，新建取消后回列表。
- [ ] 同步清理 `story-bible-bridge.ts`、`CreativeWorkspaceNavigator` 和 `StoryBibleEditorView` 中的 memory 分支、选项和文案；搜索结果中的 memory 分支保持不变。

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
- [ ] Activity Bar 的 Story Bible 入口恢复当前资料视图；时间线入口设置 `kind=timeline, viewMode=list`，事件点击进入 `timeline/detail`，返回时回到时间线列表，不沿用人物等旧状态。

### B4. 样式与响应式实现

- [ ] 在 `packages/ui/src/styles.css` 重构现有 `ns-story-*` 规则，并补齐紧凑列表、伏笔列、大纲卷章树、详情表单和外部更新提示；移除被新结构替代的旧 tabs/aside 规则。
- [ ] 复用现有颜色、间距、焦点和三主题变量，不复制一套 Story Bible 专用主题值。
- [ ] 优先复用现有 1279/900/760 等断点：宽屏完整列，中等宽度隐藏次要列，窄屏使用堆叠行和单列详情；1440×900、1024×900、720×640 是验收视口而不是必须新增的 media query。
- [ ] 为表格列、列表行、图标按钮和详情布局提供稳定尺寸约束，动态状态和长中文标题不得引发布局跳动或横向溢出。

定向验证：

```powershell
npm exec vitest -- packages/ui/test/workspace-navigator.test.tsx packages/ui/test/workspace-shell.test.tsx apps/desktop/test/story-bible-bridge.test.ts apps/desktop/test/workspace-navigation.test.ts
```

## 5. 批次 C：分类专属视图

### C1. 人物与世界观

- [x] 人物列表显示姓名、身份、状态、摘要；详情显示核心人物字段和折叠补充设定。
- [x] 世界观统一列表提供全部/地点/势力/规则/术语筛选，筛选不改变一级类目。
- [x] 世界观新建必须先选已有四种 asset type；不提供泛化 world 或物品类型。
- [x] 类型切换只允许新草稿使用；已有资产不可在 UI 中跨类型改写。

### C2. 大纲卷章树

- [x] 解析 `outline.details.volumes` 和 `chapterOutlines`，与真实章节 catalog 按 ID 联结。
- [x] 卷树顺序使用 volumes 顺序，章顺序使用各卷 `chapterIds` 顺序；未引用章节进入“未归卷”。
- [x] 支持新增、重命名、排序卷，向卷中加入/移出真实章节，并编辑卷摘要与章纲。
- [x] 同一章节不得同时属于两个卷；保存前验证重复和不存在的章节 ID。
- [x] 已不存在章节保留占位与章纲，用户显式清理后才删除引用。

### C3. 伏笔追踪

- [x] 列表实现状态、章节、更新时间列和派生“逾期”标识。
- [x] 详情实现六种状态、章节选择器、证据列表、备注和关联资料。
- [x] 手动新建默认 `planned`；切到 `paid-off` 时实际回收章节必填。
- [x] 章节选择器按真实章节 order 排序并显示标题，文件中只存稳定 ID。
- [x] 重复来源在保存前给出明确错误，不自动合并。

### C4. 时间线详情

- [x] 将现有时间线事件轨道纳入新的 list 模式。
- [x] 详情支持顺序、时间标签、摘要、章节、人物、地点、前因和后果。
- [x] 保持时间线单例和既有搜索/Activity Bar 跳转。

定向验证：

```powershell
npm exec vitest -- packages/ui/test/workspace-shell.test.tsx packages/ui/test/workspace-navigator.test.tsx apps/desktop/test/story-bible-bridge.test.ts apps/desktop/test/workspace-navigation.test.ts
```

## 6. 批次 D：AI 伏笔候选识别

### D1. Application 分析合同

- [x] 新建只读 `ForeshadowAnalysisSession`，依赖 Chapter Repository、Story Bible Repository、模型 profile resolver 和 LLM adapter。
- [x] 输入为 1–5 个已保存章节 ID；输出包含 analysis ID、候选数组、使用量和可诊断错误。
- [x] 候选联合类型固定为 `new | progress | payoff`；均包含证据、理由、章节 ID、建议字段和稳定 candidate ID。
- [x] 请求中指示只返回 JSON，并与现有 AI 写作请求一致，无条件携带 `responseFormat={ type: "json_object" }` 元数据；当前 Provider 不消费该字段，本期不新增 JSON capability 分支，无论如何都对实际响应执行 candidate schema 校验，失败时返回 `FORESHADOW_SCAN_OUTPUT_INVALID`，不得保存半结构化结果。
- [x] 将现有未删除伏笔的标题、摘要和来源哈希作为有界去重上下文；发送前使用已解析的 model context window、输出预留和现有确定性 token estimator 预检完整请求，超限返回 `FORESHADOW_SCAN_CONTEXT_TOO_LARGE`，不调用 Provider、不截断。
- [x] 测试只使用 mock provider，CI 不调用真实模型。
- [x] 测试断言预算超限时 provider 调用次数为零，非法 JSON/不合 schema 的响应不产生候选或写入。

### D2. API、IPC 与 preload

- [x] 在 `NovelStudioApi.storyBible` 增加 `detectForeshadows(input)` 只读方法。
- [x] Main handler 对 chapter ID 数量、格式和结构化返回值再次收窄；白名单和 Electron security 测试同步更新。
- [x] Renderer 只接收候选 DTO，不接收文件路径或模型密钥。
- [x] 取消或关闭候选审查不产生持久化副作用。

### D3. 候选审查 UI

- [x] “AI 识别”打开章节选择器，默认选中当前章节；最多五章。
- [x] 只有所选章节包含当前 dirty 章节时才要求保存或取消；未选择的 dirty 章节不阻止扫描。
- [x] 候选列表显示类型、原文证据、理由、建议变更和重复提示。
- [x] 用户逐项勾选；确认时 new 创建 `planted` 伏笔，progress/payoff 生成目标字段 diff 后保存。
- [x] 同一目标伏笔的已选 progress/payoff 按章节 order 合并为一次更新，来源证据去重，最后一个 payoff 决定最终回收章节；确认前展示合并后的单一 diff。
- [x] 部分保存失败时逐项显示结果，已成功项不重复提交，失败项可重试。
- [x] AI 不改变右侧 Agent 的会话、运行模式或上下文草稿。

定向验证：

```powershell
npm exec vitest -- packages/application/test/foreshadow-analysis-session.test.ts apps/desktop/test/story-bible-ipc.test.ts apps/desktop/test/electron-security.test.ts packages/ui/test/workspace-shell.test.tsx
```

## 7. 批次 E：现有 Agent 闭环

### E1. 工具与路径

- [x] `propose_story_bible_write` / v2 `create_resource` 接受 `assetType=foreshadow`。
- [x] 抽取 create/edit 共用的穷举 asset type/path resolver；`foreshadow` 严格解析为 `foreshadows/<id>.json`，`timeline.events` 才能解析为 `timeline/events.json`，未知类型显式拒绝且没有 default fallback。
- [x] 修正 `apps/desktop/src/main/agent-run-runtime.ts` 的 `findStoryBibleAsset` 和 `storyBibleAssetRelativePath`：编辑候选加入 foreshadows、排除 memories，并让无法解析的路径返回校验错误，不能把 memory/foreshadow/未知类型落到时间线。
- [x] `schemaNameForProjectText`、Agent managed-resource 路径识别、搜索引用和 workspace outline 索引纳入 `foreshadows/<id>.json`，并选择 foreshadow v1.0 schema。
- [x] `DEFAULT_MANAGED_PATH_SEGMENTS` 增加 `foreshadows`，项目文件和 general-file 路径拒绝直接写入；policy 不做项目数据迁移，内部调用方/测试更新到新默认值，缺少该 segment 的注入 policy 继续 fail closed。
- [x] writing profile 可读写伏笔；general_file 和 standalone 继续拒绝所有 Story Bible 专用操作。
- [x] 新建和编辑继续生成 Change Set；伏笔通过 foreshadow v1.0 schema，其他类型通过原 story asset v1.0 schema。
- [x] 更新 writing guidance 和工具说明，明确伏笔 ID/字段合同以及“先读后改、确认前只提案”；不把字段规则复制成第二套运行时 validator。
- [x] 回归测试覆盖：编辑 foreshadow 命中 `foreshadows/<id>.json`；`story_bible:<memoryId>` 和未知类型被拒绝且 `timeline/events.json` 不变；项目文件/general-file 无法把 foreshadows 当普通文本写入。

### E2. Application 失效、Renderer 刷新与冲突

- [x] 资料详情打开时把 `story_bible:<assetId>` 同步为下一次 writing Agent run 的活动资料引用，同时保留当前章节引用；返回列表后移除。
- [x] 当前资料 dirty 时，Agent run 启动前复用“保存 / 放弃 / 取消”守门，禁止模型读取旧磁盘资产。
- [x] apply 和 undo 成功后都返回受影响路径与 version group ID；Main/Application 对受管 Story Bible 路径调用 A4 的 `invalidate`，Renderer 以 version group ID 去重刷新。
- [x] 无 dirty 草稿时重新加载 snapshot；若 apply 只创建或修改一个资产则定位到该详情，undo 后定位仍存在的当前资产，否则回到所属分类列表。
- [x] 有 dirty 草稿时不覆盖，显示外部更新提示以及“重新加载 / 继续编辑”。
- [x] 继续编辑后保存使用最新基线校验；基线已变化时显示冲突，不覆盖 Agent 结果。
- [x] reject、失败 apply 和失败 undo 不触发索引失效或 snapshot 刷新；Agent 创建、修改和成功撤销后导航计数与主区状态保持一致。

定向验证：

```powershell
npm exec vitest -- packages/agent-engine/test/tool-registry.test.ts packages/application/test/agent-run-session.test.ts packages/repository/test/creative-project-file-repository.test.ts apps/desktop/test/desktop-agent-run-runtime.test.ts apps/desktop/test/agent-run-bridge.test.ts apps/desktop/test/electron-security.test.ts
```

## 8. 批次 F：兼容、视觉与完整门禁

### F1. 兼容场景

- [x] 无 Story Bible、只有 v1.0 资产、包含未知字段、缺少 foreshadows 目录的项目均可打开。
- [x] memories 文件仍可读写、可构建 Context candidate，且故事资料 UI 中完全不可见。
- [x] 旧 v1.0 搜索 cache 继续可读；相关 Story Bible 写入成功后 cache 被安全失效并在下一次查询重建，手动清理 cache 不影响任何 Story Bible 源数据。
- [x] Agent planning、execution/default approval、preapproved、general_file 和 standalone 权限矩阵无回归。

### F2. 视觉与可访问性

- [x] Playwright 验收 1440×900、1024×900、720×640。
- [x] 验收视口不等同于 CSS 断点；记录最终复用或新增断点的理由，避免为测试尺寸堆叠重复 media query。
- [x] 每个尺寸覆盖人物列表、世界观筛选、大纲树、伏笔列表/详情和时间线。
- [x] 覆盖浅色、深色、ink-gold；检查无水平滚动、重叠、截断和布局跳动。
- [x] 键盘可完成类目切换、搜索、列表选择、返回、保存和候选确认。
- [x] 图标按钮具有可访问名称和 tooltip，状态不只依赖颜色表达。

验收记录（2026-07-31）：继续复用现有 `1279px`、`900px`、`760px` 三层响应式断点，没有为验收视口新增专用 media query。`1279px` 负责在 Agent 双栏布局中收起项目导航并显示五类资料选择器，`900px` 沿用同一选择器保证隐藏导航后仍可切换类目，`760px` 收起右侧 Agent 形成单栏；三者分别对应信息密度变化，而不是绑定 `1024px` 或 `720px` 测试尺寸。

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

- [x] 新增未批准的故事资料类目。
- [x] Renderer 文件系统访问或绕过 schema 的写入。
- [x] memory 数据删除或静默迁移。
- [x] AI/Agent 未经确认写入。
- [x] 未知字段丢失、旧项目批量改写或缓存成为事实来源。

门禁记录（2026-07-31）：`npm run typecheck`、`npm run lint`、`npm run test -- --no-file-parallelism`（217 个文件、2308 项用例）、`npm run test:contract`（58 项）、`npm run build` 与 `npm run package:check` 全部通过。结构门禁发现 `App.tsx` 超限后，将既有模型设置回调原样迁入设置动作模块，最终降至 998 行；未提高阈值，也未改变 Story Bible 行为边界。

## 9. 完成定义

只有以下条件全部满足才能标记完成：

1. 五类导航与主区列表到详情在真实创作项目中可用。
2. 四种世界观类型、大纲卷章、伏笔闭环和时间线编辑均能持久化并恢复。
3. AI 扫描的候选确认前零写入，确认后可审计且可去重。
4. 右侧 Agent 能在现有审批链中新增和修改伏笔，主区不会因刷新丢失草稿。
5. v1.0 项目和 memories 行为兼容，搜索与 Context 能识别伏笔。
6. 定向测试、完整门禁和三个尺寸/主题的视觉验收全部通过。
