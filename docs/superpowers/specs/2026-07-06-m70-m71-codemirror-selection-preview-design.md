# M70-M71 CodeMirror Parity and Selection Preview Design

## Scope

M70 and M71 continue the editor runtime line:

- M70 introduces a real CodeMirror 6 headless state package behind the flagged adapter and keeps textarea as the default fallback.
- M71 adds selection-aware AI preview DTOs and UI controls that produce preview-only diff data. No generated content is applied automatically.

## Architecture

The renderer editor runtime remains the boundary for concrete editor adapters. The CodeMirror adapter may use `@codemirror/state` to manage document and selection state, but it must still expose the existing `EditorRuntimeAdapter` contract and emit structured runtime events. It cannot access storage, Electron, Repository, or model adapters.

Selection-aware preview remains preview-only. Runtime snapshots provide normalized selection metadata, `createEditorSelectionCommand()` creates a structured command DTO, and `createSelectionAwareAiPreviewDraft()` builds a bounded diff preview from explicit proposed text. The UI can render a selection preview command button, but applying the diff still requires the existing explicit apply path in later milestones.

## Data Flow

CodeMirror parity:

`resolveEditorRuntimeAdapter({ preferredRuntimeId: "codemirror", codeMirrorEnabled: true })` -> CodeMirror headless adapter -> `EditorRuntimeSnapshot` -> existing runtime props.

Selection preview:

`EditorRuntimeSnapshot.selectionSummary` -> `EditorSelectionCommand` -> proposed replacement text -> `ChapterEditorDiffPreview` -> existing preview-only diff panel.

## Non-goals

- CodeMirror is not the default editor.
- No DOM-mounted CodeMirror view.
- No direct model invocation from renderer runtime.
- No automatic selection replacement.
- No persistence or Repository writes from selection preview.

## Testing

- Editor runtime tests verify the CodeMirror adapter is package-backed and remains event-compatible with textarea behavior.
- Runtime tests verify selection-aware preview drafts are blocked for collapsed selections and create preview-only replacement diffs for selected ranges.
- UI tests verify a selection preview command renders as an explicit button and remains callback-driven.

## Changelog

- v1.0: Initial M70-M71 design.
