import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok } from "@novel-studio/shared";
import { afterEach, describe, expect, test } from "vitest";

import {
  noFollowMkdir,
  noFollowRename,
  noFollowRmdir,
  noFollowStat,
  noFollowUnlink,
  noFollowWriteFile,
  NoFollowFileOperations,
  type NoFollowNativeFileOperationPort
} from "../src/no-follow-file-operations.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "novel-studio-no-follow-"));
  roots.push(root);
  return root;
}

describe("noFollowStat", () => {
  test("stats a regular file successfully", async () => {
    const root = await makeRoot();
    await writeFile(join(root, "file.txt"), "content", "utf8");
    const result = await noFollowStat(root, "file.txt");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.isFile()).toBe(true);
  });

  test.each([
    "../outside.txt",
    "nested/../outside.txt",
    "/tmp/outside.txt",
    "C:/Windows/win.ini",
    "D:/outside.txt",
    "C:relative.txt",
    "\\\\server\\share\\outside.txt",
    "\\\\?\\C:\\Windows\\win.ini",
    "report.txt:secret",
    "CON",
    "nested/PRN.txt",
    "trailing.",
    "trailing ",
    "nested//file.txt"
  ])("rejects unsafe or cross-volume path %s", async (targetPath) => {
    const root = await makeRoot();
    const result = await noFollowStat(root, targetPath);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NO_FOLLOW_PATH_REJECTED");
  });

  test("rejects a symlink or junction at the target", async () => {
    const root = await makeRoot();
    const outside = await mkdtemp(join(tmpdir(), "novel-studio-nf-outside-"));
    roots.push(outside);
    await writeFile(join(outside, "secret.txt"), "secret", "utf8");
    try {
      await symlink(join(outside, "secret.txt"), join(root, "link.txt"));
      const result = await noFollowStat(root, "link.txt");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("NO_FOLLOW_SYMLINK_REJECTED");
    } catch {
      // Symlink creation can require elevated Windows privileges.
    }
  });

  test("rejects a junction in a parent segment", async () => {
    const root = await makeRoot();
    const outside = await mkdtemp(join(tmpdir(), "novel-studio-nf-outside2-"));
    roots.push(outside);
    await writeFile(join(outside, "file.txt"), "content", "utf8");
    try {
      await symlink(outside, join(root, "linked"), "junction");
      const result = await noFollowStat(root, "linked/file.txt");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("NO_FOLLOW_SYMLINK_REJECTED");
    } catch {
      // Junction creation can be unavailable in restricted test environments.
    }
  });
});

describe("mutation operations", () => {
  test("fail closed without a native handle-based implementation", async () => {
    const root = await makeRoot();
    await writeFile(join(root, "old.txt"), "content", "utf8");

    const renameResult = await noFollowRename(root, "old.txt", "new.txt");
    const unlinkResult = await noFollowUnlink(root, "old.txt");
    const mkdirResult = await noFollowMkdir(root, "new-dir");
    const rmdirResult = await noFollowRmdir(root, "old-dir");
    const writeResult = await noFollowWriteFile(root, "new.txt", "content");

    for (const result of [renameResult, unlinkResult, mkdirResult, rmdirResult, writeResult]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("NO_FOLLOW_NATIVE_REQUIRED");
    }
    expect((await noFollowStat(root, "old.txt")).ok).toBe(true);
    expect((await noFollowStat(root, "new.txt")).ok).toBe(false);
    expect((await noFollowStat(root, "new-dir")).ok).toBe(false);
  });

  test("does not invoke the native port for an unsafe path", async () => {
    const root = await makeRoot();
    let calls = 0;
    const nativePort: NoFollowNativeFileOperationPort = {
      async rename() {
        calls += 1;
        return ok(undefined);
      },
      async unlink() {
        calls += 1;
        return ok(undefined);
      },
      async mkdir() {
        calls += 1;
        return ok(undefined);
      },
      async rmdir() {
        calls += 1;
        return ok(undefined);
      },
      async writeFile() {
        calls += 1;
        return ok(undefined);
      }
    };

    const result = await noFollowRename(root, "C:/Windows/win.ini", "new.txt", nativePort);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NO_FOLLOW_PATH_REJECTED");
    expect(calls).toBe(0);
  });

  test("delegates only validated relative paths to the native provider", async () => {
    const root = await makeRoot();
    const calls: string[] = [];
    const nativePort: NoFollowNativeFileOperationPort = {
      async rename(_root, sourcePath, targetPath) {
        calls.push(`rename:${sourcePath}:${targetPath}`);
        return ok(undefined);
      },
      async unlink(_root, targetPath) {
        calls.push(`unlink:${targetPath}`);
        return ok(undefined);
      },
      async mkdir(_root, targetPath) {
        calls.push(`mkdir:${targetPath}`);
        return ok(undefined);
      },
      async rmdir(_root, targetPath) {
        calls.push(`rmdir:${targetPath}`);
        return ok(undefined);
      },
      async writeFile(_root, targetPath, content, options) {
        calls.push(`write:${targetPath}:${content}:${options?.createOnly ?? false}`);
        return ok(undefined);
      }
    };
    const operations = new NoFollowFileOperations(root, nativePort);

    expect((await operations.rename("old.txt", "new.txt")).ok).toBe(true);
    expect((await operations.unlink("new.txt")).ok).toBe(true);
    expect((await operations.mkdir("dir")).ok).toBe(true);
    expect((await operations.rmdir("dir")).ok).toBe(true);
    expect((await operations.writeFile("dir/file.txt", "content", { createOnly: true })).ok).toBe(
      true
    );
    expect(calls).toEqual([
      "rename:old.txt:new.txt",
      "unlink:new.txt",
      "mkdir:dir",
      "rmdir:dir",
      "write:dir/file.txt:content:true"
    ]);
  });
});
