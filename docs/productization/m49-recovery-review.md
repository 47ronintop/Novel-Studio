# M49 Recovery Review

Version: 1.0 | Status: Complete | Last Updated: 2026-07-06

## Goal

M49 closes the first user-controlled crash recovery loop for chapter drafts. Users can preview a dirty recovery record, apply it into the active chapter editor, or discard the recovery prompt without deleting protected `history/recovery/` data.

## Scope

- Chapter recovery review only.
- Inline recovery content only; `file-ref` records remain future work.
- Apply keeps recovered text as an unsaved editor draft so the user still controls the final save.
- Discard writes a clean recovery marker instead of deleting the recovery file.
- No automatic merge, pruning, stale-lock recovery, or Prompt/Agent/Workflow recovery UI.

## Design Reason

M38 already persisted recovery records and showed a notice, but users could not decide what to do with the draft. M49 keeps recovery decisions explicit and local-first: all file effects stay behind Application/Repository, while the renderer only invokes structured callbacks.

## Data Flow

Preview:

Workspace recovery notice → `ProjectWorkflowBridge.previewRecoveryDraft()` → preload `api.project.previewRecoveryDraft()` → IPC → `DesktopApplication.previewRecoveryDraft()` → `ProjectWorkspaceSession.previewRecoveryDraft()`.

Apply:

Workspace recovery notice → `ProjectWorkflowBridge.applyRecoveryDraft()` → Application selects the recovered chapter → `ChapterEditorSession.edit()` loads recovered body as unsaved text → recovery record is marked clean → renderer receives both project workflow and chapter editor snapshots.

Discard:

Workspace recovery notice → `ProjectWorkflowBridge.discardRecoveryDraft()` → Application writes a clean recovery marker → refreshed project workflow snapshot removes the dirty recovery item.

## Risks

| Risk                                   | Impact                                               | Mitigation                                                           |
| -------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------- |
| Apply can overwrite current editor UI  | User may lose unsaved in-memory text                 | Apply is explicit and keeps result unsaved until the user saves      |
| Recovery file remains after discard    | `history/recovery/` grows                            | This follows DATA_SCHEMA.md: recovery is protected, not cache        |
| Only inline chapter recovery supported | Some future recovery records cannot be previewed yet | Unsupported records return typed errors and remain available on disk |

## Acceptance

- Dirty recovery notice shows preview/apply/discard actions.
- Preview displays recovered chapter body.
- Apply places recovered text in the chapter editor and marks it unsaved.
- Save after apply persists the recovered chapter body.
- Discard removes the dirty recovery item by writing `dirty: false`.
- IPC channels remain allowlisted Application commands.
- E2E covers recovery record on disk through preview/apply/save.

## Changelog

- v1.0 - Initial M49 recovery review slice.
