import { describe, expect, test, vi } from "vitest";

import type { ChangeSet, ChangeSetApproval } from "@novel-studio/agent-engine";
import type { StoryChangeSuggestion } from "@novel-studio/schemas";
import { ok } from "@novel-studio/shared";

import {
  createStoryAnalysisApplicationSession,
  type StoryAnalysisHistoryRecord,
  type StoryAnalysisRecordTransition,
  type StoryAnalysisSession
} from "../src/index.js";

const workflowRunId = `wfrun_story_${"a".repeat(32)}`;
const firstSuggestionId = `sug_${"b".repeat(32)}`;
const secondSuggestionId = `sug_${"c".repeat(32)}`;
const thirdSuggestionId = `sug_${"d".repeat(32)}`;

describe("Story Analysis application session", () => {
  test("expands a selected suggestion to its whole consistency group before preparing a Change Set", async () => {
    const analysis = memoryAnalysis([
      suggestion(firstSuggestionId, "cgrp_location", "pending"),
      suggestion(secondSuggestionId, "cgrp_location", "pending")
    ]);
    const prepareChangeSet = vi.fn(
      async (input: { readonly suggestions: readonly StoryChangeSuggestion[] }) =>
        ok(changeSet(input.suggestions.map((item) => item.consistencyGroupId)))
    );
    const session = createStoryAnalysisApplicationSession({
      analysis,
      preparation: { prepareChangeSet },
      changeSets: unusedChangeSets(),
      versionGroups: unusedVersionGroups()
    });

    const result = await session.prepareApplication({
      workflowRunId,
      suggestionIds: [firstSuggestionId]
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        suggestionIdsByGroup: {
          cgrp_location: [firstSuggestionId, secondSuggestionId]
        }
      }
    });
    expect(prepareChangeSet).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestions: expect.arrayContaining([
          expect.objectContaining({ suggestionId: firstSuggestionId, status: "accepted" }),
          expect.objectContaining({ suggestionId: secondSuggestionId, status: "accepted" })
        ])
      })
    );
  });

  test("blocks stale, rejected, or failed consistency groups before proposal preparation", async () => {
    const analysis = memoryAnalysis([
      suggestion(firstSuggestionId, "cgrp_location", "stale"),
      suggestion(secondSuggestionId, "cgrp_location", "pending")
    ]);
    const prepareChangeSet = vi.fn();
    const session = createStoryAnalysisApplicationSession({
      analysis,
      preparation: { prepareChangeSet },
      changeSets: unusedChangeSets(),
      versionGroups: unusedVersionGroups()
    });

    const result = await session.prepareApplication({
      workflowRunId,
      suggestionIds: [secondSuggestionId]
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "STORY_ANALYSIS_SUGGESTION_NOT_APPLICABLE" }
    });
    expect(prepareChangeSet).not.toHaveBeenCalled();
  });

  test("applies groups once and writes applied or failed status from each Version Group result", async () => {
    const analysis = memoryAnalysis([
      suggestion(firstSuggestionId, "cgrp_location", "accepted"),
      suggestion(secondSuggestionId, "cgrp_location", "accepted"),
      suggestion(thirdSuggestionId, "cgrp_timeline", "accepted")
    ]);
    const currentChangeSet = changeSet(["cgrp_location", "cgrp_timeline"]);
    const applyApprovedBatch = vi.fn(async (input) =>
      ok({
        schemaVersion: "1.0" as const,
        applyBatchId: input.applyBatchId,
        changeSetId: currentChangeSet.changeSetId,
        selectionChecksum: "e".repeat(64),
        groups: [
          { consistencyGroupId: "cgrp_location", status: "applied" as const },
          { consistencyGroupId: "cgrp_timeline", status: "rolled_back" as const }
        ]
      })
    );
    const session = createStoryAnalysisApplicationSession({
      analysis,
      preparation: { prepareChangeSet: vi.fn() },
      changeSets: {
        readChangeSet: async () => ok(currentChangeSet),
        decide: async () => ok(approvalFor(currentChangeSet))
      },
      versionGroups: { applyApprovedBatch }
    });

    const result = await session.applyApplication({
      workflowRunId,
      suggestionIds: [firstSuggestionId, thirdSuggestionId],
      changeSetId: currentChangeSet.changeSetId,
      revision: currentChangeSet.revision,
      checksum: currentChangeSet.checksum
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        analysis: {
          storyAnalysis: {
            records: expect.arrayContaining([
              expect.objectContaining({ suggestionId: firstSuggestionId, status: "applied" }),
              expect.objectContaining({ suggestionId: secondSuggestionId, status: "applied" }),
              expect.objectContaining({ suggestionId: thirdSuggestionId, status: "failed" })
            ])
          }
        }
      }
    });
    expect(applyApprovedBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        storyBibleSuggestionIdsByGroup: {
          cgrp_location: [firstSuggestionId, secondSuggestionId],
          cgrp_timeline: [thirdSuggestionId]
        }
      })
    );
  });
});

