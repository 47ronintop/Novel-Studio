import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

const root = process.cwd();

describe("release-check script", () => {
  test("passes the non-strict metadata check and reports the current Blocked status", async () => {
    const result = await runReleaseCheck([]);

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Release readiness metadata check passed.");
    expect(result.output).toContain("Stage 5 is Blocked");
  });

  test("strict mode accepts an explicit package directory but fails closed while evidence is Blocked", async () => {
    const packageDirectory = await mkdtemp(join(tmpdir(), "release-check-package-"));
    try {
      const result = await runReleaseCheck(["--strict", "--package-dir", packageDirectory]);

      expect(result.exitCode).toBe(1);
      expect(result.output).toContain(
        "Strict release gate cannot pass while Stage 5 overall status is Blocked."
      );
      expect(result.output).toContain(
        "Strict release gate package is missing a valid Electron executable."
      );
    } finally {
      await rm(packageDirectory, { recursive: true, force: true });
    }
  });

  test("rejects an explicit package directory outside strict mode", async () => {
    const result = await runReleaseCheck(["--package-dir", "release/example"]);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("--package-dir is only valid with --strict.");
  });

  test("requires an explicit package directory in strict mode", async () => {
    const result = await runReleaseCheck(["--strict"]);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("--strict requires an explicit --package-dir.");
  });
});

function runReleaseCheck(
  args: readonly string[]
): Promise<{ readonly exitCode: number | null; readonly output: string }> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, ["scripts/release-check.mjs", ...args], {
      cwd: root,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("close", (exitCode) => resolveRun({ exitCode, output }));
  });
}
