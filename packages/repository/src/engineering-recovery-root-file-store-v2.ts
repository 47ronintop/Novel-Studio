import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import {
  ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
  canonicalizeEngineeringMutationV2Json,
  sha256EngineeringMutationTextV2
} from "./engineering-file-mutation-port-v2.js";
import type { EngineeringStateDurabilityPortV2 } from "./engineering-mutation-blob-store.js";
import type {
  EngineeringRecoveryGlobalRecordV2,
  EngineeringRecoveryObjectManifestV2,
  EngineeringRecoveryRootStoreV2
} from "./engineering-recovery-root-repository.js";
import { storageError, validationError } from "./errors.js";
import {
  validateVolumeLocalRecoveryBindingV2,
  volumeLocalRecoverySideEffectChecksumV2,
  type VolumeLocalRecoveryBindingV2
} from "./volume-local-recovery-binding.js";

export interface EngineeringVolumeLocalRecoveryDurabilityPortV2 extends EngineeringStateDurabilityPortV2 {
  /** Main-authenticated authority for the recovery-root handle behind this durability port. */
  readonly recoveryBinding: VolumeLocalRecoveryBindingV2;
}

export interface FileEngineeringRecoveryGlobalRecordStoreV2Options {
  /** Main-owned app state. This may be on a different volume from the content root. */
  readonly stateRoot: string;
  readonly binding: VolumeLocalRecoveryBindingV2;
  readonly durability: EngineeringStateDurabilityPortV2;
  readonly traceId?: string;
}

export interface FileEngineeringRecoveryObjectManifestStoreV2Options {
  /** Path represented by the independently authorized recovery-root handle. */
  readonly recoveryRoot: string;
  readonly binding: VolumeLocalRecoveryBindingV2;
  /** Must carry the exact volume-local authority used to issue `binding`. */
  readonly durability: EngineeringVolumeLocalRecoveryDurabilityPortV2;
  readonly traceId?: string;
}

type RecoveryStoreRecordV2 =
  EngineeringRecoveryGlobalRecordV2 | EngineeringRecoveryObjectManifestV2;

interface FileEngineeringRecoveryRootStoreV2Options<T extends RecoveryStoreRecordV2> {
  readonly root: string;
  readonly binding: VolumeLocalRecoveryBindingV2;
  readonly durability: EngineeringStateDurabilityPortV2;
  readonly namespace: "global-records" | "volume-local-manifests";
  readonly expectedKind: T["kind"];
  readonly validate: (
    value: unknown,
    binding: VolumeLocalRecoveryBindingV2
  ) => Result<T, UnifiedError>;
  readonly traceId: string;
  readonly requireVolumeLocalAuthority: boolean;
}

/** Durable app-state side of the quarantine manifest/global-record pair. */
export class FileEngineeringRecoveryGlobalRecordStoreV2 implements EngineeringRecoveryRootStoreV2<EngineeringRecoveryGlobalRecordV2> {
  private readonly store: FileEngineeringRecoveryRootStoreV2<EngineeringRecoveryGlobalRecordV2>;

  public constructor(options: FileEngineeringRecoveryGlobalRecordStoreV2Options) {
    this.store = new FileEngineeringRecoveryRootStoreV2({
      root: options.stateRoot,
      binding: options.binding,
      durability: options.durability,
      namespace: "global-records",
      expectedKind: "engineering_recovery_global_record",
      validate: validateEngineeringRecoveryGlobalRecordV2,
      traceId: options.traceId ?? "engineering-recovery-global-record-file-store-v2",
      requireVolumeLocalAuthority: false
    });
  }

  public put(value: EngineeringRecoveryGlobalRecordV2) {
    return this.store.put(value);
  }
  public replace(
    expected: EngineeringRecoveryGlobalRecordV2,
    value: EngineeringRecoveryGlobalRecordV2
  ) {
    return this.store.replace(expected, value);
  }
  public get(id: string) {
    return this.store.get(id);
  }
  public list(contentRootBindingId: string) {
    return this.store.list(contentRootBindingId);
  }
}

/** Durable volume-local side of the quarantine manifest/global-record pair. */
export class FileEngineeringRecoveryObjectManifestStoreV2 implements EngineeringRecoveryRootStoreV2<EngineeringRecoveryObjectManifestV2> {
  private readonly store: FileEngineeringRecoveryRootStoreV2<EngineeringRecoveryObjectManifestV2>;

