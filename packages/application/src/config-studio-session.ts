import type { JsonObject, Result, UnifiedError } from "@novel-studio/shared";
import {
  buildWorkflowGraphViewModel,
  applyWorkflowNodeInspectorEdit,
  parseWorkflowDefinition,
  validateWorkflowGraph
} from "@novel-studio/workflow-engine";
import type {
  WorkflowBranch,
  WorkflowDefinition,
  WorkflowNodeInspectorEdit,
  WorkflowGraphViewModel,
  WorkflowValidationReport,
  WorkflowStep,
  WorkflowStepKind
} from "@novel-studio/workflow-engine";

export type ConfigAssetType = "prompt" | "agent" | "workflow";
export type ConfigCreatedBy = "user" | "system" | "migration";

export interface ConfigAssetSnapshot {
  readonly assetType: ConfigAssetType;
  readonly assetId: string;
  readonly content: JsonObject;
  readonly workflowGraph?: ConfigWorkflowGraphSnapshot;
}

export interface ConfigWorkflowGraphSnapshot {
  readonly graph: WorkflowGraphViewModel;
  readonly validation: WorkflowValidationReport;
  readonly layout?: ConfigWorkflowGraphLayout;
}

export interface ConfigWorkflowDesignerAvailability {
  readonly status: "ready" | "blocked";
  readonly message: string;
  readonly blockerMessages: readonly string[];
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly canDragNodes: boolean;
  readonly canSelectEdges: boolean;
}

export interface ConfigWorkflowGraphLayoutNode {
  readonly nodeId: string;
  readonly x: number;
  readonly y: number;
}

export interface ConfigWorkflowGraphLayout {
  readonly schemaVersion: "1.0";
  readonly source: "generated" | "draft";
  readonly viewport: {
    readonly x: number;
    readonly y: number;
    readonly zoom: number;
  };
  readonly nodes: readonly ConfigWorkflowGraphLayoutNode[];
}

export interface ConfigWorkflowGraphLayoutEdit {
  readonly nodeId: string;
  readonly x: number;
  readonly y: number;
}

export interface ConfigVersionSummary {
  readonly versionId: string;
}

export interface ConfigAssetSaveInput {
  readonly assetType: ConfigAssetType;
  readonly assetId: string;
  readonly content: JsonObject;
  readonly createdBy?: ConfigCreatedBy;
}

export interface ConfigAssetRestoreInput {
  readonly assetType: ConfigAssetType;
  readonly assetId: string;
  readonly versionId: string;
  readonly createdBy?: ConfigCreatedBy;
}

export type ConfigWorkflowNodeInspectorEdit = Omit<WorkflowNodeInspectorEdit, "updatedAt">;

export interface ConfigWorkflowNodeInspectorEditResult {
  readonly content: JsonObject;
  readonly workflowGraph: ConfigWorkflowGraphSnapshot;
}

export interface ConfigWorkflowGraphLayoutContentEditResult {
  readonly content: JsonObject;
  readonly workflowGraph: ConfigWorkflowGraphSnapshot;
}

export type ConfigWorkflowSemanticEdit =
  | {
      readonly kind: "add-node";
      readonly afterStepId?: string;
      readonly step: ConfigWorkflowSemanticStepDraft;
      readonly layout?: {
        readonly x: number;
        readonly y: number;
      };
    }
  | {
      readonly kind: "delete-node";
      readonly stepId: string;
    }
  | {
      readonly kind: "retarget-edge";
      readonly fromStepId: string;
      readonly edgeKind: "next" | "default";
      readonly toStepId?: string;
    }
  | {
      readonly kind: "edit-branch-edge";
      readonly fromStepId: string;
      readonly branchId: string;
      readonly label: string;
      readonly condition: string;
      readonly toStepId: string;
    };

export interface ConfigWorkflowSemanticStepDraft {
  readonly id: string;
  readonly kind: WorkflowStepKind;
  readonly agentId?: string;
  readonly pluginId?: string;
  readonly contributionId?: string;
  readonly nextStepId?: string;
  readonly defaultNextStepId?: string;
  readonly branches?: readonly WorkflowBranch[];
}

