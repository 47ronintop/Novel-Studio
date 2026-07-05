# Novel Studio Roadmap

Version: 1.25 | Status: Active | Last Updated: 2026-07-05

## 目标

Novel Studio v1 是一个 local-first、project-based 的 AI 小说创作 IDE。核心目标是可靠管理项目文件、章节编辑、版本历史、可控 AI workflow、模型配置和桌面写作工作区。

项目文件以 Markdown/JSON 为 source of truth；SQLite 只能作为 `cache/` 下可重建索引层。所有核心运行时代码使用 TypeScript Strict。

## 已完成里程碑

| Milestone | 名称                            | 作用                                                                              | 状态     |
| --------- | ------------------------------- | --------------------------------------------------------------------------------- | -------- |
| M0        | Repository Baseline             | 建立仓库、文档 baseline、分支纪律                                                 | Complete |
| M1        | Toolchain Foundation            | 建立 npm workspaces、TypeScript strict、lint、format、test                        | Complete |
| M2        | Schema Foundation               | 建立 JSON Schema、fixtures、contract tests                                        | Complete |
| M3        | Repository Core                 | 项目读取、原子写入、history、recovery、cache 边界                                 | Complete |
| M4        | Desktop Shell                   | Electron/React shell、IPC 安全边界、基础工作区 UI                                 | Complete |
| M5        | Editor and Version UX           | 章节编辑、保存状态、版本历史、diff/restore 基础                                   | Complete |
| M6        | LLM Adapter                     | Provider-neutral LLM Adapter、mock provider、OpenAI-compatible fixture            | Complete |
| M7        | Agent/Context/Workflow          | Workflow 状态机、Context Engine、Agent Engine                                     | Complete |
| M8        | Studio and Settings             | 模型设置、Prompt/Agent/Workflow 编辑和回滚                                        | Complete |
| M9        | Hardening and Alpha             | 可访问性、性能 fixture、alpha gate、secret scan                                   | Complete |
| M10       | Beta Packaging Foundation       | Vite renderer bundle、electron-builder 配置、package preflight                    | Complete |
| M11       | Package Artifact Stabilization  | 稳定 `package:dir`、unpacked artifact、artifact secret scan                       | Complete |
| M12       | Project Workflow Vertical Slice | 创建/打开项目、章节管理、编辑保存、版本回滚的可用闭环                             | Complete |
| M13       | Real E2E and CI Gate            | 真实 Electron E2E smoke、GitHub Actions、packaging gate                           | Complete |
| M14       | AI Writing Workflow UX          | 生成 AI 写作建议、预览 diff、用户确认后应用到章节编辑器                           | Complete |
| M15       | Real Provider Profiles          | 真实模型 profile 配置、secret ref 校验、离线连接测试和运行时解析                  | Complete |
| M16       | Story Bible Modules             | 人物、世界观、大纲、时间线、记忆管理，给 Context Engine 提供高质量素材            | Complete |
| M17       | Installer and Release Channel   | Windows NSIS installer、本地 beta release channel、release notes、icon 和签名策略 | Complete |
| M18       | Plugin System                   | 插件 manifest、项目插件注册表、权限授权策略、插件引擎边界和 contract tests        | Complete |

## Post-M18 产品化里程碑

