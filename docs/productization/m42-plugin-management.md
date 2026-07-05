# M42 Plugin Management

Version: 1.0 | Status: Complete | Last Updated: 2026-07-06

## Goal

M42 upgrades plugin management from a read-only `plugins/plugins.json` listing into a safer project-level plugin management surface. Users can inspect validated local plugin manifests, see capability and permission details, and enable or disable registered plugins without executing plugin code.

## Scope

- Read plugin manifests referenced by `plugins/plugins.json` through Repository/Application boundaries.
- Validate manifests with the existing `plugin-manifest` JSON Schema.
- Expose manifest summary fields to Settings UI: display name, version, entry kind, compatible app range, capabilities, requested permissions, contributed commands and workflow steps.
- Show registry grants separately from manifest-requested permissions.
- Toggle a registered plugin `enabled` flag in `plugins/plugins.json`.
- Keep all behavior local-first and deterministic.

## Design Reason

`PROJECT_CONSTITUTION.md` section 10 requires plugin capability declaration, project-data access boundaries, Workflow integration design, and version compatibility. M42 does not run third-party code; it improves visibility and control over the declared contract. Repository remains the only layer touching plugin files, preserving P8.

## Data Flow

`plugins/plugins.json`
-> `PluginRegistryFileRepository`
-> manifest file read and schema validation
-> `PluginSettingsSession`
-> Desktop Application / IPC / preload
-> Settings bridge
-> Settings plugin management UI

Toggle flow:

Settings UI
-> renderer SettingsBridge
-> preload `plugins.setEnabled`
-> Application `setPluginEnabled`
-> Repository updates `plugins/plugins.json`
-> Settings UI reloads updated snapshot

## Acceptance

- Registry repository can read validated manifest summaries.
- Registry repository can toggle `enabled` and revalidate `plugins/plugins.json`.
- Application exposes manifest summaries and toggle API through injected session.
- Settings bridge maps manifest details and toggle feedback into UI props.
- Settings UI shows manifest details, requested permissions, grants, contributions, and toggle buttons.
- No plugin code is executed; no network or remote install path is introduced.

## Non-Goals

- Plugin marketplace.
- Remote install/update/download.
- Plugin sandbox execution.
- Workflow contribution activation.
- Dangerous permission approval flow beyond displaying requested vs granted permissions.

## Changelog

- v1.0 - Completed plugin manifest summary and enable/disable management slice.
