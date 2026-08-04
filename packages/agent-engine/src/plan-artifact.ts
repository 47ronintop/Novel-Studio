import type { AgentContextMode, AgentOperationMode, AgentWritePolicy } from "./agent-run-types.js";
import {
  parseExecutionWritePolicyDraft,
  validateExecutionWritePolicyDraft,
  type ExecutionWritePolicyDraft
} from "./agent-run-draft.js";
import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

export interface PlanOpenQuestion {
  readonly questionId: string;
  readonly prompt: string;
  readonly blocking: boolean;
  readonly resolution?: string;
  readonly resolvedBy?: "user" | "system";
}

export interface PlanTargetRef {
  readonly refId: string;
  readonly intent: string;
}

export interface PlanStep {
  readonly stepId: string;
  readonly title: string;
  readonly verification: string;
}

export interface PlanArtifact {
  readonly schemaVersion: "1.0";
  readonly planId: string;
  readonly revision: number;
  readonly sourceRunId: string;
  readonly status: "ready" | "approved" | "executing" | "completed" | "rejected" | "superseded";
  readonly operationMode: AgentOperationMode;
  readonly contextMode: AgentContextMode;
  readonly goal: string;
  readonly successCriteria: readonly string[];
  readonly nonGoals: readonly string[];
  readonly facts: readonly string[];
  readonly assumptions: readonly string[];
  readonly openQuestions: readonly PlanOpenQuestion[];
  readonly targetRefs: readonly PlanTargetRef[];
  readonly steps: readonly PlanStep[];
  readonly risks: readonly string[];
  readonly verification: readonly string[];
  readonly sourceRefs: readonly string[];
  readonly createdAt: string;
}

export const PLAN_ARTIFACT_SCHEMA_VERSION_V20 = "2.0" as const;

/**
 * Strict planning artifact used by Guidance 3.0. The policy is a future Act choice only; it never
 * changes `operationMode` or grants planning mutation capability.
 */
export interface PlanArtifactV20 extends Omit<PlanArtifact, "schemaVersion"> {
  readonly schemaVersion: typeof PLAN_ARTIFACT_SCHEMA_VERSION_V20;
  readonly executionWritePolicyDraft: ExecutionWritePolicyDraft;
}

export type CreatePlanArtifactV20Input = Omit<
  PlanArtifactV20,
  "schemaVersion" | "revision" | "status"
>;

/** Main-owned facts that must be re-confirmed at the Plan-to-Act boundary. */
export interface PlanActHandoffV20 {
  readonly schemaVersion: typeof PLAN_ARTIFACT_SCHEMA_VERSION_V20;
  readonly handoffId: string;
  readonly planId: string;
  readonly planRevision: number;
  readonly executionContextMode: Exclude<AgentContextMode, "standalone_chat">;
  readonly executionWritePolicy: AgentWritePolicy;
  readonly executionWritePolicyAcknowledged: boolean;
  readonly providerSemanticVersionSetChecksum: string;
  readonly capabilityRevision?: string;
  readonly policyRevision?: string;
}

export type CreatePlanActHandoffV20Input = Omit<
  PlanActHandoffV20,
  "schemaVersion" | "executionWritePolicyAcknowledged"
> & {
  readonly executionWritePolicyAcknowledged?: boolean;
};

export type CreatePlanArtifactInput = Omit<PlanArtifact, "schemaVersion" | "revision" | "status">;

export interface RevisePlanArtifactInput {
  readonly resolvedQuestions: readonly {
    readonly questionId: string;
    readonly resolution: string;
    readonly resolvedBy: "user" | "system";
  }[];
  readonly createdAt: string;
}

export function createPlanArtifactRevision(input: CreatePlanArtifactInput): PlanArtifact {
  return deepFreeze({
    schemaVersion: "1.0",
    ...input,
    revision: 1,
    status: "ready"
  });
}

export function createPlanArtifactRevisionV20(input: CreatePlanArtifactV20Input): PlanArtifactV20 {
  if (input.operationMode !== "planning") {
    throw new Error("AGENT_PLAN_ARTIFACT_OPERATION_MODE_INVALID");
  }
  return deepFreeze({
    schemaVersion: PLAN_ARTIFACT_SCHEMA_VERSION_V20,
    ...input,
    executionWritePolicyDraft: parseExecutionWritePolicyDraft(input.executionWritePolicyDraft),
    revision: 1,
    status: "ready"
  });
}

export function parsePlanArtifactV20(value: unknown): PlanArtifactV20 {
  const validation = validatePlanArtifactV20(value);
  if (!validation.ok) throw new Error(validation.error.code);
  return validation.value;
}

