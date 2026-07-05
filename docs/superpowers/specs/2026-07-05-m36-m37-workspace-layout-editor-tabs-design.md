# M36-M37 Workspace Layout and Editor Tabs Design

Date: 2026-07-05

Status: Accepted for M36/M37

## Problem

M35 identified Workspace Layout and Editor Tabs as the top product gaps. The current shell has fixed panels and chapter tabs derived directly from the full chapter list. That makes every chapter look open, gives users no close affordance, and does not satisfy the constitution's Split View and multi-tab expectations.

## Design

Add a minimal shell-owned layout model to `DesktopShellState`:

- split view enabled/disabled
- navigator width
- inspector width
- bottom panel height

Add safe commands for toggling Split View and resizing side panels. These commands stay in the Application layer and return a new shell state through the existing command execution bridge.

For tabs, keep persistence runtime-only in the renderer project workflow bridge. The bridge tracks open chapter ids, adds chapters on open/create/select, exposes open tab ids to UI, and closes tabs without touching files. Closing the active tab selects a nearby remaining tab through the existing project selection API.

## Scope Boundaries

This is not a full dock framework. It does not add drag reordering, cross-asset tabs, dirty conflict dialogs, disk persistence, or multi-window sync. It creates the stable state and UI affordances needed for those later milestones.

## Testing

Use TDD:

- Application tests for shell layout defaults and safe layout commands.
- UI static rendering tests for split view markup, CSS variables, and closeable dirty tabs.
- Renderer bridge tests for open tab tracking and active tab close fallback.

## Acceptance Criteria

- M36/M37 docs exist and ROADMAP/INDEX/CHANGELOG are updated.
- `npm run test -- packages/application/test/desktop-application.test.ts packages/ui/test/workspace-shell.test.tsx apps/desktop/test/project-workflow-bridge.test.ts apps/desktop/test/command-execution-bridge.test.ts` passes.
- `npm run typecheck`, `npm run lint`, and `npm run format` pass.
