import { createHash } from "node:crypto";

import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

export const AGENT_MODEL_SHARING_CONTRACT_VERSION = "1.0" as const;

export const RECOMMENDED_WORKSPACE_MODEL_SHARING_DEFAULTS: WorkspaceModelSharingDefaults =
  Object.freeze({
    outlineMetadata: "automatic",
    activeResource: "automatic",
    conversationSummary: "ask",
    toolReadResults: "ask"
  });

export type AgentModelSharingProfileId =
  "standalone" | "writing" | "creative_general" | "engineering";

export interface WorkspaceModelSharingDefaults {
  readonly outlineMetadata: "off" | "automatic";
  readonly activeResource: "off" | "automatic";
  readonly conversationSummary: "allow" | "ask" | "deny";
  readonly toolReadResults: "allow" | "ask" | "deny";
}

export interface FrozenWorkspaceModelSharingDefaults {
  readonly schemaVersion: typeof AGENT_MODEL_SHARING_CONTRACT_VERSION;
  readonly workspaceBindingId: string;
  readonly defaultsRevision: string;
  readonly defaults: WorkspaceModelSharingDefaults;
}

export interface RunModelSharingGrant {
  readonly runDraftRevision: string;
  readonly defaultsRevision: string;
  readonly includedRefIds: readonly string[];
  readonly excludedRefIds: readonly string[];
  readonly approvedResultKinds: readonly string[];
}

export interface FrozenRunModelSharingGrant extends RunModelSharingGrant {
  readonly schemaVersion: typeof AGENT_MODEL_SHARING_CONTRACT_VERSION;
  readonly profileId: Exclude<AgentModelSharingProfileId, "standalone">;
  readonly workspaceBindingId: string;
  readonly grantRevision: string;
}

export type AgentModelReadResultClass = "conversation_summary" | "tool_read_result";

export type ContextShareReadPreflight =
  | {
      readonly decision: "allow";
      readonly authorization: "workspace_default" | "run_grant";
    }
  | {
      readonly decision: "deny";
      readonly catalogAction: "omit_read_tool";
    }
  | {
      readonly decision: "awaiting_context_share_approval";
      readonly approval: AwaitingContextShareApproval;
    };

export interface AwaitingContextShareApproval {
  readonly schemaVersion: typeof AGENT_MODEL_SHARING_CONTRACT_VERSION;
  readonly status: "awaiting_context_share_approval";
  readonly runDraftRevision: string;
  readonly defaultsRevision: string;
  readonly grantRevision: string;
  readonly resultClass: AgentModelReadResultClass;
  readonly resultKind: string;
  readonly toolCallId: string;
  readonly approvalBinding: string;
}

export interface EngineeringOutlineEntry {
  readonly relativePath: string;
  readonly kind: "file" | "directory";
  readonly ignored?: boolean;
  readonly managed?: boolean;
}

export interface FilteredEngineeringOutline {
  readonly visibleEntries: readonly EngineeringOutlineEntry[];
  readonly hiddenCount: number;
}

/** Main-only constructor. Absence of this frozen value means first-use selection is incomplete. */
export function freezeWorkspaceModelSharingDefaults(input: {
  readonly workspaceBindingId: string;
  /** Main supplies the monotonic persisted revision; content-derived fallback is for pure callers. */
  readonly defaultsRevision?: string;
  readonly defaults: WorkspaceModelSharingDefaults;
}): Result<FrozenWorkspaceModelSharingDefaults, UnifiedError> {
  if (
    !isMachineToken(input.workspaceBindingId) ||
    !isSharingDefaults(input.defaults) ||
    (input.defaultsRevision !== undefined && !isChecksum(input.defaultsRevision))
  ) {
    return err(sharingError("AGENT_MODEL_SHARING_DEFAULTS_INVALID"));
  }
  const defaults = cloneDefaults(input.defaults);
  return ok(
    deepFreeze({
      schemaVersion: AGENT_MODEL_SHARING_CONTRACT_VERSION,
      workspaceBindingId: input.workspaceBindingId,
      defaultsRevision:
        input.defaultsRevision ??
        checksum(
          stableSerialize({
            schemaVersion: AGENT_MODEL_SHARING_CONTRACT_VERSION,
            workspaceBindingId: input.workspaceBindingId,
            defaults
          })
        ),
      defaults
    })
  );
}

