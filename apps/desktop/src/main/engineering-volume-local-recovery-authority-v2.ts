import { isAbsolute, relative } from "node:path";

import {
  ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
  canonicalizeEngineeringMutationV2Json,
  issueVolumeLocalRecoveryBindingV2,
  sha256EngineeringMutationTextV2,
  type EngineeringLifecycleRecoveryRootBindingV2,
  type EngineeringVolumeLocalRecoveryDurabilityPortV2,
  type VolumeLocalRecoveryAuthorityV2,
  type VolumeLocalRecoveryBindingEvidenceV2,
  type VolumeLocalRecoveryBindingV2,
  type VolumeLocalRecoveryEvidenceAuthenticatorV2
} from "@novel-studio/repository";
import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import {
  createEngineeringRecoveryStateDurabilityPortV2,
  type EngineeringFileAccessAddonLoader,
  type EngineeringRecoveryStateDurabilityPortV2Handle
} from "./engineering-file-access-adapter.js";

export interface DesktopEngineeringContentRootIdentityV2 {
  readonly contentRootBindingId: string;
  readonly rootId: bigint;
  readonly volumeIdentity: string;
  readonly directoryIdentity: string;
}

export interface DesktopEngineeringRecoveryAuthorityGrantV2 {
  readonly authority: VolumeLocalRecoveryAuthorityV2;
  readonly recoveryRootBindingId: string;
  readonly grantRevision: string;
  readonly ownershipMarkerChecksum: string;
  readonly storageLabel: string;
  readonly retentionDays: number;
}

export interface DesktopEngineeringRecoveryCapacityV2 {
  readonly capacityBytes: number;
  readonly reservedBytes: number;
}

export type DesktopEngineeringRecoveryCapacityInspectorV2 = (input: {
  /** Main-only native handle. Implementations must inspect this handle, not reopen a path. */
  readonly recoveryRootId: bigint;
}) => Promise<Result<DesktopEngineeringRecoveryCapacityV2, UnifiedError>>;

export interface DesktopEngineeringVolumeLocalRecoveryAuthorityV2 {
  readonly binding: VolumeLocalRecoveryBindingV2;
  readonly durability: EngineeringVolumeLocalRecoveryDurabilityPortV2;
  /** Revalidates the selected pathname and the retained handle before returning the frozen binding. */
  assertCurrent(): Promise<Result<VolumeLocalRecoveryBindingV2, UnifiedError>>;
  /** Main-only native binding for one already-approved quarantine side effect. */
  resolveLifecycleBinding(
    sideEffectChecksum: string
  ): Promise<Result<EngineeringLifecycleRecoveryRootBindingV2, UnifiedError>>;
  dispose(): void;
}

export interface OpenDesktopEngineeringVolumeLocalRecoveryAuthorityV2Options {
  /** Explicitly selected Main-only path. This function never derives a sibling from content. */
  readonly recoveryRoot: string;
  /** Required only for app-owned state-root authority. */
  readonly appStateRoot?: string;
  readonly contentRoot: DesktopEngineeringContentRootIdentityV2;
  readonly grant: DesktopEngineeringRecoveryAuthorityGrantV2;
  readonly addonLoader: EngineeringFileAccessAddonLoader;
  /** Test/installer seam. Production defaults to the same addon's handle-bound capacity ABI. */
  readonly inspectCapacity?: DesktopEngineeringRecoveryCapacityInspectorV2;
  readonly authenticateEvidence: VolumeLocalRecoveryEvidenceAuthenticatorV2;
  readonly minimumFreeBytes?: number;
  readonly now?: () => string;
  readonly traceId?: string;
}

interface EngineeringRecoveryAuthorityNativeAddon {
  readonly openEngineeringRecoveryRootV2: (
    contentRootId: bigint,
    recoveryRoot: string,
    recoveryRootBindingId: string,
    grantRevision: string,
    ownershipMarkerChecksum: string
  ) => unknown;
  readonly closeEngineeringRecoveryRootV2: (recoveryRootId: bigint) => unknown;
  readonly inspectEngineeringRecoveryRootCapacityV2: (recoveryRootId: bigint) => unknown;
}

interface NativeRecoveryRootEvidenceV2 {
  readonly recoveryRootId: bigint;
  readonly volumeIdentity: string;
  readonly directoryIdentity: string;
  readonly recoveryRootBindingId: string;
  readonly grantRevision: string;
  readonly ownershipMarkerChecksum: string;
}

