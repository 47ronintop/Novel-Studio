import type { ContextCandidate } from "@novel-studio/context-engine";
import {
  createUnifiedError,
  err,
  type ChapterCatalogRepositoryPort,
  type ForeshadowDetails,
  type JsonObject,
  type Result,
  type UnifiedError
} from "@novel-studio/shared";

export type StoryBibleAssetType =
  | "character"
  | "world.location"
  | "world.faction"
  | "world.rule"
  | "world.glossary"
  | "outline"
  | "timeline.events"
  | "foreshadow";
export type StoryBibleRegularAssetType = Exclude<StoryBibleAssetType, "foreshadow">;
export type StoryBibleEntityStatus = "active" | "draft" | "archived" | "deleted";
export type MemoryRecordType = "memory.long-term" | "memory.style" | "memory.summary";
export type MemoryOrigin = "user" | "user-confirmed-ai" | "ai-unconfirmed";
export type MemoryConfidence = "confirmed" | "needs-review" | "deprecated";
export type StoryBibleContextCandidate = ContextCandidate;

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
  saveMemory(memory: MemoryRecord): Promise<Result<MemoryRecord, UnifiedError>>;
}

export interface StoryBibleSessionOptions {
  readonly repository?: StoryBibleRepositoryPort;
  readonly chapterCatalog?: Pick<ChapterCatalogRepositoryPort, "listChapters">;
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

      const saved = await options.repository.saveStoryAsset(asset);
      if (saved.ok) {
        const loaded = await options.repository.readStoryBible();
        if (loaded.ok) {
          snapshot = loaded.value;
        }
      }

      return saved;
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

  issues.push(...createForeshadowConsistencyIssues(snapshot.foreshadows, chapterIds));

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

function createForeshadowConsistencyIssues(
  foreshadows: readonly ForeshadowAsset[],
  chapterIds: ReadonlySet<string> | undefined
): readonly StoryBibleConsistencyIssue[] {
  const issues: StoryBibleConsistencyIssue[] = [];
  const orderedForeshadows = [...foreshadows].sort((left, right) =>
    compareStableText(left.id, right.id)
  );

  if (chapterIds !== undefined) {
    for (const foreshadow of orderedForeshadows) {
      const missingChapterIds = new Set(
        referencedChapterIds(foreshadow).filter((chapterId) => !chapterIds.has(chapterId))
      );
      for (const chapterId of [...missingChapterIds].sort(compareStableText)) {
        issues.push({
          id: `story-consistency.foreshadow.${foreshadow.id}.missing-chapter.${chapterId}`,
          severity: "warning",
          title: "Foreshadow references a missing chapter",
          message: `${foreshadow.title} references chapter ${chapterId}, but that chapter is not in the project catalog.`,
          sourceRef: assetRef(foreshadow),
          targetRef: chapterRef(chapterId),
          suggestedAction:
            "Open the foreshadow and replace or remove the missing chapter reference."
        });
      }
    }
  }

  issues.push(...duplicateForeshadowSourceIssues(orderedForeshadows));

  for (const foreshadow of orderedForeshadows) {
    if (
      foreshadow.details.trackingStatus !== "paid-off" ||
      hasNonEmptyText(foreshadow.details.actualPayoffChapterId)
    ) {
      continue;
    }

    const ref = assetRef(foreshadow);
    issues.push({
      id: `story-consistency.foreshadow.${foreshadow.id}.paid-off-missing-actual-payoff-chapter`,
      severity: "warning",
      title: "Paid-off foreshadow has no payoff chapter",
      message: `${foreshadow.title} is marked paid off without an actual payoff chapter.`,
      sourceRef: ref,
      targetRef: ref,
      suggestedAction: "Open the foreshadow and select its actual payoff chapter."
    });
  }

  return issues.sort((left, right) => compareStableText(left.id, right.id));
}

function referencedChapterIds(foreshadow: ForeshadowAsset): readonly string[] {
  const details = foreshadow.details;
  return [
    details.plantedChapterId,
    details.plannedPayoffChapterId,
    details.actualPayoffChapterId,
    ...(details.sourceRefs ?? []).map((sourceRef) => sourceRef.chapterId)
  ].filter(hasNonEmptyText);
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
