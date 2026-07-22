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
        requiredContextTokens: 8_000
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
