import { randomUUID } from "node:crypto";

import {
  appendChangeSetProposal,
  checksumChangeSetText,
  createChangeSetRevision,
  decideChangeSetApproval,
  selectChangeSetRevision,
  validateAgentRelativePath,
  type ChangeSet,
  type ChangeSetApproval,
  type ChangeSetAssetType,
  type ChangeSetExternalValidation,
  type ChangeSetRange,
  type ChangeSetFileSelection,
  type DecideChangeSetCommand
} from "@novel-studio/agent-engine";
import { createUnifiedError, err, type Result, type UnifiedError } from "@novel-studio/shared";

export interface ChangeSetProposalTarget {
  readonly relativePath: string;
  readonly assetType: ChangeSetAssetType;
  readonly assetId?: string;
  readonly content: string;
  readonly checksum: string;
  readonly dirty: boolean;
  readonly supported: boolean;
}

export interface ChangeSetCandidateValidationPortInput {
  readonly runId: string;
  readonly projectId: string;
  readonly relativePath: string;
  readonly assetType: ChangeSetAssetType;
  readonly assetId?: string;
  readonly candidateContent: string;
}

export interface ChangeSetSessionPort {
  readChapterTarget(input: {
    readonly projectId: string;
    readonly chapterId: string;
  }): Promise<Result<ChangeSetProposalTarget, UnifiedError>>;
  readFileTarget(input: {
    readonly projectId: string;
    readonly relativePath: string;
  }): Promise<Result<ChangeSetProposalTarget, UnifiedError>>;
  validateCandidate(
    input: ChangeSetCandidateValidationPortInput
  ): Promise<Result<ChangeSetExternalValidation, UnifiedError>>;
  persistChangeSet(changeSet: ChangeSet): Promise<Result<ChangeSet, UnifiedError>>;
  readChangeSet?(
    changeSetId: string,
    revision?: number
  ): Promise<Result<ChangeSet | undefined, UnifiedError>>;
  readLatestChangeSet?(input: {
    readonly runId: string;
    readonly projectId: string;
    readonly checkpointId: string;
  }): Promise<Result<ChangeSet | undefined, UnifiedError>>;
}

interface ChangeSetProposalBinding {
  readonly runId: string;
  readonly projectId: string;
  readonly checkpointId: string;
  readonly contextSnapshotId: string;
  readonly range: ChangeSetRange;
  readonly baseHash: string;
  readonly replacement: string;
}

export interface ProposeChapterWriteInput extends ChangeSetProposalBinding {
  readonly chapterId: string;
}

export interface ProposeFileWriteInput extends ChangeSetProposalBinding {
  readonly path: string;
}

export interface SelectChangeSetSessionRevisionInput {
  readonly runId: string;
  readonly projectId: string;
  readonly changeSetId: string;
  readonly revision: number;
  readonly files: readonly ChangeSetFileSelection[];
}

export interface ChangeSetSession {
  proposeChapterWrite(input: ProposeChapterWriteInput): Promise<Result<ChangeSet, UnifiedError>>;
  proposeFileWrite(input: ProposeFileWriteInput): Promise<Result<ChangeSet, UnifiedError>>;
  selectRevision(
    input: SelectChangeSetSessionRevisionInput
  ): Promise<Result<ChangeSet, UnifiedError>>;
  readChangeSet(changeSetId: string, revision?: number): Promise<Result<ChangeSet, UnifiedError>>;
  decide(
    command: DecideChangeSetCommand
  ): Promise<Result<ChangeSet | ChangeSetApproval, UnifiedError>>;
}

export interface CreateChangeSetSessionOptions {
  readonly port: ChangeSetSessionPort;
  readonly createChangeSetId?: () => string;
  readonly createHunkId?: () => string;
  readonly now?: () => string;
}

