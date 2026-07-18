# 项目导航信息架构重设计

> [!IMPORTANT]
> **状态：已被合并取代，不得单独实施。** 仍有效的项目创建、写作/故事资料 Navigator、导航编排和失败原子性条款已合并到 `docs/superpowers/specs/2026-07-18-unified-workbench-project-navigation-design.md`。本文中“拒绝普通工程工作区”“有效项目永不显示文件树”“保留独立 AI Activity”等与用户后续决定冲突的条款已经失效。

**日期：** 2026-07-18
**状态：** 已被统一工作台规范取代，仅保留为历史设计记录
**范围：** Novel Studio 桌面端 Activity Bar、项目 Navigator、项目创建入口、Navigator 偏好与既有主视图跳转

## 1. 背景与问题

当前项目 Navigator 把九类对象平铺在同一棵树中：章节、人物、世界观、大纲、时间线、记忆、Prompt、Agent 和 Workflow。`Novel Studio` 根节点只重复产品名与分类数量，九个分类标题也只负责折叠。空分类展开后没有内容、空状态或创建动作，配置资产子项右侧又重复显示 `prompt`、`agent`、`workflow` 类型。

这造成四个问题：

1. 正文、故事资料、原始文件和高级 AI 配置处于同一信息层级。
2. 分类标题看起来可导航，实际只展开或收起；空分类点击后近似无响应。
3. 时间线、Story Bible 和 Studio 同时出现在 Activity Bar、项目树或主视图中，入口职责不清。
4. 从 Story Bible 或 Studio 点击章节时只更新章节选择，没有显式返回正文工作区。
5. “初始化为 Novel Studio 项目”会直接在用户打开的普通文件夹内创建大量受管目录和配置文件，污染原目录，并把“浏览文件夹”和“创建项目”混成同一语义。

本轮重做信息架构与导航交互，不删除项目数据，也不新增小说数据模型。

## 2. 竞品依据与取舍

调研采用以下官方资料：

- VS Code User Interface：Activity Bar 用于切换视图，Primary Side Bar 承载 Explorer 等具体视图；Explorer 用于浏览、打开和管理项目对象。
  <https://code.visualstudio.com/docs/editing/userinterface>
- VS Code Custom Layout：视图位置可记忆、可重排并可恢复默认。
  <https://code.visualstudio.com/docs/configure/custom-layout>
- Ulysses Library / Projects / Sheets & Groups：项目内容与 Notes/Extras 分区，选择组决定列表范围，选择文稿才打开编辑器；空容器提供直接创建动作。
  <https://help.ulysses.app/en_US/the-library/ulysses-library>
  <https://help.ulysses.app/en_US/the-library/projects>
  <https://help.ulysses.app/en_US/the-library/567894-sheets-groups>
- Plottr Notes：人物、地点、项目资料等是独立实体，通过关联和筛选连接，而不是嵌入章节树。
  <https://docs.plottr.com/article/79-character-templates>
- Scrivener Binder / Research：正文与研究资料使用不同根域组织。
  <https://scrivener.tenderapp.com/help/kb/features-and-usage/the-binder>
  <https://scrivener.tenderapp.com/help/kb/features-and-usage/using-the-research-folder>

采用混合方案：Activity Bar 负责全局任务域，项目 Navigator 负责当前项目对象；Navigator 内通过少量页签切换对象集合。没有照搬单棵 Binder，因为长篇项目会让九类对象再次堆成长列表；也没有为每类对象增加 Activity 图标，因为会让高频任务切换变得过度分散。

## 3. 最终信息架构

### 3.1 Activity Bar

Activity Bar 从上到下保留：

- 项目
- 搜索
- 时间线
- AI 工作流

底部固定：

- 创作系统
- 设置

删除独立的“故事圣经”Activity 图标。故事圣经是项目资料编辑器，从项目 Navigator 的“故事资料”页签进入。

“项目”图标在 `workspace` 或 `storyBible` 活动中均显示选中。搜索、时间线、AI、创作系统和设置各自只有一个一级入口。创作系统放在底部是因为 Prompt、Agent 和 Workflow 属于低频高级配置，不是日常项目内容。

Activity Bar 只切换任务域，不触发保存、丢弃、删除或重新加载项目数据。Renderer 已持有的章节草稿、打开标签和 bridge 状态继续保留；本轮不新增对组件本地焦点或选区的跨视图持久化承诺。

