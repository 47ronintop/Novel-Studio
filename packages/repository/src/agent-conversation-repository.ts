import { Buffer } from "node:buffer";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { err, ok, type JsonObject, type Result, type UnifiedError } from "@novel-studio/shared";

import {
  createProjectPathGuard,
  verifyProjectStoragePath,
  writeTextAtomically,
  type ProjectPathGuard
} from "./atomic-write.js";
import { storageError, validationError } from "./errors.js";

const LEGACY_CONVERSATION_ID = "legacy_agent_runs";
const DEFAULT_LIST_LIMIT = 30;
const MAX_LIST_LIMIT = 100;
const MAX_RECORD_BYTES = 16 * 1024;
const MAX_TITLE_BYTES = 512;
const MAX_SUMMARY_CONTENT_BYTES = 8 * 1024;
const MAX_SUMMARY_RECORD_BYTES = 64 * 1024;
const MAX_RECEIPT_BYTES = 64 * 1024;
const MAX_DRAFT_RECORD_BYTES = 64 * 1024;
type DraftLeaf = "run-drafts" | "context-drafts";
const MAX_SUMMARY_RUN_IDS = 100;
const MAX_SEARCH_QUERY_BYTES = 1024;
const MAX_SEARCH_INDEX_BYTES = 4 * 1024 * 1024;
const MAX_SEARCH_DOCUMENTS = 10_000;
const MAX_SEARCH_USER_REQUESTS = 100;

export interface AgentConversationRecord extends JsonObject {
  readonly schemaVersion: "1.0";
  readonly conversationId: string;
  readonly projectId: string;
  readonly revision: number;
  readonly title: string;
  readonly status: "active" | "archived";
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdByCommandId?: string;
  readonly lastMutationCommandId?: string;
}

export interface AgentConversationSummaryRevision extends JsonObject {
  readonly schemaVersion: "1.0";
  readonly conversationId: string;
  readonly revision: number;
  readonly sourceRunIds: string[];
  readonly throughRunId: string;
  readonly throughRunRevision: number;
  readonly throughRunLastSequence: number;
  readonly content: string;
  readonly createdAt: string;
}

export interface AgentConversationListDiagnostic extends JsonObject {
  readonly conversationId?: string;
  readonly code: string;
}

export interface AgentConversationListPage {
  readonly items: AgentConversationRecord[];
  readonly diagnostics: AgentConversationListDiagnostic[];
  readonly nextCursor?: string;
}

export interface AgentConversationSearchDocument extends JsonObject {
  readonly schemaVersion: "1.0";
  readonly conversationId: string;
  readonly projectId: string;
  readonly title: string;
  readonly status: "active" | "archived";
  readonly updatedAt: string;
  readonly latestSummary: string;
  readonly userRequests: string[];
}

export interface AgentConversationSearchHit extends JsonObject {
  readonly conversationId: string;
  readonly snippet: string;
}

export interface AgentConversationSearchPage {
  readonly items: AgentConversationSearchHit[];
  readonly diagnostics: AgentConversationListDiagnostic[];
  readonly nextCursor?: string;
}

export interface AgentConversationFileRepositoryOptions {
  readonly projectRoot: string;
  readonly traceId?: string;
}

export interface UpdateAgentConversationRecordInput {
  readonly conversationId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly title?: string;
  readonly status?: "active" | "archived";
  readonly updatedAt: string;
  readonly mutationCommandId?: string;
}

interface ConversationCursor {
  readonly projectId: string;
  readonly status: "active" | "archived" | null;
  readonly updatedAt: string;
  readonly conversationId: string;
}

interface ConversationSearchCursor {
  readonly projectId: string;
  readonly query: string;
  readonly includeArchived: boolean;
  readonly updatedAt: string;
  readonly conversationId: string;
}

export class AgentConversationFileRepository {
  private readonly traceId: string;
  private readonly pathGuard: ProjectPathGuard;
  private readonly writeTails = new Map<string, Promise<void>>();

  public constructor(private readonly options: AgentConversationFileRepositoryOptions) {
    this.traceId = options.traceId ?? "agent-conversation-file-repository";
    this.pathGuard = createProjectPathGuard(options.projectRoot);
  }

