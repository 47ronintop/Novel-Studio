# WORKFLOW_ENGINE - Novel Studio

Version: 1.0 | Status: Accepted for M7.1 | Phase: 7 Formal Development

## 1. 目的

Workflow Engine 是 Novel Studio workflow 的确定性状态机。它负责解析 workflow definition、维护 run state、评估下一步可执行动作、强制 user confirmation gate，并向上层返回结构化 instructions。

Workflow Engine 不执行 Agent，不构建 context，不调用模型，不写文件，也不向上调用 Agent Engine。它只回答“下一步应该发生什么”。

## 2. 范围

M7.1 已实现：

- Workflow definition parsing 和结构校验。
- Workflow run initialization。
- `context`、`agent`、`confirmation`、`save` steps 的 next-step evaluation。
- Step completion 和到 `nextStepId` 的确定性 transition。
- Confirmation gate enforcement。
- Invalid definition、invalid run state、missing step、missing confirmation 的 Unified Error results。
- Package boundary test，防止依赖 Agent/Context/LLM/Repository。

M7.1 不包含：

- Branch expression evaluation。
- Retry/failure policy execution。
- Agent execution。
- Context bundle construction。
- Repository writes。
- UI workflow panels。

## 3. Package Boundary

实现位于 `packages/workflow-engine`。

允许依赖：

- `@novel-studio/shared`
- `@novel-studio/schemas`

禁止依赖：

- `@novel-studio/agent-engine`
- `@novel-studio/context-engine`
- `@novel-studio/llm-adapter`
- `@novel-studio/repository`
- `@novel-studio/application`
- `@novel-studio/ui`

Workflow Engine 必须保持纯状态机属性，便于测试和复现。

## 4. 输入与输出

输入：

- Workflow definition JSON。
- 当前 workflow run state。
- 可选 completion payload。
- 可选 confirmation decision。

输出：

- `NextWorkflowAction`
- 更新后的 run state。
- 或 normalized failure `Result`。

`NextWorkflowAction` 必须是结构化对象，常见类型包括：

- `build-context`
- `run-agent`
- `wait-for-confirmation`
- `save-result`
- `complete`

上层根据 action type 调用 Context Engine、Agent Engine、Repository 或 UI confirmation。

## 5. 状态机规则

- Workflow run 必须从 definition 中声明的 start step 初始化。
- 当前 step 不存在时返回 stable error，不猜测 fallback。
- Step completion 必须只推进到明确的 `nextStepId`。
- Confirmation step 未获得允许时，不得进入后续 mutating step。
- 已完成 workflow 再次推进时必须返回 complete action 或 invalid state error，不能重复执行。
- State transition 必须 deterministic，同一输入得到同一输出。

## 6. Confirmation Gate

Confirmation gate 用于保护高风险动作，例如应用 AI diff、保存自动生成内容或执行 rollback。

规则：

- Gate step 必须显式声明。
- 未确认时只能返回 `wait-for-confirmation`。
- 拒绝确认时 workflow 不得继续进入 mutating action。
- 确认记录应保留在 run state 中，供上层审计。

## 7. 错误策略

Workflow Engine 返回 Unified Error，不抛 provider 或 UI 错误。常见错误：

- `WORKFLOW_INVALID_DEFINITION`
- `WORKFLOW_INVALID_STATE`
- `WORKFLOW_STEP_NOT_FOUND`
- `WORKFLOW_CONFIRMATION_REQUIRED`
- `WORKFLOW_CONFIRMATION_REJECTED`
- `WORKFLOW_UNSUPPORTED_STEP`

错误 details 必须只包含可审计的结构化信息，不包含用户 secret。

## 8. 测试要求

M7.1 测试必须覆盖：

- 有效 workflow definition parsing。
- 非法 definition 失败。
- run initialization。
- next action evaluation。
- step completion。
- confirmation gate required。
- confirmation rejected。
- package boundary 不依赖上层包。

## 9. 验收状态

M7.1 已完成并通过本地门禁。后续如果加入 branching、retry 或 failure policy，必须先更新本文和 schema，再扩展状态机测试。
