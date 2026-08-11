import {
  EngineeringRecoveryRootRepositoryV2,
  InMemoryEngineeringRecoveryRootStoreV2,
  canonicalizeEngineeringMutationV2Json,
  issueVolumeLocalRecoveryBindingV2,
  sha256EngineeringMutationTextV2,
  type EngineeringFileRestoreReceiptV2,
  type EngineeringQuarantineInventoryV2,
  type EngineeringRecoveryGlobalRecordV2,
  type EngineeringRecoveryObjectManifestV2,
  type EngineeringRecoveryOperationAuthenticatorV2
} from "@novel-studio/repository";
import { createUnifiedError, err, ok } from "@novel-studio/shared";
import { describe, expect, test, vi } from "vitest";
import {
  createDesktopEngineeringRecoveryOperationServiceV2,
  type DesktopEngineeringRecoveryOperationPortV2
} from "../src/main/engineering-recovery-operation-service-v2.js";

const hash = (value: string) => sha256EngineeringMutationTextV2(value);

describe("Desktop engineering recovery operation service V2", () => {
  test("restores only from a fresh ready preview with one exact authorization", async () => {
    const fixture = await createFixture();
    const calls: string[] = [];
    const createPort = vi.fn((authenticate: EngineeringRecoveryOperationAuthenticatorV2) =>
      createPortFixture(fixture, {
        async restore(input) {
          calls.push("native_restore");
          await expect(fixture.repository.read("object_01")).resolves.toMatchObject({
            ok: true,
            value: { state: "quarantined" }
          });
          const authInput = restoreAuthInput(input, fixture);
          expect(authenticate(authInput)).toMatchObject({ ok: true });
          expect(authenticate(authInput)).toMatchObject({
            ok: false,
            error: { code: "ENGINEERING_RECOVERY_OPERATION_UNAUTHORIZED" }
          });
          return ok(restoreReceipt(input));
        }
      })
    );
    const service = createService(fixture, createPort);
    const preview = await service.previewRestore({ recoveryObjectId: "object_01" });
    expect(preview).toMatchObject({ ok: true, value: { state: "ready" } });
    if (!preview.ok) throw new Error(preview.error.message);

    await expect(
      service.restore({
        recoveryObjectId: "object_01",
        previewChecksum: preview.value.previewChecksum
      })
    ).resolves.toMatchObject({ ok: true, value: { state: "restored" } });
    expect(calls).toEqual(["native_restore"]);
    await expect(fixture.repository.read("object_01")).resolves.toMatchObject({
      ok: true,
      value: { state: "restored" }
    });
  });

  test("holds the restore guard through native mutation and workspace synchronization", async () => {
    const fixture = await createFixture();
    const order: string[] = [];
    const service = createService(
      fixture,
      (authenticate) =>
        createPortFixture(fixture, {
          async restore(input) {
            order.push("native_restore");
            const authenticated = authenticate(restoreAuthInput(input, fixture));
            return authenticated.ok ? ok(restoreReceipt(input)) : authenticated;
          }
        }),
      undefined,
      undefined,
      {
        acquireRestoreGuard: async () => {
          order.push("guard_acquire");
          return ok({
            async assertCurrent() {
              order.push("guard_current");
              return ok(undefined);
            },
            release() {
              order.push("guard_release");
            }
          });
        },
        synchronizeRestore: async () => {
          order.push("sync_restore");
          return ok(undefined);
        }
      }
    );
    const preview = await service.previewRestore({ recoveryObjectId: "object_01" });
    if (!preview.ok) throw new Error(preview.error.message);

    await expect(
      service.restore({
        recoveryObjectId: "object_01",
        previewChecksum: preview.value.previewChecksum
      })
    ).resolves.toMatchObject({ ok: true });
    expect(order).toEqual([
      "guard_acquire",
      "guard_current",
      "guard_current",
      "native_restore",
      "sync_restore",
      "guard_release"
    ]);
  });

  test("fails closed for stale or conflicting restore previews", async () => {
    const fixture = await createFixture();
    const restore = vi.fn();
    let targetState: "absent" | "present" = "absent";
    const service = createService(
      fixture,
      (authenticate) => createPortFixture(fixture, { authenticate, restore }),
      async () => ok({ targetState, pathAllowed: true, policyCurrent: true })
    );
    const preview = await service.previewRestore({ recoveryObjectId: "object_01" });
    if (!preview.ok) throw new Error(preview.error.message);
    targetState = "present";

    await expect(
      service.restore({
        recoveryObjectId: "object_01",
        previewChecksum: preview.value.previewChecksum
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_RECOVERY_RESTORE_PREVIEW_STALE" }
    });
    expect(restore).not.toHaveBeenCalled();
  });

  test("persists an exact local purge decision before native purge and marks state after success", async () => {
    const fixture = await createFixture();
    const order: string[] = [];
    const persistPurgeDecision = vi.fn(async () => {
      order.push("decision_durable");
      return ok({ decisionChecksum: hash("durable-purge-decision") });
    });
    const service = createService(
      fixture,
      (authenticate) =>
        createPortFixture(fixture, {
          async purge(input) {
            order.push("native_purge");
            await expect(fixture.repository.read("object_01")).resolves.toMatchObject({
              ok: true,
              value: { state: "quarantined" }
            });
            return authenticate(purgeAuthInput(input, fixture));
          }
        }),
      undefined,
      persistPurgeDecision
    );

    await expect(
      service.purge({
        recoveryObjectId: "object_01",
        actor: "local_user",
        reason: "user_confirmed",
        decidedAt: "2099-01-15T00:00:00.000Z"
      })
    ).resolves.toMatchObject({ ok: true });
    expect(order).toEqual(["decision_durable", "native_purge"]);
    expect(persistPurgeDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: "local_user",
        reason: "user_confirmed",
        contentRootBindingId: "root_01",
        recoveryRootBindingId: "recovery_01"
      })
    );
    await expect(fixture.repository.read("object_01")).resolves.toMatchObject({
      ok: true,
      value: { state: "purged" }
    });
  });

  test("does not reach native purge without durable or exact authorization evidence", async () => {
    const fixture = await createFixture();
    const nativePurge = vi.fn();
    const service = createService(
      fixture,
      (authenticate) =>
        createPortFixture(fixture, {
          async purge(input) {
            const authInput = purgeAuthInput(input, fixture);
            if (authInput.retentionDecision === undefined) {
              throw new Error("purge authorization decision is unavailable");
            }
            const authorized = authenticate({
              ...authInput,
              retentionDecision: {
                ...authInput.retentionDecision,
                recoveryObjectId: "object_tampered"
              }
            });
            if (authorized.ok) nativePurge();
            return authorized;
          }
        }),
      undefined,
      async () => ok({ decisionChecksum: hash("durable-purge-decision") })
    );
    await expect(
      service.purge({
        recoveryObjectId: "object_01",
        actor: "retention_policy",
        reason: "retention_expired",
        decidedAt: "2099-03-01T00:00:00.000Z"
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_RECOVERY_OPERATION_UNAUTHORIZED" }
    });
    expect(nativePurge).not.toHaveBeenCalled();
    await expect(fixture.repository.read("object_01")).resolves.toMatchObject({
      ok: true,
      value: { state: "quarantined" }
    });

    const noDecision = createService(
      fixture,
      () => createPortFixture(fixture, { purge: nativePurge }),
      undefined,
      async () => err(testError("TEST_PURGE_DECISION_WRITE_FAILED"))
    );
    await expect(
      noDecision.purge({
        recoveryObjectId: "object_01",
        actor: "local_user",
        reason: "user_confirmed",
        decidedAt: "2099-01-15T00:00:00.000Z"
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "TEST_PURGE_DECISION_WRITE_FAILED" }
    });
    expect(nativePurge).not.toHaveBeenCalled();
  });
});

