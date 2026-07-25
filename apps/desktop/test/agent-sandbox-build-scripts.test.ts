import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("agent sandbox Windows CI scripts", () => {
  it("rejects unsupported staging arguments before invoking Cargo", async () => {
    const result = await runScript("scripts/build-agent-sandbox.mjs", ["--unsupported"]);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("Usage: node scripts/build-agent-sandbox.mjs");
  });

  it("fails qualification before starting native code when its staged manifest is absent", async () => {
    const bundleDirectory = await mkdtemp(join(tmpdir(), "sandbox-qualification-missing-"));
    try {
      const result = await runScript("scripts/qualify-agent-sandbox.mjs", [
        "--bundle-dir",
        bundleDirectory
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("Sandbox staging manifest is missing or malformed");
    } finally {
      await rm(bundleDirectory, { recursive: true, force: true });
    }
  });

  it("rejects a staging manifest that claims qualification", async () => {
    const bundleDirectory = await mkdtemp(join(tmpdir(), "sandbox-qualification-forged-"));
    try {
      await writeFile(
        join(bundleDirectory, "manifest.json"),
        JSON.stringify({
          schemaVersion: "1.0",
          status: "qualified",
          protocolVersion: "1.0",
          policyRevision: "v1.0-windows-appcontainer",
          testVectorRevision: "tv-2026-07-23",
          artifacts: []
        })
      );

      const result = await runScript("scripts/qualify-agent-sandbox.mjs", [
        "--bundle-dir",
        bundleDirectory
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("not a fail-closed build manifest");
    } finally {
      await rm(bundleDirectory, { recursive: true, force: true });
    }
  });

  it("rejects a Git runtime output outside the dedicated temporary root", async () => {
    const result = await runScript("scripts/prepare-git-runtime.mjs", [
      "--archive",
      "missing.zip",
      "--output",
      "apps/desktop/resources/git/runtime"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("Git runtime output must stay below .tmp-agent-tool");
  });

  it("rejects a forged qualified file-operation staging manifest", async () => {
    const bundleDirectory = await mkdtemp(join(tmpdir(), "file-operations-qualification-forged-"));
    try {
      await writeFile(
        join(bundleDirectory, "manifest.json"),
        JSON.stringify({
          schemaVersion: "1.0",
          status: "qualified",
          protocolVersion: "1.1",
          artifact: {
            path: "native/agent-file-operations/agent-file-operations-host.exe",
            digest: "a".repeat(64)
          }
        })
      );

      const result = await runScript("scripts/qualify-agent-file-operations.mjs", [
        "--bundle-dir",
        bundleDirectory
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("not a fail-closed digest binding");
    } finally {
      await rm(bundleDirectory, { recursive: true, force: true });
    }
  });
});

function runScript(
  script: string,
  args: readonly string[]
): Promise<{ exitCode: number | null; output: string }> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
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
