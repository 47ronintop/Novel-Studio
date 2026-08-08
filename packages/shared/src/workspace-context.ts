export type WorkbenchMode = "creative" | "engineering";
export type CreativeNavigatorMode = "writing" | "story" | "files";

export type WorkspaceCapability =
  | "creativeWorkbench"
  | "engineeringWorkbench"
  | "writingContext"
  | "generalFileContext"
  | "creativeSearch"
  | "creativeStudio";

export type WorkspaceContextDto =
  | { readonly kind: "none" }
  | {
      readonly kind: "creativeProject";
      readonly workspaceId: string;
      readonly projectId: string;
      readonly displayName: string;
      readonly capabilities: readonly WorkspaceCapability[];
    }
  | {
      readonly kind: "engineeringWorkspace";
      readonly workspaceId: string;
      readonly displayName: string;
      readonly capabilities: readonly WorkspaceCapability[];
    };

export const EMPTY_WORKSPACE_CONTEXT: WorkspaceContextDto = { kind: "none" };

export function resolveWorkbenchModeForContext(
  preferred: WorkbenchMode,
  context: WorkspaceContextDto
): WorkbenchMode {
  if (context.kind === "engineeringWorkspace") return "engineering";
  return context.kind === "none" ? "creative" : preferred;
}
