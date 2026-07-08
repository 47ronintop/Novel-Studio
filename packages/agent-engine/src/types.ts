import type { ContextBundle } from "@novel-studio/context-engine";
import type {
  LlmAdapter,
  LlmProviderId,
  LlmProviderWarning,
  LlmRequest,
  LlmUsage
} from "@novel-studio/llm-adapter";
import type { JsonObject } from "@novel-studio/shared";

export type AgentStatus = "active" | "draft" | "archived" | "deleted";

export interface AgentConfig {
  readonly schemaVersion: "1.0";
  readonly id: string;
  readonly type: "agent.config";
  readonly title: string;
  readonly status: AgentStatus;
  readonly agentRole: string;
  readonly promptTemplateId: string;
  readonly inputSchemaId: string;
  readonly outputSchemaId: string;
  readonly modelProfileId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AgentSchemaValidationInput {
  readonly schemaId: string;
  readonly value: JsonObject;
  readonly traceId: string;
}

export interface AgentSchemaValidationResult {
  readonly valid: boolean;
  readonly redactedDetail?: JsonObject;
}

export type AgentSchemaValidator = (
  input: AgentSchemaValidationInput
) => AgentSchemaValidationResult;

export interface AgentRunInput {
  readonly schemaVersion: "1.0";
  readonly agentRunId: string;
  readonly handoffId: string;
  readonly workflowRunId: string;
  readonly traceId: string;
  readonly agent: AgentConfig;
  readonly toAgentId: string;
  readonly input: JsonObject;
  readonly contextBundle: ContextBundle;
  readonly llmRequest: LlmRequest;
  readonly llmAdapter: LlmAdapter;
  readonly validateSchema: AgentSchemaValidator;
  readonly now: () => string;
}

export interface AgentHandoff {
  readonly schemaVersion: "1.0";
  readonly handoffId: string;
  readonly fromAgentId: string;
  readonly toAgentId: string;
  readonly workflowRunId: string;
  readonly payloadType: string;
  readonly payload: JsonObject;
  readonly model: {
    readonly provider: LlmProviderId;
    readonly modelName: string;
  };
  readonly usage: LlmUsage;
  readonly warnings?: readonly LlmProviderWarning[];
  readonly createdAt: string;
}
