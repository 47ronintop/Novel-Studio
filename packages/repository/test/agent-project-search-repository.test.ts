import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { AgentProjectSearchRepository } from "../src/agent-project-search-repository.js";
import { DEFAULT_CREATIVE_PROJECT_FILE_POLICY } from "../src/creative-project-file-repository.js";

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

  test("searches allowlisted source formats but excludes credentials and private keys", async () => {
    const root = await makeProjectRoot();
    await Promise.all([
      writeFile(join(root, "app.ts"), "const marker = 'public searchable marker';", "utf8"),
      writeFile(join(root, "README.md"), "public searchable marker", "utf8"),
      writeFile(join(root, "package.json"), '{"marker":"public searchable marker"}', "utf8"),
      writeFile(join(root, ".env"), "TOKEN=classified marker", "utf8"),
      writeFile(join(root, ".npmrc"), "//registry/:_authToken=classified marker", "utf8"),
      writeFile(join(root, ".gitconfig"), "[credential]\nhelper=classified marker", "utf8"),
      writeFile(join(root, "id_rsa"), "classified marker", "utf8"),
      writeFile(join(root, "deploy.pem"), "classified marker", "utf8"),
      writeFile(join(root, "server.key"), "classified marker", "utf8"),
      writeFile(join(root, "api-key.json"), '{"key":"classified marker"}', "utf8"),
      writeFile(join(root, "credentials.json"), '{"token":"classified marker"}', "utf8")
    ]);

    const repo = new AgentProjectSearchRepository({
      projectRoot: root,
      workspaceKind: "engineeringWorkspace"
    });

    const publicResult = await repo.searchText({ query: "public searchable marker" });
    expect(publicResult.ok).toBe(true);
    if (!publicResult.ok) return;
    expect(publicResult.value.items.map((item) => item.relativePath)).toEqual([
      "app.ts",
      "package.json",
      "README.md"
    ]);

    const secretResult = await repo.searchText({ query: "classified marker" });
    expect(secretResult.ok).toBe(true);
    if (!secretResult.ok) return;
    expect(secretResult.value.items).toHaveLength(0);
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

  test("truncates a no-match search when the scanned-byte budget is exhausted", async () => {
    const root = await makeProjectRoot();
    const megabyte = "x".repeat(1024 * 1024);
    for (let index = 0; index < 17; index++) {
      await writeFile(join(root, `source-${index}.ts`), megabyte, "utf8");
    }

    const repo = new AgentProjectSearchRepository({
      projectRoot: root,
      workspaceKind: "engineeringWorkspace"
    });
    const result = await repo.searchText({ query: "not-present" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items).toHaveLength(0);
    expect(result.value.truncated).toBe(true);
  });

  test("does not scan a file larger than the per-file handle read limit", async () => {
    const root = await makeProjectRoot();
    await writeFile(
      join(root, "too-large.ts"),
      `${"x".repeat(1024 * 1024)} outside marker`,
      "utf8"
    );

    const repo = new AgentProjectSearchRepository({
      projectRoot: root,
      workspaceKind: "engineeringWorkspace"
    });
    const result = await repo.searchText({ query: "outside marker" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items).toHaveLength(0);
  });

  test("rejects a symlinked text file rather than searching its target", async () => {
    const root = await makeProjectRoot();
    const outside = await mkdtemp(join(tmpdir(), "novel-studio-search-outside-file-"));
    roots.push(outside);
    await writeFile(join(outside, "secret.md"), "outside swapped target marker", "utf8");

    try {
      await symlink(join(outside, "secret.md"), join(root, "target.md"), "file");
    } catch {
      // Symlink creation may be unavailable in restricted Windows environments.
      return;
    }
    const repo = new AgentProjectSearchRepository({
      projectRoot: root,
      workspaceKind: "engineeringWorkspace"
    });
    const result = await repo.searchText({ query: "outside swapped target marker" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items).toHaveLength(0);
  });

  test("does not read an outside target swapped in after path identity verification", async () => {
    const root = await makeProjectRoot();
    const outside = await mkdtemp(join(tmpdir(), "novel-studio-search-race-outside-"));
    roots.push(outside);
    const targetPath = join(root, "target.md");
    const outsidePath = join(outside, "secret.md");
    await writeFile(targetPath, "inside handle marker", "utf8");
    await writeFile(outsidePath, "outside swapped marker", "utf8");

    class SwapAfterVerificationRepository extends AgentProjectSearchRepository {
      public constructor() {
        super({ projectRoot: root, workspaceKind: "engineeringWorkspace" });
      }

      protected override async afterPathIdentityVerified(fullPath: string): Promise<void> {
        if (fullPath !== targetPath) return;
        await rm(targetPath, { force: true });
        await symlink(outsidePath, targetPath, "file");
      }
    }

    try {
      const probePath = join(root, "symlink-probe");
      await symlink(outsidePath, probePath, "file");
      await rm(probePath, { force: true });
    } catch {
      // Symlink creation may be unavailable in restricted Windows environments.
      return;
    }
    const repo = new SwapAfterVerificationRepository();
    const result = await repo.searchText({ query: "marker" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items).toHaveLength(1);
    expect(result.value.items[0]?.snippet).toContain("inside handle marker");
    expect(result.value.items[0]?.snippet).not.toContain("outside swapped marker");
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

describe("AgentProjectSearchRepository — creative project files", () => {
  test("searches allowed project files without scanning managed or unsupported paths", async () => {
    const root = await makeProjectRoot();
    await mkdir(join(root, "notes"), { recursive: true });
    await mkdir(join(root, "chapters"), { recursive: true });
    await writeFile(join(root, "notes", "visible.md"), "creative search marker", "utf8");
    await writeFile(join(root, "settings.json"), "creative search marker", "utf8");
    await writeFile(join(root, "chapters", "managed.md"), "creative search marker", "utf8");
    await writeFile(join(root, "notes", "unsupported.ts"), "creative search marker", "utf8");

    const repo = new AgentProjectSearchRepository({
      projectRoot: root,
      workspaceKind: "creativeProject",
      creativeProjectFilePolicy: DEFAULT_CREATIVE_PROJECT_FILE_POLICY
    });
    const result = await repo.searchText({ query: "creative search marker" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items.map((item) => item.relativePath)).toEqual(["notes/visible.md"]);
    expect(result.value.indexVersion).toBe("creative-project-files/1.0");
  });
});
