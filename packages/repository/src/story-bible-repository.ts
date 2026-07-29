import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import {
  err,
  hashForeshadowEvidence,
  normalizeForeshadowEvidence,
  ok,
  type ForeshadowDetails,
  type JsonObject,
  type Result,
  type UnifiedError
} from "@novel-studio/shared";

import {
  createProjectPathGuard,
  verifyProjectStoragePath,
  writeTextAtomically,
  type ProjectPathGuard
} from "./atomic-write.js";
import { storageError, validationError } from "./errors.js";
import { validateWithSchema } from "./schema-validation.js";

export type StoryBibleRegularAssetType =
  | "character"
  | "world.location"
  | "world.faction"
  | "world.rule"
  | "world.glossary"
  | "outline"
  | "timeline.events";
export type StoryBibleAssetType = StoryBibleRegularAssetType | "foreshadow";
export type StoryBibleEntityStatus = "active" | "draft" | "archived" | "deleted";
export type MemoryRecordType = "memory.long-term" | "memory.style" | "memory.summary";
export type MemoryOrigin = "user" | "user-confirmed-ai" | "ai-unconfirmed";
export type MemoryConfidence = "confirmed" | "needs-review" | "deprecated";

interface StoryBibleAssetBase extends JsonObject {
  readonly schemaVersion: "1.0";
  readonly id: string;
  readonly title: string;
  readonly status: StoryBibleEntityStatus;
  readonly summary: string;
  readonly aliases?: string[];
  readonly relatedEntityIds?: string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface StoryBibleRegularAsset extends StoryBibleAssetBase {
  readonly type: StoryBibleRegularAssetType;
  readonly details?: JsonObject;
}

export interface ForeshadowAsset extends StoryBibleAssetBase {
  readonly type: "foreshadow";
  readonly details: ForeshadowDetails;
}

export type StoryBibleAsset = StoryBibleRegularAsset | ForeshadowAsset;

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
  readonly characters: readonly StoryBibleRegularAsset[];
  readonly worldAssets: readonly StoryBibleRegularAsset[];
  readonly outline?: StoryBibleRegularAsset;
  readonly foreshadows: readonly ForeshadowAsset[];
  readonly timeline?: StoryBibleRegularAsset;
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
  private readonly pathGuard: ProjectPathGuard;

  public constructor(private readonly options: StoryBibleFileRepositoryOptions) {
    this.traceId = options.traceId ?? "trace_repository_story_bible";
    this.pathGuard = createProjectPathGuard(options.projectRoot);
  }

