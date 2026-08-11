import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { link, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
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
const mutationV2Primitives = [
  "rawByteBlobs",
  "absenceProof",
  "absenceProofV2",
  "objectMutationAbi",
  "targetInspection",
  "operationStateReconciliation",
  "handleRelativeRevalidation",
  "finalRenameNamespaceRevalidation",
  "hardLinkPolicy",
  "copyOnReplace",
  "fixedCreateMetadata",
  "receiptDurability",
  "stagingWalRecoveryScan",
  "faultProbe",
  "stateDurability"
];
const lifecycleV2Primitives = [
  "move",
  "caseOnlyTwoStepWal",
  "volumeLocalRecoveryRoot",
  "quarantineDelete",
  "restoreNoOverwrite",
  "localPurge",
  "singleLevelCreateDirectory",
  "quarantineInventory",
  "lifecycleRecoveryInspection",
  "lifecycleIntermediateResume",
  "lifecycleRecoveryBoundStateDurability",
  "lifecycleReverseCompensation",
  "lifecycleDurableFinalize"
];
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
 * @property {object | undefined} mutationV2Probe
 * @property {object | undefined} stateDurabilityProbe
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
      readOnlyAvailability: result.readOnlyAvailability,
      mutationV2Probe: result.mutationV2Probe?.status ?? "not_run",
      stateDurabilityProbe: result.stateDurabilityProbe?.status ?? "not_run"
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
  const mutationV2Availability = mutationV2ProbeAvailabilityFor(manifest);

  if (request.packageKind === "development") {
    assertUnsignedDevelopmentArtifact(
      manifest,
      signaturePresent,
      readOnlyAvailability,
      mutationV2Availability
    );
    const developmentProbe =
      readOnlyAvailability === "available"
        ? await probeReadOnlyAbi(addon)
        : { status: "unavailable", reason: "manifest_read_only_capabilities_unavailable" };
    const mutationV2Probe =
      mutationV2Availability === "available"
        ? await probeMutationV2Abi(addon)
        : { status: "unavailable", reason: "manifest_mutation_v2_probe_unavailable" };
    const stateDurabilityProbe = await probeEngineeringStateDurabilityAbi(addon);
    const report = {
      schemaVersion: "development-1.2",
      adapterId: manifest.adapterId,
      target: manifest.target,
      packageKind: "development",
      productionQualified: false,
      capabilities: developmentCapabilities(readOnlyAvailability),
      developmentProbe,
      mutationV2Probe,
      stateDurabilityProbe,
      sourceIdentitySha256: manifest.sourceIdentity?.sha256,
      toolchainIdentitySha256: manifest.toolchain?.sha256,
      buildIdentitySha256: manifest.buildIdentity?.sha256,
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
      mutationV2Probe,
      stateDurabilityProbe,
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
    mutationV2Probe: undefined,
    stateDurabilityProbe: undefined,
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

export function mutationV2ProbeAvailabilityFor(manifest) {
  const declaration = manifest?.developmentMutationV2Probe;
  if (declaration === undefined) return "unavailable";
  if (!declaration || typeof declaration !== "object" || Array.isArray(declaration)) {
    throw new Error("native manifest mutation probe declaration must be an object");
  }
  const isBatch7 = declaration.schemaVersion === "1.0" && declaration.batch === "7";
  const isBatch8 = declaration.schemaVersion === "1.1" && declaration.batch === "8";
  if (!isBatch7 && !isBatch8) {
    throw new Error("native manifest mutation probe declaration has an unsupported version");
  }
  if (
    declaration.productCapability !== "unavailable" ||
    !/^[a-f0-9]{64}$/u.test(declaration.sourceIdentitySha256 ?? "") ||
    !/^[a-f0-9]{64}$/u.test(declaration.toolchainIdentitySha256 ?? "") ||
    !hasExactMap(declaration.primitives, mutationV2Primitives, "available", {
      hardLinkPolicy: "reject_multiple_links",
      copyOnReplace: "not_enabled"
    }) ||
    (isBatch8 && !hasExactMap(declaration.lifecyclePrimitives, lifecycleV2Primitives, "available"))
  ) {
    throw new Error("native manifest mutation probe declaration is incomplete or unsafe");
  }
  if (
    manifest.sourceIdentity?.sha256 !== declaration.sourceIdentitySha256 ||
    manifest.toolchain?.sha256 !== declaration.toolchainIdentitySha256 ||
    !/^[a-f0-9]{64}$/u.test(manifest.buildIdentity?.sha256 ?? "")
  ) {
    throw new Error(
      "native manifest Batch 7 source or toolchain identity does not match the build identity"
    );
  }
  return "available";
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

/**
 * Exercises the Main-only app-state durability ABI. This intentionally uses a separate temporary
 * state root and never makes that root available to the workspace or Provider probe surface.
 */
export async function probeEngineeringStateDurabilityAbi(addon) {
  for (const name of [
    "openEngineeringStateRoot",
    "closeEngineeringStateRoot",
    "ensureEngineeringStateDirectoryNoFollow",
    "flushEngineeringStateDirectory",
    "openEngineeringStateExclusiveNoFollow",
    "writeEngineeringStateFile",
    "syncEngineeringStateFile",
    "closeEngineeringStateFile",
    "readEngineeringStateFileNoFollow",
    "readEngineeringStateDirectoryNoFollow",
    "linkEngineeringStateFileNoFollow",
    "renameReplaceEngineeringStateFileNoFollow",
    "unlinkEngineeringStateFileNoFollow"
  ]) {
    if (typeof addon?.[name] !== "function") {
      throw new Error(`Engineering state durability ABI must expose ${name}`);
    }
  }
  const stateRoot = await mkdtemp(join(tmpdir(), "engineering-state-durability-probe-"));
  let stateRootId;
  try {
    stateRootId = addon.openEngineeringStateRoot(stateRoot);
    if (typeof stateRootId !== "bigint")
      throw new Error("state root did not return an opaque bigint handle");
    const directory = "engineering-v2/state";
    const temporary = `${directory}/record.tmp`;
    const created = `${directory}/record.created`;
    const target = `${directory}/record.json`;
    const first = Buffer.from("durable-first\n", "utf8");
    const second = Buffer.from("durable-second\n", "utf8");

    addon.ensureEngineeringStateDirectoryNoFollow(stateRootId, directory);
    addon.flushEngineeringStateDirectory(stateRootId, directory);
    const firstFile = addon.openEngineeringStateExclusiveNoFollow(stateRootId, temporary);
    addon.writeEngineeringStateFile(firstFile, first);
    addon.syncEngineeringStateFile(firstFile);
    addon.closeEngineeringStateFile(firstFile);
    addon.linkEngineeringStateFileNoFollow(stateRootId, temporary, created);
    addon.unlinkEngineeringStateFileNoFollow(stateRootId, temporary);
    addon.flushEngineeringStateDirectory(stateRootId, directory);
    assertExactNativeBytes(
      addon.readEngineeringStateFileNoFollow(stateRootId, created),
      first,
      "state create-only install"
    );

    const replacement = addon.openEngineeringStateExclusiveNoFollow(stateRootId, temporary);
    addon.writeEngineeringStateFile(replacement, second);
    addon.syncEngineeringStateFile(replacement);
    addon.closeEngineeringStateFile(replacement);
    addon.renameReplaceEngineeringStateFileNoFollow(stateRootId, temporary, target);
    addon.flushEngineeringStateDirectory(stateRootId, directory);
    assertExactNativeBytes(
      addon.readEngineeringStateFileNoFollow(stateRootId, target),
      second,
      "state replace install"
    );
    const entries = addon.readEngineeringStateDirectoryNoFollow(stateRootId, directory);
    if (
      !Array.isArray(entries) ||
      !entries.some((entry) => entry?.name === "record.created" && entry.kind === "file") ||
      !entries.some((entry) => entry?.name === "record.json" && entry.kind === "file")
    ) {
      throw new Error("state durability directory listing did not return installed regular files");
    }
    addon.unlinkEngineeringStateFileNoFollow(stateRootId, created);
    addon.unlinkEngineeringStateFileNoFollow(stateRootId, target);
    addon.flushEngineeringStateDirectory(stateRootId, directory);
    return {
      status: "passed",
      noFollowDirectory: "passed",
      exclusiveWriteAndFlush: "passed",
      createOnlyHardLinkInstall: "passed",
      atomicReplaceRename: "passed",
      noFollowReadAndList: "passed",
      unlinkAndDirectoryFlush: "passed"
    };
  } finally {
    if (typeof stateRootId === "bigint")
      await Promise.resolve(addon.closeEngineeringStateRoot(stateRootId));
    await rm(stateRoot, { recursive: true, force: true, maxRetries: 3 });
  }
}

/**
 * Runs the B8 native primitive probe on the same loaded addon and root-handle session as B6/B7.
 * It is diagnostic evidence for CI only: an unsigned development manifest continues to advertise
 * product mutation and recovery as unavailable until Main accepts signed qualification evidence.
 */
export async function probeMutationV2Abi(addon) {
  const baseExports = [
    "mutationV2ProbeInfo",
    "inspectEngineeringFileSnapshotV2",
    "inspectEngineeringFileMutationTargetV2",
    "observeCreateAbsenceV2",
    "applyEngineeringFileMutationV2",
    "prepareMutationWalV2",
    "observeCreateAbsence",
    "replaceFileV2",
    "createFileV2",
    "scanMutationRecovery",
    "mutationV2FaultProbe"
  ];
  const lifecycleExports = [
    "openEngineeringRecoveryRootV2",
    "closeEngineeringRecoveryRootV2",
    "openEngineeringStateRootBoundToRecoveryV2",
    "inspectEngineeringRecoveryRootCapacityV2",
    "inspectEngineeringQuarantineV2",
    "moveEngineeringPathV2",
    "quarantineEngineeringFileV2",
    "restoreEngineeringFileV2",
    "purgeEngineeringQuarantineObjectV2",
    "createEngineeringDirectoryV2",
    "inspectEngineeringFileLifecycleOperationV2",
    "resumeEngineeringFileLifecycleOperationV2",
    "compensateEngineeringFileLifecycleOperationV2",
    "finalizeEngineeringFileLifecycleOperationV2"
  ];
  const hasLifecycleExports = lifecycleExports.every((name) => typeof addon?.[name] === "function");
  const hasPartialLifecycleExports = lifecycleExports.some(
    (name) => typeof addon?.[name] === "function"
  );
  for (const name of baseExports) {
    if (typeof addon?.[name] !== "function") {
      throw new Error(`available Batch 7 native probe must expose ${name}`);
    }
  }
  if (hasPartialLifecycleExports && !hasLifecycleExports) {
    throw new Error("Batch 8 lifecycle addon export surface is incomplete");
  }
  const probeInfo = addon.mutationV2ProbeInfo();
  assertMutationV2ProbeInfo(probeInfo);
  assertMutationV2FaultProbe(addon.mutationV2FaultProbe(), probeInfo.batch);
  const isBatch8 = probeInfo.batch === "8";

  const fixtureParent = await mkdtemp(join(tmpdir(), "engineering-file-mutation-v2-probe-"));
  const workspace = join(fixtureParent, "workspace");
  const docs = join(workspace, "docs");
  const recoveryRoot = join(fixtureParent, "recovery");
  const hardLinkPath = join(docs, "hard-link.txt");
  const stalePath = join(docs, "stale-create.txt");
  const stagedFaultPath = join(docs, ".novel-studio-stage-probe-orphan");
  const handoffFaultPaths = [
    join(docs, ".novel-studio-stage-probe-after-original-handoff"),
    join(docs, ".novel-studio-stage-probe-before-candidate-handoff"),
    join(docs, ".novel-studio-stage-probe-after-candidate-handoff")
  ];
  let openedRoot;
  try {
    await Promise.all([mkdir(docs, { recursive: true }), mkdir(recoveryRoot)]);
    const recoveryMarker = Buffer.from("Novel Studio Engineering recovery owner v1\n", "utf8");
    await writeFile(join(recoveryRoot, ".novel-studio-recovery-owner-v1"), recoveryMarker, {
      flush: true
    });
    const recoveryMarkerChecksum = createHash("sha256").update(recoveryMarker).digest("hex");
    const before = Buffer.from("B7 before bytes: \u4f60\u597d, caf\u00e9, \ud83d\ude00\n", "utf8");
    const candidate = Buffer.from(
      "B7 candidate bytes: \u4f60\u597d, caf\u00e9, \ud83d\ude00\n",
      "utf8"
    );
    const created = Buffer.from(
      "B7 created bytes: \u4f60\u597d, caf\u00e9, \ud83d\ude00\n",
      "utf8"
    );
    await writeFile(join(workspace, ordinaryRelativePath), before, { flush: true });
    openedRoot = addon.openWorkspaceRoot(workspace);
    if (!openedRoot || typeof openedRoot.rootId !== "bigint") {
      throw new Error("Batch 7 native probe could not obtain the existing B6 root-handle session");
    }
    const rootId = openedRoot.rootId;
    const initialRecovery = addon.scanMutationRecovery(rootId);
    assertRecoveryScan(initialRecovery, "clear");
    if (isBatch8) {
      const lifecycleBytes = Buffer.from("B8 lifecycle bytes\n", "utf8");
      await writeFile(join(docs, "move-source.txt"), lifecycleBytes, { flush: true });
      const lifecycleSnapshot = addon.inspectEngineeringFileSnapshotV2(
        rootId,
        "docs/move-source.txt"
      );
      const lifecycleBase = {
        schemaVersion: "3.0",
        transactionId: "tx-b8-lifecycle",
        operationId: "op-b8-lifecycle",
        contentRootBindingId: "root:probe-v2",
        sourceFileIdentity: lifecycleSnapshot.manifest.fileIdentity,
        sourceSha256: lifecycleSnapshot.manifest.sha256,
        recoveryRootBindingId: "recovery:probe-v2",
        recoveryGrantRevision: "grant:probe-v2",
        recoverySideEffectChecksum: "b".repeat(64),
        recoveryObjectId: "quarantine-probe-v2",
        stagingObjectId: "stage-b8-lifecycle",
        expectedState: "wal_prepared"
      };
      const createDirectoryRequest = {
        ...lifecycleBase,
        operationKind: "create_directory",
        relativeSource: "",
        relativeTarget: "docs/lifecycle",
        sourceFileIdentity: "",
        sourceSha256: "0".repeat(64),
        targetProof: "absent"
      };
      addon.createEngineeringDirectoryV2(rootId, createDirectoryRequest);
      assertLifecycleOperationState(
        addon.inspectEngineeringFileLifecycleOperationV2(rootId, 0n, createDirectoryRequest),
        createDirectoryRequest,
        "after"
      );
      addon.finalizeEngineeringFileLifecycleOperationV2(
        rootId,
        0n,
        createDirectoryRequest,
        "after"
      );
      const moveRequest = {
        ...lifecycleBase,
        operationKind: "move_file",
        relativeSource: "docs/move-source.txt",
        relativeTarget: "docs/lifecycle/moved.txt",
        targetProof: "absent"
      };
      addon.moveEngineeringPathV2(rootId, moveRequest);
      assertLifecycleOperationState(
        addon.inspectEngineeringFileLifecycleOperationV2(rootId, 0n, moveRequest),
        moveRequest,
        "after"
      );
      addon.finalizeEngineeringFileLifecycleOperationV2(rootId, 0n, moveRequest, "after");
      addon.finalizeEngineeringFileLifecycleOperationV2(rootId, 0n, moveRequest, "after");
      assertExactNativeBytes(
        addon.readFile(rootId, "docs/lifecycle/moved.txt"),
        lifecycleBytes,
        "B8 move"
      );
      const movedSnapshot = addon.inspectEngineeringFileSnapshotV2(
        rootId,
        "docs/lifecycle/moved.txt"
      );
      const caseOnlyRequest = {
        ...lifecycleBase,
        operationId: "op-b8-case-only",
        stagingObjectId: "stage-b8-case-only",
        operationKind: "move_file",
        relativeSource: "docs/lifecycle/moved.txt",
        relativeTarget: "docs/lifecycle/Moved.txt",
        sourceFileIdentity: movedSnapshot.manifest.fileIdentity,
        sourceSha256: movedSnapshot.manifest.sha256,
        targetProof: "same_object_case_only"
      };
      addon.moveEngineeringPathV2(rootId, caseOnlyRequest);
      assertLifecycleOperationState(
        addon.inspectEngineeringFileLifecycleOperationV2(rootId, 0n, caseOnlyRequest),
        caseOnlyRequest,
        "after"
      );
      assertLifecycleOperationState(
        addon.resumeEngineeringFileLifecycleOperationV2(rootId, 0n, caseOnlyRequest),
        caseOnlyRequest,
        "after"
      );
      addon.finalizeEngineeringFileLifecycleOperationV2(rootId, 0n, caseOnlyRequest, "after");
      assertExactNativeBytes(
        addon.readFile(rootId, "docs/lifecycle/Moved.txt"),
        lifecycleBytes,
        "B8 case-only move"
      );
      assertRecoveryScan(addon.scanMutationRecovery(rootId), "clear");
      const caseOnlySnapshot = addon.inspectEngineeringFileSnapshotV2(
        rootId,
        "docs/lifecycle/Moved.txt"
      );
      await expectMutationFailure(
        () =>
          addon.openEngineeringRecoveryRootV2(
            rootId,
            recoveryRoot,
            lifecycleBase.recoveryRootBindingId,
            lifecycleBase.recoveryGrantRevision,
            "d".repeat(64)
          ),
        "recovery ownership marker mismatch"
      );
      const recoveryBinding = addon.openEngineeringRecoveryRootV2(
        rootId,
        recoveryRoot,
        lifecycleBase.recoveryRootBindingId,
        lifecycleBase.recoveryGrantRevision,
        recoveryMarkerChecksum
      );
      try {
        const recoveryCapacity = addon.inspectEngineeringRecoveryRootCapacityV2(
          recoveryBinding.recoveryRootId
        );
        if (
          typeof recoveryCapacity?.capacityBytes !== "bigint" ||
          typeof recoveryCapacity?.reservedBytes !== "bigint" ||
          recoveryCapacity.capacityBytes <= 0n ||
          recoveryCapacity.reservedBytes < 0n ||
          recoveryCapacity.reservedBytes > recoveryCapacity.capacityBytes
        ) {
          throw new Error("Batch 8 recovery capacity evidence is invalid");
        }
        const recoveryStateRootId = addon.openEngineeringStateRootBoundToRecoveryV2(
          recoveryBinding.recoveryRootId
        );
        try {
          const manifestDirectory = ".novel-studio-engineering-v2/volume-local-manifests";
          addon.ensureEngineeringStateDirectoryNoFollow(recoveryStateRootId, manifestDirectory);
          const manifestFile = `${manifestDirectory}/probe.tmp`;
          const manifestFileId = addon.openEngineeringStateExclusiveNoFollow(
            recoveryStateRootId,
            manifestFile
          );
          addon.writeEngineeringStateFile(
            manifestFileId,
            Buffer.from("volume-local manifest probe\n", "utf8")
          );
          addon.syncEngineeringStateFile(manifestFileId);
          addon.closeEngineeringStateFile(manifestFileId);
          addon.flushEngineeringStateDirectory(recoveryStateRootId, manifestDirectory);
        } finally {
          addon.closeEngineeringStateRoot(recoveryStateRootId);
        }
        const quarantineRequest = {
          ...lifecycleBase,
          operationKind: "delete_file",
          relativeSource: "docs/lifecycle/Moved.txt",
          relativeTarget: "",
          sourceFileIdentity: caseOnlySnapshot.manifest.fileIdentity,
          sourceSha256: caseOnlySnapshot.manifest.sha256,
          targetProof: "absent"
        };
        addon.quarantineEngineeringFileV2(
          rootId,
          recoveryBinding.recoveryRootId,
          quarantineRequest
        );
        assertLifecycleOperationState(
          addon.inspectEngineeringFileLifecycleOperationV2(
            rootId,
            recoveryBinding.recoveryRootId,
            quarantineRequest
          ),
          quarantineRequest,
          "after"
        );
        assertQuarantineInventory(
          addon.inspectEngineeringQuarantineV2(recoveryBinding.recoveryRootId),
          lifecycleBase.recoveryRootBindingId,
          lifecycleBase.recoveryGrantRevision,
          [lifecycleBase.recoveryObjectId]
        );
        addon.finalizeEngineeringFileLifecycleOperationV2(
          rootId,
          recoveryBinding.recoveryRootId,
          quarantineRequest,
          "after"
        );
        addon.restoreEngineeringFileV2(rootId, recoveryBinding.recoveryRootId, {
          ...lifecycleBase,
          operationKind: "restore_file",
          relativeSource: "",
          relativeTarget: "docs/lifecycle/Moved.txt",
          targetProof: "absent"
        });
        assertQuarantineInventory(
          addon.inspectEngineeringQuarantineV2(recoveryBinding.recoveryRootId),
          lifecycleBase.recoveryRootBindingId,
          lifecycleBase.recoveryGrantRevision,
          []
        );
        assertExactNativeBytes(
          addon.readFile(rootId, "docs/lifecycle/Moved.txt"),
          lifecycleBytes,
          "B8 restore"
        );
        const restored = addon.inspectEngineeringFileSnapshotV2(rootId, "docs/lifecycle/Moved.txt");
        const purgeRequest = {
          ...lifecycleBase,
          operationId: "op-b8-purge-source",
          stagingObjectId: "stage-b8-purge-source",
          operationKind: "delete_file",
          relativeSource: "docs/lifecycle/Moved.txt",
          relativeTarget: "",
          sourceFileIdentity: restored.manifest.fileIdentity,
          sourceSha256: restored.manifest.sha256,
          targetProof: "absent"
        };
        addon.quarantineEngineeringFileV2(rootId, recoveryBinding.recoveryRootId, purgeRequest);
        assertLifecycleOperationState(
          addon.inspectEngineeringFileLifecycleOperationV2(
            rootId,
            recoveryBinding.recoveryRootId,
            purgeRequest
          ),
          purgeRequest,
          "after"
        );
        addon.finalizeEngineeringFileLifecycleOperationV2(
          rootId,
          recoveryBinding.recoveryRootId,
          purgeRequest,
          "after"
        );
        addon.purgeEngineeringQuarantineObjectV2(
          recoveryBinding.recoveryRootId,
          lifecycleBase.recoveryObjectId
        );
        assertQuarantineInventory(
          addon.inspectEngineeringQuarantineV2(recoveryBinding.recoveryRootId),
          lifecycleBase.recoveryRootBindingId,
          lifecycleBase.recoveryGrantRevision,
          []
        );
      } finally {
        addon.closeEngineeringRecoveryRootV2(recoveryBinding.recoveryRootId);
      }
      await writeFile(join(docs, "compensate-source.txt"), lifecycleBytes, { flush: true });
      const compensationSnapshot = addon.inspectEngineeringFileSnapshotV2(
        rootId,
        "docs/compensate-source.txt"
      );
      const compensationRequest = {
        ...lifecycleBase,
        operationId: "op-b8-compensate",
        stagingObjectId: "stage-b8-compensate",
        operationKind: "move_file",
        relativeSource: "docs/compensate-source.txt",
        relativeTarget: "docs/lifecycle/compensate-target.txt",
        sourceFileIdentity: compensationSnapshot.manifest.fileIdentity,
        sourceSha256: compensationSnapshot.manifest.sha256,
        targetProof: "absent"
      };
      const compensationReceipt = addon.moveEngineeringPathV2(rootId, compensationRequest);
      assertLifecycleOperationState(
        addon.compensateEngineeringFileLifecycleOperationV2(
          rootId,
          0n,
          compensationRequest,
          compensationReceipt
        ),
        compensationRequest,
        "before"
      );
      assertExactNativeBytes(
        addon.readFile(rootId, "docs/compensate-source.txt"),
        lifecycleBytes,
        "B8 lifecycle compensation"
      );
      assertRecoveryScan(addon.scanMutationRecovery(rootId), "clear");
    }

    const replaceWal = addon.prepareMutationWalV2(
      rootId,
      "tx-replace-v2",
      "op-replace-v2",
      "stage-replace-v2",
      "2.0"
    );
    assertWalBinding(replaceWal);
    const replaceReceipt = addon.replaceFileV2(
      rootId,
      ordinaryRelativePath,
      "tx-replace-v2",
      "op-replace-v2",
      "stage-replace-v2",
      replaceWal.walBindingId,
      before,
      rawByteManifest(before),
      candidate,
      rawByteManifest(candidate)
    );
    assertMutationReceipt(replaceReceipt, {
      operation: "replace",
      transactionId: "tx-replace-v2",
      operationId: "op-replace-v2",
      before,
      after: candidate,
      metadataPolicy: "qualified_basic_metadata"
    });
    assertExactNativeBytes(addon.readFile(rootId, ordinaryRelativePath), candidate, "replace");
    assertRecoveryScan(addon.scanMutationRecovery(rootId), "clear");

    const absence = addon.observeCreateAbsence(rootId, "docs", "created-utf8.txt");
    if (!absence || absence.state !== "absent" || typeof absence.proofId !== "bigint") {
      throw new Error("Batch 7 create did not issue a native in-memory absence proof");
    }
    const createWal = addon.prepareMutationWalV2(
      rootId,
      "tx-create-v2",
      "op-create-v2",
      "stage-create-v2",
      "2.0"
    );
    const createReceipt = addon.createFileV2(
      rootId,
      "docs",
      "created-utf8.txt",
      absence.proofId,
      "tx-create-v2",
      "op-create-v2",
      "stage-create-v2",
      createWal.walBindingId,
      created,
      rawByteManifest(created)
    );
    assertMutationReceipt(createReceipt, {
      operation: "create",
      transactionId: "tx-create-v2",
      operationId: "op-create-v2",
      before: null,
      after: created,
      metadataPolicy: "fixed_windows_metadata"
    });
    assertExactNativeBytes(addon.readFile(rootId, "docs/created-utf8.txt"), created, "create");

    const objectRootBindingId = "root:probe-v2";
    const objectRelativePath = "docs/object-mutation-v2.txt";
    const objectCreateRelativePath = "docs/object-created-v2.txt";
    const objectStaleRelativePath = "docs/object-stale-v2.txt";
    const objectStaleReplaceRelativePath = "docs/object-stale-replace-v2.txt";
    const objectBefore = Buffer.from("B7 V2 before bytes: 你好\r\n", "utf8");
    const objectCandidate = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from("B7 V2 candidate\u0000bytes: café\r\n", "utf8")
    ]);
    const objectCreated = Buffer.from("B7 V2 created bytes: 😀\n", "utf8");
    await writeFile(join(workspace, objectRelativePath), objectBefore, { flush: true });
    const objectSnapshot = addon.inspectEngineeringFileSnapshotV2(rootId, objectRelativePath);
    const objectBeforeManifest = assertV2PresentTargetSnapshot(
      objectSnapshot,
      rootId,
      objectRootBindingId,
      objectRelativePath,
      objectBefore
    );
    const objectCandidateManifest = createV2TargetManifest(
      objectRootBindingId,
      objectRelativePath,
      objectCandidate,
      objectBeforeManifest.metadataChecksum
    );
    const objectReplaceRequest = createV2ReplaceRequest({
      rootBindingId: objectRootBindingId,
      relativeIdentity: objectRelativePath,
      transactionId: "tx:object-v2",
      operationId: "op/object-v2",
      stagingObjectId: "stage:object-v2",
      beforeManifest: objectBeforeManifest,
      candidateManifest: objectCandidateManifest
    });
    assertV2MutationOperationState(
      addon.inspectEngineeringFileMutationTargetV2(
        rootId,
        objectReplaceRequest,
        objectBefore,
        objectCandidate
      ),
      objectReplaceRequest,
      "before",
      objectCandidateManifest
    );
    await expectMutationFailure(
      () =>
        addon.applyEngineeringFileMutationV2(
          rootId,
          {
            ...objectReplaceRequest,
            candidate: {
              ...objectReplaceRequest.candidate,
              manifest: { ...objectCandidateManifest, sha256: "0".repeat(64) }
            }
          },
          objectBefore,
          objectCandidate
        ),
      "V2 raw-byte manifest mismatch"
    );
    const objectReplaceReceipt = addon.applyEngineeringFileMutationV2(
      rootId,
      objectReplaceRequest,
      objectBefore,
      objectCandidate
    );
    assertV2MutationReceipt(objectReplaceReceipt, objectReplaceRequest, objectCandidateManifest);
    assertExactNativeBytes(
      await readFile(join(workspace, objectRelativePath)),
      objectCandidate,
      "V2 replace"
    );
    assertRecoveryScan(addon.scanMutationRecovery(rootId), "clear");
    assertV2MutationOperationState(
      addon.inspectEngineeringFileMutationTargetV2(
        rootId,
        objectReplaceRequest,
        objectBefore,
        objectCandidate
      ),
      objectReplaceRequest,
      "after",
      objectCandidateManifest
    );

    const objectAbsentSnapshot = addon.inspectEngineeringFileSnapshotV2(
      rootId,
      objectCreateRelativePath
    );
    assertV2AbsentTargetSnapshot(objectAbsentSnapshot, rootId, objectCreateRelativePath);
    const objectAbsenceProof = addon.observeCreateAbsenceV2(
      rootId,
      objectRootBindingId,
      objectCreateRelativePath,
      "2030-01-02T03:04:05.000Z"
    );
    assertV2AbsenceProof(objectAbsenceProof, objectRootBindingId, objectCreateRelativePath);
    const objectCreateRequest = createV2CreateRequest({
      rootBindingId: objectRootBindingId,
      relativeIdentity: objectCreateRelativePath,
      transactionId: "tx:create-v2",
      operationId: "op/create-v2",
      stagingObjectId: "stage:create-v2",
      absenceProof: objectAbsenceProof,
      candidateManifest: createV2TargetManifest(
        objectRootBindingId,
        objectCreateRelativePath,
        objectCreated,
        metadataChecksumForAttributes(128)
      )
    });
    assertV2MutationOperationState(
      addon.inspectEngineeringFileMutationTargetV2(
        rootId,
        objectCreateRequest,
        null,
        objectCreated
      ),
      objectCreateRequest,
      "before",
      objectCreateRequest.candidate.manifest
    );
    const objectCreateReceipt = addon.applyEngineeringFileMutationV2(
      rootId,
      objectCreateRequest,
      null,
      objectCreated
    );
    assertV2MutationReceipt(
      objectCreateReceipt,
      objectCreateRequest,
      objectCreateRequest.candidate.manifest
    );
    assertExactNativeBytes(
      await readFile(join(workspace, objectCreateRelativePath)),
      objectCreated,
      "V2 create"
    );
    assertV2MutationOperationState(
      addon.inspectEngineeringFileMutationTargetV2(
        rootId,
        objectCreateRequest,
        null,
        objectCreated
      ),
      objectCreateRequest,
      "after",
      objectCreateRequest.candidate.manifest
    );

    const objectStaleReplaceBefore = Buffer.from("B7 V2 stale replace before\r\n", "utf8");
    const objectStaleReplaceCandidate = Buffer.from("B7 V2 stale replace candidate\r\n", "utf8");
    await writeFile(join(workspace, objectStaleReplaceRelativePath), objectStaleReplaceBefore, {
      flush: true
    });
    const objectStaleReplaceSnapshot = addon.inspectEngineeringFileSnapshotV2(
      rootId,
      objectStaleReplaceRelativePath
    );
    const objectStaleReplaceBeforeManifest = assertV2PresentTargetSnapshot(
      objectStaleReplaceSnapshot,
      rootId,
      objectRootBindingId,
      objectStaleReplaceRelativePath,
      objectStaleReplaceBefore
    );
    const objectStaleReplaceRequest = createV2ReplaceRequest({
      rootBindingId: objectRootBindingId,
      relativeIdentity: objectStaleReplaceRelativePath,
      transactionId: "tx:stale-replace-v2",
      operationId: "op/stale-replace-v2",
      stagingObjectId: "stage:stale-replace-v2",
      beforeManifest: objectStaleReplaceBeforeManifest,
      candidateManifest: createV2TargetManifest(
        objectRootBindingId,
        objectStaleReplaceRelativePath,
        objectStaleReplaceCandidate,
        objectStaleReplaceBeforeManifest.metadataChecksum
      )
    });
    await writeFile(
      join(workspace, objectStaleReplaceRelativePath),
      "external V2 replace race\r\n",
      { encoding: "utf8", flush: true }
    );
    assertV2MutationOperationState(
      addon.inspectEngineeringFileMutationTargetV2(
        rootId,
        objectStaleReplaceRequest,
        objectStaleReplaceBefore,
        objectStaleReplaceCandidate
      ),
      objectStaleReplaceRequest,
      "neither",
      objectStaleReplaceRequest.candidate.manifest
    );
    await expectMutationFailure(
      () =>
        addon.applyEngineeringFileMutationV2(
          rootId,
          objectStaleReplaceRequest,
          objectStaleReplaceBefore,
          objectStaleReplaceCandidate
        ),
      "V2 stale replace base"
    );

    const staleV2Proof = addon.observeCreateAbsenceV2(
      rootId,
      objectRootBindingId,
      objectStaleRelativePath,
      "2030-01-02T03:04:06.000Z"
    );
    await writeFile(join(workspace, objectStaleRelativePath), "external V2 create race\n", {
      encoding: "utf8",
      flush: true
    });
    const staleV2Request = createV2CreateRequest({
      rootBindingId: objectRootBindingId,
      relativeIdentity: objectStaleRelativePath,
      transactionId: "tx:stale-v2",
      operationId: "op/stale-v2",
      stagingObjectId: "stage:stale-v2",
      absenceProof: staleV2Proof,
      candidateManifest: createV2TargetManifest(
        objectRootBindingId,
        objectStaleRelativePath,
        objectCreated,
        metadataChecksumForAttributes(128)
      )
    });
    assertV2MutationOperationState(
      addon.inspectEngineeringFileMutationTargetV2(rootId, staleV2Request, null, objectCreated),
      staleV2Request,
      "neither",
      staleV2Request.candidate.manifest
    );
    await expectMutationFailure(
      () => addon.applyEngineeringFileMutationV2(rootId, staleV2Request, null, objectCreated),
      "V2 stale absence proof"
    );

    const mismatchWal = addon.prepareMutationWalV2(
      rootId,
      "tx-mismatch-v2",
      "op-mismatch-v2",
      "stage-mismatch-v2",
      "2.0"
    );
    const candidateManifest = rawByteManifest(candidate);
    await expectMutationFailure(
      () =>
        addon.replaceFileV2(
          rootId,
          ordinaryRelativePath,
          "tx-mismatch-v2",
          "op-mismatch-v2",
          "stage-mismatch-v2",
          mismatchWal.walBindingId,
          candidate,
          rawByteManifest(candidate),
          candidate,
          { ...candidateManifest, sha256: "0".repeat(64) }
        ),
      "raw-byte manifest mismatch"
    );

    const walMismatch = addon.prepareMutationWalV2(
      rootId,
      "tx-bound-v2",
      "op-bound-v2",
      "stage-bound-v2",
      "2.0"
    );
    await expectMutationFailure(
      () =>
        addon.replaceFileV2(
          rootId,
          ordinaryRelativePath,
          "tx-other-v2",
          "op-bound-v2",
          "stage-bound-v2",
          walMismatch.walBindingId,
          candidate,
          rawByteManifest(candidate),
          candidate,
          rawByteManifest(candidate)
        ),
      "WAL binding mismatch"
    );

    await link(join(workspace, ordinaryRelativePath), hardLinkPath);
    const hardLinkBefore = await readFile(hardLinkPath);
    const hardLinkWal = addon.prepareMutationWalV2(
      rootId,
      "tx-hard-link-v2",
      "op-hard-link-v2",
      "stage-hard-link-v2",
      "2.0"
    );
    await expectMutationFailure(
      () =>
        addon.replaceFileV2(
          rootId,
          "docs/hard-link.txt",
          "tx-hard-link-v2",
          "op-hard-link-v2",
          "stage-hard-link-v2",
          hardLinkWal.walBindingId,
          hardLinkBefore,
          rawByteManifest(hardLinkBefore),
          candidate,
          rawByteManifest(candidate)
        ),
      "multiple hard-link leaf"
    );

    const staleAbsence = addon.observeCreateAbsence(rootId, "docs", "stale-create.txt");
    const staleWal = addon.prepareMutationWalV2(
      rootId,
      "tx-stale-v2",
      "op-stale-v2",
      "stage-stale-v2",
      "2.0"
    );
    await writeFile(stalePath, "external destination race\n", { encoding: "utf8", flush: true });
    await expectMutationFailure(
      () =>
        addon.createFileV2(
          rootId,
          "docs",
          "stale-create.txt",
          staleAbsence.proofId,
          "tx-stale-v2",
          "op-stale-v2",
          "stage-stale-v2",
          staleWal.walBindingId,
          created,
          rawByteManifest(created)
        ),
      "stale absence proof"
    );

    await Promise.all([
      writeFile(stagedFaultPath, candidate, { flush: true }),
      ...handoffFaultPaths.map((path) => writeFile(path, candidate, { flush: true }))
    ]);
    const recovery = addon.scanMutationRecovery(rootId);
    assertRecoveryScan(recovery, "recovery_required");
    if (recovery.pendingStagingCount < BigInt(handoffFaultPaths.length + 1)) {
      throw new Error("Batch 7 handoff fault stages were not all visible to native recovery");
    }
    return {
      status: "passed",
      objectReplace: "passed",
      objectCreate: "passed",
      objectReceiptBinding: "passed",
      walPreparation: "passed",
      recoveryScan: "passed",
      rawByteCandidateBefore: "passed",
      absenceProof: "passed",
      absenceProofV2: "passed",
      objectMutationAbi: "passed",
      targetInspection: "passed",
      operationStateReconciliation: "passed",
      handleRelativeRevalidation: "passed",
      finalRenameNamespaceRevalidation: "passed",
      handleBoundReplaceHandoff: "passed",
      hardLinkRejection: "passed",
      copyOnReplaceSafety: "passed",
      fixedCreateMetadata: "passed",
      receiptDurability: "passed",
      stagingWalRecoveryScan: "passed",
      recoveryBeforeCleanup: "passed",
      ...(isBatch8
        ? {
            lifecycleCreateDirectory: "passed",
            lifecycleMove: "passed",
            lifecycleCaseOnlyMove: "passed",
            lifecycleQuarantine: "passed",
            lifecycleRestore: "passed",
            lifecyclePurge: "passed",
            lifecycleRecoveryInspection: "passed",
            lifecycleIntermediateResume: "passed",
            lifecycleRecoveryBoundStateDurability: "passed",
            lifecycleReverseCompensation: "passed",
            lifecycleDurableFinalize: "passed",
            lifecycleQuarantineInventory: "passed"
          }
        : {}),
      negativeCanaries: {
        rawByteManifestMismatch: "canary_exposed",
        walBindingMismatch: "canary_exposed",
        hardLinkLeaf: "canary_exposed",
        staleAbsenceProof: "canary_exposed",
        v2RawByteManifestMismatch: "canary_exposed",
        v2StaleAbsenceProof: "canary_exposed",
        objectV2RawByteManifestMismatch: "canary_exposed",
        objectV2StaleBase: "canary_exposed",
        objectV2CreateRace: "canary_exposed",
        objectV2FaultRecoveryRequired: "canary_exposed",
        replaceFinalRenameNamespaceRevalidation: "canary_exposed",
        targetSwapFinalWindowNoOverwrite: "canary_exposed",
        createOnlyHandoffCollisionRecoveryRequired: "canary_exposed"
      },
      faultProbe: {
        nativeExport: "passed",
        orphanStagingRecoveryRequired: "canary_exposed",
        replaceFinalRenameNamespaceRevalidation: "canary_exposed",
        afterOriginalHandoffRecoveryRequired: "canary_exposed",
        beforeCandidateHandoffRecoveryRequired: "canary_exposed",
        afterCandidateHandoffRecoveryRequired: "canary_exposed"
      }
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

async function expectMutationFailure(run, label) {
  try {
    await Promise.resolve(run());
  } catch {
    return;
  }
  throw new Error(`Batch 7 native mutation unexpectedly accepted ${label}`);
}

function rawV2ByteFields(bytes) {
  const value = Buffer.from(bytes);
  const hasUtf8Bom =
    value.byteLength >= 3 && value[0] === 0xef && value[1] === 0xbb && value[2] === 0xbf;
  let sawLf = false;
  let sawCrLf = false;
  let sawBareCr = false;
  for (let index = 0; index < value.byteLength; index += 1) {
    if (value[index] === 0x0d) {
      if (index + 1 < value.byteLength && value[index + 1] === 0x0a) {
        sawCrLf = true;
        index += 1;
      } else {
        sawBareCr = true;
      }
    } else if (value[index] === 0x0a) {
      sawLf = true;
    }
  }
  const eol =
    !sawLf && !sawCrLf && !sawBareCr
      ? "none"
      : sawCrLf && !sawLf && !sawBareCr
        ? "crlf"
        : sawLf && !sawCrLf && !sawBareCr
          ? "lf"
          : "mixed";
  return {
    sha256: createHash("sha256").update(value).digest("hex"),
    byteLength: value.byteLength,
    encoding: "utf-8",
    bom: hasUtf8Bom ? "utf-8" : "none",
    eol
  };
}

function metadataChecksumForAttributes(attributes) {
  return sha256(`engineering_file_metadata_v2\nattributes=${attributes}`);
}

function createV2TargetManifest(rootBindingId, relativeIdentity, bytes, metadataChecksum) {
  return {
    schemaVersion: "2.0",
    identity: {
      kind: "target",
      rootBindingId,
      relativeIdentity,
      fileIdentity: null
    },
    ...rawV2ByteFields(bytes),
    metadataChecksum
  };
}

function createV2BlobReference(rootBindingId, manifest) {
  return {
    schemaVersion: "2.0",
    contentRootBindingId: rootBindingId,
    blobId: `blob_${manifest.sha256}`,
    storage: "main_owned_immutable_blob",
    sha256: manifest.sha256,
    byteLength: manifest.byteLength,
    encoding: manifest.encoding,
    bom: manifest.bom,
    eol: manifest.eol
  };
}

function assertV2PresentTargetSnapshot(
  snapshot,
  rootId,
  rootBindingId,
  relativeIdentity,
  expectedBytes
) {
  const expected = rawV2ByteFields(expectedBytes);
  if (
    !snapshot ||
    snapshot.schemaVersion !== "2.0" ||
    snapshot.kind !== "engineering_file_mutation_target_snapshot" ||
    snapshot.rootId !== rootId ||
    snapshot.relativeIdentity !== relativeIdentity ||
    snapshot.state !== "present" ||
    !Buffer.isBuffer(snapshot.bytes) ||
    !snapshot.bytes.equals(expectedBytes) ||
    !isStableV2Id(snapshot.parentDirectoryIdentity) ||
    !snapshot.manifest ||
    !isStableV2Id(snapshot.manifest.fileIdentity) ||
    snapshot.manifest.sha256 !== expected.sha256 ||
    snapshot.manifest.byteLength !== expected.byteLength ||
    snapshot.manifest.encoding !== expected.encoding ||
    snapshot.manifest.bom !== expected.bom ||
    snapshot.manifest.eol !== expected.eol ||
    !/^[a-f0-9]{64}$/u.test(snapshot.manifest.metadataChecksum ?? "")
  ) {
    throw new Error("Batch 7 V2 target inspection did not return a fresh raw-byte snapshot");
  }
  return {
    schemaVersion: "2.0",
    identity: {
      kind: "observed_file",
      rootBindingId,
      relativeIdentity,
      fileIdentity: snapshot.manifest.fileIdentity
    },
    ...expected,
    metadataChecksum: snapshot.manifest.metadataChecksum
  };
}

function assertV2AbsentTargetSnapshot(snapshot, rootId, relativeIdentity) {
  if (
    !snapshot ||
    snapshot.schemaVersion !== "2.0" ||
    snapshot.kind !== "engineering_file_mutation_target_snapshot" ||
    snapshot.rootId !== rootId ||
    snapshot.relativeIdentity !== relativeIdentity ||
    snapshot.state !== "absent" ||
    snapshot.bytes !== null ||
    snapshot.manifest !== null ||
    !isStableV2Id(snapshot.parentDirectoryIdentity)
  ) {
    throw new Error("Batch 7 V2 target inspection did not prove target absence");
  }
}

function assertV2AbsenceProof(proof, rootBindingId, relativeIdentity) {
  if (
    !proof ||
    Object.keys(proof).sort().join(",") !==
      "absenceProofChecksum,kind,observedAt,parentDirectoryIdentity,relativeIdentity,rootBindingId,schemaVersion" ||
    proof.schemaVersion !== "2.0" ||
    proof.kind !== "absence_proof" ||
    proof.rootBindingId !== rootBindingId ||
    proof.relativeIdentity !== relativeIdentity ||
    !isStableV2Id(proof.parentDirectoryIdentity) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(proof.observedAt ?? "") ||
    !/^[a-f0-9]{64}$/u.test(proof.absenceProofChecksum ?? "")
  ) {
    throw new Error("Batch 7 V2 absence observation did not return a repository-compatible proof");
  }
  const { absenceProofChecksum, ...unsigned } = proof;
  if (absenceProofChecksum !== sha256(stable(unsigned))) {
    throw new Error("Batch 7 V2 absence proof checksum was not bound to its observation");
  }
}

function createV2ReplaceRequest({
  rootBindingId,
  relativeIdentity,
  transactionId,
  operationId,
  stagingObjectId,
  beforeManifest,
  candidateManifest
}) {
  return {
    schemaVersion: "2.0",
    operationKind: "replace_file",
    contentRootBindingId: rootBindingId,
    transactionId,
    operationId,
    providerSemanticVersionSetChecksum: "a".repeat(64),
    relativeIdentity,
    before: {
      schemaVersion: "2.0",
      kind: "present",
      manifest: beforeManifest,
      blob: createV2BlobReference(rootBindingId, beforeManifest)
    },
    candidate: {
      schemaVersion: "2.0",
      manifest: candidateManifest,
      blob: createV2BlobReference(rootBindingId, candidateManifest)
    },
    stagingObjectId
  };
}

function createV2CreateRequest({
  rootBindingId,
  relativeIdentity,
  transactionId,
  operationId,
  stagingObjectId,
  absenceProof,
  candidateManifest
}) {
  return {
    schemaVersion: "2.0",
    operationKind: "create_file",
    contentRootBindingId: rootBindingId,
    transactionId,
    operationId,
    providerSemanticVersionSetChecksum: "a".repeat(64),
    relativeIdentity,
    before: {
      schemaVersion: "2.0",
      kind: "absent",
      absenceProof
    },
    candidate: {
      schemaVersion: "2.0",
      manifest: candidateManifest,
      blob: createV2BlobReference(rootBindingId, candidateManifest)
    },
    stagingObjectId
  };
}

function assertV2MutationReceipt(receipt, request, candidateManifest) {
  const expectedKeys = [
    "contentRootBindingId",
    "durability",
    "kind",
    "nativeReceiptChecksum",
    "observedAfter",
    "observedBefore",
    "operationId",
    "operationKind",
    "providerSemanticVersionSetChecksum",
    "recoveryObjectId",
    "relativeIdentity",
    "requestChecksum",
    "schemaVersion",
    "stagingObjectId",
    "transactionId"
  ];
  if (
    !receipt ||
    Object.keys(receipt).sort().join(",") !== expectedKeys.join(",") ||
    receipt.schemaVersion !== "2.0" ||
    receipt.kind !== "engineering_mutation_receipt" ||
    receipt.transactionId !== request.transactionId ||
    receipt.operationId !== request.operationId ||
    receipt.operationKind !== request.operationKind ||
    receipt.contentRootBindingId !== request.contentRootBindingId ||
    receipt.providerSemanticVersionSetChecksum !== request.providerSemanticVersionSetChecksum ||
    receipt.relativeIdentity !== request.relativeIdentity ||
    receipt.stagingObjectId !== request.stagingObjectId ||
    receipt.recoveryObjectId !== null ||
    receipt.durability !== "data_and_directory_flushed" ||
    receipt.requestChecksum !== sha256(stable(request)) ||
    stable(receipt.observedBefore) !== stable(request.before)
  ) {
    throw new Error("Batch 7 V2 receipt did not bind the exact prepared request");
  }
  const after = receipt.observedAfter;
  if (
    !after ||
    after.schemaVersion !== "2.0" ||
    after.identity?.kind !== "observed_file" ||
    after.identity.rootBindingId !== request.contentRootBindingId ||
    after.identity.relativeIdentity !== request.relativeIdentity ||
    !isStableV2Id(after.identity.fileIdentity) ||
    after.sha256 !== candidateManifest.sha256 ||
    after.byteLength !== candidateManifest.byteLength ||
    after.encoding !== "utf-8" ||
    after.bom !== candidateManifest.bom ||
    after.eol !== candidateManifest.eol ||
    after.metadataChecksum !== candidateManifest.metadataChecksum ||
    !/^[a-f0-9]{64}$/u.test(receipt.nativeReceiptChecksum ?? "")
  ) {
    throw new Error("Batch 7 V2 receipt did not prove the observed post-write state");
  }
  const { nativeReceiptChecksum, ...unsigned } = receipt;
  if (nativeReceiptChecksum !== sha256(stable(unsigned))) {
    throw new Error("Batch 7 V2 receipt checksum was not canonically bound");
  }
}

function assertV2MutationOperationState(state, request, expectedState, candidateManifest) {
  const expectedKeys = ["kind", "receipt", "requestChecksum", "schemaVersion", "state"];
  if (
    !state ||
    Object.keys(state).sort().join(",") !== expectedKeys.join(",") ||
    state.schemaVersion !== "2.0" ||
    state.kind !== "engineering_mutation_operation_state" ||
    state.state !== expectedState ||
    state.requestChecksum !== sha256(stable(request))
  ) {
    throw new Error("Batch 7 V2 recovery inspection did not return an exact operation state");
  }
  if (expectedState === "after") {
    assertV2MutationReceipt(state.receipt, request, candidateManifest);
  } else if (state.receipt !== null) {
    throw new Error("Batch 7 V2 non-after recovery state unexpectedly included a receipt");
  }
}

function isStableV2Id(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value);
}

function rawByteManifest(bytes) {
  const value = Buffer.from(bytes);
  const hasUtf8Bom =
    value.byteLength >= 3 && value[0] === 0xef && value[1] === 0xbb && value[2] === 0xbf;
  let sawLf = false;
  let sawCrLf = false;
  let sawBareCr = false;
  for (let index = 0; index < value.byteLength; index += 1) {
    if (value[index] === 0x0d) {
      if (index + 1 < value.byteLength && value[index + 1] === 0x0a) {
        sawCrLf = true;
        index += 1;
      } else {
        sawBareCr = true;
      }
    } else if (value[index] === 0x0a) {
      sawLf = true;
    }
  }
  const eol =
    !sawLf && !sawCrLf && !sawBareCr
      ? "none"
      : sawCrLf && !sawLf && !sawBareCr
        ? "crlf"
        : sawLf && !sawCrLf && !sawBareCr
          ? "lf"
          : "mixed";
  return {
    byteLength: BigInt(value.byteLength),
    sha256: createHash("sha256").update(value).digest("hex"),
    encoding: "utf8",
    bom: hasUtf8Bom ? "utf8" : "none",
    eol
  };
}

function assertExactNativeBytes(value, expected, operation) {
  if (!Buffer.isBuffer(value) || !value.equals(expected)) {
    throw new Error(`Batch 7 ${operation} did not preserve the exact raw candidate bytes`);
  }
}

function assertWalBinding(value) {
  if (
    !value ||
    typeof value !== "object" ||
    typeof value.walBindingId !== "bigint" ||
    !/^[a-f0-9]{64}$/u.test(value.bindingChecksum ?? "") ||
    value.protocol !== "v2_preallocated_binding" ||
    value.durabilityRequirement !== "caller_must_durable_flush_before_apply"
  ) {
    throw new Error("Batch 7 native mutation did not bind the preallocated WAL identity");
  }
}

function assertMutationReceipt(receipt, expected) {
  if (
    !receipt ||
    typeof receipt !== "object" ||
    receipt.schemaVersion !== "engineering_file_mutation_receipt_v1" ||
    receipt.operation !== expected.operation ||
    receipt.transactionId !== expected.transactionId ||
    receipt.operationId !== expected.operationId ||
    receipt.durability !== "data_and_directory_flushed" ||
    receipt.writeStrategy !== "same_directory_staging_rename" ||
    receipt.hardLinkPolicy !== "reject_multiple_links" ||
    receipt.metadataPolicy !== expected.metadataPolicy ||
    !/^[a-f0-9]{64}$/u.test(receipt.walBindingChecksum ?? "") ||
    !receipt.after ||
    receipt.after.sha256 !== rawByteManifest(expected.after).sha256
  ) {
    throw new Error("Batch 7 native mutation receipt was not bound to the observed durable write");
  }
  if (expected.before === null) {
    if (receipt.before !== null || receipt.beforeIdentity !== null) {
      throw new Error("Batch 7 create receipt unexpectedly claimed an existing before image");
    }
  } else if (
    !receipt.before ||
    receipt.before.sha256 !== rawByteManifest(expected.before).sha256 ||
    !receipt.beforeIdentity
  ) {
    throw new Error("Batch 7 replace receipt did not bind the exact before image");
  }
}

function assertRecoveryScan(value, expectedState) {
  if (
    !value ||
    typeof value !== "object" ||
    value.state !== expectedState ||
    typeof value.pendingStagingCount !== "bigint" ||
    typeof value.inProcessPendingWalCount !== "bigint" ||
    typeof value.scanTruncated !== "boolean" ||
    value.scanScope !== "native_staging_and_in_process_wal_only" ||
    value.durableWalRequirement !== "external_durable_wal_scan_required"
  ) {
    throw new Error("Batch 7 native recovery scan did not fail closed with its limited authority");
  }
}

function assertLifecycleOperationState(value, request, expectedState) {
  if (
    !value ||
    typeof value !== "object" ||
    value.schemaVersion !== "3.0" ||
    value.kind !== "engineering_file_lifecycle_operation_state" ||
    value.state !== expectedState ||
    value.requestChecksum !== sha256(stable(request)) ||
    (expectedState === "after"
      ? !value.receipt ||
        value.receipt.transactionId !== request.transactionId ||
        value.receipt.operationId !== request.operationId ||
        value.receipt.operationKind !== request.operationKind
      : value.receipt !== null)
  ) {
    throw new Error(`Batch 8 lifecycle state did not bind ${expectedState}`);
  }
}

function assertQuarantineInventory(value, bindingId, grantRevision, expectedObjectIds) {
  if (
    !value ||
    typeof value !== "object" ||
    value.schemaVersion !== "3.0" ||
    value.kind !== "engineering_quarantine_inventory" ||
    value.recoveryRootBindingId !== bindingId ||
    value.grantRevision !== grantRevision ||
    !Array.isArray(value.objects) ||
    value.objects.length !== expectedObjectIds.length ||
    !expectedObjectIds.every(
      (objectId, index) =>
        value.objects[index]?.recoveryObjectId === objectId &&
        typeof value.objects[index]?.fileIdentity === "string" &&
        typeof value.objects[index]?.sha256 === "string" &&
        typeof value.objects[index]?.byteLength === "bigint"
    )
  ) {
    throw new Error("Batch 8 quarantine inventory did not bind the physical recovery objects");
  }
}

function assertMutationV2ProbeInfo(value) {
  const expected = {
    schemaVersion: "engineering_file_mutation_probe_v1",
    status: "available",
    replace: "development_probe_only",
    create: "development_probe_only",
    rawByteBlobs: "available",
    absenceProof: "available",
    absenceProofV2: "available",
    objectMutationAbi: "available",
    targetInspection: "available",
    operationStateReconciliation: "available",
    handleRelativeRevalidation: "available",
    finalRenameNamespaceRevalidation: "available",
    handleBoundReplaceHandoff: "available",
    hardLinkPolicy: "reject_multiple_links",
    copyOnReplace: "not_enabled",
    fixedCreateMetadata: "available",
    receiptDurability: "available",
    stagingWalRecoveryScan: "available",
    stateDurability: "available",
    productCapability: "unavailable"
  };
  if (value?.batch !== "7" && value?.batch !== "8") {
    throw new Error("native mutation probe info has an unsupported batch");
  }
  if (value.batch === "8") {
    Object.assign(expected, {
      move: "development_probe_only",
      delete: "development_probe_only",
      createDirectory: "development_probe_only",
      caseOnlyRenameWal: "available",
      volumeLocalQuarantine: "available",
      quarantineInventory: "available",
      lifecycleRecoveryInspection: "available",
      lifecycleIntermediateResume: "available",
      lifecycleRecoveryBoundStateDurability: "available",
      lifecycleReverseCompensation: "available",
      lifecycleDurableFinalize: "available"
    });
  }
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (value?.[key] !== expectedValue) {
      throw new Error(`Batch 7 native probe info did not preserve ${key}`);
    }
  }
}

function assertMutationV2FaultProbe(value, batch = "8") {
  const expectedPaths = [
    "raw_byte_manifest_mismatch",
    "stale_absence_proof",
    "wal_binding_mismatch",
    "post_stage_recovery_scan",
    "replace_final_rename_namespace_revalidation",
    "replace_handle_bound_target_swap_no_overwrite",
    "replace_create_only_handoff_collision_recovery",
    "replace_after_original_handoff_recovery",
    "replace_before_candidate_handoff_recovery",
    "replace_after_candidate_handoff_recovery",
    ...(batch === "8"
      ? [
          "case_only_after_first_rename_recovery_required",
          "case_only_before_second_rename_recovery_required",
          "case_only_after_second_rename_recovery_required"
        ]
      : [])
  ];
  if (
    !value ||
    value.status !== "available" ||
    value.safety !== "invalid_inputs_only_no_protection_switches" ||
    !Array.isArray(value.faultPaths) ||
    value.faultPaths.length !== expectedPaths.length ||
    !expectedPaths.every((path, index) => value.faultPaths[index] === path)
  ) {
    throw new Error("Batch 7 native fault probe did not remain test-input-only");
  }
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
    info.accessEligible !== readOnlyAvailability ||
    !(
      (info.batch === "6" && info.mutation === "unavailable" && info.recovery === "unavailable") ||
      ((info.batch === "7" || info.batch === "8") &&
        info.mutation === "available" &&
        info.recovery === "available")
    )
  ) {
    throw new Error("native addon does not preserve a supported B6/B7 capability declaration");
  }
  for (const capability of ["root", "read", "index"]) {
    const property = `${capability}Eligible`;
    if (property in info && info[property] !== readOnlyAvailability) {
      throw new Error(`native addon ${property} does not match its manifest eligibility`);
    }
  }
  if (
    ("mutationV2Probe" in info && info.mutationV2Probe !== "available") ||
    ("recoveryScanProbe" in info && info.recoveryScanProbe !== "available") ||
    ("stateDurabilityProbe" in info && info.stateDurabilityProbe !== "available")
  ) {
    throw new Error("native addon does not preserve the Batch 7 development probe boundary");
  }
}

function hasExactMap(value, keys, expected, overrides = {}) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => value[key] === (key in overrides ? overrides[key] : expected))
  );
}

function assertUnsignedDevelopmentArtifact(
  manifest,
  signaturePresent,
  readOnlyAvailability,
  mutationV2Availability
) {
  if (
    signaturePresent ||
    manifest.signing?.authenticode !== "required-for-production" ||
    manifest.signing?.detachedCms !== "required-for-production" ||
    manifest.signing?.developmentUnsigned !== true ||
    manifest.qualification?.productionQualified !== false ||
    manifest.eligibility?.batch !== "6" ||
    manifest.eligibility?.mutation !== "unavailable" ||
    manifest.eligibility?.recovery !== "unavailable" ||
    mutationV2Availability !== "available" ||
    (readOnlyAvailability !== "available" && readOnlyAvailability !== "unavailable")
  ) {
    throw new Error(
      "development probe requires an unsigned B6 access / B8 primitive-only artifact"
    );
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
