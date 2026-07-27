import type {
  CreativeProjectFileLifecycleCommand,
  CreativeProjectFileSessionIdentity,
  CreativeProjectFileTreeNode,
  CreativeProjectFileTreeSnapshot,
  NovelStudioApi
} from "@novel-studio/application";
import type { CreativeProjectFilesNavigatorProps } from "@novel-studio/ui";

export type CreativeProjectFileGuardReason =
  "open_file" | "rename_active_path" | "delete_active_path";

export interface CreativeProjectFilesBridgeOptions {
  readonly createCommandId?: () => string;
  readonly beforeActiveFileChange?: (
    reason: CreativeProjectFileGuardReason
  ) => boolean | Promise<boolean>;
  readonly onActiveFilePathChange?: (path: string | undefined) => void;
}

export interface CreativeProjectFilesBridge {
  getSnapshot(): CreativeProjectFileTreeSnapshot | undefined;
  getActiveFilePath(): string | undefined;
  getNavigatorProps(): CreativeProjectFilesNavigatorProps | undefined;
  activate(
    identity: CreativeProjectFileSessionIdentity,
    expandedPathIds?: readonly string[]
  ): Promise<CreativeProjectFilesNavigatorProps>;
  refresh(): Promise<CreativeProjectFilesNavigatorProps | undefined>;
  requestOpenFile(path: string): Promise<boolean>;
  clearActiveFile(): void;
  setExpandedPathIds(pathIds: readonly string[]): void;
  createTextFile(path: string): Promise<void>;
  createDirectory(path: string): Promise<void>;
  renamePath(sourcePath: string, targetPath: string): Promise<void>;
  deletePath(path: string): Promise<void>;
  clear(): void;
  subscribe(listener: () => void): () => void;
}

interface BridgeState {
  readonly identity: CreativeProjectFileSessionIdentity;
  readonly snapshot: CreativeProjectFileTreeSnapshot | undefined;
  readonly expandedPathIds: readonly string[];
  readonly activeFilePath: string | undefined;
  readonly loading: boolean;
  readonly errorMessage: string | undefined;
}