  public createConversation(
    record: AgentConversationRecord
  ): Promise<Result<AgentConversationRecord, UnifiedError>> {
    if (record.conversationId === LEGACY_CONVERSATION_ID) {
      return Promise.resolve(this.invalid("AGENT_CONVERSATION_ID_RESERVED"));
    }
    if (!isConversationRecord(record) || jsonByteLength(record) > MAX_RECORD_BYTES) {
      return Promise.resolve(this.invalid("AGENT_CONVERSATION_RECORD_INVALID"));
    }
    return this.withConversationWrite(record.conversationId, async () => {
      const existing = await this.readConversation(record.conversationId);
      if (!existing.ok) return existing;
      if (existing.value !== undefined) {
        return sameJson(existing.value, record)
          ? ok(existing.value)
          : this.invalid("AGENT_CONVERSATION_CREATE_CONFLICT");
      }
      const written = await this.writeJson(this.conversationPath(record.conversationId), record);
      return written.ok ? ok(record) : written;
    });
  }

  public async readConversation(
    conversationId: string
  ): Promise<Result<AgentConversationRecord | undefined, UnifiedError>> {
    if (!isSafeId(conversationId)) return this.invalid("AGENT_CONVERSATION_ID_INVALID");
    if (conversationId === LEGACY_CONVERSATION_ID) {
      return this.invalid("AGENT_CONVERSATION_ID_RESERVED");
    }
    const read = await this.readJson(
      this.conversationPath(conversationId),
      "AGENT_CONVERSATION_READ_FAILED",
      MAX_RECORD_BYTES
    );
    if (!read.ok) return err(read.error);
    if (read.value === undefined) return ok(undefined);
    return isConversationRecord(read.value) && read.value.conversationId === conversationId
      ? ok(read.value)
      : this.invalid("AGENT_CONVERSATION_RECORD_INVALID");
  }

