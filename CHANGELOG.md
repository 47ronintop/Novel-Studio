# CHANGELOG - Novel Studio

## v0.1.0-docs - 2026-07-03

- 创建 `PROJECT_CONSTITUTION.md` v1.0。
- 创建 `PRODUCT_PRD.md` v1.0，完成 Phase 1 产品设计。
- 创建初始 `INDEX.md` 与 `TECH_DEBT.md`。
- 连接 Git remote `origin` 到 `https://github.com/47ronintop/Novel-Studio.git`。
- 创建 `ARCHITECTURE.md` v1.0，完成 Phase 2 系统架构。
- 创建 `adr/ADR-0001-engine-runtime-language.md`。
- 创建 `DATA_SCHEMA.md` v1.0，完成 Phase 3 数据结构设计。
- 创建 `UI_GUIDELINES.md` v1.0，完成 Phase 4 UI/UX 设计。
- 创建 `CODING_STANDARDS.md` v1.0 与 `TESTING.md` v1.0，完成 Phase 5 开发和测试规范。
- 创建 `ROADMAP.md` v1.0，完成 Phase 6 Task Planning。
- 发布初始文档 baseline 到 `origin/main`，进入 Phase 7。

## Phase 7 本地开发记录

- 完成 M1 Toolchain Foundation：npm workspaces、TypeScript strict、ESLint、Prettier、Vitest、Playwright、package lock 和 fixture safety rules。
- 完成 M2 Schema Foundation：15 类 JSON Schema contracts、Ajv validation helper、valid/invalid fixtures 和 32 个 contract tests。
- 完成 M3 Repository Core：shared `Result`/Unified Error、Repository ports、project file validation、atomic text writes、history snapshots、recovery records 和 cache boundary protection。
- 完成 M4 Desktop Shell：Electron security defaults、Application IPC allowlist、preload API、React renderer entry 和 desktop workspace skeleton。
- 完成 M5 Editor and Version UX：Application-backed chapter editor sessions、IPC chapter commands、preload API expansion、renderer bridge、version history preview/restore 和 fixture-backed desktop chapter flow。
- 补强 M5 保存状态 UX：dirty chapter 保存时显示 `Saving`，成功后变为 `Saved`，失败后回到 `Unsaved`。
- 创建 `LLM_ADAPTER.md` v1.0，完成 M6 LLM Adapter：provider-neutral request/response、mock provider、streaming/non-streaming、timeout/retry/rate-limit、provider error normalization、secret redaction、usage/cost reporting 和 OpenAI-compatible fixture mapping。
- 修复 M6 review findings：强制 in-flight adapter timeout，并把 streaming errors 规范化为 `Result`。
- 创建 `WORKFLOW_ENGINE.md` v1.0，完成 M7.1 Workflow Engine：workflow definition parsing、next-action evaluation、step completion、confirmation gate enforcement 和 package boundary tests。
- 创建 `CONTEXT_ENGINE.md` v1.0，完成 M7.2 Context Engine：context bundle build、token budget enforcement、exclusion trace、memory confidence filtering、source reference trace 和 no full-novel blind stuffing。
- 创建 `AGENT_ENGINE.md` v1.0，完成 M7.3 Agent Engine：input/output validation、LLM Adapter invocation、structured output extraction、malformed JSON failure handling、Agent Handoff JSON production 和 package boundary tests。
- 完成 M8 Studio and Settings foundation：safe model profile settings、injected model connection tests、secret redaction、Prompt/Agent/Workflow config editing、schema validation、version snapshots、rollback 和 callback-driven UI panels。
- 完成 M9 Alpha Hardening：UI accessibility checks、reduced-motion/focus styling、synthetic 1,000,000-character performance fixture、Repository open-path performance smoke、local alpha build gate 和 artifact secret scanning。
- 完成 M10 Beta Packaging Foundation：Vite renderer bundling、electron-builder configuration、package preflight checks 和 packaging notes。
- 完成 M11 Package Artifact Stabilization：定位 GitHub Electron 下载源不可达导致的 `package:dir` 超时，添加 Electron mirror、单一 package output wrapper、artifact secret scan，并成功生成 unpacked artifact。
- 完成 M12 Project Workflow Vertical Slice：新增项目创建/打开、章节列表、创建/切换、active chapter editor 串联、project workflow IPC/preload、renderer bridge 和 `WorkspaceShell` 项目操作控件。
- 完成 M13 Real E2E and CI Gate：新增真实 Electron Playwright smoke，修复 runtime package exports 与 sandbox preload 运行时问题，新增 GitHub Actions CI gate，并把 `test:e2e` 改为实际运行测试。
- 完成 M14 AI Writing Workflow UX：新增章节 AI 写作建议 session、IPC/preload/API、renderer bridge、AI Workflow 面板、diff preview、用户确认后应用，并用真实 Electron E2E 验证生成不改正文、Apply 后才进入 `Unsaved` 编辑状态。
- 完成 M15 Real Provider Profiles：收紧 settings model provider schema，新增 profile 保存前校验、默认 runtime profile 解析、AI workflow 动态 profile resolver，并把桌面项目 `settings.json` 接入 ModelSettingsSession；连接测试继续依赖注入，CI 不访问真实模型。
- 完成 M16 Story Bible Modules：新增 `STORY_BIBLE.md`，实现 Story Bible Repository/Application 最小闭环，支持人物、世界观、大纲、时间线和记忆读写，接入 Context Engine 显式候选来源，并通过 Desktop IPC/preload 与 WorkspaceShell 摘要面板暴露最小 UI。
- 完成 M17 Installer and Release Channel：新增 Windows NSIS installer 配置、应用 icon、schema 校验的 beta channel manifest、release notes、release validation scripts、installer wrapper 和 CI release channel check；发布仍为手动流程，本地 beta 签名明确为可选。
- 完成 M18 Plugin System：新增 `PLUGIN_SYSTEM.md`、plugin manifest/registry schema 与 fixtures、`@novel-studio/plugin-engine` 权限策略、项目 `plugins/plugins.json` 默认注册表，以及插件引擎 package boundary tests。
- 发布前文档整理：将 `STORY_BIBLE.md` 统一为中文说明，收口 `PLUGIN_SYSTEM.md` 状态，并同步 `INDEX.md` 中的文档版本和 M17 中文描述。
- 进入 v0.1.0 beta 发布验收：更新 release notes 覆盖 M18，增强 release check 与 M17 发布通道测试，并记录最新本地 installer artifact、验证证据和非阻塞风险。
- 修复安装版首次启动不可编辑/无窗口：默认 beta 项目改为在可写本地目录启动时创建/打开，运行时 JSON Schema contracts 随 `app.asar` 打包，不再依赖未打包的源码 fixture，并新增无 fixture 启动的单元测试、Electron E2E 和 packaged executable smoke。
- 补强 beta 启动 UX：Open/Create project 接入系统文件夹选择器，Navigator 显示取消/错误反馈和 busy 状态，并用 IPC allowlist、bridge、UI 与 Electron E2E 测试覆盖正式软件式项目入口。
- 完成 M19 Beta UX 产品化打磨：左侧 Activity Bar 可点击并切换主视图，Electron 顶部菜单中文化，工作区、命令面板、章节编辑器、模型设置和 Studio 主要 UI 文案中文化，未完成入口显示中文空状态，并重新生成本地安装器。
- 完成 M20 Search and Index UX：新增 schema-first 搜索索引、`SearchIndexFileRepository`、Project Search Application Session、Desktop IPC/preload、Search Activity 查询面板和本地 cache 重建闭环。
- 完成 M21 Story Bible Editing UX：新增故事圣经主入口、五类资产编辑表单、renderer 草稿桥接、保存 asset/memory 后刷新 snapshot，并继续保持 UI 不直接访问文件系统。
- 完成 M22 Settings UX Completion：Settings Activity 升级为正式设置页，支持模型 profile 编辑、保存、设默认、连接测试和隐私安全提示，保存仍通过 preload/IPC/Application settings session。
- 完成 M23 Studio UX Completion：新增默认 Prompt/Agent/Workflow 配置资产，Studio Activity 升级为可选择、可编辑、可保存和可恢复版本的真实工作台，保存仍通过 preload/IPC/Application config studio session。
- 完成 M24 工作流运行观测：AI 写作建议结果新增运行观测数据，Inspector 显示 workflow、context、model、token/cost 和 step 状态，继续保持建议态与用户确认。
- 完成 M25 工作流运行历史：AI 写作建议生成后写入本地 workflow run history，Inspector 显示最近运行、脱敏详情、token/cost 和步骤状态。
- 完成 M26 工作流失败诊断与重试策略：模型/Agent 失败会写入脱敏 failed workflow run history，Inspector 显示失败诊断、重试策略和用户触发重试入口，失败不会自动写入正文。
- 按用户指令跳过 M27 先完成 M28 全局功能可用性盘点：命令面板按钮接入打开行为，编辑器单 tab 与底部面板 tabs 明确禁用并显示中文原因，避免高可见入口无反馈。
- 按用户反馈暂缓 M27 并完成 M29 功能完成度盘点与命令面板执行闭环：新增可见入口完成度审计，命令面板 safe command 支持真实执行并同步桌面 shell state。
- 完成 M30 底部面板工作区：底部面板 tabs 支持真实切换，工作流运行、问题、搜索和日志面板提供最小中文内容闭环。
- 完成 M31 搜索结果点击跳转：搜索结果项升级为可点击按钮，章节结果跳回工作区并选中章节，Story Bible 和 memory 结果跳到故事圣经并选中条目。
- 完成 M32 时间线主视图：Timeline Activity 显示 Story Bible timeline 条目列表，支持空状态和点击进入故事圣经时间线编辑器。
- 完成 M33 插件管理 UI：新增插件注册表读取 Repository/Application/IPC/preload 链路，设置页显示项目插件注册表、启用状态、manifest 路径和授权摘要，不执行第三方插件代码。
- 完成 M34 多标签编辑器：工作区顶部章节标签改为可点击切换，复用现有章节选择 bridge，不再显示“后续补齐”的禁用标签提示。
- 完成 M35 宪法差距审计与路线图重排：新增产品化差距审计文档，区分切片完成和产品完整，按宪法/UI 指南重排 M36-M48 后续路线。
- 完成 M36/M37 Workspace Layout 与 Editor Tabs：新增 shell 布局状态、安全布局命令、Split View 参考窗格、运行期打开章节标签集合、dirty 标记和关闭标签行为。
- 完成 M38 Autosave Recovery：章节编辑写入 `history/recovery/` 恢复记录，项目打开显示可恢复草稿提示，保存后写入 clean marker。
- 完成 M39 Timeline Workspace：Timeline Activity 解析 Story Bible 时间线结构化事件，显示事件轨道、指标、章节引用和父时间线编辑入口。
- 完成 M40/M41 Project Health 与 Command Palette：问题面板显示 Application 层健康诊断，命令面板支持搜索过滤、分组、键盘选择和执行错误反馈。
- 完成 M42 Plugin Management：插件管理从只读 registry 升级为 manifest 摘要、权限详情和项目级启用/禁用管理；仍不安装、不下载、不执行第三方插件代码。
- 完成 M43 Provider Matrix：settings schema、Application 校验、LLM Adapter provider 类型和 Settings UI provider select 覆盖宪法要求的 11 个模型渠道；CI 仍只使用 mock/fixture，不访问真实 provider。
- 完成 M44/M45 Streaming UX 与 Workflow Branch：OpenAI-compatible streaming fixture 契约支持 delta/usage 解析和 malformed chunk 规范化，AI 写作 UI 增加流式预览/取消状态；Workflow Engine 增加 `choose-branch` action、`chooseWorkflowBranch()` 和 branch schema/fixture 契约。
- 完成 M46/M47 Editor Hardening 与 Multi-window Safety：章节编辑器新增文档指标、large-document mode、gutter 渲染上限和 diff 摘要，renderer 新增快捷键冲突矩阵；Repository/Application/Desktop 新增本地项目锁获取、冲突保护、正常 shutdown 释放和 Project Health lock 信号。
- 完成 M48 Onboarding：工作区新增快速开始面板、示例项目入口、创建/打开项目行动和空章节“新建第一章”按钮；示例项目通过现有 Project Workflow bridge 创建本地项目和示例章节。
- 完成 M49 Recovery Review：Autosave recovery notice 增加恢复草稿预览、应用和丢弃动作，Application/IPC/preload/renderer 全链路通过结构化 recovery command 闭环，E2E 覆盖磁盘 dirty recovery record 到应用保存。

## Notes

- Phase 7 当前定义的 M0-M18 已完成。
- 当前已完成 Post-M18 M19-M49；M27 安装后首次使用引导缺口已通过 M48 回补；未经用户确认不得 push。
