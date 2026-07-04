# Novel Studio v1 实现计划

> 面向 agentic worker：执行本计划时必须遵守 `PROJECT_CONSTITUTION.md`、`CODING_STANDARDS.md`、`TESTING.md` 和各专题设计文档。实现必须按 task-by-task 推进，并在每个里程碑结束前通过本地门禁。

Version: 1.0 | Status: Active | Phase: 7 Formal Development

## 1. 目标

Novel Studio v1 是一个 local-first、project-based 的 AI 小说创作 IDE。它必须可靠管理项目文件、版本历史、可控 AI workflow 和桌面写作工作区。

核心架构按以下分层实现：

```text
Frontend
-> Application
-> Service
-> Agent Engine
-> Context Engine
-> Workflow Engine
-> LLM Adapter
-> Repository
-> Storage
```

项目文件以 Markdown/JSON 为 source of truth；SQLite 只能作为 `cache/` 下可重建索引层。所有核心运行时代码使用 TypeScript Strict。

## 2. 规划原则

- 先写文档和契约，再写实现。
- 用可独立验证的 vertical slice 推进。
- 先建立工具链和质量门禁，再扩展功能面。
- 先保护用户数据，再添加高级 AI 行为。
- CI 和本地测试必须使用 mock LLM；真实模型调用只能用于离线评估。
- 所有任务必须对齐 P1-P10 和已批准的 Phase 1-5 文档。

## 3. 里程碑总览

| Milestone | 名称                           | 目标                                                                       | Exit Criteria                                               | 当前状态 |
| --------- | ------------------------------ | -------------------------------------------------------------------------- | ----------------------------------------------------------- | -------- |
| M0        | Repository Baseline            | 提交当前文档并建立分支纪律                                                 | 初始提交存在，remote 配置正确，文档不被工具破坏             | Complete |
| M1        | Toolchain Foundation           | 创建 monorepo、TypeScript strict、lint、format、test runner                | `typecheck`、`lint`、`format`、`test` 通过                  | Complete |
| M2        | Schema Foundation              | 实现 canonical JSON Schema 和派生/手写 TS 类型边界                         | valid fixtures 通过，invalid fixtures 稳定失败              | Complete |
| M3        | Repository Core                | 实现项目文件 IO、atomic writes、history、recovery、cache boundary          | Repository tests 使用临时项目通过                           | Complete |
| M4        | Desktop Shell                  | 建立 Electron/React shell、layout、command palette skeleton                | App 可打开本地项目 fixture，UI 不直接访问文件系统           | Complete |
| M5        | Editor and Version UX          | 实现 Markdown 编辑、autosave 状态、version history、diff review foundation | Chapter edit/save/recover/version path 有测试覆盖           | Complete |
| M6        | LLM Adapter                    | 实现 provider-neutral LLM Adapter、mock provider、首个 provider shape      | mock provider 和 fixture tests 通过；CI 不调用真实模型      | Complete |
| M7        | Agent/Context/Workflow         | 实现结构化 workflow execution 和 context budget trace                      | mock LLM 下可产生结构化 handoff，边界测试通过               | Complete |
| M8        | Studio and Settings            | 实现 Prompt/Agent/Workflow editors、model profile settings、secret refs    | config edit/version/rollback path 可验证                    | Complete |
| M9        | Hardening and Alpha            | 完成安全、可访问性、性能、alpha checklist                                  | Alpha candidate 通过本地 required gates                     | Complete |
| M10       | Beta Packaging Foundation      | 建立 renderer bundling、packager config、package preflight                 | `package:check` 通过，packaging limitation 记录到 TECH_DEBT | Complete |
| M11       | Package Artifact Stabilization | 稳定真实 unpacked artifact 产出                                            | `package:dir` 成功，artifact secret scan 通过               | Complete |

## 4. 通用完成门禁

任何 feature task 完成前必须满足：

- TypeScript strict 通过。
- ESLint 通过。
- Prettier check 通过。
- 相关 unit tests 通过。
- 相关 contract/integration tests 通过。
- 无直接跨层 import 违规。
- Prompt 和 model 参数不得硬编码在不可编辑位置。
- API key 不得以 plaintext 出现在 project files、logs、fixtures 或 tests。
- 文档或 `TECH_DEBT.md` 已同步更新。

## 5. M0 - Repository Baseline

### M0.1 Initial Documentation Commit

