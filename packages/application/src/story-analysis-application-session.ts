import { createHash } from "node:crypto";

import {
  inspectChangeSetConsistencyGroups,
  type ChangeSet,
  type ChangeSetApproval
} from "@novel-studio/agent-engine";
import type { StoryChangeSuggestion } from "@novel-studio/schemas";
import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import type { ChangeSetSession } from "./change-set-session.js";
import type {
  StoryAnalysisHistoryRecord,
  StoryAnalysisRecordDto,
  StoryAnalysisRecordTransition,
  StoryAnalysisSession
} from "./story-analysis-session.js";
import type {
  VersionGroupApplyBatchResult,
  VersionGroupSession
} from "./version-group-session.js";

const TRACE_ID = "story-analysis-application";
const MAX_SELECTED_SUGGESTIONS = 1_000;

export interface StoryAnalysisChangeSetPreparationPort {
  prepareChangeSet(input: {
    readonly workflowRunId: string;
    readonly analysisRunId: string;
    readonly contextSnapshotId: string;
    readonly suggestions: readonly StoryChangeSuggestion[];
  }): Promise<Result<ChangeSet, UnifiedError>>;
}

export interface StoryAnalysisApplicationPreview {
  readonly schemaVersion: "1.0";
  readonly analysis: StoryAnalysisHistoryRecord;
  readonly changeSet: ChangeSet;
  readonly suggestionIdsByGroup: Readonly<Record<string, readonly string[]>>;
}

export interface StoryAnalysisApplicationResult {
  readonly schemaVersion: "1.0";
  readonly analysis: StoryAnalysisHistoryRecord;
  readonly batch: VersionGroupApplyBatchResult;
}

export interface StoryAnalysisApplicationPreviewDto {
  readonly schemaVersion: "1.0";
  readonly analysis: StoryAnalysisRecordDto;
  readonly changeSet: ChangeSet;
  readonly suggestionIdsByGroup: Readonly<Record<string, readonly string[]>>;
}

export interface StoryAnalysisApplicationResultDto {
  readonly schemaVersion: "1.0";
  readonly analysis: StoryAnalysisRecordDto;
  readonly batch: VersionGroupApplyBatchResult;
}

export interface StoryAnalysisApplicationSession {
  prepareApplication(input: {
    readonly workflowRunId: string;
    readonly suggestionIds: readonly string[];
  }): Promise<Result<StoryAnalysisApplicationPreview, UnifiedError>>;
  applyApplication(input: {
    readonly workflowRunId: string;
    readonly suggestionIds: readonly string[];
    readonly changeSetId: string;
    readonly revision: number;
    readonly checksum: string;
  }): Promise<Result<StoryAnalysisApplicationResult, UnifiedError>>;
}

export interface StoryAnalysisApplicationSessionOptions {
  readonly analysis: Pick<
    StoryAnalysisSession,
    "refreshStaleness" | "transitionRecords"
  >;
  readonly preparation: StoryAnalysisChangeSetPreparationPort;
  readonly changeSets: Pick<ChangeSetSession, "readChangeSet" | "decide">;
  readonly versionGroups: Pick<VersionGroupSession, "applyApprovedBatch">;
}

