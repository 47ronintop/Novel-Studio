# 山海（ShanHai）创作工作台最小实现方案

**日期：** 2026-08-12
**状态：** Reviewed（MVP-1，已补齐实现接缝，可进入实施）
**范围：** 复用现有“新建创作项目”和“打开创作项目”，覆盖普通小说文件夹接入、空项目“开始构思”入口和创作工作台导航调整；新书、续写沿用现有 Agent 能力，审稿模式列为后续版本

## 1. 品牌与命名

产品对外名称统一为 **山海（ShanHai）**。`Novel Studio` 是早期产品叫法。

本方案只约束新的用户可见文案和功能命名，不批量修改 `@novel-studio/*` 包名、IPC 标识、已有项目格式和历史文档；技术标识迁移不属于本次 MVP。

## 2. 结论与工作量

顶部文件菜单不新增“导入已有小说”。继续保留两个入口：

1. **新建创作项目**：在用户选择的父目录下创建一个新的山海项目文件夹。
2. **打开创作项目**：选择一个小说文件夹；如果它已经是山海项目就直接打开，如果只是普通正文文件夹就显示接入预览。

普通小说文件夹的 MVP 不做原地初始化，而是在同级创建一个新的山海项目副本：源文件夹始终保持不变，用户确认的正文复制到新项目的 `chapters/`，然后打开新项目。这样可以复用现有 `createProjectInParent` 的目录所有权和失败清理逻辑，不新增原地回滚、原稿备份或恢复事务。导入链路不复用现有 Renderer 生成的 `projectId`，而由 Main/Application 注入的受管 ID factory 生成；现有“新建创作项目”链路暂不改变。

新建项目完成后，如果项目还没有章节，中央空章节工作区同时提供两条起点：**开始构思**（由 Agent 主导提问，作者用自然语言回答）和现有的**新建第一章**（直接写正文）。这不是新增项目创建入口，而是帮助新用户选择“先想清楚”还是“先写起来”。

工作量按范围分为：

| 范围       | 主要改动                                                                                   | 评估                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| 原完整方案 | 原地导入、文件移动/恢复、崩溃事务、导航重构、Agent 规划模式、跨层测试                      | 大，涉及 Main、Application、Repository、Renderer 和 Agent Engine                                |
| 本 MVP-1   | 目录分类、只读预览、同级新项目创建、章节复制、激活、空项目构思入口、创作导航调整和定向测试 | 中，接入复用项目创建/激活/文件安全边界，构思入口和导航调整限于 Renderer、用户偏好兼容与相关测试 |

本 MVP 明确不追求“导入后原目录变成项目”；这是后续版本的独立能力。

## 3. 现有“打开创作项目”行为

当前打开流程为：

- 用户选择一个目录。
- Main 将目录保存为短时有效的目录选择记录，并只向 Renderer 返回 `selectionId`。
- `openCreativeProject(selectionId)` 解析该选择记录后调用现有激活协调器。
- Repository 校验根目录下的 `project.json` 和 `settings.json`，成功后加载章节、Story Bible、文件树和 Agent 工作区。

因此，现有流程可以打开应用创建的项目，但不能接入一个只包含 `.txt/.md` 正文的普通文件夹。本 MVP 只在这个选择后的分支增加“预览并复制到新项目”。有效山海项目的现有 `WorkspaceActivationDto` 合同保持不变。

普通目录分支不把目录直接传给现有激活协调器。打开流程先经过 Main/Application 的只读分类：有效山海项目继续调用原有 `openCreativeProject` 并返回现有激活结果；普通正文目录进入新的预览/确认合同；可疑目录返回修复错误。这样既保持有效项目的 `WorkspaceActivationDto` 不变，也避免把普通目录误交给会立即激活的创建/打开流程。

分类与激活是两个调用：`inspectOpenCreativeDirectory(selectionId)` 只读分类并返回“已有项目 / 普通正文目录预览”的判别结果；只有“已有项目”分支才随后调用 `openCreativeProject(selectionId)`。检查调用本身不消费选择记录；打开已有项目或提交任一确认尝试时，Main 都必须原子消费对应选择记录，即使后续激活或校验失败也不能复用同一个选择。

## 4. 打开目录后的最小分支

### 4.1 已有山海项目

目录中存在有效的 `project.json` 和 `settings.json`：沿用现有打开流程，不复制、不迁移、不重新初始化。

