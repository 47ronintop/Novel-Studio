import { describe, expect, test, vi } from "vitest";

import type {
  NovelStudioApi,
  StoryAnalysisRecordDto,
  StoryBibleSnapshot
} from "@novel-studio/application";
import type { StoryChangeSuggestion, StoryReviewIssue } from "@novel-studio/schemas";
import { ok } from "@novel-studio/shared";

import { createStoryAnalysisBridge } from "../src/renderer/story-analysis-bridge.js";

const WORKFLOW_RUN_ID = `wfrun_story_${"1".repeat(32)}`;
const ANALYSIS_RUN_ID = `run_${"2".repeat(32)}`;
const CHARACTER_ID = `chr_${"3".repeat(32)}`;
const GROUP_ID = `cgrp_${"4".repeat(32)}`;
const NOW = "2026-07-31T00:00:00.000Z";

describe("Story Analysis renderer bridge", () => {
  test("selects whole consistency groups and binds accepted suggestions to preview plus apply", async () => {
    let record = analysisRecord([suggestion("a"), suggestion("b")]);
    const transitionRecord = vi.fn(async () => {
      record = analysisRecord(
        record.storyAnalysis.records.map((entry) =>
          entry.recordType === "change"
            ? { ...entry, status: "accepted" as const, revision: entry.revision + 1 }
            : entry
        )
      );
      return ok(record);
    });
    const prepareApplication = vi.fn(async () =>
      ok({
        schemaVersion: "1.0" as const,
        analysis: record,
        changeSet: changeSet(),
        suggestionIdsByGroup: {
          [GROUP_ID]: record.storyAnalysis.records.flatMap((entry) =>
            entry.recordType === "change" ? [entry.suggestionId] : []
          )
        }
      })
    );
    const applyApplication = vi.fn(async () => {
      record = analysisRecord(
        record.storyAnalysis.records.map((entry) =>
          entry.recordType === "change"
            ? { ...entry, status: "applied" as const, revision: entry.revision + 1 }
            : entry
        )
      );
      return ok({
        schemaVersion: "1.0" as const,
        analysis: record,
        batch: {
          schemaVersion: "1.0" as const,
          applyBatchId: `apply_${"5".repeat(32)}`,
          changeSetId: changeSet().changeSetId,
          selectionChecksum: "5".repeat(64),
          groups: [
            {
              consistencyGroupId: GROUP_ID,
              status: "applied" as const,
              versionGroup: { versionGroupId: `vg_${"6".repeat(32)}` },
              storyBibleReceipt: {
                suggestionIds: record.storyAnalysis.records.flatMap((entry) =>
                  entry.recordType === "change" ? [entry.suggestionId] : []
                )
              }
            }
          ]
        }
      });
    });
    const api = apiFor({
      getRecord: () => record,
      transitionRecord,
      prepareApplication,
      applyApplication
    });
    const bridge = createStoryAnalysisBridge(api, {
      getStoryBibleSnapshot: () => storyBibleSnapshot()
    });

    const opened = await bridge.open();
    const firstSuggestion = opened.suggestions[0];
    if (firstSuggestion === undefined) throw new Error("Expected an analysis suggestion");
    const selected = bridge.toggleSuggestion(firstSuggestion.suggestionId);
    const accepted = await bridge.acceptSelected();
    const previewed = await bridge.prepareSelected();
    const applied = await bridge.applyPrepared();

    expect(opened).toMatchObject({ open: true, status: "ready", pendingCount: 2 });
    expect(opened.suggestions[0]).toMatchObject({
      operations: [{ beforePresent: true, beforeValue: "旧摘要" }]
    });
    expect(selected.selectedSuggestionIds).toHaveLength(2);
    expect(transitionRecord).toHaveBeenCalledTimes(1);
    expect(accepted.suggestions.every((entry) => entry.status === "accepted")).toBe(true);
    expect(prepareApplication).toHaveBeenCalledWith({
      workflowRunId: WORKFLOW_RUN_ID,
      suggestionIds: selected.selectedSuggestionIds
    });
    expect(previewed.preview).toMatchObject({
      changeSetId: changeSet().changeSetId,
      files: [{ assetId: CHARACTER_ID, consistencyGroupId: GROUP_ID }]
    });
    expect(applyApplication).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: WORKFLOW_RUN_ID,
        suggestionIds: selected.selectedSuggestionIds,
        checksum: changeSet().checksum
      })
    );
    expect(applied).toMatchObject({
      selectedSuggestionIds: [],
      result: { groups: [{ status: "applied", suggestionIds: selected.selectedSuggestionIds }] }
    });
  });

  test("resolves review issues and persists chapter completion behavior", async () => {
    let record = analysisRecord([issue()]);
    let completionMode = "prompt" as const | "background-review";
    const transitionRecord = vi.fn(async (command) => {
      record = analysisRecord([
        {
          ...issue(),
          status: "resolved" as const,
          revision: 2,
          resolution: {
            decision: command.transition.decision,
            changeSetId: null,
            actor: "author" as const,
            resolvedAt: NOW
          }
        }
      ]);
      return ok(record);
    });
    const saveStoryAnalysisSettings = vi.fn(async (settings) => {
      completionMode = settings.completionMode;
      return ok({ completionMode });
    });
    const api = apiFor({
      getRecord: () => record,
      transitionRecord,
      saveStoryAnalysisSettings
    });
    const bridge = createStoryAnalysisBridge(api);

    await bridge.open();
    const resolved = await bridge.resolveIssue(issue().issueId, "保留作者资料中的既有事实");
    const saved = await bridge.saveCompletionMode("background-review");

    expect(transitionRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        recordId: issue().issueId,
        transition: { status: "resolved", decision: "保留作者资料中的既有事实" }
      })
    );
    expect(resolved.issues[0]?.status).toBe("resolved");
    expect(saveStoryAnalysisSettings).toHaveBeenCalledWith({
      completionMode: "background-review"
    });
    expect(saved.completionMode).toBe("background-review");
  });
});

