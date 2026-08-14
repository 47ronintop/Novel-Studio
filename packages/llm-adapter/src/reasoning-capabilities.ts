import type {
  LlmModelProfile,
  LlmReasoningCapability,
  LlmReasoningProviderParamName
} from "./types.js";

export type LlmReasoningSerialization =
  | {
      readonly providerParamName: "reasoning_effort" | "reasoning" | "anthropic_effort";
      readonly value: string;
    }
  | {
      readonly providerParamName: "anthropic_thinking_budget" | "gemini_thinking_budget";
      readonly value: number;
    }
  | {
      readonly providerParamName: "gemini_thinking_level";
      readonly value: string;
    };

/**
 * Resolve the model-specific reasoning contract shared by discovery and provider adapters.
 * Unknown models stay hidden unless the user explicitly opted into a generic compatible field.
 */
export function resolveLlmReasoningCapability(
  provider: string,
  modelName: string,
  _baseUrl?: string,
  reasoningEffortEnabled = false
): LlmReasoningCapability | undefined {
  const normalizedProvider = provider.trim().toLowerCase();
  const normalizedModel = modelName.trim().toLowerCase();

  if (normalizedProvider === "anthropic") {
    if (isAnthropicAdaptiveThinkingModel(normalizedModel)) {
      return {
        providerParamName: "anthropic_effort",
        allowedValues: anthropicAdaptiveEfforts(normalizedModel),
        defaultValue: "high"
      };
    }
    if (isAnthropicBudgetThinkingModel(normalizedModel)) {
      return {
        providerParamName: "anthropic_thinking_budget",
        allowedValues: ["low", "medium", "high"],
        defaultValue: "medium"
      };
    }
    return undefined;
  }

  if (normalizedProvider === "google-gemini") {
    if (isGeminiThinkingLevelModel(normalizedModel)) {
      const isFlash = normalizedModel.includes("flash");
      return {
        providerParamName: "gemini_thinking_level",
        allowedValues: isFlash ? ["minimal", "low", "medium", "high"] : ["low", "high"],
        defaultValue: "high"
      };
    }
    if (isGeminiThinkingBudgetModel(normalizedModel)) {
      const isFlash = normalizedModel.includes("flash");
      return {
        providerParamName: "gemini_thinking_budget",
        allowedValues: isFlash ? ["off", "low", "medium", "high"] : ["low", "medium", "high"],
        defaultValue: "medium"
      };
    }
    return undefined;
  }

  if (normalizedProvider === "openrouter") {
    const catalogCapability = knownOpenAiCompatibleCapability(
      openRouterUpstreamModel(normalizedModel)
    );
    if (catalogCapability !== undefined) {
      return { ...catalogCapability, providerParamName: "reasoning" };
    }
    return reasoningEffortEnabled ? genericReasoningCapability("reasoning") : undefined;
  }

  if (!isOpenAiCompatibleProvider(normalizedProvider)) return undefined;

  const catalogCapability = knownOpenAiCompatibleCapability(normalizedModel);
  if (catalogCapability !== undefined) return catalogCapability;
  if (!reasoningEffortEnabled) return undefined;
  return genericReasoningCapability("reasoning_effort");
}

export function resolveLlmReasoningCapabilityForProfile(
  profile: Pick<
    LlmModelProfile,
    | "provider"
    | "modelName"
    | "baseUrl"
    | "reasoningEffortEnabled"
    | "reasoningCapability"
  >
): LlmReasoningCapability | undefined {
  if (profile.reasoningCapability === null) return undefined;
  if (profile.reasoningCapability !== undefined) {
    return normalizeDeclaredCapability(profile, profile.reasoningCapability);
  }
  return resolveLlmReasoningCapability(
    profile.provider,
    profile.modelName,
    profile.baseUrl,
    profile.reasoningEffortEnabled === true
  );
}

