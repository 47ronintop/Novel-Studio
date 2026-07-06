# M50/M51 Preferences and Recovery Hardening Design

## Goal

M50 persists user-level UI preferences so the desktop no longer forgets dismissed onboarding and layout choices between launches. M51 hardens recovery handling by making processed recovery records explicit, keeping inline/file-ref behavior typed, and documenting the next recovery-hardening boundary.

## Recommended Approach

Use a user-level preferences JSON file under the desktop user data directory, accessed only through Repository/Application/IPC/preload. Renderer code loads preferences on startup and saves preference changes after user actions.

For recovery, keep protected `history/recovery/` files in place. Processed records remain on disk with `dirty: false`; Project Health and workspace recovery lists continue to hide clean records. `file-ref` records keep returning a typed unsupported-content error instead of reading arbitrary paths.

## M50 Scope

- Add `UserPreferencesSession` in Application.
- Add `UserPreferencesFileRepository` in Repository.
- Add preload/API methods:
  - `preferences.load()`
  - `preferences.save(input)`
- Persist:
  - onboarding dismissed
  - workspace layout
  - shell UI state: navigator collapsed, inspector collapsed, bottom panel visibility, active bottom panel tab
- App loads preferences once on startup and saves after onboarding dismiss, layout commands, activity selection, and bottom tab selection.

## M51 Scope

- Add focused tests that clean recovery records are retained on disk but hidden from dirty recovery summary.
- Add focused tests that `file-ref` recovery drafts return `RECOVERY_DRAFT_CONTENT_UNAVAILABLE`.
- Keep deletion/pruning out of scope; future Recovery Hardening can add an archive browser and retention policy.
- Update productization docs to state exactly what M51 closes and what remains.

## Architecture

`UserPreferencesFileRepository`
→ `UserPreferencesSession`
→ `DesktopApplication`
→ IPC/preload `api.preferences`
→ renderer `App`.

No UI code reads or writes files. The preferences file is not project source data and does not store user manuscript content or API keys.

## Data Shape

```json
{
  "schemaVersion": "1.0",
  "onboarding": {
    "dismissed": true
  },
  "shell": {
    "navigatorCollapsed": false,
    "inspectorCollapsed": false,
    "bottomPanelVisible": true,
    "activeBottomPanelTab": "工作流运行",
    "workspaceLayout": {
      "splitView": true,
      "navigatorWidth": 300,
      "inspectorWidth": 280,
      "bottomPanelHeight": 220
    }
  }
}
```

## Risks

- Preferences can drift from Application shell state if writes fail. Renderer treats saves as best-effort and keeps the current in-memory state.
- User preferences are app-local, not project-local. This is intentional for onboarding and shell layout; project-specific preferences can be added later via RFC.
- M51 does not solve stale-lock recovery or file-ref recovery preview. Those remain explicit future tasks.

## Acceptance

- Preferences load default values when no file exists.
- Saving preferences writes a JSON file without API keys or manuscript content.
- Onboarding dismissed and layout shell state survive app reload through preload/API.
- Clean recovery records remain in `history/recovery/` but do not appear as dirty recovery items.
- `file-ref` recovery preview/apply returns typed unavailable-content errors.
- Full typecheck, lint, format, unit tests, E2E, and `git diff --check` pass.