export interface ConfigWorkflowSemanticEditResult {
  readonly content: JsonObject;
  readonly workflowGraph: ConfigWorkflowGraphSnapshot;
}

export type ConfigWorkflowProductEdit =
  | {
      readonly kind: "insert-node-after";
      readonly afterStepId: string;
      readonly stepId: string;
      readonly stepKind: WorkflowStepKind;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly kind: "retarget-selected-edge";
      readonly edgeId: string;
      readonly toStepId: string;
    }
  | {
      readonly kind: "edit-branch-form";
      readonly fromStepId: string;
      readonly branchId: string;
      readonly label: string;
      readonly condition: string;
      readonly toStepId: string;
    }
  | {
      readonly kind: "confirm-delete-node";
      readonly stepId: string;
      readonly confirmed: boolean;
    };

export interface ConfigWorkflowProductEditResult extends ConfigWorkflowSemanticEditResult {
  readonly applied: boolean;
  readonly blockedReason?: string;
}

export interface ConfigAssetPort {
  readConfigAsset(
    assetType: ConfigAssetType,
    assetId: string
  ): Promise<Result<JsonObject, UnifiedError>>;
  writeConfigAsset(
    input: ConfigAssetSaveInput
  ): Promise<Result<ConfigVersionSummary, UnifiedError>>;
  restoreConfigAssetVersion(
    input: ConfigAssetRestoreInput
  ): Promise<Result<JsonObject, UnifiedError>>;
}

export interface ConfigStudioSession {
  loadConfigAsset(
    assetType: ConfigAssetType,
    assetId: string
  ): Promise<Result<ConfigAssetSnapshot, UnifiedError>>;
  saveConfigAsset(input: ConfigAssetSaveInput): Promise<Result<ConfigVersionSummary, UnifiedError>>;
  restoreConfigAssetVersion(
    input: ConfigAssetRestoreInput
  ): Promise<Result<ConfigAssetSnapshot, UnifiedError>>;
}

export interface ConfigStudioSessionOptions {
  readonly configAssetPort: ConfigAssetPort;
}

export function createConfigStudioSession(
  options: ConfigStudioSessionOptions
): ConfigStudioSession {
  return {
    async loadConfigAsset(assetType, assetId) {
      const content = await options.configAssetPort.readConfigAsset(assetType, assetId);
      if (!content.ok) {
        return content;
      }

      return {
        ok: true,
        value: {
          assetType,
          assetId,
          content: content.value,
          ...workflowGraphForContent(assetType, content.value, "config-studio-load")
        }
      };
    },

    async saveConfigAsset(input) {
      return options.configAssetPort.writeConfigAsset(input);
    },

    async restoreConfigAssetVersion(input) {
      const content = await options.configAssetPort.restoreConfigAssetVersion(input);
      if (!content.ok) {
        return content;
      }

      return {
        ok: true,
        value: {
          assetType: input.assetType,
          assetId: input.assetId,
          content: content.value,
          ...workflowGraphForContent(input.assetType, content.value, "config-studio-restore")
        }
      };
    }
  };
}

export function applyConfigWorkflowNodeInspectorEdit(input: {
  readonly content: JsonObject;
  readonly edit: ConfigWorkflowNodeInspectorEdit;
  readonly now: () => string;
}): Result<ConfigWorkflowNodeInspectorEditResult, UnifiedError> {
  const parsed = parseWorkflowDefinition(input.content, { traceId: "config-studio-inspector" });
  if (!parsed.ok) {
    return parsed;
  }

  const edited = applyWorkflowNodeInspectorEdit(parsed.value, {
    ...input.edit,
    updatedAt: input.now()
  });
  if (!edited.ok) {
    return edited;
  }

  return {
    ok: true,
    value: {
      content: edited.value as unknown as JsonObject,
      workflowGraph: {
        graph: buildWorkflowGraphViewModel(edited.value),
        validation: validateWorkflowGraph(edited.value),
        layout: createConfigWorkflowGraphLayout(buildWorkflowGraphViewModel(edited.value))
      }
    }
  };
}