### 4.2 普通小说文件夹

目录中不存在项目元数据，但根目录包含受支持的 `.txt` 或 `.md` 文件：

1. Main/Application 只读扫描所选根目录的直接子文件，按自然文件名排序。预览只展示根目录相对路径、文件大小和默认标题；MVP 不提供自定义项目标题、语言或章节重排。
2. 预览允许勾选/取消勾选候选文件，并显示目标项目目录，默认取同级的 `<源目录名> - ShanHai`。目标目录已存在时直接拒绝本次接入并结束，不覆盖已有目录；自定义目标名留到后续版本。
3. 预览必须明确显示“将创建同级的新项目副本，源文件夹不会被修改”。确认前不创建目录、不写入文件、不移动源文件。至少需要确认一份章节文件；全部取消或取消确认则直接结束。
4. 确认时 Renderer 只提交 `selectionId` 和确认的根目录相对路径列表。Main 消费并重新校验目录选择记录、根目录身份、候选仍是根层级普通文本文件，以及大小/修改时间/校验和未变化；Renderer 不提交绝对路径、项目 ID、章节 ID、时间戳或文件内容。目标目录名只能来自 Main 保存的预览结果，不能由 Renderer 在确认时改写。
5. 校验通过后，Application 通过注入的 Repository Port 和候选 `ProjectWorkspaceSession` 在同级创建新项目，项目标题默认使用源目录名，语言固定为 `zh-CN`。导入链路使用新的 Main/Application-owned ID factory 生成项目 ID；章节 ID、章节顺序和时间戳由 Repository 生成。Application 不直接 import 具体 `ProjectCreationFileRepository`。
6. 候选 session 先取得新项目锁并完成元数据初始化，再按确认顺序批量创建章节，正文按 UTF-8 原样写入；批量操作必须是 Application-owned 用例，内部复用 `createAgentChapter({ title, body })` 或等价的 Repository Port，不把 Renderer 提供的 ID 或路径传入通用 `createChapter`。复制、锁获取或准备阶段失败时释放锁，并调用现有“新建子目录所有权”清理逻辑删除本次创建且仍归本次操作所有的新项目目录，源文件夹不受影响。
7. 所有章节复制成功后，候选 session 显式选择 `lastImportedChapterId`，生成 `PreparedWorkspaceActivation`；随后沿用现有 runtime prepare、commit、finalize 激活协调器。现有 session 默认选择第一个章节，因此不能直接用普通 `createProjectInParent` 代替该导入用例。
8. 成功后在现有工作区反馈区域显示 Main 生成的只读 `targetLocationLabel`（仅用于展示，不是 Renderer 提交的路径），并再次说明源文件夹未被修改；失败只显示错误，不把源目录标记为已接入。

这是“打开创作项目”入口下的三阶段内部流程：只读预览、创建同级副本、激活新项目；不新增用户可见的“导入”菜单。

### 4.3 可疑或损坏目录

以下情况停止处理，不把目录当成普通小说重新解释：

- 存在 `project.json`，但内容损坏或 schema 校验失败。
- 存在 `settings.json`、`.novel-studio`、`chapters/` 或 Story Bible 受管目录，但缺少完整项目元数据。
- 没有可识别的正文文件。
- 文件编码、路径、条目数或大小不受现有创作项目文件策略支持。

界面只显示修复提示，不覆盖任何现有文件。

### 4.4 预览与安全边界

- 复用现有 Main-owned `selectionId`；当前 `resolveDirectorySelection` 在成功解析时不会自动消费，因此本功能必须在 Main 的检查/打开/确认入口中显式实现一次性消费：检查阶段保持可继续预览，打开已有项目或任一确认尝试（包括校验失败）都删除选择记录。取消不执行写入，剩余记录依靠现有过期机制清理。MVP 不新增独立 `previewToken`、导入事务文件或持久化导入状态。
- 预览结果只在 Main 内存中按 `selectionId` 绑定：规范化源根目录身份、同级目标父目录身份、默认目标目录名、候选相对路径，以及每个候选的大小、修改时间、SHA-256 和文件身份。Renderer 收到的 `relativePath` 只用于勾选；确认时必须与 Main 保存的候选集合逐项匹配，不能由 Renderer 回传或推导绝对路径、目标路径或指纹。
- 复用现有创作项目文件策略：只读根目录直接子文件，不跟随符号链接、联接点或重解析点；候选必须是普通文件、合法 UTF-8，并遵守现有文本扩展名、深度/条目数、文件大小和路径长度限制。
- Main 在确认前重新 `stat`/读取候选并校验大小、修改时间、SHA-256 校验和和文本编码；任一候选变化、选择记录过期、根目录身份变化或目标目录冲突，都在首次写入前拒绝。每个文件复制前再次以受管文件操作读取并校验校验和，避免把过期内容写入新项目。预览和检查阶段只读，不创建目标目录。
- 目标目录是本次新建的子目录，失败清理只能使用现有创建操作记录的目录身份；不得递归删除源目录，也不得删除目标目录创建前已有的内容。

