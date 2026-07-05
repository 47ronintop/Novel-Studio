# M39 Timeline Workspace

Version: 1.0 | Status: Complete | Last Updated: 2026-07-05

## Goal

M39 upgrades the Timeline activity from a simple Story Bible entry list into an event-level workspace. The user should see ordered timeline events, chapter references, status grouping, and an edit path back to the Story Bible timeline asset without direct filesystem access.

## Scope

- Parse `timeline.events.details.events` from the existing Story Bible timeline asset.
- Render event-level timeline rows sorted by `sequence`.
- Show compact metrics for total events, linked chapters, and active/draft event counts.
- Keep edit navigation through the existing `onTimelineEntryOpen` callback.
- Preserve existing Story Bible save flow; M39 does not introduce drag-and-drop reorder or a new event-specific repository schema.

## Design Reason

The existing schema already permits structured timeline events inside `details.events`, and Repository/Application layers already preserve the `details` object. M39 therefore avoids a schema migration and focuses on making those structured events visible and usable in the workspace.

## Data Flow

Story Bible repository
→ StoryBibleSession snapshot
→ Renderer StoryBibleBridge parses `timeline.details.events`
→ `StoryBibleEditorEntry.timelineEvents`
→ WorkspaceShell Timeline activity
→ User opens timeline asset editor through existing Story Bible bridge

## Acceptance

- Timeline view renders individual events, not only the parent timeline asset.
- Events are sorted by numeric sequence.
- Event cards show title, status, sequence, summary, and linked chapter ids.
- The view has a visible edit action for the parent timeline asset.
- Tests cover renderer mapping and UI rendering.

## Non-Goals

- Drag-and-drop event ordering.
- Event-specific form editing.
- New timeline event JSON schema.
- Cross-chapter bidirectional navigation.

## Changelog

- v1.0 - Initial event-level timeline workspace slice.
