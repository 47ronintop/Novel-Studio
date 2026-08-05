import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";

import { err, ok, type JsonObject, type Result, type UnifiedError } from "@novel-studio/shared";
import type {
  ChapterCatalogRepositoryPort,
  ChapterAgentCatalogItem,
  ChapterAgentRead,
  ChapterCatalogListInput,
  ChapterCatalogPage,
  ChapterDocument,
  ChapterDraftRepositoryPort,
  ChapterMaintenanceRepositoryPort,
  ChapterSummary,
  ChapterOrderMigrationPreview,
  CreateAgentChapterInput,
  CreateAgentChapterResult,
  CreateChapterInput,
  DeleteChapterInput,
  DuplicateChapterInput,
  RenameChapterInput
} from "@novel-studio/shared";

import { writeTextAtomically } from "./atomic-write.js";
import { storageError, validationError } from "./errors.js";
import { validateWithSchema } from "./schema-validation.js";

const require = createRequire(import.meta.url);
const { dump: dumpYaml, load: loadYaml } = require("js-yaml") as {
  dump(
    input: unknown,
    options?: { lineWidth?: number; noRefs?: boolean; sortKeys?: boolean }
  ): string;
  load(input: string): unknown;
};

export interface ChapterFileRepositoryOptions {
  projectRoot: string;
  traceId?: string;
  now?: () => string;
}

