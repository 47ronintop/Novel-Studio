import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const developmentDist = join(
  sourceRoot,
  "native",
  "engineering-file-access-win32",
  "dist",
  "win32-x64"
);
const protections = [
  "rootRelativeTraversal",
  "noFollowTraversal",
  "rawByteIdentity",
  "receiptBinding",
  "durability",
  "recoveryRootBinding"
];
const controls = [
  "rootRelativeDisabled",
  "noFollowDisabled",
  "rawByteIdentityDisabled",
  "receiptBindingDisabled",
  "durabilityDisabled",
  "recoveryRootBindingDisabled"
];
const readOnlyCapabilities = ["root", "access", "read", "index"];
const ordinaryRelativePath = "docs/ordinary-utf8.txt";
const ordinaryUtf8Text =
  "B6 ordinary UTF-8 fixture: 你好, café, 😀\nneedle: deterministic-search\n";
const searchNeedle = "needle: deterministic-search";
const traversalPaths = [
  "../engineering-file-access-probe-outside.txt",
  "docs/../../engineering-file-access-probe-outside.txt",
  "docs/../ordinary-utf8.txt",
  "C:\\engineering-file-access-probe-outside.txt",
  "\\\\server\\share\\engineering-file-access-probe-outside.txt",
  "\\\\?\\C:\\engineering-file-access-probe-outside.txt"
];

/**
 * @typedef {object} EngineeringFileAccessPackageProbeRequest
 * @property {string} artifactPath Absolute path to the exact installed `.node` artifact.
 * @property {string} manifestPath Absolute path to that artifact's manifest.
 * @property {string} signaturePath Absolute path to that manifest's detached CMS signature.
 * @property {string} reportPath Absolute Main-owned output path. It must not be an artifact input.
 * @property {"development" | "production"} [packageKind] Development remains the CI default.
 * @property {string} [evidencePath] Absolute positive/negative protection evidence path for a production probe.
 */

/**
 * @typedef {object} EngineeringFileAccessPackageProbeResult
 * @property {string} reportPath
 * @property {"development" | "production"} packageKind
 * @property {string} artifactSha256
 * @property {string} artifactManifestSha256
 * @property {string | null} artifactManifestSignatureSha256
 * @property {"available" | "unavailable"} readOnlyAvailability
 * @property {object} developmentProbe
 * @property {object | undefined} protectionEvidence
 * @property {object} report
 */

if (isCliInvocation()) await main();

async function main() {
  const result = await runEngineeringFileAccessPackageProbe(cliProbeRequest());
  console.log(
    JSON.stringify({
      reportPath: result.reportPath,
      productionQualified: false,
      reason: result.report.reason,
      packageKind: result.packageKind,
      readOnlyAvailability: result.readOnlyAvailability
    })
  );
}

/**
 * Runs a fresh B6 ABI/protection probe for the exact files supplied by Electron Main.
 *
 * This runner deliberately does not verify Authenticode, CMS, publishers, or trust stores and
 * never grants production qualification. Main must independently verify the fixed installed
 * artifact set before it decides whether this fresh observation can contribute to an attestation.
 * The serialized report is diagnostic evidence only; it is not read as package authority.
 *
 * @param {EngineeringFileAccessPackageProbeRequest} input
 * @returns {Promise<EngineeringFileAccessPackageProbeResult>}
 */
