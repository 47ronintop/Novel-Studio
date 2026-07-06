import { err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import { workflowError } from "./errors.js";
import type {
  ParseWorkflowOptions,
  StartWorkflowRunInput,
  WorkflowBranch,
  WorkflowBranchSelectionInput,
  WorkflowDefinition,
  WorkflowNextAction,
  WorkflowRunState,
  WorkflowStep,
  WorkflowStepKind,
  WorkflowStepTransitionInput
} from "./types.js";

export function parseWorkflowDefinition(
  input: unknown,
  options: ParseWorkflowOptions
): Result<WorkflowDefinition, UnifiedError> {
  if (!isRecord(input)) {
    return invalidDefinition(options.traceId, "Workflow definition must be an object.");
  }

  const schemaVersion = readString(input, "schemaVersion");
  const id = readString(input, "id");
  const type = readString(input, "type");
  const title = readString(input, "title");
  const status = readWorkflowStatus(input.status);
  const entryStepId = readString(input, "entryStepId");
  const createdAt = readString(input, "createdAt");
  const updatedAt = readString(input, "updatedAt");
  const rawSteps = input.steps;

  if (
    schemaVersion !== "1.0" ||
    id === undefined ||
    type !== "workflow.definition" ||
    title === undefined ||
    status === undefined ||
    entryStepId === undefined ||
    createdAt === undefined ||
    updatedAt === undefined ||
    !Array.isArray(rawSteps) ||
    rawSteps.length === 0
  ) {
    return invalidDefinition(options.traceId, "Workflow definition is missing required fields.");
  }

  const stepsResult = parseSteps(rawSteps, options.traceId);
  if (!stepsResult.ok) {
    return stepsResult;
  }

  const definition: WorkflowDefinition = {
    schemaVersion,
    id,
    type,
    title,
    status,
    entryStepId,
    steps: stepsResult.value,
    createdAt,
    updatedAt
  };

  const entryStep = findStep(definition, entryStepId);
  if (entryStep === undefined) {
    return stepNotFound(options.traceId, entryStepId);
  }

  for (const step of definition.steps) {
    if (step.nextStepId !== undefined && findStep(definition, step.nextStepId) === undefined) {
      return stepNotFound(options.traceId, step.nextStepId);
    }
    if (step.kind === "branch") {
      const branchValidation = validateBranchStep(definition, step, options.traceId);
      if (!branchValidation.ok) {
        return branchValidation;
      }
    }
    if (step.kind === "agent" && step.agentId === undefined) {
      return err(
        workflowError({
          code: "WORKFLOW_AGENT_STEP_MISSING_AGENT",
          message: "Agent workflow steps must include agentId.",
          suggestedAction: "Add agentId to the workflow step before running this workflow.",
          traceId: options.traceId,
          redactedDetail: { stepId: step.id }
        })
      );
    }
  }

  return ok(definition);
}

export function startWorkflowRun(
  definition: WorkflowDefinition,
  input: StartWorkflowRunInput
): WorkflowRunState {
  const now = input.now();
  return {
    schemaVersion: "1.0",
    workflowRunId: input.workflowRunId,
    workflowId: definition.id,
    status: "running",
    currentStepId: definition.entryStepId,
    completedStepIds: [],
    confirmedStepIds: [],
    createdAt: now,
    updatedAt: now
  };
}

export function evaluateNextWorkflowAction(
  definition: WorkflowDefinition,
  state: WorkflowRunState
): Result<WorkflowNextAction, UnifiedError> {
  if (state.status === "completed" || state.currentStepId === null) {
    return ok({
      kind: "complete",
      workflowRunId: state.workflowRunId
    });
  }

  const step = findStep(definition, state.currentStepId);
  if (step === undefined) {
    return stepNotFound(state.workflowRunId, state.currentStepId);
  }

  const nextStepId = step.nextStepId ?? null;
  switch (step.kind) {
    case "context":
      return ok({
        kind: "build-context",
        workflowRunId: state.workflowRunId,
        stepId: step.id,
        nextStepId
      });
    case "agent":
      if (step.agentId === undefined) {
        return err(
          workflowError({
            code: "WORKFLOW_AGENT_STEP_MISSING_AGENT",
            message: "Agent workflow steps must include agentId.",
            suggestedAction: "Fix the workflow definition before running this step.",
            traceId: state.workflowRunId,
            redactedDetail: { stepId: step.id }
          })
        );
      }

      return ok({
        kind: "run-agent",
        workflowRunId: state.workflowRunId,
        stepId: step.id,
        agentId: step.agentId,
        nextStepId
      });
    case "confirmation":
      return ok({
        kind: "wait-for-confirmation",
        workflowRunId: state.workflowRunId,
        stepId: step.id,
        nextStepId
      });
    case "save":
      return ok({
        kind: "save",
        workflowRunId: state.workflowRunId,
        stepId: step.id,
        nextStepId
      });
    case "branch":
      return ok({
        kind: "choose-branch",
        workflowRunId: state.workflowRunId,
        stepId: step.id,
        branches: step.branches ?? [],
        ...(step.defaultNextStepId === undefined
          ? {}
          : { defaultNextStepId: step.defaultNextStepId })
      });
  }
}

export function completeWorkflowStep(
  definition: WorkflowDefinition,
  state: WorkflowRunState,
  input: WorkflowStepTransitionInput
): Result<WorkflowRunState, UnifiedError> {
  const currentStep = validateCurrentStep(definition, state, input);
  if (!currentStep.ok) {
    return currentStep;
  }

  if (
    currentStep.value.kind === "confirmation" &&
    !state.confirmedStepIds.includes(currentStep.value.id)
  ) {
    return err(
      workflowError({
        code: "WORKFLOW_CONFIRMATION_REQUIRED",
        message: "Workflow confirmation step cannot complete before user confirmation.",
        suggestedAction: "Confirm the workflow step before completing it.",
        traceId: input.traceId,
        redactedDetail: { stepId: currentStep.value.id }
      })
    );
  }

  if (currentStep.value.kind === "branch") {
    return err(
      workflowError({
        code: "WORKFLOW_BRANCH_CHOICE_REQUIRED",
        message: "Workflow branch steps require an explicit branch selection.",
        suggestedAction: "Evaluate the next workflow action and choose a branch before advancing.",
        traceId: input.traceId,
        redactedDetail: { stepId: currentStep.value.id }
      })
    );
  }

  const nextStepId = currentStep.value.nextStepId ?? null;
  const completedStepIds = appendUnique(state.completedStepIds, currentStep.value.id);

  return ok({
    ...state,
    status: nextStepId === null ? "completed" : statusForNextStep(definition, nextStepId),
    currentStepId: nextStepId,
    completedStepIds,
    updatedAt: input.now()
  });
}

export function confirmWorkflowStep(
  definition: WorkflowDefinition,
  state: WorkflowRunState,
  input: WorkflowStepTransitionInput
): Result<WorkflowRunState, UnifiedError> {
  const currentStep = validateCurrentStep(definition, state, input);
  if (!currentStep.ok) {
    return currentStep;
  }

  if (currentStep.value.kind !== "confirmation") {
    return err(
      workflowError({
        code: "WORKFLOW_STEP_MISMATCH",
        message: "Only confirmation steps can be confirmed.",
        suggestedAction: "Evaluate the next workflow action before confirming a step.",
        traceId: input.traceId,
        redactedDetail: { stepId: currentStep.value.id, kind: currentStep.value.kind }
      })
    );
  }

  return ok({
    ...state,
    status: "running",
    confirmedStepIds: appendUnique(state.confirmedStepIds, currentStep.value.id),
    updatedAt: input.now()
  });
}

export function chooseWorkflowBranch(
  definition: WorkflowDefinition,
  state: WorkflowRunState,
  input: WorkflowBranchSelectionInput
): Result<WorkflowRunState, UnifiedError> {
  const currentStep = validateCurrentStep(definition, state, input);
  if (!currentStep.ok) {
    return currentStep;
  }

  if (currentStep.value.kind !== "branch") {
    return err(
      workflowError({
        code: "WORKFLOW_STEP_MISMATCH",
        message: "Only branch steps can choose a workflow branch.",
        suggestedAction: "Evaluate the next workflow action before choosing a branch.",
        traceId: input.traceId,
        redactedDetail: { stepId: currentStep.value.id, kind: currentStep.value.kind }
      })
    );
  }

  const branch = currentStep.value.branches?.find((candidate) => candidate.id === input.branchId);
  if (branch === undefined) {
    return err(
      workflowError({
        code: "WORKFLOW_BRANCH_NOT_FOUND",
        message: "The selected workflow branch does not exist.",
        suggestedAction: "Choose one of the branch ids returned by the workflow action.",
        traceId: input.traceId,
        redactedDetail: { stepId: currentStep.value.id, branchId: input.branchId }
      })
    );
  }

  return ok({
    ...state,
    status: statusForNextStep(definition, branch.nextStepId),
    currentStepId: branch.nextStepId,
    completedStepIds: appendUnique(state.completedStepIds, currentStep.value.id),
    updatedAt: input.now()
  });
}

function parseSteps(
  rawSteps: readonly unknown[],
  traceId: string
): Result<readonly WorkflowStep[], UnifiedError> {
  const steps: WorkflowStep[] = [];
  const seenIds = new Set<string>();

  for (const rawStep of rawSteps) {
    if (!isRecord(rawStep)) {
      return invalidDefinition(traceId, "Workflow step must be an object.");
    }

    const id = readString(rawStep, "id");
    const kind = readStepKind(rawStep.kind);
    if (id === undefined || kind === undefined) {
      return invalidDefinition(traceId, "Workflow step is missing id or kind.");
    }
    if (seenIds.has(id)) {
      return err(
        workflowError({
          code: "WORKFLOW_DUPLICATE_STEP",
          message: "Workflow step ids must be unique.",
          suggestedAction: "Rename duplicate workflow step ids.",
          traceId,
          redactedDetail: { stepId: id }
        })
      );
    }
    seenIds.add(id);

    const nextStepId = readString(rawStep, "nextStepId");
    const agentId = readString(rawStep, "agentId");
    const branches = parseBranches(rawStep.branches, traceId);
    if (!branches.ok) {
      return branches;
    }
    const defaultNextStepId = readString(rawStep, "defaultNextStepId");
    const step = createStep({
      id,
      kind,
      nextStepId,
      agentId,
      branches: branches.value,
      defaultNextStepId
    });
    steps.push(step);
  }

  return ok(steps);
}

function parseBranches(
  rawBranches: unknown,
  traceId: string
): Result<readonly WorkflowBranch[] | undefined, UnifiedError> {
  if (rawBranches === undefined) {
    return ok(undefined);
  }
  if (!Array.isArray(rawBranches) || rawBranches.length === 0) {
    return invalidDefinition(traceId, "Branch steps must include at least one branch.");
  }

  const branches: WorkflowBranch[] = [];
  const seenIds = new Set<string>();
  for (const rawBranch of rawBranches) {
    if (!isRecord(rawBranch)) {
      return invalidDefinition(traceId, "Workflow branch must be an object.");
    }

    const id = readString(rawBranch, "id");
    const label = readString(rawBranch, "label");
    const condition = readString(rawBranch, "condition");
    const nextStepId = readString(rawBranch, "nextStepId");
    if (
      id === undefined ||
      label === undefined ||
      condition === undefined ||
      nextStepId === undefined
    ) {
      return invalidDefinition(traceId, "Workflow branch is missing required fields.");
    }
    if (seenIds.has(id)) {
      return err(
        workflowError({
          code: "WORKFLOW_DUPLICATE_BRANCH",
          message: "Workflow branch ids must be unique within a branch step.",
          suggestedAction: "Rename duplicate workflow branch ids.",
          traceId,
          redactedDetail: { branchId: id }
        })
      );
    }
    seenIds.add(id);
    branches.push({ id, label, condition, nextStepId });
  }

  return ok(branches);
}

function createStep(input: {
  readonly id: string;
  readonly kind: WorkflowStepKind;
  readonly nextStepId: string | undefined;
  readonly agentId: string | undefined;
  readonly branches: readonly WorkflowBranch[] | undefined;
  readonly defaultNextStepId: string | undefined;
}): WorkflowStep {
  const base = {
    id: input.id,
    kind: input.kind
  };
  const withAgent =
    input.agentId === undefined
      ? base
      : {
          ...base,
          agentId: input.agentId
        };

  const withNext =
    input.nextStepId === undefined
      ? withAgent
      : {
          ...withAgent,
          nextStepId: input.nextStepId
        };
  const withBranches =
    input.branches === undefined
      ? withNext
      : {
          ...withNext,
          branches: input.branches
        };

  return input.defaultNextStepId === undefined
    ? withBranches
    : {
        ...withBranches,
        defaultNextStepId: input.defaultNextStepId
      };
}

function validateCurrentStep(
  definition: WorkflowDefinition,
  state: WorkflowRunState,
  input: WorkflowStepTransitionInput
): Result<WorkflowStep, UnifiedError> {
  if (state.currentStepId === null) {
    return err(
      workflowError({
        code: "WORKFLOW_RUN_STATE_INVALID",
        message: "Workflow run has no current step.",
        suggestedAction: "Start a new workflow run or inspect the run state.",
        traceId: input.traceId
      })
    );
  }
  if (state.currentStepId !== input.stepId) {
    return err(
      workflowError({
        code: "WORKFLOW_STEP_MISMATCH",
        message: "Completed step does not match the current workflow step.",
        suggestedAction: "Complete the current workflow step before advancing.",
        traceId: input.traceId,
        redactedDetail: { currentStepId: state.currentStepId, requestedStepId: input.stepId }
      })
    );
  }

  const step = findStep(definition, state.currentStepId);
  if (step === undefined) {
    return stepNotFound(input.traceId, state.currentStepId);
  }

  return ok(step);
}

function validateBranchStep(
  definition: WorkflowDefinition,
  step: WorkflowStep,
  traceId: string
): Result<WorkflowDefinition, UnifiedError> {
  if (step.branches === undefined || step.branches.length === 0) {
    return invalidDefinition(traceId, "Branch workflow steps must include branches.");
  }

  for (const branch of step.branches) {
    if (findStep(definition, branch.nextStepId) === undefined) {
      return stepNotFound(traceId, branch.nextStepId);
    }
  }

  if (
    step.defaultNextStepId !== undefined &&
    findStep(definition, step.defaultNextStepId) === undefined
  ) {
    return stepNotFound(traceId, step.defaultNextStepId);
  }

  return ok(definition);
}

function statusForNextStep(
  definition: WorkflowDefinition,
  nextStepId: string
): "running" | "waiting-for-confirmation" {
  return findStep(definition, nextStepId)?.kind === "confirmation"
    ? "waiting-for-confirmation"
    : "running";
}

function findStep(definition: WorkflowDefinition, stepId: string): WorkflowStep | undefined {
  return definition.steps.find((step) => step.id === stepId);
}

function appendUnique(values: readonly string[], value: string): readonly string[] {
  return values.includes(value) ? values : [...values, value];
}

function invalidDefinition<T = WorkflowDefinition>(
  traceId: string,
  message: string
): Result<T, UnifiedError> {
  return err(
    workflowError({
      code: "WORKFLOW_DEFINITION_INVALID",
      message,
      suggestedAction: "Fix the workflow definition and try again.",
      traceId
    })
  );
}

function stepNotFound<T = WorkflowDefinition>(
  traceId: string,
  stepId: string
): Result<T, UnifiedError> {
  return err(
    workflowError({
      code: "WORKFLOW_STEP_NOT_FOUND",
      message: "Workflow references a step that does not exist.",
      suggestedAction: "Fix the workflow step reference and try again.",
      traceId,
      redactedDetail: { stepId }
    })
  );
}

function readString(record: UnknownRecord, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readWorkflowStatus(value: unknown) {
  return value === "active" || value === "draft" || value === "archived" || value === "deleted"
    ? value
    : undefined;
}

function readStepKind(value: unknown): WorkflowStepKind | undefined {
  return value === "context" ||
    value === "agent" ||
    value === "confirmation" ||
    value === "save" ||
    value === "branch"
    ? value
    : undefined;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface UnknownRecord {
  readonly [key: string]: unknown;
}
