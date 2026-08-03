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
  LlmRoundFinishReason,
  LlmUsage
} from "./types.js";

export interface GeminiTransportRequest {
  readonly url: string;
  readonly headers?: JsonObject;
  readonly body: JsonObject;
  readonly timeoutMs?: number;
  readonly abortSignal?: AbortSignal;
}

export type GeminiTransport = (request: GeminiTransportRequest) => Promise<unknown>;

export type GeminiStreamTransport = (request: GeminiTransportRequest) => AsyncIterable<unknown>;

export interface GeminiProviderOptions {
  readonly transport: GeminiTransport;
  readonly streamTransport?: GeminiStreamTransport;
  readonly resolveApiKey?: (apiKeyRef: string) => Promise<string | undefined>;
}

export interface GeminiPromptCacheResourceDescriptor {
  readonly body: JsonObject;
  readonly physicalPrefixChecksum: string;
}

export class GeminiHttpError extends Error {
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
    this.name = "GeminiHttpError";
    this.status = input.status;
    if (input.body !== undefined) this.body = input.body;
    if (input.headers !== undefined) this.headers = input.headers;
  }
}

export function createGeminiProvider(options: GeminiProviderOptions): LlmProvider {
  return {
    id: "google-gemini",
    async complete(request) {
      try {
        throwIfAborted(request);
        const payload = await options.transport(await createTransportRequest(request, options));
        throwIfAborted(request);
        return parseGenerateContent(payload, request);
      } catch (error) {
        throw normalizeGeminiError(error, request.abortSignal);
      }
    },
    stream(request) {
      assertCanonicalMessageContract(request);
      if (options.streamTransport === undefined) return unsupportedStream();
      return streamGenerateContent(options.streamTransport, request, options);
    }
  };
}

async function* streamGenerateContent(
  transport: GeminiStreamTransport,
  request: LlmRequest,
  options: Pick<GeminiProviderOptions, "resolveApiKey">
): AsyncIterable<LlmProviderStreamEvent> {
  try {
    throwIfAborted(request);
    const transportRequest = await createTransportRequest(request, options, true);
    let toolCallSerial = 0;
    let sawToolCall = false;
    let sawRoundCompleted = false;

    for await (const payload of transport(transportRequest)) {
      throwIfAborted(request);
      const root = requireRecord(payload);
      if (isRecord(root["error"])) throw streamProviderError(root);
      const candidates = root["candidates"];
      if (candidates !== undefined && !Array.isArray(candidates)) throw malformedResponse(root);

      const promptFeedback = root["promptFeedback"];
      if (promptFeedback !== undefined) {
        const feedback = requireRecord(promptFeedback);
        if (stringValue(feedback["blockReason"]) !== undefined) {
          if (sawRoundCompleted) throw malformedResponse(root);
          sawRoundCompleted = true;
          yield { type: "round_completed", finishReason: "content_filter" };
        }
      }

      const candidateList = candidates ?? [];
      const rawCandidate = candidateList[0];
      if (rawCandidate !== undefined) {
        const candidateIndex = 0;
        const candidate = requireRecord(rawCandidate);
        const content = candidate["content"];
        if (content !== undefined) {
          const parts = requireParts(content);
          for (const [partIndex, rawPart] of parts.entries()) {
            const part = requireRecord(rawPart);
            if (typeof part["text"] === "string") {
              if (part["thought"] !== true && part["text"].length > 0) {
                yield { type: "delta", value: part["text"] };
              }
              continue;
            }
            if (isRecord(part["functionCall"])) {
              const call = part["functionCall"];
              const name = stringValue(call["name"]);
              const args = call["args"];
              if (name === undefined || !isRecord(args)) throw malformedResponse(root);
              const providerId = stringValue(call["id"]);
              const thoughtSignature = optionalThoughtSignature(part["thoughtSignature"], root);
              const toolCallId =
                providerId ??
                `gemini_${safeIdentifier(request.requestId)}_${String(candidateIndex)}_${String(partIndex)}_${String(++toolCallSerial)}`;
              sawToolCall = true;
              yield {
                type: "tool_call_delta",
                toolCallId,
                name,
                argumentsDelta: JSON.stringify(args),
                ...(thoughtSignature === undefined
                  ? {}
                  : { providerMetadata: { thoughtSignature } })
              };
            }
          }
        }

        const finishReason = stringValue(candidate["finishReason"]);
        if (finishReason !== undefined) {
          if (sawRoundCompleted) throw malformedResponse(root);
          sawRoundCompleted = true;
          yield {
            type: "round_completed",
            finishReason: normalizeFinishReason(finishReason, sawToolCall)
          };
        }
      }

      const usage = parseUsage(root["usageMetadata"], request);
      if (usage !== undefined) yield { type: "usage", usage };
    }
    throwIfAborted(request);
    if (!sawRoundCompleted) throw truncatedStream();
  } catch (error) {
    throw normalizeGeminiError(error, request.abortSignal);
  }
}

