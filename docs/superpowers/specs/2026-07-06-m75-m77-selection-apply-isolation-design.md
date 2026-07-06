# M75-M77 Selection Apply and Isolation Design

## Scope

M75-M77 completes the next editor/AI/plugin runtime slice:

- M75 wires textarea selection events into renderer editor runtime metadata and the selection AI preview command.
- M76 stores Application-generated selection previews and applies them only after explicit user confirmation.
- M77 adds a plugin sandbox isolation plan DTO for worker/process readiness without executing untrusted code.

## Architecture

The UI selection path stays renderer-only until the user asks for AI. `ChapterEditor` emits `{ anchor, head }` from real textarea selection events. `App` stores that selection next to the active chapter, builds `EditorRuntimeSnapshot`, and calls `AiWritingWorkflowBridge.generateSelectionPreview()` only from the runtime command button.

The selection preview generation and apply path remains Application-owned. `AiWritingWorkflowSession.generateSelectionPreview()` uses Agent/LLM Adapter and stores a preview by id. `applySelectionPreview()` confirms that stored preview and calls a chapter editor AI edit path. This changes the active editor draft and recovery record, but does not save the chapter file.

Plugin isolation remains a contract, not execution. The new plan describes intended runtime kind, denied capabilities, timeout, payload, teardown, and signing requirements so UI/tests can reason about readiness before real isolation is implemented.

## Data Flow

Selection wiring:

`textarea selection event` -> `ChapterEditor.onSelectionChange` -> `App selection state` -> `EditorRuntimeSnapshot.selectionSummary` -> runtime command button.

Selection preview apply:

`EditorSelectionCommand` -> `AiWritingWorkflowBridge.generateSelectionPreview()` -> Application IPC -> `AiWritingWorkflowSession.generateSelectionPreview()` -> stored preview -> `applySelectionPreview(previewId)` -> `ChapterEditorSession.applyAiEdit()`.

Plugin isolation:

`PluginSettingsSnapshot` -> `createPluginSandboxIsolationPlan()` -> UI-safe plan DTO, no plugin execution.

## Non-goals

- No default CodeMirror replacement.
- No renderer-side model or repository calls.
- No automatic selection rewrite apply.
- No saved-file mutation until the normal chapter save command.
- No real third-party plugin execution, process spawn, network grant, or marketplace integration.

## Testing

- UI tests verify textarea selection callback and runtime preview button visibility.
- Renderer tests verify App/bridge selection preview flow remains preview-only until apply.
- Application tests verify stored selection preview apply changes the editor draft and records before-AI snapshot when history is available.
- Plugin runtime tests verify isolation plan DTO denies execution while documenting worker/process requirements.

## Changelog

- v1.0: Initial M75-M77 design.
