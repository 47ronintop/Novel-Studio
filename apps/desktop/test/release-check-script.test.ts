import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPackage } from "@electron/asar";
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

  test("recognizes a valid PE and ASAR metadata before applying signing and evidence gates", async () => {
    const packageDirectory = await mkdtemp(join(tmpdir(), "release-check-valid-layout-"));
    const sourceDirectory = await mkdtemp(join(tmpdir(), "release-check-asar-source-"));
    try {
      const resourcesDirectory = join(packageDirectory, "resources");
      await mkdir(resourcesDirectory, { recursive: true });
      await writeFile(join(packageDirectory, "Novel Studio.exe"), minimalPortableExecutable());
      await writeFile(
        join(sourceDirectory, "package.json"),
        JSON.stringify({ main: "apps/desktop/dist/main/index.js" })
      );
      await createPackage(sourceDirectory, join(resourcesDirectory, "app.asar"));

      const result = await runReleaseCheck(["--strict", "--package-dir", packageDirectory]);

      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("requires a valid Windows Authenticode signature");
      expect(result.output).not.toContain("missing a valid Electron executable");
      expect(result.output).not.toContain("missing expected package metadata");
    } finally {
      await rm(packageDirectory, { recursive: true, force: true });
      await rm(sourceDirectory, { recursive: true, force: true });
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

function minimalPortableExecutable(): Buffer {
  const bytes = Buffer.alloc(0x80);
  bytes[0] = 0x4d;
  bytes[1] = 0x5a;
  bytes.writeUInt32LE(0x40, 0x3c);
  bytes.set([0x50, 0x45, 0x00, 0x00], 0x40);
  return bytes;
}
