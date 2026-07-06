# M78-M80 Runtime, Isolation, and Layout Design

Version: 1.0 | Status: Accepted for M78-M80 | Date: 2026-07-06

## Scope

M78-M80 closes the next three roadmap items after M75-M77:

- M78 adds real CodeMirror DOM view lifecycle metadata and an explicit mount path behind the existing renderer editor runtime adapter.
- M79 adds a deterministic isolated worker prototype for plugin contributions, preserving denied-by-default policy.
- M80 adds workflow graph layout positions and layout-draft update helpers for Workflow Studio.

## Architecture

Editor runtime remains a renderer-only adapter boundary. The CodeMirror adapter may use `@codemirror/view` when an explicit DOM element is provided, but it still exposes only `EditorRuntimeHandle` and `EditorRuntimeSnapshot` to the rest of the renderer.

Plugin isolation stays in the Application layer as an injected adapter. The prototype creates a worker execution plan and validates signing, denied capabilities, timeout, teardown, and structured JSON output before returning data to `PluginRuntimeSession`.

Workflow graph layout is a projection over workflow definitions. It records node positions and viewport metadata in the Studio bridge/UI props, not in Workflow Engine execution state.

## Data Flow

CodeMirror DOM:

`ChapterEditor` host element -> `EditorRuntimeMountInput.domMountElement` -> CodeMirror `EditorView` -> structured runtime events -> existing editor props.

Plugin isolation:

`PluginSettingsSnapshot` -> `createPluginSandboxIsolationPlan()` -> `createPluginIsolationWorkerPrototypeAdapter()` -> `PluginRuntimeSession` -> structured JSON output or `UnifiedError`.

Workflow layout:

`ConfigWorkflowGraphSnapshot` -> default layout projection -> UI drag/update event -> bridge draft layout -> `ConfigStudioPanel` render.

## Non-goals

- No default CodeMirror switch.
- No arbitrary third-party plugin source execution.
- No plugin marketplace, signing UI, or external process launcher.
- No workflow execution changes.
- No project file schema migration for graph layout in this batch.

## Test Strategy

- Renderer runtime tests verify CodeMirror DOM mounted/fallback snapshot states and event parity.
- Application plugin runtime tests verify executable signed fixture workers, blocked unsigned workers, timeout teardown, and payload validation.
- UI and Studio bridge tests verify graph layout positions, layout edits, and save-gate preservation.
