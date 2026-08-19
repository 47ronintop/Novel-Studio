import { describe, expect, test } from "vitest";

import {
  LEGACY_ALL_HUMAN_APPROVAL_RULE_SET_CHECKSUM,
  LEGACY_ALL_HUMAN_APPROVAL_RULE_SET_VERSION,
  createApprovalBindingV2,
  createMainOnlyApprovalDecisionProofV1,
  createOperationsChangeSetRevisionV2,
  decideChangeSetApprovalV2,
  defaultEngineeringPathPolicy,
  type MainOnlyApprovalDecisionProofV1
} from "@novel-studio/agent-engine";
import {
  authorizeApprovalBindingV2,
  buildEngineeringApprovalBindingV2,
  createMainApprovalIssuer,
  type AgentRunCapabilityBoundary,
  type EngineeringApprovalLedgerRecordV2
} from "@novel-studio/application";
import type {
  AuthorizationReservationWalV2,
  EngineeringMutationBlobReferenceV2,
  EngineeringWriteTransactionPreparedV2,
  EngineeringWorkspaceAccessSession
} from "@novel-studio/repository";
import {
  createEngineeringAbsenceProofV2,
  createEngineeringMutationReceiptV2,
  createEngineeringRawByteManifestV2,
  createEngineeringWriteTransactionPreparedV2,
  engineeringFileLifecycleRequestChecksumV2,
  engineeringFileMutationRequestChecksumV2,
  engineeringFullAfterManifestChecksumV2,
  engineeringSideEffectSubjectChecksumV2
} from "@novel-studio/repository";
import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import type {
  EngineeringFileAccessAddon,
  EngineeringFileAccessAddonLoader
} from "../src/main/engineering-file-access-adapter.js";
import { createEngineeringEditorStateRegistry } from "../src/main/engineering-editor-state-registry.js";
import {
  createDesktopEngineeringMutationProductionCompositionV2,
  type DesktopEngineeringMutationAuthorizationLedgerV2,
  type DesktopEngineeringMutationProductionCompositionV2,
  type DesktopEngineeringMutationProductionCompositionV2Options
} from "../src/main/engineering-mutation-production-composition-v2.js";

const ROOT_BINDING_ID = "root_01";
const WORKSPACE_BINDING_ID = "workspace_01";
const PATH_POLICY_REVISION = "policy_01";
const STATE_ROOT = "C:\\novel-studio-composition-state";
const NOW = "2099-01-01T00:00:00.000Z";

