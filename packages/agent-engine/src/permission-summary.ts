import { createHash } from "node:crypto";

import type { AgentContextMode, AgentOperationMode, AgentWritePolicy } from "./agent-run-types.js";
import {
  createDefaultCapabilitySnapshot,
  freezeAgentToolCapabilitySnapshot,
  isProviderVisibleWorkspaceFileOperation,
  isProviderVisibleWritingOperation,
  qualifiedWorkspaceFileOperations,
  qualifiedWritingOperations,
  WRITE_OPERATION_ORDER,
  type AgentToolCapabilitySnapshot,
  type AgentWorkspaceKind,
  type ProviderVisibleWorkspaceFileOperation,
  type ProviderVisibleWriteOperation,
  type ProviderVisibleWritingOperation
} from "./agent-tool-capabilities.js";
import {
  DEFAULT_APPROVAL_RULE_SET_VERSION,
  canonicalizeWriteOperations,
  createApprovalRuleSetProjection,
  parseApprovalRuleSetProjection,
  type ProviderVisibleApprovalRule
} from "./approval-rule-registry.js";
import {
  listAgentTools,
  type AgentToolDescriptor,
  type ListAgentToolsInput
} from "./tool-registry.js";

export type AgentWriteMutationTrust =
  "unavailable" | "standard_trusted_creative" | "hardened_native";

/**
 * The capabilities Stage 5 never grants to an Agent run. They are a fixed, registry-independent
 * denial list surfaced verbatim in the permission summary so the UI cannot dress a Stage 5 run up as
 * a "fully authorized" Shell/Git/network agent. The generator always emits exactly this list; no
 * caller (renderer, model, or file content) can widen, narrow, or reorder it.
 * @since v1.0 — kept for backward compatibility; v1.1 computes forbidden list from server-side phase state.
 */
export const AGENT_FORBIDDEN_CAPABILITIES = Object.freeze([
  "shell",
  "git",
  "network",
  "delete",
  "move",
  "rename",
  "create_directory"
] as const);

/**
 * A server-authored facts DTO describing exactly what an Agent run may read, propose, and never do.
 * It is generated from the actual Tool Registry, canonical project root, and the user's draft
 * choices — never authored by the renderer, model, or file content. The `checksum` binds the
 * capability facts so a run-start regeneration can detect any drift or tampering.
 * @since v1.0
 */
export interface PermissionSummaryV10 {
  readonly schemaVersion: "1.0";
  readonly permissionSummaryId: string;
  readonly projectId: string;
  readonly runDraftId: string;
  readonly runId?: string;
  readonly contextMode: AgentContextMode;
  readonly writePolicy: AgentWritePolicy;
  readonly toolRegistryRevision: string;
  readonly rootFingerprint: string;
  readonly readCapabilities: readonly string[];
  readonly proposalCapabilities: readonly string[];
  readonly forbiddenCapabilities: readonly string[];
  readonly checksum: string;
  readonly generatedAt: string;
}

/**
 * Task 0.2 — v1.1 Permission Summary with extended capability groups and workspace context.
 * New runs write v1.1; old v1.0 records remain readable via `normalizePermissionSummary`.
 * `checksum` covers the v1.0 core fields for backward compatibility. `extendedChecksum` covers
 * every v1.1 authorization fact, including the frozen descriptor and provider mapping revisions.
 * @since v1.1
 */
export interface PermissionSummaryV11 extends Omit<PermissionSummaryV10, "schemaVersion"> {
  readonly schemaVersion: "1.1";
  /** Task 0.1: workspace kind used to compute this summary. */
  readonly workspaceKind: import("./agent-tool-capabilities.js").AgentWorkspaceKind;
  /** operation mode stored for audit; v1.0 did not persist this. */
  readonly operationMode: AgentOperationMode;
  /** Phase A–D execution capability names. */
  readonly executeCapabilities: readonly string[];
  /** Phase D external-read capability names. */
  readonly externalReadCapabilities: readonly string[];
  /** Phase E external-action capability names. */
  readonly externalActionCapabilities: readonly string[];
  /** Data-egress authorization classes present in this run. */
  readonly dataEgressCapabilities: readonly string[];
  /** Task 0.1: feature-flag revision used to build the capability snapshot. */
  readonly featureFlagRevision: string;
  /** Digest of the exact descriptor directory exposed to this run. */
  readonly descriptorRevision: string;
  /** Digest of the frozen canonical-id <-> provider-name mapping for this run. */
  readonly providerMappingRevision: string;
  /** Main-owned write backend classification. Missing only on legacy v1.1 records. */
  readonly writeMutationTrust?: AgentWriteMutationTrust;
  /** SHA-256 of the extended fields (all authorization facts in this v1.1 record). */
  readonly extendedChecksum: string;
}

export interface PermissionSummaryV20 extends Omit<
  PermissionSummaryV10,
  "schemaVersion" | "writePolicy" | "forbiddenCapabilities" | "checksum"
> {
  readonly schemaVersion: "2.0";
  readonly writePolicy: AgentWritePolicy;
  readonly workspaceKind: AgentWorkspaceKind;
  readonly operationMode: AgentOperationMode;
  readonly toolCatalogSchemaVersion: "2.0";
  readonly descriptorRevision: string;
  readonly providerMappingRevision: string;
  readonly featureFlagRevision: string;
  readonly executeCapabilities: readonly string[];
  readonly externalReadCapabilities: readonly string[];
  readonly externalActionCapabilities: readonly string[];
  readonly dataEgressCapabilities: readonly string[];
  readonly allowedCapabilities: readonly string[];
  readonly forbiddenCapabilities: readonly string[];
  readonly writeMutationTrust: AgentWriteMutationTrust;
  readonly writeCapability: "none" | "propose";
  readonly writingOperations: readonly ProviderVisibleWritingOperation[];
  readonly workspaceFileOperations: readonly ProviderVisibleWorkspaceFileOperation[];
  readonly writeApprovalPolicy:
    "not_applicable" | "confirm_each_change_set" | "limited_run_preapproval";
  readonly approvalRuleSetVersion: string;
  readonly approvalRuleSetChecksum: string;
  readonly approvalRules: readonly ProviderVisibleApprovalRule[];
  readonly checksum: string;
}

