import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "vitest";

describe("M9 alpha checklist", () => {
  test("exposes build and alpha check scripts", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      readonly scripts: Record<string, string>;
    };

    expect(packageJson.scripts.build).toBe("npm run build:types && npm run build:renderer");
    expect(packageJson.scripts["build:types"]).toBe("tsc -b");
    expect(packageJson.scripts["build:renderer"]).toBe(
      "vite build --config apps/desktop/vite.config.ts"
    );
    expect(packageJson.scripts["alpha:check"]).toBe(
      "npm run build && node scripts/alpha-check.mjs"
    );
  });

  test("passes the local alpha check gate", () => {
    const result = spawnSync("npm run alpha:check", {
      cwd: process.cwd(),
      encoding: "utf8",
      shell: true
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("Alpha check passed");
  }, 30000);
});
