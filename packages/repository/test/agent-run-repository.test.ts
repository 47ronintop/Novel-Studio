import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDeterministicTokenEstimator } from "@novel-studio/agent-engine";
import { afterEach, describe, expect, test } from "vitest";

import * as repositoryExports from "../src/index.js";

const roots: string[] = [];

function compactionSummaryArtifact(overrides: Record<string, unknown> = {}) {
  const body =
    typeof overrides["body"] === "string"
      ? overrides["body"]
      : '{"plotFacts":[],"characterStates":[],"foreshadowing":[],"userDecisions":[]}';
  const provenance = {
    kind: "model_assisted",
    provider: "anthropic",
    model: "claude-test",
    modelProfileId: "profile-c4",
    templateVersion: "1.0",
    inputChecksum: "a".repeat(64)
  };
  const count = createDeterministicTokenEstimator().count(body, provenance.modelProfileId);
  const unsigned = {
    schemaVersion: "1.0",
    artifactId: "summary_compaction_01",
    runId: "run_01",
    compactionId: "compaction_01",
    contextProfileId: "writing",
    sourceSnapshotId: "context_01",
    throughSequence: 7,
    inputManifestChecksum: "b".repeat(64),
    body,
    provenance,
    tokenCount: count.tokens,
    checksum: checksumText(body),
    precision: count.precision,
    createdAt: "2026-07-28T00:00:00.000Z",
    ...overrides
  };
  return {
    ...unsigned,
    artifactChecksum: checksumText(stableSerialize(unsigned))
  };
}

