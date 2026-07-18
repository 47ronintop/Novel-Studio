import {
  createUnifiedError,
  err,
  ok,
  type JsonObject,
  type JsonValue,
  type Result,
  type UnifiedError
} from "@novel-studio/shared";

import type { AgentRunRecoveryState } from "./agent-run-types.js";

export const AGENT_RUN_ERROR_DETAIL_MAX_BYTES = 8 * 1024;

export type AgentRunRetryTargetKind =
  "model_round" | "tool_call" | "checkpoint" | "plan_step";

export interface AgentRunRetryTarget {
  readonly kind: AgentRunRetryTargetKind;
  readonly id: string;
}

export interface RetryRunTargetCommand {
  readonly runId: string;
  readonly projectId: string;
  readonly commandId: string;
  readonly expectedRunRevision: number;
  readonly errorId: string;
  readonly target: AgentRunRetryTarget;
}

export interface AgentRunErrorRecord {
  readonly schemaVersion: "1.0";
  readonly errorId: string;
  readonly projectId: string;
  readonly runId?: string;
  readonly runDraftId?: string;
  readonly sequence?: number;
  readonly checkpointId?: string;
  readonly toolCallId?: string;
  readonly planStepId?: string;
  readonly category: string;
  readonly code: string;
  readonly message: string;
  readonly recoverability: UnifiedError["recoverability"];
  readonly suggestedActions: readonly string[];
  readonly provider?: string;
  readonly model?: string;
  readonly redactedDetail: JsonObject;
  readonly recoveryState: AgentRunRecoveryState;
  readonly retryTargets: readonly AgentRunRetryTarget[];
  readonly createdAt: string;
}

export type CreateAgentRunErrorRecordInput = Omit<AgentRunErrorRecord, "schemaVersion" | "redactedDetail"> & {
  readonly redactedDetail?: JsonObject;
};

const RECOVERABILITY = new Set<UnifiedError["recoverability"]>([
  "retryable",
  "user-action",
  "fatal",
  "unknown"
]);
const RECOVERY_STATES = new Set<AgentRunRecoveryState>([
  "none",
  "retryable",
  "awaiting_context_refresh",
  "recovery_review",
  "terminal"
]);
const RETRY_TARGET_KINDS = new Set<AgentRunRetryTargetKind>([
  "model_round",
  "tool_call",
  "checkpoint",
  "plan_step"
]);
const SENSITIVE_DETAIL_KEY =
  /^(?:stack|stacktrace|api[_-]?key|authorization|proxy-authorization|cookie|set-cookie|password|passphrase|secret|client[_-]?secret|access[_-]?token|refresh[_-]?token)$/i;
const ERROR_RECORD_KEYS = new Set([
  "schemaVersion",
  "errorId",
  "projectId",
  "runId",
  "runDraftId",
  "sequence",
  "checkpointId",
  "toolCallId",
  "planStepId",
  "category",
  "code",
  "message",
  "recoverability",
  "suggestedActions",
  "provider",
  "model",
  "redactedDetail",
  "recoveryState",
  "retryTargets",
  "createdAt"
]);

export function createAgentRunErrorRecord(
  input: CreateAgentRunErrorRecordInput
): Result<AgentRunErrorRecord, UnifiedError> {
  if (!hasExactlyOneScope(input)) {
    return err(error("AGENT_RUN_ERROR_SCOPE_INVALID", "An Agent error must belong to one run or one run draft."));
  }
  const record: AgentRunErrorRecord = {
    schemaVersion: "1.0",
    errorId: input.errorId,
    projectId: input.projectId,
    ...(input.runId === undefined ? {} : { runId: input.runId }),
    ...(input.runDraftId === undefined ? {} : { runDraftId: input.runDraftId }),
    ...(input.sequence === undefined ? {} : { sequence: input.sequence }),
    ...(input.checkpointId === undefined ? {} : { checkpointId: input.checkpointId }),
    ...(input.toolCallId === undefined ? {} : { toolCallId: input.toolCallId }),
    ...(input.planStepId === undefined ? {} : { planStepId: input.planStepId }),
    category: input.category,
    code: input.code,
    message: input.message,
    recoverability: input.recoverability,
    suggestedActions: [...input.suggestedActions],
    ...(input.provider === undefined ? {} : { provider: input.provider }),
    ...(input.model === undefined ? {} : { model: input.model }),
    redactedDetail: limitRedactedDetail(
      normalizeDetail(input.code, sanitizeDetail(input.redactedDetail ?? {}))
    ),
    recoveryState: input.recoveryState,
    retryTargets: input.retryTargets.map((target) => ({ ...target })),
    createdAt: input.createdAt
  };
  return validateRecord(record, "AGENT_RUN_ERROR_RECORD_INVALID");
}

export function validateAgentRunErrorRecord(
  value: unknown
): Result<AgentRunErrorRecord, UnifiedError> {
  return validateRecord(value, "AGENT_RUN_ERROR_RECORD_INVALID");
}

export function resolveLegacyRetryTarget(
  record: AgentRunErrorRecord
): Result<AgentRunRetryTarget, UnifiedError> {
  const [target] = record.retryTargets;
  if (record.retryTargets.length === 1 && target !== undefined) return ok(target);
  return err(
    error(
      record.retryTargets.length === 0
        ? "AGENT_RETRY_TARGET_NOT_AVAILABLE"
        : "AGENT_RETRY_TARGET_AMBIGUOUS",
      record.retryTargets.length === 0
        ? "The active error has no retry target."
        : "The active error has more than one retry target.",
      "Please refresh the Agent run and choose an explicit retry target."
    )
  );
}

