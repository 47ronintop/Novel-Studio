import { ChevronRight, FileText, FolderOpen, LockKeyhole, RefreshCw } from "lucide-react";
import type { EngineeringWorkspaceTreeNode, EngineeringWorkspaceTreeSnapshot } from "@novel-studio/application";
import type { CSSProperties, ReactNode } from "react";

export interface EngineeringWorkspaceNavigatorProps {
  readonly displayName: string;
  readonly tree: EngineeringWorkspaceTreeSnapshot;
  readonly expandedPathIds: readonly string[];
  readonly activeFilePath?: string;
  readonly onExpandedPathIdsChange: (pathIds: readonly string[]) => void;
  readonly onFileOpen: (path: string) => void;
  readonly onRefresh: () => void;
  readonly collapsed?: boolean;
  readonly focusHidden?: boolean;
}

export function EngineeringWorkspaceNavigator({
  displayName,
  tree,
  expandedPathIds,
  activeFilePath,
  onExpandedPathIdsChange,
  onFileOpen,
  onRefresh,
  collapsed = false,
  focusHidden = false
}: EngineeringWorkspaceNavigatorProps) {
  const expanded = new Set(expandedPathIds);
  const toggle = (pathId: string) => {
    onExpandedPathIdsChange(
      expanded.has(pathId)
        ? expandedPathIds.filter((id) => id !== pathId)
        : [...expandedPathIds, pathId]
    );
  };

  return (
    <nav aria-label="工程资源管理器" className="ns-navigator ns-engineering-navigator" data-collapsed={collapsed} data-focus-hidden={focusHidden} data-region="navigator">
      <div className="ns-panel-header">
        <span>{displayName}</span>
        <button aria-label="刷新工程目录" className="ns-icon-button" onClick={onRefresh} title="刷新工程目录" type="button">
          <RefreshCw aria-hidden="true" size={14} />
        </button>
      </div>
      {tree.truncated ? <p className="ns-engineering-truncated">列表已截断，请缩小目录范围</p> : null}
      <ul className="ns-engineering-tree" data-navigator-group="files">
        {tree.nodes.map((node) => renderNode(node, 0))}
      </ul>
    </nav>
  );

  function renderNode(node: EngineeringWorkspaceTreeNode, depth: number): ReactNode {
    const directory = node.kind === "directory";
    const pathId = `folder:${node.path}`;
    const isExpanded = expanded.has(pathId);
    const reason = node.readOnlyReason;
    const label = reason === undefined ? node.name : `${node.name}（只读：${reason}）`;
    return (
      <li className="ns-engineering-tree-item" key={node.id} style={{ "--ns-tree-depth": depth } as CSSProperties}>
        <button
          aria-expanded={directory ? isExpanded : undefined}
          aria-label={directory ? `展开目录：${node.name}` : `打开文件：${label}`}
          className="ns-engineering-tree-row"
          data-active={node.path === activeFilePath}
          onClick={() => (directory ? toggle(pathId) : onFileOpen(node.path))}
          title={reason}
          type="button"
        >
          {directory ? <ChevronRight aria-hidden="true" className="ns-tree-chevron" data-expanded={isExpanded} size={14} /> : <span className="ns-file-chevron-spacer" />}
          {directory ? <FolderOpen aria-hidden="true" size={14} /> : <FileText aria-hidden="true" size={14} />}
          <span>{node.name}</span>
          {reason === undefined ? null : <LockKeyhole aria-label={reason} size={13} />}
        </button>
        {directory && isExpanded && node.children !== undefined ? (
          <ul className="ns-engineering-tree-children">{node.children.map((child) => renderNode(child, depth + 1))}</ul>
        ) : null}
      </li>
    );
  }
}
