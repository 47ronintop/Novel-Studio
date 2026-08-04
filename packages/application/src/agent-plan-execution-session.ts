import {
  parsePlanExecutionRecordV20,
  recordPlanExecutionDeviation,
  summarizePlanExecution,
  transitionPlanExecutionStep,
  type DecidePlanRevisionCommand,
  type PlanDeviationChange,
  type PlanExecutionRecord,
  type PlanExecutionRecordV20,
  type PlanExecutionSummary,
  type PlanActHandoffV20,
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
  /** New execution records carry a strict, Main-owned Act handoff; legacy records remain readable. */
  readonly record: PlanExecutionRecord | PlanExecutionRecordV20;
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
  readonly record: PersistedPlanExecutionRecord;
  readonly request?: PlanRevisionRequest;
}

export interface DecidePlanExecutionRevisionCommand extends DecidePlanRevisionCommand {
  readonly planExecutionId: string;
  readonly expectedPlanExecutionRevision?: number;
  /** A fresh, Main-owned Act handoff is required whenever the approved plan revision changes. */
  readonly handoff?: PlanActHandoffV20;
}

export interface PlanRevisionDecisionReceipt {
  readonly commandId: string;
  readonly requestId: string;
  readonly decision: "approve" | "reject";
  readonly state: "active" | "stopped";
  readonly record: PersistedPlanExecutionRecord;
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
  ): Promise<Result<PlanExecutionRecord | PlanExecutionRecordV20, UnifiedError>>;
  readPlanExecution(
    input: ReadPlanExecutionInput
  ): Promise<Result<PersistedPlanExecutionRecord | undefined, UnifiedError>>;
  transitionStep(
    input: TransitionPlanExecutionInput
  ): Promise<Result<PersistedPlanExecutionRecord, UnifiedError>>;
  recordDeviation(
    input: RecordPlanDeviationInput
  ): Promise<Result<RecordPlanDeviationResult, UnifiedError>>;
  decidePlanRevision(
    command: DecidePlanExecutionRevisionCommand
  ): Promise<Result<PlanRevisionDecisionReceipt, UnifiedError>>;
  summarize(input: ReadPlanExecutionInput): Promise<Result<PlanExecutionSummary, UnifiedError>>;
}

