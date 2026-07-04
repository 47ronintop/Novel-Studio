import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import { isErr, isOk, type JsonObject } from "@novel-studio/shared";

import {
  createLlmAdapter,
  createOpenAiCompatibleProvider,
  OpenAiCompatibleHttpError,
  type LlmRequest,
  type OpenAiCompatibleTransportRequest
} from "../src/index.js";

const request = {
  schemaVersion: "1.0",
  requestId: "llmreq_openai_compatible_01",
  traceId: "trace_m6_openai_compatible_01",
  mode: "non-streaming",
  modelProfile: {
    id: "model_openai_compatible",
    provider: "openai-compatible",
    displayName: "OpenAI Compatible Fixture",
    modelName: "fixture-model",
    baseUrl: "https://provider.example/v1",
    apiKeyRef: "secret://model_openai_compatible/api_key",
    timeoutMs: 1000
  },
  messages: [
    {
      role: "developer",
      content: "Return one sentence."
    },
    {
      role: "user",
      content: "Write a rainy city line."
    }
  ],
  parameters: {
    temperature: 0.4,
    maxTokens: 64,
    topP: 0.9
  }
} satisfies LlmRequest;

describe("OpenAI-compatible provider", () => {
  test("maps provider-neutral non-streaming requests and fixture responses", async () => {
    const calls: OpenAiCompatibleTransportRequest[] = [];
    const provider = createOpenAiCompatibleProvider({
      transport: async (transportRequest) => {
        calls.push(transportRequest);
        return readFixture("openai-compatible-chat-success.json");
      }
    });
    const adapter = createLlmAdapter({
      provider,
      clock: () => "2026-07-04T00:00:00.000Z"
    });

    const result = await adapter.complete(request);

    expect(calls).toEqual([
      {
        url: "https://provider.example/v1/chat/completions",
        body: {
          model: "fixture-model",
          messages: [
            {
              role: "developer",
              content: "Return one sentence."
            },
            {
              role: "user",
              content: "Write a rainy city line."
            }
          ],
          temperature: 0.4,
          max_tokens: 64,
          top_p: 0.9,
          stream: false
        },
        timeoutMs: 1000
      }
    ]);
    expect(isOk(result)).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.content).toEqual({
      type: "text",
      value: "The city answered with rain."
    });
    expect(result.value.usage).toEqual({
      inputTokens: 14,
      outputTokens: 7,
      totalTokens: 21,
      usageStatus: "actual",
      cost: {
        amount: 0,
        currency: "USD",
        status: "unknown"
      }
    });
  });

  test("normalizes OpenAI-compatible rate limits without leaking secrets", async () => {
    const provider = createOpenAiCompatibleProvider({
      transport: async () => {
        throw new OpenAiCompatibleHttpError({
          status: 429,
          message: "Rate limited.",
          body: readFixture("openai-compatible-rate-limit.json"),
          headers: {
            authorization: "Bearer sk-secret"
          }
        });
      }
    });
    const adapter = createLlmAdapter({
      provider,
      clock: () => "2026-07-04T00:00:00.000Z"
    });

    const result = await adapter.complete(request);

    expect(isErr(result)).toBe(true);
    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe("LLM_RATE_LIMITED");
    expect(JSON.stringify(result.error.redactedDetail)).not.toContain("sk-secret");
    expect(result.error.redactedDetail).toEqual({
      providerStatus: 429,
      providerRequestId: "provider_req_rate_limit_01",
      authorization: "[REDACTED]"
    });
  });

  test("estimates cost from model profile token pricing when provider returns usage", async () => {
    const provider = createOpenAiCompatibleProvider({
      transport: async () => readFixture("openai-compatible-chat-success.json")
    });
    const adapter = createLlmAdapter({
      provider,
      clock: () => "2026-07-04T00:00:00.000Z"
    });

    const result = await adapter.complete({
      ...request,
      modelProfile: {
        ...request.modelProfile,
        tokenPricing: {
          inputPerMillion: 2,
          outputPerMillion: 8,
          currency: "USD"
        }
      }
    });

    expect(isOk(result)).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.usage.cost).toEqual({
      amount: 0.000084,
      currency: "USD",
      status: "estimated"
    });
  });

  test("normalizes malformed OpenAI-compatible payloads", async () => {
    const provider = createOpenAiCompatibleProvider({
      transport: async () => ({
        id: "chatcmpl_malformed",
        choices: []
      })
    });
    const adapter = createLlmAdapter({
      provider,
      clock: () => "2026-07-04T00:00:00.000Z"
    });

    const result = await adapter.complete(request);

    expect(isErr(result)).toBe(true);
    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe("LLM_MALFORMED_RESPONSE");
    expect(result.error.recoverability).toBe("user-action");
  });
});

function readFixture(fileName: string): JsonObject {
  const fixtureUrl = new URL(`../../../fixtures/llm/${fileName}`, import.meta.url);
  return JSON.parse(readFileSync(fixtureUrl, "utf8")) as JsonObject;
}
