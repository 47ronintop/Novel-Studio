import { createHash } from "node:crypto";

export const ENGINEERING_FILE_CONTRACT_VERSION = "1.0" as const;
export const ENGINEERING_FILE_QUALIFICATION_VERSION = "1.0" as const;
export const ENGINEERING_FILE_PROBE_CONTRACT_VERSION = "1.0" as const;
export const ENGINEERING_FILE_NATIVE_ADAPTER_ID = "novel_studio_engineering_file_access" as const;
export const ENGINEERING_FILE_PROBE_MAX_LIFETIME_MS = 60 * 60 * 1000;

export const ENGINEERING_FILE_SUPPORTED_TARGETS = Object.freeze(["win32-x64"] as const);

export const ENGINEERING_FILE_POSITIVE_PROTECTIONS = Object.freeze([
  "rootRelativeTraversal",
  "noFollowTraversal",
  "rawByteIdentity",
  "receiptBinding",
  "durability",
  "recoveryRootBinding"
] as const);

export const ENGINEERING_FILE_NEGATIVE_CONTROLS = Object.freeze([
  "rootRelativeDisabled",
  "noFollowDisabled",
  "rawByteIdentityDisabled",
  "receiptBindingDisabled",
  "durabilityDisabled",
  "recoveryRootBindingDisabled"
] as const);

export type EngineeringFileSupportedTarget = (typeof ENGINEERING_FILE_SUPPORTED_TARGETS)[number];
export type EngineeringFileQualificationCapability = "root" | "access" | "mutation" | "recovery";

export type EngineeringFileQualificationFailureReason =
  | "unsupported_platform"
  | "host_missing"
  | "host_partial"
  | "evidence_unknown"
  | "evidence_stale"
  | "digest_missing"
  | "digest_mismatch"
  | "signature_missing"
  | "signature_mismatch"
  | "positive_probe_failed"
  | "negative_control_failed"
  | "probe_contract_mismatch"
  | "probe_error"
  | "candidate_unqualified"
  | "adapter_not_implemented_batch_0";

export interface EngineeringWorkspaceRootBindingV1 {
  readonly schemaVersion: typeof ENGINEERING_FILE_CONTRACT_VERSION;
  readonly rootBindingId: string;
  readonly workspaceId: string;
  readonly workspaceKind: "engineeringWorkspace";
  readonly volumeIdentity: string;
  readonly directoryIdentity: string;
  readonly canonicalPathIdentityChecksum: string;
  readonly pathPolicyRevision: string;
  readonly issuedAt: string;
}

export interface EngineeringRecoveryRootBindingV1 {
  readonly schemaVersion: typeof ENGINEERING_FILE_CONTRACT_VERSION;
  readonly recoveryRootBindingId: string;
  readonly contentRootBindingId: string;
  readonly grantRevision: string;
  readonly volumeIdentity: string;
  readonly directoryIdentity: string;
  readonly sideEffectChecksum: string;
  readonly issuedAt: string;
}

export interface EngineeringRawByteBlobV1 {
  readonly schemaVersion: typeof ENGINEERING_FILE_CONTRACT_VERSION;
  readonly blobId: string;
  readonly storage: "main_owned_immutable_blob";
  readonly byteLength: number;
  readonly sha256: string;
  readonly encoding: "utf-8";
  readonly bom: "none" | "utf-8";
  readonly eol: "none" | "lf" | "crlf" | "mixed";
}

export interface EngineeringFileMutationReceiptV1 {
  readonly schemaVersion: typeof ENGINEERING_FILE_CONTRACT_VERSION;
  readonly transactionId: string;
  readonly operationId: string;
  readonly contentRootBindingId: string;
  readonly recoveryRootBindingId: string | null;
  readonly relativeIdentity: string;
  readonly observedBeforeSha256: string | null;
  readonly observedAfterSha256: string | null;
  readonly recoveryObjectId: string | null;
  readonly durability: "data_and_directory_flushed";
  readonly nativeReceiptChecksum: string;
}

export interface EngineeringFileProbeReportV1 {
  readonly schemaVersion: typeof ENGINEERING_FILE_PROBE_CONTRACT_VERSION;
  readonly adapterId: typeof ENGINEERING_FILE_NATIVE_ADAPTER_ID;
  readonly target: EngineeringFileSupportedTarget;
  readonly packageKind: "production";
  readonly artifactSha256: string;
  readonly artifactManifestSha256: string;
  readonly artifactManifestSignatureSha256: string;
  readonly artifactSignatureVerification: "trusted_publisher";
  readonly manifestSignatureVerification: "trusted_publisher";
  readonly digestVerification: "match";
  readonly publisherPolicyChecksum: string;
  readonly generatedAt: string;
  readonly expiresAt: string;
  readonly positiveProtections: Readonly<
    Record<(typeof ENGINEERING_FILE_POSITIVE_PROTECTIONS)[number], "passed">
  >;
  readonly negativeControls: Readonly<
    Record<(typeof ENGINEERING_FILE_NEGATIVE_CONTROLS)[number], "canary_exposed">
  >;
  readonly reportChecksum: string;
}

