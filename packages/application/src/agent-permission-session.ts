import {
  findPermissionSummaryDrift,
  generatePermissionSummary,
  type AgentContextMode,
  type AgentOperationMode,
  type AgentToolLister,
  type AgentWritePolicy,
  type PermissionSummary,
  type PermissionSummaryFieldDrift
} from "@novel-studio/agent-engine";
import {
  createUnifiedError,
  err,
  ok,
  type JsonObject,
  type Result,
  type UnifiedError
} from "@novel-studio/shared";

/**
 * Persistence for the Permission Summary artifact, bound under a run once the run exists. Mirrors
 * `writeContextSnapshot`/`writeBudgetSnapshot`'s shape: one artifact write per run, no renderer-facing
 * conflict semantics (a run creates its summary exactly once).
 */
export interface AgentPermissionSessionRepository {
  writePermissionSummary(runId: string, summary: JsonObject): Promise<Result<JsonObject, UnifiedError>>;
  readPermissionSummary?(
    runId: string,
    permissionSummaryId: string
  ): Promise<Result<JsonObject | undefined, UnifiedError>>;
}

/**
 * Resolves the canonical project root fingerprint the summary binds to. Server-side only: the
 * fingerprint must reflect the actual canonical (symlink-resolved) project root the Path Guard
 * enforces, never a renderer-supplied path string.
 */
export interface AgentPermissionRootFingerprintPort {
  resolveRootFingerprint(projectId: string): Promise<Result<string, UnifiedError>>;
}

export interface PreparePermissionSummaryInput {
  readonly projectId: string;
  readonly runDraftId: string;
  readonly runDraftRevision: number;
  readonly operationMode: AgentOperationMode;
  readonly contextMode: AgentContextMode;
  readonly writePolicy: AgentWritePolicy;
}

export type VerifyPermissionSummaryForStartInput = PreparePermissionSummaryInput;

export type PreparePermissionSummaryForPlanHandoffInput = Omit<
  PreparePermissionSummaryInput,
  "runDraftRevision"
>;

export interface BindPermissionSummaryToRunInput {
  readonly runId: string;
  readonly summary: PermissionSummary;
}

export interface ReadPermissionSummaryForRunInput {
  readonly runId: string;
  readonly permissionSummaryId: string;
}

export interface AgentPermissionSession {
  /**
   * Generate a fresh, unpersisted Permission Summary from the current Tool Registry, the canonical
   * root fingerprint, and the draft's facts, and remember it as the last summary shown for this
   * `runDraftId`. Used for the pre-run preview (the composer's "本次权限摘要" entry point).
   */
  prepareForDraft(
    input: PreparePermissionSummaryInput
  ): Promise<Result<PermissionSummary, UnifiedError>>;
  /**
   * Regenerate the summary at run-start time from the current Tool Registry, root fingerprint, and
   * draft facts, and — when a summary was previously prepared for this `runDraftId` — compare it
   * field-by-field against that regeneration. A field drift (root fingerprint changed, Tool Registry
   * revision changed, resolved write policy changed, etc.) fails the run start rather than silently
   * starting under stale permissions. A draft never previewed has nothing to drift from and always
   * succeeds with the freshly generated summary.
   */
  verifyForStart(
    input: VerifyPermissionSummaryForStartInput
  ): Promise<Result<PermissionSummary, UnifiedError>>;
  /** Generate fresh server-owned facts for a plan handoff, without treating it as a draft preview. */
  prepareForPlanHandoff(
    input: PreparePermissionSummaryForPlanHandoffInput
  ): Promise<Result<PermissionSummary, UnifiedError>>;
  /** Persist the summary under the now-existing run, stamping `runId` onto the bound copy. */
  bindToRun(input: BindPermissionSummaryToRunInput): Promise<Result<PermissionSummary, UnifiedError>>;
  /** Read the immutable, server-persisted summary bound to an existing run. */
  readForRun(
    input: ReadPermissionSummaryForRunInput
  ): Promise<Result<PermissionSummary | undefined, UnifiedError>>;
}

export interface CreateAgentPermissionSessionOptions {
  readonly repository: AgentPermissionSessionRepository;
  readonly rootFingerprint: AgentPermissionRootFingerprintPort;
  readonly now?: () => string;
  readonly createId?: () => string;
  /** Injectable Tool Registry lister; defaults to the real registry. Tests use it to prove drift. */
  readonly listTools?: AgentToolLister;
}