### 4.5 最小内部合同

以下合同只供本次打开链路内部使用，不改变有效项目的 `WorkspaceActivationDto`：

- `CreativeFolderPreview`：包含 `schemaVersion`、源目录显示名、目标目录显示名、默认项目标题/语言和候选数组；候选包含根目录相对 `relativePath`、`sizeBytes`、`modifiedAt`、`sha256`、默认标题和自然排序位置。不返回绝对路径。预览内部指纹和目录身份留在 Main 的 `selectionId` 记录中，不信任 Renderer 回传。
- `CreativeFolderConfirmationRequest`：只包含 `selectionId` 和确认后的相对路径列表。不接受 Renderer 提交项目 ID、章节 ID、目标路径、时间戳、文件内容或指纹。
- `CreativeFolderCopyResult`：包含 `schemaVersion`、Main/Application 生成的 `projectId`、已导入章节 ID 列表、`lastImportedChapterId` 和只读 `targetLocationLabel`；成功后再调用既有激活合同。`targetLocationLabel` 不能被当作路径输入再次提交。

## 5. 正文转换规则

新项目初始化后，正式正文只存在于新项目的 `chapters/`。源文件仍保留在原文件夹，不作为新项目内容的一部分。

- MVP 只识别源目录根层级的 `.txt`、`.md` 文件，不递归猜测卷目录。
- 标题取文件名去掉最后一个扩展名后的文本并 trim；顺序使用自然排序，确认界面只支持勾选，不支持手工重排。
- 源文件正文按 UTF-8 原样作为章节 body；不解析或合并用户自定义 frontmatter，系统 frontmatter 由章节 Repository 生成。
- 章节 ID 必须由 Application/Repository 的受管生成器生成，不能由 Renderer 或用户清单指定。优先复用现有 `createAgentChapter({ title, body })` 及其章节目录校验；如该接口不适合批量导入，再增加一个等价的 Application-owned copy 方法，而不是放宽普通 `createChapter` 的 Renderer ID 输入。
- 只复制确认的文件；未确认文件留在源文件夹，不会出现在新项目的“其他文件”中。
- 后续新增章节继续写入新项目自己的 `chapters/`，不会写回源文件夹。

## 6. 导航与 Agent 范围

本 MVP 只调整创作项目的写作工作台导航；工程工作台的导航、文件树和模式保持不变：

- 创作导航顶部只保留“写作 / 故事资料”两个模式，删除第三个“项目文件”标签。
- 现有创作项目安全文件树移到导航底部，更名为“其他文件”。该区默认折叠，折叠时只显示一行标题和数量；展开后继续复用现有安全文件树、新建和刷新能力，不放宽文件策略或路径边界。
- “其他文件”的外层折叠状态不持久化，每次进入项目时默认折叠；现有文件树目录展开状态可继续沿用旧偏好，不新增用户偏好字段。
- 运行时 `creativeNavigatorMode` 只使用 `writing | story`；读取到旧偏好 `files` 时统一归一为 `writing`，之后不再写回 `files`。
- 从“写作”或“故事资料”打开创作项目辅助文件时，保持当前导航模式，只切换中央文件编辑器状态，不再切换到 `files`。
- Agent 的 `general_file` 上下文根据当前激活的创作项目文件编辑器状态（`fileEditorScope === "creativeProjectFile"`）判定，不再依赖导航模式。其他 Agent draft 持久化、权限和工具目录边界不变。
- 时间线只作为“故事资料”中的既有子项保留；删除最左侧独立的时间线 activity，MVP 不维护两个时间线入口。
- 源文件夹不是项目根目录，未选文件不会自动进入新项目文件树；用户仍可在系统文件管理器中访问原文件夹。
- 新增的“开始构思”只出现在已激活且章节数为 0 的创作项目中央空章节工作区；无项目、工程工作区、已有章节或 Agent 上下文不可用时不显示。现有快速开始区和“新建第一章”路径保留，不重复创建另一套项目引导。
- 点击“开始构思”复用现有 Agent 会话和 Composer：如果当前没有会话，沿用现有会话创建/选择流程；会话可用后把以下固定请求写入 Composer 并聚焦输入框，但不自动发送：

  ```text
  请引导我构思这本小说。你负责提问和整理，不要求我一次写完设定。每次只问一两个关键问题，优先了解作品类型、创作目标、主角、核心冲突和世界背景；我说“没想好”时，请给出不超过三个方向供我选择。信息足够后先总结目前共识，等我确认后再提议把明确内容写入大纲、人物或世界观资料；不要自行补全或持久化未经确认的设定。
  ```

