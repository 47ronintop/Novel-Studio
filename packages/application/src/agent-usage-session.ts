import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import type {
  AgentUsageDailyBucket,
  AgentUsageQuery,
  AgentUsageReport,
  AgentUsageRunSummary,
  ClearAgentUsageCommand
} from "./agent-usage-types.js";

export interface AgentUsageRepositoryPort {
  queryDailyAggregates(
    query: AgentUsageQuery
  ): Promise<Result<readonly AgentUsageDailyBucket[], UnifiedError>>;
  queryDetails(
    query: AgentUsageQuery
  ): Promise<Result<readonly AgentUsageRunSummary[], UnifiedError>>;
  clearUsage(command: ClearAgentUsageCommand): Promise<Result<void, UnifiedError>>;
  enforceRetention(referenceLocalDate: string): Promise<Result<void, UnifiedError>>;
}

export interface AgentUsageSession {
  listAgentUsage(query: AgentUsageQuery): Promise<Result<AgentUsageReport, UnifiedError>>;
  clearAgentUsage(command: ClearAgentUsageCommand): Promise<Result<AgentUsageReport, UnifiedError>>;
}

export interface CreateAgentUsageSessionOptions {
  readonly repository: AgentUsageRepositoryPort;
  readonly now?: () => string;
  readonly todayLocalDate?: () => string;
}

export function createAgentUsageSession(
  options: CreateAgentUsageSessionOptions
): AgentUsageSession {
  const now = options.now ?? (() => new Date().toISOString());
  const todayLocalDate = options.todayLocalDate ?? localDateToday;

  async function enforceRetention(): Promise<Result<void, UnifiedError>> {
    return options.repository.enforceRetention(todayLocalDate());
  }

  const listAgentUsage: AgentUsageSession["listAgentUsage"] = async (query) => {
    if (!isValidQuery(query)) return err(usageError("AGENT_USAGE_QUERY_INVALID"));
    const retained = await enforceRetention();
    if (!retained.ok) return err(retained.error);
    const days = await options.repository.queryDailyAggregates(query);
    if (!days.ok) return err(days.error);
    let runs: readonly AgentUsageRunSummary[] = [];
    if (query.detailLocalDate !== undefined) {
      const details = await options.repository.queryDetails(query);
      if (!details.ok) return err(details.error);
      runs = details.value;
    }
    return ok({ query, days: days.value, runs, generatedAt: now() });
  };

  return {
    listAgentUsage,

    async clearAgentUsage(command) {
      if (
        !hasOnlyKeys(command, ["commandId", "range"]) ||
        !isSafeId(command.commandId) ||
        !isValidRange(command.range)
      ) {
        return err(usageError("AGENT_USAGE_CLEAR_INVALID"));
      }
      const retained = await enforceRetention();
      if (!retained.ok) return err(retained.error);
      const cleared = await options.repository.clearUsage(command);
      if (!cleared.ok) return err(cleared.error);
      return listAgentUsage({ range: command.range });
    }
  };
}

function isValidQuery(query: unknown): query is AgentUsageQuery {
  if (!hasOnlyKeys(query, ["range", "provider", "model", "projectId", "detailLocalDate"])) {
    return false;
  }
  const candidate = query as unknown as AgentUsageQuery;
  if (!isValidRange(candidate.range)) return false;
  if (candidate.provider !== undefined && !isSafeFilter(candidate.provider)) return false;
  if (candidate.model !== undefined && !isSafeFilter(candidate.model)) return false;
  if (candidate.projectId !== undefined && !isSafeId(candidate.projectId)) return false;
  return (
    candidate.detailLocalDate === undefined ||
    (isIsoLocalDate(candidate.detailLocalDate) &&
      candidate.detailLocalDate >= candidate.range.fromLocalDate &&
      candidate.detailLocalDate <= candidate.range.toLocalDate)
  );
}

function isValidRange(range: unknown): range is AgentUsageQuery["range"] {
  if (!hasOnlyKeys(range, ["fromLocalDate", "toLocalDate"])) return false;
  const candidate = range as unknown as AgentUsageQuery["range"];
  if (!isIsoLocalDate(candidate.fromLocalDate) || !isIsoLocalDate(candidate.toLocalDate))
    return false;
  const from = Date.parse(`${candidate.fromLocalDate}T00:00:00.000Z`);
  const to = Date.parse(`${candidate.toLocalDate}T00:00:00.000Z`);
  return from <= to && Math.floor((to - from) / 86_400_000) + 1 <= 365;
}

function hasOnlyKeys(value: unknown, allowed: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isIsoLocalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isSafeId(value: unknown): value is string {
  return (
    typeof value === "string" && value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)
  );
}

function isSafeFilter(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 128 &&
    value.trim() === value &&
    value.length > 0 &&
    !/[\u0000-\u001f\\]/.test(value) &&
    !/^[A-Za-z]:/.test(value) &&
    !value.startsWith("/") &&
    !value.includes("..")
  );
}

function localDateToday(): string {
  const current = new Date();
  const year = current.getFullYear().toString().padStart(4, "0");
  const month = (current.getMonth() + 1).toString().padStart(2, "0");
  const day = current.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function usageError(code: string): UnifiedError {
  return createUnifiedError({
    code,
    category: "ValidationError",
    message: "The Agent usage request is invalid.",
    recoverability: "user-action",
    suggestedAction: "Use a valid bounded local-date range and safe usage filters.",
    traceId: "agent-usage-session"
  });
}
