import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  createDeterministicTokenEstimator,
  validateAgentRunToolCatalogSnapshot,
  validateAgentRunEventV20,
  validateAgentRunHistoryV20,
  validateAgentRunSnapshotV20,
  validateAgentRunStatePairV20,
  type AgentRunEventV20,
  type AgentRunSnapshotV20,
  type AgentRunStateCommitV20
} from "@novel-studio/agent-engine";
import { err, ok, type JsonObject, type Result, type UnifiedError } from "@novel-studio/shared";

import { writeTextAtomically } from "./atomic-write.js";
import { storageError } from "./errors.js";

export interface AgentRunFileRepositoryOptions {
  readonly projectRoot: string;
  readonly traceId?: string;
  readonly preflightErrorMaxRecords?: number;
  readonly preflightErrorMaxBytes?: number;
}

export class AgentRunFileRepository {
  private readonly traceId: string;
  private readonly preflightErrorMaxRecords: number;
  private readonly preflightErrorMaxBytes: number;
  private readonly immutableWriteQueues = new Map<string, Promise<unknown>>();
  private readonly v20CommitQueues = new Map<string, Promise<unknown>>();

  public constructor(private readonly options: AgentRunFileRepositoryOptions) {
    this.traceId = options.traceId ?? "agent-run-file-repository";
    this.preflightErrorMaxRecords = positiveLimit(options.preflightErrorMaxRecords, 100);
    this.preflightErrorMaxBytes = positiveLimit(options.preflightErrorMaxBytes, 1024 * 1024);
  }

  public writeSnapshot(snapshot: JsonObject): Promise<Result<JsonObject, UnifiedError>> {
    if (snapshot["schemaVersion"] === "2.0") {
      return Promise.resolve(this.invalidRecord("AGENT_RUN_SNAPSHOT_V20_REQUIRES_STRICT_WRITER"));
    }
    const runId = readRunId(snapshot);
    return runId === undefined
      ? Promise.resolve(this.invalidRecord("AGENT_RUN_SNAPSHOT_INVALID"))
      : this.writeJson(this.runPath(runId, "run.json"), snapshot);
  }

  /** Write the strict 2.0 envelope. Legacy snapshots cannot be upgraded through this method. */
  public async writeSnapshotV20(
    snapshot: AgentRunSnapshotV20
  ): Promise<Result<AgentRunSnapshotV20, UnifiedError>> {
    const recovered = await this.recoverRunStateV20(snapshot.runId);
    if (!recovered.ok) return recovered;
    return this.writeSnapshotV20Direct(snapshot);
  }

  /**
   * Durably coordinate the paired V20 event/snapshot write. The intent journal is written first,
   * so a restart can complete an interrupted pair without trusting an event-only tail.
   */
  public commitRunStateV20(input: {
    readonly snapshot: AgentRunSnapshotV20;
    readonly event: AgentRunEventV20;
  }): Promise<Result<AgentRunSnapshotV20, UnifiedError>> {
    const runId = input.snapshot.runId;
    const previous = this.v20CommitQueues.get(runId) ?? Promise.resolve();
    const request = previous.then(
      () => this.performV20Commit(input),
      () => this.performV20Commit(input)
    );
    this.v20CommitQueues.set(runId, request);
    const clear = () => {
      if (this.v20CommitQueues.get(runId) === request) this.v20CommitQueues.delete(runId);
    };
    void request.then(clear, clear);
    return request;
  }

  /** Recover a durable V20 pair left by a crash between the event and snapshot replacements. */
  public async recoverRunStateV20(
    runId: string
  ): Promise<Result<AgentRunSnapshotV20 | undefined, UnifiedError>> {
    if (!isSafeId(runId)) return this.invalidRecord("AGENT_RUN_V20_COMMIT_INVALID");
    const journal = await this.readJson(this.v20CommitPath(runId));
    if (!journal.ok || journal.value === undefined) {
      return journal as Result<AgentRunSnapshotV20 | undefined, UnifiedError>;
    }
    const parsed = parseAgentRunStateCommitV20(journal.value);
    if (parsed === undefined || parsed.runId !== runId) {
      return this.invalidRecord("AGENT_RUN_V20_COMMIT_INVALID");
    }
    const transition = await this.validateV20CommitAgainstDisk(parsed.snapshot, parsed.event);
    if (!transition.ok) return transition;
    const applied = await this.applyV20Commit(parsed);
    if (!applied.ok) return applied;
    try {
      await unlink(this.v20CommitPath(runId));
    } catch (error) {
      if (!isMissingFileError(error)) {
        // The pair is durable and idempotent; retain the journal for a later cleanup attempt.
      }
    }
    return ok(applied.value);
  }

  private async writeSnapshotV20Direct(
    snapshot: AgentRunSnapshotV20
  ): Promise<Result<AgentRunSnapshotV20, UnifiedError>> {
    const validated = validateAgentRunSnapshotV20(snapshot);
    if (!validated.ok) return validated;
    const existing = await this.readJson(this.runPath(snapshot.runId, "run.json"));
    if (!existing.ok) return existing as Result<AgentRunSnapshotV20, UnifiedError>;
    if (existing.value !== undefined && existing.value["schemaVersion"] !== "2.0") {
      return this.invalidRecord("AGENT_RUN_SNAPSHOT_V20_LEGACY_CONFLICT");
    }
    if (existing.value !== undefined) {
      const prior = validateAgentRunSnapshotV20(existing.value);
      if (!prior.ok) {
        return this.invalidRecord("AGENT_RUN_SNAPSHOT_V20_REVISION_INVALID");
      }
      const sameRevision =
        snapshot.runRevision === prior.value.runRevision &&
        snapshot.lastSequence === prior.value.lastSequence;
      if (sameRevision) {
        if (JSON.stringify(snapshot) !== JSON.stringify(prior.value)) {
          return this.invalidRecord("AGENT_RUN_SNAPSHOT_V20_REVISION_INVALID");
        }
      } else if (
        snapshot.runRevision !== prior.value.runRevision + 1 ||
        snapshot.lastSequence !== prior.value.lastSequence + 1 ||
        !v20ImmutableFieldsMatch(prior.value, snapshot)
      ) {
        return this.invalidRecord("AGENT_RUN_SNAPSHOT_V20_REVISION_INVALID");
      }
    }
    const written = await this.writeJson(
      this.runPath(snapshot.runId, "run.json"),
      snapshot as unknown as JsonObject
    );
    return written.ok
      ? ok(validated.value)
      : (written as Result<AgentRunSnapshotV20, UnifiedError>);
  }

  public writeToolCatalog(
    runId: string,
    catalog: JsonObject
  ): Promise<Result<JsonObject, UnifiedError>> {
    const snapshotId = readSafeString(catalog, "toolCatalogSnapshotId");
    const validated = validateAgentRunToolCatalogSnapshot(catalog);
    if (
      !isSafeId(runId) ||
      snapshotId === undefined ||
      catalog["runId"] !== runId ||
      !hasStrictToolCatalogEnvelope(catalog) ||
      !validated.ok ||
      validated.value.runId !== runId ||
      validated.value.toolCatalogSnapshotId !== snapshotId
    ) {
      return Promise.resolve(this.invalidRecord("AGENT_TOOL_CATALOG_INVALID"));
    }
    return this.writeImmutableJson(
      this.runPath(runId, join("tool-catalogs", `${snapshotId}.json`)),
      catalog,
      "AGENT_TOOL_CATALOG_CONFLICT"
    );
  }

