import type { JsonObject, UnifiedError } from "@novel-studio/shared";
import type { ChangeSetFileSelection } from "./change-set.js";
import type { AgentContextSourceInput } from "./context-snapshot.js";

export type AgentOperationMode = "planning" | "execution";
export type AgentContextMode = "writing" | "general_file";
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
  | "cancelled"
  | "failed"
  | "limit_reached";

/** Stage 5 (v1.1) widens the run status with the compaction/plan-revision waits. */
export type AgentRunStatusV11 = AgentRunStatus | "context_compacting" | "awaiting_plan_revision";

export type AgentRunRecoveryState =
  "none" | "retryable" | "awaiting_context_refresh" | "recovery_review" | "terminal";

export interface AgentRunUsageSummary {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedTokens?: number;
  readonly reasoningTokens?: number;
  readonly totalTokens: number;
  readonly usageStatus: "actual" | "estimated" | "missing";
}

export const EMPTY_AGENT_RUN_USAGE_SUMMARY: AgentRunUsageSummary = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  usageStatus: "missing"
};

export interface AgentProviderCapabilitySnapshot {
  readonly profileId: string;
  readonly provider: string;
  readonly modelName: string;
  readonly streaming: true;
  readonly toolCalling: true;
  readonly structuredArguments: true;
  readonly contextWindow: number;
  readonly requiredContextTokens: number;
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
  readonly status: AgentRunStatusV11;
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
}

/**
 * The active run snapshot type consumed across Application/IPC/renderer. Aliased to the v1.1 view:
 * new runs are authored as v1.1 and old v1.0 files are normalized on read.
 */
export type AgentRunSnapshot = AgentRunSnapshotV11;

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

/**
 * The active run event type. Unlike the snapshot, the v1.1 event added no required fields — only
 * new event-type union members — so a persisted v1.0 event is structurally valid here. The alias
 * accepts both versions; `normalizeAgentRunEvent` still lifts persisted events to the v1.1 view.
 */
export type AgentRunEvent = AgentRunEventV10 | AgentRunEventV11;

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
}

export interface RecordAgentRunEventInput {
  readonly runId: string;
  readonly status: AgentRunStatusV11;
  readonly type: AgentRunEventTypeV11;
  readonly detail?: JsonObject;
  readonly snapshotPatch?: AgentRunSnapshotPatch;
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
  readonly projectId: string;
  readonly conversationId: string;
  readonly commandId: string;
  readonly expectedRunRevision: 0;
  readonly runDraftId: string;
  readonly runDraftRevision: number;
  readonly runDraftChecksum: string;
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
  readonly projectId: string;
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
  readonly contextBudgetSnapshotId?: string;
  readonly permissionSummaryId?: string;
  readonly permissionSummaryChecksum?: string;
  readonly planExecutionId?: string;
  readonly planExecutionRevision?: number;
  readonly sourcePlanId?: string;
  readonly sourcePlanRevision?: number;
}

export interface StopAgentRunCommand {
  readonly runId: string;
  readonly projectId: string;
  readonly commandId: string;
  readonly expectedRunRevision: number;
}

export interface ResumeAgentRunCommand {
  readonly runId: string;
  readonly projectId: string;
  readonly commandId: string;
  readonly expectedRunRevision: number;
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
  readonly executionWritePolicy?: AgentWritePolicy;
  readonly executionWritePolicyAcknowledged?: true;
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
  recordTerminalAuditEvent(input: RecordTerminalAgentRunAuditEventInput): AgentRunCommandResult;
  restoreRun(snapshot: AgentRunSnapshot, events: readonly AgentRunEvent[]): AgentRunCommandResult;
  readSnapshot(runId: string): AgentRunSnapshot | undefined;
  readEvents(runId: string): readonly AgentRunEvent[];
}

/**
 * Normalize a persisted run snapshot (v1.0 or v1.1) into the v1.1 internal view. v1.1 records are
 * returned as-is; v1.0 records are backfilled with Stage 5 defaults. This never rewrites disk files.
 */
export function normalizeAgentRunSnapshot(value: JsonObject): AgentRunSnapshotV11 {
  const conversationId =
    typeof value["conversationId"] === "string" ? value["conversationId"] : null;
  if (value["schemaVersion"] === "1.1") {
    return { ...value, conversationId } as unknown as AgentRunSnapshotV11;
  }
  const capability = value["providerCapabilitySnapshot"];
  const modelProfileId =
    isRecord(capability) && typeof capability["profileId"] === "string"
      ? capability["profileId"]
      : "";
  return {
    ...value,
    conversationId,
    schemaVersion: "1.1",
    modelProfileId,
    permissionSummaryId: null,
    permissionSummaryChecksum: null,
    contextBudgetSnapshotId: null,
    activeCompactionId: null,
    planExecutionId: null,
    planExecutionRevision: null,
    activeErrorId: null,
    recoveryState: "none",
    usageSummary: EMPTY_AGENT_RUN_USAGE_SUMMARY
  } as unknown as AgentRunSnapshotV11;
}

/** Normalize a persisted run event (v1.0 or v1.1) into the v1.1 view. */
export function normalizeAgentRunEvent(value: JsonObject): AgentRunEventV11 {
  return value["schemaVersion"] === "1.1"
    ? (value as unknown as AgentRunEventV11)
    : ({ ...value, schemaVersion: "1.1" } as unknown as AgentRunEventV11);
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
