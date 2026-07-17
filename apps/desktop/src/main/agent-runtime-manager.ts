import { realpath } from "node:fs/promises";

import type {
  AgentContextSession,
  AgentConversationSession,
  AgentPermissionSession,
  AgentPlanExecutionSession,
  AgentRunDraftSession,
  AgentRunSession
} from "@novel-studio/application";
import type { AgentRunEvent, AgentRunSnapshot } from "@novel-studio/agent-engine";
import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

export interface DesktopAgentProjectBinding {
  readonly projectId: string;
  readonly projectRoot: string;
  readonly activeChapterId: string;
}

export interface DesktopAgentRuntime {
  readonly projectId: string;
  readonly projectRoot: string;
  readonly agentRunSession: AgentRunSession;
  readonly agentConversationSession: AgentConversationSession;
  readonly agentRunDraftSession?: AgentRunDraftSession;
  readonly agentContextSession?: AgentContextSession;
  readonly agentPermissionSession?: AgentPermissionSession;
  readonly agentPlanExecutionSession?: AgentPlanExecutionSession;
  dispose?(): void;
}

export interface DesktopAgentRuntimeManager {
  bindProject(binding: DesktopAgentProjectBinding): Promise<Result<void, UnifiedError>>;
  current(): DesktopAgentRuntime | undefined;
  currentProject(): { readonly projectId: string; readonly projectRoot: string } | undefined;
  hasActiveRun(): Promise<Result<boolean, UnifiedError>>;
  subscribeAgentRunEvents(listener: (event: AgentRunEvent) => void): () => void;
  dispose(): void;
}

export interface CreateDesktopAgentRuntimeManagerOptions {
  readonly createRuntime: (binding: DesktopAgentProjectBinding) => DesktopAgentRuntime;
}

export function createDesktopAgentRuntimeManager(
  options: CreateDesktopAgentRuntimeManagerOptions
): DesktopAgentRuntimeManager {
  let runtime: DesktopAgentRuntime | undefined;
  let unsubscribeRuntime: (() => void) | undefined;
  const listeners = new Set<(event: AgentRunEvent) => void>();

  async function hasActiveRun(): Promise<Result<boolean, UnifiedError>> {
    if (runtime === undefined) return ok(false);
    const listed = await runtime.agentRunSession.listAgentRuns(runtime.projectId);
    return listed.ok
      ? ok(listed.value.some((snapshot) => !isTerminal(snapshot.status)))
      : err(listed.error);
  }

  return {
    async bindProject(binding) {
      if (!isSafeId(binding.projectId) || !isSafeId(binding.activeChapterId)) {
        return err(runtimeError("AGENT_RUNTIME_PROJECT_INVALID"));
      }
      let canonicalRoot: string;
      try {
        canonicalRoot = await realpath(binding.projectRoot);
      } catch {
        return err(runtimeError("AGENT_RUNTIME_PROJECT_ROOT_INVALID"));
      }
      if (runtime?.projectId === binding.projectId && runtime.projectRoot === canonicalRoot) {
        return ok(undefined);
      }
      const active = await hasActiveRun();
      if (!active.ok) return active;
      if (active.value) return err(runtimeError("AGENT_RUNTIME_PROJECT_SWITCH_BLOCKED"));

      let next: DesktopAgentRuntime;
      try {
        next = options.createRuntime({ ...binding, projectRoot: canonicalRoot });
      } catch {
        return err(runtimeError("AGENT_RUNTIME_CREATE_FAILED"));
      }
      unsubscribeRuntime?.();
      runtime?.dispose?.();
      runtime = next;
      unsubscribeRuntime = next.agentRunSession.subscribe((event) => {
        for (const listener of listeners) listener(event);
      });
      return ok(undefined);
    },
    current: () => runtime,
    currentProject: () =>
      runtime === undefined
        ? undefined
        : { projectId: runtime.projectId, projectRoot: runtime.projectRoot },
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
    message: "The Agent runtime could not switch projects.",
    recoverability: "user-action",
    suggestedAction: "Stop the active run or reopen the project and retry.",
    traceId: "desktop-agent-runtime-manager"
  });
}
