import { describe, expect, test, vi } from "vitest";

import { ok } from "@novel-studio/shared";

import {
  engineeringFileLifecycleRequestChecksumV2,
  createEngineeringAbsenceProofV2,
  createEngineeringRawByteManifestV2,
  engineeringFileMutationRequestChecksumV2,
  sha256EngineeringMutationTextV2,
  type EngineeringFileLifecycleOperationStateV2,
  type EngineeringFileLifecycleReceiptV2,
  type EngineeringFileLifecycleRequestV2,
  type EngineeringFileMutationApplyInputV2,
  type EngineeringFileMutationPortV2,
  type EngineeringFileMutationRequestV2,
  type EngineeringMutationOperationStateV2
} from "../src/engineering-file-mutation-port-v2.js";
import {
  createEngineeringMutationBlobReferenceV2,
  InMemoryEngineeringMutationBlobStoreV2
} from "../src/engineering-mutation-blob-store.js";
import { createEngineeringMutationReceiptV2 } from "../src/engineering-mutation-receipt.js";
import { type EngineeringRecoveryMutationLeaseV2 } from "../src/engineering-recovery-gate.js";
import {
  engineeringSideEffectSubjectChecksumV2,
  InMemoryEngineeringWalRepositoryV2
} from "../src/engineering-wal-repository.js";
import {
  EngineeringLifecycleWriteTransactionV2,
  EngineeringWriteTransactionV2,
  engineeringLifecycleSideEffectSubjectChecksumV2,
  validateEngineeringLifecycleWriteTransactionInputV2,
  type EngineeringLifecycleWalRepositoryV2,
  type EngineeringLifecycleWriteAheadLogV2,
  type EngineeringLifecycleWriteTransactionInputV2,
  type EngineeringMutationRecoveryGatePortV2
} from "../src/engineering-write-transaction-v2.js";

const hash = (value: string) => sha256EngineeringMutationTextV2(value);

describe("EngineeringWriteTransactionV2", () => {
  test("binds the ordered B8 lifecycle request set into one authorization subject", () => {
    const request = lifecycleRequest("delete_file");
    const subject = engineeringLifecycleSideEffectSubjectChecksumV2({
      transactionId: "tx_lifecycle",
      contentRootBindingId: "root_01",
      providerSemanticVersionSetChecksum: hash("provider-set"),
      operations: [request]
    });

    expect(subject).toMatch(/^[a-f0-9]{64}$/u);
    expect(
      engineeringLifecycleSideEffectSubjectChecksumV2({
        transactionId: "tx_other",
        contentRootBindingId: "root_01",
        providerSemanticVersionSetChecksum: hash("provider-set"),
        operations: [request]
      })
    ).not.toBe(subject);
  });

  test("strictly validates B8 lifecycle transaction operations and recovery bindings", () => {
    const request = lifecycleRequest("delete_file");
    const input = {
      schemaVersion: "2.0",
      transactionId: "tx_lifecycle",
      contentRootBindingId: "root_01",
      providerSemanticVersionSetChecksum: hash("provider-set"),
      authorization: authorizationBinding(),
      operations: [
        {
          request,
          recoveryBinding: {
            recoveryRootBindingId: request.recoveryRootBindingId,
            grantRevision: request.recoveryGrantRevision,
            sideEffectChecksum: request.recoverySideEffectChecksum
          }
        }
      ],
      preparedAt: "2099-01-01T00:00:00.000Z"
    };
    expect(validateEngineeringLifecycleWriteTransactionInputV2(input)).toMatchObject({ ok: true });
    expect(
      validateEngineeringLifecycleWriteTransactionInputV2({
        ...input,
        operations: [{ ...input.operations[0], recoveryBinding: null }]
      })
    ).toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_LIFECYCLE_WRITE_TRANSACTION_V2_RECOVERY_BINDING_INVALID" }
    });
  });
  test("authorizes the full prepared record, re-reads bytes, reconciles, then applies", async () => {
    const events: string[] = [];
    const mutationPort = {
      reconcile: vi.fn(async (input: unknown) => {
        events.push("reconcile");
        return ok(operationState("before", (input as EngineeringFileMutationApplyInputV2).request));
      }),
      apply: vi.fn(async (input: unknown) => {
        const value = input as EngineeringFileMutationApplyInputV2;
        events.push(new TextDecoder().decode(value.candidateBytes));
        return ok(receiptFor(value.request));
      })
    } satisfies Partial<EngineeringFileMutationPortV2>;
    const authorization = vi.fn(async (prepared) => {
      events.push(`authorization:${prepared.operations.length}`);
      return ok(undefined);
    });
    const transaction = createTransaction({ mutationPort, authorization, events });

    const result = await transaction.apply(transactionInput());

    expect(result).toMatchObject({ ok: true, value: { commit: { transactionId: "tx_01" } } });
    expect(events).toEqual(
      expect.arrayContaining(["reconcile", "const created = true;\n", "authorization:1"])
    );
    // Once for prepare before blobs, and once immediately before the content-root write.
    expect(authorization).toHaveBeenCalledTimes(2);
    expect(mutationPort.apply).toHaveBeenCalledWith(
      expect.objectContaining({ beforeBytes: null, candidateBytes: candidateBytes() })
    );
  });

  test("records a verified after-state idempotently without replaying native mutation", async () => {
    const apply = vi.fn();
    const mutationPort: EngineeringFileMutationPortV2 = {
      reconcile: vi.fn(async (input: unknown) => {
        const request = (input as EngineeringFileMutationApplyInputV2).request;
        return ok(operationState("after", request));
      }),
      apply
    };
    const transaction = createTransaction({ mutationPort });

    const result = await transaction.apply(transactionInput());

    expect(result).toMatchObject({
      ok: true,
      value: { progress: [{ operationId: "op_01" }], commit: { transactionId: "tx_01" } }
    });
    expect(apply).not.toHaveBeenCalled();
  });

  test("does zero new writes when reconciliation is neither/unknown", async () => {
    const apply = vi.fn();
    const mutationPort: EngineeringFileMutationPortV2 = {
      reconcile: vi.fn(async (input: unknown) =>
        ok(operationState("neither", (input as EngineeringFileMutationApplyInputV2).request))
      ),
      apply
    };
    const transaction = createTransaction({ mutationPort });

    await expect(transaction.apply(transactionInput())).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_WRITE_TRANSACTION_V2_RECONCILIATION_REQUIRED" }
    });
    expect(apply).not.toHaveBeenCalled();
  });

  test("returns a committed recovery result before authorization or gate work", async () => {
    const wal = new InMemoryEngineeringWalRepositoryV2();
    const blobStore = new InMemoryEngineeringMutationBlobStoreV2();
    const successful = createTransaction({ wal, blobStore });
    const initial = await successful.apply(transactionInput());
    if (!initial.ok) throw new Error(initial.error.message);

    const blockedGate = gatePort([], true);
    const authorization = vi.fn(async () => {
      throw new Error("must not run");
    });
    const resumed = new EngineeringWriteTransactionV2({
      walRepository: wal,
      blobStore,
      mutationPort: {
        reconcile: async () => {
          throw new Error("must not run");
        },
        apply: async () => {
          throw new Error("must not run");
        }
      },
      recoveryGate: blockedGate,
      validateReservedAuthorization: authorization,
      validateStagingReservation: async () => ok(undefined),
      verifyFullAfterManifest: async () => ok([])
    });

    await expect(
      resumed.resume({ contentRootBindingId: "root_01", transactionId: "tx_01" })
    ).resolves.toMatchObject({ ok: true, value: { commit: { transactionId: "tx_01" } } });
    expect(authorization).not.toHaveBeenCalled();
    expect(blockedGate.acquireRecoveryLease).not.toHaveBeenCalled();
  });

  test("fails before blob persistence when a qualified staging reservation is unavailable", async () => {
    const blobStore = new InMemoryEngineeringMutationBlobStoreV2();
    const transaction = createTransaction({ blobStore, withoutStagingReservation: true });

    await expect(transaction.prepare(transactionInput())).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_WRITE_TRANSACTION_V2_STAGING_RESERVATION_UNQUALIFIED" }
    });
    await expect(blobStore.listRoot("root_01")).resolves.toMatchObject({ ok: true, value: [] });
  });
});

