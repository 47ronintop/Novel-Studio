import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import {
  parseCanonicalRoundManifestV2,
  serializeCanonicalRoundManifestV2,
  type CanonicalRoundManifestV2,
  type CanonicalRoundMessageKindV2
} from "@novel-studio/agent-engine";
import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import {
  createProjectPathGuard,
  verifyProjectStoragePath,
  withProjectFileLock,
  writeTextAtomically,
  type ProjectPathGuard
} from "./atomic-write.js";

export const AGENT_SEND_LEDGER_SCHEMA_VERSION = "2.0" as const;

const CHECKSUM = /^[a-f0-9]{64}$/u;
const MACHINE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const STORAGE_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const ROUND_FILE = /^round-(\d{6})\.json$/u;
const MAX_TEXT_LENGTH = 2_000_000;

export type AgentSendLedgerAdditionKindV2 =
  | "assistant"
  | "tool_result"
  | "remote_result"
  | "user_control"
  | "jit_context"
  | "context_refresh"
  | "recovery";

interface AgentSendLedgerAdditionBaseV2 {
  readonly schemaVersion: typeof AGENT_SEND_LEDGER_SCHEMA_VERSION;
  readonly additionId: string;
  readonly messageOrder: number;
  readonly content: string;
  readonly contentChecksum: string;
}

export type AgentSendLedgerAdditionV2 =
  | (AgentSendLedgerAdditionBaseV2 & {
      readonly kind: "assistant";
      readonly role: "assistant";
    })
  | (AgentSendLedgerAdditionBaseV2 & {
      readonly kind: "tool_result" | "remote_result";
      readonly role: "tool";
      readonly sourceRefId: string;
      readonly toolCallId: string;
    })
  | (AgentSendLedgerAdditionBaseV2 & {
      readonly kind: "user_control";
      readonly role: "user";
    })
  | (AgentSendLedgerAdditionBaseV2 & {
      readonly kind: "jit_context" | "context_refresh" | "recovery";
      readonly role: "user";
      readonly sourceRefId: string;
    });

export interface AgentSendLedgerPreviewBindingV2 {
  readonly schemaVersion: typeof AGENT_SEND_LEDGER_SCHEMA_VERSION;
  readonly previewId: string;
  readonly canonicalPayloadChecksum: string;
}

export interface ProviderNativeSemanticProofV2 {
  readonly schemaVersion: typeof AGENT_SEND_LEDGER_SCHEMA_VERSION;
  readonly adapterPolicyRevision: string;
  readonly providerSemanticVersionSetChecksum: string;
  readonly providerNativeSemanticChecksum: string;
  readonly serializationProofChecksum: string;
}

export interface AgentSendLedgerEntryV2 {
  readonly schemaVersion: typeof AGENT_SEND_LEDGER_SCHEMA_VERSION;
  readonly entryId: string;
  readonly runId: string;
  readonly roundNumber: number;
  readonly roundKind: "first_send" | "subsequent_send";
  readonly providerSemanticVersionSetChecksum: string;
  readonly canonicalRoundManifestJson: string;
  readonly canonicalRoundManifestChecksum: string;
  readonly canonicalPayloadChecksum: string;
  readonly previewBinding: AgentSendLedgerPreviewBindingV2 | null;
  readonly additions: readonly AgentSendLedgerAdditionV2[];
  readonly providerNativeSemanticProof: ProviderNativeSemanticProofV2 | null;
  readonly sentAt: string;
  readonly entryChecksum: string;
}

export interface CreateAgentSendLedgerEntryV2Input {
  readonly entryId: string;
  readonly runId: string;
  readonly roundNumber: number;
  readonly roundKind: AgentSendLedgerEntryV2["roundKind"];
  readonly providerSemanticVersionSetChecksum: string;
  readonly canonicalRoundManifestJson: string;
  readonly canonicalRoundManifestChecksum: string;
  readonly canonicalPayloadChecksum: string;
  readonly previewBinding: AgentSendLedgerPreviewBindingV2 | null;
  readonly additions: readonly AgentSendLedgerAdditionV2[];
  readonly providerNativeSemanticProof: ProviderNativeSemanticProofV2 | null;
  readonly sentAt: string;
}

