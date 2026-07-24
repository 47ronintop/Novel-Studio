/**
 * Task B.2 — No-follow file operations.
 * Provides wrappers for stat/rename/unlink/mkdir that verify no symlinks or reparse points
 * exist at each path segment before executing, using lstat at every segment.
 */
import { lstat, mkdir, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";

import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

export interface NoFollowFileError {
  readonly code:
    | "NO_FOLLOW_SYMLINK_REJECTED"
    | "NO_FOLLOW_PATH_REJECTED"
    | "NO_FOLLOW_IO_ERROR";
  readonly message: string;
  readonly path: string;
}

function noFollowError(
  code: NoFollowFileError["code"],
  message: string,
  path: string
): UnifiedError {
  return createUnifiedError({
    code,
    category: "ValidationError",
    message,
    recoverability: "user-action",
    suggestedAction: "Ensure the path does not contain symlinks or reparse points.",
    traceId: "no-follow-file-operations",
    redactedDetail: { pathSegment: redactPath(path) }
  });
}

function noFollowIoError(message: string, path: string): UnifiedError {
  return createUnifiedError({
    code: "NO_FOLLOW_IO_ERROR",
    category: "StorageError",
    message,
    recoverability: "user-action",
    suggestedAction: "Verify the file path and permissions.",
    traceId: "no-follow-file-operations",
    redactedDetail: { pathSegment: redactPath(path) }
  });
}

function redactPath(path: string): string {
  // Only return the last two segments of the path for safety
  const parts = path.replace(/\\/g, "/").split("/");
  return parts.slice(-2).join("/");
}

/**
 * Verify that no segment in `targetPath` (relative to `root`) is a symlink or reparse point.
 * Walks from root down each segment and lstat-checks for symlinks.
 * @throws if a symlink is found or path escapes root
 */
async function verifyNoFollowSegments(
  root: string,
  targetPath: string
): Promise<Result<void, UnifiedError>> {
  // Resolve the root itself
  let rootStat;
  try {
    rootStat = await lstat(root);
  } catch {
    return err(noFollowError("NO_FOLLOW_IO_ERROR", "Project root stat failed.", root));
  }
  if (rootStat.isSymbolicLink()) {
    return err(noFollowError("NO_FOLLOW_SYMLINK_REJECTED", "Project root is a symlink.", root));
  }

  // Get the relative path from root to target
  let relPath: string;
  if (isAbsolute(targetPath)) {
    relPath = relative(root, targetPath).replaceAll("\\", "/");
  } else {
    relPath = targetPath.replaceAll("\\", "/");
  }

  if (relPath.startsWith("..")) {
    return err(noFollowError("NO_FOLLOW_PATH_REJECTED", "Path escapes project root.", targetPath));
  }

  // Walk each segment from root
  let current = root;
  const segments = relPath.split("/").filter((s) => s.length > 0 && s !== ".");
  for (const segment of segments) {
    current = join(current, segment);
    let segStat;
    try {
      segStat = await lstat(current);
    } catch {
      // File/dir doesn't exist yet — that's allowed for create operations
      // But we need to make sure no parent segment was a symlink
      return ok(undefined);
    }
    if (segStat.isSymbolicLink()) {
      return err(
        noFollowError("NO_FOLLOW_SYMLINK_REJECTED", `Symlink detected at segment: ${segment}`, current)
      );
    }
  }
  return ok(undefined);
}

/**
 * Stat a file/directory without following symlinks.
 * Verifies all path segments have no symlinks before calling lstat on the final path.
 */
export async function noFollowStat(
  root: string,
  targetPath: string
): Promise<Result<Awaited<ReturnType<typeof lstat>>, UnifiedError>> {
  const check = await verifyNoFollowSegments(root, targetPath);
  if (!check.ok) return check;

  const fullPath = isAbsolute(targetPath) ? targetPath : join(root, targetPath);
  try {
    const stats = await lstat(fullPath);
    return ok(stats);
  } catch (error) {
    return err(
      noFollowIoError(
        error instanceof Error ? error.message : "Stat failed.",
        fullPath
      )
    );
  }
}

/**
 * Rename (move) a file without following symlinks at any path segment.
 */
export async function noFollowRename(
  root: string,
  sourcePath: string,
  targetPath: string
): Promise<Result<void, UnifiedError>> {
  const sourceCheck = await verifyNoFollowSegments(root, sourcePath);
  if (!sourceCheck.ok) return sourceCheck;

  const targetParent = dirname(isAbsolute(targetPath) ? targetPath : join(root, targetPath));
  const targetParentRelative = relative(root, targetParent).replaceAll("\\", "/");
  const targetParentCheck = await verifyNoFollowSegments(root, targetParentRelative);
  if (!targetParentCheck.ok) return targetParentCheck;

  const fullSource = isAbsolute(sourcePath) ? sourcePath : join(root, sourcePath);
  const fullTarget = isAbsolute(targetPath) ? targetPath : join(root, targetPath);

  try {
    await rename(fullSource, fullTarget);
    return ok(undefined);
  } catch (error) {
    return err(
      noFollowIoError(
        error instanceof Error ? error.message : "Rename failed.",
        fullSource
      )
    );
  }
}

/**
 * Delete (unlink) a file without following symlinks at any path segment.
 */
export async function noFollowUnlink(
  root: string,
  targetPath: string
): Promise<Result<void, UnifiedError>> {
  const check = await verifyNoFollowSegments(root, targetPath);
  if (!check.ok) return check;

  const fullPath = isAbsolute(targetPath) ? targetPath : join(root, targetPath);
  try {
    // Verify it's actually a file, not a directory
    const fileStat = await lstat(fullPath);
    if (fileStat.isSymbolicLink()) {
      return err(noFollowError("NO_FOLLOW_SYMLINK_REJECTED", "Target is a symlink.", fullPath));
    }
    if (!fileStat.isFile()) {
      return err(noFollowError("NO_FOLLOW_PATH_REJECTED", "Target is not a regular file.", fullPath));
    }
    await rm(fullPath);
    return ok(undefined);
  } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return err(noFollowIoError("File not found.", fullPath));
    }
    return err(noFollowIoError(error instanceof Error ? error.message : "Unlink failed.", fullPath));
  }
}

