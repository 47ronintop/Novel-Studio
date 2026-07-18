# Novel Studio 统一工作台、项目导航与单一 Agent 设计

**日期：** 2026-07-18
**状态：** 规划基线，待实施
**实现基线：** `25a9006f41ee7cd8e836885314bfb6a5d2b68021`
**取代：** `docs/superpowers/specs/2026-07-18-project-navigator-redesign-design.md`
**实施计划：** `docs/superpowers/plans/2026-07-18-unified-workbench-project-navigation.md`
**范围：** 桌面 Shell、创作/工程工作台、项目与工作区生命周期、Navigator、唯一右侧 Agent、导航编排、偏好迁移、视觉与验收

## 1. 目标与裁决优先级

Novel Studio 是写作优先的创作 IDE，同时保留普通工程、代码、文件、Prompt、Agent、Workflow 和可审计 Agent 写入能力。它不能退化为纯写作器，也不能变成以聊天为主的壳。

本规范合并旧项目导航规范中尚未执行且仍有效的条款，并以用户后续明确决定修正冲突。裁决优先级如下：

1. `PROJECT_CONSTITUTION.md` 的 Project First、用户最终确认、Local First、Model Agnostic、可恢复和分层原则。
2. 已完成的 Agentic Writing Loop Stage 0-5 行为与安全语义。
3. 用户后续明确决定：顶部提供创作/工程工作台选择；右侧只有一个 Agent 会话；Plan/Act、审批、模型、推理和引用靠近输入框；普通工程能力必须保留。
4. 本规范。
5. 被本规范取代的旧导航规范与旧 `UI_GUIDELINES.md` 中冲突的入口定义。

本轮采用的方案是：

> **一个统一 Shell + 顶部工作台选择 + 上下文 Navigator + 中央编辑/审阅区 + 永久唯一右侧 Agent。**

顶部“创作 / 工程”是同一应用中的任务视图，不创建两套进程、两套项目状态或两套 Agent 会话。

## 2. 被合并规范的裁决

| 旧规范条款                                                | 新裁决                                                  |
| --------------------------------------------------------- | ------------------------------------------------------- |
| 删除重复的 `Novel Studio` 根节点和九类平铺资产树          | 保留，适用于创作 Navigator                              |
| 创作 Navigator 使用“写作 / 故事资料”                      | 保留并收窄为 `CreativeNavigatorMode`                    |
| 章节扁平列表、真实空态、五类故事资料和单例大纲/时间线     | 原样保留                                                |
| 创建项目选择父目录并创建独立子目录                        | 原样保留为创作项目创建契约                              |
| 删除原地初始化                                            | 原样保留；普通工程打开也不得自动初始化                  |
| Prompt、Agent、Workflow 从项目 Navigator 移至 Studio      | 保留                                                    |
| 只有 `none                                                | novelProject`，普通文件夹非法                           | 取代；新增正式的 `engineeringWorkspace` 上下文 |
| 有效项目不显示文件树                                      | 取代；创作视图不显示文件树，工程视图正式显示受管文件树  |
| Activity Bar 包含独立 AI Workflow                         | 取代；AI Activity 删除，右侧唯一 Agent 永久存在并可折叠 |
| AI Workflow/Inspector/Conversation 是多个独立表面         | 取代；能力合并到唯一 Agent、中央 Review 和按需抽屉      |
| 不修改 Change Set、Version Group、journal、recovery、undo | 提升为跨创作/工程工作台的硬性事务不变量                 |

旧规范不得单独实施；所有后续计划只引用本规范。

### 2.1 现有功能审计与取舍基线

本规范只重组已经存在的能力，并补齐项目/工作区边界所必需的安全契约。以下取舍以当前实现和测试为依据；实施计划不得把“删除重复入口”误写成“删除底层能力”。

