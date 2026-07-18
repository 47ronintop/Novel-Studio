import { describe, expect, test } from "vitest";

import {
  usageRecordIdempotencyKey,
  validateAgentUsageRecord,
  type AgentUsageRecord
} from "../src/index.js";

function baseRecord(overrides: Partial<AgentUsageRecord> = {}): AgentUsageRecord {
  return {
    schemaVersion: "1.0",
    usageId: "usage_01",
    runId: "run_01",
    conversationId: "conv_01",
    projectId: "project_01",
    roundId: "round_01",
    finalSequence: 12,
    provider: "demo",
    model: "scripted-agent",
    inputTokens: 1000,
    outputTokens: 200,
    totalTokens: 1200,
    usageStatus: "estimated",
    precision: "estimated",
    pricingVersion: null,
    unitPrices: null,
    cost: { amount: 0, currency: "", status: "unknown" },
    contextWindow: 128000,
    safeInputBudget: 117000,
    terminationReason: "compaction",
    timestamp: "2026-07-16T00:00:00.000Z",
    localDate: "2026-07-16",
    timezone: "Asia/Shanghai",
    utcOffsetMinutes: 480,
    ...overrides
  };
}

describe("usageRecordIdempotencyKey", () => {
  test("keys by runId:roundId:finalSequence", () => {
    expect(
      usageRecordIdempotencyKey({ runId: "run_01", roundId: "round_01", finalSequence: 12 })
    ).toBe("run_01:round_01:12");
  });
});

