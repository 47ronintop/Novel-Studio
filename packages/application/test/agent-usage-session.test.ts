import { describe, expect, test } from "vitest";

import {
  createAgentUsageSession,
  type AgentUsageRepositoryPort
} from "../src/agent-usage-session.js";
import { createDesktopApplication } from "../src/desktop-application.js";
import type {
  AgentUsageDailyBucket,
  AgentUsageMetricRecord,
  AgentUsageQuery,
  AgentUsageRunSummary,
  ClearAgentUsageCommand
} from "../src/agent-usage-types.js";

function daily(localDate = "2026-07-16"): AgentUsageDailyBucket {
  return {
    localDate,
    inputTokens: 100,
    outputTokens: 20,
    cachedTokens: 5,
    reasoningTokens: 3,
    totalTokens: 120,
    costs: [
      { currency: "USD", actualAmount: 0.01, estimatedAmount: 0.02 },
      { currency: "EUR", actualAmount: 0, estimatedAmount: 0.03 }
    ],
    hasUnknownCost: true
  };
}

function run(): AgentUsageRunSummary {
  return {
    scope: {
      kind: "workspace",
      workspaceKind: "creativeProject",
      workspaceId: "project_01"
    },
    usageId: "run_01:round_02:7",
    runId: "run_01",
    conversationId: "conversation_01",
    projectId: "project_01",
    provider: "openai",
    model: "gpt-5",
    totalTokens: 120,
    usageStatus: "actual",
    cost: { status: "actual", amount: 0.01, currency: "USD" },
    timestamp: "2026-07-16T08:00:00.000Z"
  };
}

function metricRecord(overrides: Partial<AgentUsageMetricRecord> = {}): AgentUsageMetricRecord {
  return {
    schemaVersion: "2.0",
    storageScope: "local_only",
    usageId: "usage_run_01",
    runId: "run_01",
    recordedAt: "2026-08-04T04:00:00.000Z",
    semanticVersionSetChecksum: "b".repeat(64),
    guidanceVersion: "3.0",
    contextProfileId: "engineering",
    messageOrderVersion: "2.0",
    toolCatalogVersion: "2.0",
    runOutcome: "blocked",
    pendingOutcome: "awaiting_approval",
    recoveryOutcome: "not_required",
    modelRoundCount: 1,
    toolCallCount: 2,
    toolFailureCount: 0,
    approvalWaitCount: 1,
    approvalWaitMs: 50,
    sources: [
      {
        sourceKind: "project_conventions",
        tokenCount: 80,
        truncated: false,
        exclusionReason: "none"
      }
    ],
    cacheOutcome: "miss",
    cacheVerifiedInputTokens: 0,
    changeSetOutcome: "generated",
    styleObservations: [],
    eventRefs: ["event_blocked_01"],
    ...overrides
  };
}

function createRepository(): AgentUsageRepositoryPort & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async writeRunMetrics(record: AgentUsageMetricRecord) {
      calls.push(`metrics:${record.usageId}`);
      return { ok: true as const, value: record };
    },
    async readRunMetrics(usageId: string) {
      calls.push(`metric:${usageId}`);
      return { ok: true as const, value: metricRecord({ usageId }) };
    },
    async queryDailyAggregates(query: AgentUsageQuery) {
      calls.push(`days:${query.range.fromLocalDate}:${query.range.toLocalDate}`);
      return { ok: true as const, value: [daily()] };
    },
    async queryDetails(query: AgentUsageQuery) {
      calls.push(`runs:${query.detailLocalDate}`);
      return { ok: true as const, value: [run()] };
    },
    async clearUsage(command: ClearAgentUsageCommand) {
      calls.push(`clear:${command.commandId}`);
      return { ok: true as const, value: undefined };
    },
    async enforceRetention(referenceLocalDate: string) {
      calls.push(`retain:${referenceLocalDate}`);
      return { ok: true as const, value: undefined };
    }
  };
}

function createSession(repository = createRepository()) {
  return {
    repository,
    session: createAgentUsageSession({
      repository,
      now: () => "2026-07-17T12:00:00.000Z",
      todayLocalDate: () => "2026-07-17"
    })
  };
}

