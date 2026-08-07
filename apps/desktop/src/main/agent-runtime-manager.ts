import { realpath } from "node:fs/promises";

import type {
  AgentContextSession,
  AgentConversationSession,
  AgentSendPreviewDtoV2,
  AgentPermissionSession,
  AgentPlanExecutionSession,
  AgentRunDraftSession,
  AgentRunSession,
  AgentUsageSession,
  ConfirmAgentSendPreviewCommandV2
} from "@novel-studio/application";
import type { AgentRunEvent, AgentRunSnapshot } from "@novel-studio/agent-engine";
import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

export interface DesktopAgentWorkspaceBinding {
  readonly kind: "creativeProject" | "engineeringWorkspace";
  readonly workspaceId: string;
  readonly contentRoot: string;
  readonly stateRoot: string;
  readonly activeChapterId?: string;
}

interface DesktopAgentRuntimeSessions {
  readonly stateRoot: string;
  readonly agentRunSession: AgentRunSession;
  readonly agentConversationSession: AgentConversationSession;
  readonly agentRunDraftSession: AgentRunDraftSession;
  readonly agentContextSession: AgentContextSession;
  readonly agentPermissionSession: AgentPermissionSession;
  readonly agentPlanExecutionSession: AgentPlanExecutionSession;
  readonly agentUsageSession?: AgentUsageSession;
  /** Present only when this runtime owns the mandatory frozen first-send confirmation flow. */
  readonly prepareAgentSendPreview?: (command: {
    readonly schemaVersion: "2.0";
    readonly commandId: string;
    readonly startCommand: import("@novel-studio/agent-engine").StartAgentRunCommand;
  }) => Promise<Result<AgentSendPreviewDtoV2, UnifiedError>>;
  readonly confirmAgentSendPreview?: (
    command: ConfirmAgentSendPreviewCommandV2
  ) => Promise<Result<AgentRunSnapshot, UnifiedError>>;
  readonly prepare: () => Promise<Result<void, UnifiedError>>;
  readonly dispose?: () => void;
  readonly releasePromptCacheResources?: () => void;
  /** Fail-close settings-backed capability/executor access without waiting for a rebuild. */
  readonly revokeSettingsCapabilities?: () => void;
  /** Synchronously removes approval-backed mutation capabilities before a deferred rebuild. */
  readonly revokeApprovalCapabilities?: () => void;
}

export interface DesktopAgentRuntime extends DesktopAgentRuntimeSessions {
  readonly workspaceId: string;
  readonly contentRoot: string;
}

/**
 * Application-scoped runtime identity. It deliberately has neither a project ID nor a content
 * root: callers must not be able to mistake it for a workspace binding.
 */
export interface DesktopStandaloneAgentRuntime extends DesktopAgentRuntimeSessions {
  readonly scopeId: "standalone";
  /** Scope-owned listing avoids adapting standalone identity into a project ID. */
  readonly listRunSnapshots: () => Promise<Result<readonly AgentRunSnapshot[], UnifiedError>>;
}

export type DesktopAgentRuntimeScope = "standalone" | "workspace";

export type ActiveDesktopAgentRuntime =
  | {
      readonly scope: "standalone";
      readonly runtime: DesktopStandaloneAgentRuntime;
    }
  | {
      readonly scope: "workspace";
      readonly binding: DesktopAgentWorkspaceBinding;
      readonly runtime: DesktopAgentRuntime;
    };

export interface PreparedDesktopAgentWorkspace {
  readonly binding: DesktopAgentWorkspaceBinding;
  readonly runtime: DesktopAgentRuntime;
}

export type DesktopAgentWorkspacePreparation = PreparedDesktopAgentWorkspace;

/**
 * Keeps the runtime selected for the duration of server-authoritative start preflight.
 * The lease is deliberately Main-only: renderer commands continue to target the active runtime.
 */
export interface DesktopAgentRunStartLease {
  readonly session: AgentRunSession;
  release(): void;
}

