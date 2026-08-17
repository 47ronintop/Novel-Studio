import { describe, expect, test } from "vitest";

import * as applicationExports from "../src/index.js";

describe("agent model capability preflight", () => {
  test("requires streaming, tool calls, structured arguments, and sufficient context", () => {
    const preflight = (applicationExports as unknown as Record<string, unknown>)[
      "preflightAgentModelCapabilities"
    ];

    expect(typeof preflight).toBe("function");
    if (typeof preflight !== "function") {
      return;
    }

    const supported = preflight({
      profileId: "model_supported",
      provider: "openai-compatible",
      modelName: "tool-model",
      capabilities: {
        streaming: true,
        toolCalling: true,
        structuredArguments: true,
        contextWindow: 32_000
      },
      requiredContextTokens: 8_000
    }) as { readonly ok: boolean; readonly value?: unknown };
    expect(supported).toMatchObject({
      ok: true,
      value: {
        profileId: "model_supported",
        streaming: true,
        toolCalling: true,
        structuredArguments: true,
        contextWindow: 32_000,
        requiredContextTokens: 8_000,
        promptCache: { mode: "none", policyVersion: "none@1.0" }
      }
    });

    const unsupported = preflight({
      profileId: "model_text_only",
      provider: "openai-compatible",
      modelName: "text-model",
      capabilities: {
        streaming: true,
        toolCalling: false,
        structuredArguments: false,
        contextWindow: 4_000
      },
      requiredContextTokens: 8_000
    }) as { readonly ok: boolean; readonly error?: unknown };
    expect(unsupported).toMatchObject({
      ok: false,
      error: {
        code: "AGENT_MODEL_CAPABILITY_UNSUPPORTED",
        redactedDetail: {
          missingCapabilities: ["toolCalling", "structuredArguments", "contextWindow"]
        }
      }
    });
  });

  test("fails closed when compatible metadata omits the context window", () => {
    const preflight = applicationExports.preflightAgentModelCapabilities({
      profileId: "model_unknown_context",
      provider: "openai-compatible",
      modelName: "gpt-5.6-luna",
      capabilities: {},
      requiredContextTokens: 8_000
    });

    expect(preflight).toMatchObject({
      ok: false,
      error: {
        code: "AGENT_MODEL_CAPABILITY_UNSUPPORTED",
        redactedDetail: {
          missingCapabilities: ["contextWindow"],
          contextWindowStatus: "unverified"
        }
      }
    });
    expect(
      applicationExports.resolveCatalogAgentModelCapabilities("openai", "gpt-4.1")
    ).toMatchObject({
      contextWindow: 1_000_000,
      toolCalling: true,
      promptCache: {
        mode: "automatic_prefix",
        minimumCacheableTokens: 1_024,
        reportsCacheReadTokens: true,
        reportsCacheWriteTokens: false
      }
    });
    expect(
      applicationExports.resolveCatalogAgentModelCapabilities("openai-compatible", "gpt-4.1")
    ).toBeUndefined();
  });

  test("freezes verified cache policy and degrades malformed declarations to none", () => {
    const catalogCapabilities = applicationExports.resolveCatalogAgentModelCapabilities(
      "anthropic",
      "claude-3-5-sonnet"
    );
    expect(catalogCapabilities).toBeDefined();
    if (catalogCapabilities === undefined) return;
    const verified = applicationExports.preflightAgentModelCapabilities({
      profileId: "anthropic_verified",
      provider: "anthropic",
      modelName: "claude-3-5-sonnet",
      capabilities: catalogCapabilities,
      requiredContextTokens: 8_000
    });
    expect(verified).toMatchObject({
      ok: true,
      value: {
        promptCache: {
          mode: "explicit_breakpoints",
          policyVersion: "anthropic-ephemeral@1.0",
          ttlSeconds: 300,
          inputTokenSemantics: "excluded_from_input"
        }
      }
    });

    expect(
      applicationExports.normalizeAgentPromptCacheCapability({
        mode: "explicit_resource",
        policyVersion: "",
        minimumCacheableTokens: -1,
        ttlSeconds: 0,
        inputTokenSemantics: "unavailable",
        reportsCacheReadTokens: true,
        reportsCacheWriteTokens: true
      })
    ).toEqual({
      mode: "none",
      policyVersion: "none@1.0",
      minimumCacheableTokens: 0,
      ttlSeconds: null,
      inputTokenSemantics: "unavailable",
      reportsCacheReadTokens: false,
      reportsCacheWriteTokens: false
    });
  });

  test("enables verified cache families and requires opt-in for unknown compatible endpoints", () => {
    expect(
      applicationExports.resolveAgentPromptCacheCapability({
        provider: "openai",
        modelName: "gpt-5.6-sol"
      })
    ).toMatchObject({
      mode: "automatic_prefix",
      policyVersion: "openai-automatic@1.1",
      minimumCacheableTokens: 1_024
    });
    expect(
      applicationExports.resolveAgentPromptCacheCapability({
        provider: "openai-compatible",
        modelName: "gpt-5.6-luna",
        baseUrl: "https://api.openai.com/v1"
      })
    ).toMatchObject({ mode: "automatic_prefix", policyVersion: "openai-automatic@1.1" });
    expect(
      applicationExports.resolveAgentPromptCacheCapability({
        provider: "deepseek",
        modelName: "deepseek-reasoner"
      })
    ).toMatchObject({ mode: "automatic_prefix", policyVersion: "deepseek-automatic@1.0" });
    expect(
      applicationExports.resolveAgentPromptCacheCapability({
        provider: "zhipu",
        modelName: "glm-4.5-air"
      })
    ).toMatchObject({ mode: "automatic_prefix", policyVersion: "zhipu-automatic@1.0" });
    expect(
      applicationExports.resolveAgentPromptCacheCapability({
        provider: "tongyi-qianwen",
        modelName: "qwen3-235b-a22b"
      })
    ).toMatchObject({ mode: "automatic_prefix", policyVersion: "qwen-automatic@1.0" });

    const unknownAuto = applicationExports.resolveAgentPromptCacheCapability({
      provider: "openai-compatible",
      modelName: "gpt-5.6-sol",
      baseUrl: "https://compatible.example/v1"
    });
    expect(unknownAuto).toMatchObject({ mode: "none", policyVersion: "none@1.0" });
    expect(
      applicationExports.resolveAgentPromptCacheCapability({
        provider: "openai",
        modelName: "gpt-4.1",
        baseUrl: "https://compatible.example/v1"
      })
    ).toMatchObject({ mode: "none", policyVersion: "none@1.0" });
    expect(
      applicationExports.resolveAgentPromptCacheCapability({
        provider: "deepseek",
        modelName: "deepseek-chat",
        baseUrl: "https://compatible.example/v1"
      })
    ).toMatchObject({ mode: "none", policyVersion: "none@1.0" });

    const optedIn = applicationExports.resolveAgentPromptCacheCapability({
      provider: "openai-compatible",
      modelName: "custom-model",
      baseUrl: "https://compatible.example/v1",
      preference: "enabled"
    });
    expect(optedIn).toMatchObject({
      mode: "automatic_prefix",
      policyVersion: "openai-compatible-opt-in@1.0",
      minimumCacheableTokens: 0
    });

    expect(
      applicationExports.resolveAgentPromptCacheCapability({
        provider: "deepseek",
        modelName: "deepseek-chat",
        preference: "disabled"
      })
    ).toMatchObject({ mode: "none", policyVersion: "none@1.0" });
  });

  test("accepts a text-only model for standalone conversation", () => {
    const result = applicationExports.preflightAgentModelCapabilities({
      profileId: "model_text_only",
      provider: "openai-compatible",
      modelName: "text-model",
      capabilities: {
        streaming: true,
        toolCalling: false,
        structuredArguments: false,
        contextWindow: 32_000
      },
      requiredContextTokens: 8_000,
      requireToolCapabilities: false
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        streaming: true,
        toolCalling: false,
        structuredArguments: false,
        contextWindow: 32_000
      }
    });
  });
});

