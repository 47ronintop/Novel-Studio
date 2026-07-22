import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import type {
  ModelReasoningStrengthControl,
  ModelReasoningStrengthValue
} from "./model-discovery-session.js";

export interface AgentModelCapabilityDeclaration {
  readonly streaming?: boolean;
  readonly toolCalling?: boolean;
  readonly structuredArguments?: boolean;
  readonly contextWindow?: number;
}

export interface AgentModelCapabilityCatalogEntry extends AgentModelCapabilityDeclaration {
  readonly provider: string;
  readonly modelName: string;
  readonly streaming: true;
  readonly toolCalling: true;
  readonly structuredArguments: true;
  readonly contextWindow: number;
}

const AGENT_MODEL_CAPABILITY_CATALOG: readonly AgentModelCapabilityCatalogEntry[] = [
  {
    provider: "openai",
    modelName: "gpt-4.1",
    streaming: true,
    toolCalling: true,
    structuredArguments: true,
    contextWindow: 1_000_000
  },
  {
    provider: "anthropic",
    modelName: "claude-3-5-sonnet",
    streaming: true,
    toolCalling: true,
    structuredArguments: true,
    contextWindow: 200_000
  },
  {
    provider: "google-gemini",
    modelName: "gemini-1.5-pro",
    streaming: true,
    toolCalling: true,
    structuredArguments: true,
    contextWindow: 2_000_000
  },
  {
    provider: "deepseek",
    modelName: "deepseek-chat",
    streaming: true,
    toolCalling: true,
    structuredArguments: true,
    contextWindow: 64_000
  }
] as const;

/** Exact provider/model facts only; custom OpenAI-compatible endpoints never receive a fallback. */
export function resolveCatalogAgentModelCapabilities(
  provider: string,
  modelName: string
): AgentModelCapabilityCatalogEntry | undefined {
  const normalizedProvider = provider.trim().toLowerCase();
  const normalizedModel = modelName.trim().toLowerCase();
  return AGENT_MODEL_CAPABILITY_CATALOG.find(
    (entry) => entry.provider === normalizedProvider && entry.modelName === normalizedModel
  );
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
  const contextWindowMissing =
    contextWindow === undefined || !Number.isFinite(contextWindow) || contextWindow <= 0;
  const contextWindowInsufficient =
    !contextWindowMissing &&
    contextWindow !== undefined &&
    contextWindow < input.requiredContextTokens;
  if (contextWindowMissing || contextWindowInsufficient) {
    missingCapabilities.push("contextWindow");
  }

  if (missingCapabilities.length > 0 || contextWindow === undefined) {
    return err(
      createUnifiedError({
        code: "AGENT_MODEL_CAPABILITY_UNSUPPORTED",
        category: "UserError",
        message: "The selected provider/model cannot start an Agent run.",
        recoverability: "user-action",
        suggestedAction: contextWindowMissing
          ? "Refresh the model list or enter the model's verified context window in Settings; Max Tokens is only the output limit."
          : contextWindowInsufficient
            ? `Choose a model with at least ${input.requiredContextTokens} context tokens or correct the verified context-window setting.`
            : "Choose a model that explicitly supports the missing Agent capabilities.",
        traceId: "agent-model-capability-preflight",
        redactedDetail: {
          profileId: input.profileId,
          provider: input.provider,
          modelName: input.modelName,
          missingCapabilities,
          contextWindowStatus: contextWindowMissing ? "missing" : "insufficient",
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

export interface AgentReasoningEffortResolutionInput {
  readonly profileId: string;
  readonly modelName: string;
  readonly reasoningStrength: ModelReasoningStrengthControl;
  readonly requestedEffort?: ModelReasoningStrengthValue;
}

export interface AgentReasoningEffortResolution {
  readonly reasoningEffort: ModelReasoningStrengthValue | undefined;
}

/**
 * Decide the reasoning effort a run may actually use, server-side. The model's reasoning-strength
 * control (derived from provider + model, not from the renderer) is authoritative: a hidden control
 * forbids any requested effort, and an available control only permits its declared allowed values,
 * falling back to the model default when nothing is requested. This guarantees an unsupported effort
 * never reaches provider parameters.
 */
export function resolveAgentReasoningEffort(
  input: AgentReasoningEffortResolutionInput
): Result<AgentReasoningEffortResolution, UnifiedError> {
  if (input.reasoningStrength.status === "hidden") {
    if (input.requestedEffort !== undefined) {
      return err(unsupportedReasoningEffort(input, input.reasoningStrength));
    }
    return ok({ reasoningEffort: undefined });
  }
  const { allowedValues, defaultValue } = input.reasoningStrength;
  if (input.requestedEffort === undefined) {
    return ok({ reasoningEffort: defaultValue });
  }
  if (!allowedValues.includes(input.requestedEffort)) {
    return err(unsupportedReasoningEffort(input, input.reasoningStrength));
  }
  return ok({ reasoningEffort: input.requestedEffort });
}

function unsupportedReasoningEffort(
  input: AgentReasoningEffortResolutionInput,
  control: ModelReasoningStrengthControl
): UnifiedError {
  return createUnifiedError({
    code: "AGENT_REASONING_EFFORT_UNSUPPORTED",
    category: "UserError",
    message: "The selected model cannot use the requested reasoning strength.",
    recoverability: "user-action",
    suggestedAction:
      "Clear the reasoning strength or choose a value the selected model supports before starting the run.",
    traceId: "agent-reasoning-effort-resolution",
    redactedDetail: {
      profileId: input.profileId,
      modelName: input.modelName,
      requestedEffort: input.requestedEffort ?? null,
      controlStatus: control.status,
      allowedValues: control.status === "available" ? control.allowedValues : []
    }
  });
}
