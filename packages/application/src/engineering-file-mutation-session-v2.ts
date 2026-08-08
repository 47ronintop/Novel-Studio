import { createHash } from "node:crypto";

import type {
  ApprovalDecisionProofEvidenceV1,
  ChangeSetApprovalV2,
  ChangeSetOperation,
  ChangeSetRange,
  ChangeSetV2,
  MainOnlyApprovalDecisionProofV1
} from "@novel-studio/agent-engine";
import {
  createUnifiedError,
  err,
  ok,
  type JsonObject,
  type Result,
  type UnifiedError
} from "@novel-studio/shared";

import type { AgentRunCapabilityBoundary } from "./agent-run-session.js";
import type { EngineeringApprovalBindingFactsV2 } from "./engineering-file-approval-v2.js";

export const ENGINEERING_FILE_MUTATION_SESSION_V2_SCHEMA_VERSION = "2.0" as const;

export type EngineeringFileMutationToolNameV2 = "propose_file_write" | "propose_file_create";
export type EngineeringFileMutationOperationKindV2 = "replace_file" | "create_file";

export interface EngineeringFileMutationProposalBoundaryV2 {
  readonly workspaceBindingId: string;
  readonly providerSemanticVersionSetChecksum: string;
  readonly policyRevision: string;
  readonly capabilityRevision: string;
  readonly approvalRuleSetVersion: string;
  readonly approvalRuleSetChecksum: string;
}

/**
 * Main-only raw proposal facts that must be frozen into the shared approval proof before that
 * proof is persisted. These values come from the durable Engineering V2 proposal record; they
 * must never be reconstructed from Change Set JS strings or supplied by Renderer/Provider.
 */
export interface EngineeringApprovalProofInputV2 {
  readonly schemaVersion: typeof ENGINEERING_FILE_MUTATION_SESSION_V2_SCHEMA_VERSION;
  readonly operationKind: EngineeringFileMutationOperationKindV2;
  readonly rootBindingId: string;
  readonly selectionChecksum: string;
  readonly proposalPayloadChecksum: string;
  readonly baseManifestChecksum: string;
  readonly candidateManifestChecksum: string;
  readonly evidence: ApprovalDecisionProofEvidenceV1;
}

export type EngineeringPreparedChangeSetMutationV2 =
  | Readonly<{
      readonly kind: "replace_file";
      readonly path: string;
      readonly range: ChangeSetRange;
      readonly baseHash: string;
      readonly replacement: string;
    }>
  | Readonly<{
      readonly kind: "create_file";
      readonly operation: ChangeSetOperation;
    }>;

/** Main-only preparation result. It must never be copied into a Provider/Renderer event. */
export interface EngineeringPreparedFileMutationProposalV2 {
  readonly schemaVersion: typeof ENGINEERING_FILE_MUTATION_SESSION_V2_SCHEMA_VERSION;
  readonly proposalId: string;
  readonly toolCallId: string;
  readonly canonicalPayloadChecksum: string;
  readonly operationKind: EngineeringFileMutationOperationKindV2;
  readonly relativeIdentity: string;
  readonly changeSetMutation: EngineeringPreparedChangeSetMutationV2;
}

export interface EngineeringFileMutationSessionV2 {
  /**
   * Resolves an opaque app-owned ref and performs the fresh native/raw-byte preflight. The port
   * owns durable same-toolCallId idempotency in addition to AgentRunSession's replay guard.
   */
  prepare(input: {
    readonly runId: string;
    readonly projectId: string;
    readonly toolCallId: string;
    readonly toolName: EngineeringFileMutationToolNameV2;
    readonly arguments: JsonObject;
    readonly canonicalPayloadChecksum: string;
    readonly writePolicy: "write_before_confirmation" | "user_preapproved_run";
    readonly boundary: EngineeringFileMutationProposalBoundaryV2;
  }): Promise<Result<EngineeringPreparedFileMutationProposalV2, UnifiedError>>;

  /** Binds the Main-only raw proposal record to the exact persisted Change Set 2.0 revision. */
  bindChangeSet(input: {
    readonly prepared: EngineeringPreparedFileMutationProposalV2;
    readonly changeSet: ChangeSetV2;
  }): Promise<Result<void, UnifiedError>>;

  /**
   * Reads the bound durable raw proposal before proof creation. The returned checksums and root
   * identity are the exact values embedded in the shared Main-only approval proof.
   */
  prepareApprovalProofInput(input: {
    readonly changeSet: ChangeSetV2;
    readonly boundary: AgentRunCapabilityBoundary;
    readonly workspaceBindingId: string;
    readonly approvalRuleSet: {
      readonly version: string;
      readonly checksum: string;
      readonly catalogRevision: string;
    };
  }): Promise<Result<EngineeringApprovalProofInputV2, UnifiedError>>;

  /**
   * Re-reads/finalizes approval facts from the same durable raw proposal after the exact proof has
   * been persisted. Implementations must reject any proposal/root/revision drift between phases.
   */
  finalizeApprovalFacts(input: {
    readonly changeSet: ChangeSetV2;
    readonly proof: MainOnlyApprovalDecisionProofV1;
    readonly proofInput: EngineeringApprovalProofInputV2;
    readonly boundary: AgentRunCapabilityBoundary;
    readonly workspaceBindingId: string;
    readonly approvalRuleSet: {
      readonly version: string;
      readonly checksum: string;
      readonly catalogRevision: string;
    };
  }): Promise<Result<EngineeringApprovalBindingFactsV2, UnifiedError>>;

