import { createHash } from "node:crypto";

import {
  validateAgentContextSourceMaterialization,
  type AgentContextSourceIdentity,
  type AgentContextProfileId,
  type AgentContextSourceInput,
  type AgentContextSourceMaterialization,
  type AgentContextWorkspaceTrust,
  type AgentTokenEstimator
} from "@novel-studio/agent-engine";
import { err, ok, type JsonObject, type Result, type UnifiedError } from "@novel-studio/shared";

export const PROJECT_CONVENTIONS_READER_VERSION = "1.0" as const;
export const WORKSPACE_OUTLINE_READER_VERSION = "1.0" as const;
export const CONTEXT_SOURCE_MATERIALIZATION_ARTIFACT_VERSION = "1.0" as const;

export const DEFAULT_PROJECT_CONVENTIONS_TOKEN_LIMIT = 4_000;
export const DEFAULT_WORKSPACE_OUTLINE_LIMITS: WorkspaceOutlineLimits = Object.freeze({
  maxDepth: 2,
  maxEntries: 200,
  maxScannedEntries: 1_000,
  maxBytes: 64 * 1_024,
  maxDurationMs: 200,
  maxTokens: 1_500
});

export type WorkspaceProjectContextProfileId = Exclude<AgentContextProfileId, "standalone">;

export interface WorkspaceProjectContextIdentity {
  readonly workspaceKind: "creativeProject" | "engineeringWorkspace";
  readonly workspaceId: string;
  /** Opaque hash of Main's canonical root. The root itself never crosses this port. */
  readonly canonicalRootIdentity: string;
}

export interface ProjectConventionsReadInput {
  readonly workspace: WorkspaceProjectContextIdentity;
  readonly profileId: WorkspaceProjectContextProfileId;
  readonly workspaceTrust: AgentContextWorkspaceTrust;
  readonly enabled: boolean;
  readonly maxTokens: number;
  readonly modelProfileId: string;
}

export type ProjectConventionsReadResult =
  | { readonly status: "missing" | "disabled" | "untrusted" }
  | {
      readonly status: "available";
      readonly source: AgentContextSourceInput;
      readonly artifact: AgentContextSourceMaterializationArtifact;
    };

/** Main-owned reader. The fixed path is selected from the server-resolved profile. */
export interface ProjectConventionsReader {
  read(
    input: ProjectConventionsReadInput
  ): Promise<Result<ProjectConventionsReadResult, UnifiedError>>;
}

export interface WorkspaceOutlineLimits {
  readonly maxDepth: number;
  readonly maxEntries: number;
  readonly maxScannedEntries: number;
  readonly maxBytes: number;
  readonly maxDurationMs: number;
  readonly maxTokens: number;
}

export type WorkspaceOutlineTruncationReason =
  | "max_depth"
  | "max_entries"
  | "max_scanned_entries"
  | "max_bytes"
  | "max_duration"
  | "max_tokens"
  | "source_truncated";

export interface WorkspaceOutlineEntry {
  readonly kind: "directory" | "file" | "chapter" | "story_bible_asset";
  readonly id: string;
  readonly label: string;
  readonly relativePath?: string;
  readonly depth?: number;
  readonly wordCount?: number;
  readonly assetType?: string;
}

export type WorkspaceOutlineDependency =
  | {
      readonly kind: "engineering_entries";
      readonly entrySetRevision: string;
      readonly entrySetChecksum: string;
    }
  | {
      readonly kind: "creative_file_tree";
      readonly treeRevision: string;
      readonly policyVersion: string;
      readonly visibleNodeChecksum: string;
    }
  | {
      readonly kind: "writing_indexes";
      readonly chapterIndexRevision: string;
      readonly chapterIndexChecksum: string;
      readonly storyBibleIndexRevision: string | null;
      readonly storyBibleIndexChecksum: string | null;
      readonly degradedDependencies: readonly ("chapters" | "story_bible")[];
    };

export interface WorkspaceOutlineDependencyManifest {
  readonly schemaVersion: "1.0";
  readonly readerVersion: typeof WORKSPACE_OUTLINE_READER_VERSION;
  readonly profileId: WorkspaceProjectContextProfileId;
  readonly workspace: WorkspaceProjectContextIdentity;
  readonly limits: WorkspaceOutlineLimits;
  readonly truncated: boolean;
  readonly truncationReasons: readonly WorkspaceOutlineTruncationReason[];
  readonly dependency: WorkspaceOutlineDependency;
}

