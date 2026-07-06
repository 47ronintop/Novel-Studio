import type { CSSProperties } from "react";
import { useState } from "react";
import { Boxes, RotateCcw, Save } from "lucide-react";
import type {
  ConfigWorkflowDesignerAvailability,
  ConfigWorkflowGraphLayoutEdit,
  ConfigWorkflowGraphSnapshot,
  ConfigWorkflowSemanticEdit
} from "@novel-studio/application";

export type ConfigStudioAssetType = "prompt" | "agent" | "workflow";
export type ConfigValidationStatus = "valid" | "invalid" | "dirty";
export type ConfigStudioStatus = "idle" | "loading" | "saving" | "saved" | "restoring" | "error";

export interface ConfigStudioAssetSummary {
  readonly assetType: ConfigStudioAssetType;
  readonly assetId: string;
  readonly title: string;
}

export interface ConfigStudioAsset {
  readonly assetType: ConfigStudioAssetType;
  readonly assetId: string;
  readonly title: string;
  readonly validationStatus: ConfigValidationStatus;
  readonly content: string;
  readonly workflowGraph?: ConfigWorkflowGraphSnapshot;
}

export interface ConfigStudioVersionEntry {
  readonly versionId: string;
  readonly label: string;
  readonly createdAt: string;
}

export interface ConfigStudioWorkflowNodeEdit {
  readonly stepId: string;
  readonly agentId?: string;
  readonly pluginId?: string;
  readonly contributionId?: string;
  readonly nextStepId?: string;
  readonly defaultNextStepId?: string;
}

type WorkflowEditableNodeKind = "context" | "agent" | "confirmation" | "save" | "branch" | "plugin";

export interface ConfigStudioPanelProps {
  readonly assets: readonly ConfigStudioAssetSummary[];
  readonly selectedAsset: ConfigStudioAsset;
  readonly versions: readonly ConfigStudioVersionEntry[];
  readonly status: ConfigStudioStatus;
  readonly feedback?: { readonly kind: "info" | "error"; readonly message: string };
  readonly selectedWorkflowNodeId?: string;
  readonly selectedWorkflowEdgeId?: string;
  readonly onAssetSelect?: (assetType: ConfigStudioAssetType, assetId: string) => void;
  readonly onContentChange?: (nextContent: string) => void;
  readonly onWorkflowNodeSelect?: (nodeId: string) => void;
  readonly onWorkflowEdgeSelect?: (edgeId: string) => void;
  readonly onWorkflowNodeEdit?: (edit: ConfigStudioWorkflowNodeEdit) => void;
  readonly onWorkflowSemanticEdit?: (edit: ConfigWorkflowSemanticEdit) => void;
  readonly onWorkflowLayoutChange?: (edit: ConfigWorkflowGraphLayoutEdit) => void;
  readonly onWorkflowNodeDragCommit?: (edit: ConfigWorkflowGraphLayoutEdit) => void;
  readonly onSave?: () => void;
  readonly onRestoreVersion?: (versionId: string) => void;
}

