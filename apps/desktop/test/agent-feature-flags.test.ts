import { describe, expect, test } from "vitest";
import {
  ENGINEERING_FILE_NATIVE_ADAPTER_ID,
  ENGINEERING_FILE_QUALIFICATION_VERSION,
  engineeringFileQualificationAttestationChecksum,
  type EngineeringFileQualificationAttestationV1
} from "@novel-studio/agent-engine";

import {
  DEFAULT_AGENT_FEATURE_FLAGS,
  createAgentFeatureFlags
} from "../../../apps/desktop/src/main/agent-feature-flags.js";
import { createEngineeringFileAccessQualificationService } from "../../../apps/desktop/src/main/engineering-file-access-qualification.js";

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
    failureReasons: [] as const,
    checkedAt: "2026-08-02T00:30:00.000Z"
  };
  return {
    ...unsigned,
    attestationChecksum: engineeringFileQualificationAttestationChecksum(unsigned)
  };
}
