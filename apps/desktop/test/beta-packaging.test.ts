import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "vitest";

describe("M10 beta packaging", () => {
  test("declares renderer bundling and installer-grade packaging scripts", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      readonly scripts: Record<string, string>;
      readonly devDependencies: Record<string, string>;
    };

    expect(packageJson.scripts["build:types"]).toBe("tsc -b");
    expect(packageJson.scripts["build:renderer"]).toBe(
      "vite build --config apps/desktop/vite.config.ts"
    );
    expect(packageJson.scripts.build).toBe("npm run build:types && npm run build:renderer");
    expect(packageJson.scripts["package:check"]).toBe(
      "npm run build && node scripts/package-check.mjs"
    );
    expect(packageJson.scripts["package:dir"]).toBe(
      "npm run build && electron-builder --dir --config apps/desktop/electron-builder.config.cjs"
    );
    expect(packageJson.devDependencies.vite).toBeDefined();
    expect(packageJson.devDependencies["electron-builder"]).toBeDefined();
  });

  test("build emits a bundled renderer entrypoint loaded by Electron main", () => {
    const result = spawnSync("npm run build", {
      cwd: process.cwd(),
      encoding: "utf8",
      shell: true
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);

    const htmlPath = join(process.cwd(), "apps", "desktop", "dist", "renderer", "index.html");
    const html = readFileSync(htmlPath, "utf8");
    const main = readFileSync(
      join(process.cwd(), "apps", "desktop", "dist", "main", "index.js"),
      "utf8"
    );

    expect(html).toContain("<script");
    expect(html).toMatch(/assets\/index-[A-Za-z0-9_-]+\.js/);
    expect(html).toContain("assets/index-");
    expect(main).toContain('"..", "renderer", "index.html"');
  }, 30000);

  test("package check validates Electron packaging configuration and build artifacts", () => {
    const result = spawnSync("npm run package:check", {
      cwd: process.cwd(),
      encoding: "utf8",
      shell: true
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("Package check passed");
    expect(existsSync(join(process.cwd(), "apps", "desktop", "electron-builder.config.cjs"))).toBe(
      true
    );
  }, 30000);
});
