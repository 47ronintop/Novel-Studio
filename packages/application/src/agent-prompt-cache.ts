import { createHash } from "node:crypto";

import type {
  AgentContextProfileId,
  AgentContextScope,
  AgentPromptCacheCapabilitySnapshot
} from "@novel-studio/agent-engine";
import type { JsonObject } from "@novel-studio/shared";

export const AGENT_PROMPT_CACHE_ARTIFACT_VERSION = "1.0" as const;
export const AGENT_PROMPT_CACHE_ARTIFACT_VERSION_V2 = "2.0" as const;
export const AGENT_PROMPT_CACHE_ADAPTER_VERSION = "c5@1.0" as const;

interface AgentPromptCacheIdentityArtifactBase {
  readonly artifactId: string;
  readonly runBindingId: string;
  readonly provider: string;
  readonly modelName: string;
  readonly connectionIdentityChecksum: string;
  readonly accountIsolationChecksum: string;
  readonly adapterVersion: string;
  readonly capability: AgentPromptCacheCapabilitySnapshot;
  readonly scope: AgentContextScope;
  readonly contextProfileId: AgentContextProfileId;
  readonly profileVersion: string;
  readonly guidanceTemplateChecksum: string;
  readonly toolCatalogRevision: string;
  readonly logicalPrefixChecksum: string;
  readonly stablePrefixMessageCount: number;
  readonly eligibleInputTokens: number;
  readonly identityBaseChecksum: string;
  readonly identityChecksum: string;
  readonly createdAt: string;
  readonly expiresAt: string | null;
  readonly artifactChecksum: string;
}

export interface AgentPromptCacheIdentityArtifactV1 extends AgentPromptCacheIdentityArtifactBase {
  readonly schemaVersion: typeof AGENT_PROMPT_CACHE_ARTIFACT_VERSION;
}

export interface AgentPromptCacheIdentityArtifactV2 extends AgentPromptCacheIdentityArtifactBase {
  readonly schemaVersion: typeof AGENT_PROMPT_CACHE_ARTIFACT_VERSION_V2;
  readonly providerSemanticVersionSetChecksum: string;
  readonly canonicalRootIdentityChecksum: string;
  readonly effectiveCapabilityStateChecksum: string;
  readonly sharingDefaultsRevision: string;
  readonly sharingGrantRevision: string;
  readonly policyRevision: string;
  readonly providerToolProjectionChecksum: string;
}

export type AgentPromptCacheIdentityArtifact =
  AgentPromptCacheIdentityArtifactV1 | AgentPromptCacheIdentityArtifactV2;

interface CreateAgentPromptCacheIdentityArtifactInputBase {
  readonly runBindingId: string;
  readonly provider: string;
  readonly modelName: string;
  readonly connectionIdentityChecksum: string;
  readonly accountIsolationChecksum: string;
  readonly adapterVersion?: string;
  readonly capability: AgentPromptCacheCapabilitySnapshot;
  readonly scope: AgentContextScope;
  readonly contextProfileId: AgentContextProfileId;
  readonly profileVersion: string;
  readonly guidanceTemplateChecksum: string;
  readonly toolCatalogRevision: string;
  readonly logicalPrefixChecksum: string;
  readonly stablePrefixMessageCount: number;
  readonly eligibleInputTokens: number;
  readonly createdAt: string;
}

export type CreateAgentPromptCacheIdentityArtifactInput =
  CreateAgentPromptCacheIdentityArtifactInputBase;

export interface CreateAgentPromptCacheIdentityArtifactV2Input extends CreateAgentPromptCacheIdentityArtifactInputBase {
  readonly providerSemanticVersionSetChecksum: string;
  /** `not_applicable` is valid only for standalone runs. */
  readonly canonicalRootIdentityChecksum: string;
  readonly effectiveCapabilityStateChecksum: string;
  /** `not_applicable` is valid only for standalone runs. */
  readonly sharingDefaultsRevision: string;
  /** `not_applicable` is valid only for standalone runs. */
  readonly sharingGrantRevision: string;
  readonly policyRevision: string;
  readonly providerToolProjectionChecksum: string;
}

