import type { JsonObject, JsonValue } from "@novel-studio/shared";

import { LlmProviderFailure } from "./errors.js";
import {
  checksumProviderPayload,
  rejectLlmPromptCacheRequest,
  resolveLlmPromptCacheRequest,
  withLlmPromptCacheUsage,
  type ResolvedLlmPromptCacheRequest
} from "./prompt-cache.js";
import type {
  LlmMessage,
  LlmProvider,
  LlmProviderCompletion,
  LlmProviderStreamEvent,
  LlmRequest,
  LlmUsage
} from "./types.js";

export interface AnthropicTransportRequest {
  readonly url: string;
  readonly headers?: JsonObject;
  readonly body: JsonObject;
  readonly timeoutMs?: number;
  readonly abortSignal?: AbortSignal;
}

export type AnthropicTransport = (request: AnthropicTransportRequest) => Promise<unknown>;

export type AnthropicStreamTransport = (
  request: AnthropicTransportRequest
) => AsyncIterable<unknown>;

export interface AnthropicProviderOptions {
  readonly transport: AnthropicTransport;
  readonly streamTransport?: AnthropicStreamTransport;
  readonly resolveApiKey?: (apiKeyRef: string) => Promise<string | undefined>;
  readonly anthropicVersion?: string;
}

export class AnthropicHttpError extends Error {
  readonly status: number;
  readonly body?: unknown;
  readonly headers?: JsonObject;

  constructor(input: {
    readonly status: number;
    readonly message: string;
    readonly body?: unknown;
    readonly headers?: JsonObject;
  }) {
    super(input.message);
    this.name = "AnthropicHttpError";
    this.status = input.status;
    if (input.body !== undefined) this.body = input.body;
    if (input.headers !== undefined) this.headers = input.headers;
  }
}

export function createAnthropicProvider(options: AnthropicProviderOptions): LlmProvider {
  return {
    id: "anthropic",
    async complete(request) {
      try {
        throwIfAborted(request);
        const payload = await options.transport(
          await createTransportRequest(request, options, false)
        );
        throwIfAborted(request);
        return parseMessage(payload, request);
      } catch (error) {
        throw normalizeAnthropicError(error, request.abortSignal);
      }
    },
    stream(request) {
      assertCanonicalMessageContract(request);
      if (options.streamTransport === undefined) return unsupportedStream();
      return streamMessages(options.streamTransport, request, options);
    }
  };
}

