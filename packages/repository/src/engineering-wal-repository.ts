import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import {
  ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
  canonicalizeEngineeringMutationV2Json,
  sha256EngineeringMutationTextV2,
  validateEngineeringFileMutationRequestV2,
  type EngineeringFileMutationRequestV2
} from "./engineering-file-mutation-port-v2.js";
import {
  type EngineeringStateDirectoryEntryV2,
  type EngineeringStateDurabilityPortV2,
  type EngineeringStateFileHandleV2
} from "./engineering-mutation-blob-store.js";
import {
  verifyEngineeringMutationReceiptBindingV2,
  validateEngineeringMutationReceiptV2,
  type EngineeringMutationReceiptV2
} from "./engineering-mutation-receipt.js";
import { storageError, validationError } from "./errors.js";

export interface EngineeringV2AuthorizationBinding {
  readonly authorizationId: string;
  readonly approvalBindingId: string;
  readonly approvalBindingChecksum: string;
  /** Shared-ledger checksum over the complete, ordered Engineering V2 side effect. */
  readonly sideEffectSubjectChecksum: string;
  readonly changeSetId: string;
  readonly changeSetRevision: number;
  readonly changeSetChecksum: string;
}

/** Immutable record persisted before the first content-root mutation. */
export interface EngineeringWriteTransactionPreparedV2 {
  readonly schemaVersion: typeof ENGINEERING_MUTATION_V2_SCHEMA_VERSION;
  readonly kind: "engineering_write_transaction_prepared";
  readonly transactionId: string;
  readonly contentRootBindingId: string;
  readonly providerSemanticVersionSetChecksum: string;
  readonly authorization: EngineeringV2AuthorizationBinding;
  readonly operations: readonly EngineeringFileMutationRequestV2[];
  readonly operationOrderChecksum: string;
  readonly preparedAt: string;
  readonly preparedChecksum: string;
}

/** Monotonic durable evidence emitted only after native flush + receipt verification. */
export interface EngineeringWriteProgressRecordV2 {
  readonly schemaVersion: typeof ENGINEERING_MUTATION_V2_SCHEMA_VERSION;
  readonly kind: "engineering_write_progress";
  readonly transactionId: string;
  readonly operationId: string;
  readonly ordinal: number;
  readonly receipt: EngineeringMutationReceiptV2;
  readonly recordedAt: string;
  readonly progressChecksum: string;
}

/** Durable commit marker written only after an independent full after-manifest verification. */
export interface EngineeringWriteCommitMarkerV2 {
  readonly schemaVersion: typeof ENGINEERING_MUTATION_V2_SCHEMA_VERSION;
  readonly kind: "engineering_write_commit";
  readonly transactionId: string;
  readonly contentRootBindingId: string;
  readonly providerSemanticVersionSetChecksum: string;
  readonly fullAfterManifestChecksum: string;
  readonly committedAt: string;
  readonly commitChecksum: string;
}

export interface EngineeringWriteAheadLogV2 {
  readonly schemaVersion: typeof ENGINEERING_MUTATION_V2_SCHEMA_VERSION;
  readonly kind: "engineering_write_ahead_log";
  readonly prepared: EngineeringWriteTransactionPreparedV2;
  readonly progress: readonly EngineeringWriteProgressRecordV2[];
  readonly commit: EngineeringWriteCommitMarkerV2 | null;
  readonly journalChecksum: string;
}

export type EngineeringWriteAheadLogStatusV2 = "prepared" | "applying" | "committed";

export interface EngineeringWalScanV2 {
  readonly schemaVersion: typeof ENGINEERING_MUTATION_V2_SCHEMA_VERSION;
  readonly contentRootBindingId: string;
  readonly journals: readonly EngineeringWriteAheadLogV2[];
  readonly unknownRecordCount: number;
  readonly authenticationFailureCount: number;
}

export interface EngineeringWalAppendProgressInputV2 {
  readonly contentRootBindingId: string;
  readonly transactionId: string;
  readonly receipt: EngineeringMutationReceiptV2;
  readonly recordedAt: string;
}

export interface EngineeringWalCommitInputV2 {
  readonly contentRootBindingId: string;
  readonly transactionId: string;
  readonly fullAfterManifestChecksum: string;
  readonly committedAt: string;
}

/** App-owned Engineering V2 Journal repository; legacy journal APIs are intentionally absent. */
export interface EngineeringWalRepositoryV2 {
  prepare(input: unknown): Promise<Result<EngineeringWriteAheadLogV2, UnifiedError>>;
  appendProgress(input: unknown): Promise<Result<EngineeringWriteAheadLogV2, UnifiedError>>;
  commit(input: unknown): Promise<Result<EngineeringWriteAheadLogV2, UnifiedError>>;
  read(input: unknown): Promise<Result<EngineeringWriteAheadLogV2 | undefined, UnifiedError>>;
  listRoot(
    contentRootBindingId: string
  ): Promise<Result<readonly EngineeringWriteAheadLogV2[], UnifiedError>>;
  scanRoot(contentRootBindingId: string): Promise<Result<EngineeringWalScanV2, UnifiedError>>;
}

export class InMemoryEngineeringWalRepositoryV2 implements EngineeringWalRepositoryV2 {
  private readonly journals = new Map<string, EngineeringWriteAheadLogV2>();
  private queue: Promise<void> = Promise.resolve();

