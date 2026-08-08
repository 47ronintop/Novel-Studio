import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import {
  ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
  ENGINEERING_MUTATION_V2_MAX_RAW_BYTES,
  canonicalizeEngineeringMutationV2Json,
  engineeringMutationBlobIdForSha256V2,
  inspectEngineeringRawBytesV2,
  sha256EngineeringMutationBytesV2,
  type EngineeringRawByteBomV2,
  type EngineeringRawByteEncodingV2,
  type EngineeringRawByteEolV2
} from "./engineering-file-mutation-port-v2.js";
import { storageError, validationError } from "./errors.js";

export interface EngineeringMutationBlobReferenceV2 {
  readonly schemaVersion: typeof ENGINEERING_MUTATION_V2_SCHEMA_VERSION;
  readonly contentRootBindingId: string;
  readonly blobId: string;
  readonly storage: "main_owned_immutable_blob";
  readonly sha256: string;
  readonly byteLength: number;
  readonly encoding: EngineeringRawByteEncodingV2;
  readonly bom: EngineeringRawByteBomV2;
  readonly eol: EngineeringRawByteEolV2;
}

export interface EngineeringMutationBlobPutInputV2 {
  readonly contentRootBindingId: string;
  readonly bytes: Uint8Array;
}

export interface EngineeringMutationBlobScanV2 {
  readonly schemaVersion: typeof ENGINEERING_MUTATION_V2_SCHEMA_VERSION;
  readonly contentRootBindingId: string;
  readonly references: readonly EngineeringMutationBlobReferenceV2[];
  readonly orphanBlobIds: readonly string[];
  readonly unknownObjectCount: number;
  readonly authenticationFailureCount: number;
}

/**
 * Main injects the only qualified state-store implementation.  The repository deliberately has no
 * Node fs fallback because Node's generic APIs cannot establish the Windows no-follow/directory
 * durability contract required by Engineering V2.
 */
export interface EngineeringStateFileHandleV2 {
  writeFile(bytes: Uint8Array): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export interface EngineeringStateDirectoryEntryV2 {
  readonly name: string;
  /** `file` means a regular, non-reparse file; links/reparse points must never be reported as it. */
  readonly kind: "file" | "directory" | "symlink" | "other";
}

export interface EngineeringStateDurabilityPortV2 {
  readonly qualification: "qualified";
  /** Creates/traverses the complete app-owned path without following links or reparse points. */
  ensureDirectoryNoFollow(path: string): Promise<void>;
  flushDirectory(path: string): Promise<void>;
  /** Opens only a new regular file and rejects links/reparse points at every component. */
  openExclusiveNoFollow(path: string): Promise<EngineeringStateFileHandleV2>;
  readFileNoFollow(path: string): Promise<Uint8Array>;
  readDirectoryNoFollow(path: string): Promise<readonly EngineeringStateDirectoryEntryV2[]>;
  linkNoFollow(existingPath: string, newPath: string): Promise<void>;
  renameReplaceNoFollow(oldPath: string, newPath: string): Promise<void>;
  unlinkNoFollow(path: string): Promise<void>;
}

/**
 * App-owned immutable raw-byte storage.  A blob reference is content-addressed and cannot be
 * rewritten under a caller-selected id.
 */
export interface EngineeringMutationBlobStoreV2 {
  put(input: unknown): Promise<Result<EngineeringMutationBlobReferenceV2, UnifiedError>>;
  get(input: unknown): Promise<Result<Uint8Array, UnifiedError>>;
  listRoot(
    contentRootBindingId: string
  ): Promise<Result<readonly EngineeringMutationBlobReferenceV2[], UnifiedError>>;
  scanRoot(input: unknown): Promise<Result<EngineeringMutationBlobScanV2, UnifiedError>>;
}

export class InMemoryEngineeringMutationBlobStoreV2 implements EngineeringMutationBlobStoreV2 {
  private readonly blobs = new Map<
    string,
    Readonly<{ reference: EngineeringMutationBlobReferenceV2; bytes: Uint8Array }>
  >();

  public async put(
    input: unknown
  ): Promise<Result<EngineeringMutationBlobReferenceV2, UnifiedError>> {
    const parsed = parsePutInput(input);
    if (parsed === undefined) return invalid("ENGINEERING_MUTATION_BLOB_INPUT_INVALID");
    const reference = createReference(parsed.contentRootBindingId, parsed.bytes);
    const key = blobKey(reference.contentRootBindingId, reference.blobId);
    const existing = this.blobs.get(key);
    if (existing !== undefined) {
      return sameBytes(existing.bytes, parsed.bytes) ? ok(existing.reference) : conflict();
    }
    this.blobs.set(key, freeze({ reference, bytes: new Uint8Array(parsed.bytes) }));
    return ok(reference);
  }

