import { createHash } from "node:crypto";

import type { AgentContextMode, AgentOperationMode, AgentWritePolicy } from "./agent-run-types.js";
import {
  createDefaultCapabilitySnapshot,
  freezeAgentToolCapabilitySnapshot,
  type AgentToolCapabilitySnapshot,
  type AgentWorkspaceKind
} from "./agent-tool-capabilities.js";
import {
  listAgentTools,
  type AgentToolDescriptor,
  type ListAgentToolsInput
} from "./tool-registry.js";

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
  /** SHA-256 of the extended fields (all authorization facts in this v1.1 record). */
  readonly extendedChecksum: string;
}

/** Active summary type — v1.1 is preferred; v1.0 is kept for read compat. */
export type PermissionSummary = PermissionSummaryV10 | PermissionSummaryV11;

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
  ].sort((left, right) => left.localeCompare(right));
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
      providerMappingRevision
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
    extendedChecksum
  };
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
  "extendedChecksum"
] as const satisfies readonly (keyof PermissionSummaryV11)[];

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
  if (isPermissionSummaryV11(stored) && isPermissionSummaryV11(regenerated)) {
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
    .sort((left, right) => left.localeCompare(right));
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
  const allTools = [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
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
        .sort((left, right) => left.id.localeCompare(right.id))
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
        .sort((left, right) => left.canonicalId.localeCompare(right.canonicalId))
        .map((entry) => [entry.canonicalId, entry.providerName])
    )
  );
}

function checksumText(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
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

/**
 * Task 0.2 — Normalize a persisted Permission Summary (v1.0 or v1.1) to the v1.0 read shape.
 * Used by consumers that only need the core capability fields and don't need v1.1 extensions.
 * Returns the value as-is for v1.0; for v1.1 returns a view of the v1.0 fields.
 */
export function normalizePermissionSummaryV10(summary: PermissionSummary): PermissionSummaryV10 {
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
}

export function resolvePermissionSummaryCapabilities(
  summary: PermissionSummary
): ResolvedPermissionSummaryCapabilities {
  if (isPermissionSummaryV11(summary)) {
    return {
      workspaceKind: summary.workspaceKind,
      operationMode: summary.operationMode,
      executeCapabilities: summary.executeCapabilities,
      externalReadCapabilities: summary.externalReadCapabilities,
      externalActionCapabilities: summary.externalActionCapabilities,
      dataEgressCapabilities: summary.dataEgressCapabilities,
      featureFlagRevision: summary.featureFlagRevision,
      descriptorRevision: summary.descriptorRevision,
      providerMappingRevision: summary.providerMappingRevision
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
    providerMappingRevision: "legacy-v1.0-deny"
  };
}

/** Verify the persisted integrity checksums before trusting a summary read from storage. */
export function hasValidPermissionSummaryChecksums(summary: PermissionSummary): boolean {
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
      providerMappingRevision: summary.providerMappingRevision
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
