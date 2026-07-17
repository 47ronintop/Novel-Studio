import { createHash } from "node:crypto";

import type { AgentContextMode, AgentOperationMode, AgentWritePolicy } from "./agent-run-types.js";
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
 */
export interface PermissionSummary {
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
export function generatePermissionSummary(input: GeneratePermissionSummaryInput): PermissionSummary {
  const listTools = input.listTools ?? listAgentTools;
  const writePolicy: AgentWritePolicy =
    input.operationMode === "planning" ? "write_before_confirmation" : input.writePolicy;
  const toolRegistryRevision = computeToolRegistryRevision(listTools);
  const tools = listTools({
    operationMode: input.operationMode,
    contextMode: input.contextMode,
    writePolicy
  });
  const readCapabilities = capabilitiesWithEffect(tools, "read");
  const proposalCapabilities = capabilitiesWithEffect(tools, "propose");
  const forbiddenCapabilities = [...AGENT_FORBIDDEN_CAPABILITIES];

  const checksum = checksumText(
    stableSerialize({
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
  );

  return {
    schemaVersion: "1.0",
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
    generatedAt: input.generatedAt
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
] as const satisfies readonly (keyof PermissionSummary)[];

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
function computeToolRegistryRevision(listTools: AgentToolLister): string {
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
        for (const tool of listTools({ operationMode, contextMode, writePolicy })) {
          byName.set(tool.name, tool);
        }
      }
    }
  }
  const allTools = [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
  return checksumText(stableSerialize(allTools));
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