describe("EngineeringLifecycleWriteTransactionV2 quarantine records", () => {
  test("fails closed before native quarantine when durable record hooks are unavailable", async () => {
    const input = lifecycleTransactionInput(["delete_file"]);
    const wal = new TestLifecycleWalRepository();
    const quarantine = vi.fn();
    const transaction = createLifecycleTransaction({
      wal,
      mutationPort: { quarantine },
      withoutQuarantineHooks: true
    });

    await expect(transaction.apply(input)).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_LIFECYCLE_WRITE_TRANSACTION_V2_UNAVAILABLE" }
    });
    expect(quarantine).not.toHaveBeenCalled();
  });

  test("records the exact physical object only after native quarantine and durable WAL progress", async () => {
    const input = lifecycleTransactionInput(["delete_file"]);
    const request = lifecycleOperationAt(input, 0).request;
    const wal = new TestLifecycleWalRepository();
    const quarantine = vi.fn(async () => ok(lifecycleReceipt(request)));
    const inspectQuarantine = vi.fn(async () => ok(quarantineInventory(request, 37n)));
    const recordQuarantine = vi.fn(async () => ok(undefined));
    const transaction = createLifecycleTransaction({
      wal,
      mutationPort: { quarantine, inspectQuarantine },
      recordQuarantine
    });

    await expect(transaction.apply(input)).resolves.toMatchObject({
      ok: true,
      value: { committedAt: "2099-01-01T00:00:01.000Z" }
    });
    expect(recordQuarantine).toHaveBeenCalledWith({
      recoveryObjectId: request.recoveryObjectId,
      transactionId: request.transactionId,
      operationId: request.operationId,
      relativeIdentity: request.relativeSource,
      sourceSha256: request.sourceSha256,
      byteLength: 37,
      sideEffectChecksum: request.recoverySideEffectChecksum
    });
    expect(quarantine.mock.invocationCallOrder[0]).toBeLessThan(
      wal.appendProgress.mock.invocationCallOrder[0] ?? 0
    );
    expect(wal.appendProgress.mock.invocationCallOrder[0]).toBeLessThan(
      inspectQuarantine.mock.invocationCallOrder[0] ?? 0
    );
    expect(inspectQuarantine.mock.invocationCallOrder[0]).toBeLessThan(
      recordQuarantine.mock.invocationCallOrder[0] ?? 0
    );
    expect(recordQuarantine.mock.invocationCallOrder[0]).toBeLessThan(
      wal.commit.mock.invocationCallOrder[0] ?? 0
    );
  });

  test("keeps the WAL incomplete when physical quarantine evidence does not match", async () => {
    const input = lifecycleTransactionInput(["delete_file"]);
    const request = lifecycleOperationAt(input, 0).request;
    const wal = new TestLifecycleWalRepository();
    const recordQuarantine = vi.fn();
    const inventory = quarantineInventory(request, 37n);
    const physicalObject = inventory.objects[0];
    if (physicalObject === undefined) throw new Error("missing quarantine fixture");
    const transaction = createLifecycleTransaction({
      wal,
      mutationPort: {
        quarantine: async () => ok(lifecycleReceipt(request)),
        inspectQuarantine: async () =>
          ok({
            ...inventory,
            objects: [{ ...physicalObject, sha256: hash("drift") }]
          })
      },
      recordQuarantine
    });

    await expect(transaction.apply(input)).resolves.toMatchObject({
      ok: false,
      error: {
        code: "ENGINEERING_LIFECYCLE_WRITE_TRANSACTION_V2_QUARANTINE_RECORD_INVALID"
      }
    });
    expect(wal.current?.receipts).toHaveLength(1);
    expect(wal.commit).not.toHaveBeenCalled();
    expect(recordQuarantine).not.toHaveBeenCalled();
  });

  test("idempotently marks an existing record compensated after crash-before-record recovery", async () => {
    const input = lifecycleTransactionInput(["delete_file"]);
    const request = lifecycleOperationAt(input, 0).request;
    const wal = new TestLifecycleWalRepository();
    await wal.prepare(input);
    await wal.appendProgress({
      ...lifecycleLocator(),
      receipt: lifecycleReceipt(request),
      recordedAt: "2099-01-01T00:00:00.500Z"
    });
    const recordQuarantine = vi.fn();
    const recordQuarantineCompensation = vi.fn(async () => ok(undefined));
    const transaction = createLifecycleTransaction({
      wal,
      mutationPort: {
        reconcileLifecycle: async () => ok(lifecycleState("after", request)),
        compensateLifecycle: async () => ok(lifecycleState("before", request))
      },
      recordQuarantine,
      recordQuarantineCompensation
    });

    await expect(transaction.recover(lifecycleLocator())).resolves.toMatchObject({
      ok: true,
      value: { rolledBackAt: "2099-01-01T00:00:01.000Z" }
    });
    expect(recordQuarantine).not.toHaveBeenCalled();
    expect(recordQuarantineCompensation).toHaveBeenCalledWith({
      operation: lifecycleOperationAt(input, 0),
      receipt: lifecycleReceipt(request)
    });
    expect(wal.rollback).toHaveBeenCalledOnce();
  });

  test("does not silently roll back after a partial quarantine record transition failure", async () => {
    const input = lifecycleTransactionInput(["delete_file"]);
    const request = lifecycleOperationAt(input, 0).request;
    const wal = new TestLifecycleWalRepository();
    await wal.prepare(input);
    await wal.appendProgress({
      ...lifecycleLocator(),
      receipt: lifecycleReceipt(request),
      recordedAt: "2099-01-01T00:00:00.500Z"
    });
    const transaction = createLifecycleTransaction({
      wal,
      mutationPort: {
        reconcileLifecycle: async () => ok(lifecycleState("after", request)),
        compensateLifecycle: async () => ok(lifecycleState("before", request))
      },
      recordQuarantineCompensation: async () => ({
        ok: false,
        error: { code: "ENGINEERING_RECOVERY_RECORD_PARTIAL_FAILURE" } as never
      })
    });

    await expect(transaction.recover(lifecycleLocator())).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_RECOVERY_RECORD_PARTIAL_FAILURE" }
    });
    expect(wal.rollback).not.toHaveBeenCalled();
    expect(wal.current?.rolledBackAt).toBeNull();
  });
});

