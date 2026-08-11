import { err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import {
  ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
  canonicalizeEngineeringMutationV2Json,
  sha256EngineeringMutationTextV2
} from "./engineering-file-mutation-port-v2.js";
import { type EngineeringMutationBlobStoreV2 } from "./engineering-mutation-blob-store.js";
import {
  engineeringWalReferencedBlobIdsV2,
  type EngineeringWalRepositoryV2,
  type EngineeringWriteAheadLogV2,
  type EngineeringWriteTransactionPreparedV2
} from "./engineering-wal-repository.js";
import { storageError, validationError } from "./errors.js";

export type EngineeringRecoveryGateReasonV2 =
  | "root_unavailable"
  | "prepared_transaction"
  | "unknown_record"
  | "authentication_failed"
  | "orphaned_object"
  | "legacy_recovery_pending";

export type EngineeringRecoveryRootGateReasonV2 =
  | "binding_invalid"
  | "binding_revoked"
  | "orphaned_global_record"
  | "orphaned_manifest"
  | "orphaned_physical_object"
  | "manifest_mismatch"
  | "unknown_record"
  | "authentication_failed"
  | "capacity_exceeded";

export interface EngineeringRecoveryGateSnapshotV2 {
  readonly schemaVersion: typeof ENGINEERING_MUTATION_V2_SCHEMA_VERSION;
  readonly contentRootBindingId: string;
  readonly status: "clear" | "blocked";
  readonly reasons: readonly EngineeringRecoveryGateReasonV2[];
  readonly capabilityRevision: string;
  readonly scannedAt: string;
}

export interface EngineeringRecoveryStagingScanV2 {
  /** Exact partition of the caller's referenced staging ids. */
  readonly verifiedObjectIds: readonly string[];
  readonly missingObjectIds: readonly string[];
  readonly orphanObjectIds: readonly string[];
  readonly unknownObjectCount: number;
  readonly authenticationFailureCount: number;
}

export interface EngineeringRecoveryReservationScanV2 {
  /** Exact partition of the caller's referenced reservation/authorization ids. */
  readonly verifiedAuthorizationIds: readonly string[];
  readonly missingAuthorizationIds: readonly string[];
  readonly orphanAuthorizationIds: readonly string[];
  readonly unknownRecordCount: number;
  readonly authenticationFailureCount: number;
}

export interface EngineeringLegacyRecoveryScanV2 {
  readonly status: "clean" | "pending" | "unknown";
}

export interface EngineeringRecoveryMutationLeaseInputV2 {
  readonly contentRootBindingId: string;
  readonly transactionId: string;
  readonly preparedChecksum: string;
}

/** A lease authorizes only one already-durable, uncommitted prepared record. */
export interface EngineeringRecoveryMutationLeaseV2 extends EngineeringRecoveryMutationLeaseInputV2 {
  readonly kind: "ordinary" | "recovery";
  assertCurrent(): Promise<Result<void, UnifiedError>>;
  release(): Promise<void> | void;
}

export interface EngineeringRecoveryGateV2Options {
  readonly walRepository: EngineeringWalRepositoryV2;
  readonly blobStore: EngineeringMutationBlobStoreV2;
  /** Main/root-handle availability check; failure must not be treated as a clean scan. */
  readonly verifyContentRootAvailable: (
    contentRootBindingId: string
  ) => Promise<Result<void, UnifiedError>>;
  /** Validates that a durable prepared WAL still corresponds to its reserved shared authorization. */
  readonly verifyPreparedAuthorization: (
    prepared: EngineeringWriteTransactionPreparedV2,
    expectedState: "reserved" | "consumed"
  ) => Promise<Result<void, UnifiedError>>;
  /** V2 cannot adopt legacy data; the legacy reader reports whether it still needs recovery. */
  readonly scanLegacyRecovery: (
    contentRootBindingId: string
  ) => Promise<Result<EngineeringLegacyRecoveryScanV2, UnifiedError>>;
  /** Enumerates preallocated staging objects under the app-owned native state namespace. */
  readonly scanStaging: (input: {
    readonly contentRootBindingId: string;
    readonly referencedStagingObjectIds: readonly string[];
  }) => Promise<Result<EngineeringRecoveryStagingScanV2, UnifiedError>>;
  /** Enumerates shared-ledger reservations so a reserve-without-WAL crash cannot be ignored. */
  readonly scanReservations: (input: {
    readonly contentRootBindingId: string;
    readonly referencedAuthorizationIds: readonly string[];
  }) => Promise<Result<EngineeringRecoveryReservationScanV2, UnifiedError>>;
  /** Optional B8 lifecycle WAL scan. Any incomplete/unknown lifecycle record blocks the root. */
  readonly scanLifecycleRecovery?: (contentRootBindingId: string) => Promise<
    Result<
      {
        readonly status: "clear" | "blocked";
        readonly unknownRecordCount?: number;
        readonly authenticationFailureCount?: number;
      },
      UnifiedError
    >
  >;
  /** Allows the lifecycle coordinator to lease the one WAL it just prepared. */
  readonly verifyLifecycleLease?: (
    input: EngineeringRecoveryMutationLeaseInputV2
  ) => Promise<Result<boolean, UnifiedError>>;
  /** Main-owned volume-local recovery scan. Missing means the delete/recovery capability is unavailable. */
  readonly scanVolumeLocalRecovery?: (contentRootBindingId: string) => Promise<
    Result<
      {
        readonly status: "clear" | "blocked";
        readonly reasons: readonly EngineeringRecoveryRootGateReasonV2[];
      },
      UnifiedError
    >
  >;
  readonly now?: () => string;
  readonly traceId?: string;
}

/**
 * Root-scoped startup gate.  It only derives availability from scans; there is deliberately no
 * renderer/model-facing `clear` operation or recovery implementation in this B7 module.
 */
export class EngineeringRecoveryGateV2 {
  private readonly snapshots = new Map<string, EngineeringRecoveryGateSnapshotV2>();
  private readonly leases = new Map<
    string,
    Readonly<{
      readonly token: object;
      readonly input: EngineeringRecoveryMutationLeaseInputV2;
      readonly kind: EngineeringRecoveryMutationLeaseV2["kind"];
      readonly journalKind: "ordinary" | "lifecycle";
    }>
  >();
  private readonly now: () => string;
  private readonly traceId: string;

  public constructor(private readonly options: EngineeringRecoveryGateV2Options) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.traceId = options.traceId ?? "engineering-recovery-gate-v2";
  }

  public async scanRoot(
    input: unknown
  ): Promise<Result<EngineeringRecoveryGateSnapshotV2, UnifiedError>> {
    const contentRootBindingId = parseRoot(input);
    if (contentRootBindingId === undefined)
      return invalid("ENGINEERING_RECOVERY_GATE_ROOT_INVALID", this.traceId);
    const evaluated = await this.evaluateRoot(contentRootBindingId);
    return evaluated.ok ? ok(evaluated.value.snapshot) : evaluated;
  }

  /**
   * Ordinary callers never receive a cached answer: a journal that appeared after a prior scan
   * closes the gate immediately.  A lease is the only exception used by the owning coordinator.
   */
  public async assertMutationAllowed(
    contentRootBindingId: string
  ): Promise<Result<void, UnifiedError>> {
    if (!isStableId(contentRootBindingId))
      return invalid("ENGINEERING_RECOVERY_GATE_ROOT_INVALID", this.traceId);
    const scanned = await this.scanRoot({ contentRootBindingId });
    if (!scanned.ok) return scanned;
    if (scanned.value.status !== "clear") return mutationBlocked(scanned.value, this.traceId);
    return ok(undefined);
  }

  /** Used only by the coordinator that just made the prepared record durable. */
  public async acquireMutationLease(
    input: unknown
  ): Promise<Result<EngineeringRecoveryMutationLeaseV2, UnifiedError>> {
    return this.acquireLease(input, "ordinary");
  }

  /**
   * Recovery has a distinct lease, bound to root + transaction + immutable prepared checksum.
   * It does not re-open the ordinary gate and cannot adopt a different prepared record.
   */
  public async acquireRecoveryLease(
    input: unknown
  ): Promise<Result<EngineeringRecoveryMutationLeaseV2, UnifiedError>> {
    return this.acquireLease(input, "recovery");
  }

  public snapshot(contentRootBindingId: string): EngineeringRecoveryGateSnapshotV2 | undefined {
    return this.snapshots.get(contentRootBindingId);
  }

  private async acquireLease(
    input: unknown,
    kind: EngineeringRecoveryMutationLeaseV2["kind"]
  ): Promise<Result<EngineeringRecoveryMutationLeaseV2, UnifiedError>> {
    const parsed = parseLeaseInput(input);
    if (parsed === undefined)
      return invalid("ENGINEERING_RECOVERY_GATE_LEASE_INPUT_INVALID", this.traceId);
    if (this.leases.has(parsed.contentRootBindingId)) return leaseUnavailable(this.traceId);
    const evaluated = await this.evaluateRoot(parsed.contentRootBindingId);
    if (!evaluated.ok) return evaluated;
    // A concurrent acquirer may have completed its scan while this lease was scanning.
    if (this.leases.has(parsed.contentRootBindingId)) return leaseUnavailable(this.traceId);
    const ordinaryJournal = isExactUncommittedPrepared(evaluated.value, parsed);
    if (!ordinaryJournal) {
      if (
        this.options.verifyLifecycleLease === undefined ||
        evaluated.value.journals.some((journal) => journal.commit === null)
      )
        return leaseRejected(this.traceId);
      const verifyLifecycleLease = this.options.verifyLifecycleLease;
      if (verifyLifecycleLease === undefined) return leaseRejected(this.traceId);
      const lifecycle = await safely(() => verifyLifecycleLease(parsed));
      if (!lifecycle.ok || lifecycle.value !== true) return leaseRejected(this.traceId);
    }
    const token = Object.freeze({});
    const active = freeze({
      token,
      input: parsed,
      kind,
      journalKind: ordinaryJournal ? ("ordinary" as const) : ("lifecycle" as const)
    });
    this.leases.set(parsed.contentRootBindingId, active);
    return ok(
      freeze({
        ...parsed,
        kind,
        assertCurrent: async () => this.assertLeaseCurrent(active),
        release: () => {
          if (this.leases.get(parsed.contentRootBindingId) === active) {
            this.leases.delete(parsed.contentRootBindingId);
          }
        }
      })
    );
  }

  private async assertLeaseCurrent(
    active: Readonly<{
      readonly token: object;
      readonly input: EngineeringRecoveryMutationLeaseInputV2;
      readonly kind: EngineeringRecoveryMutationLeaseV2["kind"];
      readonly journalKind: "ordinary" | "lifecycle";
    }>
  ): Promise<Result<void, UnifiedError>> {
    if (this.leases.get(active.input.contentRootBindingId) !== active) {
      return leaseRejected(this.traceId);
    }
    const evaluated = await this.evaluateRoot(active.input.contentRootBindingId);
    if (!evaluated.ok) return evaluated;
    if (active.journalKind === "ordinary") {
      return isExactUncommittedPrepared(evaluated.value, active.input)
        ? ok(undefined)
        : leaseRejected(this.traceId);
    }
    if (
      this.options.verifyLifecycleLease === undefined ||
      evaluated.value.journals.some((journal) => journal.commit === null)
    ) {
      return leaseRejected(this.traceId);
    }
    const verifyLifecycleLease = this.options.verifyLifecycleLease;
    const lifecycle = await safely(() => verifyLifecycleLease(active.input));
    return lifecycle.ok && lifecycle.value === true ? ok(undefined) : leaseRejected(this.traceId);
  }

  private async evaluateRoot(contentRootBindingId: string): Promise<
    Result<
      Readonly<{
        readonly snapshot: EngineeringRecoveryGateSnapshotV2;
        readonly journals: readonly EngineeringWriteAheadLogV2[];
      }>,
      UnifiedError
    >
  > {
    const reasons = new Set<EngineeringRecoveryGateReasonV2>();

    const available = await safely(() =>
      this.options.verifyContentRootAvailable(contentRootBindingId)
    );
    if (!available.ok) reasons.add("root_unavailable");

    const walScan = await safely(() => this.options.walRepository.scanRoot(contentRootBindingId));
    const journals = walScan.ok ? walScan.value.journals : [];
    if (!walScan.ok) {
      reasons.add("unknown_record");
    } else {
      if (walScan.value.unknownRecordCount > 0) reasons.add("unknown_record");
      if (walScan.value.authenticationFailureCount > 0) reasons.add("authentication_failed");
      if (journals.some((journal) => journal.commit === null)) reasons.add("prepared_transaction");
    }

    if (walScan.ok) {
      for (const journal of journals) {
        const authorized = await safely(() =>
          this.options.verifyPreparedAuthorization(
            journal.prepared,
            journal.commit === null ? "reserved" : "consumed"
          )
        );
        if (!authorized.ok) reasons.add("authentication_failed");
      }
      const blobScan = await safely(() =>
        this.options.blobStore.scanRoot({
          contentRootBindingId,
          referencedBlobIds: engineeringWalReferencedBlobIdsV2(journals)
        })
      );
      if (!blobScan.ok) {
        reasons.add("unknown_record");
      } else {
        if (blobScan.value.unknownObjectCount > 0) reasons.add("unknown_record");
        if (blobScan.value.authenticationFailureCount > 0) reasons.add("authentication_failed");
        if (blobScan.value.orphanBlobIds.length > 0) reasons.add("orphaned_object");
        const storedBlobIds = new Set(
          blobScan.value.references.map((reference) => reference.blobId)
        );
        if (
          engineeringWalReferencedBlobIdsV2(journals).some((blobId) => !storedBlobIds.has(blobId))
        ) {
          reasons.add("authentication_failed");
        }
      }

      const referencedStagingIds = referencedStagingObjectIds(journals);
      const staging = await safely(() =>
        this.options.scanStaging({
          contentRootBindingId,
          referencedStagingObjectIds: referencedStagingIds
        })
      );
      if (
        !staging.ok ||
        !isStagingScan(staging.ok ? staging.value : undefined, referencedStagingIds)
      ) {
        reasons.add("unknown_record");
      } else {
        if (staging.value.unknownObjectCount > 0) reasons.add("unknown_record");
        if (staging.value.authenticationFailureCount > 0) reasons.add("authentication_failed");
        if (staging.value.orphanObjectIds.length > 0) reasons.add("orphaned_object");
        if (staging.value.missingObjectIds.length > 0) reasons.add("authentication_failed");
      }
    }

    const referencedAuthorizationIds = referencedReservationAuthorizationIds(journals);
    const reservations = await safely(() =>
      this.options.scanReservations({ contentRootBindingId, referencedAuthorizationIds })
    );
    if (
      !reservations.ok ||
      !isReservationScan(
        reservations.ok ? reservations.value : undefined,
        referencedAuthorizationIds
      )
    ) {
      reasons.add("unknown_record");
    } else {
      if (reservations.value.unknownRecordCount > 0) reasons.add("unknown_record");
      if (reservations.value.authenticationFailureCount > 0) reasons.add("authentication_failed");
      if (reservations.value.orphanAuthorizationIds.length > 0) reasons.add("orphaned_object");
      if (reservations.value.missingAuthorizationIds.length > 0) {
        reasons.add("authentication_failed");
      }
    }

    const legacy = await safely(() => this.options.scanLegacyRecovery(contentRootBindingId));
    if (!legacy.ok || !isLegacyScan(legacy.ok ? legacy.value : undefined)) {
      reasons.add("unknown_record");
    } else if (legacy.value.status === "pending") {
      reasons.add("legacy_recovery_pending");
    } else if (legacy.value.status === "unknown") {
      reasons.add("unknown_record");
    }

    if (this.options.scanVolumeLocalRecovery !== undefined) {
      const scanVolumeLocalRecovery = this.options.scanVolumeLocalRecovery;
      const recovery = await safely(() => scanVolumeLocalRecovery(contentRootBindingId));
      if (!recovery.ok || !isVolumeLocalRecoveryScan(recovery.value)) {
        reasons.add("unknown_record");
      } else if (recovery.value.status !== "clear" || recovery.value.reasons.length > 0) {
        // The B7 gate has a deliberately small public reason set. Any volume-local failure is
        // represented as a root-bound unknown/auth failure and therefore keeps all mutation closed.
        reasons.add(
          recovery.value.reasons.includes("binding_revoked") ||
            recovery.value.reasons.includes("authentication_failed")
            ? "authentication_failed"
            : "orphaned_object"
        );
      }
    }

    if (this.options.scanLifecycleRecovery !== undefined) {
      const scanLifecycleRecovery = this.options.scanLifecycleRecovery;
      const lifecycle = await safely(() => scanLifecycleRecovery(contentRootBindingId));
      if (
        !lifecycle.ok ||
        !isLifecycleRecoveryScan(lifecycle.value) ||
        lifecycle.value.status !== "clear" ||
        (lifecycle.value.unknownRecordCount ?? 0) > 0 ||
        (lifecycle.value.authenticationFailureCount ?? 0) > 0
      ) {
        reasons.add("prepared_transaction");
      }
    }

    const snapshot = createSnapshot(contentRootBindingId, [...reasons], this.now());
    this.snapshots.set(contentRootBindingId, snapshot);
    return ok(freeze({ snapshot, journals }));
  }
}

