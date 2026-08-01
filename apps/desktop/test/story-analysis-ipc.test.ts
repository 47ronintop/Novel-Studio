import { describe, expect, test, vi } from "vitest";

import type {
  DesktopApplication,
  StoryAnalysisApplicationPreview,
  StoryAnalysisApplicationResult,
  StoryAnalysisHistoryRecord,
  StoryAnalysisHistorySummary
} from "@novel-studio/application";
import { createUnifiedError, err, ok } from "@novel-studio/shared";

import { createApplicationIpcHandlers } from "../src/main/ipc-handlers.js";
import { createNovelStudioApi } from "../src/preload/api.js";

const identity = "a".repeat(32);
const workflowRunId = `wfrun_story_${identity}`;
const analysisRunId = `run_${identity}`;
const checksum = "f".repeat(64);
const suggestionId = `sug_${"b".repeat(32)}`;
const changeSetId = `change_set_${"d".repeat(32)}`;
const now = "2026-07-31T00:00:00.000Z";

describe("Story Analysis IPC", () => {
  test("exposes the bounded Story Analysis API through preload", async () => {
    const calls: Array<{ readonly channel: string; readonly args: readonly unknown[] }> = [];
    const api = createNovelStudioApi({
      async invoke(channel, ...args) {
        calls.push({ channel, args });
        return ok(undefined);
      }
    });

    await api.storyAnalysis.analyzeChapter({ chapterId: "ch_opening" });
    await api.storyAnalysis.list();
    await api.storyAnalysis.read(workflowRunId);
    await api.storyAnalysis.transitionRecord({
      workflowRunId,
      recordId: `sug_${"b".repeat(32)}`,
      expectedRevision: 2,
      transition: { status: "accepted" }
    });
    await api.storyAnalysis.refreshStaleness(workflowRunId);
    await api.storyAnalysis.prepareApplication({
      workflowRunId,
      suggestionIds: [suggestionId]
    });
    await api.storyAnalysis.applyApplication({
      workflowRunId,
      suggestionIds: [suggestionId],
      changeSetId,
      revision: 1,
      checksum
    });

    expect(calls).toEqual([
      {
        channel: "application:story-analysis:analyze",
        args: [{ chapterId: "ch_opening" }]
      },
      { channel: "application:story-analysis:list", args: [] },
      { channel: "application:story-analysis:read", args: [workflowRunId] },
      {
        channel: "application:story-analysis:transition",
        args: [
          {
            workflowRunId,
            recordId: `sug_${"b".repeat(32)}`,
            expectedRevision: 2,
            transition: { status: "accepted" }
          }
        ]
      },
      {
        channel: "application:story-analysis:refresh-staleness",
        args: [workflowRunId]
      },
      {
        channel: "application:story-analysis:prepare-application",
        args: [{ workflowRunId, suggestionIds: [suggestionId] }]
      },
      {
        channel: "application:story-analysis:apply-application",
        args: [{ workflowRunId, suggestionIds: [suggestionId], changeSetId, revision: 1, checksum }]
      }
    ]);
  });

  test("projects prepared and applied Story Analysis batches without internal workflow data", async () => {
    const prepareStoryAnalysisApplication = vi.fn<
      DesktopApplication["prepareStoryAnalysisApplication"]
    >(async () => ok(applicationPreview()));
    const applyStoryAnalysisApplication = vi.fn<
      DesktopApplication["applyStoryAnalysisApplication"]
    >(async () => ok(applicationResult()));
    const handlers = createApplicationIpcHandlers(
      applicationWith({ prepareStoryAnalysisApplication, applyStoryAnalysisApplication })
    );

    const preview = await handlers["application:story-analysis:prepare-application"]({
      workflowRunId,
      suggestionIds: [suggestionId]
    });
    const applied = await handlers["application:story-analysis:apply-application"]({
      workflowRunId,
      suggestionIds: [suggestionId],
      changeSetId,
      revision: 1,
      checksum
    });

    expect(preview).toMatchObject({
      ok: true,
      value: {
        analysis: { workflowRunId },
        changeSet: { changeSetId },
        suggestionIdsByGroup: { cgrp_location: [suggestionId] }
      }
    });
    expect(applied).toMatchObject({
      ok: true,
      value: {
        analysis: { workflowRunId },
        batch: { applyBatchId: `apply_${"e".repeat(32)}` }
      }
    });
    expect(JSON.stringify(preview)).not.toContain('"workflowRun"');
    expect(JSON.stringify(applied)).not.toContain('"workflowRun"');
  });

  test("rejects malformed Story Analysis application commands before Main calls the service", async () => {
    const prepareStoryAnalysisApplication = vi.fn<
      DesktopApplication["prepareStoryAnalysisApplication"]
    >();
    const applyStoryAnalysisApplication = vi.fn<
      DesktopApplication["applyStoryAnalysisApplication"]
    >();
    const handlers = createApplicationIpcHandlers(
      applicationWith({ prepareStoryAnalysisApplication, applyStoryAnalysisApplication })
    );

    const split = await handlers["application:story-analysis:prepare-application"]({
      workflowRunId,
      suggestionIds: [suggestionId, suggestionId]
    });
    const forged = await handlers["application:story-analysis:apply-application"]({
      workflowRunId,
      suggestionIds: [suggestionId],
      changeSetId,
      revision: 0,
      checksum,
      applyBatchId: "renderer-forged"
    });

    expect(split).toMatchObject({ ok: false, error: { code: "STORY_ANALYSIS_IPC_INPUT_INVALID" } });
    expect(forged).toMatchObject({ ok: false, error: { code: "STORY_ANALYSIS_IPC_INPUT_INVALID" } });
    expect(prepareStoryAnalysisApplication).not.toHaveBeenCalled();
    expect(applyStoryAnalysisApplication).not.toHaveBeenCalled();
  });

  test("maps renderer analysis to the manual trigger and projects a safe DTO", async () => {
    const analyzeChapterStory = vi.fn<DesktopApplication["analyzeChapterStory"]>(async () =>
      ok(historyRecord())
    );
    const handlers = createApplicationIpcHandlers(
      applicationWith({ analyzeChapterStory })
    );

    const result = await handlers["application:story-analysis:analyze"]({
      chapterId: "ch_opening"
    });

    expect(analyzeChapterStory).toHaveBeenCalledWith({
      chapterId: "ch_opening",
      trigger: "manual"
    });
    expect(result).toEqual(
      ok({
        workflowRunId,
        workflowStatus: "pending-confirmation",
        updatedAt: now,
        checksum,
        storyAnalysis: historyRecord().storyAnalysis
      })
    );
    expect(result).not.toHaveProperty("value.workflowRun");
  });

  test("rejects malformed analysis and internal-only record transitions", async () => {
    const analyzeChapterStory = vi.fn<DesktopApplication["analyzeChapterStory"]>(async () =>
      ok(historyRecord())
    );
    const transitionStoryAnalysisRecord = vi.fn<
      DesktopApplication["transitionStoryAnalysisRecord"]
    >(async () => ok(historyRecord()));
    const handlers = createApplicationIpcHandlers(
      applicationWith({ analyzeChapterStory, transitionStoryAnalysisRecord })
    );

    const invalidAnalyze = await handlers["application:story-analysis:analyze"]({
      chapterId: "ch_opening",
      trigger: "chapter_completed"
    });
    const invalidTransition = await handlers["application:story-analysis:transition"]({
      workflowRunId,
      recordId: `sug_${"b".repeat(32)}`,
      expectedRevision: 1,
      transition: { status: "applied" }
    });
    const forgedActor = await handlers["application:story-analysis:transition"]({
      workflowRunId,
      recordId: `issue_${"c".repeat(32)}`,
      expectedRevision: 1,
      transition: { status: "resolved", decision: "Keep the existing fact.", actor: "system" }
    });

    expect(invalidAnalyze).toMatchObject({
      ok: false,
      error: { code: "STORY_ANALYSIS_IPC_INPUT_INVALID" }
    });
    expect(invalidTransition).toMatchObject({
      ok: false,
      error: { code: "STORY_ANALYSIS_IPC_INPUT_INVALID" }
    });
    expect(forgedActor).toMatchObject({
      ok: false,
      error: { code: "STORY_ANALYSIS_IPC_INPUT_INVALID" }
    });
    expect(analyzeChapterStory).not.toHaveBeenCalled();
    expect(transitionStoryAnalysisRecord).not.toHaveBeenCalled();
  });

  test("forces author issue resolution metadata in Main", async () => {
    const transitionStoryAnalysisRecord = vi.fn<
      DesktopApplication["transitionStoryAnalysisRecord"]
    >(async () => ok(historyRecord()));
    const handlers = createApplicationIpcHandlers(
      applicationWith({ transitionStoryAnalysisRecord })
    );

    await handlers["application:story-analysis:transition"]({
      workflowRunId,
      recordId: `issue_${"c".repeat(32)}`,
      expectedRevision: 3,
      transition: { status: "resolved", decision: "Keep the existing fact." }
    });

    expect(transitionStoryAnalysisRecord).toHaveBeenCalledWith({
      workflowRunId,
      recordId: `issue_${"c".repeat(32)}`,
      expectedRevision: 3,
      transition: {
        status: "resolved",
        decision: "Keep the existing fact.",
        changeSetId: null,
        actor: "author"
      }
    });
  });

  test("validates list and record output before crossing the IPC boundary", async () => {
    const validSummary = historySummary();
    const handlers = createApplicationIpcHandlers(
      applicationWith({
        listStoryAnalyses: async () => ok([validSummary]),
        readStoryAnalysis: async () =>
          ok({
            ...historyRecord(),
            storyAnalysis: {
              ...historyRecord().storyAnalysis,
              unsafeInternalField: "must not cross IPC"
            }
          } as unknown as StoryAnalysisHistoryRecord)
      })
    );

    await expect(handlers["application:story-analysis:list"]()).resolves.toEqual(
      ok([validSummary])
    );
    await expect(
      handlers["application:story-analysis:read"](workflowRunId)
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "STORY_ANALYSIS_IPC_RESULT_INVALID" }
    });
  });

  test("redacts application error details", async () => {
    const handlers = createApplicationIpcHandlers(
      applicationWith({
        readStoryAnalysis: async () =>
          err(
            createUnifiedError({
              code: "STORY_ANALYSIS_RECORD_NOT_FOUND",
              category: "StorageError",
              message: "Missing at D:\\private-project\\history\\secret.json",
              recoverability: "user-action",
              suggestedAction: "Open D:\\private-project.",
              traceId: "private-trace",
              redactedDetail: { path: "D:\\private-project\\history\\secret.json" }
            })
          )
      })
    );

    const result = await handlers["application:story-analysis:read"](workflowRunId);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "STORY_ANALYSIS_RECORD_NOT_FOUND",
        traceId: "desktop-story-analysis-ipc"
      }
    });
    expect(JSON.stringify(result)).not.toContain("private-project");
    expect(JSON.stringify(result)).not.toContain("private-trace");
  });
});

