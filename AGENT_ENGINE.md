# AGENT ENGINE - Novel Studio

Version: 1.0 | Status: Accepted for M7.3 | Phase: 7 Formal Development

## 1. Purpose

The Agent Engine executes one configured agent against validated structured input, an explicit context
bundle, and an injected LLM Adapter. It validates input and output contracts, normalizes agent-level
failures, and produces Agent Handoff JSON for the next workflow step.

The Agent Engine does not write project files, scan project storage, own workflow state transitions, or
call provider SDKs directly.

## 2. Scope For M7.3

M7.3 implements:

- Agent input validation through injected schema validators.
- LLM Adapter invocation through the provider-neutral adapter interface.
- Structured output extraction from JSON responses or JSON text responses.
- Agent output validation through injected schema validators.
- Agent Handoff JSON creation.
- Safe failure for malformed JSON output.
- Package boundary tests preventing Repository, UI, Electron, Application, or provider SDK access.

M7.3 does not implement:

- Prompt template storage or expansion.
- Agent registries backed by project files.
- Output repair loops.
- Tool use.
- Streaming UI preview.
- Project writes or AI suggestion application.

## 3. Package Boundary

The implementation lives in `packages/agent-engine`.

Allowed dependencies:

- `@novel-studio/shared` for `Result`, `UnifiedError`, and JSON types.
- `@novel-studio/llm-adapter` for the provider-neutral adapter contract.
- `@novel-studio/context-engine` for the context bundle contract.

Disallowed dependencies:

- `@novel-studio/repository`
- UI, Electron, Application, or Service packages
- Provider SDKs

All dependencies are injected where they perform external work. The package itself remains testable
with mock adapters and validators.

## 4. Core Data Flow

```text
Agent Run Input
-> input schema validator
-> provider-neutral LLM request
-> LLM Adapter
-> structured output extraction
-> output schema validator
-> Agent Handoff JSON
```

## 5. Run Input Contract

A run request includes:

- `schemaVersion`: currently `1.0`.
- `agentRunId`: stable id for this agent run.
- `handoffId`: stable id for the produced handoff.
- `workflowRunId`: workflow run id for traceability.
- `traceId`: error correlation id.
- `agent`: active agent configuration.
- `toAgentId`: next agent or workflow receiver id.
- `input`: structured JSON object for the agent.
- `contextBundle`: explicit context bundle from Context Engine.
- `llmRequest`: provider-neutral LLM request prepared by upper layers.

Prompt text and model parameters are supplied by upper layers. The Agent Engine must not hardcode
prompts or model-specific parameters.

## 6. Validation Policy

Agent input is validated with the configured `inputSchemaId`. Agent output is validated with the
configured `outputSchemaId`.

M7.3 uses injected validators so schema registry storage remains outside this package. A missing
validator is an agent configuration failure.

## 7. Structured Output Policy

The LLM response must resolve to a JSON object:

- `content.type: "json"` with an object value is accepted.
- `content.type: "text"` is parsed as JSON and accepted only if the parsed value is an object.
- malformed text JSON, arrays, null, and primitive values fail safely.

Streaming preview is outside M7.3. Formal Agent handoff is always structured JSON.

## 8. Handoff Contract

The engine returns a handoff matching `schema.agent-handoff.v1`:

- `schemaVersion`
- `handoffId`
- `fromAgentId`
- `toAgentId`
- `workflowRunId`
- `payloadType`
- `payload`
- `createdAt`

The payload is the validated structured agent output.

## 9. Error Handling

Agent Engine errors use `UnifiedError` with category `AgentError`.

Required stable codes:

- `AGENT_CONFIG_INVALID`
- `AGENT_INPUT_INVALID`
- `AGENT_MODEL_CALL_FAILED`
- `AGENT_OUTPUT_MALFORMED`
- `AGENT_OUTPUT_INVALID`

Errors include `traceId` and redacted structured detail. User manuscript content and raw provider
payloads must not be copied into error detail.

## 10. Testing Requirements

M7.3 tests must cover:

- Valid agent run produces structured handoff JSON.
- Input validation failure stops before model call.
- LLM Adapter failure becomes `AGENT_MODEL_CALL_FAILED`.
- Malformed JSON text output fails safely.
- Output validation failure returns `AGENT_OUTPUT_INVALID`.
- Package boundary does not depend on Repository, UI, Electron, Application, or Service packages.

## 11. Definition Of Done

M7.3 is complete when:

- `AGENT_ENGINE.md` exists and is indexed.
- `packages/agent-engine` exists and is included in the root TypeScript build graph.
- Public Agent Engine interfaces are exported from one package entrypoint.
- Tests cover validation, adapter call, structured output, handoff creation, malformed JSON, and package boundaries.
- Documentation, roadmap, index, and changelog are updated.
- `typecheck`, `lint`, `format`, `test`, `test:contract`, and `npm audit` pass.

## 12. Changelog

- v1.0 - 2026-07-04: Created M7.3 Agent Engine contract.