describe("EngineeringLifecycleWriteTransactionV2 recovery", () => {
  test("durably rolls back an all-before journal without compensation", async () => {
    const input = lifecycleTransactionInput(["move_file", "create_directory"]);
    const wal = new TestLifecycleWalRepository();
    await wal.prepare(input);
    const compensateLifecycle = vi.fn();
    const transaction = createLifecycleTransaction({
      wal,
      mutationPort: {
        reconcileLifecycle: async (value: unknown) =>
          ok(lifecycleState("before", lifecycleRecoveryRequest(value))),
        compensateLifecycle
      }
    });

    await expect(transaction.recover(lifecycleLocator())).resolves.toMatchObject({
      ok: true,
      value: { committedAt: null, rolledBackAt: "2099-01-01T00:00:01.000Z" }
    });
    expect(compensateLifecycle).not.toHaveBeenCalled();
    expect(wal.rollback).toHaveBeenCalledOnce();
  });

  test("reconstructs an after prefix and compensates it in exact reverse order", async () => {
    const input = lifecycleTransactionInput(["move_file", "create_directory", "move_file"]);
    const wal = new TestLifecycleWalRepository();
    await wal.prepare(input);
    const events: string[] = [];
    let initialClassifications = input.operations.length;
    const compensateLifecycle = vi.fn(async (value: unknown) => {
      const recovery = value as {
        request: EngineeringFileLifecycleRequestV2;
        expectedReceipt: EngineeringFileLifecycleReceiptV2;
      };
      events.push(`compensate:${recovery.request.operationId}`);
      expect(recovery.expectedReceipt).toEqual(lifecycleReceipt(recovery.request));
      return ok(lifecycleState("before", recovery.request));
    });
    const transaction = createLifecycleTransaction({
      wal,
      mutationPort: {
        reconcileLifecycle: async (value: unknown) => {
          const request = lifecycleRecoveryRequest(value);
          if (initialClassifications > 0) {
            const index = input.operations.length - initialClassifications;
            initialClassifications -= 1;
            return ok(lifecycleState(index < 2 ? "after" : "before", request));
          }
          events.push(`recheck:${request.operationId}`);
          return ok(lifecycleState("after", request));
        },
        compensateLifecycle
      }
    });

    await expect(transaction.recover(lifecycleLocator())).resolves.toMatchObject({
      ok: true,
      value: { receipts: [{ operationId: "op_lifecycle_0" }, { operationId: "op_lifecycle_1" }] }
    });
    expect(events).toEqual([
      "recheck:op_lifecycle_1",
      "compensate:op_lifecycle_1",
      "recheck:op_lifecycle_0",
      "compensate:op_lifecycle_0"
    ]);
  });

  test("rebuilds durable progress after native success preceded a failed WAL append", async () => {
    const input = lifecycleTransactionInput(["move_file"]);
    const wal = new TestLifecycleWalRepository();
    wal.failNextAppend = true;
    const request = lifecycleOperationAt(input, 0).request;
    const mutationPort = {
      move: vi.fn(async () => ok(lifecycleReceipt(request))),
      reconcileLifecycle: vi.fn(async () => ok(lifecycleState("after", request))),
      compensateLifecycle: vi.fn(async () => ok(lifecycleState("before", request)))
    } satisfies Partial<EngineeringFileMutationPortV2>;
    const transaction = createLifecycleTransaction({ wal, mutationPort });

    await expect(transaction.apply(input)).resolves.toMatchObject({
      ok: false,
      error: { code: "TEST_WAL_APPEND_FAILED" }
    });
    expect(wal.current?.receipts).toHaveLength(0);

    await expect(transaction.recover(lifecycleLocator())).resolves.toMatchObject({
      ok: true,
      value: { receipts: [{ operationId: request.operationId }], rolledBackAt: expect.any(String) }
    });
    expect(wal.appendProgress).toHaveBeenCalledTimes(2);
    expect(mutationPort.compensateLifecycle).toHaveBeenCalledOnce();
  });

  test("resumes one validated intermediate state before reconstructing and compensating", async () => {
    const input = lifecycleTransactionInput(["move_file", "create_directory", "move_file"]);
    const wal = new TestLifecycleWalRepository();
    await wal.prepare(input);
    const events: string[] = [];
    let resumed = false;
    let initialInspections = input.operations.length;
    const transaction = createLifecycleTransaction({
      wal,
      mutationPort: {
        reconcileLifecycle: async (value: unknown) => {
          const request = lifecycleRecoveryRequest(value);
          const index = input.operations.findIndex(
            (operation) => operation.request.operationId === request.operationId
          );
          if (initialInspections > 0) {
            initialInspections -= 1;
            events.push(`classify:${request.operationId}`);
            return ok(
              lifecycleState(
                index === 0 ? "after" : index === 1 ? "intermediate" : "before",
                request
              )
            );
          }
          events.push(`reinspect:${request.operationId}`);
          return ok(lifecycleState(resumed && index < 2 ? "after" : "before", request));
        },
        resumeLifecycle: vi.fn(async (value: unknown) => {
          const recovery = value as {
            request: EngineeringFileLifecycleRequestV2;
          };
          events.push(`resume:${recovery.request.operationId}`);
          resumed = true;
          return ok(lifecycleState("after", recovery.request));
        }),
        finalizeLifecycle: vi.fn(async (value: unknown) => {
          const recovery = value as {
            request: EngineeringFileLifecycleRequestV2;
            expectedState: "before" | "after";
          };
          events.push(`finalize:${recovery.request.operationId}:${recovery.expectedState}`);
          return ok(undefined);
        }),
        compensateLifecycle: vi.fn(async (value: unknown) => {
          const recovery = value as {
            request: EngineeringFileLifecycleRequestV2;
            expectedReceipt: EngineeringFileLifecycleReceiptV2;
          };
          events.push(`compensate:${recovery.request.operationId}`);
          return ok(lifecycleState("before", recovery.request));
        })
      }
    });

    await expect(transaction.recover(lifecycleLocator())).resolves.toMatchObject({
      ok: true,
      value: {
        receipts: [{ operationId: "op_lifecycle_0" }, { operationId: "op_lifecycle_1" }],
        rolledBackAt: expect.any(String)
      }
    });
    expect(events).toEqual([
      "classify:op_lifecycle_0",
      "classify:op_lifecycle_1",
      "classify:op_lifecycle_2",
      "resume:op_lifecycle_1",
      "reinspect:op_lifecycle_0",
      "reinspect:op_lifecycle_1",
      "reinspect:op_lifecycle_2",
      "reinspect:op_lifecycle_1",
      "compensate:op_lifecycle_1",
      "reinspect:op_lifecycle_0",
      "compensate:op_lifecycle_0",
      "finalize:op_lifecycle_0:before",
      "finalize:op_lifecycle_1:before",
      "finalize:op_lifecycle_2:before"
    ]);
  });

  test("does not resume an intermediate state until the whole batch is a valid prefix", async () => {
    const input = lifecycleTransactionInput(["move_file", "create_directory"]);
    const wal = new TestLifecycleWalRepository();
    await wal.prepare(input);
    let call = 0;
    const resumeLifecycle = vi.fn();
    const compensateLifecycle = vi.fn();
    const transaction = createLifecycleTransaction({
      wal,
      mutationPort: {
        reconcileLifecycle: async (value: unknown) =>
          ok(
            lifecycleState(call++ === 0 ? "intermediate" : "after", lifecycleRecoveryRequest(value))
          ),
        resumeLifecycle,
        compensateLifecycle
      }
    });

    await expect(transaction.recover(lifecycleLocator())).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_LIFECYCLE_WRITE_TRANSACTION_V2_RECOVERY_REVIEW_REQUIRED" }
    });
    expect(resumeLifecycle).not.toHaveBeenCalled();
    expect(compensateLifecycle).not.toHaveBeenCalled();
  });

  test.each(["neither", "unknown"] as const)(
    "requires review and performs zero compensation for %s state",
    async (state) => {
      const input = lifecycleTransactionInput(["move_file"]);
      const wal = new TestLifecycleWalRepository();
      await wal.prepare(input);
      const request = lifecycleOperationAt(input, 0).request;
      const compensateLifecycle = vi.fn();
      const transaction = createLifecycleTransaction({
        wal,
        mutationPort: {
          reconcileLifecycle: async () => ok(lifecycleState(state, request)),
          compensateLifecycle
        }
      });

      await expect(transaction.recover(lifecycleLocator())).resolves.toMatchObject({
        ok: false,
        error: {
          code: "ENGINEERING_LIFECYCLE_WRITE_TRANSACTION_V2_RECOVERY_REVIEW_REQUIRED"
        }
      });
      expect(compensateLifecycle).not.toHaveBeenCalled();
    }
  );

  test("requires review for a non-prefix state pattern with zero compensation", async () => {
    const input = lifecycleTransactionInput(["move_file", "create_directory"]);
    const wal = new TestLifecycleWalRepository();
    await wal.prepare(input);
    const compensateLifecycle = vi.fn();
    let call = 0;
    const transaction = createLifecycleTransaction({
      wal,
      mutationPort: {
        reconcileLifecycle: async (value: unknown) =>
          ok(lifecycleState(call++ === 0 ? "before" : "after", lifecycleRecoveryRequest(value))),
        compensateLifecycle
      }
    });

    await expect(transaction.recover(lifecycleLocator())).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_LIFECYCLE_WRITE_TRANSACTION_V2_RECOVERY_REVIEW_REQUIRED" }
    });
    expect(compensateLifecycle).not.toHaveBeenCalled();
  });

  test("does not compensate when the exact after-state changes after classification", async () => {
    const input = lifecycleTransactionInput(["move_file"]);
    const wal = new TestLifecycleWalRepository();
    await wal.prepare(input);
    const request = lifecycleOperationAt(input, 0).request;
    const compensateLifecycle = vi.fn();
    let classification = 0;
    const transaction = createLifecycleTransaction({
      wal,
      mutationPort: {
        reconcileLifecycle: async () =>
          ok(lifecycleState(classification++ === 0 ? "after" : "before", request)),
        compensateLifecycle
      }
    });

    await expect(transaction.recover(lifecycleLocator())).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_LIFECYCLE_WRITE_TRANSACTION_V2_RECOVERY_REVIEW_REQUIRED" }
    });
    expect(compensateLifecycle).not.toHaveBeenCalled();
  });

  test("rejects delete recovery binding drift before any native recovery call", async () => {
    const input = lifecycleTransactionInput(["move_file", "delete_file"]);
    const wal = new TestLifecycleWalRepository();
    await wal.prepare(input);
    const reconcileLifecycle = vi.fn();
    const compensateLifecycle = vi.fn();
    const transaction = createLifecycleTransaction({
      wal,
      mutationPort: { reconcileLifecycle, compensateLifecycle },
      resolveRecoveryBinding: async () =>
        ok({
          recoveryRootBindingId: "recovery_01",
          recoveryRootId: "recovery-root-handle-changed",
          grantRevision: "grant_changed",
          sideEffectChecksum: hash("side-effect")
        })
    });

    await expect(transaction.recover(lifecycleLocator())).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_LIFECYCLE_WRITE_TRANSACTION_V2_RECOVERY_BINDING_STALE" }
    });
    expect(reconcileLifecycle).not.toHaveBeenCalled();
    expect(compensateLifecycle).not.toHaveBeenCalled();
  });

  test("requires the observed after receipt to match an existing durable receipt", async () => {
    const input = lifecycleTransactionInput(["move_file"]);
    const wal = new TestLifecycleWalRepository();
    await wal.prepare(input);
    const request = lifecycleOperationAt(input, 0).request;
    await wal.appendProgress({
      ...lifecycleLocator(),
      receipt: lifecycleReceipt(request),
      recordedAt: "2099-01-01T00:00:00.500Z"
    });
    const compensateLifecycle = vi.fn();
    const mismatched = {
      ...lifecycleReceipt(request),
      relativeTarget: "moved/other.ts"
    };
    const transaction = createLifecycleTransaction({
      wal,
      mutationPort: {
        reconcileLifecycle: async () =>
          ok({
            ...lifecycleState("after", request),
            receipt: mismatched
          } as EngineeringFileLifecycleOperationStateV2),
        compensateLifecycle
      }
    });

    await expect(transaction.recover(lifecycleLocator())).resolves.toMatchObject({ ok: false });
    expect(compensateLifecycle).not.toHaveBeenCalled();
  });
});

