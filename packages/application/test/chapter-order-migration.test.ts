import { describe, expect, test } from "vitest";

import { isErr, isOk } from "@novel-studio/shared";

import {
  buildChapterOrderMigrationPreview,
  detectChapterOrderMigration,
  requireValidChapterOrdering
} from "../src/chapter-order-migration.js";

describe("chapter order migration", () => {
  const legacyChapters = [
    { id: "a", stableRef: "ref-a", order: 1, status: "draft" as const },
    { id: "b", stableRef: "ref-b", order: 1, status: "review" as const },
    { id: "c", stableRef: "ref-c", order: 0, status: "draft" as const },
    { id: "deleted", stableRef: "ref-deleted", order: 2, status: "deleted" as const }
  ];

  test("builds deterministic repairs that keep tombstone orders occupied", () => {
    const report = detectChapterOrderMigration(legacyChapters);

    expect(report.required).toBe(true);
    expect(report.affected.map(({ chapterId, reason }) => ({ chapterId, reason }))).toEqual([
      { chapterId: "c", reason: "non_positive" },
      { chapterId: "a", reason: "duplicate" },
      { chapterId: "b", reason: "duplicate" }
    ]);
    expect(report.inverse).toEqual([
      { stableRef: "ref-c", from: 0, to: 1 },
      { stableRef: "ref-a", from: 1, to: 3 },
      { stableRef: "ref-b", from: 1, to: 4 }
    ]);
  });

  test("produces the same preview and checksum regardless of input order", () => {
    const preview = buildChapterOrderMigrationPreview({ chapters: legacyChapters });
    const reversed = buildChapterOrderMigrationPreview({
      chapters: [...legacyChapters].reverse()
    });

    expect(reversed).toEqual(preview);
    expect(preview.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(
      buildChapterOrderMigrationPreview({ chapters: legacyChapters, catalogRevision: "rev-7" })
    ).toEqual(
      buildChapterOrderMigrationPreview({
        chapters: [...legacyChapters].reverse(),
        catalogRevision: "rev-7"
      })
    );
  });

  test("gates order-sensitive mutations and includes the migration preview in the error", () => {
    const result = requireValidChapterOrdering(legacyChapters, "trace-123");
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe("CHAPTER_ORDER_MIGRATION_REQUIRED");
      expect(result.error.redactedDetail?.affectedCount).toBe(3);
      expect(result.error.redactedDetail?.preview).toBeDefined();
    }

    const valid = requireValidChapterOrdering(
      [
        { id: "a", order: 1, status: "draft" as const },
        { id: "deleted", order: 2, status: "deleted" as const }
      ],
      "trace-valid"
    );
    expect(isOk(valid)).toBe(true);
  });
});
