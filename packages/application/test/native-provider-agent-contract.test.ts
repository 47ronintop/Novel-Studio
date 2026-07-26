import { describe, expect, test, vi } from "vitest";

import {
  createAnthropicProvider,
  createGeminiProvider,
  createLlmAdapter,
  createOpenAiCompatibleProvider,
  type AnthropicTransportRequest,
  type GeminiTransportRequest,
  type LlmProvider,
  type LlmProviderId,
  type OpenAiCompatibleTransportRequest
} from "@novel-studio/llm-adapter";

import { createAgentRunSession, createLlmAgentRunModelDriver } from "../src/index.js";

describe("provider Agent contracts", () => {
  test("OpenAI-compatible completes text -> tool call -> tool result -> final answer", async () => {
    const requests: OpenAiCompatibleTransportRequest[] = [];
    const provider = createOpenAiCompatibleProvider({
      transport: async () => ({ choices: [{ message: { content: "unused" } }] }),
      streamTransport: async function* (request) {
        requests.push(request);
        if (requests.length === 1) {
          yield {
            choices: [
              {
                delta: {
                  content: "我先读取章节。",
                  tool_calls: [
                    {
                      index: 0,
                      id: "openai_contract",
                      function: {
                        name: "read_chapter",
                        arguments: '{"chapterId":"chapter-03"}'
                      }
                    }
                  ]
                },
                finish_reason: "tool_calls"
              }
            ]
          };
          return;
        }
        yield {
          choices: [
            {
              delta: { content: "章节中的人物动机已经核对完成。" },
              finish_reason: "stop"
            }
          ]
        };
      }
    });

    const result = await runAgentContract("openai-compatible", "openai-contract", provider);

    expect(result.toolNames).toEqual(["read_chapter"]);
    expect(result.snapshot).toMatchObject({ status: "completed" });
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1]?.body)).toContain("openai_contract");
    expect(JSON.stringify(requests[1]?.body)).toContain("chapter body from executor");
    expect(JSON.stringify(requests[1]?.body)).toContain("tool_call_id");
  });

  test("Anthropic completes text -> tool call -> tool result -> final answer", async () => {
    const requests: AnthropicTransportRequest[] = [];
    const provider = createAnthropicProvider({
      transport: async () => ({ content: [{ type: "text", text: "unused" }], usage: {} }),
      streamTransport: async function* (request) {
        requests.push(request);
        if (requests.length === 1) {
          yield {
            type: "message_start",
            message: { usage: { input_tokens: 12 } }
          };
          yield {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: "我先读取章节。" }
          };
          yield {
            type: "content_block_start",
            index: 1,
            content_block: { type: "tool_use", id: "toolu_contract", name: "read_chapter" }
          };
          yield {
            type: "content_block_delta",
            index: 1,
            delta: { type: "input_json_delta", partial_json: '{"chapterId":"chapter-03"}' }
          };
          yield {
            type: "message_delta",
            delta: { stop_reason: "tool_use" },
            usage: { output_tokens: 8 }
          };
          yield { type: "message_stop" };
          return;
        }
        yield {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "章节中的人物动机已经核对完成。" }
        };
        yield {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { output_tokens: 10 }
        };
        yield { type: "message_stop" };
      }
    });

    const result = await runAgentContract("anthropic", "claude-contract", provider);

    expect(result.toolNames).toEqual(["read_chapter"]);
    expect(result.snapshot).toMatchObject({ status: "completed" });
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1]?.body)).toContain("toolu_contract");
    expect(JSON.stringify(requests[1]?.body)).toContain("chapter body from executor");
    expect(JSON.stringify(requests[1]?.body)).toContain("tool_result");
  });

  test("Gemini completes text -> tool call -> tool result -> final answer", async () => {
    const requests: GeminiTransportRequest[] = [];
    const provider = createGeminiProvider({
      transport: async () => ({
        candidates: [{ content: { role: "model", parts: [{ text: "unused" }] } }]
      }),
      streamTransport: async function* (request) {
        requests.push(request);
        if (requests.length === 1) {
          yield {
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [
                    { text: "我先读取章节。" },
                    {
                      functionCall: {
                        id: "gemini_contract",
                        name: "read_chapter",
                        args: { chapterId: "chapter-03" }
                      },
                      thoughtSignature: "gemini-continuation-signature"
                    }
                  ]
                },
                finishReason: "STOP"
              }
            ],
            usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 8, totalTokenCount: 20 }
          };
          return;
        }
        yield {
          candidates: [
            {
              content: {
                role: "model",
                parts: [{ text: "章节中的人物动机已经核对完成。" }]
              },
              finishReason: "STOP"
            }
          ],
          usageMetadata: { promptTokenCount: 24, candidatesTokenCount: 10, totalTokenCount: 34 }
        };
      }
    });

    const result = await runAgentContract("google-gemini", "gemini-contract", provider);

    expect(result.toolNames).toEqual(["read_chapter"]);
    expect(result.snapshot).toMatchObject({ status: "completed" });
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1]?.body)).toContain("gemini_contract");
    expect(JSON.stringify(requests[1]?.body)).toContain("chapter body from executor");
    expect(JSON.stringify(requests[1]?.body)).toContain("functionResponse");
    expect(JSON.stringify(result.roundEvents[0])).toContain("gemini-continuation-signature");
    expect(JSON.stringify(result.roundMessages[1])).toContain("gemini-continuation-signature");
    expect(JSON.stringify(requests[1]?.body)).toContain("gemini-continuation-signature");
  });

  test("Gemini prompt blocking fails the Agent run instead of completing an empty answer", async () => {
    const provider = createGeminiProvider({
      transport: async () => ({}),
      streamTransport: async function* () {
        yield { promptFeedback: { blockReason: "SAFETY" } };
      }
    });

    const result = await runAgentContract("google-gemini", "gemini-contract", provider, "failed");

    expect(result.snapshot).toMatchObject({ status: "failed" });
    expect(result.toolNames).toEqual([]);
  });
});