function lifecycleRequest(kind: "delete_file") {
  return {
    schemaVersion: "3.0" as const,
    operationKind: kind,
    transactionId: "tx_lifecycle",
    operationId: "op_lifecycle",
    contentRootBindingId: "root_01",
    relativeSource: "src/main.ts",
    relativeTarget: "",
    sourceFileIdentity: "file_01",
    sourceSha256: hash("source"),
    targetProof: "absent" as const,
    recoveryRootBindingId: "recovery_01",
    recoveryGrantRevision: "grant_01",
    recoverySideEffectChecksum: hash("side-effect"),
    recoveryObjectId: "object_01",
    stagingObjectId: "staging_01",
    expectedState: "wal_prepared" as const
  };
}

function authorizationBinding() {
  return {
    authorizationId: "auth_01",
    approvalBindingId: "approval_01",
    approvalBindingChecksum: hash("approval"),
    sideEffectSubjectChecksum: hash("subject"),
    changeSetId: "change_01",
    changeSetRevision: 1,
    changeSetChecksum: hash("change")
  };
}

function createTransaction(
  input: {
    readonly wal?: InMemoryEngineeringWalRepositoryV2;
    readonly blobStore?: InMemoryEngineeringMutationBlobStoreV2;
    readonly mutationPort?: EngineeringFileMutationPortV2;
    readonly authorization?: (
      prepared: Parameters<
        ConstructorParameters<
          typeof EngineeringWriteTransactionV2
        >[0]["validateReservedAuthorization"]
      >[0]
    ) => ReturnType<
      ConstructorParameters<
        typeof EngineeringWriteTransactionV2
      >[0]["validateReservedAuthorization"]
    >;
    readonly events?: string[];
    readonly withoutStagingReservation?: boolean;
  } = {}
): EngineeringWriteTransactionV2 {
  const events = input.events ?? [];
  const mutationPort = input.mutationPort ?? successPort(events);
  const gate = gatePort(events);
  return new EngineeringWriteTransactionV2({
    walRepository: input.wal ?? new InMemoryEngineeringWalRepositoryV2(),
    blobStore: input.blobStore ?? new InMemoryEngineeringMutationBlobStoreV2(),
    mutationPort,
    recoveryGate: gate,
    validateReservedAuthorization:
      input.authorization ??
      (async () => {
        events.push("authorization");
        return ok(undefined);
      }),
    ...(input.withoutStagingReservation
      ? {}
      : {
          validateStagingReservation: async () => {
            events.push("staging");
            return ok(undefined);
          }
        }),
    verifyFullAfterManifest: async ({ receipts }) => {
      events.push("after");
      return ok(receipts.map((receipt) => receipt.observedAfter));
    },
    now: () => "2099-01-01T00:00:01.000Z"
  });
}