export function createStoryAnalysisApplicationSession(
  options: StoryAnalysisApplicationSessionOptions
): StoryAnalysisApplicationSession {
  return {
    async prepareApplication(input) {
      const requested = validateSuggestionIds(input.suggestionIds);
      if (!requested.ok) return requested;
      const refreshed = await options.analysis.refreshStaleness(input.workflowRunId);
      if (!refreshed.ok) return refreshed;
      const selected = selectCompleteGroups(
        refreshed.value,
        requested.value,
        new Set(["pending", "accepted"])
      );
      if (!selected.ok) return selected;

      const pendingTransitions = selected.value.suggestions
        .filter((suggestion) => suggestion.status === "pending")
        .map((suggestion) => ({
          recordId: suggestion.suggestionId,
          expectedRevision: suggestion.revision,
          transition: { status: "accepted" as const }
        }));
      const accepted =
        pendingTransitions.length === 0
          ? refreshed
          : await options.analysis.transitionRecords({
              workflowRunId: input.workflowRunId,
              transitions: pendingTransitions
            });
      if (!accepted.ok) return accepted;
      const acceptedSelection = selectCompleteGroups(
        accepted.value,
        selected.value.suggestions.map((suggestion) => suggestion.suggestionId),
        new Set(["accepted"])
      );
      if (!acceptedSelection.ok) return acceptedSelection;

      const prepared = await options.preparation.prepareChangeSet({
        workflowRunId: input.workflowRunId,
        analysisRunId: accepted.value.storyAnalysis.analysisRun.analysisRunId,
        contextSnapshotId:
          accepted.value.storyAnalysis.analysisRun.contextSnapshot.contextSnapshotId,
        suggestions: acceptedSelection.value.suggestions
      });
      if (!prepared.ok) return prepared;
      const binding = validateChangeSetGroups(prepared.value, acceptedSelection.value.byGroup);
      if (!binding.ok) return binding;
      return ok({
        schemaVersion: "1.0",
        analysis: accepted.value,
        changeSet: prepared.value,
        suggestionIdsByGroup: acceptedSelection.value.byGroup
      });
    },

    async applyApplication(input) {
      const requested = validateSuggestionIds(input.suggestionIds);
      if (!requested.ok) return requested;
      const refreshed = await options.analysis.refreshStaleness(input.workflowRunId);
      if (!refreshed.ok) return refreshed;
      const selected = selectCompleteGroups(
        refreshed.value,
        requested.value,
        new Set(["accepted", "applied"])
      );
      if (!selected.ok) return selected;

      const changeSet = await options.changeSets.readChangeSet(input.changeSetId, input.revision);
      if (!changeSet.ok) return changeSet;
      if (
        changeSet.value.runId !== input.workflowRunId ||
        changeSet.value.checksum !== input.checksum
      ) {
        return err(applicationError(
          "STORY_ANALYSIS_CHANGE_SET_BINDING_MISMATCH",
          "The reviewed Change Set no longer matches this Story Analysis application."
        ));
      }
      const groupBinding = validateChangeSetGroups(changeSet.value, selected.value.byGroup);
      if (!groupBinding.ok) return groupBinding;

      const approvalResult = await options.changeSets.decide({
        runId: input.workflowRunId,
        projectId: changeSet.value.projectId,
        commandId: stableId(
          "cmd",
          `${input.workflowRunId}:${input.changeSetId}:${input.revision}:${input.checksum}`
        ),
        expectedRunRevision: 0,
        changeSetId: input.changeSetId,
        revision: input.revision,
        checksum: input.checksum,
        decision: "apply_selected"
      });
      if (!approvalResult.ok) return approvalResult;
      if (!isChangeSetApproval(approvalResult.value)) {
        return err(applicationError(
          "STORY_ANALYSIS_CHANGE_SET_APPROVAL_INVALID",
          "The Change Set did not produce a human approval binding."
        ));
      }

      const applyBatchId = stableId(
        "apply",
        `${input.changeSetId}:${input.revision}:${input.checksum}:${
          approvalResult.value.binding.selectionChecksum ?? ""
        }`
      );
      const batch = await options.versionGroups.applyApprovedBatch({
        changeSet: changeSet.value,
        approval: approvalResult.value,
        applyBatchId,
        storyBibleSuggestionIdsByGroup: selected.value.byGroup
      });
      if (!batch.ok) return batch;

      const resultByGroup = new Map(
        batch.value.groups.map((group) => [group.consistencyGroupId, group] as const)
      );
      if ([...selected.value.groupIds].some((groupId) => !resultByGroup.has(groupId))) {
        return err(applicationError(
          "STORY_ANALYSIS_APPLY_RESULT_INVALID",
          "The Version Group batch omitted a selected consistency group."
        ));
      }
      const transitions: {
        readonly recordId: string;
        readonly expectedRevision: number;
        readonly transition: StoryAnalysisRecordTransition;
      }[] = selected.value.suggestions.flatMap((suggestion) => {
        if (suggestion.status === "applied") return [];
        return [{
          recordId: suggestion.suggestionId,
          expectedRevision: suggestion.revision,
          transition: {
            status:
              resultByGroup.get(suggestion.consistencyGroupId)?.status === "applied"
                ? "applied"
                : "failed"
          }
        }];
      });
      const analysis =
        transitions.length === 0
          ? refreshed
          : await options.analysis.transitionRecords({
              workflowRunId: input.workflowRunId,
              transitions
            });
      if (!analysis.ok) return analysis;
      return ok({ schemaVersion: "1.0", analysis: analysis.value, batch: batch.value });
    }
  };
}

