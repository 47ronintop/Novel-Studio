import type { JsonObject, UnifiedError } from "@novel-studio/shared";

export type AgentOperationMode = "planning" | "execution";
export type AgentContextMode = "writing" | "general_file";
export type AgentWritePolicy = "write_before_confirmation" | "user_preapproved_run";
export type AgentRunStatus =
  | "created"
  | "planning_model"
  | "executing_model"
  | "executing_read_tool"
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
  | "user_input_requested"
  | "user_input_resolved"
  | "context_stale"
  | "plan_ready"
  | "run_completed"
  | "run_cancelled"
  | "run_failed"
  | "run_limit_reached";

export interface AgentRunSnapshotPatch {
  readonly pendingUserInputId?: string | null;
  readonly contextSnapshotId?: string | null;
  readonly sourcePlanId?: string | null;
  readonly sourcePlanRevision?: number | null;
}

export interface RecordAgentRunEventInput {
  readonly runId: string;
  readonly status: AgentRunStatus;
  readonly type: AgentRunEventType;
  readonly detail?: JsonObject;
  readonly snapshotPatch?: AgentRunSnapshotPatch;
}

export interface StartAgentRunCommand {
  readonly projectId: string;
  readonly commandId: string;
  readonly expectedRunRevision: 0;
  readonly operationMode: AgentOperationMode;
  readonly contextMode: AgentContextMode;
  readonly writePolicy: AgentWritePolicy;
  readonly userRequest: string;
  readonly providerCapabilitySnapshot: AgentProviderCapabilitySnapshot;
  readonly limits?: Partial<AgentRunLimits>;
}

export interface StopAgentRunCommand {
  readonly runId: string;
  readonly projectId: string;
  readonly commandId: string;
  readonly expectedRunRevision: number;
}

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
  restoreRun(snapshot: AgentRunSnapshot, events: readonly AgentRunEvent[]): AgentRunCommandResult;
  readSnapshot(runId: string): AgentRunSnapshot | undefined;
  readEvents(runId: string): readonly AgentRunEvent[];
}
