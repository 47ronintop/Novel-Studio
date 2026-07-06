# M61-M62 CodeMirror Flag and Workflow Graph View

Version: 1.0 | Status: Complete | Date: 2026-07-06

## Scope

M61 introduces a feature-flagged CodeMirror editor runtime adapter contract. M62 exposes workflow graph projection and validation in Workflow Studio as a read-only view.

## Design Reason

The editor migration must remain incremental: textarea stays the safe default, while CodeMirror parity is proven behind a flag. Workflow graph UI must remain a projection of workflow JSON generated through Application/Workflow Engine boundaries.

## Completed Capabilities

- Adapter resolver defaults to textarea.
- CodeMirror adapter can be selected only when explicitly enabled.
- CodeMirror adapter follows the same structured event and snapshot contract.
- Workflow config snapshots include graph projection and validation report.
- Studio UI renders workflow nodes, edges, and validation issues without persisting graph layout.

## Non-Goals

- CodeMirror is not the default editor runtime.
- No real CodeMirror package is bundled yet.
- No selection-aware AI commands.
- No graph node editing.
- No graph layout persistence.

## Changelog

- v1.0: Initial M61/M62 productization record.
