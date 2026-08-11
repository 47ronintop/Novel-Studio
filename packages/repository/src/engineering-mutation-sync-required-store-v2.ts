import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { validateEngineeringRelativePath } from "@novel-studio/agent-engine";
import { err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import {
  ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
  canonicalizeEngineeringMutationV2Json,
  sha256EngineeringMutationTextV2
} from "./engineering-file-mutation-port-v2.js";
import {
  type EngineeringStateDirectoryEntryV2,
  type EngineeringStateDurabilityPortV2,
  type EngineeringStateFileHandleV2
} from "./engineering-mutation-blob-store.js";
import { storageError, validationError } from "./errors.js";

export type EngineeringMutationSyncRequiredOperationKindV2 =
  "replace_file" | "create_file" | "move_file" | "delete_file" | "create_directory";

/**
 * A Main-owned durable block after disk commit succeeded but editor/tree/index synchronization
 * did not. This is intentionally structurally compatible with the Desktop runtime port without
 * making Repository depend on Desktop.
 */
export interface EngineeringMutationSyncRequiredRecordV2 {
  readonly schemaVersion: typeof ENGINEERING_MUTATION_V2_SCHEMA_VERSION;
  readonly kind: "sync_required";
  readonly contentRootBindingId: string;
  readonly transactionId: string;
  readonly operationKind: EngineeringMutationSyncRequiredOperationKindV2;
  readonly relativeIdentities: readonly string[];
  readonly recordedAt: string;
}

/** Main/recovery code may read the durable reason, but this store intentionally has no clear API. */
export interface EngineeringMutationSyncRequiredStoreV2 {
  readSyncRequired(
    contentRootBindingId: string
  ): Promise<Result<EngineeringMutationSyncRequiredRecordV2 | undefined, UnifiedError>>;
  assertNoSyncRequired(contentRootBindingId: string): Promise<Result<void, UnifiedError>>;
  writeSyncRequired(
    record: EngineeringMutationSyncRequiredRecordV2
  ): Promise<Result<void, UnifiedError>>;
}

interface StoredEngineeringMutationSyncRequiredRecordV2 {
  readonly schemaVersion: typeof ENGINEERING_MUTATION_V2_SCHEMA_VERSION;
  readonly kind: "engineering_mutation_sync_required_store";
  readonly record: EngineeringMutationSyncRequiredRecordV2;
  readonly checksum: string;
}

export interface FileEngineeringMutationSyncRequiredStoreV2Options {
  /** App-owned state root, never a mutation content root. */
  readonly stateRoot: string;
  /** Required Main-owned, no-follow durability seam. */
  readonly durability: EngineeringStateDurabilityPortV2;
  readonly traceId?: string;
}

/**
 * File-backed durable sync-required state. It deliberately has neither a Renderer/Provider API
 * nor a clear operation: clearing is a separate Main recovery/sync-review authority decision.
 */
export class FileEngineeringMutationSyncRequiredStoreV2 implements EngineeringMutationSyncRequiredStoreV2 {
  private static readonly queues = new Map<string, Promise<void>>();
  private readonly traceId: string;

  public constructor(private readonly options: FileEngineeringMutationSyncRequiredStoreV2Options) {
    this.traceId = options.traceId ?? "engineering-mutation-sync-required-store-v2";
  }

  public async readSyncRequired(
    contentRootBindingId: string
  ): Promise<Result<EngineeringMutationSyncRequiredRecordV2 | undefined, UnifiedError>> {
    if (!isStableId(contentRootBindingId))
      return invalid("ENGINEERING_MUTATION_SYNC_REQUIRED_ROOT_INVALID", this.traceId);
    const durability = this.qualifiedDurability();
    if (durability === undefined) return durabilityUnavailable(this.traceId);

    const namespace = await this.readAndValidateNamespace(durability);
    if (!namespace.ok) return namespace;
    return ok(namespace.value.get(contentRootBindingId));
  }

  public async assertNoSyncRequired(
    contentRootBindingId: string
  ): Promise<Result<void, UnifiedError>> {
    const read = await this.readSyncRequired(contentRootBindingId);
    if (!read.ok) return read;
    return read.value === undefined ? ok(undefined) : syncRequired(this.traceId);
  }

  public async writeSyncRequired(
    record: EngineeringMutationSyncRequiredRecordV2
  ): Promise<Result<void, UnifiedError>> {
    const parsed = validateEngineeringMutationSyncRequiredRecordV2(record);
    if (!parsed.ok)
      return invalid("ENGINEERING_MUTATION_SYNC_REQUIRED_RECORD_INVALID", this.traceId);
    const durability = this.qualifiedDurability();
    if (durability === undefined) return durabilityUnavailable(this.traceId);

    return this.serialized(async () => {
      const existing = await this.readSyncRequired(parsed.value.contentRootBindingId);
      if (!existing.ok) return existing;
      if (existing.value !== undefined) {
        return sameCanonicalJson(existing.value, parsed.value)
          ? ok(undefined)
          : conflict(this.traceId);
      }

      const persisted = await this.persist(parsed.value, durability);
      if (!persisted.ok) return persisted;
      if (persisted.value) return ok(undefined);

      // A second Main process may have linked a record after the preflight read. Re-read through
      // the strict parser; a different record must never overwrite the original recovery reason.
      const raced = await this.readSyncRequired(parsed.value.contentRootBindingId);
      if (!raced.ok) return raced;
      return raced.value !== undefined && sameCanonicalJson(raced.value, parsed.value)
        ? ok(undefined)
        : conflict(this.traceId);
    });
  }

  private async readAndValidateNamespace(
    durability: EngineeringStateDurabilityPortV2
  ): Promise<Result<ReadonlyMap<string, EngineeringMutationSyncRequiredRecordV2>, UnifiedError>> {
    let entries: readonly EngineeringStateDirectoryEntryV2[];
    try {
      entries = await durability.readDirectoryNoFollow(this.directory());
    } catch (cause) {
      return isMissing(cause)
        ? ok(new Map())
        : storageFailure("ENGINEERING_MUTATION_SYNC_REQUIRED_READ_FAILED", this.traceId);
    }

    const records = new Map<string, EngineeringMutationSyncRequiredRecordV2>();
    for (const entry of entries) {
      if (entry.kind !== "file" || !isRecordFileName(entry.name))
        return authenticationFailure(this.traceId);
      const stored = await this.readStoredRecord(join(this.directory(), entry.name), durability);
      if (!stored.ok || stored.value === undefined) return authenticationFailure(this.traceId);
      if (entry.name !== this.fileName(stored.value.record.contentRootBindingId)) {
        return authenticationFailure(this.traceId);
      }
      if (records.has(stored.value.record.contentRootBindingId))
        return authenticationFailure(this.traceId);
      records.set(stored.value.record.contentRootBindingId, stored.value.record);
    }
    return ok(records);
  }

  private async readStoredRecord(
    path: string,
    durability: EngineeringStateDurabilityPortV2
  ): Promise<Result<StoredEngineeringMutationSyncRequiredRecordV2 | undefined, UnifiedError>> {
    try {
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(
        await durability.readFileNoFollow(path)
      );
      const stored = validateStoredEngineeringMutationSyncRequiredRecordV2(JSON.parse(decoded));
      return stored.ok ? ok(stored.value) : authenticationFailure(this.traceId);
    } catch (cause) {
      if (isMissing(cause)) return ok(undefined);
      return storageFailure("ENGINEERING_MUTATION_SYNC_REQUIRED_READ_FAILED", this.traceId);
    }
  }

  private async persist(
    record: EngineeringMutationSyncRequiredRecordV2,
    durability: EngineeringStateDurabilityPortV2
  ): Promise<Result<boolean, UnifiedError>> {
    const directory = this.directory();
    const target = join(directory, this.fileName(record.contentRootBindingId));
    const temporary = `${target}.${randomUUID()}.tmp`;
    let handle: EngineeringStateFileHandleV2 | undefined;
    let linked = false;
    let cleanupFailed = false;
    try {
      await durability.ensureDirectoryNoFollow(directory);
      await durability.flushDirectory(directory);
      handle = await durability.openExclusiveNoFollow(temporary);
      await handle.writeFile(
        new TextEncoder().encode(canonicalizeEngineeringMutationV2Json(createStoredRecord(record)))
      );
      await handle.sync();
      await handle.close();
      handle = undefined;
      try {
        await durability.linkNoFollow(temporary, target);
        linked = true;
      } catch (cause) {
        if (!isAlreadyExists(cause)) throw cause;
      }
      await durability.flushDirectory(directory);
    } catch {
      return storageFailure("ENGINEERING_MUTATION_SYNC_REQUIRED_WRITE_FAILED", this.traceId);
    } finally {
      try {
        if (handle !== undefined) await handle.close();
        await durability.unlinkNoFollow(temporary);
        await durability.flushDirectory(directory);
      } catch (cause) {
        if (!isMissing(cause)) {
          cleanupFailed = true;
        }
      }
    }
    if (cleanupFailed)
      return storageFailure("ENGINEERING_MUTATION_SYNC_REQUIRED_WRITE_FAILED", this.traceId);
    return ok(linked);
  }

  private directory(): string {
    return join(this.options.stateRoot, "engineering-v2", "sync-required");
  }

  private fileName(contentRootBindingId: string): string {
    return `${diskKey("root", contentRootBindingId)}.json`;
  }

  private qualifiedDurability(): EngineeringStateDurabilityPortV2 | undefined {
    return this.options.durability?.qualification === "qualified"
      ? this.options.durability
      : undefined;
  }

  private async serialized<T>(
    operation: () => Promise<Result<T, UnifiedError>>
  ): Promise<Result<T, UnifiedError>> {
    const queueKey = this.options.stateRoot;
    const previous =
      FileEngineeringMutationSyncRequiredStoreV2.queues.get(queueKey) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    FileEngineeringMutationSyncRequiredStoreV2.queues.set(queueKey, current);
    await previous;
    try {
      return await operation();
    } finally {
      release?.();
      if (FileEngineeringMutationSyncRequiredStoreV2.queues.get(queueKey) === current) {
        FileEngineeringMutationSyncRequiredStoreV2.queues.delete(queueKey);
      }
    }
  }
}

export function validateEngineeringMutationSyncRequiredRecordV2(
  value: unknown
): Result<EngineeringMutationSyncRequiredRecordV2, UnifiedError> {
  if (!hasExactKeys(value, syncRequiredRecordKeys)) {
    return invalid("ENGINEERING_MUTATION_SYNC_REQUIRED_RECORD_INVALID");
  }
  if (
    value["schemaVersion"] !== ENGINEERING_MUTATION_V2_SCHEMA_VERSION ||
    value["kind"] !== "sync_required" ||
    !isStableId(value["contentRootBindingId"]) ||
    !isStableId(value["transactionId"]) ||
    !isOperationKind(value["operationKind"]) ||
    !isCanonicalTargetList(value["relativeIdentities"]) ||
    !isCanonicalUtcTimestamp(value["recordedAt"])
  ) {
    return invalid("ENGINEERING_MUTATION_SYNC_REQUIRED_RECORD_INVALID");
  }
  return ok(
    freeze({
      schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
      kind: "sync_required" as const,
      contentRootBindingId: value["contentRootBindingId"] as string,
      transactionId: value["transactionId"] as string,
      operationKind: value["operationKind"] as EngineeringMutationSyncRequiredOperationKindV2,
      relativeIdentities: freeze([...(value["relativeIdentities"] as string[])]),
      recordedAt: value["recordedAt"] as string
    })
  );
}

export function validateStoredEngineeringMutationSyncRequiredRecordV2(
  value: unknown
): Result<StoredEngineeringMutationSyncRequiredRecordV2, UnifiedError> {
  if (!hasExactKeys(value, storedRecordKeys)) {
    return invalid("ENGINEERING_MUTATION_SYNC_REQUIRED_STORED_RECORD_INVALID");
  }
  const record = validateEngineeringMutationSyncRequiredRecordV2(value["record"]);
  if (
    !record.ok ||
    value["schemaVersion"] !== ENGINEERING_MUTATION_V2_SCHEMA_VERSION ||
    value["kind"] !== "engineering_mutation_sync_required_store" ||
    !isSha256(value["checksum"]) ||
    value["checksum"] !== checksumForRecord(record.value)
  ) {
    return invalid("ENGINEERING_MUTATION_SYNC_REQUIRED_STORED_RECORD_INVALID");
  }
  return ok(
    freeze({
      schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
      kind: "engineering_mutation_sync_required_store" as const,
      record: record.value,
      checksum: value["checksum"] as string
    })
  );
}

function createStoredRecord(
  record: EngineeringMutationSyncRequiredRecordV2
): StoredEngineeringMutationSyncRequiredRecordV2 {
  return freeze({
    schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
    kind: "engineering_mutation_sync_required_store" as const,
    record,
    checksum: checksumForRecord(record)
  });
}

function checksumForRecord(record: EngineeringMutationSyncRequiredRecordV2): string {
  return sha256EngineeringMutationTextV2(
    canonicalizeEngineeringMutationV2Json({
      schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
      kind: "engineering_mutation_sync_required_store",
      record
    })
  );
}

function isCanonicalTargetList(value: unknown): value is readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) return false;
  const targets: string[] = [];
  for (const candidate of value) {
    const validation = validateEngineeringRelativePath(candidate);
    if (!validation.ok || validation.relativeIdentity !== candidate) return false;
    targets.push(candidate);
  }
  return (
    new Set(targets).size === targets.length &&
    targets.every((target, index) => {
      const previous = targets[index - 1];
      return index === 0 || (previous !== undefined && previous.localeCompare(target) < 0);
    })
  );
}

