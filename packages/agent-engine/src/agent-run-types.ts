import type { JsonObject, UnifiedError } from "@novel-studio/shared";
import type {
  LlmCacheInputTokenSemantics,
  LlmCacheOutcome,
  LlmCacheUsageStatus,
  LlmPromptCacheBypassReason,
  LlmPromptCacheMode
} from "@novel-studio/llm-adapter";
import type { ChangeSetFileSelection, ChangeSetOperationSelection } from "./change-set.js";
import type { AgentContextSourceInput } from "./context-snapshot.js";
import type { PackedAgentContext } from "./packed-agent-context.js";
import type { AgentToolFacadeVersion } from "./tool-registry.js";
import type { AgentWorkspaceKind } from "./agent-tool-capabilities.js";
import { validateFinishInput, type FinishInputV2 } from "./finish-report.js";
import type {
  AgentRunEventTypeV20,
  AgentRunEventV20,
  AgentRunSnapshotV20,
  AgentRunStatusV20,
  AgentRunV20StartFacts
} from "./agent-run-v20.js";
import {
  normalizeAgentContextScope,
  type AgentContextProfileId,
  type AgentContextScope
} from "./agent-context-scope.js";

export type AgentOperationMode = "conversation" | "planning" | "execution";
export type AgentContextMode = "standalone_chat" | "writing" | "general_file";
export type AgentWritePolicy = "write_before_confirmation" | "user_preapproved_run";
/** Provider-declared reasoning effort. Known values are labels, not a closed protocol enum. */
export type AgentReasoningEffort = string;
export type AgentRunStatus =
  | "created"
  | "planning_model"
  | "executing_model"
  | "executing_read_tool"
  | "staging_changes"
  | "awaiting_write_approval"
  | "applying_changes"
  | "stopping_after_transaction"
  | "awaiting_user_input"
  | "awaiting_context_refresh"
  | "plan_ready"
  | "awaiting_plan_decision"
  | "completed"
  | "blocked"
  | "cancelled"
  | "failed"
  | "limit_reached";

/** Stage 5 (v1.1) widens the run status with the compaction/plan-revision waits. */
export type AgentRunStatusV11 = AgentRunStatus | "context_compacting" | "awaiting_plan_revision";

/**
 * Task 0.4 (v1.2) — widens the run status with tool-approval wait.
 * Used when an execute/external_action/destructive tool call needs explicit human confirmation.
 */
export type AgentRunStatusV12 =
  AgentRunStatusV11 | "awaiting_tool_approval" | "awaiting_external_outcome_resolution";
export type AgentRunStatusV13 = AgentRunStatusV12 | "conversation_model";

export type AgentRunRecoveryState =
  "none" | "retryable" | "awaiting_context_refresh" | "recovery_review" | "terminal";

export interface AgentRunUsageSummary {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly cacheEligibleInputTokens?: number;
  readonly cacheOutcome: LlmCacheOutcome;
  readonly cacheBypassReason?: LlmPromptCacheBypassReason;
  readonly cacheUsageStatus: LlmCacheUsageStatus;
  readonly cacheInputTokenSemantics: LlmCacheInputTokenSemantics;
  readonly reasoningTokens?: number;
  readonly totalTokens: number;
  readonly usageStatus: "actual" | "estimated" | "missing";
}

export const EMPTY_AGENT_RUN_USAGE_SUMMARY: AgentRunUsageSummary = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  usageStatus: "missing",
  cacheOutcome: "unknown",
  cacheUsageStatus: "unavailable",
  cacheInputTokenSemantics: "unavailable"
};

export interface AgentPromptCacheCapabilitySnapshot {
  readonly mode: LlmPromptCacheMode;
  readonly policyVersion: string;
  readonly minimumCacheableTokens: number;
  readonly ttlSeconds: number | null;
  readonly inputTokenSemantics: LlmCacheInputTokenSemantics;
  readonly reportsCacheReadTokens: boolean;
  readonly reportsCacheWriteTokens: boolean;
}

export const NO_AGENT_PROMPT_CACHE_CAPABILITY: AgentPromptCacheCapabilitySnapshot = Object.freeze({
  mode: "none",
  policyVersion: "none@1.0",
  minimumCacheableTokens: 0,
  ttlSeconds: null,
  inputTokenSemantics: "unavailable",
  reportsCacheReadTokens: false,
  reportsCacheWriteTokens: false
});

export interface AgentProviderCapabilitySnapshot {
  readonly profileId: string;
  readonly provider: string;
  readonly modelName: string;
  readonly streaming: true;
  readonly toolCalling: boolean;
  readonly structuredArguments: boolean;
  readonly contextWindow: number;
  /** Frozen effective maximum output tokens, when the selected profile declares one. */
  readonly maxOutputTokens?: number;
  readonly requiredContextTokens: number;
  /** Required on v1.3 snapshots; absent only on normalized historical records. */
  readonly promptCache?: AgentPromptCacheCapabilitySnapshot;
}

