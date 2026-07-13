import type {
  ChangeSet,
  ChangeSetApproval,
  VersionGroup,
  VersionGroupPostCommitHook
} from "@novel-studio/agent-engine";
import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

export interface VersionGroupTransactionApplyFile {
  readonly relativePath: string;
  readonly assetType: "chapter" | "text";
  readonly assetId?: string;
  readonly baseChecksum: string;
  readonly candidateChecksum: string;
  readonly baseContent: string;
  readonly candidateContent: string;
}

export interface VersionGroupTransactionApplyInput {
  readonly runId: string;
  readonly checkpointId: string;
  readonly changeSetId: string;
  readonly revision: number;
  readonly checksum: string;
  readonly approvalSource: "human_confirmation";
  readonly approvalToken: string;
  readonly files: readonly VersionGroupTransactionApplyFile[];
}

export interface VersionGroupSessionTransactionPort {
  listIncompleteTransactionPaths(): Promise<Result<readonly string[], UnifiedError>>;
  apply(input: VersionGroupTransactionApplyInput): Promise<Result<VersionGroup, UnifiedError>>;
  recoverIncompleteTransactions(): Promise<Result<readonly VersionGroup[], UnifiedError>>;
  undoVersionGroup(input: {
    readonly versionGroupId: string;
  }): Promise<Result<VersionGroup, UnifiedError>>;
  undoWrite(input: {
    readonly versionGroupId: string;
    readonly writeId: string;
  }): Promise<Result<VersionGroup, UnifiedError>>;
  undoRun(input: { readonly runId: string }): Promise<Result<VersionGroup, UnifiedError>>;
}

export interface VersionGroupSessionHooks {
  pauseAutosave(relativePaths: readonly string[]): Promise<void>;
  resumeAutosave(relativePaths: readonly string[]): Promise<void>;
  syncSavedEditor(input: {
    readonly relativePath: string;
    readonly checksum: string;
    readonly content?: string;
    readonly saveStatus: "Saved";
  }): Promise<void>;
  preserveDirtyBuffers(relativePaths: readonly string[]): Promise<void>;
  markRecoveryClean(relativePaths: readonly string[]): Promise<void>;
  surfaceTransactionRecoveryReview(group: VersionGroup): Promise<void>;
  reportPostCommitSyncFailure?(input: {
    readonly group: VersionGroup;
    readonly failedHooks: readonly VersionGroupPostCommitHook[];
  }): Promise<void>;
}

export interface VersionGroupSession {
  applyApproved(input: {
    readonly changeSet: ChangeSet;
    readonly approval: ChangeSetApproval;
  }): Promise<Result<VersionGroup, UnifiedError>>;
  recoverOnStartup(): Promise<Result<readonly VersionGroup[], UnifiedError>>;
  undoVersionGroup(input: {
    readonly versionGroupId: string;
    readonly relativePaths: readonly string[];
  }): Promise<Result<VersionGroup, UnifiedError>>;
  undoWrite(input: {
    readonly versionGroupId: string;
    readonly writeId: string;
    readonly relativePath: string;
  }): Promise<Result<VersionGroup, UnifiedError>>;
  undoRun(input: {
    readonly runId: string;
    readonly relativePaths: readonly string[];
  }): Promise<Result<VersionGroup, UnifiedError>>;
}

export interface CreateVersionGroupSessionOptions {
  readonly transaction: VersionGroupSessionTransactionPort;
  readonly hooks: VersionGroupSessionHooks;
}