function isOperationKind(value: unknown): value is EngineeringMutationSyncRequiredOperationKindV2 {
  return (
    value === "replace_file" ||
    value === "create_file" ||
    value === "move_file" ||
    value === "delete_file" ||
    value === "create_directory"
  );
}

function isStableId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value);
}

function isCanonicalUtcTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isRecordFileName(value: string): boolean {
  return /^root-[a-f0-9]{64}\.json$/u.test(value);
}

function diskKey(namespace: string, value: string): string {
  return `${namespace}-${sha256EngineeringMutationTextV2(value)}`;
}

function sameCanonicalJson(left: unknown, right: unknown): boolean {
  return (
    canonicalizeEngineeringMutationV2Json(left) === canonicalizeEngineeringMutationV2Json(right)
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

function invalid<T = never>(
  code: string,
  traceId = "engineering-mutation-sync-required-store-v2"
): Result<T, UnifiedError> {
  return err(
    validationError({
      code,
      message: "Engineering mutation sync-required state is invalid.",
      suggestedAction: "Enter Main-owned recovery review before permitting another mutation.",
      traceId
    })
  );
}

function syncRequired<T = never>(traceId: string): Result<T, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_MUTATION_SYNC_REQUIRED",
      message: "Engineering mutation synchronization requires Main-owned recovery review.",
      suggestedAction: "Complete sync review before permitting another mutation for this root.",
      traceId
    })
  );
}

