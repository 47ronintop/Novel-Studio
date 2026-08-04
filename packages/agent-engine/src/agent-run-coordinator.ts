import { createUnifiedError, type JsonObject, type UnifiedError } from "@novel-studio/shared";
import { isDeepStrictEqual } from "node:util";

import {
  attachLegacyProjectId,
  EMPTY_AGENT_RUN_USAGE_SUMMARY,
  NO_AGENT_PROMPT_CACHE_CAPABILITY
} from "./agent-run-types.js";
import { agentContextScopeKey, type AgentContextScope } from "./agent-context-scope.js";
import { agentRunToolCatalogSnapshotId } from "./agent-run-tool-catalog.js";
import {
  parseFinishEvidenceRef,
  validateFinishForRun,
  type FinishEvidenceRef,
  type FinishInputV2,
  type FinishReportV2
} from "./finish-report.js";
import {
  agentRunEventRefV20,
  validateAgentRunHistoryV20,
  validateAgentRunSnapshotV20,
  validateAgentRunStatePairV20,
  validateAgentRunV20StartFacts,
  type AgentRunEventTypeV20,
  type AgentRunEventV20,
  type AgentRunPendingV20,
  type AgentRunSnapshotV20
} from "./agent-run-v20.js";
import type {
  AgentPromptCacheCapabilitySnapshot,
  AgentRunCommandResult,
  AgentRunCoordinator,
  AgentRunEvent,
  AgentRunEventTypeV13,
  AgentRunLimits,
  AgentRunSnapshot,
  AgentRunSnapshotV13,
  RecordAgentRunEventInput,
  ResolvedAgentRunStartInput
} from "./agent-run-types.js";
import type { RecordAgentRunFinishInput } from "./agent-run-types.js";

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
  const activeRunByScope = new Map<string, string>();
  const commandReceipts = new Map<string, AgentRunCommandResult>();

  return {
    startRun(command) {
      const scope = resolveCommandScope(command);
      if (scope === undefined) {
        return failure("AGENT_CONTEXT_SCOPE_INVALID", "The Agent run scope is invalid.");
      }
      const scopeKey = agentContextScopeKey(scope);
      const receiptKey = commandReceiptKey(scopeKey, command.commandId);
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
      const activeRunId = activeRunByScope.get(scopeKey);
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
        command.writePolicy === undefined ? "write_before_confirmation" : command.writePolicy;
      if (writePolicy !== "write_before_confirmation" && writePolicy !== "user_preapproved_run") {
        const result = failure(
          "AGENT_WRITE_POLICY_INVALID",
          "The requested Agent write policy is not supported."
        );
        commandReceipts.set(receiptKey, result);
        return result;
      }
      if (writePolicy === "user_preapproved_run" && command.operationMode !== "execution") {
        const result = failure(
          "AGENT_WRITE_POLICY_NOT_AVAILABLE",
          "Automatic writes are available only for execution runs."
        );
        commandReceipts.set(receiptKey, result);
        return result;
      }
      if (writePolicy === "user_preapproved_run" && command.writePolicyAcknowledged !== true) {
        const result = failure(
          "AGENT_WRITE_POLICY_ACK_REQUIRED",
          "Automatic writes require an explicit acknowledgement for this run."
        );
        commandReceipts.set(receiptKey, result);
        return result;
      }

      const timestamp = now();
      const runId = createRunId();
      const promptCache =
        command.providerCapabilitySnapshot.promptCache ?? NO_AGENT_PROMPT_CACHE_CAPABILITY;
      if (
        promptCache.mode !== "none" &&
        (!isChecksum(command.promptCacheIdentityBaseChecksum) ||
          !isChecksum(command.promptCacheIdentityChecksum) ||
          typeof command.promptCacheArtifactId !== "string" ||
          !Number.isSafeInteger(command.promptCacheStablePrefixMessageCount) ||
          Number(command.promptCacheStablePrefixMessageCount) < 1 ||
          command.promptCachePolicyVersion !== promptCache.policyVersion)
      ) {
        const result = failure(
          "AGENT_PROMPT_CACHE_IDENTITY_INVALID",
          "The frozen prompt cache identity is invalid."
        );
        commandReceipts.set(receiptKey, result);
        return result;
      }
      const created = createInitialSnapshot({
        command,
        scope,
        runId,
        timestamp,
        promptCache,
        writePolicy
      });
      if (!created.ok) {
        commandReceipts.set(receiptKey, created);
        return created;
      }
      const snapshot = created.value;
      const startedEvent = toEvent(snapshot, "run_started", timestamp);
      if (snapshot.schemaVersion === "2.0") {
        const pair = validateAgentRunStatePairV20({ snapshot, event: startedEvent });
        if (!pair.ok) {
          const result: AgentRunCommandResult = { ok: false, error: pair.error };
          commandReceipts.set(receiptKey, result);
          return result;
        }
      }
      runs.set(runId, snapshot);
      activeRunByScope.set(scopeKey, runId);
      events.set(runId, [startedEvent]);
      const result = { ok: true as const, value: snapshot };
      commandReceipts.set(receiptKey, result);
      return result;
    },
    stopRun(command) {
      const scope = resolveCommandScope(command);
      if (scope === undefined) {
        return failure("AGENT_CONTEXT_SCOPE_INVALID", "The Agent run scope is invalid.");
      }
      const receiptKey = commandReceiptKey(
        `${command.runId}:${agentContextScopeKey(scope)}`,
        command.commandId
      );
      const receipt = commandReceipts.get(receiptKey);
      if (receipt !== undefined) {
        return receipt;
      }
      const snapshot = runs.get(command.runId);
      if (
        snapshot === undefined ||
        agentContextScopeKey(snapshot.scope) !== agentContextScopeKey(scope)
      ) {
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
      if (isAbsorbing(snapshot)) {
        const result = failure("AGENT_RUN_ALREADY_TERMINAL", "The Agent run has already ended.");
        commandReceipts.set(receiptKey, result);
        return result;
      }

      const timestamp = now();
      const transitioned = transitionRunState(
        snapshot,
        {
          runId: snapshot.runId,
          status: "cancelled",
          type: "run_cancelled"
        },
        timestamp
      );
      if (!transitioned.ok) {
        const result: AgentRunCommandResult = {
          ok: false,
          error: transitioned.error,
          latestSnapshot: snapshot
        };
        commandReceipts.set(receiptKey, result);
        return result;
      }
      const stopped = transitioned.value.snapshot;
      runs.set(stopped.runId, stopped);
      activeRunByScope.delete(agentContextScopeKey(stopped.scope));
      events.get(stopped.runId)?.push(transitioned.value.event);
      const result = { ok: true as const, value: stopped };
      commandReceipts.set(receiptKey, result);
      return result;
    },
    recordRunEvent(input) {
      const snapshot = runs.get(input.runId);
      if (snapshot === undefined) {
        return failure("AGENT_RUN_NOT_FOUND", "The Agent run does not exist.");
      }
      if (isAbsorbing(snapshot)) {
        return failure("AGENT_RUN_ALREADY_TERMINAL", "The Agent run has already ended.");
      }
      if (
        (snapshot.schemaVersion === "2.0" || isStrictExecutionRun(snapshot)) &&
        (input.status === "completed" ||
          input.status === "blocked" ||
          input.type === "run_completed" ||
          input.type === "run_blocked" ||
          input.snapshotPatch?.finishReport !== undefined)
      ) {
        return failure(
          "AGENT_FINISH_REQUIRED",
          "Strict execution terminals must be recorded through their dedicated coordinator commands."
        );
      }
      if (
        (input.status === "blocked" || input.type === "run_blocked") &&
        input.snapshotPatch?.finishReport === undefined
      ) {
        return failure(
          "AGENT_FINISH_REQUIRED",
          "Blocked terminal state must be recorded with a structured finish report."
        );
      }
      if (
        snapshot.finishContractVersion === "2.0" &&
        snapshot.operationMode === "execution" &&
        (input.status === "completed" || input.status === "blocked")
      ) {
        return failure(
          "AGENT_FINISH_REQUIRED",
          "Structured execution completion must be recorded through recordFinish."
        );
      }
      const timestamp = now();
      const transitioned = transitionRunState(snapshot, input, timestamp);
      if (!transitioned.ok) {
        return { ok: false, error: transitioned.error, latestSnapshot: snapshot };
      }
      const next = transitioned.value.snapshot;
      runs.set(next.runId, next);
      if (isAbsorbing(next)) {
        activeRunByScope.delete(agentContextScopeKey(next.scope));
      }
      events.get(next.runId)?.push(transitioned.value.event);
      return { ok: true, value: next };
    },
    recordFinish(input: RecordAgentRunFinishInput) {
      const snapshot = runs.get(input.runId);
      if (snapshot === undefined) {
        return failure("AGENT_RUN_NOT_FOUND", "The Agent run does not exist.");
      }
      const receiptKey = commandReceiptKey(
        `${input.runId}:${agentContextScopeKey(snapshot.scope)}`,
        input.commandId
      );
      const receipt = commandReceipts.get(receiptKey);
      if (receipt !== undefined) return receipt;
      if (
        input.scope !== undefined &&
        agentContextScopeKey(input.scope) !== agentContextScopeKey(snapshot.scope)
      ) {
        const result = failure("AGENT_CONTEXT_SCOPE_INVALID", "The Agent run scope is invalid.");
        commandReceipts.set(receiptKey, result);
        return result;
      }
      if (
        input.projectId !== undefined &&
        (snapshot.scope.kind !== "workspace" || input.projectId !== snapshot.scope.workspaceId)
      ) {
        const result = failure("AGENT_CONTEXT_SCOPE_INVALID", "The Agent run project is invalid.");
        commandReceipts.set(receiptKey, result);
        return result;
      }
      if (snapshot.runRevision !== input.expectedRunRevision) {
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
      if (isAbsorbing(snapshot)) {
        const result = failure("AGENT_RUN_ALREADY_TERMINAL", "The Agent run has already ended.");
        commandReceipts.set(receiptKey, result);
        return result;
      }
      const validated = validateFinishForRun(input.finishReport, snapshot);
      if (!validated.ok) {
        const result: AgentRunCommandResult = {
          ok: false,
          error: validated.error,
          latestSnapshot: snapshot
        };
        commandReceipts.set(receiptKey, result);
        return result;
      }
      const evidence = validateFinishEvidence(validated.value, events.get(input.runId) ?? []);
      if (!evidence.ok) {
        const result: AgentRunCommandResult = {
          ok: false,
          error: evidence.error,
          latestSnapshot: snapshot
        };
        commandReceipts.set(receiptKey, result);
        return result;
      }
      const timestamp = now();
      const persistedReport: FinishReportV2 = {
        ...validated.value,
        schemaVersion: "2.0"
      };
      const transitioned = transitionRunFinish(snapshot, persistedReport, timestamp);
      if (!transitioned.ok) {
        const result: AgentRunCommandResult = {
          ok: false,
          error: transitioned.error,
          latestSnapshot: snapshot
        };
        commandReceipts.set(receiptKey, result);
        return result;
      }
      const next = transitioned.value.snapshot;
      runs.set(next.runId, next);
      activeRunByScope.delete(agentContextScopeKey(next.scope));
      events.get(next.runId)?.push(transitioned.value.event);
      const result = { ok: true as const, value: next };
      commandReceipts.set(receiptKey, result);
      return result;
    },
    recordTerminalAuditEvent(input) {
      const snapshot = runs.get(input.runId);
      if (snapshot === undefined) {
        return failure("AGENT_RUN_NOT_FOUND", "The Agent run does not exist.");
      }
      if (!isTerminal(snapshot.status) && snapshot.status !== "capability_changed") {
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
      const transitioned = transitionRunState(
        snapshot,
        {
          runId: snapshot.runId,
          status: snapshot.status,
          type: input.type,
          ...(input.detail === undefined ? {} : { detail: input.detail })
        },
        timestamp
      );
      if (!transitioned.ok) {
        return { ok: false, error: transitioned.error, latestSnapshot: snapshot };
      }
      const next = transitioned.value.snapshot;
      runs.set(next.runId, next);
      events.get(next.runId)?.push(transitioned.value.event);
      return { ok: true, value: next };
    },
    restoreRun(snapshot, restoredEvents) {
      const existing = runs.get(snapshot.runId);
      if (existing !== undefined) return { ok: true, value: existing };
      if (snapshot.schemaVersion === "2.0") {
        const restored = validateAgentRunHistoryV20({ snapshot, events: restoredEvents });
        if (!restored.ok) {
          return failure("AGENT_RUN_RESTORE_INVALID", "The persisted Agent run is inconsistent.");
        }
        const activeRunId = activeRunByScope.get(
          agentContextScopeKey(restored.value.snapshot.scope)
        );
        if (activeRunId !== undefined && !isAbsorbing(restored.value.snapshot)) {
          return failure("AGENT_RUN_ALREADY_ACTIVE", "An Agent run is already active.");
        }
        runs.set(restored.value.snapshot.runId, restored.value.snapshot);
        events.set(restored.value.snapshot.runId, [...restored.value.events]);
        if (!isAbsorbing(restored.value.snapshot)) {
          activeRunByScope.set(
            agentContextScopeKey(restored.value.snapshot.scope),
            restored.value.snapshot.runId
          );
        }
        return { ok: true, value: restored.value.snapshot };
      }
      if (restoredEvents.some((event) => event.schemaVersion === "2.0")) {
        return failure("AGENT_RUN_RESTORE_INVALID", "The persisted Agent run is inconsistent.");
      }
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
      if (!hasConsistentStrictFinish(snapshot, lastEvent, restoredEvents)) {
        return failure(
          "AGENT_RUN_RESTORE_INVALID",
          "The persisted Agent finish report does not match its terminal state."
        );
      }
      const activeRunId = activeRunByScope.get(agentContextScopeKey(snapshot.scope));
      if (activeRunId !== undefined && !isTerminal(snapshot.status)) {
        return failure("AGENT_RUN_ALREADY_ACTIVE", "An Agent run is already active.");
      }
      const restoredSnapshot = attachLegacyProjectId({
        ...snapshot,
        conversationId:
          typeof snapshot.conversationId === "string" ? snapshot.conversationId : null,
        writePolicy: "write_before_confirmation"
      } as Omit<AgentRunSnapshotV13, "projectId">);
      runs.set(restoredSnapshot.runId, restoredSnapshot);
      events.set(snapshot.runId, [...restoredEvents]);
      if (!isTerminal(restoredSnapshot.status)) {
        activeRunByScope.set(agentContextScopeKey(restoredSnapshot.scope), restoredSnapshot.runId);
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

type SnapshotResult =
  | { readonly ok: true; readonly value: AgentRunSnapshot }
  | { readonly ok: false; readonly error: UnifiedError };

type TransitionResult =
  | {
      readonly ok: true;
      readonly value: { readonly snapshot: AgentRunSnapshot; readonly event: AgentRunEvent };
    }
  | { readonly ok: false; readonly error: UnifiedError };

function createInitialSnapshot(input: {
  readonly command: ResolvedAgentRunStartInput;
  readonly scope: AgentContextScope;
  readonly runId: string;
  readonly timestamp: string;
  readonly promptCache: AgentPromptCacheCapabilitySnapshot;
  readonly writePolicy: "write_before_confirmation" | "user_preapproved_run";
}): SnapshotResult {
  const { command, scope, runId, timestamp, promptCache, writePolicy } = input;
  const status =
    command.operationMode === "conversation"
      ? "conversation_model"
      : command.operationMode === "planning"
        ? "planning_model"
        : "executing_model";
  const contextProfileId =
    command.contextProfileId ??
    (scope.kind === "standalone"
      ? "standalone"
      : scope.workspaceKind === "engineeringWorkspace"
        ? "engineering"
        : command.contextMode === "writing"
          ? "writing"
          : "creative_general");
  const providerCapabilitySnapshot = {
    ...command.providerCapabilitySnapshot,
    promptCache
  };

  if (command.runV20 === undefined) {
    const snapshot = attachLegacyProjectId({
      schemaVersion: "1.3",
      runId,
      scope,
      conversationId: command.conversationId,
      operationMode: command.operationMode,
      contextMode: command.contextMode,
      writePolicy,
      userRequest: command.userRequest,
      status,
      runRevision: 1,
      lastSequence: 1,
      startedAt: timestamp,
      updatedAt: timestamp,
      limits: { ...defaultLimits, ...command.limits },
      providerCapabilitySnapshot,
      pendingUserInputId: null,
      contextSnapshotId: null,
      sourcePlanId: command.sourcePlanId ?? null,
      sourcePlanRevision: command.sourcePlanRevision ?? null,
      modelProfileId: command.providerCapabilitySnapshot.profileId,
      ...(command.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: command.reasoningEffort }),
      permissionSummaryId: command.permissionSummaryId ?? null,
      permissionSummaryChecksum: command.permissionSummaryChecksum ?? null,
      contextBudgetSnapshotId: command.contextBudgetSnapshotId ?? null,
      activeCompactionId: null,
      planExecutionId: command.planExecutionId ?? null,
      planExecutionRevision: command.planExecutionRevision ?? null,
      activeErrorId: null,
      recoveryState: "none",
      usageSummary: EMPTY_AGENT_RUN_USAGE_SUMMARY,
      toolFacadeVersion: command.toolFacadeVersion ?? "v1",
      toolCatalogSnapshotId:
        command.toolFacadeVersion === "v2" && command.toolCatalogRevision !== undefined
          ? agentRunToolCatalogSnapshotId(runId)
          : null,
      toolCatalogRevision: command.toolCatalogRevision ?? null,
      ...(command.finishContractVersion === "2.0" ? { finishContractVersion: "2.0" as const } : {}),
      pendingToolApproval: null,
      contextProfileId,
      profileVersion: command.profileVersion ?? "1.0",
      guidanceTemplateChecksum: command.guidanceTemplateChecksum ?? "legacy",
      conventionsArtifactId: command.conventionsArtifactId ?? null,
      promptCachePolicyVersion: promptCache.policyVersion,
      cachePrefixChecksum: command.cachePrefixChecksum ?? "legacy",
      promptCacheArtifactId: command.promptCacheArtifactId ?? null,
      promptCacheIdentityBaseChecksum: command.promptCacheIdentityBaseChecksum ?? "legacy",
      promptCacheIdentityChecksum: command.promptCacheIdentityChecksum ?? "legacy",
      promptCacheStablePrefixMessageCount: command.promptCacheStablePrefixMessageCount ?? 0
    } as Omit<AgentRunSnapshotV13, "projectId">);
    return { ok: true, value: snapshot };
  }

  const facts = validateAgentRunV20StartFacts(command.runV20);
  if (!facts.ok) return { ok: false, error: facts.error };
  if (
    command.toolFacadeVersion !== "v2" ||
    !isNonEmptyText(command.toolCatalogRevision) ||
    !isChecksum(command.guidanceTemplateChecksum) ||
    !isChecksum(command.cachePrefixChecksum) ||
    !isChecksum(command.promptCacheIdentityBaseChecksum) ||
    !isChecksum(command.promptCacheIdentityChecksum)
  ) {
    return {
      ok: false,
      error: createCoordinatorError(
        "AGENT_RUN_V20_START_INVALID",
        "A strict Agent run requires frozen catalog, guidance, and prompt identity facts."
      )
    };
  }
  if (command.operationMode === "planning" && facts.value.executionWritePolicyDraft === undefined) {
    return {
      ok: false,
      error: createCoordinatorError(
        "AGENT_RUN_V20_EXECUTION_POLICY_DRAFT_REQUIRED",
        "A strict planning run requires an app-owned future execution policy draft."
      )
    };
  }

  const raw: Omit<AgentRunSnapshotV20, "projectId"> = {
    schemaVersion: "2.0",
    runId,
    scope,
    conversationId: command.conversationId,
    operationMode: command.operationMode,
    contextMode: command.contextMode,
    writePolicy,
    userRequest: command.userRequest,
    status,
    runRevision: 1,
    lastSequence: 1,
    startedAt: timestamp,
    updatedAt: timestamp,
    limits: { ...defaultLimits, ...command.limits },
    providerCapabilitySnapshot,
    pendingUserInputId: null,
    contextSnapshotId: null,
    sourcePlanId: command.sourcePlanId ?? null,
    sourcePlanRevision: command.sourcePlanRevision ?? null,
    pendingChangeSetId: null,
    pendingChangeSetRevision: null,
    pendingChangeSetChecksum: null,
    versionGroupId: null,
    modelProfileId: command.providerCapabilitySnapshot.profileId,
    ...(command.reasoningEffort === undefined ? {} : { reasoningEffort: command.reasoningEffort }),
    permissionSummaryId: command.permissionSummaryId ?? null,
    permissionSummaryChecksum: command.permissionSummaryChecksum ?? null,
    contextBudgetSnapshotId: command.contextBudgetSnapshotId ?? null,
    activeCompactionId: null,
    planExecutionId: command.planExecutionId ?? null,
    planExecutionRevision: command.planExecutionRevision ?? null,
    activeErrorId: null,
    recoveryState: "none",
    usageSummary: EMPTY_AGENT_RUN_USAGE_SUMMARY,
    toolFacadeVersion: "v2",
    toolCatalogSnapshotId: agentRunToolCatalogSnapshotId(runId),
    toolCatalogRevision: command.toolCatalogRevision,
    pendingToolApproval: null,
    contextProfileId,
    profileVersion: command.profileVersion ?? "1.0",
    guidanceTemplateChecksum: command.guidanceTemplateChecksum,
    conventionsArtifactId: command.conventionsArtifactId ?? null,
    promptCachePolicyVersion: promptCache.policyVersion,
    cachePrefixChecksum: command.cachePrefixChecksum,
    promptCacheArtifactId: command.promptCacheArtifactId ?? null,
    promptCacheIdentityBaseChecksum: command.promptCacheIdentityBaseChecksum,
    promptCacheIdentityChecksum: command.promptCacheIdentityChecksum,
    promptCacheStablePrefixMessageCount: command.promptCacheStablePrefixMessageCount ?? 0,
    finishContractVersion: "2.0",
    finishReport: null,
    executionWritePolicyDraft: facts.value.executionWritePolicyDraft ?? "write_before_confirmation",
    providerSemanticVersionSetChecksum: facts.value.providerSemanticVersionSetChecksum,
    authority: {
      contractVersion: "2.0",
      registryKey: facts.value.authorityRegistryKey,
      guidanceChecksum: facts.value.materializedGuidanceChecksum
    },
    protocol: {
      contractVersion: "2.0",
      finishContractVersion: "2.0",
      pendingContractVersion: "2.0"
    },
    catalog: {
      contractVersion: "2.0",
      facadeVersion: "v2",
      snapshotId: agentRunToolCatalogSnapshotId(runId),
      revision: command.toolCatalogRevision,
      checksum: facts.value.toolCatalogChecksum
    },
    capabilities: {
      contractVersion: "2.0",
      revision: facts.value.effectiveCapabilityRevision,
      state: "active",
      changeReason: null
    },
    pending: { kind: "none" },
    finish: { state: "not_finished", report: null },
    usageId: null
  };
  const validated = validateAgentRunSnapshotV20(raw);
  return validated.ok
    ? { ok: true, value: validated.value }
    : { ok: false, error: validated.error };
}

function transitionRunState(
  snapshot: AgentRunSnapshot,
  input: RecordAgentRunEventInput,
  timestamp: string
): TransitionResult {
  if (snapshot.schemaVersion !== "2.0") {
    if (
      !isLegacyStatus(input.status) ||
      !isLegacyEventType(input.type) ||
      input.snapshotPatch?.usageId !== undefined
    ) {
      return {
        ok: false,
        error: createCoordinatorError(
          "AGENT_RUN_EVENT_VERSION_INVALID",
          "A legacy Agent run cannot accept a strict 2.0 state or event."
        )
      };
    }
    const next = attachLegacyProjectId({
      ...snapshot,
      ...input.snapshotPatch,
      status: input.status,
      runRevision: snapshot.runRevision + 1,
      lastSequence: snapshot.lastSequence + 1,
      updatedAt: timestamp
    } as Omit<AgentRunSnapshotV13, "projectId">);
    return {
      ok: true,
      value: { snapshot: next, event: toEvent(next, input.type, timestamp, input.detail) }
    };
  }

  if (
    input.snapshotPatch?.toolFacadeVersion !== undefined ||
    input.snapshotPatch?.toolCatalogSnapshotId !== undefined ||
    input.snapshotPatch?.toolCatalogRevision !== undefined ||
    input.snapshotPatch?.finishReport !== undefined
  ) {
    return {
      ok: false,
      error: createCoordinatorError(
        "AGENT_RUN_V20_IMMUTABLE_FIELD",
        "A strict Agent run transition cannot rewrite frozen catalog or finish authority."
      )
    };
  }

  const boundary = isTerminal(input.status) || input.status === "capability_changed";
  const flat = {
    ...snapshot,
    ...input.snapshotPatch,
    status: input.status,
    runRevision: snapshot.runRevision + 1,
    lastSequence: snapshot.lastSequence + 1,
    updatedAt: timestamp,
    ...(boundary
      ? {
          pendingUserInputId: null,
          pendingChangeSetId: null,
          pendingChangeSetRevision: null,
          pendingChangeSetChecksum: null,
          pendingToolApproval: null
        }
      : {})
  } as AgentRunSnapshotV20;
  const pending = deriveV20Pending(snapshot, flat, input);
  if (pending === undefined) {
    return {
      ok: false,
      error: createCoordinatorError(
        "AGENT_RUN_V20_PENDING_INVALID",
        "The strict Agent run pending transition is incomplete or inconsistent."
      )
    };
  }
  let capabilities = snapshot.capabilities;
  if (input.type === "capability_changed") {
    const revision = input.detail?.["effectiveCapabilityRevision"];
    const reason = input.detail?.["reason"];
    if (
      !Number.isSafeInteger(revision) ||
      Number(revision) <= snapshot.capabilities.revision ||
      !isNonEmptyText(reason)
    ) {
      return {
        ok: false,
        error: createCoordinatorError(
          "AGENT_RUN_V20_CAPABILITY_CHANGE_INVALID",
          "A capability boundary requires a newer revision and a stable reason."
        )
      };
    }
    capabilities = {
      contractVersion: "2.0",
      revision: Number(revision),
      state: "capability_changed",
      changeReason: reason
    };
  }
  const candidate = {
    ...flat,
    pending,
    capabilities
  };
  const validated = validateAgentRunSnapshotV20(candidate);
  if (!validated.ok) return { ok: false, error: validated.error };
  const event = toEvent(validated.value, input.type, timestamp, input.detail);
  const pair = validateAgentRunStatePairV20({ snapshot: validated.value, event });
  return pair.ok
    ? { ok: true, value: { snapshot: pair.value.snapshot, event: pair.value.event } }
    : { ok: false, error: pair.error };
}

function transitionRunFinish(
  snapshot: AgentRunSnapshot,
  report: FinishReportV2,
  timestamp: string
): TransitionResult {
  const status = report.outcome;
  const type = report.outcome === "completed" ? "run_completed" : "run_blocked";
  const detail = { finishReport: report } as unknown as JsonObject;
  if (snapshot.schemaVersion !== "2.0") {
    const next = attachLegacyProjectId({
      ...snapshot,
      status,
      finishReport: report,
      runRevision: snapshot.runRevision + 1,
      lastSequence: snapshot.lastSequence + 1,
      updatedAt: timestamp
    } as Omit<AgentRunSnapshotV13, "projectId">);
    return { ok: true, value: { snapshot: next, event: toEvent(next, type, timestamp, detail) } };
  }

  const candidate = {
    ...snapshot,
    status,
    pendingUserInputId: null,
    pendingChangeSetId: null,
    pendingChangeSetRevision: null,
    pendingChangeSetChecksum: null,
    pendingToolApproval: null,
    pending: { kind: "none" as const },
    finishReport: report,
    finish: { state: status, report },
    runRevision: snapshot.runRevision + 1,
    lastSequence: snapshot.lastSequence + 1,
    updatedAt: timestamp
  };
  const validated = validateAgentRunSnapshotV20(candidate);
  if (!validated.ok) return { ok: false, error: validated.error };
  const event = toEvent(validated.value, type, timestamp, detail);
  const pair = validateAgentRunStatePairV20({ snapshot: validated.value, event });
  return pair.ok
    ? { ok: true, value: { snapshot: pair.value.snapshot, event: pair.value.event } }
    : { ok: false, error: pair.error };
}

function deriveV20Pending(
  previous: AgentRunSnapshotV20,
  next: AgentRunSnapshotV20,
  input: RecordAgentRunEventInput
): AgentRunPendingV20 | undefined {
  if (isTerminal(next.status) || next.status === "capability_changed") return { kind: "none" };
  if (input.type === "user_input_requested") {
    const requestId = input.detail?.["questionId"] ?? input.detail?.["requestId"];
    return isSafeId(requestId) && next.pendingUserInputId === requestId
      ? { kind: "user_input", requestId }
      : undefined;
  }
  if (input.type === "change_set_ready") {
    return isSafeId(next.pendingChangeSetId) &&
      Number.isSafeInteger(next.pendingChangeSetRevision) &&
      Number(next.pendingChangeSetRevision) > 0 &&
      isChecksum(next.pendingChangeSetChecksum)
      ? {
          kind: "write_approval",
          changeSetId: next.pendingChangeSetId,
          revision: Number(next.pendingChangeSetRevision),
          checksum: next.pendingChangeSetChecksum
        }
      : undefined;
  }
  if (input.type === "tool_approval_requested") {
    return next.pendingToolApproval === null
      ? undefined
      : { kind: "tool_approval", approval: next.pendingToolApproval };
  }
  if (input.type === "external_outcome_unknown") {
    const toolCallId = input.detail?.["toolCallId"];
    return isSafeId(toolCallId) ? { kind: "external_outcome_resolution", toolCallId } : undefined;
  }
  if (input.type === "context_stale") {
    return { kind: "context_stale", contextSnapshotId: next.contextSnapshotId };
  }
  if (input.type === "context_share_approval_requested") {
    const requestId = input.detail?.["requestId"];
    return isSafeId(requestId) ? { kind: "context_share_approval", requestId } : undefined;
  }
  if (input.type === "plan_ready") {
    const planId = input.detail?.["planId"];
    const revision = input.detail?.["revision"];
    return isSafeId(planId) && Number.isSafeInteger(revision) && Number(revision) > 0
      ? { kind: "plan_decision", planId, revision: Number(revision) }
      : undefined;
  }
  if (input.type === "plan_revision_requested") {
    const requestId = input.detail?.["requestId"];
    const planExecutionId = input.detail?.["planExecutionId"];
    const revision = input.detail?.["planRevision"];
    return isSafeId(requestId) &&
      isSafeId(planExecutionId) &&
      Number.isSafeInteger(revision) &&
      Number(revision) > 0
      ? { kind: "plan_revision", requestId, planExecutionId, revision: Number(revision) }
      : undefined;
  }
  if (next.status === "recovery_required") {
    return isSafeId(next.activeErrorId)
      ? { kind: "recovery_required", recoveryId: next.activeErrorId }
      : undefined;
  }
  if (pendingKindMatchesStatus(previous.pending, next.status)) return previous.pending;
  return { kind: "none" };
}

function pendingKindMatchesStatus(
  pending: AgentRunPendingV20,
  status: AgentRunSnapshotV20["status"]
): boolean {
  if (pending.kind === "user_input") return status === "awaiting_user_input";
  if (pending.kind === "write_approval") return status === "awaiting_write_approval";
  if (pending.kind === "context_share_approval")
    return status === "awaiting_context_share_approval";
  if (pending.kind === "tool_approval") return status === "awaiting_tool_approval";
  if (pending.kind === "external_outcome_resolution") {
    return status === "awaiting_external_outcome_resolution";
  }
  if (pending.kind === "context_stale") {
    return status === "awaiting_context_refresh" || status === "context_stale";
  }
  if (pending.kind === "plan_decision") {
    return status === "plan_ready" || status === "awaiting_plan_decision";
  }
  if (pending.kind === "plan_revision") return status === "awaiting_plan_revision";
  if (pending.kind === "recovery_required") return status === "recovery_required";
  return false;
}

function isChecksum(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isNonEmptyText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 4096 &&
    !hasAsciiControlCharacter(value)
  );
}

function hasAsciiControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function isLegacyStatus(
  value: RecordAgentRunEventInput["status"]
): value is AgentRunSnapshotV13["status"] {
  return ![
    "awaiting_context_share_approval",
    "context_stale",
    "recovery_required",
    "capability_changed"
  ].includes(value);
}

function isLegacyEventType(value: RecordAgentRunEventInput["type"]): value is AgentRunEventTypeV13 {
  return ![
    "capability_changed",
    "context_share_approval_requested",
    "context_share_approval_resolved"
  ].includes(value);
}

function toEvent(
  snapshot: AgentRunSnapshot,
  type: AgentRunEventTypeV13 | AgentRunEventTypeV20,
  createdAt: string,
  detail?: JsonObject
): AgentRunEvent {
  if (snapshot.schemaVersion === "2.0") {
    return attachLegacyProjectId({
      schemaVersion: "2.0" as const,
      runId: snapshot.runId,
      scope: snapshot.scope,
      sequence: snapshot.lastSequence,
      runRevision: snapshot.runRevision,
      createdAt,
      type: type as AgentRunEventTypeV20,
      eventRef: agentRunEventRefV20(snapshot.runId, snapshot.lastSequence),
      ...(detail === undefined ? {} : { detail })
    } as Omit<AgentRunEventV20, "projectId">);
  }
  return attachLegacyProjectId({
    schemaVersion: "1.3" as const,
    runId: snapshot.runId,
    scope: snapshot.scope,
    sequence: snapshot.lastSequence,
    runRevision: snapshot.runRevision,
    createdAt,
    type: type as AgentRunEventTypeV13,
    ...(detail === undefined ? {} : { detail })
  });
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

function resolveCommandScope(command: {
  readonly scope?: AgentContextScope;
  readonly projectId?: string;
}): AgentContextScope | undefined {
  if (command.scope !== undefined) return command.scope;
  return isSafeId(command.projectId)
    ? {
        kind: "workspace",
        workspaceKind: "creativeProject",
        workspaceId: command.projectId
      }
    : undefined;
}

function hasConsistentStrictFinish(
  snapshot: AgentRunSnapshot,
  lastEvent: AgentRunEvent,
  events: readonly AgentRunEvent[]
): boolean {
  if (!isStrictExecutionRun(snapshot)) {
    return true;
  }
  const report = snapshot.finishReport;
  const terminalEvents = events.filter((event) => isTerminalRunEventType(event.type));
  if (!isTerminal(snapshot.status)) {
    return (report === undefined || report === null) && terminalEvents.length === 0;
  }
  if (terminalEvents.length !== 1) return false;
  const terminalEvent = terminalEvents[0];
  if (terminalEvent === undefined) return false;
  const terminalIndex = events.indexOf(terminalEvent);
  if (
    terminalIndex < 0 ||
    events.slice(terminalIndex + 1).some((event) => !isTerminalAuditEventType(event.type))
  ) {
    return false;
  }
  const expectedEvent = terminalEventTypeForStatus(snapshot.status);
  if (expectedEvent === undefined || terminalEvent.type !== expectedEvent) return false;
  if (
    snapshot.status === "cancelled" ||
    snapshot.status === "failed" ||
    snapshot.status === "limit_reached"
  ) {
    return (
      (report === undefined || report === null) && lastEvent.runRevision === snapshot.runRevision
    );
  }
  if (report === undefined || report === null || report.schemaVersion !== "2.0") return false;
  const validated = validateFinishForRun(report, {
    status: "executing_model",
    recoveryState: "none"
  });
  if (!validated.ok || validated.value.outcome !== snapshot.status) return false;
  if (!validateFinishEvidence(validated.value, events).ok) return false;
  const eventReport = terminalEvent.detail?.["finishReport"];
  if (eventReport === undefined || eventReport === null) return false;
  const eventValidated = validateFinishForRun(eventReport, {
    status: "executing_model",
    recoveryState: "none"
  });
  return (
    eventValidated.ok &&
    eventValidated.value.schemaVersion === "2.0" &&
    isDeepStrictEqual(report, eventValidated.value)
  );
}

function isStrictExecutionRun(snapshot: AgentRunSnapshot): boolean {
  return snapshot.finishContractVersion === "2.0" && snapshot.operationMode === "execution";
}

function isTerminalRunEventType(type: AgentRunEvent["type"]): boolean {
  return (
    type === "run_completed" ||
    type === "run_blocked" ||
    type === "run_cancelled" ||
    type === "run_failed" ||
    type === "run_limit_reached"
  );
}

function terminalEventTypeForStatus(
  status: AgentRunSnapshot["status"]
): AgentRunEvent["type"] | undefined {
  if (status === "completed") return "run_completed";
  if (status === "blocked") return "run_blocked";
  if (status === "cancelled") return "run_cancelled";
  if (status === "failed") return "run_failed";
  if (status === "limit_reached") return "run_limit_reached";
  return undefined;
}

function validateFinishEvidence(
  report: FinishInputV2,
  events: readonly AgentRunEvent[]
):
  | { readonly ok: true }
  | { readonly ok: false; readonly error: ReturnType<typeof createCoordinatorError> } {
  const refs = report.evidenceRefs.map(parseFinishEvidenceRef);
  if (refs.some((ref) => ref === undefined)) {
    return {
      ok: false,
      error: createCoordinatorError(
        "AGENT_FINISH_EVIDENCE_INVALID",
        "Finish evidence references must use the canonical run-event format."
      )
    };
  }
  const parsed = refs as FinishEvidenceRef[];
  if (!parsed.every((ref) => evidenceMatchesEvent(ref, events))) {
    return {
      ok: false,
      error: createCoordinatorError(
        "AGENT_FINISH_EVIDENCE_MISSING",
        "A finish evidence reference does not match a persisted event in this run."
      )
    };
  }
  const writeRefs = parsed.filter(
    (ref): ref is Extract<FinishEvidenceRef, { kind: "write_applied" }> =>
      ref.kind === "write_applied"
  );
  if (
    report.report.appliedChanges.length !== writeRefs.length ||
    report.report.appliedChanges.some(
      (description, index) => !description.includes(writeRefs[index]?.changeSetId ?? "\u0000")
    )
  ) {
    return {
      ok: false,
      error: createCoordinatorError(
        "AGENT_FINISH_EVIDENCE_MISMATCH",
        "Each applied change description must bind, in order, to its persisted Change Set ID."
      )
    };
  }
  const verificationRefs = parsed.filter((ref) => ref.kind === "tool_completed");
  const declaredVerifications = report.report.verification.filter(
    (verification) => !verification.startsWith("not-run:")
  );
  if (declaredVerifications.length !== verificationRefs.length) {
    return {
      ok: false,
      error: createCoordinatorError(
        "AGENT_FINISH_VERIFICATION_UNPROVEN",
        "Each verification claim must have exactly one persisted tool_completed evidence reference."
      )
    };
  }
  for (const verification of report.report.verification) {
    if (verification.startsWith("not-run:")) continue;
    const ref = parseFinishEvidenceRef(verification);
    if (
      ref?.kind !== "tool_completed" ||
      !parsed.some((candidate) => sameEvidenceRef(candidate, ref))
    ) {
      return {
        ok: false,
        error: createCoordinatorError(
          "AGENT_FINISH_VERIFICATION_UNPROVEN",
          "Verification must cite a persisted tool_completed event, or explicitly start with not-run:."
        )
      };
    }
  }
  if (
    report.outcome === "blocked" &&
    !parsed.some((ref) => ref.kind === "tool_failed" || ref.kind === "completion_evidence")
  ) {
    return {
      ok: false,
      error: createCoordinatorError(
        "AGENT_FINISH_EVIDENCE_MISSING",
        "A blocked finish must cite a persisted failure or app-authored completion evidence event."
      )
    };
  }
  return { ok: true };
}

function evidenceMatchesEvent(ref: FinishEvidenceRef, events: readonly AgentRunEvent[]): boolean {
  const event = events.find((candidate) => candidate.sequence === ref.sequence);
  if (event === undefined) return false;
  if (ref.kind === "write_applied") {
    return (
      event.type === "write_applied" &&
      event.detail?.["changeSetId"] === ref.changeSetId &&
      event.detail?.["revision"] === ref.revision &&
      event.detail?.["checksum"] === ref.checksum
    );
  }
  if (ref.kind === "tool_completed" || ref.kind === "tool_failed") {
    return event.type === ref.kind && event.detail?.["toolCallId"] === ref.toolCallId;
  }
  if (ref.kind === "completion_evidence") {
    return (
      event.type === "completion_evidence_recorded" && event.detail?.["kind"] === ref.evidenceKind
    );
  }
  return false;
}

function sameEvidenceRef(left: FinishEvidenceRef, right: FinishEvidenceRef): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isTerminal(status: AgentRunSnapshot["status"]): boolean {
  return (
    status === "completed" ||
    status === "blocked" ||
    status === "cancelled" ||
    status === "failed" ||
    status === "limit_reached"
  );
}

function isAbsorbing(snapshot: AgentRunSnapshot): boolean {
  return (
    isTerminal(snapshot.status) ||
    (snapshot.schemaVersion === "2.0" && snapshot.status === "capability_changed")
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
