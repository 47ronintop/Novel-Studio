import { describe, expect, test } from "vitest";

import * as engineExports from "../src/index.js";
import {
  buildCompactionInputManifest,
  createContextCompactionRevision,
  orderEvictableSources,
  planDeterministicEviction,
  validateCompactionResultProgress,
  type BuildCompactionInputManifestInput,
  type EvictableContextSource,
  type ProtectedContextFact
} from "../src/index.js";

function planExecutionFact(overrides: Record<string, unknown> = {}): ProtectedContextFact {
  const create = (engineExports as unknown as Record<string, unknown>)[
    "createPlanExecutionProtectedFact"
  ];
  expect(typeof create).toBe("function");
  if (typeof create !== "function") throw new Error("createPlanExecutionProtectedFact is missing");
  return (create as (record: Record<string, unknown>) => ProtectedContextFact)({
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
  });
}

const goalFact: ProtectedContextFact = {
  kind: "run_goal",
  factId: "fact_goal",
  sourceId: "src_goal",
  checksum: "a".repeat(64),
  eventSequence: 1
};

const planFact: ProtectedContextFact = {
  kind: "approved_plan",
  factId: "fact_plan",
  sourceId: "src_plan",
  checksum: "b".repeat(64),
  sourceRevision: 2
};

function evictable(overrides: Partial<EvictableContextSource> = {}): EvictableContextSource {
  return {
    sourceId: "src_1",
    sourceRevision: 0,
    layer: "tool_result",
    checksum: "c".repeat(64),
    tokenCount: 1000,
    evictionReason: "rereadable_body",
    pointerTokenCount: 50,
    ...overrides
  };
}

function manifestInput(
  overrides: Partial<BuildCompactionInputManifestInput> = {}
): BuildCompactionInputManifestInput {
  return {
    compactionId: "compaction_01",
    runId: "run_01",
    sourceSnapshotId: "context_01",
    throughSequence: 20,
    protectedFacts: [goalFact, planFact],
    evictableSources: [evictable()],
    createdAt: "2026-07-16T00:00:00.000Z",
    ...overrides
  };
}

describe("buildCompactionInputManifest", () => {
  test("builds a checksummed manifest from protected facts and evictable sources", () => {
    const result = buildCompactionInputManifest(manifestInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.schemaVersion).toBe("1.0");
    expect(result.value.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(result.value.protectedFacts).toHaveLength(2);
    expect(result.value.throughSequence).toBe(20);
  });

  test("rejects a protected fact carrying both sourceRevision and eventSequence", () => {
    const bad = { ...goalFact, sourceRevision: 3 } as unknown as ProtectedContextFact;
    const result = buildCompactionInputManifest(manifestInput({ protectedFacts: [bad] }));
    expect(result).toMatchObject({
      ok: false,
      error: { code: "AGENT_COMPACTION_MANIFEST_INVALID" }
    });
  });

  test("rejects a protected fact carrying neither provenance field", () => {
    const bad = {
      kind: "run_goal",
      factId: "f",
      sourceId: "s",
      checksum: "d".repeat(64)
    } as unknown as ProtectedContextFact;
    const result = buildCompactionInputManifest(manifestInput({ protectedFacts: [bad] }));
    expect(result).toMatchObject({
      ok: false,
      error: { code: "AGENT_COMPACTION_MANIFEST_INVALID" }
    });
  });

  test("rejects an empty fact checksum", () => {
    const bad = { ...goalFact, checksum: "" };
    const result = buildCompactionInputManifest(manifestInput({ protectedFacts: [bad] }));
    expect(result).toMatchObject({
      ok: false,
      error: { code: "AGENT_COMPACTION_MANIFEST_INVALID" }
    });
  });

  test("rejects an evictable source whose pointer is larger than its body", () => {
    const result = buildCompactionInputManifest(
      manifestInput({ evictableSources: [evictable({ tokenCount: 40, pointerTokenCount: 50 })] })
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "AGENT_COMPACTION_MANIFEST_INVALID" }
    });
  });

  test("is stable: identical inputs yield identical checksums", () => {
    const first = buildCompactionInputManifest(manifestInput());
    const second = buildCompactionInputManifest(manifestInput());
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.checksum).toBe(second.value.checksum);
  });
});

