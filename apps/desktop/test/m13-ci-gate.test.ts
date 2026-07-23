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

    expect(packageJson.scripts["test:e2e"]).toBe("npm run build && playwright test");
    expect(packageJson.scripts["test:e2e:built"]).toBe("playwright test");
    expect(packageJson.scripts["test:e2e"]).not.toContain("--list");
    expect(playwrightConfig).toContain('testMatch: "**/*.e2e.ts"');
  });

  test("runs each expensive GitHub Actions quality gate once", async () => {
    const workflow = await readFile(".github/workflows/ci.yml", "utf8");

    expect(workflow).toContain("npm ci");
    expect(workflow).toContain("npm run format");
    expect(workflow).toContain("npm run lint");
    expect(workflow).toContain("npm run build");
    expect(workflow).toContain("npm run test");
    expect(workflow).toContain("npm run test:e2e:built");
    expect(workflow).toContain("npm run package:verify");
    expect(workflow).toContain("npm run release:check");
    expect(workflow).toContain("npm run alpha:verify");
    expect(workflow).toContain("npm run package:dir:built");
    expect(workflow).toContain("npm audit");
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
