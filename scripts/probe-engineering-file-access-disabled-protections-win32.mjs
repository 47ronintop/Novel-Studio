#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const require = createRequire(import.meta.url);
const root = process.cwd();
const arguments_ = process.argv.slice(2);
const verifyExisting = arguments_.length === 1 && arguments_[0] === "--verify-existing";
if (arguments_.length !== 0 && !verifyExisting) {
  throw new Error("unsupported disabled-protection probe argument");
}
if (process.platform !== "win32" || process.arch !== "x64") {
  throw new Error("disabled-protection canaries require win32-x64");
}

const buildDir = join(
  root,
  "native",
  "engineering-file-access-win32",
  ".build",
  "disabled-protection-canaries-win32-x64"
);
const variants = {
  rootRelativeDisabled: "engineering_file_access_root_relative_disabled",
  noFollowDisabled: "engineering_file_access_no_follow_disabled",
  rawByteIdentityDisabled: "engineering_file_access_raw_byte_identity_disabled",
  receiptBindingDisabled: "engineering_file_access_receipt_binding_disabled",
  durabilityDisabled: "engineering_file_access_durability_disabled",
  recoveryRootBindingDisabled: "engineering_file_access_recovery_root_binding_disabled"
};
const hardenedTarget = "engineering_file_access";
const mutationFaultTarget = "engineering_file_access_mutation_fault_injection";
const exactBuildTargets = [hardenedTarget, ...Object.values(variants), mutationFaultTarget];
const positiveProtectionNames = [
  "rootRelativeTraversal",
  "noFollowTraversal",
  "rawByteIdentity",
  "receiptBinding",
  "durability",
  "recoveryRootBinding"
];

if (!verifyExisting) {
  await run(
    process.execPath,
    ["scripts/build-engineering-file-access-win32.mjs", "--disabled-protection-canaries"],
    { cwd: root, env: process.env, maxBuffer: 4 * 1024 * 1024 }
  );
}

const distDir = join(root, "native", "engineering-file-access-win32", "dist", "win32-x64");
const manifestPath = join(distDir, "engineering_file_access.manifest.json");
const identityPath = join(buildDir, "engineering_file_access.canary-build-identity.json");
const manifestBytes = await readFile(manifestPath);
const manifest = JSON.parse(manifestBytes.toString("utf8"));
const buildIdentity = JSON.parse(await readFile(identityPath, "utf8"));
await validateBuildIdentity(buildIdentity, manifest);
const artifacts = await validateArtifactHashes(manifest);

const hardened = require(artifacts.alternateHardened.absolutePath);
if (typeof hardened.disabledProtectionCanaryInfo === "function") {
  throw new Error("the hardened target must not expose a disabled-protection runtime switch");
}
if (typeof hardened.mutationFaultInjectionInfo === "function") {
  throw new Error("the hardened target must not expose mutation fault injection");
}
try {
  const packagedNames = await readdir(distDir);
  for (const target of [...Object.values(variants), mutationFaultTarget]) {
    if (packagedNames.includes(`${target}.node`)) {
      throw new Error(`test-only native target leaked into dist: ${target}.node`);
    }
  }
} catch (error) {
  if (!(error instanceof Error) || error.code !== "ENOENT") throw error;
}

const positiveProtections = await assertHardenedControls(hardened);
assertExactStatusMap(
  positiveProtections,
  positiveProtectionNames,
  "passed",
  "positive protections"
);
const mutationFaultAddon = require(artifacts.mutationFault.absolutePath);
if (typeof mutationFaultAddon.disabledProtectionCanaryInfo === "function") {
  throw new Error("the mutation fault target must not be a disabled-protection canary");
}
const mutationFaultIdentity = assertMutationFaultIdentity(
  mutationFaultAddon.mutationFaultInjectionInfo?.()
);
const mutationFaultEvidence = await exposeMutationFaultControls(mutationFaultAddon);
const mutationFaultControls = Object.fromEntries(
  Object.entries(mutationFaultEvidence).map(([name, value]) => [name, value.status])
);
assertExactStatusMap(
  mutationFaultControls,
  ["afterStagingFlush", "afterOriginalHandoff", "afterCandidateHandoff"],
  "canary_exposed",
  "mutation fault controls"
);
const evidence = {};
for (const [control, target] of Object.entries(variants)) {
  const addon = require(resolveAddon(target));
  const before = addon.disabledProtectionCanaryInfo?.();
  assertCanaryIdentity(before, control);
  const detail = await exposeCanary(control, addon);
  const after = addon.disabledProtectionCanaryInfo();
  assertCanaryIdentity(after, control);
  evidence[control] = { status: "canary_exposed", detail, native: after };
}