  public async readToolCatalog(
    runId: string,
    toolCatalogSnapshotId: string
  ): Promise<Result<JsonObject | undefined, UnifiedError>> {
    if (!isSafeId(runId) || !isSafeId(toolCatalogSnapshotId)) {
      return this.invalidRecord("AGENT_TOOL_CATALOG_INVALID");
    }
    const read = await this.readJson(
      this.runPath(runId, join("tool-catalogs", `${toolCatalogSnapshotId}.json`))
    );
    if (!read.ok || read.value === undefined) return read;
    const validated = validateAgentRunToolCatalogSnapshot(read.value);
    return hasStrictToolCatalogEnvelope(read.value) &&
      validated.ok &&
      validated.value.runId === runId &&
      validated.value.toolCatalogSnapshotId === toolCatalogSnapshotId
      ? ok(validated.value as unknown as JsonObject)
      : this.invalidRecord("AGENT_TOOL_CATALOG_INVALID");
  }

  public async writeRunError(
    runId: string,
    record: JsonObject
  ): Promise<Result<JsonObject, UnifiedError>> {
    const errorId = readSafeString(record, "errorId");
    if (
      !isSafeId(runId) ||
      errorId === undefined ||
      record["runId"] !== runId ||
      record["runDraftId"] !== undefined ||
      !isSafeDiagnosticRecord(record)
    ) {
      return this.invalidRecord("AGENT_RUN_ERROR_RECORD_INVALID");
    }
    return this.writeImmutableJson(
      this.runPath(runId, join("errors", `${errorId}.json`)),
      record,
      "AGENT_RUN_ERROR_RECORD_CONFLICT"
    );
  }

  public async readRunError(
    runId: string,
    errorId: string
  ): Promise<Result<JsonObject | undefined, UnifiedError>> {
    if (!isSafeId(runId) || !isSafeId(errorId)) {
      return this.invalidRecord("AGENT_RUN_ERROR_RECORD_INVALID");
    }
    const read = await this.readJson(this.runPath(runId, join("errors", `${errorId}.json`)));
    if (!read.ok || read.value === undefined) return read;
    return read.value["errorId"] === errorId &&
      read.value["runId"] === runId &&
      read.value["runDraftId"] === undefined &&
      isSafeDiagnosticRecord(read.value)
      ? read
      : this.invalidRecord("AGENT_RUN_ERROR_RECORD_INVALID");
  }

  public async writePreflightError(record: JsonObject): Promise<Result<JsonObject, UnifiedError>> {
    const errorId = readSafeString(record, "errorId");
    const runDraftId = readSafeString(record, "runDraftId");
    if (
      errorId === undefined ||
      runDraftId === undefined ||
      record["runId"] !== undefined ||
      !isSafeDiagnosticRecord(record)
    ) {
      return this.invalidRecord("AGENT_RUN_ERROR_RECORD_INVALID");
    }
    const written = await this.writeImmutableJson(
      this.preflightErrorPath(errorId),
      record,
      "AGENT_RUN_ERROR_RECORD_CONFLICT"
    );
    if (!written.ok) return written;
    const retained = await this.enforcePreflightErrorRetention();
    return retained.ok ? written : retained;
  }

  public async readPreflightError(
    errorId: string
  ): Promise<Result<JsonObject | undefined, UnifiedError>> {
    if (!isSafeId(errorId)) return this.invalidRecord("AGENT_RUN_ERROR_RECORD_INVALID");
    const read = await this.readJson(this.preflightErrorPath(errorId));
    if (!read.ok || read.value === undefined) return read;
    return read.value["errorId"] === errorId &&
      typeof read.value["runDraftId"] === "string" &&
      read.value["runId"] === undefined &&
      isSafeDiagnosticRecord(read.value)
      ? read
      : this.invalidRecord("AGENT_RUN_ERROR_RECORD_INVALID");
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

  public writePromptMaterialization(
    runId: string,
    artifact: JsonObject
  ): Promise<Result<JsonObject, UnifiedError>> {
    const artifactId = readSafeString(artifact, "artifactId");
    const contextSnapshotId = readSafeString(artifact, "contextSnapshotId");
    if (
      !isSafeId(runId) ||
      artifactId === undefined ||
      contextSnapshotId === undefined ||
      artifact["runId"] !== runId ||
      (artifact["schemaVersion"] !== "1.0" &&
        artifact["schemaVersion"] !== "1.1" &&
        artifact["schemaVersion"] !== "2.0")
    ) {
      return Promise.resolve(this.invalidRecord("AGENT_PROMPT_MATERIALIZATION_INVALID"));
    }
    return this.writeJson(
      this.runPath(runId, join("prompt-materializations", `${artifactId}.json`)),
      artifact
    );
  }

  public async readPromptMaterialization(
    runId: string,
    artifactId: string
  ): Promise<Result<JsonObject | undefined, UnifiedError>> {
    if (!isSafeId(runId) || !isSafeId(artifactId)) {
      return this.invalidRecord("AGENT_PROMPT_MATERIALIZATION_INVALID");
    }
    const read = await this.readJson(
      this.runPath(runId, join("prompt-materializations", `${artifactId}.json`))
    );
    if (!read.ok || read.value === undefined) return read;
    return read.value["runId"] === runId &&
      read.value["artifactId"] === artifactId &&
      (read.value["schemaVersion"] === "1.0" ||
        read.value["schemaVersion"] === "1.1" ||
        read.value["schemaVersion"] === "2.0")
      ? read
      : this.invalidRecord("AGENT_PROMPT_MATERIALIZATION_INVALID");
  }

  public writePromptCacheArtifact(
    runId: string,
    artifact: JsonObject
  ): Promise<Result<JsonObject, UnifiedError>> {
    const artifactId = readSafeString(artifact, "artifactId");
    if (!isSafeId(runId) || artifactId === undefined || !isPromptCacheArtifactEnvelope(artifact)) {
      return Promise.resolve(this.invalidRecord("AGENT_PROMPT_CACHE_ARTIFACT_INVALID"));
    }
    return this.writeImmutableJson(
      this.runPath(runId, join("prompt-cache-artifacts", `${artifactId}.json`)),
      artifact,
      "AGENT_PROMPT_CACHE_ARTIFACT_CONFLICT"
    );
  }

  public async readPromptCacheArtifact(
    runId: string,
    artifactId: string
  ): Promise<Result<JsonObject | undefined, UnifiedError>> {
    if (!isSafeId(runId) || !isSafeId(artifactId)) {
      return this.invalidRecord("AGENT_PROMPT_CACHE_ARTIFACT_INVALID");
    }
    const read = await this.readJson(
      this.runPath(runId, join("prompt-cache-artifacts", `${artifactId}.json`))
    );
    if (!read.ok || read.value === undefined) return read;
    return read.value["artifactId"] === artifactId && isPromptCacheArtifactEnvelope(read.value)
      ? read
      : this.invalidRecord("AGENT_PROMPT_CACHE_ARTIFACT_INVALID");
  }

  public writeContextSourceMaterialization(
    runId: string,
    artifact: JsonObject
  ): Promise<Result<JsonObject, UnifiedError>> {
    const artifactId = readSafeString(artifact, "artifactId");
    if (
      !isSafeId(runId) ||
      artifactId === undefined ||
      artifact["schemaVersion"] !== "1.0" ||
      (artifact["sourceKind"] !== "project_conventions" &&
        artifact["sourceKind"] !== "workspace_outline")
    ) {
      return Promise.resolve(this.invalidRecord("AGENT_CONTEXT_SOURCE_MATERIALIZATION_INVALID"));
    }
    return this.writeImmutableJson(
      this.runPath(runId, join("context-source-materializations", `${artifactId}.json`)),
      artifact,
      "AGENT_CONTEXT_SOURCE_MATERIALIZATION_CONFLICT"
    );
  }

  public async readContextSourceMaterialization(
    runId: string,
    artifactId: string
  ): Promise<Result<JsonObject | undefined, UnifiedError>> {
    if (!isSafeId(runId) || !isSafeId(artifactId)) {
      return this.invalidRecord("AGENT_CONTEXT_SOURCE_MATERIALIZATION_INVALID");
    }
    const read = await this.readJson(
      this.runPath(runId, join("context-source-materializations", `${artifactId}.json`))
    );
    if (!read.ok || read.value === undefined) return read;
    return read.value["schemaVersion"] === "1.0" && read.value["artifactId"] === artifactId
      ? read
      : this.invalidRecord("AGENT_CONTEXT_SOURCE_MATERIALIZATION_INVALID");
  }

  public writePlanArtifact(plan: JsonObject): Promise<Result<JsonObject, UnifiedError>> {
    const planId = readSafeString(plan, "planId");
    const revision = plan["revision"];
    if (planId === undefined || !Number.isInteger(revision) || Number(revision) < 1) {
      return Promise.resolve(this.invalidRecord("AGENT_PLAN_ARTIFACT_INVALID"));
    }
    return this.writeJson(this.planArtifactPath(planId, Number(revision)), plan);
  }

  public async readPlanArtifact(
    planId: string,
    revision: number
  ): Promise<Result<JsonObject | undefined, UnifiedError>> {
    if (!isSafeId(planId) || !Number.isSafeInteger(revision) || revision < 1) {
      return this.invalidRecord("AGENT_PLAN_ARTIFACT_INVALID");
    }
    const read = await this.readJson(this.planArtifactPath(planId, revision));
    if (!read.ok || read.value === undefined) return read;
    return read.value["planId"] === planId && read.value["revision"] === revision
      ? read
      : this.invalidRecord("AGENT_PLAN_ARTIFACT_INVALID");
  }

  public async writePlanExecutionRecord(
    record: JsonObject
  ): Promise<Result<JsonObject, UnifiedError>> {
    const runId = readRunId(record);
    const planExecutionId = readSafeString(record, "planExecutionId");
    const revision = record["revision"];
    if (
      runId === undefined ||
      planExecutionId === undefined ||
      !Number.isSafeInteger(revision) ||
      Number(revision) < 1
    ) {
      return this.invalidRecord("AGENT_PLAN_EXECUTION_INVALID");
    }
    const existing = await this.readPlanExecutionRecord(runId, planExecutionId, Number(revision));
    if (!existing.ok) return existing;
    if (existing.value !== undefined) {
      return JSON.stringify(existing.value) === JSON.stringify(record)
        ? ok(existing.value)
        : this.invalidRecord("AGENT_PLAN_EXECUTION_REVISION_CONFLICT");
    }
    return this.writeJson(this.planExecutionPath(runId, planExecutionId, Number(revision)), record);
  }

  public async readPlanExecutionRecord(
    runId: string,
    planExecutionId: string,
    revision?: number
  ): Promise<Result<JsonObject | undefined, UnifiedError>> {
    if (
      !isSafeId(runId) ||
      !isSafeId(planExecutionId) ||
      (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1))
    ) {
      return this.invalidRecord("AGENT_PLAN_EXECUTION_INVALID");
    }
    const resolvedRevision =
      revision ?? (await this.latestPlanExecutionRevision(runId, planExecutionId));
    if (resolvedRevision === undefined) return ok(undefined);
    const read = await this.readJson(
      this.planExecutionPath(runId, planExecutionId, resolvedRevision)
    );
    if (!read.ok || read.value === undefined) return read;
    return read.value["runId"] === runId &&
      read.value["planExecutionId"] === planExecutionId &&
      read.value["revision"] === resolvedRevision
      ? read
      : this.invalidRecord("AGENT_PLAN_EXECUTION_INVALID");
  }

