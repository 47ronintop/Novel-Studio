import { lstat, mkdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { err, ok, type Result, type UnifiedError } from "@novel-studio/shared";
import { storageError } from "./errors.js";

export interface AtomicWriteFileSystem {
  mkdir(path: string): Promise<void>;
  writeFile(path: string, data: string): Promise<void>;
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

export interface ProjectPathGuard {
  readonly projectRoot: string;
  readonly canonicalRoot: Promise<string>;
}

const defaultFileSystem: AtomicWriteFileSystem = {
  async mkdir(path: string): Promise<void> {
    await mkdir(path, { recursive: true });
  },
  async writeFile(path: string, data: string): Promise<void> {
    await writeFile(path, data, "utf8");
  },
  async rename(oldPath: string, newPath: string): Promise<void> {
    await rename(oldPath, newPath);
  },
  async rm(path: string): Promise<void> {
    await rm(path, { force: true });
  }
};

export function createProjectPathGuard(projectRoot: string): ProjectPathGuard {
  return Object.freeze({ projectRoot, canonicalRoot: realpath(projectRoot) });
}

export async function verifyProjectStoragePath(
  guard: ProjectPathGuard,
  targetPath: string,
  traceId = "trace_repository_project_path"
): Promise<Result<void, UnifiedError>> {
  try {
    const lexicalRoot = resolve(guard.projectRoot);
    const lexicalTarget = resolve(targetPath);
    const lexicalRelative = relative(lexicalRoot, lexicalTarget);
    if (!isContainedRelativePath(lexicalRelative) || lexicalRelative.length === 0) {
      throw new Error("Storage path is outside the bound project root.");
    }

    const canonicalRoot = await guard.canonicalRoot;
    const currentRoot = await realpath(guard.projectRoot);
    if (!samePath(currentRoot, canonicalRoot)) {
      throw new Error("Project root identity changed.");
    }

    let current = canonicalRoot;
    const segments = lexicalRelative.split(/[\\/]/u);
    for (const [index, segment] of segments.entries()) {
      current = join(current, segment);
      try {
        const stats = await lstat(current);
        if (stats.isSymbolicLink()) throw new Error("Reparse point rejected.");
        if (index < segments.length - 1 && !stats.isDirectory()) {
          throw new Error("Storage path parent is not a directory.");
        }
        const canonicalCurrent = await realpath(current);
        if (!isContainedRelativePath(relative(canonicalRoot, canonicalCurrent))) {
          throw new Error("Storage path escaped the bound project root.");
        }
      } catch (error) {
        if (isMissingPathError(error)) break;
        throw error;
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
  const tempPath = `${input.targetPath}.tmp-${process.pid}-${Date.now()}`;

  try {
    const initialPathCheck = await verifyAtomicWritePath(input, traceId);
    if (!initialPathCheck.ok) return initialPathCheck;
    await fileSystem.mkdir(parentDir);
    const createdPathCheck = await verifyAtomicWritePath(input, traceId);
    if (!createdPathCheck.ok) return createdPathCheck;
    await fileSystem.writeFile(tempPath, input.content);
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
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "ENOENT"
  );
}

async function cleanupTempFile(fileSystem: AtomicWriteFileSystem, tempPath: string): Promise<void> {
  try {
    await fileSystem.rm(tempPath);
  } catch {
    // Cleanup failure must not mask the original atomic write failure.
  }
}
