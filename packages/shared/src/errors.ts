import { randomUUID } from "node:crypto";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export type ErrorCategory =
  | "UserError"
  | "ValidationError"
  | "StorageError"
  | "ModelProviderError"
  | "LLMAdapterError"
  | "WorkflowError"
  | "AgentError"
  | "PluginError";

export type Recoverability = "retryable" | "user-action" | "fatal" | "unknown";

export interface UnifiedError {
  schemaVersion: "1.0";
  errorId: string;
  code: string;
  category: ErrorCategory;
  message: string;
  recoverability: Recoverability;
  suggestedAction: string;
  traceId: string;
  createdAt: string;
  redactedDetail?: JsonObject;
}

export interface UnifiedErrorInput {
  code: string;
  category: ErrorCategory;
  message: string;
  recoverability: Recoverability;
  suggestedAction: string;
  traceId: string;
  errorId?: string;
  createdAt?: string;
  redactedDetail?: JsonObject;
}

export function createUnifiedError(input: UnifiedErrorInput): UnifiedError {
  const baseError: UnifiedError = {
    schemaVersion: "1.0",
    errorId: input.errorId ?? `err_${randomUUID().replaceAll("-", "")}`,
    code: input.code,
    category: input.category,
    message: input.message,
    recoverability: input.recoverability,
    suggestedAction: input.suggestedAction,
    traceId: input.traceId,
    createdAt: input.createdAt ?? new Date().toISOString()
  };

  if (input.redactedDetail === undefined) {
    return baseError;
  }

  return {
    ...baseError,
    redactedDetail: input.redactedDetail
  };
}