/**
 * Serializable qualification evidence. Its checksum detects corruption; it is not an
 * authentication primitive. Only a Main-owned in-memory qualification issuer may use a validated
 * instance to grant capability.
 */
export interface EngineeringFileQualificationAttestationV1 {
  readonly schemaVersion: typeof ENGINEERING_FILE_QUALIFICATION_VERSION;
  readonly authority: "desktop_main_engineering_file_access_qualification";
  readonly adapterId: typeof ENGINEERING_FILE_NATIVE_ADAPTER_ID;
  readonly target: string;
  readonly packageKind: "development" | "production";
  readonly status: "available" | "unavailable";
  readonly productionQualified: boolean;
  readonly candidateArtifactPresent: boolean;
  readonly capabilities: Readonly<
    Record<EngineeringFileQualificationCapability, "available" | "unavailable">
  >;
  readonly artifactSha256: string | null;
  readonly artifactManifestSha256: string | null;
  readonly probeReportChecksum: string | null;
  /** Available Main-issued evidence expires with its fresh packaged probe; unavailable is null. */
  readonly expiresAt: string | null;
  readonly failureReasons: readonly EngineeringFileQualificationFailureReason[];
  readonly checkedAt: string;
  readonly attestationChecksum: string;
}

export interface EngineeringFileProbeValidationResult {
  readonly valid: boolean;
  readonly failureReasons: readonly EngineeringFileQualificationFailureReason[];
}

export function validateEngineeringFileProbeReport(
  value: unknown,
  checkedAt: string
): EngineeringFileProbeValidationResult {
  const reasons = new Set<EngineeringFileQualificationFailureReason>();
  if (!isPlainRecordWithExactKeys(value, probeReportKeys)) {
    return frozenProbeResult(["probe_contract_mismatch"]);
  }
  if (
    value["schemaVersion"] !== ENGINEERING_FILE_PROBE_CONTRACT_VERSION ||
    value["adapterId"] !== ENGINEERING_FILE_NATIVE_ADAPTER_ID ||
    !isEngineeringFileSupportedTarget(value["target"]) ||
    value["packageKind"] !== "production"
  ) {
    reasons.add("probe_contract_mismatch");
  }
  if (
    !isSha256(value["artifactSha256"]) ||
    !isSha256(value["artifactManifestSha256"]) ||
    !isSha256(value["artifactManifestSignatureSha256"]) ||
    !isSha256(value["publisherPolicyChecksum"])
  ) {
    reasons.add("digest_missing");
  }
  if (value["digestVerification"] !== "match") reasons.add("digest_mismatch");
  if (
    value["artifactSignatureVerification"] !== "trusted_publisher" ||
    value["manifestSignatureVerification"] !== "trusted_publisher"
  ) {
    reasons.add("signature_mismatch");
  }

  if (
    !isCanonicalUtcTimestamp(value["generatedAt"]) ||
    !isCanonicalUtcTimestamp(value["expiresAt"]) ||
    !isCanonicalUtcTimestamp(checkedAt)
  ) {
    reasons.add("probe_contract_mismatch");
  } else {
    const generatedAt = Date.parse(value["generatedAt"]);
    const expiresAt = Date.parse(value["expiresAt"]);
    const observedAt = Date.parse(checkedAt);
    if (
      generatedAt > observedAt ||
      observedAt >= expiresAt ||
      expiresAt <= generatedAt ||
      expiresAt - generatedAt > ENGINEERING_FILE_PROBE_MAX_LIFETIME_MS
    ) {
      reasons.add("evidence_stale");
    }
  }
  if (
    !hasExactStatusMap(
      value["positiveProtections"],
      ENGINEERING_FILE_POSITIVE_PROTECTIONS,
      "passed"
    )
  ) {
    reasons.add("positive_probe_failed");
  }
  if (
    !hasExactStatusMap(
      value["negativeControls"],
      ENGINEERING_FILE_NEGATIVE_CONTROLS,
      "canary_exposed"
    )
  ) {
    reasons.add("negative_control_failed");
  }
  if (isSha256(value["reportChecksum"])) {
    const unsigned = withoutKey(value, "reportChecksum");
    if (value["reportChecksum"] !== sha256(stableSerialize(unsigned))) {
      reasons.add("digest_mismatch");
    }
  } else {
    reasons.add("digest_missing");
  }
  return frozenProbeResult([...reasons]);
}

