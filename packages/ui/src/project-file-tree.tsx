import { ChevronRight, FileText, FolderOpen, LockKeyhole } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

export interface ProjectFileTreeNode {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly kind: "file" | "directory";
  readonly children?: readonly ProjectFileTreeNode[];
  readonly readOnlyReason?: string;
}

export interface ProjectFileTreeProps {
  readonly nodes: readonly ProjectFileTreeNode[];
  readonly expandedPathIds: readonly string[];
  readonly activeFilePath?: string;
  readonly onExpandedPathIdsChange: (pathIds: readonly string[]) => void;
  readonly onFileOpen: (path: string) => void;
  readonly ariaLabel?: string;
}

export function ProjectFileTree(props: ProjectFileTreeProps) {
  const expanded = new Set(props.expandedPathIds);
  const toggle = (pathId: string) => {
    props.onExpandedPathIdsChange(
      expanded.has(pathId)
        ? props.expandedPathIds.filter((id) => id !== pathId)
        : [...props.expandedPathIds, pathId]
    );
  };

  return (
    <ul aria-label={props.ariaLabel} className="ns-engineering-tree" data-navigator-group="files">
      {props.nodes.map((node) => renderNode(node, 0))}
    </ul>
  );

  function renderNode(node: ProjectFileTreeNode, depth: number): ReactNode {
    const directory = node.kind === "directory";
    const pathId = `folder:${node.path}`;
    const isExpanded = expanded.has(pathId);
    const label =
      node.readOnlyReason === undefined
        ? node.name
        : `${node.name}（只读：${node.readOnlyReason}）`;
    return (
      <li
        className="ns-engineering-tree-item"
        key={node.id}
        style={{ "--ns-tree-depth": depth } as CSSProperties}
      >
        <button
          aria-expanded={directory ? isExpanded : undefined}
          aria-label={directory ? `展开目录：${node.name}` : `打开文件：${label}`}
          className="ns-engineering-tree-row"
          data-active={node.path === props.activeFilePath}
          onClick={() => (directory ? toggle(pathId) : props.onFileOpen(node.path))}
          title={node.readOnlyReason}
          type="button"
        >
          {directory ? (
            <ChevronRight
              aria-hidden="true"
              className="ns-tree-chevron"
              data-expanded={isExpanded}
              size={14}
            />
          ) : (
            <span className="ns-file-chevron-spacer" />
          )}
          {directory ? (
            <FolderOpen aria-hidden="true" size={14} />
          ) : (
            <FileText aria-hidden="true" size={14} />
          )}
          <span>{node.name}</span>
          {node.readOnlyReason === undefined ? null : (
            <LockKeyhole aria-label={node.readOnlyReason} size={13} />
          )}
        </button>
        {directory && isExpanded && node.children !== undefined ? (
          <ul className="ns-engineering-tree-children">
            {node.children.map((child) => renderNode(child, depth + 1))}
          </ul>
        ) : null}
      </li>
    );
  }
}
