# PROJECT CONSTITUTION — Novel Studio

Version: 1.0 | Status: Active

## 1. 产品定位

它不是：Chat 界面 / ChatGPT 套壳 / 一键生成小说工具 / 绑定单一模型厂商的产品。

它是：Project-based 创作工作台，一个 **AI Story Operating System**，数据完全属于用户，模型完全可自由更换。类比对象：Cursor + Obsidian + Scrivener + Git + Multi-Agent System，服务对象从程序员变成小说创作者。

第一阶段聚焦长篇小说创作，但架构必须为未来扩展到剧本、漫画脚本、游戏剧情等场景预留空间，不得为单一场景把架构写死。

## 2. 核心哲学（10 条公理，后续文档引用时标注编号）

- P1 AI 是助手，不是作者，用户始终拥有最终决策权
- P2 Project First，而非 Chat First
- P3 一切皆可编辑（Prompt / Agent / Workflow / Context 策略 / 模型配置 / 模板），且关键可编辑资产（Prompt、Agent 配置）须保留版本历史、支持回滚
- P4 Model Agnostic，绝不绑定任何模型厂商
- P5 Local First，默认本地存储，云同步为未来可叠加能力，非 v1 必须项
- P6 可扩展、禁止硬编码，插件系统从第一天设计
- P7 数据可迁移，项目文件人类可读、可被 Git 管理
- P8 架构分层，禁止跨层业务调用，模型调用统一走 LLM Adapter；日志、配置读取、错误处理等横切关注点可通过统一基础设施/依赖注入访问，不视为跨层违规，但不得承载业务逻辑
- P9 Agent 之间的**最终交接（handoff）**只能通过结构化 JSON 通信，禁止拼字符串传上下文；面向用户 UI 的过程性展示（如打字机流式输出）允许流式 token，但流式内容不构成 Agent 间正式契约
- P10 质量优先于速度，冲突时优先保证架构质量

## 3. 支持的模型与适配层要求

必须支持：OpenAI Compatible API、OpenAI、Anthropic、Google Gemini、OpenRouter、DeepSeek、智谱、通义千问、Ollama、LM Studio、vLLM。

新增模型渠道只扩展 LLM Adapter 层，不触及核心架构。每个模型配置支持：Base URL、API Key、Model Name、Temperature、Max Tokens、Top P（预留）、Timeout、Frequency/Presence Penalty（预留）。

LLM Adapter 层必须统一处理（作为 LLM_ADAPTER.md 的强制设计项）：

- 超时与重试（含指数退避）、限流应对
- 跨厂商错误码归一化，向上层暴露统一错误结构
- Token 用量与调用成本估算，供 UI 展示与预算控制
- 流式与非流式响应的统一抽象接口

## 4. 项目文件结构

project/
├── project.json 项目元信息
├── settings.json 项目级配置（不得存放明文密钥，见第13节）
├── characters/ 人物档案
├── world/ 世界观设定
├── outline/ 大纲
├── timeline/ 时间线
├── chapters/ 正文章节（Markdown + frontmatter）
├── history/ 章节版本快照 / 自动保存历史（默认不可被“清缓存”类操作删除）
├── memories/ 长期记忆与语义摘要（人工/AI 生成，非纯派生数据，不可随意重建）
├── prompts/ 可编辑 Prompt 模板库（含版本历史）
├── agents/ Agent 配置（含版本历史）
├── workflow/ 工作流定义
├── plugins/ 插件配置（预留）
└── cache/ 纯派生数据（向量索引、检索缓存等），可安全清空并从原始数据重建

结构化数据用 JSON + Schema 校验，正文用 Markdown，可引入 SQLite 作为可重建索引层（仅存放于 cache/ 语义的数据，不作为唯一真实数据源）。

## 5. 数据完整性与版本历史（硬性要求）

- 自动保存：正文编辑必须有自动保存机制，保存间隔可配置，禁止仅依赖用户手动保存
- 崩溃恢复：应用异常退出后再次打开，须能恢复最近一次未保存的编辑内容
- 版本快照：章节内容变更须支持版本历史查看与回退，具体粒度（逐次保存 / 定时 / 手动打点）在 ARCHITECTURE.md 中细化，落地于 `history/`
- Prompt / Agent 配置修改须保留版本历史并支持回滚，呼应 P3
- `history/`、`memories/` 中的数据默认视为不可再生数据，禁止被任何“清理缓存”类功能误删；仅 `cache/` 允许被清空重建

## 6. 系统架构分层（禁止跨层业务调用）

Frontend (React + TS + Tailwind + Electron)
→ Application Layer
→ Service Layer
→ Agent Engine
→ Context Engine
→ Workflow Engine
→ LLM Adapter
→ Repository
→ Storage (Project Folder + JSON + SQLite)

规则：

