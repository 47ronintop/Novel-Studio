import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import {
  ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
  canonicalizeEngineeringMutationV2Json,
  engineeringFileLifecycleRequestChecksumV2,
  inspectEngineeringRawBytesV2,
  sha256EngineeringMutationTextV2,
  validateEngineeringAbsenceProofV2,
  validateEngineeringFileLifecycleRequestV2,
  validateEngineeringFileMutationRequestV2,
  validateEngineeringRawByteManifestV2,
  type EngineeringAbsenceProofV2,
  type EngineeringFileMutationApplyInputV2,
  type EngineeringFileMutationPortV2,
  type EngineeringFileLifecycleReceiptV2,
  type EngineeringFileLifecycleOperationStateV2,
  type EngineeringFileLifecycleRecoveryInputV2,
  type EngineeringFileLifecycleRequestV2,
  type EngineeringLifecycleRecoveryRootBindingV2,
  type EngineeringFileMutationOperationKindV2,
  type EngineeringFileMutationRequestV2,
  type EngineeringRawByteManifestV2
} from "./engineering-file-mutation-port-v2.js";
import { verifyEngineeringFileLifecycleReceiptBindingV2 } from "./engineering-mutation-receipt.js";
import {
  createEngineeringMutationBlobReferenceV2,
  type EngineeringStateDirectoryEntryV2,
  type EngineeringStateDurabilityPortV2,
  type EngineeringStateFileHandleV2,
  type EngineeringMutationBlobReferenceV2,
  type EngineeringMutationBlobStoreV2
} from "./engineering-mutation-blob-store.js";
import { type EngineeringMutationReceiptV2 } from "./engineering-mutation-receipt.js";
import { type EngineeringRecoveryMutationLeaseV2 } from "./engineering-recovery-gate.js";
import {
  createEngineeringWriteTransactionPreparedV2,
  engineeringFullAfterManifestChecksumV2,
  type EngineeringV2AuthorizationBinding,
  type EngineeringWalRepositoryV2,
  type EngineeringWriteAheadLogV2,
  type EngineeringWriteTransactionPreparedV2
} from "./engineering-wal-repository.js";
import { storageError, validationError } from "./errors.js";

export type EngineeringWriteTransactionBeforeInputV2 =
  | Readonly<{
      readonly kind: "present";
      readonly manifest: EngineeringRawByteManifestV2;
      readonly bytes: Uint8Array;
    }>
  | Readonly<{
      readonly kind: "absent";
      readonly absenceProof: EngineeringAbsenceProofV2;
    }>;

export interface EngineeringWriteTransactionCandidateInputV2 {
  readonly manifest: EngineeringRawByteManifestV2;
  readonly bytes: Uint8Array;
}

export interface EngineeringWriteTransactionOperationInputV2 {
  readonly operationKind: EngineeringFileMutationOperationKindV2;
  readonly operationId: string;
  readonly relativeIdentity: string;
  readonly before: EngineeringWriteTransactionBeforeInputV2;
  readonly candidate: EngineeringWriteTransactionCandidateInputV2;
  readonly stagingObjectId: string;
}

/** Input held only in Main while durable blobs and an immutable prepared record are created. */
export interface EngineeringWriteTransactionInputV2 {
  readonly schemaVersion: typeof ENGINEERING_MUTATION_V2_SCHEMA_VERSION;
  readonly transactionId: string;
  readonly contentRootBindingId: string;
  readonly providerSemanticVersionSetChecksum: string;
  readonly authorization: EngineeringV2AuthorizationBinding;
  readonly operations: readonly EngineeringWriteTransactionOperationInputV2[];
  readonly preparedAt: string;
}

/** Main-owned recovery gate interface.  A missing gate is intentionally equivalent to closed. */
export interface EngineeringMutationRecoveryGatePortV2 {
  assertMutationAllowed(contentRootBindingId: string): Promise<Result<void, UnifiedError>>;
  acquireMutationLease(
    input: unknown
  ): Promise<Result<EngineeringRecoveryMutationLeaseV2, UnifiedError>>;
  acquireRecoveryLease(
    input: unknown
  ): Promise<Result<EngineeringRecoveryMutationLeaseV2, UnifiedError>>;
}

/** Bridges the shared approval ledger without copying opaque capability material into this module. */
export type EngineeringV2AuthorizationValidator = (
  prepared: EngineeringWriteTransactionPreparedV2
) => Promise<Result<void, UnifiedError>>;

/** Qualifies the preallocated native staging object against the complete prepared operation. */
export type EngineeringV2StagingReservationValidator = (input: {
  readonly prepared: EngineeringWriteTransactionPreparedV2;
  readonly operation: EngineeringFileMutationRequestV2;
}) => Promise<Result<void, UnifiedError>>;

/**
 * The native reader re-reads every after state before commit.  Returning cached receipts or a
 * partial list is rejected: this is the final external-edit protection before the commit marker.
 */
export type EngineeringFullAfterManifestVerifierV2 = (input: {
  readonly prepared: EngineeringWriteTransactionPreparedV2;
  readonly receipts: readonly EngineeringMutationReceiptV2[];
}) => Promise<Result<readonly EngineeringRawByteManifestV2[], UnifiedError>>;

export interface EngineeringWriteTransactionV2Options {
  readonly walRepository: EngineeringWalRepositoryV2;
  readonly blobStore: EngineeringMutationBlobStoreV2;
  readonly mutationPort: EngineeringFileMutationPortV2;
  readonly recoveryGate: EngineeringMutationRecoveryGatePortV2;
  readonly validateReservedAuthorization: EngineeringV2AuthorizationValidator;
  readonly validateStagingReservation?: EngineeringV2StagingReservationValidator;
  readonly verifyFullAfterManifest: EngineeringFullAfterManifestVerifierV2;
  readonly now?: () => string;
  readonly traceId?: string;
}

export interface EngineeringLifecycleWriteOperationV2 {
  readonly request: EngineeringFileLifecycleRequestV2;
  /** Durable binding facts only. Native root handles are reacquired by Main and never journaled. */
  readonly recoveryBinding: Omit<
    EngineeringLifecycleRecoveryRootBindingV2,
    "recoveryRootId"
  > | null;
}

export interface EngineeringLifecycleWriteTransactionInputV2 {
  readonly schemaVersion: typeof ENGINEERING_MUTATION_V2_SCHEMA_VERSION;
  readonly transactionId: string;
  readonly contentRootBindingId: string;
  readonly providerSemanticVersionSetChecksum: string;
  readonly authorization: EngineeringV2AuthorizationBinding;
  readonly operations: readonly EngineeringLifecycleWriteOperationV2[];
  readonly preparedAt: string;
}

/** Canonical approval-ledger subject for an ordered B8 lifecycle transaction. */
export function engineeringLifecycleSideEffectSubjectChecksumV2(input: {
  readonly transactionId: string;
  readonly contentRootBindingId: string;
  readonly providerSemanticVersionSetChecksum: string;
  readonly operations: readonly EngineeringFileLifecycleRequestV2[];
}): string {
  return sha256EngineeringMutationTextV2(
    canonicalizeEngineeringMutationV2Json({
      schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
      transactionId: input.transactionId,
      contentRootBindingId: input.contentRootBindingId,
      providerSemanticVersionSetChecksum: input.providerSemanticVersionSetChecksum,
      operationRequestChecksums: input.operations.map((operation) =>
        sha256EngineeringMutationTextV2(canonicalizeEngineeringMutationV2Json(operation))
      )
    })
  );
}

export interface EngineeringLifecycleWriteAheadLogV2 {
  readonly schemaVersion: typeof ENGINEERING_MUTATION_V2_SCHEMA_VERSION;
  readonly kind: "engineering_lifecycle_write_ahead_log";
  readonly prepared: EngineeringLifecycleWriteTransactionInputV2;
  readonly preparedChecksum: string;
  readonly receipts: readonly EngineeringFileLifecycleReceiptV2[];
  readonly committedAt: string | null;
  readonly rolledBackAt: string | null;
  /** Durable proof that editor/tree/index synchronization completed for this terminal WAL. */
  readonly synchronizedAt: string | null;
  readonly journalChecksum: string;
}

export interface EngineeringLifecycleWalRepositoryV2 {
  read(input: {
    readonly contentRootBindingId: string;
    readonly transactionId: string;
  }): Promise<Result<EngineeringLifecycleWriteAheadLogV2 | undefined, UnifiedError>>;
  prepare(
    input: EngineeringLifecycleWriteTransactionInputV2
  ): Promise<Result<EngineeringLifecycleWriteAheadLogV2, UnifiedError>>;
  appendProgress(input: {
    readonly contentRootBindingId: string;
    readonly transactionId: string;
    readonly receipt: EngineeringFileLifecycleReceiptV2;
    readonly recordedAt: string;
  }): Promise<Result<EngineeringLifecycleWriteAheadLogV2, UnifiedError>>;
  commit(input: {
    readonly contentRootBindingId: string;
    readonly transactionId: string;
    readonly committedAt: string;
  }): Promise<Result<EngineeringLifecycleWriteAheadLogV2, UnifiedError>>;
  rollback(input: {
    readonly contentRootBindingId: string;
    readonly transactionId: string;
    readonly rolledBackAt: string;
  }): Promise<Result<EngineeringLifecycleWriteAheadLogV2, UnifiedError>>;
  markSynchronized(input: {
    readonly contentRootBindingId: string;
    readonly transactionId: string;
    readonly synchronizedAt: string;
  }): Promise<Result<EngineeringLifecycleWriteAheadLogV2, UnifiedError>>;
}

