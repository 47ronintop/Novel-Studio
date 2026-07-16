import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { err, ok, type JsonObject, type Result, type UnifiedError } from "@novel-studio/shared";

import { writeTextAtomically } from "./atomic-write.js";
import { storageError } from "./errors.js";

export interface AgentUsageFileRepositoryOptions {
  readonly userDataRoot: string;
  readonly traceId?: string;
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
    const validated = validateUsageRecord(record);
    if (!validated.ok) return err(validated.error);
    const redaction = assertRedacted(record);
    if (redaction !== undefined) return err(this.redactionRequired(redaction));

    const usageId = String(record["usageId"]);
    const key = idempotencyKey(record);
    // First-wins idempotency: a replayed round key returns the record written first, never a competitor.
    const pointer = await this.readJson(this.keyPath(key));
    if (!pointer.ok) return pointer as Result<JsonObject, UnifiedError>;
    if (pointer.value !== undefined) {
      const priorId = String(pointer.value["usageId"]);
      const prior = await this.readById(priorId);
      if (!prior.ok) return prior as Result<JsonObject, UnifiedError>;
      if (prior.value !== undefined) return ok(prior.value);
    }

    const detailWritten = await this.writeJson(this.detailPath(usageId), record);
    if (!detailWritten.ok) return detailWritten;
    const keyWritten = await this.writeJson(this.keyPath(key), { usageId });
    if (!keyWritten.ok) return keyWritten;
    const aggregated = await this.updateDailyAggregate(record);
    if (!aggregated.ok) return aggregated as Result<JsonObject, UnifiedError>;
    return ok(record);
  }

  public async readById(usageId: string): Promise<Result<JsonObject | undefined, UnifiedError>> {
    if (!isSafeId(usageId)) return this.invalid("AGENT_USAGE_RECORD_INVALID");
    return this.readJson(this.detailPath(usageId));
  }

  private async updateDailyAggregate(record: JsonObject): Promise<Result<JsonObject, UnifiedError>> {
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
      totalTokens: 0
    };
    const next: JsonObject = {
      ...prior,
      recordCount: numberField(prior, "recordCount") + 1,
      inputTokens: numberField(prior, "inputTokens") + numberField(record, "inputTokens"),
      outputTokens: numberField(prior, "outputTokens") + numberField(record, "outputTokens"),
      totalTokens: numberField(prior, "totalTokens") + numberField(record, "totalTokens")
    };
    return this.writeJson(path, next);
  }

  private detailPath(usageId: string): string {
    return this.usagePath(join("details", `${usageId}.json`));
  }

  private keyPath(key: string): string {
    return this.usagePath(join("keys", `${key}.json`));
  }

  private aggregatePath(localDate: string): string {
    return this.usagePath(join("aggregates", `${localDate}.json`));
  }

  private usagePath(suffix: string): string {
    return join(this.options.userDataRoot, "agent-usage", suffix);
  }

  private async writeJson(path: string, value: JsonObject): Promise<Result<JsonObject, UnifiedError>> {
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
      suggestedAction: "Remove prompt text, file contents, paths, and credentials from the usage record.",
      traceId: this.traceId,
      redactedDetail: { field }
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

const REQUIRED_TOKEN_FIELDS = [
  "inputTokens",
  "outputTokens",
  "totalTokens",
  "finalSequence",
  "contextWindow",
  "safeInputBudget"
] as const;
const OPTIONAL_TOKEN_FIELDS = [
  "cachedTokens",
  "reasoningTokens",
  "compactionBeforeTokens",
  "compactionAfterTokens"
] as const;

function validateUsageRecord(record: JsonObject): Result<JsonObject, UnifiedError> {
  const runId = record["runId"];
  const roundId = record["roundId"];
  const usageId = record["usageId"];
  if (
    typeof runId !== "string" || !isSafeId(runId) ||
    typeof roundId !== "string" || !isSafeId(roundId) ||
    typeof usageId !== "string" || !isSafeId(usageId)
  ) {
    return validationError("identity");
  }
  for (const field of REQUIRED_TOKEN_FIELDS) {
    if (!isTokenCount(record[field])) return validationError(field);
  }
  for (const field of OPTIONAL_TOKEN_FIELDS) {
    if (record[field] !== undefined && !isTokenCount(record[field])) return validationError(field);
  }
  const cost = record["cost"];
  if (!isJsonObject(cost) || typeof cost["amount"] !== "number" || !Number.isFinite(cost["amount"]) || cost["amount"] < 0) {
    return validationError("cost.amount");
  }
  return ok(record);
}

// Free-form fields the model or provider might have touched. The record schema has no prompt/body
// field, but termination reasons and identifiers are scanned so a leak cannot slip through.
const REDACTION_SCAN_FIELDS = ["terminationReason", "provider", "model", "roundId"] as const;
const ABSOLUTE_PATH = /(^|[\s"'([])(\/[^\s"']|[A-Za-z]:[\\/])/;
const CREDENTIAL = /\b(authorization|bearer|api[_-]?key|secret|password)\b|\bsk-[A-Za-z0-9]/i;

function assertRedacted(record: JsonObject): string | undefined {
  for (const field of REDACTION_SCAN_FIELDS) {
    const value = record[field];
    if (typeof value !== "string") continue;
    if (ABSOLUTE_PATH.test(value)) return `${field}:absolute_path`;
    if (CREDENTIAL.test(value)) return `${field}:credential`;
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

function isSafeId(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value);
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