| Milestone | 名称                     | 作用                                                             | 状态     |
| --------- | ------------------------ | ---------------------------------------------------------------- | -------- |
| M19       | Beta UX 产品化打磨       | 安装版入口可点击、顶部菜单中文化、主要 UI 文案中文化和空状态补齐 | Complete |
| M20       | Search and Index UX      | 项目全文搜索、可重建本地索引、Search 视图真实结果展示            | Complete |
| M21       | Story Bible Editing UX   | 人物、世界观、大纲、时间线和记忆的可编辑 UI 闭环                 | Complete |
| M22       | Settings UX Completion   | 设置页模型配置、默认 profile、连接测试、隐私安全提示的可用闭环   | Complete |
| M23       | Studio UX Completion     | Prompt/Agent/Workflow 配置资产的可选择、可编辑、可保存工作台     | Complete |
| M24       | 工作流运行观测           | AI 工作流运行 trace、上下文、模型、token/cost 和步骤状态可见     | Complete |
| M25       | 工作流运行历史           | 最近 AI 工作流运行历史、脱敏详情、步骤状态和本地审计记录         | Complete |
| M26       | 工作流失败诊断与重试策略 | 失败运行记录、可解释错误原因、重试策略展示和用户触发重试入口     | Complete |
| M27       | 安装后首次使用引导       | 欢迎页、示例项目入口、创建/打开项目引导和关键空状态行动按钮      | Deferred |
| M28       | 全局功能可用性盘点       | 高可见入口要么可用，要么明确禁用并显示中文原因                   | Complete |
| M29       | 功能完成度盘点与命令执行 | 可见入口完成度审计、核心缺口排序、命令面板真实执行闭环           | Complete |
| M30       | 底部面板工作区           | 底部面板 tabs 真实切换、工作流/问题/搜索/日志最小内容闭环        | Complete |
| M31       | 搜索结果点击跳转         | 搜索结果可点击打开章节或故事圣经条目                             | Complete |
| M32       | 时间线主视图             | 时间线入口显示真实条目列表，并可跳到故事圣经时间线编辑器         | Complete |
| M33       | 插件管理 UI              | 设置页显示项目插件注册表、授权摘要和刷新入口                     | Complete |
| M34       | 多标签编辑器             | 工作区章节标签可点击切换，不再显示禁用补齐提示                   | Complete |
| M35       | 宪法差距审计与路线图重排 | 区分切片完成和产品完整，按宪法/UI 指南重排 M36+                  | Complete |
| M36       | Workspace Layout         | Split View、面板尺寸状态和安全布局命令                           | Complete |
| M37       | Editor Tabs              | 运行期打开标签集合、dirty 标记和关闭标签                         | Complete |
| M38       | Autosave Recovery        | 章节编辑写入恢复记录，项目打开显示可恢复草稿提示                 | Complete |
| M39       | Timeline Workspace       | 时间线入口显示结构化事件轨道、指标和父时间线编辑入口             | Complete |
| M40       | Project Health           | 问题面板显示 Application 层项目健康诊断和恢复引用问题            | Complete |
| M41       | Command Palette          | 命令面板支持搜索过滤、分组、键盘选择和执行错误反馈               | Complete |

## M15 完成内容

- settings schema 将首批可配置 provider 收敛为 `openai-compatible`、`openai`、`ollama`，并继续拒绝明文 `apiKey`。
- Application 层新增 profile 保存校验：不支持 provider 或非 `secret://` 密钥引用会在写入前失败，错误信息保持脱敏。
- 新增默认 model profile 运行时解析，将项目 `settings.json` 的默认 profile 转换为 LLM Adapter 的 `modelProfile` 和生成参数。
- AI writing workflow 支持生成时动态解析 runtime profile，避免切换默认模型后仍使用旧配置。
- Desktop 组合接入项目 `settings.json` 的 ModelSettingsSession，支持通过 IPC 列出、保存、设为默认和测试 profile。
- 连接测试继续通过依赖注入执行；CI 和默认桌面 AI workflow 仍不访问真实模型 endpoint。

## M16 完成内容

- 新增 `STORY_BIBLE.md`，明确 Story Bible 资产边界、Repository/Application/Context/UI 分层和 M16 验收标准。
- 新增 `StoryBibleFileRepository`，支持保存和读取 `characters/`、`world/`、`outline/outline.json`、`timeline/events.json` 与 `memories/`，写入前和读取后均进行 schema 校验。
- 新增 `StoryBibleSession`，支持加载 Story Bible snapshot、保存 Story Asset/Memory，并从当前 Story Bible 显式生成 Context Engine candidates。
- Desktop IPC/preload 增加 Story Bible allowlist channels，renderer 不直接访问文件系统。
- WorkspaceShell 增加最小 Story Bible 摘要面板，展示资产状态、摘要和 Context eligibility。
- 项目创建流程补齐 `outline/` 目录；Context Engine 仍只消费显式候选，不扫描项目目录。

## M17 完成内容

- 新增 `docs/packaging/m17-installer-release-channel.md`，明确安装器、本地 beta 发布通道、release notes 和签名策略。
- 新增 `release-channel/beta.json` 与 `release-channel` JSON Schema/fixtures，发布通道配置进入 schema-first 校验。
- electron-builder 增加稳定 artifact name、应用 icon、Windows `dir` + `nsis` targets 和 assisted NSIS 安装选项。
- 新增 `release:check`、`release:notes`、`package:installer` 脚本；发布检查不 push、不上传、不调用真实模型或签名服务。
- CI 增加 release channel check；M17 本地 beta 明确允许 unsigned artifact，未来真实证书签名通过环境变量单独接入。

