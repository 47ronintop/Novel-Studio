import { createHash } from "node:crypto";

import type { JsonObject } from "@novel-studio/shared";
import {
  normalizeAgentContextScope,
  type AgentContextProfileId,
  type AgentContextScope
} from "./agent-context-scope.js";
import {
  validatePackedAgentContextManifest,
  type AgentContextPreferenceScope,
  type AgentContextSelectionPolicy,
  type PackedAgentContextManifest
} from "./packed-agent-context.js";

export type AgentContextSourceKind =
  | "disk_file"
  | "editor_buffer"
  | "story_bible_asset"
  | "project_conventions"
  | "workspace_outline"
  | "compaction_summary"
  | "system_guidance";

/** The context layer a source occupies. Stage 5 uses this for budget accounting and eviction order. */
export type AgentContextLayer =
  | "system"
  | "user_request"
  | "conversation_summary"
  | "plan"
  | "explicit_ref"
  | "editor"
  | "tool_result"
  | "change_set_summary";

export type AgentContextPrecision = "reported" | "estimated" | "unknown";
export type AgentContextSourceState = "active" | "stale" | "excluded";

export type AgentContextInstructionPolicy = "content_is_data_not_authority";
export type AgentContextWorkspaceTrust = "trusted" | "untrusted";

export interface AgentContextTruncationRange {
  readonly unit: "unicode_code_point";
  readonly start: number;
  readonly end: number;
  readonly originalEnd: number;
}

export interface AgentContextSourceIdentity {
  readonly workspaceId: string;
  readonly contextProfileId: Exclude<AgentContextProfileId, "standalone">;
  readonly canonicalRootIdentity: string;
  readonly relativePath?: string;
}

interface AgentContextSourceMaterializationBase {
  readonly schemaVersion: "1.0";
  readonly artifactId: string;
  readonly readerVersion: string;
  readonly sourceIdentity: AgentContextSourceIdentity;
  readonly instructionPolicy: AgentContextInstructionPolicy;
  readonly workspaceTrust: AgentContextWorkspaceTrust;
  readonly tokenCount: number;
  readonly truncationRange: AgentContextTruncationRange | null;
}

export interface ProjectConventionsSourceMaterialization extends AgentContextSourceMaterializationBase {
  readonly kind: "project_conventions";
  readonly originalChecksum: string;
  readonly injectedChecksum: string;
}

export interface WorkspaceOutlineSourceMaterialization extends AgentContextSourceMaterializationBase {
  readonly kind: "workspace_outline";
  readonly dependencyManifest: JsonObject;
  readonly dependencyManifestChecksum: string;
  readonly dependencyRevisionChecksum: string;
  /** Optional v1.0-compatible proof used to attribute aggregate changes to exact source paths. */
  readonly dependencyEntries?: readonly WorkspaceOutlineDependencyEntry[];
  readonly dependencyEntriesChecksum?: string;
  readonly materializedChecksum: string;
  readonly rereadHint: string;
}

export interface WorkspaceOutlineDependencyEntry {
  readonly kind: "directory" | "file" | "chapter" | "story_bible_asset";
  readonly id: string;
  readonly label: string;
  readonly relativePath?: string;
  readonly depth?: number;
  readonly wordCount?: number;
  readonly assetType?: string;
}

export type AgentContextSourceMaterialization =
  ProjectConventionsSourceMaterialization | WorkspaceOutlineSourceMaterialization;

export interface AgentContextEvictionPointer {
  readonly schemaVersion: "1.0";
  readonly artifactId: string;
  readonly dependencyManifestChecksum: string;
  readonly rereadHint: string;
}

export interface AgentContextSourceInput {
  readonly refId: string;
  readonly sourceKind: AgentContextSourceKind;
  readonly relativePath?: string;
  readonly assetId?: string;
  readonly content: string;
  readonly dirty: boolean;
  readonly range?: { readonly start: number; readonly end: number };
  readonly materialization?: AgentContextSourceMaterialization;
  /** Preserved across refresh/hydrate; new sources default to revision zero. */
  readonly sourceRevision?: number;
  readonly selectionReason?: string;
  readonly selectionPolicy?: AgentContextSelectionPolicy;
  readonly priority?: number;
  readonly preferenceScope?: AgentContextPreferenceScope;
}