function applicationWith(overrides: Partial<DesktopApplication>): DesktopApplication {
  return overrides as DesktopApplication;
}

function historyRecord(): StoryAnalysisHistoryRecord {
  const storyAnalysis: StoryAnalysisHistoryRecord["storyAnalysis"] = {
    schemaVersion: "1.1",
    analysisRun: {
      schemaVersion: "1.1",
      analysisRunId,
      trigger: "manual",
      createdAt: now,
      startedAt: now,
      completedAt: now,
      chapter: { chapterId: "ch_opening", checksum: "1".repeat(64) },
      contextSnapshot: {
        contextSnapshotId: `ctx_${identity}`,
        checksum: "2".repeat(64)
      },
      recalledAssets: [],
      runtime: {
        providerId: "openai-compatible",
        modelId: "story-model",
        promptVersion: "story-observer-v1",
        promptChecksum: "3".repeat(64),
        extractorVersion: "story-fact-router-v1"
      },
      validation: {
        observationCount: 0,
        acceptedCount: 0,
        rejectedCount: 0,
        errors: []
      },
      usage: {
        usageRecordId: null,
        inputTokens: 10,
        outputTokens: 2,
        estimatedCost: null
      },
      status: "completed",
      failure: null
    },
    observations: [],
    factDeltas: [],
    records: []
  };
  return {
    workflowRun: {
      schemaVersion: "1.0",
      workflowRunId,
      workflowId: "wf_story_analysis",
      workflowTitle: "Story Analysis",
      status: "pending-confirmation",
      startedAt: now,
      updatedAt: now,
      context: { sourceCount: 1, tokenEstimate: 10, selectionReason: "Saved chapter." },
      model: {
        profileId: "model_default",
        displayName: "Default",
        provider: "openai-compatible",
        modelName: "story-model"
      },
      usage: {
        inputTokens: 10,
        outputTokens: 2,
        totalTokens: 12,
        usageStatus: "estimated",
        cost: { amount: 0, currency: "USD", status: "estimated" }
      },
      steps: [
        { stepId: "build_context", label: "Build context", kind: "context", status: "completed" },
        { stepId: "observe_story", label: "Observe", kind: "agent", status: "completed" },
        {
          stepId: "review_story_changes",
          label: "Review",
          kind: "confirmation",
          status: "waiting-confirmation"
        }
      ],
      storyAnalysis: storyAnalysis as unknown as import("@novel-studio/shared").JsonObject
    },
    storyAnalysis,
    checksum
  };
}

