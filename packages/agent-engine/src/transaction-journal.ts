import type { VersionGroupAssetType } from "./version-group.js";

export type TransactionJournalKind = "apply" | "version_group_undo" | "run_undo";
export type TransactionJournalStatus =
  "prepared" | "applying" | "compensating" | "applied" | "rolled_back" | "partial_failure";
export type TransactionJournalEntryStatus =
  "pending" | "applied" | "rolled_back" | "rollback_failed";

export interface TransactionJournalEntry {
  readonly writeId: string;
  readonly relativePath: string;
  readonly assetType: VersionGroupAssetType;
  readonly beforeChecksum: string;
  readonly candidateChecksum: string;
  readonly beforeContent: string;
  readonly candidateContent: string;
  readonly beforeVersionId: string;
  readonly status: TransactionJournalEntryStatus;
  readonly errorCode?: string;
}

export interface TransactionJournal {
  readonly schemaVersion: "1.0";
  readonly transactionId: string;
  readonly versionGroupId: string;
  readonly kind: TransactionJournalKind;
  readonly runId: string;
  readonly runSequence: number;
  readonly checkpointId: string;
  readonly changeSetId: string;
  readonly changeSetRevision: number;
  readonly changeSetChecksum: string;
  readonly approvalSource?: "human_confirmation";
  readonly approvalToken?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly transactionStatus: TransactionJournalStatus;
  readonly entries: readonly TransactionJournalEntry[];
  readonly undoOfVersionGroupIds?: readonly string[];
}

type TransactionJournalCreateBase = Omit<
  TransactionJournal,
  "schemaVersion" | "updatedAt" | "transactionStatus" | "kind" | "approvalSource" | "approvalToken"
>;

export type CreateTransactionJournalInput =
  | (TransactionJournalCreateBase & {
      readonly kind: "apply";
      readonly approvalSource: "human_confirmation";
      readonly approvalToken: string;
    })
  | (TransactionJournalCreateBase & {
      readonly kind: Exclude<TransactionJournalKind, "apply">;
      readonly approvalSource?: never;
      readonly approvalToken?: never;
    });

export function createTransactionJournal(input: CreateTransactionJournalInput): TransactionJournal {
  return freezeJournal({
    schemaVersion: "1.0",
    ...input,
    updatedAt: input.createdAt,
    transactionStatus: "prepared"
  });
}

export function updateTransactionJournalEntry(
  journal: TransactionJournal,
  relativePath: string,
  update: Pick<TransactionJournalEntry, "status"> & { readonly errorCode?: string },
  updatedAt = journal.updatedAt
): TransactionJournal {
  const entries = journal.entries.map((entry) =>
    entry.relativePath === relativePath
      ? {
          ...entry,
          status: update.status,
          ...(update.errorCode === undefined ? {} : { errorCode: update.errorCode })
        }
      : entry
  );
  return freezeJournal({
    ...journal,
    entries,
    updatedAt,
    transactionStatus: update.status === "rollback_failed" ? "partial_failure" : "applying"
  });
}

export function setTransactionJournalStatus(
  journal: TransactionJournal,
  transactionStatus: TransactionJournalStatus,
  updatedAt = journal.updatedAt
): TransactionJournal {
  return freezeJournal({ ...journal, transactionStatus, updatedAt });
}

function freezeJournal(journal: TransactionJournal): TransactionJournal {
  return Object.freeze({
    ...journal,
    entries: Object.freeze(journal.entries.map((entry) => Object.freeze({ ...entry }))),
    ...(journal.undoOfVersionGroupIds === undefined
      ? {}
      : { undoOfVersionGroupIds: Object.freeze([...journal.undoOfVersionGroupIds]) })
  });
}