describe("Desktop Engineering mutation production composition V2", () => {
  test("fails closed without current B7 mutation and recovery qualification", async () => {
    const missingMutation = createHarness({ mutationQualified: false });
    await expect(
      createDesktopEngineeringMutationProductionCompositionV2(missingMutation.options)
    ).resolves.toBeUndefined();

    const missingRecovery = createHarness({ recoveryQualified: false });
    await expect(
      createDesktopEngineeringMutationProductionCompositionV2(missingRecovery.options)
    ).resolves.toBeUndefined();
  });

  test("fails closed when the addon durability ABI or B6 root handle is unavailable", async () => {
    const noDurability = createHarness({ addon: createBatch7Addon({ durability: false }) });
    await expect(
      createDesktopEngineeringMutationProductionCompositionV2(noDurability.options)
    ).resolves.toBeUndefined();

    const batch6 = createHarness();
    await expect(
      createDesktopEngineeringMutationProductionCompositionV2({
        ...batch6.options,
        addonLoader: loadedAddon(batch6.addon, "6")
      })
    ).resolves.toBeUndefined();

    const missingHandle = createHarness({ rootHandleAvailable: false });
    await expect(
      createDesktopEngineeringMutationProductionCompositionV2(missingHandle.options)
    ).resolves.toBeUndefined();
  });

  test("keeps composition unavailable when native staging recovery is pending", async () => {
    let closeStateRootCalls = 0;
    const pending = createHarness({
      addon: createBatch7Addon({
        nativeRecoveryScan: nativeRecoveryScan({
          state: "recovery_required",
          pendingStagingCount: 1n
        }),
        onCloseStateRoot: () => {
          closeStateRootCalls += 1;
        }
      }),
      nativeRecoveryScan: nativeRecoveryScan({
        state: "recovery_required",
        pendingStagingCount: 1n
      })
    });

    await expect(
      createDesktopEngineeringMutationProductionCompositionV2(pending.options)
    ).resolves.toBeUndefined();
    expect(closeStateRootCalls).toBe(1);
  });

  test("keeps the root closed after a durable incomplete lifecycle WAL", async () => {
    const harness = createHarness();
    const first = await createDesktopEngineeringMutationProductionCompositionV2(harness.options);
    if (first === undefined) throw new Error("expected clear production composition");
    await expect(first.lifecycleWalRepository.prepare(lifecyclePrepared())).resolves.toMatchObject({
      ok: true,
      value: { committedAt: null }
    });
    const lifecycleScan = await first.lifecycleWalRepository.scanRoot(ROOT_BINDING_ID);
    await expect(Promise.resolve(lifecycleScan)).resolves.toMatchObject({
      ok: true,
      value: { journals: [{ committedAt: null }] }
    });
    if (!lifecycleScan.ok || lifecycleScan.value.journals[0] === undefined)
      throw new Error("expected lifecycle WAL");
    const lease = await first.recoveryRuntime.transactionGate.acquireMutationLease({
      contentRootBindingId: ROOT_BINDING_ID,
      transactionId: "lifecycle_transaction_01",
      preparedChecksum: lifecycleScan.value.journals[0].preparedChecksum
    });
    expect(lease).toMatchObject({ ok: true });
    if (lease.ok) await lease.value.release();
    first.dispose();

    await expect(
      createDesktopEngineeringMutationProductionCompositionV2(harness.options)
    ).resolves.toBeUndefined();
  });

  test("treats a durably rolled-back lifecycle WAL as terminal during restart scanning", async () => {
    const harness = createHarness();
    const first = await createDesktopEngineeringMutationProductionCompositionV2(harness.options);
    if (first === undefined) throw new Error("expected clear production composition");

    await expect(first.lifecycleWalRepository.prepare(lifecyclePrepared())).resolves.toMatchObject({
      ok: true,
      value: { committedAt: null, rolledBackAt: null }
    });
    await expect(
      first.lifecycleWalRepository.rollback({
        contentRootBindingId: ROOT_BINDING_ID,
        transactionId: "lifecycle_transaction_01",
        rolledBackAt: "2099-01-01T00:00:01.000Z"
      })
    ).resolves.toMatchObject({
      ok: true,
      value: { committedAt: null, rolledBackAt: "2099-01-01T00:00:01.000Z" }
    });
    await expect(
      first.lifecycleWalRepository.markSynchronized({
        contentRootBindingId: ROOT_BINDING_ID,
        transactionId: "lifecycle_transaction_01",
        synchronizedAt: "2099-01-01T00:00:02.000Z"
      })
    ).resolves.toMatchObject({ ok: true, value: { synchronizedAt: expect.any(String) } });
    first.dispose();

    const restarted = await createDesktopEngineeringMutationProductionCompositionV2(
      harness.options
    );
    expect(restarted).toMatchObject({ recoveryRuntime: { status: "clear" } });
    restarted?.dispose();
  });

  test("recovers an incomplete lifecycle WAL under save/editor controls before exposing capabilities", async () => {
    const calls: string[] = [];
    const addon = createBatch7Addon({
      lifecycle: true,
      onLifecycleInspect(request) {
        calls.push("recover:inspect");
        return lifecycleOperationState(request, "before");
      },
      onLifecycleFinalize() {
        calls.push("recover:finalize");
      }
    });
    const workspaceAccessSession = createWorkspaceAccessSession({
      onBuildIndex() {
        calls.push("sync:index");
      }
    });
    const harness = createHarness({
      addon,
      workspaceAccessSession,
      lifecycleRecoveryQualified: () => true,
      verifyPreparedLifecycleAuthorization: async () => {
        calls.push("recover:authorize");
        return ok(undefined);
      },
      saveAuthority: {
        async pauseAndDrainEngineeringRoot() {
          calls.push("save:pause");
          return Object.freeze({
            release() {
              calls.push("save:release");
            }
          });
        }
      },
      editorStateRegistry: {
        observe(input) {
          calls.push(`editor:${input.relativePath}`);
          return { status: "unknown" as const, reason: "missing" as const };
        }
      },
      rendererSynchronizer: {
        async request(input) {
          calls.push(`sync:renderer:${input.operationKind}:${input.relativePaths.join(",")}`);
          return ok(undefined);
        }
      }
    });
    const first = await createDesktopEngineeringMutationProductionCompositionV2(harness.options);
    if (first === undefined) throw new Error("expected clear production composition");
    await expect(first.lifecycleWalRepository.prepare(lifecyclePrepared())).resolves.toMatchObject({
      ok: true,
      value: { committedAt: null, rolledBackAt: null }
    });
    first.dispose();
    calls.length = 0;

    const restarted = await createDesktopEngineeringMutationProductionCompositionV2(
      harness.options
    );

    expect(restarted).toMatchObject({
      recoveryRuntime: { status: "clear" },
      lifecycleCapabilities: { move: true, delete: false, createDirectory: true }
    });
    expect(calls).toEqual([
      "save:pause",
      "editor:src/new.ts",
      "editor:src/old.ts",
      "recover:authorize",
      "recover:inspect",
      "recover:authorize",
      "recover:finalize",
      "sync:renderer:move_file:src/new.ts,src/old.ts",
      "sync:index",
      "save:release"
    ]);
    restarted?.dispose();

    calls.length = 0;
    const settledRestart = await createDesktopEngineeringMutationProductionCompositionV2(
      harness.options
    );
    expect(settledRestart).toMatchObject({ recoveryRuntime: { status: "clear" } });
    expect(calls).toEqual([]);
    settledRestart?.dispose();
  });

  test("persists sync_required and remains unavailable when startup recovery synchronization fails", async () => {
    const calls: string[] = [];
    const addon = createBatch7Addon({
      lifecycle: true,
      onLifecycleInspect(request) {
        calls.push("recover:inspect");
        return lifecycleOperationState(request, "before");
      },
      onLifecycleFinalize() {
        calls.push("recover:finalize");
      }
    });
    let failSynchronization = true;
    const harness = createHarness({
      addon,
      lifecycleRecoveryQualified: () => true,
      verifyPreparedLifecycleAuthorization: async () => ok(undefined),
      saveAuthority: {
        async pauseAndDrainEngineeringRoot() {
          calls.push("save:pause");
          return Object.freeze({
            release() {
              calls.push("save:release");
            }
          });
        }
      },
      rendererSynchronizer: {
        async request() {
          calls.push("sync:renderer");
          return failSynchronization
            ? unavailable("ENGINEERING_TEST_STARTUP_SYNC_FAILED")
            : ok(undefined);
        }
      }
    });
    const first = await createDesktopEngineeringMutationProductionCompositionV2(harness.options);
    if (first === undefined) throw new Error("expected clear production composition");
    await expect(first.lifecycleWalRepository.prepare(lifecyclePrepared())).resolves.toMatchObject({
      ok: true,
      value: { committedAt: null, rolledBackAt: null }
    });
    first.dispose();
    calls.length = 0;

    await expect(
      createDesktopEngineeringMutationProductionCompositionV2(harness.options)
    ).resolves.toBeUndefined();
    expect(calls).toEqual([
      "save:pause",
      "recover:inspect",
      "recover:finalize",
      "sync:renderer",
      "save:release"
    ]);

    failSynchronization = false;
    calls.length = 0;
    await expect(
      createDesktopEngineeringMutationProductionCompositionV2(harness.options)
    ).resolves.toBeUndefined();
    expect(calls).toEqual([]);
  });

  test("keeps composition unavailable for a shared-ledger root-bound orphan reservation", async () => {
    const wal = reservationWal();
    const orphan = createHarness({
      authorizationLedger: createLedger({
        wals: [wal],
        records: [reservedRecord(wal)]
      })
    });

    await expect(
      createDesktopEngineeringMutationProductionCompositionV2(orphan.options)
    ).resolves.toBeUndefined();
  });

  test("checks durable sync_required state before exposing an otherwise clear composition", async () => {
    const harness = createHarness();
    const first = await createDesktopEngineeringMutationProductionCompositionV2(harness.options);
    if (first === undefined) throw new Error("expected clear production composition");
    expect(
      await first.syncRequiredStore.writeSyncRequired({
        schemaVersion: "2.0",
        kind: "sync_required",
        contentRootBindingId: ROOT_BINDING_ID,
        transactionId: "transaction_01",
        operationKind: "create_file",
        relativeIdentities: ["src/new-file.ts"],
        recordedAt: NOW
      })
    ).toMatchObject({ ok: true });
    first.dispose();

    await expect(
      createDesktopEngineeringMutationProductionCompositionV2(harness.options)
    ).resolves.toBeUndefined();
  });

  test("builds a clear Main-only bundle and treats an unopened create target as neutral", async () => {
    let closeStateRootCalls = 0;
    const harness = createHarness({
      addon: createBatch7Addon({
        onCloseStateRoot: () => {
          closeStateRootCalls += 1;
        }
      })
    });
    const composition = await createDesktopEngineeringMutationProductionCompositionV2(
      harness.options
    );
    if (composition === undefined) throw new Error("expected clear production composition");

    expect(composition).toMatchObject({
      refCapabilityRevision: "capability_01",
      session: expect.any(Object),
      runtime: expect.any(Object),
      proposalRepository: expect.any(Object),
      blobStore: expect.any(Object),
      walRepository: expect.any(Object),
      lifecycleWalRepository: expect.any(Object),
      lifecycleTransaction: expect.any(Object),
      lifecycleCapabilities: { move: false, delete: false, createDirectory: false },
      syncRequiredStore: expect.any(Object)
    });
    await expect(
      composition.lifecycleWalRepository.scanRoot(ROOT_BINDING_ID)
    ).resolves.toMatchObject({
      ok: true,
      value: { contentRootBindingId: ROOT_BINDING_ID, journals: [] }
    });
    // The session has no pending proposal for this deliberately synthetic apply request. Reaching
    // that later check proves a missing editor did not incorrectly block a create target.
    await expect(composition.runtime.apply(runtimeRequest())).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_MUTATION_APPLY_CONTEXT_MISSING" }
    });
    composition.dispose();
    composition.dispose();
    expect(closeStateRootCalls).toBe(1);
  });

  test("advertises B8 lifecycle operations only with native exports, authorization, and full recovery qualification", async () => {
    const enabled = createHarness({
      addon: createBatch7Addon({ lifecycle: true }),
      verifyPreparedLifecycleAuthorization: async () => ok(undefined),
      lifecycleRecoveryQualified: () => true
    });
    const composition = await createDesktopEngineeringMutationProductionCompositionV2({
      ...enabled.options,
      addonLoader: loadedAddon(enabled.addon, "8")
    });
    expect(composition?.lifecycleCapabilities).toEqual({
      move: true,
      delete: false,
      createDirectory: true
    });
    composition?.dispose();
  });

  test("opens delete only with handle-bound volume recovery capacity and durable stores", async () => {
    const enabled = createHarness({
      addon: createBatch7Addon({ lifecycle: true, volumeRecovery: true }),
      verifyPreparedLifecycleAuthorization: async () => ok(undefined),
      lifecycleRecoveryQualified: () => true
    });
    const composition = await createDesktopEngineeringMutationProductionCompositionV2({
      ...enabled.options,
      contentRootNativeIdentity: {
        volumeIdentity: "volume_01",
        directoryIdentity: "directory_content_01",
        canonicalPathIdentityChecksum: "a".repeat(64)
      },
      lifecycleRecoveryQualificationRevision: "qualification_01",
      addonLoader: loadedAddon(enabled.addon, "8")
    });

    expect(composition?.lifecycleCapabilities).toEqual({
      move: true,
      delete: true,
      createDirectory: true
    });
    expect(composition?.recoveryRootRepository).toBeDefined();
    expect(composition?.recoveryOperationService).toBeDefined();
    await expect(composition?.recoveryRootRepository?.scanRoot()).resolves.toMatchObject({
      ok: true,
      value: { status: "clear", reasons: [] }
    });
    composition?.dispose();
  });

  test("blocks reported-unknown and disconnected create targets before proposal revalidation", async () => {
    for (const connection of ["unknown", "disconnected"] as const) {
      const harness = createHarness();
      expect(
        harness.editorStateRegistry.report({
          rootBindingId: ROOT_BINDING_ID,
          relativePath: "src/new-file.ts",
          editorInstanceId: `editor_${connection}`,
          connection,
          rendererRevision: 0,
          acknowledgedRevision: 0,
          dirty: false,
          bufferChecksum: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          bufferContent: ""
        })
      ).toMatchObject({ ok: true });
      const composition = await createDesktopEngineeringMutationProductionCompositionV2(
        harness.options
      );
      if (composition === undefined) throw new Error("expected clear production composition");

      await expect(composition.runtime.apply(runtimeRequest())).resolves.toMatchObject({
        ok: false,
        error: { code: "ENGINEERING_MUTATION_RUNTIME_EDITOR_STATE_UNKNOWN" }
      });
      composition.dispose();
    }
  });

  test("allows the exact prepared WAL to acquire a lease when native staging is clear", async () => {
    const ledger = createMutableLedger();
    const harness = createHarness({ authorizationLedger: ledger.ledger });
    const composition = await createDesktopEngineeringMutationProductionCompositionV2(
      harness.options
    );
    if (composition === undefined) throw new Error("expected clear production composition");

    const wal = reservationWal();
    const candidate = await composition.blobStore.put({
      contentRootBindingId: ROOT_BINDING_ID,
      bytes: new TextEncoder().encode("export const created = true;\n")
    });
    if (!candidate.ok) throw new Error(candidate.error.message);
    ledger.set(wal, reservedRecord(wal));
    const prepared = preparedCreate(wal, candidate.value);
    expect(await composition.walRepository.prepare(prepared)).toMatchObject({ ok: true });

    const lease = await composition.recoveryRuntime.transactionGate.acquireMutationLease({
      contentRootBindingId: ROOT_BINDING_ID,
      transactionId: wal.transactionId,
      preparedChecksum: prepared.preparedChecksum
    });
    expect(lease).toMatchObject({ ok: true, value: { transactionId: wal.transactionId } });
    if (lease.ok) await lease.value.release();
    composition.dispose();
  });

  test("reopens a committed, clear transaction after restart", async () => {
    const ledger = createMutableLedger();
    const harness = createHarness({ authorizationLedger: ledger.ledger });
    const first = await createDesktopEngineeringMutationProductionCompositionV2(harness.options);
    if (first === undefined) throw new Error("expected clear production composition");

    const wal = reservationWal();
    const candidateBytes = new TextEncoder().encode("export const created = true;\n");
    const candidate = await first.blobStore.put({
      contentRootBindingId: ROOT_BINDING_ID,
      bytes: candidateBytes
    });
    if (!candidate.ok) throw new Error(candidate.error.message);
    ledger.set(wal, reservedRecord(wal));
    const prepared = preparedCreate(wal, candidate.value);
    expect(await first.walRepository.prepare(prepared)).toMatchObject({ ok: true });

    const operation = prepared.operations[0];
    if (operation === undefined) throw new Error("expected one prepared operation");
    const receipt = createEngineeringMutationReceiptV2({
      transactionId: operation.transactionId,
      operationId: operation.operationId,
      operationKind: operation.operationKind,
      contentRootBindingId: operation.contentRootBindingId,
      providerSemanticVersionSetChecksum: operation.providerSemanticVersionSetChecksum,
      relativeIdentity: operation.relativeIdentity,
      requestChecksum: engineeringFileMutationRequestChecksumV2(operation),
      observedBefore: operation.before,
      observedAfter: createEngineeringRawByteManifestV2({
        identity: {
          kind: "observed_file",
          rootBindingId: ROOT_BINDING_ID,
          relativeIdentity: operation.relativeIdentity,
          fileIdentity: "file_01"
        },
        bytes: candidateBytes,
        metadataChecksum: "c".repeat(64)
      }),
      stagingObjectId: operation.stagingObjectId,
      recoveryObjectId: null,
      durability: "data_and_directory_flushed"
    });
    expect(
      await first.walRepository.appendProgress({
        contentRootBindingId: ROOT_BINDING_ID,
        transactionId: wal.transactionId,
        receipt,
        recordedAt: NOW
      })
    ).toMatchObject({ ok: true });
    expect(
      await first.walRepository.commit({
        contentRootBindingId: ROOT_BINDING_ID,
        transactionId: wal.transactionId,
        fullAfterManifestChecksum: engineeringFullAfterManifestChecksumV2([receipt]),
        committedAt: NOW
      })
    ).toMatchObject({ ok: true });
    ledger.set(
      { ...wal, state: "committed", updatedAt: NOW },
      { ...reservedRecord(wal), state: "consumed", consumedAt: NOW }
    );
    first.dispose();

    const restarted = await createDesktopEngineeringMutationProductionCompositionV2(
      harness.options
    );
    expect(restarted).toMatchObject({ recoveryRuntime: { status: "clear" } });
    restarted?.dispose();
  });

  test("permits the live reserve-to-WAL handoff and revokes a provably unprepared failure", async () => {
    const proofState: { value?: MainOnlyApprovalDecisionProofV1 } = {};
    const ledger = createMutableLedger();
    const harness = createHarness({
      authorizationLedger: ledger.ledger,
      readApprovalDecisionProof: async () => ok(proofState.value),
      validateStagingReservation: async () =>
        unavailable("ENGINEERING_TEST_STAGING_RESERVATION_BLOCK")
    });
    const composition = await createDesktopEngineeringMutationProductionCompositionV2(
      harness.options
    );
    if (composition === undefined) throw new Error("expected clear production composition");

    const live = await prepareLiveReservedCreateApply(composition, ledger);
    proofState.value = live.proof;
    await expect(
      composition.session.apply({ changeSet: live.changeSet, approval: live.approval })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_TEST_STAGING_RESERVATION_BLOCK" }
    });

    const authorizationId = live.approval.authorizationId;
    const transactionId = live.approval.reservationTransactionId;
    if (authorizationId === undefined || transactionId === undefined) {
      throw new Error("expected reserved shared approval");
    }
    await expect(ledger.ledger.query(authorizationId, transactionId)).resolves.toMatchObject({
      ok: true,
      value: { state: "revoked" }
    });
    // The failed staging preflight produced no durable Engineering WAL, so Main revokes the
    // reservation before releasing its live handoff and the root remains usable.
    await expect(
      composition.recoveryRuntime.startupGate.assertMutationAllowed(ROOT_BINDING_ID)
    ).resolves.toMatchObject({
      ok: true
    });
    composition.dispose();
  });
});