async function runAgentContract(
  providerId: Extract<LlmProviderId, "openai-compatible" | "anthropic" | "google-gemini">,
  modelName: string,
  provider: LlmProvider,
  expectedStatus: "completed" | "failed" = "completed"
): Promise<{
  readonly snapshot: Record<string, unknown>;
  readonly toolNames: readonly string[];
  readonly roundMessages: readonly unknown[][];
  readonly roundEvents: readonly unknown[][];
}> {
  const runId = `run_${providerId.replace(/[^a-z]+/g, "_")}_contract`;
  const toolNames: string[] = [];
  const baseDriver = createLlmAgentRunModelDriver({
    adapter: createLlmAdapter({ provider }),
    modelProfile: {
      id: `profile_${providerId}`,
      provider: providerId,
      displayName: providerId,
      modelName,
      baseUrl:
        providerId === "anthropic"
          ? "https://api.anthropic.example"
          : providerId === "google-gemini"
            ? "https://generativelanguage.googleapis.com/v1beta"
            : "https://api.openai.example/v1"
    }
  });
  const roundMessages: unknown[][] = [];
  const roundEvents: unknown[][] = [];
  const driver = {
    async *streamRound(input: Parameters<typeof baseDriver.streamRound>[0]) {
      roundMessages.push([...input.messages]);
      const events: unknown[] = [];
      for await (const event of baseDriver.streamRound(input)) {
        events.push(event);
        yield event;
      }
      roundEvents.push(events);
    }
  };
  const session = createAgentRunSession({
    coordinatorOptions: { createRunId: () => runId },
    repository: memoryRepository(),
    modelDriver: driver,
    startPreflight: echoStartPreflight(),
    readToolExecutor: {
      async execute(input: { readonly name: string }) {
        toolNames.push(input.name);
        return {
          ok: true as const,
          value: {
            summary: "Chapter read.",
            data: { content: "chapter body from executor" }
          }
        };
      }
    }
  } as unknown as Parameters<typeof createAgentRunSession>[0]);

  await session.startAgentRun(
    startCommand(providerId, modelName) as unknown as Parameters<typeof session.startAgentRun>[0]
  );
  await vi.waitFor(async () => {
    expect(await session.readAgentRun(runId)).toMatchObject({
      ok: true,
      value: { snapshot: { status: expectedStatus } }
    });
  });
  const read = await session.readAgentRun(runId);
  if (!read.ok) throw read.error;
  return {
    snapshot: read.value.snapshot as unknown as Record<string, unknown>,
    toolNames,
    roundMessages,
    roundEvents
  };
}

function startCommand(provider: string, modelName: string): Record<string, unknown> {
  return {
    projectId: "project-01",
    conversationId: "conv-01",
    commandId: "start-01",
    expectedRunRevision: 0,
    runDraftId: "draft_start-01",
    runDraftRevision: 1,
    runDraftChecksum: "checksum_start-01",
    operationMode: "execution",
    contextMode: "writing",
    writePolicy: "write_before_confirmation",
    userRequest: "核对第 3 章的人物动机。",
    providerCapabilitySnapshot: {
      profileId: "profile-01",
      provider,
      modelName,
      streaming: true,
      toolCalling: true,
      structuredArguments: true,
      contextWindow: 128_000,
      requiredContextTokens: 8_000
    }
  };
}

function echoStartPreflight() {
  return {
    async resolveStart(command: Record<string, unknown>) {
      const snapshot = (command["providerCapabilitySnapshot"] ?? {}) as Record<string, unknown>;
      return {
        ok: true as const,
        value: {
          operationMode: command["operationMode"] ?? "execution",
          contextMode: command["contextMode"] ?? "writing",
          writePolicy: command["writePolicy"] ?? "write_before_confirmation",
          writePolicyAcknowledged: false,
          userRequest: command["userRequest"] ?? "",
          model: {
            profileId: snapshot["profileId"] ?? "profile-01",
            provider: snapshot["provider"] ?? "demo",
            modelName: snapshot["modelName"] ?? "scripted-agent",
            capabilities: {
              streaming: true,
              toolCalling: true,
              structuredArguments: true,
              contextWindow: 128_000
            },
            requiredContextTokens: 8_000,
            reasoningStrength: { status: "hidden" as const, reason: "contract fixture" }
          },
          initialContextSources: []
        }
      };
    }
  };
}

function memoryRepository() {
  return {
    async writeSnapshot(snapshot: Record<string, unknown>) {
      return { ok: true as const, value: snapshot };
    },
    async appendEvent(event: Record<string, unknown>) {
      return { ok: true as const, value: event };
    },
    async writeCommandReceipt() {
      return { ok: true as const, value: {} };
    },
    async readSnapshot() {
      return { ok: true as const, value: undefined };
    },
    async readEvents() {
      return { ok: true as const, value: [] };
    }
  };
}
