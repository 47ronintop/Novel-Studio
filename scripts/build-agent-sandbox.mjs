#!/usr/bin/env node
/**
 * Build the Windows-only sandbox workspace and stage the exact binaries that
 * electron-builder should consume. Staging never grants release qualification:
 * only an independently verified attestation may change that state.
 */
import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const root = process.cwd();
const workspace = resolve(root, "apps", "desktop", "native", "agent-task-sandbox");
const target = "x86_64-pc-windows-msvc";
const outputDirectory = parseOutputDirectory(process.argv.slice(2));
const binaries = [
  { kind: "host", name: "agent-task-sandbox-host.exe" },
  { kind: "probe", name: "agent-task-sandbox-probe.exe" }
];

await run("cargo", [
  "build",
  "--locked",
  "--release",
  "--target",
  target,
  "--manifest-path",
  join(workspace, "Cargo.toml")
]);

await mkdir(outputDirectory, { recursive: true });
const artifacts = [];
for (const binary of binaries) {
  const source = join(workspace, "target", target, "release", binary.name);
  const destination = join(outputDirectory, binary.name);
  const bytes = await readFile(source);
  assertPortableExecutable(bytes, source);
  await copyFile(source, destination);
  artifacts.push({
    kind: binary.kind,
    path: `native/agent-task-sandbox/${binary.name}`,
    digest: sha256(bytes)
  });
}

const manifest = {
  schemaVersion: "1.0",
  // A build and a CI probe are not a trusted external release attestation.
  status: "unavailable",
  protocolVersion: "1.0",
  policyRevision: "v1.0-windows-appcontainer",
  testVectorRevision: "tv-2026-07-23",
  artifacts
};
await writeFile(join(outputDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(
  join(outputDirectory, "build-summary.json"),
  `${JSON.stringify({ schemaVersion: "1.0", target, artifacts }, null, 2)}\n`
);

console.log(
  `Staged locked sandbox binaries in ${outputDirectory}. Release status remains unavailable.`
);

function parseOutputDirectory(args) {
  if (args.length === 0) return resolve(root, "release", "agent-task-sandbox");
  if (args.length === 2 && args[0] === "--output-dir" && args[1]) return resolve(args[1]);
  throw new Error("Usage: node scripts/build-agent-sandbox.mjs [--output-dir <directory>]");
}

function assertPortableExecutable(bytes, path) {
  if (
    bytes.length < 0x40 ||
    bytes[0] !== 0x4d ||
    bytes[1] !== 0x5a ||
    bytes.readUInt32LE(0x3c) + 4 > bytes.length ||
    !bytes
      .subarray(bytes.readUInt32LE(0x3c), bytes.readUInt32LE(0x3c) + 4)
      .equals(Buffer.from("PE\0\0"))
  ) {
    throw new Error(`Cargo output is not a Windows PE executable: ${path}`);
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: root, shell: false, stdio: "inherit" });
    child.once("error", (error) => reject(new Error(`${command} is required: ${error.message}`)));
    child.once("exit", (code) => {
      if (code === 0) resolveRun();
      else reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`));
    });
  });
}
