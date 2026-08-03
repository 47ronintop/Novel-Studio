import { describe, expect, test } from "vitest";

import { isErr, isOk } from "@novel-studio/shared";

import { checksumProviderPayload, createLlmAdapter, type LlmRequest } from "../src/index.js";
import {
  createGeminiProvider,
  createGeminiPromptCacheResourceDescriptor,
  GeminiHttpError,
  type GeminiTransportRequest
} from "../src/gemini-provider.js";

const request = {
  schemaVersion: "1.0",
  requestId: "llmreq_gemini_01",
  traceId: "trace_gemini_01",
  mode: "non-streaming",
  modelProfile: {
    id: "model_gemini",
    provider: "google-gemini",
    displayName: "Gemini Fixture",
    modelName: "gemini-fixture",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    apiKeyRef: "secret://model_gemini/api_key",
    timeoutMs: 1000
  },
  messages: [
    { role: "system", content: "Return one sentence." },
    { role: "user", content: "Write a rainy city line." }
  ],
  parameters: { temperature: 0.4, maxTokens: 64, topP: 0.9 }
} satisfies LlmRequest;

describe("Gemini provider", () => {
  test("uses a verified Main-owned cached content resource and sends only the dynamic suffix", async () => {
    const calls: GeminiTransportRequest[] = [];
    const provider = createGeminiProvider({
      transport: async (transportRequest) => {
        calls.push(transportRequest);
        return {
          candidates: [{ content: { role: "model", parts: [{ text: "Cached response." }] } }],
          usageMetadata: {
            promptTokenCount: 28,
            candidatesTokenCount: 4,
            cachedContentTokenCount: 20,
            totalTokenCount: 32
          }
        };
      }
    });
    const resourceDescriptor = createGeminiPromptCacheResourceDescriptor({
      ...request,
      messages: [
        { role: "system", content: "System guidance." },
        { role: "user", content: "Stable project context." },
        { role: "user", content: "Dynamic request." }
      ],
      promptCache: {
        mode: "explicit_resource",
        policyVersion: "gemini-resource@1.0",
        identityChecksum: "a".repeat(64),
        logicalPrefixChecksum: "b".repeat(64),
        stablePrefixMessageCount: 2,
        minimumCacheableTokens: 1,
        eligibleInputTokens: 20,
        ttlSeconds: 300
      }
    });
    expect(resourceDescriptor?.body).toEqual({
      model: "models/gemini-fixture",
      contents: [{ role: "user", parts: [{ text: "Stable project context." }] }],
      systemInstruction: { parts: [{ text: "System guidance." }] },
      ttl: "300s"
    });
    const physicalPrefixChecksum = resourceDescriptor?.physicalPrefixChecksum;
    expect(physicalPrefixChecksum).toBe(
      checksumProviderPayload({
        contents: [{ role: "user", parts: [{ text: "Stable project context." }] }],
        systemInstruction: { parts: [{ text: "System guidance." }] }
      })
    );
    if (physicalPrefixChecksum === undefined) return;
    const result = await createLlmAdapter({ provider }).complete({
      ...request,
      messages: [
        { role: "system", content: "System guidance." },
        { role: "user", content: "Stable project context." },
        { role: "user", content: "Dynamic request." }
      ],
      promptCache: {
        mode: "explicit_resource",
        policyVersion: "gemini-resource@1.0",
        identityChecksum: "a".repeat(64),
        logicalPrefixChecksum: "b".repeat(64),
        physicalPrefixChecksum,
        stablePrefixMessageCount: 2,
        minimumCacheableTokens: 1,
        eligibleInputTokens: 20,
        ttlSeconds: 300,
        resourceRef: "cachedContents/cache_fixture_01"
      }
    });

    expect(calls[0]?.body).toEqual({
      contents: [{ role: "user", parts: [{ text: "Dynamic request." }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 64, topP: 0.9 },
      cachedContent: "cachedContents/cache_fixture_01"
    });
    expect(isOk(result)).toBe(true);
    if (!result.ok) return;
    expect(result.value.usage).toMatchObject({
      cachedTokens: 20,
      cacheReadTokens: 20,
      cacheEligibleInputTokens: 20,
      cacheOutcome: "hit",
      cacheUsageStatus: "actual",
      cacheInputTokenSemantics: "included_in_input",
      cachePhysicalPrefixChecksum: physicalPrefixChecksum
    });
  });

  test("falls back to the complete uncached prompt when a resource checksum is stale", async () => {
    const calls: GeminiTransportRequest[] = [];
    const provider = createGeminiProvider({
      transport: async (transportRequest) => {
        calls.push(transportRequest);
        return {
          candidates: [{ content: { role: "model", parts: [{ text: "Uncached response." }] } }],
          usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 4, totalTokenCount: 34 }
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
        mode: "explicit_resource",
        policyVersion: "gemini-resource@1.0",
        identityChecksum: "a".repeat(64),
        logicalPrefixChecksum: "b".repeat(64),
        physicalPrefixChecksum: "c".repeat(64),
        stablePrefixMessageCount: 2,
        minimumCacheableTokens: 1,
        eligibleInputTokens: 20,
        ttlSeconds: 300,
        resourceRef: "cachedContents/cache_fixture_01"
      }
    });

    expect(calls[0]?.body).toMatchObject({
      contents: [
        { role: "user", parts: [{ text: "Stable project context." }] },
        { role: "user", parts: [{ text: "Dynamic request." }] }
      ],
      systemInstruction: { parts: [{ text: "System guidance." }] }
    });
    expect(calls[0]?.body).not.toHaveProperty("cachedContent");
    expect(isOk(result)).toBe(true);
    if (!result.ok) return;
    expect(result.value.usage).toMatchObject({
      cacheOutcome: "bypass",
      cacheBypassReason: "identity_unverified",
      cacheUsageStatus: "unavailable"
    });
  });

  test("records a resource creation write as a miss when no cache read is reported", async () => {
    const messages: LlmRequest["messages"] = [
      { role: "system", content: "System guidance." },
      { role: "user", content: "Stable project context." },
      { role: "user", content: "Dynamic request." }
    ];
    const cacheBase = {
      mode: "explicit_resource" as const,
      policyVersion: "gemini-resource@1.0",
      identityChecksum: "a".repeat(64),
      logicalPrefixChecksum: "b".repeat(64),
      stablePrefixMessageCount: 2,
      minimumCacheableTokens: 1,
      eligibleInputTokens: 20,
      ttlSeconds: 300
    };
    const descriptor = createGeminiPromptCacheResourceDescriptor({
      ...request,
      messages,
      promptCache: cacheBase
    });
    expect(descriptor).toBeDefined();
    if (descriptor === undefined) return;
    const provider = createGeminiProvider({
      transport: async () => ({
        candidates: [{ content: { role: "model", parts: [{ text: "Fresh response." }] } }],
        usageMetadata: { promptTokenCount: 28, candidatesTokenCount: 4, totalTokenCount: 32 }
      })
    });

    const result = await createLlmAdapter({ provider }).complete({
      ...request,
      messages,
      promptCache: {
        ...cacheBase,
        physicalPrefixChecksum: descriptor.physicalPrefixChecksum,
        resourceRef: "cachedContents/cache_new",
        resourceWriteTokens: 20
      }
    });

    expect(isOk(result)).toBe(true);
    if (!result.ok) return;
    expect(result.value.usage).toMatchObject({
      cacheWriteTokens: 20,
      cacheEligibleInputTokens: 20,
      cacheOutcome: "miss",
      cacheUsageStatus: "actual",
      cacheInputTokenSemantics: "included_in_input"
    });
    expect(result.value.usage).not.toHaveProperty("cacheReadTokens");
  });

  test("maps non-streaming generateContent requests and usage", async () => {
    const calls: GeminiTransportRequest[] = [];
    const provider = createGeminiProvider({
      transport: async (transportRequest) => {
        calls.push(transportRequest);
        return {
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  { text: "internal chain of thought", thought: true },
                  { text: "The city answered." }
                ]
              }
            }
          ],
          usageMetadata: {
            promptTokenCount: 11,
            candidatesTokenCount: 4,
            cachedContentTokenCount: 3,
            thoughtsTokenCount: 2,
            totalTokenCount: 15
          }
        };
      },
      resolveApiKey: async () => "gemini-secret"
    });
    const result = await createLlmAdapter({ provider }).complete(request);

    expect(calls).toEqual([
      {
        url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-fixture:generateContent",
        headers: { "x-goog-api-key": "gemini-secret" },
        body: {
          contents: [{ role: "user", parts: [{ text: "Write a rainy city line." }] }],
          systemInstruction: { parts: [{ text: "Return one sentence." }] },
          generationConfig: { temperature: 0.4, maxOutputTokens: 64, topP: 0.9 }
        },
        timeoutMs: 1000
      }
    ]);
    expect(isOk(result)).toBe(true);
    if (!result.ok) return;
    expect(result.value.content).toEqual({ type: "text", value: "The city answered." });
    expect(result.value.usage).toMatchObject({
      inputTokens: 11,
      outputTokens: 4,
      cachedTokens: 3,
      reasoningTokens: 2,
      totalTokens: 15,
      usageStatus: "actual"
    });
  });

  test("maps tool history and streams function calls, usage, and tool completion", async () => {
    const calls: GeminiTransportRequest[] = [];
    const provider = createGeminiProvider({
      transport: async () => ({ candidates: [] }),
      streamTransport: async function* (transportRequest) {
        calls.push(transportRequest);
        yield {
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  { text: "internal chain of thought", thought: true },
                  { text: "I will inspect it." },
                  {
                    functionCall: { name: "read_chapter", args: { id: "ch_02" } },
                    thoughtSignature: "gemini-test-signature"
                  }
                ]
              },
              finishReason: "STOP"
            }
          ],
          usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 5, totalTokenCount: 17 }
        };
      }
    });
    const events = await collect(
      createLlmAdapter({ provider }).stream({
        ...request,
        mode: "streaming",
        messages: [
          {
            role: "assistant",
            content: "",
            toolCalls: [
              {
                id: "call_previous",
                name: "read_chapter",
                arguments: '{"id":"ch_01"}',
                providerMetadata: { thoughtSignature: "previous-gemini-signature" }
              },
              {
                id: "call_search",
                name: "search_project",
                arguments: '{"query":"motive"}'
              }
            ]
          },
          { role: "tool", toolCallId: "call_previous", content: '{"body":"Chapter body"}' },
          { role: "tool", toolCallId: "call_search", content: '{"matches":2}' },
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
      url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-fixture:streamGenerateContent?alt=sse",
      body: {
        contents: [
          {
            role: "model",
            parts: [
              {
                functionCall: {
                  id: "call_previous",
                  name: "read_chapter",
                  args: { id: "ch_01" }
                },
                thoughtSignature: "previous-gemini-signature"
              },
              {
                functionCall: {
                  id: "call_search",
                  name: "search_project",
                  args: { query: "motive" }
                }
              }
            ]
          },
          {
            role: "user",
            parts: [
              {
                functionResponse: {
                  id: "call_previous",
                  name: "read_chapter",
                  response: { body: "Chapter body" }
                }
              },
              {
                functionResponse: {
                  id: "call_search",
                  name: "search_project",
                  response: { matches: 2 }
                }
              }
            ]
          },
          { role: "user", parts: [{ text: "Continue." }] }
        ],
        tools: [
          {
            functionDeclarations: [
              {
                name: "read_chapter",
                description: "Read a chapter.",
                parametersJsonSchema: {
                  type: "object",
                  properties: { id: { type: "string" } }
                }
              }
            ]
          }
        ]
      }
    });
    expect(events).toEqual([
      expect.objectContaining({ ok: true, value: expect.objectContaining({ type: "start" }) }),
      { ok: true, value: { type: "delta", value: "I will inspect it." } },
      {
        ok: true,
        value: {
          type: "tool_call_delta",
          toolCallId: expect.stringMatching(/^gemini_llmreq_gemini_01_/),
          name: "read_chapter",
          argumentsDelta: '{"id":"ch_02"}',
          providerMetadata: { thoughtSignature: "gemini-test-signature" }
        }
      },
      { ok: true, value: { type: "round_completed", finishReason: "tool_calls" } },
      {
        ok: true,
        value: {
          type: "usage",
          usage: expect.objectContaining({ inputTokens: 12, outputTokens: 5, totalTokens: 17 })
        }
      },
      expect.objectContaining({ ok: true, value: expect.objectContaining({ type: "done" }) })
    ]);
    expect(JSON.stringify(events)).not.toContain("internal chain of thought");
  });

  test("maps safety and malformed function finish reasons fail-closed", async () => {
    const events = await collectGeminiFinishReason("SAFETY");
    const malformedEvents = await collectGeminiFinishReason("MALFORMED_FUNCTION_CALL");

    expect(events).toContainEqual({
      ok: true,
      value: { type: "round_completed", finishReason: "content_filter" }
    });
    expect(malformedEvents).toContainEqual({
      ok: true,
      value: { type: "round_completed", finishReason: "error" }
    });
  });

  test("fails truncated streams and maps prompt blocking without returning a false success", async () => {
    const truncated = createGeminiProvider({
      transport: async () => ({}),
      streamTransport: async function* () {
        yield { candidates: [{ content: { parts: [{ text: "partial" }] } }] };
      }
    });
    const truncatedEvents = await collect(
      createLlmAdapter({ provider: truncated }).stream({ ...request, mode: "streaming" })
    );
    expect(truncatedEvents).toContainEqual({
      ok: false,
      error: expect.objectContaining({ code: "LLM_MALFORMED_RESPONSE" })
    });
    expect(truncatedEvents).not.toContainEqual({
      ok: true,
      value: expect.objectContaining({ type: "done" })
    });

    const blocked = createGeminiProvider({
      transport: async () => ({}),
      streamTransport: async function* () {
        yield { promptFeedback: { blockReason: "SAFETY" } };
      }
    });
    const blockedEvents = await collect(
      createLlmAdapter({ provider: blocked }).stream({ ...request, mode: "streaming" })
    );
    expect(blockedEvents).toContainEqual({
      ok: true,
      value: { type: "round_completed", finishReason: "content_filter" }
    });

    const failed = createGeminiProvider({
      transport: async () => ({}),
      streamTransport: async function* () {
        yield { error: { code: 503, message: "Provider unavailable." } };
      }
    });
    const failedEvents = await collect(
      createLlmAdapter({ provider: failed }).stream({ ...request, mode: "streaming" })
    );
    expect(failedEvents).toContainEqual({
      ok: false,
      error: expect.objectContaining({ code: "LLM_PROVIDER_ERROR" })
    });
    expect(failedEvents).not.toContainEqual({
      ok: true,
      value: expect.objectContaining({ type: "done" })
    });
  });

  test("normalizes provider timeout responses as retryable LLM_TIMEOUT", async () => {
    const provider = createGeminiProvider({
      transport: async () => {
        throw new GeminiHttpError({ status: 408, message: "Timed out." });
      }
    });
    const result = await createLlmAdapter({ provider }).complete(request);

    expect(isErr(result)).toBe(true);
    if (!result.ok) {
      expect(result.error).toMatchObject({ code: "LLM_TIMEOUT", recoverability: "retryable" });
    }
  });

  test("normalizes errors and caller cancellation without leaking keys", async () => {
    const provider = createGeminiProvider({
      transport: async () => {
        throw new GeminiHttpError({
          status: 429,
          message: "Rate limited.",
          body: { error: { message: "Slow down.", requestId: "gem_req_01" } },
          headers: { "x-goog-api-key": "gemini-secret", "x-request-id": "gem_req_01" }
        });
      }
    });
    const result = await createLlmAdapter({ provider }).complete(request);

    expect(isErr(result)).toBe(true);
    if (result.ok) return;
    expect(result.error.code).toBe("LLM_RATE_LIMITED");
    expect(result.error.message).toBe("Slow down.");
    expect(JSON.stringify(result.error.redactedDetail)).not.toContain("gemini-secret");

    const controller = new AbortController();
    controller.abort();
    const aborted = await createLlmAdapter({ provider }).complete({
      ...request,
      abortSignal: controller.signal
    });
    expect(isErr(aborted)).toBe(true);
    if (!aborted.ok) expect(aborted.error.code).toBe("LLM_ABORTED");
  });
  test("rejects duplicate authority and future tool pairing before serialization", async () => {
    const provider = createGeminiProvider({
      transport: async () => ({ candidates: [{ content: { parts: [{ text: "unused" }] } }] })
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
    await expect(
      provider.complete({
        ...request,
        messages: [
          { role: "system", content: "authority" },
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

async function collect(stream: AsyncIterable<unknown>): Promise<unknown[]> {
  const events: unknown[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

async function collectGeminiFinishReason(finishReason: string): Promise<unknown[]> {
  const provider = createGeminiProvider({
    transport: async () => ({}),
    streamTransport: async function* () {
      yield { candidates: [{ finishReason }] };
    }
  });
  return collect(createLlmAdapter({ provider }).stream({ ...request, mode: "streaming" }));
}
