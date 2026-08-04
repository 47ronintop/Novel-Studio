import type { ContextCandidate } from "@novel-studio/context-engine";
import {
  collectStoryBibleDeclaredChapterReferences,
  isStoryBibleV11AssetType,
  validateStoryBibleCreateValue,
  type StoryBibleReferenceTargetType,
  type StoryBibleV11AssetType,
  type ValidationIssue
} from "@novel-studio/schemas";
import {
  FORESHADOW_PAID_OFF_ACTUAL_CHAPTER_MISSING,
  collectForeshadowContractWarnings,
  createUnifiedError,
  err,
  type ChapterCatalogRepositoryPort,
  type ForeshadowDetails,
  type JsonObject,
  type Result,
  type UnifiedError
} from "@novel-studio/shared";

import { validateStoryBibleCandidate } from "./story-bible-candidate.js";

export type StoryBibleAssetType =
  | "character"
  | "world.location"
  | "world.faction"
  | "world.rule"
  | "world.glossary"
  | "world.item"
  | "world.lore"
  | "outline"
  | "timeline.events"
  | "foreshadow";
export type StoryBibleRegularAssetType = Exclude<StoryBibleAssetType, "foreshadow">;
export type StoryBibleEntityStatus = "active" | "draft" | "archived" | "deleted";
export type MemoryRecordType = "memory.long-term" | "memory.style" | "memory.summary";
export type MemoryOrigin = "user" | "user-confirmed-ai" | "ai-unconfirmed";
export type MemoryConfidence = "confirmed" | "needs-review" | "deprecated";
export type StoryBibleContextCandidate = ContextCandidate;

export interface StoryBibleRelation extends JsonObject {
  readonly relationId: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly relationType: string;
  readonly direction: "directed" | "symmetric";
  readonly status: "active" | "ended" | "uncertain";
  readonly validFromChapterId: string | null;
  readonly validToChapterId: string | null;
  readonly inversePolicy: "derived" | "explicit" | "none";
  readonly inverseRelationId: string | null;
  readonly evidence: JsonObject[];
  readonly note: string;
}

export interface StoryBibleWriteCandidate extends JsonObject {
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
}

export interface StoryBibleCreateValue extends JsonObject {
  readonly title: string;
  readonly status?: Exclude<StoryBibleEntityStatus, "deleted">;
  readonly summary?: string;
  readonly aliases?: string[];
  readonly relations?: StoryBibleRelation[];
  readonly details?: JsonObject;
  readonly extensions?: JsonObject;
}

export interface StoryBibleEditableAsset {
  readonly asset: StoryBibleAsset;
  readonly persistedSchemaVersion: "1.0" | "1.1";
  readonly checksum: string;
  readonly revision: number;
  readonly passthroughPresent: boolean;
  readonly passthroughFieldCount: number;
}

export interface CreateStoryBibleAssetCommand {
  readonly type: StoryBibleV11AssetType;
  readonly value: StoryBibleCreateValue;
}

export interface SaveStoryBibleAssetCandidateCommand {
  readonly candidate: StoryBibleWriteCandidate;
  readonly baseRevision: number;
  readonly baseChecksum?: string;
}

export type SaveStoryBibleStatusTransitionCommand =
  | (SaveStoryBibleAssetCandidateCommand & {
      readonly action: "move-to-deleted";
      readonly expectedDeletionImpactChecksum: string;
    })
  | (SaveStoryBibleAssetCandidateCommand & {
      readonly action: "restore";
    });

export interface StoryBibleReferenceImpactItem {
  readonly sourceAssetId: string;
  readonly sourceType: StoryBibleV11AssetType;
  readonly sourceTitle: string;
  readonly sourceStatus: StoryBibleEntityStatus;
  readonly sourceRevision: number;
  readonly targetAssetId: string;
  readonly targetType?: StoryBibleV11AssetType;
  readonly targetTitle?: string;
  readonly targetStatus?: StoryBibleEntityStatus;
  readonly targetReferenceType?: StoryBibleReferenceTargetType | "chapter";
  readonly expectedTargetTypes: readonly (StoryBibleReferenceTargetType | "chapter")[];
  readonly integrity: "valid" | "deleted" | "missing" | "type-mismatch";
  readonly warnings: readonly {
    readonly code:
      | "target-deleted"
      | "target-missing"
      | "target-type-mismatch"
      | "chapter-missing"
      | "duplicate-relation-id"
      | "explicit-inverse-invalid"
      | "explicit-inverse-inconsistent";
    readonly message: string;
  }[];
  readonly kind: "detail" | "relation";
  readonly path: string;
  readonly relationId?: string;
  readonly relationType?: string;
}

