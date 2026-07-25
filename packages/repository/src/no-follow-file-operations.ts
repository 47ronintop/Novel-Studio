/**
 * Task B.2 — File operation path boundary.
 *
 * Node's pathname APIs cannot make the lstat/check followed by rename, unlink, or
 * mkdir atomic. In particular, Windows junctions can be swapped after validation.
 * Mutations therefore fail closed unless the host supplies a native handle-based
 * implementation through NoFollowNativeFileOperationPort.
 */
import { lstat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

export interface NoFollowFileError {
  readonly code:
    | "NO_FOLLOW_SYMLINK_REJECTED"
    | "NO_FOLLOW_PATH_REJECTED"
    | "NO_FOLLOW_NATIVE_REQUIRED"
    | "NO_FOLLOW_IO_ERROR";
  readonly message: string;
  readonly path: string;
}

/**
 * Host boundary for mutation operations.
 *
 * Each method must resolve only the supplied relative paths beneath `root` using
 * OS handles/descriptors that do not follow symlinks or Windows reparse points.
 * It must re-check containment at execution time. Implementations based only on
 * Node path strings do not meet this contract.
 */
export interface NoFollowNativeFileOperationPort {
  rename(root: string, sourcePath: string, targetPath: string): Promise<Result<void, UnifiedError>>;
  unlink(root: string, targetPath: string): Promise<Result<void, UnifiedError>>;
  mkdir(root: string, targetPath: string): Promise<Result<void, UnifiedError>>;
  rmdir(root: string, targetPath: string): Promise<Result<void, UnifiedError>>;
  writeFile(
    root: string,
    targetPath: string,
    content: string,
    options?: NoFollowWriteFileOptions
  ): Promise<Result<void, UnifiedError>>;
}

export interface NoFollowWriteFileOptions {
  /** Require the target to be created rather than replacing an existing file. */
  readonly createOnly?: boolean;
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
    suggestedAction:
      "Use a project-relative path that does not traverse a symlink or reparse point.",
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
  const parts = path.replace(/\\/g, "/").split("/");
  return parts.slice(-2).join("/");
}

const WINDOWS_RESERVED_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "CLOCK$",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9"
]);

/**
 * Accept only a canonical project-relative path. Backslashes are rejected rather
 * than normalized so every caller and every platform observes the same boundary.
 */
export function isSafeProjectRelativePath(path: string): boolean {
  if (typeof path !== "string" || path.length === 0 || path.length > 1024) return false;
  if (path.includes("\\") || path.includes("\0") || path.startsWith("/")) return false;
  // Reject drive-relative (C:foo), drive-absolute, UNC, and device namespace paths.
  if (/^[a-zA-Z]:/.test(path) || /^[/\\]{2}/.test(path)) return false;

  const segments = path.split("/");
  return segments.every((segment) => {
    if (segment.length === 0 || segment === "." || segment === "..") return false;
    // ':' is an alternate data stream delimiter on Windows.
    if (segment.includes(":")) return false;
    // Windows strips trailing dots/spaces, allowing a different object to be addressed.
    if (/[. ]$/.test(segment)) return false;

    const deviceName = segment.split(".", 1)[0]?.toUpperCase();
    return deviceName !== undefined && !WINDOWS_RESERVED_NAMES.has(deviceName);
  });
}

function fullPath(root: string, relativePath: string): string {
  return join(root, ...relativePath.split("/"));
}

/**
 * Best-effort preflight for diagnostics. It is not an atomic security guarantee;
 * mutation security is provided by NoFollowNativeFileOperationPort at execution.
 */
