import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const require = createRequire(import.meta.url);
const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schemaVersion = "engineering_file_access_production_evidence_v1";
const positiveProtectionKeys = [
  "rootRelativeTraversal",
  "noFollowTraversal",
  "rawByteIdentity",
  "receiptBinding",
  "durability",
  "recoveryRootBinding"
];
const disabledProtectionTargets = Object.freeze({
  rootRelativeDisabled: "engineering_file_access_root_relative_disabled.node",
  noFollowDisabled: "engineering_file_access_no_follow_disabled.node",
  rawByteIdentityDisabled: "engineering_file_access_raw_byte_identity_disabled.node",
  receiptBindingDisabled: "engineering_file_access_receipt_binding_disabled.node",
  durabilityDisabled: "engineering_file_access_durability_disabled.node",
  recoveryRootBindingDisabled: "engineering_file_access_recovery_root_binding_disabled.node"
});
const negativeControlKeys = Object.keys(disabledProtectionTargets);
const mutationFaultTarget = "engineering_file_access_mutation_fault_injection.node";
const mutationFaultControlKeys = [
  "afterStagingFlush",
  "afterOriginalHandoff",
  "afterCandidateHandoff"
];
const disabledProtectionBuildTargets = [
  "engineering_file_access",
  ...Object.values(disabledProtectionTargets).map((fileName) => fileName.replace(/\.node$/u, "")),
  mutationFaultTarget.replace(/\.node$/u, "")
];
const buildIdentitySidecarFileName = "engineering_file_access.canary-build-identity.json";
const sourceChain = Object.freeze({
  cmake: "native/engineering-file-access-win32/CMakeLists.txt",
  source: "native/engineering-file-access-win32/src/engineering_file_access.cc",
  build: "scripts/build-engineering-file-access-win32.mjs"
});
const mutationPositiveKeys = [
  "replace",
  "create",
  "receiptBinding",
  "walPreparation",
  "recoveryScan"
];
const mutationNegativeKeys = [
  "rawByteManifestMismatch",
  "staleBase",
  "createRace",
  "faultRecoveryRequired"
];
const lifecyclePositiveKeys = ["createDirectory", "move", "quarantine", "restore", "purge"];
const developmentMutationNegativeKeys = ["rawByteManifestMismatch", "staleBase", "createRace"];
const sourceIdentityPaths = [
  "native/engineering-file-access-win32/CMakeLists.txt",
  "native/engineering-file-access-win32/src/engineering_file_access.cc"
];
const sourceRevisionPaths = [
  ...sourceIdentityPaths,
  "scripts/build-engineering-file-access-win32.mjs",
  "scripts/probe-engineering-file-access-package.mjs",
  "scripts/probe-engineering-file-access-disabled-protections-win32.mjs",
  "scripts/compose-engineering-file-access-production-evidence.mjs",
  "scripts/sign-engineering-file-access-win32.mjs"
];
const evidenceKeys = [
  "buildIdentitySha256",
  "canaryArtifacts",
  "developmentReportSha256",
  "disabledProtectionReportSha256",
  "evidenceChecksum",
  "generatedAt",
  "lifecycleEvidence",
  "mutationRecoveryEvidence",
  "negativeControls",
  "positiveProtections",
  "schemaVersion",
  "sourceIdentitySha256",
  "sourceRevision",
  "target",
  "toolchainIdentitySha256",
  "unsignedArtifactSha256",
  "unsignedManifestSha256"
];

if (isCliInvocation()) {
  const request = parseCliRequest(process.argv.slice(2));
  const evidence = await composeEngineeringFileAccessProductionEvidence(request);
  await writeFile(request.outputPath, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx"
  });
  await verifyEngineeringFileAccessProductionEvidence(request);
  console.log(
    JSON.stringify({
      status: "passed",
      outputPath: request.outputPath,
      evidenceChecksum: evidence.evidenceChecksum
    })
  );
}

