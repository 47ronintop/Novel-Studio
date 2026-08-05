import { createHash } from "node:crypto";

import type { ChapterStatus } from "@novel-studio/shared";

export interface ChapterOrderEntry {
  readonly id: string;
  readonly order: number;
  readonly status?: ChapterStatus;
}

export interface ChapterOrderIssue {
  readonly id: string;
  readonly order: number;
  readonly reason: "duplicate" | "non_positive" | "non_integer" | "non_finite";
  readonly conflictingIds?: readonly string[];
}

export interface ChapterOrderInspection {
  readonly valid: boolean;
  readonly issues: readonly ChapterOrderIssue[];
  readonly occupiedOrders: readonly number[];
  readonly active: readonly ChapterOrderEntry[];
  readonly tombstones: readonly ChapterOrderEntry[];
}

/** Inspect every chapter, including deleted tombstones, without mutating the source list. */
export function inspectChapterOrdering(
  chapters: readonly ChapterOrderEntry[]
): ChapterOrderInspection {
  const issues: ChapterOrderIssue[] = [];
  const byOrder = new Map<number, string[]>();
  for (const chapter of chapters) {
    const order = chapter.order;
    let reason: ChapterOrderIssue["reason"] | undefined;
    if (!Number.isFinite(order)) reason = "non_finite";
    else if (!Number.isInteger(order)) reason = "non_integer";
    else if (order < 1) reason = "non_positive";
    if (reason !== undefined) {
      issues.push({ id: chapter.id, order, reason });
      continue;
    }
    const ids = byOrder.get(order) ?? [];
    ids.push(chapter.id);
    byOrder.set(order, ids);
  }
  for (const [order, ids] of byOrder) {
    if (ids.length > 1) {
      for (const id of ids) {
        issues.push({ id, order, reason: "duplicate", conflictingIds: [...ids].sort(compareIds) });
      }
    }
  }
  issues.sort((left, right) => left.order - right.order || compareIds(left.id, right.id));
  const ordered = [...chapters].sort(
    (left, right) => safeOrder(left.order) - safeOrder(right.order) || compareIds(left.id, right.id)
  );
  return {
    valid: issues.length === 0,
    issues,
    occupiedOrders: [...byOrder.keys()].sort((left, right) => left - right),
    active: ordered.filter((chapter) => chapter.status !== "deleted"),
    tombstones: ordered.filter((chapter) => chapter.status === "deleted")
  };
}

/** Compatibility alias used by repository/application callers. */
export const inspectChapterOrders = inspectChapterOrdering;

export function chapterOrderingChecksum(chapters: readonly ChapterOrderEntry[]): string {
  const normalized = [...chapters]
    .map((chapter) => ({ id: chapter.id, order: chapter.order, status: chapter.status ?? null }))
    .sort((left, right) => left.order - right.order || compareIds(left.id, right.id));
  return createHash("sha256").update(JSON.stringify(normalized), "utf8").digest("hex");
}

/** Return the first positive order not occupied by any chapter, including tombstones. */
export function nextAvailableChapterOrder(chapters: readonly ChapterOrderEntry[]): number {
  const occupied = new Set(
    chapters
      .filter((chapter) => Number.isInteger(chapter.order) && chapter.order > 0)
      .map((c) => c.order)
  );
  let candidate = 1;
  while (occupied.has(candidate)) candidate += 1;
  return candidate;
}

/** Append semantics for a newly created chapter. */
export function nextChapterOrder(chapters: readonly ChapterOrderEntry[]): number {
  if (chapters.length === 0) return 1;
  const validOrders = chapters
    .map((chapter) => chapter.order)
    .filter((order) => Number.isInteger(order) && order > 0);
  return validOrders.length === 0 ? 1 : Math.max(...validOrders) + 1;
}

export const allocateNextChapterOrder = nextChapterOrder;

export function canPerformOrderSensitiveMutation(chapters: readonly ChapterOrderEntry[]): boolean {
  return inspectChapterOrdering(chapters).valid;
}

/**
 * Calculate a deterministic order map from stable neighbour references. The input order is the
 * complete catalog; deleted tombstone slots remain occupied and are never moved by this helper.
 */
export function calculateReorderedChapterOrders(input: {
  readonly chapters: readonly ChapterOrderEntry[];
  readonly chapterId: string;
  readonly beforeChapterId?: string;
  readonly afterChapterId?: string;
}): ReadonlyMap<string, number> | undefined {
  const inspection = inspectChapterOrdering(input.chapters);
  if (!inspection.valid) return undefined;
  const active = inspection.active.filter((chapter) => chapter.id !== input.chapterId);
  const target = input.chapters.find((chapter) => chapter.id === input.chapterId);
  if (target === undefined || target.status === "deleted") return undefined;
  if (
    input.beforeChapterId !== undefined &&
    !active.some((chapter) => chapter.id === input.beforeChapterId)
  ) {
    return undefined;
  }
  if (
    input.afterChapterId !== undefined &&
    !active.some((chapter) => chapter.id === input.afterChapterId)
  ) {
    return undefined;
  }
  if (
    input.beforeChapterId !== undefined &&
    input.afterChapterId !== undefined &&
    input.beforeChapterId === input.afterChapterId
  ) {
    return undefined;
  }
  const sorted = [...active].sort(
    (left, right) => left.order - right.order || compareIds(left.id, right.id)
  );
  let insertionIndex = sorted.length;
  if (input.beforeChapterId !== undefined) {
    insertionIndex = sorted.findIndex((chapter) => chapter.id === input.beforeChapterId);
  } else if (input.afterChapterId !== undefined) {
    const afterIndex = sorted.findIndex((chapter) => chapter.id === input.afterChapterId);
    insertionIndex = afterIndex < 0 ? -1 : afterIndex + 1;
  }
  if (insertionIndex < 0) return undefined;
  sorted.splice(insertionIndex, 0, target);
  const result = new Map<string, number>();
  const tombstoneOrders = new Set(inspection.tombstones.map((chapter) => chapter.order));
  let candidate = 1;
  for (const chapter of sorted) {
    while (tombstoneOrders.has(candidate)) candidate += 1;
    result.set(chapter.id, candidate);
    candidate += 1;
  }
  return result;
}

function safeOrder(order: number): number {
  return Number.isFinite(order) ? order : Number.POSITIVE_INFINITY;
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
