import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { createAgentContextSession } from "@novel-studio/application";
import type { AgentContextBudgetInputsPort, AgentRunDraftSession } from "@novel-studio/application";
import { AgentRunFileRepository, AgentUsageFileRepository } from "@novel-studio/repository";
import { ok, type JsonObject } from "@novel-studio/shared";

import { createDesktopCompactionSources } from "../src/main/agent-compaction-composer.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("desktop compaction composer", () => {
  test("evicts raw tool results, preserves protected facts, and commits pointer-last", async () => {
    const { repository, usageRepository, projectRoot } = await seedRun();
    const session = createAgentContextSession({
      draftSession: stubDraftSession(),
      budgetInputs: stubBudgetInputs(),
      compactionSources: createDesktopCompactionSources({
        repository,
        now: () => "2026-07-16T00:00:00.000Z"
      }),
      runRepository: {
        writeCompactionManifest: (manifest) => repository.writeCompactionManifest(manifest),
        writeCompactionRevision: (revision) => repository.writeCompactionRevision(revision),
        writeContextSnapshot: (snapshot) => repository.writeContextSnapshot(snapshot),
        writeBudgetSnapshot: (runId, snapshot) => repository.writeBudgetSnapshot(runId, snapshot),
        commitCompaction: (snapshot) => repository.commitCompaction(snapshot)
      },
      usageSink: { writeFinal: (record) => usageRepository.writeFinal(record) },
      createCompactionId: () => "compaction_01",
      now: () => "2026-07-16T00:00:00.000Z"
    });

    const result = await session.compactContext({
      projectId: "project_01",
      runId: "run_01",
      commandId: "cmd_01",
      expectedRunRevision: 3,
      contextBudgetSnapshotId: "budget_target_01",
      trigger: "manual"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.compactionId).toBe("compaction_01");
    expect(result.value.revision.status).toBe("completed");
    expect(result.value.revision.evictedSourceIds).toEqual(["file:draft-notes.md"]);

    // The committed run.json points at the new compaction + result/budget snapshots.
    const runJson = JSON.parse(
      await readFile(join(projectRoot, "history", "agent-runs", "run_01", "run.json"), "utf8")
    ) as JsonObject;
    expect(runJson["activeCompactionId"]).toBe("compaction_01");
    expect(runJson["contextSnapshotId"]).toBe("context_run_01_c1");

    // The result snapshot keeps the protected chapter source active and excludes the evicted note.
    const resultSnapshot = await repository.readContextSnapshot("run_01", "context_run_01_c1");
    expect(resultSnapshot.ok).toBe(true);
    if (!resultSnapshot.ok || resultSnapshot.value === undefined) return;
    const sources = resultSnapshot.value["sources"] as { refId: string; state: string }[];
    expect(sources.find((s) => s.refId === "chapter:ch-01")?.state).toBe("active");
    expect(sources.find((s) => s.refId === "file:draft-notes.md")?.state).toBe("excluded");

    // A redacted usage record for the compaction round was written under the user-data root.
    const usage = await usageRepository.readById("usage_compaction_01");
    expect(usage.ok).toBe(true);
    if (!usage.ok) return;
    expect(usage.value?.["terminationReason"]).toBe("context_compaction");
    expect(usage.value?.["compactionAfterTokens"]).toBe(4000);
  });

  test("returns the unavailable guard when compaction ports are absent", async () => {
    const session = createAgentContextSession({
      draftSession: stubDraftSession(),
      budgetInputs: stubBudgetInputs()
    });
    const result = await session.compactContext({
      projectId: "project_01",
      runId: "run_01",
      commandId: "cmd_01",
      expectedRunRevision: 3,
      contextBudgetSnapshotId: "budget_target_01",
      trigger: "manual"
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("AGENT_CONTEXT_COMPACTION_UNAVAILABLE");
  });

  test("loads the run's latest plan execution record as protected compaction input", async () => {
    const { repository } = await seedRun();
    const execution: JsonObject = {
      schemaVersion: "1.0",
      planExecutionId: "execution_01",
      runId: "run_01",
      planId: "plan_01",
      planRevision: 2,
      handoffContextMode: "writing",
      handoffWritePolicy: "write_before_confirmation",
      revision: 3,
      steps: [
        {
          stepId: "step_01",
          title: "Read chapter",
          status: "completed",
          startedAt: "2026-07-17T01:00:00.000Z",
          completedAt: "2026-07-17T01:01:00.000Z",
          verification: ["chapter_03@7"],
          deviationKind: "none",
          blockedReason: null,
          checkpointId: "checkpoint_01",
          eventSequence: 12
        }
      ]
    };
    expect(await repository.writePlanExecutionRecord(execution)).toMatchObject({ ok: true });
    const run = await repository.readSnapshot("run_01");
    if (!run.ok || run.value === undefined) throw new Error("seed run missing");
    await repository.writeSnapshot({
      ...run.value,
      operationMode: "execution",
      planExecutionId: "execution_01",
      planExecutionRevision: 3
    });

    const sources = createDesktopCompactionSources({ repository });
    const loaded = await sources.loadInputs({
      projectId: "project_01",
      runId: "run_01",
      commandId: "cmd_execution",
      expectedRunRevision: 3,
      contextBudgetSnapshotId: "budget_target_01",
      trigger: "manual"
    });
    expect(loaded).toMatchObject({
      ok: true,
      value: {
        planExecutionRecord: {
          planExecutionId: "execution_01",
          revision: 3,
          steps: [{ stepId: "step_01", status: "completed" }]
        }
      }
    });
  });
});

async function seedRun(): Promise<{
  repository: AgentRunFileRepository;
  usageRepository: AgentUsageFileRepository;
  projectRoot: string;
}> {
  const projectRoot = await mkdtemp(join(tmpdir(), "ns-compact-proj-"));
  const userDataRoot = await mkdtemp(join(tmpdir(), "ns-compact-user-"));
  roots.push(projectRoot, userDataRoot);
  const repository = new AgentRunFileRepository({ projectRoot, traceId: "test" });
  const usageRepository = new AgentUsageFileRepository({ userDataRoot, traceId: "test" });

  const source = (
    refId: string,
    layer: string,
    tokenCount: number,
    extra: JsonObject = {}
  ): JsonObject => ({
    refId,
    sourceKind: "disk_file",
    checksum: checksumText(`${refId}-body`),
    dirty: false,
    capturedAt: "2026-07-15T00:00:00.000Z",
    layer,
    sourceRevision: 1,
    tokenCount,
    precision: "estimated",
    state: "active",
    ...extra
  });

  const snapshot: JsonObject = {
    schemaVersion: "1.1",
    contextSnapshotId: "context_run_01",
    runId: "run_01",
    createdAt: "2026-07-15T00:00:00.000Z",
    compactionRevision: 0,
    sources: [
      source("chapter:ch-01", "explicit_ref", 4000, { relativePath: "chapters/ch-01.md" }),
      source("file:draft-notes.md", "tool_result", 20000, { relativePath: "draft-notes.md" })
    ],
    excludedSources: []
  };
  const written = await repository.writeContextSnapshot(snapshot);
  expect(written.ok).toBe(true);

  const run: JsonObject = {
    schemaVersion: "1.1",
    runId: "run_01",
    projectId: "project_01",
    conversationId: "conv_01",
    operationMode: "planning",
    contextMode: "writing",
    writePolicy: "write_before_confirmation",
    userRequest: "Review the chapter",
    status: "planning_model",
    runRevision: 3,
    lastSequence: 7,
    startedAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    limits: { maxModelRounds: 20, maxToolCalls: 50, maxConsecutiveToolFailures: 3 },
    modelProfileId: "profile_01",
    providerCapabilitySnapshot: {
      profileId: "profile_01",
      provider: "demo",
      modelName: "demo-model",
      streaming: true,
      toolCalling: true,
      structuredArguments: true,
      contextWindow: 40000,
      requiredContextTokens: 8000
    },
    permissionSummaryId: null,
    permissionSummaryChecksum: null,
    contextSnapshotId: "context_run_01",
    activeCompactionId: null,
    planExecutionId: null,
    planExecutionRevision: null,
    activeErrorId: null,
    recoveryState: "none",
    pendingUserInputId: null,
    sourcePlanId: null,
    sourcePlanRevision: null,
    usageSummary: {
      inputTokens: 24000,
      outputTokens: 0,
      totalTokens: 24000,
      usageStatus: "estimated"
    }
  };
  const runWritten = await repository.writeSnapshot(run);
  expect(runWritten.ok).toBe(true);
  return { repository, usageRepository, projectRoot };
}

function stubDraftSession(): Pick<AgentRunDraftSession, "resolveStartDraft"> {
  return {
    resolveStartDraft: () => Promise.resolve(ok({ runDraft: {}, contextDraft: {} } as never))
  };
}

function stubBudgetInputs(): AgentContextBudgetInputsPort {
  return {
    resolveBudgetInputs: () =>
      Promise.resolve(
        ok({
          model: {
            provider: "demo",
            model: "demo-model",
            contextWindow: 40000,
            toolReserve: 0,
            systemReserve: 0,
            requiredContextTokens: 8000
          },
          contents: []
        })
      )
  };
}

function checksumText(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
