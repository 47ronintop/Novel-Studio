import { createHash } from "node:crypto";

export const CHAPTER_STATUS_TRANSITION_PROOF_SCHEMA_VERSION = "1.0" as const;

export type ChapterTransitionStatus =
  "draft" | "revision" | "review" | "done" | "archived" | "deleted";

export type ChapterStatusTransitionAction = "archive" | "delete" | "restore";
export type ChapterRestoreStatus = Exclude<ChapterTransitionStatus, "deleted">;

export interface ChapterNeighborRefs {
  readonly before: string | null;
  readonly after: string | null;
}

/**
 * Main-owned, immutable evidence for a chapter lifecycle transition. The checksum covers every
 * field except `proofChecksum`, so a persisted proof cannot be edited or replayed with different
 * metadata, outline placement, or reference impact.
 */
export interface ChapterStatusTransitionProof {
  readonly schemaVersion: typeof CHAPTER_STATUS_TRANSITION_PROOF_SCHEMA_VERSION;
  readonly proofId: string;
  readonly stableRef: string;
  readonly chapterId: string;
  readonly action: ChapterStatusTransitionAction;
  readonly beforeStatus: ChapterTransitionStatus;
  readonly afterStatus: ChapterTransitionStatus;
  /** Status to use when restoring this tombstone. Null for an ordinary archive transition. */
  readonly restoreStatus: ChapterRestoreStatus | null;
  readonly beforeRevision: number;
  readonly afterRevision: number;
  readonly beforeChecksum: string;
  readonly afterChecksum: string;
  readonly outlineRevision: number;
  readonly outlineChecksum: string;
  readonly originalVolumeRef: string | null;
  readonly beforeNeighborRefs: ChapterNeighborRefs;
  readonly afterNeighborRefs: ChapterNeighborRefs;
  readonly referenceImpactChecksum: string;
  readonly createdAt: string;
  readonly proofChecksum: string;
}

/** Input used to create a proof. `proofChecksum` is application-owned and is not accepted. */
export type CreateChapterStatusTransitionProofInput = Omit<
  ChapterStatusTransitionProof,
  | "schemaVersion"
  | "proofChecksum"
  | "restoreStatus"
  | "stableRef"
  | "beforeRevision"
  | "afterRevision"
  | "beforeChecksum"
  | "afterChecksum"
  | "outlineRevision"
  | "outlineChecksum"
  | "originalVolumeRef"
  | "beforeNeighborRefs"
  | "afterNeighborRefs"
> & {
  readonly schemaVersion?: typeof CHAPTER_STATUS_TRANSITION_PROOF_SCHEMA_VERSION;
  readonly stableRef?: string;
  readonly chapterRef?: string;
  readonly restoreStatus?: ChapterRestoreStatus | null;
  /** Compatibility aliases accepted at the application boundary and normalized below. */
  readonly beforeNeighborRefs?: ChapterNeighborRefs;
  readonly afterNeighborRefs?: ChapterNeighborRefs;
  readonly beforeNeighborRef?: string | null;
  readonly afterNeighborRef?: string | null;
  readonly beforeRevision?: number;
  readonly afterRevision?: number;
  readonly beforeChecksum?: string;
  readonly afterChecksum?: string;
  readonly beforeMetadataRevision?: number;
  readonly afterMetadataRevision?: number;
  readonly beforeMetadataChecksum?: string;
  readonly afterMetadataChecksum?: string;
  readonly outlineRevision?: number;
  readonly outlineChecksum?: string;
  readonly outlineAssetRevision?: number;
  readonly outlineAssetChecksum?: string;
  readonly originalVolumeId?: string | null;
  readonly originalVolumeRef?: string | null;
};

const PROOF_FIELDS = Object.freeze([
  "schemaVersion",
  "proofId",
  "stableRef",
  "chapterId",
  "action",
  "beforeStatus",
  "afterStatus",
  "restoreStatus",
  "beforeRevision",
  "afterRevision",
  "beforeChecksum",
  "afterChecksum",
  "outlineRevision",
  "outlineChecksum",
  "originalVolumeRef",
  "beforeNeighborRefs",
  "afterNeighborRefs",
  "referenceImpactChecksum",
  "createdAt",
  "proofChecksum"
] as const);

const UNSIGNED_FIELDS = PROOF_FIELDS.filter((field) => field !== "proofChecksum");
const NEIGHBOR_FIELDS = Object.freeze(["before", "after"] as const);
const CHECKSUM = /^[a-f0-9]{64}$/u;