function validateSuggestionIds(
  values: readonly string[]
): Result<readonly string[], UnifiedError> {
  if (
    values.length === 0 ||
    values.length > MAX_SELECTED_SUGGESTIONS ||
    values.some((value) => !/^sug_[A-Za-z0-9_-]{1,128}$/u.test(value)) ||
    new Set(values).size !== values.length
  ) {
    return err(applicationError(
      "STORY_ANALYSIS_SUGGESTION_SELECTION_INVALID",
      "Select one or more unique Story Analysis suggestions."
    ));
  }
  return ok([...values]);
}

function selectCompleteGroups(
  record: StoryAnalysisHistoryRecord,
  suggestionIds: readonly string[],
  allowedStatuses: ReadonlySet<StoryChangeSuggestion["status"]>
): Result<{
  readonly suggestions: readonly StoryChangeSuggestion[];
  readonly groupIds: ReadonlySet<string>;
  readonly byGroup: Readonly<Record<string, readonly string[]>>;
}, UnifiedError> {
  const suggestions = record.storyAnalysis.records.filter(
    (candidate): candidate is StoryChangeSuggestion => candidate.recordType === "change"
  );
  const byId = new Map(suggestions.map((suggestion) => [suggestion.suggestionId, suggestion]));
  const requested = suggestionIds.map((suggestionId) => byId.get(suggestionId));
  if (requested.some((suggestion) => suggestion === undefined)) {
    return err(applicationError(
      "STORY_ANALYSIS_SUGGESTION_NOT_FOUND",
      "A selected Story Analysis suggestion no longer exists."
    ));
  }
  const groupIds = new Set(
    requested.map((suggestion) => (suggestion as StoryChangeSuggestion).consistencyGroupId)
  );
  const selected = suggestions
    .filter((suggestion) => groupIds.has(suggestion.consistencyGroupId))
    .sort((left, right) => left.suggestionId.localeCompare(right.suggestionId, "en"));
  if (selected.some((suggestion) => !allowedStatuses.has(suggestion.status))) {
    return err(applicationError(
      "STORY_ANALYSIS_SUGGESTION_NOT_APPLICABLE",
      "A selected consistency group contains a rejected, stale, failed, or otherwise unavailable suggestion."
    ));
  }
  const byGroup: Record<string, readonly string[]> = {};
  for (const groupId of [...groupIds].sort()) {
    byGroup[groupId] = selected
      .filter((suggestion) => suggestion.consistencyGroupId === groupId)
      .map((suggestion) => suggestion.suggestionId);
  }
  return ok({ suggestions: selected, groupIds, byGroup });
}

function validateChangeSetGroups(
  changeSet: ChangeSet,
  suggestionIdsByGroup: Readonly<Record<string, readonly string[]>>
): Result<void, UnifiedError> {
  const groups = inspectChangeSetConsistencyGroups(changeSet);
  const expected = Object.keys(suggestionIdsByGroup).sort();
  if (
    groups.splitGroupIds.length > 0 ||
    groups.selectedGroupIds.length !== expected.length ||
    groups.selectedGroupIds.some((groupId, index) => groupId !== expected[index])
  ) {
    return err(applicationError(
      "STORY_ANALYSIS_CHANGE_SET_GROUP_MISMATCH",
      "The Change Set does not contain exactly the selected Story Analysis consistency groups."
    ));
  }
  return ok(undefined);
}

function isChangeSetApproval(value: ChangeSet | ChangeSetApproval): value is ChangeSetApproval {
  return "approvalSource" in value && "binding" in value;
}

function stableId(prefix: string, seed: string): string {
  return `${prefix}_${createHash("sha256").update(seed, "utf8").digest("hex").slice(0, 32)}`;
}

function applicationError(code: string, message: string): UnifiedError {
  return createUnifiedError({
    code,
    category: "ValidationError",
    message,
    recoverability: "user-action",
    suggestedAction: "Refresh the Story Analysis review queue and prepare the selection again.",
    traceId: TRACE_ID
  });
}
