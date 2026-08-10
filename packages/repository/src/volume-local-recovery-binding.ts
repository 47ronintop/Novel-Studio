import { err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import {
  ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
  canonicalizeEngineeringMutationV2Json,
  sha256EngineeringMutationTextV2
} from "./engineering-file-mutation-port-v2.js";
import { storageError, validationError } from "./errors.js";

export type VolumeLocalRecoveryAuthorityV2 =
  "app_state_root" | "installer_managed" | "user_os_directory_grant";

export interface VolumeLocalRecoveryBindingEvidenceV2 {
  readonly schemaVersion: typeof ENGINEERING_MUTATION_V2_SCHEMA_VERSION;
  readonly recoveryRootBindingId: string;
  readonly contentRootBindingId: string;
  readonly recoveryRootId: string;
  readonly contentVolumeIdentity: string;
  readonly recoveryVolumeIdentity: string;
  readonly contentDirectoryIdentity: string;
  readonly recoveryDirectoryIdentity: string;
  readonly rootRelationship: "identity_disjoint";
  readonly authority: VolumeLocalRecoveryAuthorityV2;
  readonly grantRevision: string;
  readonly ownershipMarkerChecksum: string;
  readonly aclModeQualification: "qualified";
  readonly atomicRenameQualification: "qualified";
  readonly directoryDurabilityQualification: "qualified";
  readonly storageLabel: string;
  readonly capacityBytes: number;
  readonly reservedBytes: number;
  readonly retentionDays: number;
  readonly observedAt: string;
  readonly evidenceChecksum: string;
}

export interface VolumeLocalRecoveryBindingV2 extends Omit<
  VolumeLocalRecoveryBindingEvidenceV2,
  "evidenceChecksum"
> {
  readonly bindingChecksum: string;
}

export type VolumeLocalRecoveryEvidenceAuthenticatorV2 = (
  evidence: VolumeLocalRecoveryBindingEvidenceV2
) => Result<void, UnifiedError>;

export interface IssueVolumeLocalRecoveryBindingV2Options {
  readonly authenticateEvidence: VolumeLocalRecoveryEvidenceAuthenticatorV2;
  readonly minimumFreeBytes?: number;
  readonly traceId?: string;
}

/**
 * Converts Main-authenticated native evidence into an immutable volume-local recovery authority.
 * Paths and handles are intentionally absent from both evidence and binding.
 */
export function issueVolumeLocalRecoveryBindingV2(
  value: unknown,
  options: IssueVolumeLocalRecoveryBindingV2Options
): Result<VolumeLocalRecoveryBindingV2, UnifiedError> {
  const traceId = options.traceId ?? "volume-local-recovery-binding-v2";
  const evidence = validateVolumeLocalRecoveryBindingEvidenceV2(value, traceId);
  if (!evidence.ok) return evidence;
  let authenticated: Result<void, UnifiedError>;
  try {
    authenticated = options.authenticateEvidence(evidence.value);
  } catch {
    return unavailable("ENGINEERING_RECOVERY_BINDING_EVIDENCE_UNAVAILABLE", traceId);
  }
  if (!authenticated.ok) return authenticated;

  const minimumFreeBytes = options.minimumFreeBytes ?? 1;
  if (!Number.isSafeInteger(minimumFreeBytes) || minimumFreeBytes < 1) {
    return invalid("ENGINEERING_RECOVERY_BINDING_OPTIONS_INVALID", traceId);
  }
  if (evidence.value.capacityBytes - evidence.value.reservedBytes < minimumFreeBytes) {
    return unavailable("ENGINEERING_RECOVERY_BINDING_CAPACITY_UNAVAILABLE", traceId);
  }

  const unsigned = withoutKey(
    evidence.value as unknown as Record<string, unknown>,
    "evidenceChecksum"
  );
  return ok(
    freeze({
      ...unsigned,
      bindingChecksum: sha256EngineeringMutationTextV2(
        canonicalizeEngineeringMutationV2Json(unsigned)
      )
    }) as VolumeLocalRecoveryBindingV2
  );
}

export function validateVolumeLocalRecoveryBindingEvidenceV2(
  value: unknown,
  traceId = "volume-local-recovery-binding-v2"
): Result<VolumeLocalRecoveryBindingEvidenceV2, UnifiedError> {
  if (!hasExactKeys(value, evidenceKeys)) {
    return invalid("ENGINEERING_RECOVERY_BINDING_EVIDENCE_INVALID", traceId);
  }
  if (
    value["schemaVersion"] !== ENGINEERING_MUTATION_V2_SCHEMA_VERSION ||
    !isStableId(value["recoveryRootBindingId"]) ||
    !isStableId(value["contentRootBindingId"]) ||
    !isStableId(value["recoveryRootId"]) ||
    !isStableId(value["contentVolumeIdentity"]) ||
    !isStableId(value["recoveryVolumeIdentity"]) ||
    !isStableId(value["contentDirectoryIdentity"]) ||
    !isStableId(value["recoveryDirectoryIdentity"]) ||
    value["rootRelationship"] !== "identity_disjoint" ||
    !isAuthority(value["authority"]) ||
    !isStableId(value["grantRevision"]) ||
    !isSha256(value["ownershipMarkerChecksum"]) ||
    value["aclModeQualification"] !== "qualified" ||
    value["atomicRenameQualification"] !== "qualified" ||
    value["directoryDurabilityQualification"] !== "qualified" ||
    !isStorageLabel(value["storageLabel"]) ||
    !isNonNegativeSafeInteger(value["capacityBytes"]) ||
    !isNonNegativeSafeInteger(value["reservedBytes"]) ||
    !isRetentionDays(value["retentionDays"]) ||
    !isCanonicalUtcTimestamp(value["observedAt"]) ||
    !isSha256(value["evidenceChecksum"])
  ) {
    return invalid("ENGINEERING_RECOVERY_BINDING_EVIDENCE_INVALID", traceId);
  }
  if (
    value["contentVolumeIdentity"] !== value["recoveryVolumeIdentity"] ||
    value["contentDirectoryIdentity"] === value["recoveryDirectoryIdentity"] ||
    value["reservedBytes"] > value["capacityBytes"]
  ) {
    return unavailable("ENGINEERING_RECOVERY_BINDING_QUALIFICATION_FAILED", traceId);
  }
  const expectedChecksum = sha256EngineeringMutationTextV2(
    canonicalizeEngineeringMutationV2Json(withoutKey(value, "evidenceChecksum"))
  );
  if (value["evidenceChecksum"] !== expectedChecksum) {
    return unavailable("ENGINEERING_RECOVERY_BINDING_AUTHENTICATION_FAILED", traceId);
  }
  return ok(freeze({ ...value }) as unknown as VolumeLocalRecoveryBindingEvidenceV2);
}

export function validateVolumeLocalRecoveryBindingV2(
  value: unknown,
  traceId = "volume-local-recovery-binding-v2"
): Result<VolumeLocalRecoveryBindingV2, UnifiedError> {
  if (!hasExactKeys(value, bindingKeys)) {
    return invalid("ENGINEERING_RECOVERY_BINDING_INVALID", traceId);
  }
  const unsigned = withoutKey(value, "bindingChecksum");
  const evidence = {
    ...unsigned,
    evidenceChecksum: sha256EngineeringMutationTextV2(
      canonicalizeEngineeringMutationV2Json(unsigned)
    )
  };
  const validated = validateVolumeLocalRecoveryBindingEvidenceV2(evidence, traceId);
  if (!validated.ok) return validated;
  const expected = sha256EngineeringMutationTextV2(canonicalizeEngineeringMutationV2Json(unsigned));
  if (value["bindingChecksum"] !== expected) {
    return unavailable("ENGINEERING_RECOVERY_BINDING_AUTHENTICATION_FAILED", traceId);
  }
  return ok(freeze({ ...value }) as unknown as VolumeLocalRecoveryBindingV2);
}

export function volumeLocalRecoverySideEffectChecksumV2(input: {
  readonly binding: VolumeLocalRecoveryBindingV2;
  readonly transactionId: string;
  readonly operationId: string;
  readonly recoveryObjectId: string;
  readonly relativeIdentity: string;
  readonly sourceSha256: string;
}): string {
  const binding = validateVolumeLocalRecoveryBindingV2(input.binding);
  if (
    !binding.ok ||
    !isStableId(input.transactionId) ||
    !isOperationId(input.operationId) ||
    !isStableId(input.recoveryObjectId) ||
    !isCanonicalRelativeIdentity(input.relativeIdentity) ||
    !isSha256(input.sourceSha256)
  ) {
    throw new Error("ENGINEERING_RECOVERY_SIDE_EFFECT_INVALID");
  }
  return sha256EngineeringMutationTextV2(
    canonicalizeEngineeringMutationV2Json({
      schemaVersion: ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
      recoveryRootBindingId: binding.value.recoveryRootBindingId,
      contentRootBindingId: binding.value.contentRootBindingId,
      grantRevision: binding.value.grantRevision,
      bindingChecksum: binding.value.bindingChecksum,
      transactionId: input.transactionId,
      operationId: input.operationId,
      recoveryObjectId: input.recoveryObjectId,
      relativeIdentity: input.relativeIdentity,
      sourceSha256: input.sourceSha256
    })
  );
}

function isAuthority(value: unknown): value is VolumeLocalRecoveryAuthorityV2 {
  return (
    value === "app_state_root" ||
    value === "installer_managed" ||
    value === "user_os_directory_grant"
  );
}

function isStorageLabel(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 128 &&
    value.trim() === value &&
    !/[\\/:\0\r\n]/u.test(value)
  );
}

