import { isDeepStrictEqual } from "node:util";

import {
  createUnifiedError,
  err,
  ok,
  type JsonObject,
  type Result,
  type UnifiedError
} from "@novel-studio/shared";

import { isAgentContextScope, type AgentContextProfileId } from "./agent-context-scope.js";
import {
  parseFinishEvidenceRef,
  validateFinishInput,
  type FinishReportV2
} from "./finish-report.js";
import {
  attachLegacyProjectId,
  type AgentPromptCacheCapabilitySnapshot,
  type AgentProviderCapabilitySnapshotV13,
  type AgentRunEventTypeV13,
  type AgentRunLimits,
  type AgentRunRecoveryState,
  type AgentRunSnapshotV13,
  type AgentRunStatusV13,
  type AgentRunUsageSummary,
  type AgentWritePolicy,
  type PendingToolApproval,
  type ToolApprovalBinding
} from "./agent-run-types.js";
import type { AgentToolFacadeVersion } from "./tool-registry.js";

/** Strict run contracts are intentionally separate from the registered 1.0-1.3 legacy readers. */
export const AGENT_RUN_SNAPSHOT_SCHEMA_VERSION_V20 = "2.0" as const;
export const AGENT_RUN_EVENT_SCHEMA_VERSION_V20 = "2.0" as const;

export type AgentRunStatusV20 =
  | AgentRunStatusV13
  | "awaiting_context_share_approval"
  | "context_stale"
  | "recovery_required"
  | "capability_changed";

export type AgentRunEventTypeV20 =
  | AgentRunEventTypeV13
  | "capability_changed"
  | "context_share_approval_requested"
  | "context_share_approval_resolved";

export interface AgentRunAuthorityV20 {
  readonly contractVersion: "2.0";
  readonly registryKey: string;
  readonly guidanceChecksum: string;
}

export interface AgentRunProtocolV20 {
  readonly contractVersion: "2.0";
  readonly finishContractVersion: "2.0";
  readonly pendingContractVersion: "2.0";
}

export interface AgentRunCatalogV20 {
  readonly contractVersion: "2.0";
  readonly facadeVersion: AgentToolFacadeVersion;
  readonly snapshotId: string;
  readonly revision: string;
  readonly checksum: string;
}

export interface AgentRunCapabilitiesV20 {
  readonly contractVersion: "2.0";
  readonly revision: number;
  readonly state: "active" | "capability_changed";
  readonly changeReason: string | null;
}

export type AgentRunPendingV20 =
  | { readonly kind: "none" }
  | { readonly kind: "user_input"; readonly requestId: string }
  | {
      readonly kind: "write_approval";
      readonly changeSetId: string;
      readonly revision: number;
      readonly checksum: string;
    }
  | { readonly kind: "context_share_approval"; readonly requestId: string }
  | { readonly kind: "tool_approval"; readonly approval: PendingToolApproval }
  | { readonly kind: "external_outcome_resolution"; readonly toolCallId: string }
  | { readonly kind: "context_stale"; readonly contextSnapshotId: string | null }
  | {
      readonly kind: "plan_decision";
      readonly planId: string;
      readonly revision: number;
    }
  | {
      readonly kind: "plan_revision";
      readonly requestId: string;
      readonly planExecutionId: string;
      readonly revision: number;
    }
  | { readonly kind: "recovery_required"; readonly recoveryId: string };

export interface AgentRunFinishV20 {
  readonly state: "not_finished" | "completed" | "blocked";
  readonly report: FinishReportV2 | null;
}

/**
 * Main-authored facts that explicitly select the 2.0 writer. Existing fields on
 * ResolvedAgentRunStartInput continue to carry the catalog facade/revision and durable session data.
 */
export interface AgentRunV20StartFacts {
  readonly schemaVersion: "2.0";
  readonly providerSemanticVersionSetChecksum: string;
  readonly authorityRegistryKey: string;
  readonly materializedGuidanceChecksum: string;
  readonly toolCatalogChecksum: string;
  readonly effectiveCapabilityRevision: number;
  /** App-owned future Act policy. Required by the coordinator for planning runs. */
  readonly executionWritePolicyDraft?: AgentWritePolicy;
}

type ReplacedV13Fields =
  | "schemaVersion"
  | "status"
  | "projectId"
  | "pendingChangeSetId"
  | "pendingChangeSetRevision"
  | "pendingChangeSetChecksum"
  | "versionGroupId"
  | "toolFacadeVersion"
  | "toolCatalogSnapshotId"
  | "toolCatalogRevision"
  | "pendingToolApproval"
  | "finishContractVersion"
  | "finishReport";

/**
 * The V20 envelope retains every durable V13 session pointer so hydrate never needs to normalize a
 * legacy record into new authority. Compatibility fields are duplicated only where the current
 * Application consumes them directly; validators require exact agreement with the nested V20 truth.
 */
export interface AgentRunSnapshotV20 extends Omit<AgentRunSnapshotV13, ReplacedV13Fields> {
  readonly schemaVersion: typeof AGENT_RUN_SNAPSHOT_SCHEMA_VERSION_V20;
  readonly status: AgentRunStatusV20;
  /** Non-enumerable workspace compatibility accessor, attached after strict validation. */
  readonly projectId: string;
  readonly pendingChangeSetId: string | null;
  readonly pendingChangeSetRevision: number | null;
  readonly pendingChangeSetChecksum: string | null;
  readonly versionGroupId: string | null;
  readonly toolFacadeVersion: AgentToolFacadeVersion;
  readonly toolCatalogSnapshotId: string;
  readonly toolCatalogRevision: string;
  readonly pendingToolApproval: PendingToolApproval | null;
  readonly finishContractVersion: "2.0";
  readonly finishReport: FinishReportV2 | null;
  /** Local planning/Act handoff state; never part of Provider-visible runtime facts. */
  readonly executionWritePolicyDraft: AgentWritePolicy;
  readonly providerSemanticVersionSetChecksum: string;
  readonly authority: AgentRunAuthorityV20;
  readonly protocol: AgentRunProtocolV20;
  readonly catalog: AgentRunCatalogV20;
  readonly capabilities: AgentRunCapabilitiesV20;
  readonly pending: AgentRunPendingV20;
  readonly finish: AgentRunFinishV20;
}

export interface AgentRunEventV20 {
  readonly schemaVersion: typeof AGENT_RUN_EVENT_SCHEMA_VERSION_V20;
  readonly runId: string;
  readonly scope: AgentRunSnapshotV20["scope"];
  readonly sequence: number;
  readonly runRevision: number;
  readonly type: AgentRunEventTypeV20;
  readonly createdAt: string;
  readonly detail?: JsonObject;
  /** Non-enumerable workspace compatibility accessor, attached after strict validation. */
  readonly projectId: string;
}

/** Durable intent used by the repository's recoverable event/snapshot pair writer. */
export interface AgentRunStateCommitV20 {
  readonly schemaVersion: "2.0";
  readonly commitId: string;
  readonly runId: string;
  readonly snapshot: AgentRunSnapshotV20;
  readonly event: AgentRunEventV20;
  readonly createdAt: string;
}