function unsupportedStream(): AsyncIterable<LlmProviderStreamEvent> {
  return {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<LlmProviderStreamEvent>> {
          throw new LlmProviderFailure({
            code: "LLM_UNSUPPORTED_MODE",
            message: "Gemini streaming is not configured for this runtime.",
            retryable: false
          });
        }
      };
    }
  };
}

async function createTransportRequest(
  request: LlmRequest,
  options: Pick<GeminiProviderOptions, "resolveApiKey">,
  streaming = false
): Promise<GeminiTransportRequest> {
  assertCanonicalMessageContract(request);
  const baseUrl = requiredBaseUrl(request);
  const promptCache = resolveGeminiPromptCache(request);
  const requestMessages =
    promptCache.resolution.active && promptCache.resolution.config !== undefined
      ? request.messages.slice(promptCache.resolution.config.stablePrefixMessageCount)
      : request.messages;
  const authority = requestMessages.find(
    (message) => message.role === "system" || message.role === "developer"
  );
  const systemText = authority?.content;
  const body: JsonObject = {
    contents: toGeminiContents(
      requestMessages.filter((message) => message.role !== "system" && message.role !== "developer")
    ) as unknown as JsonValue
  };
  if (systemText !== undefined) {
    body["systemInstruction"] = { parts: [{ text: systemText }] } as unknown as JsonValue;
  }

  const generationConfig: JsonObject = {};
  if (request.parameters.temperature !== undefined)
    generationConfig["temperature"] = request.parameters.temperature;
  if (request.parameters.maxTokens !== undefined)
    generationConfig["maxOutputTokens"] = request.parameters.maxTokens;
  if (request.parameters.topP !== undefined) generationConfig["topP"] = request.parameters.topP;
  if (Object.keys(generationConfig).length > 0) body["generationConfig"] = generationConfig;

  if (promptCache.resolution.active && promptCache.resolution.config?.resourceRef !== undefined) {
    body["cachedContent"] = promptCache.resolution.config.resourceRef;
  } else if (request.tools !== undefined && request.tools.length > 0) {
    body["tools"] = toGeminiTools(request.tools) as unknown as JsonValue;
  }

  const apiKey =
    options.resolveApiKey === undefined
      ? undefined
      : await options.resolveApiKey(request.modelProfile.apiKeyRef ?? "");
  const headers: JsonObject = {};
  if (apiKey !== undefined) headers["x-goog-api-key"] = apiKey;

  return {
    url: geminiModelUrl(baseUrl, request.modelProfile.modelName, streaming),
    ...(Object.keys(headers).length === 0 ? {} : { headers }),
    body,
    ...(request.modelProfile.timeoutMs === undefined
      ? {}
      : { timeoutMs: request.modelProfile.timeoutMs }),
    ...(request.abortSignal === undefined ? {} : { abortSignal: request.abortSignal })
  };
}

function toGeminiTools(tools: NonNullable<LlmRequest["tools"]>): readonly JsonObject[] {
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.function.name,
        ...(tool.function.description === undefined
          ? {}
          : { description: tool.function.description }),
        parametersJsonSchema: tool.function.parameters ?? { type: "object", properties: {} }
      })) as unknown as JsonValue
    }
  ];
}

function resolveGeminiPromptCache(request: LlmRequest): {
  readonly resolution: ResolvedLlmPromptCacheRequest;
  readonly physicalPrefixChecksum?: string;
} {
  let resolution = resolveLlmPromptCacheRequest(request, "explicit_resource");
  if (!resolution.active || resolution.config === undefined) return { resolution };
  const descriptor = createGeminiPromptCacheResourceDescriptor(request);
  if (descriptor === undefined) {
    return {
      resolution: rejectLlmPromptCacheRequest(resolution, "identity_unverified")
    };
  }
  if (
    resolution.config.physicalPrefixChecksum === undefined ||
    resolution.config.physicalPrefixChecksum !== descriptor.physicalPrefixChecksum
  ) {
    resolution = rejectLlmPromptCacheRequest(resolution, "identity_unverified");
    return { resolution };
  }
  return { resolution, physicalPrefixChecksum: descriptor.physicalPrefixChecksum };
}