  public async get(input: unknown): Promise<Result<Uint8Array, UnifiedError>> {
    const reference = validateEngineeringMutationBlobReferenceV2(input);
    if (!reference.ok) return reference;
    const existing = this.blobs.get(
      blobKey(reference.value.contentRootBindingId, reference.value.blobId)
    );
    if (existing === undefined) return missing();
    if (
      !referenceMatchesBytes(existing.reference, existing.bytes) ||
      !sameReference(existing.reference, reference.value)
    ) {
      return authenticationFailure();
    }
    return ok(new Uint8Array(existing.bytes));
  }

  public async listRoot(
    contentRootBindingId: string
  ): Promise<Result<readonly EngineeringMutationBlobReferenceV2[], UnifiedError>> {
    if (!isStableId(contentRootBindingId)) return invalid("ENGINEERING_MUTATION_BLOB_ROOT_INVALID");
    const references: EngineeringMutationBlobReferenceV2[] = [];
    for (const value of this.blobs.values()) {
      if (value.reference.contentRootBindingId !== contentRootBindingId) continue;
      if (!referenceMatchesBytes(value.reference, value.bytes)) return authenticationFailure();
      references.push(value.reference);
    }
    return ok(freeze(references.sort(compareBlobReference)));
  }

  public async scanRoot(
    input: unknown
  ): Promise<Result<EngineeringMutationBlobScanV2, UnifiedError>> {
    const parsed = parseScanInput(input);
    if (parsed === undefined) return invalid("ENGINEERING_MUTATION_BLOB_SCAN_INVALID");
    const references: EngineeringMutationBlobReferenceV2[] = [];
    let authenticationFailureCount = 0;
    for (const value of this.blobs.values()) {
      if (value.reference.contentRootBindingId !== parsed.contentRootBindingId) continue;
      if (!referenceMatchesBytes(value.reference, value.bytes)) {
        authenticationFailureCount += 1;
      } else {
        references.push(value.reference);
      }
    }
    const referenced = new Set(parsed.referencedBlobIds);
    return ok(
      freeze({
        schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
        contentRootBindingId: parsed.contentRootBindingId,
        references: freeze(references.sort(compareBlobReference)),
        orphanBlobIds: freeze(
          references
            .map((reference) => reference.blobId)
            .filter((blobId) => !referenced.has(blobId))
            .sort()
        ),
        unknownObjectCount: 0,
        authenticationFailureCount
      })
    );
  }
}

export interface FileEngineeringMutationBlobStoreV2Options {
  /** App-owned state root, never the content root supplied to a mutation request. */
  readonly stateRoot: string;
  /** Required qualified Main-owned state durability/no-follow implementation. */
  readonly durability: EngineeringStateDurabilityPortV2;
  readonly traceId?: string;
}

/**
 * Durable file-backed seam for Main-owned state.  It is intentionally not a substitute for the
 * qualified native content-root mutation backend; it only persists immutable app-state blobs.
 */
export class FileEngineeringMutationBlobStoreV2 implements EngineeringMutationBlobStoreV2 {
  private readonly traceId: string;

  public constructor(private readonly options: FileEngineeringMutationBlobStoreV2Options) {
    this.traceId = options.traceId ?? "engineering-mutation-blob-store-v2";
  }