export class ChapterFileRepository
  implements
    ChapterDraftRepositoryPort,
    ChapterCatalogRepositoryPort,
    ChapterMaintenanceRepositoryPort
{
  private readonly traceId: string;

  public constructor(private readonly options: ChapterFileRepositoryOptions) {
    this.traceId = options.traceId ?? "trace_repository_chapter";
  }

  public async readChapter(chapterId: string): Promise<Result<ChapterDocument, UnifiedError>> {
    const filePath = join(this.options.projectRoot, "chapters", `${chapterId}.md`);
    let fileText: string;

    try {
      fileText = await readFile(filePath, "utf8");
    } catch (error) {
      return err(
        storageError({
          code: "CHAPTER_FILE_MISSING",
          message: "Chapter file could not be read.",
          suggestedAction: "Restore the chapter file or choose a valid project folder.",
          traceId: this.traceId,
          redactedDetail: {
            filePath,
            reason: error instanceof Error ? error.message : "Unknown read error"
          }
        })
      );
    }

    const parsed = parseChapterDocument(fileText, this.traceId);
    if (!parsed.ok) {
      return parsed;
    }

    if (parsed.value.frontmatter.id !== chapterId) {
      return err(
        validationError({
          code: "CHAPTER_FILE_INVALID",
          message: "Chapter frontmatter id does not match the requested chapter.",
          suggestedAction: "Fix the chapter frontmatter id and retry opening the project.",
          traceId: this.traceId,
          redactedDetail: {
            filePath,
            requestedChapterId: chapterId,
            frontmatterId: parsed.value.frontmatter.id
          }
        })
      );
    }

    const validation = await validateWithSchema("chapter-frontmatter", parsed.value.frontmatter);
    if (!validation.valid) {
      return err(
        validationError({
          code: "CHAPTER_FILE_INVALID",
          message: "Chapter frontmatter failed schema validation.",
          suggestedAction: "Fix the chapter frontmatter and retry opening the project.",
          traceId: this.traceId,
          redactedDetail: {
            filePath,
            issues: validation.issues.map((issue) => ({
              instancePath: issue.instancePath,
              schemaPath: issue.schemaPath,
              keyword: issue.keyword,
              message: issue.message
            }))
          }
        })
      );
    }

    return ok(parsed.value);
  }

  public async listChapters(): Promise<Result<readonly ChapterSummary[], UnifiedError>> {
    const chaptersDirectory = join(this.options.projectRoot, "chapters");
    let entries: readonly string[];

    try {
      entries = await readdir(chaptersDirectory);
    } catch (error) {
      if (isMissingPathError(error)) return ok([]);
      return err(
        storageError({
          code: "CHAPTER_DIRECTORY_MISSING",
          message: "Chapter directory could not be read.",
          suggestedAction: "Open a valid project folder or create a project first.",
          traceId: this.traceId,
          redactedDetail: {
            reason: error instanceof Error ? error.message : "Unknown readdir error"
          }
        })
      );
    }

    const summaries: ChapterSummary[] = [];
    for (const entry of entries.filter((name) => name.endsWith(".md"))) {
      const chapterId = entry.slice(0, -3);
      const chapter = await this.readChapter(chapterId);
      if (!chapter.ok) {
        return chapter;
      }

      summaries.push({
        id: chapter.value.frontmatter.id,
        title: chapter.value.frontmatter.title,
        order: chapter.value.frontmatter.order,
        status: chapter.value.frontmatter.status,
        updatedAt: chapter.value.frontmatter.updatedAt,
        ...(chapter.value.frontmatter.wordCount === undefined
          ? {}
          : { wordCount: chapter.value.frontmatter.wordCount })
      });
    }

    return ok(
      summaries
        .filter((chapter) => chapter.status !== "deleted")
        .sort((left, right) => left.order - right.order || left.title.localeCompare(right.title))
    );
  }

  /**
   * Agent catalog projection. This deliberately does not call the compact UI list: deleted
   * tombstones and exact persisted-byte revisions must participate in the catalog checksum.
   */
  public async listChapterCatalog(
    input: ChapterCatalogListInput = {}
  ): Promise<Result<ChapterCatalogPage, UnifiedError>> {
    const normalized = normalizeChapterCatalogInput(input, this.traceId);
    if (!normalized.ok) return normalized;
    const records = await this.readChapterCatalogRecords();
    if (!records.ok) return records;
    const catalogRevision = chapterCatalogRevision(records.value);
    const filtered = records.value
      .filter((record) => {
        if (!normalized.value.includeDeleted && record.status === "deleted") return false;
        return (
          normalized.value.statuses.length === 0 ||
          normalized.value.statuses.includes(record.status)
        );
      })
      .sort(compareChapterCatalogRecords);

    let startIndex = 0;
    if (normalized.value.cursor !== undefined) {
      const cursor = parseChapterCatalogCursor(normalized.value.cursor, this.traceId);
      if (!cursor.ok) return cursor;
      if (cursor.value.catalogRevision !== catalogRevision) {
        return err(
          validationError({
            code: "CHAPTER_CATALOG_CURSOR_STALE",
            message: "The chapter catalog changed while the result set was being paged.",
            suggestedAction: "Restart chapter pagination from the first page.",
            traceId: this.traceId
          })
        );
      }
      if (cursor.value.querySignature !== normalized.value.querySignature) {
        return err(
          validationError({
            code: "CHAPTER_CATALOG_CURSOR_QUERY_MISMATCH",
            message: "The chapter cursor belongs to a different catalog query.",
            suggestedAction: "Restart chapter pagination with the original filters.",
            traceId: this.traceId
          })
        );
      }
      const cursorIndex = filtered.findIndex(
        (record) => chapterCatalogSortKey(record) === cursor.value.last
      );
      if (cursorIndex < 0) {
        return err(
          validationError({
            code: "CHAPTER_CATALOG_CURSOR_INVALID",
            message: "The chapter cursor does not identify an item in this result set.",
            suggestedAction: "Restart chapter pagination from the first page.",
            traceId: this.traceId
          })
        );
      }
      startIndex = cursorIndex + 1;
    }

    const page = filtered.slice(startIndex, startIndex + normalized.value.limit);
    const last = page.at(-1);
    const hasNext = startIndex + page.length < filtered.length;
    const nextCursor =
      hasNext && last !== undefined
        ? createChapterCatalogCursor({
            catalogRevision,
            querySignature: normalized.value.querySignature,
            last: chapterCatalogSortKey(last)
          })
        : null;
    return ok({
      items: page.map((record) => chapterCatalogItem(record, catalogRevision)),
      catalogRevision,
      nextCursor
    });
  }

  /** Full chapter read for Agent tools, including frontmatter and exact byte revisions. */
  public async readChapterForAgent(
    chapterId: string
  ): Promise<Result<ChapterAgentRead, UnifiedError>> {
    if (!isValidChapterId(chapterId)) {
      return err(
        validationError({
          code: "CHAPTER_ID_INVALID",
          message: "Chapter id is invalid.",
          suggestedAction: "Use a stable chapter reference returned by list_chapters.",
          traceId: this.traceId
        })
      );
    }
    const records = await this.readChapterCatalogRecords();
    if (!records.ok) return records;
    const record = records.value.find((candidate) => candidate.id === chapterId);
    if (record === undefined) {
      return err(
        storageError({
          code: "CHAPTER_FILE_MISSING",
          message: "Chapter file could not be read.",
          suggestedAction: "Refresh the chapter catalog and choose an existing chapter.",
          traceId: this.traceId,
          redactedDetail: { chapterId }
        })
      );
    }
    const catalogRevision = chapterCatalogRevision(records.value);
    return ok({ ...chapterCatalogItem(record, catalogRevision), body: record.body });
  }

  /** Alias retained for adapters that name the operation as an Agent catalog read. */
  public async listChaptersForAgent(
    input: ChapterCatalogListInput = {}
  ): Promise<Result<ChapterCatalogPage, UnifiedError>> {
    return this.listChapterCatalog(input);
  }

  /**
   * Formal application-owned chapter creation path. The caller supplies only user content; all
   * identity, path, timestamp, status and order fields are allocated here.
   */
  public async prepareAgentChapterCreate(
    input: CreateAgentChapterInput
  ): Promise<Result<CreateAgentChapterResult, UnifiedError>> {
    const title = input.title.trim();
    if (title.length === 0 || title.length > 512) {
      return err(
        validationError({
          code: "CHAPTER_TITLE_INVALID",
          message: "Chapter title must contain 1 to 512 characters.",
          suggestedAction: "Provide a shorter, non-empty chapter title.",
          traceId: this.traceId
        })
      );
    }
    const records = await this.readChapterCatalogRecords();
    if (!records.ok) return records;
    const migration = buildLocalOrderMigrationPreview(records.value);
    if (migration.required) {
      return err(
        validationError({
          code: "CHAPTER_ORDER_MIGRATION_REQUIRED",
          message: "Chapter order metadata requires an explicit migration before creation.",
          suggestedAction: "Review and apply the chapter order migration, then retry.",
          traceId: this.traceId,
          redactedDetail: {
            preview: JSON.parse(JSON.stringify(migration)) as unknown as JsonObject
          }
        })
      );
    }
    const now = this.options.now?.() ?? new Date().toISOString();
    const chapterId = createChapterId();
    const order = nextChapterAppendOrder(records.value);
    const chapter: ChapterDocument = {
      frontmatter: {
        schemaVersion: "1.0",
        id: chapterId,
        type: "chapter",
        title,
        order,
        status: "draft",
        ...(input.volumeId === undefined ? {} : { volumeId: input.volumeId }),
        wordCount: countWords(input.body ?? ""),
        revision: 1,
        createdAt: now,
        updatedAt: now
      },
      body: input.body ?? ""
    };
    const serializedContent = formatChapterDocument(chapter);
    const syntheticRecord = recordFromChapter(chapter, serializedContent);
    const item = chapterCatalogItem(syntheticRecord, chapterCatalogRevision(records.value));
    return ok({
      chapter,
      item,
      serializedContent,
      relativePath: `chapters/${chapterId}.md`
    });
  }

  /** Apply a previously validated formal create through the repository writer. */
  public async createAgentChapter(
    input: CreateAgentChapterInput
  ): Promise<Result<CreateAgentChapterResult, UnifiedError>> {
    const prepared = await this.prepareAgentChapterCreate(input);
    if (!prepared.ok) return prepared;
    const written = await this.writeChapter(prepared.value.chapter);
    if (!written.ok) return written;
    const read = await this.readChapterForAgent(prepared.value.chapter.frontmatter.id);
    if (!read.ok) return read;
    return ok({
      chapter: written.value,
      item: read.value,
      serializedContent: prepared.value.serializedContent,
      relativePath: prepared.value.relativePath
    });
  }

  /** Read-only migration preview; applying it is intentionally a separate approved operation. */
  public async previewChapterOrderMigration(): Promise<
    Result<ChapterOrderMigrationPreview, UnifiedError>
  > {
    const records = await this.readChapterCatalogRecords();
    if (!records.ok) return records;
    return ok(buildLocalOrderMigrationPreview(records.value));
  }

  public async createChapter(
    input: CreateChapterInput
  ): Promise<Result<ChapterDocument, UnifiedError>> {
    if (!isValidChapterId(input.chapterId)) {
      return err(
        validationError({
          code: "CHAPTER_ID_INVALID",
          message: "Chapter id is invalid.",
          suggestedAction: "Use a stable id beginning with ch_.",
          traceId: this.traceId,
          redactedDetail: { chapterId: input.chapterId }
        })
      );
    }
    const catalog = await this.readChapterCatalogRecords();
    if (!catalog.ok) return catalog;
    const migration = buildLocalOrderMigrationPreview(catalog.value);
    if (migration.required) {
      return err(
        validationError({
          code: "CHAPTER_ORDER_MIGRATION_REQUIRED",
          message: "Chapter order metadata requires an explicit migration before creation.",
          suggestedAction: "Review and apply the chapter order migration, then retry.",
          traceId: this.traceId,
          redactedDetail: {
            preview: JSON.parse(JSON.stringify(migration)) as unknown as JsonObject
          }
        })
      );
    }
    const now = this.options.now?.() ?? new Date().toISOString();
    const order = input.order ?? (await this.nextChapterOrder());
    if (!Number.isSafeInteger(order) || order < 1) {
      return err(
        validationError({
          code: "CHAPTER_ORDER_INVALID",
          message: "Chapter order must be a positive integer.",
          suggestedAction: "Choose a valid chapter order and retry.",
          traceId: this.traceId
        })
      );
    }
    if (catalog.value.some((chapter) => chapter.order === order)) {
      return err(
        validationError({
          code: "CHAPTER_ORDER_CONFLICT",
          message: "Chapter order is already occupied, including deleted tombstones.",
          suggestedAction: "Choose another order or use the reorder operation.",
          traceId: this.traceId,
          redactedDetail: { order }
        })
      );
    }
    const chapter: ChapterDocument = {
      frontmatter: {
        schemaVersion: "1.0",
        id: input.chapterId,
        type: "chapter",
        title: input.title,
        order,
        status: input.status ?? "draft",
        wordCount: countWords(input.body ?? ""),
        createdAt: now,
        updatedAt: now
      },
      body: input.body ?? ""
    };

    const existing = await fileExists(
      join(this.options.projectRoot, "chapters", `${input.chapterId}.md`)
    );
    if (existing) {
      return err(
        storageError({
          code: "CHAPTER_ALREADY_EXISTS",
          message: "Chapter file already exists.",
          suggestedAction: "Choose a new chapter id or open the existing chapter.",
          traceId: this.traceId,
          redactedDetail: { chapterId: input.chapterId }
        })
      );
    }

    try {
      await mkdir(join(this.options.projectRoot, "chapters"), { recursive: true });
    } catch (error) {
      return err(
        storageError({
          code: "CHAPTER_CREATE_FAILED",
          message: "Chapter directory could not be created.",
          suggestedAction: "Choose a writable project folder and retry.",
          traceId: this.traceId,
          redactedDetail: {
            reason: error instanceof Error ? error.message : "Unknown mkdir error"
          }
        })
      );
    }

    return this.writeChapter(chapter);
  }

  public async renameChapter(
    input: RenameChapterInput
  ): Promise<Result<ChapterDocument, UnifiedError>> {
    const loaded = await this.readChapter(input.chapterId);
    if (!loaded.ok) {
      return loaded;
    }

    return this.writeChapter({
      ...loaded.value,
      frontmatter: {
        ...loaded.value.frontmatter,
        title: input.title,
        updatedAt: this.options.now?.() ?? new Date().toISOString()
      }
    });
  }

  public async duplicateChapter(
    input: DuplicateChapterInput
  ): Promise<Result<ChapterDocument, UnifiedError>> {
    const loaded = await this.readChapter(input.sourceChapterId);
    if (!loaded.ok) {
      return loaded;
    }

    return this.createChapter({
      chapterId: input.chapterId,
      title: input.title,
      body: loaded.value.body,
      status: "draft"
    });
  }

  public async deleteChapter(
    input: DeleteChapterInput
  ): Promise<Result<ChapterDocument, UnifiedError>> {
    const loaded = await this.readChapter(input.chapterId);
    if (!loaded.ok) {
      return loaded;
    }

    return this.writeChapter({
      ...loaded.value,
      frontmatter: {
        ...loaded.value.frontmatter,
        status: "deleted",
        updatedAt: this.options.now?.() ?? new Date().toISOString()
      }
    });
  }

  private async readChapterCatalogRecords(): Promise<
    Result<readonly ChapterCatalogRecord[], UnifiedError>
  > {
    const chaptersDirectory = join(this.options.projectRoot, "chapters");
    let entries: readonly string[];
    try {
      entries = await readdir(chaptersDirectory);
    } catch (error) {
      if (isMissingPathError(error)) return ok([]);
      return err(
        storageError({
          code: "CHAPTER_DIRECTORY_MISSING",
          message: "Chapter directory could not be read.",
          suggestedAction: "Open a valid project folder or create a project first.",
          traceId: this.traceId,
          redactedDetail: {
            reason: error instanceof Error ? error.message : "Unknown readdir error"
          }
        })
      );
    }

    const records: ChapterCatalogRecord[] = [];
    for (const entry of entries.filter((name) => name.endsWith(".md")).sort(compareIds)) {
      const chapterId = entry.slice(0, -3);
      if (!isValidChapterId(chapterId)) {
        return err(
          validationError({
            code: "CHAPTER_FILE_INVALID",
            message: "Chapter file name does not contain a valid stable chapter id.",
            suggestedAction: "Rename the chapter file through the project migration tool.",
            traceId: this.traceId,
            redactedDetail: { relativePath: `chapters/${entry}` }
          })
        );
      }
      const filePath = join(chaptersDirectory, entry);
      let raw: string;
      try {
        raw = await readFile(filePath, "utf8");
      } catch (error) {
        return err(
          storageError({
            code: "CHAPTER_FILE_MISSING",
            message: "Chapter file could not be read.",
            suggestedAction: "Restore the chapter file and refresh the catalog.",
            traceId: this.traceId,
            redactedDetail: {
              relativePath: `chapters/${entry}`,
              reason: error instanceof Error ? error.message : "Unknown read error"
            }
          })
        );
      }
      const parsed = parseChapterDocument(raw, this.traceId);
      if (!parsed.ok) return parsed;
      if (parsed.value.frontmatter.id !== chapterId) {
        return err(
          validationError({
            code: "CHAPTER_FILE_INVALID",
            message: "Chapter frontmatter id does not match its file name.",
            suggestedAction: "Fix the chapter frontmatter id or file name, then retry.",
            traceId: this.traceId,
            redactedDetail: { relativePath: `chapters/${entry}` }
          })
        );
      }
      const frontmatter = parsed.value.frontmatter;
      if (
        typeof frontmatter.title !== "string" ||
        frontmatter.title.trim().length === 0 ||
        !isChapterStatus(frontmatter.status)
      ) {
        return err(
          validationError({
            code: "CHAPTER_FILE_INVALID",
            message: "Chapter frontmatter is missing a valid title or status.",
            suggestedAction: "Fix the chapter frontmatter and retry.",
            traceId: this.traceId,
            redactedDetail: { relativePath: `chapters/${entry}` }
          })
        );
      }
      records.push({
        id: chapterId,
        title: frontmatter.title,
        order: typeof frontmatter.order === "number" ? frontmatter.order : Number.NaN,
        status: frontmatter.status,
        updatedAt: frontmatter.updatedAt,
        revision:
          typeof frontmatter.revision === "number" &&
          Number.isSafeInteger(frontmatter.revision) &&
          frontmatter.revision >= 1
            ? frontmatter.revision
            : 1,
        frontmatter: cloneJsonObject(frontmatter),
        body: parsed.value.body,
        raw,
        relativePath: `chapters/${entry}`,
        resourceRevision: checksumText(raw),
        bodyChecksum: checksumText(parsed.value.body),
        ...(typeof frontmatter.volumeId === "string" ? { volumeId: frontmatter.volumeId } : {}),
        ...(typeof frontmatter.wordCount === "number" ? { wordCount: frontmatter.wordCount } : {})
      });
    }
    return ok(records);
  }

  private async nextChapterOrder(): Promise<number> {
    const chapters = await this.readChapterCatalogRecords();
    if (!chapters.ok || chapters.value.length === 0) return 1;
    return nextChapterAppendOrder(chapters.value);
  }

  public async writeChapter(
    chapter: ChapterDocument
  ): Promise<Result<ChapterDocument, UnifiedError>> {
    const validation = await validateWithSchema("chapter-frontmatter", chapter.frontmatter);
    if (!validation.valid) {
      return err(
        validationError({
          code: "CHAPTER_FILE_INVALID",
          message: "Chapter frontmatter failed schema validation.",
          suggestedAction: "Fix the chapter content and retry saving.",
          traceId: this.traceId,
          redactedDetail: {
            chapterId: chapter.frontmatter.id,
            issues: validation.issues.map((issue) => ({
              instancePath: issue.instancePath,
              schemaPath: issue.schemaPath,
              keyword: issue.keyword,
              message: issue.message
            }))
          }
        })
      );
    }

    const fileText = formatChapterDocument(chapter);
    const writeResult = await writeTextAtomically({
      targetPath: join(this.options.projectRoot, "chapters", `${chapter.frontmatter.id}.md`),
      content: fileText,
      traceId: this.traceId
    });

    if (!writeResult.ok) {
      return writeResult;
    }

    return ok(chapter);
  }
}