const SNAPSHOT_REQUIRED_FIELDS = [
  "schemaVersion",
  "runId",
  "scope",
  "conversationId",
  "operationMode",
  "contextMode",
  "writePolicy",
  "userRequest",
  "status",
  "runRevision",
  "lastSequence",
  "startedAt",
  "updatedAt",
  "limits",
  "providerCapabilitySnapshot",
  "pendingUserInputId",
  "contextSnapshotId",
  "sourcePlanId",
  "sourcePlanRevision",
  "pendingChangeSetId",
  "pendingChangeSetRevision",
  "pendingChangeSetChecksum",
  "versionGroupId",
  "modelProfileId",
  "permissionSummaryId",
  "permissionSummaryChecksum",
  "contextBudgetSnapshotId",
  "activeCompactionId",
  "planExecutionId",
  "planExecutionRevision",
  "activeErrorId",
  "recoveryState",
  "usageSummary",
  "toolFacadeVersion",
  "toolCatalogSnapshotId",
  "toolCatalogRevision",
  "pendingToolApproval",
  "contextProfileId",
  "profileVersion",
  "guidanceTemplateChecksum",
  "conventionsArtifactId",
  "promptCachePolicyVersion",
  "cachePrefixChecksum",
  "promptCacheArtifactId",
  "promptCacheIdentityBaseChecksum",
  "promptCacheIdentityChecksum",
  "promptCacheStablePrefixMessageCount",
  "finishContractVersion",
  "finishReport",
  "executionWritePolicyDraft",
  "providerSemanticVersionSetChecksum",
  "authority",
  "protocol",
  "catalog",
  "capabilities",
  "pending",
  "finish"
] as const;

const SNAPSHOT_OPTIONAL_FIELDS = new Set(["reasoningEffort"]);
const EVENT_TYPES = new Set<AgentRunEventTypeV20>([
  "run_started",
  "assistant_text_delta",
  "assistant_text_completed",
  "tool_started",
  "tool_completed",
  "tool_failed",
  "tool_retry_requested",
  "user_input_requested",
  "user_input_resolved",
  "context_stale",
  "context_refreshed",
  "context_excluded",
  "context_refresh_cancelled",
  "run_resumed",
  "plan_ready",
  "plan_decision_resolved",
  "plan_execution_started",
  "change_set_ready",
  "change_set_auto_approved",
  "approval_resolved",
  "write_started",
  "write_applied",
  "write_failed",
  "run_undo_started",
  "run_undo_review_required",
  "run_undone",
  "run_undo_failed",
  "run_completed",
  "run_blocked",
  "run_cancelled",
  "run_failed",
  "run_limit_reached",
  "context_compaction_started",
  "context_compaction_completed",
  "context_compaction_failed",
  "permission_summary_ready",
  "usage_updated",
  "plan_step_started",
  "plan_step_completed",
  "plan_step_blocked",
  "plan_step_skipped",
  "plan_deviation_recorded",
  "plan_revision_requested",
  "error_recorded",
  "tool_approval_requested",
  "tool_approval_resolved",
  "capability_revoked",
  "process_output",
  "external_outcome_unknown",
  "conversation_model",
  "completion_evidence_recorded",
  "capability_changed",
  "context_share_approval_requested",
  "context_share_approval_resolved"
]);

const STATUS_VALUES = new Set<AgentRunStatusV20>([
  "created",
  "planning_model",
  "executing_model",
  "executing_read_tool",
  "staging_changes",
  "awaiting_write_approval",
  "awaiting_context_share_approval",
  "applying_changes",
  "stopping_after_transaction",
  "awaiting_user_input",
  "awaiting_context_refresh",
  "context_stale",
  "context_compacting",
  "awaiting_plan_revision",
  "awaiting_plan_decision",
  "awaiting_tool_approval",
  "awaiting_external_outcome_resolution",
  "recovery_required",
  "plan_ready",
  "conversation_model",
  "completed",
  "blocked",
  "cancelled",
  "failed",
  "limit_reached",
  "capability_changed"
]);

export function validateAgentRunV20StartFacts(
  value: unknown
): Result<AgentRunV20StartFacts, UnifiedError> {
  if (
    !isRecord(value) ||
    !hasOnlyFields(value, [
      "schemaVersion",
      "providerSemanticVersionSetChecksum",
      "authorityRegistryKey",
      "materializedGuidanceChecksum",
      "toolCatalogChecksum",
      "effectiveCapabilityRevision",
      "executionWritePolicyDraft"
    ]) ||
    ![
      "schemaVersion",
      "providerSemanticVersionSetChecksum",
      "authorityRegistryKey",
      "materializedGuidanceChecksum",
      "toolCatalogChecksum",
      "effectiveCapabilityRevision"
    ].every((field) => field in value) ||
    value.schemaVersion !== "2.0" ||
    !isSha256(value.providerSemanticVersionSetChecksum) ||
    !isNonEmptyString(value.authorityRegistryKey) ||
    !isSha256(value.materializedGuidanceChecksum) ||
    !isSha256(value.toolCatalogChecksum) ||
    !positiveInteger(value.effectiveCapabilityRevision) ||
    (value.executionWritePolicyDraft !== undefined &&
      !isWritePolicy(value.executionWritePolicyDraft))
  ) {
    return invalid("AGENT_RUN_V20_START_FACTS_INVALID");
  }
  return ok(deepFreeze({ ...value } as unknown as AgentRunV20StartFacts));
}

