# ADR-0001: Core Engine Runtime Language

Date: 2026-07-03

Status: Accepted for Phase 2 Review

## Context

`PROJECT_CONSTITUTION.md` 第6节要求 Frontend 及 Node/Electron 侧 Engine 层统一使用 TypeScript Strict，同时要求 Agent Engine / Context Engine / Workflow Engine 的最终实现语言在 Phase 2 通过 ADR 明确一次，不得模糊并存或事后擅自变更。

Novel Studio 需要长期维护以下核心能力：

- Project-based desktop application
- 本地文件系统读写
- Prompt / Agent / Workflow 可编辑与版本化
- 多模型 LLM Adapter
- Context budget 与检索
- Agent JSON handoff
- Electron desktop UI

同时，未来可能需要 Python 生态能力，例如向量化、嵌入模型、本地 ML、TTS、图像生成或知识库工具。

## Decision

Novel Studio v1 的核心 Engine 层统一使用 TypeScript Strict 实现。

适用范围：

- Frontend
- Electron main / preload / renderer integration
- Application Layer
- Service Layer
- Agent Engine
- Context Engine
- Workflow Engine
- LLM Adapter
- Repository
- Shared schemas and contracts

Python 不进入核心 Engine 层。Python 仅允许作为以下边界内能力：

- Plugin runtime
- External local tool
- Offline indexing or ML helper
- Optional vectorization / embedding provider

Python 代码必须：

- 启用完整 Type Hint
- 禁止 Any
- 通过 JSON Schema 或明确 IPC contract 与核心 TypeScript 层通信
- 通过 Plugin Adapter、External Tool Adapter 或 Repository/Adapter 边界访问项目数据

## Rationale

TypeScript Strict 更适合作为 v1 核心语言，原因如下：

- 与 Electron、React、Node 主进程天然集成。
- 可在 UI、Application、Service、Engine、Repository 之间共享类型定义。
- 更容易统一 Schema、测试、构建、打包和开发体验。
- 降低跨语言进程通信、错误处理、日志、部署和调试成本。
- 更符合 P8 分层与 P10 质量优先。

保留 Python 插件边界，是为了不排除 ML 生态，但避免核心系统被多语言运行时复杂度绑定。

## Alternatives Considered

### Alternative A: Core Engine 全部 TypeScript Strict

优点：

- 类型系统统一。
- Electron 集成直接。
- 打包和测试链路简单。
- 更容易执行 P8 的分层边界。

缺点：

- 本地 ML/向量化生态弱于 Python。
- 部分 AI 工具需要通过外部进程或插件接入。

结论：采用。

### Alternative B: Agent / Context / Workflow 使用 Python

优点：

- AI/ML 生态丰富。
- 便于接入部分 Python 原生工具链。

缺点：

- Electron/Node 与 Python IPC 复杂。
- Schema、错误、日志和测试链路分裂。
- 桌面打包复杂度高。
- 更容易形成核心层跨语言隐性耦合。

结论：不采用。

### Alternative C: TypeScript 与 Python 双核心并存

优点：

- 两边生态都可使用。

缺点：

- 违反“不得模糊并存”的 Phase 2 要求。
- 长期维护成本最高。
- 容易出现同一业务规则两套实现。

结论：不采用。

## Consequences

正面影响：

- 核心架构边界清晰。
- 类型、Schema、测试和打包路径统一。
- 更容易维护五年以上的工程底座。
- Python 能力仍可通过插件扩展。

负面影响：

- 需要为 Python 工具设计明确 Adapter/Plugin contract。
- 某些本地 AI 能力在 v1 可能需要延后或通过外部工具接入。
- 向量化和本地 ML 能力需要在后续架构中谨慎设计缓存与进程边界。

## Compliance Rules

- 任何核心 Engine 代码不得以 Python 实现。
- TypeScript 必须启用 strict。
- 禁止使用 `any` 逃避类型建模。
- Python 插件不得直接读写项目文件，必须经授权边界。
- 跨语言通信必须使用结构化 JSON 和 Schema 校验。
- 任何修改本 ADR 的提案必须走 RFC 或新 ADR。

## Follow-up

- Phase 3 在 `DATA_SCHEMA.md` 中定义跨层 Schema 和跨语言 contract。
- Phase 5 在 `CODING_STANDARDS.md` 中定义 TypeScript Strict、禁止 any、Python type hint 和 lint 规则。
- Plugin System 文档中定义 Python 插件运行边界、权限和 IPC contract。
