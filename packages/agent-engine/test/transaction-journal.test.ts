import { describe, expect, test } from "vitest";

import {
  createApprovalBindingV2,
  createChapterStatusTransitionProof,
  createTransactionJournalV2,
  parseTransactionJournalV2,
  validateTransactionJournalV2,
  type CreateTransactionJournalV2Input
} from "../src/index.js";

const checksum = "a".repeat(64);

function input(): CreateTransactionJournalV2Input {
  const binding = createApprovalBindingV2({
    workspaceBindingId: "workspace_01",
    rootBindingId: "root_01",
    runId: "run_01",
    changeSetId: "changes_01",
    changeSetRevision: 1,
    changeSetChecksum: checksum,
    providerSemanticVersionSetChecksum: checksum,
    operationKind: "replace_file",
    selectionChecksum: checksum,
    selectedOperationIds: ["notes/one.md"],
    operationOrderChecksum: checksum,
    sourceRef: "file:notes/one.md",
    targetRef: "file:notes/one.md",
    baseChecksum: checksum,
    candidateChecksum: "b".repeat(64),
    baseManifestChecksum: checksum,
    candidateManifestChecksum: "b".repeat(64),
    encoding: "utf-8",
    bom: "absent",
    eol: "lf",
    approvalRuleSetVersion: "rules-2.0",
    approvalRuleSetChecksum: checksum,
    proofId: "proof_01",
    proofChecksum: checksum,
    executionWritePolicy: "write_before_confirmation",
    policyRevision: "policy_01",
    capabilityRevision: "capability_01",
    approvalSource: "human_confirmation",
    issuedAt: "2099-01-01T00:00:00.000Z",
    expiresAt: "2099-01-01T01:00:00.000Z"
  });
  return {
    kind: "apply",
    transactionId: "tx_01",
    versionGroupId: "vg_01",
    runId: "run_01",
    runSequence: 1,
    checkpointId: "checkpoint_01",
    changeSetId: "changes_01",
    changeSetRevision: 1,
    changeSetChecksum: checksum,
    writePolicy: "write_before_confirmation",
    approvalSource: "human_confirmation",
    authorizationId: "auth_01",
    reservationTransactionId: "tx_01",
    providerSemanticVersionSetChecksum: checksum,
    approvalBinding: binding,
    createdAt: "2099-01-01T00:00:00.000Z",
    entries: []
  };
}

describe("Transaction Journal 2.0", () => {
  test("writes a strict prepared reservation binding", () => {
    const journal = createTransactionJournalV2(input());
    expect(journal.schemaVersion).toBe("2.0");
    expect(journal).not.toHaveProperty("approvalToken");
    expect(parseTransactionJournalV2(journal)).toEqual(journal);
  });

  test("rejects a WAL whose transaction does not equal the reservation", () => {
    const journal = createTransactionJournalV2(input());
    const forged = { ...journal, reservationTransactionId: "tx_other" };
    expect(validateTransactionJournalV2(forged)).toMatchObject({ ok: false });
  });

  test("binds one authenticated chapter transition proof to its chapter write", () => {
    const proof = chapterTransitionProof();
    const journal = createTransactionJournalV2({
      ...input(),
      applyBatchId: "batch_01",
      consistencyGroupId: "chapter_status_01",
      selectionChecksum: checksum,
      entries: [journalEntry("chapters/ch_01.md", proof)],
      chapterStatusTransitionProof: proof
    });

    expect(parseTransactionJournalV2(journal).chapterStatusTransitionProof).toEqual(proof);
    expect(Object.isFrozen(journal.chapterStatusTransitionProof)).toBe(true);
    expect(Object.isFrozen(journal.entries[0]?.chapterStatusTransitionProof)).toBe(true);
  });

  test("rejects orphaned, ungrouped, or wrong-target chapter transition proofs", () => {
    const proof = chapterTransitionProof();
    const grouped = {
      ...input(),
      applyBatchId: "batch_01",
      consistencyGroupId: "chapter_status_01",
      selectionChecksum: checksum
    };

    expect(() =>
      createTransactionJournalV2({
        ...grouped,
        entries: [journalEntry("chapters/other.md", proof)],
        chapterStatusTransitionProof: proof
      })
    ).toThrow("Transaction Journal chapter transition proof binding is invalid.");
    expect(() =>
      createTransactionJournalV2({
        ...grouped,
        entries: [journalEntry("chapters/ch_01.md", proof)]
      })
    ).toThrow("Transaction Journal chapter transition proof binding is invalid.");
    expect(() =>
      createTransactionJournalV2({
        ...input(),
        entries: [journalEntry("chapters/ch_01.md", proof)],
        chapterStatusTransitionProof: proof
      })
    ).toThrow("Transaction Journal chapter transition proof binding is invalid.");
  });
});

function chapterTransitionProof() {
  return createChapterStatusTransitionProof({
    proofId: "proof_chapter_status_01",
    stableRef: "chapter:ch_01",
    chapterId: "ch_01",
    action: "delete",
    beforeStatus: "review",
    afterStatus: "deleted",
    restoreStatus: "review",
    beforeRevision: 3,
    afterRevision: 4,
    beforeChecksum: "b".repeat(64),
    afterChecksum: "c".repeat(64),
    outlineRevision: 5,
    outlineChecksum: "d".repeat(64),
    originalVolumeRef: "volume:volume_01",
    beforeNeighborRefs: { before: "chapter:ch_00", after: "chapter:ch_02" },
    afterNeighborRefs: { before: "chapter:ch_00", after: "chapter:ch_02" },
    referenceImpactChecksum: "e".repeat(64),
    createdAt: "2099-01-01T00:00:00.000Z"
  });
}

function journalEntry(relativePath: string, proof: ReturnType<typeof chapterTransitionProof>) {
  return {
    writeId: "write_chapter_status_01",
    relativePath,
    assetType: "chapter" as const,
    beforeChecksum: "f".repeat(64),
    candidateChecksum: "0".repeat(64),
    beforeContent: "before",
    candidateContent: "after",
    beforeVersionId: "ver_before_chapter_status_01",
    status: "pending" as const,
    chapterStatusTransitionProof: proof
  };
}