export function validatePlanArtifactV20(value: unknown): Result<PlanArtifactV20, UnifiedError> {
  if (!isRecord(value)) return invalidPlanArtifactV20("AGENT_PLAN_ARTIFACT_V20_INVALID");
  const required = [
    "schemaVersion",
    "planId",
    "revision",
    "sourceRunId",
    "status",
    "operationMode",
    "contextMode",
    "goal",
    "successCriteria",
    "nonGoals",
    "facts",
    "assumptions",
    "openQuestions",
    "targetRefs",
    "steps",
    "risks",
    "verification",
    "sourceRefs",
    "createdAt",
    "executionWritePolicyDraft"
  ] as const;
  if (
    Object.keys(value).some((key) => !required.includes(key as (typeof required)[number])) ||
    required.some((key) => !(key in value))
  ) {
    return invalidPlanArtifactV20("AGENT_PLAN_ARTIFACT_V20_FIELDS_INVALID");
  }
  if (
    value["schemaVersion"] !== PLAN_ARTIFACT_SCHEMA_VERSION_V20 ||
    value["operationMode"] !== "planning" ||
    !isNonEmptyString(value["planId"]) ||
    !isNonEmptyString(value["sourceRunId"]) ||
    !isSafePositiveInteger(value["revision"]) ||
    !isPlanStatus(value["status"]) ||
    !isContextMode(value["contextMode"]) ||
    !isNonEmptyString(value["goal"]) ||
    !isStringArray(value["successCriteria"]) ||
    !isStringArray(value["nonGoals"]) ||
    !isStringArray(value["facts"]) ||
    !isStringArray(value["assumptions"]) ||
    !isStringArray(value["risks"]) ||
    !isStringArray(value["verification"]) ||
    !isStringArray(value["sourceRefs"]) ||
    !isNonEmptyString(value["createdAt"]) ||
    validateExecutionWritePolicyDraft(value["executionWritePolicyDraft"]).ok === false ||
    !isPlanOpenQuestionArray(value["openQuestions"]) ||
    !isPlanTargetRefArray(value["targetRefs"]) ||
    !isPlanStepArray(value["steps"])
  ) {
    return invalidPlanArtifactV20("AGENT_PLAN_ARTIFACT_V20_INVALID");
  }
  return ok(deepFreeze(value as unknown as PlanArtifactV20));
}

/** Build a handoff record without ever turning a planning policy draft into authorization. */
export function createPlanActHandoffV20(
  plan: Pick<PlanArtifactV20, "planId" | "revision">,
  input: CreatePlanActHandoffV20Input
): PlanActHandoffV20 {
  if (input.planId !== plan.planId || input.planRevision !== plan.revision) {
    throw new Error("AGENT_PLAN_HANDOFF_PLAN_REVISION_MISMATCH");
  }
  const policy = parseExecutionWritePolicyDraft(input.executionWritePolicy);
  const acknowledged = input.executionWritePolicyAcknowledged === true;
  if (policy === "write_before_confirmation" && acknowledged) {
    throw new Error("AGENT_PLAN_HANDOFF_ACKNOWLEDGEMENT_INVALID");
  }
  // ADR-0004 is accepted, but the Main-owned confirmation surface is not qualified. A caller-
  // authored string cannot stand in for Main-only human-intent evidence, so preapproval is closed.
  if (policy === "user_preapproved_run") {
    throw new Error("AGENT_PLAN_HANDOFF_TRUST_REQUIRED");
  }
  return deepFreeze({
    schemaVersion: PLAN_ARTIFACT_SCHEMA_VERSION_V20,
    ...input,
    executionWritePolicy: policy,
    executionWritePolicyAcknowledged: acknowledged
  });
}

export function parsePlanActHandoffV20(value: unknown): PlanActHandoffV20 {
  const validation = validatePlanActHandoffV20(value);
  if (!validation.ok) throw new Error(validation.error.code);
  return validation.value;
}

