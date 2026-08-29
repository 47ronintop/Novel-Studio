import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";
import type {
  LlmCacheInputTokenSemantics,
  LlmCacheOutcome,
  LlmCacheUsageStatus,
  LlmCost,
  LlmPromptCacheBypassReason,
  LlmPromptCacheMode
} from "@novel-studio/llm-adapter";

import {
  isAgentContextScope,
  normalizeAgentContextScope,
  type AgentContextProfileId,
  type AgentContextScope
} from "./agent-context-scope.js";
import type { AgentContextPrecision } from "./context-snapshot.js";

export const AGENT_USAGE_RECORD_V20_SCHEMA_VERSION = "2.0" as const;

export type AgentUsageRunOutcomeV20 =
  | "completed"
  | "blocked"
  | "cancelled"
  | "failed"
  | "limit_reached"
  | "awaiting_approval"
  | "awaiting_input"
  | "stale"
  | "capability_changed";

export type AgentUsagePendingOutcomeV20 =
  "none" | "awaiting_approval" | "awaiting_input" | "change_set_pending" | "recovery_pending";

export type AgentUsageRecoveryOutcomeV20 =
  "not_required" | "pending" | "recovered" | "rolled_back" | "failed" | "outcome_unknown";

export type AgentUsageChangeSetOutcomeV20 =
  "none" | "generated" | "approved" | "rejected" | "applied" | "rolled_back" | "undone" | "stale";

export type AgentUsageSourceKindV20 =
  | "disk_file"
  | "editor_buffer"
  | "story_bible_asset"
  | "project_conventions"
  | "workspace_outline"
  | "compaction_summary"
  | "system_guidance"
  | "conversation"
  | "tool_result"
  | "user_request";

export type AgentUsageSourceExclusionReasonV20 =
  "none" | "user_excluded" | "budget" | "policy" | "stale" | "unsupported";

export interface AgentUsageSourceMetricV20 {
  readonly sourceKind: AgentUsageSourceKindV20;
  readonly tokenCount: number;
  readonly truncated: boolean;
  readonly exclusionReason: AgentUsageSourceExclusionReasonV20;
}

export interface AgentUsageStyleObservationV20 {
  readonly rule: string;
  readonly version: string;
  readonly confidence: number;
  readonly userOutcome: "accepted" | "ignored" | "dismissed" | "no_action";
}

/**
 * Privacy-safe local observability for a run. This is deliberately separate from the legacy
 * provider billing record above: it contains only bounded counters, registered versions, enums,
 * checksums and opaque local refs. It has no extension bag in which request bodies can hide.
 */
export interface AgentUsageRecordV20 {
  readonly schemaVersion: typeof AGENT_USAGE_RECORD_V20_SCHEMA_VERSION;
  readonly storageScope: "local_only";
  readonly usageId: string;
  readonly runId: string;
  readonly recordedAt: string;
  readonly semanticVersionSetChecksum: string;
  readonly guidanceVersion: "3.0";
  readonly contextProfileId: AgentContextProfileId;
  readonly messageOrderVersion: "2.0";
  readonly toolCatalogVersion: "2.0";
  readonly runOutcome: AgentUsageRunOutcomeV20;
  readonly pendingOutcome: AgentUsagePendingOutcomeV20;
  readonly recoveryOutcome: AgentUsageRecoveryOutcomeV20;
  readonly modelRoundCount: number;
  readonly toolCallCount: number;
  readonly toolFailureCount: number;
  readonly approvalWaitCount: number;
  readonly approvalWaitMs: number;
  readonly sources: readonly AgentUsageSourceMetricV20[];
  readonly cacheOutcome: "hit" | "miss" | "bypass" | "unknown";
  readonly cacheVerifiedInputTokens: number | null;
  readonly changeSetOutcome: AgentUsageChangeSetOutcomeV20;
  readonly styleObservations: readonly AgentUsageStyleObservationV20[];
  readonly eventRefs: readonly string[];
}

export type CreateAgentUsageRecordV20Input = Omit<
  AgentUsageRecordV20,
  "schemaVersion" | "storageScope"
>;

export type VersionedAgentUsageRecord = AgentUsageRecord | AgentUsageRecordV20;

/**
 * A per-currency unit-price snapshot captured into a usage record. Stage 5A always writes `null`
 * (pricing is inert); Task 3.2 activates a pricing registry that fills this without changing the shape.
 */
export interface AgentUsageUnitPriceSnapshot {
  readonly inputPerMillion: number;
  readonly outputPerMillion: number;
  readonly cacheReadPerMillion?: number;
  readonly cacheWritePerMillion?: number;
  readonly reasoningPerMillion?: number;
  readonly currency: string;
}

