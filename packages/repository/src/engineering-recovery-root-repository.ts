import {
  ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
  canonicalizeEngineeringMutationV2Json,
  sha256EngineeringMutationTextV2
} from "./engineering-file-mutation-port-v2.js";
import { err, ok, type Result, type UnifiedError } from "@novel-studio/shared";
import {
  validateVolumeLocalRecoveryBindingV2,
  volumeLocalRecoverySideEffectChecksumV2,
  type VolumeLocalRecoveryBindingV2
} from "./volume-local-recovery-binding.js";
import { storageError, validationError } from "./errors.js";

export type EngineeringRecoveryObjectStateV2 = "quarantined" | "restored" | "purged";

export interface EngineeringRecoveryObjectManifestV2 {
  readonly schemaVersion: typeof ENGINEERING_MUTATION_V2_SCHEMA_VERSION;
  readonly kind: "engineering_recovery_object_manifest";
  readonly recoveryObjectId: string;
  readonly contentRootBindingId: string;
  readonly recoveryRootBindingId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly relativeIdentity: string;
  readonly sourceSha256: string;
  readonly byteLength: number;
  readonly bindingChecksum: string;
  readonly sideEffectChecksum: string;
  readonly state: EngineeringRecoveryObjectStateV2;
  readonly pinned: boolean;
  readonly createdAt: string;
  readonly retentionExpiresAt: string;
  readonly manifestChecksum: string;
}

export interface EngineeringRecoveryGlobalRecordV2 {
  readonly schemaVersion: typeof ENGINEERING_MUTATION_V2_SCHEMA_VERSION;
  readonly kind: "engineering_recovery_global_record";
  readonly recoveryObjectId: string;
  readonly contentRootBindingId: string;
  readonly recoveryRootBindingId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly manifestChecksum: string;
  readonly state: EngineeringRecoveryObjectStateV2;
  readonly recordedAt: string;
  readonly recordChecksum: string;
}

export interface EngineeringRecoveryRootScanV2 {
  readonly schemaVersion: typeof ENGINEERING_MUTATION_V2_SCHEMA_VERSION;
  readonly contentRootBindingId: string;
  readonly recoveryRootBindingId: string;
  readonly status: "clear" | "blocked";
  readonly reasons: readonly (
    | "binding_invalid"
    | "binding_revoked"
    | "orphaned_global_record"
    | "orphaned_manifest"
    | "manifest_mismatch"
    | "unknown_record"
    | "authentication_failed"
    | "capacity_exceeded"
  )[];
  readonly globalRecordCount: number;
  readonly manifestCount: number;
  readonly usedBytes: number;
  readonly capacityBytes: number;
  readonly scannedAt: string;
  readonly scanChecksum: string;
}

export interface EngineeringRecoveryRootStoreV2<T> {
  put(value: T): Promise<Result<T, UnifiedError>>;
  get(id: string): Promise<Result<T | undefined, UnifiedError>>;
  list(contentRootBindingId: string): Promise<Result<readonly T[], UnifiedError>>;
}

export interface EngineeringRecoveryRootRepositoryV2Options {
  readonly binding: VolumeLocalRecoveryBindingV2;
  readonly globalRecords: EngineeringRecoveryRootStoreV2<EngineeringRecoveryGlobalRecordV2>;
  readonly manifests: EngineeringRecoveryRootStoreV2<EngineeringRecoveryObjectManifestV2>;
  readonly isGrantCurrent?: (binding: VolumeLocalRecoveryBindingV2) => Promise<boolean>;
  readonly now?: () => string;
  readonly traceId?: string;
}

export interface EngineeringRecoveryRestorePreviewV2 {
  readonly schemaVersion: typeof ENGINEERING_MUTATION_V2_SCHEMA_VERSION;
  readonly recoveryObjectId: string;
  readonly relativeIdentity: string;
  readonly sourceSha256: string;
  readonly state: "ready" | "conflict";
  readonly conflictReason?: "target_occupied" | "path_rejected" | "policy_changed";
  readonly previewChecksum: string;
}

export class EngineeringRecoveryRootRepositoryV2 {
  private readonly now: () => string;
  private readonly traceId: string;
  private queue: Promise<void> = Promise.resolve();

