import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";
import { HistoryRepository, type WorkflowRunRecord } from "../src/index.js";

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