describe("orderEvictableSources — the documented deterministic order", () => {
  test("evicts duplicate, then raw_result, then rereadable_body, then superseded_transient", () => {
    const sources: EvictableContextSource[] = [
      evictable({ sourceId: "s_superseded", evictionReason: "superseded_transient" }),
      evictable({ sourceId: "s_rereadable", evictionReason: "rereadable_body" }),
      evictable({ sourceId: "s_raw", evictionReason: "raw_result" }),
      evictable({ sourceId: "s_duplicate", evictionReason: "duplicate" })
    ];
    expect(orderEvictableSources(sources).map((source) => source.sourceId)).toEqual([
      "s_duplicate",
      "s_raw",
      "s_rereadable",
      "s_superseded"
    ]);
  });

  test("keeps original order within one reason (stable)", () => {
    const sources: EvictableContextSource[] = [
      evictable({ sourceId: "s_a", evictionReason: "duplicate" }),
      evictable({ sourceId: "s_b", evictionReason: "duplicate" })
    ];
    expect(orderEvictableSources(sources).map((source) => source.sourceId)).toEqual(["s_a", "s_b"]);
  });
});

describe("planDeterministicEviction", () => {
  test("evicts in order until the projected tokens reach the target", () => {
    const sources: EvictableContextSource[] = [
      evictable({
        sourceId: "s_dup",
        evictionReason: "duplicate",
        tokenCount: 500,
        pointerTokenCount: 0
      }),
      evictable({
        sourceId: "s_raw",
        evictionReason: "raw_result",
        tokenCount: 500,
        pointerTokenCount: 0
      })
    ];
    const plan = planDeterministicEviction({
      evictableSources: sources,
      currentTokens: 2000,
      targetTokens: 1600
    });
    // Evicting only the duplicate (frees 500) brings 2000 → 1500 ≤ 1600.
    expect(plan.evictedSourceIds).toEqual(["s_dup"]);
    expect(plan.projectedTokens).toBe(1500);
    expect(plan.reachedTarget).toBe(true);
  });

  test("evicts everything and reports not-reached when still over target", () => {
    const sources: EvictableContextSource[] = [
      evictable({
        sourceId: "s_dup",
        evictionReason: "duplicate",
        tokenCount: 300,
        pointerTokenCount: 0
      })
    ];
    const plan = planDeterministicEviction({
      evictableSources: sources,
      currentTokens: 5000,
      targetTokens: 1000
    });
    expect(plan.evictedSourceIds).toEqual(["s_dup"]);
    expect(plan.projectedTokens).toBe(4700);
    expect(plan.reachedTarget).toBe(false);
  });

  test("evicts nothing when already under target", () => {
    const plan = planDeterministicEviction({
      evictableSources: [evictable()],
      currentTokens: 500,
      targetTokens: 1000
    });
    expect(plan.evictedSourceIds).toEqual([]);
    expect(plan.reachedTarget).toBe(true);
  });
});

