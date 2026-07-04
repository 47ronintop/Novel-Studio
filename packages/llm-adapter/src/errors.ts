import {
  createUnifiedError,
  type JsonObject,
  type JsonValue,
  type UnifiedError,
  type UnifiedErrorInput
} from "@novel-studio/shared";

import type { LlmErrorCode, LlmProviderFailureInput } from "./types.js";

export class LlmProviderFailure extends Error {
  readonly code: LlmErrorCode;
  readonly retryable: boolean;
  readonly redactedDetail?: JsonObject;

  constructor(input: LlmProviderFailureInput) {
    super(input.message);
    this.name = "LlmProviderFailure";
    this.code = input.code;
    this.retryable = input.retryable;
    if (input.redactedDetail !== undefined) {
      this.redactedDetail = input.redactedDetail;
    }
  }
}

export interface NormalizedLlmFailure {
  readonly code: LlmErrorCode;
  readonly retryable: boolean;
  readonly error: UnifiedError;
}

export function createLlmFailure(input: {
  readonly code: LlmErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly traceId: string;
  readonly createdAt: string;
  readonly suggestedAction: string;
  readonly redactedDetail?: JsonObject;
}): NormalizedLlmFailure {
  const redactedDetail = redactProviderDetail(input.redactedDetail);
  const errorInput: UnifiedErrorInput = {
    code: input.code,
    category: "LLMAdapterError",
    message: input.message,
    recoverability: input.retryable ? "retryable" : "user-action",
    suggestedAction: input.suggestedAction,
    traceId: input.traceId,
    createdAt: input.createdAt
  };
  const error = createUnifiedError(
    redactedDetail === undefined
      ? errorInput
      : {
          ...errorInput,
          redactedDetail
        }
  );

  return {
    code: input.code,
    retryable: input.retryable,
    error
  };
}

export function normalizeProviderFailure(input: {
  readonly error: unknown;
  readonly traceId: string;
  readonly createdAt: string;
}): NormalizedLlmFailure {
  if (input.error instanceof LlmProviderFailure) {
    const failureInput = {
      code: input.error.code,
      message: input.error.message,
      retryable: input.error.retryable,
      traceId: input.traceId,
      createdAt: input.createdAt,
      suggestedAction: suggestedActionForCode(input.error.code)
    };

    return input.error.redactedDetail === undefined
      ? createLlmFailure(failureInput)
      : createLlmFailure({
          ...failureInput,
          redactedDetail: input.error.redactedDetail
        });
  }

  return createLlmFailure({
    code: "LLM_PROVIDER_ERROR",
    message: "The model provider failed before returning a usable response.",
    retryable: false,
    traceId: input.traceId,
    createdAt: input.createdAt,
    suggestedAction: "Check the model provider configuration and retry."
  });
}

export function missingUsage() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    usageStatus: "missing" as const,
    cost: {
      amount: 0,
      currency: "USD",
      status: "unknown" as const
    }
  };
}

export function retryExhaustedFailure(input: {
  readonly attempts: number;
  readonly lastCode: LlmErrorCode;
  readonly traceId: string;
  readonly createdAt: string;
}): NormalizedLlmFailure {
  return createLlmFailure({
    code: "LLM_RETRY_EXHAUSTED",
    message: "The model request failed after all retry attempts were used.",
    retryable: true,
    traceId: input.traceId,
    createdAt: input.createdAt,
    suggestedAction: "Wait briefly, then retry or switch model profile.",
    redactedDetail: {
      attempts: input.attempts,
      lastCode: input.lastCode
    }
  });
}

function suggestedActionForCode(code: LlmErrorCode): string {
  switch (code) {
    case "LLM_TIMEOUT":
      return "Increase the timeout or retry with a smaller request.";
    case "LLM_RATE_LIMITED":
      return "Wait for the provider rate limit window to reset or switch model profile.";
    case "LLM_RETRY_EXHAUSTED":
      return "Wait briefly, then retry or switch model profile.";
    case "LLM_PROVIDER_ERROR":
      return "Check the model provider configuration and retry.";
    case "LLM_MALFORMED_RESPONSE":
      return "Retry the request or choose a provider profile with structured output support.";
    case "LLM_UNSUPPORTED_MODE":
      return "Use an adapter method that supports the requested mode.";
    case "LLM_ABORTED":
      return "Start a new model request if the operation is still needed.";
  }
}

function redactProviderDetail(detail: JsonObject | undefined): JsonObject | undefined {
  if (detail === undefined) {
    return undefined;
  }

  const redacted: JsonObject = {};
  for (const [key, value] of Object.entries(detail)) {
    redacted[key] = redactValue(key, value);
  }

  return redacted;
}

function redactValue(key: string, value: JsonValue): JsonValue {
  if (isSecretKey(key)) {
    return "[REDACTED]";
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(key, item));
  }

  if (isJsonObject(value)) {
    return redactProviderDetail(value) ?? {};
  }

  return value;
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSecretKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    normalized.includes("authorization") ||
    normalized.includes("apikey") ||
    normalized.includes("api_key") ||
    normalized.includes("token") ||
    normalized.includes("secret")
  );
}
