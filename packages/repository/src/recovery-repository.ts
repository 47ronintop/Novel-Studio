import { createHash } from "node:crypto";
import { join } from "node:path";
import { lstat, readdir, readFile } from "node:fs/promises";
import { err, ok, type Result, type UnifiedError } from "@novel-studio/shared";
import {
  createProjectPathGuard,
  verifyProjectStoragePath,
  writeTextAtomically,
  type ProjectPathGuard
} from "./atomic-write.js";
import { storageError, validationError } from "./errors.js";
import type {
  AgentTransactionJournal,
  AgentWriteRecoveryPort,
  RollbackReviewRecord,
  RecoveryRecord,
  RecoveryRepositoryPort
} from "./ports.js";
import { validateWithSchema } from "./schema-validation.js";

export interface RecoveryRepositoryOptions {
  projectRoot: string;
  traceId?: string;
  maxRollbackReviewBytes?: number;
}

export class RecoveryRepository implements RecoveryRepositoryPort, AgentWriteRecoveryPort {
  private readonly traceId: string;
  private readonly pathGuard: ProjectPathGuard;
  private readonly maxRollbackReviewBytes: number;

  public constructor(private readonly options: RecoveryRepositoryOptions) {
    this.traceId = options.traceId ?? "trace_repository_recovery";
    this.pathGuard = createProjectPathGuard(options.projectRoot);
    this.maxRollbackReviewBytes = options.maxRollbackReviewBytes ?? 32 * 1024 * 1024;
  }

  public async writeRecoveryRecord(
    record: RecoveryRecord
  ): Promise<Result<RecoveryRecord, UnifiedError>> {
    const validation = await validateWithSchema("recovery-record", record);
    if (!validation.valid) {
      return err(
        validationError({
          code: "RECOVERY_RECORD_INVALID",
          message: "Recovery record failed schema validation.",
          suggestedAction: "Fix recovery metadata before writing it.",
          traceId: this.traceId,
          redactedDetail: {
            sessionId: record.sessionId,
            issues: validation.issues.map((issue) => ({
              instancePath: issue.instancePath,
              schemaPath: issue.schemaPath,
              keyword: issue.keyword,
              message: issue.message
            }))
          }
        })
      );
    }

    const writeResult = await writeTextAtomically({
      targetPath: join(this.options.projectRoot, "history", "recovery", `${record.sessionId}.json`),
      content: `${JSON.stringify(record, null, 2)}\n`,
      traceId: this.traceId,
      pathGuard: this.pathGuard
    });

    if (!writeResult.ok) {
      return writeResult;
    }

    return ok(record);
  }

