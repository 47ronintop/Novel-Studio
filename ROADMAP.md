# Novel Studio Roadmap

Version: 1.52 | Status: Active | Last Updated: 2026-07-07

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

| Milestone | 名称                            | 作用                                                                         | 状态     |
| --------- | ------------------------------- | ---------------------------------------------------------------------------- | -------- |
| M19       | Beta UX 产品化打磨              | 安装版入口可点击、顶部菜单中文化、主要 UI 文案中文化和空状态补齐             | Complete |
| M20       | Search and Index UX             | 项目全文搜索、可重建本地索引、Search 视图真实结果展示                        | Complete |
| M21       | Story Bible Editing UX          | 人物、世界观、大纲、时间线和记忆的可编辑 UI 闭环                             | Complete |
| M22       | Settings UX Completion          | 设置页模型配置、默认 profile、连接测试、隐私安全提示的可用闭环               | Complete |
| M23       | Studio UX Completion            | Prompt/Agent/Workflow 配置资产的可选择、可编辑、可保存工作台                 | Complete |
| M24       | 工作流运行观测                  | AI 工作流运行 trace、上下文、模型、token/cost 和步骤状态可见                 | Complete |
| M25       | 工作流运行历史                  | 最近 AI 工作流运行历史、脱敏详情、步骤状态和本地审计记录                     | Complete |
| M26       | 工作流失败诊断与重试策略        | 失败运行记录、可解释错误原因、重试策略展示和用户触发重试入口                 | Complete |
| M27       | 安装后首次使用引导              | 欢迎页、示例项目入口、创建/打开项目引导和关键空状态行动按钮                  | Complete |
| M28       | 全局功能可用性盘点              | 高可见入口要么可用，要么明确禁用并显示中文原因                               | Complete |
| M29       | 功能完成度盘点与命令执行        | 可见入口完成度审计、核心缺口排序、命令面板真实执行闭环                       | Complete |
| M30       | 底部面板工作区                  | 底部面板 tabs 真实切换、工作流/问题/搜索/日志最小内容闭环                    | Complete |
| M31       | 搜索结果点击跳转                | 搜索结果可点击打开章节或故事圣经条目                                         | Complete |
| M32       | 时间线主视图                    | 时间线入口显示真实条目列表，并可跳到故事圣经时间线编辑器                     | Complete |
| M33       | 插件管理 UI                     | 设置页显示项目插件注册表、授权摘要和刷新入口                                 | Complete |
| M34       | 多标签编辑器                    | 工作区章节标签可点击切换，不再显示禁用补齐提示                               | Complete |
| M35       | 宪法差距审计与路线图重排        | 区分切片完成和产品完整，按宪法/UI 指南重排 M36+                              | Complete |
| M36       | Workspace Layout                | Split View、面板尺寸状态和安全布局命令                                       | Complete |
| M37       | Editor Tabs                     | 运行期打开标签集合、dirty 标记和关闭标签                                     | Complete |
| M38       | Autosave Recovery               | 章节编辑写入恢复记录，项目打开显示可恢复草稿提示                             | Complete |
| M39       | Timeline Workspace              | 时间线入口显示结构化事件轨道、指标和父时间线编辑入口                         | Complete |
| M40       | Project Health                  | 问题面板显示 Application 层项目健康诊断和恢复引用问题                        | Complete |
| M41       | Command Palette                 | 命令面板支持搜索过滤、分组、键盘选择和执行错误反馈                           | Complete |
| M42       | Plugin Management               | 插件 manifest 摘要、权限详情和项目级启用/禁用状态管理                        | Complete |
| M43       | Provider Matrix                 | 宪法要求的模型 provider 配置矩阵、schema 校验和 UI 选项覆盖                  | Complete |
| M44       | Streaming UX                    | OpenAI-compatible 流式契约、delta/usage 解析和 AI 流式预览状态               | Complete |
| M45       | Workflow Branch                 | Workflow Engine branch action、分支选择和 schema 契约                        | Complete |
| M46       | Editor Hardening                | 编辑器大文档指标、gutter 渲染上限、diff 摘要和快捷键冲突矩阵                 | Complete |
| M47       | Multi-window Safety             | 本地项目锁、打开/创建前锁获取、冲突保护和健康诊断信号                        | Complete |
| M48       | Onboarding                      | 工作区快速开始、示例项目、创建/打开项目和第一章行动入口                      | Complete |
| M49       | Recovery Review                 | 可恢复草稿预览、应用和丢弃闭环                                               | Complete |
| M50       | User Preferences                | onboarding dismissed、布局偏好和用户级 UI 状态持久化                         | Complete |
| M51       | Recovery Hardening              | clean recovery 隐藏、file-ref typed error 和恢复策略收口                     | Complete |
| M52       | Editor Runtime                  | 编辑器 runtime 状态条、adapter/mode/autosave/shortcut 可见                   | Complete |
| M53       | Workflow UX                     | Workflow rail、branch choice 和 selected branch 可视化                       | Complete |
| M54       | Plugin Runtime RFC              | 插件运行时、权限、adapter、workflow contribution 架构 RFC                    | Complete |
| M55       | Editor Runtime RFC              | CodeMirror adapter、selection、visual diff 和快捷键边界 RFC                  | Complete |
| M56       | Workflow Designer RFC           | Workflow graph、条件、Agent 分支和插件 workflow 节点 RFC                     | Complete |
| M57       | Plugin Runtime Host             | host-command runtime session、权限校验和命令面板 contribution                | Complete |
| M58       | Plugin Workflow Adapter         | Workflow plugin step、run-plugin-step action 和 mock adapter                 | Complete |
| M59       | Editor Runtime Adapter          | textarea runtime adapter 抽取、结构化事件和 runtime props                    | Complete |
| M60       | Workflow Graph Projection       | Workflow graph view model、edges 和结构化 validator                          | Complete |
| M61       | CodeMirror Adapter Flag         | CodeMirror runtime adapter contract、feature flag 和 parity tests            | Complete |
| M62       | Workflow Studio Graph           | workflow config snapshot graph DTO 和 Studio 只读 graph view                 | Complete |
| M63       | Editor Selection Metadata       | 选择区 summary、runtime label 和 selection command DTO                       | Complete |
| M64       | Workflow Studio Inspector       | entry node inspector、metadata、edges 和 validation detail                   | Complete |
| M65       | Plugin Sandbox RFC              | sandboxed-code、签名、权限、timeout teardown 安全策略                        | Complete |
| M66       | Workflow Inspector Editing      | inspector 字段编辑、JSON draft 更新和 graph validation 刷新                  | Complete |
| M67       | Editor Visual Diff Runtime      | preview-only visual diff review metadata 和 runtime label                    | Complete |
| M68       | Plugin Sandbox Policy           | denied-by-default sandbox policy DTO、trust state 和 payload limit           | Complete |
| M69       | Workflow Node Selection         | graph node selection、selected inspector 和 invalid save gate                | Complete |
| M70       | CodeMirror Package Parity       | package-backed headless CodeMirror state adapter 和 textarea fallback parity | Complete |
| M71       | Selection-aware AI Preview      | selection command DTO、preview-only diff draft 和 UI preview command         | Complete |
| M72       | Plugin Sandbox Fixture          | deterministic fixture worker、timeout teardown 和 payload limit enforcement  | Complete |
| M73       | CodeMirror DOM Mount Plan       | CodeMirror DOM view mount descriptor、fallback metadata 和 no default switch | Complete |
| M74       | Selection AI App Flow           | Application/IPC/renderer selection preview generation 和 preview-only diff   | Complete |
| M75       | Selection Event UI Wiring       | textarea selection events、runtime selection state 和 preview command wiring | Complete |
| M76       | Selection Preview Apply         | stored selection preview、explicit apply 和 before-ai-apply snapshot         | Complete |
| M77       | Sandbox Isolation Spike         | sandbox isolation plan DTO、signing/teardown/readiness contract              | Complete |
| M78       | CodeMirror DOM View             | explicit CodeMirror DOM view mount path、view package metadata 和 fallback   | Complete |
| M79       | Plugin Isolation Prototype      | signed fixture isolation worker prototype、ready/blocked execution contract  | Complete |
| M80       | Workflow Layout Draft           | graph layout projection、node positions 和 Studio draft layout update        | Complete |
| M81       | Selection Apply Review UX       | selection review compare、accept/reject 和 local undo state                  | Complete |
| M82       | Plugin Signing Permission UI    | plugin trust/signing/readiness、permission 和 audit visibility               | Complete |
| M83       | Workflow Designer Interaction   | layout directional movement 和 workflow draft layout persistence             | Complete |
| M84       | Workflow Designer Canvas        | designer availability gate、edge selection state 和 structured drag commit   | Complete |
| M85       | Editor Runtime Default Gate     | CodeMirror default readiness evaluator 和 textarea fallback decision         | Complete |
| M86       | Plugin Runtime Hardening        | plugin hardening report、audit retention 和 marketplace boundary DTO         | Complete |
| M87       | Workflow Semantic Editing       | workflow add/delete/retarget/branch semantic draft helper                    | Complete |
| M88       | Editor Local Diff Review        | local diff review metadata、large-document smoke 和 textarea rollback label  | Complete |
| M89       | Plugin Runtime Trust Store      | trust store edit DTO 和 cache-protected audit JSONL projection               | Complete |
| M90       | Workflow Product Editing        | product workflow edit helper、node type、edge、branch 和 delete-confirm UI   | Complete |
| M91       | CodeMirror Migration Gate       | migration gate、opt-in/E2E/benchmark/rollback evidence 和 runtime strip      | Complete |
| M92       | Structural Refactor Gate        | 拆分超大 UI/Application 文件，降低继续开发的结构性风险                       | Complete |
| M93       | Core Writing Journey E2E        | 验证并修复“写章节→AI辅助→保存/恢复→重开继续写”的单一用户旅程                 | Complete |
| M94       | Data Loss Hardening             | 聚焦不丢稿：recovery、history、file-ref、stale-lock 的最小安全闭环           | Complete |
| M95       | Provider Compatibility Ship     | 支持公开用户常见 API：OpenAI/GPT、Claude、DeepSeek、GLM、通义等 AI 建议闭环  | Complete |
| M96       | Story Bible Consistency Minimum | 聚焦作者继续写作所需的 Story Bible 引用/一致性提示                           | Complete |
| M97       | Public Install Release Gate     | 面向公开安装用户的 installer、签名/证书策略、release channel 和核心旅程验证  | Complete |
| M98       | V1 Ship Audit                   | 只按核心闭环证据裁决 v1 ship；同步裁决阅读朗读等 v1.1 候选功能               | Complete |

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

