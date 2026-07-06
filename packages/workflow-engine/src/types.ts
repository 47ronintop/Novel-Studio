export type WorkflowStatus = "active" | "draft" | "archived" | "deleted";
export type WorkflowStepKind = "context" | "agent" | "confirmation" | "save" | "branch";
export type WorkflowRunStatus = "running" | "waiting-for-confirmation" | "completed" | "failed";

export interface WorkflowStep {
  readonly id: string;
  readonly kind: WorkflowStepKind;
  readonly agentId?: string;
  readonly nextStepId?: string;
  readonly branches?: readonly WorkflowBranch[];
  readonly defaultNextStepId?: string;
}

export interface WorkflowBranch {
  readonly id: string;
  readonly label: string;
  readonly condition: string;
  readonly nextStepId: string;
}

export interface WorkflowDefinition {
  readonly schemaVersion: "1.0";
  readonly id: string;
  readonly type: "workflow.definition";
  readonly title: string;
  readonly status: WorkflowStatus;
  readonly entryStepId: string;
  readonly steps: readonly WorkflowStep[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorkflowRunState {
  readonly schemaVersion: "1.0";
  readonly workflowRunId: string;
  readonly workflowId: string;
  readonly status: WorkflowRunStatus;
  readonly currentStepId: string | null;
  readonly completedStepIds: readonly string[];
  readonly confirmedStepIds: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ParseWorkflowOptions {
  readonly traceId: string;
}

export interface StartWorkflowRunInput {
  readonly workflowRunId: string;
  readonly traceId: string;
  readonly now: () => string;
}

export interface WorkflowStepTransitionInput {
  readonly stepId: string;
  readonly traceId: string;
  readonly now: () => string;
}

export interface WorkflowBranchSelectionInput extends WorkflowStepTransitionInput {
  readonly branchId: string;
}

export type WorkflowNextAction =
  | {
      readonly kind: "build-context";
      readonly workflowRunId: string;
      readonly stepId: string;
      readonly nextStepId: string | null;
    }
  | {
      readonly kind: "run-agent";
      readonly workflowRunId: string;
      readonly stepId: string;
      readonly agentId: string;
      readonly nextStepId: string | null;
    }
  | {
      readonly kind: "wait-for-confirmation";
      readonly workflowRunId: string;
      readonly stepId: string;
      readonly nextStepId: string | null;
    }
  | {
      readonly kind: "save";
      readonly workflowRunId: string;
      readonly stepId: string;
      readonly nextStepId: string | null;
    }
  | {
      readonly kind: "choose-branch";
      readonly workflowRunId: string;
      readonly stepId: string;
      readonly branches: readonly WorkflowBranch[];
      readonly defaultNextStepId?: string;
    }
  | {
      readonly kind: "complete";
      readonly workflowRunId: string;
    };
