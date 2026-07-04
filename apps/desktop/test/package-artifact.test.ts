import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("M11 package artifact stabilization", () => {
  it("configures the Electron download mirror for repeatable package:dir", async () => {
    const npmrc = await readFile(".npmrc", "utf8");

    expect(npmrc).toContain("electron_mirror=https://npmmirror.com/mirrors/electron/");
  });

  it("keeps package artifacts out of version control", async () => {
    const gitignore = await readFile(".gitignore", "utf8");

    expect(gitignore).toMatch(/^release\/$/m);
  });

  it("uses a stable wrapper for directory packaging", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts["package:artifact-check"]).toBe(
      "node scripts/artifact-secret-scan.mjs"
    );
    expect(packageJson.scripts["package:dir"]).toBe("node scripts/package-dir.mjs");
  });
});