const reportBody = {
  schemaVersion: "engineering_disabled_protection_canary_report_v1",
  target: "win32-x64",
  generatedAt: new Date().toISOString(),
  sourceRevision: buildIdentity.sourceRevision,
  sourceIdentitySha256: buildIdentity.sourceIdentity.sha256,
  toolchainIdentitySha256: buildIdentity.toolchain.sha256,
  buildIdentitySha256: buildIdentity.buildIdentity.sha256,
  unsignedArtifactSha256: artifacts.alternateHardened.unsignedDistSha256,
  unsignedManifestSha256: sha256(manifestBytes),
  buildIdentitySidecar: {
    fileName: "engineering_file_access.canary-build-identity.json",
    identityChecksum: buildIdentity.identityChecksum
  },
  sourceChain: {
    cmake: "native/engineering-file-access-win32/CMakeLists.txt",
    source: "native/engineering-file-access-win32/src/engineering_file_access.cc",
    build: "scripts/build-engineering-file-access-win32.mjs"
  },
  productionControl: {
    runtimeProtectionSwitch: "absent",
    adversarialPaths: "blocked",
    testCanariesInDist: "absent"
  },
  hardenedArtifact: {
    fileName: artifacts.alternateHardened.fileName,
    sha256: artifacts.alternateHardened.sha256
  },
  canaryArtifacts: Object.fromEntries(
    Object.entries(artifacts.canaries).map(([name, artifact]) => [
      name,
      {
        fileName: artifact.fileName,
        sha256: artifact.sha256,
        disabledProtection: evidence[name].native.disabledProtection,
        buildKind: evidence[name].native.buildKind
      }
    ])
  ),
  mutationFaultArtifact: {
    fileName: artifacts.mutationFault.fileName,
    sha256: artifacts.mutationFault.sha256,
    buildKind: mutationFaultIdentity.buildKind
  },
  mutationFaultControls,
  mutationFaultEvidence,
  positiveProtections,
  negativeControls: Object.fromEntries(
    Object.entries(evidence).map(([name, value]) => [name, value.status])
  ),
  evidence
};
const report = {
  ...reportBody,
  reportChecksum: sha256(stable(reportBody))
};
assertExactKeys(
  report,
  [
    "buildIdentitySha256",
    "buildIdentitySidecar",
    "canaryArtifacts",
    "evidence",
    "generatedAt",
    "negativeControls",
    "hardenedArtifact",
    "mutationFaultArtifact",
    "mutationFaultControls",
    "mutationFaultEvidence",
    "positiveProtections",
    "productionControl",
    "reportChecksum",
    "schemaVersion",
    "sourceChain",
    "sourceIdentitySha256",
    "sourceRevision",
    "target",
    "toolchainIdentitySha256",
    "unsignedArtifactSha256",
    "unsignedManifestSha256"
  ],
  "disabled-protection report"
);
const { reportChecksum, ...unsignedReport } = report;
if (reportChecksum !== sha256(stable(unsignedReport))) {
  throw new Error("disabled-protection report checksum was not canonically bound");
}
const reportPath = join(buildDir, "engineering_file_access.disabled-protection-canaries.json");
if (!verifyExisting) {
  await writeFile(reportPath, `${JSON.stringify(report, jsonBigInt, 2)}\n`, "utf8");
}
console.log(
  JSON.stringify({
    status: "passed",
    mode: verifyExisting ? "verified_existing_artifacts" : "generated_report",
    reportPath,
    reportChecksum,
    positiveProtections,
    negativeControls: report.negativeControls
  })
);

