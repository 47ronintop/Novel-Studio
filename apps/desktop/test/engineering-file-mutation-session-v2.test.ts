import { createHash } from "node:crypto";

import { describe, expect, test } from "vitest";

import {
  LEGACY_ALL_HUMAN_APPROVAL_RULE_SET_CHECKSUM,
  LEGACY_ALL_HUMAN_APPROVAL_RULE_SET_VERSION,
  checksumChangeSetText,
  createApprovalBindingV2,
  createChangeSetRevisionV2,
  createMainOnlyApprovalDecisionProofV1,
  decideChangeSetApprovalV2,
  type ApprovalBindingV2,
  type ChangeSetApprovalV2,
  type ChangeSetV2,
  type MainOnlyApprovalDecisionProofV1
} from "@novel-studio/agent-engine";
import {
  authorizeApprovalBindingV2,
  buildEngineeringApprovalBindingV2,
  createMainApprovalIssuer,
  type AgentRunCapabilityBoundary,
  type EngineeringApprovalLedgerV2Port,
  type EngineeringFileMutationSessionV2,
  type EngineeringPreparedFileMutationProposalV2
} from "@novel-studio/application";
import {
  InMemoryEngineeringMutationBlobStoreV2,
  InMemoryEngineeringMutationProposalRepositoryV2,
  createEngineeringAbsenceProofV2,
  createEngineeringRawByteManifestV2,
  sha256EngineeringMutationTextV2,
  type EngineeringFileMutationProposalPortV2,
  type EngineeringFileMutationProposalSnapshotV2
} from "@novel-studio/repository";
import { err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import {
  createDesktopEngineeringFileMutationSessionV2,
  type DesktopEngineeringFileMutationSessionV2Options
} from "../src/main/engineering-file-mutation-session-v2.js";
import type {
  EngineeringMutationProposalApprovalPortV2,
  EngineeringMutationRuntimeApplyRequestV2,
  EngineeringMutationRuntimeResultV2,
  EngineeringMutationRuntimeV2
} from "../src/main/engineering-mutation-runtime-v2.js";

const ROOT_BINDING_ID = "root_01";
const WORKSPACE_BINDING_ID = "workspace_01";
const PATH_POLICY_REVISION = "path_policy_01";
const REF_CAPABILITY_REVISION = "ref_capability_01";
const POLICY_REVISION = "policy_01";
const CAPABILITY_REVISION = "capability_01";
const PROVIDER_VERSION_SET_CHECKSUM = "a".repeat(64);
const NOW = "2099-01-01T00:00:00.000Z";
const EXPIRES_AT = "2099-01-01T01:00:00.000Z";

describe("DesktopEngineeringFileMutationSessionV2", () => {
  test("preserves BOM, line-ending mode, and every untouched raw-byte region during replace preparation", async () => {
    const cases = [
      { name: "UTF-8 BOM", bom: true, text: "first\nOLD\nlast\n" },
      { name: "LF", bom: false, text: "first\nOLD\nlast\n" },
      { name: "CRLF", bom: false, text: "first\r\nOLD\r\nlast\r\n" },
      { name: "mixed EOL", bom: false, text: "first\r\nOLD\nlast\r\n" }
    ] as const;

    for (const fixture of cases) {
      const bytes = encodeText(fixture.text, fixture.bom);
      const snapshot = presentSnapshot(bytes);
      const harness = createHarness(snapshot);
      const fileRef = issueFileRef(harness, snapshot);
      const start = fixture.text.indexOf("OLD");
      const end = start + "OLD".length;

      const prepared = expectOk(
        await harness.bundle.session.prepare({
          runId: "run_01",
          projectId: "project_01",
          toolCallId: `call_${fixture.name.replaceAll(" ", "_")}`,
          toolName: "propose_file_write",
          arguments: {
            fileRef,
            range: { unit: "character", start, end },
            replacement: "NEW"
          },
          canonicalPayloadChecksum: checksum(`payload:${fixture.name}`),
          writePolicy: "write_before_confirmation",
          boundary: proposalBoundary()
        })
      );

      const record = await onlyRecord(harness);
      if (record.before.kind !== "present") throw new Error("expected a present before-image");
      const beforeBytes = expectOk(await harness.blobStore.get(record.before.blob));
      const candidateBytes = expectOk(await harness.blobStore.get(record.candidate.blob));
      const expected = encodeText(
        `${fixture.text.slice(0, start)}NEW${fixture.text.slice(end)}`,
        fixture.bom
      );
      const bomLength = fixture.bom ? 3 : 0;
      const startByte =
        bomLength + new TextEncoder().encode(fixture.text.slice(0, start)).byteLength;
      const endByte = bomLength + new TextEncoder().encode(fixture.text.slice(0, end)).byteLength;

      expect(prepared.operationKind).toBe("replace_file");
      expect(beforeBytes).toEqual(bytes);
      expect(candidateBytes).toEqual(expected);
      expect(candidateBytes.subarray(0, startByte)).toEqual(bytes.subarray(0, startByte));
      expect(candidateBytes.subarray(startByte + 3)).toEqual(bytes.subarray(endByte));
      expect(record.before).toMatchObject({
        kind: "present",
        manifest: { bom: fixture.bom ? "utf-8" : "none", eol: eolFor(fixture.text) }
      });
      expect(record.candidate.manifest).toMatchObject({
        bom: fixture.bom ? "utf-8" : "none",
        eol: eolFor(fixture.text)
      });
    }
  });

  test("uses a native create-only absence proof, preserves CRLF candidates, persists no before blob, and rejects an already-stale proof", async () => {
    const harness = createHarness(presentSnapshot(encodeText("ignored\n", false)));
    const parentRef = issueDirectoryRef(harness, "src");

    const prepared = expectOk(
      await harness.bundle.session.prepare({
        runId: "run_01",
        projectId: "project_01",
        toolCallId: "create_call_01",
        toolName: "propose_file_create",
        arguments: { parentRef, name: "new-file.ts", candidate: "export const created = true;\n" },
        canonicalPayloadChecksum: checksum("create-payload"),
        writePolicy: "write_before_confirmation",
        boundary: proposalBoundary()
      })
    );

    const record = await onlyRecord(harness);
    const candidate = expectOk(await harness.blobStore.get(record.candidate.blob));
    expect(prepared).toMatchObject({
      operationKind: "create_file",
      relativeIdentity: "src/new-file.ts"
    });
    expect(harness.snapshotCalls).toHaveLength(0);
    expect(harness.absenceCalls).toEqual([
      { relativeIdentity: "src/new-file.ts", observedAt: NOW }
    ]);
    expect(record.before).toMatchObject({
      kind: "absent",
      absenceProof: {
        rootBindingId: ROOT_BINDING_ID,
        relativeIdentity: "src/new-file.ts",
        parentDirectoryIdentity: "directory_01",
        observedAt: NOW
      }
    });
    expect(record.candidate.manifest).toMatchObject({
      bom: "none",
      eol: "lf",
      metadataChecksum: checksum("engineering_file_metadata_v2\nattributes=128")
    });
    expect(candidate).toEqual(new TextEncoder().encode("export const created = true;\n"));

    const crlfHarness = createHarness(presentSnapshot(encodeText("ignored\n", false)));
    const crlfParentRef = issueDirectoryRef(crlfHarness, "src");
    const crlfCandidate = "export const createdWithCrLf = true;\r\n";
    const crlfPrepared = expectOk(
      await crlfHarness.bundle.session.prepare({
        runId: "run_01",
        projectId: "project_01",
        toolCallId: "create_crlf_call_01",
        toolName: "propose_file_create",
        arguments: { parentRef: crlfParentRef, name: "crlf-file.ts", candidate: crlfCandidate },
        canonicalPayloadChecksum: checksum("create-crlf-payload"),
        writePolicy: "write_before_confirmation",
        boundary: proposalBoundary()
      })
    );
    const crlfRecord = await onlyRecord(crlfHarness);
    expect(crlfPrepared).toMatchObject({
      operationKind: "create_file",
      relativeIdentity: "src/crlf-file.ts"
    });
    expect(crlfRecord.candidate.manifest).toMatchObject({
      bom: "none",
      eol: "crlf",
      metadataChecksum: checksum("engineering_file_metadata_v2\nattributes=128")
    });
    expect(expectOk(await crlfHarness.blobStore.get(crlfRecord.candidate.blob))).toEqual(
      encodeText(crlfCandidate, false)
    );

    const staleHarness = createHarness(presentSnapshot(encodeText("ignored\n", false)));
    staleHarness.state.absenceResult = err(testError("ENGINEERING_FILE_MUTATION_V2_STALE"));
    const staleParentRef = issueDirectoryRef(staleHarness, "src");
    await expect(
      staleHarness.bundle.session.prepare({
        runId: "run_01",
        projectId: "project_01",
        toolCallId: "create_call_stale",
        toolName: "propose_file_create",
        arguments: { parentRef: staleParentRef, name: "new-file.ts", candidate: "created" },
        canonicalPayloadChecksum: checksum("create-payload-stale"),
        writePolicy: "write_before_confirmation",
        boundary: proposalBoundary()
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "ENGINEERING_FILE_MUTATION_V2_STALE" } });
    expect(expectOk(await staleHarness.proposalRepository.scan()).proposals).toHaveLength(0);
  });

  test("prepares a durable single-level directory lifecycle proposal", async () => {
    const harness = createHarness(presentSnapshot(encodeText("ignored\n", false)));
    const parentRef = issueDirectoryRef(harness, "src");

    const prepared = expectOk(
      await harness.bundle.session.prepare({
        runId: "run_01",
        projectId: "project_01",
        toolCallId: "directory_call_01",
        toolName: "propose_directory_create",
        arguments: { parentRef, name: "new-directory" },
        canonicalPayloadChecksum: checksum("directory-payload"),
        writePolicy: "write_before_confirmation",
        boundary: proposalBoundary()
      })
    );

    expect(prepared).toMatchObject({
      operationKind: "create_directory",
      relativeIdentity: "src/new-directory",
      changeSetMutation: {
        kind: "create_directory",
        operation: {
          kind: "create_directory",
          relativePath: "src/new-directory",
          selected: true
        }
      }
    });
    expect(await onlyRecord(harness)).toMatchObject({
      operationKind: "create_directory",
      relativeIdentity: "src/new-directory",
      targetRelativeIdentity: "src/new-directory",
      targetProof: { kind: "absent", relativeIdentity: "src/new-directory" },
      recoveryRootBindingId: null
    });
  });

  test("keeps delete fail closed without a qualified recovery binding", async () => {
    const snapshot = presentSnapshot(encodeText("delete me\n", false));
    const harness = createHarness(snapshot);

    await expect(
      harness.bundle.session.prepare({
        runId: "run_01",
        projectId: "project_01",
        toolCallId: "delete_call_01",
        toolName: "propose_file_delete",
        arguments: { fileRef: issueFileRef(harness, snapshot) },
        canonicalPayloadChecksum: checksum("delete-payload"),
        writePolicy: "write_before_confirmation",
        boundary: proposalBoundary()
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_LIFECYCLE_RECOVERY_BINDING_UNAVAILABLE" }
    });
    expect(expectOk(await harness.proposalRepository.scan()).proposals).toHaveLength(0);
    expect(expectOk(await harness.blobStore.listRoot(ROOT_BINDING_ID))).toHaveLength(0);
  });

  test("binds a recoverable delete proposal to an authenticated absent after-state", async () => {
    const snapshot = presentSnapshot(encodeText("delete me\n", false));
    const harness = createHarness(snapshot, {
      resolveLifecycleRecoveryBinding: async () =>
        ok({
          recoveryRootBindingId: "recovery_01",
          recoveryGrantRevision: "grant_01",
          recoverySideEffectChecksum: checksum("delete-side-effect"),
          recoveryObjectId: "recovery_object_01"
        })
    });

    const prepared = expectOk(
      await harness.bundle.session.prepare({
        runId: "run_01",
        projectId: "project_01",
        toolCallId: "delete_call_bound_01",
        toolName: "propose_file_delete",
        arguments: { fileRef: issueFileRef(harness, snapshot) },
        canonicalPayloadChecksum: checksum("delete-bound-payload"),
        writePolicy: "write_before_confirmation",
        boundary: proposalBoundary()
      })
    );

    expect(prepared).toMatchObject({ operationKind: "delete_file" });
    expect(await onlyRecord(harness)).toMatchObject({
      operationKind: "delete_file",
      targetRelativeIdentity: "",
      targetProof: {
        kind: "absent",
        relativeIdentity: "src/file.ts",
        parentDirectoryIdentity: "directory_01",
        proofChecksum: expect.stringMatching(/^[a-f0-9]{64}$/u)
      }
    });
  });

  test("keeps same-toolCallId preparation idempotent and rejects a changed canonical payload", async () => {
    const snapshot = presentSnapshot(encodeText("const value = OLD;\n", false));
    const harness = createHarness(snapshot);
    const fileRef = issueFileRef(harness, snapshot);
    const input = replaceInput(fileRef, "idempotent_call", checksum("payload-one"), 14, 17, "NEW");

    const first = expectOk(await harness.bundle.session.prepare(input));
    const second = expectOk(await harness.bundle.session.prepare(input));
    const conflict = await harness.bundle.session.prepare({
      ...input,
      canonicalPayloadChecksum: checksum("payload-two")
    });

    expect(first).toEqual(second);
    expect(harness.snapshotCalls).toHaveLength(1);
    expect(conflict).toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_TOOL_CALL_ID_PAYLOAD_CONFLICT" }
    });
    expect(expectOk(await harness.proposalRepository.scan()).proposals).toHaveLength(1);
  });

  test("fails preparation for a stale fresh snapshot and rejects a stale approval proof", async () => {
    const oldSnapshot = presentSnapshot(encodeText("const value = OLD;\n", false));
    const changedSnapshot = presentSnapshot(encodeText("const value = NEW;\n", false));
    const staleSnapshotHarness = createHarness(changedSnapshot);
    const staleFileRef = issueFileRef(staleSnapshotHarness, oldSnapshot);

    await expect(
      staleSnapshotHarness.bundle.session.prepare(
        replaceInput(staleFileRef, "stale_snapshot", checksum("stale-snapshot"), 14, 17, "NEXT")
      )
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_FILE_MUTATION_V2_STALE" }
    });

    const snapshot = presentSnapshot(encodeText("const value = OLD;\n", false));
    const proofHarness = createHarness(snapshot);
    const prepared = expectOk(
      await proofHarness.bundle.session.prepare(
        replaceInput(
          issueFileRef(proofHarness, snapshot),
          "stale_proof",
          checksum("stale-proof"),
          14,
          17,
          "NEW"
        )
      )
    );
    const changeSet = await changeSetFor(prepared, "const value = OLD;\n");
    expectOk(await proofHarness.bundle.session.bindChangeSet({ prepared, changeSet }));
    const proofInput = expectOk(
      await proofHarness.bundle.session.prepareApprovalProofInput(approvalProofRequest(changeSet))
    );
    const staleProof = approvalProof(changeSet, proofInput, {
      baseManifestChecksum: checksum("forged-base-manifest")
    });

    await expect(
      proofHarness.bundle.session.finalizeApprovalFacts({
        changeSet,
        proof: staleProof,
        proofInput,
        ...approvalProofRequest(changeSet)
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "ENGINEERING_FILE_MUTATION_V2_STALE" } });
  });

  test("requires a reserved ledger record, revalidates immediately before apply, and marks only a committed proposal applied", async () => {
    const sourceText = "const value = OLD;\n";
    const snapshot = presentSnapshot(encodeText(sourceText, false));
    const harness = createHarness(snapshot);
    const prepared = expectOk(
      await harness.bundle.session.prepare(
        replaceInput(
          issueFileRef(harness, snapshot),
          "apply_call",
          checksum("apply-payload"),
          14,
          17,
          "NEW"
        )
      )
    );
    const { changeSet, approval } = await approvedApply(harness, prepared, sourceText);

    const result = await harness.bundle.session.apply({ changeSet, approval });

    expect(result).toMatchObject({
      ok: true,
      value: {
        status: "committed",
        transactionStatus: "committed",
        operationKind: "replace_file",
        operations: [{ relativePaths: ["src/file.ts"] }]
      }
    });
    expect(harness.ledgerCalls).toEqual([
      { authorizationId: "auth_01", transactionId: "transaction_01" },
      { authorizationId: "auth_01", transactionId: "transaction_01" },
      { authorizationId: "auth_01", transactionId: "transaction_01" }
    ]);
    expect(harness.proofReads.value).toBe(2);
    expect(harness.runtimeInputs).toHaveLength(1);
    expect(harness.runtimeInputs[0]).toMatchObject({
      transactionInput: {
        transactionId: "transaction_01",
        operations: [
          {
            before: { kind: "present", bytes: encodeText(sourceText, false) },
            candidate: { bytes: encodeText("const value = NEW;\n", false) }
          }
        ]
      }
    });
    expect((await onlyRecord(harness)).status).toBe("applied");

    const ledgerHarness = createHarness(snapshot);
    const ledgerPrepared = expectOk(
      await ledgerHarness.bundle.session.prepare(
        replaceInput(
          issueFileRef(ledgerHarness, snapshot),
          "ledger_call",
          checksum("ledger-payload"),
          14,
          17,
          "NEW"
        )
      )
    );
    const ledgerApproved = await approvedApply(ledgerHarness, ledgerPrepared, sourceText);
    ledgerHarness.state.ledgerResult = err(testError("LEDGER_UNAVAILABLE"));

    await expect(ledgerHarness.bundle.session.apply(ledgerApproved)).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_FILE_APPROVAL_V2_LEDGER_REJECTED" }
    });
    expect(ledgerHarness.runtimeInputs).toHaveLength(0);
    expect((await onlyRecord(ledgerHarness)).status).toBe("proposed");
  });

  test("fails revalidation if the Main-owned approval proof changes after pending apply is built", async () => {
    const sourceText = "const value = OLD;\n";
    const snapshot = presentSnapshot(encodeText(sourceText, false));
    const harness = createHarness(snapshot);
    const prepared = expectOk(
      await harness.bundle.session.prepare(
        replaceInput(
          issueFileRef(harness, snapshot),
          "revalidate_call",
          checksum("revalidate-payload"),
          14,
          17,
          "NEW"
        )
      )
    );
    const { changeSet, approval, proofInput } = await approvedApply(harness, prepared, sourceText);
    harness.state.beforeRuntimeRevalidate = () => {
      harness.state.proof = approvalProof(changeSet, proofInput, {
        candidateManifestChecksum: checksum("changed-candidate-manifest")
      });
    };

    await expect(harness.bundle.session.apply({ changeSet, approval })).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_FILE_MUTATION_V2_STALE" }
    });
    expect((await onlyRecord(harness)).status).toBe("proposed");
  });

  test("revokes an absent reservation when Engineering WAL prepare throws", async () => {
    const sourceText = "const value = OLD;\n";
    const snapshot = presentSnapshot(encodeText(sourceText, false));
    const harness = createHarness(snapshot);
    const prepared = expectOk(
      await harness.bundle.session.prepare(
        replaceInput(
          issueFileRef(harness, snapshot),
          "prepare_failure_call",
          checksum("prepare-failure-payload"),
          14,
          17,
          "NEW"
        )
      )
    );
    const approved = await approvedApply(harness, prepared, sourceText);
    harness.state.runtimeThrows = true;
    harness.state.reconciliationOutcome = "revoked";

    await expect(harness.bundle.session.apply(approved)).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_MUTATION_RUNTIME_APPLY_FAILED" }
    });

    expect(harness.reconciliationCalls).toEqual([
      {
        authorizationId: "auth_01",
        transactionId: "transaction_01",
        contentRootBindingId: ROOT_BINDING_ID
      }
    ]);
    expect((await onlyRecord(harness)).status).toBe("proposed");
    expect(harness.consumeCalls).toHaveLength(0);
  });

  test("leaves a prepared reservation recovery-owned when apply fails after WAL prepare", async () => {
    const sourceText = "const value = OLD;\n";
    const snapshot = presentSnapshot(encodeText(sourceText, false));
    const harness = createHarness(snapshot);
    const prepared = expectOk(
      await harness.bundle.session.prepare(
        replaceInput(
          issueFileRef(harness, snapshot),
          "prepared_apply_failure_call",
          checksum("prepared-apply-failure-payload"),
          14,
          17,
          "NEW"
        )
      )
    );
    const approved = await approvedApply(harness, prepared, sourceText);
    harness.state.runtimeError = testError("ENGINEERING_NATIVE_APPLY_FAILED");
    harness.state.reconciliationOutcome = "prepared";

    await expect(harness.bundle.session.apply(approved)).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_NATIVE_APPLY_FAILED" }
    });

    expect(harness.reconciliationCalls).toEqual([
      {
        authorizationId: "auth_01",
        transactionId: "transaction_01",
        contentRootBindingId: ROOT_BINDING_ID
      }
    ]);
    expect((await onlyRecord(harness)).status).toBe("proposed");
    expect(harness.consumeCalls).toHaveLength(0);
  });

  test("fails closed when failed-reservation reconciliation cannot establish durable ownership", async () => {
    const sourceText = "const value = OLD;\n";
    const snapshot = presentSnapshot(encodeText(sourceText, false));
    const harness = createHarness(snapshot);
    const prepared = expectOk(
      await harness.bundle.session.prepare(
        replaceInput(
          issueFileRef(harness, snapshot),
          "reconciliation_failure_call",
          checksum("reconciliation-failure-payload"),
          14,
          17,
          "NEW"
        )
      )
    );
    const approved = await approvedApply(harness, prepared, sourceText);
    harness.state.runtimeError = testError("ENGINEERING_WAL_PREPARE_FAILED");
    harness.state.reconciliationError = testError("ENGINEERING_WAL_READ_FAILED");

    await expect(harness.bundle.session.apply(approved)).resolves.toMatchObject({
      ok: false,
      error: {
        code: "ENGINEERING_FILE_MUTATION_V2_RESERVATION_RECONCILIATION_REQUIRED",
        redactedDetail: {
          diskCommitted: false,
          recoveryRequired: true,
          failedFinalization: "reconcile_authorization_reservation",
          causeCode: "ENGINEERING_WAL_READ_FAILED"
        }
      }
    });

    expect(harness.reconciliationCalls).toHaveLength(1);
    expect((await onlyRecord(harness)).status).toBe("proposed");
    expect(harness.consumeCalls).toHaveLength(0);
  });

  test("reports post-commit proposal and ledger finalization failures as recovery-required", async () => {
    const sourceText = "const value = OLD;\n";
    const snapshot = presentSnapshot(encodeText(sourceText, false));

    const markHarness = createHarness(snapshot);
    const markPrepared = expectOk(
      await markHarness.bundle.session.prepare(
        replaceInput(
          issueFileRef(markHarness, snapshot),
          "mark_failure_call",
          checksum("mark-failure-payload"),
          14,
          17,
          "NEW"
        )
      )
    );
    const markApproved = await approvedApply(markHarness, markPrepared, sourceText);
    markHarness.state.markAppliedError = testError("PROPOSAL_MARK_FAILED");

    await expect(markHarness.bundle.session.apply(markApproved)).resolves.toMatchObject({
      ok: false,
      error: {
        code: "ENGINEERING_FILE_MUTATION_V2_POST_COMMIT_RECOVERY_REQUIRED",
        redactedDetail: {
          diskCommitted: true,
          recoveryRequired: true,
          failedFinalization: "mark_applied",
          causeCode: "PROPOSAL_MARK_FAILED"
        }
      }
    });
    expect(markHarness.runtimeInputs).toHaveLength(1);
    expect(markHarness.consumeCalls).toHaveLength(0);
    expect((await onlyRecord(markHarness)).status).toBe("proposed");

    const consumeHarness = createHarness(snapshot);
    const consumePrepared = expectOk(
      await consumeHarness.bundle.session.prepare(
        replaceInput(
          issueFileRef(consumeHarness, snapshot),
          "consume_failure_call",
          checksum("consume-failure-payload"),
          14,
          17,
          "NEW"
        )
      )
    );
    const consumeApproved = await approvedApply(consumeHarness, consumePrepared, sourceText);
    consumeHarness.state.consumeError = testError("LEDGER_CONSUME_FAILED");

    await expect(consumeHarness.bundle.session.apply(consumeApproved)).resolves.toMatchObject({
      ok: false,
      error: {
        code: "ENGINEERING_FILE_MUTATION_V2_POST_COMMIT_RECOVERY_REQUIRED",
        redactedDetail: {
          diskCommitted: true,
          recoveryRequired: true,
          failedFinalization: "consume_authorization",
          causeCode: "LEDGER_CONSUME_FAILED"
        }
      }
    });
    expect(consumeHarness.runtimeInputs).toHaveLength(1);
    expect(consumeHarness.consumeCalls).toEqual([
      { authorizationId: "auth_01", transactionId: "transaction_01" }
    ]);
    expect((await onlyRecord(consumeHarness)).status).toBe("applied");
  });
});