function successPort(events: string[]): EngineeringFileMutationPortV2 {
  return {
    reconcile: async (input: unknown) => {
      events.push("reconcile");
      return ok(operationState("before", (input as EngineeringFileMutationApplyInputV2).request));
    },
    apply: async (input: unknown) => {
      const value = input as EngineeringFileMutationApplyInputV2;
      events.push("native");
      return ok(receiptFor(value.request));
    }
  };
}

function gatePort(
  events: string[],
  block = false
): EngineeringMutationRecoveryGatePortV2 & {
  acquireRecoveryLease: ReturnType<typeof vi.fn>;
} {
  const acquire = (kind: "ordinary" | "recovery") =>
    vi.fn(async (input: unknown) => {
      if (block) {
        return {
          ok: false as const,
          error: { code: "ENGINEERING_RECOVERY_GATE_BLOCKED" } as never
        };
      }
      const binding = input as {
        contentRootBindingId: string;
        transactionId: string;
        preparedChecksum: string;
      };
      events.push(`lease:${kind}`);
      return ok({
        ...binding,
        kind,
        assertCurrent: async () => ok(undefined),
        release: () => undefined
      } satisfies EngineeringRecoveryMutationLeaseV2);
    });
  return {
    assertMutationAllowed: async () => {
      if (block) {
        return {
          ok: false as const,
          error: { code: "ENGINEERING_RECOVERY_GATE_BLOCKED" } as never
        };
      }
      events.push("gate");
      return ok(undefined);
    },
    acquireMutationLease: acquire("ordinary"),
    acquireRecoveryLease: acquire("recovery")
  };
}

