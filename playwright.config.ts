import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./apps",
  testMatch: "**/*.e2e.ts",
  reporter: "list",
  use: {
    trace: "on-first-retry"
  }
});
