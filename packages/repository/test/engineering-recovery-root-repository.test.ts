import { describe, expect, test } from "vitest";

import {
  EngineeringRecoveryRootRepositoryV2,
  InMemoryEngineeringRecoveryRootStoreV2,
  type EngineeringRecoveryGlobalRecordV2,
  type EngineeringRecoveryObjectManifestV2
} from "../src/engineering-recovery-root-repository.js";
import {
  canonicalizeEngineeringMutationV2Json,
  sha256EngineeringMutationTextV2,
  type EngineeringQuarantineInventoryV2
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

  test("accounts for reserved capacity before admitting a quarantine object", async () => {
    const binding = createBinding({ capacityBytes: 16, reservedBytes: 8 });
    const globals = new InMemoryEngineeringRecoveryRootStoreV2<EngineeringRecoveryGlobalRecordV2>();
    const manifests =
      new InMemoryEngineeringRecoveryRootStoreV2<EngineeringRecoveryObjectManifestV2>();
    const repository = createRepository(binding, globals, manifests);

    await expect(
      repository.recordQuarantine(createRecordInput(binding, { byteLength: 9 }))
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_RECOVERY_ROOT_BLOCKED" }
    });
    await expect(repository.scanRoot()).resolves.toMatchObject({
      ok: true,
      value: { status: "clear", usedBytes: 0 }
    });
  });

  test("blocks when native quarantine inventory contains an object absent from both stores", async () => {
    const binding = createBinding();
    const globals = new InMemoryEngineeringRecoveryRootStoreV2<EngineeringRecoveryGlobalRecordV2>();
    const manifests =
      new InMemoryEngineeringRecoveryRootStoreV2<EngineeringRecoveryObjectManifestV2>();
    const repository = createRepository(
      binding,
      globals,
      manifests,
      async () => true,
      async (current) => ({
        ok: true,
        value: createInventory(current, [
          {
            recoveryObjectId: "object_orphan",
            fileIdentity: "file_orphan",
            sha256: hash("orphan"),
            byteLength: 7n
          }
        ])
      })
    );

    await expect(repository.scanRoot()).resolves.toMatchObject({
      ok: true,
      value: { status: "blocked", reasons: ["orphaned_physical_object"] }
    });
  });

  test("fails closed when the native quarantine inventory is unavailable or invalid", async () => {
    const binding = createBinding();
    const globals = new InMemoryEngineeringRecoveryRootStoreV2<EngineeringRecoveryGlobalRecordV2>();
    const manifests =
      new InMemoryEngineeringRecoveryRootStoreV2<EngineeringRecoveryObjectManifestV2>();
    const missingInspector = new EngineeringRecoveryRootRepositoryV2({
      binding,
      globalRecords: globals,
      manifests,
      now: () => "2099-01-01T00:00:00.000Z"
    });
    const invalidInspector = createRepository(
      binding,
      globals,
      manifests,
      async () => true,
      async () => ({
        ok: true,
        value: { ...createInventory(binding), grantRevision: "stale_revision" }
      })
    );

    await expect(missingInspector.scanRoot()).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_RECOVERY_ROOT_BLOCKED" }
    });
    await expect(invalidInspector.scanRoot()).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_RECOVERY_ROOT_BLOCKED" }
    });
  });

  test("detects both durable double-write crash points", async () => {
    const binding = createBinding();
    const firstWriteGlobals =
      new InMemoryEngineeringRecoveryRootStoreV2<EngineeringRecoveryGlobalRecordV2>();
    const firstWriteManifests =
      new FailingEngineeringRecoveryRootStoreV2<EngineeringRecoveryObjectManifestV2>({
        failPutAt: 1
      });
    const firstWriteRepository = createRepository(binding, firstWriteGlobals, firstWriteManifests);
    await expect(
      firstWriteRepository.recordQuarantine(createRecordInput(binding))
    ).resolves.toMatchObject({ ok: false, error: { code: "TEST_RECOVERY_STORE_CRASH" } });
    await expect(firstWriteRepository.scanRoot()).resolves.toMatchObject({
      ok: true,
      value: { status: "clear", globalRecordCount: 0, manifestCount: 0 }
    });

    const secondWriteGlobals =
      new FailingEngineeringRecoveryRootStoreV2<EngineeringRecoveryGlobalRecordV2>({
        failPutAt: 1
      });
    const secondWriteManifests =
      new InMemoryEngineeringRecoveryRootStoreV2<EngineeringRecoveryObjectManifestV2>();
    const secondWriteRepository = createRepository(
      binding,
      secondWriteGlobals,
      secondWriteManifests
    );
    await expect(
      secondWriteRepository.recordQuarantine(createRecordInput(binding))
    ).resolves.toMatchObject({ ok: false, error: { code: "TEST_RECOVERY_STORE_CRASH" } });
    await expect(secondWriteRepository.scanRoot()).resolves.toMatchObject({
      ok: true,
      value: {
        status: "blocked",
        reasons: ["orphaned_manifest"],
        globalRecordCount: 0,
        manifestCount: 1
      }
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

    const revoked = createRepository(binding, globals, manifests, async () => false);
    await expect(
      revoked.createRestorePreview({
        recoveryObjectId: "object_01",
        targetState: "absent",
        pathAllowed: true,
        policyCurrent: true
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_RECOVERY_ROOT_BLOCKED" }
    });

    const changedBinding = createBinding({ grantRevision: "grant_02" });
    const stale = createRepository(changedBinding, globals, manifests);
    await expect(
      stale.createRestorePreview({
        recoveryObjectId: "object_01",
        targetState: "absent",
        pathAllowed: true,
        policyCurrent: true
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_RECOVERY_ROOT_BLOCKED" }
    });
  });

  test("durably transitions restore with compare-and-swap and detects a second-write crash", async () => {
    const binding = createBinding();
    const globals = new FailingEngineeringRecoveryRootStoreV2<EngineeringRecoveryGlobalRecordV2>({
      failReplaceAt: 1
    });
    const manifests =
      new InMemoryEngineeringRecoveryRootStoreV2<EngineeringRecoveryObjectManifestV2>();
    const repository = createRepository(binding, globals, manifests);
    const manifest = createManifest(binding);
    await manifests.put(manifest);
    await globals.put(createGlobal(manifest));
    const preview = await repository.createRestorePreview({
      recoveryObjectId: "object_01",
      targetState: "absent",
      pathAllowed: true,
      policyCurrent: true
    });
    if (!preview.ok) throw new Error(preview.error.message);

    await expect(
      repository.markRestored({
        recoveryObjectId: "object_01",
        at: "2099-01-02T00:00:00.000Z",
        preview: preview.value
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "TEST_RECOVERY_STORE_CRASH" } });
    await expect(repository.scanRoot()).resolves.toMatchObject({
      ok: true,
      value: { status: "blocked", reasons: ["manifest_mismatch"] }
    });
  });

  test("idempotently marks only the exact compensated delete record restored", async () => {
    const binding = createBinding();
    const globals = new InMemoryEngineeringRecoveryRootStoreV2<EngineeringRecoveryGlobalRecordV2>();
    const manifests =
      new InMemoryEngineeringRecoveryRootStoreV2<EngineeringRecoveryObjectManifestV2>();
    const repository = createRepository(binding, globals, manifests);
    const compensation = {
      recoveryObjectId: "object_01",
      transactionId: "tx_01",
      operationId: "op_01",
      sourceSha256: hash("source"),
      at: "2099-01-02T00:00:00.000Z"
    };

    await expect(repository.markCompensated(compensation)).resolves.toEqual({
      ok: true,
      value: undefined
    });
    const manifest = createManifest(binding);
    await manifests.put(manifest);
    await globals.put(createGlobal(manifest));
    await expect(
      repository.markCompensated({ ...compensation, sourceSha256: hash("other") })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_RECOVERY_COMPENSATION_BINDING_MISMATCH" }
    });
    await expect(repository.markCompensated(compensation)).resolves.toMatchObject({
      ok: true,
      value: { state: "restored" }
    });
    await expect(repository.markCompensated(compensation)).resolves.toMatchObject({
      ok: true,
      value: { state: "restored" }
    });
  });

  test("purge remains Main-only and enforces pin and retention-policy boundaries", async () => {
    const binding = createBinding();
    const globals = new InMemoryEngineeringRecoveryRootStoreV2<EngineeringRecoveryGlobalRecordV2>();
    const manifests =
      new InMemoryEngineeringRecoveryRootStoreV2<EngineeringRecoveryObjectManifestV2>();
    const repository = createRepository(binding, globals, manifests);
    const manifest = createManifest(binding);
    await manifests.put(manifest);
    await globals.put(createGlobal(manifest));

    await expect(
      repository.markPurged({
        recoveryObjectId: "object_01",
        actor: "retention_policy",
        reason: "retention_expired",
        at: "2099-01-15T00:00:00.000Z"
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_RECOVERY_STATE_CONFLICT" }
    });

    await expect(
      repository.markPurged({
        recoveryObjectId: "object_01",
        actor: "local_user",
        reason: "user_confirmed",
        at: "2099-01-15T00:00:00.000Z"
      })
    ).resolves.toMatchObject({ ok: true, value: { state: "purged" } });

    const pinnedManifest = createManifest(binding, {
      recoveryObjectId: "object_pinned",
      pinned: true
    });
    await manifests.put(pinnedManifest);
    await globals.put(createGlobal(pinnedManifest));
    await expect(
      repository.markPurged({
        recoveryObjectId: "object_pinned",
        actor: "retention_policy",
        reason: "retention_expired",
        at: "2099-03-01T00:00:00.000Z"
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_RECOVERY_STATE_CONFLICT" }
    });

    await expect(repository.scanRoot()).resolves.toMatchObject({
      ok: true,
      value: { status: "clear", usedBytes: 8 }
    });
  });
});

class FailingEngineeringRecoveryRootStoreV2<
  T extends { readonly recoveryObjectId: string; readonly contentRootBindingId: string }
> extends InMemoryEngineeringRecoveryRootStoreV2<T> {
  private putCount = 0;
  private replaceCount = 0;

  public constructor(
    private readonly failures: { readonly failPutAt?: number; readonly failReplaceAt?: number }
  ) {
    super();
  }

  public override async put(
    value: T
  ): ReturnType<InMemoryEngineeringRecoveryRootStoreV2<T>["put"]> {
    this.putCount += 1;
    if (this.putCount === this.failures.failPutAt)
      return { ok: false, error: { code: "TEST_RECOVERY_STORE_CRASH" } as never };
    return super.put(value);
  }

  public override async replace(
    expected: T,
    value: T
  ): ReturnType<InMemoryEngineeringRecoveryRootStoreV2<T>["replace"]> {
    this.replaceCount += 1;
    if (this.replaceCount === this.failures.failReplaceAt)
      return { ok: false, error: { code: "TEST_RECOVERY_STORE_CRASH" } as never };
    return super.replace(expected, value);
  }
}

function createRepository(
  binding: ReturnType<typeof createBinding>,
  globalRecords: InMemoryEngineeringRecoveryRootStoreV2<EngineeringRecoveryGlobalRecordV2>,
  manifests: InMemoryEngineeringRecoveryRootStoreV2<EngineeringRecoveryObjectManifestV2>,
  isGrantCurrent: (binding: ReturnType<typeof createBinding>) => Promise<boolean> = async () =>
    true,
  inspectQuarantine: NonNullable<
    ConstructorParameters<typeof EngineeringRecoveryRootRepositoryV2>[0]["inspectQuarantine"]
  > = async (current) => {
    const listed = await manifests.list(current.contentRootBindingId);
    if (!listed.ok) return listed;
    return {
      ok: true,
      value: createInventory(
        current,
        listed.value
          .filter((manifest) => manifest.state === "quarantined")
          .map((manifest) => ({
            recoveryObjectId: manifest.recoveryObjectId,
            fileIdentity: `file_${manifest.recoveryObjectId}`,
            sha256: manifest.sourceSha256,
            byteLength: BigInt(manifest.byteLength)
          }))
      )
    };
  }
) {
  return new EngineeringRecoveryRootRepositoryV2({
    binding,
    globalRecords,
    manifests,
    inspectQuarantine,
    isGrantCurrent,
    now: () => "2099-01-01T00:00:00.000Z"
  });
}

function createInventory(
  binding: ReturnType<typeof createBinding>,
  objects: EngineeringQuarantineInventoryV2["objects"] = []
): EngineeringQuarantineInventoryV2 {
  return {
    schemaVersion: "3.0",
    kind: "engineering_quarantine_inventory",
    recoveryRootBindingId: binding.recoveryRootBindingId,
    grantRevision: binding.grantRevision,
    objects
  };
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

function createRecordInput(
  binding: ReturnType<typeof createBinding>,
  changes: { readonly byteLength?: number } = {}
) {
  return {
    recoveryObjectId: "object_01",
    transactionId: "tx_01",
    operationId: "op_01",
    relativeIdentity: "src/main.ts",
    sourceSha256: hash("source"),
    byteLength: changes.byteLength ?? 8,
    sideEffectChecksum: volumeLocalRecoverySideEffectChecksumV2({
      binding,
      transactionId: "tx_01",
      operationId: "op_01",
      recoveryObjectId: "object_01",
      relativeIdentity: "src/main.ts",
      sourceSha256: hash("source")
    })
  };
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
