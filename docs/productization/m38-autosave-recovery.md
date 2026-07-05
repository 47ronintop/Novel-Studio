# M38 Autosave Recovery

Version: 1.0 | Status: Complete | Last Updated: 2026-07-05

## Goal

M38 closes the first product-visible part of the Constitution section 5 requirement for autosave and crash recovery. The desktop workspace must persist unsaved chapter drafts into `history/recovery/`, preserve those records outside cache cleanup, and show a recovery notice when a project is opened with a dirty chapter recovery record.

## Scope

- Chapter editor edits write a structured recovery record through Application and Repository ports.
- Manual save writes a clean recovery marker so stale dirty records from the same editing session are not shown after a successful save.
- Project open/create/select includes recovery summaries in the workspace snapshot.
- Workspace UI shows a compact recovery notice and marks recovered/dirty open tabs.
- M38 does not add a background timer, multi-window conflict resolution, diff-based recovery apply, or recovery record pruning.

## Design Reason

The project already had `recovery-record.schema.json` and `RecoveryRepository.writeRecoveryRecord`, but no Application-level route used it. M38 keeps file side effects behind Repository, lets the renderer use existing `chapter.edit/save` and `project.open` IPC paths, and avoids introducing a timer before the save/recovery contract is observable and tested.

## Data Flow

Editor body change
→ Renderer `chapter.edit`
→ DesktopApplication
→ active ChapterEditorSession
→ RecoveryRepositoryPort.writeRecoveryRecord
→ `history/recovery/<session-id>.json`
→ UI receives dirty state through existing ChapterEditorSnapshot

Project open
→ ProjectWorkspaceSession
→ RecoveryRepositoryPort.listRecoveryRecords
→ ProjectWorkspaceSnapshot.recovery.availableItems
→ ProjectWorkflowBridge
→ WorkspaceShell recovery notice

## Risks

| Risk                                                 | Impact                                                 | Mitigation                                                                       |
| ---------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Recovery record volume grows                         | `history/` may become noisy                            | Future M43+ can add explicit archive/prune policy; never treat recovery as cache |
| Dirty recovery is shown but cannot yet apply content | User sees availability before full restore workflow    | M38 labels it as recoverable draft notice; apply/discard is deferred             |
| Session id granularity is too coarse                 | Multiple active chapters may overwrite if poorly keyed | Session id includes project id and chapter id for chapter recovery               |

## Acceptance

- Editing a chapter records an inline dirty recovery record under `history/recovery/`.
- Saving the chapter records `dirty: false` for the same session id.
- Opening a project with a dirty recovery record exposes recovery metadata in `ProjectWorkspaceSnapshot`.
- Workspace UI renders an autosave recovery notice and dirty tab marker.
- Typecheck, lint, unit tests, E2E, and format checks pass.

## Changelog

- v1.0 - Initial M38 autosave recovery slice.
