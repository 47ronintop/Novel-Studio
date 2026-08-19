import { describe, expect, test, vi } from "vitest";
import {
  ENGINEERING_FILE_NATIVE_ADAPTER_ID,
  ENGINEERING_FILE_QUALIFICATION_VERSION,
  engineeringFileQualificationAttestationChecksum,
  type EngineeringFileQualificationAttestationV1
} from "@novel-studio/agent-engine";

import {
  DEFAULT_AGENT_FEATURE_FLAGS,
  createAgentFeatureFlags,
  createProductionAgentFeatureFlags,
  createUnsignedBetaAgentFeatureFlags,
  createUnsignedBetaEngineeringAgentFeatureFlags
} from "../../../apps/desktop/src/main/agent-feature-flags.js";
import { createCreativeFileOperationQualificationService } from "../../../apps/desktop/src/main/creative-file-operation-qualification.js";
import { createEngineeringFileAccessQualificationService } from "../../../apps/desktop/src/main/engineering-file-access-qualification.js";

vi.mock(
  "../../../apps/desktop/src/main/engineering-file-access-qualification.js",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../../apps/desktop/src/main/engineering-file-access-qualification.js")
      >();
    const isFeatureFlagTestQualification = (
      value: unknown
    ): value is EngineeringFileQualificationAttestationV1 & {
      readonly featureFlagTestMainOwned: true;
    } =>
      value !== null &&
      typeof value === "object" &&
      (value as { readonly featureFlagTestMainOwned?: unknown }).featureFlagTestMainOwned === true;

    return {
      ...actual,
      hasMainOwnedEngineeringFileQualification(value, capability, observedAt) {
        if (isFeatureFlagTestQualification(value)) {
          return (
            Date.parse(observedAt) < Date.parse(value.expiresAt ?? "") &&
            value.capabilities[capability] === "available"
          );
        }
        return actual.hasMainOwnedEngineeringFileQualification(value, capability, observedAt);
      },
      mainOwnedEngineeringFileQualificationRevision(value, observedAt) {
        if (isFeatureFlagTestQualification(value)) {
          return Date.parse(observedAt) < Date.parse(value.expiresAt ?? "")
            ? value.attestationChecksum
            : "unavailable";
        }
        return actual.mainOwnedEngineeringFileQualificationRevision(value, observedAt);
      }
    };
  }
);