/**
 * Builds the exact provider-native stable prefix used to create a Gemini cached-content resource.
 * Main owns the network lifecycle; the adapter owns this serialization so creation and use cannot
 * disagree about the physical bytes represented by `physicalPrefixChecksum`.
 */
export function createGeminiPromptCacheResourceDescriptor(
  request: LlmRequest
): GeminiPromptCacheResourceDescriptor | undefined {
  assertCanonicalMessageContract(request);
  const config = request.promptCache;
  if (config === undefined || config.mode !== "explicit_resource") return undefined;
  const candidateRequest: LlmRequest = {
    ...request,
    promptCache: {
      ...config,
      resourceRef: config.resourceRef ?? "cachedContents/main_pending"
    }
  };
  const resolution = resolveLlmPromptCacheRequest(candidateRequest, "explicit_resource");
  if (!resolution.active || resolution.config === undefined) return undefined;

  const prefixMessages = request.messages.slice(0, config.stablePrefixMessageCount);
  const suffixMessages = request.messages.slice(config.stablePrefixMessageCount);
  if (
    prefixMessages.some((message) => message.role === "assistant" || message.role === "tool") ||
    suffixMessages.some((message) => message.role === "system" || message.role === "developer")
  ) {
    return undefined;
  }

  const systemText = prefixMessages.find(
    (message) => message.role === "system" || message.role === "developer"
  )?.content;
  const prefixPayload: JsonObject = {
    contents: toGeminiContents(
      prefixMessages.filter((message) => message.role !== "system" && message.role !== "developer")
    ) as unknown as JsonValue
  };
  if (systemText !== undefined) {
    prefixPayload["systemInstruction"] = {
      parts: [{ text: systemText }]
    } as unknown as JsonValue;
  }
  if (request.tools !== undefined && request.tools.length > 0) {
    prefixPayload["tools"] = toGeminiTools(request.tools) as unknown as JsonValue;
  }
  return {
    body: {
      model: `models/${request.modelProfile.modelName}`,
      ...prefixPayload,
      ...(config.ttlSeconds === undefined ? {} : { ttl: `${String(config.ttlSeconds)}s` })
    },
    physicalPrefixChecksum: checksumProviderPayload(prefixPayload)
  };
}

function toGeminiContents(messages: readonly LlmMessage[]): JsonObject[] {
  const namesByCallId = new Map<string, string>();

  const contents: JsonObject[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message === undefined) continue;
    if (message.role === "tool") {
      const parts: JsonObject[] = [];
      let toolIndex = index;
      while (toolIndex < messages.length && messages[toolIndex]?.role === "tool") {
        const toolMessage = messages[toolIndex];
        const toolCallId = toolMessage?.toolCallId;
        const name = toolCallId === undefined ? undefined : namesByCallId.get(toolCallId);
        if (toolMessage === undefined || toolCallId === undefined || name === undefined) {
          throw new LlmProviderFailure({
            code: "LLM_PROVIDER_ERROR",
            message: "Gemini tool results require a matching prior tool call.",
            retryable: false
          });
        }
        parts.push({
          functionResponse: {
            id: toolCallId,
            name,
            response: parseToolResult(toolMessage.content)
          }
        });
        toolIndex += 1;
      }
      contents.push({ role: "user", parts });
      index = toolIndex - 1;
      continue;
    }

    if (message.role === "assistant" && message.toolCalls !== undefined) {
      const parts: JsonObject[] = [];
      if (message.content.length > 0) parts.push({ text: message.content });
      for (const call of message.toolCalls) {
        namesByCallId.set(call.id, call.name);
        const thoughtSignature = optionalStoredThoughtSignature(call.providerMetadata);
        parts.push({
          functionCall: {
            id: call.id,
            name: call.name,
            args: parseToolArguments(call.arguments)
          },
          ...(thoughtSignature === undefined ? {} : { thoughtSignature })
        });
      }
      contents.push({ role: "model", parts });
      continue;
    }

    contents.push({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }]
    });
  }
  return contents;
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
          !safeAuthorityIdentifier(call.name)
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

function safeAuthorityIdentifier(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u.test(value);
}

function providerContractFailure(message: string): LlmProviderFailure {
  return new LlmProviderFailure({ code: "LLM_PROVIDER_ERROR", message, retryable: false });
}