export interface AgentCurrentContextSource {
  readonly refId: string;
  readonly status?: "available" | "missing";
  readonly content?: string;
  /** Reader-owned identity used when body checksums are not the staleness contract. */
  readonly comparisonChecksum?: string;
  /** Current Main-resolved identity for sources whose provenance includes the canonical root. */
  readonly sourceIdentity?: AgentContextSourceIdentity;
}

/** The persisted v1.0 context source shape. Retained for read compatibility. */
export interface AgentContextSourceV10 {
  readonly refId: string;
  readonly sourceKind: AgentContextSourceKind;
  readonly relativePath?: string;
  readonly assetId?: string;
  readonly checksum: string;
  readonly dirty: boolean;
  readonly capturedAt: string;
  readonly range?: { readonly start: number; readonly end: number };
}

/** The Stage 5 (v1.1) context source: v1.0 plus layer/revision/token/precision/state accounting. */
export interface AgentContextSourceV11 extends AgentContextSourceV10 {
  readonly layer: AgentContextLayer;
  readonly sourceRevision: number;
  readonly tokenCount: number | null;
  readonly precision: AgentContextPrecision;
  readonly state: AgentContextSourceState;
}

export interface AgentContextSourceV12 extends AgentContextSourceV11 {
  readonly artifactId: string | null;
  readonly materializationOrder: number;
}

export interface AgentContextSourceV13 extends AgentContextSourceV12 {
  readonly sourceMaterialization: AgentContextSourceMaterialization | null;
  readonly evictionPointer: AgentContextEvictionPointer | null;
}

export interface AgentContextSourceV14 extends AgentContextSourceV13 {
  readonly selectionReason: string;
  readonly selectionPolicy: AgentContextSelectionPolicy;
  readonly preferenceScope: AgentContextPreferenceScope;
  readonly priority: number;
}

export type AgentContextSource = AgentContextSourceV14;

/** The persisted v1.0 context snapshot shape. Retained for read compatibility. */
export interface AgentContextSnapshotV10 {
  readonly schemaVersion: "1.0";
  readonly contextSnapshotId: string;
  readonly runId: string;
  readonly createdAt: string;
  readonly compactionRevision: number;
  readonly sources: readonly AgentContextSourceV10[];
  readonly excludedSources: readonly string[];
}

/** The Stage 5 (v1.1) context snapshot: v1.0 with per-source budget accounting fields. */
export interface AgentContextSnapshotV11 extends Omit<
  AgentContextSnapshotV10,
  "schemaVersion" | "sources"
> {
  readonly schemaVersion: "1.1";
  readonly sources: readonly AgentContextSourceV11[];
}

export interface AgentContextMaterializationProvenance {
  readonly schemaVersion: "1.0";
  readonly profileVersion: string;
  readonly guidanceTemplateChecksum: string;
  readonly stablePrefixChecksum: string;
  readonly messageOrderVersion: "1.0";
}

export interface AgentContextSnapshotV12 extends Omit<
  AgentContextSnapshotV11,
  "schemaVersion" | "sources"
> {
  readonly schemaVersion: "1.2";
  readonly scope: AgentContextScope;
  readonly contextProfileId: AgentContextProfileId;
  readonly sources: readonly AgentContextSourceV12[];
  readonly materialization: AgentContextMaterializationProvenance;
}

export interface AgentContextSnapshotV13 extends Omit<
  AgentContextSnapshotV12,
  "schemaVersion" | "sources"
> {
  readonly schemaVersion: "1.3";
  readonly sources: readonly AgentContextSourceV13[];
}

export interface AgentContextSnapshotV14 extends Omit<
  AgentContextSnapshotV13,
  "schemaVersion" | "sources"
> {
  readonly schemaVersion: "1.4";
  readonly sources: readonly AgentContextSourceV14[];
  readonly packedContextManifest: PackedAgentContextManifest | null;
}

export type AgentContextSnapshot = AgentContextSnapshotV14;