export async function runEngineeringFileAccessPackageProbe(input) {
  const request = createEngineeringFileAccessPackageProbeRequest(input);
  await Promise.all([stat(request.artifactPath), stat(request.manifestPath)]);
  const signaturePresent = await stat(request.signaturePath)
    .then(() => true)
    .catch(() => false);
  if (request.packageKind === "production" && !signaturePresent) {
    throw new Error("production probe requires the explicit installed manifest signature");
  }
  const digest = async (path) =>
    createHash("sha256")
      .update(await readFile(path))
      .digest("hex");
  const [addonSha, manifestSha] = await Promise.all([
    digest(request.artifactPath),
    digest(request.manifestPath)
  ]);
  const signatureSha = signaturePresent ? await digest(request.signaturePath) : null;
  const manifest = JSON.parse(await readFile(request.manifestPath, "utf8"));
  if (
    manifest.target !== "win32-x64" ||
    manifest.adapterId !== "novel_studio_engineering_file_access" ||
    manifest.nodeApiVersion !== 8 ||
    manifest.artifact?.sha256 !== addonSha
  ) {
    throw new Error("native manifest or addon digest mismatch");
  }

  const addon = require(request.artifactPath);
  const readOnlyAvailability = readOnlyAvailabilityFor(manifest);
  assertAdapterInfo(addon.adapterInfo?.(), readOnlyAvailability);

  if (request.packageKind === "development") {
    assertUnsignedDevelopmentArtifact(manifest, signaturePresent, readOnlyAvailability);
    const developmentProbe =
      readOnlyAvailability === "available"
        ? await probeReadOnlyAbi(addon)
        : { status: "unavailable", reason: "manifest_read_only_capabilities_unavailable" };
    const report = {
      schemaVersion: "development-1.1",
      adapterId: manifest.adapterId,
      target: manifest.target,
      packageKind: "development",
      productionQualified: false,
      capabilities: developmentCapabilities(readOnlyAvailability),
      developmentProbe,
      reason: "unsigned_development_artifact",
      artifactSha256: addonSha,
      artifactManifestSha256: manifestSha,
      artifactManifestSignatureSha256: signatureSha
    };
    await writeProbeReport(request.reportPath, report);
    return Object.freeze({
      reportPath: request.reportPath,
      packageKind: request.packageKind,
      artifactSha256: addonSha,
      artifactManifestSha256: manifestSha,
      artifactManifestSignatureSha256: signatureSha,
      readOnlyAvailability,
      developmentProbe,
      protectionEvidence: undefined,
      report
    });
  }

  if (readOnlyAvailability !== "available") {
    throw new Error("production probe requires all B6 read-only capabilities to be available");
  }
  const developmentProbe = await probeReadOnlyAbi(addon);
  if (!request.evidencePath)
    throw new Error(
      "production probe requires explicit evidencePath from the actual package protection and fault runner"
    );
  const evidence = JSON.parse(await readFile(request.evidencePath, "utf8"));
  if (
    !hasExactMap(evidence.positiveProtections, protections, "passed") ||
    !hasExactMap(evidence.negativeControls, controls, "canary_exposed")
  ) {
    throw new Error(
      "Production probe evidence did not prove every positive protection and disabled-protection canary"
    );
  }
  const now = new Date();
  const report = {
    schemaVersion: "fresh-probe-1.0",
    authority: "probe_runner_diagnostic_only",
    adapterId: "novel_studio_engineering_file_access",
    target: "win32-x64",
    packageKind: "production",
    productionQualified: false,
    signatureVerification: "not_performed_by_probe",
    artifactSha256: addonSha,
    artifactManifestSha256: manifestSha,
    artifactManifestSignatureSha256: signatureSha,
    digestVerification: "match",
    publisherPolicyChecksum: manifest.publisherPolicyChecksum,
    generatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
    positiveProtections: evidence.positiveProtections,
    negativeControls: evidence.negativeControls
  };
  report.reportChecksum = sha256(stable(report));
  await writeProbeReport(request.reportPath, report);
  return Object.freeze({
    reportPath: request.reportPath,
    packageKind: request.packageKind,
    artifactSha256: addonSha,
    artifactManifestSha256: manifestSha,
    artifactManifestSignatureSha256: signatureSha,
    readOnlyAvailability,
    developmentProbe,
    protectionEvidence: evidence,
    report
  });
}

/**
 * Validates the ESM API request. The paths are deliberately absolute: callers cannot redirect a
 * packaged probe through the source checkout or their current working directory.
 *
 * @param {EngineeringFileAccessPackageProbeRequest} input
 * @returns {Readonly<Required<EngineeringFileAccessPackageProbeRequest>>}
 */
export function createEngineeringFileAccessPackageProbeRequest(input) {
  if (!input || typeof input !== "object") throw new Error("probe request must be an object");
  const packageKind = input.packageKind ?? "development";
  if (packageKind !== "development" && packageKind !== "production") {
    throw new Error("probe request packageKind must be development or production");
  }
  const request = {
    artifactPath: input.artifactPath,
    manifestPath: input.manifestPath,
    signaturePath: input.signaturePath,
    reportPath: input.reportPath,
    packageKind,
    evidencePath: input.evidencePath
  };
  for (const [name, path] of Object.entries(request)) {
    if (name === "packageKind" || (name === "evidencePath" && path === undefined)) continue;
    if (typeof path !== "string" || !isAbsolute(path)) {
      throw new Error(`probe request ${name} must be an absolute path`);
    }
  }
  if (
    request.reportPath === request.artifactPath ||
    request.reportPath === request.manifestPath ||
    request.reportPath === request.signaturePath
  ) {
    throw new Error("probe request reportPath must be separate from installed artifact inputs");
  }
  if (packageKind === "production" && request.evidencePath === undefined) {
    throw new Error("production probe request requires an absolute evidencePath");
  }
  return Object.freeze(request);
}

