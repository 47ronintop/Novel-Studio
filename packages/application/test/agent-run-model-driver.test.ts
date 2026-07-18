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
              argumentsDelta: '{"chapter'
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
        argumentsDelta: '{"chapter'
      },
      { type: "tool_call_delta", toolCallId: "call-1", argumentsDelta: 'Id":"chapter-03"}' },
      { type: "round_completed", finishReason: "tool_calls" }
    ]);
    expect(providerRequest?.["tools"]).toEqual([
      {
        type: "function",
        function: {
          name: "read_chapter",
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
});