export interface CreateAgentContextSnapshotInput {
  readonly contextSnapshotId: string;
  readonly runId: string;
  readonly scope: AgentContextScope;
  readonly contextProfileId: AgentContextProfileId;
  readonly materialization: AgentContextMaterializationProvenance;
  readonly createdAt: string;
  readonly sources: readonly AgentContextSourceInput[];
  readonly materializationArtifactId?: string;
  readonly materializationArtifactSourceRefs?: readonly string[];
  readonly excludedSources?: readonly string[];
  readonly compactionRevision?: number;
  readonly packedContextManifest?: PackedAgentContextManifest | null;
}

export function createAgentContextSnapshot(
  input: CreateAgentContextSnapshotInput
): AgentContextSnapshot {
  const snapshot: AgentContextSnapshot = {
    schemaVersion: "1.4",
    contextSnapshotId: input.contextSnapshotId,
    runId: input.runId,
    scope: input.scope,
    contextProfileId: input.contextProfileId,
    materialization: input.materialization,
    createdAt: input.createdAt,
    compactionRevision: input.compactionRevision ?? 0,
    sources: input.sources.map(
      (
        {
          content,
          materialization,
          sourceRevision,
          selectionReason,
          selectionPolicy,
          priority,
          preferenceScope,
          ...source
        },
        materializationOrder
      ) => {
        const resolvedSelectionPolicy =
          selectionPolicy ?? defaultSelectionPolicy(source.sourceKind);
        return {
          ...source,
          checksum: checksumText(content),
          capturedAt: input.createdAt,
          layer: defaultLayerForSource(source.sourceKind),
          sourceRevision: sourceRevision ?? 0,
          tokenCount: materialization?.tokenCount ?? null,
          precision: "unknown" as const,
          state: "active" as const,
          artifactId:
            input.materializationArtifactId !== undefined &&
            (input.materializationArtifactSourceRefs === undefined ||
              input.materializationArtifactSourceRefs.includes(source.refId))
              ? input.materializationArtifactId
              : null,
          materializationOrder,
          sourceMaterialization: materialization ?? null,
          evictionPointer: null,
          selectionReason: selectionReason ?? defaultSelectionReason(source.sourceKind),
          selectionPolicy: resolvedSelectionPolicy,
          preferenceScope:
            preferenceScope ?? defaultPreferenceScope(resolvedSelectionPolicy, source.sourceKind),
          priority: priority ?? defaultSourcePriority(source.sourceKind)
        };
      }
    ),
    excludedSources: input.excludedSources ?? [],
    packedContextManifest: input.packedContextManifest ?? null
  };
  if (!validateAgentContextSnapshot(snapshot as unknown as JsonObject)) {
    throw new Error("AGENT_CONTEXT_SNAPSHOT_INVALID");
  }
  return snapshot;
}

/**
 * Normalize a persisted context snapshot (v1.0 or v1.1) into the v1.1 view. v1.0 sources are
 * backfilled with `layer = "tool_result"`, `tokenCount = null`, `precision = "unknown"`,
 * `state = "active"`, `sourceRevision = 0`. Never rewrites disk files.
 */
