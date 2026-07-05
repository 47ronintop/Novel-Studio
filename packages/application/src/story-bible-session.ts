import type { ContextCandidate } from "@novel-studio/context-engine";
import {
  createUnifiedError,
  err,
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
  | "timeline.events";
export type StoryBibleEntityStatus = "active" | "draft" | "archived" | "deleted";
export type MemoryRecordType = "memory.long-term" | "memory.style" | "memory.summary";
export type MemoryOrigin = "user" | "user-confirmed-ai" | "ai-unconfirmed";
export type MemoryConfidence = "confirmed" | "needs-review" | "deprecated";
export type StoryBibleContextCandidate = ContextCandidate;

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

export interface StoryBibleSessionOptions {
  readonly repository?: StoryBibleRepositoryPort;
}

export interface StoryBibleContextCandidateOptions {
  readonly includeStatuses?: readonly StoryBibleEntityStatus[];
}

export interface StoryBibleSession {
  getSnapshot(): StoryBibleSnapshot | undefined;
  loadStoryBible(): Promise<Result<StoryBibleSnapshot, UnifiedError>>;
  saveStoryAsset(asset: StoryBibleAsset): Promise<Result<StoryBibleAsset, UnifiedError>>;
  saveMemory(memory: MemoryRecord): Promise<Result<MemoryRecord, UnifiedError>>;
  buildContextCandidates(
    options?: StoryBibleContextCandidateOptions
  ): Promise<Result<readonly StoryBibleContextCandidate[], UnifiedError>>;
}

export function createStoryBibleSession(options: StoryBibleSessionOptions = {}): StoryBibleSession {
  let snapshot: StoryBibleSnapshot | undefined;

  return {
    getSnapshot: () => snapshot,
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