## M18 完成内容

- 新增 `PLUGIN_SYSTEM.md`，明确插件 manifest、权限、注册表、运行时边界、错误策略和 M18 验收标准。
- 新增 `plugin-manifest` 与 `plugin-registry` JSON Schema 及 valid/invalid fixtures，插件配置进入 schema-first contract tests。
- 新增 `@novel-studio/plugin-engine`，提供 registry snapshot 构建、app version 兼容检查、duplicate id 检查、disabled plugin 拒绝和 capability/permission/scope 授权检查。
- 项目创建流程新增 `plugins/` 目录和默认 `plugins/plugins.json`，插件注册表落点进入 local-first 项目结构。
- package/typecheck/build gate 纳入 `plugin-engine`，并增加 package boundary test，确保插件引擎不依赖 Repository/UI/Electron/LLM/Agent/Context/Workflow。

## M20 完成内容

- 新增 `docs/productization/m20-search-index-ux.md`，明确搜索索引 cache 边界、UI 行为和验收标准。
- 新增 `search-index` JSON Schema 与 valid/invalid fixtures，搜索索引进入 schema-first contract tests。
- 新增 `SearchIndexFileRepository`，从章节正文与 Story Bible 人物、世界观、大纲、时间线、记忆构建 `cache/indexes/search.json`。
- 新增 `ProjectSearchSession` 与 DesktopApplication 搜索方法，未打开项目时返回稳定脱敏错误。
- Desktop IPC/preload 增加搜索 allowlist channels，renderer 不直接访问文件系统。
- Search Activity 从空状态升级为真实搜索面板，支持关键词查询、重建索引、索引状态和结果列表。

## M21 完成内容

- 新增 `docs/productization/m21-story-bible-editing-ux.md`，明确 Story Bible 编辑体验范围、交互、数据边界和验收标准。
- Activity Bar 新增“故事圣经”入口，主视图提供人物、世界观、大纲、时间线和记忆五类编辑入口。
- `WorkspaceShell` 新增 Story Bible 编辑器表单，支持分类切换、条目选择、新建草稿、编辑标题/正文和保存反馈。
- Renderer `StoryBibleBridge` 支持选择分类、选择条目、更新草稿、保存 asset/memory，并在保存后重新加载 snapshot。
- 保存仍走既有 `storyBible.saveAsset` / `storyBible.saveMemory` preload API；UI 不直接访问文件系统，不引入 AI 自动写入。

## M22 完成内容

- 新增 `docs/productization/m22-settings-ux-completion.md`，明确设置体验补齐范围、交互、安全边界和验收标准。
- Settings Activity 从中文空状态升级为正式设置页，包含模型配置、自动保存与历史、隐私与安全分区。
- `ModelSettingsPanel` 支持 profile 列表、编辑表单、新建草稿、保存、设为默认和连接测试状态反馈。
- 新增 renderer `SettingsBridge`，通过 preload API 加载、保存、设默认和测试 model profile；UI 不直接访问文件系统。
- 密钥值仍不显示、不落盘；编辑表单留空时沿用已有 `secret://` 引用，连接测试继续通过注入 tester。

## M23 完成内容

- 新增 `docs/productization/m23-studio-ux-completion.md`，明确 Studio 工作台范围、交互、数据边界和验收标准。
- 新建项目默认创建 `prompt_reviewer_default`、`agent_reviewer_default` 和 `wf_review_chapter` 三个可编辑配置资产。
- Studio Activity 从空状态升级为真实工作台，支持配置资产列表、JSON 编辑器、保存按钮和版本历史区域。
- 新增 renderer `StudioBridge`，通过 preload API 加载、切换、编辑、保存和恢复 Prompt/Agent/Workflow 配置资产。
- 保存前会阻止无效 JSON；schema 校验、历史快照和恢复仍由 Application/Repository 边界完成，UI 不直接访问文件系统。

## M24 完成内容