export function createAgentPromptCacheIdentityArtifact(
  input: CreateAgentPromptCacheIdentityArtifactInput
): AgentPromptCacheIdentityArtifactV1 {
  assertInput(input);
  const adapterVersion = input.adapterVersion ?? AGENT_PROMPT_CACHE_ADAPTER_VERSION;
  const identityBaseChecksum = checksum(
    stableSerialize({
      schemaVersion: AGENT_PROMPT_CACHE_ARTIFACT_VERSION,
      provider: input.provider,
      modelName: input.modelName,
      connectionIdentityChecksum: input.connectionIdentityChecksum,
      accountIsolationChecksum: input.accountIsolationChecksum,
      adapterVersion,
      capability: input.capability
    })
  );
  const identityChecksum = deriveAgentPromptCacheIdentityChecksum(
    identityBaseChecksum,
    input.logicalPrefixChecksum
  );
  const expiresAt = expiry(input.createdAt, input.capability.ttlSeconds);
  const unsigned = {
    schemaVersion: AGENT_PROMPT_CACHE_ARTIFACT_VERSION,
    artifactId: `prompt_cache_${checksum(
      stableSerialize({ runBindingId: input.runBindingId, identityChecksum })
    ).slice(0, 32)}`,
    runBindingId: input.runBindingId,
    provider: input.provider,
    modelName: input.modelName,
    connectionIdentityChecksum: input.connectionIdentityChecksum,
    accountIsolationChecksum: input.accountIsolationChecksum,
    adapterVersion,
    capability: structuredClone(input.capability),
    scope: structuredClone(input.scope),
    contextProfileId: input.contextProfileId,
    profileVersion: input.profileVersion,
    guidanceTemplateChecksum: input.guidanceTemplateChecksum,
    toolCatalogRevision: input.toolCatalogRevision,
    logicalPrefixChecksum: input.logicalPrefixChecksum,
    stablePrefixMessageCount: input.stablePrefixMessageCount,
    eligibleInputTokens: input.eligibleInputTokens,
    identityBaseChecksum,
    identityChecksum,
    createdAt: input.createdAt,
    expiresAt
  } as const;
  return deepFreeze({
    ...unsigned,
    artifactChecksum: checksum(stableSerialize(unsigned))
  });
}

