import { describe, expect, test, vi } from "vitest";

import { ok } from "@novel-studio/shared";

import {
  createEngineeringAbsenceProofV2,
  createEngineeringRawByteManifestV2,
  engineeringFileMutationRequestChecksumV2,
  sha256EngineeringMutationTextV2,
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
  EngineeringWriteTransactionV2,
  engineeringLifecycleSideEffectSubjectChecksumV2,
  validateEngineeringLifecycleWriteTransactionInputV2,
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
    const mutationPort: EngineeringFileMutationPortV2 = {
      reconcile: vi.fn(async (input: unknown) => {
        events.push("reconcile");
        return ok(operationState("before", (input as EngineeringFileMutationApplyInputV2).request));
      }),
      apply: vi.fn(async (input: unknown) => {
        const value = input as EngineeringFileMutationApplyInputV2;
        events.push(new TextDecoder().decode(value.candidateBytes));
        return ok(receiptFor(value.request));
      })
    };
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
