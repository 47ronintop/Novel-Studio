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
import {
  createProviderVisibleUntrustedEnvelope,
  isProviderVisibleEnvelopeAllowedInRole,
  parseProviderVisibleUntrustedEnvelope,
  serializeProviderVisibleUntrustedEnvelope
} from "./agent-untrusted-envelope.js";

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
      const providerToolNames = new Set<string>();
      for (const tool of input.tools) {
        if (!isBoundedIdentifier(tool.name) || providerToolNames.has(tool.name)) {
          throw new Error("AGENT_TOOL_DESCRIPTOR_INVALID");
        }
        providerToolNames.add(tool.name);
      }
      const normalizedInputMessages = normalizeAgentMessages(
        input.messages,
        systemPrompt !== undefined,
        providerToolNames
      );
      const messages: LlmMessage[] = [
        ...(systemPrompt === undefined ? [] : [{ role: "system" as const, content: systemPrompt }]),
        ...normalizedInputMessages.map(toLlmMessage)
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

function normalizeAgentMessages(
  input: readonly AgentModelMessage[],
  hasAppAuthority: boolean,
  providerToolNames: ReadonlySet<string>
): readonly AgentModelMessage[] {
  const toolCallsById = new Map<string, string>();
  const consumedToolResults = new Set<string>();
  const normalized: AgentModelMessage[] = [];
  for (const message of input) {
    if (
      !isRecord(message as unknown) ||
      !hasOnlyMessageKeys(message as unknown as Record<string, unknown>)
    ) {
      throw new Error("AGENT_MODEL_MESSAGE_INVALID");
    }
    if (message.role === "system") {
      throw new Error("AGENT_LOGICAL_AUTHORITY_INVALID");
    }
    if ((message as unknown as { readonly role: string }).role === "developer") {
      throw new Error("AGENT_LOGICAL_AUTHORITY_INVALID");
    }
    if (typeof message.content !== "string") {
      throw new Error("AGENT_MODEL_MESSAGE_INVALID");
    }
    if (message.role === "assistant") {
      if (message.toolCallId !== undefined) throw new Error("AGENT_MODEL_MESSAGE_INVALID");
      if (message.toolCalls !== undefined && !Array.isArray(message.toolCalls)) {
        throw new Error("AGENT_TOOL_CALL_INVALID");
      }
      for (const call of message.toolCalls ?? []) {
        validateToolCall(call);
        if (providerToolNames.size > 0 && !providerToolNames.has(call.name)) {
          throw new Error("AGENT_TOOL_CALL_UNKNOWN");
        }
        if (toolCallsById.has(call.id)) throw new Error("AGENT_TOOL_CALL_DUPLICATE");
        toolCallsById.set(call.id, call.name);
      }
    } else if (message.role === "tool") {
      if (
        typeof message.toolCallId !== "string" ||
        message.toolCalls !== undefined ||
        !toolCallsById.has(message.toolCallId) ||
        consumedToolResults.has(message.toolCallId)
      ) {
        throw new Error("AGENT_TOOL_RESULT_UNPAIRED");
      }
      const normalizedToolMessage = normalizeToolEnvelopeIfPresent(message, toolCallsById);
      consumedToolResults.add(message.toolCallId);
      normalized.push(normalizedToolMessage);
      continue;
    } else if (message.toolCallId !== undefined || message.toolCalls !== undefined) {
      throw new Error("AGENT_MODEL_MESSAGE_INVALID");
    }
    normalized.push(normalizeUserEnvelopeIfPresent(message));
  }
  if (!hasAppAuthority && normalized.some((message) => message.role === "system")) {
    throw new Error("AGENT_LOGICAL_AUTHORITY_INVALID");
  }
  return normalized;
}

function validateToolCall(call: unknown): asserts call is {
  readonly id: string;
  readonly name: string;
  readonly arguments: string;
  readonly providerMetadata?: Record<string, unknown>;
} {
  if (
    !isRecord(call) ||
    !hasOnlyToolCallKeys(call) ||
    !isBoundedIdentifier(call.id) ||
    !isBoundedIdentifier(call.name) ||
    typeof call.arguments !== "string" ||
    call.arguments.length > 262_144 ||
    (call.providerMetadata !== undefined && !isJsonObject(call.providerMetadata))
  ) {
    throw new Error("AGENT_TOOL_CALL_INVALID");
  }
}

function normalizeToolEnvelopeIfPresent(
  message: AgentModelMessage,
  toolCallsById: ReadonlyMap<string, string>
): AgentModelMessage {
  const parsed = tryParseRecord(message.content);
  if (parsed === undefined) return message;
  if (
    !Object.hasOwn(parsed, "schemaVersion") &&
    !Object.hasOwn(parsed, "kind") &&
    !Object.hasOwn(parsed, "instructionPolicy")
  ) {
    return message;
  }
  if (!Object.hasOwn(parsed, "schemaVersion")) {
    const toolCallId = message.toolCallId;
    if (typeof toolCallId !== "string") throw new Error("AGENT_TOOL_RESULT_UNPAIRED");
    const providerToolName = toolCallsById.get(toolCallId);
    if (providerToolName === undefined) throw new Error("AGENT_TOOL_RESULT_UNPAIRED");
    const legacyKind = typeof parsed["kind"] === "string" ? parsed["kind"] : "tool_result";
    const legacyData = parsed["data"];
    const data =
      typeof legacyData === "string"
        ? legacyData
        : JSON.stringify(legacyData === undefined ? parsed : legacyData);
    const isRemote = legacyKind === "untrusted_remote_data";
    const envelope = createProviderVisibleUntrustedEnvelope({
      kind: isRemote ? "untrusted_remote_data" : "untrusted_tool_data",
      source: isRemote
        ? {
            sourceKind: "remote_mcp",
            toolCallId,
            originLabel: providerToolName
          }
        : {
            sourceKind: "tool_result",
            toolCallId,
            providerToolName,
            resultKind: legacyKind
          },
      data
    });
    return { ...message, content: serializeProviderVisibleUntrustedEnvelope(envelope) };
  }
  const envelope = parseProviderVisibleUntrustedEnvelope(parsed);
  if (
    envelope.source.sourceKind !== "tool_result" &&
    envelope.source.sourceKind !== "network" &&
    envelope.source.sourceKind !== "remote_mcp"
  ) {
    throw new Error("AGENT_TOOL_RESULT_ENVELOPE_INVALID");
  }
  if (
    envelope.source.toolCallId !== message.toolCallId ||
    !isProviderVisibleEnvelopeAllowedInRole({
      envelope,
      role: "tool",
      pairedToolCallIds: new Set(toolCallsById.keys())
    })
  ) {
    throw new Error("AGENT_TOOL_RESULT_UNPAIRED");
  }
  if (
    envelope.source.sourceKind === "tool_result" &&
    envelope.source.providerToolName !== toolCallsById.get(message.toolCallId)
  ) {
    throw new Error("AGENT_TOOL_RESULT_UNPAIRED");
  }
  return message;
}

function normalizeUserEnvelopeIfPresent(message: AgentModelMessage): AgentModelMessage {
  if (message.role !== "user") return message;
  const parsed = tryParseRecord(message.content);
  if (parsed === undefined) return message;
  if (
    (Object.hasOwn(parsed, "kind") || Object.hasOwn(parsed, "instructionPolicy")) &&
    (String(parsed["kind"] ?? "").startsWith("untrusted_") ||
      Object.hasOwn(parsed, "instructionPolicy")) &&
    parsed["schemaVersion"] !== "2.0"
  ) {
    const legacyKind = typeof parsed["kind"] === "string" ? parsed["kind"] : "recovery_summary";
    const legacyData = parsed["data"];
    const data =
      typeof legacyData === "string"
        ? legacyData
        : JSON.stringify(legacyData === undefined ? parsed : legacyData);
    const envelope = createProviderVisibleUntrustedEnvelope({
      kind: "untrusted_recovery_data",
      source: { sourceKind: "recovery_summary", recoveryEventKind: legacyKind },
      data
    });
    return { ...message, content: serializeProviderVisibleUntrustedEnvelope(envelope) };
  }
  if (!Object.hasOwn(parsed, "schemaVersion")) return message;
  const envelope = parseProviderVisibleUntrustedEnvelope(parsed);
  if (!isProviderVisibleEnvelopeAllowedInRole({ envelope, role: "user" })) {
    throw new Error("AGENT_UNTRUSTED_ENVELOPE_ROLE_INVALID");
  }
  return message;
}

function hasOnlyMessageKeys(value: Record<string, unknown>): boolean {
  return Object.keys(value).every((key) =>
    ["role", "content", "toolCallId", "toolCalls"].includes(key)
  );
}

function hasOnlyToolCallKeys(value: Record<string, unknown>): boolean {
  return Object.keys(value).every((key) =>
    ["id", "name", "arguments", "providerMetadata"].includes(key)
  );
}

function isBoundedIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u.test(value);
}

function tryParseRecord(value: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && Object.values(value).every((entry) => isJsonValue(entry));
}

function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}
