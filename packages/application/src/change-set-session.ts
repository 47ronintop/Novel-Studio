import { randomUUID } from "node:crypto";

import {
  appendChangeSetProposal,
  appendChangeSetProposalV2,
  appendChangeSetProposalsV2,
  appendChangeSetOperations,
  appendChangeSetOperationsV2,
  buildApprovalDecisionProofRefV1,
  checksumChangeSetText,
  createChangeSetRevisionV2,
  createChangeSetRevisionBatchV2,
  createOperationsChangeSetRevisionV2,
  createChangeSetRevision,
  createOperationsChangeSetRevisionBatch,
  decideChangeSetApproval,
  decideChangeSetApprovalV2,
  isChangeSetV2,
  parseChangeSetV2,
  parseApprovalDecisionProofV1,
  selectChangeSetRevision,
  validateAgentRelativePath,
  type ApprovalDecisionProofRefV1,
  type ChangeSet,
  type ChangeSetApprovalV2,
  type ChangeSetLegacy,
  type ChangeSetV2,
  type ChangeSetV2DomainOperation,
  type ChangeSetApproval,
  type ChangeSetAssetType,
  type ChangeSetExternalValidation,
  type ChangeSetOperation,
  type ChangeSetOperationSelection,
  type ChangeSetRange,
  type ChangeSetFileSelection,
  type ChapterStatusTransitionProof,
  type DecideChangeSetCommand,
  type MainOnlyApprovalDecisionProofV1,
  type StoryBibleStatusTransitionProof,
  type AgentWritePolicy,
  type DecideChangeSetApprovalV2Input
} from "@novel-studio/agent-engine";
import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";
import {
  authorizeApprovalBindingV2,
  consumeAgentRunProposalAuthorization
} from "./agent-write-authorization.js";

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

/** Main-only immutable storage for approval proofs. It is not a Provider-facing port. */
export interface MainOnlyApprovalDecisionProofRepositoryPort {
  writeApprovalDecisionProof(
    runId: string,
    proof: MainOnlyApprovalDecisionProofV1
  ): Promise<Result<MainOnlyApprovalDecisionProofV1, UnifiedError>>;
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
  readonly approvalDecisionProofRepository?: MainOnlyApprovalDecisionProofRepositoryPort;
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
  readonly chapterStatusTransitionProof?: ChapterStatusTransitionProof;
}