/** Current writer. Every stable Provider-semantic input is explicit and participates in identity. */
export function createAgentPromptCacheIdentityArtifactV2(
  input: CreateAgentPromptCacheIdentityArtifactV2Input
): AgentPromptCacheIdentityArtifactV2 {
  assertInput(input);
  assertV2Input(input);
  const adapterVersion = input.adapterVersion ?? AGENT_PROMPT_CACHE_ADAPTER_VERSION;
  const identityBaseChecksum = checksum(
    stableSerialize({
      schemaVersion: AGENT_PROMPT_CACHE_ARTIFACT_VERSION_V2,
      provider: input.provider,
      modelName: input.modelName,
      connectionIdentityChecksum: input.connectionIdentityChecksum,
      accountIsolationChecksum: input.accountIsolationChecksum,
      adapterVersion,
      capability: input.capability,
      scope: input.scope,
      contextProfileId: input.contextProfileId,
      profileVersion: input.profileVersion,
      guidanceTemplateChecksum: input.guidanceTemplateChecksum,
      toolCatalogRevision: input.toolCatalogRevision,
      providerSemanticVersionSetChecksum: input.providerSemanticVersionSetChecksum,
      canonicalRootIdentityChecksum: input.canonicalRootIdentityChecksum,
      effectiveCapabilityStateChecksum: input.effectiveCapabilityStateChecksum,
      sharingDefaultsRevision: input.sharingDefaultsRevision,
      sharingGrantRevision: input.sharingGrantRevision,
      policyRevision: input.policyRevision,
      providerToolProjectionChecksum: input.providerToolProjectionChecksum
    })
  );
  const identityChecksum = deriveAgentPromptCacheIdentityChecksumV2(
    identityBaseChecksum,
    input.logicalPrefixChecksum
  );
  const expiresAt = expiry(input.createdAt, input.capability.ttlSeconds);
  const unsigned = {
    schemaVersion: AGENT_PROMPT_CACHE_ARTIFACT_VERSION_V2,
    artifactId: `prompt_cache_${checksum(
      stableSerialize({ runBindingId: input.runBindingId, identityChecksum })
    ).slice(0, 32)}`,
    runBindingId: input.runBindingId,
    provider: input.provider,
    modelName: input.modelName,
    connectionIdentityChecksum: input.connectionIdentityChecksum,
    accountIsolationChecksum: input.accountIsolationChecksum,
    adapterVersion,
    capability: structuredClone(input.capability),
    scope: structuredClone(input.scope),
    contextProfileId: input.contextProfileId,
    profileVersion: input.profileVersion,
    guidanceTemplateChecksum: input.guidanceTemplateChecksum,
    toolCatalogRevision: input.toolCatalogRevision,
    providerSemanticVersionSetChecksum: input.providerSemanticVersionSetChecksum,
    canonicalRootIdentityChecksum: input.canonicalRootIdentityChecksum,
    effectiveCapabilityStateChecksum: input.effectiveCapabilityStateChecksum,
    sharingDefaultsRevision: input.sharingDefaultsRevision,
    sharingGrantRevision: input.sharingGrantRevision,
    policyRevision: input.policyRevision,
    providerToolProjectionChecksum: input.providerToolProjectionChecksum,
    logicalPrefixChecksum: input.logicalPrefixChecksum,
    stablePrefixMessageCount: input.stablePrefixMessageCount,
    eligibleInputTokens: input.eligibleInputTokens,
    identityBaseChecksum,
    identityChecksum,
    createdAt: input.createdAt,
    expiresAt
  } as const;
  return deepFreeze({
    ...unsigned,
    artifactChecksum: checksum(stableSerialize(unsigned))
  });
}

export function parseAgentPromptCacheIdentityArtifact(
  value: JsonObject
): AgentPromptCacheIdentityArtifact {
  if (value["schemaVersion"] === AGENT_PROMPT_CACHE_ARTIFACT_VERSION_V2) {
    return parseAgentPromptCacheIdentityArtifactV2(value);
  }
  if (value["schemaVersion"] !== AGENT_PROMPT_CACHE_ARTIFACT_VERSION)
    throw new Error("AGENT_PROMPT_CACHE_ARTIFACT_VERSION_UNSUPPORTED");
  if (!hasExactlyFields(value, V1_ARTIFACT_FIELDS))
    throw new Error("AGENT_PROMPT_CACHE_ARTIFACT_INVALID");
  const capability = value["capability"];
  const scope = value["scope"];
  if (!isCapability(capability) || !isScope(scope)) {
    throw new Error("AGENT_PROMPT_CACHE_ARTIFACT_INVALID");
  }
  const recreated = createAgentPromptCacheIdentityArtifact({
    runBindingId: requiredString(value, "runBindingId"),
    provider: requiredString(value, "provider"),
    modelName: requiredString(value, "modelName"),
    connectionIdentityChecksum: requiredChecksum(value, "connectionIdentityChecksum"),
    accountIsolationChecksum: requiredChecksum(value, "accountIsolationChecksum"),
    adapterVersion: requiredString(value, "adapterVersion"),
    capability,
    scope,
    contextProfileId: profileId(value["contextProfileId"]),
    profileVersion: requiredString(value, "profileVersion"),
    guidanceTemplateChecksum: requiredChecksum(value, "guidanceTemplateChecksum"),
    toolCatalogRevision: requiredString(value, "toolCatalogRevision"),
    logicalPrefixChecksum: requiredChecksum(value, "logicalPrefixChecksum"),
    stablePrefixMessageCount: nonNegativeInteger(value["stablePrefixMessageCount"], true),
    eligibleInputTokens: nonNegativeInteger(value["eligibleInputTokens"], false),
    createdAt: utcTimestamp(value["createdAt"])
  });
  if (
    recreated.artifactId !== value["artifactId"] ||
    recreated.identityBaseChecksum !== value["identityBaseChecksum"] ||
    recreated.identityChecksum !== value["identityChecksum"] ||
    recreated.expiresAt !== value["expiresAt"] ||
    recreated.artifactChecksum !== value["artifactChecksum"]
  ) {
    throw new Error("AGENT_PROMPT_CACHE_ARTIFACT_INVALID");
  }
  return recreated;
}

