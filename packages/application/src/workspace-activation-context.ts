import type { WorkspaceCapability, WorkspaceContextDto } from "@novel-studio/shared";

export type WorkspaceActivationContext =
  | {
      readonly kind: "creativeProject";
      readonly workspaceId: string;
      readonly projectId: string;
      readonly displayName: string;
      readonly contentRoot: string;
      readonly stateRoot: string;
      readonly capabilities: readonly WorkspaceCapability[];
    }
  | {
      readonly kind: "engineeringWorkspace";
      readonly workspaceId: string;
      readonly displayName: string;
      readonly contentRoot: string;
      readonly stateRoot: string;
      readonly capabilities: readonly WorkspaceCapability[];
    };

export function toWorkspaceContextDto(context: WorkspaceActivationContext): WorkspaceContextDto {
  return context.kind === "creativeProject"
    ? {
        kind: context.kind,
        workspaceId: context.workspaceId,
        projectId: context.projectId,
        displayName: context.displayName,
        capabilities: context.capabilities
      }
    : {
        kind: context.kind,
        workspaceId: context.workspaceId,
        displayName: context.displayName,
        capabilities: context.capabilities
      };
}