async function verifyNoFollowSegments(
  root: string,
  targetPath: string
): Promise<Result<void, UnifiedError>> {
  if (!isAbsolute(root)) {
    return err(noFollowError("NO_FOLLOW_PATH_REJECTED", "Project root must be absolute.", root));
  }
  if (!isSafeProjectRelativePath(targetPath)) {
    return err(
      noFollowError(
        "NO_FOLLOW_PATH_REJECTED",
        "Path must be a safe project-relative path.",
        targetPath
      )
    );
  }

  let rootStat;
  try {
    rootStat = await lstat(root);
  } catch {
    return err(noFollowIoError("Project root stat failed.", root));
  }
  if (rootStat.isSymbolicLink()) {
    return err(noFollowError("NO_FOLLOW_SYMLINK_REJECTED", "Project root is a symlink.", root));
  }
  if (!rootStat.isDirectory()) {
    return err(noFollowError("NO_FOLLOW_PATH_REJECTED", "Project root is not a directory.", root));
  }

  let current = root;
  const segments = targetPath.split("/");
  for (const [index, segment] of segments.entries()) {
    current = join(current, segment);
    try {
      const segmentStat = await lstat(current);
      if (segmentStat.isSymbolicLink()) {
        return err(
          noFollowError(
            "NO_FOLLOW_SYMLINK_REJECTED",
            `Symlink or reparse point detected at: ${segment}`,
            current
          )
        );
      }
      if (index < segments.length - 1 && !segmentStat.isDirectory()) {
        return err(
          noFollowError("NO_FOLLOW_PATH_REJECTED", "A parent segment is not a directory.", current)
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return ok(undefined);
      return err(noFollowIoError("Path segment stat failed.", current));
    }
  }
  return ok(undefined);
}

function nativePortRequired(path: string): Result<void, UnifiedError> {
  return err(
    noFollowError(
      "NO_FOLLOW_NATIVE_REQUIRED",
      "A native handle-based file operation provider is required for mutations.",
      path
    )
  );
}

/**
 * Returns lstat metadata after best-effort traversal checks. This API does not
 * mutate the filesystem and is not a substitute for handle-based access.
 */
export async function noFollowStat(
  root: string,
  targetPath: string
): Promise<Result<Awaited<ReturnType<typeof lstat>>, UnifiedError>> {
  const check = await verifyNoFollowSegments(root, targetPath);
  if (!check.ok) return check;

  try {
    const stats = await lstat(fullPath(root, targetPath));
    if (stats.isSymbolicLink()) {
      return err(
        noFollowError(
          "NO_FOLLOW_SYMLINK_REJECTED",
          "Target is a symlink or reparse point.",
          targetPath
        )
      );
    }
    return ok(stats);
  } catch (error) {
    return err(
      noFollowIoError(error instanceof Error ? error.message : "Stat failed.", targetPath)
    );
  }
}

/**
 * Renames through a native handle-based provider. Node pathname rename is never
 * used because it cannot safely close a junction/reparse-point TOCTOU window.
 */
export async function noFollowRename(
  root: string,
  sourcePath: string,
  targetPath: string,
  nativePort?: NoFollowNativeFileOperationPort
): Promise<Result<void, UnifiedError>> {
  const sourceCheck = await verifyNoFollowSegments(root, sourcePath);
  if (!sourceCheck.ok) return sourceCheck;
  const targetCheck = await verifyNoFollowSegments(root, targetPath);
  if (!targetCheck.ok) return targetCheck;
  if (nativePort === undefined) return nativePortRequired(sourcePath);
  return nativePort.rename(root, sourcePath, targetPath);
}

/**
 * Unlinks through a native handle-based provider. See noFollowRename.
 */
export async function noFollowUnlink(
  root: string,
  targetPath: string,
  nativePort?: NoFollowNativeFileOperationPort
): Promise<Result<void, UnifiedError>> {
  const check = await verifyNoFollowSegments(root, targetPath);
  if (!check.ok) return check;
  if (nativePort === undefined) return nativePortRequired(targetPath);
  return nativePort.unlink(root, targetPath);
}

/**
 * Creates a directory through a native handle-based provider. See noFollowRename.
 */
export async function noFollowMkdir(
  root: string,
  targetPath: string,
  nativePort?: NoFollowNativeFileOperationPort
): Promise<Result<void, UnifiedError>> {
  const check = await verifyNoFollowSegments(root, targetPath);
  if (!check.ok) return check;
  if (nativePort === undefined) return nativePortRequired(targetPath);
  return nativePort.mkdir(root, targetPath);
}

/**
 * Removes a directory through a native handle-based provider. See noFollowRename.
 */
export async function noFollowRmdir(
  root: string,
  targetPath: string,
  nativePort?: NoFollowNativeFileOperationPort
): Promise<Result<void, UnifiedError>> {
  const check = await verifyNoFollowSegments(root, targetPath);
  if (!check.ok) return check;
  if (nativePort === undefined) return nativePortRequired(targetPath);
  return nativePort.rmdir(root, targetPath);
}

/**
 * Writes a file through a native handle-based provider. See noFollowRename.
 */
export async function noFollowWriteFile(
  root: string,
  targetPath: string,
  content: string,
  options?: NoFollowWriteFileOptions,
  nativePort?: NoFollowNativeFileOperationPort
): Promise<Result<void, UnifiedError>> {
  const check = await verifyNoFollowSegments(root, targetPath);
  if (!check.ok) return check;
  if (nativePort === undefined) return nativePortRequired(targetPath);
  return nativePort.writeFile(root, targetPath, content, options);
}

/**
 * Injectable facade. Mutations fail closed unless nativeOperations is supplied.
 */
export class NoFollowFileOperations {
  public constructor(
    private readonly root: string,
    private readonly nativeOperations?: NoFollowNativeFileOperationPort
  ) {}

  public stat(targetPath: string) {
    return noFollowStat(this.root, targetPath);
  }

  public rename(sourcePath: string, targetPath: string) {
    return noFollowRename(this.root, sourcePath, targetPath, this.nativeOperations);
  }

  public unlink(targetPath: string) {
    return noFollowUnlink(this.root, targetPath, this.nativeOperations);
  }

  public mkdir(targetPath: string) {
    return noFollowMkdir(this.root, targetPath, this.nativeOperations);
  }

  public rmdir(targetPath: string) {
    return noFollowRmdir(this.root, targetPath, this.nativeOperations);
  }

  public writeFile(targetPath: string, content: string, options?: NoFollowWriteFileOptions) {
    return noFollowWriteFile(this.root, targetPath, content, options, this.nativeOperations);
  }
}
