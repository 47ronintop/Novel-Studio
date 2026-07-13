import type {
  LlmAdapter,
  LlmMessage,
  LlmModelProfile,
  LlmParameters,
  LlmToolDefinition
} from "@novel-studio/llm-adapter";

import type {
  AgentModelMessage,
  AgentModelRoundInput,
  AgentModelStreamEvent,
  AgentRunModelDriver
} from "./agent-run-session.js";

export interface CreateLlmAgentRunModelDriverOptions {
  readonly adapter: LlmAdapter;
  readonly modelProfile: LlmModelProfile;
  readonly parameters?: LlmParameters;
  readonly systemPrompt?: string;
}

export function createLlmAgentRunModelDriver(
  options: CreateLlmAgentRunModelDriverOptions
): AgentRunModelDriver {
  return {
    async *streamRound(input: AgentModelRoundInput): AsyncIterable<AgentModelStreamEvent> {
      const messages: LlmMessage[] = [
        ...(options.systemPrompt === undefined
          ? []
          : [{ role: "system" as const, content: options.systemPrompt }]),
        ...input.messages.map(toLlmMessage)
      ];
      const tools: LlmToolDefinition[] = input.tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          parameters: tool.inputSchema
        }
      }));
      const requestId = `agent_${input.runId}_${input.snapshot.runRevision}`;
      for await (const result of options.adapter.stream({
        schemaVersion: "1.0",
        requestId,
        traceId: requestId,
        mode: "streaming",
        modelProfile: options.modelProfile,
        messages,
        parameters: options.parameters ?? {},
        abortSignal: input.signal,
        ...(tools.length === 0 ? {} : { tools })
      })) {
        if (!result.ok) throw result.error;
        if (result.value.type === "delta") {
          yield { type: "assistant_text_delta", delta: result.value.value };
        } else if (result.value.type === "tool_call_delta") {
          yield {
            type: "tool_call_delta",
            toolCallId: result.value.toolCallId,
            ...(result.value.name === undefined ? {} : { name: result.value.name }),
            ...(result.value.argumentsDelta === undefined
              ? {}
              : { argumentsDelta: result.value.argumentsDelta })
          };
        } else if (result.value.type === "round_completed") {
          yield result.value;
        }
      }
    }
  };
}

function toLlmMessage(message: AgentModelMessage): LlmMessage {
  return {
    role: message.role,
    content: message.content,
    ...(message.toolCallId === undefined ? {} : { toolCallId: message.toolCallId }),
    ...(message.toolCalls === undefined ? {} : { toolCalls: message.toolCalls })
  };
}