function promptCacheArtifact(overrides: Record<string, unknown> = {}) {
  const unsigned = {
    schemaVersion: "1.0",
    artifactId: "prompt_cache_01",
    runBindingId: "run_01",
    provider: "google-gemini",
    modelName: "gemini-1.5-pro",
    connectionIdentityChecksum: "a".repeat(64),
    accountIsolationChecksum: "b".repeat(64),
    adapterVersion: "c5@1.0",
    capability: {
      mode: "explicit_resource",
      policyVersion: "gemini-explicit-resource@1.0",
      minimumCacheableTokens: 32_768,
      ttlSeconds: 3_600,
      inputTokenSemantics: "excluded_from_input",
      reportsCacheReadTokens: true,
      reportsCacheWriteTokens: false
    },
    scope: {
      kind: "workspace",
      workspaceKind: "engineeringWorkspace",
      workspaceId: "workspace_01"
    },
    contextProfileId: "engineering",
    profileVersion: "2.0",
    guidanceTemplateChecksum: "c".repeat(64),
    toolCatalogRevision: "d".repeat(64),
    logicalPrefixChecksum: "e".repeat(64),
    stablePrefixMessageCount: 3,
    eligibleInputTokens: 40_000,
    identityBaseChecksum: "f".repeat(64),
    identityChecksum: "0".repeat(64),
    createdAt: "2026-07-28T00:00:00.000Z",
    expiresAt: "2026-07-28T01:00:00.000Z",
    ...overrides
  };
  return {
    ...unsigned,
    artifactChecksum: checksumText(stableSerialize(unsigned))
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("AgentRunFileRepository", () => {
  test("persists prompt-cache identity artifacts immutably and rejects tampering or leaks", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-prompt-cache-store-"));
    roots.push(projectRoot);
    const repository = new repositoryExports.AgentRunFileRepository({ projectRoot });
    const artifact = promptCacheArtifact();

    expect(await repository.writePromptCacheArtifact("run_01", artifact)).toMatchObject({
      ok: true
    });
    expect(await repository.writePromptCacheArtifact("run_01", artifact)).toMatchObject({
      ok: true
    });
    expect(await repository.readPromptCacheArtifact("run_01", "prompt_cache_01")).toEqual({
      ok: true,
      value: artifact
    });
    expect(
      await repository.writePromptCacheArtifact(
        "run_01",
        promptCacheArtifact({ eligibleInputTokens: 40_001 })
      )
    ).toMatchObject({
      ok: false,
      error: { code: "AGENT_PROMPT_CACHE_ARTIFACT_CONFLICT" }
    });

    const artifactPath = join(
      projectRoot,
      "history",
      "agent-runs",
      "run_01",
      "prompt-cache-artifacts",
      "prompt_cache_01.json"
    );
    await writeFile(artifactPath, JSON.stringify({ ...artifact, eligibleInputTokens: 1 }), "utf8");
    expect(await repository.readPromptCacheArtifact("run_01", "prompt_cache_01")).toMatchObject({
      ok: false,
      error: { code: "AGENT_PROMPT_CACHE_ARTIFACT_INVALID" }
    });

    for (const leaked of [
      promptCacheArtifact({ resourceRef: "cachedContents/private" }),
      promptCacheArtifact({ apiKey: "private-provider-key" }),
      promptCacheArtifact({ metadata: { prompt: "full provider prompt" } }),
      promptCacheArtifact({ metadata: { path: "D:/private/project" } }),
      promptCacheArtifact({ metadata: { account: "secret://model-key" } })
    ]) {
      expect(await repository.writePromptCacheArtifact("run_leak", leaked)).toMatchObject({
        ok: false,
        error: { code: "AGENT_PROMPT_CACHE_ARTIFACT_INVALID" }
      });
    }
  });

  test("persists immutable compaction summary artifacts", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-summary-store-"));
    roots.push(projectRoot);
    const repository = new repositoryExports.AgentRunFileRepository({ projectRoot });
    const artifact = compactionSummaryArtifact();

    expect(await repository.writeCompactionSummaryArtifact("run_01", artifact)).toMatchObject({
      ok: true
    });
    expect(await repository.writeCompactionSummaryArtifact("run_01", artifact)).toMatchObject({
      ok: true
    });
    expect(await repository.readCompactionSummaryArtifact("run_01", artifact.artifactId)).toEqual({
      ok: true,
      value: artifact
    });
    expect(
      await repository.writeCompactionSummaryArtifact("run_01", {
        ...compactionSummaryArtifact({
          body: '{"plotFacts":["changed"],"characterStates":[],"foreshadowing":[],"userDecisions":[]}'
        })
      })
    ).toMatchObject({
      ok: false,
      error: { code: "AGENT_COMPACTION_SUMMARY_ARTIFACT_CONFLICT" }
    });
    expect(await repository.readCompactionSummaryArtifact("run_01", "../summary")).toMatchObject({
      ok: false,
      error: { code: "AGENT_COMPACTION_SUMMARY_ARTIFACT_INVALID" }
    });
    await writeFile(
      join(
        projectRoot,
        "history",
        "agent-runs",
        "run_01",
        "compaction-summaries",
        `${String(artifact["artifactId"])}.json`
      ),
      JSON.stringify({ ...artifact, precision: "reported" }),
      "utf8"
    );
    expect(
      await repository.readCompactionSummaryArtifact("run_01", String(artifact["artifactId"]))
    ).toMatchObject({
      ok: false,
      error: { code: "AGENT_COMPACTION_SUMMARY_ARTIFACT_INVALID" }
    });
  });

  test("persists immutable context source materializations and rejects divergent rewrites", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-context-source-store-"));
    roots.push(projectRoot);
    const repository = new repositoryExports.AgentRunFileRepository({ projectRoot });
    const artifact = {
      schemaVersion: "1.0",
      artifactId: "context_source_project_conventions_01",
      refId: "project_conventions_01",
      sourceKind: "project_conventions",
      content: "Project rules",
      materialization: { kind: "project_conventions" },
      checksum: "a".repeat(64)
    };

    expect(await repository.writeContextSourceMaterialization("run_01", artifact)).toMatchObject({
      ok: true
    });
    expect(await repository.writeContextSourceMaterialization("run_01", artifact)).toMatchObject({
      ok: true
    });
    expect(
      await repository.readContextSourceMaterialization(
        "run_01",
        "context_source_project_conventions_01"
      )
    ).toEqual({ ok: true, value: artifact });
    expect(
      await repository.writeContextSourceMaterialization("run_01", {
        ...artifact,
        content: "Different rules"
      })
    ).toMatchObject({
      ok: false,
      error: { code: "AGENT_CONTEXT_SOURCE_MATERIALIZATION_CONFLICT" }
    });
    expect(
      await repository.readContextSourceMaterialization("run_01", "../artifact")
    ).toMatchObject({
      ok: false,
      error: { code: "AGENT_CONTEXT_SOURCE_MATERIALIZATION_INVALID" }
    });
  });

  test("persists immutable tool catalogs and rejects invalid or conflicting catalog identities", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-tool-catalog-store-"));
    roots.push(projectRoot);
    const Repository = repositoryExports.AgentRunFileRepository as unknown as new (options: {
      projectRoot: string;
    }) => {
      writeToolCatalog(runId: string, catalog: Record<string, unknown>): Promise<unknown>;
      readToolCatalog(runId: string, catalogId: string): Promise<unknown>;
    };
    const repository = new Repository({ projectRoot });
    const catalog = {
      schemaVersion: "1.0",
      toolCatalogSnapshotId: "tool_catalog_run_01",
      runId: "run_01",
      facadeVersion: "v2",
      descriptors: [],
      descriptorRevision: "a".repeat(64),
      providerMappingRevision: "b".repeat(64),
      catalogRevision: "c".repeat(64),
      createdAt: "2026-07-26T00:00:00.000Z"
    };

    expect(await repository.writeToolCatalog("run_01", catalog)).toMatchObject({ ok: true });
    expect(await repository.writeToolCatalog("run_01", catalog)).toMatchObject({ ok: true });
    expect(await repository.readToolCatalog("run_01", "tool_catalog_run_01")).toEqual({
      ok: true,
      value: catalog
    });
    expect(
      await repository.writeToolCatalog("run_01", {
        ...catalog,
        createdAt: "2026-07-27T00:00:00.000Z"
      })
    ).toMatchObject({ ok: false, error: { code: "AGENT_TOOL_CATALOG_CONFLICT" } });
    expect(await repository.writeToolCatalog("../run", catalog)).toMatchObject({
      ok: false,
      error: { code: "AGENT_TOOL_CATALOG_INVALID" }
    });
    expect(
      await repository.writeToolCatalog("run_01", {
        ...catalog,
        toolCatalogSnapshotId: "../catalog"
      })
    ).toMatchObject({ ok: false, error: { code: "AGENT_TOOL_CATALOG_INVALID" } });
    expect(await repository.readToolCatalog("run_01", "../catalog")).toMatchObject({
      ok: false,
      error: { code: "AGENT_TOOL_CATALOG_INVALID" }
    });
  });

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
    expect(typeof repository["writePromptMaterialization"]).toBe("function");
    expect(typeof repository["readPromptMaterialization"]).toBe("function");
    expect(typeof repository["writePlanArtifact"]).toBe("function");
    expect(typeof repository["readPlanArtifact"]).toBe("function");
    expect(typeof repository["listSnapshots"]).toBe("function");
    expect(typeof repository["readCommandReceipt"]).toBe("function");
    expect(typeof repository["writeRetryCheckpoint"]).toBe("function");
    expect(typeof repository["readRetryCheckpoint"]).toBe("function");
    if (
      typeof repository["writeContextSnapshot"] !== "function" ||
      typeof repository["readContextSnapshot"] !== "function" ||
      typeof repository["writePromptMaterialization"] !== "function" ||
      typeof repository["readPromptMaterialization"] !== "function" ||
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
    const promptMaterialization = {
      schemaVersion: "1.0",
      artifactId: "prompt_context_02",
      runId: "run_02",
      contextSnapshotId: "context_02",
      checksum: "a".repeat(64)
    };
    await repository["writeSnapshot"]?.(snapshot);
    await repository["writeContextSnapshot"]?.(contextSnapshot);
    await repository["writePromptMaterialization"]?.("run_02", promptMaterialization);
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
    expect(await repository["readPromptMaterialization"]?.("run_02", "prompt_context_02")).toEqual({
      ok: true,
      value: promptMaterialization
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

    const legacyMatrix = JSON.parse(
      await readFile(
        join(
          process.cwd(),
          "apps",
          "desktop",
          "test",
          "fixtures",
          "agent-legacy-contract-matrix.json"
        ),
        "utf8"
      )
    ) as {
      legacyPendingChangeSet: {
        record: Record<string, unknown>;
        migrationExpectation: Record<string, unknown>;
      };
    };
    const legacyPending = legacyMatrix.legacyPendingChangeSet.record;
    expect(await repository["writeChangeSet"]?.(legacyPending)).toMatchObject({ ok: true });
    expect(
      await repository["readChangeSet"]?.(
        String(legacyPending["changeSetId"]),
        Number(legacyPending["revision"])
      )
    ).toEqual({ ok: true, value: legacyPending });
    expect(legacyMatrix.legacyPendingChangeSet.migrationExpectation).toMatchObject({
      disposition: "view_or_reject_only",
      v2ApplyAllowed: false,
      rebuildRequiredForExecution: true,
      ownerTask: "1.2b"
    });
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

  test("requires the immutable summary and prompt before honoring model-assisted compaction", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-compaction-summary-honor-"));
    roots.push(projectRoot);
    const repository = makeRepository(projectRoot);
    const body =
      '{"modifiedFiles":["src/index.ts"],"changeIntent":["Fix parsing"],"todos":[],"errorHighlights":[],"nextSteps":["Run tests"]}';
    const summary = compactionSummaryArtifact({
      artifactId: "summary_compaction_model",
      runId: "run_c1",
      compactionId: "compaction_model",
      contextProfileId: "engineering",
      sourceSnapshotId: "context_before_model",
      throughSequence: 9,
      inputManifestChecksum: "c".repeat(64),
      body
    });
    const promptArtifactId = "prompt_context_after_model";
    const resultSnapshotId = "context_after_model";
    await repository["writeCompactionRevision"]?.({
      schemaVersion: "1.0",
      compactionId: "compaction_model",
      runId: "run_c1",
      sourceSnapshotId: "context_before_model",
      resultSnapshotId,
      budgetSnapshotId: "budget_after_model",
      inputManifestChecksum: "c".repeat(64),
      throughSequence: 9,
      strategy: "model_assisted",
      summaryChecksum: summary["checksum"],
      status: "completed",
      revision: 1
    });
    await repository["writePromptMaterialization"]?.("run_c1", {
      schemaVersion: "1.1",
      artifactId: promptArtifactId,
      runId: "run_c1",
      contextSnapshotId: resultSnapshotId,
      contextSources: [
        {
          refId: "compaction_summary",
          sourceKind: "compaction_summary",
          assetId: summary["artifactId"],
          sourceRevision: 9,
          content: body
        }
      ]
    });
    await repository["writeContextSnapshot"]?.({
      schemaVersion: "1.3",
      runId: "run_c1",
      contextSnapshotId: resultSnapshotId,
      contextProfileId: "engineering",
      sources: [
        {
          refId: "compaction_summary",
          sourceKind: "compaction_summary",
          assetId: summary["artifactId"],
          artifactId: promptArtifactId,
          checksum: summary["checksum"],
          sourceRevision: 9,
          state: "active"
        }
      ]
    });
    await repository["writeBudgetSnapshot"]?.("run_c1", {
      schemaVersion: "1.1",
      contextBudgetSnapshotId: "budget_after_model"
    });
    const committed = v11Snapshot({
      activeCompactionId: "compaction_model",
      contextSnapshotId: resultSnapshotId,
      contextBudgetSnapshotId: "budget_after_model"
    });
    expect(await repository["commitCompaction"]?.(committed)).toMatchObject({
      ok: false,
      error: { code: "AGENT_COMPACTION_COMMIT_INVALID" }
    });

    await repository["writeCompactionSummaryArtifact"]?.("run_c1", summary);
    expect(await repository["commitCompaction"]?.(committed)).toMatchObject({ ok: true });
    expect(await repository["readSnapshot"]?.("run_c1")).toMatchObject({
      ok: true,
      value: { activeCompactionId: "compaction_model" }
    });

    await rm(
      join(
        projectRoot,
        "history",
        "agent-runs",
        "run_c1",
        "compaction-summaries",
        `${String(summary["artifactId"])}.json`
      )
    );
    expect(await repository["readSnapshot"]?.("run_c1")).toMatchObject({
      ok: true,
      value: { activeCompactionId: null }
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

  test("persists immutable run and preflight error records in their separate history roots", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-agent-errors-"));
    roots.push(projectRoot);
    const repository = makeRepository(projectRoot);
    const runError = errorRecord({ errorId: "err_run_01", runId: "run_01" });
    const preflightError = errorRecord({
      errorId: "err_draft_01",
      runId: undefined,
      runDraftId: "draft_01"
    });

    expect(await repository["writeRunError"]?.("run_01", runError)).toMatchObject({ ok: true });
    expect(await repository["writePreflightError"]?.(preflightError)).toMatchObject({ ok: true });
    expect(await repository["readRunError"]?.("run_01", "err_run_01")).toEqual({
      ok: true,
      value: runError
    });
    expect(await repository["readPreflightError"]?.("err_draft_01")).toEqual({
      ok: true,
      value: preflightError
    });
    expect(
      await readFile(
        join(projectRoot, "history", "agent-runs", "run_01", "errors", "err_run_01.json"),
        "utf8"
      )
    ).toContain('"errorId": "err_run_01"');
    expect(
      await readFile(join(projectRoot, "history", "agent-diagnostics", "err_draft_01.json"), "utf8")
    ).toContain('"runDraftId": "draft_01"');

    expect(await repository["writeRunError"]?.("run_01", runError)).toMatchObject({ ok: true });
    expect(
      await repository["writeRunError"]?.("run_01", {
        ...runError,
        message: "divergent rewrite"
      })
    ).toMatchObject({ ok: false, error: { code: "AGENT_RUN_ERROR_RECORD_CONFLICT" } });

    expect(
      await repository["writeRunError"]?.(
        "run_01",
        errorRecord({
          errorId: "err_unsafe",
          runId: "run_01",
          redactedDetail: { nested: { stack: "must not persist" } }
        })
      )
    ).toMatchObject({ ok: false, error: { code: "AGENT_RUN_ERROR_RECORD_INVALID" } });
    expect(await repository["readRunError"]?.("run_01", "err_unsafe")).toEqual({
      ok: true,
      value: undefined
    });
  });

  test("serializes concurrent divergent writes to the same immutable error ID", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-agent-error-race-"));
    roots.push(projectRoot);
    const repository = makeRepository(projectRoot);

    for (let index = 0; index < 8; index += 1) {
      const errorId = `err_race_${String(index)}`;
      const first = errorRecord({ errorId, runId: "run_race", message: "first write" });
      const second = errorRecord({ errorId, runId: "run_race", message: "second write" });
      const results = (await Promise.all([
        repository["writeRunError"]?.("run_race", first),
        repository["writeRunError"]?.("run_race", second)
      ])) as Array<
        { ok: true; value: Record<string, unknown> } | { ok: false; error: Record<string, unknown> }
      >;
      const succeeded = results.filter(
        (result): result is { ok: true; value: Record<string, unknown> } => result.ok
      );
      const failed = results.filter(
        (result): result is { ok: false; error: Record<string, unknown> } => !result.ok
      );

      expect(succeeded).toHaveLength(1);
      expect(failed).toHaveLength(1);
      expect(failed[0]).toMatchObject({
        error: { code: "AGENT_RUN_ERROR_RECORD_CONFLICT" }
      });
      expect(await repository["readRunError"]?.("run_race", errorId)).toEqual({
        ok: true,
        value: succeeded[0]?.value
      });
    }
  });

  test("enforces both count and total-size retention for preflight diagnostics", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-preflight-retention-"));
    roots.push(projectRoot);
    const Repository = repositoryExports.AgentRunFileRepository as unknown as new (options: {
      projectRoot: string;
      preflightErrorMaxRecords: number;
      preflightErrorMaxBytes: number;
    }) => Record<string, (...args: unknown[]) => Promise<unknown>>;
    const maxBytes = 1_300;
    const repository = new Repository({
      projectRoot,
      preflightErrorMaxRecords: 2,
      preflightErrorMaxBytes: maxBytes
    });

    for (let index = 1; index <= 4; index += 1) {
      expect(
        await repository["writePreflightError"]?.(
          errorRecord({
            errorId: `err_draft_0${index}`,
            runId: undefined,
            runDraftId: `draft_0${index}`,
            createdAt: `2026-07-17T12:00:0${index}.000Z`,
            redactedDetail: { summary: String(index).repeat(240) }
          })
        )
      ).toMatchObject({ ok: true });
    }

    const root = join(projectRoot, "history", "agent-diagnostics");
    const files = (await readdir(root)).filter((entry) => entry.endsWith(".json"));
    const totalBytes = (await Promise.all(files.map((file) => readFile(join(root, file))))).reduce(
      (total, value) => total + value.byteLength,
      0
    );
    expect(files.length).toBeLessThanOrEqual(2);
    expect(totalBytes).toBeLessThanOrEqual(maxBytes);
    expect(files).toContain("err_draft_04.json");
    expect(await repository["readPreflightError"]?.("err_draft_01")).toEqual({
      ok: true,
      value: undefined
    });
  });
});

function checksumText(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableSerialize(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

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

function errorRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: "1.0",
    errorId: "err_01",
    projectId: "project_01",
    runId: "run_01",
    sequence: 4,
    category: "AgentError",
    code: "AGENT_PROVIDER_DISCONNECTED",
    message: "The provider connection was interrupted.",
    recoverability: "retryable",
    suggestedActions: ["Retry the interrupted model round."],
    redactedDetail: {},
    recoveryState: "retryable",
    retryTargets: [{ kind: "model_round", id: "round_01" }],
    createdAt: "2026-07-17T12:00:00.000Z",
    ...overrides
  };
}