  public async prepare(input: unknown): Promise<Result<EngineeringWriteAheadLogV2, UnifiedError>> {
    return this.serialized(async () => {
      const prepared = validateEngineeringWriteTransactionPreparedV2(input);
      if (!prepared.ok) return prepared;
      const key = journalKey(prepared.value.contentRootBindingId, prepared.value.transactionId);
      const existing = this.journals.get(key);
      if (existing !== undefined) {
        return sameCanonicalJson(existing.prepared, prepared.value) ? ok(existing) : conflict();
      }
      const journal = createJournal(prepared.value, [], null);
      this.journals.set(key, journal);
      return ok(journal);
    });
  }

  public async appendProgress(
    input: unknown
  ): Promise<Result<EngineeringWriteAheadLogV2, UnifiedError>> {
    return this.serialized(async () => {
      const parsed = parseAppendProgressInput(input);
      if (parsed === undefined) return invalid("ENGINEERING_WAL_V2_PROGRESS_INVALID");
      const key = journalKey(parsed.contentRootBindingId, parsed.transactionId);
      const journal = this.journals.get(key);
      if (journal === undefined) return missing();
      const next = appendProgress(journal, parsed);
      if (!next.ok) return next;
      this.journals.set(key, next.value);
      return next;
    });
  }

  public async commit(input: unknown): Promise<Result<EngineeringWriteAheadLogV2, UnifiedError>> {
    return this.serialized(async () => {
      const parsed = parseCommitInput(input);
      if (parsed === undefined) return invalid("ENGINEERING_WAL_V2_COMMIT_INVALID");
      const key = journalKey(parsed.contentRootBindingId, parsed.transactionId);
      const journal = this.journals.get(key);
      if (journal === undefined) return missing();
      const next = appendCommit(journal, parsed);
      if (!next.ok) return next;
      this.journals.set(key, next.value);
      return next;
    });
  }

  public async read(
    input: unknown
  ): Promise<Result<EngineeringWriteAheadLogV2 | undefined, UnifiedError>> {
    const parsed = parseJournalLocator(input);
    if (parsed === undefined) return invalid("ENGINEERING_WAL_V2_LOCATOR_INVALID");
    return ok(this.journals.get(journalKey(parsed.contentRootBindingId, parsed.transactionId)));
  }

  public async listRoot(
    contentRootBindingId: string
  ): Promise<Result<readonly EngineeringWriteAheadLogV2[], UnifiedError>> {
    if (!isStableId(contentRootBindingId)) return invalid("ENGINEERING_WAL_V2_ROOT_INVALID");
    const journals = [...this.journals.values()]
      .filter((journal) => journal.prepared.contentRootBindingId === contentRootBindingId)
      .sort(compareJournal);
    return ok(freeze(journals));
  }

  public async scanRoot(
    contentRootBindingId: string
  ): Promise<Result<EngineeringWalScanV2, UnifiedError>> {
    const listed = await this.listRoot(contentRootBindingId);
    if (!listed.ok) return listed;
    return ok(
      freeze({
        schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
        contentRootBindingId,
        journals: listed.value,
        unknownRecordCount: 0,
        authenticationFailureCount: 0
      })
    );
  }

  private async serialized<T>(
    operation: () => Promise<Result<T, UnifiedError>>
  ): Promise<Result<T, UnifiedError>> {
    const previous = this.queue;
    let release: (() => void) | undefined;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release?.();
    }
  }
}

export interface FileEngineeringWalRepositoryV2Options {
  /** App-owned state root; it is not derived from or placed inside a content root. */
  readonly stateRoot: string;
  /** Required qualified Main-owned durability/no-follow implementation. */
  readonly durability: EngineeringStateDurabilityPortV2;
  readonly traceId?: string;
}

/** File-backed durable seam for Engineering V2 WALs. */
export class FileEngineeringWalRepositoryV2 implements EngineeringWalRepositoryV2 {
  private readonly traceId: string;
  /** Main has one process, but callers may construct multiple file repositories for the same state root. */
  private static readonly queues = new Map<string, Promise<void>>();

  public constructor(private readonly options: FileEngineeringWalRepositoryV2Options) {
    this.traceId = options.traceId ?? "engineering-wal-repository-v2";
  }

  public async prepare(input: unknown): Promise<Result<EngineeringWriteAheadLogV2, UnifiedError>> {
    return this.serialized(async () => {
      const prepared = validateEngineeringWriteTransactionPreparedV2(input);
      if (!prepared.ok) return prepared;
      const existing = await this.read({
        contentRootBindingId: prepared.value.contentRootBindingId,
        transactionId: prepared.value.transactionId
      });
      if (!existing.ok) return existing;
      if (existing.value !== undefined) {
        return sameCanonicalJson(existing.value.prepared, prepared.value)
          ? ok(existing.value)
          : conflict(this.traceId);
      }
      const journal = createJournal(prepared.value, [], null);
      const persisted = await this.persist(journal, "create");
      return persisted.ok ? ok(journal) : persisted;
    });
  }

  public async appendProgress(
    input: unknown
  ): Promise<Result<EngineeringWriteAheadLogV2, UnifiedError>> {
    return this.serialized(async () => {
      const parsed = parseAppendProgressInput(input);
      if (parsed === undefined) return invalid("ENGINEERING_WAL_V2_PROGRESS_INVALID", this.traceId);
      const current = await this.read({
        contentRootBindingId: parsed.contentRootBindingId,
        transactionId: parsed.transactionId
      });
      if (!current.ok) return current;
      if (current.value === undefined) return missing(this.traceId);
      const next = appendProgress(current.value, parsed);
      if (!next.ok) return next;
      const persisted = await this.persist(next.value, "replace");
      return persisted.ok ? next : persisted;
    });
  }

