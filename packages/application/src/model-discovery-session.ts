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

export function hiddenReasoningStrength(): ModelReasoningStrengthHidden {
  return {
    status: "hidden",
    reason: "Select a whitelisted reasoning model before exposing reasoning controls."
  };
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
  if (normalizedModelId === "gpt-5-pro") {
    return { allowedValues: ["high"], defaultValue: "high" };
  }
  if (/^gpt-5\.6(?:-|$)/.test(normalizedModelId)) {
    return {
      allowedValues: ["none", "low", "medium", "high", "xhigh", "max", "ultra"],
      defaultValue: "medium"
    };
  }
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