/**
 * Legacy provider billing/token record. Normal model rounds and compaction still use this 1.x
 * family; local run observability uses the separate strict 2.0 artifact above. It carries only
 * redacted token/budget facts, never prompt text, file contents, paths, or credentials.
 */
export interface AgentUsageRecord {
  readonly schemaVersion: "1.2";
  readonly scope: AgentContextScope;
  readonly usageId: string;
  readonly runId: string;
  readonly conversationId: string;
  readonly roundId: string;
  readonly finalSequence: number;
  readonly provider: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly cacheEligibleInputTokens?: number;
  readonly cacheOutcome: LlmCacheOutcome;
  readonly cacheBypassReason?: LlmPromptCacheBypassReason;
  readonly cacheUsageStatus: LlmCacheUsageStatus;
  readonly cacheInputTokenSemantics: LlmCacheInputTokenSemantics;
  readonly cacheMode: LlmPromptCacheMode | null;
  readonly cachePrefixChecksum: string | null;
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
  /** Legacy workspace-only identity; standalone commands omit it. */
  readonly projectId?: string;
  readonly scope?: AgentContextScope;
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
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly cacheInputTokenSemantics: LlmCacheInputTokenSemantics;
  readonly reasoningTokens?: number;
  readonly unitPrices: AgentUsageUnitPriceSnapshot;
}): number {
  const inputTokens =
    input.cacheInputTokenSemantics === "included_in_input"
      ? Math.max(0, input.inputTokens - (input.cacheReadTokens ?? 0))
      : input.inputTokens;
  return (
    (inputTokens * input.unitPrices.inputPerMillion +
      input.outputTokens * input.unitPrices.outputPerMillion +
      (input.cacheReadTokens ?? 0) * (input.unitPrices.cacheReadPerMillion ?? 0) +
      (input.cacheWriteTokens ?? 0) * (input.unitPrices.cacheWritePerMillion ?? 0) +
      (input.reasoningTokens ?? 0) * (input.unitPrices.reasoningPerMillion ?? 0)) /
    1_000_000
  );
}

