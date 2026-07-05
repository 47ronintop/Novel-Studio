import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

import { err, ok, type JsonObject, type Result, type UnifiedError } from "@novel-studio/shared";

import { writeTextAtomically } from "./atomic-write.js";
import { storageError, validationError } from "./errors.js";
import { validateWithSchema } from "./schema-validation.js";

export type StoryBibleAssetType =
  | "character"
  | "world.location"
  | "world.faction"
  | "world.rule"
  | "world.glossary"
  | "outline"
  | "timeline.events";
export type StoryBibleEntityStatus = "active" | "draft" | "archived" | "deleted";
export type MemoryRecordType = "memory.long-term" | "memory.style" | "memory.summary";
export type MemoryOrigin = "user" | "user-confirmed-ai" | "ai-unconfirmed";
export type MemoryConfidence = "confirmed" | "needs-review" | "deprecated";

export interface StoryBibleAsset extends JsonObject {
  readonly schemaVersion: "1.0";
  readonly id: string;
  readonly type: StoryBibleAssetType;
  readonly title: string;
  readonly status: StoryBibleEntityStatus;
  readonly summary: string;
  readonly aliases?: string[];
  readonly details?: JsonObject;
  readonly relatedEntityIds?: string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MemoryRecord extends JsonObject {
  readonly schemaVersion: "1.0";
  readonly id: string;
  readonly type: MemoryRecordType;
  readonly title: string;
  readonly status: StoryBibleEntityStatus;
  readonly origin: MemoryOrigin;
  readonly confidence: MemoryConfidence;
  readonly content: string;
  readonly sourceRefs?: JsonObject[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface StoryBibleSnapshot {
  readonly characters: readonly StoryBibleAsset[];
  readonly worldAssets: readonly StoryBibleAsset[];
  readonly outline?: StoryBibleAsset;
  readonly timeline?: StoryBibleAsset;
  readonly memories: readonly MemoryRecord[];
}

export interface StoryBibleRepositoryPort {
  readStoryBible(): Promise<Result<StoryBibleSnapshot, UnifiedError>>;
  saveStoryAsset(asset: StoryBibleAsset): Promise<Result<StoryBibleAsset, UnifiedError>>;
  saveMemory(memory: MemoryRecord): Promise<Result<MemoryRecord, UnifiedError>>;
}

export interface StoryBibleFileRepositoryOptions {
  readonly projectRoot: string;
  readonly traceId?: string;
}

export class StoryBibleFileRepository implements StoryBibleRepositoryPort {
  private readonly traceId: string;

  public constructor(private readonly options: StoryBibleFileRepositoryOptions) {
    this.traceId = options.traceId ?? "trace_repository_story_bible";
  }

  public async readStoryBible(): Promise<Result<StoryBibleSnapshot, UnifiedError>> {
    const characters = await this.readStoryAssetCollection("characters");
    if (!characters.ok) {
      return characters;
    }

    const worldAssets = await this.readStoryAssetCollection("world");
    if (!worldAssets.ok) {
      return worldAssets;
    }

    const outline = await this.readOptionalStoryAsset(join("outline", "outline.json"));
    if (!outline.ok) {
      return outline;
    }

    const timeline = await this.readOptionalStoryAsset(join("timeline", "events.json"));
    if (!timeline.ok) {
      return timeline;
    }

    const memories = await this.readMemoryCollection();
    if (!memories.ok) {
      return memories;
    }

    return ok({
      characters: sortByTitle(characters.value),
      worldAssets: sortByTitle(worldAssets.value),
      ...(outline.value === undefined ? {} : { outline: outline.value }),
      ...(timeline.value === undefined ? {} : { timeline: timeline.value }),
      memories: sortMemories(memories.value)
    });
  }

  public async saveStoryAsset(
    asset: StoryBibleAsset
  ): Promise<Result<StoryBibleAsset, UnifiedError>> {
    const validation = await this.validateStoryAsset(asset);
    if (!validation.ok) {
      return validation;
    }

    const relativePath = storyAssetPath(validation.value);
    const writeResult = await this.writeJson(relativePath, validation.value);
    if (!writeResult.ok) {
      return writeResult;
    }

    return ok(validation.value);
  }

  public async saveMemory(memory: MemoryRecord): Promise<Result<MemoryRecord, UnifiedError>> {
    const validation = await this.validateMemory(memory);
    if (!validation.ok) {
      return validation;
    }

    const writeResult = await this.writeJson(memoryPath(validation.value), validation.value);
    if (!writeResult.ok) {
      return writeResult;
    }

    return ok(validation.value);
  }

  private async readStoryAssetCollection(
    relativeDirectory: string
  ): Promise<Result<StoryBibleAsset[], UnifiedError>> {
    const filePaths = await this.listJsonFiles(relativeDirectory);
    if (!filePaths.ok) {
      return filePaths;
    }

    const assets: StoryBibleAsset[] = [];
    for (const filePath of filePaths.value) {
      const asset = await this.readStoryAsset(filePath);
      if (!asset.ok) {
        return asset;
      }
      assets.push(asset.value);
    }

    return ok(assets);
  }

  private async readOptionalStoryAsset(
    relativePath: string
  ): Promise<Result<StoryBibleAsset | undefined, UnifiedError>> {
    if (!(await fileExists(join(this.options.projectRoot, relativePath)))) {
      return ok(undefined);
    }

    return this.readStoryAsset(relativePath);
  }

  private async readStoryAsset(
    relativePath: string
  ): Promise<Result<StoryBibleAsset, UnifiedError>> {
    const parsed = await this.readJson(relativePath, "STORY_BIBLE_ASSET_READ_FAILED");
    if (!parsed.ok) {
      return parsed;
    }

    return this.validateStoryAsset(parsed.value, relativePath);
  }

  private async readMemoryCollection(): Promise<Result<MemoryRecord[], UnifiedError>> {
    const filePaths = await this.listJsonFiles("memories");
    if (!filePaths.ok) {
      return filePaths;
    }

    const memories: MemoryRecord[] = [];
    for (const filePath of filePaths.value) {
      const parsed = await this.readJson(filePath, "STORY_BIBLE_MEMORY_READ_FAILED");
      if (!parsed.ok) {
        return parsed;
      }
      const memory = await this.validateMemory(parsed.value, filePath);
      if (!memory.ok) {
        return memory;
      }
      memories.push(memory.value);
    }

    return ok(memories);
  }

  private async listJsonFiles(relativeDirectory: string): Promise<Result<string[], UnifiedError>> {
    const directory = join(this.options.projectRoot, relativeDirectory);
    if (!(await fileExists(directory))) {
      return ok([]);
    }

    try {
      const entries = await readdir(directory, { recursive: true, withFileTypes: true });
      return ok(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
          .map((entry) =>
            join(entry.parentPath, entry.name).slice(this.options.projectRoot.length + 1)
          )
          .sort()
      );
    } catch (error) {
      return err(
        storageError({
          code: "STORY_BIBLE_DIRECTORY_READ_FAILED",
          message: "Story Bible directory could not be read.",
          suggestedAction: "Open a valid project folder and retry.",
          traceId: this.traceId,
          redactedDetail: {
            directory: relativeDirectory,
            reason: error instanceof Error ? error.message : "Unknown directory read error"
          }
        })
      );
    }
  }

  private async readJson(
    relativePath: string,
    code: string
  ): Promise<Result<unknown, UnifiedError>> {
    try {
      return ok(JSON.parse(await readFile(join(this.options.projectRoot, relativePath), "utf8")));
    } catch (error) {
      return err(
        storageError({
          code,
          message: "Story Bible JSON could not be read.",
          suggestedAction: "Fix the Story Bible JSON file and retry.",
          traceId: this.traceId,
          redactedDetail: {
            filePath: relativePath,
            reason: error instanceof Error ? error.message : "Unknown JSON read error"
          }
        })
      );
    }
  }

  private async validateStoryAsset(
    asset: unknown,
    relativePath?: string
  ): Promise<Result<StoryBibleAsset, UnifiedError>> {
    const validation = await validateWithSchema("story-asset", asset);
    if (!validation.valid) {
      return err(
        validationError({
          code: "STORY_BIBLE_ASSET_INVALID",
          message: "Story Bible asset failed schema validation.",
          suggestedAction: "Fix the Story Bible asset and retry.",
          traceId: this.traceId,
          redactedDetail: {
            ...(relativePath === undefined ? {} : { filePath: relativePath }),
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

    return ok(asset as StoryBibleAsset);
  }

  private async validateMemory(
    memory: unknown,
    relativePath?: string
  ): Promise<Result<MemoryRecord, UnifiedError>> {
    const validation = await validateWithSchema("memory", memory);
    if (!validation.valid) {
      return err(
        validationError({
          code: "STORY_BIBLE_MEMORY_INVALID",
          message: "Story Bible memory failed schema validation.",
          suggestedAction: "Fix the Story Bible memory and retry.",
          traceId: this.traceId,
          redactedDetail: {
            ...(relativePath === undefined ? {} : { filePath: relativePath }),
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

    return ok(memory as MemoryRecord);
  }

  private async writeJson(
    relativePath: string,
    content: JsonObject
  ): Promise<Result<void, UnifiedError>> {
    try {
      await mkdir(dirname(join(this.options.projectRoot, relativePath)), { recursive: true });
    } catch (error) {
      return err(
        storageError({
          code: "STORY_BIBLE_WRITE_FAILED",
          message: "Story Bible directory could not be created.",
          suggestedAction: "Choose a writable project folder and retry.",
          traceId: this.traceId,
          redactedDetail: {
            filePath: relativePath,
            reason: error instanceof Error ? error.message : "Unknown mkdir error"
          }
        })
      );
    }

    return writeTextAtomically({
      targetPath: join(this.options.projectRoot, relativePath),
      content: `${JSON.stringify(content, null, 2)}\n`,
      traceId: this.traceId
    });
  }
}

function storyAssetPath(asset: StoryBibleAsset): string {
  switch (asset.type) {
    case "character":
      return join("characters", `${asset.id}.json`);
    case "world.location":
    case "world.faction":
    case "world.rule":
    case "world.glossary":
      return join("world", `${asset.id}.json`);
    case "outline":
      return join("outline", "outline.json");
    case "timeline.events":
      return join("timeline", "events.json");
  }
}

function memoryPath(memory: MemoryRecord): string {
  switch (memory.type) {
    case "memory.long-term":
      return join("memories", "long-term", `${memory.id}.json`);
    case "memory.style":
      return join("memories", "style", `${memory.id}.json`);
    case "memory.summary":
      return join("memories", "summary", `${memory.id}.json`);
  }
}

function sortByTitle(assets: readonly StoryBibleAsset[]): StoryBibleAsset[] {
  return [...assets].sort((left, right) => left.title.localeCompare(right.title));
}

function sortMemories(memories: readonly MemoryRecord[]): MemoryRecord[] {
  return [...memories].sort((left, right) => left.title.localeCompare(right.title));
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}