export function createAgentPermissionSession(
  options: CreateAgentPermissionSessionOptions
): AgentPermissionSession {
  const now = options.now ?? (() => new Date().toISOString());
  const createId = options.createId ?? createDefaultPermissionSummaryId;
  const lastPreparedByDraft = new Map<
    string,
    { readonly revision: number; readonly summary: PermissionSummary }
  >();

  async function generate(
    input: PreparePermissionSummaryForPlanHandoffInput
  ): Promise<Result<PermissionSummary, UnifiedError>> {
    const fingerprint = await options.rootFingerprint.resolveRootFingerprint(input.projectId);
    if (!fingerprint.ok) return err(fingerprint.error);
    return ok(
      generatePermissionSummary({
        permissionSummaryId: createId(),
        projectId: input.projectId,
        runDraftId: input.runDraftId,
        operationMode: input.operationMode,
        contextMode: input.contextMode,
        writePolicy: input.writePolicy,
        rootFingerprint: fingerprint.value,
        generatedAt: now(),
        ...(options.listTools === undefined ? {} : { listTools: options.listTools })
      })
    );
  }

  return {
    async prepareForDraft(input) {
      const generated = await generate(input);
      if (!generated.ok) return generated;
      lastPreparedByDraft.set(input.runDraftId, {
        revision: input.runDraftRevision,
        summary: generated.value
      });
      return generated;
    },

    async verifyForStart(input) {
      const regenerated = await generate(input);
      if (!regenerated.ok) return regenerated;
      const previous = lastPreparedByDraft.get(input.runDraftId);
      if (previous === undefined || previous.revision !== input.runDraftRevision) {
        return regenerated;
      }
      const drift = findPermissionSummaryDrift(previous.summary, regenerated.value);
      if (drift.length > 0) {
        return err(permissionSummaryDriftError(drift));
      }
      return regenerated;
    },

    prepareForPlanHandoff: generate,

    async bindToRun(input) {
      const bound: PermissionSummary = { ...input.summary, runId: input.runId };
      const written = await options.repository.writePermissionSummary(
        input.runId,
        bound as unknown as JsonObject
      );
      if (!written.ok) return err(written.error);
      return ok(bound);
    },

    async readForRun(input) {
      if (options.repository.readPermissionSummary === undefined) {
        return err(permissionSummaryReadUnavailable());
      }
      const read = await options.repository.readPermissionSummary(
        input.runId,
        input.permissionSummaryId
      );
      if (!read.ok || read.value === undefined) return read as Result<undefined, UnifiedError>;
      return isPermissionSummary(read.value, input)
        ? ok(read.value as unknown as PermissionSummary)
        : err(permissionSummaryInvalid());
    }
  };
}

function permissionSummaryDriftError(drift: readonly PermissionSummaryFieldDrift[]): UnifiedError {
  return createUnifiedError({
    code: "AGENT_PERMISSION_SUMMARY_STALE",
    category: "AgentError",
    message: "The Agent run's permission summary is stale and no longer matches the current Tool Registry or project root.",
    recoverability: "user-action",
    suggestedAction: "Reopen the permission summary and retry.",
    traceId: "agent-permission-session",
    redactedDetail: { driftedFields: drift.map((entry) => entry.field) }
  });
}

function createDefaultPermissionSummaryId(): string {
  return `permission_summary_${Math.random().toString(36).slice(2, 10)}`;
}

function isPermissionSummary(
  value: JsonObject,
  input: ReadPermissionSummaryForRunInput
): boolean {
  return (
    value["schemaVersion"] === "1.0" &&
    value["runId"] === input.runId &&
    value["permissionSummaryId"] === input.permissionSummaryId &&
    typeof value["projectId"] === "string" &&
    typeof value["runDraftId"] === "string" &&
    (value["contextMode"] === "writing" || value["contextMode"] === "general_file") &&
    (value["writePolicy"] === "write_before_confirmation" ||
      value["writePolicy"] === "user_preapproved_run") &&
    typeof value["toolRegistryRevision"] === "string" &&
    typeof value["rootFingerprint"] === "string" &&
    Array.isArray(value["readCapabilities"]) &&
    Array.isArray(value["proposalCapabilities"]) &&
    Array.isArray(value["forbiddenCapabilities"]) &&
    typeof value["checksum"] === "string" &&
    typeof value["generatedAt"] === "string"
  );
}

function permissionSummaryReadUnavailable(): UnifiedError {
  return createUnifiedError({
    code: "AGENT_PERMISSION_SUMMARY_READ_UNAVAILABLE",
    category: "AgentError",
    message: "The persisted Agent permission summary cannot be read.",
    recoverability: "user-action",
    suggestedAction: "Reload the run and try again.",
    traceId: "agent-permission-session"
  });
}

function permissionSummaryInvalid(): UnifiedError {
  return createUnifiedError({
    code: "AGENT_PERMISSION_SUMMARY_INVALID",
    category: "AgentError",
    message: "The persisted Agent permission summary is invalid.",
    recoverability: "fatal",
    suggestedAction: "Inspect the run history record.",
    traceId: "agent-permission-session"
  });
}
