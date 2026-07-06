# M89-M91 Trust Workflow Editor Gates

Version: 1.0 | Date: 2026-07-06 | Status: Active

## Scope

M89-M91 continues the Post-M18 productization route without crossing the constitution boundaries:

- M89 Plugin Runtime Trust Store: add structured local trust-store and audit-log projections that can be persisted by Repository later. This does not execute arbitrary third-party code.
- M90 Workflow Designer Product Editing: add product editing affordances for node type insertion, edge retargeting, branch edits, and delete confirmation.
- M91 CodeMirror Default Migration Gate: add a stricter migration gate with parity, benchmark, rollback, and opt-in evidence before CodeMirror can be recommended as the default.

## Design Notes

- P8: renderer/UI stays callback-driven; filesystem persistence remains represented as Application DTOs and future Repository contracts.
- P9: workflow edits and plugin audit events remain structured JSON contracts.
- P10: CodeMirror still does not become the default unless every gate passes.

## Non-Goals

- No marketplace install/update.
- No real external plugin process execution.
- No automatic AI diff application.
- No forced CodeMirror default switch.

## Changelog

- v1.0: Defines M89-M91 implementation scope and boundaries.
