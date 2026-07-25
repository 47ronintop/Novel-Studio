#!/usr/bin/env node
/**
 * Verify host and probe artifacts inside a real electron-builder unpacked package.
 * Placeholders are reported as Blocked in development and fail in release mode.
 */
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { existsSync, readFileSync } from "node:fs";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const options = parseArguments(process.argv.slice(2));
const packageDirectory = resolvePackageDirectory(options.packageDirectory);
const resourcesDirectory = join(packageDirectory, "resources");
const manifestPath = join(resourcesDirectory, "native", "agent-task-sandbox", "manifest.json");
const REQUIRED_POLICY_REVISION = "v1.0-windows-appcontainer";
const REQUIRED_TEST_VECTOR_REVISION = "tv-2026-07-23";
const REQUIRED_CAPABILITIES = [
  "fileIsolation",
  "networkIsolation",
  "jobObjectKillOnClose",
  "appContainerOrLowBox"
];
let blocked = false;
let failed = false;

if (!existsSync(manifestPath)) {
  fail(`Sandbox manifest is missing from packaged resources: ${manifestPath}`);
} else {
  const manifest = readManifest(manifestPath);
  if (manifest === undefined) {
    fail(`Sandbox manifest is malformed: ${manifestPath}`);
  } else if (manifest.status !== "qualified") {
    block("Sandbox runtime is explicitly marked unavailable.");
  } else {
    for (const artifact of manifest.artifacts) {
      if (artifact.digest === "placeholder") {
        block(`Sandbox ${artifact.kind} uses a placeholder digest.`);
        continue;
      }
      if (!isSha256(artifact.digest)) {
        fail(`Sandbox ${artifact.kind} digest must be a SHA-256 hex string.`);
        continue;
      }
      if (!isSafeResourcePath(artifact.path)) {
        fail(`Sandbox ${artifact.kind} path is not a safe resources-relative path.`);
        continue;
      }
      const artifactPath = resolve(resourcesDirectory, artifact.path);
      if (!isContainedPath(resourcesDirectory, artifactPath)) {
        fail(`Sandbox ${artifact.kind} path escapes the package resources directory.`);
        continue;
      }
      await verifyArtifact(artifactPath, artifact.digest, `Sandbox ${artifact.kind}`);
    }
    verifyQualificationAttestation(manifest);
    block(
      "Trusted external sandbox qualification attestation verification is not implemented; qualified manifests cannot authorize release."
    );
  }
}

if (failed || (options.release && blocked)) {
  process.exitCode = 1;
} else if (blocked) {
  console.warn("BLOCKED: sandbox runtime is not release-qualified.");
} else {
  console.log("OK: packaged sandbox host and probe match their manifest digests.");
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
    const expectedKeys = new Set([
      "schemaVersion",
      "status",
      "protocolVersion",
      "policyRevision",
      "testVectorRevision",
      "artifacts",
      "qualification"
    ]);
    if (
      !isRecord(value) ||
      Object.keys(value).some((key) => !expectedKeys.has(key)) ||
      value.schemaVersion !== "1.0" ||
      (value.status !== "qualified" && value.status !== "unavailable") ||
      value.protocolVersion !== "1.0" ||
      value.policyRevision !== REQUIRED_POLICY_REVISION ||
      value.testVectorRevision !== REQUIRED_TEST_VECTOR_REVISION ||
      !Array.isArray(value.artifacts) ||
      value.artifacts.length !== 2
    ) {
      return undefined;
    }
    if (value.status === "qualified" && !isQualificationAttestation(value.qualification)) {
      return undefined;
    }
    if (value.status === "unavailable" && value.qualification !== undefined) {
      return undefined;
    }
    const seenKinds = new Set();
    for (const artifact of value.artifacts) {
      if (
        !isRecord(artifact) ||
        (artifact.kind !== "host" && artifact.kind !== "probe") ||
        seenKinds.has(artifact.kind) ||
        !isSafeResourcePath(artifact.path) ||
        typeof artifact.digest !== "string"
      ) {
        return undefined;
      }
      seenKinds.add(artifact.kind);
    }
    return seenKinds.has("host") && seenKinds.has("probe") ? value : undefined;
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

function verifyQualificationAttestation(manifest) {
  const qualification = manifest.qualification;
  if (!isQualificationAttestation(qualification)) {
    fail("Sandbox qualification attestation is missing or malformed.");
    return;
  }
  const artifacts = new Map(manifest.artifacts.map((artifact) => [artifact.kind, artifact.digest]));
  if (
    qualification.hostDigest !== artifacts.get("host") ||
    qualification.probeDigest !== artifacts.get("probe") ||
    new Date(qualification.expiresAt).getTime() <= Date.now()
  ) {
    fail("Sandbox qualification attestation is stale or is not bound to the packaged artifacts.");
  }
}

function isQualificationAttestation(value) {
  if (!isRecord(value)) return false;
  const expectedKeys = new Set([
    "attestationId",
    "issuedAt",
    "expiresAt",
    "profile",
    "hostDigest",
    "probeDigest",
    "capabilities"
  ]);
  if (
    Object.keys(value).length !== expectedKeys.size ||
    Object.keys(value).some((key) => !expectedKeys.has(key)) ||
    !isNonEmptyString(value.attestationId) ||
    value.profile !== "agent-task-sandbox-v1" ||
    !isSha256(value.hostDigest) ||
    !isSha256(value.probeDigest) ||
    !isFutureDate(value.expiresAt) ||
    !isPastDate(value.issuedAt) ||
    !isRecord(value.capabilities)
  ) {
    return false;
  }
  return (
    Object.keys(value.capabilities).length === REQUIRED_CAPABILITIES.length &&
    REQUIRED_CAPABILITIES.every((capability) => value.capabilities[capability] === "verified")
  );
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

function isFutureDate(value) {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    Date.parse(value) > Date.now()
  );
}

function isPastDate(value) {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    Date.parse(value) <= Date.now()
  );
}
