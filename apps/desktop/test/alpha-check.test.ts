import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("M9 alpha checklist", () => {
  test("exposes build and alpha check scripts", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      readonly scripts: Record<string, string>;
    };

    expect(packageJson.scripts.build).toBe(
      "npm run build:types && npm run build:renderer && node scripts/write-build-manifest.mjs"
    );
    expect(packageJson.scripts["build:types"]).toBe("tsc -b");
    expect(packageJson.scripts["build:renderer"]).toBe(
      "vite build --config apps/desktop/vite.config.ts"
    );
    expect(packageJson.scripts["alpha:check"]).toBe(
      "npm run build && node scripts/alpha-check.mjs"
    );
    expect(packageJson.scripts["alpha:verify"]).toBe("node scripts/alpha-check.mjs");
    expect(packageJson.scripts["package:verify"]).toBe("node scripts/package-check.mjs");
    expect(packageJson.scripts["package:dir:built"]).toBe(
      "node scripts/package-dir.mjs --skip-build"
    );
  });
});