export function normalizeAgentContextSnapshot(
  value: JsonObject,
  fallback?: {
    readonly scope: AgentContextScope;
    readonly contextProfileId: AgentContextProfileId;
    readonly profileVersion?: string;
    readonly guidanceTemplateChecksum?: string;
    readonly stablePrefixChecksum?: string;
  }
): AgentContextSnapshotV14 {
  if (value["schemaVersion"] === "1.4") {
    const normalized = {
      ...value,
      sources: Array.isArray(value["sources"])
        ? value["sources"].map((source) =>
            isRecord(source) && source["preferenceScope"] === undefined
              ? { ...source, preferenceScope: "automatic" }
              : source
          )
        : value["sources"]
    } as JsonObject;
    if (!validateAgentContextSnapshot(normalized)) {
      throw new Error("AGENT_CONTEXT_SNAPSHOT_INVALID");
    }
    return {
      ...normalized,
      scope: normalizeAgentContextScope(normalized["scope"])
    } as unknown as AgentContextSnapshotV14;
  }
  if (
    value["schemaVersion"] !== "1.0" &&
    value["schemaVersion"] !== "1.1" &&
    value["schemaVersion"] !== "1.2" &&
    value["schemaVersion"] !== "1.3"
  ) {
    throw new Error("AGENT_CONTEXT_SNAPSHOT_VERSION_UNSUPPORTED");
  }
  if (fallback === undefined) throw new Error("AGENT_CONTEXT_SNAPSHOT_SCOPE_REQUIRED");
  const rawSources = Array.isArray(value["sources"]) ? value["sources"] : [];
  const sources = rawSources.map((source, materializationOrder) => {
    const record = source as JsonObject;
    const sourceKind = isSourceKind(record["sourceKind"]) ? record["sourceKind"] : "disk_file";
    return {
      ...record,
      ...(value["schemaVersion"] === "1.0"
        ? {
            layer: "tool_result" as const,
            sourceRevision: 0,
            tokenCount: null,
            precision: "unknown" as const,
            state: "active" as const
          }
        : {}),
      artifactId:
        value["schemaVersion"] === "1.2" || value["schemaVersion"] === "1.3"
          ? (record["artifactId"] ?? null)
          : null,
      materializationOrder:
        value["schemaVersion"] === "1.3"
          ? (record["materializationOrder"] ?? materializationOrder)
          : materializationOrder,
      sourceMaterialization:
        value["schemaVersion"] === "1.3" ? (record["sourceMaterialization"] ?? null) : null,
      evictionPointer:
        value["schemaVersion"] === "1.3" ? (record["evictionPointer"] ?? null) : null,
      selectionReason: defaultSelectionReason(sourceKind),
      selectionPolicy: defaultSelectionPolicy(sourceKind),
      preferenceScope: "automatic" as const,
      priority: defaultSourcePriority(sourceKind)
    };
  });
  return {
    ...value,
    schemaVersion: "1.4",
    scope: fallback.scope,
    contextProfileId: fallback.contextProfileId,
    materialization: {
      schemaVersion: "1.0",
      profileVersion: fallback.profileVersion ?? "legacy",
      guidanceTemplateChecksum: fallback.guidanceTemplateChecksum ?? "legacy",
      stablePrefixChecksum: fallback.stablePrefixChecksum ?? "legacy",
      messageOrderVersion: "1.0"
    },
    sources,
    packedContextManifest: null
  } as unknown as AgentContextSnapshotV14;
}

export function validateAgentContextSnapshot(value: JsonObject): boolean {
  if (value["schemaVersion"] !== "1.4") return false;
  if (
    typeof value["contextSnapshotId"] !== "string" ||
    typeof value["runId"] !== "string" ||
    typeof value["createdAt"] !== "string" ||
    !isNonNegativeInteger(value["compactionRevision"]) ||
    !Array.isArray(value["sources"]) ||
    !Array.isArray(value["excludedSources"]) ||
    !value["excludedSources"].every((sourceId) => typeof sourceId === "string") ||
    !isContextProfileId(value["contextProfileId"]) ||
    !isMaterializationProvenance(value["materialization"]) ||
    (value["packedContextManifest"] !== null &&
      !isPackedContextManifest(value["packedContextManifest"]))
  ) {
    return false;
  }
  const contextProfileId = value["contextProfileId"] as AgentContextProfileId;
  let scope: AgentContextScope;
  try {
    scope = normalizeAgentContextScope(value["scope"]);
  } catch {
    return false;
  }
  return value["sources"].every(
    (source) =>
      isAgentContextSourceV14(source) &&
      sourceMatchesSnapshotIdentity(source, scope, contextProfileId)
  );
}

function sourceMatchesSnapshotIdentity(
  source: AgentContextSourceV14,
  scope: AgentContextScope,
  contextProfileId: AgentContextProfileId
): boolean {
  const materialization = source.sourceMaterialization;
  if (materialization === null) return true;
  if (
    scope.kind !== "workspace" ||
    contextProfileId === "standalone" ||
    materialization.sourceIdentity.workspaceId !== scope.workspaceId ||
    materialization.sourceIdentity.contextProfileId !== contextProfileId
  ) {
    return false;
  }
  return contextProfileId === "engineering"
    ? scope.workspaceKind === "engineeringWorkspace"
    : scope.workspaceKind === "creativeProject";
}

