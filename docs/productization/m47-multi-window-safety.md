# M47 Multi-window Safety

Version: 1.0 | Status: Complete | Last Updated: 2026-07-06

## Goal

M47 adds a local project lock boundary so two local owners cannot activate the same project workspace without an explicit conflict. This addresses the first practical multi-window safety gap while preserving the local-first project folder model.

## Scope

- Add a file-backed Repository lock at `.novel-studio/project-lock.json`.
- Acquire the project lock before Application workspace activation for open/create flows.
- Preserve the current workspace when opening another project fails due to lock conflict.
- Expose lock summary in the Application workspace snapshot.
- Add Project Health signal for active local locks.
- Compose desktop sessions with a per-process lock owner id.
- Release the active project lock during normal DesktopApplication shutdown.

## Non-Goals

- Cloud collaboration.
- Real-time multi-window shared editing.
- Stale-lock recovery UI.
- Cross-machine distributed locking.
- Automatic merge/conflict resolution for chapter edits.

## Data Flow

Desktop application composition
-> lock owner id
-> Application project open/create
-> Repository lock acquire
-> workspace activation with lock summary
-> Project Health lock issue

On conflict:

Repository lock conflict
-> Application `PROJECT_LOCK_CONFLICT`
-> previous workspace remains active
-> UI can surface the structured error without touching files directly

## Acceptance

- Lock acquisition uses exclusive file creation.
- Conflicting owners receive `PROJECT_LOCK_CONFLICT`.
- Non-owner release receives `PROJECT_LOCK_OWNER_MISMATCH`.
- Application acquires locks before activation and keeps the previous workspace on conflict.
- Desktop composition injects the lock repository through the Application boundary.
- Normal Electron shutdown releases the active local project lock.

## Changelog

- v1.0 - Completed local project lock repository and Application lock activation boundary.
