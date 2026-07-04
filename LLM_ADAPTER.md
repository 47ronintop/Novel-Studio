# LLM ADAPTER - Novel Studio

Version: 1.0 | Status: Accepted for M6 | Phase: 7 Formal Development

## 1. Purpose

This document defines the v1 LLM Adapter contract for Novel Studio. The adapter is the only model-call boundary in the core runtime. Upper layers must not call provider SDKs, fetch provider endpoints, or parse provider-specific errors directly.

The adapter must support provider-neutral requests and responses, mock-first testing, streaming and non-streaming execution, normalized errors, timeout and retry policy, rate-limit handling, and usage/cost reporting.

## 2. Scope

M6 implements:

- Provider-neutral TypeScript interfaces for LLM requests, responses, stream events, model profiles, retry policy, and usage.
- A deterministic mock provider used by tests and future CI workflows.
- A first OpenAI-compatible provider shape without real network calls in CI.
- Error normalization for provider failures, timeout, retry exhaustion, rate limits, and malformed provider payloads.
- Usage and cost reporting with explicit `missing`, `estimated`, or `actual` status.

M6 does not implement:

- Prompt authoring, prompt storage, or prompt variable expansion.
- Agent output repair.
- Context selection.
- Workflow orchestration.
- Secret storage UI.
- Real model calls in CI.

## 3. Package Boundary

The implementation lives in `packages/llm-adapter`.

Allowed dependencies:

- `@novel-studio/shared` for `Result`, `UnifiedError`, and JSON value types.
- Standard TypeScript and Web/Node runtime primitives.

Disallowed dependencies:

- Repository package access for direct project reads or writes.
- Application, Service, Agent, Context, Workflow, UI, Electron, or renderer imports.
- Provider SDKs during the first M6 contract slice.

Provider credentials are passed as redacted references or injected runtime secrets. They must not be logged, persisted to project files, or committed as fixtures.

## 4. Core Data Flow

```text
Upper layer
-> LLM Adapter request
-> provider-neutral validation
-> provider implementation
-> normalized response or UnifiedError
-> usage/cost report
-> upper layer
```

Streaming preview is presentation data. It is not an Agent handoff contract. Final Agent handoff remains structured JSON in later M7 work.

## 5. Request Contract

An adapter request includes:

- `schemaVersion`: currently `1.0`.
- `requestId`: stable id for traceability.
- `modelProfile`: provider, model name, endpoint, timeout, and generation defaults.
- `mode`: `streaming` or `non-streaming`.
- `messages`: ordered role/content messages.
- `parameters`: temperature, max tokens, top-p, and reserved future parameters.
- `responseFormat`: optional structured output hint.
- `traceId`: error/log correlation id.

Provider-specific fields are isolated to provider implementations. Core callers use the provider-neutral request only.

## 6. Response Contract

A non-streaming response returns:

- `schemaVersion`.
- `requestId`.
- `provider`.
- `modelName`.
- `status`.
- `content` as text or JSON value.
- `usage`.
- `createdAt`.

A streaming response yields ordered events:

- `start`.
- `delta`.
- `usage`.
- `done`.

Errors are returned as `Result` errors, not thrown through business logic. Provider transport exceptions are caught and normalized.

## 7. Error Normalization

The adapter converts provider failures into `UnifiedError` with category `LLMAdapterError` or `ModelProviderError`.

Required stable codes:

- `LLM_TIMEOUT`
- `LLM_RATE_LIMITED`
- `LLM_RETRY_EXHAUSTED`
- `LLM_PROVIDER_ERROR`
- `LLM_MALFORMED_RESPONSE`
- `LLM_UNSUPPORTED_MODE`
- `LLM_ABORTED`

The adapter may include redacted provider metadata in `redactedDetail`, but must not include API keys, Authorization headers, full user manuscript text, or raw unredacted provider payloads.

## 8. Timeout, Retry, And Rate Limit Policy

Timeouts are enforced per request. Retry is controlled by injected policy:

- `maxAttempts`
- `baseDelayMs`
- `maxDelayMs`
- `backoffMultiplier`
- `retryableCodes`

Retry delay uses exponential backoff capped by `maxDelayMs`. Tests inject a no-wait scheduler so CI remains deterministic.

Rate-limit responses normalize to `LLM_RATE_LIMITED`. If retry attempts are exhausted after rate-limit or transient failures, the final error code is `LLM_RETRY_EXHAUSTED` and `redactedDetail.lastCode` records the last normalized code.

## 9. Usage And Cost Reporting

Usage reporting must distinguish:

- `actual`: provider returned token counts.
- `estimated`: adapter estimated token counts.
- `missing`: no trustworthy usage available.

Cost reporting must distinguish:

- `actual`: provider returned billable cost.
- `estimated`: adapter calculated cost from configured token rates.
- `unknown`: no rate or usage basis exists.

Costs use decimal numbers and ISO currency codes. UI may display estimates, but must not treat them as billing-grade data unless status is `actual`.

## 10. Mock Provider

The mock provider is the default M6 provider for tests. It must support:

- Successful non-streaming response.
- Successful streaming response.
- Timeout fixture.
- Retry-then-success fixture.
- Rate-limit fixture.
- Provider error fixture.
- Usage/cost fixture.

Mock behavior is deterministic and configured through explicit fixtures, never random output.

## 11. OpenAI-Compatible Provider Slice

The first real provider target is OpenAI-compatible HTTP shape because it unlocks multiple providers behind one contract. The M6 contract slice defines request/response mapping and fixture normalization. Real network calls are excluded from CI and must be opt-in offline evaluation only.

## 12. Testing Requirements

M6 must add tests for:

- Non-streaming success.
- Streaming success.
- Timeout normalization.
- Retry with exponential backoff.
- Rate-limit normalization.
- Retry exhaustion.
- Provider error normalization.
- Malformed provider payload normalization.
- Usage and cost status.
- Secret redaction.

All tests must use mock providers or local fixtures. CI must not require real API keys or network access.

## 13. Definition Of Done

M6 is complete when:

- `packages/llm-adapter` exists with strict TypeScript.
- Public adapter interfaces are exported from one package entrypoint.
- Mock provider tests cover streaming and non-streaming paths.
- Timeout, retry, rate-limit, error normalization, usage, and cost tests pass.
- No real model call is required by tests.
- Documentation, changelog, and index are updated.
- `typecheck`, `lint`, `format`, `test`, `test:contract`, and `npm audit` pass.

## 14. Changelog

- v1.0 - 2026-07-04: Created M6 LLM Adapter contract.
