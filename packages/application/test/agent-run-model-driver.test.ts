import { createHash } from "node:crypto";

import { describe, expect, test } from "vitest";

import * as applicationExports from "../src/index.js";

describe("AgentRunModelDriver", () => {
  test("forwards structured usage events without exposing provider frames", async () => {
    const createDriver = (applicationExports as unknown as Record<string, unknown>)[
      "createLlmAgentRunModelDriver"
    ];
    expect(typeof createDriver).toBe("function");
    if (typeof createDriver !== "function") return;

    const usage = {
      inputTokens: 120,
      outputTokens: 30,
      cachedTokens: 40,
      reasoningTokens: 10,
      totalTokens: 150,
      usageStatus: "actual",
      cost: { amount: 0.0042, currency: "USD", status: "actual" }
    };
    const driver = (
      createDriver as (options: Record<string, unknown>) => {
        streamRound(input: Record<string, unknown>): AsyncIterable<Record<string, unknown>>;
      }
    )({
      adapter: {
        async *stream() {
          yield {
            ok: true,
            value: {
              type: "usage",
              usage,
              providerFrame: { authorization: "Bearer must-not-cross-boundary" }
            }
          };
          yield { ok: true, value: { type: "round_completed", finishReason: "stop" } };
        }
      },
      modelProfile: {
        id: "profile-usage",
        provider: "openai",
        displayName: "Usage model",
        modelName: "gpt-5"
      }
    });

    const events: Record<string, unknown>[] = [];
    for await (const event of driver.streamRound({
      runId: "run-usage",
      snapshot: {
        runRevision: 1,
        operationMode: "execution",
        contextMode: "writing",
        userRequest: "write"
      },
      messages: [{ role: "user", content: "write" }],
      tools: [],
      signal: new AbortController().signal
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "usage", usage },
      { type: "round_completed", finishReason: "stop" }
    ]);
    expect(JSON.stringify(events)).not.toContain("must-not-cross-boundary");
  });

  test("maps provider stream tool-call increments without treating ordinary text as a tool", async () => {
    const createDriver = (applicationExports as unknown as Record<string, unknown>)[
      "createLlmAgentRunModelDriver"
    ];
    expect(typeof createDriver).toBe("function");
    if (typeof createDriver !== "function") return;

    let providerRequest: Record<string, unknown> | undefined;
    const driver = (
      createDriver as (options: Record<string, unknown>) => {
        streamRound(input: Record<string, unknown>): AsyncIterable<Record<string, unknown>>;
      }
    )({
      adapter: {
        async *stream(request: Record<string, unknown>) {
          providerRequest = request;
          yield {
            ok: true,
            value: {
              type: "start",
              requestId: "r",
              provider: "openai-compatible",
              modelName: "m",
              createdAt: "now"
            }
          };
          yield { ok: true, value: { type: "delta", value: "plain text" } };
          yield {
            ok: true,
            value: {
              type: "tool_call_delta",
              toolCallId: "call-1",
              name: "read_chapter",
              argumentsDelta: '{"chapter',
              providerMetadata: { thoughtSignature: "signature-one" }
            }
          };
          yield {
            ok: true,
            value: {
              type: "tool_call_delta",
              toolCallId: "call-1",
              argumentsDelta: 'Id":"chapter-03"}'
            }
          };
          yield { ok: true, value: { type: "round_completed", finishReason: "tool_calls" } };
          yield {
            ok: true,
            value: {
              type: "done",
              requestId: "r",
              provider: "openai-compatible",
              modelName: "m",
              createdAt: "now"
            }
          };
        }
      },
      modelProfile: {
        id: "profile-01",
        provider: "openai-compatible",
        displayName: "Model",
        modelName: "model"
      },
      parameters: { temperature: 0.2 }
    });

    const events: Record<string, unknown>[] = [];
    for await (const event of driver.streamRound({
      runId: "run-01",
      snapshot: {
        operationMode: "planning",
        contextMode: "writing",
        userRequest: "read"
      },
      messages: [{ role: "user", content: "read" }],
      tools: [
        {
          name: "read_chapter",
          description: "Read one chapter.",
          inputSchema: {
            type: "object",
            additionalProperties: false,
            required: ["chapterId"],
            properties: { chapterId: { type: "string" } }
          }
        }
      ],
      signal: new AbortController().signal
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "assistant_text_delta", delta: "plain text" },
      {
        type: "tool_call_delta",
        toolCallId: "call-1",
        name: "read_chapter",
        argumentsDelta: '{"chapter',
        providerMetadata: { thoughtSignature: "signature-one" }
      },
      { type: "tool_call_delta", toolCallId: "call-1", argumentsDelta: 'Id":"chapter-03"}' },
      { type: "round_completed", finishReason: "tool_calls" }
    ]);
    expect(providerRequest?.["tools"]).toEqual([
      {
        type: "function",
        function: {
          name: "read_chapter",
          description: "Read one chapter.",
          parameters: {
            type: "object",
            additionalProperties: false,
            required: ["chapterId"],
            properties: { chapterId: { type: "string" } }
          }
        }
      }
    ]);
  });

  test("forwards the run snapshot's server-validated reasoning effort into provider parameters", async () => {
    const createDriver = (applicationExports as unknown as Record<string, unknown>)[
      "createLlmAgentRunModelDriver"
    ];
    if (typeof createDriver !== "function") return;

    let providerRequest: Record<string, unknown> | undefined;
    const driver = (
      createDriver as (options: Record<string, unknown>) => {
        streamRound(input: Record<string, unknown>): AsyncIterable<Record<string, unknown>>;
      }
    )({
      adapter: {
        async *stream(request: Record<string, unknown>) {
          providerRequest = request;
          yield { ok: true, value: { type: "round_completed", finishReason: "stop" } };
        }
      },
      modelProfile: {
        id: "profile-01",
        provider: "openai",
        displayName: "Model",
        modelName: "gpt-5"
      },
      // Static base parameters must be overridden by the run's validated reasoning effort.
      parameters: { temperature: 0.2, reasoningEffort: "low" }
    });

    for await (const _event of driver.streamRound({
      runId: "run-reasoning",
      snapshot: {
        runRevision: 1,
        operationMode: "execution",
        contextMode: "writing",
        userRequest: "write",
        reasoningEffort: "high"
      },
      messages: [{ role: "user", content: "write" }],
      tools: [],
      signal: new AbortController().signal
    })) {
      void _event;
    }

    expect((providerRequest?.["parameters"] as Record<string, unknown>)["reasoningEffort"]).toBe(
      "high"
    );
  });

  test("omits reasoning effort when the run snapshot carries none", async () => {
    const createDriver = (applicationExports as unknown as Record<string, unknown>)[
      "createLlmAgentRunModelDriver"
    ];
    if (typeof createDriver !== "function") return;

    let providerRequest: Record<string, unknown> | undefined;
    const driver = (
      createDriver as (options: Record<string, unknown>) => {
        streamRound(input: Record<string, unknown>): AsyncIterable<Record<string, unknown>>;
      }
    )({
      adapter: {
        async *stream(request: Record<string, unknown>) {
          providerRequest = request;
          yield { ok: true, value: { type: "round_completed", finishReason: "stop" } };
        }
      },
      modelProfile: {
        id: "profile-01",
        provider: "openai",
        displayName: "Model",
        modelName: "gpt-4o"
      },
      parameters: { temperature: 0.2 }
    });

    for await (const _event of driver.streamRound({
      runId: "run-no-reasoning",
      snapshot: {
        runRevision: 1,
        operationMode: "execution",
        contextMode: "writing",
        userRequest: "write"
      },
      messages: [{ role: "user", content: "write" }],
      tools: [],
      signal: new AbortController().signal
    })) {
      void _event;
    }

    expect(
      (providerRequest?.["parameters"] as Record<string, unknown>)["reasoningEffort"]
    ).toBeUndefined();
  });

  test("prepends the per-round mode-specific system guidance ahead of the run messages", async () => {
    const createDriver = (applicationExports as unknown as Record<string, unknown>)[
      "createLlmAgentRunModelDriver"
    ];
    if (typeof createDriver !== "function") return;

    let providerRequest: Record<string, unknown> | undefined;
    const driver = (
      createDriver as (options: Record<string, unknown>) => {
        streamRound(input: Record<string, unknown>): AsyncIterable<Record<string, unknown>>;
      }
    )({
      adapter: {
        async *stream(request: Record<string, unknown>) {
          providerRequest = request;
          yield { ok: true, value: { type: "round_completed", finishReason: "stop" } };
        }
      },
      modelProfile: {
        id: "profile-01",
        provider: "openai",
        displayName: "Model",
        modelName: "gpt-5"
      },
      // A static creation-time prompt must be overridden by the per-round, mode-specific guidance the
      // session computes from the run's context mode.
      systemPrompt: "static base prompt"
    });

    for await (const _event of driver.streamRound({
      runId: "run-guidance",
      snapshot: {
        runRevision: 1,
        operationMode: "execution",
        contextMode: "writing",
        userRequest: "write"
      },
      systemPrompt: "写作模式指导：保持叙事连续性。",
      messages: [{ role: "user", content: "write" }],
      tools: [],
      signal: new AbortController().signal
    })) {
      void _event;
    }

    const messages = providerRequest?.["messages"] as { role: string; content: string }[];
    expect(messages[0]).toEqual({ role: "system", content: "写作模式指导：保持叙事连续性。" });
    expect(messages.some((message) => message.content === "static base prompt")).toBe(false);
    expect(messages.at(-1)).toEqual({ role: "user", content: "write" });
  });

  test("counts the system message and frozen leading messages without caching the dynamic suffix", () => {
    const createCacheRequest = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRoundPromptCacheRequest"
    ];
    expect(typeof createCacheRequest).toBe("function");
    if (typeof createCacheRequest !== "function") return;

    let estimatedPayload = "";
    const request = (
      createCacheRequest as (
        input: Record<string, unknown>,
        messages: readonly Record<string, unknown>[],
        tools: readonly Record<string, unknown>[],
        estimator: { count(text: string, modelProfileId: string): unknown }
      ) => Record<string, unknown> | undefined
    )(
      {
        snapshot: cacheSnapshot({ stablePrefixMessageCount: 3 }),
        promptCacheConnectionIdentityChecksum: "c".repeat(64),
        promptCacheAccountIsolationChecksum: "d".repeat(64),
        messages: [],
        tools: []
      },
      [
        { role: "system", content: "frozen guidance" },
        { role: "user", content: "frozen conventions" },
        { role: "user", content: "frozen outline" },
        { role: "user", content: "dynamic request and current file body" }
      ],
      [
        {
          type: "function",
          function: { name: "read_file", parameters: { type: "object" } }
        }
      ],
      {
        count(text, modelProfileId) {
          estimatedPayload = text;
          expect(modelProfileId).toBe("profile-cache");
          return { tokens: 123, precision: "estimated" };
        }
      }
    );

    expect(request).toMatchObject({
      mode: "automatic_prefix",
      stablePrefixMessageCount: 3,
      eligibleInputTokens: 123,
      connectionIdentityChecksum: "c".repeat(64),
      accountIsolationChecksum: "d".repeat(64)
    });
    expect(estimatedPayload).toContain("frozen guidance");
    expect(estimatedPayload).toContain("frozen conventions");
    expect(estimatedPayload).toContain("frozen outline");
    expect(estimatedPayload).toContain("read_file");
    expect(estimatedPayload).not.toContain("dynamic request and current file body");
  });

  test("records a deterministic below-minimum cache bypass", () => {
    const createCacheRequest = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRoundPromptCacheRequest"
    ];
    expect(typeof createCacheRequest).toBe("function");
    if (typeof createCacheRequest !== "function") return;

    const request = (
      createCacheRequest as (
        input: Record<string, unknown>,
        messages: readonly Record<string, unknown>[],
        tools: readonly Record<string, unknown>[],
        estimator: { count(): unknown }
      ) => Record<string, unknown> | undefined
    )(
      {
        snapshot: cacheSnapshot({ minimumCacheableTokens: 101 }),
        messages: [],
        tools: []
      },
      [{ role: "system", content: "short prefix" }],
      [],
      { count: () => ({ tokens: 100, precision: "estimated" }) }
    );

    expect(request).toMatchObject({
      eligibleInputTokens: 100,
      bypassReason: "below_minimum_tokens"
    });
  });

  test("omits cache metadata for legacy or unverified run identities", () => {
    const createCacheRequest = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRoundPromptCacheRequest"
    ];
    expect(typeof createCacheRequest).toBe("function");
    if (typeof createCacheRequest !== "function") return;

    const request = (
      createCacheRequest as (
        input: Record<string, unknown>,
        messages: readonly Record<string, unknown>[],
        tools: readonly Record<string, unknown>[]
      ) => Record<string, unknown> | undefined
    )(
      {
        snapshot: cacheSnapshot({ identityChecksum: "legacy" }),
        messages: [],
        tools: []
      },
      [{ role: "system", content: "frozen guidance" }],
      []
    );

    expect(request).toBeUndefined();
  });

  test("uses an explicit Main-owned cache request ahead of snapshot derivation", async () => {
    const createDriver = (applicationExports as unknown as Record<string, unknown>)[
      "createLlmAgentRunModelDriver"
    ];
    expect(typeof createDriver).toBe("function");
    if (typeof createDriver !== "function") return;

    let providerRequest: Record<string, unknown> | undefined;
    const driver = (
      createDriver as (options: Record<string, unknown>) => {
        streamRound(input: Record<string, unknown>): AsyncIterable<Record<string, unknown>>;
      }
    )({
      adapter: {
        async *stream(request: Record<string, unknown>) {
          providerRequest = request;
          yield { ok: true, value: { type: "round_completed", finishReason: "stop" } };
        }
      },
      modelProfile: {
        id: "profile-cache",
        provider: "google-gemini",
        displayName: "Gemini",
        modelName: "gemini-1.5-pro"
      }
    });
    const promptCache = {
      mode: "explicit_resource",
      policyVersion: "gemini-explicit-resource@1.0",
      identityChecksum: "d".repeat(64),
      logicalPrefixChecksum: "e".repeat(64),
      stablePrefixMessageCount: 2,
      minimumCacheableTokens: 1,
      eligibleInputTokens: 80,
      resourceRef: "cachedContents/opaque-main-owned"
    };

    for await (const _event of driver.streamRound({
      runId: "run-explicit-cache",
      snapshot: {
        runRevision: 1,
        operationMode: "execution",
        contextMode: "writing",
        userRequest: "write"
      },
      systemPrompt: "guidance",
      messages: [{ role: "user", content: "write" }],
      tools: [],
      promptCache,
      signal: new AbortController().signal
    })) {
      void _event;
    }

    expect(providerRequest?.["promptCache"]).toEqual(promptCache);
  });

  test("fails closed on V20 authority drift before reaching the provider", async () => {
    const createDriver = (applicationExports as unknown as Record<string, unknown>)[
      "createLlmAgentRunModelDriver"
    ];
    if (typeof createDriver !== "function") return;
    let providerCalls = 0;
    const driver = (
      createDriver as (options: Record<string, unknown>) => {
        streamRound(input: Record<string, unknown>): AsyncIterable<Record<string, unknown>>;
      }
    )({
      adapter: {
        async *stream() {
          providerCalls += 1;
          yield { ok: true, value: { type: "round_completed", finishReason: "stop" } };
        }
      },
      modelProfile: {
        id: "profile-v20",
        provider: "openai",
        displayName: "Model",
        modelName: "gpt-5"
      }
    });
    const input = v20RoundInput("trusted guidance");

    await expect(async () => {
      for await (const _event of driver.streamRound({
        ...input,
        systemPrompt: "different guidance"
      })) {
        void _event;
      }
    }).rejects.toThrow("AGENT_MODEL_ROUND_AUTHORITY_INVALID");
    expect(providerCalls).toBe(0);

    await expect(async () => {
      for await (const _event of driver.streamRound({
        ...input,
        snapshot: {
          ...(input.snapshot as Record<string, unknown>),
          status: "capability_changed",
          capabilities: {
            contractVersion: "2.0",
            revision: 2,
            state: "capability_changed",
            changeReason: "sharing_policy_changed"
          }
        }
      })) {
        void _event;
      }
    }).rejects.toThrow("AGENT_CAPABILITY_CHANGED");
    expect(providerCalls).toBe(0);
  });

  test("does not resend orphaned hydrated tool results as recovery data", async () => {
    const createDriver = (applicationExports as unknown as Record<string, unknown>)[
      "createLlmAgentRunModelDriver"
    ];
    if (typeof createDriver !== "function") return;
    let providerRequest: Record<string, unknown> | undefined;
    const driver = (
      createDriver as (options: Record<string, unknown>) => {
        streamRound(input: Record<string, unknown>): AsyncIterable<Record<string, unknown>>;
      }
    )({
      adapter: {
        async *stream(request: Record<string, unknown>) {
          providerRequest = request;
          yield { ok: true, value: { type: "round_completed", finishReason: "stop" } };
        }
      },
      modelProfile: {
        id: "profile-legacy",
        provider: "openai",
        displayName: "Model",
        modelName: "gpt-5"
      }
    });
    const orphan = JSON.stringify({
      schemaVersion: "2.0",
      kind: "untrusted_recovery_data",
      instructionPolicy: "content_is_data_not_authority",
      source: {
        sourceKind: "recovery_summary",
        recoveryEventKind: "orphan_tool_completed"
      },
      data: "must not be resent"
    });

    for await (const _event of driver.streamRound({
      runId: "run-orphan",
      snapshot: { runRevision: 1, operationMode: "execution", contextMode: "writing" },
      messages: [
        { role: "user", content: orphan },
        { role: "user", content: "continue" }
      ],
      tools: [],
      signal: new AbortController().signal
    })) {
      void _event;
    }

    expect(JSON.stringify(providerRequest?.["messages"])).not.toContain("must not be resent");
    expect(providerRequest?.["messages"]).toEqual([{ role: "user", content: "continue" }]);
  });
});