  public async listConversations(input: {
    readonly projectId: string;
    readonly status?: "active" | "archived";
    readonly cursor?: string;
    readonly limit?: number;
  }): Promise<Result<AgentConversationListPage, UnifiedError>> {
    if (!isSafeId(input.projectId)) return this.invalid("AGENT_CONVERSATION_PROJECT_INVALID");
    const cursor = decodeCursor(input.cursor);
    if (
      input.cursor !== undefined &&
      (cursor === undefined ||
        cursor.projectId !== input.projectId ||
        cursor.status !== (input.status ?? null))
    ) {
      return this.invalid("AGENT_CONVERSATION_CURSOR_INVALID");
    }
    const limit = normalizedLimit(input.limit);
    const root = this.conversationsRoot();
    const verified = await verifyProjectStoragePath(this.pathGuard, root, this.traceId);
    if (!verified.ok) return verified;
    try {
      const entries = await readdir(root, { withFileTypes: true });
      const conversations: AgentConversationRecord[] = [];
      const diagnostics: AgentConversationListDiagnostic[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory() || !isSafeId(entry.name)) continue;
        const conversation = await this.readConversation(entry.name);
        if (!conversation.ok) {
          diagnostics.push({ conversationId: entry.name, code: conversation.error.code });
          continue;
        }
        if (conversation.value === undefined || conversation.value.projectId !== input.projectId) {
          continue;
        }
        if (input.status !== undefined && conversation.value.status !== input.status) continue;
        conversations.push(conversation.value);
      }
      conversations.sort(compareConversations);
      const afterCursor =
        cursor === undefined
          ? conversations
          : conversations.filter((record) => isAfterCursor(record, cursor));
      const items = afterCursor.slice(0, limit);
      const last = items.at(-1);
      return ok({
        items,
        diagnostics,
        ...(afterCursor.length > items.length && last !== undefined
          ? {
              nextCursor: encodeCursor({
                projectId: input.projectId,
                status: input.status ?? null,
                updatedAt: last.updatedAt,
                conversationId: last.conversationId
              })
            }
          : {})
      });
    } catch (error) {
      return isMissingFileError(error)
        ? ok({ items: [], diagnostics: [] })
        : err(this.storageFailure("AGENT_CONVERSATION_LIST_FAILED", error));
    }
  }

  public async searchConversations(input: {
    readonly projectId: string;
    readonly query: string;
    readonly includeArchived?: boolean;
    readonly cursor?: string;
    readonly limit?: number;
    readonly documents: readonly AgentConversationSearchDocument[];
  }): Promise<Result<AgentConversationSearchPage, UnifiedError>> {
    const normalizedQuery = input.query.trim().toLocaleLowerCase();
    const includeArchived = input.includeArchived === true;
    if (
      !isSafeId(input.projectId) ||
      Buffer.byteLength(normalizedQuery, "utf8") > MAX_SEARCH_QUERY_BYTES ||
      input.documents.length > MAX_SEARCH_DOCUMENTS
    ) {
      return this.invalid("AGENT_CONVERSATION_QUERY_INVALID");
    }
    const cursor = decodeSearchCursor(input.cursor);
    if (
      input.cursor !== undefined &&
      (cursor === undefined ||
        cursor.projectId !== input.projectId ||
        cursor.query !== normalizedQuery ||
        cursor.includeArchived !== includeArchived)
    ) {
      return this.invalid("AGENT_CONVERSATION_CURSOR_INVALID");
    }
    if (normalizedQuery.length === 0) return ok({ items: [], diagnostics: [] });

    const diagnostics: AgentConversationListDiagnostic[] = [];
    const documents: AgentConversationSearchDocument[] = [];
    for (const candidate of input.documents) {
      if (!isSearchDocument(candidate) || candidate.projectId !== input.projectId) {
        diagnostics.push({
          code: "AGENT_CONVERSATION_SEARCH_DOCUMENT_INVALID",
          ...(typeof candidate?.["conversationId"] === "string" &&
          isSafeId(candidate["conversationId"])
            ? { conversationId: candidate["conversationId"] }
            : {})
        });
        continue;
      }
      documents.push(candidate);
    }
    documents.sort(compareSearchDocuments);
    const index: JsonObject = {
      schemaVersion: "1.0",
      projectId: input.projectId,
      documents
    };
    if (jsonByteLength(index) > MAX_SEARCH_INDEX_BYTES) {
      return this.invalid("AGENT_CONVERSATION_SEARCH_INDEX_INVALID");
    }
    const cached = await this.readJson(
      this.searchIndexPath(),
      "AGENT_CONVERSATION_SEARCH_INDEX_READ_FAILED",
      MAX_SEARCH_INDEX_BYTES
    );
    if (cached.ok && cached.value !== undefined && !isSearchIndex(cached.value, input.projectId)) {
      diagnostics.push({ code: "AGENT_CONVERSATION_SEARCH_INDEX_REBUILT" });
    } else if (!cached.ok) {
      diagnostics.push({ code: "AGENT_CONVERSATION_SEARCH_INDEX_REBUILT" });
    }
    if (!cached.ok || cached.value === undefined || !sameJson(cached.value, index)) {
      const written = await this.writeJson(this.searchIndexPath(), index);
      if (!written.ok) {
        diagnostics.push({ code: "AGENT_CONVERSATION_SEARCH_INDEX_WRITE_FAILED" });
      }
    }

    const matched = documents
      .filter((document) => includeArchived || document.status === "active")
      .map((document) => ({ document, snippet: searchSnippet(document, normalizedQuery) }))
      .filter(
        (entry): entry is { document: AgentConversationSearchDocument; snippet: string } =>
          entry.snippet !== undefined
      );
    const afterCursor =
      cursor === undefined
        ? matched
        : matched.filter(({ document }) => isSearchDocumentAfterCursor(document, cursor));
    const limit = normalizedLimit(input.limit);
    const page = afterCursor.slice(0, limit);
    const last = page.at(-1)?.document;
    return ok({
      items: page.map(({ document, snippet }) => ({
        conversationId: document.conversationId,
        snippet
      })),
      diagnostics,
      ...(afterCursor.length > page.length && last !== undefined
        ? {
            nextCursor: encodeSearchCursor({
              projectId: input.projectId,
              query: normalizedQuery,
              includeArchived,
              updatedAt: last.updatedAt,
              conversationId: last.conversationId
            })
          }
        : {})
    });
  }

  public updateConversation(
    input: UpdateAgentConversationRecordInput
  ): Promise<Result<AgentConversationRecord, UnifiedError>> {
    if (
      !isSafeId(input.conversationId) ||
      !isSafeId(input.projectId) ||
      input.conversationId === LEGACY_CONVERSATION_ID ||
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 1 ||
      (input.mutationCommandId !== undefined && !isSafeId(input.mutationCommandId))
    ) {
      return Promise.resolve(this.invalid("AGENT_CONVERSATION_ID_INVALID"));
    }
    return this.withConversationWrite(input.conversationId, async () => {
      const current = await this.readConversation(input.conversationId);
      if (!current.ok) return current;
      if (current.value === undefined || current.value.projectId !== input.projectId) {
        return this.invalid("AGENT_CONVERSATION_NOT_FOUND");
      }
      if (current.value.revision !== input.expectedRevision) {
        return this.invalid("AGENT_CONVERSATION_REVISION_CONFLICT", {
          latestConversation: current.value
        });
      }
      const next: AgentConversationRecord = {
        ...current.value,
        revision: current.value.revision + 1,
        updatedAt: laterTimestamp(current.value.updatedAt, input.updatedAt),
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.mutationCommandId === undefined
          ? {}
          : { lastMutationCommandId: input.mutationCommandId })
      };
      if (!isConversationRecord(next) || jsonByteLength(next) > MAX_RECORD_BYTES) {
        return this.invalid("AGENT_CONVERSATION_RECORD_INVALID");
      }
      const written = await this.writeJson(this.conversationPath(input.conversationId), next);
      return written.ok ? ok(next) : written;
    });
  }

  public writeCommandReceipt(
    conversationId: string,
    commandId: string,
    receipt: JsonObject
  ): Promise<Result<JsonObject, UnifiedError>> {
    if (
      !isSafeId(conversationId) ||
      conversationId === LEGACY_CONVERSATION_ID ||
      !isSafeId(commandId) ||
      jsonByteLength(receipt) > MAX_RECEIPT_BYTES
    ) {
      return Promise.resolve(this.invalid("AGENT_CONVERSATION_RECEIPT_INVALID"));
    }
    return this.withConversationWrite(conversationId, async () => {
      const conversation = await this.readConversation(conversationId);
      if (!conversation.ok) return conversation;
      if (conversation.value === undefined) return this.invalid("AGENT_CONVERSATION_NOT_FOUND");
      const existing = await this.readCommandReceipt(conversationId, commandId);
      if (!existing.ok) return existing;
      if (existing.value !== undefined) {
        return sameJson(existing.value, receipt)
          ? ok(existing.value)
          : this.invalid("AGENT_CONVERSATION_RECEIPT_CONFLICT");
      }
      const written = await this.writeJson(this.receiptPath(conversationId, commandId), receipt);
      return written.ok ? ok(receipt) : written;
    });
  }

  public readCommandReceipt(
    conversationId: string,
    commandId: string
  ): Promise<Result<JsonObject | undefined, UnifiedError>> {
    if (
      !isSafeId(conversationId) ||
      conversationId === LEGACY_CONVERSATION_ID ||
      !isSafeId(commandId)
    ) {
      return Promise.resolve(this.invalid("AGENT_CONVERSATION_RECEIPT_INVALID"));
    }
    return this.readJson(
      this.receiptPath(conversationId, commandId),
      "AGENT_CONVERSATION_RECEIPT_READ_FAILED",
      MAX_RECEIPT_BYTES
    );
  }

  public writeRunDraft(draft: JsonObject): Promise<Result<JsonObject, UnifiedError>> {
    return this.writeDraft("run-drafts", draft);
  }

  public readLatestRunDraft(
    conversationId: string
  ): Promise<Result<JsonObject | undefined, UnifiedError>> {
    return this.readLatestDraft("run-drafts", conversationId);
  }

  public writeContextDraft(draft: JsonObject): Promise<Result<JsonObject, UnifiedError>> {
    return this.writeDraft("context-drafts", draft);
  }

  public readLatestContextDraft(
    conversationId: string
  ): Promise<Result<JsonObject | undefined, UnifiedError>> {
    return this.readLatestDraft("context-drafts", conversationId);
  }

  private writeDraft(
    leaf: DraftLeaf,
    draft: JsonObject
  ): Promise<Result<JsonObject, UnifiedError>> {
    const conversationId = draft["conversationId"];
    const revision = draft["revision"];
    if (
      typeof conversationId !== "string" ||
      !isSafeId(conversationId) ||
      conversationId === LEGACY_CONVERSATION_ID ||
      !isDraftRevisionNumber(revision) ||
      jsonByteLength(draft) > MAX_DRAFT_RECORD_BYTES
    ) {
      return Promise.resolve(this.invalid("AGENT_CONVERSATION_DRAFT_INVALID"));
    }
    return this.withConversationWrite(conversationId, async () => {
      const existing = await this.readDraftRevision(leaf, conversationId, revision);
      if (!existing.ok) return existing;
      if (existing.value !== undefined) {
        return sameJson(existing.value, draft)
          ? ok(existing.value)
          : this.invalid("AGENT_CONVERSATION_DRAFT_CONFLICT");
      }
      const written = await this.writeJson(this.draftPath(leaf, conversationId, revision), draft);
      return written.ok ? ok(draft) : written;
    });
  }

  private async readLatestDraft(
    leaf: DraftLeaf,
    conversationId: string
  ): Promise<Result<JsonObject | undefined, UnifiedError>> {
    if (!isSafeId(conversationId) || conversationId === LEGACY_CONVERSATION_ID) {
      return this.invalid("AGENT_CONVERSATION_ID_INVALID");
    }
    const root = this.draftRoot(leaf, conversationId);
    const verified = await verifyProjectStoragePath(this.pathGuard, root, this.traceId);
    if (!verified.ok) return verified;
    try {
      const revisions = (await readdir(root, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && /^[1-9][0-9]*\.json$/u.test(entry.name))
        .map((entry) => Number(entry.name.slice(0, -5)))
        .filter(Number.isSafeInteger)
        .sort((left, right) => right - left);
      return revisions[0] === undefined
        ? ok(undefined)
        : this.readDraftRevision(leaf, conversationId, revisions[0]);
    } catch (error) {
      return isMissingFileError(error)
        ? ok(undefined)
        : err(this.storageFailure("AGENT_CONVERSATION_DRAFT_READ_FAILED", error));
    }
  }

  private async readDraftRevision(
    leaf: DraftLeaf,
    conversationId: string,
    revision: number
  ): Promise<Result<JsonObject | undefined, UnifiedError>> {
    if (!isSafeId(conversationId) || !isDraftRevisionNumber(revision)) {
      return this.invalid("AGENT_CONVERSATION_DRAFT_INVALID");
    }
    const read = await this.readJson(
      this.draftPath(leaf, conversationId, revision),
      "AGENT_CONVERSATION_DRAFT_READ_FAILED",
      MAX_DRAFT_RECORD_BYTES
    );
    if (!read.ok) return err(read.error);
    if (read.value === undefined) return ok(undefined);
    return read.value["conversationId"] === conversationId && read.value["revision"] === revision
      ? ok(read.value)
      : this.invalid("AGENT_CONVERSATION_DRAFT_INVALID");
  }

  public writeSummary(
    summary: AgentConversationSummaryRevision
  ): Promise<Result<AgentConversationSummaryRevision, UnifiedError>> {
    if (
      summary.conversationId === LEGACY_CONVERSATION_ID ||
      !isSummaryRevision(summary) ||
      jsonByteLength(summary) > MAX_SUMMARY_RECORD_BYTES
    ) {
      return Promise.resolve(this.invalid("AGENT_CONVERSATION_SUMMARY_INVALID"));
    }
    return this.withConversationWrite(summary.conversationId, async () => {
      const conversation = await this.readConversation(summary.conversationId);
      if (!conversation.ok) return conversation;
      if (conversation.value === undefined) return this.invalid("AGENT_CONVERSATION_NOT_FOUND");
      const existing = await this.readSummary(summary.conversationId, summary.revision);
      if (!existing.ok) return existing;
      if (existing.value !== undefined) {
        return sameJson(existing.value, summary)
          ? ok(existing.value)
          : this.invalid("AGENT_CONVERSATION_SUMMARY_CONFLICT");
      }
      const written = await this.writeJson(
        this.summaryPath(summary.conversationId, summary.revision),
        summary
      );
      return written.ok ? ok(summary) : written;
    });
  }

  public async readLatestSummary(
    conversationId: string
  ): Promise<Result<AgentConversationSummaryRevision | undefined, UnifiedError>> {
    if (!isSafeId(conversationId) || conversationId === LEGACY_CONVERSATION_ID) {
      return this.invalid("AGENT_CONVERSATION_ID_INVALID");
    }
    const root = this.summariesRoot(conversationId);
    const verified = await verifyProjectStoragePath(this.pathGuard, root, this.traceId);
    if (!verified.ok) return verified;
    try {
      const revisions = (await readdir(root, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && /^[1-9][0-9]*\.json$/u.test(entry.name))
        .map((entry) => Number(entry.name.slice(0, -5)))
        .filter(Number.isSafeInteger)
        .sort((left, right) => right - left);
      return revisions[0] === undefined
        ? ok(undefined)
        : this.readSummary(conversationId, revisions[0]);
    } catch (error) {
      return isMissingFileError(error)
        ? ok(undefined)
        : err(this.storageFailure("AGENT_CONVERSATION_SUMMARY_READ_FAILED", error));
    }
  }

  private async readSummary(
    conversationId: string,
    revision: number
  ): Promise<Result<AgentConversationSummaryRevision | undefined, UnifiedError>> {
    if (!isSafeId(conversationId) || !Number.isSafeInteger(revision) || revision < 1) {
      return this.invalid("AGENT_CONVERSATION_SUMMARY_INVALID");
    }
    const read = await this.readJson(
      this.summaryPath(conversationId, revision),
      "AGENT_CONVERSATION_SUMMARY_READ_FAILED",
      MAX_SUMMARY_RECORD_BYTES
    );
    if (!read.ok) return err(read.error);
    if (read.value === undefined) return ok(undefined);
    return isSummaryRevision(read.value) &&
      read.value.conversationId === conversationId &&
      read.value.revision === revision
      ? ok(read.value)
      : this.invalid("AGENT_CONVERSATION_SUMMARY_INVALID");
  }

  private conversationsRoot(): string {
    return join(this.options.projectRoot, "history", "conversations");
  }

  private conversationPath(conversationId: string): string {
    return join(this.conversationsRoot(), conversationId, "conversation.json");
  }

  private receiptPath(conversationId: string, commandId: string): string {
    return join(this.conversationsRoot(), conversationId, "command-receipts", `${commandId}.json`);
  }

  private summariesRoot(conversationId: string): string {
    return join(this.conversationsRoot(), conversationId, "summaries");
  }

  private summaryPath(conversationId: string, revision: number): string {
    return join(this.summariesRoot(conversationId), `${String(revision)}.json`);
  }

  private draftRoot(leaf: DraftLeaf, conversationId: string): string {
    return join(this.conversationsRoot(), conversationId, leaf);
  }

  private draftPath(leaf: DraftLeaf, conversationId: string, revision: number): string {
    return join(this.draftRoot(leaf, conversationId), `${String(revision)}.json`);
  }

  private searchIndexPath(): string {
    return join(this.options.projectRoot, "cache", "indexes", "conversations.json");
  }

  private async writeJson<T extends JsonObject>(
    path: string,
    value: T
  ): Promise<Result<T, UnifiedError>> {
    const written = await writeTextAtomically({
      targetPath: path,
      content: `${JSON.stringify(value, null, 2)}\n`,
      traceId: this.traceId,
      pathGuard: this.pathGuard
    });
    return written.ok ? ok(value) : written;
  }

  private async readJson(
    path: string,
    code: string,
    maxBytes: number
  ): Promise<Result<JsonObject | undefined, UnifiedError>> {
    const verified = await verifyProjectStoragePath(this.pathGuard, path, this.traceId);
    if (!verified.ok) return verified;
    try {
      const text = await readFile(path, "utf8");
      if (Buffer.byteLength(text, "utf8") > maxBytes) return this.invalid(code);
      const parsed = JSON.parse(text) as unknown;
      return isJsonObject(parsed) ? ok(parsed) : this.invalid(code);
    } catch (error) {
      return isMissingFileError(error) ? ok(undefined) : err(this.storageFailure(code, error));
    }
  }

  private async withConversationWrite<T>(
    conversationId: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const previous = this.writeTails.get(conversationId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.writeTails.set(conversationId, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.writeTails.get(conversationId) === tail) this.writeTails.delete(conversationId);
    }
  }

  private invalid<T>(code: string, redactedDetail?: JsonObject): Result<T, UnifiedError> {
    return err(
      validationError({
        code,
        message: "Agent conversation data is invalid.",
        suggestedAction: "Refresh the conversation list and retry.",
        traceId: this.traceId,
        ...(redactedDetail === undefined ? {} : { redactedDetail })
      })
    );
  }

  private storageFailure(code: string, error: unknown): UnifiedError {
    return storageError({
      code,
      message: "Agent conversation data could not be read.",
      suggestedAction: "Check project storage permissions and retry.",
      traceId: this.traceId,
      redactedDetail: {
        reason: error instanceof Error ? error.message : "Unknown storage error"
      }
    });
  }
}

function isConversationRecord(value: unknown): value is AgentConversationRecord {
  if (!isJsonObject(value)) return false;
  return (
    value["schemaVersion"] === "1.0" &&
    typeof value["conversationId"] === "string" &&
    isSafeId(value["conversationId"]) &&
    typeof value["projectId"] === "string" &&
    isSafeId(value["projectId"]) &&
    Number.isSafeInteger(value["revision"]) &&
    Number(value["revision"]) >= 1 &&
    typeof value["title"] === "string" &&
    value["title"].trim().length > 0 &&
    Buffer.byteLength(value["title"], "utf8") <= MAX_TITLE_BYTES &&
    (value["status"] === "active" || value["status"] === "archived") &&
    typeof value["createdAt"] === "string" &&
    value["createdAt"].length > 0 &&
    typeof value["updatedAt"] === "string" &&
    value["updatedAt"].length > 0 &&
    optionalSafeId(value["createdByCommandId"]) &&
    optionalSafeId(value["lastMutationCommandId"])
  );
}

function isDraftRevisionNumber(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}

function isSummaryRevision(value: unknown): value is AgentConversationSummaryRevision {
  if (!isJsonObject(value)) return false;
  return (
    value["schemaVersion"] === "1.0" &&
    typeof value["conversationId"] === "string" &&
    isSafeId(value["conversationId"]) &&
    Number.isSafeInteger(value["revision"]) &&
    Number(value["revision"]) >= 1 &&
    Array.isArray(value["sourceRunIds"]) &&
    value["sourceRunIds"].length <= MAX_SUMMARY_RUN_IDS &&
    value["sourceRunIds"].every((runId) => typeof runId === "string" && isSafeId(runId)) &&
    typeof value["throughRunId"] === "string" &&
    isSafeId(value["throughRunId"]) &&
    Number.isSafeInteger(value["throughRunRevision"]) &&
    Number(value["throughRunRevision"]) >= 0 &&
    Number.isSafeInteger(value["throughRunLastSequence"]) &&
    Number(value["throughRunLastSequence"]) >= 0 &&
    typeof value["content"] === "string" &&
    Buffer.byteLength(value["content"], "utf8") <= MAX_SUMMARY_CONTENT_BYTES &&
    typeof value["createdAt"] === "string" &&
    value["createdAt"].length > 0
  );
}

function compareConversations(left: AgentConversationRecord, right: AgentConversationRecord): number {
  return (
    right.updatedAt.localeCompare(left.updatedAt) ||
    left.conversationId.localeCompare(right.conversationId)
  );
}

function isAfterCursor(record: AgentConversationRecord, cursor: ConversationCursor): boolean {
  return (
    record.updatedAt < cursor.updatedAt ||
    (record.updatedAt === cursor.updatedAt && record.conversationId > cursor.conversationId)
  );
}

function encodeCursor(cursor: ConversationCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined): ConversationCursor | undefined {
  if (cursor === undefined) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (!isJsonObject(parsed)) return undefined;
    const status = parsed["status"];
    return typeof parsed["projectId"] === "string" &&
      isSafeId(parsed["projectId"]) &&
      (status === null || status === "active" || status === "archived") &&
      typeof parsed["updatedAt"] === "string" &&
      typeof parsed["conversationId"] === "string" &&
      isSafeId(parsed["conversationId"])
      ? {
          projectId: parsed["projectId"],
          status,
          updatedAt: parsed["updatedAt"],
          conversationId: parsed["conversationId"]
        }
      : undefined;
  } catch {
    return undefined;
  }
}