function createHarness(
  input: {
    readonly mutationQualified?: boolean;
    readonly recoveryQualified?: boolean;
    readonly rootHandleAvailable?: boolean;
    readonly nativeRecoveryScan?: unknown;
    readonly authorizationLedger?: DesktopEngineeringMutationAuthorizationLedgerV2;
    readonly addon?: ReturnType<typeof createBatch7Addon>;
    readonly readApprovalDecisionProof?: DesktopEngineeringMutationProductionCompositionV2Options["readApprovalDecisionProof"];
    readonly validateStagingReservation?: DesktopEngineeringMutationProductionCompositionV2Options["validateStagingReservation"];
    readonly verifyPreparedLifecycleAuthorization?: DesktopEngineeringMutationProductionCompositionV2Options["verifyPreparedLifecycleAuthorization"];
    readonly lifecycleRecoveryQualified?: DesktopEngineeringMutationProductionCompositionV2Options["lifecycleRecoveryQualified"];
    readonly workspaceAccessSession?: EngineeringWorkspaceAccessSession;
    readonly saveAuthority?: DesktopEngineeringMutationProductionCompositionV2Options["saveAuthority"];
    readonly editorStateRegistry?: DesktopEngineeringMutationProductionCompositionV2Options["editorStateRegistry"];
    readonly rendererSynchronizer?: DesktopEngineeringMutationProductionCompositionV2Options["rendererSynchronizer"];
  } = {}
) {
  const editorStateRegistry = input.editorStateRegistry ?? createEngineeringEditorStateRegistry();
  const addon = input.addon ?? createBatch7Addon({ nativeRecoveryScan: input.nativeRecoveryScan });
  const workspaceAccessSession =
    input.workspaceAccessSession ??
    createWorkspaceAccessSession({ rootHandleAvailable: input.rootHandleAvailable });
  const options: DesktopEngineeringMutationProductionCompositionV2Options = {
    projectId: "project_01",
    workspaceBindingId: WORKSPACE_BINDING_ID,
    stateRoot: STATE_ROOT,
    workspaceAccessSession,
    pathPolicy: defaultEngineeringPathPolicy,
    refCapabilityRevision: "capability_01",
    capabilityAuthority: createQualificationService({
      mutation: input.mutationQualified ?? true,
      recovery: input.recoveryQualified ?? true
    }),
    authorizationLedger: input.authorizationLedger ?? createLedger(),
    trustedApprovalQualified: () => true,
    readApprovalDecisionProof: input.readApprovalDecisionProof ?? (async () => ok(undefined)),
    authenticateNativeEvidence: () => ok(undefined),
    authenticateNativeProposalEvidence: () => ok(undefined),
    recovery: {
      verifyPreparedAuthorization: async () => ok(undefined),
      scanLegacyRecovery: async () => ok({ status: "clean" as const })
    },
    ...(input.verifyPreparedLifecycleAuthorization === undefined
      ? {}
      : {
          verifyPreparedLifecycleAuthorization: input.verifyPreparedLifecycleAuthorization
        }),
    ...(input.lifecycleRecoveryQualified === undefined
      ? {}
      : { lifecycleRecoveryQualified: input.lifecycleRecoveryQualified }),
    validateStagingReservation: input.validateStagingReservation ?? (async () => ok(undefined)),
    saveAuthority:
      input.saveAuthority ??
      Object.freeze({
        async pauseAndDrainEngineeringRoot() {
          return Object.freeze({ release() {} });
        }
      }),
    editorStateRegistry,
    rendererSynchronizer:
      input.rendererSynchronizer ??
      Object.freeze({
        async request() {
          return ok(undefined);
        }
      }),
    addonLoader: loadedAddon(addon),
    now: () => NOW
  };
  return { options, addon, editorStateRegistry, workspaceAccessSession };
}