interface ChapterCatalogRecord {
  readonly id: string;
  readonly title: string;
  readonly order: number;
  readonly status: ChapterDocument["frontmatter"]["status"];
  readonly volumeId?: string;
  readonly updatedAt: string;
  readonly wordCount?: number;
  readonly revision: number;
  readonly frontmatter: ChapterDocument["frontmatter"];
  readonly body: string;
  readonly raw: string;
  readonly relativePath: string;
  readonly resourceRevision: string;
  readonly bodyChecksum: string;
}

interface NormalizedChapterCatalogInput {
  readonly statuses: readonly ChapterDocument["frontmatter"]["status"][];
  readonly includeDeleted: boolean;
  readonly limit: number;
  readonly cursor?: string;
  readonly querySignature: string;
}

interface ChapterCatalogCursorPayload {
  readonly version: 1;
  readonly sortVersion: "order-title-id-v1";
  readonly catalogRevision: string;
  readonly querySignature: string;
  readonly last: string;
}

function normalizeChapterCatalogInput(
  input: ChapterCatalogListInput,
  traceId: string
): Result<NormalizedChapterCatalogInput, UnifiedError> {
  const limit = input.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    return err(
      validationError({
        code: "CHAPTER_CATALOG_LIMIT_INVALID",
        message: "Chapter page size must be an integer from 1 to 100.",
        suggestedAction: "Use a page size between 1 and 100.",
        traceId
      })
    );
  }
  const allowedStatuses: readonly ChapterDocument["frontmatter"]["status"][] = [
    "draft",
    "revision",
    "review",
    "done",
    "archived",
    "deleted"
  ];
  const statuses = [...new Set(input.statuses ?? [])];
  if (statuses.some((status) => !allowedStatuses.includes(status))) {
    return err(
      validationError({
        code: "CHAPTER_CATALOG_STATUS_INVALID",
        message: "Chapter status filters contain an unsupported value.",
        suggestedAction: "Use a supported chapter status.",
        traceId
      })
    );
  }
  if (input.cursor !== undefined && (input.cursor.length === 0 || input.cursor.length > 4096)) {
    return err(
      validationError({
        code: "CHAPTER_CATALOG_CURSOR_INVALID",
        message: "The chapter catalog cursor is malformed.",
        suggestedAction: "Restart chapter pagination from the first page.",
        traceId
      })
    );
  }
  const includeDeleted = input.includeDeleted === true;
  const normalizedStatuses = statuses.sort(compareIds);
  const querySignature = checksumText(
    JSON.stringify({
      statuses: normalizedStatuses,
      includeDeleted,
      sortVersion: "order-title-id-v1"
    })
  );
  return ok({
    statuses: normalizedStatuses,
    includeDeleted,
    limit,
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    querySignature
  });
}

