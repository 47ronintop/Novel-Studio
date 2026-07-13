import { describe, expect, test } from "vitest";

import * as applicationExports from "../src/index.js";

describe("AgentRunModelDriver", () => {
  test("maps provider stream tool-call increments without treating ordinary text as a tool", async () => {
    const createDriver = (applicationExports as unknown as Record<string, unknown>)[
      "createLlmAgentRunModelDriver"
    ];
    expect(typeof createDriver).toBe("function");
    if (typeof createDriver !== "function") return;

    let providerRequest: Record<string, unknown> | undefined;
    const driver = (createDriver as (options: Record<string, unknown>) => {
      streamRound(input: Record<string, unknown>): AsyncIterable<Record<string, unknown>>;
    })({
      adapter: {
        async *stream(request: Record<string, unknown>) {
          providerRequest = request;
          yield { ok: true, value: { type: "start", requestId: "r", provider: "openai-compatible", modelName: "m", createdAt: "now" } };
          yield { ok: true, value: { type: "delta", value: "plain text" } };
          yield { ok: true, value: { type: "tool_call_delta", toolCallId: "call-1", name: "read_chapter", argumentsDelta: "{\"chapter" } };
          yield { ok: true, value: { type: "tool_call_delta", toolCallId: "call-1", argumentsDelta: "Id\":\"chapter-03\"}" } };
          yield { ok: true, value: { type: "round_completed", finishReason: "tool_calls" } };
          yield { ok: true, value: { type: "done", requestId: "r", provider: "openai-compatible", modelName: "m", createdAt: "now" } };
        }
      },
      modelProfile: { id: "profile-01", provider: "openai-compatible", displayName: "Model", modelName: "model" },
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
      { type: "tool_call_delta", toolCallId: "call-1", name: "read_chapter", argumentsDelta: "{\"chapter" },
      { type: "tool_call_delta", toolCallId: "call-1", argumentsDelta: "Id\":\"chapter-03\"}" },
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
});