export function validateAgentRunSnapshotV20(
  value: unknown
): Result<AgentRunSnapshotV20, UnifiedError> {
  if (!isRecord(value) || !hasExactSnapshotFields(value)) {
    return invalid("AGENT_RUN_SNAPSHOT_V20_UNKNOWN_FIELD");
  }
  if (value.schemaVersion !== AGENT_RUN_SNAPSHOT_SCHEMA_VERSION_V20) {
    return invalid("AGENT_RUN_SNAPSHOT_VERSION_UNSUPPORTED");
  }
  if (
    !isSafeId(value.runId) ||
    !isStrictAgentContextScope(value.scope) ||
    (value.conversationId !== null && !isSafeId(value.conversationId)) ||
    !isOperationMode(value.operationMode) ||
    !isContextMode(value.contextMode) ||
    !isWritePolicy(value.writePolicy) ||
    !isBoundedText(value.userRequest) ||
    !isStatus(value.status) ||
    !positiveInteger(value.runRevision) ||
    !nonNegativeInteger(value.lastSequence) ||
    !isNonEmptyString(value.startedAt) ||
    !isNonEmptyString(value.updatedAt) ||
    !isLimits(value.limits) ||
    !isProviderCapabilities(value.providerCapabilitySnapshot) ||
    !isNullableSafeId(value.pendingUserInputId) ||
    !isNullableSafeId(value.contextSnapshotId) ||
    !isNullableSafeId(value.sourcePlanId) ||
    !isNullablePositiveInteger(value.sourcePlanRevision) ||
    !isNullableSafeId(value.pendingChangeSetId) ||
    !isNullablePositiveInteger(value.pendingChangeSetRevision) ||
    !isNullableSha256(value.pendingChangeSetChecksum) ||
    !isNullableSafeId(value.versionGroupId) ||
    !isNonEmptyString(value.modelProfileId) ||
    (value.reasoningEffort !== undefined && !isNonEmptyString(value.reasoningEffort)) ||
    !isNullableSafeId(value.permissionSummaryId) ||
    !isNullableSha256(value.permissionSummaryChecksum) ||
    !isNullableSafeId(value.contextBudgetSnapshotId) ||
    !isNullableSafeId(value.activeCompactionId) ||
    !isNullableSafeId(value.planExecutionId) ||
    !isNullablePositiveInteger(value.planExecutionRevision) ||
    !isNullableSafeId(value.activeErrorId) ||
    !isRecoveryState(value.recoveryState) ||
    !isUsageSummary(value.usageSummary) ||
    !isFacadeVersion(value.toolFacadeVersion) ||
    !isSafeId(value.toolCatalogSnapshotId) ||
    !isNonEmptyString(value.toolCatalogRevision) ||
    (value.pendingToolApproval !== null && !isPendingToolApproval(value.pendingToolApproval)) ||
    !isContextProfileId(value.contextProfileId) ||
    !isNonEmptyString(value.profileVersion) ||
    !isSha256(value.guidanceTemplateChecksum) ||
    !isNullableSafeId(value.conventionsArtifactId) ||
    !isNonEmptyString(value.promptCachePolicyVersion) ||
    !isSha256(value.cachePrefixChecksum) ||
    !isNullableSafeId(value.promptCacheArtifactId) ||
    !isSha256(value.promptCacheIdentityBaseChecksum) ||
    !isSha256(value.promptCacheIdentityChecksum) ||
    !nonNegativeInteger(value.promptCacheStablePrefixMessageCount) ||
    value.finishContractVersion !== "2.0" ||
    !isNullableFinishReport(value.finishReport) ||
    !isWritePolicy(value.executionWritePolicyDraft) ||
    !isSha256(value.providerSemanticVersionSetChecksum) ||
    !isAuthority(value.authority) ||
    !isProtocol(value.protocol) ||
    !isCatalog(value.catalog) ||
    !isCapabilities(value.capabilities) ||
    !isPending(value.pending) ||
    !isFinish(value.finish)
  ) {
    return invalid("AGENT_RUN_SNAPSHOT_V20_INVALID");
  }

  const snapshot = value as unknown as AgentRunSnapshotV20;
  if (
    !nullablePairMatches(snapshot.sourcePlanId, snapshot.sourcePlanRevision) ||
    !nullablePairMatches(snapshot.permissionSummaryId, snapshot.permissionSummaryChecksum) ||
    !nullablePairMatches(snapshot.planExecutionId, snapshot.planExecutionRevision) ||
    !changeSetTripleMatches(snapshot) ||
    snapshot.providerCapabilitySnapshot.profileId !== snapshot.modelProfileId ||
    snapshot.providerCapabilitySnapshot.promptCache.policyVersion !==
      snapshot.promptCachePolicyVersion ||
    snapshot.catalog.facadeVersion !== snapshot.toolFacadeVersion ||
    snapshot.catalog.snapshotId !== snapshot.toolCatalogSnapshotId ||
    snapshot.catalog.revision !== snapshot.toolCatalogRevision ||
    !pendingMatchesSnapshot(snapshot) ||
    !finishMatchesSnapshot(snapshot) ||
    !capabilitiesMatchSnapshot(snapshot)
  ) {
    return invalid("AGENT_RUN_SNAPSHOT_V20_INVARIANT_INVALID");
  }

  const parsed = attachLegacyProjectId({ ...snapshot } as Omit<AgentRunSnapshotV20, "projectId">);
  return ok(deepFreeze(parsed as AgentRunSnapshotV20));
}

export function parseAgentRunSnapshotV20(value: unknown): AgentRunSnapshotV20 {
  const parsed = validateAgentRunSnapshotV20(value);
  if (!parsed.ok) throw new Error(parsed.error.code);
  return parsed.value;
}

export function validateAgentRunEventV20(value: unknown): Result<AgentRunEventV20, UnifiedError> {
  if (!isRecord(value)) return invalid("AGENT_RUN_EVENT_V20_INVALID");
  const required = [
    "schemaVersion",
    "runId",
    "scope",
    "sequence",
    "runRevision",
    "type",
    "createdAt"
  ];
  if (!hasOnlyFields(value, [...required, "detail"])) {
    return invalid("AGENT_RUN_EVENT_V20_UNKNOWN_FIELD");
  }
  if (required.some((field) => !(field in value))) {
    return invalid("AGENT_RUN_EVENT_V20_REQUIRED");
  }
  if (
    value.schemaVersion !== AGENT_RUN_EVENT_SCHEMA_VERSION_V20 ||
    !isSafeId(value.runId) ||
    !isStrictAgentContextScope(value.scope) ||
    !positiveInteger(value.sequence) ||
    !positiveInteger(value.runRevision) ||
    !isEventType(value.type) ||
    !isNonEmptyString(value.createdAt) ||
    (value.detail !== undefined && !isRecord(value.detail)) ||
    !eventDetailMatchesType(value.type as AgentRunEventTypeV20, value.detail)
  ) {
    return invalid("AGENT_RUN_EVENT_V20_INVALID");
  }
  const event = attachLegacyProjectId({ ...value } as unknown as Omit<
    AgentRunEventV20,
    "projectId"
  >);
  return ok(deepFreeze(event as AgentRunEventV20));
}

export function parseAgentRunEventV20(value: unknown): AgentRunEventV20 {
  const parsed = validateAgentRunEventV20(value);
  if (!parsed.ok) throw new Error(parsed.error.code);
  return parsed.value;
}

/** Validate the snapshot/event pair that one atomic repository commit is about to expose. */
export function validateAgentRunStatePairV20(input: {
  readonly snapshot: unknown;
  readonly event: unknown;
}): Result<
  { readonly snapshot: AgentRunSnapshotV20; readonly event: AgentRunEventV20 },
  UnifiedError
> {
  const snapshot = validateAgentRunSnapshotV20(input.snapshot);
  if (!snapshot.ok) return err(snapshot.error);
  const event = validateAgentRunEventV20(input.event);
  if (!event.ok) return err(event.error);
  if (
    snapshot.value.runId !== event.value.runId ||
    snapshot.value.lastSequence !== event.value.sequence ||
    snapshot.value.runRevision !== event.value.runRevision ||
    !isDeepStrictEqual(snapshot.value.scope, event.value.scope) ||
    snapshot.value.updatedAt !== event.value.createdAt ||
    !eventMatchesSnapshot(event.value, snapshot.value)
  ) {
    return invalid("AGENT_RUN_V20_COMMIT_INVALID");
  }
  return ok({ snapshot: snapshot.value, event: event.value });
}

/** Validate a complete V20 history without normalizing any legacy event into the new protocol. */
export function validateAgentRunHistoryV20(input: {
  readonly snapshot: unknown;
  readonly events: readonly unknown[];
}): Result<
  { readonly snapshot: AgentRunSnapshotV20; readonly events: readonly AgentRunEventV20[] },
  UnifiedError
