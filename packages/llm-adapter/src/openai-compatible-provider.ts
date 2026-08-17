import type { JsonObject } from "@novel-studio/shared";

import { LlmProviderFailure } from "./errors.js";
import {
  checksumProviderPayload,
  rejectLlmPromptCacheRequest,
  resolveLlmPromptCacheRequest,
  withLlmPromptCacheUsage,
  type ResolvedLlmPromptCacheRequest
} from "./prompt-cache.js";
import { serializeLlmReasoningEffort } from "./reasoning-capabilities.js";
import type {
  LlmMessage,
  LlmProvider,
  LlmProviderCompletion,
  LlmProviderStreamEvent,
  LlmProviderWarning,
  LlmRequest,
  LlmUsage
} from "./types.js";

export interface OpenAiCompatibleTransportRequest {
  readonly url: string;
  readonly headers?: JsonObject;
  readonly body: JsonObject;
  readonly timeoutMs?: number;
  readonly abortSignal?: AbortSignal;
}

export type OpenAiCompatibleTransport = (
  request: OpenAiCompatibleTransportRequest
) => Promise<unknown>;

export interface OpenAiCompatibleProviderOptions {
  readonly transport: OpenAiCompatibleTransport;
  readonly streamTransport?: OpenAiCompatibleStreamTransport;
  readonly resolveApiKey?: (apiKeyRef: string) => Promise<string | undefined>;
}

export type OpenAiCompatibleStreamTransport = (
  request: OpenAiCompatibleTransportRequest
) => AsyncIterable<unknown>;

export class OpenAiCompatibleHttpError extends Error {
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
    this.name = "OpenAiCompatibleHttpError";
    this.status = input.status;
    if (input.body !== undefined) {
      this.body = input.body;
    }
    if (input.headers !== undefined) {
      this.headers = input.headers;
    }
  }
}

export function createOpenAiCompatibleProvider(
  options: OpenAiCompatibleProviderOptions
): LlmProvider {
  return {
    id: "openai-compatible",
    async complete(request) {
      try {
        const transportRequest = await createTransportRequest(request, options);
        const result = await transportWithReasoningFallback(options.transport, transportRequest);
        return {
          ...parseChatCompletion(result.payload, request),
          ...(result.warning === undefined ? {} : { warnings: [result.warning] })
        };
      } catch (error) {
        throw normalizeOpenAiCompatibleError(error, request.abortSignal);
      }
    },
    stream(request) {
      assertCanonicalMessageContract(request);
      if (options.streamTransport === undefined) {
        return unsupportedStream();
      }

      return streamChatCompletion(options.streamTransport, request, options);
    }
  };
}

async function* streamChatCompletion(
  streamTransport: OpenAiCompatibleStreamTransport,
  request: LlmRequest,
  options: Pick<OpenAiCompatibleProviderOptions, "resolveApiKey">
): AsyncIterable<LlmProviderStreamEvent> {
  try {
    const transportRequest = await createTransportRequest(request, options, true);
    let emittedEvent = false;
    let sawRoundCompleted = false;
    const toolCallIdsByIndex = new Map<number, string>();
    const syntheticToolCallPrefix = `tool_call_${safeIdentifier(request.requestId)}`;
    let currentRequest = transportRequest;
    let streamOptionsRetried = false;
    let reasoningRetried = false;
    for (;;) {
      try {
        for await (const chunk of streamTransport(currentRequest)) {
          for (const event of parseStreamChunk(
            chunk,
            toolCallIdsByIndex,
            syntheticToolCallPrefix,
            request
          )) {
            emittedEvent = true;
            if (event.type === "round_completed") {
              if (sawRoundCompleted) throw duplicateRoundCompletion();
              sawRoundCompleted = true;
            }
            yield event;
          }
        }
        throwIfStreamIncomplete(request, sawRoundCompleted);
        return;
      } catch (error) {
        if (
          !emittedEvent &&
          !streamOptionsRetried &&
          shouldRetryWithoutStreamOptions(error, currentRequest)
        ) {
          streamOptionsRetried = true;
          currentRequest = omitStreamOptions(currentRequest);
          continue;
        }
        if (
          !emittedEvent &&
          !reasoningRetried &&
          shouldRetryWithoutReasoningEffort(error, currentRequest)
        ) {
          reasoningRetried = true;
          yield reasoningEffortIgnoredWarning();
          currentRequest = omitReasoningEffort(currentRequest);
          continue;
        }
        throw error;
      }
    }
  } catch (error) {
    throw normalizeOpenAiCompatibleError(error, request.abortSignal);
  }
}

