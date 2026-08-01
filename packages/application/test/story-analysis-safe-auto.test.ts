import { describe, expect, test } from "vitest";

import type { StoryChangeSuggestion, StoryReviewIssue } from "@novel-studio/schemas";

import {
  selectSafeStoryAnalysisSuggestionIds,
  type StoryAnalysisHistoryRecord
} from "../src/index.js";

const CHAPTER_CHECKSUM = "1".repeat(64);
const ASSET_ID = `chr_${"a".repeat(32)}`;

describe("Story Analysis safe automatic update policy", () => {
  test("selects a complete high-confidence narrator-asserted patch group", () => {
    const first = suggestion(`sug_${"a".repeat(32)}`, "/details/currentState/physical");
    const second = suggestion(`sug_${"b".repeat(32)}`, "/details/currentState/emotional");

    expect(selectSafeStoryAnalysisSuggestionIds(history([first, second]))).toEqual([
      first.suggestionId,
      second.suggestionId
    ]);
  });

  test("defers the whole consistency group when one suggestion is unsafe", () => {
    const safe = suggestion(`sug_${"a".repeat(32)}`, "/details/currentState/locationId");
    const unsafe = {
      ...suggestion(`sug_${"b".repeat(32)}`, "/relations"),
      domain: "character.relationship" as const
    };

    expect(selectSafeStoryAnalysisSuggestionIds(history([safe, unsafe]))).toEqual([]);
  });

  test.each([
    ["low confidence", { confidence: 0.94 }],
    ["non-objective evidence", { epistemicStatus: "dialogue_claim" as const }],
    ["remove operation", { operations: [{ op: "remove" as const, path: "/details/state" }] }],
    ["create action", { action: "create" as const, target: null }],
    ["sensitive path", { operations: [{ op: "replace" as const, path: "/summary" }] }]
  ])("defers %s", (_label, override) => {
    const candidate = {
      ...suggestion(`sug_${"c".repeat(32)}`, "/details/state"),
      ...override
    } as StoryChangeSuggestion;
    expect(selectSafeStoryAnalysisSuggestionIds(history([candidate]))).toEqual([]);
  });

  test("defers a target with an open review issue", () => {
    const candidate = suggestion(`sug_${"d".repeat(32)}`, "/details/currentState/emotional");
    const issue = {
      schemaVersion: "1.1",
      issueId: `issue_${"a".repeat(32)}`,
      recordType: "review_issue",
      revision: 1,
      createdAt: "2026-08-02T00:00:00.000Z",
      updatedAt: "2026-08-02T00:00:00.000Z",
      analysisRunId: `run_${"a".repeat(32)}`,
      chapter: { chapterId: "ch_01", checksum: CHAPTER_CHECKSUM },
      issueType: "conflict",
      status: "open",
      claims: [],
      affectedRefs: [`story_bible:${ASSET_ID}`],
      dependencies: [],
      idempotencyKey: "idem_issue_open",
      resolution: null,
      dismissalReason: null,
      supersededByIssueId: null
    } satisfies StoryReviewIssue;

    expect(selectSafeStoryAnalysisSuggestionIds(history([candidate, issue]))).toEqual([]);
  });

  test("defers a legacy target that still requires an author-reviewed v1.1 upgrade", () => {
    const current = suggestion(`sug_${"e".repeat(32)}`, "/details/currentState/locationId");
    const legacy = {
      ...current,
      target: current.target === null ? null : { ...current.target, baseRevision: 0 }
    } satisfies StoryChangeSuggestion;

    expect(selectSafeStoryAnalysisSuggestionIds(history([legacy]))).toEqual([]);
  });

  test.each([
    "/details/stateHistory",
    "/details/events",
    "/details/knowledgeStates",
    "/details/milestones",
    "/deviations"
  ])("defers whole-collection replacement at %s without an append-only proof", (path) => {
    const candidate = {
      ...suggestion(`sug_${"f".repeat(32)}`, path),
      operations: [
        {
          op: "replace" as const,
          path,
          beforeValueChecksum: "3".repeat(64),
          value: []
        }
      ]
    } satisfies StoryChangeSuggestion;

    expect(selectSafeStoryAnalysisSuggestionIds(history([candidate]))).toEqual([]);
  });
});

function suggestion(suggestionId: string, path: string): StoryChangeSuggestion {
  return {
    schemaVersion: "1.1",
    deltaId: `delta_${suggestionId.slice(4)}`,
    suggestionId,
    recordType: "change",
    status: "pending",
    revision: 1,
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
    analysisRunId: `run_${"a".repeat(32)}`,
    observationIds: [`obs_${"a".repeat(32)}`],
    chapter: { chapterId: "ch_01", checksum: CHAPTER_CHECKSUM },
    domain: "character.physical_state",
    action: "patch",
    target: { assetId: ASSET_ID, baseRevision: 1, entryRef: null },
    proposedAssetType: null,
    proposedAssetId: null,
    createValue: null,
    dependencies: [
      { kind: "chapter", chapterId: "ch_01", checksum: CHAPTER_CHECKSUM },
      {
        kind: "asset_fields",
        assetId: ASSET_ID,
        baseRevision: 1,
        selectors: [path],
        valueChecksum: "2".repeat(64)
      }
    ],
    consistencyGroupId: "cgrp_safe",
    operations: [{ op: "replace", path, beforeValueChecksum: "3".repeat(64), value: "next" }],
    evidence: [{ start: 0, end: 4, excerptHash: "4".repeat(64) }],
    epistemicStatus: "narrator_asserted",
    confidence: 0.99,
    reason: "Explicit chapter evidence.",
    idempotencyKey: `idem_${suggestionId}`
  };
}

function history(
  records: readonly (StoryChangeSuggestion | StoryReviewIssue)[]
): StoryAnalysisHistoryRecord {
  return {
    workflowRun: {
      workflowRunId: `wfrun_${"a".repeat(32)}`
    } as StoryAnalysisHistoryRecord["workflowRun"],
    storyAnalysis: {
      analysisRun: { status: "completed" },
      records
    } as StoryAnalysisHistoryRecord["storyAnalysis"],
    checksum: "5".repeat(64)
  };
}
