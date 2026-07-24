import { describe, it, expect } from "vitest";

/**
 * Verifies that node:child_process is NOT imported in task execution paths
 * other than agent-task-sandbox.ts (the designated launcher).
 */
describe("No child_process fallback boundary", () => {
  it("agent-run-session does not import node:child_process", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");

    const sessionPath = path.resolve("packages/application/src/agent-run-session.ts");
    let source: string;
    try {
      source = await fs.readFile(sessionPath, "utf8");
    } catch {
      return; // Skip if file not found
    }

    expect(source).not.toContain("node:child_process");
    expect(source).not.toContain("require('child_process')");
    expect(source).not.toContain(`require("child_process")`);
  });

  it("agent-run-coordinator does not import node:child_process", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");

    const coordinatorPath = path.resolve(
      "packages/agent-engine/src/agent-run-coordinator.ts"
    );
    let source: string;
    try {
      source = await fs.readFile(coordinatorPath, "utf8");
    } catch {
      return;
    }

    expect(source).not.toContain("node:child_process");
    expect(source).not.toContain("require('child_process')");
  });

  it("agent-task-sandbox.ts is the designated launcher that imports node:child_process", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");

    const sandboxPath = path.resolve("apps/desktop/src/main/agent-task-sandbox.ts");
    let sandboxSource: string;
    try {
      sandboxSource = await fs.readFile(sandboxPath, "utf8");
    } catch {
      return;
    }

    expect(sandboxSource).toContain("node:child_process");
  });
});
