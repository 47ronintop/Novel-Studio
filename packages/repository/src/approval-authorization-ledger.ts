import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";
import {
  parseApprovalBindingV2,
  projectApprovalBindingV2ForDisplay,
  validateApprovalBindingV2,
  type ApprovalBindingV2
} from "@novel-studio/agent-engine";

export const AUTHORIZATION_LEDGER_V2_SCHEMA_VERSION = "2.0" as const;

export type AuthorizationLedgerStateV2 = "issued" | "reserved" | "consumed" | "revoked";
export type AuthorizationReservationWalStateV2 = "prepared" | "committed" | "aborted";

export interface ApprovalAuthorizationLedgerRecordV2 {
  readonly schemaVersion: typeof AUTHORIZATION_LEDGER_V2_SCHEMA_VERSION;
  readonly authorizationId: string;
  readonly binding: ApprovalBindingV2;
  readonly providerSemanticVersionSetChecksum: string;
  readonly state: AuthorizationLedgerStateV2;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly reservedTransactionId?: string;
  readonly reservedAt?: string;
  readonly reserveWalId?: string;
  readonly consumedAt?: string;
  readonly revokedAt?: string;
  readonly revocationReason?: string;
}

export interface AuthorizationReservationWalV2 {
  readonly schemaVersion: typeof AUTHORIZATION_LEDGER_V2_SCHEMA_VERSION;
  readonly walId: string;
  readonly authorizationId: string;
  readonly transactionId: string;
  readonly state: AuthorizationReservationWalStateV2;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface PersistedLedgerV2 {
  readonly schemaVersion: typeof AUTHORIZATION_LEDGER_V2_SCHEMA_VERSION;
  readonly records: readonly ApprovalAuthorizationLedgerRecordV2[];
  readonly reservationWals: readonly AuthorizationReservationWalV2[];
}

/**
 * Shared Main-owned boundary used by mutation and recovery paths.
 * The WAL methods stay on the same port so apply cannot be wired without
 * startup reservation reconciliation.
 */
export type ApprovalAuthorizationLedgerPort = Pick<
  ApprovalAuthorizationLedger,
  "query" | "consume" | "revoke" | "listReservationWals" | "reconcileOrphanReservations"
>;

export interface ApprovalAuthorizationLedgerOptions {
  /** Optional project root. Without it the ledger remains process durable for tests. */
  readonly projectRoot?: string;
  readonly storagePath?: string;
  readonly now?: () => string;
  readonly createAuthorizationId?: () => string;
  readonly createWalId?: () => string;
  readonly allowQualifiedPreapproval?: boolean;
  readonly traceId?: string;
}

export interface IssueAuthorizationV2Input {
  readonly binding: ApprovalBindingV2;
  readonly authorizationId?: string;
}

export interface ReserveAuthorizationV2Input {
  readonly authorizationId: string;
  readonly transactionId: string;
  readonly walId?: string;
}

export interface ReconcileReservationV2Input {
  readonly preparedTransactionIds?: readonly string[];
  readonly revokedTransactionIds?: readonly string[];
  readonly reservationWals?: readonly AuthorizationReservationWalV2[];
}

/**
 * Main-owned durable state machine for v2 mutation authorization.
 *
 * The JSON file contains only local recovery state. Consumers should use
 * `projectForDisplay` before crossing a renderer/provider boundary; that
 * projection never includes the opaque capability.
 */
export class ApprovalAuthorizationLedger {
  private readonly records = new Map<string, ApprovalAuthorizationLedgerRecordV2>();
  private readonly reservationWals = new Map<string, AuthorizationReservationWalV2>();
  private readonly now: () => string;
  private readonly traceId: string;
  private loaded = false;
  private operationQueue: Promise<void> = Promise.resolve();

  public constructor(private readonly options: ApprovalAuthorizationLedgerOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.traceId = options.traceId ?? "approval-authorization-ledger-v2";
  }