  public async commit(input: unknown): Promise<Result<EngineeringWriteAheadLogV2, UnifiedError>> {
    return this.serialized(async () => {
      const parsed = parseCommitInput(input);
      if (parsed === undefined) return invalid("ENGINEERING_WAL_V2_COMMIT_INVALID", this.traceId);
      const current = await this.read({
        contentRootBindingId: parsed.contentRootBindingId,
        transactionId: parsed.transactionId
      });
      if (!current.ok) return current;
      if (current.value === undefined) return missing(this.traceId);
      const next = appendCommit(current.value, parsed);
      if (!next.ok) return next;
      const persisted = await this.persist(next.value, "replace");
      return persisted.ok ? next : persisted;
    });
  }

  public async read(
    input: unknown
  ): Promise<Result<EngineeringWriteAheadLogV2 | undefined, UnifiedError>> {
    const locator = parseJournalLocator(input);
    if (locator === undefined) return invalid("ENGINEERING_WAL_V2_LOCATOR_INVALID", this.traceId);
    const durability = this.qualifiedDurability();
    if (durability === undefined) return durabilityUnavailable(this.traceId);
    const journal = await this.readJournalAtPath(
      this.journalPath(locator.contentRootBindingId, locator.transactionId),
      durability
    );
    if (!journal.ok || journal.value === undefined) return journal;
    return journal.value.prepared.contentRootBindingId === locator.contentRootBindingId &&
      journal.value.prepared.transactionId === locator.transactionId
      ? ok(journal.value)
      : authenticationFailure(this.traceId);
  }

  public async listRoot(
    contentRootBindingId: string
  ): Promise<Result<readonly EngineeringWriteAheadLogV2[], UnifiedError>> {
    const scanned = await this.scanRoot(contentRootBindingId);
    if (!scanned.ok) return scanned;
    if (scanned.value.unknownRecordCount > 0 || scanned.value.authenticationFailureCount > 0) {
      return authenticationFailure(this.traceId);
    }
    return ok(scanned.value.journals);
  }

  public async scanRoot(
    contentRootBindingId: string
  ): Promise<Result<EngineeringWalScanV2, UnifiedError>> {
    if (!isStableId(contentRootBindingId))
      return invalid("ENGINEERING_WAL_V2_ROOT_INVALID", this.traceId);
    const durability = this.qualifiedDurability();
    if (durability === undefined) return durabilityUnavailable(this.traceId);
    const directory = this.rootDirectory(contentRootBindingId);
    let entries: readonly EngineeringStateDirectoryEntryV2[];
    try {
      entries = await durability.readDirectoryNoFollow(directory);
    } catch (cause) {
      if (isMissing(cause)) return ok(emptyScan(contentRootBindingId));
      return storageFailure("ENGINEERING_WAL_V2_SCAN_FAILED", this.traceId);
    }

    const journals: EngineeringWriteAheadLogV2[] = [];
    const transactionIds = new Set<string>();
    let unknownRecordCount = 0;
    let authenticationFailureCount = 0;
    for (const entry of [...entries].sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.kind !== "file" || !isDiskJournalFileName(entry.name)) {
        unknownRecordCount += 1;
        continue;
      }
      const read = await this.readJournalAtPath(join(directory, entry.name), durability);
      if (!read.ok) {
        if (read.error.code.includes("AUTHENTICATION")) authenticationFailureCount += 1;
        else unknownRecordCount += 1;
        continue;
      }
      if (read.value === undefined) {
        unknownRecordCount += 1;
        continue;
      }
      if (
        read.value.prepared.contentRootBindingId !== contentRootBindingId ||
        entry.name !== this.journalFileName(read.value.prepared.transactionId) ||
        transactionIds.has(read.value.prepared.transactionId)
      ) {
        authenticationFailureCount += 1;
        continue;
      }
      transactionIds.add(read.value.prepared.transactionId);
      journals.push(read.value);
    }
    return ok(
      freeze({
        schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
        contentRootBindingId,
        journals: freeze(journals.sort(compareJournal)),
        unknownRecordCount,
        authenticationFailureCount
      })
    );
  }

  private async persist(
    journal: EngineeringWriteAheadLogV2,
    mode: "create" | "replace"
  ): Promise<Result<void, UnifiedError>> {
    const durability = this.qualifiedDurability();
    if (durability === undefined) return durabilityUnavailable(this.traceId);
    const directory = this.rootDirectory(journal.prepared.contentRootBindingId);
    const target = this.journalPath(
      journal.prepared.contentRootBindingId,
      journal.prepared.transactionId
    );
    const temporary = `${target}.${randomUUID()}.tmp`;
    let handle: EngineeringStateFileHandleV2 | undefined;
    let result: Result<void, UnifiedError> | undefined;
    try {
      await durability.ensureDirectoryNoFollow(directory);
      await durability.flushDirectory(directory);
      handle = await durability.openExclusiveNoFollow(temporary);
      await handle.writeFile(
        new TextEncoder().encode(canonicalizeEngineeringMutationV2Json(journal))
      );
      await handle.sync();
      await handle.close();
      handle = undefined;
      if (mode === "create") {
        try {
          await durability.linkNoFollow(temporary, target);
        } catch (cause) {
          if (isAlreadyExists(cause)) {
            result = conflict(this.traceId);
          } else {
            throw cause;
          }
        }
      } else {
        await durability.renameReplaceNoFollow(temporary, target);
      }
      if (result === undefined) {
        await durability.flushDirectory(directory);
        result = ok(undefined);
      }
    } catch {
      result = storageFailure("ENGINEERING_WAL_V2_WRITE_FAILED", this.traceId);
    }
    try {
      if (handle !== undefined) await handle.close();
      await durability.unlinkNoFollow(temporary);
      await durability.flushDirectory(directory);
    } catch (cause) {
      // A leftover temporary file must not be silently ignored: startup scanning will block the
      // root if a crash or no-follow failure leaves an unrecognized state object behind.
      if (!isMissing(cause)) return storageFailure("ENGINEERING_WAL_V2_WRITE_FAILED", this.traceId);
    }
    return result ?? storageFailure("ENGINEERING_WAL_V2_WRITE_FAILED", this.traceId);
  }

  private rootDirectory(contentRootBindingId: string): string {
    return join(
      this.options.stateRoot,
      "engineering-v2",
      "wal",
      diskKey("root", contentRootBindingId)
    );
  }

  private journalPath(contentRootBindingId: string, transactionId: string): string {
    return join(this.rootDirectory(contentRootBindingId), this.journalFileName(transactionId));
  }

  private journalFileName(transactionId: string): string {
    return `${diskKey("transaction", transactionId)}.json`;
  }

  private qualifiedDurability(): EngineeringStateDurabilityPortV2 | undefined {
    return this.options.durability?.qualification === "qualified"
      ? this.options.durability
      : undefined;
  }

  private async readJournalAtPath(
    path: string,
    durability: EngineeringStateDurabilityPortV2
  ): Promise<Result<EngineeringWriteAheadLogV2 | undefined, UnifiedError>> {
    try {
      const content = new TextDecoder("utf-8", { fatal: true }).decode(
        await durability.readFileNoFollow(path)
      );
      const journal = validateEngineeringWriteAheadLogV2(JSON.parse(content));
      return journal.ok ? ok(journal.value) : journal;
    } catch (cause) {
      if (isMissing(cause)) return ok(undefined);
      if (cause instanceof SyntaxError)
        return invalid("ENGINEERING_WAL_V2_RECORD_INVALID", this.traceId);
      return storageFailure("ENGINEERING_WAL_V2_READ_FAILED", this.traceId);
    }
  }

  private async serialized<T>(
    operation: () => Promise<Result<T, UnifiedError>>
  ): Promise<Result<T, UnifiedError>> {
    const queueKey = this.options.stateRoot;
    const previous = FileEngineeringWalRepositoryV2.queues.get(queueKey) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    FileEngineeringWalRepositoryV2.queues.set(queueKey, current);
    await previous;
    try {
      return await operation();
    } finally {
      release?.();
      if (FileEngineeringWalRepositoryV2.queues.get(queueKey) === current) {
        FileEngineeringWalRepositoryV2.queues.delete(queueKey);
      }
    }
  }
}

