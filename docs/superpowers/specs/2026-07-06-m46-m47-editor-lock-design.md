# M46/M47 Editor Hardening and Multi-window Safety Design Spec

## Scope

M46 adds observable editor hardening signals without replacing the current textarea editor. M47 adds a project lock boundary so concurrent windows can detect an already-open project before writing.

## M46 Design

The chapter editor reports document metrics, large-document mode, and a compact diff summary. Large-document mode is a UI safety signal: it avoids rendering unbounded line-number DOM and shows line/word/character counts so future CodeMirror work has a stable product contract.

Renderer shortcuts gain a conflict scanner over command shortcut declarations. It normalizes shortcuts such as `Ctrl/Cmd+K`, detects duplicated shortcuts, and exposes a matrix that tests can assert. This closes the current shortcut-conflict audit gap without making shortcuts user-editable yet.

## M47 Design

Project locking is introduced as a Repository/Application boundary. `ProjectWorkspaceSession` receives an optional lock repository factory and owner id. Opening or creating a project acquires a lock before activating the workspace. A conflicting lock returns a structured error and leaves the current workspace unchanged.

The file-backed lock repository writes a human-readable `.novel-studio/project-lock.json` lock record. It uses exclusive file creation for acquisition and only releases locks owned by the current owner id. This is a local-first guardrail, not cloud collaboration.

Desktop shutdown calls the Application release path so normal window/app close does not leave a project lock behind. Crash and stale-lock recovery remain explicit future UI work.

## Non-Goals

- Replacing textarea with CodeMirror.
- Full diff editor or merge UI.
- Real multi-window orchestration beyond project-level lock detection.
- Cross-machine lock arbitration.

## Risks

- Stale locks can block a project after a crash. The M47 lock record includes timestamps and owner id so a later recovery UI can make stale-lock decisions explicitly.
- Large-document mode is a safety signal, not a full virtualization engine. It reduces DOM pressure from line numbers but does not solve all large-file editing performance issues.

## Changelog

- v1.0 - Initial combined M46/M47 design.
