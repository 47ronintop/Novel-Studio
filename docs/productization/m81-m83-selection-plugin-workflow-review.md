# M81-M83 Productization Record

Version: 1.0 | Status: Complete | Date: 2026-07-06

## Milestones

- M81 Selection Apply Review UX.
- M82 Plugin Signing and Permission UI.
- M83 Workflow Designer Interaction.

## Product Outcome

This batch closes three gaps left open after M78-M80:

- Selection-level AI edits become explicitly reviewable, rejectable, and locally undoable before or after apply.
- Plugin settings surface trust, signing, permission, denied capability, and audit readiness states without executing third-party code.
- Workflow Studio layout edits become graph interactions that can persist with the workflow draft when the user saves.

## Guardrails

- AI selection preview remains preview-first and user-confirmed, aligned with P1 and P9.
- Plugin signing UI is visibility and policy only; it does not add marketplace, download, or arbitrary source execution.
- Workflow layout persistence must not change workflow execution semantics.
- Renderer bridges continue to call Application APIs only; they do not access repositories, filesystem, model adapters, or plugin workers directly.

## Changelog

- v1.0: Initial M81-M83 productization record.