/**
 * Opens the independently authorized recovery directory through the same ADR-0003 addon and
 * binds its duplicate durability descriptor to the exact native recovery handle. No path or
 * native handle is exposed outside this Main-only authority object.
 */
export async function openDesktopEngineeringVolumeLocalRecoveryAuthorityV2(
  options: OpenDesktopEngineeringVolumeLocalRecoveryAuthorityV2Options
): Promise<Result<DesktopEngineeringVolumeLocalRecoveryAuthorityV2, UnifiedError>> {
  const traceId = options.traceId ?? "desktop-engineering-volume-local-recovery-authority-v2";
  if (!validOptions(options)) return invalid(traceId);

  const loaded = options.addonLoader.load();
  if (
    loaded.status !== "loaded" ||
    loaded.metadata.batch !== "8" ||
    loaded.metadata.recovery !== "available"
  ) {
    return unavailable("ENGINEERING_RECOVERY_AUTHORITY_NATIVE_UNAVAILABLE", traceId);
  }
  const addon = asRecoveryAuthorityAddon(loaded.addon);
  if (addon === undefined) {
    return unavailable("ENGINEERING_RECOVERY_AUTHORITY_NATIVE_UNAVAILABLE", traceId);
  }
  const inspectCapacityPort =
    options.inspectCapacity ?? createNativeCapacityInspector(addon, traceId);

  const opened = openNativeRecoveryRoot(addon, options);
  if (!opened.ok) return unavailable(opened.code, traceId);
  const native = opened.value;
  let durability: EngineeringRecoveryStateDurabilityPortV2Handle | undefined;
  let closed = false;
  const closeRecoveryRoot = (rootId: bigint): void => {
    try {
      addon.closeEngineeringRecoveryRootV2(rootId);
    } catch {
      // The native close removes the descriptor before reporting any later cleanup failure.
    }
  };

  try {
    const capacity = await inspectCapacity(inspectCapacityPort, native.recoveryRootId, traceId);
    if (!capacity.ok) {
      closeRecoveryRoot(native.recoveryRootId);
      return capacity;
    }
    const issued = issueBinding(options, native, capacity.value, traceId);
    if (!issued.ok) {
      closeRecoveryRoot(native.recoveryRootId);
      return issued;
    }
    durability = createEngineeringRecoveryStateDurabilityPortV2({
      recoveryRoot: options.recoveryRoot,
      recoveryRootId: native.recoveryRootId,
      recoveryBinding: issued.value,
      addonLoader: options.addonLoader
    });
    if (durability === undefined) {
      closeRecoveryRoot(native.recoveryRootId);
      return unavailable("ENGINEERING_RECOVERY_AUTHORITY_DURABILITY_UNAVAILABLE", traceId);
    }

    const binding = issued.value;
    const assertCurrent = async (): Promise<Result<VolumeLocalRecoveryBindingV2, UnifiedError>> => {
      if (closed) return unavailable("ENGINEERING_RECOVERY_AUTHORITY_CLOSED", traceId);

      // Validate the retained descriptor before comparing it with a fresh open of the selected
      // pathname. The short-lived duplicate never becomes a second authority.
      const retained = createEngineeringRecoveryStateDurabilityPortV2({
        recoveryRoot: options.recoveryRoot,
        recoveryRootId: native.recoveryRootId,
        recoveryBinding: binding,
        addonLoader: options.addonLoader
      });
      if (retained === undefined) {
        return unavailable("ENGINEERING_RECOVERY_AUTHORITY_ROOT_DRIFT", traceId);
      }
      try {
        retained.dispose();
      } catch {
        return unavailable("ENGINEERING_RECOVERY_AUTHORITY_ROOT_DRIFT", traceId);
      }

      const fresh = openNativeRecoveryRoot(addon, options);
      if (!fresh.ok) return unavailable(fresh.code, traceId);
      try {
        if (!samePhysicalAuthority(native, fresh.value)) {
          return unavailable("ENGINEERING_RECOVERY_AUTHORITY_IDENTITY_DRIFT", traceId);
        }
        const currentCapacity = await inspectCapacity(
          inspectCapacityPort,
          fresh.value.recoveryRootId,
          traceId
        );
        if (!currentCapacity.ok) return currentCapacity;
        const current = issueBinding(options, fresh.value, currentCapacity.value, traceId);
        if (!current.ok) return current;
        if (!sameStaticBinding(binding, current.value)) {
          return unavailable("ENGINEERING_RECOVERY_AUTHORITY_BINDING_DRIFT", traceId);
        }
        return ok(binding);
      } finally {
        closeRecoveryRoot(fresh.value.recoveryRootId);
      }
    };

    const authority: DesktopEngineeringVolumeLocalRecoveryAuthorityV2 = {
      binding,
      durability,
      assertCurrent,
      async resolveLifecycleBinding(sideEffectChecksum) {
        if (!isSha256(sideEffectChecksum)) return invalid(traceId);
        const current = await assertCurrent();
        return current.ok
          ? ok(
              Object.freeze({
                recoveryRootBindingId: binding.recoveryRootBindingId,
                recoveryRootId: native.recoveryRootId,
                grantRevision: binding.grantRevision,
                sideEffectChecksum
              })
            )
          : current;
      },
      dispose() {
        if (closed) return;
        closed = true;
        try {
          durability?.dispose();
        } finally {
          closeRecoveryRoot(native.recoveryRootId);
        }
      }
    };
    return ok(Object.freeze(authority));
  } catch {
    try {
      durability?.dispose();
    } finally {
      closeRecoveryRoot(native.recoveryRootId);
    }
    return unavailable("ENGINEERING_RECOVERY_AUTHORITY_UNAVAILABLE", traceId);
  }
}

