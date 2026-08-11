import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ok } from "@novel-studio/shared";
import { describe, expect, test } from "vitest";
import {
  HistoryRepository,
  type StoryAnalysisBundle,
  type WorkflowRunRecord
} from "../src/index.js";

describe("Workflow run history", () => {
  test("records workflow runs under history and lists newest runs first", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-workflow-runs-"));
    const history = new HistoryRepository({
      projectRoot,
      traceId: "trace_workflow_runs"
    });

    const older = workflowRunRecord({
      workflowRunId: "wfrun_older",
      updatedAt: "2026-07-05T09:00:00.000Z"
    });
    const newer = workflowRunRecord({
      workflowRunId: "wfrun_newer",
      updatedAt: "2026-07-05T09:10:00.000Z"
    });

    const first = await history.recordWorkflowRun(older);
    const second = await history.recordWorkflowRun(newer);
    const listed = await history.listWorkflowRuns();

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(listed.ok).toBe(true);
    if (!listed.ok) {
      return;
    }
    expect(listed.value.map((run) => run.workflowRunId)).toEqual(["wfrun_newer", "wfrun_older"]);
    expect(listed.value[0]).toMatchObject({
      workflowTitle: "Continue Chapter",
      status: "pending-confirmation",
      modelLabel: "M14 Mock Writer / mock-writer",
      usageLabel: "24 tokens · estimated"
    });

    await expect(
      readFile(join(projectRoot, "history", "workflows", "runs", "wfrun_newer.json"), "utf8")
    ).resolves.toContain('"workflowRunId": "wfrun_newer"');
  });

  test("reads a workflow run detail record", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-workflow-run-detail-"));
    const history = new HistoryRepository({
      projectRoot,
      traceId: "trace_workflow_run_detail"
    });
    const record = workflowRunRecord({ workflowRunId: "wfrun_detail" });

    await history.recordWorkflowRun(record);
    const detail = await history.readWorkflowRun("wfrun_detail");

    expect(detail.ok).toBe(true);
    if (!detail.ok) {
      return;
    }
    expect(detail.value).toMatchObject({
      workflowRunId: "wfrun_detail",
      steps: [
        { stepId: "build_context", status: "completed" },
        { stepId: "write_suggestion", status: "completed" },
        { stepId: "confirm_apply", status: "waiting-confirmation" }
      ]
    });
  });

  test("returns an empty workflow run list when no history exists", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-empty-workflow-runs-"));
    const history = new HistoryRepository({
      projectRoot,
      traceId: "trace_empty_workflow_runs"
    });

    const listed = await history.listWorkflowRuns();

    expect(listed).toEqual({ ok: true, value: [] });
  });

  test("rejects invalid workflow run records before writing", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-invalid-workflow-run-"));
    const history = new HistoryRepository({
      projectRoot,
      traceId: "trace_invalid_workflow_run"
    });
    const invalidRecord = unsafeWorkflowRunRecord({
      ...workflowRunRecord({ workflowRunId: "wfrun_invalid" }),
      status: "running"
    });

    const recorded = await history.recordWorkflowRun(invalidRecord);

    expect(recorded.ok).toBe(false);
    if (recorded.ok) {
      return;
    }
    expect(recorded.error.code).toBe("WORKFLOW_RUN_RECORD_INVALID");
    await expect(
      readFile(join(projectRoot, "history", "workflows", "runs", "wfrun_invalid.json"), "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("stores Story Analysis in workflow history and protects updates with checksum CAS", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-story-analysis-history-"));
    const history = new HistoryRepository({
      projectRoot,
      traceId: "trace_story_analysis_history"
    });
    const initialBundle = storyAnalysisBundle();
    const initialRun = storyAnalysisWorkflowRun("wfrun_story_analysis", initialBundle);

    const created = await history.writeStoryAnalysis({
      workflowRun: initialRun,
      expectedChecksum: null
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.storyAnalysis).toEqual(initialBundle);
    expect(created.value.checksum).toMatch(/^[a-f0-9]{64}$/);

    const updatedBundle: StoryAnalysisBundle = {
      ...initialBundle,
      analysisRun: {
        ...initialBundle.analysisRun,
        runtime: {
          ...initialBundle.analysisRun.runtime,
          extractorVersion: "story-fact-router-v2"
        }
      }
    };
    const updatedRun = storyAnalysisWorkflowRun("wfrun_story_analysis", updatedBundle, {
      updatedAt: "2026-07-31T00:00:04.000Z"
    });
    const updated = await history.writeStoryAnalysis({
      workflowRun: updatedRun,
      expectedChecksum: created.value.checksum
    });

    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.value.checksum).not.toBe(created.value.checksum);

    const stale = await history.writeStoryAnalysis({
      workflowRun: initialRun,
      expectedChecksum: created.value.checksum
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.error.code).toBe("STORY_ANALYSIS_CHECKSUM_CONFLICT");
    }

    const read = await history.readStoryAnalysis("wfrun_story_analysis");
    const listed = await history.listStoryAnalyses();
    expect(read.ok).toBe(true);
    expect(listed).toEqual({
      ok: true,
      value: [
        expect.objectContaining({
          workflowRunId: "wfrun_story_analysis",
          analysisRunId: initialBundle.analysisRun.analysisRunId,
          chapterId: "ch_01",
          status: "completed",
          pendingSuggestionCount: 0,
          openIssueCount: 0,
          checksum: updated.value.checksum
        })
      ]
    });
    if (read.ok) {
      expect(read.value.storyAnalysis.analysisRun.runtime.extractorVersion).toBe(
        "story-fact-router-v2"
      );
    }
  });

  test("serializes Story Analysis checksum CAS across independent repository instances", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-story-analysis-cas-race-"));
    const firstHistory = new HistoryRepository({
      projectRoot,
      traceId: "trace_story_analysis_cas_first",
      storyAnalysisLock: { waitTimeoutMs: 5_000, retryDelayMs: 2 }
    });
    const secondHistory = new HistoryRepository({
      projectRoot,
      traceId: "trace_story_analysis_cas_second",
      storyAnalysisLock: { waitTimeoutMs: 5_000, retryDelayMs: 2 }
    });
    const initialBundle = storyAnalysisBundle();
    const created = await firstHistory.writeStoryAnalysis({
      workflowRun: storyAnalysisWorkflowRun("wfrun_story_cas_race", initialBundle),
      expectedChecksum: null
    });
    if (!created.ok) throw created.error;
    const candidate = (extractorVersion: string, updatedAt: string) => {
      const bundle: StoryAnalysisBundle = {
        ...initialBundle,
        analysisRun: {
          ...initialBundle.analysisRun,
          runtime: { ...initialBundle.analysisRun.runtime, extractorVersion }
        }
      };
      return {
        workflowRun: storyAnalysisWorkflowRun("wfrun_story_cas_race", bundle, { updatedAt }),
        expectedChecksum: created.value.checksum
      };
    };

    const results = await Promise.all([
      firstHistory.writeStoryAnalysis(candidate("writer-a", "2026-07-31T00:00:04.000Z")),
      secondHistory.writeStoryAnalysis(candidate("writer-b", "2026-07-31T00:00:05.000Z"))
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: "STORY_ANALYSIS_CHECKSUM_CONFLICT" })
      })
    ]);
    const persisted = await firstHistory.readStoryAnalysis("wfrun_story_cas_race");
    expect(persisted.ok).toBe(true);
    if (persisted.ok) {
      expect(["writer-a", "writer-b"]).toContain(
        persisted.value.storyAnalysis.analysisRun.runtime.extractorVersion
      );
    }
  }, 10_000);

  test("coordinates one chapter across two repository instances with a persistent lock", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-story-analysis-chapter-lock-"));
    const firstHistory = new HistoryRepository({
      projectRoot,
      storyAnalysisLock: { waitTimeoutMs: 1_000, retryDelayMs: 2 }
    });
    const secondHistory = new HistoryRepository({
      projectRoot,
      storyAnalysisLock: { waitTimeoutMs: 1_000, retryDelayMs: 2 }
    });
    let releaseFirst = (): void => undefined;
    let markFirstEntered = (): void => undefined;
    const firstRelease = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstEntered = new Promise<void>((resolve) => {
      markFirstEntered = resolve;
    });
    let secondEntered = false;
    const first = firstHistory.coordinateStoryAnalysisChapter("ch_01", async () => {
      markFirstEntered();
      await firstRelease;
      return ok("first");
    });
    await firstEntered;
    const second = secondHistory.coordinateStoryAnalysisChapter("ch_01", async () => {
      secondEntered = true;
      return ok("second");
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    expect(secondEntered).toBe(false);
    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual([
      { ok: true, value: "first" },
      { ok: true, value: "second" }
    ]);
  });

  test("rejects the generic workflow writer as a checksum-CAS bypass for Story Analysis", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-story-analysis-cas-bypass-"));
    const history = new HistoryRepository({ projectRoot });

    const recorded = await history.recordWorkflowRun(
      storyAnalysisWorkflowRun("wfrun_story_cas_bypass", storyAnalysisBundle())
    );

    expect(recorded).toMatchObject({
      ok: false,
      error: { code: "STORY_ANALYSIS_CAS_REQUIRED" }
    });
    await expect(
      readFile(
        join(projectRoot, "history", "workflows", "runs", "wfrun_story_cas_bypass.json"),
        "utf8"
      )
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("does not let an ordinary workflow overwrite an existing Story Analysis run", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-story-analysis-no-overwrite-"));
    const history = new HistoryRepository({ projectRoot });
    const workflowRunId = "wfrun_story_no_generic_overwrite";
    const created = await history.writeStoryAnalysis({
      workflowRun: storyAnalysisWorkflowRun(workflowRunId, storyAnalysisBundle()),
      expectedChecksum: null
    });
    if (!created.ok) throw created.error;

    const overwritten = await history.recordWorkflowRun(workflowRunRecord({ workflowRunId }));

    expect(overwritten).toMatchObject({
      ok: false,
      error: { code: "STORY_ANALYSIS_CAS_REQUIRED" }
    });
    const persisted = await history.readStoryAnalysis(workflowRunId);
    expect(persisted).toMatchObject({
      ok: true,
      value: { checksum: created.value.checksum }
    });
  });

  test("does not let a new Story Analysis overwrite an existing ordinary workflow", async () => {
    const projectRoot = await mkdtemp(
      join(tmpdir(), "novel-studio-workflow-no-analysis-overwrite-")
    );
    const history = new HistoryRepository({ projectRoot });
    const workflowRunId = "wfrun_ordinary_no_story_overwrite";
    const ordinary = workflowRunRecord({ workflowRunId });
    const created = await history.recordWorkflowRun(ordinary);
    if (!created.ok) throw created.error;

    const overwritten = await history.writeStoryAnalysis({
      workflowRun: storyAnalysisWorkflowRun(workflowRunId, storyAnalysisBundle()),
      expectedChecksum: null
    });

    expect(overwritten).toMatchObject({
      ok: false,
      error: { code: "STORY_ANALYSIS_WORKFLOW_ID_CONFLICT" }
    });
    await expect(history.readWorkflowRun(workflowRunId)).resolves.toEqual({
      ok: true,
      value: ordinary
    });
  });

  test("rejects semantically invalid Story Analysis through the generic workflow writer", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-invalid-story-analysis-"));
    const history = new HistoryRepository({
      projectRoot,
      traceId: "trace_invalid_story_analysis"
    });
    const bundle = storyAnalysisBundle();
    const invalidBundle: StoryAnalysisBundle = {
      ...bundle,
      analysisRun: {
        ...bundle.analysisRun,
        validation: {
          ...bundle.analysisRun.validation,
          observationCount: 1,
          acceptedCount: 1
        }
      }
    };

    const recorded = await history.recordWorkflowRun(
      storyAnalysisWorkflowRun("wfrun_invalid_analysis", invalidBundle)
    );

    expect(recorded.ok).toBe(false);
    if (!recorded.ok) {
      expect(recorded.error.code).toBe("WORKFLOW_RUN_RECORD_INVALID");
    }
  });
});