export function validatePlanActHandoffV20(value: unknown): Result<PlanActHandoffV20, UnifiedError> {
  if (!isRecord(value)) return invalidPlanArtifactV20("AGENT_PLAN_HANDOFF_INVALID");
  const keys = Object.keys(value);
  const required = [
    "schemaVersion",
    "handoffId",
    "planId",
    "planRevision",
    "executionContextMode",
    "executionWritePolicy",
    "executionWritePolicyAcknowledged",
    "providerSemanticVersionSetChecksum"
  ];
  const optional = ["capabilityRevision", "policyRevision"];
  const allowed = new Set([...required, ...optional]);
  if (
    keys.some((key) => !allowed.has(key)) ||
    required.some((key) => !(key in value)) ||
    value["schemaVersion"] !== PLAN_ARTIFACT_SCHEMA_VERSION_V20 ||
    !isNonEmptyString(value["handoffId"]) ||
    !isNonEmptyString(value["planId"]) ||
    !isSafePositiveInteger(value["planRevision"]) ||
    (value["executionContextMode"] !== "writing" &&
      value["executionContextMode"] !== "general_file") ||
    !validateExecutionWritePolicyDraft(value["executionWritePolicy"]).ok ||
    typeof value["executionWritePolicyAcknowledged"] !== "boolean" ||
    !isSha256(value["providerSemanticVersionSetChecksum"])
  ) {
    return invalidPlanArtifactV20("AGENT_PLAN_HANDOFF_INVALID");
  }
  if (
    value["executionWritePolicy"] === "write_before_confirmation" &&
    value["executionWritePolicyAcknowledged"] !== false
  ) {
    return invalidPlanArtifactV20("AGENT_PLAN_HANDOFF_ACKNOWLEDGEMENT_INVALID");
  }
  if (value["executionWritePolicy"] === "user_preapproved_run") {
    return invalidPlanArtifactV20("AGENT_PLAN_HANDOFF_TRUST_REQUIRED");
  }
  for (const key of optional) {
    if (key in value && !isNonEmptyString(value[key])) {
      return invalidPlanArtifactV20("AGENT_PLAN_HANDOFF_INVALID");
    }
  }
  return ok(deepFreeze(value as unknown as PlanActHandoffV20));
}

export function revisePlanArtifact(
  plan: PlanArtifact,
  input: RevisePlanArtifactInput
): PlanArtifact {
  const resolutions = new Map(
    input.resolvedQuestions.map((question) => [question.questionId, question])
  );
  return deepFreeze({
    ...plan,
    revision: plan.revision + 1,
    status: "ready",
    createdAt: input.createdAt,
    openQuestions: plan.openQuestions.map((question) => {
      const resolution = resolutions.get(question.questionId);
      return resolution === undefined
        ? question
        : {
            ...question,
            resolution: resolution.resolution,
            resolvedBy: resolution.resolvedBy
          };
    })
  });
}

export function canExecutePlanArtifact(plan: PlanArtifact): boolean {
  return plan.openQuestions.every(
    (question) => !question.blocking || question.resolution !== undefined
  );
}

function invalidPlanArtifactV20(code: string): Result<never, UnifiedError> {
  return err(
    createUnifiedError({
      code,
      category: "ValidationError",
      message: "The Plan Artifact or Plan-to-Act handoff is invalid.",
      recoverability: "user-action",
      suggestedAction: "Reload the current plan and confirm the execution policy again.",
      traceId: "plan-artifact"
    })
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSafePositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isContextMode(value: unknown): value is AgentContextMode {
  return value === "standalone_chat" || value === "writing" || value === "general_file";
}

function isPlanStatus(value: unknown): value is PlanArtifact["status"] {
  return (
    value === "ready" ||
    value === "approved" ||
    value === "executing" ||
    value === "completed" ||
    value === "rejected" ||
    value === "superseded"
  );
}

function isPlanOpenQuestionArray(value: unknown): value is readonly PlanOpenQuestion[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isRecord(item) &&
        Object.keys(item).every((key) =>
          ["questionId", "prompt", "blocking", "resolution", "resolvedBy"].includes(key)
        ) &&
        isNonEmptyString(item["questionId"]) &&
        isNonEmptyString(item["prompt"]) &&
        typeof item["blocking"] === "boolean" &&
        (item["resolution"] === undefined || typeof item["resolution"] === "string") &&
        (item["resolvedBy"] === undefined ||
          item["resolvedBy"] === "user" ||
          item["resolvedBy"] === "system")
    )
  );
}

function isPlanTargetRefArray(value: unknown): value is readonly PlanTargetRef[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isRecord(item) &&
        Object.keys(item).length === 2 &&
        isNonEmptyString(item["refId"]) &&
        isNonEmptyString(item["intent"])
    )
  );
}

function isPlanStepArray(value: unknown): value is readonly PlanStep[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isRecord(item) &&
        Object.keys(item).length === 3 &&
        isNonEmptyString(item["stepId"]) &&
        isNonEmptyString(item["title"]) &&
        isNonEmptyString(item["verification"])
    )
  );
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}
