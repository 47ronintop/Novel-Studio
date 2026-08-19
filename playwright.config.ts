import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./apps",
  testMatch: "**/*.e2e.ts",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 2 : 0,
  fullyParallel: false,
  workers: 1,
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
