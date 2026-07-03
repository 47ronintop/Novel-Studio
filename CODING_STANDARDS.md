# CODING STANDARDS — Novel Studio
Version: 1.0 | Status: Draft for Review | Phase: 5 Development Standards

## 1. 文档目的

本文定义 Novel Studio v1 的工程规范、语言边界、代码组织、类型规则、Schema 规则、分层调用规则、错误处理、日志、安全编码、UI 实现约束、插件边界和提交规范。本文受 `PROJECT_CONSTITUTION.md`、`ARCHITECTURE.md`、`DATA_SCHEMA.md`、`UI_GUIDELINES.md` 和 `adr/ADR-0001-engine-runtime-language.md` 约束。

本文不编写业务代码，不拆分实现任务，不进入 Phase 6。

## 2. 技术栈标准

核心栈：

- TypeScript Strict：核心应用、Electron、Frontend、Application、Service、Agent Engine、Context Engine、Workflow Engine、LLM Adapter、Repository。
- React：Frontend UI。
- Tailwind CSS：设计 token 与 utility 样式。
- Electron：桌面运行时。
- JSON Schema：持久化文件和跨层契约的 canonical schema。
- Ajv：JSON Schema 运行时校验。
- Vitest：TypeScript 单元与集成测试。
- Playwright：关键 UI/E2E 测试。
- ESLint + Prettier：静态检查与格式化。

可选边界：

- Python 仅用于插件、本地 ML/向量化工具或离线脚本，必须完整 Type Hint，禁止 Any。
- Python 测试使用 Pytest。

## 3. Repository Layout

推荐代码仓库结构：

```text
novel-studio/
├── apps/
│   └── desktop/
│       ├── src/
│       │   ├── main/
│       │   ├── preload/
│       │   └── renderer/
│       └── tests/
├── packages/
│   ├── application/
│   ├── services/
│   ├── agent-engine/
│   ├── context-engine/
│   ├── workflow-engine/
│   ├── llm-adapter/
│   ├── repository/
│   ├── schemas/
│   ├── ui/
│   └── shared/
├── plugins/
├── adr/
├── docs/
└── fixtures/
```

规则：

- `packages/schemas` 存放 JSON Schema、generated types、schema fixtures。
- `packages/shared` 只放无业务方向的基础类型、错误结构、结果类型。
- `packages/ui` 只放可复用 UI primitive，不承载业务调用。
- `apps/desktop` 组合各 package，不把业务逻辑塞进 React component。

## 4. TypeScript Rules

必须启用：

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

禁止：

- `any`
- 隐式 `any`
- `// @ts-ignore`
- 绕过类型的双重断言，如 `as unknown as Target`
- 用 `Record<string, unknown>` 逃避建模，除非处于明确的外部输入边界
- 在业务层使用未校验的 JSON

允许：

- 外部输入边界使用 `unknown`，随后必须 schema validate 或类型收窄。
- 测试 fixture 可用受控 helper 构造对象，但不得绕过核心校验路径。

## 5. Schema and Type Strategy

JSON Schema 是持久化文件和跨层契约的 canonical source of truth。

规则：

- `project.json`、`settings.json`、章节 frontmatter、Prompt、Agent、Workflow、Version Record、Recovery Record、Context Bundle、Agent Handoff、LLM Request/Response、Unified Error 都必须有 JSON Schema。
- TypeScript 类型从 Schema 生成，或与 Schema 同源生成。
- 运行时读取项目文件后必须先校验，再进入 Service/Engine。
- Schema 变更必须带版本号和迁移策略。
- UI DTO 可以派生，但不得替代持久化 Schema。

禁止：

- TypeScript type 和 JSON Schema 手工长期双写。
- UI 直接消费未校验的 project file。
- 静默丢弃未知字段。

## 6. Layering Rules

调用方向必须遵循：

```text
Frontend
→ Application
→ Service
→ Agent Engine
→ Context Engine
→ Workflow Engine
→ LLM Adapter
→ Repository
→ Storage
```

