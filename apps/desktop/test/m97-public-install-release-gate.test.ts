import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

describe("M97 public install release gate", () => {
  test("documents the public Windows install signing and verification gate", async () => {
    const document = await readFile("docs/packaging/m97-public-install-release-gate.md", "utf8");

    expect(document).toContain("Windows public install gate");
    expect(document).toContain("signing.required=true");
    expect(document).toContain("npm run test:e2e");
    expect(document).toContain("npm run package:artifact-check");
    expect(document).toContain(
      "No macOS notarization is required unless macOS artifacts enter v1."
    );
  });

  test("release check validates the public install gate without publishing", () => {
    const result = spawnSync("npm run release:check", {
      cwd: process.cwd(),
      encoding: "utf8",
      shell: true
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("Public install release gate passed");
    expect(result.stdout).not.toMatch(/push|upload|publish/i);
  });
});
