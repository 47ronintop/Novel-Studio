import { mkdir, readFile, readdir, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";

import { validateAgentUsageRecord, type AgentUsageRecord } from "@novel-studio/agent-engine";
import { err, ok, type JsonObject, type Result, type UnifiedError } from "@novel-studio/shared";

import { writeTextAtomically } from "./atomic-write.js";
import { storageError } from "./errors.js";

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
}

export interface AgentUsageRepositoryCostTotal {
  readonly currency: string;
  readonly actualAmount: number;
  readonly estimatedAmount: number;
}

export interface AgentUsageRepositoryDailyBucket {
  readonly localDate: string;
  readonly recordCount: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedTokens: number;
  readonly reasoningTokens: number;
  readonly totalTokens: number;
  readonly costs: readonly AgentUsageRepositoryCostTotal[];
  readonly hasUnknownCost: boolean;
}

export interface AgentUsageRepositoryRunSummary {
  readonly usageId: string;
  readonly runId: string;
  readonly conversationId: string;
  readonly projectId: string;
  readonly provider: string;
  readonly model: string;
  readonly totalTokens: number;
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

  public async writeFinal(record: JsonObject): Promise<Result<JsonObject, UnifiedError>> {
    const redaction = assertRedacted(record);
    if (redaction !== undefined) return err(this.redactionRequired(redaction));
    const validated = validateUsageRecord(record);
    if (!validated.ok) return err(validated.error);

    return enqueueUsageMutation(this.options.userDataRoot, () => this.writeFinalLocked(record));
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
    return this.readJson(this.detailPath(usageId));
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
        buckets.push(projectAggregate(aggregate, query));
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
    const details = await this.readJsonDirectory(this.usagePath("details"));
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
      const repaired = await this.repairFinal(detail);
      if (!repaired.ok) return repaired as Result<void, UnifiedError>;
    }
    return ok(undefined);
  }

  private async updateDailyAggregate(
    record: JsonObject
  ): Promise<Result<JsonObject, UnifiedError>> {
    const localDate = String(record["localDate"]);
    const path = this.aggregatePath(localDate);
    const existing = await this.readJson(path);
    if (!existing.ok) return existing as Result<JsonObject, UnifiedError>;
    const prior: JsonObject = existing.value ?? {
      schemaVersion: "1.0",
      localDate,
      timezone: typeof record["timezone"] === "string" ? record["timezone"] : "",
      utcOffsetMinutes: numberField(record, "utcOffsetMinutes"),
      recordCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
      costs: [],
      hasUnknownCost: false,
      dimensions: []
    };
    const dimensions = jsonObjectArray(prior["dimensions"]);
    if (dimensions.some((dimension) => dimension["usageId"] === record["usageId"])) {
      return ok(prior);
    }
    const dimension = createAggregateDimension(record);
    const next: JsonObject = {
      ...prior,
      recordCount: numberField(prior, "recordCount") + 1,
      inputTokens: numberField(prior, "inputTokens") + numberField(record, "inputTokens"),
      outputTokens: numberField(prior, "outputTokens") + numberField(record, "outputTokens"),
      cachedTokens: numberField(prior, "cachedTokens") + numberField(record, "cachedTokens"),
      reasoningTokens:
        numberField(prior, "reasoningTokens") + numberField(record, "reasoningTokens"),
      totalTokens: numberField(prior, "totalTokens") + numberField(record, "totalTokens"),
      costs: mergeCosts(jsonObjectArray(prior["costs"]), dimension),
      hasUnknownCost: prior["hasUnknownCost"] === true || dimension["hasUnknownCost"] === true,
      dimensions: [...dimensions, dimension]
    };
    return this.writeJson(path, next);
  }

  private async readAllDetails(): Promise<Result<readonly JsonObject[], UnifiedError>> {
    return this.readJsonDirectory(this.usagePath("details"));
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
      redactedDetail: { reason: error instanceof Error ? error.message : "Unknown error" }
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
  if (record["schemaVersion"] !== "1.0") return validationError("schemaVersion");
  const runId = record["runId"];
  const roundId = record["roundId"];
  const conversationId = record["conversationId"];
  const projectId = record["projectId"];
  const usageId = record["usageId"];
  if (
    typeof runId !== "string" ||
    !isSafeId(runId) ||
    typeof roundId !== "string" ||
    !isSafeId(roundId) ||
    typeof conversationId !== "string" ||
    !isSafeId(conversationId, true) ||
    typeof projectId !== "string" ||
    !isSafeId(projectId) ||
    typeof usageId !== "string" ||
    !isSafeUsageId(usageId)
  ) {
    return validationError("identity");
  }
  const terminationReason = record["terminationReason"];
  if (
    !isBoundedIdentifier(record["provider"], false) ||
    !isBoundedIdentifier(record["model"], false) ||
    typeof terminationReason !== "string" ||
    !TERMINATION_REASONS.has(terminationReason)
  ) {
    return validationError("record scalar");
  }
  if (usageId !== `${runId}:${roundId}:${String(record["finalSequence"])}`) {
    return validationError("usageId");
  }
  if (!isLocalDate(record["localDate"]) || !isUtcIsoTimestamp(record["timestamp"])) {
    return validationError("timestamp");
  }
  if (!isIanaTimezone(record["timezone"])) return validationError("timezone");
  if (
    typeof record["utcOffsetMinutes"] !== "number" ||
    !Number.isInteger(record["utcOffsetMinutes"]) ||
    Math.abs(record["utcOffsetMinutes"]) > 900
  ) {
    return validationError("utcOffsetMinutes");
  }
  const cost = record["cost"];
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
  const pricingVersion = record["pricingVersion"];
  if (pricingVersion !== null && !isBoundedIdentifier(pricingVersion, false)) {
    return validationError("pricingVersion");
  }
  const unitPrices = record["unitPrices"];
  if (unitPrices !== null) {
    if (
      !isJsonObject(unitPrices) ||
      !hasOnlyFields(unitPrices, UNIT_PRICE_FIELDS) ||
      !isUnitPriceScalar(unitPrices["inputPerMillion"]) ||
      !isUnitPriceScalar(unitPrices["outputPerMillion"]) ||
      !isBoundedIdentifier(unitPrices["currency"], false) ||
      (unitPrices["cachedPerMillion"] !== undefined &&
        !isUnitPriceScalar(unitPrices["cachedPerMillion"])) ||
      (unitPrices["reasoningPerMillion"] !== undefined &&
        !isUnitPriceScalar(unitPrices["reasoningPerMillion"]))
    ) {
      return validationError("unitPrices");
    }
  }
  const domain = validateAgentUsageRecord(record as unknown as AgentUsageRecord);
  return domain.ok ? ok(record) : err(domain.error);
}

