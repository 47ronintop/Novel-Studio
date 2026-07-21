import type { ActivityId, NavigatorSection } from "@novel-studio/application";
import type { WorkbenchMode, WorkspaceContextDto } from "@novel-studio/shared";

import { CreativeWorkspaceNavigator } from "./creative-workspace-navigator.js";
import {
  EngineeringWorkspaceNavigator,
  type EngineeringWorkspaceNavigatorProps as FormalEngineeringWorkspaceNavigatorProps
} from "./engineering-workspace-navigator.js";
import type {
  CreativeWorkspaceNavigatorProps,
  ProjectFileTreeItemProps,
  ProjectWorkflowProps,
  StoryBibleEditorProps
} from "./workspace-shell-types.js";
import type { ConfigStudioPanelProps } from "./config-studio-panel.js";

export interface EngineeringWorkspaceNavigatorProps {
  readonly displayName?: string;
  readonly tree?: FormalEngineeringWorkspaceNavigatorProps["tree"];
  readonly expandedPathIds?: readonly string[] | undefined;
  readonly activeFilePath?: string | undefined;
  readonly onExpandedPathIdsChange?: ((pathIds: readonly string[]) => void) | undefined;
  readonly onFileOpen?: ((path: string) => void) | undefined;
  readonly onRefresh?: (() => void) | undefined;
  readonly activeActivity: ActivityId;
  readonly sections: readonly NavigatorSection[];
  readonly expandedSectionIds?: readonly string[] | undefined;
  readonly searchQuery?: string | undefined;
  readonly projectWorkflow?: ProjectWorkflowProps | undefined;
  readonly fileTree?: readonly ProjectFileTreeItemProps[] | undefined;
  readonly storyBibleEditor?: StoryBibleEditorProps | undefined;
  readonly studio?: ConfigStudioPanelProps | undefined;
  readonly collapsed?: boolean | undefined;
  readonly focusHidden?: boolean | undefined;
  readonly onSearchQueryChange?: ((query: string) => void) | undefined;
  readonly onExpandedSectionIdsChange?: ((sectionIds: readonly string[]) => void) | undefined;
  readonly onRenameChapter?: ProjectWorkflowProps["onRenameChapter"] | undefined;
  readonly onDuplicateChapter?: ProjectWorkflowProps["onDuplicateChapter"] | undefined;
  readonly onDeleteChapter?: ProjectWorkflowProps["onDeleteChapter"] | undefined;
  readonly onActivitySelect?: ((activityId: ActivityId) => void) | undefined;
}

export interface EmptyWorkspaceNavigatorProps {
  readonly onOpenProject?: (() => void) | undefined;
  readonly onOpenEngineeringWorkspace?: (() => void) | undefined;
  readonly onCreateProject?: (() => void) | undefined;
}

export interface WorkspaceNavigatorProps {
  readonly workspaceContext: WorkspaceContextDto;
  readonly workbenchMode?: WorkbenchMode;
  readonly creative?: CreativeWorkspaceNavigatorProps | undefined;
  readonly engineering?: EngineeringWorkspaceNavigatorProps | undefined;
  readonly none: EmptyWorkspaceNavigatorProps;
  readonly collapsed?: boolean | undefined;
  readonly focusHidden?: boolean | undefined;
}

export function WorkspaceNavigator({
  workspaceContext,
  workbenchMode,
  creative,
  engineering,
  collapsed = false,
  focusHidden = false
}: WorkspaceNavigatorProps) {
  const showEngineering =
    workspaceContext.kind === "engineeringWorkspace" ||
    (workbenchMode === "engineering" && engineering !== undefined);

  if (!showEngineering && workspaceContext.kind === "creativeProject") {
    return creative === undefined ? (
      <UnavailableWorkspaceNavigator
        collapsed={collapsed}
        focusHidden={focusHidden}
        message="正在加载创作导航"
      />
    ) : (
      <div
        className="ns-navigator-context"
        data-collapsed={collapsed}
        data-focus-hidden={focusHidden}
      >
        <CreativeWorkspaceNavigator {...creative} />
      </div>
    );
  }

  if (showEngineering) {
    if (engineering === undefined) {
      return (
        <UnavailableWorkspaceNavigator
          collapsed={collapsed}
          focusHidden={focusHidden}
          message="正在加载工程导航"
        />
      );
    }

    const tree = engineering.tree ?? {
      nodes: engineering.fileTree ?? [],
      truncated: false
    };
    return (
      <EngineeringWorkspaceNavigator
        displayName={
          engineering.displayName ??
          (workspaceContext.kind === "none" ? "工程目录" : workspaceContext.displayName)
        }
        tree={tree}
        expandedPathIds={engineering.expandedPathIds ?? engineering.expandedSectionIds ?? []}
        {...(engineering.activeFilePath === undefined
          ? {}
          : { activeFilePath: engineering.activeFilePath })}
        onExpandedPathIdsChange={engineering.onExpandedPathIdsChange ?? (() => undefined)}
        onFileOpen={
          engineering.onFileOpen ?? engineering.projectWorkflow?.onOpenFile ?? (() => undefined)
        }
        onRefresh={engineering.onRefresh ?? (() => undefined)}
        collapsed={collapsed}
        focusHidden={focusHidden}
      />
    );
  }

  return (
    <nav
      aria-label="工作区导航"
      className="ns-navigator ns-empty-workspace-navigator"
      data-collapsed={collapsed}
      data-focus-hidden={focusHidden}
      data-region="navigator"
    >
      <div className="ns-panel-header">
        <span>工作区</span>
      </div>
      <div className="ns-empty-workspace-actions">
        <p>尚未打开工作区</p>
        <p className="ns-muted">通过“文件”菜单新建创作项目或打开工程文件夹。</p>
      </div>
    </nav>
  );
}

function UnavailableWorkspaceNavigator({
  collapsed,
  focusHidden,
  message
}: {
  readonly collapsed: boolean;
  readonly focusHidden: boolean;
  readonly message: string;
}) {
  return (
    <nav
      aria-label="工作区导航"
      className="ns-navigator ns-empty-workspace-navigator"
      data-collapsed={collapsed}
      data-focus-hidden={focusHidden}
      data-region="navigator"
    >
      <div className="ns-panel-header">
        <span>工作区</span>
      </div>
      <div className="ns-empty-workspace-actions">
        <p>{message}</p>
      </div>
    </nav>
  );
}