export interface StoryBibleReferenceImpact {
  readonly assetId: string;
  readonly deletionImpactChecksum: string;
  readonly incoming: readonly StoryBibleReferenceImpactItem[];
  readonly outgoing: readonly StoryBibleReferenceImpactItem[];
  readonly canSetDeleted: boolean;
  readonly deletionImpact: {
    readonly affectedReferenceCount: number;
    readonly affectedAssetIds: readonly string[];
    readonly cascades: false;
  };
}

export type StoryBibleRestorableStatus = Exclude<StoryBibleEntityStatus, "deleted">;

interface CreateStoryBibleAssetRepositoryInput extends CreateStoryBibleAssetCommand {
  readonly knownChapterIds?: readonly string[];
}

interface SaveStoryBibleAssetCandidateRepositoryInput extends SaveStoryBibleAssetCandidateCommand {
  readonly knownChapterIds?: readonly string[];
}

interface SaveStoryBibleStatusTransitionRepositoryInput extends SaveStoryBibleAssetCandidateRepositoryInput {
  readonly statusTransition:
    | {
        readonly action: "move-to-deleted";
        readonly expectedDeletionImpactChecksum: string;
      }
    | {
        readonly action: "restore";
        readonly restoreStatus: StoryBibleRestorableStatus;
      };
}

interface StoryBibleAssetBase extends JsonObject {
  readonly schemaVersion: "1.0" | "1.1";
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
  readonly timeline?: StoryBibleRegularAsset;
  readonly foreshadows: readonly ForeshadowAsset[];
  readonly memories: readonly MemoryRecord[];
}

export type StoryBibleConsistencyStatus = "healthy" | "attention";
export type StoryBibleConsistencySeverity = "warning";
export type StoryBibleConsistencyRefKind =
  "character" | "world" | "outline" | "timeline" | "foreshadow" | "chapter" | "memory";

export interface StoryBibleConsistencyRef extends JsonObject {
  readonly kind: StoryBibleConsistencyRefKind;
  readonly id: string;
  readonly title: string;
}

export interface StoryBibleConsistencyIssue extends JsonObject {
  readonly id: string;
  readonly code?: string;
  readonly severity: StoryBibleConsistencySeverity;
  readonly title: string;
  readonly message: string;
  readonly sourceRef: StoryBibleConsistencyRef;
  readonly targetRef: StoryBibleConsistencyRef;
  readonly suggestedAction: string;
}

export interface StoryBibleConsistencyReport {
  readonly status: StoryBibleConsistencyStatus;
  readonly checkedAt: string;
  readonly issues: readonly StoryBibleConsistencyIssue[];
}

export interface StoryBibleRepositoryPort {
  readStoryBible(): Promise<Result<StoryBibleSnapshot, UnifiedError>>;
  saveStoryAsset(asset: StoryBibleAsset): Promise<Result<StoryBibleAsset, UnifiedError>>;
  readCompatibleStoryAsset?(
    assetId: string
  ): Promise<Result<StoryBibleEditableAsset, UnifiedError>>;
  createStoryAsset?(
    input: CreateStoryBibleAssetRepositoryInput
  ): Promise<Result<StoryBibleAsset, UnifiedError>>;
  saveStoryAssetCandidate?(
    input: SaveStoryBibleAssetCandidateRepositoryInput
  ): Promise<Result<StoryBibleAsset, UnifiedError>>;
  saveStoryAssetStatusTransition?(
    input: SaveStoryBibleStatusTransitionRepositoryInput
  ): Promise<Result<StoryBibleAsset, UnifiedError>>;
  getStoryBibleReferences?(
    assetId: string,
    knownChapterIds?: readonly string[]
  ): Promise<Result<StoryBibleReferenceImpact, UnifiedError>>;
  saveMemory(memory: MemoryRecord): Promise<Result<MemoryRecord, UnifiedError>>;
}

export interface StoryBibleSessionOptions {
  readonly repository?: StoryBibleRepositoryPort;
  readonly chapterCatalog?: Pick<ChapterCatalogRepositoryPort, "listChapters">;
  readonly resolveRestoreStatus?: (
    assetId: string,
    currentRevision: number,
    currentChecksum: string
  ) => Promise<Result<StoryBibleRestorableStatus, UnifiedError>>;
}

export interface StoryBibleContextCandidateOptions {
  readonly includeStatuses?: readonly StoryBibleEntityStatus[];
}

export interface StoryBibleMentionScanInput {
  readonly snapshot: StoryBibleSnapshot;
  readonly userRequest: string;
  readonly currentChapterBody?: string;
}