export interface EngineeringLifecycleWriteTransactionV2Options {
  readonly walRepository: EngineeringLifecycleWalRepositoryV2;
  readonly mutationPort: EngineeringFileMutationPortV2;
  readonly recoveryGate: EngineeringMutationRecoveryGatePortV2;
  readonly validateReservedAuthorization: (
    prepared: EngineeringLifecycleWriteTransactionInputV2
  ) => Promise<Result<void, UnifiedError>>;
  readonly validateTerminalAuthorization?: (
    prepared: EngineeringLifecycleWriteTransactionInputV2
  ) => Promise<Result<void, UnifiedError>>;
  readonly resolveRecoveryBinding?: (
    operation: EngineeringLifecycleWriteOperationV2
  ) => Promise<Result<EngineeringLifecycleRecoveryRootBindingV2, UnifiedError>>;
  /** Persists the exact physical quarantine object only after native success and WAL progress. */
  readonly recordQuarantine?: (
    input: EngineeringLifecycleQuarantineRecordInputV2
  ) => Promise<Result<unknown, UnifiedError>>;
  /** Idempotently marks an existing quarantine record restored after native compensation. */
  readonly recordQuarantineCompensation?: (
    input: EngineeringLifecycleQuarantineCompensationRecordInputV2
  ) => Promise<Result<unknown, UnifiedError>>;
  readonly now?: () => string;
  readonly traceId?: string;
}

export interface EngineeringLifecycleQuarantineRecordInputV2 {
  readonly recoveryObjectId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly relativeIdentity: string;
  readonly sourceSha256: string;
  readonly byteLength: number;
  readonly sideEffectChecksum: string;
}

export interface EngineeringLifecycleQuarantineCompensationRecordInputV2 {
  readonly operation: EngineeringLifecycleWriteOperationV2;
  readonly receipt: EngineeringFileLifecycleReceiptV2;
}

export interface EngineeringLifecycleWalScanV2 {
  readonly schemaVersion: typeof ENGINEERING_MUTATION_V2_SCHEMA_VERSION;
  readonly contentRootBindingId: string;
  readonly journals: readonly EngineeringLifecycleWriteAheadLogV2[];
  readonly unknownRecordCount: number;
  readonly authenticationFailureCount: number;
}

export interface FileEngineeringLifecycleWalRepositoryV2Options {
  readonly stateRoot: string;
  readonly durability: EngineeringStateDurabilityPortV2;
  readonly traceId?: string;
}

/** Durable lifecycle WAL kept separate from the raw-byte WAL namespace. */
export class FileEngineeringLifecycleWalRepositoryV2 implements EngineeringLifecycleWalRepositoryV2 {
  private static readonly queues = new Map<string, Promise<void>>();
  private readonly traceId: string;

  public constructor(private readonly options: FileEngineeringLifecycleWalRepositoryV2Options) {
    this.traceId = options.traceId ?? "engineering-lifecycle-wal-repository-v2";
  }

  public async read(input: {
    readonly contentRootBindingId: string;
    readonly transactionId: string;
  }) {
    if (!isStableId(input.contentRootBindingId) || !isStableId(input.transactionId))
      return invalid("ENGINEERING_LIFECYCLE_WAL_V2_LOCATOR_INVALID", this.traceId);
    const durability = this.qualifiedDurability();
    if (durability === undefined) return durabilityUnavailable(this.traceId);
    try {
      const bytes = await durability.readFileNoFollow(
        this.path(input.contentRootBindingId, input.transactionId)
      );
      return validateLifecycleWal(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
        this.traceId
      );
    } catch (cause) {
      if (isMissing(cause)) return ok(undefined);
      return storageFailure("ENGINEERING_LIFECYCLE_WAL_V2_READ_FAILED", this.traceId);
    }
  }

  public async prepare(input: EngineeringLifecycleWriteTransactionInputV2) {
    const parsed = validateEngineeringLifecycleWriteTransactionInputV2(input, this.traceId);
    if (!parsed.ok) return parsed;
    return this.serialized(async () => {
      const current = await this.read(parsed.value);
      if (!current.ok) return current;
      if (current.value !== undefined)
        return sameCanonicalJson(current.value.prepared, parsed.value)
          ? ok(current.value)
          : conflict(this.traceId);
      const journal = createLifecycleWal(parsed.value, [], null, null, null);
      const persisted = await this.persist(journal, "create");
      return persisted.ok ? ok(journal) : persisted;
    });
  }

  public async appendProgress(input: {
    readonly contentRootBindingId: string;
    readonly transactionId: string;
    readonly receipt: EngineeringFileLifecycleReceiptV2;
    readonly recordedAt: string;
  }) {
    if (!isCanonicalUtcTimestamp(input.recordedAt))
      return invalid("ENGINEERING_LIFECYCLE_WAL_V2_PROGRESS_INVALID", this.traceId);
    return this.serialized(async () => {
      const current = await this.read(input);
      if (!current.ok) return current;
      if (current.value === undefined) return missing(this.traceId);
      if (current.value.committedAt !== null || current.value.rolledBackAt !== null)
        return invalid("ENGINEERING_LIFECYCLE_WAL_V2_PROGRESS_AFTER_COMMIT", this.traceId);
      const index = current.value.receipts.length;
      const request = current.value.prepared.operations[index]?.request;
      if (request === undefined)
        return invalid("ENGINEERING_LIFECYCLE_WAL_V2_PROGRESS_ORDER_INVALID", this.traceId);
      const bound = verifyEngineeringFileLifecycleReceiptBindingV2(input.receipt, request);
      if (!bound.ok) return bound;
      const next = createLifecycleWal(
        current.value.prepared,
        [...current.value.receipts, bound.value],
        current.value.committedAt,
        current.value.rolledBackAt,
        current.value.synchronizedAt
      );
      const persisted = await this.persist(next, "replace");
      return persisted.ok ? ok(next) : persisted;
    });
  }

  public async commit(input: {
    readonly contentRootBindingId: string;
    readonly transactionId: string;
    readonly committedAt: string;
  }) {
    if (!isCanonicalUtcTimestamp(input.committedAt))
      return invalid("ENGINEERING_LIFECYCLE_WAL_V2_COMMIT_INVALID", this.traceId);
    return this.serialized(async () => {
      const current = await this.read(input);
      if (!current.ok) return current;
      if (current.value === undefined) return missing(this.traceId);
      if (current.value.rolledBackAt !== null)
        return invalid("ENGINEERING_LIFECYCLE_WAL_V2_COMMIT_AFTER_ROLLBACK", this.traceId);
      if (current.value.receipts.length !== current.value.prepared.operations.length)
        return invalid("ENGINEERING_LIFECYCLE_WAL_V2_COMMIT_INCOMPLETE", this.traceId);
      const next = createLifecycleWal(
        current.value.prepared,
        current.value.receipts,
        input.committedAt,
        current.value.rolledBackAt,
        null
      );
      const persisted = await this.persist(next, "replace");
      return persisted.ok ? ok(next) : persisted;
    });
  }

  public async rollback(input: {
    readonly contentRootBindingId: string;
    readonly transactionId: string;
    readonly rolledBackAt: string;
  }) {
    if (!isCanonicalUtcTimestamp(input.rolledBackAt))
      return invalid("ENGINEERING_LIFECYCLE_WAL_V2_ROLLBACK_INVALID", this.traceId);
    return this.serialized(async () => {
      const current = await this.read(input);
      if (!current.ok) return current;
      if (current.value === undefined) return missing(this.traceId);
      if (current.value.committedAt !== null)
        return invalid("ENGINEERING_LIFECYCLE_WAL_V2_ROLLBACK_AFTER_COMMIT", this.traceId);
      if (current.value.rolledBackAt !== null) return ok(current.value);
      const next = createLifecycleWal(
        current.value.prepared,
        current.value.receipts,
        current.value.committedAt,
        input.rolledBackAt,
        null
      );
      const persisted = await this.persist(next, "replace");
      return persisted.ok ? ok(next) : persisted;
    });
  }

  public async markSynchronized(input: {
    readonly contentRootBindingId: string;
    readonly transactionId: string;
    readonly synchronizedAt: string;
  }) {
    if (!isCanonicalUtcTimestamp(input.synchronizedAt))
      return invalid("ENGINEERING_LIFECYCLE_WAL_V2_SYNCHRONIZATION_INVALID", this.traceId);
    return this.serialized(async () => {
      const current = await this.read(input);
      if (!current.ok) return current;
      if (current.value === undefined) return missing(this.traceId);
      if (current.value.committedAt === null && current.value.rolledBackAt === null)
        return invalid(
          "ENGINEERING_LIFECYCLE_WAL_V2_SYNCHRONIZATION_BEFORE_TERMINAL",
          this.traceId
        );
      if (current.value.synchronizedAt !== null) return ok(current.value);
      const terminalAt = current.value.committedAt ?? current.value.rolledBackAt;
      if (terminalAt === null || Date.parse(input.synchronizedAt) < Date.parse(terminalAt))
        return invalid("ENGINEERING_LIFECYCLE_WAL_V2_SYNCHRONIZATION_INVALID", this.traceId);
      const next = createLifecycleWal(
        current.value.prepared,
        current.value.receipts,
        current.value.committedAt,
        current.value.rolledBackAt,
        input.synchronizedAt
      );
      const persisted = await this.persist(next, "replace");
      return persisted.ok ? ok(next) : persisted;
    });
  }

