import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  createGeminiPromptCacheResourceDescriptor,
  type LlmPromptCacheBypassReason,
  type LlmPromptCacheRequest,
  type LlmRequest
} from "@novel-studio/llm-adapter";

const JOURNAL_VERSION = "1.0" as const;
const RESOURCE_REF = /^cachedContents\/[A-Za-z0-9._~-]{1,256}$/u;
const CHECKSUM = /^[a-f0-9]{64}$/u;

type ResourceStatus =
  "active" | "create_failed" | "create_uncertain" | "delete_confirmed" | "delete_uncertain";

interface GeminiPromptCacheResourceRecord {
  readonly schemaVersion: typeof JOURNAL_VERSION;
  readonly recordId: string;
  readonly identityChecksum: string;
  readonly scopeKey: string;
  readonly provider: "google-gemini";
  readonly modelName: string;
  readonly physicalPrefixChecksum: string;
  readonly resourceRef?: string;
  readonly status: ResourceStatus;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly deleteAttemptedAt?: string;
}

interface GeminiPromptCacheResourceJournal {
  readonly schemaVersion: typeof JOURNAL_VERSION;
  readonly records: readonly GeminiPromptCacheResourceRecord[];
}

interface CleanupCredentials {
  readonly baseUrl: string;
  readonly apiKey: string;
}

export interface ResolveGeminiPromptCacheResourceInput {
  readonly scopeKey: string;
  readonly request: LlmRequest;
  readonly apiKey: string;
}

export interface GeminiPromptCacheResourceManager {
  resolve(input: ResolveGeminiPromptCacheResourceInput): Promise<LlmPromptCacheRequest | undefined>;
  releaseScope(scopeKey: string): Promise<void>;
  dispose(): Promise<void>;
}

export interface CreateGeminiPromptCacheResourceManagerOptions {
  readonly userDataRoot: string;
  readonly fetch: typeof fetch;
  readonly now?: () => string;
}

