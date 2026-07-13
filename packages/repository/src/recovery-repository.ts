import { createHash } from "node:crypto";
import { join } from "node:path";
import { readdir, readFile } from "node:fs/promises";
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
  RecoveryRecord,
  RecoveryRepositoryPort
} from "./ports.js";
import { validateWithSchema } from "./schema-validation.js";

export interface RecoveryRepositoryOptions {
  projectRoot: string;
  traceId?: string;
}

export class RecoveryRepository implements RecoveryRepositoryPort, AgentWriteRecoveryPort {
  private readonly traceId: string;
  private readonly pathGuard: ProjectPathGuard;

  public constructor(private readonly options: RecoveryRepositoryOptions) {
    this.traceId = options.traceId ?? "trace_repository_recovery";
    this.pathGuard = createProjectPathGuard(options.projectRoot);
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
      if (!isAgentTransactionJournal(parsed) || parsed.transactionId !== transactionId) {
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
      return ok(parsed);
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

  private agentTransactionJournalPath(transactionId: string): string {
    return join(this.options.projectRoot, "history", "agent-transactions", `${transactionId}.json`);
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
    return journal.approvalSource === undefined && journal.approvalToken === undefined;
  }
  return (
    journal.approvalSource === "human_confirmation" &&
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