export interface StoryBibleMentionSuggestion {
  readonly kind: "story_bible";
  readonly refId: string;
  readonly assetId: string;
  readonly label: string;
}

export interface StoryBibleSession {
  getSnapshot(): StoryBibleSnapshot | undefined;
  clearSnapshot?(): void;
  loadStoryBible(): Promise<Result<StoryBibleSnapshot, UnifiedError>>;
  saveStoryAsset(asset: StoryBibleAsset): Promise<Result<StoryBibleAsset, UnifiedError>>;
  readStoryAssetForEditing?(
    assetId: string
  ): Promise<Result<StoryBibleEditableAsset, UnifiedError>>;
  createStoryAsset?(
    input: CreateStoryBibleAssetCommand
  ): Promise<Result<StoryBibleAsset, UnifiedError>>;
  saveStoryAssetCandidate?(
    input: SaveStoryBibleAssetCandidateCommand
  ): Promise<Result<StoryBibleAsset, UnifiedError>>;
  saveStoryAssetStatusTransition?(
    input: SaveStoryBibleStatusTransitionCommand
  ): Promise<Result<StoryBibleAsset, UnifiedError>>;
  getStoryAssetReferences?(
    assetId: string
  ): Promise<Result<StoryBibleReferenceImpact, UnifiedError>>;
  resolveStoryAssetRestoreStatus?(
    assetId: string
  ): Promise<Result<StoryBibleRestorableStatus, UnifiedError>>;
  saveMemory(memory: MemoryRecord): Promise<Result<MemoryRecord, UnifiedError>>;
  buildConsistencyReport(): Promise<Result<StoryBibleConsistencyReport, UnifiedError>>;
  buildContextCandidates(
    options?: StoryBibleContextCandidateOptions
  ): Promise<Result<readonly StoryBibleContextCandidate[], UnifiedError>>;
}