function createQualificationService(input: {
  readonly mutation: boolean;
  readonly recovery: boolean;
}) {
  return {
    async readAttestation() {
      throw new Error("attestation is not needed by this Main-only composition seam");
    },
    async hasCapability(capability: "mutation" | "recovery") {
      return capability === "mutation" ? input.mutation : input.recovery;
    },
    subscribeRevocation() {
      return () => {};
    }
  };
}

function createWorkspaceAccessSession(input: {
  readonly rootHandleAvailable?: boolean;
  readonly onBuildIndex?: () => void;
}) {
  const rootHandleAvailable = input.rootHandleAvailable ?? true;
  return {
    binding: {
      rootBindingId: ROOT_BINDING_ID,
      pathPolicyRevision: PATH_POLICY_REVISION
    },
    getMainOnlyRootHandleBindingV2: () =>
      rootHandleAvailable
        ? {
            contentRootBindingId: ROOT_BINDING_ID,
            pathPolicyRevision: PATH_POLICY_REVISION,
            rootId: 7n
          }
        : undefined,
    async listDirectory() {
      return ok({ entries: [] });
    },
    async readTextFile() {
      return unavailable("ENGINEERING_TEST_READ_UNAVAILABLE");
    },
    async searchText() {
      return ok({ matches: [], truncated: false });
    },
    async buildIndex() {
      input.onBuildIndex?.();
      return ok({ files: [], truncated: false });
    },
    async close() {
      return ok({ closed: true });
    }
  } as unknown as EngineeringWorkspaceAccessSession;
}

