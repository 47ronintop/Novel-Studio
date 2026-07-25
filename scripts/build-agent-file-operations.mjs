#!/usr/bin/env node
/**
 * Build and stage the Windows no-follow file lifecycle host.
 *
 * A successful compilation only produces a digest-bound package input. It does
 * not mark the host qualified or enable file lifecycle tools; qualification
 * requires the separate Windows race/reparse test vectors.
 */
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = process.cwd();
const workspace = resolve(root, "apps", "desktop", "native", "agent-task-sandbox");
const protocolVersion = "1.1";
const target = "x86_64-pc-windows-msvc";
const binaryName = "agent-file-operations-host.exe";
const outputDirectory = parseOutputDirectory(process.argv.slice(2));

await run("cargo", [
  "build",
  "--locked",
  "--release",
  "--target",
  target,
  "--package",
  "agent-file-operations-host",
  "--manifest-path",
  join(workspace, "Cargo.toml")
]);

const source = join(workspace, "target", target, "release", binaryName);
const bytes = await readFile(source);
assertPortableExecutable(bytes, source);
await mkdir(outputDirectory, { recursive: true });
await copyFile(source, join(outputDirectory, binaryName));

const artifact = {
  path: `native/agent-file-operations/${binaryName}`,
  digest: createHash("sha256").update(bytes).digest("hex")
};
await writeFile(
  join(outputDirectory, "manifest.json"),
  `${JSON.stringify(
    {
      schemaVersion: "1.0",
      status: "unavailable",
      protocolVersion,
      artifact
    },
    null,
    2
  )}\n`
);
await writeFile(
  join(outputDirectory, "build-summary.json"),
  `${JSON.stringify({ schemaVersion: "1.0", protocolVersion, target, artifact }, null, 2)}\n`
);

console.log(
  `Staged locked native file operation host in ${outputDirectory}. Qualification remains unavailable.`
);

function parseOutputDirectory(args) {
  if (args.length === 0) return resolve(root, "release", "agent-file-operations");
  if (args.length === 2 && args[0] === "--output-dir" && args[1]) return resolve(args[1]);
  throw new Error("Usage: node scripts/build-agent-file-operations.mjs [--output-dir <directory>]");
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