| 当前能力                                            | 代码与测试依据                                                                                      | 取舍                                       | 本轮边界                                                                        |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------- |
| Stage 5 `AgentComposer`                             | `packages/ui/src/agent-composer.tsx`、`packages/ui/test/agent-composer.test.tsx`、Agent Stage 5 E2E | 原样保留，只调整所在表面与工程上下文可用项 | 不重做 Plan/Act、`writing/general_file`、审批、模型、推理、引用或 Context 状态  |
| Agent Conversation、Run、Plan、Change Set、Rollback | `agent-conversation-view.tsx`、`agent-run-panel.tsx`、`change-set-review.tsx` 及对应 bridge/tests   | 合并为唯一右侧 Agent + 中央 Review         | 删除独立机器人 Activity 时不得连带删除中央审阅投影                              |
| Version Group、transaction journal、recovery、undo  | `packages/agent-engine`、`packages/application`、`packages/repository` 的现有事务实现与回归测试     | 完整保留                                   | 工程工作区只改变 `contentRoot/stateRoot` 绑定，不改变审批、快照、补偿或冲突语义 |
| 普通文件树与 `PlainFileEditor`                      | `project-workflow-bridge.ts` 的普通文件夹降级路径、`plain-file-editor-bridge.ts`、对应 tests        | 迁移为正式工程工作台                       | 删除“原地初始化”，但不删除普通目录浏览、文本打开、dirty/save 和原子写能力       |
| 创作项目、章节与恢复                                | `project-workspace-session.ts`、`project-repository.ts`、项目工作流 tests/E2E                       | 保留并改造创建入口                         | 继续保留项目锁、章节维护、草稿恢复和失败不切换语义                              |
| 章节/Story Bible Navigator                          | `workspace-navigator.tsx`、`story-bible-bridge.ts`、对应 tests                                      | 重做信息架构，保留数据语义                 | 删除九类平铺入口，不新增卷、部、场景或关系图数据模型                            |
| 旧 `AiWritingAssistantPanel`                        | `workspace-shell-ai.tsx`、AI writing workflow sessions/bridges/tests                                | 删除第二个聊天表面，兼容能力先迁移后退场   | 选区预览、文风检查、Diff、Rollback、Undo、错误与运行历史不得先删后补            |
| Studio 的 Prompt/Agent/Workflow                     | `config-studio-panel.tsx`、`config-studio-session.ts`、Studio tests                                 | 创作项目中保留，从项目 Navigator 去重      | 当前没有普通工程的全局/工作区 Studio 存储，本轮不伪造该能力                     |
| Search、Timeline、Consistency 跳转                  | project search、timeline、Story Bible bridge 与 tests                                               | 创作项目中保留并统一导航                   | 当前 Search 只索引章节与 Story Bible；本轮不新增普通工程全文搜索                |
| Bottom Panel、状态栏、设置与布局                    | `workspace-shell.tsx`、`workspace-status-bar.tsx`、settings components 与 tests                     | 保留并清理层级                             | 不新增终端、测试运行器、调试器或问题诊断引擎                                    |

### 2.2 必要能力的成熟度与阶段

“当前没有实现”不等于“不需要”。总方案保留产品必要能力，但必须明确当前成熟度，避免在 UI 中伪装成已经完成。

| 能力                                                 | 产品判断                             | 当前状态                                                            | 阶段裁决                                                                                               |
| ---------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 工程文件树、普通文本/代码文本编辑、保存冲突保护      | 工程工作台首版必需                   | 已有临时文件树与编辑器，缺正式 Session/Repository 和冲突预览        | 纳入本实施计划                                                                                         |
| 唯一 Agent、`general_file`、Plan/Act、审批和事务写入 | 创作与工程共同核心                   | Stage 5 大部分已完成，缺工程 `contentRoot/stateRoot` 绑定和统一表面 | 纳入本实施计划                                                                                         |
| 工程全文搜索与 Agent `search_project_text`           | 完整工程体验必需                     | 尚未实现；现有 Search 只索引章节与 Story Bible，Stage 5 已明确延期  | 保留为 P1 独立规范；本轮不显示工程搜索入口，完成后复用左侧 Search + 中央结果页                         |
| 最近项目/工作区                                      | 日常使用必需，但不阻塞首个统一工作台 | 尚未实现                                                            | 保留为 P1；本轮只提供打开/创建入口并预留上下文类型                                                     |
| 工程侧 Prompt/Agent/Workflow 配置                    | 高级工程 Agent 工作流需要            | 现有 Studio 只支持 Novel Studio 项目资产                            | 保留为 P1；后续存入 app-local `stateRoot`，本轮工程 Activity Bar 不显示 Studio，也不得写入普通工程目录 |
| 受控命令执行/终端与任务运行                          | 完整 Codex/Cline 式工程模式最终需要  | 当前 Agent 工具与权限规范没有 Shell 能力                            | 保留为 P2 安全专项；必须先定义命令权限、审批、审计、超时和恢复，不能作为 UI 顺手加入                   |
| Git UI、LSP、调试器                                  | 有价值但不是本轮统一工作台的成立条件 | 尚未实现                                                            | P2/P3 独立评估；不影响本轮复用 CodeMirror 的工程文本编辑                                               |
| 文件创建/删除/移动/重命名                            | 工程工作台后续需要                   | 当前只有打开和保存已有文件                                          | P1 独立文件操作契约；必须走 Application/Repository 和路径/冲突审计                                     |

