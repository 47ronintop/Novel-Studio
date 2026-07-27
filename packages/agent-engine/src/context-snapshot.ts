import { createHash } from "node:crypto";

import type { JsonObject } from "@novel-studio/shared";
import {
  normalizeAgentContextScope,
  type AgentContextProfileId,
  type AgentContextScope
} from "./agent-context-scope.js";

export type AgentContextSourceKind =
  | "disk_file"
  | "editor_buffer"
  | "story_bible_asset"
  | "project_conventions"
  | "workspace_outline"
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

export interface AgentContextSourceInput {
  readonly refId: string;
  readonly sourceKind: AgentContextSourceKind;
  readonly relativePath?: string;
  readonly assetId?: string;
  readonly content: string;
  readonly dirty: boolean;
  readonly range?: { readonly start: number; readonly end: number };
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

export type AgentContextSource = AgentContextSourceV12;

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

export type AgentContextSnapshot = AgentContextSnapshotV12;

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
}

export function createAgentContextSnapshot(
  input: CreateAgentContextSnapshotInput
): AgentContextSnapshot {
  return {
    schemaVersion: "1.2",
    contextSnapshotId: input.contextSnapshotId,
    runId: input.runId,
    scope: input.scope,
    contextProfileId: input.contextProfileId,
    materialization: input.materialization,
    createdAt: input.createdAt,
    compactionRevision: input.compactionRevision ?? 0,
    sources: input.sources.map(({ content, ...source }, materializationOrder) => ({
      ...source,
      checksum: checksumText(content),
      capturedAt: input.createdAt,
      layer: defaultLayerForSource(source.sourceKind),
      sourceRevision: 0,
      tokenCount: null,
      precision: "unknown" as const,
      state: "active" as const,
      artifactId:
        input.materializationArtifactId !== undefined &&
        (input.materializationArtifactSourceRefs === undefined ||
          input.materializationArtifactSourceRefs.includes(source.refId))
          ? input.materializationArtifactId
          : null,
      materializationOrder
    })),
    excludedSources: input.excludedSources ?? []
  };
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
): AgentContextSnapshotV12 {
  if (value["schemaVersion"] === "1.2") {
    return {
      ...value,
      scope: normalizeAgentContextScope(value["scope"])
    } as unknown as AgentContextSnapshotV12;
  }
  if (value["schemaVersion"] !== "1.0" && value["schemaVersion"] !== "1.1") {
    throw new Error("AGENT_CONTEXT_SNAPSHOT_VERSION_UNSUPPORTED");
  }
  if (fallback === undefined) throw new Error("AGENT_CONTEXT_SNAPSHOT_SCOPE_REQUIRED");
  const rawSources = Array.isArray(value["sources"]) ? value["sources"] : [];
  const sources = rawSources.map((source, materializationOrder) => ({
    ...(source as JsonObject),
    ...(value["schemaVersion"] === "1.0"
      ? {
          layer: "tool_result" as const,
          sourceRevision: 0,
          tokenCount: null,
          precision: "unknown" as const,
          state: "active" as const
        }
      : {}),
    artifactId: null,
    materializationOrder
  }));
  return {
    ...value,
    schemaVersion: "1.2",
    scope: fallback.scope,
    contextProfileId: fallback.contextProfileId,
    materialization: {
      schemaVersion: "1.0",
      profileVersion: fallback.profileVersion ?? "legacy",
      guidanceTemplateChecksum: fallback.guidanceTemplateChecksum ?? "legacy",
      stablePrefixChecksum: fallback.stablePrefixChecksum ?? "legacy",
      messageOrderVersion: "1.0"
    },
    sources
  } as unknown as AgentContextSnapshotV12;
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
    case "system_guidance":
      return "system";
    default:
      return "tool_result";
  }
}

export function findStaleContextSources(
  snapshot: AgentContextSnapshot,
  currentSources: readonly { readonly refId: string; readonly content: string }[]
): string[] {
  const currentByRef = new Map(
    currentSources.map((source) => [source.refId, checksumText(source.content)])
  );
  return snapshot.sources
    .filter(
      // System-authored guidance (mode-specific prompt + style pack) is fixed for the run and never
      // read back from a file or editor buffer, so it can never go stale and must not be compared
      // against the current-source reader (which does not surface it).
      (source) => source.layer !== "system" && currentByRef.get(source.refId) !== source.checksum
    )
    .map((source) => source.refId);
}

function checksumText(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