  /**
   * The only Engineering apply path; implementations must use Engineering V2 Journal authority.
   * If disk commit succeeds but proposal/ledger finalization fails, return an error with
   * `redactedDetail.diskCommitted === true` and `redactedDetail.recoveryRequired === true` so
   * callers retain the committed fact while startup recovery blocks the unresolved WAL state.
   */
  apply(input: {
    readonly changeSet: ChangeSetV2;
    readonly approval: ChangeSetApprovalV2;
  }): Promise<Result<JsonObject, UnifiedError>>;

  reject?(input: { readonly changeSet: ChangeSetV2 }): Promise<Result<void, UnifiedError>>;
  undoRun?(input: {
    readonly runId: string;
    readonly projectId: string;
    readonly commandId: string;
    readonly action: "request" | "resolve";
    readonly reviewId?: string;
    readonly decisions?: readonly {
      readonly relativePath: string;
      readonly decision: "keep_current" | "restore_baseline";
    }[];
    readonly retryFailedOnly?: true;
  }): Promise<Result<JsonObject, UnifiedError>>;
  recoverRun?(input: { readonly runId: string; readonly projectId: string }): Promise<
    Result<
      | { readonly status: "none" }
      | {
          readonly status: "applied" | "rolled_back" | "partial_failure";
          readonly versionGroup: JsonObject;
        },
      UnifiedError
    >
  >;
}

/** Strict canonical digest used for same-toolCallId idempotency and durable proposal lookup. */
export function checksumEngineeringFileMutationToolPayloadV2(input: {
  readonly toolName: EngineeringFileMutationToolNameV2;
  readonly arguments: JsonObject;
}): Result<string, UnifiedError> {
  const normalized = normalizePayload(input.toolName, input.arguments);
  if (normalized === undefined) return invalidPayload();
  return ok(
    createHash("sha256")
      .update(canonicalJson({ toolName: input.toolName, arguments: normalized }), "utf8")
      .digest("hex")
  );
}

export function isEngineeringFileMutationToolNameV2(
  value: string
): value is EngineeringFileMutationToolNameV2 {
  return value === "propose_file_write" || value === "propose_file_create";
}

export function engineeringToolCallPayloadConflictV2(): UnifiedError {
  return createUnifiedError({
    code: "ENGINEERING_TOOL_CALL_ID_PAYLOAD_CONFLICT",
    category: "ValidationError",
    message: "The Engineering tool call ID was already bound to a different canonical payload.",
    recoverability: "user-action",
    suggestedAction: "Issue a new tool call ID for the changed Engineering proposal.",
    traceId: "engineering-file-mutation-session-v2"
  });
}

function normalizePayload(
  toolName: EngineeringFileMutationToolNameV2,
  value: JsonObject
): JsonObject | undefined {
  if (toolName === "propose_file_write") {
    if (!hasExactKeys(value, ["fileRef", "range", "replacement"])) return undefined;
    const range = value["range"];
    if (
      !isRecord(range) ||
      !hasExactKeys(range, ["unit", "start", "end"]) ||
      range["unit"] !== "character" ||
      !isBoundedOffset(range["start"]) ||
      !isBoundedOffset(range["end"]) ||
      range["start"] > range["end"] ||
      !isOpaqueRef(value["fileRef"], "file") ||
      typeof value["replacement"] !== "string" ||
      value["replacement"].length > 1_000_000
    ) {
      return undefined;
    }
    return {
      fileRef: value["fileRef"],
      range: { unit: "character", start: range["start"], end: range["end"] },
      replacement: value["replacement"]
    };
  }

  if (!hasExactKeys(value, ["parentRef", "name", "candidate"])) return undefined;
  if (
    !isOpaqueRef(value["parentRef"], "directory") ||
    !isCanonicalLeafName(value["name"]) ||
    typeof value["candidate"] !== "string" ||
    value["candidate"].length > 1_000_000
  ) {
    return undefined;
  }
  return {
    parentRef: value["parentRef"],
    name: value["name"],
    candidate: value["candidate"]
  };
}

function isCanonicalLeafName(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 255 ||
    value.normalize("NFC") !== value ||
    value === "." ||
    value === ".." ||
    /[\\/:*?"<>|]/u.test(value) ||
    value.split("").some((character) => character.charCodeAt(0) <= 0x1f) ||
    /[ .]$/u.test(value)
  ) {
    return false;
  }
  const stem = value.split(".", 1)[0]?.toUpperCase();
  return stem !== undefined && !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/u.test(stem);
}

function isOpaqueRef(value: unknown, kind: "file" | "directory"): value is string {
  return (
    typeof value === "string" &&
    new RegExp(`^engineering_${kind}_ref:[A-Za-z0-9_-]{22,128}$`, "u").test(value)
  );
}

function isBoundedOffset(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 1_000_000;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("ENGINEERING_MUTATION_CANONICAL_JSON_INVALID");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw new Error("ENGINEERING_MUTATION_CANONICAL_JSON_INVALID");
}

function hasExactKeys(
  value: unknown,
  expected: readonly string[]
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  const expectedKeys = [...expected].sort();
  return (
    keys.length === expectedKeys.length && keys.every((key, index) => key === expectedKeys[index])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidPayload(): Result<never, UnifiedError> {
  return err(
    createUnifiedError({
      code: "ENGINEERING_FILE_MUTATION_V2_ARGUMENTS_INVALID",
      category: "ValidationError",
      message: "The Engineering replace/create payload is invalid.",
      recoverability: "user-action",
      suggestedAction: "Use the current effect-specific tool schema and app-owned opaque refs.",
      traceId: "engineering-file-mutation-session-v2"
    })
  );
}