function createLedger(
  input: {
    readonly wals?: readonly AuthorizationReservationWalV2[];
    readonly records?: readonly EngineeringApprovalLedgerRecordV2[];
  } = {}
): DesktopEngineeringMutationAuthorizationLedgerV2 {
  let wals = input.wals ?? [];
  const records = new Map(input.records?.map((record) => [record.authorizationId, record]) ?? []);
  return {
    async query(authorizationId: string, transactionId?: string) {
      const record = records.get(authorizationId);
      if (record === undefined || record.reservedTransactionId !== transactionId) {
        return unavailable<EngineeringApprovalLedgerRecordV2>("ENGINEERING_TEST_LEDGER_NOT_FOUND");
      }
      return ok(record);
    },
    async consume() {
      return ok(undefined);
    },
    async revoke(authorizationId: string) {
      const record = records.get(authorizationId);
      if (record === undefined) {
        return unavailable<EngineeringApprovalLedgerRecordV2>("ENGINEERING_TEST_LEDGER_NOT_FOUND");
      }
      const revoked = { ...record, state: "revoked" as const };
      records.set(authorizationId, revoked);
      wals = wals.map((wal) =>
        wal.authorizationId === authorizationId
          ? { ...wal, state: "aborted" as const, updatedAt: NOW }
          : wal
      );
      return ok(revoked);
    },
    async listReservationWals() {
      return ok(wals);
    }
  };
}

function createMutableLedger() {
  let wals: readonly AuthorizationReservationWalV2[] = [];
  const records = new Map<string, EngineeringApprovalLedgerRecordV2>();
  const ledger: DesktopEngineeringMutationAuthorizationLedgerV2 = {
    async query(authorizationId: string, transactionId?: string) {
      const record = records.get(authorizationId);
      if (record === undefined || record.reservedTransactionId !== transactionId) {
        return unavailable<EngineeringApprovalLedgerRecordV2>("ENGINEERING_TEST_LEDGER_NOT_FOUND");
      }
      return ok(record);
    },
    async consume() {
      return ok(undefined);
    },
    async revoke(authorizationId: string) {
      const record = records.get(authorizationId);
      if (record === undefined) {
        return unavailable<EngineeringApprovalLedgerRecordV2>("ENGINEERING_TEST_LEDGER_NOT_FOUND");
      }
      const revoked = { ...record, state: "revoked" as const };
      records.set(authorizationId, revoked);
      wals = wals.map((wal) =>
        wal.authorizationId === authorizationId
          ? { ...wal, state: "aborted" as const, updatedAt: NOW }
          : wal
      );
      return ok(revoked);
    },
    async listReservationWals() {
      return ok(wals);
    }
  };
  return {
    ledger,
    set(wal: AuthorizationReservationWalV2, record: EngineeringApprovalLedgerRecordV2) {
      wals = [wal];
      records.set(record.authorizationId, record);
    }
  };
}

function reservationWal(): AuthorizationReservationWalV2 {
  return {
    schemaVersion: "2.0",
    walId: "reservation_wal_01",
    authorizationId: "authorization_01",
    transactionId: "transaction_01",
    state: "prepared",
    createdAt: NOW,
    updatedAt: NOW
  };
}

function reservedRecord(
  wal: AuthorizationReservationWalV2,
  binding: EngineeringApprovalLedgerRecordV2["binding"] = {
    rootBindingId: ROOT_BINDING_ID
  } as EngineeringApprovalLedgerRecordV2["binding"]
): EngineeringApprovalLedgerRecordV2 {
  return {
    schemaVersion: "2.0",
    authorizationId: wal.authorizationId,
    binding,
    providerSemanticVersionSetChecksum: "a".repeat(64),
    state: "reserved",
    issuedAt: NOW,
    expiresAt: "2099-01-01T01:00:00.000Z",
    reservedTransactionId: wal.transactionId,
    reservedAt: NOW,
    reserveWalId: wal.walId
  };
}

function runtimeRequest() {
  return {
    schemaVersion: "2.0" as const,
    operationKind: "create_file" as const,
    contentRootBindingId: ROOT_BINDING_ID,
    relativeIdentities: ["src/new-file.ts"],
    proposalRevision: "proposal_01",
    proposalBindingChecksum: "a".repeat(64),
    approvalBindingId: "approval_01",
    approvalBindingChecksum: "b".repeat(64),
    capabilityRevision: "capability_01",
    transactionInput: {}
  };
}