const ABSOLUTE_PATH = /(^|[\s"'([])(\/[^\s"']|[A-Za-z]:[\\/])/;
const CREDENTIAL = /\b(authorization|bearer|api[_-]?key|secret|password)\b|\bsk-[A-Za-z0-9]/i;
const COST_FIELDS = new Set(["amount", "currency", "status"]);
const UNIT_PRICE_FIELDS = new Set([
  "inputPerMillion",
  "outputPerMillion",
  "cachedPerMillion",
  "reasoningPerMillion",
  "currency"
]);

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
    for (const field of Object.keys(unitPrices)) {
      if (!UNIT_PRICE_FIELDS.has(field)) return `unitPrices.${field}:forbidden_field`;
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

function isTokenCount(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
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

const TERMINATION_REASONS = new Set(["stop", "tool_calls", "context_compaction", "compaction"]);
const COST_STATUSES = new Set(["actual", "estimated", "unknown"]);

function isBoundedScalar(value: unknown, allowEmpty: boolean): value is string {
  return (
    typeof value === "string" &&
    value.length <= 256 &&
    (allowEmpty || value.length > 0) &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
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
    (query.projectId === undefined || record["projectId"] === query.projectId)
  );
}

function toRunSummary(record: JsonObject): AgentUsageRepositoryRunSummary {
  const cost = isJsonObject(record["cost"]) ? record["cost"] : {};
  return {
    usageId: stringField(record, "usageId"),
    runId: stringField(record, "runId"),
    conversationId: stringField(record, "conversationId"),
    projectId: stringField(record, "projectId"),
    provider: stringField(record, "provider"),
    model: stringField(record, "model"),
    totalTokens: numberField(record, "totalTokens"),
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
  return {
    usageId: stringField(record, "usageId"),
    provider: stringField(record, "provider"),
    model: stringField(record, "model"),
    projectId: stringField(record, "projectId"),
    recordCount: 1,
    inputTokens: numberField(record, "inputTokens"),
    outputTokens: numberField(record, "outputTokens"),
    cachedTokens: numberField(record, "cachedTokens"),
    reasoningTokens: numberField(record, "reasoningTokens"),
    totalTokens: numberField(record, "totalTokens"),
    currency: status === "unknown" ? "" : stringField(cost, "currency"),
    actualAmount: status === "actual" ? numberField(cost, "amount") : 0,
    estimatedAmount: status === "estimated" ? numberField(cost, "amount") : 0,
    hasUnknownCost: status === "unknown"
  };
}

function projectAggregate(
  aggregate: JsonObject,
  query: AgentUsageRepositoryQuery
): AgentUsageRepositoryDailyBucket {
  const allDimensions = jsonObjectArray(aggregate["dimensions"]);
  const filtered = allDimensions.filter(
    (dimension) =>
      (query.provider === undefined || dimension["provider"] === query.provider) &&
      (query.model === undefined || dimension["model"] === query.model) &&
      (query.projectId === undefined || dimension["projectId"] === query.projectId)
  );
  const hasFilters =
    query.provider !== undefined || query.model !== undefined || query.projectId !== undefined;
  if (allDimensions.length === 0 && !hasFilters) {
    return {
      localDate: stringField(aggregate, "localDate"),
      recordCount: numberField(aggregate, "recordCount"),
      inputTokens: numberField(aggregate, "inputTokens"),
      outputTokens: numberField(aggregate, "outputTokens"),
      cachedTokens: numberField(aggregate, "cachedTokens"),
      reasoningTokens: numberField(aggregate, "reasoningTokens"),
      totalTokens: numberField(aggregate, "totalTokens"),
      costs: costTotals(jsonObjectArray(aggregate["costs"])),
      hasUnknownCost: aggregate["hasUnknownCost"] === true
    };
  }
  return {
    localDate: stringField(aggregate, "localDate"),
    recordCount: sumField(filtered, "recordCount"),
    inputTokens: sumField(filtered, "inputTokens"),
    outputTokens: sumField(filtered, "outputTokens"),
    cachedTokens: sumField(filtered, "cachedTokens"),
    reasoningTokens: sumField(filtered, "reasoningTokens"),
    totalTokens: sumField(filtered, "totalTokens"),
    costs: costTotals(mergeDimensionCosts(filtered)),
    hasUnknownCost: filtered.some((dimension) => dimension["hasUnknownCost"] === true)
  };
}

function mergeCosts(existing: readonly JsonObject[], dimension: JsonObject): JsonObject[] {
  return mergeDimensionCosts([
    ...existing.map((cost) => ({
      currency: stringField(cost, "currency"),
      actualAmount: numberField(cost, "actualAmount"),
      estimatedAmount: numberField(cost, "estimatedAmount")
    })),
    dimension
  ]);
}

function mergeDimensionCosts(dimensions: readonly JsonObject[]): JsonObject[] {
  const totals = new Map<string, { actualAmount: number; estimatedAmount: number }>();
  for (const dimension of dimensions) {
    const currency = stringField(dimension, "currency");
    if (currency.length === 0) continue;
    const prior = totals.get(currency) ?? { actualAmount: 0, estimatedAmount: 0 };
    prior.actualAmount += numberField(dimension, "actualAmount");
    prior.estimatedAmount += numberField(dimension, "estimatedAmount");
    totals.set(currency, prior);
  }
  return [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, amounts]) => ({ currency, ...amounts }));
}

function costTotals(costs: readonly JsonObject[]): readonly AgentUsageRepositoryCostTotal[] {
  return costs.map((cost) => ({
    currency: stringField(cost, "currency"),
    actualAmount: numberField(cost, "actualAmount"),
    estimatedAmount: numberField(cost, "estimatedAmount")
  }));
}

function sumField(values: readonly JsonObject[], field: string): number {
  return values.reduce((total, value) => total + numberField(value, field), 0);
}

function jsonObjectArray(value: unknown): readonly JsonObject[] {
  return Array.isArray(value) ? value.filter(isJsonObject) : [];
}

function stringField(value: JsonObject, key: string): string {
  return typeof value[key] === "string" ? value[key] : "";
}

function usageStatus(value: unknown): "actual" | "estimated" | "missing" {
  return value === "actual" || value === "estimated" || value === "missing" ? value : "missing";
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