/** Active summary union. Legacy versions remain read-only and never acquire 2.0 operations. */
export type PermissionSummary = PermissionSummaryV10 | PermissionSummaryV11 | PermissionSummaryV20;

export type AgentToolLister = (input: ListAgentToolsInput) => readonly AgentToolDescriptor[];

export interface GeneratePermissionSummaryInput {
  readonly permissionSummaryId: string;
  readonly projectId: string;
  readonly runDraftId: string;
  readonly runId?: string;
  readonly operationMode: AgentOperationMode;
  readonly contextMode: AgentContextMode;
  readonly writePolicy: AgentWritePolicy;
  readonly rootFingerprint: string;
  readonly generatedAt: string;
  /** Server-generated capability snapshot frozen before this summary is generated. */
  readonly capabilitySnapshot?: AgentToolCapabilitySnapshot;
  /** Server-validated dynamic descriptors frozen before this summary is generated. */
  readonly externalToolDescriptors?: readonly AgentToolDescriptor[];
  /**
   * Digest of the frozen canonical-id <-> provider-name mapping. If the control plane does not
   * supply one, it is deterministically derived from the descriptors for this summary.
   */
  readonly providerMappingRevision?: string;
  /** Main-owned write backend classification; unrecognized or absent values fail closed. */
  readonly writeMutationTrust?: AgentWriteMutationTrust;
  /** Injectable Tool Registry lister; defaults to the real registry. Tests use it to prove drift. */
  readonly listTools?: AgentToolLister;
}

/**
 * Generate a server-owned Permission Summary from the actual Tool Registry, the canonical project
 * root fingerprint, and the draft's operation/context/write-policy facts. Planning always uses
 * `write_before_confirmation` internally and exposes no auto-modification choice — the caller's
 * `writePolicy` is ignored for planning runs, mirroring `agent-run-draft.ts`'s `normalizePolicy`.
 * No renderer-, model-, or file-authored capability array is ever accepted; every array here is
 * derived fresh from `listAgentTools` (or the injected `listTools` stub in tests).
 */
export function generatePermissionSummary(
  input: GeneratePermissionSummaryInput
): PermissionSummaryV11 {
  const listTools = input.listTools ?? listAgentTools;
  const capabilitySnapshot = freezeAgentToolCapabilitySnapshot(
    input.capabilitySnapshot ??
      createDefaultCapabilitySnapshot(defaultWorkspaceKind(input.contextMode))
  );
  const writePolicy: AgentWritePolicy =
    input.operationMode === "planning" ? "write_before_confirmation" : input.writePolicy;
  const toolRegistryRevision = computeToolRegistryRevision(
    listTools,
    capabilitySnapshot,
    input.externalToolDescriptors
  );
  const tools = listTools({
    operationMode: input.operationMode,
    contextMode: input.contextMode,
    writePolicy,
    capabilitySnapshot,
    ...(input.externalToolDescriptors === undefined
      ? {}
      : { externalToolDescriptors: input.externalToolDescriptors })
  });
  const readCapabilities = capabilitiesWithEffect(tools, "read");
  const proposalCapabilities = capabilitiesWithEffect(tools, "propose");
  const executeCapabilities = capabilitiesWithEffect(tools, "execute");
  const externalReadCapabilities = capabilitiesWithEffect(tools, "external_read");
  const externalActionCapabilities = capabilitiesWithEffect(tools, "external_action");
  const dataEgressCapabilities = [
    ...new Set(
      tools.map((tool) => tool.dataEgress ?? "none").filter((capability) => capability !== "none")
    )
  ].sort(compareCanonicalStrings);
  const forbiddenCapabilities = [...AGENT_FORBIDDEN_CAPABILITIES];

  const checksum = checksumText(
    stableSerialize(
      coreChecksumFields({
        projectId: input.projectId,
        runDraftId: input.runDraftId,
        contextMode: input.contextMode,
        writePolicy,
        toolRegistryRevision,
        rootFingerprint: input.rootFingerprint,
        readCapabilities,
        proposalCapabilities,
        forbiddenCapabilities
      })
    )
  );
  const descriptorRevision = computeDescriptorRevision(tools);
  const providerMappingRevision =
    input.providerMappingRevision ?? computeProviderMappingRevision(tools);
  const writeMutationTrust = normalizeWriteMutationTrust(input.writeMutationTrust);
  const extendedChecksum = checksumText(
    stableSerialize({
      checksum,
      workspaceKind: capabilitySnapshot.workspaceKind,
      operationMode: input.operationMode,
      executeCapabilities,
      externalReadCapabilities,
      externalActionCapabilities,
      dataEgressCapabilities,
      featureFlagRevision: capabilitySnapshot.featureFlagRevision,
      descriptorRevision,
      providerMappingRevision,
      writeMutationTrust
    })
  );

  return {
    schemaVersion: "1.1",
    permissionSummaryId: input.permissionSummaryId,
    projectId: input.projectId,
    runDraftId: input.runDraftId,
    ...(input.runId === undefined ? {} : { runId: input.runId }),
    contextMode: input.contextMode,
    writePolicy,
    toolRegistryRevision,
    rootFingerprint: input.rootFingerprint,
    readCapabilities,
    proposalCapabilities,
    forbiddenCapabilities,
    checksum,
    generatedAt: input.generatedAt,
    workspaceKind: capabilitySnapshot.workspaceKind,
    operationMode: input.operationMode,
    executeCapabilities,
    externalReadCapabilities,
    externalActionCapabilities,
    dataEgressCapabilities,
    featureFlagRevision: capabilitySnapshot.featureFlagRevision,
    descriptorRevision,
    providerMappingRevision,
    writeMutationTrust,
    extendedChecksum
  };
}

export interface GeneratePermissionSummaryV2Input extends Omit<
  GeneratePermissionSummaryInput,
  "providerMappingRevision"
> {
  readonly providerMappingRevision?: string;
  /** Final sanitized/provider-projected descriptor directory. Runtime callers must pass this. */
  readonly frozenToolDescriptors?: readonly AgentToolDescriptor[];
  readonly writePolicyAcknowledged?: boolean;
  readonly limitedRunPreapprovalQualified?: boolean;
  readonly approvalRuleSetVersion?: string;
}