  public async listRecoveryRecords(): Promise<Result<readonly RecoveryRecord[], UnifiedError>> {
    const recoveryDirectory = join(this.options.projectRoot, "history", "recovery");
    const pathValidation = await verifyProjectStoragePath(
      this.pathGuard,
      recoveryDirectory,
      this.traceId
    );
    if (!pathValidation.ok) return pathValidation;
    let entries: readonly string[];

    try {
      entries = await readdir(recoveryDirectory);
    } catch (error) {
      if (isMissingDirectoryError(error)) {
        return ok([]);
      }

      return err(
        storageError({
          code: "RECOVERY_DIRECTORY_READ_FAILED",
          message: "Recovery records could not be read.",
          suggestedAction: "Check project folder permissions and retry.",
          traceId: this.traceId,
          redactedDetail: {
            reason: error instanceof Error ? error.message : "Unknown readdir error"
          }
        })
      );
    }

    const records: RecoveryRecord[] = [];
    for (const entry of entries.filter((name) => name.endsWith(".json"))) {
      const filePath = join(recoveryDirectory, entry);
      let parsed: unknown;

      try {
        parsed = JSON.parse(await readFile(filePath, "utf8"));
      } catch (error) {
        return err(
          storageError({
            code: "RECOVERY_RECORD_READ_FAILED",
            message: "A recovery record could not be read.",
            suggestedAction: "Inspect the recovery record or restore it from backup.",
            traceId: this.traceId,
            redactedDetail: {
              fileName: entry,
              reason: error instanceof Error ? error.message : "Unknown read error"
            }
          })
        );
      }

      const validation = await validateWithSchema("recovery-record", parsed);
      if (!validation.valid) {
        return err(
          validationError({
            code: "RECOVERY_RECORD_INVALID",
            message: "Recovery record failed schema validation.",
            suggestedAction: "Fix recovery metadata before reading it.",
            traceId: this.traceId,
            redactedDetail: {
              fileName: entry,
              issues: validation.issues.map((issue) => ({
                instancePath: issue.instancePath,
                schemaPath: issue.schemaPath,
                keyword: issue.keyword,
                message: issue.message
              }))
            }
          })
        );
      }

      records.push(parsed as RecoveryRecord);
    }

    return ok(records.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
  }

  public async writeAgentTransactionJournal(
    journal: AgentTransactionJournal
  ): Promise<Result<AgentTransactionJournal, UnifiedError>> {
    if (!isAgentTransactionJournal(journal)) {
      return err(
        validationError({
          code: "AGENT_TRANSACTION_JOURNAL_INVALID",
          message: "Agent transaction journal failed validation.",
          suggestedAction: "Recreate the write transaction from the approved Change Set.",
          traceId: this.traceId
        })
      );
    }

    const writeResult = await writeTextAtomically({
      targetPath: this.agentTransactionJournalPath(journal.transactionId),
      content: `${JSON.stringify(journal, null, 2)}\n`,
      traceId: this.traceId,
      pathGuard: this.pathGuard
    });
    return writeResult.ok ? ok(journal) : writeResult;
  }

  public async readAgentTransactionJournal(
    transactionId: string
  ): Promise<Result<AgentTransactionJournal, UnifiedError>> {
    if (!isSafeTransactionId(transactionId)) {
      return this.invalidTransactionId();
    }

    try {
      const journalPath = this.agentTransactionJournalPath(transactionId);
      const pathValidation = await verifyProjectStoragePath(
        this.pathGuard,
        journalPath,
        this.traceId
      );
      if (!pathValidation.ok) return pathValidation;
      const parsed = JSON.parse(
        await readFile(journalPath, "utf8")
      ) as unknown;
      const normalized = normalizeAgentTransactionJournal(parsed);
      if (!isAgentTransactionJournal(normalized) || normalized.transactionId !== transactionId) {
        return err(
          validationError({
            code: "AGENT_TRANSACTION_JOURNAL_INVALID",
            message: "Agent transaction journal failed validation.",
            suggestedAction: "Inspect the recovery journal before retrying compensation.",
            traceId: this.traceId,
            redactedDetail: { transactionId }
          })
        );
      }
      return ok(normalized);
    } catch (error) {
      return err(
        storageError({
          code: "AGENT_TRANSACTION_JOURNAL_READ_FAILED",
          message: "Agent transaction journal could not be read.",
          suggestedAction: "Inspect project recovery data and retry.",
          traceId: this.traceId,
          redactedDetail: {
            transactionId,
            reason: error instanceof Error ? error.message : "Unknown journal read error"
          }
        })
      );
    }
  }

  public async listAgentTransactionJournals(): Promise<
    Result<readonly AgentTransactionJournal[], UnifiedError>
  > {
    const directory = join(this.options.projectRoot, "history", "agent-transactions");
    const pathValidation = await verifyProjectStoragePath(
      this.pathGuard,
      directory,
      this.traceId
    );
    if (!pathValidation.ok) return pathValidation;
    let entries: readonly string[];
    try {
      entries = await readdir(directory);
    } catch (error) {
      if (isMissingDirectoryError(error)) {
        return ok([]);
      }
      return err(
        storageError({
          code: "AGENT_TRANSACTION_DIRECTORY_READ_FAILED",
          message: "Agent transaction journals could not be listed.",
          suggestedAction: "Check project history permissions and retry.",
          traceId: this.traceId,
          redactedDetail: {
            reason: error instanceof Error ? error.message : "Unknown journal list error"
          }
        })
      );
    }

    const journals: AgentTransactionJournal[] = [];
    for (const entry of entries.filter((name) => name.endsWith(".json")).sort()) {
      const readResult = await this.readAgentTransactionJournal(entry.slice(0, -5));
      if (!readResult.ok) {
        return readResult;
      }
      journals.push(readResult.value);
    }
    journals.sort((left, right) => {
      const createdAt = left.createdAt.localeCompare(right.createdAt);
      return createdAt === 0 ? left.transactionId.localeCompare(right.transactionId) : createdAt;
    });
    return ok(journals);
  }

  public async writeRollbackReview(
    review: RollbackReviewRecord
  ): Promise<Result<RollbackReviewRecord, UnifiedError>> {
    if (!isRollbackReviewRecord(review)) {
      return err(
        validationError({
          code: "ROLLBACK_REVIEW_INVALID",
          message: "Rollback review failed validation.",
          suggestedAction: "Recreate the run undo review from durable Agent write history.",
          traceId: this.traceId
        })
      );
    }
    const content = `${JSON.stringify(review, null, 2)}\n`;
    if (Buffer.byteLength(content, "utf8") > this.maxRollbackReviewBytes) {
      return this.rollbackReviewTooLarge();
    }
    const writeResult = await writeTextAtomically({
      targetPath: this.rollbackReviewPath(review.runId),
      content,
      traceId: this.traceId,
      pathGuard: this.pathGuard
    });
    return writeResult.ok ? ok(review) : writeResult;
  }

  public async readRollbackReview(
    runId: string
  ): Promise<Result<RollbackReviewRecord | undefined, UnifiedError>> {
    if (!isSafeRunId(runId)) {
      return err(
        validationError({
          code: "ROLLBACK_REVIEW_RUN_ID_INVALID",
          message: "Rollback review run id is invalid.",
          suggestedAction: "Use the run id recorded by Novel Studio.",
          traceId: this.traceId
        })
      );
    }
    try {
      const reviewPath = this.rollbackReviewPath(runId);
      const pathValidation = await verifyProjectStoragePath(
        this.pathGuard,
        reviewPath,
        this.traceId
      );
      if (!pathValidation.ok) return pathValidation;
      const metadata = await lstat(reviewPath);
      if (!metadata.isFile() || metadata.size > this.maxRollbackReviewBytes) {
        return this.rollbackReviewTooLarge();
      }
      const parsed = JSON.parse(await readFile(reviewPath, "utf8")) as unknown;
      if (!isRollbackReviewRecord(parsed) || parsed.runId !== runId) {
        return err(
          validationError({
            code: "ROLLBACK_REVIEW_INVALID",
            message: "Rollback review failed validation.",
            suggestedAction: "Inspect the durable rollback review before retrying.",
            traceId: this.traceId
          })
        );
      }
      return ok(parsed);
    } catch (error) {
      if (isMissingDirectoryError(error)) return ok(undefined);
      return err(
        storageError({
          code: "ROLLBACK_REVIEW_READ_FAILED",
          message: "Rollback review could not be read.",
          suggestedAction: "Inspect project recovery data and retry.",
          traceId: this.traceId,
          redactedDetail: {
            runId,
            reason: error instanceof Error ? error.message : "Unknown rollback review read error"
          }
        })
      );
    }
  }

  private agentTransactionJournalPath(transactionId: string): string {
    return join(this.options.projectRoot, "history", "agent-transactions", `${transactionId}.json`);
  }

  private rollbackReviewPath(runId: string): string {
    return join(this.options.projectRoot, "history", "rollback-reviews", `${runId}.json`);
  }

  private rollbackReviewTooLarge(): Result<never, UnifiedError> {
    return err(
      validationError({
        code: "ROLLBACK_REVIEW_TOO_LARGE",
        message: "Rollback review exceeds the supported size limit.",
        suggestedAction: "Recreate the review with fewer or smaller files.",
        traceId: this.traceId
      })
    );
  }

  private invalidTransactionId(): Result<never, UnifiedError> {
    return err(
      validationError({
        code: "AGENT_TRANSACTION_ID_INVALID",
        message: "Agent transaction id is invalid.",
        suggestedAction: "Use the transaction id recorded by Novel Studio.",
        traceId: this.traceId
      })
    );
  }
}

function isSafeTransactionId(transactionId: string): boolean {
  return /^tx_[A-Za-z0-9_-]+$/.test(transactionId);
}

function isSafeRunId(runId: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(runId);
}

function isRollbackReviewRecord(value: unknown): value is RollbackReviewRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const review = value as Partial<RollbackReviewRecord>;
  if (
    !(
    review.schemaVersion === "1.0" &&
    typeof review.reviewId === "string" &&
    typeof review.runId === "string" &&
    isSafeRunId(review.runId) &&
    review.reviewId === `rollback_${checksum(review.runId).slice(0, 24)}` &&
    (review.status === "pending" ||
      review.status === "partial_failure" ||
      review.status === "completed") &&
    Array.isArray(review.sourceVersionGroupIds) &&
    review.sourceVersionGroupIds.length > 0 &&
    review.sourceVersionGroupIds.length <= 64 &&
    review.sourceVersionGroupIds.every((id) => typeof id === "string" && isSafeRunId(id)) &&
    new Set(review.sourceVersionGroupIds).size === review.sourceVersionGroupIds.length &&
    typeof review.createdAt === "string" && review.createdAt.length > 0 &&
    typeof review.updatedAt === "string" && review.updatedAt.length > 0 &&
    Array.isArray(review.processedCommandIds) &&
    review.processedCommandIds.length <= 1024 &&
    review.processedCommandIds.every(
      (id) => typeof id === "string" && id.length > 0 && id.length <= 256
    ) &&
    new Set(review.processedCommandIds).size === review.processedCommandIds.length &&
    Array.isArray(review.files) &&
    review.files.length > 0 &&
    review.files.length <= 64 &&
    review.files.every(isRollbackReviewFileRecord) &&
    new Set(review.files.map((file) => file.relativePath)).size === review.files.length
    )
  ) {
    return false;
  }
  return rollbackReviewRecordStatus(review.files) === review.status;
}

