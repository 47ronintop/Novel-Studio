import { mkdir, readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import { err, ok, type JsonObject, type Result, type UnifiedError } from "@novel-studio/shared";

import { writeTextAtomically } from "./atomic-write.js";
import { storageError } from "./errors.js";

export interface AgentRunFileRepositoryOptions {
  readonly projectRoot: string;
  readonly traceId?: string;
}

export class AgentRunFileRepository {
  private readonly traceId: string;

  public constructor(private readonly options: AgentRunFileRepositoryOptions) {
    this.traceId = options.traceId ?? "agent-run-file-repository";
  }

  public writeSnapshot(snapshot: JsonObject): Promise<Result<JsonObject, UnifiedError>> {
    const runId = readRunId(snapshot);
    return runId === undefined
      ? Promise.resolve(this.invalidRecord("AGENT_RUN_SNAPSHOT_INVALID"))
      : this.writeJson(this.runPath(runId, "run.json"), snapshot);
  }

  public writeContextSnapshot(snapshot: JsonObject): Promise<Result<JsonObject, UnifiedError>> {
    const runId = readRunId(snapshot);
    const contextSnapshotId = readSafeString(snapshot, "contextSnapshotId");
    if (runId === undefined || contextSnapshotId === undefined) {
      return Promise.resolve(this.invalidRecord("AGENT_CONTEXT_SNAPSHOT_INVALID"));
    }
    return this.writeJson(
      this.runPath(runId, join("context-snapshots", `${contextSnapshotId}.json`)),
      snapshot
    );
  }

  public writePlanArtifact(plan: JsonObject): Promise<Result<JsonObject, UnifiedError>> {
    const planId = readSafeString(plan, "planId");
    const revision = plan["revision"];
    if (planId === undefined || !Number.isInteger(revision) || Number(revision) < 1) {
      return Promise.resolve(this.invalidRecord("AGENT_PLAN_ARTIFACT_INVALID"));
    }
    return this.writeJson(
      join(
        this.options.projectRoot,
        "history",
        "plans",
        planId,
        "revisions",
        `${String(revision)}.json`
      ),
      plan
    );
  }

  public async appendEvent(event: JsonObject): Promise<Result<JsonObject, UnifiedError>> {
    const runId = readRunId(event);
    if (runId === undefined) {
      return this.invalidRecord("AGENT_RUN_EVENT_INVALID");
    }
    const path = this.runPath(runId, "events.json");
    const existing = await this.readJsonArray(path);
    if (!existing.ok) {
      return existing;
    }
    const written = await this.writeJson(path, [...existing.value, event]);
    return written.ok ? ok(event) : written;
  }

  public writeCommandReceipt(
    runId: string,
    commandId: string,
    receipt: JsonObject
  ): Promise<Result<JsonObject, UnifiedError>>;
  public writeCommandReceipt(
    commandId: string,
    receipt: JsonObject
  ): Promise<Result<JsonObject, UnifiedError>>;
  public writeCommandReceipt(
    runIdOrCommandId: string,
    commandIdOrReceipt: string | JsonObject,
    optionalReceipt?: JsonObject
  ): Promise<Result<JsonObject, UnifiedError>> {
    const runId =
      optionalReceipt === undefined ? readReceiptRunId(commandIdOrReceipt) : runIdOrCommandId;
    const commandId = optionalReceipt === undefined ? runIdOrCommandId : commandIdOrReceipt;
    const receipt = optionalReceipt ?? commandIdOrReceipt;
    if (
      runId === undefined ||
      typeof commandId !== "string" ||
      !isSafeId(commandId) ||
      !isJsonObject(receipt)
    ) {
      return Promise.resolve(this.invalidRecord("AGENT_RUN_RECEIPT_INVALID"));
    }
    return this.writeJson(
      this.runPath(runId, join("command-receipts", `${commandId}.json`)),
      receipt
    );
  }

  public async readSnapshot(runId: string): Promise<Result<JsonObject | undefined, UnifiedError>> {
    return this.readJson(this.runPath(runId, "run.json"));
  }

  public readEvents(runId: string): Promise<Result<JsonObject[], UnifiedError>> {
    return this.readJsonArray(this.runPath(runId, "events.json"));
  }

  public readCommandReceipt(
    runId: string,
    commandId: string
  ): Promise<Result<JsonObject | undefined, UnifiedError>> {
    if (!isSafeId(commandId)) {
      return Promise.resolve(this.invalidRecord("AGENT_RUN_RECEIPT_INVALID"));
    }
    return this.readJson(this.runPath(runId, join("command-receipts", `${commandId}.json`)));
  }

  public writeRetryCheckpoint(
    runId: string,
    checkpoint: JsonObject
  ): Promise<Result<JsonObject, UnifiedError>> {
    return readRunId(checkpoint) !== runId
      ? Promise.resolve(this.invalidRecord("AGENT_RETRY_CHECKPOINT_INVALID"))
      : this.writeJson(this.runPath(runId, "retry-checkpoint.json"), checkpoint);
  }

  public readRetryCheckpoint(
    runId: string
  ): Promise<Result<JsonObject | undefined, UnifiedError>> {
    return this.readJson(this.runPath(runId, "retry-checkpoint.json"));
  }

  public async listSnapshots(projectId?: string): Promise<Result<JsonObject[], UnifiedError>> {
    const root = join(this.options.projectRoot, "history", "agent-runs");
    try {
      const entries = await readdir(root, { withFileTypes: true });
      const snapshots: JsonObject[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory() || !isSafeId(entry.name)) continue;
        const snapshot = await this.readSnapshot(entry.name);
        if (!snapshot.ok) return snapshot;
        if (
          snapshot.value !== undefined &&
          (projectId === undefined || snapshot.value["projectId"] === projectId)
        ) {
          snapshots.push(snapshot.value);
        }
      }
      snapshots.sort((left, right) =>
        String(right["updatedAt"] ?? "").localeCompare(String(left["updatedAt"] ?? ""))
      );
      return ok(snapshots);
    } catch (error) {
      return isMissingFileError(error)
        ? ok([])
        : err(this.storageFailure("AGENT_RUN_READ_FAILED", error));
    }
  }

  private runPath(runId: string, suffix: string): string {
    if (!isSafeId(runId)) {
      throw new Error("Agent run ID is invalid.");
    }
    return join(this.options.projectRoot, "history", "agent-runs", runId, suffix);
  }

  private async writeJson(
    path: string,
    value: JsonObject | JsonObject[]
  ): Promise<Result<JsonObject, UnifiedError>> {
    try {
      await mkdir(dirname(path), { recursive: true });
      const written = await writeTextAtomically({
        targetPath: path,
        content: `${JSON.stringify(value, null, 2)}\n`,
        traceId: this.traceId
      });
      return written.ok ? ok(Array.isArray(value) ? { count: value.length } : value) : written;
    } catch (error) {
      return err(this.storageFailure("AGENT_RUN_WRITE_FAILED", error));
    }
  }

  private async readJson(path: string): Promise<Result<JsonObject | undefined, UnifiedError>> {
    try {
      const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
      return isJsonObject(parsed) ? ok(parsed) : this.invalidRecord("AGENT_RUN_RECORD_INVALID");
    } catch (error) {
      return isMissingFileError(error)
        ? ok(undefined)
        : err(this.storageFailure("AGENT_RUN_READ_FAILED", error));
    }
  }

  private async readJsonArray(path: string): Promise<Result<JsonObject[], UnifiedError>> {
    try {
      const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
      return Array.isArray(parsed) && parsed.every(isJsonObject)
        ? ok(parsed)
        : this.invalidRecord("AGENT_RUN_EVENTS_INVALID");
    } catch (error) {
      return isMissingFileError(error)
        ? ok([])
        : err(this.storageFailure("AGENT_RUN_READ_FAILED", error));
    }
  }

  private invalidRecord(code: string): { readonly ok: false; readonly error: UnifiedError } {
    return err(
      storageError({
        code,
        message: "Agent run data is invalid.",
        suggestedAction: "Discard the invalid run record and retry.",
        traceId: this.traceId
      })
    );
  }

  private storageFailure(code: string, error: unknown): UnifiedError {
    return storageError({
      code,
      message: "Agent run data could not be persisted.",
      suggestedAction: "Check project storage permissions and retry.",
      traceId: this.traceId,
      redactedDetail: { reason: error instanceof Error ? error.message : "Unknown error" }
    });
  }
}

function readRunId(value: JsonObject): string | undefined {
  return typeof value["runId"] === "string" && isSafeId(value["runId"])
    ? value["runId"]
    : undefined;
}

function readSafeString(value: JsonObject, key: string): string | undefined {
  const candidate = value[key];
  return typeof candidate === "string" && isSafeId(candidate) ? candidate : undefined;
}

function readReceiptRunId(value: string | JsonObject): string | undefined {
  if (!isJsonObject(value)) return undefined;
  const nested = value["value"];
  return isJsonObject(nested) ? readRunId(nested) : readRunId(value);
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