export function createEngineeringRecoveryGateSnapshotV2(input: {
  readonly contentRootBindingId: string;
  readonly reasons: readonly EngineeringRecoveryGateReasonV2[];
  readonly scannedAt: string;
}): EngineeringRecoveryGateSnapshotV2 {
  return createSnapshot(input.contentRootBindingId, input.reasons, input.scannedAt);
}

function createSnapshot(
  contentRootBindingId: string,
  rawReasons: readonly EngineeringRecoveryGateReasonV2[],
  scannedAt: string
): EngineeringRecoveryGateSnapshotV2 {
  if (!isStableId(contentRootBindingId) || !isCanonicalUtcTimestamp(scannedAt)) {
    throw new Error("ENGINEERING_RECOVERY_GATE_SNAPSHOT_INVALID");
  }
  const reasons = [...new Set(rawReasons)].sort() as EngineeringRecoveryGateReasonV2[];
  if (!reasons.every(isReason)) throw new Error("ENGINEERING_RECOVERY_GATE_SNAPSHOT_INVALID");
  const unsigned = {
    schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
    contentRootBindingId,
    status: (reasons.length === 0 ? "clear" : "blocked") as "clear" | "blocked",
    reasons,
    scannedAt
  };
  return freeze({
    ...unsigned,
    capabilityRevision: sha256EngineeringMutationTextV2(
      canonicalizeEngineeringMutationV2Json(unsigned)
    )
  });
}