> {
  const snapshot = validateAgentRunSnapshotV20(input.snapshot);
  if (!snapshot.ok) return err(snapshot.error);
  const parsed: AgentRunEventV20[] = [];
  for (const [index, candidate] of input.events.entries()) {
    const event = validateAgentRunEventV20(candidate);
    if (!event.ok) return err(event.error);
    const previous = parsed.at(-1);
    if (
      event.value.runId !== snapshot.value.runId ||
      !isDeepStrictEqual(event.value.scope, snapshot.value.scope) ||
      event.value.sequence !== index + 1 ||
      (previous !== undefined && event.value.runRevision !== previous.runRevision + 1) ||
      event.value.runRevision > snapshot.value.runRevision
    ) {
      return invalid("AGENT_RUN_EVENT_V20_SEQUENCE_INVALID");
    }
    parsed.push(event.value);
  }
  const last = parsed.at(-1);
  if (
    last === undefined ||
    parsed[0]?.type !== "run_started" ||
    parsed[0]?.sequence !== 1 ||
    parsed[0]?.runRevision !== 1 ||
    last.sequence !== snapshot.value.lastSequence ||
    last.runRevision !== snapshot.value.runRevision ||
    last.createdAt !== snapshot.value.updatedAt ||
    !terminalHistoryMatchesSnapshot(parsed, snapshot.value) ||
    !pendingHistoryMatchesSnapshot(parsed, snapshot.value) ||
    !capabilityHistoryMatchesSnapshot(parsed, snapshot.value) ||
    !finishEvidenceMatchesHistory(parsed, snapshot.value)
  ) {
    return invalid("AGENT_RUN_V20_HISTORY_INVALID");
  }
  return ok({ snapshot: snapshot.value, events: deepFreeze(parsed) });
}

function hasExactSnapshotFields(value: JsonObject): boolean {
  const required = new Set<string>(SNAPSHOT_REQUIRED_FIELDS);
  return (
    SNAPSHOT_REQUIRED_FIELDS.every((field) => field in value) &&
    Object.keys(value).every((field) => required.has(field) || SNAPSHOT_OPTIONAL_FIELDS.has(field))
  );
}

function eventDetailMatchesType(type: AgentRunEventTypeV20, detail: unknown): boolean {
  if (type === "run_started") return detail === undefined;
  if (type === "run_completed" || type === "run_blocked") {
    if (!isRecord(detail) || !exactFields(detail, ["finishReport"])) return false;
    const report = detail.finishReport;
    return (
      isRecord(report) &&
      report.schemaVersion === "2.0" &&
      validateFinishInput(report).ok &&
      report.outcome === (type === "run_completed" ? "completed" : "blocked")
    );
  }
  if (type === "tool_started" || type === "tool_completed" || type === "tool_failed") {
    return isRecord(detail) && isSafeId(detail.toolCallId);
  }
  if (type === "write_applied") {
    return (
      isRecord(detail) &&
      isSafeId(detail.changeSetId) &&
      positiveInteger(detail.revision) &&
      isSha256(detail.checksum) &&
      isSafeId(detail.versionGroupId)
    );
  }
  if (type === "completion_evidence_recorded") {
    return isRecord(detail) && isSafeId(detail.kind);
  }
  if (type === "user_input_requested") {
    return isRecord(detail) && (isSafeId(detail.questionId) || isSafeId(detail.requestId));
  }
  if (type === "change_set_ready") {
    return (
      isRecord(detail) &&
      isSafeId(detail.changeSetId) &&
      positiveInteger(detail.revision) &&
      isSha256(detail.checksum)
    );
  }
  if (type === "tool_approval_requested") {
    return (
      isRecord(detail) &&
      isSafeId(detail.toolCallId) &&
      isRecord(detail.binding) &&
      isSafeId(detail.binding.bindingId)
    );
  }
  if (type === "external_outcome_unknown") {
    return isRecord(detail) && isSafeId(detail.toolCallId);
  }
  if (type === "context_share_approval_requested") {
    return isRecord(detail) && isSafeId(detail.requestId);
  }
  if (type === "plan_ready") {
    return isRecord(detail) && isSafeId(detail.planId) && positiveInteger(detail.revision);
  }
  if (type === "plan_revision_requested") {
    return (
      isRecord(detail) &&
      isSafeId(detail.requestId) &&
      isSafeId(detail.planExecutionId) &&
      positiveInteger(detail.planRevision)
    );
  }
  if (type === "capability_changed") {
    return (
      isRecord(detail) &&
      positiveInteger(detail.effectiveCapabilityRevision) &&
      isNonEmptyString(detail.reason)
    );
  }
  return detail === undefined || isRecord(detail);
}

function eventMatchesSnapshot(event: AgentRunEventV20, snapshot: AgentRunSnapshotV20): boolean {
  if (event.type === "run_started") {
    return (
      event.sequence === 1 &&
      event.runRevision === 1 &&
      snapshot.pending.kind === "none" &&
      snapshot.finish.state === "not_finished" &&
      snapshot.capabilities.state === "active" &&
      snapshot.startedAt === event.createdAt
    );
  }
  if (event.type === "run_completed" || event.type === "run_blocked") {
    const outcome = event.type === "run_completed" ? "completed" : "blocked";
    return (
      snapshot.status === outcome &&
      snapshot.finish.state === outcome &&
      snapshot.finish.report !== null &&
      isDeepStrictEqual(event.detail?.finishReport, snapshot.finish.report)
    );
  }
  if (event.type === "run_cancelled") return snapshot.status === "cancelled";
  if (event.type === "run_failed") return snapshot.status === "failed";
  if (event.type === "run_limit_reached") return snapshot.status === "limit_reached";
  if (isTerminalAuditEvent(event.type)) {
    return isTerminalStatus(snapshot.status) || snapshot.status === "capability_changed";
  }
  if (isTerminalStatus(snapshot.status)) return false;
  if (event.type === "user_input_requested") {
    return (
      snapshot.pending.kind === "user_input" &&
      (event.detail?.questionId === snapshot.pending.requestId ||
        event.detail?.requestId === snapshot.pending.requestId)
    );
  }
  if (event.type === "change_set_ready") {
    return (
      snapshot.pending.kind === "write_approval" &&
      event.detail?.changeSetId === snapshot.pending.changeSetId &&
      event.detail?.revision === snapshot.pending.revision &&
      event.detail?.checksum === snapshot.pending.checksum
    );
  }
  if (event.type === "tool_approval_requested") {
    return (
      snapshot.pending.kind === "tool_approval" &&
      event.detail?.toolCallId === snapshot.pending.approval.binding.toolCallId &&
      isRecord(event.detail?.binding) &&
      event.detail.binding.bindingId === snapshot.pending.approval.binding.bindingId
    );
  }
  if (event.type === "external_outcome_unknown") {
    return (
      snapshot.pending.kind === "external_outcome_resolution" &&
      event.detail?.toolCallId === snapshot.pending.toolCallId
    );
  }
  if (event.type === "context_stale") {
    return (
      snapshot.pending.kind === "context_stale" &&
      snapshot.pending.contextSnapshotId === snapshot.contextSnapshotId
    );
  }
  if (event.type === "context_share_approval_requested") {
    return (
      snapshot.pending.kind === "context_share_approval" &&
      event.detail?.requestId === snapshot.pending.requestId
    );
  }
  if (event.type === "plan_ready") {
    return (
      snapshot.pending.kind === "plan_decision" &&
      event.detail?.planId === snapshot.pending.planId &&
      event.detail?.revision === snapshot.pending.revision
    );
  }
  if (event.type === "plan_revision_requested") {
    return (
      snapshot.pending.kind === "plan_revision" &&
      event.detail?.requestId === snapshot.pending.requestId &&
      event.detail?.planExecutionId === snapshot.pending.planExecutionId &&
      event.detail?.planRevision === snapshot.pending.revision
    );
  }
  if (event.type === "capability_changed") {
    return (
      snapshot.status === "capability_changed" &&
      snapshot.capabilities.state === "capability_changed" &&
      event.detail?.effectiveCapabilityRevision === snapshot.capabilities.revision &&
      event.detail?.reason === snapshot.capabilities.changeReason &&
      snapshot.pending.kind === "none"
    );
  }
  if (snapshot.pending.kind !== "none") {
    return event.type === "change_set_auto_approved" || event.type === "error_recorded";
  }
  return true;
}