function parseAgentPromptCacheIdentityArtifactV2(
  value: JsonObject
): AgentPromptCacheIdentityArtifactV2 {
  if (!hasExactlyFields(value, V2_ARTIFACT_FIELDS)) {
    throw new Error("AGENT_PROMPT_CACHE_ARTIFACT_INVALID");
  }
  const capability = value["capability"];
  const scope = value["scope"];
  if (!isCapability(capability) || !isScope(scope)) {
    throw new Error("AGENT_PROMPT_CACHE_ARTIFACT_INVALID");
  }
  const recreated = createAgentPromptCacheIdentityArtifactV2({
    runBindingId: requiredString(value, "runBindingId"),
    provider: requiredString(value, "provider"),
    modelName: requiredString(value, "modelName"),
    connectionIdentityChecksum: requiredChecksum(value, "connectionIdentityChecksum"),
    accountIsolationChecksum: requiredChecksum(value, "accountIsolationChecksum"),
    adapterVersion: requiredString(value, "adapterVersion"),
    capability,
    scope,
    contextProfileId: profileId(value["contextProfileId"]),
    profileVersion: requiredString(value, "profileVersion"),
    guidanceTemplateChecksum: requiredChecksum(value, "guidanceTemplateChecksum"),
    toolCatalogRevision: requiredString(value, "toolCatalogRevision"),
    providerSemanticVersionSetChecksum: requiredChecksum(
      value,
      "providerSemanticVersionSetChecksum"
    ),
    canonicalRootIdentityChecksum: requiredString(value, "canonicalRootIdentityChecksum"),
    effectiveCapabilityStateChecksum: requiredChecksum(value, "effectiveCapabilityStateChecksum"),
    sharingDefaultsRevision: requiredString(value, "sharingDefaultsRevision"),
    sharingGrantRevision: requiredString(value, "sharingGrantRevision"),
    policyRevision: requiredString(value, "policyRevision"),
    providerToolProjectionChecksum: requiredChecksum(value, "providerToolProjectionChecksum"),
    logicalPrefixChecksum: requiredChecksum(value, "logicalPrefixChecksum"),
    stablePrefixMessageCount: nonNegativeInteger(value["stablePrefixMessageCount"], true),
    eligibleInputTokens: nonNegativeInteger(value["eligibleInputTokens"], false),
    createdAt: utcTimestamp(value["createdAt"])
  });
  if (
    recreated.artifactId !== value["artifactId"] ||
    recreated.identityBaseChecksum !== value["identityBaseChecksum"] ||
    recreated.identityChecksum !== value["identityChecksum"] ||
    recreated.expiresAt !== value["expiresAt"] ||
    recreated.artifactChecksum !== value["artifactChecksum"]
  ) {
    throw new Error("AGENT_PROMPT_CACHE_ARTIFACT_INVALID");
  }
  return recreated;
}

export function deriveAgentPromptCacheIdentityChecksum(
  identityBaseChecksum: string,
  logicalPrefixChecksum: string
): string {
  if (!isChecksum(identityBaseChecksum) || !isChecksum(logicalPrefixChecksum)) {
    throw new Error("AGENT_PROMPT_CACHE_IDENTITY_INVALID");
  }
  return checksum(
    stableSerialize({
      schemaVersion: AGENT_PROMPT_CACHE_ARTIFACT_VERSION,
      identityBaseChecksum,
      logicalPrefixChecksum
    })
  );
}

