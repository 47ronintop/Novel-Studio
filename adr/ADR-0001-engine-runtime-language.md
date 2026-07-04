# ADR-0001 - Core Engine 运行时语言

Date: 2026-07-03

Status: Accepted

## 背景

Novel Studio 需要一个可维护、可测试、可嵌入桌面应用的 Core Engine。核心能力包括 Repository、Context Engine、Workflow Engine、Agent Engine、LLM Adapter、schema validation 和 Application use cases。

项目同时需要保持 local-first、安全文件写入、结构化 JSON 契约和 mock-first 测试策略。

## 决策

Core Engine 使用 TypeScript Strict。

Python 只允许出现在 plugin、外部工具或离线辅助脚本边界，不作为 v1 Core Engine 的主要运行时。

## 原因

- TypeScript 与 Electron/React 桌面栈天然一致。
- 可以共享 schema、DTO、Result/Error、Application contract 和测试工具。
- 更容易在 renderer、main、preload、packages 之间建立统一类型边界。
- Vitest、ESLint、Prettier 和 npm workspaces 能形成简单稳定的本地门禁。
- Provider adapter、Agent handoff、Context Bundle 等结构化 JSON 契约可以在同一语言中校验和测试。

## 影响

- `packages/*` 中的核心运行时代码使用 TypeScript Strict。
- 不允许在核心包中引入 Python runtime 作为必需依赖。
- 如果后续插件需要 Python，必须通过明确的外部进程、IPC 或 plugin boundary 接入。
- Python 输出必须回到 JSON schema 校验边界后才能进入 Core Engine。

## 备选方案

### Python Core Engine

优点：

- AI/LLM 生态丰富。
- 数据处理和原型开发速度快。

缺点：

- 与 Electron/React 桌面栈集成更复杂。
- 分发、虚拟环境、依赖隔离和跨平台打包成本更高。
- 类型契约需要跨语言同步，漂移风险更高。

### Mixed TypeScript + Python Core

优点：

- 可以同时利用桌面栈和 Python AI 生态。

缺点：

- v1 复杂度过高。
- 错误处理、测试、打包、版本兼容和安全边界都更难。
- local-first 桌面发行会更不稳定。

## 后续约束

- 新核心包必须使用 TypeScript Strict。
- JSON Schema 是跨边界 canonical contract。
- Python 插件或外部工具必须被视为不可信输入源，输出必须校验。
- 任何改变 Core Engine 运行时语言的决定必须新增 ADR。
