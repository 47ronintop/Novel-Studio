/**
 * Main-owned feature flags for the Agent capabilities that remain in product scope.
 * The renderer only reads the resolved effective state.
 */

export interface AgentFeatureFlags {
  /** Phase A: search_project_text + find_project_references */
  readonly phaseA_searchEnabled: boolean;
  /** Phase B: file lifecycle (create/move/delete/mkdir) + Change Set v1.1 */
  readonly phaseB_fileLifecycleEnabled: boolean;
  /** Phase D: web_search + fetch_url */
  readonly phaseD_networkReadEnabled: boolean;
  /** Phase E: remote MCP (requires phaseD network gate) */
  readonly phaseE_remoteMcpEnabled: boolean;
  /**
   * Monotonically-increasing revision string.
   * Must change when any flag changes so Permission Summary drift detection catches it.
   */
  readonly revision: string;
}

/** Default flags keep every optional capability off. */
export const DEFAULT_AGENT_FEATURE_FLAGS: AgentFeatureFlags = Object.freeze<AgentFeatureFlags>({
  phaseA_searchEnabled: false,
  phaseB_fileLifecycleEnabled: false,
  phaseD_networkReadEnabled: false,
  phaseE_remoteMcpEnabled: false,
  revision: "v1.0-default"
});

export function createAgentFeatureFlags(overrides?: Partial<AgentFeatureFlags>): AgentFeatureFlags {
  if (overrides === undefined) return DEFAULT_AGENT_FEATURE_FLAGS;
  const merged = { ...DEFAULT_AGENT_FEATURE_FLAGS, ...overrides };
  const flags: AgentFeatureFlags = {
    ...merged,
    phaseE_remoteMcpEnabled: merged.phaseE_remoteMcpEnabled && merged.phaseD_networkReadEnabled
  };
  return Object.freeze(flags);
}
