# M84-M85 Workflow Canvas and Editor Readiness Design

Version: 1.0 | Status: Accepted for M84-M85 | Date: 2026-07-06

## Scope

M84 adds a real canvas-facing workflow designer contract without importing a full graph editor library. The UI must expose graph availability, node coordinates, selectable edges, and a structured node drag commit path.

M85 adds a default editor runtime readiness model. It must explain whether CodeMirror can become the recommended default, which blockers remain, and what fallback will be used.

## Architecture

Workflow canvas state is derived in Application from `ConfigWorkflowGraphSnapshot`. The DTO includes availability status, blocker messages, node/edge counts, and whether drag and edge selection are enabled. The renderer bridge owns transient selection state for nodes and edges, while draft layout persistence still goes through `applyConfigWorkflowGraphLayoutToContent()`.

Editor readiness stays in the renderer editor runtime module because the concrete adapter and DOM mount lifecycle are renderer-only. The evaluator accepts explicit evidence such as feature flag, DOM mount status, event parity, fallback availability, and large-document smoke status. It returns a structured decision for UI/tests without changing the default resolver.

## Data Flow

Workflow canvas:

`WorkflowDefinition JSON` -> `ConfigWorkflowGraphSnapshot` -> `createConfigWorkflowDesignerAvailability()` -> Studio bridge props -> canvas UI -> `commitWorkflowNodeDrag()` -> `applyConfigWorkflowGraphLayoutToContent()` -> workflow draft JSON.

Editor readiness:

`EditorRuntimeDefaultReadinessInput` -> `evaluateEditorRuntimeDefaultReadiness()` -> `EditorRuntimeDefaultReadinessDecision` -> resolver and status UI consumers.

## Decisions

- M84 implements structured drag commit instead of raw browser drag-and-drop. This keeps tests deterministic and preserves the renderer/Application boundary.
- M84 edge selection is read-only and inspection-oriented. Semantic edge edits continue through node fields until graph-to-definition editing is broader.
- M85 keeps `textarea` as the default recommendation when any blocker exists. CodeMirror is only recommended when feature flag, DOM mount, parity, fallback, and performance evidence all pass.

## Non-goals

- No full freeform graph editing library.
- No edge creation/deletion UI.
- No workflow execution from the designer.
- No automatic CodeMirror default switch.
- No migration of chapter storage or autosave semantics.

## Test Strategy

- Application tests cover workflow designer availability for valid, invalid, and missing-layout graphs.
- Renderer bridge tests cover edge selection and structured drag commit persistence.
- UI tests cover canvas coordinates, availability gate, selectable edges, and drag commit controls.
- Editor runtime tests cover readiness blockers, fallback policy, and the unchanged resolver default.
