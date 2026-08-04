import {
  createUnifiedError,
  err,
  ok,
  type JsonObject,
  type Result,
  type UnifiedError
} from "@novel-studio/shared";

/** The only completion report contract accepted by a new finish call. */
export const FINISH_REPORT_SCHEMA_VERSION = "2.0" as const;
export const FINISH_REPORT_MAX_TEXT_BYTES = 16 * 1024;
export const FINISH_REPORT_MAX_ITEMS = 128;
export const FINISH_REPORT_MAX_EVIDENCE_REFS = 128;

export type FinishOutcome = "completed" | "blocked";

export interface FinishReportBodyV2 {
  readonly result: string;
  readonly appliedChanges: readonly string[];
  readonly verification: readonly string[];
  readonly residualRisks: readonly string[];
  readonly nextStep?: string;
}

/**
 * Strict arguments accepted by the `finish` protocol tool. `schemaVersion` is optional for the
 * provider-facing tool arguments (the tool is already selected from a versioned catalog), but if
 * present it must be the current version. Persisted reports should use `createFinishReport`, which
 * always materializes the version explicitly.
 */
export interface FinishInputV2 {
  readonly schemaVersion?: typeof FINISH_REPORT_SCHEMA_VERSION;
  readonly outcome: FinishOutcome;
  readonly report: FinishReportBodyV2;
  readonly evidenceRefs: readonly string[];
}

export interface FinishReportV2 extends FinishInputV2 {
  readonly schemaVersion: typeof FINISH_REPORT_SCHEMA_VERSION;
}

/**
 * App-authored, durable evidence identifiers accepted by strict execution finishes. Model prose
 * remains in the report while the coordinator binds each applied/verification claim to one of
 * these identifiers.
 */
export type FinishEvidenceRef =
  | {
      readonly kind: "write_applied";
      readonly sequence: number;
      readonly changeSetId: string;
      readonly revision: number;
      readonly checksum: string;
    }
  | { readonly kind: "tool_completed"; readonly sequence: number; readonly toolCallId: string }
  | { readonly kind: "tool_failed"; readonly sequence: number; readonly toolCallId: string }
  | {
      readonly kind: "completion_evidence";
      readonly sequence: number;
      readonly evidenceKind: string;
    };

export function formatWriteAppliedEvidenceRef(input: {
  readonly sequence: number;
  readonly changeSetId: string;
  readonly revision: number;
  readonly checksum: string;
}): string {
  return `run-event/${input.sequence}/write_applied/${input.changeSetId}/${input.revision}/${input.checksum}`;
}

export function formatToolCompletionEvidenceRef(input: {
  readonly sequence: number;
  readonly toolCallId: string;
}): string {
  return `run-event/${input.sequence}/tool_completed/${input.toolCallId}`;
}

export function formatCompletionEvidenceRef(input: {
  readonly sequence: number;
  readonly evidenceKind: string;
}): string {
  return `run-event/${input.sequence}/completion_evidence_recorded/${input.evidenceKind}`;
}

export function parseFinishEvidenceRef(value: string): FinishEvidenceRef | undefined {
  const parts = value.split("/");
  const sequence = Number(parts[1]);
  const eventType = parts[2];
  const binding = parts[3];
  const revision = parts[4];
  const checksum = parts[5];
  if (parts[0] !== "run-event" || !Number.isSafeInteger(sequence) || sequence < 1) return undefined;
  if (
    parts.length === 6 &&
    eventType === "write_applied" &&
    binding !== undefined &&
    isSafeId(binding) &&
    revision !== undefined &&
    isPositiveIntegerText(revision) &&
    checksum !== undefined &&
    isChecksum(checksum)
  ) {
    return {
      kind: "write_applied",
      sequence,
      changeSetId: binding,
      revision: Number(revision),
      checksum
    };
  }
  if (
    parts.length === 4 &&
    (eventType === "tool_completed" || eventType === "tool_failed") &&
    binding !== undefined &&
    isSafeId(binding)
  ) {
    return eventType === "tool_completed"
      ? { kind: "tool_completed", sequence, toolCallId: binding }
      : { kind: "tool_failed", sequence, toolCallId: binding };
  }
  if (
    parts.length === 4 &&
    eventType === "completion_evidence_recorded" &&
    binding !== undefined &&
    isSafeId(binding)
  ) {
    return { kind: "completion_evidence", sequence, evidenceKind: binding };
  }
  return undefined;
}

/** Run state used by the finish gate. It deliberately accepts strings so legacy callers cannot
 * gain a new completion state merely by widening a TypeScript union. */
export interface FinishRunState {
  readonly status?: string;
  readonly recoveryState?: string;
  readonly pendingUserInputId?: string | null;
  readonly pendingChangeSetId?: string | null;
  readonly pendingToolApproval?: unknown | null;
  readonly activeErrorId?: string | null;
}

