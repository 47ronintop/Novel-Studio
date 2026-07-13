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
