# CONTEXT_ENGINE - Novel Studio

Version: 1.0 | Status: Accepted for M7.2 | Phase: 7 Formal Development

## 1. 目的

Context Engine 为 AI workflow steps 构建可审计的 Context Bundle。它负责从显式候选项中选择有界、带 source reference 的项目上下文，执行 token budget，记录被排除项及原因，并按 confidence 过滤 memories。

Context Engine 不调用模型，不执行 Agent，不推进 workflow state，不写项目文件，也不盲目把整本小说塞进 prompt。

## 2. 范围

M7.2 已实现：

- 从 chapter、memory、character、world、timeline、goal candidates 构建 Context Bundle。
- 确定性 token budget enforcement。
- 对 skipped 或 trimmed out 的 candidates 记录 exclusion trace。
- 默认过滤 unconfirmed memories。
- 为每个 included item 记录 source reference trace。
- 通过 explicit candidate refs 和 bulk chapter policy 防止 full-novel blind stuffing。
- Package boundary test，防止依赖 Agent/Workflow/LLM/Repository。

M7.2 不包含：

- Semantic vector retrieval。
- Cache 或 SQLite index reads。
- Prompt rendering。
- Agent execution。
- Workflow state transition。
- Repository project scanning。
- UI context trace panel。

## 3. Package Boundary

实现位于 `packages/context-engine`。

允许依赖：

- `@novel-studio/shared`
- `@novel-studio/schemas`

禁止依赖：

- `@novel-studio/agent-engine`
- `@novel-studio/workflow-engine`
- `@novel-studio/llm-adapter`
- `@novel-studio/repository`
- `@novel-studio/application`
- `@novel-studio/ui`

Context Engine 接收上层传入的 candidates，不主动扫描项目目录。

## 4. Context Bundle

Context Bundle 是结构化 JSON，必须包含：

- `schemaVersion`
- `goal`
- `budget`
- `items`
- `exclusions`
- `sourceRefs`
- `trace`

每个 included item 必须有稳定 id、type、content、token estimate 和 source reference。Bundle 必须能解释为什么某个 item 被包含、被排除或被截断。

## 5. Token Budget

Budget enforcement 必须 deterministic：

- 候选项按上层提供的 priority/order 处理。
- 超出预算的项必须被排除或截断，并写入 exclusion trace。
- 剩余预算不能为负。
- 输出中必须记录 requested budget、used budget、remaining budget。
- 不允许为了“更完整”而绕过 budget。

Token 估算可以是 deterministic approximation，但必须在 trace 中标明估算策略。

## 6. Memory Confidence Filtering

默认规则：

- `confirmed` memory 可以进入候选选择。
- `unconfirmed` memory 默认排除。
- `rejected` memory 必须排除。
- 若后续允许上层覆盖 confidence policy，必须在 bundle trace 中记录 override reason。

过滤结果必须写入 `exclusions`，不能静默丢弃。

## 7. Full-Novel Blind Stuffing Guard

Context Engine 必须防止未经筛选的全文灌入：

- 上层必须传入 explicit candidates。
- Bulk chapter candidate 必须受 policy 限制。
- 超出 bulk policy 的 chapter candidate 返回 failure 或 exclusion，不得自动塞入。
- Bundle trace 必须能证明上下文来源和选择过程。

## 8. Source Reference Trace

每个 included item 必须记录 source reference，例如：

- chapter id/path/range
- memory id
- character id
- world item id
- timeline event id

Source reference 不等同于文件系统访问。UI 或 Agent 只能读取 trace，不能据此绕过 Application/Repository 边界直接访问文件。

## 9. 错误策略

常见错误：

- `CONTEXT_INVALID_INPUT`
- `CONTEXT_BUDGET_EXCEEDED`
- `CONTEXT_FULL_NOVEL_STUFFING_BLOCKED`
- `CONTEXT_INVALID_MEMORY_CONFIDENCE`
- `CONTEXT_SOURCE_REFERENCE_MISSING`

错误必须使用 Unified Error shape，并包含可审计 details。

## 10. 测试要求

M7.2 测试必须覆盖：

- 构建包含 chapter、memory、character、world、timeline、goal 的 bundle。
- token budget enforcement。
- exclusion trace。
- unconfirmed memory filtering。
- source reference trace。
- full-novel blind stuffing guard。
- package boundary 不依赖上层包。

## 11. 验收状态

M7.2 已完成并通过本地门禁。后续如果加入 retrieval、ranking、cache index 或 UI trace panel，必须先更新本文和 schema。