  public async issue(
    input: IssueAuthorizationV2Input | ApprovalBindingV2
  ): Promise<Result<ApprovalAuthorizationLedgerRecordV2, UnifiedError>> {
    return this.serialized(async () => {
      await this.ensureLoaded();
      const binding = "binding" in input ? input.binding : input;
      const bindingValidation = validateApprovalBindingV2(binding, Date.parse(this.now()));
      if (!bindingValidation.ok) return bindingValidation;
      if (binding.approvalSource !== "human_confirmation") {
        return this.failure(
          "AUTHORIZATION_LEDGER_TRUSTED_SURFACE_UNAVAILABLE",
          "Preapproval is disabled until the ADR-0004 trusted surface is qualified."
        );
      }
      const authorizationId =
        "binding" in input && input.authorizationId !== undefined
          ? input.authorizationId
          : `auth_${randomBytes(16).toString("hex")}`;
      if (!isStableId(authorizationId) || this.records.has(authorizationId)) {
        return this.failure(
          "AUTHORIZATION_LEDGER_ID_INVALID",
          "Authorization id is invalid or already issued."
        );
      }
      const record: ApprovalAuthorizationLedgerRecordV2 = freeze({
        schemaVersion: AUTHORIZATION_LEDGER_V2_SCHEMA_VERSION,
        authorizationId,
        binding: parseApprovalBindingV2(binding),
        providerSemanticVersionSetChecksum: binding.providerSemanticVersionSetChecksum,
        state: "issued",
        issuedAt: binding.issuedAt,
        expiresAt: binding.expiresAt
      });
      this.records.set(authorizationId, record);
      await this.persist();
      return ok(record);
    });
  }

  public async reserve(
    input: ReserveAuthorizationV2Input | string,
    transactionId?: string
  ): Promise<Result<ApprovalAuthorizationLedgerRecordV2, UnifiedError>> {
    const normalized: ReserveAuthorizationV2Input =
      typeof input === "string"
        ? { authorizationId: input, transactionId: transactionId ?? "" }
        : input;
    return this.serialized(async () => {
      await this.ensureLoaded();
      const record = this.records.get(normalized.authorizationId);
      if (record === undefined)
        return this.failure(
          "AUTHORIZATION_LEDGER_NOT_FOUND",
          "Authorization is not present in the v2 ledger."
        );
      if (!isStableId(normalized.transactionId))
        return this.failure(
          "AUTHORIZATION_LEDGER_TRANSACTION_INVALID",
          "Transaction id is invalid."
        );
      if (record.state === "reserved" && record.reservedTransactionId === normalized.transactionId)
        return ok(record);
      if (record.state !== "issued")
        return this.failure(
          "AUTHORIZATION_LEDGER_NOT_ISSUED",
          "Only an issued authorization can be reserved."
        );
      if (Date.parse(record.expiresAt) <= Date.parse(this.now()))
        return this.failure(
          "AUTHORIZATION_LEDGER_EXPIRED",
          "Authorization expired before reservation."
        );
      const walId = normalized.walId ?? `wal_${randomBytes(16).toString("hex")}`;
      if (!isStableId(walId))
        return this.failure("AUTHORIZATION_LEDGER_WAL_INVALID", "Reservation WAL id is invalid.");
      const now = this.now();
      const wal = freeze({
        schemaVersion: AUTHORIZATION_LEDGER_V2_SCHEMA_VERSION,
        walId,
        authorizationId: record.authorizationId,
        transactionId: normalized.transactionId,
        state: "prepared" as const,
        createdAt: now,
        updatedAt: now
      });
      const reserved = freeze({
        ...record,
        state: "reserved" as const,
        reservedTransactionId: normalized.transactionId,
        reservedAt: now,
        reserveWalId: walId
      });
      this.records.set(record.authorizationId, reserved);
      this.reservationWals.set(walId, wal);
      await this.persist();
      return ok(reserved);
    });
  }

  public async resume(
    authorizationId: string,
    transactionId: string
  ): Promise<Result<ApprovalAuthorizationLedgerRecordV2, UnifiedError>> {
    return this.serialized(async () => {
      await this.ensureLoaded();
      const record = this.records.get(authorizationId);
      if (record === undefined)
        return this.failure(
          "AUTHORIZATION_LEDGER_NOT_FOUND",
          "Authorization is not present in the v2 ledger."
        );
      if (record.state !== "reserved" || record.reservedTransactionId !== transactionId) {
        return this.failure(
          "AUTHORIZATION_LEDGER_TRANSACTION_MISMATCH",
          "A reservation can only be resumed by its owning transaction."
        );
      }
      return ok(record);
    });
  }

