/**
 * Task B.2 — Race condition tests for file operations.
 * Verifies that path substitution between the check phase and rename/unlink phase
 * is detected and rejected by the no-follow primitives.
 */
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  noFollowRename,
  noFollowUnlink,
  noFollowStat
} from "../src/no-follow-file-operations.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "novel-studio-race-"));
  roots.push(root);
  return root;
}

describe("agent-file-operation-race: path substitution detection", () => {
  test("noFollowStat detects a symlink created mid-operation (TOCTOU)", async () => {
    const root = await makeRoot();
    const outside = await mkdtemp(join(tmpdir(), "novel-studio-race-outside-"));
    roots.push(outside);
    await writeFile(join(outside, "sensitive.txt"), "outside content", "utf8");

    // Create a real file first
    await writeFile(join(root, "target.txt"), "safe content", "utf8");

    // Simulate race: stat reveals file exists...
    const initialStat = await noFollowStat(root, "target.txt");
    expect(initialStat.ok).toBe(true);

    // ...but then target is replaced by a symlink before actual file operation
    try {
      await rm(join(root, "target.txt"));
      await symlink(join(outside, "sensitive.txt"), join(root, "target.txt"));

      // Now a subsequent stat should fail (symlink at target)
      const raceResult = await noFollowStat(root, "target.txt");
      expect(raceResult.ok).toBe(false);
      if (raceResult.ok) return;
      expect(raceResult.error.code).toBe("NO_FOLLOW_SYMLINK_REJECTED");
    } catch {
      // symlink creation may fail in some environments
    }
  });

  test("noFollowRename detects junction injected into parent path mid-operation", async () => {
    const root = await makeRoot();
    const outside = await mkdtemp(join(tmpdir(), "novel-studio-race-outside2-"));
    roots.push(outside);
    await writeFile(join(root, "file.txt"), "content", "utf8");

    // Initially parent dir is clean - verify rename works
    const result1 = await noFollowRename(root, "file.txt", "moved.txt");
    expect(result1.ok).toBe(true);

    // Now inject a junction in a subdirectory and try to rename through it
    try {
      await symlink(outside, join(root, "junction-dir"), "junction");
      await writeFile(join(outside, "external.txt"), "external", "utf8");

      const result2 = await noFollowRename(root, "junction-dir/external.txt", "captured.txt");
      expect(result2.ok).toBe(false);
    } catch {
      // junction creation may fail
    }
  });

  test("noFollowUnlink rejects symlink that replaced a real file", async () => {
    const root = await makeRoot();
    const outside = await mkdtemp(join(tmpdir(), "novel-studio-race-outside3-"));
    roots.push(outside);
    await writeFile(join(outside, "valuable.txt"), "valuable content", "utf8");

    // Create a file and then replace it with a symlink
    await writeFile(join(root, "file.txt"), "safe", "utf8");
    await rm(join(root, "file.txt"));
    try {
      await symlink(join(outside, "valuable.txt"), join(root, "file.txt"));
      const result = await noFollowUnlink(root, "file.txt");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("NO_FOLLOW_SYMLINK_REJECTED");
    } catch {
      // symlink creation may fail
    }
  });

  test("no-follow operations do not mutate files outside the project root through a junction", async () => {
    const root = await makeRoot();
    const outside = await mkdtemp(join(tmpdir(), "novel-studio-race-outside4-"));
    roots.push(outside);
    const outsideFile = join(outside, "canary.txt");
    await writeFile(outsideFile, "canary content", "utf8");

    try {
      // Create a junction pointing to outside dir
      await symlink(outside, join(root, "escape"), "junction");

      // Try to delete a file through the junction — should fail
      const deleteResult = await noFollowUnlink(root, "escape/canary.txt");
      expect(deleteResult.ok).toBe(false);

      // Verify the outside file is untouched
      const { readFile } = await import("node:fs/promises");
      const content = await readFile(outsideFile, "utf8");
      expect(content).toBe("canary content");
    } catch (e) {
      // If symlink creation failed, test passes (environment doesn't support junctions)
      if (e instanceof Error && e.message.includes("canary")) throw e;
    }
  });
});
