import {
  recordPlanExecutionDeviation,
  summarizePlanExecution,
  transitionPlanExecutionStep,
  type DecidePlanRevisionCommand,
  type PlanDeviationChange,
  type PlanExecutionRecord,
  type PlanExecutionSummary,
  type TransitionPlanExecutionStepInput
} from "@novel-studio/agent-engine";
import {
  createUnifiedError,
  err,
  ok,
  type JsonObject,
  type Result,
  type UnifiedError
} from "@novel-studio/shared";

export interface AgentPlanExecutionRepositoryPort {
  writePlanExecutionRecord(record: JsonObject): Promise<Result<JsonObject, UnifiedError>>;
  readPlanExecutionRecord(
    runId: string,
    planExecutionId: string,
    revision?: number
  ): Promise<Result<JsonObject | undefined, UnifiedError>>;
  writePlanRevisionRequest(request: JsonObject): Promise<Result<JsonObject, UnifiedError>>;
  readPlanRevisionRequest(
    runId: string,
    requestId: string
  ): Promise<Result<JsonObject | undefined, UnifiedError>>;
  writePlanRevisionDecision?(decision: JsonObject): Promise<Result<JsonObject, UnifiedError>>;
  readPlanRevisionDecision?(
    runId: string,
    requestId: string
  ): Promise<Result<JsonObject | undefined, UnifiedError>>;
  writeCommandReceipt?(
    runId: string,
    commandId: string,
    receipt: JsonObject
  ): Promise<Result<JsonObject, UnifiedError>>;
  readCommandReceipt?(
    runId: string,
    commandId: string
  ): Promise<Result<JsonObject | undefined, UnifiedError>>;
}

export interface PlanRevisionRequest {
  readonly schemaVersion: "1.0";
  readonly requestId: string;
  readonly runId: string;
  readonly planExecutionId: string;
  readonly planId: string;
  readonly planRevision: number;
  readonly affectedStepIds: readonly string[];
  readonly discovery: string;
  readonly proposal: string;
  readonly createdAt: string;
}

export interface PlanExecutionEvent {
  readonly type:
    | "plan_step_started"
    | "plan_step_completed"
    | "plan_step_blocked"
    | "plan_step_skipped"
    | "plan_deviation_recorded"
    | "plan_revision_requested";
  readonly runId: string;
  readonly detail: JsonObject;
}

export interface StartPlanExecutionInput {
  readonly record: PlanExecutionRecord;
}

export interface ReadPlanExecutionInput {
  readonly runId: string;
  readonly planExecutionId: string;
  readonly revision?: number;
}

export type TransitionPlanExecutionInput = ReadPlanExecutionInput &
  TransitionPlanExecutionStepInput;

export interface RecordPlanDeviationInput extends ReadPlanExecutionInput {
  readonly stepId: string;
  readonly requestId: string;
  readonly planRevision?: number;
  readonly change: PlanDeviationChange;
  readonly summary: string;
  readonly discovery?: string;
  readonly proposal?: string;
  readonly eventSequence: number;
}

export interface RecordPlanDeviationResult {
  readonly state: "active" | "awaiting_plan_revision";
  readonly kind: "minor" | "material";
  readonly requiresPlanRevision: boolean;
  readonly record: PlanExecutionRecord;
  readonly request?: PlanRevisionRequest;
}

export interface DecidePlanExecutionRevisionCommand extends DecidePlanRevisionCommand {
  readonly planExecutionId: string;
  readonly expectedPlanExecutionRevision?: number;
}

export interface PlanRevisionDecisionReceipt {
  readonly commandId: string;
  readonly requestId: string;
  readonly decision: "approve" | "reject";
  readonly state: "active" | "stopped";
  readonly record: PlanExecutionRecord;
}

