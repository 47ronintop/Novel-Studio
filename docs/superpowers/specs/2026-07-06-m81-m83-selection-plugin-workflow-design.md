# M81-M83 Selection, Plugin Trust, and Workflow Interaction Design

Version: 1.0 | Status: Accepted for M81-M83 | Date: 2026-07-06

## Scope

M81-M83 continues the productization route:

- M81 adds a small review contract for selection AI previews: compare labels, accept, reject, and local undo state.
- M82 adds plugin trust and permission visibility in settings from existing sandbox/signing policy projections.
- M83 promotes workflow graph layout edits from local UI movement into a persisted workflow draft field.

## Architecture

Selection review state stays in the renderer bridge and UI props. Application still owns the actual apply action and chapter history snapshot, so the renderer never mutates project truth directly.

Plugin trust UI is derived from `PluginSettingsSnapshot` plus Application plugin sandbox helpers. Settings bridge maps that data into UI props; the UI renders status and audit rows only.

Workflow layout is a Studio draft concern. Application supplies graph/layout projection helpers, the renderer bridge applies layout edits to the selected workflow draft JSON, and saving continues through `studio.saveConfigAsset()`.

## Data Flow

Selection review:

`generateSelectionPreview()` -> `AiWritingWorkflowBridge` review props -> UI compare/reject/accept -> `applySelectionPreview()` or local reject/undo state.

Plugin trust:

`plugins.loadRegistry()` -> `createPluginSandboxIsolationPlan()` and policy report -> settings bridge plugin review props -> settings UI.

Workflow layout:

`ConfigWorkflowGraphSnapshot` -> layout edit -> `applyConfigWorkflowGraphLayoutEdit()` -> workflow draft `layout` field -> normal Studio save path.

## Non-goals

- No full CodeMirror default migration.
- No arbitrary plugin source execution, marketplace, or installer.
- No workflow runtime semantic change.
- No new repository path for workflow layout in this batch.

## Test Strategy

- Application tests cover selection review DTOs, plugin audit projection, and workflow layout persistence helper.
- Renderer bridge tests cover reject/undo selection review state and workflow layout JSON persistence.
- UI tests cover selection review controls, plugin trust rows, and graph movement controls.