  public async writePlanRevisionRequest(
    request: JsonObject
  ): Promise<Result<JsonObject, UnifiedError>> {
    const runId = readRunId(request);
    const requestId = readSafeString(request, "requestId");
    const planExecutionId = readSafeString(request, "planExecutionId");
    const planId = readSafeString(request, "planId");
    const planRevision = request["planRevision"];
    if (
      runId === undefined ||
      requestId === undefined ||
      planExecutionId === undefined ||
      planId === undefined ||
      !Number.isSafeInteger(planRevision) ||
      Number(planRevision) < 1
    ) {
      return this.invalidRecord("AGENT_PLAN_REVISION_REQUEST_INVALID");
    }
    const existing = await this.readPlanRevisionRequest(runId, requestId);
    if (!existing.ok) return existing;
    if (existing.value !== undefined) {
      return JSON.stringify(existing.value) === JSON.stringify(request)
        ? ok(existing.value)
        : this.invalidRecord("AGENT_PLAN_REVISION_REQUEST_CONFLICT");
    }
    return this.writeJson(
      this.runPath(runId, join("plan-revision-requests", `${requestId}.json`)),
      request
    );
  }

  public readPlanRevisionRequest(
    runId: string,
    requestId: string
  ): Promise<Result<JsonObject | undefined, UnifiedError>> {
    if (!isSafeId(runId) || !isSafeId(requestId)) {
      return Promise.resolve(this.invalidRecord("AGENT_PLAN_REVISION_REQUEST_INVALID"));
    }
    return this.readJson(this.runPath(runId, join("plan-revision-requests", `${requestId}.json`)));
  }

  public async writePlanRevisionDecision(
    decision: JsonObject
  ): Promise<Result<JsonObject, UnifiedError>> {
    const runId = readRunId(decision);
    const requestId = readSafeString(decision, "requestId");
    const planExecutionId = readSafeString(decision, "planExecutionId");
    const planId = readSafeString(decision, "planId");
    const commandId = readSafeString(decision, "commandId");
    const planRevision = decision["planRevision"];
    const planExecutionRevision = decision["planExecutionRevision"];
    if (
      runId === undefined ||
      requestId === undefined ||
      planExecutionId === undefined ||
      planId === undefined ||
      commandId === undefined ||
      !Number.isSafeInteger(planRevision) ||
      Number(planRevision) < 1 ||
      !Number.isSafeInteger(planExecutionRevision) ||
      Number(planExecutionRevision) < 1 ||
      (decision["decision"] !== "approve" && decision["decision"] !== "reject")
    ) {
      return this.invalidRecord("AGENT_PLAN_REVISION_DECISION_INVALID");
    }
    const existing = await this.readPlanRevisionDecision(runId, requestId);
    if (!existing.ok) return existing;
    if (existing.value !== undefined) {
      return JSON.stringify(existing.value) === JSON.stringify(decision)
        ? ok(existing.value)
        : this.invalidRecord("AGENT_PLAN_REVISION_DECISION_CONFLICT");
    }
    return this.writeJson(
      this.runPath(runId, join("plan-revision-decisions", `${requestId}.json`)),
      decision
    );
  }