export interface AgentRunLimits {
  readonly maxModelRounds: number;
  readonly maxToolCalls: number;
  readonly maxConsecutiveToolFailures: number;
}

/** The persisted v1.0 run snapshot shape. Retained for read compatibility with pre-Stage-5 files. */
export interface AgentRunSnapshotV10 {
  readonly schemaVersion: "1.0";
  readonly runId: string;
  readonly projectId: string;
  readonly conversationId: string | null;
  readonly operationMode: AgentOperationMode;
  readonly contextMode: AgentContextMode;
  readonly writePolicy: AgentWritePolicy;
  readonly userRequest: string;
  readonly status: AgentRunStatus;
  readonly runRevision: number;
  readonly lastSequence: number;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly limits: AgentRunLimits;
  readonly providerCapabilitySnapshot: AgentProviderCapabilitySnapshot;
  readonly pendingUserInputId: string | null;
  readonly contextSnapshotId: string | null;
  readonly sourcePlanId: string | null;
  readonly sourcePlanRevision: number | null;
  readonly pendingChangeSetId?: string | null;
  readonly pendingChangeSetRevision?: number | null;
  readonly pendingChangeSetChecksum?: string | null;
  readonly versionGroupId?: string | null;
}

/**
 * The Stage 5 (v1.1) run snapshot. The coordinator authors this shape directly; every new field
 * has a deterministic default it holds at start (see normalizeAgentRunSnapshot for the v1.0→v1.1
 * backfill rules). `modelProfileId` is a deliberate hoist of `providerCapabilitySnapshot.profileId`.
 */
export interface AgentRunSnapshotV11 extends Omit<AgentRunSnapshotV10, "schemaVersion" | "status"> {
  readonly schemaVersion: "1.1";
  /** v1.2 added pause states while keeping the v1.1 snapshot envelope. */
  readonly status: AgentRunStatusV12;
  readonly modelProfileId: string;
  readonly reasoningEffort?: AgentReasoningEffort;
  readonly permissionSummaryId: string | null;
  readonly permissionSummaryChecksum: string | null;
  readonly contextBudgetSnapshotId: string | null;
  readonly activeCompactionId: string | null;
  readonly planExecutionId: string | null;
  readonly planExecutionRevision: number | null;
  readonly activeErrorId: string | null;
  readonly recoveryState: AgentRunRecoveryState;
  readonly usageSummary: AgentRunUsageSummary;
  /** Missing on historical snapshots; normalization treats absence as the frozen v1 facade. */
  readonly toolFacadeVersion?: AgentToolFacadeVersion;
  /** Immutable descriptor catalog persisted before the first model round for new runs. */
  readonly toolCatalogSnapshotId?: string | null;
  readonly toolCatalogRevision?: string | null;
  /**
   * Durable resumption record for an effectful tool that is waiting for a user decision. The
   * original arguments are retained only so an approved call can be verified and executed without
   * trusting a fresh renderer/model payload after restart.
   */
  readonly pendingToolApproval?: PendingToolApproval | null;
}

/** C1 v1.2 snapshot. JSON persistence uses `scope`; `projectId` is runtime-only compatibility. */
export interface AgentRunSnapshotV12 extends Omit<
  AgentRunSnapshotV11,
  "schemaVersion" | "status" | "operationMode" | "contextMode" | "projectId"
> {
  readonly schemaVersion: "1.2";
  readonly scope: AgentContextScope;
  readonly operationMode: AgentOperationMode;
  readonly contextMode: AgentContextMode;
  readonly status: AgentRunStatusV13;
  readonly contextProfileId: AgentContextProfileId;
  readonly profileVersion: string;
  readonly guidanceTemplateChecksum: string;
  readonly conventionsArtifactId: string | null;
  readonly promptCachePolicyVersion: string;
  readonly cachePrefixChecksum: string;
  /** Non-enumerable workspace compatibility accessor; absent at runtime for standalone. */
  readonly projectId: string;
}

export interface AgentProviderCapabilitySnapshotV13 extends AgentProviderCapabilitySnapshot {
  readonly promptCache: AgentPromptCacheCapabilitySnapshot;
}

/** C5 v1.3 snapshot. Cache capability and identity fields are explicit and fail closed on read. */
export interface AgentRunSnapshotV13 extends Omit<
  AgentRunSnapshotV12,
  "schemaVersion" | "providerCapabilitySnapshot"
> {
  readonly schemaVersion: "1.3";
  readonly providerCapabilitySnapshot: AgentProviderCapabilitySnapshotV13;
  readonly promptCacheArtifactId: string | null;
  readonly promptCacheIdentityBaseChecksum: string;
  readonly promptCacheIdentityChecksum: string;
  /** Leading provider messages, including the system message. */
  readonly promptCacheStablePrefixMessageCount: number;
  /** New execution runs opt into the structured finish transition; legacy facades remain readable. */
  readonly finishContractVersion?: "2.0";
  /** Structured completion evidence. Absent on legacy snapshots and non-terminal runs. */
  readonly finishReport?: FinishInputV2 | null;
}