function encodeSearchCursor(cursor: ConversationSearchCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeSearchCursor(cursor: string | undefined): ConversationSearchCursor | undefined {
  if (cursor === undefined) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (!isJsonObject(parsed)) return undefined;
    return typeof parsed["projectId"] === "string" &&
      isSafeId(parsed["projectId"]) &&
      typeof parsed["query"] === "string" &&
      typeof parsed["includeArchived"] === "boolean" &&
      typeof parsed["updatedAt"] === "string" &&
      typeof parsed["conversationId"] === "string" &&
      isSafeId(parsed["conversationId"])
      ? {
          projectId: parsed["projectId"],
          query: parsed["query"],
          includeArchived: parsed["includeArchived"],
          updatedAt: parsed["updatedAt"],
          conversationId: parsed["conversationId"]
        }
      : undefined;
  } catch {
    return undefined;
  }
}

function isSearchDocument(value: unknown): value is AgentConversationSearchDocument {
  if (!isJsonObject(value)) return false;
  return (
    value["schemaVersion"] === "1.0" &&
    typeof value["conversationId"] === "string" &&
    isSafeId(value["conversationId"]) &&
    typeof value["projectId"] === "string" &&
    isSafeId(value["projectId"]) &&
    typeof value["title"] === "string" &&
    Buffer.byteLength(value["title"], "utf8") <= MAX_TITLE_BYTES &&
    (value["status"] === "active" || value["status"] === "archived") &&
    typeof value["updatedAt"] === "string" &&
    typeof value["latestSummary"] === "string" &&
    Buffer.byteLength(value["latestSummary"], "utf8") <= MAX_SUMMARY_CONTENT_BYTES &&
    Array.isArray(value["userRequests"]) &&
    value["userRequests"].length <= MAX_SEARCH_USER_REQUESTS &&
    value["userRequests"].every(
      (request) =>
        typeof request === "string" &&
        Buffer.byteLength(request, "utf8") <= MAX_SUMMARY_CONTENT_BYTES
    )
  );
}