function workflowRunRecord(input: {
  readonly workflowRunId: string;
  readonly updatedAt?: string;
}): WorkflowRunRecord {
  const updatedAt = input.updatedAt ?? "2026-07-05T09:00:01.000Z";
  return {
    schemaVersion: "1.0",
    workflowRunId: input.workflowRunId,
    workflowId: "wf_ai_continue_chapter",
    workflowTitle: "Continue Chapter",
    status: "pending-confirmation",
    startedAt: "2026-07-05T09:00:00.000Z",
    updatedAt,
    context: {
      sourceCount: 1,
      tokenEstimate: 4,
      selectionReason: "Continue the chapter."
    },
    model: {
      profileId: "mock_m14",
      displayName: "M14 Mock Writer",
      provider: "mock",
      modelName: "mock-writer"
    },
    usage: {
      inputTokens: 16,
      outputTokens: 8,
      totalTokens: 24,
      usageStatus: "estimated",
      cost: {
        amount: 0,
        currency: "USD",
        status: "estimated"
      }
    },
    steps: [
      {
        stepId: "build_context",
        label: "构建上下文",
        kind: "context",
        status: "completed"
      },
      {
        stepId: "write_suggestion",
        label: "运行写作 Agent",
        kind: "agent",
        status: "completed"
      },
      {
        stepId: "confirm_apply",
        label: "等待用户确认",
        kind: "confirmation",
        status: "waiting-confirmation"
      }
    ]
  };
}

