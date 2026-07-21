import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "vitest";

import { withBuildGateLock } from "./build-gate-lock";

const packageCheckTimeoutMs = 240_000;

describe("M10 beta packaging", () => {
  test("electron-builder config restricts Chromium locale packs to zh-CN and en-US", () => {
    const config = readFileSync(
      join(process.cwd(), "apps", "desktop", "electron-builder.config.cjs"),
      "utf8"
    );
    // Must declare electronLanguages limiting locale .pak files to two supported locales.
    // Absence of this restriction means every Chromium locale pak is bundled (~400 MB extra).
    expect(config).toContain("electronLanguages");
    expect(config).toContain("zh-CN");
    expect(config).toContain("en-US");
    // Must not include an open-ended wildcard alongside the restricted list.
    expect(config).not.toMatch(/electronLanguages[^;]*\*/);
  });

  test("declares renderer bundling and installer-grade packaging scripts", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      readonly scripts: Record<string, string>;
      readonly devDependencies: Record<string, string>;
    };

    expect(packageJson.scripts["build:types"]).toBe("tsc -b");
    expect(packageJson.scripts["build:renderer"]).toBe(
      "vite build --config apps/desktop/vite.config.ts"
    );
    expect(packageJson.scripts.build).toBe(
      "npm run build:types && npm run build:renderer && node scripts/write-build-manifest.mjs"
    );
    expect(packageJson.scripts["package:check"]).toBe(
      "npm run build && node scripts/package-check.mjs"
    );
    expect(packageJson.scripts["package:dir"]).toBe("node scripts/package-dir.mjs");
    expect(packageJson.scripts["package:artifact-check"]).toBe(
      "node scripts/artifact-secret-scan.mjs"
    );
    expect(packageJson.devDependencies.vite).toBeDefined();
    expect(packageJson.devDependencies["electron-builder"]).toBeDefined();
  });

  test("build emits a bundled renderer entrypoint loaded by Electron main", async () => {
    const result = await withBuildGateLock(() => {
      return spawnSync("npm run build", {
        cwd: process.cwd(),
        encoding: "utf8",
        shell: true
      });
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
  }, 90000);

  test("package check validates Electron packaging configuration and build artifacts", async () => {
    const result = await withBuildGateLock(() => {
      return spawnSync("npm run package:check", {
        cwd: process.cwd(),
        encoding: "utf8",
        shell: true
      });
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("Package check passed");
    expect(existsSync(join(process.cwd(), "apps", "desktop", "electron-builder.config.cjs"))).toBe(
      true
    );
  }, packageCheckTimeoutMs);

  test("keeps the build gate lock alive beyond the package check timeout", () => {
    const lockSource = readFileSync(
      join(process.cwd(), "apps", "desktop", "test", "build-gate-lock.ts"),
      "utf8"
    );
    const staleLockMatch = /const staleLockMs = ([\d_]+);/.exec(lockSource);
    expect(staleLockMatch).not.toBeNull();
    const staleLockMs = Number(staleLockMatch?.[1]?.replaceAll("_", ""));

    expect(staleLockMs).toBeGreaterThan(packageCheckTimeoutMs);
  });
});
