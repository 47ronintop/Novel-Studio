import { createHash } from "node:crypto";

/**
 * Main-owned qualification contract for the four creative_general file mutations.
 *
 * The approval surface is a shared prerequisite, but it is not evidence that a
 * particular creative backend is safe to expose.  Keeping one attestation per
 * operation lets the runtime fail closed independently when an operation's
 * packaged evidence is missing, stale, or revoked.
 */
export const CREATIVE_FILE_OPERATION_QUALIFICATION_VERSION = "1.0" as const;
export const CREATIVE_FILE_OPERATION_QUALIFICATION_AUTHORITY =
  "desktop_main_creative_file_operation_qualification" as const;
export const CREATIVE_FILE_OPERATION_BACKEND_ID = "trusted_creative_file_operations" as const;
export const CREATIVE_FILE_OPERATIONS = Object.freeze([
  "replace_file",
  "create_file",
  "move_file",
  "delete_file",
  "create_directory"
] as const);

export type CreativeFileOperation = (typeof CREATIVE_FILE_OPERATIONS)[number];
export type CreativeFileOperationQualificationFailureReason =
  | "unsupported_platform"
  | "evidence_missing"
  | "evidence_unknown"
  | "evidence_stale"
  | "backend_unavailable"
  | "probe_failed";

export interface CreativeFileOperationQualificationV1 {
  readonly schemaVersion: typeof CREATIVE_FILE_OPERATION_QUALIFICATION_VERSION;
  readonly authority: typeof CREATIVE_FILE_OPERATION_QUALIFICATION_AUTHORITY;
  readonly backendId: typeof CREATIVE_FILE_OPERATION_BACKEND_ID;
  readonly operation: CreativeFileOperation;
  readonly packageKind: "development" | "production" | "unsigned-beta";
  readonly status: "qualified" | "unavailable";
  readonly productionQualified: boolean;
  /** Digest of the Main-owned, package-bound operation evidence. */
  readonly evidenceChecksum: string | null;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly failureReasons: readonly CreativeFileOperationQualificationFailureReason[];
  /** SHA-256 of the canonical attestation with this field omitted. */
  readonly attestationChecksum: string;
}

export interface CreativeFileOperationCandidateEvidence {
  readonly status: "qualified" | "unavailable";
  readonly evidenceChecksum?: string;
  readonly issuedAt?: string;
  readonly expiresAt?: string;
  readonly failureReasons?: readonly CreativeFileOperationQualificationFailureReason[];
}

export interface CreativeFileOperationCandidateInspector {
  inspect(operation: CreativeFileOperation): Promise<CreativeFileOperationCandidateEvidence>;
}

export interface CreativeFileOperationQualificationService {
  /** One-shot, Main-owned observations. Renderer/IPC/model input cannot refresh them. */
  readAttestation(operation: CreativeFileOperation): Promise<CreativeFileOperationQualificationV1>;
  readAll(): Promise<Readonly<Record<CreativeFileOperation, CreativeFileOperationQualificationV1>>>;
}

const MAIN_OWNED = new WeakSet<object>();
const HASH = /^[a-f0-9]{64}$/u;
const CANONICAL_UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MAX_QUALIFICATION_VALIDITY_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Creates the Main-owned observation service.  Until a packaged evidence
 * reader is supplied, the default inspector deliberately reports missing
 * evidence; this prevents the presence of the approval port from opening any
 * creative mutation in production.
 */
export function createCreativeFileOperationQualificationService(options?: {
  readonly packageKind?: "development" | "production" | "unsigned-beta";
  readonly now?: () => string;
  readonly candidateInspector?: CreativeFileOperationCandidateInspector;
}): CreativeFileOperationQualificationService {
  const packageKind = options?.packageKind ?? "development";
  const now = options?.now ?? (() => new Date().toISOString());
  const inspector = options?.candidateInspector ?? createUnavailableCandidateInspector();
  const cached = new Map<CreativeFileOperation, Promise<CreativeFileOperationQualificationV1>>();

  const readAttestation = (operation: CreativeFileOperation) => {
    const existing = cached.get(operation);
    if (existing !== undefined) return existing;
    const result = observeCandidate({ operation, packageKind, checkedAt: now(), inspector }).then(
      registerMainOwned
    );
    cached.set(operation, result);
    return result;
  };

  return Object.freeze({
    readAttestation,
    async readAll() {
      const entries = await Promise.all(
        CREATIVE_FILE_OPERATIONS.map(
          async (operation) => [operation, await readAttestation(operation)] as const
        )
      );
      return Object.freeze(
        Object.fromEntries(entries) as Record<
          CreativeFileOperation,
          CreativeFileOperationQualificationV1
        >
      );
    }
  });
}

/** Main-only provenance check; a serialized or forged attestation is inert. */
export function isMainOwnedCreativeFileOperationQualification(
  value: unknown
): value is CreativeFileOperationQualificationV1 {
  return (
    value !== null &&
    typeof value === "object" &&
    MAIN_OWNED.has(value) &&
    validateCreativeFileOperationQualification(value)
  );
}