interface HarnessState {
  snapshot: EngineeringFileMutationProposalSnapshotV2;
  absenceResult?: Result<ReturnType<typeof createEngineeringAbsenceProofV2>, UnifiedError>;
  proof?: MainOnlyApprovalDecisionProofV1;
  binding?: ApprovalBindingV2;
  ledgerResult?: Result<never, UnifiedError>;
  markAppliedError?: UnifiedError;
  consumeError?: UnifiedError;
  runtimeError?: UnifiedError;
  runtimeThrows?: boolean;
  reconciliationOutcome?: "revoked" | "prepared";
  reconciliationError?: UnifiedError;
  beforeRuntimeRevalidate?: () => void;
}

interface Harness {
  readonly bundle: ReturnType<typeof createDesktopEngineeringFileMutationSessionV2>;
  readonly blobStore: InMemoryEngineeringMutationBlobStoreV2;
  readonly proposalRepository: InMemoryEngineeringMutationProposalRepositoryV2;
  readonly state: HarnessState;
  readonly snapshotCalls: unknown[];
  readonly absenceCalls: Array<{ readonly relativeIdentity: string; readonly observedAt: string }>;
  readonly ledgerCalls: Array<{
    readonly authorizationId: string;
    readonly transactionId?: string;
  }>;
  readonly consumeCalls: Array<{
    readonly authorizationId: string;
    readonly transactionId: string;
  }>;
  readonly reconciliationCalls: Array<{
    readonly authorizationId: string;
    readonly transactionId: string;
    readonly contentRootBindingId: string;
  }>;
  readonly runtimeInputs: unknown[];
  readonly proofReads: { value: number };
}

