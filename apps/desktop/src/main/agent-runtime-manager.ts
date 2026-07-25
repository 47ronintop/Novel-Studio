import { realpath } from "node:fs/promises";

import type {
  AgentContextSession,
  AgentConversationSession,
  AgentPermissionSession,
  AgentPlanExecutionSession,
  AgentRunDraftSession,
  AgentRunSession,
  AgentUsageSession
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

export interface DesktopAgentRuntime {
  readonly workspaceId: string;
  readonly contentRoot: string;
  readonly stateRoot: string;
  readonly agentRunSession: AgentRunSession;
  readonly agentConversationSession: AgentConversationSession;
  readonly agentRunDraftSession: AgentRunDraftSession;
  readonly agentContextSession: AgentContextSession;
  readonly agentPermissionSession: AgentPermissionSession;
  readonly agentPlanExecutionSession: AgentPlanExecutionSession;
  readonly agentUsageSession?: AgentUsageSession;
  readonly prepare: () => Promise<Result<void, UnifiedError>>;
  readonly dispose?: () => void;
  /** Fail-close settings-backed capability/executor access without waiting for a rebuild. */
  readonly revokeSettingsCapabilities?: () => void;
}

export interface PreparedDesktopAgentWorkspace {
  readonly binding: DesktopAgentWorkspaceBinding;
  readonly runtime: DesktopAgentRuntime;
}

export type DesktopAgentWorkspacePreparation = PreparedDesktopAgentWorkspace;

export interface DesktopAgentRuntimeManager {
  bindWorkspace(binding: DesktopAgentWorkspaceBinding): Promise<Result<void, UnifiedError>>;
  prepareWorkspace(
    binding: DesktopAgentWorkspaceBinding
  ): Promise<Result<PreparedDesktopAgentWorkspace, UnifiedError>>;
  commitPreparedWorkspace(prepared: PreparedDesktopAgentWorkspace): void;
  discardPreparedWorkspace(prepared: PreparedDesktopAgentWorkspace): void;
  current(): DesktopAgentRuntime | undefined;
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
  hasActiveRun(): Promise<Result<boolean, UnifiedError>>;
  subscribeAgentRunEvents(listener: (event: AgentRunEvent) => void): () => void;
  dispose(): void;
}

export interface CreateDesktopAgentRuntimeManagerOptions {
  readonly createRuntime: (
    binding: DesktopAgentWorkspaceBinding
  ) => DesktopAgentRuntime | Promise<DesktopAgentRuntime>;
}

export function createDesktopAgentRuntimeManager(
  options: CreateDesktopAgentRuntimeManagerOptions
): DesktopAgentRuntimeManager {
  let runtime: DesktopAgentRuntime | undefined;
  let currentBinding: DesktopAgentWorkspaceBinding | undefined;
  let unsubscribeRuntime: (() => void) | undefined;
  const listeners = new Set<(event: AgentRunEvent) => void>();
  const preparedStates = new Map<
    PreparedDesktopAgentWorkspace,
    {
      readonly unsubscribe: () => void;
      state: "prepared" | "committed" | "discarded";
    }
  >();
  const pendingPreparations = new Set<PreparedDesktopAgentWorkspace>();
  let settingsRefreshGeneration = 0;
  let settingsRefreshTail: Promise<void> = Promise.resolve();

  async function hasActiveRun(): Promise<Result<boolean, UnifiedError>> {
    if (runtime === undefined) return ok(false);
    const listed = await runtime.agentRunSession.listAgentRuns(runtime.workspaceId);
    return listed.ok
      ? ok(listed.value.some((snapshot) => !isTerminal(snapshot.status)))
      : err(listed.error);
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
      for (const snapshot of active) {
        if (generation !== settingsRefreshGeneration) return ok(undefined);
        const stopped = await currentRuntime.agentRunSession.stopAgentRun({
          runId: snapshot.runId,
          projectId: snapshot.projectId,
          commandId: `settings-refresh-${String(generation)}-${snapshot.runId}-${String(snapshot.runRevision)}`,
          expectedRunRevision: snapshot.runRevision
        });
        if (stopped.ok) continue;
        if (stopped.error.code === "AGENT_RUN_REVISION_CONFLICT") {
          shouldRetry = true;
          continue;
        }
        if (stopped.error.code === "AGENT_RUN_ALREADY_TERMINAL") continue;
        return err(stopped.error);
      }
      if (!shouldRetry) {
        const remaining = await hasActiveRun();
        if (!remaining.ok) return remaining;
        if (!remaining.value) return ok(undefined);
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

  function revokeCurrentSettingsCapabilities(): void {
    runtime?.revokeSettingsCapabilities?.();
  }

  const manager: DesktopAgentRuntimeManager = {
    async bindWorkspace(binding) {
      if (
        runtime !== undefined &&
        currentBinding !== undefined &&
        isSameBinding(currentBinding, binding, runtime)
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

      let unsubscribeCandidate: () => void;
      try {
        unsubscribeCandidate = candidate.agentRunSession.subscribe((event) => {
          if (runtime !== candidate) return;
          for (const listener of listeners) listener(event);
        });
      } catch {
        candidate.dispose?.();
        return err(runtimeError("AGENT_RUNTIME_PREPARE_FAILED"));
      }
      const prepared: PreparedDesktopAgentWorkspace = {
        binding: canonicalBinding,
        runtime: candidate
      };
      preparedStates.set(prepared, { unsubscribe: unsubscribeCandidate, state: "prepared" });
      pendingPreparations.add(prepared);
      return ok(prepared);
    },
    commitPreparedWorkspace(prepared) {
      const state = preparedStates.get(prepared);
      if (state === undefined || state.state !== "prepared") return;
      state.state = "committed";
      const previousUnsubscribe = unsubscribeRuntime;
      const previousRuntime = runtime;
      runtime = prepared.runtime;
      currentBinding = prepared.binding;
      unsubscribeRuntime = state.unsubscribe;
      previousUnsubscribe?.();
      previousRuntime?.dispose?.();
      preparedStates.delete(prepared);
      pendingPreparations.delete(prepared);
    },
    discardPreparedWorkspace(prepared) {
      const state = preparedStates.get(prepared);
      if (state === undefined || state.state !== "prepared") return;
      state.state = "discarded";
      state.unsubscribe();
      prepared.runtime.dispose?.();
      preparedStates.delete(prepared);
      pendingPreparations.delete(prepared);
    },
    current: () => runtime,
    currentWorkspace: () =>
      runtime === undefined
        ? undefined
        : {
            workspaceId: runtime.workspaceId,
            contentRoot: runtime.contentRoot,
            stateRoot: runtime.stateRoot
          },
    async refreshCurrentWorkspace() {
      const generation = ++settingsRefreshGeneration;
      const previous = settingsRefreshTail;
      const result = (async () => {
        await previous;
        if (generation !== settingsRefreshGeneration) return ok(undefined);
        const refreshed = await refreshWorkspaceAtGeneration(generation);
        if (!refreshed.ok) revokeCurrentSettingsCapabilities();
        return refreshed;
      })();
      settingsRefreshTail = result.then(
        () => undefined,
        () => undefined
      );
      return result;
    },
    revokeCurrentSettingsCapabilities,
    hasActiveRun,
    subscribeAgentRunEvents(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      unsubscribeRuntime?.();
      unsubscribeRuntime = undefined;
      runtime?.dispose?.();
      runtime = undefined;
      currentBinding = undefined;
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
    status === "cancelled" ||
    status === "failed" ||
    status === "limit_reached"
  );
}

function isSafeId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(value);
}

function runtimeError(code: string): UnifiedError {
  return createUnifiedError({
    code,
    category: "AgentError",
    message: "The Agent runtime could not switch workspaces.",
    recoverability: "user-action",
    suggestedAction: "Stop the active run or reopen the workspace and retry.",
    traceId: "desktop-agent-runtime-manager"
  });
}