  public constructor(private readonly options: EngineeringRecoveryRootRepositoryV2Options) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.traceId = options.traceId ?? "engineering-recovery-root-repository-v2";
  }

  public async recordQuarantine(
    input: unknown
  ): Promise<Result<EngineeringRecoveryGlobalRecordV2, UnifiedError>> {
    return this.serialized(async () => {
      const parsed = parseRecordInput(input, this.options.binding, this.now(), this.traceId);
      if (!parsed.ok) return parsed;
      const binding = await this.assertBindingCurrent();
      if (!binding.ok) return binding;

      const existingManifest = await this.options.manifests.get(parsed.value.recoveryObjectId);
      if (!existingManifest.ok) return existingManifest;
      if (existingManifest.value !== undefined) {
        if (!manifestMatchesInput(existingManifest.value, parsed.value, binding.value)) {
          return manifestConflict(this.traceId);
        }
        const existingGlobal = await this.options.globalRecords.get(parsed.value.recoveryObjectId);
        if (!existingGlobal.ok) return existingGlobal;
        if (existingGlobal.value === undefined) {
          // The write order is manifest -> global.  A missing global side is an incomplete
          // double-write and must be reviewed instead of being guessed into existence.
          return scanBlocked(["orphaned_manifest"], this.traceId, binding.value);
        }
        return sameGlobalForManifest(existingGlobal.value, existingManifest.value)
          ? ok(existingGlobal.value)
          : scanBlocked(["manifest_mismatch"], this.traceId, binding.value);
      }

      // Capacity is checked before the native quarantine is exposed as a durable object.  A
      // failed second write must leave the root blocked, never silently exceed retention space.
      const current = await this.scanRoot();
      if (!current.ok) return current;
      if (current.value.usedBytes + parsed.value.byteLength > binding.value.capacityBytes) {
        return scanBlocked(["capacity_exceeded"], this.traceId, binding.value);
      }

      const manifest = createManifest(parsed.value, binding.value, this.now());
      const storedManifest = await this.options.manifests.put(manifest);
      if (!storedManifest.ok) return storedManifest;
      const record = createGlobalRecord(manifest, this.now());
      const storedRecord = await this.options.globalRecords.put(record);
      if (!storedRecord.ok) return storedRecord;
      return ok(storedRecord.value);
    });
  }

  public async read(
    recoveryObjectId: string
  ): Promise<Result<EngineeringRecoveryGlobalRecordV2 | undefined, UnifiedError>> {
    if (!isStableId(recoveryObjectId))
      return invalid("ENGINEERING_RECOVERY_OBJECT_ID_INVALID", this.traceId);
    return this.options.globalRecords.get(recoveryObjectId);
  }

  public async scanRoot(): Promise<Result<EngineeringRecoveryRootScanV2, UnifiedError>> {
    const binding = validateVolumeLocalRecoveryBindingV2(this.options.binding, this.traceId);
    if (!binding.ok)
      return scanBlocked(
        binding.error.code === "ENGINEERING_RECOVERY_BINDING_AUTHENTICATION_FAILED"
          ? ["authentication_failed"]
          : ["binding_invalid"],
        this.traceId,
        this.options.binding
      );
    if (this.options.isGrantCurrent !== undefined) {
      let current = false;
      try {
        current = await this.options.isGrantCurrent(binding.value);
      } catch {
        current = false;
      }
      if (!current) return scanBlocked(["binding_revoked"], this.traceId, binding.value);
    }
    const globals = await this.options.globalRecords.list(binding.value.contentRootBindingId);
    const manifests = await this.options.manifests.list(binding.value.contentRootBindingId);
    if (!globals.ok || !manifests.ok)
      return scanBlocked(["unknown_record"], this.traceId, binding.value);
    const reasons = new Set<EngineeringRecoveryRootScanV2["reasons"][number]>();
    const globalById = new Map(globals.value.map((record) => [record.recoveryObjectId, record]));
    const manifestById = new Map(
      manifests.value.map((manifest) => [manifest.recoveryObjectId, manifest])
    );
    let usedBytes = 0;
    for (const record of globals.value) {
      if (!isAuthenticatedGlobalRecord(record)) {
        reasons.add("authentication_failed");
        continue;
      }
      const manifest = manifestById.get(record.recoveryObjectId);
      if (manifest === undefined) reasons.add("orphaned_global_record");
      else if (
        !sameBinding(record, manifest, binding.value) ||
        record.manifestChecksum !== manifest.manifestChecksum
      )
        reasons.add("manifest_mismatch");
    }
    for (const manifest of manifests.value) {
      if (!isAuthenticatedManifest(manifest)) {
        reasons.add("authentication_failed");
        continue;
      }
      if (!globalById.has(manifest.recoveryObjectId)) reasons.add("orphaned_manifest");
      if (manifest.state !== "purged") usedBytes += manifest.byteLength;
    }
    if (usedBytes > binding.value.capacityBytes) reasons.add("capacity_exceeded");
    const reasonsArray = [...reasons].sort() as EngineeringRecoveryRootScanV2["reasons"];
    const unsigned = {
      schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
      contentRootBindingId: binding.value.contentRootBindingId,
      recoveryRootBindingId: binding.value.recoveryRootBindingId,
      status: reasonsArray.length === 0 ? ("clear" as const) : ("blocked" as const),
      reasons: reasonsArray,
      globalRecordCount: globals.value.length,
      manifestCount: manifests.value.length,
      usedBytes,
      capacityBytes: binding.value.capacityBytes,
      scannedAt: this.now()
    };
    return ok(
      Object.freeze({
        ...unsigned,
        scanChecksum: sha256EngineeringMutationTextV2(
          canonicalizeEngineeringMutationV2Json(unsigned)
        )
      })
    );
  }

  public async createRestorePreview(
    input: unknown
  ): Promise<Result<EngineeringRecoveryRestorePreviewV2, UnifiedError>> {
    if (
      !hasExactKeys(input, restorePreviewInputKeys) ||
      !isStableId(input["recoveryObjectId"]) ||
      (input["targetState"] !== "absent" && input["targetState"] !== "present") ||
      typeof input["pathAllowed"] !== "boolean" ||
      typeof input["policyCurrent"] !== "boolean"
    )
      return invalid("ENGINEERING_RECOVERY_RESTORE_INPUT_INVALID", this.traceId);
    const record = await this.read(input["recoveryObjectId"] as string);
    if (!record.ok) return record;
    if (record.value === undefined) return missing(this.traceId);
    const manifest = await this.options.manifests.get(record.value.recoveryObjectId);
    if (!manifest.ok) return manifest;
    if (
      manifest.value === undefined ||
      manifest.value.manifestChecksum !== record.value.manifestChecksum
    )
      return scanBlocked(["manifest_mismatch"], this.traceId, this.options.binding);
    const conflictReason =
      input["policyCurrent"] === false
        ? ("policy_changed" as const)
        : input["pathAllowed"] === false
          ? ("path_rejected" as const)
          : input["targetState"] === "present"
            ? ("target_occupied" as const)
            : undefined;
    const state = conflictReason === undefined ? "ready" : "conflict";
    const preview = {
      schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
      recoveryObjectId: manifest.value.recoveryObjectId,
      relativeIdentity: manifest.value.relativeIdentity,
      sourceSha256: manifest.value.sourceSha256,
      state: state as "ready" | "conflict",
      ...(conflictReason === undefined ? {} : { conflictReason })
    };
    return ok(
      Object.freeze({
        ...preview,
        previewChecksum: sha256EngineeringMutationTextV2(
          canonicalizeEngineeringMutationV2Json(preview)
        )
      })
    );
  }

  /** Main-only completion marker after native restore proved the target was absent. */
  public async markRestored(
    input: unknown
  ): Promise<Result<EngineeringRecoveryGlobalRecordV2, UnifiedError>> {
    return this.transitionState(input, "restored");
  }

  /**
   * Permanent purge is intentionally outside the Provider contract.  It requires either a local
   * user confirmation or an explicit retention-policy decision and refuses pinned/unexpired
   * objects.  Native deletion of the quarantine object is performed by Main after this marker is
   * durably recorded; a mismatch blocks the root rather than unlinking by pathname.
   */
  public async markPurged(
    input: unknown
  ): Promise<Result<EngineeringRecoveryGlobalRecordV2, UnifiedError>> {
    if (
      !hasExactKeys(input, purgeInputKeys) ||
      (input["actor"] !== "local_user" && input["actor"] !== "retention_policy") ||
      (input["reason"] !== "user_confirmed" && input["reason"] !== "retention_expired") ||
      (input["actor"] === "local_user" && input["reason"] !== "user_confirmed") ||
      (input["actor"] === "retention_policy" && input["reason"] !== "retention_expired") ||
      !isCanonicalUtcTimestamp(input["at"])
    ) {
      return invalid("ENGINEERING_RECOVERY_PURGE_INPUT_INVALID", this.traceId);
    }
    return this.transitionState(input, "purged");
  }

  private async transitionState(
    input: unknown,
    state: "restored" | "purged"
  ): Promise<Result<EngineeringRecoveryGlobalRecordV2, UnifiedError>> {
    return this.serialized(async () => {
      if (
        !hasExactKeys(input, state === "restored" ? restoreStateInputKeys : purgeInputKeys) ||
        !isStableId(input["recoveryObjectId"]) ||
        !isCanonicalUtcTimestamp(input["at"]) ||
        (state === "restored" && !isReadyRestorePreview(input["preview"]))
      ) {
        return invalid("ENGINEERING_RECOVERY_STATE_INPUT_INVALID", this.traceId);
      }
      const binding = await this.assertBindingCurrent();
      if (!binding.ok) return binding;
      const current = await this.options.globalRecords.get(input["recoveryObjectId"] as string);
      if (!current.ok) return current;
      if (current.value === undefined) return missing(this.traceId);
      const manifestResult = await this.options.manifests.get(current.value.recoveryObjectId);
      if (!manifestResult.ok) return manifestResult;
      const manifest = manifestResult.value;
      if (manifest === undefined || !sameGlobalForManifest(current.value, manifest)) {
        return scanBlocked(["manifest_mismatch"], this.traceId, binding.value);
      }
      if (
        state === "restored" &&
        ((input["preview"] as EngineeringRecoveryRestorePreviewV2).recoveryObjectId !==
          manifest.recoveryObjectId ||
          (input["preview"] as EngineeringRecoveryRestorePreviewV2).relativeIdentity !==
            manifest.relativeIdentity ||
          (input["preview"] as EngineeringRecoveryRestorePreviewV2).sourceSha256 !==
            manifest.sourceSha256)
      ) {
        return invalid("ENGINEERING_RECOVERY_RESTORE_PREVIEW_STALE", this.traceId);
      }
      if (state === "restored" && manifest.state !== "quarantined") {
        return stateConflict(this.traceId);
      }
      if (state === "purged" && (manifest.state !== "quarantined" || manifest.pinned)) {
        return stateConflict(this.traceId);
      }
      if (
        state === "purged" &&
        input["reason"] === "retention_expired" &&
        Date.parse(input["at"] as string) < Date.parse(manifest.retentionExpiresAt)
      ) {
        return stateConflict(this.traceId);
      }
      const nextManifest = sealManifestState(manifest, state);
      const storedManifest = await this.options.manifests.put(nextManifest);
      if (!storedManifest.ok) return storedManifest;
      const nextGlobal = createGlobalRecord(nextManifest, this.now());
      const storedGlobal = await this.options.globalRecords.put(nextGlobal);
      if (!storedGlobal.ok) return storedGlobal;
      return ok(storedGlobal.value);
    });
  }

  private async assertBindingCurrent(): Promise<
    Result<VolumeLocalRecoveryBindingV2, UnifiedError>
  > {
    const binding = validateVolumeLocalRecoveryBindingV2(this.options.binding, this.traceId);
    if (!binding.ok) return binding;
    if (this.options.isGrantCurrent !== undefined) {
      try {
        if (!(await this.options.isGrantCurrent(binding.value))) {
          return scanBlocked(["binding_revoked"], this.traceId, binding.value);
        }
      } catch {
        return scanBlocked(["authentication_failed"], this.traceId, binding.value);
      }
    }
    return binding;
  }

  private async serialized<T>(
    task: () => Promise<Result<T, UnifiedError>>
  ): Promise<Result<T, UnifiedError>> {
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

export class InMemoryEngineeringRecoveryRootStoreV2<
  T extends { readonly recoveryObjectId: string; readonly contentRootBindingId: string }
> implements EngineeringRecoveryRootStoreV2<T> {
  private readonly values = new Map<string, T>();
  public async put(value: T): Promise<Result<T, UnifiedError>> {
    const current = this.values.get(value.recoveryObjectId);
    if (
      current !== undefined &&
      canonicalizeEngineeringMutationV2Json(current) !==
        canonicalizeEngineeringMutationV2Json(value)
    )
      return err(
        storageError({
          code: "ENGINEERING_RECOVERY_STORE_CONFLICT",
          message: "Recovery object already exists with different content.",
          suggestedAction: "Rebuild the recovery proposal from current state.",
          traceId: "engineering-recovery-root-store-v2"
        })
      );
    this.values.set(value.recoveryObjectId, Object.freeze(value));
    return ok(value);
  }
  public async get(id: string): Promise<Result<T | undefined, UnifiedError>> {
    return ok(this.values.get(id));
  }
  public async list(contentRootBindingId: string): Promise<Result<readonly T[], UnifiedError>> {
    return ok(
      [...this.values.values()].filter(
        (value) => value.contentRootBindingId === contentRootBindingId
      )
    );
  }
}

function parseRecordInput(
  value: unknown,
  binding: VolumeLocalRecoveryBindingV2,
  now: string,
  traceId: string
): Result<
  {
    readonly recoveryObjectId: string;
    readonly transactionId: string;
    readonly operationId: string;
    readonly relativeIdentity: string;
    readonly sourceSha256: string;
    readonly byteLength: number;
    readonly sideEffectChecksum: string;
  },
  UnifiedError
> {
  if (
    !hasExactKeys(value, recordInputKeys) ||
    !isStableId(value["recoveryObjectId"]) ||
    !isStableId(value["transactionId"]) ||
    !isOperationId(value["operationId"]) ||
    !isCanonicalRelativeIdentity(value["relativeIdentity"]) ||
    !isSha256(value["sourceSha256"]) ||
    !isNonNegativeSafeInteger(value["byteLength"]) ||
    !isSha256(value["sideEffectChecksum"])
  )
    return invalid("ENGINEERING_RECOVERY_RECORD_INPUT_INVALID", traceId);
  if (
    typeof value["contentRootBindingId"] === "string" &&
    value["contentRootBindingId"] !== binding.contentRootBindingId
  )
    return invalid("ENGINEERING_RECOVERY_RECORD_ROOT_MISMATCH", traceId);
  if (!isCanonicalUtcTimestamp(now)) return invalid("ENGINEERING_RECOVERY_CLOCK_INVALID", traceId);
  const parsed = {
    recoveryObjectId: value["recoveryObjectId"] as string,
    transactionId: value["transactionId"] as string,
    operationId: value["operationId"] as string,
    relativeIdentity: value["relativeIdentity"] as string,
    sourceSha256: value["sourceSha256"] as string,
    byteLength: value["byteLength"] as number,
    sideEffectChecksum: value["sideEffectChecksum"] as string
  };
  let expectedSideEffectChecksum: string;
  try {
    expectedSideEffectChecksum = volumeLocalRecoverySideEffectChecksumV2({
      binding,
      transactionId: parsed.transactionId,
      operationId: parsed.operationId,
      recoveryObjectId: parsed.recoveryObjectId,
      relativeIdentity: parsed.relativeIdentity,
      sourceSha256: parsed.sourceSha256
    });
  } catch {
    return invalid("ENGINEERING_RECOVERY_RECORD_INPUT_INVALID", traceId);
  }
  return parsed.sideEffectChecksum === expectedSideEffectChecksum
    ? ok(parsed)
    : invalid("ENGINEERING_RECOVERY_SIDE_EFFECT_MISMATCH", traceId);
}

function createManifest(
  input: ReturnType<typeof parseRecordInput> extends Result<infer T, UnifiedError> ? T : never,
  binding: VolumeLocalRecoveryBindingV2,
  now: string
): EngineeringRecoveryObjectManifestV2 {
  const unsigned = {
    schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
    kind: "engineering_recovery_object_manifest" as const,
    recoveryObjectId: input.recoveryObjectId,
    contentRootBindingId: binding.contentRootBindingId,
    recoveryRootBindingId: binding.recoveryRootBindingId,
    transactionId: input.transactionId,
    operationId: input.operationId,
    relativeIdentity: input.relativeIdentity,
    sourceSha256: input.sourceSha256,
    byteLength: input.byteLength,
    bindingChecksum: binding.bindingChecksum,
    sideEffectChecksum: input.sideEffectChecksum,
    state: "quarantined" as const,
    pinned: false,
    createdAt: now,
    retentionExpiresAt: new Date(Date.parse(now) + binding.retentionDays * 86_400_000).toISOString()
  };
  return Object.freeze({
    ...unsigned,
    manifestChecksum: sha256EngineeringMutationTextV2(
      canonicalizeEngineeringMutationV2Json(unsigned)
    )
  });
}

function createGlobalRecord(
  manifest: EngineeringRecoveryObjectManifestV2,
  now: string
): EngineeringRecoveryGlobalRecordV2 {
  const unsigned = {
    schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
    kind: "engineering_recovery_global_record" as const,
    recoveryObjectId: manifest.recoveryObjectId,
    contentRootBindingId: manifest.contentRootBindingId,
    recoveryRootBindingId: manifest.recoveryRootBindingId,
    transactionId: manifest.transactionId,
    operationId: manifest.operationId,
    manifestChecksum: manifest.manifestChecksum,
    state: manifest.state,
    recordedAt: now
  };
  return Object.freeze({
    ...unsigned,
    recordChecksum: sha256EngineeringMutationTextV2(canonicalizeEngineeringMutationV2Json(unsigned))
  });
}

function sealManifestState(
  manifest: EngineeringRecoveryObjectManifestV2,
  state: EngineeringRecoveryObjectStateV2
): EngineeringRecoveryObjectManifestV2 {
  const unsigned = { ...withoutKey(manifest, "manifestChecksum"), state };
  return Object.freeze({
    ...unsigned,
    manifestChecksum: sha256EngineeringMutationTextV2(
      canonicalizeEngineeringMutationV2Json(unsigned)
    )
  }) as EngineeringRecoveryObjectManifestV2;
}

function manifestMatchesInput(
  manifest: EngineeringRecoveryObjectManifestV2,
  input: {
    readonly recoveryObjectId: string;
    readonly transactionId: string;
    readonly operationId: string;
    readonly relativeIdentity: string;
    readonly sourceSha256: string;
    readonly byteLength: number;
    readonly sideEffectChecksum: string;
  },
  binding: VolumeLocalRecoveryBindingV2
): boolean {
  return (
    isAuthenticatedManifest(manifest) &&
    manifest.state === "quarantined" &&
    manifest.recoveryObjectId === input.recoveryObjectId &&
    manifest.transactionId === input.transactionId &&
    manifest.operationId === input.operationId &&
    manifest.relativeIdentity === input.relativeIdentity &&
    manifest.sourceSha256 === input.sourceSha256 &&
    manifest.byteLength === input.byteLength &&
    manifest.sideEffectChecksum === input.sideEffectChecksum &&
    manifest.contentRootBindingId === binding.contentRootBindingId &&
    manifest.recoveryRootBindingId === binding.recoveryRootBindingId &&
    manifest.bindingChecksum === binding.bindingChecksum
  );
}

function sameGlobalForManifest(
  record: EngineeringRecoveryGlobalRecordV2,
  manifest: EngineeringRecoveryObjectManifestV2
): boolean {
  return (
    isAuthenticatedGlobalRecord(record) &&
    isAuthenticatedManifest(manifest) &&
    record.recoveryObjectId === manifest.recoveryObjectId &&
    record.contentRootBindingId === manifest.contentRootBindingId &&
    record.recoveryRootBindingId === manifest.recoveryRootBindingId &&
    record.manifestChecksum === manifest.manifestChecksum &&
    record.state === manifest.state
  );
}

function isReadyRestorePreview(value: unknown): value is EngineeringRecoveryRestorePreviewV2 {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, restorePreviewKeys) ||
    value["schemaVersion"] !== ENGINEERING_MUTATION_V2_SCHEMA_VERSION ||
    !isStableId(value["recoveryObjectId"]) ||
    !isCanonicalRelativeIdentity(value["relativeIdentity"]) ||
    !isSha256(value["sourceSha256"]) ||
    value["state"] !== "ready" ||
    !isSha256(value["previewChecksum"])
  ) {
    return false;
  }
  const unsigned = {
    schemaVersion: value["schemaVersion"],
    recoveryObjectId: value["recoveryObjectId"],
    relativeIdentity: value["relativeIdentity"],
    sourceSha256: value["sourceSha256"],
    state: value["state"]
  };
  return (
    value["previewChecksum"] ===
    sha256EngineeringMutationTextV2(canonicalizeEngineeringMutationV2Json(unsigned))
  );
}

