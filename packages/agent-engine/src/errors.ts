import { createUnifiedError, type JsonObject, type UnifiedError } from "@novel-studio/shared";

export type AgentErrorCode =
  | "AGENT_CONFIG_INVALID"
  | "AGENT_INPUT_INVALID"
  | "AGENT_MODEL_CALL_FAILED"
  | "AGENT_OUTPUT_MALFORMED"
  | "AGENT_OUTPUT_INVALID";

export function agentError(input: {
  readonly code: AgentErrorCode;
  readonly message: string;
  readonly suggestedAction: string;
  readonly traceId: string;
  readonly redactedDetail?: JsonObject;
}): UnifiedError {
  const errorInput = {
    code: input.code,
    category: "AgentError",
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