- 这个入口是 Agent 主导的对话式引导，不是作者独自填写设定表：作者只需逐轮回答问题，也可以回答“没想好”并从少量方向中选择。点击动作不得覆盖非空 Composer 草稿；已有草稿时禁用并提示作者先处理当前草稿。作者发送请求、选择模式以及任何后续写入，继续受现有 Agent 的上下文预算、权限、审批和工具目录约束。
- 信息充分后，Agent 先给出可审阅的构思总结；只有作者明确确认后，才可在现有 Agent 写入与审批流程下提议更新大纲、人物或世界观资料。该入口本身不新增 Prompt 资产、Workflow、Agent、项目 schema、持久化引导状态或自动写文件行为。
- 不新增“继续写作”“梳理已有内容”快捷动作，也不复活当前 Composer 不渲染的旧 `quickActions` 入口；这些需求留到后续版本评估。
- 不新增“审稿当前章”动作，不改变 Agent Run draft 的 `operationMode`、`contextMode`、`activeChapterId` 或工具目录。

除上述创作导航和空项目入口调整外，Agent draft 持久化和运行时权限边界均不改造。

## 7. 最小代码改动范围

### 7.1 Main / IPC

- 在现有 `chooseOpenCreativeDirectory` 选择记录上增加 `inspectOpenCreativeDirectory(selectionId)` 和 `confirmCreativeFolder(request)` 两个调用，继续由 Main 持有规范化源路径；已有项目分支仍单独调用 `openCreativeProject(selectionId)`，普通目录确认不能复用现有会立即激活的 `createCreativeProject`。
- 增加 `CreativeFolderPreview` 和 `CreativeFolderConfirmationRequest` 的形状校验；Renderer 只能提交 `selectionId` 与相对路径列表。
- 复用现有目录选择过期、根目录绑定和有效项目 `openCreativeProject` 激活合同；为普通目录确认增加一个对应的 WorkspaceActivationCoordinator/Application prepare 入口，最终仍走同一套 runtime prepare/commit/finalize。该确认入口只接收 Main 已解析的内部候选，不把绝对源路径或目标路径暴露给 Renderer。

### 7.2 Application / Repository

- 增加一个“从已确认根目录候选创建同级项目副本”的 Application 编排入口，并在 Application 合同中显式区分“准备导入候选”和“提交激活”。Application 只依赖 `ProjectCreationRepositoryPort`、项目/章节 Repository Port 和 session factory，不直接 import `ProjectCreationFileRepository` 或其他具体 Repository。
- 复用 `ProjectCreationRepositoryPort.createProjectInParent` 创建目标子目录和失败清理，但不能把它包装成现有会立即激活的桌面 `createProjectInParent`；应新增候选 `ProjectWorkspaceSession` 用例：创建项目、批量创建章节、选择最后章节、返回 `PreparedWorkspaceActivation`。这样可复用同一套项目初始化、锁和激活快照逻辑，又不在章节未复制完成时切换当前工作区。
- 候选 session 的批量导入方法接收 Application 已校验的 `{ title, body }[]`，内部调用可选的 `createAgentChapter` Port 或新增等价的 Application-owned copy 方法；Repository 继续生成 ID、顺序和时间戳。源文件只读，不新增备份、事务日志或恢复状态。
- 复制、锁获取、候选 session 准备或运行时激活任一失败，都先释放候选锁，再调用 `cleanupCreatedProject`；清理失败要保留可诊断错误，不能继续把部分项目提交为活动工作区。
- 创建完成后返回 `CreativeFolderCopyResult`，随后由 Main 调用现有 runtime prepare/commit/finalize 激活链路，并在激活前显式携带 `lastImportedChapterId`；不改变有效项目的 `WorkspaceActivationDto` 合同。