function isRetentionDays(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= 3650;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
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

function invalid<T = never>(code: string, traceId: string): Result<T, UnifiedError> {
  return err(
    validationError({
      code,
      message: "Volume-local recovery binding evidence is invalid.",
      suggestedAction: "Use fresh Main-authenticated recovery-root evidence.",
      traceId
    })
  );
}

function unavailable<T = never>(code: string, traceId: string): Result<T, UnifiedError> {
  return err(
    storageError({
      code,
      message: "Volume-local recovery storage is unavailable.",
      suggestedAction: "Keep delete disabled and requalify the recovery storage authority.",
      traceId
    })
  );
}

const evidenceKeys = [
  "aclModeQualification",
  "atomicRenameQualification",
  "authority",
  "capacityBytes",
  "contentDirectoryIdentity",
  "contentRootBindingId",
  "contentVolumeIdentity",
  "directoryDurabilityQualification",
  "evidenceChecksum",
  "grantRevision",
  "observedAt",
  "ownershipMarkerChecksum",
  "recoveryDirectoryIdentity",
  "recoveryRootBindingId",
  "recoveryRootId",
  "recoveryVolumeIdentity",
  "reservedBytes",
  "retentionDays",
  "rootRelationship",
  "schemaVersion",
  "storageLabel"
] as const;

const bindingKeys = [
  ...evidenceKeys.filter((key) => key !== "evidenceChecksum"),
  "bindingChecksum"
] as const;
