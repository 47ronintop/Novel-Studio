import { describe, expect, test } from "vitest";

import { MODEL_PROVIDER_CATALOG, isModelProvider } from "../src/model-provider-catalog.js";

describe("model provider Agent support catalog", () => {
  test("maps every visible provider to one explicit runtime adapter class", () => {
    expect(new Set(MODEL_PROVIDER_CATALOG.map((provider) => provider.id)).size).toBe(
      MODEL_PROVIDER_CATALOG.length
    );
    expect(MODEL_PROVIDER_CATALOG.every((provider) => isModelProvider(provider.id))).toBe(true);
    expect(
      MODEL_PROVIDER_CATALOG.map((provider) => ({
        id: provider.id,
        adapter: provider.agentAdapter,
        support: provider.agentSupport
      }))
    ).toEqual([
      {
        id: "openai-compatible",
        adapter: "openai-compatible",
        support: "conditional-compatible"
      },
      { id: "openai", adapter: "openai-compatible", support: "conditional-compatible" },
      { id: "anthropic", adapter: "anthropic-native", support: "native" },
      { id: "google-gemini", adapter: "gemini-native", support: "native" },
      { id: "openrouter", adapter: "openai-compatible", support: "conditional-compatible" },
      { id: "deepseek", adapter: "openai-compatible", support: "conditional-compatible" },
      { id: "zhipu", adapter: "openai-compatible", support: "conditional-compatible" },
      {
        id: "tongyi-qianwen",
        adapter: "openai-compatible",
        support: "conditional-compatible"
      },
      { id: "ollama", adapter: "openai-compatible", support: "conditional-compatible" },
      { id: "lm-studio", adapter: "openai-compatible", support: "conditional-compatible" },
      { id: "vllm", adapter: "openai-compatible", support: "conditional-compatible" }
    ]);
  });
});