function conflict<T = never>(traceId: string): Result<T, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_MUTATION_SYNC_REQUIRED_CONFLICT",
      message: "A different sync-required record already blocks this content root.",
      suggestedAction: "Enter Main-owned recovery review; do not overwrite the existing reason.",
      traceId
    })
  );
}

function authenticationFailure<T = never>(traceId: string): Result<T, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_MUTATION_SYNC_REQUIRED_AUTHENTICATION_FAILED",
      message: "Engineering mutation sync-required state failed integrity validation.",
      suggestedAction: "Enter Main-owned recovery review; do not permit new mutations.",
      traceId
    })
  );
}

function storageFailure<T = never>(code: string, traceId: string): Result<T, UnifiedError> {
  return err(
    storageError({
      code,
      message: "Engineering mutation sync-required storage is unavailable.",
      suggestedAction: "Enter Main-owned recovery review before permitting new mutations.",
      traceId
    })
  );
}

function durabilityUnavailable<T = never>(traceId: string): Result<T, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_MUTATION_SYNC_REQUIRED_DURABILITY_UNQUALIFIED",
      message: "Qualified Main-owned sync-required durability is unavailable.",
      suggestedAction: "Keep engineering mutations disabled until qualified durability is wired.",
      traceId
    })
  );
}

const syncRequiredRecordKeys = [
  "contentRootBindingId",
  "kind",
  "operationKind",
  "recordedAt",
  "relativeIdentities",
  "schemaVersion",
  "transactionId"
] as const;
const storedRecordKeys = ["checksum", "kind", "record", "schemaVersion"] as const;
