import { describe, expect, test } from "vitest";

import {
  ENGINEERING_FILE_CONTRACT_VERSION,
  ENGINEERING_FILE_NATIVE_ADAPTER_ID,
  ENGINEERING_FILE_NEGATIVE_CONTROLS,
  ENGINEERING_FILE_POSITIVE_PROTECTIONS,
  ENGINEERING_FILE_PROBE_CONTRACT_VERSION,
  ENGINEERING_FILE_PROBE_MAX_LIFETIME_MS,
  ENGINEERING_FILE_QUALIFICATION_VERSION,
  createUnavailableEngineeringFileQualificationAttestation,
  engineeringFileProbeReportChecksum,
  engineeringFileQualificationAttestationChecksum,
  validateEngineeringFileProbeReport,
  validateEngineeringFileQualificationAttestation,
  type EngineeringFileMutationReceiptV1,
  type EngineeringFileProbeReportV1,
  type EngineeringFileQualificationAttestationV1,
  type EngineeringRawByteBlobV1,
  type EngineeringRecoveryRootBindingV1,
  type EngineeringWorkspaceRootBindingV1
} from "../src/index.js";

describe("Engineering hardened file contracts", () => {
  test("freezes handle binding, raw-byte blob, recovery binding, and receipt DTOs at 1.0", () => {
    const rootBinding = {
      schemaVersion: ENGINEERING_FILE_CONTRACT_VERSION,
      rootBindingId: "root_01",
      workspaceId: "workspace_01",
      workspaceKind: "engineeringWorkspace",
      volumeIdentity: "volume_01",
      directoryIdentity: "directory_01",
      canonicalPathIdentityChecksum: "a".repeat(64),
      pathPolicyRevision: "policy_01",
      issuedAt: "2026-08-02T00:00:00.000Z"
    } satisfies EngineeringWorkspaceRootBindingV1;
    const recoveryBinding = {
      schemaVersion: ENGINEERING_FILE_CONTRACT_VERSION,
      recoveryRootBindingId: "recovery_01",
      contentRootBindingId: rootBinding.rootBindingId,
      grantRevision: "grant_01",
      volumeIdentity: rootBinding.volumeIdentity,
      directoryIdentity: "recovery_directory_01",
      sideEffectChecksum: "b".repeat(64),
      issuedAt: "2026-08-02T00:00:00.000Z"
    } satisfies EngineeringRecoveryRootBindingV1;
    const blob = {
      schemaVersion: ENGINEERING_FILE_CONTRACT_VERSION,
      blobId: "blob_01",
      storage: "main_owned_immutable_blob",
      byteLength: 4,
      sha256: "c".repeat(64),
      encoding: "utf-8",
      bom: "none",
      eol: "lf"
    } satisfies EngineeringRawByteBlobV1;
    const receipt = {
      schemaVersion: ENGINEERING_FILE_CONTRACT_VERSION,
      transactionId: "transaction_01",
      operationId: "operation_01",
      contentRootBindingId: rootBinding.rootBindingId,
      recoveryRootBindingId: recoveryBinding.recoveryRootBindingId,
      relativeIdentity: "src/index.ts",
      observedBeforeSha256: blob.sha256,
      observedAfterSha256: "d".repeat(64),
      recoveryObjectId: "recovery_object_01",
      durability: "data_and_directory_flushed",
      nativeReceiptChecksum: "e".repeat(64)
    } satisfies EngineeringFileMutationReceiptV1;

    expect(rootBinding).not.toHaveProperty("absolutePath");
    expect(blob.storage).toBe("main_owned_immutable_blob");
    expect(recoveryBinding.contentRootBindingId).toBe(rootBinding.rootBindingId);
    expect(receipt).toMatchObject({
      contentRootBindingId: "root_01",
      recoveryRootBindingId: "recovery_01",
      durability: "data_and_directory_flushed"
    });
  });

  test("requires a fresh signed production report and every disabled-protection canary", () => {
    const report = probeReport();
    expect(validateEngineeringFileProbeReport(report, "2026-08-02T00:30:00.000Z")).toEqual({
      valid: true,
      failureReasons: []
    });
    expect(Object.keys(report.positiveProtections)).toEqual(ENGINEERING_FILE_POSITIVE_PROTECTIONS);
    expect(Object.keys(report.negativeControls)).toEqual(ENGINEERING_FILE_NEGATIVE_CONTROLS);

    const negativeControlFailure = checkedProbeReport({
      ...report,
      negativeControls: { ...report.negativeControls, noFollowDisabled: "canary_blocked" }
    });
    expect(
      validateEngineeringFileProbeReport(negativeControlFailure, "2026-08-02T00:30:00.000Z")
    ).toEqual({ valid: false, failureReasons: ["negative_control_failed"] });

    const signatureFailure = checkedProbeReport({
      ...report,
      manifestSignatureVerification: "untrusted_publisher"
    });
    expect(
      validateEngineeringFileProbeReport(signatureFailure, "2026-08-02T00:30:00.000Z")
    ).toEqual({ valid: false, failureReasons: ["signature_mismatch"] });

    expect(
      validateEngineeringFileProbeReport(
        { ...report, unexpected: true },
        "2026-08-02T00:30:00.000Z"
      )
    ).toEqual({ valid: false, failureReasons: ["probe_contract_mismatch"] });
  });

  test("rejects future, expired, non-canonical, and overlong probe evidence", () => {
    const report = probeReport();
    expect(validateEngineeringFileProbeReport(report, report.expiresAt)).toEqual({
      valid: false,
      failureReasons: ["evidence_stale"]
    });
    expect(validateEngineeringFileProbeReport(report, "2026-08-01T23:59:59.999Z")).toEqual({
      valid: false,
      failureReasons: ["evidence_stale"]
    });
    expect(validateEngineeringFileProbeReport(report, "2026-08-02T00:30:00Z")).toEqual({
      valid: false,
      failureReasons: ["probe_contract_mismatch"]
    });

    const overlong = checkedProbeReport({
      ...report,
      expiresAt: new Date(
        Date.parse(report.generatedAt) + ENGINEERING_FILE_PROBE_MAX_LIFETIME_MS + 1
      ).toISOString()
    });
    expect(validateEngineeringFileProbeReport(overlong, "2026-08-02T00:30:00.000Z")).toEqual({
      valid: false,
      failureReasons: ["evidence_stale"]
    });
  });

  test("normalizes unavailable evidence to all capabilities off", () => {
    const reasons = [
      "host_partial",
      "evidence_unknown",
      "evidence_stale",
      "digest_mismatch",
      "signature_mismatch",
      "positive_probe_failed",
      "negative_control_failed"
    ] as const;
    const attestation = createUnavailableEngineeringFileQualificationAttestation({
      target: "win32-x64",
      packageKind: "production",
      candidateArtifactPresent: true,
      failureReasons: reasons,
      checkedAt: "2026-08-02T00:30:00.000Z"
    });

    expect(attestation).toMatchObject({
      schemaVersion: ENGINEERING_FILE_QUALIFICATION_VERSION,
      status: "unavailable",
      productionQualified: false,
      capabilities: {
        root: "unavailable",
        access: "unavailable",
        mutation: "unavailable",
        recovery: "unavailable"
      },
      artifactSha256: null,
      probeReportChecksum: null
    });
    expect(Object.isFrozen(attestation)).toBe(true);
    expect(validateEngineeringFileQualificationAttestation(attestation)).toBe(true);
    expect(
      validateEngineeringFileQualificationAttestation({
        ...attestation,
        capabilities: { ...attestation.capabilities, access: "available" }
      })
    ).toBe(false);
  });

  test("requires unsupported targets and candidate states to close with matching reasons", () => {
    expect(() =>
      createUnavailableEngineeringFileQualificationAttestation({
        target: "linux-x64",
        packageKind: "production",
        candidateArtifactPresent: false,
        failureReasons: ["host_missing"],
        checkedAt: "2026-08-02T00:30:00.000Z"
      })
    ).toThrow("ENGINEERING_FILE_QUALIFICATION_INVALID");
    expect(() =>
      createUnavailableEngineeringFileQualificationAttestation({
        target: "win32-x64",
        packageKind: "production",
        candidateArtifactPresent: true,
        failureReasons: ["host_missing"],
        checkedAt: "2026-08-02T00:30:00.000Z"
      })
    ).toThrow("ENGINEERING_FILE_QUALIFICATION_INVALID");

    const unsupported = createUnavailableEngineeringFileQualificationAttestation({
      target: "linux-x64",
      packageKind: "production",
      candidateArtifactPresent: false,
      failureReasons: ["unsupported_platform", "adapter_not_implemented_batch_0"],
      checkedAt: "2026-08-02T00:30:00.000Z"
    });
    expect(validateEngineeringFileQualificationAttestation(unsupported)).toBe(true);
  });

  test("validates a future available shape without treating its ordinary checksum as authority", () => {
    const report = probeReport();
    const unsigned = availableAttestation(report);
    const synthetic = {
      ...unsigned,
      attestationChecksum: engineeringFileQualificationAttestationChecksum(unsigned)
    } satisfies EngineeringFileQualificationAttestationV1;

    expect(validateEngineeringFileQualificationAttestation(synthetic)).toBe(true);
    expect(
      validateEngineeringFileQualificationAttestation(
        checkedAttestation({ ...synthetic, target: "linux-x64" })
      )
    ).toBe(false);
    expect(
      validateEngineeringFileQualificationAttestation(
        checkedAttestation({ ...synthetic, failureReasons: ["signature_mismatch"] })
      )
    ).toBe(false);
    expect(
      validateEngineeringFileQualificationAttestation({
        ...synthetic,
        artifactSha256: "f".repeat(64)
      })
    ).toBe(false);
  });
});