export function engineeringFileProbeReportChecksum(
  value: Omit<EngineeringFileProbeReportV1, "reportChecksum">
): string {
  return sha256(stableSerialize(value));
}

export function createUnavailableEngineeringFileQualificationAttestation(input: {
  readonly target: string;
  readonly packageKind: "development" | "production";
  readonly candidateArtifactPresent: boolean;
  readonly failureReasons: readonly EngineeringFileQualificationFailureReason[];
  readonly checkedAt: string;
}): EngineeringFileQualificationAttestationV1 {
  const failureReasons = [...new Set(input.failureReasons)].sort();
  if (
    failureReasons.length === 0 ||
    !isCanonicalUtcTimestamp(input.checkedAt) ||
    (isEngineeringFileSupportedTarget(input.target) &&
      failureReasons.includes("unsupported_platform")) ||
    (!isEngineeringFileSupportedTarget(input.target) &&
      !failureReasons.includes("unsupported_platform")) ||
    (input.candidateArtifactPresent &&
      !failureReasons.some(
        (reason) => reason === "host_partial" || reason === "candidate_unqualified"
      ))
  ) {
    throw new Error("ENGINEERING_FILE_QUALIFICATION_INVALID");
  }
  const unsigned = {
    schemaVersion: ENGINEERING_FILE_QUALIFICATION_VERSION,
    authority: "desktop_main_engineering_file_access_qualification" as const,
    adapterId: ENGINEERING_FILE_NATIVE_ADAPTER_ID,
    target: input.target,
    packageKind: input.packageKind,
    status: "unavailable" as const,
    productionQualified: false,
    candidateArtifactPresent: input.candidateArtifactPresent,
    capabilities: {
      root: "unavailable" as const,
      access: "unavailable" as const,
      mutation: "unavailable" as const,
      recovery: "unavailable" as const
    },
    artifactSha256: null,
    artifactManifestSha256: null,
    probeReportChecksum: null,
    expiresAt: null,
    failureReasons,
    checkedAt: input.checkedAt
  };
  return deepFreeze({
    ...unsigned,
    attestationChecksum: engineeringFileQualificationAttestationChecksum(unsigned)
  });
}

/** Deterministic identity only. This checksum never authorizes an engineering capability. */
export function engineeringFileQualificationAttestationChecksum(
  value: Omit<EngineeringFileQualificationAttestationV1, "attestationChecksum">
): string {
  return sha256(stableSerialize(value));
}

/** Validates the serializable shape and cross-invariants, not its Main-owned provenance. */
export function validateEngineeringFileQualificationAttestation(
  value: unknown
): value is EngineeringFileQualificationAttestationV1 {
  if (!isPlainRecordWithExactKeys(value, attestationKeys)) return false;
  const capabilities = value["capabilities"];
  const failureReasons = value["failureReasons"];
  if (
    value["schemaVersion"] !== ENGINEERING_FILE_QUALIFICATION_VERSION ||
    value["authority"] !== "desktop_main_engineering_file_access_qualification" ||
    value["adapterId"] !== ENGINEERING_FILE_NATIVE_ADAPTER_ID ||
    typeof value["target"] !== "string" ||
    value["target"].length === 0 ||
    (value["packageKind"] !== "development" && value["packageKind"] !== "production") ||
    (value["status"] !== "available" && value["status"] !== "unavailable") ||
    typeof value["productionQualified"] !== "boolean" ||
    typeof value["candidateArtifactPresent"] !== "boolean" ||
    !isPlainRecordWithExactKeys(capabilities, qualificationCapabilityKeys) ||
    !qualificationCapabilityKeys.every(
      (key) => capabilities[key] === "available" || capabilities[key] === "unavailable"
    ) ||
    !isCanonicalFailureReasonList(failureReasons) ||
    !isCanonicalUtcTimestamp(value["checkedAt"]) ||
    (value["expiresAt"] !== null && !isCanonicalUtcTimestamp(value["expiresAt"])) ||
    !isSha256(value["attestationChecksum"])
  ) {
    return false;
  }
  const unsigned = withoutKey(value, "attestationChecksum");
  if (value["attestationChecksum"] !== sha256(stableSerialize(unsigned))) return false;

  if (value["status"] === "unavailable") {
    return (
      value["productionQualified"] === false &&
      qualificationCapabilityKeys.every((key) => capabilities[key] === "unavailable") &&
      value["artifactSha256"] === null &&
      value["artifactManifestSha256"] === null &&
      value["probeReportChecksum"] === null &&
      value["expiresAt"] === null &&
      failureReasons.length > 0 &&
      (isEngineeringFileSupportedTarget(value["target"])
        ? !failureReasons.includes("unsupported_platform")
        : failureReasons.includes("unsupported_platform")) &&
      (!value["candidateArtifactPresent"] ||
        failureReasons.some(
          (reason) => reason === "host_partial" || reason === "candidate_unqualified"
        ))
    );
  }

  return (
    value["packageKind"] === "production" &&
    value["productionQualified"] === true &&
    value["candidateArtifactPresent"] === true &&
    isEngineeringFileSupportedTarget(value["target"]) &&
    failureReasons.length === 0 &&
    capabilities["root"] === "available" &&
    capabilities["access"] === "available" &&
    (capabilities["recovery"] !== "available" || capabilities["mutation"] === "available") &&
    isSha256(value["artifactSha256"]) &&
    isSha256(value["artifactManifestSha256"]) &&
    isSha256(value["probeReportChecksum"]) &&
    typeof value["expiresAt"] === "string" &&
    Date.parse(value["expiresAt"]) > Date.parse(value["checkedAt"])
  );
}