function apiFor(input: {
  readonly getRecord: () => StoryAnalysisRecordDto;
  readonly transitionRecord?: ReturnType<typeof vi.fn>;
  readonly prepareApplication?: ReturnType<typeof vi.fn>;
  readonly applyApplication?: ReturnType<typeof vi.fn>;
  readonly saveStoryAnalysisSettings?: ReturnType<typeof vi.fn>;
}): NovelStudioApi {
  return {
    storyAnalysis: {
      list: async () => {
        const record = input.getRecord();
        return ok([
          {
            workflowRunId: WORKFLOW_RUN_ID,
            analysisRunId: ANALYSIS_RUN_ID,
            chapterId: "ch_01",
            status: "completed" as const,
            updatedAt: NOW,
            pendingSuggestionCount: record.storyAnalysis.records.filter(
              (entry) => entry.recordType === "change" && entry.status === "pending"
            ).length,
            openIssueCount: record.storyAnalysis.records.filter(
              (entry) => entry.recordType === "review_issue" && entry.status === "open"
            ).length,
            checksum: "a".repeat(64)
          }
        ]);
      },
      read: async () => ok(input.getRecord()),
      transitionRecord: input.transitionRecord ?? vi.fn(async () => ok(input.getRecord())),
      refreshStaleness: async () => ok(input.getRecord()),
      prepareApplication:
        input.prepareApplication ??
        vi.fn(async () => {
          throw new Error("not used");
        }),
      applyApplication:
        input.applyApplication ??
        vi.fn(async () => {
          throw new Error("not used");
        }),
      analyzeChapter: async () => ok(input.getRecord())
    },
    settings: {
      readStoryAnalysisSettings: async () => ok({ completionMode: "prompt" as const }),
      saveStoryAnalysisSettings:
        input.saveStoryAnalysisSettings ?? vi.fn(async (settings) => ok(settings))
    }
  } as unknown as NovelStudioApi;
}