function unsupportedStream(): AsyncIterable<LlmProviderStreamEvent> {
  return {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<LlmProviderStreamEvent>> {
          throw new LlmProviderFailure({
            code: "LLM_UNSUPPORTED_MODE",
            message: "OpenAI-compatible streaming is not implemented in this M6 slice.",
            retryable: false
          });
        }
      };
    }
  };
}

function createTransportRequest(
  request: LlmRequest,
  options: Pick<OpenAiCompatibleProviderOptions, "resolveApiKey">,
  streaming = false
): Promise<OpenAiCompatibleTransportRequest> {
  assertCanonicalMessageContract(request);
  const baseUrl = request.modelProfile.baseUrl;
  if (baseUrl === undefined || baseUrl.length === 0) {
    throw new LlmProviderFailure({
      code: "LLM_PROVIDER_ERROR",
      message: "OpenAI-compatible provider requires a baseUrl.",
      retryable: false
    });
  }

  const body: JsonObject = {
    model: request.modelProfile.modelName,
    messages: request.messages.map(toOpenAiCompatibleMessage),
    stream: streaming
  };
  // OpenAI-compatible endpoints often emit final streaming usage only when asked. Request it for
  // a valid automatic-prefix policy, including below-threshold prompts so the bypass remains
  // observable; requests without that policy retain their existing shape.
  const cacheResolution = resolveOpenAiPromptCache(request).resolution;
  if (
    streaming &&
    (cacheResolution.active ||
      (cacheResolution.config?.mode === "automatic_prefix" &&
        cacheResolution.bypassReason === "below_minimum_tokens"))
  ) {
    body.stream_options = { include_usage: true } as unknown as JsonObject;
  }

  if (request.parameters.temperature !== undefined) {
    body.temperature = request.parameters.temperature;
  }
  if (request.parameters.maxTokens !== undefined) {
    body.max_tokens = request.parameters.maxTokens;
  }
  if (request.parameters.topP !== undefined) {
    body.top_p = request.parameters.topP;
  }
  if (request.parameters.reasoningEffort !== undefined) {
    const reasoning = serializeLlmReasoningEffort(
      request.modelProfile,
      request.parameters.reasoningEffort
    );
    if (reasoning === undefined) {
      throw new LlmProviderFailure({
        code: "LLM_PROVIDER_ERROR",
        message: "The selected model does not expose the requested reasoning strength.",
        retryable: false
      });
    }
    if (reasoning.providerParamName === "reasoning_effort") {
      body.reasoning_effort = reasoning.value;
    } else if (reasoning.providerParamName === "reasoning") {
      body.reasoning = { effort: reasoning.value } as unknown as JsonObject;
    } else {
      throw new LlmProviderFailure({
        code: "LLM_PROVIDER_ERROR",
        message:
          "The selected model uses a native reasoning protocol that this adapter cannot serialize.",
        retryable: false
      });
    }
  }
  if (request.tools !== undefined && request.tools.length > 0) {
    body.tools = request.tools as unknown as JsonObject;
  }

  const transportRequest = {
    url: `${baseUrl.replace(/\/+$/, "")}/chat/completions`,
    body
  };

  return createTransportRequestWithSecret(request, options, transportRequest);
}

async function createTransportRequestWithSecret(
  request: LlmRequest,
  options: Pick<OpenAiCompatibleProviderOptions, "resolveApiKey">,
  transportRequest: Pick<OpenAiCompatibleTransportRequest, "url" | "body">
): Promise<OpenAiCompatibleTransportRequest> {
  const abortSignal = request.abortSignal;
  const apiKey =
    options.resolveApiKey === undefined
      ? undefined
      : await options.resolveApiKey(request.modelProfile.apiKeyRef ?? "");
  const requestWithTimeout =
    request.modelProfile.timeoutMs === undefined
      ? transportRequest
      : {
          ...transportRequest,
          timeoutMs: request.modelProfile.timeoutMs
        };
  const requestWithAbortSignal =
    abortSignal === undefined
      ? requestWithTimeout
      : {
          ...requestWithTimeout,
          abortSignal
        };

  return apiKey === undefined
    ? requestWithAbortSignal
    : {
        ...requestWithAbortSignal,
        headers: {
          authorization: `Bearer ${apiKey}`
        }
      };
}