/**
 * The active run snapshot type consumed across Application/IPC/renderer. Aliased to the v1.1 view:
 * new runs are authored as v1.1 and old v1.0 files are normalized on read.
 */
export type AgentRunSnapshot = AgentRunSnapshotV13 | AgentRunSnapshotV20;

/** The persisted v1.0 run event shape. Retained for read compatibility with pre-Stage-5 files. */
export interface AgentRunEventV10 {
  readonly schemaVersion: "1.0";
  readonly runId: string;
  readonly projectId: string;
  readonly sequence: number;
  readonly runRevision: number;
  readonly type: AgentRunEventType;
  readonly createdAt: string;
  readonly detail?: JsonObject;
}

/** The Stage 5 (v1.1) run event. Same envelope as v1.0 with the widened Stage 5 event union. */
export interface AgentRunEventV11 extends Omit<AgentRunEventV10, "schemaVersion" | "type"> {
  readonly schemaVersion: "1.1";
  readonly type: AgentRunEventTypeV11;
}

/** Task 0.4 (v1.2) run event — carries the v1.2 event type union. */
export interface AgentRunEventV12 extends Omit<AgentRunEventV10, "schemaVersion" | "type"> {
  readonly schemaVersion: "1.2";
  readonly type: AgentRunEventTypeV12;
}

export interface AgentRunEventV13 extends Omit<
  AgentRunEventV10,
  "schemaVersion" | "type" | "projectId"
> {
  readonly schemaVersion: "1.3";
  readonly scope: AgentContextScope;
  readonly type: AgentRunEventTypeV13;
  /** Non-enumerable workspace compatibility accessor; absent at runtime for standalone. */
  readonly projectId: string;
}

/**
 * The active run event type. Unlike the snapshot, the v1.1 event added no required fields — only
 * new event-type union members — so a persisted v1.0 event is structurally valid here. The alias
 * accepts both versions; `normalizeAgentRunEvent` still lifts persisted events to the v1.1 view.
 * Task 0.4: v1.2 events are accepted here for new runs but written as v1.2 on disk.
 */
export type AgentRunEvent =
  AgentRunEventV10 | AgentRunEventV11 | AgentRunEventV12 | AgentRunEventV13 | AgentRunEventV20;

export type AgentRunEventType =
  | "run_started"
  | "assistant_text_delta"
  | "assistant_text_completed"
  | "tool_started"
  | "tool_completed"
  | "tool_failed"
  | "tool_retry_requested"
  | "user_input_requested"
  | "user_input_resolved"
  | "context_stale"
  | "context_refreshed"
  | "context_excluded"
  | "context_refresh_cancelled"
  | "run_resumed"
  | "plan_ready"
  | "plan_decision_resolved"
  | "plan_execution_started"
  | "change_set_ready"
  | "change_set_auto_approved"
  | "approval_resolved"
  | "write_started"
  | "write_applied"
  | "write_failed"
  | "run_undo_started"
  | "run_undo_review_required"
  | "run_undone"
  | "run_undo_failed"
  | "run_completed"
  | "run_blocked"
  | "run_cancelled"
  | "run_failed"
  | "run_limit_reached";

/** The Stage 5 event union: the v1.0 events plus the compaction/permission/usage/plan-revision events. */
export type AgentRunEventTypeV11 =
  | AgentRunEventType
  | "context_compaction_started"
  | "context_compaction_completed"
  | "context_compaction_failed"
  | "permission_summary_ready"
  | "usage_updated"
  | "plan_step_started"
  | "plan_step_completed"
  | "plan_step_blocked"
  | "plan_step_skipped"
  | "plan_deviation_recorded"
  | "plan_revision_requested"
  | "error_recorded";

/**
 * Task 0.4 (v1.2) — extends v1.1 with tool-approval, capability-revocation, process-output,
 * and outcome-unknown events for Phase C/D/E tools.
 * New events must NOT be added to the v1.1 enum; they live here only.
 */
export type AgentRunEventTypeV12 =
  | AgentRunEventTypeV11
  | "tool_approval_requested"
  | "tool_approval_resolved"
  | "capability_revoked"
  | "process_output"
  | "external_outcome_unknown";

export type AgentRunEventTypeV13 =
  | AgentRunEventTypeV12
  | "conversation_model"
  /** App-authored proof used when a strict completion has no preceding tool result (for example model stop). */
  | "completion_evidence_recorded";

export type AgentControlEventTypeV20 =
  | "user_input_resolved"
  | "plan_execution_started"
  | "tool_approval_resolved"
  | "context_refreshed"
  | "context_excluded"
  | "context_compaction_completed";

export interface AgentControlEventMessageMappingV20 {
  readonly role: "user" | "tool";
  readonly envelopeKind:
    "untrusted_conversation_data" | "untrusted_tool_data" | "untrusted_recovery_data" | null;
}

