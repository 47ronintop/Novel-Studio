# WORKFLOW ENGINE - Novel Studio

Version: 1.0 | Status: Accepted for M7.1 | Phase: 7 Formal Development

## 1. Purpose

The Workflow Engine is the deterministic state machine for Novel Studio workflows. It parses workflow definitions, tracks run state, evaluates the next executable step, enforces user confirmation gates, and returns structured instructions for upper layers.

The Workflow Engine does not execute Agents, build context, call models, write files, or call upward into Agent Engine. It only decides what should happen next.

## 2. Scope For M7.1

M7.1 implements:

- Workflow definition parsing and structural validation.
- Workflow run initialization.
- Next-step evaluation for `context`, `agent`, `confirmation`, and `save` steps.
- Step completion and deterministic transition to `nextStepId`.
- Confirmation gate enforcement.
- Unified Error results for invalid definitions, invalid run state, missing steps, and missing confirmation.

M7.1 does not implement:

- Branch expression evaluation.
- Retry/failure policy execution.
- Agent execution.
- Context bundle construction.
- Repository writes.
- UI workflow panels.

## 3. Package Boundary

The implementation lives in `packages/workflow-engine`.

Allowed dependencies:

- `@novel-studio/shared` for `Result` and `UnifiedError`.

Disallowed dependencies:

- `@novel-studio/agent-engine`
- `@novel-studio/context-engine`
- `@novel-studio/llm-adapter`
- `@novel-studio/repository`
- UI, Electron, Application, or Service packages

This package must stay pure and deterministic. Time and ids are injected when needed.

## 4. Core Data Flow

```text
Workflow Definition JSON
-> parseWorkflowDefinition
-> WorkflowDefinition
-> startWorkflowRun
-> WorkflowRunState
-> evaluateNextWorkflowAction
-> structured next action
-> upper layer executes action
-> completeWorkflowStep / confirmWorkflowStep
-> new WorkflowRunState
```

## 5. Workflow Definition Contract

M7.1 consumes the existing `schema.workflow-definition.v1` shape:

- `schemaVersion`
- `id`
- `type`
- `title`
- `status`
- `entryStepId`
- `steps`
- `createdAt`
- `updatedAt`

Each step has:

- `id`
- `kind`: `context`, `agent`, `confirmation`, `save`, or `branch`
- optional `agentId`
- optional `nextStepId`
- optional extension fields preserved as unknown data

Additional M7.1 structural rules:

- `entryStepId` must reference an existing step.
- `nextStepId`, when present, must reference an existing step.
- `agent` steps must include `agentId`.
- Step ids must be unique.

## 6. Run State

A workflow run state includes:

- `schemaVersion`
- `workflowRunId`
- `workflowId`
- `status`: `running`, `waiting-for-confirmation`, `completed`, or `failed`
- `currentStepId`
- `completedStepIds`
- `confirmedStepIds`
- `createdAt`
- `updatedAt`

The state is immutable from the caller perspective. State transition functions return a new state.

## 7. Next Actions

`evaluateNextWorkflowAction` returns one of:

- `build-context`: upper layer should ask Context Engine to build a context bundle.
- `run-agent`: upper layer should ask Agent Engine to run a specific agent.
- `wait-for-confirmation`: upper layer should ask the user to approve before continuing.
- `save`: upper layer should execute an approved save/apply operation.
- `complete`: workflow run has no more steps.

These actions are instructions only. The Workflow Engine does not execute them.

## 8. Confirmation Gate

For a `confirmation` step:

- Evaluation returns `wait-for-confirmation`.
- `completeWorkflowStep` must fail with `WORKFLOW_CONFIRMATION_REQUIRED` until `confirmWorkflowStep` records approval for that step.
- After confirmation, completion may advance to `nextStepId` or complete the run.

This ensures AI-produced or workflow-produced changes cannot be applied without an explicit user gate.

## 9. Error Handling

Workflow Engine errors use `UnifiedError` with category `WorkflowError`.

Required stable codes:

- `WORKFLOW_DEFINITION_INVALID`
- `WORKFLOW_STEP_NOT_FOUND`
- `WORKFLOW_DUPLICATE_STEP`
- `WORKFLOW_AGENT_STEP_MISSING_AGENT`
- `WORKFLOW_RUN_STATE_INVALID`
- `WORKFLOW_CONFIRMATION_REQUIRED`
- `WORKFLOW_STEP_MISMATCH`

Errors include `traceId` and redacted structured detail where useful.

## 10. Testing Requirements

M7.1 tests must cover:

- Valid workflow definition parsing.
- Invalid entry step rejection.
- Duplicate step rejection.
- Agent step without `agentId` rejection.
- Next action for context step.
- Next action for agent step.
- Confirmation gate blocks completion until confirmed.
- Save step can complete the workflow.
- Package boundary does not depend on Agent/Context/LLM/Repository packages.

## 11. Definition Of Done

M7.1 is complete when:

- `packages/workflow-engine` exists and is included in the root TypeScript build graph.
- Workflow parser and state machine functions are exported from one package entrypoint.
- Tests cover the M7.1 state transitions and confirmation gate.
- Documentation, roadmap, index, and changelog are updated.
- `typecheck`, `lint`, `format`, `test`, `test:contract`, and `npm audit` pass.

## 12. Changelog

- v1.0 - 2026-07-04: Created M7.1 Workflow Engine contract.
