import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { err, ok, type JsonObject, type Result, type UnifiedError } from "@novel-studio/shared";

import { storageError } from "./errors.js";

export interface ProjectLockRecord extends JsonObject {
  schemaVersion: "1.0";
  ownerId: string;
  projectRoot: string;
  acquiredAt: string;
}

export interface ProjectLockFileRepositoryOptions {
  readonly projectRoot: string;
  readonly ownerId: string;
  readonly now?: () => string;
  readonly traceId?: string;
}

export class ProjectLockFileRepository {
  private readonly lockPath: string;
  private readonly traceId: string;

  public constructor(private readonly options: ProjectLockFileRepositoryOptions) {
    this.lockPath = join(options.projectRoot, ".novel-studio", "project-lock.json");
    this.traceId = options.traceId ?? "trace_project_lock";
  }

  public async acquireProjectLock(): Promise<Result<ProjectLockRecord, UnifiedError>> {
    const record: ProjectLockRecord = {
      schemaVersion: "1.0",
      ownerId: this.options.ownerId,
      projectRoot: this.options.projectRoot,
      acquiredAt: this.options.now?.() ?? new Date().toISOString()
    };

    try {
      await mkdir(dirname(this.lockPath), { recursive: true });
      await writeFile(this.lockPath, `${JSON.stringify(record, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx"
      });
      return ok(record);
    } catch (error) {
      if (isFileExistsError(error)) {
        return this.lockConflict();
      }

      return err(
        storageError({
          code: "PROJECT_LOCK_FAILED",
          message: "Project lock could not be acquired.",
          suggestedAction: "Choose a writable project folder or close other Novel Studio windows.",
          traceId: this.traceId,
          redactedDetail: {
            reason: error instanceof Error ? error.message : "Unknown lock error"
          }
        })
      );
    }
  }

  public async releaseProjectLock(): Promise<Result<void, UnifiedError>> {
    const existing = await this.readLockRecord();
    if (!existing.ok) {
      return existing;
    }
    if (existing.value.ownerId !== this.options.ownerId) {
      return err(
        storageError({
          code: "PROJECT_LOCK_OWNER_MISMATCH",
          message: "Project lock is owned by another window.",
          suggestedAction: "Only the owning window can release this project lock.",
          traceId: this.traceId,
          redactedDetail: {
            ownerId: existing.value.ownerId,
            acquiredAt: existing.value.acquiredAt
          }
        })
      );
    }

    try {
      await rm(this.lockPath, { force: true });
      return ok(undefined);
    } catch (error) {
      return err(
        storageError({
          code: "PROJECT_LOCK_RELEASE_FAILED",
          message: "Project lock could not be released.",
          suggestedAction: "Check project folder permissions before reopening this project.",
          traceId: this.traceId,
          redactedDetail: {
            reason: error instanceof Error ? error.message : "Unknown release error"
          }
        })
      );
    }
  }

  private async lockConflict(): Promise<Result<ProjectLockRecord, UnifiedError>> {
    const existing = await this.readLockRecord();
    if (!existing.ok) {
      return existing;
    }

    return err(
      storageError({
        code: "PROJECT_LOCK_CONFLICT",
        message: "Project is already locked by another Novel Studio window.",
        suggestedAction: "Close the other window or resolve the stale lock before opening again.",
        traceId: this.traceId,
        redactedDetail: {
          ownerId: existing.value.ownerId,
          acquiredAt: existing.value.acquiredAt
        }
      })
    );
  }

  private async readLockRecord(): Promise<Result<ProjectLockRecord, UnifiedError>> {
    try {
      const parsed = JSON.parse(
        await readFile(this.lockPath, "utf8")
      ) as Partial<ProjectLockRecord>;
      if (
        parsed.schemaVersion !== "1.0" ||
        typeof parsed.ownerId !== "string" ||
        typeof parsed.projectRoot !== "string" ||
        typeof parsed.acquiredAt !== "string"
      ) {
        return err(
          storageError({
            code: "PROJECT_LOCK_INVALID",
            message: "Project lock file is malformed.",
            suggestedAction: "Inspect the lock file before deleting it.",
            traceId: this.traceId
          })
        );
      }

      return ok({
        schemaVersion: parsed.schemaVersion,
        ownerId: parsed.ownerId,
        projectRoot: parsed.projectRoot,
        acquiredAt: parsed.acquiredAt
      });
    } catch (error) {
      return err(
        storageError({
          code: "PROJECT_LOCK_MISSING",
          message: "Project lock file could not be read.",
          suggestedAction: "Reopen the project to acquire a fresh lock.",
          traceId: this.traceId,
          redactedDetail: {
            reason: error instanceof Error ? error.message : "Unknown read error"
          }
        })
      );
    }
  }
}

function isFileExistsError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "EEXIST"
  );
}