function cliProbeRequest() {
  const packageKind = process.env.ENGINEERING_FILE_ACCESS_PROBE_PACKAGE_KIND ?? "development";
  if (packageKind === "production") {
    for (const name of [
      "ENGINEERING_FILE_ACCESS_PROBE_ARTIFACT",
      "ENGINEERING_FILE_ACCESS_PROBE_MANIFEST",
      "ENGINEERING_FILE_ACCESS_PROBE_SIGNATURE",
      "ENGINEERING_FILE_ACCESS_PROBE_REPORT",
      "ENGINEERING_FILE_ACCESS_PROBE_EVIDENCE"
    ]) {
      if (!process.env[name]) {
        throw new Error(`production CLI probe requires ${name}; it has no source-tree defaults`);
      }
    }
  }
  return createEngineeringFileAccessPackageProbeRequest({
    artifactPath:
      process.env.ENGINEERING_FILE_ACCESS_PROBE_ARTIFACT ??
      join(developmentDist, "engineering_file_access.node"),
    manifestPath:
      process.env.ENGINEERING_FILE_ACCESS_PROBE_MANIFEST ??
      join(developmentDist, "engineering_file_access.manifest.json"),
    signaturePath:
      process.env.ENGINEERING_FILE_ACCESS_PROBE_SIGNATURE ??
      join(developmentDist, "engineering_file_access.manifest.p7s"),
    reportPath:
      process.env.ENGINEERING_FILE_ACCESS_PROBE_REPORT ??
      join(developmentDist, "engineering_file_access.probe.json"),
    packageKind,
    evidencePath: process.env.ENGINEERING_FILE_ACCESS_PROBE_EVIDENCE
  });
}

