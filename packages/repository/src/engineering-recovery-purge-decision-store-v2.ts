import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import {
  ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
  canonicalizeEngineeringMutationV2Json,
  sha256EngineeringMutationTextV2
} from "./engineering-file-mutation-port-v2.js";
import type {
  EngineeringStateDurabilityPortV2,
  EngineeringStateFileHandleV2
} from "./engineering-mutation-blob-store.js";
import { storageError, validationError } from "./errors.js";

export interface EngineeringRecoveryPurgeDecisionInputV2 {
  readonly recoveryObjectId: string;
  readonly actor: "local_user" | "retention_policy";
  readonly reason: "user_confirmed" | "retention_expired";
  readonly decidedAt: string;
  readonly contentRootBindingId: string;
  readonly recoveryRootBindingId: string;
  readonly recoveryGrantRevision: string;
  readonly recoverySideEffectChecksum: string;
}

export interface EngineeringRecoveryPurgeDecisionRecordV2 extends EngineeringRecoveryPurgeDecisionInputV2 {
  readonly schemaVersion: typeof ENGINEERING_MUTATION_V2_SCHEMA_VERSION;
  readonly kind: "engineering_quarantine_retention_decision";
  readonly state: "purge_authorized";
  readonly decisionChecksum: string;
}

export interface FileEngineeringRecoveryPurgeDecisionStoreV2Options {
  readonly stateRoot: string;
  readonly durability: EngineeringStateDurabilityPortV2;
  readonly traceId?: string;
}

/** Main-only immutable purge decisions. No Renderer or Provider surface can read this store. */
export class FileEngineeringRecoveryPurgeDecisionStoreV2 {
  private static readonly queues = new Map<string, Promise<void>>();
  private readonly traceId: string;

  public constructor(private readonly options: FileEngineeringRecoveryPurgeDecisionStoreV2Options) {
    this.traceId = options.traceId ?? "engineering-recovery-purge-decision-store-v2";
  }

  public async persist(
    input: unknown
  ): Promise<Result<EngineeringRecoveryPurgeDecisionRecordV2, UnifiedError>> {
    const record = createRecord(input, this.traceId);
    if (!record.ok) return record;
    const durability = this.qualifiedDurability();
    if (durability === undefined) return unavailable(this.traceId);

    return this.serialized(record.value.contentRootBindingId, async () => {
      const namespace = await this.readNamespace(record.value.contentRootBindingId, durability);
      if (!namespace.ok) return namespace;
      const existing = namespace.value.get(record.value.recoveryObjectId);
      if (existing !== undefined) {
        return sameCanonicalJson(existing, record.value) ? ok(existing) : conflict(this.traceId);
      }

      const written = await this.write(record.value, durability);
      if (!written.ok) return written;
      const verified = await this.readNamespace(record.value.contentRootBindingId, durability);
      if (!verified.ok) return verified;
      const stored = verified.value.get(record.value.recoveryObjectId);
      return stored !== undefined && sameCanonicalJson(stored, record.value)
        ? ok(stored)
        : authenticationFailure(this.traceId);
    });
  }

  private async readNamespace(
    contentRootBindingId: string,
    durability: EngineeringStateDurabilityPortV2
  ): Promise<Result<ReadonlyMap<string, EngineeringRecoveryPurgeDecisionRecordV2>, UnifiedError>> {
    let entries;
    try {
      entries = await durability.readDirectoryNoFollow(this.directory(contentRootBindingId));
    } catch (cause) {
      return isMissing(cause) ? ok(new Map()) : storageFailure(this.traceId);
    }
    const records = new Map<string, EngineeringRecoveryPurgeDecisionRecordV2>();
    for (const entry of entries) {
      if (entry.kind !== "file" || !/^object-[a-f0-9]{64}\.json$/u.test(entry.name)) {
        return authenticationFailure(this.traceId);
      }
      const record = await this.readFile(
        join(this.directory(contentRootBindingId), entry.name),
        durability
      );
      if (
        !record.ok ||
        record.value === undefined ||
        record.value.contentRootBindingId !== contentRootBindingId ||
        entry.name !== this.fileName(record.value.recoveryObjectId) ||
        records.has(record.value.recoveryObjectId)
      ) {
        return authenticationFailure(this.traceId);
      }
      records.set(record.value.recoveryObjectId, record.value);
    }
    return ok(records);
  }