因此，本实施计划交付“可安全使用的统一工作台首版”，同时在文档中保留 P1/P2 必要能力，不把未完成能力从产品方向中删除。

## 3. 术语与状态模型

### 3.1 工作台状态

```ts
export type WorkbenchMode = "creative" | "engineering";
export type CreativeNavigatorMode = "writing" | "story";

export type WorkspaceCapability =
  | "creativeWorkbench"
  | "engineeringWorkbench"
  | "writingContext"
  | "generalFileContext"
  | "creativeSearch"
  | "creativeStudio";

export type WorkspaceContextDto =
  | { readonly kind: "none" }
  | {
      readonly kind: "creativeProject";
      readonly workspaceId: string;
      readonly projectId: string;
      readonly displayName: string;
      readonly capabilities: readonly WorkspaceCapability[];
    }
  | {
      readonly kind: "engineeringWorkspace";
      readonly workspaceId: string;
      readonly displayName: string;
      readonly capabilities: readonly WorkspaceCapability[];
    };
```

规则：

- `creativeProject` 可以在创作和工程工作台之间切换；两种工作台共享同一个内容根、项目身份和 Agent Conversation。
- `engineeringWorkspace` 只允许工程工作台；创作入口显示不可用原因，不伪造小说数据模型。
- `none` 默认展示项目/工作区打开与创作项目创建入口。
- `WorkbenchMode` 与 `WorkspaceContextDto` 分离；切换工作台不等于切换项目。
- 工作台切换不得重建章节草稿、普通文件草稿、打开标签、Agent Run、Conversation、Plan、Change Set 或 Review 状态。
- Renderer、preload、偏好和 Shell state 只持有 `WorkspaceContextDto`。`contentRoot/stateRoot` 属于 main/Application 内部 `WorkspaceActivationContext`，不得通过 IPC 暴露；Renderer 只接收相对文件路径、显示名、能力和稳定 ID。

### 3.2 内容根与状态根

- 创作项目：`contentRoot === stateRoot`。章节、Story Bible、Prompt、Agent、Workflow、history、recovery 和 cache 均位于独立项目主目录中。
- 普通工程工作区：`contentRoot` 是用户选择的现有目录；`stateRoot` 位于应用本地数据目录的 `workspaces/<workspaceId>/`，用于 Conversation、Agent Run、Change Set、Version Group、journal、recovery 和 undo 元数据。
- 打开普通工程不得在 `contentRoot` 中自动创建 `chapters/`、`history/`、`.novel-studio/` 或其他受管目录。
- 创作项目保留 `workspaceId === projectId`，继续复用现有 Stage 5 Agent Run、Conversation、usage、recovery 和 Version Group 记录键，不做记录迁移。
- 只有普通工程的 `workspaceId` 由 Application 通过 `WorkspaceStateRepositoryPort` 对 canonical root 解析为稳定、不可逆的 `ws_<hash>` 本地标识；Node 路径规范化与哈希实现位于 Repository，Desktop 只组合依赖。usage、诊断和后续索引不得把绝对路径当作公开 ID。
- Agent 路径守卫和工具能力绑定 `contentRoot`；审计与恢复仓库绑定 `stateRoot`。创作项目默认两者相同，因此不改变现有行为。

### 3.3 手工写入与 Agent 写入

- 用户在编辑器中手工保存章节或普通文本文件，继续走对应 Application Session 和 Repository，不要求先生成 Change Set。
- Agent 产生的任何写入，无论创作还是工程上下文，都必须走现有 Change Set、Approval Gate、Version Group、transaction journal、recovery 和 undo 管线。
- 工程工作台不得通过新增“通用写文件”回调绕过 Agent 写入事务；UI 也不得直接访问文件系统。
- 工程 `general_file` 的 planning 只提供读取、结束计划和请求用户输入；execution 继续提供现有 `propose_file_write`，生成实际 Change Set 后再按当前审批策略应用。工程上下文禁止 `writing`，但不能因此误删 `general_file` 的执行写入能力。