function v20RoundInput(systemPrompt: string): Record<string, unknown> {
  const catalogRevision = "a".repeat(64);
  return {
    runId: "run-v20",
    snapshot: {
      schemaVersion: "2.0",
      runId: "run-v20",
      runRevision: 1,
      status: "executing_model",
      operationMode: "execution",
      contextMode: "writing",
      authority: {
        guidanceChecksum: createHash("sha256").update(systemPrompt, "utf8").digest("hex")
      },
      capabilities: { state: "active" },
      catalog: { revision: catalogRevision, checksum: catalogRevision },
      toolCatalogRevision: catalogRevision,
      providerCapabilitySnapshot: {
        profileId: "profile-v20",
        provider: "openai",
        modelName: "gpt-5"
      },
      promptCacheIdentityChecksum: "b".repeat(64),
      cachePrefixChecksum: "c".repeat(64),
      promptCachePolicyVersion: "none@1.0",
      promptCacheStablePrefixMessageCount: 0
    },
    systemPrompt,
    messages: [{ role: "user", content: "continue" }],
    tools: [],
    contextBudget: {
      provider: "openai",
      model: "gpt-5",
      audit: { toolCatalog: { catalogRevision, descriptorCount: 0 } }
    },
    signal: new AbortController().signal
  };
}

function cacheSnapshot(
  overrides: {
    readonly stablePrefixMessageCount?: number;
    readonly minimumCacheableTokens?: number;
    readonly identityChecksum?: string;
  } = {}
): Record<string, unknown> {
  return {
    runRevision: 1,
    operationMode: "execution",
    contextMode: "writing",
    userRequest: "dynamic request",
    cachePrefixChecksum: "a".repeat(64),
    promptCacheIdentityChecksum: overrides.identityChecksum ?? "b".repeat(64),
    promptCacheStablePrefixMessageCount: overrides.stablePrefixMessageCount ?? 1,
    providerCapabilitySnapshot: {
      profileId: "profile-cache",
      provider: "openai",
      modelName: "gpt-4.1",
      streaming: true,
      toolCalling: true,
      structuredArguments: true,
      contextWindow: 128_000,
      requiredContextTokens: 4_096,
      promptCache: {
        mode: "automatic_prefix",
        policyVersion: "openai-automatic-prefix@1.0",
        minimumCacheableTokens: overrides.minimumCacheableTokens ?? 1,
        ttlSeconds: null,
        inputTokenSemantics: "included_in_input",
        reportsCacheReadTokens: true,
        reportsCacheWriteTokens: false
      }
    }
  };
}
