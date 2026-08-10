import { err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import {
  ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
  canonicalizeEngineeringMutationV2Json,
  inspectEngineeringRawBytesV2,
  validateEngineeringAbsenceProofV2,
  validateEngineeringFileLifecycleRequestV2,
  validateEngineeringFileMutationRequestV2,
  validateEngineeringRawByteManifestV2,
  type EngineeringAbsenceProofV2,
  type EngineeringFileMutationApplyInputV2,
  type EngineeringFileMutationPortV2,
  type EngineeringFileLifecycleReceiptV2,
  type EngineeringFileLifecycleRequestV2,
  type EngineeringLifecycleRecoveryRootBindingV2,
  type EngineeringFileMutationOperationKindV2,
  type EngineeringFileMutationRequestV2,
  type EngineeringRawByteManifestV2
} from "./engineering-file-mutation-port-v2.js";
import {
  createEngineeringMutationBlobReferenceV2,
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

export interface EngineeringLifecycleWriteAheadLogV2 {
  readonly schemaVersion: typeof ENGINEERING_MUTATION_V2_SCHEMA_VERSION;
  readonly kind: "engineering_lifecycle_write_ahead_log";
  readonly prepared: EngineeringLifecycleWriteTransactionInputV2;
  readonly preparedChecksum: string;
  readonly receipts: readonly EngineeringFileLifecycleReceiptV2[];
  readonly committedAt: string | null;
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
}

export interface EngineeringLifecycleWriteTransactionV2Options {
  readonly walRepository: EngineeringLifecycleWalRepositoryV2;
  readonly mutationPort: EngineeringFileMutationPortV2;
  readonly recoveryGate: EngineeringMutationRecoveryGatePortV2;
  readonly validateReservedAuthorization: (
    prepared: EngineeringLifecycleWriteTransactionInputV2
  ) => Promise<Result<void, UnifiedError>>;
  readonly resolveRecoveryBinding?: (
    operation: EngineeringLifecycleWriteOperationV2
  ) => Promise<Result<EngineeringLifecycleRecoveryRootBindingV2, UnifiedError>>;
  readonly now?: () => string;
  readonly traceId?: string;
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
      if (journal.committedAt !== null) return ok(journal);
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
            if (this.options.resolveRecoveryBinding === undefined)
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
        }
        return this.options.walRepository.commit({
          contentRootBindingId: prepared.value.contentRootBindingId,
          transactionId: prepared.value.transactionId,
          committedAt: this.now()
        });
      } finally {
        await releaseLease(lease.value);
      }
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