## M42 完成内容

- 新增 `docs/productization/m42-plugin-management.md`，明确插件 manifest 摘要与启停管理的范围和非目标。
- `PluginRegistryFileRepository` 新增 `readPluginSettings()`，读取并校验 `plugins/plugins.json` 与本地 `plugin.json` manifest，缺失/无效 manifest 以条目状态反馈给 UI。
- `PluginRegistryFileRepository.setPluginEnabled()` 通过 schema 校验和原子写更新项目级 `plugins/plugins.json`。
- Application、IPC、preload 和 renderer bridge 增加插件启用状态更新通道，Renderer 不直接访问文件系统。
- Settings 插件管理区显示 display name、version、entry kind、兼容范围、requested/granted permissions、capabilities、commands/workflow steps，并提供启用/禁用按钮。
- M42 不包含插件 marketplace、远程安装/更新、插件沙箱执行或 Workflow contribution 激活。

## M43 完成内容

- 新增 `docs/productization/m43-provider-matrix.md`，明确 Provider Matrix 的配置/校验/UI 范围和非目标。
- `settings.schema.json` 的 model provider enum 扩展到 OpenAI Compatible、OpenAI、Anthropic、Google Gemini、OpenRouter、DeepSeek、智谱、通义千问、Ollama、LM Studio 和 vLLM。
- valid settings fixture 覆盖全部 provider；schema contract 继续拒绝 unsupported provider 和明文 `apiKey`。
- Application 新增 provider catalog，并用 catalog 校验 `ModelSettingsSession.saveModelProfile()` 与默认 runtime profile 解析。
- LLM Adapter `LlmProviderId` 扩展到完整 provider matrix，保持模型调用仍统一走 Adapter 边界。
- Settings UI 的 Provider select 从 3 个硬编码选项升级为 catalog 驱动选项；不暴露 secret 引用。
- M43 不包含真实 Anthropic/Gemini 等 provider SDK、真实联网测试或 Streaming UX。

## M44 完成内容

- 新增 `docs/productization/m44-streaming-ux.md`，明确 Streaming UX 的 Adapter/UI 契约范围和非目标。
- OpenAI-compatible provider 新增 fixture-backed streaming transport，streaming request 映射为 `stream: true`。
- LLM Adapter streaming 路径可接收 OpenAI-compatible delta/usage chunk，并把 malformed chunk 规范化为统一错误。
- AI 写作面板新增 `streaming`、`cancelled`、stream preview 和 cancel command 的 UI props 与 renderer bridge 状态。
- M44 不包含真实 Electron IPC live streaming，也不自动把流式内容写入正文。

## M45 完成内容

