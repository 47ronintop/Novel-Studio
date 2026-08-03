import type { AgentContextMode } from "@novel-studio/agent-engine";

import type { AgentContextProfile, AgentContextProfileId } from "./agent-context-profile.js";
import {
  CURRENT_AGENT_SYSTEM_GUIDANCE_VERSION,
  HISTORICAL_AGENT_SYSTEM_GUIDANCE_VERSION,
  materializeCurrentAgentGuidance,
  materializeHistoricalAgentGuidance
} from "./agent-guidance-registry.js";
import type {
  MaterializedAgentGuidanceV3,
  RegisteredGuidanceBuildInputV3
} from "./agent-guidance-registry.js";

/** Legacy live-pipeline version. It stays 2.1 until the v2 protocol atomic group is enabled. */
export const AGENT_SYSTEM_GUIDANCE_VERSION = HISTORICAL_AGENT_SYSTEM_GUIDANCE_VERSION;
export const AGENT_SYSTEM_GUIDANCE_V3_VERSION = CURRENT_AGENT_SYSTEM_GUIDANCE_VERSION;

export interface AgentConventionsArtifactReference {
  readonly artifactId: string;
  readonly checksum: string;
}

export function buildAgentSystemPrompt(
  profile: AgentContextProfile | AgentContextProfileId,
  _options: { readonly conventionsArtifact?: AgentConventionsArtifactReference } = {}
): string {
  void _options;
  return materializeHistoricalAgentGuidance(profile, AGENT_SYSTEM_GUIDANCE_VERSION);
}

/** Build a new Guidance 3.0 authority from complete, already-frozen app-owned inputs. */
export function buildAgentSystemPromptV3(input: RegisteredGuidanceBuildInputV3): string {
  return materializeAgentSystemPromptV3(input).materializedGuidance;
}

/** Return both the exact authority text and the registry proof persisted by Prompt Artifact 2.0. */
export function materializeAgentSystemPromptV3(
  input: RegisteredGuidanceBuildInputV3
): MaterializedAgentGuidanceV3 {
  return materializeCurrentAgentGuidance(input);
}

/** Compatibility alias for callers that have not yet migrated to an explicit profile. */
export function buildAgentSystemGuidance(contextMode: AgentContextMode): string {
  if (contextMode === "standalone_chat") return buildAgentSystemPrompt("standalone");
  return buildAgentSystemPrompt(contextMode === "writing" ? "writing" : "creative_general");
}
