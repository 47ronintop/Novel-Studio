# M54-M56 Runtime RFCs

Version: 1.0 | Status: Complete | Date: 2026-07-06

## Scope

M54-M56 are architecture RFC milestones. They intentionally do not add runtime execution code. Their purpose is to freeze the next major implementation boundaries before adding plugin execution, CodeMirror-based editor runtime, or workflow graph editing.

## Completed

- M54: `docs/rfcs/RFC-0001-plugin-runtime.md`
  - Defines Plugin Runtime modes, permission policy, adapter boundary, workflow integration, security requirements, error codes, and rollout plan.
- M55: `docs/rfcs/RFC-0002-editor-runtime-engine.md`
  - Defines adapter-first editor runtime, CodeMirror 6 direction, runtime events, selection metadata, visual diff direction, keyboard integration, and migration plan.
- M56: `docs/rfcs/RFC-0003-workflow-designer.md`
  - Defines schema-first workflow graph designer, graph view model, validation rules, branch/condition policy, Agent decision visualization, plugin workflow nodes, and rollout plan.

## Explicit Non-Goals

- No arbitrary third-party plugin code execution.
- No marketplace, download, update, or signing pipeline.
- No CodeMirror default runtime yet.
- No workflow graph editor UI yet.
- No executable condition expression language.

## Next Implementation Order

1. M57 Plugin Runtime Host Commands.
2. M58 Plugin Workflow Step Adapter.
3. M59 Editor Runtime Adapter Extraction.
4. M60 Workflow Graph Projection.

## Changelog

- v1.0: Initial M54-M56 RFC completion summary.
