import { createHash } from "node:crypto";

import type { ChangeSet } from "@novel-studio/agent-engine";
import type { StoryChangeSuggestion } from "@novel-studio/schemas";
import {
  createUnifiedError,
  err,
  ok,
  type ChapterCatalogRepositoryPort,
  type JsonObject,
  type JsonValue,
  type Result,
  type UnifiedError
} from "@novel-studio/shared";

import type { AgentFileOperationSession } from "./agent-file-operation-session.js";
import type { ChangeSetSession } from "./change-set-session.js";
import type { StoryAnalysisChangeSetPreparationPort } from "./story-analysis-application-session.js";
import type {
  StoryBibleAgentToolAsset,
  StoryBibleAgentToolRepositoryPort,
  StoryBibleTemporaryReferenceTarget
} from "./story-bible-agent-tool-session.js";
import {
  checksumStoryBibleSelectorValue,
  prepareStoryBiblePatch,
  type StoryBiblePatchEntryRef,
  type StoryBiblePatchOperation
} from "./story-bible-patch.js";

const TRACE_ID = "story-analysis-change-set-preparation";

export interface StoryAnalysisChangeSetPreparationOptions {
  readonly projectId: string;
  readonly repository: StoryBibleAgentToolRepositoryPort;
  readonly chapterCatalog?: Pick<ChapterCatalogRepositoryPort, "listChapters">;
  readonly changeSets: Pick<
    ChangeSetSession,
    "proposeOperation" | "proposeOperationBatch" | "proposeStoryBibleWrite" | "readLatestChangeSet"
  >;
  readonly fileOperations: Pick<
    AgentFileOperationSession,
    "proposeStoryBibleWrite" | "proposeFileCreate" | "proposeFileDelete"
  >;
}