export interface WorkspaceOutlineReadInput {
  readonly workspace: WorkspaceProjectContextIdentity;
  readonly profileId: WorkspaceProjectContextProfileId;
  readonly limits: WorkspaceOutlineLimits;
  readonly modelProfileId: string;
}

export interface WorkspaceOutlineReadResult {
  readonly entries: readonly WorkspaceOutlineEntry[];
  readonly text: string;
  readonly dependencyManifest: WorkspaceOutlineDependencyManifest;
  readonly dependencyManifestChecksum: string;
  readonly materializedChecksum: string;
  readonly tokenCount: number;
  readonly truncationRange: {
    readonly unit: "unicode_code_point";
    readonly start: number;
    readonly end: number;
    readonly originalEnd: number;
  } | null;
}

/**
 * Read-only application port. Implementations close over guarded repositories/snapshots; callers can
 * provide only the Main-resolved workspace identity, profile, tokenizer identity, and hard limits.
 */
export interface WorkspaceOutlineReader {
  read(input: WorkspaceOutlineReadInput): Promise<Result<WorkspaceOutlineReadResult, UnifiedError>>;
  readDependencyManifest(
    input: Omit<WorkspaceOutlineReadInput, "modelProfileId">
  ): Promise<Result<WorkspaceOutlineDependencyManifest, UnifiedError>>;
}

export interface WorkspaceProjectContextResolveInput {
  readonly workspace: WorkspaceProjectContextIdentity;
  readonly profileId: WorkspaceProjectContextProfileId;
  readonly workspaceTrust: AgentContextWorkspaceTrust;
  readonly conventionsEnabled: boolean;
  readonly modelProfileId: string;
  readonly conventionsTokenLimit?: number;
  readonly outlineLimits?: WorkspaceOutlineLimits;
}

export interface WorkspaceProjectContextResolution {
  /** Stable project_context_prefix order: conventions first, outline second. */
  readonly sources: readonly AgentContextSourceInput[];
  readonly artifacts: readonly AgentContextSourceMaterializationArtifact[];
}

export interface WorkspaceProjectContextResolver {
  resolve(
    input: WorkspaceProjectContextResolveInput
  ): Promise<Result<WorkspaceProjectContextResolution, UnifiedError>>;
}

export function createWorkspaceProjectContextResolver(input: {
  readonly conventions: ProjectConventionsReader;
  readonly outline: WorkspaceOutlineReader;
}): WorkspaceProjectContextResolver {
  return {
    async resolve(resolveInput) {
      const conventions = await input.conventions.read({
        workspace: resolveInput.workspace,
        profileId: resolveInput.profileId,
        workspaceTrust: resolveInput.workspaceTrust,
        enabled: resolveInput.conventionsEnabled,
        maxTokens: resolveInput.conventionsTokenLimit ?? DEFAULT_PROJECT_CONVENTIONS_TOKEN_LIMIT,
        modelProfileId: resolveInput.modelProfileId
      });
      if (!conventions.ok) return err(conventions.error);

      const outline = await input.outline.read({
        workspace: resolveInput.workspace,
        profileId: resolveInput.profileId,
        limits: resolveInput.outlineLimits ?? DEFAULT_WORKSPACE_OUTLINE_LIMITS,
        modelProfileId: resolveInput.modelProfileId
      });
      if (!outline.ok) return err(outline.error);
      const outlineSource = createWorkspaceOutlineSource({
        workspaceTrust: resolveInput.workspaceTrust,
        result: outline.value
      });
      const conventionSources =
        conventions.value.status === "available" ? [conventions.value.source] : [];
      const conventionArtifacts =
        conventions.value.status === "available" ? [conventions.value.artifact] : [];
      return ok({
        sources: Object.freeze([...conventionSources, outlineSource.source]),
        artifacts: Object.freeze([...conventionArtifacts, outlineSource.artifact])
      });
    }
  };
}

