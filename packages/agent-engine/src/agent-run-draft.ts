import { createHash } from "node:crypto";

import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import type {
  AgentContextMode,
  AgentOperationMode,
  AgentReasoningEffort,
  AgentWritePolicy
} from "./agent-run-types.js";
import {
  isAgentContextScope,
  normalizeAgentContextScope,
  type AgentContextScope
} from "./agent-context-scope.js";
import type { AgentWorkspaceKind } from "./agent-tool-capabilities.js";

export interface AgentRunDraftV10 {
  readonly schemaVersion: "1.0";
  readonly runDraftId: string;
  readonly projectId: string;
  readonly conversationId: string;
  readonly revision: number;
  readonly checksum: string;
  readonly userRequest: string;
  readonly operationMode: AgentOperationMode;
  readonly contextMode: AgentContextMode;
  readonly writePolicy: AgentWritePolicy;
  readonly writePolicyAcknowledged: boolean;
  readonly modelProfileId: string;
  /** Optional model id selected from the profile's provider connection. */
  readonly modelName?: string;
  readonly reasoningEffort?: AgentReasoningEffort;
  readonly contextDraftId: string;
  readonly contextDraftRevision: number;
  readonly contextDraftChecksum: string;
  readonly contextBudgetSnapshotId: string | null;
  readonly updatedAt: string;
}

export interface AgentRunDraftV11 extends Omit<
  AgentRunDraftV10,
  "schemaVersion" | "projectId" | "operationMode" | "contextMode"
> {
  readonly schemaVersion: "1.1";
  readonly scope: AgentContextScope;
  readonly operationMode: AgentOperationMode;
  readonly contextMode: AgentContextMode;
}

export type AgentRunDraft = AgentRunDraftV11;

/**
 * Guidance 3.0's app-owned choice for a future Plan-to-Act handoff. This is deliberately separate
 * from `writePolicy`: while a draft is planning, the latter is always normalized to the read-only
 * planning policy and the former is never sent to a Provider or treated as authorization.
 */
export type ExecutionWritePolicyDraft = AgentWritePolicy;

export const AGENT_RUN_DRAFT_SCHEMA_VERSION_V20 = "2.0" as const;

/** The strict 2.0 draft shape. Legacy 1.0/1.1 drafts remain readable by the existing normalizer. */
export interface AgentRunDraftV20 extends Omit<AgentRunDraftV11, "schemaVersion"> {
  readonly schemaVersion: typeof AGENT_RUN_DRAFT_SCHEMA_VERSION_V20;
  readonly executionWritePolicyDraft: ExecutionWritePolicyDraft;
}

export type CreateAgentRunDraftV20Input = Omit<
  AgentRunDraftV20,
  "schemaVersion" | "revision" | "checksum"
>;

export type AgentRunDraftV20Mutation =
  | {
      readonly kind: "set_execution_write_policy_draft";
      readonly policy: ExecutionWritePolicyDraft;
    }
  | AgentRunDraftMutation;

export type AgentRunDraftMutation =
  | { readonly kind: "set_request"; readonly request: string }
  | { readonly kind: "set_operation_mode"; readonly operationMode: AgentOperationMode }
  | { readonly kind: "set_context_mode"; readonly contextMode: AgentContextMode }
  | {
      readonly kind: "set_write_policy";
      readonly writePolicy: AgentWritePolicy;
      readonly acknowledged: boolean;
    }
  | {
      readonly kind: "set_model";
      readonly modelProfileId: string;
      readonly modelName?: string;
      readonly reasoningEffort?: AgentReasoningEffort;
    }
  | { readonly kind: "set_reasoning"; readonly reasoningEffort: AgentReasoningEffort };

export type CreateAgentRunDraftInput = Omit<
  AgentRunDraft,
  "schemaVersion" | "revision" | "checksum"
>;

export function createAgentRunDraft(input: CreateAgentRunDraftInput): AgentRunDraft {
  return finalizeAgentRunDraft({ schemaVersion: "1.1", ...normalizePolicy(input), revision: 1 });
}