export function parseFrozenWorkspaceModelSharingDefaults(
  value: unknown
): FrozenWorkspaceModelSharingDefaults {
  if (
    !isRecord(value) ||
    !hasExactlyKeys(value, [
      "schemaVersion",
      "workspaceBindingId",
      "defaultsRevision",
      "defaults"
    ]) ||
    value["schemaVersion"] !== AGENT_MODEL_SHARING_CONTRACT_VERSION ||
    !isMachineToken(value["workspaceBindingId"]) ||
    !isChecksum(value["defaultsRevision"]) ||
    !isSharingDefaults(value["defaults"])
  ) {
    throw new Error("AGENT_MODEL_SHARING_DEFAULTS_INVALID");
  }
  const frozen = freezeWorkspaceModelSharingDefaults({
    workspaceBindingId: value["workspaceBindingId"],
    defaultsRevision: value["defaultsRevision"],
    defaults: value["defaults"]
  });
  if (!frozen.ok) throw new Error("AGENT_MODEL_SHARING_DEFAULTS_INVALID");
  return frozen.value;
}

/** Main-only constructor for a grant that is valid for exactly one workspace Run draft. */
export function freezeRunModelSharingGrant(input: {
  readonly profileId: AgentModelSharingProfileId;
  readonly workspaceBindingId: string;
  readonly grant: RunModelSharingGrant;
}): Result<FrozenRunModelSharingGrant, UnifiedError> {
  if (
    input.profileId === "standalone" ||
    !isWorkspaceProfile(input.profileId) ||
    !isMachineToken(input.workspaceBindingId) ||
    !isRevision(input.grant.runDraftRevision) ||
    !isChecksum(input.grant.defaultsRevision)
  ) {
    return err(sharingError("AGENT_MODEL_SHARING_GRANT_INVALID"));
  }
  const includedRefIds = canonicalTokens(input.grant.includedRefIds, false);
  const excludedRefIds = canonicalTokens(input.grant.excludedRefIds, false);
  const approvedResultKinds = canonicalTokens(input.grant.approvedResultKinds, true);
  if (
    includedRefIds === undefined ||
    excludedRefIds === undefined ||
    approvedResultKinds === undefined ||
    includedRefIds.some((refId) => excludedRefIds.includes(refId))
  ) {
    return err(sharingError("AGENT_MODEL_SHARING_GRANT_INVALID"));
  }
  const canonical = {
    schemaVersion: AGENT_MODEL_SHARING_CONTRACT_VERSION,
    profileId: input.profileId,
    workspaceBindingId: input.workspaceBindingId,
    runDraftRevision: input.grant.runDraftRevision,
    defaultsRevision: input.grant.defaultsRevision,
    includedRefIds,
    excludedRefIds,
    approvedResultKinds
  } as const;
  return ok(deepFreeze({ ...canonical, grantRevision: checksum(stableSerialize(canonical)) }));
}

