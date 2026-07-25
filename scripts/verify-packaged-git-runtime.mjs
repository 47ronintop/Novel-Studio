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
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { URL } from "node:url";

const options = parseArguments(process.argv.slice(2));
const packageDirectory = resolvePackageDirectory(options.packageDirectory);
const resourcesDirectory = join(packageDirectory, "resources");
const manifestPath = join(resourcesDirectory, "git", "manifest.json");
const trustedSourceLockPath = resolve(options.trustedSourceLock);
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
        await verifyPinnedRuntime(manifest);
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
  let trustedSourceLock = "apps/desktop/resources/git/runtime-source.lock.json";
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--release") {
      release = true;
    } else if (argument === "--package-dir") {
      packageDirectory = args[index + 1];
      index += 1;
    } else if (argument === "--trusted-source-lock") {
      trustedSourceLock = args[index + 1];
      index += 1;
    } else if (!argument.startsWith("-") && packageDirectory === undefined) {
      packageDirectory = argument;
    } else {
      throw new Error(`Unsupported argument: ${argument}`);
    }
  }
  if (packageDirectory === "") throw new Error("--package-dir requires a value.");
  if (!trustedSourceLock) throw new Error("--trusted-source-lock requires a value.");
  return { release, packageDirectory, trustedSourceLock };
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

/**
 * A package's manifest is not a trust root: an attacker who can replace the
 * executable can replace that manifest too. Release verification therefore
 * compares its complete inventory to the reviewed source lock outside the
 * unpacked package.
 */
async function verifyPinnedRuntime(manifest) {
  const lock = readTrustedSourceLock(trustedSourceLockPath);
  if (lock === undefined || lock.status !== "pinned") {
    block(
      "Trusted Git runtime signature or digest-root verification is unavailable because the reviewed Git source lock is not pinned."
    );
    return;
  }
  const inventoryPath = join(resourcesDirectory, "git", "runtime-inventory.json");
  const inventory = readInventory(inventoryPath);
  if (inventory === undefined) {
    fail(`Git runtime inventory is missing or malformed: ${inventoryPath}`);
    return;
  }
  if (
    inventory.vendor !== lock.vendor ||
    inventory.version !== lock.version ||
    inventory.sourceUrl !== lock.sourceUrl ||
    inventory.archiveSha256 !== lock.archiveSha256 ||
    inventory.licensePath !== lock.licensePath ||
    inventory.licenseSha256 !== lock.licenseSha256 ||
    inventory.executablePath !== lock.executablePath ||
    manifest.version !== lock.version ||
    manifest.path !== `git/${lock.executablePath}` ||
    manifest.digest !== inventory.executableDigest
  ) {
    fail("Git runtime manifest or inventory is not bound to the reviewed source lock.");
    return;
  }
  const verifiedFiles = await verifyInventoryFiles(inventory);
  if (!verifiedFiles) return;
  if (inventory.runtimeDigest !== inventoryDigest(inventory.files)) {
    fail("Git runtime inventory digest mismatch.");
  }
}

function readTrustedSourceLock(path) {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    if (!isRecord(value) || value.schemaVersion !== "1.0") return undefined;
    if (
      value.status === "unavailable" &&
      hasExactKeys(value, ["schemaVersion", "status", "reason"]) &&
      isNonEmptyString(value.reason)
    ) {
      return value;
    }
    if (
      value.status === "pinned" &&
      hasExactKeys(value, [
        "schemaVersion",
        "status",
        "vendor",
        "version",
        "sourceUrl",
        "archiveSha256",
        "executablePath",
        "licensePath",
        "licenseSha256"
      ]) &&
      value.vendor === "Git for Windows" &&
      /^[0-9]+\.[0-9]+\.[0-9]+(?:\.windows\.[0-9]+)?$/.test(value.version) &&
      isTrustedGitForWindowsUrl(value.sourceUrl) &&
      isSha256(value.archiveSha256) &&
      isSafeRuntimePath(value.executablePath) &&
      isSafeRuntimePath(value.licensePath) &&
      isSha256(value.licenseSha256)
    ) {
      return value;
    }
  } catch {
    // A missing lock is deliberately indistinguishable from an untrusted one.
  }
  return undefined;
}

