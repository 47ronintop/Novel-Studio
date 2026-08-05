import { createHash } from "node:crypto";

import {
  createUnifiedError,
  err,
  ok,
  type ChapterOrderMigrationAffectedItem,
  type ChapterOrderMigrationPreview,
  type JsonObject,
  type Result,
  type UnifiedError
} from "@novel-studio/shared";

import {
  chapterOrderingChecksum,
  inspectChapterOrdering,
  type ChapterOrderEntry
} from "./chapter-ordering.js";

export interface ChapterOrderMigrationInput extends ChapterOrderEntry {
  readonly stableRef?: string;
  readonly relativePath?: string;
}

export interface ChapterOrderMigrationReport {
  readonly required: boolean;
  readonly affected: readonly ChapterOrderMigrationAffectedItem[];
  readonly inverse: readonly {
    readonly stableRef: string;
    readonly from: number;
    readonly to: number;
  }[];
}

/**
 * Validate a repository-supplied migration preview before it crosses the application boundary.
 * Repository implementations are still treated as an untrusted dependency at runtime: a typed
 * return value does not protect callers from malformed adapters or IPC payloads.
 */
export function validateChapterOrderMigrationPreview(
  value: unknown,
  traceId = "chapter-order-migration"
): Result<ChapterOrderMigrationPreview, UnifiedError> {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["required", "catalogRevision", "checksum", "affected", "inverse"])
  ) {
    return err(invalidPreviewError(traceId, "The chapter order migration preview is malformed."));
  }

  const required = value.required;
  const catalogRevision = value.catalogRevision;
  const checksum = value.checksum;
  const affected = value.affected;
  const inverse = value.inverse;
  if (
    typeof required !== "boolean" ||
    typeof catalogRevision !== "string" ||
    catalogRevision.length === 0 ||
    catalogRevision.length > 512 ||
    typeof checksum !== "string" ||
    !/^[a-f0-9]{64}$/u.test(checksum) ||
    !Array.isArray(affected) ||
    !Array.isArray(inverse)
  ) {
    return err(
      invalidPreviewError(traceId, "The chapter order migration preview fields are invalid.")
    );
  }

  const parsedAffected: ChapterOrderMigrationAffectedItem[] = [];
  const stableRefs = new Set<string>();
  const chapterIds = new Set<string>();
  for (let index = 0; index < affected.length; index += 1) {
    const item = affected[index];
    if (
      !isRecord(item) ||
      !hasExactKeys(item, [
        "stableRef",
        "chapterId",
        "order",
        "status",
        "relativePath",
        "reason"
      ]) ||
      typeof item.stableRef !== "string" ||
      item.stableRef.length === 0 ||
      item.stableRef.length > 256 ||
      typeof item.chapterId !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/u.test(item.chapterId) ||
      stableRefs.has(item.stableRef) ||
      chapterIds.has(item.chapterId) ||
      typeof item.order !== "number" ||
      !isChapterStatus(item.status) ||
      typeof item.relativePath !== "string" ||
      !isSafeRelativePath(item.relativePath) ||
      !isMigrationReason(item.reason) ||
      !reasonMatchesOrder(item.reason, item.order)
    ) {
      return err(
        invalidPreviewError(traceId, `The affected migration item at index ${index} is invalid.`)
      );
    }
    const previous = index > 0 ? parsedAffected[index - 1] : undefined;
    if (
      previous !== undefined &&
      compareAffected(previous, { order: item.order, chapterId: item.chapterId }) > 0
    ) {
      return err(
        invalidPreviewError(traceId, "Affected migration items are not deterministically ordered.")
      );
    }
    stableRefs.add(item.stableRef);
    chapterIds.add(item.chapterId);
    parsedAffected.push({
      stableRef: item.stableRef,
      chapterId: item.chapterId,
      order: item.order,
      status: item.status,
      relativePath: item.relativePath,
      reason: item.reason
    });
  }

  if (inverse.length !== parsedAffected.length) {
    return err(
      invalidPreviewError(traceId, "The migration inverse does not match the affected items.")
    );
  }
  const targetOrders = new Set<number>();
  const parsedInverse: { stableRef: string; from: number; to: number }[] = [];
  for (let index = 0; index < inverse.length; index += 1) {
    const item = inverse[index];
    const affectedItem = parsedAffected[index];
    if (
      !isRecord(item) ||
      !hasExactKeys(item, ["stableRef", "from", "to"]) ||
      typeof item.stableRef !== "string" ||
      typeof item.from !== "number" ||
      typeof item.to !== "number" ||
      !Number.isSafeInteger(item.to) ||
      item.to < 1 ||
      affectedItem === undefined ||
      item.stableRef !== affectedItem.stableRef ||
      !Object.is(item.from, affectedItem.order) ||
      targetOrders.has(item.to)
    ) {
      return err(
        invalidPreviewError(traceId, `The migration inverse item at index ${index} is invalid.`)
      );
    }
    targetOrders.add(item.to);
    parsedInverse.push({ stableRef: item.stableRef, from: item.from, to: item.to });
  }

  if (required !== parsedAffected.length > 0) {
    return err(
      invalidPreviewError(
        traceId,
        "The migration required flag is inconsistent with affected items."
      )
    );
  }
  const canonical = {
    required,
    catalogRevision,
    checksum,
    affected: parsedAffected,
    inverse: parsedInverse
  } satisfies ChapterOrderMigrationPreview;
  const expectedChecksum = migrationPreviewChecksum(catalogRevision, parsedAffected, parsedInverse);
  if (checksum !== expectedChecksum) {
    return err(
      invalidPreviewError(traceId, "The chapter order migration preview checksum is invalid.")
    );
  }
  return ok(canonical);
}