function transactionInput() {
  const bytes = candidateBytes();
  const candidate = createEngineeringRawByteManifestV2({
    identity: {
      kind: "target",
      rootBindingId: "root_01",
      relativeIdentity: "src/main.ts",
      fileIdentity: null
    },
    bytes,
    metadataChecksum: hash("metadata")
  });
  const candidateBlob = createEngineeringMutationBlobReferenceV2({
    contentRootBindingId: "root_01",
    bytes
  });
  if (!candidateBlob.ok) throw new Error(candidateBlob.error.message);
  const request: EngineeringFileMutationRequestV2 = {
    schemaVersion: "2.0",
    transactionId: "tx_01",
    contentRootBindingId: "root_01",
    providerSemanticVersionSetChecksum: hash("provider"),
    operationKind: "create_file",
    operationId: "op_01",
    relativeIdentity: "src/main.ts",
    before: {
      schemaVersion: "2.0",
      kind: "absent",
      absenceProof: createEngineeringAbsenceProofV2({
        rootBindingId: "root_01",
        relativeIdentity: "src/main.ts",
        parentDirectoryIdentity: "directory_01",
        observedAt: "2099-01-01T00:00:00.000Z"
      })
    },
    candidate: { schemaVersion: "2.0", manifest: candidate, blob: candidateBlob.value },
    stagingObjectId: "staging_01"
  };
  return {
    schemaVersion: "2.0" as const,
    transactionId: "tx_01",
    contentRootBindingId: "root_01",
    providerSemanticVersionSetChecksum: hash("provider"),
    authorization: {
      authorizationId: "auth_01",
      approvalBindingId: "binding_01",
      approvalBindingChecksum: hash("binding"),
      sideEffectSubjectChecksum: engineeringSideEffectSubjectChecksumV2({
        transactionId: "tx_01",
        contentRootBindingId: "root_01",
        providerSemanticVersionSetChecksum: hash("provider"),
        operations: [request]
      }),
      changeSetId: "changes_01",
      changeSetRevision: 1,
      changeSetChecksum: hash("changes")
    },
    operations: [
      {
        operationKind: "create_file" as const,
        operationId: "op_01",
        relativeIdentity: "src/main.ts",
        before: {
          kind: "absent" as const,
          absenceProof: request.before.kind === "absent" ? request.before.absenceProof : undefined
        },
        candidate: { manifest: candidate, bytes },
        stagingObjectId: "staging_01"
      }
    ],
    preparedAt: "2099-01-01T00:00:00.000Z"
  };
}

function candidateBytes(): Uint8Array {
  return new TextEncoder().encode("const created = true;\n");
}

