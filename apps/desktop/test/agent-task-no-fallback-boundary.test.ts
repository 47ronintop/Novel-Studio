import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("task and Git no-fallback boundary", () => {
  it("keeps Git execution out of the TypeScript adapter", async () => {
    const source = await readFile(
      join(process.cwd(), "apps/desktop/src/main/git-read-adapter.ts"),
      "utf8"
    );
    expect(source).not.toContain("node:child_process");
    expect(source).toContain("executeGitRead");
    expect(source).toContain("qualified native read-only sandbox profile");
  });

  it("only allows the native host module to spawn a task-related process", async () => {
    const source = await readFile(
      join(process.cwd(), "apps/desktop/src/main/agent-task-sandbox.ts"),
      "utf8"
    );
    expect(source).toContain("this.hostBinaryPath");
    expect(source).toContain("startNativeHost");
    expect(source).not.toContain("spawn(input.executablePath");
    expect(source).not.toContain("spawn(input.workspaceProjection");
  });
});
