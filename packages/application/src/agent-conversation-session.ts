import {
  createUnifiedError,
  err,
  ok,
  type JsonObject,
  type Result,
  type UnifiedError
} from "@novel-studio/shared";

export const LEGACY_AGENT_CONVERSATION_ID = "legacy_agent_runs";

const DEFAULT_PAGE_LIMIT = 30;
const MAX_PAGE_LIMIT = 100;
const MAX_QUERY_BYTES = 1024;
const MAX_CONTEXT_BYTES = 8 * 1024;
const RECENT_RUN_LIMIT = 6;
const MAX_FACT_TEXT_BYTES = 512;
const MAX_SUMMARY_SOURCE_RUNS = 100;

export type AgentConversationStatus = "active" | "archived";
export type AgentConversationSummaryFreshness = "fresh" | "stale" | "unavailable";

export interface AgentConversationDiagnostic {
  readonly code: string;
  readonly conversationId?: string;
}

export interface AgentConversationSummary {
  readonly schemaVersion: "1.0";
  readonly conversationId: string;
  readonly projectId: string;
  readonly revision: number;
  readonly title: string;
  readonly status: AgentConversationStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly runCount: number;
  readonly summaryFreshness: AgentConversationSummaryFreshness;
  readonly lastRunId?: string;
  readonly lastRunStatus?: string;
  readonly preview?: string;
  readonly virtual?: true;
}

export interface AgentConversationReadResult extends AgentConversationSummary {
  readonly runs: readonly JsonObject[];
  readonly contextSummary?: string;
  readonly diagnostics: readonly AgentConversationDiagnostic[];
}

export interface AgentConversationListPage {
  readonly items: readonly AgentConversationSummary[];
  readonly diagnostics: readonly AgentConversationDiagnostic[];
  readonly nextCursor?: string;
}

export interface AgentConversationSearchPage {
  readonly items: readonly AgentConversationSearchHit[];
  readonly diagnostics: readonly AgentConversationDiagnostic[];
  readonly nextCursor?: string;
}

export interface CreateAgentConversationCommand {
  readonly projectId: string;
  readonly commandId: string;
}

export interface ChangeAgentConversationStatusCommand {
  readonly projectId: string;
  readonly conversationId: string;
  readonly commandId: string;
  readonly expectedConversationRevision: number;
}

export interface ListAgentConversationsQuery {
  readonly projectId: string;
  readonly includeArchived?: boolean;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface ReadAgentConversationQuery {
  readonly projectId: string;
  readonly conversationId: string;
}

export interface SearchAgentConversationsQuery extends ListAgentConversationsQuery {
  readonly query: string;
}

export interface AgentConversationSearchHit extends AgentConversationSummary {
  readonly snippet: string;
}

export interface AgentConversationContextMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string;
}

export type AgentConversationCommandResult =
  | { readonly ok: true; readonly value: AgentConversationSummary }
  | {
      readonly ok: false;
      readonly error: UnifiedError;
      readonly latestConversation?: AgentConversationSummary;
    };

export interface AgentConversationPersistenceListPage {
  readonly items: readonly JsonObject[];
  readonly diagnostics: readonly AgentConversationDiagnostic[];
  readonly nextCursor?: string;
}

export interface AgentConversationPersistenceSearchPage {
  readonly items: readonly JsonObject[];
  readonly diagnostics: readonly AgentConversationDiagnostic[];
  readonly nextCursor?: string;
}

export interface AgentConversationPersistencePort {
  createConversation(record: JsonObject): Promise<Result<JsonObject, UnifiedError>>;
  readConversation(id: string): Promise<Result<JsonObject | undefined, UnifiedError>>;
  listConversations(input: {
    readonly projectId: string;
    readonly status?: AgentConversationStatus;
    readonly cursor?: string;
    readonly limit?: number;
  }): Promise<Result<AgentConversationPersistenceListPage, UnifiedError>>;
  updateConversation(input: JsonObject): Promise<Result<JsonObject, UnifiedError>>;
  writeCommandReceipt(
    conversationId: string,
    commandId: string,
    receipt: JsonObject
  ): Promise<Result<JsonObject, UnifiedError>>;
  readCommandReceipt(
    conversationId: string,
    commandId: string
  ): Promise<Result<JsonObject | undefined, UnifiedError>>;
  readLatestSummary?(conversationId: string): Promise<Result<JsonObject | undefined, UnifiedError>>;
  writeSummary?(summary: JsonObject): Promise<Result<JsonObject, UnifiedError>>;
  searchConversations?(input: {
    readonly projectId: string;
    readonly query: string;
    readonly includeArchived?: boolean;
    readonly cursor?: string;
    readonly limit?: number;
    readonly documents: readonly JsonObject[];
  }): Promise<Result<AgentConversationPersistenceSearchPage, UnifiedError>>;
}

export interface AgentConversationRunReaderPort {
  listRunSnapshots(projectId: string): Promise<Result<JsonObject[], UnifiedError>>;
  readRunEvents?(runId: string): Promise<Result<JsonObject[], UnifiedError>>;
  hasPendingReview(input: {
    readonly projectId: string;
    readonly conversationId: string;
  }): Promise<Result<boolean, UnifiedError>>;
}

export interface AgentConversationSession {
  createConversation(
    command: CreateAgentConversationCommand
  ): Promise<Result<AgentConversationSummary, UnifiedError>>;
  listConversations(
    query: ListAgentConversationsQuery
  ): Promise<Result<AgentConversationListPage, UnifiedError>>;
  readConversation(
    query: ReadAgentConversationQuery
  ): Promise<Result<AgentConversationReadResult, UnifiedError>>;
  archiveConversation(
    command: ChangeAgentConversationStatusCommand
  ): Promise<AgentConversationCommandResult>;
  restoreConversation(
    command: ChangeAgentConversationStatusCommand
  ): Promise<AgentConversationCommandResult>;
  searchConversations(
    query: SearchAgentConversationsQuery
  ): Promise<Result<AgentConversationSearchPage, UnifiedError>>;
  assertRunMayStart(input: {
    readonly projectId: string;
    readonly conversationId: string;
  }): Promise<Result<AgentConversationSummary, UnifiedError>>;
  cancelRunStart(input: {
    readonly projectId: string;
    readonly conversationId: string;
  }): Promise<Result<void, UnifiedError>>;
  noteRunStarted(snapshot: JsonObject): Promise<Result<AgentConversationSummary, UnifiedError>>;
  noteRunTerminal(snapshot: JsonObject): Promise<Result<void, UnifiedError>>;
  loadContext(input: {
    readonly projectId: string;
    readonly conversationId: string;
  }): Promise<Result<readonly AgentConversationContextMessage[], UnifiedError>>;
}