function openNativeRecoveryRoot(
  addon: EngineeringRecoveryAuthorityNativeAddon,
  options: OpenDesktopEngineeringVolumeLocalRecoveryAuthorityV2Options
):
  | Readonly<{ readonly ok: true; readonly value: NativeRecoveryRootEvidenceV2 }>
  | Readonly<{ readonly ok: false; readonly code: string }> {
  let raw: unknown;
  try {
    raw = addon.openEngineeringRecoveryRootV2(
      options.contentRoot.rootId,
      options.recoveryRoot,
      options.grant.recoveryRootBindingId,
      options.grant.grantRevision,
      options.grant.ownershipMarkerChecksum
    );
  } catch {
    return { ok: false, code: "ENGINEERING_RECOVERY_AUTHORITY_ROOT_UNAVAILABLE" };
  }
  const parsed = parseNativeRecoveryRootEvidence(raw);
  if (
    parsed === undefined ||
    parsed.volumeIdentity !== options.contentRoot.volumeIdentity ||
    parsed.directoryIdentity === options.contentRoot.directoryIdentity ||
    parsed.recoveryRootBindingId !== options.grant.recoveryRootBindingId ||
    parsed.grantRevision !== options.grant.grantRevision ||
    parsed.ownershipMarkerChecksum !== options.grant.ownershipMarkerChecksum
  ) {
    const recoveryRootId =
      parsed?.recoveryRootId ??
      (raw !== null &&
      typeof raw === "object" &&
      !Array.isArray(raw) &&
      typeof (raw as Record<string, unknown>)["recoveryRootId"] === "bigint"
        ? ((raw as Record<string, unknown>)["recoveryRootId"] as bigint)
        : undefined);
    if (recoveryRootId !== undefined) {
      try {
        addon.closeEngineeringRecoveryRootV2(recoveryRootId);
      } catch {
        // Invalid native evidence never becomes an authority even if cleanup also fails.
      }
    }
    return { ok: false, code: "ENGINEERING_RECOVERY_AUTHORITY_EVIDENCE_INVALID" };
  }
  return { ok: true, value: parsed };
}

async function inspectCapacity(
  inspect: DesktopEngineeringRecoveryCapacityInspectorV2,
  recoveryRootId: bigint,
  traceId: string
): Promise<Result<DesktopEngineeringRecoveryCapacityV2, UnifiedError>> {
  try {
    const result = await inspect({ recoveryRootId });
    return result.ok && validCapacity(result.value)
      ? ok(Object.freeze({ ...result.value }))
      : result.ok
        ? unavailable("ENGINEERING_RECOVERY_AUTHORITY_CAPACITY_INVALID", traceId)
        : result;
  } catch {
    return unavailable("ENGINEERING_RECOVERY_AUTHORITY_CAPACITY_UNAVAILABLE", traceId);
  }
}

