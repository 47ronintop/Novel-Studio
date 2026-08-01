import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { ok } from "@novel-studio/shared";
import { afterEach, describe, expect, test } from "vitest";

import { createProjectPathGuard, withProjectFileLock } from "../src/atomic-write.js";

const tempRoots: string[] = [];

describe("project file lock", () => {
  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
    );
  });

  test("serializes independent callers and releases after the operation", async () => {
    const projectRoot = await createTempRoot();
    const input = {
      lockPath: join(projectRoot, ".novel-studio", "locks", "shared.lock"),
      pathGuard: createProjectPathGuard(projectRoot),
      waitTimeoutMs: 1_000,
      retryDelayMs: 5
    };
    let releaseFirst = (): void => undefined;
    let markFirstEntered = (): void => undefined;
    const firstRelease = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstEntered = new Promise<void>((resolve) => {
      markFirstEntered = resolve;
    });
    let secondEntered = false;

    const first = withProjectFileLock(input, async () => {
      markFirstEntered();
      await firstRelease;
      return ok("first");
    });
    await firstEntered;
    const second = withProjectFileLock(input, async () => {
      secondEntered = true;
      return ok("second");
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    expect(secondEntered).toBe(false);
    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual([
      { ok: true, value: "first" },
      { ok: true, value: "second" }
    ]);
  });

  test("fails closed for stale locks so competing callers cannot delete a successor", async () => {
    const projectRoot = await createTempRoot();
    const lockPath = join(projectRoot, ".novel-studio", "locks", "stale.lock");
    await mkdir(dirname(lockPath), { recursive: true });
    const staleContent = `${JSON.stringify({
      schemaVersion: "1.0",
      ownerId: "abandoned-owner",
      acquiredAt: new Date(Date.now() - 60_000).toISOString()
    })}\n`;
    await writeFile(lockPath, staleContent, "utf8");
    let operationCalls = 0;
    const attempt = () =>
      withProjectFileLock(
        {
          lockPath,
          pathGuard: createProjectPathGuard(projectRoot),
          staleAfterMs: 10,
          waitTimeoutMs: 100,
          retryDelayMs: 5
        },
        async () => {
          operationCalls += 1;
          return ok("must-not-run");
        }
      );

    const contenders = await Promise.all([attempt(), attempt()]);

    expect(contenders).toEqual([
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: "PROJECT_FILE_LOCK_STALE" })
      }),
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: "PROJECT_FILE_LOCK_STALE" })
      })
    ]);
    expect(operationCalls).toBe(0);
    await expect(readFile(lockPath, "utf8")).resolves.toBe(staleContent);
  });

  test("rejects a lock path outside the guarded project", async () => {
    const projectRoot = await createTempRoot();

    const escaped = await withProjectFileLock(
      {
        lockPath: join(projectRoot, "..", "escaped.lock"),
        pathGuard: createProjectPathGuard(projectRoot),
        waitTimeoutMs: 20,
        retryDelayMs: 5
      },
      async () => ok("must-not-run")
    );
    expect(escaped).toMatchObject({
      ok: false,
      error: { code: "PROJECT_STORAGE_PATH_REJECTED" }
    });
  });

  test("returns a timeout instead of waiting indefinitely for a live lock", async () => {
    const projectRoot = await createTempRoot();
    const lockPath = join(projectRoot, ".novel-studio", "locks", "busy.lock");
    await mkdir(dirname(lockPath), { recursive: true });
    await writeFile(
      lockPath,
      `${JSON.stringify({
        schemaVersion: "1.0",
        ownerId: "live-owner",
        acquiredAt: new Date().toISOString()
      })}\n`,
      "utf8"
    );

    const result = await withProjectFileLock(
      {
        lockPath,
        pathGuard: createProjectPathGuard(projectRoot),
        staleAfterMs: 60_000,
        waitTimeoutMs: 25,
        retryDelayMs: 5
      },
      async () => ok("must-not-run")
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "PROJECT_FILE_LOCK_TIMEOUT" }
    });
  });

  test("checks the deadline before retrying when an observed lock disappears", async () => {
    const projectRoot = await createTempRoot();
    const lockPath = join(projectRoot, ".novel-studio", "locks", "churning.lock");
    await mkdir(dirname(lockPath), { recursive: true });
    await writeFile(
      lockPath,
      `${JSON.stringify({
        schemaVersion: "1.0",
        ownerId: "churning-owner",
        acquiredAt: new Date().toISOString()
      })}\n`,
      "utf8"
    );
    let clockReads = 0;
    let inspections = 0;
    let operationCalls = 0;

    const result = await withProjectFileLock(
      {
        lockPath,
        pathGuard: createProjectPathGuard(projectRoot),
        waitTimeoutMs: 1,
        retryDelayMs: 1,
        nowMs: () => {
          clockReads += 1;
          return clockReads <= 2 ? 0 : 2;
        },
        inspectExistingLock: async () => {
          inspections += 1;
          return ok(inspections === 1 ? "missing" : "active");
        }
      },
      async () => {
        operationCalls += 1;
        return ok("must-not-run");
      }
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "PROJECT_FILE_LOCK_TIMEOUT" }
    });
    expect(inspections).toBe(1);
    expect(operationCalls).toBe(0);
  });
});

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "novel-studio-project-file-lock-"));
  tempRoots.push(root);
  return root;
}
