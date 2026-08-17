import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import { isErr, isOk, type JsonObject } from "@novel-studio/shared";

import {
  checksumProviderPayload,
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
  test("uses verified automatic prefix caching without adding private request fields", async () => {
    const calls: OpenAiCompatibleTransportRequest[] = [];
    const provider = createOpenAiCompatibleProvider({
      transport: async (transportRequest) => {
        calls.push(transportRequest);
        return {
          choices: [{ message: { content: "Cached response." } }],
          usage: {
            prompt_tokens: 40,
            completion_tokens: 5,
            total_tokens: 45,
            prompt_tokens_details: { cached_tokens: 24 }
          }
        };
      }
    });
    const promptCache = {
      mode: "automatic_prefix",
      policyVersion: "openai-automatic@1.0",
      identityChecksum: "a".repeat(64),
      logicalPrefixChecksum: "b".repeat(64),
      stablePrefixMessageCount: 1,
      minimumCacheableTokens: 1,
      eligibleInputTokens: 32
    } as const;

    const result = await createLlmAdapter({ provider }).complete({ ...request, promptCache });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({
      model: "fixture-model",
      messages: [
        { role: "developer", content: "Return one sentence." },
        { role: "user", content: "Write a rainy city line." }
      ],
      temperature: 0.4,
      max_tokens: 64,
      top_p: 0.9,
      stream: false
    });
    expect(JSON.stringify(calls[0]?.body)).not.toContain("promptCache");
    expect(isOk(result)).toBe(true);
    if (!result.ok) return;
    expect(result.value.usage).toMatchObject({
      cachedTokens: 24,
      cacheReadTokens: 24,
      cacheOutcome: "hit",
      cacheUsageStatus: "actual",
      cacheInputTokenSemantics: "included_in_input",
      cachePhysicalPrefixChecksum: checksumProviderPayload({
        messages: [{ role: "developer", content: "Return one sentence." }]
      })
    });
    expect(result.value.usage).not.toHaveProperty("cacheEligibleInputTokens");
  });

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

  test("normalizes compatible cache-read aliases and DeepSeek cache evidence", async () => {
    const responses = [
      {
        choices: [{ message: { content: "GLM response." } }],
        usage: {
          prompt_tokens: 40,
          completion_tokens: 5,
          total_tokens: 45,
          prompt_tokens_details: { cache_read_tokens: 12 }
        }
      },
      {
        choices: [{ message: { content: "DeepSeek response." } }],
        usage: {
          prompt_tokens: 40,
          completion_tokens: 5,
          total_tokens: 45,
          prompt_cache_hit_tokens: 20,
          prompt_cache_miss_tokens: 8
        }
      }
    ];
    const provider = createOpenAiCompatibleProvider({
      transport: async () => responses.shift()
    });
    const promptCache = {
      mode: "automatic_prefix",
      policyVersion: "compatible-automatic@1.0",
      identityChecksum: "a".repeat(64),
      logicalPrefixChecksum: "b".repeat(64),
      stablePrefixMessageCount: 1,
      minimumCacheableTokens: 1
    } as const;
    const adapter = createLlmAdapter({ provider });

    const glm = await adapter.complete({ ...request, promptCache });
    const deepSeek = await adapter.complete({ ...request, promptCache });

    expect(isOk(glm)).toBe(true);
    expect(isOk(deepSeek)).toBe(true);
    if (!glm.ok || !deepSeek.ok) return;
    expect(glm.value.usage).toMatchObject({
      cacheReadTokens: 12,
      cacheOutcome: "hit",
      cacheUsageStatus: "actual"
    });
    expect(glm.value.usage).not.toHaveProperty("cacheEligibleInputTokens");
    expect(deepSeek.value.usage).toMatchObject({
      cacheReadTokens: 20,
      cacheEligibleInputTokens: 28,
      cacheOutcome: "hit",
      cacheUsageStatus: "actual"
    });
  });

  test("keeps an active compatible cache as unavailable when the provider reports no cache fields", async () => {
    const provider = createOpenAiCompatibleProvider({
      transport: async () => ({
        choices: [{ message: { content: "No cache telemetry." } }],
        usage: { prompt_tokens: 40, completion_tokens: 5, total_tokens: 45 }
      })
    });
    const result = await createLlmAdapter({ provider }).complete({
      ...request,
      promptCache: {
        mode: "automatic_prefix",
        policyVersion: "compatible-automatic@1.0",
        identityChecksum: "a".repeat(64),
        logicalPrefixChecksum: "b".repeat(64),
        stablePrefixMessageCount: 1,
        minimumCacheableTokens: 1
      }
    });

    expect(isOk(result)).toBe(true);
    if (!result.ok) return;
    expect(result.value.usage).toMatchObject({
      cacheOutcome: "unknown",
      cacheUsageStatus: "unavailable"
    });
  });

  test("omits max_tokens when no output cap is requested", async () => {
    const calls: OpenAiCompatibleTransportRequest[] = [];
    const provider = createOpenAiCompatibleProvider({
      transport: async (transportRequest) => {
        calls.push(transportRequest);
        return { choices: [{ message: { content: "Provider default." } }] };
      }
    });
    const { maxTokens, ...parameters } = request.parameters;
    void maxTokens;

    const result = await createLlmAdapter({ provider }).complete({
      ...request,
      parameters
    });

    expect(isOk(result)).toBe(true);
    expect(calls[0]?.body).not.toHaveProperty("max_tokens");
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
              delta: {},
              finish_reason: "stop"
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
        value: { type: "round_completed", finishReason: "stop" }
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

  test("requests streaming usage for an active cache and accepts a usage-only final chunk", async () => {
    const calls: OpenAiCompatibleTransportRequest[] = [];
    const provider = createOpenAiCompatibleProvider({
      transport: async () => ({ choices: [{ message: { content: "unused" } }] }),
      streamTransport: async function* (transportRequest) {
        calls.push(transportRequest);
        yield { choices: [{ delta: { content: "Cached stream." }, finish_reason: "stop" }] };
        yield {
          usage: {
            prompt_tokens: 40,
            completion_tokens: 5,
            total_tokens: 45,
            prompt_tokens_details: { cached_tokens: 0 }
          }
        };
      }
    });
    const events = await collectStream(
      createLlmAdapter({ provider }).stream({
        ...request,
        mode: "streaming",
        promptCache: {
          mode: "automatic_prefix",
          policyVersion: "compatible-automatic@1.0",
          identityChecksum: "a".repeat(64),
          logicalPrefixChecksum: "b".repeat(64),
          stablePrefixMessageCount: 1,
          minimumCacheableTokens: 1
        }
      })
    );

    expect(calls[0]?.body).toMatchObject({
      stream: true,
      stream_options: { include_usage: true }
    });
    expect(JSON.stringify(calls[0]?.body)).not.toContain("promptCache");
    expect(events).toContainEqual({
      ok: true,
      value: {
        type: "usage",
        usage: expect.objectContaining({
          cacheReadTokens: 0,
          cacheOutcome: "miss",
          cacheUsageStatus: "actual"
        })
      }
    });
  });

  test("retries once without stream_options when the endpoint explicitly rejects it", async () => {
    const calls: OpenAiCompatibleTransportRequest[] = [];
    let attempt = 0;
    const provider = createOpenAiCompatibleProvider({
      transport: async () => ({ choices: [{ message: { content: "unused" } }] }),
      streamTransport: async function* (transportRequest) {
        calls.push(transportRequest);
        if (attempt++ === 0) {
          throw new OpenAiCompatibleHttpError({
            status: 400,
            message: "Unknown parameter stream_options",
            body: {
              error: { message: "Unknown parameter stream_options", param: "stream_options" }
            }
          });
        }
        yield { choices: [{ delta: { content: "Retried." }, finish_reason: "stop" }] };
        yield { choices: [], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } };
      }
    });
    const events = await collectStream(
      createLlmAdapter({ provider }).stream({
        ...request,
        mode: "streaming",
        promptCache: {
          mode: "automatic_prefix",
          policyVersion: "compatible-automatic@1.0",
          identityChecksum: "a".repeat(64),
          logicalPrefixChecksum: "b".repeat(64),
          stablePrefixMessageCount: 1,
          minimumCacheableTokens: 1
        }
      })
    );

    expect(calls).toHaveLength(2);
    expect(calls[0]?.body).toHaveProperty("stream_options");
    expect(calls[1]?.body).not.toHaveProperty("stream_options");
    expect(events).toContainEqual({ ok: true, value: { type: "delta", value: "Retried." } });
  });

  test("does not retry a stream_options error without explicit incompatibility evidence", async () => {
    const calls: OpenAiCompatibleTransportRequest[] = [];
    const provider = createOpenAiCompatibleProvider({
      transport: async () => ({ choices: [{ message: { content: "unused" } }] }),
      streamTransport: async function* (transportRequest) {
        calls.push(transportRequest);
        if (transportRequest.body["stream"] !== true) yield { choices: [] };
        throw new OpenAiCompatibleHttpError({
          status: 400,
          message: "Provider returned HTTP 400.",
          body: { error: { message: "Request could not be processed", param: "stream_options" } }
        });
      }
    });
    const events = await collectStream(
      createLlmAdapter({ provider }).stream({
        ...request,
        mode: "streaming",
        promptCache: {
          mode: "automatic_prefix",
          policyVersion: "compatible-automatic@1.0",
          identityChecksum: "a".repeat(64),
          logicalPrefixChecksum: "b".repeat(64),
          stablePrefixMessageCount: 1,
          minimumCacheableTokens: 1
        }
      })
    );

    expect(calls).toHaveLength(1);
    expect(events).toContainEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: "LLM_PROVIDER_ERROR" })
      })
    );
  });

  test("requests usage telemetry below the cache minimum and reads top-level cache aliases", async () => {
    const calls: OpenAiCompatibleTransportRequest[] = [];
    const provider = createOpenAiCompatibleProvider({
      transport: async () => ({ choices: [{ message: { content: "unused" } }] }),
      streamTransport: async function* (transportRequest) {
        calls.push(transportRequest);
        yield { choices: [{ delta: { content: "Short." }, finish_reason: "stop" }] };
        yield { choices: [], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } };
      }
    });
    const promptCache = {
      mode: "automatic_prefix",
      policyVersion: "compatible-automatic@1.0",
      identityChecksum: "a".repeat(64),
      logicalPrefixChecksum: "b".repeat(64),
      stablePrefixMessageCount: 1,
      minimumCacheableTokens: 10,
      eligibleInputTokens: 2
    } as const;
    const events = await collectStream(
      createLlmAdapter({ provider }).stream({ ...request, mode: "streaming", promptCache })
    );
    expect(calls[0]?.body).toHaveProperty("stream_options", { include_usage: true });
    expect(events).toContainEqual(
      expect.objectContaining({ ok: true, value: expect.objectContaining({ type: "usage" }) })
    );

    const nonStreaming = await createOpenAiCompatibleProvider({
      transport: async () => ({
        choices: [{ message: { content: "Top-level." } }],
        usage: {
          prompt_tokens: 4,
          completion_tokens: 1,
          total_tokens: 5,
          cache_read_input_tokens: 3
        }
      })
    }).complete({ ...request, promptCache: { ...promptCache, eligibleInputTokens: 20 } });
    expect(nonStreaming.usage).toMatchObject({ cacheReadTokens: 3, cacheOutcome: "hit" });
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

  test("accepts null content and keeps a deterministic ID when a stream omits the call ID", async () => {
    const provider = createOpenAiCompatibleProvider({
      transport: async () => readFixture("openai-compatible-chat-success.json"),
      streamTransport: async function* () {
        yield {
          choices: [
            {
              delta: {
                content: null,
                tool_calls: [
                  {
                    index: 0,
                    function: { name: "finish", arguments: "{}" }
                  }
                ]
              },
              finish_reason: "tool_calls"
            }
          ]
        };
      }
    });

    const events = await collectStream(
      createLlmAdapter({ provider }).stream({ ...request, mode: "streaming" })
    );
    expect(events).toContainEqual({
      ok: true,
      value: {
        type: "tool_call_delta",
        toolCallId: "tool_call_llmreq_openai_compatible_01_0",
        name: "finish",
        argumentsDelta: "{}"
      }
    });
  });

  test.each([
    ["stop", "stop"],
    ["tool_calls", "tool_calls"],
    ["length", "length"],
    ["content_filter", "content_filter"],
    ["aborted", "aborted"],
    ["error", "error"],
    ["provider_specific_reason", "unknown"]
  ] as const)(
    "normalizes the provider finish reason %s",
    async (finishReason, expectedFinishReason) => {
      const provider = createOpenAiCompatibleProvider({
        transport: async () => readFixture("openai-compatible-chat-success.json"),
        streamTransport: async function* () {
          yield { choices: [{ delta: {}, finish_reason: finishReason }] };
        }
      });
      const adapter = createLlmAdapter({ provider });

      const events = await collectStream(adapter.stream({ ...request, mode: "streaming" }));

      expect(events).toContainEqual({
        ok: true,
        value: { type: "round_completed", finishReason: expectedFinishReason }
      });
    }
  );

  test("uses a later string finish reason when an earlier choice is unfinished", async () => {
    const provider = createOpenAiCompatibleProvider({
      transport: async () => readFixture("openai-compatible-chat-success.json"),
      streamTransport: async function* () {
        yield {
          choices: [
            { delta: {}, finish_reason: null },
            { delta: {}, finish_reason: "length" }
          ]
        };
      }
    });
    const adapter = createLlmAdapter({ provider });

    const events = await collectStream(adapter.stream({ ...request, mode: "streaming" }));

    expect(events).toContainEqual({
      ok: true,
      value: { type: "round_completed", finishReason: "length" }
    });
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

  test("fails a truncated stream instead of returning a false success", async () => {
    const provider = createOpenAiCompatibleProvider({
      transport: async () => readFixture("openai-compatible-chat-success.json"),
      streamTransport: async function* () {
        yield { choices: [{ delta: { content: "partial" } }] };
      }
    });

    const events = await collectStream(
      createLlmAdapter({ provider }).stream({ ...request, mode: "streaming" })
    );

    expect(events).toContainEqual({
      ok: false,
      error: expect.objectContaining({ code: "LLM_MALFORMED_RESPONSE" })
    });
    expect(events).not.toContainEqual({
      ok: true,
      value: expect.objectContaining({ type: "done" })
    });
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
      modelProfile: { ...request.modelProfile, reasoningEffortEnabled: true },
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

  test("serializes OpenRouter reasoning with its native object", async () => {
    const calls: OpenAiCompatibleTransportRequest[] = [];
    const provider = createOpenAiCompatibleProvider({
      transport: async (transportRequest) => {
        calls.push(transportRequest);
        return readFixture("openai-compatible-chat-success.json");
      }
    });

    const result = await createLlmAdapter({ provider }).complete({
      ...request,
      modelProfile: {
        ...request.modelProfile,
        provider: "openrouter",
        modelName: "anthropic/claude-sonnet-4",
        reasoningEffortEnabled: true
      },
      parameters: { ...request.parameters, reasoningEffort: "high" }
    });

    expect(isOk(result)).toBe(true);
    expect(calls[0]?.body).toMatchObject({ reasoning: { effort: "high" } });
    expect(calls[0]?.body).not.toHaveProperty("reasoning_effort");
  });

  test.each(["deepseek", "zhipu", "tongyi-qianwen", "ollama", "lm-studio", "vllm"] as const)(
    "uses the explicit generic reasoning opt-in for %s",
    async (providerId) => {
      const calls: OpenAiCompatibleTransportRequest[] = [];
      const provider = createOpenAiCompatibleProvider({
        transport: async (transportRequest) => {
          calls.push(transportRequest);
          return readFixture("openai-compatible-chat-success.json");
        }
      });

      const result = await createLlmAdapter({ provider }).complete({
        ...request,
        modelProfile: {
          ...request.modelProfile,
          provider: providerId,
          reasoningEffortEnabled: true
        },
        parameters: { ...request.parameters, reasoningEffort: "high" }
      });

      expect(isOk(result)).toBe(true);
      expect(calls[0]?.body).toMatchObject({ reasoning_effort: "high" });
    }
  );

  test.each([
    "openai-compatible",
    "openrouter",
    "deepseek",
    "zhipu",
    "tongyi-qianwen",
    "ollama",
    "lm-studio",
    "vllm"
  ] as const)(
    "rejects undeclared generic reasoning for %s before transport",
    async (providerId) => {
      const calls: OpenAiCompatibleTransportRequest[] = [];
      const provider = createOpenAiCompatibleProvider({
        transport: async (transportRequest) => {
          calls.push(transportRequest);
          return readFixture("openai-compatible-chat-success.json");
        }
      });

      const result = await createLlmAdapter({ provider }).complete({
        ...request,
        modelProfile: { ...request.modelProfile, provider: providerId },
        parameters: { ...request.parameters, reasoningEffort: "high" }
      });

      expect(isErr(result)).toBe(true);
      expect(calls).toHaveLength(0);
    }
  );

  test("does not restore static reasoning when Main explicitly hides the capability", async () => {
    const calls: OpenAiCompatibleTransportRequest[] = [];
    const provider = createOpenAiCompatibleProvider({
      transport: async (transportRequest) => {
        calls.push(transportRequest);
        return readFixture("openai-compatible-chat-success.json");
      }
    });

    const result = await createLlmAdapter({ provider }).complete({
      ...request,
      modelProfile: {
        ...request.modelProfile,
        provider: "openai",
        modelName: "gpt-5",
        reasoningEffortEnabled: true,
        reasoningCapability: null
      },
      parameters: { ...request.parameters, reasoningEffort: "high" }
    });

    expect(isErr(result)).toBe(true);
    expect(calls).toHaveLength(0);
  });

  test("retries OpenRouter requests without the native reasoning object when unsupported", async () => {
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
                message: "Unknown parameter: reasoning",
                param: "reasoning",
                code: "unknown_parameter"
              }
            }
          });
        }
        return readFixture("openai-compatible-chat-success.json");
      }
    });

    const result = await createLlmAdapter({ provider }).complete({
      ...request,
      modelProfile: {
        ...request.modelProfile,
        provider: "openrouter",
        reasoningEffortEnabled: true
      },
      parameters: { ...request.parameters, reasoningEffort: "high" }
    });

    expect(isOk(result)).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.body).toHaveProperty("reasoning");
    expect(calls[1]?.body).not.toHaveProperty("reasoning");
  });

  test("preserves non-streaming reasoning_effort value rejection errors", async () => {
    const calls: OpenAiCompatibleTransportRequest[] = [];
    const provider = createOpenAiCompatibleProvider({
      transport: async (transportRequest) => {
        calls.push(transportRequest);
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
    });
    const adapter = createLlmAdapter({ provider });

    const result = await adapter.complete({
      ...request,
      modelProfile: {
        ...request.modelProfile,
        reasoningCapability: {
          providerParamName: "reasoning_effort",
          allowedValues: ["ultra"],
          defaultValue: "ultra"
        }
      },
      parameters: { ...request.parameters, reasoningEffort: "ultra" }
    });

    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({
      ok: false,
      error: expect.objectContaining({
        code: "LLM_PROVIDER_ERROR",
        message: "Unsupported value: 'ultra'."
      })
    });
  });

  test("preserves invalid reasoning_effort parameter-value errors", async () => {
    const calls: OpenAiCompatibleTransportRequest[] = [];
    const provider = createOpenAiCompatibleProvider({
      transport: async (transportRequest) => {
        calls.push(transportRequest);
        throw new OpenAiCompatibleHttpError({
          status: 400,
          message: "Provider returned HTTP 400.",
          body: {
            error: {
              message: "Invalid parameter value for reasoning_effort.",
              code: "invalid_parameter_value"
            }
          }
        });
      }
    });
    const adapter = createLlmAdapter({ provider });

    const result = await adapter.complete({
      ...request,
      modelProfile: {
        ...request.modelProfile,
        reasoningCapability: {
          providerParamName: "reasoning_effort",
          allowedValues: ["ultra"],
          defaultValue: "ultra"
        }
      },
      parameters: { ...request.parameters, reasoningEffort: "ultra" }
    });

    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({
      ok: false,
      error: expect.objectContaining({
        code: "LLM_PROVIDER_ERROR",
        message: "Invalid parameter value for reasoning_effort."
      })
    });
  });

  test("preserves streaming reasoning_effort value rejection errors", async () => {
    const calls: OpenAiCompatibleTransportRequest[] = [];
    const provider = createOpenAiCompatibleProvider({
      transport: async () => readFixture("openai-compatible-chat-success.json"),
      streamTransport: async function* (transportRequest) {
        calls.push(transportRequest);
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
        yield {};
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
        modelProfile: {
          ...request.modelProfile,
          reasoningCapability: {
            providerParamName: "reasoning_effort",
            allowedValues: ["ultra"],
            defaultValue: "ultra"
          }
        },
        parameters: {
          ...request.parameters,
          reasoningEffort: "ultra"
        }
      })
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toMatchObject({
      reasoning_effort: "ultra"
    });
    expect(events).toContainEqual({
      ok: false,
      error: expect.objectContaining({
        code: "LLM_PROVIDER_ERROR",
        message: "Unsupported value: 'ultra'."
      })
    });
  });

  test("retries streaming requests when the provider does not recognize reasoning_effort", async () => {
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
                message: "Unknown parameter: reasoning_effort",
                param: "reasoning_effort",
                code: "unknown_parameter"
              }
            }
          });
        }
        yield { choices: [{ delta: { content: "Retried without reasoning." } }] };
        yield { choices: [{ delta: {}, finish_reason: "stop" }] };
      }
    });
    const adapter = createLlmAdapter({ provider, clock: () => "2026-07-08T00:00:00.000Z" });

    const events = await collectStream(
      adapter.stream({
        ...request,
        mode: "streaming",
        modelProfile: { ...request.modelProfile, reasoningEffortEnabled: true },
        parameters: { ...request.parameters, reasoningEffort: "high" }
      })
    );

    expect(calls).toHaveLength(2);
    expect(calls[1]?.body).not.toHaveProperty("reasoning_effort");
    expect(events).toContainEqual({
      ok: true,
      value: { type: "delta", value: "Retried without reasoning." }
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        ok: true,
        value: expect.objectContaining({ type: "warning", code: "LLM_REASONING_EFFORT_IGNORED" })
      })
    );
  });
  test("fails closed on duplicate authority for both generic and official OpenAI profiles", async () => {
    const provider = createOpenAiCompatibleProvider({
      transport: async () => ({ choices: [{ message: { content: "unused" } }] })
    });
    for (const providerId of ["openai-compatible", "openai"] as const) {
      await expect(
        provider.complete({
          ...request,
          modelProfile: { ...request.modelProfile, provider: providerId },
          messages: [
            { role: "system", content: "authority one" },
            { role: "developer", content: "authority two" },
            { role: "user", content: "request" }
          ]
        })
      ).rejects.toThrow("one leading authority");
    }
  });

  test("rejects a tool result that appears before its assistant call", async () => {
    const provider = createOpenAiCompatibleProvider({
      transport: async () => ({ choices: [{ message: { content: "unused" } }] })
    });
    await expect(
      provider.complete({
        ...request,
        messages: [
          { role: "developer", content: "authority" },
          { role: "tool", toolCallId: "call-1", content: "orphan" },
          {
            role: "assistant",
            content: "",
            toolCalls: [{ id: "call-1", name: "read_file", arguments: "{}" }]
          }
        ]
      })
    ).rejects.toThrow("prior assistant tool call");
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