function issueBinding(
  options: OpenDesktopEngineeringVolumeLocalRecoveryAuthorityV2Options,
  native: NativeRecoveryRootEvidenceV2,
  capacity: DesktopEngineeringRecoveryCapacityV2,
  traceId: string
): Result<VolumeLocalRecoveryBindingV2, UnifiedError> {
  const unsigned = {
    schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
    recoveryRootBindingId: native.recoveryRootBindingId,
    contentRootBindingId: options.contentRoot.contentRootBindingId,
    recoveryRootId: native.recoveryRootId.toString(),
    contentVolumeIdentity: options.contentRoot.volumeIdentity,
    recoveryVolumeIdentity: native.volumeIdentity,
    contentDirectoryIdentity: options.contentRoot.directoryIdentity,
    recoveryDirectoryIdentity: native.directoryIdentity,
    rootRelationship: "identity_disjoint" as const,
    authority: options.grant.authority,
    grantRevision: native.grantRevision,
    ownershipMarkerChecksum: native.ownershipMarkerChecksum,
    aclModeQualification: "qualified" as const,
    atomicRenameQualification: "qualified" as const,
    directoryDurabilityQualification: "qualified" as const,
    storageLabel: options.grant.storageLabel,
    capacityBytes: capacity.capacityBytes,
    reservedBytes: capacity.reservedBytes,
    retentionDays: options.grant.retentionDays,
    observedAt: (options.now ?? (() => new Date().toISOString()))()
  };
  const evidence: VolumeLocalRecoveryBindingEvidenceV2 = Object.freeze({
    ...unsigned,
    evidenceChecksum: sha256EngineeringMutationTextV2(
      canonicalizeEngineeringMutationV2Json(unsigned)
    )
  });
  return issueVolumeLocalRecoveryBindingV2(evidence, {
    authenticateEvidence: options.authenticateEvidence,
    ...(options.minimumFreeBytes === undefined
      ? {}
      : { minimumFreeBytes: options.minimumFreeBytes }),
    traceId
  });
}

function validOptions(
  options: OpenDesktopEngineeringVolumeLocalRecoveryAuthorityV2Options
): boolean {
  if (
    !isAbsolute(options.recoveryRoot) ||
    typeof options.contentRoot.rootId !== "bigint" ||
    !isStableId(options.contentRoot.contentRootBindingId) ||
    !isStableId(options.contentRoot.volumeIdentity) ||
    !isStableId(options.contentRoot.directoryIdentity) ||
    !isStableId(options.grant.recoveryRootBindingId) ||
    !isStableId(options.grant.grantRevision) ||
    !isSha256(options.grant.ownershipMarkerChecksum)
  ) {
    return false;
  }
  if (options.grant.authority !== "app_state_root") return true;
  return (
    options.appStateRoot !== undefined &&
    isAbsolute(options.appStateRoot) &&
    isWithinOrEqual(options.appStateRoot, options.recoveryRoot)
  );
}

function parseNativeRecoveryRootEvidence(value: unknown): NativeRecoveryRootEvidenceV2 | undefined {
  if (!hasExactKeys(value, nativeEvidenceKeys)) return undefined;
  return typeof value["recoveryRootId"] === "bigint" &&
    isStableId(value["volumeIdentity"]) &&
    isStableId(value["directoryIdentity"]) &&
    isStableId(value["recoveryRootBindingId"]) &&
    isStableId(value["grantRevision"]) &&
    isSha256(value["ownershipMarkerChecksum"])
    ? Object.freeze({
        recoveryRootId: value["recoveryRootId"],
        volumeIdentity: value["volumeIdentity"],
        directoryIdentity: value["directoryIdentity"],
        recoveryRootBindingId: value["recoveryRootBindingId"],
        grantRevision: value["grantRevision"],
        ownershipMarkerChecksum: value["ownershipMarkerChecksum"]
      })
    : undefined;
}

function asRecoveryAuthorityAddon(
  value: unknown
): EngineeringRecoveryAuthorityNativeAddon | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  return typeof record["openEngineeringRecoveryRootV2"] === "function" &&
    typeof record["closeEngineeringRecoveryRootV2"] === "function" &&
    typeof record["inspectEngineeringRecoveryRootCapacityV2"] === "function"
    ? (value as EngineeringRecoveryAuthorityNativeAddon)
    : undefined;
}

