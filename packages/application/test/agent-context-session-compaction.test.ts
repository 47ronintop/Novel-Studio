import { err, ok, type JsonObject, type Result, type UnifiedError } from "@novel-studio/shared";
import { describe, expect, test } from "vitest";

import {
  createAgentContextSession,
  type AgentContextBudgetInputsPort,
  type CompactContextSourcesPort,
  type CompactionArtifacts,
  type CompactionEvent,
  type CompactionInputs,
  type CompactionModelAssistantPort,
  type CompactionRunRepositoryPort,
  type CompactionUsageSinkPort
} from "../src/agent-context-session.js";
import {
  createAgentRunDraftSession,
  type AgentRunDraftSession
} from "../src/agent-run-draft-session.js";
import {
  createPlanExecutionProtectedFact,
  type CompactContextCommand,
  type EvictableContextSource,
  type PlanExecutionRecord,
  type ProtectedContextFact
} from "@novel-studio/agent-engine";

const goalFact: ProtectedContextFact = {
  kind: "run_goal",
  factId: "fact_goal",
  sourceId: "src_goal",
  checksum: "a".repeat(64),
  eventSequence: 1
};

function evictable(overrides: Partial<EvictableContextSource> = {}): EvictableContextSource {
  return {
    sourceId: "src_body",
    sourceRevision: 0,
    layer: "tool_result",
    checksum: "c".repeat(64),
    tokenCount: 4000,
    evictionReason: "rereadable_body",
    pointerTokenCount: 50,
    ...overrides
  };
}

function inputs(overrides: Partial<CompactionInputs> = {}): CompactionInputs {
  return {
    sourceSnapshotId: "context_src",
    throughSequence: 20,
    nextRevision: 1,
    protectedFacts: [goalFact],
    evictableSources: [evictable()],
    currentTokens: 10000,
    targetTokens: 7000,
    ...overrides
  };
}

function executionRecord(overrides: Partial<PlanExecutionRecord> = {}): PlanExecutionRecord {
  return {
    schemaVersion: "1.0",
    planExecutionId: "execution_01",
    runId: "run_01",
    planId: "plan_01",
    planRevision: 1,
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
    ],
    ...overrides
  };
}

function artifacts(): CompactionArtifacts {
  return {
    resultSnapshot: {
      schemaVersion: "1.1",
      runId: "run_01",
      contextSnapshotId: "context_result",
      sources: []
    },
    budgetSnapshot: { schemaVersion: "1.0", contextBudgetSnapshotId: "budget_result" },
    usageRecord: { schemaVersion: "1.0", usageId: "usage_result", runId: "run_01" },
    runSnapshot: { schemaVersion: "1.1", runId: "run_01", activeCompactionId: "compaction_1" }
  };
}

function command(overrides: Partial<CompactContextCommand> = {}): CompactContextCommand {
  return {
    projectId: "project_01",
    runId: "run_01",
    commandId: "compact_01",
    expectedRunRevision: 5,
    contextBudgetSnapshotId: "budget_current",
    trigger: "manual",
    ...overrides
  };
}

function recordingRepository(order: string[]): CompactionRunRepositoryPort {
  return {
    async writeCompactionManifest(manifest) {
      order.push("manifest");
      return ok(manifest);
    },
    async writeCompactionRevision(revision) {
      order.push("revision");
      return ok(revision);
    },
    async writeContextSnapshot(snapshot) {
      order.push("result");
      return ok(snapshot);
    },
    async writeBudgetSnapshot(_runId, snapshot) {
      order.push("budget");
      return ok(snapshot);
    },
    async commitCompaction(snapshot) {
      order.push("commit");
      return ok(snapshot);
    }
  };
}

function recordingUsageSink(order: string[]): CompactionUsageSinkPort {
  return {
    async writeFinal(record) {
      order.push("usage");
      return ok(record);
    }
  };
}

function sourcesPort(
  loaded: CompactionInputs,
  built: CompactionArtifacts | UnifiedError = artifacts()
): CompactContextSourcesPort {
  return {
    async loadInputs() {
      return ok(loaded);
    },
    async buildArtifacts(): Promise<Result<CompactionArtifacts, UnifiedError>> {
      return "code" in built ? err(built) : ok(built);
    }
  };
}

const budgetInputsStub: AgentContextBudgetInputsPort = {
  async resolveBudgetInputs() {
    return ok({
      model: {
        provider: "demo",
        model: "large",
        contextWindow: 128000,
        toolReserve: 2000,
        systemReserve: 1000,
        requiredContextTokens: 8000
      },
      contents: []
    });
  }
};

