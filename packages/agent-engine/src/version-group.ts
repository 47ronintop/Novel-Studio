import type { JsonValue } from "@novel-studio/shared";
import type { AgentWritePolicy } from "./agent-run-types.js";

export type VersionGroupAssetType = "chapter" | "text";
export type VersionGroupTransactionStatus =
  "failed" | "applied" | "rolled_back" | "partial_failure" | "awaiting_review";
export type VersionGroupFailureKind =
  "preflight_failure" | "write_failure" | "partial_failure" | "undo_conflict" | "undo_failure";
export type VersionGroupWriteStatus =
  | "pending"
  | "applied"
  | "rolled_back"
  | "rollback_failed"
  | "conflict"
  | "completed"
  | "kept"
  | "stale";
export type VersionGroupUndoStatus =
  "available" | "not_available" | "completed" | "conflict" | "partial_failure" | "review_required";
export type VersionGroupPostCommitHook =
  | "syncSavedEditor"
  | "preserveDirtyBuffers"
  | "markRecoveryClean"
  | "surfaceTransactionRecoveryReview"
  | "resumeAutosave";

export interface VersionGroupSynchronization {
  readonly status: "recovery_required";
  readonly failedHooks: readonly VersionGroupPostCommitHook[];
}

/** A bounded, display-only inverse patch for a Story Bible application. */
export type StoryBibleInversePatchOperation =
  | { readonly op: "add" | "replace"; readonly path: string; readonly value: JsonValue }
  | { readonly op: "remove"; readonly path: string };

export interface StoryBibleLegacyMigrationReceipt {
  readonly sourceRelativePath: string;
  readonly createOperationId: string;
  readonly deleteOperationId: string;
}

export interface StoryBibleApplyReceiptAsset {
  readonly assetId: string;
  readonly relativePath: string;
  readonly beforeRevision: number | null;
  readonly afterRevision: number;
  readonly beforeChecksum: string | null;
  readonly afterChecksum: string;
  readonly historyVersionId: string | null;
  readonly inversePatch: readonly StoryBibleInversePatchOperation[];
  readonly legacyMigration?: StoryBibleLegacyMigrationReceipt;
}

/** Non-authoritative metadata projected from the transaction journal and History. */
export interface StoryBibleApplyReceipt {
  readonly schemaVersion: "1.0";
  readonly changeSetId: string;
  readonly consistencyGroupId: string;
  readonly suggestionIds: readonly string[];
  readonly assets: readonly StoryBibleApplyReceiptAsset[];
}

export interface VersionGroupWrite {
  readonly writeId: string;
  readonly relativePath: string;
  readonly assetType: VersionGroupAssetType;
  readonly beforeChecksum: string;
  readonly afterChecksum: string;
  readonly beforeVersionId: string;
  readonly status: VersionGroupWriteStatus;
  readonly errorCode?: string;
}

export type VersionGroupOperationKind =
  "modify" | "create_file" | "move_file" | "delete_file" | "create_directory" | "remove_directory";

/** Durable lifecycle outcome accompanying the ordinary text-write history. */
export interface VersionGroupOperation {
  readonly operationId: string;
  readonly kind: VersionGroupOperationKind;
  readonly relativePaths: readonly string[];
  readonly status: Extract<
    VersionGroupWriteStatus,
    "pending" | "applied" | "rolled_back" | "rollback_failed"
  >;
  readonly errorCode?: string;
}

export interface VersionGroupBaseline {
  readonly relativePath: string;
  readonly checksum: string;
  readonly beforeVersionId: string;
}

export interface VersionGroupUndoMetadata {
  readonly runId: string;
  readonly versionGroupId: string;
  readonly baselineVersionIds: Readonly<Record<string, string>>;
  readonly lastWriteChecksums: Readonly<Record<string, string>>;
  readonly undoOfVersionGroupIds?: readonly string[];
}

export type RollbackReviewDecision = "keep_current" | "restore_baseline";
export type RollbackReviewFileStatus =
  "ready" | "conflict" | "stale" | "failed" | "completed" | "kept";
export type RollbackReviewStatus = "pending" | "partial_failure" | "completed";

export interface RollbackReviewDiff {
  readonly currentToLastWrite: string;
  readonly currentToBaseline: string;
  readonly lastWriteToBaseline: string;
}

