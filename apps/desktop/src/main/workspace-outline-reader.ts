import { createHash } from "node:crypto";

import {
  WORKSPACE_OUTLINE_READER_VERSION,
  checksumProjectContext,
  truncateContextText,
  type WorkspaceOutlineDependencyManifest,
  type WorkspaceOutlineEntry,
  type WorkspaceOutlineLimits,
  type WorkspaceOutlineReadInput,
  type WorkspaceOutlineReadResult,
  type WorkspaceOutlineReader,
  type WorkspaceOutlineTruncationReason,
  type WorkspaceProjectContextIdentity,
  type WorkspaceProjectContextProfileId
} from "@novel-studio/application";
import {
  createDeterministicTokenEstimator,
  type AgentTokenEstimator
} from "@novel-studio/agent-engine";
import {
  WorkspaceOutlineIndexRepository,
  buildCreativeProjectFileTreeOutlineIndex,
  normalizeWorkspaceOutlineIndexLimits,
  type CreativeProjectFilePolicy,
  type CreativeProjectFileTreeSnapshot,
  type WorkspaceOutlineCreativeFileTreeIndex,
  type WorkspaceOutlineEngineeringIndex,
  type WorkspaceOutlineIndexTruncationReason,
  type WorkspaceOutlineWritingIndex
} from "@novel-studio/repository";
import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

const WORKSPACE_OUTLINE_TOKEN_LIMIT = 1_500;

export interface DesktopWorkspaceOutlineReaderOptions {
  /** Bound by Main to a canonical-root/no-symlink guarded metadata/index implementation. */
  readonly engineeringIndex?: Pick<WorkspaceOutlineIndexRepository, "readEngineeringIndex">;
  /** Main-owned metadata-only chapter and Story Bible index implementation. */
  readonly writingIndex?: Pick<WorkspaceOutlineIndexRepository, "readWritingIndexes">;
  /**
   * Main-owned C1C snapshot re-attestation. The callback refreshes the session through the existing
   * guarded tree repository; this reader never receives a root or scans a creative directory itself.
   */
  readonly creativeProjectFiles?: {
    readonly reattestTreeSnapshot: () => Promise<
      Result<CreativeProjectFileTreeSnapshot | undefined, UnifiedError>
    >;
    readonly policy: CreativeProjectFilePolicy;
  };
  readonly estimator?: AgentTokenEstimator;
  readonly now?: () => number;
}

interface BuiltWorkspaceOutline {
  readonly entries: readonly WorkspaceOutlineEntry[];
  readonly text: string;
  readonly dependencyManifest: WorkspaceOutlineDependencyManifest;
}

/**
 * Main-owned implementation of the application WorkspaceOutlineReader port. Its public input is
 * intentionally limited to Main-resolved identity, profile, and hard limits. Roots, cwd values,
 * file paths supplied by Renderer, and bodies are all closed over by the guarded source adapters.
 */
export class DesktopWorkspaceOutlineReader implements WorkspaceOutlineReader {
  private readonly estimator: AgentTokenEstimator;
  private readonly now: () => number;

  public constructor(private readonly options: DesktopWorkspaceOutlineReaderOptions) {
    this.estimator = options.estimator ?? createDeterministicTokenEstimator();
    this.now = options.now ?? Date.now;
  }

  public async read(
    input: WorkspaceOutlineReadInput
  ): Promise<Result<WorkspaceOutlineReadResult, UnifiedError>> {
    const built = await this.build(input);
    if (!built.ok) return built;

    const truncated = truncateContextText({
      text: built.value.text,
      maxTokens: built.value.dependencyManifest.limits.maxTokens,
      estimator: this.estimator,
      modelProfileId: input.modelProfileId
    });
    const dependencyManifest = withTokenTruncation(
      built.value.dependencyManifest,
      truncated.truncationRange !== null
    );
    return ok({
      entries: built.value.entries,
      text: truncated.text,
      dependencyManifest,
      dependencyManifestChecksum: checksumProjectContext(dependencyManifest),
      materializedChecksum: checksumText(truncated.text),
      tokenCount: truncated.tokenCount,
      truncationRange: truncated.truncationRange
    });
  }