function readInventory(path) {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    const expectedKeys = new Set([
      "schemaVersion",
      "vendor",
      "version",
      "sourceUrl",
      "archiveSha256",
      "licensePath",
      "licenseSha256",
      "executablePath",
      "executableDigest",
      "runtimeDigest",
      "files"
    ]);
    if (
      !isRecord(value) ||
      Object.keys(value).length !== expectedKeys.size ||
      Object.keys(value).some((key) => !expectedKeys.has(key)) ||
      value.schemaVersion !== "1.0" ||
      value.vendor !== "Git for Windows" ||
      !isNonEmptyString(value.version) ||
      !isNonEmptyString(value.sourceUrl) ||
      !isSha256(value.archiveSha256) ||
      !isSafeRuntimePath(value.licensePath) ||
      !isSha256(value.licenseSha256) ||
      !isSafeRuntimePath(value.executablePath) ||
      !isSha256(value.executableDigest) ||
      !isSha256(value.runtimeDigest) ||
      !Array.isArray(value.files) ||
      value.files.length === 0
    ) {
      return undefined;
    }
    const seenPaths = new Set();
    for (const file of value.files) {
      if (
        !isRecord(file) ||
        !hasExactKeys(file, ["path", "size", "digest"]) ||
        !isSafeRuntimePath(file.path) ||
        seenPaths.has(file.path) ||
        !Number.isSafeInteger(file.size) ||
        file.size < 0 ||
        !isSha256(file.digest)
      ) {
        return undefined;
      }
      seenPaths.add(file.path);
    }
    return value;
  } catch {
    return undefined;
  }
}

async function verifyInventoryFiles(inventory) {
  const gitDirectory = join(resourcesDirectory, "git");
  const expectedPaths = new Set([
    "manifest.json",
    "runtime-inventory.json",
    ...inventory.files.map((file) => file.path)
  ]);
  const actualFiles = await collectRuntimeFiles(gitDirectory);
  if (actualFiles === undefined) return false;
  if (
    actualFiles.length !== expectedPaths.size ||
    actualFiles.some((path) => !expectedPaths.has(path))
  ) {
    fail("Git runtime contains untracked, missing, or unsafe files.");
    return false;
  }
  for (const file of inventory.files) {
    const path = resolve(gitDirectory, file.path);
    if (!isContainedPath(gitDirectory, path)) {
      fail("Git runtime inventory path escapes its runtime directory.");
      return false;
    }
    await verifyArtifactFile(path, file);
  }
  const executable = inventory.files.find((file) => file.path === inventory.executablePath);
  if (executable === undefined || executable.digest !== inventory.executableDigest) {
    fail("Git runtime executable is not bound to the inventory.");
    return false;
  }
  const license = inventory.files.find((file) => file.path === inventory.licensePath);
  if (license === undefined || license.digest !== inventory.licenseSha256) {
    fail("Git runtime license is not bound to the inventory.");
    return false;
  }
  return true;
}

async function collectRuntimeFiles(directory) {
  const files = [];
  const stack = [directory];
  try {
    while (stack.length > 0) {
      const current = stack.pop();
      const entries = await readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        const path = join(current, entry.name);
        const filePath = relative(directory, path).replaceAll("\\", "/");
        if (!isSafeRuntimePath(filePath)) return undefined;
        const details = await lstat(path);
        if (details.isSymbolicLink() || (!details.isFile() && !details.isDirectory()))
          return undefined;
        if (details.isDirectory()) stack.push(path);
        else files.push(filePath);
      }
    }
    return files.sort((left, right) => left.localeCompare(right));
  } catch {
    fail("Git runtime files cannot be enumerated safely.");
    return undefined;
  }
}

async function verifyArtifactFile(path, expected) {
  const details = await lstat(path);
  if (!details.isFile() || details.isSymbolicLink() || details.size !== expected.size) {
    fail(`Git runtime inventory entry is not a matching regular file: ${expected.path}`);
    return;
  }
  const actual = createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
  if (actual !== expected.digest) {
    fail(`Git runtime inventory digest mismatch: ${expected.path}`);
  }
}

function inventoryDigest(files) {
  const canonical = [...files]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((file) => `${file.path}\0${file.size}\0${file.digest}\n`)
    .join("");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
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
  if (
    /^[a-zA-Z]:/.test(value) ||
    value.includes("\\") ||
    value.startsWith("//") ||
    posix.normalize(value) !== value
  ) {
    return false;
  }
  return value
    .split("/")
    .every((part) => part && part !== "." && part !== ".." && !part.includes(":"));
}

function isSafeRuntimePath(value) {
  return isSafeResourcePath(value);
}

function isTrustedGitForWindowsUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      /^\/git-for-windows\/git\/releases\/download\/v[0-9.]+\.windows\.[0-9]+\/.+\.zip$/.test(
        url.pathname
      )
    );
  } catch {
    return false;
  }
}

function hasExactKeys(value, keys) {
  return (
    Object.keys(value).length === keys.length &&
    Object.keys(value).every((key) => keys.includes(key))
  );
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
