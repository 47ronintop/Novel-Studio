import { describe, expect, test } from "vitest";

import { err, ok } from "@novel-studio/shared";

import {
  createEngineeringAbsenceProofV2,
  createEngineeringRawByteManifestV2,
  engineeringMutationBlobIdForSha256V2,
  sha256EngineeringMutationTextV2,
  type EngineeringFileMutationRequestV2
} from "../src/engineering-file-mutation-port-v2.js";
import { InMemoryEngineeringMutationBlobStoreV2 } from "../src/engineering-mutation-blob-store.js";
import { EngineeringRecoveryGateV2 } from "../src/engineering-recovery-gate.js";
import {
  createEngineeringWriteTransactionPreparedV2,
  engineeringSideEffectSubjectChecksumV2,
  InMemoryEngineeringWalRepositoryV2
} from "../src/engineering-wal-repository.js";

const hash = (value: string) => sha256EngineeringMutationTextV2(value);

describe("EngineeringRecoveryGateV2", () => {
  test("freshly closes the ordinary gate for a prepared WAL while an exact recovery lease remains bound", async () => {
    const wal = new InMemoryEngineeringWalRepositoryV2();
    const blobs = new InMemoryEngineeringMutationBlobStoreV2();
    const gate = createGate(wal, blobs);
    const request = createRequest();
    const prepared = createPrepared(request);
    const bytes = candidateBytes();

    const clean = await gate.scanRoot({ contentRootBindingId: "root_01" });
    expect(clean).toMatchObject({ ok: true, value: { status: "clear", reasons: [] } });
    await blobs.put({ contentRootBindingId: "root_01", bytes });
    await wal.prepare(prepared);

    // assertMutationAllowed performs a fresh scan, rather than trusting the preceding clear cache.
    await expect(gate.assertMutationAllowed("root_01")).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_RECOVERY_GATE_BLOCKED" }
    });
    await expect(
      gate.acquireRecoveryLease({
        contentRootBindingId: "root_01",
        transactionId: "tx_01",
        preparedChecksum: hash("wrong")
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_RECOVERY_GATE_LEASE_INVALID" }
    });

    const lease = await gate.acquireRecoveryLease({
      contentRootBindingId: "root_01",
      transactionId: "tx_01",
      preparedChecksum: prepared.preparedChecksum
    });
    expect(lease).toMatchObject({ ok: true, value: { kind: "recovery", transactionId: "tx_01" } });
    if (!lease.ok) throw new Error(lease.error.message);
    await expect(lease.value.assertCurrent()).resolves.toEqual({ ok: true, value: undefined });
    await expect(gate.assertMutationAllowed("root_01")).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_RECOVERY_GATE_BLOCKED" }
    });
    await lease.value.release();
  });

  test("fails closed for unavailable roots, missing staging/reservations, legacy work, and orphan reservations", async () => {
    const request = createRequest();
    const prepared = createPrepared(request);
    const wal = new InMemoryEngineeringWalRepositoryV2();
    const blobs = new InMemoryEngineeringMutationBlobStoreV2();
    await blobs.put({ contentRootBindingId: "root_01", bytes: candidateBytes() });
    await wal.prepare(prepared);
    const gate = createGate(wal, blobs, {
      verifyContentRootAvailable: async () => err({ code: "ROOT_UNAVAILABLE" } as never),
      scanLegacyRecovery: async () => ok({ status: "pending" as const }),
      scanStaging: async ({ referencedStagingObjectIds }) =>
        ok({
          verifiedObjectIds: [],
          missingObjectIds: referencedStagingObjectIds,
          orphanObjectIds: [],
          unknownObjectCount: 0,
          authenticationFailureCount: 0
        }),
      scanReservations: async ({ referencedAuthorizationIds }) =>
        ok({
          verifiedAuthorizationIds: [],
          missingAuthorizationIds: referencedAuthorizationIds,
          orphanAuthorizationIds: ["auth_orphan"],
          unknownRecordCount: 0,
          authenticationFailureCount: 0
        })
    });

    await expect(gate.scanRoot({ contentRootBindingId: "root_01" })).resolves.toMatchObject({
      ok: true,
      value: {
        status: "blocked",
        reasons: expect.arrayContaining([
          "root_unavailable",
          "authentication_failed",
          "legacy_recovery_pending",
          "orphaned_object"
        ])
      }
    });
  });

  test("rejects a scan port that does not report an exact verified/missing partition", async () => {
    const wal = new InMemoryEngineeringWalRepositoryV2();
    const blobs = new InMemoryEngineeringMutationBlobStoreV2();
    const gate = createGate(wal, blobs, {
      scanReservations: async () =>
        ok({
          verifiedAuthorizationIds: ["unrelated"],
          missingAuthorizationIds: [],
          orphanAuthorizationIds: [],
          unknownRecordCount: 0,
          authenticationFailureCount: 0
        })
    });

    await expect(gate.scanRoot({ contentRootBindingId: "root_01" })).resolves.toMatchObject({
      ok: true,
      value: { status: "blocked", reasons: expect.arrayContaining(["unknown_record"]) }
    });
  });
});