async function* streamMessages(
  transport: AnthropicStreamTransport,
  request: LlmRequest,
  options: Pick<AnthropicProviderOptions, "resolveApiKey" | "anthropicVersion">
): AsyncIterable<LlmProviderStreamEvent> {
  try {
    throwIfAborted(request);
    const transportRequest = await createTransportRequest(request, options, true);
    const toolCalls = new Map<
      number,
      {
        readonly id: string;
        readonly name: string;
        readonly initialInput?: JsonObject;
        sawArgumentsDelta: boolean;
      }
    >();
    let usage: Partial<AnthropicUsage> | undefined;
    let sawRoundCompleted = false;

    for await (const payload of transport(transportRequest)) {
      throwIfAborted(request);
      const event = requireRecord(payload);
      const eventType = stringValue(event["type"]);
      if (eventType === undefined) throw malformedResponse(event);

      if (eventType === "message_start") {
        const message = requireRecord(event["message"]);
        usage = readUsage(message["usage"]);
        continue;
      }

      if (eventType === "content_block_start") {
        const index = requiredIndex(event);
        const block = requireRecord(event["content_block"]);
        if (block["type"] === "tool_use") {
          const id = stringValue(block["id"]);
          const name = stringValue(block["name"]);
          if (id === undefined || name === undefined) throw malformedResponse(event);
          const initialInput = isRecord(block["input"]) ? block["input"] : undefined;
          toolCalls.set(index, {
            id,
            name,
            ...(initialInput === undefined ? {} : { initialInput }),
            sawArgumentsDelta: false
          });
          yield { type: "tool_call_delta", toolCallId: id, name };
        }
        continue;
      }

      if (eventType === "content_block_delta") {
        const delta = requireRecord(event["delta"]);
        const deltaType = stringValue(delta["type"]);
        if (deltaType === "text_delta") {
          const text = stringValue(delta["text"]);
          if (text === undefined) throw malformedResponse(event);
          yield { type: "delta", value: text };
        } else if (deltaType === "input_json_delta") {
          const call = toolCalls.get(requiredIndex(event));
          const argumentsDelta = stringValue(delta["partial_json"]);
          if (call === undefined || argumentsDelta === undefined) throw malformedResponse(event);
          call.sawArgumentsDelta = true;
          yield {
            type: "tool_call_delta",
            toolCallId: call.id,
            argumentsDelta
          };
        }
        continue;
      }

      if (eventType === "content_block_stop") {
        const call = toolCalls.get(requiredIndex(event));
        if (call !== undefined && !call.sawArgumentsDelta) {
          yield {
            type: "tool_call_delta",
            toolCallId: call.id,
            argumentsDelta: JSON.stringify(call.initialInput ?? {})
          };
        }
        continue;
      }

      if (eventType === "message_delta") {
        const delta = requireRecord(event["delta"]);
        usage = { ...usage, ...readUsage(event["usage"]) };
        const finalUsage = toUsage(usage, request);
        if (finalUsage !== undefined) yield { type: "usage", usage: finalUsage };
        const stopReason = stringValue(delta["stop_reason"]);
        if (stopReason !== undefined) {
          if (sawRoundCompleted) throw malformedResponse(event);
          sawRoundCompleted = true;
          yield { type: "round_completed", finishReason: normalizeFinishReason(stopReason) };
        }
        continue;
      }

      if (
        eventType === "content_block_stop" ||
        eventType === "message_stop" ||
        eventType === "ping" ||
        eventType === "error"
      ) {
        if (eventType === "error") throw streamProviderError(event);
        continue;
      }
    }
    throwIfAborted(request);
    if (!sawRoundCompleted) throw truncatedStream();
  } catch (error) {
    throw normalizeAnthropicError(error, request.abortSignal);
  }
}

function unsupportedStream(): AsyncIterable<LlmProviderStreamEvent> {
  return {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<LlmProviderStreamEvent>> {
          throw new LlmProviderFailure({
            code: "LLM_UNSUPPORTED_MODE",
            message: "Anthropic streaming is not configured for this runtime.",
            retryable: false
          });
        }
      };
    }
  };
}

async function createTransportRequest(
  request: LlmRequest,
  options: Pick<AnthropicProviderOptions, "resolveApiKey" | "anthropicVersion">,
  streaming: boolean
): Promise<AnthropicTransportRequest> {
  assertCanonicalMessageContract(request);
  const baseUrl = requiredBaseUrl(request);
  const promptCache = resolveAnthropicPromptCache(request);
  const authority = request.messages.find(
    (message) => message.role === "system" || message.role === "developer"
  );
  const system = authority?.content;
  const body: JsonObject = {
    model: request.modelProfile.modelName,
    max_tokens: request.parameters.maxTokens ?? 1024,
    messages: request.messages.flatMap((message, index) =>
      message.role === "system" || message.role === "developer"
        ? []
        : [
            promptCache.resolution.active &&
            promptCache.resolution.config !== undefined &&
            index === promptCache.resolution.config.stablePrefixMessageCount - 1
              ? withAnthropicCacheControl(toAnthropicMessage(message))
              : toAnthropicMessage(message)
          ]
    ),
    stream: streaming
  };
  if (system !== undefined) {
    const boundary = promptCache.resolution.config?.stablePrefixMessageCount;
    const boundaryMessage = boundary === undefined ? undefined : request.messages[boundary - 1];
    body.system =
      promptCache.resolution.active &&
      (boundaryMessage?.role === "system" || boundaryMessage?.role === "developer")
        ? [withAnthropicCacheControl({ type: "text", text: system })]
        : system;
  }
  if (request.parameters.temperature !== undefined)
    body.temperature = request.parameters.temperature;
  if (request.parameters.topP !== undefined) body.top_p = request.parameters.topP;
  if (request.tools !== undefined && request.tools.length > 0) {
    body.tools = request.tools.map((tool) => ({
      name: tool.function.name,
      ...(tool.function.description === undefined
        ? {}
        : { description: tool.function.description }),
      input_schema: tool.function.parameters ?? { type: "object", properties: {} }
    })) as unknown as JsonValue;
  }

  const apiKey =
    options.resolveApiKey === undefined
      ? undefined
      : await options.resolveApiKey(request.modelProfile.apiKeyRef ?? "");
  const headers: JsonObject = {
    "anthropic-version": options.anthropicVersion ?? "2023-06-01"
  };
  if (apiKey !== undefined) headers["x-api-key"] = apiKey;

  return {
    url: anthropicMessagesUrl(baseUrl),
    headers,
    body,
    ...(request.modelProfile.timeoutMs === undefined
      ? {}
      : { timeoutMs: request.modelProfile.timeoutMs }),
    ...(request.abortSignal === undefined ? {} : { abortSignal: request.abortSignal })
  };
}