export function serializeLlmReasoningEffort(
  profile: Pick<
    LlmModelProfile,
    | "provider"
    | "modelName"
    | "baseUrl"
    | "reasoningEffortEnabled"
    | "reasoningCapability"
  >,
  effort: string
): LlmReasoningSerialization | undefined {
  const normalizedEffort = effort.trim();
  if (normalizedEffort.length === 0) return undefined;
  const capability = resolveLlmReasoningCapabilityForProfile(profile);
  if (capability === undefined) return undefined;
  if (!capability.allowedValues.includes(normalizedEffort)) return undefined;

  switch (capability.providerParamName) {
    case "anthropic_thinking_budget": {
      const value = anthropicThinkingBudget(normalizedEffort);
      if (value === undefined) return undefined;
      return {
        providerParamName: capability.providerParamName,
        value
      };
    }
    case "gemini_thinking_budget": {
      const value = geminiThinkingBudget(normalizedEffort);
      if (value === undefined) return undefined;
      return {
        providerParamName: capability.providerParamName,
        value
      };
    }
    default:
      return {
        providerParamName: capability.providerParamName,
        value: normalizedEffort
      };
  }
}

function normalizeDeclaredCapability(
  profile: Pick<LlmModelProfile, "provider" | "modelName" | "baseUrl">,
  declared: LlmReasoningCapability
): LlmReasoningCapability | undefined {
  const allowedValues = [...new Set(declared.allowedValues.map((value) => value.trim()))].filter(
    (value) => value.length > 0
  );
  const defaultValue = declared.defaultValue.trim();
  if (allowedValues.length === 0 || !allowedValues.includes(defaultValue)) return undefined;

  const provider = profile.provider.trim().toLowerCase();
  if (!reasoningProviderParamMatchesAdapter(provider, declared.providerParamName)) return undefined;

  if (provider === "anthropic" || provider === "google-gemini") {
    const native = resolveLlmReasoningCapability(
      profile.provider,
      profile.modelName,
      profile.baseUrl,
      false
    );
    if (
      native === undefined ||
      native.providerParamName !== declared.providerParamName ||
      allowedValues.some((value) => !native.allowedValues.includes(value))
    ) {
      return undefined;
    }
  }

  return {
    providerParamName: declared.providerParamName,
    allowedValues,
    defaultValue
  };
}

function reasoningProviderParamMatchesAdapter(
  provider: string,
  providerParamName: LlmReasoningProviderParamName
): boolean {
  if (provider === "anthropic") {
    return (
      providerParamName === "anthropic_effort" ||
      providerParamName === "anthropic_thinking_budget"
    );
  }
  if (provider === "google-gemini") {
    return (
      providerParamName === "gemini_thinking_level" ||
      providerParamName === "gemini_thinking_budget"
    );
  }
  if (provider === "openrouter") return providerParamName === "reasoning";
  return isOpenAiCompatibleProvider(provider) && providerParamName === "reasoning_effort";
}

function genericReasoningCapability(
  providerParamName: "reasoning_effort" | "reasoning"
): LlmReasoningCapability {
  return {
    providerParamName,
    allowedValues:
      providerParamName === "reasoning"
        ? ["low", "medium", "high"]
        : ["none", "low", "medium", "high"],
    defaultValue: "medium"
  };
}

function openRouterUpstreamModel(normalizedModel: string): string {
  const withoutProvider = normalizedModel.includes("/")
    ? (normalizedModel.split("/").at(-1) ?? normalizedModel)
    : normalizedModel;
  return withoutProvider.split(":", 1)[0] ?? withoutProvider;
}

export function anthropicThinkingBudget(effort: string): number | undefined {
  switch (effort.trim().toLowerCase()) {
    case "low":
      return 1024;
    case "medium":
      return 4096;
    case "high":
      return 8192;
    default:
      return undefined;
  }
}

export function geminiThinkingBudget(effort: string): number | undefined {
  switch (effort.trim().toLowerCase()) {
    case "off":
      return 0;
    case "low":
      return 1024;
    case "high":
      return 24_576;
    case "medium":
      return 8192;
    default:
      return undefined;
  }
}

function isAnthropicAdaptiveThinkingModel(normalizedModel: string): boolean {
  return /^claude-(?:(?:opus|sonnet)-4[-.]6|4[-.]6-(?:opus|sonnet))(?:[-.]|$)/.test(
    normalizedModel
  );
}

function isAnthropicBudgetThinkingModel(normalizedModel: string): boolean {
  return /^claude-(?:(?:opus|sonnet|haiku)-(?:3[-.]7|4(?:[-.]\d+)?)|(?:3[-.]7|4(?:[-.]\d+)?)-(?:opus|sonnet|haiku))(?:[-.]|$)/.test(
    normalizedModel
  );
}

function isGeminiThinkingLevelModel(normalizedModel: string): boolean {
  return /^gemini-3(?:[-.]\d+)?(?:[-.]|$)/.test(normalizedModel);
}