export async function composeEngineeringFileAccessProductionEvidence(input) {
  const request = createProductionEvidenceRequest(input);
  const nativeArtifactInspector = createNativeArtifactInspector(input.nativeArtifactInspector);
  const nativeExecutionVerifier = createNativeExecutionVerifier(input.nativeExecutionVerifier);
  const now = input.now instanceof Date ? new Date(input.now) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error("production evidence now must be a valid Date");

  const [artifactBytes, manifestBytes, developmentReportBytes, disabledReportBytes] =
    await Promise.all([
      readFile(request.artifactPath),
      readFile(request.manifestPath),
      readFile(request.developmentReportPath),
      readFile(request.disabledProtectionReportPath)
    ]);
  await assertMissing(request.signaturePath, "unsigned manifest signature");

  const manifest = parseJson(manifestBytes, "unsigned manifest");
  const developmentReport = parseJson(developmentReportBytes, "development probe report");
  const disabledReport = parseJson(disabledReportBytes, "disabled-protection report");
  const artifactSha256 = digest(artifactBytes);
  const manifestSha256 = digest(manifestBytes);
  const developmentReportSha256 = digest(developmentReportBytes);
  const disabledProtectionReportSha256 = digest(disabledReportBytes);

  const sourceRevision = (
    await run("git", ["rev-parse", "HEAD"], { cwd: request.sourceRoot })
  ).stdout.trim();
  await assertSourceChainMatchesRevision(request.sourceRoot);
  const sourceFiles = await Promise.all(
    sourceIdentityPaths.map(async (path) => ({
      path,
      sha256: digest(await readFile(join(request.sourceRoot, path)))
    }))
  );
  const sourceIdentitySha256 = digestText(stable({ revision: sourceRevision, files: sourceFiles }));
  const toolchainIdentitySha256 = manifest?.toolchain?.sha256;
  const buildIdentitySha256 = digestText(
    stable({
      target: "win32-x64",
      nodeApiVersion: 8,
      sourceIdentitySha256,
      toolchainIdentitySha256
    })
  );

  validateUnsignedManifest({
    manifest,
    artifactSha256,
    sourceRevision,
    sourceFiles,
    sourceIdentitySha256,
    toolchainIdentitySha256,
    buildIdentitySha256
  });
  validateDevelopmentReport({
    report: developmentReport,
    artifactSha256,
    manifestSha256,
    sourceIdentitySha256,
    toolchainIdentitySha256,
    buildIdentitySha256
  });
  await validateDisabledProtectionReport({
    report: disabledReport,
    reportPath: request.disabledProtectionReportPath,
    sourceRoot: request.sourceRoot,
    sourceRevision,
    sourceIdentitySha256,
    toolchainIdentitySha256,
    buildIdentitySha256,
    artifactSha256,
    manifestSha256,
    sourceFiles,
    nativeArtifactInspector,
    nativeExecutionVerifier,
    now
  });

  const evidence = {
    schemaVersion,
    target: "win32-x64",
    sourceRevision,
    sourceIdentitySha256,
    toolchainIdentitySha256,
    buildIdentitySha256,
    unsignedArtifactSha256: artifactSha256,
    unsignedManifestSha256: manifestSha256,
    developmentReportSha256,
    disabledProtectionReportSha256,
    canaryArtifacts: Object.fromEntries(
      negativeControlKeys.map((key) => [
        key,
        {
          sha256: disabledReport.canaryArtifacts[key].sha256,
          disabledProtection: key
        }
      ])
    ),
    positiveProtections: Object.fromEntries(positiveProtectionKeys.map((key) => [key, "passed"])),
    negativeControls: Object.fromEntries(negativeControlKeys.map((key) => [key, "canary_exposed"])),
    mutationRecoveryEvidence: {
      positiveProtections: {
        replace: developmentReport.mutationV2Probe.objectReplace,
        create: developmentReport.mutationV2Probe.objectCreate,
        receiptBinding: developmentReport.mutationV2Probe.objectReceiptBinding,
        walPreparation: developmentReport.mutationV2Probe.walPreparation,
        recoveryScan: developmentReport.mutationV2Probe.recoveryScan
      },
      negativeControls: {
        rawByteManifestMismatch:
          developmentReport.mutationV2Probe.negativeCanaries.objectV2RawByteManifestMismatch,
        staleBase: developmentReport.mutationV2Probe.negativeCanaries.objectV2StaleBase,
        createRace: developmentReport.mutationV2Probe.negativeCanaries.objectV2CreateRace,
        faultRecoveryRequired: mutationFaultControlKeys.every(
          (key) => disabledReport.mutationFaultControls[key] === "canary_exposed"
        )
          ? "canary_exposed"
          : undefined
      }
    },
    // B8 lifecycle primitives are recorded as diagnostic evidence, but are deliberately not
    // folded into the B7 qualification capability set until the versioned Main contract exists.
    lifecycleEvidence: {
      positiveProtections: {
        createDirectory: developmentReport.mutationV2Probe.lifecycleCreateDirectory,
        move: developmentReport.mutationV2Probe.lifecycleMove,
        quarantine: developmentReport.mutationV2Probe.lifecycleQuarantine,
        restore: developmentReport.mutationV2Probe.lifecycleRestore,
        purge: developmentReport.mutationV2Probe.lifecyclePurge
      },
      negativeControls: {}
    },
    generatedAt: now.toISOString()
  };
  validateExactStatusMap(
    evidence.positiveProtections,
    positiveProtectionKeys,
    "passed",
    "positive protections"
  );
  validateExactStatusMap(
    evidence.negativeControls,
    negativeControlKeys,
    "canary_exposed",
    "negative controls"
  );
  validateExactStatusMap(
    evidence.mutationRecoveryEvidence.positiveProtections,
    mutationPositiveKeys,
    "passed",
    "mutation/recovery positive protections"
  );
  validateExactStatusMap(
    evidence.mutationRecoveryEvidence.negativeControls,
    mutationNegativeKeys,
    "canary_exposed",
    "mutation/recovery negative controls"
  );
  return Object.freeze({ ...evidence, evidenceChecksum: digestText(stable(evidence)) });
}