  public async readDependencyManifest(
    input: Omit<WorkspaceOutlineReadInput, "modelProfileId">
  ): Promise<Result<WorkspaceOutlineDependencyManifest, UnifiedError>> {
    const built = await this.build(input);
    return built.ok ? ok(built.value.dependencyManifest) : built;
  }

  private async build(
    input: Omit<WorkspaceOutlineReadInput, "modelProfileId">
  ): Promise<Result<BuiltWorkspaceOutline, UnifiedError>> {
    const limits = normalizeOutlineLimits(input.limits);
    if (!limits.ok) return limits;
    if (!isProfileWorkspaceCombination(input.profileId, input.workspace)) {
      return outlineError({
        code: "WORKSPACE_OUTLINE_PROFILE_INVALID",
        message: "The workspace identity does not match the resolved outline profile.",
        suggestedAction: "Resolve the workspace profile before reading its outline."
      });
    }

    switch (input.profileId) {
      case "engineering":
        return this.buildEngineering(input.workspace, limits.value);
      case "creative_general":
        return this.buildCreative(input.workspace, limits.value);
      case "writing":
        return this.buildWriting(input.workspace, limits.value);
    }
  }

  private async buildEngineering(
    workspace: WorkspaceProjectContextIdentity,
    limits: WorkspaceOutlineLimits
  ): Promise<Result<BuiltWorkspaceOutline, UnifiedError>> {
    if (this.options.engineeringIndex === undefined) {
      const dependencyManifest = engineeringManifest(workspace, limits, {
        entrySetRevision: "engineering_entries:missing",
        entrySetChecksum: checksumProjectContext({
          kind: "engineering_entries",
          status: "missing"
        }),
        truncated: false,
        truncationReasons: []
      });
      return ok({
        entries: [],
        text: renderOutline({
          profileId: "engineering",
          entries: [],
          truncationReasons: [],
          omittedEntryCount: 0,
          degradedDependencies: ["engineering metadata index"]
        }),
        dependencyManifest
      });
    }

    const index = await this.options.engineeringIndex.readEngineeringIndex(toIndexLimits(limits));
    if (!index.ok) return index;
    const dependencyManifest = engineeringManifest(workspace, limits, index.value);
    return ok({
      entries: index.value.entries,
      text: renderOutline({
        profileId: "engineering",
        entries: index.value.entries,
        truncationReasons: index.value.truncationReasons,
        omittedEntryCount: index.value.omittedEntryCount,
        degradedDependencies: []
      }),
      dependencyManifest
    });
  }

