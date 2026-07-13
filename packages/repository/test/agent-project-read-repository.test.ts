import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import * as repositoryExports from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("AgentProjectReadRepository", () => {
  test("reads bounded project text and rejects lexical escapes and junction traversal", async () => {
    const Repository = (repositoryExports as unknown as Record<string, unknown>)[
      "AgentProjectReadRepository"
    ];
    expect(typeof Repository).toBe("function");
    if (typeof Repository !== "function") return;

    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-agent-read-root-"));
    const outsideRoot = await mkdtemp(join(tmpdir(), "novel-studio-agent-read-outside-"));
    roots.push(projectRoot, outsideRoot);
    await mkdir(join(projectRoot, "notes"), { recursive: true });
    await mkdir(join(projectRoot, "history"), { recursive: true });
    await writeFile(join(projectRoot, "notes", "outline.md"), "Outline text", "utf8");
    await writeFile(join(projectRoot, "history", "private.md"), "internal", "utf8");
    await writeFile(join(outsideRoot, "secret.md"), "outside secret", "utf8");
    await symlink(outsideRoot, join(projectRoot, "notes", "linked"), "junction");

    const repository = new (
      Repository as new (options: { projectRoot: string }) => {
        readText(path: string): Promise<unknown>;
        listEntries(path?: string): Promise<unknown>;
      }
    )({ projectRoot });

    expect(await repository.readText("notes/outline.md")).toMatchObject({
      ok: true,
      value: {
        relativePath: "notes/outline.md",
        content: "Outline text",
        checksum: expect.stringMatching(/^[a-f0-9]{64}$/)
      }
    });
    for (const path of [
      "../outside.md",
      "C:/outside.md",
      "history/private.md",
      "notes/linked/secret.md"
    ]) {
      expect(await repository.readText(path)).toMatchObject({
        ok: false,
        error: { code: "AGENT_PROJECT_PATH_REJECTED" }
      });
    }
    expect(await repository.listEntries()).toMatchObject({
      ok: true,
      value: [expect.objectContaining({ relativePath: "notes", kind: "directory" })]
    });
    expect(JSON.stringify(await repository.listEntries())).not.toContain("history");
    expect(JSON.stringify(await repository.listEntries("notes"))).not.toContain("linked");
  });
});
