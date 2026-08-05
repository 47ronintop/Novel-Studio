import { describe, expect, test } from "vitest";
import {
  createChapterStatusTransitionProof,
  type ChapterStatusTransitionProof
} from "@novel-studio/agent-engine";
import type { ChapterAgentCatalogItem, ChapterDocument } from "@novel-studio/shared";

import {
  ChapterWriteCoordinator,
  chapterLifecycleChecksum,
  type ChapterWriteCoordinatorRepository
} from "../src/chapter-write-coordinator.js";

class MemoryChapterRepository implements ChapterWriteCoordinatorRepository {
  readonly chapters = new Map<string, ChapterDocument>();

  constructor(chapters: readonly ChapterDocument[]) {
    for (const chapter of chapters)
      this.chapters.set(chapter.frontmatter.id, structuredClone(chapter));
  }

  async readChapter(chapterId: string) {
    const chapter = this.chapters.get(chapterId);
    return chapter === undefined
      ? { ok: false as const, error: { code: "MISSING" } as never }
      : { ok: true as const, value: structuredClone(chapter) };
  }

  async writeChapter(chapter: ChapterDocument) {
    this.chapters.set(chapter.frontmatter.id, structuredClone(chapter));
    return { ok: true as const, value: structuredClone(chapter) };
  }

  async listChapters() {
    return {
      ok: true as const,
      value: [...this.chapters.values()].map((chapter) => ({
        id: chapter.frontmatter.id,
        title: chapter.frontmatter.title,
        order: chapter.frontmatter.order,
        status: chapter.frontmatter.status,
        updatedAt: chapter.frontmatter.updatedAt
      }))
    };
  }

  async createChapter() {
    throw new Error("unused");
  }
  async duplicateChapter() {
    throw new Error("unused");
  }

  async listChapterCatalog() {
    const items: ChapterAgentCatalogItem[] = [...this.chapters.values()].map((chapter) => ({
      stableRef: `chapter:${chapter.frontmatter.id}`,
      chapterId: chapter.frontmatter.id,
      id: chapter.frontmatter.id,
      title: chapter.frontmatter.title,
      order: chapter.frontmatter.order,
      status: chapter.frontmatter.status,
      updatedAt: chapter.frontmatter.updatedAt,
      frontmatter: structuredClone(chapter.frontmatter),
      resourceRevision: "r",
      revision: chapter.frontmatter.revision ?? 1,
      bodyChecksum: "b",
      checksum: "b",
      persistedChecksum: "p",
      relativePath: `chapters/${chapter.frontmatter.id}.md`,
      catalogRevision: "catalog"
    }));
    return { ok: true as const, value: { items, catalogRevision: "catalog", nextCursor: null } };
  }
}

const now = "2026-08-05T00:00:00.000Z";

