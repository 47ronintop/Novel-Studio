# M42 Plugin Management Design Spec

## Decision

M42 keeps plugin management inside Settings but upgrades the data contract from registry-only entries to registry + manifest summaries. It adds a registry toggle operation but does not execute plugin code.

## Repository Contract

`PluginRegistryFileRepository` gains:

- `readPluginSettings()`
- `setPluginEnabled(pluginId, enabled)`

`readPluginSettings()` reads the registry, then reads each referenced manifest path under `plugins/<plugin-id>/plugin.json`, validates it with `plugin-manifest`, and returns a combined snapshot. Missing/invalid manifests are represented as invalid plugin entries instead of crashing the whole settings view, as long as `plugins/plugins.json` itself is valid.

## Application Contract

`PluginSettingsSession` exposes:

- `load()`
- `setEnabled(pluginId, enabled)`

It does not know filesystem paths beyond repository DTOs.

## UI Contract

Settings plugin section shows:

- plugin id, enabled/disabled state
- manifest display name/version/entry kind
- compatibility range
- requested permissions
- granted permissions
- capabilities and contributions
- toggle button

## Risk

Users may assume disabled plugins are fully removed. UI copy must frame this as a registry state, not uninstall.

## Changelog

- v1.0 - Initial M42 design spec.