export function createChangeSetSession(options: CreateChangeSetSessionOptions): ChangeSetSession {
  const revisions = new Map<string, Map<number, ChangeSet>>();
  const activeChangeSetByCheckpoint = new Map<string, string>();
  const decisionReceipts = new Map<string, Result<ChangeSet | ChangeSetApproval, UnifiedError>>();
  const createChangeSetId =
    options.createChangeSetId ?? (() => `change_set_${randomUUID().replaceAll("-", "")}`);
  const now = options.now ?? (() => new Date().toISOString());

  async function propose(
    binding: ChangeSetProposalBinding,
    target: ChangeSetProposalTarget
  ): Promise<Result<ChangeSet, UnifiedError>> {
    const targetError = validateTarget(target, binding.baseHash);
    if (targetError !== undefined) return err(targetError);
    const checkpointKey = checkpointBindingKey(binding);
    const activeId = activeChangeSetByCheckpoint.get(checkpointKey);

    try {
      let existing = activeId === undefined ? undefined : latestRevision(activeId);
      if (existing === undefined && options.port.readLatestChangeSet !== undefined) {
        const restored = await options.port.readLatestChangeSet({
          runId: binding.runId,
          projectId: binding.projectId,
          checkpointId: binding.checkpointId
        });
        if (!restored.ok) return restored;
        existing = restored.value;
        if (existing !== undefined) {
          rememberRevision(existing);
          activeChangeSetByCheckpoint.set(checkpointKey, existing.changeSetId);
        }
      }
      if (
        existing !== undefined &&
        (existing.runId !== binding.runId ||
          existing.projectId !== binding.projectId ||
          existing.checkpointId !== binding.checkpointId ||
          existing.contextSnapshotId !== binding.contextSnapshotId)
      ) {
        return failure(
          "CHANGE_SET_CONTEXT_MISMATCH",
          "The active Change Set is bound to a different checkpoint or context snapshot.",
          "Refresh context and create a new checkpoint proposal."
        );
      }
      const proposal = {
        relativePath: target.relativePath,
        assetType: target.assetType,
        ...(target.assetId === undefined ? {} : { assetId: target.assetId }),
        baseContent: target.content,
        baseChecksum: binding.baseHash,
        range: binding.range,
        replacement: binding.replacement
      };
      const validateCandidate = candidateValidator(binding);
      const revisionOptions = {
        ...(options.createHunkId === undefined ? {} : { createHunkId: options.createHunkId }),
        validateCandidate
      };
      const revision =
        existing === undefined
          ? await createChangeSetRevision(
              {
                changeSetId: createChangeSetId(),
                runId: binding.runId,
                projectId: binding.projectId,
                checkpointId: binding.checkpointId,
                contextSnapshotId: binding.contextSnapshotId,
                proposal,
                createdAt: now()
              },
              revisionOptions
            )
          : await appendChangeSetProposal(
              existing,
              { proposal, createdAt: now() },
              revisionOptions
            );
      const persisted = await options.port.persistChangeSet(revision);
      if (!persisted.ok) return persisted;
      rememberRevision(revision);
      activeChangeSetByCheckpoint.set(checkpointKey, revision.changeSetId);
      return { ok: true, value: revision };
    } catch (error) {
      return err(asUnifiedError(error));
    }
  }

  function candidateValidator(binding: Pick<ChangeSetProposalBinding, "runId" | "projectId">) {
    return async (input: {
      readonly relativePath: string;
      readonly assetType: ChangeSetAssetType;
      readonly assetId?: string;
      readonly candidateContent: string;
    }): Promise<ChangeSetExternalValidation> => {
      const validated = await options.port.validateCandidate({
        runId: binding.runId,
        projectId: binding.projectId,
        relativePath: input.relativePath,
        assetType: input.assetType,
        ...(input.assetId === undefined ? {} : { assetId: input.assetId }),
        candidateContent: input.candidateContent
      });
      if (!validated.ok) throw validated.error;
      return validated.value;
    };
  }

  function rememberRevision(changeSet: ChangeSet): void {
    const byRevision = revisions.get(changeSet.changeSetId) ?? new Map<number, ChangeSet>();
    byRevision.set(changeSet.revision, changeSet);
    revisions.set(changeSet.changeSetId, byRevision);
  }

  function latestRevision(changeSetId: string): ChangeSet | undefined {
    const values = [...(revisions.get(changeSetId)?.values() ?? [])];
    return values.sort((left, right) => right.revision - left.revision)[0];
  }

  async function findRevision(
    changeSetId: string,
    revision?: number
  ): Promise<Result<ChangeSet, UnifiedError>> {
    const inMemory =
      revision === undefined
        ? latestRevision(changeSetId)
        : revisions.get(changeSetId)?.get(revision);
    if (inMemory !== undefined) return { ok: true, value: inMemory };
    if (options.port.readChangeSet !== undefined) {
      const persisted = await options.port.readChangeSet(changeSetId, revision);
      if (!persisted.ok) return persisted;
      if (persisted.value !== undefined) {
        rememberRevision(persisted.value);
        return { ok: true, value: persisted.value };
      }
    }
    return failure(
      "CHANGE_SET_NOT_FOUND",
      "The requested Change Set revision was not found.",
      "Refresh the Agent run and select an available revision."
    );
  }

  return {
    async proposeChapterWrite(input) {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.chapterId)) {
        return failure(
          "CHANGE_SET_TARGET_INVALID",
          "A chapter proposal requires a stable chapter ID.",
          "Select an existing chapter and retry the proposal."
        );
      }
      const target = await options.port.readChapterTarget({
        projectId: input.projectId,
        chapterId: input.chapterId
      });
      if (!target.ok) return target;
      if (target.value.assetType !== "chapter" || target.value.assetId !== input.chapterId) {
        return failure(
          "CHANGE_SET_TARGET_INVALID",
          "The chapter target did not match the requested chapter ID.",
          "Refresh the chapter target and retry."
        );
      }
      return propose(input, target.value);
    },

    async proposeFileWrite(input) {
      const path = validateAgentRelativePath(input.path);
      if (!path.ok) return path;
      const target = await options.port.readFileTarget({
        projectId: input.projectId,
        relativePath: path.value.relativePath
      });
      if (!target.ok) return target;
      if (
        target.value.assetType !== "text" ||
        target.value.relativePath !== path.value.relativePath
      ) {
        return failure(
          "CHANGE_SET_TARGET_INVALID",
          "The file target did not match the requested project-relative path.",
          "Refresh the file target and retry."
        );
      }
      return propose(input, target.value);
    },

    async selectRevision(input) {
      const current = await findRevision(input.changeSetId, input.revision);
      if (!current.ok) return current;
      if (current.value.runId !== input.runId || current.value.projectId !== input.projectId) {
        return failure(
          "CHANGE_SET_BINDING_MISMATCH",
          "The selection does not match the Change Set run binding.",
          "Refresh the Change Set and select the current run revision."
        );
      }
      try {
        const selected = await selectChangeSetRevision(
          current.value,
          { files: input.files, createdAt: now() },
          { validateCandidate: candidateValidator(input) }
        );
        const persisted = await options.port.persistChangeSet(selected);
        if (!persisted.ok) return persisted;
        rememberRevision(selected);
        return { ok: true, value: selected };
      } catch (error) {
        return err(asUnifiedError(error));
      }
    },

    readChangeSet: findRevision,

    async decide(command) {
      const receiptKey = `${command.projectId}:${command.commandId}`;
      const prior = decisionReceipts.get(receiptKey);
      if (prior !== undefined) return prior;
      const current = await findRevision(command.changeSetId, command.revision);
      if (!current.ok) {
        decisionReceipts.set(receiptKey, current);
        return current;
      }
      if (current.value.runId !== command.runId || current.value.projectId !== command.projectId) {
        const mismatch = failure(
          "CHANGE_SET_BINDING_MISMATCH",
          "The decision does not match the Change Set run binding.",
          "Refresh the Change Set and decide the current run revision."
        );
        decisionReceipts.set(receiptKey, mismatch);
        return mismatch;
      }
      if (command.decision === "update_selection") {
        if (current.value.checksum !== command.checksum) {
          const mismatch = failure(
            "CHANGE_SET_BINDING_MISMATCH",
            "The selection does not match the displayed Change Set checksum.",
            "Refresh the Change Set and update the current revision."
          );
          decisionReceipts.set(receiptKey, mismatch);
          return mismatch;
        }
        try {
          const selected = await selectChangeSetRevision(
            current.value,
            { files: command.files, createdAt: now() },
            { validateCandidate: candidateValidator(command) }
          );
          const persisted = await options.port.persistChangeSet(selected);
          if (!persisted.ok) {
            decisionReceipts.set(receiptKey, persisted);
            return persisted;
          }
          rememberRevision(selected);
          const result = { ok: true as const, value: selected };
          decisionReceipts.set(receiptKey, result);
          return result;
        } catch (error) {
          const failed = err(asUnifiedError(error));
          decisionReceipts.set(receiptKey, failed);
          return failed;
        }
      }
      const decided = decideChangeSetApproval({
        changeSet: current.value,
        writePolicy: "write_before_confirmation",
        decision: command.decision,
        changeSetId: command.changeSetId,
        revision: command.revision,
        checksum: command.checksum,
        resolvedAt: now()
      });
      decisionReceipts.set(receiptKey, decided);
      return decided;
    }
  };
}