export interface AgentSendLedgerFileRepositoryOptions {
  readonly projectRoot: string;
  readonly traceId?: string;
  readonly atomicWriter?: typeof writeTextAtomically;
}

/** Immutable, append-only local audit storage for exact Provider round manifests. */
export class AgentSendLedgerFileRepository {
  private readonly traceId: string;
  private readonly pathGuard: ProjectPathGuard;
  private readonly atomicWriter: typeof writeTextAtomically;

  public constructor(private readonly options: AgentSendLedgerFileRepositoryOptions) {
    this.traceId = options.traceId ?? "trace_repository_agent_send_ledger";
    this.pathGuard = createProjectPathGuard(options.projectRoot);
    this.atomicWriter = options.atomicWriter ?? writeTextAtomically;
  }

  public appendEntry(
    runId: string,
    value: AgentSendLedgerEntryV2
  ): Promise<Result<AgentSendLedgerEntryV2, UnifiedError>> {
    let entry: AgentSendLedgerEntryV2;
    try {
      entry = parseAgentSendLedgerEntryV2(value);
    } catch {
      return Promise.resolve(this.invalid());
    }
    if (!isStorageId(runId) || entry.runId !== runId || entry.roundNumber > 999_999) {
      return Promise.resolve(this.invalid());
    }
    return withProjectFileLock(
      {
        lockPath: this.lockPath(),
        pathGuard: this.pathGuard,
        traceId: this.traceId
      },
      () => this.appendUnderLock(entry)
    );
  }

  public async readEntries(
    runId: string
  ): Promise<Result<readonly AgentSendLedgerEntryV2[], UnifiedError>> {
    if (!isStorageId(runId)) return this.invalid();
    return this.readEntriesInternal(runId);
  }

  public async readEntry(
    runId: string,
    roundNumber: number
  ): Promise<Result<AgentSendLedgerEntryV2 | undefined, UnifiedError>> {
    if (!isStorageId(runId) || !isRoundNumber(roundNumber) || roundNumber > 999_999) {
      return this.invalid();
    }
    const stored = await this.readStoredText(this.entryPath(runId, roundNumber));
    if (!stored.ok) return stored;
    if (stored.value === undefined) return ok(undefined);
    return this.parseStoredEntry(stored.value, runId, roundNumber);
  }

  private async appendUnderLock(
    entry: AgentSendLedgerEntryV2
  ): Promise<Result<AgentSendLedgerEntryV2, UnifiedError>> {
    const existingEntries = await this.readEntriesInternal(entry.runId);
    if (!existingEntries.ok) return existingEntries;
    const current = existingEntries.value[entry.roundNumber];
    if (current !== undefined) {
      return serializeAgentSendLedgerEntryV2(current) === serializeAgentSendLedgerEntryV2(entry)
        ? ok(current)
        : this.conflict();
    }
    if (entry.roundNumber !== existingEntries.value.length) return this.sequenceInvalid();
    const previous = existingEntries.value.at(-1);
    if (
      previous !== undefined &&
      (entry.providerSemanticVersionSetChecksum !== previous.providerSemanticVersionSetChecksum ||
        Date.parse(entry.sentAt) < Date.parse(previous.sentAt))
    ) {
      return this.sequenceInvalid();
    }

    const content = serializeAgentSendLedgerEntryV2(entry);
    const targetPath = this.entryPath(entry.runId, entry.roundNumber);
    let concurrentlyPersisted: AgentSendLedgerEntryV2 | undefined;
    const written = await this.atomicWriter({
      targetPath,
      content,
      traceId: this.traceId,
      pathGuard: this.pathGuard,
      beforeReplace: async () => {
        const latest = await this.readStoredText(targetPath);
        if (!latest.ok) return latest as Result<void, UnifiedError>;
        if (latest.value === undefined) return ok(undefined);
        const parsed = this.parseStoredEntry(latest.value, entry.runId, entry.roundNumber);
        if (!parsed.ok) return parsed as Result<void, UnifiedError>;
        if (latest.value === content) concurrentlyPersisted = parsed.value;
        return this.conflict();
      }
    });
    if (concurrentlyPersisted !== undefined) return ok(concurrentlyPersisted);
    return written.ok ? ok(entry) : written;
  }

