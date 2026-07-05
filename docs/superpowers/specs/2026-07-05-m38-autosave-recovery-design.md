# M38 Autosave Recovery Design

## Product Decision

Implement the smallest Constitution-compliant recovery loop for chapter drafts: write structured dirty recovery records during edits, mark the same session clean after save, and surface dirty recovery records in the workspace UI.

## Boundaries

- No renderer filesystem access.
- No direct UI-to-Repository calls.
- No new IPC channels unless the existing chapter/project channels are insufficient.
- No automatic apply/discard flow in this milestone.

## Architecture

- `shared` owns the recovery record contract because Application and Repository both need it.
- `repository` implements `listRecoveryRecords()` in addition to `writeRecoveryRecord()`.
- `application` injects a recovery repository into project workspace-created chapter editor sessions.
- `desktop` composition wires `RecoveryRepository`.
- `ui` displays `ProjectWorkflowProps.recovery` and tab dirty state.

## Future Extension

M39+ can add a review/apply/discard recovery panel, cursor restoration, background interval autosave settings, and retention policy.