  public async scanRoot(
    contentRootBindingId: string
  ): Promise<Result<EngineeringLifecycleWalScanV2, UnifiedError>> {
    if (!isStableId(contentRootBindingId))
      return invalid("ENGINEERING_LIFECYCLE_WAL_V2_ROOT_INVALID", this.traceId);
    const durability = this.qualifiedDurability();
    if (durability === undefined) return durabilityUnavailable(this.traceId);
    const directory = this.rootDirectory(contentRootBindingId);
    let entries: readonly EngineeringStateDirectoryEntryV2[];
    try {
      entries = await durability.readDirectoryNoFollow(directory);
    } catch (cause) {
      if (isMissing(cause))
        return ok({
          schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
          contentRootBindingId,
          journals: [],
          unknownRecordCount: 0,
          authenticationFailureCount: 0
        });
      return storageFailure("ENGINEERING_LIFECYCLE_WAL_V2_SCAN_FAILED", this.traceId);
    }
    const journals: EngineeringLifecycleWriteAheadLogV2[] = [];
    let unknownRecordCount = 0;
    let authenticationFailureCount = 0;
    for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.kind !== "file" || !/^transaction-[a-f0-9]{64}\.json$/u.test(entry.name)) {
        unknownRecordCount += 1;
        continue;
      }
      try {
        const raw = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            await durability.readFileNoFollow(join(directory, entry.name))
          )
        );
        const journal = validateLifecycleWal(raw, this.traceId);
        if (
          !journal.ok ||
          journal.value === undefined ||
          journal.value.prepared.contentRootBindingId !== contentRootBindingId ||
          entry.name !== `${diskKey("transaction", journal.value.prepared.transactionId)}.json`
        )
          authenticationFailureCount += 1;
        else journals.push(journal.value);
      } catch {
        unknownRecordCount += 1;
      }
    }
    return ok({
      schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
      contentRootBindingId,
      journals: journals.sort((a, b) =>
        a.prepared.transactionId.localeCompare(b.prepared.transactionId)
      ),
      unknownRecordCount,
      authenticationFailureCount
    });
  }

  private async persist(
    journal: EngineeringLifecycleWriteAheadLogV2,
    mode: "create" | "replace"
  ): Promise<Result<void, UnifiedError>> {
    const durability = this.qualifiedDurability();
    if (durability === undefined) return durabilityUnavailable(this.traceId);
    const directory = this.rootDirectory(journal.prepared.contentRootBindingId);
    const target = this.path(journal.prepared.contentRootBindingId, journal.prepared.transactionId);
    const temporary = `${target}.${randomUUID()}.tmp`;
    let handle: EngineeringStateFileHandleV2 | undefined;
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
      if (mode === "create") await durability.linkNoFollow(temporary, target);
      else await durability.renameReplaceNoFollow(temporary, target);
      await durability.flushDirectory(directory);
      return ok(undefined);
    } catch (cause) {
      if (isAlreadyExists(cause)) return conflict(this.traceId);
      return storageFailure("ENGINEERING_LIFECYCLE_WAL_V2_WRITE_FAILED", this.traceId);
    } finally {
      try {
        if (handle !== undefined) await handle.close();
        await durability.unlinkNoFollow(temporary);
        await durability.flushDirectory(directory);
      } catch (cause) {
        if (!isMissing(cause)) {
          /* startup scan remains fail closed */
        }
      }
    }
  }

  private rootDirectory(root: string): string {
    return join(this.options.stateRoot, "engineering-v2", "lifecycle-wal", diskKey("root", root));
  }
  private path(root: string, tx: string): string {
    return join(this.rootDirectory(root), `${diskKey("transaction", tx)}.json`);
  }
  private qualifiedDurability(): EngineeringStateDurabilityPortV2 | undefined {
    return this.options.durability?.qualification === "qualified"
      ? this.options.durability
      : undefined;
  }
  private async serialized<T>(
    operation: () => Promise<Result<T, UnifiedError>>
  ): Promise<Result<T, UnifiedError>> {
    const key = this.options.stateRoot;
    const previous = FileEngineeringLifecycleWalRepositoryV2.queues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    FileEngineeringLifecycleWalRepositoryV2.queues.set(key, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (FileEngineeringLifecycleWalRepositoryV2.queues.get(key) === current)
        FileEngineeringLifecycleWalRepositoryV2.queues.delete(key);
    }
  }
}

/** Durable B8 lifecycle coordinator. The injected WAL must flush before returning from each call. */
export class EngineeringLifecycleWriteTransactionV2 {
  private readonly now: () => string;
  private readonly traceId: string;
  private queue: Promise<void> = Promise.resolve();

