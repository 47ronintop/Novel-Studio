import type {
  CreateCreativeProjectInput,
  DesktopApplication,
  PreparedWorkspaceActivation,
  WorkspaceActivationDto
} from "@novel-studio/application";
import { err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import type {
  DesktopAgentRuntimeManager,
  DesktopAgentWorkspaceBinding
} from "./agent-runtime-manager.js";

export interface WorkspaceActivationCoordinator {
  openCreativeProject(
    projectRoot: string
  ): Promise<Result<WorkspaceActivationDto, UnifiedError>>;
  createCreativeProject(
    input: CreateCreativeProjectInput
  ): Promise<Result<WorkspaceActivationDto, UnifiedError>>;
  openEngineeringWorkspace(
    contentRoot: string
  ): Promise<Result<WorkspaceActivationDto, UnifiedError>>;
}

export interface CreateWorkspaceActivationCoordinatorOptions {
  readonly application: DesktopApplication;
  readonly runtimeManager: DesktopAgentRuntimeManager;
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
      activate(() => options.application.prepareOpenEngineeringWorkspace(contentRoot))
  };

  async function activate(
    prepareApplication: () => Promise<Result<PreparedWorkspaceActivation, UnifiedError>>
  ): Promise<Result<WorkspaceActivationDto, UnifiedError>> {
    const candidate = await prepareApplication();
    if (!candidate.ok) return candidate;

    const preparedRuntime = await options.runtimeManager.prepareWorkspace(
      toDesktopAgentWorkspaceBinding(candidate.value)
    );
    if (!preparedRuntime.ok) {
      await options.application.discardWorkspaceActivation(candidate.value.activationId);
      return err(preparedRuntime.error);
    }

    const committed = options.application.commitWorkspaceActivation(candidate.value.activationId);
    options.runtimeManager.commitPreparedWorkspace(preparedRuntime.value);
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
    return ok(committed);
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
