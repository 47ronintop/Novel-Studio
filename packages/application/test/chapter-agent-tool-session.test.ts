import { describe, expect, test, vi } from "vitest";

import {
  ok,
  type ChapterAgentRead,
  type ChapterCatalogPage,
  type ChapterCatalogRepositoryPort,
  type CreateAgentChapterResult
} from "@novel-studio/shared";

import { createChapterAgentToolSession } from "../src/chapter-agent-tool-session.js";
import { buildChapterOrderMigrationPreview } from "../src/chapter-order-migration.js";

describe("Chapter Agent tool session", () => {
  test("delegates normalized catalog queries through both list methods", async () => {
    const page = catalogPage();
    const listChapterCatalog = vi.fn(async () => ok(page));
    const repository = repositoryFor({ listChapterCatalog });
    const session = createChapterAgentToolSession({ repository });

    await expect(
      session.listChapters({
        statuses: ["draft", "review"],
        cursor: "cursor-1",
        limit: 25,
        includeDeleted: true
      })
    ).resolves.toEqual(ok(page));
    await expect(session.list()).resolves.toEqual(ok(page));

    expect(listChapterCatalog).toHaveBeenNthCalledWith(1, {
      statuses: ["draft", "review"],
      cursor: "cursor-1",
      limit: 25,
      includeDeleted: true
    });
    expect(listChapterCatalog).toHaveBeenNthCalledWith(2, {});
  });

  test("resolves stable chapter references and delegates reads through both read methods", async () => {
    const chapter = agentRead();
    const readChapterForAgent = vi.fn(async () => ok(chapter));
    const repository = repositoryFor({ readChapterForAgent });
    const session = createChapterAgentToolSession({ repository });

    await expect(session.readChapter("chapter:ch_01")).resolves.toEqual(ok(chapter));
    await expect(session.read({ stableRef: "chapter:chapter-2" })).resolves.toEqual(ok(chapter));

    expect(readChapterForAgent).toHaveBeenNthCalledWith(1, "ch_01");
    expect(readChapterForAgent).toHaveBeenNthCalledWith(2, "chapter-2");
  });

  test("delegates create preparation without synthesizing repository-owned fields", async () => {
    const prepared = createResult();
    const prepareAgentChapterCreate = vi.fn(async () => ok(prepared));
    const createAgentChapter = vi.fn(async () => ok(prepared));
    const repository = repositoryFor({ prepareAgentChapterCreate, createAgentChapter });
    const session = createChapterAgentToolSession({ repository });
    const modelInput = {
      title: "Opening",
      body: "First line",
      volumeId: "volume-1",
      chapterId: "model-owned-id",
      order: 99,
      relativePath: "outside.md",
      serializedContent: "model-owned markdown"
    } as unknown as Parameters<typeof session.prepareCreate>[0];

    const result = await session.prepareCreate(modelInput);

    expect(result).toEqual(ok(prepared));
    expect(prepareAgentChapterCreate).toHaveBeenCalledWith({
      title: "Opening",
      body: "First line",
      volumeId: "volume-1"
    });
    expect(repository.createChapter).not.toHaveBeenCalled();
    expect(createAgentChapter).not.toHaveBeenCalled();

    await expect(session.prepareCreateChapter({ title: "Second" })).resolves.toEqual(ok(prepared));
    expect(prepareAgentChapterCreate).toHaveBeenNthCalledWith(2, { title: "Second" });
  });

  test.each([
    [null, "non-object input"],
    [{ statuses: ["unknown"] }, "unknown status"],
    [{ cursor: 1 }, "non-string cursor"],
    [{ limit: 0 }, "zero limit"],
    [{ limit: 1.5 }, "fractional limit"],
    [{ limit: Number.NaN }, "non-finite limit"],
    [{ includeDeleted: "yes" }, "non-boolean includeDeleted"]
  ])("rejects invalid catalog arguments: %s (%s)", async (input, _label) => {
    const listChapterCatalog = vi.fn(async () => ok(catalogPage()));
    const session = createChapterAgentToolSession({
      repository: repositoryFor({ listChapterCatalog })
    });

    const result = await session.listChapters(input as never);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "CHAPTER_AGENT_LIST_ARGUMENTS_INVALID", category: "ValidationError" }
    });
    expect(listChapterCatalog).not.toHaveBeenCalled();
  });

  test.each([
    "",
    "ch_01",
    "chapter:",
    "chapter:with spaces",
    "chapter:with/slash",
    `chapter:${"a".repeat(129)}`
  ])("rejects an invalid stable chapter reference: %s", async (stableRef) => {
    const readChapterForAgent = vi.fn(async () => ok(agentRead()));
    const session = createChapterAgentToolSession({
      repository: repositoryFor({ readChapterForAgent })
    });

    const result = await session.readChapter(stableRef);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "CHAPTER_AGENT_STABLE_REF_INVALID", category: "ValidationError" }
    });
    expect(readChapterForAgent).not.toHaveBeenCalled();
  });

  test.each([
    [null, "non-object input"],
    [{}, "missing title"],
    [{ title: "   " }, "blank title"],
    [{ title: "a".repeat(513) }, "oversized title"],
    [{ title: "Opening", body: 1 }, "non-string body"],
    [{ title: "Opening", volumeId: "  " }, "blank volumeId"]
  ])("rejects invalid create arguments: %s (%s)", async (input, _label) => {
    const prepareAgentChapterCreate = vi.fn(async () => ok(createResult()));
    const session = createChapterAgentToolSession({
      repository: repositoryFor({ prepareAgentChapterCreate })
    });

    const result = await session.prepareCreate(input as never);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "CHAPTER_AGENT_CREATE_ARGUMENTS_INVALID", category: "ValidationError" }
    });
    expect(prepareAgentChapterCreate).not.toHaveBeenCalled();
  });

  test("requires the formal Agent repository methods instead of legacy fallbacks", async () => {
    const repository = repositoryFor();
    const session = createChapterAgentToolSession({ repository, traceId: "trace-chapter-tools" });

    const listed = await session.listChapters();
    const read = await session.readChapter("chapter:ch_01");
    const prepared = await session.prepareCreate({ title: "Opening" });

    expect(listed).toMatchObject({
      ok: false,
      error: {
        code: "CHAPTER_AGENT_CATALOG_UNAVAILABLE",
        category: "UserError",
        traceId: "trace-chapter-tools"
      }
    });
    expect(read).toMatchObject({
      ok: false,
      error: {
        code: "CHAPTER_AGENT_READ_UNAVAILABLE",
        category: "UserError",
        traceId: "trace-chapter-tools"
      }
    });
    expect(prepared).toMatchObject({
      ok: false,
      error: {
        code: "CHAPTER_AGENT_CREATE_PREPARE_UNAVAILABLE",
        category: "UserError",
        traceId: "trace-chapter-tools"
      }
    });
    expect(repository.listChapters).not.toHaveBeenCalled();
    expect(repository.createChapter).not.toHaveBeenCalled();
  });

  test("delegates and validates the repository migration preview", async () => {
    const preview = buildChapterOrderMigrationPreview({
      chapters: [
        { id: "ch_a", stableRef: "chapter:ch_a", order: 1, status: "draft" as const },
        { id: "ch_b", stableRef: "chapter:ch_b", order: 1, status: "review" as const }
      ]
    });
    const previewChapterOrderMigration = vi.fn(async () => ok(preview));
    const session = createChapterAgentToolSession({
      repository: repositoryFor({ previewChapterOrderMigration }),
      traceId: "trace-migration"
    });

    await expect(session.previewChapterOrderMigration()).resolves.toEqual(ok(preview));
    await expect(session.previewOrderMigration()).resolves.toEqual(ok(preview));
    expect(previewChapterOrderMigration).toHaveBeenCalledTimes(2);
  });

  test("fails closed for migration apply without transaction and approval ports", async () => {
    const preview = buildChapterOrderMigrationPreview({
      chapters: [
        { id: "ch_a", stableRef: "chapter:ch_a", order: 1, status: "draft" as const },
        { id: "ch_b", stableRef: "chapter:ch_b", order: 1, status: "review" as const }
      ]
    });
    const session = createChapterAgentToolSession({ repository: repositoryFor() });

    await expect(session.applyChapterOrderMigration(preview)).resolves.toMatchObject({
      ok: false,
      error: {
        code: "CHAPTER_ORDER_MIGRATION_APPLY_UNAVAILABLE",
        category: "UserError",
        traceId: "chapter-agent-tool-session"
      }
    });
    await expect(session.applyOrderMigration(preview)).resolves.toMatchObject({
      ok: false,
      error: { code: "CHAPTER_ORDER_MIGRATION_APPLY_UNAVAILABLE" }
    });
  });

  test("reports unavailable preview support without falling back to chapter reads", async () => {
    const repository = repositoryFor();
    const session = createChapterAgentToolSession({ repository, traceId: "trace-migration" });

    await expect(session.previewChapterOrderMigration()).resolves.toMatchObject({
      ok: false,
      error: {
        code: "CHAPTER_ORDER_MIGRATION_PREVIEW_UNAVAILABLE",
        traceId: "trace-migration"
      }
    });
    expect(repository.listChapters).not.toHaveBeenCalled();
  });
});