  public async put(
    input: unknown
  ): Promise<Result<EngineeringMutationBlobReferenceV2, UnifiedError>> {
    const parsed = parsePutInput(input);
    if (parsed === undefined)
      return invalid("ENGINEERING_MUTATION_BLOB_INPUT_INVALID", this.traceId);
    const durability = this.qualifiedDurability();
    if (durability === undefined) return durabilityUnavailable(this.traceId);
    const reference = createReference(parsed.contentRootBindingId, parsed.bytes);
    const existing = await this.readReference(
      reference.contentRootBindingId,
      reference.blobId,
      durability
    );
    if (!existing.ok) return existing;
    if (existing.value !== undefined) {
      if (!sameReference(existing.value, reference)) return conflict(this.traceId);
      const current = await this.get(existing.value);
      if (!current.ok) return current;
      return sameBytes(current.value, parsed.bytes) ? ok(existing.value) : conflict(this.traceId);
    }

    const directory = this.rootDirectory(reference.contentRootBindingId);
    try {
      await durability.ensureDirectoryNoFollow(directory);
      // `ensureDirectoryNoFollow` may have created the final namespace component.  Its durable
      // visibility is part of the blob protocol, not an implementation detail of a Node fallback.
      await durability.flushDirectory(directory);
      await writeImmutableBytes(durability, directory, this.bytesPath(reference), parsed.bytes);
      await writeImmutableBytes(
        durability,
        directory,
        this.metadataPath(reference),
        new TextEncoder().encode(canonicalizeEngineeringMutationV2Json(reference))
      );
      // A hard-link collision is only idempotent after both independently named immutable objects
      // are re-read through the no-follow port and checked against the caller's bytes.
      const current = await this.get(reference);
      return current.ok && sameBytes(current.value, parsed.bytes)
        ? ok(reference)
        : current.ok
          ? conflict(this.traceId)
          : current;
    } catch {
      return storageFailure("ENGINEERING_MUTATION_BLOB_WRITE_FAILED", this.traceId);
    }
  }

  public async get(input: unknown): Promise<Result<Uint8Array, UnifiedError>> {
    const reference = validateEngineeringMutationBlobReferenceV2(input);
    if (!reference.ok) return reference;
    const durability = this.qualifiedDurability();
    if (durability === undefined) return durabilityUnavailable(this.traceId);
    const stored = await this.readReference(
      reference.value.contentRootBindingId,
      reference.value.blobId,
      durability
    );
    if (!stored.ok) return stored;
    if (stored.value === undefined) return missing(this.traceId);
    if (!sameReference(stored.value, reference.value)) return authenticationFailure(this.traceId);
    try {
      const bytes = new Uint8Array(
        await durability.readFileNoFollow(this.bytesPath(reference.value))
      );
      return referenceMatchesBytes(reference.value, bytes)
        ? ok(bytes)
        : authenticationFailure(this.traceId);
    } catch (cause) {
      if (isMissing(cause)) return missing(this.traceId);
      return storageFailure("ENGINEERING_MUTATION_BLOB_READ_FAILED", this.traceId);
    }
  }

  public async listRoot(
    contentRootBindingId: string
  ): Promise<Result<readonly EngineeringMutationBlobReferenceV2[], UnifiedError>> {
    if (!isStableId(contentRootBindingId))
      return invalid("ENGINEERING_MUTATION_BLOB_ROOT_INVALID", this.traceId);
    const durability = this.qualifiedDurability();
    if (durability === undefined) return durabilityUnavailable(this.traceId);
    const scanned = await this.scanDirectory(contentRootBindingId, new Set<string>(), durability);
    if (!scanned.ok) return scanned;
    if (scanned.value.unknownObjectCount > 0 || scanned.value.authenticationFailureCount > 0) {
      return authenticationFailure(this.traceId);
    }
    return ok(scanned.value.references);
  }

  public async scanRoot(
    input: unknown
  ): Promise<Result<EngineeringMutationBlobScanV2, UnifiedError>> {
    const parsed = parseScanInput(input);
    if (parsed === undefined)
      return invalid("ENGINEERING_MUTATION_BLOB_SCAN_INVALID", this.traceId);
    const durability = this.qualifiedDurability();
    if (durability === undefined) return durabilityUnavailable(this.traceId);
    return this.scanDirectory(
      parsed.contentRootBindingId,
      new Set(parsed.referencedBlobIds),
      durability
    );
  }

