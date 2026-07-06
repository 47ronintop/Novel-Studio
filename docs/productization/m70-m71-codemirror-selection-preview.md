# M70-M71 Productization Record

Version: 1.0 | Status: Complete | Date: 2026-07-06

## Milestones

- M70 CodeMirror Package Parity.
- M71 Selection-aware AI Preview.

## Product Outcome

This batch makes the editor runtime more real without weakening user control:

- CodeMirror gets a real package-backed headless state path behind the feature flag.
- Selection-aware AI preview becomes a structured, preview-only path that can show diffs before any user-approved apply.

## Guardrails

- Textarea remains the default editor.
- Renderer runtime does not access storage, models, or Electron.
- Selection preview does not auto-apply content.
- All selection handoff data stays structured.

## Changelog

- v1.0: Initial M70-M71 productization record.
