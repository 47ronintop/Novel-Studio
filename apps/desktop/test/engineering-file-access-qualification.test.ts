import { readFile } from "node:fs/promises";

import { describe, expect, test, vi } from "vitest";

import {
  ENGINEERING_FILE_NATIVE_ADAPTER_ID,
  ENGINEERING_FILE_QUALIFICATION_VERSION,
  engineeringFileQualificationAttestationChecksum,
  validateEngineeringFileQualificationAttestation,
  type EngineeringFileQualificationAttestationV1
} from "@novel-studio/agent-engine";

import {
  ENGINEERING_FILE_ACCESS_PACKAGING_CONTRACT,
  createEngineeringFileAccessQualificationService,
  hasMainOwnedEngineeringFileQualification,
  isMainOwnedEngineeringFileQualificationAttestation,
  mainOwnedEngineeringFileQualificationRevision,
  type EngineeringFileCandidateArtifactState
} from "../../../apps/desktop/src/main/engineering-file-access-qualification.js";

const checkedAt = "2026-08-02T00:30:00.000Z";

describe("Main-owned engineering file access qualification", () => {
  test("freezes the exact future Windows x64 source, package, and probe paths", () => {
    expect(ENGINEERING_FILE_ACCESS_PACKAGING_CONTRACT).toEqual({
      schemaVersion: "1.0",
      adapterId: "novel_studio_engineering_file_access",
      supportedTarget: "win32-x64",
      implementationLanguage: "cpp20_node_api_repository_adapter",
      sourceRoot: "native/engineering-file-access-win32",
      buildDefinition: "native/engineering-file-access-win32/CMakeLists.txt",
      nativeSource: "native/engineering-file-access-win32/src/engineering_file_access.cc",
      buildScript: "scripts/build-engineering-file-access-win32.mjs",
      signScript: "scripts/sign-engineering-file-access-win32.mjs",
      probeScript: "scripts/probe-engineering-file-access-package.mjs",
      packageProbeTest: "apps/desktop/test/engineering-file-access-package.e2e.ts",
      candidateArtifact:
        "native/engineering-file-access-win32/dist/win32-x64/engineering_file_access.node",
      candidateManifest:
        "native/engineering-file-access-win32/dist/win32-x64/engineering_file_access.manifest.json",
      candidateManifestSignature:
        "native/engineering-file-access-win32/dist/win32-x64/engineering_file_access.manifest.p7s",
      packagedArtifact:
        "resources/app.asar.unpacked/native/engineering-file-access-win32/dist/win32-x64/engineering_file_access.node",
      packagedManifest:
        "resources/app.asar.unpacked/native/engineering-file-access-win32/dist/win32-x64/engineering_file_access.manifest.json",
      packagedManifestSignature:
        "resources/app.asar.unpacked/native/engineering-file-access-win32/dist/win32-x64/engineering_file_access.manifest.p7s",
      electronBuilderFiles: [
        "native/engineering-file-access-win32/dist/win32-x64/engineering_file_access.node",
        "native/engineering-file-access-win32/dist/win32-x64/engineering_file_access.manifest.json",
        "native/engineering-file-access-win32/dist/win32-x64/engineering_file_access.manifest.p7s"
      ],
      electronBuilderAsarUnpack: [
        "native/engineering-file-access-win32/dist/win32-x64/engineering_file_access.node",
        "native/engineering-file-access-win32/dist/win32-x64/engineering_file_access.manifest.json",
        "native/engineering-file-access-win32/dist/win32-x64/engineering_file_access.manifest.p7s"
      ]
    });
    expect(Object.isFrozen(ENGINEERING_FILE_ACCESS_PACKAGING_CONTRACT)).toBe(true);
    expect(ENGINEERING_FILE_ACCESS_PACKAGING_CONTRACT.electronBuilderFiles).not.toContain(
      "native/engineering-file-access-win32/dist/win32-x64/engineering_file_access.probe.json"
    );
    expect(ENGINEERING_FILE_ACCESS_PACKAGING_CONTRACT.electronBuilderAsarUnpack).not.toContain(
      "native/engineering-file-access-win32/dist/win32-x64/engineering_file_access.probe.json"
    );
  });

  test("passes the quoted VsDevCmd command to cmd.exe without Node re-escaping it", async () => {
    const buildScript = await readFile(
      ENGINEERING_FILE_ACCESS_PACKAGING_CONTRACT.buildScript,
      "utf8"
    );

    expect(buildScript).toContain("windowsVerbatimArguments: true");
    expect(buildScript).toContain(
      '`call "${vsDevCmd}" -no_logo -host_arch=x64 -arch=x64 >nul && set`'
    );
  });

  test("builds a self-contained MSVC runtime and rejects dynamic CRT dependencies in CI", async () => {
    const [buildDefinition, workflow] = await Promise.all([
      readFile(ENGINEERING_FILE_ACCESS_PACKAGING_CONTRACT.buildDefinition, "utf8"),
      readFile(".github/workflows/engineering-file-access-native.yml", "utf8")
    ]);

    expect(buildDefinition).toContain(
      'MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>"'
    );
    expect(workflow).toContain("dumpbin.exe /nologo /dependents");
    expect(workflow).toContain("MSVCP\\d*|VCRUNTIME\\d*");
    expect(workflow).toContain("api-ms-win-crt-");
  });

  test("requires signed Batch 7 mutation/recovery evidence and schedules the installed-package E2E", async () => {
    const [signScript, packageCheck, packagedConfig, workflow] = await Promise.all([
      readFile(ENGINEERING_FILE_ACCESS_PACKAGING_CONTRACT.signScript, "utf8"),
      readFile("scripts/package-check.mjs", "utf8"),
      readFile("playwright.packaged.config.ts", "utf8"),
      readFile(".github/workflows/engineering-file-access-native.yml", "utf8")
    ]);

    for (const source of [signScript, packageCheck]) {
      expect(source).toContain('batch: "7"');
      expect(source).toContain('mutation: "available"');
      expect(source).toContain('recovery: "available"');
      expect(source).toContain("mutationRecoveryEvidence");
      expect(source).toContain("faultRecoveryRequired");
      expect(source).toContain("lifecycleEvidence");
    }
    expect(packageCheck).toContain("createDirectory");
    expect(signScript).toContain("verifyEngineeringFileAccessProductionEvidence");
    expect(signScript).not.toContain("function hasBatch7ProductionProbeEvidence");
    expect(workflow).toContain(
      "node scripts/probe-engineering-file-access-disabled-protections-win32.mjs"
    );
    expect(workflow).toContain(
      "node scripts/compose-engineering-file-access-production-evidence.mjs"
    );
    expect(packagedConfig).toContain("engineering-file-access-package.e2e.ts");
  });

  test.each([
    ["missing", false, "host_missing"],
    ["partial", true, "host_partial"],
    ["unknown", false, "evidence_unknown"]
  ] as const)(
    "normalizes incomplete candidate state %s to one cached unavailable attestation",
    async (state, candidateArtifactPresent, reason) => {
      const inspect = vi.fn(async (): Promise<EngineeringFileCandidateArtifactState> => state);
      const now = vi.fn(() => checkedAt);
      const service = createEngineeringFileAccessQualificationService({
        packageKind: "production",
        platform: "win32",
        arch: "x64",
        now,
        candidateInspector: { inspect }
      });

      expect(Object.keys(service)).toEqual([
        "readAttestation",
        "hasCapability",
        "subscribeRevocation"
      ]);
      const first = await service.readAttestation();
      const second = await service.readAttestation();

      expect(second).toBe(first);
      expect(inspect).toHaveBeenCalledTimes(1);
      expect(now).toHaveBeenCalledTimes(1);
      expect(first).toMatchObject({
        status: "unavailable",
        productionQualified: false,
        candidateArtifactPresent,
        capabilities: {
          root: "unavailable",
          access: "unavailable",
          mutation: "unavailable",
          recovery: "unavailable"
        }
      });
      expect(first.failureReasons).toContain(reason);
      expect(isMainOwnedEngineeringFileQualificationAttestation(first)).toBe(true);
      expect(hasMainOwnedEngineeringFileQualification(first, "access")).toBe(false);
      expect(mainOwnedEngineeringFileQualificationRevision(first)).toBe(first.attestationChecksum);
    }
  );

  test("never treats an unsigned development B6 artifact as production evidence", async () => {
    const service = createEngineeringFileAccessQualificationService({
      packageKind: "development",
      platform: "win32",
      arch: "x64",
      now: () => checkedAt,
      candidateInspector: { inspect: async () => "present" }
    });

    const attestation = await service.readAttestation();
    expect(attestation).toMatchObject({
      packageKind: "development",
      status: "unavailable",
      productionQualified: false,
      candidateArtifactPresent: true,
      capabilities: {
        root: "unavailable",
        access: "unavailable",
        mutation: "unavailable",
        recovery: "unavailable"
      }
    });
    expect(attestation.failureReasons).toEqual(["candidate_unqualified"]);
    expect(hasMainOwnedEngineeringFileQualification(attestation, "root")).toBe(false);
    expect(hasMainOwnedEngineeringFileQualification(attestation, "access")).toBe(false);
  });

  test("fails closed for a production candidate when packaged probe evidence is unavailable", async () => {
    const service = createEngineeringFileAccessQualificationService({
      packageKind: "production",
      platform: "win32",
      arch: "x64",
      now: () => checkedAt,
      candidateInspector: { inspect: async () => "present" }
    });

    const attestation = await service.readAttestation();
    expect(attestation.status).toBe("unavailable");
    expect(attestation.failureReasons).toContain("evidence_unknown");
    expect(hasMainOwnedEngineeringFileQualification(attestation, "mutation")).toBe(false);
    expect(hasMainOwnedEngineeringFileQualification(attestation, "recovery")).toBe(false);
  });

  test("fails closed on unsupported targets and never asks a candidate inspector", async () => {
    const inspect = vi.fn(async (): Promise<EngineeringFileCandidateArtifactState> => "present");
    const service = createEngineeringFileAccessQualificationService({
      packageKind: "production",
      platform: "linux",
      arch: "x64",
      now: () => checkedAt,
      candidateInspector: { inspect }
    });

    const attestation = await service.readAttestation();
    expect(inspect).not.toHaveBeenCalled();
    expect(attestation).toMatchObject({
      target: "linux-x64",
      status: "unavailable",
      candidateArtifactPresent: false
    });
    expect(attestation.failureReasons).toContain("unsupported_platform");
  });

  test("fails closed when candidate inspection throws", async () => {
    const service = createEngineeringFileAccessQualificationService({
      packageKind: "development",
      platform: "win32",
      arch: "x64",
      now: () => checkedAt,
      candidateInspector: {
        inspect: vi.fn(async () => {
          throw new Error("unreadable");
        })
      }
    });

    const attestation = await service.readAttestation();
    expect(attestation.packageKind).toBe("development");
    expect(attestation.status).toBe("unavailable");
    expect(attestation.failureReasons).toContain("probe_error");
  });

  test("rejects a structurally valid self-checksummed or serialized available attestation", async () => {
    const synthetic = syntheticAvailableAttestation();
    expect(validateEngineeringFileQualificationAttestation(synthetic)).toBe(true);
    expect(isMainOwnedEngineeringFileQualificationAttestation(synthetic)).toBe(false);
    expect(hasMainOwnedEngineeringFileQualification(synthetic, "mutation")).toBe(false);
    expect(mainOwnedEngineeringFileQualificationRevision(synthetic)).toBe("unavailable");

    const service = createEngineeringFileAccessQualificationService({
      packageKind: "production",
      platform: "win32",
      arch: "x64",
      now: () => checkedAt,
      candidateInspector: { inspect: async () => "missing" }
    });
    const mainOwned = await service.readAttestation();
    const serializedCopy = JSON.parse(JSON.stringify(mainOwned)) as unknown;
    expect(validateEngineeringFileQualificationAttestation(serializedCopy)).toBe(true);
    expect(isMainOwnedEngineeringFileQualificationAttestation(serializedCopy)).toBe(false);
  });
});

function syntheticAvailableAttestation(): EngineeringFileQualificationAttestationV1 {
  const unsigned = {
    schemaVersion: ENGINEERING_FILE_QUALIFICATION_VERSION,
    authority: "desktop_main_engineering_file_access_qualification" as const,
    adapterId: ENGINEERING_FILE_NATIVE_ADAPTER_ID,
    target: "win32-x64",
    packageKind: "production" as const,
    status: "available" as const,
    productionQualified: true,
    candidateArtifactPresent: true,
    capabilities: {
      root: "available" as const,
      access: "available" as const,
      mutation: "available" as const,
      recovery: "available" as const
    },
    artifactSha256: "a".repeat(64),
    artifactManifestSha256: "b".repeat(64),
    probeReportChecksum: "c".repeat(64),
    expiresAt: "2099-02-01T00:00:00.000Z",
    failureReasons: [] as const,
    checkedAt
  };
  return {
    ...unsigned,
    attestationChecksum: engineeringFileQualificationAttestationChecksum(unsigned)
  };
}