function terminalHistoryMatchesSnapshot(
  events: readonly AgentRunEventV20[],
  snapshot: AgentRunSnapshotV20
): boolean {
  const terminalEvents = events.filter((event) => isTerminalRunEvent(event.type));
  if (!isTerminalStatus(snapshot.status)) return terminalEvents.length === 0;
  if (terminalEvents.length !== 1) return false;
  const terminal = terminalEvents[0];
  if (terminal === undefined) return false;
  const index = events.indexOf(terminal);
  if (events.slice(index + 1).some((event) => !isTerminalAuditEvent(event.type))) return false;
  if (snapshot.status === "completed" || snapshot.status === "blocked") {
    return eventMatchesSnapshot(terminal, snapshot);
  }
  return terminal.type === terminalEventForStatus(snapshot.status);
}

type PendingHistoryMarker =
  | { readonly kind: "none" }
  | { readonly kind: "user_input"; readonly requestId: string }
  | {
      readonly kind: "write_approval";
      readonly changeSetId: string;
      readonly revision: number;
      readonly checksum: string;
    }
  | { readonly kind: "context_share_approval"; readonly requestId: string }
  | {
      readonly kind: "tool_approval";
      readonly toolCallId: string;
      readonly bindingId: string;
    }
  | { readonly kind: "external_outcome_resolution"; readonly toolCallId: string }
  | { readonly kind: "context_stale" }
  | { readonly kind: "plan_decision"; readonly planId: string; readonly revision: number }
  | {
      readonly kind: "plan_revision";
      readonly requestId: string;
      readonly planExecutionId: string;
      readonly revision: number;
    };

function pendingHistoryMatchesSnapshot(
  events: readonly AgentRunEventV20[],
  snapshot: AgentRunSnapshotV20
): boolean {
  let marker: PendingHistoryMarker = { kind: "none" };
  for (const event of events) {
    if (isTerminalRunEvent(event.type) || event.type === "capability_changed") {
      marker = { kind: "none" };
      continue;
    }
    if (event.type === "user_input_requested") {
      const requestId = event.detail?.questionId ?? event.detail?.requestId;
      if (marker.kind !== "none" || !isSafeId(requestId)) return false;
      marker = { kind: "user_input", requestId };
      continue;
    }
    if (event.type === "change_set_ready") {
      if (marker.kind !== "none" && marker.kind !== "write_approval") return false;
      const changeSetId = event.detail?.changeSetId;
      const revision = event.detail?.revision;
      const checksum = event.detail?.checksum;
      if (!isSafeId(changeSetId) || !positiveInteger(revision) || !isSha256(checksum)) return false;
      marker = { kind: "write_approval", changeSetId, revision, checksum };
      continue;
    }
    if (event.type === "context_share_approval_requested") {
      const requestId = event.detail?.requestId;
      if (marker.kind !== "none" || !isSafeId(requestId)) return false;
      marker = { kind: "context_share_approval", requestId };
      continue;
    }
    if (event.type === "tool_approval_requested") {
      const toolCallId = event.detail?.toolCallId;
      const binding = event.detail?.binding;
      if (
        marker.kind !== "none" ||
        !isSafeId(toolCallId) ||
        !isRecord(binding) ||
        !isSafeId(binding.bindingId)
      )
        return false;
      marker = { kind: "tool_approval", toolCallId, bindingId: binding.bindingId };
      continue;
    }
    if (event.type === "external_outcome_unknown") {
      const toolCallId = event.detail?.toolCallId;
      if (marker.kind !== "none" || !isSafeId(toolCallId)) return false;
      marker = { kind: "external_outcome_resolution", toolCallId };
      continue;
    }
    if (event.type === "context_stale") {
      marker = { kind: "context_stale" };
      continue;
    }
    if (event.type === "plan_ready") {
      const planId = event.detail?.planId;
      const revision = event.detail?.revision;
      if (marker.kind !== "none" || !isSafeId(planId) || !positiveInteger(revision)) return false;
      marker = { kind: "plan_decision", planId, revision };
      continue;
    }
    if (event.type === "plan_revision_requested") {
      const requestId = event.detail?.requestId;
      const planExecutionId = event.detail?.planExecutionId;
      const revision = event.detail?.planRevision;
      if (
        marker.kind !== "none" ||
        !isSafeId(requestId) ||
        !isSafeId(planExecutionId) ||
        !positiveInteger(revision)
      )
        return false;
      marker = { kind: "plan_revision", requestId, planExecutionId, revision };
      continue;
    }
    if (
      event.type === "user_input_resolved" ||
      event.type === "approval_resolved" ||
      event.type === "tool_approval_resolved" ||
      event.type === "context_share_approval_resolved" ||
      event.type === "context_refreshed" ||
      event.type === "context_excluded" ||
      event.type === "context_refresh_cancelled" ||
      event.type === "plan_decision_resolved" ||
      event.type === "run_resumed"
    ) {
      if (!resolutionMatchesPending(event, marker)) return false;
      marker = { kind: "none" };
    }
  }

  if (snapshot.pending.kind === "none") return marker.kind === "none";
  if (snapshot.pending.kind === "recovery_required") return marker.kind === "none";
  if (snapshot.pending.kind === "context_stale") return marker.kind === "context_stale";
  if (snapshot.pending.kind === "tool_approval") {
    return (
      marker.kind === "tool_approval" &&
      marker.toolCallId === snapshot.pending.approval.binding.toolCallId &&
      marker.bindingId === snapshot.pending.approval.binding.bindingId
    );
  }
  return isDeepStrictEqual(marker, snapshot.pending);
}

function resolutionMatchesPending(event: AgentRunEventV20, marker: PendingHistoryMarker): boolean {
  if (event.type === "user_input_resolved") {
    return (
      marker.kind === "user_input" &&
      (event.detail?.questionId === marker.requestId ||
        event.detail?.requestId === marker.requestId)
    );
  }
  if (event.type === "approval_resolved") {
    return (
      marker.kind === "write_approval" &&
      event.detail?.changeSetId === marker.changeSetId &&
      event.detail?.revision === marker.revision
    );
  }
  if (event.type === "tool_approval_resolved") {
    return (
      marker.kind === "tool_approval" &&
      event.detail?.toolCallId === marker.toolCallId &&
      event.detail?.bindingId === marker.bindingId
    );
  }
  if (event.type === "context_share_approval_resolved") {
    return marker.kind === "context_share_approval" && event.detail?.requestId === marker.requestId;
  }
  if (
    event.type === "context_refreshed" ||
    event.type === "context_excluded" ||
    event.type === "context_refresh_cancelled"
  ) {
    // context_refreshed is also the app-authored initial-context event immediately after start.
    return marker.kind === "none" || marker.kind === "context_stale";
  }
  if (event.type === "plan_decision_resolved") {
    if (marker.kind === "plan_decision") {
      return (
        event.detail?.planId === marker.planId && event.detail?.planRevision === marker.revision
      );
    }
    return (
      marker.kind === "plan_revision" &&
      event.detail?.requestId === marker.requestId &&
      event.detail?.planRevision === marker.revision
    );
  }
  if (event.type === "run_resumed") {
    if (marker.kind === "external_outcome_resolution") {
      return event.detail?.toolCallId === marker.toolCallId;
    }
    return marker.kind === "none" || marker.kind === "write_approval";
  }
  return false;
}