export function createStoryBibleSession(options: StoryBibleSessionOptions = {}): StoryBibleSession {
  let snapshot: StoryBibleSnapshot | undefined;

  return {
    getSnapshot: () => snapshot,
    clearSnapshot() {
      snapshot = undefined;
    },
    async loadStoryBible() {
      if (options.repository === undefined) {
        return storyBibleUnavailable();
      }

      const loaded = await options.repository.readStoryBible();
      if (loaded.ok) {
        snapshot = loaded.value;
      }

      return loaded;
    },
    async saveStoryAsset(asset) {
      if (options.repository === undefined) {
        return storyBibleUnavailable();
      }

      if (options.repository.readCompatibleStoryAsset !== undefined) {
        const current = await options.repository.readCompatibleStoryAsset(asset.id);
        if (current.ok) {
          const transition = validateDeletedStatusBoundary(
            current.value.asset.status,
            asset.status
          );
          if (!transition.ok) return err(transition.error);
        } else if (current.error.code !== "STORY_BIBLE_ASSET_NOT_FOUND") {
          return current;
        } else if (asset.status === "deleted") {
          const transition = validateDeletedStatusBoundary("active", "deleted");
          if (!transition.ok) return err(transition.error);
        }
      }

      const saved = await options.repository.saveStoryAsset(asset);
      if (saved.ok) {
        const loaded = await options.repository.readStoryBible();
        if (loaded.ok) {
          snapshot = loaded.value;
        }
      }

      return saved;
    },
    async readStoryAssetForEditing(assetId) {
      if (options.repository?.readCompatibleStoryAsset === undefined) {
        return storyBibleUnavailable();
      }
      return options.repository.readCompatibleStoryAsset(assetId);
    },
    async createStoryAsset(input) {
      if (options.repository?.createStoryAsset === undefined) {
        return storyBibleUnavailable();
      }
      if (!isStoryBibleV11AssetType(input.type)) {
        return storyBibleCandidateInvalid([
          {
            instancePath: "/type",
            schemaPath: "#/properties/type",
            keyword: "enum",
            message: "must be a supported Story Bible type"
          }
        ]);
      }
      const validation = validateStoryBibleCreateValue(input.type, input.value);
      if (!validation.valid) return storyBibleCandidateInvalid(validation.issues);
      const knownChapterIds = await readKnownChapterIds();
      if (!knownChapterIds.ok) return knownChapterIds;
      const saved = await options.repository.createStoryAsset({
        ...input,
        ...(knownChapterIds.value === undefined ? {} : { knownChapterIds: knownChapterIds.value })
      });
      if (saved.ok) await refreshSnapshot();
      return saved;
    },
    async saveStoryAssetCandidate(input) {
      if (options.repository?.saveStoryAssetCandidate === undefined) {
        return storyBibleUnavailable();
      }
      let allowLegacyId = input.baseRevision === 0;
      if (options.repository.readCompatibleStoryAsset !== undefined) {
        const current = await options.repository.readCompatibleStoryAsset(input.candidate.id);
        if (!current.ok) return current;
        const transition = validateDeletedStatusBoundary(
          current.value.asset.status,
          input.candidate.status
        );
        if (!transition.ok) return err(transition.error);
        allowLegacyId =
          current.value.persistedSchemaVersion === "1.0" ||
          current.value.asset.passthrough?.["sourceSchemaVersion"] === "1.0";
      }
      const knownAssetIds = snapshot === undefined ? undefined : storyBibleAssetIds(snapshot);
      const validation = validateStoryBibleCandidate(input.candidate, {
        assetType: input.candidate.type,
        ...(knownAssetIds === undefined ? {} : { knownAssetIds }),
        ...(allowLegacyId ? { allowLegacyId: true } : {})
      });
      if (!validation.valid) return storyBibleCandidateInvalid(validation.issues);
      const knownChapterIds = await readKnownChapterIds();
      if (!knownChapterIds.ok) return knownChapterIds;
      const saved = await options.repository.saveStoryAssetCandidate({
        ...input,
        ...(knownChapterIds.value === undefined ? {} : { knownChapterIds: knownChapterIds.value })
      });
      if (saved.ok) await refreshSnapshot();
      return saved;
    },
    async saveStoryAssetStatusTransition(input) {
      if (
        options.repository?.readCompatibleStoryAsset === undefined ||
        options.repository.saveStoryAssetStatusTransition === undefined
      ) {
        return storyBibleUnavailable();
      }
      const current = await options.repository.readCompatibleStoryAsset(input.candidate.id);
      if (!current.ok) return current;
      let statusTransition: SaveStoryBibleStatusTransitionRepositoryInput["statusTransition"];
      if (input.action === "move-to-deleted") {
        if (
          current.value.asset.status === "deleted" ||
          input.candidate.status !== "deleted" ||
          !/^[a-f0-9]{64}$/u.test(input.expectedDeletionImpactChecksum)
        ) {
          return storyBibleStatusTransitionInvalid();
        }
        statusTransition = {
          action: "move-to-deleted",
          expectedDeletionImpactChecksum: input.expectedDeletionImpactChecksum
        };
      } else {
        if (
          current.value.asset.status !== "deleted" ||
          options.resolveRestoreStatus === undefined
        ) {
          return storyBibleStatusTransitionInvalid();
        }
        const restoreStatus = await options.resolveRestoreStatus(
          input.candidate.id,
          current.value.revision,
          current.value.checksum
        );
        if (!restoreStatus.ok) return restoreStatus;
        if (input.candidate.status !== restoreStatus.value) {
          return storyBibleStatusTransitionInvalid();
        }
        statusTransition = { action: "restore", restoreStatus: restoreStatus.value };
      }
      const allowLegacyId =
        current.value.persistedSchemaVersion === "1.0" ||
        current.value.asset.passthrough?.["sourceSchemaVersion"] === "1.0";
      const knownAssetIds = snapshot === undefined ? undefined : storyBibleAssetIds(snapshot);
      const validation = validateStoryBibleCandidate(input.candidate, {
        assetType: input.candidate.type,
        ...(knownAssetIds === undefined ? {} : { knownAssetIds }),
        ...(allowLegacyId ? { allowLegacyId: true } : {})
      });
      if (!validation.valid) return storyBibleCandidateInvalid(validation.issues);
      const knownChapterIds = await readKnownChapterIds();
      if (!knownChapterIds.ok) return knownChapterIds;
      const saved = await options.repository.saveStoryAssetStatusTransition({
        candidate: input.candidate,
        baseRevision: input.baseRevision,
        ...(input.baseChecksum === undefined ? {} : { baseChecksum: input.baseChecksum }),
        statusTransition,
        ...(knownChapterIds.value === undefined ? {} : { knownChapterIds: knownChapterIds.value })
      });
      if (saved.ok) await refreshSnapshot();
      return saved;
    },
    async getStoryAssetReferences(assetId) {
      if (options.repository?.getStoryBibleReferences === undefined) {
        return storyBibleUnavailable();
      }
      const knownChapterIds = await readKnownChapterIds();
      if (!knownChapterIds.ok) return knownChapterIds;
      return options.repository.getStoryBibleReferences(assetId, knownChapterIds.value);
    },
    async resolveStoryAssetRestoreStatus(assetId) {
      if (
        options.repository?.readCompatibleStoryAsset === undefined ||
        options.resolveRestoreStatus === undefined
      ) {
        return storyBibleUnavailable();
      }
      const current = await options.repository.readCompatibleStoryAsset(assetId);
      if (!current.ok) return current;
      if (current.value.asset.status !== "deleted") {
        return err(
          createUnifiedError({
            code: "STORY_BIBLE_RESTORE_NOT_DELETED",
            category: "ValidationError",
            message: "Only a deleted Story Bible asset can be restored.",
            recoverability: "user-action",
            suggestedAction: "Reload the Story Bible entry before retrying restore.",
            traceId: "application-story-bible-restore"
          })
        );
      }
      return options.resolveRestoreStatus(assetId, current.value.revision, current.value.checksum);
    },
    async saveMemory(memory) {
      if (options.repository === undefined) {
        return storyBibleUnavailable();
      }

      const saved = await options.repository.saveMemory(memory);
      if (saved.ok) {
        const loaded = await options.repository.readStoryBible();
        if (loaded.ok) {
          snapshot = loaded.value;
        }
      }

      return saved;
    },
    async buildConsistencyReport() {
      if (options.repository === undefined) {
        return storyBibleUnavailable();
      }

      const snapshot = await options.repository.readStoryBible();
      if (!snapshot.ok) {
        return snapshot;
      }

      let chapterIds: ReadonlySet<string> | undefined;
      if (options.chapterCatalog !== undefined) {
        const chapters = await options.chapterCatalog.listChapters();
        if (!chapters.ok) {
          return chapters;
        }
        chapterIds = new Set(chapters.value.map((chapter) => chapter.id));
      }

      return {
        ok: true,
        value: createConsistencyReport(snapshot.value, chapterIds)
      };
    },
    async buildContextCandidates(candidateOptions = {}) {
      if (options.repository === undefined) {
        return storyBibleUnavailable();
      }

      const snapshot = await options.repository.readStoryBible();
      if (!snapshot.ok) {
        return snapshot;
      }

      return {
        ok: true,
        value: createContextCandidates(snapshot.value, candidateOptions)
      };
    }
  };

  async function refreshSnapshot(): Promise<void> {
    if (options.repository === undefined) return;
    const loaded = await options.repository.readStoryBible();
    if (loaded.ok) snapshot = loaded.value;
  }

  async function readKnownChapterIds(): Promise<
    Result<readonly string[] | undefined, UnifiedError>
  > {
    if (options.chapterCatalog === undefined) return { ok: true, value: undefined };
    const chapters = await options.chapterCatalog.listChapters();
    return chapters.ok
      ? { ok: true, value: chapters.value.map((chapter) => chapter.id) }
      : chapters;
  }
}

