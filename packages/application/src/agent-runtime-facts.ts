import { createHash } from "node:crypto";

import {
  DEFAULT_APPROVAL_RULE_SET_VERSION,
  LEGACY_ALL_HUMAN_APPROVAL_RULE_SET_CHECKSUM,
  LEGACY_ALL_HUMAN_APPROVAL_RULE_SET_VERSION,
  WRITE_OPERATION_ORDER,
  createApprovalRuleSetProjection,
  effectiveWorkspaceFileOperations,
  effectiveWritingOperations,
  isCapabilityEffective,
  isProviderVisibleWorkspaceFileOperation,
  isProviderVisibleWritingOperation,
  parseApprovalRuleSetProjection,
  type AgentToolDescriptor,
  type AgentWritePolicy,
  type EffectiveCapabilityState,
  type ProviderVisibleApprovalRule,
  type ProviderVisibleApprovalRuleSetProjection,
  type ProviderVisibleConditionalApprovalRuleId,
  type ProviderVisibleWorkspaceFileOperation,
  type ProviderVisibleWriteOperation,
  type ProviderVisibleWritingOperation
} from "@novel-studio/agent-engine";

import type { AgentContextProfile } from "./agent-context-profile.js";

export type {
  ProviderVisibleApprovalRule,
  ProviderVisibleApprovalRuleSetProjection,
  ProviderVisibleConditionalApprovalRuleId,
  ProviderVisibleWorkspaceFileOperation,
  ProviderVisibleWriteOperation,
  ProviderVisibleWritingOperation
} from "@novel-studio/agent-engine";

export const PROVIDER_VISIBLE_RUNTIME_FACTS_SCHEMA_VERSION = "1.0" as const;
export const ALL_HUMAN_APPROVAL_RULE_SET_VERSION = LEGACY_ALL_HUMAN_APPROVAL_RULE_SET_VERSION;
export const ALL_HUMAN_APPROVAL_RULE_SET_CHECKSUM = LEGACY_ALL_HUMAN_APPROVAL_RULE_SET_CHECKSUM;

export interface ProviderVisibleAgentRuntimeFacts {
  readonly schemaVersion: typeof PROVIDER_VISIBLE_RUNTIME_FACTS_SCHEMA_VERSION;
  readonly profileId: AgentContextProfile["profileId"];
  readonly operationMode: AgentContextProfile["operationMode"];
  readonly workspaceBound: boolean;
  readonly workspaceKind: "none" | "creativeProject" | "engineeringWorkspace";
  readonly writeCapability: "none" | "propose";
  readonly writingOperations: readonly ProviderVisibleWritingOperation[];
  readonly workspaceFileOperations: readonly ProviderVisibleWorkspaceFileOperation[];
  readonly writeApprovalPolicy:
    "not_applicable" | "confirm_each_change_set" | "limited_run_preapproval";
  readonly approvalRuleSetVersion: string;
  readonly approvalRuleSetChecksum: string;
  readonly approvalRules: readonly ProviderVisibleApprovalRule[];
  readonly networkRead: boolean;
  readonly externalTools: "none" | "remote_mcp";
  readonly activeResourceKind: "none" | "chapter" | "story_bible" | "project_file";
}

export interface CreateProviderVisibleAgentRuntimeFactsInput {
  readonly profile: AgentContextProfile;
  /** The final Provider-projected directory, after Main capability/backend guards. */
  readonly toolDescriptors: readonly AgentToolDescriptor[];
  readonly effectiveCapabilityState?: EffectiveCapabilityState;
  readonly executionWritePolicy: AgentWritePolicy;
  readonly executionWritePolicyAcknowledged?: boolean;
  /** Remains false until the ADR-0004 trusted confirmation surface is independently qualified. */
  readonly limitedRunPreapprovalQualified?: boolean;
  readonly approvalRuleSet?: ProviderVisibleApprovalRuleSetProjection;
  readonly activeResourceKind: ProviderVisibleAgentRuntimeFacts["activeResourceKind"];
}

const ROOT_FIELDS = Object.freeze([
  "schemaVersion",
  "profileId",
  "operationMode",
  "workspaceBound",
  "workspaceKind",
  "writeCapability",
  "writingOperations",
  "workspaceFileOperations",
  "writeApprovalPolicy",
  "approvalRuleSetVersion",
  "approvalRuleSetChecksum",
  "approvalRules",
  "networkRead",
  "externalTools",
  "activeResourceKind"
]);

