# M40-M41 Implementation Plan

**Goal:** Add Project Health diagnostics and Command Palette interaction polish.

## Task 1: Project Health DTO

- [x] Add failing Application tests for health diagnostics.
- [x] Add `ProjectWorkspaceHealth` types.
- [x] Build deterministic health summary in `ProjectWorkspaceSession`.
- [x] Pass health through renderer `ProjectWorkflowBridge`.

## Task 2: Problems Panel UI

- [x] Add failing UI test for health summary and issue rows.
- [x] Render Project Health in the Problems bottom panel.
- [x] Style health rows with dense, readable severity markers.

## Task 3: Command Palette UX

- [x] Add failing UI tests for filtering, grouping, keyboard selection, and feedback.
- [x] Implement query filtering and grouped safe command rendering.
- [x] Implement ArrowUp/ArrowDown/Enter behavior.
- [x] Keep execution errors visible in the renderer app.

## Task 4: Documentation and Gates

- [x] Update `ROADMAP.md`, `INDEX.md`, `CHANGELOG.md`, and `TECH_DEBT.md`.
- [x] Run focused tests.
- [x] Run full verification gates.