Activity Bar 使用独立的逻辑 ID：

```ts
type ActivityBarItemId = "project" | "search" | "timeline" | "ai" | "studio" | "settings";
```

`resolveActivityBarSelection(activeActivity)` 将 `workspace` 和 `storyBible` 都映射为 `project`。点击项目图标调用独立的 `onProjectActivityOpen()`，不能继续把 Activity Bar 项目 ID 与内部 `ActivityId` 直接等同。

### 3.2 项目 Navigator

项目 Navigator 顶部显示当前项目标题和项目操作菜单，不再显示 `Novel Studio` 根节点或分类总数。

标题下方固定两个页签：

- 写作
- 故事资料

页签是项目域内的二级导航，同时同步相应主工作面：

- 选择“写作”时进入 `workspace` 活动。
- 选择“故事资料”时进入 `storyBible` 活动。

项目 Navigator 模式使用明确状态 `writing | story`，默认 `writing`，并通过现有用户偏好边界持久化。点击 Activity Bar 的“项目”图标时，恢复最后一次项目 Navigator 模式：`story` 恢复 Story Bible，`writing` 恢复正文工作区。

未打开项目时不渲染页签，只显示打开和创建项目动作。只有打开有效 Novel Studio 项目后才显示写作、故事资料两个页签。

打开新的 Novel Studio 项目时恢复合法的用户 `navigatorMode`。Story Bible 当前分类不进入用户偏好：每次项目切换后默认 `character`，同一项目会话内由现有 `storyBibleEditor.activeKind` 保持选择。

选择的目录不是有效项目时不进入新的项目上下文：

- 已有项目打开时保留当前项目、章节、Story Bible、Studio 和 Agent 绑定，只显示“所选文件夹不是 Novel Studio 项目”的错误。
- 没有项目打开时保持未打开状态，显示同一错误与“选择其他项目”“新建项目”动作。
- 不读取或展示普通文件树，不把旧项目状态与无效文件夹路径混合。

### 3.3 项目标题与项目操作

已打开项目时，正常状态只显示项目标题和更多菜单。更多菜单提供以下真实命令：

- 打开其他项目
- 创建项目

彻底删除“初始化为 Novel Studio 项目”入口和原地初始化行为。

打开项目使用现有原生目录选择器，并且只接受已经包含合法 Novel Studio 项目元数据的项目根目录。

创建项目使用明确的创建流程：

1. 用户输入项目名称。
2. 用户选择父目录，而不是要被填充的现有目录。
3. 界面显示最终项目路径预览：`<父目录>/<项目文件夹名>`。
4. Desktop/Application 边界校验文件夹名，拒绝路径分隔符、Windows 保留名、尾随空格/句点和空名称。
5. 系统要求最终项目路径不存在；存在时返回冲突，不合并、不覆盖、不在其中追加目录。
6. Repository 在新的独立项目根目录中创建 `project.json`、章节、Story Bible、配置、历史和缓存结构。
7. 创建完成后打开新项目并进入 `writing` 模式。

项目标题与磁盘文件夹名分开存储：标题保留用户输入；文件夹名使用确定性的安全归一化结果。若归一化结果为空或冲突，要求用户修改名称，不静默追加随机后缀。

正常 Electron 桌面界面不长期显示手动路径字段。没有原生目录选择能力的受支持测试/回退环境可以显示显式路径输入，但仍必须把该路径解释为父目录，并创建独立子目录。

“新建章节”不再常驻项目操作区，移动到“写作”页的章节标题栏。项目反馈紧邻触发它的项目操作区显示。

## 4. 写作页

写作页只显示章节，不显示 Story Bible 或配置资产。

结构：

1. 作用于章节的筛选输入框。
2. “章节”标题、真实章节数量和新建图标按钮。
3. 扁平章节列表。

本轮不新增卷、部、场景层级，因为现有数据模型只有章节；不能为了仿照竞品而制造没有 Repository 支持的视觉层级。

章节行显示标题，并按现有 DTO 可用性显示字数、状态和未保存标记。点击章节必须按以下顺序完成：

1. 将 Navigator 模式设为 `writing`。
2. 将活动切到 `workspace`。
3. 通过现有项目工作流 bridge 选择章节。

低频的重命名、复制和软删除继续放在行尾更多菜单中。菜单操作不得触发章节打开。删除继续使用现有确认和 Repository 语义，不增加直接文件删除。