  private async scanDirectory(
    contentRootBindingId: string,
    referencedBlobIds: ReadonlySet<string>,
    durability: EngineeringStateDurabilityPortV2
  ): Promise<Result<EngineeringMutationBlobScanV2, UnifiedError>> {
    let entries: readonly EngineeringStateDirectoryEntryV2[];
    try {
      entries = await durability.readDirectoryNoFollow(this.rootDirectory(contentRootBindingId));
    } catch (cause) {
      if (isMissing(cause)) {
        return ok(
          freeze({
            schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
            contentRootBindingId,
            references: freeze([]),
            orphanBlobIds: freeze([]),
            unknownObjectCount: 0,
            authenticationFailureCount: 0
          })
        );
      }
      return storageFailure("ENGINEERING_MUTATION_BLOB_SCAN_FAILED", this.traceId);
    }

    const fileEntries = entries.filter((entry) => entry.kind === "file");
    const names = new Set(fileEntries.map((entry) => entry.name));
    const references: EngineeringMutationBlobReferenceV2[] = [];
    let unknownObjectCount = entries.filter((entry) => entry.kind !== "file").length;
    let authenticationFailureCount = 0;
    for (const entry of [...fileEntries].sort((left, right) =>
      left.name.localeCompare(right.name)
    )) {
      if (!entry.name.endsWith(".json")) {
        if (!entry.name.endsWith(".bin") || !isDiskBlobObjectName(entry.name)) {
          unknownObjectCount += 1;
        }
        continue;
      }
      if (!isDiskBlobMetadataName(entry.name)) {
        unknownObjectCount += 1;
        continue;
      }
      const reference = await this.readReferenceAtPath(
        join(this.rootDirectory(contentRootBindingId), entry.name),
        durability
      );
      if (!reference.ok || reference.value === undefined) {
        authenticationFailureCount += 1;
        continue;
      }
      if (
        reference.value.contentRootBindingId !== contentRootBindingId ||
        entry.name !== this.metadataFileName(reference.value.blobId) ||
        !names.has(this.bytesFileName(reference.value.blobId))
      ) {
        authenticationFailureCount += 1;
        continue;
      }
      const bytes = await this.get(reference.value);
      if (!bytes.ok) {
        authenticationFailureCount += 1;
        continue;
      }
      references.push(reference.value);
    }
    for (const entry of fileEntries) {
      if (
        entry.name.endsWith(".bin") &&
        (!isDiskBlobObjectName(entry.name) ||
          !names.has(`${entry.name.slice(0, -".bin".length)}.json`))
      ) {
        unknownObjectCount += 1;
      }
    }
    const orphanBlobIds = references
      .map((reference) => reference.blobId)
      .filter((blobId) => !referencedBlobIds.has(blobId))
      .sort();
    return ok(
      freeze({
        schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
        contentRootBindingId,
        references: freeze(references.sort(compareBlobReference)),
        orphanBlobIds: freeze(orphanBlobIds),
        unknownObjectCount,
        authenticationFailureCount
      })
    );
  }

  private async readReference(
    contentRootBindingId: string,
    blobId: string,
    durability: EngineeringStateDurabilityPortV2
  ): Promise<Result<EngineeringMutationBlobReferenceV2 | undefined, UnifiedError>> {
    if (!isStableId(contentRootBindingId) || !isStableId(blobId)) {
      return invalid("ENGINEERING_MUTATION_BLOB_REFERENCE_INVALID", this.traceId);
    }
    const reference = await this.readReferenceAtPath(
      this.metadataPath({ contentRootBindingId, blobId }),
      durability
    );
    if (!reference.ok || reference.value === undefined) return reference;
    return reference.value.contentRootBindingId === contentRootBindingId &&
      reference.value.blobId === blobId
      ? reference
      : authenticationFailure(this.traceId);
  }

  private async readReferenceAtPath(
    path: string,
    durability: EngineeringStateDurabilityPortV2
  ): Promise<Result<EngineeringMutationBlobReferenceV2 | undefined, UnifiedError>> {
    try {
      const raw = await durability.readFileNoFollow(path);
      const reference = validateEngineeringMutationBlobReferenceV2(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw))
      );
      return reference.ok ? ok(reference.value) : authenticationFailure(this.traceId);
    } catch (cause) {
      if (isMissing(cause)) return ok(undefined);
      return storageFailure("ENGINEERING_MUTATION_BLOB_REFERENCE_READ_FAILED", this.traceId);
    }
  }

  private rootDirectory(contentRootBindingId: string): string {
    return join(
      this.options.stateRoot,
      "engineering-v2",
      "blobs",
      diskKey("root", contentRootBindingId)
    );
  }

  private bytesPath(
    reference: Pick<EngineeringMutationBlobReferenceV2, "contentRootBindingId" | "blobId">
  ): string {
    return join(
      this.rootDirectory(reference.contentRootBindingId),
      this.bytesFileName(reference.blobId)
    );
  }

  private metadataPath(
    reference: Pick<EngineeringMutationBlobReferenceV2, "contentRootBindingId" | "blobId">
  ): string {
    return join(
      this.rootDirectory(reference.contentRootBindingId),
      this.metadataFileName(reference.blobId)
    );
  }

  private bytesFileName(blobId: string): string {
    return `${diskKey("blob", blobId)}.bin`;
  }

  private metadataFileName(blobId: string): string {
    return `${diskKey("blob", blobId)}.json`;
  }

  private qualifiedDurability(): EngineeringStateDurabilityPortV2 | undefined {
    return this.options.durability?.qualification === "qualified"
      ? this.options.durability
      : undefined;
  }
}