export interface DesktopAgentRuntimeManager {
  /** Initialize the persistent application-scoped runtime without selecting a workspace. */
  prepareStandalone(): Promise<Result<DesktopStandaloneAgentRuntime, UnifiedError>>;
  /** Select standalone after proving no workspace run would be hidden by the transition. */
  activateStandalone(): Promise<Result<void, UnifiedError>>;
  bindWorkspace(binding: DesktopAgentWorkspaceBinding): Promise<Result<void, UnifiedError>>;
  prepareWorkspace(
    binding: DesktopAgentWorkspaceBinding
  ): Promise<Result<PreparedDesktopAgentWorkspace, UnifiedError>>;
  commitPreparedWorkspace(prepared: PreparedDesktopAgentWorkspace): void;
  discardPreparedWorkspace(prepared: PreparedDesktopAgentWorkspace): void;
  /** Backward-compatible current workspace accessor; undefined while standalone is active. */
  current(): DesktopAgentRuntime | undefined;
  /** The persistent standalone runtime, including while a workspace is selected. */
  standalone(): DesktopStandaloneAgentRuntime | undefined;
  /** The runtime whose event stream and IPC surface are currently active. */
  active(): ActiveDesktopAgentRuntime | undefined;
  activeScope(): DesktopAgentRuntimeScope | undefined;
  /**
   * Atomically reserves the active runtime while a start command completes preflight. Workspace
   * transitions use the same gate so they cannot hide a run that has not been persisted yet.
   */
  acquireActiveRunStartLease(): Result<DesktopAgentRunStartLease, UnifiedError>;
  currentWorkspace():
    | {
        readonly workspaceId: string;
        readonly contentRoot: string;
        readonly stateRoot: string;
      }
    | undefined;
  /**
   * Rebuild the current workspace runtime after a Main-owned Agent setting changes.
   * Any active run is stopped first so a revoked Main-owned executor cannot remain reachable from
   * its frozen capability snapshot. Write transactions still finish through their own stop barrier;
   * in that case refresh remains deferred until the transaction becomes terminal.
   */
  refreshCurrentWorkspace(): Promise<Result<void, UnifiedError>>;
  /** Fail-close settings-backed capability/executor access in the current runtime. */
  revokeCurrentSettingsCapabilities(): void;
  /** Fail-close approval-backed mutation capabilities in the current runtime. */
  revokeCurrentApprovalCapabilities(): void;
  hasActiveRun(): Promise<Result<boolean, UnifiedError>>;
  subscribeAgentRunEvents(listener: (event: AgentRunEvent) => void): () => void;
  dispose(): void;
}

export interface CreateDesktopAgentRuntimeManagerOptions {
  readonly createRuntime: (
    binding: DesktopAgentWorkspaceBinding
  ) => DesktopAgentRuntime | Promise<DesktopAgentRuntime>;
  /** Main supplies this app-owned factory; renderer input never participates in standalone paths. */
  readonly createStandaloneRuntime?:
    (() => DesktopStandaloneAgentRuntime | Promise<DesktopStandaloneAgentRuntime>) | undefined;
  /** Main-owned lifecycle hook for scope-bound capabilities such as trusted approval surfaces. */
  readonly onActiveRuntimeChanged?: (active: ActiveDesktopAgentRuntime | undefined) => void;
}