  public async query(
    authorizationId: string,
    transactionId?: string
  ): Promise<Result<ApprovalAuthorizationLedgerRecordV2, UnifiedError>> {
    return this.serialized(async () => {
      await this.ensureLoaded();
      const record = this.records.get(authorizationId);
      if (record === undefined)
        return this.failure(
          "AUTHORIZATION_LEDGER_NOT_FOUND",
          "Authorization is not present in the v2 ledger."
        );
      if (record.state === "reserved" && record.reservedTransactionId !== transactionId) {
        return this.failure(
          "AUTHORIZATION_LEDGER_TRANSACTION_MISMATCH",
          "Reserved authorization state is private to its transaction."
        );
      }
      return ok(record);
    });
  }

  public async consume(
    authorizationId: string,
    transactionId: string
  ): Promise<Result<ApprovalAuthorizationLedgerRecordV2, UnifiedError>> {
    return this.serialized(async () => {
      await this.ensureLoaded();
      const record = this.records.get(authorizationId);
      if (record === undefined)
        return this.failure(
          "AUTHORIZATION_LEDGER_NOT_FOUND",
          "Authorization is not present in the v2 ledger."
        );
      if (record.state !== "reserved" || record.reservedTransactionId !== transactionId) {
        return this.failure(
          "AUTHORIZATION_LEDGER_TRANSACTION_MISMATCH",
          "Only the reserving transaction can consume authorization."
        );
      }
      const previousWal =
        record.reserveWalId === undefined
          ? undefined
          : this.reservationWals.get(record.reserveWalId);
      const consumed = freeze({
        ...record,
        state: "consumed" as const,
        consumedAt: this.now()
      });
      this.records.set(authorizationId, consumed);
      if (record.reserveWalId !== undefined) this.updateWal(record.reserveWalId, "committed");
      try {
        await this.persist();
      } catch (error) {
        this.records.set(authorizationId, record);
        if (record.reserveWalId !== undefined) {
          if (previousWal === undefined) this.reservationWals.delete(record.reserveWalId);
          else this.reservationWals.set(record.reserveWalId, previousWal);
        }
        throw error;
      }
      return ok(consumed);
    });
  }

  public async revoke(
    authorizationId: string,
    reason = "revoked"
  ): Promise<Result<ApprovalAuthorizationLedgerRecordV2, UnifiedError>> {
    return this.serialized(async () => {
      await this.ensureLoaded();
      const record = this.records.get(authorizationId);
      if (record === undefined)
        return this.failure(
          "AUTHORIZATION_LEDGER_NOT_FOUND",
          "Authorization is not present in the v2 ledger."
        );
      if (record.state === "consumed")
        return this.failure(
          "AUTHORIZATION_LEDGER_ALREADY_CONSUMED",
          "Consumed authorization cannot be revoked."
        );
      if (record.state === "revoked") return ok(record);
      const previousWal =
        record.reserveWalId === undefined
          ? undefined
          : this.reservationWals.get(record.reserveWalId);
      const revoked = freeze({
        ...record,
        state: "revoked" as const,
        revokedAt: this.now(),
        revocationReason: reason
      });
      this.records.set(authorizationId, revoked);
      if (record.reserveWalId !== undefined) this.updateWal(record.reserveWalId, "aborted");
      try {
        await this.persist();
      } catch (error) {
        this.records.set(authorizationId, record);
        if (record.reserveWalId !== undefined) {
          if (previousWal === undefined) this.reservationWals.delete(record.reserveWalId);
          else this.reservationWals.set(record.reserveWalId, previousWal);
        }
        throw error;
      }
      return ok(revoked);
    });
  }