function capabilityHistoryMatchesSnapshot(
  events: readonly AgentRunEventV20[],
  snapshot: AgentRunSnapshotV20
): boolean {
  const changed = events.filter((event) => event.type === "capability_changed");
  if (snapshot.status !== "capability_changed") return changed.length === 0;
  if (changed.length !== 1 || snapshot.capabilities.state !== "capability_changed") return false;
  const boundary = changed[0];
  if (boundary === undefined || !eventMatchesSnapshot(boundary, snapshot)) return false;
  const index = events.indexOf(boundary);
  return events.slice(index + 1).every((event) => isTerminalAuditEvent(event.type));
}

function finishEvidenceMatchesHistory(
  events: readonly AgentRunEventV20[],
  snapshot: AgentRunSnapshotV20
): boolean {
  const report = snapshot.finish.report;
  if (report === null) return true;
  const terminal = events.find(
    (event) => event.type === "run_completed" || event.type === "run_blocked"
  );
  if (terminal === undefined) return false;
  const refs = report.evidenceRefs.map(parseFinishEvidenceRef);
  if (refs.some((ref) => ref === undefined)) return false;
  const parsed = refs.filter((ref): ref is NonNullable<typeof ref> => ref !== undefined);
  if (
    !parsed.every((ref) => {
      if (ref.sequence >= terminal.sequence) return false;
      const event = events.find((candidate) => candidate.sequence === ref.sequence);
      if (event === undefined || event.type !== ref.kind) {
        return (
          ref.kind === "completion_evidence" &&
          event?.type === "completion_evidence_recorded" &&
          event.detail?.kind === ref.evidenceKind
        );
      }
      if (ref.kind === "write_applied") {
        return (
          event.detail?.changeSetId === ref.changeSetId &&
          event.detail?.revision === ref.revision &&
          event.detail?.checksum === ref.checksum
        );
      }
      return event.detail?.toolCallId === ref.toolCallId;
    })
  )
    return false;

  const writeRefs = parsed.filter((ref) => ref.kind === "write_applied");
  if (
    report.report.appliedChanges.length !== writeRefs.length ||
    report.report.appliedChanges.some(
      (description, index) => !description.includes(writeRefs[index]?.changeSetId ?? "\u0000")
    )
  )
    return false;
  const verificationRefs = parsed.filter((ref) => ref.kind === "tool_completed");
  const verifiedClaims = report.report.verification.filter(
    (verification) => !verification.startsWith("not-run:")
  );
  if (verifiedClaims.length !== verificationRefs.length) return false;
  if (
    verifiedClaims.some((verification) => {
      const ref = parseFinishEvidenceRef(verification);
      return (
        ref?.kind !== "tool_completed" ||
        !verificationRefs.some((candidate) => isDeepStrictEqual(candidate, ref))
      );
    })
  )
    return false;
  return (
    report.outcome !== "blocked" ||
    parsed.some((ref) => ref.kind === "tool_failed" || ref.kind === "completion_evidence")
  );
}

function pendingMatchesSnapshot(snapshot: AgentRunSnapshotV20): boolean {
  const hasChangeSet = snapshot.pendingChangeSetId !== null;
  if (
    hasChangeSet !== (snapshot.pendingChangeSetRevision !== null) ||
    hasChangeSet !== (snapshot.pendingChangeSetChecksum !== null)
  )
    return false;
  if (
    hasChangeSet &&
    snapshot.pending.kind !== "write_approval" &&
    snapshot.pending.kind !== "context_stale" &&
    snapshot.status !== "applying_changes" &&
    snapshot.status !== "stopping_after_transaction"
  )
    return false;

  if (snapshot.pending.kind === "user_input") {
    return (
      snapshot.status === "awaiting_user_input" &&
      snapshot.pendingUserInputId === snapshot.pending.requestId &&
      snapshot.pendingToolApproval === null
    );
  }
  if (snapshot.pending.kind === "write_approval") {
    return (
      snapshot.status === "awaiting_write_approval" &&
      snapshot.pendingUserInputId === null &&
      snapshot.pendingToolApproval === null &&
      snapshot.pendingChangeSetId === snapshot.pending.changeSetId &&
      snapshot.pendingChangeSetRevision === snapshot.pending.revision &&
      snapshot.pendingChangeSetChecksum === snapshot.pending.checksum
    );
  }
  if (snapshot.pending.kind === "tool_approval") {
    const binding = snapshot.pending.approval.binding;
    return (
      snapshot.status === "awaiting_tool_approval" &&
      snapshot.pendingUserInputId === null &&
      isDeepStrictEqual(snapshot.pendingToolApproval, snapshot.pending.approval) &&
      binding.runId === snapshot.runId &&
      binding.runRevision < snapshot.runRevision &&
      binding.effectiveCapabilityRevision === snapshot.capabilities.revision &&
      (binding.kind !== "task" || binding.catalogRevision === snapshot.catalog.revision)
    );
  }
  if (snapshot.pendingUserInputId !== null || snapshot.pendingToolApproval !== null) return false;
  if (snapshot.pending.kind === "context_share_approval") {
    return snapshot.status === "awaiting_context_share_approval";
  }
  if (snapshot.pending.kind === "external_outcome_resolution") {
    return snapshot.status === "awaiting_external_outcome_resolution";
  }
  if (snapshot.pending.kind === "context_stale") {
    return (
      (snapshot.status === "awaiting_context_refresh" || snapshot.status === "context_stale") &&
      snapshot.pending.contextSnapshotId === snapshot.contextSnapshotId
    );
  }
  if (snapshot.pending.kind === "plan_decision") {
    return snapshot.status === "plan_ready" || snapshot.status === "awaiting_plan_decision";
  }
  if (snapshot.pending.kind === "plan_revision") {
    return (
      snapshot.status === "awaiting_plan_revision" &&
      snapshot.planExecutionId === snapshot.pending.planExecutionId
    );
  }
  if (snapshot.pending.kind === "recovery_required") {
    return (
      snapshot.status === "recovery_required" &&
      snapshot.activeErrorId === snapshot.pending.recoveryId &&
      snapshot.recoveryState !== "none" &&
      snapshot.recoveryState !== "retryable"
    );
  }

  const statusRequiresPending = [
    "awaiting_user_input",
    "awaiting_write_approval",
    "awaiting_context_share_approval",
    "awaiting_tool_approval",
    "awaiting_external_outcome_resolution",
    "awaiting_context_refresh",
    "context_stale",
    "plan_ready",
    "awaiting_plan_decision",
    "awaiting_plan_revision",
    "recovery_required"
  ].includes(snapshot.status);
  return !statusRequiresPending;
}

function finishMatchesSnapshot(snapshot: AgentRunSnapshotV20): boolean {
  if (snapshot.finish.state === "not_finished") {
    return (
      snapshot.finish.report === null &&
      snapshot.finishReport === null &&
      snapshot.status !== "completed" &&
      snapshot.status !== "blocked"
    );
  }
  return (
    snapshot.status === snapshot.finish.state &&
    snapshot.finish.report !== null &&
    snapshot.finishReport !== null &&
    snapshot.finish.report.outcome === snapshot.finish.state &&
    isDeepStrictEqual(snapshot.finish.report, snapshot.finishReport)
  );
}