export function hasMainOwnedCreativeFileOperationQualification(
  value: unknown,
  operation: CreativeFileOperation,
  now: string = new Date().toISOString()
): value is CreativeFileOperationQualificationV1 {
  if (!isMainOwnedCreativeFileOperationQualification(value) || value.operation !== operation) {
    return false;
  }
  const observedAt = Date.parse(now);
  const issuedAt = Date.parse(value.issuedAt);
  const expiresAt = Date.parse(value.expiresAt);
  return (
    value.status === "qualified" &&
    value.productionQualified &&
    value.packageKind === "production" &&
    Number.isFinite(observedAt) &&
    Number.isFinite(issuedAt) &&
    Number.isFinite(expiresAt) &&
    issuedAt <= observedAt &&
    observedAt < expiresAt
  );
}

export function hasMainOwnedUnsignedBetaCreativeFileOperationQualification(
  value: unknown,
  operation: CreativeFileOperation,
  now: string = new Date().toISOString()
): value is CreativeFileOperationQualificationV1 {
  if (!isMainOwnedCreativeFileOperationQualification(value) || value.operation !== operation) {
    return false;
  }
  const observedAt = Date.parse(now);
  return (
    value.status === "qualified" &&
    value.packageKind === "unsigned-beta" &&
    !value.productionQualified &&
    Number.isFinite(observedAt) &&
    Date.parse(value.issuedAt) <= observedAt &&
    observedAt < Date.parse(value.expiresAt)
  );
}

export function creativeFileOperationQualificationRevision(value: unknown): string {
  return isMainOwnedCreativeFileOperationQualification(value)
    ? value.attestationChecksum
    : "unavailable";
}

export function validateCreativeFileOperationQualification(
  value: unknown
): value is CreativeFileOperationQualificationV1 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (!hasExactKeys(record, ATTESTATION_KEYS)) return false;
  if (
    record.schemaVersion !== CREATIVE_FILE_OPERATION_QUALIFICATION_VERSION ||
    record.authority !== CREATIVE_FILE_OPERATION_QUALIFICATION_AUTHORITY ||
    record.backendId !== CREATIVE_FILE_OPERATION_BACKEND_ID ||
    !isCreativeFileOperation(record.operation) ||
    (record.packageKind !== "development" &&
      record.packageKind !== "production" &&
      record.packageKind !== "unsigned-beta") ||
    (record.status !== "qualified" && record.status !== "unavailable") ||
    typeof record.productionQualified !== "boolean" ||
    !isHashOrNull(record.evidenceChecksum) ||
    !isCanonicalUtcTimestamp(record.issuedAt) ||
    !isCanonicalUtcTimestamp(record.expiresAt) ||
    !isCanonicalFailureReasons(record.failureReasons) ||
    !isHash(record.attestationChecksum)
  ) {
    return false;
  }
  if (
    record.status === "qualified" &&
    Date.parse(record.expiresAt as string) <= Date.parse(record.issuedAt as string)
  ) {
    return false;
  }
  if (
    Date.parse(record.expiresAt as string) - Date.parse(record.issuedAt as string) >
    MAX_QUALIFICATION_VALIDITY_MS
  ) {
    return false;
  }
  const unsigned = withoutKey(record, "attestationChecksum");
  if (record.attestationChecksum !== sha256(stableSerialize(unsigned))) return false;
  if (record.status === "unavailable") {
    return (
      record.productionQualified === false &&
      record.evidenceChecksum === null &&
      (record.failureReasons as readonly unknown[]).length > 0
    );
  }
  return (
    ((record.packageKind === "production" && record.productionQualified === true) ||
      (record.packageKind === "unsigned-beta" && record.productionQualified === false)) &&
    record.evidenceChecksum !== null &&
    (record.failureReasons as readonly unknown[]).length === 0
  );
}

