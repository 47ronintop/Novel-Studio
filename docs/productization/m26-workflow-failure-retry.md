# M26 工作流失败诊断与重试策略

版本：1.0 | 状态：M26 开发中 | 阶段：Post-M18 产品化打磨

## 目标

M26 让 AI 写作工作流在失败时不再只是抛出错误，而是留下可追溯、可解释、可重试的本地记录。用户生成 AI 建议失败后，应能在 AI 工作流面板看到失败原因、可恢复性、建议操作、重试策略和最近失败历史，并能由用户主动点击重试。

M26 不引入自动后台重试执行器，不访问真实模型 endpoint，不上传 telemetry，不保存 prompt 原文、章节全文、provider 原始 payload、明文密钥或未脱敏错误详情。所有失败记录继续落在当前项目本地 `history/workflows/runs/`。

## 范围

M26 包含：

- `workflow-run-record` 扩展脱敏失败诊断字段：错误 code、message、recoverability、suggestedAction、retryable。
- `workflow-run-record` 增加可选 `retryPolicy` 摘要，用于 UI 展示当前策略。
- AI 写作工作流在模型/Agent 失败后写入 `failed` 运行历史。
- Renderer bridge 将失败结果转换为 UI props，而不是让 Promise 异常中断界面。
- AI Workflow 面板显示“失败诊断”和“重试策略”，并提供“重试 AI 工作流”按钮。
- 用户点击重试时复用当前指令重新触发生成，AI 输出仍保持建议态，应用前仍需用户确认。

M26 不包含：

- Workflow Engine 的通用 retry/failure policy 执行器。
- 多步骤 DAG 可视化回放。
- 自动循环重试或后台任务队列。
- provider raw error 展示。
- 失败时自动修改章节正文。

## 数据边界

失败记录仍使用 M25 的落点：

```text
history/
└── workflows/
    └── runs/
        └── <workflow-run-id>.json
```

失败记录允许保存：

- 稳定错误 code。
- 脱敏错误 message。
- recoverability。
- suggestedAction。
- retryable 布尔值。
- retry policy 摘要。
- 已完成/失败的步骤状态。
- context/model/usage/cost 的脱敏摘要。

失败记录禁止保存：

- 明文 API Key。
- `secret://` 对应的真实值。
- 完整 prompt。
- 完整章节正文。
- provider 原始 request/response。
- 未脱敏 stack trace 或原始异常对象。

## UI 设计

AI Workflow 面板在失败后显示：

- 当前状态：失败。
- “失败诊断”：原因、恢复性、建议操作。
- “重试策略”：手动重试、最大尝试次数、退避说明、可重试错误类别。
- “重试 AI 工作流”按钮。
- 工作流运行历史中最近失败记录的状态、模型、token/cost、失败步骤。

重试由用户主动触发。重试前不自动写入正文；重试成功后仍展示建议 diff，用户点击“应用”后才进入章节编辑器。

## 验收标准

- schema contract 覆盖包含 `error.recoverability`、`error.suggestedAction`、`error.retryable` 和 `retryPolicy` 的 valid fixture。
- Application 测试覆盖模型/Agent 失败后写入 `failed` workflow run record。
- Renderer bridge 测试覆盖失败结果转换为诊断 props，并能用同一指令重试成功。
- UI 测试覆盖“失败诊断”、“重试策略”和“重试 AI 工作流”按钮。
- 失败记录和 UI 不包含明文密钥、完整正文、prompt 原文或 provider raw payload。
- `format`、`typecheck`、`lint`、unit、contract、E2E、release、package、alpha、installer 和 artifact secret scan 均通过。
- 不 push；如需推送，必须先由用户确认。
