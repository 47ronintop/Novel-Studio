import { describe, expect, test, vi } from "vitest";

import { ok } from "@novel-studio/shared";

import {
  createEngineeringAbsenceProofV2,
  createEngineeringFileMutationPortV2,
  createEngineeringRawByteManifestV2,
  engineeringFileLifecycleRequestChecksumV2,
  engineeringFileMutationRequestChecksumV2,
  engineeringMutationBlobIdForSha256V2,
  sha256EngineeringMutationTextV2,
  type EngineeringFileMutationApplyInputV2,
  type EngineeringFileMutationNativeAddonV2,
  type EngineeringFileMutationProposalNativeAddonV2,
  type EngineeringFileMutationRequestV2
} from "../src/engineering-file-mutation-port-v2.js";
import { createEngineeringMutationReceiptV2 } from "../src/engineering-mutation-receipt.js";

const hash = (value: string) => sha256EngineeringMutationTextV2(value);

describe("EngineeringFileMutationPortV2", () => {
  test("binds lifecycle reconcile, compensation, and finalize to the same root session", async () => {
    const request = lifecycleRequest("move_file");
    const receipt = lifecycleReceipt(request);
    const addon = {
      ...nativeAddon((rawRequest) => receiptFor(rawRequest)),
      moveEngineeringPathV2: vi.fn(),
      quarantineEngineeringFileV2: vi.fn(),
      restoreEngineeringFileV2: vi.fn(),
      purgeEngineeringQuarantineObjectV2: vi.fn(),
      createEngineeringDirectoryV2: vi.fn(),
      inspectEngineeringFileLifecycleOperationV2: vi.fn(() => ({
        schemaVersion: "3.0",
        kind: "engineering_file_lifecycle_operation_state",
        state: "after",
        requestChecksum: engineeringFileLifecycleRequestChecksumV2(request),
        receipt
      })),
      resumeEngineeringFileLifecycleOperationV2: vi.fn(() => ({
        schemaVersion: "3.0",
        kind: "engineering_file_lifecycle_operation_state",
        state: "after",
        requestChecksum: engineeringFileLifecycleRequestChecksumV2(request),
        receipt
      })),
      compensateEngineeringFileLifecycleOperationV2: vi.fn(() => ({
        schemaVersion: "3.0",
        kind: "engineering_file_lifecycle_operation_state",
        state: "before",
        requestChecksum: engineeringFileLifecycleRequestChecksumV2(request),
        receipt: null
      })),
      finalizeEngineeringFileLifecycleOperationV2: vi.fn(),
      inspectEngineeringQuarantineV2: vi.fn(() => ({
        schemaVersion: "3.0",
        kind: "engineering_quarantine_inventory",
        recoveryRootBindingId: "recovery_01",
        grantRevision: "grant_01",
        objects: [
          {
            recoveryObjectId: "object_01",
            fileIdentity: "file_01",
            sha256: hash("quarantined"),
            byteLength: 12n
          }
        ]
      }))
    };
    const port = createEngineeringFileMutationPortV2({
      addon,
      rootBinding: { contentRootBindingId: "root_01", rootId: 7n }
    });
    const recoveryInput = { request, recoveryBinding: null };
    if (
      port.reconcileLifecycle === undefined ||
      port.resumeLifecycle === undefined ||
      port.compensateLifecycle === undefined ||
      port.finalizeLifecycle === undefined ||
      port.inspectQuarantine === undefined
    )
      throw new Error("qualified lifecycle recovery methods are unavailable");

    await expect(port.reconcileLifecycle(recoveryInput)).resolves.toMatchObject({
      ok: true,
      value: { state: "after" }
    });
    await expect(port.resumeLifecycle(recoveryInput)).resolves.toMatchObject({
      ok: true,
      value: { state: "after" }
    });
    await expect(
      port.compensateLifecycle({ ...recoveryInput, expectedReceipt: receipt })
    ).resolves.toMatchObject({ ok: true, value: { state: "before" } });
    await expect(
      port.finalizeLifecycle({ ...recoveryInput, expectedState: "after" })
    ).resolves.toMatchObject({ ok: true });
    const inventoryBinding = {
      recoveryRootBindingId: "recovery_01",
      recoveryRootId: 8n,
      grantRevision: "grant_01",
      sideEffectChecksum: hash("recovery-side-effect")
    };
    await expect(port.inspectQuarantine(inventoryBinding)).resolves.toMatchObject({
      ok: true,
      value: { objects: [{ recoveryObjectId: "object_01", byteLength: 12n }] }
    });
    expect(addon.inspectEngineeringFileLifecycleOperationV2).toHaveBeenCalledWith(7n, 0n, request);
    expect(addon.resumeEngineeringFileLifecycleOperationV2).toHaveBeenCalledWith(7n, 0n, request);
    expect(addon.compensateEngineeringFileLifecycleOperationV2).toHaveBeenCalledWith(
      7n,
      0n,
      request,
      receipt
    );
    expect(addon.finalizeEngineeringFileLifecycleOperationV2).toHaveBeenCalledWith(
      7n,
      0n,
      request,
      "after"
    );
    expect(addon.inspectEngineeringQuarantineV2).toHaveBeenCalledWith(8n);
  });

  test("binds B8 move/delete/create-directory to the same native addon and fails closed when partial", async () => {
    const receipt = (request: ReturnType<typeof lifecycleRequest>) => ({
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
    });
    const addon = {
      ...nativeAddon((request) => receiptFor(request)),
      moveEngineeringPathV2: vi.fn((_root, request) => receipt(request)),
      quarantineEngineeringFileV2: vi.fn((_root, _recovery, request) => receipt(request)),
      restoreEngineeringFileV2: vi.fn(),
      purgeEngineeringQuarantineObjectV2: vi.fn(),
      createEngineeringDirectoryV2: vi.fn((_root, request) => receipt(request)),
      ...lifecycleRecoveryAddon()
    };
    const port = createEngineeringFileMutationPortV2({
      addon,
      rootBinding: { contentRootBindingId: "root_01", rootId: 7n }
    });
    await expect(port.move(lifecycleRequest("move_file"))).resolves.toMatchObject({
      ok: true,
      value: { state: "committed" }
    });
    const deleted = lifecycleRequest("delete_file");
    await expect(
      port.quarantine({
        request: deleted,
        recoveryBinding: {
          recoveryRootBindingId: deleted.recoveryRootBindingId,
          recoveryRootId: 8n,
          grantRevision: deleted.recoveryGrantRevision,
          sideEffectChecksum: deleted.recoverySideEffectChecksum
        }
      })
    ).resolves.toMatchObject({ ok: true, value: { state: "quarantined" } });
    await expect(port.createDirectory(lifecycleRequest("create_directory"))).resolves.toMatchObject(
      { ok: true, value: { state: "committed" } }
    );

    const partial = createEngineeringFileMutationPortV2({
      addon: nativeAddon((request) => receiptFor(request)),
      rootBinding: { contentRootBindingId: "root_01", rootId: 7n }
    });
    await expect(partial.move(lifecycleRequest("move_file"))).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_FILE_MUTATION_V2_UNAVAILABLE" }
    });
  });

  test("keeps restore and retention-authorized purge Main-only and root-bound", async () => {
    const restore = restoreRequest();
    const restoredReceipt = {
      schemaVersion: "3.0",
      kind: "engineering_file_lifecycle_receipt",
      operationKind: "restore_file",
      transactionId: restore.transactionId,
      operationId: restore.operationId,
      contentRootBindingId: restore.contentRootBindingId,
      relativeSource: "",
      relativeTarget: restore.relativeTarget,
      state: "restored",
      recoveryObjectId: restore.recoveryObjectId,
      durability: "data_and_directory_flushed"
    };
    const addon = {
      ...nativeAddon((request) => receiptFor(request)),
      moveEngineeringPathV2: vi.fn(),
      quarantineEngineeringFileV2: vi.fn(),
      restoreEngineeringFileV2: vi.fn(() => restoredReceipt),
      purgeEngineeringQuarantineObjectV2: vi.fn(),
      createEngineeringDirectoryV2: vi.fn(),
      ...lifecycleRecoveryAddon()
    };
    const port = createEngineeringFileMutationPortV2({
      addon,
      rootBinding: { contentRootBindingId: "root_01", rootId: 7n },
      authenticateRecoveryOperation: () => ok(undefined)
    });
    const recoveryBinding = {
      recoveryRootBindingId: restore.recoveryRootBindingId,
      recoveryRootId: 8n,
      grantRevision: restore.recoveryGrantRevision,
      sideEffectChecksum: restore.recoverySideEffectChecksum
    };
    if (port.restore === undefined || port.purge === undefined)
      throw new Error("qualified recovery methods are unavailable");

    await expect(port.restore({ request: restore, recoveryBinding })).resolves.toMatchObject({
      ok: true,
      value: { state: "restored" }
    });
    await expect(port.purge(purgeInput(recoveryBinding))).resolves.toMatchObject({ ok: true });
    expect(addon.restoreEngineeringFileV2).toHaveBeenCalledWith(7n, 8n, restore);
    expect(addon.purgeEngineeringQuarantineObjectV2).toHaveBeenCalledWith(8n, "object_02");

    await expect(
      port.restore({
        request: { ...restore, recoveryGrantRevision: "grant_changed" },
        recoveryBinding
      })
    ).resolves.toMatchObject({ ok: false });
    await expect(
      port.purge({
        ...purgeInput(recoveryBinding),
        retentionDecision: {
          ...purgeInput(recoveryBinding).retentionDecision,
          recoverySideEffectChecksum: hash("drifted-side-effect")
        }
      })
    ).resolves.toMatchObject({ ok: false });
    expect(addon.restoreEngineeringFileV2).toHaveBeenCalledTimes(1);
    expect(addon.purgeEngineeringQuarantineObjectV2).toHaveBeenCalledTimes(1);
  });

  test("does not invoke native recovery operations without Main authentication", async () => {
    const restore = restoreRequest();
    const addon = {
      ...nativeAddon((request) => receiptFor(request)),
      moveEngineeringPathV2: vi.fn(),
      quarantineEngineeringFileV2: vi.fn(),
      restoreEngineeringFileV2: vi.fn(),
      purgeEngineeringQuarantineObjectV2: vi.fn(),
      createEngineeringDirectoryV2: vi.fn(),
      ...lifecycleRecoveryAddon()
    };
    const port = createEngineeringFileMutationPortV2({
      addon,
      rootBinding: { contentRootBindingId: "root_01", rootId: 7n }
    });
    const recoveryBinding = {
      recoveryRootBindingId: restore.recoveryRootBindingId,
      recoveryRootId: 8n,
      grantRevision: restore.recoveryGrantRevision,
      sideEffectChecksum: restore.recoverySideEffectChecksum
    };
    if (port.restore === undefined || port.purge === undefined)
      throw new Error("qualified recovery methods are unavailable");

    await expect(port.restore({ request: restore, recoveryBinding })).resolves.toMatchObject({
      ok: false
    });
    await expect(port.purge(purgeInput(recoveryBinding))).resolves.toMatchObject({ ok: false });
    expect(addon.restoreEngineeringFileV2).not.toHaveBeenCalled();
    expect(addon.purgeEngineeringQuarantineObjectV2).not.toHaveBeenCalled();
  });

  test("passes Main re-read raw bytes through the root-bound native seam", async () => {
    const addon = nativeAddon((request) => receiptFor(request));
    const input = createApplyInput();
    const port = createEngineeringFileMutationPortV2({
      addon,
      rootBinding: { contentRootBindingId: "root_01", rootId: "native-root-01" },
      authenticateNativeEvidence: () => ok(undefined)
    });

    const result = await port.apply(input);

    expect(result).toMatchObject({
      ok: true,
      value: { contentRootBindingId: "root_01", transactionId: "tx_01", operationId: "op_01" }
    });
    expect(addon.applyEngineeringFileMutationV2).toHaveBeenCalledWith(
      "native-root-01",
      input.request,
      null,
      input.candidateBytes
    );
  });

  test("reconciles an already-applied operation without issuing another write", async () => {
    const input = createApplyInput();
    const addon = nativeAddon(
      (request) => receiptFor(request),
      (request) => operationState("after", request)
    );
    const port = createEngineeringFileMutationPortV2({
      addon,
      rootBinding: { contentRootBindingId: "root_01", rootId: 7n },
      authenticateNativeEvidence: () => ok(undefined)
    });

    const state = await port.reconcile(input);

    expect(state).toMatchObject({
      ok: true,
      value: { state: "after", receipt: { operationId: "op_01" } }
    });
    expect(addon.applyEngineeringFileMutationV2).not.toHaveBeenCalled();
    expect(addon.inspectEngineeringFileMutationTargetV2).toHaveBeenCalledWith(
      7n,
      input.request,
      null,
      input.candidateBytes
    );
  });

  test("fails closed without Main evidence authentication or for malformed apply input", async () => {
    const addon = nativeAddon((request) => receiptFor(request));
    const input = createApplyInput();
    const withoutAuthenticator = createEngineeringFileMutationPortV2({
      addon,
      rootBinding: { contentRootBindingId: "root_01", rootId: "native-root-01" }
    });
    const invalid = createEngineeringFileMutationPortV2({
      addon,
      rootBinding: { contentRootBindingId: "root_01", rootId: "native-root-01" },
      authenticateNativeEvidence: () => ok(undefined)
    });

    await expect(withoutAuthenticator.apply(input)).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_FILE_MUTATION_V2_EVIDENCE_UNQUALIFIED" }
    });
    await expect(
      invalid.apply({
        ...input,
        request: { ...input.request, recoveryObjectId: "recovery_01" }
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_FILE_MUTATION_V2_APPLY_INPUT_INVALID" }
    });
    expect(addon.applyEngineeringFileMutationV2).not.toHaveBeenCalled();
  });

  test("maps a native invocation failure to an outcome-unknown recovery result", async () => {
    const addon = nativeAddon(() => {
      throw new Error("native transport lost");
    });
    const port = createEngineeringFileMutationPortV2({
      addon,
      rootBinding: { contentRootBindingId: "root_01", rootId: "native-root-01" },
      authenticateNativeEvidence: () => ok(undefined)
    });

    await expect(port.apply(createApplyInput())).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_FILE_MUTATION_V2_OUTCOME_UNKNOWN" }
    });
  });

  test("reads a fresh root-bound raw proposal snapshot without exposing the native root handle", async () => {
    const bytes = proposalBytes();
    const authenticateNativeProposalEvidence = vi.fn(
      (input: { readonly kind: "snapshot" | "absence_proof" }) => {
        expect(input.kind).toMatch(/^(snapshot|absence_proof)$/u);
        return ok(undefined);
      }
    );
    const addon = proposalNativeAddon({
      snapshot: () => nativePresentSnapshot({ bytes }),
      absence: () => nativeAbsenceProof()
    });
    const port = createEngineeringFileMutationPortV2({
      addon,
      rootBinding: { contentRootBindingId: "root_01", rootId: "native-root-01" },
      authenticateNativeProposalEvidence
    });

    const result = await port.inspectProposalSnapshot({ relativeIdentity: "src/main.ts" });

    expect(result).toMatchObject({
      ok: true,
      value: {
        rootBindingId: "root_01",
        relativeIdentity: "src/main.ts",
        parentDirectoryIdentity: "directory_01",
        state: "present",
        manifest: {
          identity: {
            kind: "observed_file",
            rootBindingId: "root_01",
            relativeIdentity: "src/main.ts",
            fileIdentity: "file_01"
          }
        }
      }
    });
    if (!result.ok) throw new Error("expected a proposal snapshot");
    expect(result.value.bytes).toBeInstanceOf(Uint8Array);
    expect(result.value.bytes).toEqual(bytes);
    expect(result.value).not.toHaveProperty("rootId");
    expect(addon.inspectEngineeringFileSnapshotV2).toHaveBeenCalledWith(
      "native-root-01",
      "src/main.ts"
    );
    expect(authenticateNativeProposalEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "snapshot" })
    );
  });

  test("observes a create-only absence proof against a fresh snapshot from the same native handle", async () => {
    const authenticateNativeProposalEvidence = vi.fn(
      (input: { readonly kind: "snapshot" | "absence_proof" }) => {
        expect(input.kind).toMatch(/^(snapshot|absence_proof)$/u);
        return ok(undefined);
      }
    );
    const addon = proposalNativeAddon({
      snapshot: () => nativeAbsentSnapshot(),
      absence: () => nativeAbsenceProof()
    });
    const port = createEngineeringFileMutationPortV2({
      addon,
      rootBinding: { contentRootBindingId: "root_01", rootId: "native-root-01" },
      authenticateNativeProposalEvidence
    });

    const result = await port.observeCreateAbsence({
      relativeIdentity: "src/main.ts",
      observedAt: "2099-01-01T00:00:00.000Z"
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        rootBindingId: "root_01",
        relativeIdentity: "src/main.ts",
        parentDirectoryIdentity: "directory_01",
        observedAt: "2099-01-01T00:00:00.000Z"
      }
    });
    expect(addon.inspectEngineeringFileSnapshotV2).toHaveBeenCalledWith(
      "native-root-01",
      "src/main.ts"
    );
    expect(addon.observeCreateAbsenceV2).toHaveBeenCalledWith(
      "native-root-01",
      "root_01",
      "src/main.ts",
      "2099-01-01T00:00:00.000Z"
    );
    expect(authenticateNativeProposalEvidence.mock.calls.map(([input]) => input.kind)).toEqual([
      "snapshot",
      "absence_proof"
    ]);
  });

  test("rejects forged, wrong-root, wrong-relative, byte-mismatched, and manifest-mismatched snapshots", async () => {
    const malformedSnapshots = [
      () => ({ ...nativePresentSnapshot(), unexpected: true }),
      () => ({ ...nativePresentSnapshot(), rootId: "another-native-root" }),
      () => ({ ...nativePresentSnapshot(), relativeIdentity: "src/other.ts" }),
      () => ({ ...nativePresentSnapshot(), bytes: new TextEncoder().encode("different\n") }),
      () => {
        const snapshot = nativePresentSnapshot();
        return {
          ...snapshot,
          manifest: { ...snapshot.manifest, sha256: hash("different manifest") }
        };
      }
    ];

    for (const malformedSnapshot of malformedSnapshots) {
      const addon = proposalNativeAddon({
        snapshot: malformedSnapshot,
        absence: () => nativeAbsenceProof()
      });
      const port = createEngineeringFileMutationPortV2({
        addon,
        rootBinding: { contentRootBindingId: "root_01", rootId: "native-root-01" },
        authenticateNativeProposalEvidence: () => ok(undefined)
      });

      await expect(
        port.inspectProposalSnapshot({ relativeIdentity: "src/main.ts" })
      ).resolves.toMatchObject({
        ok: false,
        error: { code: "ENGINEERING_FILE_MUTATION_V2_PROPOSAL_EVIDENCE_INVALID" }
      });
    }
  });

  test("rejects an absence proof when its root, relative identity, parent identity, or time differs from the fresh snapshot", async () => {
    const invalidProofs = [
      nativeAbsenceProof({ rootBindingId: "root_02" }),
      nativeAbsenceProof({ relativeIdentity: "src/other.ts" }),
      nativeAbsenceProof({ parentDirectoryIdentity: "directory_02" }),
      nativeAbsenceProof({ observedAt: "2099-01-01T00:00:01.000Z" })
    ];

    for (const absence of invalidProofs) {
      const addon = proposalNativeAddon({
        snapshot: () => nativeAbsentSnapshot(),
        absence: () => absence
      });
      const port = createEngineeringFileMutationPortV2({
        addon,
        rootBinding: { contentRootBindingId: "root_01", rootId: "native-root-01" },
        authenticateNativeProposalEvidence: () => ok(undefined)
      });

      await expect(
        port.observeCreateAbsence({
          relativeIdentity: "src/main.ts",
          observedAt: "2099-01-01T00:00:00.000Z"
        })
      ).resolves.toMatchObject({
        ok: false,
        error: { code: "ENGINEERING_FILE_MUTATION_V2_PROPOSAL_EVIDENCE_INVALID" }
      });
    }
  });

  test("fails closed when proposal evidence authentication is missing or throws", async () => {
    const missingAuthAddon = proposalNativeAddon({
      snapshot: () => nativePresentSnapshot(),
      absence: () => nativeAbsenceProof()
    });
    const missingAuthenticator = createEngineeringFileMutationPortV2({
      addon: missingAuthAddon,
      rootBinding: { contentRootBindingId: "root_01", rootId: "native-root-01" }
    });

    await expect(
      missingAuthenticator.inspectProposalSnapshot({ relativeIdentity: "src/main.ts" })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_FILE_MUTATION_V2_EVIDENCE_UNQUALIFIED" }
    });
    expect(missingAuthAddon.inspectEngineeringFileSnapshotV2).not.toHaveBeenCalled();

    const throwingAuthenticator = createEngineeringFileMutationPortV2({
      addon: proposalNativeAddon({
        snapshot: () => nativeAbsentSnapshot(),
        absence: () => nativeAbsenceProof()
      }),
      rootBinding: { contentRootBindingId: "root_01", rootId: "native-root-01" },
      authenticateNativeProposalEvidence: ({ kind }) => {
        if (kind === "snapshot") return ok(undefined);
        throw new Error("native proposal evidence signature rejected");
      }
    });

    await expect(
      throwingAuthenticator.observeCreateAbsence({
        relativeIdentity: "src/main.ts",
        observedAt: "2099-01-01T00:00:00.000Z"
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_FILE_MUTATION_V2_EVIDENCE_AUTHENTICATION_FAILED" }
    });
  });

  test("fails closed when native rejects an unsafe proposal-time object", async () => {
    const addon = proposalNativeAddon({
      snapshot: () => {
        throw { code: "ENGINEERING_ACCESS_UNSAFE_OBJECT" };
      },
      absence: () => nativeAbsenceProof()
    });
    const port = createEngineeringFileMutationPortV2({
      addon,
      rootBinding: { contentRootBindingId: "root_01", rootId: "native-root-01" },
      authenticateNativeProposalEvidence: () => ok(undefined)
    });

    await expect(
      port.inspectProposalSnapshot({ relativeIdentity: "src/main.ts" })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_FILE_MUTATION_V2_PROPOSAL_EVIDENCE_UNAVAILABLE" }
    });
    expect(addon.observeCreateAbsenceV2).not.toHaveBeenCalled();
  });
});

