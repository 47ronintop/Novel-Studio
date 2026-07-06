import {
  applyConfigWorkflowGraphLayoutEdit,
  applyConfigWorkflowGraphLayoutToContent,
  applyConfigWorkflowNodeInspectorEdit,
  createConfigWorkflowGraphLayout,
  type ConfigAssetType,
  type ConfigWorkflowGraphLayoutEdit,
  type ConfigWorkflowNodeInspectorEdit,
  type NovelStudioApi
} from "@novel-studio/application";
import type {
  ConfigStudioAsset,
  ConfigStudioAssetSummary,
  ConfigStudioPanelProps,
  ConfigStudioVersionEntry
} from "@novel-studio/ui";
import type { JsonObject } from "@novel-studio/shared";

const defaultAssets: readonly ConfigStudioAssetSummary[] = [
  {
    assetType: "prompt",
    assetId: "prompt_reviewer_default",
    title: "默认审稿 Prompt"
  },
  {
    assetType: "agent",
    assetId: "agent_reviewer_default",
    title: "默认审稿 Agent"
  },
  {
    assetType: "workflow",
    assetId: "wf_review_chapter",
    title: "审稿当前章节"
  }
];

export interface StudioBridge {
  getProps(): ConfigStudioPanelProps;
  load(): Promise<ConfigStudioPanelProps>;
  selectAsset(assetType: ConfigAssetType, assetId: string): Promise<ConfigStudioPanelProps>;
  updateContent(nextContent: string): ConfigStudioPanelProps;
  selectWorkflowNode(nodeId: string): ConfigStudioPanelProps;
  selectWorkflowEdge(edgeId: string): ConfigStudioPanelProps;
  applyWorkflowNodeEdit(edit: ConfigWorkflowNodeInspectorEdit): ConfigStudioPanelProps;
  updateWorkflowGraphLayout(edit: ConfigWorkflowGraphLayoutEdit): ConfigStudioPanelProps;
  commitWorkflowNodeDrag(edit: ConfigWorkflowGraphLayoutEdit): ConfigStudioPanelProps;
  beginSave(): ConfigStudioPanelProps;
  save(): Promise<ConfigStudioPanelProps>;
  beginRestore(): ConfigStudioPanelProps;
  restoreVersion(versionId: string): Promise<ConfigStudioPanelProps>;
}