async function writeProbeReport(reportPath, report) {
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

export function readOnlyAvailabilityFor(manifest) {
  const eligibility = manifest?.eligibility;
  if (!eligibility || typeof eligibility !== "object") {
    throw new Error("native manifest must declare every B6 read-only capability");
  }
  const values = readOnlyCapabilities.map((capability) => eligibility[capability]);
  if (values.every((value) => value === "available")) return "available";
  if (values.every((value) => value === "unavailable")) return "unavailable";
  throw new Error("native manifest must not partially advertise B6 read-only capabilities");
}

export async function probeReadOnlyAbi(addon) {
  if (
    !addon ||
    typeof addon.openWorkspaceRoot !== "function" ||
    typeof addon.readFile !== "function" ||
    typeof addon.listDirectory !== "function" ||
    typeof addon.buildIndex !== "function" ||
    typeof addon.searchText !== "function"
  ) {
    throw new Error(
      "available B6 read-only addon must expose openWorkspaceRoot, listDirectory, readFile, buildIndex, and searchText"
    );
  }
  const fixtureParent = await mkdtemp(join(tmpdir(), "engineering-file-access-probe-"));
  const workspace = join(fixtureParent, "workspace");
  let openedRoot;
  try {
    await writeFile(
      join(fixtureParent, "engineering-file-access-probe-outside.txt"),
      "outside",
      "utf8"
    );
    await mkdir(join(workspace, "docs"), { recursive: true });
    await writeFile(join(workspace, ordinaryRelativePath), ordinaryUtf8Text, {
      encoding: "utf8",
      flush: true
    });
    openedRoot = addon.openWorkspaceRoot(workspace);
    if (!openedRoot || typeof openedRoot !== "object" || typeof openedRoot.rootId !== "bigint") {
      throw new Error("available B6 read-only addon did not return a bigint rootId");
    }
    if (openedRoot.capability !== "available") {
      throw new Error("available B6 read-only addon did not issue an available root capability");
    }
    if (!isNativeRootIdentity(openedRoot.rootIdentity)) {
      throw new Error("available B6 read-only addon did not return a canonical root identity");
    }
    const bytes = addon.readFile(openedRoot.rootId, ordinaryRelativePath);
    if (!Buffer.isBuffer(bytes) || bytes.toString("utf8") !== ordinaryUtf8Text) {
      throw new Error("B6 readFile did not return the exact ordinary UTF-8 fixture bytes");
    }
    const listing = addon.listDirectory(openedRoot.rootId, "docs");
    if (
      !Array.isArray(listing) ||
      !listing.some(
        (entry) =>
          entry &&
          entry.name === "ordinary-utf8.txt" &&
          entry.directory === false &&
          entry.byteLength === BigInt(bytes.byteLength)
      )
    ) {
      throw new Error("B6 listDirectory did not return the ordinary UTF-8 fixture");
    }
    const index = addon.buildIndex(openedRoot.rootId);
    if (
      !index ||
      !Array.isArray(index.files) ||
      index.truncated !== false ||
      !index.files.some(
        (entry) =>
          entry &&
          entry.relativePath === ordinaryRelativePath &&
          entry.byteLength === BigInt(bytes.byteLength)
      )
    ) {
      throw new Error("B6 buildIndex did not return the ordinary UTF-8 fixture");
    }
    const search = addon.searchText(openedRoot.rootId, searchNeedle);
    const expectedByteOffset = BigInt(bytes.indexOf(Buffer.from(searchNeedle, "utf8")));
    if (
      !search ||
      !Array.isArray(search.matches) ||
      search.truncated !== false ||
      !search.matches.some(
        (match) =>
          match &&
          match.relativePath === ordinaryRelativePath &&
          match.byteOffset === expectedByteOffset
      )
    ) {
      throw new Error("B6 searchText did not return the deterministic ordinary UTF-8 match");
    }
    for (const path of traversalPaths) await expectReadFailure(addon, openedRoot.rootId, path);
    return {
      status: "passed",
      ordinaryUtf8Read: "passed",
      ordinaryUtf8List: "passed",
      ordinaryUtf8Index: "passed",
      ordinaryUtf8Search: "passed",
      rootRelativeTraversal: "passed",
      rejectedPaths: traversalPaths
    };
  } finally {
    if (openedRoot && typeof addon.closeWorkspaceRoot === "function") {
      await Promise.resolve(addon.closeWorkspaceRoot(openedRoot.rootId));
    }
    await rm(fixtureParent, { recursive: true, force: true, maxRetries: 3 });
  }
}

async function expectReadFailure(addon, rootId, path) {
  try {
    const result = addon.readFile(rootId, path);
    await Promise.resolve(result);
  } catch {
    return;
  }
  throw new Error(`B6 readFile unexpectedly accepted adversarial path: ${JSON.stringify(path)}`);
}

function developmentCapabilities(readOnlyAvailability) {
  return {
    root: readOnlyAvailability,
    access: readOnlyAvailability,
    read: readOnlyAvailability,
    index: readOnlyAvailability,
    mutation: "unavailable",
    recovery: "unavailable"
  };
}

function assertAdapterInfo(info, readOnlyAvailability) {
  if (
    !info ||
    info.target !== "win32-x64" ||
    info.batch !== "6" ||
    info.accessEligible !== readOnlyAvailability ||
    info.mutation !== "unavailable" ||
    info.recovery !== "unavailable"
  ) {
    throw new Error("native addon does not preserve the Batch 6 capability boundary");
  }
  for (const capability of ["root", "read", "index"]) {
    const property = `${capability}Eligible`;
    if (property in info && info[property] !== readOnlyAvailability) {
      throw new Error(`native addon ${property} does not match its manifest eligibility`);
    }
  }
}

function hasExactMap(value, keys, expected) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => value[key] === expected)
  );
}

function assertUnsignedDevelopmentArtifact(manifest, signaturePresent, readOnlyAvailability) {
  if (
    signaturePresent ||
    manifest.signing?.authenticode !== "required-for-production" ||
    manifest.signing?.detachedCms !== "required-for-production" ||
    manifest.signing?.developmentUnsigned !== true ||
    manifest.qualification?.productionQualified !== false ||
    manifest.eligibility?.batch !== "6" ||
    manifest.eligibility?.mutation !== "unavailable" ||
    manifest.eligibility?.recovery !== "unavailable" ||
    (readOnlyAvailability !== "available" && readOnlyAvailability !== "unavailable")
  ) {
    throw new Error("development probe requires an unsigned Batch 6-only artifact");
  }
}

function isCliInvocation() {
  return process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
}

function isNativeRootIdentity(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") ===
      "canonicalPathIdentityChecksum,directoryIdentity,volumeIdentity" &&
    /^[a-f0-9]{8}$/u.test(value.volumeIdentity) &&
    /^[a-f0-9]{16}$/u.test(value.directoryIdentity) &&
    /^[a-f0-9]{64}$/u.test(value.canonicalPathIdentityChecksum)
  );
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