function lifecycleRequest(kind: "move_file" | "delete_file" | "create_directory") {
  return {
    schemaVersion: "3.0" as const,
    operationKind: kind,
    transactionId: "tx_02",
    operationId: "op_02",
    contentRootBindingId: "root_01",
    relativeSource: kind === "create_directory" ? "" : "src/main.ts",
    relativeTarget:
      kind === "move_file" ? "src/Main.ts" : kind === "create_directory" ? "src/new" : "",
    sourceFileIdentity: kind === "create_directory" ? "" : "file_01",
    sourceSha256: kind === "create_directory" ? "0".repeat(64) : hash("source"),
    targetProof: "absent" as const,
    recoveryRootBindingId: "recovery_01",
    recoveryGrantRevision: "grant_01",
    recoverySideEffectChecksum: hash("side-effect"),
    recoveryObjectId: "object_01",
    stagingObjectId: "staging_02",
    expectedState: "wal_prepared" as const
  };
}

function lifecycleReceipt(request: ReturnType<typeof lifecycleRequest>) {
  return {
    schemaVersion: "3.0" as const,
    kind: "engineering_file_lifecycle_receipt" as const,
    operationKind: request.operationKind,
    transactionId: request.transactionId,
    operationId: request.operationId,
    contentRootBindingId: request.contentRootBindingId,
    relativeSource: request.relativeSource,
    relativeTarget: request.relativeTarget,
    state:
      request.operationKind === "delete_file" ? ("quarantined" as const) : ("committed" as const),
    recoveryObjectId: request.operationKind === "delete_file" ? request.recoveryObjectId : "",
    durability: "data_and_directory_flushed" as const
  };
}