  public constructor(private readonly options: EngineeringLifecycleWriteTransactionV2Options) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.traceId = options.traceId ?? "engineering-lifecycle-write-transaction-v2";
  }

  public async apply(
    input: unknown
  ): Promise<Result<EngineeringLifecycleWriteAheadLogV2, UnifiedError>> {
    return this.serialized(async () => {
      const prepared = validateEngineeringLifecycleWriteTransactionInputV2(input, this.traceId);
      if (!prepared.ok) return prepared;
      if (this.options.mutationPort.finalizeLifecycle === undefined)
        return lifecycleUnavailable(this.traceId);
      const existing = await this.options.walRepository.read({
        contentRootBindingId: prepared.value.contentRootBindingId,
        transactionId: prepared.value.transactionId
      });
      if (!existing.ok) return existing;
      let journal = existing.value;
      let createdThisAttempt = false;
      if (journal === undefined) {
        const gate = await this.options.recoveryGate.assertMutationAllowed(
          prepared.value.contentRootBindingId
        );
        if (!gate.ok) return gate;
        const authorized = await this.options.validateReservedAuthorization(prepared.value);
        if (!authorized.ok) return authorized;
        const created = await this.options.walRepository.prepare(prepared.value);
        if (!created.ok) return created;
        journal = created.value;
        createdThisAttempt = true;
      } else if (
        canonicalizeEngineeringMutationV2Json(journal.prepared) !==
        canonicalizeEngineeringMutationV2Json(prepared.value)
      ) {
        return invalid("ENGINEERING_LIFECYCLE_WRITE_TRANSACTION_V2_CONFLICT", this.traceId);
      }
      if (journal.committedAt !== null) {
        const finalized = await this.finalizeTerminal(journal);
        return finalized.ok ? ok(journal) : finalized;
      }
      if (journal.rolledBackAt !== null)
        return invalid("ENGINEERING_LIFECYCLE_WRITE_TRANSACTION_V2_ROLLED_BACK", this.traceId);
      // A lifecycle mutation has no pathname fallback and cannot be safely replayed after a
      // process crash between the native mutation and its durable progress receipt.  A normal
      // apply may proceed only from the WAL it created in this attempt; recovery must classify
      // every pre-existing incomplete operation through a Main-owned recovery implementation.
      if (!createdThisAttempt) return lifecycleRecoveryRequired(this.traceId);
      const lease = await this.options.recoveryGate.acquireMutationLease({
        contentRootBindingId: prepared.value.contentRootBindingId,
        transactionId: prepared.value.transactionId,
        preparedChecksum: journal.preparedChecksum
      });
      if (!lease.ok) return lease;
      try {
        for (
          let index = journal.receipts.length;
          index < prepared.value.operations.length;
          index += 1
        ) {
          const current = prepared.value.operations[index];
          if (current === undefined)
            return invalid(
              "ENGINEERING_LIFECYCLE_WRITE_TRANSACTION_V2_ORDER_INVALID",
              this.traceId
            );
          const active = await lease.value.assertCurrent();
          if (!active.ok) return active;
          const authorized = await this.options.validateReservedAuthorization(prepared.value);
          if (!authorized.ok) return authorized;
          let result: Result<EngineeringFileLifecycleReceiptV2, UnifiedError>;
          if (current.request.operationKind === "move_file") {
            result = await this.invoke("move", current.request);
          } else if (current.request.operationKind === "delete_file") {
            if (
              this.options.resolveRecoveryBinding === undefined ||
              this.options.mutationPort.inspectQuarantine === undefined ||
              this.options.recordQuarantine === undefined ||
              this.options.recordQuarantineCompensation === undefined
            )
              return lifecycleUnavailable(this.traceId);
            const recovery = await this.options.resolveRecoveryBinding(current);
            if (!recovery.ok) return recovery;
            if (
              current.recoveryBinding === null ||
              recovery.value.recoveryRootBindingId !==
                current.recoveryBinding.recoveryRootBindingId ||
              recovery.value.grantRevision !== current.recoveryBinding.grantRevision ||
              recovery.value.sideEffectChecksum !== current.recoveryBinding.sideEffectChecksum
            )
              return invalid(
                "ENGINEERING_LIFECYCLE_WRITE_TRANSACTION_V2_RECOVERY_BINDING_STALE",
                this.traceId
              );
            result = await this.invoke("quarantine", {
              request: current.request,
              recoveryBinding: recovery.value
            });
          } else {
            result = await this.invoke("createDirectory", current.request);
          }
          if (!result.ok) return result;
          const advanced = await this.options.walRepository.appendProgress({
            contentRootBindingId: prepared.value.contentRootBindingId,
            transactionId: prepared.value.transactionId,
            receipt: result.value,
            recordedAt: this.now()
          });
          if (!advanced.ok) return advanced;
          journal = advanced.value;
          if (current.request.operationKind === "delete_file") {
            const recorded = await this.recordQuarantine(current, result.value);
            if (!recorded.ok) return recorded;
          }
        }
        const committed = await this.options.walRepository.commit({
          contentRootBindingId: prepared.value.contentRootBindingId,
          transactionId: prepared.value.transactionId,
          committedAt: this.now()
        });
        if (!committed.ok) return committed;
        const finalized = await this.finalizeTerminal(committed.value);
        return finalized.ok ? committed : finalized;
      } finally {
        await releaseLease(lease.value);
      }
    });
  }

  /** Resolves one authenticated incomplete lifecycle WAL without reopening the ordinary gate. */
  public async recover(
    input: unknown
  ): Promise<Result<EngineeringLifecycleWriteAheadLogV2, UnifiedError>> {
    return this.serialized(async () => {
      const locator = parseLocator(input);
      if (locator === undefined)
        return invalid("ENGINEERING_LIFECYCLE_WRITE_TRANSACTION_V2_LOCATOR_INVALID", this.traceId);
      const current = await this.options.walRepository.read(locator);
      if (!current.ok) return current;
      if (current.value === undefined) return missing(this.traceId);
      if (current.value.committedAt !== null || current.value.rolledBackAt !== null) {
        const finalized = await this.finalizeTerminal(current.value);
        return finalized.ok ? ok(current.value) : finalized;
      }
      const lease = await this.options.recoveryGate.acquireRecoveryLease({
        ...locator,
        preparedChecksum: current.value.preparedChecksum
      });
      if (!lease.ok) return lease;
      try {
        return await this.resolveIncomplete(current.value, lease.value);
      } finally {
        await releaseLease(lease.value);
      }
    });
  }

  private async resolveIncomplete(
    journal: EngineeringLifecycleWriteAheadLogV2,
    lease: EngineeringRecoveryMutationLeaseV2
  ): Promise<Result<EngineeringLifecycleWriteAheadLogV2, UnifiedError>> {
    if (
      this.options.mutationPort.reconcileLifecycle === undefined ||
      this.options.mutationPort.compensateLifecycle === undefined ||
      this.options.mutationPort.resumeLifecycle === undefined ||
      this.options.mutationPort.finalizeLifecycle === undefined
    )
      return lifecycleUnavailable(this.traceId);
    const active = await lease.assertCurrent();
    if (!active.ok) return active;
    const authorized = await this.options.validateReservedAuthorization(journal.prepared);
    if (!authorized.ok) return authorized;

    const recoveryInputs: EngineeringFileLifecycleRecoveryInputV2[] = [];
    for (const operation of journal.prepared.operations) {
      const recoveryInput = await this.recoveryInputFor(operation);
      if (!recoveryInput.ok) return recoveryInput;
      recoveryInputs.push(recoveryInput.value);
    }

    const states: EngineeringFileLifecycleOperationStateV2[] = [];
    for (let index = 0; index < journal.prepared.operations.length; index += 1) {
      const operation = journal.prepared.operations[index];
      const recoveryInput = recoveryInputs[index];
      if (operation === undefined || recoveryInput === undefined)
        return lifecycleRecoveryReviewRequired(this.traceId);
      const state = await this.options.mutationPort.reconcileLifecycle(recoveryInput);
      if (!state.ok) return state;
      const bound = bindLifecycleOperationState(state.value, operation.request);
      if (!bound.ok) return bound;
      states.push(bound.value);
    }

    const intermediateIndexes = states.flatMap((state, index) =>
      state.state === "intermediate" ? [index] : []
    );
    const intermediateIndex = intermediateIndexes[0] ?? -1;
    const completedAfterCount =
      intermediateIndex < 0
        ? states.findIndex((state) => state.state === "before")
        : intermediateIndex;
    const initialAfterCount = completedAfterCount < 0 ? states.length : completedAfterCount;
    if (
      intermediateIndexes.length > 1 ||
      states.some((state) => state.state === "neither" || state.state === "unknown") ||
      states.slice(0, initialAfterCount).some((state) => state.state !== "after") ||
      (intermediateIndex >= 0 &&
        states.slice(intermediateIndex + 1).some((state) => state.state !== "before")) ||
      (intermediateIndex < 0 &&
        states.slice(initialAfterCount).some((state) => state.state !== "before"))
    ) {
      return lifecycleRecoveryReviewRequired(this.traceId);
    }

    if (journal.receipts.length > initialAfterCount)
      return lifecycleRecoveryReviewRequired(this.traceId);
    for (let index = 0; index < journal.receipts.length; index += 1) {
      const state = states[index];
      const receipt = journal.receipts[index];
      if (
        state?.state !== "after" ||
        receipt === undefined ||
        !sameCanonicalJson(state.receipt, receipt)
      )
        return lifecycleRecoveryReviewRequired(this.traceId);
    }

    if (intermediateIndex >= 0) {
      const recoveryInput = recoveryInputs[intermediateIndex];
      if (recoveryInput === undefined) return lifecycleRecoveryReviewRequired(this.traceId);
      const stillActive = await lease.assertCurrent();
      if (!stillActive.ok) return stillActive;
      const stillAuthorized = await this.options.validateReservedAuthorization(journal.prepared);
      if (!stillAuthorized.ok) return stillAuthorized;
      const resumed = await this.options.mutationPort.resumeLifecycle(recoveryInput);
      if (!resumed.ok) return resumed;
      const resumedState = bindLifecycleOperationState(
        resumed.value,
        journal.prepared.operations[intermediateIndex]?.request
      );
      if (!resumedState.ok || resumedState.value.state !== "after")
        return lifecycleRecoveryReviewRequired(this.traceId);

      for (let index = 0; index < journal.prepared.operations.length; index += 1) {
        const operation = journal.prepared.operations[index];
        const input = recoveryInputs[index];
        if (operation === undefined || input === undefined)
          return lifecycleRecoveryReviewRequired(this.traceId);
        const state = await this.options.mutationPort.reconcileLifecycle(input);
        if (!state.ok) return state;
        const bound = bindLifecycleOperationState(state.value, operation.request);
        if (!bound.ok) return bound;
        states[index] = bound.value;
      }
    }

    const firstBefore = states.findIndex((state) => state.state === "before");
    const afterCount = firstBefore < 0 ? states.length : firstBefore;
    if (
      states.some(
        (state, index) =>
          state.state === "intermediate" ||
          state.state === "neither" ||
          state.state === "unknown" ||
          (index < afterCount ? state.state !== "after" : state.state !== "before")
      )
    )
      return lifecycleRecoveryReviewRequired(this.traceId);
    for (let index = 0; index < journal.receipts.length; index += 1) {
      const state = states[index];
      const receipt = journal.receipts[index];
      if (
        state?.state !== "after" ||
        receipt === undefined ||
        !sameCanonicalJson(state.receipt, receipt)
      )
        return lifecycleRecoveryReviewRequired(this.traceId);
    }

    let durable = journal;
    for (let index = durable.receipts.length; index < afterCount; index += 1) {
      const state = states[index];
      if (state?.state !== "after") return lifecycleRecoveryReviewRequired(this.traceId);
      const advanced = await this.options.walRepository.appendProgress({
        contentRootBindingId: durable.prepared.contentRootBindingId,
        transactionId: durable.prepared.transactionId,
        receipt: state.receipt,
        recordedAt: this.now()
      });
      if (!advanced.ok) return advanced;
      durable = advanced.value;
    }

    for (let index = afterCount - 1; index >= 0; index -= 1) {
      const recoveryInput = recoveryInputs[index];
      if (recoveryInput === undefined) return lifecycleRecoveryReviewRequired(this.traceId);
      const current = await this.options.mutationPort.reconcileLifecycle(recoveryInput);
      if (!current.ok) return current;
      const rebound = bindLifecycleOperationState(
        current.value,
        durable.prepared.operations[index]?.request
      );
      const expectedReceipt = durable.receipts[index];
      if (
        !rebound.ok ||
        rebound.value.state !== "after" ||
        expectedReceipt === undefined ||
        !sameCanonicalJson(rebound.value.receipt, expectedReceipt)
      )
        return lifecycleRecoveryReviewRequired(this.traceId);
      const stillActive = await lease.assertCurrent();
      if (!stillActive.ok) return stillActive;
      const stillAuthorized = await this.options.validateReservedAuthorization(durable.prepared);
      if (!stillAuthorized.ok) return stillAuthorized;
      const compensated = await this.options.mutationPort.compensateLifecycle({
        ...recoveryInput,
        expectedReceipt
      });
      if (!compensated.ok) return compensated;
      const compensatedState = bindLifecycleOperationState(
        compensated.value,
        durable.prepared.operations[index]?.request
      );
      if (!compensatedState.ok || compensatedState.value.state !== "before")
        return lifecycleRecoveryReviewRequired(this.traceId);
      const operation = durable.prepared.operations[index];
      if (operation?.request.operationKind === "delete_file") {
        if (this.options.recordQuarantineCompensation === undefined)
          return lifecycleUnavailable(this.traceId);
        const marked = await this.options.recordQuarantineCompensation({
          operation,
          receipt: expectedReceipt
        });
        if (!marked.ok) return marked;
      }
    }

    const rolledBack = await this.options.walRepository.rollback({
      contentRootBindingId: durable.prepared.contentRootBindingId,
      transactionId: durable.prepared.transactionId,
      rolledBackAt: this.now()
    });
    if (!rolledBack.ok) return rolledBack;
    const finalized = await this.finalizeTerminal(rolledBack.value);
    return finalized.ok ? rolledBack : finalized;
  }

  private async finalizeTerminal(
    journal: EngineeringLifecycleWriteAheadLogV2
  ): Promise<Result<void, UnifiedError>> {
    const finalize = this.options.mutationPort.finalizeLifecycle;
    if (
      finalize === undefined ||
      (journal.committedAt === null && journal.rolledBackAt === null) ||
      (journal.committedAt !== null && journal.rolledBackAt !== null)
    ) {
      return lifecycleUnavailable(this.traceId);
    }
    const validateTerminalAuthorization =
      this.options.validateTerminalAuthorization ?? this.options.validateReservedAuthorization;
    const authorized = await validateTerminalAuthorization(journal.prepared);
    if (!authorized.ok) return authorized;
    for (const operation of journal.prepared.operations) {
      const recoveryInput = await this.recoveryInputFor(operation);
      if (!recoveryInput.ok) return recoveryInput;
      const finalized = await finalize({
        ...recoveryInput.value,
        expectedState: journal.committedAt === null ? "before" : "after"
      });
      if (!finalized.ok) return finalized;
    }
    return ok(undefined);
  }

  private async recoveryInputFor(
    operation: EngineeringLifecycleWriteOperationV2
  ): Promise<Result<EngineeringFileLifecycleRecoveryInputV2, UnifiedError>> {
    if (operation.request.operationKind !== "delete_file") {
      return ok({ request: operation.request, recoveryBinding: null });
    }
    if (this.options.resolveRecoveryBinding === undefined || operation.recoveryBinding === null)
      return lifecycleUnavailable(this.traceId);
    const resolved = await this.options.resolveRecoveryBinding(operation);
    if (!resolved.ok) return resolved;
    if (
      resolved.value.recoveryRootBindingId !== operation.recoveryBinding.recoveryRootBindingId ||
      resolved.value.grantRevision !== operation.recoveryBinding.grantRevision ||
      resolved.value.sideEffectChecksum !== operation.recoveryBinding.sideEffectChecksum
    )
      return invalid(
        "ENGINEERING_LIFECYCLE_WRITE_TRANSACTION_V2_RECOVERY_BINDING_STALE",
        this.traceId
      );
    return ok({ request: operation.request, recoveryBinding: resolved.value });
  }

  private async recordQuarantine(
    operation: EngineeringLifecycleWriteOperationV2,
    receipt: EngineeringFileLifecycleReceiptV2
  ): Promise<Result<unknown, UnifiedError>> {
    const inspect = this.options.mutationPort.inspectQuarantine;
    const record = this.options.recordQuarantine;
    if (
      operation.request.operationKind !== "delete_file" ||
      inspect === undefined ||
      record === undefined
    )
      return lifecycleUnavailable(this.traceId);
    const recoveryInput = await this.recoveryInputFor(operation);
    if (!recoveryInput.ok) return recoveryInput;
    if (recoveryInput.value.recoveryBinding === null) return lifecycleUnavailable(this.traceId);
    const inventory = await inspect(recoveryInput.value.recoveryBinding);
    if (!inventory.ok) return inventory;
    const matches = inventory.value.objects.filter(
      (candidate) => candidate.recoveryObjectId === operation.request.recoveryObjectId
    );
    const object = matches[0];
    if (
      matches.length !== 1 ||
      object === undefined ||
      object.fileIdentity !== operation.request.sourceFileIdentity ||
      object.sha256 !== operation.request.sourceSha256 ||
      object.byteLength > BigInt(Number.MAX_SAFE_INTEGER) ||
      receipt.recoveryObjectId !== operation.request.recoveryObjectId
    )
      return lifecycleQuarantineRecordInvalid(this.traceId);
    return record({
      recoveryObjectId: operation.request.recoveryObjectId,
      transactionId: operation.request.transactionId,
      operationId: operation.request.operationId,
      relativeIdentity: operation.request.relativeSource,
      sourceSha256: operation.request.sourceSha256,
      byteLength: Number(object.byteLength),
      sideEffectChecksum: operation.request.recoverySideEffectChecksum
    });
  }

  private async invoke(
    kind: "move" | "quarantine" | "createDirectory",
    input: unknown
  ): Promise<Result<EngineeringFileLifecycleReceiptV2, UnifiedError>> {
    const method = this.options.mutationPort[kind];
    return method === undefined ? lifecycleUnavailable(this.traceId) : method(input);
  }

  private async serialized<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await task();
    } finally {
      release();
    }
  }
}

