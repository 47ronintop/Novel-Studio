import { toProjectWorkspaceSnapshotDto } from "@novel-studio/application";
import type {
  CreateCreativeProjectInput,
  CreativeProjectFileSession,
  DesktopApplication,
  DesktopShellState,
  PreparedWorkspaceActivation,
  WorkspaceActivationDto
} from "@novel-studio/application";
import { err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import type {
  DesktopAgentRuntimeManager,
  DesktopAgentWorkspaceBinding
} from "./agent-runtime-manager.js";

export interface WorkspaceActivationCoordinator {
  openCreativeProject(projectRoot: string): Promise<Result<WorkspaceActivationDto, UnifiedError>>;
  createCreativeProject(
    input: CreateCreativeProjectInput
  ): Promise<Result<WorkspaceActivationDto, UnifiedError>>;
  openEngineeringWorkspace(
    contentRoot: string
  ): Promise<Result<WorkspaceActivationDto, UnifiedError>>;
  closeCurrentWorkspace(): Promise<Result<DesktopShellState, UnifiedError>>;
}

export interface CreateWorkspaceActivationCoordinatorOptions {
  readonly application: DesktopApplication;
  readonly runtimeManager: DesktopAgentRuntimeManager;
  readonly creativeProjectFileSession?: CreativeProjectFileSession;
  /** Clears the Main-owned creative Files-surface proof before a workspace transition commits. */
  readonly clearCreativeGeneralActiveResourceProof?: () => void;
  readonly reportCleanupFailure?: ((error: UnifiedError) => void) | undefined;
}

export function createWorkspaceActivationCoordinator(
  options: CreateWorkspaceActivationCoordinatorOptions
): WorkspaceActivationCoordinator {
  return {
    openCreativeProject: (projectRoot) =>
      activate(() => options.application.prepareOpenCreativeProject(projectRoot)),
    createCreativeProject: (input) =>
      activate(() => options.application.prepareCreateCreativeProject(input)),
    openEngineeringWorkspace: (contentRoot) =>
      activate(() => options.application.prepareOpenEngineeringWorkspace(contentRoot)),
    closeCurrentWorkspace
  };

  async function closeCurrentWorkspace(): Promise<Result<DesktopShellState, UnifiedError>> {
    const allowed = options.application.canCloseWorkspace();
    if (!allowed.ok) return allowed;
    const active = options.runtimeManager.active();
    const rollbackBinding = active?.scope === "workspace" ? active.binding : undefined;
    const standalone = await options.runtimeManager.activateStandalone();
    if (!standalone.ok) return standalone;

    const closed = await options.application.closeWorkspace();
    if (!closed.ok) {
      if (rollbackBinding !== undefined) {
        const restored = await options.runtimeManager.bindWorkspace(rollbackBinding);
        if (!restored.ok) options.reportCleanupFailure?.(restored.error);
      }
      return closed;
    }
    options.creativeProjectFileSession?.deactivate();
    options.clearCreativeGeneralActiveResourceProof?.();
    return closed;
  }

  async function activate(
    prepareApplication: () => Promise<Result<PreparedWorkspaceActivation, UnifiedError>>
  ): Promise<Result<WorkspaceActivationDto, UnifiedError>> {
    const candidate = await prepareApplication();
    if (!candidate.ok) return candidate;
    options.clearCreativeGeneralActiveResourceProof?.();

    const preparedRuntime = await options.runtimeManager.prepareWorkspace(
      toDesktopAgentWorkspaceBinding(candidate.value)
    );
    if (!preparedRuntime.ok) {
      await options.application.discardWorkspaceActivation(candidate.value.activationId);
      return err(preparedRuntime.error);
    }

    if ("creativeProject" in candidate.value && options.creativeProjectFileSession !== undefined) {
      const preparedFiles = await options.creativeProjectFileSession.activate({
        projectId: candidate.value.creativeProject.project.projectId,
        workspaceId: candidate.value.context.workspaceId,
        projectRoot: candidate.value.context.contentRoot,
        stateRoot: candidate.value.context.stateRoot
      });
      if (!preparedFiles.ok) {
        options.runtimeManager.discardPreparedWorkspace(preparedRuntime.value);
        await options.application.discardWorkspaceActivation(candidate.value.activationId);
        return err(preparedFiles.error);
      }
    }

    const committed = options.application.commitWorkspaceActivation(candidate.value.activationId);
    options.runtimeManager.commitPreparedWorkspace(preparedRuntime.value);
    let activation = committed;
    if ("creativeProject" in candidate.value) {
      const refreshed = await options.application.refreshActiveProjectWorkspace();
      if (refreshed.ok && "creativeProject" in committed) {
        activation = {
          ...committed,
          creativeProject: toProjectWorkspaceSnapshotDto(refreshed.value)
        };
      } else if (!refreshed.ok) {
        try {
          options.reportCleanupFailure?.(refreshed.error);
        } catch {
          // The activation is already committed; reporting must not split Renderer and main state.
        }
      }
    } else {
      options.creativeProjectFileSession?.deactivate();
    }
    const finalized = await options.application.finalizeWorkspaceActivation(
      candidate.value.activationId
    );
    if (!finalized.ok) {
      try {
        options.reportCleanupFailure?.(finalized.error);
      } catch {
        // The activation is already committed; reporting must not split Renderer and main state.
      }
    }
    return ok(activation);
  }
}

export function toDesktopAgentWorkspaceBinding(
  activation: PreparedWorkspaceActivation
): DesktopAgentWorkspaceBinding {
  if ("creativeProject" in activation) {
    return {
      kind: "creativeProject",
      workspaceId: activation.context.workspaceId,
      contentRoot: activation.context.contentRoot,
      stateRoot: activation.context.stateRoot,
      ...(activation.context.activeChapterId === undefined
        ? {}
        : { activeChapterId: activation.context.activeChapterId })
    };
  }

  return {
    kind: "engineeringWorkspace",
    workspaceId: activation.context.workspaceId,
    contentRoot: activation.context.contentRoot,
    stateRoot: activation.context.stateRoot
  };
}