export function deriveAgentPromptCacheIdentityChecksumV2(
  identityBaseChecksum: string,
  logicalPrefixChecksum: string
): string {
  if (!isChecksum(identityBaseChecksum) || !isChecksum(logicalPrefixChecksum)) {
    throw new Error("AGENT_PROMPT_CACHE_IDENTITY_INVALID");
  }
  return checksum(
    stableSerialize({
      schemaVersion: AGENT_PROMPT_CACHE_ARTIFACT_VERSION_V2,
      identityBaseChecksum,
      logicalPrefixChecksum
    })
  );
}

const V1_ARTIFACT_FIELDS = [
  "schemaVersion",
  "artifactId",
  "runBindingId",
  "provider",
  "modelName",
  "connectionIdentityChecksum",
  "accountIsolationChecksum",
  "adapterVersion",
  "capability",
  "scope",
  "contextProfileId",
  "profileVersion",
  "guidanceTemplateChecksum",
  "toolCatalogRevision",
  "logicalPrefixChecksum",
  "stablePrefixMessageCount",
  "eligibleInputTokens",
  "identityBaseChecksum",
  "identityChecksum",
  "createdAt",
  "expiresAt",
  "artifactChecksum"
] as const;

const V2_ARTIFACT_FIELDS = [
  ...V1_ARTIFACT_FIELDS,
  "providerSemanticVersionSetChecksum",
  "canonicalRootIdentityChecksum",
  "effectiveCapabilityStateChecksum",
  "sharingDefaultsRevision",
  "sharingGrantRevision",
  "policyRevision",
  "providerToolProjectionChecksum"
] as const;

function assertInput(input: CreateAgentPromptCacheIdentityArtifactInput): void {
  if (
    !isSafeId(input.runBindingId) ||
    !isNonEmpty(input.provider) ||
    !isNonEmpty(input.modelName) ||
    !isChecksum(input.connectionIdentityChecksum) ||
    !isChecksum(input.accountIsolationChecksum) ||
    !isCapability(input.capability) ||
    !isScope(input.scope) ||
    !isProfileId(input.contextProfileId) ||
    !profileMatchesScope(input.contextProfileId, input.scope) ||
    !isNonEmpty(input.profileVersion) ||
    !isChecksum(input.guidanceTemplateChecksum) ||
    !isNonEmpty(input.toolCatalogRevision) ||
    !isChecksum(input.logicalPrefixChecksum) ||
    !Number.isSafeInteger(input.stablePrefixMessageCount) ||
    input.stablePrefixMessageCount < 1 ||
    !Number.isSafeInteger(input.eligibleInputTokens) ||
    input.eligibleInputTokens < 0 ||
    !isUtcTimestamp(input.createdAt)
  ) {
    throw new Error("AGENT_PROMPT_CACHE_ARTIFACT_INVALID");
  }
}

function assertV2Input(input: CreateAgentPromptCacheIdentityArtifactV2Input): void {
  const standalone = input.scope.kind === "standalone";
  if (
    !isChecksum(input.providerSemanticVersionSetChecksum) ||
    (standalone
      ? input.canonicalRootIdentityChecksum !== "not_applicable"
      : !isChecksum(input.canonicalRootIdentityChecksum)) ||
    !isChecksum(input.effectiveCapabilityStateChecksum) ||
    !isChecksum(input.providerToolProjectionChecksum) ||
    !isNonEmpty(input.policyRevision) ||
    (standalone
      ? input.sharingDefaultsRevision !== "not_applicable" ||
        input.sharingGrantRevision !== "not_applicable"
      : !isChecksum(input.sharingDefaultsRevision) || !isChecksum(input.sharingGrantRevision))
  ) {
    throw new Error("AGENT_PROMPT_CACHE_ARTIFACT_INVALID");
  }
}

