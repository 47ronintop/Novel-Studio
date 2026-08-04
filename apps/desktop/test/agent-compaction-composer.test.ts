import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  createAgentContextSession,
  createAgentPricingRegistry,
  createCompactionSummaryArtifact,
  buildCompactionSummaryPrompt,
  buildAgentSystemPrompt,
  createAgentPromptMaterializationArtifact,
  createProviderVisibleAgentRuntimeFacts,
  deriveAgentPromptCacheIdentityChecksumV2,
  materializeAgentSystemPromptV3,
  packAgentContext,
  createHistoricalAgentPromptMaterializationArtifact,
  checksumProjectContext,
  contextSourceMaterializationArtifactId,
  promptMaterializationArtifactId,
  resolveAgentContextProfile,
  workspaceOutlineDependencyRevisionChecksum,
  type WorkspaceOutlineDependencyManifest
} from "@novel-studio/application";
import type { AgentContextBudgetInputsPort, AgentRunDraftSession } from "@novel-studio/application";
import {
  createAgentContextSnapshot,
  createAgentContextSnapshotV2,
  createAgentRunCoordinator,
  createAgentRunToolCatalogSnapshotV2,
  createAgentRunToolCatalogSnapshot,
  buildCompactionInputManifest,
  createDefaultCapabilitySnapshot,
  createEffectiveCapabilityState,
  createPackedAgentContextManifestV2,
  createProviderSemanticVersionSetV1,
  createDeterministicTokenEstimator,
  type AgentContextSourceInput
} from "@novel-studio/agent-engine";
import { AgentRunFileRepository, AgentUsageFileRepository } from "@novel-studio/repository";
import { ok, type JsonObject } from "@novel-studio/shared";

