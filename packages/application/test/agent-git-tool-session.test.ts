import { describe, it, expect, vi } from "vitest";
import { createAgentGitToolSession } from "../src/agent-git-tool-session.js";
import { ok, err, createUnifiedError } from "@novel-studio/shared";
import { resolve } from "node:path";

const ROOT = resolve("D:/projects/workspace");

function makeGitAdapter(overrides = {}) {
  return {
    gitStatus: vi.fn().mockResolvedValue(
      ok({ staged: ["src/a.ts"], unstaged: [], untracked: ["tmp.txt"], branch: "main" })
    ),
    gitDiff: vi.fn().mockResolvedValue(
      ok({
        diffs: [{ relativePath: "src/a.ts", diff: "diff --git a/src/a.ts b/src/a.ts\n+added" }],
        truncated: false
      })
    ),
    ...overrides
  };
}

describe("AgentGitToolSession", () => {
  it("returns git_status wrapped in untrusted_project_data", async () => {
    const adapter = makeGitAdapter();
    const session = createAgentGitToolSession({ gitAdapter: adapter, projectRoot: ROOT });
    const result = await session.gitStatus(ROOT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe("untrusted_project_data");
      expect(result.value.branch).toBe("main");
      expect(result.value.staged).toContain("src/a.ts");
    }
  });

  it("returns git_diff wrapped in untrusted_project_data", async () => {
    const adapter = makeGitAdapter();
    const session = createAgentGitToolSession({ gitAdapter: adapter, projectRoot: ROOT });
    const result = await session.gitDiff(ROOT, ["src/a.ts"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe("untrusted_project_data");
      expect(result.value.diffs).toHaveLength(1);
      expect(result.value.truncated).toBe(false);
    }
  });

  it("propagates adapter errors from gitStatus", async () => {
    const adapter = makeGitAdapter({
      gitStatus: vi.fn().mockResolvedValue(
        err(
          createUnifiedError({
            code: "AGENT_GIT_ADAPTER_UNAVAILABLE",
            category: "ValidationError",
            message: "Git unavailable",
            recoverability: "user-action",
            suggestedAction: "Fix it",
            traceId: "test"
          })
        )
      )
    });
    const session = createAgentGitToolSession({ gitAdapter: adapter, projectRoot: ROOT });
    const result = await session.gitStatus(ROOT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AGENT_GIT_ADAPTER_UNAVAILABLE");
  });

  it("rejects pathspec with traversal in gitDiff", async () => {
    const adapter = makeGitAdapter();
    const session = createAgentGitToolSession({ gitAdapter: adapter, projectRoot: ROOT });
    const result = await session.gitDiff(ROOT, ["../../../etc/passwd"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AGENT_GIT_PATHSPEC_INVALID");
  });

  it("rejects pathspec with pathspec magic", async () => {
    const adapter = makeGitAdapter();
    const session = createAgentGitToolSession({ gitAdapter: adapter, projectRoot: ROOT });
    const result = await session.gitDiff(ROOT, [":!excluded.ts"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AGENT_GIT_PATHSPEC_INVALID");
  });
});