export interface CreateAgentConversationSessionOptions {
  readonly projectId: string;
  readonly repository: AgentConversationPersistencePort;
  readonly runReader: AgentConversationRunReaderPort;
  readonly createConversationId?: (commandId: string) => string;
  readonly now?: () => string;
}

interface ParsedConversationRecord {
  readonly schemaVersion: "1.0";
  readonly conversationId: string;
  readonly projectId: string;
  readonly revision: number;
  readonly title: string;
  readonly status: AgentConversationStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdByCommandId?: string;
  readonly lastMutationCommandId?: string;
}

export function createAgentConversationSession(
  options: CreateAgentConversationSessionOptions
): AgentConversationSession {
  const now = options.now ?? (() => new Date().toISOString());
  const createConversationId = options.createConversationId ?? defaultConversationId;
  const mutationTails = new Map<string, Promise<void>>();
  const summaryRefreshes = new Map<string, Promise<Result<JsonObject | undefined, UnifiedError>>>();
  const startReservations = new Set<string>();
  const knownRuns = new Map<string, Map<string, JsonObject>>();

  function requireBoundProject(projectId: string): Result<void, UnifiedError> {
    return projectId === options.projectId
      ? ok(undefined)
      : failure("AGENT_CONVERSATION_PROJECT_MISMATCH");
  }

  async function runsFor(conversationId: string): Promise<Result<JsonObject[], UnifiedError>> {
    const listed = await options.runReader.listRunSnapshots(options.projectId);
    if (!listed.ok) return listed;
    const legacy = conversationId === LEGACY_AGENT_CONVERSATION_ID;
    const byRunId = new Map<string, JsonObject>();
    for (const run of listed.value) {
      if (run["projectId"] !== options.projectId) continue;
      const belongs = legacy
        ? run["conversationId"] === null || run["conversationId"] === undefined
        : run["conversationId"] === conversationId;
      if (!belongs) continue;
      rememberNewestRun(byRunId, run);
    }
    if (!legacy) {
      for (const run of knownRuns.get(conversationId)?.values() ?? []) {
        rememberNewestRun(byRunId, run);
      }
    }
    return ok([...byRunId.values()].sort(compareRuns));
  }

  async function runsForRead(
    conversationId: string,
    runs: readonly JsonObject[]
  ): Promise<{
    readonly runs: readonly JsonObject[];
    readonly diagnostics: readonly AgentConversationDiagnostic[];
  }> {
    if (options.runReader.readRunEvents === undefined) return { runs, diagnostics: [] };
    let eventsUnavailable = false;
    const projectedRuns = await Promise.all(
      runs.map(async (run) => {
        const runId = readSafeId(run, "runId");
        if (runId === undefined) return run;
        const read = await options.runReader.readRunEvents?.(runId);
        if (read === undefined || !read.ok) {
          eventsUnavailable = true;
          return run;
        }
        const events = read.value
          .map(toConversationActivityEvent)
          .filter((event): event is JsonObject => event !== undefined);
        const assistantText =
          readString(run, "assistantText") ?? assistantTextFromEvents(read.value);
        return {
          ...run,
          ...(assistantText === undefined ? {} : { assistantText }),
          ...(events.length === 0 ? {} : { events })
        };
      })
    );
    return {
      runs: projectedRuns,
      diagnostics: eventsUnavailable
        ? [{ conversationId, code: "AGENT_CONVERSATION_RUN_EVENTS_UNAVAILABLE" }]
        : []
    };
  }

  async function summaryFor(
    record: JsonObject
  ): Promise<Result<AgentConversationSummary, UnifiedError>> {
    const parsed = parseConversationRecord(record);
    if (parsed === undefined || parsed.projectId !== options.projectId) {
      return failure("AGENT_CONVERSATION_RECORD_INVALID");
    }
    const runs = await runsFor(parsed.conversationId);
    if (!runs.ok) return runs;
    return ok(toSummary(parsed, runs.value));
  }

  async function refreshSummary(
    conversationId: string
  ): Promise<Result<JsonObject | undefined, UnifiedError>> {
    const active = summaryRefreshes.get(conversationId);
    if (active !== undefined) return active;
    const request = computeSummary(conversationId);
    summaryRefreshes.set(conversationId, request);
    const clear = () => {
      if (summaryRefreshes.get(conversationId) === request) {
        summaryRefreshes.delete(conversationId);
      }
    };
    void request.then(clear, clear);
    return request;
  }

  async function computeSummary(
    conversationId: string
  ): Promise<Result<JsonObject | undefined, UnifiedError>> {
    const record = await options.repository.readConversation(conversationId);
    if (!record.ok) return record;
    const parsed = parseConversationRecord(record.value);
    if (parsed === undefined || parsed.projectId !== options.projectId) {
      return failure("AGENT_CONVERSATION_NOT_FOUND");
    }
    const runs = await runsFor(conversationId);
    if (!runs.ok) return runs;
    if (runs.value.length === 0) return ok(undefined);

    const latest = await options.repository.readLatestSummary?.(conversationId);
    if (latest?.ok === false) {
      return failure("AGENT_CONVERSATION_SUMMARY_UNAVAILABLE");
    }
    if (
      latest?.value !== undefined &&
      isSummaryCurrent(latest.value, runs.value[0]) &&
      isBoundedSummaryContent(latest.value["content"])
    ) {
      return ok(latest.value);
    }

    const facts: AgentConversationRunFact[] = [];
    for (const run of [...runs.value].reverse()) {
      const runId = readSafeId(run, "runId");
      if (runId === undefined) continue;
      const events =
        options.runReader.readRunEvents === undefined
          ? ok([])
          : await options.runReader.readRunEvents(runId);
      if (!events.ok) return failure("AGENT_CONVERSATION_SUMMARY_UNAVAILABLE");
      facts.push(toRunFact(run, events.value));
    }
    const latestRun = runs.value[0];
    if (latestRun === undefined) return ok(undefined);
    const latestRunId = readSafeId(latestRun, "runId");
    const throughRunRevision = readNonNegativeInteger(latestRun, "runRevision");
    const throughRunLastSequence = readNonNegativeInteger(latestRun, "lastSequence");
    if (
      latestRunId === undefined ||
      throughRunRevision === undefined ||
      throughRunLastSequence === undefined
    ) {
      return failure("AGENT_CONVERSATION_RUN_INVALID");
    }
    const summaryFacts = facts.slice(-MAX_SUMMARY_SOURCE_RUNS);
    const content = buildBoundedContextContent(conversationId, summaryFacts);
    const latestRevision = readPositiveInteger(latest?.value, "revision") ?? 0;
    const revision: JsonObject = {
      schemaVersion: "1.0",
      conversationId,
      revision: latestRevision + 1,
      sourceRunIds: summaryFacts.map((fact) => fact.runId),
      throughRunId: latestRunId,
      throughRunRevision,
      throughRunLastSequence,
      content,
      createdAt: now()
    };
    if (options.repository.writeSummary === undefined) return ok(revision);
    return options.repository.writeSummary(revision);
  }

  async function persistReceipt(
    conversationId: string,
    commandId: string,
    summary: AgentConversationSummary
  ): Promise<Result<AgentConversationSummary, UnifiedError>> {
    const result = ok(summary);
    const receipt = await options.repository.writeCommandReceipt(
      conversationId,
      commandId,
      asJsonObject(result)
    );
    return receipt.ok ? result : err(receipt.error);
  }

  async function readReceiptSummary(
    conversationId: string,
    commandId: string
  ): Promise<Result<AgentConversationSummary | undefined, UnifiedError>> {
    const prior = await options.repository.readCommandReceipt(conversationId, commandId);
    if (!prior.ok) return prior;
    const value = readObject(prior.value, "value");
    if (prior.value?.["ok"] !== true || value === undefined) return ok(undefined);
    const parsed = parseSummary(value);
    return parsed !== undefined &&
      parsed.projectId === options.projectId &&
      parsed.conversationId === conversationId
      ? ok(parsed)
      : failure("AGENT_CONVERSATION_RECEIPT_INVALID");
  }

  async function changeStatus(
    command: ChangeAgentConversationStatusCommand,
    status: AgentConversationStatus
  ): Promise<AgentConversationCommandResult> {
    const project = requireBoundProject(command.projectId);
    if (!project.ok) return project;
    if (!isSafeId(command.conversationId) || !isSafeId(command.commandId)) {
      return failure("AGENT_CONVERSATION_COMMAND_INVALID");
    }
    if (command.conversationId === LEGACY_AGENT_CONVERSATION_ID) {
      return failure("AGENT_CONVERSATION_READ_ONLY");
    }
    if (
      !Number.isSafeInteger(command.expectedConversationRevision) ||
      command.expectedConversationRevision < 0
    ) {
      return failure("AGENT_CONVERSATION_COMMAND_INVALID");
    }

    return withConversationMutation(command.conversationId, async () => {
      const prior = await readReceiptSummary(command.conversationId, command.commandId);
      if (!prior.ok) return prior;
      if (prior.value !== undefined) return ok(prior.value);

      const current = await options.repository.readConversation(command.conversationId);
      if (!current.ok) return current;
      const parsed = parseConversationRecord(current.value);
      if (parsed === undefined || parsed.projectId !== options.projectId) {
        return failure("AGENT_CONVERSATION_NOT_FOUND");
      }

      if (
        parsed.lastMutationCommandId === command.commandId &&
        parsed.status === status &&
        parsed.revision === command.expectedConversationRevision + 1
      ) {
        const recovered = await summaryFor(current.value as JsonObject);
        return recovered.ok
          ? persistReceipt(command.conversationId, command.commandId, recovered.value)
          : recovered;
      }

      if (parsed.revision !== command.expectedConversationRevision) {
        const latest = await summaryFor(current.value as JsonObject);
        return latest.ok
          ? {
              ok: false,
              error: conversationError("AGENT_CONVERSATION_REVISION_CONFLICT"),
              latestConversation: latest.value
            }
          : failure("AGENT_CONVERSATION_REVISION_CONFLICT");
      }

      if (status === "archived") {
        if (startReservations.has(command.conversationId)) {
          return failure("AGENT_CONVERSATION_ARCHIVE_BLOCKED");
        }
        const runs = await runsFor(command.conversationId);
        if (!runs.ok) return runs;
        const pending = await options.runReader.hasPendingReview({
          projectId: options.projectId,
          conversationId: command.conversationId
        });
        if (!pending.ok) return pending;
        if (
          pending.value ||
          runs.value.some((run) => !isTerminalStatus(readString(run, "status")))
        ) {
          return failure("AGENT_CONVERSATION_ARCHIVE_BLOCKED");
        }
      }

      const updated = await options.repository.updateConversation({
        conversationId: command.conversationId,
        projectId: options.projectId,
        expectedRevision: command.expectedConversationRevision,
        status,
        updatedAt: laterTimestamp(parsed.updatedAt, now()),
        mutationCommandId: command.commandId
      });
      if (!updated.ok) {
        if (updated.error.code !== "AGENT_CONVERSATION_REVISION_CONFLICT") return updated;
        const latest = await options.repository.readConversation(command.conversationId);
        if (!latest.ok || latest.value === undefined) return updated;
        const latestSummary = await summaryFor(latest.value);
        return latestSummary.ok
          ? { ok: false, error: updated.error, latestConversation: latestSummary.value }
          : updated;
      }
      const summary = await summaryFor(updated.value);
      if (!summary.ok) return summary;
      return persistReceipt(command.conversationId, command.commandId, summary.value);
    });
  }

  const session: AgentConversationSession = {
    async createConversation(command) {
      const project = requireBoundProject(command.projectId);
      if (!project.ok) return project;
      if (!isSafeId(command.commandId)) return failure("AGENT_CONVERSATION_COMMAND_INVALID");
      const conversationId = createConversationId(command.commandId);
      if (conversationId === LEGACY_AGENT_CONVERSATION_ID) {
        return failure("AGENT_CONVERSATION_ID_RESERVED");
      }
      if (!isSafeId(conversationId)) return failure("AGENT_CONVERSATION_ID_INVALID");

      return withConversationMutation(conversationId, async () => {
        const prior = await readReceiptSummary(conversationId, command.commandId);
        if (!prior.ok) return prior;
        if (prior.value !== undefined) return ok(prior.value);

        const existing = await options.repository.readConversation(conversationId);
        if (!existing.ok) return existing;
        let record = existing.value;
        const parsedExisting = parseConversationRecord(record);
        if (parsedExisting !== undefined) {
          if (
            parsedExisting.projectId !== options.projectId ||
            parsedExisting.createdByCommandId !== command.commandId
          ) {
            return failure("AGENT_CONVERSATION_CREATE_CONFLICT");
          }
        } else {
          if (record !== undefined) return failure("AGENT_CONVERSATION_RECORD_INVALID");
          const timestamp = now();
          const created = await options.repository.createConversation({
            schemaVersion: "1.0",
            conversationId,
            projectId: options.projectId,
            revision: 1,
            title: "新会话",
            status: "active",
            createdAt: timestamp,
            updatedAt: timestamp,
            createdByCommandId: command.commandId
          });
          if (!created.ok) return created;
          record = created.value;
        }
        const summary = await summaryFor(record as JsonObject);
        if (!summary.ok) return summary;
        return persistReceipt(conversationId, command.commandId, summary.value);
      });
    },

    async listConversations(query) {
      const project = requireBoundProject(query.projectId);
      if (!project.ok) return project;
      const limit = normalizedLimit(query.limit);
      const listed = await options.repository.listConversations({
        projectId: options.projectId,
        ...(query.includeArchived ? {} : { status: "active" as const }),
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        limit
      });
      if (!listed.ok) return listed;
      const summaries: AgentConversationSummary[] = [];
      const diagnostics: AgentConversationDiagnostic[] = [...listed.value.diagnostics];
      for (const record of listed.value.items) {
        const parsed = parseConversationRecord(record);
        if (parsed === undefined || parsed.projectId !== options.projectId) {
          const invalidConversationId = readString(record, "conversationId");
          diagnostics.push({
            code: "AGENT_CONVERSATION_RECORD_INVALID",
            ...(invalidConversationId === undefined
              ? {}
              : { conversationId: invalidConversationId })
          });
          continue;
        }
        const summary = await summaryFor(record);
        if (!summary.ok) {
          diagnostics.push({
            conversationId: parsed.conversationId,
            code: summary.error.code
          });
          continue;
        }
        summaries.push(summary.value);
      }
      if (query.cursor === undefined && summaries.length < limit) {
        const legacyRuns = await runsFor(LEGACY_AGENT_CONVERSATION_ID);
        if (!legacyRuns.ok) return legacyRuns;
        if (legacyRuns.value.length > 0) {
          summaries.push(legacySummary(options.projectId, legacyRuns.value));
        }
      }
      summaries.sort(compareConversationSummaries);
      return ok({
        items: summaries,
        diagnostics,
        ...(listed.value.nextCursor === undefined ? {} : { nextCursor: listed.value.nextCursor })
      });
    },

    async readConversation(query) {
      const project = requireBoundProject(query.projectId);
      if (!project.ok) return project;
      if (!isSafeId(query.conversationId)) return failure("AGENT_CONVERSATION_ID_INVALID");
      if (query.conversationId === LEGACY_AGENT_CONVERSATION_ID) {
        const runs = await runsFor(query.conversationId);
        if (!runs.ok) return runs;
        if (runs.value.length === 0) return failure("AGENT_CONVERSATION_NOT_FOUND");
        const projected = await runsForRead(query.conversationId, runs.value);
        return ok({
          ...legacySummary(options.projectId, runs.value),
          runs: projected.runs,
          diagnostics: projected.diagnostics
        });
      }
      const record = await options.repository.readConversation(query.conversationId);
      if (!record.ok) return record;
      const parsed = parseConversationRecord(record.value);
      if (parsed === undefined || parsed.projectId !== options.projectId) {
        return failure("AGENT_CONVERSATION_NOT_FOUND");
      }
      const runs = await runsFor(query.conversationId);
      if (!runs.ok) return runs;
      const latestSummary = await options.repository.readLatestSummary?.(query.conversationId);
      const diagnostics: AgentConversationDiagnostic[] = [];
      const projected = await runsForRead(query.conversationId, runs.value);
      diagnostics.push(...projected.diagnostics);
      let contextSummary: string | undefined;
      let summaryFreshness: AgentConversationSummaryFreshness = "unavailable";
      if (latestSummary?.ok === false) {
        diagnostics.push({ conversationId: query.conversationId, code: latestSummary.error.code });
      } else if (latestSummary?.value !== undefined) {
        contextSummary = readString(latestSummary.value, "content");
        summaryFreshness = isSummaryCurrent(latestSummary.value, runs.value[0]) ? "fresh" : "stale";
      }
      return ok({
        ...toSummary(parsed, runs.value, summaryFreshness),
        runs: projected.runs,
        diagnostics,
        ...(contextSummary === undefined ? {} : { contextSummary })
      });
    },

    archiveConversation(command) {
      return changeStatus(command, "archived");
    },

    restoreConversation(command) {
      return changeStatus(command, "active");
    },

    async searchConversations(query) {
      const project = requireBoundProject(query.projectId);
      if (!project.ok) return project;
      const normalized = query.query.trim().toLocaleLowerCase();
      if (byteLength(normalized) > MAX_QUERY_BYTES) {
        return failure("AGENT_CONVERSATION_QUERY_INVALID");
      }
      if (normalized.length === 0) return ok({ items: [], diagnostics: [] });
      const records: JsonObject[] = [];
      const diagnostics: AgentConversationDiagnostic[] = [];
      let listCursor: string | undefined;
      do {
        const listed = await options.repository.listConversations({
          projectId: options.projectId,
          ...(query.includeArchived ? {} : { status: "active" as const }),
          ...(listCursor === undefined ? {} : { cursor: listCursor }),
          limit: MAX_PAGE_LIMIT
        });
        if (!listed.ok) return listed;
        records.push(...listed.value.items);
        diagnostics.push(...listed.value.diagnostics);
        const nextCursor = listed.value.nextCursor;
        if (nextCursor === listCursor) break;
        listCursor = nextCursor;
      } while (listCursor !== undefined && records.length < 10_000);

      const summaries = new Map<string, AgentConversationSummary>();
      const documents: JsonObject[] = [];
      for (const record of records) {
        const parsed = parseConversationRecord(record);
        if (parsed === undefined || parsed.projectId !== options.projectId) {
          const invalidConversationId = readString(record, "conversationId");
          diagnostics.push({
            code: "AGENT_CONVERSATION_RECORD_INVALID",
            ...(invalidConversationId === undefined
              ? {}
              : { conversationId: invalidConversationId })
          });
          continue;
        }
        const runs = await runsFor(parsed.conversationId);
        if (!runs.ok) {
          diagnostics.push({ conversationId: parsed.conversationId, code: runs.error.code });
          continue;
        }
        const latestSummary = await options.repository.readLatestSummary?.(parsed.conversationId);
        let latestSummaryContent = "";
        let freshness: AgentConversationSummaryFreshness = "unavailable";
        if (latestSummary?.ok === false) {
          diagnostics.push({
            conversationId: parsed.conversationId,
            code: latestSummary.error.code
          });
        } else if (latestSummary?.value !== undefined) {
          latestSummaryContent = readString(latestSummary.value, "content") ?? "";
          freshness = isSummaryCurrent(latestSummary.value, runs.value[0]) ? "fresh" : "stale";
        }
        summaries.set(parsed.conversationId, toSummary(parsed, runs.value, freshness));
        documents.push({
          schemaVersion: "1.0",
          conversationId: parsed.conversationId,
          projectId: parsed.projectId,
          title: parsed.title,
          status: parsed.status,
          updatedAt: parsed.updatedAt,
          latestSummary: latestSummaryContent,
          userRequests: runs.value
            .map((run) => readString(run, "userRequest"))
            .filter((request): request is string => request !== undefined)
            .slice(0, 100)
        });
      }

      const searched =
        options.repository.searchConversations === undefined
          ? ok(searchDocumentsInMemory(documents, normalized, query.limit))
          : await options.repository.searchConversations({
              projectId: options.projectId,
              query: normalized,
              ...(query.includeArchived === true ? { includeArchived: true } : {}),
              ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
              limit: normalizedLimit(query.limit),
              documents
            });
      if (!searched.ok) return searched;
      const items: AgentConversationSearchHit[] = [];
      for (const hit of searched.value.items) {
        const conversationId = readSafeId(hit, "conversationId");
        const summary = conversationId === undefined ? undefined : summaries.get(conversationId);
        if (summary === undefined) continue;
        items.push({ ...summary, snippet: readString(hit, "snippet") ?? summary.title });
      }
      return ok({
        items,
        diagnostics: [...diagnostics, ...searched.value.diagnostics],
        ...(searched.value.nextCursor === undefined
          ? {}
          : { nextCursor: searched.value.nextCursor })
      });
    },

    async assertRunMayStart(input) {
      const project = requireBoundProject(input.projectId);
      if (!project.ok) return project;
      if (!isSafeId(input.conversationId)) return failure("AGENT_CONVERSATION_ID_INVALID");
      if (input.conversationId === LEGACY_AGENT_CONVERSATION_ID) {
        return failure("AGENT_CONVERSATION_READ_ONLY");
      }
      return withConversationMutation(input.conversationId, async () => {
        const record = await options.repository.readConversation(input.conversationId);
        if (!record.ok) return record;
        const parsed = parseConversationRecord(record.value);
        if (parsed === undefined || parsed.projectId !== options.projectId) {
          return failure("AGENT_CONVERSATION_NOT_FOUND");
        }
        if (parsed.status === "archived") return failure("AGENT_CONVERSATION_ARCHIVED");
        const summary = await summaryFor(record.value as JsonObject);
        if (summary.ok) startReservations.add(input.conversationId);
        return summary;
      });
    },

    async cancelRunStart(input) {
      const project = requireBoundProject(input.projectId);
      if (!project.ok) return project;
      if (!isSafeId(input.conversationId)) return failure("AGENT_CONVERSATION_ID_INVALID");
      return withConversationMutation(input.conversationId, () => {
        startReservations.delete(input.conversationId);
        return Promise.resolve(ok(undefined));
      });
    },

    async noteRunStarted(snapshot) {
      const conversationId = readString(snapshot, "conversationId");
      const projectId = readString(snapshot, "projectId");
      const runId = readString(snapshot, "runId");
      if (projectId !== options.projectId) return failure("AGENT_CONVERSATION_PROJECT_MISMATCH");
      if (
        conversationId === undefined ||
        conversationId === LEGACY_AGENT_CONVERSATION_ID ||
        runId === undefined ||
        !isSafeId(conversationId) ||
        !isSafeId(runId)
      ) {
        return failure("AGENT_CONVERSATION_RUN_INVALID");
      }
      return withConversationMutation(conversationId, async () => {
        const conversationRuns = knownRuns.get(conversationId) ?? new Map<string, JsonObject>();
        rememberNewestRun(conversationRuns, snapshot);
        knownRuns.set(conversationId, conversationRuns);
        startReservations.delete(conversationId);

        const record = await options.repository.readConversation(conversationId);
        if (!record.ok) return record;
        const parsed = parseConversationRecord(record.value);
        if (parsed === undefined || parsed.projectId !== options.projectId) {
          return failure("AGENT_CONVERSATION_NOT_FOUND");
        }
        const title =
          parsed.title === "新会话"
            ? titleFromRequest(readString(snapshot, "userRequest") ?? "")
            : parsed.title;
        const updatedAt = laterTimestamp(
          parsed.updatedAt,
          readString(snapshot, "updatedAt") ?? now()
        );
        if (title === parsed.title && updatedAt === parsed.updatedAt) {
          return summaryFor(record.value as JsonObject);
        }
        const updated = await options.repository.updateConversation({
          conversationId,
          projectId: options.projectId,
          expectedRevision: parsed.revision,
          title,
          updatedAt
        });
        if (!updated.ok) return updated;
        return summaryFor(updated.value);
      });
    },

    async noteRunTerminal(snapshot) {
      const conversationId = readSafeId(snapshot, "conversationId");
      const projectId = readSafeId(snapshot, "projectId");
      const runId = readSafeId(snapshot, "runId");
      if (projectId !== options.projectId) return failure("AGENT_CONVERSATION_PROJECT_MISMATCH");
      if (
        conversationId === undefined ||
        conversationId === LEGACY_AGENT_CONVERSATION_ID ||
        runId === undefined
      ) {
        return failure("AGENT_CONVERSATION_RUN_INVALID");
      }
      const conversationRuns = knownRuns.get(conversationId) ?? new Map<string, JsonObject>();
      rememberNewestRun(conversationRuns, snapshot);
      knownRuns.set(conversationId, conversationRuns);
      const refreshed = await refreshSummary(conversationId);
      return refreshed.ok ? ok(undefined) : err(refreshed.error);
    },

    async loadContext(input) {
      const project = requireBoundProject(input.projectId);
      if (!project.ok) return project;
      if (!isSafeId(input.conversationId)) return failure("AGENT_CONVERSATION_ID_INVALID");
      if (input.conversationId === LEGACY_AGENT_CONVERSATION_ID) {
        return failure("AGENT_CONVERSATION_READ_ONLY");
      }
      const runs = await runsFor(input.conversationId);
      if (!runs.ok) return runs;
      if (runs.value.length === 0) return ok([]);
      const latest = await options.repository.readLatestSummary?.(input.conversationId);
      if (
        latest?.ok === true &&
        latest.value !== undefined &&
        isSummaryCurrent(latest.value, runs.value[0]) &&
        isBoundedSummaryContent(latest.value["content"])
      ) {
        return ok([{ role: "system", content: String(latest.value["content"]) }]);
      }
      const refreshed = await refreshSummary(input.conversationId);
      if (!refreshed.ok || refreshed.value === undefined) {
        return failure("AGENT_CONVERSATION_SUMMARY_UNAVAILABLE");
      }
      const content = refreshed.value["content"];
      return isBoundedSummaryContent(content)
        ? ok([{ role: "system", content }])
        : failure("AGENT_CONVERSATION_SUMMARY_UNAVAILABLE");
    }
  };

  return session;

  async function withConversationMutation<T>(
    conversationId: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const previous = mutationTails.get(conversationId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    mutationTails.set(conversationId, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (mutationTails.get(conversationId) === tail) mutationTails.delete(conversationId);
    }
  }
}

interface AgentConversationRunFact {
  readonly runId: string;
  readonly userRequest: string;
  readonly status: string;
  readonly assistantTurns?: readonly string[];
  readonly toolSummaries?: readonly string[];
  readonly planGoals?: readonly string[];
  readonly planTargets?: readonly string[];
  readonly unresolvedQuestions?: readonly string[];
  readonly changeSetTargets?: readonly string[];
  readonly outcomes?: readonly string[];
  readonly errorCodes?: readonly string[];
}

const CONVERSATION_ACTIVITY_EVENT_TYPES = new Set([
  "tool_started",
  "tool_completed",
  "tool_failed",
  "change_set_ready"
]);

function toConversationActivityEvent(event: JsonObject): JsonObject | undefined {
  const type = readString(event, "type");
  const schemaVersion = readString(event, "schemaVersion");
  const runId = readSafeId(event, "runId");
  const projectId = readSafeId(event, "projectId");
  const sequence = readNonNegativeInteger(event, "sequence");
  const runRevision = readNonNegativeInteger(event, "runRevision");
  const createdAt = readString(event, "createdAt");
  if (
    type === undefined ||
    !CONVERSATION_ACTIVITY_EVENT_TYPES.has(type) ||
    schemaVersion === undefined ||
    runId === undefined ||
    projectId === undefined ||
    sequence === undefined ||
    runRevision === undefined ||
    createdAt === undefined
  ) {
    return undefined;
  }

  const detail = readObject(event, "detail");
  const projectedDetail =
    type === "change_set_ready" ? changeSetActivityDetail(detail) : toolActivityDetail(detail);
  return {
    schemaVersion,
    runId,
    projectId,
    sequence,
    runRevision,
    type,
    createdAt,
    ...(projectedDetail === undefined ? {} : { detail: projectedDetail })
  };
}

function toolActivityDetail(detail: JsonObject | undefined): JsonObject | undefined {
  if (detail === undefined) return undefined;
  const projected: JsonObject = {};
  for (const key of ["toolCallId", "toolName", "summary", "relativePath", "message"]) {
    const value = readString(detail, key);
    if (value !== undefined) projected[key] = value;
  }
  return Object.keys(projected).length === 0 ? undefined : projected;
}

function changeSetActivityDetail(detail: JsonObject | undefined): JsonObject | undefined {
  const changeSet = readObject(detail ?? {}, "changeSet");
  const files = readObjectArray(changeSet ?? {}, "files").flatMap((file) => {
    const relativePath = readString(file, "relativePath");
    return relativePath === undefined ? [] : [{ relativePath }];
  });
  return files.length === 0 ? undefined : { changeSet: { files } };
}

function assistantTextFromEvents(rawEvents: readonly JsonObject[]): string | undefined {
  let assistantText = "";
  let pendingDelta = "";
  for (const event of [...rawEvents].sort(
    (left, right) => Number(left["sequence"] ?? 0) - Number(right["sequence"] ?? 0)
  )) {
    const type = readString(event, "type");
    const detail = readObject(event, "detail") ?? {};
    if (type === "assistant_text_delta") {
      pendingDelta += readString(detail, "delta") ?? "";
      continue;
    }
    if (type === "assistant_text_completed") {
      const text = readString(detail, "text")?.trim();
      if (text !== undefined && text.length > 0) assistantText = text;
      pendingDelta = "";
      continue;
    }
    if (pendingDelta.trim().length > 0) {
      assistantText = pendingDelta.trim();
      pendingDelta = "";
    }
    if (type === "run_completed") {
      const summary = readString(detail, "summary")?.trim();
      if (summary !== undefined && summary.length > 0) assistantText = summary;
    }
  }
  if (pendingDelta.trim().length > 0) assistantText = pendingDelta.trim();
  return assistantText.length === 0 ? undefined : assistantText;
}

function toRunFact(run: JsonObject, rawEvents: readonly JsonObject[]): AgentConversationRunFact {
  const events = [...rawEvents].sort(
    (left, right) => Number(left["sequence"] ?? 0) - Number(right["sequence"] ?? 0)
  );
  const assistantTurns: string[] = [];
  const toolSummaries: string[] = [];
  const planGoals: string[] = [];
  const planTargets: string[] = [];
  const unresolvedQuestions: string[] = [];
  const changeSetTargets: string[] = [];
  const outcomes: string[] = [];
  const errorCodes: string[] = [];
  let pendingLegacyDelta = "";

  const flushLegacyDelta = () => {
    const text = pendingLegacyDelta.trim();
    if (text.length > 0) assistantTurns.push(text);
    pendingLegacyDelta = "";
  };

  for (const event of events) {
    const type = readString(event, "type");
    const detail = readObject(event, "detail");
    if (type === "assistant_text_delta") {
      pendingLegacyDelta += readString(detail ?? {}, "delta") ?? "";
      continue;
    }
    if (type === "assistant_text_completed") {
      pendingLegacyDelta = "";
      const text = readString(detail ?? {}, "text")?.trim();
      if (text !== undefined && text.length > 0) assistantTurns.push(text);
      continue;
    }
    flushLegacyDelta();

    if (type === "tool_completed") {
      pushUnique(toolSummaries, readString(detail ?? {}, "summary"));
      continue;
    }
    if (type === "plan_ready" && detail !== undefined) {
      pushUnique(planGoals, readString(detail, "goal"));
      for (const target of readObjectArray(detail, "targetRefs")) {
        const refId = readString(target, "refId");
        const intent = readString(target, "intent");
        pushUnique(
          planTargets,
          refId === undefined ? intent : `${refId}${intent === undefined ? "" : `: ${intent}`}`
        );
      }
      for (const question of readObjectArray(detail, "openQuestions")) {
        if (question["resolution"] === undefined) {
          pushUnique(unresolvedQuestions, readString(question, "prompt"));
        }
      }
      continue;
    }
    if (type === "change_set_ready" && detail !== undefined) {
      const changeSet = readObject(detail, "changeSet");
      for (const file of readObjectArray(changeSet ?? {}, "files")) {
        pushUnique(changeSetTargets, readString(file, "relativePath"));
      }
      continue;
    }
    if (
      type === "write_applied" ||
      type === "write_failed" ||
      type === "run_undone" ||
      type === "run_undo_failed" ||
      type === "run_undo_review_required" ||
      type === "run_completed" ||
      type === "run_cancelled" ||
      type === "run_failed" ||
      type === "run_limit_reached"
    ) {
      pushUnique(outcomes, type);
    }
    if (
      type === "tool_failed" ||
      type === "write_failed" ||
      type === "run_undo_failed" ||
      type === "run_failed" ||
      type === "run_limit_reached"
    ) {
      pushUnique(errorCodes, readString(detail ?? {}, "code"));
    }
  }
  flushLegacyDelta();

  return {
    runId: readSafeId(run, "runId") ?? "invalid_run",
    userRequest: boundedFactText(readString(run, "userRequest") ?? ""),
    status: readString(run, "status") ?? "unknown",
    ...(assistantTurns.length === 0
      ? {}
      : { assistantTurns: assistantTurns.slice(0, 3).map((text) => boundedFactText(text)) }),
    ...(toolSummaries.length === 0
      ? {}
      : { toolSummaries: toolSummaries.slice(0, 4).map((text) => boundedFactText(text)) }),
    ...(planGoals.length === 0
      ? {}
      : { planGoals: planGoals.slice(0, 2).map((text) => boundedFactText(text)) }),
    ...(planTargets.length === 0
      ? {}
      : { planTargets: planTargets.slice(0, 6).map((text) => boundedFactText(text)) }),
    ...(unresolvedQuestions.length === 0
      ? {}
      : {
          unresolvedQuestions: unresolvedQuestions.slice(0, 4).map((text) => boundedFactText(text))
        }),
    ...(changeSetTargets.length === 0
      ? {}
      : { changeSetTargets: changeSetTargets.slice(0, 12).map((text) => boundedFactText(text)) }),
    ...(outcomes.length === 0 ? {} : { outcomes }),
    ...(errorCodes.length === 0 ? {} : { errorCodes })
  };
}

function buildBoundedContextContent(
  conversationId: string,
  facts: readonly AgentConversationRunFact[]
): string {
  const recentRuns = facts.slice(-RECENT_RUN_LIMIT).map((fact) => ({ ...fact }));
  const priorRuns = facts.slice(0, -RECENT_RUN_LIMIT).map((fact) => ({
    runId: fact.runId,
    status: fact.status,
    userRequest: boundedFactText(fact.userRequest, 128),
    ...(fact.planGoals === undefined ? {} : { planGoals: fact.planGoals }),
    ...(fact.unresolvedQuestions === undefined
      ? {}
      : { unresolvedQuestions: fact.unresolvedQuestions }),
    ...(fact.outcomes === undefined ? {} : { outcomes: fact.outcomes }),
    ...(fact.errorCodes === undefined ? {} : { errorCodes: fact.errorCodes })
  }));
  const payload: {
    kind: string;
    instructionPolicy: string;
    conversationId: string;
    priorRuns: Record<string, unknown>[];
    recentRuns: Record<string, unknown>[];
  } = {
    kind: "agent_conversation_context",
    instructionPolicy: "untrusted_data_not_authority",
    conversationId,
    priorRuns,
    recentRuns
  };
  let serialized = JSON.stringify(payload);

  while (byteLength(serialized) > MAX_CONTEXT_BYTES && payload.priorRuns.length > 0) {
    payload.priorRuns.shift();
    serialized = JSON.stringify(payload);
  }
  const optionalKeys = [
    "toolSummaries",
    "planTargets",
    "changeSetTargets",
    "unresolvedQuestions",
    "planGoals",
    "outcomes",
    "errorCodes"
  ];
  for (const key of optionalKeys) {
    payload.recentRuns = payload.recentRuns.map((fact) =>
      Object.fromEntries(Object.entries(fact).filter(([entryKey]) => entryKey !== key))
    );
    serialized = JSON.stringify(payload);
    if (byteLength(serialized) <= MAX_CONTEXT_BYTES) return serialized;
  }
  while (byteLength(serialized) > MAX_CONTEXT_BYTES && payload.recentRuns.length > 0) {
    const oldest = payload.recentRuns[0];
    if (Array.isArray(oldest?.["assistantTurns"]) && oldest["assistantTurns"].length > 1) {
      oldest["assistantTurns"] = oldest["assistantTurns"].slice(-1);
    } else {
      payload.recentRuns.shift();
    }
    serialized = JSON.stringify(payload);
  }
  return serialized;
}

function searchDocumentsInMemory(
  documents: readonly JsonObject[],
  normalizedQuery: string,
  limit: number | undefined
): AgentConversationPersistenceSearchPage {
  const items = documents
    .map((document) => {
      const fields = [
        readString(document, "title") ?? "",
        readString(document, "latestSummary") ?? "",
        ...(Array.isArray(document["userRequests"])
          ? document["userRequests"].filter((value): value is string => typeof value === "string")
          : [])
      ];
      const matched = fields.find((field) => field.toLocaleLowerCase().includes(normalizedQuery));
      const conversationId = readSafeId(document, "conversationId");
      return matched === undefined || conversationId === undefined
        ? undefined
        : {
            conversationId,
            snippet: [...matched.trim().replace(/\s+/gu, " ")].slice(0, 256).join("")
          };
    })
    .filter((hit): hit is { conversationId: string; snippet: string } => hit !== undefined)
    .slice(0, normalizedLimit(limit));
  return { items, diagnostics: [] };
}

function isBoundedSummaryContent(value: unknown): value is string {
  return typeof value === "string" && byteLength(value) <= MAX_CONTEXT_BYTES;
}

function boundedFactText(value: string, maxBytes: number = MAX_FACT_TEXT_BYTES): string {
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (byteLength(normalized) <= maxBytes) return normalized;
  let result = "";
  for (const character of normalized) {
    if (byteLength(`${result}${character}`) > maxBytes) break;
    result += character;
  }
  return result;
}

function pushUnique(target: string[], value: string | undefined): void {
  const normalized = value?.trim();
  if (normalized !== undefined && normalized.length > 0 && !target.includes(normalized)) {
    target.push(normalized);
  }
}

function readObjectArray(value: JsonObject, key: string): JsonObject[] {
  const candidate = value[key];
  return Array.isArray(candidate) ? candidate.filter(isJsonObject) : [];
}

function readPositiveInteger(value: JsonObject | undefined, key: string): number | undefined {
  const candidate = value?.[key];
  return Number.isSafeInteger(candidate) && Number(candidate) >= 1 ? Number(candidate) : undefined;
}

function readNonNegativeInteger(value: JsonObject, key: string): number | undefined {
  const candidate = value[key];
  return Number.isSafeInteger(candidate) && Number(candidate) >= 0 ? Number(candidate) : undefined;
}

function parseConversationRecord(value: unknown): ParsedConversationRecord | undefined {
  if (!isJsonObject(value)) return undefined;
  const conversationId = readSafeId(value, "conversationId");
  const projectId = readSafeId(value, "projectId");
  const title = readString(value, "title")?.trim();
  const createdAt = readString(value, "createdAt");
  const updatedAt = readString(value, "updatedAt");
  const revision = value["revision"];
  const status = value["status"];
  const createdByCommandId = readOptionalSafeId(value, "createdByCommandId");
  const lastMutationCommandId = readOptionalSafeId(value, "lastMutationCommandId");
  if (
    value["schemaVersion"] !== "1.0" ||
    conversationId === undefined ||
    projectId === undefined ||
    title === undefined ||
    title.length === 0 ||
    createdAt === undefined ||
    updatedAt === undefined ||
    !Number.isSafeInteger(revision) ||
    Number(revision) < 1 ||
    (status !== "active" && status !== "archived") ||
    createdByCommandId === null ||
    lastMutationCommandId === null
  ) {
    return undefined;
  }
  return {
    schemaVersion: "1.0",
    conversationId,
    projectId,
    revision: Number(revision),
    title,
    status,
    createdAt,
    updatedAt,
    ...(createdByCommandId === undefined ? {} : { createdByCommandId }),
    ...(lastMutationCommandId === undefined ? {} : { lastMutationCommandId })
  };
}

function toSummary(
  record: ParsedConversationRecord,
  runs: readonly JsonObject[],
  summaryFreshness: AgentConversationSummaryFreshness = "unavailable"
): AgentConversationSummary {
  const latest = runs[0];
  const publicRecord = {
    schemaVersion: record.schemaVersion,
    conversationId: record.conversationId,
    projectId: record.projectId,
    revision: record.revision,
    title: record.title,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
  return {
    ...publicRecord,
    runCount: runs.length,
    summaryFreshness,
    ...(typeof latest?.["runId"] === "string" ? { lastRunId: latest["runId"] } : {}),
    ...(typeof latest?.["status"] === "string" ? { lastRunStatus: latest["status"] } : {}),
    ...(typeof latest?.["userRequest"] === "string"
      ? { preview: previewFromRequest(latest["userRequest"]) }
      : {})
  };
}

function legacySummary(projectId: string, runs: readonly JsonObject[]): AgentConversationSummary {
  const latest = runs[0];
  return {
    schemaVersion: "1.0",
    conversationId: LEGACY_AGENT_CONVERSATION_ID,
    projectId,
    revision: 0,
    title: "历史 Agent 运行",
    status: "active",
    createdAt: String(runs.at(-1)?.["startedAt"] ?? ""),
    updatedAt: String(latest?.["updatedAt"] ?? ""),
    runCount: runs.length,
    summaryFreshness: "unavailable",
    virtual: true,
    ...(typeof latest?.["runId"] === "string" ? { lastRunId: latest["runId"] } : {}),
    ...(typeof latest?.["status"] === "string" ? { lastRunStatus: latest["status"] } : {})
  };
}

function parseSummary(value: JsonObject): AgentConversationSummary | undefined {
  const record = parseConversationRecord(value);
  if (record === undefined || !Number.isSafeInteger(value["runCount"])) return undefined;
  const freshness = value["summaryFreshness"];
  return {
    ...toSummary(record, []),
    runCount: Number(value["runCount"]),
    summaryFreshness:
      freshness === "fresh" || freshness === "stale" || freshness === "unavailable"
        ? freshness
        : "unavailable",
    ...(typeof value["lastRunId"] === "string" ? { lastRunId: value["lastRunId"] } : {}),
    ...(typeof value["lastRunStatus"] === "string"
      ? { lastRunStatus: value["lastRunStatus"] }
      : {}),
    ...(typeof value["preview"] === "string" ? { preview: value["preview"] } : {}),
    ...(value["virtual"] === true ? { virtual: true } : {})
  };
}

function isSummaryCurrent(summary: JsonObject, latestRun: JsonObject | undefined): boolean {
  if (latestRun === undefined) return false;
  return (
    summary["throughRunId"] === latestRun["runId"] &&
    summary["throughRunRevision"] === latestRun["runRevision"] &&
    summary["throughRunLastSequence"] === latestRun["lastSequence"]
  );
}

function rememberNewestRun(target: Map<string, JsonObject>, candidate: JsonObject): void {
  const runId = readSafeId(candidate, "runId");
  if (runId === undefined) return;
  const current = target.get(runId);
  if (
    current === undefined ||
    Number(candidate["runRevision"] ?? 0) > Number(current["runRevision"] ?? 0) ||
    String(candidate["updatedAt"] ?? "") > String(current["updatedAt"] ?? "")
  ) {
    target.set(runId, candidate);
  }
}

function compareRuns(left: JsonObject, right: JsonObject): number {
  return (
    String(right["updatedAt"] ?? "").localeCompare(String(left["updatedAt"] ?? "")) ||
    String(left["runId"] ?? "").localeCompare(String(right["runId"] ?? ""))
  );
}

function compareConversationSummaries(
  left: AgentConversationSummary,
  right: AgentConversationSummary
): number {
  return (
    right.updatedAt.localeCompare(left.updatedAt) ||
    left.conversationId.localeCompare(right.conversationId)
  );
}

function titleFromRequest(request: string): string {
  const normalized = request.trim().replace(/\s+/gu, " ");
  return [...normalized].slice(0, 48).join("") || "新会话";
}

function previewFromRequest(request: string): string {
  return [...request.trim().replace(/\s+/gu, " ")].slice(0, 256).join("");
}

function defaultConversationId(commandId: string): string {
  let first = 2166136261;
  let second = 2246822519;
  for (const char of commandId) {
    const point = char.codePointAt(0) ?? 0;
    first = Math.imul(first ^ point, 16777619);
    second = Math.imul(second ^ point, 3266489917);
  }
  return `conv_${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`;
}

function normalizedLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_PAGE_LIMIT;
  return Math.max(1, Math.min(Math.trunc(limit), MAX_PAGE_LIMIT));
}

function laterTimestamp(current: string, candidate: string): string {
  return candidate > current ? candidate : current;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function readSafeId(value: JsonObject, key: string): string | undefined {
  const candidate = value[key];
  return typeof candidate === "string" && isSafeId(candidate) ? candidate : undefined;
}

function readOptionalSafeId(value: JsonObject, key: string): string | undefined | null {
  const candidate = value[key];
  return candidate === undefined
    ? undefined
    : typeof candidate === "string" && isSafeId(candidate)
      ? candidate
      : null;
}

function readString(value: JsonObject, key: string): string | undefined {
  return typeof value[key] === "string" ? value[key] : undefined;
}

function readObject(value: JsonObject | undefined, key: string): JsonObject | undefined {
  const nested = value?.[key];
  return isJsonObject(nested) ? nested : undefined;
}

function isSafeId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(value);
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTerminalStatus(status: string | undefined): boolean {
  return (
    status !== undefined && ["completed", "cancelled", "failed", "limit_reached"].includes(status)
  );
}

function asJsonObject(value: object): JsonObject {
  return value as unknown as JsonObject;
}

function failure<T>(code: string): Result<T, UnifiedError> {
  return err(conversationError(code));
}

function conversationError(code: string): UnifiedError {
  return createUnifiedError({
    code,
    category: "AgentError",
    message: "The Agent conversation operation could not be completed.",
    recoverability: "user-action",
    suggestedAction: "Refresh the conversation list and retry.",
    traceId: "agent-conversation-session"
  });
}