/**
 * B7's raw-byte transaction coordinator.  It does not implement rollback/move/delete/quarantine;
 * an uncommitted record remains for the Main-owned recovery gate rather than guessing a write.
 */
export class EngineeringWriteTransactionV2 {
  private readonly now: () => string;
  private readonly traceId: string;
  private queue: Promise<void> = Promise.resolve();

  public constructor(private readonly options: EngineeringWriteTransactionV2Options) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.traceId = options.traceId ?? "engineering-write-transaction-v2";
  }

  /** Persists verified raw blobs first, then the immutable prepared WAL record; it never mutates files. */
  public async prepare(input: unknown): Promise<Result<EngineeringWriteAheadLogV2, UnifiedError>> {
    return this.serialized(() => this.prepareUnsafe(input));
  }

  /** Applies replace/create in prepared order and commits only after a full after-state re-read. */
  public async apply(input: unknown): Promise<Result<EngineeringWriteAheadLogV2, UnifiedError>> {
    return this.serialized(async () => {
      const prepared = await this.prepareUnsafe(input);
      if (!prepared.ok) return prepared;
      // A committed journal is a terminal durable fact, not a request to re-authorize or re-open
      // the gate.  This makes replayed completion responses idempotent even after authorization
      // has expired or the root has subsequently entered recovery.
      if (prepared.value.commit !== null) return ok(prepared.value);
      const lease = await this.options.recoveryGate.acquireMutationLease(
        leaseInput(prepared.value.prepared)
      );
      if (!lease.ok) return lease;
      try {
        return this.applyPreparedUnsafe(prepared.value, lease.value);
      } finally {
        await releaseLease(lease.value);
      }
    });
  }

  /** Main recovery code may resume its own authenticated prepared transaction; callers cannot adopt it. */
  public async resume(input: unknown): Promise<Result<EngineeringWriteAheadLogV2, UnifiedError>> {
    return this.serialized(async () => {
      const locator = parseLocator(input);
      if (locator === undefined)
        return invalid("ENGINEERING_WRITE_TRANSACTION_V2_LOCATOR_INVALID", this.traceId);
      const current = await this.options.walRepository.read(locator);
      if (!current.ok) return current;
      if (current.value === undefined) return missing(this.traceId);
      if (current.value.commit !== null) return ok(current.value);
      const lease = await this.options.recoveryGate.acquireRecoveryLease(
        leaseInput(current.value.prepared)
      );
      if (!lease.ok) return lease;
      try {
        return this.applyPreparedUnsafe(current.value, lease.value);
      } finally {
        await releaseLease(lease.value);
      }
    });
  }

  private async prepareUnsafe(
    input: unknown
  ): Promise<Result<EngineeringWriteAheadLogV2, UnifiedError>> {
    const parsed = parseTransactionInput(input);
    if (parsed === undefined)
      return invalid("ENGINEERING_WRITE_TRANSACTION_V2_INPUT_INVALID", this.traceId);
    const existing = await this.options.walRepository.read({
      contentRootBindingId: parsed.contentRootBindingId,
      transactionId: parsed.transactionId
    });
    if (!existing.ok) return existing;
    if (existing.value !== undefined) return ok(existing.value);
    const gate = await this.options.recoveryGate.assertMutationAllowed(parsed.contentRootBindingId);
    if (!gate.ok) return gate;

    // Blob identifiers are deterministic from validated raw bytes.  Build the complete immutable
    // prepared record and authorize its full side-effect subject *before* creating any blob files.
    const prepared = this.buildPrepared(parsed);
    if (!prepared.ok) return prepared;
    const authorized = await this.validateAuthorization(prepared.value);
    if (!authorized.ok) return authorized;
    for (const operation of prepared.value.operations) {
      const reservation = await this.validateStagingReservation(prepared.value, operation);
      if (!reservation.ok) return reservation;
    }
    const stored = await this.persistPreparedBlobs(parsed, prepared.value);
    if (!stored.ok) return stored;
    return this.options.walRepository.prepare(prepared.value);
  }

  private async applyPreparedUnsafe(
    journal: EngineeringWriteAheadLogV2,
    lease: EngineeringRecoveryMutationLeaseV2
  ): Promise<Result<EngineeringWriteAheadLogV2, UnifiedError>> {
    const prepared = journal.prepared;
    if (journal.commit !== null) return ok(journal);
    const leaseCurrent = await lease.assertCurrent();
    if (!leaseCurrent.ok) return leaseCurrent;

    let current = journal;
    for (
      let ordinal = current.progress.length;
      ordinal < prepared.operations.length;
      ordinal += 1
    ) {
      const operation = prepared.operations[ordinal];
      if (operation === undefined)
        return invalid("ENGINEERING_WRITE_TRANSACTION_V2_ORDER_INVALID", this.traceId);
      // Re-read the immutable bytes immediately before reconciliation and pass those exact bytes
      // through to native.  The request's blob references alone are never used as native content.
      const applyInput = await this.readOperationBytes(operation);
      if (!applyInput.ok) return applyInput;
      const state = await this.options.mutationPort.reconcile(applyInput.value);
      if (!state.ok) return state;
      if (state.value.state === "after") {
        const progress = await this.options.walRepository.appendProgress({
          contentRootBindingId: prepared.contentRootBindingId,
          transactionId: prepared.transactionId,
          receipt: state.value.receipt,
          recordedAt: this.now()
        });
        if (!progress.ok) return progress;
        current = progress.value;
        continue;
      }
      if (state.value.state !== "before") {
        return reconciliationRequired(state.value.state, this.traceId);
      }

      // Revalidate the full reserved subject and the qualified staging reservation for every
      // content-root write.  A lost/revoked approval therefore cannot advance a later operation.
      const beforeWriteLease = await lease.assertCurrent();
      if (!beforeWriteLease.ok) return beforeWriteLease;
      const authorized = await this.validateAuthorization(prepared);
      if (!authorized.ok) return authorized;
      const reservation = await this.validateStagingReservation(prepared, operation);
      if (!reservation.ok) return reservation;
      const finalLease = await lease.assertCurrent();
      if (!finalLease.ok) return finalLease;
      // Native returns only after file/directory flush and the facade validates its bound receipt.
      const receipt = await this.options.mutationPort.apply(applyInput.value);
      if (!receipt.ok) return receipt;
      // WAL progress is deliberately the next durable action after receipt/after validation.
      const progress = await this.options.walRepository.appendProgress({
        contentRootBindingId: prepared.contentRootBindingId,
        transactionId: prepared.transactionId,
        receipt: receipt.value,
        recordedAt: this.now()
      });
      if (!progress.ok) return progress;
      current = progress.value;
    }

    const receipts = current.progress.map((progress) => progress.receipt);
    const beforeCommitLease = await lease.assertCurrent();
    if (!beforeCommitLease.ok) return beforeCommitLease;
    const revalidated = await this.options.verifyFullAfterManifest({ prepared, receipts });
    if (!revalidated.ok) return revalidated;
    if (!afterManifestMatchesReceipts(revalidated.value, receipts)) {
      return invalid("ENGINEERING_WRITE_TRANSACTION_V2_AFTER_MANIFEST_MISMATCH", this.traceId);
    }
    // Only the verified complete after set authorizes the durable commit marker.
    return this.options.walRepository.commit({
      contentRootBindingId: prepared.contentRootBindingId,
      transactionId: prepared.transactionId,
      fullAfterManifestChecksum: engineeringFullAfterManifestChecksumV2(receipts),
      committedAt: this.now()
    });
  }

  private buildPrepared(
    input: EngineeringWriteTransactionInputV2
  ): Result<EngineeringWriteTransactionPreparedV2, UnifiedError> {
    const operations: EngineeringFileMutationRequestV2[] = [];
    for (const operation of input.operations) {
      const candidateBlob = createEngineeringMutationBlobReferenceV2({
        contentRootBindingId: input.contentRootBindingId,
        bytes: operation.candidate.bytes
      });
      if (!candidateBlob.ok) return candidateBlob;
      const beforeBlob =
        operation.before.kind === "present"
          ? createEngineeringMutationBlobReferenceV2({
              contentRootBindingId: input.contentRootBindingId,
              bytes: operation.before.bytes
            })
          : undefined;
      if (beforeBlob !== undefined && !beforeBlob.ok) return beforeBlob;
      const request = buildMutationRequest(
        input,
        operation,
        candidateBlob.value,
        beforeBlob?.value
      );
      if (!request.ok) return request;
      operations.push(request.value);
    }
    try {
      return ok(
        createEngineeringWriteTransactionPreparedV2({
          transactionId: input.transactionId,
          contentRootBindingId: input.contentRootBindingId,
          providerSemanticVersionSetChecksum: input.providerSemanticVersionSetChecksum,
          authorization: input.authorization,
          operations,
          preparedAt: input.preparedAt
        })
      );
    } catch {
      return invalid("ENGINEERING_WRITE_TRANSACTION_V2_PREPARED_INVALID", this.traceId);
    }
  }

  private async persistPreparedBlobs(
    input: EngineeringWriteTransactionInputV2,
    prepared: EngineeringWriteTransactionPreparedV2
  ): Promise<Result<void, UnifiedError>> {
    for (let ordinal = 0; ordinal < prepared.operations.length; ordinal += 1) {
      const operation = prepared.operations[ordinal];
      const source = input.operations[ordinal];
      if (operation === undefined || source === undefined) {
        return invalid("ENGINEERING_WRITE_TRANSACTION_V2_ORDER_INVALID", this.traceId);
      }
      const candidate = await this.options.blobStore.put({
        contentRootBindingId: prepared.contentRootBindingId,
        bytes: source.candidate.bytes
      });
      if (!candidate.ok) return candidate;
      if (!sameCanonicalJson(candidate.value, operation.candidate.blob)) {
        return blobReferenceMismatch(this.traceId);
      }
      if (source.before.kind === "present") {
        if (operation.before.kind !== "present") {
          return invalid("ENGINEERING_WRITE_TRANSACTION_V2_ORDER_INVALID", this.traceId);
        }
        const before = await this.options.blobStore.put({
          contentRootBindingId: prepared.contentRootBindingId,
          bytes: source.before.bytes
        });
        if (!before.ok) return before;
        if (!sameCanonicalJson(before.value, operation.before.blob)) {
          return blobReferenceMismatch(this.traceId);
        }
      }
    }
    return ok(undefined);
  }

  private async readOperationBytes(
    operation: EngineeringFileMutationRequestV2
  ): Promise<Result<EngineeringFileMutationApplyInputV2, UnifiedError>> {
    const candidate = await this.options.blobStore.get(operation.candidate.blob);
    if (!candidate.ok) return candidate;
    const before =
      operation.before.kind === "present"
        ? await this.options.blobStore.get(operation.before.blob)
        : undefined;
    if (before !== undefined && !before.ok) return before;
    return ok({
      request: operation,
      beforeBytes: before === undefined ? null : before.value,
      candidateBytes: candidate.value
    });
  }

  private async validateAuthorization(
    prepared: EngineeringWriteTransactionPreparedV2
  ): Promise<Result<void, UnifiedError>> {
    try {
      return await this.options.validateReservedAuthorization(prepared);
    } catch {
      return authorizationUnavailable(this.traceId);
    }
  }

  private async validateStagingReservation(
    prepared: EngineeringWriteTransactionPreparedV2,
    operation: EngineeringFileMutationRequestV2
  ): Promise<Result<void, UnifiedError>> {
    if (this.options.validateStagingReservation === undefined) {
      return stagingReservationUnavailable(this.traceId);
    }
    try {
      return await this.options.validateStagingReservation({ prepared, operation });
    } catch {
      return stagingReservationUnavailable(this.traceId);
    }
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

function buildMutationRequest(
  input: EngineeringWriteTransactionInputV2,
  operation: EngineeringWriteTransactionOperationInputV2,
  candidateBlob: EngineeringMutationBlobReferenceV2,
  beforeBlob: EngineeringMutationBlobReferenceV2 | undefined
): Result<EngineeringFileMutationRequestV2, UnifiedError> {
  const before =
    operation.before.kind === "present"
      ? beforeBlob === undefined
        ? undefined
        : {
            schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
            kind: "present" as const,
            manifest: operation.before.manifest,
            blob: beforeBlob
          }
      : {
          schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
          kind: "absent" as const,
          absenceProof: operation.before.absenceProof
        };
  if (before === undefined) return invalid("ENGINEERING_WRITE_TRANSACTION_V2_BLOB_INVALID");
  const request = {
    schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
    operationKind: operation.operationKind,
    contentRootBindingId: input.contentRootBindingId,
    transactionId: input.transactionId,
    operationId: operation.operationId,
    providerSemanticVersionSetChecksum: input.providerSemanticVersionSetChecksum,
    relativeIdentity: operation.relativeIdentity,
    before,
    candidate: {
      schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
      manifest: operation.candidate.manifest,
      blob: candidateBlob
    },
    stagingObjectId: operation.stagingObjectId
  };
  return validateMutationRequest(request);
}

function validateMutationRequest(
  request: unknown
): Result<EngineeringFileMutationRequestV2, UnifiedError> {
  return validateEngineeringFileMutationRequestV2(request);
}

function parseTransactionInput(value: unknown): EngineeringWriteTransactionInputV2 | undefined {
  if (!hasExactKeys(value, transactionInputKeys)) return undefined;
  if (
    value["schemaVersion"] !== ENGINEERING_MUTATION_V2_SCHEMA_VERSION ||
    !isStableId(value["transactionId"]) ||
    !isStableId(value["contentRootBindingId"]) ||
    !isSha256(value["providerSemanticVersionSetChecksum"]) ||
    !isAuthorization(value["authorization"]) ||
    !Array.isArray(value["operations"]) ||
    value["operations"].length === 0 ||
    value["operations"].length > 64 ||
    !isCanonicalUtcTimestamp(value["preparedAt"])
  ) {
    return undefined;
  }
  const operations: EngineeringWriteTransactionOperationInputV2[] = [];
  for (const valueOperation of value["operations"] as unknown[]) {
    const operation = parseOperationInput(valueOperation, value["contentRootBindingId"] as string);
    if (operation === undefined) return undefined;
    operations.push(operation);
  }
  if (
    new Set(operations.map((operation) => operation.operationId)).size !== operations.length ||
    new Set(operations.map((operation) => operation.relativeIdentity)).size !== operations.length
  ) {
    return undefined;
  }
  return freeze({
    schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
    transactionId: value["transactionId"] as string,
    contentRootBindingId: value["contentRootBindingId"] as string,
    providerSemanticVersionSetChecksum: value["providerSemanticVersionSetChecksum"] as string,
    authorization: value["authorization"] as EngineeringV2AuthorizationBinding,
    operations: freeze(operations),
    preparedAt: value["preparedAt"] as string
  });
}

export function validateEngineeringLifecycleWriteTransactionInputV2(
  value: unknown,
  traceId = "engineering-lifecycle-write-transaction-v2"
): Result<EngineeringLifecycleWriteTransactionInputV2, UnifiedError> {
  if (
    !hasExactKeys(value, lifecycleTransactionInputKeys) ||
    value["schemaVersion"] !== ENGINEERING_MUTATION_V2_SCHEMA_VERSION ||
    !isStableId(value["transactionId"]) ||
    !isStableId(value["contentRootBindingId"]) ||
    !isSha256(value["providerSemanticVersionSetChecksum"]) ||
    !isAuthorization(value["authorization"]) ||
    !isCanonicalUtcTimestamp(value["preparedAt"]) ||
    !Array.isArray(value["operations"]) ||
    value["operations"].length === 0 ||
    value["operations"].length > 64
  )
    return invalid("ENGINEERING_LIFECYCLE_WRITE_TRANSACTION_V2_INPUT_INVALID", traceId);
  const operations: EngineeringLifecycleWriteOperationV2[] = [];
  const ids = new Set<string>();
  for (const candidate of value["operations"]) {
    if (!hasExactKeys(candidate, lifecycleOperationInputKeys))
      return invalid("ENGINEERING_LIFECYCLE_WRITE_TRANSACTION_V2_INPUT_INVALID", traceId);
    const request = validateEngineeringFileLifecycleRequestV2(candidate["request"]);
    if (
      !request.ok ||
      request.value.transactionId !== value["transactionId"] ||
      request.value.contentRootBindingId !== value["contentRootBindingId"] ||
      ids.has(request.value.operationId)
    )
      return invalid("ENGINEERING_LIFECYCLE_WRITE_TRANSACTION_V2_INPUT_INVALID", traceId);
    ids.add(request.value.operationId);
    const recovery = candidate["recoveryBinding"];
    if (request.value.operationKind === "delete_file") {
      if (
        !hasExactKeys(recovery, lifecycleRecoveryBindingKeys) ||
        recovery["recoveryRootBindingId"] !== request.value.recoveryRootBindingId ||
        recovery["grantRevision"] !== request.value.recoveryGrantRevision ||
        recovery["sideEffectChecksum"] !== request.value.recoverySideEffectChecksum ||
        !isStableId(recovery["recoveryRootBindingId"]) ||
        !isStableId(recovery["grantRevision"]) ||
        !isSha256(recovery["sideEffectChecksum"])
      )
        return invalid(
          "ENGINEERING_LIFECYCLE_WRITE_TRANSACTION_V2_RECOVERY_BINDING_INVALID",
          traceId
        );
      operations.push(
        freeze({
          request: request.value,
          recoveryBinding: recovery as unknown as Omit<
            EngineeringLifecycleRecoveryRootBindingV2,
            "recoveryRootId"
          >
        })
      );
    } else {
      if (recovery !== null)
        return invalid(
          "ENGINEERING_LIFECYCLE_WRITE_TRANSACTION_V2_RECOVERY_BINDING_INVALID",
          traceId
        );
      operations.push(freeze({ request: request.value, recoveryBinding: null }));
    }
  }
  return ok(
    freeze({
      schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
      transactionId: value["transactionId"] as string,
      contentRootBindingId: value["contentRootBindingId"] as string,
      providerSemanticVersionSetChecksum: value["providerSemanticVersionSetChecksum"] as string,
      authorization: value["authorization"] as EngineeringV2AuthorizationBinding,
      operations,
      preparedAt: value["preparedAt"] as string
    })
  );
}

function parseOperationInput(
  value: unknown,
  contentRootBindingId: string
): EngineeringWriteTransactionOperationInputV2 | undefined {
  if (!hasExactKeys(value, operationInputKeys)) return undefined;
  if (
    !isOperationKind(value["operationKind"]) ||
    !isStableOperationId(value["operationId"]) ||
    typeof value["relativeIdentity"] !== "string" ||
    !isStableId(value["stagingObjectId"])
  ) {
    return undefined;
  }
  const before = parseBeforeInput(
    value["before"],
    contentRootBindingId,
    value["relativeIdentity"] as string
  );
  const candidate = parseCandidateInput(
    value["candidate"],
    contentRootBindingId,
    value["relativeIdentity"] as string
  );
  if (before === undefined || candidate === undefined) return undefined;
  if (
    (value["operationKind"] === "replace_file" && before.kind !== "present") ||
    (value["operationKind"] === "create_file" && before.kind !== "absent")
  ) {
    return undefined;
  }
  return freeze({
    operationKind: value["operationKind"] as EngineeringFileMutationOperationKindV2,
    operationId: value["operationId"] as string,
    relativeIdentity: value["relativeIdentity"] as string,
    before,
    candidate,
    stagingObjectId: value["stagingObjectId"] as string
  });
}

function parseBeforeInput(
  value: unknown,
  contentRootBindingId: string,
  relativeIdentity: string
): EngineeringWriteTransactionBeforeInputV2 | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  if ((value as Record<string, unknown>)["kind"] === "present") {
    if (
      !hasExactKeys(value, beforePresentInputKeys) ||
      !((value as Record<string, unknown>)["bytes"] instanceof Uint8Array)
    ) {
      return undefined;
    }
    const manifest = validateEngineeringRawByteManifestV2(
      (value as Record<string, unknown>)["manifest"]
    );
    if (
      !manifest.ok ||
      manifest.value.identity.kind !== "observed_file" ||
      manifest.value.identity.rootBindingId !== contentRootBindingId ||
      manifest.value.identity.relativeIdentity !== relativeIdentity ||
      !bytesMatchManifest((value as Record<string, unknown>)["bytes"] as Uint8Array, manifest.value)
    ) {
      return undefined;
    }
    return freeze({
      kind: "present" as const,
      manifest: manifest.value,
      bytes: new Uint8Array((value as Record<string, unknown>)["bytes"] as Uint8Array)
    });
  }
  if ((value as Record<string, unknown>)["kind"] === "absent") {
    if (!hasExactKeys(value, beforeAbsentInputKeys)) return undefined;
    const proof = validateEngineeringAbsenceProofV2(
      (value as Record<string, unknown>)["absenceProof"]
    );
    return proof.ok &&
      proof.value.rootBindingId === contentRootBindingId &&
      proof.value.relativeIdentity === relativeIdentity
      ? freeze({ kind: "absent" as const, absenceProof: proof.value })
      : undefined;
  }
  return undefined;
}