- [x] 确认 `origin` 是 `https://github.com/47ronintop/Novel-Studio.git`。
- [x] 检查文档中 TODO/TBD/占位项。
- [x] 运行 `git status --short --branch`。
- [x] 提交 foundation documents。
- [x] 未经用户确认不 push。

### M0.2 Remote Branch Policy

- [x] 确认远端默认分支策略。
- [x] 用户确认后发布初始 baseline。
- [x] 更新 `TD-006`。

## 6. M1 - Toolchain Foundation

### M1.1 Workspace Scaffold

- [x] 选择 npm workspaces。
- [x] 定义 root scripts：`typecheck`、`lint`、`format`、`test`、`test:contract`、`test:e2e`。
- [x] 配置 TypeScript strict baseline。
- [x] 保持 workspace minimal，先不写业务代码。

### M1.2 Formatting and Linting

- [x] 配置 ESLint flat config。
- [x] 配置 Prettier 和 EditorConfig。
- [x] 禁止 explicit `any`。
- [x] 建立初步 import boundary 规则。

### M1.3 Test Runner Foundation

- [x] 配置 Vitest。
- [x] 配置 Playwright placeholder。
- [x] 添加 fixture safety rules。

## 7. M2 - Schema Foundation

### M2.1 Schema Package Structure

- [x] 添加 project metadata、settings、chapter frontmatter、unified error schema。
- [x] 添加 valid/invalid fixtures。
- [x] 添加 Ajv validation helpers。

### M2.2 Core Asset Schemas

- [x] 添加 story asset、prompt template、agent config、workflow definition、memory schema。
- [x] 覆盖 `DATA_SCHEMA.md` 中要求的字段。
- [x] 明确 unknown field policy。

### M2.3 Runtime Contract Schemas

- [x] 添加 context bundle、agent handoff、LLM request/response、version record、recovery record schema。
- [x] 校验 agent handoff JSON。
- [x] 校验 LLM usage/cost structures。
- [x] 校验 recovery record safety。

## 8. M3 - Repository Core

### M3.1 Repository Ports and Result Types

- [x] 定义 `Result<T, E>`。
- [x] 定义 Unified Error shape。
- [x] 定义 project、history、recovery、cache repository interfaces。

### M3.2 Project File Reader

- [x] 读取 `project.json` 和 `settings.json`。
- [x] 返回前先做 schema validation。
- [x] 对缺失或非法文件返回 diagnostic，不直接 mutation。

### M3.3 Atomic Write and History

- [x] 实现 temp write + atomic rename。
- [x] 创建 `before-ai-apply` 和 `before-rollback` snapshots。
- [x] 测试 write failure 不破坏原文件。

### M3.4 Recovery and Cache Guard

- [x] recovery records 写入 `history/recovery/`。
- [x] cache clear 只允许触碰 `cache/`。
- [x] 测试证明 `history/` 和 `memories/` 不被 cache clear 删除。

## 9. M4 - Desktop Shell

### M4.1 Electron Security Baseline

- [x] renderer 禁止直接 Node access。
- [x] 定义 IPC allowlist。
- [x] preload 只暴露 Application Layer commands。

### M4.2 Workspace Shell UI

- [x] 实现 Activity Bar、Navigator、Editor Area、Inspector、Bottom Panel skeleton。
- [x] 使用 `UI_GUIDELINES.md` 中的 OKLCH tokens。
- [x] UI components 保持 business-free。

### M4.3 Command Palette Foundation

- [x] 添加 Ctrl/Cmd + K。
- [x] 只接入 safe commands。
- [x] 添加 command risk level。

## 10. M5 - Editor and Version UX

### M5.1 Editor Spike

- [x] 记录 CodeMirror 6 与 Monaco 的最小对比。
- [x] 确认 v1 使用 CodeMirror 6 方向。

### M5.2 Chapter Editor Vertical Slice

- [x] 打开 chapter fixture。
- [x] 编辑内容。
- [x] 显示 dirty/saving/saved。
- [x] 通过 Repository 保存，不让 UI 直接访问文件系统。

### M5.3 Version History and Diff

- [x] 列出 snapshots。
- [x] 预览 snapshot。
- [x] restore 前创建 `before-rollback`。
- [x] AI suggestion diff 默认只预览不应用。

## 11. M6 - LLM Adapter

### M6.1 Adapter Contract

- [x] 定义 provider-neutral request/response。
- [x] 实现 deterministic mock provider。
- [x] 实现 streaming 与 non-streaming interfaces。

