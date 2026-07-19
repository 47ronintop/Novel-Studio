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
  hasActiveRun(): Promise<Result<boolean, UnifiedError>>;
  subscribeAgentRunEvents(listener: (event: AgentRunEvent) => void): () => void;
  dispose(): void;
}

export interface CreateDesktopAgentRuntimeManagerOptions {
  readonly createRuntime: (binding: DesktopAgentWorkspaceBinding) => DesktopAgentRuntime;
}

export function createDesktopAgentRuntimeManager(
  options: CreateDesktopAgentRuntimeManagerOptions
): DesktopAgentRuntimeManager {
  let runtime: DesktopAgentRuntime | undefined;
  let currentBinding: DesktopAgentWorkspaceBinding | undefined;
  let unsubscribeRuntime: (() => void) | undefined;
  const listeners = new Set<(event: AgentRunEvent) => void>();
  const preparedStates = new Map<PreparedDesktopAgentWorkspace, {
    readonly unsubscribe: () => void;
    state: "prepared" | "committed" | "discarded";
  }>();
  const pendingPreparations = new Set<PreparedDesktopAgentWorkspace>();

  async function hasActiveRun(): Promise<Result<boolean, UnifiedError>> {
    if (runtime === undefined) return ok(false);
    const listed = await runtime.agentRunSession.listAgentRuns(runtime.workspaceId);
    return listed.ok
      ? ok(listed.value.some((snapshot) => !isTerminal(snapshot.status)))
      : err(listed.error);
  }

  return {
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
        candidate = options.createRuntime(canonicalBinding);
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