export function createCreativeProjectFilesBridge(
  api: NovelStudioApi,
  options: CreativeProjectFilesBridgeOptions = {}
): CreativeProjectFilesBridge {
  const listeners = new Set<() => void>();
  const createCommandId = options.createCommandId ?? defaultCommandId;
  let state: BridgeState | undefined;

  const bridge: CreativeProjectFilesBridge = {
    getSnapshot: () => state?.snapshot,
    getActiveFilePath: () => state?.activeFilePath,
    getNavigatorProps: () => (state === undefined ? undefined : toNavigatorProps(state)),
    async activate(identity, expandedPathIds = []) {
      state = {
        identity,
        snapshot: undefined,
        expandedPathIds: normalizeExpandedIds(expandedPathIds),
        activeFilePath: undefined,
        errorMessage: undefined,
        loading: true
      };
      notify();
      const result = await api.creativeProjectFiles.refresh(identity);
      if (!sameIdentity(state?.identity, identity)) return requireNavigatorProps();
      const active = state;
      if (active === undefined) return requireNavigatorProps();
      state = result.ok
        ? { ...active, snapshot: result.value, loading: false, errorMessage: undefined }
        : { ...active, snapshot: undefined, loading: false, errorMessage: result.error.message };
      notify();
      return requireNavigatorProps();
    },
    async refresh() {
      const current = state;
      if (current === undefined) return undefined;
      state = { ...current, loading: true, errorMessage: undefined };
      notify();
      const result = await api.creativeProjectFiles.refresh(current.identity);
      if (!sameIdentity(state?.identity, current.identity)) return bridge.getNavigatorProps();
      const active = state;
      if (active === undefined) return undefined;
      state = result.ok
        ? { ...active, snapshot: result.value, loading: false, errorMessage: undefined }
        : { ...active, loading: false, errorMessage: result.error.message };
      notify();
      return bridge.getNavigatorProps();
    },
    async requestOpenFile(path) {
      const current = state;
      if (
        current?.snapshot === undefined ||
        findNode(current.snapshot.nodes, path)?.kind !== "file"
      ) {
        return false;
      }
      if (current.activeFilePath !== path) {
        const allowed = await options.beforeActiveFileChange?.("open_file");
        if (allowed === false || !sameIdentity(state?.identity, current.identity)) return false;
      }
      state = { ...current, activeFilePath: path, errorMessage: undefined };
      options.onActiveFilePathChange?.(path);
      notify();
      return true;
    },
    clearActiveFile() {
      if (state === undefined || state.activeFilePath === undefined) return;
      state = { ...state, activeFilePath: undefined };
      options.onActiveFilePathChange?.(undefined);
      notify();
    },
    setExpandedPathIds(pathIds) {
      if (state === undefined) return;
      state = { ...state, expandedPathIds: normalizeExpandedIds(pathIds) };
      notify();
    },
    createTextFile: (path) => executeCreate("createTextFile", path),
    createDirectory: (path) => executeCreate("createDirectory", path),
    async renamePath(sourcePath, targetPath) {
      let current = state;
      let snapshot = current?.snapshot;
      let source = snapshot === undefined ? undefined : findNode(snapshot.nodes, sourcePath);
      if (current === undefined || snapshot === undefined || source === undefined) return;
      const changesActivePath = pathContains(sourcePath, current.activeFilePath);
      if (changesActivePath) {
        const allowed = await options.beforeActiveFileChange?.("rename_active_path");
        if (allowed === false || !sameIdentity(state?.identity, current.identity)) return;
        const refreshed = await refreshAfterActiveFileGuard(current);
        if (refreshed?.snapshot === undefined) return;
        current = refreshed;
        snapshot = refreshed.snapshot;
        source = findNode(snapshot.nodes, sourcePath);
        if (source === undefined) return;
      }
      const command: CreativeProjectFileLifecycleCommand = {
        schemaVersion: "1.0",
        commandId: createCommandId(),
        kind: "renamePath",
        ...current.identity,
        sourcePath,
        targetPath,
        expectedTreeRevision: snapshot.treeRevision,
        expectedSourceRevision: source.nodeRevision
      };
      const completed = await executeLifecycle(current, command);
      if (!completed || !changesActivePath || state === undefined) return;
      const nextPath = remapPath(current.activeFilePath, sourcePath, targetPath);
      state = { ...state, ...(nextPath === undefined ? {} : { activeFilePath: nextPath }) };
      options.onActiveFilePathChange?.(nextPath);
      notify();
    },
    async deletePath(path) {
      let current = state;
      let snapshot = current?.snapshot;
      let source = snapshot === undefined ? undefined : findNode(snapshot.nodes, path);
      if (current === undefined || snapshot === undefined || source === undefined) return;
      const changesActivePath = pathContains(path, current.activeFilePath);
      if (changesActivePath) {
        const allowed = await options.beforeActiveFileChange?.("delete_active_path");
        if (allowed === false || !sameIdentity(state?.identity, current.identity)) return;
        const refreshed = await refreshAfterActiveFileGuard(current);
        if (refreshed?.snapshot === undefined) return;
        current = refreshed;
        snapshot = refreshed.snapshot;
        source = findNode(snapshot.nodes, path);
        if (source === undefined) return;
      }
      const command: CreativeProjectFileLifecycleCommand =
        source.kind === "file"
          ? {
              schemaVersion: "1.0",
              commandId: createCommandId(),
              kind: "deleteFile",
              ...current.identity,
              path,
              expectedTreeRevision: snapshot.treeRevision,
              expectedSourceRevision: source.nodeRevision,
              confirmed: true
            }
          : {
              schemaVersion: "1.0",
              commandId: createCommandId(),
              kind: "deleteEmptyDirectory",
              ...current.identity,
              path,
              expectedTreeRevision: snapshot.treeRevision,
              expectedSourceRevision: source.nodeRevision,
              confirmed: true
            };
      const completed = await executeLifecycle(current, command);
      if (!completed || !changesActivePath || state === undefined) return;
      state = { ...state, activeFilePath: undefined };
      options.onActiveFilePathChange?.(undefined);
      notify();
    },
    clear() {
      if (state?.activeFilePath !== undefined) options.onActiveFilePathChange?.(undefined);
      state = undefined;
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };

  return bridge;

  async function executeCreate(kind: "createTextFile" | "createDirectory", path: string) {
    const current = state;
    const snapshot = current?.snapshot;
    if (current === undefined || snapshot === undefined) return;
    const command: CreativeProjectFileLifecycleCommand =
      kind === "createTextFile"
        ? {
            schemaVersion: "1.0",
            commandId: createCommandId(),
            kind,
            ...current.identity,
            path,
            content: "",
            expectedTreeRevision: snapshot.treeRevision
          }
        : {
            schemaVersion: "1.0",
            commandId: createCommandId(),
            kind,
            ...current.identity,
            path,
            expectedTreeRevision: snapshot.treeRevision
          };
    await executeLifecycle(current, command);
  }

  async function executeLifecycle(
    current: BridgeState,
    command: CreativeProjectFileLifecycleCommand
  ): Promise<boolean> {
    if (!sameIdentity(state?.identity, current.identity)) return false;
    state = { ...current, loading: true, errorMessage: undefined };
    notify();
    const result = await api.creativeProjectFiles.executeLifecycle(command);
    if (!sameIdentity(state?.identity, current.identity)) return false;
    if (!result.ok) {
      state = { ...current, loading: false, errorMessage: result.error.message };
      notify();
      return false;
    }
    const refreshed = await api.creativeProjectFiles.refresh(current.identity);
    if (!sameIdentity(state?.identity, current.identity)) return false;
    const active = state;
    if (active === undefined) return false;
    state = refreshed.ok
      ? { ...active, snapshot: refreshed.value, loading: false, errorMessage: undefined }
      : { ...active, loading: false, errorMessage: refreshed.error.message };
    notify();
    return refreshed.ok;
  }

  async function refreshAfterActiveFileGuard(
    current: BridgeState
  ): Promise<BridgeState | undefined> {
    const refreshed = await api.creativeProjectFiles.refresh(current.identity);
    if (!sameIdentity(state?.identity, current.identity)) return undefined;
    const active = state;
    if (active === undefined) return undefined;
    if (!refreshed.ok) {
      state = { ...active, loading: false, errorMessage: refreshed.error.message };
      notify();
      return undefined;
    }
    state = { ...active, snapshot: refreshed.value, loading: false, errorMessage: undefined };
    notify();
    return state;
  }

  function toNavigatorProps(current: BridgeState): CreativeProjectFilesNavigatorProps {
    return {
      nodes: current.snapshot?.nodes ?? [],
      expandedPathIds: current.expandedPathIds,
      ...(current.activeFilePath === undefined ? {} : { activeFilePath: current.activeFilePath }),
      loading: current.loading,
      truncated: current.snapshot?.truncated ?? false,
      ...(current.errorMessage === undefined ? {} : { errorMessage: current.errorMessage }),
      onExpandedPathIdsChange: bridge.setExpandedPathIds,
      onFileOpen: (path) => void bridge.requestOpenFile(path),
      onRefresh: () => void bridge.refresh(),
      onCreateTextFile: (path) => void bridge.createTextFile(path),
      onCreateDirectory: (path) => void bridge.createDirectory(path),
      onRenamePath: (sourcePath, targetPath) => void bridge.renamePath(sourcePath, targetPath),
      onDeletePath: (path) => void bridge.deletePath(path)
    };
  }

  function requireNavigatorProps(): CreativeProjectFilesNavigatorProps {
    const props = bridge.getNavigatorProps();
    if (props === undefined) throw new Error("Creative project files are not active.");
    return props;
  }

  function notify(): void {
    for (const listener of listeners) listener();
  }
}

function findNode(
  nodes: readonly CreativeProjectFileTreeNode[],
  path: string
): CreativeProjectFileTreeNode | undefined {
  for (const node of nodes) {
    if (node.path === path) return node;
    const child = findNode(node.children ?? [], path);
    if (child !== undefined) return child;
  }
  return undefined;
}

function pathContains(parent: string, child: string | undefined): boolean {
  return child !== undefined && (child === parent || child.startsWith(`${parent}/`));
}

function remapPath(
  activePath: string | undefined,
  sourcePath: string,
  targetPath: string
): string | undefined {
  if (!pathContains(sourcePath, activePath) || activePath === undefined) return activePath;
  return `${targetPath}${activePath.slice(sourcePath.length)}`;
}

function sameIdentity(
  left: CreativeProjectFileSessionIdentity | undefined,
  right: CreativeProjectFileSessionIdentity
): boolean {
  return left?.projectId === right.projectId && left.workspaceId === right.workspaceId;
}

function normalizeExpandedIds(pathIds: readonly string[]): readonly string[] {
  return [...new Set(pathIds.filter((pathId) => typeof pathId === "string"))];
}

let commandSequence = 0;
function defaultCommandId(): string {
  commandSequence += 1;
  return `creative_file_${Date.now().toString(36)}_${commandSequence.toString(36)}`;
}