export function generatePermissionSummaryV2(
  input: GeneratePermissionSummaryV2Input
): PermissionSummaryV20 {
  if (!isCanonicalUtcTimestamp(input.generatedAt)) {
    throw new Error("PERMISSION_SUMMARY_V2_INVALID");
  }
  const listTools = input.listTools ?? listAgentTools;
  const capabilitySnapshot = freezeAgentToolCapabilitySnapshot(
    input.capabilitySnapshot ??
      createDefaultCapabilitySnapshot(defaultWorkspaceKind(input.contextMode))
  );
  const writePolicy: AgentWritePolicy =
    input.operationMode === "planning" ? "write_before_confirmation" : input.writePolicy;
  const tools =
    input.frozenToolDescriptors ??
    listTools({
      facadeVersion: "v2",
      catalogSchemaVersion: "2.0",
      operationMode: input.operationMode,
      contextMode: input.contextMode,
      writePolicy,
      capabilitySnapshot,
      ...(input.externalToolDescriptors === undefined
        ? {}
        : { externalToolDescriptors: input.externalToolDescriptors })
    });
  const operations = canonicalizeWriteOperations(
    tools.flatMap((tool): readonly ProviderVisibleWriteOperation[] => {
      if (tool.effect !== "propose") {
        if (tool.writeOperation !== undefined) throw new Error("PERMISSION_SUMMARY_V2_INVALID");
        return [];
      }
      if (tool.writeOperation === undefined) throw new Error("PERMISSION_SUMMARY_V2_INVALID");
      return [tool.writeOperation];
    })
  );
  const writingOperations = operations.filter(isProviderVisibleWritingOperation);
  const workspaceFileOperations = operations.filter(isProviderVisibleWorkspaceFileOperation);
  if (
    (input.contextMode === "writing" && workspaceFileOperations.length > 0) ||
    (input.contextMode !== "writing" && writingOperations.length > 0) ||
    writingOperations.some(
      (operation) => !qualifiedWritingOperations(capabilitySnapshot).includes(operation)
    ) ||
    workspaceFileOperations.some(
      (operation) => !qualifiedWorkspaceFileOperations(capabilitySnapshot).includes(operation)
    )
  ) {
    throw new Error("PERMISSION_SUMMARY_V2_INVALID");
  }
  const writeCapability: PermissionSummaryV20["writeCapability"] =
    operations.length === 0 ? "none" : "propose";
  let writeApprovalPolicy: PermissionSummaryV20["writeApprovalPolicy"] = "not_applicable";
  let approvalRuleSetVersion = "not_applicable";
  let approvalRuleSetChecksum = "not_applicable";
  let approvalRules: readonly ProviderVisibleApprovalRule[] = [];
  if (writeCapability === "propose") {
    if (
      writePolicy === "user_preapproved_run" &&
      (input.writePolicyAcknowledged !== true || input.limitedRunPreapprovalQualified !== true)
    ) {
      throw new Error("PERMISSION_SUMMARY_V2_PREAPPROVAL_UNQUALIFIED");
    }
    writeApprovalPolicy =
      writePolicy === "user_preapproved_run"
        ? "limited_run_preapproval"
        : "confirm_each_change_set";
    const projection = createApprovalRuleSetProjection(
      operations,
      input.approvalRuleSetVersion ?? DEFAULT_APPROVAL_RULE_SET_VERSION
    );
    approvalRuleSetVersion = projection.version;
    approvalRuleSetChecksum = projection.checksum;
    approvalRules = projection.rules;
  }
  const readCapabilities = providerNamesWithEffect(tools, "read");
  const proposalCapabilities = providerNamesWithEffect(tools, "propose");
  const executeCapabilities = providerNamesWithEffect(tools, "execute");
  const externalReadCapabilities = providerNamesWithEffect(tools, "external_read");
  const externalActionCapabilities = providerNamesWithEffect(tools, "external_action");
  const dataEgressCapabilities = sortedUnique(
    tools.map((tool) => tool.dataEgress ?? "none").filter((value) => value !== "none")
  );
  const networkRead = tools.some((tool) => {
    const id = tool.id ?? tool.name;
    return id === "web_search" || id === "fetch_url";
  });
  const remoteMcp = tools.some(
    (tool) => tool.source?.kind === "mcp" || String(tool.id ?? tool.name).startsWith("mcp:")
  );
  const allowedCapabilities = deriveAllowedCapabilities({
    readCapabilities,
    proposalCapabilities,
    executeCapabilities,
    externalReadCapabilities,
    externalActionCapabilities,
    operations,
    networkRead,
    remoteMcp
  });
  const allowedSet = new Set(allowedCapabilities);
  const forbiddenCapabilities = sortedUnique(
    PERMISSION_SUMMARY_V2_CAPABILITY_UNIVERSE.filter((capability) => !allowedSet.has(capability))
  );
  const descriptorRevision = computeDescriptorRevision(tools);
  const computedProviderMappingRevision = computeProviderMappingRevision(tools);
  if (
    input.providerMappingRevision !== undefined &&
    input.providerMappingRevision !== computedProviderMappingRevision
  ) {
    throw new Error("PERMISSION_SUMMARY_V2_PROVIDER_MAPPING_INVALID");
  }
  const providerMappingRevision = computedProviderMappingRevision;
  const writeMutationTrust = normalizeWriteMutationTrust(input.writeMutationTrust);
  const toolRegistryRevision = computePermissionSummaryCatalogV2Revision({
    descriptorRevision,
    providerMappingRevision,
    approvalRuleSetVersion,
    approvalRuleSetChecksum,
    approvalRules
  });
  const unsigned = {
    projectId: input.projectId,
    runDraftId: input.runDraftId,
    contextMode: input.contextMode,
    writePolicy,
    toolRegistryRevision,
    rootFingerprint: input.rootFingerprint,
    readCapabilities,
    proposalCapabilities,
    forbiddenCapabilities,
    workspaceKind: capabilitySnapshot.workspaceKind,
    operationMode: input.operationMode,
    toolCatalogSchemaVersion: "2.0" as const,
    descriptorRevision,
    providerMappingRevision,
    featureFlagRevision: capabilitySnapshot.featureFlagRevision,
    executeCapabilities,
    externalReadCapabilities,
    externalActionCapabilities,
    dataEgressCapabilities,
    allowedCapabilities,
    writeMutationTrust,
    writeCapability,
    writingOperations,
    workspaceFileOperations,
    writeApprovalPolicy,
    approvalRuleSetVersion,
    approvalRuleSetChecksum,
    approvalRules
  };
  const summary = deepFreeze({
    schemaVersion: "2.0",
    permissionSummaryId: input.permissionSummaryId,
    ...unsigned,
    ...(input.runId === undefined ? {} : { runId: input.runId }),
    checksum: checksumText(stableSerialize({ schemaVersion: "2.0", ...unsigned })),
    generatedAt: input.generatedAt
  });
  return parsePermissionSummaryV20(summary);
}