function parseToolArguments(value: string): JsonObject {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (isRecord(parsed)) return parsed;
  } catch {
    // The stable error below deliberately excludes provider/user payloads.
  }
  throw new LlmProviderFailure({
    code: "LLM_PROVIDER_ERROR",
    message: "Gemini tool call arguments must be a JSON object.",
    retryable: false
  });
}

function parseToolResult(value: string): JsonObject {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (isRecord(parsed)) return parsed;
  } catch {
    // Plain tool output is wrapped so Gemini still receives an object response.
  }
  return { content: value };
}

function parseGenerateContent(payload: unknown, request: LlmRequest): LlmProviderCompletion {
  const root = requireRecord(payload);
  const candidates = root["candidates"];
  if (!Array.isArray(candidates) || candidates.length === 0) throw malformedResponse(root);
  const candidate = requireRecord(candidates[0]);
  const parts = requireParts(candidate["content"]);
  const text = parts
    .map((rawPart) => {
      const part = requireRecord(rawPart);
      if (part["text"] === undefined) return "";
      if (typeof part["text"] !== "string") throw malformedResponse(root);
      return part["thought"] === true ? "" : part["text"];
    })
    .join("");
  return {
    content: { type: "text", value: text },
    usage: parseUsage(root["usageMetadata"], request) ?? missingUsage(request)
  };
}

function requireParts(content: unknown): readonly unknown[] {
  const value = requireRecord(content);
  const parts = value["parts"];
  if (!Array.isArray(parts)) throw malformedResponse(value);
  return parts;
}

