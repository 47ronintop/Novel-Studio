import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import { isErr, isOk, type JsonObject } from "@novel-studio/shared";

import {
  createLlmAdapter,
  createOpenAiCompatibleProvider,
  OpenAiCompatibleHttpError,
  type LlmStreamResult,
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

  test("maps provider-neutral streaming requests and fixture chunks", async () => {
    const calls: OpenAiCompatibleTransportRequest[] = [];
    const provider = createOpenAiCompatibleProvider({
      transport: async () => readFixture("openai-compatible-chat-success.json"),
      streamTransport: async function* (transportRequest) {
        calls.push(transportRequest);
        yield {
          choices: [
            {
              delta: {
                content: "The city"
              }
            }
          ]
        };
        yield {
          choices: [
            {
              delta: {
                content: " answered with rain."
              }
            }
          ]
        };
        yield {
          choices: [
            {
              delta: {}
            }
          ],
          usage: {
            prompt_tokens: 14,
            completion_tokens: 7,
            total_tokens: 21
          }
        };
      }
    });
    const adapter = createLlmAdapter({
      provider,
      clock: () => "2026-07-06T00:00:00.000Z"
    });

    const events = await collectStream(adapter.stream({ ...request, mode: "streaming" }));

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
          stream: true
        },
        timeoutMs: 1000
      }
    ]);
    expect(events).toEqual([
      {
        ok: true,
        value: {
          type: "start",
          requestId: "llmreq_openai_compatible_01",
          provider: "openai-compatible",
          modelName: "fixture-model",
          createdAt: "2026-07-06T00:00:00.000Z"
        }
      },
      {
        ok: true,
        value: {
          type: "delta",
          value: "The city"
        }
      },
      {
        ok: true,
        value: {
          type: "delta",
          value: " answered with rain."
        }
      },
      {
        ok: true,
        value: {
          type: "usage",
          usage: {
            inputTokens: 14,
            outputTokens: 7,
            totalTokens: 21,
            usageStatus: "actual",
            cost: {
              amount: 0,
              currency: "USD",
              status: "unknown"
            }
          }
        }
      },
      {
        ok: true,
        value: {
          type: "done",
          requestId: "llmreq_openai_compatible_01",
          provider: "openai-compatible",
          modelName: "fixture-model",
          createdAt: "2026-07-06T00:00:00.000Z"
        }
      }
    ]);
  });

  test("preserves streamed tool-call deltas as tool events instead of text", async () => {
    const provider = createOpenAiCompatibleProvider({
      transport: async () => readFixture("openai-compatible-chat-success.json"),
      streamTransport: async function* () {
        yield {
          choices: [
            {
              delta: {
                content: "I will inspect the chapter.",
                tool_calls: [
                  {
                    index: 0,
                    id: "call_01",
                    type: "function",
                    function: { name: "read_chapter", arguments: '{"chapter' }
                  }
                ]
              }
            }
          ]
        };
        yield {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: { arguments: 'Id":"chapter-03"}' }
                  }
                ]
              },
              finish_reason: "tool_calls"
            }
          ]
        };
      }
    });
    const adapter = createLlmAdapter({ provider });

    const events = await collectStream(adapter.stream({ ...request, mode: "streaming" }));

    expect(events).toEqual([
      expect.objectContaining({ ok: true, value: expect.objectContaining({ type: "start" }) }),
      { ok: true, value: { type: "delta", value: "I will inspect the chapter." } },
      {
        ok: true,
        value: {
          type: "tool_call_delta",
          toolCallId: "call_01",
          name: "read_chapter",
          argumentsDelta: '{"chapter'
        }
      },
      {
        ok: true,
        value: {
          type: "tool_call_delta",
          toolCallId: "call_01",
          argumentsDelta: 'Id":"chapter-03"}'
        }
      },
      { ok: true, value: { type: "round_completed", finishReason: "tool_calls" } },
      expect.objectContaining({ ok: true, value: expect.objectContaining({ type: "done" }) })
    ]);
  });

  test("normalizes malformed OpenAI-compatible streaming chunks", async () => {
    const provider = createOpenAiCompatibleProvider({
      transport: async () => readFixture("openai-compatible-chat-success.json"),
      streamTransport: async function* () {
        yield {
          choices: [
            {
              delta: {
                content: 42
              }
            }
          ]
        };
      }
    });
    const adapter = createLlmAdapter({
      provider,
      clock: () => "2026-07-06T00:00:00.000Z"
    });

    const events = await collectStream(adapter.stream({ ...request, mode: "streaming" }));

    expect(events).toEqual([
      {
        ok: true,
        value: {
          type: "start",
          requestId: "llmreq_openai_compatible_01",
          provider: "openai-compatible",
          modelName: "fixture-model",
          createdAt: "2026-07-06T00:00:00.000Z"
        }
      },
      {
        ok: false,
        error: expect.objectContaining({
          code: "LLM_MALFORMED_RESPONSE",
          category: "LLMAdapterError"
        })
      }
    ]);
  });

  test("surfaces provider streaming error messages instead of only the HTTP status", async () => {
    const provider = createOpenAiCompatibleProvider({
      transport: async () => readFixture("openai-compatible-chat-success.json"),
      streamTransport: async function* () {
        throw new OpenAiCompatibleHttpError({
          status: 400,
          message: "Provider returned HTTP 400.",
          body: {
            error: {
              message: "Unrecognized request argument supplied: reasoning_effort",
              type: "invalid_request_error"
            }
          }
        });
        yield {};
      }
    });
    const adapter = createLlmAdapter({
      provider,
      clock: () => "2026-07-08T00:00:00.000Z"
    });

    const events = await collectStream(adapter.stream({ ...request, mode: "streaming" }));

    expect(events).toEqual([
      {
        ok: true,
        value: {
          type: "start",
          requestId: "llmreq_openai_compatible_01",
          provider: "openai-compatible",
          modelName: "fixture-model",
          createdAt: "2026-07-08T00:00:00.000Z"
        }
      },
      {
        ok: false,
        error: expect.objectContaining({
          code: "LLM_PROVIDER_ERROR",
          message: "Unrecognized request argument supplied: reasoning_effort"
        })
      }
    ]);
  });

  test("retries non-streaming requests without reasoning_effort when the provider rejects the parameter", async () => {
    const calls: OpenAiCompatibleTransportRequest[] = [];
    const provider = createOpenAiCompatibleProvider({
      transport: async (transportRequest) => {
        calls.push(transportRequest);
        if (calls.length === 1) {
          throw new OpenAiCompatibleHttpError({
            status: 400,
            message: "Provider returned HTTP 400.",
            body: {
              error: {
                message: "Unrecognized request argument supplied: reasoning_effort"
              }
            }
          });
        }
        return readFixture("openai-compatible-chat-success.json");
      }
    });
    const adapter = createLlmAdapter({
      provider,
      clock: () => "2026-07-08T00:00:00.000Z"
    });

    const result = await adapter.complete({
      ...request,
      parameters: {
        ...request.parameters,
        reasoningEffort: "high"
      }
    });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.body).toMatchObject({
      reasoning_effort: "high"
    });
    expect(calls[1]?.body).not.toHaveProperty("reasoning_effort");
  });

  test("retries streaming requests when the rejected reasoning parameter is outside the message", async () => {
    const calls: OpenAiCompatibleTransportRequest[] = [];
    const provider = createOpenAiCompatibleProvider({
      transport: async () => readFixture("openai-compatible-chat-success.json"),
      streamTransport: async function* (transportRequest) {
        calls.push(transportRequest);
        if (calls.length === 1) {
          throw new OpenAiCompatibleHttpError({
            status: 400,
            message: "Provider returned HTTP 400.",
            body: {
              error: {
                message: "Unsupported value: 'ultra'.",
                param: "reasoning_effort",
                code: "unsupported_value"
              }
            }
          });
        }
        yield {
          choices: [
            {
              delta: {
                content: "Retried without reasoning."
              }
            }
          ]
        };
      }
    });
    const adapter = createLlmAdapter({
      provider,
      clock: () => "2026-07-08T00:00:00.000Z"
    });

    const events = await collectStream(
      adapter.stream({
        ...request,
        mode: "streaming",
        parameters: {
          ...request.parameters,
          reasoningEffort: "ultra"
        }
      })
    );

    expect(calls).toHaveLength(2);
    expect(calls[0]?.body).toMatchObject({
      reasoning_effort: "ultra"
    });
    expect(calls[1]?.body).not.toHaveProperty("reasoning_effort");
    expect(events).toContainEqual({
      ok: true,
      value: {
        type: "delta",
        value: "Retried without reasoning."
      }
    });
    expect(events).toContainEqual({
      ok: true,
      value: {
        type: "warning",
        code: "LLM_REASONING_EFFORT_IGNORED",
        message:
          "The model endpoint does not support reasoning strength controls. reasoning_effort was removed and the request was retried."
      }
    });
  });
});

function readFixture(fileName: string): JsonObject {
  const fixtureUrl = new URL(`../../../fixtures/llm/${fileName}`, import.meta.url);
  return JSON.parse(readFileSync(fixtureUrl, "utf8")) as JsonObject;
}

async function collectStream(
  stream: AsyncIterable<LlmStreamResult>
): Promise<readonly LlmStreamResult[]> {
  const events: LlmStreamResult[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}