export function createAllHumanApprovalRuleSetProjection(
  operations: readonly ProviderVisibleWriteOperation[]
): ProviderVisibleApprovalRuleSetProjection {
  return createApprovalRuleSetProjection(operations, ALL_HUMAN_APPROVAL_RULE_SET_VERSION);
}

export function createProviderVisibleAgentRuntimeFacts(
  input: CreateProviderVisibleAgentRuntimeFactsInput
): ProviderVisibleAgentRuntimeFacts {
  assertProfileAndCapabilityState(input.profile, input.effectiveCapabilityState);
  assertActiveResource(input.profile, input.activeResourceKind);
  const descriptorIds = new Set<string>();
  for (const descriptor of input.toolDescriptors) {
    const id = canonicalToolId(descriptor);
    if (descriptorIds.has(id)) throw new Error("PROVIDER_VISIBLE_RUNTIME_FACTS_INVALID");
    descriptorIds.add(id);
    if (
      id === "run_project_task" ||
      id === "git_status" ||
      id === "git_diff" ||
      id.startsWith("plugin:")
    ) {
      throw new Error("PROVIDER_VISIBLE_RUNTIME_FACTS_UNSUPPORTED_TOOL");
    }
  }
  const proposedOperations =
    input.profile.operationMode === "planning"
      ? []
      : input.toolDescriptors.flatMap((descriptor) => operationsForTool(input.profile, descriptor));
  if (
    input.profile.operationMode === "planning" &&
    input.toolDescriptors.some((descriptor) => descriptor.effect === "propose")
  ) {
    throw new Error("PROVIDER_VISIBLE_RUNTIME_FACTS_INVALID");
  }
  const operations = canonicalOperations(proposedOperations);
  const writingOperations = operations.filter(isWritingOperation);
  const workspaceFileOperations = operations.filter(isWorkspaceOperation);
  if (
    (input.profile.profileId === "writing" && workspaceFileOperations.length > 0) ||
    (input.profile.profileId !== "writing" && writingOperations.length > 0)
  ) {
    throw new Error("PROVIDER_VISIBLE_RUNTIME_FACTS_INVALID");
  }
  if (input.effectiveCapabilityState !== undefined) {
    const effectiveWriting = new Set(effectiveWritingOperations(input.effectiveCapabilityState));
    const effectiveWorkspace = new Set(
      effectiveWorkspaceFileOperations(input.effectiveCapabilityState)
    );
    if (
      writingOperations.some((operation) => !effectiveWriting.has(operation)) ||
      workspaceFileOperations.some((operation) => !effectiveWorkspace.has(operation))
    ) {
      throw new Error("PROVIDER_VISIBLE_RUNTIME_FACTS_INVALID");
    }
  }
  const writeCapability = operations.length === 0 ? "none" : "propose";
  let writeApprovalPolicy: ProviderVisibleAgentRuntimeFacts["writeApprovalPolicy"] =
    "not_applicable";
  let approvalRuleSetVersion = "not_applicable";
  let approvalRuleSetChecksum = "not_applicable";
  let approvalRules: readonly ProviderVisibleApprovalRule[] = [];
  if (writeCapability === "propose") {
    if (
      input.executionWritePolicy === "user_preapproved_run" &&
      (input.executionWritePolicyAcknowledged !== true ||
        input.limitedRunPreapprovalQualified !== true)
    ) {
      throw new Error("PROVIDER_VISIBLE_RUNTIME_FACTS_PREAPPROVAL_UNQUALIFIED");
    }
    writeApprovalPolicy =
      input.executionWritePolicy === "user_preapproved_run"
        ? "limited_run_preapproval"
        : "confirm_each_change_set";
    const projection =
      input.approvalRuleSet ??
      createApprovalRuleSetProjection(operations, DEFAULT_APPROVAL_RULE_SET_VERSION);
    assertApprovalRuleProjection(projection, operations);
    approvalRuleSetVersion = projection.version;
    approvalRuleSetChecksum = projection.checksum;
    approvalRules = projection.rules;
  }
  const networkRead = input.toolDescriptors.some((descriptor) =>
    ["web_search", "fetch_url"].includes(canonicalToolId(descriptor))
  );
  const hasRemoteMcp = input.toolDescriptors.some(
    (descriptor) =>
      descriptor.source?.kind === "mcp" || canonicalToolId(descriptor).startsWith("mcp:")
  );
  assertExternalCapabilities(networkRead, hasRemoteMcp, input.effectiveCapabilityState);
  return deepFreeze({
    schemaVersion: PROVIDER_VISIBLE_RUNTIME_FACTS_SCHEMA_VERSION,
    profileId: input.profile.profileId,
    operationMode: input.profile.operationMode,
    workspaceBound: input.profile.workspaceBound,
    workspaceKind:
      input.profile.scope.kind === "workspace" ? input.profile.scope.workspaceKind : "none",
    writeCapability,
    writingOperations,
    workspaceFileOperations,
    writeApprovalPolicy,
    approvalRuleSetVersion,
    approvalRuleSetChecksum,
    approvalRules,
    networkRead,
    externalTools: hasRemoteMcp ? "remote_mcp" : "none",
    activeResourceKind: input.activeResourceKind
  });
}