const AGENT_CONTROL_EVENT_MESSAGE_MAPPINGS_V20 = Object.freeze({
  user_input_resolved: { role: "user", envelopeKind: null },
  plan_execution_started: { role: "user", envelopeKind: null },
  tool_approval_resolved: { role: "tool", envelopeKind: "untrusted_tool_data" },
  context_refreshed: { role: "user", envelopeKind: "untrusted_recovery_data" },
  context_excluded: { role: "user", envelopeKind: "untrusted_recovery_data" },
  context_compaction_completed: {
    role: "user",
    envelopeKind: "untrusted_conversation_data"
  }
} as const satisfies Record<AgentControlEventTypeV20, AgentControlEventMessageMappingV20>);

/** The protocol mapping is app-owned and cannot be selected by persisted event detail. */
export function agentControlEventMessageMappingV20(
  eventType: AgentControlEventTypeV20
): AgentControlEventMessageMappingV20 {
  return AGENT_CONTROL_EVENT_MESSAGE_MAPPINGS_V20[eventType];
}

/**
 * Task C.2 — ToolApprovalBinding discriminated union.
 * Binds a tool call requiring approval to its specific execution context.
 */
export type ToolApprovalBinding =
  | {
      readonly kind: "task";
      readonly bindingId: string;
      readonly runId: string;
      readonly runRevision: number;
      readonly toolCallId: string;
      readonly taskId: string;
      readonly snapshotDigest: string;
      readonly parametersDigest: string;
      readonly catalogRevision: string;
      readonly attestationRef: string;
      /** Immutable task execution snapshot prepared before approval. */
      readonly executionSnapshotId: string;
      /** Effective capability revision at the time the request was shown. */
      readonly effectiveCapabilityRevision: number;
      readonly expiresAt: string;
    }
  | {
      readonly kind: "network";
      readonly bindingId: string;
      readonly runId: string;
      readonly runRevision: number;
      readonly toolCallId: string;
      readonly destination: string;
      readonly requestDigest: string;
      readonly egressClass: string;
      readonly effectiveCapabilityRevision: number;
      readonly expiresAt: string;
    }
  | {
      readonly kind: "external";
      readonly bindingId: string;
      readonly runId: string;
      readonly runRevision: number;
      readonly toolCallId: string;
      readonly sourceId: string;
      readonly descriptorDigest: string;
      readonly argumentDigest: string;
      readonly idempotencyKey: string;
      readonly effectiveCapabilityRevision: number;
      readonly expiresAt: string;
    };

/** A pending effectful tool call, persisted with the run snapshot until resolved. */
export interface PendingToolApproval {
  readonly binding: ToolApprovalBinding;
  readonly canonicalToolId: string;
  readonly providerToolName: string;
  readonly argumentsText: string;
  readonly requestedAt: string;
}

export interface AgentRunSnapshotPatch {
  readonly pendingUserInputId?: string | null;
  readonly contextSnapshotId?: string | null;
  readonly sourcePlanId?: string | null;
  readonly sourcePlanRevision?: number | null;
  readonly pendingChangeSetId?: string | null;
  readonly pendingChangeSetRevision?: number | null;
  readonly pendingChangeSetChecksum?: string | null;
  readonly versionGroupId?: string | null;
  readonly reasoningEffort?: AgentReasoningEffort;
  readonly permissionSummaryId?: string | null;
  readonly permissionSummaryChecksum?: string | null;
  readonly contextBudgetSnapshotId?: string | null;
  readonly activeCompactionId?: string | null;
  readonly planExecutionId?: string | null;
  readonly planExecutionRevision?: number | null;
  readonly activeErrorId?: string | null;
  readonly recoveryState?: AgentRunRecoveryState;
  readonly usageSummary?: AgentRunUsageSummary;
  readonly pendingToolApproval?: PendingToolApproval | null;
  readonly toolFacadeVersion?: AgentToolFacadeVersion;
  readonly toolCatalogSnapshotId?: string | null;
  readonly toolCatalogRevision?: string | null;
  readonly conventionsArtifactId?: string | null;
  readonly cachePrefixChecksum?: string;
  readonly promptCacheIdentityChecksum?: string;
  readonly promptCacheStablePrefixMessageCount?: number;
  readonly finishReport?: FinishInputV2 | null;
  /** V2.0-only local usage artifact binding. Legacy transitions reject this field. */
  readonly usageId?: string | null;
}

export interface RecordAgentRunEventInput {
  readonly runId: string;
  readonly status: AgentRunStatusV13 | AgentRunStatusV20;
  readonly type: AgentRunEventTypeV13 | AgentRunEventTypeV20;
  readonly detail?: JsonObject;
  readonly snapshotPatch?: AgentRunSnapshotPatch;
}

/** Read an explicitly persisted V2.0 usage binding; legacy snapshots never infer one. */
export function readAgentRunUsageId(snapshot: AgentRunSnapshot): string | null {
  return snapshot.schemaVersion === "2.0" ? snapshot.usageId : null;
}

