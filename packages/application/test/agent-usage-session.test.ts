import { describe, expect, test } from "vitest";

import {
  createAgentUsageSession,
  type AgentUsageRepositoryPort
} from "../src/agent-usage-session.js";
import { createDesktopApplication } from "../src/desktop-application.js";
import type {
  AgentUsageDailyBucket,
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

function createRepository(): AgentUsageRepositoryPort & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
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
