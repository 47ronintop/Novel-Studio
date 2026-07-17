import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import * as repositoryExports from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("AgentRunFileRepository", () => {
  test("persists snapshots, ordered events, and command receipts under project history", async () => {
    const Repository = (repositoryExports as unknown as Record<string, unknown>)[
      "AgentRunFileRepository"
    ];
    expect(typeof Repository).toBe("function");
    if (typeof Repository !== "function") return;

    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-agent-run-store-"));
    roots.push(projectRoot);
    const repository = new (
      Repository as new (options: { projectRoot: string }) => {
        writeSnapshot(snapshot: Record<string, unknown>): Promise<unknown>;
        appendEvent(event: Record<string, unknown>): Promise<unknown>;
        writeCommandReceipt(commandId: string, receipt: Record<string, unknown>): Promise<unknown>;
        readSnapshot(runId: string): Promise<unknown>;
        readEvents(runId: string): Promise<unknown>;
      }
    )({ projectRoot });
    const snapshot = {
      schemaVersion: "1.0",
      runId: "run_01",
      projectId: "project_01",
      status: "planning_model",
      runRevision: 1,
      lastSequence: 1
    };
    const event = {
      schemaVersion: "1.0",
      runId: "run_01",
      projectId: "project_01",
      sequence: 1,
      runRevision: 1,
      type: "run_started",
      createdAt: "2026-07-13T00:00:00.000Z"
    };

    await repository.writeSnapshot(snapshot);
    await repository.appendEvent(event);
    await repository.writeCommandReceipt("command_01", { ok: true, value: snapshot });

    expect(await repository.readSnapshot("run_01")).toEqual({ ok: true, value: snapshot });
    expect(await repository.readEvents("run_01")).toEqual({ ok: true, value: [event] });
    const raw = await readFile(
      join(projectRoot, "history", "agent-runs", "run_01", "run.json"),
      "utf8"
    );
    expect(raw).toContain('"runRevision": 1');
    expect(raw).not.toContain("apiKey");
  });

  test("persists context snapshots and plan revisions and lists durable run snapshots", async () => {
    const Repository = (repositoryExports as unknown as Record<string, unknown>)[
      "AgentRunFileRepository"
    ];
    expect(typeof Repository).toBe("function");
    if (typeof Repository !== "function") return;

    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-agent-artifacts-"));
    roots.push(projectRoot);
    const repository = new (
      Repository as new (options: {
        projectRoot: string;
      }) => Record<string, (...args: unknown[]) => Promise<unknown>>
    )({ projectRoot });
    expect(typeof repository["writeContextSnapshot"]).toBe("function");
    expect(typeof repository["readContextSnapshot"]).toBe("function");
    expect(typeof repository["writePlanArtifact"]).toBe("function");
    expect(typeof repository["readPlanArtifact"]).toBe("function");
    expect(typeof repository["listSnapshots"]).toBe("function");
    expect(typeof repository["readCommandReceipt"]).toBe("function");
    expect(typeof repository["writeRetryCheckpoint"]).toBe("function");
    expect(typeof repository["readRetryCheckpoint"]).toBe("function");
    if (
      typeof repository["writeContextSnapshot"] !== "function" ||
      typeof repository["readContextSnapshot"] !== "function" ||
      typeof repository["writePlanArtifact"] !== "function" ||
      typeof repository["readPlanArtifact"] !== "function" ||
      typeof repository["listSnapshots"] !== "function" ||
      typeof repository["readCommandReceipt"] !== "function" ||
      typeof repository["writeRetryCheckpoint"] !== "function" ||
      typeof repository["readRetryCheckpoint"] !== "function"
    )
      return;

    const snapshot = {
      schemaVersion: "1.0",
      runId: "run_02",
      projectId: "project_01",
      status: "plan_ready",
      runRevision: 4,
      lastSequence: 4
    };
    const contextSnapshot = {
      schemaVersion: "1.0",
      contextSnapshotId: "context_02",
      runId: "run_02",
      createdAt: "2026-07-13T00:00:00.000Z",
      compactionRevision: 0,
      sources: [],
      excludedSources: []
    };
    const plan = {
      schemaVersion: "1.0",
      planId: "plan_02",
      revision: 1,
      sourceRunId: "run_02",
      status: "ready",
      goal: "Resolve continuity"
    };
    await repository["writeSnapshot"]?.(snapshot);
    await repository["writeContextSnapshot"]?.(contextSnapshot);
    await repository["writePlanArtifact"]?.(plan);
    expect(await repository["readPlanArtifact"]?.("plan_02", 1)).toEqual({
      ok: true,
      value: plan
    });
    await repository["writeCommandReceipt"]?.("run_02", "answer_02", {
      ok: true,
      value: snapshot
    });
    const retryCheckpoint = {
      schemaVersion: "1.0",
      runId: "run_02",
      available: true,
      toolCallId: "call_02",
      toolName: "read_project_text",
      argumentsText: '{"path":"notes/outline.md"}'
    };
    await repository["writeRetryCheckpoint"]?.("run_02", retryCheckpoint);

    expect(await repository["listSnapshots"]?.("project_01")).toEqual({
      ok: true,
      value: [snapshot]
    });
    expect(await repository["readCommandReceipt"]?.("run_02", "answer_02")).toMatchObject({
      ok: true,
      value: { ok: true }
    });
    expect(await repository["readRetryCheckpoint"]?.("run_02")).toEqual({
      ok: true,
      value: retryCheckpoint
    });
    expect(await repository["readContextSnapshot"]?.("run_02", "context_02")).toEqual({
      ok: true,
      value: contextSnapshot
    });
    expect(
      JSON.parse(
        await readFile(
          join(
            projectRoot,
            "history",
            "agent-runs",
            "run_02",
            "context-snapshots",
            "context_02.json"
          ),
          "utf8"
        )
      )
    ).toEqual(contextSnapshot);
    expect(
      JSON.parse(
        await readFile(
          join(projectRoot, "history", "plans", "plan_02", "revisions", "1.json"),
          "utf8"
        )
      )
    ).toEqual(plan);
  });

  test("persists immutable plan execution revisions and revision requests", async () => {
    const Repository = (repositoryExports as unknown as Record<string, unknown>)[
      "AgentRunFileRepository"
    ];
    expect(typeof Repository).toBe("function");
    if (typeof Repository !== "function") return;

    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-plan-execution-store-"));
    roots.push(projectRoot);
    const repository = new (
      Repository as new (options: {
        projectRoot: string;
      }) => Record<string, (...args: unknown[]) => Promise<unknown>>
    )({ projectRoot });
    expect(typeof repository["writePlanExecutionRecord"]).toBe("function");
    expect(typeof repository["readPlanExecutionRecord"]).toBe("function");
    expect(typeof repository["writePlanRevisionRequest"]).toBe("function");
    expect(typeof repository["readPlanRevisionRequest"]).toBe("function");
    expect(typeof repository["writePlanRevisionDecision"]).toBe("function");
    expect(typeof repository["readPlanRevisionDecision"]).toBe("function");
    if (
      typeof repository["writePlanExecutionRecord"] !== "function" ||
      typeof repository["readPlanExecutionRecord"] !== "function" ||
      typeof repository["writePlanRevisionRequest"] !== "function" ||
      typeof repository["readPlanRevisionRequest"] !== "function" ||
      typeof repository["writePlanRevisionDecision"] !== "function" ||
      typeof repository["readPlanRevisionDecision"] !== "function"
    )
      return;

    const revision1 = {
      schemaVersion: "1.0",
      planExecutionId: "execution_01",
      runId: "run_01",
      planId: "plan_01",
      planRevision: 1,
      revision: 1,
      steps: [{ stepId: "step_01", status: "pending" }]
    };
    const revision2 = {
      ...revision1,
      revision: 2,
      steps: [{ stepId: "step_01", status: "running" }]
    };
    expect(await repository["writePlanExecutionRecord"](revision1)).toMatchObject({ ok: true });
    expect(await repository["writePlanExecutionRecord"](revision2)).toMatchObject({ ok: true });
    expect(await repository["readPlanExecutionRecord"]("run_01", "execution_01")).toEqual({
      ok: true,
      value: revision2
    });
    expect(await repository["readPlanExecutionRecord"]("run_01", "execution_01", 1)).toEqual({
      ok: true,
      value: revision1
    });
    expect(
      await repository["writePlanExecutionRecord"]({
        ...revision2,
        steps: [{ stepId: "step_01", status: "completed" }]
      })
    ).toMatchObject({ ok: false, error: { code: "AGENT_PLAN_EXECUTION_REVISION_CONFLICT" } });

    const request = {
      schemaVersion: "1.0",
      requestId: "request_01",
      runId: "run_01",
      planExecutionId: "execution_01",
      planId: "plan_01",
      planRevision: 2,
      affectedStepIds: ["step_01"],
      discovery: "A new target is required.",
      proposal: "Revise the plan.",
      createdAt: "2026-07-17T02:00:00.000Z"
    };
    expect(await repository["writePlanRevisionRequest"](request)).toMatchObject({ ok: true });
    expect(await repository["readPlanRevisionRequest"]("run_01", "request_01")).toEqual({
      ok: true,
      value: request
    });
    const decision = {
      schemaVersion: "1.0",
      requestId: "request_01",
      runId: "run_01",
      planExecutionId: "execution_01",
      planId: "plan_01",
      planRevision: 2,
      commandId: "decide_01",
      decision: "approve",
      planExecutionRevision: 3,
      decidedAt: "2026-07-17T02:01:00.000Z"
    };
    expect(await repository["writePlanRevisionDecision"](decision)).toMatchObject({ ok: true });
    expect(await repository["readPlanRevisionDecision"]("run_01", "request_01")).toEqual({
      ok: true,
      value: decision
    });
    expect(
      await repository["writePlanRevisionDecision"]({ ...decision, decision: "reject" })
    ).toMatchObject({ ok: false, error: { code: "AGENT_PLAN_REVISION_DECISION_CONFLICT" } });
    expect(
      await readFile(
        join(
          projectRoot,
          "history",
          "agent-runs",
          "run_01",
          "plan-executions",
          "execution_01",
          "revisions",
          "2.json"
        ),
        "utf8"
      )
    ).toContain('"status": "running"');
  });

  test("reads v1.0 and v1.1 snapshots but rejects an unsupported schema version", async () => {
    const Repository = (repositoryExports as unknown as Record<string, unknown>)[
      "AgentRunFileRepository"
    ];
    expect(typeof Repository).toBe("function");
    if (typeof Repository !== "function") return;

    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-agent-run-version-"));
    roots.push(projectRoot);
    const repository = new (
      Repository as new (options: { projectRoot: string }) => {
        writeSnapshot(snapshot: Record<string, unknown>): Promise<unknown>;
        readSnapshot(runId: string): Promise<unknown>;
      }
    )({ projectRoot });

    const v11Snapshot = {
      schemaVersion: "1.1",
      runId: "run_v11",
      projectId: "project_01",
      status: "planning_model",
      runRevision: 1,
      lastSequence: 1,
      modelProfileId: "model_01",
      recoveryState: "none"
    };
    await repository.writeSnapshot(v11Snapshot);
    expect(await repository.readSnapshot("run_v11")).toEqual({ ok: true, value: v11Snapshot });

    // A future/unknown version is rejected on read rather than silently normalized as v1.0.
    const futureSnapshot = {
      schemaVersion: "2.0",
      runId: "run_future",
      projectId: "project_01",
      status: "planning_model",
      runRevision: 1,
      lastSequence: 1
    };
    await repository.writeSnapshot(futureSnapshot);
    expect(await repository.readSnapshot("run_future")).toMatchObject({
      ok: false,
      error: { code: "AGENT_RUN_SNAPSHOT_VERSION_UNSUPPORTED" }
    });
  });

  test("persists immutable Change Set revisions and restores the latest checkpoint revision", async () => {
    const Repository = (repositoryExports as unknown as Record<string, unknown>)[
      "AgentRunFileRepository"
    ];
    expect(typeof Repository).toBe("function");
    if (typeof Repository !== "function") return;

    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-change-set-store-"));
    roots.push(projectRoot);
    const repository = new (
      Repository as new (options: {
        projectRoot: string;
      }) => Record<string, (...args: unknown[]) => Promise<unknown>>
    )({ projectRoot });
    expect(typeof repository["writeChangeSet"]).toBe("function");
    expect(typeof repository["readChangeSet"]).toBe("function");
    expect(typeof repository["readLatestChangeSet"]).toBe("function");
    if (
      typeof repository["writeChangeSet"] !== "function" ||
      typeof repository["readChangeSet"] !== "function" ||
      typeof repository["readLatestChangeSet"] !== "function"
    )
      return;

    const revisionOne = changeSetRecord(1, "a".repeat(64));
    const revisionTwo = changeSetRecord(2, "b".repeat(64));
    await repository["writeChangeSet"]?.(revisionOne);
    await repository["writeChangeSet"]?.(revisionTwo);
    expect(
      await repository["writeChangeSet"]?.({ ...revisionOne, checksum: "f".repeat(64) })
    ).toMatchObject({ ok: false, error: { code: "AGENT_CHANGE_SET_REVISION_CONFLICT" } });

    expect(await repository["readChangeSet"]?.("changes_01", 1)).toEqual({
      ok: true,
      value: revisionOne
    });
    expect(await repository["readChangeSet"]?.("changes_01")).toEqual({
      ok: true,
      value: revisionTwo
    });
    expect(
      await repository["readLatestChangeSet"]?.({
        runId: "run_03",
        projectId: "project_01",
        checkpointId: "checkpoint_01"
      })
    ).toEqual({ ok: true, value: revisionTwo });
    expect(
      JSON.parse(
        await readFile(
          join(projectRoot, "history", "change-sets", "changes_01", "revisions", "1.json"),
          "utf8"
        )
      )
    ).toEqual(revisionOne);
  });
});

