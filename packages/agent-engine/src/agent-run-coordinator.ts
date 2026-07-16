import { createUnifiedError } from "@novel-studio/shared";

import { EMPTY_AGENT_RUN_USAGE_SUMMARY } from "./agent-run-types.js";
import type {
  AgentRunCommandResult,
  AgentRunCoordinator,
  AgentRunEvent,
  AgentRunLimits,
  AgentRunSnapshot
} from "./agent-run-types.js";

export interface AgentRunCoordinatorOptions {
  readonly now?: () => string;
  readonly createRunId?: () => string;
}

const defaultLimits: AgentRunLimits = {
  maxModelRounds: 20,
  maxToolCalls: 50,
  maxConsecutiveToolFailures: 3
};

export function createAgentRunCoordinator(
  options: AgentRunCoordinatorOptions = {}
): AgentRunCoordinator {
  const now = options.now ?? (() => new Date().toISOString());
  const createRunId = options.createRunId ?? createDefaultRunId;
  const runs = new Map<string, AgentRunSnapshot>();
  const events = new Map<string, AgentRunEvent[]>();
  const activeRunByProject = new Map<string, string>();
  const commandReceipts = new Map<string, AgentRunCommandResult>();

  return {
    startRun(command) {
      const receiptKey = commandReceiptKey(command.projectId, command.commandId);
      const receipt = commandReceipts.get(receiptKey);
      if (receipt !== undefined) {
        return receipt;
      }
      if (!isSafeId(command.conversationId)) {
        const result = failure(
          "AGENT_CONVERSATION_ID_INVALID",
          "A new Agent run requires a valid conversation identifier."
        );
        commandReceipts.set(receiptKey, result);
        return result;
      }
      const activeRunId = activeRunByProject.get(command.projectId);
      if (activeRunId !== undefined) {
        const result = failure("AGENT_RUN_ALREADY_ACTIVE", "An Agent run is already active.");
        commandReceipts.set(receiptKey, result);
        return result;
      }
      if (command.expectedRunRevision !== 0) {
        const result = failure(
          "AGENT_RUN_REVISION_CONFLICT",
          "A new Agent run must start at revision zero."
        );
        commandReceipts.set(receiptKey, result);
        return result;
      }
      const writePolicy: unknown =
        command.writePolicy === undefined
          ? "write_before_confirmation"
          : command.writePolicy;
      if (
        writePolicy !== "write_before_confirmation" &&
        writePolicy !== "user_preapproved_run"
      ) {
        const result = failure(
          "AGENT_WRITE_POLICY_INVALID",
          "The requested Agent write policy is not supported."
        );
        commandReceipts.set(receiptKey, result);
        return result;
      }
      if (
        writePolicy === "user_preapproved_run" &&
        command.operationMode !== "execution"
      ) {
        const result = failure(
          "AGENT_WRITE_POLICY_NOT_AVAILABLE",
          "Automatic writes are available only for execution runs."
        );
        commandReceipts.set(receiptKey, result);
        return result;
      }
      if (
        writePolicy === "user_preapproved_run" &&
        command.writePolicyAcknowledged !== true
      ) {
        const result = failure(
          "AGENT_WRITE_POLICY_ACK_REQUIRED",
          "Automatic writes require an explicit acknowledgement for this run."
        );
        commandReceipts.set(receiptKey, result);
        return result;
      }

      const timestamp = now();
      const runId = createRunId();
      const snapshot: AgentRunSnapshot = {
        schemaVersion: "1.1",
        runId,
        projectId: command.projectId,
        conversationId: command.conversationId,
        operationMode: command.operationMode,
        contextMode: command.contextMode,
        writePolicy,
        userRequest: command.userRequest,
        status: command.operationMode === "planning" ? "planning_model" : "executing_model",
        runRevision: 1,
        lastSequence: 1,
        startedAt: timestamp,
        updatedAt: timestamp,
        limits: { ...defaultLimits, ...command.limits },
        providerCapabilitySnapshot: command.providerCapabilitySnapshot,
        pendingUserInputId: null,
        contextSnapshotId: null,
        sourcePlanId: command.sourcePlanId ?? null,
        sourcePlanRevision: command.sourcePlanRevision ?? null,
        modelProfileId: command.providerCapabilitySnapshot.profileId,
        ...(command.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: command.reasoningEffort }),
        permissionSummaryId: null,
        permissionSummaryChecksum: null,
        contextBudgetSnapshotId: command.contextBudgetSnapshotId ?? null,
        activeCompactionId: null,
        planExecutionId: null,
        planExecutionRevision: null,
        activeErrorId: null,
        recoveryState: "none",
        usageSummary: EMPTY_AGENT_RUN_USAGE_SUMMARY
      };
      runs.set(runId, snapshot);
      activeRunByProject.set(command.projectId, runId);
      events.set(runId, [toEvent(snapshot, "run_started", timestamp)]);
      const result = { ok: true as const, value: snapshot };
      commandReceipts.set(receiptKey, result);
      return result;
    },
    stopRun(command) {
      const receiptKey = commandReceiptKey(command.projectId, command.commandId);
      const receipt = commandReceipts.get(receiptKey);
      if (receipt !== undefined) {
        return receipt;
      }
      const snapshot = runs.get(command.runId);
      if (snapshot === undefined || snapshot.projectId !== command.projectId) {
        const result = failure("AGENT_RUN_NOT_FOUND", "The Agent run does not exist.");
        commandReceipts.set(receiptKey, result);
        return result;
      }
      if (snapshot.runRevision !== command.expectedRunRevision) {
        const result: AgentRunCommandResult = {
          ok: false,
          error: createCoordinatorError(
            "AGENT_RUN_REVISION_CONFLICT",
            "The Agent run revision is stale."
          ),
          latestSnapshot: snapshot
        };
        commandReceipts.set(receiptKey, result);
        return result;
      }
      if (isTerminal(snapshot.status)) {
        const result = failure("AGENT_RUN_ALREADY_TERMINAL", "The Agent run has already ended.");
        commandReceipts.set(receiptKey, result);
        return result;
      }

      const timestamp = now();
      const stopped: AgentRunSnapshot = {
        ...snapshot,
        status: "cancelled",
        runRevision: snapshot.runRevision + 1,
        lastSequence: snapshot.lastSequence + 1,
        updatedAt: timestamp
      };
      runs.set(stopped.runId, stopped);
      activeRunByProject.delete(stopped.projectId);
      events.get(stopped.runId)?.push(toEvent(stopped, "run_cancelled", timestamp));
      const result = { ok: true as const, value: stopped };
      commandReceipts.set(receiptKey, result);
      return result;
    },
    recordRunEvent(input) {
      const snapshot = runs.get(input.runId);
      if (snapshot === undefined) {
        return failure("AGENT_RUN_NOT_FOUND", "The Agent run does not exist.");
      }
      if (isTerminal(snapshot.status)) {
        return failure("AGENT_RUN_ALREADY_TERMINAL", "The Agent run has already ended.");
      }
      const timestamp = now();
      const next: AgentRunSnapshot = {
        ...snapshot,
        ...input.snapshotPatch,
        status: input.status,
        runRevision: snapshot.runRevision + 1,
        lastSequence: snapshot.lastSequence + 1,
        updatedAt: timestamp
      };
      runs.set(next.runId, next);
      if (isTerminal(next.status)) {
        activeRunByProject.delete(next.projectId);
      }
      events.get(next.runId)?.push({
        ...toEvent(next, input.type, timestamp),
        ...(input.detail === undefined ? {} : { detail: input.detail })
      });
      return { ok: true, value: next };
    },
    recordTerminalAuditEvent(input) {
      const snapshot = runs.get(input.runId);
      if (snapshot === undefined) {
        return failure("AGENT_RUN_NOT_FOUND", "The Agent run does not exist.");
      }
      if (!isTerminal(snapshot.status)) {
        return failure(
          "AGENT_RUN_NOT_TERMINAL",
          "Terminal audit events require an Agent run that has already ended."
        );
      }
      if (!isTerminalAuditEventType(input.type)) {
        return failure(
          "AGENT_RUN_AUDIT_EVENT_INVALID",
          "The event is not allowed after an Agent run has ended."
        );
      }
      const timestamp = now();
      const next: AgentRunSnapshot = {
        ...snapshot,
        runRevision: snapshot.runRevision + 1,
        lastSequence: snapshot.lastSequence + 1,
        updatedAt: timestamp
      };
      runs.set(next.runId, next);
      events.get(next.runId)?.push({
        ...toEvent(next, input.type, timestamp),
        ...(input.detail === undefined ? {} : { detail: input.detail })
      });
      return { ok: true, value: next };
    },
    restoreRun(snapshot, restoredEvents) {
      const existing = runs.get(snapshot.runId);
      if (existing !== undefined) return { ok: true, value: existing };
      const persistedWritePolicy: unknown = snapshot.writePolicy;
      if (
        persistedWritePolicy !== undefined &&
        persistedWritePolicy !== "write_before_confirmation" &&
        persistedWritePolicy !== "user_preapproved_run"
      ) {
        return failure(
          "AGENT_WRITE_POLICY_INVALID",
          "The persisted Agent write policy is not supported."
        );
      }
      const lastEvent = restoredEvents.at(-1);
      if (
        lastEvent === undefined ||
        lastEvent.runId !== snapshot.runId ||
        lastEvent.sequence !== snapshot.lastSequence ||
        lastEvent.runRevision !== snapshot.runRevision
      ) {
        return failure("AGENT_RUN_RESTORE_INVALID", "The persisted Agent run is inconsistent.");
      }
      const activeRunId = activeRunByProject.get(snapshot.projectId);
      if (activeRunId !== undefined && !isTerminal(snapshot.status)) {
        return failure("AGENT_RUN_ALREADY_ACTIVE", "An Agent run is already active.");
      }
      const restoredSnapshot: AgentRunSnapshot = {
        ...snapshot,
        conversationId:
          typeof snapshot.conversationId === "string" ? snapshot.conversationId : null,
        writePolicy: "write_before_confirmation"
      };
      runs.set(restoredSnapshot.runId, restoredSnapshot);
      events.set(snapshot.runId, [...restoredEvents]);
      if (!isTerminal(restoredSnapshot.status)) {
        activeRunByProject.set(restoredSnapshot.projectId, restoredSnapshot.runId);
      }
      return { ok: true, value: restoredSnapshot };
    },
    readSnapshot(runId) {
      return runs.get(runId);
    },
    readEvents(runId) {
      return events.get(runId) ?? [];
    }
  };
}