export function createStoryAnalysisChangeSetPreparationPort(
  options: StoryAnalysisChangeSetPreparationOptions
): StoryAnalysisChangeSetPreparationPort {
  return {
    async prepareChangeSet(input) {
      if (input.suggestions.length === 0) {
        return err(
          preparationError(
            "STORY_ANALYSIS_SUGGESTION_SELECTION_INVALID",
            "At least one accepted suggestion is required."
          )
        );
      }
      const suggestions = [...input.suggestions].sort((left, right) =>
        left.suggestionId.localeCompare(right.suggestionId, "en")
      );
      if (suggestions.some((suggestion) => suggestion.status !== "accepted")) {
        return err(
          preparationError(
            "STORY_ANALYSIS_SUGGESTION_NOT_APPLICABLE",
            "Only accepted Story Analysis suggestions can create a Change Set."
          )
        );
      }
      const checkpointId = stableId("checkpoint", JSON.stringify(suggestions));
      const binding = {
        runId: input.workflowRunId,
        projectId: options.projectId,
        checkpointId,
        contextSnapshotId: input.contextSnapshotId
      };
      const existing = await options.changeSets.readLatestChangeSet({
        runId: binding.runId,
        projectId: binding.projectId,
        checkpointId: binding.checkpointId
      });
      if (!existing.ok) return existing;
      if (existing.value !== undefined) {
        const existingMigrationError = validateExistingMigrationPairs(existing.value);
        return existingMigrationError === undefined
          ? ok(existing.value)
          : err(existingMigrationError);
      }

      const proposedAssetIds = suggestions.flatMap((suggestion) =>
        suggestion.action === "create" && suggestion.proposedAssetId !== null
          ? [suggestion.proposedAssetId]
          : []
      );
      const uniqueProposedIds = [...new Set(proposedAssetIds)];
      if (uniqueProposedIds.length !== proposedAssetIds.length) {
        return err(
          preparationError(
            "STORY_ANALYSIS_CREATE_ID_CONFLICT",
            "Selected create suggestions contain the same reserved asset ID."
          )
        );
      }
      const proposedAssetIdsByGroup = new Map<string, string[]>();
      for (const suggestion of suggestions) {
        if (suggestion.action !== "create" || suggestion.proposedAssetId === null) continue;
        const current = proposedAssetIdsByGroup.get(suggestion.consistencyGroupId) ?? [];
        current.push(suggestion.proposedAssetId);
        proposedAssetIdsByGroup.set(suggestion.consistencyGroupId, current);
      }
      const temporaryTargetsByGroup = collectTemporaryTimelineEventTargets(suggestions);
      const knownChapterIds = await readKnownChapterIds(options.chapterCatalog);
      if (!knownChapterIds.ok) return knownChapterIds;

      let latest: ChangeSet | undefined;
      for (const suggestion of suggestions.filter((candidate) => candidate.action === "create")) {
        const prepared = await prepareCreateSuggestion(
          suggestion,
          proposedAssetIdsByGroup.get(suggestion.consistencyGroupId) ?? [],
          temporaryTargetsByGroup.get(suggestion.consistencyGroupId) ?? [],
          knownChapterIds.value,
          options.repository
        );
        if (!prepared.ok) return prepared;
        const operation = options.fileOperations.proposeStoryBibleWrite({
          toolCallId: `analysis_${suggestion.suggestionId}`,
          assetType: prepared.value.asset.type,
          content: prepared.value.content,
          consistencyGroupId: suggestion.consistencyGroupId
        });
        if (!operation.ok) return operation;
        const proposed = await options.changeSets.proposeOperation({
          ...binding,
          toolCallId: `analysis_${suggestion.suggestionId}`,
          operation: operation.value.operation
        });
        if (!proposed.ok) return proposed;
        latest = proposed.value;
      }

      const patchSuggestions = suggestions.filter(
        (
          candidate
        ): candidate is StoryChangeSuggestion & {
          readonly action: "patch";
          readonly target: NonNullable<StoryChangeSuggestion["target"]>;
        } => candidate.action === "patch" && candidate.target !== null
      );
      if (
        patchSuggestions.length !==
        suggestions.filter((candidate) => candidate.action === "patch").length
      ) {
        return err(
          preparationError(
            "STORY_ANALYSIS_PATCH_TARGET_INVALID",
            "A patch suggestion is missing its target binding."
          )
        );
      }
      const assetGroups = groupPatchSuggestions(patchSuggestions);
      if (!assetGroups.ok) return assetGroups;
      for (const group of assetGroups.value) {
        const prepared = await preparePatchGroup(
          group.suggestions,
          proposedAssetIdsByGroup.get(group.consistencyGroupId) ?? [],
          temporaryTargetsByGroup.get(group.consistencyGroupId) ?? [],
          knownChapterIds.value,
          options.repository
        );
        if (!prepared.ok) return prepared;
        if (
          prepared.value.currentRelativePath !== undefined &&
          prepared.value.currentRelativePath !== prepared.value.relativePath
        ) {
          const migrationToolCallId = stableId(
            "tool",
            `${binding.runId}:${group.consistencyGroupId}:${prepared.value.asset.id}:${prepared.value.currentRelativePath}`
          );
          const create = options.fileOperations.proposeFileCreate({
            toolCallId: `${migrationToolCallId}_create`,
            relativePath: prepared.value.relativePath,
            content: prepared.value.content,
            consistencyGroupId: group.consistencyGroupId
          });
          if (!create.ok) return create;
          const remove = options.fileOperations.proposeFileDelete({
            toolCallId: `${migrationToolCallId}_delete`,
            relativePath: prepared.value.currentRelativePath,
            baseChecksum: prepared.value.baseChecksum,
            dependsOn: [create.value.operationId],
            consistencyGroupId: group.consistencyGroupId
          });
          if (!remove.ok) return remove;
          const proposedMigration = await options.changeSets.proposeOperationBatch({
            ...binding,
            operations: [
              {
                toolCallId: `${migrationToolCallId}_create`,
                operation: create.value.operation
              },
              {
                toolCallId: `${migrationToolCallId}_delete`,
                operation: remove.value.operation
              }
            ]
          });
          if (!proposedMigration.ok) return proposedMigration;
          latest = proposedMigration.value;
        } else {
          const proposed = await options.changeSets.proposeStoryBibleWrite({
            ...binding,
            assetId: prepared.value.asset.id,
            range: {
              unit: "character",
              start: 0,
              end: prepared.value.baseContent.length
            },
            baseHash: prepared.value.baseChecksum,
            replacement: prepared.value.content,
            consistencyGroupId: group.consistencyGroupId,
            repositoryPrepared: true
          });
          if (!proposed.ok) return proposed;
          latest = proposed.value;
        }
      }

      return latest === undefined
        ? err(
            preparationError(
              "STORY_ANALYSIS_CHANGE_SET_EMPTY",
              "The selected suggestions produced no reviewable Story Bible change."
            )
          )
        : ok(latest);
    }
  };
}

