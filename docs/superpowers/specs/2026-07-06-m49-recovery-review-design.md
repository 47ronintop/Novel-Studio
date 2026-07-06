# M49 Recovery Review Design

## Goal

M49 turns the M38 recovery notice into a user-controlled recovery review loop for chapter drafts. A user can preview a dirty recovery draft, apply it to the chapter editor, or dismiss it without deleting the underlying recovery file.

## Recommended Approach

Use the existing `history/recovery/<session-id>.json` source and add Application-level recovery commands. The UI remains callback-driven and never reads project files directly. Applying or discarding a draft writes a clean recovery marker for the same session id, preserving the recovery record as protected `history/` data while removing it from the dirty draft list.

## Scope

- Chapter recovery only. Prompt, Agent, and Workflow recovery records remain future work because the current product writes chapter dirty records only.
- Inline recovery content only. `file-ref` records are reported as unsupported instead of dereferencing arbitrary paths in the renderer.
- Preview shows chapter title, updated time, and recovered body text.
- Apply selects the chapter, loads the draft into the active chapter editor as an unsaved edit, and writes a clean marker for the recovery record.
- Discard writes a clean marker and refreshes project recovery state.
- No automatic merge, pruning, deletion, background timer, or stale-lock recovery.

## Architecture

`ProjectWorkspaceSession` owns the recovery operations because it already has the active project snapshot plus chapter and recovery repositories. It exposes:

- `previewRecoveryDraft(sessionId)`
- `applyRecoveryDraft(sessionId)`
- `discardRecoveryDraft(sessionId)`

Desktop Application, IPC, preload, and renderer bridge forward those commands through the established layered path. `WorkspaceShell` receives a `recovery.review` DTO and renders actions from callbacks only.

## Data Flow

Preview:

`WorkspaceShell action -> ProjectWorkflowBridge -> preload api.project.previewRecoveryDraft -> IPC -> DesktopApplication -> ProjectWorkspaceSession -> RecoveryRepository.listRecoveryRecords`

Apply:

`WorkspaceShell action -> ProjectWorkflowBridge -> preload api.project.applyRecoveryDraft -> IPC -> DesktopApplication -> ProjectWorkspaceSession -> ChapterEditorSession.edit(draft) -> RecoveryRepository.writeRecoveryRecord(dirty=false) -> refreshed ProjectWorkspaceSnapshot`

Discard:

`WorkspaceShell action -> ProjectWorkflowBridge -> preload api.project.discardRecoveryDraft -> IPC -> DesktopApplication -> ProjectWorkspaceSession -> RecoveryRepository.writeRecoveryRecord(dirty=false) -> refreshed ProjectWorkspaceSnapshot`

## Error Handling

- Unknown session id returns a `RECOVERY_DRAFT_NOT_FOUND` user error.
- Non-chapter records return `RECOVERY_DRAFT_UNSUPPORTED`.
- Missing inline content returns `RECOVERY_DRAFT_CONTENT_UNAVAILABLE`.
- Apply to a missing chapter reuses the existing `PROJECT_CHAPTER_NOT_FOUND` error path.
- Renderer converts failures into project workflow feedback instead of throwing through React.

## Tests

- Application test covers preview, apply, discard, refreshed dirty list, and clean marker writing.
- Bridge test verifies calls flow through `api.project.*` and feedback handles errors.
- UI test verifies recovery review actions are visible and callback-driven.
- IPC/security tests cover the new allowlisted channels.
- E2E test creates a dirty recovery record on disk, opens the project, previews it, applies it, saves, and confirms the chapter contains the recovered text.

## Future Extension

Later milestones can add side-by-side diff, file-ref dereferencing through Repository policy, retained recovery archive browsing, stale-lock recovery, user-configurable autosave intervals, and recovery support for Prompt/Agent/Workflow assets.

## Self Review

- No placeholders remain.
- The scope is chapter-only and does not conflict with the protected `history/` rule.
- The design keeps file effects behind Application/Repository and keeps UI callback-only.
