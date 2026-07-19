import type {
  EngineeringWorkspaceSnapshot,
  NovelStudioApi
} from "@novel-studio/application";
import type { ProjectWorkflowFeedback } from "@novel-studio/ui";

export interface EngineeringWorkspaceBridgeProps {
  readonly status: "idle" | "opening" | "refreshing" | "ready" | "error";
  readonly workspace?: EngineeringWorkspaceSnapshot;
  readonly feedback?: ProjectWorkflowFeedback;
  readonly onOpenWorkspace: () => void;
  readonly onRefreshTree: () => void;
}

export interface EngineeringWorkspaceBridge {
  getProps(): EngineeringWorkspaceBridgeProps;
  openEngineeringWorkspace(): Promise<EngineeringWorkspaceBridgeProps>;
  refreshEngineeringTree(): Promise<EngineeringWorkspaceBridgeProps>;
  clear(): void;
}

export function createEngineeringWorkspaceBridge(
  api: NovelStudioApi
): EngineeringWorkspaceBridge {
  let status: EngineeringWorkspaceBridgeProps["status"] = "idle";
  let workspace: EngineeringWorkspaceSnapshot | undefined;
  let feedback: ProjectWorkflowFeedback | undefined;

  const bridge: EngineeringWorkspaceBridge = {
    getProps: toProps,
    async openEngineeringWorkspace() {
      status = "opening";
      feedback = undefined;
      const selected = await api.workspace.chooseEngineeringDirectory();
      if (!selected.ok) return fail(selected.error.message);
      if (selected.value.canceled) {
        status = workspace === undefined ? "idle" : "ready";
        feedback = { kind: "info", message: "Workspace selection was canceled." };
        return toProps();
      }
      if (selected.value.selectionId === undefined) {
        return fail("The selected workspace is unavailable.");
      }

      const opened = await api.workspace.openEngineeringWorkspace(selected.value.selectionId);
      if (!opened.ok) return fail(opened.error.message);
      if (!("engineeringWorkspace" in opened.value)) {
        return fail("The selected directory did not open as an engineering workspace.");
      }
      workspace = opened.value.engineeringWorkspace;
      status = "ready";
      feedback = undefined;
      return toProps();
    },
    async refreshEngineeringTree() {
      if (workspace === undefined) return fail("No engineering workspace is open.");
      status = "refreshing";
      const refreshed = await api.workspace.refreshEngineeringTree();
      if (!refreshed.ok) return fail(refreshed.error.message);
      workspace = refreshed.value;
      status = "ready";
      feedback = undefined;
      return toProps();
    },
    clear() {
      status = "idle";
      workspace = undefined;
      feedback = undefined;
    }
  };

  return bridge;

  function fail(message: string): EngineeringWorkspaceBridgeProps {
    status = "error";
    feedback = { kind: "error", message };
    return toProps();
  }

  function toProps(): EngineeringWorkspaceBridgeProps {
    return {
      status,
      ...(workspace === undefined ? {} : { workspace }),
      ...(feedback === undefined ? {} : { feedback }),
      onOpenWorkspace: () => {
        void bridge.openEngineeringWorkspace();
      },
      onRefreshTree: () => {
        void bridge.refreshEngineeringTree();
      }
    };
  }
}