const USAGE_STATUS = new Set(["actual", "estimated", "missing"]);
const PRECISION = new Set<AgentContextPrecision>(["reported", "estimated", "unknown"]);
const COST_STATUS = new Set(["actual", "estimated", "unknown"]);
const CACHE_OUTCOME = new Set(["hit", "miss", "bypass", "unknown"]);
const CACHE_USAGE_STATUS = new Set(["actual", "derived", "unavailable"]);
const CACHE_INPUT_SEMANTICS = new Set(["included_in_input", "excluded_from_input", "unavailable"]);
const CACHE_MODE = new Set([
  "none",
  "automatic_prefix",
  "explicit_breakpoints",
  "explicit_resource"
]);
const CACHE_BYPASS_REASON = new Set([
  "policy_none",
  "unsupported_provider",
  "below_minimum_tokens",
  "identity_unverified",
  "resource_unavailable",
  "resource_create_failed",
  "resource_expired",
  "cache_error",
  "usage_unavailable"
]);
const CHECKSUM = /^[a-f0-9]{64}$/u;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
// The widest real UTC offset is +14:00; -12:00 is the western extreme. Clamp to ±15h for safety.
const MAX_OFFSET_MINUTES = 15 * 60;
const RECORD_FIELDS = new Set([
  "schemaVersion",
  "scope",
  "usageId",
  "runId",
  "conversationId",
  "roundId",
  "finalSequence",
  "provider",
  "model",
  "inputTokens",
  "outputTokens",
  "cachedTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "cacheEligibleInputTokens",
  "cacheOutcome",
  "cacheBypassReason",
  "cacheUsageStatus",
  "cacheInputTokenSemantics",
  "cacheMode",
  "cachePrefixChecksum",
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
  "cacheReadPerMillion",
  "cacheWritePerMillion",
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
  if (record.schemaVersion !== "1.2" || !isAgentContextScope(record.scope)) {
    return err(invalid(record, "scope"));
  }
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
    ["cacheReadTokens", record.cacheReadTokens],
    ["cacheWriteTokens", record.cacheWriteTokens],
    ["cacheEligibleInputTokens", record.cacheEligibleInputTokens],
    ["reasoningTokens", record.reasoningTokens],
    ["compactionBeforeTokens", record.compactionBeforeTokens],
    ["compactionAfterTokens", record.compactionAfterTokens]
  ];
  for (const [field, value] of optional) {
    if (value !== undefined && !isTokenCount(value)) return err(invalid(record, field));
  }
  if (
    record.cacheReadTokens !== undefined &&
    record.cacheEligibleInputTokens !== undefined &&
    record.cacheReadTokens > record.cacheEligibleInputTokens
  ) {
    return err(invalid(record, "cacheReadTokens"));
  }
  if (record.totalTokens < record.inputTokens + record.outputTokens) {
    return err(invalid(record, "totalTokens"));
  }
  if (!Number.isFinite(record.cost.amount) || record.cost.amount < 0) {
    return err(invalid(record, "cost.amount"));
  }
  if (!USAGE_STATUS.has(record.usageStatus)) return err(invalid(record, "usageStatus"));
  if (!CACHE_OUTCOME.has(record.cacheOutcome)) return err(invalid(record, "cacheOutcome"));
  if (!CACHE_USAGE_STATUS.has(record.cacheUsageStatus)) {
    return err(invalid(record, "cacheUsageStatus"));
  }
  if (!CACHE_INPUT_SEMANTICS.has(record.cacheInputTokenSemantics)) {
    return err(invalid(record, "cacheInputTokenSemantics"));
  }
  if (record.cacheMode !== null && !CACHE_MODE.has(record.cacheMode)) {
    return err(invalid(record, "cacheMode"));
  }
  if (record.cachePrefixChecksum !== null && !CHECKSUM.test(record.cachePrefixChecksum)) {
    return err(invalid(record, "cachePrefixChecksum"));
  }
  if (
    record.cacheBypassReason !== undefined &&
    !CACHE_BYPASS_REASON.has(record.cacheBypassReason)
  ) {
    return err(invalid(record, "cacheBypassReason"));
  }
  if ((record.cacheOutcome === "bypass") !== (record.cacheBypassReason !== undefined)) {
    return err(invalid(record, "cacheBypassReason"));
  }
  if (record.cachedTokens !== undefined && record.cachedTokens !== record.cacheReadTokens) {
    return err(invalid(record, "cachedTokens"));
  }
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

/**
 * Read compatibility for persisted usage. New writes are always 1.2; legacy 1.0/1.1 records are
 * normalized in memory with unavailable cache observability and are never rewritten in place.
 */
export function normalizeAgentUsageRecord(value: unknown): AgentUsageRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("AGENT_USAGE_RECORD_INVALID");
  }
  const raw = value as Record<string, unknown>;
  let candidate: Record<string, unknown>;
  if (raw["schemaVersion"] === "1.2") {
    candidate = { ...raw, scope: normalizeAgentContextScope(raw["scope"]) };
  } else if (raw["schemaVersion"] === "1.1" || raw["schemaVersion"] === "1.0") {
    const scoped: Record<string, unknown> = {
      ...raw,
      scope:
        raw["schemaVersion"] === "1.1"
          ? normalizeAgentContextScope(raw["scope"])
          : normalizeAgentContextScope(undefined, raw["projectId"])
    };
    delete scoped["projectId"];
    candidate = normalizeLegacyCacheUsage(scoped);
  } else {
    throw new Error("AGENT_USAGE_RECORD_VERSION_UNSUPPORTED");
  }
  const validated = validateAgentUsageRecord(candidate as unknown as AgentUsageRecord);
  if (!validated.ok) throw new Error(validated.error.code);
  return validated.value;
}

const V20_FIELDS = new Set([
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
]);
const V20_SOURCE_FIELDS = new Set(["sourceKind", "tokenCount", "truncated", "exclusionReason"]);
const V20_STYLE_FIELDS = new Set(["rule", "version", "confidence", "userOutcome"]);
const V20_PROFILES = new Set(["standalone", "writing", "creative_general", "engineering"]);
const V20_RUN_OUTCOMES = new Set([
  "completed",
  "blocked",
  "cancelled",
  "failed",
  "limit_reached",
  "awaiting_approval",
  "awaiting_input",
  "stale",
  "capability_changed"
]);
const V20_PENDING_OUTCOMES = new Set([
  "none",
  "awaiting_approval",
  "awaiting_input",
  "change_set_pending",
  "recovery_pending"
]);
const V20_RECOVERY_OUTCOMES = new Set([
  "not_required",
  "pending",
  "recovered",
  "rolled_back",
  "failed",
  "outcome_unknown"
]);
const V20_CHANGE_SET_OUTCOMES = new Set([
  "none",
  "generated",
  "approved",
  "rejected",
  "applied",
  "rolled_back",
  "undone",
  "stale"
]);
const V20_SOURCE_KINDS = new Set([
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
]);
const V20_EXCLUSION_REASONS = new Set([
  "none",
  "user_excluded",
  "budget",
  "policy",
  "stale",
  "unsupported"
]);
const V20_CACHE_OUTCOMES = new Set(["hit", "miss", "bypass", "unknown"]);
const V20_STYLE_OUTCOMES = new Set(["accepted", "ignored", "dismissed", "no_action"]);
const V20_SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,255}$/u;
const V20_SAFE_VERSION = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,127}$/u;
const V20_CHECKSUM = /^[a-f0-9]{64}$/u;