/** Read an explicitly persisted V2.0 event reference; legacy events never infer one. */
export function readAgentRunEventRef(event: AgentRunEvent): string | null {
  return event.schemaVersion === "2.0" ? event.eventRef : null;
}

/** Main-owned terminal transition carrying the strict structured completion report. */
export interface RecordAgentRunFinishInput {
  readonly runId: string;
  readonly scope?: AgentContextScope;
  readonly projectId?: string;
  readonly commandId: string;
  readonly expectedRunRevision: number;
  readonly finishReport: FinishInputV2;
}

export type TerminalAgentRunAuditEventType =
  "run_undo_started" | "run_undo_review_required" | "run_undone" | "run_undo_failed";

export interface RecordTerminalAgentRunAuditEventInput {
  readonly runId: string;
  readonly type: TerminalAgentRunAuditEventType;
  readonly detail?: JsonObject;
}

/**
 * The public start command. Draft-only by design: the renderer submits nothing but a reference to
 * an already-persisted Agent Run Draft revision. Operation mode, context mode, write policy, the
 * user request, the model/reasoning selection, the provider capability snapshot, and every context
 * source are resolved server-side by the Application preflight (see `ResolvedAgentRunStartInput`).
 * The renderer cannot author provider, model name, context window, capabilities, or document
 * content.
 */
export interface StartAgentRunCommand {
  /** Server-authoritative scope. Standalone commands omit the legacy projectId entirely. */
  readonly scope?: AgentContextScope;
  /** Legacy workspace-only identity. */
  readonly projectId?: string;
  readonly conversationId: string;
  readonly commandId: string;
  readonly expectedRunRevision: 0;
  readonly runDraftId: string;
  readonly runDraftRevision: number;
  readonly runDraftChecksum: string;
  readonly packedContextId?: string;
  readonly packedContextPayloadChecksum?: string;
  readonly limits?: Partial<AgentRunLimits>;
  readonly sourcePlanId?: string;
  readonly sourcePlanRevision?: number;
}

/**
 * The internal, server-resolved start input the coordinator consumes. It is the pre-Stage-5 wide
 * start shape minus renderer authority, plus the server-validated `reasoningEffort`. The Application
 * preflight builds this from the reloaded run draft + Context Draft + editor content + resolved model
 * profile; the plan→execution handoff builds it from the approved plan + parent run. It is never
 * accepted over IPC.
 */
export interface ResolvedAgentRunStartInput {
  /** Legacy workspace-only identity; standalone resolved starts omit it. */
  readonly projectId?: string;
  readonly scope?: AgentContextScope;
  readonly conversationId: string;
  readonly commandId: string;
  readonly expectedRunRevision: 0;
  readonly operationMode: AgentOperationMode;
  readonly contextMode: AgentContextMode;
  readonly writePolicy?: AgentWritePolicy;
  readonly writePolicyAcknowledged?: true;
  readonly userRequest: string;
  readonly providerCapabilitySnapshot: AgentProviderCapabilitySnapshot;
  readonly reasoningEffort?: AgentReasoningEffort;
  readonly limits?: Partial<AgentRunLimits>;
  readonly initialContextSources?: readonly AgentContextSourceInput[];
  readonly excludedContextSourceIds?: readonly string[];
  readonly packedContext?: PackedAgentContext;
  readonly contextBudgetSnapshotId?: string;
  readonly permissionSummaryId?: string;
  readonly permissionSummaryChecksum?: string;
  readonly planExecutionId?: string;
  readonly planExecutionRevision?: number;
  readonly sourcePlanId?: string;
  readonly sourcePlanRevision?: number;
  /** Main-owned model tool contract. Public IPC never supplies this value. */
  readonly toolFacadeVersion?: AgentToolFacadeVersion;
  /** Revision of the immutable catalog that Application will persist before driving the run. */
  readonly toolCatalogRevision?: string;
  /** Main-owned marker selecting the strict execution finish transition. */
  readonly finishContractVersion?: "2.0";
  readonly contextProfileId?: AgentContextProfileId;
  readonly profileVersion?: string;
  readonly guidanceTemplateChecksum?: string;
  readonly conventionsArtifactId?: string | null;
  readonly promptCachePolicyVersion?: string;
  readonly cachePrefixChecksum?: string;
  /** Internal Main-derived identities. The coordinator persists only their composite checksum. */
  readonly promptCacheConnectionIdentityChecksum?: string;
  readonly promptCacheAccountIsolationChecksum?: string;
  readonly promptCacheArtifactId?: string | null;
  readonly promptCacheIdentityBaseChecksum?: string;
  readonly promptCacheIdentityChecksum?: string;
  readonly promptCacheStablePrefixMessageCount?: number;
  /** Presence selects the strict 2.0 run writer. Absence retains the registered legacy path. */
  readonly runV20?: AgentRunV20StartFacts;
}