- 新增 `docs/productization/m45-workflow-branch.md`，明确 Workflow Branch 的 engine 状态机范围和非目标。
- Workflow Engine branch step 升级为 `choose-branch` action，暴露 branch id、label、condition 和 next target。
- 新增 `chooseWorkflowBranch()`，分支选择后推进 run state 并记录 branch step completed。
- workflow definition schema 和 fixture 覆盖 branch metadata。
- M45 不执行条件表达式语言；条件仍由 Application/Workflow caller 判定后显式选择分支。

## M46 完成内容

- 新增 `docs/productization/m46-editor-hardening.md`，明确 Editor Hardening 的首个产品化切片和非目标。
- 章节编辑器新增 line/word/character 指标，并在超过阈值时进入 large-document mode。
- 大文档 decorative gutter line number 渲染限制为固定上限，避免章节行数过多时无意义扩张 DOM。
- Diff preview 新增 insert/delete/replace 摘要，便于用户先扫变更规模。
- Renderer shortcut 新增归一化冲突矩阵，为后续快捷键设置和命令面板冲突检查提供基础。

## M47 完成内容

- 新增 `docs/productization/m47-multi-window-safety.md`，明确 Multi-window Safety 的本地项目锁范围和非目标。
- Repository 新增 `.novel-studio/project-lock.json` 文件锁，使用 exclusive create 获取锁。
- Application 在项目 open/create 激活前获取项目锁，锁冲突时保留当前工作区。
- `ProjectWorkspaceSnapshot` 暴露 lock summary，并在 Project Health 中显示 active lock 信息。
- Desktop composition 为每个应用实例注入本地 lock owner id，并在正常 shutdown 时释放当前项目锁；M47 不包含 stale-lock recovery UI 或实时协作。

## M48 完成内容

- 新增 `docs/productization/m48-onboarding.md`，明确 Onboarding 的工作区内引导范围和非目标。
- `WorkspaceShell` 新增“快速开始”面板，提供创建示例项目、创建新项目、打开已有项目和新建第一章行动。
- 空章节工作区新增“新建第一章”按钮，不再只显示静态占位。
- `ProjectWorkflowBridge.createExampleProject()` 通过现有 preload/API 创建本地示例项目和示例章节。
- Electron E2E 覆盖从 onboarding 创建示例项目并验证示例章节正文落盘。

## M49 完成内容

- 新增 `docs/productization/m49-recovery-review.md`，明确 chapter recovery review 的范围、数据流和非目标。
- `ProjectWorkspaceSession` 新增 recovery draft preview/apply/discard 命令；apply 返回 project workflow 与 chapter editor snapshot，避免 renderer 重新读取磁盘覆盖未保存恢复稿。
- Desktop IPC/preload 增加三个 allowlisted project recovery channel，继续经 Application 层访问 recovery。
- `WorkspaceShell` 的 autosave recovery notice 增加预览、应用和丢弃按钮，并显示恢复草稿正文预览。
- Electron E2E 覆盖从磁盘 dirty recovery record 打开项目、预览、应用、保存并验证章节正文落盘。

## M50/M51 完成内容

- 新增 `docs/productization/m50-user-preferences.md` 和 `docs/productization/m51-recovery-hardening.md`。
- 新增 user preferences Application Session 与 Repository，保存 app-local `user-preferences.json`，不存正文、密钥或项目源数据。
- Desktop IPC/preload 增加 `preferences.load` 与 `preferences.save` allowlisted channels。
- Renderer 启动加载偏好，并在 onboarding dismiss、布局命令、活动切换和底部 tab 切换后保存用户偏好。
- M51 focused tests 覆盖 clean recovery record 继续隐藏、`file-ref` recovery preview/apply 返回 typed unavailable-content error。

## M52/M53 完成内容

- 新增 `docs/productization/m52-editor-runtime.md` 和 `docs/productization/m53-workflow-ux.md`。
- `ChapterEditor` 新增可选 runtime DTO，并显示 `Editor Runtime` 状态条，包含 adapter、Markdown mode、active line range、autosave、shortcut profile 和 runtime warnings。
- Renderer 从现有 chapter editor state 计算 runtime props；不新增 renderer 文件系统访问、不新增存储和模型调用。
- AI workflow observed step props 支持 `branch` kind、description、branch choices 和 selected branch id。
- Inspector workflow observability 与 selected run history detail 使用可复用 `Workflow rail` 展示步骤、状态、分支条件和 selected branch。

## M54-M56 RFC 完成内容

- 新增 `docs/rfcs/RFC-0001-plugin-runtime.md`，接受分阶段 Plugin Runtime：manifest/registry 继续作为入口，v1 优先 host-mediated command 和 mockable workflow-step adapter，任意第三方代码执行、marketplace 和网络权限继续延后。
- 新增 `docs/rfcs/RFC-0002-editor-runtime-engine.md`，接受 adapter-first Editor Runtime Engine：textarea runtime 保留为 fallback，CodeMirror 6 作为推荐生产 adapter，保存/恢复/版本历史仍经 Application/Repository。
- 新增 `docs/rfcs/RFC-0003-workflow-designer.md`，接受 schema-first Workflow Designer：JSON 仍是 source of truth，graph view model 只做 UI 投影，Workflow Engine 保持确定性状态机。
- M54-M56 不新增运行时代码，不改变项目数据格式，不引入真实第三方插件执行、CodeMirror 默认启用或 workflow graph editor。

## M57/M58 完成内容

- 新增 `docs/productization/m57-m58-plugin-runtime-workflow.md`，明确 Plugin Runtime host-command 与 workflow-step adapter 的实施范围。
- Application 新增 `PluginRuntimeSession`，从已加载插件设置快照生成 plugin command contributions，并在 listing 与 execution 两处校验 enabled、manifest、capability、contribution、permission 和 scope。
- `DesktopApplication.listCommands()` 暴露 plugin command contributions；Command Palette 显示 plugin 分组和 disabled reason，禁用项不会触发执行。
- plugin host command 执行通过 injected `PluginRuntimeAdapter` fixture/host boundary 返回结构化 JSON，不执行任意第三方代码。
- Workflow Engine 新增 `plugin` step kind 和 `run-plugin-step` next action；Engine 只发出结构化动作，不调用插件、不访问文件系统。
- Application runtime 新增 `runWorkflowStep()`，对 workflow-step contribution 使用 `workflow:invoke` project scope 校验，并拒绝非结构化 adapter output。
- M57/M58 不包含 sandboxed-code、marketplace、插件网络权限、真实外部进程执行、workflow graph designer 或 plugin-specific IPC event channel。

## M59/M60 完成内容

