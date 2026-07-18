import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  unitPrices: {
    inputPerMillion: number;
    outputPerMillion: number;
    cachedPerMillion?: number;
    reasoningPerMillion?: number;
    currency: string;
  } | null;
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
  const record: AgentUsageRecord = {
    schemaVersion: "1.0" as const,
    usageId: "",
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
  return {
    ...record,
    usageId:
      overrides.usageId ?? `${record.runId}:${record.roundId}:${String(record.finalSequence)}`
  };
}

type UsageRepository = {
  writeFinal(
    record: AgentUsageRecord
  ): Promise<{ ok: boolean; value?: unknown; error?: { code: string } }>;
  readById(usageId: string): Promise<{ ok: boolean; value?: AgentUsageRecord | undefined }>;
  queryDetails(query: {
    range: { fromLocalDate: string; toLocalDate: string };
    provider?: string;
    model?: string;
    projectId?: string;
    detailLocalDate?: string;
  }): Promise<{
    ok: boolean;
    value?: ReadonlyArray<
      Pick<
        AgentUsageRecord,
        | "usageId"
        | "runId"
        | "conversationId"
        | "projectId"
        | "provider"
        | "model"
        | "totalTokens"
        | "usageStatus"
        | "cost"
        | "timestamp"
      >
    >;
    error?: { code: string };
  }>;
  queryDailyAggregates(query: {
    range: { fromLocalDate: string; toLocalDate: string };
    provider?: string;
    model?: string;
    projectId?: string;
    detailLocalDate?: string;
  }): Promise<{
    ok: boolean;
    value?: ReadonlyArray<{
      localDate: string;
      inputTokens: number;
      outputTokens: number;
      cachedTokens: number;
      reasoningTokens: number;
      totalTokens: number;
      costs: ReadonlyArray<{ currency: string; actualAmount: number; estimatedAmount: number }>;
      hasUnknownCost: boolean;
    }>;
    error?: { code: string };
  }>;
  clearUsage(command: {
    commandId: string;
    range: { fromLocalDate: string; toLocalDate: string };
  }): Promise<{ ok: boolean; value?: void; error?: { code: string } }>;
  enforceRetention(
    referenceLocalDate: string
  ): Promise<{ ok: boolean; value?: void; error?: { code: string } }>;
};

async function createRepository(existingRoot?: string): Promise<UsageRepository> {
  const Repository = (repositoryExports as unknown as Record<string, unknown>)[
    "AgentUsageFileRepository"
  ];
  if (typeof Repository !== "function") throw new Error("AgentUsageFileRepository not exported");
  const userDataRoot = existingRoot ?? (await mkdtemp(join(tmpdir(), "novel-studio-agent-usage-")));
  if (existingRoot === undefined) roots.push(userDataRoot);
  return new (Repository as new (options: { userDataRoot: string }) => UsageRepository)({
    userDataRoot
  });
}