规则：

- Frontend 不直接读写文件。
- Frontend 不直接调用 LLM Adapter。
- Service 不直接使用 `fs`。
- Agent 不直接写项目资产。
- Context Engine 不无差别读取全部正文。
- Workflow Engine 是状态机/计划器，不向上调用 Agent Engine。
- Repository 是项目文件读写、迁移、缓存失效和完整性检查边界。

横切关注点：

- logger、config、clock、id generator、feature flags 可通过依赖注入访问。
- 横切关注点不得承载业务逻辑。

## 7. Dependency Injection

要求：

- Engine、Service、Repository、Adapter 通过 constructor 或 factory 注入依赖。
- 不在模块顶层读取环境变量或文件系统。
- 不在业务函数中直接创建 provider client。
- 测试必须能注入 mock clock、mock id generator、mock repository、mock LLM provider。

## 8. Error Handling

所有可恢复错误使用 `Result` 或显式错误对象返回，不依赖抛出异常穿透业务层。

Unified Error 必须包含：

- stable code
- category
- message
- recoverability
- suggestedAction
- traceId
- redactedDetail

规则：

- Provider 原始错误只在 Adapter 内转换。
- UI 不展示 raw provider error。
- 日志记录 trace id，不记录明文密钥。
- 不吞异常；无法处理时转换为统一错误结构。

## 9. Logging

日志级别：

- `debug`
- `info`
- `warn`
- `error`

日志必须包含：

- timestamp
- level
- traceId
- module
- event
- redacted metadata

禁止：

- 明文 API Key。
- 完整用户正文默认写入日志。
- 未脱敏 provider request/response。

允许：

- 用户显式开启调试时记录结构化 trace，但仍必须脱敏。

## 10. File and Repository Standards

Repository 写入遵循：

- validate before write
- write temp file
- fsync where available
- atomic rename
- update cache after source write
- create version record when policy requires

规则：

- 任何写入失败不得留下半写入正式文件。
- cache 更新失败不得破坏 source data。
- `history/`、`memories/`、`recovery/` 不得被清缓存功能触碰。
- 回滚前必须创建 `before-rollback` 快照。
- AI 建议应用前必须创建 `before-ai-apply` 快照。

## 11. UI Implementation Standards

UI 技术倾向：

- Markdown editor：CodeMirror 6 优先评估。
- Component primitives：优先使用成熟 headless/unstyled primitives，再套本地 design tokens。
- Icons：使用 lucide 或等价一致图标库。
- Styling：Tailwind + CSS custom properties，颜色使用 OKLCH。

规则：

- React component 不承载业务流程。
- 长表单不优先使用 modal。
- 所有交互组件必须有 default、hover、focus、active、disabled、loading、error 状态。
- 图标按钮必须有 accessible label。
- UI 不直接展示明文密钥。
- AI 应用写入必须经过 diff/review。

禁止：

- 卡片套卡片。
- 营销式 hero 作为应用首屏。
- 装饰性 motion。
- gradient text、glassmorphism、粗侧边装饰。
- 32px+ 过度圆角卡片。

## 12. Editor Standard

默认倾向：CodeMirror 6。

理由：

- 更适合 Markdown/prose 编辑。
- 可控扩展系统。
- 比 Monaco 更轻，适合 Electron 中长期写作体验。
- 可支持 diff、lint、frontmatter 高亮、快捷键和自定义 gutter。

约束：

- 最终选型仍需在 Phase 6 任务规划中形成评估任务。
- 不允许编辑器层绕过 Application/Repository 直接保存文件。

## 13. Component Library Standard

默认倾向：

- 使用 headless primitives 管理可访问性交互。
- 本地实现视觉层和 tokens。
- 避免引入强视觉风格的整套 UI kit。

理由：

- 保持 UI_GUIDELINES 的深色 IDE 气质。
- 减少与 Tailwind/tokens 的冲突。
- 保证弹层、菜单、tooltip、dialog 等 a11y 行为可靠。