function makeSession(
  overrides: Partial<Parameters<typeof createAgentContextSession>[0]>,
  events: CompactionEvent[] = []
) {
  return createAgentContextSession({
    draftSession: {
      async resolveStartDraft() {
        return err({ code: "unused" } as unknown as UnifiedError);
      }
    } as unknown as Pick<AgentRunDraftSession, "resolveStartDraft">,
    budgetInputs: budgetInputsStub,
    now: () => "2026-07-16T00:00:00.000Z",
    createCompactionId: () => "compaction_1",
    onCompactionEvent: (event) => {
      events.push(event);
    },
    ...overrides
  });
}

describe("compactContext — cross-repository commit ordering", () => {
  test("coalesces concurrent duplicate commands into one compaction", async () => {
    const order: string[] = [];
    let loadCalls = 0;
    let releaseInputs: (() => void) | undefined;
    const inputsReady = new Promise<void>((resolve) => {
      releaseInputs = resolve;
    });
    const source: CompactContextSourcesPort = {
      async loadInputs() {
        loadCalls += 1;
        await inputsReady;
        return ok(inputs());
      },
      async buildArtifacts() {
        return ok(artifacts());
      }
    };
    const session = makeSession({
      compactionSources: source,
      runRepository: recordingRepository(order),
      usageSink: recordingUsageSink(order)
    });

    const first = session.compactContext(command());
    const duplicate = session.compactContext(command());
    releaseInputs?.();
    const [firstResult, duplicateResult] = await Promise.all([first, duplicate]);

    expect(firstResult).toEqual(duplicateResult);
    expect(loadCalls).toBe(1);
    expect(order.filter((step) => step === "usage")).toHaveLength(1);
    expect(order.filter((step) => step === "commit")).toHaveLength(1);
  });

  test("reuses the model result, compaction, and usage target after a post-usage commit failure", async () => {
    let compactionIds = 0;
    let commitAttempts = 0;
    let summarizerCalls = 0;
    const usageIds: string[] = [];
    const receipts: JsonObject[] = [];
    const repository: CompactionRunRepositoryPort = {
      ...recordingRepository([]),
      async writeCommandReceipt(_runId, _commandId, receipt) {
        receipts.push(structuredClone(receipt));
        return ok(receipt);
      },
      async commitCompaction(snapshot) {
        commitAttempts += 1;
        return commitAttempts === 1
          ? err({ code: "COMPACTION_COMMIT_INTERRUPTED" } as unknown as UnifiedError)
          : ok(snapshot);
      }
    };
    const source: CompactContextSourcesPort = {
      async loadInputs() {
        return ok(inputs({ currentTokens: 100000, targetTokens: 1000 }));
      },
      async buildArtifacts(request) {
        const compactionId = request.manifest.compactionId;
        return ok({
          ...artifacts(),
          usageRecord: {
            schemaVersion: "1.0",
            usageId: `run_01:${compactionId}:20`,
            runId: "run_01"
          },
          runSnapshot: {
            schemaVersion: "1.1",
            runId: "run_01",
            activeCompactionId: compactionId
          }
        });
      }
    };
    const session = makeSession({
      createCompactionId: () => `compaction_${String(++compactionIds)}`,
      compactionSources: source,
      runRepository: repository,
      modelAssistant: {
        async summarizeEvictable() {
          summarizerCalls += 1;
          return ok({
            summaryChecksum: "d".repeat(64),
            inputTokens: 500,
            outputTokens: 120,
            precision: "reported",
            body: "must not persist",
            providerFrame: { authorization: "Bearer must-not-persist" }
          });
        }
      },
      usageSink: {
        async writeFinal(record) {
          usageIds.push(String(record["usageId"]));
          return ok(record);
        }
      }
    });

    expect(await session.compactContext(command())).toMatchObject({
      ok: false,
      error: { code: "COMPACTION_COMMIT_INTERRUPTED" }
    });
    const retried = await session.compactContext(command());

    expect(retried).toMatchObject({ ok: true, value: { compactionId: "compaction_1" } });
    expect(compactionIds).toBe(1);
    expect(summarizerCalls).toBe(1);
    expect(new Set(usageIds)).toEqual(new Set(["run_01:compaction_1:20"]));
    expect(
      receipts.find((receipt) => receipt["status"] === "model_completed")?.["modelResult"]
    ).toEqual({
      summaryChecksum: "d".repeat(64),
      inputTokens: 500,
      outputTokens: 120,
      precision: "reported"
    });
    expect(JSON.stringify(receipts)).not.toMatch(/must not persist|providerFrame|authorization/i);
  });

  test("rejects an invalid model result before persisting usage or artifacts", async () => {
    const order: string[] = [];
    const session = makeSession({
      compactionSources: sourcesPort(inputs({ currentTokens: 100000, targetTokens: 1000 })),
      runRepository: recordingRepository(order),
      usageSink: recordingUsageSink(order),
      modelAssistant: {
        async summarizeEvictable() {
          return ok({
            summaryChecksum: "not-a-checksum",
            inputTokens: 500,
            outputTokens: 120,
            precision: "reported" as const
          });
        }
      }
    });

    expect(await session.compactContext(command())).toMatchObject({
      ok: false,
      error: { code: "AGENT_CONTEXT_COMPACTION_MODEL_RESULT_INVALID" }
    });
    expect(order).toEqual(["manifest"]);
  });

  test("recovers a committed compaction after reload when the completed receipt write was interrupted", async () => {
    let receipt: JsonObject | undefined;
    let committedSnapshot: JsonObject | undefined;
    let storedRevision: JsonObject | undefined;
    let failCompletedReceipt = true;
    let compactionIds = 0;
    let usageWrites = 0;
    const repository = {
      ...recordingRepository([]),
      async writeCommandReceipt(_runId: string, _commandId: string, value: JsonObject) {
        if (value["status"] === "completed" && failCompletedReceipt) {
          failCompletedReceipt = false;
          return err({ code: "RECEIPT_WRITE_INTERRUPTED" } as unknown as UnifiedError);
        }
        receipt = value;
        return ok(value);
      },
      async readCommandReceipt() {
        return ok(receipt);
      },
      async readSnapshot() {
        return ok(committedSnapshot);
      },
      async readCompactionRevision() {
        return ok(storedRevision);
      },
      async writeCompactionRevision(value: JsonObject) {
        storedRevision = value;
        return ok(value);
      },
      async commitCompaction(value: JsonObject) {
        committedSnapshot = value;
        return ok(value);
      }
    } as unknown as CompactionRunRepositoryPort;
    const source: CompactContextSourcesPort = {
      async loadInputs() {
        return ok(inputs());
      },
      async buildArtifacts(request) {
        const compactionId = request.manifest.compactionId;
        return ok({
          ...artifacts(),
          usageRecord: {
            schemaVersion: "1.0",
            usageId: `run_01:${compactionId}:20`,
            runId: "run_01"
          },
          runSnapshot: {
            schemaVersion: "1.1",
            runId: "run_01",
            activeCompactionId: compactionId
          }
        });
      }
    };
    const makeReloadableSession = () =>
      makeSession({
        createCompactionId: () => `compaction_${String(++compactionIds)}`,
        compactionSources: source,
        runRepository: repository,
        usageSink: {
          async writeFinal(value) {
            usageWrites += 1;
            return ok(value);
          }
        }
      });

    expect(await makeReloadableSession().compactContext(command())).toMatchObject({
      ok: false,
      error: { code: "RECEIPT_WRITE_INTERRUPTED" }
    });
    const recovered = await makeReloadableSession().compactContext(command());

    expect(recovered).toMatchObject({ ok: true, value: { compactionId: "compaction_1" } });
    expect(compactionIds).toBe(1);
    expect(usageWrites).toBe(1);
  });

  test("commits usage → revision → result → budget → run marker, after the manifest and started event", async () => {
    const order: string[] = [];
    const events: CompactionEvent[] = [];
    const session = makeSession(
      {
        compactionSources: sourcesPort(inputs()),
        runRepository: recordingRepository(order),
        usageSink: recordingUsageSink(order)
      },
      events
    );
    const result = await session.compactContext(command());
    expect(result.ok).toBe(true);
    expect(order).toEqual(["manifest", "usage", "revision", "result", "budget", "commit"]);
    expect(events.map((event) => event.type)).toEqual([
      "context_compaction_started",
      "context_compaction_completed"
    ]);
    // The started event fires only after the manifest is durably written.
    const startedIndex = order.indexOf("manifest");
    expect(startedIndex).toBe(0);
  });

  test("uses the deterministic strategy when eviction alone reaches the target", async () => {
    const events: CompactionEvent[] = [];
    const session = makeSession(
      {
        compactionSources: sourcesPort(inputs({ currentTokens: 10000, targetTokens: 7000 })),
        runRepository: recordingRepository([]),
        usageSink: recordingUsageSink([])
      },
      events
    );
    const result = await session.compactContext(command());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.revision.strategy).toBe("deterministic");
    expect(result.value.revision.evictedSourceIds).toEqual(["src_body"]);
  });

  test("falls back to model-assisted when deterministic eviction cannot reach the target", async () => {
    const events: CompactionEvent[] = [];
    let summarized = false;
    const modelAssistant: CompactionModelAssistantPort = {
      async summarizeEvictable() {
        summarized = true;
        return ok({
          summaryChecksum: "d".repeat(64),
          inputTokens: 500,
          outputTokens: 120,
          precision: "estimated"
        });
      }
    };
    const session = makeSession(
      {
        // Target far below what evicting the single small-savings source can achieve.
        compactionSources: sourcesPort(inputs({ currentTokens: 100000, targetTokens: 1000 })),
        runRepository: recordingRepository([]),
        usageSink: recordingUsageSink([]),
        modelAssistant
      },
      events
    );
    const result = await session.compactContext(command());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(summarized).toBe(true);
    expect(result.value.revision.strategy).toBe("model_assisted");
    expect(result.value.revision.outputTokens).toBe(120);
  });

  test("does not commit and emits failed when building artifacts fails", async () => {
    const order: string[] = [];
    const events: CompactionEvent[] = [];
    const session = makeSession(
      {
        compactionSources: sourcesPort(inputs(), {
          code: "ARTIFACT_BUILD_FAILED"
        } as unknown as UnifiedError),
        runRepository: recordingRepository(order),
        usageSink: recordingUsageSink(order)
      },
      events
    );
    const result = await session.compactContext(command());
    expect(result.ok).toBe(false);
    // Manifest was written, but nothing after the started event committed.
    expect(order).toEqual(["manifest"]);
    expect(events.map((event) => event.type)).toEqual([
      "context_compaction_started",
      "context_compaction_failed"
    ]);
  });

  test("rejects and does not commit when the result regresses protected facts", async () => {
    const order: string[] = [];
    const events: CompactionEvent[] = [];
    const session = makeSession(
      {
        compactionSources: sourcesPort(
          inputs({
            // Prior compaction protected a fact the current manifest drops.
            prior: {
              throughSequence: 10,
              protectedFacts: [
                {
                  kind: "approved_plan",
                  factId: "fact_dropped",
                  sourceId: "s",
                  checksum: "b".repeat(64),
                  sourceRevision: 1
                }
              ]
            }
          })
        ),
        runRepository: recordingRepository(order),
        usageSink: recordingUsageSink(order)
      },
      events
    );
    const result = await session.compactContext(command());
    expect(result).toMatchObject({ ok: false, error: { code: "AGENT_COMPACTION_REGRESSED" } });
    expect(order).toEqual(["manifest"]);
  });

  test("replaces a stale execution fact with the latest completed step before compaction", async () => {
    const [baseStep] = executionRecord().steps;
    if (baseStep === undefined) throw new Error("Expected one plan execution step fixture");
    const staleRecord = executionRecord({
      revision: 1,
      steps: [
        {
          ...baseStep,
          status: "running",
          completedAt: null,
          verification: [],
          eventSequence: 10
        }
      ]
    });
    const staleFact = createPlanExecutionProtectedFact(staleRecord);
    const latestRecord = executionRecord();
    let writtenManifest: JsonObject | undefined;
    const repository: CompactionRunRepositoryPort = {
      ...recordingRepository([]),
      async writeCompactionManifest(manifest) {
        writtenManifest = manifest;
        return ok(manifest);
      }
    };
    const loaded = inputs({
      protectedFacts: [goalFact, staleFact],
      prior: { throughSequence: 10, protectedFacts: [goalFact, staleFact] },
      ...({ planExecutionRecord: latestRecord } as unknown as Partial<CompactionInputs>)
    });
    const session = makeSession({
      compactionSources: sourcesPort(loaded),
      runRepository: repository,
      usageSink: recordingUsageSink([])
    });

    const result = await session.compactContext(command());
    expect(result.ok).toBe(true);
    const protectedFacts = writtenManifest?.["protectedFacts"] as JsonObject[] | undefined;
    expect(protectedFacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "plan_execution",
          sourceId: "execution_01",
          sourceRevision: 3,
          planExecution: expect.objectContaining({
            revision: 3,
            steps: [
              expect.objectContaining({
                stepId: "step_01",
                status: "completed",
                verification: ["chapter_03@7"],
                checkpointId: "checkpoint_01",
                eventSequence: 12
              })
            ]
          })
        })
      ])
    );
  });

  test("is unavailable without the compaction ports", async () => {
    const session = createAgentContextSession({
      draftSession: {
        async resolveStartDraft() {
          return err({ code: "unused" } as unknown as UnifiedError);
        }
      } as unknown as Pick<AgentRunDraftSession, "resolveStartDraft">,
      budgetInputs: budgetInputsStub
    });
    const result = await session.compactContext(command());
    expect(result).toMatchObject({
      ok: false,
      error: { code: "AGENT_CONTEXT_COMPACTION_UNAVAILABLE" }
    });
  });
});

// Silence unused-import lint for the shared draft-session import used only for typing above.
void createAgentRunDraftSession;