function repositoryFor(
  overrides: Partial<ChapterCatalogRepositoryPort> = {}
): ChapterCatalogRepositoryPort {
  return {
    listChapters: vi.fn(async () => ok([])),
    createChapter: vi.fn(async () => ok(createResult().chapter)),
    ...overrides
  };
}

function catalogPage(): ChapterCatalogPage {
  return {
    items: [catalogItem()],
    catalogRevision: "catalog-revision-1",
    nextCursor: "cursor-2"
  };
}

function agentRead(): ChapterAgentRead {
  return {
    ...catalogItem(),
    body: "First line"
  };
}

function createResult(): CreateAgentChapterResult {
  const item = catalogItem();
  return {
    chapter: {
      frontmatter: item.frontmatter,
      body: "First line"
    },
    item,
    serializedContent: "---\nid: ch_01\n---\n\nFirst line\n",
    relativePath: "chapters/ch_01.md"
  };
}

function catalogItem(): ChapterCatalogPage["items"][number] {
  return {
    stableRef: "chapter:ch_01",
    chapterId: "ch_01",
    id: "ch_01",
    title: "Opening",
    order: 7,
    status: "draft",
    updatedAt: "2026-08-05T00:00:00.000Z",
    frontmatter: {
      schemaVersion: "1.0",
      id: "ch_01",
      type: "chapter",
      title: "Opening",
      order: 7,
      status: "draft",
      volumeId: "volume-1",
      revision: 3,
      createdAt: "2026-08-05T00:00:00.000Z",
      updatedAt: "2026-08-05T00:00:00.000Z"
    },
    resourceRevision: "resource-revision-3",
    revision: 3,
    bodyChecksum: "a".repeat(64),
    checksum: "a".repeat(64),
    persistedChecksum: "b".repeat(64),
    relativePath: "chapters/ch_01.md",
    volumeId: "volume-1",
    catalogRevision: "catalog-revision-1"
  };
}