function parseCandidateInput(
  value: unknown,
  contentRootBindingId: string,
  relativeIdentity: string
): EngineeringWriteTransactionCandidateInputV2 | undefined {
  if (
    !hasExactKeys(value, candidateInputKeys) ||
    !((value as Record<string, unknown>)["bytes"] instanceof Uint8Array)
  ) {
    return undefined;
  }
  const manifest = validateEngineeringRawByteManifestV2(
    (value as Record<string, unknown>)["manifest"]
  );
  if (
    !manifest.ok ||
    manifest.value.identity.kind !== "target" ||
    manifest.value.identity.rootBindingId !== contentRootBindingId ||
    manifest.value.identity.relativeIdentity !== relativeIdentity ||
    !bytesMatchManifest((value as Record<string, unknown>)["bytes"] as Uint8Array, manifest.value)
  ) {
    return undefined;
  }
  return freeze({
    manifest: manifest.value,
    bytes: new Uint8Array((value as Record<string, unknown>)["bytes"] as Uint8Array)
  });
}

function bytesMatchManifest(bytes: Uint8Array, manifest: EngineeringRawByteManifestV2): boolean {
  const inspected = inspectEngineeringRawBytesV2(bytes);
  return (
    inspected.ok &&
    inspected.value.sha256 === manifest.sha256 &&
    inspected.value.byteLength === manifest.byteLength &&
    inspected.value.encoding === manifest.encoding &&
    inspected.value.bom === manifest.bom &&
    inspected.value.eol === manifest.eol
  );
}