async function observeCandidate(input: {
  readonly operation: CreativeFileOperation;
  readonly packageKind: "development" | "production" | "unsigned-beta";
  readonly checkedAt: string;
  readonly inspector: CreativeFileOperationCandidateInspector;
}): Promise<CreativeFileOperationQualificationV1> {
  if (!isCanonicalUtcTimestamp(input.checkedAt)) {
    return createUnavailable(input.operation, input.packageKind, input.checkedAt, [
      "evidence_unknown"
    ]);
  }
  let candidate: CreativeFileOperationCandidateEvidence;
  try {
    candidate = await input.inspector.inspect(input.operation);
  } catch {
    return createUnavailable(input.operation, input.packageKind, input.checkedAt, ["probe_failed"]);
  }
  if (candidate.status !== "qualified" || input.packageKind === "development") {
    return createUnavailable(
      input.operation,
      input.packageKind,
      input.checkedAt,
      candidate.failureReasons ?? [
        input.packageKind === "production" ? "evidence_missing" : "backend_unavailable"
      ]
    );
  }
  if (candidate.failureReasons !== undefined && candidate.failureReasons.length > 0) {
    return createUnavailable(input.operation, input.packageKind, input.checkedAt, [
      ...candidate.failureReasons
    ]);
  }
  if (
    !isHash(candidate.evidenceChecksum) ||
    !isCanonicalUtcTimestamp(candidate.issuedAt) ||
    !isCanonicalUtcTimestamp(candidate.expiresAt)
  ) {
    return createUnavailable(input.operation, input.packageKind, input.checkedAt, [
      "evidence_unknown"
    ]);
  }
  const issuedAt = Date.parse(candidate.issuedAt);
  const expiresAt = Date.parse(candidate.expiresAt);
  const observedAt = Date.parse(input.checkedAt);
  if (
    issuedAt > observedAt ||
    observedAt >= expiresAt ||
    expiresAt - issuedAt > MAX_QUALIFICATION_VALIDITY_MS
  ) {
    return createUnavailable(input.operation, input.packageKind, input.checkedAt, [
      "evidence_stale"
    ]);
  }
  const unsigned = {
    schemaVersion: CREATIVE_FILE_OPERATION_QUALIFICATION_VERSION,
    authority: CREATIVE_FILE_OPERATION_QUALIFICATION_AUTHORITY,
    backendId: CREATIVE_FILE_OPERATION_BACKEND_ID,
    operation: input.operation,
    packageKind: input.packageKind,
    status: "qualified" as const,
    productionQualified: input.packageKind === "production",
    evidenceChecksum: candidate.evidenceChecksum,
    issuedAt: candidate.issuedAt,
    expiresAt: candidate.expiresAt,
    failureReasons: [] as const
  };
  return freezeAttestation({
    ...unsigned,
    attestationChecksum: sha256(stableSerialize(unsigned))
  });
}

function createUnavailable(
  operation: CreativeFileOperation,
  packageKind: "development" | "production" | "unsigned-beta",
  checkedAt: string,
  failureReasons: readonly CreativeFileOperationQualificationFailureReason[]
): CreativeFileOperationQualificationV1 {
  const normalized = [...new Set(failureReasons)].sort();
  const unsigned = {
    schemaVersion: CREATIVE_FILE_OPERATION_QUALIFICATION_VERSION,
    authority: CREATIVE_FILE_OPERATION_QUALIFICATION_AUTHORITY,
    backendId: CREATIVE_FILE_OPERATION_BACKEND_ID,
    operation,
    packageKind,
    status: "unavailable" as const,
    productionQualified: false,
    evidenceChecksum: null,
    issuedAt: checkedAt,
    expiresAt: checkedAt,
    failureReasons: normalized
  };
  return freezeAttestation({
    ...unsigned,
    attestationChecksum: sha256(stableSerialize(unsigned))
  });
}

function createUnavailableCandidateInspector(): CreativeFileOperationCandidateInspector {
  return Object.freeze({
    async inspect(): Promise<CreativeFileOperationCandidateEvidence> {
      return { status: "unavailable", failureReasons: ["evidence_missing"] as const };
    }
  });
}

function registerMainOwned(
  value: CreativeFileOperationQualificationV1
): CreativeFileOperationQualificationV1 {
  MAIN_OWNED.add(value);
  return value;
}

function freezeAttestation(
  value: CreativeFileOperationQualificationV1
): CreativeFileOperationQualificationV1 {
  return Object.freeze({ ...value, failureReasons: Object.freeze([...value.failureReasons]) });
}

function isCreativeFileOperation(value: unknown): value is CreativeFileOperation {
  return (
    typeof value === "string" && (CREATIVE_FILE_OPERATIONS as readonly string[]).includes(value)
  );
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && HASH.test(value);
}

function isHashOrNull(value: unknown): value is string | null {
  return value === null || isHash(value);
}

function isCanonicalUtcTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !CANONICAL_UTC_TIMESTAMP.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function isCanonicalFailureReasons(
  value: unknown
): value is readonly CreativeFileOperationQualificationFailureReason[] {
  if (!Array.isArray(value)) return false;
  const allowed = new Set<CreativeFileOperationQualificationFailureReason>([
    "unsupported_platform",
    "evidence_missing",
    "evidence_unknown",
    "evidence_stale",
    "backend_unavailable",
    "probe_failed"
  ]);
  if (!value.every((reason) => typeof reason === "string" && allowed.has(reason as never))) {
    return false;
  }
  const sorted = [...new Set(value)].sort();
  return sorted.length === value.length && sorted.every((reason, index) => reason === value[index]);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  return actual.length === required.length && actual.every((key, index) => key === required[index]);
}

function withoutKey(value: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
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
  if (serialized === undefined) throw new Error("CREATIVE_QUALIFICATION_NOT_SERIALIZABLE");
  return serialized;
}

const ATTESTATION_KEYS = [
  "schemaVersion",
  "authority",
  "backendId",
  "operation",
  "packageKind",
  "status",
  "productionQualified",
  "evidenceChecksum",
  "issuedAt",
  "expiresAt",
  "failureReasons",
  "attestationChecksum"
] as const;
