import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import * as repositoryExports from "../src/index.js";
import { AgentProjectReadRepository } from "../src/agent-project-read-repository.js";

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
    await mkdir(join(projectRoot, ".novel-studio"), { recursive: true });
    await writeFile(join(projectRoot, "notes", "outline.md"), "Outline text", "utf8");
    await mkdir(join(projectRoot, "src"), { recursive: true });
    await writeFile(join(projectRoot, "src", "index.ts"), "export {};\n", "utf8");
    await writeFile(join(projectRoot, "history", "private.md"), "internal", "utf8");
    await writeFile(join(projectRoot, ".novel-studio", "project-lock.json"), "{}", "utf8");
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
    expect(await repository.readText("src/index.ts")).toMatchObject({
      ok: true,
      value: { relativePath: "src/index.ts", content: "export {};\n" }
    });
    expect(await repository.readText("notes/missing.md")).toMatchObject({
      ok: false,
      error: { code: "AGENT_PROJECT_FILE_NOT_FOUND" }
    });
    for (const path of [
      "../outside.md",
      "C:/outside.md",
      "history/private.md",
      ".novel-studio/project-lock.json",
      "notes/linked/secret.md"
    ]) {
      expect(await repository.readText(path)).toMatchObject({
        ok: false,
        error: { code: "AGENT_PROJECT_PATH_REJECTED" }
      });
    }
    expect(await repository.listEntries()).toMatchObject({
      ok: true,
      value: [
        expect.objectContaining({ relativePath: "notes", kind: "directory" }),
        expect.objectContaining({ relativePath: "src", kind: "directory" })
      ]
    });
    expect(JSON.stringify(await repository.listEntries())).not.toContain("history");
    expect(JSON.stringify(await repository.listEntries())).not.toContain(".novel-studio");
    expect(JSON.stringify(await repository.listEntries("notes"))).not.toContain("linked");
  });

  test("keeps a read bound to the opened file when its pathname becomes a symlink", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-agent-read-race-root-"));
    const outsideRoot = await mkdtemp(join(tmpdir(), "novel-studio-agent-read-race-outside-"));
    roots.push(projectRoot, outsideRoot);
    const targetPath = join(projectRoot, "target.md");
    const outsidePath = join(outsideRoot, "secret.md");
    await writeFile(targetPath, "inside handle content", "utf8");
    await writeFile(outsidePath, "outside substituted content", "utf8");

    try {
      const probePath = join(projectRoot, "symlink-probe.md");
      await symlink(outsidePath, probePath, "file");
      await rm(probePath, { force: true });
    } catch {
      // File symlink creation can be unavailable in restricted Windows environments.
      return;
    }

    class SwapAfterVerificationRepository extends AgentProjectReadRepository {
      protected override async afterPathIdentityVerified(fullPath: string): Promise<void> {
        if (fullPath !== targetPath) return;
        await rm(targetPath, { force: true });
        await symlink(outsidePath, targetPath, "file");
      }
    }

    const repository = new SwapAfterVerificationRepository({ projectRoot });
    expect(await repository.readText("target.md")).toMatchObject({
      ok: true,
      value: { content: "inside handle content" }
    });
  });

  test("rejects a symlinked text file before opening it", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-agent-read-link-root-"));
    const outsideRoot = await mkdtemp(join(tmpdir(), "novel-studio-agent-read-link-outside-"));
    roots.push(projectRoot, outsideRoot);
    const outsidePath = join(outsideRoot, "secret.md");
    await writeFile(outsidePath, "outside secret", "utf8");

    try {
      await symlink(outsidePath, join(projectRoot, "linked.md"), "file");
    } catch {
      // File symlink creation can be unavailable in restricted Windows environments.
      return;
    }

    const repository = new AgentProjectReadRepository({ projectRoot });
    expect(await repository.readText("linked.md")).toMatchObject({
      ok: false,
      error: { code: "AGENT_PROJECT_PATH_REJECTED" }
    });
  });
});
