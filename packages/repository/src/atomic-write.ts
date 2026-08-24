import { randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import { lstat, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { err, ok, type Result, type UnifiedError } from "@novel-studio/shared";
import { storageError } from "./errors.js";

export interface AtomicWriteFileSystem {
  mkdir(path: string): Promise<void>;
  writeFile(
    path: string,
    data: string,
    options: { readonly encoding: "utf8"; readonly flag: "wx" }
  ): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  rm(path: string): Promise<void>;
}

export interface AtomicWriteInput {
  targetPath: string;
  content: string;
  traceId?: string;
  fileSystem?: AtomicWriteFileSystem;
  beforeReplace?: () => Promise<Result<void, UnifiedError>>;
  pathGuard?: ProjectPathGuard;
}

export interface ProjectFileLockInput {
  readonly lockPath: string;
  readonly pathGuard: ProjectPathGuard;
  readonly traceId?: string;
  readonly staleAfterMs?: number;
  readonly waitTimeoutMs?: number;
  readonly retryDelayMs?: number;
  readonly nowMs?: () => number;
  /** Deterministic inspection seam for lock-race tests; production callers use filesystem state. */
  readonly inspectExistingLock?: (input: {
    readonly lockPath: string;
    readonly staleAfterMs: number;
  }) => Promise<Result<"active" | "missing" | "stale", UnifiedError>>;
}

export interface ProjectPathGuard {
  readonly projectRoot: string;
  readonly canonicalRoot: Promise<string>;
  readonly expectedRootIdentity?: ProjectRootIdentity;
}

export interface ProjectRootIdentity {
  readonly device: bigint;
  readonly inode: bigint;
}

interface ProjectPathInspection {
  lstat(path: string): Promise<Stats>;
  realpath(path: string): Promise<string>;
}

const defaultFileSystem: AtomicWriteFileSystem = {
  async mkdir(path: string): Promise<void> {
    await mkdir(path, { recursive: true });
  },
  async writeFile(
    path: string,
    data: string,
    options: { readonly encoding: "utf8"; readonly flag: "wx" }
  ): Promise<void> {
    await writeFile(path, data, options);
  },
  async rename(oldPath: string, newPath: string): Promise<void> {
    await rename(oldPath, newPath);
  },
  async rm(path: string): Promise<void> {
    await rm(path, { force: true });
  }
};

const DEFAULT_LOCK_STALE_AFTER_MS = 30 * 60 * 1_000;
const DEFAULT_LOCK_WAIT_TIMEOUT_MS = 5 * 60 * 1_000;
const DEFAULT_LOCK_RETRY_DELAY_MS = 25;
const defaultProjectPathInspection: ProjectPathInspection = { lstat, realpath };

interface ProjectFileLockRecord {
  readonly schemaVersion: "1.0";
  readonly ownerId: string;
  readonly acquiredAt: string;
}

export function createProjectPathGuard(
  projectRoot: string,
  expectedRootIdentity?: ProjectRootIdentity
): ProjectPathGuard {
  return Object.freeze({
    projectRoot,
    canonicalRoot: realpath(projectRoot),
    ...(expectedRootIdentity === undefined ? {} : { expectedRootIdentity })
  });
}

export async function verifyProjectStoragePath(
  guard: ProjectPathGuard,
  targetPath: string,
  traceId = "trace_repository_project_path",
  inspection: ProjectPathInspection = defaultProjectPathInspection
): Promise<Result<void, UnifiedError>> {
  try {
    const lexicalRoot = resolve(guard.projectRoot);
    const lexicalTarget = resolve(targetPath);
    const lexicalRelative = relative(lexicalRoot, lexicalTarget);
    if (!isContainedRelativePath(lexicalRelative) || lexicalRelative.length === 0) {
      throw new Error("Storage path is outside the bound project root.");
    }

    const canonicalRoot = await guard.canonicalRoot;
    if (guard.expectedRootIdentity !== undefined) {
      const rootStats = await lstat(guard.projectRoot, { bigint: true });
      if (
        !rootStats.isDirectory() ||
        rootStats.isSymbolicLink() ||
        rootStats.dev !== guard.expectedRootIdentity.device ||
        rootStats.ino !== guard.expectedRootIdentity.inode
      ) {
        throw new Error("Project root identity changed.");
      }
    }
    const currentRoot = await inspection.realpath(guard.projectRoot);
    if (!samePath(currentRoot, canonicalRoot)) {
      throw new Error("Project root identity changed.");
    }

    let current = canonicalRoot;
    const segments = lexicalRelative.split(/[\\/]/u);
    for (const [index, segment] of segments.entries()) {
      current = join(current, segment);
      let stats: Stats;
      try {
        stats = await inspection.lstat(current);
      } catch (error) {
        if (isMissingPathError(error)) break;
        if (await pathDisappearedAfterInspectionError(current, inspection)) break;
        throw error;
      }
      if (stats.isSymbolicLink()) throw new Error("Reparse point rejected.");
      if (index < segments.length - 1 && !stats.isDirectory()) {
        throw new Error("Storage path parent is not a directory.");
      }
      let canonicalCurrent: string;
      try {
        canonicalCurrent = await inspection.realpath(current);
      } catch (error) {
        if (isMissingPathError(error)) break;
        // Windows may surface EPERM while a lock leaf disappears between lstat and realpath.
        if (await pathDisappearedAfterInspectionError(current, inspection)) break;
        throw error;
      }
      if (!isContainedRelativePath(relative(canonicalRoot, canonicalCurrent))) {
        throw new Error("Storage path escaped the bound project root.");
      }
    }
    return ok(undefined);
  } catch {
    return err(
      storageError({
        code: "PROJECT_STORAGE_PATH_REJECTED",
        message: "Project storage path was rejected.",
        suggestedAction: "Reopen the project and remove any redirected internal storage paths.",
        traceId
      })
    );
  }
}

export async function writeTextAtomically(
  input: AtomicWriteInput
): Promise<Result<void, UnifiedError>> {
  const fileSystem = input.fileSystem ?? defaultFileSystem;
  const traceId = input.traceId ?? "trace_repository_atomic_write";
  const parentDir = dirname(input.targetPath);
  const tempPath = `${input.targetPath}.tmp-${randomUUID()}`;

  try {
    const initialPathCheck = await verifyAtomicWritePath(input, traceId);
    if (!initialPathCheck.ok) return initialPathCheck;
    await fileSystem.mkdir(parentDir);
    const createdPathCheck = await verifyAtomicWritePath(input, traceId);
    if (!createdPathCheck.ok) return createdPathCheck;
    await fileSystem.writeFile(tempPath, input.content, { encoding: "utf8", flag: "wx" });
    const finalVerification = await input.beforeReplace?.();
    if (finalVerification !== undefined && !finalVerification.ok) {
      await cleanupTempFile(fileSystem, tempPath);
      return finalVerification;
    }
    const finalPathCheck = await verifyAtomicWritePath(input, traceId);
    if (!finalPathCheck.ok) {
      await cleanupTempFile(fileSystem, tempPath);
      return finalPathCheck;
    }
    await fileSystem.rename(tempPath, input.targetPath);
    return ok(undefined);
  } catch (error) {
    await cleanupTempFile(fileSystem, tempPath);
    return err(
      storageError({
        code: "ATOMIC_WRITE_FAILED",
        message: "Atomic write failed before the target file could be replaced.",
        suggestedAction: "Retry the write. If it fails again, check filesystem permissions.",
        traceId,
        redactedDetail: {
          targetPath: input.targetPath,
          reason: error instanceof Error ? error.message : "Unknown write error"
        }
      })
    );
  }
}

/**
 * Runs one project-local mutation under an exclusive lock file shared by repository instances and
 * processes. The lock has bounded waiting and fail-closed stale detection; stale locks are never
 * deleted automatically because confirm-then-delete cannot safely distinguish a newly acquired
 * successor on every supported filesystem. Ownership is checked before normal release.
 */
export async function withProjectFileLock<T>(
  input: ProjectFileLockInput,
  operation: () => Promise<Result<T, UnifiedError>>
): Promise<Result<T, UnifiedError>> {
  const traceId = input.traceId ?? "trace_repository_project_file_lock";
  const staleAfterMs = positiveDuration(input.staleAfterMs, DEFAULT_LOCK_STALE_AFTER_MS);
  const waitTimeoutMs = positiveDuration(input.waitTimeoutMs, DEFAULT_LOCK_WAIT_TIMEOUT_MS);
  const retryDelayMs = positiveDuration(input.retryDelayMs, DEFAULT_LOCK_RETRY_DELAY_MS);
  const nowMs = input.nowMs ?? Date.now;
  const ownerId = randomUUID();
  const deadline = nowMs() + waitTimeoutMs;
  const acquired = await acquireProjectFileLock({
    ...input,
    traceId,
    ownerId,
    staleAfterMs,
    waitTimeoutMs,
    retryDelayMs,
    nowMs,
    deadline
  });
  if (!acquired.ok) return acquired;

  let result: Result<T, UnifiedError>;
  try {
    result = await operation();
  } catch (error) {
    result = err(
      projectFileLockError({
        code: "PROJECT_FILE_LOCK_OPERATION_FAILED",
        message: "The project mutation failed while its lock was held.",
        suggestedAction: "Retry the operation after checking the project storage state.",
        traceId,
        reason: error instanceof Error ? error.message : "Unknown locked operation error"
      })
    );
  }

  const released = await releaseProjectFileLock(input, ownerId, traceId);
  return !released.ok && result.ok ? released : result;
}

async function acquireProjectFileLock(
  input: ProjectFileLockInput & {
    readonly traceId: string;
    readonly ownerId: string;
    readonly staleAfterMs: number;
    readonly waitTimeoutMs: number;
    readonly retryDelayMs: number;
    readonly nowMs: () => number;
    readonly deadline: number;
  }
): Promise<Result<void, UnifiedError>> {
  while (true) {
    if (input.deadline - input.nowMs() <= 0) {
      return err(projectFileLockTimeout(input.traceId, input.waitTimeoutMs));
    }
    try {
      const initialPathCheck = await verifyProjectStoragePath(
        input.pathGuard,
        input.lockPath,
        input.traceId
      );
      if (!initialPathCheck.ok) return initialPathCheck;
      await mkdir(dirname(input.lockPath), { recursive: true });
      const finalPathCheck = await verifyProjectStoragePath(
        input.pathGuard,
        input.lockPath,
        input.traceId
      );
      if (!finalPathCheck.ok) return finalPathCheck;
      const record: ProjectFileLockRecord = {
        schemaVersion: "1.0",
        ownerId: input.ownerId,
        acquiredAt: new Date().toISOString()
      };
      await writeFile(input.lockPath, `${JSON.stringify(record)}\n`, {
        encoding: "utf8",
        flag: "wx"
      });
      return ok(undefined);
    } catch (error) {
      if (!isFileExistsError(error)) {
        return err(
          projectFileLockError({
            code: "PROJECT_FILE_LOCK_ACQUIRE_FAILED",
            message: "The project mutation lock could not be acquired.",
            suggestedAction: "Check project folder permissions and retry.",
            traceId: input.traceId,
            reason: error instanceof Error ? error.message : "Unknown lock acquisition error"
          })
        );
      }
    }

    const lockState =
      input.inspectExistingLock === undefined
        ? await inspectProjectFileLock(
            input.lockPath,
            input.pathGuard,
            input.traceId,
            input.staleAfterMs,
            input.nowMs
          )
        : await input.inspectExistingLock({
            lockPath: input.lockPath,
            staleAfterMs: input.staleAfterMs
          });
    if (!lockState.ok) return lockState;
    if (lockState.value === "missing") continue;
    if (lockState.value === "stale") {
      return err(
        projectFileLockError({
          code: "PROJECT_FILE_LOCK_STALE",
          message: "The project mutation lock appears to be stale.",
          suggestedAction:
            "确认没有山海进程正在使用该项目后，再移除过期锁。",
          traceId: input.traceId,
          reason: `staleAfterMs=${input.staleAfterMs}`
        })
      );
    }
    const remainingMs = input.deadline - input.nowMs();
    if (remainingMs <= 0) {
      return err(projectFileLockTimeout(input.traceId, input.waitTimeoutMs));
    }
    await delay(Math.min(input.retryDelayMs, remainingMs));
  }
}

async function inspectProjectFileLock(
  lockPath: string,
  pathGuard: ProjectPathGuard,
  traceId: string,
  staleAfterMs: number,
  nowMs: () => number
): Promise<Result<"active" | "missing" | "stale", UnifiedError>> {
  try {
    const pathCheck = await verifyProjectStoragePath(pathGuard, lockPath, traceId);
    if (!pathCheck.ok) return pathCheck;
    const [content, metadata] = await Promise.all([readFile(lockPath, "utf8"), stat(lockPath)]);
    const record = parseProjectFileLockRecord(content);
    const acquiredAtMs = record === undefined ? metadata.mtimeMs : Date.parse(record.acquiredAt);
    return Number.isFinite(acquiredAtMs) && nowMs() - acquiredAtMs >= staleAfterMs
      ? ok("stale")
      : ok("active");
  } catch (error) {
    if (isMissingPathError(error)) return ok("missing");
    return err(
      projectFileLockError({
        code: "PROJECT_FILE_LOCK_INSPECTION_FAILED",
        message: "The existing project mutation lock could not be inspected.",
        suggestedAction: "Inspect the internal lock and project permissions before retrying.",
        traceId,
        reason: error instanceof Error ? error.message : "Unknown lock inspection error"
      })
    );
  }
}

async function releaseProjectFileLock(
  input: ProjectFileLockInput,
  ownerId: string,
  traceId: string
): Promise<Result<void, UnifiedError>> {
  try {
    const pathCheck = await verifyProjectStoragePath(input.pathGuard, input.lockPath, traceId);
    if (!pathCheck.ok) return pathCheck;
    const record = parseProjectFileLockRecord(await readFile(input.lockPath, "utf8"));
    if (record?.ownerId !== ownerId) {
      return err(
        projectFileLockError({
          code: "PROJECT_FILE_LOCK_OWNERSHIP_LOST",
          message: "The project mutation lock ownership changed before release.",
          suggestedAction: "Reload project state before attempting another mutation.",
          traceId,
          reason: "owner mismatch"
        })
      );
    }
    await rm(input.lockPath, { force: true });
    return ok(undefined);
  } catch (error) {
    if (isMissingPathError(error)) {
      return err(
        projectFileLockError({
          code: "PROJECT_FILE_LOCK_OWNERSHIP_LOST",
          message: "The project mutation lock disappeared before release.",
          suggestedAction: "Reload project state before attempting another mutation.",
          traceId,
          reason: "lock missing"
        })
      );
    }
    return err(
      projectFileLockError({
        code: "PROJECT_FILE_LOCK_RELEASE_FAILED",
        message: "The project mutation lock could not be released.",
        suggestedAction: "Retry after the lock becomes stale or inspect project permissions.",
        traceId,
        reason: error instanceof Error ? error.message : "Unknown lock release error"
      })
    );
  }
}

function verifyAtomicWritePath(
  input: AtomicWriteInput,
  traceId: string
): Promise<Result<void, UnifiedError>> {
  return input.pathGuard === undefined
    ? Promise.resolve(ok(undefined))
    : verifyProjectStoragePath(input.pathGuard, input.targetPath, traceId);
}

function isContainedRelativePath(relativePath: string): boolean {
  return (
    relativePath !== ".." &&
    !relativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
    !isAbsolute(relativePath)
  );
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "ENOENT"
  );
}

async function pathDisappearedAfterInspectionError(
  path: string,
  inspection: ProjectPathInspection
): Promise<boolean> {
  try {
    await inspection.lstat(path);
    return false;
  } catch (error) {
    if (isMissingPathError(error)) return true;
    throw error;
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

function parseProjectFileLockRecord(content: string): ProjectFileLockRecord | undefined {
  try {
    const value = JSON.parse(content) as Partial<ProjectFileLockRecord>;
    return value.schemaVersion === "1.0" &&
      typeof value.ownerId === "string" &&
      value.ownerId.length > 0 &&
      typeof value.acquiredAt === "string"
      ? {
          schemaVersion: value.schemaVersion,
          ownerId: value.ownerId,
          acquiredAt: value.acquiredAt
        }
      : undefined;
  } catch {
    return undefined;
  }
}

function positiveDuration(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, durationMs));
}

function projectFileLockError(input: {
  readonly code: string;
  readonly message: string;
  readonly suggestedAction: string;
  readonly traceId: string;
  readonly reason: string;
}): UnifiedError {
  return storageError({
    code: input.code,
    message: input.message,
    suggestedAction: input.suggestedAction,
    traceId: input.traceId,
    redactedDetail: { reason: input.reason }
  });
}

function projectFileLockTimeout(traceId: string, waitTimeoutMs: number): UnifiedError {
  return projectFileLockError({
    code: "PROJECT_FILE_LOCK_TIMEOUT",
    message: "The project mutation lock remained busy past the bounded wait time.",
    suggestedAction: "Wait for the other operation to finish, then retry.",
    traceId,
    reason: `waitTimeoutMs=${waitTimeoutMs}`
  });
}

async function cleanupTempFile(fileSystem: AtomicWriteFileSystem, tempPath: string): Promise<void> {
  try {
    await fileSystem.rm(tempPath);
  } catch {
    // Cleanup failure must not mask the original atomic write failure.
  }
}