export interface StopAgentRunCommand {
  readonly runId: string;
  readonly scope?: AgentContextScope;
  /** Legacy workspace-only identity. */
  readonly projectId?: string;
  readonly commandId: string;
  readonly expectedRunRevision: number;
}

export interface ResumeAgentRunCommand {
  readonly runId: string;
  readonly projectId: string;
  readonly commandId: string;
  readonly expectedRunRevision: number;
}

/** A durable, idempotent decision for exactly one displayed effectful tool binding. */
export interface DecideToolApprovalCommand {
  readonly runId: string;
  readonly projectId: string;
  readonly commandId: string;
  readonly expectedRunRevision: number;
  readonly bindingId: string;
  readonly decision: "approve" | "reject";
}

export interface RetryAgentRunStepCommand {
  readonly runId: string;
  readonly projectId: string;
  readonly commandId: string;
  readonly expectedRunRevision: number;
}

export interface DecideAgentPlanCommand {
  readonly runId: string;
  readonly projectId: string;
  readonly commandId: string;
  readonly expectedRunRevision: number;
  readonly planId: string;
  readonly planRevision: number;
  readonly decision: "approve" | "reject";
  readonly executionContextMode?: AgentContextMode;
}

export interface DecidePlanRevisionCommand {
  readonly runId: string;
  readonly projectId: string;
  readonly commandId: string;
  readonly expectedRunRevision: number;
  readonly requestId: string;
  readonly planId: string;
  readonly planRevision: number;
  readonly decision: "approve" | "reject";
}

export interface RefreshAgentContextCommand {
  readonly runId: string;
  readonly projectId: string;
  readonly commandId: string;
  readonly expectedRunRevision: number;
  readonly decision: "refresh" | "exclude" | "cancel";
  readonly sourceRefs?: readonly string[];
  readonly currentSources?: readonly AgentContextSourceInput[];
}

interface DecideChangeSetCommandBase {
  readonly runId: string;
  readonly projectId: string;
  readonly commandId: string;
  readonly expectedRunRevision: number;
  readonly changeSetId: string;
  readonly revision: number;
  readonly checksum: string;
}

export type DecideChangeSetCommand = DecideChangeSetCommandBase &
  (
    | {
        readonly decision: "update_selection";
        readonly files: readonly ChangeSetFileSelection[];
        readonly operations?: readonly ChangeSetOperationSelection[];
      }
    | {
        readonly decision: "apply_selected" | "reject_all";
        readonly files?: never;
      }
  );

interface UndoAgentRunCommandBase {
  readonly runId: string;
  readonly projectId: string;
  readonly commandId: string;
  readonly expectedRunRevision: number;
}

export type UndoAgentRunCommand = UndoAgentRunCommandBase &
  (
    | { readonly action: "request" }
    | {
        readonly action: "resolve";
        readonly reviewId: string;
        readonly decisions?: readonly {
          readonly relativePath: string;
          readonly decision: "keep_current" | "restore_baseline";
        }[];
        readonly retryFailedOnly?: true;
      }
  );

export type UndoRunCommand = UndoAgentRunCommand;

export type AgentRunCommandResult =
  | { readonly ok: true; readonly value: AgentRunSnapshot }
  | {
      readonly ok: false;
      readonly error: UnifiedError;
      readonly latestSnapshot?: AgentRunSnapshot;
    };

export interface AgentRunCoordinator {
  startRun(command: ResolvedAgentRunStartInput): AgentRunCommandResult;
  stopRun(command: StopAgentRunCommand): AgentRunCommandResult;
  recordRunEvent(input: RecordAgentRunEventInput): AgentRunCommandResult;
  recordFinish(input: RecordAgentRunFinishInput): AgentRunCommandResult;
  recordTerminalAuditEvent(input: RecordTerminalAgentRunAuditEventInput): AgentRunCommandResult;
  restoreRun(snapshot: AgentRunSnapshot, events: readonly AgentRunEvent[]): AgentRunCommandResult;
  readSnapshot(runId: string): AgentRunSnapshot | undefined;
  readEvents(runId: string): readonly AgentRunEvent[];
}

/**
 * Normalize a persisted run snapshot (v1.0 or v1.1) into the v1.1 internal view. v1.1 records are
 * returned as-is; v1.0 records are backfilled with Stage 5 defaults. This never rewrites disk files.
 */