function isRollbackReviewFileRecord(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const file = value as Record<string, unknown>;
  const diff = file["diff"];
  if (!(
    typeof file["relativePath"] === "string" &&
    isSafeRollbackRelativePath(file["relativePath"]) &&
    (file["assetType"] === "chapter" || file["assetType"] === "text") &&
    (file["assetId"] === undefined ||
      (typeof file["assetId"] === "string" && file["assetId"].length > 0)) &&
    typeof file["baselineContent"] === "string" &&
    rollbackContentFits(file["baselineContent"]) &&
    typeof file["baselineChecksum"] === "string" &&
    checksum(file["baselineContent"]) === file["baselineChecksum"] &&
    (file["baselineHistoryContent"] === undefined ||
      (typeof file["baselineHistoryContent"] === "string" &&
        rollbackContentFits(file["baselineHistoryContent"]))) &&
    typeof file["baselineVersionId"] === "string" && file["baselineVersionId"].length > 0 &&
    typeof file["runLastWriteContent"] === "string" &&
    rollbackContentFits(file["runLastWriteContent"]) &&
    typeof file["runLastWriteChecksum"] === "string" &&
    checksum(file["runLastWriteContent"]) === file["runLastWriteChecksum"] &&
    (file["runLastWriteHistoryContent"] === undefined ||
      (typeof file["runLastWriteHistoryContent"] === "string" &&
        rollbackContentFits(file["runLastWriteHistoryContent"]))) &&
    typeof file["reviewedCurrentContent"] === "string" &&
    rollbackContentFits(file["reviewedCurrentContent"]) &&
    typeof file["reviewedCurrentChecksum"] === "string" &&
    checksum(file["reviewedCurrentContent"]) === file["reviewedCurrentChecksum"] &&
    (file["reviewedCurrentHistoryContent"] === undefined ||
      (typeof file["reviewedCurrentHistoryContent"] === "string" &&
        rollbackContentFits(file["reviewedCurrentHistoryContent"]))) &&
    (file["reviewedEditorChecksum"] === undefined ||
      (typeof file["reviewedEditorChecksum"] === "string" &&
        /^[a-f0-9]{64}$/.test(file["reviewedEditorChecksum"]))) &&
    typeof diff === "object" &&
    diff !== null &&
    typeof (diff as Record<string, unknown>)["currentToLastWrite"] === "string" &&
    typeof (diff as Record<string, unknown>)["currentToBaseline"] === "string" &&
    typeof (diff as Record<string, unknown>)["lastWriteToBaseline"] === "string" &&
    (file["decision"] === undefined ||
      file["decision"] === "keep_current" ||
      file["decision"] === "restore_baseline") &&
    (file["status"] === "ready" ||
      file["status"] === "conflict" ||
      file["status"] === "stale" ||
      file["status"] === "failed" ||
      file["status"] === "completed" ||
      file["status"] === "kept") &&
    (file["snapshotVersionId"] === undefined || typeof file["snapshotVersionId"] === "string") &&
    (file["errorCode"] === undefined || typeof file["errorCode"] === "string")
  )) return false;
  const assetType = file["assetType"] as "chapter" | "text";
  const current =
    (file["reviewedCurrentHistoryContent"] as string | undefined) ??
    rollbackHistoryContent(assetType, file["reviewedCurrentContent"] as string);
  const lastWrite =
    (file["runLastWriteHistoryContent"] as string | undefined) ??
    rollbackHistoryContent(assetType, file["runLastWriteContent"] as string);
  const baseline =
    (file["baselineHistoryContent"] as string | undefined) ??
    rollbackHistoryContent(assetType, file["baselineContent"] as string);
  const typedDiff = diff as Record<string, unknown>;
  return (
    typedDiff["currentToLastWrite"] === rollbackDisplayableDiff("current", current, "ai-last-write", lastWrite) &&
    typedDiff["currentToBaseline"] === rollbackDisplayableDiff("current", current, "baseline", baseline) &&
    typedDiff["lastWriteToBaseline"] === rollbackDisplayableDiff("ai-last-write", lastWrite, "baseline", baseline) &&
    rollbackFileStateIsValid(file)
  );
}