export function parseFrozenRunModelSharingGrant(value: unknown): FrozenRunModelSharingGrant {
  if (
    !isRecord(value) ||
    !hasExactlyKeys(value, [
      "schemaVersion",
      "profileId",
      "workspaceBindingId",
      "runDraftRevision",
      "defaultsRevision",
      "includedRefIds",
      "excludedRefIds",
      "approvedResultKinds",
      "grantRevision"
    ]) ||
    value["schemaVersion"] !== AGENT_MODEL_SHARING_CONTRACT_VERSION ||
    !isWorkspaceProfileValue(value["profileId"]) ||
    !isMachineToken(value["workspaceBindingId"]) ||
    !isRevision(value["runDraftRevision"]) ||
    !isChecksum(value["defaultsRevision"]) ||
    !Array.isArray(value["includedRefIds"]) ||
    !Array.isArray(value["excludedRefIds"]) ||
    !Array.isArray(value["approvedResultKinds"]) ||
    !isChecksum(value["grantRevision"])
  ) {
    throw new Error("AGENT_MODEL_SHARING_GRANT_INVALID");
  }
  const frozen = freezeRunModelSharingGrant({
    profileId: value["profileId"],
    workspaceBindingId: value["workspaceBindingId"],
    grant: {
      runDraftRevision: value["runDraftRevision"],
      defaultsRevision: value["defaultsRevision"],
      includedRefIds: value["includedRefIds"] as unknown[],
      excludedRefIds: value["excludedRefIds"] as unknown[],
      approvedResultKinds: value["approvedResultKinds"] as unknown[]
    } as RunModelSharingGrant
  });
  if (!frozen.ok || frozen.value.grantRevision !== value["grantRevision"]) {
    throw new Error("AGENT_MODEL_SHARING_GRANT_INVALID");
  }
  return frozen.value;
}

/**
 * Run this before invoking a read. `ask` never authorizes an eager read: an unapproved result kind
 * produces a bound pending state whose body contains no result data.
 */
export function preflightContextShareRead(input: {
  readonly defaults: FrozenWorkspaceModelSharingDefaults;
  readonly grant: FrozenRunModelSharingGrant;
  readonly resultClass: AgentModelReadResultClass;
  readonly resultKind: string;
  readonly toolCallId: string;
}): Result<ContextShareReadPreflight, UnifiedError> {
  if (
    !sharingBindingsMatch(input.defaults, input.grant) ||
    !isMachineToken(input.resultKind) ||
    !isMachineToken(input.toolCallId)
  ) {
    return err(sharingError("AGENT_MODEL_SHARING_BINDING_INVALID"));
  }
  const policy =
    input.resultClass === "conversation_summary"
      ? input.defaults.defaults.conversationSummary
      : input.defaults.defaults.toolReadResults;
  if (policy === "deny") return ok({ decision: "deny", catalogAction: "omit_read_tool" });
  if (policy === "allow") return ok({ decision: "allow", authorization: "workspace_default" });
  if (input.grant.approvedResultKinds.includes(input.resultKind)) {
    return ok({ decision: "allow", authorization: "run_grant" });
  }
  const pendingWithoutBinding = {
    schemaVersion: AGENT_MODEL_SHARING_CONTRACT_VERSION,
    status: "awaiting_context_share_approval",
    runDraftRevision: input.grant.runDraftRevision,
    defaultsRevision: input.grant.defaultsRevision,
    grantRevision: input.grant.grantRevision,
    resultClass: input.resultClass,
    resultKind: input.resultKind,
    toolCallId: input.toolCallId
  } as const;
  return ok({
    decision: "awaiting_context_share_approval",
    approval: deepFreeze({
      ...pendingWithoutBinding,
      approvalBinding: checksum(stableSerialize(pendingWithoutBinding))
    })
  });
}

export function parseAwaitingContextShareApproval(value: unknown): AwaitingContextShareApproval {
  if (
    !isRecord(value) ||
    !hasExactlyKeys(value, [
      "schemaVersion",
      "status",
      "runDraftRevision",
      "defaultsRevision",
      "grantRevision",
      "resultClass",
      "resultKind",
      "toolCallId",
      "approvalBinding"
    ]) ||
    value["schemaVersion"] !== AGENT_MODEL_SHARING_CONTRACT_VERSION ||
    value["status"] !== "awaiting_context_share_approval" ||
    !isRevision(value["runDraftRevision"]) ||
    !isChecksum(value["defaultsRevision"]) ||
    !isChecksum(value["grantRevision"]) ||
    (value["resultClass"] !== "conversation_summary" &&
      value["resultClass"] !== "tool_read_result") ||
    !isMachineToken(value["resultKind"]) ||
    !isMachineToken(value["toolCallId"]) ||
    !isChecksum(value["approvalBinding"])
  ) {
    throw new Error("AGENT_MODEL_SHARING_APPROVAL_INVALID");
  }
  const { approvalBinding, ...withoutBinding } = value as unknown as AwaitingContextShareApproval;
  if (approvalBinding !== checksum(stableSerialize(withoutBinding))) {
    throw new Error("AGENT_MODEL_SHARING_APPROVAL_INVALID");
  }
  return deepFreeze({ ...withoutBinding, approvalBinding });
}

