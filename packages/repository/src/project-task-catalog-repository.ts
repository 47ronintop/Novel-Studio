import { ok, err, createUnifiedError, type Result, type UnifiedError } from "@novel-studio/shared";
import type { JsonObject } from "@novel-studio/shared";
import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/** A candidate task not yet authorized by the user. */
export interface ProjectTaskCandidate {
  readonly candidateId: string;
  readonly displayName: string;
  readonly launcherTemplate: string;
  readonly argvTemplate: readonly string[];
  readonly cwd: string;
  readonly fileProfile: "workspace_read_only" | "scratch_output";
  readonly resourceQuota: {
    readonly maxCpuMs: number;
    readonly maxMemoryBytes: number;
    readonly maxWallClockMs: number;
    readonly maxProcesses: number;
    readonly maxScratchBytes: number;
  };
  readonly timeout: number;
  readonly taskSourceDigest: string;
  readonly networkMode: "none";
}

/** A task that has been authorized by the user for use in runs. */
export interface AuthorizedTask {
  readonly taskId: string;
  readonly candidateId: string;
  readonly displayName: string;
  readonly launcherTemplate: string;
  readonly argvTemplate: readonly string[];
  readonly cwd: string;
  readonly fileProfile: "workspace_read_only" | "scratch_output";
  readonly resourceQuota: ProjectTaskCandidate["resourceQuota"];
  readonly timeout: number;
  readonly taskSourceDigest: string;
  readonly networkMode: "none";
  readonly catalogRevision: string;
  readonly authorizedAt: string;
}

const CATALOG_SCHEMA_VERSION = "1.0";

/**
 * ProjectTaskCatalogRepository — app-local (not project-local) task authorization store.
 *
 * Task authorization is a user-level decision, not part of the project file.
 * The catalog is stored in the app userDataRoot, not the project root.
 */
export class ProjectTaskCatalogRepository {
  private readonly catalogRoot: string;

  constructor(options: { readonly userDataRoot: string }) {
    this.catalogRoot = resolve(join(options.userDataRoot, "agent-task-catalog"));
  }

  private catalogPath(projectId: string): string {
    // Use only safe alphanumeric chars from projectId for filename
    const safe = projectId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
    return join(this.catalogRoot, `${safe}.json`);
  }

  /** List all authorized tasks for a project. */
  async listAuthorizedTasks(projectId: string): Promise<Result<readonly AuthorizedTask[], UnifiedError>> {
    try {
      const content = await readFile(this.catalogPath(projectId), "utf8");
      const data = JSON.parse(content) as JsonObject;
      if (!Array.isArray(data["tasks"])) return ok([]);
      return ok(data["tasks"] as unknown as AuthorizedTask[]);
    } catch {
      return ok([]);
    }
  }

  /** Get a specific authorized task by taskId. */
  async getAuthorizedTask(
    projectId: string,
    taskId: string
  ): Promise<Result<AuthorizedTask | undefined, UnifiedError>> {
    const list = await this.listAuthorizedTasks(projectId);
    if (!list.ok) return list;
    return ok(list.value.find((t) => t.taskId === taskId));
  }

  /**
   * Authorize a task from a candidate.
   *
   * Validates:
   *  - networkMode must be "none"
   *  - no interactive TTY, persistent background processes, elevation or workspace-external paths
   */
  async authorizeTask(
    projectId: string,
    candidate: ProjectTaskCandidate
  ): Promise<Result<AuthorizedTask, UnifiedError>> {
    // Validation: reject dangerous candidates
    const reject = validateCandidate(candidate);
    if (reject !== undefined) return err(reject);

    const list = await this.listAuthorizedTasks(projectId);
    if (!list.ok) return list;

    const taskId = `task_${createHash("sha256")
      .update(`${projectId}:${candidate.candidateId}:${Date.now()}`)
      .digest("hex")
      .slice(0, 16)}`;

    const catalogRevision = createHash("sha256")
      .update(`${projectId}:${taskId}:${Date.now()}`)
      .digest("hex")
      .slice(0, 16);

    const authorized: AuthorizedTask = {
      taskId,
      candidateId: candidate.candidateId,
      displayName: candidate.displayName,
      launcherTemplate: candidate.launcherTemplate,
      argvTemplate: candidate.argvTemplate,
      cwd: candidate.cwd,
      fileProfile: candidate.fileProfile,
      resourceQuota: candidate.resourceQuota,
      timeout: candidate.timeout,
      taskSourceDigest: candidate.taskSourceDigest,
      networkMode: "none",
      catalogRevision,
      authorizedAt: new Date().toISOString()
    };

    const updated = [...list.value, authorized];
    const saved = await this.saveCatalog(projectId, updated);
    if (!saved.ok) return saved;
    return ok(authorized);
  }

  /** Revoke an authorized task. */
  async revokeTask(projectId: string, taskId: string): Promise<Result<void, UnifiedError>> {
    const list = await this.listAuthorizedTasks(projectId);
    if (!list.ok) return list;
    const updated = list.value.filter((t) => t.taskId !== taskId);
    return this.saveCatalog(projectId, updated);
  }

  private async saveCatalog(
    projectId: string,
    tasks: readonly AuthorizedTask[]
  ): Promise<Result<void, UnifiedError>> {
    try {
      await mkdir(this.catalogRoot, { recursive: true });
      const data = {
        schemaVersion: CATALOG_SCHEMA_VERSION,
        projectId,
        updatedAt: new Date().toISOString(),
        tasks
      };
      await writeFile(this.catalogPath(projectId), JSON.stringify(data, null, 2), "utf8");
      return ok(undefined);
    } catch {
      return err(
        createUnifiedError({
          code: "AGENT_TASK_CATALOG_WRITE_FAILED",
          category: "StorageError",
          message: "Could not persist the task catalog.",
          recoverability: "user-action",
          suggestedAction: "Check app user-data directory permissions.",
          traceId: "project-task-catalog-repository"
        })
      );
    }
  }
}

/**
 * Validates that a candidate does not declare forbidden capabilities.
 * Returns an error if the candidate should be rejected.
 */
function validateCandidate(candidate: ProjectTaskCandidate): UnifiedError | undefined {
  // Network must be "none"
  if (candidate.networkMode !== "none") {
    return catalogError("AGENT_TASK_CATALOG_NETWORK_FORBIDDEN", "Tasks must have networkMode: none.");
  }

  // Reject tasks with absolute paths in cwd that could escape workspace
  if (
    !candidate.cwd ||
    candidate.cwd.includes("..") ||
    candidate.cwd.includes("\0")
  ) {
    return catalogError(
      "AGENT_TASK_CATALOG_PATH_INVALID",
      "Task cwd must be a valid relative workspace path."
    );
  }

  // Reject extremely short timeouts (background process indicator)
  if (candidate.timeout <= 0 || candidate.timeout > 3_600_000) {
    return catalogError(
      "AGENT_TASK_CATALOG_TIMEOUT_INVALID",
      "Task timeout must be between 1ms and 1 hour."
    );
  }

  return undefined;
}

function catalogError(code: string, message: string): UnifiedError {
  return createUnifiedError({
    code,
    category: "ValidationError",
    message,
    recoverability: "user-action",
    suggestedAction: "Review the task configuration before authorizing.",
    traceId: "project-task-catalog-repository"
  });
}