function sameBinding(
  record: EngineeringRecoveryGlobalRecordV2,
  manifest: EngineeringRecoveryObjectManifestV2,
  binding: VolumeLocalRecoveryBindingV2
): boolean {
  return (
    record.contentRootBindingId === binding.contentRootBindingId &&
    record.recoveryRootBindingId === binding.recoveryRootBindingId &&
    manifest.contentRootBindingId === binding.contentRootBindingId &&
    manifest.recoveryRootBindingId === binding.recoveryRootBindingId &&
    manifest.bindingChecksum === binding.bindingChecksum
  );
}

function isAuthenticatedManifest(value: EngineeringRecoveryObjectManifestV2): boolean {
  if (!isRecord(value) || !isSha256(value.manifestChecksum)) return false;
  return (
    value.manifestChecksum ===
    sha256EngineeringMutationTextV2(
      canonicalizeEngineeringMutationV2Json(withoutKey(value, "manifestChecksum"))
    )
  );
}

function isAuthenticatedGlobalRecord(value: EngineeringRecoveryGlobalRecordV2): boolean {
  if (!isRecord(value) || !isSha256(value.recordChecksum)) return false;
  return (
    value.recordChecksum ===
    sha256EngineeringMutationTextV2(
      canonicalizeEngineeringMutationV2Json(withoutKey(value, "recordChecksum"))
    )
  );
}