- 新增 `docs/productization/m59-m60-editor-runtime-workflow-graph.md`，明确 Editor Runtime Adapter 和 Workflow Graph Projection 的实施范围。
- Renderer 新增 `editor-runtime` 模块，提供 `EditorRuntimeAdapter`、textarea runtime handle、结构化 runtime events 和 `ChapterEditorRuntimeProps` 派生函数。
- `App.tsx` 不再内联计算 textarea runtime 状态，改为通过 renderer adapter module 派生现有 `ChapterEditor` runtime props；不引入 CodeMirror，不改变保存/恢复/版本历史路径。
- Workflow Engine 新增 `WorkflowGraphViewModel`，将 workflow definition steps 投影为 nodes，并将 next、branch、default target 投影为 edges。
- Workflow Engine 新增 `WorkflowValidationReport`，覆盖 missing edge target、unreachable node、missing agent/plugin metadata 和 empty branch 等结构化问题。
- M59/M60 不包含 CodeMirror 6 adapter、selection-aware AI commands、Workflow Designer UI、graph layout persistence 或 workflow execution changes。

## M61/M62 完成内容

- 新增 `docs/productization/m61-m62-codemirror-workflow-graph-view.md`，明确 CodeMirror flag 与 Workflow Studio read-only graph 的实施范围。
- Renderer editor runtime 新增 adapter resolver，默认保持 textarea；只有显式启用 `codeMirrorEnabled` 且选择 `codemirror` 时才返回 flagged CodeMirror adapter。
- flagged CodeMirror adapter 复用 M59 的结构化 event/snapshot contract，用于后续真实 CodeMirror package parity tests；M61 不把 CodeMirror 设为默认，也不引入真实 CodeMirror 包。
- `ConfigStudioSession` 在读取/恢复 workflow config asset 时通过 Application 层附加 `workflowGraph` DTO，renderer 不直接调用 Workflow Engine。
- Studio bridge 将 workflow graph snapshot 映射到 UI props，`ConfigStudioPanel` 在 workflow asset 下显示只读 graph preview、node/edge 统计、edges 和 validation 状态。
- M61/M62 不包含 selection-aware AI commands、visual diff runtime、graph node editing、inspector edits、graph layout persistence 或 workflow graph save path。

## M63/M64 完成内容

- 新增 `docs/productization/m63-m64-selection-workflow-inspector.md`，明确 selection metadata 与 Workflow Studio inspector 的实施范围。
- Editor runtime snapshot 新增 `selectionSummary`，包含 normalized offsets、字符数、行范围、selected text preview 和 collapsed 状态。
- Editor runtime props 新增 selection summary label，运行时状态条可显示当前选择区摘要。
- 新增 `createEditorSelectionCommand()`，为后续 selection-aware AI/编辑命令提供结构化 DTO；M63 不执行 AI 动作。
- Workflow Studio graph preview 新增只读 node inspector，默认选中 entry node，显示节点 kind、metadata、incoming/outgoing edges。
- Workflow graph validation issues 在 inspector 区域可见，便于将 graph 结构和错误诊断关联。
- M63/M64 不包含真实 CodeMirror 包、selection-aware AI 执行、visual diff runtime、graph node editing 或 graph layout persistence。

## M65-M67 完成内容

- 新增 `docs/rfcs/RFC-0004-plugin-runtime-sandbox.md`，明确 sandboxed-code 的 denied-by-default 权限、签名/trust state、timeout teardown、输出 schema 校验和安全测试要求。
- 新增 `docs/productization/m65-m67-sandbox-inspector-visual-diff.md`，记录本批次产品化范围和非目标。
- Workflow Engine 新增 `applyWorkflowNodeInspectorEdit()`，通过结构化 inspector edit DTO 更新 workflow definition，不执行 workflow。
- Application 新增 `applyConfigWorkflowNodeInspectorEdit()`，将 workflow JSON 草稿更新、graph projection 和 validation report 收敛在 Application-facing helper。
- Studio bridge 新增 `applyWorkflowNodeEdit()`，只更新当前 JSON draft、validation status 和 graph snapshot，不触发保存 API。
- Workflow Studio inspector 新增 callback-driven 字段编辑控件，支持 next step、agent、plugin、contribution 和 branch default next step 的结构化编辑入口。
- Editor runtime 新增 preview-only `EditorVisualDiffReview` 和 decorations 元数据，runtime 状态条显示 visual diff preview summary。
- M65-M67 不包含真实 sandbox worker、插件 marketplace、graph drag/drop、graph layout persistence、自动应用 AI diff、真实 CodeMirror 包或 CodeMirror 默认切换。

## M68/M69 完成内容

- 新增 `docs/productization/m68-m69-sandbox-policy-workflow-selection.md`，明确 sandbox policy DTO 与 Workflow Studio node selection/save gate 的产品化范围。
- Plugin Runtime 新增 `createPluginSandboxPolicyReport()`，从 plugin settings snapshot 生成 UI-safe sandbox policy decisions。
- Sandbox policy DTO 默认拒绝 `sandboxed-code`，包含 trust state、timeout、max output payload、denied capabilities 和结构化 reasons。
- Workflow Studio graph nodes 改为可选择按钮，`selectedWorkflowNodeId` 驱动 inspector 目标节点。
- Studio bridge 新增 `selectWorkflowNode()`，并在 workflow draft 更新后保留仍存在的 selected node。
- Studio bridge 在 begin save/save 两处阻止 invalid workflow graph 保存，避免调用 preload save API。
- M68/M69 不包含真实 sandbox worker、签名校验实现、权限提示 UI、graph drag/drop、layout persistence 或 designer 运行 workflow。

## M70/M71 完成内容

- 新增 `docs/productization/m70-m71-codemirror-selection-preview.md`，明确 CodeMirror package parity 与 selection-aware preview 的范围和非目标。
- Desktop renderer 新增 `@codemirror/state` 依赖，flagged CodeMirror adapter 改为 package-backed headless state path，默认仍保持 textarea fallback。
- Editor runtime snapshot 新增 `runtimePackage` 元数据，标记 CodeMirror headless state 运行时包来源。
- CodeMirror adapter 保持 textarea runtime 的 body change、selection、save、command、warning 和 focus/destroy event parity。
- 新增 `createSelectionAwareAiPreviewDraft()`，基于 selection command DTO 和显式 proposed text 生成 preview-only replacement diff。
- Chapter Editor runtime 状态条新增 selection preview command button，保持 callback-driven，不直接调用模型、不写入存储、不自动应用正文。
- M70/M71 不包含 DOM-mounted CodeMirror view、默认编辑器切换、renderer 模型调用、Application/Agent-backed selection rewrite 或自动应用 AI diff。

## M72-M74 完成内容