function assertCanonicalMessageContract(request: LlmRequest): void {
  const authorityIndexes = request.messages.flatMap((message, index) =>
    message.role === "system" || message.role === "developer" ? [index] : []
  );
  if (authorityIndexes.length > 1 || (authorityIndexes.length === 1 && authorityIndexes[0] !== 0)) {
    throw providerContractFailure("A request may contain only one leading authority message.");
  }
  const callsById = new Map<string, string>();
  const consumed = new Set<string>();
  for (const message of request.messages) {
    if (!hasOnlyMessageKeys(message)) {
      throw providerContractFailure("Provider messages contain unsupported fields.");
    }
    if (message.role === "system" || message.role === "developer") {
      if (message.toolCallId !== undefined || message.toolCalls !== undefined) {
        throw providerContractFailure("Authority messages cannot carry tool state.");
      }
      continue;
    }
    if (message.role === "assistant") {
      if (message.toolCallId !== undefined) {
        throw providerContractFailure("Assistant messages cannot carry a tool result id.");
      }
      for (const call of message.toolCalls ?? []) {
        if (!hasOnlyToolCallKeys(call) || !safeIdentifier(call.id) || !safeIdentifier(call.name)) {
          throw providerContractFailure("Assistant tool calls are malformed.");
        }
        if (callsById.has(call.id)) throw providerContractFailure("Tool call ids must be unique.");
        callsById.set(call.id, call.name);
      }
      continue;
    }
    if (message.role === "tool") {
      if (
        message.toolCallId === undefined ||
        message.toolCalls !== undefined ||
        !callsById.has(message.toolCallId) ||
        consumed.has(message.toolCallId)
      ) {
        throw providerContractFailure("Tool results require one prior assistant tool call.");
      }
      consumed.add(message.toolCallId);
      continue;
    }
    if (message.toolCallId !== undefined || message.toolCalls !== undefined) {
      throw providerContractFailure("User messages cannot carry tool state.");
    }
  }
}

function hasOnlyMessageKeys(message: LlmMessage): boolean {
  return Object.keys(message).every((key) =>
    ["role", "content", "toolCallId", "toolCalls"].includes(key)
  );
}

function hasOnlyToolCallKeys(
  call: unknown
): call is { readonly id: string; readonly name: string } {
  return (
    isRecord(call) &&
    Object.keys(call).every((key) =>
      ["id", "name", "arguments", "providerMetadata"].includes(key)
    ) &&
    typeof call["id"] === "string" &&
    typeof call["name"] === "string" &&
    typeof call["arguments"] === "string"
  );
}

function safeIdentifier(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u.test(value);
}

function providerContractFailure(message: string): LlmProviderFailure {
  return new LlmProviderFailure({ code: "LLM_PROVIDER_ERROR", message, retryable: false });
}

