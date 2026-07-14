import type { JsonObject, UnifiedError } from "@novel-studio/shared";
import type { ChangeSetFileSelection } from "./change-set.js";
import type { AgentContextSourceInput } from "./context-snapshot.js";

export type AgentOperationMode = "planning" | "execution";
export type AgentContextMode = "writing" | "general_file";
export type AgentWritePolicy = "write_before_confirmation" | "user_preapproved_run";
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

export interface AgentRunSnapshot {
  readonly schemaVersion: "1.0";
  readonly runId: string;
  readonly projectId: string;
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

export interface AgentRunEvent {
  readonly schemaVersion: "1.0";
  readonly runId: string;
  readonly projectId: string;
  readonly sequence: number;
  readonly runRevision: number;
  readonly type: AgentRunEventType;
  readonly createdAt: string;
  readonly detail?: JsonObject;
}

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

export interface AgentRunSnapshotPatch {
  readonly pendingUserInputId?: string | null;
  readonly contextSnapshotId?: string | null;
  readonly sourcePlanId?: string | null;
  readonly sourcePlanRevision?: number | null;
  readonly pendingChangeSetId?: string | null;
  readonly pendingChangeSetRevision?: number | null;
  readonly pendingChangeSetChecksum?: string | null;
  readonly versionGroupId?: string | null;
}

export interface RecordAgentRunEventInput {
  readonly runId: string;
  readonly status: AgentRunStatus;
  readonly type: AgentRunEventType;
  readonly detail?: JsonObject;
  readonly snapshotPatch?: AgentRunSnapshotPatch;
}

export type TerminalAgentRunAuditEventType =
  | "run_undo_started"
  | "run_undo_review_required"
  | "run_undone"
  | "run_undo_failed";

export interface RecordTerminalAgentRunAuditEventInput {
  readonly runId: string;
  readonly type: TerminalAgentRunAuditEventType;
  readonly detail?: JsonObject;
}

export interface StartAgentRunCommand {
  readonly projectId: string;
  readonly commandId: string;
  readonly expectedRunRevision: 0;
  readonly operationMode: AgentOperationMode;
  readonly contextMode: AgentContextMode;
  readonly writePolicy?: AgentWritePolicy;
  readonly writePolicyAcknowledged?: true;
  readonly userRequest: string;
  readonly providerCapabilitySnapshot: AgentProviderCapabilitySnapshot;
  readonly limits?: Partial<AgentRunLimits>;
  readonly initialContextSources?: readonly AgentContextSourceInput[];
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
  startRun(command: StartAgentRunCommand): AgentRunCommandResult;
  stopRun(command: StopAgentRunCommand): AgentRunCommandResult;
  recordRunEvent(input: RecordAgentRunEventInput): AgentRunCommandResult;
  recordTerminalAuditEvent(input: RecordTerminalAgentRunAuditEventInput): AgentRunCommandResult;
  restoreRun(snapshot: AgentRunSnapshot, events: readonly AgentRunEvent[]): AgentRunCommandResult;
  readSnapshot(runId: string): AgentRunSnapshot | undefined;
  readEvents(runId: string): readonly AgentRunEvent[];
}
