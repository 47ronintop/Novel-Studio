import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import type {
  AgentUsageDailyBucket,
  AgentUsageQuery,
  AgentUsageReport,
  AgentUsageMetricRecord,
  AgentUsageRunSummary,
  ClearAgentUsageCommand
} from "./agent-usage-types.js";

export interface AgentUsageRepositoryPort {
  writeRunMetrics(
    record: AgentUsageMetricRecord
  ): Promise<Result<AgentUsageMetricRecord, UnifiedError>>;
  readRunMetrics(
    usageId: string
  ): Promise<Result<AgentUsageMetricRecord | undefined, UnifiedError>>;
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
  recordAgentUsage(
    record: AgentUsageMetricRecord
  ): Promise<Result<AgentUsageMetricRecord, UnifiedError>>;
  getAgentUsage(usageId: string): Promise<Result<AgentUsageMetricRecord | undefined, UnifiedError>>;
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
    const telemetry = reportCacheTelemetry(days.value);
    return ok({
      query,
      days: days.value,
      runs,
      ...(telemetry.cacheTokenShare === undefined
        ? {}
        : { cacheTokenShare: telemetry.cacheTokenShare }),
      ...(telemetry.cacheTelemetryCoverage === undefined
        ? {}
        : { cacheTelemetryCoverage: telemetry.cacheTelemetryCoverage }),
      generatedAt: now()
    });
  };

  return {
    async recordAgentUsage(record) {
      if (!isValidMetricRecord(record)) {
        return err(usageError("AGENT_USAGE_RECORD_V20_INVALID"));
      }
      const written = await options.repository.writeRunMetrics(record);
      if (!written.ok) return written;
      return isValidMetricRecord(written.value)
        ? written
        : err(usageError("AGENT_USAGE_RECORD_V20_INVALID"));
    },

    async getAgentUsage(usageId) {
      if (!isSafeMetricRef(usageId)) {
        return err(usageError("AGENT_USAGE_QUERY_INVALID"));
      }
      const stored = await options.repository.readRunMetrics(usageId);
      if (!stored.ok || stored.value === undefined) return stored;
      return isValidMetricRecord(stored.value)
        ? stored
        : err(usageError("AGENT_USAGE_RECORD_V20_INVALID"));
    },

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

function reportCacheTelemetry(days: readonly AgentUsageDailyBucket[]): {
  readonly cacheTokenShare?: number;
  readonly cacheTelemetryCoverage?: number;
} {
  let shareReadTokens = 0;
  let telemetryComparableInputTokens = 0;
  let comparableInputTokens = 0;
  for (const day of days) {
    shareReadTokens += day.cacheShareReadTokens ?? 0;
    telemetryComparableInputTokens += day.cacheTelemetryComparableInputTokens ?? 0;
    comparableInputTokens += day.cacheComparableInputTokens ?? 0;
  }
  // A report is intentionally silent when no actual telemetry is available. When only part of
  // the comparable input is backed by actual telemetry, retain both the observed ratio and the
  // token-weighted coverage so callers can distinguish partial from complete observations.
  if (telemetryComparableInputTokens <= 0) return {};
  return {
    cacheTokenShare: shareReadTokens / telemetryComparableInputTokens,
    ...(comparableInputTokens > 0
      ? { cacheTelemetryCoverage: telemetryComparableInputTokens / comparableInputTokens }
      : {})
  };
}

const METRIC_FIELDS = [
  "schemaVersion",
  "storageScope",
  "usageId",
  "runId",
  "recordedAt",
  "semanticVersionSetChecksum",
  "guidanceVersion",
  "contextProfileId",
  "messageOrderVersion",
  "toolCatalogVersion",
  "runOutcome",
  "pendingOutcome",
  "recoveryOutcome",
  "modelRoundCount",
  "toolCallCount",
  "toolFailureCount",
  "approvalWaitCount",
  "approvalWaitMs",
  "sources",
  "cacheOutcome",
  "cacheVerifiedInputTokens",
  "changeSetOutcome",
  "styleObservations",
  "eventRefs"
] as const;

function isValidMetricRecord(value: unknown): value is AgentUsageMetricRecord {
  if (!hasOnlyKeys(value, METRIC_FIELDS)) return false;
  const record = value as unknown as AgentUsageMetricRecord;
  if (
    record.schemaVersion !== "2.0" ||
    record.storageScope !== "local_only" ||
    !isSafeMetricRef(record.usageId) ||
    !isSafeMetricRef(record.runId) ||
    !isUtcIsoTimestamp(record.recordedAt) ||
    !/^[a-f0-9]{64}$/u.test(record.semanticVersionSetChecksum) ||
    record.guidanceVersion !== "3.0" ||
    !["standalone", "writing", "creative_general", "engineering"].includes(
      record.contextProfileId
    ) ||
    record.messageOrderVersion !== "2.0" ||
    record.toolCatalogVersion !== "2.0" ||
    ![
      "completed",
      "blocked",
      "cancelled",
      "failed",
      "limit_reached",
      "awaiting_approval",
      "awaiting_input",
      "stale",
      "capability_changed"
    ].includes(record.runOutcome) ||
    ![
      "none",
      "awaiting_approval",
      "awaiting_input",
      "change_set_pending",
      "recovery_pending"
    ].includes(record.pendingOutcome) ||
    !["not_required", "pending", "recovered", "rolled_back", "failed", "outcome_unknown"].includes(
      record.recoveryOutcome
    ) ||
    !isMetricCount(record.modelRoundCount) ||
    !isMetricCount(record.toolCallCount) ||
    !isMetricCount(record.toolFailureCount) ||
    record.toolFailureCount > record.toolCallCount ||
    !isMetricCount(record.approvalWaitCount) ||
    !isMetricCount(record.approvalWaitMs) ||
    !Array.isArray(record.sources) ||
    record.sources.length > 256 ||
    !["hit", "miss", "bypass", "unknown"].includes(record.cacheOutcome) ||
    (record.cacheVerifiedInputTokens !== null && !isMetricCount(record.cacheVerifiedInputTokens)) ||
    ((record.cacheOutcome === "bypass" || record.cacheOutcome === "unknown") &&
      record.cacheVerifiedInputTokens !== null) ||
    ![
      "none",
      "generated",
      "approved",
      "rejected",
      "applied",
      "rolled_back",
      "undone",
      "stale"
    ].includes(record.changeSetOutcome) ||
    !Array.isArray(record.styleObservations) ||
    record.styleObservations.length > 256 ||
    !Array.isArray(record.eventRefs) ||
    record.eventRefs.length > 1024 ||
    !record.eventRefs.every(isSafeMetricRef) ||
    new Set(record.eventRefs).size !== record.eventRefs.length
  ) {
    return false;
  }
  return (
    record.sources.every(isValidSourceMetric) && record.styleObservations.every(isValidStyleMetric)
  );
}

function isValidSourceMetric(source: AgentUsageMetricRecord["sources"][number]): boolean {
  if (!hasOnlyKeys(source, ["sourceKind", "tokenCount", "truncated", "exclusionReason"])) {
    return false;
  }
  return (
    [
      "disk_file",
      "editor_buffer",
      "story_bible_asset",
      "project_conventions",
      "workspace_outline",
      "compaction_summary",
      "system_guidance",
      "conversation",
      "tool_result",
      "user_request"
    ].includes(source.sourceKind) &&
    isMetricCount(source.tokenCount) &&
    typeof source.truncated === "boolean" &&
    ["none", "user_excluded", "budget", "policy", "stale", "unsupported"].includes(
      source.exclusionReason
    ) &&
    (source.exclusionReason === "none" || (source.tokenCount === 0 && source.truncated === false))
  );
}

function isValidStyleMetric(
  observation: AgentUsageMetricRecord["styleObservations"][number]
): boolean {
  if (!hasOnlyKeys(observation, ["rule", "version", "confidence", "userOutcome"])) {
    return false;
  }
  return (
    isSafeMetricRef(observation.rule) &&
    /^[A-Za-z0-9][A-Za-z0-9._@-]{0,127}$/u.test(observation.version) &&
    Number.isFinite(observation.confidence) &&
    observation.confidence >= 0 &&
    observation.confidence <= 1 &&
    ["accepted", "ignored", "dismissed", "no_action"].includes(observation.userOutcome)
  );
}

function isMetricCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isSafeMetricRef(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,255}$/u.test(value) &&
    !/^sk-[A-Za-z0-9]/iu.test(value) &&
    !/^bearer[._:@-]/iu.test(value)
  );
}

function isUtcIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isValidQuery(query: unknown): query is AgentUsageQuery {
  if (
    !hasOnlyKeys(query, [
      "range",
      "provider",
      "model",
      "projectId",
      "detailLocalDate",
      "includeModelBreakdown"
    ])
  ) {
    return false;
  }
  const candidate = query as unknown as AgentUsageQuery;
  if (!isValidRange(candidate.range)) return false;
  if (candidate.provider !== undefined && !isSafeFilter(candidate.provider)) return false;
  if (candidate.model !== undefined && !isSafeFilter(candidate.model)) return false;
  if (candidate.projectId !== undefined && !isSafeId(candidate.projectId)) return false;
  if (
    candidate.includeModelBreakdown !== undefined &&
    typeof candidate.includeModelBreakdown !== "boolean"
  ) {
    return false;
  }
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
    !hasDisallowedFilterCharacter(value) &&
    !/^[A-Za-z]:/.test(value) &&
    !value.startsWith("/") &&
    !value.includes("..")
  );
}

function hasDisallowedFilterCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x5c);
  });
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