function capabilitiesMatchSnapshot(snapshot: AgentRunSnapshotV20): boolean {
  return snapshot.capabilities.state === "capability_changed"
    ? snapshot.status === "capability_changed" && snapshot.capabilities.changeReason !== null
    : snapshot.status !== "capability_changed" && snapshot.capabilities.changeReason === null;
}

function changeSetTripleMatches(snapshot: AgentRunSnapshotV20): boolean {
  const values = [
    snapshot.pendingChangeSetId,
    snapshot.pendingChangeSetRevision,
    snapshot.pendingChangeSetChecksum
  ];
  return values.every((value) => value === null) || values.every((value) => value !== null);
}

function isAuthority(value: unknown): value is AgentRunAuthorityV20 {
  return (
    isRecord(value) &&
    exactFields(value, ["contractVersion", "registryKey", "guidanceChecksum"]) &&
    value.contractVersion === "2.0" &&
    isNonEmptyString(value.registryKey) &&
    isSha256(value.guidanceChecksum)
  );
}

function isProtocol(value: unknown): value is AgentRunProtocolV20 {
  return (
    isRecord(value) &&
    exactFields(value, ["contractVersion", "finishContractVersion", "pendingContractVersion"]) &&
    value.contractVersion === "2.0" &&
    value.finishContractVersion === "2.0" &&
    value.pendingContractVersion === "2.0"
  );
}

function isCatalog(value: unknown): value is AgentRunCatalogV20 {
  return (
    isRecord(value) &&
    exactFields(value, [
      "contractVersion",
      "facadeVersion",
      "snapshotId",
      "revision",
      "checksum"
    ]) &&
    value.contractVersion === "2.0" &&
    isFacadeVersion(value.facadeVersion) &&
    isSafeId(value.snapshotId) &&
    isNonEmptyString(value.revision) &&
    isSha256(value.checksum)
  );
}

function isCapabilities(value: unknown): value is AgentRunCapabilitiesV20 {
  return (
    isRecord(value) &&
    exactFields(value, ["contractVersion", "revision", "state", "changeReason"]) &&
    value.contractVersion === "2.0" &&
    positiveInteger(value.revision) &&
    (value.state === "active" || value.state === "capability_changed") &&
    (value.changeReason === null || isNonEmptyString(value.changeReason))
  );
}

function isPending(value: unknown): value is AgentRunPendingV20 {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "none") return exactFields(value, ["kind"]);
  if (value.kind === "user_input" || value.kind === "context_share_approval") {
    return exactFields(value, ["kind", "requestId"]) && isSafeId(value.requestId);
  }
  if (value.kind === "write_approval") {
    return (
      exactFields(value, ["kind", "changeSetId", "revision", "checksum"]) &&
      isSafeId(value.changeSetId) &&
      positiveInteger(value.revision) &&
      isSha256(value.checksum)
    );
  }
  if (value.kind === "tool_approval") {
    return exactFields(value, ["kind", "approval"]) && isPendingToolApproval(value.approval);
  }
  if (value.kind === "external_outcome_resolution") {
    return exactFields(value, ["kind", "toolCallId"]) && isSafeId(value.toolCallId);
  }
  if (value.kind === "context_stale") {
    return (
      exactFields(value, ["kind", "contextSnapshotId"]) && isNullableSafeId(value.contextSnapshotId)
    );
  }
  if (value.kind === "plan_decision") {
    return (
      exactFields(value, ["kind", "planId", "revision"]) &&
      isSafeId(value.planId) &&
      positiveInteger(value.revision)
    );
  }
  if (value.kind === "plan_revision") {
    return (
      exactFields(value, ["kind", "requestId", "planExecutionId", "revision"]) &&
      isSafeId(value.requestId) &&
      isSafeId(value.planExecutionId) &&
      positiveInteger(value.revision)
    );
  }
  if (value.kind === "recovery_required") {
    return exactFields(value, ["kind", "recoveryId"]) && isSafeId(value.recoveryId);
  }
  return false;
}

function isFinish(value: unknown): value is AgentRunFinishV20 {
  if (
    !isRecord(value) ||
    !exactFields(value, ["state", "report"]) ||
    (value.state !== "not_finished" && value.state !== "completed" && value.state !== "blocked")
  )
    return false;
  if (value.state === "not_finished") return value.report === null;
  return isPersistedFinishReport(value.report) && value.report.outcome === value.state;
}

function isNullableFinishReport(value: unknown): value is FinishReportV2 | null {
  return value === null || isPersistedFinishReport(value);
}

function isPersistedFinishReport(value: unknown): value is FinishReportV2 {
  return isRecord(value) && value.schemaVersion === "2.0" && validateFinishInput(value).ok;
}

function isProviderCapabilities(value: unknown): value is AgentProviderCapabilitySnapshotV13 {
  return (
    isRecord(value) &&
    exactFields(value, [
      "profileId",
      "provider",
      "modelName",
      "streaming",
      "toolCalling",
      "structuredArguments",
      "contextWindow",
      "requiredContextTokens",
      "promptCache"
    ]) &&
    isNonEmptyString(value.profileId) &&
    isNonEmptyString(value.provider) &&
    isNonEmptyString(value.modelName) &&
    value.streaming === true &&
    typeof value.toolCalling === "boolean" &&
    typeof value.structuredArguments === "boolean" &&
    positiveInteger(value.contextWindow) &&
    nonNegativeInteger(value.requiredContextTokens) &&
    isPromptCacheCapability(value.promptCache)
  );
}

function isPromptCacheCapability(value: unknown): value is AgentPromptCacheCapabilitySnapshot {
  return (
    isRecord(value) &&
    exactFields(value, [
      "mode",
      "policyVersion",
      "minimumCacheableTokens",
      "ttlSeconds",
      "inputTokenSemantics",
      "reportsCacheReadTokens",
      "reportsCacheWriteTokens"
    ]) &&
    ["none", "automatic_prefix", "explicit_breakpoints", "explicit_resource"].includes(
      String(value.mode)
    ) &&
    isNonEmptyString(value.policyVersion) &&
    nonNegativeInteger(value.minimumCacheableTokens) &&
    (value.ttlSeconds === null || positiveInteger(value.ttlSeconds)) &&
    ["included_in_input", "excluded_from_input", "unavailable"].includes(
      String(value.inputTokenSemantics)
    ) &&
    typeof value.reportsCacheReadTokens === "boolean" &&
    typeof value.reportsCacheWriteTokens === "boolean"
  );
}

function isUsageSummary(value: unknown): value is AgentRunUsageSummary {
  if (!isRecord(value)) return false;
  const required = [
    "inputTokens",
    "outputTokens",
    "cacheOutcome",
    "cacheUsageStatus",
    "cacheInputTokenSemantics",
    "totalTokens",
    "usageStatus"
  ];
  const allowed = [
    ...required,
    "cachedTokens",
    "cacheReadTokens",
    "cacheWriteTokens",
    "cacheEligibleInputTokens",
    "cacheBypassReason",
    "reasoningTokens"
  ];
  return (
    required.every((field) => field in value) &&
    hasOnlyFields(value, allowed) &&
    [
      value.inputTokens,
      value.outputTokens,
      value.totalTokens,
      value.cachedTokens,
      value.cacheReadTokens,
      value.cacheWriteTokens,
      value.cacheEligibleInputTokens,
      value.reasoningTokens
    ].every((item) => item === undefined || nonNegativeInteger(item)) &&
    ["hit", "miss", "bypass", "unknown"].includes(String(value.cacheOutcome)) &&
    ["actual", "derived", "unavailable"].includes(String(value.cacheUsageStatus)) &&
    ["included_in_input", "excluded_from_input", "unavailable"].includes(
      String(value.cacheInputTokenSemantics)
    ) &&
    (value.cacheBypassReason === undefined ||
      [
        "policy_none",
        "unsupported_provider",
        "below_minimum_tokens",
        "identity_unverified",
        "resource_unavailable",
        "resource_create_failed",
        "resource_expired",
        "cache_error",
        "usage_unavailable"
      ].includes(String(value.cacheBypassReason))) &&
    ["actual", "estimated", "missing"].includes(String(value.usageStatus))
  );
}