export function createConfigWorkflowGraphLayout(
  graph: WorkflowGraphViewModel,
  previousLayout?: ConfigWorkflowGraphLayout
): ConfigWorkflowGraphLayout {
  const previousByNodeId = new Map(
    previousLayout?.nodes.map((node) => [node.nodeId, node] as const) ?? []
  );

  return {
    schemaVersion: "1.0",
    source: previousLayout?.source ?? "generated",
    viewport: previousLayout?.viewport ?? { x: 0, y: 0, zoom: 1 },
    nodes: graph.nodes.map((node, index) => {
      const previous = previousByNodeId.get(node.id);
      return previous ?? { nodeId: node.id, x: index * 220, y: 0 };
    })
  };
}

export function applyConfigWorkflowGraphLayoutEdit(
  snapshot: ConfigWorkflowGraphSnapshot,
  edit: ConfigWorkflowGraphLayoutEdit
): ConfigWorkflowGraphSnapshot {
  const currentLayout = createConfigWorkflowGraphLayout(snapshot.graph, snapshot.layout);
  const nodeExists = snapshot.graph.nodes.some((node) => node.id === edit.nodeId);
  if (!nodeExists) {
    return snapshot;
  }

  return {
    ...snapshot,
    layout: {
      ...currentLayout,
      source: "draft",
      nodes: currentLayout.nodes.map((node) =>
        node.nodeId === edit.nodeId ? { nodeId: edit.nodeId, x: edit.x, y: edit.y } : node
      )
    }
  };
}

export function applyConfigWorkflowGraphLayoutToContent(input: {
  readonly content: JsonObject;
  readonly edit: ConfigWorkflowGraphLayoutEdit;
}): Result<ConfigWorkflowGraphLayoutContentEditResult, UnifiedError> {
  const parsed = parseWorkflowDefinition(input.content, { traceId: "config-studio-layout" });
  if (!parsed.ok) {
    return parsed;
  }

  const graph = buildWorkflowGraphViewModel(parsed.value);
  const previousLayout = readWorkflowLayout(input.content["layout"]);
  const snapshot = {
    graph,
    validation: validateWorkflowGraph(parsed.value),
    layout: createConfigWorkflowGraphLayout(graph, previousLayout)
  };
  const workflowGraph = applyConfigWorkflowGraphLayoutEdit(snapshot, input.edit);

  return {
    ok: true,
    value: {
      content: {
        ...input.content,
        ...(workflowGraph.layout === undefined
          ? {}
          : { layout: workflowLayoutToJsonObject(workflowGraph.layout) })
      },
      workflowGraph
    }
  };
}

export function createConfigWorkflowDesignerAvailability(
  snapshot: ConfigWorkflowGraphSnapshot
): ConfigWorkflowDesignerAvailability {
  const blockerMessages = [
    ...snapshot.validation.issues.map((issue) => issue.message),
    ...(snapshot.layout === undefined ? ["Workflow layout is not available."] : [])
  ];
  const ready = blockerMessages.length === 0;

  return {
    status: ready ? "ready" : "blocked",
    message: ready ? "Workflow designer canvas ready" : "Workflow designer canvas blocked",
    blockerMessages,
    nodeCount: snapshot.graph.nodes.length,
    edgeCount: snapshot.graph.edges.length,
    canDragNodes: ready,
    canSelectEdges: ready
  };
}

export function applyConfigWorkflowSemanticEdit(input: {
  readonly content: JsonObject;
  readonly edit: ConfigWorkflowSemanticEdit;
  readonly now: () => string;
}): Result<ConfigWorkflowSemanticEditResult, UnifiedError> {
  const parsed = parseWorkflowDefinition(input.content, { traceId: "config-studio-semantic" });
  if (!parsed.ok) {
    return parsed;
  }

  const definition = applySemanticEditToDefinition(parsed.value, input.edit, input.now());
  const graph = buildWorkflowGraphViewModel(definition);
  const previousLayout = readWorkflowLayout(input.content["layout"]);
  const layout = applySemanticLayoutEdit(
    createConfigWorkflowGraphLayout(graph, previousLayout),
    input.edit
  );
  const validation = validateWorkflowGraph(definition);

  return {
    ok: true,
    value: {
      content: {
        ...(definition as unknown as JsonObject),
        layout: workflowLayoutToJsonObject(layout)
      },
      workflowGraph: {
        graph,
        validation,
        layout
      }
    }
  };
}

