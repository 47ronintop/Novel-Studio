import type { EngineeringFileQualificationAttestationV1 } from "@novel-studio/agent-engine";

import {
  hasMainOwnedEngineeringFileQualification,
  mainOwnedEngineeringFileQualificationRevision
} from "./engineering-file-access-qualification.js";

/**
 * Main-owned feature flags for the Agent capabilities that remain in product scope.
 * The renderer only reads the resolved effective state.
 */

export interface AgentFeatureFlags {
  /** Guidance Registry/System Guidance 3.0; default off until its protocol dependencies ship. */
  readonly agentGuidanceV3: boolean;
  /** Phase A: search_project_text + find_project_references */
  readonly phaseA_searchEnabled: boolean;
  /** Phase B: file lifecycle (create/move/delete/mkdir) + Change Set v1.1 */
  readonly phaseB_fileLifecycleEnabled: boolean;
  /** Phase D: web_search + fetch_url */
  readonly phaseD_networkReadEnabled: boolean;
  /** Phase E: remote MCP (requires phaseD network gate) */
  readonly phaseE_remoteMcpEnabled: boolean;
  /** Root-handle engineering list/read/search/index; unavailable without Main-owned qualification. */
  readonly engineeringHardenedAccessV1: boolean;
  readonly engineeringReplaceV2: boolean;
  readonly engineeringCreateV2: boolean;
  readonly engineeringMoveV2: boolean;
  readonly engineeringDeleteV2: boolean;
  readonly engineeringDirectoryCreateV1: boolean;
  /**
   * Monotonically-increasing revision string.
   * Must change when any flag changes so Permission Summary drift detection catches it.
   */
  readonly revision: string;
}

/** Default flags keep every optional capability off. */
export const DEFAULT_AGENT_FEATURE_FLAGS: AgentFeatureFlags = Object.freeze<AgentFeatureFlags>({
  agentGuidanceV3: false,
  phaseA_searchEnabled: false,
  phaseB_fileLifecycleEnabled: false,
  phaseD_networkReadEnabled: false,
  phaseE_remoteMcpEnabled: false,
  engineeringHardenedAccessV1: false,
  engineeringReplaceV2: false,
  engineeringCreateV2: false,
  engineeringMoveV2: false,
  engineeringDeleteV2: false,
  engineeringDirectoryCreateV1: false,
  revision: "v1.0-default"
});

export function createAgentFeatureFlags(
  overrides?: Partial<AgentFeatureFlags>,
  engineeringQualification?: EngineeringFileQualificationAttestationV1
): AgentFeatureFlags {
  if (overrides === undefined) return DEFAULT_AGENT_FEATURE_FLAGS;
  const merged = { ...DEFAULT_AGENT_FEATURE_FLAGS, ...overrides };
  const engineeringRequested =
    merged.engineeringHardenedAccessV1 ||
    merged.engineeringReplaceV2 ||
    merged.engineeringCreateV2 ||
    merged.engineeringMoveV2 ||
    merged.engineeringDeleteV2 ||
    merged.engineeringDirectoryCreateV1;
  const accessEnabled =
    merged.engineeringHardenedAccessV1 &&
    hasMainOwnedEngineeringFileQualification(engineeringQualification, "root") &&
    hasMainOwnedEngineeringFileQualification(engineeringQualification, "access");
  const mutationEnabled =
    accessEnabled && hasMainOwnedEngineeringFileQualification(engineeringQualification, "mutation");
  const recoveryEnabled =
    mutationEnabled &&
    hasMainOwnedEngineeringFileQualification(engineeringQualification, "recovery");
  const flags: AgentFeatureFlags = {
    ...merged,
    phaseE_remoteMcpEnabled: merged.phaseE_remoteMcpEnabled && merged.phaseD_networkReadEnabled,
    engineeringHardenedAccessV1: accessEnabled,
    engineeringReplaceV2: merged.engineeringReplaceV2 && mutationEnabled,
    engineeringCreateV2: merged.engineeringCreateV2 && mutationEnabled,
    engineeringMoveV2: merged.engineeringMoveV2 && mutationEnabled,
    engineeringDeleteV2: merged.engineeringDeleteV2 && recoveryEnabled,
    engineeringDirectoryCreateV1: merged.engineeringDirectoryCreateV1 && mutationEnabled,
    revision: engineeringRequested
      ? `${merged.revision}:engineering-native:${mainOwnedEngineeringFileQualificationRevision(
          engineeringQualification
        )}`
      : merged.revision
  };
  return Object.freeze(flags);
}