export function normalizeAgentRunSnapshot(
  value: JsonObject,
  legacyWorkspaceKind?: AgentWorkspaceKind
): AgentRunSnapshotV13 {
  const conversationId =
    typeof value["conversationId"] === "string" ? value["conversationId"] : null;
  const toolFacadeVersion = value["toolFacadeVersion"] === "v2" ? "v2" : "v1";
  const toolCatalogSnapshotId =
    typeof value["toolCatalogSnapshotId"] === "string" ? value["toolCatalogSnapshotId"] : null;
  const toolCatalogRevision =
    typeof value["toolCatalogRevision"] === "string" ? value["toolCatalogRevision"] : null;
  if (value["schemaVersion"] === "1.3") {
    const scope = normalizeAgentContextScope(value["scope"], undefined, legacyWorkspaceKind);
    if (!isV13PromptCacheState(value)) {
      throw new Error("AGENT_RUN_SNAPSHOT_INVALID");
    }
    validateStrictFinishSnapshotEnvelope(value);
    return attachLegacyProjectId({
      ...withoutLegacyProjectId(value),
      scope,
      usageSummary: normalizeRunUsageSummary(value["usageSummary"]),
      conversationId,
      toolFacadeVersion,
      toolCatalogSnapshotId,
      toolCatalogRevision
    } as unknown as AgentRunSnapshotV13);
  }
  if (value["schemaVersion"] === "1.2") {
    const scope = normalizeAgentContextScope(value["scope"], undefined, legacyWorkspaceKind);
    const providerCapabilitySnapshot = normalizedLegacyProviderCapability(
      value["providerCapabilitySnapshot"]
    );
    return attachLegacyProjectId({
      ...withoutLegacyProjectId(value),
      schemaVersion: "1.3",
      scope,
      conversationId,
      toolFacadeVersion,
      toolCatalogSnapshotId,
      toolCatalogRevision,
      providerCapabilitySnapshot,
      usageSummary: normalizeRunUsageSummary(value["usageSummary"]),
      promptCacheArtifactId: null,
      promptCacheIdentityBaseChecksum: "legacy",
      promptCacheIdentityChecksum: "legacy",
      promptCacheStablePrefixMessageCount: 0
    } as unknown as AgentRunSnapshotV13);
  }
  if (value["schemaVersion"] !== "1.0" && value["schemaVersion"] !== "1.1") {
    throw new Error("AGENT_RUN_SNAPSHOT_VERSION_UNSUPPORTED");
  }
  const capability = value["providerCapabilitySnapshot"];
  const modelProfileId =
    isRecord(capability) && typeof capability["profileId"] === "string"
      ? capability["profileId"]
      : "";
  const contextMode = value["contextMode"] === "writing" ? "writing" : "general_file";
  const contextProfileId: AgentContextProfileId =
    contextMode === "writing" ? "writing" : "creative_general";
  const scope = normalizeAgentContextScope(undefined, value["projectId"], legacyWorkspaceKind);
  const stage5Fields =
    value["schemaVersion"] === "1.1"
      ? value
      : {
          ...value,
          modelProfileId,
          permissionSummaryId: null,
          permissionSummaryChecksum: null,
          contextBudgetSnapshotId: null,
          activeCompactionId: null,
          planExecutionId: null,
          planExecutionRevision: null,
          activeErrorId: null,
          recoveryState: "none",
          usageSummary: EMPTY_AGENT_RUN_USAGE_SUMMARY,
          pendingToolApproval: null
        };
  const stage5Json = stage5Fields as unknown as JsonObject;
  return attachLegacyProjectId({
    ...withoutLegacyProjectId(stage5Json),
    conversationId,
    schemaVersion: "1.3",
    scope,
    contextProfileId,
    profileVersion: "legacy",
    guidanceTemplateChecksum: "legacy",
    conventionsArtifactId: null,
    promptCachePolicyVersion: "none@1.0",
    cachePrefixChecksum: "legacy",
    providerCapabilitySnapshot: normalizedLegacyProviderCapability(
      stage5Json["providerCapabilitySnapshot"]
    ),
    usageSummary: normalizeRunUsageSummary(stage5Json["usageSummary"]),
    promptCacheArtifactId: null,
    promptCacheIdentityBaseChecksum: "legacy",
    promptCacheIdentityChecksum: "legacy",
    promptCacheStablePrefixMessageCount: 0,
    toolFacadeVersion,
    toolCatalogSnapshotId,
    toolCatalogRevision
  } as unknown as AgentRunSnapshotV13);
}

function validateStrictFinishSnapshotEnvelope(value: JsonObject): void {
  const finishContractVersion = value["finishContractVersion"];
  if (finishContractVersion !== undefined && finishContractVersion !== "2.0") {
    throw new Error("AGENT_RUN_SNAPSHOT_INVALID");
  }
  const status = value["status"];
  if (status === "blocked" && finishContractVersion !== "2.0") {
    throw new Error("AGENT_RUN_SNAPSHOT_INVALID");
  }
  if (finishContractVersion !== "2.0" || value["operationMode"] !== "execution") return;
  const report = value["finishReport"];
  const terminal = status === "completed" || status === "blocked";
  if (!terminal) {
    if (report !== undefined && report !== null) throw new Error("AGENT_RUN_SNAPSHOT_INVALID");
    return;
  }
  if (!isRecord(report) || report["schemaVersion"] !== "2.0") {
    throw new Error("AGENT_RUN_SNAPSHOT_INVALID");
  }
  const parsed = validateFinishInput(report);
  if (!parsed.ok || parsed.value.outcome !== status) {
    throw new Error("AGENT_RUN_SNAPSHOT_INVALID");
  }
}