### 7.3 Renderer

- 增加一个最小预览确认界面：候选文件勾选、目标目录提示、确认/取消。
- 创作导航顶部收敛为“写作 / 故事资料”，将既有安全项目文件树移到底部“其他文件”折叠区；外层默认折叠且不持久化，展开后保留现有新建、刷新和安全文件树行为。该调整不应用于工程工作台。
- 打开创作辅助文件时不改写 `creativeNavigatorMode`；旧 `files` 偏好在读取/运行时边界归一为 `writing`，Agent `general_file` 上下文改由激活的 `creativeProjectFile` 编辑器 scope 驱动。
- 在现有 `WorkspaceEmptyEditor` 增加“开始构思”按钮，与现有“新建第一章”并列；直接使用现有 `projectWorkflow.chapters.length === 0` 判断，不新增 `chapterCount`/`hasChapters` prop。
- 增加一个 Renderer 内部的 `onStartBrainstorming` 动作：复用现有会话创建/选择结果，待会话加载完成且存在 Composer 后，通过受控的 Composer bridge/ref 调用现有 `onRequestChange` 写入固定请求并聚焦输入框。不能依赖不受控的全局 DOM 查询；不得调用 `onSend`，不得改写 operation mode、context mode、write policy 或 references。
- 非空 Composer 草稿、会话加载中、Agent 不可用或已有章节时，按钮隐藏或禁用并给出已有状态提示；会话加载路径继续复用现有自动创建/选择逻辑。创建第一章后按钮立即消失。无需新增用户偏好 schema 或持久化引导状态。

### 7.4 测试

- 目录分类：有效项目、普通正文目录、损坏/可疑目录；检查调用只读且不消费选择，已有项目打开和确认尝试按合同消费选择。
- 预览确认：取消不写入，确认只提交相对路径，Main 重新校验 Main-owned 候选指纹，过期/重复/篡改选择被拒绝。
- 导入复制：目标项目结构、章节标题/顺序/正文、Main/Application factory 生成项目 ID、Repository 生成章节 ID，源文件保持不变；成功反馈只展示 `targetLocationLabel`。
- 失败清理：复制、锁、准备或激活失败只清理本次新建目标目录，不影响源目录和目标父目录既有内容；清理失败可诊断且不提交部分项目。
- 激活：候选 session 完成复制后显式选择最后一个已导入章节，新项目激活后打开该章节。
- 空项目构思：章节数为 0 时显示“开始构思”和“新建第一章”；点击后复用现有会话、预填固定请求并聚焦 Composer，不自动发送；已有草稿不被覆盖，创建第一章后入口消失。
- 首次使用边界：未创建或未激活项目时，现有快速开始区仍只提供创建/打开项目和新建第一章等已有入口，不显示“开始构思”。
- 构思对话：不对真实模型输出做脆弱断言；用固定请求、mock Agent adapter 或人工验收验证每轮最多一两个问题、“没想好”时不超过三个方向、信息充分后先总结并等待作者确认，未经确认不写入资料。
- 创作导航：顶部只有“写作 / 故事资料”；“其他文件”默认折叠并显示数量，展开后新建、刷新和安全文件树仍可用；从两个模式打开辅助文件均保持原模式。
- 导航兼容与上下文：旧 `files` 偏好回退到 `writing` 且不再写回；激活创作辅助文件时 Agent 使用 `general_file`，关闭或切换编辑器后按现有规则恢复对应上下文。
- 回归边界：工程工作台的导航、文件树、偏好和 Agent 上下文行为保持不变。

## 8. 后续版本明确承接

以下内容不进入 MVP-1：

- 原地初始化，让所选源目录本身变成山海项目。
- 原稿移动到 `.novel-studio/import-backup`、导入事务日志、崩溃恢复、身份/校验和保护回滚。
- 可编辑项目标题/语言、手工章节重排、递归卷目录识别和 Word/PDF 等格式。
- “继续写作”“梳理已有内容”“审稿当前章”快捷动作及专用 planning 只读工具目录。
- 全书分析、全书审稿、语义索引和自动写入 Story Bible。

