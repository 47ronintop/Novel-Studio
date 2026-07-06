# M59/M60 Editor Runtime Adapter and Workflow Graph Projection Plan

**Goal:** Extract the textarea editor runtime adapter and add Workflow Graph projection/validator.

**Architecture:** Renderer owns editor runtime adapter state. Workflow Engine owns pure graph projection and validation DTOs. No new storage path or execution path is introduced.

## Task 1: Document Boundary

- [x] Record M59/M60 scope and non-goals.
- [x] Define editor runtime and workflow graph data flows.

## Task 2: Editor Runtime Adapter Extraction

- [x] Add red tests for textarea runtime snapshot and runtime props.
- [x] Add red tests for body-change, save-requested, selection-changed, command, focus, and destroy lifecycle.
- [x] Implement renderer `editor-runtime` module.
- [x] Replace inline `createChapterEditorRuntime()` in `App.tsx` with the adapter module.

## Task 3: Workflow Graph Projection and Validator

- [x] Add red tests for workflow graph nodes and edges.
- [x] Add red tests for branch/default/plugin graph projection.
- [x] Add red tests for invalid edge, unreachable node, missing agent/plugin metadata, and branch validation issues.
- [x] Implement `WorkflowGraphViewModel` and `WorkflowValidationReport`.
- [x] Export graph projection and validation APIs.

## Task 4: Documentation and Tracking

- [x] Add productization summary for M59/M60.
- [x] Update `ROADMAP.md`, `INDEX.md`, `CHANGELOG.md`, and `TECH_DEBT.md`.

## Task 5: Verification and Commit

- [x] Run focused tests during implementation.
- [ ] Run full typecheck, lint, format, test, and diff checks.
- [ ] Commit the completed milestone.