/**
 * Create a strict 2.0 app-owned draft. A planning draft never carries execution authorization: the
 * current write policy is normalized to `write_before_confirmation`, while the future policy draft
 * is retained as a UI/handoff choice only.
 */
export function createAgentRunDraftV20(input: CreateAgentRunDraftV20Input): AgentRunDraftV20 {
  const policyDraft = parseExecutionWritePolicyDraft(input.executionWritePolicyDraft);
  const normalized: Omit<AgentRunDraftV20, "checksum"> = {
    schemaVersion: AGENT_RUN_DRAFT_SCHEMA_VERSION_V20,
    ...input,
    // ADR-0004's surface is not qualified. Current authority is always manual; only the separate
    // future policy draft may remember the non-authorizing product choice.
    writePolicy: "write_before_confirmation",
    writePolicyAcknowledged: false,
    executionWritePolicyDraft: policyDraft,
    revision: 1
  };
  return finalizeAgentRunDraftV20(normalized);
}

/**
 * Validate an execution policy draft without changing the current run policy. This function is
 * intentionally strict because it is used at the Plan Composer/handoff boundary.
 */
export function validateExecutionWritePolicyDraft(
  value: unknown
): Result<ExecutionWritePolicyDraft, UnifiedError> {
  if (value === "write_before_confirmation" || value === "user_preapproved_run") {
    return ok(value);
  }
  return err(
    agentRunDraftError(
      "AGENT_RUN_DRAFT_EXECUTION_POLICY_DRAFT_INVALID",
      "The execution write policy draft is unsupported."
    )
  );
}

