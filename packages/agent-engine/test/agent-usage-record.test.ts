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
    expect(usageRecordIdempotencyKey({ runId: "run_01", roundId: "round_01", finalSequence: 12 })).toBe(
      "run_01:round_01:12"
    );
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