- 新增 `docs/productization/m72-m74-sandbox-codemirror-selection-ai.md`，明确 sandbox fixture worker、CodeMirror DOM mount plan 和 selection AI Application flow 的范围。
- Plugin Runtime 新增 `createPluginSandboxFixtureWorkerAdapter()`，以 deterministic fixture 模拟 sandbox worker 输出，并强制 timeout 和 max output bytes。
- Fixture worker 超时返回 `PLUGIN_RUNTIME_TIMEOUT`，包含 teardown completed 元数据；输出超限返回 `PLUGIN_RUNTIME_INVALID_OUTPUT`，继续保持结构化、脱敏错误。
- CodeMirror runtime snapshot 新增 `domViewMount`，只有显式提供 DOM mount target 时才进入 planned 状态；默认仍是 textarea fallback，不自动挂载 DOM view。
- AI Writing Workflow 新增 `generateSelectionPreview()`，通过 Context Engine、Agent Engine 和 LLM Adapter 生成 selected text replacement，返回 preview-only diff，不写章节正文。
- Desktop Application、IPC allowlist、preload API 和 renderer AI bridge 接入 `generateSelectionPreview()`；renderer bridge 不设置可应用 suggestion id，避免 selection preview 被自动应用。
- M72-M74 不包含真实第三方插件代码执行、OS/process sandbox、签名 UI、CodeMirror 默认切换、真实 DOM view 替换、selection preview 自动 apply 或完整 selection event UI 接线。

## M75-M77 完成内容

- 新增 `docs/productization/m75-m77-selection-apply-sandbox-isolation.md`，明确 selection event wiring、selection apply confirmation 和 sandbox isolation spike 的范围。
- Chapter Editor textarea 新增真实 selection event extraction，`onSelect`、`onMouseUp`、`onKeyUp` 将 `selectionStart`/`selectionEnd` 转换为结构化 selection。
- Renderer App 持有 active chapter selection，并把 selection 输入 editor runtime props，使 runtime 状态条显示 selection summary 和 preview command。
- Selection preview button 通过 `AiWritingWorkflowBridge.generateSelectionPreview()` 走 Application/IPC/LLM Adapter，renderer 仍不直接调模型。
- AI workflow 存储 selection preview，新增 `applySelectionPreview()`；显式应用后通过 `ChapterEditorSession.applyAiEdit()` 更新未保存草稿，并在 history 可用时写入 `before-ai-apply` 快照。
- IPC allowlist、preload API 和 renderer bridge 接入 `applySelectionPreview()`；AI panel 的 Apply 可以应用当前 selection preview。
- Plugin Runtime 新增 `createPluginSandboxIsolationPlan()`，输出 signing、teardown、timeout、payload、denied capabilities 和 blocked readiness contract，不执行任意插件代码。
- M75-M77 不包含 CodeMirror 默认替换、真实 isolated worker/process 启动、插件签名 UI、marketplace 或 selection preview 自动保存到章节文件。

## M78-M80 完成内容

- 新增 `PRODUCT.md`，为 UI/product craft 工具提供 product register、用户、产品目的、反参考和设计原则上下文；不改变项目文档优先级。
- 新增 `docs/productization/m78-m80-codemirror-isolation-workflow-layout.md`，明确 CodeMirror DOM view、plugin isolation prototype 和 workflow layout draft 的范围。
- Desktop renderer 新增 `@codemirror/view`，CodeMirror runtime adapter 在显式提供 DOM mount element 时记录 mounted DOM view contract，并在真实 DOM parent 可用时构造 `EditorView`；默认仍不替换 textarea。
- Plugin Runtime isolation plan 在 signed 且无 denied sandbox capability 时进入 `ready`/`executable`；新增 `createPluginIsolationWorkerPrototypeAdapter()`，通过 deterministic fixture 验证 timeout、payload 和 blocked readiness，不执行任意第三方源码。
- Config Studio workflow graph snapshot 新增 layout projection，按节点顺序生成 deterministic positions；Studio bridge 支持 `updateWorkflowGraphLayout()` 更新本地 draft，不调用 preload save API。
- Workflow Studio graph preview 渲染 layout 坐标和最小移动入口，保留 invalid graph save gate。
- M78-M80 不包含 CodeMirror 默认切换、完整编辑器 UI 替换、真实 OS/process sandbox、插件签名 UI、marketplace、graph drag/drop 或 workflow layout 项目文件持久化。

## M81-M83 完成内容

- AI selection preview 新增结构化 review DTO，包含 original/proposed text、range label、compare label 和 pending 状态。
- AI writing renderer bridge 新增 selection preview reject 与 undo rejection 本地状态；拒绝不会调用 preload/API，不会写章节正文。
- Chapter Editor 与 AI Inspector 显示 Selection AI review，提供 Accept、Reject、Undo 控制；Accept 仍走既有 Application-backed apply path 和 `before-ai-apply` snapshot。
- Plugin Runtime 新增 security audit report，将 trust state、signing、readiness、executable、denied capabilities、requested/granted permissions 和 audit events 投影给 Settings UI。
- Settings Plugin Management 显示插件 trust/signing/readiness/denied/audit 信息，仍不安装、不下载、不执行第三方插件源码。
- Config Studio 新增 workflow layout 写回 helper，graph layout edit 会同步写入 workflow JSON draft 的 `layout` 字段，并继续通过既有 Studio save path 保存。
- Workflow graph UI 增加 up/down/left/right directional movement controls；仍不改变 workflow execution semantics。
- M81-M83 不包含 CodeMirror 默认切换、真实外部进程 sandbox、marketplace、完整 drag/drop 画布、复杂 edge 编辑或 Workflow Designer Product Ready。

## M84-M85 完成内容

- 新增 `docs/productization/m84-m85-workflow-canvas-editor-readiness.md`，明确 workflow canvas 和 editor default readiness 的切片边界。
- Config Studio Application 新增 workflow designer availability DTO，按 graph validation、layout readiness、node/edge count 输出 ready/blocked gate。
- Studio bridge 新增 selected workflow edge 状态和 `commitWorkflowNodeDrag()`，拖拽提交继续写入 workflow JSON draft `layout` 字段，不调用 preload save API。
- Workflow graph UI 升级为 canvas-like surface，输出稳定 `data-canvas-x/y`、CSS canvas 坐标、edge selection、designer blockers 和 drag commit 控件。
- Editor Runtime 新增 `evaluateEditorRuntimeDefaultReadiness()`，显式评估 CodeMirror feature flag、DOM mount、event parity、textarea fallback 和 large-document smoke。
- `resolveEditorRuntimeAdapter()` 默认仍保持 textarea；M85 只给出 default readiness 决策，不自动切换 CodeMirror。
- M84-M85 不包含 edge 语义编辑、完整图形化工作流编辑器、Workflow Designer Product Ready、真实 CodeMirror 默认迁移或局部 diff editor。

