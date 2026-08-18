import { describe, expect, test } from "vitest";

import { isErr, isOk, type JsonObject } from "@novel-studio/shared";

import {
  createLlmAdapter,
  isSha256Checksum,
  type LlmProviderStreamEvent,
  type LlmRequest
} from "../src/index.js";
import {
  AnthropicHttpError,
  createAnthropicProvider,
  type AnthropicTransportRequest
} from "../src/anthropic-provider.js";

const request = {
  schemaVersion: "1.0",
  requestId: "llmreq_anthropic_01",
  traceId: "trace_anthropic_01",
  mode: "non-streaming",
  modelProfile: {
    id: "model_anthropic",
    provider: "anthropic",
    displayName: "Anthropic Fixture",
    modelName: "claude-fixture",
    baseUrl: "https://api.anthropic.example",
    apiKeyRef: "secret://model_anthropic/api_key",
    timeoutMs: 1000
  },
  messages: [
    { role: "developer", content: "Return one sentence." },
    { role: "user", content: "Write a rainy city line." }
  ],
  parameters: { temperature: 0.4, maxTokens: 64, topP: 0.9 }
} satisfies LlmRequest;

describe("Anthropic provider", () => {
  test("adds an explicit cache breakpoint at the frozen message boundary", async () => {
    const calls: AnthropicTransportRequest[] = [];
    const provider = createAnthropicProvider({
      transport: async (transportRequest) => {
        calls.push(transportRequest);
        return {
          content: [{ type: "text", text: "Cached response." }],
          usage: {
            input_tokens: 8,
            output_tokens: 4,
            cache_creation_input_tokens: 20,
            cache_read_input_tokens: 0
          }
        };
      }
    });
    const result = await createLlmAdapter({ provider }).complete({
      ...request,
      messages: [
        { role: "system", content: "System guidance." },
        { role: "user", content: "Stable project context." },
        { role: "user", content: "Dynamic request." }
      ],
      promptCache: {
        mode: "explicit_breakpoints",
        policyVersion: "anthropic-explicit@1.0",
        identityChecksum: "a".repeat(64),
        logicalPrefixChecksum: "b".repeat(64),
        stablePrefixMessageCount: 2,
        minimumCacheableTokens: 1,
        eligibleInputTokens: 20,
        ttlSeconds: 300
      }
    });

    expect(calls[0]?.body).toMatchObject({
      system: "System guidance.",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Stable project context.",
              cache_control: { type: "ephemeral" }
            }
          ]
        },
        { role: "user", content: "Dynamic request." }
      ]
    });
    expect(JSON.stringify(calls[0]?.body)).not.toContain("promptCache");
    expect(isOk(result)).toBe(true);
    if (!result.ok) return;
    expect(result.value.usage).toMatchObject({
      inputTokens: 8,
      outputTokens: 4,
      cacheWriteTokens: 20,
      cacheReadTokens: 0,
      cacheEligibleInputTokens: 20,
      cacheOutcome: "miss",
      cacheUsageStatus: "actual",
      cacheInputTokenSemantics: "excluded_from_input"
    });
    expect(isSha256Checksum(result.value.usage.cachePhysicalPrefixChecksum)).toBe(true);
  });

  test("maps non-streaming Messages API requests and response usage", async () => {
    const calls: AnthropicTransportRequest[] = [];
    const provider = createAnthropicProvider({
      transport: async (transportRequest) => {
        calls.push(transportRequest);
        return {
          content: [{ type: "text", text: "The city answered with rain." }],
          usage: {
            input_tokens: 14,
            output_tokens: 7,
            cache_creation_input_tokens: 3,
            cache_read_input_tokens: 2
          }
        };
      },
      resolveApiKey: async () => "sk-ant-secret"
    });
    const adapter = createLlmAdapter({ provider, clock: () => "2026-07-26T00:00:00.000Z" });

    const result = await adapter.complete(request);

    expect(calls).toEqual([
      {
        url: "https://api.anthropic.example/v1/messages",
        headers: { "anthropic-version": "2023-06-01", "x-api-key": "sk-ant-secret" },
        body: {
          model: "claude-fixture",
          max_tokens: 64,
          messages: [{ role: "user", content: "Write a rainy city line." }],
          stream: false,
          system: "Return one sentence.",
          temperature: 0.4,
          top_p: 0.9
        },
        timeoutMs: 1000
      }
    ]);
    expect(isOk(result)).toBe(true);
    if (!result.ok) return;
    expect(result.value.content).toEqual({ type: "text", value: "The city answered with rain." });
    expect(result.value.usage).toEqual({
      inputTokens: 14,
      outputTokens: 7,
      cachedTokens: 2,
      cacheReadTokens: 2,
      cacheWriteTokens: 3,
      cacheEligibleInputTokens: 5,
      cacheOutcome: "hit",
      cacheUsageStatus: "actual",
      cacheInputTokenSemantics: "excluded_from_input",
      totalTokens: 26,
      usageStatus: "actual",
      cost: { amount: 0, currency: "USD", status: "unknown" }
    });
  });

  test("serializes Claude 3.7 reasoning as enabled budget thinking", async () => {
    const calls: AnthropicTransportRequest[] = [];
    const provider = createAnthropicProvider({
      transport: async (transportRequest) => {
        calls.push(transportRequest);
        return { content: [{ type: "text", text: "Budget response." }], usage: {} };
      }
    });

    const result = await createLlmAdapter({ provider }).complete({
      ...request,
      modelProfile: { ...request.modelProfile, modelName: "claude-3-7-sonnet-20250219" },
      parameters: { ...request.parameters, reasoningEffort: "high" }
    });

    expect(isOk(result)).toBe(true);
    expect(calls[0]?.body).toMatchObject({
      model: "claude-3-7-sonnet-20250219",
      thinking: { type: "enabled", budget_tokens: 8192 },
      max_tokens: 9216
    });
    expect(calls[0]?.body).not.toHaveProperty("temperature");
    expect(calls[0]?.body).not.toHaveProperty("top_p");
  });

  test("serializes Claude 4.6 reasoning as adaptive thinking with output effort", async () => {
    const calls: AnthropicTransportRequest[] = [];
    const provider = createAnthropicProvider({
      transport: async (transportRequest) => {
        calls.push(transportRequest);
        return { content: [{ type: "text", text: "Adaptive response." }], usage: {} };
      }
    });

    const result = await createLlmAdapter({ provider }).complete({
      ...request,
      modelProfile: { ...request.modelProfile, modelName: "claude-opus-4-6" },
      parameters: { ...request.parameters, reasoningEffort: "max" }
    });

    expect(isOk(result)).toBe(true);
    expect(calls[0]?.body).toMatchObject({
      thinking: { type: "adaptive" },
      output_config: { effort: "max" }
    });
  });

  test("rejects an unsupported Claude reasoning value before transport", async () => {
    const calls: AnthropicTransportRequest[] = [];
    const provider = createAnthropicProvider({
      transport: async (transportRequest) => {
        calls.push(transportRequest);
        return { content: [], usage: {} };
      }
    });

    const result = await createLlmAdapter({ provider }).complete({
      ...request,
      modelProfile: { ...request.modelProfile, modelName: "claude-sonnet-4-20250514" },
      parameters: { ...request.parameters, reasoningEffort: "max" }
    });

    expect(isErr(result)).toBe(true);
    expect(calls).toHaveLength(0);
  });

  test("maps tool results and streams text, tool JSON deltas, usage, and stop reasons", async () => {
    const calls: AnthropicTransportRequest[] = [];
    const provider = createAnthropicProvider({
      transport: async () => ({ content: [], usage: {} }),
      streamTransport: async function* (transportRequest) {
        calls.push(transportRequest);
        yield {
          type: "message_start",
          message: { usage: { input_tokens: 12, cache_read_input_tokens: 4 } }
        };
        yield {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "toolu_01", name: "read_chapter" }
        };
        yield {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: '{"chapter' }
        };
        yield {
          type: "content_block_delta",
          index: 1,
          delta: { type: "text_delta", text: "I will inspect it." }
        };
        yield {
          type: "message_delta",
          delta: { stop_reason: "tool_use" },
          usage: { output_tokens: 5 }
        };
      }
    });
    const adapter = createLlmAdapter({ provider, clock: () => "2026-07-26T00:00:00.000Z" });

    const events = await collectStream(
      adapter.stream({
        ...request,
        mode: "streaming",
        messages: [
          {
            role: "assistant",
            content: "",
            toolCalls: [{ id: "toolu_previous", name: "read_chapter", arguments: '{"id":"ch_01"}' }]
          },
          { role: "tool", toolCallId: "toolu_previous", content: "Chapter body" },
          { role: "user", content: "Continue." }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "read_chapter",
              description: "Read a chapter.",
              parameters: { type: "object", properties: { id: { type: "string" } } }
            }
          }
        ]
      })
    );

    expect(calls[0]).toMatchObject({
      url: "https://api.anthropic.example/v1/messages",
      body: {
        stream: true,
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_previous",
                name: "read_chapter",
                input: { id: "ch_01" }
              }
            ]
          },
          {
            role: "user",
            content: [
              { type: "tool_result", tool_use_id: "toolu_previous", content: "Chapter body" }
            ]
          },
          { role: "user", content: "Continue." }
        ],
        tools: [
          {
            name: "read_chapter",
            description: "Read a chapter.",
            input_schema: { type: "object", properties: { id: { type: "string" } } }
          }
        ]
      }
    });
    expect(events).toEqual([
      expect.objectContaining({ ok: true, value: expect.objectContaining({ type: "start" }) }),
      {
        ok: true,
        value: { type: "tool_call_delta", toolCallId: "toolu_01", name: "read_chapter" }
      },
      {
        ok: true,
        value: { type: "tool_call_delta", toolCallId: "toolu_01", argumentsDelta: '{"chapter' }
      },
      { ok: true, value: { type: "delta", value: "I will inspect it." } },
      {
        ok: true,
        value: {
          type: "usage",
          usage: {
            inputTokens: 12,
            outputTokens: 5,
            cachedTokens: 4,
            cacheReadTokens: 4,
            cacheEligibleInputTokens: 4,
            cacheOutcome: "hit",
            cacheUsageStatus: "actual",
            cacheInputTokenSemantics: "excluded_from_input",
            totalTokens: 21,
            usageStatus: "actual",
            cost: { amount: 0, currency: "USD", status: "unknown" }
          }
        }
      },
      { ok: true, value: { type: "round_completed", finishReason: "tool_calls" } },
      expect.objectContaining({ ok: true, value: expect.objectContaining({ type: "done" }) })
    ]);
  });

  test("preserves the exact Anthropic assistant block order across a streamed tool round", async () => {
    const provider = createAnthropicProvider({
      transport: async () => ({ content: [], usage: {} }),
      streamTransport: async function* () {
        yield { type: "message_start", message: { usage: { input_tokens: 4 } } };
        yield {
          type: "content_block_start",
          index: 0,
          content_block: { type: "thinking", thinking: "" }
        };
        yield {
          type: "content_block_delta",
          index: 0,
          delta: { type: "thinking_delta", thinking: "Inspect the chapter." }
        };
        yield {
          type: "content_block_delta",
          index: 0,
          delta: { type: "signature_delta", signature: "signed-thinking-state" }
        };
        yield { type: "content_block_stop", index: 0 };
        yield {
          type: "content_block_start",
          index: 1,
          content_block: { type: "text", text: "" }
        };
        yield {
          type: "content_block_delta",
          index: 1,
          delta: { type: "text_delta", text: "I will inspect both." }
        };
        yield { type: "content_block_stop", index: 1 };
        yield {
          type: "content_block_start",
          index: 2,
          content_block: {
            type: "tool_use",
            id: "toolu_chapter",
            name: "read_chapter",
            input: {}
          }
        };
        yield {
          type: "content_block_delta",
          index: 2,
          delta: { type: "input_json_delta", partial_json: '{"chapter":1}' }
        };
        yield { type: "content_block_stop", index: 2 };
        yield {
          type: "content_block_start",
          index: 3,
          content_block: { type: "thinking", thinking: "Inspect the outline." }
        };
        yield {
          type: "content_block_delta",
          index: 3,
          delta: { type: "signature_delta", signature: "signed-second-thinking-state" }
        };
        yield { type: "content_block_stop", index: 3 };
        yield {
          type: "content_block_start",
          index: 4,
          content_block: {
            type: "tool_use",
            id: "toolu_outline",
            name: "search_project",
            input: { query: "motive" }
          }
        };
        yield { type: "content_block_stop", index: 4 };
        yield {
          type: "message_delta",
          delta: { stop_reason: "tool_use" },
          usage: { output_tokens: 3 }
        };
      }
    });
    const rawEvents: LlmProviderStreamEvent[] = [];
    for await (const event of provider.stream({
      ...request,
      mode: "streaming",
      modelProfile: { ...request.modelProfile, modelName: "claude-sonnet-4-20250514" },
      parameters: { ...request.parameters, reasoningEffort: "high" }
    })) {
      rawEvents.push(event);
    }
    const metadataEvents = rawEvents.filter(
      (event): event is Extract<LlmProviderStreamEvent, { readonly type: "tool_call_delta" }> =>
        event.type === "tool_call_delta" && event.providerMetadata !== undefined
    );
    expect(metadataEvents).toHaveLength(2);
    expect(metadataEvents[0]).toMatchObject({
      providerMetadata: {
        anthropicAssistantBlocks: [
          {
            type: "thinking",
            thinking: "Inspect the chapter.",
            signature: "signed-thinking-state"
          },
          { type: "text", text: "I will inspect both." },
          {
            type: "tool_use",
            id: "toolu_chapter",
            name: "read_chapter",
            input: { chapter: 1 }
          },
          {
            type: "thinking",
            thinking: "Inspect the outline.",
            signature: "signed-second-thinking-state"
          },
          {
            type: "tool_use",
            id: "toolu_outline",
            name: "search_project",
            input: { query: "motive" }
          }
        ]
      }
    });
    expect(metadataEvents[1]).toMatchObject({
      providerMetadata: metadataEvents[0]?.providerMetadata
    });
    const providerMetadata = metadataEvents[0];
    if (
      providerMetadata?.type !== "tool_call_delta" ||
      providerMetadata.providerMetadata === undefined
    ) {
      return;
    }

    const replayCalls: AnthropicTransportRequest[] = [];
    const replayProvider = createAnthropicProvider({
      transport: async (transportRequest) => {
        replayCalls.push(transportRequest);
        return { content: [{ type: "text", text: "Continued." }], usage: {} };
      }
    });
    await createLlmAdapter({ provider: replayProvider }).complete({
      ...request,
      modelProfile: { ...request.modelProfile, modelName: "claude-sonnet-4-20250514" },
      messages: [
        {
          role: "assistant",
          content: "I will inspect both.",
          toolCalls: [
            {
              id: "toolu_chapter",
              name: "read_chapter",
              arguments: '{"chapter":1}',
              providerMetadata: providerMetadata.providerMetadata
            },
            {
              id: "toolu_outline",
              name: "search_project",
              arguments: '{"query":"motive"}',
              providerMetadata: providerMetadata.providerMetadata
            }
          ]
        },
        { role: "tool", toolCallId: "toolu_chapter", content: "Chapter body" },
        { role: "tool", toolCallId: "toolu_outline", content: "Outline matches" },
        { role: "user", content: "Continue." }
      ],
      parameters: { ...request.parameters, reasoningEffort: "high" }
    });

    expect(replayCalls[0]?.body).toMatchObject({
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "thinking",
              thinking: "Inspect the chapter.",
              signature: "signed-thinking-state"
            },
            { type: "text", text: "I will inspect both." },
            {
              type: "tool_use",
              id: "toolu_chapter",
              name: "read_chapter",
              input: { chapter: 1 }
            },
            {
              type: "thinking",
              thinking: "Inspect the outline.",
              signature: "signed-second-thinking-state"
            },
            {
              type: "tool_use",
              id: "toolu_outline",
              name: "search_project",
              input: { query: "motive" }
            }
          ]
        },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "toolu_chapter" }]
        },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "toolu_outline" }]
        },
        { role: "user", content: "Continue." }
      ]
    });
  });

  test("rejects Anthropic continuation state that diverges from the normalized message", async () => {
    const baseBlocks: JsonObject[] = [
      {
        type: "thinking",
        thinking: "Inspect the chapter.",
        signature: "signed-thinking-state"
      },
      { type: "text", text: "I will inspect it." },
      {
        type: "tool_use",
        id: "toolu_chapter",
        name: "read_chapter",
        input: { chapter: 1 }
      }
    ];
    const cases: readonly {
      readonly label: string;
      readonly content: string;
      readonly blocks: JsonObject[];
    }[] = [
      { label: "text", content: "Different text.", blocks: baseBlocks },
      {
        label: "tool id",
        content: "I will inspect it.",
        blocks: baseBlocks.map((block) =>
          block["type"] === "tool_use" ? { ...block, id: "toolu_other" } : block
        )
      },
      {
        label: "tool name",
        content: "I will inspect it.",
        blocks: baseBlocks.map((block) =>
          block["type"] === "tool_use" ? { ...block, name: "search_project" } : block
        )
      },
      {
        label: "tool input",
        content: "I will inspect it.",
        blocks: baseBlocks.map((block) =>
          block["type"] === "tool_use" ? { ...block, input: { chapter: 2 } } : block
        )
      }
    ];

    for (const testCase of cases) {
      let transportCalls = 0;
      const provider = createAnthropicProvider({
        transport: async () => {
          transportCalls += 1;
          return { content: [{ type: "text", text: "unused" }], usage: {} };
        }
      });
      const result = await createLlmAdapter({ provider }).complete({
        ...request,
        modelProfile: { ...request.modelProfile, modelName: "claude-sonnet-4-20250514" },
        messages: [
          {
            role: "assistant",
            content: testCase.content,
            toolCalls: [
              {
                id: "toolu_chapter",
                name: "read_chapter",
                arguments: '{"chapter":1}',
                providerMetadata: { anthropicAssistantBlocks: testCase.blocks }
              }
            ]
          },
          { role: "tool", toolCallId: "toolu_chapter", content: "Chapter body" },
          { role: "user", content: "Continue." }
        ],
        parameters: { ...request.parameters, reasoningEffort: "high" }
      });

      expect(isErr(result), testCase.label).toBe(true);
      if (!result.ok) expect(result.error.code, testCase.label).toBe("LLM_PROVIDER_ERROR");
      expect(transportCalls, testCase.label).toBe(0);
    }
  });

  test("emits an empty JSON object for a zero-argument streamed tool call", async () => {
    const provider = createAnthropicProvider({
      transport: async () => ({ content: [], usage: {} }),
      streamTransport: async function* () {
        yield { type: "message_start", message: { usage: { input_tokens: 1 } } };
        yield {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "toolu_zero", name: "finish", input: {} }
        };
        yield { type: "content_block_stop", index: 0 };
        yield {
          type: "message_delta",
          delta: { stop_reason: "tool_use" },
          usage: { output_tokens: 1 }
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
        toolCallId: "toolu_zero",
        argumentsDelta: "{}"
      }
    });
  });

  test("normalizes HTTP errors without leaking API keys", async () => {
    const provider = createAnthropicProvider({
      transport: async () => {
        throw new AnthropicHttpError({
          status: 429,
          message: "Rate limited.",
          body: { error: { message: "Slow down." }, request_id: "req_ant_01" },
          headers: { "x-api-key": "sk-ant-secret", "request-id": "req_ant_01" }
        });
      }
    });
    const result = await createLlmAdapter({ provider }).complete(request);

    expect(isErr(result)).toBe(true);
    if (result.ok) return;
    expect(result.error.code).toBe("LLM_RATE_LIMITED");
    expect(result.error.message).toBe("Slow down.");
    expect(JSON.stringify(result.error.redactedDetail)).not.toContain("sk-ant-secret");
    expect(result.error.redactedDetail).toMatchObject({
      providerStatus: 429,
      providerRequestId: "req_ant_01",
      "x-api-key": "[REDACTED]"
    });
  });

  test("reports caller cancellation as LLM_ABORTED", async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = createAnthropicProvider({ transport: async () => ({}) });
    const result = await createLlmAdapter({ provider }).complete({
      ...request,
      abortSignal: controller.signal
    });

    expect(isErr(result)).toBe(true);
    if (result.ok) return;
    expect(result.error.code).toBe("LLM_ABORTED");
  });

  test("fails a truncated stream instead of returning a false success", async () => {
    const provider = createAnthropicProvider({
      transport: async () => ({}),
      streamTransport: async function* () {
        yield {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "partial" }
        };
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

  test("normalizes provider timeout responses as retryable LLM_TIMEOUT", async () => {
    const provider = createAnthropicProvider({
      transport: async () => {
        throw new AnthropicHttpError({ status: 408, message: "Timed out." });
      }
    });
    const result = await createLlmAdapter({ provider }).complete(request);

    expect(isErr(result)).toBe(true);
    if (!result.ok) {
      expect(result.error).toMatchObject({ code: "LLM_TIMEOUT", recoverability: "retryable" });
    }
  });
  test("rejects duplicate authority instead of joining it into one system block", async () => {
    const provider = createAnthropicProvider({
      transport: async () => ({ content: [{ type: "text", text: "unused" }] })
    });
    await expect(
      provider.complete({
        ...request,
        messages: [
          { role: "system", content: "authority one" },
          { role: "developer", content: "authority two" },
          { role: "user", content: "request" }
        ]
      })
    ).rejects.toThrow("one leading authority");
  });
});

async function collectStream(stream: AsyncIterable<unknown>): Promise<unknown[]> {
  const events: unknown[] = [];
  for await (const event of stream) events.push(event);
  return events;
}