function toEvent(
  snapshot: AgentRunSnapshot,
  type: AgentRunEvent["type"],
  createdAt: string
): AgentRunEvent {
  return {
    schemaVersion: "1.1",
    runId: snapshot.runId,
    projectId: snapshot.projectId,
    sequence: snapshot.lastSequence,
    runRevision: snapshot.runRevision,
    type,
    createdAt
  };
}

function failure(code: string, message: string): AgentRunCommandResult {
  return {
    ok: false,
    error: createCoordinatorError(code, message)
  };
}

function createCoordinatorError(code: string, message: string) {
  return createUnifiedError({
    code,
    category: "AgentError",
    message,
    recoverability: "user-action",
    suggestedAction: "Refresh the current Agent run snapshot and retry.",
    traceId: "agent-run-coordinator"
  });
}

function commandReceiptKey(projectId: string, commandId: string): string {
  return `${projectId}:${commandId}`;
}

function isTerminal(status: AgentRunSnapshot["status"]): boolean {
  return (
    status === "completed" ||
    status === "cancelled" ||
    status === "failed" ||
    status === "limit_reached"
  );
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(value);
}

function isTerminalAuditEventType(type: AgentRunEvent["type"]): boolean {
  return (
    type === "run_undo_started" ||
    type === "run_undo_review_required" ||
    type === "run_undone" ||
    type === "run_undo_failed"
  );
}

let runSequence = 0;

function createDefaultRunId(): string {
  runSequence += 1;
  return `agent_run_${Date.now().toString(36)}_${runSequence.toString(36)}`;
}