function storyBibleAssetIds(snapshot: StoryBibleSnapshot): ReadonlySet<string> {
  return new Set([
    ...snapshot.characters.map((asset) => asset.id),
    ...snapshot.worldAssets.map((asset) => asset.id),
    ...(snapshot.outline === undefined ? [] : [snapshot.outline.id]),
    ...snapshot.foreshadows.map((asset) => asset.id),
    ...(snapshot.timeline === undefined ? [] : [snapshot.timeline.id])
  ]);
}

function storyBibleCandidateInvalid<T>(
  issues: readonly ValidationIssue[]
): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "STORY_BIBLE_CANDIDATE_INVALID",
      category: "ValidationError",
      message: "Story Bible changes do not match the v1.1 data contract.",
      recoverability: "user-action",
      suggestedAction: "Correct the highlighted Story Bible fields and retry.",
      traceId: "application-story-bible-candidate",
      redactedDetail: { issues: issues.map((issue) => ({ ...issue })) }
    })
  );
}

function validateDeletedStatusBoundary(
  currentStatus: StoryBibleEntityStatus,
  nextStatus: StoryBibleEntityStatus
): Result<void, UnifiedError> {
  return (currentStatus === "deleted") === (nextStatus === "deleted")
    ? { ok: true, value: undefined }
    : err(
        createUnifiedError({
          code: "STORY_BIBLE_STATUS_TRANSITION_COMMAND_REQUIRED",
          category: "ValidationError",
          message:
            "Moving a Story Bible asset into or out of deleted requires a dedicated command.",
          recoverability: "user-action",
          suggestedAction: "Use the Story Bible delete or restore command.",
          traceId: "application-story-bible-status-transition"
        })
      );
}

function storyBibleStatusTransitionInvalid<T>(): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "STORY_BIBLE_STATUS_TRANSITION_INVALID",
      category: "ValidationError",
      message: "The Story Bible status transition does not match the dedicated command.",
      recoverability: "user-action",
      suggestedAction: "Reload the Story Bible entry and prepare the status command again.",
      traceId: "application-story-bible-status-transition"
    })
  );
}