export function createStudioBridge(api: NovelStudioApi): StudioBridge {
  let selectedAssetType: ConfigAssetType = "prompt";
  let selectedAssetId = "prompt_reviewer_default";
  let selectedAsset: ConfigStudioAsset = emptySelectedAsset();
  let versions: readonly ConfigStudioVersionEntry[] = [];
  let status: ConfigStudioPanelProps["status"] = "idle";
  let feedback: ConfigStudioPanelProps["feedback"] | undefined;
  let selectedWorkflowNodeId: string | undefined;
  let selectedWorkflowEdgeId: string | undefined;

  return {
    getProps: () => toProps(),
    async load() {
      return loadSelectedAsset("创作系统配置已加载。");
    },
    async selectAsset(assetType, assetId) {
      selectedAssetType = assetType;
      selectedAssetId = assetId;
      versions = [];
      selectedWorkflowNodeId = undefined;
      selectedWorkflowEdgeId = undefined;
      return loadSelectedAsset("配置资产已加载。");
    },
    updateContent(nextContent) {
      selectedAsset = {
        ...selectedAsset,
        content: nextContent,
        validationStatus: parseJsonObject(nextContent) === undefined ? "invalid" : "dirty"
      };
      status = "idle";
      feedback = undefined;
      return toProps();
    },
    selectWorkflowNode(nodeId) {
      if (selectedAsset.workflowGraph?.graph.nodes.some((node) => node.id === nodeId) === true) {
        selectedWorkflowNodeId = nodeId;
        selectedWorkflowEdgeId = undefined;
        feedback = undefined;
      }
      return toProps();
    },
    selectWorkflowEdge(edgeId) {
      if (selectedAsset.workflowGraph?.graph.edges.some((edge) => edge.id === edgeId) === true) {
        selectedWorkflowEdgeId = edgeId;
        feedback = undefined;
      }
      return toProps();
    },
    applyWorkflowNodeEdit(edit) {
      const content = parseJsonObject(selectedAsset.content);
      if (selectedAsset.assetType !== "workflow" || content === undefined) {
        selectedAsset = { ...selectedAsset, validationStatus: "invalid" };
        status = "error";
        feedback = {
          kind: "error",
          message: "Workflow JSON must be valid before editing inspector fields."
        };
        return toProps();
      }

      const result = applyConfigWorkflowNodeInspectorEdit({
        content,
        edit,
        now: () => new Date().toISOString()
      });
      if (!result.ok) {
        selectedAsset = { ...selectedAsset, validationStatus: "invalid" };
        status = "error";
        feedback = { kind: "error", message: result.error.message };
        return toProps();
      }

      selectedAsset = {
        ...selectedAsset,
        content: JSON.stringify(result.value.content, null, 2),
        validationStatus:
          result.value.workflowGraph.validation.status === "invalid" ? "invalid" : "dirty",
        workflowGraph: result.value.workflowGraph
      };
      selectedWorkflowNodeId = selectedWorkflowNodeIdForGraph(
        result.value.workflowGraph,
        selectedWorkflowNodeId ?? edit.stepId
      );
      selectedWorkflowEdgeId = selectedWorkflowEdgeIdForGraph(
        result.value.workflowGraph,
        selectedWorkflowEdgeId
      );
      status = "idle";
      feedback = undefined;
      return toProps();
    },
    updateWorkflowGraphLayout(edit) {
      const content = parseJsonObject(selectedAsset.content);
      if (selectedAsset.workflowGraph === undefined || content === undefined) {
        return toProps();
      }

      const persistedLayout = applyConfigWorkflowGraphLayoutToContent({
        content,
        edit
      });
      if (!persistedLayout.ok) {
        selectedAsset = { ...selectedAsset, validationStatus: "invalid" };
        status = "error";
        feedback = { kind: "error", message: persistedLayout.error.message };
        return toProps();
      }

      selectedAsset = {
        ...selectedAsset,
        validationStatus: selectedAsset.validationStatus === "invalid" ? "invalid" : "dirty",
        content: JSON.stringify(persistedLayout.value.content, null, 2),
        workflowGraph: applyConfigWorkflowGraphLayoutEdit(persistedLayout.value.workflowGraph, edit)
      };
      selectedWorkflowNodeId = selectedWorkflowNodeIdForGraph(
        selectedAsset.workflowGraph,
        edit.nodeId
      );
      selectedWorkflowEdgeId = undefined;
      status = "idle";
      feedback = undefined;
      return toProps();
    },
    commitWorkflowNodeDrag(edit) {
      return this.updateWorkflowGraphLayout(edit);
    },
    beginSave() {
      if (workflowGraphInvalid(selectedAsset)) {
        status = "error";
        feedback = {
          kind: "error",
          message: "Workflow graph validation failed. Fix validation issues before saving."
        };
        return toProps();
      }

      status = "saving";
      feedback = { kind: "info", message: "正在保存配置资产..." };
      return toProps();
    },
    async save() {
      const content = parseJsonObject(selectedAsset.content);
      if (content === undefined) {
        status = "error";
        selectedAsset = { ...selectedAsset, validationStatus: "invalid" };
        feedback = { kind: "error", message: "JSON 格式无效，修正后才能保存。" };
        return toProps();
      }

      if (workflowGraphInvalid(selectedAsset)) {
        status = "error";
        feedback = {
          kind: "error",
          message: "Workflow graph validation failed. Fix validation issues before saving."
        };
        return toProps();
      }

      status = "saving";
      const result = await api.studio.saveConfigAsset({
        assetType: selectedAsset.assetType,
        assetId: selectedAsset.assetId,
        content,
        createdBy: "user"
      });
      if (!result.ok) {
        status = "error";
        selectedAsset = { ...selectedAsset, validationStatus: "invalid" };
        feedback = { kind: "error", message: result.error.message };
        return toProps();
      }

      status = "saved";
      selectedAsset = {
        ...selectedAsset,
        title: titleFromContent(content, selectedAsset.title),
        validationStatus: "valid",
        content: JSON.stringify(content, null, 2)
      };
      versions = [
        {
          versionId: result.value.versionId,
          label: "Before save",
          createdAt: new Date().toISOString()
        },
        ...versions
      ];
      feedback = { kind: "info", message: "配置资产已保存。" };
      return toProps();
    },
    beginRestore() {
      status = "restoring";
      feedback = { kind: "info", message: "正在恢复配置版本..." };
      return toProps();
    },
    async restoreVersion(versionId) {
      status = "restoring";
      const result = await api.studio.restoreConfigAssetVersion({
        assetType: selectedAsset.assetType,
        assetId: selectedAsset.assetId,
        versionId,
        createdBy: "user"
      });
      if (!result.ok) {
        status = "error";
        feedback = { kind: "error", message: result.error.message };
        return toProps();
      }

      selectedAsset = assetFromSnapshot(
        result.value.assetType,
        result.value.assetId,
        result.value.content,
        result.value.workflowGraph
      );
      selectedWorkflowNodeId = selectedWorkflowNodeIdForGraph(
        result.value.workflowGraph,
        selectedWorkflowNodeId
      );
      selectedWorkflowEdgeId = selectedWorkflowEdgeIdForGraph(
        result.value.workflowGraph,
        selectedWorkflowEdgeId
      );
      status = "saved";
      feedback = { kind: "info", message: "配置版本已恢复。" };
      return toProps();
    }
  };

  async function loadSelectedAsset(successMessage: string): Promise<ConfigStudioPanelProps> {
    status = "loading";
    const result = await api.studio.loadConfigAsset(selectedAssetType, selectedAssetId);
    if (!result.ok) {
      status = "error";
      feedback = { kind: "error", message: result.error.message };
      return toProps();
    }

    selectedAsset = assetFromSnapshot(
      result.value.assetType,
      result.value.assetId,
      result.value.content,
      result.value.workflowGraph
    );
    selectedWorkflowNodeId = selectedWorkflowNodeIdForGraph(
      result.value.workflowGraph,
      selectedWorkflowNodeId
    );
    selectedWorkflowEdgeId = selectedWorkflowEdgeIdForGraph(
      result.value.workflowGraph,
      selectedWorkflowEdgeId
    );
    status = "idle";
    feedback = { kind: "info", message: successMessage };
    return toProps();
  }

  function toProps(): ConfigStudioPanelProps {
    return {
      assets: defaultAssets,
      selectedAsset,
      versions,
      status,
      ...(feedback === undefined ? {} : { feedback }),
      ...(selectedWorkflowNodeId === undefined ? {} : { selectedWorkflowNodeId }),
      ...(selectedWorkflowEdgeId === undefined ? {} : { selectedWorkflowEdgeId }),
      onAssetSelect: () => undefined,
      onContentChange: () => undefined,
      onWorkflowNodeSelect: () => undefined,
      onWorkflowEdgeSelect: () => undefined,
      onWorkflowLayoutChange: () => undefined,
      onWorkflowNodeDragCommit: () => undefined,
      onSave: () => undefined,
      onRestoreVersion: () => undefined
    };
  }
}

