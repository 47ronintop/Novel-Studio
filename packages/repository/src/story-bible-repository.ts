import { readdir, readFile, stat, unlink } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import {
  STORY_BIBLE_V11_ASSET_TYPES,
  collectStoryBibleDeclaredChapterReferences,
  createStoryBibleDefaultDetails,
  inspectStoryBibleChapterReferences,
  inspectStoryBibleReferences,
  isStoryBibleV11AssetType,
  storyBibleChapterReferenceFingerprint,
  storyBibleReferenceFingerprint,
  validateStoryBibleV11Asset,
  validateStoryBibleWriteCandidate,
  type StoryBibleReferenceTargetType,
  type StoryBibleV11AssetType,
  type ValidationIssue
} from "@novel-studio/schemas";
import {
  err,
  hashForeshadowEvidence,
  normalizeForeshadowEvidence,
  ok,
  type ForeshadowDetails,
  type JsonObject,
  type JsonValue,
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
import { withStoryBibleProjectWriteLock } from "./story-bible-write-coordinator.js";
import { validateWithSchema } from "./schema-validation.js";
import {
  STORY_BIBLE_CANDIDATE_ROOT_FIELDS,
  adaptLegacyStoryBibleAsset,
  canonicalStoryBibleJson,
  checksumStoryBibleText,
  compatibleV11StoryBibleAsset,
  createStoryBibleAssetId,
  deriveRelatedEntityIds,
  isStoryBibleAssetIdForType,
  isStoryBibleWriteCandidate,
  type CreateStoryBibleAssetInput,
  type PreparedStoryBibleCreate,
  type PreparedStoryBibleWrite,
  type SaveStoryBibleCandidateInput,
  type SaveStoryBibleStatusTransitionInput,
  type StoryBibleAdditionalReferenceTarget,
  type StoryBibleCompatibleAssetRead,
  type StoryBibleRelation,
  type StoryBibleSchemaVersion,
  type StoryBibleV11Asset,
  type StoryBibleWriteCandidate,
  type ValidateStoryBibleCandidateGroupInput
} from "./story-bible-v1-1.js";

export type StoryBibleRegularAssetType =
  | "character"
  | "world.location"
  | "world.faction"
  | "world.rule"
  | "world.glossary"
  | "world.item"
  | "world.lore"
  | "outline"
  | "timeline.events";
export type StoryBibleAssetType = StoryBibleRegularAssetType | "foreshadow";
export type StoryBibleEntityStatus = "active" | "draft" | "archived" | "deleted";
export type MemoryRecordType = "memory.long-term" | "memory.style" | "memory.summary";
export type MemoryOrigin = "user" | "user-confirmed-ai" | "ai-unconfirmed";
export type MemoryConfidence = "confirmed" | "needs-review" | "deprecated";

interface StoryBibleAssetBase extends JsonObject {
  readonly schemaVersion: StoryBibleSchemaVersion;
  readonly id: string;
  readonly title: string;
  readonly status: StoryBibleEntityStatus;
  readonly summary: string;
  readonly aliases?: string[];
  readonly relations?: JsonObject[];
  readonly extensions?: JsonObject;
  readonly relatedEntityIds?: string[];
  readonly revision?: number;
  readonly passthrough?: JsonObject;
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

export interface StoryBibleListInput {
  readonly types?: readonly StoryBibleV11AssetType[];
  readonly statuses?: readonly StoryBibleEntityStatus[];
  readonly query?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface StoryBibleListItem {
  readonly assetId: string;
  readonly type: StoryBibleV11AssetType;
  readonly title: string;
  readonly status: StoryBibleEntityStatus;
  readonly summary: string;
  readonly revision: number;
  readonly indexRevision: string;
}

export interface StoryBibleListPage {
  readonly items: readonly StoryBibleListItem[];
  readonly indexRevision: string;
  readonly nextCursor: string | null;
}

export interface StoryBibleAgentAsset extends JsonObject {
  readonly schemaVersion: "1.1";
  readonly id: string;
  readonly type: StoryBibleV11AssetType;
  readonly title: string;
  readonly status: StoryBibleEntityStatus;
  readonly summary: string;
  readonly aliases: string[];
  readonly relations: StoryBibleRelation[];
  readonly details: JsonObject;
  readonly extensions: JsonObject;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revision: number;
  readonly relatedEntityIds?: string[];
}

export interface StoryBiblePassthroughSummary {
  readonly present: boolean;
  readonly sourceSchemaVersion: "1.0" | null;
  readonly fieldCount: number;
  readonly rootFieldNames: readonly string[];
  readonly detailPointers: readonly string[];
  readonly pointerSummaryTruncated: boolean;
}

export interface StoryBibleAgentAssetRead {
  readonly asset: StoryBibleAgentAsset;
  readonly revision: number;
  readonly checksum: string;
  readonly relativePath: string;
  readonly persistedSchemaVersion: StoryBibleSchemaVersion;
  readonly passthrough: StoryBiblePassthroughSummary;
}

export type StoryBibleReferenceTargetKind = StoryBibleReferenceTargetType | "chapter";

export interface StoryBibleReference {
  readonly sourceAssetId: string;
  readonly sourceType: StoryBibleV11AssetType;
  readonly sourceTitle: string;
  readonly sourceStatus: StoryBibleEntityStatus;
  readonly sourceRevision: number;
  readonly targetAssetId: string;
  readonly targetType?: StoryBibleV11AssetType;
  readonly targetTitle?: string;
  readonly targetStatus?: StoryBibleEntityStatus;
  readonly targetReferenceType?: StoryBibleReferenceTargetKind;
  readonly expectedTargetTypes: readonly StoryBibleReferenceTargetKind[];
  readonly integrity: "valid" | "deleted" | "missing" | "type-mismatch";
  readonly warnings: readonly StoryBibleReferenceWarning[];
  readonly kind: "detail" | "relation";
  readonly path: string;
  readonly relationId?: string;
  readonly relationType?: string;
}

export interface StoryBibleReferenceWarning {
  readonly code:
    | "target-deleted"
    | "target-missing"
    | "target-type-mismatch"
    | "chapter-missing"
    | "duplicate-relation-id"
    | "explicit-inverse-invalid"
    | "explicit-inverse-inconsistent";
  readonly message: string;
}

export interface StoryBibleReferenceImpact {
  readonly assetId: string;
  readonly deletionImpactChecksum: string;
  readonly incoming: readonly StoryBibleReference[];
  readonly outgoing: readonly StoryBibleReference[];
  readonly canSetDeleted: boolean;
  readonly deletionImpact: {
    readonly affectedReferenceCount: number;
    readonly affectedAssetIds: readonly string[];
    readonly cascades: false;
  };
}

export interface StoryBibleRepositoryPort {
  readStoryBible(): Promise<Result<StoryBibleSnapshot, UnifiedError>>;
  saveStoryAsset(asset: StoryBibleAsset): Promise<Result<StoryBibleAsset, UnifiedError>>;
  saveMemory(memory: MemoryRecord): Promise<Result<MemoryRecord, UnifiedError>>;
  readCompatibleStoryAsset?(
    assetId: string
  ): Promise<Result<StoryBibleCompatibleAssetRead, UnifiedError>>;
  createStoryAsset?(
    input: CreateStoryBibleAssetInput
  ): Promise<Result<StoryBibleV11Asset, UnifiedError>>;
  prepareCreateStoryAsset?(
    input: CreateStoryBibleAssetInput
  ): Promise<Result<PreparedStoryBibleCreate, UnifiedError>>;
  prepareStoryAssetCandidate?(
    input: SaveStoryBibleCandidateInput
  ): Promise<Result<PreparedStoryBibleWrite, UnifiedError>>;
  prepareStoryAssetCandidateReadOnly?(
    input: SaveStoryBibleCandidateInput & { readonly baseChecksum: string }
  ): Promise<Result<PreparedStoryBibleWrite, UnifiedError>>;
  validateStoryBibleCandidateGroup?(
    input: ValidateStoryBibleCandidateGroupInput
  ): Promise<Result<void, UnifiedError>>;
  saveStoryAssetCandidate?(
    input: SaveStoryBibleCandidateInput
  ): Promise<Result<StoryBibleV11Asset, UnifiedError>>;
  saveStoryAssetStatusTransition?(
    input: SaveStoryBibleStatusTransitionInput
  ): Promise<Result<StoryBibleV11Asset, UnifiedError>>;
  listStoryBible?(input?: StoryBibleListInput): Promise<Result<StoryBibleListPage, UnifiedError>>;
  readStoryAssetForAgent?(assetId: string): Promise<Result<StoryBibleAgentAssetRead, UnifiedError>>;
  getStoryBibleReferences?(
    assetId: string,
    knownChapterIds?: readonly string[]
  ): Promise<Result<StoryBibleReferenceImpact, UnifiedError>>;
}

export interface StoryBibleFileRepositoryOptions {
  readonly projectRoot: string;
  readonly traceId?: string;
  readonly now?: () => string;
  readonly createAssetId?: (type: StoryBibleV11AssetType) => string;
  readonly registeredExtensionNamespaces?: ReadonlySet<string>;
  readonly beforeStoryAssetCandidateWrite?: (
    prepared: PreparedStoryBibleWrite
  ) => Promise<Result<void, UnifiedError>>;
}

interface StoryBibleListIndexCache {
  readonly inventoryRevision: string;
  readonly reads: readonly { readonly value: StoryBibleCompatibleAssetRead }[];
}

interface StoryBibleProjectReferenceContext {
  readonly assets: readonly StoryBibleV11Asset[];
  readonly targets: ReadonlyMap<string, StoryBibleReferenceTargetType>;
}

export class StoryBibleFileRepository implements StoryBibleRepositoryPort {
  private readonly traceId: string;
  private readonly pathGuard: ProjectPathGuard;
  private readonly now: () => string;
  private readonly createAssetId: (type: StoryBibleV11AssetType) => string;
  private readonly registeredExtensionNamespaces: ReadonlySet<string>;
  private storyBibleListIndexCache: StoryBibleListIndexCache | undefined;

  public constructor(private readonly options: StoryBibleFileRepositoryOptions) {
    this.traceId = options.traceId ?? "trace_repository_story_bible";
    this.pathGuard = createProjectPathGuard(options.projectRoot);
    this.now = options.now ?? (() => new Date().toISOString());
    this.createAssetId = options.createAssetId ?? createStoryBibleAssetId;
    this.registeredExtensionNamespaces = new Set(options.registeredExtensionNamespaces ?? []);
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
      "world.glossary",
      "world.item",
      "world.lore"
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
    return withStoryBibleProjectWriteLock(this.options.projectRoot, () =>
      this.saveStoryAssetUnlocked(asset)
    );
  }

  private async saveStoryAssetUnlocked(
    asset: StoryBibleAsset
  ): Promise<Result<StoryBibleAsset, UnifiedError>> {
    const validation = await this.validateStoryAsset(asset, undefined, undefined, "externalWrite");
    if (!validation.ok) {
      return validation;
    }
    if (validation.value.schemaVersion === "1.1") {
      return err(
        validationError({
          code: "STORY_BIBLE_CAS_REQUIRED",
          message: "Story Bible v1.1 assets require a base revision before writing.",
          suggestedAction: "Use the strict Story Bible candidate save operation.",
          traceId: this.traceId,
          redactedDetail: { assetId: validation.value.id }
        })
      );
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
    const existingPath = await this.locateStoryAssetFile(validation.value.id);
    if (!existingPath.ok) return existingPath;
    if (existingPath.value === undefined && validation.value.status === "deleted") {
      return err(storyBibleStatusTransitionCommandRequired(this.traceId, validation.value.id));
    }
    if (existingPath.value !== undefined) {
      const current = await this.readCompatibleStoryAssetFile(existingPath.value);
      if (!current.ok) return current;
      const statusTransition = await this.validateStoryBibleStatusTransition(
        current.value,
        validation.value.status
      );
      if (!statusTransition.ok) return statusTransition;
    }
    const writeResult = await this.writeJson(relativePath, canonicalAsset);
    if (!writeResult.ok) {
      return writeResult;
    }

    return ok(canonicalAsset);
  }

  public async readCompatibleStoryAsset(
    assetId: string
  ): Promise<Result<StoryBibleCompatibleAssetRead, UnifiedError>> {
    const located = await this.locateStoryAssetFile(assetId);
    if (!located.ok) return located;
    if (located.value === undefined) {
      return err(storyBibleNotFoundError(this.traceId, assetId));
    }
    return this.readCompatibleStoryAssetFile(located.value);
  }

  private async readCompatibleStoryAssetFile(
    relativePath: string
  ): Promise<Result<StoryBibleCompatibleAssetRead, UnifiedError>> {
    const raw = await this.readStoryAssetText(relativePath);
    if (!raw.ok) return raw;
    const validated = await this.validateStoryAsset(
      raw.value.parsed,
      relativePath,
      undefined,
      "persistedRead"
    );
    if (!validated.ok) return validated;
    if (!isCompatibleStoryAssetReadPath(relativePath, validated.value)) {
      return err(
        storyBibleAssetValidationError({
          traceId: this.traceId,
          relativePath,
          issues: [
            candidateIssue("/id", "assetPath", "must match the canonical Story Bible asset path")
          ]
        })
      );
    }
    const checksum = checksumStoryBibleText(raw.value.content);
    const portableRelativePath = comparableStoryBiblePath(relativePath);
    try {
      if (validated.value.schemaVersion === "1.1") {
        return ok(
          compatibleV11StoryBibleAsset({
            asset: validated.value as unknown as StoryBibleV11Asset,
            checksum,
            relativePath: portableRelativePath
          })
        );
      }
      return ok(
        adaptLegacyStoryBibleAsset({
          asset: validated.value,
          checksum,
          relativePath: portableRelativePath
        })
      );
    } catch (error) {
      return err(
        storyBibleAssetValidationError({
          traceId: this.traceId,
          relativePath,
          issues: [
            {
              instancePath: "/passthrough",
              schemaPath: "#/properties/passthrough",
              keyword: "compatibilityBounds",
              message: error instanceof Error ? error.message : "could not be adapted safely"
            }
          ]
        })
      );
    }
  }

  public async createStoryAsset(
    input: CreateStoryBibleAssetInput
  ): Promise<Result<StoryBibleV11Asset, UnifiedError>> {
    return withStoryBibleProjectWriteLock(this.options.projectRoot, () =>
      this.createStoryAssetUnlocked(input)
    );
  }

  private async createStoryAssetUnlocked(
    input: CreateStoryBibleAssetInput
  ): Promise<Result<StoryBibleV11Asset, UnifiedError>> {
    const prepared = await this.prepareCreateStoryAsset({
      ...input,
      deferProjectRelationPairValidation: false
    });
    if (!prepared.ok) return prepared;
    const written = await writeTextAtomically({
      targetPath: join(this.options.projectRoot, prepared.value.relativePath),
      content: prepared.value.content,
      traceId: this.traceId,
      pathGuard: this.pathGuard,
      beforeReplace: async () =>
        (await fileExists(join(this.options.projectRoot, prepared.value.relativePath)))
          ? err(
              storyBibleConflictError(
                this.traceId,
                "STORY_BIBLE_ASSET_ALREADY_EXISTS",
                prepared.value.asset.id
              )
            )
          : ok(undefined)
    });
    return written.ok ? ok(prepared.value.asset) : written;
  }

  public async prepareCreateStoryAsset(
    input: CreateStoryBibleAssetInput
  ): Promise<Result<PreparedStoryBibleCreate, UnifiedError>> {
    if (!isStoryBibleV11AssetType(input.type)) {
      return err(
        storyBibleCandidateValidationError(this.traceId, [
          candidateIssue("/type", "enum", "must be a supported Story Bible type")
        ])
      );
    }
    const valueKeys = Object.keys(input.value);
    const allowedValueKeys = new Set([
      "title",
      "status",
      "summary",
      "aliases",
      "relations",
      "details",
      "extensions"
    ]);
    const unknownValueKey = valueKeys.find((key) => !allowedValueKeys.has(key));
    if (unknownValueKey !== undefined || "passthrough" in input.value) {
      return err(
        storyBibleCandidateValidationError(this.traceId, [
          candidateIssue(
            `/${unknownValueKey ?? "passthrough"}`,
            "additionalProperties",
            "must not contain system-managed or unknown fields"
          )
        ])
      );
    }
    const id = input.reservedAssetId ?? this.createAssetId(input.type);
    if (!isStoryBibleAssetIdForType(id, input.type)) {
      return err(
        storyBibleCandidateValidationError(this.traceId, [
          candidateIssue("/id", "assetId", "must be a valid server-reserved ID for the asset type")
        ])
      );
    }
    const timestamp = this.now();
    const relations = (input.value.relations ?? []).map((relation) => ({
      ...relation,
      sourceId: id
    }));
    const details = reconcileStoryBibleEntryRevisions(
      input.type,
      {},
      mergeStoryBibleDefaults(
        createStoryBibleDefaultDetails(input.type) as JsonObject,
        input.value.details
      ),
      true
    );
    const asset: StoryBibleV11Asset = {
      schemaVersion: "1.1",
      id,
      type: input.type,
      title: input.value.title,
      status: input.value.status ?? "active",
      summary: input.value.summary ?? "",
      aliases: [...(input.value.aliases ?? [])],
      relations,
      details,
      extensions: input.value.extensions ?? {},
      createdAt: timestamp,
      updatedAt: timestamp,
      revision: 1,
      ...(deriveRelatedEntityIds(relations) === undefined
        ? {}
        : { relatedEntityIds: [...(deriveRelatedEntityIds(relations) ?? [])] })
    };
    const referenceContext = await this.readStoryBibleProjectReferenceContext();
    if (!referenceContext.ok) return referenceContext;
    const candidateAssets = replaceStoryBibleProjectAsset(referenceContext.value.assets, asset);
    const knownReferenceTargets = storyBibleReferenceTargets(
      candidateAssets,
      input.additionalKnownAssetIds,
      input.additionalKnownReferenceTargets
    );
    const knownChapterIds = knownChapterIdsForWrite(asset, input.knownChapterIds);
    if (!knownChapterIds.ok) {
      return err(storyBibleCandidateValidationError(this.traceId, knownChapterIds.issues));
    }
    const validation = validateStoryBibleV11Asset(asset, "persistedStrict", {
      assetType: input.type,
      knownReferenceTargets,
      ...(knownChapterIds.value === undefined ? {} : { knownChapterIds: knownChapterIds.value }),
      registeredExtensionNamespaces: this.registeredExtensionNamespaces
    });
    if (!validation.valid) {
      return err(storyBibleCandidateValidationError(this.traceId, validation.issues));
    }
    const relationIssues = newProjectRelationIssues(
      referenceContext.value.assets,
      candidateAssets,
      asset,
      input.deferProjectRelationPairValidation === true
    );
    if (relationIssues.length > 0) {
      return err(storyBibleCandidateValidationError(this.traceId, relationIssues));
    }
    const relativePath = portableStoryAssetPath(asset as unknown as StoryBibleAsset);
    if (
      !isStoryAssetWritePathSafe(
        this.options.projectRoot,
        asset as unknown as StoryBibleAsset,
        relativePath
      )
    ) {
      return err(
        storyBibleCandidateValidationError(this.traceId, [
          candidateIssue("/id", "assetPath", "must resolve inside the Story Bible asset directory")
        ])
      );
    }
    if (await fileExists(join(this.options.projectRoot, relativePath))) {
      return err(storyBibleConflictError(this.traceId, "STORY_BIBLE_ASSET_ALREADY_EXISTS", id));
    }
    const content = canonicalStoryBibleJson(asset);
    return ok({ asset, relativePath, content });
  }

  public async saveStoryAssetCandidate(
    input: SaveStoryBibleCandidateInput
  ): Promise<Result<StoryBibleV11Asset, UnifiedError>> {
    return withStoryBibleProjectWriteLock(this.options.projectRoot, () =>
      this.saveStoryAssetCandidateUnlocked(input)
    );
  }

  public async saveStoryAssetStatusTransition(
    input: SaveStoryBibleStatusTransitionInput
  ): Promise<Result<StoryBibleV11Asset, UnifiedError>> {
    return withStoryBibleProjectWriteLock(this.options.projectRoot, () =>
      this.saveStoryAssetCandidateUnlocked(input, input.statusTransition)
    );
  }

  private async saveStoryAssetCandidateUnlocked(
    input: SaveStoryBibleCandidateInput,
    statusTransition?: SaveStoryBibleStatusTransitionInput["statusTransition"]
  ): Promise<Result<StoryBibleV11Asset, UnifiedError>> {
    const prepared = await this.prepareStoryAssetCandidateInternal(
      {
        ...input,
        deferProjectRelationPairValidation: false
      },
      true
    );
    if (!prepared.ok) return prepared;
    const allowedStatusTransition = await this.validateStoryBibleStatusTransition(
      prepared.value.current,
      prepared.value.asset.status,
      statusTransition,
      input.knownChapterIds
    );
    if (!allowedStatusTransition.ok) return allowedStatusTransition;
    const sourceRelativePath = prepared.value.current.relativePath;
    const migratesLegacyPath =
      comparableStoryBiblePath(sourceRelativePath) !==
      comparableStoryBiblePath(prepared.value.relativePath);
    const written = await writeTextAtomically({
      targetPath: join(this.options.projectRoot, prepared.value.relativePath),
      content: prepared.value.content,
      traceId: this.traceId,
      pathGuard: this.pathGuard,
      beforeReplace: async () => {
        const latest = await this.readStoryAssetText(sourceRelativePath);
        if (!latest.ok) return latest;
        if (checksumStoryBibleText(latest.value.content) !== prepared.value.baseChecksum) {
          return err(
            storyBibleConflictError(
              this.traceId,
              "STORY_BIBLE_CHECKSUM_CONFLICT",
              prepared.value.asset.id,
              prepared.value.baseRevision,
              prepared.value.baseChecksum
            )
          );
        }
        if (migratesLegacyPath) {
          const targetMissing = await this.verifyMigrationTargetMissing(prepared.value);
          if (!targetMissing.ok) return targetMissing;
        }
        if (statusTransition?.action === "move-to-deleted") {
          const currentImpact = await this.validateDeletionImpactChecksum(
            prepared.value.asset.id,
            statusTransition.expectedDeletionImpactChecksum,
            input.knownChapterIds
          );
          if (!currentImpact.ok) return currentImpact;
        }
        if (this.options.beforeStoryAssetCandidateWrite !== undefined) {
          const ready = await this.options.beforeStoryAssetCandidateWrite(prepared.value);
          if (!ready.ok) return ready;
        }
        if (statusTransition?.action === "move-to-deleted") {
          return this.validateDeletionImpactChecksum(
            prepared.value.asset.id,
            statusTransition.expectedDeletionImpactChecksum,
            input.knownChapterIds
          );
        }
        return ok(undefined);
      }
    });
    if (!written.ok) return written;
    if (migratesLegacyPath) {
      const removedLegacy = await this.removeMigratedLegacyStoryAsset(prepared.value);
      if (!removedLegacy.ok) return removedLegacy;
    }
    return ok(prepared.value.asset);
  }

  private async validateStoryBibleStatusTransition(
    current: StoryBibleCompatibleAssetRead,
    nextStatus: StoryBibleEntityStatus,
    authorization?: SaveStoryBibleStatusTransitionInput["statusTransition"],
    knownChapterIds?: readonly string[]
  ): Promise<Result<void, UnifiedError>> {
    const entersDeleted = current.asset.status !== "deleted" && nextStatus === "deleted";
    const leavesDeleted = current.asset.status === "deleted" && nextStatus !== "deleted";
    if (!entersDeleted && !leavesDeleted) {
      return authorization === undefined
        ? ok(undefined)
        : err(storyBibleStatusTransitionInvalid(this.traceId, current.asset.id));
    }
    if (authorization === undefined) {
      return err(storyBibleStatusTransitionCommandRequired(this.traceId, current.asset.id));
    }
    if (entersDeleted) {
      if (
        authorization.action !== "move-to-deleted" ||
        !/^[a-f0-9]{64}$/u.test(authorization.expectedDeletionImpactChecksum)
      ) {
        return err(storyBibleStatusTransitionInvalid(this.traceId, current.asset.id));
      }
      return this.validateDeletionImpactChecksum(
        current.asset.id,
        authorization.expectedDeletionImpactChecksum,
        knownChapterIds
      );
    }
    if (authorization.action !== "restore" || nextStatus !== authorization.restoreStatus) {
      return err(storyBibleStatusTransitionInvalid(this.traceId, current.asset.id));
    }
    return ok(undefined);
  }

  private async validateDeletionImpactChecksum(
    assetId: string,
    expectedChecksum: string,
    knownChapterIds?: readonly string[]
  ): Promise<Result<void, UnifiedError>> {
    const impact = await this.getStoryBibleReferences(assetId, knownChapterIds);
    if (!impact.ok) return impact;
    if (!impact.value.canSetDeleted) {
      return err(storyBibleSingletonDeleteForbidden(this.traceId, assetId));
    }
    return impact.value.deletionImpactChecksum === expectedChecksum
      ? ok(undefined)
      : err(storyBibleDeletionImpactChanged(this.traceId, assetId));
  }

  public async prepareStoryAssetCandidate(
    input: SaveStoryBibleCandidateInput
  ): Promise<Result<PreparedStoryBibleWrite, UnifiedError>> {
    return this.prepareStoryAssetCandidateInternal(input, false);
  }

  public async prepareStoryAssetCandidateReadOnly(
    input: SaveStoryBibleCandidateInput & { readonly baseChecksum: string }
  ): Promise<Result<PreparedStoryBibleWrite, UnifiedError>> {
    return this.prepareStoryAssetCandidateInternal(input, true);
  }

  private async prepareStoryAssetCandidateInternal(
    input: SaveStoryBibleCandidateInput,
    deferLegacyPathMigration: boolean
  ): Promise<Result<PreparedStoryBibleWrite, UnifiedError>> {
    if (!isStoryBibleWriteCandidate(input.candidate)) {
      const unknown = isJsonObject(input.candidate)
        ? Object.keys(input.candidate).find(
            (key) => !(STORY_BIBLE_CANDIDATE_ROOT_FIELDS as readonly string[]).includes(key)
          )
        : undefined;
      return err(
        storyBibleCandidateValidationError(this.traceId, [
          candidateIssue(
            `/${unknown ?? "candidate"}`,
            "additionalProperties",
            "must contain only author-controlled v1.1 fields"
          )
        ])
      );
    }
    const current = await this.readCompatibleStoryAsset(input.candidate.id);
    if (!current.ok) return current;
    if (
      deferLegacyPathMigration &&
      current.value.persistedSchemaVersion === "1.0" &&
      input.baseChecksum === undefined
    ) {
      return err(
        storyBibleCandidateValidationError(this.traceId, [
          candidateIssue(
            "/baseChecksum",
            "required",
            "is required for a read-only Story Bible candidate preparation"
          )
        ])
      );
    }
    const allowedExtensionNamespaces = writableExtensionNamespaces(
      this.registeredExtensionNamespaces,
      current.value.asset.extensions,
      input.candidate.extensions
    );
    const strictCandidate = validateStoryBibleWriteCandidate(input.candidate, {
      assetType: input.candidate.type,
      registeredExtensionNamespaces: allowedExtensionNamespaces,
      allowLegacyId:
        current.value.persistedSchemaVersion === "1.0" ||
        current.value.asset.passthrough?.sourceSchemaVersion === "1.0"
    });
    if (!strictCandidate.valid) {
      return err(storyBibleCandidateValidationError(this.traceId, strictCandidate.issues));
    }
    if (
      current.value.asset.type !== input.candidate.type ||
      current.value.asset.id !== input.candidate.id ||
      current.value.asset.createdAt !== input.candidate.createdAt
    ) {
      return err(
        storyBibleCandidateValidationError(this.traceId, [
          candidateIssue("/id", "immutable", "id, type, and createdAt must match the current asset")
        ])
      );
    }
    if (
      input.baseRevision !== current.value.revision ||
      (current.value.persistedSchemaVersion === "1.0" &&
        input.baseChecksum !== current.value.checksum) ||
      (input.baseChecksum !== undefined && input.baseChecksum !== current.value.checksum)
    ) {
      return err(
        storyBibleConflictError(
          this.traceId,
          current.value.persistedSchemaVersion === "1.0"
            ? "STORY_BIBLE_LEGACY_CHECKSUM_CONFLICT"
            : "STORY_BIBLE_REVISION_CONFLICT",
          input.candidate.id,
          current.value.revision,
          current.value.checksum
        )
      );
    }
    const nextRevision =
      current.value.persistedSchemaVersion === "1.0" ? 1 : current.value.revision + 1;
    const managedCandidate: StoryBibleWriteCandidate = {
      ...input.candidate,
      details: reconcileStoryBibleEntryRevisions(
        input.candidate.type,
        current.value.asset.details,
        input.candidate.details,
        current.value.persistedSchemaVersion === "1.0"
      )
    };
    const relatedEntityIds = deriveRelatedEntityIds(managedCandidate.relations);
    const writeCandidate: StoryBibleV11Asset = {
      ...managedCandidate,
      updatedAt: this.now(),
      revision: nextRevision
    };
    const candidateValidation = validateStoryBibleV11Asset(writeCandidate, "writeStrict", {
      assetType: writeCandidate.type,
      registeredExtensionNamespaces: allowedExtensionNamespaces,
      allowLegacyId:
        current.value.persistedSchemaVersion === "1.0" ||
        current.value.asset.passthrough?.sourceSchemaVersion === "1.0"
    });
    if (!candidateValidation.valid) {
      return err(storyBibleCandidateValidationError(this.traceId, candidateValidation.issues));
    }
    const persisted: StoryBibleV11Asset = {
      ...writeCandidate,
      ...(relatedEntityIds === undefined ? {} : { relatedEntityIds: [...relatedEntityIds] }),
      ...(current.value.asset.passthrough === undefined
        ? {}
        : { passthrough: current.value.asset.passthrough })
    };
    const referenceContext = await this.readStoryBibleProjectReferenceContext();
    if (!referenceContext.ok) return referenceContext;
    const candidateAssets = replaceStoryBibleProjectAsset(referenceContext.value.assets, persisted);
    const knownReferenceTargets = storyBibleReferenceTargets(
      candidateAssets,
      input.additionalKnownAssetIds,
      input.additionalKnownReferenceTargets
    );
    const knownChapterIds = knownChapterIdsForWrite(persisted, input.knownChapterIds);
    if (!knownChapterIds.ok) {
      return err(storyBibleCandidateValidationError(this.traceId, knownChapterIds.issues));
    }
    const inheritedInvalidReferenceCounts = invalidStoryBibleReferenceCounts(
      current.value.asset,
      referenceContext.value.targets
    );
    const persistedValidation = validateStoryBibleV11Asset(persisted, "persistedStrict", {
      assetType: persisted.type,
      knownReferenceTargets,
      inheritedInvalidReferenceCounts,
      ...(knownChapterIds.value === undefined
        ? {}
        : {
            knownChapterIds: knownChapterIds.value,
            inheritedInvalidChapterReferenceCounts: invalidStoryBibleChapterReferenceCounts(
              current.value.asset,
              knownChapterIds.value
            )
          }),
      registeredExtensionNamespaces: allowedExtensionNamespaces,
      allowLegacyId:
        current.value.persistedSchemaVersion === "1.0" ||
        current.value.asset.passthrough?.sourceSchemaVersion === "1.0"
    });
    if (!persistedValidation.valid) {
      return err(storyBibleCandidateValidationError(this.traceId, persistedValidation.issues));
    }
    const relationIssues = newProjectRelationIssues(
      referenceContext.value.assets,
      candidateAssets,
      persisted,
      input.deferProjectRelationPairValidation === true
    );
    if (relationIssues.length > 0) {
      return err(storyBibleCandidateValidationError(this.traceId, relationIssues));
    }
    const relativePath = portableStoryAssetPath(persisted as unknown as StoryBibleAsset);
    const content = canonicalStoryBibleJson(persisted);
    const base = await this.readStoryAssetText(current.value.relativePath);
    if (!base.ok) return base;
    if (checksumStoryBibleText(base.value.content) !== current.value.checksum) {
      return err(
        storyBibleConflictError(
          this.traceId,
          "STORY_BIBLE_CHECKSUM_CONFLICT",
          input.candidate.id,
          current.value.revision,
          current.value.checksum
        )
      );
    }
    let preparedCurrent = current.value;
    if (
      comparableStoryBiblePath(current.value.relativePath) !==
      comparableStoryBiblePath(relativePath)
    ) {
      if (deferLegacyPathMigration) {
        const targetMissing = await this.verifyMigrationTargetMissing({
          asset: persisted,
          current: current.value,
          relativePath,
          content,
          baseContent: base.value.content,
          baseRevision: current.value.revision,
          baseChecksum: current.value.checksum
        });
        if (!targetMissing.ok) return targetMissing;
      } else {
        const migrated = await this.migrateLegacyStoryAssetPath({
          current: current.value,
          relativePath,
          content: base.value.content
        });
        if (!migrated.ok) return migrated;
        preparedCurrent = migrated.value;
      }
    }
    return ok({
      asset: persisted,
      current: preparedCurrent,
      relativePath,
      content,
      baseContent: base.value.content,
      baseRevision: current.value.revision,
      baseChecksum: current.value.checksum
    });
  }

  public async validateStoryBibleCandidateGroup(
    input: ValidateStoryBibleCandidateGroupInput
  ): Promise<Result<void, UnifiedError>> {
    if (!Array.isArray(input.candidates) || input.candidates.length === 0) {
      return err(
        storyBibleCandidateValidationError(this.traceId, [
          candidateIssue(
            "/candidates",
            "minItems",
            "must contain at least one Story Bible candidate"
          )
        ])
      );
    }

    const reads = await this.readAllCompatibleStoryAssets();
    if (!reads.ok) return reads;
    const baselineReads = reads.value.map(({ value }) => value);
    const baselineAssets = baselineReads.map(({ asset }) => asset);
    const baselineById = new Map(baselineReads.map((read) => [read.asset.id, read] as const));
    const baselineTargetIndex = storyBibleReferenceTargets(baselineAssets);
    const baselinePathOwners = new Map(
      baselineReads.map(
        (read) => [comparableStoryBiblePath(read.relativePath), read.asset.id] as const
      )
    );
    const seenPaths = new Set<string>();
    const seenAssetIds = new Set<string>();
    const candidates: {
      readonly index: number;
      readonly relativePath: string;
      readonly asset: StoryBibleV11Asset;
      readonly current?: StoryBibleCompatibleAssetRead;
      readonly allowedExtensionNamespaces: ReadonlySet<string>;
      readonly allowLegacyId: boolean;
    }[] = [];

    for (const [index, candidate] of input.candidates.entries()) {
      if (
        candidate === null ||
        typeof candidate !== "object" ||
        typeof candidate.relativePath !== "string" ||
        typeof candidate.candidateContent !== "string"
      ) {
        return err(
          storyBibleCandidateValidationError(this.traceId, [
            candidateIssue(
              `/candidates/${index}`,
              "type",
              "must contain a relativePath and JSON candidateContent"
            )
          ])
        );
      }
      const relativePath = normalizeStoryBibleCandidatePath(candidate.relativePath);
      if (relativePath === undefined) {
        return err(
          storyBibleCandidateValidationError(this.traceId, [
            candidateIssue(
              `/candidates/${index}/relativePath`,
              "assetPath",
              "must be a canonical project-relative Story Bible path"
            )
          ])
        );
      }
      if (seenPaths.has(relativePath)) {
        return err(
          storyBibleCandidateValidationError(this.traceId, [
            candidateIssue(
              `/candidates/${index}/relativePath`,
              "uniqueCandidatePath",
              "must be unique within the candidate group"
            )
          ])
        );
      }
      seenPaths.add(relativePath);

      let parsed: unknown;
      try {
        parsed = JSON.parse(candidate.candidateContent);
      } catch {
        return err(
          storyBibleCandidateValidationError(this.traceId, [
            candidateIssue(
              `/candidates/${index}/candidateContent`,
              "json",
              "must contain valid Story Bible JSON"
            )
          ])
        );
      }
      const candidateId = isJsonObject(parsed) ? parsed["id"] : undefined;
      const current = typeof candidateId === "string" ? baselineById.get(candidateId) : undefined;
      const allowLegacyId =
        current?.persistedSchemaVersion === "1.0" ||
        current?.asset.passthrough?.sourceSchemaVersion === "1.0";
      const candidateExtensions =
        isJsonObject(parsed) && isJsonObject(parsed["extensions"]) ? parsed["extensions"] : {};
      const allowedExtensionNamespaces =
        current === undefined
          ? this.registeredExtensionNamespaces
          : writableExtensionNamespaces(
              this.registeredExtensionNamespaces,
              current.asset.extensions,
              candidateExtensions
            );
      const structuralValidation = validateStoryBibleV11Asset(parsed, "persistedStrict", {
        registeredExtensionNamespaces: allowedExtensionNamespaces,
        allowLegacyId
      });
      if (!structuralValidation.valid) {
        return err(
          storyBibleCandidateValidationError(
            this.traceId,
            prefixCandidateGroupIssues(index, structuralValidation.issues)
          )
        );
      }
      const asset = parsed as StoryBibleV11Asset;
      if (seenAssetIds.has(asset.id)) {
        return err(
          storyBibleCandidateValidationError(this.traceId, [
            candidateIssue(
              `/candidates/${index}/candidateContent/id`,
              "uniqueAssetId",
              "must be unique within the candidate group"
            )
          ])
        );
      }
      seenAssetIds.add(asset.id);

      const expectedPath = comparableStoryBiblePath(
        storyAssetPath(asset as unknown as StoryBibleAsset)
      );
      if (relativePath !== expectedPath) {
        return err(
          storyBibleCandidateValidationError(this.traceId, [
            candidateIssue(
              `/candidates/${index}/relativePath`,
              "assetPath",
              "must match the candidate asset id and type"
            )
          ])
        );
      }
      const baselinePathOwner = baselinePathOwners.get(relativePath);
      if (baselinePathOwner !== undefined && baselinePathOwner !== asset.id) {
        return err(
          storyBibleCandidateValidationError(this.traceId, [
            candidateIssue(
              `/candidates/${index}/relativePath`,
              "assetPath",
              "must not replace a different persisted Story Bible asset"
            )
          ])
        );
      }
      if (
        current !== undefined &&
        (current.asset.type !== asset.type || current.asset.createdAt !== asset.createdAt)
      ) {
        return err(
          storyBibleCandidateValidationError(this.traceId, [
            candidateIssue(
              `/candidates/${index}/candidateContent/id`,
              "immutable",
              "id, type, and createdAt must match the current asset"
            )
          ])
        );
      }
      candidates.push({
        index,
        relativePath,
        asset,
        ...(current === undefined ? {} : { current }),
        allowedExtensionNamespaces,
        allowLegacyId
      });
    }

    const projectedById = new Map(baselineAssets.map((asset) => [asset.id, asset] as const));
    for (const candidate of candidates) projectedById.set(candidate.asset.id, candidate.asset);
    const projectedAssets = [...projectedById.values()];
    const projectedTargets = storyBibleReferenceTargets(projectedAssets);

    for (const candidate of candidates) {
      const knownChapterIds = knownChapterIdsForWrite(candidate.asset, input.knownChapterIds);
      if (!knownChapterIds.ok) {
        return err(
          storyBibleCandidateValidationError(
            this.traceId,
            prefixCandidateGroupIssues(candidate.index, knownChapterIds.issues)
          )
        );
      }
      const validation = validateStoryBibleV11Asset(candidate.asset, "persistedStrict", {
        assetType: candidate.asset.type,
        knownReferenceTargets: projectedTargets,
        inheritedInvalidReferenceCounts:
          candidate.current === undefined
            ? new Map<string, number>()
            : invalidStoryBibleReferenceCounts(candidate.current.asset, baselineTargetIndex),
        ...(knownChapterIds.value === undefined
          ? {}
          : {
              knownChapterIds: knownChapterIds.value,
              inheritedInvalidChapterReferenceCounts:
                candidate.current === undefined
                  ? new Map<string, number>()
                  : invalidStoryBibleChapterReferenceCounts(
                      candidate.current.asset,
                      knownChapterIds.value
                    )
            }),
        registeredExtensionNamespaces: candidate.allowedExtensionNamespaces,
        allowLegacyId: candidate.allowLegacyId
      });
      if (!validation.valid) {
        return err(
          storyBibleCandidateValidationError(
            this.traceId,
            prefixCandidateGroupIssues(candidate.index, validation.issues)
          )
        );
      }
    }

    const relationIssues = newProjectRelationGroupIssues(
      baselineAssets,
      projectedAssets,
      candidates.map(({ asset }) => asset)
    );
    return relationIssues.length === 0
      ? ok(undefined)
      : err(storyBibleCandidateValidationError(this.traceId, relationIssues));
  }

  private async migrateLegacyStoryAssetPath(input: {
    readonly current: StoryBibleCompatibleAssetRead;
    readonly relativePath: string;
    readonly content: string;
  }): Promise<Result<StoryBibleCompatibleAssetRead, UnifiedError>> {
    const migration: PreparedStoryBibleWrite = {
      asset: input.current.asset,
      current: input.current,
      relativePath: input.relativePath,
      content: input.content,
      baseContent: input.content,
      baseRevision: input.current.revision,
      baseChecksum: input.current.checksum
    };
    const written = await writeTextAtomically({
      targetPath: join(this.options.projectRoot, input.relativePath),
      content: input.content,
      traceId: this.traceId,
      pathGuard: this.pathGuard,
      beforeReplace: async () => {
        const latest = await this.readStoryAssetText(input.current.relativePath);
        if (!latest.ok) return latest;
        if (checksumStoryBibleText(latest.value.content) !== input.current.checksum) {
          return err(
            storyBibleConflictError(
              this.traceId,
              "STORY_BIBLE_CHECKSUM_CONFLICT",
              input.current.asset.id,
              input.current.revision,
              input.current.checksum
            )
          );
        }
        return this.verifyMigrationTargetMissing(migration);
      }
    });
    if (!written.ok) return written;
    const removedLegacy = await this.removeMigratedLegacyStoryAsset(migration);
    return removedLegacy.ok
      ? ok({ ...input.current, relativePath: input.relativePath })
      : removedLegacy;
  }

  private async removeMigratedLegacyStoryAsset(
    prepared: PreparedStoryBibleWrite
  ): Promise<Result<void, UnifiedError>> {
    const sourceRelativePath = prepared.current.relativePath;
    const sourcePath = join(this.options.projectRoot, sourceRelativePath);
    try {
      await stat(sourcePath);
    } catch (error) {
      if (isMissingFileError(error)) return ok(undefined);
      const rolledBack = await this.rollbackMigratedCanonicalAsset(prepared);
      return err(storyBibleMigrationCleanupError(this.traceId, prepared.asset.id, rolledBack));
    }

    const latestSource = await this.readStoryAssetText(sourceRelativePath);
    if (
      !latestSource.ok ||
      checksumStoryBibleText(latestSource.value.content) !== prepared.baseChecksum
    ) {
      const rolledBack = await this.rollbackMigratedCanonicalAsset(prepared);
      if (!rolledBack) return err(storyBibleMigrationCleanupError(this.traceId, prepared.asset.id));
      return latestSource.ok
        ? err(
            storyBibleConflictError(
              this.traceId,
              "STORY_BIBLE_CHECKSUM_CONFLICT",
              prepared.asset.id,
              prepared.baseRevision,
              prepared.baseChecksum
            )
          )
        : latestSource;
    }

    const pathValidation = await verifyProjectStoragePath(this.pathGuard, sourcePath, this.traceId);
    if (!pathValidation.ok) {
      const rolledBack = await this.rollbackMigratedCanonicalAsset(prepared);
      return rolledBack
        ? pathValidation
        : err(storyBibleMigrationCleanupError(this.traceId, prepared.asset.id));
    }
    try {
      await unlink(sourcePath);
      return ok(undefined);
    } catch {
      const rolledBack = await this.rollbackMigratedCanonicalAsset(prepared);
      return err(storyBibleMigrationCleanupError(this.traceId, prepared.asset.id, rolledBack));
    }
  }

  private async rollbackMigratedCanonicalAsset(
    prepared: PreparedStoryBibleWrite
  ): Promise<boolean> {
    const targetPath = join(this.options.projectRoot, prepared.relativePath);
    const pathValidation = await verifyProjectStoragePath(this.pathGuard, targetPath, this.traceId);
    if (!pathValidation.ok) return false;
    const current = await this.readStoryAssetText(prepared.relativePath);
    if (!current.ok || current.value.content !== prepared.content) return false;
    try {
      await unlink(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  private async verifyMigrationTargetMissing(
    prepared: PreparedStoryBibleWrite
  ): Promise<Result<void, UnifiedError>> {
    try {
      await stat(join(this.options.projectRoot, prepared.relativePath));
      return err(
        storyBibleConflictError(this.traceId, "STORY_BIBLE_ASSET_ALREADY_EXISTS", prepared.asset.id)
      );
    } catch (error) {
      return isMissingFileError(error)
        ? ok(undefined)
        : err(storyBibleMigrationCleanupError(this.traceId, prepared.asset.id));
    }
  }

  public async listStoryBible(
    input: StoryBibleListInput = {}
  ): Promise<Result<StoryBibleListPage, UnifiedError>> {
    const parsedInput = validateStoryBibleListInput(input, this.traceId);
    if (!parsedInput.ok) return parsedInput;
    const reads = await this.readStoryBibleListIndex();
    if (!reads.ok) return reads;
    const sortedReads = [...reads.value].sort((left, right) =>
      compareStoryBibleListKeys(
        storyBibleListKey(left.value.asset),
        storyBibleListKey(right.value.asset)
      )
    );
    const indexRevision = storyBibleIndexRevision(sortedReads);
    const querySignature = storyBibleListQuerySignature(parsedInput.value);
    const filtered = sortedReads.filter((read) =>
      storyBibleListMatches(read.value.asset, parsedInput.value)
    );

    let startIndex = 0;
    if (parsedInput.value.cursor !== undefined) {
      const cursor = parseStoryBibleListCursor(parsedInput.value.cursor, this.traceId);
      if (!cursor.ok) return cursor;
      if (cursor.value.querySignature !== querySignature) {
        return err(
          storyBibleCursorError(
            this.traceId,
            "STORY_BIBLE_CURSOR_QUERY_MISMATCH",
            "The Story Bible cursor belongs to a different query."
          )
        );
      }
      if (cursor.value.indexRevision !== indexRevision) {
        return err(
          storyBibleCursorError(
            this.traceId,
            "STORY_BIBLE_CURSOR_STALE",
            "The Story Bible index changed while the result set was being paged."
          )
        );
      }
      const cursorIndex = filtered.findIndex(
        (read) =>
          compareStoryBibleListKeys(storyBibleListKey(read.value.asset), cursor.value.last) === 0
      );
      if (cursorIndex === -1) {
        return err(
          storyBibleCursorError(
            this.traceId,
            "STORY_BIBLE_CURSOR_INVALID",
            "The Story Bible cursor does not identify an item in this result set."
          )
        );
      }
      startIndex = cursorIndex + 1;
    }

    const pageReads = filtered.slice(startIndex, startIndex + parsedInput.value.limit);
    const items = pageReads.map(({ value }) => ({
      assetId: value.asset.id,
      type: value.asset.type,
      title: value.asset.title,
      status: value.asset.status,
      summary: value.asset.summary,
      revision: value.revision,
      indexRevision
    }));
    const hasNext = startIndex + pageReads.length < filtered.length;
    const lastRead = pageReads.at(-1);
    const nextCursor =
      hasNext && lastRead !== undefined
        ? createStoryBibleListCursor({
            indexRevision,
            querySignature,
            last: storyBibleListKey(lastRead.value.asset)
          })
        : null;
    return ok({ items, indexRevision, nextCursor });
  }

  public async readStoryAssetForAgent(
    assetId: string
  ): Promise<Result<StoryBibleAgentAssetRead, UnifiedError>> {
    const read = await this.readCompatibleStoryAsset(assetId);
    if (!read.ok) return read;
    const passthrough = read.value.asset.passthrough;
    const extensions: JsonObject = {};
    for (const namespace of [...this.registeredExtensionNamespaces].sort(compareIds)) {
      const value = read.value.asset.extensions[namespace];
      if (value !== undefined) extensions[namespace] = structuredClone(value);
    }
    const agentAsset: StoryBibleAgentAsset = {
      schemaVersion: "1.1",
      id: read.value.asset.id,
      type: read.value.asset.type,
      title: read.value.asset.title,
      status: read.value.asset.status,
      summary: read.value.asset.summary,
      aliases: [...read.value.asset.aliases],
      relations: structuredClone(read.value.asset.relations),
      details: structuredClone(read.value.asset.details),
      extensions,
      createdAt: read.value.asset.createdAt,
      updatedAt: read.value.asset.updatedAt,
      revision: read.value.asset.revision,
      ...(read.value.asset.relatedEntityIds === undefined
        ? {}
        : { relatedEntityIds: [...read.value.asset.relatedEntityIds] })
    };
    const rootFieldNames = Object.keys(passthrough?.rootFields ?? {}).sort(compareIds);
    const detailPointers = Object.keys(passthrough?.detailFieldsByPointer ?? {}).sort(compareIds);
    const pointerLimit = 100;
    return ok({
      asset: agentAsset,
      revision: read.value.revision,
      checksum: read.value.checksum,
      relativePath: read.value.relativePath,
      persistedSchemaVersion: read.value.persistedSchemaVersion,
      passthrough: {
        present: read.value.passthroughPresent,
        sourceSchemaVersion: passthrough?.sourceSchemaVersion ?? null,
        fieldCount: read.value.passthroughFieldCount,
        rootFieldNames: rootFieldNames.slice(0, pointerLimit),
        detailPointers: detailPointers.slice(0, pointerLimit),
        pointerSummaryTruncated:
          rootFieldNames.length > pointerLimit || detailPointers.length > pointerLimit
      }
    });
  }

  public async getStoryBibleReferences(
    assetId: string,
    knownChapterIds?: readonly string[]
  ): Promise<Result<StoryBibleReferenceImpact, UnifiedError>> {
    const reads = await this.readAllCompatibleStoryAssets();
    if (!reads.ok) return reads;
    const target = reads.value.find((read) => read.value.asset.id === assetId);
    if (target === undefined) return err(storyBibleNotFoundError(this.traceId, assetId));
    const references = collectStoryBibleReferences(
      reads.value,
      knownChapterIds === undefined ? undefined : new Set(knownChapterIds)
    );
    const incoming = references
      .filter((reference) => reference.targetAssetId === assetId)
      .sort(compareStoryBibleReferences);
    const outgoing = references
      .filter((reference) => reference.sourceAssetId === assetId)
      .sort(compareStoryBibleReferences);
    const canSetDeleted =
      target.value.asset.type !== "outline" && target.value.asset.type !== "timeline.events";
    const deletionImpact = {
      affectedReferenceCount: incoming.length,
      affectedAssetIds: [...new Set(incoming.map((reference) => reference.sourceAssetId))].sort(
        compareIds
      ),
      cascades: false as const
    };
    return ok({
      assetId,
      deletionImpactChecksum: checksumStoryBibleDeletionImpact({
        assetId,
        canSetDeleted,
        incoming,
        deletionImpact
      }),
      incoming,
      outgoing,
      canSetDeleted,
      deletionImpact
    });
  }

  /**
   * Main-only lifecycle evidence for a chapter tombstone. This reads the complete Story Bible
   * reference graph but returns only its stable checksum.
   */
  public async getChapterReferenceImpactChecksum(
    chapterId: string,
    knownChapterIds: readonly string[]
  ): Promise<Result<string, UnifiedError>> {
    if (!/^[A-Za-z0-9_-]{1,128}$/u.test(chapterId)) {
      return err(
        storyBibleCandidateValidationError(this.traceId, [
          candidateIssue("/chapterId", "pattern", "must be a stable chapter id")
        ])
      );
    }
    const known = new Set(knownChapterIds);
    if (!known.has(chapterId)) {
      return err(
        storyBibleCandidateValidationError(this.traceId, [
          candidateIssue("/chapterId", "knownChapter", "must exist in the current chapter catalog")
        ])
      );
    }
    const reads = await this.readAllCompatibleStoryAssets();
    if (!reads.ok) return reads;
    const incoming = collectStoryBibleReferences(reads.value, known)
      .filter(
        (reference) =>
          reference.targetAssetId === chapterId && reference.targetReferenceType === "chapter"
      )
      .sort(compareStoryBibleReferences);
    return ok(checksumStoryBibleText(JSON.stringify({ chapterId, incoming })));
  }

  public async saveMemory(memory: MemoryRecord): Promise<Result<MemoryRecord, UnifiedError>> {
    return withStoryBibleProjectWriteLock(this.options.projectRoot, () =>
      this.saveMemoryUnlocked(memory)
    );
  }

  private async saveMemoryUnlocked(
    memory: MemoryRecord
  ): Promise<Result<MemoryRecord, UnifiedError>> {
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
      if (comparableStoryBiblePath(filePath) !== storyAssetPath(asset.value)) {
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

  private async locateStoryAssetFile(
    assetId: string
  ): Promise<Result<string | undefined, UnifiedError>> {
    if (!/^[A-Za-z0-9_-]{1,128}$/u.test(assetId)) {
      return err(storyBibleNotFoundError(this.traceId, assetId));
    }
    if (assetId === "outline_main") {
      const path = join("outline", "outline.json");
      return ok((await fileExists(join(this.options.projectRoot, path))) ? path : undefined);
    }
    if (assetId === "timeline_main") {
      const path = join("timeline", "events.json");
      return ok((await fileExists(join(this.options.projectRoot, path))) ? path : undefined);
    }
    const directory = assetId.startsWith("chr_")
      ? "characters"
      : assetId.startsWith("fsh_")
        ? "foreshadows"
        : "world";
    const listed = await this.listJsonFiles(directory, directory !== "foreshadows");
    if (!listed.ok) return listed;
    const matches: string[] = [];
    for (const relativePath of listed.value) {
      const raw = await this.readStoryAssetText(relativePath);
      if (!raw.ok) return raw;
      if (isJsonObject(raw.value.parsed) && raw.value.parsed["id"] === assetId) {
        matches.push(relativePath);
      }
    }
    if (matches.length > 1) {
      return err(
        storyBibleAssetValidationError({
          traceId: this.traceId,
          issues: [
            candidateIssue(
              "/id",
              "uniqueAssetId",
              "must identify exactly one persisted Story Bible asset"
            )
          ]
        })
      );
    }
    return ok(matches[0]);
  }

  private async readStoryAssetText(
    relativePath: string
  ): Promise<Result<{ readonly content: string; readonly parsed: unknown }, UnifiedError>> {
    const targetPath = join(this.options.projectRoot, relativePath);
    const pathValidation = await verifyProjectStoragePath(this.pathGuard, targetPath, this.traceId);
    if (!pathValidation.ok) return pathValidation;
    try {
      const content = await readFile(targetPath, "utf8");
      return ok({ content, parsed: JSON.parse(content) });
    } catch (error) {
      return err(
        storageError({
          code: "STORY_BIBLE_ASSET_READ_FAILED",
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

  private async readStoryBibleProjectReferenceContext(): Promise<
    Result<StoryBibleProjectReferenceContext, UnifiedError>
  > {
    const reads = await this.readAllCompatibleStoryAssets();
    if (!reads.ok) return reads;
    const assets = reads.value.map(({ value }) => value.asset);
    return ok({ assets, targets: storyBibleReferenceTargets(assets) });
  }

  private async readAllCompatibleStoryAssets(): Promise<
    Result<readonly { readonly value: StoryBibleCompatibleAssetRead }[], UnifiedError>
  > {
    const inventory = await this.storyBibleAssetInventory();
    return inventory.ok
      ? this.readCompatibleStoryAssetPaths(inventory.value.relativePaths)
      : inventory;
  }

  private async readStoryBibleListIndex(): Promise<
    Result<readonly { readonly value: StoryBibleCompatibleAssetRead }[], UnifiedError>
  > {
    const inventory = await this.storyBibleAssetInventory();
    if (!inventory.ok) return inventory;
    if (this.storyBibleListIndexCache?.inventoryRevision === inventory.value.revision) {
      return ok(this.storyBibleListIndexCache.reads);
    }
    const reads = await this.readCompatibleStoryAssetPaths(inventory.value.relativePaths);
    if (!reads.ok) return reads;
    this.storyBibleListIndexCache = {
      inventoryRevision: inventory.value.revision,
      reads: reads.value
    };
    return reads;
  }

  private async storyBibleAssetInventory(): Promise<
    Result<{ readonly relativePaths: readonly string[]; readonly revision: string }, UnifiedError>
  > {
    const [characters, world, foreshadows] = await Promise.all([
      this.listJsonFiles("characters"),
      this.listJsonFiles("world"),
      this.listJsonFiles("foreshadows", false)
    ]);
    if (!characters.ok) return characters;
    if (!world.ok) return world;
    if (!foreshadows.ok) return foreshadows;
    const fixedPaths = [join("outline", "outline.json"), join("timeline", "events.json")];
    const existingFixedPaths: string[] = [];
    for (const relativePath of fixedPaths) {
      if (await fileExists(join(this.options.projectRoot, relativePath))) {
        existingFixedPaths.push(relativePath);
      }
    }
    const relativePaths = [
      ...characters.value,
      ...world.value,
      ...foreshadows.value,
      ...existingFixedPaths
    ].sort();
    const fingerprints: string[] = [];
    for (let start = 0; start < relativePaths.length; start += 100) {
      try {
        const batch = await Promise.all(
          relativePaths.slice(start, start + 100).map(async (relativePath) => {
            const metadata = await stat(join(this.options.projectRoot, relativePath), {
              bigint: true
            });
            return `${relativePath}\u0000${metadata.size}\u0000${metadata.mtimeNs}\u0000${metadata.ctimeNs}`;
          })
        );
        fingerprints.push(...batch);
      } catch (error) {
        return err(
          storageError({
            code: "STORY_BIBLE_DIRECTORY_READ_FAILED",
            message: "Story Bible file metadata could not be read.",
            suggestedAction: "Retry after external file changes finish.",
            traceId: this.traceId,
            redactedDetail: {
              reason: error instanceof Error ? error.message : "Unknown metadata read error"
            }
          })
        );
      }
    }
    return ok({
      relativePaths,
      revision: checksumStoryBibleText(fingerprints.join("\n"))
    });
  }

  private async readCompatibleStoryAssetPaths(
    relativePaths: readonly string[]
  ): Promise<Result<readonly { readonly value: StoryBibleCompatibleAssetRead }[], UnifiedError>> {
    const reads: { value: StoryBibleCompatibleAssetRead }[] = [];
    for (let start = 0; start < relativePaths.length; start += 50) {
      const batch = await Promise.all(
        relativePaths
          .slice(start, start + 50)
          .map((relativePath) => this.readCompatibleStoryAssetFile(relativePath))
      );
      for (const read of batch) {
        if (!read.ok) return read;
        reads.push({ value: read.value });
      }
    }
    const seenIds = new Set<string>();
    for (const read of reads) {
      if (seenIds.has(read.value.asset.id)) {
        return err(
          storyBibleCandidateValidationError(this.traceId, [
            candidateIssue(
              "/id",
              "uniqueAssetId",
              "must identify exactly one persisted Story Bible asset"
            )
          ])
        );
      }
      seenIds.add(read.value.asset.id);
    }
    return ok(reads);
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
      : "story-asset",
    mode: "persistedRead" | "externalWrite" = "persistedRead"
  ): Promise<Result<StoryBibleAsset, UnifiedError>> {
    const schemaVersion = isJsonObject(asset) ? asset["schemaVersion"] : undefined;
    const assetType = isJsonObject(asset) ? asset["type"] : undefined;
    const passthrough = isJsonObject(asset) ? asset["passthrough"] : undefined;
    const validation =
      schemaVersion === "1.1" && isStoryBibleV11AssetType(assetType)
        ? validateStoryBibleV11Asset(
            asset,
            mode === "externalWrite" ? "writeStrict" : "persistedStrict",
            {
              assetType,
              allowLegacyId:
                mode === "persistedRead" &&
                isJsonObject(passthrough) &&
                passthrough["sourceSchemaVersion"] === "1.0"
            }
          )
        : await validateWithSchema(schemaName, asset);
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

    if (
      storyAsset.schemaVersion === "1.1" &&
      relativePath !== undefined &&
      comparableStoryBiblePath(relativePath) !== storyAssetPath(storyAsset)
    ) {
      return err(
        storyBibleAssetValidationError({
          traceId: this.traceId,
          relativePath,
          issues: [
            {
              instancePath: "/id",
              schemaPath: "#/properties/id",
              keyword: "assetPath",
              message: "must match the canonical Story Bible asset path"
            }
          ]
        })
      );
    }

    if (storyAsset.type === "foreshadow") {
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
      return `characters/${asset.id}.json`;
    case "world.location":
    case "world.faction":
    case "world.rule":
    case "world.glossary":
    case "world.item":
    case "world.lore":
      return `world/${asset.id}.json`;
    case "outline":
      return "outline/outline.json";
    case "foreshadow":
      return `foreshadows/${asset.id}.json`;
    case "timeline.events":
      return "timeline/events.json";
  }
}

function normalizeStoryBibleCandidatePath(relativePath: string): string | undefined {
  if (
    relativePath.length === 0 ||
    isAbsolute(relativePath) ||
    /^[A-Za-z]:[\\/]/u.test(relativePath)
  ) {
    return undefined;
  }
  const segments = relativePath.split(/[\\/]/u);
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    return undefined;
  }
  return segments.join("/");
}

function comparableStoryBiblePath(relativePath: string): string {
  return relativePath.replaceAll("\\", "/");
}

function portableStoryAssetPath(asset: StoryBibleAsset): string {
  return comparableStoryBiblePath(storyAssetPath(asset));
}

function isCompatibleStoryAssetReadPath(relativePath: string, asset: StoryBibleAsset): boolean {
  if (comparableStoryBiblePath(relativePath) === storyAssetPath(asset)) return true;
  if (asset.schemaVersion !== "1.0") return false;

  const segments = relativePath.split(/[\\/]/u);
  if (
    segments.length < 2 ||
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..") ||
    !segments.at(-1)?.endsWith(".json")
  ) {
    return false;
  }
  if (asset.type === "character") return segments[0] === "characters";
  return asset.type.startsWith("world.") && segments[0] === "world";
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
    relations,
    details,
    extensions,
    relatedEntityIds,
    createdAt,
    updatedAt,
    revision,
    passthrough,
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
    ...(relations === undefined ? {} : { relations }),
    ...(details === undefined ? {} : { details }),
    ...(extensions === undefined ? {} : { extensions }),
    ...(relatedEntityIds === undefined ? {} : { relatedEntityIds }),
    createdAt,
    updatedAt,
    ...(revision === undefined ? {} : { revision }),
    ...(passthrough === undefined ? {} : { passthrough }),
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

const STORY_BIBLE_LIST_SORT_VERSION = "type-normalized-title-id-v1";
const STORY_BIBLE_STATUSES = new Set<StoryBibleEntityStatus>([
  "active",
  "draft",
  "archived",
  "deleted"
]);

interface NormalizedStoryBibleListInput {
  readonly types: readonly StoryBibleV11AssetType[];
  readonly statuses: readonly StoryBibleEntityStatus[];
  readonly query: string;
  readonly cursor?: string;
  readonly limit: number;
}

interface StoryBibleListKey {
  readonly type: StoryBibleV11AssetType;
  readonly normalizedTitle: string;
  readonly assetId: string;
}

interface StoryBibleListCursorPayload {
  readonly version: 1;
  readonly sortVersion: typeof STORY_BIBLE_LIST_SORT_VERSION;
  readonly indexRevision: string;
  readonly querySignature: string;
  readonly last: StoryBibleListKey;
}

function validateStoryBibleListInput(
  input: StoryBibleListInput,
  traceId: string
): Result<NormalizedStoryBibleListInput, UnifiedError> {
  const limit = input.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    return err(
      storyBibleCursorError(
        traceId,
        "STORY_BIBLE_LIST_LIMIT_INVALID",
        "Story Bible page size must be an integer from 1 to 100."
      )
    );
  }
  const types = [...new Set(input.types ?? [])];
  if (types.some((type) => !isStoryBibleV11AssetType(type))) {
    return err(
      storyBibleCursorError(
        traceId,
        "STORY_BIBLE_LIST_FILTER_INVALID",
        "Story Bible type filters must use supported asset types."
      )
    );
  }
  const statuses = [...new Set(input.statuses ?? [])];
  if (statuses.some((status) => !STORY_BIBLE_STATUSES.has(status))) {
    return err(
      storyBibleCursorError(
        traceId,
        "STORY_BIBLE_LIST_FILTER_INVALID",
        "Story Bible status filters must use supported asset statuses."
      )
    );
  }
  const query = normalizeStoryBibleSearchText(input.query ?? "");
  if ((input.query?.length ?? 0) > 1_024) {
    return err(
      storyBibleCursorError(
        traceId,
        "STORY_BIBLE_LIST_QUERY_INVALID",
        "Story Bible list queries must not exceed 1024 characters."
      )
    );
  }
  if (input.cursor !== undefined && (input.cursor.length === 0 || input.cursor.length > 4_096)) {
    return err(
      storyBibleCursorError(
        traceId,
        "STORY_BIBLE_CURSOR_INVALID",
        "The Story Bible cursor is malformed."
      )
    );
  }
  return ok({
    types: types.sort(compareIds),
    statuses: statuses.sort(compareIds),
    query,
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    limit
  });
}

function storyBibleListKey(asset: StoryBibleV11Asset): StoryBibleListKey {
  return {
    type: asset.type,
    normalizedTitle: normalizeStoryBibleSearchText(asset.title),
    assetId: asset.id
  };
}

function compareStoryBibleListKeys(left: StoryBibleListKey, right: StoryBibleListKey): number {
  return (
    compareIds(left.type, right.type) ||
    compareIds(left.normalizedTitle, right.normalizedTitle) ||
    compareIds(left.assetId, right.assetId)
  );
}

function storyBibleIndexRevision(
  reads: readonly { readonly value: StoryBibleCompatibleAssetRead }[]
): string {
  return checksumStoryBibleText(
    stableJson(
      reads.map(({ value }) => ({
        id: value.asset.id,
        type: value.asset.type,
        title: value.asset.title,
        status: value.asset.status,
        summary: value.asset.summary,
        revision: value.revision,
        checksum: value.checksum
      }))
    )
  );
}

function storyBibleListQuerySignature(input: NormalizedStoryBibleListInput): string {
  return checksumStoryBibleText(
    stableJson({
      types: input.types,
      statuses: input.statuses,
      query: input.query,
      sortVersion: STORY_BIBLE_LIST_SORT_VERSION
    })
  );
}

function storyBibleListMatches(
  asset: StoryBibleV11Asset,
  input: NormalizedStoryBibleListInput
): boolean {
  if (input.types.length > 0 && !input.types.includes(asset.type)) return false;
  if (input.statuses.length > 0 && !input.statuses.includes(asset.status)) return false;
  if (input.query.length === 0) return true;
  const searchableValues = [asset.id, asset.title, asset.summary, ...asset.aliases];
  collectSearchableStoryBibleValues(asset.relations, searchableValues);
  collectSearchableStoryBibleValues(asset.details, searchableValues);
  return normalizeStoryBibleSearchText(searchableValues.join("\n")).includes(input.query);
}

function collectSearchableStoryBibleValues(value: unknown, output: string[]): void {
  if (typeof value === "string") {
    output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectSearchableStoryBibleValues(entry, output);
    return;
  }
  if (isJsonObject(value)) {
    for (const entry of Object.values(value)) collectSearchableStoryBibleValues(entry, output);
  }
}

function normalizeStoryBibleSearchText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/\s+/gu, " ").trim();
}

function createStoryBibleListCursor(
  input: Omit<StoryBibleListCursorPayload, "version" | "sortVersion">
): string {
  const payload: StoryBibleListCursorPayload = {
    version: 1,
    sortVersion: STORY_BIBLE_LIST_SORT_VERSION,
    ...input
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function parseStoryBibleListCursor(
  cursor: string,
  traceId: string
): Result<StoryBibleListCursorPayload, UnifiedError> {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (
      !isJsonObject(parsed) ||
      parsed["version"] !== 1 ||
      parsed["sortVersion"] !== STORY_BIBLE_LIST_SORT_VERSION ||
      typeof parsed["indexRevision"] !== "string" ||
      !/^[a-f0-9]{64}$/u.test(parsed["indexRevision"]) ||
      typeof parsed["querySignature"] !== "string" ||
      !/^[a-f0-9]{64}$/u.test(parsed["querySignature"]) ||
      !isJsonObject(parsed["last"]) ||
      !isStoryBibleV11AssetType(parsed["last"]["type"]) ||
      typeof parsed["last"]["normalizedTitle"] !== "string" ||
      typeof parsed["last"]["assetId"] !== "string"
    ) {
      throw new Error("invalid cursor payload");
    }
    return ok(parsed as unknown as StoryBibleListCursorPayload);
  } catch {
    return err(
      storyBibleCursorError(
        traceId,
        "STORY_BIBLE_CURSOR_INVALID",
        "The Story Bible cursor is malformed."
      )
    );
  }
}

function storyBibleCursorError(traceId: string, code: string, message: string): UnifiedError {
  return validationError({
    code,
    message,
    suggestedAction: "Restart Story Bible pagination from the first page.",
    traceId
  });
}

function replaceStoryBibleProjectAsset(
  assets: readonly StoryBibleV11Asset[],
  candidate: StoryBibleV11Asset
): readonly StoryBibleV11Asset[] {
  return [...assets.filter((asset) => asset.id !== candidate.id), candidate];
}

function storyBibleReferenceTargets(
  assets: readonly StoryBibleV11Asset[],
  additionalKnownAssetIds: readonly string[] = [],
  additionalKnownReferenceTargets: readonly StoryBibleAdditionalReferenceTarget[] = []
): ReadonlyMap<string, StoryBibleReferenceTargetType> {
  const targets = new Map<string, StoryBibleReferenceTargetType>();
  for (const asset of assets) {
    targets.set(asset.id, asset.type);
    if (asset.type !== "timeline.events") continue;
    const events = Array.isArray(asset.details["events"]) ? asset.details["events"] : [];
    for (const event of events) {
      if (isJsonObject(event) && typeof event["eventId"] === "string") {
        targets.set(event["eventId"], "timeline.event");
      }
    }
  }
  for (const assetId of additionalKnownAssetIds) {
    const type = STORY_BIBLE_V11_ASSET_TYPES.find((candidateType) =>
      isStoryBibleAssetIdForType(assetId, candidateType)
    );
    if (type !== undefined) targets.set(assetId, type);
  }
  for (const target of additionalKnownReferenceTargets) {
    const valid =
      target.targetType === "timeline.event"
        ? /^evt_[a-f0-9]{32}$/u.test(target.targetId)
        : isStoryBibleAssetIdForType(target.targetId, target.targetType);
    if (!valid) continue;
    const existing = targets.get(target.targetId);
    if (existing === undefined || existing === target.targetType) {
      targets.set(target.targetId, target.targetType);
    }
  }
  return targets;
}

function invalidStoryBibleReferenceCounts(
  asset: StoryBibleV11Asset,
  targets: ReadonlyMap<string, StoryBibleReferenceTargetType>
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const reference of inspectStoryBibleReferences(asset, targets)) {
    if (reference.integrity === "valid") continue;
    const fingerprint = storyBibleReferenceFingerprint(reference);
    counts.set(fingerprint, (counts.get(fingerprint) ?? 0) + 1);
  }
  return counts;
}

function knownChapterIdsForWrite(
  asset: StoryBibleV11Asset,
  knownChapterIds: readonly string[] | undefined
):
  | { readonly ok: true; readonly value: ReadonlySet<string> | undefined }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] } {
  if (knownChapterIds !== undefined) {
    return { ok: true, value: new Set(knownChapterIds) };
  }
  if (collectStoryBibleDeclaredChapterReferences(asset).length === 0) {
    return { ok: true, value: undefined };
  }
  return {
    ok: false,
    issues: [
      candidateIssue(
        "/details",
        "chapterCatalog",
        "chapter references require an authoritative project chapter catalog"
      )
    ]
  };
}

function invalidStoryBibleChapterReferenceCounts(
  asset: StoryBibleV11Asset,
  knownChapterIds: ReadonlySet<string>
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const reference of inspectStoryBibleChapterReferences(asset, knownChapterIds)) {
    if (reference.integrity === "valid") continue;
    const fingerprint = storyBibleChapterReferenceFingerprint(reference);
    counts.set(fingerprint, (counts.get(fingerprint) ?? 0) + 1);
  }
  return counts;
}

interface ProjectRelationOccurrence {
  readonly relation: StoryBibleRelation;
}

interface ProjectRelationViolation {
  readonly fingerprint: string;
  readonly keyword: "uniqueRelationId" | "explicitInverse" | "inverseConsistency";
  readonly relationIds: readonly string[];
  readonly message: string;
}

function newProjectRelationIssues(
  baselineAssets: readonly StoryBibleV11Asset[],
  candidateAssets: readonly StoryBibleV11Asset[],
  candidate: StoryBibleV11Asset,
  deferProjectRelationPairValidation = false
): readonly ValidationIssue[] {
  const candidateByRelationId = new Map<string, number>();
  for (const [index, relation] of candidate.relations.entries()) {
    candidateByRelationId.set(relation.relationId, index);
  }

  const issues: ValidationIssue[] = [];
  for (const violation of newProjectRelationViolations(baselineAssets, candidateAssets)) {
    if (deferProjectRelationPairValidation && violation.keyword !== "uniqueRelationId") continue;
    const candidateRelationId = violation.relationIds.find((relationId) =>
      candidateByRelationId.has(relationId)
    );
    const candidateIndex =
      candidateRelationId === undefined
        ? undefined
        : candidateByRelationId.get(candidateRelationId);
    issues.push(
      candidateIssue(
        candidateIndex === undefined ? "/relations" : `/relations/${candidateIndex}/relationId`,
        violation.keyword,
        violation.message
      )
    );
  }
  return issues;
}

function newProjectRelationGroupIssues(
  baselineAssets: readonly StoryBibleV11Asset[],
  projectedAssets: readonly StoryBibleV11Asset[],
  candidates: readonly StoryBibleV11Asset[]
): readonly ValidationIssue[] {
  const candidateRelationLocations = new Map<
    string,
    { readonly candidateIndex: number; readonly relationIndex: number }
  >();
  for (const [candidateIndex, candidate] of candidates.entries()) {
    for (const [relationIndex, relation] of candidate.relations.entries()) {
      if (!candidateRelationLocations.has(relation.relationId)) {
        candidateRelationLocations.set(relation.relationId, { candidateIndex, relationIndex });
      }
    }
  }

  return newProjectRelationViolations(baselineAssets, projectedAssets).map((violation) => {
    const location = violation.relationIds
      .map((relationId) => candidateRelationLocations.get(relationId))
      .find((candidateLocation) => candidateLocation !== undefined);
    return candidateIssue(
      location === undefined
        ? "/candidates"
        : `/candidates/${location.candidateIndex}/candidateContent/relations/${location.relationIndex}/relationId`,
      violation.keyword,
      violation.message
    );
  });
}

function newProjectRelationViolations(
  baselineAssets: readonly StoryBibleV11Asset[],
  candidateAssets: readonly StoryBibleV11Asset[]
): readonly ProjectRelationViolation[] {
  const inheritedCounts = countProjectRelationViolations(
    collectProjectRelationViolations(baselineAssets)
  );
  const consumed = new Map<string, number>();
  const violations: ProjectRelationViolation[] = [];
  for (const violation of collectProjectRelationViolations(candidateAssets)) {
    const used = (consumed.get(violation.fingerprint) ?? 0) + 1;
    consumed.set(violation.fingerprint, used);
    if (used > (inheritedCounts.get(violation.fingerprint) ?? 0)) violations.push(violation);
  }
  return violations;
}

function countProjectRelationViolations(
  violations: readonly ProjectRelationViolation[]
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const violation of violations) {
    counts.set(violation.fingerprint, (counts.get(violation.fingerprint) ?? 0) + 1);
  }
  return counts;
}

function collectProjectRelationViolations(
  assets: readonly StoryBibleV11Asset[]
): readonly ProjectRelationViolation[] {
  const relationIndex = new Map<string, ProjectRelationOccurrence[]>();
  for (const asset of assets) {
    for (const relation of asset.relations) {
      const occurrences = relationIndex.get(relation.relationId) ?? [];
      occurrences.push({ relation });
      relationIndex.set(relation.relationId, occurrences);
    }
  }

  const violations: ProjectRelationViolation[] = [];
  for (const [relationId, occurrences] of relationIndex) {
    const duplicateFingerprint = `duplicate:${relationId}:${occurrences
      .map(({ relation }) => relationIntegritySignature(relation))
      .sort(compareIds)
      .join(":")}`;
    for (let duplicateIndex = 1; duplicateIndex < occurrences.length; duplicateIndex += 1) {
      violations.push({
        fingerprint: duplicateFingerprint,
        keyword: "uniqueRelationId",
        relationIds: [relationId],
        message: "relationId must be unique within the project"
      });
    }
  }

  const inspectedPairs = new Set<string>();
  for (const occurrences of relationIndex.values()) {
    for (const occurrence of occurrences) {
      const relation = occurrence.relation;
      if (relation.inversePolicy !== "explicit" || relation.inverseRelationId === null) continue;
      const inverseOccurrences = relationIndex.get(relation.inverseRelationId) ?? [];
      const pairKey = [relation.relationId, relation.inverseRelationId].sort(compareIds).join(":");
      if (inspectedPairs.has(pairKey)) continue;
      inspectedPairs.add(pairKey);
      if (inverseOccurrences.length !== 1) {
        violations.push({
          fingerprint: `explicit-inverse:${pairKey}:${relationIntegritySignature(relation)}:${inverseOccurrences.length === 0 ? "missing" : "ambiguous"}`,
          keyword: "explicitInverse",
          relationIds: [relation.relationId, relation.inverseRelationId],
          message:
            inverseOccurrences.length === 0
              ? "explicit inverseRelationId must reference an existing relation"
              : "explicit inverseRelationId must identify exactly one project relation"
        });
        continue;
      }
      const inverse = inverseOccurrences[0]?.relation;
      if (inverse === undefined) continue;
      if (
        inverse.direction !== "directed" ||
        inverse.inversePolicy !== "explicit" ||
        inverse.inverseRelationId !== relation.relationId ||
        inverse.sourceId !== relation.targetId ||
        inverse.targetId !== relation.sourceId
      ) {
        violations.push({
          fingerprint: `explicit-inverse:${pairKey}:reciprocal:${relationPairIntegritySignature(relation, inverse)}`,
          keyword: "explicitInverse",
          relationIds: [relation.relationId, relation.inverseRelationId],
          message:
            "explicit inverse relations must be directed, reciprocal, and use reversed endpoints"
        });
        continue;
      }
      if (
        inverse.status !== relation.status ||
        inverse.validFromChapterId !== relation.validFromChapterId ||
        inverse.validToChapterId !== relation.validToChapterId
      ) {
        violations.push({
          fingerprint: `explicit-inverse:${pairKey}:consistency:${relationPairIntegritySignature(relation, inverse)}`,
          keyword: "inverseConsistency",
          relationIds: [relation.relationId, relation.inverseRelationId],
          message: "explicit inverse relations must use the same status and chapter validity range"
        });
      }
    }
  }
  return violations;
}

function relationIntegritySignature(relation: StoryBibleRelation): string {
  return JSON.stringify([
    relation.relationId,
    relation.sourceId,
    relation.targetId,
    relation.relationType,
    relation.direction,
    relation.status,
    relation.validFromChapterId,
    relation.validToChapterId,
    relation.inversePolicy,
    relation.inverseRelationId
  ]);
}

function relationPairIntegritySignature(
  first: StoryBibleRelation,
  second: StoryBibleRelation
): string {
  return [relationIntegritySignature(first), relationIntegritySignature(second)]
    .sort(compareIds)
    .join(":");
}

function projectRelationWarnings(
  assets: readonly StoryBibleV11Asset[]
): ReadonlyMap<string, readonly StoryBibleReferenceWarning[]> {
  const warnings = new Map<string, StoryBibleReferenceWarning[]>();
  for (const violation of collectProjectRelationViolations(assets)) {
    const code: StoryBibleReferenceWarning["code"] =
      violation.keyword === "uniqueRelationId"
        ? "duplicate-relation-id"
        : violation.keyword === "inverseConsistency"
          ? "explicit-inverse-inconsistent"
          : "explicit-inverse-invalid";
    for (const relationId of violation.relationIds) {
      const current = warnings.get(relationId) ?? [];
      if (
        !current.some((warning) => warning.code === code && warning.message === violation.message)
      ) {
        current.push({ code, message: violation.message });
      }
      warnings.set(relationId, current);
    }
  }
  return warnings;
}

function targetIntegrityWarnings(
  integrity: StoryBibleReference["integrity"]
): readonly StoryBibleReferenceWarning[] {
  switch (integrity) {
    case "deleted":
      return [{ code: "target-deleted", message: "reference target is soft-deleted" }];
    case "missing":
      return [{ code: "target-missing", message: "reference target does not exist" }];
    case "type-mismatch":
      return [{ code: "target-type-mismatch", message: "reference target has an unexpected type" }];
    case "valid":
      return [];
  }
}

function collectStoryBibleReferences(
  reads: readonly { readonly value: StoryBibleCompatibleAssetRead }[],
  knownChapterIds?: ReadonlySet<string>
): StoryBibleReference[] {
  const assets = new Map(reads.map(({ value }) => [value.asset.id, value.asset]));
  const knownReferenceTargets = storyBibleReferenceTargets([...assets.values()]);
  const relationWarnings = projectRelationWarnings([...assets.values()]);
  const references: StoryBibleReference[] = [];
  const seen = new Set<string>();
  for (const { value } of reads) {
    const source = value.asset;
    for (const inspected of inspectStoryBibleReferences(source, knownReferenceTargets)) {
      const target = assets.get(inspected.targetId);
      const integrity =
        inspected.integrity === "valid" && target?.status === "deleted"
          ? "deleted"
          : inspected.integrity;
      pushStoryBibleReference(references, seen, source, target, {
        targetAssetId: inspected.targetId,
        kind: inspected.relationId === undefined ? "detail" : "relation",
        path: inspected.path,
        expectedTargetTypes: inspected.expectedTargetTypes,
        integrity,
        warnings: [
          ...targetIntegrityWarnings(integrity),
          ...(inspected.relationId === undefined
            ? []
            : (relationWarnings.get(inspected.relationId) ?? []))
        ],
        ...(inspected.actualTargetType === undefined
          ? {}
          : { targetReferenceType: inspected.actualTargetType }),
        ...(inspected.relationId === undefined ? {} : { relationId: inspected.relationId }),
        ...(inspected.relationType === undefined ? {} : { relationType: inspected.relationType })
      });
    }
    if (knownChapterIds === undefined) continue;
    for (const inspected of inspectStoryBibleChapterReferences(source, knownChapterIds)) {
      const integrity = inspected.integrity === "valid" ? "valid" : "missing";
      pushStoryBibleReference(references, seen, source, undefined, {
        targetAssetId: inspected.chapterId,
        kind: inspected.relationId === undefined ? "detail" : "relation",
        path: inspected.path,
        expectedTargetTypes: ["chapter"],
        integrity,
        warnings:
          integrity === "valid"
            ? []
            : [{ code: "chapter-missing", message: "referenced project chapter does not exist" }],
        ...(integrity === "valid" ? { targetReferenceType: "chapter" } : {}),
        ...(inspected.relationId === undefined ? {} : { relationId: inspected.relationId })
      });
    }
  }
  return references;
}

function pushStoryBibleReference(
  output: StoryBibleReference[],
  seen: Set<string>,
  source: StoryBibleV11Asset,
  target: StoryBibleV11Asset | undefined,
  detail: Pick<
    StoryBibleReference,
    "targetAssetId" | "kind" | "path" | "expectedTargetTypes" | "integrity" | "warnings"
  > &
    Partial<Pick<StoryBibleReference, "relationId" | "relationType">> &
    Partial<Pick<StoryBibleReference, "targetReferenceType">>
): void {
  const key = `${source.id}\0${detail.targetAssetId}\0${detail.kind}\0${detail.path}`;
  if (seen.has(key)) return;
  seen.add(key);
  output.push({
    sourceAssetId: source.id,
    sourceType: source.type,
    sourceTitle: source.title,
    sourceStatus: source.status,
    sourceRevision: source.revision,
    targetAssetId: detail.targetAssetId,
    ...(target === undefined
      ? {}
      : {
          targetType: target.type,
          targetTitle: target.title,
          targetStatus: target.status
        }),
    ...(detail.targetReferenceType === undefined
      ? {}
      : { targetReferenceType: detail.targetReferenceType }),
    expectedTargetTypes: [...detail.expectedTargetTypes],
    integrity: detail.integrity,
    warnings: detail.warnings.map((warning) => ({ ...warning })),
    kind: detail.kind,
    path: detail.path,
    ...(detail.relationId === undefined ? {} : { relationId: detail.relationId }),
    ...(detail.relationType === undefined ? {} : { relationType: detail.relationType })
  });
}

function compareStoryBibleReferences(
  left: StoryBibleReference,
  right: StoryBibleReference
): number {
  return (
    compareIds(left.sourceAssetId, right.sourceAssetId) ||
    compareIds(left.targetAssetId, right.targetAssetId) ||
    compareIds(left.kind, right.kind) ||
    compareIds(left.path, right.path)
  );
}

function checksumStoryBibleDeletionImpact(input: {
  readonly assetId: string;
  readonly canSetDeleted: boolean;
  readonly incoming: readonly StoryBibleReference[];
  readonly deletionImpact: StoryBibleReferenceImpact["deletionImpact"];
}): string {
  return checksumStoryBibleText(
    JSON.stringify({
      assetId: input.assetId,
      canSetDeleted: input.canSetDeleted,
      affectedReferenceCount: input.deletionImpact.affectedReferenceCount,
      affectedAssetIds: input.deletionImpact.affectedAssetIds,
      cascades: input.deletionImpact.cascades,
      incoming: input.incoming
    })
  );
}

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

function candidateIssue(
  instancePath: string,
  keyword: string,
  message: string
): StoryBibleValidationIssue {
  return {
    instancePath,
    schemaPath: `#/storyBibleCandidate/${keyword}`,
    keyword,
    message
  };
}

function prefixCandidateGroupIssues(
  candidateIndex: number,
  issues: readonly ValidationIssue[]
): readonly ValidationIssue[] {
  return issues.map((issue) => ({
    ...issue,
    instancePath: `/candidates/${candidateIndex}/candidateContent${issue.instancePath}`
  }));
}

function storyBibleCandidateValidationError(
  traceId: string,
  issues: readonly ValidationIssue[]
): UnifiedError {
  return validationError({
    code: "STORY_BIBLE_CANDIDATE_INVALID",
    message: "Story Bible candidate failed strict validation.",
    suggestedAction: "Refresh the asset, fix the reported fields, and retry.",
    traceId,
    redactedDetail: {
      issues: issues.map((issue) => ({
        instancePath: issue.instancePath,
        schemaPath: issue.schemaPath,
        keyword: issue.keyword,
        message: issue.message
      }))
    }
  });
}

function storyBibleConflictError(
  traceId: string,
  code: string,
  assetId: string,
  currentRevision?: number,
  currentChecksum?: string
): UnifiedError {
  return validationError({
    code,
    message: "The Story Bible asset changed after the candidate was prepared.",
    suggestedAction: "Refresh the asset and prepare the change again.",
    traceId,
    redactedDetail: {
      assetId,
      ...(currentRevision === undefined ? {} : { currentRevision }),
      ...(currentChecksum === undefined ? {} : { currentChecksum })
    }
  });
}

function storyBibleStatusTransitionCommandRequired(traceId: string, assetId: string): UnifiedError {
  return validationError({
    code: "STORY_BIBLE_STATUS_TRANSITION_COMMAND_REQUIRED",
    message: "Moving a Story Bible asset into or out of deleted requires a dedicated command.",
    suggestedAction: "Use the Story Bible delete or restore command.",
    traceId,
    redactedDetail: { assetId }
  });
}

function storyBibleStatusTransitionInvalid(traceId: string, assetId: string): UnifiedError {
  return validationError({
    code: "STORY_BIBLE_STATUS_TRANSITION_INVALID",
    message: "The Story Bible status transition does not match the dedicated command.",
    suggestedAction: "Refresh the asset and prepare the status command again.",
    traceId,
    redactedDetail: { assetId }
  });
}

function storyBibleDeletionImpactChanged(traceId: string, assetId: string): UnifiedError {
  return validationError({
    code: "STORY_BIBLE_DELETION_IMPACT_CHANGED",
    message: "Story Bible references changed after deletion was confirmed.",
    suggestedAction: "Review the current reference impact and confirm deletion again.",
    traceId,
    redactedDetail: { assetId }
  });
}

function storyBibleSingletonDeleteForbidden(traceId: string, assetId: string): UnifiedError {
  return validationError({
    code: "STORY_BIBLE_SINGLETON_DELETE_FORBIDDEN",
    message: "Outline and timeline Story Bible singletons cannot be moved to deleted.",
    suggestedAction: "Archive the singleton or edit its managed entries instead.",
    traceId,
    redactedDetail: { assetId }
  });
}

function storyBibleMigrationCleanupError(
  traceId: string,
  assetId: string,
  canonicalRolledBack = false
): UnifiedError {
  return storageError({
    code: "STORY_BIBLE_LEGACY_MIGRATION_FAILED",
    message: "The legacy Story Bible asset could not be migrated safely.",
    suggestedAction: "Retry the save after checking project file permissions.",
    traceId,
    redactedDetail: { assetId, canonicalRolledBack }
  });
}

function storyBibleNotFoundError(traceId: string, assetId: string): UnifiedError {
  return validationError({
    code: "STORY_BIBLE_ASSET_NOT_FOUND",
    message: "The Story Bible asset does not exist.",
    suggestedAction: "Refresh the Story Bible and choose an existing asset.",
    traceId,
    redactedDetail: { assetId }
  });
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeStoryBibleDefaults(defaults: JsonObject, value: JsonObject | undefined): JsonObject {
  if (value === undefined) return defaults;
  const merged: JsonObject = { ...defaults };
  for (const [key, next] of Object.entries(value)) {
    const current = merged[key];
    merged[key] =
      isJsonObject(current) && isJsonObject(next) ? mergeStoryBibleDefaults(current, next) : next;
  }
  return merged;
}

function reconcileStoryBibleEntryRevisions(
  type: StoryBibleV11AssetType,
  current: JsonObject,
  candidate: JsonObject,
  initialize: boolean
): JsonObject {
  const next: JsonObject = { ...candidate };
  switch (type) {
    case "character":
      next["knowledgeStates"] = reconcileStableEntryArray(
        current["knowledgeStates"],
        candidate["knowledgeStates"],
        "knowledgeStateId",
        initialize
      );
      next["stateHistory"] = reconcileStableEntryArray(
        current["stateHistory"],
        candidate["stateHistory"],
        "stateHistoryId",
        initialize
      );
      break;
    case "world.item":
      next["stateHistory"] = reconcileStableEntryArray(
        current["stateHistory"],
        candidate["stateHistory"],
        "stateHistoryId",
        initialize
      );
      break;
    case "outline":
      next["volumes"] = reconcileStableEntryArray(
        current["volumes"],
        candidate["volumes"],
        "volumeId",
        initialize
      );
      next["chapterOutlines"] = reconcileStableEntryArray(
        current["chapterOutlines"],
        candidate["chapterOutlines"],
        "chapterOutlineId",
        initialize,
        ["beats"],
        (entry, currentEntry) => ({
          ...entry,
          beats: reconcileStableEntryArray(
            currentEntry?.["beats"],
            entry["beats"],
            "beatId",
            initialize
          )
        })
      );
      break;
    case "foreshadow":
      next["milestones"] = reconcileStableEntryArray(
        current["milestones"],
        candidate["milestones"],
        "milestoneId",
        initialize
      );
      break;
    case "timeline.events":
      next["events"] = reconcileStableEntryArray(
        current["events"],
        candidate["events"],
        "eventId",
        initialize
      );
      break;
    case "world.location":
    case "world.faction":
    case "world.rule":
    case "world.glossary":
    case "world.lore":
      break;
  }
  return next;
}

function reconcileStableEntryArray(
  currentValue: JsonValue | undefined,
  candidateValue: JsonValue | undefined,
  idKey: string,
  initialize: boolean,
  ignoredComparisonKeys: readonly string[] = [],
  prepareEntry: (entry: JsonObject, currentEntry: JsonObject | undefined) => JsonObject = (entry) =>
    entry
): JsonValue {
  if (!Array.isArray(candidateValue)) return candidateValue ?? [];
  const currentEntries = Array.isArray(currentValue) ? currentValue.filter(isJsonObject) : [];
  const currentById = new Map(
    currentEntries.flatMap((entry) =>
      typeof entry[idKey] === "string" ? [[entry[idKey] as string, entry] as const] : []
    )
  );
  return candidateValue.map((value) => {
    if (!isJsonObject(value)) return value;
    const entryId = value[idKey];
    const currentEntry = typeof entryId === "string" ? currentById.get(entryId) : undefined;
    const prepared = prepareEntry(value, currentEntry);
    const currentRevision = currentEntry?.["entryRevision"];
    const entryRevision =
      initialize || currentEntry === undefined || !Number.isSafeInteger(currentRevision)
        ? 1
        : stableEntryPayload(currentEntry, ignoredComparisonKeys) ===
            stableEntryPayload(prepared, ignoredComparisonKeys)
          ? Number(currentRevision)
          : Number(currentRevision) + 1;
    return { ...prepared, entryRevision };
  });
}

function stableEntryPayload(entry: JsonObject, ignoredKeys: readonly string[]): string {
  const ignored = new Set(["entryRevision", ...ignoredKeys]);
  return stableJson(Object.fromEntries(Object.entries(entry).filter(([key]) => !ignored.has(key))));
}

function writableExtensionNamespaces(
  registered: ReadonlySet<string>,
  current: JsonObject,
  candidate: JsonObject
): ReadonlySet<string> {
  const allowed = new Set(registered);
  for (const [namespace, value] of Object.entries(candidate)) {
    if (
      Object.prototype.hasOwnProperty.call(current, namespace) &&
      stableJson(value) === stableJson(current[namespace])
    ) {
      allowed.add(namespace);
    }
  }
  return allowed;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isJsonObject(value)) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => (left === right ? 0 : left < right ? -1 : 1))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
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

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "ENOENT"
  );
}
