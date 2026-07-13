import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { extname, isAbsolute, join, relative } from "node:path";

import { err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import { writeTextAtomically } from "./atomic-write.js";
import { storageError, validationError } from "./errors.js";
import type {
  AgentTransactionJournal,
  AgentTransactionJournalEntry,
  AgentTransactionJournalKind,
  AgentTransactionJournalStatus,
  AgentWriteHistoryPort,
  AgentWriteProjectLockPort,
  AgentWriteRecoveryPort,
  AgentWriteTransactionFile,
  AgentWriteTransactionInput,
  SnapshotReason,
  VersionGroupBaselineRecord,
  VersionGroupFailureKind,
  VersionGroupRecord,
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

export interface AgentWriteTransactionOptions {
  readonly projectRoot: string;
  readonly projectLock: AgentWriteProjectLockPort;
  readonly historyRepository: AgentWriteHistoryPort;
  readonly recoveryRepository: AgentWriteRecoveryPort;
  readonly now?: () => string;
  readonly createTransactionId?: () => string;
  readonly createVersionGroupId?: () => string;
  readonly createWriteId?: () => string;
  readonly replaceFile?: (input: AgentWriteReplaceInput) => Promise<Result<void, UnifiedError>>;
  readonly traceId?: string;
}

interface PreparedFile extends AgentWriteTransactionFile {
  readonly targetPath: string;
  readonly writeId: string;
  readonly beforeVersionId: string;
}

interface ExecuteTransactionOptions {
  readonly kind: AgentTransactionJournalKind;
  readonly snapshotReason: SnapshotReason;
  readonly undoOfVersionGroupIds?: readonly string[];
}

type AgentUndoTransactionInput = Omit<
  AgentWriteTransactionInput,
  "approvalSource" | "approvalToken"
>;
type TransactionExecutionInput = AgentWriteTransactionInput | AgentUndoTransactionInput;

interface UndoSource {
  readonly journals: readonly AgentTransactionJournal[];
  readonly files: readonly AgentWriteTransactionFile[];
  readonly baselineByPath: Readonly<Record<string, VersionGroupBaselineRecord>>;
  readonly versionGroupIds: readonly string[];
}

const allowedExtensions = new Set([".md", ".txt", ".json", ".yaml", ".yml", ".toml"]);
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
  private readonly replaceFile: (
    input: AgentWriteReplaceInput
  ) => Promise<Result<void, UnifiedError>>;
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
    this.replaceFile =
      options.replaceFile ??
      (async (input) =>
        writeTextAtomically({
          targetPath: input.targetPath,
          content: input.content,
          traceId: this.traceId,
          beforeReplace: input.verifyImmediatelyBeforeReplace
        }));
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
          .flatMap((journal) => journal.entries.map((entry) => entry.relativePath))
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
      return this.performUndo(
        this.buildUndoSource([
          freezeJournal({
            ...source,
            entries: [entry]
          })
        ]),
        "version_group_undo"
      );
    });
  }

  public async undoRun(input: {
    readonly runId: string;
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
      if (sources.length === 0) {
        return err(this.error("AGENT_WRITE_RUN_NOT_FOUND", "validation"));
      }
      return this.performUndo(this.buildUndoSource(sources), "run_undo");
    });
  }

  private async executeTransaction(
    input: TransactionExecutionInput,
    transactionOptions: ExecuteTransactionOptions
  ): Promise<Result<VersionGroupRecord, UnifiedError>> {
    const inputValidation = validateTransactionInput(input, transactionOptions.kind);
    if (!inputValidation.ok) return inputValidation;

    const preflight = await this.preflight(input.files);
    if (!preflight.ok) return preflight;
    const runSequence = await this.nextRunSequence(input.runId);
    if (!runSequence.ok) return runSequence;

    const versionGroupId = this.createVersionGroupId();
    const transactionId = this.createTransactionId();
    const preparedFiles: PreparedFile[] = [];
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

    let journal = createJournal({
      transactionId,
      versionGroupId,
      kind: transactionOptions.kind,
      runSequence: runSequence.value,
      input,
      preparedFiles,
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

      const replacement = await this.replacePreparedFile(file, "apply", file.baseChecksum);
      if (!replacement.ok) {
        journal = updateJournalEntry(
          journal,
          file.relativePath,
          {
            status: "pending",
            errorCode: replacement.error.code
          },
          this.now()
        );
        return this.compensate(journal);
      }

      journal = updateJournalEntry(journal, file.relativePath, { status: "applied" }, this.now());
      const appliedEntry = await this.persistJournal(journal);
      if (!appliedEntry.ok) {
        return this.compensate(journal);
      }
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

    for (const entry of [...journal.entries].reverse()) {
      if (entry.status !== "applied" && entry.status !== "rollback_failed") continue;
      const rollback = await this.restoreJournalEntry(entry, "compensate");
      journal = updateJournalEntry(
        journal,
        entry.relativePath,
        rollback.ok
          ? { status: "rolled_back" }
          : { status: "rollback_failed", errorCode: "AGENT_WRITE_ROLLBACK_FAILED" },
        this.now()
      );
      const persisted = await this.persistJournal(journal);
      if (!persisted.ok) continue;
    }

    const partial = journal.entries.some((entry) => entry.status === "rollback_failed");
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
      reconciled = updateJournalEntry(reconciled, entry.relativePath, update, this.now());
      const persisted = await this.persistJournal(reconciled);
      if (!persisted.ok) return persisted;
    }

    if (
      !reconciled.entries.some(
        (entry) => entry.status === "applied" || entry.status === "rollback_failed"
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
    kind: Extract<AgentTransactionJournalKind, "version_group_undo" | "run_undo">
  ): Promise<Result<VersionGroupRecord, UnifiedError>> {
    const firstJournal = requireDefined(source.journals[0], "Undo source is empty.");
    const lastJournal = requireDefined(
      source.journals[source.journals.length - 1],
      "Undo source is empty."
    );
    const conflictWrites: VersionGroupWriteRecord[] = [];
    const filesToUndo: AgentWriteTransactionFile[] = [];
    for (const file of source.files) {
      const current = await this.readSafeTarget(file.relativePath);
      if (!current.ok) return current;
      if (current.value.checksum === file.candidateChecksum) continue;
      if (current.value.checksum !== file.baseChecksum) {
        const baseline = requireDefined(
          source.baselineByPath[file.relativePath],
          "Undo baseline is missing."
        );
        conflictWrites.push({
          writeId: this.createWriteId(),
          relativePath: file.relativePath,
          assetType: file.assetType,
          beforeChecksum: file.baseChecksum,
          afterChecksum: file.candidateChecksum,
          beforeVersionId: baseline.beforeVersionId,
          status: "conflict",
          errorCode: "AGENT_WRITE_UNDO_CONFLICT"
        });
      } else {
        filesToUndo.push(file);
      }
    }
    if (conflictWrites.length > 0) {
      return ok(
        freezeGroup({
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
        })
      );
    }
    if (filesToUndo.length === 0) {
      const versionGroupId = this.createVersionGroupId();
      return ok(
        freezeGroup({
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
        })
      );
    }

    const result = await this.executeTransaction(
      {
        runId: firstJournal.runId,
        checkpointId: lastJournal.checkpointId,
        changeSetId: `undo_${firstJournal.runId}`,
        revision: 0,
        checksum: checksum(source.versionGroupIds.join("\n")),
        files: filesToUndo
      },
      {
        kind,
        snapshotReason: "before-agent-session-undo",
        undoOfVersionGroupIds: source.versionGroupIds
      }
    );
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
    return {
      journals: ordered,
      files,
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

  private async replacePreparedFile(
    file: Pick<PreparedFile, "relativePath" | "targetPath" | "candidateContent">,
    phase: AgentWriteReplaceInput["phase"],
    expectedChecksum: string,
    content = file.candidateContent
  ): Promise<Result<void, UnifiedError>> {
    return this.replaceFile({
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
        if (finalTarget.value.checksum !== expectedChecksum) {
          return err(this.error("AGENT_WRITE_BASE_CONFLICT", "validation", file.relativePath));
        }
        return ok(undefined);
      }
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
        candidateContent: entry.beforeContent
      },
      phase,
      entry.candidateChecksum,
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
  const approvalBindingInvalid =
    kind === "apply"
      ? !("approvalSource" in input) ||
        input.approvalSource !== "human_confirmation" ||
        !("approvalToken" in input) ||
        input.approvalToken !== approvalToken(input.changeSetId, input.revision, input.checksum)
      : "approvalSource" in input || "approvalToken" in input;
  if (
    identifiers.some((value) => value.length === 0) ||
    !Number.isInteger(input.revision) ||
    (kind === "apply" ? input.revision < 1 : input.revision < 0) ||
    !sha256Pattern.test(input.checksum) ||
    input.files.length === 0 ||
    approvalBindingInvalid ||
    new Set(paths).size !== paths.length ||
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
    ...(input.kind === "apply" && "approvalSource" in input.input && "approvalToken" in input.input
      ? {
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
    ...(input.undoOfVersionGroupIds === undefined
      ? {}
      : { undoOfVersionGroupIds: input.undoOfVersionGroupIds })
  });
}

function updateJournalEntry(
  journal: AgentTransactionJournal,
  relativePath: string,
  update: Pick<AgentTransactionJournalEntry, "status"> & { readonly errorCode?: string },
  updatedAt: string
): AgentTransactionJournal {
  return freezeJournal({
    ...journal,
    updatedAt,
    entries: journal.entries.map((entry) =>
      entry.relativePath === relativePath
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
    entries: journal.entries.map((entry) => ({ ...entry, status: "rolled_back" }))
  });
}

function freezeJournal(journal: AgentTransactionJournal): AgentTransactionJournal {
  return Object.freeze({
    ...journal,
    entries: Object.freeze(journal.entries.map((entry) => Object.freeze({ ...entry }))),
    ...(journal.undoOfVersionGroupIds === undefined
      ? {}
      : { undoOfVersionGroupIds: Object.freeze([...journal.undoOfVersionGroupIds]) })
  });
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
    createdAt: journal.createdAt,
    writes,
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