export function createEngineeringWriteTransactionPreparedV2(
  input: Omit<
    EngineeringWriteTransactionPreparedV2,
    "schemaVersion" | "kind" | "operationOrderChecksum" | "preparedChecksum"
  >
): EngineeringWriteTransactionPreparedV2 {
  const unsigned = {
    schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
    kind: "engineering_write_transaction_prepared" as const,
    transactionId: input.transactionId,
    contentRootBindingId: input.contentRootBindingId,
    providerSemanticVersionSetChecksum: input.providerSemanticVersionSetChecksum,
    authorization: input.authorization,
    operations: input.operations,
    operationOrderChecksum: engineeringOperationOrderChecksumV2(input.operations),
    preparedAt: input.preparedAt
  };
  if (
    input.authorization.sideEffectSubjectChecksum !==
    engineeringSideEffectSubjectChecksumV2({
      transactionId: input.transactionId,
      contentRootBindingId: input.contentRootBindingId,
      providerSemanticVersionSetChecksum: input.providerSemanticVersionSetChecksum,
      operations: input.operations
    })
  ) {
    throw new Error("ENGINEERING_WAL_V2_SIDE_EFFECT_SUBJECT_MISMATCH");
  }
  const prepared = {
    ...unsigned,
    preparedChecksum: sha256EngineeringMutationTextV2(
      canonicalizeEngineeringMutationV2Json(unsigned)
    )
  } as const;
  const validated = validateEngineeringWriteTransactionPreparedV2(prepared);
  if (!validated.ok) throw new Error("ENGINEERING_WAL_V2_PREPARED_INVALID");
  return validated.value;
}