async function transportWithReasoningFallback(
  transport: OpenAiCompatibleTransport,
  request: OpenAiCompatibleTransportRequest
): Promise<{ readonly payload: unknown; readonly warning?: LlmProviderWarning }> {
  try {
    return { payload: await transport(request) };
  } catch (error) {
    if (shouldRetryWithoutReasoningEffort(error, request)) {
      return {
        payload: await transport(omitReasoningEffort(request)),
        warning: reasoningEffortIgnoredWarning()
      };
    }
    throw error;
  }
}

function reasoningEffortIgnoredWarning(): LlmProviderWarning {
  return {
    type: "warning",
    code: "LLM_REASONING_EFFORT_IGNORED",
    message:
      "The model endpoint does not support reasoning strength controls. The reasoning parameter was removed and the request was retried."
  };
}

function shouldRetryWithoutReasoningEffort(
  error: unknown,
  request: OpenAiCompatibleTransportRequest
): boolean {
  if (!hasReasoningEffort(request.body) || !(error instanceof OpenAiCompatibleHttpError)) {
    return false;
  }
  const message = `${error.message}\n${readProviderErrorMessage(error.body) ?? ""}`;
  const code = readProviderErrorCode(error.body);
  const parameter = readProviderErrorParameter(error.body);
  if (error.status < 400 || error.status >= 500) return false;

  // Value validation failures must reach the caller. Retrying without the
  // parameter would silently turn an invalid requested value into a weaker
  // request, which is materially different behavior.
  if (
    code !== undefined &&
    /^(?:unsupported|invalid|not_supported|not-supported)[_. -]?value$/i.test(code)
  ) {
    return false;
  }
  if (
    code !== undefined &&
    /^(?:unsupported|invalid|not_supported|not-supported)[_. -]?(?:parameter|param|field|argument|property|option)[_. -]?value$/i.test(
      code
    )
  ) {
    return false;
  }
  if (
    /(?:unsupported|invalid)\s+value\b|value\s+(?:is\s+)?(?:unsupported|invalid|not supported)/i.test(
      message
    )
  ) {
    return false;
  }
  if (
    /(?:invalid|not a valid|unsupported|not supported|unknown|unrecognized|unrecognised)\b[^\n]{0,80}(?:parameter|param|field|argument|property|option)\b[^\n]{0,80}(?:value|setting|level)\b/i.test(
      message
    ) ||
    /(?:value|setting|level)\b[^\n]{0,80}(?:for|of)\s+(?:the\s+)?(?:request\s+)?(?:parameter|param|field|argument|property|option)\b[^\n]{0,80}reasoning[_ .-]?effort/i.test(
      message
    )
  ) {
    return false;
  }

  const hasReasoningName =
    /\breasoning(?:[_ .-]?effort)?\b/i.test(message) ||
    parameter === "reasoning_effort" ||
    parameter === "reasoning" ||
    parameter === "reasoning.effort";
  if (!hasReasoningName) return false;

  // Only retry errors that identify the field itself as unknown/unsupported.
  // A parameter field alone is insufficient because many providers reuse it
  // for value validation errors (for example, `unsupported_value`).
  const parameterCode =
    code !== undefined &&
    /^(?:unknown|unrecognized|unsupported)[_. -]?(?:parameter|param|field|argument|property|option|request_argument)$/i.test(
      code
    );
  const parameterMessage =
    /(?:unknown|unrecognized|unrecognised|unexpected|not allowed|unsupported|not supported)\s+(?:request\s+)?(?:parameter|param|field|argument|property|option)\b/i.test(
      message
    ) ||
    /(?:request\s+)?(?:parameter|param|field|argument|property|option)\b[^\n]{0,80}(?:unknown|unrecognized|unrecognised|unexpected|not allowed|unsupported|not supported)/i.test(
      message
    ) ||
    /(?:invalid|not a valid)\s+(?:request\s+)?(?:parameter|param|field|argument|property|option)\b[^\n]{0,80}reasoning(?:[_ .-]?effort)?\b/i.test(
      message
    ) ||
    /reasoning(?:[_ .-]?effort)?\b[^\n]{0,80}(?:invalid|not a valid)\s+(?:request\s+)?(?:parameter|param|field|argument|property|option)\b/i.test(
      message
    ) ||
    /reasoning(?:[_ .-]?effort)?\b\s+(?:is\s+)?(?:unknown|unrecognized|unrecognised|unexpected|not allowed|unsupported|not supported)/i.test(
      message
    );

  return parameterCode || parameterMessage;
}