export async function verifyEngineeringFileAccessProductionEvidence(input) {
  const request = createProductionEvidenceRequest(input);
  const serialized = await readFile(request.outputPath);
  const observed = parseJson(serialized, "production evidence");
  assertExactKeys(observed, evidenceKeys, "production evidence");
  if (observed.schemaVersion !== schemaVersion || observed.target !== "win32-x64") {
    throw new Error("production evidence schema or target is invalid");
  }
  const { evidenceChecksum, ...unsigned } = observed;
  if (!isSha256(evidenceChecksum) || evidenceChecksum !== digestText(stable(unsigned))) {
    throw new Error("production evidence checksum is invalid");
  }
  const generatedAt = new Date(observed.generatedAt);
  const now = input.now instanceof Date ? new Date(input.now) : new Date();
  if (
    Number.isNaN(generatedAt.getTime()) ||
    Number.isNaN(now.getTime()) ||
    generatedAt.getTime() > now.getTime() ||
    now.getTime() - generatedAt.getTime() > 60 * 60 * 1000
  ) {
    throw new Error("production evidence is stale or future-dated");
  }
  const recomposed = await composeEngineeringFileAccessProductionEvidence({
    ...request,
    now: generatedAt,
    nativeArtifactInspector: input.nativeArtifactInspector,
    nativeExecutionVerifier: input.nativeExecutionVerifier
  });
  if (stable(recomposed) !== stable(observed)) {
    throw new Error("production evidence does not match the current native build and raw reports");
  }
  return Object.freeze(observed);
}

export function createProductionEvidenceRequest(input) {
  if (!input || typeof input !== "object")
    throw new Error("production evidence request is required");
  const request = {
    sourceRoot: absolutePath(input.sourceRoot ?? scriptRoot, "sourceRoot"),
    artifactPath: absolutePath(input.artifactPath, "artifactPath"),
    manifestPath: absolutePath(input.manifestPath, "manifestPath"),
    signaturePath: absolutePath(input.signaturePath, "signaturePath"),
    developmentReportPath: absolutePath(input.developmentReportPath, "developmentReportPath"),
    disabledProtectionReportPath: absolutePath(
      input.disabledProtectionReportPath,
      "disabledProtectionReportPath"
    ),
    outputPath: absolutePath(input.outputPath, "outputPath")
  };
  const paths = Object.values(request).map((path) => path.toLowerCase());
  if (new Set(paths).size !== paths.length) {
    throw new Error("production evidence paths must be distinct");
  }
  return Object.freeze(request);
}

function validateUnsignedManifest(input) {
  const { manifest } = input;
  if (
    manifest?.schemaVersion !== "1.0" ||
    manifest?.adapterId !== "novel_studio_engineering_file_access" ||
    manifest?.target !== "win32-x64" ||
    manifest?.nodeApiVersion !== 8 ||
    manifest?.sourceRevision !== input.sourceRevision ||
    stable(manifest?.sourceIdentity?.files) !== stable(input.sourceFiles) ||
    manifest?.sourceIdentity?.sha256 !== input.sourceIdentitySha256 ||
    !isSha256(input.toolchainIdentitySha256) ||
    manifest?.buildIdentity?.sha256 !== input.buildIdentitySha256 ||
    manifest?.artifact?.sha256 !== input.artifactSha256 ||
    manifest?.signing?.developmentUnsigned !== true ||
    manifest?.qualification?.productionQualified !== false ||
    !Array.isArray(manifest?.qualification?.eligibleCapabilities) ||
    manifest.qualification.eligibleCapabilities.length !== 0 ||
    manifest?.eligibility?.batch !== "6" ||
    manifest?.eligibility?.mutation !== "unavailable" ||
    manifest?.eligibility?.recovery !== "unavailable"
  ) {
    throw new Error("unsigned manifest is not bound to the current Batch 7 development build");
  }
}

