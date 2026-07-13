export type VersionGroupAssetType = "chapter" | "text";
export type VersionGroupTransactionStatus =
  "failed" | "applied" | "rolled_back" | "partial_failure";
export type VersionGroupFailureKind =
  "preflight_failure" | "write_failure" | "partial_failure" | "undo_conflict" | "undo_failure";
export type VersionGroupWriteStatus =
  "pending" | "applied" | "rolled_back" | "rollback_failed" | "conflict";
export type VersionGroupUndoStatus =
  "available" | "not_available" | "completed" | "conflict" | "partial_failure";
export type VersionGroupPostCommitHook =
  "syncSavedEditor" | "markRecoveryClean" | "resumeAutosave";

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

export interface VersionGroup {
  readonly schemaVersion: "1.0";
  readonly versionGroupId: string;
  readonly runId: string;
  readonly checkpointId: string;
  readonly changeSetId: string;
  readonly changeSetRevision: number;
  readonly changeSetChecksum: string;
  readonly createdAt: string;
  readonly writes: readonly VersionGroupWrite[];
  readonly baselineByPath: Readonly<Record<string, VersionGroupBaseline>>;
  readonly transactionStatus: VersionGroupTransactionStatus;
  readonly undoStatus: VersionGroupUndoStatus;
  readonly undoMetadata: VersionGroupUndoMetadata;
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
  return Object.freeze({
    ...group,
    writes,
    baselineByPath,
    undoMetadata,
    ...(synchronization === undefined ? {} : { synchronization })
  });
}