function unsafeWorkflowRunRecord(value: unknown): WorkflowRunRecord {
  return value as WorkflowRunRecord;
}

function storyAnalysisWorkflowRun(
  workflowRunId: string,
  storyAnalysis: StoryAnalysisBundle,
  overrides: { readonly updatedAt?: string } = {}
): WorkflowRunRecord {
  return unsafeWorkflowRunRecord({
    ...workflowRunRecord({ workflowRunId, ...overrides }),
    workflowId: "wf_story_analysis",
    workflowTitle: "Story Analysis",
    storyAnalysis
  });
}

function storyAnalysisBundle(): StoryAnalysisBundle {
  const hash = "a".repeat(64);
  return {
    schemaVersion: "1.1",
    analysisRun: {
      schemaVersion: "1.1",
      analysisRunId: `run_${"1".repeat(32)}`,
      trigger: "manual",
      createdAt: "2026-07-31T00:00:00.000Z",
      startedAt: "2026-07-31T00:00:01.000Z",
      completedAt: "2026-07-31T00:00:02.000Z",
      chapter: { chapterId: "ch_01", checksum: hash },
      contextSnapshot: {
        contextSnapshotId: `ctx_${"2".repeat(32)}`,
        checksum: hash
      },
      recalledAssets: [],
      runtime: {
        providerId: "configured-provider",
        modelId: "configured-model",
        promptVersion: "story-observer-v1",
        promptChecksum: hash,
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
        inputTokens: 0,
        outputTokens: 0,
        estimatedCost: null
      },
      status: "completed",
      failure: null
    },
    observations: [],
    factDeltas: [],
    records: []
  };
}
