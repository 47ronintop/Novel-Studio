import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";

import { err, ok, type Result, type UnifiedError } from "@novel-studio/shared";
import type { ChapterDocument, ChapterDraftRepositoryPort } from "@novel-studio/shared";

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
}

export class ChapterFileRepository implements ChapterDraftRepositoryPort {
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