export function createDesktopAgentRuntimeManager(
  options: CreateDesktopAgentRuntimeManagerOptions
): DesktopAgentRuntimeManager {
  let runtime: DesktopAgentRuntime | undefined;
  let currentBinding: DesktopAgentWorkspaceBinding | undefined;
  let unsubscribeRuntime: (() => void) | undefined;
  let standaloneRuntime: DesktopStandaloneAgentRuntime | undefined;
  let unsubscribeStandaloneRuntime: (() => void) | undefined;
  let standalonePreparation:
    Promise<Result<DesktopStandaloneAgentRuntime, UnifiedError>> | undefined;
  let selectedScope: DesktopAgentRuntimeScope | undefined;
  const listeners = new Set<(event: AgentRunEvent) => void>();
  const preparedStates = new Map<
    PreparedDesktopAgentWorkspace,
    {
      readonly unsubscribe: () => void;
      readonly transition: symbol;
      state: "prepared" | "committed" | "discarded";
    }
  >();
  const pendingPreparations = new Set<PreparedDesktopAgentWorkspace>();
  let activeScopeTransition: symbol | undefined;
  let activeStartLeaseCount = 0;
  let settingsRefreshGeneration = 0;
  let settingsRefreshTail: Promise<void> = Promise.resolve();
  let deferredSettingsRefresh:
    | {
        readonly generation: number;
        readonly sourceRuntime: DesktopAgentRuntime;
        retryScheduled: boolean;
      }
    | undefined;

  async function hasWorkspaceActiveRun(): Promise<Result<boolean, UnifiedError>> {
    if (runtime === undefined) return ok(false);
    const listed = await runtime.agentRunSession.listAgentRuns(runtime.workspaceId);
    return listed.ok
      ? ok(listed.value.some((snapshot) => !isTerminal(snapshot.status)))
      : err(listed.error);
  }

  async function hasStandaloneActiveRun(): Promise<Result<boolean, UnifiedError>> {
    if (standaloneRuntime === undefined) return ok(false);
    const listed = await standaloneRuntime.listRunSnapshots();
    return listed.ok
      ? ok(listed.value.some((snapshot) => !isTerminal(snapshot.status)))
      : err(listed.error);
  }

  async function hasActiveRun(): Promise<Result<boolean, UnifiedError>> {
    if (activeStartLeaseCount > 0) return ok(true);
    const [workspace, standalone] = await Promise.all([
      hasWorkspaceActiveRun(),
      hasStandaloneActiveRun()
    ]);
    if (!workspace.ok) return workspace;
    if (!standalone.ok) return standalone;
    return ok(workspace.value || standalone.value);
  }

  function beginScopeTransition(): Result<symbol, UnifiedError> {
    if (activeScopeTransition !== undefined || activeStartLeaseCount > 0) {
      return err(runtimeError("AGENT_RUNTIME_PROJECT_SWITCH_BLOCKED"));
    }
    const transition = Symbol("desktop-agent-runtime-transition");
    activeScopeTransition = transition;
    return ok(transition);
  }

  function endScopeTransition(transition: symbol): void {
    if (activeScopeTransition === transition) activeScopeTransition = undefined;
  }

  function acquireActiveRunStartLease(): Result<DesktopAgentRunStartLease, UnifiedError> {
    if (activeScopeTransition !== undefined) {
      return err(runtimeError("AGENT_RUNTIME_PROJECT_SWITCH_BLOCKED"));
    }
    const session =
      selectedScope === "workspace"
        ? runtime?.agentRunSession
        : selectedScope === "standalone"
          ? standaloneRuntime?.agentRunSession
          : undefined;
    if (session === undefined) return err(runtimeError("AGENT_RUNTIME_PROJECT_SWITCH_BLOCKED"));

    activeStartLeaseCount += 1;
    let released = false;
    return ok({
      session,
      release() {
        if (released) return;
        released = true;
        activeStartLeaseCount -= 1;
      }
    });
  }

  function forwardEvent(
    scope: DesktopAgentRuntimeScope,
    candidate: DesktopAgentRuntime | DesktopStandaloneAgentRuntime,
    event: AgentRunEvent
  ): void {
    if (selectedScope !== scope) return;
    if (scope === "workspace" ? runtime !== candidate : standaloneRuntime !== candidate) return;
    for (const listener of listeners) listener(event);
  }

  async function createStandalone(): Promise<Result<DesktopStandaloneAgentRuntime, UnifiedError>> {
    if (standaloneRuntime !== undefined) return ok(standaloneRuntime);
    const factory = options.createStandaloneRuntime;
    if (factory === undefined) return err(runtimeError("AGENT_STANDALONE_RUNTIME_UNAVAILABLE"));

    let candidate: DesktopStandaloneAgentRuntime;
    try {
      candidate = await factory();
    } catch {
      return err(runtimeError("AGENT_STANDALONE_RUNTIME_CREATE_FAILED"));
    }
    if (candidate.scopeId !== "standalone") {
      candidate.dispose?.();
      return err(runtimeError("AGENT_STANDALONE_RUNTIME_INVALID"));
    }
    try {
      const prepared = await candidate.prepare();
      if (!prepared.ok) {
        candidate.dispose?.();
        return prepared;
      }
      const unsubscribe = candidate.agentRunSession.subscribe((event) => {
        forwardEvent("standalone", candidate, event);
      });
      standaloneRuntime = candidate;
      unsubscribeStandaloneRuntime = unsubscribe;
      return ok(candidate);
    } catch {
      candidate.dispose?.();
      return err(runtimeError("AGENT_STANDALONE_RUNTIME_PREPARE_FAILED"));
    }
  }

  function disposeWorkspaceRuntime(): void {
    unsubscribeRuntime?.();
    unsubscribeRuntime = undefined;
    runtime?.dispose?.();
    runtime = undefined;
    currentBinding = undefined;
  }

  async function stopActiveRunsForSettingsRefresh(
    generation: number
  ): Promise<Result<void, UnifiedError>> {
    // A concurrent user command may advance the run revision while settings are being persisted.
    // Re-list and retry a bounded number of times; never replace the runtime while a run remains.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (generation !== settingsRefreshGeneration) return ok(undefined);
      const currentRuntime = runtime;
      if (currentRuntime === undefined) return ok(undefined);
      const listed = await currentRuntime.agentRunSession.listAgentRuns(currentRuntime.workspaceId);
      if (!listed.ok) return err(listed.error);
      const active = listed.value.filter((snapshot) => !isTerminal(snapshot.status));
      if (active.length === 0) return ok(undefined);

      let shouldRetry = false;
      let mustWaitForTerminal = false;
      for (const snapshot of active) {
        if (generation !== settingsRefreshGeneration) return ok(undefined);
        const stopped = await currentRuntime.agentRunSession.stopAgentRun({
          runId: snapshot.runId,
          projectId: snapshot.projectId,
          commandId: `settings-refresh-${String(generation)}-${snapshot.runId}-${String(snapshot.runRevision)}`,
          expectedRunRevision: snapshot.runRevision
        });
        if (stopped.ok) {
          if (!isTerminal(stopped.value.status)) mustWaitForTerminal = true;
          continue;
        }
        if (stopped.error.code === "AGENT_RUN_REVISION_CONFLICT") {
          shouldRetry = true;
          continue;
        }
        if (stopped.error.code === "AGENT_RUN_ALREADY_TERMINAL") continue;
        return err(stopped.error);
      }
      const remaining = await hasWorkspaceActiveRun();
      if (!remaining.ok) return remaining;
      if (!remaining.value) return ok(undefined);
      if (mustWaitForTerminal || !shouldRetry) {
        return err(runtimeError("AGENT_RUNTIME_SETTINGS_REFRESH_DEFERRED"));
      }
    }
    return err(runtimeError("AGENT_RUNTIME_SETTINGS_REFRESH_DEFERRED"));
  }

  async function refreshWorkspaceAtGeneration(
    generation: number
  ): Promise<Result<void, UnifiedError>> {
    const binding = currentBinding;
    if (binding === undefined || generation !== settingsRefreshGeneration) return ok(undefined);
    const stopped = await stopActiveRunsForSettingsRefresh(generation);
    if (!stopped.ok || generation !== settingsRefreshGeneration) return stopped;
    if (currentBinding !== binding) return ok(undefined);
    const prepared = await manager.prepareWorkspace(binding);
    if (!prepared.ok) return prepared;
    if (generation !== settingsRefreshGeneration || currentBinding !== binding) {
      manager.discardPreparedWorkspace(prepared.value);
      return ok(undefined);
    }
    manager.commitPreparedWorkspace(prepared.value);
    return ok(undefined);
  }

  function scheduleDeferredSettingsRefresh(sourceRuntime: DesktopAgentRuntime): void {
    const deferred = deferredSettingsRefresh;
    if (
      deferred === undefined ||
      deferred.sourceRuntime !== sourceRuntime ||
      deferred.generation !== settingsRefreshGeneration ||
      deferred.retryScheduled ||
      runtime !== sourceRuntime
    ) {
      return;
    }
    deferred.retryScheduled = true;
    const previous = settingsRefreshTail;
    const retry = (async () => {
      await previous;
      if (
        deferredSettingsRefresh !== deferred ||
        deferred.generation !== settingsRefreshGeneration ||
        runtime !== sourceRuntime
      ) {
        return;
      }
      const refreshed = await refreshWorkspaceAtGeneration(deferred.generation);
      if (deferredSettingsRefresh !== deferred) return;
      if (refreshed.ok) {
        deferredSettingsRefresh = undefined;
        return;
      }
      if (refreshed.error.code !== "AGENT_RUNTIME_SETTINGS_REFRESH_DEFERRED") {
        deferredSettingsRefresh = undefined;
        return;
      }
      deferred.retryScheduled = false;
      confirmDeferredSettingsRefresh(deferred);
    })();
    settingsRefreshTail = retry.then(
      () => undefined,
      () => undefined
    );
  }

  function confirmDeferredSettingsRefresh(
    deferred: NonNullable<typeof deferredSettingsRefresh>
  ): void {
    void (async () => {
      const listed = await deferred.sourceRuntime.agentRunSession.listAgentRuns(
        deferred.sourceRuntime.workspaceId
      );
      if (
        deferredSettingsRefresh !== deferred ||
        deferred.generation !== settingsRefreshGeneration ||
        runtime !== deferred.sourceRuntime ||
        !listed.ok
      ) {
        return;
      }
      if (listed.value.every((snapshot) => isTerminal(snapshot.status))) {
        scheduleDeferredSettingsRefresh(deferred.sourceRuntime);
      }
    })();
  }

  function deferSettingsRefresh(generation: number): void {
    const sourceRuntime = runtime;
    if (sourceRuntime === undefined || generation !== settingsRefreshGeneration) return;
    const deferred = {
      generation,
      sourceRuntime,
      retryScheduled: false
    };
    deferredSettingsRefresh = deferred;
    confirmDeferredSettingsRefresh(deferred);
  }

  function revokeCurrentSettingsCapabilities(): void {
    runtime?.revokeSettingsCapabilities?.();
  }

  function revokeCurrentApprovalCapabilities(): void {
    runtime?.revokeApprovalCapabilities?.();
  }

  const manager: DesktopAgentRuntimeManager = {
    async prepareStandalone() {
      if (standalonePreparation !== undefined) return standalonePreparation;
      const preparation = createStandalone();
      standalonePreparation = preparation;
      const clear = () => {
        if (standalonePreparation === preparation) standalonePreparation = undefined;
      };
      void preparation.then(clear, clear);
      return preparation;
    },
    async activateStandalone() {
      const transition = beginScopeTransition();
      if (!transition.ok) return transition;
      try {
        const activeWorkspaceRun = await hasWorkspaceActiveRun();
        if (!activeWorkspaceRun.ok) return activeWorkspaceRun;
        if (activeWorkspaceRun.value)
          return err(runtimeError("AGENT_RUNTIME_PROJECT_SWITCH_BLOCKED"));

        const prepared = await this.prepareStandalone();
        if (!prepared.ok) return prepared;
        const activeAfterPrepare = await hasWorkspaceActiveRun();
        if (!activeAfterPrepare.ok) return activeAfterPrepare;
        if (activeAfterPrepare.value)
          return err(runtimeError("AGENT_RUNTIME_PROJECT_SWITCH_BLOCKED"));
        // A closed workspace has no runtime that can accidentally remain reachable through Main.
        // Standalone remains allocated when a workspace is opened, but the reverse transition tears
        // down workspace-only state after its active-run guard has passed.
        disposeWorkspaceRuntime();
        selectedScope = "standalone";
        options.onActiveRuntimeChanged?.({ scope: "standalone", runtime: prepared.value });
        return ok(undefined);
      } finally {
        endScopeTransition(transition.value);
      }
    },
    async bindWorkspace(binding) {
      if (
        runtime !== undefined &&
        currentBinding !== undefined &&
        isSameBinding(currentBinding, binding, runtime) &&
        selectedScope === "workspace"
      ) {
        return ok(undefined);
      }
      const prepared = await this.prepareWorkspace(binding);
      if (!prepared.ok) return prepared;
      this.commitPreparedWorkspace(prepared.value);
      return ok(undefined);
    },
    async prepareWorkspace(binding) {
      if (
        !isSafeId(binding.workspaceId) ||
        (binding.activeChapterId !== undefined && !isSafeId(binding.activeChapterId))
      ) {
        return err(runtimeError("AGENT_RUNTIME_WORKSPACE_INVALID"));
      }
      const transition = beginScopeTransition();
      if (!transition.ok) return transition;
      let retainTransition = false;
      try {
        let canonicalContentRoot: string;
        let canonicalStateRoot: string;
        try {
          [canonicalContentRoot, canonicalStateRoot] = await Promise.all([
            realpath(binding.contentRoot),
            realpath(binding.stateRoot)
          ]);
        } catch {
          return err(runtimeError("AGENT_RUNTIME_WORKSPACE_ROOT_INVALID"));
        }
        const canonicalBinding: DesktopAgentWorkspaceBinding = {
          ...binding,
          contentRoot: canonicalContentRoot,
          stateRoot: canonicalStateRoot
        };
        const active = await hasActiveRun();
        if (!active.ok) return active;
        if (active.value) return err(runtimeError("AGENT_RUNTIME_PROJECT_SWITCH_BLOCKED"));
        const sourceRuntime = runtime;

        let candidate: DesktopAgentRuntime;
        try {
          candidate = await options.createRuntime(canonicalBinding);
        } catch {
          return err(runtimeError("AGENT_RUNTIME_CREATE_FAILED"));
        }

        let prepareResult: Result<void, UnifiedError>;
        try {
          prepareResult = await candidate.prepare();
        } catch {
          candidate.dispose?.();
          return err(runtimeError("AGENT_RUNTIME_PREPARE_FAILED"));
        }
        if (!prepareResult.ok) {
          candidate.dispose?.();
          return prepareResult;
        }

        const activeBeforeCommit = await hasActiveRun();
        if (!activeBeforeCommit.ok) {
          candidate.dispose?.();
          return activeBeforeCommit;
        }
        if (runtime !== sourceRuntime || activeBeforeCommit.value) {
          candidate.dispose?.();
          return err(runtimeError("AGENT_RUNTIME_PROJECT_SWITCH_BLOCKED"));
        }

        let unsubscribeCandidate: () => void;
        try {
          unsubscribeCandidate = candidate.agentRunSession.subscribe((event) => {
            if (runtime !== candidate) return;
            if (isTerminalRunEvent(event.type)) scheduleDeferredSettingsRefresh(candidate);
            forwardEvent("workspace", candidate, event);
          });
        } catch {
          candidate.dispose?.();
          return err(runtimeError("AGENT_RUNTIME_PREPARE_FAILED"));
        }
        const prepared: PreparedDesktopAgentWorkspace = {
          binding: canonicalBinding,
          runtime: candidate
        };
        preparedStates.set(prepared, {
          unsubscribe: unsubscribeCandidate,
          transition: transition.value,
          state: "prepared"
        });
        pendingPreparations.add(prepared);
        retainTransition = true;
        return ok(prepared);
      } finally {
        if (!retainTransition) endScopeTransition(transition.value);
      }
    },
    commitPreparedWorkspace(prepared) {
      const state = preparedStates.get(prepared);
      if (state === undefined || state.state !== "prepared") return;
      state.state = "committed";
      const previousUnsubscribe = unsubscribeRuntime;
      const previousRuntime = runtime;
      if (selectedScope === "standalone") {
        standaloneRuntime?.releasePromptCacheResources?.();
      }
      runtime = prepared.runtime;
      currentBinding = prepared.binding;
      unsubscribeRuntime = state.unsubscribe;
      selectedScope = "workspace";
      previousUnsubscribe?.();
      previousRuntime?.dispose?.();
      options.onActiveRuntimeChanged?.({
        scope: "workspace",
        binding: prepared.binding,
        runtime: prepared.runtime
      });
      preparedStates.delete(prepared);
      pendingPreparations.delete(prepared);
      endScopeTransition(state.transition);
    },
    discardPreparedWorkspace(prepared) {
      const state = preparedStates.get(prepared);
      if (state === undefined || state.state !== "prepared") return;
      state.state = "discarded";
      state.unsubscribe();
      prepared.runtime.dispose?.();
      preparedStates.delete(prepared);
      pendingPreparations.delete(prepared);
      endScopeTransition(state.transition);
    },
    current: () => (selectedScope === "workspace" ? runtime : undefined),
    standalone: () => standaloneRuntime,
    active: () =>
      selectedScope === "standalone" && standaloneRuntime !== undefined
        ? { scope: "standalone", runtime: standaloneRuntime }
        : selectedScope === "workspace" && runtime !== undefined && currentBinding !== undefined
          ? { scope: "workspace", binding: currentBinding, runtime }
          : undefined,
    activeScope: () => selectedScope,
    acquireActiveRunStartLease,
    currentWorkspace: () =>
      runtime === undefined || selectedScope !== "workspace"
        ? undefined
        : {
            workspaceId: runtime.workspaceId,
            contentRoot: runtime.contentRoot,
            stateRoot: runtime.stateRoot
          },
    async refreshCurrentWorkspace() {
      const generation = ++settingsRefreshGeneration;
      deferredSettingsRefresh = undefined;
      // Settings are already changed when this entry point runs. Revoke first so no continuation can
      // cross the await/list/stop window with the old executor or policy still reachable.
      revokeCurrentSettingsCapabilities();
      const previous = settingsRefreshTail;
      const result = (async () => {
        await previous;
        if (generation !== settingsRefreshGeneration) return ok(undefined);
        const refreshed = await refreshWorkspaceAtGeneration(generation);
        if (!refreshed.ok) {
          if (refreshed.error.code === "AGENT_RUNTIME_SETTINGS_REFRESH_DEFERRED") {
            deferSettingsRefresh(generation);
          }
        }
        return refreshed;
      })();
      settingsRefreshTail = result.then(
        () => undefined,
        () => undefined
      );
      return result;
    },
    revokeCurrentSettingsCapabilities,
    revokeCurrentApprovalCapabilities,
    hasActiveRun,
    subscribeAgentRunEvents(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      settingsRefreshGeneration += 1;
      deferredSettingsRefresh = undefined;
      disposeWorkspaceRuntime();
      unsubscribeStandaloneRuntime?.();
      unsubscribeStandaloneRuntime = undefined;
      standaloneRuntime?.dispose?.();
      standaloneRuntime = undefined;
      selectedScope = undefined;
      options.onActiveRuntimeChanged?.(undefined);
      for (const prepared of [...pendingPreparations]) {
        this.discardPreparedWorkspace(prepared);
      }
      listeners.clear();
    }
  };
  return manager;
}