function restoreRequest() {
  return {
    schemaVersion: "3.0" as const,
    operationKind: "restore_file" as const,
    transactionId: "tx_03",
    operationId: "op_03",
    contentRootBindingId: "root_01",
    relativeSource: "" as const,
    relativeTarget: "src/restored.ts",
    sourceFileIdentity: "file_02",
    sourceSha256: hash("restored-source"),
    targetProof: "absent" as const,
    recoveryRootBindingId: "recovery_02",
    recoveryGrantRevision: "grant_02",
    recoverySideEffectChecksum: hash("restore-side-effect"),
    recoveryObjectId: "object_02",
    stagingObjectId: "staging_03",
    expectedState: "wal_prepared" as const
  };
}

function purgeInput(recoveryBinding: {
  readonly recoveryRootBindingId: string;
  readonly recoveryRootId: string | bigint;
  readonly grantRevision: string;
  readonly sideEffectChecksum: string;
}) {
  return {
    recoveryBinding,
    retentionDecision: {
      schemaVersion: "2.0" as const,
      kind: "engineering_quarantine_retention_decision" as const,
      contentRootBindingId: "root_01",
      recoveryRootBindingId: recoveryBinding.recoveryRootBindingId,
      recoveryGrantRevision: recoveryBinding.grantRevision,
      recoverySideEffectChecksum: recoveryBinding.sideEffectChecksum,
      recoveryObjectId: "object_02",
      state: "purge_authorized" as const,
      decisionChecksum: hash("purge-decision")
    }
  };
}