export function ConfigStudioPanel({
  assets,
  selectedAsset,
  versions,
  status,
  feedback,
  selectedWorkflowNodeId,
  selectedWorkflowEdgeId,
  onAssetSelect,
  onContentChange,
  onWorkflowNodeSelect,
  onWorkflowEdgeSelect,
  onWorkflowNodeEdit,
  onWorkflowSemanticEdit,
  onWorkflowLayoutChange,
  onWorkflowNodeDragCommit,
  onSave,
  onRestoreVersion
}: ConfigStudioPanelProps) {
  const saveDisabled =
    status === "saving" ||
    selectedAsset.validationStatus === "invalid" ||
    selectedAsset.workflowGraph?.validation.status === "invalid";

  return (
    <section className="config-studio-panel" aria-label="创作系统工作台">
      <header className="config-studio-header">
        <div>
          <h1>创作系统</h1>
          <p>管理 AI 写作提示词、Agent 和工作流。这里是高级配置区，正文写作不会被打断。</p>
        </div>
        <span className="config-studio-status">{statusLabel(status)}</span>
      </header>

      <div className="config-studio-grid">
        <aside className="config-studio-assets" aria-label="配置资产列表">
          <div className="config-studio-section-title">
            <Boxes aria-hidden="true" size={14} />
            <span>配置资产</span>
          </div>
          {assets.map((asset) => {
            const selected =
              asset.assetType === selectedAsset.assetType &&
              asset.assetId === selectedAsset.assetId;
            return (
              <button
                aria-label={`选择配置资产 ${asset.title}`}
                className="config-studio-asset-button"
                data-asset-type={asset.assetType}
                data-selected={selected}
                key={`${asset.assetType}:${asset.assetId}`}
                onClick={() => onAssetSelect?.(asset.assetType, asset.assetId)}
                type="button"
              >
                <span>{asset.title}</span>
                <span>{assetTypeLabel(asset.assetType)}</span>
              </button>
            );
          })}
        </aside>

        <main className="config-studio-editor" aria-label="配置资产编辑器">
          <div className="config-studio-editor-header">
            <div>
              <h2>{selectedAsset.title}</h2>
              <p>
                {assetTypeLabel(selectedAsset.assetType)} · {selectedAsset.assetId}
              </p>
            </div>
            <span>{validationLabel(selectedAsset.validationStatus)}</span>
            <button
              className="ns-icon-text-button"
              disabled={saveDisabled}
              type="button"
              aria-label="保存配置资产"
              onClick={() => onSave?.()}
            >
              <Save aria-hidden="true" size={14} />
              {status === "saving" ? "保存中" : "保存配置资产"}
            </button>
          </div>
          {feedback === undefined ? null : (
            <p className="ns-project-feedback" data-kind={feedback.kind} role="status">
              {feedback.message}
            </p>
          )}
          <textarea
            aria-label={`${assetTypeLabel(selectedAsset.assetType)} JSON 编辑器`}
            value={selectedAsset.content}
            onChange={(event) => onContentChange?.(event.currentTarget.value)}
            readOnly={onContentChange === undefined}
          />
          {selectedAsset.workflowGraph === undefined ? null : (
            <WorkflowGraphPreview
              workflowGraph={selectedAsset.workflowGraph}
              {...(selectedWorkflowNodeId === undefined ? {} : { selectedWorkflowNodeId })}
              {...(selectedWorkflowEdgeId === undefined ? {} : { selectedWorkflowEdgeId })}
              {...(onWorkflowNodeSelect === undefined ? {} : { onWorkflowNodeSelect })}
              {...(onWorkflowEdgeSelect === undefined ? {} : { onWorkflowEdgeSelect })}
              {...(onWorkflowNodeEdit === undefined ? {} : { onWorkflowNodeEdit })}
              {...(onWorkflowSemanticEdit === undefined ? {} : { onWorkflowSemanticEdit })}
              {...(onWorkflowLayoutChange === undefined ? {} : { onWorkflowLayoutChange })}
              {...(onWorkflowNodeDragCommit === undefined ? {} : { onWorkflowNodeDragCommit })}
            />
          )}
        </main>

        <aside className="config-studio-versions" aria-label="配置版本历史">
          <h3>版本历史</h3>
          {versions.length === 0 ? (
            <p>保存后会在这里显示可恢复的历史快照。</p>
          ) : (
            versions.map((version) => (
              <article key={version.versionId}>
                <span>{version.label}</span>
                <time dateTime={version.createdAt}>{formatDate(version.createdAt)}</time>
                <button
                  type="button"
                  aria-label={`恢复配置版本 ${version.label}`}
                  onClick={() => onRestoreVersion?.(version.versionId)}
                >
                  <RotateCcw aria-hidden="true" size={14} />
                </button>
              </article>
            ))
          )}
        </aside>
      </div>
    </section>
  );
}

function validationLabel(status: ConfigValidationStatus): string {
  switch (status) {
    case "valid":
      return "Schema 有效";
    case "invalid":
      return "Schema 无效";
    case "dirty":
      return "有未保存修改";
  }
}

