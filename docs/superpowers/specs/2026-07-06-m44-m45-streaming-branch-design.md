# M44/M45 Streaming UX and Workflow Branch Design Spec

## Scope

M44 adds a deterministic streaming contract and visible streaming UX states. M45 adds workflow branch step evaluation in the Workflow Engine. Both milestones stay inside existing architecture boundaries: LLM behavior remains behind LLM Adapter, UI receives props, and Workflow Engine stays pure TypeScript with no Agent, Repository, Electron, or UI dependencies.

## M44 Design

The OpenAI-compatible provider gains a fixture-friendly streaming transport. Non-streaming transport remains unchanged. Streaming requests map to `/chat/completions` with `stream: true`, parse provider delta chunks, emit provider-neutral `delta` and `usage` events, and normalize malformed chunks through existing LLM Adapter error handling.

The AI writing UI gains explicit streaming states: `streaming`, stream preview text, and a cancel command. This is a UX contract slice, not live provider orchestration. The current promise-based generate flow remains valid; streaming props let renderer and tests show partial output, cancel state, and error feedback without sending real model calls in CI.

## M45 Design

Workflow branch steps are evaluated as pure branch actions. A branch step contains ordered `branches`, each with an `id`, `label`, `condition`, and `nextStepId`, plus an optional `defaultNextStepId`. The engine returns a `choose-branch` action and a new `chooseWorkflowBranch()` transition advances the run to the selected next step. The engine validates branch targets at parse time and rejects branch completion without an explicit branch choice.

## Data Flow

M44 flow: Application or tests create a streaming `LlmRequest` -> `LlmAdapter.stream()` emits `start` -> OpenAI-compatible streaming transport yields chunks -> provider emits neutral deltas/usage -> adapter emits `done` or normalized error.

M45 flow: `parseWorkflowDefinition()` validates branch metadata -> `evaluateNextWorkflowAction()` returns `choose-branch` -> caller selects a branch id -> `chooseWorkflowBranch()` records the branch step as completed and moves to the branch target.

## Risks

- Provider streaming formats differ. M44 only implements OpenAI-compatible chunk parsing and keeps other provider translators out of scope.
- UI streaming is a contract slice, not full live streaming orchestration. Real cancellation over IPC can be added later without changing props.
- Branch conditions are named strings in M45. Expression evaluation is intentionally deferred to the Workflow/Application caller to avoid embedding a policy language prematurely.

## Changelog

- v1.0 - Initial combined M44/M45 design.
