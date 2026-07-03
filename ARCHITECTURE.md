# ARCHITECTURE — Novel Studio

Version: 1.0 | Status: Draft for Review | Phase: 2 System Architecture

## 1. 文档目的

本文定义 Novel Studio v1 的系统架构边界、分层规则、模块职责、运行时数据流、外部副作用路径、错误处理原则、测试边界与架构风险。本文受 `PROJECT_CONSTITUTION.md` 和 `PRODUCT_PRD.md` 约束。

本文不定义完整数据 Schema、UI 细节、Prompt 模板内容、具体任务拆分或业务代码实现。这些内容在后续 Phase 文档中完成。

## 2. 架构目标

- 落实 Project First，而非 Chat First（P2）。
- 保证本地项目文件夹为主要真实数据源（P5、P7）。
- 保证模型供应商可替换，所有模型调用统一经过 LLM Adapter（P4、P8）。
- 保证 Prompt、Agent、Workflow、Context 策略和模型配置可编辑、可校验、可版本化（P3）。
- 保证 Agent 正式交接使用结构化 JSON，不使用拼接自然语言作为内部契约（P9）。
- 保证系统分层明确，禁止跨层业务调用（P8）。

## 3. 技术栈边界

Phase 2 通过 ADR 明确：Novel Studio v1 核心应用、Node/Electron 主进程、Frontend、Application、Service、Agent Engine、Context Engine、Workflow Engine、LLM Adapter、Repository 均使用 TypeScript Strict 实现。

Python 只允许作为本地插件、离线工具或 ML/向量化辅助脚本存在，不进入核心 Engine 层。Python 边界必须通过 Plugin Adapter、External Tool Adapter 或 Repository/Adapter 管控，且必须启用完整 Type Hint，禁止 Any。

详见：`adr/ADR-0001-engine-runtime-language.md`。

## 4. 高层架构

Canonical layer order:

```text
Frontend (React + TypeScript + Tailwind + Electron Renderer)
→ Application Layer
→ Service Layer
→ Agent Engine
→ Context Engine
→ Workflow Engine
→ LLM Adapter
→ Repository
→ Storage (Project Folder + JSON + Markdown + SQLite cache)
```

规则：

- 上层只能调用下一层公开接口，不得跳过中间层访问更底层业务能力。
- 所有写文件、读项目文件、调用模型、调用插件的外部副作用必须经过 Repository 或 Adapter。
- 跨层传递的业务数据必须经过 Schema 校验。
- 基础设施能力，如日志、配置读取、错误归一化、遥测开关，可通过依赖注入提供，但不得承载业务逻辑。

## 5. 层职责

### 5.1 Frontend

负责用户界面、状态展示、输入交互、布局和命令入口。Frontend 不直接读写项目文件，不直接调用模型，不直接解析项目真实数据结构。

主要职责：

- Dock Layout、Split View、多 Tab、Command Palette。
- 章节编辑器、资产浏览器、AI 结果展示。
- 保存状态、版本入口、错误提示。
- 调用 Application Layer 暴露的用例接口。

### 5.2 Application Layer

负责把 UI 命令转换为应用用例。它不承载深层业务规则，不直接访问 Storage。

示例用例：

- CreateProject
- OpenProject
- SaveChapterDraft
- RunWorkflow
- EditPromptTemplate
- ConfigureModelProfile
- RestoreChapterVersion

### 5.3 Service Layer

负责产品级业务协调，组合多个下层能力完成一个用例。Service Layer 必须保持薄而明确，不得成为 God Object。

示例服务：

- ProjectService
- ChapterService
- StoryAssetService
- AIWorkflowService
- ConfigurationService
- HistoryService

### 5.4 Agent Engine

负责 Agent 的生命周期、输入输出契约、Agent Registry、Agent 结果校验和 Agent 级错误处理。Agent Engine 不直接拼接 Prompt，不直接调用模型，不直接写文件。

Agent Engine 接收来自 Service Layer 的执行请求，并通过下层 Context Engine 与 Workflow Engine 完成上下文准备和执行计划推进。

### 5.5 Context Engine

负责上下文预算、上下文候选来源、检索策略、上下文组装记录和可回放信息。Context Engine 不无差别读取全文，不直接写业务资产。

输入包括：

- 当前用户目标
- Workflow Step 需求
- Agent 输入 Schema
- 上下文预算
- 项目资产引用