export function createGeminiPromptCacheResourceManager(
  options: CreateGeminiPromptCacheResourceManagerOptions
): GeminiPromptCacheResourceManager {
  const journalPath = join(options.userDataRoot, "agent", "prompt-cache", "gemini-resources.json");
  const now = options.now ?? (() => new Date().toISOString());
  const cleanupCredentials = new Map<string, CleanupCredentials>();
  let journalPromise: Promise<GeminiPromptCacheResourceJournal> | undefined;
  let operationTail: Promise<void> = Promise.resolve();

  const loadJournal = async (): Promise<GeminiPromptCacheResourceJournal> => {
    if (journalPromise !== undefined) return journalPromise;
    journalPromise = (async () => {
      try {
        const parsed = JSON.parse(await readFile(journalPath, "utf8")) as unknown;
        if (!isJournal(parsed)) throw new Error("PROMPT_CACHE_RESOURCE_JOURNAL_INVALID");
        return parsed;
      } catch (error) {
        if (isMissingFileError(error)) return { schemaVersion: JOURNAL_VERSION, records: [] };
        throw error;
      }
    })();
    return journalPromise;
  };

  const saveJournal = async (journal: GeminiPromptCacheResourceJournal): Promise<void> => {
    await mkdir(dirname(journalPath), { recursive: true });
    await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`, "utf8");
    journalPromise = Promise.resolve(journal);
  };

  const exclusive = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = operationTail.then(operation, operation);
    operationTail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };

  const updateRecord = async (
    journal: GeminiPromptCacheResourceJournal,
    recordId: string,
    patch: Partial<GeminiPromptCacheResourceRecord>
  ): Promise<GeminiPromptCacheResourceJournal> => {
    const next = {
      schemaVersion: JOURNAL_VERSION,
      records: journal.records.map((record) =>
        record.recordId === recordId ? { ...record, ...patch } : record
      )
    } satisfies GeminiPromptCacheResourceJournal;
    await saveJournal(next);
    return next;
  };

  const deleteResource = async (
    journal: GeminiPromptCacheResourceJournal,
    record: GeminiPromptCacheResourceRecord
  ): Promise<GeminiPromptCacheResourceJournal> => {
    if (record.status !== "active" || record.resourceRef === undefined) return journal;
    const attemptedAt = now();
    const credentials = cleanupCredentials.get(record.recordId);
    if (credentials === undefined) {
      return updateRecord(journal, record.recordId, {
        status: "delete_uncertain",
        deleteAttemptedAt: attemptedAt
      });
    }
    let confirmed = false;
    try {
      const response = await options.fetch(
        `${credentials.baseUrl.replace(/\/+$/u, "")}/${record.resourceRef}`,
        {
          method: "DELETE",
          headers: { "x-goog-api-key": credentials.apiKey }
        }
      );
      confirmed = response.ok || response.status === 404;
    } catch {
      confirmed = false;
    }
    cleanupCredentials.delete(record.recordId);
    return updateRecord(journal, record.recordId, {
      status: confirmed ? "delete_confirmed" : "delete_uncertain",
      deleteAttemptedAt: attemptedAt
    });
  };

  const manager: GeminiPromptCacheResourceManager = {
    resolve(input) {
      return exclusive(async () => {
        const config = input.request.promptCache;
        if (config === undefined || config.mode !== "explicit_resource") return config;
        if (config.bypassReason !== undefined) return withoutResource(config, config.bypassReason);
        if (!isScopeKey(input.scopeKey) || input.apiKey.length === 0) {
          return withoutResource(config, "resource_unavailable");
        }
        const descriptor = createGeminiPromptCacheResourceDescriptor(input.request);
        if (descriptor === undefined) return withoutResource(config, "identity_unverified");

        let journal: GeminiPromptCacheResourceJournal;
        try {
          journal = await loadJournal();
        } catch {
          return withoutResource(config, "cache_error");
        }
        const current = [...journal.records]
          .reverse()
          .find((record) => record.identityChecksum === config.identityChecksum);
        const baseUrl = input.request.modelProfile.baseUrl?.trim();
        if (baseUrl === undefined || baseUrl.length === 0) {
          return withoutResource(config, "resource_unavailable");
        }

        if (current?.status === "active") {
          if (
            current.scopeKey !== input.scopeKey ||
            current.modelName !== input.request.modelProfile.modelName ||
            current.physicalPrefixChecksum !== descriptor.physicalPrefixChecksum ||
            current.resourceRef === undefined
          ) {
            return withoutResource(config, "identity_unverified");
          }
          cleanupCredentials.set(current.recordId, { baseUrl, apiKey: input.apiKey });
          if (Date.parse(current.expiresAt) > Date.parse(now())) {
            return {
              ...withoutResource(config),
              resourceRef: current.resourceRef,
              physicalPrefixChecksum: current.physicalPrefixChecksum
            };
          }
          journal = await deleteResource(journal, current);
          const deleted = journal.records.find((record) => record.recordId === current.recordId);
          if (deleted?.status !== "delete_confirmed") {
            return withoutResource(config, "resource_expired");
          }
        } else if (current?.status === "create_failed" || current?.status === "create_uncertain") {
          return withoutResource(config, "resource_create_failed");
        } else if (current?.status === "delete_uncertain") {
          return withoutResource(config, "resource_unavailable");
        }

        const createdAt = now();
        const localExpiresAt = new Date(
          Date.parse(createdAt) + (config.ttlSeconds ?? 3_600) * 1_000
        ).toISOString();
        const baseRecord = {
          schemaVersion: JOURNAL_VERSION,
          recordId: resourceRecordId(config.identityChecksum, createdAt, journal.records.length),
          identityChecksum: config.identityChecksum,
          scopeKey: input.scopeKey,
          provider: "google-gemini",
          modelName: input.request.modelProfile.modelName,
          physicalPrefixChecksum: descriptor.physicalPrefixChecksum,
          createdAt,
          expiresAt: localExpiresAt
        } as const;
        let response: Response;
        try {
          response = await options.fetch(`${baseUrl.replace(/\/+$/u, "")}/cachedContents`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-goog-api-key": input.apiKey
            },
            body: JSON.stringify(descriptor.body),
            ...(input.request.abortSignal === undefined
              ? {}
              : { signal: input.request.abortSignal })
          });
        } catch {
          await appendRecord(journal, { ...baseRecord, status: "create_uncertain" }, saveJournal);
          return withoutResource(config, "resource_create_failed");
        }
        if (!response.ok) {
          await appendRecord(
            journal,
            {
              ...baseRecord,
              status:
                response.status >= 400 && response.status < 500
                  ? "create_failed"
                  : "create_uncertain"
            },
            saveJournal
          );
          return withoutResource(config, "resource_create_failed");
        }

        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          await appendRecord(journal, { ...baseRecord, status: "create_uncertain" }, saveJournal);
          return withoutResource(config, "resource_create_failed");
        }
        const resourceRef = readResourceRef(payload);
        if (resourceRef === undefined) {
          await appendRecord(journal, { ...baseRecord, status: "create_uncertain" }, saveJournal);
          return withoutResource(config, "resource_create_failed");
        }
        const record: GeminiPromptCacheResourceRecord = {
          ...baseRecord,
          resourceRef,
          status: "active",
          expiresAt: boundedExpiry(payload, localExpiresAt)
        };
        journal = await appendRecord(journal, record, saveJournal);
        cleanupCredentials.set(record.recordId, { baseUrl, apiKey: input.apiKey });
        const resourceWriteTokens = readCreateTokenCount(payload);
        return {
          ...withoutResource(config),
          resourceRef,
          physicalPrefixChecksum: descriptor.physicalPrefixChecksum,
          ...(resourceWriteTokens === undefined ? {} : { resourceWriteTokens })
        };
      });
    },
    releaseScope(scopeKey) {
      return exclusive(async () => {
        let journal: GeminiPromptCacheResourceJournal;
        try {
          journal = await loadJournal();
        } catch {
          return;
        }
        for (const record of journal.records) {
          if (record.scopeKey === scopeKey && record.status === "active") {
            journal = await deleteResource(journal, record);
          }
        }
      });
    },
    dispose() {
      return exclusive(async () => {
        let journal: GeminiPromptCacheResourceJournal;
        try {
          journal = await loadJournal();
        } catch {
          return;
        }
        for (const record of journal.records) {
          if (record.status === "active") journal = await deleteResource(journal, record);
        }
      });
    }
  };
  return manager;
}

async function appendRecord(
  journal: GeminiPromptCacheResourceJournal,
  record: GeminiPromptCacheResourceRecord,
  save: (journal: GeminiPromptCacheResourceJournal) => Promise<void>
): Promise<GeminiPromptCacheResourceJournal> {
  const next = {
    schemaVersion: JOURNAL_VERSION,
    records: [...journal.records, record]
  } satisfies GeminiPromptCacheResourceJournal;
  await save(next);
  return next;
}

function withoutResource(
  config: LlmPromptCacheRequest,
  bypassReason?: LlmPromptCacheBypassReason
): LlmPromptCacheRequest {
  const {
    resourceRef,
    physicalPrefixChecksum,
    resourceWriteTokens,
    bypassReason: currentBypassReason,
    ...base
  } = config;
  void resourceRef;
  void physicalPrefixChecksum;
  void resourceWriteTokens;
  void currentBypassReason;
  return bypassReason === undefined ? base : { ...base, bypassReason };
}

function resourceRecordId(identityChecksum: string, createdAt: string, serial: number): string {
  return `gemini_cache_${createHash("sha256")
    .update(`${identityChecksum}\u0000${createdAt}\u0000${String(serial)}`, "utf8")
    .digest("hex")
    .slice(0, 32)}`;
}

function boundedExpiry(payload: unknown, localExpiresAt: string): string {
  if (!isRecord(payload) || typeof payload["expireTime"] !== "string") return localExpiresAt;
  const providerExpiry = Date.parse(payload["expireTime"]);
  return Number.isFinite(providerExpiry) && providerExpiry < Date.parse(localExpiresAt)
    ? new Date(providerExpiry).toISOString()
    : localExpiresAt;
}

function readResourceRef(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const value = payload["name"];
  return typeof value === "string" && RESOURCE_REF.test(value) ? value : undefined;
}

function readCreateTokenCount(payload: unknown): number | undefined {
  if (!isRecord(payload) || !isRecord(payload["usageMetadata"])) return undefined;
  const value = payload["usageMetadata"]["totalTokenCount"];
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
}

function isJournal(value: unknown): value is GeminiPromptCacheResourceJournal {
  return (
    isRecord(value) &&
    value["schemaVersion"] === JOURNAL_VERSION &&
    Array.isArray(value["records"]) &&
    value["records"].every(isResourceRecord)
  );
}

function isResourceRecord(value: unknown): value is GeminiPromptCacheResourceRecord {
  if (!isRecord(value)) return false;
  const resourceRef = value["resourceRef"];
  return (
    value["schemaVersion"] === JOURNAL_VERSION &&
    isSafeId(value["recordId"]) &&
    isChecksum(value["identityChecksum"]) &&
    isScopeKey(value["scopeKey"]) &&
    value["provider"] === "google-gemini" &&
    isBoundedString(value["modelName"]) &&
    isChecksum(value["physicalPrefixChecksum"]) &&
    (resourceRef === undefined ||
      (typeof resourceRef === "string" && RESOURCE_REF.test(resourceRef))) &&
    (value["status"] === "active" ||
      value["status"] === "create_failed" ||
      value["status"] === "create_uncertain" ||
      value["status"] === "delete_confirmed" ||
      value["status"] === "delete_uncertain") &&
    isUtcTimestamp(value["createdAt"]) &&
    isUtcTimestamp(value["expiresAt"]) &&
    (value["deleteAttemptedAt"] === undefined || isUtcTimestamp(value["deleteAttemptedAt"])) &&
    (value["status"] !== "active" || resourceRef !== undefined)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isChecksum(value: unknown): value is string {
  return typeof value === "string" && CHECKSUM.test(value);
}

function isScopeKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    !hasControlCharacter(value)
  );
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(value);
}

function isBoundedString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512;
}

function isUtcTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
