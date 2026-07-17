import {
  createAgentRunErrorRecord,
  validateAgentRunErrorRecord,
  type AgentRunErrorRecord,
  type AgentRunRecoveryState,
  type AgentRunRetryTarget
} from "@novel-studio/agent-engine";
import { createUnifiedError, err, ok, type JsonObject, type Result, type UnifiedError } from "@novel-studio/shared";

export interface AgentDiagnosticsRepositoryPort {
  writeRunError(
    runId: string,
    record: JsonObject
  ): Promise<Result<JsonObject, UnifiedError>>;
  readRunError(
    runId: string,
    errorId: string
  ): Promise<Result<JsonObject | undefined, UnifiedError>>;
  writePreflightError(record: JsonObject): Promise<Result<JsonObject, UnifiedError>>;
  readPreflightError(errorId: string): Promise<Result<JsonObject | undefined, UnifiedError>>;
}

interface AgentErrorBinding {
  readonly projectId: string;
  readonly error: UnifiedError;
  readonly sequence?: number;
  readonly checkpointId?: string;
  readonly toolCallId?: string;
  readonly planStepId?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly detail?: JsonObject;
  readonly recoveryState: AgentRunRecoveryState;
  readonly retryTargets?: readonly AgentRunRetryTarget[];
}

export interface RecordAgentRunErrorInput extends AgentErrorBinding {
  readonly runId: string;
}

export interface RecordAgentPreflightErrorInput extends AgentErrorBinding {
  readonly runDraftId: string;
}

export interface AgentDiagnosticsSession {
  recordRunError(
    input: RecordAgentRunErrorInput
  ): Promise<Result<AgentRunErrorRecord, UnifiedError>>;
  recordPreflightError(
    input: RecordAgentPreflightErrorInput
  ): Promise<Result<AgentRunErrorRecord, UnifiedError>>;
  readRunError(
    runId: string,
    errorId: string
  ): Promise<Result<AgentRunErrorRecord | undefined, UnifiedError>>;
  readPreflightError(
    errorId: string
  ): Promise<Result<AgentRunErrorRecord | undefined, UnifiedError>>;
}

export interface CreateAgentDiagnosticsSessionOptions {
  readonly repository: AgentDiagnosticsRepositoryPort;
}

export function createAgentDiagnosticsSession(
  options: CreateAgentDiagnosticsSessionOptions
): AgentDiagnosticsSession {
  async function persist(
    input: RecordAgentRunErrorInput | RecordAgentPreflightErrorInput
  ): Promise<Result<AgentRunErrorRecord, UnifiedError>> {
    const record = createAgentRunErrorRecord({
      errorId: input.error.errorId,
      projectId: input.projectId,
      ...(isRunBinding(input) ? { runId: input.runId } : { runDraftId: input.runDraftId }),
      ...(input.sequence === undefined ? {} : { sequence: input.sequence }),
      ...(input.checkpointId === undefined ? {} : { checkpointId: input.checkpointId }),
      ...(input.toolCallId === undefined ? {} : { toolCallId: input.toolCallId }),
      ...(input.planStepId === undefined ? {} : { planStepId: input.planStepId }),
      category: input.error.category,
      code: input.error.code,
      message: input.error.message,
      recoverability: input.error.recoverability,
      suggestedActions: [input.error.suggestedAction],
      ...(input.provider === undefined ? {} : { provider: input.provider }),
      ...(input.model === undefined ? {} : { model: input.model }),
      redactedDetail: { ...(input.error.redactedDetail ?? {}), ...(input.detail ?? {}) },
      recoveryState: input.recoveryState,
      retryTargets: input.retryTargets ?? [],
      createdAt: input.error.createdAt
    });
    if (!record.ok) return record;
    const written = isRunBinding(input)
      ? await options.repository.writeRunError(input.runId, asJsonObject(record.value))
      : await options.repository.writePreflightError(asJsonObject(record.value));
    return written.ok ? ok(record.value) : err(written.error);
  }

  async function read(
    result: Result<JsonObject | undefined, UnifiedError>,
    matchesBinding: (record: AgentRunErrorRecord) => boolean
  ): Promise<Result<AgentRunErrorRecord | undefined, UnifiedError>> {
    if (!result.ok) return err(result.error);
    if (result.value === undefined) return ok(undefined);
    const validated = validateAgentRunErrorRecord(result.value);
    return validated.ok && matchesBinding(validated.value)
      ? ok(validated.value)
      : err(recordInvalid());
  }

  return {
    recordRunError: persist,
    recordPreflightError: persist,
    async readRunError(runId, errorId) {
      return read(
        await options.repository.readRunError(runId, errorId),
        (record) => record.runId === runId && record.errorId === errorId
      );
    },
    async readPreflightError(errorId) {
      return read(
        await options.repository.readPreflightError(errorId),
        (record) => record.runDraftId !== undefined && record.errorId === errorId
      );
    }
  };
}

function isRunBinding(
  input: RecordAgentRunErrorInput | RecordAgentPreflightErrorInput
): input is RecordAgentRunErrorInput {
  return "runId" in input;
}

function asJsonObject(value: object): JsonObject {
  return value as JsonObject;
}

function recordInvalid(): UnifiedError {
  return createUnifiedError({
    code: "AGENT_RUN_ERROR_RECORD_INVALID",
    category: "AgentError",
    message: "The persisted Agent error record is invalid.",
    recoverability: "fatal",
    suggestedAction: "Refresh the Agent run or discard the invalid diagnostic record.",
    traceId: "agent-diagnostics-session"
  });
}