没有章节时显示单一空状态“还没有章节”和“新建章节”动作；标题栏的加号与空状态按钮调用同一回调。

项目实际有章节但筛选无匹配时显示“未找到匹配章节”和清除筛选动作，不显示“还没有章节”，也不把新建章节误当成搜索解决方案。

## 5. 故事资料页

故事资料页包含五个固定分类按钮：

- 人物
- 世界观
- 大纲
- 时间线
- 记忆

分类按钮不是可折叠空目录。它们始终可见，显示真实条目数并有明确选中态。人物、世界观和记忆为多条资产；大纲和时间线遵循现有 0/1 单例模型。点击分类后：

1. 将 Navigator 模式设为 `story`。
2. 将活动切到 `storyBible`。
3. 通过现有 Story Bible bridge 选择对应 kind。

分类列表下方只渲染当前分类的资产。点击任意资产都进入 `storyBible` 编辑器并选中该资产，包括时间线资产。

全局 Activity Bar 的“时间线”负责时间线概览与轨道视图；故事资料中的“时间线”负责编辑底层 Story Bible 时间线资产。两者不再使用同一点击动作，从而避免“点条目先到概览、再点一次才能编辑”的双跳转。

当前分类为空时只显示一次空状态，例如“还没有人物”和“新建人物”。分类标题区的加号与空状态按钮调用统一创建意图：先选择 kind，再创建该 kind 的空草稿。大纲或时间线已经存在时不渲染新增动作，只提供打开和编辑现有单例。保存仍走现有 `storyBible.saveAsset` 或 `storyBible.saveMemory` 边界，不改变 `outline_main` 和 `timeline_main` 的稳定 ID。

故事资料页的筛选只过滤当前分类。跨章节、跨 Story Bible 类型的查找继续由 Activity Bar 的全局搜索负责。

当前分类有数据但筛选无匹配时显示“未找到匹配项”和清除筛选动作；不得复用资产为空状态。

## 6. 项目根目录与失败语义

每个 Novel Studio 项目必须拥有独立项目根目录。创建流程只允许在用户选择的父目录下创建一个新的子目录，所有受管内容都位于该子目录内；父目录中的既有文件与文件夹保持不变。

数据流如下：

```text
创建项目表单（项目名称）
  -> 原生目录选择器（父目录）
  -> Desktop 安全构造最终子目录
  -> Application createProject（最终 projectRoot）
  -> ProjectRepository 在新根目录创建项目结构
  -> 成功后绑定 Renderer / Agent runtime
```

Renderer 不自行拼接平台路径。最终路径的构造、规范化、父子目录校验和冲突检查必须发生在 Desktop/Application/Repository 受控边界。

创建失败时：

- 不把父目录标记为项目。
- 不改变当前已打开项目。
- 不清空当前章节草稿、Story Bible、Studio 或 Agent Conversation 状态。
- 错误信息说明失败阶段和目标项目路径，但不得泄露敏感内容。
- 若新项目根目录已创建但后续步骤失败，失败痕迹只能位于该新根目录内，不能散落到父目录；清理策略在实施计划中使用 Repository 受控操作验证。

打开无效目录时沿用相同的“不切换当前上下文”规则。原有 `canInitializeProject`、`onInitializeProject` 和普通文件夹初始化测试删除或改写为无效目录拒绝测试。

## 7. 创作系统资产

Prompt、Agent 和 Workflow 三组从项目 Navigator 中完全移除，但以下数据和功能全部保留：

- 默认审稿 Prompt
- 默认审稿 Agent
- 审稿当前章节 Workflow
- Studio JSON 编辑
- Schema 校验
- Workflow 画布
- 保存与版本恢复

点击 Activity Bar 底部的“创作系统”进入现有 Studio。默认资产不删除、不迁移、不改 schema。该变化只是取消重复入口。

## 8. 状态、数据流与分层

新增的项目 Navigator 模式属于工作台状态，由 Application `DesktopShellState` 和用户偏好负责定义与归一化。Renderer 负责把 UI 意图编排为 Activity 变化与 bridge 调用，UI 组件不直接读取文件或操作 Repository。

```text
WorkspaceNavigator 交互意图
  -> WorkspaceShell 回调
  -> Desktop Renderer App
  -> 更新 navigatorMode / activeActivity
  -> 调用既有 projectWorkflowBridge / storyBibleBridge
  -> Application Session
  -> Repository
```

