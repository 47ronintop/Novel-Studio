import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";
import type { LlmCost } from "@novel-studio/llm-adapter";

import type { AgentContextPrecision } from "./context-snapshot.js";

/**
 * A per-currency unit-price snapshot captured into a usage record. Stage 5A always writes `null`
 * (pricing is inert); Task 3.2 activates a pricing registry that fills this without changing the shape.
 */
export interface AgentUsageUnitPriceSnapshot {
  readonly inputPerMillion: number;
  readonly outputPerMillion: number;
  readonly cachedPerMillion?: number;
  readonly reasoningPerMillion?: number;
  readonly currency: string;
}

/**
 * The single, forward-compatible final usage record. Both normal model rounds and compaction write
 * this same shape so they never diverge. It carries only redacted token/budget facts — never prompt
 * text, file contents, paths, or credentials (the repository enforces that boundary on write).
 */
export interface AgentUsageRecord {
  readonly schemaVersion: "1.0";
  readonly usageId: string;
  readonly runId: string;
  readonly conversationId: string;
  readonly projectId: string;
  readonly roundId: string;
  readonly finalSequence: number;
  readonly provider: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedTokens?: number;
  readonly reasoningTokens?: number;
  readonly totalTokens: number;
  readonly usageStatus: "actual" | "estimated" | "missing";
  readonly precision: AgentContextPrecision;
  readonly pricingVersion: string | null;
  readonly unitPrices: AgentUsageUnitPriceSnapshot | null;
  readonly cost: LlmCost;
  readonly contextWindow: number;
  readonly safeInputBudget: number;
  readonly compactionBeforeTokens?: number;
  readonly compactionAfterTokens?: number;
  readonly terminationReason: string;
  readonly timestamp: string;
  readonly localDate: string;
  readonly timezone: string;
  readonly utcOffsetMinutes: number;
}

export interface AgentUsageSink {
  writeFinal(record: AgentUsageRecord): Promise<Result<AgentUsageRecord, UnifiedError>>;
}

/** The public command to compact a run's context. Draft/renderer never authors the budget facts. */
export interface CompactContextCommand {
  readonly projectId: string;
  readonly runId: string;
  readonly commandId: string;
  readonly expectedRunRevision: number;
  readonly contextBudgetSnapshotId: string;
  readonly trigger: "manual" | "automatic" | "recovery";
}

/** The idempotency key for a final usage record: one record per run round terminal sequence. */
export function usageRecordIdempotencyKey(input: {
  readonly runId: string;
  readonly roundId: string;
  readonly finalSequence: number;
}): string {
  return `${input.runId}:${input.roundId}:${input.finalSequence}`;
}

export function calculateAgentUsageEstimatedCost(input: {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedTokens?: number;
  readonly reasoningTokens?: number;
  readonly unitPrices: AgentUsageUnitPriceSnapshot;
}): number {
  return (
    (input.inputTokens * input.unitPrices.inputPerMillion +
      input.outputTokens * input.unitPrices.outputPerMillion +
      (input.cachedTokens ?? 0) * (input.unitPrices.cachedPerMillion ?? 0) +
      (input.reasoningTokens ?? 0) * (input.unitPrices.reasoningPerMillion ?? 0)) /
    1_000_000
  );
}

const USAGE_STATUS = new Set(["actual", "estimated", "missing"]);
const PRECISION = new Set<AgentContextPrecision>(["reported", "estimated", "unknown"]);
const COST_STATUS = new Set(["actual", "estimated", "unknown"]);
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
// The widest real UTC offset is +14:00; -12:00 is the western extreme. Clamp to ±15h for safety.
const MAX_OFFSET_MINUTES = 15 * 60;
const RECORD_FIELDS = new Set([
  "schemaVersion",
  "usageId",
  "runId",
  "conversationId",
  "projectId",
  "roundId",
  "finalSequence",
  "provider",
  "model",
  "inputTokens",
  "outputTokens",
  "cachedTokens",
  "reasoningTokens",
  "totalTokens",
  "usageStatus",
  "precision",
  "pricingVersion",
  "unitPrices",
  "cost",
  "contextWindow",
  "safeInputBudget",
  "compactionBeforeTokens",
  "compactionAfterTokens",
  "terminationReason",
  "timestamp",
  "localDate",
  "timezone",
  "utcOffsetMinutes"
]);
const COST_FIELDS = new Set(["amount", "currency", "status"]);
const UNIT_PRICE_FIELDS = new Set([
  "inputPerMillion",
  "outputPerMillion",
  "cachedPerMillion",
  "reasoningPerMillion",
  "currency"
]);

