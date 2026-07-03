import { mkdir, readdir, rm } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { err, ok, type Result, type UnifiedError } from "@novel-studio/shared";
import { storageError } from "./errors.js";
import type { CacheRepositoryPort } from "./ports.js";

export interface CacheRepositoryOptions {
  projectRoot: string;
  traceId?: string;
}

export class CacheRepository implements CacheRepositoryPort {
  private readonly traceId: string;

  public constructor(private readonly options: CacheRepositoryOptions) {
    this.traceId = options.traceId ?? "trace_repository_cache";
  }

  public async clearCache(): Promise<Result<void, UnifiedError>> {
    const cacheRoot = resolve(this.options.projectRoot, "cache");
    const projectRoot = resolve(this.options.projectRoot);

    if (!isInsideProject(projectRoot, cacheRoot)) {
      return err(
        storageError({
          code: "CACHE_PATH_INVALID",
          message: "Cache path resolved outside the project folder.",
          suggestedAction: "Choose a valid Novel Studio project folder and retry.",
          traceId: this.traceId,
          redactedDetail: {
            cacheRoot
          }
        })
      );
    }

    try {
      await mkdir(cacheRoot, { recursive: true });
      const entries = await readdir(cacheRoot);
      for (const entry of entries) {
        await rm(join(cacheRoot, entry), { recursive: true, force: true });
      }
      return ok(undefined);
    } catch (error) {
      return err(
        storageError({
          code: "CACHE_CLEAR_FAILED",
          message: "Cache clear failed.",
          suggestedAction:
            "Retry the cache clear. If it fails again, check filesystem permissions.",
          traceId: this.traceId,
          redactedDetail: {
            cacheRoot,
            reason: error instanceof Error ? error.message : "Unknown cache clear error"
          }
        })
      );
    }
  }
}

function isInsideProject(projectRoot: string, candidate: string): boolean {
  const pathFromProject = relative(projectRoot, candidate);
  return (
    pathFromProject === "cache" ||
    pathFromProject.startsWith(`cache\\`) ||
    pathFromProject.startsWith("cache/")
  );
}