function nativeAddon(
  apply: (request: EngineeringFileMutationRequestV2) => unknown,
  inspect: (request: EngineeringFileMutationRequestV2) => unknown = () => {
    throw new Error("not used");
  }
): EngineeringFileMutationNativeAddonV2 & {
  applyEngineeringFileMutationV2: ReturnType<typeof vi.fn>;
  inspectEngineeringFileMutationTargetV2: ReturnType<typeof vi.fn>;
} {
  return {
    applyEngineeringFileMutationV2: vi.fn(
      (_rootId: string | bigint, request: EngineeringFileMutationRequestV2) => apply(request)
    ),
    inspectEngineeringFileMutationTargetV2: vi.fn(
      (_rootId: string | bigint, request: EngineeringFileMutationRequestV2) => inspect(request)
    )
  };
}

function proposalNativeAddon(input: {
  readonly snapshot: () => unknown;
  readonly absence: () => unknown;
}): EngineeringFileMutationNativeAddonV2 &
  EngineeringFileMutationProposalNativeAddonV2 & {
    inspectEngineeringFileSnapshotV2: ReturnType<typeof vi.fn>;
    observeCreateAbsenceV2: ReturnType<typeof vi.fn>;
  } {
  return {
    ...nativeAddon((request) => receiptFor(request)),
    inspectEngineeringFileSnapshotV2: vi.fn(() => input.snapshot()),
    observeCreateAbsenceV2: vi.fn(() => input.absence())
  };
}