Renderer 提供唯一的导航编排器，所有来源都必须复用，不能由各组件自行拼接 Activity 和 bridge 顺序：

- `navigateToChapter(chapterId)`：设置 `writing`，切换 `workspace`，选择章节。
- `navigateToStoryEntry(entryId)`：设置 `story`，切换 `storyBible`，选择资产。
- `navigateToStoryKind(kind)`：设置 `story`，切换 `storyBible`，选择分类。
- `createStoryEntry(kind)`：设置 `story`，切换 `storyBible`，选择 kind，创建空草稿。

Navigator、全局 Search、Timeline、Story Bible consistency 链接和后续命令入口必须调用这些编排器。Timeline 的 event 点击继续把 `parentEntryId` 作为 timeline asset ID 传给 `navigateToStoryEntry`；event ID 不得误传给只接受 Story Bible asset ID 的 bridge。

`WorkspaceNavigator` 使用语义明确的展示层意图回调：

- `onNavigatorModeSelect(mode)`
- `onChapterOpen(chapterId)`
- `onStoryKindOpen(kind)`
- `onStoryEntryOpen(entryId)`

`WorkspaceNavigator` 保持展示组件，不直接持有 Desktop bridge。Renderer 必须保证跨活动跳转和对象选择的顺序，避免当前“章节已在后台选中，但主区仍停留在 Studio”的状态错位。

偏好兼容规则：

- `UserShellPreferences` 与 `DesktopShellState` 新增 `navigatorMode: "writing" | "story"`。
- `UserPreferencesSaveInput.shell.navigatorMode` 保持可选，以兼容旧偏好文件。
- 缺少 `navigatorMode` 时默认 `writing`。
- 未知值回退 `writing`。
- 旧的 `novel-studio`、`chapters`、`characters` 等展开 ID 可以读取但不再影响新页签。
- 既有文件夹展开 ID 只做向后兼容读取，本轮不再用于渲染普通文件树；写回时无需主动删除，避免无关偏好迁移。
- `navigatorExpandedSectionIds === undefined` 时才使用默认值；显式空数组必须原样保存，不能被归一化成全部展开。
- Renderer 的默认 shell state、偏好默认值、序列化和恢复必须使用同一常量，删除当前三处默认列表不一致。

项目上下文只有 `none | novelProject` 两种合法状态，不再存在“普通文件夹已作为工作区打开”的混合状态。项目打开和创建只有在 Application 成功返回完整 `ProjectWorkspaceSnapshot` 后才替换 Renderer 的项目绑定状态。

本轮不修改 `agent-engine`、Change Set、Approval Gate、Version Group、transaction journal、recovery、conflict 或 undo 管线。

## 9. 视觉与可访问性

- Navigator 保持高密度工具界面，行高约 28-30px，不使用卡片布局。
- 项目标题、两个页签、筛选和对象列表形成稳定纵向层级。
- 页签使用 `tablist/tab` 语义；选中态、键盘焦点和 hover 必须可区分。
- 两个页签采用自动激活模式，支持左右方向键、Home 和 End，并使用 `aria-controls` 连接唯一 `tabpanel`。
- 故事分类同样使用自动激活 tabs；若实现保留普通按钮，则必须提供 `aria-pressed`、roving focus 和选中状态公告。
- 章节和故事资料资产使用真实按钮；项目 Navigator 不渲染普通文件或文件夹节点，也不显示无意义的 chevron。
- 新建和更多操作使用 Lucide 图标、tooltip 与 accessible label。
- 数量位于行尾并降低强调；长标题省略但通过 tooltip/accessible name 保留全名。
- 更多菜单以浮层呈现，不推动相邻章节行，也不得被 Navigator 滚动容器裁切。
- Navigator 宽度保持现有可调整能力；在约 220px 的窄宽度下两个页签、最长中文标签和计数不能重叠。
- 项目侧栏折叠时 resize handle 同步隐藏，不保留可拖动的空槽。
- 页签或分类切换后焦点保留在触发控件；只有用户点击具体章节、资产或文件时，主编辑区按现有规则接管焦点。

## 10. 非目标

本轮不包含：

