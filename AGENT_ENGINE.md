# AGENT_ENGINE - Novel Studio

Version: 1.0 | Status: Accepted for M7.3 | Phase: 7 Formal Development

## 1. 目的

Agent Engine 执行单个 Agent step：校验输入、调用 LLM Adapter、解析并校验结构化输出，最终生成 Agent Handoff JSON。它是业务 Agent 行为的边界，但不是 workflow 状态机，也不是 context 选择器。

Agent Engine 不直接读写项目文件，不直接访问 UI，不直接调用 provider SDK，不推进 workflow state。

## 2. 范围

M7.3 已实现：

- 创建 `AGENT_ENGINE.md` 设计契约。
- 校验 agent input。
- 通过注入的 LLM Adapter 调用模型。
- 提取 structured output。
- 校验 output schema。
- 生成 Agent Handoff JSON。
- malformed JSON fixture 安全失败。
- Package boundary test，防止向下越界访问 Repository 或向旁路直接访问 UI/provider。

M7.3 不包含：

- Prompt authoring UI。
- Prompt variable editor。
- Model provider implementation。
- Context selection。
- Workflow orchestration。
- Repository write/apply。
- Multi-agent planning。

## 3. Package Boundary

实现位于 `packages/agent-engine`。

允许依赖：

- `@novel-studio/shared`
- `@novel-studio/schemas`
- `@novel-studio/llm-adapter`

禁止依赖：

- `@novel-studio/repository`
- `@novel-studio/application`
- `@novel-studio/ui`
- Electron main/preload/renderer
- Provider SDK

Agent Engine 只能通过 LLM Adapter 发起模型调用。

## 4. 输入

Agent execution input 必须是结构化 JSON，通常包含：

- `agentConfig`
- `contextBundle`
- `task`
- `llmRequestOptions`
- `outputSchema`
- `traceMetadata`

输入必须在执行前校验。非法输入返回 Unified Error，不调用模型。

## 5. 输出

Agent Engine 输出 Agent Handoff JSON，必须包含：

- `schemaVersion`
- `agentId`
- `runId`
- `status`
- `output`
- `usage`
- `cost`
- `trace`
- `errors`

Handoff 是上层 Workflow/Application 可审计的结构化结果，不允许只返回自然语言文本。

## 6. Structured Output Policy

- 如果 Agent 声明了 `outputSchema`，模型输出必须校验通过后才能作为 successful handoff。
- Malformed JSON 必须返回 stable failure。
- 缺失 required fields 必须返回 validation failure。
- 不允许 Agent Engine 自动写入项目文件来“修复”输出。
- 后续如添加 output repair，必须先在文档、schema 和测试中明确。

## 7. Error Policy

常见错误：

- `AGENT_INVALID_INPUT`
- `AGENT_LLM_FAILED`
- `AGENT_MALFORMED_OUTPUT`
- `AGENT_OUTPUT_VALIDATION_FAILED`
- `AGENT_HANDOFF_BUILD_FAILED`

错误必须是 Unified Error shape，并保留 run/agent trace；不得泄漏 secret。

## 8. Data Flow

```text
Workflow Engine
-> requests run-agent action
Application/Service
-> passes Context Bundle and Agent Config
Agent Engine
-> validates input
-> calls LLM Adapter
-> validates structured output
-> returns Agent Handoff JSON
Workflow/Application
-> decides confirmation/apply/save
```

Agent Engine 不决定是否把结果写入项目；写入必须由上层经过 confirmation gate 后调用 Repository。

## 9. 测试要求

M7.3 测试必须覆盖：

- valid input 产生 successful handoff。
- invalid input 不调用 LLM Adapter。
- LLM Adapter failure 转换为 agent failure。
- malformed JSON 安全失败。
- output schema validation failure。
- usage/cost trace 透传。
- package boundary 不依赖 Repository/UI/provider SDK。

## 10. 验收状态

M7.3 已完成并通过本地门禁。后续扩展 multi-agent、repair、tool calling 或 apply flow 时，必须保持 Agent Engine 只生成结构化 handoff，不直接 mutation project files。