## M86-M88 完成内容

- 新增 `docs/productization/m86-m88-plugin-workflow-editor-hardening.md`，明确 plugin hardening、workflow semantic editing 和 editor local diff review 的范围。
- Plugin Runtime 新增 hardening report，汇总 utility/process isolation runtime、signed/trusted plugin ids、audit retention、marketplace boundary 和 per-plugin readiness。
- Hardening report 明确 `history/plugin-audit` 为 local jsonl retention 目标，并标注 protected from cache clear；仍不启用 marketplace 或任意第三方源码执行。
- Config Studio Application 新增 semantic workflow edit helper，支持 add node、delete node、retarget edge 和 edit branch edge，并返回 refreshed graph validation 和 layout draft。
- Studio bridge/UI 接入最小 semantic edit 入口：Add confirmation after selected node 与 Delete selected node，继续写入 workflow JSON draft，不调用 preload save API。
- Editor Runtime 新增 local diff review DTO，包含 preview-only decorations、large-document smoke、textarea fallback rollback label 和 review actions。
- Chapter Editor runtime strip 显示 local diff review label；默认 editor runtime 仍保持 textarea。
- M86-M88 不包含真实外部进程插件执行、签名信任持久化、marketplace、完整 graph editor、CodeMirror 默认迁移或自动应用 AI diff。

## M89-M91 完成内容

- 新增 `docs/productization/m89-m91-trust-workflow-editor-gates.md`，明确 trust store、workflow product editing 和 CodeMirror migration gate 的切片边界。
- Plugin Runtime 新增 trust store snapshot/edit DTO，支持 trust plugin 与 revoke plugin，并保持敏感字段不落入结构化快照。
- Plugin Runtime 新增 cache-protected local JSONL audit record projection，目标路径为 `history/plugin-audit/YYYY-MM-DD.jsonl`，并对 API key/secret/token 类字段做 redaction。
- Config Studio Application 新增 product workflow edit helper，支持 typed node insertion、selected edge retarget、branch form edit 和 delete confirmation gate，继续返回 refreshed graph validation/layout。
- Workflow Studio UI 新增节点类型选择、selected kind 插入、edge retarget target、branch label/condition 表单和 confirm delete 控件，仍只通过 callback 发结构化 edit。
- Editor Runtime 新增 CodeMirror migration gate DTO，要求 opt-in、default readiness、E2E parity、large-document benchmark 和 textarea rollback 全部通过才允许推荐 CodeMirror default。
- Chapter Editor runtime strip 显示 migration gate label；默认 editor runtime 仍保持 textarea。
- M89-M91 不包含 marketplace、真实第三方插件执行、真实 audit Repository 写盘、完整拖拽 graph editor、完整 inline diff editor 或强制 CodeMirror 默认切换。

## M92 完成内容

- 新增 `packages/application/test/m92-structural-refactor-gate.test.ts`，把 UI/renderer 1200 行、Application session 1000 行硬拆分阈值变成可执行门禁。
- `packages/ui/src/workspace-shell.tsx` 拆出 AI inspector 视图、Story Bible/Timeline/Search 主视图和 onboarding/recovery 辅助视图，主文件降至 1139 行。
- `apps/desktop/src/renderer/App.tsx` 拆出 renderer shell 默认状态、命令和纯 helper 到 `app-shell-support.ts`，主文件降至 1174 行。
- `packages/application/src/ai-writing-workflow-session.ts` 拆出 AI workflow DTO、history record、session options 到 `ai-writing-workflow-types.ts`，实现文件降至 986 行，并保留旧 session 模块 type re-export 兼容。
- M92 不新增用户功能；现有 workspace shell、renderer bridge 和 AI workflow session 测试继续通过。

## M93 完成内容

- `apps/desktop/test/ai-writing-workflow.e2e.ts` 新增核心写作旅程 E2E：创建项目、新建章节、写正文、生成 AI 建议、审阅 diff、确认应用、保存、关闭、重开项目、继续编辑并再次保存。
- E2E 同时验证 AI 建议不会在确认前写入正文，确认后保存到章节 Markdown，重开后正文不丢，版本历史仍显示 `Before AI apply` 快照，继续编辑后的内容再次落盘。
- M93 未新增产品功能；当前实现已能通过核心旅程验收，后续 M94 聚焦 data loss hardening 的边缘恢复/历史/锁场景。

## M94 完成内容

- `ProjectLockFileRepository` 新增 stale lock 判定：超过配置阈值的锁返回 `PROJECT_LOCK_STALE`、`recoverability=user-action` 和脱敏 owner/acquiredAt/staleAfterMs 详情。
- `packages/repository/test/project-workflow.test.ts` 覆盖 stale lock 场景，验证不会自动删除受保护的 `project-lock.json`，防止误判导致多窗口写入风险。
- M94 复用既有 dirty recovery、file-ref typed error、`before-ai-apply` history snapshot 和 M93 核心旅程 E2E；本次只补会影响“保存不丢稿、重开能继续写”的锁恢复边界，不新增 archive browser 或完整多窗口编排。

## M95 完成内容

- `@novel-studio/llm-adapter` 新增 `createProviderRouter()`，将 OpenAI/GPT、DeepSeek、GLM/Zhipu、通义、OpenRouter 和本地 OpenAI-compatible 服务路由到兼容 runtime provider；Anthropic/Claude 保留原生 provider 路径。
- LLM Adapter 成功响应和 streaming start/done 事件的 `provider` 改为用户选择的 model profile provider，避免 DeepSeek 经兼容层执行后在观测里显示成内部 provider。
- Desktop 组合层新增 `createAiProvider` 注入点；默认离线仍使用本地 mock，测试和未来真实运行时可注入 provider router，不再把 AI workflow 永久固定在 mock provider。
- 新增 `apps/desktop/test/m95-provider-runtime-routing.test.ts`，验证默认 DeepSeek profile 能进入 OpenAI-compatible runtime provider，并在 AI 建议观测里保留 DeepSeek provider 信息。
- M95 不包含 live benchmark、streaming 体验补完、密钥库实现或长尾 provider 专用 translator；这些不影响作者先完成“AI 建议→审阅→手动应用”的 v1 核心闭环。

## M96 完成内容

- `StoryBibleSession` 新增 `buildConsistencyReport()`，生成最小一致性诊断：只有当人物标题/别名在其它 Story Bible 条目或记忆中同时出现显式 `conflict`/`contradict`/`冲突`/`矛盾` 标记时才提示。
- 一致性 issue 包含 `sourceRef` 和 `targetRef`，renderer 可用 target id 跳转到相关 Story Bible 条目；不做 AI 推断、知识图谱、正文扫描或 Timeline 深编辑。
- Desktop IPC/preload/renderer bridge 增加 `storyBible.buildConsistencyReport()`，Story Bible 编辑器显示 warning 列表和 `Open target` 跳转按钮。
- 覆盖测试：Application 报告结构、IPC/preload 通道、renderer bridge props、UI warning 渲染和跳转动作。

