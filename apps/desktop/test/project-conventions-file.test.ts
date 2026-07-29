import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { createDesktopProjectConventionsFile } from "../src/main/project-conventions-file.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("project conventions file", () => {
  test.each([
    ["engineeringWorkspace", "AGENTS.md", "# Project conventions\n\n"],
    ["creativeProject", "conventions/writing.md", "# Writing conventions\n\n"]
  ] as const)("creates only the fixed %s path", async (workspaceKind, relativePath, content) => {
    const root = await createRoot();

    const result = await createDesktopProjectConventionsFile({ workspaceKind, projectRoot: root });

    expect(result).toEqual({ ok: true, value: { relativePath, status: "created" } });
    await expect(readFile(join(root, ...relativePath.split("/")), "utf8")).resolves.toBe(content);
  });

  test("reports an existing conventions file without overwriting it", async () => {
    const root = await createRoot();
    await writeFile(join(root, "AGENTS.md"), "keep this\n", "utf8");

    const result = await createDesktopProjectConventionsFile({
      workspaceKind: "engineeringWorkspace",
      projectRoot: root
    });

    expect(result).toEqual({
      ok: true,
      value: { relativePath: "AGENTS.md", status: "existing" }
    });
    await expect(readFile(join(root, "AGENTS.md"), "utf8")).resolves.toBe("keep this\n");
  });

  test("rejects a non-directory conventions parent", async () => {
    const root = await createRoot();
    await writeFile(join(root, "conventions"), "not a directory", "utf8");

    const result = await createDesktopProjectConventionsFile({
      workspaceKind: "creativeProject",
      projectRoot: root
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "PROJECT_CONVENTIONS_PATH_REJECTED" }
    });
  });

  test("rejects a conventions parent replaced by a junction before creation", async () => {
    const root = await createRoot();
    const outside = await createRoot();
    await mkdir(join(root, "conventions"));
    await writeFile(join(outside, "writing.md"), "outside content\n", "utf8");

    const result = await createDesktopProjectConventionsFile({
      workspaceKind: "creativeProject",
      projectRoot: root,
      beforeFinalPathValidation: async () => {
        await rename(join(root, "conventions"), join(root, ".raced-conventions"));
        await symlink(outside, join(root, "conventions"), "junction");
      }
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "PROJECT_CONVENTIONS_PATH_REJECTED" }
    });
    await expect(readFile(join(outside, "writing.md"), "utf8")).resolves.toBe("outside content\n");
  });
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "novel-studio-project-conventions-create-"));
  roots.push(root);
  return root;
}