/**
 * Finds active Story Bible assets whose title or alias appears in the current writing input.
 * The result is presentation-only until the user explicitly adds one of these refs to a draft.
 */
export function findStoryBibleMentionSuggestions(
  input: StoryBibleMentionScanInput
): readonly StoryBibleMentionSuggestion[] {
  const texts = [input.currentChapterBody ?? "", input.userRequest]
    .map((text) => text.toLowerCase())
    .filter((text) => text.length > 0);
  if (texts.length === 0) return [];

  const assets = [
    ...input.snapshot.characters,
    ...input.snapshot.worldAssets,
    ...(input.snapshot.outline === undefined ? [] : [input.snapshot.outline]),
    ...(input.snapshot.timeline === undefined ? [] : [input.snapshot.timeline])
  ];
  const seenAssetIds = new Set<string>();
  const suggestions: StoryBibleMentionSuggestion[] = [];

  for (const asset of assets) {
    if (asset.status !== "active" || seenAssetIds.has(asset.id)) continue;
    const names = [asset.title, ...(asset.aliases ?? [])]
      .map((name) => name.trim().toLowerCase())
      .filter((name) => name.length > 0);
    if (!names.some((name) => texts.some((text) => text.includes(name)))) continue;

    seenAssetIds.add(asset.id);
    suggestions.push({
      kind: "story_bible",
      refId: `story_bible:${asset.id}`,
      assetId: asset.id,
      label: asset.title
    });
  }

  return suggestions;
}

function createConsistencyReport(
  snapshot: StoryBibleSnapshot,
  chapterIds: ReadonlySet<string> | undefined
): StoryBibleConsistencyReport {
  const issues: StoryBibleConsistencyIssue[] = [];
  const targets = [
    ...snapshot.worldAssets.map((asset) => ({ ref: assetRef(asset), text: asset.summary })),
    ...(snapshot.outline === undefined
      ? []
      : [{ ref: assetRef(snapshot.outline), text: snapshot.outline.summary }]),
    ...(snapshot.timeline === undefined
      ? []
      : [{ ref: assetRef(snapshot.timeline), text: snapshot.timeline.summary }]),
    ...snapshot.memories.map((memory) => ({ ref: memoryRef(memory), text: memory.content }))
  ];

  for (const character of snapshot.characters.filter((asset) => asset.status === "active")) {
    const names = [character.title, ...(character.aliases ?? [])].filter((name) => name.length > 0);
    if (names.length === 0) {
      continue;
    }

    for (const target of targets) {
      if (!hasExplicitConflictMarker(target.text) || !mentionsAny(target.text, names)) {
        continue;
      }

      const sourceRef = assetRef(character);
      issues.push({
        id: `story-consistency.character.${character.id}.${target.ref.id}`,
        severity: "warning",
        title:
          target.ref.kind === "memory"
            ? "Character setting may conflict with a memory"
            : "Character setting may conflict with another Story Bible entry",
        message: `${character.title} appears in ${target.ref.title} with an explicit conflict marker. Review both entries before continuing the chapter.`,
        sourceRef,
        targetRef: target.ref,
        suggestedAction: "Open the linked Story Bible entry and resolve the setting conflict."
      });
    }
  }

  if (chapterIds !== undefined) {
    issues.push(...createChapterReferenceConsistencyIssues(snapshot, chapterIds));
  }
  issues.push(...createForeshadowConsistencyIssues(snapshot.foreshadows));

  return {
    status: issues.length > 0 ? "attention" : "healthy",
    checkedAt: latestUpdatedAt(snapshot),
    issues
  };
}

function assetRef(asset: StoryBibleAsset): StoryBibleConsistencyRef {
  return {
    kind: consistencyKindForAsset(asset),
    id: asset.id,
    title: asset.title
  };
}

function memoryRef(memory: MemoryRecord): StoryBibleConsistencyRef {
  return {
    kind: "memory",
    id: memory.id,
    title: memory.title
  };
}

function chapterRef(chapterId: string): StoryBibleConsistencyRef {
  return {
    kind: "chapter",
    id: chapterId,
    title: chapterId
  };
}

function consistencyKindForAsset(asset: StoryBibleAsset): StoryBibleConsistencyRefKind {
  if (asset.type === "foreshadow") {
    return "foreshadow";
  }
  if (asset.type === "character") {
    return "character";
  }
  if (asset.type === "outline") {
    return "outline";
  }
  if (asset.type === "timeline.events") {
    return "timeline";
  }

  return "world";
}