function createHarness(
  snapshot: EngineeringFileMutationProposalSnapshotV2,
  input: Pick<
    DesktopEngineeringFileMutationSessionV2Options,
    "resolveLifecycleRecoveryBinding"
  > = {}
): Harness {
  const blobStore = new InMemoryEngineeringMutationBlobStoreV2();
  const state: HarnessState = { snapshot };
  const proposalRepository = new InMemoryEngineeringMutationProposalRepositoryV2({
    now: () => NOW
  });
  const markApplied = proposalRepository.markApplied.bind(proposalRepository);
  proposalRepository.markApplied = async (proposalId) =>
    state.markAppliedError === undefined ? markApplied(proposalId) : err(state.markAppliedError);
  const snapshotCalls: unknown[] = [];
  const absenceCalls: Array<{ readonly relativeIdentity: string; readonly observedAt: string }> =
    [];
  const ledgerCalls: Array<{ readonly authorizationId: string; readonly transactionId?: string }> =
    [];
  const consumeCalls: Array<{ readonly authorizationId: string; readonly transactionId: string }> =
    [];
  const reconciliationCalls: Array<{
    readonly authorizationId: string;
    readonly transactionId: string;
    readonly contentRootBindingId: string;
  }> = [];
  const runtimeInputs: unknown[] = [];
  const proofReads = { value: 0 };
  let proposalApproval: EngineeringMutationProposalApprovalPortV2 | undefined;

  const proposalPort: EngineeringFileMutationProposalPortV2 = {
    async inspectProposalSnapshot(input) {
      snapshotCalls.push(input);
      return ok(state.snapshot);
    },
    async observeCreateAbsence(input) {
      const value = input as { readonly relativeIdentity: string; readonly observedAt: string };
      absenceCalls.push(value);
      if (state.absenceResult !== undefined) return state.absenceResult;
      return ok(
        createEngineeringAbsenceProofV2({
          rootBindingId: ROOT_BINDING_ID,
          relativeIdentity: value.relativeIdentity,
          parentDirectoryIdentity: "directory_01",
          observedAt: value.observedAt
        })
      );
    }
  };

  const authorizationLedger: EngineeringApprovalLedgerV2Port & {
    consume(authorizationId: string, transactionId: string): Promise<Result<unknown, UnifiedError>>;
  } = {
    async query(authorizationId, transactionId) {
      ledgerCalls.push({ authorizationId, transactionId });
      if (state.ledgerResult !== undefined) return state.ledgerResult;
      if (state.binding === undefined) return err(testError("LEDGER_BINDING_MISSING"));
      return ok({
        schemaVersion: "2.0" as const,
        authorizationId,
        binding: state.binding,
        providerSemanticVersionSetChecksum: state.binding.providerSemanticVersionSetChecksum,
        state: "reserved" as const,
        issuedAt: state.binding.issuedAt,
        expiresAt: state.binding.expiresAt,
        reservedTransactionId: transactionId,
        reservedAt: NOW,
        reserveWalId: "wal_01"
      });
    },
    async consume(authorizationId, transactionId) {
      ledgerCalls.push({ authorizationId, transactionId });
      consumeCalls.push({ authorizationId, transactionId });
      if (state.consumeError !== undefined) return err(state.consumeError);
      return ok(undefined);
    }
  };

  const runtime: EngineeringMutationRuntimeV2 = {
    async apply(input: unknown): Promise<Result<EngineeringMutationRuntimeResultV2, UnifiedError>> {
      runtimeInputs.push(input);
      state.beforeRuntimeRevalidate?.();
      if (proposalApproval === undefined) return err(testError("REVALIDATION_MISSING"));
      const revalidated = await proposalApproval.revalidate(
        input as EngineeringMutationRuntimeApplyRequestV2
      );
      if (!revalidated.ok) return revalidated;
      if (state.runtimeThrows) throw new Error("ENGINEERING_WAL_PREPARE_FAILED");
      if (state.runtimeError !== undefined) return err(state.runtimeError);
      return ok({
        schemaVersion: "2.0",
        status: "committed",
        contentRootBindingId: revalidated.value.contentRootBindingId,
        transactionId: revalidated.value.transactionId
      });
    }
  };

  const bundle = createDesktopEngineeringFileMutationSessionV2({
    projectId: "project_01",
    workspaceBindingId: WORKSPACE_BINDING_ID,
    contentRootBindingId: ROOT_BINDING_ID,
    pathPolicyRevision: PATH_POLICY_REVISION,
    refCapabilityRevision: REF_CAPABILITY_REVISION,
    proposalPort,
    blobStore,
    proposalRepository,
    authorizationLedger,
    async reconcileFailedAuthorizationReservation(input) {
      reconciliationCalls.push(input);
      if (state.reconciliationError !== undefined) return err(state.reconciliationError);
      return ok(state.reconciliationOutcome ?? "revoked");
    },
    trustedApprovalQualified: () => true,
    async readApprovalDecisionProof() {
      proofReads.value += 1;
      return ok(state.proof);
    },
    createRuntime(approval) {
      proposalApproval = approval;
      return runtime;
    },
    ...(input.resolveLifecycleRecoveryBinding === undefined
      ? {}
      : { resolveLifecycleRecoveryBinding: input.resolveLifecycleRecoveryBinding }),
    now: () => NOW,
    randomId: (() => {
      let next = 0;
      return () => `id_${++next}`;
    })()
  });

  return {
    bundle,
    blobStore,
    proposalRepository,
    state,
    snapshotCalls,
    absenceCalls,
    ledgerCalls,
    consumeCalls,
    reconciliationCalls,
    runtimeInputs,
    proofReads
  };
}

