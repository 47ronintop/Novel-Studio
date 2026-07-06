# M78-M80 Productization Record

Version: 1.0 | Status: Complete | Date: 2026-07-06

## Milestones

- M78 CodeMirror DOM View Implementation.
- M79 Plugin Isolation Worker Prototype.
- M80 Workflow Designer Layout Persistence.

## Product Outcome

This batch targets three visible Product Gaps left open after M75-M77:

- The editor runtime gains a real CodeMirror DOM view path behind the existing flagged adapter boundary, while textarea remains the safe default fallback.
- Plugin sandbox execution moves from a planning DTO to an isolated-worker prototype contract that still refuses unsigned or denied-capability plugins.
- Workflow Studio gains layout positions and draft persistence semantics for graph nodes so the designer can become spatial instead of a linear list.

## Guardrails

- CodeMirror DOM view must not become the default editor in this batch.
- Renderer code must not call repositories, filesystem, models, or plugin workers directly.
- The isolated worker prototype must execute only structured fixture handlers in tests; arbitrary third-party plugin source remains out of scope.
- Workflow layout persistence is a UI/Application-facing projection and must not change workflow execution semantics.

## Changelog

- v1.0: Initial M78-M80 productization record.
