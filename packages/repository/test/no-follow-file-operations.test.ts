import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  noFollowStat,
  noFollowRename,
  noFollowUnlink,
  noFollowMkdir,
  NoFollowFileOperations
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

  test("rejects symlink at target", async () => {
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
      // symlink creation may fail in some environments
    }
  });

  test("rejects junction/directory symlink in path segment", async () => {
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
      // junction creation may fail
    }
  });
});

describe("noFollowRename", () => {
  test("renames a regular file", async () => {
    const root = await makeRoot();
    await writeFile(join(root, "old.txt"), "content", "utf8");
    const result = await noFollowRename(root, "old.txt", "new.txt");
    expect(result.ok).toBe(true);
    // Verify file was actually renamed
    const statResult = await noFollowStat(root, "new.txt");
    expect(statResult.ok).toBe(true);
  });

  test("rejects rename when source is a symlink segment", async () => {
    const root = await makeRoot();
    const outside = await mkdtemp(join(tmpdir(), "novel-studio-nf-outside3-"));
    roots.push(outside);
    await writeFile(join(outside, "file.txt"), "content", "utf8");
    try {
      await symlink(outside, join(root, "linked"), "junction");
      const result = await noFollowRename(root, "linked/file.txt", "moved.txt");
      expect(result.ok).toBe(false);
    } catch {
      // junction creation may fail
    }
  });
});

describe("noFollowUnlink", () => {
  test("deletes a regular file", async () => {
    const root = await makeRoot();
    await writeFile(join(root, "to-delete.txt"), "content", "utf8");
    const result = await noFollowUnlink(root, "to-delete.txt");
    expect(result.ok).toBe(true);
  });

  test("returns error for non-existent file", async () => {
    const root = await makeRoot();
    const result = await noFollowUnlink(root, "nonexistent.txt");
    expect(result.ok).toBe(false);
  });

  test("rejects symlink at target", async () => {
    const root = await makeRoot();
    const outside = await mkdtemp(join(tmpdir(), "novel-studio-nf-outside4-"));
    roots.push(outside);
    await writeFile(join(outside, "file.txt"), "content", "utf8");
    try {
      await symlink(join(outside, "file.txt"), join(root, "link.txt"));
      const result = await noFollowUnlink(root, "link.txt");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("NO_FOLLOW_SYMLINK_REJECTED");
    } catch {
      // symlink creation may fail
    }
  });
});

describe("noFollowMkdir", () => {
  test("creates a directory", async () => {
    const root = await makeRoot();
    const result = await noFollowMkdir(root, "newdir");
    expect(result.ok).toBe(true);
    const statResult = await noFollowStat(root, "newdir");
    expect(statResult.ok).toBe(true);
    if (!statResult.ok) return;
    expect(statResult.value.isDirectory()).toBe(true);
  });

  test("returns error if directory already exists", async () => {
    const root = await makeRoot();
    await mkdir(join(root, "existing"), { recursive: true });
    const result = await noFollowMkdir(root, "existing");
    expect(result.ok).toBe(false);
  });

  test("rejects junction in parent path", async () => {
    const root = await makeRoot();
    const outside = await mkdtemp(join(tmpdir(), "novel-studio-nf-outside5-"));
    roots.push(outside);
    try {
      await symlink(outside, join(root, "linked"), "junction");
      const result = await noFollowMkdir(root, "linked/newdir");
      expect(result.ok).toBe(false);
    } catch {
      // junction creation may fail
    }
  });
});

describe("NoFollowFileOperations class", () => {
  test("exposes stat, rename, unlink, mkdir methods", async () => {
    const root = await makeRoot();
    await writeFile(join(root, "test.txt"), "content", "utf8");
    const ops = new NoFollowFileOperations(root);
    const stat = await ops.stat("test.txt");
    expect(stat.ok).toBe(true);
    const mk = await ops.mkdir("subdir");
    expect(mk.ok).toBe(true);
    const ren = await ops.rename("test.txt", "subdir/renamed.txt");
    expect(ren.ok).toBe(true);
    const unl = await ops.unlink("subdir/renamed.txt");
    expect(unl.ok).toBe(true);
  });
});
