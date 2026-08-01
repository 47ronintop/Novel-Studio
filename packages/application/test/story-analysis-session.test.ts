import { describe, expect, test } from "vitest";
import type { AgentContextSnapshot } from "@novel-studio/agent-engine";
import type { LlmRequest, LlmResponse } from "@novel-studio/llm-adapter";
import {
  createUnifiedError,
  err,
  ok,
  type ChapterDocument,
  type JsonObject,
  type JsonValue
} from "@novel-studio/shared";
import type { Result, UnifiedError } from "@novel-studio/shared";
import type { StoryAnalysisBundle } from "@novel-studio/schemas";
import { transitionStoryAnalysisRecord } from "../src/story-analysis-engine.js";
import {
  createStoryAnalysisSession,
  type StoryAnalysisAsset,
  type StoryAnalysisHistoryPort,
  type StoryAnalysisHistoryRecord,
  type StoryAnalysisHistorySummary,
  type StoryAnalysisUsagePort
} from "../src/story-analysis-session.js";

const INDEX_REVISION = "a".repeat(64);
const CHARACTER_ID = `chr_${"1".repeat(32)}`;
const LOCATION_ID = `loc_${"2".repeat(32)}`;
const UNUSED_LOCATION_ID = `loc_${"3".repeat(32)}`;
const DELETED_OUTLINE_ID = "outline_deleted";
const BODY = "林默到了北站。";