async function createFixture() {
  const binding = createBinding();
  const globals = new InMemoryEngineeringRecoveryRootStoreV2<EngineeringRecoveryGlobalRecordV2>();
  const manifests =
    new InMemoryEngineeringRecoveryRootStoreV2<EngineeringRecoveryObjectManifestV2>();
  const manifest = createManifest(binding);
  await manifests.put(manifest);
  await globals.put(createGlobal(manifest));
  const repository = new EngineeringRecoveryRootRepositoryV2({
    binding,
    globalRecords: globals,
    manifests,
    inspectQuarantine: async (current) => {
      const listed = await manifests.list(current.contentRootBindingId);
      if (!listed.ok) return listed;
      return ok(
        createInventory(
          current,
          listed.value
            .filter((candidate) => candidate.state === "quarantined")
            .map((candidate) => ({
              recoveryObjectId: candidate.recoveryObjectId,
              fileIdentity: `file_${candidate.recoveryObjectId}`,
              sha256: candidate.sourceSha256,
              byteLength: BigInt(candidate.byteLength)
            }))
        )
      );
    },
    isGrantCurrent: async () => true,
    now: () => "2099-01-01T00:00:00.000Z"
  });
  return {
    binding,
    repository,
    rootBinding: { contentRootBindingId: "root_01", rootId: 7n },
    recoveryBinding: {
      recoveryRootBindingId: "recovery_01",
      recoveryRootId: 8n,
      grantRevision: "grant_01",
      sideEffectChecksum: binding.bindingChecksum
    }
  } as const;
}