function WorkflowGraphPreview({
  workflowGraph,
  selectedWorkflowNodeId,
  selectedWorkflowEdgeId,
  onWorkflowNodeSelect,
  onWorkflowEdgeSelect,
  onWorkflowNodeEdit,
  onWorkflowSemanticEdit,
  onWorkflowLayoutChange,
  onWorkflowNodeDragCommit
}: {
  readonly workflowGraph: ConfigWorkflowGraphSnapshot;
  readonly selectedWorkflowNodeId?: string;
  readonly selectedWorkflowEdgeId?: string;
  readonly onWorkflowNodeSelect?: (nodeId: string) => void;
  readonly onWorkflowEdgeSelect?: (edgeId: string) => void;
  readonly onWorkflowNodeEdit?: (edit: ConfigStudioWorkflowNodeEdit) => void;
  readonly onWorkflowSemanticEdit?: (edit: ConfigWorkflowSemanticEdit) => void;
  readonly onWorkflowLayoutChange?: (edit: ConfigWorkflowGraphLayoutEdit) => void;
  readonly onWorkflowNodeDragCommit?: (edit: ConfigWorkflowGraphLayoutEdit) => void;
}) {
  const activeNodeId = selectedWorkflowNodeId ?? workflowGraph.graph.entryNodeId;
  const availability = createWorkflowDesignerAvailability(workflowGraph);
  const layoutByNodeId = new Map(
    workflowGraph.layout?.nodes.map((node) => [node.nodeId, node] as const) ?? []
  );

  return (
    <section className="config-studio-workflow-graph" aria-label="Workflow graph preview">
      <header>
        <h3>{workflowGraph.graph.title}</h3>
        <span>校验：{workflowValidationLabel(workflowGraph.validation.status)}</span>
      </header>
      <div className="config-studio-graph-stats">
        <span>节点 {workflowGraph.graph.nodes.length}</span>
        <span>连线 {workflowGraph.graph.edges.length}</span>
      </div>
      <WorkflowDesignerAvailabilityBanner availability={availability} />
      <ol
        aria-label="Workflow designer canvas"
        className="config-studio-workflow-canvas"
        data-designer-status={availability.status}
      >
        {workflowGraph.graph.nodes.map((node, index) => {
          const layout = layoutByNodeId.get(node.id) ?? {
            nodeId: node.id,
            x: index * 220,
            y: 0
          };
          const canvasStyle = {
            "--canvas-x": `${layout.x}px`,
            "--canvas-y": `${layout.y}px`
          } as CSSProperties;
          return (
            <li
              data-canvas-x={layout.x}
              data-canvas-y={layout.y}
              data-layout-x={layout.x}
              data-layout-y={layout.y}
              key={node.id}
              style={canvasStyle}
            >
              <button
                aria-label={`Select workflow node ${node.id}`}
                data-selected-node={node.id === activeNodeId}
                onClick={() => onWorkflowNodeSelect?.(node.id)}
                type="button"
              >
                <span>{node.label}</span>
                <span>{node.kind}</span>
              </button>
              <button
                aria-label={`Move workflow node ${node.id} right`}
                disabled={!availability.canDragNodes}
                onClick={() =>
                  onWorkflowLayoutChange?.({
                    nodeId: node.id,
                    x: layout.x + 120,
                    y: layout.y
                  })
                }
                type="button"
              >
                右移
              </button>
              <button
                aria-label={`Move workflow node ${node.id} left`}
                disabled={!availability.canDragNodes}
                onClick={() =>
                  onWorkflowLayoutChange?.({
                    nodeId: node.id,
                    x: layout.x - 120,
                    y: layout.y
                  })
                }
                type="button"
              >
                左移
              </button>
              <button
                aria-label={`Move workflow node ${node.id} down`}
                disabled={!availability.canDragNodes}
                onClick={() =>
                  onWorkflowLayoutChange?.({
                    nodeId: node.id,
                    x: layout.x,
                    y: layout.y + 80
                  })
                }
                type="button"
              >
                下移
              </button>
              <button
                aria-label={`Move workflow node ${node.id} up`}
                disabled={!availability.canDragNodes}
                onClick={() =>
                  onWorkflowLayoutChange?.({
                    nodeId: node.id,
                    x: layout.x,
                    y: layout.y - 80
                  })
                }
                type="button"
              >
                上移
              </button>
              <button
                aria-label={`Commit workflow node drag ${node.id}`}
                disabled={!availability.canDragNodes}
                onClick={() =>
                  onWorkflowNodeDragCommit?.({
                    nodeId: node.id,
                    x: layout.x,
                    y: layout.y
                  })
                }
                type="button"
              >
                保存位置
              </button>
            </li>
          );
        })}
      </ol>
      <ol aria-label="Workflow graph edges">
        {workflowGraph.graph.edges.map((edge) => (
          <li key={edge.id}>
            <button
              aria-label={`Select workflow edge ${edge.id}`}
              data-selected-edge={edge.id === selectedWorkflowEdgeId}
              disabled={!availability.canSelectEdges}
              onClick={() => onWorkflowEdgeSelect?.(edge.id)}
              type="button"
            >
              {edge.fromNodeId} {"\u2192"} {edge.toNodeId}
            </button>
          </li>
        ))}
      </ol>
      {workflowGraph.validation.issues.length === 0 ? null : (
        <ol aria-label="Workflow graph validation issues">
          {workflowGraph.validation.issues.map((issue) => (
            <li key={`${issue.stepId}:${issue.code}`}>
              {issue.code}: {issue.message}
            </li>
          ))}
        </ol>
      )}
      <WorkflowNodeInspector
        workflowGraph={workflowGraph}
        selectedWorkflowNodeId={activeNodeId}
        {...(onWorkflowNodeEdit === undefined ? {} : { onWorkflowNodeEdit })}
        {...(onWorkflowSemanticEdit === undefined ? {} : { onWorkflowSemanticEdit })}
      />
    </section>
  );
}