import { createDesktopCompactionSources } from "../src/main/agent-compaction-composer.js";
import { createDesktopCompactionModelAssistant } from "../src/main/agent-run-runtime.js";

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
        now: () => "2026-07-17T00:00:00.000Z"
      }),
      runRepository: {
        writeCompactionManifest: (manifest) => repository.writeCompactionManifest(manifest),
        writeCompactionRevision: (revision) => repository.writeCompactionRevision(revision),
        writePromptMaterialization: (runId, artifact) =>
          repository.writePromptMaterialization(runId, artifact),
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
    expect(resultSnapshot.value["createdAt"]).toBe("2026-07-16T00:00:00.000Z");
    expect(sources.find((s) => s.refId === "chapter:ch-01")?.state).toBe("active");
    expect(sources.find((s) => s.refId === "file:draft-notes.md")?.state).toBe("excluded");
    const packedManifest = resultSnapshot.value["packedContextManifest"] as JsonObject;
    expect(packedManifest).toMatchObject({ schemaVersion: "1.2" });
    expect(packedManifest["manifestChecksum"]).toMatch(/^[a-f0-9]{64}$/);
    const compactedPrompt = await repository.readPromptMaterialization(
      "run_01",
      promptMaterializationArtifactId("context_run_01_c1")
    );
    expect(compactedPrompt).toMatchObject({ ok: true });
    if (!compactedPrompt.ok || compactedPrompt.value === undefined) return;
    expect(compactedPrompt.value["packedContextManifestChecksum"]).toBe(
      packedManifest["manifestChecksum"]
    );

    // A redacted usage record for the compaction round was written under the user-data root.
    const usage = await usageRepository.readById("run_01:compaction_01:7");
    expect(usage.ok).toBe(true);
    if (!usage.ok) return;
    expect(usage.value?.["terminationReason"]).toBe("context_compaction");
    expect(usage.value?.["compactionAfterTokens"]).toBe(4335);
  });

  test("compacts a protocol-2 snapshot through canonical materialization and V2 cache identity", async () => {
    const { repository } = await seedV2Run();
    const compactionSources = createDesktopCompactionSources({
      repository,
      now: () => "2026-08-04T00:00:00.000Z"
    });
    const command = {
      projectId: "project_01",
      runId: "run_01",
      commandId: "cmd_v2_compact",
      expectedRunRevision: 1,
      contextBudgetSnapshotId: "budget_target_v2",
      trigger: "manual" as const
    };
    const loaded = await compactionSources.loadInputs(command);
    if (!loaded.ok) throw new Error(`V2 input failed: ${loaded.error.code}`);
    const manifest = buildCompactionInputManifest({
      compactionId: "compaction_v2",
      runId: "run_01",
      sourceSnapshotId: loaded.value.sourceSnapshotId,
      throughSequence: loaded.value.throughSequence,
      protectedFacts: loaded.value.protectedFacts,
      evictableSources: loaded.value.evictableSources,
      createdAt: "2026-08-04T00:00:00.000Z"
    });
    if (!manifest.ok) throw new Error(`V2 manifest failed: ${manifest.error.code}`);
    const result = await compactionSources.buildArtifacts({
      command,
      manifest: manifest.value,
      strategy: "deterministic",
      evictedSourceIds: ["file:draft-notes.md"],
      targetTokens: loaded.value.targetTokens,
      inputTokens: 0,
      outputTokens: 0,
      precision: "estimated",
      summaryChecksum: ""
    });
    if (!result.ok) throw new Error(`V2 compaction failed: ${result.error.code}`);

    const compacted = result.value.resultSnapshot;
    expect(compacted["schemaVersion"]).toBe("2.0");
    expect(compacted["roundId"]).toBe("round_run_01_0");
    expect(compacted["sharing"]).toEqual({
      defaultsRevision: "defaults_v2",
      runGrantRevision: "grant_v2"
    });
    expect(compacted["packedContextManifest"]).toMatchObject({ schemaVersion: "2.0" });

    const packed = compacted["packedContextManifest"] as JsonObject;
    const prompt = result.value.promptMaterialization;
    expect(prompt).toMatchObject({ schemaVersion: "2.0" });
    if (prompt === undefined) return;
    expect(prompt["packedContextManifestChecksum"]).toBe(packed["manifestChecksum"]);

    const run = result.value.runSnapshot;
    expect(run["schemaVersion"]).toBe("2.0");
    expect(run["promptCacheIdentityChecksum"]).toBe(
      deriveAgentPromptCacheIdentityChecksumV2(
        String(run["promptCacheIdentityBaseChecksum"]),
        String(run["cachePrefixChecksum"])
      )
    );
  });

  test("protects conventions and evicts workspace outlines to a manifest pointer", async () => {
    const {
      repository,
      usageRepository,
      projectRoot,
      conventionsRefId,
      outlineRefId,
      outlineArtifactId,
      outlineManifestChecksum,
      outlineRereadHint
    } = await seedC3OutlineRun();
    const compactionSources = createDesktopCompactionSources({
      repository,
      now: () => "2026-07-17T00:00:00.000Z"
    });

    const loaded = await compactionSources.loadInputs({
      projectId: "project_01",
      runId: "run_01",
      commandId: "cmd_c3_inputs",
      expectedRunRevision: 3,
      contextBudgetSnapshotId: "budget_target_c3",
      trigger: "manual"
    });
    expect(loaded).toMatchObject({
      ok: true,
      value: {
        protectedFacts: [
          expect.objectContaining({ sourceId: conventionsRefId, kind: "explicit_ref" })
        ],
        evictableSources: [
          expect.objectContaining({
            sourceId: outlineRefId,
            evictionReason: "rereadable_body"
          })
        ]
      }
    });

    const session = createAgentContextSession({
      draftSession: stubDraftSession(),
      budgetInputs: stubBudgetInputs(),
      compactionSources,
      runRepository: {
        writeCompactionManifest: (manifest) => repository.writeCompactionManifest(manifest),
        writeCompactionRevision: (revision) => repository.writeCompactionRevision(revision),
        writePromptMaterialization: (runId, artifact) =>
          repository.writePromptMaterialization(runId, artifact),
        writeContextSnapshot: (snapshot) => repository.writeContextSnapshot(snapshot),
        writeBudgetSnapshot: (runId, snapshot) => repository.writeBudgetSnapshot(runId, snapshot),
        commitCompaction: (snapshot) => repository.commitCompaction(snapshot)
      },
      usageSink: { writeFinal: (record) => usageRepository.writeFinal(record) },
      createCompactionId: () => "compaction_c3",
      now: () => "2026-07-17T00:00:00.000Z"
    });

    const result = await session.compactContext({
      projectId: "project_01",
      runId: "run_01",
      commandId: "cmd_c3_compact",
      expectedRunRevision: 3,
      contextBudgetSnapshotId: "budget_target_c3",
      trigger: "manual"
    });
    expect(result).toMatchObject({
      ok: true,
      value: { revision: { evictedSourceIds: [outlineRefId] } }
    });

    const compacted = await repository.readContextSnapshot("run_01", "context_run_01_c1");
    expect(compacted).toMatchObject({ ok: true });
    if (!compacted.ok || compacted.value === undefined) return;
    const sources = compacted.value["sources"] as JsonObject[];
    expect(sources.find((source) => source["refId"] === conventionsRefId)).toMatchObject({
      state: "active"
    });
    const outline = sources.find((source) => source["refId"] === outlineRefId);
    expect(outline).toMatchObject({
      state: "excluded",
      artifactId: null,
      evictionPointer: {
        schemaVersion: "1.0",
        artifactId: outlineArtifactId,
        dependencyManifestChecksum: outlineManifestChecksum,
        rereadHint: outlineRereadHint
      }
    });
    expect(JSON.stringify(outline)).not.toContain("workspace outline body");

    // The re-materialized prompt has no old outline body to revive during a later hydrate.
    const prompt = await repository.readPromptMaterialization(
      "run_01",
      promptMaterializationArtifactId("context_run_01_c1")
    );
    expect(prompt).toMatchObject({ ok: true });
    if (!prompt.ok || prompt.value === undefined) return;
    expect(JSON.stringify(prompt.value)).not.toContain("workspace outline body");
    expect(prompt.value["contextSources"]).toEqual([
      expect.objectContaining({ refId: conventionsRefId, sourceKind: "project_conventions" })
    ]);

    expect(
      await readFile(
        join(
          projectRoot,
          "history",
          "agent-runs",
          "run_01",
          "prompt-materializations",
          `${promptMaterializationArtifactId("context_run_01_c1")}.json`
        ),
        "utf8"
      )
    ).not.toContain("workspace outline body");
  });

  test("prices model-assisted compaction and captures the production local-time bucket", async () => {
    const { repository, usageRepository } = await seedRun({
      chapterTokens: 100,
      noteTokens: 100,
      historyTokens: 22_000
    });
    const session = createAgentContextSession({
      draftSession: stubDraftSession(),
      budgetInputs: stubBudgetInputs(),
      compactionSources: createDesktopCompactionSources({
        repository,
        pricingRegistry: createAgentPricingRegistry({
          version: "pricing-2026-11",
          entries: [
            {
              provider: "demo",
              model: "demo-model",
              unitPrices: {
                inputPerMillion: 2,
                outputPerMillion: 8,
                currency: "USD"
              }
            }
          ]
        }),
        usageTime: () => ({
          timestamp: "2026-11-01T06:30:00.000Z",
          localDate: "2026-11-01",
          timezone: "America/New_York",
          utcOffsetMinutes: -300
        }),
        now: () => "2026-11-01T06:30:00.000Z"
      }),
      modelAssistant: {
        summarizeEvictable: (input) => {
          const body = JSON.stringify({
            plotFacts: ["The bridge collapsed"],
            characterStates: ["Mara is injured"],
            foreshadowing: ["The key remains unexplained"],
            userDecisions: ["Keep Mara alive"]
          });
          const count = createDeterministicTokenEstimator().count(body, "profile_01");
          return Promise.resolve(
            ok({
              inputTokens: 100,
              summary: {
                body,
                provenance: {
                  kind: "model_assisted" as const,
                  provider: "demo",
                  model: "demo-model",
                  modelProfileId: "profile_01",
                  templateVersion: "1.0" as const,
                  inputChecksum: input.evidenceChecksum
                },
                tokenCount: count.tokens,
                checksum: createHash("sha256").update(body, "utf8").digest("hex"),
                precision: count.precision
              }
            })
          );
        }
      },
      runRepository: {
        writeCompactionManifest: (manifest) => repository.writeCompactionManifest(manifest),
        writeCompactionRevision: (revision) => repository.writeCompactionRevision(revision),
        writeCompactionSummaryArtifact: (runId, artifact) =>
          repository.writeCompactionSummaryArtifact(runId, artifact),
        readCompactionSummaryArtifact: (runId, artifactId) =>
          repository.readCompactionSummaryArtifact(runId, artifactId),
        writePromptMaterialization: (runId, artifact) =>
          repository.writePromptMaterialization(runId, artifact),
        writeContextSnapshot: (snapshot) => repository.writeContextSnapshot(snapshot),
        writeBudgetSnapshot: (runId, snapshot) => repository.writeBudgetSnapshot(runId, snapshot),
        commitCompaction: (snapshot) => repository.commitCompaction(snapshot)
      },
      usageSink: { writeFinal: (record) => usageRepository.writeFinal(record) },
      createCompactionId: () => "compaction_02",
      now: () => "2026-11-01T06:30:00.000Z"
    });

    const compacted = await session.compactContext({
      projectId: "project_01",
      runId: "run_01",
      commandId: "cmd_model_compaction",
      expectedRunRevision: 3,
      contextBudgetSnapshotId: "budget_target_02",
      trigger: "manual"
    });
    expect(compacted, compacted.ok ? undefined : JSON.stringify(compacted.error)).toMatchObject({
      ok: true,
      value: { revision: { strategy: "model_assisted" } }
    });

    const usage = await usageRepository.readById("run_01:compaction_02:7");
    expect(usage).toMatchObject({
      ok: true,
      value: {
        usageStatus: "estimated",
        precision: "estimated",
        pricingVersion: "pricing-2026-11",
        unitPrices: { inputPerMillion: 2, outputPerMillion: 8, currency: "USD" },
        cost: { amount: 0.00148, currency: "USD", status: "estimated" },
        timestamp: "2026-11-01T06:30:00.000Z",
        localDate: "2026-11-01",
        timezone: "America/New_York",
        utcOffsetMinutes: -300
      }
    });
  });

  test.each(["profile", "throughSequence"])(
    "rejects a checksum-valid summary artifact bound to the wrong %s",
    async (mismatch) => {
      const { repository } = await seedRun({
        chapterTokens: 100,
        noteTokens: 100,
        historyTokens: 22_000
      });
      const sources = createDesktopCompactionSources({
        repository,
        now: () => "2026-11-01T06:30:00.000Z"
      });
      const command = {
        projectId: "project_01",
        runId: "run_01",
        commandId: `cmd_wrong_${mismatch}`,
        expectedRunRevision: 3,
        contextBudgetSnapshotId: "budget_target_wrong",
        trigger: "manual" as const
      };
      const loaded = await sources.loadInputs(command);
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) return;
      const manifestResult = buildCompactionInputManifest({
        compactionId: `compaction_wrong_${mismatch}`,
        runId: command.runId,
        sourceSnapshotId: loaded.value.sourceSnapshotId,
        throughSequence: loaded.value.throughSequence,
        protectedFacts: loaded.value.protectedFacts,
        evictableSources: loaded.value.evictableSources,
        createdAt: "2026-11-01T06:30:00.000Z"
      });
      expect(manifestResult.ok).toBe(true);
      if (!manifestResult.ok) return;
      const manifest = manifestResult.value;
      const profileId = mismatch === "profile" ? "engineering" : "writing";
      const body =
        profileId === "engineering"
          ? JSON.stringify({
              modifiedFiles: ["src/index.ts"],
              changeIntent: ["Fix parsing"],
              todos: [],
              errorHighlights: [],
              nextSteps: ["Run tests"]
            })
          : JSON.stringify({
              plotFacts: ["The bridge collapsed"],
              characterStates: ["Mara is injured"],
              foreshadowing: [],
              userDecisions: ["Keep Mara alive"]
            });
      const count = createDeterministicTokenEstimator().count(body, "profile_01");
      const result = {
        body,
        provenance: {
          kind: "model_assisted" as const,
          provider: "demo",
          model: "demo-model",
          modelProfileId: "profile_01",
          templateVersion: "1.0" as const,
          inputChecksum: loaded.value.modelSummary?.evidenceChecksum ?? "a".repeat(64)
        },
        tokenCount: count.tokens,
        checksum: createHash("sha256").update(body, "utf8").digest("hex"),
        precision: count.precision
      };
      const summaryArtifact = createCompactionSummaryArtifact({
        artifactId: `summary_wrong_${mismatch}`,
        runId: command.runId,
        compactionId: manifest.compactionId,
        contextProfileId: profileId,
        sourceSnapshotId: loaded.value.sourceSnapshotId,
        throughSequence: loaded.value.throughSequence + (mismatch === "throughSequence" ? 1 : 0),
        inputManifestChecksum: manifest.checksum,
        result,
        createdAt: "2026-11-01T06:30:00.000Z"
      });
      expect(
        await sources.buildArtifacts({
          command,
          manifest,
          strategy: "model_assisted",
          evictedSourceIds: loaded.value.evictableSources.map((source) => source.sourceId),
          targetTokens: loaded.value.targetTokens,
          inputTokens: 100,
          outputTokens: summaryArtifact.tokenCount,
          precision: summaryArtifact.precision,
          summaryChecksum: summaryArtifact.checksum,
          summaryArtifact
        })
      ).toMatchObject({
        ok: false,
        error: { code: "AGENT_CONTEXT_COMPACTION_SUMMARY_INVALID" }
      });
    }
  );

  test("uses a no-tools model round for a verifiable summary", async () => {
    const { repository } = await seedRun();
    const body = JSON.stringify({
      plotFacts: ["The bridge collapsed"],
      characterStates: ["Mara is injured"],
      foreshadowing: [],
      userDecisions: ["Keep Mara alive"]
    });
    let tools: readonly unknown[] | undefined;
    let promptCacheDisabled: boolean | undefined;
    const assistant = createDesktopCompactionModelAssistant({
      repository,
      modelDriver: {
        async *streamRound(input) {
          tools = input.tools;
          promptCacheDisabled = input.disablePromptCache;
          yield { type: "assistant_text_delta", delta: body };
          yield { type: "round_completed", finishReason: "stop" };
        }
      }
    });
    const prompt = buildCompactionSummaryPrompt("writing");
    const evidence = "Conversation evidence";
    const summarized = await assistant.summarizeEvictable({
      runId: "run_01",
      evictableSources: [],
      profileId: "writing",
      templateVersion: prompt.templateVersion,
      systemPrompt: prompt.systemPrompt,
      evidence,
      evidenceChecksum: createHash("sha256").update(evidence, "utf8").digest("hex"),
      maxSummaryTokens: 1_000
    });
    expect(tools).toEqual([]);
    expect(promptCacheDisabled).toBe(true);
    expect(summarized).toMatchObject({
      ok: true,
      value: {
        summary: {
          body,
          provenance: { provider: "demo", model: "demo-model", modelProfileId: "profile_01" }
        }
      }
    });
  });

  test.each([
    ["tool call", "AGENT_COMPACTION_SUMMARY_TOOL_CALL_FORBIDDEN"],
    ["non-stop", "AGENT_COMPACTION_SUMMARY_MODEL_FAILED"],
    ["empty", "AGENT_COMPACTION_SUMMARY_MODEL_FAILED"],
    ["exception", "AGENT_COMPACTION_SUMMARY_MODEL_FAILED"]
  ])("fails closed on a compaction model %s", async (behavior, code) => {
    const { repository } = await seedRun();
    const assistant = createDesktopCompactionModelAssistant({
      repository,
      modelDriver: {
        async *streamRound(input) {
          expect(input.tools).toEqual([]);
          if (behavior === "exception") throw new Error("model failed");
          if (behavior === "tool call") {
            yield { type: "tool_call_delta", toolCallId: "forbidden", name: "read_resource" };
            return;
          }
          if (behavior !== "empty") {
            yield { type: "assistant_text_delta", delta: "{}" };
          }
          yield {
            type: "round_completed",
            finishReason: behavior === "non-stop" ? "length" : "stop"
          };
        }
      }
    });
    const prompt = buildCompactionSummaryPrompt("writing");
    const evidence = "Conversation evidence";
    expect(
      await assistant.summarizeEvictable({
        runId: "run_01",
        evictableSources: [],
        profileId: "writing",
        templateVersion: prompt.templateVersion,
        systemPrompt: prompt.systemPrompt,
        evidence,
        evidenceChecksum: createHash("sha256").update(evidence, "utf8").digest("hex"),
        maxSummaryTokens: 1_000
      })
    ).toMatchObject({ ok: false, error: { code } });
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

async function seedRun(
  options: {
    readonly chapterTokens?: number;
    readonly noteTokens?: number;
    readonly historyTokens?: number;
    readonly contextWindow?: number;
  } = {}
): Promise<{
  repository: AgentRunFileRepository;
  usageRepository: AgentUsageFileRepository;
  projectRoot: string;
}> {
  const projectRoot = await mkdtemp(join(tmpdir(), "ns-compact-proj-"));
  const userDataRoot = await mkdtemp(join(tmpdir(), "ns-compact-user-"));
  roots.push(projectRoot, userDataRoot);
  const repository = new AgentRunFileRepository({ projectRoot, traceId: "test" });
  const usageRepository = new AgentUsageFileRepository({ userDataRoot, traceId: "test" });
  const createdAt = "2026-07-15T00:00:00.000Z";
  const scope = {
    kind: "workspace" as const,
    workspaceKind: "creativeProject" as const,
    workspaceId: "project_01"
  };
  const profile = resolveAgentContextProfile(scope, "planning", "writing");
  const chapterTokens = options.chapterTokens ?? 4000;
  const noteTokens = options.noteTokens ?? 20000;
  const contextWindow = options.contextWindow ?? 40_000;
  const contextSources: AgentContextSourceInput[] = [
    {
      refId: "chapter:ch-01",
      sourceKind: "disk_file",
      relativePath: "chapters/ch-01.md",
      content: "c".repeat(chapterTokens),
      dirty: false,
      sourceRevision: 1
    },
    {
      refId: "file:draft-notes.md",
      sourceKind: "disk_file",
      relativePath: "draft-notes.md",
      content: "n".repeat(noteTokens),
      dirty: false,
      sourceRevision: 1
    }
  ];
  const catalog = createAgentRunToolCatalogSnapshot({
    runId: "run_01",
    facadeVersion: "v2",
    descriptors: [],
    createdAt
  });
  expect(
    await repository.writeToolCatalog("run_01", catalog as unknown as JsonObject)
  ).toMatchObject({ ok: true });
  const systemPrompt = buildAgentSystemPrompt(profile);
  const prompt = createHistoricalAgentPromptMaterializationArtifact({
    runId: "run_01",
    contextSnapshotId: "context_run_01",
    profile,
    systemPrompt,
    toolCatalogRevision: catalog.catalogRevision,
    userRequest: "Review the chapter",
    contextSources
  });
  expect(
    await repository.writePromptMaterialization("run_01", prompt as unknown as JsonObject)
  ).toMatchObject({ ok: true });
  const guidanceSource: AgentContextSourceInput = {
    refId: prompt.systemGuidanceRefId,
    sourceKind: "system_guidance",
    content: systemPrompt,
    dirty: false
  };
  const baseSnapshot = createAgentContextSnapshot({
    contextSnapshotId: "context_run_01",
    runId: "run_01",
    scope,
    contextProfileId: profile.profileId,
    materialization: {
      schemaVersion: "1.0",
      profileVersion: profile.profileVersion,
      guidanceTemplateChecksum: prompt.guidanceTemplateChecksum,
      stablePrefixChecksum: prompt.stablePrefixChecksum,
      messageOrderVersion: "1.0"
    },
    createdAt,
    sources: [guidanceSource, ...contextSources],
    materializationArtifactId: prompt.artifactId
  });
  const snapshot: JsonObject = {
    ...(baseSnapshot as unknown as JsonObject),
    sources: baseSnapshot.sources.map((source) =>
      source.refId === "chapter:ch-01"
        ? { ...source, layer: "explicit_ref", tokenCount: chapterTokens, precision: "estimated" }
        : source.refId === "file:draft-notes.md"
          ? { ...source, layer: "tool_result", tokenCount: noteTokens, precision: "estimated" }
          : source
    ) as unknown as JsonObject["sources"]
  };
  expect(await repository.writeContextSnapshot(snapshot)).toMatchObject({ ok: true });

  const run: JsonObject = {
    schemaVersion: "1.2",
    runId: "run_01",
    scope,
    conversationId: "conv_01",
    operationMode: "execution",
    contextMode: "general_file",
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
      contextWindow,
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
    },
    toolFacadeVersion: "v2",
    toolCatalogSnapshotId: catalog.toolCatalogSnapshotId,
    toolCatalogRevision: catalog.catalogRevision,
    pendingToolApproval: null,
    contextProfileId: profile.profileId,
    profileVersion: profile.profileVersion,
    guidanceTemplateChecksum: prompt.guidanceTemplateChecksum,
    conventionsArtifactId: null,
    promptCachePolicyVersion: "none@1.0",
    cachePrefixChecksum: prompt.stablePrefixChecksum
  };
  const runWritten = await repository.writeSnapshot(run);
  expect(runWritten.ok).toBe(true);
  if ((options.historyTokens ?? 0) > 0) {
    await appendAssistantHistory(repository, options.historyTokens ?? 0, scope);
  }
  return { repository, usageRepository, projectRoot };
}

async function seedV2Run(): Promise<{
  repository: AgentRunFileRepository;
  usageRepository: AgentUsageFileRepository;
  projectRoot: string;
}> {
  const seeded = await seedRun({ chapterTokens: 4_000, noteTokens: 20_000 });
  await rm(
    join(
      seeded.projectRoot,
      "history",
      "agent-runs",
      "run_01",
      "tool-catalogs",
      "tool_catalog_run_01.json"
    ),
    { force: true }
  );
  await rm(join(seeded.projectRoot, "history", "agent-runs", "run_01", "run.json"), {
    force: true
  });
  const scope = {
    kind: "workspace" as const,
    workspaceKind: "creativeProject" as const,
    workspaceId: "project_01"
  };
  const profile = resolveAgentContextProfile(scope, "execution", "general_file");
  const contextSources: AgentContextSourceInput[] = [
    {
      refId: "chapter:ch-01",
      sourceKind: "disk_file",
      relativePath: "chapters/ch-01.md",
      content: "c".repeat(4_000),
      dirty: false,
      sourceRevision: 1
    },
    {
      refId: "file:draft-notes.md",
      sourceKind: "disk_file",
      relativePath: "draft-notes.md",
      content: "n".repeat(20_000),
      dirty: false,
      sourceRevision: 1
    }
  ];
  const capability = {
    ...createDefaultCapabilitySnapshot("creativeProject"),
    writingOperations: [],
    workspaceFileOperations: []
  } as const;
  const runtimeFacts = createProviderVisibleAgentRuntimeFacts({
    profile,
    toolDescriptors: [],
    effectiveCapabilityState: createEffectiveCapabilityState(capability),
    executionWritePolicy: "write_before_confirmation",
    activeResourceKind: "project_file"
  });
  const guidance = materializeAgentSystemPromptV3({
    profile,
    runtimeFacts,
    writingTaskIntent: null,
    writingGenerationGuidanceVersion: "not_applicable",
    providerSemanticVersionSet: createProviderSemanticVersionSetV1({
      writingTaskIntentSchemaVersion: "not_applicable",
      writingGenerationGuidanceVersion: "not_applicable",
      approvalRuleSetVersion: runtimeFacts.approvalRuleSetVersion,
      approvalRuleSetChecksum: runtimeFacts.approvalRuleSetChecksum
    })
  });
  const providerSemanticVersionSet = guidance.normalizedInput.providerSemanticVersionSet;
  const catalog = createAgentRunToolCatalogSnapshotV2({
    runId: "run_01",
    descriptors: [],
    createdAt: "2026-08-04T00:00:00.000Z"
  });
  const packed = packAgentContext({
    profile,
    contextSources,
    modelProfileId: "profile_01",
    usedTokens: 24_000,
    safeInputBudget: 32_000,
    remainingTokens: 8_000,
    precision: "estimated",
    createdAt: "2026-08-04T00:00:00.000Z"
  });
  const sharing = { defaultsRevision: "defaults_v2", runGrantRevision: "grant_v2" } as const;
  const packedManifest = createPackedAgentContextManifestV2(packed, {
    roundId: "round_run_01_0",
    sharing,
    providerSemanticVersionSet
  });
  const prompt = createAgentPromptMaterializationArtifact({
    runId: "run_01",
    contextSnapshotId: "context_run_01",
    profile,
    systemPrompt: guidance.materializedGuidance,
    toolCatalogRevision: catalog.catalogRevision,
    userRequest: "Review the chapter",
    contextSources,
    packedContextManifestChecksum: packedManifest.manifestChecksum,
    guidanceMaterialization: guidance
  });
  const guidanceSource: AgentContextSourceInput = {
    refId: prompt.systemGuidanceRefId,
    sourceKind: "system_guidance",
    content: guidance.materializedGuidance,
    dirty: false
  };
  const baseSnapshot = createAgentContextSnapshotV2({
    contextSnapshotId: "context_run_01",
    runId: "run_01",
    scope,
    contextProfileId: profile.profileId,
    materialization: {
      schemaVersion: "2.0",
      profileVersion: profile.profileVersion,
      guidanceTemplateChecksum: prompt.guidanceTemplateChecksum,
      stablePrefixChecksum: prompt.stablePrefixChecksum,
      messageOrderVersion: "2.0"
    },
    createdAt: "2026-08-04T00:00:00.000Z",
    sources: [guidanceSource, ...contextSources],
    materializationArtifactId: prompt.artifactId,
    roundId: "round_run_01_0",
    sharing,
    providerSemanticVersionSet,
    packedContextManifest: packedManifest
  });
  const changedSources = baseSnapshot.sources.map((source) =>
    source.refId === "chapter:ch-01"
      ? {
          ...source,
          layer: "explicit_ref" as const,
          tokenCount: 4_000,
          precision: "estimated" as const
        }
      : source.refId === "file:draft-notes.md"
        ? {
            ...source,
            layer: "tool_result" as const,
            tokenCount: 20_000,
            precision: "estimated" as const
          }
        : source
  );
  const { snapshotChecksum: _baseChecksum, ...snapshotUnsigned } = baseSnapshot;
  void _baseChecksum;
  const snapshot = {
    ...snapshotUnsigned,
    sources: changedSources,
    snapshotChecksum: checksumText(stableJson({ ...snapshotUnsigned, sources: changedSources }))
  };
  const identityBaseChecksum = "f".repeat(64);
  const coordinator = createAgentRunCoordinator({
    now: () => "2026-08-04T00:00:00.000Z",
    createRunId: () => "run_01"
  });
  const started = coordinator.startRun({
    projectId: "project_01",
    conversationId: "conv_v2",
    commandId: "start_v2",
    expectedRunRevision: 0,
    operationMode: "execution",
    contextMode: "general_file",
    writePolicy: "write_before_confirmation",
    userRequest: "Review the chapter",
    providerCapabilitySnapshot: {
      profileId: "profile_01",
      provider: "demo",
      modelName: "demo-model",
      streaming: true,
      toolCalling: true,
      structuredArguments: true,
      contextWindow: 40_000,
      requiredContextTokens: 8_000
    },
    toolFacadeVersion: "v2",
    toolCatalogRevision: catalog.catalogRevision,
    contextProfileId: profile.profileId,
    profileVersion: profile.profileVersion,
    guidanceTemplateChecksum: prompt.guidanceTemplateChecksum,
    cachePrefixChecksum: prompt.stablePrefixChecksum,
    promptCacheIdentityBaseChecksum: identityBaseChecksum,
    promptCacheIdentityChecksum: deriveAgentPromptCacheIdentityChecksumV2(
      identityBaseChecksum,
      prompt.stablePrefixChecksum
    ),
    runV20: {
      schemaVersion: "2.0" as const,
      providerSemanticVersionSetChecksum: guidance.proof.providerSemanticVersionSetChecksum,
      authorityRegistryKey: guidance.proof.registryKey,
      materializedGuidanceChecksum: guidance.proof.materializedGuidanceChecksum,
      toolCatalogChecksum: catalog.catalogRevision,
      effectiveCapabilityRevision: 1,
      executionWritePolicyDraft: "write_before_confirmation"
    }
  });
  if (!started.ok) throw new Error(`V2 seed failed: ${started.error.code}`);
  const run = { ...started.value, contextSnapshotId: "context_run_01" } as unknown as JsonObject;
  const catalogWritten = await seeded.repository.writeToolCatalog(
    "run_01",
    catalog as unknown as JsonObject
  );
  if (!catalogWritten.ok) throw new Error(`catalog write failed: ${catalogWritten.error.code}`);
  expect(
    await seeded.repository.writePromptMaterialization("run_01", prompt as unknown as JsonObject)
  ).toMatchObject({ ok: true });
  expect(
    await seeded.repository.writeContextSnapshot(snapshot as unknown as JsonObject)
  ).toMatchObject({ ok: true });
  const runWritten = await seeded.repository.writeSnapshotV20(run as never);
  if (!runWritten.ok) throw new Error(`run write failed: ${runWritten.error.code}`);
  return seeded;
}

async function seedC3OutlineRun(): Promise<{
  repository: AgentRunFileRepository;
  usageRepository: AgentUsageFileRepository;
  projectRoot: string;
  conventionsRefId: string;
  outlineRefId: string;
  outlineArtifactId: string;
  outlineManifestChecksum: string;
  outlineRereadHint: string;
}> {
  const seeded = await seedRun({ contextWindow: 42_000 });
  const scope = {
    kind: "workspace" as const,
    workspaceKind: "engineeringWorkspace" as const,
    workspaceId: "project_01"
  };
  const profile = resolveAgentContextProfile(scope, "planning", "general_file");
  const canonicalRootIdentity = "a".repeat(64);
  const conventionsRefId = "project:conventions";
  const outlineRefId = "project:workspace-outline";
  const conventionsBody = "project conventions body";
  const outlineBody = "o".repeat(1_500);
  const outlineRereadHint =
    "Use list_project_entries or search_project_text to reread this outline.";
  const dependencyManifest: WorkspaceOutlineDependencyManifest = {
    schemaVersion: "1.0",
    readerVersion: "1.0",
    profileId: "engineering",
    workspace: {
      workspaceKind: "engineeringWorkspace",
      workspaceId: "project_01",
      canonicalRootIdentity
    },
    limits: {
      maxDepth: 2,
      maxEntries: 200,
      maxScannedEntries: 1_000,
      maxBytes: 65_536,
      maxDurationMs: 200,
      maxTokens: 1_500
    },
    truncated: false,
    truncationReasons: [],
    dependency: {
      kind: "engineering_entries",
      entrySetRevision: "engineering_entries:test",
      entrySetChecksum: checksumText("engineering-tree@1")
    }
  };
  const outlineManifestChecksum = checksumProjectContext(dependencyManifest);
  const sourceIdentity = {
    workspaceId: "project_01",
    contextProfileId: "engineering" as const,
    canonicalRootIdentity
  };
  const conventions: AgentContextSourceInput = {
    refId: conventionsRefId,
    sourceKind: "project_conventions",
    relativePath: "AGENTS.md",
    content: conventionsBody,
    dirty: false,
    sourceRevision: 1,
    materialization: {
      schemaVersion: "1.0",
      kind: "project_conventions",
      artifactId: contextSourceMaterializationArtifactId("project_conventions", {
        readerVersion: "1.0",
        sourceIdentity: { ...sourceIdentity, relativePath: "AGENTS.md" },
        originalChecksum: checksumText(conventionsBody),
        injectedChecksum: checksumText(conventionsBody),
        tokenCount: 5,
        truncationRange: null
      }),
      readerVersion: "1.0",
      sourceIdentity: { ...sourceIdentity, relativePath: "AGENTS.md" },
      instructionPolicy: "content_is_data_not_authority",
      workspaceTrust: "trusted",
      tokenCount: 5,
      truncationRange: null,
      originalChecksum: checksumText(conventionsBody),
      injectedChecksum: checksumText(conventionsBody)
    }
  };
  const outlineDependencyRevisionChecksum =
    workspaceOutlineDependencyRevisionChecksum(dependencyManifest);
  const outlineMaterializedChecksum = checksumText(outlineBody);
  const outlineArtifactId = contextSourceMaterializationArtifactId("workspace_outline", {
    readerVersion: "1.0",
    sourceIdentity,
    dependencyManifestChecksum: outlineManifestChecksum,
    dependencyRevisionChecksum: outlineDependencyRevisionChecksum,
    materializedChecksum: outlineMaterializedChecksum,
    tokenCount: 1_500,
    truncationRange: null
  });
  const outline: AgentContextSourceInput = {
    refId: outlineRefId,
    sourceKind: "workspace_outline",
    content: outlineBody,
    dirty: false,
    sourceRevision: 1,
    materialization: {
      schemaVersion: "1.0",
      kind: "workspace_outline",
      artifactId: outlineArtifactId,
      readerVersion: "1.0",
      sourceIdentity,
      instructionPolicy: "content_is_data_not_authority",
      workspaceTrust: "trusted",
      tokenCount: 1_500,
      truncationRange: null,
      dependencyManifest,
      dependencyManifestChecksum: outlineManifestChecksum,
      dependencyRevisionChecksum: outlineDependencyRevisionChecksum,
      materializedChecksum: outlineMaterializedChecksum,
      rereadHint: outlineRereadHint
    }
  };
  const contextSnapshotId = "context_run_01";
  const catalogRevision = createAgentRunToolCatalogSnapshot({
    runId: "run_01",
    facadeVersion: "v2",
    descriptors: [],
    createdAt: "2026-07-15T00:00:00.000Z"
  }).catalogRevision;
  const systemPrompt = buildAgentSystemPrompt(profile);
  const prompt = createHistoricalAgentPromptMaterializationArtifact({
    runId: "run_01",
    contextSnapshotId,
    profile,
    systemPrompt,
    toolCatalogRevision: catalogRevision,
    userRequest: "Review the project",
    contextSources: [conventions, outline]
  });
  const snapshot = createAgentContextSnapshot({
    contextSnapshotId,
    runId: "run_01",
    scope,
    contextProfileId: profile.profileId,
    materialization: {
      schemaVersion: "1.0",
      profileVersion: profile.profileVersion,
      guidanceTemplateChecksum: prompt.guidanceTemplateChecksum,
      stablePrefixChecksum: prompt.stablePrefixChecksum,
      messageOrderVersion: "1.0"
    },
    createdAt: "2026-07-15T00:00:00.000Z",
    sources: [
      {
        refId: prompt.systemGuidanceRefId,
        sourceKind: "system_guidance",
        content: systemPrompt,
        dirty: false
      },
      conventions,
      outline
    ],
    materializationArtifactId: prompt.artifactId
  });

  expect(
    await seeded.repository.writePromptMaterialization("run_01", prompt as unknown as JsonObject)
  ).toMatchObject({ ok: true });
  expect(
    await seeded.repository.writeContextSnapshot(snapshot as unknown as JsonObject)
  ).toMatchObject({ ok: true });
  const run = await seeded.repository.readSnapshot("run_01");
  if (!run.ok || run.value === undefined) throw new Error("seed run missing");
  expect(
    await seeded.repository.writeSnapshot({
      ...run.value,
      scope,
      operationMode: "planning",
      contextMode: "general_file",
      contextProfileId: profile.profileId,
      profileVersion: profile.profileVersion,
      guidanceTemplateChecksum: prompt.guidanceTemplateChecksum,
      cachePrefixChecksum: prompt.stablePrefixChecksum,
      usageSummary: {
        inputTokens: 24000,
        outputTokens: 0,
        totalTokens: 24000,
        usageStatus: "estimated"
      }
    })
  ).toMatchObject({ ok: true });
  await appendAssistantHistory(seeded.repository, 19_000, scope);

  return {
    ...seeded,
    conventionsRefId,
    outlineRefId,
    outlineArtifactId,
    outlineManifestChecksum,
    outlineRereadHint
  };
}

async function appendAssistantHistory(
  repository: AgentRunFileRepository,
  tokenCount: number,
  scope: {
    readonly kind: "workspace";
    readonly workspaceKind: "creativeProject" | "engineeringWorkspace";
    readonly workspaceId: string;
  }
): Promise<void> {
  expect(
    await repository.appendEvent({
      schemaVersion: "1.3",
      runId: "run_01",
      scope,
      sequence: 7,
      runRevision: 3,
      type: "assistant_text_completed",
      createdAt: "2026-07-15T00:00:00.000Z",
      detail: { text: "h".repeat(tokenCount) }
    })
  ).toMatchObject({ ok: true });
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

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, child]) => child !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
    .join(",")}}`;
}
