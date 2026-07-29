import type {
  LlmAdapter,
  LlmMessage,
  LlmModelProfile,
  LlmParameters,
  LlmToolDefinition,
  LlmPromptCacheRequest,
  LlmRequest
} from "@novel-studio/llm-adapter";
import {
  createDeterministicTokenEstimator,
  type AgentTokenEstimator
} from "@novel-studio/agent-engine";

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
  /** Main-only resolver for provider resources. Failures degrade to a full uncached request. */
  readonly resolvePromptCache?: (request: LlmRequest) => Promise<LlmPromptCacheRequest | undefined>;
}

export function createLlmAgentRunModelDriver(
  options: CreateLlmAgentRunModelDriverOptions
): AgentRunModelDriver {
  return {
    async *streamRound(input: AgentModelRoundInput): AsyncIterable<AgentModelStreamEvent> {
      // The per-round, mode-specific guidance the session computes wins over any static base prompt.
      const systemPrompt = input.systemPrompt ?? options.systemPrompt;
      const messages: LlmMessage[] = [
        ...(systemPrompt === undefined ? [] : [{ role: "system" as const, content: systemPrompt }]),
        ...input.messages.map(toLlmMessage)
      ];
      const tools: LlmToolDefinition[] = input.tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          ...(tool.description === undefined ? {} : { description: tool.description }),
          parameters: tool.inputSchema
        }
      }));
      const requestId = `agent_${input.runId}_${input.snapshot.runRevision}`;
      const promptCache = input.disablePromptCache
        ? undefined
        : (input.promptCache ?? createAgentRoundPromptCacheRequest(input, messages, tools));
      // The run snapshot's reasoning effort is server-authoritative (validated against the model at
      // start). It overrides any static reasoning in the driver's base parameters so the value the
      // preflight approved is exactly what reaches the provider.
      const baseParameters = options.parameters ?? {};
      const parameters: LlmParameters =
        input.snapshot.reasoningEffort === undefined
          ? baseParameters
          : { ...baseParameters, reasoningEffort: input.snapshot.reasoningEffort };
      const baseRequest: LlmRequest = {
        schemaVersion: "1.0",
        requestId,
        traceId: requestId,
        mode: "streaming",
        modelProfile: options.modelProfile,
        messages,
        parameters,
        abortSignal: input.signal,
        ...(tools.length === 0 ? {} : { tools })
      };
      const resolvedPromptCache = await resolveMainPromptCache(
        options.resolvePromptCache,
        baseRequest,
        promptCache
      );
      for await (const result of options.adapter.stream({
        ...baseRequest,
        ...(resolvedPromptCache === undefined ? {} : { promptCache: resolvedPromptCache })
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
              : { argumentsDelta: result.value.argumentsDelta }),
            ...(result.value.providerMetadata === undefined
              ? {}
              : { providerMetadata: result.value.providerMetadata })
          };
        } else if (result.value.type === "usage") {
          yield { type: "usage", usage: result.value.usage };
        } else if (result.value.type === "round_completed") {
          yield result.value;
        }
      }
    }
  };
}

async function resolveMainPromptCache(
  resolver: CreateLlmAgentRunModelDriverOptions["resolvePromptCache"],
  request: LlmRequest,
  promptCache: LlmPromptCacheRequest | undefined
): Promise<LlmPromptCacheRequest | undefined> {
  if (resolver === undefined) return promptCache;
  try {
    return await resolver({
      ...request,
      ...(promptCache === undefined ? {} : { promptCache })
    });
  } catch {
    return promptCache === undefined
      ? undefined
      : withoutPromptCacheResource(promptCache, "cache_error");
  }
}

function withoutPromptCacheResource(
  promptCache: LlmPromptCacheRequest,
  bypassReason: NonNullable<LlmPromptCacheRequest["bypassReason"]>
): LlmPromptCacheRequest {
  const { resourceRef, physicalPrefixChecksum, resourceWriteTokens, ...base } = promptCache;
  void resourceRef;
  void physicalPrefixChecksum;
  void resourceWriteTokens;
  return { ...base, bypassReason };
}

export function createAgentRoundPromptCacheRequest(
  input: AgentModelRoundInput,
  messages: readonly LlmMessage[],
  tools: readonly LlmToolDefinition[],
  estimator: AgentTokenEstimator = createDeterministicTokenEstimator()
): LlmPromptCacheRequest | undefined {
  if (input.disablePromptCache) return undefined;
  const capability = input.snapshot.providerCapabilitySnapshot?.promptCache;
  const stablePrefixMessageCount = input.snapshot.promptCacheStablePrefixMessageCount;
  if (
    capability === undefined ||
    !isChecksum(input.snapshot.promptCacheIdentityChecksum) ||
    !isChecksum(input.snapshot.cachePrefixChecksum) ||
    !Number.isSafeInteger(stablePrefixMessageCount) ||
    stablePrefixMessageCount < 1 ||
    stablePrefixMessageCount > messages.length
  ) {
    return undefined;
  }
  const eligibleInputTokens = estimator.count(
    JSON.stringify({
      messages: messages.slice(0, stablePrefixMessageCount),
      ...(tools.length === 0 ? {} : { tools })
    }),
    input.snapshot.providerCapabilitySnapshot.profileId
  ).tokens;
  const bypassReason =
    capability.mode === "none"
      ? "policy_none"
      : eligibleInputTokens < capability.minimumCacheableTokens
        ? "below_minimum_tokens"
        : undefined;
  return {
    mode: capability.mode,
    policyVersion: capability.policyVersion,
    identityChecksum: input.snapshot.promptCacheIdentityChecksum,
    ...(isChecksum(input.promptCacheConnectionIdentityChecksum)
      ? { connectionIdentityChecksum: input.promptCacheConnectionIdentityChecksum }
      : {}),
    ...(isChecksum(input.promptCacheAccountIsolationChecksum)
      ? { accountIsolationChecksum: input.promptCacheAccountIsolationChecksum }
      : {}),
    logicalPrefixChecksum: input.snapshot.cachePrefixChecksum,
    stablePrefixMessageCount,
    minimumCacheableTokens: capability.minimumCacheableTokens,
    eligibleInputTokens,
    ...(capability.ttlSeconds === null ? {} : { ttlSeconds: capability.ttlSeconds }),
    ...(bypassReason === undefined ? {} : { bypassReason })
  };
}

function isChecksum(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function toLlmMessage(message: AgentModelMessage): LlmMessage {
  return {
    role: message.role,
    content: message.content,
    ...(message.toolCallId === undefined ? {} : { toolCallId: message.toolCallId }),
    ...(message.toolCalls === undefined ? {} : { toolCalls: message.toolCalls })
  };
}