- 新增 `docs/productization/m24-workflow-run-observability.md`，明确 AI 工作流运行观测范围、交互、安全边界和验收标准。
- Agent handoff 增加脱敏模型 metadata 与 LLM usage/cost，供上层审计展示。
- `AiWritingSuggestion` 新增 `observability`，汇总 workflow run、Context trace、model profile、token/cost 和 step 状态。
- Renderer `AiWritingWorkflowBridge` 将结构化观测数据转换为 UI 标签，不显示密钥引用或明文密钥。
- Inspector 的 AI Workflow 面板新增“AI 工作流运行观测”，展示上下文、模型、Token、成本和步骤状态。

## M25 完成内容

- 新增 `docs/productization/m25-workflow-run-history.md`，明确工作流运行历史的数据落点、安全边界、UI 行为和验收标准。
- 新增 `workflow-run-record` schema 与 valid/invalid fixtures，运行历史进入 schema-first contract tests。
- `HistoryRepository` 支持在 `history/workflows/runs/` 写入、列出和读取 workflow run record，写入前进行 schema 校验。
- AI 写作建议生成成功后记录本地 workflow run history，内容只包含脱敏 workflow/context/model/usage/step 摘要。
- Desktop IPC/preload 增加列出和读取 workflow run history 的白名单通道。
- AI Workflow Inspector 新增“工作流运行历史”，展示最近运行、状态、模型、token/cost 和选中运行步骤详情。

## M26 完成内容

- 新增 `docs/productization/m26-workflow-failure-retry.md`，明确失败诊断、重试策略、数据边界和验收标准。
- `workflow-run-record` schema 扩展脱敏失败诊断字段和可选 retry policy 摘要。
- AI 写作工作流在模型/Agent 失败后写入 `failed` workflow run history，记录失败步骤、可恢复性和建议操作。
- Renderer `AiWritingWorkflowBridge` 将失败 Result 转换为 UI props，不再让失败生成直接中断界面。
- AI Workflow Inspector 新增“失败诊断”和“重试策略”，并提供“重试 AI 工作流”用户触发入口。
- 重试复用当前指令重新生成；AI 输出仍保持建议态，应用到正文前继续要求用户确认。

## M28 完成内容

- 新增 `docs/productization/m28-global-usability-audit.md`，明确全局可用性盘点范围、UI 行为和验收标准。
- 标题栏“命令面板”按钮补齐可访问名称、tooltip，并接入打开命令面板状态。
- 当前唯一打开资产的编辑器 tab 明确标记为禁用，说明多 tab 切换将在后续里程碑补齐。
- 底部面板 tabs 明确标记为禁用，说明面板切换将在后续里程碑补齐。
- 新增 WorkspaceShell 静态渲染测试，防止高可见入口回退为无反馈按钮。
- 本次按用户指令先进入 M28；M27 安装后首次使用引导仍待回补。

## M29 完成内容

- 新增 `docs/productization/m29-functional-completion-audit.md`，明确当前可见入口的完成度、M29 处置和后续建议。
- 新增 M29 设计规格和实施计划，将 M27 首次使用引导暂缓到核心功能更稳定之后。
- 命令面板 safe command 从只读列表升级为可点击按钮。
- Renderer 新增命令执行 bridge，通过 preload API 执行命令并同步 `DesktopShellState`。
- 命令面板执行后可真实折叠项目导航、检查器和底部面板；未知命令仍由 Application safe-command 边界拒绝。

## M30 完成内容

- 新增 `docs/productization/m30-bottom-panel-workspace.md`，明确底部面板真实切换范围、非范围和验收标准。
- `DesktopShellState` 新增 `activeBottomPanelTab`，默认显示“工作流运行”。
- 底部面板 tabs 从禁用状态升级为可点击切换，并具备 `aria-selected` 和中文可访问标签。
- 底部面板新增工作流运行、问题、搜索、日志四个最小内容区。
- Renderer 通过内存 shell state 切换底部 tab；UI 不直接访问文件系统，不新增真实模型调用或 AI 自动写入。

## M31 完成内容

- 新增 `docs/productization/m31-search-result-navigation.md`，明确搜索结果点击跳转范围和验收标准。
- 搜索结果列表项从静态展示升级为可点击按钮，并具备中文可访问名称。
- 点击章节结果时切回工作区，并复用 `ProjectWorkflowBridge.selectChapter` 选中章节。
- 点击 Story Bible 或 memory 结果时切到故事圣经，并复用 `StoryBibleBridge.selectEntry` 选中条目。
- UI 只回传结构化 `ProjectSearchResultItem`，renderer 负责桥接；不新增文件系统直连或真实模型调用。

