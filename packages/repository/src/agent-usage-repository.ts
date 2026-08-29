import { mkdir, readFile, readdir, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";

import {
  isAgentContextScope,
  normalizeAgentUsageRecord,
  validateAgentUsageRecord,
  type AgentContextScope,
  type AgentUsageRecord
} from "@novel-studio/agent-engine";
import { err, ok, type JsonObject, type Result, type UnifiedError } from "@novel-studio/shared";

import { writeTextAtomically } from "./atomic-write.js";
import { storageError } from "./errors.js";

type CacheOutcome = "hit" | "miss" | "bypass" | "unknown";
type CacheUsageStatus = "actual" | "derived" | "unavailable";
type CacheInputTokenSemantics = "included_in_input" | "excluded_from_input" | "unavailable";
type CacheMode = "none" | "automatic_prefix" | "explicit_breakpoints" | "explicit_resource";
type CacheBypassReason =
  | "policy_none"
  | "unsupported_provider"
  | "below_minimum_tokens"
  | "identity_unverified"
  | "resource_unavailable"
  | "resource_create_failed"
  | "resource_expired"
  | "cache_error"
  | "usage_unavailable";

export interface AgentUsageFileRepositoryOptions {
  readonly userDataRoot: string;
  readonly traceId?: string;
}

export interface AgentUsageRepositoryDateRange {
  readonly fromLocalDate: string;
  readonly toLocalDate: string;
}

export interface AgentUsageRepositoryQuery {
  readonly range: AgentUsageRepositoryDateRange;
  readonly provider?: string;
  readonly model?: string;
  readonly projectId?: string;
  readonly detailLocalDate?: string;
  readonly includeModelBreakdown?: boolean;
}

export interface AgentUsageRepositoryCostTotal {
  readonly currency: string;
  readonly actualAmount: number;
  readonly estimatedAmount: number;
  readonly estimatedCacheSavings?: number;
}

export interface AgentUsageRepositoryDailyBucket {
  readonly localDate: string;
  readonly recordCount: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly cacheEligibleInputTokens: number;
  readonly cacheHitRate?: number;
  readonly cacheShareReadTokens?: number;
  readonly cacheTelemetryComparableInputTokens?: number;
  readonly cacheComparableInputTokens?: number;
  readonly reasoningTokens: number;
  readonly totalTokens: number;
  readonly costs: readonly AgentUsageRepositoryCostTotal[];
  readonly hasUnknownCost: boolean;
  readonly models?: readonly {
    readonly provider: string;
    readonly model: string;
    readonly totalTokens: number;
  }[];
}

export interface AgentUsageRepositoryRunSummary {
  readonly scope: AgentContextScope;
  readonly usageId: string;
  readonly runId: string;
  readonly conversationId: string;
  readonly projectId?: string;
  readonly provider: string;
  readonly model: string;
  readonly totalTokens: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly cacheEligibleInputTokens?: number;
  readonly cacheHitRate?: number;
  readonly cacheOutcome: CacheOutcome;
  readonly cacheBypassReason?: CacheBypassReason;
  readonly cacheUsageStatus: CacheUsageStatus;
  readonly cacheInputTokenSemantics: CacheInputTokenSemantics;
  readonly cacheMode: CacheMode | null;
  readonly cachePrefixChecksum: string | null;
  readonly estimatedCacheSavings?: {
    readonly amount: number;
    readonly currency: string;
  };
  readonly usageStatus: "actual" | "estimated" | "missing";
  readonly cost: {
    readonly amount: number;
    readonly currency: string;
    readonly status: "actual" | "estimated" | "unknown";
  };
  readonly timestamp: string;
}

export interface ClearAgentUsageRepositoryCommand {
  readonly commandId: string;
  readonly range: AgentUsageRepositoryDateRange;
}

const usageMutationQueues = new Map<string, Promise<void>>();

function usageRootKey(userDataRoot: string): string {
  const key = resolve(userDataRoot);
  return process.platform === "win32" ? key.toLowerCase() : key;
}

function enqueueUsageMutation<T>(userDataRoot: string, mutation: () => Promise<T>): Promise<T> {
  const key = usageRootKey(userDataRoot);
  const prior = usageMutationQueues.get(key) ?? Promise.resolve();
  const result = prior.catch(() => undefined).then(mutation);
  const tail = result.then(
    () => undefined,
    () => undefined
  );
  usageMutationQueues.set(key, tail);
  void tail.finally(() => {
    if (usageMutationQueues.get(key) === tail) usageMutationQueues.delete(key);
  });
  return result;
}

async function waitForUsageMutations(userDataRoot: string): Promise<void> {
  await usageMutationQueues.get(usageRootKey(userDataRoot));
}

/**
 * The redacted usage sink under the Electron user-data root. It stores one final record per run round
 * (keyed `runId:roundId:finalSequence`), keeps a running daily aggregate so 5C can add 365-day rollups
 * without a write-path rewrite, and refuses any record that leaks prompt text, file bodies, absolute
 * paths, credentials, or raw provider frames. Task 3.2 layers retention/query/clear on top of this.
 */
export class AgentUsageFileRepository {
  private readonly traceId: string;

  public constructor(private readonly options: AgentUsageFileRepositoryOptions) {
    this.traceId = options.traceId ?? "agent-usage-file-repository";
  }

  public async writeRunMetrics<T extends object>(record: T): Promise<Result<T, UnifiedError>> {
    const written = await this.writeRunMetricsJson(record as unknown as JsonObject);
    return written as Result<T, UnifiedError>;
  }

  private async writeRunMetricsJson(record: JsonObject): Promise<Result<JsonObject, UnifiedError>> {
    const redaction = assertRunMetricsRedacted(record);
    if (redaction !== undefined) return err(this.redactionRequired(redaction));
    const validated = validateRunMetricsRecord(record);
    if (!validated.ok) return err(validated.error);
    return enqueueUsageMutation(this.options.userDataRoot, async () => {
      const path = this.runMetricsPath(stringField(record, "usageId"));
      const existing = await this.readJson(path);
      if (!existing.ok) return existing as Result<JsonObject, UnifiedError>;
      if (existing.value !== undefined) {
        const prior = validateRunMetricsRecord(existing.value);
        if (!prior.ok) return prior;
        return usageContentChecksum(prior.value) === usageContentChecksum(record)
          ? ok(prior.value)
          : err(this.recordConflict());
      }
      return this.writeJson(path, record);
    });
  }

  public async readRunMetrics<T extends object>(
    usageId: string
  ): Promise<Result<T | undefined, UnifiedError>> {
    if (!isSafeMetricRef(usageId)) return this.invalid("AGENT_USAGE_RECORD_V20_INVALID");
    await waitForUsageMutations(this.options.userDataRoot);
    const stored = await this.readJson(this.runMetricsPath(usageId));
    if (!stored.ok || stored.value === undefined)
      return stored as Result<T | undefined, UnifiedError>;
    const redaction = assertRunMetricsRedacted(stored.value);
    if (redaction !== undefined) return err(this.redactionRequired(redaction));
    return validateRunMetricsRecord(stored.value) as Result<T | undefined, UnifiedError>;
  }

  public async writeFinal(record: JsonObject): Promise<Result<JsonObject, UnifiedError>> {
    const redaction = assertRedacted(record);
    if (redaction !== undefined) return err(this.redactionRequired(redaction));
    if (record["schemaVersion"] !== "1.2") return this.invalid("AGENT_USAGE_RECORD_INVALID");
    const validated = validateUsageRecord(record);
    if (!validated.ok) return err(validated.error);

    return enqueueUsageMutation(this.options.userDataRoot, () =>
      this.writeFinalLocked(validated.value)
    );
  }

  private async writeFinalLocked(record: JsonObject): Promise<Result<JsonObject, UnifiedError>> {
    const pendingClear = await this.findPendingClear(stringField(record, "localDate"));
    if (!pendingClear.ok) return pendingClear as Result<JsonObject, UnifiedError>;
    if (pendingClear.value !== undefined) {
      return err(this.clearPending(stringField(pendingClear.value, "commandId")));
    }
    const usageId = String(record["usageId"]);
    const key = idempotencyKey(record);
    const cleared = await this.readJson(this.clearedKeyPath(key));
    if (!cleared.ok) return cleared as Result<JsonObject, UnifiedError>;
    if (cleared.value !== undefined) {
      return cleared.value["contentChecksum"] === usageContentChecksum(record)
        ? ok(record)
        : err(this.recordConflict());
    }
    const priorById = await this.readByIdUnlocked(usageId);
    if (!priorById.ok) return priorById as Result<JsonObject, UnifiedError>;
    if (priorById.value !== undefined) {
      const repaired = await this.repairFinal(priorById.value);
      return repaired.ok ? ok(priorById.value) : repaired;
    }
    // First-wins idempotency: a replayed round key returns the record written first, never a competitor.
    const pointer = await this.readJson(this.keyPath(key));
    if (!pointer.ok) return pointer as Result<JsonObject, UnifiedError>;
    if (pointer.value !== undefined) {
      const priorId = String(pointer.value["usageId"]);
      const prior = await this.readByIdUnlocked(priorId);
      if (!prior.ok) return prior as Result<JsonObject, UnifiedError>;
      if (prior.value !== undefined) {
        const repaired = await this.repairFinal(prior.value);
        return repaired.ok ? ok(prior.value) : repaired;
      }
      if (pointer.value["contentChecksum"] !== usageContentChecksum(record)) {
        return err(this.recordConflict());
      }
      const aggregated = await this.updateDailyAggregate(record);
      return aggregated.ok ? ok(record) : (aggregated as Result<JsonObject, UnifiedError>);
    }

    const detailWritten = await this.writeJson(this.detailPath(usageId), record);
    if (!detailWritten.ok) return detailWritten;
    const repaired = await this.repairFinal(record);
    return repaired.ok ? ok(record) : repaired;
  }

  private async repairFinal(record: JsonObject): Promise<Result<JsonObject, UnifiedError>> {
    const usageId = stringField(record, "usageId");
    const keyWritten = await this.writeJson(this.keyPath(idempotencyKey(record)), {
      usageId,
      localDate: stringField(record, "localDate"),
      contentChecksum: usageContentChecksum(record)
    });
    if (!keyWritten.ok) return keyWritten;
    const aggregated = await this.updateDailyAggregate(record);
    if (!aggregated.ok) return aggregated as Result<JsonObject, UnifiedError>;
    return ok(record);
  }

  public async readById(usageId: string): Promise<Result<JsonObject | undefined, UnifiedError>> {
    if (!isSafeUsageId(usageId)) return this.invalid("AGENT_USAGE_RECORD_INVALID");
    await waitForUsageMutations(this.options.userDataRoot);
    return this.readByIdUnlocked(usageId);
  }

  private async readByIdUnlocked(
    usageId: string
  ): Promise<Result<JsonObject | undefined, UnifiedError>> {
    const stored = await this.readJson(this.detailPath(usageId));
    if (!stored.ok || stored.value === undefined) return stored;
    return validateUsageRecord(stored.value);
  }

  public async queryDetails(
    query: AgentUsageRepositoryQuery
  ): Promise<Result<readonly AgentUsageRepositoryRunSummary[], UnifiedError>> {
    const range = validateQuery(query, true);
    if (!range.ok) return err(this.queryInvalid(range.field));
    if (query.detailLocalDate === undefined) return ok([]);
    await waitForUsageMutations(this.options.userDataRoot);
    const records = await this.readAllDetails();
    if (!records.ok)
      return records as Result<readonly AgentUsageRepositoryRunSummary[], UnifiedError>;
    return ok(
      records.value
        .filter(
          (record) => matchesQuery(record, query) && record["localDate"] === query.detailLocalDate
        )
        .sort((left, right) => String(right["timestamp"]).localeCompare(String(left["timestamp"])))
        .map(toRunSummary)
    );
  }

  public async queryDailyAggregates(
    query: AgentUsageRepositoryQuery
  ): Promise<Result<readonly AgentUsageRepositoryDailyBucket[], UnifiedError>> {
    const range = validateQuery(query, false);
    if (!range.ok) return err(this.queryInvalid(range.field));
    return enqueueUsageMutation(this.options.userDataRoot, async () => {
      const repaired = await this.repairDetailsLocked();
      if (!repaired.ok)
        return repaired as Result<readonly AgentUsageRepositoryDailyBucket[], UnifiedError>;
      const aggregates = await this.readJsonDirectory(this.usagePath("aggregates"));
      if (!aggregates.ok)
        return aggregates as Result<readonly AgentUsageRepositoryDailyBucket[], UnifiedError>;
      const buckets: AgentUsageRepositoryDailyBucket[] = [];
      for (const aggregate of aggregates.value) {
        const localDate = stringField(aggregate, "localDate");
        if (localDate < query.range.fromLocalDate || localDate > query.range.toLocalDate) continue;
        const bucket = projectAggregate(aggregate, query);
        if (bucket !== undefined) buckets.push(bucket);
      }
      return ok(buckets.sort((left, right) => left.localDate.localeCompare(right.localDate)));
    });
  }

  public async clearUsage(
    command: ClearAgentUsageRepositoryCommand
  ): Promise<Result<void, UnifiedError>> {
    if (!isSafeId(command.commandId)) return err(this.queryInvalid("commandId"));
    const range = validateDateRange(command.range);
    if (!range.ok) return err(this.queryInvalid(range.field));
    return enqueueUsageMutation(this.options.userDataRoot, () => this.clearUsageLocked(command));
  }

  private async clearUsageLocked(
    command: ClearAgentUsageRepositoryCommand
  ): Promise<Result<void, UnifiedError>> {
    const repaired = await this.repairDetailsLocked();
    if (!repaired.ok) return repaired;
    const markerPath = this.clearCommandPath(command.commandId);
    const marker = await this.readJson(markerPath);
    if (!marker.ok) return marker as Result<void, UnifiedError>;
    if (marker.value !== undefined) {
      if (
        marker.value["fromLocalDate"] !== command.range.fromLocalDate ||
        marker.value["toLocalDate"] !== command.range.toLocalDate
      ) {
        return err(this.queryInvalid("commandId"));
      }
      // Legacy markers had no status and represent clears that already completed.
      if (marker.value["status"] !== "pending") return ok(undefined);
    } else {
      const pending = await this.writeJson(markerPath, {
        status: "pending",
        commandId: command.commandId,
        fromLocalDate: command.range.fromLocalDate,
        toLocalDate: command.range.toLocalDate
      });
      if (!pending.ok) return pending as Result<void, UnifiedError>;
    }
    const cleared = await this.deleteUsageInRange(command.range, true, true);
    if (!cleared.ok) return cleared;
    const written = await this.writeJson(markerPath, {
      status: "completed",
      commandId: command.commandId,
      fromLocalDate: command.range.fromLocalDate,
      toLocalDate: command.range.toLocalDate
    });
    return written.ok ? ok(undefined) : (written as Result<void, UnifiedError>);
  }

  private async findPendingClear(
    localDate: string
  ): Promise<Result<JsonObject | undefined, UnifiedError>> {
    const markers = await this.readJsonDirectory(this.usagePath("clear-commands"));
    if (!markers.ok) return markers as Result<JsonObject | undefined, UnifiedError>;
    return ok(
      markers.value.find(
        (marker) =>
          marker["status"] === "pending" &&
          stringField(marker, "fromLocalDate") <= localDate &&
          localDate <= stringField(marker, "toLocalDate")
      )
    );
  }

  public async enforceRetention(referenceLocalDate: string): Promise<Result<void, UnifiedError>> {
    if (!isLocalDate(referenceLocalDate)) return err(this.queryInvalid("referenceLocalDate"));
    return enqueueUsageMutation(this.options.userDataRoot, async () => {
      const repaired = await this.repairDetailsLocked();
      if (!repaired.ok) return repaired as Result<void, UnifiedError>;
      const details = await this.deleteDetailsBefore(shiftLocalDate(referenceLocalDate, -29));
      if (!details.ok) return details;
      const cutoff = shiftLocalDate(referenceLocalDate, -364);
      const aggregates = await this.deleteAggregatesBefore(cutoff);
      if (!aggregates.ok) return aggregates;
      return this.deleteKeysBefore(cutoff);
    });
  }

  private async repairDetailsLocked(): Promise<Result<void, UnifiedError>> {
    const details = await this.readAllDetails();
    if (!details.ok) return details as Result<void, UnifiedError>;
    for (const detail of details.value) {
      const redaction = assertRedacted(detail);
      if (redaction !== undefined) return err(this.redactionRequired(redaction));
      const validated = validateUsageRecord(detail);
      if (!validated.ok) return err(validated.error);
      const localDate = stringField(detail, "localDate");
      const pendingClear = await this.findPendingClear(localDate);
      if (!pendingClear.ok) return pendingClear as Result<void, UnifiedError>;
      if (pendingClear.value !== undefined) continue;
      const cleared = await this.readJson(this.clearedKeyPath(idempotencyKey(detail)));
      if (!cleared.ok) return cleared as Result<void, UnifiedError>;
      if (cleared.value !== undefined) continue;
      const keyWritten = await this.writeJson(this.keyPath(idempotencyKey(detail)), {
        usageId: stringField(detail, "usageId"),
        localDate,
        contentChecksum: usageContentChecksum(detail)
      });
      if (!keyWritten.ok) return keyWritten as Result<void, UnifiedError>;
    }
    const rebuilt = await this.rebuildAggregatesLocked();
    if (!rebuilt.ok) return rebuilt;
    return this.discardInvalidAggregateFilesLocked();
  }

  /** Invalid aggregate files contain no source data and must not block unrelated usage queries. */
  private async discardInvalidAggregateFilesLocked(): Promise<Result<void, UnifiedError>> {
    const aggregateRoot = this.usagePath("aggregates");
    try {
      const entries = await readdir(aggregateRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const path = join(aggregateRoot, entry.name);
        let parsed: unknown;
        try {
          parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
        } catch (error) {
          if (isMissingFileError(error)) continue;
          if (!(error instanceof SyntaxError)) {
            return err(this.storageFailure("AGENT_USAGE_READ_FAILED", error));
          }
        }
        const expectedDate = basename(entry.name, ".json");
        if (isValidRetainedAggregate(parsed, expectedDate)) {
          continue;
        }
        const removed = await this.removeFile(path);
        if (!removed.ok) return removed;
      }
      return ok(undefined);
    } catch (error) {
      return isMissingFileError(error)
        ? ok(undefined)
        : err(this.storageFailure("AGENT_USAGE_READ_FAILED", error));
    }
  }

  private async updateDailyAggregate(
    record: JsonObject
  ): Promise<Result<JsonObject, UnifiedError>> {
    const localDate = String(record["localDate"]);
    const rebuilt = await this.rebuildAggregateForDateLocked(localDate);
    if (!rebuilt.ok) return rebuilt as Result<JsonObject, UnifiedError>;
    return ok(
      rebuilt.value ?? {
        schemaVersion: "2.0",
        localDate,
        recordCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cacheEligibleInputTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        costs: [],
        hasUnknownCost: false,
        dimensions: []
      }
    );
  }

  /** Rebuilds aggregates from immutable details, making migration and repair deterministic. */
  private async rebuildAggregatesLocked(): Promise<Result<void, UnifiedError>> {
    const details = await this.readAllDetails();
    if (!details.ok) return details as Result<void, UnifiedError>;
    const dates = new Set<string>();
    for (const detail of details.value) {
      const localDate = stringField(detail, "localDate");
      const pending = await this.findPendingClear(localDate);
      if (!pending.ok) return pending as Result<void, UnifiedError>;
      if (pending.value !== undefined) continue;
      const cleared = await this.readJson(this.clearedKeyPath(idempotencyKey(detail)));
      if (!cleared.ok) return cleared as Result<void, UnifiedError>;
      if (cleared.value !== undefined) continue;
      dates.add(localDate);
    }
    for (const localDate of [...dates].sort()) {
      const rebuilt = await this.rebuildAggregateForDateLocked(localDate, details.value);
      if (!rebuilt.ok) return rebuilt as Result<void, UnifiedError>;
    }
    return ok(undefined);
  }

  private async rebuildAggregateForDateLocked(
    localDate: string,
    providedDetails?: readonly JsonObject[]
  ): Promise<Result<JsonObject | undefined, UnifiedError>> {
    let details: readonly JsonObject[];
    if (providedDetails !== undefined) {
      details = providedDetails;
    } else {
      const loaded = await this.readAllDetails();
      if (!loaded.ok) return loaded as Result<JsonObject | undefined, UnifiedError>;
      details = loaded.value;
    }
    const records = details
      .filter((detail) => stringField(detail, "localDate") === localDate)
      .sort((left, right) =>
        stringField(left, "usageId").localeCompare(stringField(right, "usageId"))
      );
    const dimensions: JsonObject[] = [];
    for (const detail of records) {
      const pending = await this.findPendingClear(localDate);
      if (!pending.ok) return pending as Result<JsonObject | undefined, UnifiedError>;
      if (pending.value !== undefined) continue;
      const cleared = await this.readJson(this.clearedKeyPath(idempotencyKey(detail)));
      if (!cleared.ok) return cleared as Result<JsonObject | undefined, UnifiedError>;
      if (cleared.value !== undefined) continue;
      dimensions.push(createAggregateDimension(detail));
    }
    if (dimensions.length === 0) return ok(undefined);
    const first = records[0] ?? {};
    const aggregate: JsonObject = {
      schemaVersion: "2.0",
      localDate,
      timezone: stringField(first, "timezone"),
      utcOffsetMinutes: numberField(first, "utcOffsetMinutes"),
      recordCount: dimensions.length,
      inputTokens: sumField(dimensions, "inputTokens"),
      outputTokens: sumField(dimensions, "outputTokens"),
      cachedTokens: sumField(dimensions, "cacheReadTokens"),
      cacheReadTokens: sumField(dimensions, "cacheReadTokens"),
      cacheWriteTokens: sumField(dimensions, "cacheWriteTokens"),
      cacheEligibleInputTokens: sumField(dimensions, "cacheEligibleInputTokens"),
      cacheShareReadTokens: sumField(dimensions, "cacheShareReadTokens"),
      cacheTelemetryComparableInputTokens: sumField(
        dimensions,
        "cacheTelemetryComparableInputTokens"
      ),
      cacheComparableInputTokens: sumField(dimensions, "cacheComparableInputTokens"),
      reasoningTokens: sumField(dimensions, "reasoningTokens"),
      totalTokens: sumField(dimensions, "totalTokens"),
      costs: mergeDimensionCosts(dimensions),
      hasUnknownCost: dimensions.some((dimension) => dimension["hasUnknownCost"] === true),
      dimensions
    };
    return this.writeJson(this.aggregatePath(localDate), aggregate);
  }

  private async readAllDetails(): Promise<Result<readonly JsonObject[], UnifiedError>> {
    const stored = await this.readJsonDirectory(this.usagePath("details"));
    if (!stored.ok) return stored;
    const normalized: JsonObject[] = [];
    for (const record of stored.value) {
      const redaction = assertRedacted(record);
      if (redaction !== undefined) return err(this.redactionRequired(redaction));
      const validated = validateUsageRecord(record);
      if (!validated.ok) return err(validated.error);
      normalized.push(validated.value);
    }
    return ok(normalized);
  }

  private async readJsonDirectory(
    path: string
  ): Promise<Result<readonly JsonObject[], UnifiedError>> {
    try {
      const entries = await readdir(path, { withFileTypes: true });
      const values: JsonObject[] = [];
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const value = await this.readJson(join(path, entry.name));
        if (!value.ok) return value as Result<readonly JsonObject[], UnifiedError>;
        if (value.value !== undefined) values.push(value.value);
      }
      return ok(values);
    } catch (error) {
      return isMissingFileError(error)
        ? ok([])
        : err(this.storageFailure("AGENT_USAGE_READ_FAILED", error));
    }
  }

  private async deleteUsageInRange(
    range: AgentUsageRepositoryDateRange,
    deleteDetails: boolean,
    deleteAggregates: boolean
  ): Promise<Result<void, UnifiedError>> {
    if (deleteDetails) {
      const details = await this.readJsonDirectoryEntries(this.usagePath("details"));
      if (!details.ok) return details as Result<void, UnifiedError>;
      for (const entry of details.value) {
        const localDate = stringField(entry.value, "localDate");
        if (localDate < range.fromLocalDate || localDate > range.toLocalDate) continue;
        const tombstoned = await this.writeClearedKey(
          idempotencyKey(entry.value),
          usageContentChecksum(entry.value)
        );
        if (!tombstoned.ok) return tombstoned as Result<void, UnifiedError>;
        const removed = await this.removeFile(entry.path);
        if (!removed.ok) return removed;
      }
      const keyResult = await this.deleteKeysInRange(range);
      if (!keyResult.ok) return keyResult;
    }
    if (deleteAggregates) {
      const aggregates = await this.readJsonDirectoryEntries(this.usagePath("aggregates"));
      if (!aggregates.ok) return aggregates as Result<void, UnifiedError>;
      for (const entry of aggregates.value) {
        const localDate = stringField(entry.value, "localDate");
        if (localDate < range.fromLocalDate || localDate > range.toLocalDate) continue;
        const removed = await this.removeFile(entry.path);
        if (!removed.ok) return removed;
      }
    }
    return ok(undefined);
  }

  private async deleteDetailsBefore(cutoff: string): Promise<Result<void, UnifiedError>> {
    const details = await this.readJsonDirectoryEntries(this.usagePath("details"));
    if (!details.ok) return details as Result<void, UnifiedError>;
    for (const entry of details.value) {
      if (stringField(entry.value, "localDate") >= cutoff) continue;
      const removed = await this.removeFile(entry.path);
      if (!removed.ok) return removed;
    }
    return ok(undefined);
  }

  private async deleteAggregatesBefore(cutoff: string): Promise<Result<void, UnifiedError>> {
    const aggregates = await this.readJsonDirectoryEntries(this.usagePath("aggregates"));
    if (!aggregates.ok) return aggregates as Result<void, UnifiedError>;
    for (const entry of aggregates.value) {
      if (stringField(entry.value, "localDate") >= cutoff) continue;
      const removed = await this.removeFile(entry.path);
      if (!removed.ok) return removed;
    }
    return ok(undefined);
  }

  private async deleteKeysInRange(
    range: AgentUsageRepositoryDateRange
  ): Promise<Result<void, UnifiedError>> {
    const keys = await this.readJsonDirectoryEntries(this.usagePath("keys"));
    if (!keys.ok) return keys as Result<void, UnifiedError>;
    for (const entry of keys.value) {
      const localDate = stringField(entry.value, "localDate");
      if (localDate < range.fromLocalDate || localDate > range.toLocalDate) continue;
      const tombstoned = await this.writeClearedKey(
        basename(entry.path, ".json"),
        stringField(entry.value, "contentChecksum")
      );
      if (!tombstoned.ok) return tombstoned as Result<void, UnifiedError>;
      const removed = await this.removeFile(entry.path);
      if (!removed.ok) return removed;
    }
    return ok(undefined);
  }

  private async writeClearedKey(
    key: string,
    contentChecksum: string
  ): Promise<Result<JsonObject, UnifiedError>> {
    if (!/^[a-f0-9]{64}$/u.test(contentChecksum)) {
      return this.invalid("AGENT_USAGE_RECORD_INVALID");
    }
    const path = this.clearedKeyPath(key);
    const prior = await this.readJson(path);
    if (!prior.ok) return prior as Result<JsonObject, UnifiedError>;
    if (prior.value !== undefined) {
      return prior.value["contentChecksum"] === contentChecksum
        ? ok(prior.value)
        : err(this.recordConflict());
    }
    return this.writeJson(path, { contentChecksum });
  }

  private async deleteKeysBefore(cutoff: string): Promise<Result<void, UnifiedError>> {
    const keys = await this.readJsonDirectoryEntries(this.usagePath("keys"));
    if (!keys.ok) return keys as Result<void, UnifiedError>;
    for (const entry of keys.value) {
      const localDate = stringField(entry.value, "localDate");
      if (localDate.length === 0 || localDate >= cutoff) continue;
      const removed = await this.removeFile(entry.path);
      if (!removed.ok) return removed;
    }
    return ok(undefined);
  }

  private async readJsonDirectoryEntries(
    path: string
  ): Promise<
    Result<readonly { readonly path: string; readonly value: JsonObject }[], UnifiedError>
  > {
    try {
      const entries = await readdir(path, { withFileTypes: true });
      const values: Array<{ readonly path: string; readonly value: JsonObject }> = [];
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const entryPath = join(path, entry.name);
        const value = await this.readJson(entryPath);
        if (!value.ok)
          return value as Result<
            readonly { readonly path: string; readonly value: JsonObject }[],
            UnifiedError
          >;
        if (value.value !== undefined) values.push({ path: entryPath, value: value.value });
      }
      return ok(values);
    } catch (error) {
      return isMissingFileError(error)
        ? ok([])
        : err(this.storageFailure("AGENT_USAGE_READ_FAILED", error));
    }
  }

  private async removeFile(path: string): Promise<Result<void, UnifiedError>> {
    try {
      await unlink(path);
      return ok(undefined);
    } catch (error) {
      return isMissingFileError(error)
        ? ok(undefined)
        : err(this.storageFailure("AGENT_USAGE_WRITE_FAILED", error));
    }
  }

  private detailPath(usageId: string): string {
    return this.usagePath(join("details", `${usageFileName(usageId)}.json`));
  }

  private keyPath(key: string): string {
    return this.usagePath(join("keys", `${key}.json`));
  }

  private clearedKeyPath(key: string): string {
    const keyHash = createHash("sha256").update(key).digest("hex");
    return this.usagePath(join("cleared-keys", `${keyHash}.json`));
  }

  private aggregatePath(localDate: string): string {
    return this.usagePath(join("aggregates", `${localDate}.json`));
  }

  private clearCommandPath(commandId: string): string {
    return this.usagePath(join("clear-commands", `${commandId}.json`));
  }

  private usagePath(suffix: string): string {
    return join(this.options.userDataRoot, "agent-usage", suffix);
  }

  private runMetricsPath(usageId: string): string {
    const fileName = createHash("sha256").update(usageId, "utf8").digest("hex");
    return this.usagePath(join("run-metrics-v2", `${fileName}.json`));
  }

  private async writeJson(
    path: string,
    value: JsonObject
  ): Promise<Result<JsonObject, UnifiedError>> {
    try {
      await mkdir(dirname(path), { recursive: true });
      const written = await writeTextAtomically({
        targetPath: path,
        content: `${JSON.stringify(value, null, 2)}\n`,
        traceId: this.traceId
      });
      return written.ok ? ok(value) : written;
    } catch (error) {
      return err(this.storageFailure("AGENT_USAGE_WRITE_FAILED", error));
    }
  }

  private async readJson(path: string): Promise<Result<JsonObject | undefined, UnifiedError>> {
    try {
      const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
      return isJsonObject(parsed) ? ok(parsed) : this.invalid("AGENT_USAGE_RECORD_INVALID");
    } catch (error) {
      return isMissingFileError(error)
        ? ok(undefined)
        : err(this.storageFailure("AGENT_USAGE_READ_FAILED", error));
    }
  }

  private invalid(code: string): { readonly ok: false; readonly error: UnifiedError } {
    return err(
      storageError({
        code,
        message: "Agent usage record is invalid.",
        suggestedAction: "Discard the invalid usage record and retry.",
        traceId: this.traceId
      })
    );
  }

  private redactionRequired(field: string): UnifiedError {
    return storageError({
      code: "AGENT_USAGE_RECORD_REDACTION_REQUIRED",
      message: "The Agent usage record contains content that must be redacted before storage.",
      suggestedAction:
        "Remove prompt text, file contents, paths, and credentials from the usage record.",
      traceId: this.traceId,
      redactedDetail: { field }
    });
  }

  private queryInvalid(field: string): UnifiedError {
    return storageError({
      code: "AGENT_USAGE_QUERY_INVALID",
      message: "The Agent usage query is invalid or exceeds its bounded date range.",
      suggestedAction: "Use ISO local dates and an inclusive range no longer than 365 days.",
      traceId: this.traceId,
      redactedDetail: { field }
    });
  }

  private recordConflict(): UnifiedError {
    return storageError({
      code: "AGENT_USAGE_RECORD_CONFLICT",
      message: "The Agent usage record conflicts with the immutable first-written record.",
      suggestedAction: "Keep the original final usage record and discard the conflicting replay.",
      traceId: this.traceId
    });
  }

  private clearPending(commandId: string): UnifiedError {
    return storageError({
      code: "AGENT_USAGE_CLEAR_PENDING",
      message: "Agent usage cannot be recorded while a clear command is pending.",
      suggestedAction: "Retry the pending clear command before recording usage for this date.",
      traceId: this.traceId,
      redactedDetail: { commandId }
    });
  }

  private storageFailure(code: string, error: unknown): UnifiedError {
    return storageError({
      code,
      message: "Agent usage data could not be persisted.",
      suggestedAction: "Check local application data permissions and retry.",
      traceId: this.traceId,
      redactedDetail: {
        reason:
          typeof error === "object" && error !== null && "code" in error
            ? String(error.code)
            : error instanceof Error
              ? error.name
              : "UnknownError"
      }
    });
  }
}