/** Strict new-writer/new-reader contract for local-only 2.0 metrics. */
export function createAgentUsageRecordV20(
  input: CreateAgentUsageRecordV20Input
): AgentUsageRecordV20 {
  return parseAgentUsageRecordV20({
    ...input,
    schemaVersion: AGENT_USAGE_RECORD_V20_SCHEMA_VERSION,
    storageScope: "local_only"
  });
}

export function parseAgentUsageRecordV20(value: unknown): AgentUsageRecordV20 {
  if (!isRecordValue(value) || !hasOnlyFields(value, V20_FIELDS) || value.schemaVersion !== "2.0") {
    throw new Error("AGENT_USAGE_RECORD_V20_INVALID");
  }
  if (
    value.storageScope !== "local_only" ||
    !isPrivacySafeRef(value.usageId) ||
    !isPrivacySafeRef(value.runId) ||
    !isUtcTimestamp(value.recordedAt) ||
    typeof value.semanticVersionSetChecksum !== "string" ||
    !V20_CHECKSUM.test(value.semanticVersionSetChecksum) ||
    value.guidanceVersion !== "3.0" ||
    !V20_PROFILES.has(value.contextProfileId as string) ||
    value.messageOrderVersion !== "2.0" ||
    value.toolCatalogVersion !== "2.0" ||
    !V20_RUN_OUTCOMES.has(value.runOutcome as string) ||
    !V20_PENDING_OUTCOMES.has(value.pendingOutcome as string) ||
    !V20_RECOVERY_OUTCOMES.has(value.recoveryOutcome as string) ||
    !isTokenCount(value.modelRoundCount as number) ||
    !isTokenCount(value.toolCallCount as number) ||
    !isTokenCount(value.toolFailureCount as number) ||
    !isTokenCount(value.approvalWaitCount as number) ||
    !isTokenCount(value.approvalWaitMs as number) ||
    (value.toolFailureCount as number) > (value.toolCallCount as number) ||
    !Array.isArray(value.sources) ||
    value.sources.length > 256 ||
    !V20_CACHE_OUTCOMES.has(value.cacheOutcome as string) ||
    (value.cacheVerifiedInputTokens !== null &&
      !isTokenCount(value.cacheVerifiedInputTokens as number)) ||
    !V20_CHANGE_SET_OUTCOMES.has(value.changeSetOutcome as string) ||
    !Array.isArray(value.styleObservations) ||
    value.styleObservations.length > 256 ||
    !Array.isArray(value.eventRefs) ||
    value.eventRefs.length > 1024
  ) {
    throw new Error("AGENT_USAGE_RECORD_V20_INVALID");
  }
  if (
    (value.cacheOutcome === "unknown" || value.cacheOutcome === "bypass") &&
    value.cacheVerifiedInputTokens !== null
  ) {
    throw new Error("AGENT_USAGE_RECORD_V20_INVALID");
  }
  for (const source of value.sources) {
    if (
      !isRecordValue(source) ||
      !hasOnlyFields(source, V20_SOURCE_FIELDS) ||
      !V20_SOURCE_KINDS.has(source.sourceKind as string) ||
      !isTokenCount(source.tokenCount as number) ||
      typeof source.truncated !== "boolean" ||
      !V20_EXCLUSION_REASONS.has(source.exclusionReason as string) ||
      (source.exclusionReason !== "none" && (source.tokenCount !== 0 || source.truncated !== false))
    ) {
      throw new Error("AGENT_USAGE_RECORD_V20_INVALID");
    }
  }
  for (const observation of value.styleObservations) {
    if (
      !isRecordValue(observation) ||
      !hasOnlyFields(observation, V20_STYLE_FIELDS) ||
      !isPrivacySafeRef(observation.rule) ||
      typeof observation.version !== "string" ||
      !V20_SAFE_VERSION.test(observation.version) ||
      typeof observation.confidence !== "number" ||
      !Number.isFinite(observation.confidence) ||
      observation.confidence < 0 ||
      observation.confidence > 1 ||
      !V20_STYLE_OUTCOMES.has(observation.userOutcome as string)
    ) {
      throw new Error("AGENT_USAGE_RECORD_V20_INVALID");
    }
  }
  if (
    !value.eventRefs.every(isPrivacySafeRef) ||
    new Set(value.eventRefs).size !== value.eventRefs.length
  ) {
    throw new Error("AGENT_USAGE_RECORD_V20_INVALID");
  }
  return deepFreezeUsage(structuredClone(value) as unknown as AgentUsageRecordV20);
}

