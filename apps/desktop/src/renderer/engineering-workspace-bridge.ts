import type { EngineeringWorkspaceSnapshot, NovelStudioApi } from "@novel-studio/application";
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
  subscribe(listener: (props: EngineeringWorkspaceBridgeProps) => void): () => void;
  openEngineeringWorkspace(): Promise<EngineeringWorkspaceBridgeProps>;
  attachCreativeProject(): Promise<EngineeringWorkspaceBridgeProps>;
  refreshEngineeringTree(): Promise<EngineeringWorkspaceBridgeProps>;
  clear(): void;
}

export function createEngineeringWorkspaceBridge(api: NovelStudioApi): EngineeringWorkspaceBridge {
  let status: EngineeringWorkspaceBridgeProps["status"] = "idle";
  let workspace: EngineeringWorkspaceSnapshot | undefined;
  let feedback: ProjectWorkflowFeedback | undefined;
  let openRequest: Promise<EngineeringWorkspaceBridgeProps> | undefined;
  const listeners = new Set<(props: EngineeringWorkspaceBridgeProps) => void>();

  const bridge: EngineeringWorkspaceBridge = {
    getProps: toProps,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    openEngineeringWorkspace() {
      if (openRequest !== undefined) return openRequest;
      const request = openEngineeringWorkspaceOnce();
      openRequest = request.finally(() => {
        openRequest = undefined;
      });
      return openRequest;
    },
    async attachCreativeProject() {
      status = "opening";
      feedback = undefined;
      const attached = await api.workspace.attachActiveCreativeProjectEngineeringWorkspace();
      if (!attached.ok) return fail(attached.error.message);
      workspace = attached.value;
      status = "ready";
      feedback = undefined;
      publish();
      return toProps();
    },
    async refreshEngineeringTree() {
      if (workspace === undefined) return fail("尚未打开工程工作区。");
      status = "refreshing";
      const refreshed = await api.workspace.refreshEngineeringTree();
      if (!refreshed.ok) return fail(refreshed.error.message);
      workspace = refreshed.value;
      status = "ready";
      feedback = undefined;
      publish();
      return toProps();
    },
    clear() {
      status = "idle";
      workspace = undefined;
      feedback = undefined;
      publish();
    }
  };

  return bridge;

  async function openEngineeringWorkspaceOnce(): Promise<EngineeringWorkspaceBridgeProps> {
    status = "opening";
    feedback = undefined;
    const selected = await api.workspace.chooseEngineeringDirectory();
    if (!selected.ok) return fail(selected.error.message);
    if (selected.value.canceled) {
      status = workspace === undefined ? "idle" : "ready";
      feedback = { kind: "info", message: "已取消选择工程文件夹。" };
      return toProps();
    }
    if (selected.value.selectionId === undefined) {
      return fail("所选工程文件夹不可用。");
    }

    const opened = await api.workspace.openEngineeringWorkspace(selected.value.selectionId);
    if (!opened.ok) return fail(opened.error.message);
    if (!("engineeringWorkspace" in opened.value)) {
      return fail("所选目录未能作为工程工作区打开。");
    }
    workspace = opened.value.engineeringWorkspace;
    status = "ready";
    feedback = undefined;
    publish();
    return toProps();
  }

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

  function publish(): void {
    const props = toProps();
    listeners.forEach((listener) => listener(props));
  }
}