function validateDevelopmentReport(input) {
  const report = input.report;
  if (
    report?.schemaVersion !== "development-1.2" ||
    report?.adapterId !== "novel_studio_engineering_file_access" ||
    report?.target !== "win32-x64" ||
    report?.packageKind !== "development" ||
    report?.productionQualified !== false ||
    report?.reason !== "unsigned_development_artifact" ||
    report?.artifactSha256 !== input.artifactSha256 ||
    report?.artifactManifestSha256 !== input.manifestSha256 ||
    report?.artifactManifestSignatureSha256 !== null ||
    report?.sourceIdentitySha256 !== input.sourceIdentitySha256 ||
    report?.toolchainIdentitySha256 !== input.toolchainIdentitySha256 ||
    report?.buildIdentitySha256 !== input.buildIdentitySha256 ||
    report?.developmentProbe?.status !== "passed" ||
    report?.mutationV2Probe?.status !== "passed" ||
    report?.stateDurabilityProbe?.status !== "passed"
  ) {
    throw new Error("development report is not bound to the current unsigned native build");
  }
  validateExactStatusMap(
    {
      replace: report.mutationV2Probe.objectReplace,
      create: report.mutationV2Probe.objectCreate,
      receiptBinding: report.mutationV2Probe.objectReceiptBinding,
      walPreparation: report.mutationV2Probe.walPreparation,
      recoveryScan: report.mutationV2Probe.recoveryScan
    },
    mutationPositiveKeys,
    "passed",
    "executed mutation/recovery positive protections"
  );
  validateExactStatusMap(
    {
      rawByteManifestMismatch:
        report.mutationV2Probe.negativeCanaries?.objectV2RawByteManifestMismatch,
      staleBase: report.mutationV2Probe.negativeCanaries?.objectV2StaleBase,
      createRace: report.mutationV2Probe.negativeCanaries?.objectV2CreateRace
    },
    developmentMutationNegativeKeys,
    "canary_exposed",
    "executed mutation/recovery negative controls"
  );
  validateExactStatusMap(
    {
      createDirectory: report.mutationV2Probe.lifecycleCreateDirectory,
      move: report.mutationV2Probe.lifecycleMove,
      quarantine: report.mutationV2Probe.lifecycleQuarantine,
      restore: report.mutationV2Probe.lifecycleRestore,
      purge: report.mutationV2Probe.lifecyclePurge
    },
    lifecyclePositiveKeys,
    "passed",
    "executed B8 lifecycle positive protections"
  );
}

