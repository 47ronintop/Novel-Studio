import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import { isErr, isOk } from "@novel-studio/shared";

import { buildContextBundle, type ContextBuildInput, type ContextCandidate } from "../src/index.js";

const sourceRef = {
  entityType: "chapter",
  entityId: "ch_01",
  range: {
    startLine: 1,
    endLine: 3
  }
};

const goalCandidate = {
  refType: "goal",
  refId: "goal_review",
  content: "Review the current chapter for continuity.",
  priority: 1,
  sourceRefs: [{ entityType: "workflow", entityId: "wf_review" }]
} satisfies ContextCandidate;

const baseCandidates = [
  goalCandidate,
  {
    refType: "chapter",
    refId: "ch_01",
    content: "The rain kept its own counsel over the city.",
    priority: 2,
    sourceRefs: [sourceRef]
  },
  {
    refType: "memory",
    refId: "mem_confirmed",
    content: "The protagonist never reveals the old oath aloud.",
    priority: 3,
    memoryConfidence: "confirmed",
    sourceRefs: [{ entityType: "memory", entityId: "mem_confirmed" }]
  },
  {
    refType: "character",
    refId: "chr_hero",
    content: "The protagonist hides fear behind procedural calm.",
    priority: 4,
    sourceRefs: [{ entityType: "character", entityId: "chr_hero" }]
  },
  {
    refType: "world",
    refId: "loc_capital",
    content: "The capital forbids open flame after midnight.",
    priority: 5,
    sourceRefs: [{ entityType: "world", entityId: "loc_capital" }]
  },
  {
    refType: "timeline",
    refId: "evt_arrival",
    content: "Arrival happens before the council summons.",
    priority: 6,
    sourceRefs: [{ entityType: "timeline", entityId: "evt_arrival" }]
  }
] satisfies readonly ContextCandidate[];

const baseInput = {
  schemaVersion: "1.0",
  contextBundleId: "ctx_m7_2_01",
  workflowRunId: "wfrun_01",
  traceId: "trace_context_01",
  goal: "Review current chapter.",
  budget: {
    maxTokens: 500
  },
  candidates: baseCandidates
} satisfies ContextBuildInput;

describe("Context Engine", () => {
  test("builds a context bundle from explicit project candidates with source trace", () => {
    const result = buildContextBundle(baseInput);

    expect(isOk(result)).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.schemaVersion).toBe("1.0");
    expect(result.value.contextBundleId).toBe("ctx_m7_2_01");
    expect(result.value.workflowRunId).toBe("wfrun_01");
    expect(result.value.items.map((item) => item.refType)).toEqual([
      "goal",
      "chapter",
      "memory",
      "character",
      "world",
      "timeline"
    ]);
    expect(result.value.items[1]).toEqual({
      refType: "chapter",
      refId: "ch_01",
      content: "The rain kept its own counsel over the city.",
      tokenEstimate: 9,
      sourceRefs: [sourceRef]
    });
    expect(result.value.trace.includedRefs).toEqual([
      { refType: "goal", refId: "goal_review", tokenEstimate: 10 },
      { refType: "chapter", refId: "ch_01", tokenEstimate: 9 },
      { refType: "memory", refId: "mem_confirmed", tokenEstimate: 11 },
      { refType: "character", refId: "chr_hero", tokenEstimate: 11 },
      { refType: "world", refId: "loc_capital", tokenEstimate: 10 },
      { refType: "timeline", refId: "evt_arrival", tokenEstimate: 10 }
    ]);
    expect(result.value.budget).toEqual({
      maxTokens: 500,
      estimatedTokens: 61
    });
    expect(result.value.trace.excludedRefs).toEqual([]);
  });

  test("enforces token budget and records excluded candidates", () => {
    const result = buildContextBundle({
      ...baseInput,
      budget: {
        maxTokens: 25
      }
    });

    expect(isOk(result)).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.items.map((item) => item.refId)).toEqual(["goal_review", "ch_01"]);
    expect(result.value.budget.estimatedTokens).toBe(19);
    expect(result.value.trace.excludedRefs).toEqual([
      {
        refType: "memory",
        refId: "mem_confirmed",
        reason: "budget_exceeded",
        tokenEstimate: 11
      },
      {
        refType: "character",
        refId: "chr_hero",
        reason: "budget_exceeded",
        tokenEstimate: 11
      },
      {
        refType: "world",
        refId: "loc_capital",
        reason: "budget_exceeded",
        tokenEstimate: 10
      },
      {
        refType: "timeline",
        refId: "evt_arrival",
        reason: "budget_exceeded",
        tokenEstimate: 10
      }
    ]);
  });

  test("filters unconfirmed memories unless policy explicitly allows them", () => {
    const aiMemory = {
      refType: "memory",
      refId: "mem_ai_unconfirmed",
      content: "The antagonist might be secretly allied with the envoy.",
      priority: 2,
      memoryConfidence: "ai-unconfirmed",
      sourceRefs: [{ entityType: "memory", entityId: "mem_ai_unconfirmed" }]
    } satisfies ContextCandidate;

    const filtered = buildContextBundle({
      ...baseInput,
      candidates: [goalCandidate, aiMemory]
    });
    const allowed = buildContextBundle({
      ...baseInput,
      policy: {
        memoryConfidence: ["confirmed", "ai-unconfirmed"]
      },
      candidates: [goalCandidate, aiMemory]
    });

    expect(isOk(filtered)).toBe(true);
    expect(isOk(allowed)).toBe(true);
    if (!filtered.ok || !allowed.ok) {
      return;
    }

    expect(filtered.value.items.map((item) => item.refId)).toEqual(["goal_review"]);
    expect(filtered.value.trace.excludedRefs).toEqual([
      {
        refType: "memory",
        refId: "mem_ai_unconfirmed",
        reason: "memory_confidence_filtered",
        tokenEstimate: 12
      }
    ]);
    expect(allowed.value.items.map((item) => item.refId)).toEqual([
      "goal_review",
      "mem_ai_unconfirmed"
    ]);
  });

  test("blocks full-novel blind stuffing attempts", () => {
    const chapterCandidates = [1, 2, 3, 4].map((index) => {
      return {
        refType: "chapter",
        refId: `ch_0${index}`,
        content: `Chapter ${index} bulk content.`,
        priority: index,
        sourceRefs: [{ entityType: "chapter", entityId: `ch_0${index}` }]
      } satisfies ContextCandidate;
    });

    const result = buildContextBundle({
      ...baseInput,
      candidates: chapterCandidates
    });

    expect(isErr(result)).toBe(true);
    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe("CONTEXT_FULL_NOVEL_STUFFING_BLOCKED");
    expect(result.error.category).toBe("ValidationError");
    expect(result.error.redactedDetail).toEqual({
      chapterCandidateCount: 4,
      maxChapterCandidates: 3
    });
  });

  test("rejects invalid build input", () => {
    const result = buildContextBundle({
      ...baseInput,
      budget: {
        maxTokens: 0
      }
    });

    expect(isErr(result)).toBe(true);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe("CONTEXT_BUDGET_INVALID");
  });

  test("does not depend on Agent, LLM Adapter, or Repository packages", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8")
    ) as {
      dependencies?: Record<string, string>;
    };

    expect(packageJson.dependencies ?? {}).toEqual({
      "@novel-studio/shared": "0.1.0"
    });
  });
});