function idempotencyKey(record: JsonObject): string {
  return `${String(record["runId"])}__${String(record["roundId"])}__${String(record["finalSequence"])}`;
}

function usageContentChecksum(record: JsonObject): string {
  return createHash("sha256").update(stableJson(record)).digest("hex");
}

function stableJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!isJsonObject(value)) return "null";
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(",")}}`;
}

function validateUsageRecord(record: JsonObject): Result<JsonObject, UnifiedError> {
  let normalized: AgentUsageRecord;
  try {
    normalized = normalizeAgentUsageRecord(record);
  } catch {
    return validationError("schemaVersion");
  }
  const candidate = normalized as unknown as JsonObject;
  const runId = candidate["runId"];
  const roundId = candidate["roundId"];
  const conversationId = candidate["conversationId"];
  const scope = candidate["scope"];
  const usageId = candidate["usageId"];
  if (
    typeof runId !== "string" ||
    !isSafeId(runId) ||
    typeof roundId !== "string" ||
    !isSafeId(roundId) ||
    typeof conversationId !== "string" ||
    !isSafeId(conversationId, true) ||
    !isAgentContextScope(scope) ||
    typeof usageId !== "string" ||
    !isSafeUsageId(usageId)
  ) {
    return validationError("identity");
  }
  const terminationReason = candidate["terminationReason"];
  if (
    !isBoundedIdentifier(candidate["provider"], false) ||
    !isBoundedIdentifier(candidate["model"], false) ||
    typeof terminationReason !== "string" ||
    !TERMINATION_REASONS.has(terminationReason)
  ) {
    return validationError("record scalar");
  }
  if (usageId !== `${runId}:${roundId}:${String(candidate["finalSequence"])}`) {
    return validationError("usageId");
  }
  if (!isLocalDate(candidate["localDate"]) || !isUtcIsoTimestamp(candidate["timestamp"])) {
    return validationError("timestamp");
  }
  if (!isIanaTimezone(candidate["timezone"])) return validationError("timezone");
  if (
    typeof candidate["utcOffsetMinutes"] !== "number" ||
    !Number.isInteger(candidate["utcOffsetMinutes"]) ||
    Math.abs(candidate["utcOffsetMinutes"]) > 900
  ) {
    return validationError("utcOffsetMinutes");
  }
  const cost = candidate["cost"];
  const costStatus = isJsonObject(cost) ? cost["status"] : undefined;
  if (
    !isJsonObject(cost) ||
    !hasOnlyFields(cost, COST_FIELDS) ||
    typeof cost["amount"] !== "number" ||
    !Number.isFinite(cost["amount"]) ||
    cost["amount"] < 0 ||
    !isBoundedIdentifier(cost["currency"], true) ||
    typeof costStatus !== "string" ||
    !COST_STATUSES.has(costStatus)
  ) {
    return validationError("cost.amount");
  }
  const pricingVersion = candidate["pricingVersion"];
  if (pricingVersion !== null && !isBoundedIdentifier(pricingVersion, false)) {
    return validationError("pricingVersion");
  }
  const unitPrices = candidate["unitPrices"];
  if (unitPrices !== null) {
    if (
      !isJsonObject(unitPrices) ||
      !hasOnlyFields(unitPrices, UNIT_PRICE_FIELDS) ||
      !isUnitPriceScalar(unitPrices["inputPerMillion"]) ||
      !isUnitPriceScalar(unitPrices["outputPerMillion"]) ||
      !isBoundedIdentifier(unitPrices["currency"], false) ||
      (unitPrices["cacheReadPerMillion"] !== undefined &&
        !isUnitPriceScalar(unitPrices["cacheReadPerMillion"])) ||
      (unitPrices["cacheWritePerMillion"] !== undefined &&
        !isUnitPriceScalar(unitPrices["cacheWritePerMillion"])) ||
      (unitPrices["reasoningPerMillion"] !== undefined &&
        !isUnitPriceScalar(unitPrices["reasoningPerMillion"]))
    ) {
      return validationError("unitPrices");
    }
  }
  const domain = validateAgentUsageRecord(normalized);
  return domain.ok ? ok(candidate) : err(domain.error);
}

const RUN_METRICS_FIELDS = new Set([
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
const SOURCE_METRIC_FIELDS = new Set(["sourceKind", "tokenCount", "truncated", "exclusionReason"]);
const STYLE_METRIC_FIELDS = new Set(["rule", "version", "confidence", "userOutcome"]);
const METRIC_PROFILES = new Set(["standalone", "writing", "creative_general", "engineering"]);
const METRIC_RUN_OUTCOMES = new Set([
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
const METRIC_PENDING_OUTCOMES = new Set([
  "none",
  "awaiting_approval",
  "awaiting_input",
  "change_set_pending",
  "recovery_pending"
]);
const METRIC_RECOVERY_OUTCOMES = new Set([
  "not_required",
  "pending",
  "recovered",
  "rolled_back",
  "failed",
  "outcome_unknown"
]);
const METRIC_CHANGE_SET_OUTCOMES = new Set([
  "none",
  "generated",
  "approved",
  "rejected",
  "applied",
  "rolled_back",
  "undone",
  "stale"
]);
const METRIC_SOURCE_KINDS = new Set([
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
const METRIC_EXCLUSION_REASONS = new Set([
  "none",
  "user_excluded",
  "budget",
  "policy",
  "stale",
  "unsupported"
]);
const METRIC_STYLE_OUTCOMES = new Set(["accepted", "ignored", "dismissed", "no_action"]);

function validateRunMetricsRecord(record: JsonObject): Result<JsonObject, UnifiedError> {
  if (
    !hasOnlyFields(record, RUN_METRICS_FIELDS) ||
    record["schemaVersion"] !== "2.0" ||
    record["storageScope"] !== "local_only" ||
    !isSafeMetricRef(record["usageId"]) ||
    !isSafeMetricRef(record["runId"]) ||
    !isUtcIsoTimestamp(record["recordedAt"]) ||
    typeof record["semanticVersionSetChecksum"] !== "string" ||
    !/^[a-f0-9]{64}$/u.test(record["semanticVersionSetChecksum"]) ||
    record["guidanceVersion"] !== "3.0" ||
    !METRIC_PROFILES.has(String(record["contextProfileId"])) ||
    record["messageOrderVersion"] !== "2.0" ||
    record["toolCatalogVersion"] !== "2.0" ||
    !METRIC_RUN_OUTCOMES.has(String(record["runOutcome"])) ||
    !METRIC_PENDING_OUTCOMES.has(String(record["pendingOutcome"])) ||
    !METRIC_RECOVERY_OUTCOMES.has(String(record["recoveryOutcome"])) ||
    !isMetricCount(record["modelRoundCount"]) ||
    !isMetricCount(record["toolCallCount"]) ||
    !isMetricCount(record["toolFailureCount"]) ||
    record["toolFailureCount"] > record["toolCallCount"] ||
    !isMetricCount(record["approvalWaitCount"]) ||
    !isMetricCount(record["approvalWaitMs"]) ||
    !Array.isArray(record["sources"]) ||
    record["sources"].length > 256 ||
    !new Set(["hit", "miss", "bypass", "unknown"]).has(String(record["cacheOutcome"])) ||
    (record["cacheVerifiedInputTokens"] !== null &&
      !isMetricCount(record["cacheVerifiedInputTokens"])) ||
    ((record["cacheOutcome"] === "unknown" || record["cacheOutcome"] === "bypass") &&
      record["cacheVerifiedInputTokens"] !== null) ||
    !METRIC_CHANGE_SET_OUTCOMES.has(String(record["changeSetOutcome"])) ||
    !Array.isArray(record["styleObservations"]) ||
    record["styleObservations"].length > 256 ||
    !Array.isArray(record["eventRefs"]) ||
    record["eventRefs"].length > 1024
  ) {
    return runMetricsValidationError("record");
  }
  for (const source of record["sources"]) {
    if (
      !isJsonObject(source) ||
      !hasOnlyFields(source, SOURCE_METRIC_FIELDS) ||
      !METRIC_SOURCE_KINDS.has(String(source["sourceKind"])) ||
      !isMetricCount(source["tokenCount"]) ||
      typeof source["truncated"] !== "boolean" ||
      !METRIC_EXCLUSION_REASONS.has(String(source["exclusionReason"])) ||
      (source["exclusionReason"] !== "none" &&
        (source["tokenCount"] !== 0 || source["truncated"] !== false))
    ) {
      return runMetricsValidationError("sources");
    }
  }
  for (const observation of record["styleObservations"]) {
    if (
      !isJsonObject(observation) ||
      !hasOnlyFields(observation, STYLE_METRIC_FIELDS) ||
      !isSafeMetricRef(observation["rule"]) ||
      typeof observation["version"] !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._@-]{0,127}$/u.test(observation["version"]) ||
      typeof observation["confidence"] !== "number" ||
      !Number.isFinite(observation["confidence"]) ||
      observation["confidence"] < 0 ||
      observation["confidence"] > 1 ||
      !METRIC_STYLE_OUTCOMES.has(String(observation["userOutcome"]))
    ) {
      return runMetricsValidationError("styleObservations");
    }
  }
  const refs = record["eventRefs"];
  if (!refs.every(isSafeMetricRef) || new Set(refs).size !== refs.length) {
    return runMetricsValidationError("eventRefs");
  }
  return ok(record);
}

function assertRunMetricsRedacted(record: JsonObject): string | undefined {
  for (const field of Object.keys(record)) {
    if (!RUN_METRICS_FIELDS.has(field)) return `${field}:forbidden_field`;
  }
  return scanSensitiveValue(record, "record");
}

function isSafeMetricRef(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,255}$/u.test(value) &&
    !/^sk-[A-Za-z0-9]/iu.test(value) &&
    !/^bearer[._:@-]/iu.test(value)
  );
}

function isMetricCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function runMetricsValidationError(field: string): {
  readonly ok: false;
  readonly error: UnifiedError;
} {
  return err(
    storageError({
      code: "AGENT_USAGE_RECORD_V20_INVALID",
      message: "The local Agent run metrics record is invalid.",
      suggestedAction: "Discard the unrecognized or content-bearing metrics record.",
      traceId: "agent-usage-file-repository",
      redactedDetail: { field }
    })
  );
}

const ABSOLUTE_PATH = /(^|[\s"'([])(\/[^\s"']|[A-Za-z]:[\\/])/;
const CREDENTIAL = /\b(authorization|bearer|api[_-]?key|secret|password)\b|\bsk-[A-Za-z0-9]/i;
const COST_FIELDS = new Set(["amount", "currency", "status"]);
const UNIT_PRICE_FIELDS = new Set([
  "inputPerMillion",
  "outputPerMillion",
  "cacheReadPerMillion",
  "cacheWritePerMillion",
  "reasoningPerMillion",
  "currency"
]);
const LEGACY_UNIT_PRICE_FIELDS = new Set([...UNIT_PRICE_FIELDS, "cachedPerMillion"]);

function assertRedacted(record: JsonObject): string | undefined {
  for (const field of Object.keys(record)) {
    if (!ALLOWED_USAGE_FIELDS.has(field)) return `${field}:forbidden_field`;
  }
  const cost = record["cost"];
  if (isJsonObject(cost)) {
    for (const field of Object.keys(cost)) {
      if (!COST_FIELDS.has(field)) return `cost.${field}:forbidden_field`;
    }
  }
  const unitPrices = record["unitPrices"];
  if (isJsonObject(unitPrices)) {
    const allowedUnitPriceFields =
      record["schemaVersion"] === "1.0" || record["schemaVersion"] === "1.1"
        ? LEGACY_UNIT_PRICE_FIELDS
        : UNIT_PRICE_FIELDS;
    for (const field of Object.keys(unitPrices)) {
      if (!allowedUnitPriceFields.has(field)) return `unitPrices.${field}:forbidden_field`;
    }
  }
  return scanSensitiveValue(record, "record");
}

function scanSensitiveValue(value: unknown, field: string): string | undefined {
  if (typeof value === "string") {
    if (ABSOLUTE_PATH.test(value)) return `${field}:absolute_path`;
    if (CREDENTIAL.test(value)) return `${field}:credential`;
    return undefined;
  }
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      const leaked = scanSensitiveValue(entry, `${field}[${String(index)}]`);
      if (leaked !== undefined) return leaked;
    }
    return undefined;
  }
  if (!isJsonObject(value)) return undefined;
  for (const [key, entry] of Object.entries(value)) {
    const leaked = scanSensitiveValue(entry, `${field}.${key}`);
    if (leaked !== undefined) return leaked;
  }
  return undefined;
}

function numberField(value: JsonObject, key: string): number {
  const candidate = value[key];
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : 0;
}

function hasOnlyFields(value: object, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((field) => allowed.has(field));
}

function validationError(field: string): { readonly ok: false; readonly error: UnifiedError } {
  return err(
    storageError({
      code: "AGENT_USAGE_RECORD_INVALID",
      message: "The Agent usage record contains an invalid token, budget, or identity field.",
      suggestedAction: "Record only finite, non-negative token counts and safe identifiers.",
      traceId: "agent-usage-file-repository",
      redactedDetail: { field }
    })
  );
}

function isSafeId(value: string, allowEmpty = false): boolean {
  return value.length <= 128 && (allowEmpty || value.length > 0) && /^[A-Za-z0-9_-]*$/.test(value);
}

function isSafeUsageId(value: string): boolean {
  return value.length <= 300 && /^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:\d+$/.test(value);
}

function usageFileName(usageId: string): string {
  return usageId.replaceAll(":", "%3A");
}

const ALLOWED_USAGE_FIELDS = new Set([
  "schemaVersion",
  "scope",
  "usageId",
  "runId",
  "conversationId",
  // Legacy 1.0 read compatibility; new writes are required to use schema 1.2.
  "projectId",
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

const TERMINATION_REASONS = new Set(["stop", "tool_calls", "context_compaction", "compaction"]);
const COST_STATUSES = new Set(["actual", "estimated", "unknown"]);

function isBoundedScalar(value: unknown, allowEmpty: boolean): value is string {
  return (
    typeof value === "string" &&
    value.length <= 256 &&
    (allowEmpty || value.length > 0) &&
    !hasAsciiControlCharacter(value)
  );
}

function hasAsciiControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}

function isBoundedIdentifier(value: unknown, allowEmpty: boolean): value is string {
  return isBoundedScalar(value, allowEmpty) && /^[A-Za-z0-9._:/-]*$/u.test(value);
}

function isUnitPriceScalar(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validateQuery(
  query: AgentUsageRepositoryQuery,
  requireDetailDate: boolean
): { readonly ok: true } | { readonly ok: false; readonly field: string } {
  const range = validateDateRange(query.range);
  if (!range.ok) return range;
  if (requireDetailDate && query.detailLocalDate !== undefined) {
    if (
      !isLocalDate(query.detailLocalDate) ||
      query.detailLocalDate < query.range.fromLocalDate ||
      query.detailLocalDate > query.range.toLocalDate
    ) {
      return { ok: false, field: "detailLocalDate" };
    }
  }
  for (const [field, value] of [
    ["provider", query.provider],
    ["model", query.model],
    ["projectId", query.projectId]
  ] as const) {
    if (value !== undefined && (value.length === 0 || value.length > 256)) {
      return { ok: false, field };
    }
  }
  return { ok: true };
}

function validateDateRange(
  range: AgentUsageRepositoryDateRange
): { readonly ok: true } | { readonly ok: false; readonly field: string } {
  if (!isLocalDate(range.fromLocalDate) || !isLocalDate(range.toLocalDate)) {
    return { ok: false, field: "range" };
  }
  const from = localDateEpochDay(range.fromLocalDate);
  const to = localDateEpochDay(range.toLocalDate);
  if (to < from || to - from > 364) return { ok: false, field: "range" };
  return { ok: true };
}

function matchesQuery(record: JsonObject, query: AgentUsageRepositoryQuery): boolean {
  const localDate = stringField(record, "localDate");
  return (
    localDate >= query.range.fromLocalDate &&
    localDate <= query.range.toLocalDate &&
    (query.provider === undefined || record["provider"] === query.provider) &&
    (query.model === undefined || record["model"] === query.model) &&
    (query.projectId === undefined || usageProjectId(record) === query.projectId)
  );
}

function toRunSummary(record: JsonObject): AgentUsageRepositoryRunSummary {
  const cost = isJsonObject(record["cost"]) ? record["cost"] : {};
  const scope = usageScope(record);
  const projectId = usageProjectId(record);
  const cacheRead = optionalTokenField(record, "cacheReadTokens");
  const cacheWrite = optionalTokenField(record, "cacheWriteTokens");
  const cacheEligible = optionalTokenField(record, "cacheEligibleInputTokens");
  const cacheHitRate = cacheHitRateForRecord(record);
  const estimatedCacheSavings = estimateCacheSavings(record);
  const bypassReason = cacheBypassReason(record["cacheBypassReason"]);
  return {
    scope,
    usageId: stringField(record, "usageId"),
    runId: stringField(record, "runId"),
    conversationId: stringField(record, "conversationId"),
    ...(projectId === undefined ? {} : { projectId }),
    provider: stringField(record, "provider"),
    model: stringField(record, "model"),
    totalTokens: numberField(record, "totalTokens"),
    ...(cacheRead === undefined ? {} : { cacheReadTokens: cacheRead }),
    ...(cacheWrite === undefined ? {} : { cacheWriteTokens: cacheWrite }),
    ...(cacheEligible === undefined ? {} : { cacheEligibleInputTokens: cacheEligible }),
    ...(cacheHitRate === undefined ? {} : { cacheHitRate }),
    cacheOutcome: cacheOutcome(record["cacheOutcome"]),
    ...(bypassReason === undefined ? {} : { cacheBypassReason: bypassReason }),
    cacheUsageStatus: cacheUsageStatus(record["cacheUsageStatus"]),
    cacheInputTokenSemantics: cacheInputTokenSemantics(record["cacheInputTokenSemantics"]),
    cacheMode: cacheMode(record["cacheMode"]),
    cachePrefixChecksum: cachePrefixChecksum(record["cachePrefixChecksum"]),
    ...(estimatedCacheSavings === undefined ? {} : { estimatedCacheSavings }),
    usageStatus: usageStatus(record["usageStatus"]),
    cost: {
      amount: numberField(cost, "amount"),
      currency: stringField(cost, "currency"),
      status: costStatus(cost["status"])
    },
    timestamp: stringField(record, "timestamp")
  };
}

function createAggregateDimension(record: JsonObject): JsonObject {
  const cost = isJsonObject(record["cost"]) ? record["cost"] : {};
  const status = costStatus(cost["status"]);
  const cacheHitRate = cacheHitRateForRecord(record);
  const cacheShare = cacheShareMetrics(record);
  const estimatedCacheSavings = estimateCacheSavings(record);
  return {
    usageId: stringField(record, "usageId"),
    scope: usageScope(record),
    provider: stringField(record, "provider"),
    model: stringField(record, "model"),
    recordCount: 1,
    inputTokens: numberField(record, "inputTokens"),
    outputTokens: numberField(record, "outputTokens"),
    // `cachedTokens` remains a compatibility alias for cache reads only.
    cachedTokens: cacheReadTokens(record),
    cacheReadTokens: cacheReadTokens(record),
    cacheWriteTokens: cacheWriteTokens(record),
    cacheEligibleInputTokens: cacheEligibleInputTokens(record),
    cacheShareReadTokens: cacheShare.shareReadTokens,
    cacheTelemetryComparableInputTokens: cacheShare.telemetryComparableInputTokens,
    cacheComparableInputTokens: cacheShare.comparableInputTokens,
    cacheHitRateAvailable: cacheHitRate !== undefined,
    reasoningTokens: numberField(record, "reasoningTokens"),
    totalTokens: numberField(record, "totalTokens"),
    currency: status === "unknown" ? "" : stringField(cost, "currency"),
    actualAmount: status === "actual" ? numberField(cost, "amount") : 0,
    estimatedAmount: status === "estimated" ? numberField(cost, "amount") : 0,
    hasUnknownCost: status === "unknown",
    ...(estimatedCacheSavings === undefined
      ? {}
      : { estimatedCacheSavings: estimatedCacheSavings.amount })
  };
}

const retainedAggregateBaseTokenFields = [
  "recordCount",
  "inputTokens",
  "outputTokens",
  "cachedTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "cacheEligibleInputTokens",
  "reasoningTokens",
  "totalTokens"
] as const;

const retainedAggregateV2TokenFields = [
  "cacheShareReadTokens",
  "cacheTelemetryComparableInputTokens",
  "cacheComparableInputTokens"
] as const;

function isValidRetainedAggregate(value: unknown, expectedDate: string): value is JsonObject {
  if (!isJsonObject(value) || !isLocalDate(expectedDate) || value["localDate"] !== expectedDate) {
    return false;
  }
  const schemaVersion = value["schemaVersion"];
  if (schemaVersion !== "1.0" && schemaVersion !== "2.0") return false;
  if (
    typeof value["timezone"] !== "string" ||
    !isFiniteNumber(value["utcOffsetMinutes"]) ||
    (value["hasUnknownCost"] !== true && value["hasUnknownCost"] !== false) ||
    !retainedAggregateBaseTokenFields.every((field) => isTokenCount(value[field])) ||
    (schemaVersion === "2.0" &&
      !retainedAggregateV2TokenFields.every((field) => isTokenCount(value[field]))) ||
    !Array.isArray(value["costs"]) ||
    !value["costs"].every(isValidAggregateCost) ||
    !Array.isArray(value["dimensions"]) ||
    !value["dimensions"].every((dimension) => isValidAggregateDimension(dimension, schemaVersion))
  ) {
    return false;
  }
  const recordCount = value["recordCount"];
  if (!isTokenCount(recordCount) || recordCount === 0) return false;
  const dimensions = value["dimensions"];
  return (
    (dimensions.length === 0 || dimensions.length === recordCount) &&
    (schemaVersion === "1.0" || dimensions.length === recordCount)
  );
}

function isValidAggregateCost(value: unknown): boolean {
  return (
    isJsonObject(value) &&
    typeof value["currency"] === "string" &&
    isNonNegativeFiniteNumber(value["actualAmount"]) &&
    isNonNegativeFiniteNumber(value["estimatedAmount"]) &&
    (value["estimatedCacheSavings"] === undefined || isFiniteNumber(value["estimatedCacheSavings"]))
  );
}

function isValidAggregateDimension(value: unknown, schemaVersion: "1.0" | "2.0"): boolean {
  if (
    !isJsonObject(value) ||
    typeof value["usageId"] !== "string" ||
    value["usageId"].length === 0 ||
    typeof value["provider"] !== "string" ||
    value["provider"].length === 0 ||
    typeof value["model"] !== "string" ||
    value["model"].length === 0 ||
    (!isAgentContextScope(value["scope"]) && !isValidLegacyProjectId(value["projectId"])) ||
    typeof value["currency"] !== "string" ||
    (value["cacheHitRateAvailable"] !== true && value["cacheHitRateAvailable"] !== false) ||
    (value["hasUnknownCost"] !== true && value["hasUnknownCost"] !== false) ||
    !retainedAggregateBaseTokenFields.every((field) => isTokenCount(value[field])) ||
    value["recordCount"] !== 1 ||
    !isNonNegativeFiniteNumber(value["actualAmount"]) ||
    !isNonNegativeFiniteNumber(value["estimatedAmount"]) ||
    (value["estimatedCacheSavings"] !== undefined &&
      !isFiniteNumber(value["estimatedCacheSavings"]))
  ) {
    return false;
  }
  return (
    schemaVersion === "1.0" ||
    retainedAggregateV2TokenFields.every((field) => isTokenCount(value[field]))
  );
}

function isValidLegacyProjectId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}

function isTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function projectAggregate(
  aggregate: JsonObject,
  query: AgentUsageRepositoryQuery
): AgentUsageRepositoryDailyBucket | undefined {
  const allDimensions = jsonObjectArray(aggregate["dimensions"]);
  const filtered = allDimensions.filter(
    (dimension) =>
      (query.provider === undefined || dimension["provider"] === query.provider) &&
      (query.model === undefined || dimension["model"] === query.model) &&
      (query.projectId === undefined || usageProjectId(dimension) === query.projectId)
  );
  const hasFilters =
    query.provider !== undefined || query.model !== undefined || query.projectId !== undefined;
  if (hasFilters && filtered.length === 0) return undefined;
  if (allDimensions.length === 0 && !hasFilters) {
    const cacheRead = optionalTokenField(aggregate, "cacheReadTokens");
    const cacheShareRead = optionalTokenField(aggregate, "cacheShareReadTokens");
    const cacheTelemetryComparable = optionalTokenField(
      aggregate,
      "cacheTelemetryComparableInputTokens"
    );
    const cacheComparable = optionalTokenField(aggregate, "cacheComparableInputTokens");
    return {
      localDate: stringField(aggregate, "localDate"),
      recordCount: numberField(aggregate, "recordCount"),
      inputTokens: numberField(aggregate, "inputTokens"),
      outputTokens: numberField(aggregate, "outputTokens"),
      cachedTokens: cacheRead ?? numberField(aggregate, "cachedTokens"),
      cacheReadTokens: cacheRead ?? numberField(aggregate, "cachedTokens"),
      cacheWriteTokens: numberField(aggregate, "cacheWriteTokens"),
      cacheEligibleInputTokens: numberField(aggregate, "cacheEligibleInputTokens"),
      ...(cacheShareRead === undefined ? {} : { cacheShareReadTokens: cacheShareRead }),
      ...(cacheTelemetryComparable === undefined
        ? {}
        : { cacheTelemetryComparableInputTokens: cacheTelemetryComparable }),
      ...(cacheComparable === undefined ? {} : { cacheComparableInputTokens: cacheComparable }),
      reasoningTokens: numberField(aggregate, "reasoningTokens"),
      totalTokens: numberField(aggregate, "totalTokens"),
      costs: costTotals(jsonObjectArray(aggregate["costs"])),
      hasUnknownCost: aggregate["hasUnknownCost"] === true,
      ...(query.includeModelBreakdown === true ? { models: [] } : {})
    };
  }
  const cacheHitRate = cacheHitRateForDimensions(filtered);
  return {
    localDate: stringField(aggregate, "localDate"),
    recordCount: sumField(filtered, "recordCount"),
    inputTokens: sumField(filtered, "inputTokens"),
    outputTokens: sumField(filtered, "outputTokens"),
    cachedTokens: sumField(filtered, "cachedTokens"),
    cacheReadTokens: sumCacheReadTokens(filtered),
    cacheWriteTokens: sumField(filtered, "cacheWriteTokens"),
    cacheEligibleInputTokens: sumField(filtered, "cacheEligibleInputTokens"),
    cacheShareReadTokens: sumField(filtered, "cacheShareReadTokens"),
    cacheTelemetryComparableInputTokens: sumField(filtered, "cacheTelemetryComparableInputTokens"),
    cacheComparableInputTokens: sumField(filtered, "cacheComparableInputTokens"),
    ...(cacheHitRate === undefined ? {} : { cacheHitRate }),
    reasoningTokens: sumField(filtered, "reasoningTokens"),
    totalTokens: sumField(filtered, "totalTokens"),
    costs: costTotals(mergeDimensionCosts(filtered)),
    hasUnknownCost: filtered.some((dimension) => dimension["hasUnknownCost"] === true),
    ...(query.includeModelBreakdown === true ? { models: aggregateModels(filtered) } : {})
  };
}

function usageScope(record: JsonObject): AgentContextScope {
  if (isAgentContextScope(record["scope"])) return record["scope"];
  const projectId = stringField(record, "projectId");
  return {
    kind: "workspace",
    workspaceKind: "creativeProject",
    workspaceId: projectId
  };
}

function usageProjectId(record: JsonObject): string | undefined {
  const scope = record["scope"];
  if (isAgentContextScope(scope)) return scope.kind === "workspace" ? scope.workspaceId : undefined;
  const legacyProjectId = stringField(record, "projectId");
  return legacyProjectId.length === 0 ? undefined : legacyProjectId;
}

function aggregateModels(
  dimensions: readonly JsonObject[]
): readonly { readonly provider: string; readonly model: string; readonly totalTokens: number }[] {
  const totals = new Map<string, { provider: string; model: string; totalTokens: number }>();
  for (const dimension of dimensions) {
    const provider = stringField(dimension, "provider");
    const model = stringField(dimension, "model");
    const key = `${provider}\u0000${model}`;
    const prior = totals.get(key) ?? { provider, model, totalTokens: 0 };
    prior.totalTokens += numberField(dimension, "totalTokens");
    totals.set(key, prior);
  }
  return [...totals.values()].sort(
    (left, right) => right.totalTokens - left.totalTokens || left.model.localeCompare(right.model)
  );
}

function mergeDimensionCosts(dimensions: readonly JsonObject[]): JsonObject[] {
  const totals = new Map<
    string,
    { actualAmount: number; estimatedAmount: number; estimatedCacheSavings?: number }
  >();
  for (const dimension of dimensions) {
    const currency = stringField(dimension, "currency");
    if (currency.length === 0) continue;
    const prior = totals.get(currency) ?? { actualAmount: 0, estimatedAmount: 0 };
    prior.actualAmount += numberField(dimension, "actualAmount");
    prior.estimatedAmount += numberField(dimension, "estimatedAmount");
    const estimatedCacheSavings = optionalNumberField(dimension, "estimatedCacheSavings");
    if (estimatedCacheSavings !== undefined) {
      prior.estimatedCacheSavings = (prior.estimatedCacheSavings ?? 0) + estimatedCacheSavings;
    }
    totals.set(currency, prior);
  }
  return [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, amounts]) => ({
      currency,
      actualAmount: amounts.actualAmount,
      estimatedAmount: amounts.estimatedAmount,
      ...(amounts.estimatedCacheSavings === undefined
        ? {}
        : { estimatedCacheSavings: amounts.estimatedCacheSavings })
    }));
}

function costTotals(costs: readonly JsonObject[]): readonly AgentUsageRepositoryCostTotal[] {
  return costs.map((cost) => {
    const estimatedCacheSavings = optionalNumberField(cost, "estimatedCacheSavings");
    return {
      currency: stringField(cost, "currency"),
      actualAmount: numberField(cost, "actualAmount"),
      estimatedAmount: numberField(cost, "estimatedAmount"),
      ...(estimatedCacheSavings === undefined ? {} : { estimatedCacheSavings })
    };
  });
}

function sumField(values: readonly JsonObject[], field: string): number {
  return values.reduce((total, value) => total + numberField(value, field), 0);
}

function sumCacheReadTokens(values: readonly JsonObject[]): number {
  return values.reduce((total, value) => total + cacheReadTokens(value), 0);
}

function jsonObjectArray(value: unknown): readonly JsonObject[] {
  return Array.isArray(value) ? value.filter(isJsonObject) : [];
}

function stringField(value: JsonObject, key: string): string {
  return typeof value[key] === "string" ? value[key] : "";
}

function optionalNumberField(value: JsonObject, key: string): number | undefined {
  const candidate = value[key];
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : undefined;
}

function optionalTokenField(value: JsonObject, key: string): number | undefined {
  const candidate = optionalNumberField(value, key);
  return candidate !== undefined && candidate >= 0 ? candidate : undefined;
}

function cacheReadTokens(record: JsonObject): number {
  return (
    optionalTokenField(record, "cacheReadTokens") ?? optionalTokenField(record, "cachedTokens") ?? 0
  );
}

function cacheWriteTokens(record: JsonObject): number {
  return optionalTokenField(record, "cacheWriteTokens") ?? 0;
}

function cacheEligibleInputTokens(record: JsonObject): number {
  return optionalTokenField(record, "cacheEligibleInputTokens") ?? 0;
}

interface CacheShareMetrics {
  readonly shareReadTokens: number;
  readonly telemetryComparableInputTokens: number;
  readonly comparableInputTokens: number;
}

function cacheShareMetrics(record: JsonObject): CacheShareMetrics {
  const semantics = cacheInputTokenSemantics(record["cacheInputTokenSemantics"]);
  const inputTokens = optionalTokenField(record, "inputTokens");
  if (semantics === "unavailable" || inputTokens === undefined) {
    return { shareReadTokens: 0, telemetryComparableInputTokens: 0, comparableInputTokens: 0 };
  }
  const readTokens =
    optionalTokenField(record, "cacheReadTokens") ?? optionalTokenField(record, "cachedTokens");
  const writeTokens = optionalTokenField(record, "cacheWriteTokens");
  // Providers that exclude cache tokens from input require both read and write counts to recover
  // the complete comparable input denominator. Included semantics only require the regular input.
  const denominator =
    semantics === "included_in_input"
      ? inputTokens
      : readTokens === undefined || writeTokens === undefined
        ? undefined
        : inputTokens + readTokens + writeTokens;
  if (denominator === undefined) {
    return { shareReadTokens: 0, telemetryComparableInputTokens: 0, comparableInputTokens: 0 };
  }
  const telemetry =
    cacheUsageStatus(record["cacheUsageStatus"]) === "actual" && readTokens !== undefined
      ? { shareReadTokens: readTokens, telemetryComparableInputTokens: denominator }
      : { shareReadTokens: 0, telemetryComparableInputTokens: 0 };
  return {
    ...telemetry,
    comparableInputTokens: denominator
  };
}

function cacheHitRateForRecord(record: JsonObject): number | undefined {
  if (
    cacheUsageStatus(record["cacheUsageStatus"]) !== "actual" ||
    cacheInputTokenSemantics(record["cacheInputTokenSemantics"]) === "unavailable"
  ) {
    return undefined;
  }
  const cacheRead = optionalTokenField(record, "cacheReadTokens");
  const cacheEligible = optionalTokenField(record, "cacheEligibleInputTokens");
  return cacheRead === undefined ||
    cacheEligible === undefined ||
    cacheEligible <= 0 ||
    cacheRead > cacheEligible
    ? undefined
    : cacheRead / cacheEligible;
}

function cacheHitRateForDimensions(dimensions: readonly JsonObject[]): number | undefined {
  if (dimensions.length === 0) return undefined;
  let cacheRead = 0;
  let cacheEligible = 0;
  for (const dimension of dimensions) {
    if (dimension["cacheHitRateAvailable"] !== true) return undefined;
    const read = optionalTokenField(dimension, "cacheReadTokens");
    const eligible = optionalTokenField(dimension, "cacheEligibleInputTokens");
    if (read === undefined || eligible === undefined || eligible <= 0 || read > eligible) {
      return undefined;
    }
    cacheRead += read;
    cacheEligible += eligible;
  }
  return cacheEligible > 0 ? cacheRead / cacheEligible : undefined;
}

function estimateCacheSavings(
  record: JsonObject
): { readonly amount: number; readonly currency: string } | undefined {
  if (
    cacheUsageStatus(record["cacheUsageStatus"]) === "unavailable" ||
    cacheInputTokenSemantics(record["cacheInputTokenSemantics"]) === "unavailable"
  ) {
    return undefined;
  }
  const cacheRead = optionalTokenField(record, "cacheReadTokens");
  const cacheWrite = optionalTokenField(record, "cacheWriteTokens") ?? 0;
  const unitPrices = record["unitPrices"];
  if (cacheRead === undefined || !isJsonObject(unitPrices)) return undefined;
  const inputPerMillion = optionalNumberField(unitPrices, "inputPerMillion");
  const cacheReadPerMillion = optionalNumberField(unitPrices, "cacheReadPerMillion");
  const cacheWritePerMillion = optionalNumberField(unitPrices, "cacheWritePerMillion");
  const currency = stringField(unitPrices, "currency");
  if (
    inputPerMillion === undefined ||
    cacheReadPerMillion === undefined ||
    (cacheWrite > 0 && cacheWritePerMillion === undefined) ||
    currency.length === 0
  ) {
    return undefined;
  }
  const readSavings = cacheRead * (inputPerMillion - cacheReadPerMillion);
  const writeSavings =
    cacheInputTokenSemantics(record["cacheInputTokenSemantics"]) === "excluded_from_input"
      ? cacheWrite * (inputPerMillion - (cacheWritePerMillion ?? 0))
      : -cacheWrite * (cacheWritePerMillion ?? 0);
  return {
    amount: (readSavings + writeSavings) / 1_000_000,
    currency
  };
}

function usageStatus(value: unknown): "actual" | "estimated" | "missing" {
  return value === "actual" || value === "estimated" || value === "missing" ? value : "missing";
}

function cacheOutcome(value: unknown): CacheOutcome {
  return value === "hit" || value === "miss" || value === "bypass" || value === "unknown"
    ? value
    : "unknown";
}

function cacheUsageStatus(value: unknown): CacheUsageStatus {
  return value === "actual" || value === "derived" || value === "unavailable"
    ? value
    : "unavailable";
}

function cacheInputTokenSemantics(value: unknown): CacheInputTokenSemantics {
  return value === "included_in_input" || value === "excluded_from_input" || value === "unavailable"
    ? value
    : "unavailable";
}

function cacheMode(value: unknown): CacheMode | null {
  return value === "none" ||
    value === "automatic_prefix" ||
    value === "explicit_breakpoints" ||
    value === "explicit_resource"
    ? value
    : null;
}

function cachePrefixChecksum(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function cacheBypassReason(value: unknown): CacheBypassReason | undefined {
  return value === "policy_none" ||
    value === "unsupported_provider" ||
    value === "below_minimum_tokens" ||
    value === "identity_unverified" ||
    value === "resource_unavailable" ||
    value === "resource_create_failed" ||
    value === "resource_expired" ||
    value === "cache_error" ||
    value === "usage_unavailable"
    ? value
    : undefined;
}

function costStatus(value: unknown): "actual" | "estimated" | "unknown" {
  return value === "actual" || value === "estimated" || value === "unknown" ? value : "unknown";
}

function isLocalDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function isUtcIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function isIanaTimezone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 128) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

function localDateEpochDay(value: string): number {
  return Date.parse(`${value}T00:00:00.000Z`) / 86_400_000;
}

function shiftLocalDate(value: string, days: number): string {
  return new Date((localDateEpochDay(value) + days) * 86_400_000).toISOString().slice(0, 10);
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "ENOENT"
  );
}