## 4. 总体信息架构

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ 项目名 │ [创作工作台 ▾ / 工程工作台 ▾] │ Command Center │ 布局控制       │
├────┬──────────────┬────────────────────────────────┬─────────────────────┤
│ A  │ Navigator    │ Editor Area                    │ 唯一 Agent          │
│ c  │              │ Tabs / Chapter / Asset / Code │ Conversation        │
│ t  │ 创作：       │ Plan / Diff / Change Set       │ Run / Composer      │
│ i  │ 写作/资料    │                                │                     │
│ v  │ 工程：文件树 │                                │                     │
├────┴──────────────┴────────────────────────────────┴─────────────────────┤
│ Bottom Panel：问题 / 测试 / 运行 / 日志（按需）                           │
├──────────────────────────────────────────────────────────────────────────┤
│ Status Bar：保存/恢复 │ 字数或行列 │ 编码/语言 │ 当前上下文             │
└──────────────────────────────────────────────────────────────────────────┘
```

尺寸基线：

- Title Bar：约 38-40px。
- Activity Bar：约 44-48px。
- Navigator：默认 260px，可调 220-420px。
- Agent：默认 320px，可调 280-520px，可折叠。
- Status Bar：约 24px。
- Editor 永远获得剩余空间且是最大工作面。

## 5. 顶部工作台选择与 Activity Bar

### 5.1 顶部工作台选择

- 当前工作台必须在 Title Bar 顶部可见，不能藏在左下角状态栏。
- 控件显示完整名称“创作工作台”或“工程工作台”，并提供键盘可访问的菜单或分段选择。
- 切换只改变 Navigator、中央默认表面和状态栏投影，不改变项目根、会话、运行或草稿。
- 普通工程上下文中的创作工作台入口为禁用态，并显示“当前文件夹不是 Novel Studio 创作项目”。

### 5.2 Activity Bar

Activity Bar 管当前工作台内的全局任务域，不再承载工作台选择。

上方入口：

- 项目/Explorer。
- 搜索，仅创作项目可用；普通工程全文搜索不在本轮范围。
- 时间线，仅创作项目可用。

底部入口：

- 创作系统 Studio，仅创作项目可用；普通工程上下文中暂不显示该入口，待 P1 app-local 工程 Studio 存储完成后再启用。
- 设置。

删除：

- 独立故事圣经图标。
- 独立 AI/机器人 Activity。

右侧 Agent 的展开/折叠属于布局控制，不是 Activity。

## 6. 项目与工作区生命周期

### 6.1 创建创作项目

创建流程固定为：

1. 输入项目标题。
2. 选择父目录。
3. Desktop 将所选 canonical 父目录保存在短期、不可猜测的选择 token 中；Renderer 只持有 token 和显示名。Desktop/Application 通过 token 预览并校验 `<父目录>/<安全文件夹名>`。
4. 拒绝空名称、路径分隔符、Windows 保留名、尾随空格/句点和归一化后空名称。
5. 最终路径必须不存在；存在时 fail-closed，不覆盖、不合并、不追加随机后缀。
6. Repository 在唯一新子目录中创建完整 Novel Studio 结构。
7. Application 成功后只向 Renderer 返回去除绝对根路径的 `ProjectWorkspaceSnapshotDto`；Renderer 与 Agent runtime 才原子切换绑定。
8. 成功后进入 `creative/writing`。

项目标题与磁盘文件夹名分离。失败时不得替换当前上下文，不得清空草稿或 Conversation；若创建过程中已产生痕迹，只能位于候选子目录内，并由 Repository 受控清理或报告。

### 6.2 打开创作项目

- 只接受合法 Novel Studio 项目根目录。
- 目录选择、打开和创建 IPC 使用 main 侧短期 opaque selection token，不把 `projectRoot`、`contentRoot` 或 `stateRoot` 作为 Renderer 输入/输出。
- 校验失败不改变当前上下文和 Agent 绑定。
- 不再把无效目录隐式降级为“待初始化创作项目”。

### 6.3 打开普通工程工作区

- 允许选择现有目录并读取受限、可审计的文件树。
- 不创建 Novel Studio 创作目录，不修改目录内容。
- Application 生成 `engineeringWorkspace` 上下文与 app-local `stateRoot`，成功后才原子切换。
- 工程目录选择同样使用 main 侧 opaque selection token；文件打开/保存只传相对路径和 checksum。
- 打开失败保留之前上下文。
- v1 不提供“新建空工程文件夹”向导；用户可打开已有目录。

### 6.4 失败原子性

- 任何打开、创建或 runtime bind 失败都不得留下 Renderer 指向新根而 Agent 仍绑定旧根的混合状态。
- 不再使用硬编码 fallback project ID 绑定无项目会话。
- 最近项目/工作区列表当前不存在，本轮不新增；后续若实现，存储契约必须区分 `creativeProject` 与 `engineeringWorkspace`。

## 7. 创作 Navigator

### 7.1 顶部结构

有效创作项目显示：

1. 项目标题与更多菜单。
2. “写作 / 故事资料”两个二级页签。
3. 当前页签的筛选和对象列表。

删除重复的 `Novel Studio` 根节点、九类平铺分组、普通文件树和 Studio 配置资产。

### 7.2 写作页

- 只显示章节。
- 章节标题栏显示真实数量和新建按钮。
- 章节列表保持扁平，不虚构卷、部、场景数据模型。
- 章节行显示可用的标题、字数、状态和未保存标记。
- 重命名、复制、软删除收进行尾菜单；菜单操作不得冒泡打开章节。
- 空项目显示“还没有章节”和唯一主动作。
- 有章节但筛选无匹配时显示独立无结果状态与清除筛选，不显示空项目文案。

章节打开顺序固定为：

```text
creativeNavigatorMode = writing
  -> activeActivity = project
  -> centralSurface = editor
  -> projectWorkflowBridge.selectChapter(chapterId)
