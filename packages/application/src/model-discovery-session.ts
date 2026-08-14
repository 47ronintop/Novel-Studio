import type { JsonObject, Result, UnifiedError } from "@novel-studio/shared";
import {
  resolveLlmReasoningCapability,
  type LlmReasoningProviderParamName
} from "@novel-studio/llm-adapter";
import type { ModelProfile } from "./model-settings-session.js";

export type ModelDiscoveryStatus = "loaded" | "fallback";
/** Open-ended because providers can add model-specific reasoning levels without an app release. */
export type ModelReasoningStrengthValue = string;

export interface ModelReasoningStrengthAvailable extends JsonObject {
  readonly status: "available";
  readonly providerParamName: LlmReasoningProviderParamName;
  readonly allowedValues: ModelReasoningStrengthValue[];
  readonly defaultValue: ModelReasoningStrengthValue;
}

export interface ModelReasoningStrengthHidden extends JsonObject {
  readonly status: "hidden";
  readonly reason: string;
}

export type ModelReasoningStrengthControl =
  ModelReasoningStrengthAvailable | ModelReasoningStrengthHidden;

export interface ModelDiscoveryOption extends JsonObject {
  readonly id: string;
  readonly displayName: string;
  readonly provider: string;
  readonly contextWindow?: number;
  readonly streaming?: boolean;
  readonly toolCalling?: boolean;
  readonly structuredArguments?: boolean;
  readonly reasoningStrength?: ModelReasoningStrengthControl;
}

export interface ModelDiscoveryModelInput {
  readonly id: string;
  readonly displayName: string;
  readonly contextWindow?: number;
  readonly streaming?: boolean;
  readonly toolCalling?: boolean;
  readonly structuredArguments?: boolean;
  readonly reasoningStrength?: ModelReasoningStrengthControl;
}

export interface ModelDiscoverySnapshot extends JsonObject {
  readonly profileId: string;
  readonly provider: string;
  readonly status: ModelDiscoveryStatus;
  readonly models: ModelDiscoveryOption[];
  readonly fallbackReason?: string;
  readonly reasoningStrength: ModelReasoningStrengthControl;
}

export interface ModelDiscoveryPort {
  discoverModels(
    profile: ModelProfile,
    options?: ModelDiscoveryRequestOptions
  ): Promise<Result<ModelDiscoverySnapshot, UnifiedError>>;
}

export interface ModelDiscoveryRequestOptions {
  readonly forceRefresh?: boolean;
}

type ModelDiscoveryFallbackProfile = Pick<ModelProfile, "id" | "provider"> &
  Partial<Pick<ModelProfile, "modelName" | "baseUrl" | "reasoningEffortEnabled">>;

export function createModelDiscoveryFallback(
  profile: ModelDiscoveryFallbackProfile,
  fallbackReason: string
): ModelDiscoverySnapshot {
  return {
    profileId: profile.id,
    provider: profile.provider,
    status: "fallback",
    models: [],
    fallbackReason: redactDiscoveryText(fallbackReason),
    reasoningStrength:
      profile.modelName === undefined
        ? hiddenReasoningStrength()
        : reasoningStrengthForModel(
            profile.provider,
            profile.modelName,
            profile.baseUrl,
            profile.reasoningEffortEnabled
          )
  };
}

export function createModelDiscoverySnapshot(input: {
  readonly profile: Pick<
    ModelProfile,
    "id" | "provider" | "modelName" | "baseUrl" | "reasoningEffortEnabled"
  >;
  readonly models: readonly ModelDiscoveryModelInput[];
}): ModelDiscoverySnapshot {
  const models: ModelDiscoveryOption[] = input.models.map((model) => ({
    ...model,
    provider: input.profile.provider,
    reasoningStrength: discoveredReasoningStrength(input.profile, model)
  }));

  const configuredModel = models.find((model) => model.id === input.profile.modelName);

  return {
    profileId: input.profile.id,
    provider: input.profile.provider,
    status: "loaded",
    models,
    reasoningStrength:
      configuredModel?.reasoningStrength ??
      reasoningStrengthForModel(
        input.profile.provider,
        input.profile.modelName,
        input.profile.baseUrl,
        input.profile.reasoningEffortEnabled
      )
  };
}