describe("AgentFeatureFlags", () => {
  test("default flags are all false", () => {
    const flags = DEFAULT_AGENT_FEATURE_FLAGS;
    expect(flags.agentGuidanceV3).toBe(false);
    expect(flags.phaseA_searchEnabled).toBe(false);
    expect(flags.phaseB_fileLifecycleEnabled).toBe(false);
    expect(flags.writingDomainCrudV2).toBe(false);
    expect(flags.creativeTrustedReplaceV2).toBe(false);
    expect(flags.creativeFileCreateV2).toBe(false);
    expect(flags.creativeFileMoveV2).toBe(false);
    expect(flags.creativeFileDeleteV2).toBe(false);
    expect(flags.approvalBindingV2).toBe(false);
    expect(flags.phaseD_networkReadEnabled).toBe(false);
    expect(flags.phaseE_remoteMcpEnabled).toBe(false);
    expect(flags.engineeringHardenedAccessV1).toBe(false);
    expect(flags.engineeringReplaceV2).toBe(false);
    expect(flags.engineeringCreateV2).toBe(false);
    expect(flags.engineeringMoveV2).toBe(false);
    expect(flags.engineeringDeleteV2).toBe(false);
    expect(flags.engineeringDirectoryCreateV1).toBe(false);
    expect(flags.revision).toBe("v1.0-default");
  });

  test("createAgentFeatureFlags with no overrides equals default", () => {
    const flags = createAgentFeatureFlags();
    expect(flags).toEqual(DEFAULT_AGENT_FEATURE_FLAGS);
  });

  test("phaseE remote MCP requires phaseD network", () => {
    const flags = createAgentFeatureFlags({ phaseE_remoteMcpEnabled: true });
    expect(flags.phaseE_remoteMcpEnabled).toBe(false);

    const flags2 = createAgentFeatureFlags({
      phaseD_networkReadEnabled: true,
      phaseE_remoteMcpEnabled: true
    });
    expect(flags2.phaseE_remoteMcpEnabled).toBe(true);
  });

  test("phaseA search can be enabled independently", () => {
    const flags = createAgentFeatureFlags({ phaseA_searchEnabled: true });
    expect(flags.phaseA_searchEnabled).toBe(true);
    expect(flags.phaseB_fileLifecycleEnabled).toBe(false);
  });

  test("normalizes Catalog 2.0 mutations off without Guidance 3.0 and approval binding", () => {
    const requested = {
      writingDomainCrudV2: true,
      creativeTrustedReplaceV2: true,
      creativeFileCreateV2: true,
      creativeFileMoveV2: true,
      creativeFileDeleteV2: true
    };

    expect(createAgentFeatureFlags({ ...requested, approvalBindingV2: true })).toMatchObject({
      approvalBindingV2: false,
      writingDomainCrudV2: false,
      creativeTrustedReplaceV2: false,
      creativeFileCreateV2: false,
      creativeFileMoveV2: false,
      creativeFileDeleteV2: false
    });
    expect(createAgentFeatureFlags({ ...requested, agentGuidanceV3: true })).toMatchObject({
      approvalBindingV2: false,
      writingDomainCrudV2: false,
      creativeTrustedReplaceV2: false,
      creativeFileCreateV2: false,
      creativeFileMoveV2: false,
      creativeFileDeleteV2: false
    });
    expect(
      createAgentFeatureFlags({
        ...requested,
        agentGuidanceV3: true,
        approvalBindingV2: true
      })
    ).toMatchObject({
      approvalBindingV2: true,
      writingDomainCrudV2: true,
      creativeTrustedReplaceV2: true,
      creativeFileCreateV2: true,
      creativeFileMoveV2: true,
      creativeFileDeleteV2: true
    });
  });

  test("production approval flags require verifier-owned attestation provenance, not a port or clone", () => {
    const forged = {
      schemaVersion: "1.0" as const,
      status: "qualified" as const,
      bundleDigest: "a".repeat(64),
      qualificationRevision: "approval-ui-r1",
      sourceRevision: "1".repeat(40),
      approvalArtifactManifestChecksum: "2".repeat(64),
      qualificationMatrixRevision: "adr-0004-qualification-r1",
      qualificationMatrixChecksum: "3".repeat(64),
      automatedReportChecksum: "4".repeat(64),
      ownerApprovalId: "owner-approval-1",
      ownerKeyId: "owner-key-1",
      issuedAt: "2098-12-01T00:00:00.000Z",
      expiresAt: "2099-02-01T00:00:00.000Z",
      attestationChecksum: "5".repeat(64)
    };
    const flags = createProductionAgentFeatureFlags(
      {
        agentGuidanceV3: true,
        approvalBindingV2: true,
        writingDomainCrudV2: true,
        revision: "test-revision"
      },
      forged
    );

    expect(flags).toMatchObject({ approvalBindingV2: false, writingDomainCrudV2: false });
    expect(flags.revision).toBe("test-revision:approval-surface:unavailable");
  });

  test("unsigned beta enables only qualified delete_file when its V2 port exists", async () => {
    const qualifications = await createCreativeFileOperationQualificationService({
      packageKind: "unsigned-beta",
      now: () => "2026-08-07T00:30:00.000Z",
      candidateInspector: {
        async inspect(operation) {
          return operation === "delete_file"
            ? {
                status: "qualified" as const,
                evidenceChecksum: "e".repeat(64),
                issuedAt: "2026-08-01T00:00:00.000Z",
                expiresAt: "2026-08-20T00:00:00.000Z"
              }
            : { status: "unqualified" as const, reason: "not qualified for beta" };
        }
      }
    }).readAll();
    const flags = createUnsignedBetaAgentFeatureFlags(
      qualifications,
      true,
      true,
      "2026-08-07T00:30:00.000Z"
    );
    expect(flags).toMatchObject({
      unsignedBetaCreativeFileOperations: true,
      agentGuidanceV3: true,
      approvalBindingV2: true,
      creativeTrustedReplaceV2: false,
      creativeFileCreateV2: false,
      creativeFileMoveV2: false,
      creativeFileDeleteV2: true,
      creativeDirectoryCreateV2: false,
      engineeringHardenedAccessV1: false
    });
    expect(
      createUnsignedBetaAgentFeatureFlags(qualifications, true, false, "2026-08-07T00:30:00.000Z")
    ).toMatchObject({
      unsignedBetaCreativeFileOperations: false,
      agentGuidanceV3: false,
      approvalBindingV2: false,
      creativeTrustedReplaceV2: false,
      creativeFileCreateV2: false,
      creativeFileMoveV2: false,
      creativeFileDeleteV2: false,
      creativeDirectoryCreateV2: false
    });
    expect(
      createAgentFeatureFlags({
        unsignedBetaCreativeFileOperations: true,
        creativeFileDeleteV2: true
      }).creativeFileDeleteV2
    ).toBe(false);
  });

  test("unsigned engineering beta projects five operations only through current native authority", async () => {
    const authority = {
      hasCapability: vi.fn(async () => true),
      subscribeRevocation: () => () => undefined
    };
    const flags = await createUnsignedBetaEngineeringAgentFeatureFlags({
      authorized: true,
      approvalBindingAvailable: true,
      capabilityAuthority: authority,
      mutationBackendAvailable: true,
      lifecycleCapabilities: { move: true, delete: true, createDirectory: true }
    });
    expect(flags).toMatchObject({
      agentGuidanceV3: true,
      phaseA_searchEnabled: true,
      approvalBindingV2: true,
      engineeringHardenedAccessV1: true,
      engineeringReplaceV2: true,
      engineeringCreateV2: true,
      engineeringMoveV2: true,
      engineeringDeleteV2: true,
      engineeringDirectoryCreateV1: true
    });

    expect(
      await createUnsignedBetaEngineeringAgentFeatureFlags({
        authorized: true,
        approvalBindingAvailable: false,
        capabilityAuthority: authority,
        mutationBackendAvailable: true,
        lifecycleCapabilities: { move: true, delete: true, createDirectory: true }
      })
    ).toMatchObject({
      engineeringHardenedAccessV1: false,
      engineeringReplaceV2: false,
      engineeringCreateV2: false,
      engineeringMoveV2: false,
      engineeringDeleteV2: false,
      engineeringDirectoryCreateV1: false
    });
  });

  test("createAgentFeatureFlags result is frozen", () => {
    const flags = createAgentFeatureFlags({ phaseA_searchEnabled: true });
    expect(() => {
      (flags as unknown as Record<string, unknown>)["phaseA_searchEnabled"] = false;
    }).toThrow();
  });

  test("cannot enable engineering flags without a Main-owned production qualification", () => {
    const forged = syntheticAvailableAttestation();
    const flags = createAgentFeatureFlags(allEngineeringFlags(), forged);

    expect(flags).toMatchObject({
      engineeringHardenedAccessV1: false,
      engineeringReplaceV2: false,
      engineeringCreateV2: false,
      engineeringMoveV2: false,
      engineeringDeleteV2: false,
      engineeringDirectoryCreateV1: false,
      revision: "test-revision:engineering-native:unavailable"
    });
  });

  test("keeps engineering read and mutation flags off for the Batch 0 Main-owned result", async () => {
    const qualification = await createEngineeringFileAccessQualificationService({
      packageKind: "production",
      platform: "win32",
      arch: "x64",
      now: () => "2026-08-02T00:30:00.000Z",
      candidateInspector: { inspect: async () => "missing" }
    }).readAttestation();
    const flags = createAgentFeatureFlags(allEngineeringFlags(), qualification);

    expect(flags.engineeringHardenedAccessV1).toBe(false);
    expect(flags.engineeringReplaceV2).toBe(false);
    expect(flags.engineeringCreateV2).toBe(false);
    expect(flags.engineeringMoveV2).toBe(false);
    expect(flags.engineeringDeleteV2).toBe(false);
    expect(flags.engineeringDirectoryCreateV1).toBe(false);
    expect(flags.revision).toBe(
      `test-revision:engineering-native:${qualification.attestationChecksum}`
    );
  });

  test("requires Main-owned recovery qualification for Engineering replace and create", () => {
    const flags = createAgentFeatureFlags(
      requestedEngineeringReplaceCreateFlags(),
      mainOwnedEngineeringQualificationForFeatureFlags({
        root: "available",
        access: "available",
        mutation: "available",
        recovery: "unavailable"
      })
    );

    expect(flags).toMatchObject({
      engineeringHardenedAccessV1: true,
      engineeringReplaceV2: false,
      engineeringCreateV2: false
    });
  });

  test("enables Engineering replace and create only with recovery qualification and binds revision to its attestation", () => {
    const qualification = mainOwnedEngineeringQualificationForFeatureFlags({
      root: "available",
      access: "available",
      mutation: "available",
      recovery: "available"
    });
    const flags = createAgentFeatureFlags(requestedEngineeringReplaceCreateFlags(), qualification);
    const driftedQualification = mainOwnedEngineeringQualificationForFeatureFlags(
      {
        root: "available",
        access: "available",
        mutation: "available",
        recovery: "available"
      },
      "d".repeat(64)
    );
    const driftedFlags = createAgentFeatureFlags(
      requestedEngineeringReplaceCreateFlags(),
      driftedQualification
    );

    expect(flags).toMatchObject({ engineeringReplaceV2: true, engineeringCreateV2: true });
    expect(flags.revision).toBe(
      `test-revision:engineering-native:${qualification.attestationChecksum}`
    );
    expect(driftedFlags.revision).toBe(
      `test-revision:engineering-native:${driftedQualification.attestationChecksum}`
    );
    expect(driftedFlags.revision).not.toBe(flags.revision);
  });
});