export interface RollbackReviewFile {
  readonly relativePath: string;
  readonly assetType: VersionGroupAssetType;
  readonly assetId?: string;
  readonly baselineContent: string;
  readonly baselineChecksum: string;
  readonly baselineHistoryContent?: string;
  readonly baselineVersionId: string;
  readonly runLastWriteContent: string;
  readonly runLastWriteChecksum: string;
  readonly runLastWriteHistoryContent?: string;
  readonly reviewedCurrentContent: string;
  readonly reviewedCurrentChecksum: string;
  readonly reviewedCurrentHistoryContent?: string;
  readonly reviewedEditorChecksum?: string;
  readonly diff: RollbackReviewDiff;
  readonly decision?: RollbackReviewDecision;
  readonly status: RollbackReviewFileStatus;
  readonly snapshotVersionId?: string;
  readonly errorCode?: string;
}

export interface RollbackReview {
  readonly schemaVersion: "1.0";
  readonly reviewId: string;
  readonly runId: string;
  readonly status: RollbackReviewStatus;
  readonly sourceVersionGroupIds: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly processedCommandIds: readonly string[];
  readonly files: readonly RollbackReviewFile[];
}

export interface VersionGroup {
  readonly schemaVersion: "1.0" | "1.1";
  readonly versionGroupId: string;
  readonly runId: string;
  readonly checkpointId: string;
  readonly changeSetId: string;
  readonly changeSetRevision: number;
  readonly changeSetChecksum: string;
  readonly writePolicy?: AgentWritePolicy;
  readonly approvalSource?:
    "human_confirmation" | "user_preapproved_run" | "project_safe_auto_update";
  readonly applyBatchId?: string;
  readonly consistencyGroupId?: string;
  readonly selectionChecksum?: string;
  readonly createdAt: string;
  readonly writes: readonly VersionGroupWrite[];
  readonly operations?: readonly VersionGroupOperation[];
  readonly baselineByPath: Readonly<Record<string, VersionGroupBaseline>>;
  readonly transactionStatus: VersionGroupTransactionStatus;
  readonly undoStatus: VersionGroupUndoStatus;
  readonly undoMetadata: VersionGroupUndoMetadata;
  readonly rollbackReview?: RollbackReview;
  readonly failureKind?: VersionGroupFailureKind;
  readonly synchronization?: VersionGroupSynchronization;
  readonly storyBibleReceipt?: StoryBibleApplyReceipt;
}

interface VersionGroupBaseInput {
  readonly versionGroupId: string;
  readonly runId: string;
  readonly checkpointId: string;
  readonly changeSetId: string;
  readonly changeSetRevision: number;
  readonly changeSetChecksum: string;
  readonly writePolicy?: AgentWritePolicy;
  readonly approvalSource?:
    "human_confirmation" | "user_preapproved_run" | "project_safe_auto_update";
  readonly applyBatchId?: string;
  readonly consistencyGroupId?: string;
  readonly selectionChecksum?: string;
  readonly createdAt: string;
  readonly writes: readonly VersionGroupWrite[];
  readonly baselineByPath: Readonly<Record<string, VersionGroupBaseline>>;
  readonly undoOfVersionGroupIds?: readonly string[];
  readonly storyBibleReceipt?: StoryBibleApplyReceipt;
}

export interface FailedVersionGroupInput extends VersionGroupBaseInput {
  readonly transactionStatus: Exclude<VersionGroupTransactionStatus, "applied">;
  readonly failureKind: VersionGroupFailureKind;
}

export function createAppliedVersionGroup(input: VersionGroupBaseInput): VersionGroup {
  return freezeVersionGroup({
    ...baseGroup(input),
    transactionStatus: "applied",
    undoStatus: "available"
  });
}

export function createFailedVersionGroup(input: FailedVersionGroupInput): VersionGroup {
  return freezeVersionGroup({
    ...baseGroup(input),
    transactionStatus: input.transactionStatus,
    undoStatus: undoStatusForFailure(input.failureKind),
    failureKind: input.failureKind
  });
}