async function validateBuildIdentity(identity, manifestValue) {
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
  if (
    identity.schemaVersion !== "engineering_file_access_canary_build_identity_v1" ||
    identity.target !== "win32-x64" ||
    identity.nodeApiVersion !== 8 ||
    stable(identity.buildTargets) !== stable(exactBuildTargets)
  ) {
    throw new Error("canary build identity did not bind the exact target set");
  }
  const { identityChecksum, ...unsignedIdentity } = identity;
  if (identityChecksum !== sha256(stable(unsignedIdentity))) {
    throw new Error("canary build identity checksum mismatch");
  }
  assertExactKeys(identity.sourceIdentity, ["files", "revision", "sha256"], "source identity");
  if (
    identity.sourceRevision !== identity.sourceIdentity.revision ||
    identity.sourceIdentity.sha256 !==
      sha256(
        stable({
          revision: identity.sourceIdentity.revision,
          files: identity.sourceIdentity.files
        })
      )
  ) {
    throw new Error("canary source identity checksum mismatch");
  }
  const expectedSourcePaths = [
    "native/engineering-file-access-win32/CMakeLists.txt",
    "native/engineering-file-access-win32/src/engineering_file_access.cc"
  ];
  if (
    !Array.isArray(identity.sourceIdentity.files) ||
    stable(identity.sourceIdentity.files.map(({ path }) => path)) !== stable(expectedSourcePaths)
  ) {
    throw new Error("canary source identity did not contain the exact canonical source files");
  }
  for (const source of identity.sourceIdentity.files) {
    assertExactKeys(source, ["path", "sha256"], `source identity ${source.path}`);
    const actual = sha256(await readFile(join(root, source.path)));
    if (source.sha256 !== actual) throw new Error(`canary source hash mismatch: ${source.path}`);
  }
  const { sha256: toolchainChecksum, ...toolchainFields } = identity.toolchain;
  if (!isSha256(toolchainChecksum) || toolchainChecksum !== sha256(stable(toolchainFields))) {
    throw new Error("canary toolchain identity checksum mismatch");
  }
  const expectedBuildIdentity = sha256(
    stable({
      target: identity.target,
      nodeApiVersion: identity.nodeApiVersion,
      sourceIdentitySha256: identity.sourceIdentity.sha256,
      toolchainIdentitySha256: toolchainChecksum
    })
  );
  if (
    !identity.buildIdentity ||
    Object.keys(identity.buildIdentity).sort().join(",") !== "sha256" ||
    identity.buildIdentity.sha256 !== expectedBuildIdentity
  ) {
    throw new Error("canary build identity checksum mismatch");
  }
  if (
    manifestValue?.signing?.developmentUnsigned !== true ||
    manifestValue?.qualification?.productionQualified !== false ||
    manifestValue.target !== identity.target ||
    manifestValue.nodeApiVersion !== identity.nodeApiVersion ||
    manifestValue.sourceRevision !== identity.sourceRevision ||
    stable(manifestValue.sourceIdentity) !== stable(identity.sourceIdentity) ||
    stable(manifestValue.toolchain) !== stable(identity.toolchain) ||
    stable(manifestValue.buildIdentity) !== stable(identity.buildIdentity)
  ) {
    throw new Error("canary build identity did not match the unsigned development manifest");
  }
}

async function validateArtifactHashes(manifestValue) {
  const alternatePath = resolveAddon(hardenedTarget);
  const expectedDistArtifact =
    "native/engineering-file-access-win32/dist/win32-x64/engineering_file_access.node";
  if (manifestValue.artifact?.path !== expectedDistArtifact) {
    throw new Error("unsigned manifest did not name the canonical development addon");
  }
  const distArtifactPath = join(root, expectedDistArtifact);
  const [alternateBytes, distBytes] = await Promise.all([
    readFile(alternatePath),
    readFile(distArtifactPath)
  ]);
  const alternateSha256 = sha256(alternateBytes);
  const distSha256 = sha256(distBytes);
  if (
    !isSha256(manifestValue.artifact?.sha256) ||
    manifestValue.artifact.sha256 !== distSha256 ||
    alternateSha256 !== distSha256
  ) {
    throw new Error("alternate hardened addon was not byte-identical to the unsigned dist addon");
  }
  const canaries = {};
  for (const [control, target] of Object.entries(variants)) {
    const absolutePath = resolveAddon(target);
    canaries[control] = {
      target,
      fileName: `${target}.node`,
      sha256: sha256(await readFile(absolutePath)),
      absolutePath
    };
  }
  assertExactKeys(canaries, Object.keys(variants), "canary artifact hashes");
  const mutationFaultAbsolutePath = resolveAddon(mutationFaultTarget);
  const mutationFault = {
    target: mutationFaultTarget,
    fileName: `${mutationFaultTarget}.node`,
    sha256: sha256(await readFile(mutationFaultAbsolutePath)),
    absolutePath: mutationFaultAbsolutePath
  };
  const builtNodeFiles = (await readdir(dirname(alternatePath)))
    .filter((name) => name.endsWith(".node"))
    .sort();
  const expectedNodeFiles = exactBuildTargets.map((target) => `${target}.node`).sort();
  if (stable(builtNodeFiles) !== stable(expectedNodeFiles)) {
    throw new Error(
      "canary build directory did not contain the exact eight requested native artifacts"
    );
  }
  const canaryHashes = Object.values(canaries).map(({ sha256: value }) => value);
  if (
    canaryHashes.some((value) => !isSha256(value) || value === alternateSha256) ||
    new Set(canaryHashes).size !== Object.keys(variants).length
  ) {
    throw new Error("canary artifacts must have six unique, non-hardened SHA-256 values");
  }
  if (
    !isSha256(mutationFault.sha256) ||
    mutationFault.sha256 === alternateSha256 ||
    canaryHashes.includes(mutationFault.sha256)
  ) {
    throw new Error("mutation fault artifact must be unique and non-hardened");
  }
  return {
    alternateHardened: {
      target: hardenedTarget,
      fileName: `${hardenedTarget}.node`,
      sha256: alternateSha256,
      unsignedDistSha256: distSha256,
      absolutePath: alternatePath
    },
    canaries,
    mutationFault
  };
}

