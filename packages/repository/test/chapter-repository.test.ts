import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile, mkdir, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, afterEach } from "vitest";

import { isErr, isOk } from "@novel-studio/shared";

import { ChapterFileRepository } from "../src/chapter-repository.js";

const fixtureRoot = join(process.cwd(), "fixtures", "projects", "minimal-chapter");
const tempRoots: string[] = [];

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("ChapterFileRepository", () => {
  test("treats a missing chapters directory as an authoritative empty catalog", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-chapter-empty-"));
    tempRoots.push(projectRoot);
    const repository = new ChapterFileRepository({ projectRoot, traceId: "trace_chapter_empty" });

    expect(await repository.listChapters()).toEqual({ ok: true, value: [] });
  });

  test("reads and writes a chapter fixture through the project folder", async () => {
    const projectRoot = await copyFixtureProject();
    const repository = new ChapterFileRepository({ projectRoot, traceId: "trace_chapter_repo" });

    const loaded = await repository.readChapter("ch_01JZ7P9QK2R6D4W8K3A1B5C9D0");

    expect(isOk(loaded)).toBe(true);
    if (isErr(loaded)) {
      throw new Error(loaded.error.message);
    }

    expect(loaded.value.frontmatter.title).toBe("第一章");
    expect(loaded.value.body).toContain("原始章节正文");

    const updated = {
      ...loaded.value,
      body: `${loaded.value.body}A revised opening paragraph.\n`,
      frontmatter: {
        ...loaded.value.frontmatter,
        updatedAt: "2026-07-04T00:00:00.000Z"
      }
    };
    const saved = await repository.writeChapter(updated);

    expect(isOk(saved)).toBe(true);
    if (isErr(saved)) {
      throw new Error(saved.error.message);
    }

    expect(
      await readFile(join(projectRoot, "chapters", "ch_01JZ7P9QK2R6D4W8K3A1B5C9D0.md"), "utf8")
    ).toContain("A revised opening paragraph.");
  });

  test("lists a stable catalog with pagination and status filtering", async () => {
    const projectRoot = await createChapterProject([
      { id: "ch_a", title: "Alpha", order: 1, status: "draft", body: "one" },
      { id: "ch_b", title: "Beta", order: 2, status: "review", body: "two" },
      { id: "ch_c", title: "Gamma", order: 3, status: "done", body: "three" }
    ]);
    const repository = new ChapterFileRepository({ projectRoot, traceId: "trace_catalog" });

    const first = await repository.listChapterCatalog({ limit: 2 });
    expect(isOk(first)).toBe(true);
    if (isErr(first)) throw new Error(first.error.message);
    expect(first.value.items.map((item) => item.stableRef)).toEqual([
      "chapter:ch_a",
      "chapter:ch_b"
    ]);
    expect(first.value.nextCursor).toEqual(expect.any(String));

    const second = await repository.listChapterCatalog({
      limit: 2,
      cursor: first.value.nextCursor!
    });
    expect(isOk(second)).toBe(true);
    if (isErr(second)) throw new Error(second.error.message);
    expect(second.value.items.map((item) => item.chapterId)).toEqual(["ch_c"]);
    expect(second.value.nextCursor).toBeNull();

    const filtered = await repository.listChapterCatalog({ statuses: ["review"] });
    expect(isOk(filtered)).toBe(true);
    if (isErr(filtered)) throw new Error(filtered.error.message);
    expect(filtered.value.items.map((item) => item.chapterId)).toEqual(["ch_b"]);
  });

  test("hides deleted tombstones by default and includes them explicitly", async () => {
    const projectRoot = await createChapterProject([
      { id: "ch_live", title: "Live", order: 1, status: "draft", body: "live" },
      { id: "ch_deleted", title: "Deleted", order: 2, status: "deleted", body: "old" }
    ]);
    const repository = new ChapterFileRepository({ projectRoot, traceId: "trace_tombstone" });

    const hidden = await repository.listChapterCatalog({});
    expect(isOk(hidden)).toBe(true);
    if (isErr(hidden)) throw new Error(hidden.error.message);
    expect(hidden.value.items.map((item) => item.chapterId)).toEqual(["ch_live"]);

    const explicit = await repository.listChapterCatalog({
      includeDeleted: true,
      statuses: ["deleted"]
    });
    expect(isOk(explicit)).toBe(true);
    if (isErr(explicit)) throw new Error(explicit.error.message);
    expect(explicit.value.items.map((item) => item.chapterId)).toEqual(["ch_deleted"]);
  });

  test("rejects stale and query-mismatched cursors", async () => {
    const projectRoot = await createChapterProject([
      { id: "ch_a", title: "Alpha", order: 1, status: "draft", body: "one" },
      { id: "ch_b", title: "Beta", order: 2, status: "review", body: "two" }
    ]);
    const repository = new ChapterFileRepository({ projectRoot, traceId: "trace_cursor" });
    const first = await repository.listChapterCatalog({ limit: 1 });
    expect(isOk(first)).toBe(true);
    if (isErr(first)) throw new Error(first.error.message);
    const cursor = first.value.nextCursor!;

    const mismatch = await repository.listChapterCatalog({
      limit: 1,
      statuses: ["review"],
      cursor
    });
    expect(!mismatch.ok && mismatch.error.code).toBe("CHAPTER_CATALOG_CURSOR_QUERY_MISMATCH");

    await writeChapterFile(projectRoot, {
      id: "ch_b",
      title: "Beta changed",
      order: 2,
      status: "review",
      body: "two"
    });
    const stale = await repository.listChapterCatalog({ limit: 1, cursor });
    expect(!stale.ok && stale.error.code).toBe("CHAPTER_CATALOG_CURSOR_STALE");
  });

  test("returns stable refs, complete metadata, revisions, and body checksum", async () => {
    const body = "A deterministic body.";
    const projectRoot = await createChapterProject([
      {
        id: "ch_meta",
        title: "Metadata",
        order: 4,
        status: "revision",
        volumeId: "vol_1",
        revision: 7,
        body
      }
    ]);
    const repository = new ChapterFileRepository({ projectRoot, traceId: "trace_metadata" });
    const listed = await repository.listChapterCatalog({});
    expect(isOk(listed)).toBe(true);
    if (isErr(listed)) throw new Error(listed.error.message);
    const item = listed.value.items[0]!;
    expect(item.stableRef).toBe("chapter:ch_meta");
    expect(item.frontmatter).toMatchObject({ id: "ch_meta", volumeId: "vol_1", revision: 7 });
    expect(item.revision).toBe(7);
    const agentRead = await repository.readChapterForAgent("ch_meta");
    expect(isOk(agentRead)).toBe(true);
    if (isErr(agentRead)) throw new Error(agentRead.error.message);
    expect(item.bodyChecksum).toBe(
      createHash("sha256").update(agentRead.value.body, "utf8").digest("hex")
    );
    expect(item.checksum).toBe(item.bodyChecksum);
    expect(item.resourceRevision).toMatch(/^[a-f0-9]{64}$/u);
    expect(item.persistedChecksum).toBe(item.resourceRevision);
    expect(item.relativePath).toBe("chapters/ch_meta.md");
    expect(item.catalogRevision).toBe(listed.value.catalogRevision);
  });

  test("prepares an agent create without writing and returns exact serialized markdown", async () => {
    const projectRoot = await createChapterProject([
      { id: "ch_existing", title: "Existing", order: 1, status: "draft", body: "body" }
    ]);
    const repository = new ChapterFileRepository({
      projectRoot,
      traceId: "trace_prepare",
      now: () => "2026-08-05T00:00:00.000Z"
    });
    const before = await readdir(join(projectRoot, "chapters"));
    const prepared = await repository.prepareAgentChapterCreate({
      title: "Prepared",
      body: "new body",
      volumeId: "vol_2"
    });
    expect(isOk(prepared)).toBe(true);
    if (isErr(prepared)) throw new Error(prepared.error.message);
    expect(await readdir(join(projectRoot, "chapters"))).toEqual(before);
    expect(prepared.value.chapter.frontmatter.order).toBe(2);
    expect(prepared.value.serializedContent).toBe(
      `---\nschemaVersion: '1.0'\nid: ${prepared.value.chapter.frontmatter.id}\ntype: chapter\ntitle: Prepared\norder: 2\nstatus: draft\nvolumeId: vol_2\nwordCount: 2\nrevision: 1\ncreatedAt: '2026-08-05T00:00:00.000Z'\nupdatedAt: '2026-08-05T00:00:00.000Z'\n---\n\nnew body\n`
    );
    await expect(
      readFile(join(projectRoot, prepared.value.relativePath), "utf8")
    ).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  test("allocates after a deleted highest-order chapter", async () => {
    const projectRoot = await createChapterProject([
      { id: "ch_live", title: "Live", order: 1, status: "draft", body: "live" },
      { id: "ch_deleted", title: "Deleted", order: 9, status: "deleted", body: "old" }
    ]);
    const repository = new ChapterFileRepository({ projectRoot, traceId: "trace_append" });
    const created = await repository.createAgentChapter({ title: "Next", body: "next" });
    expect(isOk(created)).toBe(true);
    if (isErr(created)) throw new Error(created.error.message);
    expect(created.value.chapter.frontmatter.order).toBe(10);
  });

  test("rejects a prepared create when the catalog changed before apply", async () => {
    const projectRoot = await createChapterProject([
      { id: "ch_existing", title: "Existing", order: 1, status: "draft", body: "body" }
    ]);
    const repository = new ChapterFileRepository({ projectRoot, traceId: "trace_create_cas" });
    const prepared = await repository.prepareAgentChapterCreate({ title: "Prepared" });
    expect(isOk(prepared)).toBe(true);
    if (isErr(prepared)) throw new Error(prepared.error.message);

    const competing = await repository.createChapter({
      chapterId: "ch_competing",
      title: "Competing",
      order: 2,
      body: "winner"
    });
    expect(isOk(competing)).toBe(true);

    const applied = await repository.applyPreparedAgentChapterCreate(prepared.value);
    expect(!applied.ok && applied.error.code).toBe("CHAPTER_CATALOG_CAS_CONFLICT");
    await expect(
      readFile(join(projectRoot, prepared.value.relativePath), "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("rejects prepared bytes that alter repository-owned metadata", async () => {
    const projectRoot = await createChapterProject([]);
    const repository = new ChapterFileRepository({ projectRoot, traceId: "trace_create_metadata" });
    const prepared = await repository.prepareAgentChapterCreate({
      title: "Prepared",
      body: "body"
    });
    expect(isOk(prepared)).toBe(true);
    if (isErr(prepared)) throw new Error(prepared.error.message);
    const tampered = {
      ...prepared.value,
      chapter: {
        ...prepared.value.chapter,
        frontmatter: { ...prepared.value.chapter.frontmatter, order: 99 }
      }
    };
    const applied = await repository.applyPreparedAgentChapterCreate(tampered);
    expect(!applied.ok && applied.error.code).toBe("CHAPTER_CREATE_METADATA_INVALID");
  });

  test("validates a serialized create operation against the current catalog revision", async () => {
    const projectRoot = await createChapterProject([]);
    const repository = new ChapterFileRepository({
      projectRoot,
      traceId: "trace_create_operation"
    });
    const prepared = await repository.prepareAgentChapterCreate({ title: "Prepared" });
    expect(isOk(prepared)).toBe(true);
    if (isErr(prepared)) throw new Error(prepared.error.message);

    expect(
      await repository.validateAgentChapterCreateOperation({
        relativePath: prepared.value.relativePath,
        content: prepared.value.serializedContent,
        catalogRevision: prepared.value.item.catalogRevision
      })
    ).toMatchObject({ ok: true });

    const competing = await repository.createChapter({
      chapterId: "ch_competing",
      title: "Competing",
      order: 1
    });
    expect(isOk(competing)).toBe(true);
    expect(
      await repository.validateAgentChapterCreateOperation({
        relativePath: prepared.value.relativePath,
        content: prepared.value.serializedContent,
        catalogRevision: prepared.value.item.catalogRevision
      })
    ).toMatchObject({ ok: false, error: { code: "CHAPTER_CATALOG_CAS_CONFLICT" } });
  });

  test.each([
    {
      name: "duplicate",
      chapters: [
        { id: "ch_one", title: "One", order: 1, status: "draft" as const, body: "one" },
        { id: "ch_two", title: "Two", order: 1, status: "draft" as const, body: "two" }
      ]
    },
    {
      name: "invalid",
      chapters: [
        { id: "ch_invalid", title: "Invalid", order: 0, status: "draft" as const, body: "bad" }
      ]
    }
  ])("keeps reads usable but rejects $name order creates until migration", async ({ chapters }) => {
    const projectRoot = await createChapterProject(chapters);
    const repository = new ChapterFileRepository({ projectRoot, traceId: "trace_migration_guard" });

    const catalog = await repository.listChapterCatalog({ includeDeleted: true });
    expect(isOk(catalog)).toBe(true);
    if (isErr(catalog)) throw new Error(catalog.error.message);
    expect(catalog.value.items.length).toBe(chapters.length);
    const readable = await repository.readChapterForAgent(chapters[0]!.id);
    expect(isOk(readable)).toBe(true);

    const create = await repository.createAgentChapter({ title: "Blocked" });
    expect(!create.ok && create.error.code).toBe("CHAPTER_ORDER_MIGRATION_REQUIRED");
  });
});

type TestChapter = {
  id: string;
  title: string;
  order: number;
  status: "draft" | "revision" | "review" | "done" | "archived" | "deleted";
  body?: string;
  volumeId?: string;
  revision?: number;
};

async function createChapterProject(chapters: readonly TestChapter[]): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-chapter-catalog-"));
  tempRoots.push(projectRoot);
  await mkdir(join(projectRoot, "chapters"), { recursive: true });
  for (const chapter of chapters) await writeChapterFile(projectRoot, chapter);
  return projectRoot;
}

async function writeChapterFile(projectRoot: string, chapter: TestChapter): Promise<void> {
  const lines = [
    "---",
    'schemaVersion: "1.0"',
    `id: "${chapter.id}"`,
    'type: "chapter"',
    `title: "${chapter.title}"`,
    `order: ${chapter.order}`,
    `status: "${chapter.status}"`,
    ...(chapter.volumeId === undefined ? [] : [`volumeId: "${chapter.volumeId}"`]),
    ...(chapter.revision === undefined ? [] : [`revision: ${chapter.revision}`]),
    'createdAt: "2026-08-01T00:00:00.000Z"',
    'updatedAt: "2026-08-01T00:00:00.000Z"',
    "---",
    "",
    chapter.body ?? ""
  ];
  await writeFile(
    join(projectRoot, "chapters", `${chapter.id}.md`),
    `${lines.join("\n")}\n`,
    "utf8"
  );
}

async function copyFixtureProject(): Promise<string> {
  const target = await mkdtemp(join(tmpdir(), "novel-studio-chapter-"));
  tempRoots.push(target);
  await mkdir(join(target, "chapters"), { recursive: true });
  await writeFile(join(target, "project.json"), await readFile(join(fixtureRoot, "project.json")));
  await writeFile(
    join(target, "settings.json"),
    await readFile(join(fixtureRoot, "settings.json"))
  );
  await writeFile(
    join(target, "chapters", "ch_01JZ7P9QK2R6D4W8K3A1B5C9D0.md"),
    await readFile(join(fixtureRoot, "chapters", "ch_01JZ7P9QK2R6D4W8K3A1B5C9D0.md"))
  );
  return target;
}