输出包括：

- Context Bundle
- Context Trace
- Budget Report
- Retrieval References

### 5.6 Workflow Engine

负责 Workflow 定义解析、Workflow 状态机、步骤顺序、失败策略、重试策略、人工确认点和结构化 handoff 合约。

为解决宪法第6节层级顺序与第7节“Workflow Engine 统一编排执行顺序”的张力，v1 采用如下解释：

- Workflow Engine 负责确定执行顺序和状态推进。
- Agent Engine 负责实际 Agent 实例注册、调用和结果校验。
- Workflow Engine 不向上调用 Agent Engine；它只返回下一步执行指令、输入约束和状态变更。
- Agent Engine 根据 Workflow Engine 的指令执行对应 Agent。

这避免循环依赖，同时保留 Workflow 对执行顺序的统一控制。

### 5.7 LLM Adapter

负责所有模型供应商调用。上层不得直接调用 OpenAI、Anthropic、Gemini、Ollama 或任何兼容 API。

必须统一处理：

- 流式与非流式响应
- 超时、重试、指数退避
- 限流
- 错误码归一化
- token 用量和成本估算
- 模型能力声明

### 5.8 Repository

负责项目文件、JSON、Markdown、历史快照、记忆、Prompt、Agent、Workflow 和 cache 索引的持久化访问。

Repository 是项目真实数据访问边界。任何业务层不得直接调用文件系统 API 写项目资产。

### 5.9 Storage

Storage 包括：

- 项目文件夹
- JSON 结构化资产
- Markdown 章节正文
- `history/` 不可再生历史
- `memories/` 人工或 AI 辅助确认记忆
- `cache/` 可重建索引
- SQLite cache，仅作为可重建索引层

SQLite 不得成为唯一真实数据源。

## 6. 运行时数据流

### 6.1 打开项目

```text
Frontend
→ Application: OpenProject
→ Service: ProjectService
→ Repository: ProjectRepository
→ Storage: project.json / settings.json / directory scan
→ Repository: Schema validation
→ Service: Project health summary
→ Application
→ Frontend
```

错误处理：

- 项目结构缺失：返回可修复诊断，不自动删除用户数据。
- Schema 版本不匹配：进入迁移检查，不直接写入。
- cache 损坏：提示可重建，只清理 `cache/`。

### 6.2 编辑与保存章节

```text
Frontend Editor
→ Application: SaveChapterDraft
→ Service: ChapterService
→ Repository: ChapterRepository / RecoveryRepository / HistoryRepository
→ Storage: chapters/ + history/
→ Service: Save result
→ Frontend: saved / recovery available / snapshot created
```

保存要求：

- 自动保存与手动保存都必须可追踪。
- 恢复数据与历史快照不得进入 `cache/`。
- 快照策略在 `DATA_SCHEMA.md` 中细化。

### 6.3 运行 AI Workflow

```text
Frontend
→ Application: RunWorkflow
→ Service: AIWorkflowService
→ Agent Engine: create execution session
→ Context Engine: build context bundle
→ Workflow Engine: evaluate next step and handoff contract
→ LLM Adapter: call configured model
→ Workflow Engine: normalize step result
→ Context Engine: attach trace and budget report
→ Agent Engine: validate agent output JSON
→ Service: return suggestion-state result
→ Frontend: show result and require user confirmation
```

注意：

- AI 输出默认是建议态。
- 正式写入项目资产必须经过用户确认。
- Agent 间正式交接必须是结构化 JSON。
- UI 可以显示流式 token，但流式 token 不构成 Agent handoff 契约。

### 6.4 编辑 Prompt / Agent / Workflow

```text
Frontend
→ Application: EditConfigAsset
→ Service: ConfigurationService
→ Repository: PromptRepository / AgentRepository / WorkflowRepository
→ Storage: prompts/ agents/ workflow/ + version history
→ Service: validation and version result
→ Frontend
```

要求：

- 修改前后均保留版本。
- 保存前必须 Schema 校验。
- 无效配置不得进入 Active 状态。

## 7. 模块关系

```text
Workspace
  uses Application Layer

Application Layer
  uses Service Layer

Service Layer
  uses Agent Engine
  uses Repository-facing service interfaces through allowed services only

Agent Engine
  uses Context Engine

Context Engine
  uses Workflow Engine

Workflow Engine
  uses LLM Adapter

LLM Adapter
  uses Provider clients
  uses Repository only for model profile references through approved ports

Repository
  uses Storage
```