export function applyConfigWorkflowProductEdit(input: {
  readonly content: JsonObject;
  readonly edit: ConfigWorkflowProductEdit;
  readonly now: () => string;
}): Result<ConfigWorkflowProductEditResult, UnifiedError> {
  if (input.edit.kind === "confirm-delete-node" && !input.edit.confirmed) {
    const parsed = parseWorkflowDefinition(input.content, { traceId: "config-studio-product" });
    if (!parsed.ok) {
      return parsed;
    }
    const graph = buildWorkflowGraphViewModel(parsed.value);
    return {
      ok: true,
      value: {
        content: input.content,
        workflowGraph: {
          graph,
          validation: validateWorkflowGraph(parsed.value),
          layout: createConfigWorkflowGraphLayout(
            graph,
            readWorkflowLayout(input.content["layout"])
          )
        },
        applied: false,
        blockedReason: "Workflow node deletion requires confirmation."
      }
    };
  }

  const parsed = parseWorkflowDefinition(input.content, { traceId: "config-studio-product" });
  if (!parsed.ok) {
    return parsed;
  }

  const semanticEdit = productEditToSemanticEdit(parsed.value, input.edit);
  const result = applyConfigWorkflowSemanticEdit({
    content: input.content,
    edit: semanticEdit,
    now: input.now
  });
  if (!result.ok) {
    return result;
  }

  return {
    ok: true,
    value: {
      ...result.value,
      applied: true
    }
  };
}

function workflowGraphForContent(
  assetType: ConfigAssetType,
  content: JsonObject,
  traceId: string
): { readonly workflowGraph: ConfigWorkflowGraphSnapshot } | Record<string, never> {
  if (assetType !== "workflow") {
    return {};
  }

  const parsed = parseWorkflowDefinition(content, { traceId });
  if (!parsed.ok) {
    return {};
  }

  return {
    workflowGraph: {
      graph: buildWorkflowGraphViewModel(parsed.value),
      validation: validateWorkflowGraph(parsed.value),
      layout: createConfigWorkflowGraphLayout(
        buildWorkflowGraphViewModel(parsed.value),
        readWorkflowLayout(content["layout"])
      )
    }
  };
}

function readWorkflowLayout(value: unknown): ConfigWorkflowGraphLayout | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const candidate = value as {
    readonly schemaVersion?: unknown;
    readonly source?: unknown;
    readonly viewport?: unknown;
    readonly nodes?: unknown;
  };
  if (
    candidate.schemaVersion !== "1.0" ||
    (candidate.source !== "generated" && candidate.source !== "draft") ||
    !Array.isArray(candidate.nodes)
  ) {
    return undefined;
  }

  const viewport =
    typeof candidate.viewport === "object" &&
    candidate.viewport !== null &&
    !Array.isArray(candidate.viewport)
      ? (candidate.viewport as {
          readonly x?: unknown;
          readonly y?: unknown;
          readonly zoom?: unknown;
        })
      : undefined;
  const nodes = candidate.nodes.flatMap((node) => {
    if (typeof node !== "object" || node === null || Array.isArray(node)) {
      return [];
    }
    const layoutNode = node as {
      readonly nodeId?: unknown;
      readonly x?: unknown;
      readonly y?: unknown;
    };
    return typeof layoutNode.nodeId === "string" &&
      typeof layoutNode.x === "number" &&
      typeof layoutNode.y === "number"
      ? [{ nodeId: layoutNode.nodeId, x: layoutNode.x, y: layoutNode.y }]
      : [];
  });

  return {
    schemaVersion: "1.0",
    source: candidate.source,
    viewport: {
      x: typeof viewport?.x === "number" ? viewport.x : 0,
      y: typeof viewport?.y === "number" ? viewport.y : 0,
      zoom: typeof viewport?.zoom === "number" ? viewport.zoom : 1
    },
    nodes
  };
}