function chapterCatalogRevision(records: readonly ChapterCatalogRecord[]): string {
  return checksumText(
    JSON.stringify(
      [...records].sort(compareChapterCatalogRecords).map((record) => ({
        id: record.id,
        title: record.title,
        order: record.order,
        status: record.status,
        volumeId: record.volumeId ?? null,
        revision: record.revision,
        resourceRevision: record.resourceRevision,
        bodyChecksum: record.bodyChecksum
      }))
    )
  );
}

function chapterCatalogSortKey(record: ChapterCatalogRecord): string {
  const order = Number.isFinite(record.order) ? String(record.order).padStart(12, "0") : "~";
  return `${order}\u0000${record.title.normalize("NFKC").toLocaleLowerCase("zh-CN")}\u0000${record.id}`;
}

function compareChapterCatalogRecords(
  left: ChapterCatalogRecord,
  right: ChapterCatalogRecord
): number {
  return (
    safeOrder(left.order) - safeOrder(right.order) ||
    left.title.localeCompare(right.title, "zh-CN") ||
    compareIds(left.id, right.id)
  );
}

function chapterCatalogItem(
  record: ChapterCatalogRecord,
  catalogRevision: string
): ChapterAgentCatalogItem {
  return {
    stableRef: `chapter:${record.id}`,
    chapterId: record.id,
    id: record.id,
    title: record.title,
    order: record.order,
    status: record.status,
    updatedAt: record.updatedAt,
    frontmatter: cloneJsonObject(record.frontmatter),
    resourceRevision: record.resourceRevision,
    revision: record.revision,
    bodyChecksum: record.bodyChecksum,
    checksum: record.bodyChecksum,
    persistedChecksum: record.resourceRevision,
    relativePath: record.relativePath,
    ...(record.volumeId === undefined ? {} : { volumeId: record.volumeId }),
    ...(record.wordCount === undefined ? {} : { wordCount: record.wordCount }),
    catalogRevision
  };
}