### M6.2 First Provider Set

Provider 顺序：

1. OpenAI Compatible API
2. OpenAI
3. Anthropic
4. Google Gemini
5. Ollama

当前实现：

- [x] 实现 OpenAI Compatible provider shape。
- [x] 添加 provider normalization tests。
- [x] 添加 rate limit、timeout、retry fixtures。
- [x] CI 不调用真实网络。

### M6.3 Cost and Token Reporting

- [x] 添加 token usage model。
- [x] 添加 cost estimate model。
- [x] usage/cost 状态支持 `missing`、`estimated`、`actual`。

### M6.4 Review Hardening

- [x] 强制 in-flight timeout enforcement。
- [x] streaming errors 规范化为 `Result`。
- [x] secret redaction 覆盖错误和日志路径。

## 12. M7 - Agent / Context / Workflow

### M7.1 Workflow State Machine

- [x] 创建 `WORKFLOW_ENGINE.md`。
- [x] 解析 Workflow Definition。
- [x] 评估 next action。
- [x] 执行 step completion。
- [x] 强制 confirmation gate。
- [x] 通过 package boundary test 防止依赖 Agent/Context/LLM/Repository。

### M7.2 Context Engine

- [x] 创建 `CONTEXT_ENGINE.md`。
- [x] 从 chapter、memory、character、world、timeline、goal candidates 构建 Context Bundle。
- [x] 执行 token budget enforcement。
- [x] 记录 exclusion trace 和原因。
- [x] 默认过滤 unconfirmed memories。
- [x] 记录 source reference trace。
- [x] 防止 full-novel blind stuffing。

### M7.3 Agent Engine

- [x] 创建 `AGENT_ENGINE.md`。
- [x] 校验 agent input。
- [x] 只通过 LLM Adapter 调用模型。
- [x] 校验 structured output。
- [x] 生成 Agent Handoff JSON。
- [x] malformed JSON fixture 安全失败。

## 13. M8 - Studio and Settings

### M8.1 Model Settings

- [x] 添加 model profile editor。
- [x] 使用 `apiKeyRef`，不持久化 plaintext secret。
- [x] 使用 Adapter 做 test connection。
- [x] logs 和 UI detail 做 redaction。

### M8.2 Prompt / Agent / Workflow Studio

- [x] 添加 Prompt editor 和 schema validation。
- [x] 添加 Agent editor，支持 input/output schema refs。
- [x] 添加 Workflow editor，支持 step graph/list 基础编辑。
- [x] 添加 version history 和 rollback。
- [x] invalid config 不允许成为 active。

## 14. M9 - Hardening and Alpha

### M9.1 Accessibility and Keyboard Pass

- [x] 验证 focus order。
- [x] 验证 icon button labels。
- [x] 验证 reduced motion。
- [x] 验证 contrast/focus styling。

### M9.2 Performance Fixture

- [x] 创建 synthetic 1,000,000-character project fixture。
- [x] 测量 open project path。
- [x] 确认 cache rebuild 不阻塞 basic edit。
- [x] 记录 `docs/performance/m9-alpha-baseline.md`。

### M9.3 Packaging and Alpha Checklist

- [x] 创建 local alpha build artifact gate。
- [x] 运行 release candidate gates。
- [x] 验证 artifacts 不含 real secrets。
- [x] 更新 docs 和 `TECH_DEBT.md`。
- [x] 将真实 package artifact 产出拆到 M10/M11。

## 15. M10 - Beta Packaging Foundation

- [x] 用 Vite 构建 renderer production bundle。
- [x] 添加 electron-builder config。
- [x] 添加 `package:check` preflight。
- [x] 添加 `package:dir` 脚本。
- [x] 更新 alpha gate，使其检查 packaging foundation。
- [x] 记录当前环境限制：`package:dir` 在 Windows/Node 20.20.2 上 180 秒超时。

## 16. M11 - Package Artifact Stabilization

- [x] 定位 `package:dir` 超时根因：默认 GitHub Electron runtime 下载源不可达。
- [x] 添加 `.npmrc`，固定 `electron_mirror=https://npmmirror.com/mirrors/electron/`。
- [x] 将 `release/` 加入 `.gitignore`，避免提交 package artifacts。
- [x] 添加稳定 `package:dir` wrapper，每次输出到唯一目录 `release/package-dir-<timestamp>/win-unpacked`，避免 Windows 旧 artifact 文件锁影响复跑。
- [x] 添加 artifact secret scan，扫描 unpacked directory 和 `app.asar` 中的文本资源。
- [x] 生成真实 unpacked artifact，并写入 `release/latest-package-dir.txt`。
- [x] 验证 `npm run package:dir` 成功，artifact secret scan 通过。