function historySummary(): StoryAnalysisHistorySummary {
  return {
    workflowRunId,
    analysisRunId,
    chapterId: "ch_opening",
    status: "completed",
    updatedAt: now,
    pendingSuggestionCount: 0,
    openIssueCount: 0,
    checksum
  };
}

function applicationPreview(): StoryAnalysisApplicationPreview {
  return {
    schemaVersion: "1.0",
    analysis: historyRecord(),
    changeSet: storyChangeSet(),
    suggestionIdsByGroup: { cgrp_location: [suggestionId] }
  };
}

function applicationResult(): StoryAnalysisApplicationResult {
  return {
    schemaVersion: "1.0",
    analysis: historyRecord(),
    batch: {
      schemaVersion: "1.0",
      applyBatchId: `apply_${"e".repeat(32)}`,
      changeSetId,
      selectionChecksum: "a".repeat(64),
      groups: [{ consistencyGroupId: "cgrp_location", status: "applied" }]
    }
  };
}

function storyChangeSet() {
  return {
    schemaVersion: "1.1" as const,
    changeSetId,
    revision: 1,
    runId: workflowRunId,
    projectId: "project-01",
    checkpointId: "checkpoint-analysis",
    contextSnapshotId: `ctx_${identity}`,
    writePolicy: "write_before_confirmation" as const,
    status: "awaiting_approval" as const,
    checksum,
    approvalToken: "a".repeat(64),
    files: [],
    createdAt: now
  };
}