## M97 完成内容

- 新增 `docs/packaging/m97-public-install-release-gate.md`，明确公开 Windows 安装门禁：public distribution 要求 `signing.required=true`，本地 beta 可继续 unsigned，macOS notarization 仅在 macOS artifact 纳入 v1 时进入。
- `scripts/release-check.mjs` 增加 public install gate 检查：验证 M97 文档、`npm run test:e2e`、`npm run package:artifact-check`、release channel、release notes、installer config，不 push、不上传、不发布。
- 新增 `apps/desktop/test/m97-public-install-release-gate.test.ts`，验证 release gate 文档和 `release:check` 输出 `Public install release gate passed`。
- M97 不生成真实签名证书、不上传托管更新、不执行 macOS notarization；这些只在对应公开分发渠道真实纳入时触发。

## 当前状态

- Phase 1-6 已完成。
- Phase 7 当前定义的 M0-M18 已完成。
- Post-M18 产品化打磨已完成 M19-M97，其中 M27 首次使用引导已通过 M48 回补完成。
- 当前产品状态是 beta productization：主干闭环可运行，但多个宪法/UI 指南能力仍是 Product Gap。
- `docs/superpowers/plans/2026-07-06-product-ready-remaining-work.md` 记录了 M92-M100 候选缺口清单，但不得直接执行；后续执行必须先通过本文件的范围复核检查点。
- 未经用户确认不得 push。

## V1 Ship 验收场景

v1 ship 的验收标准是一条可复现用户旅程：作者能连续 3 天使用同一项目写作，期间多次关闭、重启或异常退出；章节正文、Story Bible 资料、AI 建议审阅结果和版本/恢复记录不丢失；作者能配置并使用常见公开 API provider（OpenAI/GPT、Claude、DeepSeek、GLM、通义等，其中 DeepSeek/GLM/通义等优先走 OpenAI-compatible 兼容层，Claude 走 Anthropic/native adapter 或明确支持的兼容代理）生成续写建议并手动确认应用；重新打开应用后可以继续写同一章节，并能看到“人物设定在前文有冲突”这类最小一致性提示和跳转链接；公开安装包能被普通用户下载、安装、启动和打开项目。

## 已确认范围决策

| 决策点             | 最终裁决                                                                                    | 对路线图的影响                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 目标用户           | v1 面向公开安装用户                                                                         | 发布签名/证书策略、release channel、安装/启动 smoke 进入 v1 主线；仅内部 beta 的口径不再足够。                                                   |
| 插件生态           | 当前没有第三方插件开发者                                                                    | 插件市场、真实第三方源码执行和生产级插件隔离移出 v1；保留现有 manifest/权限边界作为未来扩展基础。                                                |
| Provider 支持      | v1 需要像同类软件一样支持 GPT、Claude、DeepSeek、GLM、通义等常见 API                        | M95 从“单 provider ship slice”升级为“Provider Compatibility Ship”；OpenAI-compatible 层是主路径。                                                |
| 编辑器技术         | textarea 暂时可接受                                                                         | CodeMirror 默认迁移、完整 inline diff editor 不进入 v1，除非核心旅程测试证明 textarea 阻碍写作。                                                 |
| Story Bible 一致性 | v1 只需提示“这个人物设定在前文有冲突”并提供跳转链接，不需要完整知识图谱或 Timeline 深编辑器 | M96 聚焦最小冲突检测、提示和跳转；Timeline 深编辑、拖拽排序、正文双向定位移入 v2/backlog。                                                       |
| 阅读朗读           | 小说阅读预览与角色配音朗读是公开用户体验增强，不是 v1 写作闭环前置条件                      | 不插入 M92-M97；M98 只做 v1.1 范围裁决。若进入实施，排在 v1 ship gate 之后，以 Story Bible 人物设定优先、系统语音默认、Edge TTS 实验开关为边界。 |

## 范围复核检查点

每完成 2 个 planned milestone，或任一核心文件超过 1200 行，或新增 milestone 前，必须暂停开发并在 `ROADMAP.md` 更新一次 Scope Review 记录。没有 Scope Review 记录，不得新增后续 milestone。

Scope Review 必须回答：

1. 当前版本能否让我自己完整写完一章小说，并在保存、关闭、重开、异常退出后不丢稿？
2. 接下来 2 个 milestone 是否直接服务 v1 ship 验收场景或结构性风险？若不能，必须移入 v2/backlog。
3. 是否有文件超过重构阈值：UI/renderer 单文件 800 行警戒、1200 行强制拆分；Application session 单文件 700 行警戒、1000 行强制拆分；测试文件 700 行警戒。
4. 当前缺口是否会导致真实作者写不完、丢失手稿、无法审阅 AI 修改、或无法在重启后继续写？若不会，默认不进入 v1 主线。

## Scope Review - 2026-07-06 after M94/M95

| 检查项               | 结论                                                                                                                         | 处理                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 核心写作闭环         | M93 E2E 已覆盖创建/写作/AI 审阅/保存/重开/继续写；M94 增加 stale lock 类型化提示，降低异常锁导致无法继续写的风险             | 可以进入 M96，但 M96 必须只补 Story Bible 最小一致性提示，不扩展 Timeline 深编辑或知识图谱 |
| 接下来两个 milestone | M96 直接对应 v1 ship 的“冲突提示和跳转”；M97 直接对应公开安装用户可下载、安装、启动和完成核心旅程                            | 保留 M96/M97；阅读朗读继续留到 M98 裁决，不插入 M96/M97                                    |
| 文件重构阈值         | M92 已建立结构门禁；本次 M94/M95 未新增超大 UI/Application 文件                                                              | 暂不新增结构性 milestone；若后续文件再次超过阈值，必须先处理结构风险                       |
| 可砍/延后项          | archive browser、history 压缩保留策略 UI、完整多窗口编排、provider streaming、live benchmark、专用 translator 不阻断核心闭环 | 全部继续留在 v2/backlog，触发条件仍按下方 Backlog 规则执行                                 |

## Scope Review - 2026-07-06 after M96/M97

