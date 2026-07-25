#!/usr/bin/env node
/**
 * Supply-chain gate for the native sandbox workspace.
 *
 * This deliberately fails when cargo-deny is unavailable. A missing audit tool
 * is not evidence that the native runtime is safe to ship.
 */
import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const workspace = resolve("apps", "desktop", "native", "agent-task-sandbox");
const lockfile = resolve(workspace, "Cargo.lock");
const manifest = resolve(workspace, "Cargo.toml");
const denyConfig = resolve(workspace, "deny.toml");

for (const file of [lockfile, manifest, denyConfig]) {
  if (!existsSync(file)) throw new Error(`Native sandbox audit prerequisite is missing: ${file}`);
}

const lockContent = readFileSync(lockfile, "utf8");
for (const packageName of [
  "agent-task-sandbox-host",
  "agent-task-sandbox-probe",
  "agent-file-operations-host"
]) {
  if (!lockContent.includes(`name = "${packageName}"`)) {
    throw new Error(`Cargo.lock does not record ${packageName}.`);
  }
}

await run("cargo", [
  "metadata",
  "--locked",
  "--no-deps",
  "--format-version",
  "1",
  "--manifest-path",
  manifest
]);
await run("cargo", ["deny", "check", "--manifest-path", manifest, "--config", denyConfig]);

console.log("Native sandbox Cargo lock and cargo-deny policy audit passed.");

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { shell: false, stdio: "inherit" });
    child.once("error", (error) => {
      reject(new Error(`${command} is required for agent-sandbox:audit: ${error.message}`));
    });
    child.once("exit", (code) => {
      if (code === 0) {
        resolveRun();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`));
      }
    });
  });
}
