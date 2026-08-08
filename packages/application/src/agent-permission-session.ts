import {
  computeProviderMappingRevision,
  findPermissionSummaryDrift,
  generatePermissionSummary,
  generatePermissionSummaryV2,
  hasValidPermissionSummaryChecksums,
  isPermissionSummaryV20,
  parsePermissionSummaryV20,
  type AgentContextMode,
  type AgentOperationMode,
  type AgentToolCapabilitySnapshot,
  type AgentToolDescriptor,
  type AgentToolLister,
  type AgentWriteMutationTrust,
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
  writePermissionSummary(
    runId: string,
    summary: JsonObject
  ): Promise<Result<JsonObject, UnifiedError>>;
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
  /** Frozen Main-process capability fact for this pending run. */
  readonly capabilitySnapshot?: AgentToolCapabilitySnapshot;
  /** Frozen, server-validated plugin/MCP descriptor directory for this pending run. */
  readonly externalToolDescriptors?: readonly AgentToolDescriptor[];
  /** Revision from the immutable canonical-id <-> provider-name mapping. */
  readonly providerMappingRevision?: string;
  /** Target Permission Summary/catalog schema for this run. Legacy callers default to 1.1. */
  readonly catalogSchemaVersion?: "1.0" | "2.0";
  /** Frozen final provider directory for a 2.0 summary. */
  readonly frozenToolDescriptors?: readonly AgentToolDescriptor[];
  /** Main-owned acknowledgement/qualification facts for limited preapproval. */
  readonly writePolicyAcknowledged?: boolean;
  readonly limitedRunPreapprovalQualified?: boolean;
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
  bindToRun(
    input: BindPermissionSummaryToRunInput
  ): Promise<Result<PermissionSummary, UnifiedError>>;
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
  /** Main-owned classification of the write backend available to this runtime. */
  readonly writeMutationTrust?: AgentWriteMutationTrust;
  /** Main-owned defaults used by renderer permission previews that omit runtime capabilities. */
  readonly defaultCapabilitySnapshot?: AgentToolCapabilitySnapshot;
  readonly defaultExternalToolDescriptors?: readonly AgentToolDescriptor[];
  /** Injectable Tool Registry lister; defaults to the real registry. Tests use it to prove drift. */
  readonly listTools?: AgentToolLister;
  readonly catalogSchemaVersion?: "1.0" | "2.0";
  /** Immutable registered rule-set version selected by Main for this workspace profile. */
  readonly approvalRuleSetVersion?: string;
  readonly limitedRunPreapprovalQualified?: boolean;
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
    const common = {
      permissionSummaryId: createId(),
      projectId: input.projectId,
      runDraftId: input.runDraftId,
      operationMode: input.operationMode,
      contextMode: input.contextMode,
      writePolicy: input.writePolicy,
      rootFingerprint: fingerprint.value,
      generatedAt: now(),
      writeMutationTrust: options.writeMutationTrust ?? "unavailable",
      ...((input.capabilitySnapshot ?? options.defaultCapabilitySnapshot) === undefined
        ? {}
        : {
            capabilitySnapshot: input.capabilitySnapshot ?? options.defaultCapabilitySnapshot
          }),
      ...((input.externalToolDescriptors ?? options.defaultExternalToolDescriptors) === undefined
        ? {}
        : {
            externalToolDescriptors:
              input.externalToolDescriptors ?? options.defaultExternalToolDescriptors
          }),
      ...(input.providerMappingRevision === undefined
        ? {}
        : { providerMappingRevision: input.providerMappingRevision }),
      ...(options.listTools === undefined ? {} : { listTools: options.listTools })
    } satisfies Omit<
      Parameters<typeof generatePermissionSummary>[0],
      "permissionSummaryId" | "generatedAt"
    > & { permissionSummaryId: string; generatedAt: string };
    if ((input.catalogSchemaVersion ?? options.catalogSchemaVersion ?? "1.0") === "2.0") {
      if (
        input.frozenToolDescriptors !== undefined &&
        input.providerMappingRevision !== undefined
      ) {
        const computedProviderMappingRevision = computeProviderMappingRevision(
          input.frozenToolDescriptors
        );
        if (input.providerMappingRevision !== computedProviderMappingRevision) {
          return err(
            permissionSummaryDriftError([
              {
                field: "providerMappingRevision",
                stored: input.providerMappingRevision,
                regenerated: computedProviderMappingRevision
              }
            ])
          );
        }
      }
      return ok(
        generatePermissionSummaryV2({
          ...common,
          ...(options.approvalRuleSetVersion === undefined
            ? {}
            : { approvalRuleSetVersion: options.approvalRuleSetVersion }),
          ...(input.frozenToolDescriptors === undefined
            ? {}
            : { frozenToolDescriptors: input.frozenToolDescriptors }),
          ...(input.writePolicyAcknowledged === undefined
            ? {}
            : { writePolicyAcknowledged: input.writePolicyAcknowledged }),
          limitedRunPreapprovalQualified:
            input.limitedRunPreapprovalQualified ?? options.limitedRunPreapprovalQualified ?? false
        })
      );
    }
    return ok(
      generatePermissionSummary({
        ...common
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
      const bound: PermissionSummary = isPermissionSummaryV20(input.summary)
        ? parsePermissionSummaryV20({ ...input.summary, runId: input.runId })
        : { ...input.summary, runId: input.runId };
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
      const parsed = parsePersistedPermissionSummary(read.value, input);
      return parsed === undefined ? err(permissionSummaryInvalid()) : ok(parsed);
    }
  };
}

function permissionSummaryDriftError(drift: readonly PermissionSummaryFieldDrift[]): UnifiedError {
  return createUnifiedError({
    code: "AGENT_PERMISSION_SUMMARY_STALE",
    category: "AgentError",
    message:
      "The Agent run's permission summary is stale and no longer matches the current Tool Registry or project root.",
    recoverability: "user-action",
    suggestedAction: "Reopen the permission summary and retry.",
    traceId: "agent-permission-session",
    redactedDetail: { driftedFields: drift.map((entry) => entry.field) }
  });
}

function createDefaultPermissionSummaryId(): string {
  return `permission_summary_${Math.random().toString(36).slice(2, 10)}`;
}

function isPermissionSummary(value: JsonObject, input: ReadPermissionSummaryForRunInput): boolean {
  if (value["schemaVersion"] === "2.0") {
    return parsePersistedPermissionSummary(value, input) !== undefined;
  }
  if (
    (value["schemaVersion"] !== "1.0" && value["schemaVersion"] !== "1.1") ||
    value["permissionSummaryId"] !== input.permissionSummaryId ||
    value["runId"] !== input.runId ||
    typeof value["projectId"] !== "string" ||
    typeof value["runDraftId"] !== "string" ||
    (value["contextMode"] !== "writing" && value["contextMode"] !== "general_file") ||
    (value["writePolicy"] !== "write_before_confirmation" &&
      value["writePolicy"] !== "user_preapproved_run") ||
    typeof value["toolRegistryRevision"] !== "string" ||
    typeof value["rootFingerprint"] !== "string" ||
    !isStringArray(value["readCapabilities"]) ||
    !isStringArray(value["proposalCapabilities"]) ||
    !isStringArray(value["forbiddenCapabilities"]) ||
    typeof value["checksum"] !== "string" ||
    typeof value["generatedAt"] !== "string"
  ) {
    return false;
  }
  if (value["schemaVersion"] === "1.1") {
    if (
      (value["workspaceKind"] !== "creativeProject" &&
        value["workspaceKind"] !== "engineeringWorkspace") ||
      (value["operationMode"] !== "planning" && value["operationMode"] !== "execution") ||
      !isStringArray(value["executeCapabilities"]) ||
      !isStringArray(value["externalReadCapabilities"]) ||
      !isStringArray(value["externalActionCapabilities"]) ||
      !isStringArray(value["dataEgressCapabilities"]) ||
      typeof value["featureFlagRevision"] !== "string" ||
      typeof value["descriptorRevision"] !== "string" ||
      typeof value["providerMappingRevision"] !== "string" ||
      (value["writeMutationTrust"] !== undefined &&
        value["writeMutationTrust"] !== "unavailable" &&
        value["writeMutationTrust"] !== "standard_trusted_creative" &&
        value["writeMutationTrust"] !== "hardened_native") ||
      typeof value["extendedChecksum"] !== "string"
    ) {
      return false;
    }
  }
  return hasValidPermissionSummaryChecksums(value as unknown as PermissionSummary);
}

function parsePersistedPermissionSummary(
  value: JsonObject,
  input: ReadPermissionSummaryForRunInput
): PermissionSummary | undefined {
  if (value["schemaVersion"] === "2.0") {
    try {
      const parsed = parsePermissionSummaryV20(value);
      return parsed.permissionSummaryId === input.permissionSummaryId &&
        parsed.runId === input.runId &&
        parsed.projectId.length > 0
        ? parsed
        : undefined;
    } catch {
      return undefined;
    }
  }
  return isPermissionSummary(value, input) ? (value as unknown as PermissionSummary) : undefined;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
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
