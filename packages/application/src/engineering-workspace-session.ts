import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";
import type { WorkspaceActivationContext } from "./workspace-activation-context.js";

export interface EngineeringWorkspaceTreeNode {
  readonly id: string;
  readonly name: string;
  readonly kind: "directory" | "file";
  readonly path: string;
  readonly readOnlyReason?: string;
  readonly children?: readonly EngineeringWorkspaceTreeNode[];
}

export interface EngineeringWorkspaceTreeSnapshot {
  readonly nodes: readonly EngineeringWorkspaceTreeNode[];
  readonly truncated: boolean;
}

export interface EngineeringTextFileSnapshot {
  readonly path: string;
  readonly content: string;
  readonly checksum: string;
  readonly byteLength: number;
  readonly readOnlyReason?: string;
}

export type EngineeringTextFileSaveResult =
  | { readonly kind: "saved"; readonly document: EngineeringTextFileSnapshot }
  | {
      readonly kind: "conflict";
      readonly current: EngineeringTextFileSnapshot;
      readonly attemptedContent: string;
    };

export interface EngineeringWorkspaceSnapshot {
  readonly workspaceId: string;
  readonly displayName: string;
  readonly tree: EngineeringWorkspaceTreeSnapshot;
}

export interface EngineeringWorkspaceActivation {
  readonly context: Extract<WorkspaceActivationContext, { readonly kind: "engineeringWorkspace" }>;
  readonly snapshot: EngineeringWorkspaceSnapshot;
}

export interface EngineeringWorkspaceRepositoryPort {
  openWorkspace(): Promise<
    Result<
      {
        readonly canonicalContentRoot: string;
        readonly displayName: string;
        readonly tree: EngineeringWorkspaceTreeSnapshot;
      },
      UnifiedError
    >
  >;
  readTextFile(path: string): Promise<Result<EngineeringTextFileSnapshot, UnifiedError>>;
  saveTextFile(input: {
    readonly path: string;
    readonly content: string;
    readonly expectedChecksum: string;
  }): Promise<Result<EngineeringTextFileSaveResult, UnifiedError>>;
}

export interface EngineeringWorkspaceStatePort {
  resolveState(
    canonicalContentRoot: string
  ): Promise<Result<{ readonly workspaceId: string; readonly stateRoot: string }, UnifiedError>>;
}

export interface EngineeringWorkspaceLockPort {
  acquireWorkspaceLock(): Promise<Result<void, UnifiedError>>;
  releaseWorkspaceLock(): Promise<Result<void, UnifiedError>>;
}

export interface CreateEngineeringWorkspaceSessionOptions {
  readonly createRepository: (contentRoot: string) => EngineeringWorkspaceRepositoryPort;
  readonly createStatePort: () => EngineeringWorkspaceStatePort;
  readonly createLockPort: (stateRoot: string) => EngineeringWorkspaceLockPort;
  readonly now?: () => string;
}

export interface EngineeringWorkspaceSession {
  getActivation(): EngineeringWorkspaceActivation | undefined;
  getSnapshot(): EngineeringWorkspaceSnapshot | undefined;
  openEngineeringWorkspace(
    contentRoot: string
  ): Promise<Result<EngineeringWorkspaceActivation, UnifiedError>>;
  attachCreativeProject(input: {
    readonly projectId: string;
    readonly projectRoot: string;
  }): Promise<Result<EngineeringWorkspaceActivation, UnifiedError>>;
  readTextFile(path: string): Promise<Result<EngineeringTextFileSnapshot, UnifiedError>>;
  saveTextFile(input: {
    readonly path: string;
    readonly content: string;
    readonly expectedChecksum: string;
  }): Promise<Result<EngineeringTextFileSaveResult, UnifiedError>>;
  releaseWorkspaceLock(): Promise<Result<void, UnifiedError>>;
}

interface ActiveWorkspace {
  readonly activation: EngineeringWorkspaceActivation;
  readonly repository: EngineeringWorkspaceRepositoryPort;
  readonly managedAssetsReadOnly: boolean;
  readonly lock?: EngineeringWorkspaceLockPort;
}

const MANAGED_READ_ONLY_REASON =
  "由 Novel Studio 管理的资产，请使用章节、故事圣经、Studio、版本或恢复界面修改。";
const MANAGED_DIRECTORIES = new Set([
  "chapters",
  "characters",
  "world",
  "outline",
  "timeline",
  "memories",
  "prompts",
  "agents",
  "workflow",
  "plugins",
  "history",
  "cache",
  ".novel-studio"
]);