## 14. Shortcut Registry

快捷键必须集中注册。

要求：

- 每个 shortcut 有 command id。
- 每个 command 有 title、scope、riskLevel、defaultShortcut。
- 支持冲突检测。
- 支持用户重绑定。
- 危险命令不能只靠快捷键直接执行，必须确认。

## 15. LLM Adapter Standards

Provider 实现必须满足：

- 统一 request/response。
- 支持 streaming 与 non-streaming。
- 超时。
- 重试与指数退避。
- rate limit handling。
- 错误归一化。
- token usage 和 cost estimate。
- mock provider fixture。

禁止：

- Service/Agent/Workflow 直接调用 provider SDK。
- 在 Prompt 中硬编码 provider-specific 格式。
- 用真实模型输出作为 CI 强断言。

## 16. Prompt / Agent / Workflow Standards

Prompt：

- 必须来自 `prompts/`。
- 支持变量和条件片段。
- 保存前校验。
- 修改生成版本记录。

Agent：

- 单一职责。
- 声明 input/output schema。
- 输出必须校验。
- 不直接写项目资产。

Workflow：

- 状态机定义。
- 人工确认步骤显式建模。
- 失败策略显式建模。
- Agent handoff 使用 JSON。

## 17. Plugin Standards

v1 不实现完整插件市场，但代码必须保留插件边界。

插件必须声明：

- id
- version
- capabilities
- permissions
- data access scope
- compatible app version

规则：

- 插件不得默认访问全部项目数据。
- 插件不得绕过 Repository 写项目文件。
- Python 插件必须完整 type hint。
- 插件通信必须结构化 JSON + Schema 校验。

## 18. Security Coding Rules

- API Key 永不写入 `project.json` 或 `settings.json` 明文。
- 所有日志脱敏。
- 默认无遥测。
- 用户内容只在用户主动触发 AI 调用时发送至用户配置端点。
- 插件、模型供应商、外部工具视为不可信边界。
- IPC channel 必须白名单。
- Renderer 不直接获得 Node 文件系统权限。

## 19. Naming Rules

- 文件名：kebab-case。
- React component：PascalCase。
- Type/interface：PascalCase。
- Function/variable：camelCase。
- Constants：SCREAMING_SNAKE_CASE 仅用于真正常量。
- Schema id：dot notation + version，例如 `schema.agent.reviewer.output.v1`。
- Error code：SCREAMING_SNAKE_CASE，例如 `LLM_RATE_LIMITED`。

## 20. Comments and Documentation

规则：

- 公共 API、复杂状态机、迁移、错误归一化必须有简洁注释。
- 不写“把 A 赋给 B”这类空洞注释。
- 新模块必须在对应文档中有位置。
- 修改架构级行为必须更新文档或记录 TECH_DEBT。

## 21. Definition of Done

代码模块完成必须同时满足：

- 设计文档已确认。
- 代码实现完成。
- 单元测试和必要集成测试完成。
- 涉及 LLM 调用的路径使用 mock/fixture。
- 文档同步更新。
- TypeScript typecheck 通过。
- ESLint 通过。
- Prettier 格式通过。
- 无跨层业务调用。
- 无硬编码 Prompt/模型参数。
- 无明文密钥泄露。
- 技术债已记录。

## 22. Data Flow

开发规范数据流：

```text
External input / project file / LLM response
→ unknown
→ JSON Schema validation
→ typed DTO
→ Service / Engine logic
→ Repository / Adapter boundary
→ validated output
```

## 23. Module Relationship

- `schemas` 定义契约。
- `repository` 执行文件读写、迁移、缓存失效。
- `llm-adapter` 屏蔽 provider 差异。
- `workflow-engine` 定义步骤状态机。
- `context-engine` 组装可追踪上下文。
- `agent-engine` 校验 Agent 输入输出。
- `services` 组合业务用例。
- `application` 暴露 UI 用例。
- `ui` 提供无业务组件。
- `apps/desktop` 组合运行时。