function rollbackContentFits(content: string): boolean {
  return Buffer.byteLength(content, "utf8") <= 1024 * 1024;
}

function isSafeRollbackRelativePath(relativePath: string): boolean {
  const segments = relativePath.split("/");
  return (
    relativePath.length > 0 &&
    relativePath.length <= 1024 &&
    !relativePath.includes("\\") &&
    !relativePath.includes(":") &&
    !relativePath.includes("\0") &&
    !relativePath.startsWith("/") &&
    segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..") &&
    ![".git", ".novel-studio", "node_modules", "history", "dist", "build", ".cache"].includes(
      (segments[0] ?? "").toLowerCase()
    ) &&
    /\.(?:md|txt|json|ya?ml|toml)$/i.test(relativePath)
  );
}

function rollbackHistoryContent(assetType: "chapter" | "text", content: string): string {
  if (assetType === "text") return content;
  const match = content.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/);
  return (match?.[1] ?? content).replace(/^\n/, "");
}

function rollbackDisplayableDiff(
  leftLabel: string,
  leftContent: string,
  rightLabel: string,
  rightContent: string
): string {
  if (leftContent === rightContent) return `${leftLabel} = ${rightLabel}`;
  return `--- ${leftLabel}\n+++ ${rightLabel}\n-${leftContent}\n+${rightContent}`;
}