function resolveAddon(target) {
  const candidates = [
    join(buildDir, "Release", `${target}.node`),
    join(buildDir, `${target}.node`)
  ];
  for (const candidate of candidates) {
    try {
      return require.resolve(candidate);
    } catch (error) {
      if (!(error instanceof Error) || error.code !== "MODULE_NOT_FOUND") throw error;
    }
  }
  throw new Error(`missing native target: ${target}`);
}

function assertCanaryIdentity(info, expected) {
  if (
    !info ||
    info.schemaVersion !== "engineering_disabled_protection_canary_v1" ||
    info.buildKind !== "test_only_compile_time_variant" ||
    info.disabledProtection !== expected
  ) {
    throw new Error(`native canary identity mismatch for ${expected}`);
  }
}

function assertMutationFaultIdentity(info) {
  assertExactKeys(info, ["buildKind", "faultPoints", "schemaVersion"], "mutation fault identity");
  if (
    info.schemaVersion !== "engineering_mutation_fault_injection_v1" ||
    info.buildKind !== "test_only_compile_time_diagnostic" ||
    stable(info.faultPoints) !==
      stable(["after_staging_flush", "after_original_handoff", "after_candidate_handoff"])
  ) {
    throw new Error("native mutation fault identity mismatch");
  }
  return info;
}

async function exposeMutationFaultControls(addon) {
  const controls = [
    {
      name: "afterStagingFlush",
      faultPoint: "after_staging_flush",
      targetState: "before_bytes",
      pendingStagingCount: 1n,
      candidateStagingCount: 1,
      recoveryStagingCount: 0
    },
    {
      name: "afterOriginalHandoff",
      faultPoint: "after_original_handoff",
      targetState: "absent",
      pendingStagingCount: 2n,
      candidateStagingCount: 1,
      recoveryStagingCount: 1
    },
    {
      name: "afterCandidateHandoff",
      faultPoint: "after_candidate_handoff",
      targetState: "candidate_bytes",
      pendingStagingCount: 1n,
      candidateStagingCount: 0,
      recoveryStagingCount: 1
    }
  ];
  const evidence = {};
  for (const control of controls) {
    evidence[control.name] = {
      status: "canary_exposed",
      detail: await exposeMutationFault(addon, control)
    };
  }
  return evidence;
}