describe("AgentUsageFileRepository", () => {
  test("writes a final record and reads it back by id", async () => {
    const repository = await createRepository();
    const written = await repository.writeFinal(baseRecord());
    expect(written.ok).toBe(true);
    const read = await repository.readById("run_01:round_01:12");
    expect(read.ok).toBe(true);
    expect(read.value).toMatchObject({ usageId: "run_01:round_01:12", totalTokens: 1200 });
  });

  test("readById returns undefined for a missing id", async () => {
    const repository = await createRepository();
    const read = await repository.readById("run_missing:round_missing:1");
    expect(read).toEqual({ ok: true, value: undefined });
  });

  test("is first-wins across repository instances and does not lose concurrent daily totals", async () => {
    const firstRepository = await createRepository();
    const userDataRoot = roots[roots.length - 1]!;
    const secondRepository = await createRepository(userDataRoot);
    const firstRecord = baseRecord();
    const competingRecord = baseRecord({ outputTokens: 400, totalTokens: 1400 });
    const [first, replay] = await Promise.all([
      firstRepository.writeFinal(firstRecord),
      secondRepository.writeFinal(competingRecord)
    ]);
    expect(first.value).toEqual(firstRecord);
    expect(replay.value).toEqual(firstRecord);

    await Promise.all([
      firstRepository.writeFinal(baseRecord({ roundId: "round_02", finalSequence: 13 })),
      secondRepository.writeFinal(baseRecord({ roundId: "round_03", finalSequence: 14 }))
    ]);
    const aggregate = await firstRepository.queryDailyAggregates({
      range: { fromLocalDate: "2026-07-16", toLocalDate: "2026-07-16" }
    });
    expect(aggregate.value?.[0]).toMatchObject({ recordCount: 3, totalTokens: 3600 });
  });

  test("rejects a non-canonical usageId", async () => {
    const repository = await createRepository();
    const result = await repository.writeFinal(baseRecord({ usageId: "usage_same" }));
    expect(result).toMatchObject({ ok: false, error: { code: "AGENT_USAGE_RECORD_INVALID" } });
  });

  test("maintains a daily aggregate keyed by localDate and does not double-count replays", async () => {
    const repository = await createRepository();
    const userDataRoot = roots[roots.length - 1]!;
    await repository.writeFinal(baseRecord({ roundId: "r1", finalSequence: 1 }));
    await repository.writeFinal(baseRecord({ roundId: "r2", finalSequence: 2 }));
    // Replay of u1's round key must not add to the aggregate again.
    await repository.writeFinal(baseRecord({ roundId: "r1", finalSequence: 1 }));
    const aggregate = JSON.parse(
      await readFile(join(userDataRoot, "agent-usage", "aggregates", "2026-07-16.json"), "utf8")
    ) as Record<string, unknown>;
    expect(aggregate["recordCount"]).toBe(2);
    expect(aggregate["totalTokens"]).toBe(2400);
    expect(aggregate["localDate"]).toBe("2026-07-16");
  });

  test("aggregates optional tokens and keeps actual and estimated costs separate by currency", async () => {
    const repository = await createRepository();
    await repository.writeFinal(
      baseRecord({
        roundId: "usd_actual",
        finalSequence: 1,
        cachedTokens: 25,
        reasoningTokens: 10,
        cost: { amount: 1.5, currency: "USD", status: "actual" }
      })
    );
    await repository.writeFinal(
      baseRecord({
        roundId: "usd_estimated",
        finalSequence: 2,
        pricingVersion: "pricing-v1",
        unitPrices: {
          inputPerMillion: 50,
          outputPerMillion: 1000,
          currency: "USD"
        },
        cost: { amount: 0.25, currency: "USD", status: "estimated" }
      })
    );
    await repository.writeFinal(
      baseRecord({
        roundId: "eur_estimated",
        finalSequence: 3,
        pricingVersion: "pricing-v1",
        unitPrices: {
          inputPerMillion: 100,
          outputPerMillion: 2000,
          currency: "EUR"
        },
        cost: { amount: 0.5, currency: "EUR", status: "estimated" }
      })
    );
    await repository.writeFinal(
      baseRecord({
        roundId: "unknown",
        finalSequence: 4
      })
    );

    const result = await repository.queryDailyAggregates({
      range: { fromLocalDate: "2026-07-16", toLocalDate: "2026-07-16" }
    });
    expect(result.ok).toBe(true);
    expect(result.value).toEqual([
      expect.objectContaining({
        localDate: "2026-07-16",
        cachedTokens: 25,
        reasoningTokens: 10,
        costs: [
          { currency: "EUR", actualAmount: 0, estimatedAmount: 0.5 },
          { currency: "USD", actualAmount: 1.5, estimatedAmount: 0.25 }
        ],
        hasUnknownCost: true
      })
    ]);
  });

  test("queries bounded immutable details using stored local dates and stable filters", async () => {
    const repository = await createRepository();
    await repository.writeFinal(baseRecord({ roundId: "r_old", localDate: "2026-07-15" }));
    await repository.writeFinal(
      baseRecord({
        roundId: "r_match",
        projectId: "stable_project_id",
        provider: "provider_a",
        model: "model_a",
        localDate: "2026-07-16",
        timestamp: "2026-07-15T16:30:00.000Z"
      })
    );
    const result = await repository.queryDetails({
      range: { fromLocalDate: "2026-07-16", toLocalDate: "2026-07-16" },
      detailLocalDate: "2026-07-16",
      provider: "provider_a",
      model: "model_a",
      projectId: "stable_project_id"
    });
    expect(result.ok).toBe(true);
    expect(result.value?.map((record) => record.usageId)).toEqual(["run_01:r_match:12"]);

    const invalid = await repository.queryDetails({
      range: { fromLocalDate: "2026-01-01", toLocalDate: "2027-12-31" },
      detailLocalDate: "2026-01-01"
    });
    expect(invalid).toMatchObject({ ok: false, error: { code: "AGENT_USAGE_QUERY_INVALID" } });
  });

  test("counts the DST repeated hour once per distinct UTC timestamp and usage id", async () => {
    const repository = await createRepository();
    await repository.writeFinal(
      baseRecord({
        roundId: "dst_first",
        finalSequence: 1,
        localDate: "2026-11-01",
        timezone: "America/New_York",
        utcOffsetMinutes: -240,
        timestamp: "2026-11-01T05:30:00.000Z"
      })
    );
    await repository.writeFinal(
      baseRecord({
        roundId: "dst_second",
        finalSequence: 2,
        localDate: "2026-11-01",
        timezone: "America/New_York",
        utcOffsetMinutes: -300,
        timestamp: "2026-11-01T06:30:00.000Z"
      })
    );
    const result = await repository.queryDailyAggregates({
      range: { fromLocalDate: "2026-11-01", toLocalDate: "2026-11-01" }
    });
    expect(result.value?.[0]).toMatchObject({ recordCount: 2, totalTokens: 2400 });
  });

  test("retains details for 30 days and daily aggregates for 365 days without mutating survivors", async () => {
    const repository = await createRepository();
    const userDataRoot = roots[roots.length - 1]!;
    await repository.writeFinal(
      baseRecord({
        roundId: "detail_expired",
        localDate: "2026-06-17"
      })
    );
    await repository.writeFinal(
      baseRecord({
        roundId: "detail_survivor",
        localDate: "2026-06-18"
      })
    );
    await repository.writeFinal(
      baseRecord({
        roundId: "aggregate_expired",
        localDate: "2025-07-17"
      })
    );
    await repository.writeFinal(
      baseRecord({
        roundId: "aggregate_survivor",
        localDate: "2025-07-18"
      })
    );
    const survivorPath = join(
      userDataRoot,
      "agent-usage",
      "details",
      "run_01%3Adetail_survivor%3A12.json"
    );
    const before = await readFile(survivorPath, "utf8");

    const retention = await repository.enforceRetention("2026-07-17");
    expect(retention.ok).toBe(true);
    expect((await repository.readById("run_01:detail_expired:12")).value).toBeUndefined();
    expect((await repository.readById("run_01:detail_survivor:12")).value?.localDate).toBe(
      "2026-06-18"
    );
    expect(await readFile(survivorPath, "utf8")).toBe(before);
    const expiredAggregates = await repository.queryDailyAggregates({
      range: { fromLocalDate: "2025-07-17", toLocalDate: "2025-07-17" }
    });
    expect(expiredAggregates.value).toEqual([]);
    const survivingAggregates = await repository.queryDailyAggregates({
      range: { fromLocalDate: "2025-07-18", toLocalDate: "2025-07-18" }
    });
    expect(survivingAggregates.value?.map((bucket) => bucket.localDate)).toEqual(["2025-07-18"]);
  });

  test("uses a redacted receipt after detail retention without recreating or replacing detail", async () => {
    const repository = await createRepository();
    const userDataRoot = roots[roots.length - 1]!;
    const record = baseRecord({ roundId: "retained_replay", localDate: "2026-06-16" });
    await repository.writeFinal(record);
    await repository.enforceRetention("2026-07-17");
    expect((await repository.readById(record.usageId)).value).toBeUndefined();

    const replay = await repository.writeFinal(record);
    expect(replay.ok).toBe(true);
    expect((await repository.readById(record.usageId)).value).toBeUndefined();
    const conflict = await repository.writeFinal(
      baseRecord({
        roundId: "retained_replay",
        localDate: "2026-06-16",
        outputTokens: 300,
        totalTokens: 1300
      })
    );
    expect(conflict).toMatchObject({
      ok: false,
      error: { code: "AGENT_USAGE_RECORD_CONFLICT" }
    });
    expect((await repository.readById(record.usageId)).value).toBeUndefined();
    const aggregate = await repository.queryDailyAggregates({
      range: { fromLocalDate: "2026-06-16", toLocalDate: "2026-06-16" }
    });
    expect(aggregate.value?.[0]).toMatchObject({ recordCount: 1, totalTokens: 1200 });
    const receipt = JSON.parse(
      await readFile(
        join(userDataRoot, "agent-usage", "keys", "run_01__retained_replay__12.json"),
        "utf8"
      )
    ) as Record<string, unknown>;
    expect(Object.keys(receipt).sort()).toEqual(["contentChecksum", "localDate", "usageId"]);
    expect(receipt["contentChecksum"]).toMatch(/^[a-f0-9]{64}$/);
  });

  test("clearUsage prevents an expired detail replay from restoring its cleared aggregate", async () => {
    const repository = await createRepository();
    const userDataRoot = roots[roots.length - 1]!;
    const record = baseRecord({ roundId: "cleared_retained_replay", localDate: "2026-06-16" });
    await repository.writeFinal(record);
    await repository.enforceRetention("2026-07-17");
    expect((await repository.readById(record.usageId)).value).toBeUndefined();

    expect(
      (
        await repository.clearUsage({
          commandId: "clear_retained_replay",
          range: { fromLocalDate: record.localDate, toLocalDate: record.localDate }
        })
      ).ok
    ).toBe(true);
    await expect(
      readFile(
        join(userDataRoot, "agent-usage", "keys", "run_01__cleared_retained_replay__12.json"),
        "utf8"
      )
    ).rejects.toMatchObject({ code: "ENOENT" });

    expect((await repository.writeFinal(record)).ok).toBe(true);
    expect((await repository.writeFinal(record)).ok).toBe(true);
    const aggregate = await repository.queryDailyAggregates({
      range: { fromLocalDate: record.localDate, toLocalDate: record.localDate }
    });
    expect(aggregate.value).toEqual([]);
  });

  test("clearUsage still records a new round on a previously cleared local date", async () => {
    const repository = await createRepository();
    const cleared = baseRecord({ roundId: "cleared_round", localDate: "2026-07-16" });
    await repository.writeFinal(cleared);
    await repository.clearUsage({
      commandId: "clear_before_new_round",
      range: { fromLocalDate: cleared.localDate, toLocalDate: cleared.localDate }
    });

    const later = baseRecord({
      roundId: "later_round",
      finalSequence: 13,
      localDate: cleared.localDate
    });
    expect((await repository.writeFinal(later)).ok).toBe(true);
    expect((await repository.readById(later.usageId)).value).toEqual(later);
    expect(
      await repository.queryDailyAggregates({
        range: { fromLocalDate: cleared.localDate, toLocalDate: cleared.localDate }
      })
    ).toMatchObject({ ok: true, value: [{ recordCount: 1, totalTokens: 1200 }] });

    expect((await repository.writeFinal(cleared)).ok).toBe(true);
    expect((await repository.readById(cleared.usageId)).value).toBeUndefined();
    expect(
      await repository.queryDailyAggregates({
        range: { fromLocalDate: cleared.localDate, toLocalDate: cleared.localDate }
      })
    ).toMatchObject({ ok: true, value: [{ recordCount: 1, totalTokens: 1200 }] });
  });

  test.each(["details", "keys", "aggregates"] as const)(
    "repairs detail, key, and aggregate after the %s write stage is interrupted",
    async (blockedStage) => {
      const repository = await createRepository();
      const userDataRoot = roots[roots.length - 1]!;
      const usageRoot = join(userDataRoot, "agent-usage");
      await mkdir(usageRoot, { recursive: true });
      const blocker = join(usageRoot, blockedStage);
      await writeFile(blocker, "blocked", "utf8");
      const record = baseRecord({ roundId: `interrupted_${blockedStage}` });

      expect((await repository.writeFinal(record)).ok).toBe(false);
      await rm(blocker, { force: true });
      expect((await repository.writeFinal(record)).ok).toBe(true);
      expect((await repository.readById(record.usageId)).value).toEqual(record);
      const aggregate = await repository.queryDailyAggregates({
        range: { fromLocalDate: record.localDate, toLocalDate: record.localDate }
      });
      expect(aggregate.value?.[0]).toMatchObject({ recordCount: 1, totalTokens: 1200 });
    }
  );

  test("repairs a detail-only record before querying aggregates without replaying writeFinal", async () => {
    const repository = await createRepository();
    const userDataRoot = roots[roots.length - 1]!;
    const usageRoot = join(userDataRoot, "agent-usage");
    await mkdir(usageRoot, { recursive: true });
    const blocker = join(usageRoot, "keys");
    await writeFile(blocker, "blocked", "utf8");
    const record = baseRecord({ roundId: "query_repair" });

    expect((await repository.writeFinal(record)).ok).toBe(false);
    await rm(blocker, { force: true });

    const aggregate = await repository.queryDailyAggregates({
      range: { fromLocalDate: record.localDate, toLocalDate: record.localDate }
    });
    expect(aggregate.value?.[0]).toMatchObject({ recordCount: 1, totalTokens: 1200 });
    await expect(
      readFile(join(usageRoot, "keys", "run_01__query_repair__12.json"), "utf8")
    ).resolves.toContain(record.usageId);
    expect(
      (
        await repository.queryDailyAggregates({
          range: { fromLocalDate: record.localDate, toLocalDate: record.localDate }
        })
      ).value?.[0]
    ).toMatchObject({ recordCount: 1, totalTokens: 1200 });
  });

  test("repairs a detail-only record before retention deletes old details", async () => {
    const repository = await createRepository();
    const userDataRoot = roots[roots.length - 1]!;
    const usageRoot = join(userDataRoot, "agent-usage");
    await mkdir(usageRoot, { recursive: true });
    const blocker = join(usageRoot, "aggregates");
    await writeFile(blocker, "blocked", "utf8");
    const record = baseRecord({ roundId: "retention_repair", localDate: "2026-06-16" });

    expect((await repository.writeFinal(record)).ok).toBe(false);
    await rm(blocker, { force: true });

    expect((await repository.enforceRetention("2026-07-17")).ok).toBe(true);
    expect((await repository.readById(record.usageId)).value).toBeUndefined();
    await expect(
      readFile(join(usageRoot, "keys", "run_01__retention_repair__12.json"), "utf8")
    ).resolves.toContain(record.usageId);
    const aggregate = await repository.queryDailyAggregates({
      range: { fromLocalDate: record.localDate, toLocalDate: record.localDate }
    });
    expect(aggregate.value?.[0]).toMatchObject({ recordCount: 1, totalTokens: 1200 });
  });

  test("rejects a tampered detail before repair can write outside the usage root", async () => {
    const repository = await createRepository();
    const userDataRoot = roots[roots.length - 1]!;
    const detailsRoot = join(userDataRoot, "agent-usage", "details");
    const escapedKeyPath = join(userDataRoot, "..", "repair-key-escape__tampered_round__12.json");
    const escapedAggregatePath = join(userDataRoot, "..", "repair-aggregate-escape.json");
    const runId = "..\\..\\..\\repair-key-escape";
    const malformed = {
      ...baseRecord({ roundId: "tampered_round" }),
      runId,
      usageId: `${runId}:tampered_round:12`,
      localDate: "..\\..\\..\\repair-aggregate-escape"
    };
    await mkdir(detailsRoot, { recursive: true });
    await writeFile(join(detailsRoot, "tampered.json"), `${JSON.stringify(malformed)}\n`, "utf8");

    try {
      expect(
        await repository.queryDailyAggregates({
          range: { fromLocalDate: "2026-07-16", toLocalDate: "2026-07-16" }
        })
      ).toMatchObject({ ok: false, error: { code: "AGENT_USAGE_RECORD_INVALID" } });
      await expect(readFile(escapedKeyPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(escapedAggregatePath, "utf8")).rejects.toMatchObject({
        code: "ENOENT"
      });
    } finally {
      await Promise.all([
        rm(escapedKeyPath, { force: true }),
        rm(escapedAggregatePath, { force: true })
      ]);
    }
  });

  test("clearUsage deletes only usage artifacts inside the inclusive date range", async () => {
    const repository = await createRepository();
    const userDataRoot = roots[roots.length - 1]!;
    await repository.writeFinal(baseRecord({ roundId: "clear_me" }));
    await repository.writeFinal(
      baseRecord({
        roundId: "keep_me",
        localDate: "2026-07-15"
      })
    );
    const runSentinel = join(userDataRoot, "history", "agent-runs", "run_01", "run.json");
    await mkdir(join(userDataRoot, "history", "agent-runs", "run_01"), { recursive: true });
    await writeFile(runSentinel, "unchanged", "utf8");

    const cleared = await repository.clearUsage({
      commandId: "clear_01",
      range: { fromLocalDate: "2026-07-16", toLocalDate: "2026-07-16" }
    });
    expect(cleared.ok).toBe(true);
    expect((await repository.readById("run_01:clear_me:12")).value).toBeUndefined();
    expect((await repository.readById("run_01:keep_me:12")).value?.usageId).toBe(
      "run_01:keep_me:12"
    );
    expect(await readFile(runSentinel, "utf8")).toBe("unchanged");
  });

  test("resumes a pending clear before allowing new usage in its date range", async () => {
    const repository = await createRepository();
    const userDataRoot = roots[roots.length - 1]!;
    const localDate = "2026-07-16";
    const command = {
      commandId: "clear_pending",
      range: { fromLocalDate: localDate, toLocalDate: localDate }
    };
    const original = baseRecord({ roundId: "clear_pending_original", localDate });
    await repository.writeFinal(original);
    await mkdir(join(userDataRoot, "agent-usage", "clear-commands"), { recursive: true });
    await writeFile(
      join(userDataRoot, "agent-usage", "clear-commands", "clear_pending.json"),
      `${JSON.stringify({ status: "pending", commandId: command.commandId, ...command.range })}\n`,
      "utf8"
    );

    const later = baseRecord({
      roundId: "clear_pending_later",
      finalSequence: 13,
      localDate
    });
    expect(await repository.writeFinal(later)).toMatchObject({
      ok: false,
      error: { code: "AGENT_USAGE_CLEAR_PENDING" }
    });
    expect((await repository.readById(later.usageId)).value).toBeUndefined();

    expect((await repository.clearUsage(command)).ok).toBe(true);
    expect((await repository.readById(original.usageId)).value).toBeUndefined();
    expect(
      JSON.parse(
        await readFile(
          join(userDataRoot, "agent-usage", "clear-commands", "clear_pending.json"),
          "utf8"
        )
      )
    ).toMatchObject({ status: "completed" });

    expect((await repository.writeFinal(later)).ok).toBe(true);
    expect((await repository.clearUsage(command)).ok).toBe(true);
    expect((await repository.readById(later.usageId)).value).toEqual(later);
  });

  test("rejects commandId reuse with a different clear range", async () => {
    const repository = await createRepository();
    await repository.writeFinal(baseRecord({ roundId: "clear_second", localDate: "2026-07-15" }));
    expect(
      (
        await repository.clearUsage({
          commandId: "clear_conflict",
          range: { fromLocalDate: "2026-07-16", toLocalDate: "2026-07-16" }
        })
      ).ok
    ).toBe(true);
    const conflict = await repository.clearUsage({
      commandId: "clear_conflict",
      range: { fromLocalDate: "2026-07-15", toLocalDate: "2026-07-15" }
    });
    expect(conflict).toMatchObject({ ok: false, error: { code: "AGENT_USAGE_QUERY_INVALID" } });
    expect((await repository.readById("run_01:clear_second:12")).value).toBeDefined();
  });

  test("accepts at most 365 inclusive local dates", async () => {
    const repository = await createRepository();
    expect(
      (
        await repository.queryDailyAggregates({
          range: { fromLocalDate: "2025-07-18", toLocalDate: "2026-07-17" }
        })
      ).ok
    ).toBe(true);
    expect(
      await repository.queryDailyAggregates({
        range: { fromLocalDate: "2025-07-17", toLocalDate: "2026-07-17" }
      })
    ).toMatchObject({ ok: false, error: { code: "AGENT_USAGE_QUERY_INVALID" } });
  });

  test("rejects an invalid record before writing", async () => {
    const repository = await createRepository();
    const result = await repository.writeFinal(baseRecord({ inputTokens: -1 }));
    expect(result).toMatchObject({ ok: false, error: { code: "AGENT_USAGE_RECORD_INVALID" } });
  });

  test("rejects malformed record scalars and nested objects without writing details", async () => {
    const repository = await createRepository();
    const invalidRecords = [
      baseRecord({ roundId: "schema_version", schemaVersion: "2.0" as "1.0" }),
      baseRecord({
        roundId: "conversation_object",
        conversationId: { prompt: "private" } as unknown as string
      }),
      baseRecord({
        roundId: "project_object",
        projectId: { body: "private" } as unknown as string
      }),
      baseRecord({
        roundId: "provider_object",
        provider: { text: "private" } as unknown as string
      }),
      baseRecord({ roundId: "provider_prompt", provider: "please summarize this private prompt" }),
      baseRecord({ roundId: "model_control", model: "model\u0000name" }),
      baseRecord({
        roundId: "termination_object",
        terminationReason: { prompt: "private" } as unknown as string
      }),
      baseRecord({ roundId: "termination_unknown", terminationReason: "arbitrary prompt text" }),
      baseRecord({ roundId: "cost_array", cost: [] as unknown as AgentUsageRecord["cost"] }),
      baseRecord({
        roundId: "prices_array",
        pricingVersion: "pricing-v1",
        unitPrices: [] as unknown as AgentUsageRecord["unitPrices"],
        cost: { amount: 0, currency: "USD", status: "estimated" }
      })
    ];
    for (const record of invalidRecords) {
      const result = await repository.writeFinal(record);
      expect(result).toMatchObject({
        ok: false,
        error: { code: expect.stringMatching(/AGENT_USAGE_RECORD_(INVALID|REDACTION_REQUIRED)/) }
      });
      expect((await repository.readById(record.usageId)).value).toBeUndefined();
    }
  });

  test("rejects records that violate usage pricing, cost, or status contracts", async () => {
    const repository = await createRepository();
    const prices = {
      inputPerMillion: 1,
      outputPerMillion: 2,
      currency: "USD"
    };
    const invalidRecords: AgentUsageRecord[] = [
      baseRecord({
        cost: { amount: 0.0014, currency: "USD", status: "estimated" }
      }),
      baseRecord({
        pricingVersion: "pricing-v1",
        unitPrices: prices,
        cost: { amount: 9, currency: "USD", status: "estimated" }
      }),
      baseRecord({
        pricingVersion: "pricing-v1",
        unitPrices: { ...prices, currency: "EUR" },
        cost: { amount: 0.0014, currency: "USD", status: "estimated" }
      }),
      baseRecord({ cost: { amount: 1, currency: "USD", status: "unknown" } }),
      baseRecord({
        pricingVersion: "pricing-v1",
        unitPrices: prices,
        cost: { amount: 0, currency: "", status: "unknown" }
      }),
      baseRecord({ usageStatus: "partial" as AgentUsageRecord["usageStatus"] }),
      baseRecord({ precision: "exact" as AgentUsageRecord["precision"] }),
      baseRecord({
        cost: {
          amount: 0,
          currency: "USD",
          status: "projected" as AgentUsageRecord["cost"]["status"]
        }
      })
    ];
    for (const record of invalidRecords) {
      expect(await repository.writeFinal(record)).toMatchObject({
        ok: false,
        error: { code: "AGENT_USAGE_RECORD_INVALID" }
      });
    }
  });

  test("rejects a record carrying an absolute path", async () => {
    const repository = await createRepository();
    const result = await repository.writeFinal(
      baseRecord({ terminationReason: "/Users/tony/secret.md" })
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "AGENT_USAGE_RECORD_REDACTION_REQUIRED" }
    });
  });

  test("rejects a record carrying an authorization header", async () => {
    const repository = await createRepository();
    const result = await repository.writeFinal(
      baseRecord({ terminationReason: "Authorization: Bearer sk-abcdef" })
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "AGENT_USAGE_RECORD_REDACTION_REQUIRED" }
    });
  });

  test("rejects unexpected prompt, body, path, credential, and provider-frame fields", async () => {
    const repository = await createRepository();
    for (const leaked of [
      { prompt: "secret prompt" },
      { userRequest: "secret request" },
      { fileBody: "chapter contents" },
      { projectPath: "C:\\private\\novel" },
      { projectId: "C:\\private\\novel" },
      { apiKey: "sk-secret" },
      { providerFrame: { raw: "private" } }
    ]) {
      const result = await repository.writeFinal({
        ...baseRecord(),
        ...leaked
      } as AgentUsageRecord);
      expect(result).toMatchObject({
        ok: false,
        error: { code: "AGENT_USAGE_RECORD_REDACTION_REQUIRED" }
      });
    }
  });

  test("recursively rejects secrets and paths inside allowed nested fields", async () => {
    const repository = await createRepository();
    for (const record of [
      baseRecord({ timezone: "Authorization: Bearer sk-nested-secret" }),
      {
        ...baseRecord(),
        cost: { amount: 0, currency: "", status: "unknown", apiKey: "sk-nested-secret" }
      },
      {
        ...baseRecord(),
        unitPrices: {
          inputPerMillion: 1,
          outputPerMillion: 2,
          currency: "C:\\private\\pricing.json"
        }
      }
    ]) {
      expect(await repository.writeFinal(record as AgentUsageRecord)).toMatchObject({
        ok: false,
        error: { code: "AGENT_USAGE_RECORD_REDACTION_REQUIRED" }
      });
    }
  });

  test("requires a UTC ISO timestamp, IANA timezone, and plausible integer UTC offset", async () => {
    const repository = await createRepository();
    for (const record of [
      baseRecord({ timestamp: "2026-07-16 00:00:00" }),
      baseRecord({ timezone: "Not/A_Real_Zone" }),
      baseRecord({ utcOffsetMinutes: 901 }),
      baseRecord({ utcOffsetMinutes: 1.5 })
    ]) {
      expect(await repository.writeFinal(record)).toMatchObject({
        ok: false,
        error: { code: "AGENT_USAGE_RECORD_INVALID" }
      });
    }
  });
});
