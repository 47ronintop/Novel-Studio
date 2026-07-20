import type { ActivityId, DesktopShellState } from "@novel-studio/application";
import { Boxes, Clock3, FolderTree, Search, Settings } from "lucide-react";

export interface WorkspaceActivityDescriptor {
  readonly id: ActivityId;
  readonly label: string;
  readonly icon: typeof FolderTree;
}

export const projectActivities: readonly WorkspaceActivityDescriptor[] = [
  { id: "workspace", label: "工作区", icon: FolderTree },
  { id: "search", label: "搜索", icon: Search },
  { id: "timeline", label: "时间线", icon: Clock3 }
];

export const bottomActivities: readonly WorkspaceActivityDescriptor[] = [
  { id: "studio", label: "创作系统", icon: Boxes },
  { id: "settings", label: "设置", icon: Settings }
];

export interface WorkspaceActivityGroups {
  readonly projectActivities: readonly WorkspaceActivityDescriptor[];
  readonly bottomActivities: readonly WorkspaceActivityDescriptor[];
}

export function workspaceActivitiesFor(
  shellState: Pick<DesktopShellState, "workspaceContext" | "workbenchMode">
): WorkspaceActivityGroups {
  const engineering =
    shellState.workspaceContext.kind === "engineeringWorkspace" ||
    shellState.workbenchMode === "engineering";

  if (!engineering) {
    return { projectActivities, bottomActivities };
  }

  return {
    projectActivities: projectActivities.filter((activity) => activity.id === "workspace"),
    bottomActivities: bottomActivities.filter((activity) => activity.id === "settings")
  };
}

export function WorkspaceActivityBar({
  shellState,
  focusHidden,
  onActivitySelect
}: {
  readonly shellState: Pick<
    DesktopShellState,
    "activeActivity" | "workspaceContext" | "workbenchMode"
  >;
  readonly focusHidden: boolean;
  readonly onActivitySelect: ((activityId: ActivityId) => void) | undefined;
}) {
  const groups = workspaceActivitiesFor(shellState);

  return (
    <aside
      aria-label="活动栏"
      className="ns-activity-bar"
      data-focus-hidden={focusHidden}
      data-region="activity-bar"
    >
      {(
        [
          ["ns-activity-project", "project-activities", groups.projectActivities],
          ["ns-activity-bottom", "bottom-activities", groups.bottomActivities]
        ] as const
      ).map(([className, region, activities]) => (
        <div className={className} data-region={region} key={region}>
          {activities.map((activity) => {
            const Icon = activity.icon;
            const selected = activity.id === shellState.activeActivity;

            return (
              <button
                {...(selected ? { "aria-current": "page" as const } : {})}
                aria-label={activity.label}
                className="ns-activity-button"
                data-activity-id={activity.id}
                data-focus-order={selected ? "2" : undefined}
                data-selected={selected}
                key={activity.id}
                onClick={() => onActivitySelect?.(activity.id)}
                title={activity.label}
                type="button"
              >
                <Icon aria-hidden="true" size={18} />
              </button>
            );
          })}
        </div>
      ))}
    </aside>
  );
}
