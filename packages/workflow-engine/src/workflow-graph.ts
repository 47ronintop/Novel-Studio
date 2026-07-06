import type { WorkflowDefinition, WorkflowStep, WorkflowStepKind } from "./types.js";

export type WorkflowGraphEdgeKind = "next" | "branch" | "default";
export type WorkflowGraphIssueSeverity = "error" | "warning";
export type WorkflowGraphValidationStatus = "valid" | "invalid";
export type WorkflowGraphIssueCode =
  | "WORKFLOW_GRAPH_ENTRY_MISSING"
  | "WORKFLOW_GRAPH_EDGE_TARGET_MISSING"
  | "WORKFLOW_GRAPH_NODE_UNREACHABLE"
  | "WORKFLOW_GRAPH_AGENT_MISSING"
  | "WORKFLOW_GRAPH_PLUGIN_MISSING"
  | "WORKFLOW_GRAPH_BRANCH_EMPTY";

export interface WorkflowGraphNode {
  readonly id: string;
  readonly stepId: string;
  readonly kind: WorkflowStepKind;
  readonly label: string;
  readonly metadata: WorkflowGraphNodeMetadata;
}

export interface WorkflowGraphNodeMetadata {
  readonly agentId?: string;
  readonly pluginId?: string;
  readonly contributionId?: string;
  readonly branchCount?: number;
  readonly defaultNextStepId?: string;
}

export interface WorkflowGraphEdge {
  readonly id: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly kind: WorkflowGraphEdgeKind;
  readonly label?: string;
  readonly branchId?: string;
  readonly condition?: string;
}

export interface WorkflowGraphViewModel {
  readonly workflowId: string;
  readonly title: string;
  readonly entryNodeId: string;
  readonly nodes: readonly WorkflowGraphNode[];
  readonly edges: readonly WorkflowGraphEdge[];
}

export interface WorkflowGraphValidationIssue {
  readonly code: WorkflowGraphIssueCode;
  readonly severity: WorkflowGraphIssueSeverity;
  readonly stepId: string;
  readonly message: string;
  readonly targetStepId?: string;
}

export interface WorkflowValidationReport {
  readonly status: WorkflowGraphValidationStatus;
  readonly issues: readonly WorkflowGraphValidationIssue[];
}

export function buildWorkflowGraphViewModel(
  definition: WorkflowDefinition
): WorkflowGraphViewModel {
  return {
    workflowId: definition.id,
    title: definition.title,
    entryNodeId: definition.entryStepId,
    nodes: definition.steps.map((step) => ({
      id: step.id,
      stepId: step.id,
      kind: step.kind,
      label: step.id,
      metadata: createNodeMetadata(step)
    })),
    edges: definition.steps.flatMap((step) => createEdges(step))
  };
}

export function validateWorkflowGraph(definition: WorkflowDefinition): WorkflowValidationReport {
  const issues: WorkflowGraphValidationIssue[] = [];
  const stepIds = new Set(definition.steps.map((step) => step.id));

  if (!stepIds.has(definition.entryStepId)) {
    issues.push({
      code: "WORKFLOW_GRAPH_ENTRY_MISSING",
      severity: "error",
      stepId: definition.entryStepId,
      message: "Workflow entry step does not exist."
    });
  }

  for (const step of definition.steps) {
    issues.push(...validateStepEdges(step, stepIds));
  }

  const reachableStepIds = findReachableStepIds(definition, stepIds);
  for (const step of definition.steps) {
    if (!reachableStepIds.has(step.id)) {
      issues.push({
        code: "WORKFLOW_GRAPH_NODE_UNREACHABLE",
        severity: "error",
        stepId: step.id,
        message: "Workflow step is not reachable from the entry step."
      });
    }

    if (step.kind === "agent" && step.agentId === undefined) {
      issues.push({
        code: "WORKFLOW_GRAPH_AGENT_MISSING",
        severity: "error",
        stepId: step.id,
        message: "Agent workflow node is missing agentId."
      });
    }

    if (
      step.kind === "plugin" &&
      (step.pluginId === undefined || step.contributionId === undefined)
    ) {
      issues.push({
        code: "WORKFLOW_GRAPH_PLUGIN_MISSING",
        severity: "error",
        stepId: step.id,
        message: "Plugin workflow node is missing pluginId or contributionId."
      });
    }

    if (step.kind === "branch" && (step.branches === undefined || step.branches.length === 0)) {
      issues.push({
        code: "WORKFLOW_GRAPH_BRANCH_EMPTY",
        severity: "error",
        stepId: step.id,
        message: "Branch workflow node must declare at least one branch."
      });
    }
  }

  return {
    status: issues.some((issue) => issue.severity === "error") ? "invalid" : "valid",
    issues
  };
}