  public constructor(options: FileEngineeringRecoveryObjectManifestStoreV2Options) {
    this.store = new FileEngineeringRecoveryRootStoreV2({
      root: options.recoveryRoot,
      binding: options.binding,
      durability: options.durability,
      namespace: "volume-local-manifests",
      expectedKind: "engineering_recovery_object_manifest",
      validate: validateEngineeringRecoveryObjectManifestV2,
      traceId: options.traceId ?? "engineering-recovery-manifest-file-store-v2",
      requireVolumeLocalAuthority: true
    });
  }

  public put(value: EngineeringRecoveryObjectManifestV2) {
    return this.store.put(value);
  }
  public replace(
    expected: EngineeringRecoveryObjectManifestV2,
    value: EngineeringRecoveryObjectManifestV2
  ) {
    return this.store.replace(expected, value);
  }
  public get(id: string) {
    return this.store.get(id);
  }
  public list(contentRootBindingId: string) {
    return this.store.list(contentRootBindingId);
  }
}

class FileEngineeringRecoveryRootStoreV2<
  T extends RecoveryStoreRecordV2
> implements EngineeringRecoveryRootStoreV2<T> {
  private static readonly queues = new Map<string, Promise<void>>();

  public constructor(private readonly options: FileEngineeringRecoveryRootStoreV2Options<T>) {}

  public async put(value: T): Promise<Result<T, UnifiedError>> {
    const qualified = this.qualified();
    if (!qualified.ok) return qualified;
    const parsed = this.options.validate(value, qualified.value.binding);
    if (!parsed.ok) return parsed;

    return this.serialized(async () => {
      const namespace = await this.list(qualified.value.binding.contentRootBindingId);
      if (!namespace.ok) return namespace;
      const existing = namespace.value.find(
        (candidate) => candidate.recoveryObjectId === parsed.value.recoveryObjectId
      );
      if (existing !== undefined) {
        return sameCanonical(existing, parsed.value)
          ? ok(existing)
          : conflict(this.options.traceId);
      }

      const persisted = await this.persistImmutable(parsed.value, qualified.value.durability);
      if (!persisted.ok) return persisted;
      if (!persisted.value) {
        const raced = await this.read(parsed.value.recoveryObjectId, qualified.value);
        if (!raced.ok) return raced;
        return raced.value !== undefined && sameCanonical(raced.value, parsed.value)
          ? ok(raced.value)
          : conflict(this.options.traceId);
      }
      const stored = await this.read(parsed.value.recoveryObjectId, qualified.value);
      return stored.ok && stored.value !== undefined && sameCanonical(stored.value, parsed.value)
        ? ok(stored.value)
        : stored.ok
          ? authenticationFailure(this.options.traceId)
          : stored;
    });
  }

  public async replace(expected: T, value: T): Promise<Result<T, UnifiedError>> {
    const qualified = this.qualified();
    if (!qualified.ok) return qualified;
    const parsedExpected = this.options.validate(expected, qualified.value.binding);
    const parsedValue = this.options.validate(value, qualified.value.binding);
    if (!parsedExpected.ok || !parsedValue.ok) return invalidRecord(this.options.traceId);
    if (
      parsedExpected.value.recoveryObjectId !== parsedValue.value.recoveryObjectId ||
      parsedExpected.value.contentRootBindingId !== parsedValue.value.contentRootBindingId ||
      parsedExpected.value.recoveryRootBindingId !== parsedValue.value.recoveryRootBindingId
    ) {
      return conflict(this.options.traceId);
    }

    return this.serialized(async () => {
      const namespace = await this.list(qualified.value.binding.contentRootBindingId);
      if (!namespace.ok) return namespace;
      const current = namespace.value.find(
        (candidate) => candidate.recoveryObjectId === parsedExpected.value.recoveryObjectId
      );
      if (current === undefined || !sameCanonical(current, parsedExpected.value)) {
        return conflict(this.options.traceId);
      }
      const persisted = await this.persistReplacement(
        parsedExpected.value,
        parsedValue.value,
        qualified.value
      );
      if (!persisted.ok) return persisted;
      const stored = await this.read(parsedValue.value.recoveryObjectId, qualified.value);
      return stored.ok &&
        stored.value !== undefined &&
        sameCanonical(stored.value, parsedValue.value)
        ? ok(stored.value)
        : stored.ok
          ? authenticationFailure(this.options.traceId)
          : stored;
    });
  }

  public async get(id: string): Promise<Result<T | undefined, UnifiedError>> {
    if (!isStableId(id)) return invalidId(this.options.traceId);
    const qualified = this.qualified();
    if (!qualified.ok) return qualified;
    const namespace = await this.list(qualified.value.binding.contentRootBindingId);
    if (!namespace.ok) return namespace;
    return ok(namespace.value.find((candidate) => candidate.recoveryObjectId === id));
  }

  public async list(contentRootBindingId: string): Promise<Result<readonly T[], UnifiedError>> {
    if (!isStableId(contentRootBindingId)) return invalidId(this.options.traceId);
    const qualified = this.qualified();
    if (!qualified.ok) return qualified;
    if (contentRootBindingId !== qualified.value.binding.contentRootBindingId) {
      return boundaryMismatch(this.options.traceId);
    }

    let entries;
    try {
      entries = await qualified.value.durability.readDirectoryNoFollow(this.directory());
    } catch (cause) {
      return isMissing(cause)
        ? ok(Object.freeze([]))
        : storageFailure("ENGINEERING_RECOVERY_STORE_READ_FAILED", this.options.traceId);
    }
    const values: T[] = [];
    const ids = new Set<string>();
    for (const entry of entries) {
      if (entry.kind !== "file" || !isRecordFileName(entry.name)) {
        return authenticationFailure(this.options.traceId);
      }
      const value = await this.readFile(join(this.directory(), entry.name), qualified.value);
      if (!value.ok || value.value === undefined)
        return authenticationFailure(this.options.traceId);
      if (entry.name !== this.fileName(value.value.recoveryObjectId)) {
        return authenticationFailure(this.options.traceId);
      }
      if (ids.has(value.value.recoveryObjectId)) return authenticationFailure(this.options.traceId);
      ids.add(value.value.recoveryObjectId);
      values.push(value.value);
    }
    return ok(Object.freeze(values.sort(compareRecords)));
  }

  private qualified(): Result<
    {
      readonly binding: VolumeLocalRecoveryBindingV2;
      readonly durability: EngineeringStateDurabilityPortV2;
    },
    UnifiedError
  > {
    const binding = validateVolumeLocalRecoveryBindingV2(
      this.options.binding,
      this.options.traceId
    );
    if (!binding.ok) return boundaryMismatch(this.options.traceId);
    if (
      typeof this.options.root !== "string" ||
      this.options.root.trim().length === 0 ||
      this.options.durability?.qualification !== "qualified"
    ) {
      return durabilityUnavailable(this.options.traceId);
    }
    if (this.options.requireVolumeLocalAuthority) {
      const authority = (this.options.durability as EngineeringVolumeLocalRecoveryDurabilityPortV2)
        .recoveryBinding;
      const parsedAuthority = validateVolumeLocalRecoveryBindingV2(authority, this.options.traceId);
      if (
        !parsedAuthority.ok ||
        !sameCanonical(parsedAuthority.value, binding.value) ||
        parsedAuthority.value.contentVolumeIdentity !==
          parsedAuthority.value.recoveryVolumeIdentity ||
        parsedAuthority.value.rootRelationship !== "identity_disjoint"
      ) {
        return boundaryMismatch(this.options.traceId);
      }
    }
    return ok({ binding: binding.value, durability: this.options.durability });
  }

  private async read(
    id: string,
    qualified: {
      readonly binding: VolumeLocalRecoveryBindingV2;
      readonly durability: EngineeringStateDurabilityPortV2;
    }
  ): Promise<Result<T | undefined, UnifiedError>> {
    const value = await this.readFile(join(this.directory(), this.fileName(id)), qualified);
    if (!value.ok || value.value === undefined) return value;
    return value.value.recoveryObjectId === id
      ? value
      : authenticationFailure(this.options.traceId);
  }

  private async readFile(
    path: string,
    qualified: {
      readonly binding: VolumeLocalRecoveryBindingV2;
      readonly durability: EngineeringStateDurabilityPortV2;
    }
  ): Promise<Result<T | undefined, UnifiedError>> {
    try {
      const bytes = await qualified.durability.readFileNoFollow(path);
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const parsed = this.options.validate(JSON.parse(decoded), qualified.binding);
      return parsed.ok ? ok(parsed.value) : authenticationFailure(this.options.traceId);
    } catch (cause) {
      return isMissing(cause) ? ok(undefined) : authenticationFailure(this.options.traceId);
    }
  }

  private async persistImmutable(
    value: T,
    durability: EngineeringStateDurabilityPortV2
  ): Promise<Result<boolean, UnifiedError>> {
    const directory = this.directory();
    const target = join(directory, this.fileName(value.recoveryObjectId));
    const temporary = `${target}.${randomUUID()}.tmp`;
    let handle;
    let linked = false;
    let cleanupFailed = false;
    try {
      await durability.ensureDirectoryNoFollow(directory);
      await durability.flushDirectory(directory);
      handle = await durability.openExclusiveNoFollow(temporary);
      await handle.writeFile(
        new TextEncoder().encode(canonicalizeEngineeringMutationV2Json(value))
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
      return storageFailure("ENGINEERING_RECOVERY_STORE_WRITE_FAILED", this.options.traceId);
    } finally {
      try {
        if (handle !== undefined) await handle.close();
        await durability.unlinkNoFollow(temporary);
        await durability.flushDirectory(directory);
      } catch (cause) {
        if (!isMissing(cause)) cleanupFailed = true;
      }
    }
    return cleanupFailed
      ? storageFailure("ENGINEERING_RECOVERY_STORE_WRITE_FAILED", this.options.traceId)
      : ok(linked);
  }

  private async persistReplacement(
    expected: T,
    value: T,
    qualified: {
      readonly binding: VolumeLocalRecoveryBindingV2;
      readonly durability: EngineeringStateDurabilityPortV2;
    }
  ): Promise<Result<void, UnifiedError>> {
    const directory = this.directory();
    const target = join(directory, this.fileName(value.recoveryObjectId));
    const temporary = `${target}.${randomUUID()}.tmp`;
    let handle;
    let renamed = false;
    let cleanupFailed = false;
    try {
      await qualified.durability.ensureDirectoryNoFollow(directory);
      await qualified.durability.flushDirectory(directory);
      handle = await qualified.durability.openExclusiveNoFollow(temporary);
      await handle.writeFile(
        new TextEncoder().encode(canonicalizeEngineeringMutationV2Json(value))
      );
      await handle.sync();
      await handle.close();
      handle = undefined;
      const current = await this.read(expected.recoveryObjectId, qualified);
      if (!current.ok) return current;
      if (current.value === undefined || !sameCanonical(current.value, expected)) {
        return conflict(this.options.traceId);
      }
      await qualified.durability.renameReplaceNoFollow(temporary, target);
      renamed = true;
      await qualified.durability.flushDirectory(directory);
    } catch {
      return storageFailure("ENGINEERING_RECOVERY_STORE_WRITE_FAILED", this.options.traceId);
    } finally {
      if (!renamed) {
        try {
          if (handle !== undefined) await handle.close();
          await qualified.durability.unlinkNoFollow(temporary);
          await qualified.durability.flushDirectory(directory);
        } catch (cause) {
          if (!isMissing(cause)) cleanupFailed = true;
        }
      }
    }
    return cleanupFailed
      ? storageFailure("ENGINEERING_RECOVERY_STORE_WRITE_FAILED", this.options.traceId)
      : ok(undefined);
  }

  private directory(): string {
    const binding = this.options.binding;
    return join(
      this.options.root,
      this.options.namespace === "global-records"
        ? "engineering-v2"
        : ".novel-studio-engineering-v2",
      this.options.namespace,
      diskKey("content", binding.contentRootBindingId),
      diskKey("recovery", binding.recoveryRootBindingId)
    );
  }

  private fileName(recoveryObjectId: string): string {
    return `${diskKey("object", recoveryObjectId)}.json`;
  }

  private async serialized<R>(
    operation: () => Promise<Result<R, UnifiedError>>
  ): Promise<Result<R, UnifiedError>> {
    const key = this.directory();
    const previous = FileEngineeringRecoveryRootStoreV2.queues.get(key) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    FileEngineeringRecoveryRootStoreV2.queues.set(key, current);
    await previous;
    try {
      return await operation();
    } finally {
      release?.();
      if (FileEngineeringRecoveryRootStoreV2.queues.get(key) === current) {
        FileEngineeringRecoveryRootStoreV2.queues.delete(key);
      }
    }
  }
}

export function validateEngineeringRecoveryGlobalRecordV2(
  value: unknown,
  binding: VolumeLocalRecoveryBindingV2
): Result<EngineeringRecoveryGlobalRecordV2, UnifiedError> {
  if (
    !hasExactKeys(value, globalRecordKeys) ||
    value["schemaVersion"] !== ENGINEERING_MUTATION_V2_SCHEMA_VERSION ||
    value["kind"] !== "engineering_recovery_global_record" ||
    !isStableId(value["recoveryObjectId"]) ||
    !isStableId(value["contentRootBindingId"]) ||
    !isStableId(value["recoveryRootBindingId"]) ||
    !isStableId(value["transactionId"]) ||
    !isOperationId(value["operationId"]) ||
    !isSha256(value["manifestChecksum"]) ||
    !isRecoveryState(value["state"]) ||
    !isCanonicalUtcTimestamp(value["recordedAt"]) ||
    !isSha256(value["recordChecksum"])
  ) {
    return invalidRecord();
  }
  if (
    value["contentRootBindingId"] !== binding.contentRootBindingId ||
    value["recoveryRootBindingId"] !== binding.recoveryRootBindingId
  ) {
    return boundaryMismatch();
  }
  if (!checksumMatches(value, "recordChecksum")) return authenticationFailure();
  return ok(freeze({ ...value }) as unknown as EngineeringRecoveryGlobalRecordV2);
}

export function validateEngineeringRecoveryObjectManifestV2(
  value: unknown,
  binding: VolumeLocalRecoveryBindingV2
): Result<EngineeringRecoveryObjectManifestV2, UnifiedError> {
  if (
    !hasExactKeys(value, manifestKeys) ||
    value["schemaVersion"] !== ENGINEERING_MUTATION_V2_SCHEMA_VERSION ||
    value["kind"] !== "engineering_recovery_object_manifest" ||
    !isStableId(value["recoveryObjectId"]) ||
    !isStableId(value["contentRootBindingId"]) ||
    !isStableId(value["recoveryRootBindingId"]) ||
    !isStableId(value["transactionId"]) ||
    !isOperationId(value["operationId"]) ||
    !isCanonicalRelativeIdentity(value["relativeIdentity"]) ||
    !isSha256(value["sourceSha256"]) ||
    !isNonNegativeSafeInteger(value["byteLength"]) ||
    !isSha256(value["bindingChecksum"]) ||
    !isSha256(value["sideEffectChecksum"]) ||
    !isRecoveryState(value["state"]) ||
    typeof value["pinned"] !== "boolean" ||
    !isCanonicalUtcTimestamp(value["createdAt"]) ||
    !isCanonicalUtcTimestamp(value["retentionExpiresAt"]) ||
    Date.parse(value["retentionExpiresAt"] as string) < Date.parse(value["createdAt"] as string) ||
    !isSha256(value["manifestChecksum"])
  ) {
    return invalidRecord();
  }
  if (
    value["contentRootBindingId"] !== binding.contentRootBindingId ||
    value["recoveryRootBindingId"] !== binding.recoveryRootBindingId ||
    value["bindingChecksum"] !== binding.bindingChecksum
  ) {
    return boundaryMismatch();
  }
  if (!checksumMatches(value, "manifestChecksum")) return authenticationFailure();
  let expectedSideEffect: string;
  try {
    expectedSideEffect = volumeLocalRecoverySideEffectChecksumV2({
      binding,
      transactionId: value["transactionId"] as string,
      operationId: value["operationId"] as string,
      recoveryObjectId: value["recoveryObjectId"] as string,
      relativeIdentity: value["relativeIdentity"] as string,
      sourceSha256: value["sourceSha256"] as string
    });
  } catch {
    return invalidRecord();
  }
  if (value["sideEffectChecksum"] !== expectedSideEffect) return authenticationFailure();
  return ok(freeze({ ...value }) as unknown as EngineeringRecoveryObjectManifestV2);
}

function compareRecords(left: RecoveryStoreRecordV2, right: RecoveryStoreRecordV2): number {
  return left.recoveryObjectId.localeCompare(right.recoveryObjectId);
}

function sameCanonical(left: unknown, right: unknown): boolean {
  return (
    canonicalizeEngineeringMutationV2Json(left) === canonicalizeEngineeringMutationV2Json(right)
  );
}

function checksumMatches(value: Record<string, unknown>, field: string): boolean {
  return (
    value[field] ===
    sha256EngineeringMutationTextV2(canonicalizeEngineeringMutationV2Json(withoutKey(value, field)))
  );
}

function diskKey(prefix: string, value: string): string {
  return `${prefix}-${sha256EngineeringMutationTextV2(value)}`;
}

function isRecordFileName(value: string): boolean {
  return /^object-[a-f0-9]{64}\.json$/u.test(value);
}

function isAlreadyExists(cause: unknown): boolean {
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "EEXIST";
}

function isMissing(cause: unknown): boolean {
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT";
}

function isStableId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value);
}

