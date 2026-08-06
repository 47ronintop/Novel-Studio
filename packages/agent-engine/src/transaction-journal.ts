import type { AgentWritePolicy } from "./agent-run-types.js";
import type {
  ChapterCreateApplyReceipt,
  StoryBibleApplyReceipt,
  VersionGroupAssetType
} from "./version-group.js";
import {
  parseApprovalBindingV2,
  validateApprovalBindingV2,
  type ApprovalBindingV2
} from "./approval-binding-v2.js";
import {
  isChapterStatusTransitionProof,
  parseChapterStatusTransitionProof,
  type ChapterStatusTransitionProof
} from "./chapter-status-transition-proof.js";

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
  readonly chapterStatusTransitionProof?: ChapterStatusTransitionProof;
}

export interface TransactionJournal {
  readonly schemaVersion: "1.0" | "1.1" | "2.0";
  readonly transactionId: string;
  readonly versionGroupId: string;
  readonly kind: TransactionJournalKind;
  readonly runId: string;
  readonly runSequence: number;
  readonly checkpointId: string;
  readonly changeSetId: string;
  readonly changeSetRevision: number;
  readonly changeSetChecksum: string;
  readonly writePolicy?: AgentWritePolicy;
  readonly approvalSource?:
    "human_confirmation" | "user_preapproved_run" | "project_safe_auto_update";
  readonly approvalToken?: string;
  readonly authorizationId?: string;
  readonly reservationTransactionId?: string;
  readonly providerSemanticVersionSetChecksum?: string;
  readonly approvalBinding?: ApprovalBindingV2;
  readonly applyBatchId?: string;
  readonly consistencyGroupId?: string;
  readonly selectionChecksum?: string;
  readonly storyBibleReceipt?: StoryBibleApplyReceipt;
  readonly chapterCreateReceipt?: ChapterCreateApplyReceipt;
  readonly chapterStatusTransitionProof?: ChapterStatusTransitionProof;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly transactionStatus: TransactionJournalStatus;
  readonly entries: readonly TransactionJournalEntry[];
  readonly undoOfVersionGroupIds?: readonly string[];
}

export type TransactionJournalV2 = Omit<
  TransactionJournal,
  | "schemaVersion"
  | "approvalToken"
  | "authorizationId"
  | "reservationTransactionId"
  | "providerSemanticVersionSetChecksum"
  | "approvalBinding"
> & {
  readonly schemaVersion: "2.0";
  readonly authorizationId: string;
  readonly reservationTransactionId: string;
  readonly providerSemanticVersionSetChecksum: string;
  readonly approvalBinding: ApprovalBindingV2;
  readonly approvalToken?: never;
};

export interface CreateTransactionJournalV2Input extends Omit<
  CreateTransactionJournalInput,
  "schemaVersion" | "approvalToken"
> {
  readonly authorizationId: string;
  readonly reservationTransactionId: string;
  readonly providerSemanticVersionSetChecksum: string;
  readonly approvalBinding: ApprovalBindingV2;
}

type TransactionJournalCreateBase = Omit<
  TransactionJournal,
  | "schemaVersion"
  | "updatedAt"
  | "transactionStatus"
  | "kind"
  | "writePolicy"
  | "approvalSource"
  | "approvalToken"
>;

export type CreateTransactionJournalInput =
  | (TransactionJournalCreateBase & {
      readonly kind: "apply";
      readonly writePolicy: AgentWritePolicy;
      readonly approvalSource:
        "human_confirmation" | "user_preapproved_run" | "project_safe_auto_update";
      readonly approvalToken: string;
    })
  | (TransactionJournalCreateBase & {
      readonly kind: Exclude<TransactionJournalKind, "apply">;
      readonly writePolicy?: never;
      readonly approvalSource?: never;
      readonly approvalToken?: never;
    });

export function createTransactionJournal(input: CreateTransactionJournalInput): TransactionJournal {
  return freezeJournal({
    schemaVersion:
      input.applyBatchId === undefined || input.consistencyGroupId === undefined ? "1.0" : "1.1",
    ...input,
    updatedAt: input.createdAt,
    transactionStatus: "prepared"
  });
}

export function createTransactionJournalV2(
  input: CreateTransactionJournalV2Input
): TransactionJournalV2 {
  if (input.kind !== "apply")
    throw new Error("Transaction Journal 2.0 requires an apply reservation.");
  const binding = parseApprovalBindingV2(input.approvalBinding);
  if (
    binding.providerSemanticVersionSetChecksum !== input.providerSemanticVersionSetChecksum ||
    binding.runId !== input.runId ||
    binding.changeSetId !== input.changeSetId ||
    binding.changeSetRevision !== input.changeSetRevision ||
    binding.changeSetChecksum !== input.changeSetChecksum
  ) {
    throw new Error("Transaction Journal 2.0 reservation binding mismatch.");
  }
  const journal = {
    schemaVersion: "2.0" as const,
    ...input,
    approvalBinding: binding,
    updatedAt: input.createdAt,
    transactionStatus: "prepared" as const
  } as TransactionJournalV2;
  return freezeJournal(journal) as TransactionJournalV2;
}

export function parseTransactionJournalV2(value: unknown): TransactionJournalV2 {
  const validation = validateTransactionJournalV2(value);
  if (!validation.ok) throw new Error(validation.error.message);
  return freezeJournal(value as TransactionJournalV2) as TransactionJournalV2;
}

