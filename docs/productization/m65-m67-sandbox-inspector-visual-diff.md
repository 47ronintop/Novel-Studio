# M65-M67 Productization Record

Version: 1.0 | Status: Complete | Date: 2026-07-06

## Milestones

- M65 Plugin Runtime Sandbox RFC.
- M66 Workflow Studio Node Inspector Editing.
- M67 Editor Visual Diff Runtime.

## Product Outcome

This batch moves Novel Studio closer to a usable professional IDE surface:

- Plugin sandbox work now has a dedicated policy document before any unsafe execution work begins.
- Workflow Studio starts moving from read-only graph inspection toward structured node editing.
- Editor runtime exposes visual diff review metadata that future CodeMirror decorations can render inline.

## Guardrails

- No plugin code is executed in M65.
- Workflow edits remain JSON draft mutations until the existing save action validates and persists them.
- Visual diff output remains preview-only and cannot mutate chapter content.
- Renderer code does not access filesystem, Repository, plugin runtime, or model adapters directly.

## Changelog

- v1.0: Initial M65-M67 productization record.
