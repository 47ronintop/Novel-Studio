import { createHash } from "node:crypto";

import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import type {
  AgentContextMode,
  AgentOperationMode,
  AgentReasoningEffort,
  AgentWritePolicy
} from "./agent-run-types.js";

export interface AgentRunDraft {
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
  readonly reasoningEffort?: AgentReasoningEffort;
  readonly contextDraftId: string;
  readonly contextDraftRevision: number;
  readonly contextDraftChecksum: string;
  readonly contextBudgetSnapshotId: string | null;
  readonly updatedAt: string;
}

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
      readonly reasoningEffort?: AgentReasoningEffort;
    }
  | { readonly kind: "set_reasoning"; readonly reasoningEffort: AgentReasoningEffort };

export type CreateAgentRunDraftInput = Omit<
  AgentRunDraft,
  "schemaVersion" | "revision" | "checksum"
>;

export function createAgentRunDraft(input: CreateAgentRunDraftInput): AgentRunDraft {
  return finalizeAgentRunDraft({ schemaVersion: "1.0", ...normalizePolicy(input), revision: 1 });
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
      // Only touch reasoning when the caller supplies it; the session normalizes reasoning against
      // the new model's declared capabilities after a model change.
      const patch: Partial<CreateAgentRunDraftInput> =
        mutation.reasoningEffort === undefined
          ? { modelProfileId: mutation.modelProfileId }
          : { modelProfileId: mutation.modelProfileId, reasoningEffort: mutation.reasoningEffort };
      return ok(nextRevision(draft, patch, updatedAt));
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
      projectId: draft.projectId,
      conversationId: draft.conversationId,
      revision: draft.revision,
      userRequest: draft.userRequest,
      operationMode: draft.operationMode,
      contextMode: draft.contextMode,
      writePolicy: draft.writePolicy,
      writePolicyAcknowledged: draft.writePolicyAcknowledged,
      modelProfileId: draft.modelProfileId,
      reasoningEffort: draft.reasoningEffort,
      contextDraftId: draft.contextDraftId,
      contextDraftRevision: draft.contextDraftRevision,
      contextDraftChecksum: draft.contextDraftChecksum,
      contextBudgetSnapshotId: draft.contextBudgetSnapshotId
    })
  );
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
    schemaVersion: "1.0",
    ...normalizePolicy({ ...base, ...patch, updatedAt }),
    revision: draft.revision + 1
  });
}

/** Planning runs never carry an automatic-write policy or acknowledgement. */
function normalizePolicy(
  draft: CreateAgentRunDraftInput
): CreateAgentRunDraftInput {
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