const REPORT_KEYS = new Set([
  "result",
  "appliedChanges",
  "verification",
  "residualRisks",
  "nextStep"
]);
const INPUT_KEYS = new Set(["schemaVersion", "outcome", "report", "evidenceRefs"]);
const FINISHABLE_STATUSES = new Set(["planning_model", "executing_model", "conversation_model"]);
const PENDING_TRANSITION_STATUSES = new Set([
  "created",
  "executing_read_tool",
  "staging_changes",
  "awaiting_write_approval",
  "applying_changes",
  "stopping_after_transaction",
  "awaiting_user_input",
  "awaiting_context_refresh",
  "plan_ready",
  "awaiting_plan_decision",
  "context_compacting",
  "awaiting_plan_revision",
  "awaiting_tool_approval",
  "awaiting_external_outcome_resolution"
]);

/** Build an immutable, explicitly versioned persisted report. */
export function createFinishReport(
  input: Omit<FinishInputV2, "schemaVersion">
): Result<FinishReportV2, UnifiedError> {
  const validated = validateFinishInput({ ...input, schemaVersion: FINISH_REPORT_SCHEMA_VERSION });
  return validated.ok ? ok(validated.value as FinishReportV2) : validated;
}

/** Validate provider/tool input and reject legacy or unknown versions fail closed. */
export function validateFinishInput(value: unknown): Result<FinishInputV2, UnifiedError> {
  if (!isObject(value)) return invalid("The finish input must be an object.");
  if (Object.keys(value).some((key) => !INPUT_KEYS.has(key))) {
    return invalid("The finish input contains an unknown field.");
  }
  if (value.schemaVersion !== undefined && value.schemaVersion !== FINISH_REPORT_SCHEMA_VERSION) {
    return invalidVersion();
  }
  if (value.outcome !== "completed" && value.outcome !== "blocked") {
    return invalid("The finish outcome must be completed or blocked.");
  }
  if (!isObject(value.report) || Object.keys(value.report).some((key) => !REPORT_KEYS.has(key))) {
    return invalid("The finish report has an unknown or missing field.");
  }
  const report = value.report as Record<string, unknown>;
  if (!isNonEmptyText(report.result) || !validStringArray(report.appliedChanges)) {
    return invalid("The finish report result or appliedChanges is invalid.");
  }
  if (!validStringArray(report.verification) || !validStringArray(report.residualRisks)) {
    return invalid("The finish report verification or residualRisks is invalid.");
  }
  if (report.nextStep !== undefined && !isNonEmptyText(report.nextStep)) {
    return invalid("The finish report nextStep must be a non-empty string when present.");
  }
  if (!validEvidenceRefs(value.evidenceRefs)) {
    return invalid("The finish evidenceRefs must contain unique non-empty references.");
  }
  if (value.outcome === "blocked" && report.nextStep === undefined) {
    return invalid("A blocked finish must provide a nextStep.", "AGENT_FINISH_NEXT_STEP_REQUIRED");
  }
  if (value.outcome === "completed" && (report.verification as readonly string[]).length === 0) {
    return invalid(
      "A completed finish must include verification, including an explicit not-run statement when applicable.",
      "AGENT_FINISH_VERIFICATION_REQUIRED"
    );
  }
  return ok(value as unknown as FinishInputV2);
}

/** Alias used by persistence and repository callers. */
export const validateFinishReport = validateFinishInput;

/** Validate a report against the durable run state before changing the run to a terminal state. */
export function validateFinishForRun(
  value: unknown,
  state: FinishRunState
): Result<FinishInputV2, UnifiedError> {
  const parsed = validateFinishInput(value);
  if (!parsed.ok) return parsed;
  const status = state.status;
  if (
    status !== undefined &&
    (PENDING_TRANSITION_STATUSES.has(status) || !FINISHABLE_STATUSES.has(status))
  ) {
    return invalid(
      `A finish report is not allowed while the run is not in an active execution model state (${status}).`,
      "AGENT_FINISH_PENDING"
    );
  }
  const recoveryState = state.recoveryState;
  const hardRecoveryActive =
    recoveryState !== undefined && recoveryState !== "none" && recoveryState !== "retryable";
  if (hardRecoveryActive) {
    return invalid(
      "A finish report is not allowed while recovery is active.",
      "AGENT_FINISH_RECOVERY_ACTIVE"
    );
  }
  if (state.pendingUserInputId !== undefined && state.pendingUserInputId !== null) {
    return invalid(
      "A finish report is not allowed while user input is pending.",
      "AGENT_FINISH_PENDING"
    );
  }
  if (state.pendingChangeSetId !== undefined && state.pendingChangeSetId !== null) {
    return invalid(
      "A finish report is not allowed while a Change Set is pending.",
      "AGENT_FINISH_PENDING"
    );
  }
  if (state.pendingToolApproval !== undefined && state.pendingToolApproval !== null) {
    return invalid(
      "A finish report is not allowed while tool approval is pending.",
      "AGENT_FINISH_PENDING"
    );
  }
  if (
    parsed.value.outcome === "completed" &&
    ((recoveryState !== undefined && recoveryState !== "none") ||
      (state.activeErrorId !== undefined && state.activeErrorId !== null))
  ) {
    return invalid(
      "A finish report is not allowed while an active error requires recovery.",
      "AGENT_FINISH_RECOVERY_ACTIVE"
    );
  }
  return parsed;
}