| 检查项           | 结论                                                                                                                       | 处理                                                                                    |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 核心写作闭环     | M93 覆盖写作/AI/保存/重开；M94 补 stale lock；M95 补 provider routing；M96 补最小 Story Bible 冲突提示；M97 补公开安装门禁 | 可以进入 M98，但 M98 只能做 ship audit 和阅读朗读 go/no-go 裁决，不能直接开始新功能实现 |
| 接下来 milestone | 只剩 M98，直接对应 v1 ship 验收和 v1.1 候选裁决                                                                            | 保留 M98；不得新增 M99/M100，除非 M98 明确裁决出必须修复的 v1 blocker                   |
| 文件重构阈值     | 本次新增 API/bridge/UI 增量较小，未引入新的超大文件风险                                                                    | 暂不新增结构性 milestone；M98 审计时继续检查结构门禁                                    |
| 可砍/延后项      | 阅读朗读、完整知识图谱、Timeline 深编辑、provider streaming、live benchmark、真实证书签名自动化仍不阻断核心闭环            | 继续留到 M98 裁决或 v2/backlog；M98 只允许产出 go/no-go 和必要 blocker 清单             |

## Scope Review - 2026-07-07 after M98

| 检查项           | 结论                                                                                                                                                                 | 处理                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 核心写作闭环     | `docs/releases/m98-v1-ship-readiness.md` 已记录 v1 ship decision: GO；核心写作旅程、AI 审阅应用、保存重开、恢复、Story Bible 冲突提示和公开安装门禁都有测试/门禁证据 | 可以进入 v1 handoff；不得把非核心候选项重新塞回 v1 主线                                       |
| 接下来 milestone | M98 未发现必须新增 M99/M100 的 v1 blocker；阅读朗读裁决为 v1.1 backlog go，而不是 v1 blocker                                                                         | 不新增 M99/M100；若要做阅读朗读，必须另开 v1.1 milestone，第一版边界受 M98 readiness 文档约束 |
| 文件重构阈值     | `workspace-shell.tsx` 1157 行、`App.tsx` 1171 行、`ai-writing-workflow-session.ts` 984 行，均低于硬阈值但接近边界                                                    | 不阻塞 v1 ship；v1.1 新功能前必须再次 Scope Review，避免继续在近阈值文件上堆大功能            |
| 可砍/延后项      | 插件市场、生产级第三方插件执行、Workflow Designer 完整编辑、CodeMirror 默认迁移、Timeline 深编辑、streaming/live benchmark、coverage threshold 等不影响核心闭环      | 全部保留在 v2/backlog；触发条件继续按下方规则执行，不能因为“完成度低”自动回到主线路线图       |

## 裁剪后后续路线

- M92 Structural Refactor Gate：已完成。拆分 `workspace-shell.tsx`、`App.tsx` 和 `ai-writing-workflow-session.ts` 的职责边界，不新增用户功能；结构门禁已覆盖硬拆分阈值。
- M93 Core Writing Journey E2E：已完成。E2E 覆盖创建/打开项目、写正文、生成 AI 建议、审阅应用、保存、关闭重开、继续编辑，且正文和历史不丢。
- M94 Data Loss Hardening：已完成。dirty recovery、file-ref recovery、版本回滚前快照和 stale lock 类型化提示均有可复现测试；stale lock 不会自动删除受保护锁文件。
- M95 Provider Compatibility Ship：已完成。常见公开 provider 可通过 `createProviderRouter()` 接入兼容或原生 runtime；桌面组合层可注入 provider router，DeepSeek 默认 profile 已有 AI 建议闭环测试证据。
- M96 Story Bible Consistency Minimum：已完成。Story Bible 编辑器可显示显式冲突标记驱动的最小一致性提示，并提供跳转到相关 Story Bible 条目。
- M97 Public Install Release Gate：已完成。`release:check` 验证公开安装门禁文档、核心 E2E、artifact secret scan、release channel、release notes 和 installer config；不 push、不上传、不发布。
- M98 V1 Ship Audit：已完成。`docs/releases/m98-v1-ship-readiness.md` 记录 v1 ship decision: GO、核心闭环证据、验证命令、已知限制、v2/backlog 延期清单和阅读朗读 go/no-go；阅读朗读只进入 v1.1 backlog，不构成 v1 blocker；未授权 M99/M100。

## V2 / Backlog 触发条件

- 插件市场、真实第三方插件源码执行、生产级插件隔离：仅当出现第一个真实第三方插件开发者或明确插件分发生态需求时启动。
- Workflow Designer 完整可视化编辑：仅当用户实际需要维护复杂 workflow，而 JSON/表单编辑阻碍核心写作时启动。
- CodeMirror 默认迁移、完整 inline diff editor：仅当 textarea 在长文档性能、选择区编辑或 diff 审阅上被核心旅程测试证明不够用时启动。
- Timeline 深编辑、拖拽排序、正文双向定位：仅当“冲突提示 + 跳转链接”的最小 Story Bible 一致性不足以支持继续写作时启动。
- Provider streaming、live benchmark、非主流 provider 专用 translator：仅当公开用户反馈流式输出显著影响写作体验，或某 provider 不能通过 OpenAI-compatible/native 最小路径完成 AI 建议闭环时启动。
- 阅读预览与角色配音朗读：M98 已裁决为 v1.1 backlog go、v1 blocker no。第一版只支持章节阅读预览、旁白/角色基础换声、Story Bible 人物声音设定、系统语音默认和 Edge TTS 实验开关；仅当真实用户需要音频成品交付时，才启动有声书导出、复杂情绪配音、云 TTS 计费集成或全自动说话人识别。
- macOS notarization、托管自动更新：仅当对应平台或自动更新渠道纳入公开分发时启动；Windows 公开安装签名/证书策略保留在 v1 主线。
- coverage threshold、dependency boundary 专用工具、schema codegen：仅当核心旅程稳定后，或实际回归表明现有测试门禁不足时启动；其中 boundary 检查可在 M92 后作为结构风险工具优先评估。

## 当前技术债重点

- coverage threshold 尚未实现；当前 CI 已覆盖测试门禁，但没有数字覆盖率门槛。
- Windows 公开安装的签名/证书策略已有 M97 gate 文档和 release-check；真实证书材料和签名执行仍在仓库外。macOS notarization 和托管自动更新仅在对应分发渠道纳入 v1 时进入主线。
- schema codegen 和更强 dependency boundary 工具尚未最终选择。
- history 归档/压缩策略、stale lock recovery UI、完整多窗口状态编排仍需后续设计。
- Provider Matrix 配置与运行时路由已覆盖 v1 主路径；Claude 仍需要在真实 runtime 中注入 Anthropic/native provider 或明确兼容代理。streaming、live benchmark、密钥库和长尾 provider 专用 translator 进入 v2/backlog 触发项。
- `workspace-shell.tsx`、`App.tsx` 和 `ai-writing-workflow-session.ts` 低于 M92 硬阈值但接近边界；v1.1 新功能前必须先做 Scope Review，避免重新形成超大文件风险。