export function validateEngineeringMutationBlobReferenceV2(
  value: unknown
): Result<EngineeringMutationBlobReferenceV2, UnifiedError> {
  if (!hasExactKeys(value, blobReferenceKeys))
    return invalid("ENGINEERING_MUTATION_BLOB_REFERENCE_INVALID");
  if (
    value["schemaVersion"] !== ENGINEERING_MUTATION_V2_SCHEMA_VERSION ||
    !isStableId(value["contentRootBindingId"]) ||
    !isSha256(value["sha256"]) ||
    value["blobId"] !== engineeringMutationBlobIdForSha256V2(value["sha256"] as string) ||
    value["storage"] !== "main_owned_immutable_blob" ||
    !isByteLength(value["byteLength"]) ||
    value["encoding"] !== "utf-8" ||
    !isBom(value["bom"]) ||
    !isEol(value["eol"])
  ) {
    return invalid("ENGINEERING_MUTATION_BLOB_REFERENCE_INVALID");
  }
  return ok(freeze(value as unknown as EngineeringMutationBlobReferenceV2));
}

/** Builds the deterministic reference before persistence so authorization can bind it first. */
export function createEngineeringMutationBlobReferenceV2(
  input: unknown
): Result<EngineeringMutationBlobReferenceV2, UnifiedError> {
  const parsed = parsePutInput(input);
  return parsed === undefined
    ? invalid("ENGINEERING_MUTATION_BLOB_INPUT_INVALID")
    : ok(createReference(parsed.contentRootBindingId, parsed.bytes));
}

function createReference(
  contentRootBindingId: string,
  bytes: Uint8Array
): EngineeringMutationBlobReferenceV2 {
  const inspected = inspectEngineeringRawBytesV2(bytes);
  if (!inspected.ok) throw new Error("ENGINEERING_MUTATION_BLOB_INPUT_INVALID");
  return freeze({
    schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
    contentRootBindingId,
    blobId: engineeringMutationBlobIdForSha256V2(inspected.value.sha256),
    storage: "main_owned_immutable_blob" as const,
    ...inspected.value
  });
}

function parsePutInput(value: unknown): EngineeringMutationBlobPutInputV2 | undefined {
  const valid =
    hasExactKeys(value, putInputKeys) &&
    isStableId(value["contentRootBindingId"]) &&
    value["bytes"] instanceof Uint8Array;
  if (!valid) return undefined;
  return inspectEngineeringRawBytesV2(value["bytes"] as Uint8Array).ok
    ? (value as unknown as EngineeringMutationBlobPutInputV2)
    : undefined;
}

function parseScanInput(
  value: unknown
): Readonly<{ contentRootBindingId: string; referencedBlobIds: readonly string[] }> | undefined {
  if (
    !hasExactKeys(value, scanInputKeys) ||
    !isStableId(value["contentRootBindingId"]) ||
    !Array.isArray(value["referencedBlobIds"]) ||
    (value["referencedBlobIds"] as unknown[]).some((blobId) => !isStableId(blobId))
  ) {
    return undefined;
  }
  const referencedBlobIds = value["referencedBlobIds"] as string[];
  if (new Set(referencedBlobIds).size !== referencedBlobIds.length) return undefined;
  return freeze({
    contentRootBindingId: value["contentRootBindingId"] as string,
    referencedBlobIds: freeze([...referencedBlobIds].sort())
  });
}

function referenceMatchesBytes(
  reference: EngineeringMutationBlobReferenceV2,
  bytes: Uint8Array
): boolean {
  const inspected = inspectEngineeringRawBytesV2(bytes);
  return (
    inspected.ok &&
    reference.blobId === engineeringMutationBlobIdForSha256V2(inspected.value.sha256) &&
    reference.sha256 === sha256EngineeringMutationBytesV2(bytes) &&
    reference.byteLength === inspected.value.byteLength &&
    reference.encoding === inspected.value.encoding &&
    reference.bom === inspected.value.bom &&
    reference.eol === inspected.value.eol
  );
}

function sameReference(
  left: EngineeringMutationBlobReferenceV2,
  right: EngineeringMutationBlobReferenceV2
): boolean {
  return (
    canonicalizeEngineeringMutationV2Json(left) === canonicalizeEngineeringMutationV2Json(right)
  );
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength && left.every((value, index) => value === right[index])
  );
}