## 9. 验收标准

### 已有项目

- 现有有效山海项目仍可通过“打开创作项目”正常打开。
- 损坏项目不会被误判为普通目录，也不会被覆盖或复制解释。

### 普通小说文件夹

- 同一个“打开创作项目”入口能识别根目录 `.txt/.md`，并显示候选预览。
- 预览、取消或选择记录过期时，源目录和其内容均不变化。
- 用户能勾选/取消候选；未选文件保持原位。
- 预览明确说明会创建同级副本且源目录不变；成功反馈包含新项目位置和“源文件夹未被修改”。
- 确认后在同级创建 `<源目录名> - ShanHai` 新项目；目标已存在时拒绝，不覆盖。
- 新项目的正式章节全部位于 `chapters/`，正文与源文件内容一致，章节标题和自然顺序正确。
- 项目 ID、章节 ID、顺序和时间戳不由 Renderer 提供；导入结果返回最后一个章节并在激活后打开它。
- 复制过程中源文件变化、编码非法或目标创建失败时，新项目按现有创建所有权清理，源目录和父目录既有内容保持不变。
- 后续新章节继续写入新项目的 `chapters/`，不会写回源目录。

### 范围约束

- 创作工作台顶部只保留“写作 / 故事资料”；“其他文件”位于导航底部、默认折叠且不新增持久化偏好，展开后现有安全文件树和操作仍可用。
- 打开创作辅助文件不改变当前“写作 / 故事资料”模式；旧 `files` 偏好归一到 `writing`，Agent `general_file` 上下文由激活的创作文件编辑器判定。
- 工程工作台导航及文件树不变；MVP 不改变偏好 schema、Agent operation mode、context mode 或工具目录。
- 不新增用户可见的“导入”入口；普通文件夹接入行为都从现有“打开创作项目”分支进入，空项目构思则从激活后的中央空章节工作区进入。
- “开始构思”只作为空项目中央工作区的第二条起点，不新增项目创建入口、设定表或独立 Agent；现有“新建第一章”仍可直接开始写作。
- 相关 Main、Application、Repository、Renderer 定向测试通过；至少覆盖 `inspectOpenCreativeDirectory`、`confirmCreativeFolder` 与既有 `openCreativeProject` 的分支和一次性消费语义。

## 10. 推荐实施顺序

1. 增加普通目录只读扫描、分类和最小预览合同。
2. 增加同级目标目录命名、现有项目创建复用和受管章节复制。
3. 接入现有激活/最后章节加载链路。
4. 调整创作工作台导航，接入旧 `files` 偏好归一、辅助文件模式保持和 Agent `general_file` 上下文判定，并确认工程工作台无回归。
5. 增加空项目“开始构思”按钮、会话复用、Composer 预填/聚焦和草稿保护。
6. 补齐失败清理、安全边界、接入反馈和端到端定向测试。
7. 另行评估原地初始化和 Agent 审稿模式，不在本 MVP 中顺带实现。

## 11. 2026-08-16 写作入口实施补充

启动 bootstrap 继续创建并打开默认第一章，不通过移除默认章节来恢复空项目入口。在已激活的创作项目中，现有 Agent Composer 输入框下方、主工具栏上方常驻低强调的“Agent 快捷动作”栏，只提供“开始构思”和“继续写作”；因此“开始构思”不再受章节数为 0 的限制。工程工作区和独立会话不显示该栏，空项目中央原有“开始构思 / 新建第一章”入口继续保留。

- “开始构思”切换到写作上下文和计划模式，并预填既有构思请求。
- “继续写作”切换到写作上下文和执行模式，并预填“请从当前章节末尾继续写作。”；没有活动章节时禁用并提示先创建或打开章节。
- 两个动作都只配置模式、预填并聚焦输入框，不自动发送，也不直接修改正文。Composer 已有草稿、Agent 正在准备或运行、或 Agent 不可用时均禁用，绝不覆盖草稿。
- 发送后仍由现有 `WritingTaskIntent`、候选审阅、审批和保存链路处理；现有选区改写与文风检查的底层审阅流程不变，但不作为本栏快捷项渲染。
- 本补充不新增 IPC、项目 schema、持久化状态、Agent 工具或 Project Home。

本节取代本文第 3.6、8、9 节中“开始构思仅限零章节”和“继续写作快捷动作留待后续”的对应限制；其余范围边界保持不变。