function referencedStagingObjectIds(
  journals: readonly { readonly prepared: EngineeringWriteTransactionPreparedV2 }[]
): readonly string[] {
  return freeze(
    [
      ...new Set(
        journals.flatMap((journal) =>
          journal.prepared.operations.map((operation) => operation.stagingObjectId)
        )
      )
    ].sort()
  );
}

function referencedReservationAuthorizationIds(
  journals: readonly { readonly prepared: EngineeringWriteTransactionPreparedV2 }[]
): readonly string[] {
  return freeze(
    [...new Set(journals.map((journal) => journal.prepared.authorization.authorizationId))].sort()
  );
}

async function safely<T>(
  action: () => Promise<Result<T, UnifiedError>>
): Promise<Result<T, UnifiedError>> {
  try {
    return await action();
  } catch {
    return err(
      storageError({
        code: "ENGINEERING_RECOVERY_GATE_SCAN_FAILED",
        message: "Engineering recovery scanning did not complete.",
        suggestedAction: "Keep mutations disabled and inspect app-owned recovery state.",
        traceId: "engineering-recovery-gate-v2"
      })
    );
  }
}

function parseRoot(value: unknown): string | undefined {
  return hasExactKeys(value, rootInputKeys) && isStableId(value["contentRootBindingId"])
    ? (value["contentRootBindingId"] as string)
    : undefined;
}