function validateRecord(
  value: unknown,
  code: string
): Result<AgentRunErrorRecord, UnifiedError> {
  if (!isObject(value)) return err(error(code, "The Agent error record is invalid."));
  const record = value as unknown as AgentRunErrorRecord;
  const identifiers = [record.errorId, record.projectId, record.runId, record.runDraftId]
    .filter((candidate): candidate is string => candidate !== undefined);
  if (
    record.schemaVersion !== "1.0" ||
    Object.keys(value).some((key) => !ERROR_RECORD_KEYS.has(key)) ||
    !hasExactlyOneScope(record) ||
    identifiers.some((candidate) => !isNonEmptyString(candidate)) ||
    !isNonEmptyString(record.category) ||
    !isNonEmptyString(record.code) ||
    !isNonEmptyString(record.message) ||
    !RECOVERABILITY.has(record.recoverability) ||
    !RECOVERY_STATES.has(record.recoveryState) ||
    !isNonEmptyString(record.createdAt) ||
    !Array.isArray(record.suggestedActions) ||
    !record.suggestedActions.every(isNonEmptyString) ||
    !Array.isArray(record.retryTargets) ||
    !record.retryTargets.every(isRetryTarget) ||
    new Set(record.retryTargets.map(retryTargetKey)).size !== record.retryTargets.length ||
    !isObject(record.redactedDetail) ||
    JSON.stringify(normalizeDetail(record.code, sanitizeDetail(record.redactedDetail))) !==
      JSON.stringify(record.redactedDetail) ||
    utf8Bytes(JSON.stringify(record.redactedDetail)) > AGENT_RUN_ERROR_DETAIL_MAX_BYTES ||
    (record.sequence !== undefined && (!Number.isSafeInteger(record.sequence) || record.sequence < 0)) ||
    optionalStrings(record).some((candidate) => !isNonEmptyString(candidate))
  ) {
    return err(error(code, "The Agent error record is invalid."));
  }
  return ok(record);
}

function hasExactlyOneScope(value: { readonly runId?: unknown; readonly runDraftId?: unknown }): boolean {
  return (value.runId === undefined) !== (value.runDraftId === undefined);
}

function optionalStrings(record: AgentRunErrorRecord): string[] {
  return [
    record.checkpointId,
    record.toolCallId,
    record.planStepId,
    record.provider,
    record.model
  ].filter((candidate): candidate is string => candidate !== undefined);
}

function isRetryTarget(value: unknown): value is AgentRunRetryTarget {
  return (
    isObject(value) &&
    Object.keys(value).length === 2 &&
    Object.keys(value).every((key) => key === "kind" || key === "id") &&
    RETRY_TARGET_KINDS.has(value["kind"] as AgentRunRetryTargetKind) &&
    isNonEmptyString(value["id"]) &&
    value["id"].length <= 512
  );
}

function retryTargetKey(target: AgentRunRetryTarget): string {
  return `${target.kind}:${target.id}`;
}

function sanitizeDetail(detail: JsonObject): JsonObject {
  return sanitizeObject(detail, 0);
}

function normalizeDetail(code: string, detail: JsonObject): JsonObject {
  if (code !== "AGENT_WRITE_PARTIAL_FAILURE") return detail;
  const recoveryJournal = isObject(detail["recoveryJournal"])
    ? detail["recoveryJournal"]
    : undefined;
  const versionGroupId = recoveryJournal?.["versionGroupId"];
  return {
    recoveryJournal: {
      versionGroupId: isNonEmptyString(versionGroupId) ? versionGroupId : "version_group_unknown"
    }
  };
}

function sanitizeObject(value: JsonObject, depth: number): JsonObject {
  if (depth >= 12) return { truncated: true, reason: "maximum_depth" };
  const sanitized: JsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_DETAIL_KEY.test(key)) continue;
    const next = sanitizeValue(item, depth + 1);
    if (next !== undefined) sanitized[key] = next;
  }
  return sanitized;
}

function sanitizeValue(value: unknown, depth: number): JsonValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (Array.isArray(value)) {
    if (depth >= 12) return [{ truncated: true, reason: "maximum_depth" }];
    return value.flatMap((item) => {
      const sanitized = sanitizeValue(item, depth + 1);
      return sanitized === undefined ? [] : [sanitized];
    });
  }
  if (isObject(value)) return sanitizeObject(value, depth);
  return undefined;
}

function limitRedactedDetail(detail: JsonObject): JsonObject {
  const serialized = JSON.stringify(detail);
  const originalBytes = utf8Bytes(serialized);
  if (originalBytes <= AGENT_RUN_ERROR_DETAIL_MAX_BYTES) return detail;

  const fields: JsonObject[] = [];
  let omittedFields = 0;
  for (const [field, value] of Object.entries(detail)) {
    const summary: JsonObject = {
      field: field.slice(0, 128),
      type: Array.isArray(value) ? "array" : value === null ? "null" : typeof value,
      bytes: utf8Bytes(JSON.stringify(value))
    };
    const candidate = { truncated: true, originalBytes, fields: [...fields, summary], omittedFields };
    if (utf8Bytes(JSON.stringify(candidate)) > AGENT_RUN_ERROR_DETAIL_MAX_BYTES) {
      omittedFields += 1;
    } else {
      fields.push(summary);
    }
  }
  return { truncated: true, originalBytes, fields, omittedFields };
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function error(code: string, message: string, suggestedAction = "Refresh the Agent run and retry."): UnifiedError {
  return createUnifiedError({
    code,
    category: "AgentError",
    message,
    recoverability: "user-action",
    suggestedAction,
    traceId: "agent-run-error"
  });
}
