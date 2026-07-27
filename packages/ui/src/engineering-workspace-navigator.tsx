import { RefreshCw } from "lucide-react";
import type {
  EngineeringWorkspaceTreeNode,
  EngineeringWorkspaceTreeSnapshot
} from "@novel-studio/application";

import { ProjectFileTree } from "./project-file-tree.js";

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
  return (
    <nav
      aria-label="工程资源管理器"
      className="ns-navigator ns-engineering-navigator"
      data-collapsed={collapsed}
      data-focus-hidden={focusHidden}
      data-region="navigator"
    >
      <div className="ns-panel-header">
        <span>{displayName}</span>
        <button
          aria-label="刷新工程目录"
          className="ns-icon-button"
          onClick={onRefresh}
          title="刷新工程目录"
          type="button"
        >
          <RefreshCw aria-hidden="true" size={14} />
        </button>
      </div>
      {tree.truncated ? (
        <p className="ns-engineering-truncated">列表已截断，请缩小目录范围</p>
      ) : null}
      <ProjectFileTree
        {...(activeFilePath === undefined ? {} : { activeFilePath })}
        expandedPathIds={expandedPathIds}
        nodes={tree.nodes as readonly EngineeringWorkspaceTreeNode[]}
        onExpandedPathIdsChange={onExpandedPathIdsChange}
        onFileOpen={onFileOpen}
      />
    </nav>
  );
}