function compareBlobReference(
  left: EngineeringMutationBlobReferenceV2,
  right: EngineeringMutationBlobReferenceV2
): number {
  return left.blobId.localeCompare(right.blobId);
}

function blobKey(contentRootBindingId: string, blobId: string): string {
  return `${contentRootBindingId}\u0000${blobId}`;
}

async function writeImmutableBytes(
  durability: EngineeringStateDurabilityPortV2,
  directory: string,
  path: string,
  bytes: Uint8Array
): Promise<boolean> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  let handle: EngineeringStateFileHandleV2 | undefined;
  let result = false;
  let cleanupFailure: unknown;
  let hasCleanupFailure = false;
  try {
    handle = await durability.openExclusiveNoFollow(temporary);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    try {
      await durability.linkNoFollow(temporary, path);
      await durability.flushDirectory(directory);
      result = true;
    } catch (cause) {
      if (!isAlreadyExists(cause)) throw cause;
    }
  } finally {
    if (handle !== undefined) await handle.close();
    try {
      await durability.unlinkNoFollow(temporary);
      await durability.flushDirectory(directory);
    } catch (cause) {
      if (!isMissing(cause)) {
        cleanupFailure = cause;
        hasCleanupFailure = true;
      }
    }
  }
  if (hasCleanupFailure) throw cleanupFailure;
  return result;
}

function diskKey(namespace: string, value: string): string {
  return `${namespace}-${sha256EngineeringMutationBytesV2(new TextEncoder().encode(value))}`;
}

function isDiskBlobObjectName(value: string): boolean {
  return /^blob-[a-f0-9]{64}\.(?:bin|json)$/u.test(value);
}

function isDiskBlobMetadataName(value: string): boolean {
  return /^blob-[a-f0-9]{64}\.json$/u.test(value);
}

function isStableId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isByteLength(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= ENGINEERING_MUTATION_V2_MAX_RAW_BYTES
  );
}

function isBom(value: unknown): value is EngineeringRawByteBomV2 {
  return value === "none" || value === "utf-8";
}

function isEol(value: unknown): value is EngineeringRawByteEolV2 {
  return value === "none" || value === "lf" || value === "crlf" || value === "mixed";
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
  traceId = "engineering-mutation-blob-store-v2"
): Result<T, UnifiedError> {
  return err(
    validationError({
      code,
      message: "Engineering mutation blob input is invalid.",
      suggestedAction: "Regenerate the Main-owned transaction preparation.",
      traceId
    })
  );
}

function missing<T = never>(
  traceId = "engineering-mutation-blob-store-v2"
): Result<T, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_MUTATION_BLOB_MISSING",
      message: "An immutable engineering mutation blob is missing.",
      suggestedAction: "Enter recovery review; do not retry the mutation.",
      traceId
    })
  );
}

function conflict<T = never>(
  traceId = "engineering-mutation-blob-store-v2"
): Result<T, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_MUTATION_BLOB_CONFLICT",
      message: "An immutable engineering mutation blob conflicts with stored content.",
      suggestedAction: "Enter recovery review; do not overwrite app-owned state.",
      traceId
    })
  );
}

function authenticationFailure<T = never>(
  traceId = "engineering-mutation-blob-store-v2"
): Result<T, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_MUTATION_BLOB_AUTHENTICATION_FAILED",
      message: "An engineering mutation blob failed integrity validation.",
      suggestedAction: "Enter recovery review; do not retry the mutation.",
      traceId
    })
  );
}

function storageFailure<T = never>(code: string, traceId: string): Result<T, UnifiedError> {
  return err(
    storageError({
      code,
      message: "Engineering mutation blob storage is unavailable.",
      suggestedAction: "Check app-state storage and enter recovery review before writing.",
      traceId
    })
  );
}

function durabilityUnavailable<T = never>(traceId: string): Result<T, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_MUTATION_BLOB_DURABILITY_UNQUALIFIED",
      message: "Qualified Main-owned blob durability is unavailable.",
      suggestedAction:
        "Keep engineering mutations disabled until the qualified state-store is wired.",
      traceId
    })
  );
}

const blobReferenceKeys = [
  "blobId",
  "bom",
  "byteLength",
  "contentRootBindingId",
  "encoding",
  "eol",
  "schemaVersion",
  "sha256",
  "storage"
] as const;
const putInputKeys = ["bytes", "contentRootBindingId"] as const;
const scanInputKeys = ["contentRootBindingId", "referencedBlobIds"] as const;