- 任何一层不得跳跃调用下两层及以上模块
- 所有对外副作用（写文件、调模型、调插件）必须经过 Repository / Adapter
- 跨层数据传递必须经过 Schema 校验
- 技术栈边界：Frontend 及 Node/Electron 侧全部 Engine 层统一使用 TypeScript Strict；若引入 Python 编写的本地脚本/插件（如向量化、ML 相关工具），须启用全量 Type Hint，禁止 Any。**Agent Engine / Context Engine / Workflow Engine 的最终实现语言在 Phase 2 通过 ADR 明确一次，不得模糊并存或事后擅自变更**

## 7. Agent 架构规则

示例流水线（非最终定稿）：
Planner → Context Builder → Writer → Reviewer
→ Consistency Checker → Style Checker → Hook Generator → Save

规则：每个 Agent 单一职责，输入输出均为结构化 JSON（流式展示例外见 P9）；禁止通过拼接自然语言字符串在 Agent 间传递状态；Prompt 必须来自 Prompt System，禁止在代码中硬编码；Workflow Engine 统一编排执行顺序。

## 8. Context Engine 硬性约束

禁止将全部正文无差别塞入 Prompt。必须支持可配置的“上下文预算”，包括：Long-term Memory、Recent Memory、Semantic Retrieval（向量检索）、Character/World/Timeline/Foreshadowing 定向检索、Planner Goal 注入。上下文组装过程应可记录/回放，便于调试。

## 9. Prompt System

至少包含：System、Developer、World、Character、Outline、Memory、Planner、Writer、Reviewer、Runtime Prompt。模板文件存放于 prompts/，支持变量占位符与条件片段，用户可在 UI 编辑并校验，永远不能写死。

## 10. Plugin Architecture

预留方向：地图生成、人物关系图、封面插画、TTS 配音、翻译、发布平台对接、知识库、MCP 协议、第三方 Agent、Prompt & Agent 市场。设计需回答：插件如何声明能力、如何访问项目数据（沙箱边界与最小权限原则）、如何接入 Workflow、如何做版本兼容。

## 11. UI / UX 原则

参考对象：Cursor、VS Code、Linear、Raycast、Notion、Obsidian。要求：现代、极简、深色模式优先、高信息密度、响应迅速。必须支持：Dock Layout、Split View、多 Tab、可拖拽 Panel、Command Palette、键盘优先操作、多窗口。

## 12. 编码规范要点

TypeScript Strict + （可选 Python 全量 Type Hint，见第6节边界说明），禁止 Any。ESLint + Prettier，Pytest + Vitest。统一 Repository Pattern、依赖注入、Schema 校验、日志格式、错误处理、API 响应结构。禁止 God Object / God Component、硬编码 Prompt/模型参数、复制粘贴式重复代码。

## 13. 安全与隐私

- API Key 等敏感凭证必须加密存储于本地，禁止以明文写入 project.json / settings.json，日志中禁止输出明文密钥
- 默认不采集任何遥测/使用数据；未来若引入可选匿名统计，须默认关闭、显式 opt-in，并在 UI 中可随时查看与关闭
- 用户创作内容仅在用户主动触发 AI 调用时，发送至用户自行配置的模型服务端点，不得上传至任何未声明的第三方服务
- 插件访问项目数据须遵循第10节沙箱边界与最小权限原则

## 14. Definition of Done

任何模块完成必须同时满足：设计文档已确认、代码实现完成、测试完成（覆盖核心逻辑；涉及 LLM 调用的路径须使用 Mock/Fixture 保证可复现，真实模型输出仅用于离线基准评估，不作为 CI 强断言）、文档已同步更新、类型检查通过、Lint 通过、无跨层业务调用、无硬编码、无明显技术债（如有需记录于 TECH_DEBT.md）。缺一不可。

## 15. 范围声明：MVP 非目标

以下能力明确排除在 v1 之外，避免范围蔓延（不代表永久排除，未来可通过 RFC 重新评估）：

- 实时多人协作编辑
- 官方云端托管 / SaaS 版本（P5 本地优先为默认）
- 移动端 App（v1 聚焦桌面 Electron）
- 内置社交/发布分发平台（对接方式走 Plugin，见第10节）

## 16. 文档仓库与优先级

文档清单：PRODUCT_PRD.md、ARCHITECTURE.md、DATA_SCHEMA.md、UI_GUIDELINES.md、PROMPT_SYSTEM.md、CONTEXT_ENGINE.md、WORKFLOW_ENGINE.md、PLUGIN_SYSTEM.md、LLM_ADAPTER.md、CODING_STANDARDS.md、TESTING.md、SECURITY.md、ROADMAP.md、CHANGELOG.md、TECH_DEBT.md、INDEX.md

优先级裁决顺序：PROJECT_CONSTITUTION > PRODUCT_PRD > ARCHITECTURE > 其余技术文档

ADR 触发条件：架构级、不可逆、影响多模块的决策（含第6节技术栈边界的最终选型）。
RFC 触发条件：需讨论权衡的新特性提案，或修改本宪法本身，或调整第15节非目标范围。

## 17. Changelog

v1.0 - 初始版本