function createNodeMetadata(step: WorkflowStep): WorkflowGraphNodeMetadata {
  switch (step.kind) {
    case "agent":
      return step.agentId === undefined ? {} : { agentId: step.agentId };
    case "plugin":
      return {
        ...(step.pluginId === undefined ? {} : { pluginId: step.pluginId }),
        ...(step.contributionId === undefined ? {} : { contributionId: step.contributionId })
      };
    case "branch":
      return {
        branchCount: step.branches?.length ?? 0,
        ...(step.defaultNextStepId === undefined
          ? {}
          : { defaultNextStepId: step.defaultNextStepId })
      };
    case "context":
    case "confirmation":
    case "save":
      return {};
  }
}

function createEdges(step: WorkflowStep): readonly WorkflowGraphEdge[] {
  const edges: WorkflowGraphEdge[] = [];

  if (step.nextStepId !== undefined) {
    edges.push({
      id: `${step.id}:next:${step.nextStepId}`,
      fromNodeId: step.id,
      toNodeId: step.nextStepId,
      kind: "next"
    });
  }

  for (const branch of step.branches ?? []) {
    edges.push({
      id: `${step.id}:branch:${branch.id}`,
      fromNodeId: step.id,
      toNodeId: branch.nextStepId,
      kind: "branch",
      label: branch.label,
      branchId: branch.id,
      condition: branch.condition
    });
  }

  if (step.defaultNextStepId !== undefined) {
    edges.push({
      id: `${step.id}:default:${step.defaultNextStepId}`,
      fromNodeId: step.id,
      toNodeId: step.defaultNextStepId,
      kind: "default"
    });
  }

  return edges;
}

function validateStepEdges(
  step: WorkflowStep,
  stepIds: ReadonlySet<string>
): readonly WorkflowGraphValidationIssue[] {
  const issues: WorkflowGraphValidationIssue[] = [];
  const targetStepIds = [
    ...(step.nextStepId === undefined ? [] : [step.nextStepId]),
    ...(step.defaultNextStepId === undefined ? [] : [step.defaultNextStepId]),
    ...(step.branches?.map((branch) => branch.nextStepId) ?? [])
  ];

  for (const targetStepId of targetStepIds) {
    if (!stepIds.has(targetStepId)) {
      issues.push({
        code: "WORKFLOW_GRAPH_EDGE_TARGET_MISSING",
        severity: "error",
        stepId: step.id,
        message: "Workflow edge points to a missing step.",
        targetStepId
      });
    }
  }

  return issues;
}

function findReachableStepIds(
  definition: WorkflowDefinition,
  stepIds: ReadonlySet<string>
): ReadonlySet<string> {
  const reachable = new Set<string>();
  const pending = stepIds.has(definition.entryStepId) ? [definition.entryStepId] : [];

  while (pending.length > 0) {
    const stepId = pending.pop();
    if (stepId === undefined || reachable.has(stepId)) {
      continue;
    }
    reachable.add(stepId);

    const step = definition.steps.find((candidate) => candidate.id === stepId);
    if (step === undefined) {
      continue;
    }
    for (const nextStepId of nextStepIds(step)) {
      if (stepIds.has(nextStepId) && !reachable.has(nextStepId)) {
        pending.push(nextStepId);
      }
    }
  }

  return reachable;
}

function nextStepIds(step: WorkflowStep): readonly string[] {
  return [
    ...(step.nextStepId === undefined ? [] : [step.nextStepId]),
    ...(step.defaultNextStepId === undefined ? [] : [step.defaultNextStepId]),
    ...(step.branches?.map((branch) => branch.nextStepId) ?? [])
  ];
}