export function parseProviderVisibleAgentRuntimeFacts(
  value: unknown
): ProviderVisibleAgentRuntimeFacts {
  if (!isRecord(value) || !hasExactlyFields(value, ROOT_FIELDS)) {
    throw new Error("PROVIDER_VISIBLE_RUNTIME_FACTS_INVALID");
  }
  const profileId = value["profileId"];
  const operationMode = value["operationMode"];
  const workspaceKind = value["workspaceKind"];
  const writingOperations = parseOperations(value["writingOperations"], isWritingOperation);
  const workspaceFileOperations = parseOperations(
    value["workspaceFileOperations"],
    isWorkspaceOperation
  );
  const approvalRules = parseApprovalRules(value["approvalRules"]);
  const parsed = {
    schemaVersion: value["schemaVersion"],
    profileId,
    operationMode,
    workspaceBound: value["workspaceBound"],
    workspaceKind,
    writeCapability: value["writeCapability"],
    writingOperations,
    workspaceFileOperations,
    writeApprovalPolicy: value["writeApprovalPolicy"],
    approvalRuleSetVersion: value["approvalRuleSetVersion"],
    approvalRuleSetChecksum: value["approvalRuleSetChecksum"],
    approvalRules,
    networkRead: value["networkRead"],
    externalTools: value["externalTools"],
    activeResourceKind: value["activeResourceKind"]
  };
  if (!isRuntimeFactsShape(parsed) || !runtimeFactsCrossInvariants(parsed)) {
    throw new Error("PROVIDER_VISIBLE_RUNTIME_FACTS_INVALID");
  }
  return deepFreeze(parsed as ProviderVisibleAgentRuntimeFacts);
}

export function serializeProviderVisibleAgentRuntimeFacts(
  value: ProviderVisibleAgentRuntimeFacts
): string {
  return stableSerialize(parseProviderVisibleAgentRuntimeFacts(value));
}

export function providerVisibleAgentRuntimeFactsChecksum(
  value: ProviderVisibleAgentRuntimeFacts
): string {
  return checksum(serializeProviderVisibleAgentRuntimeFacts(value));
}

function operationsForTool(
  profile: AgentContextProfile,
  descriptor: AgentToolDescriptor
): readonly ProviderVisibleWriteOperation[] {
  if (descriptor.effect !== "propose") return [];
  const operation = descriptor.writeOperation;
  if (operation === undefined) {
    throw new Error("PROVIDER_VISIBLE_RUNTIME_FACTS_UNMAPPED_MUTATION_TOOL");
  }
  if (
    (profile.profileId === "writing" && !isWritingOperation(operation)) ||
    (profile.profileId !== "writing" && !isWorkspaceOperation(operation))
  ) {
    throw new Error("PROVIDER_VISIBLE_RUNTIME_FACTS_INVALID");
  }
  return [operation];
}

function assertProfileAndCapabilityState(
  profile: AgentContextProfile,
  state: EffectiveCapabilityState | undefined
): void {
  if (profile.scope.kind === "standalone") {
    if (state !== undefined || profile.profileId !== "standalone") {
      throw new Error("PROVIDER_VISIBLE_RUNTIME_FACTS_INVALID");
    }
    return;
  }
  if (
    state === undefined ||
    !state.active ||
    state.workspaceKind !== profile.scope.workspaceKind ||
    state.capabilitySnapshot.workspaceKind !== profile.scope.workspaceKind
  ) {
    throw new Error("PROVIDER_VISIBLE_RUNTIME_FACTS_INVALID");
  }
}

