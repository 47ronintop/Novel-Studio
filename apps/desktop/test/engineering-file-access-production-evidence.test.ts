import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

// @ts-expect-error The release composer is executable JavaScript with no desktop type surface.
import {
  composeEngineeringFileAccessProductionEvidence,
  verifyEngineeringFileAccessProductionEvidence
} from "../../../scripts/compose-engineering-file-access-production-evidence.mjs";

const roots: string[] = [];
const controls = {
  rootRelativeDisabled: "engineering_file_access_root_relative_disabled.node",
  noFollowDisabled: "engineering_file_access_no_follow_disabled.node",
  rawByteIdentityDisabled: "engineering_file_access_raw_byte_identity_disabled.node",
  receiptBindingDisabled: "engineering_file_access_receipt_binding_disabled.node",
  durabilityDisabled: "engineering_file_access_durability_disabled.node",
  recoveryRootBindingDisabled: "engineering_file_access_recovery_root_binding_disabled.node"
} as const;
const mutationFaultFileName = "engineering_file_access_mutation_fault_injection.node";
const sourcePaths = [
  "native/engineering-file-access-win32/CMakeLists.txt",
  "native/engineering-file-access-win32/src/engineering_file_access.cc"
];
const sourceRevisionPaths = [
  ...sourcePaths,
  "scripts/build-engineering-file-access-win32.mjs",
  "scripts/probe-engineering-file-access-package.mjs",
  "scripts/probe-engineering-file-access-disabled-protections-win32.mjs",
  "scripts/compose-engineering-file-access-production-evidence.mjs",
  "scripts/sign-engineering-file-access-win32.mjs"
];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("engineering file access production evidence", () => {
  test("binds executed reports to the exact unsigned build and six unique canaries", async () => {
    const fixture = await createFixture();
    const evidence = await composeEngineeringFileAccessProductionEvidence({
      ...fixture.request,
      now: fixture.now
    });
    await writeFile(fixture.request.outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

    await expect(
      verifyEngineeringFileAccessProductionEvidence({
        ...fixture.request,
        now: fixture.now
      })
    ).resolves.toEqual(evidence);
    expect(evidence).toMatchObject({
      schemaVersion: "engineering_file_access_production_evidence_v1",
      target: "win32-x64",
      unsignedArtifactSha256: fixture.artifactSha256,
      positiveProtections: {
        rootRelativeTraversal: "passed",
        noFollowTraversal: "passed",
        rawByteIdentity: "passed",
        receiptBinding: "passed",
        durability: "passed",
        recoveryRootBinding: "passed"
      },
      mutationRecoveryEvidence: {
        positiveProtections: {
          replace: "passed",
          create: "passed",
          receiptBinding: "passed",
          walPreparation: "passed",
          recoveryScan: "passed"
        },
        negativeControls: {
          rawByteManifestMismatch: "canary_exposed",
          staleBase: "canary_exposed",
          createRace: "canary_exposed",
          faultRecoveryRequired: "canary_exposed"
        }
      },
      lifecycleEvidence: {
        positiveProtections: {
          createDirectory: "passed",
          move: "passed",
          quarantine: "passed",
          restore: "passed",
          purge: "passed"
        },
        negativeControls: {}
      }
    });
    expect(new Set(Object.values(evidence.canaryArtifacts).map((item) => item.sha256)).size).toBe(
      6
    );
  });

  test("rejects a desired status map that was not produced by the executed mutation probe", async () => {
    const fixture = await createFixture();
    const development = JSON.parse(await readFile(fixture.request.developmentReportPath, "utf8"));
    development.mutationV2Probe.negativeCanaries.objectV2StaleBase = "canary_blocked";
    await writeFile(
      fixture.request.developmentReportPath,
      `${JSON.stringify(development, null, 2)}\n`,
      "utf8"
    );

    await expect(
      composeEngineeringFileAccessProductionEvidence({
        ...fixture.request,
        now: fixture.now
      })
    ).rejects.toThrow("executed mutation/recovery negative controls");
  });

  test("rejects incomplete B8 lifecycle evidence from the executed native probe", async () => {
    const fixture = await createFixture();
    const development = JSON.parse(await readFile(fixture.request.developmentReportPath, "utf8"));
    development.mutationV2Probe.lifecycleRestore = "not_executed";
    await writeFile(
      fixture.request.developmentReportPath,
      `${JSON.stringify(development, null, 2)}\n`,
      "utf8"
    );

    await expect(
      composeEngineeringFileAccessProductionEvidence({
        ...fixture.request,
        now: fixture.now
      })
    ).rejects.toThrow("executed B8 lifecycle positive protections");
  });

  test("rejects a disabled-protection report detached from its build identity sidecar", async () => {
    const fixture = await createFixture();
    const sidecarPath = join(
      fixture.canaryDir,
      "engineering_file_access.canary-build-identity.json"
    );
    const sidecar = JSON.parse(await readFile(sidecarPath, "utf8"));
    sidecar.buildTargets = ["engineering_file_access"];
    const unsignedSidecar = { ...sidecar };
    delete unsignedSidecar.identityChecksum;
    sidecar.identityChecksum = hashText(stable(unsignedSidecar));
    await writeFile(sidecarPath, `${JSON.stringify(sidecar, null, 2)}\n`, "utf8");

    await expect(
      composeEngineeringFileAccessProductionEvidence({
        ...fixture.request,
        now: fixture.now
      })
    ).rejects.toThrow("canary build identity");
  });

  test("requires real loadable native identities when no test inspector is supplied", async () => {
    const fixture = await createFixture();

    await expect(
      composeEngineeringFileAccessProductionEvidence({
        ...fixture.request,
        nativeArtifactInspector: undefined,
        now: fixture.now
      })
    ).rejects.toThrow();
  });

  test("fails closed unless the native controls are freshly re-executed", async () => {
    const fixture = await createFixture();
    const rejection = new Error("fresh native execution proof rejected");

    await expect(
      composeEngineeringFileAccessProductionEvidence({
        ...fixture.request,
        nativeExecutionVerifier: async () => Promise.reject(rejection),
        now: fixture.now
      })
    ).rejects.toThrow(rejection.message);
  });

  test("rejects a dirty build or probe script under the claimed source revision", async () => {
    const fixture = await createFixture();
    await writeFile(
      join(fixture.request.sourceRoot, "scripts/build-engineering-file-access-win32.mjs"),
      "// altered after checkout\n",
      "utf8"
    );

    await expect(
      composeEngineeringFileAccessProductionEvidence({
        ...fixture.request,
        now: fixture.now
      })
    ).rejects.toThrow("clean checked-out source chain");
  });

  test("derives recovery-required evidence from executed native handoff faults", async () => {
    const fixture = await createFixture();
    const development = JSON.parse(await readFile(fixture.request.developmentReportPath, "utf8"));
    development.mutationV2Probe.negativeCanaries.objectV2FaultRecoveryRequired = "not_executed";
    await writeFile(
      fixture.request.developmentReportPath,
      `${JSON.stringify(development, null, 2)}\n`,
      "utf8"
    );

    await expect(
      composeEngineeringFileAccessProductionEvidence({
        ...fixture.request,
        now: fixture.now
      })
    ).resolves.toMatchObject({
      mutationRecoveryEvidence: {
        negativeControls: { faultRecoveryRequired: "canary_exposed" }
      }
    });
  });

  test("rejects a self-checksummed report that did not execute a native handoff fault", async () => {
    const fixture = await createFixture();
    const report = JSON.parse(await readFile(fixture.request.disabledProtectionReportPath, "utf8"));
    report.mutationFaultEvidence.afterOriginalHandoff.detail.errorCode = "SYNTHETIC_STATUS";
    delete report.reportChecksum;
    report.reportChecksum = hashText(stable(report));
    await writeFile(
      fixture.request.disabledProtectionReportPath,
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8"
    );

    await expect(
      composeEngineeringFileAccessProductionEvidence({
        ...fixture.request,
        now: fixture.now
      })
    ).rejects.toThrow("executed native handoff fault");
  });
});

async function createFixture() {
  const checkoutRoot = process.cwd();
  const sourceRoot = await mkdtemp(join(tmpdir(), "engineering-production-source-"));
  const root = await mkdtemp(join(tmpdir(), "engineering-production-evidence-"));
  roots.push(sourceRoot, root);
  await Promise.all(
    sourceRevisionPaths.map(async (path) => {
      const destination = join(sourceRoot, path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, await readFile(join(checkoutRoot, path)));
    })
  );
  execFileSync("git", ["init", "--quiet"], { cwd: sourceRoot });
  execFileSync("git", ["config", "user.name", "Production Evidence Test"], {
    cwd: sourceRoot
  });
  execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: sourceRoot });
  execFileSync("git", ["config", "user.email", "evidence-test@example.invalid"], {
    cwd: sourceRoot
  });
  execFileSync("git", ["add", "--", ...sourceRevisionPaths], { cwd: sourceRoot });
  execFileSync("git", ["commit", "--quiet", "-m", "fixture source"], { cwd: sourceRoot });
  const dist = join(root, "dist");
  const canaryDir = join(root, "canaries");
  await Promise.all([mkdir(dist), mkdir(canaryDir)]);
  const artifactPath = join(dist, "engineering_file_access.node");
  const manifestPath = join(dist, "engineering_file_access.manifest.json");
  const signaturePath = join(dist, "engineering_file_access.manifest.p7s");
  const developmentReportPath = join(dist, "engineering_file_access.probe.json");
  const disabledProtectionReportPath = join(
    canaryDir,
    "engineering_file_access.disabled-protection-canaries.json"
  );
  const outputPath = join(root, "production-evidence.json");
  const artifact = Buffer.from("unsigned deterministic native addon fixture", "utf8");
  const artifactSha256 = hash(artifact);
  await Promise.all([
    writeFile(artifactPath, artifact),
    writeFile(join(canaryDir, "engineering_file_access.node"), artifact)
  ]);

  const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: sourceRoot,
    encoding: "utf8"
  }).trim();
  const sourceFiles = await Promise.all(
    sourcePaths.map(async (path) => ({
      path,
      sha256: hash(await readFile(join(sourceRoot, path)))
    }))
  );
  const sourceIdentitySha256 = hashText(stable({ revision: sourceRevision, files: sourceFiles }));
  const toolchainFields = { compiler: "fixture-cl", generator: "fixture-ninja" };
  const toolchainIdentitySha256 = hashText(stable(toolchainFields));
  const buildIdentitySha256 = hashText(
    stable({
      target: "win32-x64",
      nodeApiVersion: 8,
      sourceIdentitySha256,
      toolchainIdentitySha256
    })
  );
  const manifest = {
    schemaVersion: "1.0",
    adapterId: "novel_studio_engineering_file_access",
    target: "win32-x64",
    sourceRevision,
    nodeApiVersion: 8,
    sourceIdentity: { revision: sourceRevision, files: sourceFiles, sha256: sourceIdentitySha256 },
    toolchain: { ...toolchainFields, sha256: toolchainIdentitySha256 },
    buildIdentity: { sha256: buildIdentitySha256 },
    artifact: { sha256: artifactSha256 },
    eligibility: { batch: "6", mutation: "unavailable", recovery: "unavailable" },
    signing: { developmentUnsigned: true },
    qualification: { productionQualified: false, eligibleCapabilities: [] }
  };
  const manifestSerialized = `${JSON.stringify(manifest, null, 2)}\n`;
  const manifestSha256 = hashText(manifestSerialized);
  await writeFile(manifestPath, manifestSerialized, "utf8");

  const mutationV2Probe = {
    status: "passed",
    objectReplace: "passed",
    objectCreate: "passed",
    objectReceiptBinding: "passed",
    walPreparation: "passed",
    recoveryScan: "passed",
    lifecycleCreateDirectory: "passed",
    lifecycleMove: "passed",
    lifecycleQuarantine: "passed",
    lifecycleRestore: "passed",
    lifecyclePurge: "passed",
    negativeCanaries: {
      objectV2RawByteManifestMismatch: "canary_exposed",
      objectV2StaleBase: "canary_exposed",
      objectV2CreateRace: "canary_exposed",
      objectV2FaultRecoveryRequired: "canary_exposed"
    }
  };
  const developmentReport = {
    schemaVersion: "development-1.2",
    adapterId: "novel_studio_engineering_file_access",
    target: "win32-x64",
    packageKind: "development",
    productionQualified: false,
    reason: "unsigned_development_artifact",
    artifactSha256,
    artifactManifestSha256: manifestSha256,
    artifactManifestSignatureSha256: null,
    sourceIdentitySha256,
    toolchainIdentitySha256,
    buildIdentitySha256,
    developmentProbe: { status: "passed" },
    mutationV2Probe,
    stateDurabilityProbe: { status: "passed" }
  };
  await writeFile(developmentReportPath, `${JSON.stringify(developmentReport, null, 2)}\n`, "utf8");

  const canaryArtifacts: Record<string, object> = {};
  const executedCanaryEvidence: Record<string, object> = {};
  let index = 0;
  for (const [disabledProtection, fileName] of Object.entries(controls)) {
    const bytes = Buffer.from(`disabled-protection-${index}-${disabledProtection}`, "utf8");
    await writeFile(join(canaryDir, fileName), bytes);
    canaryArtifacts[disabledProtection] = {
      fileName,
      sha256: hash(bytes),
      disabledProtection,
      buildKind: "test_only_compile_time_variant"
    };
    executedCanaryEvidence[disabledProtection] = {
      status: "canary_exposed",
      detail: canaryDetail(disabledProtection),
      native: {
        schemaVersion: "engineering_disabled_protection_canary_v1",
        buildKind: "test_only_compile_time_variant",
        disabledProtection,
        bypassedDataFlushes: disabledProtection === "durabilityDisabled" ? "2" : "0",
        bypassedDirectoryFlushes: disabledProtection === "durabilityDisabled" ? "3" : "0"
      }
    };
    index += 1;
  }
  const mutationFaultBytes = Buffer.from("mutation-fault-injection-diagnostic", "utf8");
  await writeFile(join(canaryDir, mutationFaultFileName), mutationFaultBytes);
  const buildTargets = [
    "engineering_file_access",
    ...Object.values(controls).map((fileName) => fileName.replace(/\.node$/u, "")),
    mutationFaultFileName.replace(/\.node$/u, "")
  ];
  const sidecarUnsigned = {
    schemaVersion: "engineering_file_access_canary_build_identity_v1",
    target: "win32-x64",
    nodeApiVersion: 8,
    sourceRevision,
    sourceIdentity: {
      revision: sourceRevision,
      files: sourceFiles,
      sha256: sourceIdentitySha256
    },
    toolchain: { ...toolchainFields, sha256: toolchainIdentitySha256 },
    buildIdentity: { sha256: buildIdentitySha256 },
    buildTargets
  };
  const buildIdentitySidecar = {
    ...sidecarUnsigned,
    identityChecksum: hashText(stable(sidecarUnsigned))
  };
  await writeFile(
    join(canaryDir, "engineering_file_access.canary-build-identity.json"),
    `${JSON.stringify(buildIdentitySidecar, null, 2)}\n`,
    "utf8"
  );
  const now = new Date("2026-08-09T16:00:00.000Z");
  const disabledReportUnsigned = {
    schemaVersion: "engineering_disabled_protection_canary_report_v1",
    target: "win32-x64",
    sourceRevision,
    sourceIdentitySha256,
    toolchainIdentitySha256,
    buildIdentitySha256,
    unsignedArtifactSha256: artifactSha256,
    unsignedManifestSha256: manifestSha256,
    buildIdentitySidecar: {
      fileName: "engineering_file_access.canary-build-identity.json",
      identityChecksum: buildIdentitySidecar.identityChecksum
    },
    sourceChain: {
      cmake: "native/engineering-file-access-win32/CMakeLists.txt",
      source: "native/engineering-file-access-win32/src/engineering_file_access.cc",
      build: "scripts/build-engineering-file-access-win32.mjs"
    },
    hardenedArtifact: { fileName: "engineering_file_access.node", sha256: artifactSha256 },
    canaryArtifacts,
    mutationFaultArtifact: {
      fileName: mutationFaultFileName,
      sha256: hash(mutationFaultBytes),
      buildKind: "test_only_compile_time_diagnostic"
    },
    mutationFaultControls: {
      afterStagingFlush: "canary_exposed",
      afterOriginalHandoff: "canary_exposed",
      afterCandidateHandoff: "canary_exposed"
    },
    mutationFaultEvidence: createMutationFaultEvidence(),
    productionControl: {
      runtimeProtectionSwitch: "absent",
      adversarialPaths: "blocked",
      testCanariesInDist: "absent"
    },
    positiveProtections: Object.fromEntries(
      [
        "rootRelativeTraversal",
        "noFollowTraversal",
        "rawByteIdentity",
        "receiptBinding",
        "durability",
        "recoveryRootBinding"
      ].map((key) => [key, "passed"])
    ),
    negativeControls: Object.fromEntries(
      Object.keys(controls).map((key) => [key, "canary_exposed"])
    ),
    evidence: executedCanaryEvidence,
    generatedAt: new Date(now.getTime() - 1000).toISOString()
  };
  const disabledReport = {
    ...disabledReportUnsigned,
    reportChecksum: hashText(stable(disabledReportUnsigned))
  };
  await writeFile(
    disabledProtectionReportPath,
    `${JSON.stringify(disabledReport, null, 2)}\n`,
    "utf8"
  );

  return {
    now,
    artifactSha256,
    canaryDir,
    request: {
      sourceRoot,
      artifactPath,
      manifestPath,
      signaturePath,
      developmentReportPath,
      disabledProtectionReportPath,
      outputPath,
      nativeExecutionVerifier: async () => Promise.resolve(),
      nativeArtifactInspector: async (artifactPath: string) => {
        const fileName = basename(artifactPath);
        if (fileName === "engineering_file_access.node") {
          return {
            disabledProtectionCanaryInfo: null,
            mutationFaultInjectionInfo: null
          };
        }
        if (fileName === mutationFaultFileName) {
          return {
            disabledProtectionCanaryInfo: null,
            mutationFaultInjectionInfo: {
              schemaVersion: "engineering_mutation_fault_injection_v1",
              buildKind: "test_only_compile_time_diagnostic",
              faultPoints: [
                "after_staging_flush",
                "after_original_handoff",
                "after_candidate_handoff"
              ]
            }
          };
        }
        const disabledProtection = Object.entries(controls).find(
          ([, expectedFileName]) => expectedFileName === fileName
        )?.[0];
        if (disabledProtection === undefined) throw new Error("unexpected fixture artifact");
        return {
          disabledProtectionCanaryInfo: {
            schemaVersion: "engineering_disabled_protection_canary_v1",
            buildKind: "test_only_compile_time_variant",
            disabledProtection,
            bypassedDataFlushes: "0",
            bypassedDirectoryFlushes: "0"
          },
          mutationFaultInjectionInfo: null
        };
      }
    }
  };
}