  private async readEntriesInternal(
    runId: string
  ): Promise<Result<readonly AgentSendLedgerEntryV2[], UnifiedError>> {
    const directory = this.ledgerDirectory(runId);
    const pathCheck = await verifyProjectStoragePath(this.pathGuard, directory, this.traceId);
    if (!pathCheck.ok) return pathCheck;
    let names: string[];
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      if (entries.some((entry) => !entry.isFile() || !ROUND_FILE.test(entry.name))) {
        return this.corrupt();
      }
      names = entries.map((entry) => entry.name).sort();
    } catch (error) {
      if (isMissingFileError(error)) return ok(Object.freeze([]));
      return this.storageFailure("AGENT_SEND_LEDGER_READ_FAILED");
    }

    const result: AgentSendLedgerEntryV2[] = [];
    for (const [expectedRound, name] of names.entries()) {
      const match = ROUND_FILE.exec(name);
      const roundNumber = match === null ? Number.NaN : Number(match[1]);
      if (roundNumber !== expectedRound) return this.corrupt();
      const stored = await this.readStoredText(join(directory, name));
      if (!stored.ok) return stored as Result<readonly AgentSendLedgerEntryV2[], UnifiedError>;
      if (stored.value === undefined) return this.corrupt();
      const parsed = this.parseStoredEntry(stored.value, runId, roundNumber);
      if (!parsed.ok) return parsed as Result<readonly AgentSendLedgerEntryV2[], UnifiedError>;
      result.push(parsed.value);
    }
    if (!isValidLedgerSequence(result)) return this.corrupt();
    return ok(Object.freeze(result));
  }

  private async readStoredText(path: string): Promise<Result<string | undefined, UnifiedError>> {
    const pathCheck = await verifyProjectStoragePath(this.pathGuard, path, this.traceId);
    if (!pathCheck.ok) return pathCheck;
    try {
      return ok(await readFile(path, "utf8"));
    } catch (error) {
      if (isMissingFileError(error)) return ok(undefined);
      return this.storageFailure("AGENT_SEND_LEDGER_READ_FAILED");
    }
  }

  private parseStoredEntry(
    content: string,
    runId: string,
    roundNumber: number
  ): Result<AgentSendLedgerEntryV2, UnifiedError> {
    try {
      const entry = parseAgentSendLedgerEntryV2Json(content);
      if (entry.runId !== runId || entry.roundNumber !== roundNumber) return this.corrupt();
      return ok(entry);
    } catch {
      return this.corrupt();
    }
  }

  private ledgerDirectory(runId: string): string {
    return join(this.options.projectRoot, "history", "agent-runs", runId, "send-ledger");
  }

  private entryPath(runId: string, roundNumber: number): string {
    return join(this.ledgerDirectory(runId), `round-${String(roundNumber).padStart(6, "0")}.json`);
  }

  private lockPath(): string {
    return join(this.options.projectRoot, "history", "agent-runs", ".send-ledger.lock");
  }

  private invalid<T = never>(): Result<T, UnifiedError> {
    return err(ledgerError("AGENT_SEND_LEDGER_INVALID", "ValidationError", this.traceId));
  }

  private corrupt<T = never>(): Result<T, UnifiedError> {
    return err(ledgerError("AGENT_SEND_LEDGER_CORRUPT", "StorageError", this.traceId));
  }

  private conflict<T = never>(): Result<T, UnifiedError> {
    return err(ledgerError("AGENT_SEND_LEDGER_CONFLICT", "StorageError", this.traceId));
  }

  private sequenceInvalid<T = never>(): Result<T, UnifiedError> {
    return err(ledgerError("AGENT_SEND_LEDGER_SEQUENCE_INVALID", "StorageError", this.traceId));
  }

  private storageFailure<T = never>(code: string): Result<T, UnifiedError> {
    return err(ledgerError(code, "StorageError", this.traceId));
  }
}