function createChapterReferenceConsistencyIssues(
  snapshot: StoryBibleSnapshot,
  chapterIds: ReadonlySet<string>
): readonly StoryBibleConsistencyIssue[] {
  const assets: readonly StoryBibleAsset[] = [
    ...snapshot.characters,
    ...snapshot.worldAssets,
    ...(snapshot.outline === undefined ? [] : [snapshot.outline]),
    ...(snapshot.timeline === undefined ? [] : [snapshot.timeline]),
    ...snapshot.foreshadows
  ];
  const issues: StoryBibleConsistencyIssue[] = [];
  for (const asset of [...assets].sort((left, right) => compareStableText(left.id, right.id))) {
    const missingChapterIds = new Set(
      collectStoryBibleDeclaredChapterReferences(asset)
        .map((reference) => reference.chapterId)
        .filter((chapterId) => !chapterIds.has(chapterId))
    );
    for (const chapterId of [...missingChapterIds].sort(compareStableText)) {
      const foreshadow = asset.type === "foreshadow";
      issues.push({
        id: `story-consistency.${consistencyKindForAsset(asset)}.${asset.id}.missing-chapter.${chapterId}`,
        severity: "warning",
        title: foreshadow
          ? "Foreshadow references a missing chapter"
          : "Story Bible entry references a missing chapter",
        message: `${asset.title} references chapter ${chapterId}, but that chapter is not in the project catalog.`,
        sourceRef: assetRef(asset),
        targetRef: chapterRef(chapterId),
        suggestedAction: `Open ${asset.title} and replace or remove the missing chapter reference.`
      });
    }
  }
  return issues;
}

function createForeshadowConsistencyIssues(
  foreshadows: readonly ForeshadowAsset[]
): readonly StoryBibleConsistencyIssue[] {
  const issues: StoryBibleConsistencyIssue[] = [];
  const orderedForeshadows = [...foreshadows].sort((left, right) =>
    compareStableText(left.id, right.id)
  );

  issues.push(...duplicateForeshadowSourceIssues(orderedForeshadows));

  for (const foreshadow of orderedForeshadows) {
    const warning = collectForeshadowContractWarnings(foreshadow.details)[0];
    if (warning === undefined) continue;

    const ref = assetRef(foreshadow);
    issues.push({
      id: `story-consistency.foreshadow.${foreshadow.id}.paid-off-missing-actual-payoff-chapter`,
      code: FORESHADOW_PAID_OFF_ACTUAL_CHAPTER_MISSING,
      severity: warning.severity,
      title: "Paid-off foreshadow has no payoff chapter",
      message: `${foreshadow.title} is marked paid off without an actual payoff chapter.`,
      sourceRef: ref,
      targetRef: ref,
      suggestedAction: "Open the foreshadow and select its actual payoff chapter."
    });
  }

  return issues.sort((left, right) => compareStableText(left.id, right.id));
}

function duplicateForeshadowSourceIssues(
  foreshadows: readonly ForeshadowAsset[]
): readonly StoryBibleConsistencyIssue[] {
  const sourcesByChapter = new Map<string, Map<string, ForeshadowAsset[]>>();

  for (const foreshadow of foreshadows) {
    if (foreshadow.status === "deleted") {
      continue;
    }

    for (const sourceRef of foreshadow.details.sourceRefs ?? []) {
      if (!hasNonEmptyText(sourceRef.chapterId) || !hasNonEmptyText(sourceRef.excerptHash)) {
        continue;
      }
      const sourcesByHash = sourcesByChapter.get(sourceRef.chapterId) ?? new Map();
      const matchingForeshadows = sourcesByHash.get(sourceRef.excerptHash) ?? [];
      matchingForeshadows.push(foreshadow);
      sourcesByHash.set(sourceRef.excerptHash, matchingForeshadows);
      sourcesByChapter.set(sourceRef.chapterId, sourcesByHash);
    }
  }

  const issues: StoryBibleConsistencyIssue[] = [];
  for (const chapterId of [...sourcesByChapter.keys()].sort(compareStableText)) {
    const sourcesByHash = sourcesByChapter.get(chapterId);
    if (sourcesByHash === undefined) {
      continue;
    }
    for (const excerptHash of [...sourcesByHash.keys()].sort(compareStableText)) {
      const matchingForeshadows = sourcesByHash.get(excerptHash) ?? [];
      if (matchingForeshadows.length < 2) {
        continue;
      }
      const source = matchingForeshadows[0];
      const target = matchingForeshadows[1];
      if (source === undefined || target === undefined) {
        continue;
      }

      issues.push({
        id: `story-consistency.foreshadow.duplicate-source.${chapterId}.${excerptHash}`,
        severity: "warning",
        title: "Foreshadow source evidence is duplicated",
        message: `${source.title} and ${target.title} use the same evidence from chapter ${chapterId}.`,
        sourceRef: assetRef(source),
        targetRef: assetRef(target),
        suggestedAction: "Open the referenced foreshadows and keep the evidence on only one entry."
      });
    }
  }

  return issues;
}

