import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createUnifiedError, err } from "@novel-studio/shared";
import { afterEach, describe, expect, test } from "vitest";

import { EngineeringWorkspaceFileRepository } from "../src/engineering-workspace-repository.js";

const roots: string[] = [];
const MAX_TEXT_BYTES = 5 * 1024 * 1024;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("EngineeringWorkspaceFileRepository", () => {
  test("bounds traversal while keeping dotfiles and ignoring generated directories", async () => {
    const contentRoot = await createContentRoot();
    await mkdir(join(contentRoot, "src"), { recursive: true });
    await writeFile(join(contentRoot, "src", "index.ts"), "export const value = 1;\n", "utf8");
    await writeFile(join(contentRoot, ".editorconfig"), "root = true\n", "utf8");
    for (const directory of [
      ".git",
      "node_modules",
      "dist",
      "release",
      "build",
      "out",
      "coverage"
    ]) {
      await mkdir(join(contentRoot, directory), { recursive: true });
      await writeFile(join(contentRoot, directory, "ignored.txt"), "ignored\n", "utf8");
    }
    await Promise.all(
      Array.from({ length: 305 }, (_, index) =>
        writeFile(
          join(contentRoot, `file-${String(index).padStart(3, "0")}.txt`),
          `${index}\n`,
          "utf8"
        )
      )
    );
    const repository = new EngineeringWorkspaceFileRepository({ contentRoot });

    const opened = await repository.openWorkspace();

    if (!opened.ok) throw new Error(opened.error.message);
    const paths = flatten(opened.value.tree.nodes).map((node) => node.path);
    expect(opened.value.tree.truncated).toBe(true);
    expect(paths.length).toBeLessThanOrEqual(300);
    expect(paths).toContain("src/index.ts");
    expect(paths).toContain(".editorconfig");
    for (const ignored of [".git", "node_modules", "dist", "release", "build", "out", "coverage"]) {
      expect(paths.some((path) => path === ignored || path.startsWith(`${ignored}/`))).toBe(false);
    }
  });

  test("stops traversal beyond the default maximum depth", async () => {
    const contentRoot = await createContentRoot();
    await mkdir(join(contentRoot, "deep", "a", "b", "c", "d", "e"), { recursive: true });
    await writeFile(
      join(contentRoot, "deep", "a", "b", "c", "d", "e", "too-deep.txt"),
      "hidden by depth limit\n",
      "utf8"
    );
    const repository = new EngineeringWorkspaceFileRepository({ contentRoot });

    const opened = await repository.openWorkspace();

    if (!opened.ok) throw new Error(opened.error.message);
    const paths = flatten(opened.value.tree.nodes).map((node) => node.path);
    expect(opened.value.tree.truncated).toBe(true);
    expect(paths).not.toContain("deep/a/b/c/d/e/too-deep.txt");
  });

  test("does not report truncation for an empty directory at the maximum depth", async () => {
    const contentRoot = await createContentRoot();
    await mkdir(join(contentRoot, "empty"), { recursive: true });
    const repository = new EngineeringWorkspaceFileRepository({ contentRoot, maxDepth: 1 });

    const opened = await repository.openWorkspace();

    if (!opened.ok) throw new Error(opened.error.message);
    expect(opened.value.tree.nodes).toContainEqual(
      expect.objectContaining({ path: "empty", kind: "directory" })
    );
    expect(opened.value.tree.truncated).toBe(false);
  });

  test("reports truncation when a maximum-depth directory has a visible child", async () => {
    const contentRoot = await createContentRoot();
    await mkdir(join(contentRoot, "bounded"), { recursive: true });
    await writeFile(join(contentRoot, "bounded", "child.txt"), "not traversed\n", "utf8");
    const repository = new EngineeringWorkspaceFileRepository({ contentRoot, maxDepth: 1 });

    const opened = await repository.openWorkspace();

    if (!opened.ok) throw new Error(opened.error.message);
    expect(opened.value.tree.truncated).toBe(true);
    expect(flatten(opened.value.tree.nodes).map((node) => node.path)).not.toContain(
      "bounded/child.txt"
    );
  });

  test("rejects lexical and junction escapes for reads and saves", async () => {
    const contentRoot = await createContentRoot();
    const outsideRoot = await createContentRoot("novel-studio-engineering-outside-");
    await mkdir(join(contentRoot, "src"), { recursive: true });
    await writeFile(join(contentRoot, "src", "index.ts"), "inside\n", "utf8");
    await writeFile(join(outsideRoot, "secret.txt"), "outside\n", "utf8");
    await symlink(outsideRoot, join(contentRoot, "linked"), "junction");
    const repository = new EngineeringWorkspaceFileRepository({ contentRoot });

    const opened = await repository.openWorkspace();
    if (!opened.ok) throw new Error(opened.error.message);
    expect(flatten(opened.value.tree.nodes).map((node) => node.path)).not.toContain("linked");

    for (const path of ["../secret.txt", join(outsideRoot, "secret.txt"), "linked/secret.txt"]) {
      expect(await repository.readTextFile(path)).toMatchObject({
        ok: false,
        error: { code: "ENGINEERING_WORKSPACE_PATH_REJECTED" }
      });
    }
    expect(
      await repository.saveTextFile({
        path: "linked/secret.txt",
        content: "attempted overwrite\n",
        expectedChecksum: "0".repeat(64)
      })
    ).toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_WORKSPACE_PATH_REJECTED" }
    });
    expect(await readFile(join(outsideRoot, "secret.txt"), "utf8")).toBe("outside\n");
  });

  test("rejects reads and saves after the bound root junction is retargeted", async () => {
    const firstRoot = await createContentRoot("novel-studio-engineering-first-");
    const secondRoot = await createContentRoot("novel-studio-engineering-second-");
    const linkParent = await createContentRoot("novel-studio-engineering-link-");
    const linkedRoot = join(linkParent, "workspace");
    await writeFile(join(firstRoot, "notes.txt"), "first\n", "utf8");
    await writeFile(join(secondRoot, "notes.txt"), "second\n", "utf8");
    await symlink(firstRoot, linkedRoot, "junction");
    const repository = new EngineeringWorkspaceFileRepository({ contentRoot: linkedRoot });
    const original = await repository.readTextFile("notes.txt");
    if (!original.ok) throw new Error(original.error.message);

    await rm(linkedRoot, { recursive: true, force: true });
    await symlink(secondRoot, linkedRoot, "junction");

    expect(await repository.readTextFile("notes.txt")).toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_WORKSPACE_PATH_REJECTED" }
    });
    expect(
      await repository.saveTextFile({
        path: "notes.txt",
        content: "attempted overwrite\n",
        expectedChecksum: original.value.checksum
      })
    ).toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_WORKSPACE_PATH_REJECTED" }
    });
    expect(await readFile(join(secondRoot, "notes.txt"), "utf8")).toBe("second\n");
    await rm(linkedRoot, { recursive: true, force: true });
  });

  test("reads strict UTF-8 text with a byte checksum", async () => {
    const contentRoot = await createContentRoot();
    const content = "中文正文与 emoji 😀\n";
    await writeFile(join(contentRoot, "notes.txt"), content, "utf8");
    const repository = new EngineeringWorkspaceFileRepository({ contentRoot });

    const read = await repository.readTextFile("notes.txt");

    expect(read).toEqual({
      ok: true,
      value: {
        path: "notes.txt",
        content,
        checksum: createHash("sha256").update(Buffer.from(content, "utf8")).digest("hex"),
        byteLength: Buffer.byteLength(content, "utf8")
      }
    });
  });

  test("rejects invalid UTF-8 and oversized text files", async () => {
    const contentRoot = await createContentRoot();
    await writeFile(join(contentRoot, "invalid.txt"), Buffer.from([0xc3, 0x28]));
    await writeFile(join(contentRoot, "oversized.txt"), Buffer.alloc(MAX_TEXT_BYTES + 1, 0x61));
    const repository = new EngineeringWorkspaceFileRepository({ contentRoot });

    expect(await repository.readTextFile("invalid.txt")).toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_TEXT_FILE_READ_FAILED" }
    });
    expect(await repository.readTextFile("oversized.txt")).toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_TEXT_FILE_TOO_LARGE" }
    });
  });

  test("atomically saves when the expected checksum still matches", async () => {
    const contentRoot = await createContentRoot();
    await mkdir(join(contentRoot, "src"), { recursive: true });
    await writeFile(join(contentRoot, "src", "index.ts"), "original\n", "utf8");
    const repository = new EngineeringWorkspaceFileRepository({ contentRoot });
    const original = await repository.readTextFile("src/index.ts");
    if (!original.ok) throw new Error(original.error.message);

    const saved = await repository.saveTextFile({
      path: "src/index.ts",
      content: "saved\n",
      expectedChecksum: original.value.checksum
    });

    expect(saved).toMatchObject({
      ok: true,
      value: {
        kind: "saved",
        document: {
          path: "src/index.ts",
          content: "saved\n",
          checksum: createHash("sha256").update("saved\n", "utf8").digest("hex")
        }
      }
    });
    expect(await readFile(join(contentRoot, "src", "index.ts"), "utf8")).toBe("saved\n");
    expect(
      (await readdir(join(contentRoot, "src"))).filter((name) => name.includes(".tmp-"))
    ).toEqual([]);
  });

  test("maps atomic write failures without exposing the canonical content root", async () => {
    const contentRoot = await createContentRoot();
    await mkdir(join(contentRoot, "src"), { recursive: true });
    await writeFile(join(contentRoot, "src", "index.ts"), "original\n", "utf8");
    const repository = new EngineeringWorkspaceFileRepository({
      contentRoot,
      atomicWriter: async (input) =>
        err(
          createUnifiedError({
            code: "ATOMIC_WRITE_FAILED",
            category: "StorageError",
            message: "Atomic write failed.",
            recoverability: "user-action",
            suggestedAction: "Retry the write.",
            traceId: "engineering-workspace-repository-test",
            redactedDetail: {
              targetPath: input.targetPath,
              reason: `Could not replace ${input.targetPath}`
            }
          })
        )
    });
    const original = await repository.readTextFile("src/index.ts");
    if (!original.ok) throw new Error(original.error.message);

    const failed = await repository.saveTextFile({
      path: "src/index.ts",
      content: "saved\n",
      expectedChecksum: original.value.checksum
    });

    expect(failed).toMatchObject({
      ok: false,
      error: {
        code: "ENGINEERING_TEXT_FILE_WRITE_FAILED",
        redactedDetail: { path: "src/index.ts" }
      }
    });
    if (failed.ok) throw new Error("Expected the write to fail.");
    expect(JSON.stringify(failed.error)).not.toContain(JSON.stringify(contentRoot).slice(1, -1));
    expect(await readFile(join(contentRoot, "src", "index.ts"), "utf8")).toBe("original\n");
  });

  test("returns a conflict without overwriting an external edit", async () => {
    const contentRoot = await createContentRoot();
    await mkdir(join(contentRoot, "src"), { recursive: true });
    await writeFile(join(contentRoot, "src", "index.ts"), "original\n", "utf8");
    const repository = new EngineeringWorkspaceFileRepository({ contentRoot });
    const original = await repository.readTextFile("src/index.ts");
    if (!original.ok) throw new Error(original.error.message);
    await writeFile(join(contentRoot, "src", "index.ts"), "external change\n", "utf8");

    const conflict = await repository.saveTextFile({
      path: "src/index.ts",
      content: "editor draft\n",
      expectedChecksum: original.value.checksum
    });

    expect(conflict).toMatchObject({
      ok: true,
      value: {
        kind: "conflict",
        current: { content: "external change\n" },
        attemptedContent: "editor draft\n"
      }
    });
    expect(await readFile(join(contentRoot, "src", "index.ts"), "utf8")).toBe("external change\n");
  });
});

async function createContentRoot(prefix = "novel-studio-engineering-root-"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function flatten<T extends { readonly children?: readonly T[] }>(nodes: readonly T[]): T[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
}
