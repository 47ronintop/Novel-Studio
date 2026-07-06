# M57/M58 Plugin Runtime Host Commands and Workflow Adapter Plan

**Goal:** Add the first safe Plugin Runtime execution slice and workflow-step adapter integration.

**Architecture:** Application owns plugin runtime policy and adapter calls. Workflow Engine emits structured actions only. Renderer sees commands through existing Application command APIs.

## Task 1: Document Boundary

- [x] Record M57/M58 scope and RFC numbering decision.
- [x] Define policy, data flow, risks, and future extensions.

## Task 2: Plugin Runtime Host Commands

- [x] Add red tests for listing enabled plugin command contributions.
- [x] Add red tests for disabled/missing-permission command reasons.
- [x] Add red tests for executing a host command through a fixture adapter.
- [x] Implement `PluginRuntimeSession`.
- [x] Wire runtime commands into `DesktopApplication.listCommands()` and `executeCommand()`.

## Task 3: Plugin Workflow Step Adapter

- [x] Add red tests for parsing plugin workflow steps.
- [x] Add red tests for `run-plugin-step` next action.
- [x] Add red tests for Application runtime workflow adapter execution.
- [x] Implement workflow `plugin` step kind and action DTO.
- [x] Add runtime `runWorkflowStep()` policy and adapter call.

## Task 4: Documentation and Project Tracking

- [x] Add productization summary for M57/M58.
- [x] Update `ROADMAP.md`, `INDEX.md`, `CHANGELOG.md`, and `TECH_DEBT.md`.

## Task 5: Verification and Commit

- [x] Run focused tests while implementing.
- [ ] Run full typecheck, lint, format, test, and diff checks.
- [ ] Commit the completed milestone.
