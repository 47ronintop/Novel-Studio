import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import type { AgentContextMode, AgentWritePolicy } from "./agent-run-types.js";
import type { PlanArtifact } from "./plan-artifact.js";

export type PlanExecutionStepStatus = "pending" | "running" | "completed" | "blocked" | "skipped";
export type PlanExecutionDeviationKind = "none" | "minor" | "material";

export type PlanDeviationChange =
  | "related_source_read"
  | "read_order_changed"
  | "read_retry"
  | "new_target"
  | "success_criteria_changed"
  | "non_goal_changed"
  | "write_policy_changed"
  | "scope_expanded"
  | "verification_skipped"
  | "plan_basis_invalid";

export interface PlanExecutionStep {
  readonly stepId: string;
  readonly title: string;
  readonly status: PlanExecutionStepStatus;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly verification: readonly string[];
  readonly deviationKind: PlanExecutionDeviationKind;
  readonly blockedReason: string | null;
  readonly checkpointId: string | null;
  readonly eventSequence: number | null;
}

export interface PlanExecutionRecord {
  readonly schemaVersion: "1.0";
  readonly planExecutionId: string;
  readonly runId: string;
  readonly planId: string;
  readonly planRevision: number;
  readonly handoffContextMode: AgentContextMode;
  readonly handoffWritePolicy: AgentWritePolicy;
  readonly revision: number;
  readonly steps: readonly PlanExecutionStep[];
}

export interface CreatePlanExecutionRecordInput {
  readonly planExecutionId: string;
  readonly runId: string;
  readonly plan: Pick<PlanArtifact, "planId" | "revision" | "steps">;
  readonly handoffContextMode: AgentContextMode;
  readonly handoffWritePolicy: AgentWritePolicy;
}

export type TransitionPlanExecutionStepInput =
  | {
      readonly stepId: string;
      readonly status: "running";
      readonly at: string;
      readonly checkpointId: string;
      readonly eventSequence: number;
    }
  | {
      readonly stepId: string;
      readonly status: "completed";
      readonly at: string;
      readonly verification: readonly string[];
      readonly eventSequence: number;
    }
  | {
      readonly stepId: string;
      readonly status: "blocked" | "skipped";
      readonly at: string;
      readonly blockedReason: string;
      readonly eventSequence: number;
    };

export interface ClassifyPlanDeviationInput {
  readonly change: PlanDeviationChange;
}

export interface RecordPlanExecutionDeviationInput extends ClassifyPlanDeviationInput {
  readonly stepId: string;
  readonly summary: string;
  readonly eventSequence: number;
}

export interface PlanExecutionDeviationResult {
  readonly record: PlanExecutionRecord;
  readonly kind: Exclude<PlanExecutionDeviationKind, "none">;
  readonly requiresPlanRevision: boolean;
}

export interface PlanExecutionSummary {
  readonly status: "active" | "completed" | "blocked";
  readonly completedAsPlannedStepIds: readonly string[];
  readonly minorDeviationStepIds: readonly string[];
  readonly materialDeviationStepIds: readonly string[];
  readonly blockedStepIds: readonly string[];
  readonly skippedStepIds: readonly string[];
  readonly verification: readonly {
    readonly stepId: string;
    readonly evidence: readonly string[];
  }[];
}

export function createPlanExecutionRecord(
  input: CreatePlanExecutionRecordInput
): PlanExecutionRecord {
  return deepFreeze({
    schemaVersion: "1.0",
    planExecutionId: input.planExecutionId,
    runId: input.runId,
    planId: input.plan.planId,
    planRevision: input.plan.revision,
    handoffContextMode: input.handoffContextMode,
    handoffWritePolicy: input.handoffWritePolicy,
    revision: 1,
    steps: input.plan.steps.map((step) => ({
      stepId: step.stepId,
      title: step.title,
      status: "pending" as const,
      startedAt: null,
      completedAt: null,
      verification: [],
      deviationKind: "none" as const,
      blockedReason: null,
      checkpointId: null,
      eventSequence: null
    }))
  });
}