function assertActiveResource(
  profile: AgentContextProfile,
  kind: ProviderVisibleAgentRuntimeFacts["activeResourceKind"]
): void {
  const valid =
    profile.profileId === "standalone"
      ? kind === "none"
      : profile.profileId === "writing"
        ? kind === "none" || kind === "chapter" || kind === "story_bible"
        : kind === "none" || kind === "project_file";
  if (!valid) throw new Error("PROVIDER_VISIBLE_RUNTIME_FACTS_INVALID");
}

function assertExternalCapabilities(
  networkRead: boolean,
  remoteMcp: boolean,
  state: EffectiveCapabilityState | undefined
): void {
  if (
    (networkRead &&
      (state?.capabilitySnapshot.networkReadEnabled !== true ||
        !isCapabilityEffective(state, "network"))) ||
    (remoteMcp &&
      (state?.capabilitySnapshot.mcpToolsEnabled !== true ||
        !isCapabilityEffective(state, "mcp_tools")))
  ) {
    throw new Error("PROVIDER_VISIBLE_RUNTIME_FACTS_INVALID");
  }
}

function assertApprovalRuleProjection(
  projection: ProviderVisibleApprovalRuleSetProjection,
  operations: readonly ProviderVisibleWriteOperation[]
): void {
  try {
    parseApprovalRuleSetProjection(projection, operations);
  } catch {
    throw new Error("PROVIDER_VISIBLE_RUNTIME_FACTS_INVALID");
  }
}

function runtimeFactsCrossInvariants(value: ProviderVisibleAgentRuntimeFacts): boolean {
  const operations = canonicalOperations([
    ...value.workspaceFileOperations,
    ...value.writingOperations
  ]);
  if (
    (value.profileId === "standalone") !== (value.workspaceKind === "none") ||
    value.workspaceBound !== (value.workspaceKind !== "none") ||
    (value.profileId === "writing" && value.workspaceFileOperations.length > 0) ||
    (value.profileId !== "writing" && value.writingOperations.length > 0) ||
    (value.operationMode === "planning" && operations.length > 0) ||
    (value.activeResourceKind === "chapter" && value.profileId !== "writing") ||
    (value.activeResourceKind === "story_bible" && value.profileId !== "writing") ||
    (value.activeResourceKind === "project_file" &&
      (value.profileId === "writing" || value.profileId === "standalone"))
  ) {
    return false;
  }
  if (operations.length === 0) {
    return (
      value.writeCapability === "none" &&
      value.writeApprovalPolicy === "not_applicable" &&
      value.approvalRuleSetVersion === "not_applicable" &&
      value.approvalRuleSetChecksum === "not_applicable" &&
      value.approvalRules.length === 0
    );
  }
  return (
    value.writeCapability === "propose" &&
    (value.writeApprovalPolicy === "confirm_each_change_set" ||
      value.writeApprovalPolicy === "limited_run_preapproval") &&
    validApprovalRuleProjection(value, operations)
  );
}

function validApprovalRuleProjection(
  value: ProviderVisibleAgentRuntimeFacts,
  operations: readonly ProviderVisibleWriteOperation[]
): boolean {
  try {
    parseApprovalRuleSetProjection(
      {
        version: value.approvalRuleSetVersion,
        checksum: value.approvalRuleSetChecksum,
        rules: value.approvalRules
      },
      operations
    );
    return true;
  } catch {
    return false;
  }
}

function isRuntimeFactsShape(value: unknown): value is ProviderVisibleAgentRuntimeFacts {
  if (!isRecord(value)) return false;
  return (
    value["schemaVersion"] === PROVIDER_VISIBLE_RUNTIME_FACTS_SCHEMA_VERSION &&
    isProfileId(value["profileId"]) &&
    isOperationMode(value["operationMode"]) &&
    typeof value["workspaceBound"] === "boolean" &&
    isWorkspaceKind(value["workspaceKind"]) &&
    (value["writeCapability"] === "none" || value["writeCapability"] === "propose") &&
    (value["writeApprovalPolicy"] === "not_applicable" ||
      value["writeApprovalPolicy"] === "confirm_each_change_set" ||
      value["writeApprovalPolicy"] === "limited_run_preapproval") &&
    typeof value["approvalRuleSetVersion"] === "string" &&
    typeof value["approvalRuleSetChecksum"] === "string" &&
    typeof value["networkRead"] === "boolean" &&
    (value["externalTools"] === "none" || value["externalTools"] === "remote_mcp") &&
    isActiveResourceKind(value["activeResourceKind"])
  );
}

