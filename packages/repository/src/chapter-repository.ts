import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";

import { err, ok, type Result, type UnifiedError } from "@novel-studio/shared";
import type {
  ChapterCatalogRepositoryPort,
  ChapterDocument,
  ChapterDraftRepositoryPort,
  ChapterMaintenanceRepositoryPort,
  ChapterSummary,
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
  implements ChapterDraftRepositoryPort, ChapterCatalogRepositoryPort, ChapterMaintenanceRepositoryPort
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

  public async createChapter(
    input: CreateChapterInput
  ): Promise<Result<ChapterDocument, UnifiedError>> {
    const now = this.options.now?.() ?? new Date().toISOString();
    const order = input.order ?? (await this.nextChapterOrder());
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

  private async nextChapterOrder(): Promise<number> {
    const chapters = await this.listChapters();
    if (!chapters.ok || chapters.value.length === 0) {
      return 1;
    }

    return Math.max(...chapters.value.map((chapter) => chapter.order)) + 1;
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
