import { createHash } from "node:crypto";

export type AgentContextSourceKind = "disk_file" | "editor_buffer" | "story_bible_asset";

export interface AgentContextSourceInput {
  readonly refId: string;
  readonly sourceKind: AgentContextSourceKind;
  readonly relativePath?: string;
  readonly assetId?: string;
  readonly content: string;
  readonly dirty: boolean;
  readonly range?: { readonly start: number; readonly end: number };
}

export interface AgentContextSource {
  readonly refId: string;
  readonly sourceKind: AgentContextSourceKind;
  readonly relativePath?: string;
  readonly assetId?: string;
  readonly checksum: string;
  readonly dirty: boolean;
  readonly capturedAt: string;
  readonly range?: { readonly start: number; readonly end: number };
}

export interface AgentContextSnapshot {
  readonly schemaVersion: "1.0";
  readonly contextSnapshotId: string;
  readonly runId: string;
  readonly createdAt: string;
  readonly compactionRevision: number;
  readonly sources: readonly AgentContextSource[];
  readonly excludedSources: readonly string[];
}

export interface CreateAgentContextSnapshotInput {
  readonly contextSnapshotId: string;
  readonly runId: string;
  readonly createdAt: string;
  readonly sources: readonly AgentContextSourceInput[];
  readonly excludedSources?: readonly string[];
  readonly compactionRevision?: number;
}

export function createAgentContextSnapshot(
  input: CreateAgentContextSnapshotInput
): AgentContextSnapshot {
  return {
    schemaVersion: "1.0",
    contextSnapshotId: input.contextSnapshotId,
    runId: input.runId,
    createdAt: input.createdAt,
    compactionRevision: input.compactionRevision ?? 0,
    sources: input.sources.map(({ content, ...source }) => ({
      ...source,
      checksum: checksumText(content),
      capturedAt: input.createdAt
    })),
    excludedSources: input.excludedSources ?? []
  };
}

export function findStaleContextSources(
  snapshot: AgentContextSnapshot,
  currentSources: readonly { readonly refId: string; readonly content: string }[]
): string[] {
  const currentByRef = new Map(
    currentSources.map((source) => [source.refId, checksumText(source.content)])
  );
  return snapshot.sources
    .filter((source) => currentByRef.get(source.refId) !== source.checksum)
    .map((source) => source.refId);
}

function checksumText(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
