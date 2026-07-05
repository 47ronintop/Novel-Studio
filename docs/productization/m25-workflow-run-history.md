# M25 工作流运行历史

版本：1.0 | 状态：M25 已采纳 | 阶段：Post-M18 产品化打磨

## 目标

M25 将 M24 的“当前运行观测”扩展为“最近运行可追溯”。用户在 AI 写作面板中生成建议后，应能看到最近的工作流运行列表，并打开单次运行摘要，查看时间、状态、上下文来源数量、模型 profile、token/cost、步骤状态和失败摘要。

M25 不新增真实模型调用，不新增 telemetry，不上传运行记录，不把 AI 输出自动写入正文。历史记录只落在当前项目本地 `history/` 目录，仍遵守 AI 输出建议态和用户确认写入规则。

## 范围

M25 包含：

- 新增 `workflow-run-record` schema，约束运行历史 JSON 的结构。
- Repository 在 `history/workflows/runs/<workflow-run-id>.json` 写入和读取脱敏运行记录。
- AI 写作建议生成成功后，Application 将 M24 observability 转换为运行历史记录。
- Desktop IPC/preload 增加列出和读取工作流运行历史的白名单通道。
- AI Workflow 面板显示“工作流运行历史”，展示最近运行和选中运行详情。
- 测试覆盖 schema、repository、application、IPC、renderer bridge 和 UI。

M25 不包含：

- Workflow DAG 可视化画布。
- 多 Agent 分支 trace 回放。
- 自动失败重试执行器。
- 远程同步、云端审计或遥测。
- 原始 prompt、完整章节正文或明文密钥的持久化。

## 数据落点

运行历史写入：

```text
history/
└── workflows/
    └── runs/
        └── <workflow-run-id>.json
```

该目录属于不可随意清理的本地历史，不进入 `cache/`。清理 cache 不得删除 workflow run history。

## 记录内容

每条记录包含：

- `workflowRunId`
- `workflowId`
- `workflowTitle`
- `status`：`pending-confirmation`、`applied`、`failed`
- `startedAt`
- `updatedAt`
- `context`：来源数量、token 估算、选择原因
- `model`：profile id、display name、provider、model name
- `usage`：token 和 cost 摘要
- `steps`：步骤 id、中文标签、类型、状态
- `error`：失败时的稳定错误码和脱敏说明

记录不得包含：

- 明文 API Key。
- `secret://` 的真实值。
- 完整用户正文。
- provider 原始请求/响应。
- 未脱敏底层错误详情。

## UI 设计

AI Workflow 面板增加“工作流运行历史”区块，放在当前建议和运行观测之后。默认展示最近运行列表：

- 工作流标题。
- 运行时间。
- 状态。
- 模型摘要。
- token/cost 摘要。

用户选中一条记录后，在同一区块展示该记录的步骤状态和上下文摘要。空历史显示中文空状态，不阻断当前写作。

## 验收标准

- schema contract 覆盖 valid/invalid `workflow-run-record` fixture。
- repository 测试覆盖写入、列表排序、读取详情、空历史和无效记录拒绝。
- Application 测试覆盖 AI suggestion 生成后写入运行历史。
- IPC 测试覆盖 history list/read channel 白名单和返回结构。
- UI 测试覆盖“工作流运行历史”、最近运行、状态、模型、token/cost 和步骤详情。
- `format`、`typecheck`、`lint`、unit、contract、E2E、release、package、alpha、installer 和 artifact secret scan 均通过。
- 不 push；如需推送，必须先由用户确认。