  public async reconcileOrphanReservations(
    input: ReconcileReservationV2Input = {}
  ): Promise<Result<readonly string[], UnifiedError>> {
    return this.serialized(async () => {
      await this.ensureLoaded();
      const prepared = new Set(input.preparedTransactionIds ?? []);
      const revokedTransactions = new Set(input.revokedTransactionIds ?? []);
      for (const wal of input.reservationWals ?? []) {
        if (!validateWal(wal) || wal.state !== "prepared") {
          return this.failure(
            "AUTHORIZATION_LEDGER_WAL_INVALID",
            "Only a Main-owned prepared reservation WAL can reconcile a reservation."
          );
        }
        const persisted = this.reservationWals.get(wal.walId);
        if (
          persisted === undefined ||
          persisted.authorizationId !== wal.authorizationId ||
          persisted.transactionId !== wal.transactionId ||
          persisted.state !== "prepared"
        ) {
          return this.failure(
            "AUTHORIZATION_LEDGER_WAL_MISMATCH",
            "The recovery WAL does not match the Main-owned reservation record."
          );
        }
      }
      const revoked: string[] = [];
      for (const record of this.records.values()) {
        if (record.state !== "reserved") continue;
        const wal =
          record.reserveWalId === undefined
            ? undefined
            : this.reservationWals.get(record.reserveWalId);
        const transactionKnown =
          record.reservedTransactionId !== undefined && prepared.has(record.reservedTransactionId);
        if (
          !revokedTransactions.has(record.reservedTransactionId ?? "") &&
          transactionKnown &&
          wal !== undefined &&
          wal.authorizationId === record.authorizationId &&
          wal.transactionId === record.reservedTransactionId
        )
          continue;
        const next = freeze({
          ...record,
          state: "revoked" as const,
          revokedAt: this.now(),
          revocationReason: "orphan_reservation"
        });
        this.records.set(record.authorizationId, next);
        if (record.reserveWalId !== undefined) this.updateWal(record.reserveWalId, "aborted");
        revoked.push(record.authorizationId);
      }
      if (revoked.length > 0 || input.reservationWals !== undefined) await this.persist();
      return ok(Object.freeze(revoked));
    });
  }

  public async list(): Promise<
    Result<readonly ApprovalAuthorizationLedgerRecordV2[], UnifiedError>
  > {
    return this.serialized(async () => {
      await this.ensureLoaded();
      return ok(Object.freeze([...this.records.values()]));
    });
  }

  public async listReservationWals(): Promise<
    Result<readonly AuthorizationReservationWalV2[], UnifiedError>
  > {
    return this.serialized(async () => {
      await this.ensureLoaded();
      return ok(Object.freeze([...this.reservationWals.values()]));
    });
  }

  private updateWal(walId: string, state: AuthorizationReservationWalStateV2): void {
    const wal = this.reservationWals.get(walId);
    if (wal === undefined) return;
    this.reservationWals.set(walId, freeze({ ...wal, state, updatedAt: this.now() }));
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    const path = this.storagePath();
    if (path === undefined) return;
    try {
      const parsed = JSON.parse(await readFile(path, "utf8")) as PersistedLedgerV2;
      if (
        parsed.schemaVersion !== AUTHORIZATION_LEDGER_V2_SCHEMA_VERSION ||
        !Array.isArray(parsed.records) ||
        !Array.isArray(parsed.reservationWals)
      )
        return;
      for (const record of parsed.records) {
        if (validateLedgerRecord(record, true).ok)
          this.records.set(record.authorizationId, freeze(record));
      }
      for (const wal of parsed.reservationWals) {
        if (validateWal(wal)) this.reservationWals.set(wal.walId, freeze(wal));
      }
    } catch {
      // A missing or malformed ledger is handled by an empty, fail-closed ledger.
      this.records.clear();
      this.reservationWals.clear();
    }
  }

  private async persist(): Promise<void> {
    const path = this.storagePath();
    if (path === undefined) return;
    const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
    await mkdir(dirname(path), { recursive: true });
    const payload: PersistedLedgerV2 = {
      schemaVersion: AUTHORIZATION_LEDGER_V2_SCHEMA_VERSION,
      records: [...this.records.values()],
      reservationWals: [...this.reservationWals.values()]
    };
    await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await rename(temporary, path);
  }

  private storagePath(): string | undefined {
    return (
      this.options.storagePath ??
      (this.options.projectRoot === undefined
        ? undefined
        : join(this.options.projectRoot, "history", "agent-authorization-ledger-v2.json"))
    );
  }