## M32 完成内容

- 新增 `docs/productization/m32-timeline-main-view.md`，明确时间线主视图范围和非范围。
- Timeline Activity 从占位说明升级为真实主视图，列出 Story Bible 中的 timeline 条目。
- 时间线主视图支持空状态、条目标题、状态和摘要展示。
- 点击时间线条目后切到故事圣经，并选中对应 timeline 条目进入可编辑详情。
- M32 复用现有 Story Bible 数据结构，不新增时间轴画布、拖拽排序或文件系统直连。

## M33 完成内容

- 新增 `docs/productization/m33-plugin-management-ui.md`，明确插件管理 UI 的只读范围和安全边界。
- 新增 `PluginRegistryFileRepository`，从项目 `plugins/plugins.json` 读取并按 `plugin-registry` schema 校验。
- Application、Desktop IPC 和 preload 增加只读插件注册表读取通道。
- Settings 视图新增“插件管理”区域，显示 plugin id、启用状态、manifest 路径和权限授权摘要。
- M33 不读取 manifest、不执行第三方插件、不安装、不下载、不写插件注册表。

## M34 完成内容

- 新增 `docs/productization/m34-multi-tab-editor.md`，明确多标签编辑器的第一步范围。
- 工作区顶部章节标签从禁用提示升级为可点击切换。
- 章节标签来源复用现有项目章节列表，当前章节使用 `aria-selected` 标记。
- 点击章节标签复用现有 `project.selectChapter` renderer bridge 和 Application/preload 边界。
- M34 不新增持久化 tab 集合、关闭 tab、拖拽排序、Split View 或多窗口编辑。

## M35 完成内容

- 新增 `docs/productization/m35-constitution-gap-audit.md`，明确 M0-M34 的 `Complete` 表示里程碑切片完成，不等于产品级完整。
- 建立 `Complete`、`Slice Complete`、`Product Gap`、`Deferred`、`Product Ready` 五类完成度口径。
- 按 `PROJECT_CONSTITUTION.md` 第5/10/11/14节、`UI_GUIDELINES.md` 和当前实现列出 Workspace Layout、多 Tab、自动保存恢复、时间线、项目健康、命令面板、插件、Provider、Streaming、Workflow Branch、编辑器、多窗口与首次使用引导缺口。
- 将后续路线重排为 M36 Workspace Layout、M37 Editor Tabs、M38 Autosave Recovery、M39 Timeline Workspace、M40 Project Health、M41 Command Palette、M42 Plugin Management、M43-M47 能力补齐和 M48 Onboarding。
- M35 不新增业务代码、不修改发布产物，先修正产品化计划和验收口径。

## M36/M37 完成内容

- 新增 `docs/productization/m36-m37-workspace-layout-editor-tabs.md`，合并记录工作区布局和编辑器标签的产品化范围。
- `DesktopShellState` 新增 `workspaceLayout`，包含 Split View 开关、导航宽度、检查器宽度和底部面板高度。
- Application safe command 新增 Split View 切换、导航宽度调整和检查器宽度调整；继续通过既有命令桥接返回 shell state。
- `WorkspaceShell` 根据布局状态渲染 CSS 变量、Split View 参考窗格和布局控制按钮。
- `ProjectWorkflowBridge` 维护运行期打开章节标签集合；创建/选择章节会加入标签，关闭当前标签会选择相邻标签。
- 编辑器标签显示 dirty 标记和关闭按钮；左侧章节树仍保留完整章节列表，不与打开标签集合混淆。

## M38 完成内容

