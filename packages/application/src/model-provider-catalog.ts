import type { LlmProviderId } from "@novel-studio/llm-adapter";

export type ModelProvider = Exclude<LlmProviderId, "mock">;

export interface ModelProviderCatalogEntry {
  readonly id: ModelProvider;
  readonly label: string;
  readonly defaultModelName: string;
  readonly defaultBaseUrl?: string;
  readonly baseUrlRequired: boolean;
}

export const MODEL_PROVIDER_CATALOG: readonly ModelProviderCatalogEntry[] = [
  {
    id: "openai-compatible",
    label: "OpenAI Compatible",
    defaultModelName: "example-model",
    defaultBaseUrl: "https://api.example.com/v1",
    baseUrlRequired: true
  },
  {
    id: "openai",
    label: "OpenAI",
    defaultModelName: "gpt-4.1",
    defaultBaseUrl: "https://api.openai.com/v1",
    baseUrlRequired: false
  },
  {
    id: "anthropic",
    label: "Anthropic",
    defaultModelName: "claude-3-5-sonnet",
    defaultBaseUrl: "https://api.anthropic.com",
    baseUrlRequired: false
  },
  {
    id: "google-gemini",
    label: "Google Gemini",
    defaultModelName: "gemini-1.5-pro",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    baseUrlRequired: false
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    defaultModelName: "openrouter/auto",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    baseUrlRequired: true
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    defaultModelName: "deepseek-chat",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    baseUrlRequired: true
  },
  {
    id: "zhipu",
    label: "Zhipu",
    defaultModelName: "glm-4",
    defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
    baseUrlRequired: true
  },
  {
    id: "tongyi-qianwen",
    label: "Tongyi Qianwen",
    defaultModelName: "qwen-plus",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    baseUrlRequired: true
  },
  {
    id: "ollama",
    label: "Ollama",
    defaultModelName: "llama3.1",
    defaultBaseUrl: "http://localhost:11434/v1",
    baseUrlRequired: true
  },
  {
    id: "lm-studio",
    label: "LM Studio",
    defaultModelName: "local-model",
    defaultBaseUrl: "http://localhost:1234/v1",
    baseUrlRequired: true
  },
  {
    id: "vllm",
    label: "vLLM",
    defaultModelName: "local-vllm-model",
    defaultBaseUrl: "http://localhost:8000/v1",
    baseUrlRequired: true
  }
] as const;

export function isModelProvider(provider: string): provider is ModelProvider {
  return MODEL_PROVIDER_CATALOG.some((entry) => entry.id === provider);
}