function workflowLayoutToJsonObject(layout: ConfigWorkflowGraphLayout): JsonObject {
  return {
    schemaVersion: layout.schemaVersion,
    source: layout.source,
    viewport: {
      x: layout.viewport.x,
      y: layout.viewport.y,
      zoom: layout.viewport.zoom
    },
    nodes: layout.nodes.map((node) => ({
      nodeId: node.nodeId,
      x: node.x,
      y: node.y
    }))
  };
}

function applySemanticEditToDefinition(
  definition: WorkflowDefinition,
  edit: ConfigWorkflowSemanticEdit,
  updatedAt: string
): WorkflowDefinition {
  switch (edit.kind) {
    case "add-node":
      return addSemanticWorkflowNode(definition, edit, updatedAt);
    case "delete-node":
      return deleteSemanticWorkflowNode(definition, edit.stepId, updatedAt);
    case "retarget-edge":
      return {
        ...definition,
        updatedAt,
        steps: definition.steps.map((step) =>
          step.id === edit.fromStepId ? retargetWorkflowStepEdge(step, edit) : step
        )
      };
    case "edit-branch-edge":
      return {
        ...definition,
        updatedAt,
        steps: definition.steps.map((step) =>
          step.id === edit.fromStepId ? editWorkflowStepBranch(step, edit) : step
        )
      };
  }
}

function addSemanticWorkflowNode(
  definition: WorkflowDefinition,
  edit: Extract<ConfigWorkflowSemanticEdit, { readonly kind: "add-node" }>,
  updatedAt: string
): WorkflowDefinition {
  const step = semanticStepDraftToWorkflowStep(edit.step);
  const afterIndex =
    edit.afterStepId === undefined
      ? -1
      : definition.steps.findIndex((candidate) => candidate.id === edit.afterStepId);
  const steps = [...definition.steps];
  steps.splice(afterIndex >= 0 ? afterIndex + 1 : steps.length, 0, step);

  return {
    ...definition,
    updatedAt,
    steps: steps.map((candidate) =>
      edit.afterStepId !== undefined && candidate.id === edit.afterStepId
        ? retargetStepNextToInsertedNode(candidate, step.id)
        : candidate
    )
  };
}

function deleteSemanticWorkflowNode(
  definition: WorkflowDefinition,
  stepId: string,
  updatedAt: string
): WorkflowDefinition {
  const steps = definition.steps
    .filter((step) => step.id !== stepId)
    .map((step) => removeReferencesToStep(step, stepId));
  const entryStepId =
    definition.entryStepId === stepId
      ? (steps[0]?.id ?? definition.entryStepId)
      : definition.entryStepId;

  return {
    ...definition,
    entryStepId,
    updatedAt,
    steps
  };
}

function semanticStepDraftToWorkflowStep(step: ConfigWorkflowSemanticStepDraft): WorkflowStep {
  return {
    id: step.id,
    kind: step.kind,
    ...(step.agentId === undefined ? {} : { agentId: step.agentId }),
    ...(step.pluginId === undefined ? {} : { pluginId: step.pluginId }),
    ...(step.contributionId === undefined ? {} : { contributionId: step.contributionId }),
    ...(step.nextStepId === undefined ? {} : { nextStepId: step.nextStepId }),
    ...(step.defaultNextStepId === undefined ? {} : { defaultNextStepId: step.defaultNextStepId }),
    ...(step.branches === undefined ? {} : { branches: step.branches })
  };
}

function retargetStepNextToInsertedNode(step: WorkflowStep, insertedStepId: string): WorkflowStep {
  return {
    ...step,
    nextStepId: insertedStepId
  };
}

function retargetWorkflowStepEdge(
  step: WorkflowStep,
  edit: Extract<ConfigWorkflowSemanticEdit, { readonly kind: "retarget-edge" }>
): WorkflowStep {
  if (edit.edgeKind === "next") {
    return edit.toStepId === undefined
      ? removeOptionalWorkflowStepField(step, "nextStepId")
      : { ...step, nextStepId: edit.toStepId };
  }

  return edit.toStepId === undefined
    ? removeOptionalWorkflowStepField(step, "defaultNextStepId")
    : { ...step, defaultNextStepId: edit.toStepId };
}