export function createVersionGroupSession(
  options: CreateVersionGroupSessionOptions
): VersionGroupSession {
  return {
    async applyApproved(input) {
      const binding = validateApprovalBinding(input.changeSet, input.approval);
      if (!binding.ok) return binding;
      const selectedFiles = input.changeSet.files.filter((file) => file.selected);
      if (selectedFiles.length === 0 || selectedFiles.some((file) => !file.validation.valid)) {
        return err(versionGroupError("VERSION_GROUP_SELECTION_INVALID"));
      }

      const relativePaths = selectedFiles.map((file) => file.relativePath);
      const failedHooks: VersionGroupPostCommitHook[] = [];
      let committedGroup: VersionGroup | undefined;
      let result: Result<VersionGroup, UnifiedError> | undefined;
      await options.hooks.pauseAutosave(relativePaths);
      try {
        result = await options.transaction.apply({
          runId: input.changeSet.runId,
          checkpointId: input.changeSet.checkpointId,
          changeSetId: input.changeSet.changeSetId,
          revision: input.changeSet.revision,
          checksum: input.changeSet.checksum,
          approvalSource: input.approval.approvalSource,
          approvalToken: input.approval.binding.approvalToken,
          files: selectedFiles.map((file) => ({
            relativePath: file.relativePath,
            assetType: file.assetType,
            ...(file.assetId === undefined ? {} : { assetId: file.assetId }),
            baseChecksum: file.baseChecksum,
            candidateChecksum: file.candidateChecksum,
            baseContent: file.baseContent,
            candidateContent: file.candidateContent
          }))
        });
        if (!result.ok) {
          await options.hooks.preserveDirtyBuffers(relativePaths);
        } else if (result.value.transactionStatus === "applied") {
          const appliedGroup = result.value;
          committedGroup = appliedGroup;
          const candidateByPath = new Map(
            selectedFiles.map((file) => [file.relativePath, file.candidateContent])
          );
          await attemptPostCommitHook(
            "syncSavedEditor",
            () => syncAppliedEditors(appliedGroup, candidateByPath, options.hooks),
            failedHooks
          );
          if (failedHooks.includes("syncSavedEditor")) {
            try {
              await options.hooks.preserveDirtyBuffers(relativePaths);
            } catch {
              // A failed preservation hook must never mark an unsynchronized recovery record clean.
            }
          } else {
            await attemptPostCommitHook(
              "markRecoveryClean",
              () => options.hooks.markRecoveryClean(relativePaths),
              failedHooks
            );
          }
        } else if (result.value.transactionStatus === "partial_failure") {
          await options.hooks.surfaceTransactionRecoveryReview(result.value);
        } else {
          await options.hooks.preserveDirtyBuffers(relativePaths);
        }
      } finally {
        if (committedGroup === undefined) {
          await options.hooks.resumeAutosave(relativePaths);
        } else {
          await attemptPostCommitHook(
            "resumeAutosave",
            () => options.hooks.resumeAutosave(relativePaths),
            failedHooks
          );
        }
      }
      if (result === undefined)
        throw new Error("Version Group transaction did not return a result.");
      if (committedGroup === undefined || failedHooks.length === 0) return result;
      const synchronized = withSynchronizationFailure(committedGroup, failedHooks);
      try {
        await options.hooks.reportPostCommitSyncFailure?.({ group: synchronized, failedHooks });
      } catch {
        // The committed transaction remains authoritative even if recovery reporting is unavailable.
      }
      return ok(synchronized);
    },

    async recoverOnStartup() {
      const affected = await options.transaction.listIncompleteTransactionPaths();
      if (!affected.ok) return affected;
      if (affected.value.length > 0) await options.hooks.pauseAutosave(affected.value);
      try {
        const result = await options.transaction.recoverIncompleteTransactions();
        if (!result.ok) return result;
        for (const group of result.value) {
          const rolledBack = group.writes.filter((write) => write.status === "rolled_back");
          for (const write of rolledBack) {
            await options.hooks.syncSavedEditor({
              relativePath: write.relativePath,
              checksum: write.beforeChecksum,
              saveStatus: "Saved"
            });
          }
          if (group.transactionStatus === "partial_failure") {
            await options.hooks.surfaceTransactionRecoveryReview(group);
          } else if (group.transactionStatus === "rolled_back") {
            await options.hooks.markRecoveryClean(group.writes.map((write) => write.relativePath));
          }
        }
        return result;
      } finally {
        if (affected.value.length > 0) await options.hooks.resumeAutosave(affected.value);
      }
    },

    async undoVersionGroup(input) {
      return runUndo(
        input.relativePaths,
        () => options.transaction.undoVersionGroup({ versionGroupId: input.versionGroupId }),
        options.hooks
      );
    },

    async undoWrite(input) {
      return runUndo(
        [input.relativePath],
        () =>
          options.transaction.undoWrite({
            versionGroupId: input.versionGroupId,
            writeId: input.writeId
          }),
        options.hooks
      );
    },

    async undoRun(input) {
      return runUndo(
        input.relativePaths,
        () => options.transaction.undoRun({ runId: input.runId }),
        options.hooks
      );
    }
  };
}

