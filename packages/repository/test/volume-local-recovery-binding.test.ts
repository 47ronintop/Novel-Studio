import { describe, expect, test } from "vitest";

import {
  canonicalizeEngineeringMutationV2Json,
  sha256EngineeringMutationTextV2
} from "../src/engineering-file-mutation-port-v2.js";
import {
  issueVolumeLocalRecoveryBindingV2,
  volumeLocalRecoverySideEffectChecksumV2
} from "../src/volume-local-recovery-binding.js";

const hash = (value: string) => sha256EngineeringMutationTextV2(value);

describe("VolumeLocalRecoveryBindingV2", () => {
  test("issues only authenticated, same-volume, identity-disjoint second-root authority", () => {
    const evidence = createEvidence();
    const issued = issueVolumeLocalRecoveryBindingV2(evidence, {
      authenticateEvidence: () => ({ ok: true, value: undefined }),
      minimumFreeBytes: 128
    });
    expect(issued).toMatchObject({
      ok: true,
      value: {
        recoveryRootBindingId: "recovery_01",
        contentRootBindingId: "root_01",
        authority: "user_os_directory_grant",
        storageLabel: "Recovery storage"
      }
    });
    if (!issued.ok) throw new Error(issued.error.message);
    expect(
      volumeLocalRecoverySideEffectChecksumV2({
        binding: issued.value,
        transactionId: "tx_01",
        operationId: "op_01",
        recoveryObjectId: "recovery_object_01",
        relativeIdentity: "src/main.ts",
        sourceSha256: hash("source")
      })
    ).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(issued.value)).not.toContain("D:\\");
  });

  test.each([
    ["wrong volume", { recoveryVolumeIdentity: "volume_other" }],
    ["same directory identity", { recoveryDirectoryIdentity: "directory_content" }],
    ["ancestor relation", { rootRelationship: "recovery_ancestor" }],
    ["unqualified ACL", { aclModeQualification: "unknown" }],
    ["unqualified atomic rename", { atomicRenameQualification: "unknown" }],
    ["unqualified directory durability", { directoryDurabilityQualification: "unknown" }],
    ["capacity exhausted", { reservedBytes: 1024 }]
  ])("fails closed for %s", (_name, changes) => {
    const issued = issueVolumeLocalRecoveryBindingV2(createEvidence(changes), {
      authenticateEvidence: () => ({ ok: true, value: undefined }),
      minimumFreeBytes: 1
    });
    expect(issued.ok).toBe(false);
  });

  test("rejects unauthenticated or drifted evidence", () => {
    expect(
      issueVolumeLocalRecoveryBindingV2(createEvidence(), {
        authenticateEvidence: () => ({ ok: false, error: { code: "REVOKED" } as never })
      })
    ).toMatchObject({ ok: false, error: { code: "REVOKED" } });
    expect(
      issueVolumeLocalRecoveryBindingV2(
        { ...createEvidence(), grantRevision: "grant_revoked" },
        { authenticateEvidence: () => ({ ok: true, value: undefined }) }
      )
    ).toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_RECOVERY_BINDING_AUTHENTICATION_FAILED" }
    });
  });
});

function createEvidence(changes: Record<string, unknown> = {}) {
  const unsigned = {
    schemaVersion: "2.0",
    recoveryRootBindingId: "recovery_01",
    contentRootBindingId: "root_01",
    recoveryRootId: "native_recovery_01",
    contentVolumeIdentity: "volume_01",
    recoveryVolumeIdentity: "volume_01",
    contentDirectoryIdentity: "directory_content",
    recoveryDirectoryIdentity: "directory_recovery",
    rootRelationship: "identity_disjoint",
    authority: "user_os_directory_grant",
    grantRevision: "grant_01",
    ownershipMarkerChecksum: hash("marker"),
    aclModeQualification: "qualified",
    atomicRenameQualification: "qualified",
    directoryDurabilityQualification: "qualified",
    storageLabel: "Recovery storage",
    capacityBytes: 1024,
    reservedBytes: 0,
    retentionDays: 30,
    observedAt: "2099-01-01T00:00:00.000Z",
    ...changes
  };
  return {
    ...unsigned,
    evidenceChecksum: hash(canonicalizeEngineeringMutationV2Json(unsigned))
  };
}