function proposalBytes(): Uint8Array {
  return new TextEncoder().encode("export const proposal = true;\n");
}

function nativePresentSnapshot(
  input: {
    readonly rootId?: string | bigint;
    readonly relativeIdentity?: string;
    readonly parentDirectoryIdentity?: string;
    readonly bytes?: Uint8Array;
  } = {}
) {
  const bytes = input.bytes ?? proposalBytes();
  const manifest = createEngineeringRawByteManifestV2({
    identity: {
      kind: "observed_file",
      rootBindingId: "root_01",
      relativeIdentity: input.relativeIdentity ?? "src/main.ts",
      fileIdentity: "file_01"
    },
    bytes,
    metadataChecksum: hash("safe-metadata")
  });
  return {
    schemaVersion: "2.0",
    kind: "engineering_file_mutation_target_snapshot",
    rootId: input.rootId ?? "native-root-01",
    relativeIdentity: input.relativeIdentity ?? "src/main.ts",
    parentDirectoryIdentity: input.parentDirectoryIdentity ?? "directory_01",
    state: "present",
    bytes,
    manifest: {
      sha256: manifest.sha256,
      byteLength: manifest.byteLength,
      encoding: manifest.encoding,
      bom: manifest.bom,
      eol: manifest.eol,
      fileIdentity: manifest.identity.fileIdentity,
      metadataChecksum: manifest.metadataChecksum
    }
  };
}

