import type { StoryChangeSuggestion, StoryReviewIssue } from "@novel-studio/schemas";

import type { StoryAnalysisHistoryRecord } from "./story-analysis-session.js";

export const STORY_ANALYSIS_SAFE_AUTO_MIN_CONFIDENCE = 0.95;

const SAFE_DOMAINS = new Set<StoryChangeSuggestion["domain"]>([
  "character.behavior",
  "character.location",
  "character.resource",
  "character.emotion",
  "character.information",
  "foreshadow",
  "timeline",
  "character.physical_state"
]);

const SAFE_ASSET_PATHS = new Set([
  "/details/currentState/locationId",
  "/details/currentState/heldItemIds",
  "/details/currentState/emotional",
  "/details/currentState/physical",
  "/details/currentState/asOfChapterId",
  "/details/currentState/asOfEventId",
  "/details/holderId",
  "/details/currentLocationId",
  "/details/state",
  "/details/asOfChapterId",
  "/details/asOfEventId",
  "/details/trackingStatus"
]);

const SAFE_CHAPTER_OUTLINE_PATHS = new Set(["/actualOutcome"]);

export function selectSafeStoryAnalysisSuggestionIds(
  record: StoryAnalysisHistoryRecord
): readonly string[] {
  if (record.storyAnalysis.analysisRun.status !== "completed") return [];
  const suggestions = record.storyAnalysis.records.filter(
    (candidate): candidate is StoryChangeSuggestion => candidate.recordType === "change"
  );
  const blockedAssetIds = openIssueAssetIds(
    record.storyAnalysis.records.filter(
      (candidate): candidate is StoryReviewIssue =>
        candidate.recordType === "review_issue" && candidate.status === "open"
    )
  );
  const groups = new Map<string, StoryChangeSuggestion[]>();
  for (const suggestion of suggestions) {
    const current = groups.get(suggestion.consistencyGroupId) ?? [];
    current.push(suggestion);
    groups.set(suggestion.consistencyGroupId, current);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .flatMap(([, group]) =>
      group.length > 0 && group.every((suggestion) => isSafeSuggestion(suggestion, blockedAssetIds))
        ? group
            .map((suggestion) => suggestion.suggestionId)
            .sort((left, right) => left.localeCompare(right, "en"))
        : []
    );
}

function isSafeSuggestion(
  suggestion: StoryChangeSuggestion,
  blockedAssetIds: ReadonlySet<string>
): boolean {
  if (
    suggestion.status !== "pending" ||
    suggestion.action !== "patch" ||
    suggestion.target === null ||
    !Number.isSafeInteger(suggestion.target.baseRevision) ||
    suggestion.target.baseRevision < 1 ||
    blockedAssetIds.has(suggestion.target.assetId) ||
    suggestion.epistemicStatus !== "narrator_asserted" ||
    suggestion.confidence < STORY_ANALYSIS_SAFE_AUTO_MIN_CONFIDENCE ||
    !SAFE_DOMAINS.has(suggestion.domain) ||
    suggestion.observationIds.length === 0 ||
    suggestion.evidence.length === 0 ||
    suggestion.operations.length === 0 ||
    !suggestion.dependencies.some(
      (dependency) =>
        dependency.kind === "chapter" &&
        dependency.chapterId === suggestion.chapter.chapterId &&
        dependency.checksum === suggestion.chapter.checksum
    )
  ) {
    return false;
  }
  return suggestion.operations.every(
    (operation) =>
      operation.op !== "remove" && safeOperationPath(operation.path, suggestion.target?.entryRef)
  );
}

function safeOperationPath(path: string, entryRef: Record<string, unknown> | null | undefined) {
  if (SAFE_ASSET_PATHS.has(path)) return entryRef === null || entryRef === undefined;
  return (
    SAFE_CHAPTER_OUTLINE_PATHS.has(path) &&
    entryRef !== null &&
    entryRef !== undefined &&
    entryRef["collection"] === "chapterOutlines" &&
    typeof entryRef["entryId"] === "string" &&
    Number.isSafeInteger(entryRef["baseEntryRevision"]) &&
    Number(entryRef["baseEntryRevision"]) >= 1
  );
}

function openIssueAssetIds(issues: readonly StoryReviewIssue[]): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const issue of issues) {
    for (const reference of issue.affectedRefs) {
      if (!reference.startsWith("story_bible:")) continue;
      const assetId = reference.slice("story_bible:".length);
      if (assetId.length > 0) ids.add(assetId);
    }
  }
  return ids;
}