const WRITE_OPERATION_CAPABILITY_NAMES = Object.freeze(
  WRITE_OPERATION_ORDER.map((operation) => `operation:${operation}`)
);

const PERMISSION_SUMMARY_V2_FIELDS = Object.freeze([
  "schemaVersion",
  "permissionSummaryId",
  "projectId",
  "runDraftId",
  "contextMode",
  "writePolicy",
  "toolRegistryRevision",
  "rootFingerprint",
  "readCapabilities",
  "proposalCapabilities",
  "forbiddenCapabilities",
  "generatedAt",
  "workspaceKind",
  "operationMode",
  "toolCatalogSchemaVersion",
  "descriptorRevision",
  "providerMappingRevision",
  "featureFlagRevision",
  "executeCapabilities",
  "externalReadCapabilities",
  "externalActionCapabilities",
  "dataEgressCapabilities",
  "allowedCapabilities",
  "writeMutationTrust",
  "writeCapability",
  "writingOperations",
  "workspaceFileOperations",
  "writeApprovalPolicy",
  "approvalRuleSetVersion",
  "approvalRuleSetChecksum",
  "approvalRules",
  "checksum"
] as const);

const PERMISSION_SUMMARY_V2_CAPABILITY_UNIVERSE = Object.freeze([
  "read",
  "write",
  "execute",
  "external_read",
  "external_action",
  "network",
  "remote_mcp",
  "shell",
  "git",
  ...WRITE_OPERATION_CAPABILITY_NAMES
]);