async function validateDisabledProtectionReport(input) {
  const report = input.report;
  if (
    report?.schemaVersion !== "engineering_disabled_protection_canary_report_v1" ||
    report?.target !== "win32-x64" ||
    report?.sourceRevision !== input.sourceRevision ||
    report?.sourceIdentitySha256 !== input.sourceIdentitySha256 ||
    report?.toolchainIdentitySha256 !== input.toolchainIdentitySha256 ||
    report?.buildIdentitySha256 !== input.buildIdentitySha256 ||
    report?.unsignedArtifactSha256 !== input.artifactSha256 ||
    report?.unsignedManifestSha256 !== input.manifestSha256 ||
    report?.buildIdentitySidecar?.fileName !== buildIdentitySidecarFileName ||
    !isSha256(report?.buildIdentitySidecar?.identityChecksum) ||
    stable(report?.sourceChain) !== stable(sourceChain) ||
    report?.hardenedArtifact?.sha256 !== input.artifactSha256 ||
    report?.productionControl?.runtimeProtectionSwitch !== "absent" ||
    report?.productionControl?.adversarialPaths !== "blocked" ||
    report?.productionControl?.testCanariesInDist !== "absent"
  ) {
    throw new Error("disabled-protection report is not bound to the current unsigned native build");
  }
  const { reportChecksum, ...unsigned } = report;
  if (!isSha256(reportChecksum) || reportChecksum !== digestText(stable(unsigned))) {
    throw new Error("disabled-protection report checksum is invalid");
  }
  const generatedAt = new Date(report.generatedAt);
  if (
    Number.isNaN(generatedAt.getTime()) ||
    generatedAt.getTime() > input.now.getTime() ||
    input.now.getTime() - generatedAt.getTime() > 60 * 60 * 1000
  ) {
    throw new Error("disabled-protection report is stale or future-dated");
  }
  validateExactStatusMap(
    report.positiveProtections,
    positiveProtectionKeys,
    "passed",
    "disabled-protection hardened controls"
  );
  validateExactStatusMap(
    report.negativeControls,
    negativeControlKeys,
    "canary_exposed",
    "disabled-protection canaries"
  );
  validateExecutedDisabledProtectionEvidence(report.evidence);
  validateMutationFaultEvidence(report.mutationFaultControls, report.mutationFaultEvidence);
  assertExactKeys(report.canaryArtifacts, negativeControlKeys, "canary artifacts");
  const buildDir = dirname(input.reportPath);
  const sidecar = parseJson(
    await readFile(join(buildDir, buildIdentitySidecarFileName)),
    "canary build identity"
  );
  validateCanaryBuildIdentity({
    identity: sidecar,
    report,
    sourceRevision: input.sourceRevision,
    sourceFiles: input.sourceFiles,
    sourceIdentitySha256: input.sourceIdentitySha256,
    toolchainIdentitySha256: input.toolchainIdentitySha256,
    buildIdentitySha256: input.buildIdentitySha256
  });
  const hardenedObservation = await input.nativeArtifactInspector(
    join(buildDir, "engineering_file_access.node")
  );
  if (
    hardenedObservation.disabledProtectionCanaryInfo !== null ||
    hardenedObservation.mutationFaultInjectionInfo !== null
  ) {
    throw new Error("alternate hardened artifact exposes a test-only native control");
  }
  if (
    report.hardenedArtifact?.fileName !== "engineering_file_access.node" ||
    digest(await readFile(join(buildDir, "engineering_file_access.node"))) !== input.artifactSha256
  ) {
    throw new Error("alternate hardened artifact does not match the unsigned canonical addon");
  }
  const hashes = new Set([input.artifactSha256]);
  for (const [key, fileName] of Object.entries(disabledProtectionTargets)) {
    const artifact = report.canaryArtifacts[key];
    if (
      artifact?.fileName !== fileName ||
      artifact?.disabledProtection !== key ||
      artifact?.buildKind !== "test_only_compile_time_variant" ||
      !isSha256(artifact?.sha256) ||
      hashes.has(artifact.sha256)
    ) {
      throw new Error(`disabled-protection artifact identity is invalid for ${key}`);
    }
    const actual = digest(await readFile(join(buildDir, fileName)));
    if (actual !== artifact.sha256) {
      throw new Error(`disabled-protection artifact digest mismatch for ${key}`);
    }
    const observation = await input.nativeArtifactInspector(join(buildDir, fileName));
    validateLoadedDisabledProtectionCanary(observation, key);
    hashes.add(actual);
  }
  const faultArtifact = report.mutationFaultArtifact;
  if (
    faultArtifact?.fileName !== mutationFaultTarget ||
    faultArtifact?.buildKind !== "test_only_compile_time_diagnostic" ||
    !isSha256(faultArtifact?.sha256) ||
    hashes.has(faultArtifact.sha256)
  ) {
    throw new Error("mutation fault artifact identity is invalid");
  }
  const faultPath = join(buildDir, mutationFaultTarget);
  if (digest(await readFile(faultPath)) !== faultArtifact.sha256) {
    throw new Error("mutation fault artifact digest mismatch");
  }
  validateLoadedMutationFaultArtifact(await input.nativeArtifactInspector(faultPath));
  await input.nativeExecutionVerifier({
    sourceRoot: input.sourceRoot,
    reportPath: input.reportPath
  });
}

function validateExecutedDisabledProtectionEvidence(value) {
  assertExactKeys(value, negativeControlKeys, "executed disabled-protection evidence");
  for (const key of negativeControlKeys) {
    const item = value[key];
    assertExactKeys(item, ["detail", "native", "status"], `executed ${key} evidence`);
    if (item.status !== "canary_exposed") {
      throw new Error(`executed ${key} evidence did not expose its negative control`);
    }
    validateSerializedCanaryIdentity(item.native, key);
    validateCanaryDetail(key, item.detail);
  }
}