function baseGroup(
  input: VersionGroupBaseInput
): Omit<VersionGroup, "transactionStatus" | "undoStatus" | "failureKind"> {
  const baselineVersionIds = Object.fromEntries(
    Object.entries(input.baselineByPath).map(([path, baseline]) => [path, baseline.beforeVersionId])
  );
  const lastWriteChecksums = Object.fromEntries(
    input.writes.map((write) => [write.relativePath, write.afterChecksum])
  );

  return {
    schemaVersion:
      input.applyBatchId === undefined || input.consistencyGroupId === undefined ? "1.0" : "1.1",
    versionGroupId: input.versionGroupId,
    runId: input.runId,
    checkpointId: input.checkpointId,
    changeSetId: input.changeSetId,
    changeSetRevision: input.changeSetRevision,
    changeSetChecksum: input.changeSetChecksum,
    ...(input.writePolicy === undefined ? {} : { writePolicy: input.writePolicy }),
    ...(input.approvalSource === undefined ? {} : { approvalSource: input.approvalSource }),
    ...(input.applyBatchId === undefined ? {} : { applyBatchId: input.applyBatchId }),
    ...(input.consistencyGroupId === undefined
      ? {}
      : { consistencyGroupId: input.consistencyGroupId }),
    ...(input.selectionChecksum === undefined
      ? {}
      : { selectionChecksum: input.selectionChecksum }),
    createdAt: input.createdAt,
    writes: input.writes,
    baselineByPath: input.baselineByPath,
    undoMetadata: {
      runId: input.runId,
      versionGroupId: input.versionGroupId,
      baselineVersionIds,
      lastWriteChecksums,
      ...(input.undoOfVersionGroupIds === undefined
        ? {}
        : { undoOfVersionGroupIds: input.undoOfVersionGroupIds })
    },
    ...(input.storyBibleReceipt === undefined ? {} : { storyBibleReceipt: input.storyBibleReceipt })
  };
}

function undoStatusForFailure(failureKind: VersionGroupFailureKind): VersionGroupUndoStatus {
  if (failureKind === "partial_failure" || failureKind === "undo_failure") {
    return "partial_failure";
  }
  if (failureKind === "undo_conflict") {
    return "conflict";
  }
  return "not_available";
}

function freezeVersionGroup(group: VersionGroup): VersionGroup {
  const writes = Object.freeze(group.writes.map((write) => Object.freeze({ ...write })));
  const baselineByPath = Object.freeze(
    Object.fromEntries(
      Object.entries(group.baselineByPath).map(([path, baseline]) => [
        path,
        Object.freeze({ ...baseline })
      ])
    )
  );
  const undoMetadata = Object.freeze({
    ...group.undoMetadata,
    baselineVersionIds: Object.freeze({ ...group.undoMetadata.baselineVersionIds }),
    lastWriteChecksums: Object.freeze({ ...group.undoMetadata.lastWriteChecksums }),
    ...(group.undoMetadata.undoOfVersionGroupIds === undefined
      ? {}
      : { undoOfVersionGroupIds: Object.freeze([...group.undoMetadata.undoOfVersionGroupIds]) })
  });
  const synchronization =
    group.synchronization === undefined
      ? undefined
      : Object.freeze({
          ...group.synchronization,
          failedHooks: Object.freeze([...group.synchronization.failedHooks])
        });
  const rollbackReview =
    group.rollbackReview === undefined
      ? undefined
      : Object.freeze({
          ...group.rollbackReview,
          sourceVersionGroupIds: Object.freeze([...group.rollbackReview.sourceVersionGroupIds]),
          processedCommandIds: Object.freeze([...group.rollbackReview.processedCommandIds]),
          files: Object.freeze(
            group.rollbackReview.files.map((file) =>
              Object.freeze({ ...file, diff: Object.freeze({ ...file.diff }) })
            )
          )
        });
  const storyBibleReceipt =
    group.storyBibleReceipt === undefined
      ? undefined
      : Object.freeze({
          ...group.storyBibleReceipt,
          suggestionIds: Object.freeze([...group.storyBibleReceipt.suggestionIds]),
          assets: Object.freeze(
            group.storyBibleReceipt.assets.map((asset) =>
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
        });
  return Object.freeze({
    ...group,
    writes,
    baselineByPath,
    undoMetadata,
    ...(rollbackReview === undefined ? {} : { rollbackReview }),
    ...(synchronization === undefined ? {} : { synchronization }),
    ...(storyBibleReceipt === undefined ? {} : { storyBibleReceipt })
  });
}