/** Strict reader for persisted 2.0 summaries. Unknown fields and semantic contradictions fail closed. */
export function parsePermissionSummaryV20(value: unknown): PermissionSummaryV20 {
  if (!isRecord(value)) throw new Error("PERMISSION_SUMMARY_V2_INVALID");
  const expectedFields = Object.prototype.hasOwnProperty.call(value, "runId")
    ? [...PERMISSION_SUMMARY_V2_FIELDS, "runId"]
    : PERMISSION_SUMMARY_V2_FIELDS;
  if (!hasExactlyFields(value, expectedFields)) throw new Error("PERMISSION_SUMMARY_V2_INVALID");

  if (
    value["schemaVersion"] !== "2.0" ||
    value["toolCatalogSchemaVersion"] !== "2.0" ||
    !isBoundedString(value["permissionSummaryId"]) ||
    !isBoundedString(value["projectId"]) ||
    !isBoundedString(value["runDraftId"]) ||
    (value["runId"] !== undefined && !isBoundedString(value["runId"])) ||
    (value["contextMode"] !== "writing" && value["contextMode"] !== "general_file") ||
    (value["writePolicy"] !== "write_before_confirmation" &&
      value["writePolicy"] !== "user_preapproved_run") ||
    (value["workspaceKind"] !== "creativeProject" &&
      value["workspaceKind"] !== "engineeringWorkspace") ||
    (value["operationMode"] !== "planning" && value["operationMode"] !== "execution") ||
    !isBoundedString(value["rootFingerprint"]) ||
    !isBoundedString(value["featureFlagRevision"]) ||
    !SHA256.test(String(value["toolRegistryRevision"])) ||
    !SHA256.test(String(value["descriptorRevision"])) ||
    !SHA256.test(String(value["providerMappingRevision"])) ||
    !SHA256.test(String(value["checksum"])) ||
    !isCanonicalUtcTimestamp(value["generatedAt"]) ||
    (value["writeMutationTrust"] !== "unavailable" &&
      value["writeMutationTrust"] !== "standard_trusted_creative" &&
      value["writeMutationTrust"] !== "hardened_native") ||
    (value["writeCapability"] !== "none" && value["writeCapability"] !== "propose") ||
    (value["writeApprovalPolicy"] !== "not_applicable" &&
      value["writeApprovalPolicy"] !== "confirm_each_change_set" &&
      value["writeApprovalPolicy"] !== "limited_run_preapproval")
  ) {
    throw new Error("PERMISSION_SUMMARY_V2_INVALID");
  }

  const readCapabilities = parseProviderNames(value["readCapabilities"]);
  const proposalCapabilities = parseProviderNames(value["proposalCapabilities"]);
  const executeCapabilities = parseProviderNames(value["executeCapabilities"]);
  const externalReadCapabilities = parseProviderNames(value["externalReadCapabilities"]);
  const externalActionCapabilities = parseProviderNames(value["externalActionCapabilities"]);
  const dataEgressCapabilities = parseSortedUniqueStrings(value["dataEgressCapabilities"]);
  const allowedCapabilities = parseSortedUniqueStrings(value["allowedCapabilities"]);
  const forbiddenCapabilities = parseSortedUniqueStrings(value["forbiddenCapabilities"]);
  const writingOperations = parseWritingOperations(value["writingOperations"]);
  const workspaceFileOperations = parseWorkspaceFileOperations(value["workspaceFileOperations"]);
  const operations = canonicalizeWriteOperations([
    ...workspaceFileOperations,
    ...writingOperations
  ]);
  if (
    (value["contextMode"] === "writing" && workspaceFileOperations.length > 0) ||
    (value["contextMode"] !== "writing" && writingOperations.length > 0) ||
    (value["contextMode"] === "writing" && value["workspaceKind"] !== "creativeProject") ||
    (value["operationMode"] === "planning" && operations.length > 0) ||
    (value["operationMode"] === "planning" &&
      value["writePolicy"] !== "write_before_confirmation") ||
    (operations.length === 0) !== (value["writeCapability"] === "none") ||
    (operations.length > 0 && value["writeMutationTrust"] === "unavailable") ||
    (value["workspaceKind"] === "engineeringWorkspace" &&
      value["writeMutationTrust"] === "standard_trusted_creative") ||
    proposalCapabilities.length !== operations.length
  ) {
    throw new Error("PERMISSION_SUMMARY_V2_INVALID");
  }

  let approvalRules: readonly ProviderVisibleApprovalRule[];
  if (operations.length === 0) {
    if (
      value["writeApprovalPolicy"] !== "not_applicable" ||
      value["approvalRuleSetVersion"] !== "not_applicable" ||
      value["approvalRuleSetChecksum"] !== "not_applicable" ||
      !Array.isArray(value["approvalRules"]) ||
      value["approvalRules"].length !== 0
    ) {
      throw new Error("PERMISSION_SUMMARY_V2_INVALID");
    }
    approvalRules = Object.freeze([]);
  } else {
    const expectedPolicy =
      value["writePolicy"] === "user_preapproved_run"
        ? "limited_run_preapproval"
        : "confirm_each_change_set";
    if (
      value["operationMode"] !== "execution" ||
      value["writeApprovalPolicy"] !== expectedPolicy ||
      typeof value["approvalRuleSetVersion"] !== "string" ||
      typeof value["approvalRuleSetChecksum"] !== "string"
    ) {
      throw new Error("PERMISSION_SUMMARY_V2_INVALID");
    }
    approvalRules = parseApprovalRuleSetProjection(
      {
        version: value["approvalRuleSetVersion"],
        checksum: value["approvalRuleSetChecksum"],
        rules: value["approvalRules"]
      },
      operations
    ).rules;
  }

  const expectedCatalogRevision = computePermissionSummaryCatalogV2Revision({
    descriptorRevision: value["descriptorRevision"] as string,
    providerMappingRevision: value["providerMappingRevision"] as string,
    approvalRuleSetVersion: value["approvalRuleSetVersion"] as string,
    approvalRuleSetChecksum: value["approvalRuleSetChecksum"] as string,
    approvalRules
  });
  if (value["toolRegistryRevision"] !== expectedCatalogRevision) {
    throw new Error("PERMISSION_SUMMARY_V2_INVALID");
  }

  const expectedAllowedCapabilities = deriveAllowedCapabilities({
    readCapabilities,
    proposalCapabilities,
    executeCapabilities,
    externalReadCapabilities,
    externalActionCapabilities,
    operations
  });
  const expectedDataEgressCapabilities = deriveDataEgressCapabilities({
    externalReadCapabilities,
    externalActionCapabilities
  });
  const allowedSet = new Set(allowedCapabilities);
  const providerNames = [
    ...readCapabilities,
    ...proposalCapabilities,
    ...executeCapabilities,
    ...externalReadCapabilities,
    ...externalActionCapabilities
  ];
  if (
    new Set(providerNames).size !== providerNames.length ||
    dataEgressCapabilities.some(
      (capability) => capability !== "provider_query" && capability !== "remote_tool_arguments"
    ) ||
    stableSerialize(dataEgressCapabilities) !== stableSerialize(expectedDataEgressCapabilities) ||
    stableSerialize(allowedCapabilities) !== stableSerialize(expectedAllowedCapabilities) ||
    forbiddenCapabilities.some((capability) => allowedSet.has(capability)) ||
    stableSerialize(forbiddenCapabilities) !==
      stableSerialize(
        sortedUnique(
          PERMISSION_SUMMARY_V2_CAPABILITY_UNIVERSE.filter(
            (capability) => !allowedSet.has(capability)
          )
        )
      )
  ) {
    throw new Error("PERMISSION_SUMMARY_V2_INVALID");
  }

  const unsigned = {
    projectId: value["projectId"] as string,
    runDraftId: value["runDraftId"] as string,
    contextMode: value["contextMode"] as AgentContextMode,
    writePolicy: value["writePolicy"] as AgentWritePolicy,
    toolRegistryRevision: value["toolRegistryRevision"] as string,
    rootFingerprint: value["rootFingerprint"] as string,
    readCapabilities,
    proposalCapabilities,
    forbiddenCapabilities,
    workspaceKind: value["workspaceKind"] as AgentWorkspaceKind,
    operationMode: value["operationMode"] as AgentOperationMode,
    toolCatalogSchemaVersion: "2.0" as const,
    descriptorRevision: value["descriptorRevision"] as string,
    providerMappingRevision: value["providerMappingRevision"] as string,
    featureFlagRevision: value["featureFlagRevision"] as string,
    executeCapabilities,
    externalReadCapabilities,
    externalActionCapabilities,
    dataEgressCapabilities,
    allowedCapabilities,
    writeMutationTrust: value["writeMutationTrust"] as AgentWriteMutationTrust,
    writeCapability: value["writeCapability"] as PermissionSummaryV20["writeCapability"],
    writingOperations,
    workspaceFileOperations,
    writeApprovalPolicy: value[
      "writeApprovalPolicy"
    ] as PermissionSummaryV20["writeApprovalPolicy"],
    approvalRuleSetVersion: value["approvalRuleSetVersion"] as string,
    approvalRuleSetChecksum: value["approvalRuleSetChecksum"] as string,
    approvalRules
  };
  if (value["checksum"] !== checksumText(stableSerialize({ schemaVersion: "2.0", ...unsigned }))) {
    throw new Error("PERMISSION_SUMMARY_V2_INVALID");
  }
  return deepFreeze({
    schemaVersion: "2.0",
    permissionSummaryId: value["permissionSummaryId"] as string,
    ...unsigned,
    ...(value["runId"] === undefined ? {} : { runId: value["runId"] as string }),
    checksum: value["checksum"] as string,
    generatedAt: value["generatedAt"] as string
  });
}

export interface PermissionSummaryFieldDrift {
  readonly field: string;
  readonly stored: unknown;
  readonly regenerated: unknown;
}

