import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { withStoryBibleProjectWriteLock } from "../src/story-bible-write-coordinator.js";

const tempRoots: string[] = [];

describe("Story Bible project write coordinator", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  test("serializes callers that address the same canonical project root", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-story-bible-lock-"));
    tempRoots.push(projectRoot);
    const canonicalRoot = await realpath(projectRoot);
    let releaseFirst = (): void => undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstEntered = (): void => undefined;
    const firstEntry = new Promise<void>((resolve) => {
      firstEntered = resolve;
    });
    let secondEntered = false;

    const first = withStoryBibleProjectWriteLock(projectRoot, async () => {
      firstEntered();
      await firstGate;
      return "first";
    });
    await firstEntry;
    const second = withStoryBibleProjectWriteLock(canonicalRoot, async () => {
      secondEntered = true;
      return "second";
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(secondEntered).toBe(false);

    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual(["first", "second"]);
    expect(secondEntered).toBe(true);
  });

  test("releases the queue when a mutation throws", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-story-bible-lock-"));
    tempRoots.push(projectRoot);

    await expect(
      withStoryBibleProjectWriteLock(projectRoot, async () => {
        throw new Error("injected failure");
      })
    ).rejects.toThrow("injected failure");
    await expect(
      withStoryBibleProjectWriteLock(projectRoot, async () => "recovered")
    ).resolves.toBe("recovered");
  });
});
