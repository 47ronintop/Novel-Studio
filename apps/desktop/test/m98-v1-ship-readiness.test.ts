import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

describe("M98 V1 ship readiness", () => {
  test("records the v1 ship decision, evidence, limits, and reading aloud scope", async () => {
    const document = await readFile("docs/releases/m98-v1-ship-readiness.md", "utf8");

    expect(document).toContain("V1 ship decision: CONDITIONAL HOLD");
    expect(document).toContain("Core writing journey evidence");
    expect(document).toContain("npm run test:e2e");
    expect(document).toContain("npm run release:check");
    expect(document).toContain("live provider manual verification pending");
    expect(document).toContain("V2/backlog deferred scope");
    expect(document).toContain("Reading aloud decision: GO for v1.1 backlog, NO for v1 blocker.");
    expect(document).toContain("No M99/M100 is authorized unless M98 finds a v1 blocker.");
    expect(document).toContain("Edge TTS behind an explicit experimental provider switch.");
    expect(document).toContain("Manual Provider Verification Required");
  });

  test("release check validates M98 readiness without publishing", () => {
    const result = spawnSync("npm run release:check", {
      cwd: process.cwd(),
      encoding: "utf8",
      shell: true
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("V1 conditional ship readiness gate recorded");
    expect(result.stdout).not.toMatch(/push|upload|publish/i);
  });
});
