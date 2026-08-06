import { describe, expect, test } from "vitest";
import {
  createChapterStatusTransitionProof,
  type ChapterStatusTransitionProof
} from "@novel-studio/agent-engine";
import type { ChapterAgentCatalogItem, ChapterDocument } from "@novel-studio/shared";

import {
  ChapterWriteCoordinator,
  chapterLifecycleChecksum,
  type ChapterOutlineSnapshot,
  type ChapterWriteCoordinatorRepository
} from "../src/chapter-write-coordinator.js";

class MemoryChapterRepository implements ChapterWriteCoordinatorRepository {
  readonly chapters = new Map<string, ChapterDocument>();
  outline: ChapterOutlineSnapshot;
  failChapterWriteOnceFor: string | undefined;
  failOutlineWriteOnce = false;

  constructor(
    chapters: readonly ChapterDocument[],
    outline: ChapterOutlineSnapshot = outlineSnapshot([])
  ) {
    for (const chapter of chapters)
      this.chapters.set(chapter.frontmatter.id, structuredClone(chapter));
    this.outline = structuredClone(outline);
  }

  async readChapter(chapterId: string) {
    const chapter = this.chapters.get(chapterId);
    return chapter === undefined
      ? { ok: false as const, error: { code: "MISSING" } as never }
      : { ok: true as const, value: structuredClone(chapter) };
  }

  async writeChapter(chapter: ChapterDocument) {
    if (this.failChapterWriteOnceFor === chapter.frontmatter.id) {
      this.failChapterWriteOnceFor = undefined;
      return { ok: false as const, error: { code: "WRITE_FAILED" } as never };
    }
    this.chapters.set(chapter.frontmatter.id, structuredClone(chapter));
    return { ok: true as const, value: structuredClone(chapter) };
  }

  async readChapterOutline() {
    return { ok: true as const, value: structuredClone(this.outline) };
  }

  async writeChapterOutline(outline: ChapterOutlineSnapshot) {
    if (this.failOutlineWriteOnce) {
      this.failOutlineWriteOnce = false;
      return { ok: false as const, error: { code: "OUTLINE_WRITE_FAILED" } as never };
    }
    this.outline = structuredClone(outline);
    return { ok: true as const, value: structuredClone(outline) };
  }

  async readChapterReferenceImpactChecksum() {
    return { ok: true as const, value: "b".repeat(64) };
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
      expect(result.value.inverse).toMatchObject({
        kind: "rename",
        chapterId: "a",
        title: "A",
        revision: 3
      });
      expect(result.value.inverse.chapters).toEqual([chapter("a", 1, "draft", 2)]);
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

  test("moves across outline volumes using a stable adjacent pair and mirrors volumeId", async () => {
    const repository = new MemoryChapterRepository(
      [
        chapter("a", 1, "draft", 1, "vol_a"),
        chapter("b", 2, "draft", 1, "vol_a"),
        chapter("c", 3, "draft", 1, "vol_b"),
        chapter("deleted", 4, "deleted")
      ],
      outlineSnapshot([
        { stableRef: "volume:vol_a", volumeId: "vol_a", chapterIds: ["a", "b"] },
        { stableRef: "volume:vol_b", volumeId: "vol_b", chapterIds: ["c"] }
      ])
    );
    const coordinator = new ChapterWriteCoordinator(repository, { now: () => now });

    const result = await coordinator.reorder({
      chapterId: "c",
      baseRevision: 1,
      afterChapterRef: "chapter:a",
      beforeChapterRef: "chapter:b",
      targetVolumeRef: "volume:vol_a"
    });

    expect(result.ok).toBe(true);
    expect(repository.outline.volumes).toEqual([
      { stableRef: "volume:vol_a", volumeId: "vol_a", chapterIds: ["a", "c", "b"] },
      { stableRef: "volume:vol_b", volumeId: "vol_b", chapterIds: [] }
    ]);
    expect(repository.chapters.get("c")?.frontmatter).toMatchObject({
      order: 2,
      volumeId: "vol_a",
      revision: 2
    });
    expect(repository.chapters.get("b")?.frontmatter.order).toBe(3);
    expect(repository.chapters.get("deleted")?.frontmatter.order).toBe(4);
  });

  test("fails closed when the outline contains a chapter outside the catalog", async () => {
    const repository = new MemoryChapterRepository(
      [chapter("a", 1, "draft", 1, "vol_a")],
      outlineSnapshot([
        { stableRef: "volume:vol_a", volumeId: "vol_a", chapterIds: ["a", "missing"] }
      ])
    );
    const coordinator = new ChapterWriteCoordinator(repository, { now: () => now });

    const result = await coordinator.reorder({
      chapterId: "a",
      baseRevision: 1,
      afterChapterRef: null,
      targetVolumeRef: "volume:vol_a"
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "CHAPTER_OUTLINE_MEMBER_MISSING" }
    });
    expect(repository.outline.volumes[0]?.chapterIds).toEqual(["a", "missing"]);
  });

