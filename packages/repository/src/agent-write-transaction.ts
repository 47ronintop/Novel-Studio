import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { extname, isAbsolute, join, relative } from "node:path";

import { err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import { storageError, validationError } from "./errors.js";
import type {
  AgentTransactionJournal,
  AgentTransactionJournalEntry,
  AgentTransactionJournalMutationRecord,
  AgentTransactionJournalOperationEntry,
  AgentTransactionJournalKind,
  AgentTransactionJournalStatus,
  AgentOperationPathSnapshot,
  AgentWriteHistoryPort,
  AgentWriteAssetType,
  AgentWriteProjectLockPort,
  AgentWriteRecoveryPort,
  RollbackReviewDecisionRecord,
  RollbackReviewFileRecord,
  RollbackReviewRecord,
  AgentWriteTransactionFile,
  AgentWriteTransactionInput,
  AgentWriteTransactionOperation,
  SnapshotReason,
  VersionGroupBaselineRecord,
  VersionGroupFailureKind,
  VersionGroupRecord,
  VersionGroupOperationRecord,
  VersionGroupTransactionStatus,
  VersionGroupWriteRecord
} from "./ports.js";

export interface AgentWriteReplaceInput {
  readonly phase: "apply" | "compensate" | "undo";
  readonly targetPath: string;
  readonly relativePath: string;
  readonly content: string;
  readonly verifyImmediatelyBeforeReplace: () => Promise<Result<void, UnifiedError>>;
}

/**
 * Boundary for lifecycle mutations. Implementations must use descriptor/handle
 * traversal below the project root, must not follow symlinks or Windows reparse
 * points, and must atomically enforce the supplied before/after snapshots.
 *
 * Node's pathname APIs cannot provide this guarantee, so this port is required
 * for text replacement and create/move/delete/mkdir operations. It deliberately
 * has no Node fallback.
 */
export interface AgentWriteLifecycleOperationPort {
  mutate(input: AgentWriteLifecycleMutation): Promise<Result<void, UnifiedError>>;
}

export type AgentWriteLifecycleMutation =
  | {
      /** Atomic no-follow replacement of an existing text asset. */
      readonly kind: "replace_file";
      readonly phase: "apply" | "compensate" | "undo";
      readonly relativePath: string;
      readonly content: string;
      readonly before: readonly AgentOperationPathSnapshot[];
      readonly after: readonly AgentOperationPathSnapshot[];
    }
  | {
      readonly kind: "create_file";
      readonly relativePath: string;
      readonly content: string;
      readonly before: readonly AgentOperationPathSnapshot[];
      readonly after: readonly AgentOperationPathSnapshot[];
    }
  | {
      readonly kind: "move_file";
      readonly sourcePath: string;
      readonly targetPath: string;
      readonly before: readonly AgentOperationPathSnapshot[];
      readonly after: readonly AgentOperationPathSnapshot[];
    }
  | {
      readonly kind: "delete_file";
      readonly relativePath: string;
      readonly before: readonly AgentOperationPathSnapshot[];
      readonly after: readonly AgentOperationPathSnapshot[];
    }
  | {
      readonly kind: "create_directory" | "remove_directory";
      readonly relativePath: string;
      readonly before: readonly AgentOperationPathSnapshot[];
      readonly after: readonly AgentOperationPathSnapshot[];
    };

export interface AgentWriteTransactionOptions {
  readonly projectRoot: string;
  readonly projectLock: AgentWriteProjectLockPort;
  readonly historyRepository: AgentWriteHistoryPort;
  readonly recoveryRepository: AgentWriteRecoveryPort;
  readonly now?: () => string;
  readonly createTransactionId?: () => string;
  readonly createVersionGroupId?: () => string;
  readonly createWriteId?: () => string;
  /**
   * Test-only verifier/fault hook. It never performs the mutation itself;
   * production writes must always flow through lifecycleOperations.
   */
  readonly replaceFile?: (input: AgentWriteReplaceInput) => Promise<Result<void, UnifiedError>>;
  readonly allowUnsafeReplaceFileForTesting?: boolean;
  readonly lifecycleOperations?: AgentWriteLifecycleOperationPort;
  readonly traceId?: string;
}

interface PreparedFile extends AgentWriteTransactionFile {
  readonly targetPath: string;
  readonly writeId: string;
  readonly beforeVersionId: string;
}

interface PreparedOperation {
  readonly operation: AgentWriteTransactionOperation;
  readonly before: readonly AgentOperationPathSnapshot[];
  readonly after: readonly AgentOperationPathSnapshot[];
  readonly beforeVersionId?: string;
}

interface ExecuteTransactionOptions {
  readonly kind: AgentTransactionJournalKind;
  readonly snapshotReason: SnapshotReason;
  readonly undoOfVersionGroupIds?: readonly string[];
}

type AgentUndoTransactionInput = Omit<
  AgentWriteTransactionInput,
  "writePolicy" | "approvalSource" | "approvalToken"
>;
type TransactionExecutionInput = AgentWriteTransactionInput | AgentUndoTransactionInput;

interface UndoSource {
  readonly journals: readonly AgentTransactionJournal[];
  readonly files: readonly AgentWriteTransactionFile[];
  readonly operations: readonly AgentWriteTransactionOperation[];
  readonly steps: readonly UndoMutationStep[];
  readonly baselineByPath: Readonly<Record<string, VersionGroupBaselineRecord>>;
  readonly versionGroupIds: readonly string[];
}

interface UndoWriteStep {
  readonly kind: "write";
  readonly writeId: string;
  readonly source: AgentTransactionJournalEntry;
  readonly before: readonly AgentOperationPathSnapshot[];
  readonly after: readonly AgentOperationPathSnapshot[];
}

interface UndoOperationStep {
  readonly kind: "operation";
  readonly operationId: string;
  readonly operation: AgentWriteTransactionOperation;
  readonly before: readonly AgentOperationPathSnapshot[];
  readonly after: readonly AgentOperationPathSnapshot[];
  readonly source: AgentTransactionJournalOperationEntry;
}

type UndoMutationStep = UndoWriteStep | UndoOperationStep;

const allowedExtensions = new Set([".md", ".txt", ".json", ".yaml", ".yml", ".toml", ".ts"]);
const blockedRoots = new Set([
  ".git",
  ".novel-studio",
  "node_modules",
  "history",
  "dist",
  "build",
  ".cache"
]);
const windowsDeviceNames = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const sha256Pattern = /^[a-f0-9]{64}$/;

export class AgentWriteTransaction {
  private readonly now: () => string;
  private readonly createTransactionId: () => string;
  private readonly createVersionGroupId: () => string;
  private readonly createWriteId: () => string;
  private readonly traceId: string;
  private readonly canonicalRoot: Promise<string>;
  private transactionActive = false;

  public constructor(private readonly options: AgentWriteTransactionOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.createTransactionId =
      options.createTransactionId ?? (() => `tx_${randomUUID().replaceAll("-", "")}`);
    this.createVersionGroupId =
      options.createVersionGroupId ?? (() => `vg_${randomUUID().replaceAll("-", "")}`);
    this.createWriteId =
      options.createWriteId ?? (() => `write_${randomUUID().replaceAll("-", "")}`);
    this.traceId = options.traceId ?? "trace_agent_write_transaction";
    this.canonicalRoot = realpath(options.projectRoot);
  }

  public async apply(
    input: AgentWriteTransactionInput
  ): Promise<Result<VersionGroupRecord, UnifiedError>> {
    return this.exclusive(async () => {
      const lock = await this.options.projectLock.verifyProjectLockOwnership();
      if (!lock.ok) return lock;
      return this.executeTransaction(input, {
        kind: "apply",
        snapshotReason: "before-agent-write"
      });
    });
  }

  public async recoverIncompleteTransactions(): Promise<
    Result<readonly VersionGroupRecord[], UnifiedError>
  > {
    return this.exclusive(async () => {
      const lock = await this.options.projectLock.verifyProjectLockOwnership();
      if (!lock.ok) return lock;
      const listed = await this.options.recoveryRepository.listAgentTransactionJournals();
      if (!listed.ok) return listed;

      const recovered: VersionGroupRecord[] = [];
      for (const journal of listed.value.filter(isIncompleteJournal)) {
        const result = await this.resumeCompensation(journal);
        if (!result.ok) return result;
        recovered.push(result.value);
      }
      return ok(recovered);
    });
  }

  public async listIncompleteTransactionPaths(): Promise<Result<readonly string[], UnifiedError>> {
    const listed = await this.options.recoveryRepository.listAgentTransactionJournals();
    if (!listed.ok) return listed;
    return ok([
      ...new Set(
        listed.value
          .filter(isIncompleteJournal)
          .flatMap((journal) => [
            ...journal.entries.map((entry) => entry.relativePath),
            ...(journal.operations ?? []).flatMap((entry) => operationPaths(entry.operation))
          ])
      )
    ]);
  }

  public async undoVersionGroup(input: {
    readonly versionGroupId: string;
  }): Promise<Result<VersionGroupRecord, UnifiedError>> {
    return this.exclusive(async () => {
      const lock = await this.options.projectLock.verifyProjectLockOwnership();
      if (!lock.ok) return lock;
      const journals = await this.options.recoveryRepository.listAgentTransactionJournals();
      if (!journals.ok) return journals;
      const source = journals.value.find(
        (journal) =>
          journal.kind === "apply" &&
          journal.versionGroupId === input.versionGroupId &&
          journal.transactionStatus === "applied"
      );
      if (source === undefined) {
        return err(this.error("AGENT_WRITE_VERSION_GROUP_NOT_FOUND", "validation"));
      }
      return this.performUndo(this.buildUndoSource([source]), "version_group_undo");
    });
  }

  public async undoWrite(input: {
    readonly versionGroupId: string;
    readonly writeId: string;
  }): Promise<Result<VersionGroupRecord, UnifiedError>> {
    return this.exclusive(async () => {
      const lock = await this.options.projectLock.verifyProjectLockOwnership();
      if (!lock.ok) return lock;
      const journals = await this.options.recoveryRepository.listAgentTransactionJournals();
      if (!journals.ok) return journals;
      const source = journals.value.find(
        (journal) =>
          journal.kind === "apply" &&
          journal.versionGroupId === input.versionGroupId &&
          journal.transactionStatus === "applied"
      );
      const entry = source?.entries.find((candidate) => candidate.writeId === input.writeId);
      if (source === undefined || entry === undefined) {
        return err(this.error("AGENT_WRITE_VERSION_NOT_FOUND", "validation"));
      }
      const textOnlySource = { ...source };
      delete textOnlySource.operations;
      return this.performUndo(
        this.buildUndoSource([
          freezeJournal({
            ...textOnlySource,
            entries: [entry],
            mutationOrder: [{ kind: "write", id: entry.writeId }]
          })
        ]),
        "version_group_undo"
      );
    });
  }

  public async undoRun(input: {
    readonly runId: string;
    readonly commandId?: string;
    readonly reviewId?: string;
    readonly currentEditorContents?: readonly {
      readonly relativePath: string;
      readonly content: string;
    }[];
    readonly decisions?: readonly {
      readonly relativePath: string;
      readonly decision: RollbackReviewDecisionRecord;
    }[];
    readonly retryFailedOnly?: boolean;
  }): Promise<Result<VersionGroupRecord, UnifiedError>> {
    return this.exclusive(async () => {
      const lock = await this.options.projectLock.verifyProjectLockOwnership();
      if (!lock.ok) return lock;
      const journals = await this.options.recoveryRepository.listAgentTransactionJournals();
      if (!journals.ok) return journals;
      const sources = journals.value.filter(
        (journal) =>
          journal.kind === "apply" &&
          journal.runId === input.runId &&
          journal.transactionStatus === "applied"
      );
      const currentEditorContents = new Map(
        (input.currentEditorContents ?? []).map((entry) => [entry.relativePath, entry.content])
      );
      if (
        currentEditorContents.size !== (input.currentEditorContents ?? []).length ||
        [...currentEditorContents.keys()].some(
          (relativePath) => !validateRelativeTarget(relativePath).ok
        )
      ) {
        return err(this.error("AGENT_WRITE_ROLLBACK_REVIEW_INVALID", "validation"));
      }
      const existingReview = await this.readRollbackReview(input.runId);
      if (!existingReview.ok) return existingReview;
      if (existingReview.value !== undefined) {
        if (
          sources.length === 0 ||
          !rollbackReviewBoundToSource(existingReview.value, this.buildUndoSource(sources))
        ) {
          return err(this.error("AGENT_WRITE_ROLLBACK_REVIEW_INVALID", "validation"));
        }
        if (input.reviewId !== undefined && input.reviewId !== existingReview.value.reviewId) {
          return err(this.error("AGENT_WRITE_ROLLBACK_REVIEW_STALE", "validation"));
        }
        if (
          input.commandId !== undefined &&
          existingReview.value.processedCommandIds.includes(input.commandId)
        ) {
          return ok(this.groupFromRollbackReview(existingReview.value));
        }
        const resolved = await this.resolveRollbackReview(
          existingReview.value,
          input,
          currentEditorContents
        );
        if (!resolved.ok) return resolved;
        return this.finalizeRollbackReview(
          resolved.value,
          this.buildUndoSource(sources),
          currentEditorContents,
          input.commandId
        );
      }
      if (sources.length === 0) {
        return err(this.error("AGENT_WRITE_RUN_NOT_FOUND", "validation"));
      }
      const source = this.buildUndoSource(sources);
      if (
        [...currentEditorContents.keys()].some(
          (path) => !source.files.some((file) => file.relativePath === path)
        )
      ) {
        return err(this.error("AGENT_WRITE_ROLLBACK_REVIEW_INVALID", "validation"));
      }
      if (currentEditorContents.size === 0) {
        const transactional = await this.performUndo(source, "run_undo");
        if (!transactional.ok || transactional.value.undoStatus !== "conflict") {
          return transactional;
        }
      }
      const review = await this.createRollbackReview(source, currentEditorContents);
      if (!review.ok) return review;
      return this.finalizeRollbackReview(
        review.value,
        source,
        currentEditorContents,
        input.commandId
      );
    });
  }

  private async resolveRollbackReview(
    source: RollbackReviewRecord,
    input: {
      readonly commandId?: string;
      readonly reviewId?: string;
      readonly decisions?: readonly {
        readonly relativePath: string;
        readonly decision: RollbackReviewDecisionRecord;
      }[];
      readonly retryFailedOnly?: boolean;
    },
    currentEditorContents: ReadonlyMap<string, string>
  ): Promise<Result<RollbackReviewRecord, UnifiedError>> {
    let review = source;
    const decisions = input.decisions ?? [];
    if (new Set(decisions.map((decision) => decision.relativePath)).size !== decisions.length) {
      return err(this.error("AGENT_WRITE_ROLLBACK_REVIEW_INVALID", "validation"));
    }
    for (const resolution of decisions) {
      const file = review.files.find(
        (candidate) => candidate.relativePath === resolution.relativePath
      );
      if (file === undefined || file.status === "completed" || file.status === "kept") {
        return err(
          this.error("AGENT_WRITE_ROLLBACK_REVIEW_INVALID", "validation", resolution.relativePath)
        );
      }
      const current = await this.readSafeTarget(file.relativePath);
      if (!current.ok) return current;
      const editorContent = currentEditorContents.get(file.relativePath);
      if (!rollbackCurrentMatches(file, current.value.checksum, editorContent)) {
        review = replaceRollbackReviewFile(
          review,
          staleRollbackFile(file, current.value.content, current.value.checksum, editorContent),
          this.now()
        );
        continue;
      }
      review = replaceRollbackReviewFile(
        review,
        resolvedRollbackFile(file, resolution.decision),
        this.now()
      );
    }

    if (input.retryFailedOnly === true) {
      for (const file of review.files.filter((candidate) => candidate.status === "failed")) {
        if (file.decision !== "restore_baseline") continue;
        const current = await this.readSafeTarget(file.relativePath);
        if (!current.ok) return current;
        const editorContent = currentEditorContents.get(file.relativePath);
        review = replaceRollbackReviewFile(
          review,
          rollbackCurrentMatches(file, current.value.checksum, editorContent)
            ? resolvedRollbackFile(file, "restore_baseline")
            : staleRollbackFile(file, current.value.content, current.value.checksum, editorContent),
          this.now()
        );
      }
    }

    review = withRollbackReviewStatus(review, this.now());
    const persisted = await this.persistRollbackReview(review);
    if (!persisted.ok) return persisted;
    return ok(persisted.value);
  }

  private async finalizeRollbackReview(
    review: RollbackReviewRecord,
    source: UndoSource,
    currentEditorContents: ReadonlyMap<string, string>,
    commandId: string | undefined
  ): Promise<Result<VersionGroupRecord, UnifiedError>> {
    if (source.operations.length > 0 && !rollbackReviewDecisionsSettled(review)) {
      const recorded = await this.recordRollbackCommand(review, commandId);
      return recorded.ok ? ok(this.groupFromRollbackReview(recorded.value)) : recorded;
    }

    if (source.operations.length === 0) {
      const restored = await this.restoreReadyRollbackFiles(review, currentEditorContents);
      if (!restored.ok) return restored;
      const completedCommand = await this.recordRollbackCommand(restored.value, commandId);
      return completedCommand.ok
        ? ok(this.groupFromRollbackReview(completedCommand.value))
        : completedCommand;
    }

    const reviewedSource = this.buildRollbackReviewUndoSource(source, review);
    const undo = await this.performUndo(reviewedSource, "run_undo");
    if (!undo.ok) return undo;
    if (undo.value.transactionStatus !== "applied") return undo;

    let completed = review;
    for (const file of completed.files) {
      if (file.status !== "ready") continue;
      const write = undo.value.writes.find(
        (candidate) => candidate.relativePath === file.relativePath
      );
      completed = updateRollbackReviewFile(
        completed,
        file.relativePath,
        {
          status: "completed",
          ...(write === undefined ? {} : { snapshotVersionId: write.beforeVersionId })
        },
        this.now()
      );
    }
    const persisted = await this.persistRollbackReview(
      withRollbackReviewStatus(completed, this.now())
    );
    if (!persisted.ok) return persisted;
    const completedCommand = await this.recordRollbackCommand(persisted.value, commandId);
    return completedCommand.ok
      ? ok(this.groupFromRollbackReview(completedCommand.value))
      : completedCommand;
  }

  private buildRollbackReviewUndoSource(
    source: UndoSource,
    review: RollbackReviewRecord
  ): UndoSource {
    const reviewByPath = new Map(review.files.map((file) => [file.relativePath, file]));
    const replacedPaths = new Set<string>();
    const steps: UndoMutationStep[] = [];
    for (const step of source.steps) {
      if (step.kind !== "write") {
        steps.push(step);
        continue;
      }
      const reviewFile = reviewByPath.get(step.source.relativePath);
      if (reviewFile === undefined) {
        steps.push(step);
        continue;
      }
      if (replacedPaths.has(reviewFile.relativePath)) continue;
      replacedPaths.add(reviewFile.relativePath);
      if (reviewFile.status !== "ready" || reviewFile.decision !== "restore_baseline") continue;
      steps.push(rollbackReviewUndoWriteStep(step, reviewFile));
    }
    return {
      ...source,
      steps,
      operations: steps
        .filter((step): step is UndoOperationStep => step.kind === "operation")
        .map((step) => step.operation)
    };
  }

  private async recordRollbackCommand(
    source: RollbackReviewRecord,
    commandId: string | undefined
  ): Promise<Result<RollbackReviewRecord, UnifiedError>> {
    if (commandId === undefined || source.processedCommandIds.includes(commandId))
      return ok(source);
    return this.persistRollbackReview(
      freezeRollbackReview({
        ...source,
        updatedAt: this.now(),
        processedCommandIds: [...source.processedCommandIds, commandId]
      })
    );
  }

  private async createRollbackReview(
    source: UndoSource,
    currentEditorContents: ReadonlyMap<string, string>
  ): Promise<Result<RollbackReviewRecord, UnifiedError>> {
    const firstJournal = requireDefined(source.journals[0], "Undo source is empty.");
    const createdAt = this.now();
    const files: RollbackReviewFileRecord[] = [];
    for (const file of source.files) {
      const current = await this.readSafeTarget(file.relativePath);
      if (!current.ok) return current;
      const baseline = requireDefined(
        source.baselineByPath[file.relativePath],
        "Undo baseline is missing."
      );
      const editorContent = currentEditorContents.get(file.relativePath);
      const status =
        editorContent !== undefined
          ? "conflict"
          : current.value.checksum === file.candidateChecksum
            ? "completed"
            : current.value.checksum === file.baseChecksum
              ? "ready"
              : "conflict";
      files.push({
        relativePath: file.relativePath,
        assetType: file.assetType,
        ...(file.assetId === undefined ? {} : { assetId: file.assetId }),
        baselineContent: file.candidateContent,
        baselineChecksum: file.candidateChecksum,
        ...(file.historyCandidateContent === undefined
          ? {}
          : { baselineHistoryContent: file.historyCandidateContent }),
        baselineVersionId: baseline.beforeVersionId,
        runLastWriteContent: file.baseContent,
        runLastWriteChecksum: file.baseChecksum,
        ...(file.historyBaseContent === undefined
          ? {}
          : { runLastWriteHistoryContent: file.historyBaseContent }),
        reviewedCurrentContent: current.value.content,
        reviewedCurrentChecksum: current.value.checksum,
        reviewedCurrentHistoryContent:
          editorContent ?? historyContentForAsset(file.assetType, current.value.content),
        ...(editorContent === undefined ? {} : { reviewedEditorChecksum: checksum(editorContent) }),
        diff: rollbackDiff(
          editorContent ?? historyContentForAsset(file.assetType, current.value.content),
          file.historyBaseContent ?? file.baseContent,
          file.historyCandidateContent ?? file.candidateContent
        ),
        ...(status === "ready" || status === "completed"
          ? { decision: "restore_baseline" as const }
          : {}),
        status,
        ...(status === "conflict" ? { errorCode: "AGENT_WRITE_UNDO_CONFLICT" } : {})
      });
    }
    const review = freezeRollbackReview({
      schemaVersion: "1.0",
      reviewId: `rollback_${checksum(firstJournal.runId).slice(0, 24)}`,
      runId: firstJournal.runId,
      status: rollbackReviewStatus(files),
      sourceVersionGroupIds: source.versionGroupIds,
      createdAt,
      updatedAt: createdAt,
      processedCommandIds: [],
      files
    });
    return this.persistRollbackReview(review);
  }

  private async restoreReadyRollbackFiles(
    source: RollbackReviewRecord,
    currentEditorContents: ReadonlyMap<string, string> = new Map()
  ): Promise<Result<RollbackReviewRecord, UnifiedError>> {
    let review = source;
    const readyPaths = review.files
      .filter((file) => file.status === "ready")
      .map((file) => file.relativePath);
    if (readyPaths.length === 0) return ok(review);

    for (const relativePath of readyPaths) {
      const file = requireDefined(
        review.files.find((candidate) => candidate.relativePath === relativePath),
        "Rollback review file is missing."
      );
      const current = await this.readSafeTarget(file.relativePath);
      if (!current.ok) return current;
      const editorContent = currentEditorContents.get(file.relativePath);
      if (
        current.value.checksum === file.baselineChecksum &&
        rollbackEditorMatches(file, editorContent)
      ) {
        review = updateRollbackReviewFile(
          review,
          relativePath,
          { status: "completed" },
          this.now()
        );
      } else if (!rollbackCurrentMatches(file, current.value.checksum, editorContent)) {
        review = replaceRollbackReviewFile(
          review,
          staleRollbackFile(file, current.value.content, current.value.checksum, editorContent),
          this.now()
        );
      }
    }
    review = withRollbackReviewStatus(review, this.now());
    const rechecked = await this.persistRollbackReview(review);
    if (!rechecked.ok) return rechecked;
    review = rechecked.value;

    const snapshotPaths = review.files
      .filter((file) => file.status === "ready" && file.snapshotVersionId === undefined)
      .map((file) => file.relativePath);
    for (const relativePath of snapshotPaths) {
      const file = requireDefined(
        review.files.find((candidate) => candidate.relativePath === relativePath),
        "Rollback review file is missing."
      );
      const snapshot = await this.options.historyRepository.snapshotTextAsset({
        assetType: file.assetType,
        assetId: historyAssetId({
          relativePath: file.relativePath,
          assetType: file.assetType,
          ...(file.assetId === undefined ? {} : { assetId: file.assetId }),
          baseChecksum: file.reviewedCurrentChecksum,
          candidateChecksum: file.baselineChecksum,
          baseContent: file.reviewedCurrentContent,
          candidateContent: file.baselineContent
        }),
        reason: "before-agent-session-undo",
        content: file.reviewedCurrentHistoryContent ?? file.reviewedCurrentContent,
        createdBy: "system",
        relativePath: file.relativePath,
        runId: review.runId,
        writeId: rollbackWriteId(review.reviewId, file.relativePath)
      });
      if (!snapshot.ok) {
        review = updateRollbackReviewFile(
          review,
          relativePath,
          { status: "failed", errorCode: snapshot.error.code },
          this.now()
        );
        const failed = await this.persistRollbackReview(
          withRollbackReviewStatus(review, this.now())
        );
        return failed.ok ? ok(failed.value) : failed;
      }
      review = updateRollbackReviewFile(
        review,
        relativePath,
        { snapshotVersionId: snapshot.value.versionId },
        this.now()
      );
      const persisted = await this.persistRollbackReview(review);
      if (!persisted.ok) return persisted;
      review = persisted.value;
    }

    for (const relativePath of readyPaths) {
      const file = requireDefined(
        review.files.find((candidate) => candidate.relativePath === relativePath),
        "Rollback review file is missing."
      );
      if (file.status !== "ready" || file.snapshotVersionId === undefined) continue;
      const current = await this.readSafeTarget(file.relativePath);
      if (!current.ok) return current;
      const replacement = await this.replacePreparedFile(
        {
          relativePath: file.relativePath,
          targetPath: current.value.targetPath,
          baseContent: file.reviewedCurrentContent,
          candidateContent: file.baselineContent
        },
        "undo",
        file.reviewedCurrentContent,
        file.baselineContent
      );
      if (replacement.ok) {
        review = updateRollbackReviewFile(
          review,
          relativePath,
          { status: "completed" },
          this.now()
        );
      } else if (replacement.error.code === "AGENT_WRITE_BASE_CONFLICT") {
        const refreshed = await this.readSafeTarget(file.relativePath);
        if (!refreshed.ok) return refreshed;
        const editorContent = currentEditorContents.get(file.relativePath);
        review = replaceRollbackReviewFile(
          review,
          staleRollbackFile(file, refreshed.value.content, refreshed.value.checksum, editorContent),
          this.now()
        );
      } else {
        review = updateRollbackReviewFile(
          review,
          relativePath,
          { status: "failed", errorCode: replacement.error.code },
          this.now()
        );
      }
      const persisted = await this.persistRollbackReview(
        withRollbackReviewStatus(review, this.now())
      );
      if (!persisted.ok) return persisted;
      review = persisted.value;
    }
    return ok(withRollbackReviewStatus(review, this.now()));
  }

  private groupFromRollbackReview(review: RollbackReviewRecord): VersionGroupRecord {
    const baselineByPath = Object.fromEntries(
      review.files.map((file) => [
        file.relativePath,
        {
          relativePath: file.relativePath,
          checksum: file.baselineChecksum,
          beforeVersionId: file.baselineVersionId
        }
      ])
    );
    const writes: VersionGroupWriteRecord[] = review.files.map((file) => ({
      writeId: rollbackWriteId(review.reviewId, file.relativePath),
      relativePath: file.relativePath,
      assetType: file.assetType,
      beforeChecksum: file.reviewedCurrentChecksum,
      afterChecksum: file.baselineChecksum,
      beforeVersionId: file.snapshotVersionId ?? file.baselineVersionId,
      status:
        file.status === "failed"
          ? "rollback_failed"
          : file.status === "ready"
            ? "pending"
            : file.status,
      ...(file.errorCode === undefined ? {} : { errorCode: file.errorCode })
    }));
    const transactionStatus =
      review.status === "completed"
        ? "applied"
        : review.status === "partial_failure"
          ? "partial_failure"
          : "awaiting_review";
    return freezeGroup({
      schemaVersion: "1.0",
      versionGroupId: review.reviewId,
      runId: review.runId,
      checkpointId: `rollback_${review.runId}`,
      changeSetId: `undo_${review.runId}`,
      changeSetRevision: 0,
      changeSetChecksum: checksum(review.sourceVersionGroupIds.join("\n")),
      createdAt: review.createdAt,
      writes,
      baselineByPath,
      transactionStatus,
      undoStatus:
        review.status === "completed"
          ? "completed"
          : review.status === "partial_failure"
            ? "partial_failure"
            : "review_required",
      undoMetadata: {
        runId: review.runId,
        versionGroupId: review.reviewId,
        baselineVersionIds: Object.fromEntries(
          review.files.map((file) => [file.relativePath, file.baselineVersionId])
        ),
        lastWriteChecksums: Object.fromEntries(
          review.files.map((file) => [file.relativePath, file.runLastWriteChecksum])
        ),
        undoOfVersionGroupIds: review.sourceVersionGroupIds
      },
      rollbackReview: review,
      ...(review.status === "partial_failure" ? { failureKind: "undo_failure" } : {})
    });
  }

  private async readRollbackReview(
    runId: string
  ): Promise<Result<RollbackReviewRecord | undefined, UnifiedError>> {
    const read = this.options.recoveryRepository.readRollbackReview;
    if (read === undefined) return ok(undefined);
    return read.call(this.options.recoveryRepository, runId);
  }

  private async persistRollbackReview(
    review: RollbackReviewRecord
  ): Promise<Result<RollbackReviewRecord, UnifiedError>> {
    const write = this.options.recoveryRepository.writeRollbackReview;
    if (write === undefined) {
      return err(this.error("AGENT_WRITE_ROLLBACK_REVIEW_UNAVAILABLE", "storage"));
    }
    return write.call(this.options.recoveryRepository, freezeRollbackReview(review));
  }

  private async executeTransaction(
    input: TransactionExecutionInput,
    transactionOptions: ExecuteTransactionOptions
  ): Promise<Result<VersionGroupRecord, UnifiedError>> {
    const inputValidation = validateTransactionInput(input, transactionOptions.kind);
    if (!inputValidation.ok) return inputValidation;

    const preflight = await this.preflight(input.files);
    if (!preflight.ok) return preflight;
    const operationPreflight = await this.preflightOperations(input.operations ?? []);
    if (!operationPreflight.ok) return operationPreflight;
    if (
      (preflight.value.length > 0 || operationPreflight.value.length > 0) &&
      this.options.lifecycleOperations === undefined
    ) {
      return err(this.error("AGENT_WRITE_NATIVE_FILE_OPERATIONS_REQUIRED", "validation"));
    }
    const runSequence = await this.nextRunSequence(input.runId);
    if (!runSequence.ok) return runSequence;

    const versionGroupId = this.createVersionGroupId();
    const transactionId = this.createTransactionId();
    const preparedFiles: PreparedFile[] = [];
    const preparedOperations: PreparedOperation[] = [];
    for (const file of preflight.value) {
      const writeId = this.createWriteId();
      const snapshot = await this.options.historyRepository.snapshotTextAsset({
        assetType: file.assetType,
        assetId: historyAssetId(file),
        reason: transactionOptions.snapshotReason,
        content: file.historyBaseContent ?? file.baseContent,
        createdBy: "system",
        relativePath: file.relativePath,
        runId: input.runId,
        checkpointId: input.checkpointId,
        writeId
      });
      if (!snapshot.ok) {
        if (preparedFiles.length > 0) {
          const aborted = abortPreparedJournal(
            createJournal({
              transactionId,
              versionGroupId,
              kind: transactionOptions.kind,
              runSequence: runSequence.value,
              input,
              preparedFiles,
              preparedOperations,
              createdAt: this.now(),
              ...(transactionOptions.undoOfVersionGroupIds === undefined
                ? {}
                : { undoOfVersionGroupIds: transactionOptions.undoOfVersionGroupIds })
            }),
            this.now()
          );
          await this.persistJournal(aborted);
        }
        return snapshot;
      }
      preparedFiles.push({
        ...file,
        writeId,
        beforeVersionId: snapshot.value.versionId
      });
    }

    for (const operation of operationPreflight.value) {
      const historySnapshot = operationHistorySnapshot(operation);
      let beforeVersionId: string | undefined;
      if (historySnapshot !== undefined) {
        const snapshot = await this.options.historyRepository.snapshotTextAsset({
          assetType: "text",
          assetId: historySnapshot.relativePath,
          reason: transactionOptions.snapshotReason,
          content: historySnapshot.content,
          createdBy: "system",
          relativePath: historySnapshot.relativePath,
          runId: input.runId,
          checkpointId: input.checkpointId,
          writeId: operation.operation.operationId
        });
        if (!snapshot.ok) {
          if (preparedFiles.length > 0 || preparedOperations.length > 0) {
            const aborted = abortPreparedJournal(
              createJournal({
                transactionId,
                versionGroupId,
                kind: transactionOptions.kind,
                runSequence: runSequence.value,
                input,
                preparedFiles,
                preparedOperations,
                createdAt: this.now(),
                ...(transactionOptions.undoOfVersionGroupIds === undefined
                  ? {}
                  : { undoOfVersionGroupIds: transactionOptions.undoOfVersionGroupIds })
              }),
              this.now()
            );
            await this.persistJournal(aborted);
          }
          return snapshot;
        }
        beforeVersionId = snapshot.value.versionId;
      }
      preparedOperations.push({
        ...operation,
        ...(beforeVersionId === undefined ? {} : { beforeVersionId })
      });
    }

    let journal = createJournal({
      transactionId,
      versionGroupId,
      kind: transactionOptions.kind,
      runSequence: runSequence.value,
      input,
      preparedFiles,
      preparedOperations,
      createdAt: this.now(),
      ...(transactionOptions.undoOfVersionGroupIds === undefined
        ? {}
        : { undoOfVersionGroupIds: transactionOptions.undoOfVersionGroupIds })
    });
    const preparedJournal = await this.persistJournal(journal);
    if (!preparedJournal.ok) {
      await this.persistJournal(abortPreparedJournal(journal, this.now()));
      return preparedJournal;
    }

    for (const file of preparedFiles) {
      journal = withJournalStatus(journal, "applying", this.now());
      const applyingJournal = await this.persistJournal(journal);
      if (!applyingJournal.ok) {
        return this.compensate(journal);
      }

      const replacement = await this.replacePreparedFile(file, "apply");
      if (!replacement.ok) {
        journal = updateJournalEntry(
          journal,
          file.writeId,
          {
            status: "pending",
            errorCode: replacement.error.code
          },
          this.now()
        );
        return this.compensate(journal);
      }

      journal = updateJournalEntry(journal, file.writeId, { status: "applied" }, this.now());
      const appliedEntry = await this.persistJournal(journal);
      if (!appliedEntry.ok) {
        return this.compensate(journal);
      }
    }

    for (const operation of preparedOperations) {
      journal = withJournalStatus(journal, "applying", this.now());
      const applyingJournal = await this.persistJournal(journal);
      if (!applyingJournal.ok) return this.compensate(journal);

      const applied = await this.applyPreparedOperation(operation);
      if (!applied.ok) {
        journal = updateJournalOperation(
          journal,
          operation.operation.operationId,
          { status: "pending", errorCode: applied.error.code },
          this.now()
        );
        return this.compensate(journal);
      }

      journal = updateJournalOperation(
        journal,
        operation.operation.operationId,
        { status: "applied" },
        this.now()
      );
      const appliedOperation = await this.persistJournal(journal);
      if (!appliedOperation.ok) return this.compensate(journal);
    }

    journal = withJournalStatus(journal, "applied", this.now());
    const finalJournal = await this.persistJournal(journal);
    if (!finalJournal.ok) return this.compensate(journal);
    return ok(groupFromJournal(journal, "applied", undefined));
  }

  private async compensate(
    source: AgentTransactionJournal
  ): Promise<Result<VersionGroupRecord, UnifiedError>> {
    let journal = withJournalStatus(source, "compensating", this.now());
    await this.persistJournal(journal);

    for (const mutation of [...journalMutationOrder(journal)].reverse()) {
      if (mutation.kind === "operation") {
        const operation = journal.operations?.find(
          (candidate) => candidate.operationId === mutation.id
        );
        if (operation === undefined) continue;
        if (operation.status !== "applied" && operation.status !== "rollback_failed") continue;
        const rollback = await this.restoreJournalOperation(operation);
        journal = updateJournalOperation(
          journal,
          operation.operationId,
          rollback.ok
            ? { status: "rolled_back" }
            : { status: "rollback_failed", errorCode: "AGENT_WRITE_ROLLBACK_FAILED" },
          this.now()
        );
        await this.persistJournal(journal);
        continue;
      }

      const entry = journal.entries.find((candidate) => candidate.writeId === mutation.id);
      if (entry === undefined) continue;
      if (entry.status !== "applied" && entry.status !== "rollback_failed") continue;
      const rollback = await this.restoreJournalEntry(entry, "compensate");
      journal = updateJournalEntry(
        journal,
        entry.writeId,
        rollback.ok
          ? { status: "rolled_back" }
          : { status: "rollback_failed", errorCode: "AGENT_WRITE_ROLLBACK_FAILED" },
        this.now()
      );
      const persisted = await this.persistJournal(journal);
      if (!persisted.ok) continue;
    }

    const partial =
      journal.entries.some((entry) => entry.status === "rollback_failed") ||
      (journal.operations ?? []).some((operation) => operation.status === "rollback_failed");
    journal = withJournalStatus(journal, partial ? "partial_failure" : "rolled_back", this.now());
    const finalJournal = await this.persistJournal(journal);
    if (!finalJournal.ok) return finalJournal;
    return ok(
      groupFromJournal(
        journal,
        partial ? "partial_failure" : "rolled_back",
        partial ? "partial_failure" : journal.kind === "apply" ? "write_failure" : "undo_failure"
      )
    );
  }

  private async resumeCompensation(
    source: AgentTransactionJournal
  ): Promise<Result<VersionGroupRecord, UnifiedError>> {
    if (source.transactionStatus === "prepared") {
      const rolledBack = abortPreparedJournal(source, this.now());
      const persisted = await this.persistJournal(rolledBack);
      return persisted.ok
        ? ok(
            groupFromJournal(
              rolledBack,
              "rolled_back",
              source.kind === "apply" ? "write_failure" : "undo_failure"
            )
          )
        : persisted;
    }
    let reconciled = source;
    for (const entry of source.entries.filter((candidate) => candidate.status === "pending")) {
      const current = await this.readSafeTarget(entry.relativePath);
      const update = !current.ok
        ? { status: "rollback_failed" as const, errorCode: "AGENT_WRITE_ROLLBACK_FAILED" }
        : current.value.checksum === entry.beforeChecksum
          ? { status: "rolled_back" as const }
          : current.value.checksum === entry.candidateChecksum
            ? { status: "applied" as const }
            : { status: "rollback_failed" as const, errorCode: "AGENT_WRITE_ROLLBACK_FAILED" };
      reconciled = updateJournalEntry(reconciled, entry.writeId, update, this.now());
      const persisted = await this.persistJournal(reconciled);
      if (!persisted.ok) return persisted;
    }

    for (const operation of source.operations ?? []) {
      if (operation.status !== "pending") continue;
      const recovered = await this.reconcileJournalOperation(operation);
      reconciled = updateJournalOperation(reconciled, operation.operationId, recovered, this.now());
      const persisted = await this.persistJournal(reconciled);
      if (!persisted.ok) return persisted;
    }

    if (
      !reconciled.entries.some(
        (entry) => entry.status === "applied" || entry.status === "rollback_failed"
      ) &&
      !(reconciled.operations ?? []).some(
        (operation) => operation.status === "applied" || operation.status === "rollback_failed"
      )
    ) {
      const rolledBack = withJournalStatus(reconciled, "rolled_back", this.now());
      const persisted = await this.persistJournal(rolledBack);
      return persisted.ok
        ? ok(groupFromJournal(rolledBack, "rolled_back", "write_failure"))
        : persisted;
    }
    return this.compensate(reconciled);
  }

  private async performUndo(
    source: UndoSource,
    kind: Extract<AgentTransactionJournalKind, "version_group_undo" | "run_undo">,
    selection: {
      readonly includeWrites?: boolean;
      readonly includeOperations?: boolean;
    } = {}
  ): Promise<Result<VersionGroupRecord, UnifiedError>> {
    const firstJournal = requireDefined(source.journals[0], "Undo source is empty.");
    const lastJournal = requireDefined(
      source.journals[source.journals.length - 1],
      "Undo source is empty."
    );
    const includeWrites = selection.includeWrites ?? true;
    const includeOperations = selection.includeOperations ?? true;
    const steps = source.steps.filter(
      (step) =>
        (step.kind === "write" && includeWrites) || (step.kind === "operation" && includeOperations)
    );
    if (steps.length === 0) return ok(this.completedUndoGroup(source, firstJournal, lastJournal));

    const alreadyApplied = await this.undoStepsAlreadyApplied(steps);
    if (!alreadyApplied.ok) return alreadyApplied;
    if (alreadyApplied.value) return ok(this.completedUndoGroup(source, firstJournal, lastJournal));

    const preflight = await this.preflightUndoSteps(steps);
    if (!preflight.ok) {
      if (preflight.error.code === "AGENT_WRITE_UNDO_CONFLICT") {
        return ok(this.undoConflictGroup(source, firstJournal, lastJournal));
      }
      return preflight;
    }
    if (this.options.lifecycleOperations === undefined) {
      return err(this.error("AGENT_WRITE_NATIVE_FILE_OPERATIONS_REQUIRED", "validation"));
    }

    const journal = await this.prepareUndoJournal(source, steps, kind, firstJournal, lastJournal);
    if (!journal.ok) return journal;
    const result = await this.applyUndoJournal(journal.value);
    if (!result.ok) return result;
    const undoStatus =
      result.value.transactionStatus === "applied" ? "completed" : result.value.undoStatus;
    return ok(
      freezeGroup({
        ...result.value,
        baselineByPath: source.baselineByPath,
        undoStatus,
        undoMetadata: undoMetadata(
          result.value.runId,
          result.value.versionGroupId,
          source.baselineByPath,
          result.value.writes,
          source.versionGroupIds
        )
      })
    );
  }

  private completedUndoGroup(
    source: UndoSource,
    firstJournal: AgentTransactionJournal,
    lastJournal: AgentTransactionJournal
  ): VersionGroupRecord {
    const versionGroupId = this.createVersionGroupId();
    return freezeGroup({
      schemaVersion: "1.0",
      versionGroupId,
      runId: firstJournal.runId,
      checkpointId: lastJournal.checkpointId,
      changeSetId: `undo_${firstJournal.runId}`,
      changeSetRevision: 0,
      changeSetChecksum: checksum(source.versionGroupIds.join("\n")),
      createdAt: this.now(),
      writes: [],
      baselineByPath: source.baselineByPath,
      transactionStatus: "applied",
      undoStatus: "completed",
      undoMetadata: undoMetadata(
        firstJournal.runId,
        versionGroupId,
        source.baselineByPath,
        [],
        source.versionGroupIds
      )
    });
  }

  private undoConflictGroup(
    source: UndoSource,
    firstJournal: AgentTransactionJournal,
    lastJournal: AgentTransactionJournal
  ): VersionGroupRecord {
    const conflictWrites: VersionGroupWriteRecord[] = source.files.map((file) => {
      const baseline = requireDefined(
        source.baselineByPath[file.relativePath],
        "Undo baseline is missing."
      );
      return {
        writeId: this.createWriteId(),
        relativePath: file.relativePath,
        assetType: file.assetType,
        beforeChecksum: file.baseChecksum,
        afterChecksum: file.candidateChecksum,
        beforeVersionId: baseline.beforeVersionId,
        status: "conflict",
        errorCode: "AGENT_WRITE_UNDO_CONFLICT"
      };
    });
    return freezeGroup({
      schemaVersion: "1.0",
      versionGroupId: this.createVersionGroupId(),
      runId: firstJournal.runId,
      checkpointId: lastJournal.checkpointId,
      changeSetId: `undo_${firstJournal.runId}`,
      changeSetRevision: 0,
      changeSetChecksum: checksum(source.versionGroupIds.join("\n")),
      createdAt: this.now(),
      writes: conflictWrites,
      baselineByPath: source.baselineByPath,
      transactionStatus: "failed",
      undoStatus: "conflict",
      failureKind: "undo_conflict",
      undoMetadata: undoMetadata(
        firstJournal.runId,
        "undo_conflict",
        source.baselineByPath,
        conflictWrites,
        source.versionGroupIds
      )
    });
  }

  private async undoStepsAlreadyApplied(
    steps: readonly UndoMutationStep[]
  ): Promise<Result<boolean, UnifiedError>> {
    const expected = new Map<string, AgentOperationPathSnapshot>();
    for (const step of steps) {
      for (const snapshot of step.after) expected.set(snapshot.relativePath, snapshot);
    }
    for (const snapshot of expected.values()) {
      const actual = await this.readOperationPath(snapshot.relativePath);
      if (!actual.ok) return actual;
      if (!sameSnapshot(actual.value, snapshot)) return ok(false);
    }
    return ok(true);
  }

  private async preflightUndoSteps(
    steps: readonly UndoMutationStep[]
  ): Promise<Result<void, UnifiedError>> {
    const state = new Map<string, AgentOperationPathSnapshot>();
    for (const step of steps) {
      for (const expected of step.before) {
        let actual = state.get(expected.relativePath);
        if (actual === undefined) {
          const inspected = await this.readOperationPath(expected.relativePath);
          if (!inspected.ok) return inspected;
          actual = inspected.value;
          state.set(expected.relativePath, actual);
        }
        if (!sameSnapshot(actual, expected)) {
          return err(this.error("AGENT_WRITE_UNDO_CONFLICT", "validation", expected.relativePath));
        }
      }
      for (const snapshot of step.after) state.set(snapshot.relativePath, snapshot);
    }
    return ok(undefined);
  }

  private async prepareUndoJournal(
    source: UndoSource,
    steps: readonly UndoMutationStep[],
    kind: Extract<AgentTransactionJournalKind, "version_group_undo" | "run_undo">,
    firstJournal: AgentTransactionJournal,
    lastJournal: AgentTransactionJournal
  ): Promise<Result<AgentTransactionJournal, UnifiedError>> {
    const runSequence = await this.nextRunSequence(firstJournal.runId);
    if (!runSequence.ok) return runSequence;

    const entries: AgentTransactionJournalEntry[] = [];
    const operations: AgentTransactionJournalOperationEntry[] = [];
    for (const step of steps) {
      if (step.kind === "write") {
        const before = requireFileSnapshot(
          requireDefined(step.before[0], "Undo write source is missing."),
          "Undo write source is not a file."
        );
        const after = requireFileSnapshot(
          requireDefined(step.after[0], "Undo write target is missing."),
          "Undo write target is not a file."
        );
        const snapshot = await this.options.historyRepository.snapshotTextAsset({
          assetType: step.source.assetType,
          assetId: historyAssetIdForJournalEntry(step.source),
          reason: "before-agent-session-undo",
          content: step.source.historyCandidateContent ?? before.content,
          createdBy: "system",
          relativePath: step.source.relativePath,
          runId: firstJournal.runId,
          checkpointId: lastJournal.checkpointId,
          writeId: step.writeId
        });
        if (!snapshot.ok) return snapshot;
        entries.push({
          writeId: step.writeId,
          relativePath: step.source.relativePath,
          assetType: step.source.assetType,
          ...(step.source.assetId === undefined ? {} : { assetId: step.source.assetId }),
          beforeChecksum: before.checksum,
          candidateChecksum: after.checksum,
          beforeContent: before.content,
          candidateContent: after.content,
          ...(step.source.historyCandidateContent === undefined
            ? {}
            : { historyBaseContent: step.source.historyCandidateContent }),
          ...(step.source.historyBaseContent === undefined
            ? {}
            : { historyCandidateContent: step.source.historyBaseContent }),
          beforeVersionId: snapshot.value.versionId,
          status: "pending"
        });
        continue;
      }

      const history = step.before.find((snapshot) => snapshot.kind === "file");
      let beforeVersionId: string | undefined;
      if (history?.kind === "file") {
        const snapshot = await this.options.historyRepository.snapshotTextAsset({
          assetType: "text",
          assetId: history.relativePath,
          reason: "before-agent-session-undo",
          content: history.content,
          createdBy: "system",
          relativePath: history.relativePath,
          runId: firstJournal.runId,
          checkpointId: lastJournal.checkpointId,
          writeId: step.operationId
        });
        if (!snapshot.ok) return snapshot;
        beforeVersionId = snapshot.value.versionId;
      }
      operations.push({
        operationId: step.operationId,
        operation: step.operation,
        before: step.before,
        after: step.after,
        ...(beforeVersionId === undefined ? {} : { beforeVersionId }),
        status: "pending"
      });
    }

    const createdAt = this.now();
    const journal = freezeJournal({
      schemaVersion: "1.0",
      transactionId: this.createTransactionId(),
      versionGroupId: this.createVersionGroupId(),
      kind,
      runId: firstJournal.runId,
      runSequence: runSequence.value,
      checkpointId: lastJournal.checkpointId,
      changeSetId: `undo_${firstJournal.runId}`,
      changeSetRevision: 0,
      changeSetChecksum: checksum(source.versionGroupIds.join("\n")),
      createdAt,
      updatedAt: createdAt,
      transactionStatus: "prepared",
      entries,
      ...(operations.length === 0 ? {} : { operations }),
      mutationOrder: steps.map((step) =>
        step.kind === "write"
          ? { kind: "write" as const, id: step.writeId }
          : { kind: "operation" as const, id: step.operationId }
      ),
      undoOfVersionGroupIds: source.versionGroupIds
    });
    const persisted = await this.persistJournal(journal);
    return persisted.ok ? ok(persisted.value) : persisted;
  }

  private async applyUndoJournal(
    source: AgentTransactionJournal
  ): Promise<Result<VersionGroupRecord, UnifiedError>> {
    let journal = source;
    for (const mutation of journalMutationOrder(journal)) {
      journal = withJournalStatus(journal, "applying", this.now());
      const applying = await this.persistJournal(journal);
      if (!applying.ok) return this.compensate(journal);

      if (mutation.kind === "write") {
        const entry = journal.entries.find((candidate) => candidate.writeId === mutation.id);
        if (entry === undefined) return err(this.error("AGENT_WRITE_UNDO_CONFLICT", "validation"));
        const applied = await this.applyUndoJournalEntry(entry);
        if (!applied.ok) {
          journal = updateJournalEntry(
            journal,
            entry.writeId,
            { status: "pending", errorCode: applied.error.code },
            this.now()
          );
          return this.compensate(journal);
        }
        journal = updateJournalEntry(journal, entry.writeId, { status: "applied" }, this.now());
      } else {
        const entry = journal.operations?.find(
          (candidate) => candidate.operationId === mutation.id
        );
        if (entry === undefined) return err(this.error("AGENT_WRITE_UNDO_CONFLICT", "validation"));
        const applied = await this.applyJournalOperation(entry);
        if (!applied.ok) {
          journal = updateJournalOperation(
            journal,
            entry.operationId,
            { status: "pending", errorCode: applied.error.code },
            this.now()
          );
          return this.compensate(journal);
        }
        journal = updateJournalOperation(
          journal,
          entry.operationId,
          { status: "applied" },
          this.now()
        );
      }

      const persisted = await this.persistJournal(journal);
      if (!persisted.ok) return this.compensate(journal);
    }
    journal = withJournalStatus(journal, "applied", this.now());
    const finalJournal = await this.persistJournal(journal);
    if (!finalJournal.ok) return this.compensate(journal);
    return ok(groupFromJournal(journal, "applied", undefined));
  }

  private async applyUndoJournalEntry(
    entry: AgentTransactionJournalEntry
  ): Promise<Result<void, UnifiedError>> {
    const current = await this.readSafeTarget(entry.relativePath);
    if (!current.ok) return current;
    return this.replacePreparedFile(
      {
        relativePath: entry.relativePath,
        targetPath: current.value.targetPath,
        baseContent: entry.beforeContent,
        candidateContent: entry.candidateContent
      },
      "undo"
    );
  }

  private async applyJournalOperation(
    entry: AgentTransactionJournalOperationEntry
  ): Promise<Result<void, UnifiedError>> {
    return this.applyPreparedOperation({
      operation: entry.operation,
      before: entry.before,
      after: entry.after,
      ...(entry.beforeVersionId === undefined ? {} : { beforeVersionId: entry.beforeVersionId })
    });
  }

  private buildUndoSource(journals: readonly AgentTransactionJournal[]): UndoSource {
    const ordered = [...journals].sort(compareJournals);
    const earliestByPath = new Map<string, AgentTransactionJournalEntry>();
    const latestByPath = new Map<string, AgentTransactionJournalEntry>();
    for (const journal of ordered) {
      for (const entry of journal.entries) {
        earliestByPath.set(entry.relativePath, earliestByPath.get(entry.relativePath) ?? entry);
        latestByPath.set(entry.relativePath, entry);
      }
    }

    const files = [...earliestByPath.entries()].map(([relativePath, earliest]) => {
      const latest = requireDefined(
        latestByPath.get(relativePath),
        "Undo latest write is missing."
      );
      return {
        relativePath,
        assetType: earliest.assetType,
        ...(earliest.assetId === undefined ? {} : { assetId: earliest.assetId }),
        baseChecksum: latest.candidateChecksum,
        candidateChecksum: earliest.beforeChecksum,
        baseContent: latest.candidateContent,
        candidateContent: earliest.beforeContent,
        ...(latest.historyCandidateContent === undefined
          ? {}
          : { historyBaseContent: latest.historyCandidateContent }),
        ...(earliest.historyBaseContent === undefined
          ? {}
          : { historyCandidateContent: earliest.historyBaseContent })
      } satisfies AgentWriteTransactionFile;
    });
    const baselineByPath = Object.fromEntries(
      [...earliestByPath.entries()].map(([relativePath, entry]) => [
        relativePath,
        {
          relativePath,
          checksum: entry.beforeChecksum,
          beforeVersionId: entry.beforeVersionId
        }
      ])
    );
    const steps: UndoMutationStep[] = [];
    for (const journal of [...ordered].reverse()) {
      for (const mutation of [...journalMutationOrder(journal)].reverse()) {
        if (mutation.kind === "operation") {
          const entry = journal.operations?.find(
            (candidate) => candidate.operationId === mutation.id
          );
          if (entry === undefined || entry.status !== "applied") continue;
          const operation = inverseJournalOperation(entry, journal.transactionId);
          if (operation === undefined) continue;
          steps.push({
            kind: "operation",
            operationId: operation.operationId,
            operation,
            before: entry.after,
            after: entry.before,
            source: entry
          });
          continue;
        }
        const entry = journal.entries.find((candidate) => candidate.writeId === mutation.id);
        if (entry === undefined || entry.status !== "applied") continue;
        steps.push({
          kind: "write",
          writeId: undoWriteId(journal.transactionId, entry.writeId),
          source: entry,
          before: [fileSnapshot(entry.relativePath, entry.candidateContent)],
          after: [fileSnapshot(entry.relativePath, entry.beforeContent)]
        });
      }
    }
    const operations = steps
      .filter((step): step is UndoOperationStep => step.kind === "operation")
      .map((step) => step.operation);
    return {
      journals: ordered,
      files,
      operations,
      steps,
      baselineByPath,
      versionGroupIds: ordered.map((journal) => journal.versionGroupId)
    };
  }

  private async preflight(
    files: readonly AgentWriteTransactionFile[]
  ): Promise<
    Result<readonly (AgentWriteTransactionFile & { targetPath: string })[], UnifiedError>
  > {
    const prepared: (AgentWriteTransactionFile & { targetPath: string })[] = [];
    for (const file of files) {
      if (
        checksum(file.baseContent) !== file.baseChecksum ||
        checksum(file.candidateContent) !== file.candidateChecksum
      ) {
        return err(this.error("AGENT_WRITE_CHECKSUM_INVALID", "validation", file.relativePath));
      }
      const current = await this.readSafeTarget(file.relativePath);
      if (!current.ok) return current;
      if (current.value.checksum !== file.baseChecksum) {
        return err(this.error("AGENT_WRITE_BASE_CONFLICT", "validation", file.relativePath));
      }
      prepared.push({ ...file, targetPath: current.value.targetPath });
    }
    return ok(prepared);
  }

  private async preflightOperations(
    operations: readonly AgentWriteTransactionOperation[]
  ): Promise<Result<readonly PreparedOperation[], UnifiedError>> {
    const ordered = orderOperations(operations);
    if (!ordered.ok) return err(this.error("AGENT_WRITE_OPERATION_INVALID", "validation"));
    if (ordered.value.length === 0) return ok([]);

    const states = new Map<string, AgentOperationPathSnapshot>();
    const stateFor = async (
      relativePath: string
    ): Promise<Result<AgentOperationPathSnapshot, UnifiedError>> => {
      const existing = states.get(relativePath);
      if (existing !== undefined) return ok(existing);
      const inspected = await this.readOperationPath(relativePath);
      if (!inspected.ok) return inspected;
      states.set(relativePath, inspected.value);
      return inspected;
    };
    const requireParentDirectory = async (
      relativePath: string
    ): Promise<Result<void, UnifiedError>> => {
      const parent = parentRelativePath(relativePath);
      if (parent === undefined) return ok(undefined);
      const state = await stateFor(parent);
      if (!state.ok) return state;
      return state.value.kind === "directory"
        ? ok(undefined)
        : err(this.error("AGENT_WRITE_OPERATION_PARENT_INVALID", "validation", relativePath));
    };

    const prepared: PreparedOperation[] = [];
    for (const operation of ordered.value) {
      if (operation.kind === "modify") {
        return err(this.error("AGENT_WRITE_OPERATION_INVALID", "validation"));
      }
      if (operation.kind === "create_file") {
        if (
          !isSafeOperationRelativePath(operation.relativePath) ||
          operation.content.length > 10 * 1024 * 1024
        ) {
          return err(
            this.error("AGENT_WRITE_OPERATION_INVALID", "validation", operation.relativePath)
          );
        }
        const target = await stateFor(operation.relativePath);
        if (!target.ok) return target;
        const parent = await requireParentDirectory(operation.relativePath);
        if (!parent.ok) return parent;
        if (target.value.kind !== "missing") {
          return err(
            this.error("AGENT_WRITE_OPERATION_TARGET_EXISTS", "validation", operation.relativePath)
          );
        }
        const after = fileSnapshot(operation.relativePath, operation.content);
        prepared.push({ operation, before: [target.value], after: [after] });
        states.set(operation.relativePath, after);
        continue;
      }

      if (operation.kind === "delete_file") {
        if (
          !isSafeOperationRelativePath(operation.relativePath) ||
          !isChecksum(operation.baseChecksum)
        ) {
          return err(
            this.error("AGENT_WRITE_OPERATION_INVALID", "validation", operation.relativePath)
          );
        }
        const target = await stateFor(operation.relativePath);
        if (!target.ok) return target;
        if (target.value.kind !== "file" || target.value.checksum !== operation.baseChecksum) {
          return err(this.error("AGENT_WRITE_BASE_CONFLICT", "validation", operation.relativePath));
        }
        const after = missingSnapshot(operation.relativePath);
        prepared.push({ operation, before: [target.value], after: [after] });
        states.set(operation.relativePath, after);
        continue;
      }

      if (operation.kind === "move_file") {
        if (
          !isSafeOperationRelativePath(operation.sourcePath) ||
          !isSafeOperationRelativePath(operation.targetPath) ||
          operation.sourcePath === operation.targetPath ||
          !isChecksum(operation.sourceChecksum)
        ) {
          return err(
            this.error("AGENT_WRITE_OPERATION_INVALID", "validation", operation.sourcePath)
          );
        }
        const source = await stateFor(operation.sourcePath);
        if (!source.ok) return source;
        const target = await stateFor(operation.targetPath);
        if (!target.ok) return target;
        const parent = await requireParentDirectory(operation.targetPath);
        if (!parent.ok) return parent;
        if (source.value.kind !== "file" || source.value.checksum !== operation.sourceChecksum) {
          return err(this.error("AGENT_WRITE_BASE_CONFLICT", "validation", operation.sourcePath));
        }
        if (target.value.kind !== "missing") {
          return err(
            this.error("AGENT_WRITE_OPERATION_TARGET_EXISTS", "validation", operation.targetPath)
          );
        }
        const sourceAfter = missingSnapshot(operation.sourcePath);
        const targetAfter = fileSnapshot(operation.targetPath, source.value.content);
        prepared.push({
          operation,
          before: [source.value, target.value],
          after: [sourceAfter, targetAfter]
        });
        states.set(operation.sourcePath, sourceAfter);
        states.set(operation.targetPath, targetAfter);
        continue;
      }

      if (operation.kind === "create_directory") {
        if (!isSafeOperationRelativePath(operation.relativePath)) {
          return err(
            this.error("AGENT_WRITE_OPERATION_INVALID", "validation", operation.relativePath)
          );
        }
        const target = await stateFor(operation.relativePath);
        if (!target.ok) return target;
        const parent = await requireParentDirectory(operation.relativePath);
        if (!parent.ok) return parent;
        if (target.value.kind !== "missing") {
          return err(
            this.error("AGENT_WRITE_OPERATION_TARGET_EXISTS", "validation", operation.relativePath)
          );
        }
        const after = directorySnapshot(operation.relativePath);
        prepared.push({ operation, before: [target.value], after: [after] });
        states.set(operation.relativePath, after);
        continue;
      }

      if (operation.kind === "remove_directory") {
        if (!isSafeOperationRelativePath(operation.relativePath)) {
          return err(
            this.error("AGENT_WRITE_OPERATION_INVALID", "validation", operation.relativePath)
          );
        }
        const target = await stateFor(operation.relativePath);
        if (!target.ok) return target;
        if (target.value.kind !== "directory") {
          return err(this.error("AGENT_WRITE_BASE_CONFLICT", "validation", operation.relativePath));
        }
        const after = missingSnapshot(operation.relativePath);
        prepared.push({ operation, before: [target.value], after: [after] });
        states.set(operation.relativePath, after);
      }
    }
    return ok(prepared);
  }

  private async applyPreparedOperation(
    prepared: PreparedOperation
  ): Promise<Result<void, UnifiedError>> {
    const lifecycle = this.options.lifecycleOperations;
    if (lifecycle === undefined) {
      return err(this.error("AGENT_WRITE_NATIVE_FILE_OPERATIONS_REQUIRED", "validation"));
    }
    const locked = await this.options.projectLock.verifyProjectLockOwnership();
    if (!locked.ok) return locked;
    const mutation = lifecycleMutation(prepared);
    if (mutation === undefined) {
      return err(this.error("AGENT_WRITE_OPERATION_INVALID", "validation"));
    }
    return lifecycle.mutate(mutation);
  }

  private async restoreJournalOperation(
    entry: AgentTransactionJournalOperationEntry
  ): Promise<Result<void, UnifiedError>> {
    const inverse = inverseLifecycleMutation(entry);
    if (inverse === undefined)
      return err(this.error("AGENT_WRITE_ROLLBACK_CONFLICT", "validation"));
    const lifecycle = this.options.lifecycleOperations;
    if (lifecycle === undefined) {
      return err(this.error("AGENT_WRITE_NATIVE_FILE_OPERATIONS_REQUIRED", "validation"));
    }
    const locked = await this.options.projectLock.verifyProjectLockOwnership();
    if (!locked.ok) return locked;
    return lifecycle.mutate(inverse);
  }

  private async reconcileJournalOperation(
    entry: AgentTransactionJournalOperationEntry
  ): Promise<
    Pick<AgentTransactionJournalOperationEntry, "status"> & { readonly errorCode?: string }
  > {
    const actual: AgentOperationPathSnapshot[] = [];
    for (const expected of [...entry.before, ...entry.after]) {
      if (actual.some((candidate) => candidate.relativePath === expected.relativePath)) continue;
      const inspected = await this.readOperationPath(expected.relativePath);
      if (!inspected.ok) {
        return { status: "rollback_failed", errorCode: "AGENT_WRITE_ROLLBACK_FAILED" };
      }
      actual.push(inspected.value);
    }
    if (snapshotsEquivalent(actual, entry.before)) return { status: "rolled_back" };
    if (snapshotsEquivalent(actual, entry.after)) return { status: "applied" };
    return { status: "rollback_failed", errorCode: "AGENT_WRITE_ROLLBACK_FAILED" };
  }

  private async readOperationPath(
    relativePath: string
  ): Promise<Result<AgentOperationPathSnapshot, UnifiedError>> {
    if (!isSafeOperationRelativePath(relativePath)) {
      return err(this.error("AGENT_WRITE_PATH_REJECTED", "validation", relativePath));
    }
    try {
      const canonicalRoot = await this.canonicalRoot;
      if ((await realpath(this.options.projectRoot)) !== canonicalRoot) {
        throw new Error("Project root identity changed.");
      }
      let current = canonicalRoot;
      for (const segment of relativePath.split("/")) {
        current = join(current, segment);
        try {
          const stats = await lstat(current);
          if (stats.isSymbolicLink()) throw new Error("Reparse point rejected.");
          if (segment !== relativePath.split("/").at(-1) && !stats.isDirectory()) {
            throw new Error("Parent is not a directory.");
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return ok(missingSnapshot(relativePath));
          }
          throw error;
        }
      }
      const stats = await lstat(current);
      if (stats.isDirectory()) return ok(directorySnapshot(relativePath));
      if (!stats.isFile()) throw new Error("Unsupported target type.");
      const bytes = await readFile(current);
      const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (content.includes("\0")) throw new Error("Binary content rejected.");
      return ok({
        kind: "file",
        relativePath,
        content,
        checksum: checksumBytes(bytes)
      });
    } catch {
      return err(this.error("AGENT_WRITE_PATH_REJECTED", "validation", relativePath));
    }
  }

  private async replacePreparedFile(
    file: Pick<PreparedFile, "relativePath" | "targetPath" | "baseContent" | "candidateContent">,
    phase: AgentWriteReplaceInput["phase"],
    expectedContent = file.baseContent,
    content = file.candidateContent
  ): Promise<Result<void, UnifiedError>> {
    const lifecycle = this.options.lifecycleOperations;
    if (lifecycle === undefined) {
      return err(this.error("AGENT_WRITE_NATIVE_FILE_OPERATIONS_REQUIRED", "validation"));
    }

    const testHook = this.options.replaceFile;
    if (this.options.allowUnsafeReplaceFileForTesting === true && testHook !== undefined) {
      const verified = await testHook({
        phase,
        targetPath: file.targetPath,
        relativePath: file.relativePath,
        content,
        verifyImmediatelyBeforeReplace: async () => {
          const lock = await this.options.projectLock.verifyProjectLockOwnership();
          if (!lock.ok) return lock;
          const finalTarget = await this.readSafeTarget(file.relativePath);
          if (!finalTarget.ok) return finalTarget;
          if (finalTarget.value.targetPath !== file.targetPath) {
            return err(this.error("AGENT_WRITE_PATH_REJECTED", "validation", file.relativePath));
          }
          if (finalTarget.value.checksum !== checksum(expectedContent)) {
            return err(this.error("AGENT_WRITE_BASE_CONFLICT", "validation", file.relativePath));
          }
          return ok(undefined);
        }
      });
      if (!verified.ok) return verified;
    }

    const locked = await this.options.projectLock.verifyProjectLockOwnership();
    if (!locked.ok) return locked;
    return lifecycle.mutate({
      kind: "replace_file",
      phase,
      relativePath: file.relativePath,
      content,
      before: [fileSnapshot(file.relativePath, expectedContent)],
      after: [fileSnapshot(file.relativePath, content)]
    });
  }

  private async restoreJournalEntry(
    entry: AgentTransactionJournalEntry,
    phase: "compensate" | "undo"
  ): Promise<Result<void, UnifiedError>> {
    const current = await this.readSafeTarget(entry.relativePath);
    if (!current.ok) return current;
    if (current.value.checksum === entry.beforeChecksum) return ok(undefined);
    if (current.value.checksum !== entry.candidateChecksum) {
      return err(this.error("AGENT_WRITE_ROLLBACK_CONFLICT", "validation", entry.relativePath));
    }
    return this.replacePreparedFile(
      {
        relativePath: entry.relativePath,
        targetPath: current.value.targetPath,
        baseContent: entry.candidateContent,
        candidateContent: entry.beforeContent
      },
      phase,
      entry.candidateContent,
      entry.beforeContent
    );
  }

  private async readSafeTarget(
    relativePath: string
  ): Promise<
    Result<
      { readonly targetPath: string; readonly content: string; readonly checksum: string },
      UnifiedError
    >
  > {
    const lexical = validateRelativeTarget(relativePath);
    if (!lexical.ok)
      return err(this.error("AGENT_WRITE_PATH_REJECTED", "validation", relativePath));
    try {
      const canonicalRoot = await this.canonicalRoot;
      if ((await realpath(this.options.projectRoot)) !== canonicalRoot) {
        throw new Error("Project root identity changed.");
      }
      let current = canonicalRoot;
      for (const segment of relativePath.split("/")) {
        current = join(current, segment);
        const stats = await lstat(current);
        if (stats.isSymbolicLink()) throw new Error("Reparse point rejected.");
      }
      const targetPath = await realpath(current);
      const rootRelative = relative(canonicalRoot, targetPath);
      if (
        rootRelative === ".." ||
        rootRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
        isAbsolute(rootRelative)
      ) {
        throw new Error("Project root escape rejected.");
      }
      const targetStats = await lstat(targetPath);
      if (!targetStats.isFile()) throw new Error("Target is not a file.");
      const bytes = await readFile(targetPath);
      const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (content.includes("\0")) throw new Error("Binary content rejected.");
      return ok({ targetPath, content, checksum: checksumBytes(bytes) });
    } catch {
      return err(this.error("AGENT_WRITE_PATH_REJECTED", "validation", relativePath));
    }
  }

  private async persistJournal(
    journal: AgentTransactionJournal
  ): Promise<Result<AgentTransactionJournal, UnifiedError>> {
    return this.options.recoveryRepository.writeAgentTransactionJournal(journal);
  }

  private async nextRunSequence(runId: string): Promise<Result<number, UnifiedError>> {
    const journals = await this.options.recoveryRepository.listAgentTransactionJournals();
    if (!journals.ok) return journals;
    const latest = journals.value
      .filter((journal) => journal.runId === runId)
      .reduce((maximum, journal) => Math.max(maximum, journal.runSequence), 0);
    return ok(latest + 1);
  }

  private async exclusive<T>(
    operation: () => Promise<Result<T, UnifiedError>>
  ): Promise<Result<T, UnifiedError>> {
    if (this.transactionActive) {
      return err(this.error("AGENT_WRITE_TRANSACTION_ACTIVE", "storage"));
    }
    this.transactionActive = true;
    try {
      return await operation();
    } finally {
      this.transactionActive = false;
    }
  }

  private error(
    code: string,
    category: "validation" | "storage",
    relativePath?: string
  ): UnifiedError {
    const input = {
      code,
      message: agentWriteErrorMessage(code),
      suggestedAction: agentWriteSuggestedAction(code),
      traceId: this.traceId,
      ...(relativePath === undefined ? {} : { redactedDetail: { relativePath } })
    };
    return category === "validation" ? validationError(input) : storageError(input);
  }
}

function validateTransactionInput(
  input: TransactionExecutionInput,
  kind: AgentTransactionJournalKind
): Result<void, UnifiedError> {
  const identifiers = [input.runId, input.checkpointId, input.changeSetId];
  const paths = input.files.map((file) => file.relativePath);
  const operations = input.operations ?? [];
  const operationPathSet = new Set(operations.flatMap(operationPaths));
  const destructiveOperation = operations.some(
    (operation) =>
      operation.kind === "move_file" ||
      operation.kind === "delete_file" ||
      operation.kind === "create_directory" ||
      operation.kind === "remove_directory"
  );
  const approvalBindingInvalid =
    kind === "apply"
      ? !("writePolicy" in input) ||
        (input.writePolicy !== "write_before_confirmation" &&
          input.writePolicy !== "user_preapproved_run") ||
        !("approvalSource" in input) ||
        (input.approvalSource !== "human_confirmation" &&
          input.approvalSource !== "user_preapproved_run") ||
        (input.approvalSource === "user_preapproved_run" &&
          input.writePolicy !== "user_preapproved_run") ||
        !("approvalToken" in input) ||
        input.approvalToken !== approvalToken(input.changeSetId, input.revision, input.checksum) ||
        (input.approvalSource === "user_preapproved_run" && destructiveOperation)
      : "writePolicy" in input || "approvalSource" in input || "approvalToken" in input;
  if (
    identifiers.some((value) => value.length === 0) ||
    !Number.isInteger(input.revision) ||
    (kind === "apply" ? input.revision < 1 : input.revision < 0) ||
    !sha256Pattern.test(input.checksum) ||
    (input.files.length === 0 && operations.length === 0) ||
    approvalBindingInvalid ||
    new Set(paths).size !== paths.length ||
    paths.some((path) => operationPathSet.has(path)) ||
    new Set(operations.map((operation) => operation.operationId)).size !== operations.length ||
    operations.some(
      (operation) => (operation as { readonly selected?: boolean }).selected === false
    ) ||
    input.files.some(
      (file) =>
        !sha256Pattern.test(file.baseChecksum) || !sha256Pattern.test(file.candidateChecksum)
    )
  ) {
    return err(
      validationError({
        code: "AGENT_WRITE_INPUT_INVALID",
        message: "Approved Agent write input is invalid.",
        suggestedAction: "Regenerate and approve an immutable Change Set revision.",
        traceId: "trace_agent_write_transaction"
      })
    );
  }
  return ok(undefined);
}

function validateRelativeTarget(relativePath: string): Result<void, never> {
  const segments = relativePath.split("/");
  const invalid =
    relativePath.length === 0 ||
    relativePath.includes("\0") ||
    relativePath.includes("\\") ||
    relativePath.includes(":") ||
    isAbsolute(relativePath) ||
    relativePath.startsWith("//") ||
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..") ||
    segments.some((segment) => windowsDeviceNames.test(segment)) ||
    blockedRoots.has((segments[0] ?? "").toLowerCase()) ||
    !allowedExtensions.has(extname(relativePath).toLowerCase());
  return invalid ? { ok: false, error: undefined as never } : ok(undefined);
}

/** Lifecycle paths have the same lexical boundary as text writes but may be directories. */
function isSafeOperationRelativePath(relativePath: string): boolean {
  if (
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    relativePath.length > 1024 ||
    relativePath.includes("\0") ||
    relativePath.includes("\\") ||
    relativePath.includes(":") ||
    isAbsolute(relativePath) ||
    relativePath.startsWith("//") ||
    /^[A-Za-z]:/u.test(relativePath)
  ) {
    return false;
  }
  const segments = relativePath.split("/");
  return (
    segments.every(
      (segment) =>
        segment.length > 0 &&
        segment !== "." &&
        segment !== ".." &&
        !/[. ]$/u.test(segment) &&
        !windowsDeviceNames.test(segment)
    ) && !blockedRoots.has((segments[0] ?? "").toLowerCase())
  );
}

function isChecksum(value: string): boolean {
  return sha256Pattern.test(value);
}

function parentRelativePath(relativePath: string): string | undefined {
  const index = relativePath.lastIndexOf("/");
  return index < 0 ? undefined : relativePath.slice(0, index);
}

function missingSnapshot(relativePath: string): AgentOperationPathSnapshot {
  return { kind: "missing", relativePath };
}

function directorySnapshot(relativePath: string): AgentOperationPathSnapshot {
  return { kind: "directory", relativePath };
}

function fileSnapshot(relativePath: string, content: string): AgentOperationPathSnapshot {
  return { kind: "file", relativePath, content, checksum: checksum(content) };
}

function sameSnapshot(
  left: AgentOperationPathSnapshot,
  right: AgentOperationPathSnapshot
): boolean {
  if (left.kind !== right.kind || left.relativePath !== right.relativePath) return false;
  return left.kind !== "file" || (right.kind === "file" && left.checksum === right.checksum);
}

function snapshotsEquivalent(
  actual: readonly AgentOperationPathSnapshot[],
  expected: readonly AgentOperationPathSnapshot[]
): boolean {
  return (
    actual.length === expected.length &&
    expected.every((snapshot) => {
      const candidate = actual.find((value) => value.relativePath === snapshot.relativePath);
      return candidate !== undefined && sameSnapshot(candidate, snapshot);
    })
  );
}

function operationPaths(operation: AgentWriteTransactionOperation): readonly string[] {
  return operation.kind === "move_file"
    ? [operation.sourcePath, operation.targetPath]
    : [operation.relativePath];
}

function orderOperations(
  operations: readonly AgentWriteTransactionOperation[]
): Result<readonly AgentWriteTransactionOperation[], never> {
  const byId = new Map<string, AgentWriteTransactionOperation>();
  for (const operation of operations) {
    if (
      typeof operation.operationId !== "string" ||
      operation.operationId.length === 0 ||
      operation.operationId.length > 160 ||
      typeof operation.toolCallIdempotencyKey !== "string" ||
      operation.toolCallIdempotencyKey.length === 0 ||
      byId.has(operation.operationId)
    ) {
      return { ok: false, error: undefined as never };
    }
    byId.set(operation.operationId, operation);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: AgentWriteTransactionOperation[] = [];
  const visit = (operation: AgentWriteTransactionOperation): boolean => {
    if (visited.has(operation.operationId)) return true;
    if (visiting.has(operation.operationId)) return false;
    const dependencies = operation.dependsOn ?? [];
    if (new Set(dependencies).size !== dependencies.length) return false;
    visiting.add(operation.operationId);
    for (const dependency of dependencies) {
      const target = byId.get(dependency);
      if (target === undefined || !visit(target)) return false;
    }
    visiting.delete(operation.operationId);
    visited.add(operation.operationId);
    ordered.push(operation);
    return true;
  };
  for (const operation of operations) {
    if (!visit(operation)) return { ok: false, error: undefined as never };
  }
  return ok(ordered);
}

function operationHistorySnapshot(
  prepared: PreparedOperation
): { readonly relativePath: string; readonly content: string } | undefined {
  if (prepared.operation.kind === "create_file") {
    return { relativePath: prepared.operation.relativePath, content: "" };
  }
  const source = prepared.before.find((snapshot) => snapshot.kind === "file");
  return source?.kind === "file"
    ? { relativePath: source.relativePath, content: source.content }
    : undefined;
}

function lifecycleMutation(prepared: PreparedOperation): AgentWriteLifecycleMutation | undefined {
  const operation = prepared.operation;
  switch (operation.kind) {
    case "create_file":
      return {
        kind: "create_file",
        relativePath: operation.relativePath,
        content: operation.content,
        before: prepared.before,
        after: prepared.after
      };
    case "move_file":
      return {
        kind: "move_file",
        sourcePath: operation.sourcePath,
        targetPath: operation.targetPath,
        before: prepared.before,
        after: prepared.after
      };
    case "delete_file":
      return {
        kind: "delete_file",
        relativePath: operation.relativePath,
        before: prepared.before,
        after: prepared.after
      };
    case "create_directory":
    case "remove_directory":
      return {
        kind: operation.kind,
        relativePath: operation.relativePath,
        before: prepared.before,
        after: prepared.after
      };
    case "modify":
      return undefined;
  }
}

function inverseLifecycleMutation(
  entry: AgentTransactionJournalOperationEntry
): AgentWriteLifecycleMutation | undefined {
  const operation = entry.operation;
  switch (operation.kind) {
    case "create_file":
      return {
        kind: "delete_file",
        relativePath: operation.relativePath,
        before: entry.after,
        after: entry.before
      };
    case "delete_file": {
      const source = entry.before.find((snapshot) => snapshot.kind === "file");
      if (source?.kind !== "file") return undefined;
      return {
        kind: "create_file",
        relativePath: operation.relativePath,
        content: source.content,
        before: entry.after,
        after: entry.before
      };
    }
    case "move_file":
      return {
        kind: "move_file",
        sourcePath: operation.targetPath,
        targetPath: operation.sourcePath,
        before: entry.after,
        after: entry.before
      };
    case "create_directory":
      return {
        kind: "remove_directory",
        relativePath: operation.relativePath,
        before: entry.after,
        after: entry.before
      };
    case "remove_directory":
      return {
        kind: "create_directory",
        relativePath: operation.relativePath,
        before: entry.after,
        after: entry.before
      };
    case "modify":
      return undefined;
  }
}

function inverseJournalOperation(
  entry: AgentTransactionJournalOperationEntry,
  transactionId: string
): AgentWriteTransactionOperation | undefined {
  const operationId = `undo_${checksum(`${transactionId}:${entry.operationId}`).slice(0, 32)}`;
  const toolCallIdempotencyKey = `undo_${entry.operation.toolCallIdempotencyKey}`;
  switch (entry.operation.kind) {
    case "create_file": {
      const after = entry.after.find((snapshot) => snapshot.kind === "file");
      return after?.kind === "file"
        ? {
            kind: "delete_file",
            operationId,
            toolCallIdempotencyKey,
            relativePath: entry.operation.relativePath,
            baseChecksum: after.checksum
          }
        : undefined;
    }
    case "delete_file": {
      const before = entry.before.find((snapshot) => snapshot.kind === "file");
      return before?.kind === "file"
        ? {
            kind: "create_file",
            operationId,
            toolCallIdempotencyKey,
            relativePath: entry.operation.relativePath,
            content: before.content
          }
        : undefined;
    }
    case "move_file": {
      const sourcePath = entry.operation.sourcePath;
      const targetPath = entry.operation.targetPath;
      const after = entry.after.find(
        (snapshot) => snapshot.relativePath === targetPath && snapshot.kind === "file"
      );
      return after?.kind === "file"
        ? {
            kind: "move_file",
            operationId,
            toolCallIdempotencyKey,
            sourcePath: targetPath,
            targetPath: sourcePath,
            sourceChecksum: after.checksum
          }
        : undefined;
    }
    case "create_directory":
      return {
        kind: "remove_directory",
        operationId,
        toolCallIdempotencyKey,
        relativePath: entry.operation.relativePath
      };
    case "remove_directory":
      return {
        kind: "create_directory",
        operationId,
        toolCallIdempotencyKey,
        relativePath: entry.operation.relativePath
      };
    case "modify":
      return undefined;
  }
}

function requireFileSnapshot(
  snapshot: AgentOperationPathSnapshot,
  message: string
): Extract<AgentOperationPathSnapshot, { readonly kind: "file" }> {
  if (snapshot.kind !== "file") throw new Error(message);
  return snapshot;
}

function undoWriteId(transactionId: string, writeId: string): string {
  return `undo_${checksum(`${transactionId}:${writeId}`).slice(0, 32)}`;
}

function historyAssetIdForJournalEntry(entry: AgentTransactionJournalEntry): string {
  if (entry.assetId !== undefined) return entry.assetId;
  if (entry.assetType === "text") return entry.relativePath;
  return `chapter_${checksum(entry.relativePath).slice(0, 24)}`;
}

function historyAssetId(file: AgentWriteTransactionFile): string {
  if (file.assetId !== undefined) return file.assetId;
  if (file.assetType === "text") return file.relativePath;
  return `chapter_${checksum(file.relativePath).slice(0, 24)}`;
}

function createJournal(input: {
  readonly transactionId: string;
  readonly versionGroupId: string;
  readonly kind: AgentTransactionJournalKind;
  readonly runSequence: number;
  readonly input: TransactionExecutionInput;
  readonly preparedFiles: readonly PreparedFile[];
  readonly preparedOperations: readonly PreparedOperation[];
  readonly createdAt: string;
  readonly undoOfVersionGroupIds?: readonly string[];
}): AgentTransactionJournal {
  return freezeJournal({
    schemaVersion: "1.0",
    transactionId: input.transactionId,
    versionGroupId: input.versionGroupId,
    kind: input.kind,
    runId: input.input.runId,
    runSequence: input.runSequence,
    checkpointId: input.input.checkpointId,
    changeSetId: input.input.changeSetId,
    changeSetRevision: input.input.revision,
    changeSetChecksum: input.input.checksum,
    ...(input.kind === "apply" &&
    "writePolicy" in input.input &&
    "approvalSource" in input.input &&
    "approvalToken" in input.input
      ? {
          writePolicy: input.input.writePolicy,
          approvalSource: input.input.approvalSource,
          approvalToken: input.input.approvalToken
        }
      : {}),
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    transactionStatus: "prepared",
    entries: input.preparedFiles.map((file) => ({
      writeId: file.writeId,
      relativePath: file.relativePath,
      assetType: file.assetType,
      ...(file.assetId === undefined ? {} : { assetId: file.assetId }),
      beforeChecksum: file.baseChecksum,
      candidateChecksum: file.candidateChecksum,
      beforeContent: file.baseContent,
      candidateContent: file.candidateContent,
      ...(file.historyBaseContent === undefined
        ? {}
        : { historyBaseContent: file.historyBaseContent }),
      ...(file.historyCandidateContent === undefined
        ? {}
        : { historyCandidateContent: file.historyCandidateContent }),
      beforeVersionId: file.beforeVersionId,
      status: "pending"
    })),
    ...(input.preparedOperations.length === 0
      ? {}
      : {
          operations: input.preparedOperations.map((prepared) => ({
            operationId: prepared.operation.operationId,
            operation: prepared.operation,
            before: prepared.before,
            after: prepared.after,
            ...(prepared.beforeVersionId === undefined
              ? {}
              : { beforeVersionId: prepared.beforeVersionId }),
            status: "pending" as const
          }))
        }),
    mutationOrder: [
      ...input.preparedFiles.map((file) => ({ kind: "write" as const, id: file.writeId })),
      ...input.preparedOperations.map((prepared) => ({
        kind: "operation" as const,
        id: prepared.operation.operationId
      }))
    ],
    ...(input.undoOfVersionGroupIds === undefined
      ? {}
      : { undoOfVersionGroupIds: input.undoOfVersionGroupIds })
  });
}

function updateJournalEntry(
  journal: AgentTransactionJournal,
  writeId: string,
  update: Pick<AgentTransactionJournalEntry, "status"> & { readonly errorCode?: string },
  updatedAt: string
): AgentTransactionJournal {
  return freezeJournal({
    ...journal,
    updatedAt,
    entries: journal.entries.map((entry) =>
      entry.writeId === writeId
        ? {
            ...entry,
            status: update.status,
            ...(update.errorCode === undefined ? {} : { errorCode: update.errorCode })
          }
        : entry
    )
  });
}

function updateJournalOperation(
  journal: AgentTransactionJournal,
  operationId: string,
  update: Pick<AgentTransactionJournalOperationEntry, "status"> & {
    readonly errorCode?: string;
  },
  updatedAt: string
): AgentTransactionJournal {
  const operations = journal.operations;
  if (operations === undefined) return journal;
  return freezeJournal({
    ...journal,
    updatedAt,
    operations: operations.map((entry) =>
      entry.operationId === operationId
        ? {
            ...entry,
            status: update.status,
            ...(update.errorCode === undefined ? {} : { errorCode: update.errorCode })
          }
        : entry
    )
  });
}

function withJournalStatus(
  journal: AgentTransactionJournal,
  transactionStatus: AgentTransactionJournalStatus,
  updatedAt: string
): AgentTransactionJournal {
  return freezeJournal({ ...journal, transactionStatus, updatedAt });
}

function abortPreparedJournal(
  journal: AgentTransactionJournal,
  updatedAt: string
): AgentTransactionJournal {
  return freezeJournal({
    ...journal,
    updatedAt,
    transactionStatus: "rolled_back",
    entries: journal.entries.map((entry) => ({ ...entry, status: "rolled_back" })),
    ...(journal.operations === undefined
      ? {}
      : {
          operations: journal.operations.map((entry) => ({
            ...entry,
            status: "rolled_back" as const
          }))
        })
  });
}

function freezeJournal(journal: AgentTransactionJournal): AgentTransactionJournal {
  return Object.freeze({
    ...journal,
    entries: Object.freeze(journal.entries.map((entry) => Object.freeze({ ...entry }))),
    ...(journal.operations === undefined
      ? {}
      : {
          operations: Object.freeze(
            journal.operations.map((operation) =>
              Object.freeze({
                ...operation,
                operation: Object.freeze({
                  ...operation.operation,
                  ...(operation.operation.dependsOn === undefined
                    ? {}
                    : { dependsOn: Object.freeze([...operation.operation.dependsOn]) })
                }),
                before: Object.freeze(
                  operation.before.map((snapshot) => Object.freeze({ ...snapshot }))
                ),
                after: Object.freeze(
                  operation.after.map((snapshot) => Object.freeze({ ...snapshot }))
                )
              })
            )
          )
        }),
    ...(journal.mutationOrder === undefined
      ? {}
      : {
          mutationOrder: Object.freeze(
            journal.mutationOrder.map((mutation) => Object.freeze({ ...mutation }))
          )
        }),
    ...(journal.undoOfVersionGroupIds === undefined
      ? {}
      : { undoOfVersionGroupIds: Object.freeze([...journal.undoOfVersionGroupIds]) })
  });
}

function journalMutationOrder(
  journal: AgentTransactionJournal
): readonly AgentTransactionJournalMutationRecord[] {
  return (
    journal.mutationOrder ?? [
      ...journal.entries.map((entry) => ({ kind: "write" as const, id: entry.writeId })),
      ...(journal.operations ?? []).map((entry) => ({
        kind: "operation" as const,
        id: entry.operationId
      }))
    ]
  );
}

function rollbackDiff(currentContent: string, lastWriteContent: string, baselineContent: string) {
  return {
    currentToLastWrite: displayableDiff(
      "current",
      currentContent,
      "ai-last-write",
      lastWriteContent
    ),
    currentToBaseline: displayableDiff("current", currentContent, "baseline", baselineContent),
    lastWriteToBaseline: displayableDiff(
      "ai-last-write",
      lastWriteContent,
      "baseline",
      baselineContent
    )
  };
}

function displayableDiff(
  leftLabel: string,
  leftContent: string,
  rightLabel: string,
  rightContent: string
): string {
  if (leftContent === rightContent) return `${leftLabel} = ${rightLabel}`;
  return `--- ${leftLabel}\n+++ ${rightLabel}\n-${leftContent}\n+${rightContent}`;
}

function updateRollbackReviewFile(
  review: RollbackReviewRecord,
  relativePath: string,
  update: Partial<RollbackReviewFileRecord>,
  updatedAt: string
): RollbackReviewRecord {
  return freezeRollbackReview({
    ...review,
    updatedAt,
    files: review.files.map((file) =>
      file.relativePath === relativePath ? { ...file, ...update } : file
    )
  });
}

function replaceRollbackReviewFile(
  review: RollbackReviewRecord,
  replacement: RollbackReviewFileRecord,
  updatedAt: string
): RollbackReviewRecord {
  return freezeRollbackReview({
    ...review,
    updatedAt,
    files: review.files.map((file) =>
      file.relativePath === replacement.relativePath ? replacement : file
    )
  });
}

function resolvedRollbackFile(
  file: RollbackReviewFileRecord,
  decision: RollbackReviewDecisionRecord
): RollbackReviewFileRecord {
  return {
    relativePath: file.relativePath,
    assetType: file.assetType,
    ...(file.assetId === undefined ? {} : { assetId: file.assetId }),
    baselineContent: file.baselineContent,
    baselineChecksum: file.baselineChecksum,
    ...(file.baselineHistoryContent === undefined
      ? {}
      : { baselineHistoryContent: file.baselineHistoryContent }),
    baselineVersionId: file.baselineVersionId,
    runLastWriteContent: file.runLastWriteContent,
    runLastWriteChecksum: file.runLastWriteChecksum,
    ...(file.runLastWriteHistoryContent === undefined
      ? {}
      : { runLastWriteHistoryContent: file.runLastWriteHistoryContent }),
    reviewedCurrentContent: file.reviewedCurrentContent,
    reviewedCurrentChecksum: file.reviewedCurrentChecksum,
    ...(file.reviewedCurrentHistoryContent === undefined
      ? {}
      : { reviewedCurrentHistoryContent: file.reviewedCurrentHistoryContent }),
    ...(file.reviewedEditorChecksum === undefined
      ? {}
      : { reviewedEditorChecksum: file.reviewedEditorChecksum }),
    diff: file.diff,
    ...(file.snapshotVersionId === undefined ? {} : { snapshotVersionId: file.snapshotVersionId }),
    decision,
    status: decision === "keep_current" ? "kept" : "ready"
  };
}

function staleRollbackFile(
  file: RollbackReviewFileRecord,
  currentContent: string,
  currentChecksum: string,
  editorContent?: string
): RollbackReviewFileRecord {
  return {
    relativePath: file.relativePath,
    assetType: file.assetType,
    ...(file.assetId === undefined ? {} : { assetId: file.assetId }),
    baselineContent: file.baselineContent,
    baselineChecksum: file.baselineChecksum,
    ...(file.baselineHistoryContent === undefined
      ? {}
      : { baselineHistoryContent: file.baselineHistoryContent }),
    baselineVersionId: file.baselineVersionId,
    runLastWriteContent: file.runLastWriteContent,
    runLastWriteChecksum: file.runLastWriteChecksum,
    ...(file.runLastWriteHistoryContent === undefined
      ? {}
      : { runLastWriteHistoryContent: file.runLastWriteHistoryContent }),
    reviewedCurrentContent: currentContent,
    reviewedCurrentChecksum: currentChecksum,
    reviewedCurrentHistoryContent:
      editorContent ?? historyContentForAsset(file.assetType, currentContent),
    ...(editorContent === undefined ? {} : { reviewedEditorChecksum: checksum(editorContent) }),
    diff: rollbackDiff(
      editorContent ?? historyContentForAsset(file.assetType, currentContent),
      file.runLastWriteHistoryContent ?? file.runLastWriteContent,
      file.baselineHistoryContent ?? file.baselineContent
    ),
    status: "stale",
    errorCode: "AGENT_WRITE_UNDO_STALE"
  };
}

function rollbackCurrentMatches(
  file: RollbackReviewFileRecord,
  diskChecksum: string,
  editorContent: string | undefined
): boolean {
  return (
    diskChecksum === file.reviewedCurrentChecksum && rollbackEditorMatches(file, editorContent)
  );
}

function rollbackEditorMatches(
  file: RollbackReviewFileRecord,
  editorContent: string | undefined
): boolean {
  if (file.reviewedEditorChecksum === undefined) return editorContent === undefined;
  return editorContent !== undefined && checksum(editorContent) === file.reviewedEditorChecksum;
}

function historyContentForAsset(assetType: AgentWriteAssetType, content: string): string {
  if (assetType === "text") return content;
  const match = content.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/);
  return (match?.[1] ?? content).replace(/^\n/, "");
}

function withRollbackReviewStatus(
  review: RollbackReviewRecord,
  updatedAt: string
): RollbackReviewRecord {
  return freezeRollbackReview({
    ...review,
    status: rollbackReviewStatus(review.files),
    updatedAt
  });
}

function rollbackReviewStatus(
  files: readonly RollbackReviewFileRecord[]
): RollbackReviewRecord["status"] {
  if (files.every((file) => file.status === "completed" || file.status === "kept")) {
    return "completed";
  }
  if (files.some((file) => file.status === "failed")) return "partial_failure";
  return "pending";
}

function rollbackReviewDecisionsSettled(review: RollbackReviewRecord): boolean {
  return review.files.every(
    (file) => file.status === "ready" || file.status === "completed" || file.status === "kept"
  );
}

function rollbackReviewBoundToSource(review: RollbackReviewRecord, source: UndoSource): boolean {
  const firstJournal = source.journals[0];
  if (
    firstJournal === undefined ||
    review.runId !== firstJournal.runId ||
    review.reviewId !== `rollback_${checksum(review.runId).slice(0, 24)}` ||
    review.sourceVersionGroupIds.length !== source.versionGroupIds.length ||
    review.sourceVersionGroupIds.some((id, index) => id !== source.versionGroupIds[index]) ||
    review.files.length !== source.files.length
  ) {
    return false;
  }
  return review.files.every((file) => {
    const sourceFile = source.files.find(
      (candidate) => candidate.relativePath === file.relativePath
    );
    const baseline = source.baselineByPath[file.relativePath];
    return (
      sourceFile !== undefined &&
      baseline !== undefined &&
      file.assetType === sourceFile.assetType &&
      file.assetId === sourceFile.assetId &&
      file.baselineContent === sourceFile.candidateContent &&
      file.baselineChecksum === sourceFile.candidateChecksum &&
      file.baselineHistoryContent === sourceFile.historyCandidateContent &&
      file.baselineVersionId === baseline.beforeVersionId &&
      file.runLastWriteContent === sourceFile.baseContent &&
      file.runLastWriteChecksum === sourceFile.baseChecksum &&
      file.runLastWriteHistoryContent === sourceFile.historyBaseContent
    );
  });
}

function freezeRollbackReview(review: RollbackReviewRecord): RollbackReviewRecord {
  return Object.freeze({
    ...review,
    sourceVersionGroupIds: Object.freeze([...review.sourceVersionGroupIds]),
    processedCommandIds: Object.freeze([...review.processedCommandIds]),
    files: Object.freeze(
      review.files.map((file) => Object.freeze({ ...file, diff: Object.freeze({ ...file.diff }) }))
    )
  });
}

function rollbackWriteId(reviewId: string, relativePath: string): string {
  return `rollback_${checksum(`${reviewId}:${relativePath}`).slice(0, 24)}`;
}

function rollbackReviewUndoWriteStep(
  source: UndoWriteStep,
  review: RollbackReviewFileRecord
): UndoWriteStep {
  const currentContent = review.reviewedCurrentContent;
  return {
    kind: "write",
    writeId: rollbackWriteId(`undo_${source.writeId}`, review.relativePath),
    source: {
      ...source.source,
      beforeChecksum: review.baselineChecksum,
      candidateChecksum: review.reviewedCurrentChecksum,
      beforeContent: review.baselineContent,
      candidateContent: currentContent,
      ...(review.baselineHistoryContent === undefined
        ? {}
        : { historyBaseContent: review.baselineHistoryContent }),
      historyCandidateContent:
        review.reviewedCurrentHistoryContent ??
        historyContentForAsset(review.assetType, currentContent)
    },
    before: [fileSnapshot(review.relativePath, currentContent)],
    after: [fileSnapshot(review.relativePath, review.baselineContent)]
  };
}

function groupFromJournal(
  journal: AgentTransactionJournal,
  transactionStatus: VersionGroupTransactionStatus,
  failureKind: VersionGroupFailureKind | undefined
): VersionGroupRecord {
  const baselineByPath = Object.fromEntries(
    journal.entries.map((entry) => [
      entry.relativePath,
      {
        relativePath: entry.relativePath,
        checksum: entry.beforeChecksum,
        beforeVersionId: entry.beforeVersionId
      }
    ])
  );
  const writes: VersionGroupWriteRecord[] = journal.entries.map((entry) => ({
    writeId: entry.writeId,
    relativePath: entry.relativePath,
    assetType: entry.assetType,
    beforeChecksum: entry.beforeChecksum,
    afterChecksum: entry.candidateChecksum,
    beforeVersionId: entry.beforeVersionId,
    status: entry.status,
    ...(entry.errorCode === undefined ? {} : { errorCode: entry.errorCode })
  }));
  const operations: VersionGroupOperationRecord[] = (journal.operations ?? []).map((entry) => ({
    operationId: entry.operationId,
    kind: entry.operation.kind,
    relativePaths: operationPaths(entry.operation),
    status: entry.status,
    ...(entry.errorCode === undefined ? {} : { errorCode: entry.errorCode })
  }));
  const undoStatus =
    transactionStatus === "applied"
      ? journal.kind === "apply"
        ? "available"
        : "completed"
      : transactionStatus === "partial_failure"
        ? "partial_failure"
        : "not_available";
  return freezeGroup({
    schemaVersion: "1.0",
    versionGroupId: journal.versionGroupId,
    runId: journal.runId,
    checkpointId: journal.checkpointId,
    changeSetId: journal.changeSetId,
    changeSetRevision: journal.changeSetRevision,
    changeSetChecksum: journal.changeSetChecksum,
    ...(journal.writePolicy === undefined ? {} : { writePolicy: journal.writePolicy }),
    ...(journal.approvalSource === undefined ? {} : { approvalSource: journal.approvalSource }),
    createdAt: journal.createdAt,
    writes,
    ...(operations.length === 0 ? {} : { operations }),
    baselineByPath,
    transactionStatus,
    undoStatus,
    undoMetadata: undoMetadata(
      journal.runId,
      journal.versionGroupId,
      baselineByPath,
      writes,
      journal.undoOfVersionGroupIds
    ),
    ...(failureKind === undefined ? {} : { failureKind })
  });
}

function undoMetadata(
  runId: string,
  versionGroupId: string,
  baselineByPath: Readonly<Record<string, VersionGroupBaselineRecord>>,
  writes: readonly VersionGroupWriteRecord[],
  undoOfVersionGroupIds?: readonly string[]
) {
  return {
    runId,
    versionGroupId,
    baselineVersionIds: Object.fromEntries(
      Object.entries(baselineByPath).map(([path, baseline]) => [path, baseline.beforeVersionId])
    ),
    lastWriteChecksums: Object.fromEntries(
      writes.map((write) => [write.relativePath, write.afterChecksum])
    ),
    ...(undoOfVersionGroupIds === undefined ? {} : { undoOfVersionGroupIds })
  };
}

function freezeGroup(group: VersionGroupRecord): VersionGroupRecord {
  return Object.freeze({
    ...group,
    writes: Object.freeze(group.writes.map((write) => Object.freeze({ ...write }))),
    ...(group.operations === undefined
      ? {}
      : {
          operations: Object.freeze(
            group.operations.map((operation) =>
              Object.freeze({
                ...operation,
                relativePaths: Object.freeze([...operation.relativePaths])
              })
            )
          )
        }),
    baselineByPath: Object.freeze(
      Object.fromEntries(
        Object.entries(group.baselineByPath).map(([path, baseline]) => [
          path,
          Object.freeze({ ...baseline })
        ])
      )
    ),
    undoMetadata: Object.freeze({
      ...group.undoMetadata,
      baselineVersionIds: Object.freeze({ ...group.undoMetadata.baselineVersionIds }),
      lastWriteChecksums: Object.freeze({ ...group.undoMetadata.lastWriteChecksums }),
      ...(group.undoMetadata.undoOfVersionGroupIds === undefined
        ? {}
        : { undoOfVersionGroupIds: Object.freeze([...group.undoMetadata.undoOfVersionGroupIds]) })
    })
  });
}

function isIncompleteJournal(journal: AgentTransactionJournal): boolean {
  return journal.transactionStatus !== "applied" && journal.transactionStatus !== "rolled_back";
}

function compareJournals(left: AgentTransactionJournal, right: AgentTransactionJournal): number {
  const runSequence = left.runSequence - right.runSequence;
  if (runSequence !== 0) return runSequence;
  const createdAt = left.createdAt.localeCompare(right.createdAt);
  return createdAt === 0 ? left.transactionId.localeCompare(right.transactionId) : createdAt;
}

function checksum(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function approvalToken(changeSetId: string, revision: number, changeSetChecksum: string): string {
  return checksum(`${changeSetId}:${revision}:${changeSetChecksum}`);
}

function checksumBytes(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

function agentWriteErrorMessage(code: string): string {
  if (code === "AGENT_WRITE_BASE_CONFLICT") return "Agent write base content has changed.";
  if (code === "AGENT_WRITE_PATH_REJECTED") return "Agent write target path was rejected.";
  if (code === "AGENT_WRITE_UNDO_CONFLICT") return "Agent write undo conflicts with later edits.";
  return "Agent write transaction could not continue.";
}

function agentWriteSuggestedAction(code: string): string {
  if (code.includes("CONFLICT")) return "Review the latest file content before retrying.";
  if (code.includes("PATH")) return "Use an existing project-relative allowed UTF-8 text file.";
  return "Retry from the approved Change Set after reviewing transaction recovery.";
}

function requireDefined<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}