function parseLeaseInput(value: unknown): EngineeringRecoveryMutationLeaseInputV2 | undefined {
  return hasExactKeys(value, leaseInputKeys) &&
    isStableId(value["contentRootBindingId"]) &&
    isStableId(value["transactionId"]) &&
    isSha256(value["preparedChecksum"])
    ? freeze({
        contentRootBindingId: value["contentRootBindingId"] as string,
        transactionId: value["transactionId"] as string,
        preparedChecksum: value["preparedChecksum"] as string
      })
    : undefined;
}

function isExactUncommittedPrepared(
  evaluated: Readonly<{
    readonly snapshot: EngineeringRecoveryGateSnapshotV2;
    readonly journals: readonly EngineeringWriteAheadLogV2[];
  }>,
  input: EngineeringRecoveryMutationLeaseInputV2
): boolean {
  // The otherwise-blocking prepared record is permitted only when it is the sole incomplete
  // record and its immutable checksum exactly matches the lease request.
  if (evaluated.snapshot.reasons.some((reason) => reason !== "prepared_transaction")) return false;
  const incomplete = evaluated.journals.filter((journal) => journal.commit === null);
  return (
    incomplete.length === 1 &&
    incomplete[0]?.prepared.contentRootBindingId === input.contentRootBindingId &&
    incomplete[0]?.prepared.transactionId === input.transactionId &&
    incomplete[0]?.prepared.preparedChecksum === input.preparedChecksum
  );
}

