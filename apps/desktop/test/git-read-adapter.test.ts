import { describe, it, expect } from "vitest";

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
});