function scanBlocked(
  reasons: EngineeringRecoveryRootScanV2["reasons"],
  traceId: string,
  binding: VolumeLocalRecoveryBindingV2
): Result<never, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_RECOVERY_ROOT_BLOCKED",
      message: "Engineering recovery root is unavailable.",
      suggestedAction: "Keep delete and restore disabled until recovery storage is reviewed.",
      traceId,
      redactedDetail: {
        reasonCount: reasons.length,
        recoveryRootBindingId: binding.recoveryRootBindingId
      }
    })
  );
}

function manifestConflict<T = never>(traceId: string): Result<T, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_RECOVERY_MANIFEST_CONFLICT",
      message: "The recovery object already exists with different authenticated facts.",
      suggestedAction: "Enter recovery review; do not reuse the recovery object identifier.",
      traceId
    })
  );
}

function stateConflict<T = never>(traceId: string): Result<T, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_RECOVERY_STATE_CONFLICT",
      message: "The recovery object is not in a state that permits this transition.",
      suggestedAction: "Generate a fresh Main-owned recovery review.",
      traceId
    })
  );
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function hasExactKeys(
  value: unknown,
  expected: readonly string[]
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  const expectedKeys = [...expected].sort();
  return (
    keys.length === expectedKeys.length && keys.every((key, index) => key === expectedKeys[index])
  );
}
function withoutKey(value: object, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([candidate]) => candidate !== key));
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
function invalid<T = never>(code: string, traceId: string): Result<T, UnifiedError> {
  return err(
    validationError({
      code,
      message: "Engineering recovery root input is invalid.",
      suggestedAction: "Recreate the recovery operation from fresh Main evidence.",
      traceId
    })
  );
}
function missing<T = never>(traceId: string): Result<T, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_RECOVERY_OBJECT_MISSING",
      message: "The recovery object is unavailable.",
      suggestedAction: "Enter recovery review and rescan the recovery root.",
      traceId
    })
  );
}

const recordInputKeys = [
  "byteLength",
  "operationId",
  "recoveryObjectId",
  "relativeIdentity",
  "sideEffectChecksum",
  "sourceSha256",
  "transactionId"
] as const;
const restorePreviewInputKeys = [
  "pathAllowed",
  "policyCurrent",
  "recoveryObjectId",
  "targetState"
] as const;
const restoreStateInputKeys = ["at", "preview", "recoveryObjectId"] as const;
const purgeInputKeys = ["actor", "at", "reason", "recoveryObjectId"] as const;
const restorePreviewKeys = [
  "previewChecksum",
  "recoveryObjectId",
  "relativeIdentity",
  "schemaVersion",
  "sourceSha256",
  "state"
] as const;