function parseApprovalRules(value: unknown): readonly ProviderVisibleApprovalRule[] {
  if (!Array.isArray(value)) throw new Error("PROVIDER_VISIBLE_RUNTIME_FACTS_INVALID");
  return value.map((rule) => {
    if (!isRecord(rule)) throw new Error("PROVIDER_VISIBLE_RUNTIME_FACTS_INVALID");
    if (rule["reviewMode"] === "always_human") {
      if (
        !hasExactlyFields(rule, ["operation", "reviewMode"]) ||
        !isWriteOperation(rule["operation"])
      ) {
        throw new Error("PROVIDER_VISIBLE_RUNTIME_FACTS_INVALID");
      }
      return { operation: rule["operation"], reviewMode: "always_human" };
    }
    if (
      rule["reviewMode"] !== "conditional_auto_review" ||
      !hasExactlyFields(rule, ["operation", "reviewMode", "effectRuleId"]) ||
      !isWriteOperation(rule["operation"]) ||
      !isConditionalRuleId(rule["effectRuleId"])
    ) {
      throw new Error("PROVIDER_VISIBLE_RUNTIME_FACTS_INVALID");
    }
    return {
      operation: rule["operation"],
      reviewMode: "conditional_auto_review",
      effectRuleId: rule["effectRuleId"]
    };
  });
}

function parseOperations<T extends ProviderVisibleWriteOperation>(
  value: unknown,
  predicate: (value: unknown) => value is T
): readonly T[] {
  if (!Array.isArray(value) || value.some((operation) => !predicate(operation))) {
    throw new Error("PROVIDER_VISIBLE_RUNTIME_FACTS_INVALID");
  }
  const canonical = canonicalOperations(value as T[]).filter(predicate);
  if (stableSerialize(value) !== stableSerialize(canonical)) {
    throw new Error("PROVIDER_VISIBLE_RUNTIME_FACTS_INVALID");
  }
  return canonical;
}

function canonicalOperations(
  operations: readonly ProviderVisibleWriteOperation[]
): readonly ProviderVisibleWriteOperation[] {
  const unique = new Set(operations);
  if (unique.size !== operations.length) throw new Error("PROVIDER_VISIBLE_RUNTIME_FACTS_INVALID");
  return WRITE_OPERATION_ORDER.filter((operation) => unique.has(operation));
}

function canonicalToolId(descriptor: AgentToolDescriptor): string {
  return String(descriptor.id ?? descriptor.name);
}

function isWorkspaceOperation(value: unknown): value is ProviderVisibleWorkspaceFileOperation {
  return isProviderVisibleWorkspaceFileOperation(value);
}

function isWritingOperation(value: unknown): value is ProviderVisibleWritingOperation {
  return isProviderVisibleWritingOperation(value);
}

function isWriteOperation(value: unknown): value is ProviderVisibleWriteOperation {
  return isWorkspaceOperation(value) || isWritingOperation(value);
}

function isConditionalRuleId(value: unknown): value is ProviderVisibleConditionalApprovalRuleId {
  return (
    value === "clean_chapter_body_v1" ||
    value === "bounded_chapter_create_v1" ||
    value === "bounded_story_bible_create_v1" ||
    value === "no_reference_impact_story_bible_patch_v1" ||
    value === "ordinary_clean_file_replace_v1" ||
    value === "ordinary_create_only_v1"
  );
}

function isProfileId(value: unknown): value is AgentContextProfile["profileId"] {
  return (
    value === "standalone" ||
    value === "writing" ||
    value === "creative_general" ||
    value === "engineering"
  );
}

function isOperationMode(value: unknown): value is AgentContextProfile["operationMode"] {
  return value === "conversation" || value === "planning" || value === "execution";
}

function isWorkspaceKind(
  value: unknown
): value is ProviderVisibleAgentRuntimeFacts["workspaceKind"] {
  return value === "none" || value === "creativeProject" || value === "engineeringWorkspace";
}

function isActiveResourceKind(
  value: unknown
): value is ProviderVisibleAgentRuntimeFacts["activeResourceKind"] {
  return (
    value === "none" || value === "chapter" || value === "story_bible" || value === "project_file"
  );
}

function hasExactlyFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const expected = [...fields].sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checksum(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
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
