/**
 * Task 0.1 — Per-phase feature flags for the Agent tool completion (7-23 design).
 * Main owns and persists these; renderer only reads the resolved effective state.
 * All Phase A–E flags default to false so existing 9-tool behaviour is unchanged.
 */

export interface AgentFeatureFlags {
  /** Phase A: search_project_text + find_project_references */
  readonly phaseA_searchEnabled: boolean;
  /** Phase B: file lifecycle (create/move/delete/mkdir) + Change Set v1.1 */
  readonly phaseB_fileLifecycleEnabled: boolean;
  /**
   * Phase C gate: Windows native sandbox qualification.
   * Must be verified before run_project_task or Phase E local tools can be registered.
   */
  readonly phaseC_sandboxQualified: boolean;
  /** Phase C product: run_project_task (requires phaseC_sandboxQualified) */
  readonly phaseC_controlledExecutionEnabled: boolean;
  /** Phase C Git: git_status + git_diff (requires phaseC_sandboxQualified) */
  readonly phaseC_gitReadEnabled: boolean;
  /** Phase D: web_search + fetch_url */
  readonly phaseD_networkReadEnabled: boolean;
  /** Phase E: plugin tools (requires phaseC_sandboxQualified) */
  readonly phaseE_pluginToolsEnabled: boolean;
  /** Phase E: local stdio MCP (requires phaseC_sandboxQualified) */
  readonly phaseE_localMcpEnabled: boolean;
  /** Phase E: remote MCP (requires phaseD network gate) */
  readonly phaseE_remoteMcpEnabled: boolean;
  /**
   * Monotonically-increasing revision string.
   * Must change when any flag changes so Permission Summary drift detection catches it.
   */
  readonly revision: string;
}

/** Default flags — all Phase A–E capabilities off; existing 9-tool behaviour preserved. */
export const DEFAULT_AGENT_FEATURE_FLAGS: AgentFeatureFlags = Object.freeze<AgentFeatureFlags>({
  phaseA_searchEnabled: false,
  phaseB_fileLifecycleEnabled: false,
  phaseC_sandboxQualified: false,
  phaseC_controlledExecutionEnabled: false,
  phaseC_gitReadEnabled: false,
  phaseD_networkReadEnabled: false,
  phaseE_pluginToolsEnabled: false,
  phaseE_localMcpEnabled: false,
  phaseE_remoteMcpEnabled: false,
  revision: "v1.0-default"
});

export function createAgentFeatureFlags(
  overrides?: Partial<AgentFeatureFlags>
): AgentFeatureFlags {
  if (overrides === undefined) return DEFAULT_AGENT_FEATURE_FLAGS;
  const merged = { ...DEFAULT_AGENT_FEATURE_FLAGS, ...overrides };
  // Enforce dependency constraints: C product requires C gate; E local/plugin require C gate;
  // E remote requires D.
  const flags: AgentFeatureFlags = {
    ...merged,
    phaseC_controlledExecutionEnabled:
      merged.phaseC_controlledExecutionEnabled && merged.phaseC_sandboxQualified,
    phaseC_gitReadEnabled: merged.phaseC_gitReadEnabled && merged.phaseC_sandboxQualified,
    phaseE_pluginToolsEnabled:
      merged.phaseE_pluginToolsEnabled && merged.phaseC_sandboxQualified,
    phaseE_localMcpEnabled:
      merged.phaseE_localMcpEnabled && merged.phaseC_sandboxQualified,
    phaseE_remoteMcpEnabled:
      merged.phaseE_remoteMcpEnabled && merged.phaseD_networkReadEnabled
  };
  return Object.freeze(flags);
}