function toAnthropicMessage(message: LlmMessage): JsonObject {
  if (message.role === "tool") {
    if (message.toolCallId === undefined) {
      throw new LlmProviderFailure({
        code: "LLM_PROVIDER_ERROR",
        message: "Anthropic tool results require the tool call identifier.",
        retryable: false
      });
    }
    return {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: message.toolCallId, content: message.content }]
    };
  }

  if (message.role === "assistant" && message.toolCalls !== undefined) {
    const content: JsonObject[] = [];
    if (message.content.length > 0) content.push({ type: "text", text: message.content });
    for (const toolCall of message.toolCalls) {
      content.push({
        type: "tool_use",
        id: toolCall.id,
        name: toolCall.name,
        input: parseToolArguments(toolCall.arguments)
      });
    }
    return { role: "assistant", content };
  }

  return {
    role: message.role === "assistant" ? "assistant" : "user",
    content: message.content
  };
}

function withAnthropicCacheControl(message: JsonObject): JsonObject {
  const content = message["content"];
  if (typeof content === "string") {
    return {
      ...message,
      content: [{ type: "text", text: content, cache_control: { type: "ephemeral" } }]
    };
  }
  if (Array.isArray(content) && content.length > 0) {
    return {
      ...message,
      content: content.map((block, index) =>
        index === content.length - 1 && isRecord(block)
          ? { ...block, cache_control: { type: "ephemeral" } }
          : block
      ) as unknown as JsonValue
    };
  }
  return message;
}

function resolveAnthropicPromptCache(request: LlmRequest): {
  readonly resolution: ResolvedLlmPromptCacheRequest;
  readonly physicalPrefixChecksum?: string;
} {
  let resolution = resolveLlmPromptCacheRequest(request, "explicit_breakpoints");
  if (!resolution.active || resolution.config === undefined) return { resolution };

  const prefixMessages = request.messages.slice(0, resolution.config.stablePrefixMessageCount);
  const suffixMessages = request.messages.slice(resolution.config.stablePrefixMessageCount);
  if (
    prefixMessages.some((message) => message.role === "assistant" || message.role === "tool") ||
    suffixMessages.some((message) => message.role === "system" || message.role === "developer")
  ) {
    return {
      resolution: rejectLlmPromptCacheRequest(resolution, "identity_unverified")
    };
  }

  const boundaryMessage = prefixMessages.at(-1);
  const system = prefixMessages
    .filter((message) => message.role === "system" || message.role === "developer")
    .map((message) => message.content)
    .join("\n\n");
  const prefixPayload: JsonObject = {
    messages: prefixMessages.flatMap((message, index) =>
      message.role === "system" || message.role === "developer"
        ? []
        : [
            index === prefixMessages.length - 1
              ? withAnthropicCacheControl(toAnthropicMessage(message))
              : toAnthropicMessage(message)
          ]
    ) as unknown as JsonValue
  };
  if (system.length > 0) {
    prefixPayload["system"] =
      boundaryMessage?.role === "system" || boundaryMessage?.role === "developer"
        ? ([withAnthropicCacheControl({ type: "text", text: system })] as unknown as JsonValue)
        : system;
  }
  if (request.tools !== undefined && request.tools.length > 0) {
    prefixPayload["tools"] = request.tools.map((tool) => ({
      name: tool.function.name,
      ...(tool.function.description === undefined
        ? {}
        : { description: tool.function.description }),
      input_schema: tool.function.parameters ?? { type: "object", properties: {} }
    })) as unknown as JsonValue;
  }
  const physicalPrefixChecksum = checksumProviderPayload(prefixPayload);
  if (
    resolution.config.physicalPrefixChecksum !== undefined &&
    resolution.config.physicalPrefixChecksum !== physicalPrefixChecksum
  ) {
    resolution = rejectLlmPromptCacheRequest(resolution, "identity_unverified");
    return { resolution };
  }
  return { resolution, physicalPrefixChecksum };
}

function parseToolArguments(argumentsText: string): JsonObject {
  try {
    const value = JSON.parse(argumentsText) as unknown;
    if (isRecord(value)) return value;
  } catch {
    // The error below gives the caller a stable, secret-free message.
  }
  throw new LlmProviderFailure({
    code: "LLM_PROVIDER_ERROR",
    message: "Anthropic tool call arguments must be a JSON object.",
    retryable: false
  });
}