function presentSnapshot(
  bytes: Uint8Array,
  relativeIdentity = "src/file.ts"
): EngineeringFileMutationProposalSnapshotV2 {
  const manifest = createEngineeringRawByteManifestV2({
    identity: {
      kind: "observed_file",
      rootBindingId: ROOT_BINDING_ID,
      relativeIdentity,
      fileIdentity: "file_01"
    },
    bytes,
    metadataChecksum: checksum("metadata_01")
  });
  return {
    schemaVersion: "2.0",
    kind: "engineering_file_mutation_target_snapshot",
    rootBindingId: ROOT_BINDING_ID,
    relativeIdentity,
    parentDirectoryIdentity: "directory_01",
    state: "present",
    bytes,
    manifest
  };
}

function issueFileRef(
  harness: Harness,
  snapshot: EngineeringFileMutationProposalSnapshotV2
): string {
  if (snapshot.state !== "present") throw new Error("expected a present source snapshot");
  const issued = harness.bundle.refRegistry.issue({
    kind: "file",
    rootBindingId: ROOT_BINDING_ID,
    pathPolicyRevision: PATH_POLICY_REVISION,
    relativeIdentity: snapshot.relativeIdentity,
    sourceNativeRefChecksum: textSnapshotRefChecksum(snapshot),
    issuedCapabilityRevision: REF_CAPABILITY_REVISION
  });
  if (issued === undefined) throw new Error("file ref issuance failed");
  return issued.opaqueRef;
}