async function runUndo(
  relativePaths: readonly string[],
  operation: () => Promise<Result<VersionGroup, UnifiedError>>,
  hooks: VersionGroupSessionHooks
): Promise<Result<VersionGroup, UnifiedError>> {
  const failedHooks: VersionGroupPostCommitHook[] = [];
  let committedGroup: VersionGroup | undefined;
  let result: Result<VersionGroup, UnifiedError> | undefined;
  await hooks.pauseAutosave(relativePaths);
  try {
    result = await operation();
    if (!result.ok) {
      await hooks.preserveDirtyBuffers(relativePaths);
    } else if (result.value.transactionStatus === "applied") {
      const appliedGroup = result.value;
      committedGroup = appliedGroup;
      await attemptPostCommitHook(
        "syncSavedEditor",
        () => syncAppliedEditors(appliedGroup, new Map(), hooks),
        failedHooks
      );
      await attemptPostCommitHook(
        "markRecoveryClean",
        () => hooks.markRecoveryClean(relativePaths),
        failedHooks
      );
    } else if (result.value.transactionStatus === "partial_failure") {
      await hooks.surfaceTransactionRecoveryReview(result.value);
    } else {
      await hooks.preserveDirtyBuffers(relativePaths);
    }
  } finally {
    if (committedGroup === undefined) {
      await hooks.resumeAutosave(relativePaths);
    } else {
      await attemptPostCommitHook(
        "resumeAutosave",
        () => hooks.resumeAutosave(relativePaths),
        failedHooks
      );
    }
  }
  if (result === undefined) throw new Error("Version Group undo did not return a result.");
  if (committedGroup === undefined || failedHooks.length === 0) return result;
  const synchronized = withSynchronizationFailure(committedGroup, failedHooks);
  try {
    await hooks.reportPostCommitSyncFailure?.({ group: synchronized, failedHooks });
  } catch {
    // The committed undo remains authoritative even if recovery reporting is unavailable.
  }
  return ok(synchronized);
}

async function attemptPostCommitHook(
  hook: VersionGroupPostCommitHook,
  operation: () => Promise<void>,
  failedHooks: VersionGroupPostCommitHook[]
): Promise<void> {
  try {
    await operation();
  } catch {
    failedHooks.push(hook);
  }
}

function withSynchronizationFailure(
  group: VersionGroup,
  failedHooks: readonly VersionGroupPostCommitHook[]
): VersionGroup {
  return Object.freeze({
    ...group,
    synchronization: Object.freeze({
      status: "recovery_required" as const,
      failedHooks: Object.freeze([...new Set(failedHooks)])
    })
  });
}

async function syncAppliedEditors(
  group: VersionGroup,
  contentByPath: ReadonlyMap<string, string>,
  hooks: VersionGroupSessionHooks
): Promise<void> {
  for (const write of group.writes.filter((candidate) => candidate.status === "applied")) {
    const content = contentByPath.get(write.relativePath);
    await hooks.syncSavedEditor({
      relativePath: write.relativePath,
      checksum: write.afterChecksum,
      ...(content === undefined ? {} : { content }),
      saveStatus: "Saved"
    });
  }
}

function validateApprovalBinding(
  changeSet: ChangeSet,
  approval: ChangeSetApproval
): Result<void, UnifiedError> {
  if (
    approval.decision !== "apply_selected" ||
    approval.approvalSource !== "human_confirmation" ||
    approval.binding.changeSetId !== changeSet.changeSetId ||
    approval.binding.revision !== changeSet.revision ||
    approval.binding.checksum !== changeSet.checksum ||
    approval.binding.approvalToken !== changeSet.approvalToken
  ) {
    return err(versionGroupError("VERSION_GROUP_APPROVAL_MISMATCH"));
  }
  return ok(undefined);
}

function versionGroupError(code: string): UnifiedError {
  return createUnifiedError({
    code,
    category: "ValidationError",
    message: "Version Group approval does not match an applicable Change Set revision.",
    recoverability: "user-action",
    suggestedAction: "Refresh and approve the current immutable Change Set revision.",
    traceId: "version-group-session"
  });
}