function rollbackFileStateIsValid(file: Record<string, unknown>): boolean {
  switch (file["status"]) {
    case "ready":
      return file["decision"] === "restore_baseline";
    case "conflict":
    case "stale":
      return file["decision"] === undefined && typeof file["errorCode"] === "string";
    case "failed":
      return file["decision"] === "restore_baseline" && typeof file["errorCode"] === "string";
    case "completed":
      return file["decision"] === "restore_baseline";
    case "kept":
      return file["decision"] === "keep_current";
    default:
      return false;
  }
}

function rollbackReviewRecordStatus(
  files: readonly RollbackReviewRecord["files"][number][]
): RollbackReviewRecord["status"] {
  if (files.every((file) => file.status === "completed" || file.status === "kept")) {
    return "completed";
  }
  return files.some((file) => file.status === "failed") ? "partial_failure" : "pending";
}

function normalizeAgentTransactionJournal(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const journal = value as Record<string, unknown>;
  if (
    journal["kind"] !== "apply" ||
    Object.prototype.hasOwnProperty.call(journal, "writePolicy") ||
    journal["approvalSource"] !== "human_confirmation"
  ) {
    return value;
  }
  return {
    ...journal,
    writePolicy: "write_before_confirmation"
  };
}

function isAgentTransactionJournal(value: unknown): value is AgentTransactionJournal {
  if (typeof value !== "object" || value === null) return false;
  const journal = value as Partial<AgentTransactionJournal>;
  if (
    journal.schemaVersion !== "1.0" ||
    typeof journal.transactionId !== "string" ||
    !isSafeTransactionId(journal.transactionId) ||
    typeof journal.versionGroupId !== "string" ||
    (journal.kind !== "apply" &&
      journal.kind !== "version_group_undo" &&
      journal.kind !== "run_undo") ||
    typeof journal.runId !== "string" ||
    typeof journal.runSequence !== "number" ||
    !Number.isSafeInteger(journal.runSequence) ||
    journal.runSequence < 1 ||
    typeof journal.checkpointId !== "string" ||
    typeof journal.changeSetId !== "string" ||
    typeof journal.changeSetRevision !== "number" ||
    !Number.isSafeInteger(journal.changeSetRevision) ||
    journal.changeSetRevision < 0 ||
    typeof journal.changeSetChecksum !== "string" ||
    !/^[a-f0-9]{64}$/.test(journal.changeSetChecksum) ||
    typeof journal.createdAt !== "string" ||
    typeof journal.updatedAt !== "string" ||
    !isTransactionStatus(journal.transactionStatus) ||
    !Array.isArray(journal.entries)
  ) {
    return false;
  }
  if (!hasValidApprovalBinding(journal)) return false;
  if (!journal.entries.every(isAgentTransactionJournalEntry)) return false;
  const writeIds = new Set(journal.entries.map((entry) => entry.writeId));
  const relativePaths = new Set(journal.entries.map((entry) => entry.relativePath));
  return writeIds.size === journal.entries.length && relativePaths.size === journal.entries.length;
}

