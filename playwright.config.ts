import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./apps",
  testMatch: "**/*.e2e.ts",
  testIgnore: [
    "**/agent-write.e2e.ts",
    "**/agent-writing-domain.e2e.ts",
    "**/agent-creative-general.e2e.ts"
  ],
  reporter: "list",
  use: {
    trace: "on-first-retry"
  }
});