function isStagingScan(
  value: unknown,
  referencedObjectIds: readonly string[]
): value is EngineeringRecoveryStagingScanV2 {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    hasExactKeys(value, stagingScanKeys) &&
    hasExactReferencePartition(
      referencedObjectIds,
      value["verifiedObjectIds"],
      value["missingObjectIds"]
    ) &&
    Array.isArray(value["orphanObjectIds"]) &&
    value["orphanObjectIds"].every(isStableId) &&
    new Set(value["orphanObjectIds"]).size === value["orphanObjectIds"].length &&
    isCount(value["unknownObjectCount"]) &&
    isCount(value["authenticationFailureCount"])
  );
}

function isReservationScan(
  value: unknown,
  referencedAuthorizationIds: readonly string[]
): value is EngineeringRecoveryReservationScanV2 {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    hasExactKeys(value, reservationScanKeys) &&
    hasExactReferencePartition(
      referencedAuthorizationIds,
      value["verifiedAuthorizationIds"],
      value["missingAuthorizationIds"]
    ) &&
    Array.isArray(value["orphanAuthorizationIds"]) &&
    value["orphanAuthorizationIds"].every(isStableId) &&
    new Set(value["orphanAuthorizationIds"]).size === value["orphanAuthorizationIds"].length &&
    isCount(value["unknownRecordCount"]) &&
    isCount(value["authenticationFailureCount"])
  );
}