## 24. Design Reasons

这些规范的核心目的不是形式统一，而是保护 Novel Studio 的长期可维护性。TypeScript Strict、JSON Schema、Repository/Adapter 边界、DI 和统一错误结构共同保证跨层数据可验证、AI 行为可审计、本地项目可恢复。

选择 CodeMirror 6 倾向，是因为 Novel Studio 的核心编辑对象是长篇 Markdown/prose，而不是代码文件。选择 headless primitives，是为了在不牺牲可访问性的前提下保留自有 IDE 视觉系统。

## 25. Pros and Cons

### Pros

- 类型、Schema、测试、错误和日志规则统一。
- 降低跨层调用和硬编码风险。
- 提前约束 LLM、插件、文件系统等高风险边界。
- UI 实现能继承 Phase 4 的设计系统。

### Cons

- 初始工程纪律成本高。
- Schema-first 会增加生成与校验流程。
- 禁止 `any` 会提高建模成本。
- 严格 Repository/Adapter 边界会增加接口数量。

## 26. Future Extensions

- 引入 schema codegen。
- 引入 dependency graph 检查，自动阻止跨层 import。
- 引入 plugin SDK。
- 引入 shortcut registry 可视化编辑。
- 引入 migration test harness。

## 27. Risk Analysis

| 风险 | 涉及条款 | 影响 | 缓解方案 |
|---|---|---|---|
| 规范过重拖慢早期开发 | P10 | Phase 7 启动慢 | Phase 6 按风险拆任务，先建立最小工具链 |
| JSON Schema 与 TS 类型漂移 | P8、第12节 | 运行时和编译时不一致 | Schema canonical + codegen 或同源生成 |
| 分层规则靠人工执行 | P8 | 跨层调用潜入代码 | ESLint boundaries 或 dependency graph 检查 |
| LLM mock 不充分 | 第14节 | CI 不可复现 | fixture-first 测试策略，真实模型只做离线评估 |
| UI primitive 选型不当 | 第11节 | a11y 或主题冲突 | Phase 6 设置组件 spike 任务 |

## 28. Phase 5 Changelog

- v1.0 - 2026-07-03：创建开发规范初稿。
- v1.0 - 2026-07-03：明确 TypeScript Strict、JSON Schema canonical、Ajv、Vitest、Playwright、ESLint、Prettier。
- v1.0 - 2026-07-03：明确 CodeMirror 6 编辑器倾向、headless component primitives、shortcut registry、Repository/Adapter 边界。

## 29. Progress Tracking

| 阶段 | 状态 | 本次产出 | 未决问题 | 下一步 |
|---|---|---|---|---|
| Phase 1 产品设计 | Complete | `PRODUCT_PRD.md v1.0` | v1 Provider 首批落地顺序仍需 ROADMAP 排序 | 已完成 |
| Phase 2 系统架构 | Complete | `ARCHITECTURE.md v1.0`、`adr/ADR-0001-engine-runtime-language.md` | Workflow/Agent 层级解释需在测试规范中固化 | 已完成 |
| Phase 3 数据结构设计 | Complete | `DATA_SCHEMA.md v1.0` | JSON Schema 文件尚未生成 | 已完成 |
| Phase 4 UI/UX 设计 | Complete | `UI_GUIDELINES.md v1.0` | 组件和编辑器选型需 Phase 6 spike 验证 | 已完成 |
| Phase 5 开发规范 | Draft for Review | `CODING_STANDARDS.md v1.0`、`TESTING.md v1.0` | 具体工具配置文件尚未生成；dependency boundary 工具待选 | 等待确认后进入 Phase 6 Task Planning |
| Phase 6 Task Planning | Not Started | 无 | 任务拆分、里程碑、风险缓冲 | Phase 5 确认后启动 |
| Phase 7 正式开发 | Not Started | 无 | 代码实现排期 | Phase 6 后启动 |
