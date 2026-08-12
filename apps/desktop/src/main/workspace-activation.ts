import { toProjectWorkspaceSnapshotDto } from "@novel-studio/application";
import type {
  CreateCreativeProjectInput,
  CreativeProjectFileSession,
  DesktopApplication,
  DesktopShellState,
  PreparedWorkspaceActivation,
  PreparedCreativeProjectImport,
  ImportCreativeProjectInput,
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
  importCreativeProject(input: ImportCreativeProjectInput): Promise<
    Result<
      Omit<PreparedCreativeProjectImport, "activation"> & {
        readonly activation: WorkspaceActivationDto;
      },
      UnifiedError
    >
  >;
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
    importCreativeProject: async (input) => {
      const candidate = await options.application.prepareImportCreativeProject(input);
      if (!candidate.ok) return candidate;
      const activated = await activatePrepared(candidate.value.activation);
      if (!activated.ok) return activated;
      return ok({ ...candidate.value, activation: activated.value });
    },
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
    return activatePrepared(candidate.value);
  }

  async function activatePrepared(
    candidate: PreparedWorkspaceActivation
  ): Promise<Result<WorkspaceActivationDto, UnifiedError>> {
    options.clearCreativeGeneralActiveResourceProof?.();
    const preparedRuntime = await options.runtimeManager.prepareWorkspace(
      toDesktopAgentWorkspaceBinding(candidate)
    );
    if (!preparedRuntime.ok) {
      await options.application.discardWorkspaceActivation(candidate.activationId);
      return err(preparedRuntime.error);
    }
    if ("creativeProject" in candidate && options.creativeProjectFileSession !== undefined) {
      const preparedFiles = await options.creativeProjectFileSession.activate({
        projectId: candidate.creativeProject.project.projectId,
        workspaceId: candidate.context.workspaceId,
        projectRoot: candidate.context.contentRoot,
        stateRoot: candidate.context.stateRoot
      });
      if (!preparedFiles.ok) {
        options.runtimeManager.discardPreparedWorkspace(preparedRuntime.value);
        await options.application.discardWorkspaceActivation(candidate.activationId);
        return err(preparedFiles.error);
      }
    }
    const committed = options.application.commitWorkspaceActivation(candidate.activationId);
    options.runtimeManager.commitPreparedWorkspace(preparedRuntime.value);
    let activation = committed;
    if ("creativeProject" in candidate) {
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
    const finalized = await options.application.finalizeWorkspaceActivation(candidate.activationId);
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