describe("Story Analysis session", () => {
  test("persists context and one Observer call before exposing review suggestions", async () => {
    const history = createMemoryHistory();
    const snapshots: JsonObject[] = [];
    const requests: unknown[] = [];
    const session = createSession({ history, snapshots, requests });

    const result = await session.analyzeChapter({ chapterId: "ch_01", trigger: "manual" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(requests).toHaveLength(1);
    expect(snapshots).toHaveLength(1);
    expect((snapshots[0] as unknown as AgentContextSnapshot).runId).toBe(
      result.value.storyAnalysis.analysisRun.analysisRunId
    );
    expect(history.statusWrites).toEqual(["queued", "running", "completed"]);
    expect(result.value.workflowRun.status).toBe("pending-confirmation");
    expect(result.value.storyAnalysis.records).toEqual([
      expect.objectContaining({
        recordType: "change",
        status: "pending",
        target: expect.objectContaining({ assetId: CHARACTER_ID })
      }),
      expect.objectContaining({
        recordType: "change",
        status: "pending",
        target: expect.objectContaining({ assetId: "timeline_main" })
      })
    ]);
    expect(
      result.value.storyAnalysis.analysisRun.recalledAssets.map((entry) => entry.assetId)
    ).toEqual(expect.arrayContaining([CHARACTER_ID, LOCATION_ID, "outline_main", "timeline_main"]));
    expect(
      result.value.storyAnalysis.analysisRun.recalledAssets.map((entry) => entry.assetId)
    ).not.toContain(UNUSED_LOCATION_ID);

    const requestText = JSON.stringify(requests[0]);
    expect(requestText).toContain("林默");
    expect(requestText).toContain("北站");
    expect(requestText).toContain("world_detail");
    expect(requestText).not.toContain("遥远城堡");
  });

  test("persists a failed analysis run without writing Story Bible state", async () => {
    const history = createMemoryHistory();
    const chapter = savedChapter();
    const original = structuredClone(chapter);
    const session = createSession({
      history,
      snapshots: [],
      requests: [],
      chapter,
      complete: async () =>
        err(
          createUnifiedError({
            code: "LLM_PROVIDER_ERROR",
            category: "ModelProviderError",
            message: "Provider failed.",
            recoverability: "retryable",
            suggestedAction: "Retry.",
            traceId: "test"
          })
        )
    });

    const result = await session.analyzeChapter({
      chapterId: "ch_01",
      trigger: "chapter_completed"
    });

    expect(result).toMatchObject({ ok: false, error: { code: "LLM_PROVIDER_ERROR" } });
    expect(history.statusWrites).toEqual(["queued", "running", "failed"]);
    expect([...history.records.values()][0]?.storyAnalysis.analysisRun).toMatchObject({
      status: "failed",
      failure: { code: "LLM_PROVIDER_ERROR", retryable: true }
    });
    expect(chapter).toEqual(original);
  });

  test("best-effort closes a queued run when the queued-to-running write fails", async () => {
    const baseHistory = createMemoryHistory();
    let runningWriteAttempts = 0;
    const history: ReturnType<typeof createMemoryHistory> = {
      ...baseHistory,
      async writeStoryAnalysis(input) {
        const bundle = input.workflowRun.storyAnalysis as unknown as StoryAnalysisBundle;
        if (bundle.analysisRun.status === "running") {
          runningWriteAttempts += 1;
          return err(testError("STORY_ANALYSIS_RUNNING_WRITE_FAILED"));
        }
        return baseHistory.writeStoryAnalysis(input);
      }
    };
    const session = createSession({ history, snapshots: [], requests: [] });

    const result = await session.analyzeChapter({ chapterId: "ch_01", trigger: "manual" });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "STORY_ANALYSIS_RUNNING_WRITE_FAILED" }
    });
    expect(runningWriteAttempts).toBe(1);
    expect(baseHistory.statusWrites).toEqual(["queued", "failed"]);
    expect([...baseHistory.records.values()][0]?.storyAnalysis.analysisRun).toMatchObject({
      status: "failed",
      failure: { code: "STORY_ANALYSIS_RUNNING_WRITE_FAILED" }
    });
  });

  test("closes a running analysis when prior idempotency history cannot be read", async () => {
    const baseHistory = createMemoryHistory();
    const history: ReturnType<typeof createMemoryHistory> = {
      ...baseHistory,
      async listStoryAnalyses() {
        const current = await baseHistory.listStoryAnalyses();
        if (!current.ok) return current;
        return ok([
          ...current.value,
          {
            workflowRunId: "wfrun_prior",
            analysisRunId: `run_${"f".repeat(32)}`,
            chapterId: "ch_01",
            status: "completed" as const,
            updatedAt: "2026-07-30T00:00:00.000Z",
            pendingSuggestionCount: 0,
            openIssueCount: 0,
            checksum: "f".repeat(64)
          }
        ]);
      },
      async readStoryAnalysis(workflowRunId) {
        return workflowRunId === "wfrun_prior"
          ? err(testError("STORY_ANALYSIS_RECORD_MISSING"))
          : baseHistory.readStoryAnalysis(workflowRunId);
      }
    };
    const usageRecordId = `run_${"a".repeat(32)}:story_observer:1`;
    let usageWrites = 0;
    const session = createSession({
      history,
      snapshots: [],
      requests: [],
      usagePort: {
        async recordUsage() {
          usageWrites += 1;
          return ok(usageRecordId);
        }
      }
    });

    const result = await session.analyzeChapter({ chapterId: "ch_01", trigger: "manual" });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "STORY_ANALYSIS_RECORD_MISSING" }
    });
    expect(history.statusWrites).toEqual(["queued", "running", "failed"]);
    expect([...history.records.values()][0]?.storyAnalysis.analysisRun).toMatchObject({
      status: "failed",
      usage: { usageRecordId, inputTokens: 100, outputTokens: 20 },
      failure: { code: "STORY_ANALYSIS_RECORD_MISSING" }
    });
    expect(usageWrites).toBe(1);
  });

  test("closes a running analysis when usage persistence fails", async () => {
    const history = createMemoryHistory();
    const session = createSession({
      history,
      snapshots: [],
      requests: [],
      usagePort: {
        async recordUsage() {
          return err(testError("AGENT_USAGE_WRITE_FAILED"));
        }
      }
    });

    const result = await session.analyzeChapter({ chapterId: "ch_01", trigger: "manual" });

    expect(result).toMatchObject({ ok: false, error: { code: "AGENT_USAGE_WRITE_FAILED" } });
    expect(history.statusWrites).toEqual(["queued", "running", "failed"]);
    expect([...history.records.values()][0]?.storyAnalysis.analysisRun).toMatchObject({
      status: "failed",
      usage: { usageRecordId: null, inputTokens: 100, outputTokens: 20 },
      failure: { code: "AGENT_USAGE_WRITE_FAILED" }
    });
  });

  test("records usage before malformed Observer JSON and retains its ID on the failed run", async () => {
    const history = createMemoryHistory();
    const usageRecordId = `run_${"a".repeat(32)}:story_observer:1`;
    let usageWrites = 0;
    const session = createSession({
      history,
      snapshots: [],
      requests: [],
      usagePort: {
        async recordUsage() {
          usageWrites += 1;
          return ok(usageRecordId);
        }
      },
      complete: async (request) =>
        ok({
          ...observerResponse(request, []),
          content: { type: "text", value: "{not-json" }
        })
    });

    const result = await session.analyzeChapter({ chapterId: "ch_01", trigger: "manual" });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "STORY_OBSERVER_OUTPUT_INVALID" }
    });
    expect(usageWrites).toBe(1);
    expect(history.statusWrites).toEqual(["queued", "running", "failed"]);
    expect([...history.records.values()][0]?.storyAnalysis.analysisRun).toMatchObject({
      status: "failed",
      usage: { usageRecordId, inputTokens: 100, outputTokens: 20 },
      failure: { code: "STORY_OBSERVER_OUTPUT_INVALID" }
    });
  });

  test("persists a failed run when the final completed history write fails", async () => {
    const baseHistory = createMemoryHistory();
    let completedWriteAttempts = 0;
    const history: ReturnType<typeof createMemoryHistory> = {
      ...baseHistory,
      async writeStoryAnalysis(input) {
        const bundle = input.workflowRun.storyAnalysis as unknown as StoryAnalysisBundle;
        if (bundle.analysisRun.status === "completed") {
          completedWriteAttempts += 1;
          return err(testError("STORY_ANALYSIS_HISTORY_WRITE_FAILED"));
        }
        return baseHistory.writeStoryAnalysis(input);
      }
    };
    const session = createSession({ history, snapshots: [], requests: [] });

    const result = await session.analyzeChapter({ chapterId: "ch_01", trigger: "manual" });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "STORY_ANALYSIS_HISTORY_WRITE_FAILED" }
    });
    expect(completedWriteAttempts).toBe(1);
    expect(history.statusWrites).toEqual(["queued", "running", "failed"]);
    expect([...history.records.values()][0]?.storyAnalysis.analysisRun).toMatchObject({
      status: "failed",
      usage: { usageRecordId: null, inputTokens: 100, outputTokens: 20 },
      failure: { code: "STORY_ANALYSIS_HISTORY_WRITE_FAILED" }
    });
  });

  test("does not overwrite a competing record after the final completed write loses CAS", async () => {
    const baseHistory = createMemoryHistory();
    let competingChecksum: string | undefined;
    const history: ReturnType<typeof createMemoryHistory> = {
      ...baseHistory,
      async writeStoryAnalysis(input) {
        const completedBundle = input.workflowRun.storyAnalysis as unknown as StoryAnalysisBundle;
        if (completedBundle.analysisRun.status === "completed") {
          const current = baseHistory.records.get(input.workflowRun.workflowRunId);
          if (current === undefined) return err(testError("STORY_ANALYSIS_RECORD_MISSING"));
          const competingBundle: StoryAnalysisBundle = {
            ...current.storyAnalysis,
            analysisRun: {
              ...current.storyAnalysis.analysisRun,
              completedAt: "2026-07-31T00:00:04.000Z",
              status: "failed",
              usage: {
                usageRecordId: "competing-usage-record",
                inputTokens: 1,
                outputTokens: 2,
                estimatedCost: null
              },
              failure: {
                code: "COMPETING_WRITER",
                retryable: false,
                reason: "A competing writer closed the run."
              }
            }
          };
          const competing = await baseHistory.writeStoryAnalysis({
            workflowRun: {
              ...current.workflowRun,
              status: "failed",
              updatedAt: "2026-07-31T00:00:04.000Z",
              storyAnalysis: competingBundle as unknown as JsonObject
            },
            expectedChecksum: current.checksum
          });
          if (!competing.ok) return competing;
          competingChecksum = competing.value.checksum;
          return err(testError("STORY_ANALYSIS_CHECKSUM_CONFLICT"));
        }
        return baseHistory.writeStoryAnalysis(input);
      }
    };
    const session = createSession({ history, snapshots: [], requests: [] });

    const result = await session.analyzeChapter({ chapterId: "ch_01", trigger: "manual" });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "STORY_ANALYSIS_CHECKSUM_CONFLICT" }
    });
    const persisted = [...history.records.values()][0];
    expect(persisted?.checksum).toBe(competingChecksum);
    expect(persisted?.storyAnalysis.analysisRun).toMatchObject({
      status: "failed",
      usage: { usageRecordId: "competing-usage-record", inputTokens: 1, outputTokens: 2 },
      failure: { code: "COMPETING_WRITER" }
    });
  });

  test("excludes deleted assets from the catalog and model recall while retaining supported statuses", async () => {
    const requestedStatuses: StoryAnalysisAsset["status"][][] = [];
    const readAssetIds: string[] = [];
    const requests: unknown[] = [];
    const session = createSession({
      history: createMemoryHistory(),
      snapshots: [],
      requests,
      requestedStatuses,
      readAssetIds
    });

    const result = await session.analyzeChapter({ chapterId: "ch_01", trigger: "manual" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(requestedStatuses).toEqual([["active", "draft", "archived"]]);
    expect(readAssetIds).toEqual(
      expect.arrayContaining([CHARACTER_ID, LOCATION_ID, "outline_main", "timeline_main"])
    );
    expect(readAssetIds).not.toContain(DELETED_OUTLINE_ID);
    const recalledAssetIds = result.value.storyAnalysis.analysisRun.recalledAssets.map(
      (entry) => entry.assetId
    );
    expect(recalledAssetIds).toEqual(
      expect.arrayContaining([CHARACTER_ID, LOCATION_ID, "outline_main", "timeline_main"])
    );
    expect(recalledAssetIds).not.toContain(DELETED_OUTLINE_ID);
    expect(JSON.stringify(requests[0])).not.toContain("废弃大纲");
  });

  test("deduplicates pending records across repeated analysis runs", async () => {
    const history = createMemoryHistory();
    const identities = ["a".repeat(32), "b".repeat(32)];
    const session = createSession({
      history,
      snapshots: [],
      requests: [],
      createIdentity: () => {
        const identity = identities.shift();
        if (identity === undefined) throw new Error("Expected another identity fixture.");
        return identity;
      }
    });

    const first = await session.analyzeChapter({ chapterId: "ch_01", trigger: "manual" });
    const second = await session.analyzeChapter({ chapterId: "ch_01", trigger: "manual" });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.storyAnalysis.records).toHaveLength(2);
    expect(second.value.storyAnalysis.observations).toHaveLength(1);
    expect(second.value.storyAnalysis.factDeltas).toHaveLength(2);
    expect(second.value.storyAnalysis.records).toEqual([]);
    expect(second.value.workflowRun.status).toBe("applied");
  });

  test("supersedes a related open review issue across re-analysis runs", async () => {
    const history = createMemoryHistory();
    const identities = ["a".repeat(32), "b".repeat(32)];
    let completionCount = 0;
    const session = createSession({
      history,
      snapshots: [],
      requests: [],
      createIdentity: () => identities.shift() ?? "c".repeat(32),
      complete: async (request) =>
        ok(
          observerResponse(request, [
            {
              domain: "character.location",
              subjectMention: "幽灵",
              expectedType: "character",
              fact: {
                kind: "character_location",
                value: { locationMention: completionCount++ === 0 ? "北站" : "南站" }
              },
              evidence: [{ start: 0, end: Array.from(BODY).length, excerpt: BODY }],
              epistemicStatus: "narrator_asserted",
              confidence: 0.8,
              reason: "The subject cannot be resolved."
            }
          ])
        )
    });

    const first = await session.analyzeChapter({ chapterId: "ch_01", trigger: "manual" });
    const second = await session.analyzeChapter({ chapterId: "ch_01", trigger: "manual" });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    const newIssue = second.value.storyAnalysis.records.find(
      (record) => record.recordType === "review_issue"
    );
    const prior = history.records.get(first.value.workflowRun.workflowRunId);
    const oldIssue = prior?.storyAnalysis.records.find(
      (record) => record.recordType === "review_issue"
    );
    expect(newIssue).toMatchObject({ recordType: "review_issue", status: "open" });
    expect(oldIssue).toMatchObject({
      recordType: "review_issue",
      status: "stale",
      revision: 2,
      supersededByIssueId:
        newIssue?.recordType === "review_issue" ? newIssue.issueId : "missing replacement"
    });
    expect(
      [...history.records.values()].flatMap((record) =>
        record.storyAnalysis.records.filter(
          (item) => item.recordType === "review_issue" && item.status === "open"
        )
      )
    ).toHaveLength(1);
  });

  test("filters history to the current chapter before applying the 1000-run dedup cap", async () => {
    const history = createMemoryHistory();
    const identities = ["a".repeat(32), "b".repeat(32)];
    let completionCount = 0;
    const session = createSession({
      history,
      snapshots: [],
      requests: [],
      createIdentity: () => identities.shift() ?? "c".repeat(32),
      complete: async (request) =>
        ok(
          observerResponse(request, [
            unresolvedCharacterLocationObservation(completionCount++ === 0 ? "北站" : "南站")
          ])
        )
    });
    const first = await session.analyzeChapter({ chapterId: "ch_01", trigger: "manual" });
    if (!first.ok) throw first.error;
    const prior = history.records.get(first.value.workflowRun.workflowRunId);
    if (prior === undefined) throw new Error("Expected the prior chapter analysis.");
    for (let index = 0; index < 1_000; index += 1) {
      const identity = index.toString(16).padStart(32, "0");
      const workflowRunId = `wfrun_story_other_${identity}`;
      const storyAnalysis: StoryAnalysisBundle = {
        ...prior.storyAnalysis,
        analysisRun: {
          ...prior.storyAnalysis.analysisRun,
          analysisRunId: `run_${identity}`,
          chapter: {
            ...prior.storyAnalysis.analysisRun.chapter,
            chapterId: "ch_other"
          }
        },
        records: prior.storyAnalysis.records.map((record) => ({
          ...record,
          chapter: { ...record.chapter, chapterId: "ch_other" }
        }))
      };
      history.records.set(workflowRunId, {
        workflowRun: {
          ...prior.workflowRun,
          workflowRunId,
          updatedAt: "2026-08-01T00:00:00.000Z",
          storyAnalysis: storyAnalysis as unknown as JsonObject
        },
        storyAnalysis,
        checksum: index.toString(16).padStart(64, "0")
      });
    }

    const second = await session.analyzeChapter({ chapterId: "ch_01", trigger: "manual" });

    expect(second.ok).toBe(true);
    const priorIssue = history.records
      .get(first.value.workflowRun.workflowRunId)
      ?.storyAnalysis.records.find((record) => record.recordType === "review_issue");
    expect(priorIssue).toMatchObject({ status: "stale", revision: 2 });
    expect(
      [...history.records.values()].flatMap((record) =>
        record.storyAnalysis.analysisRun.chapter.chapterId === "ch_01"
          ? record.storyAnalysis.records.filter(
              (item) => item.recordType === "review_issue" && item.status === "open"
            )
          : []
      )
    ).toHaveLength(1);
  });

  test("never uses a same-shaped issue from another chapter as a replacement", async () => {
    const baseHistory = createMemoryHistory();
    const identities = ["a".repeat(32), "b".repeat(32)];
    let completionCount = 0;
    const history: ReturnType<typeof createMemoryHistory> = {
      ...baseHistory,
      async listStoryAnalyses() {
        const listed = await baseHistory.listStoryAnalyses();
        return listed.ok
          ? ok(
              listed.value.map((summary) =>
                summary.workflowRunId === "wfrun_cross_chapter"
                  ? { ...summary, chapterId: "ch_01" }
                  : summary
              )
            )
          : listed;
      }
    };
    const session = createSession({
      history,
      snapshots: [],
      requests: [],
      createIdentity: () => identities.shift() ?? "c".repeat(32),
      complete: async (request) =>
        ok(
          observerResponse(
            request,
            completionCount++ === 0 ? [unresolvedCharacterLocationObservation("北站")] : []
          )
        )
    });
    const first = await session.analyzeChapter({ chapterId: "ch_01", trigger: "manual" });
    if (!first.ok) throw first.error;
    const prior = baseHistory.records.get(first.value.workflowRun.workflowRunId);
    const priorIssue = prior?.storyAnalysis.records.find(
      (record) => record.recordType === "review_issue"
    );
    if (prior === undefined || priorIssue?.recordType !== "review_issue") {
      throw new Error("Expected a prior review issue.");
    }
    const crossChapterIssue = {
      ...priorIssue,
      issueId: `issue_${"d".repeat(32)}`,
      idempotencyKey: `idem_${"e".repeat(64)}`,
      chapter: { ...priorIssue.chapter, chapterId: "ch_02" }
    };
    const crossChapterBundle: StoryAnalysisBundle = {
      ...prior.storyAnalysis,
      analysisRun: {
        ...prior.storyAnalysis.analysisRun,
        analysisRunId: `run_${"d".repeat(32)}`,
        chapter: { ...prior.storyAnalysis.analysisRun.chapter, chapterId: "ch_02" }
      },
      records: [crossChapterIssue]
    };
    baseHistory.records.set("wfrun_cross_chapter", {
      workflowRun: {
        ...prior.workflowRun,
        workflowRunId: "wfrun_cross_chapter",
        updatedAt: "2026-08-01T00:00:00.000Z",
        storyAnalysis: crossChapterBundle as unknown as JsonObject
      },
      storyAnalysis: crossChapterBundle,
      checksum: "d".repeat(64)
    });

    const second = await session.analyzeChapter({ chapterId: "ch_01", trigger: "manual" });

    expect(second.ok).toBe(true);
    expect(
      baseHistory.records
        .get(first.value.workflowRun.workflowRunId)
        ?.storyAnalysis.records.find((record) => record.recordType === "review_issue")
    ).toMatchObject({ status: "open", supersededByIssueId: null });
  });

  test("serializes concurrent analysis of the same chapter and leaves one open issue", async () => {
    const history = createMemoryHistory();
    const identities = ["a".repeat(32), "b".repeat(32)];
    let completionCount = 0;
    let releaseFirstCompletion: (() => void) | undefined;
    let markFirstCompletionStarted: (() => void) | undefined;
    const firstCompletionStarted = new Promise<void>((resolve) => {
      markFirstCompletionStarted = resolve;
    });
    const firstCompletionRelease = new Promise<void>((resolve) => {
      releaseFirstCompletion = resolve;
    });
    const session = createSession({
      history,
      snapshots: [],
      requests: [],
      createIdentity: () => identities.shift() ?? "c".repeat(32),
      complete: async (request) => {
        const completionIndex = completionCount;
        completionCount += 1;
        if (completionIndex === 0) {
          markFirstCompletionStarted?.();
          await firstCompletionRelease;
        }
        return ok(
          observerResponse(request, [
            unresolvedCharacterLocationObservation(completionIndex === 0 ? "北站" : "南站")
          ])
        );
      }
    });

    const firstPromise = session.analyzeChapter({ chapterId: "ch_01", trigger: "manual" });
    await firstCompletionStarted;
    const secondPromise = session.analyzeChapter({ chapterId: "ch_01", trigger: "manual" });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(completionCount).toBe(1);
    releaseFirstCompletion?.();
    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(completionCount).toBe(2);
    expect(
      [...history.records.values()].flatMap((record) =>
        record.storyAnalysis.records.filter(
          (item) => item.recordType === "review_issue" && item.status === "open"
        )
      )
    ).toHaveLength(1);
  });

  test("uses the history coordinator to serialize two independent sessions for one chapter", async () => {
    const history = createMemoryHistory();
    let releaseFirstCompletion = (): void => undefined;
    let markFirstCompletionStarted = (): void => undefined;
    const firstCompletionRelease = new Promise<void>((resolve) => {
      releaseFirstCompletion = resolve;
    });
    const firstCompletionStarted = new Promise<void>((resolve) => {
      markFirstCompletionStarted = resolve;
    });
    let secondCompletionCalls = 0;
    const firstSession = createSession({
      history,
      snapshots: [],
      requests: [],
      createIdentity: () => "a".repeat(32),
      complete: async (request) => {
        markFirstCompletionStarted();
        await firstCompletionRelease;
        return ok(observerResponse(request, [unresolvedCharacterLocationObservation("北站")]));
      }
    });
    const secondSession = createSession({
      history,
      snapshots: [],
      requests: [],
      createIdentity: () => "b".repeat(32),
      complete: async (request) => {
        secondCompletionCalls += 1;
        return ok(observerResponse(request, [unresolvedCharacterLocationObservation("南站")]));
      }
    });

    const first = firstSession.analyzeChapter({ chapterId: "ch_01", trigger: "manual" });
    await firstCompletionStarted;
    const second = secondSession.analyzeChapter({ chapterId: "ch_01", trigger: "manual" });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(history.coordinationEntries).toEqual(["ch_01"]);
    expect(secondCompletionCalls).toBe(0);
    releaseFirstCompletion();
    const results = await Promise.all([first, second]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(history.coordinationEntries).toEqual(["ch_01", "ch_01"]);
    expect(secondCompletionCalls).toBe(1);
    expect(
      [...history.records.values()].flatMap((record) =>
        record.storyAnalysis.records.filter(
          (item) => item.recordType === "review_issue" && item.status === "open"
        )
      )
    ).toHaveLength(1);
  });

  test("preserves an author-resolved issue when supersede reconciliation loses CAS", async () => {
    const baseHistory = createMemoryHistory();
    const identities = ["a".repeat(32), "b".repeat(32)];
    const priorWorkflowRunId = `wfrun_story_${"a".repeat(32)}`;
    let completionCount = 0;
    let injectResolutionConflict = false;
    let conflictWrites = 0;
    const history: ReturnType<typeof createMemoryHistory> = {
      ...baseHistory,
      async writeStoryAnalysis(input) {
        const proposed = input.workflowRun.storyAnalysis as unknown as StoryAnalysisBundle;
        const proposesStaleIssue = proposed.records.some(
          (record) => record.recordType === "review_issue" && record.status === "stale"
        );
        if (
          injectResolutionConflict &&
          input.workflowRun.workflowRunId === priorWorkflowRunId &&
          proposesStaleIssue
        ) {
          injectResolutionConflict = false;
          const current = baseHistory.records.get(input.workflowRun.workflowRunId);
          const issue = current?.storyAnalysis.records.find(
            (record) => record.recordType === "review_issue" && record.status === "open"
          );
          if (current === undefined || issue?.recordType !== "review_issue") {
            return err(testError("STORY_ANALYSIS_RECORD_MISSING"));
          }
          const resolved = transitionStoryAnalysisRecord({
            bundle: current.storyAnalysis,
            recordId: issue.issueId,
            expectedRevision: issue.revision,
            transition: {
              status: "resolved",
              decision: "The author resolved this while reconciliation was running.",
              changeSetId: null,
              actor: "author"
            },
            updatedAt: "2026-07-31T00:00:04.000Z"
          });
          if (!resolved.ok) return err(resolved.error);
          const competing = await baseHistory.writeStoryAnalysis({
            workflowRun: {
              ...current.workflowRun,
              status: "applied",
              updatedAt: "2026-07-31T00:00:04.000Z",
              storyAnalysis: resolved.value as unknown as JsonObject
            },
            expectedChecksum: current.checksum
          });
          if (!competing.ok) return competing;
          conflictWrites += 1;
          return err(testError("STORY_ANALYSIS_CHECKSUM_CONFLICT"));
        }
        return baseHistory.writeStoryAnalysis(input);
      }
    };
    const session = createSession({
      history,
      snapshots: [],
      requests: [],
      createIdentity: () => identities.shift() ?? "c".repeat(32),
      complete: async (request) =>
        ok(
          observerResponse(request, [
            unresolvedCharacterLocationObservation(completionCount++ === 0 ? "北站" : "南站")
          ])
        )
    });

    const first = await session.analyzeChapter({ chapterId: "ch_01", trigger: "manual" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.workflowRun.workflowRunId).toBe(priorWorkflowRunId);
    injectResolutionConflict = true;

    const second = await session.analyzeChapter({ chapterId: "ch_01", trigger: "manual" });

    expect(second.ok).toBe(true);
    expect(conflictWrites).toBe(1);
    const priorIssue = history.records
      .get(priorWorkflowRunId)
      ?.storyAnalysis.records.find((record) => record.recordType === "review_issue");
    expect(priorIssue).toMatchObject({
      status: "resolved",
      revision: 2,
      supersededByIssueId: null,
      resolution: {
        decision: "The author resolved this while reconciliation was running.",
        actor: "author"
      }
    });
  });

  test("self-heals supersede links from a newer run persisted before reconciliation failed", async () => {
    const baseHistory = createMemoryHistory();
    const identities = ["a".repeat(32), "b".repeat(32), "c".repeat(32)];
    const priorWorkflowRunId = `wfrun_story_${"a".repeat(32)}`;
    let completionCount = 0;
    let failNextReconciliation = false;
    const history: ReturnType<typeof createMemoryHistory> = {
      ...baseHistory,
      async writeStoryAnalysis(input) {
        const proposed = input.workflowRun.storyAnalysis as unknown as StoryAnalysisBundle;
        if (
          failNextReconciliation &&
          input.workflowRun.workflowRunId === priorWorkflowRunId &&
          proposed.records.some(
            (record) => record.recordType === "review_issue" && record.status === "stale"
          )
        ) {
          failNextReconciliation = false;
          return err(testError("STORY_ANALYSIS_RECONCILE_WRITE_FAILED"));
        }
        return baseHistory.writeStoryAnalysis(input);
      }
    };
    const session = createSession({
      history,
      snapshots: [],
      requests: [],
      createIdentity: () => identities.shift() ?? "d".repeat(32),
      complete: async (request) => {
        const currentCompletion = completionCount;
        completionCount += 1;
        return ok(
          observerResponse(
            request,
            currentCompletion < 2
              ? [unresolvedCharacterLocationObservation(currentCompletion === 0 ? "北站" : "南站")]
              : []
          )
        );
      }
    });

    const first = await session.analyzeChapter({ chapterId: "ch_01", trigger: "manual" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.workflowRun.workflowRunId).toBe(priorWorkflowRunId);
    failNextReconciliation = true;

    const second = await session.analyzeChapter({ chapterId: "ch_01", trigger: "manual" });

    expect(second).toMatchObject({
      ok: false,
      error: { code: "STORY_ANALYSIS_RECONCILE_WRITE_FAILED" }
    });
    expect(
      [...history.records.values()].flatMap((record) =>
        record.storyAnalysis.records.filter(
          (item) => item.recordType === "review_issue" && item.status === "open"
        )
      )
    ).toHaveLength(2);

    const third = await session.analyzeChapter({ chapterId: "ch_01", trigger: "manual" });

    expect(third.ok).toBe(true);
    const priorIssue = history.records
      .get(priorWorkflowRunId)
      ?.storyAnalysis.records.find((record) => record.recordType === "review_issue");
    const replacementIssue = history.records
      .get(`wfrun_story_${"b".repeat(32)}`)
      ?.storyAnalysis.records.find((record) => record.recordType === "review_issue");
    expect(priorIssue).toMatchObject({
      status: "stale",
      supersededByIssueId:
        replacementIssue?.recordType === "review_issue"
          ? replacementIssue.issueId
          : "missing replacement"
    });
    expect(replacementIssue).toMatchObject({ status: "open" });
    expect(
      [...history.records.values()].flatMap((record) =>
        record.storyAnalysis.records.filter(
          (item) => item.recordType === "review_issue" && item.status === "open"
        )
      )
    ).toHaveLength(1);
  });

  test("marks an old open review issue stale when chapter evidence changes without a replacement", async () => {
    const history = createMemoryHistory();
    const identities = ["a".repeat(32), "b".repeat(32)];
    let chapter = savedChapter();
    let completionCount = 0;
    const session = createSession({
      history,
      snapshots: [],
      requests: [],
      readChapter: () => chapter,
      createIdentity: () => identities.shift() ?? "c".repeat(32),
      complete: async (request) =>
        ok(
          observerResponse(
            request,
            completionCount++ === 0
              ? [
                  {
                    domain: "character.location",
                    subjectMention: "幽灵",
                    expectedType: "character",
                    fact: {
                      kind: "character_location",
                      value: { locationMention: "北站" }
                    },
                    evidence: [{ start: 0, end: Array.from(BODY).length, excerpt: BODY }],
                    epistemicStatus: "narrator_asserted",
                    confidence: 0.8,
                    reason: "The subject cannot be resolved."
                  }
                ]
              : []
          )
        )
    });
    const first = await session.analyzeChapter({ chapterId: "ch_01", trigger: "manual" });
    chapter = savedChapter("本章已经改写。");
    const second = await session.analyzeChapter({ chapterId: "ch_01", trigger: "manual" });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok) return;
    const prior = history.records.get(first.value.workflowRun.workflowRunId);
    expect(
      prior?.storyAnalysis.records.find((record) => record.recordType === "review_issue")
    ).toMatchObject({ status: "stale", supersededByIssueId: null });
  });
});

function createSession(input: {
  readonly history: ReturnType<typeof createMemoryHistory>;
  readonly snapshots: JsonObject[];
  readonly requests: unknown[];
  readonly chapter?: ChapterDocument;
  readonly createIdentity?: () => string;
  readonly complete?: (request: LlmRequest) => Promise<Result<LlmResponse, UnifiedError>>;
  readonly usagePort?: StoryAnalysisUsagePort;
  readonly readChapter?: () => ChapterDocument;
  readonly requestedStatuses?: StoryAnalysisAsset["status"][][];
  readonly readAssetIds?: string[];
}) {
  const chapter = input.chapter ?? savedChapter();
  const catalog = storyAssets();
  return createStoryAnalysisSession({
    projectId: "prj_story_analysis",
    chapterRepository: {
      readChapter: async () => ok(input.readChapter?.() ?? chapter)
    },
    storyBibleRepository: {
      listStoryBible: async ({ statuses }) => {
        input.requestedStatuses?.push([...statuses]);
        return ok({
          items: catalog
            .filter((entry) => statuses.includes(entry.asset.status))
            .map((entry) => ({
              assetId: entry.asset.id,
              type: entry.asset.type,
              title: entry.asset.title,
              status: entry.asset.status,
              summary: entry.asset.summary,
              revision: entry.asset.revision,
              indexRevision: INDEX_REVISION
            })),
          indexRevision: INDEX_REVISION,
          nextCursor: null
        });
      },
      readStoryAssetForAgent: async (assetId) => {
        input.readAssetIds?.push(assetId);
        const entry = catalog.find((candidate) => candidate.asset.id === assetId);
        return entry === undefined
          ? err(testError("STORY_ASSET_MISSING"))
          : ok({ asset: entry.asset, checksum: entry.checksum });
      }
    },
    contextSnapshotPort: {
      writeContextSnapshot: async (snapshot) => {
        input.snapshots.push(snapshot);
        return ok(snapshot);
      }
    },
    history: input.history,
    resolveModelRuntimeProfile: async () =>
      ok({
        contextWindow: 32_000,
        modelProfile: {
          id: "test-model-profile",
          displayName: "Test Model",
          provider: "openai",
          modelName: "test-model"
        },
        parameters: { maxTokens: 2_000 }
      }),
    llmAdapter: {
      complete:
        input.complete ??
        (async (request) => {
          input.requests.push(request);
          return ok({
            schemaVersion: "1.0" as const,
            requestId: request.requestId,
            provider: "openai" as const,
            modelName: "test-model",
            status: "success" as const,
            content: {
              type: "json" as const,
              value: {
                observations: [
                  {
                    domain: "character.location",
                    subjectMention: "林默",
                    expectedType: "character",
                    fact: { kind: "character_location", value: { locationMention: "北站" } },
                    evidence: [{ start: 0, end: Array.from(BODY).length, excerpt: BODY }],
                    epistemicStatus: "narrator_asserted",
                    confidence: 0.95,
                    reason: "The narration states the location."
                  }
                ]
              }
            },
            usage: usage(),
            createdAt: "2026-07-31T00:00:03.000Z"
          });
        })
    },
    ...(input.usagePort === undefined ? {} : { usagePort: input.usagePort }),
    now: () => "2026-07-31T00:00:03.000Z",
    createIdentity: input.createIdentity ?? (() => "a".repeat(32))
  });
}

function createMemoryHistory(): StoryAnalysisHistoryPort & {
  readonly records: Map<string, StoryAnalysisHistoryRecord>;
  readonly statusWrites: StoryAnalysisBundle["analysisRun"]["status"][];
  readonly coordinationEntries: string[];
} {
  const records = new Map<string, StoryAnalysisHistoryRecord>();
  const statusWrites: StoryAnalysisBundle["analysisRun"]["status"][] = [];
  const coordinationEntries: string[] = [];
  const chapterQueues = new Map<string, Promise<void>>();
  let writes = 0;
  return {
    records,
    statusWrites,
    coordinationEntries,
    async coordinateStoryAnalysisChapter(chapterId, operation) {
      const previous = chapterQueues.get(chapterId) ?? Promise.resolve();
      let release = (): void => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const tail = previous.catch(() => undefined).then(() => gate);
      chapterQueues.set(chapterId, tail);
      await previous.catch(() => undefined);
      coordinationEntries.push(chapterId);
      try {
        return await operation();
      } finally {
        release();
        if (chapterQueues.get(chapterId) === tail) chapterQueues.delete(chapterId);
      }
    },
    async writeStoryAnalysis(input) {
      const current = records.get(input.workflowRun.workflowRunId);
      if ((current?.checksum ?? null) !== input.expectedChecksum) {
        return err(testError("STORY_ANALYSIS_CHECKSUM_CONFLICT"));
      }
      const storyAnalysis = input.workflowRun.storyAnalysis as unknown as StoryAnalysisBundle;
      const checksum = (++writes).toString(16).padStart(64, "0");
      const record = { workflowRun: input.workflowRun, storyAnalysis, checksum };
      records.set(input.workflowRun.workflowRunId, record);
      statusWrites.push(storyAnalysis.analysisRun.status);
      return ok(record);
    },
    async listStoryAnalyses() {
      const summaries: StoryAnalysisHistorySummary[] = [...records.values()].map((record) => ({
        workflowRunId: record.workflowRun.workflowRunId,
        analysisRunId: record.storyAnalysis.analysisRun.analysisRunId,
        chapterId: record.storyAnalysis.analysisRun.chapter.chapterId,
        status: record.storyAnalysis.analysisRun.status,
        updatedAt: record.workflowRun.updatedAt,
        pendingSuggestionCount: record.storyAnalysis.records.filter(
          (item) => item.recordType === "change" && item.status === "pending"
        ).length,
        openIssueCount: record.storyAnalysis.records.filter(
          (item) => item.recordType === "review_issue" && item.status === "open"
        ).length,
        checksum: record.checksum
      }));
      return ok(summaries);
    },
    async readStoryAnalysis(workflowRunId) {
      const record = records.get(workflowRunId);
      return record === undefined ? err(testError("STORY_ANALYSIS_RECORD_MISSING")) : ok(record);
    }
  };
}

function storyAssets(): { readonly asset: StoryAnalysisAsset; readonly checksum: string }[] {
  return [
    asset("character", CHARACTER_ID, "林默", {
      currentState: {
        locationId: null,
        physical: "",
        emotional: "",
        heldItemIds: [],
        asOfChapterId: null,
        asOfEventId: null
      },
      knowledgeStates: [],
      stateHistory: []
    }),
    asset("world.location", LOCATION_ID, "北站", {}, "draft"),
    asset("world.location", UNUSED_LOCATION_ID, "遥远城堡", {}),
    asset("outline", "outline_main", "主线大纲", { volumes: [], chapterOutlines: [] }, "archived"),
    asset("timeline.events", "timeline_main", "主时间线", { events: [] }),
    asset(
      "outline",
      DELETED_OUTLINE_ID,
      "废弃大纲",
      { volumes: [], chapterOutlines: [] },
      "deleted"
    )
  ];
}

function asset(
  type: StoryAnalysisAsset["type"],
  id: string,
  title: string,
  details: Record<string, unknown>,
  status: StoryAnalysisAsset["status"] = "active"
): { readonly asset: StoryAnalysisAsset; readonly checksum: string } {
  return {
    asset: {
      schemaVersion: "1.1",
      id,
      type,
      title,
      status,
      summary: "",
      aliases: [],
      relations: [],
      details: details as JsonObject,
      extensions: {},
      createdAt: "2026-07-31T00:00:00.000Z",
      updatedAt: "2026-07-31T00:00:00.000Z",
      revision: 1
    },
    checksum: "c".repeat(64)
  };
}

function savedChapter(body = BODY): ChapterDocument {
  return {
    frontmatter: {
      schemaVersion: "1.0",
      id: "ch_01",
      type: "chapter",
      title: "第一章",
      order: 1,
      status: "done",
      createdAt: "2026-07-31T00:00:00.000Z",
      updatedAt: "2026-07-31T00:00:00.000Z"
    },
    body
  };
}

function unresolvedCharacterLocationObservation(locationMention: string): JsonValue {
  return {
    domain: "character.location",
    subjectMention: "幽灵",
    expectedType: "character",
    fact: {
      kind: "character_location",
      value: { locationMention }
    },
    evidence: [{ start: 0, end: Array.from(BODY).length, excerpt: BODY }],
    epistemicStatus: "narrator_asserted",
    confidence: 0.8,
    reason: "The subject cannot be resolved."
  };
}

function observerResponse(request: LlmRequest, observations: readonly JsonValue[]): LlmResponse {
  return {
    schemaVersion: "1.0",
    requestId: request.requestId,
    provider: "openai",
    modelName: "test-model",
    status: "success",
    content: { type: "json", value: { observations: [...observations] } },
    usage: usage(),
    createdAt: "2026-07-31T00:00:03.000Z"
  };
}

function usage() {
  return {
    inputTokens: 100,
    outputTokens: 20,
    totalTokens: 120,
    usageStatus: "actual" as const,
    cost: { amount: 0.01, currency: "USD", status: "actual" as const }
  };
}

function testError(code: string) {
  return createUnifiedError({
    code,
    category: "ValidationError",
    message: code,
    recoverability: "user-action",
    suggestedAction: "Retry.",
    traceId: "test"
  });
}
