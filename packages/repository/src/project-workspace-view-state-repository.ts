import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { err, ok, type JsonObject, type Result, type UnifiedError } from "@novel-studio/shared";

import {
  createProjectPathGuard,
  verifyProjectStoragePath,
  writeTextAtomically,
  type ProjectPathGuard
} from "./atomic-write.js";
import { storageError } from "./errors.js";

export interface ProjectWorkspaceViewState extends JsonObject {
  readonly schemaVersion: "1.0";
  readonly activeChapterId?: string;
  readonly updatedAt: string;
}

export interface ProjectWorkspaceViewStateFileRepositoryOptions {
  readonly projectRoot: string;
  readonly traceId?: string;
}

export class ProjectWorkspaceViewStateFileRepository {
  private readonly filePath: string;
  private readonly traceId: string;
  private readonly pathGuard: ProjectPathGuard;

  public constructor(private readonly options: ProjectWorkspaceViewStateFileRepositoryOptions) {
    this.filePath = join(options.projectRoot, ".novel-studio", "workspace-view.json");
    this.traceId = options.traceId ?? "trace_project_workspace_view_state";
    this.pathGuard = createProjectPathGuard(options.projectRoot);
  }

  public async readWorkspaceViewState(): Promise<
    Result<ProjectWorkspaceViewState | undefined, UnifiedError>
  > {
    const checked = await verifyProjectStoragePath(this.pathGuard, this.filePath, this.traceId);
    if (!checked.ok) return checked;

    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as unknown;
      return ok(isProjectWorkspaceViewState(parsed) ? parsed : undefined);
    } catch (error) {
      if (isMissingFileError(error) || error instanceof SyntaxError) {
        return ok(undefined);
      }

      return err(
        storageError({
          code: "PROJECT_WORKSPACE_VIEW_STATE_READ_FAILED",
          message: "Workspace view state could not be read.",
          suggestedAction: "Reopen the project and select a chapter.",
          traceId: this.traceId,
          redactedDetail: {
            reason: error instanceof Error ? error.message : "Unknown read error"
          }
        })
      );
    }
  }

  public async writeWorkspaceViewState(
    viewState: ProjectWorkspaceViewState
  ): Promise<Result<ProjectWorkspaceViewState, UnifiedError>> {
    const written = await writeTextAtomically({
      targetPath: this.filePath,
      content: `${JSON.stringify(viewState, null, 2)}\n`,
      traceId: this.traceId,
      pathGuard: this.pathGuard
    });
    return written.ok ? ok(viewState) : written;
  }
}

function isProjectWorkspaceViewState(value: unknown): value is ProjectWorkspaceViewState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record["schemaVersion"] === "1.0" &&
    typeof record["updatedAt"] === "string" &&
    (record["activeChapterId"] === undefined ||
      (typeof record["activeChapterId"] === "string" && record["activeChapterId"].length > 0))
  );
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "ENOENT"
  );
}