/**
 * Validate the numeric and enum invariants of a usage record: finite non-negative token/budget
 * counts, a total at least the sum of input + output, a well-formed local date, and a plausible UTC
 * offset. This is the shared gate both the write path and compaction call before persisting.
 */
export function validateAgentUsageRecord(
  record: AgentUsageRecord
): Result<AgentUsageRecord, UnifiedError> {
  if (!hasOnlyFields(record, RECORD_FIELDS)) return err(invalid(record, "record fields"));
  const required: readonly [string, number][] = [
    ["inputTokens", record.inputTokens],
    ["outputTokens", record.outputTokens],
    ["totalTokens", record.totalTokens],
    ["finalSequence", record.finalSequence],
    ["contextWindow", record.contextWindow],
    ["safeInputBudget", record.safeInputBudget]
  ];
  for (const [field, value] of required) {
    if (!isTokenCount(value)) return err(invalid(record, field));
  }
  const optional: readonly [string, number | undefined][] = [
    ["cachedTokens", record.cachedTokens],
    ["reasoningTokens", record.reasoningTokens],
    ["compactionBeforeTokens", record.compactionBeforeTokens],
    ["compactionAfterTokens", record.compactionAfterTokens]
  ];
  for (const [field, value] of optional) {
    if (value !== undefined && !isTokenCount(value)) return err(invalid(record, field));
  }
  if (record.totalTokens < record.inputTokens + record.outputTokens) {
    return err(invalid(record, "totalTokens"));
  }
  if (!Number.isFinite(record.cost.amount) || record.cost.amount < 0) {
    return err(invalid(record, "cost.amount"));
  }
  if (!USAGE_STATUS.has(record.usageStatus)) return err(invalid(record, "usageStatus"));
  if (!PRECISION.has(record.precision)) return err(invalid(record, "precision"));
  if (!COST_STATUS.has(record.cost.status)) return err(invalid(record, "cost.status"));
  if (!validateCost(record)) return err(invalid(record, "cost"));
  if (!LOCAL_DATE.test(record.localDate)) return err(invalid(record, "localDate"));
  if (
    !Number.isInteger(record.utcOffsetMinutes) ||
    Math.abs(record.utcOffsetMinutes) > MAX_OFFSET_MINUTES
  ) {
    return err(invalid(record, "utcOffsetMinutes"));
  }
  return ok(record);
}

function validateCost(record: AgentUsageRecord): boolean {
  if (!hasOnlyFields(record.cost, COST_FIELDS)) return false;
  if (record.cost.status === "unknown") {
    return (
      record.cost.amount === 0 &&
      record.cost.currency === "" &&
      record.pricingVersion === null &&
      record.unitPrices === null
    );
  }
  if (record.cost.status === "actual") {
    return (
      record.cost.currency.length > 0 &&
      record.pricingVersion === null &&
      record.unitPrices === null
    );
  }
  if (
    record.pricingVersion === null ||
    record.pricingVersion.length === 0 ||
    record.unitPrices === null ||
    record.cost.currency.length === 0
  ) {
    return false;
  }
  const prices = record.unitPrices;
  if (!hasOnlyFields(prices, UNIT_PRICE_FIELDS) || prices.currency !== record.cost.currency)
    return false;
  if (!isUnitPrice(prices.inputPerMillion) || !isUnitPrice(prices.outputPerMillion)) return false;
  if (prices.cachedPerMillion !== undefined && !isUnitPrice(prices.cachedPerMillion)) return false;
  if (prices.reasoningPerMillion !== undefined && !isUnitPrice(prices.reasoningPerMillion))
    return false;
  if (record.cachedTokens !== undefined && prices.cachedPerMillion === undefined) return false;
  if (record.reasoningTokens !== undefined && prices.reasoningPerMillion === undefined)
    return false;

  const expected = calculateAgentUsageEstimatedCost({
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    ...(record.cachedTokens === undefined ? {} : { cachedTokens: record.cachedTokens }),
    ...(record.reasoningTokens === undefined ? {} : { reasoningTokens: record.reasoningTokens }),
    unitPrices: prices
  });
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(expected), Math.abs(record.cost.amount));
  return Math.abs(record.cost.amount - expected) <= tolerance;
}

function isUnitPrice(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function hasOnlyFields(value: object, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((field) => allowed.has(field));
}

function isTokenCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function invalid(record: AgentUsageRecord, field: string): UnifiedError {
  return createUnifiedError({
    code: "AGENT_USAGE_RECORD_INVALID",
    category: "ValidationError",
    message: "The Agent usage record contains an invalid token, budget, or date field.",
    recoverability: "fatal",
    suggestedAction: "Record only finite, non-negative token counts and a valid local date.",
    traceId: "agent-usage-record",
    redactedDetail: { runId: record.runId, roundId: record.roundId, field }
  });
}