type PersistedPlanExecutionRecord = PlanExecutionRecord | PlanExecutionRecordV20;

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
  ): Promise<Result<PersistedPlanExecutionRecord | undefined, UnifiedError>> {
    const result = await options.repository.readPlanExecutionRecord(
      input.runId,
      input.planExecutionId,
      input.revision
    );
    if (!result.ok || result.value === undefined) return result as Result<undefined, UnifiedError>;
    const record = readPersistedPlanExecutionRecord(result.value);
    if (record === undefined) {
      return err(planExecutionSessionError("AGENT_PLAN_EXECUTION_RECORD_INVALID"));
    }
    if (record.runId !== input.runId || record.planExecutionId !== input.planExecutionId) {
      return err(planExecutionSessionError("AGENT_PLAN_EXECUTION_RECORD_IDENTITY_MISMATCH"));
    }
    return ok(record);
  }

  async function current(
    input: ReadPlanExecutionInput
  ): Promise<Result<PersistedPlanExecutionRecord, UnifiedError>> {
    const result = await read({ runId: input.runId, planExecutionId: input.planExecutionId });
    return !result.ok
      ? result
      : result.value === undefined
        ? err(planExecutionSessionError("AGENT_PLAN_EXECUTION_NOT_FOUND"))
        : ok(result.value);
  }

  async function write(
    record: PersistedPlanExecutionRecord
  ): Promise<Result<PersistedPlanExecutionRecord, UnifiedError>> {
    if (record.schemaVersion === "2.0") {
      try {
        parsePlanExecutionRecordV20(record);
      } catch {
        return err(planExecutionSessionError("AGENT_PLAN_EXECUTION_V20_INVALID"));
      }
    }
    const written = await options.repository.writePlanExecutionRecord(asJsonObject(record));
    return written.ok ? ok(record) : err(written.error);
  }

  async function emit(event: PlanExecutionEvent): Promise<void> {
    await options.onEvent?.(event);
  }

  return {
    async startPlanExecution(input) {
      try {
        const record =
          input.record.schemaVersion === "2.0"
            ? parsePlanExecutionRecordV20(input.record)
            : readPersistedPlanExecutionRecord(asJsonObject(input.record));
        if (record === undefined) {
          return err(planExecutionSessionError("AGENT_PLAN_EXECUTION_RECORD_INVALID"));
        }
        return write(record);
      } catch {
        return err(
          planExecutionSessionError(
            input.record.schemaVersion === "2.0"
              ? "AGENT_PLAN_EXECUTION_V20_INVALID"
              : "AGENT_PLAN_EXECUTION_RECORD_INVALID"
          )
        );
      }
    },

    readPlanExecution: read,

    async transitionStep(input) {
      const loaded = await current(input);
      if (!loaded.ok) return loaded;
      const transitioned = transitionPlanExecutionStep(
        loaded.value as unknown as PlanExecutionRecord,
        input
      );
      if (!transitioned.ok) return transitioned;
      const next =
        loaded.value.schemaVersion === "2.0"
          ? parseV20ExecutionRecord(transitioned.value)
          : ok(transitioned.value as PersistedPlanExecutionRecord);
      if (!next.ok) return next;
      const written = await write(next.value);
      if (!written.ok) return written;
      const step = written.value.steps.find((candidate) => candidate.stepId === input.stepId);
      if (step === undefined) {
        return err(planExecutionSessionError("AGENT_PLAN_STEP_NOT_FOUND"));
      }
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
      const recorded = recordPlanExecutionDeviation(
        loaded.value as unknown as PlanExecutionRecord,
        input
      );
      if (!recorded.ok) return recorded;
      const next =
        loaded.value.schemaVersion === "2.0"
          ? parseV20ExecutionRecord(recorded.value.record)
          : ok(recorded.value.record as PersistedPlanExecutionRecord);
      if (!next.ok) return next;
      const written = await write(next.value);
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
      const discovery = input.discovery;
      const proposal = input.proposal;
      if (
        input.planRevision === undefined ||
        input.planRevision <= loaded.value.planRevision ||
        !isNonEmpty(discovery) ||
        !isNonEmpty(proposal)
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
        discovery,
        proposal,
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
      let record: PersistedPlanExecutionRecord = loaded.value;
      if (command.decision === "approve") {
        if (record.schemaVersion === "2.0" && command.handoff === undefined) {
          return err(
            planExecutionSessionError("AGENT_PLAN_EXECUTION_HANDOFF_RECONFIRMATION_REQUIRED")
          );
        }
        if (record.schemaVersion === "2.0") {
          const revised = parseV20ExecutionRecord({
            ...record,
            planRevision: command.planRevision,
            handoffContextMode: command.handoff?.executionContextMode,
            handoffWritePolicy: command.handoff?.executionWritePolicy,
            executionWritePolicyAcknowledged: command.handoff?.executionWritePolicyAcknowledged,
            providerSemanticVersionSetChecksum: command.handoff?.providerSemanticVersionSetChecksum,
            handoff: command.handoff,
            revision: record.revision + 1
          });
          if (!revised.ok) return revised;
          record = revised.value;
        } else {
          record = deepFreeze({
            ...record,
            planRevision: command.planRevision,
            handoffWritePolicy: "write_before_confirmation" as const,
            revision: record.revision + 1
          });
        }
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
      return loaded.ok
        ? ok(summarizePlanExecution(loaded.value as unknown as PlanExecutionRecord))
        : loaded;
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

function readPersistedPlanExecutionRecord(
  value: JsonObject
): PersistedPlanExecutionRecord | undefined {
  if (value["schemaVersion"] === "2.0") {
    try {
      return parsePlanExecutionRecordV20(value);
    } catch {
      return undefined;
    }
  }
  return isLegacyPlanExecutionRecord(value) ? normalizeLegacyPlanExecutionRecord(value) : undefined;
}

/** Legacy execution records are hydrated for display only and cannot inherit old preapproval. */
function normalizeLegacyPlanExecutionRecord(value: JsonObject): PlanExecutionRecord {
  return deepFreeze({
    schemaVersion: "1.0" as const,
    planExecutionId: value["planExecutionId"] as string,
    runId: value["runId"] as string,
    planId: value["planId"] as string,
    planRevision: value["planRevision"] as number,
    handoffContextMode: value["handoffContextMode"] as "writing" | "general_file",
    handoffWritePolicy: "write_before_confirmation" as const,
    revision: value["revision"] as number,
    steps: (value["steps"] as JsonObject[]).map((step) => ({
      stepId: step["stepId"] as string,
      title: step["title"] as string,
      status: step["status"] as PlanExecutionRecord["steps"][number]["status"],
      startedAt: step["startedAt"] as string | null,
      completedAt: step["completedAt"] as string | null,
      verification: [...(step["verification"] as string[])],
      deviationKind: step["deviationKind"] as PlanExecutionRecord["steps"][number]["deviationKind"],
      blockedReason: step["blockedReason"] as string | null,
      checkpointId: step["checkpointId"] as string | null,
      eventSequence: step["eventSequence"] as number | null
    }))
  });
}

function parseV20ExecutionRecord(value: unknown): Result<PlanExecutionRecordV20, UnifiedError> {
  try {
    return ok(parsePlanExecutionRecordV20(value));
  } catch {
    return err(planExecutionSessionError("AGENT_PLAN_EXECUTION_V20_INVALID"));
  }
}

function isLegacyPlanExecutionRecord(value: JsonObject): boolean {
  const required = [
    "schemaVersion",
    "planExecutionId",
    "runId",
    "planId",
    "planRevision",
    "handoffContextMode",
    "handoffWritePolicy",
    "revision",
    "steps"
  ];
  return (
    Object.keys(value).length === required.length &&
    required.every((key) => key in value) &&
    value["schemaVersion"] === "1.0" &&
    isNonEmpty(value["planExecutionId"] as string | undefined) &&
    isNonEmpty(value["runId"] as string | undefined) &&
    isNonEmpty(value["planId"] as string | undefined) &&
    isSafePositiveInteger(value["planRevision"]) &&
    (value["handoffContextMode"] === "writing" || value["handoffContextMode"] === "general_file") &&
    (value["handoffWritePolicy"] === "write_before_confirmation" ||
      value["handoffWritePolicy"] === "user_preapproved_run") &&
    isSafePositiveInteger(value["revision"]) &&
    Array.isArray(value["steps"]) &&
    value["steps"].every(isLegacyPlanExecutionStep)
  );
}

function isSafePositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function isLegacyPlanExecutionStep(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const required = [
    "stepId",
    "title",
    "status",
    "startedAt",
    "completedAt",
    "verification",
    "deviationKind",
    "blockedReason",
    "checkpointId",
    "eventSequence"
  ];
  return (
    Object.keys(value).length === required.length &&
    required.every((key) => key in value) &&
    isNonEmpty(value["stepId"] as string | undefined) &&
    isNonEmpty(value["title"] as string | undefined) &&
    (value["status"] === "pending" ||
      value["status"] === "running" ||
      value["status"] === "completed" ||
      value["status"] === "blocked" ||
      value["status"] === "skipped") &&
    (value["startedAt"] === null || isNonEmpty(value["startedAt"] as string | undefined)) &&
    (value["completedAt"] === null || isNonEmpty(value["completedAt"] as string | undefined)) &&
    Array.isArray(value["verification"]) &&
    value["verification"].every((entry) => isNonEmpty(entry as string | undefined)) &&
    (value["deviationKind"] === "none" ||
      value["deviationKind"] === "minor" ||
      value["deviationKind"] === "material") &&
    (value["blockedReason"] === null || isNonEmpty(value["blockedReason"] as string | undefined)) &&
    (value["checkpointId"] === null || isNonEmpty(value["checkpointId"] as string | undefined)) &&
    (value["eventSequence"] === null ||
      (typeof value["eventSequence"] === "number" &&
        Number.isSafeInteger(value["eventSequence"]) &&
        value["eventSequence"] >= 0))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmpty(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

function asJsonObject(value: object): JsonObject {
  return value as unknown as JsonObject;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
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
