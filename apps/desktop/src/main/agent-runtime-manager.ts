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

export interface DesktopAgentRuntimeManager {
  bindWorkspace(binding: DesktopAgentWorkspaceBinding): Promise<Result<void, UnifiedError>>;
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
      if (
        runtime?.workspaceId === binding.workspaceId &&
        runtime.contentRoot === canonicalContentRoot &&
        runtime.stateRoot === canonicalStateRoot &&
        currentBinding?.kind === canonicalBinding.kind &&
        currentBinding.activeChapterId === canonicalBinding.activeChapterId
      ) {
        return ok(undefined);
      }
      const active = await hasActiveRun();
      if (!active.ok) return active;
      if (active.value) return err(runtimeError("AGENT_RUNTIME_PROJECT_SWITCH_BLOCKED"));

      let candidate: DesktopAgentRuntime;
      try {
        candidate = options.createRuntime(canonicalBinding);
      } catch {
        return err(runtimeError("AGENT_RUNTIME_CREATE_FAILED"));
      }

      let prepared: Result<void, UnifiedError>;
      try {
        prepared = await candidate.prepare();
      } catch {
        candidate.dispose?.();
        return err(runtimeError("AGENT_RUNTIME_PREPARE_FAILED"));
      }
      if (!prepared.ok) {
        candidate.dispose?.();
        return prepared;
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

      unsubscribeRuntime?.();
      runtime?.dispose?.();
      runtime = candidate;
      currentBinding = canonicalBinding;
      unsubscribeRuntime = unsubscribeCandidate;
      return ok(undefined);
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
      listeners.clear();
    }
  };
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