export function validateEngineeringWriteTransactionPreparedV2(
  value: unknown
): Result<EngineeringWriteTransactionPreparedV2, UnifiedError> {
  if (!hasExactKeys(value, preparedKeys)) return invalid("ENGINEERING_WAL_V2_PREPARED_INVALID");
  if (
    value["schemaVersion"] !== ENGINEERING_MUTATION_V2_SCHEMA_VERSION ||
    value["kind"] !== "engineering_write_transaction_prepared" ||
    !isStableId(value["transactionId"]) ||
    !isStableId(value["contentRootBindingId"]) ||
    !isSha256(value["providerSemanticVersionSetChecksum"]) ||
    !isAuthorization(value["authorization"]) ||
    !Array.isArray(value["operations"]) ||
    value["operations"].length === 0 ||
    value["operations"].length > 64 ||
    !isSha256(value["operationOrderChecksum"]) ||
    !isCanonicalUtcTimestamp(value["preparedAt"]) ||
    !isSha256(value["preparedChecksum"])
  ) {
    return invalid("ENGINEERING_WAL_V2_PREPARED_INVALID");
  }
  const operations: EngineeringFileMutationRequestV2[] = [];
  for (const candidate of value["operations"] as unknown[]) {
    const operation = validateEngineeringFileMutationRequestV2(candidate);
    if (!operation.ok) return invalid("ENGINEERING_WAL_V2_PREPARED_INVALID");
    if (
      operation.value.transactionId !== value["transactionId"] ||
      operation.value.contentRootBindingId !== value["contentRootBindingId"] ||
      operation.value.providerSemanticVersionSetChecksum !==
        value["providerSemanticVersionSetChecksum"]
    ) {
      return invalid("ENGINEERING_WAL_V2_PREPARED_INVALID");
    }
    operations.push(operation.value);
  }
  if (
    new Set(operations.map((operation) => operation.operationId)).size !== operations.length ||
    new Set(operations.map((operation) => operation.relativeIdentity)).size !== operations.length ||
    engineeringOperationOrderChecksumV2(operations) !== value["operationOrderChecksum"] ||
    (value["authorization"] as EngineeringV2AuthorizationBinding).sideEffectSubjectChecksum !==
      engineeringSideEffectSubjectChecksumV2({
        transactionId: value["transactionId"] as string,
        contentRootBindingId: value["contentRootBindingId"] as string,
        providerSemanticVersionSetChecksum: value["providerSemanticVersionSetChecksum"] as string,
        operations
      })
  ) {
    return invalid("ENGINEERING_WAL_V2_PREPARED_INVALID");
  }
  const prepared = {
    ...(value as Omit<EngineeringWriteTransactionPreparedV2, "operations">),
    operations: freeze(operations)
  } as EngineeringWriteTransactionPreparedV2;
  const unsigned = withoutKey(prepared as unknown as Record<string, unknown>, "preparedChecksum");
  if (
    prepared.preparedChecksum !==
    sha256EngineeringMutationTextV2(canonicalizeEngineeringMutationV2Json(unsigned))
  ) {
    return authenticationFailure();
  }
  return ok(freeze(prepared));
}

export function validateEngineeringWriteAheadLogV2(
  value: unknown
): Result<EngineeringWriteAheadLogV2, UnifiedError> {
  if (!hasExactKeys(value, journalKeys)) return invalid("ENGINEERING_WAL_V2_RECORD_INVALID");
  if (
    value["schemaVersion"] !== ENGINEERING_MUTATION_V2_SCHEMA_VERSION ||
    value["kind"] !== "engineering_write_ahead_log" ||
    !Array.isArray(value["progress"]) ||
    !isSha256(value["journalChecksum"]) ||
    (value["commit"] !== null && (value["commit"] === null || typeof value["commit"] !== "object"))
  ) {
    return invalid("ENGINEERING_WAL_V2_RECORD_INVALID");
  }
  const prepared = validateEngineeringWriteTransactionPreparedV2(value["prepared"]);
  if (!prepared.ok) return prepared;
  const progress: EngineeringWriteProgressRecordV2[] = [];
  for (const record of value["progress"] as unknown[]) {
    const parsed = parseProgressRecord(record);
    if (parsed === undefined) return invalid("ENGINEERING_WAL_V2_RECORD_INVALID");
    progress.push(parsed);
  }
  const commit = value["commit"] === null ? null : parseCommitMarker(value["commit"]);
  if (
    commit === undefined ||
    !validProgressSequence(prepared.value, progress) ||
    !commitMatches(prepared.value, progress, commit)
  ) {
    return invalid("ENGINEERING_WAL_V2_RECORD_INVALID");
  }
  const journal = {
    schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
    kind: "engineering_write_ahead_log" as const,
    prepared: prepared.value,
    progress: freeze(progress),
    commit,
    journalChecksum: value["journalChecksum"]
  };
  const unsigned = withoutKey(journal, "journalChecksum");
  if (
    journal.journalChecksum !==
    sha256EngineeringMutationTextV2(canonicalizeEngineeringMutationV2Json(unsigned))
  ) {
    return authenticationFailure();
  }
  return ok(freeze(journal));
}

export function engineeringOperationOrderChecksumV2(
  operations: readonly Pick<EngineeringFileMutationRequestV2, "operationId">[]
): string {
  return sha256EngineeringMutationTextV2(
    canonicalizeEngineeringMutationV2Json(operations.map((operation) => operation.operationId))
  );
}

/**
 * This value is what the shared approval ledger must reserve.  It deliberately includes every
 * request checksum in order rather than only authorization ids or operation ids.
 */
export function engineeringSideEffectSubjectChecksumV2(input: {
  readonly transactionId: string;
  readonly contentRootBindingId: string;
  readonly providerSemanticVersionSetChecksum: string;
  readonly operations: readonly EngineeringFileMutationRequestV2[];
}): string {
  return sha256EngineeringMutationTextV2(
    canonicalizeEngineeringMutationV2Json({
      schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
      transactionId: input.transactionId,
      contentRootBindingId: input.contentRootBindingId,
      providerSemanticVersionSetChecksum: input.providerSemanticVersionSetChecksum,
      operationOrderChecksum: engineeringOperationOrderChecksumV2(input.operations),
      operationRequestChecksums: input.operations.map((operation) =>
        sha256EngineeringMutationTextV2(canonicalizeEngineeringMutationV2Json(operation))
      )
    })
  );
}

