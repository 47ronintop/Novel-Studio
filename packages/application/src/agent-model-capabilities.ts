import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";
import {
  NO_AGENT_PROMPT_CACHE_CAPABILITY,
  type AgentPromptCacheCapabilitySnapshot
} from "@novel-studio/agent-engine";

import type {
  ModelReasoningStrengthControl,
  ModelReasoningStrengthValue
} from "./model-discovery-session.js";

export interface AgentModelCapabilityDeclaration {
  readonly streaming?: boolean;
  readonly toolCalling?: boolean;
  readonly structuredArguments?: boolean;
  readonly contextWindow?: number;
  readonly promptCache?: AgentPromptCacheCapabilitySnapshot;
}

export interface AgentModelCapabilityCatalogEntry extends AgentModelCapabilityDeclaration {
  readonly provider: string;
  readonly modelName: string;
  readonly streaming: true;
  readonly toolCalling: true;
  readonly structuredArguments: true;
  readonly contextWindow: number;
  readonly promptCache: AgentPromptCacheCapabilitySnapshot;
}

const AGENT_MODEL_CAPABILITY_CATALOG: readonly AgentModelCapabilityCatalogEntry[] = [
  {
    provider: "openai",
    modelName: "gpt-4.1",
    streaming: true,
    toolCalling: true,
    structuredArguments: true,
    contextWindow: 1_000_000,
    promptCache: {
      mode: "automatic_prefix",
      policyVersion: "openai-automatic@1.0",
      minimumCacheableTokens: 1_024,
      ttlSeconds: 300,
      inputTokenSemantics: "included_in_input",
      reportsCacheReadTokens: true,
      reportsCacheWriteTokens: false
    }
  },
  {
    provider: "anthropic",
    modelName: "claude-3-5-sonnet",
    streaming: true,
    toolCalling: true,
    structuredArguments: true,
    contextWindow: 200_000,
    promptCache: {
      mode: "explicit_breakpoints",
      policyVersion: "anthropic-ephemeral@1.0",
      minimumCacheableTokens: 1_024,
      ttlSeconds: 300,
      inputTokenSemantics: "excluded_from_input",
      reportsCacheReadTokens: true,
      reportsCacheWriteTokens: true
    }
  },
  {
    provider: "google-gemini",
    modelName: "gemini-1.5-pro",
    streaming: true,
    toolCalling: true,
    structuredArguments: true,
    contextWindow: 2_000_000,
    promptCache: {
      mode: "explicit_resource",
      policyVersion: "gemini-cached-content@1.0",
      minimumCacheableTokens: 32_768,
      ttlSeconds: 300,
      inputTokenSemantics: "included_in_input",
      reportsCacheReadTokens: true,
      reportsCacheWriteTokens: true
    }
  },
  {
    provider: "deepseek",
    modelName: "deepseek-chat",
    streaming: true,
    toolCalling: true,
    structuredArguments: true,
    contextWindow: 64_000,
    promptCache: NO_AGENT_PROMPT_CACHE_CAPABILITY
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
  /** Standalone conversation uses text generation only and freezes an empty tool catalog. */
  readonly requireToolCapabilities?: boolean;
}

export interface AgentModelCapabilitySnapshot {
  readonly profileId: string;
  readonly provider: string;
  readonly modelName: string;
  readonly streaming: true;
  readonly toolCalling: boolean;
  readonly structuredArguments: boolean;
  readonly contextWindow: number;
  readonly requiredContextTokens: number;
  readonly promptCache: AgentPromptCacheCapabilitySnapshot;
}

export function preflightAgentModelCapabilities(
  input: AgentModelCapabilityPreflightInput
): Result<AgentModelCapabilitySnapshot, UnifiedError> {
  const missingCapabilities: string[] = [];
  const requireToolCapabilities = input.requireToolCapabilities ?? true;
  if (input.capabilities.streaming === false) {
    missingCapabilities.push("streaming");
  }
  if (requireToolCapabilities && input.capabilities.toolCalling === false) {
    missingCapabilities.push("toolCalling");
  }
  if (requireToolCapabilities && input.capabilities.structuredArguments === false) {
    missingCapabilities.push("structuredArguments");
  }
  const configuredContextWindow = input.capabilities.contextWindow;
  const declaredContextWindow =
    typeof configuredContextWindow === "number" &&
    Number.isFinite(configuredContextWindow) &&
    configuredContextWindow > 0
      ? configuredContextWindow
      : undefined;
  const contextWindow = declaredContextWindow ?? 0;
  if (declaredContextWindow === undefined) {
    missingCapabilities.push("contextWindow");
  }
  const contextWindowInsufficient =
    declaredContextWindow !== undefined && declaredContextWindow < input.requiredContextTokens;
  if (contextWindowInsufficient) {
    missingCapabilities.push("contextWindow");
  }

  if (missingCapabilities.length > 0) {
    return err(
      createUnifiedError({
        code: "AGENT_MODEL_CAPABILITY_UNSUPPORTED",
        category: "UserError",
        message: "The selected provider/model cannot start an Agent run.",
        recoverability: "user-action",
        suggestedAction: contextWindowInsufficient
          ? `Choose a model with at least ${input.requiredContextTokens} context tokens or correct the verified context-window setting.`
          : "Choose a model that explicitly supports the missing Agent capabilities.",
        traceId: "agent-model-capability-preflight",
        redactedDetail: {
          profileId: input.profileId,
          provider: input.provider,
          modelName: input.modelName,
          missingCapabilities,
          contextWindowStatus:
            declaredContextWindow === undefined
              ? "unverified"
              : contextWindowInsufficient
                ? "insufficient"
                : "verified",
          requiredContextTokens: input.requiredContextTokens,
          availableContextTokens: contextWindow
        }
      })
    );
  }

  return ok({
    profileId: input.profileId,
    provider: input.provider,
    modelName: input.modelName,
    streaming: true,
    toolCalling: requireToolCapabilities || input.capabilities.toolCalling === true,
    structuredArguments: requireToolCapabilities || input.capabilities.structuredArguments === true,
    contextWindow,
    requiredContextTokens: input.requiredContextTokens,
    promptCache: normalizeAgentPromptCacheCapability(input.capabilities.promptCache)
  });
}

export function normalizeAgentPromptCacheCapability(
  value: AgentPromptCacheCapabilitySnapshot | undefined
): AgentPromptCacheCapabilitySnapshot {
  if (value === undefined || value.mode === "none") return NO_AGENT_PROMPT_CACHE_CAPABILITY;
  if (
    (value.mode !== "automatic_prefix" &&
      value.mode !== "explicit_breakpoints" &&
      value.mode !== "explicit_resource") ||
    value.policyVersion.trim().length === 0 ||
    value.policyVersion.length > 128 ||
    !Number.isSafeInteger(value.minimumCacheableTokens) ||
    value.minimumCacheableTokens < 0 ||
    (value.ttlSeconds !== null &&
      (!Number.isSafeInteger(value.ttlSeconds) || value.ttlSeconds <= 0)) ||
    (value.inputTokenSemantics !== "included_in_input" &&
      value.inputTokenSemantics !== "excluded_from_input") ||
    typeof value.reportsCacheReadTokens !== "boolean" ||
    typeof value.reportsCacheWriteTokens !== "boolean"
  ) {
    return NO_AGENT_PROMPT_CACHE_CAPABILITY;
  }
  return Object.freeze({ ...value });
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
