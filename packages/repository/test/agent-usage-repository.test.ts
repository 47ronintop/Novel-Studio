import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import * as repositoryExports from "../src/index.js";

const roots: string[] = [];

// Mirrors @novel-studio/agent-engine's AgentUsageRecord. The repository is a sibling layer that does
// not import agent-engine, so tests describe the record shape structurally.
interface AgentUsageRecord {
  schemaVersion: "1.0";
  usageId: string;
  runId: string;
  conversationId: string;
  projectId: string;
  roundId: string;
  finalSequence: number;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  totalTokens: number;
  usageStatus: "actual" | "estimated" | "missing";
  precision: "reported" | "estimated" | "unknown";
  pricingVersion: string | null;
  unitPrices: null;
  cost: { amount: number; currency: string; status: "actual" | "estimated" | "unknown" };
  contextWindow: number;
  safeInputBudget: number;
  compactionBeforeTokens?: number;
  compactionAfterTokens?: number;
  terminationReason: string;
  timestamp: string;
  localDate: string;
  timezone: string;
  utcOffsetMinutes: number;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

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

type UsageRepository = {
  writeFinal(record: AgentUsageRecord): Promise<{ ok: boolean; value?: unknown; error?: { code: string } }>;
  readById(usageId: string): Promise<{ ok: boolean; value?: AgentUsageRecord | undefined }>;
};

async function createRepository(): Promise<UsageRepository> {
  const Repository = (repositoryExports as unknown as Record<string, unknown>)[
    "AgentUsageFileRepository"
  ];
  if (typeof Repository !== "function") throw new Error("AgentUsageFileRepository not exported");
  const userDataRoot = await mkdtemp(join(tmpdir(), "novel-studio-agent-usage-"));
  roots.push(userDataRoot);
  return new (Repository as new (options: { userDataRoot: string }) => UsageRepository)({
    userDataRoot
  });
}

describe("AgentUsageFileRepository", () => {
  test("writes a final record and reads it back by id", async () => {
    const repository = await createRepository();
    const written = await repository.writeFinal(baseRecord());
    expect(written.ok).toBe(true);
    const read = await repository.readById("usage_01");
    expect(read.ok).toBe(true);
    expect(read.value).toMatchObject({ usageId: "usage_01", totalTokens: 1200 });
  });

  test("readById returns undefined for a missing id", async () => {
    const repository = await createRepository();
    const read = await repository.readById("usage_missing");
    expect(read).toEqual({ ok: true, value: undefined });
  });

  test("is idempotent by runId:roundId:finalSequence and returns the first record", async () => {
    const repository = await createRepository();
    const first = await repository.writeFinal(baseRecord({ usageId: "usage_first" }));
    const replay = await repository.writeFinal(baseRecord({ usageId: "usage_second" }));
    expect(first.ok && replay.ok).toBe(true);
    // Same round key → the replay returns the first-written record, not a competing one.
    expect((replay.value as AgentUsageRecord).usageId).toBe("usage_first");
    const readSecond = await repository.readById("usage_second");
    expect(readSecond.value).toBeUndefined();
  });

  test("maintains a daily aggregate keyed by localDate and does not double-count replays", async () => {
    const repository = await createRepository();
    const userDataRoot = roots[roots.length - 1]!;
    await repository.writeFinal(baseRecord({ usageId: "u1", roundId: "r1", finalSequence: 1 }));
    await repository.writeFinal(baseRecord({ usageId: "u2", roundId: "r2", finalSequence: 2 }));
    // Replay of u1's round key must not add to the aggregate again.
    await repository.writeFinal(baseRecord({ usageId: "u1_replay", roundId: "r1", finalSequence: 1 }));
    const aggregate = JSON.parse(
      await readFile(join(userDataRoot, "agent-usage", "aggregates", "2026-07-16.json"), "utf8")
    ) as Record<string, unknown>;
    expect(aggregate["recordCount"]).toBe(2);
    expect(aggregate["totalTokens"]).toBe(2400);
    expect(aggregate["localDate"]).toBe("2026-07-16");
  });

  test("rejects an invalid record before writing", async () => {
    const repository = await createRepository();
    const result = await repository.writeFinal(baseRecord({ inputTokens: -1 }));
    expect(result).toMatchObject({ ok: false, error: { code: "AGENT_USAGE_RECORD_INVALID" } });
  });

  test("rejects a record carrying an absolute path", async () => {
    const repository = await createRepository();
    const result = await repository.writeFinal(baseRecord({ terminationReason: "/Users/tony/secret.md" }));
    expect(result).toMatchObject({ ok: false, error: { code: "AGENT_USAGE_RECORD_REDACTION_REQUIRED" } });
  });

  test("rejects a record carrying an authorization header", async () => {
    const repository = await createRepository();
    const result = await repository.writeFinal(
      baseRecord({ terminationReason: "Authorization: Bearer sk-abcdef" })
    );
    expect(result).toMatchObject({ ok: false, error: { code: "AGENT_USAGE_RECORD_REDACTION_REQUIRED" } });
  });
});
