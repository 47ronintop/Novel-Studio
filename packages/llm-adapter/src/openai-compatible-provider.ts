import type { JsonObject } from "@novel-studio/shared";

import { LlmProviderFailure } from "./errors.js";
import type {
  LlmMessage,
  LlmProvider,
  LlmProviderCompletion,
  LlmProviderStreamEvent,
  LlmRequest,
  LlmUsage
} from "./types.js";

export interface OpenAiCompatibleTransportRequest {
  readonly url: string;
  readonly body: JsonObject;
  readonly timeoutMs?: number;
}

export type OpenAiCompatibleTransport = (
  request: OpenAiCompatibleTransportRequest
) => Promise<unknown>;

export interface OpenAiCompatibleProviderOptions {
  readonly transport: OpenAiCompatibleTransport;
}

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
        const payload = await options.transport(createTransportRequest(request));
        return parseChatCompletion(payload);
      } catch (error) {
        throw normalizeOpenAiCompatibleError(error);
      }
    },
    stream() {
      return unsupportedStream();
    }
  };
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

function createTransportRequest(request: LlmRequest): OpenAiCompatibleTransportRequest {
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
    stream: false
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

  const transportRequest = {
    url: `${baseUrl.replace(/\/+$/, "")}/chat/completions`,
    body
  };

  return request.modelProfile.timeoutMs === undefined
    ? transportRequest
    : {
        ...transportRequest,
        timeoutMs: request.modelProfile.timeoutMs
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
      message: error.message,
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