export function createWorkspaceOutlineSource(input: {
  readonly workspaceTrust: AgentContextWorkspaceTrust;
  readonly result: WorkspaceOutlineReadResult;
}): {
  readonly source: AgentContextSourceInput;
  readonly artifact: AgentContextSourceMaterializationArtifact;
} {
  const manifest = input.result.dependencyManifest;
  const sourceIdentity: AgentContextSourceIdentity = {
    workspaceId: manifest.workspace.workspaceId,
    contextProfileId: manifest.profileId,
    canonicalRootIdentity: manifest.workspace.canonicalRootIdentity
  };
  const dependencyRevisionChecksum = workspaceOutlineDependencyRevisionChecksum(manifest);
  const artifactId = contextSourceMaterializationArtifactId("workspace_outline", {
    readerVersion: manifest.readerVersion,
    sourceIdentity,
    dependencyManifestChecksum: input.result.dependencyManifestChecksum,
    dependencyRevisionChecksum,
    materializedChecksum: input.result.materializedChecksum,
    tokenCount: input.result.tokenCount,
    truncationRange: input.result.truncationRange
  });
  const source: AgentContextSourceInput = {
    refId: `workspace_outline_${checksum(
      stableSerialize({ readerVersion: manifest.readerVersion, sourceIdentity })
    ).slice(0, 32)}`,
    sourceKind: "workspace_outline",
    content: input.result.text,
    dirty: false,
    materialization: {
      schemaVersion: "1.0",
      kind: "workspace_outline",
      artifactId,
      readerVersion: manifest.readerVersion,
      sourceIdentity,
      instructionPolicy: "content_is_data_not_authority",
      workspaceTrust: input.workspaceTrust,
      tokenCount: input.result.tokenCount,
      truncationRange: input.result.truncationRange,
      dependencyManifest: manifest as unknown as JsonObject,
      dependencyManifestChecksum: input.result.dependencyManifestChecksum,
      dependencyRevisionChecksum,
      materializedChecksum: input.result.materializedChecksum,
      rereadHint: workspaceOutlineRereadHint(manifest.profileId)
    }
  };
  return { source, artifact: createAgentContextSourceMaterializationArtifact(source) };
}

/** Stable dependency identity for staleness; materialized text/token truncation is intentionally absent. */
export function workspaceOutlineDependencyRevisionChecksum(
  manifest: WorkspaceOutlineDependencyManifest
): string {
  return checksumProjectContext({
    schemaVersion: manifest.schemaVersion,
    readerVersion: manifest.readerVersion,
    profileId: manifest.profileId,
    workspace: manifest.workspace,
    dependency: manifest.dependency
  });
}

export interface AgentContextSourceMaterializationArtifact {
  readonly schemaVersion: typeof CONTEXT_SOURCE_MATERIALIZATION_ARTIFACT_VERSION;
  readonly artifactId: string;
  readonly refId: string;
  readonly sourceKind: "project_conventions" | "workspace_outline";
  readonly content: string;
  readonly materialization: AgentContextSourceMaterialization;
  readonly checksum: string;
}

export function createAgentContextSourceMaterializationArtifact(
  source: AgentContextSourceInput
): AgentContextSourceMaterializationArtifact {
  const materialization = source.materialization;
  if (
    materialization === undefined ||
    (source.sourceKind !== "project_conventions" && source.sourceKind !== "workspace_outline") ||
    materialization.kind !== source.sourceKind
  ) {
    throw new Error("AGENT_CONTEXT_SOURCE_MATERIALIZATION_INVALID");
  }
  assertContextSourceMaterializationIntegrity(source, materialization);
  const unsigned = {
    schemaVersion: CONTEXT_SOURCE_MATERIALIZATION_ARTIFACT_VERSION,
    artifactId: materialization.artifactId,
    refId: source.refId,
    sourceKind: source.sourceKind,
    content: source.content,
    materialization
  } as const;
  return Object.freeze({
    ...unsigned,
    checksum: checksum(stableSerialize(unsigned))
  }) as AgentContextSourceMaterializationArtifact;
}

export function parseAgentContextSourceMaterializationArtifact(
  value: JsonObject
): AgentContextSourceMaterializationArtifact {
  if (
    value["schemaVersion"] !== CONTEXT_SOURCE_MATERIALIZATION_ARTIFACT_VERSION ||
    typeof value["artifactId"] !== "string" ||
    typeof value["refId"] !== "string" ||
    (value["sourceKind"] !== "project_conventions" &&
      value["sourceKind"] !== "workspace_outline") ||
    typeof value["content"] !== "string" ||
    !validateAgentContextSourceMaterialization(value["materialization"]) ||
    value["materialization"]["artifactId"] !== value["artifactId"] ||
    value["materialization"]["kind"] !== value["sourceKind"] ||
    typeof value["checksum"] !== "string"
  ) {
    throw new Error("AGENT_CONTEXT_SOURCE_MATERIALIZATION_INVALID");
  }
  const recreated = createAgentContextSourceMaterializationArtifact({
    refId: value["refId"],
    sourceKind: value["sourceKind"],
    content: value["content"],
    dirty: false,
    materialization: value["materialization"] as unknown as AgentContextSourceMaterialization
  });
  if (recreated.checksum !== value["checksum"]) {
    throw new Error("AGENT_CONTEXT_SOURCE_MATERIALIZATION_INVALID");
  }
  return recreated;
}