function isSearchIndex(value: JsonObject, projectId: string): boolean {
  return (
    value["schemaVersion"] === "1.0" &&
    value["projectId"] === projectId &&
    Array.isArray(value["documents"]) &&
    value["documents"].length <= MAX_SEARCH_DOCUMENTS &&
    value["documents"].every(isSearchDocument)
  );
}

function compareSearchDocuments(
  left: AgentConversationSearchDocument,
  right: AgentConversationSearchDocument
): number {
  return (
    right.updatedAt.localeCompare(left.updatedAt) ||
    left.conversationId.localeCompare(right.conversationId)
  );
}

function isSearchDocumentAfterCursor(
  document: AgentConversationSearchDocument,
  cursor: ConversationSearchCursor
): boolean {
  return (
    document.updatedAt < cursor.updatedAt ||
    (document.updatedAt === cursor.updatedAt && document.conversationId > cursor.conversationId)
  );
}

function searchSnippet(
  document: AgentConversationSearchDocument,
  normalizedQuery: string
): string | undefined {
  for (const text of [document.title, document.latestSummary, ...document.userRequests]) {
    if (text.toLocaleLowerCase().includes(normalizedQuery)) {
      return [...text.trim().replace(/\s+/gu, " ")].slice(0, 256).join("");
    }
  }
  return undefined;
}

function normalizedLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIST_LIMIT;
  return Math.max(1, Math.min(Math.trunc(limit), MAX_LIST_LIMIT));
}

function laterTimestamp(current: string, candidate: string): string {
  return candidate > current ? candidate : current;
}

function jsonByteLength(value: JsonObject): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function optionalSafeId(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && isSafeId(value));
}

function isSafeId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(value);
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameJson(left: JsonObject, right: JsonObject): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "ENOENT"
  );
}
