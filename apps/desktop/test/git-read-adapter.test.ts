import { createHash } from "node:crypto";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect } from "vitest";
import { ok } from "@novel-studio/shared";

/**
 * Tests for GitReadAdapter — verifies fail-closed behavior and path safety.
 */
describe("GitReadAdapter", () => {
  it("returns AGENT_GIT_ADAPTER_UNAVAILABLE when manifest is placeholder", async () => {
    const { GitReadAdapter } = await import("../src/main/git-read-adapter.js");
    const adapter = new GitReadAdapter({ resourcesBase: "resources" });
    const result = await adapter.gitStatus("/some/path");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("AGENT_GIT_ADAPTER_UNAVAILABLE");
    }
  });

  it("rejects paths with traversal in gitDiff", async () => {
    const { GitReadAdapter } = await import("../src/main/git-read-adapter.js");
    const adapter = new GitReadAdapter({ resourcesBase: "resources" });
    const result = await adapter.gitDiff("/project", ["../../../etc/passwd"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(["AGENT_GIT_ADAPTER_UNAVAILABLE", "AGENT_GIT_PATHSPEC_INVALID"]).toContain(
        result.error.code
      );
    }
  });

  it("rejects pathspec with null byte", async () => {
    const { GitReadAdapter } = await import("../src/main/git-read-adapter.js");
    const adapter = new GitReadAdapter({ resourcesBase: "resources" });
    const result = await adapter.gitDiff("/project", ["file\0name"]);
    expect(result.ok).toBe(false);
  });

  it("rejects pathspec magic prefix", async () => {
    const { GitReadAdapter } = await import("../src/main/git-read-adapter.js");
    const adapter = new GitReadAdapter({ resourcesBase: "resources" });
    const result = await adapter.gitDiff("/project", [":!excluded"]);
    expect(result.ok).toBe(false);
  });

  it("routes a verified runtime through the qualified sandbox instead of spawning Git", async () => {
    const { GitReadAdapter } = await import("../src/main/git-read-adapter.js");
    const root = await mkdtemp(join(tmpdir(), "agent-git-adapter-"));
    const resourcesBase = join(root, "resources");
    const gitDirectory = join(resourcesBase, "git");
    const worktree = join(root, "worktree");
    const calls: unknown[] = [];

    try {
      await mkdir(gitDirectory, { recursive: true });
      await mkdir(join(worktree, ".git"), { recursive: true });
      await writeFile(join(worktree, ".git", "config"), "[core]\nrepositoryformatversion = 0\n");
      const fakeGit = Buffer.from("this test file is intentionally not executable");
      await writeFile(join(gitDirectory, "git.exe"), fakeGit);
      const digest = createHash("sha256").update(fakeGit).digest("hex");
      const adapter = new GitReadAdapter({
        resourcesBase,
        sandbox: {
          async getQualification() {
            return ok({
              attestationId: "attest_test",
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
              hostDigest: "a".repeat(64),
              gitRuntimeDigest: digest,
              profile: "git-readonly-v1" as const,
              capabilities: {
                fileIsolation: "verified" as const,
                networkIsolation: "verified" as const,
                jobObjectKillOnClose: "verified" as const,
                appContainerOrLowBox: "verified" as const
              }
            });
          },
          async executeGitRead(input) {
            calls.push(input);
            return ok({
              stdout: "## main\n M chapter.md\n",
              stderr: "",
              exitCode: 0,
              truncated: false
            });
          }
        }
      });

      await writeFile(
        join(gitDirectory, "manifest.json"),
        JSON.stringify({
          schemaVersion: "1.0",
          version: "unavailable",
          digest,
          path: "git/git.exe",
          license: "GPL-2.0"
        })
      );
      const unavailable = await adapter.gitStatus(worktree);
      expect(unavailable.ok).toBe(false);
      expect(calls).toHaveLength(0);

      await writeFile(
        join(gitDirectory, "manifest.json"),
        JSON.stringify({
          schemaVersion: "1.0",
          version: "test",
          digest,
          path: "git/git.exe",
          license: "GPL-2.0"
        })
      );

      const result = await adapter.gitStatus(worktree);
      if (!result.ok) throw new Error(result.error.message);
      expect(result).toMatchObject({ ok: true });
      expect(calls).toHaveLength(1);
      const call = calls[0] as { argv: readonly string[]; environment: Record<string, string> };
      expect(calls[0]).toMatchObject({
        profile: "git-readonly-v1",
        runtime: { executablePath: await realpath(join(gitDirectory, "git.exe")), digest }
      });
      expect(call.argv).not.toContain("--no-config");
      expect(call.argv).toContain("--no-pager");
      expect(call.argv).toContain("core.hooksPath=NUL");
      expect(call.environment.GIT_CONFIG_NOSYSTEM).toBe("1");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects alternate-data-stream resource paths in Git manifests", async () => {
    const { parseGitRuntimeManifest } = await import("../src/main/git-read-adapter.js");

    expect(
      parseGitRuntimeManifest({
        schemaVersion: "1.0",
        version: "test",
        digest: "a".repeat(64),
        path: "git/git.exe:Zone.Identifier",
        license: "GPL-2.0"
      })
    ).toBeUndefined();
  });
});
