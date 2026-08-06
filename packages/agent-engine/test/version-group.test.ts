import { describe, expect, test } from "vitest";

import {
  createAppliedVersionGroup,
  createFailedVersionGroup,
  type VersionGroupWrite
} from "../src/version-group.js";
import {
  createTransactionJournal,
  updateTransactionJournalEntry
} from "../src/transaction-journal.js";
import { checksumChangeSetText } from "../src/change-set.js";

const chapterCreateReceipt = {
  schemaVersion: "1.0",
  changeSetId: "changes_chapter_create",
  consistencyGroupId: `chapter-create-${"d".repeat(64)}`,
  operationId: "operation_chapter_create",
  chapterId: "ch_created",
  relativePath: "chapters/ch_created.md",
  catalogRevision: "d".repeat(64),
  order: 2,
  status: "draft",
  revision: 1,
  volumeId: "volume_01",
  persistedChecksum: "e".repeat(64),
  historyVersionId: null,
  inverse: {
    kind: "delete_file",
    relativePath: "chapters/ch_created.md",
    expectedChecksum: "e".repeat(64)
  }
} as const;

const writes = [
  {
    writeId: "write_01",
    relativePath: "chapters/one.md",
    assetType: "chapter",
    beforeChecksum: "a".repeat(64),
    afterChecksum: "b".repeat(64),
    beforeVersionId: "ver_before_one",
    status: "applied"
  }
] as const satisfies readonly VersionGroupWrite[];

describe("Version Group", () => {
  test("records an applied immutable group with undo metadata", () => {
    const group = createAppliedVersionGroup({
      versionGroupId: "vg_01",
      runId: "run_01",
      checkpointId: "checkpoint_01",
      changeSetId: "changes_01",
      changeSetRevision: 2,
      changeSetChecksum: "c".repeat(64),
      writePolicy: "user_preapproved_run",
      approvalSource: "user_preapproved_run",
      createdAt: "2026-07-13T01:00:00.000Z",
      writes,
      baselineByPath: {
        "chapters/one.md": {
          relativePath: "chapters/one.md",
          checksum: "a".repeat(64),
          beforeVersionId: "ver_before_one"
        }
      }
    });

    expect(group.transactionStatus).toBe("applied");
    expect(group.writePolicy).toBe("user_preapproved_run");
    expect(group.approvalSource).toBe("user_preapproved_run");
    expect(group.undoStatus).toBe("available");
    expect(group.undoMetadata).toEqual({
      runId: "run_01",
      versionGroupId: "vg_01",
      baselineVersionIds: { "chapters/one.md": "ver_before_one" },
      lastWriteChecksums: { "chapters/one.md": "b".repeat(64) }
    });
    expect(Object.isFrozen(group)).toBe(true);
    expect(Object.isFrozen(group.writes)).toBe(true);
    expect(Object.isFrozen(group.baselineByPath)).toBe(true);
  });

  test("reports partial failure as a failure kind and never as applied", () => {
    const group = createFailedVersionGroup({
      versionGroupId: "vg_partial",
      runId: "run_01",
      checkpointId: "checkpoint_01",
      changeSetId: "changes_01",
      changeSetRevision: 1,
      changeSetChecksum: "c".repeat(64),
      writePolicy: "write_before_confirmation",
      createdAt: "2026-07-13T01:00:00.000Z",
      transactionStatus: "partial_failure",
      failureKind: "partial_failure",
      writes: [
        {
          ...writes[0],
          status: "rollback_failed",
          errorCode: "AGENT_WRITE_ROLLBACK_FAILED"
        }
      ],
      baselineByPath: {
        "chapters/one.md": {
          relativePath: "chapters/one.md",
          checksum: "a".repeat(64),
          beforeVersionId: "ver_before_one"
        }
      }
    });

    expect(group.transactionStatus).not.toBe("applied");
    expect(group.failureKind).toBe("partial_failure");
    expect(group.undoStatus).toBe("partial_failure");
  });

  test("retains and deep-freezes a chapter create receipt", () => {
    const group = createAppliedVersionGroup({
      versionGroupId: "vg_chapter_create",
      runId: "run_01",
      checkpointId: "checkpoint_01",
      changeSetId: "changes_chapter_create",
      changeSetRevision: 1,
      changeSetChecksum: "c".repeat(64),
      createdAt: "2026-08-06T01:00:00.000Z",
      writes: [],
      baselineByPath: {},
      chapterCreateReceipt
    });

    expect(group.chapterCreateReceipt).toEqual(chapterCreateReceipt);
    expect(Object.isFrozen(group.chapterCreateReceipt)).toBe(true);
    expect(Object.isFrozen(group.chapterCreateReceipt?.inverse)).toBe(true);
  });
});

