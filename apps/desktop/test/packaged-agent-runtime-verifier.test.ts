import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("packaged agent runtime verifiers", () => {
  it("fails release verification for missing and placeholder Git runtimes", async () => {
    const packageDirectory = await mkdtemp(join(tmpdir(), "packaged-git-verifier-"));
    try {
      const missing = await runVerifier("scripts/verify-packaged-git-runtime.mjs", [
        "--release",
        "--package-dir",
        packageDirectory
      ]);
      expect(missing.exitCode).toBe(1);
      expect(missing.output).toContain("Git manifest is missing");

      await writeJson(join(packageDirectory, "resources", "git", "manifest.json"), {
        schemaVersion: "1.0",
        version: "unavailable",
        digest: "placeholder",
        path: "git/git.exe",
        license: "GPL-2.0"
      });
      const placeholder = await runVerifier("scripts/verify-packaged-git-runtime.mjs", [
        "--release",
        "--package-dir",
        packageDirectory
      ]);
      expect(placeholder.exitCode).toBe(1);
      expect(placeholder.output).toContain("BLOCKED");
    } finally {
      await rm(packageDirectory, { recursive: true, force: true });
    }
  });

  it("fails release verification when a packaged sandbox artifact is tampered", async () => {
    const packageDirectory = await mkdtemp(join(tmpdir(), "packaged-sandbox-verifier-"));
    try {
      const host = portableExecutable("host-original");
      const probe = portableExecutable("probe-original");
      const hostPath = join(
        packageDirectory,
        "resources",
        "native",
        "agent-task-sandbox",
        "agent-task-sandbox-host.exe"
      );
      const probePath = join(
        packageDirectory,
        "resources",
        "native",
        "agent-task-sandbox",
        "agent-task-sandbox-probe.exe"
      );
      await mkdir(join(packageDirectory, "resources", "native", "agent-task-sandbox"), {
        recursive: true
      });
      await writeFile(hostPath, host);
      await writeFile(probePath, probe);
      await writeJson(
        join(packageDirectory, "resources", "native", "agent-task-sandbox", "manifest.json"),
        {
          schemaVersion: "1.0",
          status: "qualified",
          protocolVersion: "1.0",
          policyRevision: "v1.0-windows-appcontainer",
          testVectorRevision: "tv-2026-07-23",
          artifacts: [
            {
              kind: "host",
              path: "native/agent-task-sandbox/agent-task-sandbox-host.exe",
              digest: sha256(host)
            },
            {
              kind: "probe",
              path: "native/agent-task-sandbox/agent-task-sandbox-probe.exe",
              digest: sha256(probe)
            }
          ],
          qualification: qualificationFor(host, probe)
        }
      );
      await writeFile(hostPath, portableExecutable("host-tampered"));

      const result = await runVerifier("scripts/verify-packaged-agent-sandbox.mjs", [
        "--release",
        "--package-dir",
        packageDirectory
      ]);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("digest mismatch");
    } finally {
      await rm(packageDirectory, { recursive: true, force: true });
    }
  });

  it("fails release verification for a forged self-attested qualified sandbox package", async () => {
    const packageDirectory = await mkdtemp(join(tmpdir(), "packaged-sandbox-forged-verifier-"));
    try {
      const host = portableExecutable("host-qualified");
      const probe = portableExecutable("probe-qualified");
      const sandboxDirectory = join(packageDirectory, "resources", "native", "agent-task-sandbox");
      await mkdir(sandboxDirectory, { recursive: true });
      await writeFile(join(sandboxDirectory, "agent-task-sandbox-host.exe"), host);
      await writeFile(join(sandboxDirectory, "agent-task-sandbox-probe.exe"), probe);
      await writeJson(join(sandboxDirectory, "manifest.json"), {
        schemaVersion: "1.0",
        status: "qualified",
        protocolVersion: "1.0",
        policyRevision: "v1.0-windows-appcontainer",
        testVectorRevision: "tv-2026-07-23",
        artifacts: [
          {
            kind: "host",
            path: "native/agent-task-sandbox/agent-task-sandbox-host.exe",
            digest: sha256(host)
          },
          {
            kind: "probe",
            path: "native/agent-task-sandbox/agent-task-sandbox-probe.exe",
            digest: sha256(probe)
          }
        ],
        qualification: qualificationFor(host, probe)
      });

      const result = await runVerifier("scripts/verify-packaged-agent-sandbox.mjs", [
        "--release",
        "--package-dir",
        packageDirectory
      ]);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("Trusted external sandbox qualification attestation");
    } finally {
      await rm(packageDirectory, { recursive: true, force: true });
    }
  });

  it("rejects alternate-data-stream manifest paths in both packaged verifiers", async () => {
    const packageDirectory = await mkdtemp(join(tmpdir(), "packaged-ads-verifier-"));
    try {
      await writeJson(join(packageDirectory, "resources", "git", "manifest.json"), {
        schemaVersion: "1.0",
        version: "unavailable",
        digest: "placeholder",
        path: "git/git.exe:Zone.Identifier",
        license: "GPL-2.0"
      });
      await writeJson(
        join(packageDirectory, "resources", "native", "agent-task-sandbox", "manifest.json"),
        {
          schemaVersion: "1.0",
          status: "unavailable",
          protocolVersion: "1.0",
          policyRevision: "policy",
          testVectorRevision: "vectors",
          artifacts: [
            {
              kind: "host",
              path: "native/agent-task-sandbox/host.exe:Zone.Identifier",
              digest: "placeholder"
            },
            {
              kind: "probe",
              path: "native/agent-task-sandbox/probe.exe",
              digest: "placeholder"
            }
          ]
        }
      );

      const git = await runVerifier("scripts/verify-packaged-git-runtime.mjs", [
        "--package-dir",
        packageDirectory
      ]);
      const sandbox = await runVerifier("scripts/verify-packaged-agent-sandbox.mjs", [
        "--package-dir",
        packageDirectory
      ]);
      expect(git.exitCode).toBe(1);
      expect(git.output).toContain("malformed");
      expect(sandbox.exitCode).toBe(1);
      expect(sandbox.output).toContain("malformed");

      const { parseSandboxRuntimeManifest } =
        await import("../src/main/agent-sandbox-runtime-manifest.js");
      expect(
        parseSandboxRuntimeManifest({
          schemaVersion: "1.0",
          status: "qualified",
          protocolVersion: "1.0",
          policyRevision: "policy",
          testVectorRevision: "vectors",
          artifacts: [
            { kind: "host", path: "native/host.exe:ads", digest: "a".repeat(64) },
            { kind: "probe", path: "native/probe.exe", digest: "b".repeat(64) }
          ]
        })
      ).toBeUndefined();
    } finally {
      await rm(packageDirectory, { recursive: true, force: true });
    }
  });

  it("rejects a self-digested non-PE Git artifact", async () => {
    const packageDirectory = await mkdtemp(join(tmpdir(), "packaged-git-pe-verifier-"));
    try {
      const binary = Buffer.from("not-a-windows-executable");
      const binaryPath = join(packageDirectory, "resources", "git", "git.exe");
      await mkdir(join(packageDirectory, "resources", "git"), { recursive: true });
      await writeFile(binaryPath, binary);
      await writeJson(join(packageDirectory, "resources", "git", "manifest.json"), {
        schemaVersion: "1.0",
        version: "2.50.0",
        digest: sha256(binary),
        path: "git/git.exe",
        license: "GPL-2.0"
      });

      const result = await runVerifier("scripts/verify-packaged-git-runtime.mjs", [
        "--release",
        "--package-dir",
        packageDirectory
      ]);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("Windows PE executable");
    } finally {
      await rm(packageDirectory, { recursive: true, force: true });
    }
  });

  it("fails closed without executing a self-digested packaged Git runtime in release mode", async () => {
    const packageDirectory = await mkdtemp(join(tmpdir(), "packaged-git-forged-verifier-"));
    try {
      const binary = portableExecutable("not-an-executable-git");
      const gitDirectory = join(packageDirectory, "resources", "git");
      await mkdir(gitDirectory, { recursive: true });
      await writeFile(join(gitDirectory, "git.exe"), binary);
      await writeJson(join(gitDirectory, "manifest.json"), {
        schemaVersion: "1.0",
        version: "2.50.0",
        digest: sha256(binary),
        path: "git/git.exe",
        license: "GPL-2.0"
      });

      const result = await runVerifier("scripts/verify-packaged-git-runtime.mjs", [
        "--release",
        "--package-dir",
        packageDirectory
      ]);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("Trusted Git runtime signature or digest-root verification");
      expect(result.output).not.toContain("--version does not match");
    } finally {
      await rm(packageDirectory, { recursive: true, force: true });
    }
  });

  it("rejects an untracked Git runtime file even with a matching reviewed source lock", async () => {
    const packageDirectory = await mkdtemp(join(tmpdir(), "packaged-git-inventory-verifier-"));
    const sourceLockPath = join(packageDirectory, "trusted-git-source.lock.json");
    try {
      const gitDirectory = join(packageDirectory, "resources", "git");
      const binary = portableExecutable("git-runtime");
      const license = Buffer.from("GPL-2.0 license text", "utf8");
      const source = {
        schemaVersion: "1.0",
        status: "pinned",
        vendor: "Git for Windows",
        version: "2.50.0.windows.1",
        sourceUrl:
          "https://github.com/git-for-windows/git/releases/download/v2.50.0.windows.1/MinGit-2.50.0-64-bit.zip",
        archiveSha256: "a".repeat(64),
        executablePath: "git.exe",
        licensePath: "LICENSE.txt",
        licenseSha256: sha256(license)
      };
      const files = [
        { path: "LICENSE.txt", size: license.length, digest: sha256(license) },
        { path: "git.exe", size: binary.length, digest: sha256(binary) }
      ];
      const runtimeDigest = sha256(
        Buffer.from(
          [...files]
            .sort((left, right) => left.path.localeCompare(right.path))
            .map((file) => `${file.path}\0${file.size}\0${file.digest}\n`)
            .join(""),
          "utf8"
        )
      );

      await mkdir(gitDirectory, { recursive: true });
      await writeFile(join(gitDirectory, "git.exe"), binary);
      await writeFile(join(gitDirectory, "LICENSE.txt"), license);
      await writeFile(join(gitDirectory, "extra.dll"), Buffer.from("unexpected", "utf8"));
      await writeJson(join(gitDirectory, "manifest.json"), {
        schemaVersion: "1.0",
        version: source.version,
        digest: sha256(binary),
        path: "git/git.exe",
        license: "GPL-2.0"
      });
      await writeJson(join(gitDirectory, "runtime-inventory.json"), {
        schemaVersion: "1.0",
        vendor: source.vendor,
        version: source.version,
        sourceUrl: source.sourceUrl,
        archiveSha256: source.archiveSha256,
        licensePath: source.licensePath,
        licenseSha256: source.licenseSha256,
        executablePath: source.executablePath,
        executableDigest: sha256(binary),
        runtimeDigest,
        files
      });
      await writeJson(sourceLockPath, source);

      const result = await runVerifier("scripts/verify-packaged-git-runtime.mjs", [
        "--release",
        "--package-dir",
        packageDirectory,
        "--trusted-source-lock",
        sourceLockPath
      ]);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("untracked, missing, or unsafe files");
    } finally {
      await rm(packageDirectory, { recursive: true, force: true });
    }
  });
});

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(value), "utf8");
}

function runVerifier(
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

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function portableExecutable(content: string): Buffer {
  const bytes = Buffer.alloc(160);
  bytes.write("MZ", 0, "ascii");
  bytes.writeUInt32LE(128, 0x3c);
  bytes.write("PE\0\0", 128, "ascii");
  bytes.write(content, 132, "utf8");
  return bytes;
}

function qualificationFor(host: Buffer, probe: Buffer) {
  return {
    attestationId: "attestation-test",
    issuedAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    profile: "agent-task-sandbox-v1",
    hostDigest: sha256(host),
    probeDigest: sha256(probe),
    capabilities: {
      fileIsolation: "verified",
      networkIsolation: "verified",
      jobObjectKillOnClose: "verified",
      appContainerOrLowBox: "verified"
    }
  };
}