export { AgentSendLedgerFileRepository as AgentSendLedgerRepository };

export function createAgentSendLedgerEntryV2(
  input: CreateAgentSendLedgerEntryV2Input
): AgentSendLedgerEntryV2 {
  const unsigned = parseUnsignedEntry({
    schemaVersion: AGENT_SEND_LEDGER_SCHEMA_VERSION,
    ...input
  });
  return parseAgentSendLedgerEntryV2({
    ...unsigned,
    entryChecksum: checksum(canonicalJson(unsigned))
  });
}

export function parseAgentSendLedgerEntryV2(value: unknown): AgentSendLedgerEntryV2 {
  if (
    !isRecord(value) ||
    !hasExactlyKeys(value, [
      "schemaVersion",
      "entryId",
      "runId",
      "roundNumber",
      "roundKind",
      "providerSemanticVersionSetChecksum",
      "canonicalRoundManifestJson",
      "canonicalRoundManifestChecksum",
      "canonicalPayloadChecksum",
      "previewBinding",
      "additions",
      "providerNativeSemanticProof",
      "sentAt",
      "entryChecksum"
    ])
  )
    invalidEntry();
  const { entryChecksum: rawEntryChecksum, ...rawUnsigned } = value;
  const unsigned = parseUnsignedEntry(rawUnsigned);
  const entryChecksum = parseChecksum(rawEntryChecksum);
  if (entryChecksum !== checksum(canonicalJson(unsigned))) invalidEntry();
  return deepFreeze({ ...unsigned, entryChecksum });
}

export function parseAgentSendLedgerEntryV2Json(value: string): AgentSendLedgerEntryV2 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    invalidEntry();
  }
  const entry = parseAgentSendLedgerEntryV2(parsed);
  if (serializeAgentSendLedgerEntryV2(entry) !== value) invalidEntry();
  return entry;
}

export function serializeAgentSendLedgerEntryV2(value: AgentSendLedgerEntryV2): string {
  return canonicalJson(parseAgentSendLedgerEntryV2(value));
}