  private async serialized<T>(
    operation: () => Promise<Result<T, UnifiedError>>
  ): Promise<Result<T, UnifiedError>> {
    const previous = this.operationQueue;
    let release!: () => void;
    this.operationQueue = new Promise<void>((resolve) => (release = resolve));
    await previous;
    try {
      return await operation();
    } catch (error) {
      return this.failure(
        "AUTHORIZATION_LEDGER_STORAGE_FAILED",
        error instanceof Error ? error.message : "Authorization ledger operation failed."
      );
    } finally {
      release();
    }
  }

  private failure(code: string, message: string): Result<never, UnifiedError> {
    return err(
      createUnifiedError({
        code,
        category: "ValidationError",
        message,
        recoverability: "user-action",
        suggestedAction: "Refresh the Main-owned approval and retry from the current preview.",
        traceId: this.traceId
      })
    );
  }
}

export function validateLedgerRecord(
  value: unknown,
  allowExpired = false
): Result<ApprovalAuthorizationLedgerRecordV2, UnifiedError> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return ledgerInvalid("AUTHORIZATION_LEDGER_RECORD_INVALID", "Ledger record must be an object.");
  const record = value as ApprovalAuthorizationLedgerRecordV2;
  if (
    record.schemaVersion !== AUTHORIZATION_LEDGER_V2_SCHEMA_VERSION ||
    !isStableId(record.authorizationId) ||
    !isLedgerState(record.state) ||
    !isStableId(record.providerSemanticVersionSetChecksum)
  )
    return ledgerInvalid(
      "AUTHORIZATION_LEDGER_RECORD_INVALID",
      "Ledger record has an invalid schema or state."
    );
  const binding = validateApprovalBindingV2(record.binding, Date.now(), { allowExpired });
  if (
    !binding.ok ||
    binding.value.providerSemanticVersionSetChecksum !== record.providerSemanticVersionSetChecksum
  )
    return ledgerInvalid(
      "AUTHORIZATION_LEDGER_BINDING_MISMATCH",
      "Ledger record binding is invalid or uses a different provider version set."
    );
  if (
    record.state === "reserved" &&
    (!isStableId(record.reservedTransactionId) || !isStableId(record.reserveWalId))
  )
    return ledgerInvalid(
      "AUTHORIZATION_LEDGER_RESERVATION_INVALID",
      "Reserved ledger record must name its transaction and WAL."
    );
  return ok(record);
}

export function validateWal(value: unknown): value is AuthorizationReservationWalV2 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const wal = value as AuthorizationReservationWalV2;
  return (
    wal.schemaVersion === AUTHORIZATION_LEDGER_V2_SCHEMA_VERSION &&
    isStableId(wal.walId) &&
    isStableId(wal.authorizationId) &&
    isStableId(wal.transactionId) &&
    ["prepared", "committed", "aborted"].includes(wal.state)
  );
}

/** Legacy records are intentionally recognized only for view/revoke tooling. */
export function isLegacyAuthorizationLedgerRecord(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>)["schemaVersion"] !== AUTHORIZATION_LEDGER_V2_SCHEMA_VERSION
  );
}

export function projectAuthorizationLedgerRecordForDisplay(
  record: ApprovalAuthorizationLedgerRecordV2
): Omit<ApprovalAuthorizationLedgerRecordV2, "binding"> & {
  readonly binding: ReturnType<
    typeof import("@novel-studio/agent-engine").projectApprovalBindingV2ForDisplay
  >;
} {
  return freeze({ ...record, binding: projectApprovalBindingV2ForDisplay(record.binding) });
}

function isStableId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value);
}

function isLedgerState(value: unknown): value is AuthorizationLedgerStateV2 {
  return value === "issued" || value === "reserved" || value === "consumed" || value === "revoked";
}

function ledgerInvalid(code: string, message: string): Result<never, UnifiedError> {
  return err(
    createUnifiedError({
      code,
      category: "ValidationError",
      message,
      recoverability: "user-action",
      suggestedAction: "Recreate the Main-owned authorization ledger entry.",
      traceId: "approval-authorization-ledger-v2"
    })
  );
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