function parseMessage(payload: unknown, request: LlmRequest): LlmProviderCompletion {
  const root = requireRecord(payload);
  const content = root["content"];
  if (!Array.isArray(content)) throw malformedResponse(root);
  const text = content
    .map((block) => {
      if (!isRecord(block)) throw malformedResponse(root);
      if (block["type"] !== "text") return "";
      const value = stringValue(block["text"]);
      if (value === undefined) throw malformedResponse(root);
      return value;
    })
    .join("");
  return {
    content: { type: "text", value: text },
    usage: toUsage(readUsage(root["usage"]), request) ?? missingUsage(request)
  };
}

interface AnthropicUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheCreationTokens: number;
  readonly cacheReadTokens: number;
}

function readUsage(value: unknown): Partial<AnthropicUsage> {
  if (!isRecord(value)) return {};
  const inputTokens = numberValue(value["input_tokens"]);
  const outputTokens = numberValue(value["output_tokens"]);
  const cacheCreationTokens = numberValue(value["cache_creation_input_tokens"]);
  const cacheReadTokens = numberValue(value["cache_read_input_tokens"]);
  return {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(cacheCreationTokens === undefined ? {} : { cacheCreationTokens }),
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens })
  };
}

function toUsage(value: Partial<AnthropicUsage>, request?: LlmRequest): LlmUsage | undefined {
  const inputTokens = value.inputTokens;
  const outputTokens = value.outputTokens;
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  const usage: LlmUsage = {
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
    totalTokens:
      (inputTokens ?? 0) +
      (outputTokens ?? 0) +
      (value.cacheCreationTokens ?? 0) +
      (value.cacheReadTokens ?? 0),
    usageStatus: "actual",
    cost: { amount: 0, currency: "USD", status: "unknown" }
  };
  const promptCache =
    request === undefined
      ? { resolution: { active: false } satisfies ResolvedLlmPromptCacheRequest }
      : resolveAnthropicPromptCache(request);
  const cacheEligibleInputTokens =
    value.cacheReadTokens === undefined && value.cacheCreationTokens === undefined
      ? undefined
      : (value.cacheReadTokens ?? 0) + (value.cacheCreationTokens ?? 0);
  return withLlmPromptCacheUsage(usage, promptCache.resolution, {
    ...(value.cacheReadTokens === undefined ? {} : { cacheReadTokens: value.cacheReadTokens }),
    ...(value.cacheCreationTokens === undefined
      ? {}
      : { cacheWriteTokens: value.cacheCreationTokens }),
    ...(cacheEligibleInputTokens === undefined ? {} : { cacheEligibleInputTokens }),
    cacheInputTokenSemantics: "excluded_from_input",
    ...(promptCache.physicalPrefixChecksum === undefined
      ? {}
      : { physicalPrefixChecksum: promptCache.physicalPrefixChecksum })
  });
}

function missingUsage(request?: LlmRequest): LlmUsage {
  const usage: LlmUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    usageStatus: "missing",
    cost: { amount: 0, currency: "USD", status: "unknown" }
  };
  const promptCache =
    request === undefined
      ? { resolution: { active: false } satisfies ResolvedLlmPromptCacheRequest }
      : resolveAnthropicPromptCache(request);
  return withLlmPromptCacheUsage(usage, promptCache.resolution, {
    cacheInputTokenSemantics: "excluded_from_input",
    ...(promptCache.physicalPrefixChecksum === undefined
      ? {}
      : { physicalPrefixChecksum: promptCache.physicalPrefixChecksum })
  });
}

function normalizeFinishReason(
  value: string
): "tool_calls" | "stop" | "length" | "content_filter" | "aborted" | "error" | "unknown" {
  if (value === "tool_use") return "tool_calls";
  if (value === "end_turn" || value === "stop_sequence") return "stop";
  if (value === "max_tokens") return "length";
  if (value === "refusal") return "content_filter";
  return "unknown";
}

function streamProviderError(event: JsonObject): AnthropicHttpError {
  const error = isRecord(event["error"]) ? event["error"] : {};
  return new AnthropicHttpError({
    status: numberValue(error["status"]) ?? 500,
    message: stringValue(error["message"]) ?? "Anthropic returned a streaming error.",
    body: event
  });
}