function hasExactReferencePartition(
  expected: readonly string[],
  verified: unknown,
  missing: unknown
): boolean {
  if (
    !Array.isArray(verified) ||
    !Array.isArray(missing) ||
    verified.some((value) => !isStableId(value)) ||
    missing.some((value) => !isStableId(value))
  ) {
    return false;
  }
  const combined = [...verified, ...missing] as string[];
  return (
    new Set(combined).size === combined.length &&
    combined.length === expected.length &&
    [...combined].sort().every((value, index) => value === expected[index])
  );
}

function isLegacyScan(value: unknown): value is EngineeringLegacyRecoveryScanV2 {
  return (
    hasExactKeys(value, legacyScanKeys) &&
    (value["status"] === "clean" || value["status"] === "pending" || value["status"] === "unknown")
  );
}

function isVolumeLocalRecoveryScan(value: unknown): value is {
  readonly status: "clear" | "blocked";
  readonly reasons: readonly EngineeringRecoveryRootGateReasonV2[];
} {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    (record["status"] === "clear" || record["status"] === "blocked") &&
    Array.isArray(record["reasons"]) &&
    record["reasons"].every((reason: unknown) =>
      [
        "binding_invalid",
        "binding_revoked",
        "orphaned_global_record",
        "orphaned_manifest",
        "orphaned_physical_object",
        "manifest_mismatch",
        "unknown_record",
        "authentication_failed",
        "capacity_exceeded"
      ].includes(reason as string)
    )
  );
}