function issueDirectoryRef(harness: Harness, relativeIdentity: string): string {
  const issued = harness.bundle.refRegistry.issue({
    kind: "directory",
    rootBindingId: ROOT_BINDING_ID,
    pathPolicyRevision: PATH_POLICY_REVISION,
    relativeIdentity,
    sourceNativeRefChecksum: checksum(`directory:${relativeIdentity}`),
    issuedCapabilityRevision: REF_CAPABILITY_REVISION
  });
  if (issued === undefined) throw new Error("directory ref issuance failed");
  return issued.opaqueRef;
}

function replaceInput(
  fileRef: string,
  toolCallId: string,
  canonicalPayloadChecksum: string,
  start: number,
  end: number,
  replacement: string
): Parameters<EngineeringFileMutationSessionV2["prepare"]>[0] {
  return {
    runId: "run_01",
    projectId: "project_01",
    toolCallId,
    toolName: "propose_file_write",
    arguments: { fileRef, range: { unit: "character", start, end }, replacement },
    canonicalPayloadChecksum,
    writePolicy: "write_before_confirmation",
    boundary: proposalBoundary()
  };
}

async function onlyRecord(harness: Harness) {
  const scan = expectOk(await harness.proposalRepository.scan());
  const [record] = scan.proposals;
  if (record === undefined) throw new Error("expected a proposal record");
  return record;
}