function lifecyclePrepared() {
  return {
    schemaVersion: "2.0" as const,
    transactionId: "lifecycle_transaction_01",
    contentRootBindingId: ROOT_BINDING_ID,
    providerSemanticVersionSetChecksum: "a".repeat(64),
    authorization: {
      authorizationId: "lifecycle_authorization_01",
      approvalBindingId: "lifecycle_approval_01",
      approvalBindingChecksum: "b".repeat(64),
      sideEffectSubjectChecksum: "c".repeat(64),
      changeSetId: "lifecycle_change_set_01",
      changeSetRevision: 1,
      changeSetChecksum: "d".repeat(64)
    },
    operations: [
      {
        request: {
          schemaVersion: "3.0" as const,
          operationKind: "move_file" as const,
          transactionId: "lifecycle_transaction_01",
          operationId: "lifecycle_operation_01",
          contentRootBindingId: ROOT_BINDING_ID,
          relativeSource: "src/old.ts",
          relativeTarget: "src/new.ts",
          sourceFileIdentity: "file_lifecycle_01",
          sourceSha256: "e".repeat(64),
          targetProof: "absent" as const,
          recoveryRootBindingId: "",
          recoveryGrantRevision: "",
          recoverySideEffectChecksum: "f".repeat(64),
          recoveryObjectId: "",
          stagingObjectId: "staging_lifecycle_01",
          expectedState: "wal_prepared" as const
        },
        recoveryBinding: null
      }
    ],
    preparedAt: NOW
  };
}

function preparedCreate(
  wal: AuthorizationReservationWalV2,
  candidateBlob: EngineeringMutationBlobReferenceV2
): EngineeringWriteTransactionPreparedV2 {
  const candidateBytes = new TextEncoder().encode("export const created = true;\n");
  const relativeIdentity = "src/new-file.ts";
  const candidateManifest = createEngineeringRawByteManifestV2({
    identity: {
      kind: "target",
      rootBindingId: ROOT_BINDING_ID,
      relativeIdentity,
      fileIdentity: null
    },
    bytes: candidateBytes,
    metadataChecksum: "c".repeat(64)
  });
  const operation = {
    schemaVersion: "2.0" as const,
    operationKind: "create_file" as const,
    contentRootBindingId: ROOT_BINDING_ID,
    transactionId: wal.transactionId,
    operationId: "operation_01",
    providerSemanticVersionSetChecksum: "a".repeat(64),
    relativeIdentity,
    before: {
      schemaVersion: "2.0" as const,
      kind: "absent" as const,
      absenceProof: createEngineeringAbsenceProofV2({
        rootBindingId: ROOT_BINDING_ID,
        relativeIdentity,
        parentDirectoryIdentity: "src",
        observedAt: NOW
      })
    },
    candidate: {
      schemaVersion: "2.0" as const,
      manifest: candidateManifest,
      blob: candidateBlob
    },
    stagingObjectId: "staging_01"
  };
  return createEngineeringWriteTransactionPreparedV2({
    transactionId: wal.transactionId,
    contentRootBindingId: ROOT_BINDING_ID,
    providerSemanticVersionSetChecksum: "a".repeat(64),
    authorization: {
      authorizationId: wal.authorizationId,
      approvalBindingId: "approval_01",
      approvalBindingChecksum: "b".repeat(64),
      sideEffectSubjectChecksum: engineeringSideEffectSubjectChecksumV2({
        transactionId: wal.transactionId,
        contentRootBindingId: ROOT_BINDING_ID,
        providerSemanticVersionSetChecksum: "a".repeat(64),
        operations: [operation]
      }),
      changeSetId: "changeset_01",
      changeSetRevision: 1,
      changeSetChecksum: "d".repeat(64)
    },
    operations: [operation],
    preparedAt: NOW
  });
}

async function prepareLiveReservedCreateApply(
  composition: DesktopEngineeringMutationProductionCompositionV2,
  ledger: ReturnType<typeof createMutableLedger>
) {
  const parentRef = composition.refRegistry.issue({
    kind: "directory",
    rootBindingId: ROOT_BINDING_ID,
    pathPolicyRevision: PATH_POLICY_REVISION,
    relativeIdentity: "src",
    sourceNativeRefChecksum: "a".repeat(64),
    issuedCapabilityRevision: "capability_01"
  });
  if (parentRef === undefined) throw new Error("expected Main-only directory reference");
  const prepared = expectOk(
    await composition.session.prepare({
      runId: "run_01",
      projectId: "project_01",
      toolCallId: "create_call_01",
      toolName: "propose_file_create",
      arguments: {
        parentRef: parentRef.opaqueRef,
        name: "new-file.ts",
        candidate: "export const created = true;\n"
      },
      canonicalPayloadChecksum: "b".repeat(64),
      writePolicy: "write_before_confirmation",
      boundary: proposalBoundary()
    })
  );
  if (prepared.changeSetMutation.kind !== "create_file") {
    throw new Error("expected a create-file mutation");
  }
  const changeSet = createOperationsChangeSetRevisionV2({
    changeSetId: "changeset_01",
    runId: "run_01",
    projectId: "project_01",
    checkpointId: "checkpoint_01",
    contextSnapshotId: "context_01",
    writePolicy: "write_before_confirmation",
    operations: [prepared.changeSetMutation.operation],
    createdAt: NOW,
    providerSemanticVersionSetChecksum: "a".repeat(64)
  });
  expectOk(await composition.session.bindChangeSet({ prepared, changeSet }));
  const request = approvalProofRequest(changeSet);
  const proofInput = expectOk(await composition.session.prepareApprovalProofInput(request));
  const proof = createMainOnlyApprovalDecisionProofV1({
    proofId: "proof_01",
    approvalRuleSetVersion: LEGACY_ALL_HUMAN_APPROVAL_RULE_SET_VERSION,
    approvalRuleSetChecksum: LEGACY_ALL_HUMAN_APPROVAL_RULE_SET_CHECKSUM,
    operation: proofInput.operationKind,
    binding: {
      workspaceBindingId: WORKSPACE_BINDING_ID,
      rootBindingId: proofInput.rootBindingId,
      runId: changeSet.runId,
      changeSetId: changeSet.changeSetId,
      changeSetRevision: changeSet.revision,
      changeSetChecksum: changeSet.checksum,
      consistencyGroupChecksum: proofInput.selectionChecksum,
      proposalPayloadChecksum: proofInput.proposalPayloadChecksum,
      baseManifestChecksum: proofInput.baseManifestChecksum,
      candidateManifestChecksum: proofInput.candidateManifestChecksum,
      executionWritePolicy: "write_before_confirmation",
      policyRevision: PATH_POLICY_REVISION,
      capabilityRevision: "capability_01"
    },
    evidence: proofInput.evidence
  });
  const facts = expectOk(
    await composition.session.finalizeApprovalFacts({
      changeSet,
      proof,
      proofInput,
      ...request
    })
  );
  const seed = expectOk(
    buildEngineeringApprovalBindingV2({
      schemaVersion: "2.0",
      changeSet,
      facts,
      issuedAt: NOW,
      expiresAt: "2099-01-01T01:00:00.000Z"
    })
  );
  const binding = createApprovalBindingV2(seed);
  authorizeApprovalBindingV2(binding, createMainApprovalIssuer());
  const wal = reservationWal();
  ledger.set(wal, reservedRecord(wal, binding));
  const approval = expectOk(
    decideChangeSetApprovalV2({
      changeSet,
      decision: "apply_selected",
      displayBindingChecksum: changeSet.displayBindingChecksum,
      binding,
      authorizationId: wal.authorizationId,
      reservationTransactionId: wal.transactionId,
      trustedConfirmationQualified: true,
      resolvedAt: NOW,
      now: Date.parse(NOW)
    })
  );
  return { changeSet, approval, proof };
}

