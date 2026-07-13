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
    expect(typeof repository["writePlanArtifact"]).toBe("function");
    expect(typeof repository["listSnapshots"]).toBe("function");
    expect(typeof repository["readCommandReceipt"]).toBe("function");
    if (
      typeof repository["writeContextSnapshot"] !== "function" ||
      typeof repository["writePlanArtifact"] !== "function" ||
      typeof repository["listSnapshots"] !== "function" ||
      typeof repository["readCommandReceipt"] !== "function"
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
    await repository["writeCommandReceipt"]?.("run_02", "answer_02", {
      ok: true,
      value: snapshot
    });

    expect(await repository["listSnapshots"]?.("project_01")).toEqual({
      ok: true,
      value: [snapshot]
    });
    expect(await repository["readCommandReceipt"]?.("run_02", "answer_02")).toMatchObject({
      ok: true,
      value: { ok: true }
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
});