  private async readFile(
    path: string,
    durability: EngineeringStateDurabilityPortV2
  ): Promise<Result<EngineeringRecoveryPurgeDecisionRecordV2 | undefined, UnifiedError>> {
    try {
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(
        await durability.readFileNoFollow(path)
      );
      return validateEngineeringRecoveryPurgeDecisionRecordV2(JSON.parse(decoded), this.traceId);
    } catch (cause) {
      return isMissing(cause) ? ok(undefined) : authenticationFailure(this.traceId);
    }
  }

  private async write(
    record: EngineeringRecoveryPurgeDecisionRecordV2,
    durability: EngineeringStateDurabilityPortV2
  ): Promise<Result<void, UnifiedError>> {
    const directory = this.directory(record.contentRootBindingId);
    const target = join(directory, this.fileName(record.recoveryObjectId));
    const temporary = `${target}.${randomUUID()}.tmp`;
    let handle: EngineeringStateFileHandleV2 | undefined;
    let cleanupFailed = false;
    try {
      await durability.ensureDirectoryNoFollow(directory);
      await durability.flushDirectory(directory);
      handle = await durability.openExclusiveNoFollow(temporary);
      await handle.writeFile(
        new TextEncoder().encode(canonicalizeEngineeringMutationV2Json(record))
      );
      await handle.sync();
      await handle.close();
      handle = undefined;
      try {
        await durability.linkNoFollow(temporary, target);
      } catch (cause) {
        if (!isAlreadyExists(cause)) throw cause;
      }
      await durability.flushDirectory(directory);
    } catch {
      return storageFailure(this.traceId);
    } finally {
      try {
        await handle?.close();
        await durability.unlinkNoFollow(temporary);
        await durability.flushDirectory(directory);
      } catch (cause) {
        if (!isMissing(cause)) cleanupFailed = true;
      }
    }
    return cleanupFailed ? storageFailure(this.traceId) : ok(undefined);
  }

  private directory(contentRootBindingId: string): string {
    return join(
      this.options.stateRoot,
      "engineering-v2",
      "recovery-purge-decisions",
      diskKey("root", contentRootBindingId)
    );
  }

  private fileName(recoveryObjectId: string): string {
    return `${diskKey("object", recoveryObjectId)}.json`;
  }

  private qualifiedDurability(): EngineeringStateDurabilityPortV2 | undefined {
    return this.options.durability?.qualification === "qualified"
      ? this.options.durability
      : undefined;
  }

  private async serialized<T>(
    contentRootBindingId: string,
    operation: () => Promise<Result<T, UnifiedError>>
  ): Promise<Result<T, UnifiedError>> {
    const key = `${this.options.stateRoot}:${contentRootBindingId}`;
    const previous =
      FileEngineeringRecoveryPurgeDecisionStoreV2.queues.get(key) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    FileEngineeringRecoveryPurgeDecisionStoreV2.queues.set(key, current);
    await previous;
    try {
      return await operation();
    } finally {
      release?.();
      if (FileEngineeringRecoveryPurgeDecisionStoreV2.queues.get(key) === current) {
        FileEngineeringRecoveryPurgeDecisionStoreV2.queues.delete(key);
      }
    }
  }
}

export function validateEngineeringRecoveryPurgeDecisionRecordV2(
  value: unknown,
  traceId = "engineering-recovery-purge-decision-store-v2"
): Result<EngineeringRecoveryPurgeDecisionRecordV2, UnifiedError> {
  if (!hasExactKeys(value, recordKeys)) return invalid(traceId);
  const unsigned = withoutKey(value, "decisionChecksum");
  if (
    value["schemaVersion"] !== ENGINEERING_MUTATION_V2_SCHEMA_VERSION ||
    value["kind"] !== "engineering_quarantine_retention_decision" ||
    value["state"] !== "purge_authorized" ||
    !isStableId(value["recoveryObjectId"]) ||
    !isStableId(value["contentRootBindingId"]) ||
    !isStableId(value["recoveryRootBindingId"]) ||
    !isStableId(value["recoveryGrantRevision"]) ||
    !isSha256(value["recoverySideEffectChecksum"]) ||
    (value["actor"] !== "local_user" && value["actor"] !== "retention_policy") ||
    (value["reason"] !== "user_confirmed" && value["reason"] !== "retention_expired") ||
    (value["actor"] === "local_user" && value["reason"] !== "user_confirmed") ||
    (value["actor"] === "retention_policy" && value["reason"] !== "retention_expired") ||
    !isCanonicalUtcTimestamp(value["decidedAt"]) ||
    !isSha256(value["decisionChecksum"]) ||
    value["decisionChecksum"] !==
      sha256EngineeringMutationTextV2(canonicalizeEngineeringMutationV2Json(unsigned))
  ) {
    return invalid(traceId);
  }
  return ok(Object.freeze({ ...value }) as unknown as EngineeringRecoveryPurgeDecisionRecordV2);
}

