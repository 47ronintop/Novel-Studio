# LLM_ADAPTER - Novel Studio

Version: 1.0 | Status: Accepted for M6 | Phase: 7 Formal Development

## 1. 目的

本文定义 Novel Studio v1 的 LLM Adapter 契约。LLM Adapter 是核心运行时中唯一允许发起模型调用的边界；上层不得直接调用 provider SDK、直接请求 provider endpoint，也不得直接解析 provider-specific errors。

Adapter 必须支持 provider-neutral request/response、mock-first testing、streaming 与 non-streaming 调用、normalized errors、timeout/retry/rate-limit 处理、usage/cost reporting 和 secret redaction。

## 2. 范围

M6 已实现：

- Provider-neutral TypeScript interfaces：LLM request、response、stream event、model profile、retry policy、usage。
- 测试和 CI 使用的 deterministic mock provider。
- OpenAI-compatible provider shape，并用 fixture 覆盖映射逻辑。
- Provider failures、timeout、retry exhaustion、rate limits、malformed provider payloads 的错误规范化。
- Usage/cost reporting，状态支持 `missing`、`estimated`、`actual`。
- Streaming errors 以 `Result` 形式返回，不直接抛出 provider failure。

M6 不包含：

- Prompt authoring、prompt storage、prompt variable expansion。
- Agent output repair。
- Context selection。
- Workflow orchestration。
- Secret storage UI。
- CI 中真实模型调用。

## 3. Package Boundary

实现位于 `packages/llm-adapter`。

允许依赖：

- `@novel-studio/shared`：`Result`、`UnifiedError`、JSON value types。
- TypeScript、Web/Node runtime primitives。

禁止依赖：

- `@novel-studio/repository`
- `@novel-studio/workflow-engine`
- `@novel-studio/context-engine`
- `@novel-studio/agent-engine`
- `@novel-studio/ui`
- Electron renderer 或 preload API

LLM Adapter 不读写项目文件，不访问 UI，不知道 workflow 或 agent 的业务语义。

## 4. 核心契约

### Model Profile

`ModelProfile` 描述 provider、model、base URL、timeout、retry policy 和 cost policy。Secret 只能通过 `apiKeyRef` 引用，不能以 plaintext 出现在 project file、fixture、日志或错误对象中。

### Request

`LlmRequest` 必须是 provider-neutral 的结构化 JSON：

- `profile`
- `messages`
- `responseFormat`
- `temperature`
- `maxOutputTokens`
- `metadata`

Provider-specific fields 只能放在明确命名的 extension 区域，并且必须先经过 schema/类型约束。

### Response

`LlmResponse` 返回：

- `text`
- `structured`
- `finishReason`
- `usage`
- `cost`
- `providerMetadata`

上层必须依赖这些 normalized fields，而不是 provider 原始 payload。

### Streaming

Streaming interface 返回 async iterable event stream。事件类型包括：

- `delta`
- `usage`
- `done`
- `error`

Provider failure、timeout、rate limit 等问题必须转换为 `error` event 或 `Result` failure，不能越过 Adapter 边界直接抛出 provider-specific error。

## 5. Error Policy

所有错误必须使用 Unified Error shape，错误 code 必须稳定。Adapter 至少覆盖：

- `LLM_PROVIDER_ERROR`
- `LLM_TIMEOUT`
- `LLM_RATE_LIMITED`
- `LLM_RETRY_EXHAUSTED`
- `LLM_MALFORMED_RESPONSE`
- `LLM_SECRET_MISSING`
- `LLM_ABORTED`

错误 details 中不得包含 API key、Authorization header、完整 secret、provider raw request body 中的敏感片段。

## 6. Timeout / Retry / Rate Limit

- Timeout 必须覆盖等待 provider response 的 in-flight 阶段。
- Retry 只允许用于明确可重试的错误，例如 transient network failure 或 rate limit。
- Retry policy 必须有最大次数和 backoff。
- Rate limit 必须返回 normalized error，并尽量保留 provider 可公开的 retry-after 信息。
- Retry exhaustion 返回 `LLM_RETRY_EXHAUSTED`，并保留可审计的 attempt count。

## 7. Usage / Cost

Usage report 包含 input tokens、output tokens、total tokens 和状态。

Cost report 包含 estimated/actual cost、currency、pricing source 和状态。

当 provider 不返回 usage 时，不允许伪造 actual usage；必须返回 `missing` 或 `estimated`。

## 8. Secret Redaction

Adapter 必须在以下位置做 redaction：

- error message
- error details
- provider metadata
- retry diagnostics
- streaming error event
- test fixture failure output

Redaction 后可以保留 secret ref，例如 `apiKeyRef:openai-main`，但不能保留 secret value。

## 9. 测试要求

M6 测试必须覆盖：

- mock provider non-streaming 成功路径。
- mock provider streaming 成功路径。
- OpenAI-compatible fixture mapping。
- timeout enforcement。
- retry backoff 和 retry exhaustion。
- rate limit normalization。
- malformed provider payload。
- missing usage/cost reporting。
- secret redaction。
- streaming error normalization。

CI 不允许访问真实 provider endpoint，不允许依赖真实 API key。

## 10. 验收状态

M6 已完成并通过本地门禁：

- `npm run typecheck`
- `npm run lint`
- `npm run format`
- `npm run test`
- `npm run test:contract`
- `npm audit`

后续 provider 扩展必须继续沿用本契约和 fixture-first 测试策略。