function isGeminiThinkingBudgetModel(normalizedModel: string): boolean {
  return /^gemini-2\.5(?:[-.]|$)/.test(normalizedModel);
}

function anthropicAdaptiveEfforts(normalizedModel: string): readonly string[] {
  return /(?:opus-4[-.]6|4[-.]6-opus)/.test(normalizedModel)
    ? ["low", "medium", "high", "max"]
    : ["low", "medium", "high"];
}

function isOpenAiCompatibleProvider(provider: string): boolean {
  return (
    provider === "openai" ||
    provider === "openai-compatible" ||
    provider === "deepseek" ||
    provider === "zhipu" ||
    provider === "tongyi-qianwen" ||
    provider === "ollama" ||
    provider === "lm-studio" ||
    provider === "vllm"
  );
}

function knownOpenAiCompatibleCapability(
  normalizedModel: string
): LlmReasoningCapability | undefined {
  if (/^gpt-5\.6-sol(?:-|$)/.test(normalizedModel)) {
    return {
      providerParamName: "reasoning_effort",
      allowedValues: ["low", "medium", "high", "xhigh", "max", "ultra"],
      defaultValue: "low"
    };
  }
  if (/^gpt-5\.6-terra(?:-|$)/.test(normalizedModel)) {
    return {
      providerParamName: "reasoning_effort",
      allowedValues: ["low", "medium", "high", "xhigh", "max", "ultra"],
      defaultValue: "medium"
    };
  }
  if (/^gpt-5\.6-luna(?:-|$)/.test(normalizedModel)) {
    return {
      providerParamName: "reasoning_effort",
      allowedValues: ["low", "medium", "high", "xhigh", "max"],
      defaultValue: "medium"
    };
  }
  if (normalizedModel === "gpt-5-pro") {
    return { providerParamName: "reasoning_effort", allowedValues: ["high"], defaultValue: "high" };
  }
  if (normalizedModel === "gpt-5.6" || /^gpt-5\.6-codex(?:-|$)/.test(normalizedModel)) {
    return {
      providerParamName: "reasoning_effort",
      allowedValues: ["none", "low", "medium", "high", "xhigh", "max", "ultra"],
      defaultValue: "medium"
    };
  }
  if (/^gpt-5\.6-/.test(normalizedModel)) return undefined;
  if (/^grok-3-mini(?:-|$)/.test(normalizedModel)) {
    return {
      providerParamName: "reasoning_effort",
      allowedValues: ["low", "high"],
      defaultValue: "high"
    };
  }
  if (/^grok-4(?:-|$)/.test(normalizedModel)) {
    return {
      providerParamName: "reasoning_effort",
      allowedValues: ["low", "medium", "high"],
      defaultValue: "high"
    };
  }
  if (normalizedModel.includes("codex") && normalizedModel.startsWith("gpt-5")) {
    return {
      providerParamName: "reasoning_effort",
      allowedValues: ["minimal", "low", "medium", "high", "xhigh"],
      defaultValue: "medium"
    };
  }
  if (normalizedModel === "gpt-5" || /^gpt-5-(?:mini|nano)(?:-|$)/.test(normalizedModel)) {
    return {
      providerParamName: "reasoning_effort",
      allowedValues: ["minimal", "low", "medium", "high"],
      defaultValue: "medium"
    };
  }
  if (normalizedModel === "gpt-5.5") {
    return {
      providerParamName: "reasoning_effort",
      allowedValues: ["low", "medium", "high", "xhigh"],
      defaultValue: "medium"
    };
  }
  if (/^gpt-5\.(?:2|4)(?:-|$)/.test(normalizedModel)) {
    return {
      providerParamName: "reasoning_effort",
      allowedValues: ["low", "medium", "high", "xhigh"],
      defaultValue: "medium"
    };
  }
  if (/^gpt-5\.1(?:-|$)/.test(normalizedModel)) {
    return {
      providerParamName: "reasoning_effort",
      allowedValues: ["none", "low", "medium", "high"],
      defaultValue: "none"
    };
  }
  if (/^o[134](?:-|$)/.test(normalizedModel)) {
    return {
      providerParamName: "reasoning_effort",
      allowedValues: ["low", "medium", "high"],
      defaultValue: "medium"
    };
  }
  return undefined;
}