function recordFromChapter(
  chapter: ChapterDocument,
  serializedContent: string
): ChapterCatalogRecord {
  const frontmatter = cloneJsonObject(chapter.frontmatter);
  return {
    id: chapter.frontmatter.id,
    title: chapter.frontmatter.title,
    order: chapter.frontmatter.order,
    status: chapter.frontmatter.status,
    updatedAt: chapter.frontmatter.updatedAt,
    revision:
      typeof chapter.frontmatter.revision === "number" &&
      Number.isSafeInteger(chapter.frontmatter.revision) &&
      chapter.frontmatter.revision >= 1
        ? chapter.frontmatter.revision
        : 1,
    frontmatter,
    body: chapter.body,
    raw: serializedContent,
    relativePath: `chapters/${chapter.frontmatter.id}.md`,
    resourceRevision: checksumText(serializedContent),
    bodyChecksum: checksumText(chapter.body),
    ...(chapter.frontmatter.volumeId === undefined
      ? {}
      : { volumeId: chapter.frontmatter.volumeId }),
    ...(chapter.frontmatter.wordCount === undefined
      ? {}
      : { wordCount: chapter.frontmatter.wordCount })
  };
}

function createChapterCatalogCursor(input: {
  readonly catalogRevision: string;
  readonly querySignature: string;
  readonly last: string;
}): string {
  const payload: ChapterCatalogCursorPayload = {
    version: 1,
    sortVersion: "order-title-id-v1",
    ...input
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function parseChapterCatalogCursor(
  cursor: string,
  traceId: string
): Result<ChapterCatalogCursorPayload, UnifiedError> {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed) ||
      (parsed as Record<string, unknown>)["version"] !== 1 ||
      (parsed as Record<string, unknown>)["sortVersion"] !== "order-title-id-v1" ||
      typeof (parsed as Record<string, unknown>)["catalogRevision"] !== "string" ||
      !/^[a-f0-9]{64}$/u.test((parsed as Record<string, unknown>)["catalogRevision"] as string) ||
      typeof (parsed as Record<string, unknown>)["querySignature"] !== "string" ||
      !/^[a-f0-9]{64}$/u.test((parsed as Record<string, unknown>)["querySignature"] as string) ||
      typeof (parsed as Record<string, unknown>)["last"] !== "string"
    ) {
      throw new Error("invalid cursor");
    }
    return ok(parsed as ChapterCatalogCursorPayload);
  } catch {
    return err(
      validationError({
        code: "CHAPTER_CATALOG_CURSOR_INVALID",
        message: "The chapter catalog cursor is malformed.",
        suggestedAction: "Restart chapter pagination from the first page.",
        traceId
      })
    );
  }
}

