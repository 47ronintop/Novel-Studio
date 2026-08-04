import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  AgentRunFileRepository,
  parseAgentRunEventV20,
  parseAgentRunSnapshotV20,
  type AgentRunEventV20,
  type AgentRunSnapshotV20
} from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function snapshot(): AgentRunSnapshotV20 {
  return parseAgentRunSnapshotV20({
    schemaVersion: "2.0",
    runId: "run_v20_01",
    scope: {
      kind: "workspace",
      workspaceKind: "engineeringWorkspace",
      workspaceId: "workspace_01"
    },
    conversationId: "conversation_01",
    operationMode: "execution",
    contextMode: "general_file",
    writePolicy: "write_before_confirmation",
    userRequest: "Apply the verified change.",
    status: "executing_model",
    runRevision: 1,
    lastSequence: 1,
    startedAt: "2026-08-04T00:00:00.000Z",
    updatedAt: "2026-08-04T00:00:00.000Z",
    limits: { maxModelRounds: 20, maxToolCalls: 50, maxConsecutiveToolFailures: 3 },
    providerCapabilitySnapshot: {
      profileId: "profile_01",
      provider: "openai",
      modelName: "gpt-test",
      streaming: true,
      toolCalling: true,
      structuredArguments: true,
      contextWindow: 128_000,
      requiredContextTokens: 4_096,
      promptCache: {
        mode: "none",
        policyVersion: "none@1.0",
        minimumCacheableTokens: 0,
        ttlSeconds: null,
        inputTokenSemantics: "unavailable",
        reportsCacheReadTokens: false,
        reportsCacheWriteTokens: false
      }
    },
    pendingUserInputId: null,
    contextSnapshotId: null,
    sourcePlanId: null,
    sourcePlanRevision: null,
    pendingChangeSetId: null,
    pendingChangeSetRevision: null,
    pendingChangeSetChecksum: null,
    versionGroupId: null,
    modelProfileId: "profile_01",
    permissionSummaryId: null,
    permissionSummaryChecksum: null,
    contextBudgetSnapshotId: null,
    activeCompactionId: null,
    planExecutionId: null,
    planExecutionRevision: null,
    activeErrorId: null,
    recoveryState: "none",
    usageSummary: {
      inputTokens: 0,
      outputTokens: 0,
      cacheOutcome: "unknown",
      cacheUsageStatus: "unavailable",
      cacheInputTokenSemantics: "unavailable",
      totalTokens: 0,
      usageStatus: "missing"
    },
    toolFacadeVersion: "v2",
    toolCatalogSnapshotId: "catalog_01",
    toolCatalogRevision: "catalog-v2-r1",
    pendingToolApproval: null,
    contextProfileId: "engineering",
    profileVersion: "3.0",
    guidanceTemplateChecksum: "d".repeat(64),
    conventionsArtifactId: null,
    promptCachePolicyVersion: "none@1.0",
    cachePrefixChecksum: "e".repeat(64),
    promptCacheArtifactId: null,
    promptCacheIdentityBaseChecksum: "f".repeat(64),
    promptCacheIdentityChecksum: "0".repeat(64),
    promptCacheStablePrefixMessageCount: 0,
    finishContractVersion: "2.0",
    finishReport: null,
    executionWritePolicyDraft: "write_before_confirmation",
    providerSemanticVersionSetChecksum: "a".repeat(64),
    authority: {
      contractVersion: "2.0",
      registryKey: "engineering.execution.3.0",
      guidanceChecksum: "b".repeat(64)
    },
    protocol: {
      contractVersion: "2.0",
      finishContractVersion: "2.0",
      pendingContractVersion: "2.0"
    },
    catalog: {
      contractVersion: "2.0",
      facadeVersion: "v2",
      snapshotId: "catalog_01",
      revision: "catalog-v2-r1",
      checksum: "c".repeat(64)
    },
    capabilities: { contractVersion: "2.0", revision: 1, state: "active", changeReason: null },
    pending: { kind: "none" },
    finish: { state: "not_finished", report: null }
  });
}

function event(sequence = 1): AgentRunEventV20 {
  return parseAgentRunEventV20({
    schemaVersion: "2.0",
    runId: "run_v20_01",
    scope: {
      kind: "workspace",
      workspaceKind: "engineeringWorkspace",
      workspaceId: "workspace_01"
    },
    sequence,
    runRevision: 1,
    type: "run_started",
    createdAt: "2026-08-04T00:00:00.000Z"
  });
}