async function changeSetFor(
  prepared: EngineeringPreparedFileMutationProposalV2,
  baseContent: string
): Promise<ChangeSetV2> {
  if (prepared.changeSetMutation.kind !== "replace_file") {
    throw new Error("expected a replace change-set mutation");
  }
  return createChangeSetRevisionV2(
    {
      changeSetId: `changes_${prepared.toolCallId}`,
      runId: "run_01",
      projectId: "project_01",
      checkpointId: "checkpoint_01",
      contextSnapshotId: "context_01",
      writePolicy: "write_before_confirmation",
      createdAt: NOW,
      providerSemanticVersionSetChecksum: PROVIDER_VERSION_SET_CHECKSUM,
      proposal: {
        relativePath: prepared.relativeIdentity,
        assetType: "text",
        baseContent,
        baseChecksum: checksumChangeSetText(baseContent),
        range: prepared.changeSetMutation.range,
        replacement: prepared.changeSetMutation.replacement
      }
    },
    { createHunkId: () => "hunk_01" }
  );
}

async function approvedApply(
  harness: Harness,
  prepared: EngineeringPreparedFileMutationProposalV2,
  baseContent: string
): Promise<{
  readonly changeSet: ChangeSetV2;
  readonly approval: ChangeSetApprovalV2;
  readonly proofInput: Awaited<
    ReturnType<EngineeringFileMutationSessionV2["prepareApprovalProofInput"]>
  > extends Result<infer Value, UnifiedError>
    ? Value
    : never;
}> {
  const changeSet = await changeSetFor(prepared, baseContent);
  expectOk(await harness.bundle.session.bindChangeSet({ prepared, changeSet }));
  const request = approvalProofRequest(changeSet);
  const proofInput = expectOk(await harness.bundle.session.prepareApprovalProofInput(request));
  const proof = approvalProof(changeSet, proofInput);
  harness.state.proof = proof;
  const facts = expectOk(
    await harness.bundle.session.finalizeApprovalFacts({
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
      expiresAt: EXPIRES_AT
    })
  );
  const binding = createApprovalBindingV2(seed);
  authorizeApprovalBindingV2(binding, createMainApprovalIssuer());
  harness.state.binding = binding;
  const approval = expectOk(
    decideChangeSetApprovalV2({
      changeSet,
      decision: "apply_selected",
      displayBindingChecksum: changeSet.displayBindingChecksum,
      binding,
      authorizationId: "auth_01",
      reservationTransactionId: "transaction_01",
      trustedConfirmationQualified: true,
      resolvedAt: NOW,
      now: Date.parse(NOW)
    })
  );
  return { changeSet, approval, proofInput };
}