function discoveredReasoningStrength(
  profile: Pick<ModelProfile, "provider" | "baseUrl" | "reasoningEffortEnabled">,
  model: ModelDiscoveryModelInput
): ModelReasoningStrengthControl {
  const declared = model.reasoningStrength;
  if (declared === undefined || declared.status === "hidden") {
    return (
      declared ??
      reasoningStrengthForModel(
        profile.provider,
        model.id,
        profile.baseUrl,
        profile.reasoningEffortEnabled
      )
    );
  }
  const allowedValues = [...new Set(declared.allowedValues.map((value) => value.trim()))].filter(
    (value) => value.length > 0
  );
  const defaultValue = declared.defaultValue.trim();
  if (allowedValues.length === 0 || !allowedValues.includes(defaultValue)) {
    return hiddenReasoningStrength("Provider reasoning metadata is incomplete or conflicting.");
  }
  const adapterCapability = resolveLlmReasoningCapability(
    profile.provider,
    model.id,
    profile.baseUrl,
    true
  );
  if (
    adapterCapability === undefined ||
    adapterCapability.providerParamName !== declared.providerParamName
  ) {
    return hiddenReasoningStrength(
      "Provider reasoning metadata does not match the configured adapter protocol."
    );
  }
  const provider = profile.provider.trim().toLowerCase();
  if (
    (provider === "anthropic" || provider === "google-gemini") &&
    allowedValues.some((value) => !adapterCapability.allowedValues.includes(value))
  ) {
    return hiddenReasoningStrength(
      "Provider reasoning metadata declares values the native adapter cannot serialize."
    );
  }
  return {
    status: "available",
    providerParamName: declared.providerParamName,
    allowedValues,
    defaultValue
  };
}

export function reasoningStrengthForModel(
  provider: string,
  modelId: string,
  baseUrl?: string,
  reasoningEffortEnabled = false
): ModelReasoningStrengthControl {
  const normalized = modelId.trim().toLowerCase();

  const capability = resolveLlmReasoningCapability(
    provider,
    modelId,
    baseUrl,
    reasoningEffortEnabled
  );
  if (capability !== undefined) {
    return {
      status: "available",
      providerParamName: capability.providerParamName,
      allowedValues: [...capability.allowedValues],
      defaultValue: capability.defaultValue
    };
  }

  const deepSeekReason = deepSeekReasoningReason(provider, normalized, baseUrl);
  if (deepSeekReason !== undefined) return hiddenReasoningStrength(deepSeekReason);

  if (
    (provider === "openai" || provider === "openai-compatible") &&
    !isOfficialOpenAiEndpoint(provider, baseUrl)
  ) {
    return {
      status: "hidden",
      reason:
        "This custom endpoint uses an unrecognized model name; enable the advanced reasoning override to expose generic values."
    };
  }

  return hiddenReasoningStrength();
}

export function hiddenReasoningStrength(
  reason = "Select a whitelisted reasoning model before exposing reasoning controls."
): ModelReasoningStrengthHidden {
  return {
    status: "hidden",
    reason
  };
}

function deepSeekReasoningReason(
  provider: string,
  normalizedModelId: string,
  baseUrl: string | undefined
): string | undefined {
  const isDeepSeekProvider = provider === "deepseek";
  const isDeepSeekModel = normalizedModelId.startsWith("deepseek-");
  const isDeepSeekEndpoint = isDeepSeekBaseUrl(baseUrl);
  if (!isDeepSeekProvider && !isDeepSeekModel && !isDeepSeekEndpoint) {
    return undefined;
  }

  if (
    normalizedModelId === "deepseek-reasoner" ||
    normalizedModelId.startsWith("deepseek-reasoner-") ||
    normalizedModelId === "deepseek-r1" ||
    normalizedModelId.startsWith("deepseek-r1-")
  ) {
    return "DeepSeek reasoner models need declared effort tiers or the advanced reasoning override.";
  }

  return "This DeepSeek model does not declare effort tiers; enable the advanced reasoning override if the endpoint supports them.";
}

function isDeepSeekBaseUrl(baseUrl: string | undefined): boolean {
  if (baseUrl === undefined || baseUrl.trim().length === 0) return false;
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    return hostname === "api.deepseek.com" || hostname.endsWith(".deepseek.com");
  } catch {
    return false;
  }
}

function redactDiscoveryText(value: string): string {
  return value
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[REDACTED]")
    .replace(/secret:\/\/[^\s"'`]+/g, "[REDACTED]");
}

function isOfficialOpenAiEndpoint(provider: string, baseUrl: string | undefined): boolean {
  if (provider === "openai" && (baseUrl === undefined || baseUrl.trim().length === 0)) {
    return true;
  }
  if (baseUrl === undefined) {
    return false;
  }
  try {
    return new URL(baseUrl).hostname.toLowerCase() === "api.openai.com";
  } catch {
    return false;
  }
}