export function contextSourceMaterializationArtifactId(
  sourceKind: "project_conventions" | "workspace_outline",
  identity: unknown
): string {
  return `context_source_${sourceKind}_${checksum(stableSerialize(identity)).slice(0, 32)}`;
}

function assertContextSourceMaterializationIntegrity(
  source: AgentContextSourceInput,
  materialization: AgentContextSourceMaterialization
): void {
  if (!validateAgentContextSourceMaterialization(materialization)) {
    throw new Error("AGENT_CONTEXT_SOURCE_MATERIALIZATION_INVALID");
  }
  if (materialization.kind === "project_conventions") {
    const expectedArtifactId = contextSourceMaterializationArtifactId("project_conventions", {
      readerVersion: materialization.readerVersion,
      sourceIdentity: materialization.sourceIdentity,
      originalChecksum: materialization.originalChecksum,
      injectedChecksum: materialization.injectedChecksum,
      tokenCount: materialization.tokenCount,
      truncationRange: materialization.truncationRange
    });
    if (
      source.sourceKind !== "project_conventions" ||
      checksum(source.content) !== materialization.injectedChecksum ||
      materialization.artifactId !== expectedArtifactId
    ) {
      throw new Error("AGENT_CONTEXT_SOURCE_MATERIALIZATION_INVALID");
    }
    return;
  }

  const manifest =
    materialization.dependencyManifest as unknown as WorkspaceOutlineDependencyManifest;
  const expectedArtifactId = contextSourceMaterializationArtifactId("workspace_outline", {
    readerVersion: materialization.readerVersion,
    sourceIdentity: materialization.sourceIdentity,
    dependencyManifestChecksum: materialization.dependencyManifestChecksum,
    dependencyRevisionChecksum: materialization.dependencyRevisionChecksum,
    materializedChecksum: materialization.materializedChecksum,
    tokenCount: materialization.tokenCount,
    truncationRange: materialization.truncationRange
  });
  if (
    source.sourceKind !== "workspace_outline" ||
    checksumProjectContext(manifest) !== materialization.dependencyManifestChecksum ||
    workspaceOutlineDependencyRevisionChecksum(manifest) !==
      materialization.dependencyRevisionChecksum ||
    checksum(source.content) !== materialization.materializedChecksum ||
    materialization.artifactId !== expectedArtifactId
  ) {
    throw new Error("AGENT_CONTEXT_SOURCE_MATERIALIZATION_INVALID");
  }
}

export function truncateContextText(input: {
  readonly text: string;
  readonly maxTokens: number;
  readonly estimator: AgentTokenEstimator;
  readonly modelProfileId: string;
}): {
  readonly text: string;
  readonly tokenCount: number;
  readonly truncationRange: {
    readonly unit: "unicode_code_point";
    readonly start: number;
    readonly end: number;
    readonly originalEnd: number;
  } | null;
} {
  const codePoints = [...input.text];
  const whole = input.estimator.count(input.text, input.modelProfileId).tokens;
  if (whole <= input.maxTokens) {
    return { text: input.text, tokenCount: whole, truncationRange: null };
  }
  let low = 0;
  let high = codePoints.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const count = input.estimator.count(codePoints.slice(0, middle).join(""), input.modelProfileId);
    if (count.tokens <= input.maxTokens) low = middle;
    else high = middle - 1;
  }
  const text = codePoints.slice(0, low).join("");
  return {
    text,
    tokenCount: input.estimator.count(text, input.modelProfileId).tokens,
    truncationRange: {
      unit: "unicode_code_point",
      start: 0,
      end: low,
      originalEnd: codePoints.length
    }
  };
}

export function checksumProjectContext(value: unknown): string {
  return checksum(stableSerialize(value));
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

function workspaceOutlineRereadHint(profileId: WorkspaceProjectContextProfileId): string {
  return profileId === "writing"
    ? "Use list_project_entries or targeted read/search tools to rebuild current project metadata."
    : "Use list_project_entries or search_project to reread the current workspace structure.";
}