function normalizeRunUsageSummary(value: unknown): AgentRunUsageSummary {
  if (!isRecord(value)) return EMPTY_AGENT_RUN_USAGE_SUMMARY;
  return {
    ...(value as unknown as AgentRunUsageSummary),
    cacheOutcome:
      value["cacheOutcome"] === "hit" ||
      value["cacheOutcome"] === "miss" ||
      value["cacheOutcome"] === "bypass"
        ? value["cacheOutcome"]
        : "unknown",
    cacheUsageStatus:
      value["cacheUsageStatus"] === "actual" || value["cacheUsageStatus"] === "derived"
        ? value["cacheUsageStatus"]
        : "unavailable",
    cacheInputTokenSemantics:
      value["cacheInputTokenSemantics"] === "included_in_input" ||
      value["cacheInputTokenSemantics"] === "excluded_from_input"
        ? value["cacheInputTokenSemantics"]
        : "unavailable"
  };
}

function normalizedLegacyProviderCapability(value: unknown): AgentProviderCapabilitySnapshotV13 {
  if (!isRecord(value)) throw new Error("AGENT_RUN_SNAPSHOT_INVALID");
  return {
    ...(value as unknown as AgentProviderCapabilitySnapshot),
    promptCache: NO_AGENT_PROMPT_CACHE_CAPABILITY
  };
}

function isV13PromptCacheState(value: JsonObject): boolean {
  const capability = value["providerCapabilitySnapshot"];
  return (
    isRecord(capability) &&
    isPromptCacheCapability(capability["promptCache"]) &&
    (value["promptCacheArtifactId"] === null ||
      typeof value["promptCacheArtifactId"] === "string") &&
    isChecksumOrLegacy(value["promptCacheIdentityBaseChecksum"]) &&
    isChecksumOrLegacy(value["promptCacheIdentityChecksum"]) &&
    Number.isSafeInteger(value["promptCacheStablePrefixMessageCount"]) &&
    Number(value["promptCacheStablePrefixMessageCount"]) >= 0
  );
}

function isPromptCacheCapability(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    (value["mode"] === "none" ||
      value["mode"] === "automatic_prefix" ||
      value["mode"] === "explicit_breakpoints" ||
      value["mode"] === "explicit_resource") &&
    typeof value["policyVersion"] === "string" &&
    value["policyVersion"].length > 0 &&
    Number.isSafeInteger(value["minimumCacheableTokens"]) &&
    Number(value["minimumCacheableTokens"]) >= 0 &&
    (value["ttlSeconds"] === null ||
      (Number.isSafeInteger(value["ttlSeconds"]) && Number(value["ttlSeconds"]) > 0)) &&
    (value["inputTokenSemantics"] === "included_in_input" ||
      value["inputTokenSemantics"] === "excluded_from_input" ||
      value["inputTokenSemantics"] === "unavailable") &&
    typeof value["reportsCacheReadTokens"] === "boolean" &&
    typeof value["reportsCacheWriteTokens"] === "boolean"
  );
}

function isChecksumOrLegacy(value: unknown): boolean {
  return value === "legacy" || (typeof value === "string" && /^[a-f0-9]{64}$/u.test(value));
}

/** Normalize persisted run events into the scope-aware v1.3 view without rewriting disk. */
export function normalizeAgentRunEvent(
  value: JsonObject,
  legacyWorkspaceKind?: AgentWorkspaceKind
): AgentRunEventV13 {
  if (value["schemaVersion"] === "1.3") {
    return attachLegacyProjectId({
      ...withoutLegacyProjectId(value),
      scope: normalizeAgentContextScope(value["scope"], undefined, legacyWorkspaceKind)
    } as unknown as AgentRunEventV13);
  }
  if (
    value["schemaVersion"] !== "1.0" &&
    value["schemaVersion"] !== "1.1" &&
    value["schemaVersion"] !== "1.2"
  ) {
    throw new Error("AGENT_RUN_EVENT_VERSION_UNSUPPORTED");
  }
  return attachLegacyProjectId({
    ...withoutLegacyProjectId(value),
    schemaVersion: "1.3",
    scope: normalizeAgentContextScope(undefined, value["projectId"], legacyWorkspaceKind)
  } as unknown as AgentRunEventV13);
}

export function attachLegacyProjectId<T extends { readonly scope: AgentContextScope }>(
  value: T
): T & { readonly projectId: string } {
  if (value.scope.kind === "workspace" && !("projectId" in value)) {
    Object.defineProperty(value, "projectId", {
      configurable: false,
      enumerable: false,
      value: value.scope.workspaceId,
      writable: false
    });
  }
  return value as T & { readonly projectId: string };
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function withoutLegacyProjectId(value: JsonObject): JsonObject {
  const { projectId: _projectId, ...rest } = value;
  void _projectId;
  return rest;
}