function validateSerializedCanaryIdentity(value, expected) {
  assertExactKeys(
    value,
    [
      "buildKind",
      "bypassedDataFlushes",
      "bypassedDirectoryFlushes",
      "disabledProtection",
      "schemaVersion"
    ],
    `${expected} native identity`
  );
  if (
    value.schemaVersion !== "engineering_disabled_protection_canary_v1" ||
    value.buildKind !== "test_only_compile_time_variant" ||
    value.disabledProtection !== expected ||
    !isUnsignedInteger(value.bypassedDataFlushes) ||
    !isUnsignedInteger(value.bypassedDirectoryFlushes) ||
    (expected === "durabilityDisabled" &&
      (BigInt(value.bypassedDataFlushes) < 1n || BigInt(value.bypassedDirectoryFlushes) < 1n)) ||
    (expected !== "durabilityDisabled" &&
      (BigInt(value.bypassedDataFlushes) !== 0n || BigInt(value.bypassedDirectoryFlushes) !== 0n))
  ) {
    throw new Error(`${expected} native identity is not bound to its executed canary`);
  }
}

function validateCanaryDetail(key, detail) {
  if (key === "rootRelativeDisabled") {
    assertExactKeys(detail, ["escapedRelativePath"], `${key} detail`);
    if (detail.escapedRelativePath !== "../outside.txt")
      throw new Error(`${key} detail is invalid`);
    return;
  }
  if (key === "noFollowDisabled") {
    assertExactKeys(detail, ["followedJunction"], `${key} detail`);
    if (detail.followedJunction !== "junction/junction.txt")
      throw new Error(`${key} detail is invalid`);
    return;
  }
  if (key === "rawByteIdentityDisabled") {
    assertExactKeys(detail, ["abi", "declaredSha256", "observedSha256"], `${key} detail`);
    if (
      detail.abi !== "applyEngineeringFileMutationV2" ||
      !isSha256(detail.declaredSha256) ||
      !isSha256(detail.observedSha256) ||
      detail.declaredSha256 === detail.observedSha256
    ) {
      throw new Error(`${key} detail is invalid`);
    }
    return;
  }
  if (key === "receiptBindingDisabled") {
    assertExactKeys(
      detail,
      ["abi", "expectedTransactionId", "observedTransactionId"],
      `${key} detail`
    );
    if (
      detail.abi !== "applyEngineeringFileMutationV2" ||
      typeof detail.expectedTransactionId !== "string" ||
      detail.observedTransactionId !== "canary-unbound" ||
      detail.expectedTransactionId === detail.observedTransactionId
    ) {
      throw new Error(`${key} detail is invalid`);
    }
    return;
  }
  if (key === "durabilityDisabled") {
    assertExactKeys(
      detail,
      ["abi", "bypassedDataFlushes", "bypassedDirectoryFlushes", "receiptDurability"],
      `${key} detail`
    );
    if (
      detail.abi !== "applyEngineeringFileMutationV2" ||
      detail.receiptDurability !== "data_and_directory_flushed" ||
      !isUnsignedInteger(detail.bypassedDataFlushes) ||
      !isUnsignedInteger(detail.bypassedDirectoryFlushes) ||
      BigInt(detail.bypassedDataFlushes) < 1n ||
      BigInt(detail.bypassedDirectoryFlushes) < 1n
    ) {
      throw new Error(`${key} detail is invalid`);
    }
    return;
  }
  assertExactKeys(detail, ["mutationRootId", "walRootId"], `${key} detail`);
  if (
    !isUnsignedInteger(detail.mutationRootId) ||
    !isUnsignedInteger(detail.walRootId) ||
    BigInt(detail.mutationRootId) === BigInt(detail.walRootId)
  ) {
    throw new Error(`${key} detail is invalid`);
  }
}

function validateLoadedDisabledProtectionCanary(observation, expected) {
  if (!observation || observation.mutationFaultInjectionInfo !== null) {
    throw new Error(`loaded ${expected} artifact exposed an unexpected native control`);
  }
  const info = observation.disabledProtectionCanaryInfo;
  if (
    !info ||
    info.schemaVersion !== "engineering_disabled_protection_canary_v1" ||
    info.buildKind !== "test_only_compile_time_variant" ||
    info.disabledProtection !== expected
  ) {
    throw new Error(`loaded ${expected} artifact did not prove its compile-time identity`);
  }
}

