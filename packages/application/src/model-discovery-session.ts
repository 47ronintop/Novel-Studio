import type { JsonObject, Result, UnifiedError } from "@novel-studio/shared";
import type { ModelProfile } from "./model-settings-session.js";

export type ModelDiscoveryStatus = "loaded" | "fallback";
export type ModelReasoningStrengthValue = "low" | "medium" | "high";

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
  | ModelReasoningStrengthAvailable
  | ModelReasoningStrengthHidden;

export interface ModelDiscoveryOption extends JsonObject {
  readonly id: string;
  readonly displayName: string;
  readonly provider: string;
  readonly contextWindow?: number;
  readonly reasoningStrength?: ModelReasoningStrengthControl;
}

export interface ModelDiscoveryModelInput {
  readonly id: string;
  readonly displayName: string;
  readonly contextWindow?: number;
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

export function createModelDiscoveryFallback(
  profile: Pick<ModelProfile, "id" | "provider">,
  fallbackReason: string
): ModelDiscoverySnapshot {
  return {
    profileId: profile.id,
    provider: profile.provider,
    status: "fallback",
    models: [],
    fallbackReason: redactDiscoveryText(fallbackReason),
    reasoningStrength: hiddenReasoningStrength()
  };
}

export function createModelDiscoverySnapshot(input: {
  readonly profile: Pick<ModelProfile, "id" | "provider" | "modelName">;
  readonly models: readonly ModelDiscoveryModelInput[];
}): ModelDiscoverySnapshot {
  const models: ModelDiscoveryOption[] = input.models.map((model) => ({
    ...model,
    provider: input.profile.provider,
    reasoningStrength: reasoningStrengthForModel(input.profile.provider, model.id)
  }));

  return {
    profileId: input.profile.id,
    provider: input.profile.provider,
    status: "loaded",
    models,
    reasoningStrength: reasoningStrengthForModel(input.profile.provider, input.profile.modelName)
  };
}

export function reasoningStrengthForModel(
  provider: string,
  modelId: string
): ModelReasoningStrengthControl {
  const normalized = modelId.trim().toLowerCase();
  if (
    (provider === "openai" || provider === "openai-compatible") &&
    OPENAI_REASONING_EFFORT_MODEL_IDS.has(normalized)
  ) {
    return {
      status: "available",
      providerParamName: "reasoning_effort",
      allowedValues: ["low", "medium", "high"],
      defaultValue: "medium"
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

// VUI-03 intentionally exposes reasoning effort only for known OpenAI-style models.
// Parameter contract: reasoning_effort accepts low | medium | high.
const OPENAI_REASONING_EFFORT_MODEL_IDS = new Set([
  "gpt-5",
  "gpt-5.1",
  "gpt-5.2",
  "gpt-5.3",
  "gpt-5.4",
  "gpt-5.5",
  "o1",
  "o1-mini",
  "o3",
  "o3-mini",
  "o4-mini"
]);
