# M24 工作流运行观测

版本：1.0 | 状态：M24 已采纳 | 阶段：Post-M18 产品化打磨

## 目标

M24 将 AI 写作工作流从“只看到生成结果”推进到“能看见这次运行为什么产生这个结果”。用户生成 AI 建议后，应能在 Inspector 中看到工作流名称、运行时间、上下文来源数量、模型 profile、token/cost 和步骤状态。

M24 不新增真实模型调用，不新增后台 telemetry，不把 AI 输出自动写入正文。所有运行观测数据都随当前建议结果返回并在 UI 展示，仍保持建议态和用户确认入口。

## 范围

M24 包含：

- `AgentHandoff` 增加脱敏的模型调用 metadata：provider、model name 和 LLM usage/cost。
- `AiWritingSuggestion` 增加 `observability`，汇总 workflow run id、workflow title、生成时间、Context trace 摘要、model profile 摘要、usage/cost 和步骤状态。
- Renderer `AiWritingWorkflowBridge` 将结构化观测数据格式化为 UI props，不显示 `secret://` 或明文密钥。
- `WorkspaceShell` 的 AI Workflow Inspector 显示“AI 工作流运行观测”区域，包含上下文、模型、Token、成本和步骤列表。
- 测试覆盖 Application、Agent Engine、Renderer Bridge 和 UI 渲染。

M24 不包含：

- 持久化工作流运行日志。
- 多次运行历史列表。
- 结构化 trace 文件导出。
- Workflow DAG 可视化画布。
- 失败重试策略执行器。
- 真实 provider endpoint 的 CI 验证。

## 交互设计

运行观测区放在现有 Inspector 的 AI 工作流面板内，避免打断写作主区。面板显示：

- 工作流标题与生成时间。
- 上下文摘要，例如 `1 source / 4 tokens`。
- 模型摘要，例如 `Default Model / example-model`。
- Token 与成本摘要。
- 步骤列表：构建上下文、运行写作 Agent、等待用户确认。

步骤状态使用中文短标签：待执行、运行中、已完成、待确认、失败。生成建议后，“等待用户确认”保持待确认状态，直到用户决定是否应用 AI 建议。

## 数据与安全边界

观测数据只来自现有运行链路：Workflow Engine 的 step 推进、Context Engine 的 trace、Agent Engine 的 handoff 和 LLM Adapter 的 usage/cost。Renderer 只接收 Application 返回的结构化结果，不直接读取日志、项目文件或模型配置文件。

模型 profile 只显示 provider、display name 和 model name。`apiKeyRef`、明文 API Key、请求正文中的敏感内容和底层 provider 错误细节不进入 UI。

## 验收标准

- Application 测试覆盖 `AiWritingSuggestion.observability` 的 workflow、context、model、usage 和 step 状态。
- Agent Engine 测试覆盖 handoff 返回模型 metadata 与 usage/cost。
- Renderer bridge 测试覆盖观测数据格式化为 UI 标签。
- UI 测试覆盖“AI 工作流运行观测”区域、模型、token/cost 和步骤列表。
- `format`、`typecheck`、`lint`、unit、contract、E2E、release、package、alpha、installer 和 artifact secret scan 均通过。
- 不 push；如需推送，必须先由用户确认。