/** Applies a Main/UI JIT decision without ever accepting a result body or widening other kinds. */
export function decideContextShareApproval(input: {
  readonly defaults: FrozenWorkspaceModelSharingDefaults;
  readonly grant: FrozenRunModelSharingGrant;
  readonly pending: AwaitingContextShareApproval;
  readonly decision: "approve" | "deny";
}): Result<FrozenRunModelSharingGrant, UnifiedError> {
  const expected = preflightContextShareRead({
    defaults: input.defaults,
    grant: input.grant,
    resultClass: input.pending.resultClass,
    resultKind: input.pending.resultKind,
    toolCallId: input.pending.toolCallId
  });
  if (
    !expected.ok ||
    expected.value.decision !== "awaiting_context_share_approval" ||
    stableSerialize(expected.value.approval) !== stableSerialize(input.pending)
  ) {
    return err(sharingError("AGENT_MODEL_SHARING_APPROVAL_STALE"));
  }
  if (input.decision === "deny") return ok(input.grant);
  return freezeRunModelSharingGrant({
    profileId: input.grant.profileId,
    workspaceBindingId: input.grant.workspaceBindingId,
    grant: {
      ...input.grant,
      approvedResultKinds: [...input.grant.approvedResultKinds, input.pending.resultKind]
    }
  });
}

/** `deny` removes read tools; `ask` remains callable because its execution is guarded by preflight. */
export function filterReadToolsBySharingPolicy<T>(input: {
  readonly defaults: WorkspaceModelSharingDefaults;
  readonly tools: readonly T[];
  readonly resultClassFor: (tool: T) => AgentModelReadResultClass | undefined;
}): readonly T[] {
  return input.tools.filter((tool) => {
    const resultClass = input.resultClassFor(tool);
    if (resultClass === undefined) return true;
    return resultClass === "conversation_summary"
      ? input.defaults.conversationSummary !== "deny"
      : input.defaults.toolReadResults !== "deny";
  });
}

/** Filters locally and exposes only a count for hidden entries, never their names or matching rule. */
export function filterSensitiveEngineeringOutline(
  entries: readonly EngineeringOutlineEntry[]
): FilteredEngineeringOutline {
  const visibleEntries: EngineeringOutlineEntry[] = [];
  let hiddenCount = 0;
  for (const entry of entries) {
    if (!isSafeOutlineEntry(entry) || isSensitiveOutlinePath(entry)) {
      hiddenCount += 1;
      continue;
    }
    visibleEntries.push({ relativePath: entry.relativePath, kind: entry.kind });
  }
  return deepFreeze({ visibleEntries, hiddenCount });
}

function sharingBindingsMatch(
  defaults: FrozenWorkspaceModelSharingDefaults,
  grant: FrozenRunModelSharingGrant
): boolean {
  return (
    defaults.workspaceBindingId === grant.workspaceBindingId &&
    defaults.defaultsRevision === grant.defaultsRevision &&
    isChecksum(grant.grantRevision)
  );
}

function isSharingDefaults(value: unknown): value is WorkspaceModelSharingDefaults {
  return (
    isRecord(value) &&
    hasExactlyKeys(value, [
      "outlineMetadata",
      "activeResource",
      "conversationSummary",
      "toolReadResults"
    ]) &&
    (value["outlineMetadata"] === "off" || value["outlineMetadata"] === "automatic") &&
    (value["activeResource"] === "off" || value["activeResource"] === "automatic") &&
    isReadPolicy(value["conversationSummary"]) &&
    isReadPolicy(value["toolReadResults"])
  );
}

