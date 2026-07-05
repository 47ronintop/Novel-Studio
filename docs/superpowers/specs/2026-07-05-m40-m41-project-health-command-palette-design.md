# M40-M41 Design Spec

## Decision

Implement M40 and M41 as one adjacent productization batch with two separate contracts:

- M40: `ProjectWorkspaceSnapshot.health` is a read-only Application DTO.
- M41: `CommandPalette` owns keyboard interaction and receives execution feedback from the renderer app.

## M40 Contract

`ProjectWorkspaceHealth` contains:

- `status`: `healthy | attention | blocked`
- `checkedAt`
- `summary`: counts by severity
- `issues`: stable issue rows with `id`, `severity`, `source`, `title`, `message`, `suggestedAction`

The first slice produces deterministic diagnostics from data already loaded by the workspace session:

- Schema success is reported after project open/create succeeds.
- Cache is reported as rebuildable and safe to clear.
- History is reported as protected.
- Dirty recovery records produce a warning.
- Recovery records pointing to missing chapter ids produce a reference error.

## M41 Contract

`CommandPalette` filters safe commands by normalized query against id, title, scope, and shortcut. It renders grouped command sections and supports:

- input query changes
- ArrowDown/ArrowUp active selection
- Enter execution of active command
- feedback message rendering for failed command execution

## Risks

- Project Health can look more complete than it is. The UI must describe it as a current diagnostic slice, not a full integrity scanner.
- Command Palette should not execute unsafe commands until confirmation flows exist.

## Changelog

- v1.0 - Initial design spec for M40/M41.