function editWorkflowStepBranch(
  step: WorkflowStep,
  edit: Extract<ConfigWorkflowSemanticEdit, { readonly kind: "edit-branch-edge" }>
): WorkflowStep {
  const branches = step.branches ?? [];
  const branchExists = branches.some((branch) => branch.id === edit.branchId);
  const nextBranch = {
    id: edit.branchId,
    label: edit.label,
    condition: edit.condition,
    nextStepId: edit.toStepId
  };

  return {
    ...step,
    branches: branchExists
      ? branches.map((branch) => (branch.id === edit.branchId ? nextBranch : branch))
      : [...branches, nextBranch]
  };
}

function removeReferencesToStep(step: WorkflowStep, deletedStepId: string): WorkflowStep {
  let next =
    step.nextStepId === deletedStepId ? removeOptionalWorkflowStepField(step, "nextStepId") : step;
  next =
    next.defaultNextStepId === deletedStepId
      ? removeOptionalWorkflowStepField(next, "defaultNextStepId")
      : next;
  if (next.branches?.some((branch) => branch.nextStepId === deletedStepId) === true) {
    return {
      ...next,
      branches: next.branches.filter((branch) => branch.nextStepId !== deletedStepId)
    };
  }

  return next;
}

function removeOptionalWorkflowStepField(
  step: WorkflowStep,
  key: "nextStepId" | "defaultNextStepId"
): WorkflowStep {
  const next: {
    -readonly [Key in keyof WorkflowStep]: WorkflowStep[Key];
  } = { ...step };
  if (key === "nextStepId") {
    delete next.nextStepId;
    return next as WorkflowStep;
  }

  delete next.defaultNextStepId;
  return next as WorkflowStep;
}

function applySemanticLayoutEdit(
  layout: ConfigWorkflowGraphLayout,
  edit: ConfigWorkflowSemanticEdit
): ConfigWorkflowGraphLayout {
  if (edit.kind !== "add-node" || edit.layout === undefined) {
    return layout;
  }

  return {
    ...layout,
    source: "draft",
    nodes: layout.nodes.map((node) =>
      node.nodeId === edit.step.id
        ? { nodeId: edit.step.id, x: edit.layout?.x ?? node.x, y: edit.layout?.y ?? node.y }
        : node
    )
  };
}

function productEditToSemanticEdit(
  definition: WorkflowDefinition,
  edit: ConfigWorkflowProductEdit
): ConfigWorkflowSemanticEdit {
  switch (edit.kind) {
    case "insert-node-after": {
      const afterStep = definition.steps.find((step) => step.id === edit.afterStepId);
      return {
        kind: "add-node",
        afterStepId: edit.afterStepId,
        step: {
          id: edit.stepId,
          kind: edit.stepKind,
          ...(afterStep?.nextStepId === undefined ? {} : { nextStepId: afterStep.nextStepId })
        },
        layout: {
          x: edit.x,
          y: edit.y
        }
      };
    }
    case "retarget-selected-edge": {
      const edge = parseWorkflowEdgeId(edit.edgeId);
      return {
        kind: "retarget-edge",
        fromStepId: edge.fromStepId,
        edgeKind: edge.edgeKind,
        toStepId: edit.toStepId
      };
    }
    case "edit-branch-form":
      return {
        kind: "edit-branch-edge",
        fromStepId: edit.fromStepId,
        branchId: edit.branchId,
        label: edit.label,
        condition: edit.condition,
        toStepId: edit.toStepId
      };
    case "confirm-delete-node":
      return {
        kind: "delete-node",
        stepId: edit.stepId
      };
  }
}

function parseWorkflowEdgeId(edgeId: string): {
  readonly fromStepId: string;
  readonly edgeKind: "next" | "default";
} {
  const [fromStepId, edgeKind] = edgeId.split(":");
  return {
    fromStepId: fromStepId ?? "",
    edgeKind: edgeKind === "default" ? "default" : "next"
  };
}