function proposalBoundary() {
  return {
    workspaceBindingId: WORKSPACE_BINDING_ID,
    providerSemanticVersionSetChecksum: "a".repeat(64),
    policyRevision: PATH_POLICY_REVISION,
    capabilityRevision: "capability_01",
    approvalRuleSetVersion: LEGACY_ALL_HUMAN_APPROVAL_RULE_SET_VERSION,
    approvalRuleSetChecksum: LEGACY_ALL_HUMAN_APPROVAL_RULE_SET_CHECKSUM
  };
}

function approvalProofRequest(changeSet: ReturnType<typeof createOperationsChangeSetRevisionV2>) {
  return {
    changeSet,
    boundary: capabilityBoundary(),
    workspaceBindingId: WORKSPACE_BINDING_ID,
    approvalRuleSet: {
      version: LEGACY_ALL_HUMAN_APPROVAL_RULE_SET_VERSION,
      checksum: LEGACY_ALL_HUMAN_APPROVAL_RULE_SET_CHECKSUM,
      catalogRevision: "capability_01"
    }
  };
}

function capabilityBoundary(): AgentRunCapabilityBoundary {
  return {
    canonicalRootIdentityChecksum: "a".repeat(64),
    effectiveCapabilityStateChecksum: "b".repeat(64),
    sharingDefaultsRevision: "sharing_defaults_01",
    sharingGrantRevision: "sharing_grant_01",
    policyRevision: PATH_POLICY_REVISION,
    providerToolProjectionChecksum: "c".repeat(64),
    providerSemanticVersionSetChecksum: "a".repeat(64)
  };
}

