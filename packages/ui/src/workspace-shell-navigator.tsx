import type { ActivityId, DesktopShellState } from "@novel-studio/application";

import type { ConfigStudioPanelProps } from "./config-studio-panel.js";
import { WorkspaceNavigator } from "./workspace-navigator.js";
import type { EngineeringWorkspaceNavigatorProps as FormalEngineeringWorkspaceNavigatorProps } from "./engineering-workspace-navigator.js";
import type {
  CreativeWorkspaceNavigatorProps,
  ProjectWorkflowProps,
  StoryBibleEditorProps,
  WorkspaceShellProps
} from "./workspace-shell-types.js";

interface WorkspaceShellNavigatorProps {
  readonly shellState: DesktopShellState;
  readonly creative?: CreativeWorkspaceNavigatorProps | undefined;
  readonly projectWorkflow?: ProjectWorkflowProps | undefined;
  readonly storyBibleEditor?: StoryBibleEditorProps | undefined;
  readonly studio?: ConfigStudioPanelProps | undefined;
  readonly engineeringNavigator?: FormalEngineeringWorkspaceNavigatorProps | undefined;
  readonly onOpenEngineeringWorkspace?: (() => void) | undefined;
  readonly navigatorSearchQuery?: string | undefined;
  readonly collapsed: boolean;
  readonly focusHidden: boolean;
  readonly onActivitySelect?: ((activityId: ActivityId) => void) | undefined;
  readonly onNavigatorSearchQueryChange?:
    WorkspaceShellProps["onNavigatorSearchQueryChange"] | undefined;
  readonly onNavigatorExpandedSectionIdsChange?:
    WorkspaceShellProps["onNavigatorExpandedSectionIdsChange"] | undefined;
}

export function WorkspaceShellNavigator({
  shellState,
  creative,
  projectWorkflow,
  storyBibleEditor,
  studio,
  engineeringNavigator,
  onOpenEngineeringWorkspace,
  navigatorSearchQuery,
  collapsed,
  focusHidden,
  onActivitySelect,
  onNavigatorSearchQueryChange,
  onNavigatorExpandedSectionIdsChange
}: WorkspaceShellNavigatorProps) {
  return (
    <WorkspaceNavigator
      collapsed={collapsed}
      creative={shellState.workspaceContext.kind === "creativeProject" ? creative : undefined}
      engineering={
        shellState.workspaceContext.kind === "engineeringWorkspace" && engineeringNavigator === undefined
          ? {
              activeActivity: shellState.activeActivity,
              expandedSectionIds: shellState.navigatorExpandedSectionIds,
              onActivitySelect,
              onExpandedSectionIdsChange: onNavigatorExpandedSectionIdsChange,
              onSearchQueryChange: onNavigatorSearchQueryChange,
              projectWorkflow,
              searchQuery: navigatorSearchQuery,
              sections: shellState.navigatorSections,
              storyBibleEditor,
              studio
            }
          : undefined
      }
      {...(engineeringNavigator === undefined
        ? {}
        : {
            engineering: {
              ...engineeringNavigator,
              activeActivity: shellState.activeActivity,
              sections: []
            }
          })}
      focusHidden={focusHidden}
      workbenchMode={shellState.workbenchMode}
      none={{
        onCreateProject: projectWorkflow?.onCreateProject,
        onOpenProject: projectWorkflow?.onOpenProject,
        onOpenEngineeringWorkspace
      }}
      workspaceContext={shellState.workspaceContext}
    />
  );
}
