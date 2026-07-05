# M40-M41 Project Health and Command Palette

Version: 1.0 | Status: Complete | Last Updated: 2026-07-05

## Goal

M40 turns the bottom Problems panel into a real Project Health surface backed by Application-layer diagnostics. M41 upgrades Command Palette from a clickable command list into a keyboard-first command surface with filtering, grouping, active selection, and execution feedback.

## Scope

- Add a structured `ProjectWorkspaceHealth` DTO to the project workspace snapshot.
- Show schema/cache/history/recovery/reference health entries in the Problems bottom panel.
- Keep health diagnostics read-only; M40 does not mutate project files.
- Add Command Palette query filtering across command title, id, scope, and shortcut.
- Group commands by scope and keep only safe commands visible.
- Support ArrowUp/ArrowDown/Enter keyboard execution.
- Show command execution errors instead of silently closing the palette.

## Design Reason

`PROJECT_CONSTITUTION.md` P8 requires side effects and project data access to stay behind Application/Repository boundaries. Project Health therefore comes from Application DTOs, not renderer filesystem scans. `UI_GUIDELINES.md` section 6.3 requires Command Palette to be a keyboard-first entry point; M41 adds the missing interaction model without expanding command risk.

## Data Flow

Project repositories
-> `ProjectWorkspaceSession`
-> `ProjectWorkspaceSnapshot.health`
-> renderer `ProjectWorkflowBridge`
-> `WorkspaceShell` Problems bottom panel

Application commands
-> renderer `CommandExecutionBridge`
-> `CommandPalette`
-> safe command execution
-> shell state or feedback

## Acceptance

- Problems panel renders structured health summary and issue rows.
- Recovery records and missing recovery chapter references are represented as health issues.
- Command Palette filters commands by query.
- Command Palette groups commands by scope.
- Arrow keys move the active command and Enter executes it.
- Command execution failure remains visible in the palette.

## Non-Goals

- Full repository-wide reference graph validation.
- Automatic repair actions for health issues.
- Destructive or confirmation-required command execution.
- User-editable shortcut registry.

## Changelog

- v1.0 - Initial combined M40/M41 productization slice.