function expectOk<T>(result: Result<T, UnifiedError>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

function loadedAddon(
  addon: unknown,
  batch: "6" | "7" | "8" = "7"
): EngineeringFileAccessAddonLoader {
  return {
    load() {
      return {
        status: "loaded" as const,
        addon: addon as EngineeringFileAccessAddon,
        metadata:
          batch === "6"
            ? {
                adapterId: "novel_studio_engineering_file_access" as const,
                target: "win32-x64" as const,
                batch: "6" as const,
                accessEligible: "available" as const,
                mutation: "unavailable" as const,
                recovery: "unavailable" as const
              }
            : {
                adapterId: "novel_studio_engineering_file_access" as const,
                target: "win32-x64" as const,
                batch,
                accessEligible: "available" as const,
                mutation: "available" as const,
                recovery: "available" as const,
                mutationV2Probe: "available" as const,
                recoveryScanProbe: "available" as const,
                stateDurabilityProbe: "available" as const
              }
      };
    }
  };
}

function createBatch7Addon(
  input: {
    readonly durability?: boolean;
    readonly nativeRecoveryScan?: unknown;
    readonly onCloseStateRoot?: () => void;
    readonly lifecycle?: boolean;
    readonly onLifecycleInspect?: (
      request: Record<string, unknown>
    ) => ReturnType<typeof lifecycleOperationState>;
    readonly onLifecycleFinalize?: (request: Record<string, unknown>) => void;
    readonly volumeRecovery?: boolean;
  } = {}
) {
  const files = new Map<string, Uint8Array>();
  const handles = new Map<bigint, { readonly path: string; bytes: Uint8Array }>();
  let nextHandle = 1n;
  const missing = () => {
    throw Object.assign(new Error("missing"), { code: "ENGINEERING_ACCESS_NOT_FOUND" });
  };
  const stateDurability = {
    openEngineeringStateRoot: () => 1n,
    closeEngineeringStateRoot: () => input.onCloseStateRoot?.(),
    ensureEngineeringStateDirectoryNoFollow: () => undefined,
    flushEngineeringStateDirectory: () => undefined,
    openEngineeringStateExclusiveNoFollow: (_rootId: bigint, path: string) => {
      if (files.has(path)) throw Object.assign(new Error("exists"), { code: "EEXIST" });
      const handle = nextHandle++;
      handles.set(handle, { path, bytes: new Uint8Array() });
      return handle;
    },
    writeEngineeringStateFile: (handle: bigint, bytes: Uint8Array) => {
      const current = handles.get(handle);
      if (current === undefined) throw new Error("closed");
      current.bytes = new Uint8Array(bytes);
    },
    syncEngineeringStateFile: (handle: bigint) => {
      if (!handles.has(handle)) throw new Error("closed");
    },
    closeEngineeringStateFile: (handle: bigint) => {
      const current = handles.get(handle);
      if (current === undefined) throw new Error("closed");
      files.set(current.path, current.bytes);
      handles.delete(handle);
    },
    readEngineeringStateFileNoFollow: (_rootId: bigint, path: string) => {
      const current = files.get(path);
      if (current === undefined) return missing();
      return new Uint8Array(current);
    },
    readEngineeringStateDirectoryNoFollow: (_rootId: bigint, directory: string) => {
      const prefix = directory.length === 0 ? "" : `${directory}/`;
      const entries = new Map<string, "file" | "directory">();
      for (const path of files.keys()) {
        if (!path.startsWith(prefix)) continue;
        const remainder = path.slice(prefix.length);
        const separator = remainder.indexOf("/");
        const name = separator < 0 ? remainder : remainder.slice(0, separator);
        if (name.length > 0) entries.set(name, separator < 0 ? "file" : "directory");
      }
      return [...entries.entries()].map(([name, kind]) => ({ name, kind }));
    },
    linkEngineeringStateFileNoFollow: (_rootId: bigint, source: string, target: string) => {
      const current = files.get(source);
      if (current === undefined || files.has(target)) throw new Error("link failed");
      files.set(target, new Uint8Array(current));
    },
    renameReplaceEngineeringStateFileNoFollow: (
      _rootId: bigint,
      source: string,
      target: string
    ) => {
      const current = files.get(source);
      if (current === undefined) return missing();
      files.set(target, current);
      files.delete(source);
    },
    unlinkEngineeringStateFileNoFollow: (_rootId: bigint, path: string) => {
      if (!files.delete(path)) return missing();
    }
  };
  let recoveryRootBindingId = "";
  let recoveryGrantRevision = "";
  const addon = {
    adapterInfo: () => undefined,
    openWorkspaceRoot: () => 7n,
    closeWorkspaceRoot: () => undefined,
    listDirectory: () => [],
    readFile: () => new Uint8Array(),
    searchText: () => ({ matches: [], truncated: false }),
    buildIndex: () => ({ files: [], truncated: false }),
    applyEngineeringFileMutationV2: () => {
      throw new Error("not expected in composition startup tests");
    },
    inspectEngineeringFileMutationTargetV2: () => {
      throw new Error("not expected in composition startup tests");
    },
    inspectEngineeringFileSnapshotV2: (_rootId: bigint, relativeIdentity: string) => ({
      schemaVersion: "2.0",
      kind: "engineering_file_mutation_target_snapshot",
      rootId: 7n,
      relativeIdentity,
      parentDirectoryIdentity: relativeIdentity.includes("/")
        ? relativeIdentity.slice(0, relativeIdentity.lastIndexOf("/"))
        : "root",
      state: "absent",
      bytes: null,
      manifest: null
    }),
    observeCreateAbsenceV2: (
      _rootId: bigint,
      rootBindingId: string,
      relativeIdentity: string,
      observedAt: string
    ) => {
      const parentDirectoryIdentity = relativeIdentity.includes("/")
        ? relativeIdentity.slice(0, relativeIdentity.lastIndexOf("/"))
        : "root";
      return createEngineeringAbsenceProofV2({
        rootBindingId,
        relativeIdentity,
        parentDirectoryIdentity,
        observedAt
      });
    },
    scanMutationRecovery: () => input.nativeRecoveryScan ?? nativeRecoveryScan()
  };
  const lifecycle =
    input.lifecycle === true
      ? {
          moveEngineeringPathV2: (_rootId: bigint, request: Record<string, unknown>) =>
            lifecycleReceipt(request, "committed"),
          quarantineEngineeringFileV2: (
            _rootId: bigint,
            _recoveryRootId: bigint,
            request: Record<string, unknown>
          ) => lifecycleReceipt(request, "quarantined"),
          restoreEngineeringFileV2: (
            _rootId: bigint,
            _recoveryRootId: bigint,
            request: Record<string, unknown>
          ) => ({
            ...lifecycleReceipt(request, "committed"),
            operationKind: "restore_file",
            state: "restored"
          }),
          purgeEngineeringQuarantineObjectV2: () => undefined,
          openEngineeringStateRootBoundToRecoveryV2: () => 10n,
          createEngineeringDirectoryV2: (_rootId: bigint, request: Record<string, unknown>) =>
            lifecycleReceipt(request, "committed"),
          inspectEngineeringFileLifecycleOperationV2: (
            _rootId: bigint,
            _recoveryRootId: bigint,
            request: Record<string, unknown>
          ) => input.onLifecycleInspect?.(request),
          resumeEngineeringFileLifecycleOperationV2: (
            _rootId: bigint,
            _recoveryRootId: bigint,
            request: Record<string, unknown>
          ) => ({
            schemaVersion: "3.0",
            kind: "engineering_file_lifecycle_operation_state",
            state: "after",
            requestChecksum: engineeringFileLifecycleRequestChecksumV2(request),
            receipt: lifecycleReceipt(
              request,
              request["operationKind"] === "delete_file" ? "quarantined" : "committed"
            )
          }),
          compensateEngineeringFileLifecycleOperationV2: () => undefined,
          finalizeEngineeringFileLifecycleOperationV2: (
            _rootId: bigint,
            _recoveryRootId: bigint,
            request: Record<string, unknown>
          ) => input.onLifecycleFinalize?.(request),
          ...(input.volumeRecovery === true
            ? {
                openEngineeringRecoveryRootV2: (
                  _rootId: bigint,
                  _recoveryRoot: string,
                  bindingId: string,
                  grantRevision: string,
                  ownershipMarkerChecksum: string
                ) => {
                  recoveryRootBindingId = bindingId;
                  recoveryGrantRevision = grantRevision;
                  return {
                    recoveryRootId: 20n,
                    volumeIdentity: "volume_01",
                    directoryIdentity: "directory_recovery_01",
                    recoveryRootBindingId: bindingId,
                    grantRevision,
                    ownershipMarkerChecksum
                  };
                },
                closeEngineeringRecoveryRootV2: () => undefined,
                inspectEngineeringRecoveryRootCapacityV2: () => ({
                  capacityBytes: 32n * 1024n * 1024n,
                  reservedBytes: 1024n
                }),
                inspectEngineeringQuarantineV2: () => ({
                  schemaVersion: "3.0",
                  kind: "engineering_quarantine_inventory",
                  recoveryRootBindingId,
                  grantRevision: recoveryGrantRevision,
                  objects: []
                })
              }
            : { inspectEngineeringQuarantineV2: () => undefined })
        }
      : {};
  return input.durability === false
    ? { ...addon, ...lifecycle }
    : { ...addon, ...stateDurability, ...lifecycle };
}

function lifecycleReceipt(request: Record<string, unknown>, state: "committed" | "quarantined") {
  return {
    schemaVersion: "3.0",
    kind: "engineering_file_lifecycle_receipt",
    operationKind: request["operationKind"],
    transactionId: request["transactionId"],
    operationId: request["operationId"],
    contentRootBindingId: request["contentRootBindingId"],
    relativeSource: request["relativeSource"],
    relativeTarget: request["relativeTarget"],
    state,
    recoveryObjectId: state === "quarantined" ? request["recoveryObjectId"] : "",
    durability: "data_and_directory_flushed"
  };
}

function lifecycleOperationState(
  request: Record<string, unknown>,
  state: "before" | "neither" | "unknown"
) {
  return {
    schemaVersion: "3.0",
    kind: "engineering_file_lifecycle_operation_state",
    state,
    requestChecksum: engineeringFileLifecycleRequestChecksumV2(request),
    receipt: null
  };
}

function nativeRecoveryScan(
  input: {
    readonly state?: "clear" | "recovery_required";
    readonly pendingStagingCount?: bigint;
  } = {}
) {
  const state = input.state ?? "clear";
  return {
    state,
    pendingStagingCount: input.pendingStagingCount ?? 0n,
    inProcessPendingWalCount: 0n,
    scanTruncated: false,
    scanScope: "native_staging_and_in_process_wal_only",
    durableWalRequirement: "external_durable_wal_scan_required"
  };
}

function unavailable<T = never>(code: string): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code,
      category: "StorageError",
      message: code,
      recoverability: "user-action",
      suggestedAction: "Keep mutation unavailable.",
      traceId: "engineering-mutation-production-composition-v2-test"
    })
  );
}