- 卷、部、场景或拖拽排序数据模型。
- 人物关系图、复杂时间线事件表单或正文双向定位。
- 通用新建/删除原始文件 API。
- 普通文件夹浏览、原地项目初始化或自动导入普通文件夹内容。
- 新建 Prompt、Agent 或 Workflow 的向导。
- 右键菜单、批量选择或拖拽移动。
- 重写 Studio、Story Bible、Timeline 或编辑器主视图。
- 新增 Provider、Agent 工具或写入权限。

## 11. 测试与验收

严格 TDD，每个行为先增加会因当前实现缺失而失败的测试，再做最小实现。

### 11.1 UI 行为

- Navigator 不再渲染 `Novel Studio` 根节点和九组平铺树。
- 有效项目只渲染写作、故事资料两个页签。
- 未打开项目时不渲染页签，只显示打开和创建动作。
- 写作页只列章节；空状态和新建动作可用。
- 有章节但筛选无匹配时显示独立无结果状态。
- 章节点击按 `mode -> activity -> select` 的契约打开正文。
- 章节菜单操作不触发章节选择。
- 故事资料显示五个分类和真实数量，一次只列当前分类资产。
- 空故事分类显示对应创建动作。
- 大纲与时间线只能存在 0 或 1 个资产；已存在时不显示新增动作。
- 所有 Story Bible 资产，包括时间线资产，都直接进入资产编辑器。
- 有效 Novel Studio 项目不暴露原始文件树，不能旁路专用写入语义。
- Prompt、Agent 和 Workflow 不出现在项目 Navigator，但 Studio 资产列表仍完整。
- Activity Bar 移除故事圣经图标，并把创作系统放到底部工具区。
- `workspace` 与 `storyBible` 均使项目 Activity 显示选中。
- Activity Bar 的项目项使用独立逻辑 ID 和 `onProjectActivityOpen()`，不伪造新的 Application `ActivityId`。

### 11.2 状态与集成

- `navigatorMode` 默认、保存、恢复和未知值回退正确。
- 显式空展开数组可以往返持久化。
- 点击项目 Activity 恢复最后项目模式。
- 打开无效目录不会替换当前有效项目，也不会暴露旧项目与新路径的混合状态。
- 新建项目把用户选择解释为父目录，并在其中创建唯一的新项目主文件夹。
- 最终项目目录已存在时 fail-closed，不合并或覆盖。
- 创建失败不改变当前项目，且不会把受管目录散落到父目录。
- 从 Search 打开章节会进入写作模式；打开 Story Bible 结果会进入故事资料模式。
- 从 Timeline 打开 event 时使用其 `parentEntryId` 进入故事资料模式并选择对应 timeline asset。
- Navigator、Search、Timeline 和 consistency 链接复用同一导航编排器。
- 现有章节重命名、复制、软删除、Story Bible 保存、Studio 保存/恢复测试继续通过。

### 11.3 视觉验收

使用真实桌面应用在常规与窄窗口检查：

- 默认首屏直接显示章节，不出现九个空分组。
- 两个页签尺寸稳定，中文标签、数量和图标不重叠。
- 空状态只有一个明确主动作。
- 章节更多菜单悬浮显示且不改变列表布局。
- 切换全局活动与项目页签时选中态唯一、无闪烁错位。
- 项目 Navigator 折叠后不残留 resize 空槽。

### 11.4 计划验证命令

实施计划使用以下验证命令：

```powershell
npm test -- packages/application/test/user-preferences-session.test.ts packages/ui/test/workspace-navigator.test.tsx packages/ui/test/workspace-shell.test.tsx apps/desktop/test/app-shell-support.test.ts
npm run typecheck
npm run lint
npm test -- --no-file-parallelism
npm run build
```

涉及的 Electron 导航流程使用现有 Playwright E2E 运行；Windows 沙箱内若出现 `spawn EPERM`，使用原命令申请沙箱外执行。

## 12. 完成定义

完成后，新项目和缺少偏好的项目首先显示章节，而不是九类系统对象；已有合法偏好时恢复最后项目模式。故事资料通过一个稳定页签进入，空分类具备真实创建路径；有效项目不暴露原始文件树；Prompt、Agent 和 Workflow 只在创作系统管理。创建项目始终生成独立主文件夹，打开无效目录不会污染该目录或替换当前项目。所有来源复用统一导航编排器并进入与标签一致的真实主视图，既有保存、恢复、版本、Agent 写入与撤销语义保持不变。