function approvalProofRequest(changeSet: ChangeSetV2) {
  return {
    changeSet,
    boundary: capabilityBoundary(),
    workspaceBindingId: WORKSPACE_BINDING_ID,
    approvalRuleSet: {
      version: LEGACY_ALL_HUMAN_APPROVAL_RULE_SET_VERSION,
      checksum: LEGACY_ALL_HUMAN_APPROVAL_RULE_SET_CHECKSUM,
      catalogRevision: CAPABILITY_REVISION
    }
  };
}

function approvalProof(
  changeSet: ChangeSetV2,
  proofInput: {
    readonly operationKind: "replace_file" | "create_file";
    readonly rootBindingId: string;
    readonly selectionChecksum: string;
    readonly proposalPayloadChecksum: string;
    readonly baseManifestChecksum: string;
    readonly candidateManifestChecksum: string;
    readonly evidence: MainOnlyApprovalDecisionProofV1["evidence"];
  },
  overrides: Partial<
    Pick<
      MainOnlyApprovalDecisionProofV1["binding"],
      "baseManifestChecksum" | "candidateManifestChecksum"
    >
  > = {}
): MainOnlyApprovalDecisionProofV1 {
  return createMainOnlyApprovalDecisionProofV1({
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
      policyRevision: POLICY_REVISION,
      capabilityRevision: CAPABILITY_REVISION,
      ...overrides
    },
    evidence: proofInput.evidence
  });
}

