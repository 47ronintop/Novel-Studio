# M65-M67 Sandbox, Workflow Inspector Editing, and Visual Diff Design

## Scope

M65-M67 advances three post-M18 productization gaps without widening runtime authority:

- M65 records the Plugin Runtime Sandbox RFC for future `sandboxed-code` execution, signing, permission prompts, timeout teardown, and denied-by-default network/filesystem access.
- M66 adds a structured Workflow Studio node inspector edit path that updates workflow JSON drafts and validation state through renderer/Application-facing DTOs, not direct storage calls.
- M67 adds preview-only editor visual diff runtime metadata for future CodeMirror decorations while keeping AI suggestions non-mutating until explicit user confirmation.

## Architecture

The implementation keeps P8 layering intact. Plugin sandbox work is document-first only. Workflow inspector edits are represented as structured `WorkflowNodeInspectorEdit` DTOs and applied to parsed workflow definitions by the workflow-engine package; the renderer bridge uses the helper to update the current JSON draft and graph snapshot. The UI receives callback-driven props and never reads or writes workflow files.

Editor visual diff runtime work lives in the renderer runtime adapter boundary. It derives bounded, preview-only decoration metadata from the current editor body plus existing diff preview props. The UI only receives a summary label in `ChapterEditorRuntimeProps`; no adapter applies text.

## Tradeoffs

This path deliberately avoids building a full graph editor or sandbox runtime in one step. The benefit is a narrow, testable slice that improves visible product capability while preserving local-first safety. The cost is that node selection remains entry-node/default-node based and visual diff decorations are metadata, not full CodeMirror inline rendering yet.

## Data Flow

Workflow inspector edit:

`ConfigStudioPanel` -> `onWorkflowNodeEdit` DTO -> `StudioBridge.applyWorkflowNodeEdit()` -> `workflow-engine.applyWorkflowNodeInspectorEdit()` -> updated JSON draft -> graph projection/validation -> existing save path.

Visual diff:

`ChapterEditorProps.diffPreview` -> `createTextareaChapterEditorRuntimeProps()` -> `EditorVisualDiffReview` -> `ChapterEditorRuntimeProps.visualDiffSummaryLabel` -> runtime status strip.

## Non-goals

- No arbitrary plugin code execution.
- No plugin marketplace, remote update, or webview sandbox.
- No workflow graph drag/drop or persisted layout.
- No automatic AI diff apply.
- No real CodeMirror package default switch.

## Testing

- Workflow-engine tests cover structured inspector edits and missing node validation.
- Studio bridge tests cover JSON draft mutation, graph refresh, and save path preservation.
- UI tests cover editable inspector controls and validation messaging.
- Editor runtime tests cover preview-only visual diff review metadata and runtime labels.

## Changelog

- v1.0: Initial M65-M67 design.