export function engineeringFullAfterManifestChecksumV2(
  receipts: readonly Pick<EngineeringMutationReceiptV2, "operationId" | "observedAfter">[]
): string {
  return sha256EngineeringMutationTextV2(
    canonicalizeEngineeringMutationV2Json(
      receipts.map((receipt) => ({
        operationId: receipt.operationId,
        observedAfter: receipt.observedAfter
      }))
    )
  );
}

export function engineeringWalStatusV2(
  journal: EngineeringWriteAheadLogV2
): EngineeringWriteAheadLogStatusV2 {
  const validated = validateEngineeringWriteAheadLogV2(journal);
  if (!validated.ok) throw new Error("ENGINEERING_WAL_V2_RECORD_INVALID");
  return journal.commit !== null
    ? "committed"
    : journal.progress.length === 0
      ? "prepared"
      : "applying";
}

export function engineeringWalReferencedBlobIdsV2(
  journals: readonly EngineeringWriteAheadLogV2[]
): readonly string[] {
  const blobIds = new Set<string>();
  for (const journal of journals) {
    for (const operation of journal.prepared.operations) {
      blobIds.add(operation.candidate.blob.blobId);
      if (operation.before.kind === "present") blobIds.add(operation.before.blob.blobId);
    }
  }
  return freeze([...blobIds].sort());
}

function createJournal(
  prepared: EngineeringWriteTransactionPreparedV2,
  progress: readonly EngineeringWriteProgressRecordV2[],
  commit: EngineeringWriteCommitMarkerV2 | null
): EngineeringWriteAheadLogV2 {
  const unsigned = {
    schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
    kind: "engineering_write_ahead_log" as const,
    prepared,
    progress,
    commit
  };
  return freeze({
    ...unsigned,
    journalChecksum: sha256EngineeringMutationTextV2(
      canonicalizeEngineeringMutationV2Json(unsigned)
    )
  });
}

function appendProgress(
  journal: EngineeringWriteAheadLogV2,
  input: EngineeringWalAppendProgressInputV2
): Result<EngineeringWriteAheadLogV2, UnifiedError> {
  if (journal.commit !== null) return invalid("ENGINEERING_WAL_V2_ALREADY_COMMITTED");
  const existing = journal.progress.find(
    (entry) => entry.operationId === input.receipt.operationId
  );
  if (existing !== undefined) {
    return sameCanonicalJson(existing.receipt, input.receipt) ? ok(journal) : conflict();
  }
  const ordinal = journal.progress.length;
  const operation = journal.prepared.operations[ordinal];
  if (operation === undefined) return invalid("ENGINEERING_WAL_V2_PROGRESS_OVERFLOW");
  const receipt = verifyEngineeringMutationReceiptBindingV2(input.receipt, operation);
  if (!receipt.ok) return receipt;
  if (receipt.value.operationId !== operation.operationId)
    return invalid("ENGINEERING_WAL_V2_PROGRESS_ORDER_INVALID");
  const progress = createProgressRecord(receipt.value, ordinal, input.recordedAt);
  const next = createJournal(journal.prepared, [...journal.progress, progress], null);
  return ok(next);
}

function appendCommit(
  journal: EngineeringWriteAheadLogV2,
  input: EngineeringWalCommitInputV2
): Result<EngineeringWriteAheadLogV2, UnifiedError> {
  if (journal.commit !== null) {
    return journal.commit.fullAfterManifestChecksum === input.fullAfterManifestChecksum
      ? ok(journal)
      : conflict();
  }
  if (journal.progress.length !== journal.prepared.operations.length) {
    return invalid("ENGINEERING_WAL_V2_COMMIT_INCOMPLETE");
  }
  const expectedAfter = engineeringFullAfterManifestChecksumV2(
    journal.progress.map((entry) => entry.receipt)
  );
  if (expectedAfter !== input.fullAfterManifestChecksum) {
    return invalid("ENGINEERING_WAL_V2_COMMIT_AFTER_MANIFEST_MISMATCH");
  }
  const commit = createCommitMarker(journal.prepared, input);
  return ok(createJournal(journal.prepared, journal.progress, commit));
}

function createProgressRecord(
  receipt: EngineeringMutationReceiptV2,
  ordinal: number,
  recordedAt: string
): EngineeringWriteProgressRecordV2 {
  const unsigned = {
    schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
    kind: "engineering_write_progress" as const,
    transactionId: receipt.transactionId,
    operationId: receipt.operationId,
    ordinal,
    receipt,
    recordedAt
  };
  return freeze({
    ...unsigned,
    progressChecksum: sha256EngineeringMutationTextV2(
      canonicalizeEngineeringMutationV2Json(unsigned)
    )
  });
}

function createCommitMarker(
  prepared: EngineeringWriteTransactionPreparedV2,
  input: EngineeringWalCommitInputV2
): EngineeringWriteCommitMarkerV2 {
  const unsigned = {
    schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
    kind: "engineering_write_commit" as const,
    transactionId: prepared.transactionId,
    contentRootBindingId: prepared.contentRootBindingId,
    providerSemanticVersionSetChecksum: prepared.providerSemanticVersionSetChecksum,
    fullAfterManifestChecksum: input.fullAfterManifestChecksum,
    committedAt: input.committedAt
  };
  return freeze({
    ...unsigned,
    commitChecksum: sha256EngineeringMutationTextV2(canonicalizeEngineeringMutationV2Json(unsigned))
  });
}