function afterManifestMatchesReceipts(
  observed: readonly EngineeringRawByteManifestV2[],
  receipts: readonly EngineeringMutationReceiptV2[]
): boolean {
  if (observed.length !== receipts.length) return false;
  return observed.every((manifest, index) => {
    const valid = validateEngineeringRawByteManifestV2(manifest);
    const receipt = receipts[index];
    return (
      valid.ok &&
      receipt !== undefined &&
      canonicalizeEngineeringMutationV2Json(valid.value) ===
        canonicalizeEngineeringMutationV2Json(receipt.observedAfter)
    );
  });
}

function bindLifecycleOperationState(
  value: unknown,
  request: EngineeringFileLifecycleRequestV2 | undefined
): Result<EngineeringFileLifecycleOperationStateV2, UnifiedError> {
  if (
    request === undefined ||
    !hasExactKeys(value, lifecycleOperationStateKeys) ||
    value["schemaVersion"] !== "3.0" ||
    value["kind"] !== "engineering_file_lifecycle_operation_state" ||
    (value["state"] !== "before" &&
      value["state"] !== "after" &&
      value["state"] !== "intermediate" &&
      value["state"] !== "neither" &&
      value["state"] !== "unknown") ||
    value["requestChecksum"] !== engineeringFileLifecycleRequestChecksumV2(request)
  ) {
    return invalid("ENGINEERING_LIFECYCLE_WRITE_TRANSACTION_V2_STATE_INVALID");
  }
  if (value["state"] === "after") {
    const receipt = verifyEngineeringFileLifecycleReceiptBindingV2(value["receipt"], request);
    return receipt.ok
      ? ok(
          freeze({
            schemaVersion: "3.0" as const,
            kind: "engineering_file_lifecycle_operation_state" as const,
            state: "after" as const,
            requestChecksum: value["requestChecksum"] as string,
            receipt: receipt.value
          })
        )
      : receipt;
  }
  if (value["receipt"] !== null)
    return invalid("ENGINEERING_LIFECYCLE_WRITE_TRANSACTION_V2_STATE_INVALID");
  return ok(
    freeze({
      schemaVersion: "3.0" as const,
      kind: "engineering_file_lifecycle_operation_state" as const,
      state: value["state"] as "before" | "intermediate" | "neither" | "unknown",
      requestChecksum: value["requestChecksum"] as string,
      receipt: null
    })
  );
}

function leaseInput(
  prepared: EngineeringWriteTransactionPreparedV2
): Readonly<{ contentRootBindingId: string; transactionId: string; preparedChecksum: string }> {
  return freeze({
    contentRootBindingId: prepared.contentRootBindingId,
    transactionId: prepared.transactionId,
    preparedChecksum: prepared.preparedChecksum
  });
}

async function releaseLease(lease: EngineeringRecoveryMutationLeaseV2): Promise<void> {
  try {
    await lease.release();
  } catch {
    // Lease release is in-process bookkeeping. A failed release leaves the root closed rather
    // than permitting a second mutation, which is the safe failure mode.
  }
}

function sameCanonicalJson(left: unknown, right: unknown): boolean {
  return (
    canonicalizeEngineeringMutationV2Json(left) === canonicalizeEngineeringMutationV2Json(right)
  );
}

function parseLocator(
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

function isOperationKind(value: unknown): value is EngineeringFileMutationOperationKindV2 {
  return value === "replace_file" || value === "create_file";
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

function freeze<T>(value: T): T {
  if (ArrayBuffer.isView(value)) return value;
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function invalid<T = never>(
  code: string,
  traceId = "engineering-write-transaction-v2"
): Result<T, UnifiedError> {
  return err(
    validationError({
      code,
      message: "Engineering V2 write transaction input is invalid.",
      suggestedAction: "Regenerate the approved Main-owned transaction.",
      traceId
    })
  );
}

function missing<T = never>(traceId = "engineering-write-transaction-v2"): Result<T, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_WRITE_TRANSACTION_V2_MISSING",
      message: "The prepared Engineering V2 transaction is missing.",
      suggestedAction: "Enter recovery review; do not retry an unaccounted mutation.",
      traceId
    })
  );
}