  private async buildCreative(
    workspace: WorkspaceProjectContextIdentity,
    limits: WorkspaceOutlineLimits
  ): Promise<Result<BuiltWorkspaceOutline, UnifiedError>> {
    const source = this.options.creativeProjectFiles;
    if (source === undefined) {
      const dependencyManifest = creativeManifest(workspace, limits, {
        treeRevision: "creative_file_tree:missing",
        policyVersion: "unavailable",
        visibleNodeChecksum: checksumProjectContext({
          kind: "creative_file_tree",
          status: "missing"
        }),
        truncated: false,
        truncationReasons: []
      });
      return ok({
        entries: [],
        text: renderOutline({
          profileId: "creative_general",
          entries: [],
          truncationReasons: [],
          omittedEntryCount: 0,
          degradedDependencies: ["creative project file tree"]
        }),
        dependencyManifest
      });
    }

    const snapshot = await source.reattestTreeSnapshot();
    if (!snapshot.ok) return snapshot;
    if (snapshot.value === undefined) {
      const dependencyManifest = creativeManifest(workspace, limits, {
        treeRevision: "creative_file_tree:missing",
        policyVersion: source.policy.schemaVersion,
        visibleNodeChecksum: checksumProjectContext({
          kind: "creative_file_tree",
          status: "missing"
        }),
        truncated: false,
        truncationReasons: []
      });
      return ok({
        entries: [],
        text: renderOutline({
          profileId: "creative_general",
          entries: [],
          truncationReasons: [],
          omittedEntryCount: 0,
          degradedDependencies: ["creative project file tree"]
        }),
        dependencyManifest
      });
    }
    if (snapshot.value.workspaceId !== workspace.workspaceId) {
      return outlineError({
        code: "WORKSPACE_OUTLINE_CREATIVE_IDENTITY_MISMATCH",
        message: "The creative file tree does not belong to the active workspace identity.",
        suggestedAction: "Refresh the creative project file tree after switching projects."
      });
    }
    const index = buildCreativeProjectFileTreeOutlineIndex({
      snapshot: snapshot.value,
      policy: source.policy,
      limits: toIndexLimits(limits),
      now: this.now
    });
    if (!index.ok) return index;
    const dependencyManifest = creativeManifest(workspace, limits, index.value);
    return ok({
      entries: index.value.entries,
      text: renderOutline({
        profileId: "creative_general",
        entries: index.value.entries,
        truncationReasons: index.value.truncationReasons,
        omittedEntryCount: index.value.omittedEntryCount,
        degradedDependencies: []
      }),
      dependencyManifest
    });
  }

  private async buildWriting(
    workspace: WorkspaceProjectContextIdentity,
    limits: WorkspaceOutlineLimits
  ): Promise<Result<BuiltWorkspaceOutline, UnifiedError>> {
    if (this.options.writingIndex === undefined) {
      const dependencyManifest = writingManifest(workspace, limits, {
        chapterIndexRevision: "chapters:missing",
        chapterIndexChecksum: checksumProjectContext({ kind: "chapters", status: "missing" }),
        storyBibleIndexRevision: null,
        storyBibleIndexChecksum: null,
        degradedDependencies: ["chapters", "story_bible"],
        truncated: false,
        truncationReasons: []
      });
      return ok({
        entries: [],
        text: renderOutline({
          profileId: "writing",
          entries: [],
          truncationReasons: [],
          omittedEntryCount: 0,
          degradedDependencies: ["chapters", "story_bible"]
        }),
        dependencyManifest
      });
    }

    const index = await this.options.writingIndex.readWritingIndexes(toIndexLimits(limits));
    if (!index.ok) return index;
    const dependencyManifest = writingManifest(workspace, limits, index.value);
    return ok({
      entries: index.value.entries,
      text: renderOutline({
        profileId: "writing",
        entries: index.value.entries,
        truncationReasons: index.value.truncationReasons,
        omittedEntryCount: index.value.omittedEntryCount,
        degradedDependencies: index.value.degradedDependencies
      }),
      dependencyManifest
    });
  }
}

export function createDesktopWorkspaceOutlineReader(
  options: DesktopWorkspaceOutlineReaderOptions
): WorkspaceOutlineReader {
  return new DesktopWorkspaceOutlineReader(options);
}

/**
 * Staleness intentionally compares immutable dependency identity only. It excludes materialized
 * text and token truncation so hydrate/compaction cannot revive or replace an old body merely
 * because a tokenizer implementation changed.
 */
export function sameWorkspaceOutlineDependencyManifest(
  left: WorkspaceOutlineDependencyManifest,
  right: WorkspaceOutlineDependencyManifest
): boolean {
  return (
    checksumProjectContext(dependencyIdentity(left)) ===
    checksumProjectContext(dependencyIdentity(right))
  );
}

export function hasWorkspaceOutlineDependencyChanged(
  previous: WorkspaceOutlineDependencyManifest,
  current: WorkspaceOutlineDependencyManifest
): boolean {
  return !sameWorkspaceOutlineDependencyManifest(previous, current);
}

