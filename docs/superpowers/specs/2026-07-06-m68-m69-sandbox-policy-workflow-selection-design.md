# M68-M69 Sandbox Policy and Workflow Selection Design

## Scope

M68 and M69 continue the M65-M67 productization line:

- M68 adds Plugin Sandbox Policy DTOs that evaluate `sandboxed-code` readiness, trust state, denied capabilities, timeout, and payload limits. The runtime remains denied by default and does not launch plugin code.
- M69 adds Workflow Studio node selection and a save validation gate. Selecting a graph node changes the inspector target, and invalid graph validation blocks the save callback before persistence.

## Architecture

Plugin sandbox policy stays in the Application layer near `PluginRuntimeSession`. It reads project plugin settings snapshots and returns structured, UI-safe `PluginSandboxPolicyDecision` DTOs. It never imports repository, Electron, filesystem, network, or model adapter modules.

Workflow node selection stays in renderer/UI state. `ConfigStudioPanel` receives `selectedWorkflowNodeId` and emits `onWorkflowNodeSelect`; `StudioBridge` stores the selected node id and preserves it through draft updates when the node still exists. Saves still go through the existing config asset save path, but `StudioBridge.beginSave()` and `save()` refuse invalid workflow graphs before calling preload.

## Data Flow

Sandbox policy:

`PluginSettingsSnapshot` -> `createPluginSandboxPolicyReport()` -> `PluginSandboxPolicyDecision[]` -> future Settings/Plugin UI.

Workflow selection:

`Workflow graph node button` -> `onWorkflowNodeSelect(nodeId)` -> `StudioBridge.selectWorkflowNode()` -> `ConfigStudioPanel.selectedWorkflowNodeId` -> inspector target.

Save gate:

`ConfigStudioPanel save` -> `StudioBridge.beginSave()` -> graph validation check -> blocked feedback or existing save API.

## Non-goals

- No sandbox worker process.
- No plugin signing verification implementation.
- No marketplace or remote plugin update.
- No graph drag/drop or layout persistence.
- No workflow execution from designer.

## Testing

- Plugin runtime tests cover denied-by-default sandbox decisions, trust state, capability denial, timeout, and payload defaults.
- Studio bridge tests cover node selection, selected node preservation, and save blocking for invalid workflow graphs.
- UI tests cover selectable graph nodes, selected-node inspector rendering, and disabled save state for invalid graphs.

## Changelog

- v1.0: Initial M68-M69 design.