describe("AgentRunFileRepository — compaction persistence + commit marker", () => {
  function makeRepository(projectRoot: string) {
    const Repository = (repositoryExports as unknown as Record<string, unknown>)[
      "AgentRunFileRepository"
    ] as new (options: {
      projectRoot: string;
    }) => Record<string, (...args: unknown[]) => Promise<unknown>>;
    return new Repository({ projectRoot });
  }

  function v11Snapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      schemaVersion: "1.1",
      runId: "run_c1",
      projectId: "project_01",
      status: "executing_model",
      runRevision: 5,
      lastSequence: 5,
      activeCompactionId: null,
      ...overrides
    };
  }

  test("writes an immutable compaction revision and rejects a divergent rewrite", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-compaction-store-"));
    roots.push(projectRoot);
    const repository = makeRepository(projectRoot);
    const revision = {
      schemaVersion: "1.0",
      compactionId: "compaction_1",
      runId: "run_c1",
      status: "completed",
      resultSnapshotId: "context_r1",
      budgetSnapshotId: "budget_r1",
      revision: 1
    };
    expect(await repository["writeCompactionRevision"]?.(revision)).toMatchObject({ ok: true });
    // Idempotent replay.
    expect(await repository["writeCompactionRevision"]?.(revision)).toMatchObject({ ok: true });
    expect(
      await repository["writeCompactionRevision"]?.({ ...revision, status: "failed" })
    ).toMatchObject({ ok: false, error: { code: "AGENT_COMPACTION_REVISION_CONFLICT" } });
  });

  test("honors activeCompactionId only when the revision + result + budget artifacts all exist", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-compaction-honor-"));
    roots.push(projectRoot);
    const repository = makeRepository(projectRoot);

    // A committed pointer with no artifacts on disk must be dropped on read.
    await repository["writeSnapshot"]?.(v11Snapshot({ activeCompactionId: "compaction_missing" }));
    expect(await repository["readSnapshot"]?.("run_c1")).toMatchObject({
      ok: true,
      value: { activeCompactionId: null }
    });

    // Write the full artifact set, then the pointer is honored.
    await repository["writeCompactionRevision"]?.({
      schemaVersion: "1.0",
      compactionId: "compaction_ok",
      runId: "run_c1",
      status: "completed",
      resultSnapshotId: "context_ok",
      budgetSnapshotId: "budget_ok",
      revision: 1
    });
    await repository["writeContextSnapshot"]?.({
      schemaVersion: "1.1",
      runId: "run_c1",
      contextSnapshotId: "context_ok",
      sources: []
    });
    await repository["writeBudgetSnapshot"]?.("run_c1", {
      schemaVersion: "1.0",
      contextBudgetSnapshotId: "budget_ok"
    });
    await repository["commitCompaction"]?.(v11Snapshot({ activeCompactionId: "compaction_ok" }));
    expect(await repository["readSnapshot"]?.("run_c1")).toMatchObject({
      ok: true,
      value: { activeCompactionId: "compaction_ok" }
    });
  });

  test("commitCompaction is idempotent when the pointer already matches", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-compaction-commit-"));
    roots.push(projectRoot);
    const repository = makeRepository(projectRoot);
    await repository["writeCompactionRevision"]?.({
      schemaVersion: "1.0",
      compactionId: "compaction_x",
      runId: "run_c1",
      status: "completed",
      resultSnapshotId: null,
      budgetSnapshotId: null,
      revision: 1
    });
    const committed = v11Snapshot({ activeCompactionId: "compaction_x", runRevision: 6 });
    await repository["commitCompaction"]?.(committed);
    // A divergent replay (different runRevision) must return the already-committed snapshot unchanged.
    const replay = await repository["commitCompaction"]?.({ ...committed, runRevision: 99 });
    expect(replay).toMatchObject({ ok: true, value: { runRevision: 6 } });
  });
});

function changeSetRecord(revision: number, checksum: string): Record<string, unknown> {
  return {
    schemaVersion: "1.0",
    changeSetId: "changes_01",
    revision,
    runId: "run_03",
    projectId: "project_01",
    checkpointId: "checkpoint_01",
    contextSnapshotId: "context_01",
    status: "awaiting_approval",
    checksum,
    approvalToken: checksum,
    createdAt: `2026-07-13T00:0${revision}:00.000Z`,
    files: []
  };
}
