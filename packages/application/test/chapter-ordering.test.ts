import { describe, expect, test } from "vitest";

import {
  calculateReorderedChapterOrders,
  chapterOrderingChecksum,
  inspectChapterOrdering,
  nextAvailableChapterOrder
} from "../src/chapter-ordering.js";

describe("chapter ordering", () => {
  test("reports duplicate and invalid orders while retaining tombstone occupancy", () => {
    const inspection = inspectChapterOrdering([
      { id: "active-a", order: 1, status: "draft" },
      { id: "active-b", order: 1, status: "review" },
      { id: "invalid-zero", order: 0, status: "draft" },
      { id: "invalid-fraction", order: 1.5, status: "draft" },
      { id: "invalid-infinite", order: Number.POSITIVE_INFINITY, status: "draft" },
      { id: "deleted-slot", order: 2, status: "deleted" }
    ]);

    expect(inspection.valid).toBe(false);
    expect(inspection.occupiedOrders).toEqual([1, 2]);
    expect(inspection.issues).toEqual([
      { id: "invalid-zero", order: 0, reason: "non_positive" },
      {
        id: "active-a",
        order: 1,
        reason: "duplicate",
        conflictingIds: ["active-a", "active-b"]
      },
      {
        id: "active-b",
        order: 1,
        reason: "duplicate",
        conflictingIds: ["active-a", "active-b"]
      },
      { id: "invalid-fraction", order: 1.5, reason: "non_integer" },
      { id: "invalid-infinite", order: Number.POSITIVE_INFINITY, reason: "non_finite" }
    ]);
    expect(inspection.tombstones.map((chapter) => chapter.id)).toEqual(["deleted-slot"]);
  });

  test("allocates the first free order without reusing a deleted slot", () => {
    expect(
      nextAvailableChapterOrder([
        { id: "a", order: 1 },
        { id: "deleted", order: 2, status: "deleted" },
        { id: "bad", order: 0 }
      ])
    ).toBe(3);
  });

  test("computes a stable checksum independent of input order", () => {
    const chapters = [
      { id: "b", order: 2, status: "review" as const },
      { id: "a", order: 1, status: "draft" as const },
      { id: "deleted", order: 3, status: "deleted" as const }
    ];
    expect(chapterOrderingChecksum(chapters)).toBe(
      chapterOrderingChecksum([...chapters].reverse())
    );
  });

  test("reorders around stable neighbors while preserving tombstone slots", () => {
    const chapters = [
      { id: "a", order: 1, status: "draft" as const },
      { id: "deleted", order: 2, status: "deleted" as const },
      { id: "b", order: 3, status: "draft" as const },
      { id: "c", order: 4, status: "draft" as const }
    ];

    expect(
      calculateReorderedChapterOrders({ chapters, chapterId: "c", beforeChapterId: "a" })
    ).toEqual(
      new Map([
        ["c", 1],
        ["a", 3],
        ["b", 4]
      ])
    );
    expect(
      calculateReorderedChapterOrders({ chapters, chapterId: "a", afterChapterId: "b" })
    ).toEqual(
      new Map([
        ["b", 1],
        ["a", 3],
        ["c", 4]
      ])
    );
    expect(
      calculateReorderedChapterOrders({ chapters, chapterId: "a", beforeChapterId: "missing" })
    ).toBeUndefined();
  });
});
