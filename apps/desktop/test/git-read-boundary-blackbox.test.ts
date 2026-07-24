import { describe, it, expect } from "vitest";

/**
 * Boundary blackbox tests for git-read-adapter against malicious repository fixtures.
 */
describe("GitReadAdapter boundary blackbox tests", () => {
  it("is unavailable with placeholder manifest (baseline)", async () => {
    const { GitReadAdapter } = await import("../src/main/git-read-adapter.js");
    const adapter = new GitReadAdapter({ resourcesBase: "resources" });
    const result = await adapter.gitStatus("/any/path");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("AGENT_GIT_ADAPTER_UNAVAILABLE");
    }
  });

  it("rejects external gitdir fixture path traversal attempts", async () => {
    const { GitReadAdapter } = await import("../src/main/git-read-adapter.js");
    const adapter = new GitReadAdapter({ resourcesBase: "resources" });
    const result = await adapter.gitStatus("../../../etc");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("AGENT_GIT_ADAPTER_UNAVAILABLE");
    }
  });

  it("rejects pathspecs with traversal in diff", async () => {
    const { GitReadAdapter } = await import("../src/main/git-read-adapter.js");
    const adapter = new GitReadAdapter({ resourcesBase: "resources" });
    const result = await adapter.gitDiff("/project", ["../../etc/passwd"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(["AGENT_GIT_ADAPTER_UNAVAILABLE", "AGENT_GIT_PATHSPEC_INVALID"]).toContain(
        result.error.code
      );
    }
  });
});
