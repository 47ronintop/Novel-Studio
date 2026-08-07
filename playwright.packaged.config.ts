import { defineConfig } from "@playwright/test";

/**
 * These tests drive a qualified signed package through Windows UI Automation. They cannot run in
 * the regular source-built Electron smoke suite because that suite has no signed package input.
 */
export default defineConfig({
  testDir: "./apps/desktop/test",
  testMatch: ["agent-write.e2e.ts", "agent-writing-domain.e2e.ts"],
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    trace: "on-first-retry"
  }
});
