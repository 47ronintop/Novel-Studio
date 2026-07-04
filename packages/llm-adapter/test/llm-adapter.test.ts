import { describe, expect, test } from "vitest";

import { isErr, isOk } from "@novel-studio/shared";

import {
  createLlmAdapter,
  createMockProvider,
  type LlmProvider,
  type LlmRequest
} from "../src/index.js";

const request = {
  schemaVersion: "1.0",
  requestId: "llmreq_mock_01",
  traceId: "trace_m6_01",
  mode: "non-streaming",
  modelProfile: {
    id: "model_mock",
    provider: "mock",
    displayName: "Mock Model",
    modelName: "mock-novelist",
    timeoutMs: 1000
  },
  messages: [
    {
      role: "system",
      content: "You are a structured writing assistant."
    },
    {
      role: "user",
      content: "Draft one sentence."
    }
  ],
  parameters: {
    temperature: 0.7,
    maxTokens: 128,
    topP: 1
  }
} satisfies LlmRequest;

describe("LLM Adapter", () => {
  test("returns a provider-neutral non-streaming response from the mock provider", async () => {
    const adapter = createLlmAdapter({
      provider: createMockProvider({
        completions: [
          {
            type: "success",
            content: {
              type: "text",
              value: "The rain kept its own counsel over the city."
            },
            usage: {
              inputTokens: 12,
              outputTokens: 10,
              totalTokens: 22,
              usageStatus: "actual",
              cost: {
                amount: 0.002,
                currency: "USD",
                status: "estimated"
              }
            }
          }
        ]
      }),
      clock: () => "2026-07-04T00:00:00.000Z"
    });

    const result = await adapter.complete(request);

    expect(isOk(result)).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value).toEqual({
      schemaVersion: "1.0",
      requestId: "llmreq_mock_01",
      provider: "mock",
      modelName: "mock-novelist",
      status: "success",
      content: {
        type: "text",
        value: "The rain kept its own counsel over the city."
      },
      usage: {
        inputTokens: 12,
        outputTokens: 10,
        totalTokens: 22,
        usageStatus: "actual",
        cost: {
          amount: 0.002,
          currency: "USD",
          status: "estimated"
        }
      },
      createdAt: "2026-07-04T00:00:00.000Z"
    });
  });

  test("yields provider-neutral streaming events from the mock provider", async () => {
    const adapter = createLlmAdapter({
      provider: createMockProvider({
        streams: [
          [
            {
              type: "delta",
              value: "The rain"
            },
            {
              type: "delta",
              value: " kept falling."
            },
            {
              type: "usage",
              usage: {
                inputTokens: 12,
                outputTokens: 5,
                totalTokens: 17,
                usageStatus: "actual",
                cost: {
                  amount: 0.001,
                  currency: "USD",
                  status: "estimated"
                }
              }
            }
          ]
        ]
      }),
      clock: () => "2026-07-04T00:00:00.000Z"
    });

    const events = [];
    for await (const event of adapter.stream({ ...request, mode: "streaming" })) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        ok: true,
        value: {
          type: "start",
          requestId: "llmreq_mock_01",
          provider: "mock",
          modelName: "mock-novelist",
          createdAt: "2026-07-04T00:00:00.000Z"
        }
      },
      {
        ok: true,
        value: {
          type: "delta",
          value: "The rain"
        }
      },
      {
        ok: true,
        value: {
          type: "delta",
          value: " kept falling."
        }
      },
      {
        ok: true,
        value: {
          type: "usage",
          usage: {
            inputTokens: 12,
            outputTokens: 5,
            totalTokens: 17,
            usageStatus: "actual",
            cost: {
              amount: 0.001,
              currency: "USD",
              status: "estimated"
            }
          }
        }
      },
      {
        ok: true,
        value: {
          type: "done",
          requestId: "llmreq_mock_01",
          provider: "mock",
          modelName: "mock-novelist",
          createdAt: "2026-07-04T00:00:00.000Z"
        }
      }
    ]);
  });

  test("normalizes request timeout before calling the provider", async () => {
    const adapter = createLlmAdapter({
      provider: createMockProvider({
        completions: [
          {
            type: "success",
            content: {
              type: "text",
              value: "This should not be called."
            }
          }
        ]
      }),
      clock: () => "2026-07-04T00:00:00.000Z"
    });

    const result = await adapter.complete({
      ...request,
      modelProfile: {
        ...request.modelProfile,
        timeoutMs: 0
      }
    });

    expect(isErr(result)).toBe(true);
    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe("LLM_TIMEOUT");
    expect(result.error.category).toBe("LLMAdapterError");
    expect(result.error.recoverability).toBe("retryable");
  });

  test("normalizes an in-flight provider timeout", async () => {
    const slowProvider: LlmProvider = {
      id: "mock",
      async complete() {
        await new Promise((resolve) => {
          setTimeout(resolve, 20);
        });
        return {
          content: {
            type: "text",
            value: "Late response."
          }
        };
      },
      stream() {
        return createMockProvider({ streams: [] }).stream(request);
      }
    };
    const adapter = createLlmAdapter({
      provider: slowProvider,
      clock: () => "2026-07-04T00:00:00.000Z"
    });

    const result = await adapter.complete({
      ...request,
      modelProfile: {
        ...request.modelProfile,
        timeoutMs: 1
      }
    });

    expect(isErr(result)).toBe(true);
    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe("LLM_TIMEOUT");
  });

  test("retries retryable provider errors with injected exponential backoff", async () => {
    const delays: number[] = [];
    const adapter = createLlmAdapter({
      provider: createMockProvider({
        completions: [
          {
            type: "error",
            code: "LLM_PROVIDER_ERROR",
            message: "Temporary provider failure.",
            retryable: true
          },
          {
            type: "success",
            content: {
              type: "text",
              value: "Recovered response."
            },
            usage: {
              inputTokens: 4,
              outputTokens: 2,
              totalTokens: 6,
              usageStatus: "actual",
              cost: {
                amount: 0.001,
                currency: "USD",
                status: "estimated"
              }
            }
          }
        ]
      }),
      clock: () => "2026-07-04T00:00:00.000Z",
      retryPolicy: {
        maxAttempts: 2,
        baseDelayMs: 25,
        maxDelayMs: 100,
        backoffMultiplier: 2,
        retryableCodes: ["LLM_PROVIDER_ERROR"]
      },
      scheduler: async (delayMs) => {
        delays.push(delayMs);
      }
    });

    const result = await adapter.complete(request);

    expect(delays).toEqual([25]);
    expect(isOk(result)).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.content).toEqual({
      type: "text",
      value: "Recovered response."
    });
  });

  test("normalizes rate limits and redacts provider secrets", async () => {
    const adapter = createLlmAdapter({
      provider: createMockProvider({
        completions: [
          {
            type: "error",
            code: "LLM_RATE_LIMITED",
            message: "Provider returned HTTP 429.",
            retryable: true,
            redactedDetail: {
              providerStatus: 429,
              authorization: "Bearer sk-secret",
              requestId: "provider_req_01"
            }
          }
        ]
      }),
      clock: () => "2026-07-04T00:00:00.000Z"
    });

    const result = await adapter.complete(request);

    expect(isErr(result)).toBe(true);
    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe("LLM_RATE_LIMITED");
    expect(result.error.category).toBe("LLMAdapterError");
    expect(JSON.stringify(result.error.redactedDetail)).not.toContain("sk-secret");
    expect(result.error.redactedDetail).toEqual({
      providerStatus: 429,
      authorization: "[REDACTED]",
      requestId: "provider_req_01"
    });
  });

  test("returns retry exhausted with the last normalized provider code", async () => {
    const adapter = createLlmAdapter({
      provider: createMockProvider({
        completions: [
          {
            type: "error",
            code: "LLM_RATE_LIMITED",
            message: "Provider returned HTTP 429.",
            retryable: true
          },
          {
            type: "error",
            code: "LLM_RATE_LIMITED",
            message: "Provider returned HTTP 429 again.",
            retryable: true
          }
        ]
      }),
      clock: () => "2026-07-04T00:00:00.000Z",
      retryPolicy: {
        maxAttempts: 2,
        baseDelayMs: 10,
        maxDelayMs: 10,
        backoffMultiplier: 2,
        retryableCodes: ["LLM_RATE_LIMITED"]
      },
      scheduler: async () => undefined
    });

    const result = await adapter.complete(request);

    expect(isErr(result)).toBe(true);
    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe("LLM_RETRY_EXHAUSTED");
    expect(result.error.redactedDetail).toEqual({
      attempts: 2,
      lastCode: "LLM_RATE_LIMITED"
    });
  });

  test("fills missing usage and unknown cost when provider usage is absent", async () => {
    const adapter = createLlmAdapter({
      provider: createMockProvider({
        completions: [
          {
            type: "success",
            content: {
              type: "text",
              value: "Usage was not returned."
            }
          }
        ]
      }),
      clock: () => "2026-07-04T00:00:00.000Z"
    });

    const result = await adapter.complete(request);

    expect(isOk(result)).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.usage).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      usageStatus: "missing",
      cost: {
        amount: 0,
        currency: "USD",
        status: "unknown"
      }
    });
  });

  test("yields normalized stream errors instead of throwing provider failures", async () => {
    const failingStreamProvider: LlmProvider = {
      id: "mock",
      async complete() {
        return {
          content: {
            type: "text",
            value: "unused"
          }
        };
      },
      stream() {
        return {
          [Symbol.asyncIterator]() {
            return {
              async next() {
                throw new Error("Stream transport failed.");
              }
            };
          }
        };
      }
    };
    const adapter = createLlmAdapter({
      provider: failingStreamProvider,
      clock: () => "2026-07-04T00:00:00.000Z"
    });

    const events = [];
    for await (const event of adapter.stream({ ...request, mode: "streaming" })) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        ok: true,
        value: {
          type: "start",
          requestId: "llmreq_mock_01",
          provider: "mock",
          modelName: "mock-novelist",
          createdAt: "2026-07-04T00:00:00.000Z"
        }
      },
      {
        ok: false,
        error: expect.objectContaining({
          code: "LLM_PROVIDER_ERROR",
          category: "LLMAdapterError",
          recoverability: "user-action"
        })
      }
    ]);
  });
});
