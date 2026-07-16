import { describe, expect, test } from "vitest";

import {
  CONTEXT_BUDGET_OUTPUT_RESERVE_MAX,
  CONTEXT_BUDGET_OUTPUT_RESERVE_MIN,
  aggregateContextPrecision,
  calculateContextBudget,
  createDeterministicTokenEstimator,
  type CalculateContextBudgetInput
} from "../src/index.js";

function baseInput(
  overrides: Partial<CalculateContextBudgetInput> = {}
): CalculateContextBudgetInput {
  return {
    contextBudgetSnapshotId: "budget_01",
    provider: "demo",
    model: "scripted-agent",
    contextWindow: 128000,
    maxOutputTokens: 8000,
    toolReserve: 2000,
    systemReserve: 1000,
    requiredContextTokens: 8000,
    usedTokens: 0,
    precision: "estimated",
    calculatedAt: "2026-07-16T00:00:00.000Z",
    ...overrides
  };
}

describe("calculateContextBudget arithmetic", () => {
  test("subtracts explicit output/tool/system reserves from an 8K window", () => {
    const result = calculateContextBudget(
      baseInput({
        contextWindow: 8000,
        maxOutputTokens: 1024,
        toolReserve: 512,
        systemReserve: 256,
        requiredContextTokens: 4000
      })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.outputReserve).toBe(1024);
    expect(result.value.safeInputBudget).toBe(8000 - 1024 - 512 - 256);
    expect(result.value.contextWindowSemantics).toBe("shared_input_output_window");
  });

  test("computes a 32K window with an explicit maximum output", () => {
    const result = calculateContextBudget(
      baseInput({ contextWindow: 32000, maxOutputTokens: 8000, toolReserve: 1500, systemReserve: 500 })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.maxOutputTokens).toBe(8000);
    expect(result.value.outputReserve).toBe(8000);
    expect(result.value.safeInputBudget).toBe(32000 - 8000 - 1500 - 500);
  });

  test("computes a 128K window and reports remaining tokens against used", () => {
    const result = calculateContextBudget(
      baseInput({ contextWindow: 128000, maxOutputTokens: 16000, toolReserve: 3000, systemReserve: 1000, usedTokens: 5000 })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const safe = 128000 - 16000 - 3000 - 1000;
    expect(result.value.safeInputBudget).toBe(safe);
    expect(result.value.remainingTokens).toBe(safe - 5000);
  });

  test("falls back to min(16K, max(4K, 15% window)) when no valid maximum output", () => {
    const { maxOutputTokens: _drop, ...noMax } = baseInput();
    void _drop;
    const small = calculateContextBudget({ ...noMax, contextWindow: 8000, toolReserve: 0, systemReserve: 0, requiredContextTokens: 1000 });
    const large = calculateContextBudget({ ...noMax, contextWindow: 200000, toolReserve: 0, systemReserve: 0, requiredContextTokens: 1000 });
    expect(small.ok && large.ok).toBe(true);
    if (!small.ok || !large.ok) return;
    // 15% of 8000 = 1200 → clamped up to the 4K floor.
    expect(small.value.outputReserve).toBe(CONTEXT_BUDGET_OUTPUT_RESERVE_MIN);
    // 15% of 200000 = 30000 → clamped down to the 16K ceiling.
    expect(large.value.outputReserve).toBe(CONTEXT_BUDGET_OUTPUT_RESERVE_MAX);
  });

  test("treats an invalid explicit maximum output as missing and uses the fallback", () => {
    const result = calculateContextBudget(
      baseInput({ contextWindow: 40000, maxOutputTokens: -1, toolReserve: 0, systemReserve: 0, requiredContextTokens: 1000 })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 15% of 40000 = 6000, within [4K, 16K].
    expect(result.value.outputReserve).toBe(6000);
  });

  test("clamps remaining tokens to zero when used exceeds the safe input budget", () => {
    const result = calculateContextBudget(
      baseInput({ contextWindow: 32000, maxOutputTokens: 8000, toolReserve: 0, systemReserve: 0, requiredContextTokens: 1000, usedTokens: 999999 })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.remainingTokens).toBe(0);
  });
});

describe("calculateContextBudget rejection", () => {
  test.each([
    ["negative context window", { contextWindow: -1 }],
    ["zero context window", { contextWindow: 0 }],
    ["NaN context window", { contextWindow: Number.NaN }],
    ["infinite context window", { contextWindow: Number.POSITIVE_INFINITY }],
    ["overflowing context window", { contextWindow: Number.MAX_SAFE_INTEGER + 2 }],
    ["negative tool reserve", { toolReserve: -1 }],
    ["NaN system reserve", { systemReserve: Number.NaN }],
    ["negative required tokens", { requiredContextTokens: -1 }],
    ["negative used tokens", { usedTokens: -5 }]
  ])("rejects %s", (_label, overrides) => {
    const result = calculateContextBudget(baseInput(overrides as Partial<CalculateContextBudgetInput>));
    expect(result).toMatchObject({ ok: false, error: { code: "AGENT_CONTEXT_BUDGET_INVALID" } });
  });

  test("rejects when reserves consume the entire window", () => {
    const result = calculateContextBudget(
      baseInput({ contextWindow: 8000, maxOutputTokens: 8000, toolReserve: 1000, systemReserve: 0, requiredContextTokens: 1000 })
    );
    expect(result).toMatchObject({ ok: false, error: { code: "AGENT_CONTEXT_BUDGET_INSUFFICIENT" } });
  });

  test("rejects when the safe input budget falls below the required context tokens (8K floor)", () => {
    const result = calculateContextBudget(
      baseInput({ contextWindow: 12000, maxOutputTokens: 4000, toolReserve: 500, systemReserve: 500, requiredContextTokens: 8000 })
    );
    // safeInputBudget = 7000 < 8000 required.
    expect(result).toMatchObject({ ok: false, error: { code: "AGENT_CONTEXT_BUDGET_INSUFFICIENT" } });
  });
});

describe("precision", () => {
  test("echoes the supplied precision into the snapshot", () => {
    for (const precision of ["reported", "estimated", "unknown"] as const) {
      const result = calculateContextBudget(baseInput({ precision }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.precision).toBe(precision);
    }
  });

  test("aggregateContextPrecision takes the least-confident value", () => {
    expect(aggregateContextPrecision(["reported", "reported"])).toBe("reported");
    expect(aggregateContextPrecision(["reported", "estimated"])).toBe("estimated");
    expect(aggregateContextPrecision(["estimated", "unknown"])).toBe("unknown");
    expect(aggregateContextPrecision([])).toBe("reported");
  });
});

describe("model switching", () => {
  test("a different model window yields a different budget and a distinct id", () => {
    const first = calculateContextBudget(baseInput({ contextBudgetSnapshotId: "budget_a", model: "small", contextWindow: 8000, maxOutputTokens: 2000, toolReserve: 0, systemReserve: 0, requiredContextTokens: 1000 }));
    const second = calculateContextBudget(baseInput({ contextBudgetSnapshotId: "budget_b", model: "large", contextWindow: 128000, maxOutputTokens: 2000, toolReserve: 0, systemReserve: 0, requiredContextTokens: 1000 }));
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.contextBudgetSnapshotId).not.toBe(second.value.contextBudgetSnapshotId);
    expect(first.value.model).toBe("small");
    expect(second.value.model).toBe("large");
    expect(second.value.safeInputBudget).toBeGreaterThan(first.value.safeInputBudget);
  });
});

describe("deterministic token estimator", () => {
  const estimator = createDeterministicTokenEstimator();

  test("marks local estimates as estimated, never reported", () => {
    expect(estimator.count("hello world", "profile-01").precision).toBe("estimated");
  });

  test("counts an empty string as zero tokens", () => {
    expect(estimator.count("", "profile-01").tokens).toBe(0);
  });

  test("is deterministic and grows with UTF-8 byte length", () => {
    const short = estimator.count("abcd", "profile-01");
    const long = estimator.count("abcd".repeat(100), "profile-01");
    expect(estimator.count("abcd", "profile-01").tokens).toBe(short.tokens);
    expect(long.tokens).toBeGreaterThan(short.tokens);
  });

  test("counts multibyte CJK text by its UTF-8 byte length", () => {
    // Each CJK code point is 3 UTF-8 bytes; ceil(9 / 4) = 3.
    expect(estimator.count("小说创", "profile-01").tokens).toBe(3);
  });
});