const COMPARABLE_PERMISSION_SUMMARY_FIELDS = [
  "projectId",
  "runDraftId",
  "contextMode",
  "writePolicy",
  "toolRegistryRevision",
  "rootFingerprint",
  "readCapabilities",
  "proposalCapabilities",
  "forbiddenCapabilities",
  "checksum"
] as const satisfies readonly (keyof PermissionSummaryV10)[];

const COMPARABLE_PERMISSION_SUMMARY_V11_FIELDS = [
  "schemaVersion",
  "workspaceKind",
  "operationMode",
  "executeCapabilities",
  "externalReadCapabilities",
  "externalActionCapabilities",
  "dataEgressCapabilities",
  "featureFlagRevision",
  "descriptorRevision",
  "providerMappingRevision",
  "writeMutationTrust",
  "extendedChecksum"
] as const satisfies readonly (keyof PermissionSummaryV11)[];

const COMPARABLE_PERMISSION_SUMMARY_V20_FIELDS = [
  "schemaVersion",
  "workspaceKind",
  "operationMode",
  "toolCatalogSchemaVersion",
  "descriptorRevision",
  "providerMappingRevision",
  "featureFlagRevision",
  "executeCapabilities",
  "externalReadCapabilities",
  "externalActionCapabilities",
  "dataEgressCapabilities",
  "allowedCapabilities",
  "writeMutationTrust",
  "writeCapability",
  "writingOperations",
  "workspaceFileOperations",
  "writeApprovalPolicy",
  "approvalRuleSetVersion",
  "approvalRuleSetChecksum",
  "approvalRules"
] as const satisfies readonly (keyof PermissionSummaryV20)[];

/**
 * Field-by-field comparison between a stored Permission Summary and one freshly regenerated at run
 * start. `permissionSummaryId`, `runId`, and `generatedAt` are deliberately excluded: they are
 * expected to differ across generations and carry no capability meaning. An empty result means the
 * stored summary is still fresh; any entry means the run must be blocked.
 */
export function findPermissionSummaryDrift(
  stored: PermissionSummary,
  regenerated: PermissionSummary
): readonly PermissionSummaryFieldDrift[] {
  const drift: PermissionSummaryFieldDrift[] = [];
  for (const field of COMPARABLE_PERMISSION_SUMMARY_FIELDS) {
    const storedValue = stored[field];
    const regeneratedValue = regenerated[field];
    if (stableSerialize(storedValue) !== stableSerialize(regeneratedValue)) {
      drift.push({ field, stored: storedValue, regenerated: regeneratedValue });
    }
  }
  if (isPermissionSummaryV20(stored) && isPermissionSummaryV20(regenerated)) {
    for (const field of COMPARABLE_PERMISSION_SUMMARY_V20_FIELDS) {
      const storedValue = stored[field];
      const regeneratedValue = regenerated[field];
      if (stableSerialize(storedValue) !== stableSerialize(regeneratedValue)) {
        drift.push({ field, stored: storedValue, regenerated: regeneratedValue });
      }
    }
  } else if (isPermissionSummaryV11(stored) && isPermissionSummaryV11(regenerated)) {
    for (const field of COMPARABLE_PERMISSION_SUMMARY_V11_FIELDS) {
      const storedValue = stored[field];
      const regeneratedValue = regenerated[field];
      if (stableSerialize(storedValue) !== stableSerialize(regeneratedValue)) {
        drift.push({ field, stored: storedValue, regenerated: regeneratedValue });
      }
    }
  } else if (stored.schemaVersion !== regenerated.schemaVersion) {
    drift.push({
      field: "schemaVersion",
      stored: stored.schemaVersion,
      regenerated: regenerated.schemaVersion
    });
  }
  return drift;
}

function capabilitiesWithEffect(
  tools: readonly AgentToolDescriptor[],
  effect: AgentToolDescriptor["effect"]
): readonly string[] {
  return tools
    .filter((tool) => tool.effect === effect)
    .map((tool) => tool.name)
    .sort(compareCanonicalStrings);
}

function providerNamesWithEffect(
  tools: readonly AgentToolDescriptor[],
  effect: AgentToolDescriptor["effect"]
): readonly string[] {
  return sortedUnique(
    tools.filter((tool) => tool.effect === effect).map((tool) => tool.providerName ?? tool.name)
  );
}

/**
 * A fingerprint of the entire Tool Registry (every tool the registry can ever return, across all
 * operation/context/write-policy combinations) — not just the combination this draft uses. This lets
 * run start detect a Tool Registry code change between draft creation and run creation even when the
 * draft's own mode combination happens to expose an unchanged tool set.
 */
function computeToolRegistryRevision(
  listTools: AgentToolLister,
  capabilitySnapshot: AgentToolCapabilitySnapshot,
  externalToolDescriptors: readonly AgentToolDescriptor[] | undefined
): string {
  const operationModes: readonly AgentOperationMode[] = ["planning", "execution"];
  const contextModes: readonly AgentContextMode[] = ["writing", "general_file"];
  const writePolicies: readonly AgentWritePolicy[] = [
    "write_before_confirmation",
    "user_preapproved_run"
  ];
  const byName = new Map<string, AgentToolDescriptor>();
  for (const operationMode of operationModes) {
    for (const contextMode of contextModes) {
      for (const writePolicy of writePolicies) {
        for (const tool of listTools({
          operationMode,
          contextMode,
          writePolicy,
          capabilitySnapshot,
          ...(externalToolDescriptors === undefined ? {} : { externalToolDescriptors })
        })) {
          byName.set(tool.name, tool);
        }
      }
    }
  }
  const allTools = [...byName.values()].sort((left, right) =>
    compareCanonicalStrings(left.name, right.name)
  );
  return checksumText(stableSerialize(allTools));
}

/** Deterministic digest of the complete descriptor directory a run is allowed to invoke. */
export function computeDescriptorRevision(tools: readonly AgentToolDescriptor[]): string {
  return checksumText(
    stableSerialize(
      [...tools]
        .map((tool) => ({
          id: tool.id ?? tool.name,
          name: tool.name,
          providerName: tool.providerName ?? tool.name,
          descriptorDigest: tool.descriptorDigest ?? ""
        }))
        .sort((left, right) => compareCanonicalStrings(left.id, right.id))
    )
  );
}