function parseUnsignedEntry(value: unknown): Omit<AgentSendLedgerEntryV2, "entryChecksum"> {
  if (
    !isRecord(value) ||
    !hasExactlyKeys(value, [
      "schemaVersion",
      "entryId",
      "runId",
      "roundNumber",
      "roundKind",
      "providerSemanticVersionSetChecksum",
      "canonicalRoundManifestJson",
      "canonicalRoundManifestChecksum",
      "canonicalPayloadChecksum",
      "previewBinding",
      "additions",
      "providerNativeSemanticProof",
      "sentAt"
    ])
  )
    invalidEntry();
  if (value["schemaVersion"] !== AGENT_SEND_LEDGER_SCHEMA_VERSION) invalidEntry();
  const runId = parseStorageId(value["runId"]);
  const roundNumber = parseRoundNumber(value["roundNumber"]);
  const roundKind = parseEnum(value["roundKind"], ["first_send", "subsequent_send"] as const);
  const providerSemanticVersionSetChecksum = parseChecksum(
    value["providerSemanticVersionSetChecksum"]
  );
  const canonicalRoundManifestChecksum = parseChecksum(value["canonicalRoundManifestChecksum"]);
  const canonicalRoundManifestJson = parseText(value["canonicalRoundManifestJson"], false);
  const manifest = parseManifestJson(canonicalRoundManifestJson, canonicalRoundManifestChecksum);
  if (
    manifest.runId !== runId ||
    manifest.roundNumber !== roundNumber ||
    manifest.providerSemanticVersionSetChecksum !== providerSemanticVersionSetChecksum
  )
    invalidEntry();
  const canonicalPayloadChecksum = parseChecksum(value["canonicalPayloadChecksum"]);
  const previewBinding =
    value["previewBinding"] === null ? null : parsePreviewBinding(value["previewBinding"]);
  const additions = parseArray(value["additions"], parseAddition);
  const providerNativeSemanticProof =
    value["providerNativeSemanticProof"] === null
      ? null
      : parseProviderNativeProof(value["providerNativeSemanticProof"]);
  const sentAt = parseTimestamp(value["sentAt"]);

  if (
    (roundNumber === 0 && roundKind !== "first_send") ||
    (roundNumber > 0 && roundKind !== "subsequent_send") ||
    (roundKind === "first_send" && (previewBinding === null || additions.length !== 0)) ||
    (roundKind === "subsequent_send" && (previewBinding !== null || additions.length === 0)) ||
    (previewBinding !== null &&
      previewBinding.canonicalPayloadChecksum !== canonicalPayloadChecksum) ||
    (providerNativeSemanticProof !== null &&
      providerNativeSemanticProof.providerSemanticVersionSetChecksum !==
        providerSemanticVersionSetChecksum)
  )
    invalidEntry();
  assertUnique(additions.map((addition) => addition.additionId));
  assertStrictlyIncreasing(additions.map((addition) => addition.messageOrder));
  assertAdditionsMatchManifest(additions, manifest);

  return deepFreeze({
    schemaVersion: AGENT_SEND_LEDGER_SCHEMA_VERSION,
    entryId: parseMachineId(value["entryId"]),
    runId,
    roundNumber,
    roundKind,
    providerSemanticVersionSetChecksum,
    canonicalRoundManifestJson,
    canonicalRoundManifestChecksum,
    canonicalPayloadChecksum,
    previewBinding,
    additions,
    providerNativeSemanticProof,
    sentAt
  });
}

function parseManifestJson(value: string, expectedChecksum: string): CanonicalRoundManifestV2 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    invalidEntry();
  }
  let manifest: CanonicalRoundManifestV2;
  try {
    manifest = parseCanonicalRoundManifestV2(parsed, expectedChecksum);
  } catch {
    invalidEntry();
  }
  if (serializeCanonicalRoundManifestV2(manifest) !== value) invalidEntry();
  return manifest;
}

function parsePreviewBinding(value: unknown): AgentSendLedgerPreviewBindingV2 {
  if (
    !isRecord(value) ||
    !hasExactlyKeys(value, ["schemaVersion", "previewId", "canonicalPayloadChecksum"])
  )
    invalidEntry();
  if (value["schemaVersion"] !== AGENT_SEND_LEDGER_SCHEMA_VERSION) invalidEntry();
  return deepFreeze({
    schemaVersion: AGENT_SEND_LEDGER_SCHEMA_VERSION,
    previewId: parseMachineId(value["previewId"]),
    canonicalPayloadChecksum: parseChecksum(value["canonicalPayloadChecksum"])
  });
}

function parseProviderNativeProof(value: unknown): ProviderNativeSemanticProofV2 {
  if (
    !isRecord(value) ||
    !hasExactlyKeys(value, [
      "schemaVersion",
      "adapterPolicyRevision",
      "providerSemanticVersionSetChecksum",
      "providerNativeSemanticChecksum",
      "serializationProofChecksum"
    ])
  )
    invalidEntry();
  if (value["schemaVersion"] !== AGENT_SEND_LEDGER_SCHEMA_VERSION) invalidEntry();
  return deepFreeze({
    schemaVersion: AGENT_SEND_LEDGER_SCHEMA_VERSION,
    adapterPolicyRevision: parseMachineId(value["adapterPolicyRevision"]),
    providerSemanticVersionSetChecksum: parseChecksum(value["providerSemanticVersionSetChecksum"]),
    providerNativeSemanticChecksum: parseChecksum(value["providerNativeSemanticChecksum"]),
    serializationProofChecksum: parseChecksum(value["serializationProofChecksum"])
  });
}