export function createChapterStatusTransitionProof(
  input: CreateChapterStatusTransitionProofInput
): ChapterStatusTransitionProof {
  const beforeNeighborRefs = input.beforeNeighborRefs ?? {
    before: input.beforeNeighborRef ?? null,
    after: input.afterNeighborRef ?? null
  };
  const afterNeighborRefs = input.afterNeighborRefs ?? beforeNeighborRefs;
  const beforeRevision = input.beforeRevision ?? input.beforeMetadataRevision;
  const afterRevision = input.afterRevision ?? input.afterMetadataRevision;
  const beforeChecksum = input.beforeChecksum ?? input.beforeMetadataChecksum;
  const afterChecksum = input.afterChecksum ?? input.afterMetadataChecksum;
  const outlineRevision = input.outlineRevision ?? input.outlineAssetRevision;
  const outlineChecksum = input.outlineChecksum ?? input.outlineAssetChecksum;
  const stableRef = input.stableRef ?? input.chapterRef;
  const candidate = {
    schemaVersion: CHAPTER_STATUS_TRANSITION_PROOF_SCHEMA_VERSION,
    proofId: input.proofId,
    stableRef,
    chapterId: input.chapterId,
    action: input.action,
    beforeStatus: input.beforeStatus,
    afterStatus: input.afterStatus,
    restoreStatus: input.restoreStatus ?? null,
    beforeRevision,
    afterRevision,
    beforeChecksum,
    afterChecksum,
    outlineRevision,
    outlineChecksum,
    originalVolumeRef: input.originalVolumeRef ?? input.originalVolumeId ?? null,
    beforeNeighborRefs: { ...beforeNeighborRefs },
    afterNeighborRefs: { ...afterNeighborRefs },
    referenceImpactChecksum: input.referenceImpactChecksum,
    createdAt: input.createdAt,
    proofChecksum: ""
  } as unknown as ChapterStatusTransitionProof;
  validateTransition(candidate, false);
  const unsigned = withoutChecksum(candidate);
  return parseChapterStatusTransitionProof({
    ...unsigned,
    proofChecksum: checksumCanonical(unsigned)
  });
}

/** Strictly parse and authenticate a proof-shaped value. */
export function parseChapterStatusTransitionProof(
  value: unknown,
  expectedChecksum?: string
): ChapterStatusTransitionProof {
  validateTransition(value, true);
  const proof = value as ChapterStatusTransitionProof;
  const calculated = checksumCanonical(withoutChecksum(proof));
  if (
    proof.proofChecksum !== calculated ||
    (expectedChecksum !== undefined && calculated !== expectedChecksum)
  ) {
    invalid();
  }
  return deepFreeze({
    ...proof,
    beforeNeighborRefs: { ...proof.beforeNeighborRefs },
    afterNeighborRefs: { ...proof.afterNeighborRefs },
    proofChecksum: calculated
  });
}

/** Parse canonical JSON, rejecting noncanonical ordering, whitespace, and duplicate keys. */
export function parseChapterStatusTransitionProofJson(
  text: string,
  expectedChecksum?: string
): ChapterStatusTransitionProof {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    invalid();
  }
  const proof = parseChapterStatusTransitionProof(raw, expectedChecksum);
  if (text !== serializeChapterStatusTransitionProof(proof)) invalid();
  return proof;
}

export function serializeChapterStatusTransitionProof(value: ChapterStatusTransitionProof): string {
  return canonicalize(parseChapterStatusTransitionProof(value));
}

export function chapterStatusTransitionProofChecksum(value: ChapterStatusTransitionProof): string {
  return parseChapterStatusTransitionProof(value).proofChecksum;
}

/** Returns false for malformed, tampered, or incomplete proofs instead of throwing. */
export function isChapterStatusTransitionProof(
  value: unknown
): value is ChapterStatusTransitionProof {
  try {
    parseChapterStatusTransitionProof(value);
    return true;
  } catch {
    return false;
  }
}

export const validateChapterStatusTransitionProof = isChapterStatusTransitionProof;
export const verifyChapterStatusTransitionProof = isChapterStatusTransitionProof;
export const checksumChapterStatusTransitionProof = chapterStatusTransitionProofChecksum;
export const serializeChapterStatusTransitionProofJson = serializeChapterStatusTransitionProof;
export const createChapterStatusTransitionProofV1 = createChapterStatusTransitionProof;
export const parseChapterStatusTransitionProofV1 = parseChapterStatusTransitionProof;
export const parseChapterStatusTransitionProofV1Json = parseChapterStatusTransitionProofJson;
export const serializeChapterStatusTransitionProofV1 = serializeChapterStatusTransitionProof;
export const chapterStatusTransitionProofChecksumV1 = chapterStatusTransitionProofChecksum;
export const isChapterStatusTransitionProofComplete = isChapterStatusTransitionProof;