```

### 7.3 故事资料页

固定分类：人物、世界观、大纲、时间线、记忆。

- 分类始终可见，显示真实数量和明确选中态，不作为空目录折叠。
- 人物、世界观、记忆为多条；大纲、时间线保持 0/1 单例。
- 一次只显示当前分类资产。
- 时间线资产点击直接进入 Story Bible 时间线资产编辑；全局时间线 Activity 仍负责概览与轨道。
- 空分类与筛选无结果使用不同状态。
- 保存继续走 `storyBible.saveAsset` / `storyBible.saveMemory`，不改变稳定 ID。

## 8. 工程 Navigator 与文件编辑

- 工程工作台显示正式文件树，不复用创作九类对象树。
- 文件树来自 `EngineeringWorkspaceSession` 返回的 DTO；React UI 不自行扫描目录。
- 默认跳过 `.git`、`node_modules`、构建产物和超出数量/深度限制的节点，并明确显示“列表已截断”状态。
- 展开状态与创作页签状态分开持久化。
- 文件点击通过统一导航编排器打开中央编辑器；目录点击只展开/折叠。
- v1 仅使用现有 CodeMirror 文本表面打开和保存已有文本/代码文本文件，不新增语言服务、语法分析、通用创建、删除、移动或重命名文件 API。
- 普通工程的手工文件保存继续使用原子写；外部修改冲突必须预览，不能静默覆盖。
- 创作项目进入工程工作台时，可以查看其受管文件，但章节、Story Bible、Prompt、Agent、Workflow、项目设置、history、cache 和 `.novel-studio` 路径在普通文件编辑器中只读，并引导用户进入对应专用表面；文件树不是绕过 Schema、版本或恢复语义的捷径。Agent 写入仍可通过 Change Set/Version Group 管线修改受管目标。

## 9. 中央编辑、Review、Bottom Panel 与状态栏

### 9.1 中央编辑区

中央区承载：

- 章节编辑器。
- Story Bible 编辑器。
- 普通文本/代码编辑器。
- Studio 编辑器。
- Plan Artifact。
- Diff / Change Set Review。
- Rollback / Recovery Review。

Plan、Diff 和 Change Set 必须在中央打开，不塞进狭窄聊天气泡。右侧会话只显示摘要与“在中央查看”动作。

Recovery 有两个现有来源，中央投影不得混淆：章节 autosave recovery 保留预览、应用、丢弃；Agent partial failure/recovery review 展示 Run、Version Group、失败 hook 和已有 rollback/retry 入口，不得伪造直接修复、绕过 journal，或把 `recovery_required` 显示为成功。

编辑器顶部只保留文档标签、查找、保存和少量布局动作。字数、行列、编码、模型状态、运行状态等技术信息不得堆成常驻徽章。

### 9.2 Bottom Panel

- 默认关闭。
- 保留当前 Workflow 运行、问题、搜索、日志标签及其已有投影；没有数据源的标签继续为空态，不在本轮新建测试/运行/日志引擎。
- 不把 Bottom Panel 当作第二个 Agent 会话。

### 9.3 状态栏

状态栏继续承担低干扰的可信反馈：

- 保存中、已保存、未保存、可恢复。
- 创作：字数、阅读时间、文档模式。
- 工程：行列、选区、编码、换行符、语言模式。

状态栏不得删除，也不得与主要写作/发送动作争夺视觉权重。

## 10. 唯一右侧 Agent

### 10.1 表面所有权

唯一 Agent 由现有 `AgentConversationView + AgentComposer + AgentRunPanel` 组成，并在创作、故事资料、工程、搜索、时间线和 Studio 之间保持同一个项目/工作区绑定。

- 左侧 Activity Bar 不再有机器人入口。
- 左侧项目 Navigator 不再被 `AgentConversationNavigator` 替换。
- 会话历史由右侧标题栏按钮打开为弹层、抽屉或右栏内部视图；它仍是同一个 Agent 面板的一部分。
- 右侧面板可折叠；折叠不会停止运行或清空草稿。
- 项目/工作区成功切换后，Conversation 才切换到新 `workspaceId`；失败时继续显示旧会话。
- creative Conversation 继续使用 `projectId` 作为 `workspaceId`；engineering Conversation 使用 app-local 哈希 ID。两者都不把绝对路径发送给 Renderer 或写入公开会话 ID。

### 10.2 Composer

不得重做 Stage 5 已完成的 Composer。继续使用现有正交维度：

- 运行方式：`planning | execution`，即 Plan / Act。
- 上下文：`writing | general_file`。
- 审批：人工确认或“本次运行自动修改”；只对当前 execution run 生效。
- 引用：章节、Story Bible、文件和选区。
- 模型与推理强度。
- 唯一发送/停止按钮。

这些控制位于输入框底部工具区；planning 明确只读并隐藏写入审批。审批名称可以显示“请求批准 / 替我审批（本次运行）”，但底层 enum 和 Stage 5 权限边界不改变。

### 10.3 旧写作 AI 能力迁移

`AiWritingAssistantPanel` 不再作为第二个右侧会话。以下能力必须迁移或投影到唯一 Agent，而不是删除：

- 当前章节建议。
- 选区改写与预览。
- 文风/一致性检查触发。
- 模型与推理选择。
- Diff、Rollback、Undo 和错误诊断。
- Workflow 运行与历史摘要。

迁移策略：

- 新请求从 `AgentComposer` 发起。
- 旧 Application workflow/session 可在过渡期作为工具或兼容用例保留。
- 生成的 Plan、Change Set、Diff、Rollback 与 Recovery 统一投影到中央 Review。
- 完成迁移并通过回归后，才删除 `workspace-shell-ai.tsx` 及 renderer 旧 bridge/actions；不得先删功能后补。

## 11. 唯一导航编排器

Renderer 提供一个集中模块，所有 Navigator、Search、Timeline、Consistency、Command Palette 和 Agent 引用跳转复用：

```ts
interface WorkspaceNavigation {
  selectWorkbench(mode: WorkbenchMode): void;
  openCreativeProject(): Promise<void>;
  openEngineeringWorkspace(): Promise<void>;
  navigateToChapter(chapterId: string): Promise<void>;
  navigateToStoryKind(kind: StoryBibleEditorKind): void;
  navigateToStoryEntry(entryId: string): void;
  createStoryEntry(kind: StoryBibleEditorKind): void;
  navigateToFile(path: string): Promise<void>;
  openMainReview(review: AgentConversationMainReview): void;
}
```

约束：

- 组件只发出语义意图，不拼接 `setShellState + bridge` 顺序。
- Search 打开章节进入创作/写作；打开 Story Bible 结果进入创作/故事资料。
- Timeline event 使用 `parentEntryId` 选择 timeline asset，不能把 event ID 传给 Story Bible bridge。
- 文件结果进入工程工作台并打开对应文件。
- 导航失败不留下标签、活动、Navigator 模式和实际选中对象不一致的中间状态。

## 12. 偏好、默认值与迁移

新增可选偏好：

```ts
interface UserShellPreferences {
  readonly workbenchMode: WorkbenchMode;
  readonly creativeNavigatorMode: CreativeNavigatorMode;
  readonly engineeringExpandedPathIds: readonly string[];
  // existing layout preferences remain
}
```

兼容规则：

- 旧文件缺失 `workbenchMode` 时，创作项目默认 `creative`，普通工程默认 `engineering`。
- 缺失或未知 `creativeNavigatorMode` 时默认 `writing`。
- 旧 `navigatorExpandedSectionIds` 只用于兼容读取；新写入使用 `engineeringExpandedPathIds`。
- 显式空数组必须原样往返，不能恢复为全部展开。
- Application 默认、Renderer 初始值、偏好默认、序列化和恢复共享同一常量来源。
- 项目切换后 Story Bible 分类默认 `character`；同一上下文会话内保留当前分类。

## 13. 分层与数据流

### 13.1 UI 导航

```text
UI intent
  -> Renderer WorkspaceNavigation
  -> Application state/session
  -> Repository DTO / bridge result
  -> atomic Renderer commit