export function serializeAgentUsageRecordV20(value: AgentUsageRecordV20): string {
  return JSON.stringify(parseAgentUsageRecordV20(value));
}

export function parseAgentUsageRecordV20Json(value: string): AgentUsageRecordV20 {
  try {
    return parseAgentUsageRecordV20(JSON.parse(value) as unknown);
  } catch {
    throw new Error("AGENT_USAGE_RECORD_V20_INVALID");
  }
}

/**
 * Dispatches persisted records to their own version reader. Legacy records are never enriched from
 * newer artifacts, so old storage cannot acquire content-bearing or identity fields by inference.
 */
export function readVersionedAgentUsageRecord(value: unknown): VersionedAgentUsageRecord {
  if (!isRecordValue(value)) throw new Error("AGENT_USAGE_RECORD_INVALID");
  if (value.schemaVersion === AGENT_USAGE_RECORD_V20_SCHEMA_VERSION) {
    return parseAgentUsageRecordV20(value);
  }
  if (
    value.schemaVersion === "1.0" ||
    value.schemaVersion === "1.1" ||
    value.schemaVersion === "1.2"
  ) {
    return normalizeAgentUsageRecord(value);
  }
  throw new Error("AGENT_USAGE_RECORD_VERSION_UNSUPPORTED");
}

function isPrivacySafeRef(value: unknown): value is string {
  return (
    typeof value === "string" &&
    V20_SAFE_REF.test(value) &&
    !/^sk-[A-Za-z0-9]/iu.test(value) &&
    !/^bearer[._:@-]/iu.test(value)
  );
}

function isUtcTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepFreezeUsage<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreezeUsage(child);
    Object.freeze(value);
  }
  return value;
}

function normalizeLegacyCacheUsage(raw: Record<string, unknown>): Record<string, unknown> {
  const cachedTokens = raw["cachedTokens"];
  const unitPrices = raw["unitPrices"];
  const normalizedPrices =
    typeof unitPrices === "object" && unitPrices !== null && !Array.isArray(unitPrices)
      ? normalizeLegacyUnitPrices(unitPrices as Record<string, unknown>)
      : unitPrices;
  return {
    ...raw,
    schemaVersion: "1.2",
    ...(cachedTokens === undefined ? {} : { cacheReadTokens: cachedTokens }),
    cacheOutcome: "unknown",
    cacheUsageStatus: "unavailable",
    cacheInputTokenSemantics: "unavailable",
    cacheMode: null,
    cachePrefixChecksum: null,
    unitPrices: normalizedPrices
  };
}

function normalizeLegacyUnitPrices(value: Record<string, unknown>): Record<string, unknown> {
  const { cachedPerMillion, ...rest } = value;
  return {
    ...rest,
    ...(cachedPerMillion === undefined ? {} : { cacheReadPerMillion: cachedPerMillion })
  };
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
  if (prices.cacheReadPerMillion !== undefined && !isUnitPrice(prices.cacheReadPerMillion)) {
    return false;
  }
  if (prices.cacheWritePerMillion !== undefined && !isUnitPrice(prices.cacheWritePerMillion)) {
    return false;
  }
  if (prices.reasoningPerMillion !== undefined && !isUnitPrice(prices.reasoningPerMillion))
    return false;
  if (record.cacheReadTokens !== undefined && prices.cacheReadPerMillion === undefined)
    return false;
  if (record.cacheWriteTokens !== undefined && prices.cacheWritePerMillion === undefined) {
    return false;
  }
  if (record.reasoningTokens !== undefined && prices.reasoningPerMillion === undefined)
    return false;

  const expected = calculateAgentUsageEstimatedCost({
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    ...(record.cacheReadTokens === undefined ? {} : { cacheReadTokens: record.cacheReadTokens }),
    ...(record.cacheWriteTokens === undefined ? {} : { cacheWriteTokens: record.cacheWriteTokens }),
    cacheInputTokenSemantics: record.cacheInputTokenSemantics,
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