function analysisRecord(
  records: readonly (StoryChangeSuggestion | StoryReviewIssue)[]
): StoryAnalysisRecordDto {
  return {
    workflowRunId: WORKFLOW_RUN_ID,
    workflowStatus: "pending-confirmation",
    updatedAt: NOW,
    checksum: "b".repeat(64),
    storyAnalysis: {
      analysisRun: {
        analysisRunId: ANALYSIS_RUN_ID,
        chapter: { chapterId: "ch_01", checksum: "c".repeat(64) }
      },
      records
    }
  } as StoryAnalysisRecordDto;
}

function suggestion(suffix: string): StoryChangeSuggestion {
  return {
    schemaVersion: "1.1",
    deltaId: `dlt_${suffix.repeat(32)}`,
    suggestionId: `sug_${suffix.repeat(32)}`,
    recordType: "change",
    status: "pending",
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
    analysisRunId: ANALYSIS_RUN_ID,
    observationIds: [`obs_${suffix.repeat(32)}`],
    chapter: { chapterId: "ch_01", checksum: "c".repeat(64) },
    domain: "character.location",
    action: "patch",
    target: { assetId: CHARACTER_ID, baseRevision: 1, entryRef: null },
    proposedAssetType: null,
    proposedAssetId: null,
    createValue: null,
    dependencies: [],
    consistencyGroupId: GROUP_ID,
    operations: [
      {
        op: "replace",
        path: "/summary",
        beforeValueChecksum: "d".repeat(64),
        value: `新摘要 ${suffix}`
      }
    ],
    evidence: [{ start: 1, end: 5, excerptHash: "e".repeat(64) }],
    epistemicStatus: "narrator_asserted",
    confidence: 0.98,
    reason: "正文确认了新状态。",
    idempotencyKey: "f".repeat(64)
  };
}

function issue(): StoryReviewIssue {
  return {
    schemaVersion: "1.1",
    issueId: `issue_${"7".repeat(32)}`,
    recordType: "review_issue",
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
    analysisRunId: ANALYSIS_RUN_ID,
    chapter: { chapterId: "ch_01", checksum: "c".repeat(64) },
    issueType: "conflict",
    status: "open",
    claims: [{ value: "北站", evidence: [{ start: 1, end: 5, excerptHash: "e".repeat(64) }] }],
    affectedRefs: [CHARACTER_ID],
    dependencies: [],
    idempotencyKey: "f".repeat(64),
    resolution: null,
    dismissalReason: null,
    supersededByIssueId: null
  };
}

function changeSet() {
  return {
    schemaVersion: "1.1" as const,
    changeSetId: `change_set_${"8".repeat(32)}`,
    revision: 1,
    runId: WORKFLOW_RUN_ID,
    projectId: "project-01",
    checkpointId: `checkpoint_${"9".repeat(32)}`,
    contextSnapshotId: `ctx_${"a".repeat(32)}`,
    writePolicy: "write_before_confirmation" as const,
    status: "awaiting_approval" as const,
    checksum: "1".repeat(64),
    approvalToken: "2".repeat(64),
    files: [
      {
        relativePath: `characters/${CHARACTER_ID}.json`,
        assetType: "text" as const,
        assetId: CHARACTER_ID,
        baseChecksum: "3".repeat(64),
        candidateChecksum: "4".repeat(64),
        baseContent: "{}",
        candidateContent: "{}",
        hunks: [],
        validation: {
          valid: true,
          utf8: { status: "valid" as const },
          syntax: { status: "not_applicable" as const },
          schema: { status: "valid" as const },
          asset: { status: "valid" as const }
        },
        selected: true,
        consistencyGroupId: GROUP_ID
      }
    ],
    createdAt: NOW
  };
}

function storyBibleSnapshot(): StoryBibleSnapshot {
  return {
    characters: [
      {
        schemaVersion: "1.0",
        id: CHARACTER_ID,
        type: "character",
        title: "林默",
        status: "active",
        summary: "旧摘要",
        aliases: [],
        relatedEntityIds: [],
        details: {},
        createdAt: NOW,
        updatedAt: NOW
      }
    ],
    worldAssets: [],
    outline: undefined,
    foreshadows: [],
    timeline: undefined,
    memories: []
  };
}