function isLifecycleRecoveryScan(value: unknown): value is {
  readonly status: "clear" | "blocked";
  readonly unknownRecordCount?: number;
  readonly authenticationFailureCount?: number;
} {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    (record["status"] === "clear" || record["status"] === "blocked") &&
    (record["unknownRecordCount"] === undefined || isCount(record["unknownRecordCount"])) &&
    (record["authenticationFailureCount"] === undefined ||
      isCount(record["authenticationFailureCount"]))
  );
}

function isReason(value: unknown): value is EngineeringRecoveryGateReasonV2 {
  return (
    value === "root_unavailable" ||
    value === "prepared_transaction" ||
    value === "unknown_record" ||
    value === "authentication_failed" ||
    value === "orphaned_object" ||
    value === "legacy_recovery_pending"
  );
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isStableId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value);
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
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function invalid<T = never>(code: string, traceId: string): Result<T, UnifiedError> {
  return err(
    validationError({
      code,
      message: "Engineering recovery gate input is invalid.",
      suggestedAction: "Use a Main-issued content-root binding.",
      traceId
    })
  );
}

function mutationBlocked<T = never>(
  snapshot: EngineeringRecoveryGateSnapshotV2,
  traceId: string
): Result<T, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_RECOVERY_GATE_BLOCKED",
      message: "Engineering mutation is blocked until recovery is resolved.",
      suggestedAction: "Resolve the Main-owned recovery review before retrying.",
      traceId,
      redactedDetail: { reasonCount: snapshot.reasons.length }
    })
  );
}

function leaseUnavailable<T = never>(traceId: string): Result<T, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_RECOVERY_GATE_LEASE_UNAVAILABLE",
      message: "Another Engineering V2 transaction currently owns the root lease.",
      suggestedAction: "Wait for the current mutation or recovery operation to finish.",
      traceId
    })
  );
}

function leaseRejected<T = never>(traceId: string): Result<T, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_RECOVERY_GATE_LEASE_INVALID",
      message: "The prepared Engineering V2 transaction no longer matches its root-bound lease.",
      suggestedAction: "Enter recovery review; do not issue another content-root mutation.",
      traceId
    })
  );
}

const rootInputKeys = ["contentRootBindingId"] as const;
const stagingScanKeys = [
  "authenticationFailureCount",
  "missingObjectIds",
  "orphanObjectIds",
  "unknownObjectCount",
  "verifiedObjectIds"
] as const;
const reservationScanKeys = [
  "authenticationFailureCount",
  "missingAuthorizationIds",
  "orphanAuthorizationIds",
  "unknownRecordCount",
  "verifiedAuthorizationIds"
] as const;
const legacyScanKeys = ["status"] as const;
const leaseInputKeys = ["contentRootBindingId", "preparedChecksum", "transactionId"] as const;