function parseUsage(value: unknown, request?: LlmRequest): LlmUsage | undefined {
  if (!isRecord(value)) return undefined;
  const inputTokens = numberValue(value["promptTokenCount"]);
  const outputTokens = numberValue(value["candidatesTokenCount"]);
  const cachedTokens = numberValue(value["cachedContentTokenCount"]);
  const reasoningTokens = numberValue(value["thoughtsTokenCount"]);
  const providerTotal = numberValue(value["totalTokenCount"]);
  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    cachedTokens === undefined &&
    reasoningTokens === undefined &&
    providerTotal === undefined
  ) {
    return undefined;
  }
  const usage: LlmUsage = {
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
    totalTokens: providerTotal ?? (inputTokens ?? 0) + (outputTokens ?? 0),
    usageStatus: "actual",
    cost: { amount: 0, currency: "USD", status: "unknown" }
  };
  const promptCache =
    request === undefined
      ? { resolution: { active: false } satisfies ResolvedLlmPromptCacheRequest }
      : resolveGeminiPromptCache(request);
  const cacheWriteTokens = promptCache.resolution.config?.resourceWriteTokens;
  const cacheEligibleInputTokens = geminiCacheEligibleInputTokens(cachedTokens, cacheWriteTokens);
  return withLlmPromptCacheUsage(usage, promptCache.resolution, {
    ...(cachedTokens === undefined ? {} : { cacheReadTokens: cachedTokens }),
    ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
    ...(cacheEligibleInputTokens === undefined ? {} : { cacheEligibleInputTokens }),
    cacheInputTokenSemantics: "included_in_input",
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
      : resolveGeminiPromptCache(request);
  const cacheWriteTokens = promptCache.resolution.config?.resourceWriteTokens;
  return withLlmPromptCacheUsage(usage, promptCache.resolution, {
    ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
    ...(cacheWriteTokens === undefined ? {} : { cacheEligibleInputTokens: cacheWriteTokens }),
    cacheInputTokenSemantics: "included_in_input",
    ...(promptCache.physicalPrefixChecksum === undefined
      ? {}
      : { physicalPrefixChecksum: promptCache.physicalPrefixChecksum })
  });
}

function geminiCacheEligibleInputTokens(
  cacheReadTokens: number | undefined,
  cacheWriteTokens: number | undefined
): number | undefined {
  return cacheReadTokens !== undefined && cacheReadTokens > 0
    ? cacheReadTokens
    : (cacheWriteTokens ?? cacheReadTokens);
}

function normalizeFinishReason(value: string, sawToolCall: boolean): LlmRoundFinishReason {
  if (value === "STOP") return sawToolCall ? "tool_calls" : "stop";
  if (value === "MAX_TOKENS") return "length";
  if (
    value === "SAFETY" ||
    value === "RECITATION" ||
    value === "BLOCKLIST" ||
    value === "PROHIBITED_CONTENT" ||
    value === "SPII"
  ) {
    return "content_filter";
  }
  if (value === "MALFORMED_FUNCTION_CALL" || value === "UNEXPECTED_TOOL_CALL") return "error";
  return "unknown";
}

function normalizeGeminiError(
  error: unknown,
  abortSignal: AbortSignal | undefined
): LlmProviderFailure {
  if (error instanceof LlmProviderFailure) return error;
  if (abortSignal?.aborted === true || (error instanceof Error && error.name === "AbortError")) {
    return new LlmProviderFailure({
      code: "LLM_ABORTED",
      message: "The Gemini request was cancelled.",
      retryable: false
    });
  }
  if (error instanceof GeminiHttpError) {
    const detail: JsonObject = { providerStatus: error.status };
    const providerRequestId = readProviderRequestId(error.body, error.headers);
    if (providerRequestId !== undefined) detail["providerRequestId"] = providerRequestId;
    for (const [key, value] of Object.entries(error.headers ?? {})) {
      detail[key] = isSensitiveHeader(key) ? "[REDACTED]" : value;
    }
    return new LlmProviderFailure({
      code:
        error.status === 408
          ? "LLM_TIMEOUT"
          : error.status === 429
            ? "LLM_RATE_LIMITED"
            : "LLM_PROVIDER_ERROR",
      message: readProviderErrorMessage(error.body) ?? error.message,
      retryable: error.status === 408 || error.status === 429 || error.status >= 500,
      redactedDetail: detail
    });
  }
  return new LlmProviderFailure({
    code: "LLM_PROVIDER_ERROR",
    message: "Gemini transport failed.",
    retryable: false
  });
}

function readProviderErrorMessage(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  const error = isRecord(body["error"]) ? body["error"] : body;
  return stringValue(error["message"]);
}

function readProviderRequestId(body: unknown, headers: JsonObject | undefined): string | undefined {
  if (isRecord(body) && isRecord(body["error"])) {
    const requestId = stringValue(body["error"]["requestId"]);
    if (requestId !== undefined) return requestId;
  }
  if (headers === undefined) return undefined;
  return stringValue(headers["x-request-id"]) ?? stringValue(headers["request-id"]);
}

function requiredBaseUrl(request: LlmRequest): string {
  const baseUrl = request.modelProfile.baseUrl?.trim();
  if (baseUrl === undefined || baseUrl.length === 0) {
    throw new LlmProviderFailure({
      code: "LLM_PROVIDER_ERROR",
      message: "Gemini provider requires a baseUrl.",
      retryable: false
    });
  }
  return baseUrl;
}

function geminiModelUrl(baseUrl: string, modelName: string, streaming: boolean): string {
  const normalized = baseUrl.replace(/\/+$/, "");
  const method = streaming ? "streamGenerateContent?alt=sse" : "generateContent";
  return `${normalized}/models/${encodeURIComponent(modelName)}:${method}`;
}

function throwIfAborted(request: LlmRequest): void {
  if (request.abortSignal?.aborted === true) {
    throw new LlmProviderFailure({
      code: "LLM_ABORTED",
      message: "The Gemini request was cancelled.",
      retryable: false
    });
  }
}

function malformedResponse(body: JsonObject): LlmProviderFailure {
  return new LlmProviderFailure({
    code: "LLM_MALFORMED_RESPONSE",
    message: "Gemini returned a malformed response.",
    retryable: false,
    redactedDetail: { responseShape: Object.keys(body).sort().join(",") }
  });
}

function truncatedStream(): LlmProviderFailure {
  return new LlmProviderFailure({
    code: "LLM_MALFORMED_RESPONSE",
    message: "Gemini ended the stream before declaring a round result.",
    retryable: false,
    redactedDetail: { streamTermination: "missing" }
  });
}

function streamProviderError(root: JsonObject): GeminiHttpError {
  const error = requireRecord(root["error"]);
  return new GeminiHttpError({
    status: numberValue(error["code"]) ?? 500,
    message: stringValue(error["message"]) ?? "Gemini returned a streaming error.",
    body: root
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

function safeIdentifier(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 48);
  return normalized.length > 0 ? normalized : "request";
}

function optionalThoughtSignature(value: unknown, root: JsonObject): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0 || value.length > 16_384) {
    throw malformedResponse(root);
  }
  return value;
}

function optionalStoredThoughtSignature(metadata: JsonObject | undefined): string | undefined {
  if (metadata === undefined) return undefined;
  const value = metadata["thoughtSignature"];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0 || value.length > 16_384) {
    throw new LlmProviderFailure({
      code: "LLM_PROVIDER_ERROR",
      message: "Gemini tool continuation metadata is invalid.",
      retryable: false
    });
  }
  return value;
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