function receiptFor(request: EngineeringFileMutationRequestV2) {
  return createEngineeringMutationReceiptV2({
    transactionId: request.transactionId,
    operationId: request.operationId,
    operationKind: request.operationKind,
    contentRootBindingId: request.contentRootBindingId,
    providerSemanticVersionSetChecksum: request.providerSemanticVersionSetChecksum,
    relativeIdentity: request.relativeIdentity,
    requestChecksum: engineeringFileMutationRequestChecksumV2(request),
    observedBefore: request.before,
    observedAfter: {
      ...request.candidate.manifest,
      identity: {
        kind: "observed_file" as const,
        rootBindingId: request.contentRootBindingId,
        relativeIdentity: request.relativeIdentity,
        fileIdentity: "file_01"
      }
    },
    stagingObjectId: request.stagingObjectId,
    recoveryObjectId: null,
    durability: "data_and_directory_flushed"
  });
}

function operationState(
  state: "before" | "after" | "neither" | "unknown",
  request: EngineeringFileMutationRequestV2
): EngineeringMutationOperationStateV2 {
  if (state === "after") {
    return {
      schemaVersion: "2.0",
      kind: "engineering_mutation_operation_state",
      state,
      requestChecksum: engineeringFileMutationRequestChecksumV2(request),
      receipt: receiptFor(request)
    };
  }
  return {
    schemaVersion: "2.0",
    kind: "engineering_mutation_operation_state",
    state,
    requestChecksum: engineeringFileMutationRequestChecksumV2(request),
    receipt: null
  };
}

class TestLifecycleWalRepository implements EngineeringLifecycleWalRepositoryV2 {
  public current: EngineeringLifecycleWriteAheadLogV2 | undefined;
  public failNextAppend = false;

  public readonly read = vi.fn(async () => ok(this.current));

  public readonly prepare = vi.fn(async (input: EngineeringLifecycleWriteTransactionInputV2) => {
    this.current = lifecycleJournal(input, [], null, null);
    return ok(this.current);
  });

  public readonly appendProgress = vi.fn(
    async (input: {
      contentRootBindingId: string;
      transactionId: string;
      receipt: EngineeringFileLifecycleReceiptV2;
      recordedAt: string;
    }) => {
      if (this.failNextAppend) {
        this.failNextAppend = false;
        return {
          ok: false as const,
          error: { code: "TEST_WAL_APPEND_FAILED" } as never
        };
      }
      if (this.current === undefined) throw new Error("missing lifecycle WAL");
      this.current = lifecycleJournal(
        this.current.prepared,
        [...this.current.receipts, input.receipt],
        this.current.committedAt,
        this.current.rolledBackAt,
        this.current.synchronizedAt
      );
      return ok(this.current);
    }
  );

  public readonly commit = vi.fn(
    async (input: { contentRootBindingId: string; transactionId: string; committedAt: string }) => {
      if (this.current === undefined) throw new Error("missing lifecycle WAL");
      this.current = lifecycleJournal(
        this.current.prepared,
        this.current.receipts,
        input.committedAt,
        null
      );
      return ok(this.current);
    }
  );

  public readonly rollback = vi.fn(
    async (input: {
      contentRootBindingId: string;
      transactionId: string;
      rolledBackAt: string;
    }) => {
      if (this.current === undefined) throw new Error("missing lifecycle WAL");
      this.current = lifecycleJournal(
        this.current.prepared,
        this.current.receipts,
        null,
        input.rolledBackAt
      );
      return ok(this.current);
    }
  );

  public readonly markSynchronized = vi.fn(
    async (input: {
      contentRootBindingId: string;
      transactionId: string;
      synchronizedAt: string;
    }) => {
      if (this.current === undefined) throw new Error("missing lifecycle WAL");
      this.current = lifecycleJournal(
        this.current.prepared,
        this.current.receipts,
        this.current.committedAt,
        this.current.rolledBackAt,
        input.synchronizedAt
      );
      return ok(this.current);
    }
  );
}

function createLifecycleTransaction(input: {
  wal: TestLifecycleWalRepository;
  mutationPort: Partial<EngineeringFileMutationPortV2>;
  resolveRecoveryBinding?: ConstructorParameters<
    typeof EngineeringLifecycleWriteTransactionV2
  >[0]["resolveRecoveryBinding"];
  recordQuarantine?: ConstructorParameters<
    typeof EngineeringLifecycleWriteTransactionV2
  >[0]["recordQuarantine"];
  recordQuarantineCompensation?: ConstructorParameters<
    typeof EngineeringLifecycleWriteTransactionV2
  >[0]["recordQuarantineCompensation"];
  withoutQuarantineHooks?: boolean;
}) {
  return new EngineeringLifecycleWriteTransactionV2({
    walRepository: input.wal,
    mutationPort: {
      apply: async () => {
        throw new Error("raw apply is outside lifecycle recovery tests");
      },
      reconcile: async () => {
        throw new Error("raw reconcile is outside lifecycle recovery tests");
      },
      resumeLifecycle: async () => {
        throw new Error("resume is only expected for a durable intermediate lifecycle state");
      },
      finalizeLifecycle: async () => ok(undefined),
      ...input.mutationPort
    },
    recoveryGate: gatePort([]),
    validateReservedAuthorization: async () => ok(undefined),
    resolveRecoveryBinding:
      input.resolveRecoveryBinding ??
      (async () =>
        ok({
          recoveryRootBindingId: "recovery_01",
          recoveryRootId: "recovery-root-handle",
          grantRevision: "grant_01",
          sideEffectChecksum: hash("side-effect")
        })),
    ...(input.withoutQuarantineHooks
      ? {}
      : {
          recordQuarantine: input.recordQuarantine ?? (async () => ok(undefined)),
          recordQuarantineCompensation:
            input.recordQuarantineCompensation ?? (async () => ok(undefined))
        }),
    now: () => "2099-01-01T00:00:01.000Z"
  });
}

