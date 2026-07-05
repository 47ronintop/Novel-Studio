import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import { err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import { writeTextAtomically } from "./atomic-write.js";
import { ChapterFileRepository } from "./chapter-repository.js";
import { storageError, validationError } from "./errors.js";
import { validateWithSchema } from "./schema-validation.js";
import {
  StoryBibleFileRepository,
  type MemoryRecord,
  type StoryBibleAsset
} from "./story-bible-repository.js";

export type SearchIndexEntryType =
  "chapter" | "story.character" | "story.world" | "story.outline" | "story.timeline" | "memory";

export interface SearchSourceRef {
  readonly kind: "chapter" | "story-asset" | "memory";
  readonly id: string;
  readonly relativePath: string;
}

export interface SearchIndexEntry {
  readonly id: string;
  readonly type: SearchIndexEntryType;
  readonly title: string;
  readonly text: string;
  readonly updatedAt: string;
  readonly sourceRef: SearchSourceRef;
}

export interface SearchIndexSnapshot {
  readonly schemaVersion: "1.0";
  readonly generatedAt: string;
  readonly entryCount: number;
  readonly entries: readonly SearchIndexEntry[];
}

export interface SearchQueryInput {
  readonly query: string;
  readonly limit?: number;
}

export interface SearchResultItem {
  readonly id: string;
  readonly type: SearchIndexEntryType;
  readonly title: string;
  readonly snippet: string;
  readonly score: number;
  readonly sourceRef: SearchSourceRef;
}

export interface SearchResults {
  readonly query: string;
  readonly generatedAt: string;
  readonly entryCount: number;
  readonly results: readonly SearchResultItem[];
}

export interface SearchIndexFileRepositoryOptions {
  readonly projectRoot: string;
  readonly traceId?: string;
  readonly now?: () => string;
}

const SEARCH_INDEX_RELATIVE_PATH = join("cache", "indexes", "search.json");

export class SearchIndexFileRepository {
  private readonly traceId: string;
  private snapshot: SearchIndexSnapshot | undefined;

  public constructor(private readonly options: SearchIndexFileRepositoryOptions) {
    this.traceId = options.traceId ?? "trace_repository_search_index";
  }

  public async rebuildIndex(): Promise<Result<SearchIndexSnapshot, UnifiedError>> {
    const entries = await this.collectEntries();
    if (!entries.ok) {
      return entries;
    }

    const snapshot: SearchIndexSnapshot = {
      schemaVersion: "1.0",
      generatedAt: this.options.now?.() ?? new Date().toISOString(),
      entryCount: entries.value.length,
      entries: entries.value
    };
    const validation = await validateSearchIndex(snapshot, this.traceId);
    if (!validation.ok) {
      return validation;
    }

    const writeResult = await this.writeSnapshot(snapshot);
    if (!writeResult.ok) {
      return writeResult;
    }

    this.snapshot = snapshot;
    return ok(snapshot);
  }

  public async search(input: SearchQueryInput): Promise<Result<SearchResults, UnifiedError>> {
    const snapshot = await this.getSnapshot();
    if (!snapshot.ok) {
      return snapshot;
    }

    const normalizedQuery = normalizeSearchText(input.query);
    if (normalizedQuery.length === 0) {
      return ok({
        query: input.query,
        generatedAt: snapshot.value.generatedAt,
        entryCount: snapshot.value.entryCount,
        results: []
      });
    }

    const terms = normalizedQuery.split(" ").filter((term) => term.length > 0);
    const limit = Math.max(1, Math.min(input.limit ?? 20, 50));
    const results = snapshot.value.entries
      .map((entry) => scoreEntry(entry, terms))
      .filter((result): result is SearchResultItem => result !== undefined)
      .sort(
        (left, right) => right.score - left.score || typeOrder(left.type) - typeOrder(right.type)
      )
      .slice(0, limit);

    return ok({
      query: input.query,
      generatedAt: snapshot.value.generatedAt,
      entryCount: snapshot.value.entryCount,
      results
    });
  }

  private async collectEntries(): Promise<Result<SearchIndexEntry[], UnifiedError>> {
    const chapterRepository = new ChapterFileRepository({
      projectRoot: this.options.projectRoot,
      traceId: this.traceId
    });
    const storyBibleRepository = new StoryBibleFileRepository({
      projectRoot: this.options.projectRoot,
      traceId: this.traceId
    });

    const chapterSummaries = await chapterRepository.listChapters();
    if (!chapterSummaries.ok) {
      return chapterSummaries;
    }

    const entries: SearchIndexEntry[] = [];
    for (const chapterSummary of chapterSummaries.value) {
      const chapter = await chapterRepository.readChapter(chapterSummary.id);
      if (!chapter.ok) {
        return chapter;
      }
      entries.push({
        id: `chapter:${chapter.value.frontmatter.id}`,
        type: "chapter",
        title: chapter.value.frontmatter.title,
        text: chapter.value.body,
        updatedAt: chapter.value.frontmatter.updatedAt,
        sourceRef: {
          kind: "chapter",
          id: chapter.value.frontmatter.id,
          relativePath: toProjectRelativePath(
            join("chapters", `${chapter.value.frontmatter.id}.md`)
          )
        }
      });
    }

    const storyBible = await storyBibleRepository.readStoryBible();
    if (!storyBible.ok) {
      return storyBible;
    }

    entries.push(...storyBible.value.characters.map((asset) => storyAssetEntry(asset)));
    entries.push(...storyBible.value.worldAssets.map((asset) => storyAssetEntry(asset)));
    if (storyBible.value.outline !== undefined) {
      entries.push(storyAssetEntry(storyBible.value.outline));
    }
    if (storyBible.value.timeline !== undefined) {
      entries.push(storyAssetEntry(storyBible.value.timeline));
    }
    entries.push(...storyBible.value.memories.map((memory) => memoryEntry(memory)));

    return ok(entries);
  }

  private async getSnapshot(): Promise<Result<SearchIndexSnapshot, UnifiedError>> {
    if (this.snapshot !== undefined) {
      return ok(this.snapshot);
    }

    const readResult = await this.readSnapshot();
    if (readResult.ok) {
      this.snapshot = readResult.value;
      return readResult;
    }

    if (readResult.error.code !== "SEARCH_INDEX_READ_FAILED") {
      return readResult;
    }

    return this.rebuildIndex();
  }

  private async readSnapshot(): Promise<Result<SearchIndexSnapshot, UnifiedError>> {
    const indexPath = join(this.options.projectRoot, SEARCH_INDEX_RELATIVE_PATH);
    let parsed: unknown;

    try {
      parsed = JSON.parse(await readFile(indexPath, "utf8"));
    } catch (error) {
      return err(
        storageError({
          code: "SEARCH_INDEX_READ_FAILED",
          message: "Search index cache could not be read.",
          suggestedAction: "Rebuild the project search index.",
          traceId: this.traceId,
          redactedDetail: {
            filePath: SEARCH_INDEX_RELATIVE_PATH,
            reason: error instanceof Error ? error.message : "Unknown search index read error"
          }
        })
      );
    }

    const validation = await validateSearchIndex(parsed, this.traceId);
    if (!validation.ok) {
      return validation;
    }

    return ok(validation.value);
  }

  private async writeSnapshot(snapshot: SearchIndexSnapshot): Promise<Result<void, UnifiedError>> {
    const indexPath = join(this.options.projectRoot, SEARCH_INDEX_RELATIVE_PATH);
    try {
      await mkdir(dirname(indexPath), { recursive: true });
    } catch (error) {
      return err(
        storageError({
          code: "SEARCH_INDEX_WRITE_FAILED",
          message: "Search index directory could not be created.",
          suggestedAction: "Choose a writable project folder and retry.",
          traceId: this.traceId,
          redactedDetail: {
            filePath: SEARCH_INDEX_RELATIVE_PATH,
            reason: error instanceof Error ? error.message : "Unknown mkdir error"
          }
        })
      );
    }

    return writeTextAtomically({
      targetPath: indexPath,
      content: `${JSON.stringify(snapshot, null, 2)}\n`,
      traceId: this.traceId
    });
  }
}

async function validateSearchIndex(
  value: unknown,
  traceId: string
): Promise<Result<SearchIndexSnapshot, UnifiedError>> {
  const validation = await validateWithSchema("search-index", value);
  if (!validation.valid) {
    return err(
      validationError({
        code: "SEARCH_INDEX_INVALID",
        message: "Search index failed schema validation.",
        suggestedAction: "Rebuild the project search index.",
        traceId,
        redactedDetail: {
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

  return ok(value as SearchIndexSnapshot);
}

function storyAssetEntry(asset: StoryBibleAsset): SearchIndexEntry {
  return {
    id: `${searchTypeForStoryAsset(asset)}:${asset.id}`,
    type: searchTypeForStoryAsset(asset),
    title: asset.title,
    text: [asset.summary, ...(asset.aliases ?? []), stringifyDetails(asset)].join("\n"),
    updatedAt: asset.updatedAt,
    sourceRef: {
      kind: "story-asset",
      id: asset.id,
      relativePath: storyAssetRelativePath(asset)
    }
  };
}

function memoryEntry(memory: MemoryRecord): SearchIndexEntry {
  return {
    id: `memory:${memory.id}`,
    type: "memory",
    title: memory.title,
    text: memory.content,
    updatedAt: memory.updatedAt,
    sourceRef: {
      kind: "memory",
      id: memory.id,
      relativePath: memoryRelativePath(memory)
    }
  };
}

function searchTypeForStoryAsset(asset: StoryBibleAsset): SearchIndexEntryType {
  switch (asset.type) {
    case "character":
      return "story.character";
    case "outline":
      return "story.outline";
    case "timeline.events":
      return "story.timeline";
    case "world.location":
    case "world.faction":
    case "world.rule":
    case "world.glossary":
      return "story.world";
  }
}

function storyAssetRelativePath(asset: StoryBibleAsset): string {
  switch (asset.type) {
    case "character":
      return toProjectRelativePath(join("characters", `${asset.id}.json`));
    case "outline":
      return toProjectRelativePath(join("outline", "outline.json"));
    case "timeline.events":
      return toProjectRelativePath(join("timeline", "events.json"));
    case "world.location":
    case "world.faction":
    case "world.rule":
    case "world.glossary":
      return toProjectRelativePath(join("world", `${asset.id}.json`));
  }
}

function memoryRelativePath(memory: MemoryRecord): string {
  switch (memory.type) {
    case "memory.long-term":
      return toProjectRelativePath(join("memories", "long-term", `${memory.id}.json`));
    case "memory.style":
      return toProjectRelativePath(join("memories", "style", `${memory.id}.json`));
    case "memory.summary":
      return toProjectRelativePath(join("memories", "summary", `${memory.id}.json`));
  }
}

function stringifyDetails(asset: StoryBibleAsset): string {
  return asset.details === undefined ? "" : JSON.stringify(asset.details);
}

function scoreEntry(
  entry: SearchIndexEntry,
  terms: readonly string[]
): SearchResultItem | undefined {
  const normalizedTitle = normalizeSearchText(entry.title);
  const normalizedText = normalizeSearchText(entry.text);
  let score = 0;

  for (const term of terms) {
    if (normalizedTitle.includes(term)) {
      score += 3;
    }
    if (normalizedText.includes(term)) {
      score += 1;
    }
  }

  if (score === 0) {
    return undefined;
  }
  score += typeBoost(entry.type);

  return {
    id: entry.id,
    type: entry.type,
    title: entry.title,
    snippet: createSnippet(entry.text, terms),
    score,
    sourceRef: entry.sourceRef
  };
}

function typeBoost(type: SearchIndexEntryType): number {
  switch (type) {
    case "chapter":
      return 4;
    case "story.character":
    case "story.world":
    case "story.outline":
    case "story.timeline":
      return 2;
    case "memory":
      return 1;
  }
}

function createSnippet(text: string, terms: readonly string[]): string {
  const normalized = normalizeSearchText(text);
  const firstIndex = terms.reduce<number | undefined>((current, term) => {
    const index = normalized.indexOf(term);
    if (index < 0) {
      return current;
    }
    return current === undefined ? index : Math.min(current, index);
  }, undefined);
  const start = Math.max((firstIndex ?? 0) - 36, 0);
  const snippet = text.slice(start, start + 140).trim();

  return snippet.length === 0 ? text.slice(0, 140) : snippet;
}

function normalizeSearchText(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function typeOrder(type: SearchIndexEntryType): number {
  switch (type) {
    case "chapter":
      return 0;
    case "story.character":
      return 1;
    case "story.world":
      return 2;
    case "story.outline":
      return 3;
    case "story.timeline":
      return 4;
    case "memory":
      return 5;
  }
}

function toProjectRelativePath(path: string): string {
  return relative(".", path).replaceAll("\\", "/");
}