async function exposeMutationFault(addon, control) {
  return withWorkspace(async ({ workspace }) => {
    const slug = control.faultPoint.replaceAll("_", "-");
    const relativeIdentity = `fault-${slug}.txt`;
    const rootBindingId = `root:fault-${slug}`;
    const beforeBytes = Buffer.from(`before ${control.faultPoint}\n`, "utf8");
    const candidateBytes = Buffer.from(`candidate ${control.faultPoint}\n`, "utf8");
    await writeFile(join(workspace, relativeIdentity), beforeBytes, { flush: true });
    const opened = addon.openWorkspaceRoot(workspace);
    try {
      const snapshot = addon.inspectEngineeringFileSnapshotV2(opened.rootId, relativeIdentity);
      const beforeManifest = observedV2ManifestFromSnapshot(
        snapshot,
        opened.rootId,
        rootBindingId,
        relativeIdentity,
        beforeBytes
      );
      const candidateManifest = createV2TargetManifest(
        rootBindingId,
        relativeIdentity,
        candidateBytes,
        beforeManifest.metadataChecksum
      );
      const request = createV2ReplaceRequest({
        rootBindingId,
        relativeIdentity,
        transactionId: `tx:fault-${slug}`,
        operationId: `op/fault-${slug}`,
        stagingObjectId: `stage:fault-${slug}`,
        beforeManifest,
        candidateManifest
      });
      let failure;
      try {
        addon.applyEngineeringFileMutationV2(
          opened.rootId,
          request,
          beforeBytes,
          candidateBytes,
          control.faultPoint
        );
      } catch (error) {
        failure = error;
      }
      if (failure?.code !== "ENGINEERING_MUTATION_RECOVERY_REQUIRED") {
        throw new Error(`${control.faultPoint} did not raise recovery-required`);
      }

      const scan = addon.scanMutationRecovery(opened.rootId);
      assertExactKeys(
        scan,
        [
          "durableWalRequirement",
          "inProcessPendingWalCount",
          "pendingStagingCount",
          "scanScope",
          "scanTruncated",
          "state"
        ],
        `${control.faultPoint} recovery scan`
      );
      if (
        scan.state !== "recovery_required" ||
        scan.pendingStagingCount !== control.pendingStagingCount ||
        scan.inProcessPendingWalCount !== 0n ||
        scan.scanTruncated !== false ||
        scan.scanScope !== "native_staging_and_in_process_wal_only" ||
        scan.durableWalRequirement !== "external_durable_wal_scan_required"
      ) {
        throw new Error(`${control.faultPoint} did not leave exact recovery scan evidence`);
      }

      const stagingNames = (await readdir(workspace))
        .filter((name) => name.startsWith(".novel-studio-stage-"))
        .sort();
      const recoveryNames = stagingNames.filter((name) =>
        name.startsWith(".novel-studio-stage-before-")
      );
      const candidateNames = stagingNames.filter(
        (name) => !name.startsWith(".novel-studio-stage-before-")
      );
      if (
        stagingNames.length !== Number(control.pendingStagingCount) ||
        recoveryNames.length !== control.recoveryStagingCount ||
        candidateNames.length !== control.candidateStagingCount
      ) {
        throw new Error(`${control.faultPoint} did not leave the expected staging names`);
      }

      const targetPath = join(workspace, relativeIdentity);
      let targetBytes = null;
      try {
        targetBytes = await readFile(targetPath);
      } catch (error) {
        if (!(error instanceof Error) || error.code !== "ENOENT") throw error;
      }
      if (
        (control.targetState === "absent" && targetBytes !== null) ||
        (control.targetState === "before_bytes" && !targetBytes?.equals(beforeBytes)) ||
        (control.targetState === "candidate_bytes" && !targetBytes?.equals(candidateBytes))
      ) {
        throw new Error(`${control.faultPoint} left an unexpected target state`);
      }
      return {
        faultPoint: control.faultPoint,
        errorCode: failure.code,
        targetState: control.targetState,
        targetSha256: targetBytes === null ? null : sha256(targetBytes),
        stagingNames,
        recoveryNames,
        scan
      };
    } finally {
      addon.closeWorkspaceRoot(opened.rootId);
    }
  });
}