export function assertChapterStatusTransitionProof(
  value: unknown,
  expectedChecksum?: string
): ChapterStatusTransitionProof {
  return parseChapterStatusTransitionProof(value, expectedChecksum);
}

function validateTransition(value: unknown, requireChecksum: boolean): void {
  if (!isRecord(value) || !hasExactlyFields(value, PROOF_FIELDS)) invalid();
  if (value["schemaVersion"] !== CHAPTER_STATUS_TRANSITION_PROOF_SCHEMA_VERSION) invalid();
  for (const field of ["proofId", "stableRef", "chapterId"] as const) {
    if (!isSafeId(value[field])) invalid();
  }
  const action = value["action"];
  const beforeStatus = value["beforeStatus"];
  const afterStatus = value["afterStatus"];
  const restoreStatus = value["restoreStatus"];
  if (!isAction(action) || !isStatus(beforeStatus) || !isStatus(afterStatus)) invalid();
  if (restoreStatus !== null && !isRestoreStatus(restoreStatus)) invalid();
  if (!isRevision(value["beforeRevision"]) || !isRevision(value["afterRevision"])) invalid();
  if ((value["afterRevision"] as number) <= (value["beforeRevision"] as number)) invalid();
  for (const field of [
    "beforeChecksum",
    "afterChecksum",
    "outlineChecksum",
    "referenceImpactChecksum"
  ] as const) {
    if (!isChecksum(value[field])) invalid();
  }
  if (!isRevision(value["outlineRevision"])) invalid();
  if (value["originalVolumeRef"] !== null && !isSafeId(value["originalVolumeRef"])) invalid();
  parseNeighbors(value["beforeNeighborRefs"]);
  parseNeighbors(value["afterNeighborRefs"]);
  if (!isIsoTimestamp(value["createdAt"])) invalid();
  if (requireChecksum && !isChecksum(value["proofChecksum"])) invalid();
  if (!requireChecksum && value["proofChecksum"] !== "") invalid();

  if (action === "archive") {
    if (
      beforeStatus === "deleted" ||
      beforeStatus === "archived" ||
      afterStatus !== "archived" ||
      restoreStatus !== null
    )
      invalid();
  } else if (action === "delete") {
    if (beforeStatus === "deleted" || afterStatus !== "deleted" || restoreStatus !== beforeStatus)
      invalid();
  } else if (
    beforeStatus !== "deleted" ||
    afterStatus === "deleted" ||
    restoreStatus !== afterStatus
  ) {
    invalid();
  }
}

function withoutChecksum(proof: ChapterStatusTransitionProof): Record<string, unknown> {
  const unsigned: Record<string, unknown> = {};
  for (const field of UNSIGNED_FIELDS) unsigned[field] = proof[field];
  return unsigned;
}

function parseNeighbors(value: unknown): ChapterNeighborRefs {
  if (!isRecord(value) || !hasExactlyFields(value, NEIGHBOR_FIELDS)) invalid();
  for (const key of NEIGHBOR_FIELDS) {
    if (value[key] !== null && !isSafeId(value[key])) invalid();
  }
  return value as unknown as ChapterNeighborRefs;
}

function checksumCanonical(value: unknown): string {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalize(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hasExactlyFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every((field) => Object.hasOwn(value, field));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeId(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return false;
  }
  return true;
}

function isRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isChecksum(value: unknown): value is string {
  return typeof value === "string" && CHECKSUM.test(value);
}

function isStatus(value: unknown): value is ChapterTransitionStatus {
  return (
    value === "draft" ||
    value === "revision" ||
    value === "review" ||
    value === "done" ||
    value === "archived" ||
    value === "deleted"
  );
}

function isRestoreStatus(value: unknown): value is ChapterRestoreStatus {
  return isStatus(value) && value !== "deleted";
}

function isAction(value: unknown): value is ChapterStatusTransitionAction {
  return value === "archive" || value === "delete" || value === "restore";
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function invalid(): never {
  throw new Error("CHAPTER_STATUS_TRANSITION_PROOF_INVALID");
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
