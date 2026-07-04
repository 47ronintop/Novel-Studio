import { createUnifiedError, type JsonObject, type UnifiedError } from "@novel-studio/shared";

export type ContextErrorCode =
  "CONTEXT_BUILD_INPUT_INVALID" | "CONTEXT_BUDGET_INVALID" | "CONTEXT_FULL_NOVEL_STUFFING_BLOCKED";

export function contextError(input: {
  readonly code: ContextErrorCode;
  readonly message: string;
  readonly suggestedAction: string;
  readonly traceId: string;
  readonly redactedDetail?: JsonObject;
}): UnifiedError {
  const errorInput = {
    code: input.code,
    category: "ValidationError",
    message: input.message,
    recoverability: "user-action",
    suggestedAction: input.suggestedAction,
    traceId: input.traceId
  } as const;

  return input.redactedDetail === undefined
    ? createUnifiedError(errorInput)
    : createUnifiedError({
        ...errorInput,
        redactedDetail: input.redactedDetail
      });
}