function isSameBinding(
  current: DesktopAgentWorkspaceBinding,
  next: DesktopAgentWorkspaceBinding,
  activeRuntime: DesktopAgentRuntime
): boolean {
  return (
    activeRuntime.workspaceId === next.workspaceId &&
    activeRuntime.contentRoot === next.contentRoot &&
    activeRuntime.stateRoot === next.stateRoot &&
    current.kind === next.kind &&
    current.activeChapterId === next.activeChapterId
  );
}

function isTerminal(status: AgentRunSnapshot["status"]): boolean {
  return (
    status === "completed" ||
    status === "blocked" ||
    status === "cancelled" ||
    status === "failed" ||
    status === "limit_reached" ||
    status === "capability_changed"
  );
}

function isTerminalRunEvent(type: AgentRunEvent["type"]): boolean {
  return (
    type === "run_completed" ||
    type === "run_blocked" ||
    type === "run_cancelled" ||
    type === "run_failed" ||
    type === "run_limit_reached" ||
    type === "capability_changed"
  );
}

function isSafeId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(value);
}

function runtimeError(code: string): UnifiedError {
  const standalone = code.startsWith("AGENT_STANDALONE_");
  return createUnifiedError({
    code,
    category: "AgentError",
    message: standalone
      ? "The standalone Agent runtime could not be initialized."
      : "The Agent runtime could not switch workspaces.",
    recoverability: "user-action",
    suggestedAction: standalone
      ? "Check application storage and model settings, then retry."
      : "Stop the active run or reopen the workspace and retry.",
    traceId: "desktop-agent-runtime-manager"
  });
}