export interface PlanRevisionDecisionRecord {
  readonly schemaVersion: "1.0";
  readonly requestId: string;
  readonly runId: string;
  readonly planExecutionId: string;
  readonly planId: string;
  readonly planRevision: number;
  readonly commandId: string;
  readonly decision: "approve" | "reject";
  readonly planExecutionRevision: number;
  readonly decidedAt: string;
}

export interface AgentPlanExecutionSession {
  startPlanExecution(
    input: StartPlanExecutionInput
  ): Promise<Result<PlanExecutionRecord, UnifiedError>>;
  readPlanExecution(
    input: ReadPlanExecutionInput
  ): Promise<Result<PlanExecutionRecord | undefined, UnifiedError>>;
  transitionStep(
    input: TransitionPlanExecutionInput
  ): Promise<Result<PlanExecutionRecord, UnifiedError>>;
  recordDeviation(
    input: RecordPlanDeviationInput
  ): Promise<Result<RecordPlanDeviationResult, UnifiedError>>;
  decidePlanRevision(
    command: DecidePlanExecutionRevisionCommand
  ): Promise<Result<PlanRevisionDecisionReceipt, UnifiedError>>;
  summarize(input: ReadPlanExecutionInput): Promise<Result<PlanExecutionSummary, UnifiedError>>;
}

export interface CreateAgentPlanExecutionSessionOptions {
  readonly repository: AgentPlanExecutionRepositoryPort;
  readonly now?: () => string;
  readonly onEvent?: (event: PlanExecutionEvent) => Promise<void> | void;
}