function createService(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  createPort: (
    authenticate: EngineeringRecoveryOperationAuthenticatorV2
  ) => DesktopEngineeringRecoveryOperationPortV2,
  inspectRestoreTarget: Parameters<
    typeof createDesktopEngineeringRecoveryOperationServiceV2
  >[0]["inspectRestoreTarget"] = async () =>
    ok({ targetState: "absent", pathAllowed: true, policyCurrent: true }),
  persistPurgeDecision: Parameters<
    typeof createDesktopEngineeringRecoveryOperationServiceV2
  >[0]["persistPurgeDecision"] = async () =>
    ok({ decisionChecksum: hash("durable-purge-decision") }),
  restoreLifecycle: Partial<
    Pick<
      Parameters<typeof createDesktopEngineeringRecoveryOperationServiceV2>[0],
      "acquireRestoreGuard" | "synchronizeRestore"
    >
  > = {}
) {
  let id = 0;
  return createDesktopEngineeringRecoveryOperationServiceV2({
    repository: fixture.repository,
    contentRootBinding: fixture.rootBinding,
    recoveryBinding: fixture.recoveryBinding,
    createPort,
    inspectRestoreTarget,
    acquireRestoreGuard:
      restoreLifecycle.acquireRestoreGuard ??
      (async () =>
        ok({
          async assertCurrent() {
            return ok(undefined);
          },
          release() {}
        })),
    synchronizeRestore: restoreLifecycle.synchronizeRestore ?? (async () => ok(undefined)),
    persistPurgeDecision,
    now: () => "2099-03-01T00:00:00.000Z",
    allocateId: (kind) => `${kind}_${++id}`
  });
}

function createPortFixture(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  overrides: Partial<DesktopEngineeringRecoveryOperationPortV2> & {
    readonly authenticate?: EngineeringRecoveryOperationAuthenticatorV2;
  } = {}
): DesktopEngineeringRecoveryOperationPortV2 {
  return {
    inspectQuarantine: async () =>
      ok(
        createInventory(fixture.binding, [
          {
            recoveryObjectId: "object_01",
            fileIdentity: "file_object_01",
            sha256: hash("source"),
            byteLength: 8n
          }
        ])
      ),
    restore: overrides.restore ?? (async () => err(testError("TEST_RESTORE_NOT_IMPLEMENTED"))),
    purge: overrides.purge ?? (async () => err(testError("TEST_PURGE_NOT_IMPLEMENTED")))
  };
}

function restoreAuthInput(
  input: Parameters<DesktopEngineeringRecoveryOperationPortV2["restore"]>[0],
  fixture: Awaited<ReturnType<typeof createFixture>>
): Parameters<EngineeringRecoveryOperationAuthenticatorV2>[0] {
  const value = input as {
    readonly request: Parameters<EngineeringRecoveryOperationAuthenticatorV2>[0]["request"];
    readonly recoveryBinding: typeof fixture.recoveryBinding;
  };
  return {
    kind: "restore",
    rootBinding: fixture.rootBinding,
    recoveryBinding: value.recoveryBinding,
    request: value.request
  };
}

function purgeAuthInput(
  input: Parameters<DesktopEngineeringRecoveryOperationPortV2["purge"]>[0],
  fixture: Awaited<ReturnType<typeof createFixture>>
): Parameters<EngineeringRecoveryOperationAuthenticatorV2>[0] {
  const value = input as {
    readonly retentionDecision: NonNullable<
      Parameters<EngineeringRecoveryOperationAuthenticatorV2>[0]["retentionDecision"]
    >;
    readonly recoveryBinding: typeof fixture.recoveryBinding;
  };
  return {
    kind: "purge",
    rootBinding: fixture.rootBinding,
    recoveryBinding: value.recoveryBinding,
    retentionDecision: value.retentionDecision
  };
}

function restoreReceipt(
  input: Parameters<DesktopEngineeringRecoveryOperationPortV2["restore"]>[0]
): EngineeringFileRestoreReceiptV2 {
  const value = input as {
    readonly request: {
      readonly transactionId: string;
      readonly operationId: string;
      readonly contentRootBindingId: string;
      readonly relativeTarget: string;
      readonly recoveryObjectId: string;
    };
  };
  return {
    schemaVersion: "3.0",
    kind: "engineering_file_lifecycle_receipt",
    operationKind: "restore_file",
    transactionId: value.request.transactionId,
    operationId: value.request.operationId,
    contentRootBindingId: value.request.contentRootBindingId,
    relativeSource: "",
    relativeTarget: value.request.relativeTarget,
    state: "restored",
    recoveryObjectId: value.request.recoveryObjectId,
    durability: "data_and_directory_flushed"
  };
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

function createBinding() {
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
    observedAt: "2099-01-01T00:00:00.000Z"
  };
  const issued = issueVolumeLocalRecoveryBindingV2(
    { ...unsigned, evidenceChecksum: hash(canonicalizeEngineeringMutationV2Json(unsigned)) },
    { authenticateEvidence: () => ok(undefined) }
  );
  if (!issued.ok) throw new Error(issued.error.message);
  return issued.value;
}

function createManifest(
  binding: ReturnType<typeof createBinding>
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
    retentionExpiresAt: "2099-02-01T00:00:00.000Z"
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

function testError(code: string) {
  return createUnifiedError({
    code,
    category: "StorageError",
    message: code,
    recoverability: "user-action",
    suggestedAction: "Retry the test operation.",
    traceId: "engineering-recovery-operation-service-v2-test"
  });
}
