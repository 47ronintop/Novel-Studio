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

## Notes

- Phase 7 当前定义的 M0-M18 已完成。
- 当前已完成 Post-M18 M19 Beta UX 产品化打磨、M20 Search and Index UX 与 M21 Story Bible Editing UX；未经用户确认不得 push。