export function validateTransactionJournalV2(
  value: unknown
):
  | { readonly ok: true; readonly value: TransactionJournalV2 }
  | { readonly ok: false; readonly error: Error } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: new Error("Transaction Journal 2.0 must be an object.") };
  }
  const record = value as Record<string, unknown>;
  if (record["schemaVersion"] !== "2.0" || "approvalToken" in record) {
    return {
      ok: false,
      error: new Error("Legacy transaction journal cannot enter the v2 recovery path.")
    };
  }
  if (
    typeof record["authorizationId"] !== "string" ||
    typeof record["reservationTransactionId"] !== "string" ||
    typeof record["providerSemanticVersionSetChecksum"] !== "string"
  ) {
    return {
      ok: false,
      error: new Error("Transaction Journal 2.0 is missing its reservation binding.")
    };
  }
  // A prepared journal already references a reservation. Its binding may
  // expire while recovery is paused; issue/reserve paths enforce expiry.
  const binding = validateApprovalBindingV2(record["approvalBinding"], Date.now(), {
    allowExpired: true
  });
  if (
    !binding.ok ||
    binding.value.providerSemanticVersionSetChecksum !==
      record["providerSemanticVersionSetChecksum"] ||
    binding.value.runId !== record["runId"] ||
    binding.value.changeSetId !== record["changeSetId"] ||
    binding.value.changeSetRevision !== record["changeSetRevision"] ||
    binding.value.changeSetChecksum !== record["changeSetChecksum"]
  ) {
    return { ok: false, error: new Error("Transaction Journal 2.0 approval binding mismatch.") };
  }
  if (
    typeof record["transactionId"] !== "string" ||
    record["transactionId"] !== record["reservationTransactionId"]
  ) {
    return {
      ok: false,
      error: new Error("Prepared WAL must name the same reservation transaction.")
    };
  }
  if (!hasValidChapterStatusTransitionProof(record)) {
    return {
      ok: false,
      error: new Error("Transaction Journal 2.0 chapter transition proof is invalid.")
    };
  }
  return { ok: true, value: value as TransactionJournalV2 };
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
  if (!hasValidChapterStatusTransitionProof(journal as unknown as Record<string, unknown>)) {
    throw new Error("Transaction Journal chapter transition proof binding is invalid.");
  }
  return Object.freeze({
    ...journal,
    entries: Object.freeze(
      journal.entries.map((entry) =>
        Object.freeze({
          ...entry,
          ...(entry.chapterStatusTransitionProof === undefined
            ? {}
            : {
                chapterStatusTransitionProof: parseChapterStatusTransitionProof(
                  entry.chapterStatusTransitionProof
                )
              })
        })
      )
    ),
    ...(journal.undoOfVersionGroupIds === undefined
      ? {}
      : { undoOfVersionGroupIds: Object.freeze([...journal.undoOfVersionGroupIds]) }),
    ...(journal.storyBibleReceipt === undefined
      ? {}
      : {
          storyBibleReceipt: Object.freeze({
            ...journal.storyBibleReceipt,
            suggestionIds: Object.freeze([...journal.storyBibleReceipt.suggestionIds]),
            assets: Object.freeze(
              journal.storyBibleReceipt.assets.map((asset) =>
                Object.freeze({
                  ...asset,
                  ...(asset.legacyMigration === undefined
                    ? {}
                    : { legacyMigration: Object.freeze({ ...asset.legacyMigration }) }),
                  inversePatch: Object.freeze(
                    asset.inversePatch.map((operation) => Object.freeze({ ...operation }))
                  )
                })
              )
            )
          })
        }),
    ...(journal.chapterCreateReceipt === undefined
      ? {}
      : {
          chapterCreateReceipt: Object.freeze({
            ...journal.chapterCreateReceipt,
            inverse: Object.freeze({ ...journal.chapterCreateReceipt.inverse })
          })
        }),
    ...(journal.chapterStatusTransitionProof === undefined
      ? {}
      : {
          chapterStatusTransitionProof: parseChapterStatusTransitionProof(
            journal.chapterStatusTransitionProof
          )
        }),
    ...(journal.approvalBinding === undefined
      ? {}
      : {
          approvalBinding: Object.freeze({
            ...journal.approvalBinding,
            selectedOperationIds: Object.freeze([...journal.approvalBinding.selectedOperationIds])
          })
        })
  });
}

function hasValidChapterStatusTransitionProof(record: Record<string, unknown>): boolean {
  const proof = record["chapterStatusTransitionProof"];
  const entries = record["entries"];
  if (!Array.isArray(entries)) return false;
  const proofEntries = entries.filter(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      !Array.isArray(entry) &&
      (entry as Record<string, unknown>)["chapterStatusTransitionProof"] !== undefined
  );
  if (proof === undefined) return proofEntries.length === 0;
  if (!isChapterStatusTransitionProof(proof)) return false;
  const entry = proofEntries[0] as Record<string, unknown> | undefined;
  const entryProof = entry?.["chapterStatusTransitionProof"];
  return (
    record["kind"] === "apply" &&
    (record["schemaVersion"] === "1.1" || record["schemaVersion"] === "2.0") &&
    record["approvalSource"] === "human_confirmation" &&
    isNonEmptyString(record["applyBatchId"]) &&
    isNonEmptyString(record["consistencyGroupId"]) &&
    typeof record["selectionChecksum"] === "string" &&
    /^[a-f0-9]{64}$/u.test(record["selectionChecksum"] as string) &&
    proof.stableRef === `chapter:${proof.chapterId}` &&
    proofEntries.length === 1 &&
    entry !== undefined &&
    entry["assetType"] === "chapter" &&
    entry["relativePath"] === `chapters/${proof.chapterId}.md` &&
    isChapterStatusTransitionProof(entryProof) &&
    entryProof.proofChecksum === proof.proofChecksum
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