describe("strict Agent run V20 persistence", () => {
  test("round-trips V20 snapshots and events only through the strict APIs", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-agent-run-v20-"));
    roots.push(projectRoot);
    const repository = new AgentRunFileRepository({ projectRoot });

    expect(await repository.writeSnapshotV20(snapshot())).toMatchObject({ ok: true });
    expect(await repository.appendEventV20(event())).toMatchObject({ ok: true });
    expect(await repository.readSnapshotV20("run_v20_01")).toEqual({ ok: true, value: snapshot() });
    expect(await repository.readEventsV20("run_v20_01")).toEqual({ ok: true, value: [event()] });
    expect(await repository.listSnapshots("workspace_01")).toMatchObject({
      ok: true,
      value: [{ schemaVersion: "2.0", runId: "run_v20_01" }]
    });
    await expect(repository.readSnapshot("run_v20_01")).resolves.toMatchObject({
      ok: false,
      error: { code: "AGENT_RUN_SNAPSHOT_VERSION_UNSUPPORTED" }
    });
    await expect(
      repository.writeSnapshot(snapshot() as unknown as Record<string, never>)
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "AGENT_RUN_SNAPSHOT_V20_REQUIRES_STRICT_WRITER" }
    });
  });

  test("rejects unknown fields, incoherent pending state, and event sequence gaps", async () => {
    expect(() => parseAgentRunSnapshotV20({ ...snapshot(), legacyOptional: true })).toThrow(
      "AGENT_RUN_SNAPSHOT_V20_UNKNOWN_FIELD"
    );
    expect(() =>
      parseAgentRunSnapshotV20({
        ...snapshot(),
        status: "awaiting_write_approval",
        pending: { kind: "none" }
      })
    ).toThrow("AGENT_RUN_SNAPSHOT_V20_INVARIANT_INVALID");
    expect(() => parseAgentRunEventV20({ ...event(), detail: [], ignored: true })).toThrow(
      "AGENT_RUN_EVENT_V20_UNKNOWN_FIELD"
    );
    expect(() =>
      parseAgentRunSnapshotV20({
        ...snapshot(),
        status: "completed",
        finish: {
          state: "completed",
          report: {
            schemaVersion: "2.0",
            outcome: "blocked",
            report: {
              result: "The result is complete.",
              appliedChanges: [],
              verification: ["not-run: no verification tool was available"],
              residualRisks: []
            },
            evidenceRefs: ["run-event/1/completion_evidence_recorded/complete"]
          }
        }
      })
    ).toThrow("AGENT_RUN_SNAPSHOT_V20_INVALID");

    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-agent-run-v20-sequence-"));
    roots.push(projectRoot);
    const repository = new AgentRunFileRepository({ projectRoot });
    expect(await repository.appendEventV20(event(2))).toMatchObject({
      ok: false,
      error: { code: "AGENT_RUN_EVENT_V20_SEQUENCE_INVALID" }
    });
    expect(await repository.appendEventV20(event())).toMatchObject({ ok: true });
    expect(await repository.appendEventV20(event(4))).toMatchObject({
      ok: false,
      error: { code: "AGENT_RUN_EVENT_V20_SEQUENCE_INVALID" }
    });
  });

  test("fails closed when persisted V20 JSON has been tampered with", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-agent-run-v20-tampered-"));
    roots.push(projectRoot);
    const repository = new AgentRunFileRepository({ projectRoot });
    const path = join(projectRoot, "history", "agent-runs", "run_v20_01", "run.json");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ ...snapshot(), injectedAuthority: true }), "utf8");

    expect(await repository.readSnapshotV20("run_v20_01")).toMatchObject({
      ok: false,
      error: { code: "AGENT_RUN_SNAPSHOT_V20_INVALID" }
    });
  });

  test("replays an interrupted event/snapshot commit before exposing the run", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-agent-run-v20-recovery-"));
    roots.push(projectRoot);
    const repository = new AgentRunFileRepository({ projectRoot });
    const runRoot = join(projectRoot, "history", "agent-runs", "run_v20_01");
    await mkdir(runRoot, { recursive: true });
    await writeFile(join(runRoot, "events.json"), `${JSON.stringify([event()])}\n`, "utf8");
    await writeFile(
      join(runRoot, "v20-state-commit.json"),
      `${JSON.stringify({
        schemaVersion: "2.0",
        commitId: "commit_recovery_01",
        runId: "run_v20_01",
        snapshot: snapshot(),
        event: event(),
        createdAt: event().createdAt
      })}\n`,
      "utf8"
    );

    await expect(repository.readSnapshotV20("run_v20_01")).resolves.toEqual({
      ok: true,
      value: snapshot()
    });
    await expect(repository.readEventsV20("run_v20_01")).resolves.toEqual({
      ok: true,
      value: [event()]
    });
    await expect(readFile(join(runRoot, "v20-state-commit.json"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  test("commits validated event/snapshot pairs atomically and rejects a divergent pair", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-agent-run-v20-pair-"));
    roots.push(projectRoot);
    const repository = new AgentRunFileRepository({ projectRoot });
    const initial = snapshot();
    expect(await repository.commitRunStateV20({ snapshot: initial, event: event() })).toMatchObject(
      {
        ok: true,
        value: { runRevision: 1, lastSequence: 1 }
      }
    );

    const updatedAt = "2026-08-04T00:00:01.000Z";
    const next = parseAgentRunSnapshotV20({
      ...initial,
      runRevision: 2,
      lastSequence: 2,
      updatedAt
    });
    const evidence = parseAgentRunEventV20({
      schemaVersion: "2.0",
      runId: initial.runId,
      scope: initial.scope,
      sequence: 2,
      runRevision: 2,
      type: "completion_evidence_recorded",
      createdAt: updatedAt,
      detail: { kind: "read_only_complete" }
    });
    expect(await repository.commitRunStateV20({ snapshot: next, event: evidence })).toMatchObject({
      ok: true,
      value: { runRevision: 2, lastSequence: 2 }
    });
    await expect(repository.readEventsV20(initial.runId)).resolves.toMatchObject({
      ok: true,
      value: [{ type: "run_started" }, { type: "completion_evidence_recorded" }]
    });

    const divergent = parseAgentRunEventV20({
      ...evidence,
      runRevision: 3
    });
    await expect(
      repository.commitRunStateV20({ snapshot: next, event: divergent })
    ).resolves.toMatchObject({ ok: false, error: { code: "AGENT_RUN_V20_COMMIT_INVALID" } });
  });
});