  public async readStoryBible(): Promise<Result<StoryBibleSnapshot, UnifiedError>> {
    const characters = await this.readStoryAssetCollection("characters", ["character"]);
    if (!characters.ok) {
      return characters;
    }

    const worldAssets = await this.readStoryAssetCollection("world", [
      "world.location",
      "world.faction",
      "world.rule",
      "world.glossary"
    ]);
    if (!worldAssets.ok) {
      return worldAssets;
    }

    const outline = await this.readOptionalStoryAsset(join("outline", "outline.json"), "outline");
    if (!outline.ok) {
      return outline;
    }

    const foreshadows = await this.readForeshadowCollection();
    if (!foreshadows.ok) {
      return foreshadows;
    }

    const timeline = await this.readOptionalStoryAsset(
      join("timeline", "events.json"),
      "timeline.events"
    );
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
      foreshadows: sortByTitle(foreshadows.value),
      ...(timeline.value === undefined ? {} : { timeline: timeline.value }),
      memories: sortByTitle(memories.value)
    });
  }

  public async saveStoryAsset(
    asset: StoryBibleAsset
  ): Promise<Result<StoryBibleAsset, UnifiedError>> {
    const validation = await this.validateStoryAsset(asset);
    if (!validation.ok) {
      return validation;
    }

    const canonicalAsset = canonicalizeStoryAsset(validation.value);
    const relativePath = storyAssetPath(canonicalAsset);
    if (!isStoryAssetWritePathSafe(this.options.projectRoot, canonicalAsset, relativePath)) {
      return err(
        storyBibleAssetValidationError({
          traceId: this.traceId,
          issues: [
            {
              instancePath: "/id",
              schemaPath: "#/properties/id",
              keyword: "assetPath",
              message: "must resolve inside the Story Bible asset directory"
            }
          ]
        })
      );
    }
    const writeResult = await this.writeJson(relativePath, canonicalAsset);
    if (!writeResult.ok) {
      return writeResult;
    }

    return ok(canonicalAsset);
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
    relativeDirectory: string,
    expectedTypes: readonly StoryBibleRegularAssetType[]
  ): Promise<Result<StoryBibleRegularAsset[], UnifiedError>> {
    const filePaths = await this.listJsonFiles(relativeDirectory);
    if (!filePaths.ok) {
      return filePaths;
    }

    const assets: StoryBibleRegularAsset[] = [];
    for (const filePath of filePaths.value) {
      const asset = await this.readRegularStoryAsset(filePath, expectedTypes);
      if (!asset.ok) {
        return asset;
      }
      assets.push(asset.value);
    }

    return ok(assets);
  }

  private async readOptionalStoryAsset(
    relativePath: string,
    expectedType: StoryBibleRegularAssetType
  ): Promise<Result<StoryBibleRegularAsset | undefined, UnifiedError>> {
    const targetPath = join(this.options.projectRoot, relativePath);
    const pathValidation = await verifyProjectStoragePath(this.pathGuard, targetPath, this.traceId);
    if (!pathValidation.ok) {
      return pathValidation;
    }
    if (!(await fileExists(targetPath))) {
      return ok(undefined);
    }

    return this.readRegularStoryAsset(relativePath, [expectedType]);
  }

  private async readRegularStoryAsset(
    relativePath: string,
    expectedTypes: readonly StoryBibleRegularAssetType[]
  ): Promise<Result<StoryBibleRegularAsset, UnifiedError>> {
    const asset = await this.readStoryAsset(relativePath, "story-asset");
    if (!asset.ok) {
      return asset;
    }
    if (asset.value.type === "foreshadow" || !expectedTypes.includes(asset.value.type)) {
      return err(
        storyBibleAssetValidationError({
          traceId: this.traceId,
          relativePath,
          issues: [
            {
              instancePath: "/type",
              schemaPath: "#/properties/type",
              keyword: "assetDirectory",
              message: "must match the Story Bible asset directory"
            }
          ]
        })
      );
    }
    return ok(asset.value);
  }

  private async readForeshadowCollection(): Promise<Result<ForeshadowAsset[], UnifiedError>> {
    const filePaths = await this.listJsonFiles("foreshadows", false);
    if (!filePaths.ok) {
      return filePaths;
    }

    const foreshadows: ForeshadowAsset[] = [];
    for (const filePath of filePaths.value) {
      const asset = await this.readStoryAsset(filePath, "foreshadow");
      if (!asset.ok) {
        return asset;
      }
      if (asset.value.type !== "foreshadow") {
        return err(
          storyBibleAssetValidationError({
            traceId: this.traceId,
            relativePath: filePath,
            issues: [
              {
                instancePath: "/type",
                schemaPath: "#/properties/type/const",
                keyword: "const",
                message: "must be equal to constant"
              }
            ]
          })
        );
      }
      if (filePath !== storyAssetPath(asset.value)) {
        return err(
          storyBibleAssetValidationError({
            traceId: this.traceId,
            relativePath: filePath,
            issues: [
              {
                instancePath: "/id",
                schemaPath: "#/properties/id",
                keyword: "assetPath",
                message: "must match the foreshadow asset filename"
              }
            ]
          })
        );
      }
      foreshadows.push(asset.value);
    }

    return ok(foreshadows);
  }

  private async readStoryAsset(
    relativePath: string,
    schemaName: "story-asset" | "foreshadow" = "story-asset"
  ): Promise<Result<StoryBibleAsset, UnifiedError>> {
    const parsed = await this.readJson(relativePath, "STORY_BIBLE_ASSET_READ_FAILED");
    if (!parsed.ok) {
      return parsed;
    }

    return this.validateStoryAsset(parsed.value, relativePath, schemaName);
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

  private async listJsonFiles(
    relativeDirectory: string,
    recursive = true
  ): Promise<Result<string[], UnifiedError>> {
    const directory = join(this.options.projectRoot, relativeDirectory);
    const pathValidation = await verifyProjectStoragePath(this.pathGuard, directory, this.traceId);
    if (!pathValidation.ok) {
      return pathValidation;
    }
    if (!(await fileExists(directory))) {
      return ok([]);
    }

    try {
      const entries = await readdir(directory, { recursive, withFileTypes: true });
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
    const targetPath = join(this.options.projectRoot, relativePath);
    const pathValidation = await verifyProjectStoragePath(this.pathGuard, targetPath, this.traceId);
    if (!pathValidation.ok) {
      return pathValidation;
    }
    try {
      return ok(JSON.parse(await readFile(targetPath, "utf8")));
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
    relativePath?: string,
    schemaName: "story-asset" | "foreshadow" = isForeshadowAsset(asset)
      ? "foreshadow"
      : "story-asset"
  ): Promise<Result<StoryBibleAsset, UnifiedError>> {
    const validation = await validateWithSchema(schemaName, asset);
    if (!validation.valid) {
      return err(
        storyBibleAssetValidationError({
          traceId: this.traceId,
          ...(relativePath === undefined ? {} : { relativePath }),
          issues: validation.issues
        })
      );
    }

    const storyAsset = asset as StoryBibleAsset;

    if (schemaName === "foreshadow") {
      const foreshadow = storyAsset as ForeshadowAsset;
      const evidenceIssues = await validateForeshadowEvidence(foreshadow.details);
      if (evidenceIssues.length > 0) {
        return err(
          storyBibleAssetValidationError({
            traceId: this.traceId,
            ...(relativePath === undefined ? {} : { relativePath }),
            issues: evidenceIssues
          })
        );
      }
    }

    return ok(storyAsset);
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
    return writeTextAtomically({
      targetPath: join(this.options.projectRoot, relativePath),
      content: `${JSON.stringify(content, null, 2)}\n`,
      traceId: this.traceId,
      pathGuard: this.pathGuard
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
    case "foreshadow":
      return join("foreshadows", `${asset.id}.json`);
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

function canonicalizeStoryAsset(asset: StoryBibleAsset): StoryBibleAsset {
  const {
    schemaVersion,
    id,
    type,
    title,
    status,
    summary,
    aliases,
    details,
    relatedEntityIds,
    createdAt,
    updatedAt,
    ...unknownFields
  } = asset;

  return {
    schemaVersion,
    id,
    type,
    title,
    status,
    summary,
    ...(aliases === undefined ? {} : { aliases }),
    ...(details === undefined ? {} : { details }),
    ...(relatedEntityIds === undefined ? {} : { relatedEntityIds }),
    createdAt,
    updatedAt,
    ...unknownFields
  } as StoryBibleAsset;
}

function isStoryAssetWritePathSafe(
  projectRoot: string,
  asset: StoryBibleAsset,
  relativePath: string
): boolean {
  if (asset.id.includes("\0")) return false;
  if (asset.type === "outline" || asset.type === "timeline.events") return true;

  const collectionDirectory =
    asset.type === "character"
      ? "characters"
      : asset.type === "foreshadow"
        ? "foreshadows"
        : "world";
  const collectionRoot = resolve(projectRoot, collectionDirectory);
  const targetPath = resolve(projectRoot, relativePath);
  const pathWithinCollection = relative(collectionRoot, targetPath);
  return (
    pathWithinCollection.length > 0 &&
    pathWithinCollection !== ".." &&
    !pathWithinCollection.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
    !isAbsolute(pathWithinCollection)
  );
}

const storyBibleTitleCollator = new Intl.Collator("zh-CN", {
  usage: "sort",
  sensitivity: "variant",
  numeric: false
});

function sortByTitle<T extends { readonly id: string; readonly title: string }>(
  assets: readonly T[]
): T[] {
  return [...assets].sort((left, right) => {
    const titleOrder = storyBibleTitleCollator.compare(left.title, right.title);
    return titleOrder === 0 ? compareIds(left.id, right.id) : titleOrder;
  });
}

function compareIds(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

interface StoryBibleValidationIssue {
  readonly instancePath: string;
  readonly schemaPath: string;
  readonly keyword: string;
  readonly message: string;
}

async function validateForeshadowEvidence(
  details: ForeshadowDetails
): Promise<StoryBibleValidationIssue[]> {
  const issues: StoryBibleValidationIssue[] = [];
  for (const [index, sourceRef] of (details.sourceRefs ?? []).entries()) {
    const normalizedExcerpt = normalizeForeshadowEvidence(sourceRef.excerpt);
    if (sourceRef.excerpt !== normalizedExcerpt) {
      issues.push({
        instancePath: `/details/sourceRefs/${index}/excerpt`,
        schemaPath: "#/properties/details/properties/sourceRefs/items/properties/excerpt",
        keyword: "normalizedEvidence",
        message: "must contain normalized evidence text"
      });
    }

    if (sourceRef.excerptHash !== (await hashForeshadowEvidence(normalizedExcerpt))) {
      issues.push({
        instancePath: `/details/sourceRefs/${index}/excerptHash`,
        schemaPath: "#/properties/details/properties/sourceRefs/items/properties/excerptHash",
        keyword: "evidenceHash",
        message: "must match the normalized evidence SHA-256 hash"
      });
    }
  }
  return issues;
}

function isForeshadowAsset(asset: unknown): asset is ForeshadowAsset {
  return (
    typeof asset === "object" && asset !== null && "type" in asset && asset.type === "foreshadow"
  );
}

function storyBibleAssetValidationError(input: {
  readonly traceId: string;
  readonly relativePath?: string;
  readonly issues: readonly StoryBibleValidationIssue[];
}): UnifiedError {
  return validationError({
    code: "STORY_BIBLE_ASSET_INVALID",
    message: "Story Bible asset failed schema validation.",
    suggestedAction: "Fix the Story Bible asset and retry.",
    traceId: input.traceId,
    redactedDetail: {
      ...(input.relativePath === undefined ? {} : { filePath: input.relativePath }),
      issues: input.issues.map((issue) => ({
        instancePath: issue.instancePath,
        schemaPath: issue.schemaPath,
        keyword: issue.keyword,
        message: issue.message
      }))
    }
  });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}