function normalizeOutlineLimits(
  input: WorkspaceOutlineLimits
): Result<WorkspaceOutlineLimits, UnifiedError> {
  if (!Number.isSafeInteger(input.maxTokens) || input.maxTokens < 0) {
    return outlineError({
      code: "WORKSPACE_OUTLINE_TOKEN_LIMIT_INVALID",
      message: "The workspace outline token limit is invalid.",
      suggestedAction: "Use a non-negative integer workspace outline token limit."
    });
  }
  const indexLimits = normalizeWorkspaceOutlineIndexLimits({
    maxDepth: input.maxDepth,
    maxEntries: input.maxEntries,
    maxScannedEntries: input.maxScannedEntries,
    maxBytes: input.maxBytes,
    maxDurationMs: input.maxDurationMs
  });
  if (!indexLimits.ok) return indexLimits;
  return ok(
    Object.freeze({
      ...indexLimits.value,
      maxTokens: Math.min(input.maxTokens, WORKSPACE_OUTLINE_TOKEN_LIMIT)
    })
  );
}

function toIndexLimits(limits: WorkspaceOutlineLimits) {
  return {
    maxDepth: limits.maxDepth,
    maxEntries: limits.maxEntries,
    maxScannedEntries: limits.maxScannedEntries,
    maxBytes: limits.maxBytes,
    maxDurationMs: limits.maxDurationMs
  } as const;
}

function engineeringManifest(
  workspace: WorkspaceProjectContextIdentity,
  limits: WorkspaceOutlineLimits,
  index: Pick<
    WorkspaceOutlineEngineeringIndex,
    "entrySetRevision" | "entrySetChecksum" | "truncated" | "truncationReasons"
  >
): WorkspaceOutlineDependencyManifest {
  return Object.freeze({
    schemaVersion: "1.0",
    readerVersion: WORKSPACE_OUTLINE_READER_VERSION,
    profileId: "engineering",
    workspace,
    limits,
    truncated: index.truncated,
    truncationReasons: index.truncationReasons,
    dependency: {
      kind: "engineering_entries" as const,
      entrySetRevision: index.entrySetRevision,
      entrySetChecksum: index.entrySetChecksum
    }
  });
}

function creativeManifest(
  workspace: WorkspaceProjectContextIdentity,
  limits: WorkspaceOutlineLimits,
  index: Pick<
    WorkspaceOutlineCreativeFileTreeIndex,
    "treeRevision" | "policyVersion" | "visibleNodeChecksum" | "truncated" | "truncationReasons"
  >
): WorkspaceOutlineDependencyManifest {
  return Object.freeze({
    schemaVersion: "1.0",
    readerVersion: WORKSPACE_OUTLINE_READER_VERSION,
    profileId: "creative_general",
    workspace,
    limits,
    truncated: index.truncated,
    truncationReasons: index.truncationReasons,
    dependency: {
      kind: "creative_file_tree" as const,
      treeRevision: index.treeRevision,
      policyVersion: index.policyVersion,
      visibleNodeChecksum: index.visibleNodeChecksum
    }
  });
}

function writingManifest(
  workspace: WorkspaceProjectContextIdentity,
  limits: WorkspaceOutlineLimits,
  index: Pick<
    WorkspaceOutlineWritingIndex,
    | "chapterIndexRevision"
    | "chapterIndexChecksum"
    | "storyBibleIndexRevision"
    | "storyBibleIndexChecksum"
    | "degradedDependencies"
    | "truncated"
    | "truncationReasons"
  >
): WorkspaceOutlineDependencyManifest {
  return Object.freeze({
    schemaVersion: "1.0",
    readerVersion: WORKSPACE_OUTLINE_READER_VERSION,
    profileId: "writing",
    workspace,
    limits,
    truncated: index.truncated,
    truncationReasons: index.truncationReasons,
    dependency: {
      kind: "writing_indexes" as const,
      chapterIndexRevision: index.chapterIndexRevision,
      chapterIndexChecksum: index.chapterIndexChecksum,
      storyBibleIndexRevision: index.storyBibleIndexRevision,
      storyBibleIndexChecksum: index.storyBibleIndexChecksum,
      degradedDependencies: index.degradedDependencies
    }
  });
}