function shouldRetryWithoutStreamOptions(
  error: unknown,
  request: OpenAiCompatibleTransportRequest
): boolean {
  if (
    !Object.hasOwn(request.body, "stream_options") ||
    !(error instanceof OpenAiCompatibleHttpError) ||
    error.status < 400 ||
    error.status >= 500
  ) {
    return false;
  }
  const message = `${error.message}\n${readProviderErrorMessage(error.body) ?? ""}`;
  const code = readProviderErrorCode(error.body);
  const parameter = readProviderErrorParameter(error.body);
  const names = /stream[_ .-]?options?|include[_ .-]?usage/i;
  const namedParameter =
    names.test(message) ||
    (parameter !== undefined &&
      /^(?:stream_options(?:\.include_usage)?|include_usage)$/i.test(parameter));
  if (!namedParameter) {
    return false;
  }
  const unsupportedMarker =
    /(?:unknown|unrecognized|unrecognised|unexpected|unsupported|not supported|not allowed|invalid)/i;
  if (
    code !== undefined &&
    /^(?:(?:unknown|unrecognized|unrecognised|unsupported|not[_ .-]?supported)[_. -]?(?:parameter|param|field|property|option|argument)?|invalid[_. -](?:parameter|param|field|property|option|argument))$/i.test(
      code
    )
  ) {
    return true;
  }
  return (
    unsupportedMarker.test(message) &&
    (/(?:unknown|unrecognized|unrecognised|unexpected|unsupported|not supported|not allowed|invalid)\b[^\n]{0,80}(?:stream[_ .-]?options?|include[_ .-]?usage)/i.test(
      message
    ) ||
      /(?:stream[_ .-]?options?|include[_ .-]?usage)[^\n]{0,80}(?:unknown|unrecognized|unrecognised|unexpected|unsupported|not supported|not allowed|invalid)\b/i.test(
        message
      ) ||
      (parameter !== undefined && unsupportedMarker.test(message)))
  );
}

function hasReasoningEffort(body: JsonObject): boolean {
  return Object.hasOwn(body, "reasoning_effort") || Object.hasOwn(body, "reasoning");
}

function omitReasoningEffort(
  request: OpenAiCompatibleTransportRequest
): OpenAiCompatibleTransportRequest {
  const body = { ...request.body };
  delete body.reasoning_effort;
  delete body.reasoning;
  return {
    ...request,
    body
  };
}

function omitStreamOptions(
  request: OpenAiCompatibleTransportRequest
): OpenAiCompatibleTransportRequest {
  const body = { ...request.body };
  delete body.stream_options;
  return { ...request, body };
}