function parseAddition(value: unknown): AgentSendLedgerAdditionV2 {
  if (!isRecord(value) || value["schemaVersion"] !== AGENT_SEND_LEDGER_SCHEMA_VERSION) {
    invalidEntry();
  }
  const base = {
    schemaVersion: AGENT_SEND_LEDGER_SCHEMA_VERSION,
    additionId: parseMachineId(value["additionId"]),
    messageOrder: parseRoundNumber(value["messageOrder"]),
    content: parseText(value["content"]),
    contentChecksum: parseChecksum(value["contentChecksum"])
  } as const;
  if (base.contentChecksum !== checksum(base.content)) invalidEntry();
  if (
    value["kind"] === "assistant" &&
    hasExactlyKeys(value, [
      "schemaVersion",
      "additionId",
      "messageOrder",
      "kind",
      "role",
      "content",
      "contentChecksum"
    ]) &&
    value["role"] === "assistant"
  ) {
    return deepFreeze({ ...base, kind: "assistant", role: "assistant" });
  }
  if (
    (value["kind"] === "tool_result" || value["kind"] === "remote_result") &&
    hasExactlyKeys(value, [
      "schemaVersion",
      "additionId",
      "messageOrder",
      "kind",
      "role",
      "sourceRefId",
      "toolCallId",
      "content",
      "contentChecksum"
    ]) &&
    value["role"] === "tool"
  ) {
    return deepFreeze({
      ...base,
      kind: value["kind"],
      role: "tool",
      sourceRefId: parseMachineId(value["sourceRefId"]),
      toolCallId: parseMachineId(value["toolCallId"])
    });
  }
  if (
    value["kind"] === "user_control" &&
    hasExactlyKeys(value, [
      "schemaVersion",
      "additionId",
      "messageOrder",
      "kind",
      "role",
      "content",
      "contentChecksum"
    ]) &&
    value["role"] === "user"
  ) {
    return deepFreeze({ ...base, kind: "user_control", role: "user" });
  }
  if (
    (value["kind"] === "jit_context" ||
      value["kind"] === "context_refresh" ||
      value["kind"] === "recovery") &&
    hasExactlyKeys(value, [
      "schemaVersion",
      "additionId",
      "messageOrder",
      "kind",
      "role",
      "sourceRefId",
      "content",
      "contentChecksum"
    ]) &&
    value["role"] === "user"
  ) {
    return deepFreeze({
      ...base,
      kind: value["kind"],
      role: "user",
      sourceRefId: parseMachineId(value["sourceRefId"])
    });
  }
  invalidEntry();
}

function assertAdditionsMatchManifest(
  additions: readonly AgentSendLedgerAdditionV2[],
  manifest: CanonicalRoundManifestV2
): void {
  for (const addition of additions) {
    const message = manifest.messages[addition.messageOrder];
    if (
      message === undefined ||
      message.role !== addition.role ||
      message.content !== addition.content ||
      message.contentChecksum !== addition.contentChecksum ||
      message.kind !== manifestKindForAddition(addition.kind)
    )
      invalidEntry();
    if (
      ("sourceRefId" in addition && message.sourceRefId !== addition.sourceRefId) ||
      ("toolCallId" in addition && message.toolCallId !== addition.toolCallId)
    )
      invalidEntry();
  }
}

function manifestKindForAddition(kind: AgentSendLedgerAdditionKindV2): CanonicalRoundMessageKindV2 {
  if (kind === "jit_context" || kind === "context_refresh") return "context_notice";
  return kind;
}

