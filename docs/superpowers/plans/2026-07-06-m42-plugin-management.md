# M42 Plugin Management Implementation Plan

**Goal:** Add validated manifest summaries and enable/disable toggles to plugin management.

## Task 1: Repository Contract

- [x] Add failing repository tests for manifest summary loading.
- [x] Add failing repository tests for enabled toggle persistence.
- [x] Implement manifest read, schema validation, invalid manifest entry status, and registry write.

## Task 2: Application and IPC Contract

- [x] Add failing Application tests for plugin settings load/toggle.
- [x] Add `PluginSettingsSession.setEnabled`.
- [x] Extend `NovelStudioApi`, IPC contract, handlers, and preload API.

## Task 3: Renderer and UI

- [x] Add failing settings bridge test for manifest details and toggle calls.
- [x] Add failing UI test for plugin details and enable/disable controls.
- [x] Map manifest summaries in settings bridge.
- [x] Render plugin details and toggle controls in Settings.

## Task 4: Docs and Gates

- [x] Update `ROADMAP.md`, `INDEX.md`, `CHANGELOG.md`, and `TECH_DEBT.md`.
- [x] Run focused tests.
- [x] Run full verification gates.
