import { LlmProviderFailure } from "./errors.js";
import type { LlmProvider, LlmProviderId, LlmRequest } from "./types.js";

export interface ProviderRouterOptions {
  readonly providers: Partial<Record<LlmProviderId, LlmProvider>>;
  readonly aliases?: Partial<Record<LlmProviderId, LlmProviderId>>;
}

const DEFAULT_PROVIDER_ALIASES: Partial<Record<LlmProviderId, LlmProviderId>> = {
  openai: "openai-compatible",
  openrouter: "openai-compatible",
  deepseek: "openai-compatible",
  zhipu: "openai-compatible",
  "tongyi-qianwen": "openai-compatible",
  ollama: "openai-compatible",
  "lm-studio": "openai-compatible",
  vllm: "openai-compatible"
};

export function createProviderRouter(options: ProviderRouterOptions): LlmProvider {
  return {
    id: "openai-compatible",
    async complete(request) {
      return resolveProvider(options, request).complete(request);
    },
    stream(request) {
      return resolveProvider(options, request).stream(request);
    }
  };
}

function resolveProvider(options: ProviderRouterOptions, request: LlmRequest): LlmProvider {
  const providerId = request.modelProfile.provider;
  const targetProviderId =
    options.aliases?.[providerId] ?? DEFAULT_PROVIDER_ALIASES[providerId] ?? providerId;
  const provider = options.providers[targetProviderId];
  if (provider !== undefined) {
    return provider;
  }

  throw new LlmProviderFailure({
    code: "LLM_PROVIDER_ERROR",
    message: "No runtime provider is configured for the selected model profile.",
    retryable: false,
    redactedDetail: {
      provider: providerId,
      targetProvider: targetProviderId
    }
  });
}