function createMutationFaultEvidence(): Record<string, object> {
  const candidate = ".novel-studio-stage-candidate";
  const recovery = ".novel-studio-stage-before-recovery";
  const create = (
    faultPoint: string,
    targetState: string,
    stagingNames: string[],
    recoveryNames: string[],
    pendingStagingCount: string
  ) => ({
    status: "canary_exposed",
    detail: {
      faultPoint,
      errorCode: "ENGINEERING_MUTATION_RECOVERY_REQUIRED",
      targetState,
      targetSha256: targetState === "absent" ? null : "3".repeat(64),
      stagingNames,
      recoveryNames,
      scan: {
        durableWalRequirement: "external_durable_wal_scan_required",
        inProcessPendingWalCount: "0",
        pendingStagingCount,
        scanScope: "native_staging_and_in_process_wal_only",
        scanTruncated: false,
        state: "recovery_required"
      }
    }
  });
  return {
    afterStagingFlush: create("after_staging_flush", "before_bytes", [candidate], [], "1"),
    afterOriginalHandoff: create(
      "after_original_handoff",
      "absent",
      [candidate, recovery],
      [recovery],
      "2"
    ),
    afterCandidateHandoff: create(
      "after_candidate_handoff",
      "candidate_bytes",
      [recovery],
      [recovery],
      "1"
    )
  };
}

function canaryDetail(disabledProtection: string): object {
  if (disabledProtection === "rootRelativeDisabled") {
    return { escapedRelativePath: "../outside.txt" };
  }
  if (disabledProtection === "noFollowDisabled") {
    return { followedJunction: "junction/junction.txt" };
  }
  if (disabledProtection === "rawByteIdentityDisabled") {
    return {
      abi: "applyEngineeringFileMutationV2",
      declaredSha256: "1".repeat(64),
      observedSha256: "2".repeat(64)
    };
  }
  if (disabledProtection === "receiptBindingDisabled") {
    return {
      abi: "applyEngineeringFileMutationV2",
      expectedTransactionId: "tx:receipt",
      observedTransactionId: "canary-unbound"
    };
  }
  if (disabledProtection === "durabilityDisabled") {
    return {
      abi: "applyEngineeringFileMutationV2",
      receiptDurability: "data_and_directory_flushed",
      bypassedDataFlushes: "2",
      bypassedDirectoryFlushes: "3"
    };
  }
  return { walRootId: "1", mutationRootId: "2" };
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashText(value: string): string {
  return hash(Buffer.from(value, "utf8"));
}