export function transitionPlanExecutionStep(
  record: PlanExecutionRecord,
  input: TransitionPlanExecutionStepInput
): Result<PlanExecutionRecord, UnifiedError> {
  const stepIndex = record.steps.findIndex((step) => step.stepId === input.stepId);
  if (stepIndex < 0) return err(planExecutionError("AGENT_PLAN_STEP_NOT_FOUND", "stepId"));
  const current = record.steps[stepIndex];
  if (current === undefined) {
    return err(planExecutionError("AGENT_PLAN_STEP_NOT_FOUND", "stepId"));
  }
  const legal =
    (current.status === "pending" && input.status === "running") ||
    (current.status === "running" && input.status !== "running");
  if (!legal) {
    return err(planExecutionError("AGENT_PLAN_STEP_TRANSITION_INVALID", "status"));
  }
  if (!isNonEmpty(input.at) || !isEventSequence(input.eventSequence)) {
    return err(planExecutionError("AGENT_PLAN_STEP_TRANSITION_INVALID", "event"));
  }
  if (input.status === "running" && !isNonEmpty(input.checkpointId)) {
    return err(planExecutionError("AGENT_PLAN_STEP_TRANSITION_INVALID", "checkpointId"));
  }
  if (
    input.status === "completed" &&
    (input.verification.length === 0 || !input.verification.every(isNonEmpty))
  ) {
    return err(planExecutionError("AGENT_PLAN_STEP_VERIFICATION_REQUIRED", "verification"));
  }
  if (
    (input.status === "blocked" || input.status === "skipped") &&
    !isNonEmpty(input.blockedReason)
  ) {
    return err(planExecutionError("AGENT_PLAN_STEP_REASON_REQUIRED", "blockedReason"));
  }

  const nextStep: PlanExecutionStep =
    input.status === "running"
      ? {
          ...current,
          status: input.status,
          startedAt: input.at,
          checkpointId: input.checkpointId,
          eventSequence: input.eventSequence
        }
      : input.status === "completed"
        ? {
            ...current,
            status: input.status,
            completedAt: input.at,
            verification: [...input.verification],
            eventSequence: input.eventSequence
          }
        : {
            ...current,
            status: input.status,
            completedAt: input.at,
            blockedReason: input.blockedReason,
            eventSequence: input.eventSequence
          };

  return ok(nextRecord(record, stepIndex, nextStep));
}

export function classifyPlanDeviation(
  input: ClassifyPlanDeviationInput
): Exclude<PlanExecutionDeviationKind, "none"> {
  switch (input.change) {
    case "related_source_read":
    case "read_order_changed":
    case "read_retry":
      return "minor";
    default:
      return "material";
  }
}

export function recordPlanExecutionDeviation(
  record: PlanExecutionRecord,
  input: RecordPlanExecutionDeviationInput
): Result<PlanExecutionDeviationResult, UnifiedError> {
  const stepIndex = record.steps.findIndex((step) => step.stepId === input.stepId);
  if (stepIndex < 0) return err(planExecutionError("AGENT_PLAN_STEP_NOT_FOUND", "stepId"));
  if (!isNonEmpty(input.summary) || !isEventSequence(input.eventSequence)) {
    return err(planExecutionError("AGENT_PLAN_DEVIATION_INVALID", "deviation"));
  }
  const kind = classifyPlanDeviation(input);
  const current = record.steps[stepIndex];
  if (current === undefined) {
    return err(planExecutionError("AGENT_PLAN_STEP_NOT_FOUND", "stepId"));
  }
  const deviationKind =
    current.deviationKind === "material" || kind === "material" ? "material" : "minor";
  const next = nextRecord(record, stepIndex, {
    ...current,
    deviationKind,
    eventSequence: input.eventSequence
  });
  return ok({ record: next, kind, requiresPlanRevision: kind === "material" });
}

export function summarizePlanExecution(record: PlanExecutionRecord): PlanExecutionSummary {
  const active = record.steps.some(
    (step) => step.status === "pending" || step.status === "running"
  );
  const blocked = record.steps.some(
    (step) => step.status === "blocked" || step.deviationKind === "material"
  );
  return deepFreeze({
    status: active ? "active" : blocked ? "blocked" : "completed",
    completedAsPlannedStepIds: record.steps
      .filter((step) => step.status === "completed" && step.deviationKind === "none")
      .map((step) => step.stepId),
    minorDeviationStepIds: record.steps
      .filter((step) => step.deviationKind === "minor")
      .map((step) => step.stepId),
    materialDeviationStepIds: record.steps
      .filter((step) => step.deviationKind === "material")
      .map((step) => step.stepId),
    blockedStepIds: record.steps
      .filter((step) => step.status === "blocked")
      .map((step) => step.stepId),
    skippedStepIds: record.steps
      .filter((step) => step.status === "skipped")
      .map((step) => step.stepId),
    verification: record.steps
      .filter((step) => step.verification.length > 0)
      .map((step) => ({ stepId: step.stepId, evidence: [...step.verification] }))
  });
}

function nextRecord(
  record: PlanExecutionRecord,
  stepIndex: number,
  step: PlanExecutionStep
): PlanExecutionRecord {
  return deepFreeze({
    ...record,
    revision: record.revision + 1,
    steps: record.steps.map((current, index) => (index === stepIndex ? step : current))
  });
}

function planExecutionError(code: string, field: string): UnifiedError {
  return createUnifiedError({
    code,
    category: "AgentError",
    message: "The plan execution transition is invalid.",
    recoverability: "user-action",
    suggestedAction: "Reload the current plan execution record and retry a valid transition.",
    traceId: "plan-execution",
    redactedDetail: { field }
  });
}

function isNonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

function isEventSequence(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