function validateExistingMigrationPairs(changeSet: ChangeSet): UnifiedError | undefined {
  const operationsByToolCallId = new Map(
    (changeSet.operations ?? []).map((operation) => [operation.toolCallIdempotencyKey, operation])
  );
  const migrationKeys = [...operationsByToolCallId.keys()].filter(
    (toolCallId) => toolCallId.startsWith("tool_") && /_(?:create|delete)$/.test(toolCallId)
  );
  for (const toolCallId of migrationKeys) {
    const baseToolCallId = toolCallId.replace(/_(?:create|delete)$/, "");
    const create = operationsByToolCallId.get(`${baseToolCallId}_create`);
    const remove = operationsByToolCallId.get(`${baseToolCallId}_delete`);
    if (
      create?.kind !== "create_file" ||
      remove?.kind !== "delete_file" ||
      create.consistencyGroupId === undefined ||
      create.consistencyGroupId !== remove.consistencyGroupId ||
      !(remove.dependsOn ?? []).includes(create.operationId)
    ) {
      return preparationError(
        "STORY_ANALYSIS_CHANGE_SET_INCOMPLETE",
        "The existing Story Analysis Change Set contains an incomplete legacy migration."
      );
    }
  }
  return undefined;
}

async function prepareCreateSuggestion(
  suggestion: StoryChangeSuggestion,
  additionalKnownAssetIds: readonly string[],
  additionalKnownReferenceTargets: readonly StoryBibleTemporaryReferenceTarget[],
  knownChapterIds: readonly string[] | undefined,
  repository: StoryBibleAgentToolRepositoryPort
) {
  if (
    suggestion.proposedAssetType === null ||
    suggestion.proposedAssetId === null ||
    suggestion.createValue === null ||
    suggestion.target !== null ||
    suggestion.operations.length !== 0
  ) {
    return err(
      preparationError(
        "STORY_ANALYSIS_CREATE_CONTRACT_INVALID",
        "A create suggestion does not contain its strict reserved-ID create contract."
      )
    );
  }
  return repository.prepareCreateStoryAsset({
    type: suggestion.proposedAssetType,
    value: suggestion.createValue as JsonObject,
    reservedAssetId: suggestion.proposedAssetId,
    additionalKnownAssetIds,
    deferProjectRelationPairValidation: true,
    ...(additionalKnownReferenceTargets.length === 0 ? {} : { additionalKnownReferenceTargets }),
    ...(knownChapterIds === undefined ? {} : { knownChapterIds })
  });
}

function groupPatchSuggestions(
  suggestions: readonly (StoryChangeSuggestion & {
    readonly action: "patch";
    readonly target: NonNullable<StoryChangeSuggestion["target"]>;
  })[]
): Result<
  readonly {
    readonly assetId: string;
    readonly consistencyGroupId: string;
    readonly suggestions: readonly (StoryChangeSuggestion & {
      readonly action: "patch";
      readonly target: NonNullable<StoryChangeSuggestion["target"]>;
    })[];
  }[],
  UnifiedError