function validateMutationFaultEvidence(controls, evidence) {
  validateExactStatusMap(
    controls,
    mutationFaultControlKeys,
    "canary_exposed",
    "executed mutation fault controls"
  );
  assertExactKeys(evidence, mutationFaultControlKeys, "executed mutation fault evidence");
  const expectations = {
    afterStagingFlush: {
      faultPoint: "after_staging_flush",
      targetState: "before_bytes",
      pendingStagingCount: "1",
      stagingCount: 1,
      recoveryCount: 0
    },
    afterOriginalHandoff: {
      faultPoint: "after_original_handoff",
      targetState: "absent",
      pendingStagingCount: "2",
      stagingCount: 2,
      recoveryCount: 1
    },
    afterCandidateHandoff: {
      faultPoint: "after_candidate_handoff",
      targetState: "candidate_bytes",
      pendingStagingCount: "1",
      stagingCount: 1,
      recoveryCount: 1
    }
  };
  for (const key of mutationFaultControlKeys) {
    const item = evidence[key];
    const expected = expectations[key];
    assertExactKeys(item, ["detail", "status"], `${key} mutation fault evidence`);
    const detail = item.detail;
    assertExactKeys(
      detail,
      [
        "errorCode",
        "faultPoint",
        "recoveryNames",
        "scan",
        "stagingNames",
        "targetSha256",
        "targetState"
      ],
      `${key} mutation fault detail`
    );
    assertExactKeys(
      detail.scan,
      [
        "durableWalRequirement",
        "inProcessPendingWalCount",
        "pendingStagingCount",
        "scanScope",
        "scanTruncated",
        "state"
      ],
      `${key} mutation fault scan`
    );
    if (
      item.status !== "canary_exposed" ||
      detail.faultPoint !== expected.faultPoint ||
      detail.errorCode !== "ENGINEERING_MUTATION_RECOVERY_REQUIRED" ||
      detail.targetState !== expected.targetState ||
      !Array.isArray(detail.stagingNames) ||
      detail.stagingNames.length !== expected.stagingCount ||
      !detail.stagingNames.every((name) => name.startsWith(".novel-studio-stage-")) ||
      !Array.isArray(detail.recoveryNames) ||
      detail.recoveryNames.length !== expected.recoveryCount ||
      !detail.recoveryNames.every((name) => name.startsWith(".novel-studio-stage-before-")) ||
      !detail.recoveryNames.every((name) => detail.stagingNames.includes(name)) ||
      detail.scan.state !== "recovery_required" ||
      detail.scan.pendingStagingCount !== expected.pendingStagingCount ||
      detail.scan.inProcessPendingWalCount !== "0" ||
      detail.scan.scanTruncated !== false ||
      detail.scan.scanScope !== "native_staging_and_in_process_wal_only" ||
      detail.scan.durableWalRequirement !== "external_durable_wal_scan_required" ||
      (expected.targetState === "absent"
        ? detail.targetSha256 !== null
        : !isSha256(detail.targetSha256))
    ) {
      throw new Error(`${key} did not prove its executed native handoff fault`);
    }
  }
}

function validateLoadedMutationFaultArtifact(observation) {
  if (!observation || observation.disabledProtectionCanaryInfo !== null) {
    throw new Error("loaded mutation fault artifact exposed an unexpected native control");
  }
  const info = observation.mutationFaultInjectionInfo;
  if (
    !info ||
    info.schemaVersion !== "engineering_mutation_fault_injection_v1" ||
    info.buildKind !== "test_only_compile_time_diagnostic" ||
    stable(info.faultPoints) !==
      stable(["after_staging_flush", "after_original_handoff", "after_candidate_handoff"])
  ) {
    throw new Error("loaded mutation fault artifact did not prove its compile-time identity");
  }
}

function validateCanaryBuildIdentity(input) {
  const identity = input.identity;
  assertExactKeys(
    identity,
    [
      "buildIdentity",
      "buildTargets",
      "identityChecksum",
      "nodeApiVersion",
      "schemaVersion",
      "sourceIdentity",
      "sourceRevision",
      "target",
      "toolchain"
    ],
    "canary build identity"
  );
  const { identityChecksum, ...unsignedIdentity } = identity;
  const toolchain = identity.toolchain;
  const { sha256: toolchainChecksum, ...toolchainFields } = toolchain ?? {};
  if (
    identity.schemaVersion !== "engineering_file_access_canary_build_identity_v1" ||
    identity.target !== "win32-x64" ||
    identity.nodeApiVersion !== 8 ||
    identity.sourceRevision !== input.sourceRevision ||
    stable(identity.buildTargets) !== stable(disabledProtectionBuildTargets) ||
    stable(identity.sourceIdentity) !==
      stable({
        revision: input.sourceRevision,
        files: input.sourceFiles,
        sha256: input.sourceIdentitySha256
      }) ||
    toolchainChecksum !== input.toolchainIdentitySha256 ||
    digestText(stable(toolchainFields)) !== toolchainChecksum ||
    stable(identity.buildIdentity) !== stable({ sha256: input.buildIdentitySha256 }) ||
    identityChecksum !== input.report.buildIdentitySidecar.identityChecksum ||
    identityChecksum !== digestText(stable(unsignedIdentity))
  ) {
    throw new Error("canary build identity is not bound to the exact native build and target set");
  }
}