function nativeAbsentSnapshot(
  input: {
    readonly rootId?: string | bigint;
    readonly relativeIdentity?: string;
    readonly parentDirectoryIdentity?: string;
  } = {}
) {
  return {
    schemaVersion: "2.0",
    kind: "engineering_file_mutation_target_snapshot",
    rootId: input.rootId ?? "native-root-01",
    relativeIdentity: input.relativeIdentity ?? "src/main.ts",
    parentDirectoryIdentity: input.parentDirectoryIdentity ?? "directory_01",
    state: "absent",
    bytes: null,
    manifest: null
  };
}

function nativeAbsenceProof(
  input: {
    readonly rootBindingId?: string;
    readonly relativeIdentity?: string;
    readonly parentDirectoryIdentity?: string;
    readonly observedAt?: string;
  } = {}
) {
  return createEngineeringAbsenceProofV2({
    rootBindingId: input.rootBindingId ?? "root_01",
    relativeIdentity: input.relativeIdentity ?? "src/main.ts",
    parentDirectoryIdentity: input.parentDirectoryIdentity ?? "directory_01",
    observedAt: input.observedAt ?? "2099-01-01T00:00:00.000Z"
  });
}

function createApplyInput(): EngineeringFileMutationApplyInputV2 {
  const request = createRequest();
  return { request, beforeBytes: null, candidateBytes: candidateBytes() };
}