function parseProgressRecord(value: unknown): EngineeringWriteProgressRecordV2 | undefined {
  if (!hasExactKeys(value, progressKeys)) return undefined;
  if (
    value["schemaVersion"] !== ENGINEERING_MUTATION_V2_SCHEMA_VERSION ||
    value["kind"] !== "engineering_write_progress" ||
    !isStableId(value["transactionId"]) ||
    !isStableOperationId(value["operationId"]) ||
    !isOrdinal(value["ordinal"]) ||
    !isCanonicalUtcTimestamp(value["recordedAt"]) ||
    !isSha256(value["progressChecksum"])
  ) {
    return undefined;
  }
  const receipt = validateEngineeringMutationReceiptV2(value["receipt"]);
  if (!receipt.ok) return undefined;
  const progress = {
    ...(value as Omit<EngineeringWriteProgressRecordV2, "receipt">),
    receipt: receipt.value
  } as EngineeringWriteProgressRecordV2;
  const unsigned = withoutKey(progress as unknown as Record<string, unknown>, "progressChecksum");
  return progress.progressChecksum ===
    sha256EngineeringMutationTextV2(canonicalizeEngineeringMutationV2Json(unsigned))
    ? freeze(progress)
    : undefined;
}

function parseCommitMarker(value: unknown): EngineeringWriteCommitMarkerV2 | undefined {
  if (!hasExactKeys(value, commitKeys)) return undefined;
  if (
    value["schemaVersion"] !== ENGINEERING_MUTATION_V2_SCHEMA_VERSION ||
    value["kind"] !== "engineering_write_commit" ||
    !isStableId(value["transactionId"]) ||
    !isStableId(value["contentRootBindingId"]) ||
    !isSha256(value["providerSemanticVersionSetChecksum"]) ||
    !isSha256(value["fullAfterManifestChecksum"]) ||
    !isCanonicalUtcTimestamp(value["committedAt"]) ||
    !isSha256(value["commitChecksum"])
  ) {
    return undefined;
  }
  const commit = value as unknown as EngineeringWriteCommitMarkerV2;
  const unsigned = withoutKey(commit as unknown as Record<string, unknown>, "commitChecksum");
  return commit.commitChecksum ===
    sha256EngineeringMutationTextV2(canonicalizeEngineeringMutationV2Json(unsigned))
    ? freeze(commit)
    : undefined;
}

function validProgressSequence(
  prepared: EngineeringWriteTransactionPreparedV2,
  progress: readonly EngineeringWriteProgressRecordV2[]
): boolean {
  if (progress.length > prepared.operations.length) return false;
  return progress.every((entry, ordinal) => {
    const operation = prepared.operations[ordinal];
    return (
      operation !== undefined &&
      entry.ordinal === ordinal &&
      entry.transactionId === prepared.transactionId &&
      entry.operationId === operation.operationId &&
      verifyEngineeringMutationReceiptBindingV2(entry.receipt, operation).ok
    );
  });
}

function commitMatches(
  prepared: EngineeringWriteTransactionPreparedV2,
  progress: readonly EngineeringWriteProgressRecordV2[],
  commit: EngineeringWriteCommitMarkerV2 | null
): boolean {
  if (commit === null) return true;
  return (
    progress.length === prepared.operations.length &&
    commit.transactionId === prepared.transactionId &&
    commit.contentRootBindingId === prepared.contentRootBindingId &&
    commit.providerSemanticVersionSetChecksum === prepared.providerSemanticVersionSetChecksum &&
    commit.fullAfterManifestChecksum ===
      engineeringFullAfterManifestChecksumV2(progress.map((entry) => entry.receipt))
  );
}

function parseAppendProgressInput(value: unknown): EngineeringWalAppendProgressInputV2 | undefined {
  if (!hasExactKeys(value, appendProgressInputKeys)) return undefined;
  if (
    !isStableId(value["contentRootBindingId"]) ||
    !isStableId(value["transactionId"]) ||
    !isCanonicalUtcTimestamp(value["recordedAt"])
  ) {
    return undefined;
  }
  const receipt = validateEngineeringMutationReceiptV2(value["receipt"]);
  return receipt.ok
    ? freeze({
        contentRootBindingId: value["contentRootBindingId"] as string,
        transactionId: value["transactionId"] as string,
        receipt: receipt.value,
        recordedAt: value["recordedAt"] as string
      })
    : undefined;
}

function parseCommitInput(value: unknown): EngineeringWalCommitInputV2 | undefined {
  return hasExactKeys(value, commitInputKeys) &&
    isStableId(value["contentRootBindingId"]) &&
    isStableId(value["transactionId"]) &&
    isSha256(value["fullAfterManifestChecksum"]) &&
    isCanonicalUtcTimestamp(value["committedAt"])
    ? (value as unknown as EngineeringWalCommitInputV2)
    : undefined;
}

function parseJournalLocator(
  value: unknown
): Readonly<{ contentRootBindingId: string; transactionId: string }> | undefined {
  return hasExactKeys(value, locatorKeys) &&
    isStableId(value["contentRootBindingId"]) &&
    isStableId(value["transactionId"])
    ? freeze({
        contentRootBindingId: value["contentRootBindingId"] as string,
        transactionId: value["transactionId"] as string
      })
    : undefined;
}

function isAuthorization(value: unknown): value is EngineeringV2AuthorizationBinding {
  return (
    hasExactKeys(value, authorizationKeys) &&
    isStableId(value["authorizationId"]) &&
    isStableId(value["approvalBindingId"]) &&
    isSha256(value["approvalBindingChecksum"]) &&
    isSha256(value["sideEffectSubjectChecksum"]) &&
    isStableId(value["changeSetId"]) &&
    Number.isSafeInteger(value["changeSetRevision"]) &&
    (value["changeSetRevision"] as number) >= 1 &&
    isSha256(value["changeSetChecksum"])
  );
}

