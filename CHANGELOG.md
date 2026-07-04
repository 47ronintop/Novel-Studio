# CHANGELOG - Novel Studio

## v0.1.0-docs - 2026-07-03

- 创建 `PROJECT_CONSTITUTION.md` v1.0。
- 创建 `PRODUCT_PRD.md` v1.0，完成 Phase 1 产品设计。
- 创建初始 `INDEX.md`。
- 创建初始 `TECH_DEBT.md`。
- 连接 Git remote `origin` 到 `https://github.com/47ronintop/Novel-Studio.git`。
- 创建 `ARCHITECTURE.md` v1.0，完成 Phase 2 系统架构。
- 创建 `adr/ADR-0001-engine-runtime-language.md`。
- 解决 `TD-002` 记录的 Git 仓库状态问题。
- 创建 `DATA_SCHEMA.md` v1.0，完成 Phase 3 数据结构设计。
- 定义 Markdown、JSON、history、memories、recovery records、cache 的 source-of-truth 规则。
- 明确 SQLite 只允许作为 `cache/` 下可重建索引层。
- 创建 `UI_GUIDELINES.md` v1.0，完成 Phase 4 UI/UX 设计。
- 定义桌面 IDE 工作区、dark-first 视觉系统、Command Palette、AI review UX 和核心交互状态。
- 创建 `CODING_STANDARDS.md` v1.0，完成 Phase 5 开发规范。
- 创建 `TESTING.md` v1.0，完成 Phase 5 测试规范。
- 定义 TypeScript Strict、JSON Schema canonical contracts、Ajv validation、Repository/Adapter 边界、CodeMirror 6 编辑器倾向、headless UI primitive 倾向、shortcut registry 和 fixture-first testing。
- 创建 `ROADMAP.md` v1.0，完成 Phase 6 Task Planning。
- 定义实现里程碑 M0-M9、Provider 实现顺序、risk register 和 Phase 7 execution gates。
- 删除 `PROJECT_CONSTITUTION.md` 中误粘贴的独立 `text` 残留。
- 更新 `TECH_DEBT.md`，关闭 Provider 顺序和初始文档 baseline 相关事项。
- 将初始文档 baseline 发布到 `origin/main`，进入 Phase 7。
- 更新 `INDEX.md` 和 `TECH_DEBT.md`，关闭 M0.2 remote branch policy。

## Phase 7 本地开发记录

- 完成 M1 Toolchain Foundation：npm workspaces、TypeScript strict、ESLint、Prettier、Vitest、Playwright、package lock 和 fixture safety rules。
- 验证 M1 命令：`typecheck`、`lint`、`format`、`test`、`test:e2e` 和 `npm audit`。
- 完成 M2 Schema Foundation：15 类 JSON Schema contracts、Ajv validation helper、valid/invalid fixtures 和 32 个 contract tests。
- 添加 `ajv`、`ajv-formats` 和 Node type declarations，支撑 schema package 与测试。
- 完成 M3 Repository Core：shared `Result`/Unified Error、Repository ports、project file validation、atomic text writes、history snapshots、recovery records 和 cache boundary protection。
- 添加 Repository 测试，覆盖有效/缺失/非法项目打开、atomic write failure preservation、`before-ai-apply`/`before-rollback` snapshots、`history/recovery/` 写入、cache clear 不触碰 `history/` 和 `memories/`。
- 完成 M4 Desktop Shell：Electron security defaults、Application IPC allowlist、preload API、React renderer entry 和 desktop workspace skeleton。
- 添加 Application command registry，包含 safe command `riskLevel`、shell state DTOs 和 command execution boundary。
- 添加 UI package：Activity Bar、Navigator、Editor Area、Inspector、Bottom Panel、Command Palette、OKLCH design tokens 和 Ctrl/Cmd+K shortcut handling。
- 升级 Vitest，清除当时 audit findings 并保持 0 vulnerabilities 门禁。
- 完成 M5 Editor and Version UX：Application-backed chapter editor sessions、IPC chapter commands、preload API expansion、renderer bridge、version history preview/restore 和 fixture-backed desktop chapter flow。
- 添加 Chapter Editor UI 控件：save、version preview、version restore 和 preview-only AI diffs，同时保持所有文件访问只经 Application/Repository。
- 加强 M5 renderer 保存状态 UX，使 dirty chapter 保存时立即显示 `Saving`，成功后变为 `Saved`，失败后回到 `Unsaved`。
- 验证 M5 门禁：`typecheck`、`lint`、`format`、`test`、`test:contract`、`npm audit` 均通过，0 vulnerabilities。
- 创建 `LLM_ADAPTER.md` v1.0，定义 M6 provider-neutral model call 设计。
- 完成 M6 LLM Adapter：strict TypeScript contracts、deterministic mock provider、streaming/non-streaming entrypoints、timeout/retry/rate-limit normalization、usage/cost reporting 和 OpenAI-compatible fixture mapping。
- 添加 LLM Adapter 测试，覆盖 mock streaming/non-streaming、timeout、retry backoff、rate limits、retry exhaustion、secret redaction、missing usage、OpenAI-compatible response mapping、cost estimation 和 malformed provider payloads。
- 验证 M6 门禁：`typecheck`、`lint`、`format`、`test`、`test:contract`、`npm audit` 均通过，0 vulnerabilities。
- 修复 M6 review findings：强制 in-flight adapter timeout，并把 streaming errors 规范化为 `Result`，避免直接抛出 provider failures。
- 创建 `WORKFLOW_ENGINE.md` v1.0，定义 M7.1 deterministic workflow state machine。
- 完成 M7.1 Workflow Engine：workflow definition parsing、next-action evaluation、step completion、confirmation gate enforcement 和 package boundary tests。
- 创建 `CONTEXT_ENGINE.md` v1.0，定义 M7.2 context bundle、budget 和 trace。
- 完成 M7.2 Context Engine：explicit candidate bundle construction、token budget enforcement、exclusion trace、confirmed-memory filtering、source reference trace、full-novel stuffing guard 和 package boundary tests。
- 创建 `AGENT_ENGINE.md` v1.0，定义 M7.3 agent execution 和 handoff。
- 完成 M7.3 Agent Engine：injected input/output validation、LLM Adapter invocation、structured output extraction、malformed JSON failure handling、Agent Handoff JSON production 和 package boundary tests。
- 完成 M8 Studio and Settings foundation：safe model profile settings、injected model connection tests、secret redaction、Prompt/Agent/Workflow config editing、schema validation、version snapshots、rollback 和 callback-driven UI panels。
- 完成 M9 Alpha Hardening：UI accessibility checks、reduced-motion/focus styling、synthetic 1,000,000-character performance fixture、Repository open-path performance smoke、local alpha build gate 和 artifact secret scanning。
- 完成 M10 Beta Packaging Foundation：Vite renderer bundling、electron-builder configuration、package preflight checks 和 packaging notes。
- 完成 M11 Package Artifact Stabilization：定位 GitHub Electron 下载源不可达导致的 `package:dir` 超时，添加 Electron mirror、唯一 package output wrapper、artifact secret scan，并成功生成 unpacked artifact。

## Notes

- Phase 7 正在进行中。
- M11 package artifact stabilization 已完成；当前可生成 unpacked artifact。Installer target、icon 和 signing/notarization 进入后续 roadmap。