```

### 13.2 工程文件

```text
Engineering Navigator / Editor
  -> EngineeringWorkspaceSession
  -> EngineeringWorkspaceRepository
  -> canonical path guard + atomic read/write
  -> DTO / conflict result
```

Desktop 只负责原生目录选择、IPC 安全转换和依赖组合；不得继续承载目录遍历、路径业务校验或文本写入业务逻辑。

### 13.3 Agent 写入

```text
AgentComposer
  -> Application Agent Run
  -> Agent Engine plan/tool proposal
  -> Change Set + Approval Gate
  -> Repository transaction against contentRoot
  -> journal/history/version data under stateRoot
  -> Version Group / recovery / undo projection
```

任何层不得新增 Renderer -> filesystem 或 UI -> Repository 旁路。

## 14. 事务与恢复不变量

以下语义在创作/工程切换、项目切换、Agent 面板折叠和旧 UI 迁移中必须保持：

- planning 不产生可应用 Change Set。
- 批准 Plan 不等于批准具体 Change Set。
- 人工确认策略仍需用户审阅实际 Diff。
- 本次运行自动修改仍完整生成、校验和记录同一个 Change Set/Diff。
- 审批继续绑定 Change Set revision/checksum。
- 写入前快照、Version Group、transaction journal 和 undo 链路不变。
- partial failure 进入 recovery review，不显示成功。
- 恢复后仍能识别未决 Change Set、Plan revision、Version Group 和 journal。
- 导航或工作台切换不得改变 active run、run draft、Conversation sequence 或审批来源。
- usage 清理不得删除 Agent Run、Change Set、Version Group、journal 或 undo 数据。

## 15. 视觉、设置与可访问性

- 使用标准 DOM/CSS，不使用 WebGL、Canvas 核心文本渲染、粒子或持续动效。
- 保持 IDE 式面板、低饱和中性色与克制 teal 强调；不把界面做成消费级卡片墙。
- UI 字体使用系统无衬线；中文正文使用用户可选的长文阅读字体。
- 设置页采用清晰分类 + 单列主表单；标签不得因同排按钮而断成两行，不得横向溢出。
- Agent 模型、推理、模式、审批和引用必须与输入框形成同一 Composer 组。
- 编辑器顶部保持干净；技术状态进入状态栏或按需面板。
- 所有交互有可见 focus、键盘路径和 accessible name。
- 支持 `prefers-reduced-motion`。
- 小窗口依次折叠 Bottom Panel、Navigator、Agent；Editor 始终可用。Navigator 可转 overlay，Agent 可用布局按钮重新打开。

## 16. 错误与失败语义

- 打开/创建错误使用 Unified Error：stable code、用户可读 message、suggested action、trace ID 和脱敏详情。
- 无效创作项目、工程目录读取失败、文件冲突、runtime bind 失败必须区分错误码。
- 不静默覆盖外部修改、已存在项目目录或恢复冲突。
- UI 反馈靠近触发入口，不在状态栏中吞掉关键错误。
- 切换失败必须回滚到完整旧上下文，而不是只回滚可见面板。

## 17. 非目标

本轮不包含：

- 新增卷、部、场景或拖拽排序数据模型。
- 新建/删除/移动/重命名普通文件。
- Git UI、终端模拟器或调试器重做。
- LSP、语法服务、测试运行器、工程全文搜索或最近工作区系统。
- 重写 Agent Engine、模型 Provider、Tool Registry 或权限能力边界。
- 新增永久“完全授权”模式。
- 删除 Prompt、Agent、Workflow、Story Bible、Timeline、Version、Recovery 或 Undo 功能。
- 多个并列 Agent 面板、第二个聊天输入框或独立机器人 Activity。
- 为普通工程自动生成 Novel Studio 项目结构。
- 为普通工程新增 Prompt/Agent/Workflow Studio 存储或伪造创作资产。
- 装饰性中国风皮肤、WebGL、Canvas 文本编辑器或持续动画。

## 18. 验收矩阵

### 18.1 Shell 与导航

- 顶部工作台选择清晰可见。
- 创作项目可以在创作/工程之间切换，草稿、标签、会话和运行不丢失。
- 普通工程只进入工程工作台，打开时不写入目录。
- Activity Bar 没有机器人入口，右侧只有一个 Agent。
- 创作 Navigator 只有写作/故事资料，不显示九类平铺树。
- 工程 Navigator 显示正式文件树。
- Search、Timeline、Consistency 和 Command Palette 复用统一导航编排器。

### 18.2 项目与工作区

- 创建创作项目只在父目录内创建一个不存在的新子目录。
- 保留名、路径分隔符、尾随空格/点、空归一化和目标冲突均 fail-closed。
- 打开/创建/bind 失败不替换当前上下文或 Agent 会话。
- 普通工程的 `stateRoot` 位于 app-local workspace store，内容根不被初始化。
- Renderer Shell/IPC DTO 不包含 `contentRoot` 或 `stateRoot`。

### 18.3 Agent 与事务

- 全局 DOM 中只有一个 `AgentComposer` textarea 和一个发送/停止槽位。
- Plan/Act、writing/general_file、审批、模型、推理和引用均在 Composer 内。
- planning 只读；自动审批只在当前 execution run 生效。
- Plan、Diff、Change Set、Rollback、Recovery 在中央打开。
- 章节 Recovery 的 preview/apply/discard 和 Agent transaction Recovery 的 rollback/retry 均保持可达。
- 旧写作 AI 的选区建议、Diff、Rollback 和错误能力迁移后仍可用。
- Change Set、Version Group、journal、recovery 和 undo 回归全部通过。

### 18.4 视觉与可访问性

- 设置页无横向溢出，标签不被按钮挤断。
- 编辑器顶部没有技术徽章堆叠。
- 状态栏保留保存/恢复和文档指标。
- 约 220px Navigator 和小窗口下无文字、数量或图标重叠。
- 键盘焦点、Escape、tabs、菜单和 reduced motion 可验证。

## 19. 迁移顺序

1. 先增加新状态、Workspace Context 和偏好兼容，不改视觉。
2. 建立工程工作区 Application/Repository 边界和安全创作项目创建契约。
3. 重写创作 Navigator 与统一导航编排器。
4. 加入顶部工作台选择和正式工程 Navigator。
5. 将右侧 Agent 设为所有工作台的唯一表面，并迁移旧写作 AI 能力。
6. 完成视觉、设置、响应式和可访问性收口。
7. 最后运行全量事务、Electron 和发布门；通过前不删除兼容代码。

## 20. 完成定义

完成后，Novel Studio 使用一个稳定 Shell 服务创作项目与普通工程。创作项目默认直接显示章节，故事资料通过稳定页签进入；工程工作台提供受控文件树和代码编辑；创建创作项目不会污染父目录；打开普通工程不会初始化创作结构。右侧只有一个项目/工作区绑定的 Agent，会话、Plan/Act、审批、模型、推理和引用集中在 Composer，Plan/Diff/Change Set 在中央审阅。所有导航来源统一编排，Change Set、Version Group、journal、recovery、undo、草稿和 Conversation 在工作台切换中保持原义。
