# M84-M85 Productization Record

Version: 1.0 | Status: Complete | Date: 2026-07-06

## Milestones

- M84 Workflow Designer Canvas.
- M85 Editor Runtime Default Readiness.

## Product Outcome

This batch turns two long-running tracks into explicit readiness surfaces:

- Workflow Studio gains a canvas interaction contract: designer availability, selectable edges, node coordinates, and structured drag commits that persist into the workflow draft JSON.
- Editor Runtime gains a default-readiness evaluator so CodeMirror can be assessed against DOM mount, event parity, fallback, and migration blockers without switching the default prematurely.

## Guardrails

- Workflow layout remains metadata in the workflow asset. It does not change execution semantics.
- Renderer/UI code continues to call Application-layer helpers only; it does not access repositories, filesystem APIs, model adapters, or plugin workers.
- Edge selection is UI state and graph inspection only in this milestone. Editing edge semantics remains through the existing node inspector fields.
- CodeMirror remains opt-in. The default runtime stays `textarea` unless a future milestone proves readiness and changes the resolver policy intentionally.

## Changelog

- v1.0: Initial M84-M85 productization record.