const probeReportKeys = [
  "schemaVersion",
  "adapterId",
  "target",
  "packageKind",
  "artifactSha256",
  "artifactManifestSha256",
  "artifactManifestSignatureSha256",
  "artifactSignatureVerification",
  "manifestSignatureVerification",
  "digestVerification",
  "publisherPolicyChecksum",
  "generatedAt",
  "expiresAt",
  "positiveProtections",
  "negativeControls",
  "reportChecksum"
] as const;

const qualificationCapabilityKeys = ["root", "access", "mutation", "recovery"] as const;

const attestationKeys = [
  "schemaVersion",
  "authority",
  "adapterId",
  "target",
  "packageKind",
  "status",
  "productionQualified",
  "candidateArtifactPresent",
  "capabilities",
  "artifactSha256",
  "artifactManifestSha256",
  "probeReportChecksum",
  "expiresAt",
  "failureReasons",
  "checkedAt",
  "attestationChecksum"
] as const;

const qualificationFailureReasons = new Set<EngineeringFileQualificationFailureReason>([
  "unsupported_platform",
  "host_missing",
  "host_partial",
  "evidence_unknown",
  "evidence_stale",
  "digest_missing",
  "digest_mismatch",
  "signature_missing",
  "signature_mismatch",
  "positive_probe_failed",
  "negative_control_failed",
  "probe_contract_mismatch",
  "probe_error",
  "candidate_unqualified",
  "adapter_not_implemented_batch_0"
]);

function isEngineeringFileQualificationFailureReason(
  value: unknown
): value is EngineeringFileQualificationFailureReason {
  return qualificationFailureReasons.has(value as EngineeringFileQualificationFailureReason);
}

function isCanonicalFailureReasonList(
  value: unknown
): value is readonly EngineeringFileQualificationFailureReason[] {
  if (!Array.isArray(value) || !value.every(isEngineeringFileQualificationFailureReason)) {
    return false;
  }
  const canonical = [...new Set(value)].sort();
  return (
    canonical.length === value.length && canonical.every((reason, index) => reason === value[index])
  );
}

function isEngineeringFileSupportedTarget(value: unknown): value is EngineeringFileSupportedTarget {
  return ENGINEERING_FILE_SUPPORTED_TARGETS.some((target) => target === value);
}

function frozenProbeResult(
  failureReasons: readonly EngineeringFileQualificationFailureReason[]
): EngineeringFileProbeValidationResult {
  const unique = Object.freeze([...new Set(failureReasons)].sort());
  return Object.freeze({ valid: unique.length === 0, failureReasons: unique });
}

function hasExactStatusMap(
  value: unknown,
  keys: readonly string[],
  expectedStatus: string
): boolean {
  return (
    isPlainRecordWithExactKeys(value, keys) && keys.every((key) => value[key] === expectedStatus)
  );
}

function isPlainRecordWithExactKeys(
  value: unknown,
  expectedKeys: readonly string[]
): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function withoutKey(value: Record<string, unknown>, excludedKey: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== excludedKey));
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isCanonicalUtcTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    return false;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableSerialize(child)}`)
      .join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("ENGINEERING_FILE_CONTRACT_NOT_SERIALIZABLE");
  return serialized;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
