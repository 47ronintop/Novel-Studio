# M50 User Preferences

Version: 1.0 | Status: Complete | Last Updated: 2026-07-06

## Goal

M50 persists user-level UI preferences so Novel Studio remembers onboarding dismissal and shell layout choices across desktop launches.

## Scope

- User-level preferences file under desktop user data.
- Persist onboarding dismissed.
- Persist navigator collapsed, inspector collapsed, bottom panel visibility, active bottom panel tab, and workspace layout dimensions.
- Renderer loads and saves through preload/Application/Repository only.
- No manuscript content, project settings, API keys, telemetry, or cloud sync.

## Data Flow

Renderer startup → preload `api.preferences.load()` → IPC → `DesktopApplication.loadUserPreferences()` → `UserPreferencesSession` → `UserPreferencesFileRepository` → `user-preferences.json`.

User action → renderer save request → preload `api.preferences.save(input)` → Application → Repository atomic write.

## Acceptance

- Missing preferences file loads defaults.
- Preferences save and read back through repository tests.
- IPC allowlist includes only Application preference channels.
- E2E verifies onboarding dismissal survives app restart with the same user data root.

## Changelog

- v1.0 - Initial user preferences persistence slice.
