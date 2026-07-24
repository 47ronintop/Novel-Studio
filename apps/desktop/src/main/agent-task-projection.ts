import { createHash } from "node:crypto";
import { mkdir, stat, copyFile } from "node:fs/promises";
import { join, resolve, isAbsolute, sep } from "node:path";
import {
  ok,
  err,
  createUnifiedError,
  type Result,
  type UnifiedError
} from "@novel-studio/shared";
import type { ProjectionManifest, ProjectionFile } from "@novel-studio/agent-engine";

export interface BuildTaskProjectionInput {
  readonly taskId: string;
  readonly snapshotId: string;
  /** Absolute path to the workspace root. Only files within this root are eligible. */
  readonly workspaceRoot: string;
  /** Relative paths (from workspaceRoot) that are allowed for this task. */
  readonly allowedRelativePaths: readonly string[];
  /** Directory into which files are copied (per-run, disposable). */
  readonly outputRoot: string;
}

/**
 * Builds a disposable workspace projection for a task execution.
 *
 * Each file is:
 *   1. Checked to be within workspaceRoot (no traversal).
 *   2. Copied to outputRoot/<relativePath>.
 *   3. Checksummed from the source before copy.
 *
 * The resulting ProjectionManifest binds each file to its source checksum so the
 * sandbox launch step can verify nothing drifted between snapshot and launch.
 */
export async function buildTaskProjection(
  input: BuildTaskProjectionInput
): Promise<Result<ProjectionManifest, UnifiedError>> {
  const workspaceRoot = resolve(input.workspaceRoot);
  const outputRoot = resolve(input.outputRoot);

  const projectionFiles: ProjectionFile[] = [];

  for (const rel of input.allowedRelativePaths) {
    // Guard: no absolute paths, no traversal
    if (isAbsolute(rel) || rel.includes("..") || rel.includes("\0")) {
      return err(sandboxError("AGENT_TASK_PROJECTION_PATH_INVALID", `Rejected path: ${rel}`));
    }
    const sourcePath = resolve(join(workspaceRoot, rel));
    // Guard: must stay within workspaceRoot after resolution
    if (!sourcePath.startsWith(workspaceRoot + sep) && sourcePath !== workspaceRoot) {
      return err(
        sandboxError(
          "AGENT_TASK_PROJECTION_PATH_ESCAPE",
          `Path escapes workspace root: ${rel}`
        )
      );
    }

    let fileStat: Awaited<ReturnType<typeof stat>>;
    try {
      fileStat = await stat(sourcePath);
    } catch {
      return err(
        sandboxError(
          "AGENT_TASK_PROJECTION_FILE_NOT_FOUND",
          `File not found in workspace: ${rel}`
        )
      );
    }
    if (!fileStat.isFile()) {
      return err(
        sandboxError("AGENT_TASK_PROJECTION_NOT_A_FILE", `Path is not a regular file: ${rel}`)
      );
    }

    // Compute source checksum
    const checksumResult = await checksumFile(sourcePath);
    if (!checksumResult.ok) return checksumResult;

    // Ensure output directory exists
    const destPath = resolve(join(outputRoot, rel));
    if (!destPath.startsWith(outputRoot + sep) && destPath !== outputRoot) {
      return err(sandboxError("AGENT_TASK_PROJECTION_DEST_ESCAPE", `Destination escapes output root: ${rel}`));
    }
    const destDir = destPath.substring(0, destPath.lastIndexOf(sep));
    try {
      await mkdir(destDir, { recursive: true });
    } catch {
      return err(sandboxError("AGENT_TASK_PROJECTION_MKDIR_FAILED", `Cannot create dir for: ${rel}`));
    }

    try {
      await copyFile(sourcePath, destPath);
    } catch {
      return err(sandboxError("AGENT_TASK_PROJECTION_COPY_FAILED", `Cannot copy file: ${rel}`));
    }

    projectionFiles.push({
      relativePath: rel,
      sourceChecksum: checksumResult.value,
      projectedPath: destPath
    });
  }

  const manifestDigest = computeManifestDigest(projectionFiles, input.taskId, input.snapshotId);
  const manifest: ProjectionManifest = {
    manifestId: `proj_${input.snapshotId}`,
    taskId: input.taskId,
    snapshotId: input.snapshotId,
    files: projectionFiles,
    manifestDigest
  };
  return ok(manifest);
}

async function checksumFile(filePath: string): Promise<Result<string, UnifiedError>> {
  const { createReadStream } = await import("node:fs");
  return new Promise<Result<string, UnifiedError>>((resolve) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(ok(hash.digest("hex"))));
    stream.on("error", () =>
      resolve(err(sandboxError("AGENT_TASK_PROJECTION_CHECKSUM_FAILED", `Checksum failed: ${filePath}`)))
    );
  });
}

function computeManifestDigest(
  files: readonly ProjectionFile[],
  taskId: string,
  snapshotId: string
): string {
  const h = createHash("sha256");
  h.update(`task:${taskId}\nsnap:${snapshotId}\n`);
  for (const f of files) {
    h.update(`${f.relativePath}:${f.sourceChecksum}\n`);
  }
  return h.digest("hex");
}

function sandboxError(code: string, message: string): UnifiedError {
  return createUnifiedError({
    code,
    category: "ValidationError",
    message,
    recoverability: "user-action",
    suggestedAction: "Review the task file profile and workspace state.",
    traceId: "agent-task-projection"
  });
}