function isOperationId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isRecoveryState(value: unknown): boolean {
  return value === "quarantined" || value === "restored" || value === "purged";
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isCanonicalRelativeIdentity(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.includes("\\") &&
    !value.includes(":") &&
    !value.startsWith("/") &&
    value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
  );
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

function invalidRecord<T = never>(
  traceId = "engineering-recovery-root-file-store-v2"
): Result<T, UnifiedError> {
  return err(
    validationError({
      code: "ENGINEERING_RECOVERY_STORE_RECORD_INVALID",
      message: "Engineering recovery storage record is invalid.",
      suggestedAction:
        "Keep delete disabled and rebuild recovery state from authenticated evidence.",
      traceId
    })
  );
}

function invalidId<T = never>(traceId: string): Result<T, UnifiedError> {
  return err(
    validationError({
      code: "ENGINEERING_RECOVERY_STORE_ID_INVALID",
      message: "Engineering recovery storage identity is invalid.",
      suggestedAction: "Use an app-issued recovery identity.",
      traceId
    })
  );
}

function boundaryMismatch<T = never>(
  traceId = "engineering-recovery-root-file-store-v2"
): Result<T, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_RECOVERY_STORE_BOUNDARY_MISMATCH",
      message: "Engineering recovery storage is not bound to the qualified content volume.",
      suggestedAction: "Keep delete disabled and reauthorize volume-local recovery storage.",
      traceId
    })
  );
}