function normalizeAnthropicError(
  error: unknown,
  abortSignal: AbortSignal | undefined
): LlmProviderFailure {
  if (error instanceof LlmProviderFailure) return error;
  if (abortSignal?.aborted === true || (error instanceof Error && error.name === "AbortError")) {
    return new LlmProviderFailure({
      code: "LLM_ABORTED",
      message: "The Anthropic request was cancelled.",
      retryable: false
    });
  }
  if (error instanceof AnthropicHttpError) {
    const detail: JsonObject = { providerStatus: error.status };
    const providerMessage = readProviderErrorMessage(error.body);
    const providerRequestId = readProviderRequestId(error.body, error.headers);
    if (providerRequestId !== undefined) detail["providerRequestId"] = providerRequestId;
    if (error.headers !== undefined) {
      for (const [key, value] of Object.entries(error.headers)) {
        detail[key] = isSensitiveHeader(key) ? "[REDACTED]" : value;
      }
    }
    return new LlmProviderFailure({
      code:
        error.status === 408
          ? "LLM_TIMEOUT"
          : error.status === 429
            ? "LLM_RATE_LIMITED"
            : "LLM_PROVIDER_ERROR",
      message: providerMessage ?? error.message,
      retryable: error.status === 408 || error.status === 429 || error.status >= 500,
      redactedDetail: detail
    });
  }
  return new LlmProviderFailure({
    code: "LLM_PROVIDER_ERROR",
    message: "Anthropic transport failed.",
    retryable: false
  });
}

function readProviderErrorMessage(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  const error = isRecord(body["error"]) ? body["error"] : body;
  return stringValue(error["message"]);
}

function readProviderRequestId(body: unknown, headers: JsonObject | undefined): string | undefined {
  if (isRecord(body)) {
    const requestId = stringValue(body["request_id"]);
    if (requestId !== undefined) return requestId;
  }
  if (headers === undefined) return undefined;
  return stringValue(headers["request-id"]) ?? stringValue(headers["x-request-id"]);
}

function requiredBaseUrl(request: LlmRequest): string {
  const baseUrl = request.modelProfile.baseUrl?.trim();
  if (baseUrl === undefined || baseUrl.length === 0) {
    throw new LlmProviderFailure({
      code: "LLM_PROVIDER_ERROR",
      message: "Anthropic provider requires a baseUrl.",
      retryable: false
    });
  }
  return baseUrl;
}

function anthropicMessagesUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, "");
  return normalized.endsWith("/v1") ? `${normalized}/messages` : `${normalized}/v1/messages`;
}

function throwIfAborted(request: LlmRequest): void {
  if (request.abortSignal?.aborted === true) {
    throw new LlmProviderFailure({
      code: "LLM_ABORTED",
      message: "The Anthropic request was cancelled.",
      retryable: false
    });
  }
}

function requiredIndex(event: JsonObject): number {
  const index = event["index"];
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0)
    throw malformedResponse(event);
  return index;
}

function malformedResponse(body: JsonObject): LlmProviderFailure {
  return new LlmProviderFailure({
    code: "LLM_MALFORMED_RESPONSE",
    message: "Anthropic returned a malformed response.",
    retryable: false,
    redactedDetail: { responseShape: Object.keys(body).sort().join(",") }
  });
}

function truncatedStream(): LlmProviderFailure {
  return new LlmProviderFailure({
    code: "LLM_MALFORMED_RESPONSE",
    message: "Anthropic ended the stream before declaring a round result.",
    retryable: false,
    redactedDetail: { streamTermination: "missing" }
  });
}

function requireRecord(value: unknown): JsonObject {
  if (!isRecord(value)) throw malformedResponse({});
  return value;
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function isSensitiveHeader(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    normalized.includes("authorization") ||
    normalized.includes("api-key") ||
    normalized.includes("apikey") ||
    normalized.includes("api_key") ||
    normalized.includes("token") ||
    normalized.includes("secret")
  );
}