function buildLocalOrderMigrationPreview(
  records: readonly ChapterCatalogRecord[]
): ChapterOrderMigrationPreview {
  const byOrder = new Map<number, ChapterCatalogRecord[]>();
  const affected: ChapterOrderMigrationPreview["affected"] extends readonly (infer T)[]
    ? T[]
    : never[] = [];
  for (const record of records) {
    const invalid =
      !Number.isFinite(record.order) || !Number.isInteger(record.order) || record.order < 1;
    if (invalid) {
      affected.push({
        stableRef: `chapter:${record.id}`,
        chapterId: record.id,
        order: record.order,
        status: record.status,
        relativePath: record.relativePath,
        reason: !Number.isFinite(record.order)
          ? "non_finite"
          : !Number.isInteger(record.order)
            ? "non_integer"
            : "non_positive"
      });
      continue;
    }
    const list = byOrder.get(record.order) ?? [];
    list.push(record);
    byOrder.set(record.order, list);
  }
  for (const [order, list] of byOrder) {
    if (list.length < 2) continue;
    for (const record of list) {
      affected.push({
        stableRef: `chapter:${record.id}`,
        chapterId: record.id,
        order,
        status: record.status,
        relativePath: record.relativePath,
        reason: "duplicate"
      });
    }
  }
  affected.sort(
    (left, right) => left.order - right.order || compareIds(left.chapterId, right.chapterId)
  );
  const affectedIds = new Set(affected.map((item) => item.chapterId));
  const occupied = new Set(
    records
      .filter((record) => !affectedIds.has(record.id))
      .map((record) => record.order)
      .filter((order) => Number.isInteger(order) && order > 0)
  );
  const inverse: ChapterOrderMigrationPreview["inverse"] extends readonly (infer T)[]
    ? T[]
    : never[] = [];
  let next = 1;
  for (const item of affected) {
    while (occupied.has(next)) next += 1;
    inverse.push({ stableRef: item.stableRef, from: item.order, to: next });
    occupied.add(next);
    next += 1;
  }
  const catalogRevision = chapterCatalogRevision(records);
  const checksum = checksumText(JSON.stringify({ catalogRevision, affected, inverse }));
  return { required: affected.length > 0, catalogRevision, checksum, affected, inverse };
}