function hasValidApprovalBinding(journal: Partial<AgentTransactionJournal>): boolean {
  if (journal.kind !== "apply") {
    return (
      journal.writePolicy === undefined &&
      journal.approvalSource === undefined &&
      journal.approvalToken === undefined
    );
  }
  return (
    (journal.writePolicy === "write_before_confirmation" ||
      journal.writePolicy === "user_preapproved_run") &&
    (journal.approvalSource === "human_confirmation" ||
      journal.approvalSource === "user_preapproved_run") &&
    (journal.approvalSource !== "user_preapproved_run" ||
      journal.writePolicy === "user_preapproved_run") &&
    typeof journal.changeSetRevision === "number" &&
    journal.changeSetRevision >= 1 &&
    typeof journal.approvalToken === "string" &&
    journal.approvalToken ===
      checksum(`${journal.changeSetId}:${journal.changeSetRevision}:${journal.changeSetChecksum}`)
  );
}

function isAgentTransactionJournalEntry(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<AgentTransactionJournal["entries"][number]>;
  return (
    typeof entry.writeId === "string" &&
    typeof entry.relativePath === "string" &&
    (entry.assetType === "chapter" || entry.assetType === "text") &&
    (entry.assetId === undefined || typeof entry.assetId === "string") &&
    typeof entry.beforeChecksum === "string" &&
    /^[a-f0-9]{64}$/.test(entry.beforeChecksum) &&
    typeof entry.candidateChecksum === "string" &&
    /^[a-f0-9]{64}$/.test(entry.candidateChecksum) &&
    typeof entry.beforeContent === "string" &&
    typeof entry.candidateContent === "string" &&
    checksum(entry.beforeContent) === entry.beforeChecksum &&
    checksum(entry.candidateContent) === entry.candidateChecksum &&
    (entry.historyBaseContent === undefined || typeof entry.historyBaseContent === "string") &&
    (entry.historyCandidateContent === undefined ||
      typeof entry.historyCandidateContent === "string") &&
    typeof entry.beforeVersionId === "string" &&
    (entry.status === "pending" ||
      entry.status === "applied" ||
      entry.status === "rolled_back" ||
      entry.status === "rollback_failed")
  );
}

function checksum(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function isTransactionStatus(value: unknown): boolean {
  return (
    value === "prepared" ||
    value === "applying" ||
    value === "compensating" ||
    value === "applied" ||
    value === "rolled_back" ||
    value === "partial_failure"
  );
}

function isMissingDirectoryError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "ENOENT"
  );
}
