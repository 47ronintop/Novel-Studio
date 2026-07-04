import {
  createUnifiedError,
  type JsonObject,
  type UnifiedError,
  type UnifiedErrorInput
} from "@novel-studio/shared";

export type WorkflowErrorCode =
  | "WORKFLOW_DEFINITION_INVALID"
  | "WORKFLOW_STEP_NOT_FOUND"
  | "WORKFLOW_DUPLICATE_STEP"
  | "WORKFLOW_AGENT_STEP_MISSING_AGENT"
  | "WORKFLOW_RUN_STATE_INVALID"
  | "WORKFLOW_CONFIRMATION_REQUIRED"
  | "WORKFLOW_STEP_MISMATCH";

export function workflowError(input: {
  readonly code: WorkflowErrorCode;
  readonly message: string;
  readonly suggestedAction: string;
  readonly traceId: string;
  readonly redactedDetail?: JsonObject;
}): UnifiedError {
  const base: UnifiedErrorInput = {
    code: input.code,
    category: "WorkflowError",
    message: input.message,
    recoverability: "user-action",
    suggestedAction: input.suggestedAction,
    traceId: input.traceId
  };

  return createUnifiedError(
    input.redactedDetail === undefined
      ? base
      : {
          ...base,
          redactedDetail: input.redactedDetail
        }
  );
}