export function createEngineeringWorkspaceSession(
  options: CreateEngineeringWorkspaceSessionOptions
): EngineeringWorkspaceSession {
  let active: ActiveWorkspace | undefined;
  let transitionTail: Promise<void> = Promise.resolve();

  return {
    getActivation: () => active?.activation,
    getSnapshot: () => active?.activation.snapshot,

    async openEngineeringWorkspace(contentRoot) {
      let repository: EngineeringWorkspaceRepositoryPort;
      try {
        repository = options.createRepository(contentRoot);
      } catch {
        return openFailed();
      }
      const opened = await safelyOpen(repository);
      if (!opened.ok) return opened;

      let statePort: EngineeringWorkspaceStatePort;
      try {
        statePort = options.createStatePort();
      } catch {
        return openFailed();
      }
      const state = await safelyResolveState(statePort, opened.value.canonicalContentRoot);
      if (!state.ok) return state;

      let lock: EngineeringWorkspaceLockPort;
      try {
        lock = options.createLockPort(state.value.stateRoot);
      } catch {
        return openFailed();
      }
      const acquired = await safelyAcquireWorkspaceLock(lock);
      if (!acquired.ok) {
        const cleanup = await safelyReleaseWorkspaceLock(lock);
        return cleanup.ok ? acquired : lockRollbackFailed(acquired.error, cleanup.error);
      }

      const candidate: ActiveWorkspace = {
        repository,
        lock,
        managedAssetsReadOnly: false,
        activation: createActivation({
          workspaceId: state.value.workspaceId,
          displayName: opened.value.displayName,
          contentRoot: opened.value.canonicalContentRoot,
          stateRoot: state.value.stateRoot,
          tree: opened.value.tree
        })
      };
      return commitCandidate(candidate);
    },

    async attachCreativeProject(input) {
      let repository: EngineeringWorkspaceRepositoryPort;
      try {
        repository = options.createRepository(input.projectRoot);
      } catch {
        return openFailed();
      }
      const opened = await safelyOpen(repository);
      if (!opened.ok) return opened;

      const candidate: ActiveWorkspace = {
        repository,
        managedAssetsReadOnly: true,
        activation: createActivation({
          workspaceId: input.projectId,
          displayName: opened.value.displayName,
          contentRoot: opened.value.canonicalContentRoot,
          stateRoot: opened.value.canonicalContentRoot,
          tree: markTreeManaged(opened.value.tree)
        })
      };
      return commitCandidate(candidate);
    },

    async readTextFile(path) {
      if (active === undefined) return unavailable();
      const read = await active.repository.readTextFile(path);
      if (!read.ok) return read;
      if (active.managedAssetsReadOnly && isManagedPath(path)) {
        return ok({ ...read.value, readOnlyReason: MANAGED_READ_ONLY_REASON });
      }
      return read;
    },

    async saveTextFile(input) {
      if (active === undefined) return unavailable();
      if (active.managedAssetsReadOnly && isManagedPath(input.path)) {
        return err(
          createUnifiedError({
            code: "ENGINEERING_MANAGED_ASSET_WRITE_REJECTED",
            category: "UserError",
            message:
              "Novel Studio managed assets cannot be edited from the engineering file editor.",
            recoverability: "user-action",
            suggestedAction: MANAGED_READ_ONLY_REASON,
            traceId: "engineering-workspace-session"
          })
        );
      }
      return active.repository.saveTextFile(input);
    },

    async releaseWorkspaceLock() {
      return serializeTransition(async () => {
        if (active?.lock === undefined) return ok(undefined);
        const released = await safelyReleaseWorkspaceLock(active.lock);
        if (!released.ok) return released;
        active = {
          activation: active.activation,
          repository: active.repository,
          managedAssetsReadOnly: active.managedAssetsReadOnly
        };
        return ok(undefined);
      });
    }
  };

  async function commitCandidate(
    candidate: ActiveWorkspace
  ): Promise<Result<EngineeringWorkspaceActivation, UnifiedError>> {
    return serializeTransition(async () => {
      const previous = active;
      if (previous?.lock !== undefined) {
        const released = await safelyReleaseWorkspaceLock(previous.lock);
        if (!released.ok) {
          if (candidate.lock !== undefined) {
            const cleanup = await safelyReleaseWorkspaceLock(candidate.lock);
            if (!cleanup.ok) return lockRollbackFailed(released.error, cleanup.error);
          }
          return released;
        }
      }
      active = candidate;
      return ok(candidate.activation);
    });
  }

  function serializeTransition<T>(
    transition: () => Promise<Result<T, UnifiedError>>
  ): Promise<Result<T, UnifiedError>> {
    const result = transitionTail.then(
      () => transition(),
      () => transition()
    );
    transitionTail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}

function createActivation(input: {
  readonly workspaceId: string;
  readonly displayName: string;
  readonly contentRoot: string;
  readonly stateRoot: string;
  readonly tree: EngineeringWorkspaceTreeSnapshot;
}): EngineeringWorkspaceActivation {
  return {
    context: {
      kind: "engineeringWorkspace",
      workspaceId: input.workspaceId,
      displayName: input.displayName,
      contentRoot: input.contentRoot,
      stateRoot: input.stateRoot,
      capabilities: ["engineeringWorkbench", "generalFileContext"]
    },
    snapshot: {
      workspaceId: input.workspaceId,
      displayName: input.displayName,
      tree: input.tree
    }
  };
}

function markTreeManaged(tree: EngineeringWorkspaceTreeSnapshot): EngineeringWorkspaceTreeSnapshot {
  return {
    ...tree,
    nodes: tree.nodes.map(markNodeManaged)
  };
}

function markNodeManaged(node: EngineeringWorkspaceTreeNode): EngineeringWorkspaceTreeNode {
  const managed = isManagedPath(node.path);
  return {
    ...node,
    ...(managed ? { readOnlyReason: MANAGED_READ_ONLY_REASON } : {}),
    ...(node.children === undefined ? {} : { children: node.children.map(markNodeManaged) })
  };
}

function isManagedPath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  if (normalized === "project.json" || normalized === "settings.json") return true;
  return [...MANAGED_DIRECTORIES].some(
    (directory) => normalized === directory || normalized.startsWith(`${directory}/`)
  );
}