describe("Transaction Journal", () => {
  test("updates entries immutably and retains compensation content", () => {
    const journal = createTransactionJournal({
      transactionId: "tx_01",
      versionGroupId: "vg_01",
      kind: "apply",
      runId: "run_01",
      runSequence: 1,
      checkpointId: "checkpoint_01",
      changeSetId: "changes_01",
      changeSetRevision: 1,
      changeSetChecksum: "c".repeat(64),
      writePolicy: "write_before_confirmation",
      approvalSource: "human_confirmation",
      approvalToken: checksumChangeSetText(`changes_01:1:${"c".repeat(64)}`),
      createdAt: "2026-07-13T01:00:00.000Z",
      entries: [
        {
          writeId: "write_01",
          relativePath: "notes/outline.md",
          assetType: "text",
          beforeChecksum: "a".repeat(64),
          candidateChecksum: "b".repeat(64),
          beforeContent: "before",
          candidateContent: "after",
          beforeVersionId: "ver_before",
          status: "pending"
        }
      ]
    });

    const applied = updateTransactionJournalEntry(journal, "notes/outline.md", {
      status: "applied"
    });

    expect(journal.entries[0]?.status).toBe("pending");
    expect(journal.writePolicy).toBe("write_before_confirmation");
    expect(journal.approvalSource).toBe("human_confirmation");
    expect(applied.entries[0]).toMatchObject({
      status: "applied",
      beforeContent: "before",
      candidateContent: "after"
    });
    expect(applied.transactionStatus).toBe("applying");
    expect(Object.isFrozen(applied.entries)).toBe(true);
  });

  test("retains a preapproved-run source in an apply journal", () => {
    const journal = createTransactionJournal({
      transactionId: "tx_auto",
      versionGroupId: "vg_auto",
      kind: "apply",
      runId: "run_auto",
      runSequence: 1,
      checkpointId: "checkpoint_auto",
      changeSetId: "changes_auto",
      changeSetRevision: 1,
      changeSetChecksum: "d".repeat(64),
      writePolicy: "user_preapproved_run",
      approvalSource: "user_preapproved_run",
      approvalToken: checksumChangeSetText(`changes_auto:1:${"d".repeat(64)}`),
      createdAt: "2026-07-13T01:00:00.000Z",
      entries: []
    });

    expect(journal.writePolicy).toBe("user_preapproved_run");
    expect(journal.approvalSource).toBe("user_preapproved_run");
  });

  test("retains and deep-freezes a chapter create receipt", () => {
    const journal = createTransactionJournal({
      transactionId: "tx_chapter_create",
      versionGroupId: "vg_chapter_create",
      kind: "apply",
      runId: "run_01",
      runSequence: 1,
      checkpointId: "checkpoint_01",
      changeSetId: "changes_chapter_create",
      changeSetRevision: 1,
      changeSetChecksum: "c".repeat(64),
      writePolicy: "write_before_confirmation",
      approvalSource: "human_confirmation",
      approvalToken: checksumChangeSetText(`changes_chapter_create:1:${"c".repeat(64)}`),
      createdAt: "2026-08-06T01:00:00.000Z",
      entries: [],
      chapterCreateReceipt
    });

    expect(journal.chapterCreateReceipt).toEqual(chapterCreateReceipt);
    expect(Object.isFrozen(journal.chapterCreateReceipt)).toBe(true);
    expect(Object.isFrozen(journal.chapterCreateReceipt?.inverse)).toBe(true);
  });
});
