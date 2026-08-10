import { describe, expect, test } from "vitest";

import {
  EngineeringRecoveryRootRepositoryV2,
  InMemoryEngineeringRecoveryRootStoreV2,
  type EngineeringRecoveryGlobalRecordV2,
  type EngineeringRecoveryObjectManifestV2
} from "../src/engineering-recovery-root-repository.js";
import {
  canonicalizeEngineeringMutationV2Json,
  sha256EngineeringMutationTextV2
} from "../src/engineering-file-mutation-port-v2.js";
import {
  issueVolumeLocalRecoveryBindingV2,
  volumeLocalRecoverySideEffectChecksumV2
} from "../src/volume-local-recovery-binding.js";

const hash = (value: string) => sha256EngineeringMutationTextV2(value);

describe("EngineeringRecoveryRootRepositoryV2", () => {
  test("durably binds a global journal record to its volume-local manifest", async () => {
    const binding = createBinding();
    const globals = new InMemoryEngineeringRecoveryRootStoreV2<EngineeringRecoveryGlobalRecordV2>();
    const manifests =
      new InMemoryEngineeringRecoveryRootStoreV2<EngineeringRecoveryObjectManifestV2>();
    const repository = createRepository(binding, globals, manifests);
    const sideEffectChecksum = volumeLocalRecoverySideEffectChecksumV2({
      binding,
      transactionId: "tx_01",
      operationId: "op_01",
      recoveryObjectId: "object_01",
      relativeIdentity: "src/main.ts",
      sourceSha256: hash("source")
    });

    await expect(
      repository.recordQuarantine({
        recoveryObjectId: "object_01",
        transactionId: "tx_01",
        operationId: "op_01",
        relativeIdentity: "src/main.ts",
        sourceSha256: hash("source"),
        byteLength: 32,
        sideEffectChecksum
      })
    ).resolves.toMatchObject({ ok: true, value: { recoveryObjectId: "object_01" } });
    await expect(repository.scanRoot()).resolves.toMatchObject({
      ok: true,
      value: { status: "clear", globalRecordCount: 1, manifestCount: 1, usedBytes: 32 }
    });
  });

  test("blocks for orphaned sides, capacity overflow, or revoked grants", async () => {
    const binding = createBinding({ capacityBytes: 16 });
    const globals = new InMemoryEngineeringRecoveryRootStoreV2<EngineeringRecoveryGlobalRecordV2>();
    const manifests =
      new InMemoryEngineeringRecoveryRootStoreV2<EngineeringRecoveryObjectManifestV2>();
    const repository = createRepository(binding, globals, manifests);
    await manifests.put(createManifest(binding, { byteLength: 32 }));
    await expect(repository.scanRoot()).resolves.toMatchObject({
      ok: true,
      value: {
        status: "blocked",
        reasons: expect.arrayContaining(["orphaned_manifest", "capacity_exceeded"])
      }
    });

    const revoked = createRepository(binding, globals, manifests, async () => false);
    await expect(revoked.scanRoot()).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_RECOVERY_ROOT_BLOCKED" }
    });
  });

  test("restore preview never overwrites an occupied target", async () => {
    const binding = createBinding();
    const globals = new InMemoryEngineeringRecoveryRootStoreV2<EngineeringRecoveryGlobalRecordV2>();
    const manifests =
      new InMemoryEngineeringRecoveryRootStoreV2<EngineeringRecoveryObjectManifestV2>();
    const repository = createRepository(binding, globals, manifests);
    const manifest = createManifest(binding);
    const global = createGlobal(manifest);
    await manifests.put(manifest);
    await globals.put(global);

    await expect(
      repository.createRestorePreview({
        recoveryObjectId: "object_01",
        targetState: "absent",
        pathAllowed: true,
        policyCurrent: true
      })
    ).resolves.toMatchObject({
      ok: true,
      value: { state: "ready", relativeIdentity: "src/main.ts" }
    });
    await expect(
      repository.createRestorePreview({
        recoveryObjectId: "object_01",
        targetState: "present",
        pathAllowed: true,
        policyCurrent: true
      })
    ).resolves.toMatchObject({
      ok: true,
      value: { state: "conflict", conflictReason: "target_occupied" }
    });
  });
});

function createRepository(
  binding: ReturnType<typeof createBinding>,
  globalRecords: InMemoryEngineeringRecoveryRootStoreV2<EngineeringRecoveryGlobalRecordV2>,
  manifests: InMemoryEngineeringRecoveryRootStoreV2<EngineeringRecoveryObjectManifestV2>,
  isGrantCurrent: (binding: ReturnType<typeof createBinding>) => Promise<boolean> = async () => true
) {
  return new EngineeringRecoveryRootRepositoryV2({
    binding,
    globalRecords,
    manifests,
    isGrantCurrent,
    now: () => "2099-01-01T00:00:00.000Z"
  });
}

function createBinding(changes: Record<string, unknown> = {}) {
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
    authority: "installer_managed",
    grantRevision: "grant_01",
    ownershipMarkerChecksum: hash("marker"),
    aclModeQualification: "qualified",
    atomicRenameQualification: "qualified",
    directoryDurabilityQualification: "qualified",
    storageLabel: "Volume recovery storage",
    capacityBytes: 1024,
    reservedBytes: 0,
    retentionDays: 30,
    observedAt: "2099-01-01T00:00:00.000Z",
    ...changes
  };
  const issued = issueVolumeLocalRecoveryBindingV2(
    { ...unsigned, evidenceChecksum: hash(canonicalizeEngineeringMutationV2Json(unsigned)) },
    { authenticateEvidence: () => ({ ok: true, value: undefined }) }
  );
  if (!issued.ok) throw new Error(issued.error.message);
  return issued.value;
}

function createManifest(
  binding: ReturnType<typeof createBinding>,
  changes: Partial<EngineeringRecoveryObjectManifestV2> = {}
): EngineeringRecoveryObjectManifestV2 {
  const unsigned = {
    schemaVersion: "2.0" as const,
    kind: "engineering_recovery_object_manifest" as const,
    recoveryObjectId: "object_01",
    contentRootBindingId: binding.contentRootBindingId,
    recoveryRootBindingId: binding.recoveryRootBindingId,
    transactionId: "tx_01",
    operationId: "op_01",
    relativeIdentity: "src/main.ts",
    sourceSha256: hash("source"),
    byteLength: 8,
    bindingChecksum: binding.bindingChecksum,
    sideEffectChecksum: hash("side-effect"),
    state: "quarantined" as const,
    pinned: false,
    createdAt: "2099-01-01T00:00:00.000Z",
    retentionExpiresAt: "2099-02-01T00:00:00.000Z",
    ...changes
  };
  return { ...unsigned, manifestChecksum: hash(canonicalizeEngineeringMutationV2Json(unsigned)) };
}

function createGlobal(
  manifest: EngineeringRecoveryObjectManifestV2
): EngineeringRecoveryGlobalRecordV2 {
  const unsigned = {
    schemaVersion: "2.0" as const,
    kind: "engineering_recovery_global_record" as const,
    recoveryObjectId: manifest.recoveryObjectId,
    contentRootBindingId: manifest.contentRootBindingId,
    recoveryRootBindingId: manifest.recoveryRootBindingId,
    transactionId: manifest.transactionId,
    operationId: manifest.operationId,
    manifestChecksum: manifest.manifestChecksum,
    state: manifest.state,
    recordedAt: "2099-01-01T00:00:00.000Z"
  };
  return { ...unsigned, recordChecksum: hash(canonicalizeEngineeringMutationV2Json(unsigned)) };
}