/**
 * Create a directory (single level only) without following symlinks at any path segment.
 */
export async function noFollowMkdir(
  root: string,
  targetPath: string
): Promise<Result<void, UnifiedError>> {
  const parentDir = dirname(isAbsolute(targetPath) ? targetPath : join(root, targetPath));
  const parentRelative = relative(root, parentDir).replaceAll("\\", "/");
  const parentCheck = await verifyNoFollowSegments(root, parentRelative);
  if (!parentCheck.ok) return parentCheck;

  const fullPath = isAbsolute(targetPath) ? targetPath : join(root, targetPath);

  try {
    // Verify target does not already exist
    try {
      await lstat(fullPath);
      return err(noFollowError("NO_FOLLOW_PATH_REJECTED", "Target directory already exists.", fullPath));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    await mkdir(fullPath);
    return ok(undefined);
  } catch (error) {
    return err(
      noFollowIoError(error instanceof Error ? error.message : "Mkdir failed.", fullPath)
    );
  }
}

/**
 * Class wrapper for easier injection in tests and sessions.
 */
export class NoFollowFileOperations {
  public constructor(private readonly root: string) {}

  public stat(targetPath: string) {
    return noFollowStat(this.root, targetPath);
  }

  public rename(sourcePath: string, targetPath: string) {
    return noFollowRename(this.root, sourcePath, targetPath);
  }

  public unlink(targetPath: string) {
    return noFollowUnlink(this.root, targetPath);
  }

  public mkdir(targetPath: string) {
    return noFollowMkdir(this.root, targetPath);
  }
}