function probeReport(): EngineeringFileProbeReportV1 {
  return checkedProbeReport({
    schemaVersion: ENGINEERING_FILE_PROBE_CONTRACT_VERSION,
    adapterId: ENGINEERING_FILE_NATIVE_ADAPTER_ID,
    target: "win32-x64",
    packageKind: "production",
    artifactSha256: "a".repeat(64),
    artifactManifestSha256: "b".repeat(64),
    artifactManifestSignatureSha256: "c".repeat(64),
    artifactSignatureVerification: "trusted_publisher",
    manifestSignatureVerification: "trusted_publisher",
    digestVerification: "match",
    publisherPolicyChecksum: "d".repeat(64),
    generatedAt: "2026-08-02T00:00:00.000Z",
    expiresAt: "2026-08-02T01:00:00.000Z",
    positiveProtections: {
      rootRelativeTraversal: "passed",
      noFollowTraversal: "passed",
      rawByteIdentity: "passed",
      receiptBinding: "passed",
      durability: "passed",
      recoveryRootBinding: "passed"
    },
    negativeControls: {
      rootRelativeDisabled: "canary_exposed",
      noFollowDisabled: "canary_exposed",
      rawByteIdentityDisabled: "canary_exposed",
      receiptBindingDisabled: "canary_exposed",
      durabilityDisabled: "canary_exposed",
      recoveryRootBindingDisabled: "canary_exposed"
    }
  });
}

function checkedProbeReport(value: Record<string, unknown>): EngineeringFileProbeReportV1 {
  const unsigned = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "reportChecksum")
  );
  return {
    ...unsigned,
    reportChecksum: engineeringFileProbeReportChecksum(
      unsigned as Omit<EngineeringFileProbeReportV1, "reportChecksum">
    )
  } as EngineeringFileProbeReportV1;
}

function availableAttestation(report: EngineeringFileProbeReportV1) {
  return {
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
    artifactSha256: report.artifactSha256,
    artifactManifestSha256: report.artifactManifestSha256,
    probeReportChecksum: report.reportChecksum,
    failureReasons: [] as const,
    checkedAt: "2026-08-02T00:30:00.000Z"
  };
}

function checkedAttestation(
  value: EngineeringFileQualificationAttestationV1
): EngineeringFileQualificationAttestationV1 {
  const unsigned = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "attestationChecksum")
  ) as Omit<EngineeringFileQualificationAttestationV1, "attestationChecksum">;
  return {
    ...unsigned,
    attestationChecksum: engineeringFileQualificationAttestationChecksum(unsigned)
  };
}
