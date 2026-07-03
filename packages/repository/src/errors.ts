import {
  createUnifiedError,
  type JsonObject,
  type UnifiedError,
  type UnifiedErrorInput
} from "@novel-studio/shared";

export function storageError(input: {
  code: string;
  message: string;
  suggestedAction: string;
  traceId: string;
  redactedDetail?: JsonObject;
}): UnifiedError {
  const errorInput: UnifiedErrorInput = {
    code: input.code,
    category: "StorageError",
    message: input.message,
    recoverability: "user-action",
    suggestedAction: input.suggestedAction,
    traceId: input.traceId
  };

  return createUnifiedError(withOptionalDetail(errorInput, input.redactedDetail));
}

export function validationError(input: {
  code: string;
  message: string;
  suggestedAction: string;
  traceId: string;
  redactedDetail?: JsonObject;
}): UnifiedError {
  const errorInput: UnifiedErrorInput = {
    code: input.code,
    category: "ValidationError",
    message: input.message,
    recoverability: "user-action",
    suggestedAction: input.suggestedAction,
    traceId: input.traceId
  };

  return createUnifiedError(withOptionalDetail(errorInput, input.redactedDetail));
}

function withOptionalDetail(
  input: UnifiedErrorInput,
  redactedDetail: JsonObject | undefined
): UnifiedErrorInput {
  if (redactedDetail === undefined) {
    return input;
  }

  return {
    ...input,
    redactedDetail
  };
}