function isAgentContextSourceV14(value: unknown): value is AgentContextSourceV14 {
  if (!isRecord(value)) return false;
  const sourceKind = value["sourceKind"];
  const materialization = value["sourceMaterialization"];
  const evictionPointer = value["evictionPointer"];
  const baseValid =
    typeof value["refId"] === "string" &&
    isSourceKind(sourceKind) &&
    isChecksum(value["checksum"]) &&
    typeof value["dirty"] === "boolean" &&
    typeof value["capturedAt"] === "string" &&
    isLayer(value["layer"]) &&
    isNonNegativeInteger(value["sourceRevision"]) &&
    (value["tokenCount"] === null || isNonNegativeInteger(value["tokenCount"])) &&
    (value["precision"] === "reported" ||
      value["precision"] === "estimated" ||
      value["precision"] === "unknown") &&
    (value["state"] === "active" || value["state"] === "stale" || value["state"] === "excluded") &&
    (value["artifactId"] === null || typeof value["artifactId"] === "string") &&
    isNonNegativeInteger(value["materializationOrder"]) &&
    (value["relativePath"] === undefined || typeof value["relativePath"] === "string") &&
    (value["assetId"] === undefined || typeof value["assetId"] === "string") &&
    (value["range"] === undefined || isSourceRange(value["range"])) &&
    (materialization === null || validateAgentContextSourceMaterialization(materialization)) &&
    (evictionPointer === null || isEvictionPointer(evictionPointer));
  if (
    !baseValid ||
    typeof value["selectionReason"] !== "string" ||
    value["selectionReason"].length === 0 ||
    (value["selectionPolicy"] !== "automatic" &&
      value["selectionPolicy"] !== "explicit" &&
      value["selectionPolicy"] !== "pinned") ||
    (value["preferenceScope"] !== "automatic" &&
      value["preferenceScope"] !== "run" &&
      value["preferenceScope"] !== "project") ||
    !isPriority(value["priority"]) ||
    !isSourceMaterializationBindingValid(sourceKind, materialization, value)
  ) {
    return false;
  }
  if (evictionPointer === null) return true;
  if (!isEvictionPointer(evictionPointer)) return false;
  return (
    sourceKind === "workspace_outline" &&
    value["state"] === "excluded" &&
    materialization?.kind === "workspace_outline" &&
    evictionPointer.artifactId === materialization.artifactId &&
    evictionPointer.dependencyManifestChecksum === materialization.dependencyManifestChecksum &&
    evictionPointer.rereadHint === materialization.rereadHint
  );
}

function defaultSelectionReason(sourceKind: AgentContextSourceKind): string {
  if (sourceKind === "system_guidance") return "System-authored guidance";
  if (sourceKind === "project_conventions" || sourceKind === "workspace_outline") {
    return "Automatically selected project context";
  }
  return "Explicit context reference";
}

function defaultSelectionPolicy(sourceKind: AgentContextSourceKind): AgentContextSelectionPolicy {
  return sourceKind === "project_conventions" ||
    sourceKind === "workspace_outline" ||
    sourceKind === "system_guidance"
    ? "automatic"
    : "explicit";
}

function defaultPreferenceScope(
  selectionPolicy: AgentContextSelectionPolicy,
  sourceKind: AgentContextSourceKind
): AgentContextPreferenceScope {
  return selectionPolicy === "automatic" &&
    (sourceKind === "project_conventions" ||
      sourceKind === "workspace_outline" ||
      sourceKind === "system_guidance")
    ? "automatic"
    : "run";
}

function defaultSourcePriority(sourceKind: AgentContextSourceKind): number {
  if (sourceKind === "system_guidance") return 100;
  if (sourceKind === "editor_buffer") return 90;
  if (sourceKind === "project_conventions") return 80;
  if (sourceKind === "workspace_outline") return 60;
  return 70;
}

function isPriority(value: unknown): value is number {
  return isNonNegativeInteger(value) && value <= 100;
}

function isPackedContextManifest(value: unknown): value is PackedAgentContextManifest {
  return validatePackedAgentContextManifest(value);
}