describe("validateCompactionResultProgress — regression guard", () => {
  const priorManifest = buildCompactionInputManifest(manifestInput());

  test("accepts a candidate that advances throughSequence and preserves protected checksums", () => {
    if (!priorManifest.ok) return;
    const result = validateCompactionResultProgress({
      candidateThroughSequence: 30,
      candidateProtectedFacts: [goalFact, planFact],
      prior: {
        throughSequence: priorManifest.value.throughSequence,
        protectedFacts: priorManifest.value.protectedFacts
      }
    });
    expect(result.ok).toBe(true);
  });

  test("rejects a candidate that regresses throughSequence", () => {
    if (!priorManifest.ok) return;
    const result = validateCompactionResultProgress({
      candidateThroughSequence: 10,
      candidateProtectedFacts: [goalFact, planFact],
      prior: { throughSequence: 20, protectedFacts: priorManifest.value.protectedFacts }
    });
    expect(result).toMatchObject({ ok: false, error: { code: "AGENT_COMPACTION_REGRESSED" } });
  });

  test("rejects a candidate that drops a prior protected fact", () => {
    if (!priorManifest.ok) return;
    const result = validateCompactionResultProgress({
      candidateThroughSequence: 25,
      candidateProtectedFacts: [goalFact],
      prior: { throughSequence: 20, protectedFacts: priorManifest.value.protectedFacts }
    });
    expect(result).toMatchObject({ ok: false, error: { code: "AGENT_COMPACTION_REGRESSED" } });
  });

  test("rejects a candidate that alters a protected fact checksum", () => {
    if (!priorManifest.ok) return;
    const altered: ProtectedContextFact = { ...planFact, checksum: "e".repeat(64) };
    const result = validateCompactionResultProgress({
      candidateThroughSequence: 25,
      candidateProtectedFacts: [goalFact, altered],
      prior: { throughSequence: 20, protectedFacts: priorManifest.value.protectedFacts }
    });
    expect(result).toMatchObject({ ok: false, error: { code: "AGENT_COMPACTION_REGRESSED" } });
  });

  test("accepts any candidate when there is no prior compaction", () => {
    const result = validateCompactionResultProgress({
      candidateThroughSequence: 5,
      candidateProtectedFacts: [goalFact]
    });
    expect(result.ok).toBe(true);
  });

  test("keeps plan execution progress by source id and rejects revision or terminal-step regression", () => {
    const prior = planExecutionFact();
    expect(prior).toMatchObject({
      kind: "plan_execution",
      factId: "plan_execution:execution_01",
      sourceId: "execution_01",
      sourceRevision: 3,
      planExecution: {
        planExecutionId: "execution_01",
        revision: 3,
        steps: [
          {
            stepId: "step_01",
            status: "completed",
            verification: ["chapter_03@7"],
            checkpointId: "checkpoint_01",
            eventSequence: 12
          }
        ]
      }
    });

    const revisionRegressed = planExecutionFact({ revision: 2 });
    expect(
      validateCompactionResultProgress({
        candidateThroughSequence: 30,
        candidateProtectedFacts: [revisionRegressed],
        prior: { throughSequence: 20, protectedFacts: [prior] }
      })
    ).toMatchObject({ ok: false, error: { code: "AGENT_COMPACTION_REGRESSED" } });

    const stepRegressed = planExecutionFact({
      revision: 4,
      steps: [
        {
          stepId: "step_01",
          title: "Read chapter",
          status: "running",
          startedAt: "2026-07-17T01:00:00.000Z",
          completedAt: null,
          verification: [],
          deviationKind: "none",
          blockedReason: null,
          checkpointId: "checkpoint_01",
          eventSequence: 13
        }
      ]
    });
    expect(
      validateCompactionResultProgress({
        candidateThroughSequence: 30,
        candidateProtectedFacts: [stepRegressed],
        prior: { throughSequence: 20, protectedFacts: [prior] }
      })
    ).toMatchObject({ ok: false, error: { code: "AGENT_COMPACTION_REGRESSED" } });

    const advanced = planExecutionFact({
      revision: 4,
      steps: [
        {
          stepId: "step_01",
          title: "Read chapter",
          status: "blocked",
          startedAt: "2026-07-17T01:00:00.000Z",
          completedAt: "2026-07-17T01:02:00.000Z",
          verification: ["chapter_03@7", "blocked after external edit"],
          deviationKind: "material",
          blockedReason: "Target changed",
          checkpointId: "checkpoint_01",
          eventSequence: 13
        }
      ]
    });
    expect(
      validateCompactionResultProgress({
        candidateThroughSequence: 30,
        candidateProtectedFacts: [advanced],
        prior: { throughSequence: 20, protectedFacts: [prior] }
      }).ok
    ).toBe(true);
  });
});

describe("createContextCompactionRevision", () => {
  test("assembles a completed deterministic revision", () => {
    const manifest = buildCompactionInputManifest(manifestInput());
    if (!manifest.ok) return;
    const revision = createContextCompactionRevision({
      manifest: manifest.value,
      revision: 1,
      trigger: "manual",
      strategy: "deterministic",
      resultSnapshotId: "context_02",
      budgetSnapshotId: "budget_02",
      evictedSourceIds: ["src_1"],
      inputTokens: 0,
      outputTokens: 0,
      usageRecordId: null,
      precision: "estimated",
      summaryChecksum: "f".repeat(64),
      status: "completed",
      createdAt: "2026-07-16T00:01:00.000Z"
    });
    expect(revision.schemaVersion).toBe("1.0");
    expect(revision.strategy).toBe("deterministic");
    expect(revision.protectedFactIds).toEqual(["fact_goal", "fact_plan"]);
    expect(revision.evictedSourceIds).toEqual(["src_1"]);
    expect(revision.inputManifestId).toBe(manifest.value.compactionId);
    expect(revision.inputManifestChecksum).toBe(manifest.value.checksum);
    expect(revision.throughSequence).toBe(20);
  });
});