export interface ProposeChapterWriteInput extends ChangeSetProposalBinding {
  readonly chapterId: string;
  readonly chapterStatusTransitionProof?: ChapterStatusTransitionProof;
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

/**
 * Ordinary workspace-file effects share one Change Set orchestration entry point. The
 * effect-specific target/operation validators remain in the existing methods below; this union
 * only prevents callers from creating parallel proposal sessions for each effect.
 */
export type ProposeWorkspaceFileMutationInput =
  | { readonly kind: "replace_file"; readonly file: ProposeFileWriteInput }
  | {
      readonly kind: "create_file" | "move_file" | "delete_file" | "create_directory";
      readonly operation: ProposeOperationInput;
    };

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

export interface ProposePreparedFileBatchInput {
  readonly runId: string;
  readonly projectId: string;
  readonly checkpointId: string;
  readonly contextSnapshotId: string;
  readonly writePolicy?: AgentWritePolicy;
  readonly consistencyGroupId: string;
  /** Main-owned lifecycle identity excluding the file selection derived below. */
  readonly domainOperation?: Omit<
    ChangeSetV2DomainOperation,
    "selectedRelativePaths" | "selectionChecksum"
  >;
  readonly files: readonly {
    readonly relativePath: string;
    readonly assetType: "chapter" | "text";
    readonly assetId: string;
    readonly baseContent: string;
    readonly candidateContent: string;
    readonly baseChecksum: string;
    readonly candidateChecksum: string;
    readonly chapterStatusTransitionProof?: ChapterStatusTransitionProof;
  }[];
}

export interface ChangeSetSession {
  /** Bind a frozen Catalog 2.0 semantic version set to exactly one run. Main-owned only. */
  bindRunProviderSemanticVersionSet(
    runId: string,
    providerSemanticVersionSetChecksum: string
  ): Result<void, UnifiedError>;
  proposeChapterWrite(input: ProposeChapterWriteInput): Promise<Result<ChangeSet, UnifiedError>>;
  proposeFileWrite(input: ProposeFileWriteInput): Promise<Result<ChangeSet, UnifiedError>>;
  proposeWorkspaceFileMutation?(
    input: ProposeWorkspaceFileMutationInput
  ): Promise<Result<ChangeSet, UnifiedError>>;
  proposeStoryBibleWrite(
    input: ProposeStoryBibleWriteInput
  ): Promise<Result<ChangeSet, UnifiedError>>;
  /** Task B.3 — stages a lifecycle operation (create/move/delete/mkdir) into the active Change Set. */
  proposeOperation(input: ProposeOperationInput): Promise<Result<ChangeSet, UnifiedError>>;
  /** Stages a complete lifecycle-operation group in one validated, persisted revision. */
  proposeOperationBatch(
    input: ProposeOperationBatchInput
  ): Promise<Result<ChangeSet, UnifiedError>>;
  /** Stages a repository-prepared full-document batch in one persisted revision. */
  proposePreparedFileBatch(
    input: ProposePreparedFileBatchInput
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
  /** Binds the immutable proof repository once from Desktop Main composition. */
  bindApprovalDecisionProofRepository(
    repository: MainOnlyApprovalDecisionProofRepositoryPort
  ): Result<void, UnifiedError>;
  /** Persists a Main-created proof only when it exactly binds to a frozen Change Set revision. */
  persistApprovalDecisionProof(input: {
    readonly changeSetId: string;
    readonly revision: number;
    readonly proof: MainOnlyApprovalDecisionProofV1;
  }): Promise<Result<ApprovalDecisionProofRefV1, UnifiedError>>;
  decide(
    command: DecideChangeSetCommand
  ): Promise<Result<ChangeSet | ChangeSetApproval, UnifiedError>>;
  decideV2(
    input: DecideChangeSetApprovalV2Input
  ): Promise<Result<ChangeSetApprovalV2, UnifiedError>>;
  /** A non-mutating v2 rejection deliberately has no approval binding or reservation. */
  rejectV2(input: {
    readonly changeSetId: string;
    readonly revision: number;
    readonly checksum: string;
    readonly displayBindingChecksum: string;
    readonly resolvedAt: string;
  }): Promise<Result<ChangeSetV2Rejection, UnifiedError>>;
}

export interface ChangeSetV2Rejection {
  readonly schemaVersion: "2.0";
  readonly decision: "reject_all";
  readonly resolvedAt: string;
  readonly displayBindingChecksum: string;
}

export interface CreateChangeSetSessionOptions {
  readonly port: ChangeSetSessionPort;
  readonly createChangeSetId?: () => string;
  readonly createHunkId?: () => string;
  readonly now?: () => string;
  /** Presence opts new proposals into strict Change Set 2.0 writing. */
  readonly providerSemanticVersionSetChecksum?: string;
  /** Main-owned issuer required before a v2 apply approval can cross the session boundary. */
  readonly approvalBindingIssuer?: object;
}

export function createChangeSetSession(options: CreateChangeSetSessionOptions): ChangeSetSession {
  const revisions = new Map<string, Map<number, ChangeSet>>();
  const activeChangeSetByCheckpoint = new Map<string, string>();
  const decisionReceipts = new Map<string, Result<ChangeSet | ChangeSetApproval, UnifiedError>>();
  let approvalDecisionProofRepository = options.port.approvalDecisionProofRepository;
  const providerSemanticVersionSetByRun = new Map<string, string>();
  const createChangeSetId =
    options.createChangeSetId ?? (() => `change_set_${randomUUID().replaceAll("-", "")}`);
  const now = options.now ?? (() => new Date().toISOString());

  function providerSemanticVersionSetForRun(
    runId: string
  ): Result<string | undefined, UnifiedError> {
    const value =
      providerSemanticVersionSetByRun.get(runId) ?? options.providerSemanticVersionSetChecksum;
    if (value === undefined) return ok(undefined);
    if (!/^[a-f0-9]{64}$/u.test(value)) {
      return failure(
        "CHANGE_SET_PROVIDER_VERSION_SET_INVALID",
        "The frozen Provider semantic version set is invalid.",
        "Recreate the Agent run from its current Main-owned catalog."
      );
    }
    return ok(value);
  }

  async function propose(
    binding: InternalChangeSetProposalBinding,
    target: ChangeSetProposalTarget
  ): Promise<Result<ChangeSet, UnifiedError>> {
    const targetError = validateTarget(target, binding.baseHash);
    if (targetError !== undefined) return err(targetError);
    const providerSemanticVersionSet = providerSemanticVersionSetForRun(binding.runId);
    if (!providerSemanticVersionSet.ok) return providerSemanticVersionSet;
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
        if (restored.value !== undefined) {
          const validated = validateStoredChangeSet(restored.value);
          if (!validated.ok) return validated;
          existing = validated.value;
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
      if (
        existing !== undefined &&
        providerSemanticVersionSet.value !== undefined &&
        (existing.schemaVersion !== "2.0" ||
          existing.providerSemanticVersionSetChecksum !== providerSemanticVersionSet.value)
      ) {
        return failure(
          "CHANGE_SET_PROVIDER_VERSION_SET_MISMATCH",
          "The active Change Set was created under a different frozen Provider semantic version set.",
          "Refresh the run and regenerate the proposal from the current catalog."
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
          : { storyBibleStatusProof: binding.storyBibleStatusProof }),
        ...(binding.chapterStatusTransitionProof === undefined
          ? {}
          : { chapterStatusTransitionProof: binding.chapterStatusTransitionProof })
      };
      const validateCandidate = candidateValidator(binding);
      const revisionOptions = {
        ...(options.createHunkId === undefined ? {} : { createHunkId: options.createHunkId }),
        validateCandidate
      };
      const revision =
        existing === undefined
          ? providerSemanticVersionSet.value === undefined
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
            : await createChangeSetRevisionV2(
                {
                  changeSetId: createChangeSetId(),
                  runId: binding.runId,
                  projectId: binding.projectId,
                  checkpointId: binding.checkpointId,
                  contextSnapshotId: binding.contextSnapshotId,
                  writePolicy,
                  proposal,
                  createdAt: now(),
                  providerSemanticVersionSetChecksum: providerSemanticVersionSet.value
                },
                revisionOptions
              )
          : existing.schemaVersion === "2.0"
            ? await appendChangeSetProposalV2(
                existing as ChangeSetV2,
                { proposal, createdAt: now() },
                revisionOptions
              )
            : await appendChangeSetProposal(
                existing as ChangeSetLegacy,
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
        const validated = validateStoredChangeSet(persisted.value);
        if (!validated.ok) return validated;
        rememberRevision(validated.value);
        return validated;
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
    const providerSemanticVersionSet = providerSemanticVersionSetForRun(input.runId);
    if (!providerSemanticVersionSet.ok) return providerSemanticVersionSet;
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
        if (restored.value !== undefined) {
          const validated = validateStoredChangeSet(restored.value);
          if (!validated.ok) return validated;
          existing = validated.value;
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
      if (
        existing !== undefined &&
        providerSemanticVersionSet.value !== undefined &&
        (existing.schemaVersion !== "2.0" ||
          existing.providerSemanticVersionSetChecksum !== providerSemanticVersionSet.value)
      ) {
        return failure(
          "CHANGE_SET_PROVIDER_VERSION_SET_MISMATCH",
          "The active Change Set was created under a different frozen Provider semantic version set.",
          "Refresh the run and regenerate the proposal from the current catalog."
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
          ? providerSemanticVersionSet.value === undefined
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
            : createOperationsChangeSetRevisionV2({
                changeSetId: createChangeSetId(),
                runId: input.runId,
                projectId: input.projectId,
                checkpointId: input.checkpointId,
                contextSnapshotId: input.contextSnapshotId,
                writePolicy,
                operations,
                createdAt: now(),
                providerSemanticVersionSetChecksum: providerSemanticVersionSet.value
              })
          : existing.schemaVersion === "2.0"
            ? appendChangeSetOperationsV2(existing as ChangeSetV2, { operations, createdAt: now() })
            : appendChangeSetOperations(existing as ChangeSetLegacy, {
                operations,
                createdAt: now()
              });
      const persisted = await options.port.persistChangeSet(revision);
      if (!persisted.ok) return persisted;
      rememberRevision(revision);
      activeChangeSetByCheckpoint.set(checkpointKey, revision.changeSetId);
      return { ok: true, value: revision };
    } catch (error) {
      return err(asUnifiedError(error));
    }
  }

  async function proposePreparedFileBatch(
    input: ProposePreparedFileBatchInput
  ): Promise<Result<ChangeSet, UnifiedError>> {
    const providerSemanticVersionSet = providerSemanticVersionSetForRun(input.runId);
    if (!providerSemanticVersionSet.ok) return providerSemanticVersionSet;
    if (providerSemanticVersionSet.value === undefined) {
      return failure(
        "CHANGE_SET_V2_REQUIRED",
        "Prepared chapter migrations require Change Set 2.0.",
        "Recreate the Agent run with Approval Binding 2.0 available."
      );
    }
    if (!/^[A-Za-z0-9_-]{1,128}$/u.test(input.consistencyGroupId)) {
      return failure(
        "CHANGE_SET_CONSISTENCY_GROUP_INVALID",
        "The prepared-file batch requires a stable consistency group.",
        "Regenerate the migration preview and retry."
      );
    }
    if (input.files.length === 0) {
      return failure(
        "CHANGE_SET_PREPARED_BATCH_INVALID",
        "A prepared-file batch must contain at least one file.",
        "Regenerate the complete migration plan and retry."
      );
    }

    const paths = new Set<string>();
    const assetIds = new Set<string>();
    for (const file of input.files) {
      const path = validateAgentRelativePath(file.relativePath);
      if (!path.ok) return path;
      const isChapterFile =
        file.assetType === "chapter" && path.value.relativePath === `chapters/${file.assetId}.md`;
      const isOutlineFile =
        file.assetType === "text" &&
        file.assetId === "outline_main" &&
        path.value.relativePath === "outline/outline.json" &&
        file.chapterStatusTransitionProof === undefined;
      if (
        !/^[A-Za-z0-9_-]{1,128}$/u.test(file.assetId) ||
        (!isChapterFile && !isOutlineFile) ||
        paths.has(path.value.relativePath) ||
        assetIds.has(file.assetId) ||
        file.baseContent.length === 0 ||
        checksumChangeSetText(file.baseContent) !== file.baseChecksum ||
        checksumChangeSetText(file.candidateContent) !== file.candidateChecksum
      ) {
        return failure(
          "CHANGE_SET_PREPARED_BATCH_INVALID",
          "The prepared writing-domain batch is malformed or stale.",
          "Regenerate the complete domain proposal and retry."
        );
      }
      paths.add(path.value.relativePath);
      assetIds.add(file.assetId);
    }

    const lifecycleDomainOperation =
      input.domainOperation === undefined
        ? undefined
        : {
            ...input.domainOperation,
            selectedRelativePaths: input.files.map((file) => file.relativePath),
            selectionChecksum: checksumChangeSetText(
              input.files.map((file) => file.relativePath).join("\n")
            )
          };
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
        if (restored.value !== undefined) {
          const validated = validateStoredChangeSet(restored.value);
          if (!validated.ok) return validated;
          existing = validated.value;
          rememberRevision(existing);
          activeChangeSetByCheckpoint.set(checkpointKey, existing.changeSetId);
        }
      }
      if (
        existing !== undefined &&
        (existing.schemaVersion !== "2.0" ||
          existing.providerSemanticVersionSetChecksum !== providerSemanticVersionSet.value ||
          existing.runId !== input.runId ||
          existing.projectId !== input.projectId ||
          existing.checkpointId !== input.checkpointId ||
          existing.contextSnapshotId !== input.contextSnapshotId ||
          (existing.writePolicy ?? "write_before_confirmation") !== "write_before_confirmation")
      ) {
        return failure(
          "CHANGE_SET_CONTEXT_MISMATCH",
          "The active Change Set is not a compatible 2.0 migration proposal.",
          "Create a new checkpoint and regenerate the migration plan."
        );
      }
      if (
        existing !== undefined &&
        ((existing as ChangeSetV2).domainOperation !== undefined ||
          lifecycleDomainOperation !== undefined) &&
        !sameLifecycleDomainOperation(existing as ChangeSetV2, lifecycleDomainOperation)
      ) {
        return failure(
          "CHANGE_SET_PREPARED_BATCH_CONTEXT_CONFLICT",
          "A frozen lifecycle Change Set cannot be combined with another prepared mutation.",
          "Approve, reject, or create a new checkpoint before preparing another lifecycle change."
        );
      }

      const existingGroup =
        existing?.files.filter((file) => file.consistencyGroupId === input.consistencyGroupId) ??
        [];
      if (existingGroup.length > 0) {
        if (
          (((existing as ChangeSetV2).domainOperation !== undefined ||
            lifecycleDomainOperation !== undefined) &&
            !sameLifecycleDomainOperation(existing as ChangeSetV2, lifecycleDomainOperation)) ||
          existingGroup.length !== input.files.length ||
          input.files.some((file) => {
            const current = existingGroup.find(
              (candidate) => candidate.relativePath === file.relativePath
            );
            return (
              current === undefined ||
              current.assetType !== file.assetType ||
              current.assetId !== file.assetId ||
              current.contentMode !==
                (file.assetType === "chapter" ? "serialized_chapter" : undefined) ||
              current.baseChecksum !== file.baseChecksum ||
              current.candidateChecksum !== file.candidateChecksum ||
              current.baseContent !== file.baseContent ||
              current.candidateContent !== file.candidateContent ||
              current.chapterStatusTransitionProof?.proofChecksum !==
                file.chapterStatusTransitionProof?.proofChecksum
            );
          })
        ) {
          return failure(
            "CHANGE_SET_PREPARED_BATCH_INCOMPLETE",
            "The active Change Set contains a partial or different migration batch.",
            "Discard the incomplete Change Set and regenerate the complete migration plan."
          );
        }
        return ok(existing as ChangeSet);
      }

      const proposals = input.files.map((file) => ({
        relativePath: file.relativePath,
        assetType: file.assetType,
        ...(file.assetType === "chapter" ? { contentMode: "serialized_chapter" as const } : {}),
        assetId: file.assetId,
        baseContent: file.baseContent,
        baseChecksum: file.baseChecksum,
        range: { unit: "character" as const, start: 0, end: file.baseContent.length },
        replacement: file.candidateContent,
        consistencyGroupId: input.consistencyGroupId,
        ...(file.chapterStatusTransitionProof === undefined
          ? {}
          : { chapterStatusTransitionProof: file.chapterStatusTransitionProof })
      }));
      const revisionOptions = {
        ...(options.createHunkId === undefined ? {} : { createHunkId: options.createHunkId }),
        validateCandidate: candidateValidator(input)
      };
      const revision =
        existing === undefined
          ? await createChangeSetRevisionBatchV2(
              {
                changeSetId: createChangeSetId(),
                runId: input.runId,
                projectId: input.projectId,
                checkpointId: input.checkpointId,
                contextSnapshotId: input.contextSnapshotId,
                writePolicy: "write_before_confirmation",
                proposals,
                createdAt: now(),
                providerSemanticVersionSetChecksum: providerSemanticVersionSet.value,
                ...(lifecycleDomainOperation === undefined
                  ? {}
                  : { domainOperation: lifecycleDomainOperation })
              },
              revisionOptions
            )
          : await appendChangeSetProposalsV2(
              existing as ChangeSetV2,
              { proposals, createdAt: now() },
              revisionOptions
            );
      const persisted = await options.port.persistChangeSet(revision);
      if (!persisted.ok) return persisted;
      rememberRevision(revision);
      activeChangeSetByCheckpoint.set(checkpointKey, revision.changeSetId);
      return ok(revision);
    } catch (error) {
      return err(asUnifiedError(error));
    }
  }

  return {
    bindRunProviderSemanticVersionSet(runId, providerSemanticVersionSetChecksum) {
      if (
        !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(runId) ||
        !/^[a-f0-9]{64}$/u.test(providerSemanticVersionSetChecksum)
      ) {
        return failure(
          "CHANGE_SET_PROVIDER_VERSION_SET_INVALID",
          "The Run or frozen Provider semantic version set is invalid.",
          "Recreate the Agent run from its current Main-owned catalog."
        );
      }
      const existing = providerSemanticVersionSetByRun.get(runId);
      if (existing !== undefined && existing !== providerSemanticVersionSetChecksum) {
        return failure(
          "CHANGE_SET_PROVIDER_VERSION_SET_REBIND_FORBIDDEN",
          "A Run cannot be rebound to a different frozen Provider semantic version set.",
          "Start a new Agent run after the catalog or capability boundary changes."
        );
      }
      providerSemanticVersionSetByRun.set(runId, providerSemanticVersionSetChecksum);
      return ok(undefined);
    },
    bindApprovalDecisionProofRepository(repository) {
      if (
        repository === null ||
        typeof repository !== "object" ||
        typeof repository.writeApprovalDecisionProof !== "function"
      ) {
        return failure(
          "APPROVAL_DECISION_PROOF_REPOSITORY_INVALID",
          "Approval proof storage is invalid.",
          "Recreate the Main Change Set session before staging a proposal."
        );
      }
      if (approvalDecisionProofRepository !== undefined) {
        return failure(
          "APPROVAL_DECISION_PROOF_REPOSITORY_ALREADY_BOUND",
          "Approval proof storage is already bound to this Change Set session.",
          "Create a new Main Change Set session for another workspace."
        );
      }
      approvalDecisionProofRepository = repository;
      return ok(undefined);
    },

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

    async proposeWorkspaceFileMutation(input) {
      if (input.kind === "replace_file") {
        return this.proposeFileWrite(input.file);
      }
      if (input.operation.operation.kind !== input.kind) {
        return failure(
          "CHANGE_SET_OPERATION_KIND_MISMATCH",
          "The workspace file mutation effect did not match its Change Set operation.",
          "Refresh the proposal and retry the same operation."
        );
      }
      return this.proposeOperation(input.operation);
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

    proposePreparedFileBatch,

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
      if (restored.value === undefined) return restored;
      const validated = validateStoredChangeSet(restored.value);
      if (!validated.ok) return validated;
      rememberRevision(validated.value);
      return validated;
    },

    async persistApprovalDecisionProof(input) {
      const repository = approvalDecisionProofRepository;
      if (repository === undefined) {
        return failure(
          "APPROVAL_DECISION_PROOF_REPOSITORY_UNAVAILABLE",
          "Approval proof storage is unavailable for this Change Set.",
          "Regenerate the proposal after Main proof storage is available."
        );
      }
      const current = await findRevision(input.changeSetId, input.revision);
      if (!current.ok) return current;

      let proof: MainOnlyApprovalDecisionProofV1;
      try {
        proof = parseApprovalDecisionProofV1(input.proof);
      } catch {
        return failure(
          "APPROVAL_DECISION_PROOF_INVALID",
          "The approval decision proof is invalid.",
          "Regenerate the frozen proposal and its approval proof."
        );
      }
      if (!isApprovalDecisionProofBoundToChangeSet(proof, current.value)) {
        return failure(
          "APPROVAL_DECISION_PROOF_BINDING_MISMATCH",
          "The approval decision proof does not match the frozen Change Set.",
          "Regenerate the proposal and its approval proof."
        );
      }

      try {
        const persisted = await repository.writeApprovalDecisionProof(proof.binding.runId, proof);
        if (!persisted.ok) return persisted;
        let storedProof: MainOnlyApprovalDecisionProofV1;
        try {
          storedProof = parseApprovalDecisionProofV1(persisted.value);
        } catch {
          return failure(
            "APPROVAL_DECISION_PROOF_INVALID",
            "The stored approval decision proof is invalid.",
            "Regenerate the frozen proposal and its approval proof."
          );
        }
        if (!isApprovalDecisionProofBoundToChangeSet(storedProof, current.value)) {
          return failure(
            "APPROVAL_DECISION_PROOF_BINDING_MISMATCH",
            "The stored approval decision proof does not match the frozen Change Set.",
            "Regenerate the proposal and its approval proof."
          );
        }
        return ok(buildApprovalDecisionProofRefV1(storedProof));
      } catch (error) {
        return err(asUnifiedError(error));
      }
    },

    async decideV2(input) {
      const current = await findRevision(input.changeSet.changeSetId, input.changeSet.revision);
      if (!current.ok) return current as Result<ChangeSetApprovalV2, UnifiedError>;
      if (current.value.schemaVersion !== "2.0") {
        return failure(
          "CHANGE_SET_V2_REQUIRED",
          "Legacy Change Sets cannot enter the v2 approval gate.",
          "Regenerate the proposal with Change Set 2.0."
        );
      }
      const decided = decideChangeSetApprovalV2({
        ...input,
        changeSet: current.value as ChangeSetV2
      });
      if (!decided.ok || decided.value.decision !== "apply_selected") return decided;
      if (options.approvalBindingIssuer === undefined) {
        return failure(
          "CHANGE_SET_MAIN_APPROVAL_ISSUER_UNAVAILABLE",
          "A v2 approval requires the Main-owned approval coordinator.",
          "Complete approval in the qualified Main confirmation surface."
        );
      }
      try {
        authorizeApprovalBindingV2(decided.value.binding, options.approvalBindingIssuer);
      } catch {
        return failure(
          "CHANGE_SET_MAIN_APPROVAL_ISSUER_UNAVAILABLE",
          "The Main-owned approval coordinator is unavailable.",
          "Complete approval in the qualified Main confirmation surface."
        );
      }
      return decided;
    },

    async rejectV2(input) {
      const current = await findRevision(input.changeSetId, input.revision);
      if (!current.ok) return current as Result<ChangeSetV2Rejection, UnifiedError>;
      if (
        current.value.schemaVersion !== "2.0" ||
        current.value.checksum !== input.checksum ||
        current.value.displayBindingChecksum !== input.displayBindingChecksum
      ) {
        return failure(
          "CHANGE_SET_V2_BINDING_MISMATCH",
          "The rejection does not match the current Change Set 2.0 preview.",
          "Refresh the preview before rejecting it."
        );
      }
      return ok(
        Object.freeze({
          schemaVersion: "2.0" as const,
          decision: "reject_all" as const,
          resolvedAt: input.resolvedAt,
          displayBindingChecksum: input.displayBindingChecksum
        })
      );
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

function isApprovalDecisionProofBoundToChangeSet(
  proof: MainOnlyApprovalDecisionProofV1,
  changeSet: ChangeSet
): boolean {
  return (
    proof.binding.runId === changeSet.runId &&
    proof.binding.changeSetId === changeSet.changeSetId &&
    proof.binding.changeSetRevision === changeSet.revision &&
    proof.binding.changeSetChecksum === changeSet.checksum &&
    proof.binding.executionWritePolicy === (changeSet.writePolicy ?? "write_before_confirmation")
  );
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

function sameLifecycleDomainOperation(
  changeSet: ChangeSetV2 | undefined,
  candidate:
    | (Omit<ChangeSetV2DomainOperation, "selectedRelativePaths" | "selectionChecksum"> & {
        readonly selectedRelativePaths: readonly string[];
        readonly selectionChecksum: string;
      })
    | undefined
): boolean {
  const existing = changeSet?.domainOperation;
  return (
    existing !== undefined &&
    candidate !== undefined &&
    existing.kind === candidate.kind &&
    existing.sourceRef === candidate.sourceRef &&
    existing.targetRef === candidate.targetRef &&
    existing.proofRef === candidate.proofRef &&
    existing.proofChecksum === candidate.proofChecksum &&
    existing.selectionChecksum === candidate.selectionChecksum &&
    existing.selectedRelativePaths.length === candidate.selectedRelativePaths.length &&
    existing.selectedRelativePaths.every(
      (path, index) => path === candidate.selectedRelativePaths[index]
    )
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

function validateStoredChangeSet(value: ChangeSet): Result<ChangeSet, UnifiedError> {
  const record = value as unknown as Record<string, unknown>;
  if (record["schemaVersion"] === "2.0") {
    if (!isChangeSetV2(value)) {
      return failure(
        "CHANGE_SET_V2_INVALID",
        "The stored Change Set 2.0 failed strict validation.",
        "Regenerate the proposal from the current runtime facts."
      );
    }
    try {
      return ok(parseChangeSetV2(value));
    } catch {
      return failure(
        "CHANGE_SET_V2_INVALID",
        "The stored Change Set 2.0 failed strict validation.",
        "Regenerate the proposal from the current runtime facts."
      );
    }
  }
  if (
    (record["schemaVersion"] === "1.0" || record["schemaVersion"] === "1.1") &&
    typeof record["approvalToken"] === "string"
  ) {
    return ok(value);
  }
  return failure(
    "CHANGE_SET_SCHEMA_UNSUPPORTED",
    "The stored Change Set uses an unsupported or incomplete schema.",
    "Rebuild the proposal with a supported Change Set version."
  );
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