/** Detect legacy duplicate/invalid order metadata without rewriting any chapter. */
export function detectChapterOrderMigration(
  chapters: readonly ChapterOrderMigrationInput[]
): ChapterOrderMigrationReport {
  const inspection = inspectChapterOrdering(chapters);
  const issueById = new Map(inspection.issues.map((issue) => [issue.id, issue]));
  const affected = chapters
    .filter((chapter) => issueById.has(chapter.id))
    .map((chapter) => {
      const issue = issueById.get(chapter.id);
      if (issue === undefined) throw new Error("chapter order issue disappeared");
      return {
        stableRef: chapter.stableRef ?? `chapter:${chapter.id}`,
        chapterId: chapter.id,
        order: chapter.order,
        status: chapter.status ?? "draft",
        relativePath: chapter.relativePath ?? `chapters/${chapter.id}.md`,
        reason: issue.reason
      } satisfies ChapterOrderMigrationAffectedItem;
    })
    .sort((left, right) => left.order - right.order || compareIds(left.chapterId, right.chapterId));

  const inverse = buildDeterministicRepair(chapters, affected);
  return { required: affected.length > 0, affected, inverse };
}

export function buildChapterOrderMigrationPreview(input: {
  readonly chapters: readonly ChapterOrderMigrationInput[];
  readonly catalogRevision?: string;
}): ChapterOrderMigrationPreview {
  const report = detectChapterOrderMigration(input.chapters);
  const catalogRevision = input.catalogRevision ?? chapterOrderingChecksum(input.chapters);
  const checksum = migrationPreviewChecksum(catalogRevision, report.affected, report.inverse);
  return {
    required: report.required,
    catalogRevision,
    checksum,
    affected: report.affected,
    inverse: report.inverse
  };
}

function migrationPreviewChecksum(
  catalogRevision: string,
  affected: readonly ChapterOrderMigrationAffectedItem[],
  inverse: readonly { readonly stableRef: string; readonly from: number; readonly to: number }[]
): string {
  return createHash("sha256")
    .update(JSON.stringify({ catalogRevision, affected, inverse }), "utf8")
    .digest("hex");
}

export const previewChapterOrderMigration = buildChapterOrderMigrationPreview;