describe("validateAgentUsageRecord", () => {
  test("accepts a well-formed record", () => {
    const result = validateAgentUsageRecord(baseRecord());
    expect(result.ok).toBe(true);
  });

  test("accepts a negative UTC offset (west-of-UTC timezone)", () => {
    const result = validateAgentUsageRecord(
      baseRecord({ timezone: "America/New_York", utcOffsetMinutes: -300 })
    );
    expect(result.ok).toBe(true);
  });

  test("accepts optional cached/reasoning/compaction token fields", () => {
    const result = validateAgentUsageRecord(
      baseRecord({
        cachedTokens: 100,
        reasoningTokens: 50,
        compactionBeforeTokens: 5000,
        compactionAfterTokens: 2000
      })
    );
    expect(result.ok).toBe(true);
  });

  test("accepts an actual provider cost without pricing registry metadata", () => {
    const result = validateAgentUsageRecord(
      baseRecord({
        usageStatus: "actual",
        pricingVersion: null,
        unitPrices: null,
        cost: { amount: 0.0123, currency: "USD", status: "actual" }
      })
    );
    expect(result.ok).toBe(true);
  });

  test("accepts an exactly recomputable estimated cost with a captured price snapshot", () => {
    const result = validateAgentUsageRecord(
      baseRecord({
        inputTokens: 1000,
        outputTokens: 200,
        cachedTokens: 100,
        reasoningTokens: 50,
        pricingVersion: "pricing-2026-07-17",
        unitPrices: {
          inputPerMillion: 2,
          outputPerMillion: 4,
          cachedPerMillion: 1,
          reasoningPerMillion: 8,
          currency: "USD"
        },
        cost: { amount: 0.0033, currency: "USD", status: "estimated" }
      })
    );
    expect(result.ok).toBe(true);
  });

  test("accepts a large estimated cost calculated in the registry operation order", () => {
    const inputTokens = 2_067_828_856_563;
    const outputTokens = 8_186_836_815_705;
    const cachedTokens = 267_470_778_060;
    const reasoningTokens = 2_487_121_936_796;
    const unitPrices = {
      inputPerMillion: 38_822.390245245384,
      outputPerMillion: 92_349.97973369903,
      cachedPerMillion: 19_579.586251203596,
      reasoningPerMillion: 70_805.98376757126,
      currency: "USD"
    };
    const amount =
      (inputTokens * unitPrices.inputPerMillion +
        outputTokens * unitPrices.outputPerMillion +
        cachedTokens * unitPrices.cachedPerMillion +
        reasoningTokens * unitPrices.reasoningPerMillion) /
      1_000_000;

    const result = validateAgentUsageRecord(
      baseRecord({
        inputTokens,
        outputTokens,
        cachedTokens,
        reasoningTokens,
        totalTokens: inputTokens + outputTokens,
        pricingVersion: "pricing-large",
        unitPrices,
        cost: { amount, currency: "USD", status: "estimated" }
      })
    );

    expect(result.ok).toBe(true);
  });

  test.each([
    [
      "an unknown cost with a currency",
      { cost: { amount: 0, currency: "USD", status: "unknown" } }
    ],
    ["an unknown cost with an amount", { cost: { amount: 0.01, currency: "", status: "unknown" } }],
    [
      "an actual cost with registry metadata",
      {
        pricingVersion: "pricing-2026-07-17",
        unitPrices: { inputPerMillion: 2, outputPerMillion: 4, currency: "USD" },
        cost: { amount: 0.01, currency: "USD", status: "actual" }
      }
    ],
    [
      "an estimated cost without a price snapshot",
      {
        pricingVersion: null,
        unitPrices: null,
        cost: { amount: 0.01, currency: "USD", status: "estimated" }
      }
    ],
    [
      "an estimated cost with an unrecomputable amount",
      {
        pricingVersion: "pricing-2026-07-17",
        unitPrices: { inputPerMillion: 2, outputPerMillion: 4, currency: "USD" },
        cost: { amount: 0.01, currency: "USD", status: "estimated" }
      }
    ],
    [
      "an estimated cost whose pricing currency differs",
      {
        pricingVersion: "pricing-2026-07-17",
        unitPrices: { inputPerMillion: 2, outputPerMillion: 4, currency: "CNY" },
        cost: { amount: 0.0028, currency: "USD", status: "estimated" }
      }
    ],
    [
      "a negative unit price",
      {
        pricingVersion: "pricing-2026-07-17",
        unitPrices: { inputPerMillion: -2, outputPerMillion: 4, currency: "USD" },
        cost: { amount: 0.0028, currency: "USD", status: "estimated" }
      }
    ]
  ])("rejects %s", (_label, overrides) => {
    const result = validateAgentUsageRecord(baseRecord(overrides as Partial<AgentUsageRecord>));
    expect(result).toMatchObject({ ok: false, error: { code: "AGENT_USAGE_RECORD_INVALID" } });
  });

  test("rejects a record carrying a prompt or provider frame", () => {
    const unsafeRecord = {
      ...baseRecord(),
      prompt: "do not persist this",
      providerFrame: { hiddenReasoning: "do not persist this either" }
    } as AgentUsageRecord;

    const result = validateAgentUsageRecord(unsafeRecord);

    expect(result).toMatchObject({ ok: false, error: { code: "AGENT_USAGE_RECORD_INVALID" } });
  });

  test.each([
    ["negative input tokens", { inputTokens: -1 }],
    ["NaN output tokens", { outputTokens: Number.NaN }],
    ["infinite total tokens", { totalTokens: Number.POSITIVE_INFINITY }],
    ["negative context window", { contextWindow: -1 }],
    ["negative safe input budget", { safeInputBudget: -1 }],
    ["negative cached tokens", { cachedTokens: -1 }],
    ["negative cost amount", { cost: { amount: -1, currency: "USD", status: "actual" } }],
    ["overflowing offset", { utcOffsetMinutes: 100000 }]
  ])("rejects %s", (_label, overrides) => {
    const result = validateAgentUsageRecord(baseRecord(overrides as Partial<AgentUsageRecord>));
    expect(result).toMatchObject({ ok: false, error: { code: "AGENT_USAGE_RECORD_INVALID" } });
  });

  test("rejects a malformed local date", () => {
    const result = validateAgentUsageRecord(baseRecord({ localDate: "2026/07/16" }));
    expect(result).toMatchObject({ ok: false, error: { code: "AGENT_USAGE_RECORD_INVALID" } });
  });

  test("rejects a total below input plus output", () => {
    const result = validateAgentUsageRecord(
      baseRecord({ inputTokens: 1000, outputTokens: 500, totalTokens: 1000 })
    );
    expect(result).toMatchObject({ ok: false, error: { code: "AGENT_USAGE_RECORD_INVALID" } });
  });
});
