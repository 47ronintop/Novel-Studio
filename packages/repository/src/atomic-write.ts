import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
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

export async function writeTextAtomically(
  input: AtomicWriteInput
): Promise<Result<void, UnifiedError>> {
  const fileSystem = input.fileSystem ?? defaultFileSystem;
  const traceId = input.traceId ?? "trace_repository_atomic_write";
  const parentDir = dirname(input.targetPath);
  const tempPath = `${input.targetPath}.tmp-${process.pid}-${Date.now()}`;

  try {
    await fileSystem.mkdir(parentDir);
    await fileSystem.writeFile(tempPath, input.content);
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

async function cleanupTempFile(fileSystem: AtomicWriteFileSystem, tempPath: string): Promise<void> {
  try {
    await fileSystem.rm(tempPath);
  } catch {
    // Cleanup failure must not mask the original atomic write failure.
  }
}