function createChapterId(): string {
  return `ch_${randomUUID().replaceAll("-", "")}`;
}

function nextChapterAppendOrder(records: readonly ChapterCatalogRecord[]): number {
  const valid = records
    .map((record) => record.order)
    .filter((order) => Number.isSafeInteger(order) && order > 0);
  return valid.length === 0 ? 1 : Math.max(...valid) + 1;
}

function isValidChapterId(value: string): boolean {
  return /^ch_[A-Za-z0-9_-]+$/u.test(value);
}

function isChapterStatus(value: unknown): value is ChapterDocument["frontmatter"]["status"] {
  return (
    value === "draft" ||
    value === "revision" ||
    value === "review" ||
    value === "done" ||
    value === "archived" ||
    value === "deleted"
  );
}

function checksumText(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function cloneJsonObject<T extends Record<string, unknown>>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function safeOrder(order: number): number {
  return Number.isFinite(order) ? order : Number.POSITIVE_INFINITY;
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function countWords(body: string): number {
  return body.trim().length === 0 ? 0 : body.trim().split(/\s+/).length;
}

function parseChapterDocument(
  text: string,
  traceId: string
): Result<ChapterDocument, UnifiedError> {
  const frontmatterMatch = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (frontmatterMatch === null) {
    return err(
      storageError({
        code: "CHAPTER_FILE_INVALID",
        message: "Chapter file is missing frontmatter.",
        suggestedAction: "Restore the chapter frontmatter and retry.",
        traceId
      })
    );
  }

  const frontmatterText = frontmatterMatch[1] ?? "";
  const body = (frontmatterMatch[2] ?? "").replace(/^\n/, "");
  const frontmatter = loadYaml(frontmatterText);

  if (typeof frontmatter !== "object" || frontmatter === null || Array.isArray(frontmatter)) {
    return err(
      validationError({
        code: "CHAPTER_FILE_INVALID",
        message: "Chapter frontmatter could not be parsed.",
        suggestedAction: "Fix the chapter frontmatter and retry.",
        traceId
      })
    );
  }

  return ok({
    frontmatter: frontmatter as ChapterDocument["frontmatter"],
    body
  });
}

function formatChapterDocument(chapter: ChapterDocument): string {
  const frontmatter = dumpYaml(chapter.frontmatter, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false
  }).trimEnd();

  return `---\n${frontmatter}\n---\n\n${chapter.body.replace(/\s*$/, "")}\n`;
}
