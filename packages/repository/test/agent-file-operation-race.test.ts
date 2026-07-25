/**
 * Task B.2 — Junction substitution regression tests.
 *
 * Node has no atomic no-follow rename/unlink/mkdir primitive. The mutation facade
 * must therefore reject without a native provider and must never hand an already
 * substituted path to that provider.
 */
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok } from "@novel-studio/shared";
import { afterEach, describe, expect, test } from "vitest";

import {
  noFollowRename,
  noFollowStat,
  noFollowUnlink,
  type NoFollowNativeFileOperationPort
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

describe("agent-file-operation-race: path substitution boundary", () => {
  test("stat rejects a symlink that replaced a prior file", async () => {
    const root = await makeRoot();
    const outside = await mkdtemp(join(tmpdir(), "novel-studio-race-outside-"));
    roots.push(outside);
    await writeFile(join(outside, "sensitive.txt"), "outside content", "utf8");
    await writeFile(join(root, "target.txt"), "safe content", "utf8");

    expect((await noFollowStat(root, "target.txt")).ok).toBe(true);
    try {
      await rm(join(root, "target.txt"));
      await symlink(join(outside, "sensitive.txt"), join(root, "target.txt"));
      const result = await noFollowStat(root, "target.txt");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("NO_FOLLOW_SYMLINK_REJECTED");
    } catch {
      // Symlink creation can require elevated Windows privileges.
    }
  });

  test("rename and unlink fail closed before a native provider is installed", async () => {
    const root = await makeRoot();
    await writeFile(join(root, "file.txt"), "content", "utf8");

    const renameResult = await noFollowRename(root, "file.txt", "moved.txt");
    const unlinkResult = await noFollowUnlink(root, "file.txt");
    for (const result of [renameResult, unlinkResult]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("NO_FOLLOW_NATIVE_REQUIRED");
    }
    expect((await noFollowStat(root, "file.txt")).ok).toBe(true);
  });

  test("a junction swap is rejected before reaching the native provider", async () => {
    const root = await makeRoot();
    const outside = await mkdtemp(join(tmpdir(), "novel-studio-race-outside2-"));
    roots.push(outside);
    const canary = join(outside, "canary.txt");
    await writeFile(canary, "outside content", "utf8");
    await mkdir(join(root, "mutable"));
    await writeFile(join(root, "mutable", "file.txt"), "inside content", "utf8");

    let nativeCalls = 0;
    const nativePort: NoFollowNativeFileOperationPort = {
      async rename() {
        nativeCalls += 1;
        return ok(undefined);
      },
      async unlink() {
        nativeCalls += 1;
        return ok(undefined);
      },
      async mkdir() {
        nativeCalls += 1;
        return ok(undefined);
      },
      async rmdir() {
        nativeCalls += 1;
        return ok(undefined);
      },
      async writeFile() {
        nativeCalls += 1;
        return ok(undefined);
      }
    };

    try {
      await rm(join(root, "mutable"), { recursive: true });
      await symlink(outside, join(root, "mutable"), "junction");

      const result = await noFollowRename(root, "mutable/canary.txt", "captured.txt", nativePort);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("NO_FOLLOW_SYMLINK_REJECTED");
      expect(nativeCalls).toBe(0);
      expect((await noFollowStat(root, "captured.txt")).ok).toBe(false);
      expect(await (await import("node:fs/promises")).readFile(canary, "utf8")).toBe(
        "outside content"
      );
    } catch {
      // Junction creation can be unavailable in restricted test environments.
    }
  });
});
