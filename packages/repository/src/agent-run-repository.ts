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

  public readContextSnapshot(
    runId: string,
    contextSnapshotId: string
  ): Promise<Result<JsonObject | undefined, UnifiedError>> {
    if (!isSafeId(contextSnapshotId)) {
      return Promise.resolve(this.invalidRecord("AGENT_CONTEXT_SNAPSHOT_INVALID"));
    }
    return this.readJson(
      this.runPath(runId, join("context-snapshots", `${contextSnapshotId}.json`))
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

  public async writeChangeSet(changeSet: JsonObject): Promise<Result<JsonObject, UnifiedError>> {
    const changeSetId = readSafeString(changeSet, "changeSetId");
    const revision = changeSet["revision"];
    if (
      changeSetId === undefined ||
      readRunId(changeSet) === undefined ||
      !Number.isSafeInteger(revision) ||
      Number(revision) < 1
    ) {
      return this.invalidRecord("AGENT_CHANGE_SET_INVALID");
    }
    const existing = await this.readChangeSet(changeSetId, Number(revision));
    if (!existing.ok) return existing;
    if (existing.value !== undefined) {
      return JSON.stringify(existing.value) === JSON.stringify(changeSet)
        ? ok(existing.value)
        : this.invalidRecord("AGENT_CHANGE_SET_REVISION_CONFLICT");
    }
    return this.writeJson(this.changeSetPath(changeSetId, Number(revision)), changeSet);
  }

  public async readChangeSet(
    changeSetId: string,
    revision?: number
  ): Promise<Result<JsonObject | undefined, UnifiedError>> {
    if (!isSafeId(changeSetId) || (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1))) {
      return this.invalidRecord("AGENT_CHANGE_SET_INVALID");
    }
    const resolvedRevision = revision ?? (await this.latestChangeSetRevision(changeSetId));
    if (resolvedRevision === undefined) return ok(undefined);
    const read = await this.readJson(this.changeSetPath(changeSetId, resolvedRevision));
    if (!read.ok || read.value === undefined) return read;
    return read.value["changeSetId"] === changeSetId && read.value["revision"] === resolvedRevision
      ? read
      : this.invalidRecord("AGENT_CHANGE_SET_INVALID");
  }

  public async readLatestChangeSet(input: {
    readonly runId: string;
    readonly projectId: string;
    readonly checkpointId: string;
  }): Promise<Result<JsonObject | undefined, UnifiedError>> {
    if (![input.runId, input.projectId, input.checkpointId].every(isSafeId)) {
      return this.invalidRecord("AGENT_CHANGE_SET_INVALID");
    }
    const root = join(this.options.projectRoot, "history", "change-sets");
    try {
      const entries = await readdir(root, { withFileTypes: true });
      const candidates: JsonObject[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory() || !isSafeId(entry.name)) continue;
        const changeSet = await this.readChangeSet(entry.name);
        if (!changeSet.ok) return changeSet;
        if (
          changeSet.value !== undefined &&
          changeSet.value["runId"] === input.runId &&
          changeSet.value["projectId"] === input.projectId &&
          changeSet.value["checkpointId"] === input.checkpointId
        ) {
          candidates.push(changeSet.value);
        }
      }
      candidates.sort((left, right) => Number(right["revision"]) - Number(left["revision"]));
      return ok(candidates[0]);
    } catch (error) {
      return isMissingFileError(error)
        ? ok(undefined)
        : err(this.storageFailure("AGENT_RUN_READ_FAILED", error));
    }
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
    const read = await this.readJson(this.runPath(runId, "run.json"));
    if (!read.ok || read.value === undefined) return read;
    if (!isSupportedAgentSchemaVersion(read.value)) {
      return this.invalidRecord("AGENT_RUN_SNAPSHOT_VERSION_UNSUPPORTED");
    }
    // Cross-validate the compaction commit marker before honoring it: the revision must exist and be
    // completed, and the result/budget snapshots it names must exist. A crash between writing the
    // artifacts and rewriting run.json can leave a pointer at half-written state — do not honor it.
    const activeCompactionId = read.value["activeCompactionId"];
    if (typeof activeCompactionId === "string" && activeCompactionId.length > 0) {
      const honored = await this.compactionArtifactsExist(runId, activeCompactionId);
      if (!honored.ok) return honored;
      if (!honored.value) {
        return ok({ ...read.value, activeCompactionId: null });
      }
    }
    return read;
  }

  public writeCompactionManifest(manifest: JsonObject): Promise<Result<JsonObject, UnifiedError>> {
    const runId = readRunId(manifest);
    const compactionId = readSafeString(manifest, "compactionId");
    if (runId === undefined || compactionId === undefined) {
      return Promise.resolve(this.invalidRecord("AGENT_COMPACTION_MANIFEST_INVALID"));
    }
    return this.writeJson(this.compactionPath(runId, compactionId, "manifest.json"), manifest);
  }

  public readCompactionManifest(
    runId: string,
    compactionId: string
  ): Promise<Result<JsonObject | undefined, UnifiedError>> {
    if (!isSafeId(compactionId)) {
      return Promise.resolve(this.invalidRecord("AGENT_COMPACTION_MANIFEST_INVALID"));
    }
    return this.readJson(this.compactionPath(runId, compactionId, "manifest.json"));
  }

  public async writeCompactionRevision(
    revision: JsonObject
  ): Promise<Result<JsonObject, UnifiedError>> {
    const runId = readRunId(revision);
    const compactionId = readSafeString(revision, "compactionId");
    if (runId === undefined || compactionId === undefined) {
      return this.invalidRecord("AGENT_COMPACTION_REVISION_INVALID");
    }
    const path = this.compactionPath(runId, compactionId, "revision.json");
    const existing = await this.readJson(path);
    if (!existing.ok) return existing as Result<JsonObject, UnifiedError>;
    if (existing.value !== undefined) {
      // Immutable per compactionId: a replay with identical content is idempotent; a divergent
      // rewrite is a conflict.
      return JSON.stringify(existing.value) === JSON.stringify(revision)
        ? ok(existing.value)
        : this.invalidRecord("AGENT_COMPACTION_REVISION_CONFLICT");
    }
    return this.writeJson(path, revision);
  }

  public readCompactionRevision(
    runId: string,
    compactionId: string
  ): Promise<Result<JsonObject | undefined, UnifiedError>> {
    if (!isSafeId(compactionId)) {
      return Promise.resolve(this.invalidRecord("AGENT_COMPACTION_REVISION_INVALID"));
    }
    return this.readJson(this.compactionPath(runId, compactionId, "revision.json"));
  }

  public writeBudgetSnapshot(
    runId: string,
    snapshot: JsonObject
  ): Promise<Result<JsonObject, UnifiedError>> {
    const budgetSnapshotId = readSafeString(snapshot, "contextBudgetSnapshotId");
    if (!isSafeId(runId) || budgetSnapshotId === undefined) {
      return Promise.resolve(this.invalidRecord("AGENT_CONTEXT_BUDGET_SNAPSHOT_INVALID"));
    }
    return this.writeJson(
      this.runPath(runId, join("budget-snapshots", `${budgetSnapshotId}.json`)),
      snapshot
    );
  }

  public readBudgetSnapshot(
    runId: string,
    budgetSnapshotId: string
  ): Promise<Result<JsonObject | undefined, UnifiedError>> {
    if (!isSafeId(budgetSnapshotId)) {
      return Promise.resolve(this.invalidRecord("AGENT_CONTEXT_BUDGET_SNAPSHOT_INVALID"));
    }
    return this.readJson(this.runPath(runId, join("budget-snapshots", `${budgetSnapshotId}.json`)));
  }

  public writePermissionSummary(
    runId: string,
    summary: JsonObject
  ): Promise<Result<JsonObject, UnifiedError>> {
    const permissionSummaryId = readSafeString(summary, "permissionSummaryId");
    if (!isSafeId(runId) || permissionSummaryId === undefined) {
      return Promise.resolve(this.invalidRecord("AGENT_PERMISSION_SUMMARY_INVALID"));
    }
    return this.writeJson(
      this.runPath(runId, join("permission-summaries", `${permissionSummaryId}.json`)),
      summary
    );
  }

  public readPermissionSummary(
    runId: string,
    permissionSummaryId: string
  ): Promise<Result<JsonObject | undefined, UnifiedError>> {
    if (!isSafeId(permissionSummaryId)) {
      return Promise.resolve(this.invalidRecord("AGENT_PERMISSION_SUMMARY_INVALID"));
    }
    return this.readJson(
      this.runPath(runId, join("permission-summaries", `${permissionSummaryId}.json`))
    );
  }

  /**
   * The compaction commit marker (step 3 of the cross-repository commit). Rewrites run.json with the
   * new `activeCompactionId`. Read-before-write idempotency: if run.json already carries this
   * `activeCompactionId`, the commit already happened — return the stored snapshot unchanged so a
   * replayed commit is a no-op rather than a conflicting rewrite.
   */
  public async commitCompaction(snapshot: JsonObject): Promise<Result<JsonObject, UnifiedError>> {
    const runId = readRunId(snapshot);
    const activeCompactionId = readSafeString(snapshot, "activeCompactionId");
    if (runId === undefined || activeCompactionId === undefined) {
      return this.invalidRecord("AGENT_COMPACTION_COMMIT_INVALID");
    }
    const existing = await this.readJson(this.runPath(runId, "run.json"));
    if (!existing.ok) return existing as Result<JsonObject, UnifiedError>;
    if (existing.value !== undefined && existing.value["activeCompactionId"] === activeCompactionId) {
      return ok(existing.value);
    }
    return this.writeJson(this.runPath(runId, "run.json"), snapshot);
  }

  private async compactionArtifactsExist(
    runId: string,
    compactionId: string
  ): Promise<Result<boolean, UnifiedError>> {
    const revision = await this.readCompactionRevision(runId, compactionId);
    if (!revision.ok) return revision as Result<boolean, UnifiedError>;
    if (revision.value === undefined || revision.value["status"] !== "completed") return ok(false);
    const resultSnapshotId = revision.value["resultSnapshotId"];
    if (typeof resultSnapshotId === "string" && resultSnapshotId.length > 0) {
      const result = await this.readContextSnapshot(runId, resultSnapshotId);
      if (!result.ok) return result as Result<boolean, UnifiedError>;
      if (result.value === undefined) return ok(false);
    }
    const budgetSnapshotId = revision.value["budgetSnapshotId"];
    if (typeof budgetSnapshotId === "string" && budgetSnapshotId.length > 0) {
      const budget = await this.readBudgetSnapshot(runId, budgetSnapshotId);
      if (!budget.ok) return budget as Result<boolean, UnifiedError>;
      if (budget.value === undefined) return ok(false);
    }
    return ok(true);
  }

  private compactionPath(runId: string, compactionId: string, suffix: string): string {
    if (!isSafeId(compactionId)) {
      throw new Error("Agent compaction ID is invalid.");
    }
    return this.runPath(runId, join("compactions", compactionId, suffix));
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

  private changeSetPath(changeSetId: string, revision: number): string {
    return join(
      this.options.projectRoot,
      "history",
      "change-sets",
      changeSetId,
      "revisions",
      `${String(revision)}.json`
    );
  }

  private async latestChangeSetRevision(changeSetId: string): Promise<number | undefined> {
    try {
      const entries = await readdir(
        join(this.options.projectRoot, "history", "change-sets", changeSetId, "revisions")
      );
      return entries
        .map((entry) => (/^[1-9][0-9]*\.json$/.test(entry) ? Number(entry.slice(0, -5)) : 0))
        .sort((left, right) => right - left)
        .find((revision) => revision > 0);
    } catch (error) {
      if (isMissingFileError(error)) return undefined;
      throw error;
    }
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

/**
 * A persisted run snapshot is readable when its schemaVersion is a version this build understands
 * (v1.0 or v1.1) or is absent (a minimal legacy fixture). An explicit unknown/future version is
 * rejected so it is never silently normalized as v1.0. Reads never rewrite the file.
 */
function isSupportedAgentSchemaVersion(value: JsonObject): boolean {
  const version = value["schemaVersion"];
  return version === undefined || version === "1.0" || version === "1.1";
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