function isPendingToolApproval(value: unknown): value is PendingToolApproval {
  return (
    isRecord(value) &&
    exactFields(value, [
      "binding",
      "canonicalToolId",
      "providerToolName",
      "argumentsText",
      "requestedAt"
    ]) &&
    isToolApprovalBinding(value.binding) &&
    isNonEmptyString(value.canonicalToolId) &&
    isNonEmptyString(value.providerToolName) &&
    isBoundedText(value.argumentsText) &&
    isNonEmptyString(value.requestedAt)
  );
}

function isToolApprovalBinding(value: unknown): value is ToolApprovalBinding {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  const common =
    isSafeId(value.bindingId) &&
    isSafeId(value.runId) &&
    positiveInteger(value.runRevision) &&
    isSafeId(value.toolCallId) &&
    positiveInteger(value.effectiveCapabilityRevision) &&
    isNonEmptyString(value.expiresAt);
  if (!common) return false;
  if (value.kind === "task") {
    return (
      exactFields(value, [
        "kind",
        "bindingId",
        "runId",
        "runRevision",
        "toolCallId",
        "taskId",
        "snapshotDigest",
        "parametersDigest",
        "catalogRevision",
        "attestationRef",
        "executionSnapshotId",
        "effectiveCapabilityRevision",
        "expiresAt"
      ]) &&
      isSafeId(value.taskId) &&
      isSha256(value.snapshotDigest) &&
      isSha256(value.parametersDigest) &&
      isNonEmptyString(value.catalogRevision) &&
      isSafeId(value.attestationRef) &&
      isSafeId(value.executionSnapshotId)
    );
  }
  if (value.kind === "network") {
    return (
      exactFields(value, [
        "kind",
        "bindingId",
        "runId",
        "runRevision",
        "toolCallId",
        "destination",
        "requestDigest",
        "egressClass",
        "effectiveCapabilityRevision",
        "expiresAt"
      ]) &&
      isNonEmptyString(value.destination) &&
      isSha256(value.requestDigest) &&
      isNonEmptyString(value.egressClass)
    );
  }
  if (value.kind === "external") {
    return (
      exactFields(value, [
        "kind",
        "bindingId",
        "runId",
        "runRevision",
        "toolCallId",
        "sourceId",
        "descriptorDigest",
        "argumentDigest",
        "idempotencyKey",
        "effectiveCapabilityRevision",
        "expiresAt"
      ]) &&
      isSafeId(value.sourceId) &&
      isSha256(value.descriptorDigest) &&
      isSha256(value.argumentDigest) &&
      isSafeId(value.idempotencyKey)
    );
  }
  return false;
}

function isLimits(value: unknown): value is AgentRunLimits {
  return (
    isRecord(value) &&
    exactFields(value, ["maxModelRounds", "maxToolCalls", "maxConsecutiveToolFailures"]) &&
    positiveInteger(value.maxModelRounds) &&
    positiveInteger(value.maxToolCalls) &&
    positiveInteger(value.maxConsecutiveToolFailures)
  );
}

function nullablePairMatches(left: unknown, right: unknown): boolean {
  return (left === null && right === null) || (left !== null && right !== null);
}

function isTerminalStatus(status: AgentRunStatusV20): boolean {
  return ["completed", "blocked", "cancelled", "failed", "limit_reached"].includes(status);
}

function isTerminalRunEvent(type: AgentRunEventTypeV20): boolean {
  return [
    "run_completed",
    "run_blocked",
    "run_cancelled",
    "run_failed",
    "run_limit_reached"
  ].includes(type);
}

function isTerminalAuditEvent(type: AgentRunEventTypeV20): boolean {
  return ["run_undo_started", "run_undo_review_required", "run_undone", "run_undo_failed"].includes(
    type
  );
}

function terminalEventForStatus(status: AgentRunStatusV20): AgentRunEventTypeV20 | undefined {
  if (status === "completed") return "run_completed";
  if (status === "blocked") return "run_blocked";
  if (status === "cancelled") return "run_cancelled";
  if (status === "failed") return "run_failed";
  if (status === "limit_reached") return "run_limit_reached";
  return undefined;
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStrictAgentContextScope(value: unknown): boolean {
  if (!isAgentContextScope(value) || !isRecord(value)) return false;
  return value.kind === "standalone"
    ? exactFields(value, ["kind", "scopeId"])
    : exactFields(value, ["kind", "workspaceKind", "workspaceId"]);
}

function exactFields(value: JsonObject, fields: readonly string[]): boolean {
  return Object.keys(value).length === fields.length && hasOnlyFields(value, fields);
}

function hasOnlyFields(value: JsonObject, fields: readonly string[]): boolean {
  const allowed = new Set(fields);
  return Object.keys(value).every((field) => allowed.has(field));
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value);
}

function isNonEmptyString(value: unknown): value is string {
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

function isBoundedText(value: unknown): value is string {
  return typeof value === "string" && value.length <= 1_048_576 && !value.includes("\u0000");
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isNullableSha256(value: unknown): value is string | null {
  return value === null || isSha256(value);
}

function isNullableSafeId(value: unknown): value is string | null {
  return value === null || isSafeId(value);
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isNullablePositiveInteger(value: unknown): value is number | null {
  return value === null || positiveInteger(value);
}

function isOperationMode(value: unknown): boolean {
  return value === "conversation" || value === "planning" || value === "execution";
}

function isContextMode(value: unknown): boolean {
  return value === "standalone_chat" || value === "writing" || value === "general_file";
}

function isWritePolicy(value: unknown): boolean {
  return value === "write_before_confirmation" || value === "user_preapproved_run";
}

function isStatus(value: unknown): value is AgentRunStatusV20 {
  return typeof value === "string" && STATUS_VALUES.has(value as AgentRunStatusV20);
}

function isEventType(value: unknown): value is AgentRunEventTypeV20 {
  return typeof value === "string" && EVENT_TYPES.has(value as AgentRunEventTypeV20);
}

function isRecoveryState(value: unknown): value is AgentRunRecoveryState {
  return ["none", "retryable", "awaiting_context_refresh", "recovery_review", "terminal"].includes(
    String(value)
  );
}

function isFacadeVersion(value: unknown): value is AgentToolFacadeVersion {
  return value === "v1" || value === "v2";
}

function isContextProfileId(value: unknown): value is AgentContextProfileId {
  return ["standalone", "writing", "creative_general", "engineering"].includes(String(value));
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}

function invalid<T>(code: string): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      errorId: `agent_run_v20_${code.toLowerCase()}`,
      code,
      category: "ValidationError",
      message: "Agent run V20 data is invalid.",
      recoverability: "fatal",
      suggestedAction: "Reject the invalid V20 record and retain it for recovery review.",
      traceId: "agent-run-v20"
    })
  );
}