function isCapability(value: unknown): value is AgentPromptCacheCapabilitySnapshot {
  if (!isRecord(value)) return false;
  const mode = value["mode"];
  const ttlSeconds = value["ttlSeconds"];
  return (
    hasExactlyFields(value, [
      "mode",
      "policyVersion",
      "minimumCacheableTokens",
      "ttlSeconds",
      "inputTokenSemantics",
      "reportsCacheReadTokens",
      "reportsCacheWriteTokens"
    ]) &&
    (mode === "none" ||
      mode === "automatic_prefix" ||
      mode === "explicit_breakpoints" ||
      mode === "explicit_resource") &&
    isNonEmpty(value["policyVersion"]) &&
    Number.isSafeInteger(value["minimumCacheableTokens"]) &&
    Number(value["minimumCacheableTokens"]) >= 0 &&
    (ttlSeconds === null || (Number.isSafeInteger(ttlSeconds) && Number(ttlSeconds) > 0)) &&
    (value["inputTokenSemantics"] === "included_in_input" ||
      value["inputTokenSemantics"] === "excluded_from_input" ||
      value["inputTokenSemantics"] === "unavailable") &&
    typeof value["reportsCacheReadTokens"] === "boolean" &&
    typeof value["reportsCacheWriteTokens"] === "boolean"
  );
}

function isScope(value: unknown): value is AgentContextScope {
  if (!isRecord(value)) return false;
  if (value["kind"] === "standalone")
    return hasExactlyFields(value, ["kind", "scopeId"]) && value["scopeId"] === "standalone";
  return (
    hasExactlyFields(value, ["kind", "workspaceKind", "workspaceId"]) &&
    value["kind"] === "workspace" &&
    (value["workspaceKind"] === "creativeProject" ||
      value["workspaceKind"] === "engineeringWorkspace") &&
    isSafeId(value["workspaceId"])
  );
}

function profileMatchesScope(profile: AgentContextProfileId, scope: AgentContextScope): boolean {
  if (profile === "standalone") return scope.kind === "standalone";
  if (scope.kind !== "workspace") return false;
  return profile === "engineering"
    ? scope.workspaceKind === "engineeringWorkspace"
    : scope.workspaceKind === "creativeProject";
}

function profileId(value: unknown): AgentContextProfileId {
  if (!isProfileId(value)) throw new Error("AGENT_PROMPT_CACHE_ARTIFACT_INVALID");
  return value;
}

function isProfileId(value: unknown): value is AgentContextProfileId {
  return (
    value === "standalone" ||
    value === "writing" ||
    value === "creative_general" ||
    value === "engineering"
  );
}

function expiry(createdAt: string, ttlSeconds: number | null): string | null {
  return ttlSeconds === null
    ? null
    : new Date(Date.parse(createdAt) + ttlSeconds * 1_000).toISOString();
}

function requiredString(value: JsonObject, key: string): string {
  const candidate = value[key];
  if (!isNonEmpty(candidate)) throw new Error("AGENT_PROMPT_CACHE_ARTIFACT_INVALID");
  return candidate;
}

function requiredChecksum(value: JsonObject, key: string): string {
  const candidate = value[key];
  if (!isChecksum(candidate)) throw new Error("AGENT_PROMPT_CACHE_ARTIFACT_INVALID");
  return candidate;
}

function nonNegativeInteger(value: unknown, positive: boolean): number {
  if (!Number.isSafeInteger(value) || Number(value) < (positive ? 1 : 0)) {
    throw new Error("AGENT_PROMPT_CACHE_ARTIFACT_INVALID");
  }
  return Number(value);
}

function utcTimestamp(value: unknown): string {
  if (!isUtcTimestamp(value)) throw new Error("AGENT_PROMPT_CACHE_ARTIFACT_INVALID");
  return value;
}

function isUtcTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function isChecksum(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(value);
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512;
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactlyFields(value: JsonObject, fields: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const expected = [...fields].sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
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
