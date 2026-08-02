import { randomUUID } from "node:crypto";

import {
  appendChangeSetProposal,
  appendChangeSetOperations,
  checksumChangeSetText,
  createChangeSetRevision,
  createOperationsChangeSetRevisionBatch,
  decideChangeSetApproval,
  selectChangeSetRevision,
  validateAgentRelativePath,
  type ChangeSet,
  type ChangeSetApproval,
  type ChangeSetAssetType,
  type ChangeSetExternalValidation,
  type ChangeSetOperation,
  type ChangeSetOperationSelection,
  type ChangeSetRange,
  type ChangeSetFileSelection,
  type DecideChangeSetCommand,
  type StoryBibleStatusTransitionProof,
  type AgentWritePolicy
} from "@novel-studio/agent-engine";
import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";
import { consumeAgentRunProposalAuthorization } from "./agent-write-authorization.js";

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
  readonly checkpointId: string;
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
  readStoryBibleTarget?(input: {
    readonly projectId: string;
    readonly assetId: string;
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
  readonly consistencyGroupId?: string;
}

interface InternalChangeSetProposalBinding extends ChangeSetProposalBinding {
  readonly writePolicy?: AgentWritePolicy;
  readonly storyBibleStatusProof?: StoryBibleStatusTransitionProof;
}

export interface ProposeChapterWriteInput extends ChangeSetProposalBinding {
  readonly chapterId: string;
}

export interface ProposeFileWriteInput extends ChangeSetProposalBinding {
  readonly path: string;
}

export interface ProposeStoryBibleWriteInput extends ChangeSetProposalBinding {
  readonly assetId: string;
  /** Set only after Repository has generated and validated every v1.1 system field. */
  readonly repositoryPrepared?: boolean;
  readonly storyBibleStatusProof?: StoryBibleStatusTransitionProof;
}

export interface SelectChangeSetSessionRevisionInput {
  readonly runId: string;
  readonly projectId: string;
  readonly changeSetId: string;
  readonly revision: number;
  readonly files: readonly ChangeSetFileSelection[];
  readonly operations?: readonly ChangeSetOperationSelection[];
}

export interface ProposeOperationInput {
  readonly runId: string;
  readonly projectId: string;
  readonly checkpointId: string;
  readonly contextSnapshotId: string;
  readonly writePolicy?: AgentWritePolicy;
  readonly toolCallId: string;
  readonly operation: ChangeSetOperation;
}

export interface ProposeOperationBatchInput {
  readonly runId: string;
  readonly projectId: string;
  readonly checkpointId: string;
  readonly contextSnapshotId: string;
  readonly writePolicy?: AgentWritePolicy;
  readonly operations: readonly {
    readonly toolCallId: string;
    readonly operation: ChangeSetOperation;
  }[];
}

export interface ChangeSetSession {
  proposeChapterWrite(input: ProposeChapterWriteInput): Promise<Result<ChangeSet, UnifiedError>>;
  proposeFileWrite(input: ProposeFileWriteInput): Promise<Result<ChangeSet, UnifiedError>>;
  proposeStoryBibleWrite(
    input: ProposeStoryBibleWriteInput
  ): Promise<Result<ChangeSet, UnifiedError>>;
  /** Task B.3 — stages a lifecycle operation (create/move/delete/mkdir) into the active Change Set. */
  proposeOperation(input: ProposeOperationInput): Promise<Result<ChangeSet, UnifiedError>>;
  /** Stages a complete lifecycle-operation group in one validated, persisted revision. */
  proposeOperationBatch(
    input: ProposeOperationBatchInput
  ): Promise<Result<ChangeSet, UnifiedError>>;
  selectRevision(
    input: SelectChangeSetSessionRevisionInput
  ): Promise<Result<ChangeSet, UnifiedError>>;
  readChangeSet(changeSetId: string, revision?: number): Promise<Result<ChangeSet, UnifiedError>>;
  readLatestChangeSet(input: {
    readonly runId: string;
    readonly projectId: string;
    readonly checkpointId: string;
  }): Promise<Result<ChangeSet | undefined, UnifiedError>>;
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
    binding: InternalChangeSetProposalBinding,
    target: ChangeSetProposalTarget
  ): Promise<Result<ChangeSet, UnifiedError>> {
    const targetError = validateTarget(target, binding.baseHash);
    if (targetError !== undefined) return err(targetError);
    const checkpointKey = checkpointBindingKey(binding);
    const activeId = activeChangeSetByCheckpoint.get(checkpointKey);

    try {
      const writePolicy =
        binding.writePolicy === "user_preapproved_run" &&
        consumeAgentRunProposalAuthorization(binding)
          ? "user_preapproved_run"
          : "write_before_confirmation";
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
          existing.contextSnapshotId !== binding.contextSnapshotId ||
          (existing.writePolicy ?? "write_before_confirmation") !== writePolicy)
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
        replacement: binding.replacement,
        ...(binding.consistencyGroupId === undefined
          ? {}
          : { consistencyGroupId: binding.consistencyGroupId }),
        ...(binding.storyBibleStatusProof === undefined
          ? {}
          : { storyBibleStatusProof: binding.storyBibleStatusProof })
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
                writePolicy,
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

  function candidateValidator(
    binding: Pick<ChangeSetProposalBinding, "runId" | "projectId" | "checkpointId">
  ) {
    return async (input: {
      readonly relativePath: string;
      readonly assetType: ChangeSetAssetType;
      readonly assetId?: string;
      readonly candidateContent: string;
    }): Promise<ChangeSetExternalValidation> => {
      const validated = await options.port.validateCandidate({
        runId: binding.runId,
        projectId: binding.projectId,
        checkpointId: binding.checkpointId,
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

  async function proposeOperationBatch(
    input: ProposeOperationBatchInput,
    authorizationInput: object
  ): Promise<Result<ChangeSet, UnifiedError>> {
    if (input.operations.length === 0) {
      return failure(
        "CHANGE_SET_OPERATION_INVALID",
        "An operation batch must contain at least one operation.",
        "Stage the complete operation group and retry."
      );
    }
    const toolCallIds = new Set<string>();
    for (const item of input.operations) {
      if (
        toolCallIds.has(item.toolCallId) ||
        item.toolCallId !== item.operation.toolCallIdempotencyKey
      ) {
        return failure(
          "CHANGE_SET_OPERATION_INVALID",
          "Operation batch idempotency keys must be unique and match their tool call IDs.",
          "Regenerate the complete operation group and retry."
        );
      }
      toolCallIds.add(item.toolCallId);
    }

    const checkpointKey = checkpointBindingKey(input);
    const activeId = activeChangeSetByCheckpoint.get(checkpointKey);
    try {
      let existing = activeId === undefined ? undefined : latestRevision(activeId);
      if (existing === undefined && options.port.readLatestChangeSet !== undefined) {
        const restored = await options.port.readLatestChangeSet({
          runId: input.runId,
          projectId: input.projectId,
          checkpointId: input.checkpointId
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
        (existing.runId !== input.runId ||
          existing.projectId !== input.projectId ||
          existing.checkpointId !== input.checkpointId ||
          existing.contextSnapshotId !== input.contextSnapshotId)
      ) {
        return failure(
          "CHANGE_SET_CONTEXT_MISMATCH",
          "The active Change Set is bound to a different checkpoint or context snapshot.",
          "Refresh context and create a new checkpoint proposal."
        );
      }

      const existingByToolCallId = new Map(
        (existing?.operations ?? []).map((operation) => [
          operation.toolCallIdempotencyKey,
          operation
        ])
      );
      const duplicateItems = input.operations.filter((item) =>
        existingByToolCallId.has(item.toolCallId)
      );
      if (duplicateItems.length > 0) {
        if (duplicateItems.length !== input.operations.length) {
          return failure(
            "CHANGE_SET_OPERATION_BATCH_INCOMPLETE",
            "The active Change Set contains only part of this operation batch.",
            "Discard the incomplete Change Set and regenerate the complete operation group."
          );
        }
        const collision = input.operations.find(
          (item) =>
            !sameOperationSemantics(
              existingByToolCallId.get(item.toolCallId) as ChangeSetOperation,
              item.operation
            )
        );
        if (collision !== undefined) {
          return failure(
            "CHANGE_SET_OPERATION_INVALID",
            "An operation idempotency key is already bound to a different operation.",
            "Regenerate the operation group with fresh stable IDs."
          );
        }
        return { ok: true, value: existing as ChangeSet };
      }

      for (const item of input.operations) {
        if (item.operation.kind !== "create_file") continue;
        const validation = await options.port.validateCandidate({
          runId: input.runId,
          projectId: input.projectId,
          checkpointId: input.checkpointId,
          relativePath: item.operation.relativePath,
          assetType: "text",
          candidateContent: item.operation.content
        });
        if (!validation.ok) return validation;
        const invalidCheck = [validation.value.schema, validation.value.asset].find(
          (check) => check?.status === "invalid"
        );
        if (invalidCheck !== undefined) {
          return failure(
            "CHANGE_SET_OPERATION_INVALID",
            invalidCheck.message ?? "The proposed file content failed project validation.",
            "Fix the proposed file content and retry."
          );
        }
      }

      const operations = input.operations.map((item) => item.operation);
      const writePolicy =
        operations.some(isDestructiveOperation) || input.writePolicy !== "user_preapproved_run"
          ? "write_before_confirmation"
          : consumeAgentRunProposalAuthorization(authorizationInput)
            ? "user_preapproved_run"
            : "write_before_confirmation";
      if (
        existing !== undefined &&
        (existing.writePolicy ?? "write_before_confirmation") !== writePolicy
      ) {
        return failure(
          "CHANGE_SET_CONTEXT_MISMATCH",
          "The active Change Set is bound to a different write policy.",
          "Create a new checkpoint before staging operations under another write policy."
        );
      }
      const revision =
        existing === undefined
          ? createOperationsChangeSetRevisionBatch({
              changeSetId: createChangeSetId(),
              runId: input.runId,
              projectId: input.projectId,
              checkpointId: input.checkpointId,
              contextSnapshotId: input.contextSnapshotId,
              writePolicy,
              operations,
              createdAt: now()
            })
          : appendChangeSetOperations(existing, { operations, createdAt: now() });
      const persisted = await options.port.persistChangeSet(revision);
      if (!persisted.ok) return persisted;
      rememberRevision(revision);
      activeChangeSetByCheckpoint.set(checkpointKey, revision.changeSetId);
      return { ok: true, value: revision };
    } catch (error) {
      return err(asUnifiedError(error));
    }
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

    async proposeStoryBibleWrite(input) {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.assetId)) {
        return failure(
          "CHANGE_SET_TARGET_INVALID",
          "A Story Bible proposal requires a stable asset ID.",
          "Select an existing Story Bible asset and retry the proposal."
        );
      }
      if (options.port.readStoryBibleTarget === undefined) {
        return failure(
          "CHANGE_SET_TARGET_UNAVAILABLE",
          "Story Bible Change Set staging is unavailable for this project.",
          "Open a creative project and retry the proposal."
        );
      }
      const target = await options.port.readStoryBibleTarget({
        projectId: input.projectId,
        assetId: input.assetId
      });
      if (!target.ok) return target;
      if (target.value.assetType !== "text" || target.value.assetId !== input.assetId) {
        return failure(
          "CHANGE_SET_TARGET_INVALID",
          "The Story Bible target did not match the requested asset ID.",
          "Refresh the Story Bible asset and retry."
        );
      }
      if (!input.repositoryPrepared && isStoryBibleV11Text(target.value.content)) {
        return failure(
          "STORY_BIBLE_STRUCTURED_TOOL_REQUIRED",
          "Story Bible v1.1 assets must be changed with a structured Story Bible tool.",
          "Read the current asset and use patch_story_bible or set_story_bible_status."
        );
      }
      return propose(input, target.value);
    },

    async proposeOperation(input) {
      return proposeOperationBatch(
        { ...input, operations: [{ toolCallId: input.toolCallId, operation: input.operation }] },
        input
      );
    },

    async proposeOperationBatch(input) {
      return proposeOperationBatch(input, input);
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
          {
            files: input.files,
            ...(input.operations === undefined ? {} : { operations: input.operations }),
            createdAt: now()
          },
          {
            validateCandidate: candidateValidator({
              runId: input.runId,
              projectId: input.projectId,
              checkpointId: current.value.checkpointId
            })
          }
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

    async readLatestChangeSet(input) {
      if (options.port.readLatestChangeSet === undefined) return ok(undefined);
      const restored = await options.port.readLatestChangeSet(input);
      if (!restored.ok) return restored;
      if (restored.value !== undefined) rememberRevision(restored.value);
      return restored;
    },

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
            {
              files: command.files,
              ...(command.operations === undefined ? {} : { operations: command.operations }),
              createdAt: now()
            },
            {
              validateCandidate: candidateValidator({
                runId: command.runId,
                projectId: command.projectId,
                checkpointId: current.value.checkpointId
              })
            }
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

function checkpointBindingKey(
  input: Pick<ChangeSetProposalBinding, "runId" | "projectId" | "checkpointId">
): string {
  return `${input.projectId}:${input.runId}:${input.checkpointId}`;
}

function isDestructiveOperation(operation: ChangeSetOperation): boolean {
  return (
    operation.kind === "move_file" ||
    operation.kind === "delete_file" ||
    operation.kind === "create_directory"
  );
}

function sameOperationSemantics(left: ChangeSetOperation, right: ChangeSetOperation): boolean {
  if (
    left.kind !== right.kind ||
    left.operationId !== right.operationId ||
    left.toolCallIdempotencyKey !== right.toolCallIdempotencyKey ||
    left.consistencyGroupId !== right.consistencyGroupId ||
    (left.selected ?? true) !== (right.selected ?? true) ||
    !sameStringSet(left.dependsOn, right.dependsOn)
  ) {
    return false;
  }
  switch (left.kind) {
    case "modify":
      return right.kind === "modify" && left.relativePath === right.relativePath;
    case "create_file":
      return (
        right.kind === "create_file" &&
        left.relativePath === right.relativePath &&
        left.content === right.content
      );
    case "move_file":
      return (
        right.kind === "move_file" &&
        left.sourcePath === right.sourcePath &&
        left.targetPath === right.targetPath &&
        left.sourceChecksum === right.sourceChecksum
      );
    case "delete_file":
      return (
        right.kind === "delete_file" &&
        left.relativePath === right.relativePath &&
        left.baseChecksum === right.baseChecksum
      );
    case "create_directory":
      return right.kind === "create_directory" && left.relativePath === right.relativePath;
  }
}

function sameStringSet(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined
): boolean {
  const sortedLeft = [...(left ?? [])].sort();
  const sortedRight = [...(right ?? [])].sort();
  return (
    sortedLeft.length === sortedRight.length &&
    sortedLeft.every((value, index) => value === sortedRight[index])
  );
}

function isStoryBibleV11Text(content: string): boolean {
  try {
    const parsed = JSON.parse(content) as unknown;
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      "schemaVersion" in parsed &&
      parsed.schemaVersion === "1.1"
    );
  } catch {
    return false;
  }
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