function lifecycleTransactionInput(
  kinds: readonly ("move_file" | "delete_file" | "create_directory")[]
): EngineeringLifecycleWriteTransactionInputV2 {
  const requests = kinds.map((kind, index) => lifecycleRequestAt(kind, index));
  return {
    schemaVersion: "2.0",
    transactionId: "tx_lifecycle",
    contentRootBindingId: "root_01",
    providerSemanticVersionSetChecksum: hash("provider-set"),
    authorization: {
      ...authorizationBinding(),
      sideEffectSubjectChecksum: engineeringLifecycleSideEffectSubjectChecksumV2({
        transactionId: "tx_lifecycle",
        contentRootBindingId: "root_01",
        providerSemanticVersionSetChecksum: hash("provider-set"),
        operations: requests
      })
    },
    operations: requests.map((request) => ({
      request,
      recoveryBinding:
        request.operationKind === "delete_file"
          ? {
              recoveryRootBindingId: request.recoveryRootBindingId,
              grantRevision: request.recoveryGrantRevision,
              sideEffectChecksum: request.recoverySideEffectChecksum
            }
          : null
    })),
    preparedAt: "2099-01-01T00:00:00.000Z"
  };
}

function lifecycleRequestAt(
  kind: "move_file" | "delete_file" | "create_directory",
  index: number
): EngineeringFileLifecycleRequestV2 {
  return {
    schemaVersion: "3.0",
    operationKind: kind,
    transactionId: "tx_lifecycle",
    operationId: `op_lifecycle_${index}`,
    contentRootBindingId: "root_01",
    relativeSource: kind === "create_directory" ? "" : `src/file-${index}.ts`,
    relativeTarget:
      kind === "delete_file"
        ? ""
        : kind === "create_directory"
          ? `created-${index}`
          : `moved/file-${index}.ts`,
    sourceFileIdentity: kind === "create_directory" ? "" : `file_${index}`,
    sourceSha256: kind === "create_directory" ? "0".repeat(64) : hash(`source-${index}`),
    targetProof: "absent",
    recoveryRootBindingId: kind === "delete_file" ? "recovery_01" : "",
    recoveryGrantRevision: kind === "delete_file" ? "grant_01" : "",
    recoverySideEffectChecksum: kind === "delete_file" ? hash("side-effect") : "",
    recoveryObjectId: kind === "delete_file" ? `object_${index}` : "",
    stagingObjectId: `staging_${index}`,
    expectedState: "wal_prepared"
  };
}

function lifecycleReceipt(
  request: EngineeringFileLifecycleRequestV2
): EngineeringFileLifecycleReceiptV2 {
  return {
    schemaVersion: "3.0",
    kind: "engineering_file_lifecycle_receipt",
    operationKind: request.operationKind,
    transactionId: request.transactionId,
    operationId: request.operationId,
    contentRootBindingId: request.contentRootBindingId,
    relativeSource: request.relativeSource,
    relativeTarget: request.relativeTarget,
    state: request.operationKind === "delete_file" ? "quarantined" : "committed",
    recoveryObjectId: request.operationKind === "delete_file" ? request.recoveryObjectId : "",
    durability: "data_and_directory_flushed"
  };
}

function quarantineInventory(request: EngineeringFileLifecycleRequestV2, byteLength: bigint) {
  return {
    schemaVersion: "3.0" as const,
    kind: "engineering_quarantine_inventory" as const,
    recoveryRootBindingId: request.recoveryRootBindingId,
    grantRevision: request.recoveryGrantRevision,
    objects: [
      {
        recoveryObjectId: request.recoveryObjectId,
        fileIdentity: request.sourceFileIdentity,
        sha256: request.sourceSha256,
        byteLength
      }
    ]
  };
}

function lifecycleState(
  state: "before" | "after" | "intermediate" | "neither" | "unknown",
  request: EngineeringFileLifecycleRequestV2
): EngineeringFileLifecycleOperationStateV2 {
  return state === "after"
    ? {
        schemaVersion: "3.0",
        kind: "engineering_file_lifecycle_operation_state",
        state,
        requestChecksum: engineeringFileLifecycleRequestChecksumV2(request),
        receipt: lifecycleReceipt(request)
      }
    : {
        schemaVersion: "3.0",
        kind: "engineering_file_lifecycle_operation_state",
        state,
        requestChecksum: engineeringFileLifecycleRequestChecksumV2(request),
        receipt: null
      };
}

function lifecycleRecoveryRequest(value: unknown): EngineeringFileLifecycleRequestV2 {
  return (value as { request: EngineeringFileLifecycleRequestV2 }).request;
}

function lifecycleLocator() {
  return { contentRootBindingId: "root_01", transactionId: "tx_lifecycle" };
}

function lifecycleOperationAt(input: EngineeringLifecycleWriteTransactionInputV2, index: number) {
  const operation = input.operations[index];
  if (operation === undefined) throw new Error(`missing lifecycle operation ${index}`);
  return operation;
}

function lifecycleJournal(
  prepared: EngineeringLifecycleWriteTransactionInputV2,
  receipts: readonly EngineeringFileLifecycleReceiptV2[],
  committedAt: string | null,
  rolledBackAt: string | null,
  synchronizedAt: string | null = null
): EngineeringLifecycleWriteAheadLogV2 {
  return {
    schemaVersion: "2.0",
    kind: "engineering_lifecycle_write_ahead_log",
    prepared,
    preparedChecksum: hash(JSON.stringify(prepared)),
    receipts,
    committedAt,
    rolledBackAt,
    synchronizedAt,
    journalChecksum: hash(
      JSON.stringify({ prepared, receipts, committedAt, rolledBackAt, synchronizedAt })
    )
  };
}