function candidateBytes(): Uint8Array {
  return new TextEncoder().encode("export const value = 1;\n");
}

function createRequest(): EngineeringFileMutationRequestV2 {
  const bytes = candidateBytes();
  const candidate = createEngineeringRawByteManifestV2({
    identity: {
      kind: "target",
      rootBindingId: "root_01",
      relativeIdentity: "src/main.ts",
      fileIdentity: null
    },
    bytes,
    metadataChecksum: hash("safe-metadata")
  });
  return {
    schemaVersion: "2.0",
    operationKind: "create_file",
    contentRootBindingId: "root_01",
    transactionId: "tx_01",
    operationId: "op_01",
    providerSemanticVersionSetChecksum: hash("provider-set"),
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
      manifest: candidate,
      blob: {
        schemaVersion: "2.0",
        contentRootBindingId: "root_01",
        blobId: engineeringMutationBlobIdForSha256V2(candidate.sha256),
        storage: "main_owned_immutable_blob",
        sha256: candidate.sha256,
        byteLength: candidate.byteLength,
        encoding: candidate.encoding,
        bom: candidate.bom,
        eol: candidate.eol
      }
    },
    stagingObjectId: "staging_01"
  };
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
        fileIdentity: "file_02"
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
): unknown {
  return {
    schemaVersion: "2.0",
    kind: "engineering_mutation_operation_state",
    state,
    requestChecksum: engineeringFileMutationRequestChecksumV2(request),
    receipt: state === "after" ? receiptFor(request) : null
  };
}

function lifecycleRecoveryAddon() {
  return {
    inspectEngineeringFileLifecycleOperationV2: vi.fn(),
    resumeEngineeringFileLifecycleOperationV2: vi.fn(),
    compensateEngineeringFileLifecycleOperationV2: vi.fn(),
    finalizeEngineeringFileLifecycleOperationV2: vi.fn(),
    inspectEngineeringQuarantineV2: vi.fn()
  };
}