function createNativeCapacityInspector(
  addon: EngineeringRecoveryAuthorityNativeAddon,
  traceId: string
): DesktopEngineeringRecoveryCapacityInspectorV2 {
  return async ({ recoveryRootId }) => {
    let raw: unknown;
    try {
      raw = await Promise.resolve(addon.inspectEngineeringRecoveryRootCapacityV2(recoveryRootId));
    } catch {
      return unavailable("ENGINEERING_RECOVERY_AUTHORITY_CAPACITY_UNAVAILABLE", traceId);
    }
    if (!hasExactKeys(raw, capacityEvidenceKeys)) {
      return unavailable("ENGINEERING_RECOVERY_AUTHORITY_CAPACITY_INVALID", traceId);
    }
    const capacityBytes = safeIntegerFromBigInt(raw["capacityBytes"]);
    const reservedBytes = safeIntegerFromBigInt(raw["reservedBytes"]);
    return capacityBytes !== undefined &&
      reservedBytes !== undefined &&
      reservedBytes <= capacityBytes
      ? ok(Object.freeze({ capacityBytes, reservedBytes }))
      : unavailable("ENGINEERING_RECOVERY_AUTHORITY_CAPACITY_INVALID", traceId);
  };
}

function safeIntegerFromBigInt(value: unknown): number | undefined {
  return typeof value === "bigint" && value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(value)
    : undefined;
}

function samePhysicalAuthority(
  expected: NativeRecoveryRootEvidenceV2,
  current: NativeRecoveryRootEvidenceV2
): boolean {
  return (
    expected.volumeIdentity === current.volumeIdentity &&
    expected.directoryIdentity === current.directoryIdentity &&
    expected.recoveryRootBindingId === current.recoveryRootBindingId &&
    expected.grantRevision === current.grantRevision &&
    expected.ownershipMarkerChecksum === current.ownershipMarkerChecksum
  );
}

function sameStaticBinding(
  expected: VolumeLocalRecoveryBindingV2,
  current: VolumeLocalRecoveryBindingV2
): boolean {
  return (
    expected.recoveryRootBindingId === current.recoveryRootBindingId &&
    expected.contentRootBindingId === current.contentRootBindingId &&
    expected.contentVolumeIdentity === current.contentVolumeIdentity &&
    expected.recoveryVolumeIdentity === current.recoveryVolumeIdentity &&
    expected.contentDirectoryIdentity === current.contentDirectoryIdentity &&
    expected.recoveryDirectoryIdentity === current.recoveryDirectoryIdentity &&
    expected.rootRelationship === current.rootRelationship &&
    expected.authority === current.authority &&
    expected.grantRevision === current.grantRevision &&
    expected.ownershipMarkerChecksum === current.ownershipMarkerChecksum &&
    expected.aclModeQualification === current.aclModeQualification &&
    expected.atomicRenameQualification === current.atomicRenameQualification &&
    expected.directoryDurabilityQualification === current.directoryDurabilityQualification &&
    expected.storageLabel === current.storageLabel &&
    expected.retentionDays === current.retentionDays
  );
}

function validCapacity(value: DesktopEngineeringRecoveryCapacityV2): boolean {
  return (
    Number.isSafeInteger(value.capacityBytes) &&
    value.capacityBytes >= 0 &&
    Number.isSafeInteger(value.reservedBytes) &&
    value.reservedBytes >= 0 &&
    value.reservedBytes <= value.capacityBytes
  );
}

function isWithinOrEqual(parent: string, child: string): boolean {
  const candidate = relative(parent, child);
  return (
    candidate === "" ||
    (!isAbsolute(candidate) && candidate !== ".." && !candidate.startsWith(`..\\`))
  );
}

function hasExactKeys(
  value: unknown,
  expected: readonly string[]
): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return keys.length === sorted.length && keys.every((key, index) => key === sorted[index]);
}

function isStableId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function invalid<T = never>(traceId: string): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "ENGINEERING_RECOVERY_AUTHORITY_ARGUMENTS_INVALID",
      category: "ValidationError",
      message: "The volume-local recovery authority request is invalid.",
      recoverability: "user-action",
      suggestedAction: "Keep recoverable deletion disabled and select an authorized recovery root.",
      traceId
    })
  );
}

function unavailable<T = never>(code: string, traceId: string): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code,
      category: "StorageError",
      message: "The volume-local recovery authority is unavailable.",
      recoverability: "user-action",
      suggestedAction: "Keep recoverable deletion disabled and requalify the recovery root.",
      traceId
    })
  );
}

const nativeEvidenceKeys = [
  "directoryIdentity",
  "grantRevision",
  "ownershipMarkerChecksum",
  "recoveryRootBindingId",
  "recoveryRootId",
  "volumeIdentity"
] as const;
const capacityEvidenceKeys = ["capacityBytes", "reservedBytes"] as const;