function observedV2ManifestFromSnapshot(
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
    !snapshot.manifest ||
    typeof snapshot.manifest.fileIdentity !== "string" ||
    !isSha256(snapshot.manifest.metadataChecksum) ||
    snapshot.manifest.sha256 !== expected.sha256 ||
    snapshot.manifest.byteLength !== expected.byteLength ||
    snapshot.manifest.encoding !== expected.encoding ||
    snapshot.manifest.bom !== expected.bom ||
    snapshot.manifest.eol !== expected.eol
  ) {
    throw new Error("mutation fault target inspection did not return the exact before snapshot");
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

async function assertHardenedControls(addon) {
  await withWorkspace(async ({ parent, workspace, outside }) => {
    await writeFile(join(parent, "outside.txt"), "outside-root-canary\n", "utf8");
    await mkdir(outside);
    await writeFile(join(outside, "junction.txt"), "reparse-canary\n", "utf8");
    await symlink(outside, join(workspace, "junction"), "junction");
    const opened = addon.openWorkspaceRoot(workspace);
    try {
      expectFailure(
        () => addon.readFile(opened.rootId, "../outside.txt"),
        "root-relative traversal"
      );
      expectFailure(
        () => addon.readFile(opened.rootId, "junction/junction.txt"),
        "reparse traversal"
      );
      const bytes = Buffer.from("raw-byte-control\n", "utf8");
      const declaredBytes = Buffer.from("RAW-byte-control\n", "utf8");
      expectFailure(
        () => applyObjectCreate(addon, opened.rootId, "raw-control.txt", bytes, declaredBytes),
        "raw-byte manifest mismatch"
      );
    } finally {
      addon.closeWorkspaceRoot(opened.rootId);
    }
  });

  await withWorkspace(async ({ workspace }) => {
    const opened = addon.openWorkspaceRoot(workspace);
    try {
      const receiptControl = applyObjectCreate(
        addon,
        opened.rootId,
        "receipt-control.txt",
        Buffer.from("receipt control\n", "utf8")
      );
      assertV2ReceiptBound(receiptControl);
      const durabilityControl = applyObjectCreate(
        addon,
        opened.rootId,
        "durability-control.txt",
        Buffer.from("durability control\n", "utf8")
      );
      assertV2ReceiptBound(durabilityControl);
      if (durabilityControl.receipt.durability !== "data_and_directory_flushed") {
        throw new Error("hardened object receipt did not prove data and directory durability");
      }
    } finally {
      addon.closeWorkspaceRoot(opened.rootId);
    }
  });

  await withTwoWorkspaces(async ({ first, second }) => {
    const firstRoot = addon.openWorkspaceRoot(first);
    const secondRoot = addon.openWorkspaceRoot(second);
    try {
      const wal = addon.prepareMutationWalV2(
        firstRoot.rootId,
        "tx-cross-root",
        "op-cross-root",
        "stage-cross-root",
        "2.0"
      );
      expectFailure(
        () =>
          createFile(addon, secondRoot.rootId, "cross-root.txt", Buffer.from("cross root\n"), {
            wal,
            transactionId: "tx-cross-root",
            operationId: "op-cross-root",
            stagingId: "stage-cross-root"
          }),
        "cross-root WAL binding"
      );
    } finally {
      addon.closeWorkspaceRoot(firstRoot.rootId);
      addon.closeWorkspaceRoot(secondRoot.rootId);
    }
  });
  return Object.fromEntries(positiveProtectionNames.map((name) => [name, "passed"]));
}

async function exposeCanary(control, addon) {
  if (control === "rootRelativeDisabled") {
    return withWorkspace(async ({ parent, workspace }) => {
      const expected = Buffer.from("outside-root-canary\n", "utf8");
      await writeFile(join(parent, "outside.txt"), expected);
      const opened = addon.openWorkspaceRoot(workspace);
      try {
        assertBytes(addon.readFile(opened.rootId, "../outside.txt"), expected, control);
        return { escapedRelativePath: "../outside.txt" };
      } finally {
        addon.closeWorkspaceRoot(opened.rootId);
      }
    });
  }
  if (control === "noFollowDisabled") {
    return withWorkspace(async ({ workspace, outside }) => {
      await mkdir(outside);
      const expected = Buffer.from("reparse-canary\n", "utf8");
      await writeFile(join(outside, "junction.txt"), expected);
      await symlink(outside, join(workspace, "junction"), "junction");
      const opened = addon.openWorkspaceRoot(workspace);
      try {
        assertBytes(addon.readFile(opened.rootId, "junction/junction.txt"), expected, control);
        return { followedJunction: "junction/junction.txt" };
      } finally {
        addon.closeWorkspaceRoot(opened.rootId);
      }
    });
  }
  if (control === "rawByteIdentityDisabled") {
    return withWorkspace(async ({ workspace }) => {
      const opened = addon.openWorkspaceRoot(workspace);
      try {
        const bytes = Buffer.from("raw-byte-canary\n", "utf8");
        const declaredBytes = Buffer.from("RAW-byte-canary\n", "utf8");
        const result = applyObjectCreate(
          addon,
          opened.rootId,
          "raw-byte.txt",
          bytes,
          declaredBytes
        );
        if (
          result.request.candidate.manifest.sha256 === result.receipt.observedAfter.sha256 ||
          result.receipt.observedAfter.sha256 !== rawV2ByteFields(bytes).sha256
        ) {
          throw new Error("raw-byte object canary did not accept a mismatched candidate manifest");
        }
        assertBytes(addon.readFile(opened.rootId, "raw-byte.txt"), bytes, control);
        return {
          abi: "applyEngineeringFileMutationV2",
          declaredSha256: result.request.candidate.manifest.sha256,
          observedSha256: result.receipt.observedAfter.sha256
        };
      } finally {
        addon.closeWorkspaceRoot(opened.rootId);
      }
    });
  }
  if (control === "receiptBindingDisabled") {
    return withWorkspace(async ({ workspace }) => {
      const opened = addon.openWorkspaceRoot(workspace);
      try {
        const result = applyObjectCreate(
          addon,
          opened.rootId,
          "receipt.txt",
          Buffer.from("receipt-canary\n", "utf8")
        );
        const { receipt, request } = result;
        if (receipt.transactionId !== "canary-unbound") {
          throw new Error("receipt-binding canary remained bound");
        }
        if (
          receipt.transactionId === request.transactionId ||
          receipt.nativeReceiptChecksum !== sha256(receipt.observedAfter.sha256)
        ) {
          throw new Error("receipt-binding object canary did not expose an unbound checksum");
        }
        return {
          abi: "applyEngineeringFileMutationV2",
          expectedTransactionId: request.transactionId,
          observedTransactionId: receipt.transactionId
        };
      } finally {
        addon.closeWorkspaceRoot(opened.rootId);
      }
    });
  }
  if (control === "durabilityDisabled") {
    return withWorkspace(async ({ workspace }) => {
      const opened = addon.openWorkspaceRoot(workspace);
      try {
        const result = applyObjectCreate(
          addon,
          opened.rootId,
          "durability.txt",
          Buffer.from("durability-canary\n")
        );
        assertV2ReceiptBound(result);
        const info = addon.disabledProtectionCanaryInfo();
        if (info.bypassedDataFlushes < 1n || info.bypassedDirectoryFlushes < 1n) {
          throw new Error("durability canary did not bypass both data and directory flushes");
        }
        return {
          abi: "applyEngineeringFileMutationV2",
          receiptDurability: result.receipt.durability,
          bypassedDataFlushes: info.bypassedDataFlushes,
          bypassedDirectoryFlushes: info.bypassedDirectoryFlushes
        };
      } finally {
        addon.closeWorkspaceRoot(opened.rootId);
      }
    });
  }
  if (control === "recoveryRootBindingDisabled") {
    return withTwoWorkspaces(async ({ first, second }) => {
      const firstRoot = addon.openWorkspaceRoot(first);
      const secondRoot = addon.openWorkspaceRoot(second);
      try {
        const wal = addon.prepareMutationWalV2(
          firstRoot.rootId,
          "tx-cross-root",
          "op-cross-root",
          "stage-cross-root",
          "2.0"
        );
        const receipt = createFile(
          addon,
          secondRoot.rootId,
          "cross-root.txt",
          Buffer.from("cross-root-canary\n"),
          {
            wal,
            transactionId: "tx-cross-root",
            operationId: "op-cross-root",
            stagingId: "stage-cross-root"
          }
        );
        if (firstRoot.rootId === secondRoot.rootId || receipt.rootId !== secondRoot.rootId) {
          throw new Error("recovery-root canary did not apply a first-root WAL to the second root");
        }
        return { walRootId: firstRoot.rootId, mutationRootId: receipt.rootId };
      } finally {
        addon.closeWorkspaceRoot(firstRoot.rootId);
        addon.closeWorkspaceRoot(secondRoot.rootId);
      }
    });
  }
  throw new Error(`unknown disabled-protection canary: ${control}`);
}

function createFile(addon, rootId, leaf, bytes, manifestOrOptions) {
  const options =
    manifestOrOptions && "wal" in manifestOrOptions
      ? manifestOrOptions
      : { manifest: manifestOrOptions };
  const transactionId = options.transactionId ?? `tx-${basename(leaf).replaceAll(".", "-")}`;
  const operationId = options.operationId ?? `op-${basename(leaf).replaceAll(".", "-")}`;
  const stagingId = options.stagingId ?? `stage-${basename(leaf).replaceAll(".", "-")}`;
  const proof = addon.observeCreateAbsence(rootId, "", leaf);
  const wal =
    options.wal ?? addon.prepareMutationWalV2(rootId, transactionId, operationId, stagingId, "2.0");
  return addon.createFileV2(
    rootId,
    "",
    leaf,
    proof.proofId,
    transactionId,
    operationId,
    stagingId,
    wal.walBindingId,
    bytes,
    options.manifest ?? rawByteManifest(bytes)
  );
}

function applyObjectCreate(addon, rootId, relativeIdentity, bytes, declaredBytes = bytes) {
  const rootBindingId = `root:${relativeIdentity.replaceAll(".", "-")}`;
  const absenceProof = addon.observeCreateAbsenceV2(
    rootId,
    rootBindingId,
    relativeIdentity,
    "2030-01-02T03:04:05.000Z"
  );
  const candidateManifest = createV2TargetManifest(
    rootBindingId,
    relativeIdentity,
    declaredBytes,
    metadataChecksumForAttributes(128)
  );
  const request = {
    schemaVersion: "2.0",
    operationKind: "create_file",
    contentRootBindingId: rootBindingId,
    transactionId: `tx:${relativeIdentity.replaceAll(".", "-")}`,
    operationId: `op/${relativeIdentity.replaceAll(".", "-")}`,
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
    stagingObjectId: `stage:${relativeIdentity.replaceAll(".", "-")}`
  };
  const receipt = addon.applyEngineeringFileMutationV2(rootId, request, null, bytes);
  return { candidateManifest, receipt, request };
}

function assertV2ReceiptBound({ candidateManifest, receipt, request }) {
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
  assertExactKeys(receipt, expectedKeys, "V2 mutation receipt");
  if (
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
    stable(receipt.observedBefore) !== stable(request.before) ||
    receipt.observedAfter?.sha256 !== candidateManifest.sha256 ||
    receipt.observedAfter?.byteLength !== candidateManifest.byteLength ||
    receipt.observedAfter?.metadataChecksum !== candidateManifest.metadataChecksum
  ) {
    throw new Error("hardened V2 receipt did not bind the exact request and observed write");
  }
  const { nativeReceiptChecksum, ...unsignedReceipt } = receipt;
  if (
    !isSha256(nativeReceiptChecksum) ||
    nativeReceiptChecksum !== sha256(stable(unsignedReceipt))
  ) {
    throw new Error("hardened V2 receipt checksum was not canonically bound");
  }
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
    sha256: sha256(value),
    byteLength: value.byteLength,
    encoding: "utf-8",
    bom: hasUtf8Bom ? "utf-8" : "none",
    eol
  };
}

