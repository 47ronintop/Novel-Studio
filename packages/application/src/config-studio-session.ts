import type { JsonObject, Result, UnifiedError } from "@novel-studio/shared";
import {
  buildWorkflowGraphViewModel,
  applyWorkflowNodeInspectorEdit,
  parseWorkflowDefinition,
  validateWorkflowGraph
} from "@novel-studio/workflow-engine";
import type {
  WorkflowNodeInspectorEdit,
  WorkflowGraphViewModel,
  WorkflowValidationReport
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
