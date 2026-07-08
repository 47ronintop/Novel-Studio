import type { JsonObject } from "@novel-studio/shared";

import { LlmProviderFailure } from "./errors.js";
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
          ...parseChatCompletion(result.payload),
          ...(result.warning === undefined ? {} : { warnings: [result.warning] })
        };
      } catch (error) {
        throw normalizeOpenAiCompatibleError(error);
      }
    },
    stream(request) {
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
    try {
      for await (const chunk of streamTransport(transportRequest)) {
        for (const event of parseStreamChunk(chunk)) {
          emittedEvent = true;
          yield event;
        }
      }
      return;
    } catch (error) {
      if (!emittedEvent && shouldRetryWithoutReasoningEffort(error, transportRequest)) {
        yield reasoningEffortIgnoredWarning();
        for await (const chunk of streamTransport(omitReasoningEffort(transportRequest))) {
          for (const event of parseStreamChunk(chunk)) {
            yield event;
          }
        }
        return;
      }
      throw error;
    }
  } catch (error) {
    throw normalizeOpenAiCompatibleError(error);
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
    body.reasoning_effort = request.parameters.reasoningEffort;
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
      "The model endpoint does not support reasoning strength controls. reasoning_effort was removed and the request was retried."
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
  return (
    error.status >= 400 &&
    error.status < 500 &&
    /reasoning[_ .-]?effort/i.test(message) &&
    /(unrecognized|unknown|unsupported|not supported|invalid|not accept)/i.test(message)
  );
}

function hasReasoningEffort(body: JsonObject): boolean {
  return Object.hasOwn(body, "reasoning_effort");
}

function omitReasoningEffort(
  request: OpenAiCompatibleTransportRequest
): OpenAiCompatibleTransportRequest {
  const body = { ...request.body };
  delete body.reasoning_effort;
  return {
    ...request,
    body
  };
}

function toOpenAiCompatibleMessage(message: LlmMessage): JsonObject {
  return {
    role: message.role,
    content: message.content
  };
}

function parseChatCompletion(payload: unknown): LlmProviderCompletion {
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
  if (!isRecord(message) || typeof message.content !== "string") {
    throw malformedResponse(root);
  }

  return {
    content: {
      type: "text",
      value: message.content
    },
    usage: parseUsage(root.usage)
  };
}

function parseStreamChunk(payload: unknown): readonly LlmProviderStreamEvent[] {
  const root = requireRecord(payload);
  const choices = root.choices;
  if (!Array.isArray(choices)) {
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
    if (content !== undefined) {
      if (typeof content !== "string") {
        throw malformedResponse(root);
      }
      events.push({
        type: "delta",
        value: content
      });
    }
  }

  if (root.usage !== undefined) {
    events.push({
      type: "usage",
      usage: parseUsage(root.usage)
    });
  }

  return events;
}

function parseUsage(value: unknown): LlmUsage {
  if (!isRecord(value)) {
    return unknownUsage();
  }

  const inputTokens = readNumber(value, "prompt_tokens");
  const outputTokens = readNumber(value, "completion_tokens");
  const totalTokens = readNumber(value, "total_tokens");

  if (inputTokens === undefined || outputTokens === undefined || totalTokens === undefined) {
    return unknownUsage();
  }

  return {
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

function normalizeOpenAiCompatibleError(error: unknown): LlmProviderFailure {
  if (error instanceof LlmProviderFailure) {
    return error;
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
      code: error.status === 429 ? "LLM_RATE_LIMITED" : "LLM_PROVIDER_ERROR",
      message: providerMessage ?? error.message,
      retryable: error.status === 429 || error.status >= 500,
      redactedDetail: detail
    });
  }

  return new LlmProviderFailure({
    code: "LLM_PROVIDER_ERROR",
    message: "OpenAI-compatible transport failed.",
    retryable: false
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

interface UnknownRecord {
  readonly [key: string]: unknown;
}