export function chapterOrderMigrationRequiredError(
  traceId: string,
  preview?: ChapterOrderMigrationPreview
): UnifiedError {
  const detail: JsonObject = {
    ...(preview === undefined
      ? {}
      : { preview: JSON.parse(JSON.stringify(preview)) as JsonObject }),
    ...(preview === undefined ? {} : { affectedCount: preview.affected.length })
  };
  return createUnifiedError({
    code: "CHAPTER_ORDER_MIGRATION_REQUIRED",
    category: "ValidationError",
    message: "Chapter order metadata requires an explicit migration before this mutation.",
    recoverability: "user-action",
    suggestedAction: "Review and apply the chapter order migration, then retry the operation.",
    traceId,
    ...(Object.keys(detail).length === 0 ? {} : { redactedDetail: detail })
  });
}

export function requireValidChapterOrdering(
  chapters: readonly ChapterOrderMigrationInput[],
  traceId: string
): Result<void, UnifiedError> {
  const preview = buildChapterOrderMigrationPreview({ chapters });
  return preview.required
    ? err(chapterOrderMigrationRequiredError(traceId, preview))
    : ok(undefined);
}

function buildDeterministicRepair(
  chapters: readonly ChapterOrderMigrationInput[],
  affected: readonly ChapterOrderMigrationAffectedItem[]
): readonly { readonly stableRef: string; readonly from: number; readonly to: number }[] {
  if (affected.length === 0) return [];
  const occupied = new Set(
    chapters
      .filter((chapter) => !affected.some((item) => item.chapterId === chapter.id))
      .map((chapter) => chapter.order)
      .filter((order) => Number.isInteger(order) && order > 0)
  );
  const candidates = [...affected].sort(
    (left, right) => left.order - right.order || compareIds(left.chapterId, right.chapterId)
  );
  const result: { stableRef: string; from: number; to: number }[] = [];
  let next = 1;
  for (const item of candidates) {
    while (occupied.has(next)) next += 1;
    result.push({ stableRef: item.stableRef, from: item.order, to: next });
    occupied.add(next);
    next += 1;
  }
  return result;
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareAffected(
  left: Pick<ChapterOrderMigrationAffectedItem, "order" | "chapterId">,
  right: Pick<ChapterOrderMigrationAffectedItem, "order" | "chapterId">
): number {
  return left.order - right.order || compareIds(left.chapterId, right.chapterId);
}

function isMigrationReason(value: unknown): value is ChapterOrderMigrationAffectedItem["reason"] {
  return (
    value === "duplicate" ||
    value === "non_positive" ||
    value === "non_integer" ||
    value === "non_finite"
  );
}

function reasonMatchesOrder(
  reason: ChapterOrderMigrationAffectedItem["reason"],
  order: number
): boolean {
  if (reason === "non_finite") return !Number.isFinite(order);
  if (reason === "non_integer") return Number.isFinite(order) && !Number.isInteger(order);
  if (reason === "non_positive")
    return Number.isFinite(order) && Number.isInteger(order) && order < 1;
  return Number.isFinite(order) && Number.isInteger(order) && order > 0;
}

function isChapterStatus(value: unknown): value is ChapterOrderMigrationAffectedItem["status"] {
  return (
    value === "draft" ||
    value === "revision" ||
    value === "review" ||
    value === "done" ||
    value === "archived" ||
    value === "deleted"
  );
}

function isSafeRelativePath(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 512 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const expected = new Set(keys);
  return (
    Object.keys(value).every((key) => expected.has(key)) &&
    expected.size === Object.keys(value).length
  );
}

function invalidPreviewError(traceId: string, message: string): UnifiedError {
  return createUnifiedError({
    code: "CHAPTER_ORDER_MIGRATION_PREVIEW_INVALID",
    category: "ValidationError",
    message,
    recoverability: "user-action",
    suggestedAction: "Refresh the chapter order migration preview and retry.",
    traceId
  });
}