export function createAgentPlanExecutionSession(
  options: CreateAgentPlanExecutionSessionOptions
): AgentPlanExecutionSession {
  const now = options.now ?? (() => new Date().toISOString());
  const localDecisions = new Map<string, JsonObject>();

  async function read(
    input: ReadPlanExecutionInput
  ): Promise<Result<PlanExecutionRecord | undefined, UnifiedError>> {
    const result = await options.repository.readPlanExecutionRecord(
      input.runId,
      input.planExecutionId,
      input.revision
    );
    if (!result.ok || result.value === undefined) return result as Result<undefined, UnifiedError>;
    return isPlanExecutionRecord(result.value)
      ? ok(result.value as unknown as PlanExecutionRecord)
      : err(planExecutionSessionError("AGENT_PLAN_EXECUTION_RECORD_INVALID"));
  }

  async function current(
    input: ReadPlanExecutionInput
  ): Promise<Result<PlanExecutionRecord, UnifiedError>> {
    const result = await read({ runId: input.runId, planExecutionId: input.planExecutionId });
    return !result.ok
      ? result
      : result.value === undefined
        ? err(planExecutionSessionError("AGENT_PLAN_EXECUTION_NOT_FOUND"))
        : ok(result.value);
  }

  async function write(
    record: PlanExecutionRecord
  ): Promise<Result<PlanExecutionRecord, UnifiedError>> {
    const written = await options.repository.writePlanExecutionRecord(asJsonObject(record));
    return written.ok ? ok(record) : err(written.error);
  }

  async function emit(event: PlanExecutionEvent): Promise<void> {
    await options.onEvent?.(event);
  }

  return {
    async startPlanExecution(input) {
      return write(input.record);
    },

    readPlanExecution: read,

    async transitionStep(input) {
      const loaded = await current(input);
      if (!loaded.ok) return loaded;
      const transitioned = transitionPlanExecutionStep(loaded.value, input);
      if (!transitioned.ok) return transitioned;
      const written = await write(transitioned.value);
      if (!written.ok) return written;
      const step = written.value.steps.find((candidate) => candidate.stepId === input.stepId)!;
      await emit({
        type: transitionEventType(input.status),
        runId: input.runId,
        detail: {
          planExecutionId: input.planExecutionId,
          stepId: input.stepId,
          ...(step.checkpointId === null ? {} : { checkpointId: step.checkpointId }),
          ...(step.verification.length === 0 ? {} : { verification: [...step.verification] }),
          ...(step.blockedReason === null ? {} : { reason: step.blockedReason })
        }
      });
      return written;
    },

    async recordDeviation(input) {
      const loaded = await current(input);
      if (!loaded.ok) return loaded;
      const recorded = recordPlanExecutionDeviation(loaded.value, input);
      if (!recorded.ok) return recorded;
      const written = await write(recorded.value.record);
      if (!written.ok) return written;
      await emit({
        type: "plan_deviation_recorded",
        runId: input.runId,
        detail: {
          planExecutionId: input.planExecutionId,
          stepId: input.stepId,
          kind: recorded.value.kind,
          summary: input.summary
        }
      });
      if (!recorded.value.requiresPlanRevision) {
        return ok({
          state: "active",
          kind: recorded.value.kind,
          requiresPlanRevision: false,
          record: written.value
        });
      }
      if (
        input.planRevision === undefined ||
        input.planRevision <= loaded.value.planRevision ||
        !isNonEmpty(input.discovery) ||
        !isNonEmpty(input.proposal)
      ) {
        return err(planExecutionSessionError("AGENT_PLAN_REVISION_REQUEST_INVALID"));
      }
      const request: PlanRevisionRequest = Object.freeze({
        schemaVersion: "1.0",
        requestId: input.requestId,
        runId: input.runId,
        planExecutionId: input.planExecutionId,
        planId: loaded.value.planId,
        planRevision: input.planRevision,
        affectedStepIds: Object.freeze([input.stepId]),
        discovery: input.discovery!,
        proposal: input.proposal!,
        createdAt: now()
      });
      const requestWritten = await options.repository.writePlanRevisionRequest(
        asJsonObject(request)
      );
      if (!requestWritten.ok) return err(requestWritten.error);
      await emit({
        type: "plan_revision_requested",
        runId: input.runId,
        detail: {
          requestId: request.requestId,
          planExecutionId: request.planExecutionId,
          planId: request.planId,
          planRevision: request.planRevision,
          affectedStepIds: [...request.affectedStepIds],
          discovery: request.discovery,
          proposal: request.proposal
        }
      });
      return ok({
        state: "awaiting_plan_revision",
        kind: recorded.value.kind,
        requiresPlanRevision: true,
        record: written.value,
        request
      });
    },

    async decidePlanRevision(command) {
      const prior = await readReceipt(options.repository, command.runId, command.commandId);
      if (prior !== undefined) return prior;
      const existingDecision =
        options.repository.readPlanRevisionDecision === undefined
          ? localDecisions.get(`${command.runId}:${command.requestId}`)
          : await options.repository.readPlanRevisionDecision(command.runId, command.requestId);
      if (
        typeof existingDecision === "object" &&
        existingDecision !== null &&
        "ok" in existingDecision &&
        existingDecision.ok === false
      ) {
        return err(existingDecision.error as UnifiedError);
      }
      const decisionValue =
        typeof existingDecision === "object" &&
        existingDecision !== null &&
        "ok" in existingDecision
          ? existingDecision.value
          : existingDecision;
      if (decisionValue !== undefined) {
        return err(planExecutionSessionError("AGENT_PLAN_REVISION_ALREADY_DECIDED"));
      }
      const loaded = await current(command);
      if (!loaded.ok) return loaded;
      if (
        loaded.value.revision !==
        (command.expectedPlanExecutionRevision ?? command.expectedRunRevision)
      ) {
        return err(planExecutionSessionError("AGENT_PLAN_EXECUTION_REVISION_CONFLICT"));
      }
      const requested = await options.repository.readPlanRevisionRequest(
        command.runId,
        command.requestId
      );
      if (!requested.ok) return err(requested.error);
      if (
        requested.value === undefined ||
        requested.value["planExecutionId"] !== command.planExecutionId ||
        requested.value["planId"] !== command.planId ||
        requested.value["planRevision"] !== command.planRevision
      ) {
        return err(planExecutionSessionError("AGENT_PLAN_REVISION_REQUEST_CONFLICT"));
      }
      let record = loaded.value;
      if (command.decision === "approve") {
        record = Object.freeze({
          ...loaded.value,
          planRevision: command.planRevision,
          revision: loaded.value.revision + 1
        });
        const written = await write(record);
        if (!written.ok) return written;
        record = written.value;
      }
      const receipt = ok<PlanRevisionDecisionReceipt>({
        commandId: command.commandId,
        requestId: command.requestId,
        decision: command.decision,
        state: command.decision === "approve" ? "active" : "stopped",
        record
      });
      const decisionRecord: PlanRevisionDecisionRecord = Object.freeze({
        schemaVersion: "1.0",
        requestId: command.requestId,
        runId: command.runId,
        planExecutionId: command.planExecutionId,
        planId: command.planId,
        planRevision: command.planRevision,
        commandId: command.commandId,
        decision: command.decision,
        planExecutionRevision: record.revision,
        decidedAt: now()
      });
      if (options.repository.writePlanRevisionDecision === undefined) {
        localDecisions.set(`${command.runId}:${command.requestId}`, asJsonObject(decisionRecord));
      } else {
        const decisionWritten = await options.repository.writePlanRevisionDecision(
          asJsonObject(decisionRecord)
        );
        if (!decisionWritten.ok) return err(decisionWritten.error);
      }
      return persistReceipt(options.repository, command.runId, command.commandId, receipt);
    },

    async summarize(input) {
      const loaded = await current(input);
      return loaded.ok ? ok(summarizePlanExecution(loaded.value)) : loaded;
    }
  };
}

