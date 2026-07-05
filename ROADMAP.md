# Novel Studio Roadmap

Version: 1.16 | Status: Active | Last Updated: 2026-07-05

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
| M27       | 安装后首次使用引导       | 欢迎页、示例项目入口、创建/打开项目引导和关键空状态行动按钮      | Pending  |
| M28       | 全局功能可用性盘点       | 高可见入口要么可用，要么明确禁用并显示中文原因                   | Complete |

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

## 当前状态

- Phase 1-6 已完成。
- Phase 7 当前定义的 M0-M18 已完成。
- Post-M18 产品化打磨已完成 M19 Beta UX 产品化打磨、M20 Search and Index UX、M21 Story Bible Editing UX、M22 Settings UX Completion、M23 Studio UX Completion、M24 工作流运行观测、M25 工作流运行历史、M26 工作流失败诊断与重试策略与 M28 全局功能可用性盘点。
- M27 安装后首次使用引导尚未完成，需后续回补。
- 未经用户确认不得 push。

## 建议后续路线

- 下一步建议进入 M27 安装后首次使用引导，补齐欢迎页、示例项目入口、创建/打开项目引导和关键空状态行动按钮。

## 当前技术债重点

- coverage threshold 尚未实现；当前 CI 已覆盖测试门禁，但没有数字覆盖率门槛。
- 生产级 signing/notarization、托管更新发布和证书管理仍是后续工作；M17 仅声明本地 unsigned beta 通道。
- schema codegen 和更强 dependency boundary 工具尚未最终选择。
- history 归档/压缩策略、项目锁、多窗口冲突处理仍需后续设计。
- 更多 Provider 的 fixtures 和 contract tests 需按批次补齐。
