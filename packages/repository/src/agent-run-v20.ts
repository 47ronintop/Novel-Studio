/**
 * Compatibility export for callers that historically imported the strict run contract from the
 * repository package. The contract and all semantic validators are owned by agent-engine; the
 * repository only persists validated pairs.
 */
export {
  AGENT_RUN_EVENT_SCHEMA_VERSION_V20,
  AGENT_RUN_SNAPSHOT_SCHEMA_VERSION_V20,
  parseAgentRunEventV20,
  parseAgentRunSnapshotV20,
  validateAgentRunEventV20,
  validateAgentRunHistoryV20,
  validateAgentRunSnapshotV20,
  validateAgentRunStatePairV20,
  validateAgentRunV20StartFacts
} from "@novel-studio/agent-engine";

export type {
  AgentRunAuthorityV20,
  AgentRunCapabilitiesV20,
  AgentRunCatalogV20,
  AgentRunEventTypeV20,
  AgentRunEventV20,
  AgentRunFinishV20,
  AgentRunPendingV20,
  AgentRunProtocolV20,
  AgentRunSnapshotV20,
  AgentRunStateCommitV20,
  AgentRunStatusV20,
  AgentRunV20StartFacts
} from "@novel-studio/agent-engine";