describe("AgentUsageSession", () => {
  test("records strict local-only run metrics", async () => {
    const { repository, session } = createSession();
    const record = metricRecord();

    expect(await session.recordAgentUsage(record)).toEqual({ ok: true, value: record });
    expect(repository.calls).toEqual(["metrics:usage_run_01"]);
  });

  test("reads a local metric by opaque usage ref for the Inspector", async () => {
    const { repository, session } = createSession();

    expect(await session.getAgentUsage("usage_run_01")).toMatchObject({
      ok: true,
      value: { usageId: "usage_run_01", eventRefs: ["event_blocked_01"] }
    });
    expect(repository.calls).toEqual(["metric:usage_run_01"]);
    expect(await session.getAgentUsage("C:\\Users\\alice\\usage")).toMatchObject({
      ok: false,
      error: { code: "AGENT_USAGE_QUERY_INVALID" }
    });
  });

  test("fails closed when a repository returns a content-bearing metric", async () => {
    const repository = createRepository();
    repository.readRunMetrics = async () => ({
      ok: true as const,
      value: { ...metricRecord(), providerResponse: "private response" } as AgentUsageMetricRecord
    });
    const { session } = createSession(repository);

    expect(await session.getAgentUsage("usage_run_01")).toMatchObject({
      ok: false,
      error: { code: "AGENT_USAGE_RECORD_V20_INVALID" }
    });
  });

  test.each([
    ["body", { requestBody: "private chapter text" }],
    ["secret", { eventRefs: ["sk-privateCredential"] }],
    ["path", { eventRefs: ["C:\\Users\\alice\\novel.md"] }],
    ["unknown enum", { pendingOutcome: "waiting" }],
    ["unknown version", { schemaVersion: "2.1" }]
  ])("rejects metrics containing %s before repository access", async (_label, override) => {
    const { repository, session } = createSession();
    const result = await session.recordAgentUsage({
      ...metricRecord(),
      ...override
    } as AgentUsageMetricRecord);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "AGENT_USAGE_RECORD_V20_INVALID" }
    });
    expect(repository.calls).toEqual([]);
  });

  test("validates and returns a typed bounded report with detail runs for the selected day", async () => {
    const { repository, session } = createSession();
    const query: AgentUsageQuery = {
      range: { fromLocalDate: "2026-07-01", toLocalDate: "2026-07-17" },
      provider: "openai",
      model: "gpt-5",
      projectId: "project_01",
      detailLocalDate: "2026-07-16"
    };

    const result = await session.listAgentUsage(query);

    expect(result).toEqual({
      ok: true,
      value: {
        query,
        days: [daily()],
        runs: [run()],
        generatedAt: "2026-07-17T12:00:00.000Z"
      }
    });
    expect(repository.calls).toEqual([
      "retain:2026-07-17",
      "days:2026-07-01:2026-07-17",
      "runs:2026-07-16"
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /request|prompt|document|body|path|frame|reasoningText|hiddenReasoning/i
    );
  });

  test("does not query or return run details without detailLocalDate", async () => {
    const { repository, session } = createSession();
    const result = await session.listAgentUsage({
      range: { fromLocalDate: "2026-07-01", toLocalDate: "2026-07-17" }
    });

    expect(result).toMatchObject({ ok: true, value: { runs: [] } });
    expect(repository.calls).toEqual(["retain:2026-07-17", "days:2026-07-01:2026-07-17"]);
  });

  test("derives token share and token-weighted telemetry coverage from daily counters", async () => {
    const { repository, session } = createSession();
    repository.queryDailyAggregates = async () => ({
      ok: true as const,
      value: [
        {
          ...daily("2026-07-16"),
          cacheShareReadTokens: 400,
          cacheTelemetryComparableInputTokens: 1000,
          cacheComparableInputTokens: 1500
        },
        {
          ...daily("2026-07-17"),
          cacheShareReadTokens: 0,
          cacheTelemetryComparableInputTokens: 0,
          cacheComparableInputTokens: 500
        }
      ]
    });

    const result = await session.listAgentUsage({
      range: { fromLocalDate: "2026-07-16", toLocalDate: "2026-07-17" }
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        cacheTokenShare: 0.4,
        cacheTelemetryCoverage: 0.5
      }
    });
  });

  test("keeps a 95 percent observed share partial when another round has no telemetry", async () => {
    const { repository, session } = createSession();
    repository.queryDailyAggregates = async () => ({
      ok: true as const,
      value: [
        {
          ...daily(),
          cacheShareReadTokens: 19_000,
          cacheTelemetryComparableInputTokens: 20_000,
          cacheComparableInputTokens: 21_000
        }
      ]
    });

    const result = await session.listAgentUsage({
      range: { fromLocalDate: "2026-07-16", toLocalDate: "2026-07-16" }
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        cacheTokenShare: 0.95,
        cacheTelemetryCoverage: 20 / 21
      }
    });
  });

  test("reports a complete zero percent when actual telemetry reports no cache reads", async () => {
    const { repository, session } = createSession();
    repository.queryDailyAggregates = async () => ({
      ok: true as const,
      value: [
        {
          ...daily(),
          cacheShareReadTokens: 0,
          cacheTelemetryComparableInputTokens: 1_000,
          cacheComparableInputTokens: 1_000
        }
      ]
    });

    const result = await session.listAgentUsage({
      range: { fromLocalDate: "2026-07-16", toLocalDate: "2026-07-16" }
    });

    expect(result).toMatchObject({
      ok: true,
      value: { cacheTokenShare: 0, cacheTelemetryCoverage: 1 }
    });
  });

  test("rejects undeclared fields so sensitive content and project paths cannot cross the boundary", async () => {
    const { repository, session } = createSession();
    expect(
      await session.listAgentUsage({
        range: { fromLocalDate: "2026-07-01", toLocalDate: "2026-07-17" },
        prompt: "private chapter text"
      } as unknown as AgentUsageQuery)
    ).toMatchObject({ ok: false, error: { code: "AGENT_USAGE_QUERY_INVALID" } });
    expect(
      await session.clearAgentUsage({
        commandId: "clear_usage_01",
        range: { fromLocalDate: "2026-07-01", toLocalDate: "2026-07-17" },
        projectPath: "C:\\private\\novel"
      } as unknown as ClearAgentUsageCommand)
    ).toMatchObject({ ok: false, error: { code: "AGENT_USAGE_CLEAR_INVALID" } });
    expect(repository.calls).toEqual([]);
  });

  test.each([
    ["missing range", {}],
    ["null input", null],
    ["nonexistent date", { range: { fromLocalDate: "2026-02-30", toLocalDate: "2026-03-01" } }],
    ["reversed range", { range: { fromLocalDate: "2026-07-17", toLocalDate: "2026-07-01" } }],
    [
      "more than 365 inclusive days",
      { range: { fromLocalDate: "2025-07-17", toLocalDate: "2026-07-17" } }
    ],
    [
      "detail outside range",
      {
        range: { fromLocalDate: "2026-07-01", toLocalDate: "2026-07-17" },
        detailLocalDate: "2026-07-18"
      }
    ],
    [
      "blank provider",
      {
        range: { fromLocalDate: "2026-07-01", toLocalDate: "2026-07-17" },
        provider: "  "
      }
    ],
    [
      "path-like model",
      {
        range: { fromLocalDate: "2026-07-01", toLocalDate: "2026-07-17" },
        model: "C:\\private\\model"
      }
    ],
    [
      "unsafe project id",
      {
        range: { fromLocalDate: "2026-07-01", toLocalDate: "2026-07-17" },
        projectId: "../project"
      }
    ]
  ])("rejects %s before repository access", async (_label, query) => {
    const { repository, session } = createSession();
    const result = await session.listAgentUsage(query as AgentUsageQuery);

    expect(result).toMatchObject({ ok: false, error: { code: "AGENT_USAGE_QUERY_INVALID" } });
    expect(repository.calls).toEqual([]);
  });

  test("returns the authoritative report for the cleared range", async () => {
    const { repository, session } = createSession();
    const command: ClearAgentUsageCommand = {
      commandId: "clear_usage_01",
      range: { fromLocalDate: "2026-07-01", toLocalDate: "2026-07-17" }
    };

    expect(await session.clearAgentUsage(command)).toEqual({
      ok: true,
      value: {
        query: { range: command.range },
        days: [daily()],
        runs: [],
        generatedAt: "2026-07-17T12:00:00.000Z"
      }
    });
    expect(repository.calls).toEqual([
      "retain:2026-07-17",
      "clear:clear_usage_01",
      "retain:2026-07-17",
      "days:2026-07-01:2026-07-17"
    ]);
  });

  test("keeps clear callable when detached from the session object", async () => {
    const { session } = createSession();
    const { clearAgentUsage } = session;

    await expect(
      clearAgentUsage({
        commandId: "clear_usage_detached",
        range: { fromLocalDate: "2026-07-01", toLocalDate: "2026-07-17" }
      })
    ).resolves.toMatchObject({ ok: true, value: { runs: [], query: { range: {} } } });
  });

  test("exposes list and clear through the desktop application facade", async () => {
    const { session } = createSession();
    const application = createDesktopApplication({ agentUsageSession: session });
    const range = { fromLocalDate: "2026-07-01", toLocalDate: "2026-07-17" };

    await expect(application.listAgentUsage({ range })).resolves.toMatchObject({ ok: true });
    await expect(
      application.clearAgentUsage({ commandId: "clear_usage_facade", range })
    ).resolves.toMatchObject({ ok: true, value: { query: { range } } });
  });

  test.each(["", "../clear", "clear usage", "x".repeat(129)])(
    "rejects unsafe clear commandId %j before repository access",
    async (commandId) => {
      const { repository, session } = createSession();
      const result = await session.clearAgentUsage({
        commandId,
        range: { fromLocalDate: "2026-07-01", toLocalDate: "2026-07-17" }
      });
      expect(result).toMatchObject({ ok: false, error: { code: "AGENT_USAGE_CLEAR_INVALID" } });
      expect(repository.calls).toEqual([]);
    }
  );

  test("stops on retention or query repository failures", async () => {
    const repository = createRepository();
    repository.enforceRetention = async () => ({
      ok: false as const,
      error: { code: "RETENTION_FAILED" } as never
    });
    const session = createAgentUsageSession({ repository, todayLocalDate: () => "2026-07-17" });

    expect(
      await session.listAgentUsage({
        range: { fromLocalDate: "2026-07-01", toLocalDate: "2026-07-17" }
      })
    ).toMatchObject({ ok: false, error: { code: "RETENTION_FAILED" } });
    expect(repository.calls).toEqual([]);
  });
});