export function validateAgentContextSourceMaterialization(
  value: unknown
): value is AgentContextSourceMaterialization {
  if (!isRecord(value) || !isMaterializationBase(value)) return false;
  if (value["kind"] === "project_conventions") {
    const identity = value["sourceIdentity"];
    const expectedPath =
      identity["contextProfileId"] === "engineering" ? "AGENTS.md" : "conventions/writing.md";
    return (
      identity["relativePath"] === expectedPath &&
      value["workspaceTrust"] === "trusted" &&
      isChecksum(value["originalChecksum"]) &&
      isChecksum(value["injectedChecksum"])
    );
  }
  return (
    value["kind"] === "workspace_outline" &&
    isWorkspaceOutlineDependencyManifest(value["dependencyManifest"]) &&
    workspaceOutlineManifestMatchesSourceIdentity(
      value["dependencyManifest"],
      value["sourceIdentity"]
    ) &&
    value["dependencyManifest"]["readerVersion"] === value["readerVersion"] &&
    isChecksum(value["dependencyManifestChecksum"]) &&
    isChecksum(value["dependencyRevisionChecksum"]) &&
    isWorkspaceOutlineDependencyEntriesProof(
      value["dependencyEntries"],
      value["dependencyEntriesChecksum"]
    ) &&
    isChecksum(value["materializedChecksum"]) &&
    isNonEmptyString(value["rereadHint"])
  );
}

function isWorkspaceOutlineDependencyEntriesProof(
  entries: unknown,
  proofChecksum: unknown
): boolean {
  if (entries === undefined && proofChecksum === undefined) return true;
  return (
    Array.isArray(entries) &&
    entries.every(isWorkspaceOutlineDependencyEntry) &&
    isChecksum(proofChecksum)
  );
}

function isWorkspaceOutlineDependencyEntry(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    (value["kind"] === "directory" ||
      value["kind"] === "file" ||
      value["kind"] === "chapter" ||
      value["kind"] === "story_bible_asset") &&
    isNonEmptyString(value["id"]) &&
    isNonEmptyString(value["label"]) &&
    (value["relativePath"] === undefined || isNonEmptyString(value["relativePath"])) &&
    (value["depth"] === undefined || isNonNegativeInteger(value["depth"])) &&
    (value["wordCount"] === undefined || isNonNegativeInteger(value["wordCount"])) &&
    (value["assetType"] === undefined || isNonEmptyString(value["assetType"]))
  );
}

function isSourceMaterializationBindingValid(
  sourceKind: AgentContextSourceKind,
  materialization: AgentContextSourceMaterialization | null,
  source: JsonObject
): boolean {
  if (sourceKind === "project_conventions") {
    return (
      materialization?.kind === "project_conventions" &&
      source["checksum"] === materialization.injectedChecksum &&
      source["tokenCount"] === materialization.tokenCount &&
      source["relativePath"] === materialization.sourceIdentity.relativePath
    );
  }
  if (sourceKind === "workspace_outline") {
    return (
      materialization?.kind === "workspace_outline" &&
      source["checksum"] === materialization.materializedChecksum &&
      source["tokenCount"] === materialization.tokenCount &&
      source["relativePath"] === undefined
    );
  }
  return materialization === null;
}

function isMaterializationBase(
  value: JsonObject
): value is JsonObject & { readonly sourceIdentity: AgentContextSourceIdentity } {
  return (
    value["schemaVersion"] === "1.0" &&
    isNonEmptyString(value["artifactId"]) &&
    isNonEmptyString(value["readerVersion"]) &&
    isSourceIdentity(value["sourceIdentity"]) &&
    value["instructionPolicy"] === "content_is_data_not_authority" &&
    (value["workspaceTrust"] === "trusted" || value["workspaceTrust"] === "untrusted") &&
    isNonNegativeInteger(value["tokenCount"]) &&
    (value["truncationRange"] === null || isTruncationRange(value["truncationRange"]))
  );
}

function isTruncationRange(value: unknown): boolean {
  return (
    isRecord(value) &&
    value["unit"] === "unicode_code_point" &&
    isNonNegativeInteger(value["start"]) &&
    isNonNegativeInteger(value["end"]) &&
    isNonNegativeInteger(value["originalEnd"]) &&
    value["start"] === 0 &&
    value["start"] <= value["end"] &&
    value["end"] < value["originalEnd"]
  );
}

