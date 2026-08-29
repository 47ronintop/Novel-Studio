import { mkdtemp, realpath, readdir, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, sep } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { WorkspaceStateFileRepository } from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("WorkspaceStateFileRepository", () => {
  test("maps a canonical content root to one stable app-local workspace state root", async () => {
    const contentRoot = await createRoot("content");
    const userDataRoot = await createRoot("user-data");
    const canonicalContentRoot = await realpath(contentRoot);
    const repository = new WorkspaceStateFileRepository({ userDataRoot });

    const first = await repository.resolveState(canonicalContentRoot);
    const second = await repository.resolveState(canonicalContentRoot);

    if (!first.ok) throw new Error(first.error.message);
    if (!second.ok) throw new Error(second.error.message);
    expect(first).toEqual(second);
    expect(first.value.workspaceId).toMatch(/^ws_[a-f0-9]{24}$/u);
    expect(first.value.stateRoot).toBe(
      await realpath(join(userDataRoot, "workspaces", first.value.workspaceId))
    );
    expect((await stat(first.value.stateRoot)).isDirectory()).toBe(true);
    expect(await readdir(contentRoot)).toEqual([]);
  });

  test("rejects missing and non-canonical roots without creating workspace state", async () => {
    const contentRoot = await createRoot("canonical");
    const userDataRoot = await createRoot("rejected-user-data");
    const repository = new WorkspaceStateFileRepository({ userDataRoot });
    const canonicalContentRoot = await realpath(contentRoot);
    const nonCanonicalRoot = `${canonicalContentRoot}${sep}..${sep}${basename(canonicalContentRoot)}`;
    const missingRoot = join(contentRoot, "missing");

    const nonCanonical = await repository.resolveState(nonCanonicalRoot);
    const missing = await repository.resolveState(missingRoot);

    expect(nonCanonical).toMatchObject({
      ok: false,
      error: { code: "WORKSPACE_STATE_CONTENT_ROOT_REJECTED" }
    });
    expect(missing).toMatchObject({
      ok: false,
      error: { code: "WORKSPACE_STATE_CONTENT_ROOT_REJECTED" }
    });
    expect(JSON.stringify([nonCanonical, missing])).not.toContain(contentRoot);
    await expect(stat(join(userDataRoot, "workspaces"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(contentRoot)).toEqual([]);
  });

  test("returns a canonical state root when the user-data root uses a realpath alias", async () => {
    const contentRoot = await createRoot("aliased-content");
    const userDataRoot = await createRoot("aliased-user-data");
    const userDataAlias = `${userDataRoot}-alias`;
    await symlink(userDataRoot, userDataAlias, process.platform === "win32" ? "junction" : "dir");
    roots.push(userDataAlias);
    const repository = new WorkspaceStateFileRepository({ userDataRoot: userDataAlias });

    const resolved = await repository.resolveState(await realpath(contentRoot));

    expect(resolved).toMatchObject({ ok: true });
    if (!resolved.ok) return;
    expect(resolved.value.stateRoot).toBe(await realpath(resolved.value.stateRoot));
    expect(resolved.value.stateRoot).toBe(
      await realpath(join(userDataAlias, "workspaces", resolved.value.workspaceId))
    );
  });
});

async function createRoot(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `novel-studio-workspace-state-${name}-`));
  roots.push(root);
  return root;
}