function withTokenTruncation(
  manifest: WorkspaceOutlineDependencyManifest,
  tokenTruncated: boolean
): WorkspaceOutlineDependencyManifest {
  if (!tokenTruncated) return manifest;
  return Object.freeze({
    ...manifest,
    truncated: true,
    truncationReasons: Object.freeze(
      [
        ...new Set<WorkspaceOutlineTruncationReason>([...manifest.truncationReasons, "max_tokens"])
      ].sort()
    )
  });
}

function renderOutline(input: {
  readonly profileId: WorkspaceProjectContextProfileId;
  readonly entries: readonly WorkspaceOutlineEntry[];
  readonly truncationReasons: readonly WorkspaceOutlineIndexTruncationReason[];
  readonly omittedEntryCount: number | null;
  readonly degradedDependencies: readonly string[];
}): string {
  const lines = [`Workspace outline (${input.profileId}).`];
  if (input.degradedDependencies.length > 0) {
    lines.push(
      `Dependency status: unavailable ${input.degradedDependencies.map(quote).join(", ")}.`
    );
  }
  if (input.truncationReasons.length > 0) {
    lines.push(`Outline status: truncated (${input.truncationReasons.join(", ")}).`);
  }

  switch (input.profileId) {
    case "engineering":
    case "creative_general":
      lines.push("Directory skeleton:");
      break;
    case "writing":
      lines.push("Chapter and Story Bible indexes:");
      break;
  }
  if (input.entries.length === 0) lines.push("- (empty)");
  for (const entry of input.entries) lines.push(renderEntry(entry));
  if (input.truncationReasons.length > 0) {
    const count = input.omittedEntryCount === null ? "additional" : String(input.omittedEntryCount);
    lines.push(`- ... (+${count} entries omitted)`);
  }
  return lines.join("\n");
}

function renderEntry(entry: WorkspaceOutlineEntry): string {
  switch (entry.kind) {
    case "directory":
    case "file":
      return `${entry.kind} ${quote(entry.relativePath ?? entry.label)}`;
    case "chapter":
      return `chapter id=${quote(entry.id)} title=${quote(entry.label)} wordCount=${
        entry.wordCount === undefined ? "unknown" : entry.wordCount
      }`;
    case "story_bible_asset":
      return `story_bible_asset id=${quote(entry.id)} title=${quote(entry.label)} type=${quote(
        entry.assetType ?? "unknown"
      )}`;
  }
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function checksumText(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function dependencyIdentity(manifest: WorkspaceOutlineDependencyManifest) {
  return {
    schemaVersion: manifest.schemaVersion,
    readerVersion: manifest.readerVersion,
    profileId: manifest.profileId,
    workspace: manifest.workspace,
    limits: manifest.limits,
    dependency: manifest.dependency
  } as const;
}

function isProfileWorkspaceCombination(
  profileId: WorkspaceProjectContextProfileId,
  workspace: WorkspaceProjectContextIdentity
): boolean {
  if (profileId === "engineering") return workspace.workspaceKind === "engineeringWorkspace";
  return (
    (profileId === "writing" || profileId === "creative_general") &&
    workspace.workspaceKind === "creativeProject"
  );
}

function outlineError<T = never>(input: {
  readonly code: string;
  readonly message: string;
  readonly suggestedAction: string;
}): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: input.code,
      category: "ValidationError",
      message: input.message,
      recoverability: "user-action",
      suggestedAction: input.suggestedAction,
      traceId: "desktop-workspace-outline-reader"
    })
  );
}