function metadataChecksumForAttributes(attributes) {
  return sha256(`engineering_file_metadata_v2\nattributes=${attributes}`);
}

function rawByteManifest(bytes) {
  const value = Buffer.from(bytes);
  return {
    byteLength: BigInt(value.byteLength),
    sha256: createHash("sha256").update(value).digest("hex"),
    encoding: "utf8",
    bom:
      value.byteLength >= 3 && value[0] === 0xef && value[1] === 0xbb && value[2] === 0xbf
        ? "utf8"
        : "none",
    eol: value.includes(0x0a) ? "lf" : "none"
  };
}

async function withWorkspace(runProbe) {
  const parent = await mkdtemp(join(tmpdir(), "engineering-native-canary-"));
  const workspace = join(parent, "workspace");
  const outside = join(parent, "outside");
  await mkdir(workspace);
  try {
    return await runProbe({ parent, workspace, outside });
  } finally {
    await rm(parent, { recursive: true, force: true, maxRetries: 3 });
  }
}

async function withTwoWorkspaces(runProbe) {
  return withWorkspace(async ({ parent, workspace }) => {
    const second = join(parent, "workspace-second");
    await mkdir(second);
    return runProbe({ first: workspace, second });
  });
}

function expectFailure(runProbe, label) {
  try {
    runProbe();
  } catch {
    return;
  }
  throw new Error(`hardened addon unexpectedly accepted ${label}`);
}

function assertBytes(actual, expected, label) {
  if (!Buffer.isBuffer(actual) || !actual.equals(expected)) {
    throw new Error(`${label} did not expose the expected bytes`);
  }
}

function assertExactKeys(value, expectedKeys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== [...expectedKeys].sort().join(",")
  ) {
    throw new Error(`${label} did not have the exact required keys`);
  }
}

function assertExactStatusMap(value, expectedKeys, expectedStatus, label) {
  assertExactKeys(value, expectedKeys, label);
  if (expectedKeys.some((key) => value[key] !== expectedStatus)) {
    throw new Error(`${label} did not have the exact required status values`);
  }
}

function stable(value) {
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function jsonBigInt(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}