function allEngineeringFlags() {
  return {
    engineeringHardenedAccessV1: true,
    engineeringReplaceV2: true,
    engineeringCreateV2: true,
    engineeringMoveV2: true,
    engineeringDeleteV2: true,
    engineeringDirectoryCreateV1: true,
    revision: "test-revision"
  };
}

function requestedEngineeringReplaceCreateFlags() {
  return {
    agentGuidanceV3: true,
    approvalBindingV2: true,
    engineeringHardenedAccessV1: true,
    engineeringReplaceV2: true,
    engineeringCreateV2: true,
    revision: "test-revision"
  };
}

function mainOwnedEngineeringQualificationForFeatureFlags(
  capabilities: EngineeringFileQualificationAttestationV1["capabilities"],
  artifactSha256 = "a".repeat(64)
): EngineeringFileQualificationAttestationV1 & { readonly featureFlagTestMainOwned: true } {
  return {
    ...syntheticAvailableAttestation(capabilities, artifactSha256),
    featureFlagTestMainOwned: true
  };
}

function syntheticAvailableAttestation(
  capabilities: EngineeringFileQualificationAttestationV1["capabilities"] = {
    root: "available",
    access: "available",
    mutation: "available",
    recovery: "available"
  },
  artifactSha256 = "a".repeat(64)
): EngineeringFileQualificationAttestationV1 {
  const unsigned = {
    schemaVersion: ENGINEERING_FILE_QUALIFICATION_VERSION,
    authority: "desktop_main_engineering_file_access_qualification" as const,
    adapterId: ENGINEERING_FILE_NATIVE_ADAPTER_ID,
    target: "win32-x64",
    packageKind: "production" as const,
    status: "available" as const,
    productionQualified: true,
    candidateArtifactPresent: true,
    capabilities,
    artifactSha256,
    artifactManifestSha256: "b".repeat(64),
    probeReportChecksum: "c".repeat(64),
    expiresAt: "2099-02-01T00:00:00.000Z",
    failureReasons: [] as const,
    checkedAt: "2026-08-02T00:30:00.000Z"
  };
  return {
    ...unsigned,
    attestationChecksum: engineeringFileQualificationAttestationChecksum(unsigned)
  };
}