function toOpenAiCompatibleMessage(message: LlmMessage): JsonObject {
  return {
    role: message.role,
    content: message.content,
    ...(message.toolCallId === undefined ? {} : { tool_call_id: message.toolCallId }),
    ...(message.toolCalls === undefined
      ? {}
      : {
          tool_calls: message.toolCalls.map((toolCall) => ({
            id: toolCall.id,
            type: "function",
            function: {
              name: toolCall.name,
              arguments: toolCall.arguments
            }
          }))
        })
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
        if (
          !hasOnlyToolCallKeys(call) ||
          !safeAuthorityIdentifier(call.id) ||
          !safeAuthorityIdentifier(call.name) ||
          typeof call.arguments !== "string"
        ) {
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

function hasOnlyToolCallKeys(call: unknown): call is {
  readonly id: string;
  readonly name: string;
  readonly arguments: string;
} {
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

function safeAuthorityIdentifier(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u.test(value);
}

function providerContractFailure(message: string): LlmProviderFailure {
  return new LlmProviderFailure({ code: "LLM_PROVIDER_ERROR", message, retryable: false });
}

function parseChatCompletion(payload: unknown, request: LlmRequest): LlmProviderCompletion {
  const root = requireRecord(payload);
  const choices = root.choices;
  if (!Array.isArray(choices)) {
    throw malformedResponse(root);
  }

  const firstChoice = choices[0];
  if (!isRecord(firstChoice)) {
    throw malformedResponse(root);
  }

  const message = firstChoice.message;
  if (!isRecord(message)) {
    throw malformedResponse(root);
  }
  const content = message.content;
  if (
    typeof content !== "string" &&
    !(content === null && Array.isArray(message.tool_calls) && message.tool_calls.length > 0)
  ) {
    throw malformedResponse(root);
  }

  return {
    content: {
      type: "text",
      value: typeof content === "string" ? content : ""
    },
    usage: parseUsage(root.usage, request)
  };
}

function parseStreamChunk(
  payload: unknown,
  toolCallIdsByIndex: Map<number, string> = new Map(),
  syntheticToolCallPrefix = "tool_call_stream",
  request?: LlmRequest
): readonly LlmProviderStreamEvent[] {
  const root = requireRecord(payload);
  const choices = root.choices;
  if (!Array.isArray(choices)) {
    // OpenAI's optional final usage chunk has no choices on some compatible
    // endpoints. It is valid only when it actually carries usage.
    if (root.usage !== undefined) {
      return [{ type: "usage", usage: parseUsage(root.usage, request) }];
    }
    throw malformedResponse(root);
  }

  const events: LlmProviderStreamEvent[] = [];
  for (const choice of choices) {
    if (!isRecord(choice)) {
      throw malformedResponse(root);
    }

    const delta = choice.delta;
    if (!isRecord(delta)) {
      throw malformedResponse(root);
    }

    const content = delta.content;
    if (content !== undefined && content !== null) {
      if (typeof content !== "string") {
        throw malformedResponse(root);
      }
      events.push({
        type: "delta",
        value: content
      });
    }

    const toolCalls = delta.tool_calls;
    if (toolCalls !== undefined) {
      if (!Array.isArray(toolCalls)) {
        throw malformedResponse(root);
      }
      for (const toolCall of toolCalls) {
        if (!isRecord(toolCall)) throw malformedResponse(root);
        const index = typeof toolCall.index === "number" ? toolCall.index : 0;
        const providedToolCallId = typeof toolCall.id === "string" ? toolCall.id : undefined;
        let toolCallId = toolCallIdsByIndex.get(index);
        if (toolCallId === undefined) {
          toolCallId = providedToolCallId ?? `${syntheticToolCallPrefix}_${String(index)}`;
          toolCallIdsByIndex.set(index, toolCallId);
        }
        const functionValue = toolCall.function;
        if (!isRecord(functionValue)) throw malformedResponse(root);
        const name = functionValue.name;
        const argumentsDelta = functionValue.arguments;
        if (toolCallId === undefined && typeof argumentsDelta !== "string") {
          throw malformedResponse(root);
        }
        events.push({
          type: "tool_call_delta",
          toolCallId,
          ...(typeof name === "string" ? { name } : {}),
          ...(typeof argumentsDelta === "string" ? { argumentsDelta } : {})
        });
      }
    }
  }

  const rawFinishReason = choices
    .map((choice) => (isRecord(choice) ? choice.finish_reason : undefined))
    .find((value): value is string => typeof value === "string");
  // Emit round_completed for any non-null string finish_reason. Values beyond
  // "tool_calls" and "stop" indicate truncated/filtered rounds; the agent loop
  // enforces fail-closed dispatch and must NOT execute tool calls for those states.
  if (rawFinishReason !== undefined) {
    const finishReason =
      rawFinishReason === "tool_calls"
        ? "tool_calls"
        : rawFinishReason === "stop"
          ? "stop"
          : rawFinishReason === "length"
            ? "length"
            : rawFinishReason === "content_filter"
              ? "content_filter"
              : rawFinishReason === "aborted"
                ? "aborted"
                : rawFinishReason === "error"
                  ? "error"
                  : "unknown";
    events.push({ type: "round_completed", finishReason });
  }

  if (root.usage !== undefined) {
    events.push({
      type: "usage",
      usage: parseUsage(root.usage, request)
    });
  }

  return events;
}

function safeIdentifier(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 48);
  return normalized.length > 0 ? normalized : "request";
}

function parseUsage(value: unknown, request?: LlmRequest): LlmUsage {
  if (!isRecord(value)) {
    return unknownUsage();
  }

  const inputTokens = readNumber(value, "prompt_tokens");
  const outputTokens = readNumber(value, "completion_tokens");
  const totalTokens = readNumber(value, "total_tokens");

  if (inputTokens === undefined || outputTokens === undefined || totalTokens === undefined) {
    return unknownUsage();
  }

  const usage: LlmUsage = {
    inputTokens,
    outputTokens,
    totalTokens,
    usageStatus: "actual",
    cost: {
      amount: 0,
      currency: "USD",
      status: "unknown"
    }
  };
  const promptTokenDetails = isRecord(value["prompt_tokens_details"])
    ? value["prompt_tokens_details"]
    : undefined;
  const cacheReadTokens =
    readFirstNumber(
      promptTokenDetails,
      "cached_tokens",
      "cache_read_tokens",
      "cache_read_input_tokens"
    ) ?? readFirstNumber(value, "cache_read_tokens", "cache_read_input_tokens", "cached_tokens");
  const deepSeekCacheHitTokens = readNumber(value, "prompt_cache_hit_tokens");
  const deepSeekCacheMissTokens = readNumber(value, "prompt_cache_miss_tokens");
  const hasDeepSeekCacheEvidence =
    deepSeekCacheHitTokens !== undefined || deepSeekCacheMissTokens !== undefined;
  const cache = resolveOpenAiPromptCache(request);
  return withLlmPromptCacheUsage(usage, cache.resolution, {
    ...(hasDeepSeekCacheEvidence
      ? { cacheReadTokens: deepSeekCacheHitTokens ?? 0 }
      : cacheReadTokens === undefined
        ? {}
        : { cacheReadTokens }),
    ...(hasDeepSeekCacheEvidence
      ? {
          cacheEligibleInputTokens: (deepSeekCacheHitTokens ?? 0) + (deepSeekCacheMissTokens ?? 0)
        }
      : {}),
    cacheInputTokenSemantics: "included_in_input",
    ...(cache.physicalPrefixChecksum === undefined
      ? {}
      : { physicalPrefixChecksum: cache.physicalPrefixChecksum })
  });
}

function resolveOpenAiPromptCache(request: LlmRequest | undefined): {
  readonly resolution: ResolvedLlmPromptCacheRequest;
  readonly physicalPrefixChecksum?: string;
} {
  if (request === undefined) return { resolution: { active: false } };
  let resolution = resolveLlmPromptCacheRequest(request, "automatic_prefix");
  if (!resolution.active || resolution.config === undefined) return { resolution };
  const physicalPrefixChecksum = checksumProviderPayload({
    messages: request.messages
      .slice(0, resolution.config.stablePrefixMessageCount)
      .map(toOpenAiCompatibleMessage),
    ...(request.tools === undefined || request.tools.length === 0 ? {} : { tools: request.tools })
  });
  if (
    resolution.config.physicalPrefixChecksum !== undefined &&
    resolution.config.physicalPrefixChecksum !== physicalPrefixChecksum
  ) {
    resolution = rejectLlmPromptCacheRequest(resolution, "identity_unverified");
    return { resolution };
  }
  return { resolution, physicalPrefixChecksum };
}

function unknownUsage(): LlmUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    usageStatus: "missing",
    cost: {
      amount: 0,
      currency: "USD",
      status: "unknown"
    }
  };
}

function normalizeOpenAiCompatibleError(
  error: unknown,
  abortSignal?: AbortSignal
): LlmProviderFailure {
  if (error instanceof LlmProviderFailure) {
    return error;
  }

  if (abortSignal?.aborted === true || (error instanceof Error && error.name === "AbortError")) {
    return new LlmProviderFailure({
      code: "LLM_ABORTED",
      message: "The OpenAI-compatible request was cancelled.",
      retryable: false
    });
  }

  if (error instanceof OpenAiCompatibleHttpError) {
    const detail: JsonObject = {
      providerStatus: error.status
    };
    const providerMessage = readProviderErrorMessage(error.body);
    const providerRequestId = readProviderRequestId(error.body);
    if (providerRequestId !== undefined) {
      detail.providerRequestId = providerRequestId;
    }
    if (error.headers !== undefined) {
      for (const [key, value] of Object.entries(error.headers)) {
        detail[key] = value;
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
    message: "OpenAI-compatible transport failed.",
    retryable: false
  });
}

function throwIfStreamIncomplete(request: LlmRequest, sawRoundCompleted: boolean): void {
  if (request.abortSignal?.aborted === true) {
    throw new LlmProviderFailure({
      code: "LLM_ABORTED",
      message: "The OpenAI-compatible request was cancelled.",
      retryable: false
    });
  }
  if (!sawRoundCompleted) {
    throw new LlmProviderFailure({
      code: "LLM_MALFORMED_RESPONSE",
      message: "The OpenAI-compatible endpoint ended the stream before declaring a round result.",
      retryable: false,
      redactedDetail: { streamTermination: "missing" }
    });
  }
}

function duplicateRoundCompletion(): LlmProviderFailure {
  return new LlmProviderFailure({
    code: "LLM_MALFORMED_RESPONSE",
    message: "The OpenAI-compatible endpoint declared more than one round result.",
    retryable: false,
    redactedDetail: { streamTermination: "duplicate" }
  });
}

function readProviderErrorMessage(body: unknown): string | undefined {
  if (!isRecord(body)) {
    return undefined;
  }
  if (typeof body.message === "string" && body.message.trim().length > 0) {
    return body.message;
  }
  if (typeof body.error === "string" && body.error.trim().length > 0) {
    return body.error;
  }
  if (isRecord(body.error)) {
    const message = body.error.message;
    return typeof message === "string" && message.trim().length > 0 ? message : undefined;
  }
  return undefined;
}

/** Some compatible gateways put the rejected field in `error.param` and omit it from the message. */
function readProviderErrorParameter(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  const candidates: unknown[] = [body.param, body.parameter];
  if (isRecord(body.error)) {
    candidates.push(body.error.param, body.error.parameter);
  }
  return candidates.find((value): value is string => typeof value === "string")?.trim();
}

function readProviderErrorCode(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  const candidates: unknown[] = [body.code, body.error_code];
  if (isRecord(body.error)) {
    candidates.push(body.error.code, body.error.error_code);
  }
  return candidates.find((value): value is string => typeof value === "string")?.trim();
}

function readProviderRequestId(body: unknown): string | undefined {
  if (!isRecord(body) || !isRecord(body.error)) {
    return undefined;
  }

  return typeof body.error.request_id === "string" ? body.error.request_id : undefined;
}

function malformedResponse(root: UnknownRecord): LlmProviderFailure {
  const detail: JsonObject = {};
  if (typeof root.id === "string") {
    detail.providerResponseId = root.id;
  }

  return new LlmProviderFailure({
    code: "LLM_MALFORMED_RESPONSE",
    message: "OpenAI-compatible provider returned a malformed chat completion payload.",
    retryable: false,
    redactedDetail: detail
  });
}

function requireRecord(value: unknown): UnknownRecord {
  if (isRecord(value)) {
    return value;
  }

  throw new LlmProviderFailure({
    code: "LLM_MALFORMED_RESPONSE",
    message: "OpenAI-compatible provider returned a non-object payload.",
    retryable: false
  });
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNumber(record: UnknownRecord, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" ? value : undefined;
}

function readFirstNumber(
  record: UnknownRecord | undefined,
  ...keys: readonly string[]
): number | undefined {
  if (record === undefined) return undefined;
  for (const key of keys) {
    const value = readNumber(record, key);
    if (value !== undefined) return value;
  }
  return undefined;
}

interface UnknownRecord {
  readonly [key: string]: unknown;
}