function createGate(
  walRepository: InMemoryEngineeringWalRepositoryV2,
  blobStore: InMemoryEngineeringMutationBlobStoreV2,
  overrides: Partial<ConstructorParameters<typeof EngineeringRecoveryGateV2>[0]> = {}
) {
  return new EngineeringRecoveryGateV2({
    walRepository,
    blobStore,
    verifyContentRootAvailable: async () => ok(undefined),
    verifyPreparedAuthorization: async () => ok(undefined),
    scanLegacyRecovery: async () => ok({ status: "clean" as const }),
    scanStaging: async ({ referencedStagingObjectIds }) =>
      ok({
        verifiedObjectIds: referencedStagingObjectIds,
        missingObjectIds: [],
        orphanObjectIds: [],
        unknownObjectCount: 0,
        authenticationFailureCount: 0
      }),
    scanReservations: async ({ referencedAuthorizationIds }) =>
      ok({
        verifiedAuthorizationIds: referencedAuthorizationIds,
        missingAuthorizationIds: [],
        orphanAuthorizationIds: [],
        unknownRecordCount: 0,
        authenticationFailureCount: 0
      }),
    now: () => "2099-01-01T00:00:00.000Z",
    ...overrides
  });
}

function createPrepared(request: EngineeringFileMutationRequestV2) {
  return createEngineeringWriteTransactionPreparedV2({
    transactionId: request.transactionId,
    contentRootBindingId: request.contentRootBindingId,
    providerSemanticVersionSetChecksum: request.providerSemanticVersionSetChecksum,
    authorization: authorization(request),
    operations: [request],
    preparedAt: "2099-01-01T00:00:00.000Z"
  });
}

function authorization(request: EngineeringFileMutationRequestV2) {
  return {
    authorizationId: "auth_01",
    approvalBindingId: "binding_01",
    approvalBindingChecksum: hash("binding"),
    sideEffectSubjectChecksum: engineeringSideEffectSubjectChecksumV2({
      transactionId: request.transactionId,
      contentRootBindingId: request.contentRootBindingId,
      providerSemanticVersionSetChecksum: request.providerSemanticVersionSetChecksum,
      operations: [request]
    }),
    changeSetId: "changes_01",
    changeSetRevision: 1,
    changeSetChecksum: hash("changes")
  };
}

function candidateBytes(): Uint8Array {
  return new TextEncoder().encode("const value = true;\n");
}

function createRequest(): EngineeringFileMutationRequestV2 {
  const bytes = candidateBytes();
  const manifest = createEngineeringRawByteManifestV2({
    identity: {
      kind: "target",
      rootBindingId: "root_01",
      relativeIdentity: "src/main.ts",
      fileIdentity: null
    },
    bytes,
    metadataChecksum: hash("metadata")
  });
  return {
    schemaVersion: "2.0",
    operationKind: "create_file",
    contentRootBindingId: "root_01",
    transactionId: "tx_01",
    operationId: "op_01",
    providerSemanticVersionSetChecksum: hash("provider"),
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
    candidate: {
      schemaVersion: "2.0",
      manifest,
      blob: {
        schemaVersion: "2.0",
        contentRootBindingId: "root_01",
        blobId: engineeringMutationBlobIdForSha256V2(manifest.sha256),
        storage: "main_owned_immutable_blob",
        sha256: manifest.sha256,
        byteLength: manifest.byteLength,
        encoding: manifest.encoding,
        bom: manifest.bom,
        eol: manifest.eol
      }
    },
    stagingObjectId: "staging_01"
  };
}