- 新增 `docs/productization/m38-autosave-recovery.md`，明确自动保存恢复的首个产品化切片。
- `RecoveryRepository` 新增 `listRecoveryRecords()`，可从 `history/recovery/` 读取恢复记录并按更新时间倒序返回。
- `ChapterEditorSession` 在正文编辑时写入 `dirty: true` recovery record，在保存或恢复版本后写入 `dirty: false` clean marker。
- `ProjectWorkspaceSession` 将 dirty chapter recovery records 汇总到 `ProjectWorkspaceSnapshot.recovery`，不把草稿正文传给 UI。
- Desktop composition 注入 `RecoveryRepository`；renderer 继续复用既有 chapter/project IPC，不新增 UI 文件系统访问。
- `WorkspaceShell` 显示 Autosave recovery notice，并用 recovery chapter id 标记对应 editor tab dirty。
- M38 不包含恢复内容 apply/discard 面板、后台定时器、多窗口冲突处理或 recovery pruning。

## M39 完成内容

- 新增 `docs/productization/m39-timeline-workspace.md`，明确时间线工作区的事件级展示范围和非目标。
- Renderer `StoryBibleBridge` 从现有 `timeline.events` asset 的 `details.events` 解析结构化时间线事件，并按 `sequence` 排序。
- `StoryBibleEditorEntry` 新增可选 `timelineEvents`，UI 继续只消费 renderer bridge 的结构化 props，不直接读取项目文件。
- Timeline Activity 从父时间线条目列表升级为事件轨道，显示事件数、关联章节数、active/draft 指标、事件标题、摘要、状态和章节引用。
- 每个事件保留“编辑父时间线”入口，复用既有 Story Bible timeline asset 编辑闭环。
- M39 不包含事件级表单编辑、拖拽排序、独立事件 schema 或正文双向定位。

## M40/M41 完成内容

- 新增 `docs/productization/m40-m41-project-health-command-palette.md`，明确 Project Health 与 Command Palette 的联合产品化切片。
- `ProjectWorkspaceSnapshot` 新增 `health` DTO，包含 `healthy/attention/blocked` 状态、severity 汇总和结构化 issue rows。
- `ProjectWorkspaceSession` 在项目打开、创建和章节切换后生成 schema/cache/history/recovery/reference 初版健康诊断。
- Problems 底部面板显示 Project Health 摘要、错误/警告/信息计数和具体诊断项。
- `ProjectWorkflowBridge` 将 Application health DTO 传给 UI，前端不扫描项目文件。
- Command Palette 支持 safe command 搜索过滤、按 scope 分组、活动项标记、ArrowUp/ArrowDown 选择和 Enter 执行。
- Renderer 执行命令失败时保留命令面板并显示错误反馈，不再静默无响应。
- M40 不包含完整跨文件引用图扫描或自动修复；M41 不包含危险命令确认流或用户自定义快捷键注册表。

## 当前状态

- Phase 1-6 已完成。
- Phase 7 当前定义的 M0-M18 已完成。
- Post-M18 产品化打磨已完成 M19 Beta UX 产品化打磨、M20 Search and Index UX、M21 Story Bible Editing UX、M22 Settings UX Completion、M23 Studio UX Completion、M24 工作流运行观测、M25 工作流运行历史、M26 工作流失败诊断与重试策略、M28 全局功能可用性盘点、M29 功能完成度盘点、M30 底部面板工作区、M31 搜索结果点击跳转、M32 时间线主视图、M33 插件管理 UI、M34 多标签编辑器、M35 宪法差距审计、M36 Workspace Layout、M37 Editor Tabs、M38 Autosave Recovery、M39 Timeline Workspace、M40 Project Health 与 M41 Command Palette。
- M27 安装后首次使用引导已暂缓，需在核心可见功能更稳定后回补。
- 当前产品状态是 beta productization：主干闭环可运行，但多个宪法/UI 指南能力仍是 Product Gap。
- 未经用户确认不得 push。

## 建议后续路线

- 下一步建议进入 M42 Plugin Management：从只读注册表走向插件 manifest 摘要、启停状态和更明确的授权边界。
- M39-M48 按 `docs/productization/m35-constitution-gap-audit.md` 的缺口排序推进，不再把切片完成误写成产品完整。

## 当前技术债重点

- coverage threshold 尚未实现；当前 CI 已覆盖测试门禁，但没有数字覆盖率门槛。
- 生产级 signing/notarization、托管更新发布和证书管理仍是后续工作；M17 仅声明本地 unsigned beta 通道。
- schema codegen 和更强 dependency boundary 工具尚未最终选择。
- history 归档/压缩策略、项目锁、多窗口冲突处理仍需后续设计。
- 更多 Provider 的 fixtures 和 contract tests 需按批次补齐。