describe("ChapterWriteCoordinator", () => {
  test("renames with a revision bump and deterministic inverse", async () => {
    const repository = new MemoryChapterRepository([chapter("a", 1, "draft", 2)]);
    const coordinator = new ChapterWriteCoordinator(repository, { now: () => now });
    const result = await coordinator.rename("a", "Renamed", 2);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.chapter.frontmatter).toMatchObject({
        title: "Renamed",
        revision: 3,
        updatedAt: now
      });
      expect(result.value.inverse).toEqual({
        kind: "rename",
        chapterId: "a",
        title: "A",
        revision: 3
      });
    }
  });

  test("reorders active chapters while preserving deleted order slots", async () => {
    const repository = new MemoryChapterRepository([
      chapter("a", 1, "draft"),
      chapter("deleted", 2, "deleted"),
      chapter("b", 3, "draft"),
      chapter("c", 4, "draft")
    ]);
    const coordinator = new ChapterWriteCoordinator(repository, { now: () => now });
    const result = await coordinator.reorder({
      chapterId: "c",
      baseRevision: 1,
      beforeChapterId: "a"
    });
    expect(result.ok).toBe(true);
    expect(repository.chapters.get("c")?.frontmatter.order).toBe(1);
    expect(repository.chapters.get("a")?.frontmatter.order).toBe(3);
    expect(repository.chapters.get("b")?.frontmatter.order).toBe(4);
    expect(repository.chapters.get("deleted")?.frontmatter.order).toBe(2);
  });

  test("requires a matching proof for delete and restore, failing closed on tampering", async () => {
    const repository = new MemoryChapterRepository([chapter("a", 1, "review", 1)]);
    const coordinator = new ChapterWriteCoordinator(repository, { now: () => now });
    const before = chapterFrom(repository, "a");
    const deleted = chapter("a", 1, "deleted", 2);
    const proof = makeProof({
      action: "delete",
      before,
      after: deleted,
      beforeStatus: "review",
      afterStatus: "deleted",
      restoreStatus: "review"
    });
    const result = await coordinator.delete({ chapterId: "a", baseRevision: 1, proof });
    expect(result.ok).toBe(true);
    const restoreBefore = chapterFrom(repository, "a");
    const restored = chapter("a", 1, "review", 3);
    const restoreProof = makeProof({
      action: "restore",
      before: restoreBefore,
      after: restored,
      beforeStatus: "deleted",
      afterStatus: "review",
      restoreStatus: "review"
    });
    const restoredResult = await coordinator.restore({
      chapterId: "a",
      baseRevision: 2,
      proof: restoreProof
    });
    expect(restoredResult.ok).toBe(true);
    const tampered = {
      ...restoreProof,
      afterChecksum: "f".repeat(64)
    } as ChapterStatusTransitionProof;
    const rejected = await coordinator.restore({
      chapterId: "a",
      baseRevision: 3,
      proof: tampered
    });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error.code).toBe("CHAPTER_STATUS_PROOF_INVALID");
  });
});

function chapterFrom(repository: MemoryChapterRepository, chapterId: string): ChapterDocument {
  const value = repository.chapters.get(chapterId);
  if (value === undefined) throw new Error(`Missing test chapter ${chapterId}`);
  return value;
}

function chapter(
  id: string,
  order: number,
  status: ChapterDocument["frontmatter"]["status"],
  revision = 1
): ChapterDocument {
  return {
    frontmatter: {
      schemaVersion: "1.0",
      id,
      type: "chapter",
      title: id === "a" ? "A" : id,
      order,
      status,
      revision,
      createdAt: now,
      updatedAt: now
    },
    body: `${id} body`
  };
}

function makeProof(input: {
  action: "delete" | "restore";
  before: ChapterDocument;
  after: ChapterDocument;
  beforeStatus: ChapterDocument["frontmatter"]["status"];
  afterStatus: ChapterDocument["frontmatter"]["status"];
  restoreStatus: "draft" | "revision" | "review" | "done" | "archived" | null;
}): ChapterStatusTransitionProof {
  return createChapterStatusTransitionProof({
    proofId: `${input.action}-${input.before.frontmatter.id}-${input.before.frontmatter.revision}`,
    stableRef: `chapter:${input.before.frontmatter.id}`,
    chapterId: input.before.frontmatter.id,
    action: input.action,
    beforeStatus: input.beforeStatus,
    afterStatus: input.afterStatus,
    restoreStatus: input.restoreStatus,
    beforeRevision: input.before.frontmatter.revision ?? 1,
    afterRevision: input.after.frontmatter.revision ?? 1,
    beforeChecksum: chapterLifecycleChecksum(input.before),
    afterChecksum: chapterLifecycleChecksum(input.after),
    outlineRevision: 1,
    outlineChecksum: "a".repeat(64),
    originalVolumeRef: null,
    beforeNeighborRefs: { before: null, after: null },
    afterNeighborRefs: { before: null, after: null },
    referenceImpactChecksum: "b".repeat(64),
    createdAt: now
  });
}
