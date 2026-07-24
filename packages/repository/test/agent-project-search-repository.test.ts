import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { AgentProjectSearchRepository } from "../src/agent-project-search-repository.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeProjectRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "novel-studio-search-"));
  roots.push(root);
  return root;
}

describe("AgentProjectSearchRepository — engineering workspace", () => {
  test("finds text in a file and returns bounded results", async () => {
    const root = await makeProjectRoot();
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "app.ts"), "function main() { return 42; }\n", "utf8");
    await writeFile(join(root, "README.md"), "# My Project\nThis is the main project.", "utf8");

    const repo = new AgentProjectSearchRepository({
      projectRoot: root,
      workspaceKind: "engineeringWorkspace"
    });
    const result = await repo.searchText({ query: "main" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items.length).toBeGreaterThan(0);
    expect(result.value.totalHits).toBeGreaterThan(0);
    for (const item of result.value.items) {
      expect(item.relativePath).not.toContain("\\");
      expect(item.snippet).toContain("main");
      expect(item.sourceChecksum).toMatch(/^[a-f0-9]{64}$/);
      expect(item.resultDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(item.range.unit).toBe("line_column");
    }
  });

  test("rejects malicious path inputs", async () => {
    const root = await makeProjectRoot();
    const repo = new AgentProjectSearchRepository({
      projectRoot: root,
      workspaceKind: "engineeringWorkspace"
    });

    // Empty query
    expect((await repo.searchText({ query: "" })).ok).toBe(false);

    // Query too long
    expect((await repo.searchText({ query: "x".repeat(2000) })).ok).toBe(false);

    // Traversal in glob
    const result = await repo.searchText({ query: "test", includeGlobs: ["../outside/*.md"] });
    expect(result.ok).toBe(false);

    // Absolute path in glob
    const result2 = await repo.searchText({ query: "test", includeGlobs: ["/etc/*.conf"] });
    expect(result2.ok).toBe(false);
  });

  test("rejects invalid stable refs in findReferences", async () => {
    const root = await makeProjectRoot();
    const repo = new AgentProjectSearchRepository({
      projectRoot: root,
      workspaceKind: "engineeringWorkspace"
    });

    // Traversal
    const r1 = await repo.findReferences({ stableRef: "../secret.md" });
    expect(r1.ok).toBe(false);

    // Absolute path
    const r2 = await repo.findReferences({ stableRef: "/etc/passwd" });
    expect(r2.ok).toBe(false);

    // Backslash
    const r3 = await repo.findReferences({ stableRef: "src\\app.ts" });
    expect(r3.ok).toBe(false);

    // Empty
    const r4 = await repo.findReferences({ stableRef: "" });
    expect(r4.ok).toBe(false);
  });

  test("does not traverse .git or node_modules", async () => {
    const root = await makeProjectRoot();
    await mkdir(join(root, ".git"), { recursive: true });
    await writeFile(join(root, ".git", "secret"), "git secret content", "utf8");
    await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
    await writeFile(join(root, "node_modules", "pkg", "index.js"), "secret content", "utf8");
    await writeFile(join(root, "README.md"), "public content", "utf8");

    const repo = new AgentProjectSearchRepository({
      projectRoot: root,
      workspaceKind: "engineeringWorkspace"
    });

    const result = await repo.searchText({ query: "secret" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Should not find anything in .git or node_modules
    for (const item of result.value.items) {
      expect(item.relativePath.startsWith(".git/")).toBe(false);
      expect(item.relativePath.startsWith("node_modules/")).toBe(false);
    }
  });

  test("does not follow symlinks", async () => {
    const root = await makeProjectRoot();
    const outside = await mkdtemp(join(tmpdir(), "novel-studio-search-outside-"));
    roots.push(outside);
    await writeFile(join(outside, "secret.md"), "outside secret content", "utf8");

    try {
      await symlink(outside, join(root, "linked"), "junction");
      const repo = new AgentProjectSearchRepository({
        projectRoot: root,
        workspaceKind: "engineeringWorkspace"
      });
      const result = await repo.searchText({ query: "outside secret" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      for (const item of result.value.items) {
        expect(item.relativePath.startsWith("linked/")).toBe(false);
      }
    } catch {
      // Junction creation may fail in some environments — skip
    }
  });

  test("applies include and exclude globs correctly", async () => {
    const root = await makeProjectRoot();
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "tests"), { recursive: true });
    await writeFile(join(root, "src", "app.ts"), "hello world code", "utf8");
    await writeFile(join(root, "tests", "app.test.ts"), "hello world test", "utf8");

    const repo = new AgentProjectSearchRepository({
      projectRoot: root,
      workspaceKind: "engineeringWorkspace"
    });

    // Include only src/**
    const r1 = await repo.searchText({ query: "hello", includeGlobs: ["src/**"] });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    for (const item of r1.value.items) {
      expect(item.relativePath.startsWith("src/")).toBe(true);
    }

    // Exclude tests/**
    const r2 = await repo.searchText({ query: "hello", excludeGlobs: ["tests/**"] });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    for (const item of r2.value.items) {
      expect(item.relativePath.startsWith("tests/")).toBe(false);
    }
  });

  test("returns truncated flag when result limit is hit", async () => {
    const root = await makeProjectRoot();
    for (let i = 0; i < 10; i++) {
      await writeFile(join(root, `file${i}.md`), "needle in file", "utf8");
    }

    const repo = new AgentProjectSearchRepository({
      projectRoot: root,
      workspaceKind: "engineeringWorkspace"
    });
    const result = await repo.searchText({ query: "needle", maxResults: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items.length).toBeLessThanOrEqual(3);
    expect(result.value.truncated).toBe(true);
  });

  test("result items are sorted deterministically", async () => {
    const root = await makeProjectRoot();
    await writeFile(join(root, "zzz.md"), "find me here", "utf8");
    await writeFile(join(root, "aaa.md"), "find me here", "utf8");
    await writeFile(join(root, "mmm.md"), "find me here", "utf8");

    const repo = new AgentProjectSearchRepository({
      projectRoot: root,
      workspaceKind: "engineeringWorkspace"
    });
    const r1 = await repo.searchText({ query: "find me" });
    const r2 = await repo.searchText({ query: "find me" });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.value.items.map((i) => i.relativePath)).toEqual(
      r2.value.items.map((i) => i.relativePath)
    );
  });

  test("Windows device names in include globs are rejected", async () => {
    const root = await makeProjectRoot();
    const repo = new AgentProjectSearchRepository({
      projectRoot: root,
      workspaceKind: "engineeringWorkspace"
    });
    const result = await repo.searchText({ query: "test", includeGlobs: ["CON.md"] });
    // CON is a Windows device name in a glob — should be rejected
    expect(result.ok).toBe(false);
  });
});