function memoryAnalysis(
  initial: readonly StoryChangeSuggestion[]
): Pick<StoryAnalysisSession, "refreshStaleness" | "transitionRecords"> {
  let current = historyRecord(initial);
  return {
    async refreshStaleness() {
      return ok(current);
    },
    async transitionRecords(input) {
      const transitions = new Map(input.transitions.map((item) => [item.recordId, item]));
      current = historyRecord(
        current.storyAnalysis.records.map((record) => {
          if (record.recordType !== "change") return record;
          const command = transitions.get(record.suggestionId);
          if (command === undefined) return record;
          return {
            ...record,
            status: suggestionStatus(command.transition),
            revision: record.revision + 1
          };
        }) as StoryChangeSuggestion[]
      );
      return ok(current);
    }
  };
}

function suggestion(
  suggestionId: string,
  consistencyGroupId: string,
  status: StoryChangeSuggestion["status"]
): StoryChangeSuggestion {
  return {
    schemaVersion: "1.1",
    deltaId: `delta_${suggestionId.slice(4)}`,
    suggestionId,
    recordType: "change",
    status,
    revision: 1,
    createdAt: "2026-07-31T00:00:00.000Z",
    updatedAt: "2026-07-31T00:00:00.000Z",
    analysisRunId: `run_${"a".repeat(32)}`,
    observationIds: [],
    chapter: { chapterId: "ch_01", checksum: "1".repeat(64) },
    domain: "character.location",
    action: "patch",
    target: { assetId: `chr_${"f".repeat(32)}`, baseRevision: 1, entryRef: null },
    proposedAssetType: null,
    proposedAssetId: null,
    createValue: null,
    dependencies: [],
    consistencyGroupId,
    operations: [],
    evidence: [],
    epistemicStatus: "narrator_asserted",
    confidence: 1,
    reason: "test",
    idempotencyKey: `idem_${suggestionId}`
  };
}

function historyRecord(records: readonly StoryChangeSuggestion[]): StoryAnalysisHistoryRecord {
  return {
    workflowRun: {
      workflowRunId,
      status: "pending-confirmation",
      updatedAt: "2026-07-31T00:00:00.000Z"
    } as StoryAnalysisHistoryRecord["workflowRun"],
    storyAnalysis: {
      schemaVersion: "1.1",
      analysisRun: {
        analysisRunId: `run_${"a".repeat(32)}`,
        contextSnapshot: { contextSnapshotId: `ctx_${"a".repeat(32)}` }
      },
      records
    } as StoryAnalysisHistoryRecord["storyAnalysis"],
    checksum: "a".repeat(64)
  };
}

function changeSet(groupIds: readonly string[]): ChangeSet {
  const uniqueGroups = [...new Set(groupIds)].sort();
  return {
    schemaVersion: "1.1",
    changeSetId: `change_set_${"a".repeat(32)}`,
    revision: 1,
    runId: workflowRunId,
    projectId: "project-01",
    checkpointId: "checkpoint-analysis",
    contextSnapshotId: `ctx_${"a".repeat(32)}`,
    writePolicy: "write_before_confirmation",
    status: "awaiting_approval",
    checksum: "c".repeat(64),
    approvalToken: "d".repeat(64),
    files: uniqueGroups.map((consistencyGroupId, index) => ({
      relativePath: `characters/chr_${index}.json`,
      assetType: "text" as const,
      assetId: `chr_${index}`,
      baseChecksum: "1".repeat(64),
      candidateChecksum: "2".repeat(64),
      baseContent: "{}",
      candidateContent: "{}",
      hunks: [],
      validation: {
        valid: true,
        utf8: { status: "valid" },
        syntax: { status: "not_applicable" },
        schema: { status: "valid" },
        asset: { status: "valid" }
      },
      selected: true,
      consistencyGroupId
    })),
    createdAt: "2026-07-31T00:00:00.000Z"
  };
}

function approvalFor(changeSetValue: ChangeSet): ChangeSetApproval {
  return {
    schemaVersion: "1.1",
    decision: "apply_selected",
    approvalSource: "human_confirmation",
    binding: {
      changeSetId: changeSetValue.changeSetId,
      revision: changeSetValue.revision,
      checksum: changeSetValue.checksum,
      approvalToken: changeSetValue.approvalToken,
      selectedConsistencyGroupIds: changeSetValue.files.map((file) =>
        requireValue(file.consistencyGroupId, "Expected a consistency group id.")
      ),
      selectionChecksum: "e".repeat(64)
    },
    resolvedAt: "2026-07-31T00:00:00.000Z"
  };
}

function requireValue<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) throw new Error(message);
  return value;
}

function suggestionStatus(
  transition: StoryAnalysisRecordTransition
): StoryChangeSuggestion["status"] {
  if (
    transition.status === "accepted" ||
    transition.status === "applied" ||
    transition.status === "rejected" ||
    transition.status === "stale" ||
    transition.status === "failed"
  ) {
    return transition.status;
  }
  throw new Error("Unexpected issue transition in suggestion test.");
}

function unusedChangeSets(): StoryAnalysisApplicationParameters["changeSets"] {
  return {
    async readChangeSet() {
      throw new Error("not used");
    },
    async decide() {
      throw new Error("not used");
    }
  };
}

function unusedVersionGroups(): StoryAnalysisApplicationParameters["versionGroups"] {
  return {
    async applyApprovedBatch() {
      throw new Error("not used");
    }
  };
}

type StoryAnalysisApplicationParameters = Parameters<
  typeof createStoryAnalysisApplicationSession
>[0];
