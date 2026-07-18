import { open, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const lockPath = join(process.cwd(), ".vitest-build-gate.lock");
const staleLockMs = 300_000;

export async function withBuildGateLock<T>(operation: () => T | Promise<T>): Promise<T> {
  const lock = await acquireBuildGateLock();
  try {
    return await operation();
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
}

async function acquireBuildGateLock() {
  const startedAt = Date.now();

  while (true) {
    try {
      return await open(lockPath, "wx");
    } catch (error) {
      if (!isFileExistsError(error)) {
        throw error;
      }

      await removeStaleLock();
      if (Date.now() - startedAt > staleLockMs) {
        throw new Error("Timed out waiting for the build gate lock.");
      }
      await delay(100);
    }
  }
}

async function removeStaleLock() {
  try {
    const metadata = await stat(lockPath);
    if (Date.now() - metadata.mtimeMs > staleLockMs) {
      await rm(lockPath, { force: true });
    }
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }
}

function isFileExistsError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function isNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