function conflict<T = never>(traceId: string): Result<T, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_RECOVERY_STORE_CONFLICT",
      message: "Engineering recovery storage changed before the requested durable write.",
      suggestedAction: "Rescan the recovery root and require a fresh recovery review.",
      traceId
    })
  );
}

function authenticationFailure<T = never>(
  traceId = "engineering-recovery-root-file-store-v2"
): Result<T, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_RECOVERY_STORE_AUTHENTICATION_FAILED",
      message: "Engineering recovery storage failed strict integrity validation.",
      suggestedAction: "Block the recovery root and enter Main-owned recovery review.",
      traceId
    })
  );
}

function storageFailure<T = never>(code: string, traceId: string): Result<T, UnifiedError> {
  return err(
    storageError({
      code,
      message: "Engineering recovery storage is unavailable.",
      suggestedAction: "Keep delete disabled until recovery storage is reviewed.",
      traceId
    })
  );
}

function durabilityUnavailable<T = never>(traceId: string): Result<T, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_RECOVERY_STORE_DURABILITY_UNQUALIFIED",
      message: "Qualified no-follow durability is unavailable for engineering recovery storage.",
      suggestedAction: "Keep delete disabled until the durable store is qualified.",
      traceId
    })
  );
}

const globalRecordKeys = [
  "contentRootBindingId",
  "kind",
  "manifestChecksum",
  "operationId",
  "recordChecksum",
  "recordedAt",
  "recoveryObjectId",
  "recoveryRootBindingId",
  "schemaVersion",
  "state",
  "transactionId"
] as const;

const manifestKeys = [
  "bindingChecksum",
  "byteLength",
  "contentRootBindingId",
  "createdAt",
  "kind",
  "manifestChecksum",
  "operationId",
  "pinned",
  "recoveryObjectId",
  "recoveryRootBindingId",
  "relativeIdentity",
  "retentionExpiresAt",
  "schemaVersion",
  "sideEffectChecksum",
  "sourceSha256",
  "state",
  "transactionId"
] as const;