  test("fails closed when a stable neighbor pair is no longer adjacent", async () => {
    const repository = new MemoryChapterRepository([
      chapter("a", 1, "draft"),
      chapter("b", 2, "draft"),
      chapter("c", 3, "draft"),
      chapter("d", 4, "draft")
    ]);
    const coordinator = new ChapterWriteCoordinator(repository, { now: () => now });

    const result = await coordinator.reorder({
      chapterId: "d",
      baseRevision: 1,
      afterChapterRef: "chapter:a",
      beforeChapterRef: "chapter:c"
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "CHAPTER_REORDER_NEIGHBOR_STALE" }
    });
    expect(repository.chapters.get("d")?.frontmatter.order).toBe(4);
  });

  test("compensates chapter and outline writes when a cross-volume apply fails", async () => {
    const originalOutline = outlineSnapshot([
      { stableRef: "volume:vol_a", volumeId: "vol_a", chapterIds: ["a", "b"] },
      { stableRef: "volume:vol_b", volumeId: "vol_b", chapterIds: ["c"] }
    ]);
    const repository = new MemoryChapterRepository(
      [
        chapter("a", 1, "draft", 1, "vol_a"),
        chapter("b", 2, "draft", 1, "vol_a"),
        chapter("c", 3, "draft", 1, "vol_b")
      ],
      originalOutline
    );
    repository.failOutlineWriteOnce = true;
    const coordinator = new ChapterWriteCoordinator(repository, { now: () => now });

    const result = await coordinator.reorder({
      chapterId: "c",
      baseRevision: 1,
      afterChapterRef: "chapter:a",
      beforeChapterRef: "chapter:b",
      targetVolumeRef: "volume:vol_a"
    });

    expect(result).toMatchObject({ ok: false, error: { code: "OUTLINE_WRITE_FAILED" } });
    expect(repository.outline).toEqual(originalOutline);
    expect([...repository.chapters.values()]).toEqual([
      chapter("a", 1, "draft", 1, "vol_a"),
      chapter("b", 2, "draft", 1, "vol_a"),
      chapter("c", 3, "draft", 1, "vol_b")
    ]);
  });

  test("compensates earlier chapter writes when a later metadata write fails", async () => {
    const repository = new MemoryChapterRepository([
      chapter("a", 1, "draft"),
      chapter("b", 2, "draft"),
      chapter("c", 3, "draft")
    ]);
    repository.failChapterWriteOnceFor = "a";
    const coordinator = new ChapterWriteCoordinator(repository, { now: () => now });

    const result = await coordinator.reorder({
      chapterId: "c",
      baseRevision: 1,
      beforeChapterRef: "chapter:a"
    });

    expect(result).toMatchObject({ ok: false, error: { code: "WRITE_FAILED" } });
    expect([...repository.chapters.values()]).toEqual([
      chapter("a", 1, "draft"),
      chapter("b", 2, "draft"),
      chapter("c", 3, "draft")
    ]);
  });

  test("deletes from the outline, restores at authenticated neighbors, and supports full undo", async () => {
    const repository = new MemoryChapterRepository(
      [
        chapter("a", 1, "draft", 1, "vol_a"),
        chapter("b", 2, "review", 1, "vol_a"),
        chapter("c", 3, "draft", 1, "vol_a")
      ],
      outlineSnapshot([
        { stableRef: "volume:vol_a", volumeId: "vol_a", chapterIds: ["a", "b", "c"] }
      ])
    );
    const coordinator = new ChapterWriteCoordinator(repository, { now: () => now });
    const before = chapterFrom(repository, "b");
    const deleted = chapter("b", 2, "deleted", 2);
    const deleteProof = makeProof({
      action: "delete",
      before,
      after: deleted,
      beforeStatus: "review",
      afterStatus: "deleted",
      restoreStatus: "review",
      outline: repository.outline,
      originalVolumeRef: "volume:vol_a",
      beforeNeighborRefs: { before: "chapter:a", after: "chapter:c" },
      afterNeighborRefs: { before: "chapter:a", after: "chapter:c" }
    });

    const deletedResult = await coordinator.delete({
      chapterId: "b",
      baseRevision: 1,
      proof: deleteProof
    });
    expect(deletedResult.ok).toBe(true);
    expect(repository.outline.volumes[0]?.chapterIds).toEqual(["a", "c"]);
    expect(repository.chapters.get("b")?.frontmatter.volumeId).toBeUndefined();

    const restoreBefore = chapterFrom(repository, "b");
    const restored = chapter("b", 2, "review", 3, "vol_a");
    const restoreProof = makeProof({
      action: "restore",
      before: restoreBefore,
      after: restored,
      beforeStatus: "deleted",
      afterStatus: "review",
      restoreStatus: "review",
      outline: repository.outline,
      originalVolumeRef: "volume:vol_a",
      beforeNeighborRefs: { before: null, after: null },
      afterNeighborRefs: { before: "chapter:a", after: "chapter:c" }
    });
    const restoredResult = await coordinator.restore({
      chapterId: "b",
      baseRevision: 2,
      proof: restoreProof
    });
    expect(restoredResult.ok).toBe(true);
    if (!restoredResult.ok) return;
    expect(repository.outline.volumes[0]?.chapterIds).toEqual(["a", "b", "c"]);
    expect(repository.chapters.get("b")?.frontmatter.volumeId).toBe("vol_a");

    const undone = await coordinator.undo(restoredResult.value);
    expect(undone.ok).toBe(true);
    expect(repository.outline.volumes[0]?.chapterIds).toEqual(["a", "c"]);
    expect(repository.chapters.get("b")).toEqual(restoreBefore);
  });

  test("rejects a restore proof that requests archived status", async () => {
    const repository = new MemoryChapterRepository(
      [chapter("b", 2, "deleted", 2)],
      outlineSnapshot([{ stableRef: "volume:vol_a", volumeId: "vol_a", chapterIds: [] }])
    );
    const before = chapterFrom(repository, "b");
    const proof = makeProof({
      action: "restore",
      before,
      after: chapter("b", 2, "archived", 3, "vol_a"),
      beforeStatus: "deleted",
      afterStatus: "archived",
      restoreStatus: "archived",
      outline: repository.outline,
      originalVolumeRef: "volume:vol_a",
      beforeNeighborRefs: { before: null, after: null },
      afterNeighborRefs: { before: null, after: null }
    });

    const result = await new ChapterWriteCoordinator(repository, { now: () => now }).restore({
      chapterId: "b",
      baseRevision: 2,
      proof
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "CHAPTER_RESTORE_ARCHIVED_INVALID" }
    });
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
  revision = 1,
  volumeId?: string
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
      ...(volumeId === undefined ? {} : { volumeId }),
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
  outline?: ChapterOutlineSnapshot;
  originalVolumeRef?: string | null;
  beforeNeighborRefs?: { readonly before: string | null; readonly after: string | null };
  afterNeighborRefs?: { readonly before: string | null; readonly after: string | null };
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
    outlineRevision: input.outline?.revision ?? 1,
    outlineChecksum: input.outline?.checksum ?? "a".repeat(64),
    originalVolumeRef: input.originalVolumeRef ?? null,
    beforeNeighborRefs: input.beforeNeighborRefs ?? { before: null, after: null },
    afterNeighborRefs: input.afterNeighborRefs ??
      input.beforeNeighborRefs ?? { before: null, after: null },
    referenceImpactChecksum: "b".repeat(64),
    createdAt: now
  });
}

function outlineSnapshot(volumes: ChapterOutlineSnapshot["volumes"]): ChapterOutlineSnapshot {
  return {
    revision: 1,
    checksum: "a".repeat(64),
    volumes: structuredClone(volumes)
  };
}