export function isFinishPendingState(state: FinishRunState): boolean {
  if (
    (state.status !== undefined &&
      (PENDING_TRANSITION_STATUSES.has(state.status) || !FINISHABLE_STATUSES.has(state.status))) ||
    (state.recoveryState !== undefined &&
      state.recoveryState !== "none" &&
      state.recoveryState !== "retryable") ||
    (state.pendingUserInputId !== undefined && state.pendingUserInputId !== null) ||
    (state.pendingChangeSetId !== undefined && state.pendingChangeSetId !== null) ||
    (state.pendingToolApproval !== undefined && state.pendingToolApproval !== null) ||
    (state.activeErrorId !== undefined &&
      state.activeErrorId !== null &&
      state.recoveryState !== "retryable")
  ) {
    return true;
  }
  return (
    validateFinishForRun(
      {
        outcome: "blocked",
        report: {
          result: "state probe",
          appliedChanges: [],
          verification: [],
          residualRisks: [],
          nextStep: "resolve state"
        },
        evidenceRefs: ["run-event/1/completion_evidence_recorded/state"]
      },
      state
    ).ok === false
  );
}

/** JSON Schema used by catalog/pipeline integrations. */
export function finishInputSchemaV2(): JsonObject {
  return {
    type: "object",
    additionalProperties: false,
    required: ["outcome", "report", "evidenceRefs"],
    properties: {
      schemaVersion: { const: FINISH_REPORT_SCHEMA_VERSION },
      outcome: { type: "string", enum: ["completed", "blocked"] },
      report: {
        type: "object",
        additionalProperties: false,
        required: ["result", "appliedChanges", "verification", "residualRisks"],
        properties: {
          result: { type: "string", minLength: 1, maxLength: 16_384 },
          appliedChanges: {
            type: "array",
            items: { type: "string", minLength: 1 },
            maxItems: FINISH_REPORT_MAX_ITEMS
          },
          verification: {
            type: "array",
            items: { type: "string", minLength: 1 },
            maxItems: FINISH_REPORT_MAX_ITEMS
          },
          residualRisks: {
            type: "array",
            items: { type: "string", minLength: 1 },
            maxItems: FINISH_REPORT_MAX_ITEMS
          },
          nextStep: { type: "string", minLength: 1, maxLength: 16_384 }
        }
      },
      evidenceRefs: {
        type: "array",
        minItems: 1,
        maxItems: FINISH_REPORT_MAX_EVIDENCE_REFS,
        uniqueItems: true,
        items: {
          type: "string",
          minLength: 1,
          maxLength: 1024,
          pattern:
            "^run-event/[1-9][0-9]*/(write_applied|tool_completed|tool_failed|completion_evidence_recorded)/"
        }
      }
    }
  };
}

function validStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length <= FINISH_REPORT_MAX_ITEMS &&
    value.every((item) => isNonEmptyText(item))
  );
}

function validEvidenceRefs(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= FINISH_REPORT_MAX_EVIDENCE_REFS &&
    value.every(
      (item) =>
        isNonEmptyText(item) && item.length <= 1024 && parseFinishEvidenceRef(item) !== undefined
    ) &&
    new Set(value).size === value.length
  );
}

function isNonEmptyText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    utf8Bytes(value) <= FINISH_REPORT_MAX_TEXT_BYTES
  );
}

function isSafeId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(value);
}

function isPositiveIntegerText(value: string): boolean {
  return /^(?:[1-9][0-9]*)$/u.test(value) && Number.isSafeInteger(Number(value));
}

function isChecksum(value: string): boolean {
  return /^[a-f0-9]{64}$/u.test(value);
}

function invalid(
  message: string,
  code = "AGENT_FINISH_REPORT_INVALID"
): Result<never, UnifiedError> {
  return err(
    createUnifiedError({
      code,
      category: "AgentError",
      message,
      recoverability: "user-action",
      suggestedAction:
        "Provide a strict completed or blocked finish report with evidence references.",
      traceId: "agent-finish-report"
    })
  );
}

function invalidVersion(): Result<never, UnifiedError> {
  return invalid(
    `Only finish report schema ${FINISH_REPORT_SCHEMA_VERSION} is supported.`,
    "AGENT_FINISH_REPORT_VERSION_UNSUPPORTED"
  );
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