describe("agent reasoning effort resolution", () => {
  const resolve = (applicationExports as unknown as Record<string, unknown>)[
    "resolveAgentReasoningEffort"
  ] as
    | ((input: {
        readonly profileId: string;
        readonly modelName: string;
        readonly reasoningStrength: unknown;
        readonly requestedEffort?: string;
      }) => { readonly ok: boolean; readonly value?: unknown; readonly error?: unknown })
    | undefined;

  test("is exported", () => {
    expect(typeof resolve).toBe("function");
  });

  test("resolves to undefined when the control is hidden and nothing is requested", () => {
    if (resolve === undefined) return;
    const result = resolve({
      profileId: "p",
      modelName: "gpt-4o",
      reasoningStrength: { status: "hidden", reason: "not a reasoning model" }
    });
    expect(result).toEqual({ ok: true, value: { reasoningEffort: undefined } });
  });

  test("rejects a requested effort when the control is hidden", () => {
    if (resolve === undefined) return;
    const result = resolve({
      profileId: "p",
      modelName: "gpt-4o",
      reasoningStrength: { status: "hidden", reason: "not a reasoning model" },
      requestedEffort: "high"
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "AGENT_REASONING_EFFORT_UNSUPPORTED" }
    });
  });

  test("rejects an effort outside the model's allowed values", () => {
    if (resolve === undefined) return;
    const result = resolve({
      profileId: "p",
      modelName: "gpt-5",
      reasoningStrength: {
        status: "available",
        providerParamName: "reasoning_effort",
        allowedValues: ["minimal", "low", "medium", "high"],
        defaultValue: "medium"
      },
      requestedEffort: "xhigh"
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "AGENT_REASONING_EFFORT_UNSUPPORTED" }
    });
  });

  test("accepts a supported effort", () => {
    if (resolve === undefined) return;
    const result = resolve({
      profileId: "p",
      modelName: "gpt-5",
      reasoningStrength: {
        status: "available",
        providerParamName: "reasoning_effort",
        allowedValues: ["minimal", "low", "medium", "high"],
        defaultValue: "medium"
      },
      requestedEffort: "high"
    });
    expect(result).toEqual({ ok: true, value: { reasoningEffort: "high" } });
  });

  test("accepts provider-added reasoning values while still enforcing the declared list", () => {
    if (resolve === undefined) return;
    const control = {
      status: "available" as const,
      providerParamName: "reasoning_effort" as const,
      allowedValues: ["high", "max", "ultra"],
      defaultValue: "high"
    };
    expect(
      resolve({
        profileId: "p",
        modelName: "gpt-5.6",
        reasoningStrength: control,
        requestedEffort: "ultra"
      })
    ).toEqual({ ok: true, value: { reasoningEffort: "ultra" } });
    expect(
      resolve({
        profileId: "p",
        modelName: "gpt-5.6",
        reasoningStrength: control,
        requestedEffort: "xhigh"
      })
    ).toMatchObject({ ok: false, error: { code: "AGENT_REASONING_EFFORT_UNSUPPORTED" } });
  });

  test("falls back to the model default when the control is available but nothing is requested", () => {
    if (resolve === undefined) return;
    const result = resolve({
      profileId: "p",
      modelName: "gpt-5",
      reasoningStrength: {
        status: "available",
        providerParamName: "reasoning_effort",
        allowedValues: ["minimal", "low", "medium", "high"],
        defaultValue: "medium"
      }
    });
    expect(result).toEqual({ ok: true, value: { reasoningEffort: "medium" } });
  });
});
