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
  const checksum = createHash("sha256")
    .update(
      JSON.stringify({
        catalogRevision,
        affected: report.affected,
        inverse: report.inverse
      }),
      "utf8"
    )
    .digest("hex");
  return {
    required: report.required,
    catalogRevision,
    checksum,
    affected: report.affected,
    inverse: report.inverse
  };
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