后续 installer targets、icon、signing/notarization 和 release channel 进入下一版 roadmap，不属于 M11 完成条件。

## 17. Provider Roadmap

目标 Provider：

- OpenAI Compatible API
- OpenAI
- Anthropic
- Google Gemini
- OpenRouter
- DeepSeek
- 智谱
- 通义千问
- Ollama
- LM Studio
- vLLM

实现顺序：

1. OpenAI Compatible API
2. OpenAI
3. Anthropic
4. Google Gemini
5. Ollama
6. OpenRouter
7. DeepSeek
8. LM Studio
9. vLLM
10. 智谱
11. 通义千问

理由：OpenAI Compatible 可以较早解锁多个 Provider；Ollama 支持 local-first；更专用的中文 Provider 在 Adapter contract 稳定后再进入后续批次。

## 18. Risk Register

| Risk                               | Impact               | Mitigation                                                       | Owner Phase |
| ---------------------------------- | -------------------- | ---------------------------------------------------------------- | ----------- |
| Toolchain setup 消耗过多时间       | 延迟 vertical slice  | M1 保持最小化，非关键 tooling 延后                               | M1          |
| Schema/codegen drift               | runtime failure      | canonical schema + contract tests                                | M2          |
| Repository write bugs              | 数据丢失             | atomic write 和 temp project tests 优先                          | M3          |
| Editor choice wrong                | UI 返工              | 用 spike 和实现 slice 验证 CodeMirror 6                          | M5          |
| LLM provider variance              | Adapter 不稳定       | mock fixtures 和 provider-normalized errors                      | M6          |
| Workflow/Agent circular dependency | 违反架构             | boundary tests 和 import rules                                   | M7          |
| History grows too fast             | Git 管理体验变差     | 后续定义 archive/retention 策略                                  | M9+         |
| Security leakage                   | 用户信任受损         | secret scan、redaction tests、IPC allowlist                      | M8/M9       |
| Installer/signing 未配置           | 暂不能发布正式安装包 | 下一版 roadmap 增加 installer target、icon、signing/notarization | Future      |

## 19. 数据流

```text
Documents
-> Toolchain
-> Schemas
-> Repository
-> Application use cases
-> Desktop shell
-> Editor
-> LLM Adapter
-> Context / Workflow / Agent
-> Studio / Settings
-> Hardening
-> Packaging
```

## 20. 模块关系

- M1 创建 workspace 和 package boundaries。
- M2 创建所有后续里程碑使用的 schema。
- M3 创建 Repository source-of-truth access。
- M4 创建 UI shell 和 Application bridge。
- M5 建立核心写作循环。
- M6 建立 provider-neutral model calls。
- M7 建立结构化 AI workflow。
- M8 暴露配置编辑能力。
- M9 进入 alpha hardening。
- M10/M11 完成 beta packaging foundation 和 unpacked artifact stabilization。

## 21. 设计理由

Roadmap 优先保证数据完整性和工具门禁，再扩展 AI 能力。Novel Studio 可以接受早期 UI 有限，但不能接受 schema 不清、写入不安全、模型路径不可 mock、跨层依赖失控。第一个可靠 vertical slice 不是“AI 自动写章节”，而是“本地项目能打开、章节能安全编辑、history/recovery 能工作，然后 AI 建议在用户控制下应用”。

## 22. 优缺点

### 优点

- 降低早期架构漂移。
- 在 AI workflow 前先把数据安全变成可测试能力。
- 给 Phase 7 明确执行顺序。
- Provider 扩展被稳定 Adapter contract 保护。

### 缺点

- 可见产品功能出现得比快速 prototype 慢。
- tooling 和 schema 工作前置。
- 全量 Provider 支持按批次推进。
- 部分 UI 决策需要 spike 和实现验证。

## 23. 当前项目状态

- Phase 1-6 已完成。
- Phase 7 roadmap 当前定义的 M0-M11 已完成。
- M0-M11 已完成并本地提交。
- 当前没有未完成的既定步骤。
- 后续建议由用户确认：推送本地提交，或启动下一版 roadmap（installer/signing、CI、真实 e2e、Provider 扩展等）。
- 未经用户确认不得 push。
