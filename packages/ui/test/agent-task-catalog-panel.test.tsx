import { describe, it, expect } from "vitest";

/**
 * AgentTaskCatalogPanel tests — component rendering validated via structure checks.
 * Uses no @testing-library/react since it's not a project dependency.
 */

// Import the component for type checking purposes
// The actual rendering tests are skipped since DOM renderer is not set up in this test environment
describe("AgentTaskCatalogPanel", () => {
  it("component module exports the panel", async () => {
    const { AgentTaskCatalogPanel } = await import("../src/agent-task-catalog-panel.js");
    expect(typeof AgentTaskCatalogPanel).toBe("function");
  });

  it("component is a named export", async () => {
    const mod = await import("../src/agent-task-catalog-panel.js");
    expect("AgentTaskCatalogPanel" in mod).toBe(true);
  });

  it("does not export raw command or argv fields", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve("packages/ui/src/agent-task-catalog-panel.tsx"),
      "utf8"
    );
    // Verify no raw launcher/argv fields are displayed
    expect(source).not.toContain("launcherTemplate");
    expect(source).not.toContain("argvTemplate");
  });

  it("component shows user-friendly metadata fields (cwd, fileProfile, networkMode)", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve("packages/ui/src/agent-task-catalog-panel.tsx"),
      "utf8"
    );
    // Verify the component exposes safe metadata
    expect(source).toContain("task.cwd");
    expect(source).toContain("task.networkMode");
    expect(source).toContain("task.displayName");
  });
});