export function parseExecutionWritePolicyDraft(value: unknown): ExecutionWritePolicyDraft {
  const result = validateExecutionWritePolicyDraft(value);
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

/** Parse and verify a strict 2.0 draft. Unknown fields and stale checksums fail closed. */
export function parseAgentRunDraftV20(value: unknown): AgentRunDraftV20 {
  const result = validateAgentRunDraftV20(value);
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

export function validateAgentRunDraftV20(value: unknown): Result<AgentRunDraftV20, UnifiedError> {
  if (!isRecord(value)) return invalidAgentRunDraftV20("AGENT_RUN_DRAFT_V20_INVALID");
  const keys = Object.keys(value);
  const required = [
    "schemaVersion",
    "runDraftId",
    "scope",
    "conversationId",
    "revision",
    "checksum",
    "userRequest",
    "operationMode",
    "contextMode",
    "writePolicy",
    "writePolicyAcknowledged",
    "executionWritePolicyDraft",
    "modelProfileId",
    "contextDraftId",
    "contextDraftRevision",
    "contextDraftChecksum",
    "contextBudgetSnapshotId",
    "updatedAt"
  ];
  const optional = ["modelName", "reasoningEffort"];
  const allowed = new Set([...required, ...optional]);
  if (keys.some((key) => !allowed.has(key))) {
    return invalidAgentRunDraftV20("AGENT_RUN_DRAFT_V20_UNKNOWN_FIELD");
  }
  if (required.some((key) => !(key in value))) {
    return invalidAgentRunDraftV20("AGENT_RUN_DRAFT_V20_REQUIRED");
  }
  if (value["schemaVersion"] !== AGENT_RUN_DRAFT_SCHEMA_VERSION_V20) {
    return invalidAgentRunDraftV20("AGENT_RUN_DRAFT_VERSION_UNSUPPORTED");
  }
  if (
    !isNonEmptyString(value["runDraftId"]) ||
    !isNonEmptyString(value["conversationId"]) ||
    (!isNonEmptyString(value["userRequest"]) && value["userRequest"] !== "") ||
    !isNonEmptyString(value["modelProfileId"]) ||
    !isNonEmptyString(value["contextDraftId"]) ||
    !isNonEmptyString(value["contextDraftChecksum"]) ||
    !isNonEmptyString(value["updatedAt"]) ||
    !isAgentOperationMode(value["operationMode"]) ||
    !isAgentContextMode(value["contextMode"]) ||
    !isAgentWritePolicy(value["writePolicy"]) ||
    !isAgentWritePolicy(value["executionWritePolicyDraft"]) ||
    typeof value["writePolicyAcknowledged"] !== "boolean" ||
    ("modelName" in value && !isNonEmptyString(value["modelName"])) ||
    ("reasoningEffort" in value && !isNonEmptyString(value["reasoningEffort"])) ||
    !isSafePositiveInteger(value["revision"]) ||
    !isSafePositiveInteger(value["contextDraftRevision"]) ||
    (value["contextBudgetSnapshotId"] !== null &&
      !isNonEmptyString(value["contextBudgetSnapshotId"])) ||
    !isAgentContextScope(value["scope"]) ||
    !isSha256(value["checksum"])
  ) {
    return invalidAgentRunDraftV20("AGENT_RUN_DRAFT_V20_INVALID");
  }
  if (
    value["writePolicy"] !== "write_before_confirmation" ||
    value["writePolicyAcknowledged"] !== false
  ) {
    return invalidAgentRunDraftV20("AGENT_RUN_DRAFT_V20_PREAPPROVAL_UNAVAILABLE");
  }
  const { checksum: _checksum, ...withoutChecksum } = value;
  void _checksum;
  const expected = checksumAgentRunDraftV20(
    withoutChecksum as unknown as Omit<AgentRunDraftV20, "checksum">
  );
  if (value["checksum"] !== expected) {
    return invalidAgentRunDraftV20("AGENT_RUN_DRAFT_V20_CHECKSUM_INVALID");
  }
  return ok(deepFreeze(value as unknown as AgentRunDraftV20));
}

export function checksumAgentRunDraftV20(draft: Omit<AgentRunDraftV20, "checksum">): string {
  return checksumText(
    stableSerialize({
      runDraftId: draft.runDraftId,
      scope: draft.scope,
      conversationId: draft.conversationId,
      revision: draft.revision,
      userRequest: draft.userRequest,
      operationMode: draft.operationMode,
      contextMode: draft.contextMode,
      writePolicy: draft.writePolicy,
      writePolicyAcknowledged: draft.writePolicyAcknowledged,
      executionWritePolicyDraft: draft.executionWritePolicyDraft,
      modelProfileId: draft.modelProfileId,
      modelName: draft.modelName,
      reasoningEffort: draft.reasoningEffort,
      contextDraftId: draft.contextDraftId,
      contextDraftRevision: draft.contextDraftRevision,
      contextDraftChecksum: draft.contextDraftChecksum,
      contextBudgetSnapshotId: draft.contextBudgetSnapshotId
    })
  );
}

export function applyAgentRunDraftV20Mutation(
  draft: AgentRunDraftV20,
  mutation: AgentRunDraftV20Mutation,
  updatedAt: string
): Result<AgentRunDraftV20, UnifiedError> {
  if (mutation.kind === "set_execution_write_policy_draft") {
    const policy = validateExecutionWritePolicyDraft(mutation.policy);
    if (!policy.ok) return policy;
    return ok(nextRevisionV20(draft, { executionWritePolicyDraft: policy.value }, updatedAt));
  }
  if (mutation.kind === "set_write_policy") {
    if (mutation.writePolicy !== "write_before_confirmation" || mutation.acknowledged !== false) {
      return err(
        agentRunDraftError(
          "AGENT_RUN_DRAFT_V20_PREAPPROVAL_UNAVAILABLE",
          "The Main-owned approval surface is not qualified; the current run remains manual."
        )
      );
    }
    return ok(
      nextRevisionV20(
        draft,
        {
          writePolicy: "write_before_confirmation",
          writePolicyAcknowledged: false
        },
        updatedAt
      )
    );
  }
  const legacyResult = applyAgentRunDraftMutation(
    draft as unknown as AgentRunDraft,
    mutation as AgentRunDraftMutation,
    updatedAt
  );
  if (!legacyResult.ok) return legacyResult;
  const { schemaVersion: _schemaVersion, checksum: _checksum, ...base } = legacyResult.value;
  void _schemaVersion;
  void _checksum;
  return ok(
    finalizeAgentRunDraftV20({
      schemaVersion: AGENT_RUN_DRAFT_SCHEMA_VERSION_V20,
      ...base,
      executionWritePolicyDraft: draft.executionWritePolicyDraft,
      revision: draft.revision + 1
    })
  );
}

/**
 * Apply one composer mutation, producing exactly one immutable next revision. Planning runs always
 * use `write_before_confirmation` and cannot pre-approve automatic writes; changing the operation
 * mode or write policy resets the automatic-modification acknowledgement.
 */
export function applyAgentRunDraftMutation(
  draft: AgentRunDraft,
  mutation: AgentRunDraftMutation,
  updatedAt: string
): Result<AgentRunDraft, UnifiedError> {
  switch (mutation.kind) {
    case "set_request":
      return ok(nextRevision(draft, { userRequest: mutation.request }, updatedAt));
    case "set_operation_mode":
      // A mode switch invalidates any prior automatic-write acknowledgement.
      return ok(
        nextRevision(
          draft,
          { operationMode: mutation.operationMode, writePolicyAcknowledged: false },
          updatedAt
        )
      );
    case "set_context_mode":
      return ok(nextRevision(draft, { contextMode: mutation.contextMode }, updatedAt));
    case "set_write_policy": {
      if (draft.operationMode === "planning" && mutation.writePolicy === "user_preapproved_run") {
        return err(
          agentRunDraftError(
            "AGENT_RUN_DRAFT_WRITE_POLICY_NOT_AVAILABLE",
            "Automatic writes are available only for execution runs."
          )
        );
      }
      return ok(
        nextRevision(
          draft,
          {
            writePolicy: mutation.writePolicy,
            writePolicyAcknowledged:
              mutation.writePolicy === "user_preapproved_run" ? mutation.acknowledged : false
          },
          updatedAt
        )
      );
    }
    case "set_model": {
      // A model change invalidates both the prior model override and its reasoning selection unless
      // the caller explicitly supplies replacements. This prevents an unsupported effort from
      // leaking into the next model's server-side preflight.
      const {
        modelName: _previousModelName,
        reasoningEffort: _previousReasoningEffort,
        ...clearedDraft
      } = draft;
      void _previousModelName;
      void _previousReasoningEffort;
      const patch: Partial<CreateAgentRunDraftInput> = {
        modelProfileId: mutation.modelProfileId,
        ...(mutation.modelName === undefined ? {} : { modelName: mutation.modelName }),
        ...(mutation.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: mutation.reasoningEffort })
      };
      return ok(nextRevision(clearedDraft, patch, updatedAt));
    }
    case "set_reasoning":
      return ok(nextRevision(draft, { reasoningEffort: mutation.reasoningEffort }, updatedAt));
  }
}

/** Re-point the draft at a new Context Draft revision/checksum, producing one next revision. */
export function bindContextDraft(
  draft: AgentRunDraft,
  binding: {
    readonly contextDraftId: string;
    readonly contextDraftRevision: number;
    readonly contextDraftChecksum: string;
  },
  updatedAt: string
): AgentRunDraft {
  return nextRevision(draft, { ...binding }, updatedAt);
}

export function checksumAgentRunDraft(draft: Omit<AgentRunDraft, "checksum">): string {
  return checksumText(
    stableSerialize({
      runDraftId: draft.runDraftId,
      scope: draft.scope,
      conversationId: draft.conversationId,
      revision: draft.revision,
      userRequest: draft.userRequest,
      operationMode: draft.operationMode,
      contextMode: draft.contextMode,
      writePolicy: draft.writePolicy,
      writePolicyAcknowledged: draft.writePolicyAcknowledged,
      modelProfileId: draft.modelProfileId,
      modelName: draft.modelName,
      reasoningEffort: draft.reasoningEffort,
      contextDraftId: draft.contextDraftId,
      contextDraftRevision: draft.contextDraftRevision,
      contextDraftChecksum: draft.contextDraftChecksum,
      contextBudgetSnapshotId: draft.contextBudgetSnapshotId
    })
  );
}

export function normalizeAgentRunDraft(
  value: Readonly<Record<string, unknown>>,
  legacyWorkspaceKind?: AgentWorkspaceKind
): AgentRunDraft {
  const { projectId: _legacyProjectId, ...withoutLegacyProjectId } = value;
  void _legacyProjectId;
  if (value["schemaVersion"] === "1.1") {
    const scope = normalizeAgentContextScope(value["scope"], undefined, legacyWorkspaceKind);
    return deepFreeze({ ...withoutLegacyProjectId, scope } as unknown as AgentRunDraft);
  }
  if (value["schemaVersion"] !== "1.0") throw new Error("AGENT_RUN_DRAFT_VERSION_UNSUPPORTED");
  return deepFreeze({
    ...withoutLegacyProjectId,
    schemaVersion: "1.1",
    scope: normalizeAgentContextScope(undefined, value["projectId"], legacyWorkspaceKind)
  } as unknown as AgentRunDraft);
}

function nextRevisionV20(
  draft: AgentRunDraftV20,
  patch: Partial<CreateAgentRunDraftV20Input>,
  updatedAt: string
): AgentRunDraftV20 {
  const { schemaVersion: _schemaVersion, checksum: _checksum, ...base } = draft;
  void _schemaVersion;
  void _checksum;
  return finalizeAgentRunDraftV20({
    schemaVersion: AGENT_RUN_DRAFT_SCHEMA_VERSION_V20,
    ...base,
    ...patch,
    updatedAt,
    revision: draft.revision + 1
  });
}

function finalizeAgentRunDraftV20(draft: Omit<AgentRunDraftV20, "checksum">): AgentRunDraftV20 {
  return deepFreeze({ ...draft, checksum: checksumAgentRunDraftV20(draft) });
}

function invalidAgentRunDraftV20(code: string): Result<AgentRunDraftV20, UnifiedError> {
  return err(
    agentRunDraftError(
      code,
      "The Agent Run Draft 2.0 value is invalid or cannot authorize an execution handoff."
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSafePositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isAgentOperationMode(value: unknown): value is AgentOperationMode {
  return value === "conversation" || value === "planning" || value === "execution";
}

function isAgentContextMode(value: unknown): value is AgentContextMode {
  return value === "standalone_chat" || value === "writing" || value === "general_file";
}

function isAgentWritePolicy(value: unknown): value is AgentWritePolicy {
  return value === "write_before_confirmation" || value === "user_preapproved_run";
}

function nextRevision(
  draft: AgentRunDraft,
  patch: Partial<CreateAgentRunDraftInput>,
  updatedAt: string
): AgentRunDraft {
  const { schemaVersion: _schemaVersion, checksum: _checksum, ...base } = draft;
  void _schemaVersion;
  void _checksum;
  return finalizeAgentRunDraft({
    schemaVersion: "1.1",
    ...normalizePolicy({ ...base, ...patch, updatedAt }),
    revision: draft.revision + 1
  });
}

/** Planning runs never carry an automatic-write policy or acknowledgement. */
function normalizePolicy(draft: CreateAgentRunDraftInput): CreateAgentRunDraftInput {
  if (draft.operationMode !== "planning") return draft;
  return { ...draft, writePolicy: "write_before_confirmation", writePolicyAcknowledged: false };
}

function finalizeAgentRunDraft(draft: Omit<AgentRunDraft, "checksum">): AgentRunDraft {
  return deepFreeze({ ...draft, checksum: checksumAgentRunDraft(draft) });
}

function agentRunDraftError(code: string, message: string): UnifiedError {
  return createUnifiedError({
    code,
    category: "ValidationError",
    message,
    recoverability: "user-action",
    suggestedAction: "Adjust the run draft and retry.",
    traceId: "agent-run-draft"
  });
}

function checksumText(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableSerialize(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