function proposalBoundary() {
  return {
    workspaceBindingId: WORKSPACE_BINDING_ID,
    providerSemanticVersionSetChecksum: PROVIDER_VERSION_SET_CHECKSUM,
    policyRevision: POLICY_REVISION,
    capabilityRevision: CAPABILITY_REVISION,
    approvalRuleSetVersion: LEGACY_ALL_HUMAN_APPROVAL_RULE_SET_VERSION,
    approvalRuleSetChecksum: LEGACY_ALL_HUMAN_APPROVAL_RULE_SET_CHECKSUM
  };
}

function capabilityBoundary(): AgentRunCapabilityBoundary {
  return {
    canonicalRootIdentityChecksum: checksum("root"),
    effectiveCapabilityStateChecksum: checksum("effective-capability"),
    sharingDefaultsRevision: "sharing_defaults_01",
    sharingGrantRevision: "sharing_grant_01",
    policyRevision: POLICY_REVISION,
    providerToolProjectionChecksum: checksum("provider-tools"),
    providerSemanticVersionSetChecksum: PROVIDER_VERSION_SET_CHECKSUM
  };
}

function encodeText(text: string, bom: boolean): Uint8Array {
  const encoded = new TextEncoder().encode(text);
  if (!bom) return encoded;
  const bytes = new Uint8Array(encoded.byteLength + 3);
  bytes.set([0xef, 0xbb, 0xbf]);
  bytes.set(encoded, 3);
  return bytes;
}

function eolFor(text: string): "none" | "lf" | "crlf" | "mixed" {
  const hasCrLf = /\r\n/u.test(text);
  const remaining = text.replaceAll("\r\n", "");
  const hasLf = /\n/u.test(remaining);
  const hasCr = /\r/u.test(remaining);
  if (!hasCrLf && !hasLf && !hasCr) return "none";
  if (hasCr || (hasCrLf && hasLf)) return "mixed";
  return hasCrLf ? "crlf" : "lf";
}

function textSnapshotRefChecksum(
  snapshot: Extract<EngineeringFileMutationProposalSnapshotV2, { readonly state: "present" }>
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        kind: "text_snapshot",
        binding: { rootBindingId: ROOT_BINDING_ID, pathPolicyRevision: PATH_POLICY_REVISION },
        relativeIdentity: snapshot.relativeIdentity,
        byteLength: snapshot.manifest.byteLength,
        sha256: snapshot.manifest.sha256
      })
    )
    .digest("hex");
}

function checksum(value: string): string {
  return sha256EngineeringMutationTextV2(value);
}

function expectOk<T>(result: Result<T, UnifiedError>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

function testError(code: string): UnifiedError {
  return {
    schemaVersion: "1.0",
    errorId: `engineering-file-mutation-session-test-${code.toLowerCase()}`,
    code,
    category: "StorageError",
    message: code,
    recoverability: "user-action",
    suggestedAction: "Fix the test harness.",
    traceId: "engineering-file-mutation-session-v2-test"
  };
}