function isWorkspaceOutlineDependencyManifest(value: unknown): value is JsonObject {
  if (
    !isRecord(value) ||
    value["schemaVersion"] !== "1.0" ||
    !isNonEmptyString(value["readerVersion"]) ||
    !isWorkspaceProfileId(value["profileId"]) ||
    !isWorkspaceOutlineIdentity(value["workspace"]) ||
    !isWorkspaceOutlineLimits(value["limits"]) ||
    typeof value["truncated"] !== "boolean" ||
    !isWorkspaceOutlineTruncationReasons(value["truncationReasons"]) ||
    !isRecord(value["dependency"])
  ) {
    return false;
  }
  const dependency = value["dependency"];
  if (value["profileId"] === "engineering") {
    return (
      value["workspace"]["workspaceKind"] === "engineeringWorkspace" &&
      dependency["kind"] === "engineering_entries" &&
      isNonEmptyString(dependency["entrySetRevision"]) &&
      isChecksum(dependency["entrySetChecksum"])
    );
  }
  if (value["workspace"]["workspaceKind"] !== "creativeProject") return false;
  if (value["profileId"] === "creative_general") {
    return (
      dependency["kind"] === "creative_file_tree" &&
      isNonEmptyString(dependency["treeRevision"]) &&
      isNonEmptyString(dependency["policyVersion"]) &&
      isChecksum(dependency["visibleNodeChecksum"])
    );
  }
  return (
    dependency["kind"] === "writing_indexes" &&
    isNonEmptyString(dependency["chapterIndexRevision"]) &&
    isChecksum(dependency["chapterIndexChecksum"]) &&
    isNullableRevision(dependency["storyBibleIndexRevision"]) &&
    isNullableChecksum(dependency["storyBibleIndexChecksum"]) &&
    (dependency["storyBibleIndexRevision"] === null) ===
      (dependency["storyBibleIndexChecksum"] === null) &&
    Array.isArray(dependency["degradedDependencies"]) &&
    dependency["degradedDependencies"].every(
      (item) => item === "chapters" || item === "story_bible"
    )
  );
}

function isWorkspaceOutlineIdentity(value: unknown): value is JsonObject {
  return (
    isRecord(value) &&
    (value["workspaceKind"] === "creativeProject" ||
      value["workspaceKind"] === "engineeringWorkspace") &&
    isNonEmptyString(value["workspaceId"]) &&
    isChecksum(value["canonicalRootIdentity"])
  );
}

function isWorkspaceOutlineLimits(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonNegativeInteger(value["maxDepth"]) &&
    isNonNegativeInteger(value["maxEntries"]) &&
    isNonNegativeInteger(value["maxScannedEntries"]) &&
    isNonNegativeInteger(value["maxBytes"]) &&
    isNonNegativeInteger(value["maxDurationMs"]) &&
    isNonNegativeInteger(value["maxTokens"])
  );
}

function isWorkspaceOutlineTruncationReasons(value: unknown): boolean {
  const allowed = new Set([
    "max_depth",
    "max_entries",
    "max_scanned_entries",
    "max_bytes",
    "max_duration",
    "max_tokens",
    "source_truncated"
  ]);
  return Array.isArray(value) && value.every((reason) => allowed.has(String(reason)));
}

function workspaceOutlineManifestMatchesSourceIdentity(
  manifest: JsonObject,
  identity: AgentContextSourceIdentity
): boolean {
  const workspace = manifest["workspace"];
  return (
    isRecord(workspace) &&
    manifest["profileId"] === identity.contextProfileId &&
    workspace["workspaceId"] === identity.workspaceId &&
    workspace["canonicalRootIdentity"] === identity.canonicalRootIdentity &&
    identity.relativePath === undefined
  );
}

function isWorkspaceProfileId(value: unknown): boolean {
  return value === "writing" || value === "creative_general" || value === "engineering";
}

function isNullableRevision(value: unknown): boolean {
  return value === null || isNonEmptyString(value);
}

function isNullableChecksum(value: unknown): boolean {
  return value === null || isChecksum(value);
}

function isEvictionPointer(value: unknown): value is AgentContextEvictionPointer {
  return (
    isRecord(value) &&
    value["schemaVersion"] === "1.0" &&
    typeof value["artifactId"] === "string" &&
    isChecksum(value["dependencyManifestChecksum"]) &&
    typeof value["rereadHint"] === "string"
  );
}