Phase 2 风险提示：严格按宪法第6节的线性层级执行会让 Workflow Engine 位于 Agent Engine 之下，因此 v1 必须把 Workflow Engine 设计为确定性状态机/计划器，而不是直接调用 Agent 的运行时容器。否则会产生循环依赖或跨层调用。

## 8. 目录结构

代码仓库建议结构：

```text
novel-studio/
├── PROJECT_CONSTITUTION.md
├── PRODUCT_PRD.md
├── ARCHITECTURE.md
├── DATA_SCHEMA.md
├── UI_GUIDELINES.md
├── PROMPT_SYSTEM.md
├── CONTEXT_ENGINE.md
├── WORKFLOW_ENGINE.md
├── PLUGIN_SYSTEM.md
├── LLM_ADAPTER.md
├── CODING_STANDARDS.md
├── TESTING.md
├── SECURITY.md
├── ROADMAP.md
├── CHANGELOG.md
├── TECH_DEBT.md
├── INDEX.md
├── adr/
│   └── ADR-0001-engine-runtime-language.md
├── apps/
│   └── desktop/
├── packages/
│   ├── application/
│   ├── services/
│   ├── agent-engine/
│   ├── context-engine/
│   ├── workflow-engine/
│   ├── llm-adapter/
│   ├── repository/
│   ├── schemas/
│   └── shared/
└── plugins/
```

项目文件夹建议结构仍以宪法第4节为准：

```text
project/
├── project.json
├── settings.json
├── characters/
├── world/
├── outline/
├── timeline/
├── chapters/
├── history/
├── memories/
├── prompts/
├── agents/
├── workflow/
├── plugins/
└── cache/
```

## 9. Schema 与契约

Phase 2 只定义原则，具体 Schema 在 Phase 3 完成。

必须存在的契约类别：

- Project metadata schema
- Chapter frontmatter schema
- Story asset schema
- Prompt template schema
- Agent config schema
- Workflow definition schema
- Context bundle schema
- Agent input/output schema
- LLM request/response schema
- Unified error schema
- Version record schema

契约规则：

- 跨层数据必须经过 Schema 校验。
- Agent handoff 必须可序列化为 JSON。
- Schema 变更必须有版本号和迁移策略。
- UI 展示模型可派生，但不得替代业务契约。

## 10. 错误处理

错误分为：

- UserError：用户输入、配置、权限、项目结构问题。
- ValidationError：Schema 或契约不通过。
- StorageError：文件读写、锁、损坏、权限问题。
- ModelProviderError：模型供应商原始错误。
- LLMAdapterError：归一化后的模型调用错误。
- WorkflowError：步骤失败、重试耗尽、人工确认缺失。
- AgentError：Agent 输出无效或无法修复。
- PluginError：插件能力、权限或运行失败。

所有错误向 UI 暴露时必须包含：

- stable code
- human-readable message
- recoverability
- suggested action
- trace id
- redacted detail

## 11. 安全边界

- API Key 不进入 `project.json` 或 `settings.json` 明文字段。
- 日志必须脱敏。
- 默认无遥测。
- 插件访问项目数据必须声明能力和权限。
- AI 调用仅在用户主动触发时发送用户内容。
- 插件、模型供应商、外部工具都视为不可信边界。

## 12. 测试策略

Phase 2 只定义测试边界，具体工具链在 `TESTING.md` 完成。

必须覆盖：

- Schema validation
- Repository 文件读写与恢复
- Workflow 状态机
- Agent JSON 输出校验
- Context budget enforcement
- LLM Adapter mock provider
- 错误归一化
- Prompt/Agent/Workflow 版本回滚

涉及真实模型的输出不得作为 CI 强断言，只允许离线基准评估。

## 13. 设计原因

TypeScript Strict 作为核心实现语言，可以让 Electron、Frontend、Node 主进程、Schema、测试和核心 Engine 共享类型系统，降低跨语言边界成本。Python 保留在插件和工具层，避免把 ML 生态优势排除在外，同时防止核心架构被多运行时复杂度拖垮。

采用 Repository 和 Adapter 作为副作用边界，是为了保证本地项目、人类可读文件、模型调用、插件调用都可审计、可替换、可测试。采用结构化 Agent handoff，是为了让多 Agent 系统可调试、可回放、可版本化。

