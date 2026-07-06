# M75-M77 Productization Record

Version: 1.0 | Status: Complete | Date: 2026-07-06

## Milestones

- M75 Selection Event UI Wiring.
- M76 Selection Preview Apply Confirmation.
- M77 Plugin Sandbox Isolation Spike.

## Product Outcome

This batch closes the user-visible selection preview loop without weakening local-first or adapter boundaries:

- The chapter textarea emits real selection offsets into the renderer editor runtime snapshot.
- Selection-aware AI preview can be requested from the runtime command and shown as a preview-only diff.
- A stored selection preview can be explicitly applied by the user through the Application layer.
- Plugin sandbox isolation gets a structured execution plan contract for the next real worker/process implementation.

## Guardrails

- Renderer code still does not call models, repositories, filesystem, or plugin workers directly.
- Selection preview apply is explicit; generation still never mutates chapter content.
- Selection preview apply updates the editor draft and recovery state, not the persisted chapter file.
- Plugin isolation remains a spike contract; no arbitrary plugin source is executed.

## Changelog

- v1.0: Initial M75-M77 productization record.
