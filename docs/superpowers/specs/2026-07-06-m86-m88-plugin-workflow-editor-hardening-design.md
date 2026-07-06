# M86-M88 Plugin, Workflow, and Editor Hardening Design

Version: 1.0 | Status: Accepted for M86-M88 | Date: 2026-07-06

## Scope

M86 adds a plugin runtime hardening report that merges isolation runtime choice, signing trust policy, audit retention, denied capabilities, and marketplace readiness. It explains what is safe today and what remains blocked.

M87 adds workflow semantic editing helpers in the Application layer. These helpers can add a node, delete a node, retarget an edge, and update a branch edge while preserving JSON source of truth and graph validation.

M88 adds editor local diff review metadata. The runtime can derive a review with decorations, local acceptance/rollback labels, large-document smoke evidence, and fallback strategy without changing the default editor.

## Architecture

Plugin hardening remains in `plugin-runtime-session.ts`, using existing `PluginSettingsSnapshot` and isolation plan inputs. The report is deterministic, local, and UI-safe.

Workflow semantic editing remains in `config-studio-session.ts`. It parses workflow JSON, edits structured workflow steps, rebuilds graph/layout projections, and returns a draft JSON object through the existing Studio save path.

Editor local diff review remains in the renderer runtime module and UI props. The runtime produces preview-only metadata and warning/fallback labels. The UI renders compact review status and does not apply generated content automatically.

## Data Flow

Plugin:

`PluginSettingsSnapshot` -> isolation plan -> hardening report -> Settings/roadmap visibility.

Workflow:

`WorkflowDefinition JSON` -> semantic edit -> validation -> `ConfigWorkflowGraphSnapshot` -> Studio draft JSON -> existing save/version path.

Editor:

`EditorRuntimeSnapshot + diff preview` -> local diff review -> `ChapterEditorRuntimeProps` -> Chapter Editor runtime strip.

## Decisions

- M86 uses a report-first hardening contract instead of enabling OS process execution.
- M87 handles semantic edits through Application helpers rather than direct UI mutation.
- M88 keeps local diff review as metadata and UI state; acceptance still requires explicit existing apply paths.

## Non-goals

- No real marketplace installation, download, or trust store persistence.
- No arbitrary plugin source execution.
- No complete graph editor with all edge/node creation UX.
- No CodeMirror default switch.
- No automatic application of AI diff content.

## Test Strategy

- Application tests cover plugin hardening report and workflow semantic edits.
- Renderer tests cover editor local diff review and large-document smoke metadata.
- UI tests cover local diff review rendering in the editor runtime strip.