## 14. 优缺点

### 优点

- 核心运行时统一，类型、测试、打包和调试链路更简单。
- 模型供应商、插件和本地存储边界清晰。
- 保留 Python/ML 扩展能力，但不污染核心 Engine。
- Workflow、Context、Agent 的职责拆分便于审计 AI 行为。

### 缺点

- TypeScript 生态下的本地 ML 能力弱于 Python，需要通过插件或外部工具补足。
- 严格分层会增加接口数量和早期设计成本。
- Workflow Engine 位于 Agent Engine 下方，需要谨慎设计，避免概念误读。
- 本地优先和版本历史会增加文件事务、锁和恢复设计复杂度。

## 15. 未来扩展方案

- 云同步：在 Repository 之上增加 Sync Adapter，不改变本地 source of truth。
- 多人协作：通过 RFC 评估 Git-based 协作、CRDT 或锁定模型。
- 插件市场：在 Plugin System 文档中定义 manifest、能力声明、权限和版本兼容。
- Python 能力：通过插件协议扩展向量化、嵌入模型、TTS、图像生成或知识库工具。
- 多端：未来可抽离 Application/Service/Engine 包，但 v1 不承诺移动端。

## 16. 风险分析

| 风险                                 | 涉及条款         | 影响                       | 缓解方案                                                               |
| ------------------------------------ | ---------------- | -------------------------- | ---------------------------------------------------------------------- |
| Workflow 与 Agent 层级关系误读       | 第6节、第7节、P8 | 可能形成循环依赖或跨层调用 | Workflow Engine 设计为状态机/计划器，Agent Engine 负责 Agent 实例执行  |
| 多 Provider 一次性实现过多           | 第3节、P4        | 测试矩阵过大               | Adapter contract 覆盖全部供应商，首批实现顺序在 ROADMAP 明确           |
| 本地文件写入不具备事务性             | 第5节、P5、P7    | 崩溃时可能损坏数据         | Repository 统一实现原子写入、备份、恢复和锁策略                        |
| Prompt/Agent/Workflow 版本化范围过大 | P3               | 初期实现复杂               | Phase 3 统一 VersionRecord schema，Phase 6 分批落地                    |
| 插件能力过早膨胀                     | P6、第10节       | v1 偏离核心写作            | v1 只实现插件架构边界和 manifest 设计，不实现市场                      |
| Python 插件破坏核心类型边界          | 第6节、第12节    | 核心不可维护               | Python 只允许通过 Adapter/Plugin 进入，并强制 type hint 与 JSON schema |

## 17. Phase 2 Changelog

- v1.0 - 2026-07-03：创建系统架构初稿。
- v1.0 - 2026-07-03：通过 ADR-0001 明确核心 Engine 语言为 TypeScript Strict，Python 限定为插件/外部工具层。
- v1.0 - 2026-07-03：定义分层职责、数据流、模块关系、错误处理、安全边界和测试边界。

## 18. Progress Tracking

| 阶段                  | 状态             | 本次产出                                                          | 未决问题                                                  | 下一步                              |
| --------------------- | ---------------- | ----------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------- |
| Phase 1 产品设计      | Complete         | `PRODUCT_PRD.md v1.0`                                             | v1 Provider 首批落地顺序仍需 ROADMAP 排序                 | 已进入 Phase 2                      |
| Phase 2 系统架构      | Draft for Review | `ARCHITECTURE.md v1.0`、`adr/ADR-0001-engine-runtime-language.md` | Workflow/Agent 层级解释需用户确认；Git 远端为空仓库但可达 | 等待确认后进入 Phase 3 数据结构设计 |
| Phase 3 数据结构设计  | Not Started      | 无                                                                | Schema 粒度、版本历史格式、文件事务策略                   | Phase 2 确认后启动                  |
| Phase 4 UI/UX 设计    | Not Started      | 无                                                                | 默认布局、Command Palette、编辑器体验                     | Phase 3 后启动                      |
| Phase 5 开发规范      | Not Started      | 无                                                                | Monorepo 工具链、lint/type/test 规则                      | Phase 4 后启动                      |
| Phase 6 Task Planning | Not Started      | 无                                                                | 实现批次、里程碑、风险缓冲                                | Phase 5 后启动                      |
| Phase 7 正式开发      | Not Started      | 无                                                                | 代码实现排期                                              | Phase 6 后启动                      |
