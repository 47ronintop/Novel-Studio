import type { LlmProviderId } from "@novel-studio/llm-adapter";

export type ModelProvider = Exclude<LlmProviderId, "mock">;

export interface ModelProviderCatalogEntry {
  readonly id: ModelProvider;
  readonly label: string;
  readonly defaultModelName: string;
  readonly defaultBaseUrl?: string;
  readonly baseUrlRequired: boolean;
  readonly agentAdapter: "openai-compatible" | "anthropic-native" | "gemini-native";
  readonly agentSupport: "native" | "conditional-compatible";
  readonly agentSupportNote: string;
}

const OPENAI_COMPATIBLE_AGENT = {
  agentAdapter: "openai-compatible",
  agentSupport: "conditional-compatible",
  agentSupportNote: "Agent 通过 OpenAI-compatible 协议运行；端点必须支持流式输出和工具调用。"
} as const;

const ANTHROPIC_NATIVE_AGENT = {
  agentAdapter: "anthropic-native",
  agentSupport: "native",
  agentSupportNote: "Agent 使用 Anthropic Messages 原生协议。"
} as const;

const GEMINI_NATIVE_AGENT = {
  agentAdapter: "gemini-native",
  agentSupport: "native",
  agentSupportNote: "Agent 使用 Gemini generateContent 原生协议。"
} as const;

export const MODEL_PROVIDER_CATALOG: readonly ModelProviderCatalogEntry[] = [
  {
    id: "openai-compatible",
    label: "OpenAI Compatible",
    defaultModelName: "example-model",
    defaultBaseUrl: "https://api.example.com/v1",
    baseUrlRequired: true,
    ...OPENAI_COMPATIBLE_AGENT
  },
  {
    id: "openai",
    label: "OpenAI",
    defaultModelName: "gpt-4.1",
    defaultBaseUrl: "https://api.openai.com/v1",
    baseUrlRequired: false,
    ...OPENAI_COMPATIBLE_AGENT
  },
  {
    id: "anthropic",
    label: "Anthropic",
    defaultModelName: "claude-3-5-sonnet",
    defaultBaseUrl: "https://api.anthropic.com",
    baseUrlRequired: false,
    ...ANTHROPIC_NATIVE_AGENT
  },
  {
    id: "google-gemini",
    label: "Google Gemini",
    defaultModelName: "gemini-1.5-pro",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    baseUrlRequired: false,
    ...GEMINI_NATIVE_AGENT
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    defaultModelName: "openrouter/auto",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    baseUrlRequired: true,
    ...OPENAI_COMPATIBLE_AGENT
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    defaultModelName: "deepseek-chat",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    baseUrlRequired: true,
    ...OPENAI_COMPATIBLE_AGENT
  },
  {
    id: "zhipu",
    label: "Zhipu",
    defaultModelName: "glm-4",
    defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
    baseUrlRequired: true,
    ...OPENAI_COMPATIBLE_AGENT
  },
  {
    id: "tongyi-qianwen",
    label: "Tongyi Qianwen",
    defaultModelName: "qwen-plus",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    baseUrlRequired: true,
    ...OPENAI_COMPATIBLE_AGENT
  },
  {
    id: "ollama",
    label: "Ollama",
    defaultModelName: "llama3.1",
    defaultBaseUrl: "http://localhost:11434/v1",
    baseUrlRequired: true,
    ...OPENAI_COMPATIBLE_AGENT
  },
  {
    id: "lm-studio",
    label: "LM Studio",
    defaultModelName: "local-model",
    defaultBaseUrl: "http://localhost:1234/v1",
    baseUrlRequired: true,
    ...OPENAI_COMPATIBLE_AGENT
  },
  {
    id: "vllm",
    label: "vLLM",
    defaultModelName: "local-vllm-model",
    defaultBaseUrl: "http://localhost:8000/v1",
    baseUrlRequired: true,
    ...OPENAI_COMPATIBLE_AGENT
  }
] as const;

export function isModelProvider(provider: string): provider is ModelProvider {
  return MODEL_PROVIDER_CATALOG.some((entry) => entry.id === provider);
}