/** Deterministic digest of the provider-safe map; both IDs and provider names are bound. */
export function computeProviderMappingRevision(tools: readonly AgentToolDescriptor[]): string {
  return checksumText(
    JSON.stringify(
      [...tools]
        .map((tool) => ({
          canonicalId: tool.id ?? tool.name,
          providerName: tool.providerName ?? tool.name
        }))
        .sort((left, right) => compareCanonicalStrings(left.canonicalId, right.canonicalId))
        .map((entry) => [entry.canonicalId, entry.providerName])
    )
  );
}

function checksumText(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function computePermissionSummaryCatalogV2Revision(input: {
  readonly descriptorRevision: string;
  readonly providerMappingRevision: string;
  readonly approvalRuleSetVersion: string;
  readonly approvalRuleSetChecksum: string;
  readonly approvalRules: readonly ProviderVisibleApprovalRule[];
}): string {
  return checksumText(
    JSON.stringify([
      "2.0",
      "v2",
      input.descriptorRevision,
      input.providerMappingRevision,
      input.approvalRuleSetVersion,
      input.approvalRuleSetChecksum,
      input.approvalRules
    ])
  );
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => compareCanonicalStrings(left, right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableSerialize(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function compareCanonicalStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Task 0.2 — Normalize a persisted Permission Summary (v1.0 or v1.1) to the v1.0 read shape.
 * Used by consumers that only need the core capability fields and don't need v1.1 extensions.
 * Returns the value as-is for v1.0; for v1.1 returns a view of the v1.0 fields.
 */
export function normalizePermissionSummaryV10(
  summary: PermissionSummaryV10 | PermissionSummaryV11
): PermissionSummaryV10 {
  if (summary.schemaVersion !== "1.0" && summary.schemaVersion !== "1.1") {
    throw new Error("PERMISSION_SUMMARY_LEGACY_VERSION_INVALID");
  }
  return {
    schemaVersion: "1.0",
    permissionSummaryId: summary.permissionSummaryId,
    projectId: summary.projectId,
    runDraftId: summary.runDraftId,
    ...(summary.runId === undefined ? {} : { runId: summary.runId }),
    contextMode: summary.contextMode,
    writePolicy: summary.writePolicy,
    toolRegistryRevision: summary.toolRegistryRevision,
    rootFingerprint: summary.rootFingerprint,
    readCapabilities: summary.readCapabilities,
    proposalCapabilities: summary.proposalCapabilities,
    forbiddenCapabilities: summary.forbiddenCapabilities,
    checksum: summary.checksum,
    generatedAt: summary.generatedAt
  };
}

/**
 * The authorization fields consumers must use for post-v1.0 tool categories. Legacy records are
 * deliberately read as a deny-all snapshot for those categories; a v1.0 record can never inherit
 * a newly introduced tool merely because a later registry exposes it.
 */
export interface ResolvedPermissionSummaryCapabilities {
  readonly workspaceKind: AgentWorkspaceKind;
  readonly operationMode: AgentOperationMode;
  readonly executeCapabilities: readonly string[];
  readonly externalReadCapabilities: readonly string[];
  readonly externalActionCapabilities: readonly string[];
  readonly dataEgressCapabilities: readonly string[];
  readonly featureFlagRevision: string;
  readonly descriptorRevision: string;
  readonly providerMappingRevision: string;
  readonly writeMutationTrust: AgentWriteMutationTrust;
}

export function resolvePermissionSummaryCapabilities(
  summary: PermissionSummary
): ResolvedPermissionSummaryCapabilities {
  if (isPermissionSummaryV20(summary) || isPermissionSummaryV11(summary)) {
    return {
      workspaceKind: summary.workspaceKind,
      operationMode: summary.operationMode,
      executeCapabilities: summary.executeCapabilities,
      externalReadCapabilities: summary.externalReadCapabilities,
      externalActionCapabilities: summary.externalActionCapabilities,
      dataEgressCapabilities: summary.dataEgressCapabilities,
      featureFlagRevision: summary.featureFlagRevision,
      descriptorRevision: summary.descriptorRevision,
      providerMappingRevision: summary.providerMappingRevision,
      writeMutationTrust: summary.writeMutationTrust ?? "unavailable"
    };
  }
  return {
    workspaceKind: defaultWorkspaceKind(summary.contextMode),
    operationMode: "planning",
    executeCapabilities: [],
    externalReadCapabilities: [],
    externalActionCapabilities: [],
    dataEgressCapabilities: [],
    featureFlagRevision: "legacy-v1.0-deny",
    descriptorRevision: "legacy-v1.0-deny",
    providerMappingRevision: "legacy-v1.0-deny",
    writeMutationTrust: "unavailable"
  };
}

/** Verify the persisted integrity checksums before trusting a summary read from storage. */
export function hasValidPermissionSummaryChecksums(summary: PermissionSummary): boolean {
  if (isPermissionSummaryV20(summary)) {
    try {
      parsePermissionSummaryV20(summary);
      return true;
    } catch {
      return false;
    }
  }
  const expectedCore = checksumText(stableSerialize(coreChecksumFields(summary)));
  if (summary.checksum !== expectedCore) return false;
  if (!isPermissionSummaryV11(summary)) return true;
  const expectedExtended = checksumText(
    stableSerialize({
      checksum: summary.checksum,
      workspaceKind: summary.workspaceKind,
      operationMode: summary.operationMode,
      executeCapabilities: summary.executeCapabilities,
      externalReadCapabilities: summary.externalReadCapabilities,
      externalActionCapabilities: summary.externalActionCapabilities,
      dataEgressCapabilities: summary.dataEgressCapabilities,
      featureFlagRevision: summary.featureFlagRevision,
      descriptorRevision: summary.descriptorRevision,
      providerMappingRevision: summary.providerMappingRevision,
      writeMutationTrust: summary.writeMutationTrust
    })
  );
  return summary.extendedChecksum === expectedExtended;
}

/** Type guard — check if a summary is v1.1. */
export function isPermissionSummaryV11(
  summary: PermissionSummary
): summary is PermissionSummaryV11 {
  return summary.schemaVersion === "1.1";
}

/** Type guard — check if a summary is v2.0. Integrity still requires `parsePermissionSummaryV20`. */
export function isPermissionSummaryV20(
  summary: PermissionSummary
): summary is PermissionSummaryV20 {
  return summary.schemaVersion === "2.0";
}

function coreChecksumFields(
  summary: Pick<
    PermissionSummaryV10,
    | "projectId"
    | "runDraftId"
    | "contextMode"
    | "writePolicy"
    | "toolRegistryRevision"
    | "rootFingerprint"
    | "readCapabilities"
    | "proposalCapabilities"
    | "forbiddenCapabilities"
  >
): Record<string, unknown> {
  return {
    projectId: summary.projectId,
    runDraftId: summary.runDraftId,
    contextMode: summary.contextMode,
    writePolicy: summary.writePolicy,
    toolRegistryRevision: summary.toolRegistryRevision,
    rootFingerprint: summary.rootFingerprint,
    readCapabilities: summary.readCapabilities,
    proposalCapabilities: summary.proposalCapabilities,
    forbiddenCapabilities: summary.forbiddenCapabilities
  };
}

function defaultWorkspaceKind(contextMode: AgentContextMode): AgentWorkspaceKind {
  return contextMode === "writing" ? "creativeProject" : "engineeringWorkspace";
}

function normalizeWriteMutationTrust(value: unknown): AgentWriteMutationTrust {
  return value === "standard_trusted_creative" || value === "hardened_native"
    ? value
    : "unavailable";
}

const SHA256 = /^[a-f0-9]{64}$/u;
const PROVIDER_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u;

function deriveAllowedCapabilities(input: {
  readonly readCapabilities: readonly string[];
  readonly proposalCapabilities: readonly string[];
  readonly executeCapabilities: readonly string[];
  readonly externalReadCapabilities: readonly string[];
  readonly externalActionCapabilities: readonly string[];
  readonly operations: readonly ProviderVisibleWriteOperation[];
  readonly networkRead?: boolean;
  readonly remoteMcp?: boolean;
}): readonly string[] {
  const networkRead =
    input.networkRead ??
    input.externalReadCapabilities.some(
      (providerName) => providerName === "web_search" || providerName === "fetch_url"
    );
  const remoteMcp =
    input.remoteMcp ??
    (input.externalActionCapabilities.length > 0 ||
      input.externalReadCapabilities.some(
        (providerName) => providerName !== "web_search" && providerName !== "fetch_url"
      ));
  return sortedUnique([
    ...(input.readCapabilities.length === 0 ? [] : ["read"]),
    ...(input.proposalCapabilities.length === 0 ? [] : ["write"]),
    ...(input.executeCapabilities.length === 0 ? [] : ["execute"]),
    ...(input.externalReadCapabilities.length === 0 ? [] : ["external_read"]),
    ...(input.externalActionCapabilities.length === 0 ? [] : ["external_action"]),
    ...(networkRead ? ["network"] : []),
    ...(remoteMcp ? ["remote_mcp"] : []),
    ...input.operations.map((operation) => `operation:${operation}`)
  ]);
}

function deriveDataEgressCapabilities(input: {
  readonly externalReadCapabilities: readonly string[];
  readonly externalActionCapabilities: readonly string[];
}): readonly string[] {
  const hasProviderQuery = input.externalReadCapabilities.some(
    (providerName) => providerName === "web_search" || providerName === "fetch_url"
  );
  const hasRemoteToolArguments =
    input.externalActionCapabilities.length > 0 ||
    input.externalReadCapabilities.some(
      (providerName) => providerName !== "web_search" && providerName !== "fetch_url"
    );
  return sortedUnique([
    ...(hasProviderQuery ? ["provider_query"] : []),
    ...(hasRemoteToolArguments ? ["remote_tool_arguments"] : [])
  ]);
}

function parseSortedUniqueStrings(value: unknown): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string" || !isBoundedString(entry))
  ) {
    throw new Error("PERMISSION_SUMMARY_V2_INVALID");
  }
  const canonical = sortedUnique(value as readonly string[]);
  if (stableSerialize(value) !== stableSerialize(canonical)) {
    throw new Error("PERMISSION_SUMMARY_V2_INVALID");
  }
  return canonical;
}

function parseProviderNames(value: unknown): readonly string[] {
  const names = parseSortedUniqueStrings(value);
  if (names.some((name) => !PROVIDER_NAME.test(name))) {
    throw new Error("PERMISSION_SUMMARY_V2_INVALID");
  }
  return names;
}

function parseWritingOperations(value: unknown): readonly ProviderVisibleWritingOperation[] {
  if (!Array.isArray(value) || value.some((entry) => !isProviderVisibleWritingOperation(entry))) {
    throw new Error("PERMISSION_SUMMARY_V2_INVALID");
  }
  const operations = value as readonly ProviderVisibleWritingOperation[];
  const canonical = WRITE_OPERATION_ORDER.filter(
    (operation): operation is ProviderVisibleWritingOperation =>
      isProviderVisibleWritingOperation(operation) && operations.includes(operation)
  );
  if (
    new Set(operations).size !== operations.length ||
    stableSerialize(operations) !== stableSerialize(canonical)
  ) {
    throw new Error("PERMISSION_SUMMARY_V2_INVALID");
  }
  return Object.freeze(canonical);
}

function parseWorkspaceFileOperations(
  value: unknown
): readonly ProviderVisibleWorkspaceFileOperation[] {
  if (
    !Array.isArray(value) ||
    value.some((entry) => !isProviderVisibleWorkspaceFileOperation(entry))
  ) {
    throw new Error("PERMISSION_SUMMARY_V2_INVALID");
  }
  const operations = value as readonly ProviderVisibleWorkspaceFileOperation[];
  const canonical = WRITE_OPERATION_ORDER.filter(
    (operation): operation is ProviderVisibleWorkspaceFileOperation =>
      isProviderVisibleWorkspaceFileOperation(operation) && operations.includes(operation)
  );
  if (
    new Set(operations).size !== operations.length ||
    stableSerialize(operations) !== stableSerialize(canonical)
  ) {
    throw new Error("PERMISSION_SUMMARY_V2_INVALID");
  }
  return Object.freeze(canonical);
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort(compareCanonicalStrings));
}

function hasExactlyFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 4096;
}

function isCanonicalUtcTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
