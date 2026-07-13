import type { AgentContextMode, AgentOperationMode } from "./agent-run-types.js";

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

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}