function createWorkflowDesignerAvailability(
  workflowGraph: ConfigWorkflowGraphSnapshot
): ConfigWorkflowDesignerAvailability {
  const blockerMessages = [
    ...workflowGraph.validation.issues.map((issue) => issue.message),
    ...(workflowGraph.layout === undefined ? ["缺少工作流画布布局。"] : [])
  ];
  const ready = blockerMessages.length === 0;

  return {
    status: ready ? "ready" : "blocked",
    message: ready ? "工作流画布可编辑" : "工作流画布暂不可编辑",
    blockerMessages,
    nodeCount: workflowGraph.graph.nodes.length,
    edgeCount: workflowGraph.graph.edges.length,
    canDragNodes: ready,
    canSelectEdges: ready
  };
}

function WorkflowDesignerAvailabilityBanner({
  availability
}: {
  readonly availability: ConfigWorkflowDesignerAvailability;
}) {
  return (
    <section
      aria-label={availability.message}
      className="config-studio-workflow-availability"
      data-status={availability.status}
    >
      <span>{availability.message}</span>
      <span>
        {availability.nodeCount} 个节点 / {availability.edgeCount} 条连线
      </span>
      {availability.blockerMessages.length === 0 ? null : (
        <ol aria-label="Workflow designer blockers">
          {availability.blockerMessages.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ol>
      )}
    </section>
  );
}

function WorkflowNodeInspector({
  workflowGraph,
  selectedWorkflowNodeId,
  onWorkflowNodeEdit,
  onWorkflowSemanticEdit
}: {
  readonly workflowGraph: ConfigWorkflowGraphSnapshot;
  readonly selectedWorkflowNodeId?: string;
  readonly onWorkflowNodeEdit?: (edit: ConfigStudioWorkflowNodeEdit) => void;
  readonly onWorkflowSemanticEdit?: (edit: ConfigWorkflowSemanticEdit) => void;
}) {
  const selectedNode =
    workflowGraph.graph.nodes.find((node) => node.id === selectedWorkflowNodeId) ??
    workflowGraph.graph.nodes.find((node) => node.id === workflowGraph.graph.entryNodeId) ??
    workflowGraph.graph.nodes[0];

  if (selectedNode === undefined) {
    return null;
  }

  const incomingEdges = workflowGraph.graph.edges.filter(
    (edge) => edge.toNodeId === selectedNode.id
  );
  const outgoingEdges = workflowGraph.graph.edges.filter(
    (edge) => edge.fromNodeId === selectedNode.id
  );
  const nextStepId = outgoingEdges.find((edge) => edge.kind === "next")?.toNodeId ?? "";
  const defaultNextStepId =
    outgoingEdges.find((edge) => edge.kind === "default")?.toNodeId ??
    selectedNode.metadata.defaultNextStepId ??
    "";
  const editableEdge = incomingEdges[0] ?? outgoingEdges[0];
  const [newNodeKind, setNewNodeKind] = useState<WorkflowEditableNodeKind>("confirmation");
  const [edgeTarget, setEdgeTarget] = useState(defaultNextStepId || nextStepId || selectedNode.id);
  const [branchLabel, setBranchLabel] = useState("需要确认");
  const [branchCondition, setBranchCondition] = useState("manual:needs-review");

  return (
    <section className="config-studio-workflow-inspector" aria-label="Workflow node inspector">
      <h4>当前节点：{selectedNode.label}</h4>
      <p>类型：{workflowNodeKindLabel(selectedNode.kind)}</p>
      <p>元数据：{JSON.stringify(selectedNode.metadata)}</p>
      <div className="config-studio-workflow-semantic-actions">
        <label>
          <span>节点类型</span>
          <select
            aria-label="Workflow new node kind"
            value={newNodeKind}
            onChange={(event) =>
              setNewNodeKind(event.currentTarget.value as WorkflowEditableNodeKind)
            }
          >
            <option value="context">上下文</option>
            <option value="agent">Agent</option>
            <option value="confirmation">确认</option>
            <option value="save">保存</option>
            <option value="branch">分支</option>
            <option value="plugin">插件</option>
          </select>
        </label>
        <button
          aria-label={`Add selected workflow node kind after ${selectedNode.id}`}
          disabled={onWorkflowSemanticEdit === undefined}
          onClick={() =>
            onWorkflowSemanticEdit?.({
              kind: "add-node",
              afterStepId: selectedNode.stepId,
              step: {
                id: `${selectedNode.stepId}_${newNodeKind}`,
                kind: newNodeKind,
                ...((nextStepId || defaultNextStepId).length === 0
                  ? {}
                  : { nextStepId: nextStepId || defaultNextStepId })
              },
              layout: {
                x: 0,
                y: 120
              }
            })
          }
          type="button"
        >
          添加所选类型
        </button>
        <button
          aria-label={`Add confirmation node after ${selectedNode.id}`}
          disabled={onWorkflowSemanticEdit === undefined}
          onClick={() =>
            onWorkflowSemanticEdit?.({
              kind: "add-node",
              afterStepId: selectedNode.stepId,
              step: {
                id: `${selectedNode.stepId}_confirmation`,
                kind: "confirmation",
                ...((nextStepId || defaultNextStepId).length === 0
                  ? {}
                  : { nextStepId: nextStepId || defaultNextStepId })
              },
              layout: {
                x: 0,
                y: 120
              }
            })
          }
          type="button"
        >
          添加确认节点
        </button>
        <button
          aria-label={`Confirm delete workflow node ${selectedNode.id}`}
          disabled={onWorkflowSemanticEdit === undefined}
          onClick={() =>
            onWorkflowSemanticEdit?.({
              kind: "delete-node",
              stepId: selectedNode.stepId
            })
          }
          type="button"
        >
          确认删除
        </button>
        <button
          aria-label={`Delete workflow node ${selectedNode.id}`}
          disabled={onWorkflowSemanticEdit === undefined}
          onClick={() =>
            onWorkflowSemanticEdit?.({
              kind: "delete-node",
              stepId: selectedNode.stepId
            })
          }
          type="button"
        >
          删除节点
        </button>
      </div>
      <div className="config-studio-workflow-product-actions">
        <label>
          <span>调整到</span>
          <input
            aria-label="Workflow edge retarget target"
            value={edgeTarget}
            onChange={(event) => setEdgeTarget(event.currentTarget.value)}
          />
        </label>
        <button
          aria-label={`Retarget workflow edge ${editableEdge?.id ?? selectedNode.id}`}
          disabled={onWorkflowSemanticEdit === undefined || editableEdge === undefined}
          onClick={() => {
            if (editableEdge === undefined) {
              return;
            }
            onWorkflowSemanticEdit?.({
              kind: "retarget-edge",
              fromStepId: editableEdge.fromNodeId,
              edgeKind: editableEdge.kind === "default" ? "default" : "next",
              toStepId: edgeTarget
            });
          }}
          type="button"
        >
          更新连线
        </button>
        <label>
          <span>分支名称</span>
          <input
            aria-label="Workflow branch label"
            value={branchLabel}
            onChange={(event) => setBranchLabel(event.currentTarget.value)}
          />
        </label>
        <label>
          <span>分支条件</span>
          <input
            aria-label="Workflow branch condition"
            value={branchCondition}
            onChange={(event) => setBranchCondition(event.currentTarget.value)}
          />
        </label>
        <button
          aria-label={`Apply workflow branch edit for ${selectedNode.id}`}
          disabled={onWorkflowSemanticEdit === undefined}
          onClick={() =>
            onWorkflowSemanticEdit?.({
              kind: "edit-branch-edge",
              fromStepId: selectedNode.stepId,
              branchId: `${selectedNode.stepId}_branch`,
              label: branchLabel,
              condition: branchCondition,
              toStepId: edgeTarget
            })
          }
          type="button"
        >
          应用分支
        </button>
      </div>
      <div className="config-studio-workflow-inspector-fields">
        <label>
          <span>下一步</span>
          <input
            aria-label="Workflow node next step"
            name="nextStepId"
            readOnly={onWorkflowNodeEdit === undefined}
            value={nextStepId}
            onChange={(event) =>
              onWorkflowNodeEdit?.({
                stepId: selectedNode.stepId,
                nextStepId: event.currentTarget.value
              })
            }
          />
        </label>
        {selectedNode.kind === "agent" ? (
          <label>
            <span>Agent</span>
            <input
              aria-label="Workflow node agent"
              name="agentId"
              readOnly={onWorkflowNodeEdit === undefined}
              value={selectedNode.metadata.agentId ?? ""}
              onChange={(event) =>
                onWorkflowNodeEdit?.({
                  stepId: selectedNode.stepId,
                  agentId: event.currentTarget.value
                })
              }
            />
          </label>
        ) : null}
        {selectedNode.kind === "plugin" ? (
          <>
            <label>
              <span>插件</span>
              <input
                aria-label="Workflow node plugin"
                name="pluginId"
                readOnly={onWorkflowNodeEdit === undefined}
                value={selectedNode.metadata.pluginId ?? ""}
                onChange={(event) =>
                  onWorkflowNodeEdit?.({
                    stepId: selectedNode.stepId,
                    pluginId: event.currentTarget.value
                  })
                }
              />
            </label>
            <label>
              <span>贡献点</span>
              <input
                aria-label="Workflow node contribution"
                name="contributionId"
                readOnly={onWorkflowNodeEdit === undefined}
                value={selectedNode.metadata.contributionId ?? ""}
                onChange={(event) =>
                  onWorkflowNodeEdit?.({
                    stepId: selectedNode.stepId,
                    contributionId: event.currentTarget.value
                  })
                }
              />
            </label>
          </>
        ) : null}
        {selectedNode.kind === "branch" ? (
          <label>
            <span>默认下一步</span>
            <input
              aria-label="Workflow node default next step"
              name="defaultNextStepId"
              readOnly={onWorkflowNodeEdit === undefined}
              value={defaultNextStepId}
              onChange={(event) =>
                onWorkflowNodeEdit?.({
                  stepId: selectedNode.stepId,
                  defaultNextStepId: event.currentTarget.value
                })
              }
            />
          </label>
        ) : null}
      </div>
      <ol aria-label="Workflow node outgoing edges">
        {outgoingEdges.map((edge) => (
          <li key={edge.id}>
            出站 {edge.fromNodeId} {"\u2192"} {edge.toNodeId}
          </li>
        ))}
      </ol>
      <ol aria-label="Workflow node incoming edges">
        {incomingEdges.map((edge) => (
          <li key={edge.id}>
            入站 {edge.fromNodeId} {"\u2192"} {edge.toNodeId}
          </li>
        ))}
      </ol>
    </section>
  );
}

function workflowValidationLabel(
  status: ConfigWorkflowGraphSnapshot["validation"]["status"]
): string {
  switch (status) {
    case "valid":
      return "通过";
    case "invalid":
      return "有问题";
    default:
      return status;
  }
}

function workflowNodeKindLabel(kind: string): string {
  switch (kind) {
    case "context":
      return "上下文";
    case "agent":
      return "Agent";
    case "confirmation":
      return "确认";
    case "save":
      return "保存";
    case "branch":
      return "分支";
    case "plugin":
      return "插件";
    default:
      return kind;
  }
}

function assetTypeLabel(assetType: ConfigStudioAssetType): string {
  switch (assetType) {
    case "prompt":
      return "提示词";
    case "agent":
      return "Agent";
    case "workflow":
      return "工作流";
  }
}

function statusLabel(status: ConfigStudioStatus): string {
  switch (status) {
    case "idle":
      return "空闲";
    case "loading":
      return "加载中";
    case "saving":
      return "保存中";
    case "saved":
      return "已保存";
    case "restoring":
      return "恢复中";
    case "error":
      return "需要处理";
  }
}

function formatDate(value: string): string {
  return `${value.slice(0, 10)} ${value.slice(11, 16)}`;
}