function validateTarget(
  target: ChangeSetProposalTarget,
  expectedBaseHash: string
): UnifiedError | undefined {
  if (target.dirty) {
    return sessionError(
      "CHANGE_SET_DIRTY_TARGET",
      "A dirty editor buffer cannot be staged for Agent writing.",
      "Save and refresh the target, or exclude it from this run."
    );
  }
  if (!target.supported) {
    return sessionError(
      "CHANGE_SET_UNSUPPORTED_TARGET",
      "The target is not an existing supported UTF-8 text asset.",
      "Choose an existing supported project text file."
    );
  }
  if (
    target.checksum !== expectedBaseHash ||
    checksumChangeSetText(target.content) !== expectedBaseHash
  ) {
    return sessionError(
      "CHANGE_SET_BASE_MISMATCH",
      "The target content changed after the proposal base was captured.",
      "Refresh the target and regenerate the proposal."
    );
  }
  return undefined;
}

function checkpointBindingKey(input: ChangeSetProposalBinding): string {
  return `${input.projectId}:${input.runId}:${input.checkpointId}`;
}

function failure(
  code: string,
  message: string,
  suggestedAction: string
): Result<never, UnifiedError> {
  return err(sessionError(code, message, suggestedAction));
}

function sessionError(code: string, message: string, suggestedAction: string): UnifiedError {
  return createUnifiedError({
    code,
    category: "ValidationError",
    message,
    recoverability: "user-action",
    suggestedAction,
    traceId: "change-set-session"
  });
}

function asUnifiedError(error: unknown): UnifiedError {
  if (
    error !== null &&
    typeof error === "object" &&
    "schemaVersion" in error &&
    "code" in error &&
    "message" in error
  ) {
    return error as UnifiedError;
  }
  return createUnifiedError({
    code: "CHANGE_SET_FAILED",
    category: "AgentError",
    message: "The Change Set operation failed.",
    recoverability: "retryable",
    suggestedAction: "Retry after refreshing the Agent run.",
    traceId: "change-set-session"
  });
}