> {
  const groupsByAsset = new Map<string, Map<string, typeof suggestions>>();
  for (const suggestion of suggestions) {
    const byGroup = groupsByAsset.get(suggestion.target.assetId) ?? new Map();
    const current = byGroup.get(suggestion.consistencyGroupId) ?? [];
    byGroup.set(suggestion.consistencyGroupId, [...current, suggestion]);
    groupsByAsset.set(suggestion.target.assetId, byGroup);
  }
  const result: {
    readonly assetId: string;
    readonly consistencyGroupId: string;
    readonly suggestions: typeof suggestions;
  }[] = [];
  for (const [assetId, byGroup] of groupsByAsset) {
    if (byGroup.size > 1) {
      return err(
        preparationError(
          "STORY_ANALYSIS_TARGET_GROUP_CONFLICT",
          `Asset ${assetId} is targeted by more than one independently selectable group.`
        )
      );
    }
    const [entry] = byGroup.entries();
    if (entry === undefined) continue;
    result.push({ assetId, consistencyGroupId: entry[0], suggestions: entry[1] });
  }
  return ok(result.sort((left, right) => left.assetId.localeCompare(right.assetId, "en")));
}

async function preparePatchGroup(
  suggestions: readonly (StoryChangeSuggestion & {
    readonly action: "patch";
    readonly target: NonNullable<StoryChangeSuggestion["target"]>;
  })[],
  additionalKnownAssetIds: readonly string[],
  additionalKnownReferenceTargets: readonly StoryBibleTemporaryReferenceTarget[],
  knownChapterIds: readonly string[] | undefined,
  repository: StoryBibleAgentToolRepositoryPort
) {
  const first = suggestions[0];
  if (first === undefined) {
    return err(preparationError("STORY_ANALYSIS_PATCH_TARGET_INVALID", "Patch group is empty."));
  }
  const read = await repository.readCompatibleStoryAsset(first.target.assetId);
  if (!read.ok) return read;
  let workingAsset: StoryBibleAgentToolAsset = read.value.asset;
  let candidate: JsonObject | undefined;
  const groups = groupOperationsByEntry(suggestions);
  if (!groups.ok) return groups;
  for (const group of groups.value) {
    const target = patchTarget(workingAsset, group.entryRef);
    if (!target.ok) return target;
    const operations = validateAndConvertOperations(group.operations, target.value);
    if (!operations.ok) return operations;
    const prepared = prepareStoryBiblePatch({
      asset: workingAsset,
      baseRevision: group.baseRevision,
      entryRef: group.entryRef,
      operations: operations.value
    });
    if (!prepared.ok) return prepared;
    candidate = prepared.value.candidate;
    workingAsset = {
      ...workingAsset,
      ...candidate,
      updatedAt: workingAsset.updatedAt,
      revision: workingAsset.revision
    } as StoryBibleAgentToolAsset;
  }
  if (candidate === undefined) {
    return err(preparationError("STORY_ANALYSIS_PATCH_INVALID", "Patch group has no operations."));
  }
  return repository.prepareStoryAssetCandidateReadOnly({
    candidate,
    baseRevision: read.value.revision,
    baseChecksum: read.value.checksum,
    additionalKnownAssetIds,
    deferProjectRelationPairValidation: true,
    ...(additionalKnownReferenceTargets.length === 0 ? {} : { additionalKnownReferenceTargets }),
    ...(knownChapterIds === undefined ? {} : { knownChapterIds })
  });
}

async function readKnownChapterIds(
  chapterCatalog: Pick<ChapterCatalogRepositoryPort, "listChapters"> | undefined
): Promise<Result<readonly string[] | undefined, UnifiedError>> {
  if (chapterCatalog === undefined) return ok(undefined);
  const chapters = await chapterCatalog.listChapters();
  return chapters.ok ? ok(chapters.value.map((chapter) => chapter.id)) : chapters;
}