function isValidLedgerSequence(entries: readonly AgentSendLedgerEntryV2[]): boolean {
  if (entries.length === 0) return true;
  const providerSetChecksum = entries[0]?.providerSemanticVersionSetChecksum;
  let priorSentAt = Number.NEGATIVE_INFINITY;
  return entries.every((entry, index) => {
    const sentAt = Date.parse(entry.sentAt);
    const valid =
      entry.roundNumber === index &&
      entry.providerSemanticVersionSetChecksum === providerSetChecksum &&
      sentAt >= priorSentAt;
    priorSentAt = sentAt;
    return valid;
  });
}

function parseTimestamp(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) invalidEntry();
  if (new Date(Date.parse(value)).toISOString() !== value) invalidEntry();
  return value;
}

function parseText(value: unknown, allowEmpty = true): string {
  if (
    typeof value !== "string" ||
    value.length > MAX_TEXT_LENGTH ||
    (!allowEmpty && value.length === 0) ||
    hasUnpairedSurrogate(value)
  )
    invalidEntry();
  return value;
}

function parseMachineId(value: unknown): string {
  if (typeof value !== "string" || !isMachineId(value)) invalidEntry();
  return value;
}

function isMachineId(value: string): boolean {
  return MACHINE_ID.test(value);
}

function parseStorageId(value: unknown): string {
  if (typeof value !== "string" || !isStorageId(value)) invalidEntry();
  return value;
}

function isStorageId(value: string): boolean {
  return STORAGE_ID.test(value);
}

function parseChecksum(value: unknown): string {
  if (typeof value !== "string" || !CHECKSUM.test(value)) invalidEntry();
  return value;
}

function parseRoundNumber(value: unknown): number {
  if (!isRoundNumber(value)) invalidEntry();
  return value;
}

function isRoundNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseArray<T>(value: unknown, parser: (child: unknown) => T): readonly T[] {
  if (!Array.isArray(value)) invalidEntry();
  return Object.freeze(value.map(parser));
}

function parseEnum<const T extends readonly string[]>(value: unknown, allowed: T): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) invalidEntry();
  return value as T[number];
}

function assertUnique(values: readonly string[]): void {
  if (new Set(values).size !== values.length) invalidEntry();
}

function assertStrictlyIncreasing(values: readonly number[]): void {
  if (values.some((value, index) => index > 0 && value <= (values[index - 1] ?? -1))) {
    invalidEntry();
  }
}

function canonicalJson(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null) return "null";
  if (typeof value === "string") {
    if (hasUnpairedSurrogate(value)) invalidEntry();
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalidEntry();
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) invalidEntry();
    seen.add(value);
    const result = `[${value
      .map((child, index) => {
        if (!Object.hasOwn(value, index)) invalidEntry();
        return canonicalJson(child, seen);
      })
      .join(",")}]`;
    seen.delete(value);
    return result;
  }
  if (!isRecord(value) || seen.has(value)) invalidEntry();
  seen.add(value);
  const result = `{${Object.keys(value)
    .sort()
    .map((key) => {
      if (hasUnpairedSurrogate(key)) invalidEntry();
      return `${JSON.stringify(key)}:${canonicalJson(value[key], seen)}`;
    })
    .join(",")}}`;
  seen.delete(value);
  return result;
}

function hasExactlyKeys(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const expected = [...fields].sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function checksum(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function invalidEntry(): never {
  throw new Error("AGENT_SEND_LEDGER_INVALID");
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "ENOENT"
  );
}

function ledgerError(code: string, category: "ValidationError" | "StorageError", traceId: string) {
  return createUnifiedError({
    code,
    category,
    message: "The immutable agent send ledger is invalid or unavailable.",
    recoverability: "user-action",
    suggestedAction: "Stop the Run and inspect or regenerate its send audit records.",
    traceId
  });
}