  public readPlanRevisionDecision(
    runId: string,
    requestId: string
  ): Promise<Result<JsonObject | undefined, UnifiedError>> {
    if (!isSafeId(runId) || !isSafeId(requestId)) {
      return Promise.resolve(this.invalidRecord("AGENT_PLAN_REVISION_DECISION_INVALID"));
    }
    return this.readJson(this.runPath(runId, join("plan-revision-decisions", `${requestId}.json`)));
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
    if (
      !isSafeId(changeSetId) ||
      (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1))
    ) {
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
    if (event["schemaVersion"] === "2.0") {
      return this.invalidRecord("AGENT_RUN_EVENT_V20_REQUIRES_STRICT_WRITER");
    }
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

  /** Append a strict 2.0 event; the event list must not contain legacy records. */
  public async appendEventV20(
    event: AgentRunEventV20
  ): Promise<Result<AgentRunEventV20, UnifiedError>> {
    const recovered = await this.recoverRunStateV20(event.runId);
    if (!recovered.ok) return recovered as Result<AgentRunEventV20, UnifiedError>;
    return this.appendEventV20Direct(event);
  }

  private async appendEventV20Direct(
    event: AgentRunEventV20
  ): Promise<Result<AgentRunEventV20, UnifiedError>> {
    const validated = validateAgentRunEventV20(event);
    if (!validated.ok) return validated;
    const path = this.runPath(event.runId, "events.json");
    const existing = await this.readJsonArray(path);
    if (!existing.ok) return existing as Result<AgentRunEventV20, UnifiedError>;
    if (existing.value.some((record) => record["schemaVersion"] !== "2.0")) {
      return this.invalidRecord("AGENT_RUN_EVENT_V20_LEGACY_CONFLICT");
    }
    const prior = existing.value.map((record) => {
      const parsed = validateAgentRunEventV20(record);
      return parsed.ok ? parsed.value : undefined;
    });
    if (prior.some((record) => record === undefined)) {
      return this.invalidRecord("AGENT_RUN_EVENT_V20_INVALID");
    }
    if (
      prior.some(
        (record) =>
          record !== undefined &&
          (record.runId !== event.runId ||
            record.runRevision > event.runRevision ||
            JSON.stringify(record.scope) !== JSON.stringify(event.scope))
      )
    ) {
      return this.invalidRecord("AGENT_RUN_EVENT_V20_SCOPE_INVALID");
    }
    const duplicate = prior.find((record) => record?.sequence === event.sequence);
    if (duplicate !== undefined) {
      return JSON.stringify(duplicate) === JSON.stringify(event)
        ? ok(duplicate)
        : this.invalidRecord("AGENT_RUN_EVENT_V20_SEQUENCE_INVALID");
    }
    const last = prior[prior.length - 1];
    if (
      (last === undefined &&
        (event.sequence !== 1 || event.runRevision !== 1 || event.type !== "run_started")) ||
      (last !== undefined &&
        (event.sequence !== last.sequence + 1 || event.runRevision !== last.runRevision + 1))
    ) {
      return this.invalidRecord("AGENT_RUN_EVENT_V20_SEQUENCE_INVALID");
    }
    const written = await this.writeJson(path, [...existing.value, event as unknown as JsonObject]);
    return written.ok ? ok(validated.value) : (written as Result<AgentRunEventV20, UnifiedError>);
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

  /** Read only a strict 2.0 snapshot. Legacy records are returned as a version conflict. */
  public async readSnapshotV20(
    runId: string
  ): Promise<Result<AgentRunSnapshotV20 | undefined, UnifiedError>> {
    if (!isSafeId(runId)) return this.invalidRecord("AGENT_RUN_SNAPSHOT_V20_INVALID");
    const recovered = await this.recoverRunStateV20(runId);
    if (!recovered.ok) return recovered;
    const read = await this.readJson(this.runPath(runId, "run.json"));
    if (!read.ok) return read as Result<AgentRunSnapshotV20 | undefined, UnifiedError>;
    if (read.value === undefined) {
      const orphanedEvents = await this.readJsonArray(this.runPath(runId, "events.json"));
      if (!orphanedEvents.ok) {
        return orphanedEvents as Result<AgentRunSnapshotV20 | undefined, UnifiedError>;
      }
      return orphanedEvents.value.length === 0
        ? ok(undefined)
        : this.invalidRecord("AGENT_RUN_V20_HISTORY_INVALID");
    }
    if (read.value["schemaVersion"] !== "2.0") {
      return this.invalidRecord("AGENT_RUN_SNAPSHOT_V20_LEGACY_RECORD");
    }
    if (read.value["runId"] !== runId) return this.invalidRecord("AGENT_RUN_SNAPSHOT_V20_INVALID");
    const parsed = validateAgentRunSnapshotV20(read.value);
    if (!parsed.ok) return this.invalidRecord("AGENT_RUN_SNAPSHOT_V20_INVALID");
    const records = await this.readJsonArray(this.runPath(runId, "events.json"));
    if (!records.ok) return records as Result<AgentRunSnapshotV20 | undefined, UnifiedError>;
    const history = validateAgentRunHistoryV20({ snapshot: parsed.value, events: records.value });
    return history.ok ? ok(history.value.snapshot) : this.invalidRecord(history.error.code);
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

  public writeCompactionSummaryArtifact(
    runId: string,
    artifact: JsonObject
  ): Promise<Result<JsonObject, UnifiedError>> {
    const artifactId = readSafeString(artifact, "artifactId");
    const compactionId = readSafeString(artifact, "compactionId");
    if (
      !isSafeId(runId) ||
      artifactId === undefined ||
      compactionId === undefined ||
      artifact["runId"] !== runId ||
      !isCompactionSummaryArtifact(artifact)
    ) {
      return Promise.resolve(this.invalidRecord("AGENT_COMPACTION_SUMMARY_ARTIFACT_INVALID"));
    }
    return this.writeImmutableJson(
      this.runPath(runId, join("compaction-summaries", `${artifactId}.json`)),
      artifact,
      "AGENT_COMPACTION_SUMMARY_ARTIFACT_CONFLICT"
    );
  }

  public async readCompactionSummaryArtifact(
    runId: string,
    artifactId: string
  ): Promise<Result<JsonObject | undefined, UnifiedError>> {
    if (!isSafeId(runId) || !isSafeId(artifactId)) {
      return this.invalidRecord("AGENT_COMPACTION_SUMMARY_ARTIFACT_INVALID");
    }
    const read = await this.readJson(
      this.runPath(runId, join("compaction-summaries", `${artifactId}.json`))
    );
    if (!read.ok || read.value === undefined) return read;
    return read.value["runId"] === runId &&
      read.value["artifactId"] === artifactId &&
      isCompactionSummaryArtifact(read.value)
      ? read
      : this.invalidRecord("AGENT_COMPACTION_SUMMARY_ARTIFACT_INVALID");
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
    const complete = await this.compactionArtifactsExist(runId, activeCompactionId);
    if (!complete.ok) return complete as Result<JsonObject, UnifiedError>;
    if (!complete.value) return this.invalidRecord("AGENT_COMPACTION_COMMIT_INVALID");
    const existing = await this.readJson(this.runPath(runId, "run.json"));
    if (!existing.ok) return existing as Result<JsonObject, UnifiedError>;
    if (
      existing.value !== undefined &&
      existing.value["activeCompactionId"] === activeCompactionId
    ) {
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
    let resultSnapshot: JsonObject | undefined;
    if (typeof resultSnapshotId === "string" && resultSnapshotId.length > 0) {
      const result = await this.readContextSnapshot(runId, resultSnapshotId);
      if (!result.ok) return result as Result<boolean, UnifiedError>;
      if (result.value === undefined) return ok(false);
      resultSnapshot = result.value;
    }
    const budgetSnapshotId = revision.value["budgetSnapshotId"];
    if (typeof budgetSnapshotId === "string" && budgetSnapshotId.length > 0) {
      const budget = await this.readBudgetSnapshot(runId, budgetSnapshotId);
      if (!budget.ok) return budget as Result<boolean, UnifiedError>;
      if (budget.value === undefined) return ok(false);
    }
    if (revision.value["strategy"] === "model_assisted") {
      if (resultSnapshot === undefined) return ok(false);
      const sources = resultSnapshot["sources"];
      if (!Array.isArray(sources)) return ok(false);
      const summaries = sources.filter(
        (source): source is JsonObject =>
          isJsonObject(source) &&
          source["sourceKind"] === "compaction_summary" &&
          source["state"] !== "excluded"
      );
      if (summaries.length !== 1) return ok(false);
      const summarySource = summaries[0];
      if (summarySource === undefined) return ok(false);
      const summaryArtifactId = readSafeString(summarySource, "assetId");
      const promptArtifactId = readSafeString(summarySource, "artifactId");
      if (summaryArtifactId === undefined || promptArtifactId === undefined) return ok(false);
      const summary = await this.readCompactionSummaryArtifact(runId, summaryArtifactId);
      if (!summary.ok) return summary as Result<boolean, UnifiedError>;
      if (summary.value === undefined) return ok(false);
      if (
        summary.value["compactionId"] !== compactionId ||
        summary.value["sourceSnapshotId"] !== revision.value["sourceSnapshotId"] ||
        summary.value["throughSequence"] !== revision.value["throughSequence"] ||
        summary.value["inputManifestChecksum"] !== revision.value["inputManifestChecksum"] ||
        summary.value["contextProfileId"] !== resultSnapshot["contextProfileId"] ||
        summary.value["checksum"] !== revision.value["summaryChecksum"] ||
        summarySource["checksum"] !== summary.value["checksum"] ||
        summarySource["sourceRevision"] !== summary.value["throughSequence"]
      ) {
        return ok(false);
      }
      const prompt = await this.readPromptMaterialization(runId, promptArtifactId);
      if (!prompt.ok) return prompt as Result<boolean, UnifiedError>;
      if (
        prompt.value === undefined ||
        prompt.value["contextSnapshotId"] !== resultSnapshotId ||
        !promptContainsSummary(prompt.value, summary.value)
      ) {
        return ok(false);
      }
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
    return this.readLegacyEvents(runId);
  }

  private async readLegacyEvents(runId: string): Promise<Result<JsonObject[], UnifiedError>> {
    const read = await this.readJsonArray(this.runPath(runId, "events.json"));
    if (!read.ok) return read;
    return read.value.every(isSupportedAgentSchemaVersion)
      ? read
      : this.invalidRecord("AGENT_RUN_EVENT_VERSION_UNSUPPORTED");
  }

  /** Read and validate only strict 2.0 events. Legacy event arrays are not normalized. */
  public async readEventsV20(runId: string): Promise<Result<AgentRunEventV20[], UnifiedError>> {
    if (!isSafeId(runId)) return this.invalidRecord("AGENT_RUN_EVENT_V20_INVALID");
    const recovered = await this.recoverRunStateV20(runId);
    if (!recovered.ok) return recovered as Result<AgentRunEventV20[], UnifiedError>;
    const records = await this.readJsonArray(this.runPath(runId, "events.json"));
    if (!records.ok) return records as Result<AgentRunEventV20[], UnifiedError>;
    const snapshot = await this.readJson(this.runPath(runId, "run.json"));
    if (!snapshot.ok) return snapshot as Result<AgentRunEventV20[], UnifiedError>;
    if (snapshot.value === undefined) {
      return records.value.length === 0
        ? ok([])
        : this.invalidRecord("AGENT_RUN_V20_HISTORY_INVALID");
    }
    const history = validateAgentRunHistoryV20({ snapshot: snapshot.value, events: records.value });
    return history.ok ? ok([...history.value.events]) : this.invalidRecord(history.error.code);
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

  public readRetryCheckpoint(runId: string): Promise<Result<JsonObject | undefined, UnifiedError>> {
    return this.readJson(this.runPath(runId, "retry-checkpoint.json"));
  }

  public async listSnapshots(projectId?: string): Promise<Result<JsonObject[], UnifiedError>> {
    const root = join(this.options.projectRoot, "history", "agent-runs");
    try {
      const entries = await readdir(root, { withFileTypes: true });
      const snapshots: JsonObject[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory() || !isSafeId(entry.name)) continue;
        const envelope = await this.readJson(this.runPath(entry.name, "run.json"));
        if (!envelope.ok) return envelope;
        const snapshot =
          envelope.value?.["schemaVersion"] === "2.0"
            ? await this.readSnapshotV20(entry.name)
            : await this.readSnapshot(entry.name);
        if (!snapshot.ok) return snapshot as Result<JsonObject[], UnifiedError>;
        const value = snapshot.value as JsonObject | undefined;
        if (
          value !== undefined &&
          (projectId === undefined || snapshotWorkspaceId(value) === projectId)
        ) {
          snapshots.push(value);
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

  private async performV20Commit(input: {
    readonly snapshot: AgentRunSnapshotV20;
    readonly event: AgentRunEventV20;
  }): Promise<Result<AgentRunSnapshotV20, UnifiedError>> {
    const pair = validateAgentRunStatePairV20(input);
    if (!pair.ok) return pair as Result<AgentRunSnapshotV20, UnifiedError>;
    const snapshot = pair.value.snapshot;
    const event = pair.value.event;
    const recovered = await this.recoverRunStateV20(snapshot.runId);
    if (!recovered.ok) return recovered as Result<AgentRunSnapshotV20, UnifiedError>;
    const transition = await this.validateV20CommitAgainstDisk(snapshot, event);
    if (!transition.ok) return transition;
    const commit: AgentRunStateCommitV20 = {
      schemaVersion: "2.0",
      commitId: `commit_${createHash("sha256")
        .update(`${snapshot.runId}:${String(event.sequence)}:${String(event.runRevision)}`)
        .digest("hex")
        .slice(0, 48)}`,
      runId: snapshot.runId,
      snapshot,
      event,
      createdAt: event.createdAt
    };
    const journal = await this.writeJson(
      this.v20CommitPath(commit.runId),
      commit as unknown as JsonObject
    );
    if (!journal.ok) return journal as Result<AgentRunSnapshotV20, UnifiedError>;
    const applied = await this.applyV20Commit(commit);
    if (!applied.ok) return applied;
    try {
      await unlink(this.v20CommitPath(commit.runId));
    } catch (error) {
      if (!isMissingFileError(error)) {
        // The committed pair remains recoverable and idempotent if cleanup is interrupted.
      }
    }
    return applied;
  }

  private async validateV20CommitAgainstDisk(
    snapshot: AgentRunSnapshotV20,
    event: AgentRunEventV20
  ): Promise<Result<AgentRunSnapshotV20, UnifiedError>> {
    const storedSnapshot = await this.readJson(this.runPath(snapshot.runId, "run.json"));
    if (!storedSnapshot.ok) return storedSnapshot as Result<AgentRunSnapshotV20, UnifiedError>;
    const storedEvents = await this.readJsonArray(this.runPath(snapshot.runId, "events.json"));
    if (!storedEvents.ok) return storedEvents as Result<AgentRunSnapshotV20, UnifiedError>;

    const parsedEvents: AgentRunEventV20[] = [];
    for (const record of storedEvents.value) {
      const parsed = validateAgentRunEventV20(record);
      if (!parsed.ok) return this.invalidRecord("AGENT_RUN_EVENT_V20_INVALID");
      parsedEvents.push(parsed.value);
    }
    const duplicate = parsedEvents.find((candidate) => candidate.sequence === event.sequence);
    if (duplicate !== undefined && JSON.stringify(duplicate) !== JSON.stringify(event)) {
      return this.invalidRecord("AGENT_RUN_EVENT_V20_SEQUENCE_INVALID");
    }
    const prospectiveEvents = duplicate === undefined ? [...parsedEvents, event] : parsedEvents;

    if (storedSnapshot.value !== undefined) {
      const previous = validateAgentRunSnapshotV20(storedSnapshot.value);
      if (!previous.ok) return this.invalidRecord("AGENT_RUN_SNAPSHOT_V20_INVALID");
      if (previous.value.runRevision === snapshot.runRevision) {
        if (JSON.stringify(previous.value) !== JSON.stringify(snapshot)) {
          return this.invalidRecord("AGENT_RUN_SNAPSHOT_V20_REVISION_INVALID");
        }
      } else {
        if (
          previous.value.runRevision + 1 !== snapshot.runRevision ||
          previous.value.lastSequence + 1 !== snapshot.lastSequence ||
          !v20ImmutableFieldsMatch(previous.value, snapshot)
        ) {
          return this.invalidRecord("AGENT_RUN_SNAPSHOT_V20_REVISION_INVALID");
        }
        const previousEvents = prospectiveEvents.filter(
          (candidate) => candidate.sequence <= previous.value.lastSequence
        );
        if (!validateAgentRunHistoryV20({ snapshot: previous.value, events: previousEvents }).ok) {
          return this.invalidRecord("AGENT_RUN_V20_HISTORY_INVALID");
        }
      }
    }

    const history = validateAgentRunHistoryV20({ snapshot, events: prospectiveEvents });
    return history.ok ? ok(history.value.snapshot) : this.invalidRecord(history.error.code);
  }

  private async applyV20Commit(
    commit: AgentRunStateCommitV20
  ): Promise<Result<AgentRunSnapshotV20, UnifiedError>> {
    const event = await this.appendEventV20Direct(commit.event);
    if (!event.ok) return event as Result<AgentRunSnapshotV20, UnifiedError>;
    return this.writeSnapshotV20Direct(commit.snapshot);
  }

  private v20CommitPath(runId: string): string {
    return this.runPath(runId, "v20-state-commit.json");
  }

  private runPath(runId: string, suffix: string): string {
    if (!isSafeId(runId)) {
      throw new Error("Agent run ID is invalid.");
    }
    return join(this.options.projectRoot, "history", "agent-runs", runId, suffix);
  }

  private preflightErrorPath(errorId: string): string {
    if (!isSafeId(errorId)) throw new Error("Agent error ID is invalid.");
    return join(this.options.projectRoot, "history", "agent-diagnostics", `${errorId}.json`);
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

  private planArtifactPath(planId: string, revision: number): string {
    return join(
      this.options.projectRoot,
      "history",
      "plans",
      planId,
      "revisions",
      `${String(revision)}.json`
    );
  }

  private planExecutionPath(runId: string, planExecutionId: string, revision: number): string {
    return this.runPath(
      runId,
      join("plan-executions", planExecutionId, "revisions", `${String(revision)}.json`)
    );
  }

  private async latestPlanExecutionRevision(
    runId: string,
    planExecutionId: string
  ): Promise<number | undefined> {
    try {
      const entries = await readdir(
        this.runPath(runId, join("plan-executions", planExecutionId, "revisions"))
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

  private writeImmutableJson(
    path: string,
    value: JsonObject,
    conflictCode: string
  ): Promise<Result<JsonObject, UnifiedError>> {
    const previous = this.immutableWriteQueues.get(path) ?? Promise.resolve();
    const request = previous.then(
      () => this.performImmutableJsonWrite(path, value, conflictCode),
      () => this.performImmutableJsonWrite(path, value, conflictCode)
    );
    this.immutableWriteQueues.set(path, request);
    const clear = () => {
      if (this.immutableWriteQueues.get(path) === request) {
        this.immutableWriteQueues.delete(path);
      }
    };
    void request.then(clear, clear);
    return request;
  }

  private async performImmutableJsonWrite(
    path: string,
    value: JsonObject,
    conflictCode: string
  ): Promise<Result<JsonObject, UnifiedError>> {
    const existing = await this.readJson(path);
    if (!existing.ok) return existing as Result<JsonObject, UnifiedError>;
    if (existing.value !== undefined) {
      return JSON.stringify(existing.value) === JSON.stringify(value)
        ? ok(existing.value)
        : this.invalidRecord(conflictCode);
    }
    return this.writeJson(path, value);
  }

  private async enforcePreflightErrorRetention(): Promise<Result<JsonObject, UnifiedError>> {
    const root = join(this.options.projectRoot, "history", "agent-diagnostics");
    try {
      const entries = await readdir(root, { withFileTypes: true });
      const records: Array<{
        readonly path: string;
        readonly errorId: string;
        readonly createdAt: string;
        readonly bytes: number;
      }> = [];
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const errorId = entry.name.slice(0, -5);
        if (!isSafeId(errorId)) continue;
        const path = join(root, entry.name);
        const content = await readFile(path);
        let createdAt = "";
        try {
          const parsed = JSON.parse(content.toString("utf8")) as unknown;
          createdAt =
            isJsonObject(parsed) && typeof parsed["createdAt"] === "string"
              ? parsed["createdAt"]
              : "";
        } catch {
          // Invalid records sort oldest and are removed before valid diagnostics.
        }
        records.push({ path, errorId, createdAt, bytes: content.byteLength });
      }
      records.sort((left, right) => {
        const created = left.createdAt.localeCompare(right.createdAt);
        return created === 0 ? left.errorId.localeCompare(right.errorId) : created;
      });
      let totalBytes = records.reduce((total, record) => total + record.bytes, 0);
      while (
        records.length > this.preflightErrorMaxRecords ||
        totalBytes > this.preflightErrorMaxBytes
      ) {
        const oldest = records.shift();
        if (oldest === undefined) break;
        await unlink(oldest.path);
        totalBytes -= oldest.bytes;
      }
      return ok({ count: records.length, totalBytes });
    } catch (error) {
      return isMissingFileError(error)
        ? ok({ count: 0, totalBytes: 0 })
        : err(this.storageFailure("AGENT_RUN_ERROR_RETENTION_FAILED", error));
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

function snapshotWorkspaceId(snapshot: JsonObject): string | undefined {
  if (typeof snapshot["projectId"] === "string") return snapshot["projectId"];
  const scope = snapshot["scope"];
  if (!isJsonObject(scope) || scope["kind"] !== "workspace") return undefined;
  return typeof scope["workspaceId"] === "string" ? scope["workspaceId"] : undefined;
}

function readRunId(value: JsonObject): string | undefined {
  return typeof value["runId"] === "string" && isSafeId(value["runId"])
    ? value["runId"]
    : undefined;
}

function parseAgentRunStateCommitV20(value: JsonObject): AgentRunStateCommitV20 | undefined {
  const commitId = typeof value["commitId"] === "string" ? value["commitId"] : undefined;
  const runId = typeof value["runId"] === "string" ? value["runId"] : undefined;
  const createdAt = typeof value["createdAt"] === "string" ? value["createdAt"] : undefined;
  if (
    Object.keys(value).length !== 6 ||
    !["schemaVersion", "commitId", "runId", "snapshot", "event", "createdAt"].every(
      (field) => field in value
    ) ||
    value["schemaVersion"] !== "2.0" ||
    commitId === undefined ||
    !isSafeId(commitId) ||
    runId === undefined ||
    !isSafeId(runId) ||
    createdAt === undefined ||
    !isJsonObject(value["snapshot"]) ||
    !isJsonObject(value["event"])
  ) {
    return undefined;
  }
  const pair = validateAgentRunStatePairV20({
    snapshot: value["snapshot"],
    event: value["event"]
  });
  if (!pair.ok || runId !== pair.value.snapshot.runId || createdAt !== pair.value.event.createdAt) {
    return undefined;
  }
  return runId === pair.value.event.runId
    ? {
        schemaVersion: "2.0",
        commitId,
        runId,
        snapshot: pair.value.snapshot,
        event: pair.value.event,
        createdAt
      }
    : undefined;
}

function v20ImmutableFieldsMatch(
  previous: AgentRunSnapshotV20,
  next: AgentRunSnapshotV20
): boolean {
  return [
    "runId",
    "scope",
    "conversationId",
    "operationMode",
    "contextMode",
    "writePolicy",
    "userRequest",
    "startedAt",
    "limits",
    "providerCapabilitySnapshot",
    "modelProfileId",
    "reasoningEffort",
    "toolFacadeVersion",
    "toolCatalogSnapshotId",
    "toolCatalogRevision",
    "contextProfileId",
    "profileVersion",
    "guidanceTemplateChecksum",
    "finishContractVersion",
    "executionWritePolicyDraft",
    "providerSemanticVersionSetChecksum",
    "authority",
    "protocol",
    "catalog"
  ].every(
    (field) =>
      JSON.stringify(previous[field as keyof AgentRunSnapshotV20]) ===
      JSON.stringify(next[field as keyof AgentRunSnapshotV20])
  );
}

/**
 * A persisted run snapshot is readable when its schemaVersion is a version this build understands
 * (v1.0 through v1.3) or is absent (a minimal legacy fixture). An explicit unknown/future version is
 * rejected so it is never silently normalized as v1.0. Reads never rewrite the file.
 */
function isSupportedAgentSchemaVersion(value: JsonObject): boolean {
  const version = value["schemaVersion"];
  return (
    version === undefined ||
    version === "1.0" ||
    version === "1.1" ||
    version === "1.2" ||
    version === "1.3"
  );
}

const LEGACY_TOOL_CATALOG_FIELDS = new Set([
  "schemaVersion",
  "toolCatalogSnapshotId",
  "runId",
  "facadeVersion",
  "descriptors",
  "descriptorRevision",
  "providerMappingRevision",
  "catalogRevision",
  "createdAt"
]);

function hasStrictToolCatalogEnvelope(value: JsonObject): boolean {
  return value["schemaVersion"] === "2.0"
    ? true
    : value["schemaVersion"] === "1.0" && hasExactlyJsonFields(value, LEGACY_TOOL_CATALOG_FIELDS);
}

function isPromptCacheArtifactEnvelope(value: JsonObject): boolean {
  const version = value["schemaVersion"];
  const fields =
    version === "1.0"
      ? PROMPT_CACHE_ARTIFACT_FIELDS_V1
      : version === "2.0"
        ? PROMPT_CACHE_ARTIFACT_FIELDS_V2
        : undefined;
  if (fields === undefined || !hasExactlyJsonFields(value, fields)) return false;
  const { artifactChecksum, ...unsigned } = value;
  void artifactChecksum;
  const capability = value["capability"];
  const scope = value["scope"];
  if (
    !isPromptCacheCapability(capability) ||
    !isPromptCacheScope(scope) ||
    !promptCacheProfileMatchesScope(value["contextProfileId"], scope) ||
    readSafeString(value, "artifactId") === undefined ||
    readSafeString(value, "runBindingId") === undefined ||
    !isNonEmptyString(value["provider"]) ||
    !isNonEmptyString(value["modelName"]) ||
    !isChecksum(value["connectionIdentityChecksum"]) ||
    !isChecksum(value["accountIsolationChecksum"]) ||
    !isNonEmptyString(value["adapterVersion"]) ||
    !isNonEmptyString(value["profileVersion"]) ||
    !isChecksum(value["guidanceTemplateChecksum"]) ||
    !isNonEmptyString(value["toolCatalogRevision"]) ||
    !isChecksum(value["logicalPrefixChecksum"]) ||
    !isPositiveInteger(value["stablePrefixMessageCount"]) ||
    !isNonNegativeInteger(value["eligibleInputTokens"]) ||
    !isUtcTimestamp(value["createdAt"]) ||
    !isChecksum(value["artifactChecksum"]) ||
    checksumText(stableSerialize(unsigned)) !== value["artifactChecksum"] ||
    containsForbiddenPromptCacheData(value)
  ) {
    return false;
  }
  const v2FieldsValid =
    version === "1.0" ||
    (isChecksum(value["providerSemanticVersionSetChecksum"]) &&
      (scope.kind === "standalone"
        ? value["canonicalRootIdentityChecksum"] === "not_applicable"
        : isChecksum(value["canonicalRootIdentityChecksum"])) &&
      isChecksum(value["effectiveCapabilityStateChecksum"]) &&
      isChecksum(value["providerToolProjectionChecksum"]) &&
      isNonEmptyString(value["policyRevision"]) &&
      (scope.kind === "standalone"
        ? value["sharingDefaultsRevision"] === "not_applicable" &&
          value["sharingGrantRevision"] === "not_applicable"
        : isChecksum(value["sharingDefaultsRevision"]) &&
          isChecksum(value["sharingGrantRevision"])));
  if (!v2FieldsValid) return false;

  const identityBaseMaterial =
    version === "1.0"
      ? {
          schemaVersion: version,
          provider: value["provider"],
          modelName: value["modelName"],
          connectionIdentityChecksum: value["connectionIdentityChecksum"],
          accountIsolationChecksum: value["accountIsolationChecksum"],
          adapterVersion: value["adapterVersion"],
          capability
        }
      : {
          schemaVersion: version,
          provider: value["provider"],
          modelName: value["modelName"],
          connectionIdentityChecksum: value["connectionIdentityChecksum"],
          accountIsolationChecksum: value["accountIsolationChecksum"],
          adapterVersion: value["adapterVersion"],
          capability,
          scope,
          contextProfileId: value["contextProfileId"],
          profileVersion: value["profileVersion"],
          guidanceTemplateChecksum: value["guidanceTemplateChecksum"],
          toolCatalogRevision: value["toolCatalogRevision"],
          providerSemanticVersionSetChecksum: value["providerSemanticVersionSetChecksum"],
          canonicalRootIdentityChecksum: value["canonicalRootIdentityChecksum"],
          effectiveCapabilityStateChecksum: value["effectiveCapabilityStateChecksum"],
          sharingDefaultsRevision: value["sharingDefaultsRevision"],
          sharingGrantRevision: value["sharingGrantRevision"],
          policyRevision: value["policyRevision"],
          providerToolProjectionChecksum: value["providerToolProjectionChecksum"]
        };
  const identityBaseChecksum = checksumText(stableSerialize(identityBaseMaterial));
  const identityChecksum = checksumText(
    stableSerialize({
      schemaVersion: version,
      identityBaseChecksum,
      logicalPrefixChecksum: value["logicalPrefixChecksum"]
    })
  );
  const artifactId = `prompt_cache_${checksumText(
    stableSerialize({ runBindingId: value["runBindingId"], identityChecksum })
  ).slice(0, 32)}`;
  const expiresAt =
    capability.ttlSeconds === null
      ? null
      : new Date(
          Date.parse(value["createdAt"] as string) + capability.ttlSeconds * 1_000
        ).toISOString();
  return (
    value["identityBaseChecksum"] === identityBaseChecksum &&
    value["identityChecksum"] === identityChecksum &&
    value["artifactId"] === artifactId &&
    value["expiresAt"] === expiresAt
  );
}

const PROMPT_CACHE_ARTIFACT_FIELDS_V1 = new Set([
  "schemaVersion",
  "artifactId",
  "runBindingId",
  "provider",
  "modelName",
  "connectionIdentityChecksum",
  "accountIsolationChecksum",
  "adapterVersion",
  "capability",
  "scope",
  "contextProfileId",
  "profileVersion",
  "guidanceTemplateChecksum",
  "toolCatalogRevision",
  "logicalPrefixChecksum",
  "stablePrefixMessageCount",
  "eligibleInputTokens",
  "identityBaseChecksum",
  "identityChecksum",
  "createdAt",
  "expiresAt",
  "artifactChecksum"
]);
const PROMPT_CACHE_ARTIFACT_FIELDS_V2 = new Set([
  ...PROMPT_CACHE_ARTIFACT_FIELDS_V1,
  "providerSemanticVersionSetChecksum",
  "canonicalRootIdentityChecksum",
  "effectiveCapabilityStateChecksum",
  "sharingDefaultsRevision",
  "sharingGrantRevision",
  "policyRevision",
  "providerToolProjectionChecksum"
]);
const PROMPT_CACHE_CAPABILITY_FIELDS = new Set([
  "mode",
  "policyVersion",
  "minimumCacheableTokens",
  "ttlSeconds",
  "inputTokenSemantics",
  "reportsCacheReadTokens",
  "reportsCacheWriteTokens"
]);
const STANDALONE_PROMPT_CACHE_SCOPE_FIELDS = new Set(["kind", "scopeId"]);
const WORKSPACE_PROMPT_CACHE_SCOPE_FIELDS = new Set(["kind", "workspaceKind", "workspaceId"]);

function isPromptCacheCapability(value: unknown): value is {
  readonly ttlSeconds: number | null;
} & JsonObject {
  if (!isJsonObject(value) || !hasExactlyJsonFields(value, PROMPT_CACHE_CAPABILITY_FIELDS)) {
    return false;
  }
  const ttlSeconds = value["ttlSeconds"];
  return (
    (value["mode"] === "none" ||
      value["mode"] === "automatic_prefix" ||
      value["mode"] === "explicit_breakpoints" ||
      value["mode"] === "explicit_resource") &&
    isNonEmptyString(value["policyVersion"]) &&
    isNonNegativeInteger(value["minimumCacheableTokens"]) &&
    (ttlSeconds === null || isPositiveInteger(ttlSeconds)) &&
    (value["inputTokenSemantics"] === "included_in_input" ||
      value["inputTokenSemantics"] === "excluded_from_input" ||
      value["inputTokenSemantics"] === "unavailable") &&
    typeof value["reportsCacheReadTokens"] === "boolean" &&
    typeof value["reportsCacheWriteTokens"] === "boolean"
  );
}

function isPromptCacheScope(value: unknown): value is JsonObject & {
  readonly kind: "standalone" | "workspace";
} {
  if (!isJsonObject(value)) return false;
  if (value["kind"] === "standalone") {
    return (
      hasExactlyJsonFields(value, STANDALONE_PROMPT_CACHE_SCOPE_FIELDS) &&
      value["scopeId"] === "standalone"
    );
  }
  return (
    value["kind"] === "workspace" &&
    hasExactlyJsonFields(value, WORKSPACE_PROMPT_CACHE_SCOPE_FIELDS) &&
    (value["workspaceKind"] === "creativeProject" ||
      value["workspaceKind"] === "engineeringWorkspace") &&
    typeof value["workspaceId"] === "string" &&
    isSafeId(value["workspaceId"])
  );
}

function promptCacheProfileMatchesScope(profile: unknown, scope: JsonObject): boolean {
  if (profile === "standalone") return scope["kind"] === "standalone";
  if (scope["kind"] !== "workspace") return false;
  return profile === "engineering"
    ? scope["workspaceKind"] === "engineeringWorkspace"
    : (profile === "writing" || profile === "creative_general") &&
        scope["workspaceKind"] === "creativeProject";
}

function containsForbiddenPromptCacheData(value: unknown): boolean {
  if (typeof value === "string") return value.includes("secret://");
  if (Array.isArray(value)) return value.some(containsForbiddenPromptCacheData);
  if (!isJsonObject(value)) return false;
  return Object.entries(value).some(
    ([key, child]) =>
      key === "resourceRef" ||
      key === "prompt" ||
      key === "path" ||
      containsForbiddenPromptCacheData(child)
  );
}

const COMPACTION_SUMMARY_FIELDS = {
  standalone: ["userGoal", "decisions", "constraints", "openQuestions", "nextSteps"],
  writing: ["plotFacts", "characterStates", "foreshadowing", "userDecisions"],
  creative_general: ["currentFiles", "userDecisions", "unfinishedItems", "nextSteps"],
  engineering: ["modifiedFiles", "changeIntent", "todos", "errorHighlights", "nextSteps"]
} as const;

function isCompactionSummaryArtifact(value: JsonObject): boolean {
  const profileId = value["contextProfileId"];
  const fields =
    typeof profileId === "string" && profileId in COMPACTION_SUMMARY_FIELDS
      ? COMPACTION_SUMMARY_FIELDS[profileId as keyof typeof COMPACTION_SUMMARY_FIELDS]
      : undefined;
  const provenance = value["provenance"];
  const body = value["body"];
  const precision = value["precision"];
  if (
    value["schemaVersion"] !== "1.0" ||
    readSafeString(value, "artifactId") === undefined ||
    readSafeString(value, "runId") === undefined ||
    readSafeString(value, "compactionId") === undefined ||
    fields === undefined ||
    readSafeString(value, "sourceSnapshotId") === undefined ||
    !isNonNegativeInteger(value["throughSequence"]) ||
    !isChecksum(value["inputManifestChecksum"]) ||
    typeof body !== "string" ||
    body.length === 0 ||
    !isJsonObject(provenance) ||
    provenance["kind"] !== "model_assisted" ||
    !isNonEmptyString(provenance["provider"]) ||
    !isNonEmptyString(provenance["model"]) ||
    !isNonEmptyString(provenance["modelProfileId"]) ||
    provenance["templateVersion"] !== "1.0" ||
    !isChecksum(provenance["inputChecksum"]) ||
    !isNonNegativeInteger(value["tokenCount"]) ||
    !isChecksum(value["checksum"]) ||
    (precision !== "reported" && precision !== "estimated") ||
    !isNonEmptyString(value["createdAt"]) ||
    !isChecksum(value["artifactChecksum"])
  ) {
    return false;
  }
  let parsed: JsonObject;
  try {
    const candidate = JSON.parse(body) as unknown;
    if (!isJsonObject(candidate)) return false;
    parsed = candidate;
  } catch {
    return false;
  }
  if (
    Object.keys(parsed).length !== fields.length ||
    !fields.every((field) => Object.prototype.hasOwnProperty.call(parsed, field)) ||
    !Object.entries(parsed).every(([field, fieldValue]) =>
      profileId === "standalone" && field === "userGoal"
        ? typeof fieldValue === "string"
        : Array.isArray(fieldValue) && fieldValue.every((item) => typeof item === "string")
    ) ||
    JSON.stringify(Object.fromEntries(fields.map((field) => [field, parsed[field]]))) !== body ||
    checksumText(body) !== value["checksum"]
  ) {
    return false;
  }
  const count = createDeterministicTokenEstimator().count(body, provenance["modelProfileId"]);
  if (count.tokens !== value["tokenCount"] || count.precision !== precision) return false;
  const unsigned = {
    schemaVersion: "1.0",
    artifactId: value["artifactId"],
    runId: value["runId"],
    compactionId: value["compactionId"],
    contextProfileId: profileId,
    sourceSnapshotId: value["sourceSnapshotId"],
    throughSequence: value["throughSequence"],
    inputManifestChecksum: value["inputManifestChecksum"],
    body,
    provenance,
    tokenCount: value["tokenCount"],
    checksum: value["checksum"],
    precision,
    createdAt: value["createdAt"]
  };
  return checksumText(stableSerialize(unsigned)) === value["artifactChecksum"];
}

function promptContainsSummary(prompt: JsonObject, summary: JsonObject): boolean {
  const sources = prompt["contextSources"];
  return (
    Array.isArray(sources) &&
    sources.some(
      (source) =>
        isJsonObject(source) &&
        source["sourceKind"] === "compaction_summary" &&
        source["assetId"] === summary["artifactId"] &&
        source["sourceRevision"] === summary["throughSequence"] &&
        source["content"] === summary["body"]
    )
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isUtcTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function isChecksum(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function checksumText(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableSerialize(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
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

function positiveLimit(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isSafeInteger(value) || value < 1 ? fallback : value;
}

const SENSITIVE_DIAGNOSTIC_KEY =
  /^(?:stack|stacktrace|api[_-]?key|authorization|proxy-authorization|cookie|set-cookie|password|passphrase|secret|client[_-]?secret|access[_-]?token|refresh[_-]?token)$/i;

function isSafeDiagnosticRecord(record: JsonObject): boolean {
  const detail = record["redactedDetail"];
  if (!isJsonObject(detail) || containsSensitiveDiagnosticKey(record, new WeakSet())) {
    return false;
  }
  try {
    return Buffer.byteLength(JSON.stringify(detail), "utf8") <= 8 * 1024;
  } catch {
    return false;
  }
}

function containsSensitiveDiagnosticKey(value: unknown, seen: WeakSet<object>): boolean {
  if (typeof value !== "object" || value === null) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) {
    return value.some((item) => containsSensitiveDiagnosticKey(item, seen));
  }
  return Object.entries(value).some(
    ([key, item]) =>
      SENSITIVE_DIAGNOSTIC_KEY.test(key) || containsSensitiveDiagnosticKey(item, seen)
  );
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyJsonFields(value: JsonObject, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((field) => allowed.has(field));
}

function hasExactlyJsonFields(value: JsonObject, expected: ReadonlySet<string>): boolean {
  return Object.keys(value).length === expected.size && hasOnlyJsonFields(value, expected);
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "ENOENT"
  );
}