function transitionEventType(
  status: TransitionPlanExecutionStepInput["status"]
): PlanExecutionEvent["type"] {
  switch (status) {
    case "running":
      return "plan_step_started";
    case "completed":
      return "plan_step_completed";
    case "blocked":
      return "plan_step_blocked";
    case "skipped":
      return "plan_step_skipped";
  }
}

async function readReceipt(
  repository: AgentPlanExecutionRepositoryPort,
  runId: string,
  commandId: string
): Promise<Result<PlanRevisionDecisionReceipt, UnifiedError> | undefined> {
  if (repository.readCommandReceipt === undefined) return undefined;
  const persisted = await repository.readCommandReceipt(runId, commandId);
  if (!persisted.ok || persisted.value === undefined) return undefined;
  return persisted.value as unknown as Result<PlanRevisionDecisionReceipt, UnifiedError>;
}

async function persistReceipt(
  repository: AgentPlanExecutionRepositoryPort,
  runId: string,
  commandId: string,
  receipt: Result<PlanRevisionDecisionReceipt, UnifiedError>
): Promise<Result<PlanRevisionDecisionReceipt, UnifiedError>> {
  if (repository.writeCommandReceipt === undefined) return receipt;
  const persisted = await repository.writeCommandReceipt(runId, commandId, asJsonObject(receipt));
  return persisted.ok ? receipt : err(persisted.error);
}

function isPlanExecutionRecord(value: JsonObject): boolean {
  return (
    value["schemaVersion"] === "1.0" &&
    typeof value["planExecutionId"] === "string" &&
    typeof value["runId"] === "string" &&
    typeof value["planId"] === "string" &&
    typeof value["planRevision"] === "number" &&
    typeof value["revision"] === "number" &&
    Array.isArray(value["steps"])
  );
}

function isNonEmpty(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

function asJsonObject(value: object): JsonObject {
  return value as unknown as JsonObject;
}

function planExecutionSessionError(code: string): UnifiedError {
  return createUnifiedError({
    code,
    category: "AgentError",
    message: "The plan execution command could not be applied.",
    recoverability: "user-action",
    suggestedAction: "Reload the current execution record and retry the command.",
    traceId: "agent-plan-execution-session"
  });
}