function createRecord(
  value: unknown,
  traceId: string
): Result<EngineeringRecoveryPurgeDecisionRecordV2, UnifiedError> {
  if (!hasExactKeys(value, inputKeys)) return invalid(traceId);
  const unsigned = {
    schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
    kind: "engineering_quarantine_retention_decision" as const,
    recoveryObjectId: value["recoveryObjectId"],
    actor: value["actor"],
    reason: value["reason"],
    decidedAt: value["decidedAt"],
    contentRootBindingId: value["contentRootBindingId"],
    recoveryRootBindingId: value["recoveryRootBindingId"],
    recoveryGrantRevision: value["recoveryGrantRevision"],
    recoverySideEffectChecksum: value["recoverySideEffectChecksum"],
    state: "purge_authorized" as const
  };
  return validateEngineeringRecoveryPurgeDecisionRecordV2(
    {
      ...unsigned,
      decisionChecksum: sha256EngineeringMutationTextV2(
        canonicalizeEngineeringMutationV2Json(unsigned)
      )
    },
    traceId
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

function sameCanonicalJson(left: unknown, right: unknown): boolean {
  return (
    canonicalizeEngineeringMutationV2Json(left) === canonicalizeEngineeringMutationV2Json(right)
  );
}

function diskKey(namespace: string, value: string): string {
  return `${namespace}-${sha256EngineeringMutationTextV2(value)}`;
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

function isMissing(cause: unknown): boolean {
  return errorCode(cause) === "ENOENT";
}

function isAlreadyExists(cause: unknown): boolean {
  return errorCode(cause) === "EEXIST";
}

function errorCode(cause: unknown): unknown {
  return cause !== null && typeof cause === "object" && "code" in cause
    ? (cause as { readonly code?: unknown }).code
    : undefined;
}

function invalid<T = never>(traceId: string): Result<T, UnifiedError> {
  return err(
    validationError({
      code: "ENGINEERING_RECOVERY_PURGE_DECISION_INVALID",
      message: "Engineering recovery purge decision is invalid.",
      suggestedAction: "Create a fresh Main-owned local-user or retention decision.",
      traceId
    })
  );
}

function unavailable<T = never>(traceId: string): Result<T, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_RECOVERY_PURGE_DECISION_DURABILITY_UNAVAILABLE",
      message: "Qualified purge-decision durability is unavailable.",
      suggestedAction: "Keep permanent purge disabled.",
      traceId
    })
  );
}

function storageFailure<T = never>(traceId: string): Result<T, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_RECOVERY_PURGE_DECISION_WRITE_FAILED",
      message: "Engineering recovery purge decision could not be persisted.",
      suggestedAction: "Keep the quarantine object and retry from local recovery review.",
      traceId
    })
  );
}

function authenticationFailure<T = never>(traceId: string): Result<T, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_RECOVERY_PURGE_DECISION_AUTHENTICATION_FAILED",
      message: "Engineering recovery purge-decision storage failed integrity validation.",
      suggestedAction: "Keep permanent purge disabled and review app recovery state.",
      traceId
    })
  );
}

function conflict<T = never>(traceId: string): Result<T, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_RECOVERY_PURGE_DECISION_CONFLICT",
      message: "A different purge decision already exists for this recovery object.",
      suggestedAction: "Review the existing durable decision instead of replacing it.",
      traceId
    })
  );
}

const inputKeys = [
  "actor",
  "contentRootBindingId",
  "decidedAt",
  "reason",
  "recoveryGrantRevision",
  "recoveryObjectId",
  "recoveryRootBindingId",
  "recoverySideEffectChecksum"
] as const;
const recordKeys = [...inputKeys, "decisionChecksum", "kind", "schemaVersion", "state"] as const;