function collectTemporaryTimelineEventTargets(
  suggestions: readonly StoryChangeSuggestion[]
): ReadonlyMap<string, readonly StoryBibleTemporaryReferenceTarget[]> {
  const targetsByGroup = new Map<string, Map<string, StoryBibleTemporaryReferenceTarget>>();
  const collect = (consistencyGroupId: string, value: unknown) => {
    if (!Array.isArray(value)) return;
    const targets = targetsByGroup.get(consistencyGroupId) ?? new Map();
    for (const event of value) {
      if (!isRecord(event)) continue;
      const eventId = event["eventId"];
      if (typeof eventId !== "string" || !/^evt_[a-f0-9]{32}$/u.test(eventId)) continue;
      targets.set(eventId, { targetId: eventId, targetType: "timeline.event" });
    }
    if (targets.size > 0) targetsByGroup.set(consistencyGroupId, targets);
  };

  for (const suggestion of suggestions) {
    if (
      suggestion.action === "create" &&
      suggestion.proposedAssetType === "timeline.events" &&
      isRecord(suggestion.createValue) &&
      isRecord(suggestion.createValue["details"])
    ) {
      collect(suggestion.consistencyGroupId, suggestion.createValue["details"]["events"]);
    }
    if (suggestion.action === "patch" && suggestion.target?.assetId === "timeline_main") {
      for (const operation of suggestion.operations) {
        if (operation.path === "/details/events") {
          collect(suggestion.consistencyGroupId, operation.value);
        }
      }
    }
  }

  return new Map(
    [...targetsByGroup].map(([groupId, targets]) => [
      groupId,
      [...targets.values()].sort((left, right) => left.targetId.localeCompare(right.targetId, "en"))
    ])
  );
}

function groupOperationsByEntry(
  suggestions: readonly (StoryChangeSuggestion & {
    readonly target: NonNullable<StoryChangeSuggestion["target"]>;
  })[]
): Result<
  readonly {
    readonly entryRef: StoryBiblePatchEntryRef | null;
    readonly baseRevision: number;
    readonly operations: readonly StoryChangeSuggestion["operations"][number][];
  }[],
  UnifiedError
> {
  const groups = new Map<
    string,
    {
      readonly entryRef: StoryBiblePatchEntryRef | null;
      readonly baseRevision: number;
      readonly operations: StoryChangeSuggestion["operations"][number][];
    }
  >();
  for (const suggestion of suggestions) {
    const entryRef = parseEntryRef(suggestion.target.entryRef);
    if (!entryRef.ok) return entryRef;
    const key = entryRef.value === null ? "root" : JSON.stringify(entryRef.value);
    const current = groups.get(key) ?? {
      entryRef: entryRef.value,
      baseRevision: suggestion.target.baseRevision,
      operations: []
    };
    if (current.baseRevision !== suggestion.target.baseRevision) {
      return err(
        preparationError(
          "STORY_ANALYSIS_PATCH_BASE_CONFLICT",
          "Suggestions for one target do not share the same revision baseline."
        )
      );
    }
    current.operations.push(...suggestion.operations);
    groups.set(key, current);
  }
  return ok(
    [...groups.values()].sort((left, right) =>
      left.entryRef === null
        ? -1
        : right.entryRef === null
          ? 1
          : JSON.stringify(left.entryRef).localeCompare(JSON.stringify(right.entryRef), "en")
    )
  );
}

function validateAndConvertOperations(
  operations: readonly StoryChangeSuggestion["operations"][number][],
  target: JsonObject
): Result<readonly StoryBiblePatchOperation[], UnifiedError> {
  const byPath = new Map<string, StoryChangeSuggestion["operations"][number]>();
  for (const operation of operations) {
    const prior = byPath.get(operation.path);
    if (prior !== undefined && JSON.stringify(prior) !== JSON.stringify(operation)) {
      return err(
        preparationError(
          "STORY_ANALYSIS_PATCH_CONFLICT",
          `Selected suggestions propose incompatible changes at ${operation.path}.`
        )
      );
    }
    byPath.set(operation.path, operation);
  }
  if (byPath.size === 0 || byPath.size > 100) {
    return err(
      preparationError(
        "STORY_ANALYSIS_PATCH_INVALID",
        "A merged Story Analysis patch must contain between 1 and 100 operations."
      )
    );
  }
  const converted: StoryBiblePatchOperation[] = [];
  for (const operation of byPath.values()) {
    const before = readPointer(target, operation.path);
    const baselineMatches =
      operation.beforeValueChecksum === null
        ? !before.present
        : before.present &&
          checksumStoryBibleSelectorValue(before.value) === operation.beforeValueChecksum;
    if (!baselineMatches) {
      return err(
        preparationError(
          "STORY_ANALYSIS_PATCH_BASE_CONFLICT",
          `The value at ${operation.path} changed after analysis.`
        )
      );
    }
    if (operation.op === "remove") {
      converted.push({ op: "remove", path: operation.path });
    } else if (isJsonValue(operation.value)) {
      converted.push({ op: operation.op, path: operation.path, value: operation.value });
    } else {
      return err(
        preparationError(
          "STORY_ANALYSIS_PATCH_INVALID",
          `The proposed value at ${operation.path} is not JSON.`
        )
      );
    }
  }
  return ok(converted);
}