function parseCliRequest(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || value === undefined || values.has(name)) {
      throw new Error("production evidence CLI arguments must be unique --name value pairs");
    }
    values.set(name, value);
  }
  const expected = [
    "--artifact",
    "--development-report",
    "--disabled-protection-report",
    "--manifest",
    "--out",
    "--signature",
    "--source-root"
  ];
  assertExactKeys(Object.fromEntries(values), expected, "production evidence CLI arguments");
  return createProductionEvidenceRequest({
    sourceRoot: values.get("--source-root"),
    artifactPath: values.get("--artifact"),
    manifestPath: values.get("--manifest"),
    signaturePath: values.get("--signature"),
    developmentReportPath: values.get("--development-report"),
    disabledProtectionReportPath: values.get("--disabled-protection-report"),
    outputPath: values.get("--out")
  });
}

function createNativeArtifactInspector(inspector) {
  if (inspector !== undefined && typeof inspector !== "function") {
    throw new Error("native artifact inspector must be a function");
  }
  return (
    inspector ??
    ((artifactPath) => {
      const addon = require(artifactPath);
      return {
        disabledProtectionCanaryInfo:
          typeof addon.disabledProtectionCanaryInfo === "function"
            ? normalizeNativeIdentity(addon.disabledProtectionCanaryInfo())
            : null,
        mutationFaultInjectionInfo:
          typeof addon.mutationFaultInjectionInfo === "function"
            ? normalizeNativeIdentity(addon.mutationFaultInjectionInfo())
            : null
      };
    })
  );
}

function createNativeExecutionVerifier(verifier) {
  if (verifier !== undefined && typeof verifier !== "function") {
    throw new Error("native execution verifier must be a function");
  }
  return (
    verifier ??
    (async ({ sourceRoot, reportPath }) => {
      const expectedBuildDir = resolve(
        sourceRoot,
        "native",
        "engineering-file-access-win32",
        ".build",
        "disabled-protection-canaries-win32-x64"
      );
      if (resolve(dirname(reportPath)).toLowerCase() !== expectedBuildDir.toLowerCase()) {
        throw new Error("native execution evidence must come from the canonical canary build");
      }
      await run(
        process.execPath,
        [
          "scripts/probe-engineering-file-access-disabled-protections-win32.mjs",
          "--verify-existing"
        ],
        {
          cwd: sourceRoot,
          env: process.env,
          maxBuffer: 4 * 1024 * 1024
        }
      );
    })
  );
}

function normalizeNativeIdentity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      typeof item === "bigint" ? item.toString() : item
    ])
  );
}

async function assertSourceChainMatchesRevision(sourceRoot) {
  try {
    await run("git", ["ls-files", "--error-unmatch", "--", ...sourceRevisionPaths], {
      cwd: sourceRoot
    });
    await run("git", ["diff", "--quiet", "HEAD", "--", ...sourceRevisionPaths], {
      cwd: sourceRoot
    });
  } catch {
    throw new Error("native production evidence requires a clean checked-out source chain");
  }
}

function absolutePath(value, label) {
  if (typeof value !== "string" || !isAbsolute(value)) {
    throw new Error(`${label} must be an absolute path`);
  }
  return resolve(value);
}

async function assertMissing(path, label) {
  try {
    await stat(path);
  } catch (error) {
    if (error instanceof Error && error.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`${label} must not exist before production evidence composition`);
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} must be readable JSON`);
  }
}

function validateExactStatusMap(value, keys, expected, label) {
  assertExactKeys(value, keys, label);
  if (!keys.every((key) => value[key] === expected)) {
    throw new Error(`${label} must contain only ${String(expected)}`);
  }
}

function assertExactKeys(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\n") !== [...keys].sort().join("\n")
  ) {
    throw new Error(`${label} must contain the exact expected keys`);
  }
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isUnsignedInteger(value) {
  return typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value);
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function digestText(value) {
  return digest(Buffer.from(value, "utf8"));
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function isCliInvocation() {
  return process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
}