function emptySelectedAsset(): ConfigStudioAsset {
  return {
    assetType: "prompt",
    assetId: "prompt_reviewer_default",
    title: "默认审稿 Prompt",
    validationStatus: "dirty",
    content: "{}"
  };
}

function workflowGraphInvalid(asset: ConfigStudioAsset): boolean {
  return asset.workflowGraph?.validation.status === "invalid";
}

function selectedWorkflowNodeIdForGraph(
  workflowGraph: ConfigStudioAsset["workflowGraph"],
  preferredNodeId: string | undefined
): string | undefined {
  if (workflowGraph === undefined) {
    return undefined;
  }

  if (
    preferredNodeId !== undefined &&
    workflowGraph.graph.nodes.some((node) => node.id === preferredNodeId)
  ) {
    return preferredNodeId;
  }

  return workflowGraph.graph.entryNodeId;
}

function selectedWorkflowEdgeIdForGraph(
  workflowGraph: ConfigStudioAsset["workflowGraph"],
  preferredEdgeId: string | undefined
): string | undefined {
  if (workflowGraph === undefined || preferredEdgeId === undefined) {
    return undefined;
  }

  return workflowGraph.graph.edges.some((edge) => edge.id === preferredEdgeId)
    ? preferredEdgeId
    : undefined;
}

function assetFromSnapshot(
  assetType: ConfigAssetType,
  assetId: string,
  content: JsonObject,
  workflowGraph?: ConfigStudioAsset["workflowGraph"]
): ConfigStudioAsset {
  return {
    assetType,
    assetId,
    title: titleFromContent(content, assetId),
    validationStatus: "valid",
    content: JSON.stringify(content, null, 2),
    ...(workflowGraph === undefined
      ? {}
      : {
          workflowGraph: {
            ...workflowGraph,
            layout: workflowGraph.layout ?? createConfigWorkflowGraphLayout(workflowGraph.graph)
          }
        })
  };
}

function parseJsonObject(value: string): JsonObject | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isJsonObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function titleFromContent(content: JsonObject, fallback: string): string {
  const title = content["title"];
  return typeof title === "string" && title.length > 0 ? title : fallback;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