function cloneDefaults(value: WorkspaceModelSharingDefaults): WorkspaceModelSharingDefaults {
  return {
    outlineMetadata: value.outlineMetadata,
    activeResource: value.activeResource,
    conversationSummary: value.conversationSummary,
    toolReadResults: value.toolReadResults
  };
}

function canonicalTokens(
  values: readonly string[],
  machineOnly: boolean
): readonly string[] | undefined {
  if (!Array.isArray(values)) return undefined;
  const result = [...new Set(values)];
  if (
    result.length !== values.length ||
    result.some((value) => (machineOnly ? !isMachineToken(value) : !isBoundedTextId(value)))
  ) {
    return undefined;
  }
  return result.sort((left, right) => left.localeCompare(right));
}

function isSensitiveOutlinePath(entry: EngineeringOutlineEntry): boolean {
  if (entry.ignored === true || entry.managed === true) return true;
  const segments = entry.relativePath.split("/").map((segment) => segment.toLowerCase());
  return segments.some((segment) => {
    if (
      segment === ".git" ||
      segment === "node_modules" ||
      segment === "dist" ||
      segment === "build" ||
      segment === "out" ||
      segment === "coverage" ||
      segment === ".aws" ||
      segment === ".ssh" ||
      segment === ".gnupg" ||
      segment === "id_rsa" ||
      segment === "id_ed25519"
    ) {
      return true;
    }
    if (/^\.env(?:\..+)?$/u.test(segment)) return true;
    if (/^(?:credentials|secrets?)(?:\..+)?$/u.test(segment)) return true;
    if (/^(?:token|access[_-]?token|api[_-]?key|private[_-]?key)(?:\..+)?$/u.test(segment)) {
      return true;
    }
    return /\.(?:pem|key|p12|pfx|jks|keystore)$/u.test(segment);
  });
}

function isSafeOutlineEntry(value: EngineeringOutlineEntry): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["relativePath", "kind", "ignored", "managed"]) &&
    typeof value.relativePath === "string" &&
    value.relativePath.length > 0 &&
    value.relativePath.length <= 1024 &&
    !value.relativePath.startsWith("/") &&
    !value.relativePath.includes("\\") &&
    !value.relativePath.split("/").some((segment) => segment.length === 0 || segment === "..") &&
    (value.kind === "file" || value.kind === "directory") &&
    (value.ignored === undefined || typeof value.ignored === "boolean") &&
    (value.managed === undefined || typeof value.managed === "boolean")
  );
}

function isWorkspaceProfile(
  value: AgentModelSharingProfileId
): value is Exclude<AgentModelSharingProfileId, "standalone"> {
  return value === "writing" || value === "creative_general" || value === "engineering";
}

function isWorkspaceProfileValue(
  value: unknown
): value is Exclude<AgentModelSharingProfileId, "standalone"> {
  return value === "writing" || value === "creative_general" || value === "engineering";
}

function isReadPolicy(value: unknown): value is "allow" | "ask" | "deny" {
  return value === "allow" || value === "ask" || value === "deny";
}

function isRevision(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/u.test(value);
}

function isMachineToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,256}$/u.test(value);
}

function isBoundedTextId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    value.trim() === value &&
    ![...value].some((character) => {
      const codePoint = character.codePointAt(0) as number;
      return codePoint <= 0x1f || codePoint === 0x7f;
    })
  );
}

function isChecksum(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function hasExactlyKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return hasOnlyKeys(value, expected) && Object.keys(value).length === expected.length;
}

function checksum(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableSerialize(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function sharingError(
  code:
    | "AGENT_MODEL_SHARING_DEFAULTS_INVALID"
    | "AGENT_MODEL_SHARING_GRANT_INVALID"
    | "AGENT_MODEL_SHARING_BINDING_INVALID"
    | "AGENT_MODEL_SHARING_APPROVAL_STALE"
): UnifiedError {
  return createUnifiedError({
    code,
    category: "ValidationError",
    message: "The model sharing policy or Run grant is invalid or stale.",
    recoverability: "user-action",
    suggestedAction: "Review the context sharing preview and create a new Run grant.",
    traceId: "agent-model-sharing"
  });
}