function emptyScan(contentRootBindingId: string): EngineeringWalScanV2 {
  return freeze({
    schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
    contentRootBindingId,
    journals: freeze([]),
    unknownRecordCount: 0,
    authenticationFailureCount: 0
  });
}

function journalKey(contentRootBindingId: string, transactionId: string): string {
  return `${contentRootBindingId}\u0000${transactionId}`;
}

function compareJournal(
  left: EngineeringWriteAheadLogV2,
  right: EngineeringWriteAheadLogV2
): number {
  const prepared = left.prepared.preparedAt.localeCompare(right.prepared.preparedAt);
  return prepared === 0
    ? left.prepared.transactionId.localeCompare(right.prepared.transactionId)
    : prepared;
}

function sameCanonicalJson(left: unknown, right: unknown): boolean {
  return (
    canonicalizeEngineeringMutationV2Json(left) === canonicalizeEngineeringMutationV2Json(right)
  );
}

function isStableId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value);
}

function isStableOperationId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isOrdinal(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value < 64;
}

function isCanonicalUtcTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function hasExactKeys(
  value: unknown,
  expected: readonly string[]
): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  const expectedKeys = [...expected].sort();
  return (
    keys.length === expectedKeys.length && keys.every((key, index) => key === expectedKeys[index])
  );
}

function withoutKey(value: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([candidate]) => candidate !== key));
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function isMissing(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    (cause as { readonly code?: unknown }).code === "ENOENT"
  );
}

function isAlreadyExists(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    (cause as { readonly code?: unknown }).code === "EEXIST"
  );
}

function diskKey(namespace: string, value: string): string {
  return `${namespace}-${sha256EngineeringMutationTextV2(value)}`;
}

function isDiskJournalFileName(value: string): boolean {
  return /^transaction-[a-f0-9]{64}\.json$/u.test(value);
}

function invalid<T = never>(
  code: string,
  traceId = "engineering-wal-repository-v2"
): Result<T, UnifiedError> {
  return err(
    validationError({
      code,
      message: "Engineering V2 WAL data is invalid.",
      suggestedAction: "Enter recovery review and regenerate the transaction if needed.",
      traceId
    })
  );
}

function missing<T = never>(traceId = "engineering-wal-repository-v2"): Result<T, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_WAL_V2_MISSING",
      message: "The Engineering V2 WAL record is missing.",
      suggestedAction: "Enter recovery review; do not write through an unaccounted transaction.",
      traceId
    })
  );
}

function conflict<T = never>(traceId = "engineering-wal-repository-v2"): Result<T, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_WAL_V2_CONFLICT",
      message: "A different Engineering V2 WAL record already exists for this transaction.",
      suggestedAction: "Use the existing transaction or enter recovery review.",
      traceId
    })
  );
}

function authenticationFailure<T = never>(
  traceId = "engineering-wal-repository-v2"
): Result<T, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_WAL_V2_AUTHENTICATION_FAILED",
      message: "Engineering V2 WAL integrity validation failed.",
      suggestedAction: "Enter recovery review; do not permit new mutations for this root.",
      traceId
    })
  );
}

function storageFailure<T = never>(code: string, traceId: string): Result<T, UnifiedError> {
  return err(
    storageError({
      code,
      message: "Engineering V2 WAL storage is unavailable.",
      suggestedAction: "Enter recovery review before permitting new mutations.",
      traceId
    })
  );
}

function durabilityUnavailable<T = never>(traceId: string): Result<T, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_WAL_V2_DURABILITY_UNQUALIFIED",
      message: "Qualified Main-owned WAL durability is unavailable.",
      suggestedAction:
        "Keep engineering mutations disabled until the qualified state-store is wired.",
      traceId
    })
  );
}

const authorizationKeys = [
  "approvalBindingChecksum",
  "approvalBindingId",
  "authorizationId",
  "changeSetChecksum",
  "changeSetId",
  "changeSetRevision",
  "sideEffectSubjectChecksum"
] as const;
const preparedKeys = [
  "authorization",
  "contentRootBindingId",
  "kind",
  "operationOrderChecksum",
  "operations",
  "preparedAt",
  "preparedChecksum",
  "providerSemanticVersionSetChecksum",
  "schemaVersion",
  "transactionId"
] as const;
const progressKeys = [
  "kind",
  "operationId",
  "ordinal",
  "progressChecksum",
  "receipt",
  "recordedAt",
  "schemaVersion",
  "transactionId"
] as const;
const commitKeys = [
  "commitChecksum",
  "committedAt",
  "contentRootBindingId",
  "fullAfterManifestChecksum",
  "kind",
  "providerSemanticVersionSetChecksum",
  "schemaVersion",
  "transactionId"
] as const;
const journalKeys = [
  "commit",
  "journalChecksum",
  "kind",
  "prepared",
  "progress",
  "schemaVersion"
] as const;
const appendProgressInputKeys = [
  "contentRootBindingId",
  "receipt",
  "recordedAt",
  "transactionId"
] as const;
const commitInputKeys = [
  "committedAt",
  "contentRootBindingId",
  "fullAfterManifestChecksum",
  "transactionId"
] as const;
const locatorKeys = ["contentRootBindingId", "transactionId"] as const;