async function safelyOpen(
  repository: EngineeringWorkspaceRepositoryPort
): Promise<
  ReturnType<EngineeringWorkspaceRepositoryPort["openWorkspace"]> extends Promise<infer T>
    ? T
    : never
> {
  try {
    return await repository.openWorkspace();
  } catch {
    return openFailed();
  }
}

async function safelyResolveState(
  statePort: EngineeringWorkspaceStatePort,
  canonicalContentRoot: string
): ReturnType<EngineeringWorkspaceStatePort["resolveState"]> {
  try {
    return await statePort.resolveState(canonicalContentRoot);
  } catch {
    return openFailed();
  }
}

async function safelyAcquireWorkspaceLock(
  lock: EngineeringWorkspaceLockPort
): ReturnType<EngineeringWorkspaceLockPort["acquireWorkspaceLock"]> {
  try {
    return await lock.acquireWorkspaceLock();
  } catch {
    return lockAcquireFailed();
  }
}

async function safelyReleaseWorkspaceLock(
  lock: EngineeringWorkspaceLockPort
): ReturnType<EngineeringWorkspaceLockPort["releaseWorkspaceLock"]> {
  try {
    return await lock.releaseWorkspaceLock();
  } catch {
    return lockReleaseFailed();
  }
}

function openFailed<T = never>(): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "ENGINEERING_WORKSPACE_OPEN_FAILED",
      category: "StorageError",
      message: "The engineering workspace could not be opened.",
      recoverability: "user-action",
      suggestedAction: "Choose an existing folder and try opening it again.",
      traceId: "engineering-workspace-session"
    })
  );
}

function lockAcquireFailed<T = never>(): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "ENGINEERING_WORKSPACE_LOCK_ACQUIRE_FAILED",
      category: "StorageError",
      message: "The engineering workspace lock could not be acquired.",
      recoverability: "user-action",
      suggestedAction: "Close other Novel Studio windows using this workspace and try again.",
      traceId: "engineering-workspace-session"
    })
  );
}

function lockReleaseFailed<T = never>(): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "ENGINEERING_WORKSPACE_LOCK_RELEASE_FAILED",
      category: "StorageError",
      message: "The engineering workspace lock could not be released.",
      recoverability: "retryable",
      suggestedAction:
        "Retry the operation or restart Novel Studio before reopening the workspace.",
      traceId: "engineering-workspace-session"
    })
  );
}

function lockRollbackFailed<T = never>(
  primaryError: UnifiedError,
  candidateCleanupError: UnifiedError
): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "ENGINEERING_WORKSPACE_LOCK_ROLLBACK_FAILED",
      category: "StorageError",
      message: "Workspace activation rollback could not release every lock.",
      recoverability: "user-action",
      suggestedAction: "Restart Novel Studio before reopening either workspace.",
      traceId: "engineering-workspace-session",
      redactedDetail: {
        primaryErrorCode: primaryError.code,
        candidateCleanupErrorCode: candidateCleanupError.code
      }
    })
  );
}

function unavailable<T = never>(): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "ENGINEERING_WORKSPACE_UNAVAILABLE",
      category: "UserError",
      message: "No engineering workspace is open.",
      recoverability: "user-action",
      suggestedAction: "Open an engineering workspace before using file operations.",
      traceId: "engineering-workspace-session"
    })
  );
}