function parseEntryRef(
  value: Record<string, unknown> | null
): Result<StoryBiblePatchEntryRef | null, UnifiedError> {
  if (value === null) return ok(null);
  const collections = new Set([
    "volumes",
    "chapterOutlines",
    "beats",
    "events",
    "knowledgeStates",
    "stateHistory",
    "milestones"
  ]);
  if (
    typeof value["collection"] !== "string" ||
    !collections.has(value["collection"]) ||
    typeof value["entryId"] !== "string" ||
    !Number.isSafeInteger(value["baseEntryRevision"]) ||
    Number(value["baseEntryRevision"]) < 1 ||
    (value["parentEntryId"] !== undefined && typeof value["parentEntryId"] !== "string")
  ) {
    return err(
      preparationError(
        "STORY_ANALYSIS_PATCH_ENTRY_INVALID",
        "A patch suggestion contains an invalid stable child-entry reference."
      )
    );
  }
  return ok({
    collection: value["collection"] as StoryBiblePatchEntryRef["collection"],
    entryId: value["entryId"],
    baseEntryRevision: Number(value["baseEntryRevision"]),
    ...(value["parentEntryId"] === undefined ? {} : { parentEntryId: value["parentEntryId"] })
  });
}

function patchTarget(
  asset: StoryBibleAgentToolAsset,
  entryRef: StoryBiblePatchEntryRef | null
): Result<JsonObject, UnifiedError> {
  if (entryRef === null) return ok(asset);
  const idFields: Readonly<Record<StoryBiblePatchEntryRef["collection"], string>> = {
    volumes: "volumeId",
    chapterOutlines: "chapterOutlineId",
    beats: "beatId",
    events: "eventId",
    knowledgeStates: "knowledgeStateId",
    stateHistory: "stateHistoryId",
    milestones: "milestoneId"
  };
  const collection =
    entryRef.collection === "beats" && entryRef.parentEntryId !== undefined
      ? objectArray(asset.details["chapterOutlines"]).find(
          (entry) => entry["chapterOutlineId"] === entryRef.parentEntryId
        )?.["beats"]
      : asset.details[entryRef.collection];
  const entry = objectArray(collection).find(
    (candidate) => candidate[idFields[entryRef.collection]] === entryRef.entryId
  );
  return entry === undefined
    ? err(
        preparationError(
          "STORY_ANALYSIS_PATCH_ENTRY_INVALID",
          "The patch target child entry no longer exists."
        )
      )
    : ok(entry);
}

function readPointer(
  value: JsonObject,
  pointer: string
): { readonly present: boolean; readonly value?: JsonValue } {
  if (!pointer.startsWith("/") || pointer.length < 2) return { present: false };
  let current: JsonValue = value;
  for (const encoded of pointer.slice(1).split("/")) {
    const segment = encoded.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return { present: false };
    }
    current = current[segment] as JsonValue;
  }
  return { present: true, value: current };
}

function objectArray(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function stableId(prefix: string, seed: string): string {
  return `${prefix}_${createHash("sha256").update(seed, "utf8").digest("hex").slice(0, 32)}`;
}

function preparationError(code: string, message: string): UnifiedError {
  return createUnifiedError({
    code,
    category: "ValidationError",
    message,
    recoverability: "user-action",
    suggestedAction: "Refresh Story Analysis suggestions and prepare the selection again.",
    traceId: TRACE_ID
  });
}
