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
  | "available"
  | "not_available"
  | "completed"
  | "conflict"
  | "partial_failure"
  | "review_required";
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
  | "ready"
  | "conflict"
  | "stale"
  | "failed"
  | "completed"
  | "kept";
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
  readonly schemaVersion: "1.0";
  readonly versionGroupId: string;
  readonly runId: string;
  readonly checkpointId: string;
  readonly changeSetId: string;
  readonly changeSetRevision: number;
  readonly changeSetChecksum: string;
  readonly writePolicy?: AgentWritePolicy;
  readonly approvalSource?: "human_confirmation" | "user_preapproved_run";
  readonly createdAt: string;
  readonly writes: readonly VersionGroupWrite[];
  readonly baselineByPath: Readonly<Record<string, VersionGroupBaseline>>;
  readonly transactionStatus: VersionGroupTransactionStatus;
  readonly undoStatus: VersionGroupUndoStatus;
  readonly undoMetadata: VersionGroupUndoMetadata;
  readonly rollbackReview?: RollbackReview;
  readonly failureKind?: VersionGroupFailureKind;
  readonly synchronization?: VersionGroupSynchronization;
}

interface VersionGroupBaseInput {
  readonly versionGroupId: string;
  readonly runId: string;
  readonly checkpointId: string;
  readonly changeSetId: string;
  readonly changeSetRevision: number;
  readonly changeSetChecksum: string;
  readonly writePolicy?: AgentWritePolicy;
  readonly approvalSource?: "human_confirmation" | "user_preapproved_run";
  readonly createdAt: string;
  readonly writes: readonly VersionGroupWrite[];
  readonly baselineByPath: Readonly<Record<string, VersionGroupBaseline>>;
  readonly undoOfVersionGroupIds?: readonly string[];
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
    schemaVersion: "1.0",
    versionGroupId: input.versionGroupId,
    runId: input.runId,
    checkpointId: input.checkpointId,
    changeSetId: input.changeSetId,
    changeSetRevision: input.changeSetRevision,
    changeSetChecksum: input.changeSetChecksum,
    ...(input.writePolicy === undefined ? {} : { writePolicy: input.writePolicy }),
    ...(input.approvalSource === undefined ? {} : { approvalSource: input.approvalSource }),
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
    }
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
  return Object.freeze({
    ...group,
    writes,
    baselineByPath,
    undoMetadata,
    ...(rollbackReview === undefined ? {} : { rollbackReview }),
    ...(synchronization === undefined ? {} : { synchronization })
  });
}
import type { AgentWritePolicy } from "./agent-run-types.js";
