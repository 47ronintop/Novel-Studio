import type { JsonObject, Result, UnifiedError } from "@novel-studio/shared";
import type { ModelProfile } from "./model-settings-session.js";

export type ModelDiscoveryStatus = "loaded" | "fallback";
/** Open-ended because providers can add model-specific reasoning levels without an app release. */
export type ModelReasoningStrengthValue = string;

export interface ModelReasoningStrengthAvailable extends JsonObject {
  readonly status: "available";
  readonly providerParamName: "reasoning_effort";
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
  discoverModels(profile: ModelProfile): Promise<Result<ModelDiscoverySnapshot, UnifiedError>>;
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
    reasoningStrength:
      model.reasoningStrength ??
      reasoningStrengthForModel(
        input.profile.provider,
        model.id,
        input.profile.baseUrl,
        input.profile.reasoningEffortEnabled
      )
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

export function reasoningStrengthForModel(
  provider: string,
  modelId: string,
  baseUrl?: string,
  reasoningEffortEnabled = false
): ModelReasoningStrengthControl {
  const normalized = modelId.trim().toLowerCase();

  // DeepSeek's reasoning models always reason at the provider-selected setting. They do not
  // accept the OpenAI-compatible `reasoning_effort` parameter, so an opt-in override must not
  // manufacture low/medium/high values for these models. The same applies to DeepSeek chat (and
  // other DeepSeek model aliases) unless discovery supplies explicit reasoning metadata, which is
  // honored by createModelDiscoverySnapshot before this fallback is reached.
  const deepSeekReason = deepSeekReasoningReason(provider, normalized, baseUrl);
  if (deepSeekReason !== undefined) {
    return hiddenReasoningStrength(deepSeekReason);
  }

  if (provider !== "openai" && provider !== "openai-compatible") {
    return hiddenReasoningStrength();
  }

  const spec = reasoningEffortSpecForOpenAiModel(normalized);
  if (spec !== undefined) {
    return {
      status: "available",
      providerParamName: "reasoning_effort",
      allowedValues: spec.allowedValues,
      defaultValue: spec.defaultValue
    };
  }

  if (reasoningEffortEnabled) {
    return {
      status: "available",
      providerParamName: "reasoning_effort",
      allowedValues: ["none", "low", "medium", "high"],
      defaultValue: "medium"
    };
  }

  if (!isOfficialOpenAiEndpoint(provider, baseUrl)) {
    return {
      status: "hidden",
      reason:
        "This custom endpoint uses an unrecognized model name; enable the advanced reasoning_effort override to expose generic values."
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
    return "DeepSeek reasoner models use fixed reasoning and do not expose reasoning_effort tiers.";
  }

  return "This DeepSeek model does not declare reasoning_effort tiers.";
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

interface ReasoningEffortSpec {
  readonly allowedValues: ModelReasoningStrengthValue[];
  readonly defaultValue: ModelReasoningStrengthValue;
}

function reasoningEffortSpecForOpenAiModel(
  normalizedModelId: string
): ReasoningEffortSpec | undefined {
  // These compatible endpoints expose model-specific tiers. Keep the catalog per model instead of
  // applying one conservative list to every GPT-5.6 alias.
  if (/^gpt-5\.6-sol(?:-|$)/.test(normalizedModelId)) {
    return {
      allowedValues: ["low", "medium", "high", "max", "ultra"],
      defaultValue: "medium"
    };
  }
  if (/^gpt-5\.6-luna(?:-|$)/.test(normalizedModelId)) {
    return {
      allowedValues: ["low", "medium", "high"],
      defaultValue: "medium"
    };
  }
  if (normalizedModelId === "gpt-5-pro") {
    return { allowedValues: ["high"], defaultValue: "high" };
  }
  if (normalizedModelId === "gpt-5.6" || /^gpt-5\.6-codex(?:-|$)/.test(normalizedModelId)) {
    return {
      allowedValues: ["none", "low", "medium", "high", "xhigh", "max", "ultra"],
      defaultValue: "medium"
    };
  }
  if (/^gpt-5\.6-/.test(normalizedModelId)) return undefined;
  if (normalizedModelId.includes("codex") && normalizedModelId.startsWith("gpt-5")) {
    return {
      allowedValues: ["minimal", "low", "medium", "high", "xhigh"],
      defaultValue: "medium"
    };
  }
  if (normalizedModelId === "gpt-5") {
    return {
      allowedValues: ["minimal", "low", "medium", "high"],
      defaultValue: "medium"
    };
  }
  if (normalizedModelId === "gpt-5.5") {
    return {
      allowedValues: ["none", "low", "medium", "high", "xhigh"],
      defaultValue: "medium"
    };
  }
  if (/^gpt-5\.(?:[2-9]\d*|1\d+)(?:-|$)/.test(normalizedModelId)) {
    return {
      allowedValues: ["none", "low", "medium", "high", "xhigh"],
      defaultValue: "medium"
    };
  }
  if (/^gpt-5\.1(?:-|$)/.test(normalizedModelId)) {
    return {
      allowedValues: ["none", "low", "medium", "high"],
      defaultValue: "none"
    };
  }
  if (/^o[134](?:-|$)/.test(normalizedModelId)) {
    return {
      allowedValues: ["low", "medium", "high"],
      defaultValue: "medium"
    };
  }
  return undefined;
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