function isSourceKind(value: unknown): value is AgentContextSourceKind {
  return (
    value === "disk_file" ||
    value === "editor_buffer" ||
    value === "story_bible_asset" ||
    value === "project_conventions" ||
    value === "workspace_outline" ||
    value === "compaction_summary" ||
    value === "system_guidance"
  );
}

function isLayer(value: unknown): value is AgentContextLayer {
  return (
    value === "system" ||
    value === "user_request" ||
    value === "conversation_summary" ||
    value === "plan" ||
    value === "explicit_ref" ||
    value === "editor" ||
    value === "tool_result" ||
    value === "change_set_summary"
  );
}

function isChecksum(value: unknown): boolean {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

function isSourceIdentity(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonEmptyString(value["workspaceId"]) &&
    (value["contextProfileId"] === "writing" ||
      value["contextProfileId"] === "creative_general" ||
      value["contextProfileId"] === "engineering") &&
    isChecksum(value["canonicalRootIdentity"]) &&
    (value["relativePath"] === undefined || typeof value["relativePath"] === "string")
  );
}

function isMaterializationProvenance(value: unknown): boolean {
  return (
    isRecord(value) &&
    value["schemaVersion"] === "1.0" &&
    isNonEmptyString(value["profileVersion"]) &&
    isNonEmptyString(value["guidanceTemplateChecksum"]) &&
    isNonEmptyString(value["stablePrefixChecksum"]) &&
    value["messageOrderVersion"] === "1.0"
  );
}

function isSourceRange(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonNegativeInteger(value["start"]) &&
    isNonNegativeInteger(value["end"]) &&
    value["start"] <= value["end"]
  );
}

function isContextProfileId(value: unknown): boolean {
  return (
    value === "standalone" ||
    value === "writing" ||
    value === "creative_general" ||
    value === "engineering"
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defaultLayerForSource(kind: AgentContextSourceKind): AgentContextLayer {
  switch (kind) {
    case "editor_buffer":
      return "editor";
    case "story_bible_asset":
      return "explicit_ref";
    case "project_conventions":
      return "explicit_ref";
    case "workspace_outline":
      return "tool_result";
    case "compaction_summary":
      return "conversation_summary";
    case "system_guidance":
      return "system";
    default:
      return "tool_result";
  }
}

export function findStaleContextSources(
  snapshot: AgentContextSnapshot,
  currentSources: readonly AgentCurrentContextSource[]
): string[] {
  const currentByRef = new Map(currentSources.map((source) => [source.refId, source]));
  return snapshot.sources
    .filter(
      // System-authored guidance (mode-specific prompt + style pack) is fixed for the run and never
      // read back from a file or editor buffer, so it can never go stale and must not be compared
      // against the current-source reader (which does not surface it). Excluded sources are retained
      // only as audit/pointer records and are likewise absent from the live reader set.
      (source) =>
        source.layer !== "system" &&
        source.state !== "excluded" &&
        !currentSourceMatches(source, currentByRef.get(source.refId))
    )
    .map((source) => source.refId);
}

function currentSourceMatches(
  source: AgentContextSource,
  current: AgentCurrentContextSource | undefined
): boolean {
  if (current === undefined || current.status === "missing") return false;
  const currentChecksum =
    current.comparisonChecksum ??
    (current.content === undefined ? undefined : checksumText(current.content));
  const materialization = source.sourceMaterialization;
  if (materialization?.kind === "project_conventions") {
    return (
      currentChecksum === materialization.originalChecksum &&
      current.sourceIdentity !== undefined &&
      sameSourceIdentity(current.sourceIdentity, materialization.sourceIdentity)
    );
  }
  if (materialization?.kind === "workspace_outline") {
    return currentChecksum === materialization.dependencyRevisionChecksum;
  }
  return currentChecksum === source.checksum;
}

function sameSourceIdentity(
  left: AgentContextSourceIdentity,
  right: AgentContextSourceIdentity
): boolean {
  return (
    left.workspaceId === right.workspaceId &&
    left.contextProfileId === right.contextProfileId &&
    left.canonicalRootIdentity === right.canonicalRootIdentity &&
    left.relativePath === right.relativePath
  );
}

function checksumText(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
