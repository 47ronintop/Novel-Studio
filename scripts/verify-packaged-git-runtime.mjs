#!/usr/bin/env node
/**
 * Verify the Git runtime inside a real electron-builder unpacked package.
 *
 * Development packages may intentionally carry the unavailable placeholder.
 * Release mode turns every blocked state into a non-zero exit status.
 */
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { clearTimeout, setTimeout } from "node:timers";
import { existsSync, readFileSync } from "node:fs";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const options = parseArguments(process.argv.slice(2));
const packageDirectory = resolvePackageDirectory(options.packageDirectory);
const resourcesDirectory = join(packageDirectory, "resources");
const manifestPath = join(resourcesDirectory, "git", "manifest.json");
let blocked = false;
let failed = false;

if (!existsSync(manifestPath)) {
  fail(`Git manifest is missing from packaged resources: ${manifestPath}`);
} else {
  const manifest = readManifest(manifestPath);
  if (manifest === undefined) {
    fail(`Git manifest is malformed: ${manifestPath}`);
  } else if (manifest.digest === "placeholder" || manifest.version === "unavailable") {
    block("Git runtime is unavailable: the package contains the explicit development placeholder.");
  } else if (!isSha256(manifest.digest)) {
    fail("Git manifest digest must be a SHA-256 hex string.");
  } else if (!isSafeResourcePath(manifest.path)) {
    fail("Git manifest path is not a safe resources-relative path.");
  } else {
    const binaryPath = resolve(resourcesDirectory, manifest.path);
    if (!isContainedPath(resourcesDirectory, binaryPath)) {
      fail("Git manifest path escapes the package resources directory.");
    } else {
      await verifyArtifact(binaryPath, manifest.digest, "Git runtime");
      if (options.release) {
        block(
          "Trusted Git runtime signature or digest-root verification is not implemented; packaged Git cannot authorize release."
        );
      } else if (!failed) {
        // This executes only as a local development diagnostic, never in a release gate.
        await verifyGitVersion(binaryPath, manifest.version);
      }
    }
  }
}

if (failed || (options.release && blocked)) {
  process.exitCode = 1;
} else if (blocked) {
  console.warn("BLOCKED: Git runtime is not release-qualified.");
} else {
  console.log("OK: packaged Git runtime matches its manifest digest.");
}

function parseArguments(args) {
  let release = false;
  let packageDirectory;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--release") {
      release = true;
    } else if (argument === "--package-dir") {
      packageDirectory = args[index + 1];
      index += 1;
    } else if (!argument.startsWith("-") && packageDirectory === undefined) {
      packageDirectory = argument;
    } else {
      throw new Error(`Unsupported argument: ${argument}`);
    }
  }
  if (packageDirectory === "") throw new Error("--package-dir requires a value.");
  return { release, packageDirectory };
}

function resolvePackageDirectory(explicitDirectory) {
  if (explicitDirectory !== undefined) return resolve(explicitDirectory);
  const latestPath = resolve("release", "latest-package-dir.txt");
  if (!existsSync(latestPath)) {
    throw new Error(
      "No packaged directory supplied and release/latest-package-dir.txt is missing."
    );
  }
  const latest = readFileSync(latestPath, "utf8").trim();
  if (!latest) throw new Error("release/latest-package-dir.txt is empty.");
  return resolve(latest);
}

function readManifest(path) {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    const expectedKeys = new Set(["schemaVersion", "version", "digest", "path", "license"]);
    if (
      !isRecord(value) ||
      Object.keys(value).some((key) => !expectedKeys.has(key)) ||
      value.schemaVersion !== "1.0" ||
      !isNonEmptyString(value.version) ||
      typeof value.digest !== "string" ||
      !isSafeResourcePath(value.path) ||
      value.license !== "GPL-2.0" ||
      (value.version !== "unavailable" &&
        !/^[0-9]+\.[0-9]+\.[0-9]+(?:[.-][A-Za-z0-9]+)*$/.test(value.version))
    ) {
      return undefined;
    }
    return value;
  } catch {
    return undefined;
  }
}

async function verifyArtifact(path, expectedDigest, label) {
  let stats;
  try {
    stats = await lstat(path);
  } catch {
    fail(`${label} is missing: ${path}`);
    return;
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    fail(`${label} must be a regular file: ${path}`);
    return;
  }
  if (!(await isPortableExecutable(path))) {
    fail(`${label} must be a Windows PE executable: ${path}`);
    return;
  }
  const resolvedResources = await realpath(resourcesDirectory);
  const resolvedArtifact = await realpath(path);
  if (!isContainedPath(resolvedResources, resolvedArtifact)) {
    fail(`${label} resolves outside package resources.`);
    return;
  }
  const actualDigest = createHash("sha256")
    .update(await readFile(resolvedArtifact))
    .digest("hex");
  if (actualDigest !== expectedDigest) {
    fail(`${label} digest mismatch. expected=${expectedDigest} actual=${actualDigest}`);
  }
}

async function verifyGitVersion(binaryPath, expectedVersion) {
  const result = await run(binaryPath, ["--version"]);
  if (result.exitCode !== 0 || result.stdout.trim() !== `git version ${expectedVersion}`) {
    fail("Git runtime --version does not match the manifest version.");
  }
}

function run(command, args) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "ignore"] });
    let stdout = "";
    const timeout = setTimeout(() => {
      child.kill();
    }, 5_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.once("error", () => {
      clearTimeout(timeout);
      resolveRun({ exitCode: null, stdout });
    });
    child.once("close", (exitCode) => {
      clearTimeout(timeout);
      resolveRun({ exitCode, stdout });
    });
  });
}

async function isPortableExecutable(path) {
  try {
    const bytes = await readFile(path);
    const peOffset = bytes.readUInt32LE(0x3c);
    return (
      bytes.length >= 0x40 &&
      bytes[0] === 0x4d &&
      bytes[1] === 0x5a &&
      peOffset >= 0x40 &&
      peOffset + 4 <= bytes.length &&
      bytes.subarray(peOffset, peOffset + 4).equals(Buffer.from("PE\0\0"))
    );
  } catch {
    return false;
  }
}

function block(message) {
  blocked = true;
  console.warn(`BLOCKED: ${message}`);
}

function fail(message) {
  failed = true;
  console.error(`FAIL: ${message}`);
}

function isSafeResourcePath(value) {
  if (!isNonEmptyString(value) || value.includes("\0") || isAbsolute(value)) return false;
  if (/^[a-zA-Z]:/.test(value) || value.startsWith("\\\\") || value.startsWith("//")) return false;
  return value
    .split(/[\\/]+/)
    .every((part) => part && part !== "." && part !== ".." && !part.includes(":"));
}

function isContainedPath(base, candidate) {
  const relativePath = relative(base, candidate);
  return (
    relativePath !== "" &&
    !relativePath.startsWith(`..${sep}`) &&
    relativePath !== ".." &&
    !isAbsolute(relativePath)
  );
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}
