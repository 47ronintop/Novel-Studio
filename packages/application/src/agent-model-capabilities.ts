import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

export interface AgentModelCapabilityDeclaration {
  readonly streaming?: boolean;
  readonly toolCalling?: boolean;
  readonly structuredArguments?: boolean;
  readonly contextWindow?: number;
}

export interface AgentModelCapabilityPreflightInput {
  readonly profileId: string;
  readonly provider: string;
  readonly modelName: string;
  readonly capabilities: AgentModelCapabilityDeclaration;
  readonly requiredContextTokens: number;
}

export interface AgentModelCapabilitySnapshot {
  readonly profileId: string;
  readonly provider: string;
  readonly modelName: string;
  readonly streaming: true;
  readonly toolCalling: true;
  readonly structuredArguments: true;
  readonly contextWindow: number;
  readonly requiredContextTokens: number;
}

export function preflightAgentModelCapabilities(
  input: AgentModelCapabilityPreflightInput
): Result<AgentModelCapabilitySnapshot, UnifiedError> {
  const missingCapabilities: string[] = [];
  if (input.capabilities.streaming !== true) {
    missingCapabilities.push("streaming");
  }
  if (input.capabilities.toolCalling !== true) {
    missingCapabilities.push("toolCalling");
  }
  if (input.capabilities.structuredArguments !== true) {
    missingCapabilities.push("structuredArguments");
  }
  const contextWindow = input.capabilities.contextWindow;
  if (
    contextWindow === undefined ||
    !Number.isFinite(contextWindow) ||
    contextWindow < input.requiredContextTokens
  ) {
    missingCapabilities.push("contextWindow");
  }

  if (missingCapabilities.length > 0 || contextWindow === undefined) {
    return err(
      createUnifiedError({
        code: "AGENT_MODEL_CAPABILITY_UNSUPPORTED",
        category: "UserError",
        message: "The selected provider/model cannot start an Agent run.",
        recoverability: "user-action",
        suggestedAction:
          "Choose a model that supports streaming, tool calls, structured arguments, and the required context window.",
        traceId: "agent-model-capability-preflight",
        redactedDetail: {
          profileId: input.profileId,
          provider: input.provider,
          modelName: input.modelName,
          missingCapabilities,
          requiredContextTokens: input.requiredContextTokens,
          availableContextTokens: contextWindow ?? 0
        }
      })
    );
  }

  return ok({
    profileId: input.profileId,
    provider: input.provider,
    modelName: input.modelName,
    streaming: true,
    toolCalling: true,
    structuredArguments: true,
    contextWindow,
    requiredContextTokens: input.requiredContextTokens
  });
}
