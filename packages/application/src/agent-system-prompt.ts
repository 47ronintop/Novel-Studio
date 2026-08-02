import type { AgentContextMode } from "@novel-studio/agent-engine";

import type { AgentContextProfile, AgentContextProfileId } from "./agent-context-profile.js";
import {
  HISTORICAL_AGENT_SYSTEM_GUIDANCE_VERSION,
  materializeHistoricalAgentGuidance
} from "./agent-guidance-registry.js";

export const AGENT_SYSTEM_GUIDANCE_VERSION = HISTORICAL_AGENT_SYSTEM_GUIDANCE_VERSION;

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

/** Compatibility alias for callers that have not yet migrated to an explicit profile. */
export function buildAgentSystemGuidance(contextMode: AgentContextMode): string {
  if (contextMode === "standalone_chat") return buildAgentSystemPrompt("standalone");
  return buildAgentSystemPrompt(contextMode === "writing" ? "writing" : "creative_general");
}