function hasNonEmptyText(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function compareStableText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function hasExplicitConflictMarker(text: string): boolean {
  const normalized = text.toLocaleLowerCase();
  return (
    normalized.includes("conflict") ||
    normalized.includes("contradict") ||
    text.includes("冲突") ||
    text.includes("矛盾")
  );
}

function mentionsAny(text: string, names: readonly string[]): boolean {
  const normalizedText = text.toLocaleLowerCase();
  return names.some((name) => normalizedText.includes(name.toLocaleLowerCase()));
}

function latestUpdatedAt(snapshot: StoryBibleSnapshot): string {
  const timestamps = [
    ...snapshot.characters,
    ...snapshot.worldAssets,
    ...(snapshot.outline === undefined ? [] : [snapshot.outline]),
    ...(snapshot.timeline === undefined ? [] : [snapshot.timeline]),
    ...snapshot.foreshadows,
    ...snapshot.memories
  ].map((entry) => entry.updatedAt);

  return timestamps.sort().at(-1) ?? new Date(0).toISOString();
}

function createContextCandidates(
  snapshot: StoryBibleSnapshot,
  options: StoryBibleContextCandidateOptions
): readonly ContextCandidate[] {
  const includeStatuses = options.includeStatuses ?? ["active"];
  const candidates: ContextCandidate[] = [];

  snapshot.characters
    .filter((asset) => includeStatuses.includes(asset.status))
    .forEach((asset, index) => {
      candidates.push(assetCandidate(asset, "character", 100 + index));
    });
  snapshot.worldAssets
    .filter((asset) => includeStatuses.includes(asset.status))
    .forEach((asset, index) => {
      candidates.push(assetCandidate(asset, "world", 200 + index));
    });
  if (snapshot.outline !== undefined && includeStatuses.includes(snapshot.outline.status)) {
    candidates.push(assetCandidate(snapshot.outline, "goal", 300, "outline"));
  }
  if (snapshot.timeline !== undefined && includeStatuses.includes(snapshot.timeline.status)) {
    candidates.push(assetCandidate(snapshot.timeline, "timeline", 300));
  }
  snapshot.foreshadows
    .filter(
      (foreshadow) =>
        foreshadow.status === "active" &&
        includeStatuses.includes(foreshadow.status) &&
        foreshadow.details.trackingStatus !== "abandoned"
    )
    .forEach((foreshadow) => {
      candidates.push(assetCandidate(foreshadow, "goal", 350, "foreshadow"));
    });
  snapshot.memories
    .filter((memory) => includeStatuses.includes(memory.status))
    .forEach((memory, index) => {
      candidates.push(memoryCandidate(memory, 400 + index));
    });

  return candidates;
}

function assetCandidate(
  asset: StoryBibleAsset,
  refType: ContextCandidate["refType"],
  priority: number,
  sourceEntityType: string = refType
): ContextCandidate {
  return {
    refType,
    refId: asset.id,
    content: asset.summary,
    priority,
    sourceRefs: [{ entityType: sourceEntityType, entityId: asset.id }]
  };
}

function memoryCandidate(memory: MemoryRecord, priority: number): ContextCandidate {
  return {
    refType: "memory",
    refId: memory.id,
    content: memory.content,
    priority,
    memoryConfidence: toContextMemoryConfidence(memory),
    sourceRefs: [{ entityType: "memory", entityId: memory.id }]
  };
}

function toContextMemoryConfidence(
  memory: MemoryRecord
): NonNullable<ContextCandidate["memoryConfidence"]> {
  if (memory.confidence === "confirmed" && memory.origin !== "ai-unconfirmed") {
    return "confirmed";
  }
  if (memory.origin === "ai-unconfirmed" || memory.confidence === "needs-review") {
    return "ai-unconfirmed";
  }
  return "low";
}

function storyBibleUnavailable<T>(): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "STORY_BIBLE_UNAVAILABLE",
      category: "UserError",
      message: "No Story Bible session is available.",
      recoverability: "user-action",
      suggestedAction: "Open a project before using Story Bible commands.",
      traceId: "application-story-bible"
    })
  );
}