function reconciliationRequired<T = never>(
  state: "neither" | "unknown",
  traceId: string
): Result<T, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_WRITE_TRANSACTION_V2_RECONCILIATION_REQUIRED",
      message:
        "The content-root target is neither the prepared before state nor a verified after state.",
      suggestedAction: "Enter recovery review; do not issue another native write.",
      traceId,
      redactedDetail: { state }
    })
  );
}

function authorizationUnavailable<T = never>(traceId: string): Result<T, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_WRITE_TRANSACTION_V2_AUTHORIZATION_UNAVAILABLE",
      message: "The full Engineering V2 authorization could not be revalidated.",
      suggestedAction: "Keep the prepared transaction in recovery until Main can revalidate it.",
      traceId
    })
  );
}

function stagingReservationUnavailable<T = never>(traceId: string): Result<T, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_WRITE_TRANSACTION_V2_STAGING_RESERVATION_UNQUALIFIED",
      message: "The qualified Engineering V2 staging reservation is unavailable.",
      suggestedAction:
        "Do not create or apply a transaction without a Main-owned staging reservation.",
      traceId
    })
  );
}

function blobReferenceMismatch<T = never>(traceId: string): Result<T, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_WRITE_TRANSACTION_V2_BLOB_REFERENCE_MISMATCH",
      message: "The blob store returned a reference different from the authorized prepared record.",
      suggestedAction: "Enter recovery review; do not write through an unverified blob store.",
      traceId
    })
  );
}

function lifecycleUnavailable<T = never>(traceId: string): Result<T, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_LIFECYCLE_WRITE_TRANSACTION_V2_UNAVAILABLE",
      message: "The qualified Engineering lifecycle mutation backend is unavailable.",
      suggestedAction:
        "Keep the corresponding operation disabled until its native backend is qualified.",
      traceId
    })
  );
}

function lifecycleQuarantineRecordInvalid<T = never>(traceId: string): Result<T, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_LIFECYCLE_WRITE_TRANSACTION_V2_QUARANTINE_RECORD_INVALID",
      message: "The quarantined object does not match the exact durable delete operation.",
      suggestedAction: "Keep recovery blocked and inspect the volume-local quarantine root.",
      traceId
    })
  );
}

function createLifecycleWal(
  prepared: EngineeringLifecycleWriteTransactionInputV2,
  receipts: readonly EngineeringFileLifecycleReceiptV2[],
  committedAt: string | null,
  rolledBackAt: string | null,
  synchronizedAt: string | null
): EngineeringLifecycleWriteAheadLogV2 {
  const preparedChecksum = sha256EngineeringMutationTextV2(
    canonicalizeEngineeringMutationV2Json(prepared)
  );
  const unsigned = {
    schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
    kind: "engineering_lifecycle_write_ahead_log" as const,
    prepared,
    preparedChecksum,
    receipts,
    committedAt,
    rolledBackAt,
    synchronizedAt
  };
  return freeze({
    ...unsigned,
    journalChecksum: sha256EngineeringMutationTextV2(
      canonicalizeEngineeringMutationV2Json(unsigned)
    )
  });
}

function validateLifecycleWal(
  value: unknown,
  traceId: string
): Result<EngineeringLifecycleWriteAheadLogV2 | undefined, UnifiedError> {
  if (!isRecord(value) || !hasExactKeys(value, lifecycleWalKeys))
    return invalid("ENGINEERING_LIFECYCLE_WAL_V2_RECORD_INVALID", traceId);
  const prepared = validateEngineeringLifecycleWriteTransactionInputV2(value["prepared"], traceId);
  if (
    !prepared.ok ||
    !isSha256(value["preparedChecksum"]) ||
    !Array.isArray(value["receipts"]) ||
    (value["committedAt"] !== null && !isCanonicalUtcTimestamp(value["committedAt"])) ||
    (value["rolledBackAt"] !== null && !isCanonicalUtcTimestamp(value["rolledBackAt"])) ||
    (value["synchronizedAt"] !== null && !isCanonicalUtcTimestamp(value["synchronizedAt"])) ||
    !isSha256(value["journalChecksum"])
  )
    return invalid("ENGINEERING_LIFECYCLE_WAL_V2_RECORD_INVALID", traceId);
  const expectedPreparedChecksum = sha256EngineeringMutationTextV2(
    canonicalizeEngineeringMutationV2Json(prepared.value)
  );
  if (value["preparedChecksum"] !== expectedPreparedChecksum)
    return invalid("ENGINEERING_LIFECYCLE_WAL_V2_AUTHENTICATION_FAILED", traceId);
  const receipts: EngineeringFileLifecycleReceiptV2[] = [];
  for (let i = 0; i < (value["receipts"] as unknown[]).length; i += 1) {
    const request = prepared.value.operations[i]?.request;
    const receipt =
      request === undefined
        ? undefined
        : verifyEngineeringFileLifecycleReceiptBindingV2(
            (value["receipts"] as unknown[])[i],
            request
          );
    if (receipt === undefined || !receipt.ok)
      return invalid("ENGINEERING_LIFECYCLE_WAL_V2_RECORD_INVALID", traceId);
    receipts.push(receipt.value);
  }
  const unsigned = {
    schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
    kind: "engineering_lifecycle_write_ahead_log" as const,
    prepared: prepared.value,
    preparedChecksum: expectedPreparedChecksum,
    receipts,
    committedAt: value["committedAt"] as string | null,
    rolledBackAt: value["rolledBackAt"] as string | null,
    synchronizedAt: value["synchronizedAt"] as string | null
  };
  if (
    value["journalChecksum"] !==
    sha256EngineeringMutationTextV2(canonicalizeEngineeringMutationV2Json(unsigned))
  )
    return invalid("ENGINEERING_LIFECYCLE_WAL_V2_AUTHENTICATION_FAILED", traceId);
  if (
    (value["committedAt"] !== null && value["rolledBackAt"] !== null) ||
    (value["committedAt"] !== null && receipts.length !== prepared.value.operations.length) ||
    (value["synchronizedAt"] !== null &&
      value["committedAt"] === null &&
      value["rolledBackAt"] === null) ||
    (value["synchronizedAt"] !== null &&
      Date.parse(value["synchronizedAt"] as string) <
        Date.parse((value["committedAt"] ?? value["rolledBackAt"]) as string))
  )
    return invalid("ENGINEERING_LIFECYCLE_WAL_V2_COMMIT_INCOMPLETE", traceId);
  return ok(freeze({ ...unsigned, journalChecksum: value["journalChecksum"] as string }));
}

function diskKey(namespace: string, value: string): string {
  return `${namespace}-${sha256EngineeringMutationTextV2(value)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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

function storageFailure<T = never>(code: string, traceId: string): Result<T, UnifiedError> {
  return err(
    storageError({
      code,
      message: "Engineering lifecycle WAL storage is unavailable.",
      suggestedAction: "Keep lifecycle mutation disabled and enter recovery review.",
      traceId
    })
  );
}

function durabilityUnavailable<T = never>(traceId: string): Result<T, UnifiedError> {
  return storageFailure("ENGINEERING_LIFECYCLE_WAL_V2_DURABILITY_UNAVAILABLE", traceId);
}

function conflict<T = never>(traceId: string): Result<T, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_LIFECYCLE_WAL_V2_CONFLICT",
      message: "The lifecycle transaction already exists with different contents.",
      suggestedAction: "Regenerate the lifecycle proposal.",
      traceId
    })
  );
}

function lifecycleRecoveryRequired<T = never>(traceId: string): Result<T, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_LIFECYCLE_WRITE_TRANSACTION_V2_RECOVERY_REQUIRED",
      message: "An incomplete Engineering lifecycle transaction requires Main-owned recovery.",
      suggestedAction:
        "Keep the content root closed until recovery has classified the native operation; do not retry it.",
      traceId
    })
  );
}

function lifecycleRecoveryReviewRequired<T = never>(traceId: string): Result<T, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_LIFECYCLE_WRITE_TRANSACTION_V2_RECOVERY_REVIEW_REQUIRED",
      message: "The lifecycle operation is neither a deterministic before-state nor after-state.",
      suggestedAction: "Keep the content root closed and require Main-owned recovery review.",
      traceId
    })
  );
}

const transactionInputKeys = [
  "authorization",
  "contentRootBindingId",
  "operations",
  "preparedAt",
  "providerSemanticVersionSetChecksum",
  "schemaVersion",
  "transactionId"
] as const;
const operationInputKeys = [
  "before",
  "candidate",
  "operationId",
  "operationKind",
  "relativeIdentity",
  "stagingObjectId"
] as const;
const beforePresentInputKeys = ["bytes", "kind", "manifest"] as const;
const beforeAbsentInputKeys = ["absenceProof", "kind"] as const;
const candidateInputKeys = ["bytes", "manifest"] as const;
const locatorKeys = ["contentRootBindingId", "transactionId"] as const;
const lifecycleOperationStateKeys = [
  "kind",
  "receipt",
  "requestChecksum",
  "schemaVersion",
  "state"
] as const;
const authorizationKeys = [
  "approvalBindingChecksum",
  "approvalBindingId",
  "authorizationId",
  "changeSetChecksum",
  "changeSetId",
  "changeSetRevision",
  "sideEffectSubjectChecksum"
] as const;
const lifecycleTransactionInputKeys = [
  "authorization",
  "contentRootBindingId",
  "operations",
  "preparedAt",
  "providerSemanticVersionSetChecksum",
  "schemaVersion",
  "transactionId"
] as const;
const lifecycleOperationInputKeys = ["recoveryBinding", "request"] as const;
const lifecycleRecoveryBindingKeys = [
  "grantRevision",
  "recoveryRootBindingId",
  "sideEffectChecksum"
] as const;
const lifecycleWalKeys = [
  "committedAt",
  "journalChecksum",
  "kind",
  "prepared",
  "preparedChecksum",
  "receipts",
  "rolledBackAt",
  "schemaVersion",
  "synchronizedAt"
] as const;
