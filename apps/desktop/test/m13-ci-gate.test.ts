import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

const runtimePackages = [
  "packages/application/package.json",
  "packages/repository/package.json",
  "packages/shared/package.json",
  "packages/ui/package.json",
  "packages/schemas/package.json",
  "packages/llm-adapter/package.json",
  "packages/workflow-engine/package.json",
  "packages/context-engine/package.json",
  "packages/agent-engine/package.json",
  "packages/plugin-engine/package.json"
] as const;

describe("M13 real E2E and CI gate", () => {
  test("runs real Playwright E2E instead of listing zero tests", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      readonly scripts: Record<string, string>;
    };
    const playwrightConfig = await readFile("playwright.config.ts", "utf8");
    const packagedPlaywrightConfig = await readFile("playwright.packaged.config.ts", "utf8");

    expect(packageJson.scripts["test:e2e"]).toBe(
      "npm run build && playwright test --config=playwright.config.ts"
    );
    expect(packageJson.scripts["test:e2e:built"]).toBe(
      "playwright test --config=playwright.config.ts"
    );
    expect(packageJson.scripts["test:e2e:packaged"]).toBe(
      "playwright test --config=playwright.packaged.config.ts"
    );
    expect(packageJson.scripts["test:e2e"]).not.toContain("--list");
    expect(playwrightConfig).toContain('testMatch: "**/*.e2e.ts"');
    expect(playwrightConfig).toContain('"**/agent-write.e2e.ts"');
    expect(playwrightConfig).toContain('"**/agent-writing-domain.e2e.ts"');
    expect(playwrightConfig).toContain('"**/agent-creative-general.e2e.ts"');
    expect(packagedPlaywrightConfig).toContain('testDir: "./apps/desktop/test"');
    expect(packagedPlaywrightConfig).toMatch(
      /testMatch:\s*\[[\s\S]*"agent-write\.e2e\.ts"[\s\S]*"agent-writing-domain\.e2e\.ts"[\s\S]*"agent-creative-general\.e2e\.ts"[\s\S]*"engineering-file-access-package\.e2e\.ts"[\s\S]*\]/u
    );
    expect(packagedPlaywrightConfig).toContain("workers: 1");
  });

  test("runs each expensive GitHub Actions quality gate once", async () => {
    const workflow = await readFile(".github/workflows/ci.yml", "utf8");
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      readonly scripts: Record<string, string>;
    };

    expect(workflow).toContain("npm ci");
    expect(workflow).toContain("npm run format:changed");
    expect(workflow).toContain("fetch-depth: 0");
    expect(workflow).toContain("FORMAT_BASE_SHA");
    expect(workflow).toContain("npm run lint");
    expect(workflow).toContain("npm run build");
    expect(workflow).toContain("npm run test");
    expect(workflow).toContain("npm run test:e2e:built");
    expect(workflow).toContain("npm run package:verify");
    expect(workflow).toContain("npm run release:check");
    expect(workflow).toContain("npm run alpha:verify");
    expect(workflow).toContain("npm run package:dir:built");
    expect(workflow).toContain("npm audit");
    expect(workflow).toContain("--omit=dev --audit-level=high");
    expect(workflow).not.toMatch(
      /rust-toolchain|cargo(?:-deny)?|agent-sandbox|agent-file-operations/u
    );
    expect(workflow).not.toContain("NOVEL_STUDIO_AGENT_SANDBOX_DIR");
    expect(workflow).not.toContain("NOVEL_STUDIO_AGENT_FILE_OPERATIONS_DIR");
    expect(workflow).not.toContain("--release --package-dir");
    expect(packageJson.scripts["format:changed"]).toBe("node scripts/format-changed.mjs");
    expect(packageJson.scripts["format:full-debt"]).toBe("prettier --check .");
    expect(workflow).not.toMatch(
      /^\s*run: npm run (?:typecheck|test:contract|test:e2e|package:check|alpha:check|package:dir|package:artifact-check)\s*$/mu
    );
  });

  test("points runtime package exports at dist artifacts for Electron", async () => {
    for (const packagePath of runtimePackages) {
      const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as {
        readonly exports: {
          readonly ".": {
            readonly default: string;
          };
        };
      };

      expect(packageJson.exports["."].default, packagePath).toContain("./dist/");
      expect(packageJson.exports["."].default, packagePath).not.toContain("./src/");
    }
  });
});
