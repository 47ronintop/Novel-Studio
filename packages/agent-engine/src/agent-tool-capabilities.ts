/**
 * Task 0.1 — server-generated capability snapshot that gates which tools are visible in a run.
 * Main builds this from the qualification store and feature-flag state; renderer/model/project
 * content cannot construct or modify it.
 */

export type AgentWorkspaceKind = "creativeProject" | "engineeringWorkspace";

/**
 * Snapshot of which tool categories are currently available in this workspace + session.
 * All Phase flags default to false; Phase 0 (foundation) is implied by the presence of the object.
 * Attestation IDs are opaque references to Main's qualification store; callers never construct them.
 */
export interface AgentToolCapabilitySnapshot {
  /** Immutable once a run begins — workspace kind drives read-tool availability. */
  readonly workspaceKind: AgentWorkspaceKind;
  /** Phase A: search_project_text + find_project_references */
  readonly searchEnabled: boolean;
  /** Phase B: file create/move/delete/mkdir + Change Set v1.1 */
  readonly fileLifecycleEnabled: boolean;
  /** Phase C: run_project_task — only when sandbox attestation is verified. */
  readonly controlledExecutionEnabled: boolean;
  /** Opaque attestation ID from Main's qualification store; absent when C is off. */
  readonly sandboxAttestationId?: string;
  /** Phase C Git: git_status + git_diff. Requires same read-only sandbox attestation. */
  readonly gitReadEnabled: boolean;
  /** Phase D: web_search + fetch_url */
  readonly networkReadEnabled: boolean;
  /** Phase E: plugin/<pluginId>/<toolId> dynamic tools */
  readonly pluginToolsEnabled: boolean;
  /** Phase E: mcp:<serverId>/<toolId> dynamic tools */
  readonly mcpToolsEnabled: boolean;
  /**
   * Monotonically-increasing revision of the feature-flag snapshot used to build this object.
   * Changes when any flag flips; included in Permission Summary and drift detection.
   */
  readonly featureFlagRevision: string;
}

/** The minimum capability snapshot that reproduces Stage-5 v1.0 behaviour (9 static tools only). */
export function createDefaultCapabilitySnapshot(
  workspaceKind: AgentWorkspaceKind = "creativeProject"
): AgentToolCapabilitySnapshot {
  return Object.freeze<AgentToolCapabilitySnapshot>({
    workspaceKind,
    searchEnabled: false,
    fileLifecycleEnabled: false,
    controlledExecutionEnabled: false,
    gitReadEnabled: false,
    networkReadEnabled: false,
    pluginToolsEnabled: false,
    mcpToolsEnabled: false,
    featureFlagRevision: "v1.0-default"
  });
}
