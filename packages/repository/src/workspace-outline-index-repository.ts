import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, open, opendir, readdir, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { isAbsolute, join, relative } from "node:path";

import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import {
  normalizeCreativeProjectFilePath,
  normalizeCreativeProjectFilePolicy,
  type CreativeProjectFilePolicy,
  type CreativeProjectFileTreeNode,
  type CreativeProjectFileTreeSnapshot
} from "./creative-project-file-repository.js";

export const WORKSPACE_OUTLINE_INDEX_REPOSITORY_VERSION = "1.0" as const;
export const WORKSPACE_OUTLINE_ENGINEERING_MAX_DEPTH = 2;
export const WORKSPACE_OUTLINE_ENGINEERING_MAX_ENTRIES = 200;

const ENGINEERING_BLOCKED_ROOTS = new Set([
  ".git",
  ".hg",
  ".svn",
  ".novel-studio",
  "node_modules",
  "history",
  "cache",
  ".cache",
  "dist",
  "release",
  "build",
  "out",
  "coverage",
  "__pycache__"
]);
const DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const DEFAULT_WRITING_METADATA_MAX_ENTRIES = 1_000;
const DEFAULT_WRITING_METADATA_HEADER_BYTES = 64 * 1_024;
const DEFAULT_WRITING_METADATA_MAX_DURATION_MS = 200;
const WRITING_METADATA_READ_CHUNK_BYTES = 256;
const require = createRequire(import.meta.url);
const { load: loadYaml } = require("js-yaml") as { load(input: string): unknown };

export interface WorkspaceOutlineIndexLimits {
  readonly maxDepth: number;
  readonly maxEntries: number;
  readonly maxScannedEntries: number;
  readonly maxBytes: number;
  readonly maxDurationMs: number;
}

/** Remaining wall-clock budget supplied by the outline index for one metadata read. */
export interface WorkspaceOutlineWritingMetadataReadLimits {
  readonly maxDurationMs: number;
}

export type WorkspaceOutlineIndexTruncationReason =
  | "max_depth"
  | "max_entries"
  | "max_scanned_entries"
  | "max_bytes"
  | "max_duration"
  | "source_truncated";

export interface WorkspaceOutlineIndexEntry {
  readonly kind: "directory" | "file" | "chapter" | "story_bible_asset";
  readonly id: string;
  readonly label: string;
  readonly relativePath?: string;
  readonly depth?: number;
  readonly wordCount?: number;
  readonly assetType?: string;
}

/**
 * This is deliberately narrower than a filesystem API. Main supplies an implementation which has
 * already bound a canonical root and rejects symlinks/reparse points (for example
 * AgentProjectReadRepository). The outline index never receives a root or an absolute path.
 */
export interface WorkspaceOutlineGuardedEntryReader {
  listEntries(
    relativeDirectory: string,
    limits: WorkspaceOutlineGuardedEntryReadLimits
  ): Promise<Result<WorkspaceOutlineGuardedEntryReadResult, UnifiedError>>;
}

export interface WorkspaceOutlineGuardedEntryReadLimits {
  readonly maxEntries: number;
  readonly maxBytes: number;
  readonly maxDurationMs: number;
}

export interface WorkspaceOutlineGuardedEntryReadResult {
  readonly entries: readonly {
    readonly name: string;
    readonly relativePath: string;
    readonly kind: "directory" | "file";
  }[];
  readonly scannedEntries: number;
  readonly scannedBytes: number;
  readonly truncationReasons: readonly Extract<
    WorkspaceOutlineIndexTruncationReason,
    "max_scanned_entries" | "max_bytes" | "max_duration"
  >[];
}

export interface WorkspaceOutlineProjectEntryRepositoryOptions {
  /** Main-resolved engineering workspace root. */
  readonly projectRoot: string;
  readonly traceId?: string;
  readonly now?: () => number;
}

/**
 * Canonical-root/no-symlink directory metadata reader for engineering outlines. Unlike the Agent
 * text reader, this port intentionally lists every regular file type because a directory skeleton
 * must include source files such as .tsx, .css, or binaries without opening their contents.
 */
export class WorkspaceOutlineProjectEntryRepository implements WorkspaceOutlineGuardedEntryReader {
  private readonly canonicalRoot: Promise<Result<string, UnifiedError>>;
  private readonly traceId: string;
  private readonly now: () => number;

  public constructor(private readonly options: WorkspaceOutlineProjectEntryRepositoryOptions) {
    this.traceId = options.traceId ?? "workspace-outline-project-entry-repository";
    this.now = options.now ?? Date.now;
    this.canonicalRoot = this.bindRoot();
  }

  public async listEntries(
    relativeDirectory: string,
    limits: WorkspaceOutlineGuardedEntryReadLimits
  ): Promise<Result<WorkspaceOutlineGuardedEntryReadResult, UnifiedError>> {
    if (
      relativeDirectory !== "" &&
      (!isSafeRelativePath(relativeDirectory) || isBlockedEngineeringRoot(relativeDirectory))
    ) {
      return entryMetadataError(this.traceId);
    }
    const root = await this.assertRoot();
    if (!root.ok) return root;
    const directory = await this.resolveDirectory(root.value, relativeDirectory);
    if (!directory.ok) return directory;
    const startedAt = this.now();
    try {
      const visible: {
        name: string;
        relativePath: string;
        kind: "directory" | "file";
      }[] = [];
      let scannedEntries = 0;
      let scannedBytes = 0;
      const reasons = new Set<"max_scanned_entries" | "max_bytes" | "max_duration">();
      const directoryHandle = await opendir(directory.value);
      for await (const entry of directoryHandle) {
        if (this.now() - startedAt >= limits.maxDurationMs) {
          reasons.add("max_duration");
          break;
        }
        if (scannedEntries >= limits.maxEntries) {
          reasons.add("max_scanned_entries");
          break;
        }
        const relativePath =
          relativeDirectory === "" ? entry.name : `${relativeDirectory}/${entry.name}`;
        const metadataBytes = entryMetadataBytes(
          entry.isDirectory() ? "directory" : "file",
          relativePath
        );
        if (scannedBytes + metadataBytes > limits.maxBytes) {
          reasons.add("max_bytes");
          break;
        }
        scannedEntries += 1;
        scannedBytes += metadataBytes;
        if (!isSafePathSegment(entry.name) || entry.isSymbolicLink()) continue;
        if (isBlockedEngineeringRoot(relativePath)) continue;
        const target = join(directory.value, entry.name);
        const stats = await lstat(target);
        if (stats.isSymbolicLink() || (!stats.isDirectory() && !stats.isFile())) continue;
        const canonicalTarget = await realpath(target);
        if (!isContained(root.value, canonicalTarget)) return entryMetadataError(this.traceId);
        visible.push({
          name: entry.name,
          relativePath,
          kind: stats.isDirectory() ? "directory" : "file"
        });
      }
      return ok({
        entries: Object.freeze(sortGuardedEntries(visible)),
        scannedEntries,
        scannedBytes,
        truncationReasons: Object.freeze([...reasons].sort())
      });
    } catch {
      return entryMetadataError(this.traceId);
    }
  }

  private async resolveDirectory(
    root: string,
    relativeDirectory: string
  ): Promise<Result<string, UnifiedError>> {
    let current = root;
    try {
      for (const segment of relativeDirectory.split("/").filter(Boolean)) {
        current = join(current, segment);
        const stats = await lstat(current);
        if (!stats.isDirectory() || stats.isSymbolicLink()) {
          return entryMetadataError(this.traceId);
        }
        current = await realpath(current);
        if (!isContained(root, current)) return entryMetadataError(this.traceId);
      }
      return ok(current);
    } catch {
      return entryMetadataError(this.traceId);
    }
  }

  private async bindRoot(): Promise<Result<string, UnifiedError>> {
    if (!isAbsolute(this.options.projectRoot)) return entryMetadataError(this.traceId);
    try {
      const stats = await lstat(this.options.projectRoot);
      const canonical = await realpath(this.options.projectRoot);
      return !stats.isDirectory() || stats.isSymbolicLink()
        ? entryMetadataError(this.traceId)
        : ok(canonical);
    } catch {
      return entryMetadataError(this.traceId);
    }
  }

  private async assertRoot(): Promise<Result<string, UnifiedError>> {
    const bound = await this.canonicalRoot;
    if (!bound.ok) return bound;
    try {
      const stats = await lstat(this.options.projectRoot);
      const current = await realpath(this.options.projectRoot);
      return !stats.isDirectory() || stats.isSymbolicLink() || !samePath(bound.value, current)
        ? entryMetadataError(this.traceId)
        : ok(bound.value);
    } catch {
      return entryMetadataError(this.traceId);
    }
  }
}

export interface WorkspaceOutlineChapterIndexEntry {
  readonly id: string;
  readonly title: string;
  readonly wordCount?: number;
  /** Source identity only. It is retained for dependency checks and never rendered into the outline. */
  readonly relativePath?: string;
}

export interface WorkspaceOutlineStoryBibleIndexEntry {
  readonly assetId: string;
  readonly title: string;
  readonly assetType: string;
  /** Source identity only. It is retained for dependency checks and never rendered into the outline. */
  readonly relativePath?: string;
}

/**
 * Metadata-only snapshots. Implementations must not expose chapter bodies or Story Bible bodies
 * through this port; source-relative paths are dependency identity only and never reach the outline.
 */
export interface WorkspaceOutlineChapterIndexSnapshot {
  readonly revision: string;
  readonly entries: readonly WorkspaceOutlineChapterIndexEntry[];
}

export interface WorkspaceOutlineStoryBibleIndexSnapshot {
  readonly revision: string;
  readonly entries: readonly WorkspaceOutlineStoryBibleIndexEntry[];
}

/** Implementations must enforce the supplied deadline inside their own metadata read loops. */
export interface WorkspaceOutlineWritingMetadataReader {
  readChapterIndex(
    limits?: WorkspaceOutlineWritingMetadataReadLimits
  ): Promise<Result<WorkspaceOutlineChapterIndexSnapshot | undefined, UnifiedError>>;
  readStoryBibleIndex(
    limits?: WorkspaceOutlineWritingMetadataReadLimits
  ): Promise<Result<WorkspaceOutlineStoryBibleIndexSnapshot | undefined, UnifiedError>>;
}

export interface WorkspaceOutlineProjectMetadataRepositoryOptions {
  /** Main-resolved workspace root. This is never accepted by the application reader port. */
  readonly projectRoot: string;
  readonly maxEntries?: number;
  readonly maxHeaderBytes?: number;
  readonly traceId?: string;
  /** Injectable for deterministic deadline tests. */
  readonly now?: () => number;
}

interface MetadataReadDeadline {
  readonly startedAt: number;
  readonly maxDurationMs: number;
}

/**
 * A concrete, read-only metadata source for writing outlines. It binds a canonical root, rejects
 * symlinks/reparse points for every path it opens, and reads only a bounded file prefix. Chapters
 * are parsed from YAML frontmatter; Story Bible assets stop parsing as soon as id/title/type are
 * available, before summary/details bodies are needed.
 */
export class WorkspaceOutlineProjectMetadataRepository implements WorkspaceOutlineWritingMetadataReader {
  private readonly canonicalRoot: Promise<Result<string, UnifiedError>>;
  private readonly maxEntries: number;
  private readonly maxHeaderBytes: number;
  private readonly traceId: string;
  private readonly now: () => number;

  public constructor(private readonly options: WorkspaceOutlineProjectMetadataRepositoryOptions) {
    this.traceId = options.traceId ?? "workspace-outline-project-metadata-repository";
    this.now = options.now ?? Date.now;
    this.maxEntries = positiveLimit(
      options.maxEntries,
      DEFAULT_WRITING_METADATA_MAX_ENTRIES,
      DEFAULT_WRITING_METADATA_MAX_ENTRIES
    );
    this.maxHeaderBytes = positiveLimit(
      options.maxHeaderBytes,
      DEFAULT_WRITING_METADATA_HEADER_BYTES,
      DEFAULT_WRITING_METADATA_HEADER_BYTES
    );
    this.canonicalRoot = this.bindRoot();
  }

  /** Allows focused tests to replace a pathname after its opened handle is verified. */
  protected async afterPathIdentityVerified(_fullPath: string): Promise<void> {
    void _fullPath;
  }

  public async readChapterIndex(
    limits?: WorkspaceOutlineWritingMetadataReadLimits
  ): Promise<Result<WorkspaceOutlineChapterIndexSnapshot | undefined, UnifiedError>> {
    const deadline = this.createDeadline(limits);
    if (this.deadlineExceeded(deadline)) return metadataDurationExceeded(this.traceId);
    const files = await this.listDirectoryFiles("chapters", ".md", deadline);
    if (!files.ok) return files;
    if (files.value === undefined) return ok(undefined);

    const entries: WorkspaceOutlineChapterIndexEntry[] = [];
    for (const file of files.value) {
      if (this.deadlineExceeded(deadline)) return metadataDurationExceeded(this.traceId);
      const prefix = await this.readPrefix(file, hasCompleteChapterFrontmatter, deadline);
      if (!prefix.ok) return prefix;
      if (prefix.value === undefined) {
        return metadataError(this.traceId, "WORKSPACE_OUTLINE_CHAPTER_INDEX_INVALID");
      }
      const chapter = parseChapterFrontmatter(prefix.value);
      if (this.deadlineExceeded(deadline)) return metadataDurationExceeded(this.traceId);
      if (chapter === undefined) {
        return metadataError(this.traceId, "WORKSPACE_OUTLINE_CHAPTER_INDEX_INVALID");
      }
      entries.push({ ...chapter, relativePath: file });
    }
    const normalized = normalizeChapterIndex({
      revision: "pending",
      entries
    });
    if (this.deadlineExceeded(deadline)) return metadataDurationExceeded(this.traceId);
    if (!normalized.ok) return normalized;
    const revision = `chapters:${checksum(normalized.value.entries)}`;
    if (this.deadlineExceeded(deadline)) return metadataDurationExceeded(this.traceId);
    return ok({ revision, entries: normalized.value.entries });
  }

  public async readStoryBibleIndex(
    limits?: WorkspaceOutlineWritingMetadataReadLimits
  ): Promise<Result<WorkspaceOutlineStoryBibleIndexSnapshot | undefined, UnifiedError>> {
    const deadline = this.createDeadline(limits);
    if (this.deadlineExceeded(deadline)) return metadataDurationExceeded(this.traceId);
    const entries: WorkspaceOutlineStoryBibleIndexEntry[] = [];
    let hasStoryBibleSource = false;

    for (const directory of ["characters", "world", "foreshadows"] as const) {
      if (this.deadlineExceeded(deadline)) return metadataDurationExceeded(this.traceId);
      const files = await this.listDirectoryFiles(directory, ".json", deadline);
      if (!files.ok) return files;
      if (files.value === undefined) continue;
      hasStoryBibleSource = true;
      for (const file of files.value) {
        if (this.deadlineExceeded(deadline)) return metadataDurationExceeded(this.traceId);
        const asset = await this.readStoryBibleAssetHeader(file, deadline);
        if (!asset.ok) return asset;
        entries.push(asset.value);
      }
    }

    for (const file of ["outline/outline.json", "timeline/events.json"] as const) {
      if (this.deadlineExceeded(deadline)) return metadataDurationExceeded(this.traceId);
      const prefix = await this.readPrefix(file, hasStoryBibleAssetHeader, deadline);
      if (!prefix.ok) return prefix;
      if (prefix.value === undefined) continue;
      hasStoryBibleSource = true;
      const asset = parseStoryBibleAssetHeader(prefix.value);
      if (this.deadlineExceeded(deadline)) return metadataDurationExceeded(this.traceId);
      if (asset === undefined) {
        return metadataError(this.traceId, "WORKSPACE_OUTLINE_STORY_BIBLE_INDEX_INVALID");
      }
      entries.push({ ...asset, relativePath: file });
    }

    if (!hasStoryBibleSource) return ok(undefined);
    const normalized = normalizeStoryBibleIndex({ revision: "pending", entries });
    if (this.deadlineExceeded(deadline)) return metadataDurationExceeded(this.traceId);
    if (!normalized.ok) return normalized;
    const revision = `story_bible:${checksum(normalized.value.entries)}`;
    if (this.deadlineExceeded(deadline)) return metadataDurationExceeded(this.traceId);
    return ok({ revision, entries: normalized.value.entries });
  }

  private async readStoryBibleAssetHeader(
    relativePath: string,
    deadline: MetadataReadDeadline
  ): Promise<Result<WorkspaceOutlineStoryBibleIndexEntry, UnifiedError>> {
    const prefix = await this.readPrefix(relativePath, hasStoryBibleAssetHeader, deadline);
    if (!prefix.ok) return prefix;
    if (prefix.value === undefined) {
      return metadataError(this.traceId, "WORKSPACE_OUTLINE_STORY_BIBLE_INDEX_INVALID");
    }
    const asset = parseStoryBibleAssetHeader(prefix.value);
    if (this.deadlineExceeded(deadline)) return metadataDurationExceeded(this.traceId);
    return asset === undefined
      ? metadataError(this.traceId, "WORKSPACE_OUTLINE_STORY_BIBLE_INDEX_INVALID")
      : ok({ ...asset, relativePath });
  }

  private async listDirectoryFiles(
    relativeDirectory: string,
    extension: string,
    deadline: MetadataReadDeadline
  ): Promise<Result<readonly string[] | undefined, UnifiedError>> {
    if (this.deadlineExceeded(deadline)) return metadataDurationExceeded(this.traceId);
    const directory = await this.resolveExisting(relativeDirectory, deadline);
    if (!directory.ok) return directory;
    if (directory.value === undefined) return ok(undefined);
    try {
      if (this.deadlineExceeded(deadline)) return metadataDurationExceeded(this.traceId);
      const stats = await lstat(directory.value);
      if (this.deadlineExceeded(deadline)) return metadataDurationExceeded(this.traceId);
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        return metadataError(this.traceId, "WORKSPACE_OUTLINE_METADATA_PATH_REJECTED");
      }
      const directoryEntries = await readdir(directory.value, { withFileTypes: true });
      if (this.deadlineExceeded(deadline)) return metadataDurationExceeded(this.traceId);
      if (directoryEntries.length > this.maxEntries) {
        return metadataError(this.traceId, "WORKSPACE_OUTLINE_METADATA_ENTRY_LIMIT");
      }
      const sortedDirectoryEntries = directoryEntries.sort((left, right) =>
        left.name.localeCompare(right.name)
      );
      if (this.deadlineExceeded(deadline)) return metadataDurationExceeded(this.traceId);
      const files: string[] = [];
      for (const entry of sortedDirectoryEntries) {
        if (this.deadlineExceeded(deadline)) return metadataDurationExceeded(this.traceId);
        if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith(extension)) continue;
        if (!isSafePathSegment(entry.name)) {
          return metadataError(this.traceId, "WORKSPACE_OUTLINE_METADATA_PATH_REJECTED");
        }
        const relativePath = `${relativeDirectory}/${entry.name}`;
        const resolved = await this.resolveExisting(relativePath, deadline);
        if (!resolved.ok) return resolved;
        if (resolved.value === undefined) {
          return metadataError(this.traceId, "WORKSPACE_OUTLINE_METADATA_PATH_REJECTED");
        }
        files.push(relativePath);
      }
      if (this.deadlineExceeded(deadline)) return metadataDurationExceeded(this.traceId);
      return ok(Object.freeze(files));
    } catch {
      return metadataError(this.traceId, "WORKSPACE_OUTLINE_METADATA_PATH_REJECTED");
    }
  }

  private async readPrefix(
    relativePath: string,
    stopWhen: (text: string) => boolean,
    deadline: MetadataReadDeadline
  ): Promise<Result<string | undefined, UnifiedError>> {
    if (this.deadlineExceeded(deadline)) return metadataDurationExceeded(this.traceId);
    const target = await this.resolveExisting(relativePath, deadline);
    if (!target.ok) return target;
    if (target.value === undefined) return ok(undefined);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      if (this.deadlineExceeded(deadline)) return metadataDurationExceeded(this.traceId);
      const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
      handle = await open(target.value, constants.O_RDONLY | noFollow);
      const openedStats = await handle.stat();
      if (this.deadlineExceeded(deadline)) return metadataDurationExceeded(this.traceId);
      if (!hasVerifiedFileIdentity(openedStats)) {
        return metadataError(this.traceId, "WORKSPACE_OUTLINE_METADATA_PATH_REJECTED");
      }
      const root = await this.assertRoot(deadline);
      if (!root.ok) return root;
      const [pathStats, canonicalPath] = await Promise.all([
        lstat(target.value),
        realpath(target.value)
      ]);
      if (this.deadlineExceeded(deadline)) return metadataDurationExceeded(this.traceId);
      if (!hasSameFileIdentity(openedStats, pathStats) || !isContained(root.value, canonicalPath)) {
        return metadataError(this.traceId, "WORKSPACE_OUTLINE_METADATA_PATH_REJECTED");
      }
      await this.afterPathIdentityVerified(target.value);
      const chunk = Buffer.allocUnsafe(
        Math.min(WRITING_METADATA_READ_CHUNK_BYTES, this.maxHeaderBytes)
      );
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let text = "";
      let complete = false;
      for (let position = 0; position < this.maxHeaderBytes; ) {
        if (this.deadlineExceeded(deadline)) return metadataDurationExceeded(this.traceId);
        const read = await handle.read(
          chunk,
          0,
          Math.min(chunk.byteLength, this.maxHeaderBytes - position),
          position
        );
        if (this.deadlineExceeded(deadline)) return metadataDurationExceeded(this.traceId);
        if (read.bytesRead === 0) break;
        for (let offset = 0; offset < read.bytesRead; offset += 1) {
          text += decoder.decode(chunk.subarray(offset, offset + 1), { stream: true });
          if (this.deadlineExceeded(deadline)) return metadataDurationExceeded(this.traceId);
          if (stopWhen(text)) {
            complete = true;
            break;
          }
        }
        if (complete) break;
        position += read.bytesRead;
      }
      if (!complete) {
        try {
          if (this.deadlineExceeded(deadline)) return metadataDurationExceeded(this.traceId);
          text += decoder.decode();
          if (this.deadlineExceeded(deadline)) return metadataDurationExceeded(this.traceId);
        } catch {
          return metadataError(this.traceId, "WORKSPACE_OUTLINE_METADATA_ENCODING_INVALID");
        }
      }
      if (this.deadlineExceeded(deadline)) return metadataDurationExceeded(this.traceId);
      const afterStats = await handle.stat();
      if (this.deadlineExceeded(deadline)) return metadataDurationExceeded(this.traceId);
      if (
        !hasSameFileIdentity(openedStats, afterStats) ||
        afterStats.size !== openedStats.size ||
        afterStats.mtimeMs !== openedStats.mtimeMs ||
        afterStats.ctimeMs !== openedStats.ctimeMs
      ) {
        return metadataError(this.traceId, "WORKSPACE_OUTLINE_METADATA_PATH_REJECTED");
      }
      return ok(text);
    } catch {
      return metadataError(this.traceId, "WORKSPACE_OUTLINE_METADATA_PATH_REJECTED");
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  private async resolveExisting(
    relativePath: string,
    deadline: MetadataReadDeadline
  ): Promise<Result<string | undefined, UnifiedError>> {
    if (this.deadlineExceeded(deadline)) return metadataDurationExceeded(this.traceId);
    const root = await this.assertRoot(deadline);
    if (!root.ok) return root;
    if (!isSafeRelativePath(relativePath)) {
      return metadataError(this.traceId, "WORKSPACE_OUTLINE_METADATA_PATH_REJECTED");
    }
    let current = root.value;
    try {
      for (const segment of relativePath.split("/")) {
        if (this.deadlineExceeded(deadline)) return metadataDurationExceeded(this.traceId);
        current = join(current, segment);
        const stats = await lstat(current);
        if (this.deadlineExceeded(deadline)) return metadataDurationExceeded(this.traceId);
        if (stats.isSymbolicLink()) {
          return metadataError(this.traceId, "WORKSPACE_OUTLINE_METADATA_PATH_REJECTED");
        }
        const canonical = await realpath(current);
        if (this.deadlineExceeded(deadline)) return metadataDurationExceeded(this.traceId);
        if (!isContained(root.value, canonical)) {
          return metadataError(this.traceId, "WORKSPACE_OUTLINE_METADATA_PATH_REJECTED");
        }
        current = canonical;
      }
      return ok(current);
    } catch (error) {
      return isNotFound(error)
        ? ok(undefined)
        : metadataError(this.traceId, "WORKSPACE_OUTLINE_METADATA_PATH_REJECTED");
    }
  }

  private async bindRoot(): Promise<Result<string, UnifiedError>> {
    if (!isAbsolute(this.options.projectRoot)) {
      return metadataError(this.traceId, "WORKSPACE_OUTLINE_METADATA_ROOT_REJECTED");
    }
    try {
      const stats = await lstat(this.options.projectRoot);
      const canonical = await realpath(this.options.projectRoot);
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        return metadataError(this.traceId, "WORKSPACE_OUTLINE_METADATA_ROOT_REJECTED");
      }
      return ok(canonical);
    } catch {
      return metadataError(this.traceId, "WORKSPACE_OUTLINE_METADATA_ROOT_REJECTED");
    }
  }

  private async assertRoot(deadline?: MetadataReadDeadline): Promise<Result<string, UnifiedError>> {
    if (deadline !== undefined && this.deadlineExceeded(deadline)) {
      return metadataDurationExceeded(this.traceId);
    }
    const bound = await this.canonicalRoot;
    if (deadline !== undefined && this.deadlineExceeded(deadline)) {
      return metadataDurationExceeded(this.traceId);
    }
    if (!bound.ok) return bound;
    try {
      const stats = await lstat(this.options.projectRoot);
      if (deadline !== undefined && this.deadlineExceeded(deadline)) {
        return metadataDurationExceeded(this.traceId);
      }
      const current = await realpath(this.options.projectRoot);
      if (deadline !== undefined && this.deadlineExceeded(deadline)) {
        return metadataDurationExceeded(this.traceId);
      }
      if (!stats.isDirectory() || stats.isSymbolicLink() || !samePath(bound.value, current)) {
        return metadataError(this.traceId, "WORKSPACE_OUTLINE_METADATA_ROOT_REJECTED");
      }
      return ok(bound.value);
    } catch {
      return metadataError(this.traceId, "WORKSPACE_OUTLINE_METADATA_ROOT_REJECTED");
    }
  }

  private createDeadline(
    limits: WorkspaceOutlineWritingMetadataReadLimits | undefined
  ): MetadataReadDeadline {
    return {
      startedAt: this.now(),
      maxDurationMs: normalizeMetadataReadDuration(limits?.maxDurationMs)
    };
  }

  private deadlineExceeded(deadline: MetadataReadDeadline): boolean {
    return this.now() - deadline.startedAt >= deadline.maxDurationMs;
  }
}

export interface WorkspaceOutlineIndexRepositoryOptions {
  readonly engineeringEntries?: WorkspaceOutlineGuardedEntryReader;
  readonly writingMetadata?: WorkspaceOutlineWritingMetadataReader;
  /** Injectable for deterministic duration-cap tests. */
  readonly now?: () => number;
}

interface WorkspaceOutlineIndexBase {
  readonly entries: readonly WorkspaceOutlineIndexEntry[];
  readonly limits: WorkspaceOutlineIndexLimits;
  readonly truncated: boolean;
  readonly truncationReasons: readonly WorkspaceOutlineIndexTruncationReason[];
  /** Null means the guarded source stopped before the exact omitted count was knowable. */
  readonly omittedEntryCount: number | null;
}

export interface WorkspaceOutlineEngineeringIndex extends WorkspaceOutlineIndexBase {
  readonly entrySetRevision: string;
  readonly entrySetChecksum: string;
}

export interface WorkspaceOutlineCreativeFileTreeIndex extends WorkspaceOutlineIndexBase {
  readonly treeRevision: string;
  readonly policyVersion: string;
  /** Paths and node kinds only. File checksums, node revisions, and file content are excluded. */
  readonly visibleNodeChecksum: string;
}

export interface WorkspaceOutlineWritingIndex extends WorkspaceOutlineIndexBase {
  readonly chapterIndexRevision: string;
  readonly chapterIndexChecksum: string;
  readonly storyBibleIndexRevision: string | null;
  readonly storyBibleIndexChecksum: string | null;
  readonly degradedDependencies: readonly ("chapters" | "story_bible")[];
  /** Sources that were not authoritatively classified because their bounded metadata read timed out. */
  readonly incompleteDependencies: readonly ("chapters" | "story_bible")[];
}

/**
 * Bounded metadata/index adapter used by Main's workspace outline reader. It does not read text
 * bodies. Engineering traversal consumes only a guarded directory-entry port; writing consumes
 * metadata-only index snapshots.
 */
export class WorkspaceOutlineIndexRepository {
  private readonly now: () => number;

  public constructor(private readonly options: WorkspaceOutlineIndexRepositoryOptions) {
    this.now = options.now ?? Date.now;
  }

  public async readEngineeringIndex(
    inputLimits: WorkspaceOutlineIndexLimits
  ): Promise<Result<WorkspaceOutlineEngineeringIndex, UnifiedError>> {
    const limits = normalizeWorkspaceOutlineIndexLimits(inputLimits);
    if (!limits.ok) return limits;
    const source = this.options.engineeringEntries;
    if (source === undefined) {
      return indexError({
        code: "WORKSPACE_OUTLINE_ENGINEERING_SOURCE_UNAVAILABLE",
        message: "The guarded engineering workspace metadata source is unavailable.",
        suggestedAction: "Reopen the engineering workspace before refreshing its outline."
      });
    }

    const startedAt = this.now();
    const budget = createBudget(limits.value, startedAt);
    const entries: WorkspaceOutlineIndexEntry[] = [];
    const dependencyEntries: WorkspaceOutlineIndexEntry[] = [];
    let omittedEntryCount = 0;
    let sourceFailure: UnifiedError | undefined;

    const visit = async (relativeDirectory: string): Promise<void> => {
      if (sourceFailure !== undefined || budget.stopped) return;
      if (durationExceeded(budget, this.now)) {
        budget.reasons.add("max_duration");
        budget.stopped = true;
        return;
      }

      const elapsed = this.now() - startedAt;
      const listed = await source.listEntries(relativeDirectory, {
        maxEntries: Math.max(0, limits.value.maxScannedEntries - budget.scannedEntries),
        maxBytes: Math.max(0, limits.value.maxBytes - budget.scannedBytes),
        maxDurationMs: Math.max(0, limits.value.maxDurationMs - elapsed)
      });
      if (!listed.ok) {
        sourceFailure = listed.error;
        return;
      }
      budget.scannedEntries += listed.value.scannedEntries;
      budget.scannedBytes += listed.value.scannedBytes;
      for (const reason of listed.value.truncationReasons) budget.reasons.add(reason);
      if (listed.value.truncationReasons.length > 0) budget.stopped = true;

      for (const candidate of listed.value.entries) {
        if (sourceFailure !== undefined) return;
        if (durationExceeded(budget, this.now)) {
          budget.reasons.add("max_duration");
          budget.stopped = true;
          return;
        }
        const normalized = normalizeGuardedEntry(candidate, relativeDirectory);
        if (normalized === undefined) {
          sourceFailure = createIndexError({
            code: "WORKSPACE_OUTLINE_ENGINEERING_ENTRY_INVALID",
            message: "The guarded engineering metadata source returned an invalid entry.",
            suggestedAction: "Refresh the workspace after removing unsafe redirected paths."
          });
          return;
        }
        if (isBlockedEngineeringRoot(normalized.relativePath)) continue;
        const depth = normalized.relativePath.split("/").length;
        if (depth > limits.value.maxDepth) {
          budget.reasons.add("max_depth");
          continue;
        }
        const pathEntry = toPathEntry(
          "engineering",
          normalized.relativePath,
          normalized.kind,
          depth
        );
        dependencyEntries.push(pathEntry);
        if (entries.length >= limits.value.maxEntries) {
          budget.reasons.add("max_entries");
          omittedEntryCount += 1;
        } else {
          entries.push(pathEntry);
        }
        if (normalized.kind !== "directory") continue;
        if (depth >= limits.value.maxDepth) {
          // A bounded outline deliberately does not descend beyond this directory. Marking this
          // conservatively preserves the fact that a deeper structure may need a JIT listing.
          budget.reasons.add("max_depth");
          continue;
        }
        await visit(normalized.relativePath);
      }
    };

    await visit("");
    if (sourceFailure !== undefined) return err(sourceFailure);

    const entrySetChecksum = checksum(
      dependencyEntries.map((entry) => ({ relativePath: entry.relativePath, kind: entry.kind }))
    );
    const reasons = frozenReasons(budget.reasons);
    return ok({
      entries: Object.freeze(entries),
      limits: limits.value,
      truncated: reasons.length > 0,
      truncationReasons: reasons,
      omittedEntryCount: budget.stopped ? null : omittedEntryCount,
      entrySetChecksum,
      entrySetRevision: `engineering_entries:${entrySetChecksum.slice(0, 32)}`
    });
  }

  public async readWritingIndexes(
    inputLimits: WorkspaceOutlineIndexLimits
  ): Promise<Result<WorkspaceOutlineWritingIndex, UnifiedError>> {
    const limits = normalizeWorkspaceOutlineIndexLimits(inputLimits);
    if (!limits.ok) return limits;
    const startedAt = this.now();
    const budget = createBudget(limits.value, startedAt);

    let chapters: WorkspaceOutlineChapterIndexSnapshot | undefined;
    let storyBible: WorkspaceOutlineStoryBibleIndexSnapshot | undefined;
    let chapterReadCompleted = false;
    let storyBibleReadCompleted = false;
    if (this.options.writingMetadata !== undefined && !durationExceeded(budget, this.now)) {
      const chapterResult = await this.options.writingMetadata.readChapterIndex({
        maxDurationMs: remainingDuration(budget, this.now)
      });
      if (!chapterResult.ok) {
        if (isMetadataDurationExceeded(chapterResult.error)) {
          budget.reasons.add("max_duration");
          budget.stopped = true;
        } else {
          return chapterResult;
        }
      } else {
        chapters = chapterResult.value;
        chapterReadCompleted = true;
      }

      if (!budget.stopped && !durationExceeded(budget, this.now)) {
        const storyBibleResult = await this.options.writingMetadata.readStoryBibleIndex({
          maxDurationMs: remainingDuration(budget, this.now)
        });
        if (!storyBibleResult.ok) {
          if (isMetadataDurationExceeded(storyBibleResult.error)) {
            budget.reasons.add("max_duration");
            budget.stopped = true;
          } else {
            return storyBibleResult;
          }
        } else {
          storyBible = storyBibleResult.value;
          storyBibleReadCompleted = true;
        }
      }
    }
    if (durationExceeded(budget, this.now)) budget.reasons.add("max_duration");

    let normalizedChapters:
      | {
          readonly revision: string;
          readonly entries: readonly WorkspaceOutlineChapterIndexEntry[];
        }
      | undefined;
    if (chapters !== undefined) {
      const normalized = normalizeChapterIndex(chapters);
      if (!normalized.ok) return normalized;
      normalizedChapters = normalized.value;
    }
    let normalizedStoryBible:
      | {
          readonly revision: string;
          readonly entries: readonly WorkspaceOutlineStoryBibleIndexEntry[];
        }
      | undefined;
    if (storyBible !== undefined) {
      const normalized = normalizeStoryBibleIndex(storyBible);
      if (!normalized.ok) return normalized;
      normalizedStoryBible = normalized.value;
    }

    const degradedDependencies: ("chapters" | "story_bible")[] = [];
    if (normalizedChapters === undefined) degradedDependencies.push("chapters");
    if (normalizedStoryBible === undefined) degradedDependencies.push("story_bible");
    const incompleteDependencies: ("chapters" | "story_bible")[] = [];
    if (budget.reasons.has("max_duration")) {
      if (!chapterReadCompleted) incompleteDependencies.push("chapters");
      if (!storyBibleReadCompleted) incompleteDependencies.push("story_bible");
    }

    const chapterIndexChecksum = checksum({
      kind: "chapters",
      status: normalizedChapters === undefined ? "missing" : "available",
      entries: normalizedChapters?.entries ?? []
    });
    const storyBibleIndexChecksum =
      normalizedStoryBible === undefined
        ? null
        : checksum({ kind: "story_bible", entries: normalizedStoryBible.entries });
    const candidates: WorkspaceOutlineIndexEntry[] = [
      ...(normalizedChapters?.entries.map((entry) => ({
        kind: "chapter" as const,
        id: entry.id,
        label: entry.title,
        ...(entry.relativePath === undefined ? {} : { relativePath: entry.relativePath }),
        ...(entry.wordCount === undefined ? {} : { wordCount: entry.wordCount })
      })) ?? []),
      ...(normalizedStoryBible?.entries.map((entry) => ({
        kind: "story_bible_asset" as const,
        id: entry.assetId,
        label: entry.title,
        assetType: entry.assetType,
        ...(entry.relativePath === undefined ? {} : { relativePath: entry.relativePath })
      })) ?? [])
    ];

    const entries = materializeBoundedEntries(candidates, budget, this.now);
    const reasons = frozenReasons(budget.reasons);
    return ok({
      entries: Object.freeze(entries),
      limits: limits.value,
      truncated: reasons.length > 0,
      truncationReasons: reasons,
      omittedEntryCount: reasons.length === 0 ? 0 : Math.max(0, candidates.length - entries.length),
      chapterIndexRevision: normalizedChapters?.revision ?? "chapters:missing",
      chapterIndexChecksum,
      storyBibleIndexRevision: normalizedStoryBible?.revision ?? null,
      storyBibleIndexChecksum,
      degradedDependencies: Object.freeze(degradedDependencies),
      incompleteDependencies: Object.freeze(incompleteDependencies)
    });
  }
}

/**
 * Builds a creative_general outline from the C1C snapshot only. No filesystem or repository call
 * occurs here. The exact same file policy is re-applied defensively so a malformed snapshot cannot
 * leak managed or internal paths into the prompt.
 */
export function buildCreativeProjectFileTreeOutlineIndex(input: {
  readonly snapshot: CreativeProjectFileTreeSnapshot;
  readonly policy: CreativeProjectFilePolicy;
  readonly limits: WorkspaceOutlineIndexLimits;
  readonly now?: () => number;
}): Result<WorkspaceOutlineCreativeFileTreeIndex, UnifiedError> {
  const policy = normalizeCreativeProjectFilePolicy(input.policy);
  if (!policy.ok) return policy;
  if (input.snapshot.policyVersion !== policy.value.schemaVersion) {
    return indexError({
      code: "WORKSPACE_OUTLINE_CREATIVE_POLICY_MISMATCH",
      message: "The creative file tree was produced by a different file policy version.",
      suggestedAction: "Refresh the creative project file tree before starting the Agent run."
    });
  }
  const limits = normalizeWorkspaceOutlineIndexLimits(input.limits);
  if (!limits.ok) return limits;

  const visible = collectVisibleCreativeNodes(input.snapshot.nodes, policy.value);
  const visibleNodeChecksum = checksum(
    visible.nodes.map((node) => ({ relativePath: node.path, type: node.kind }))
  );
  const now = input.now ?? Date.now;
  const budget = createBudget(limits.value, now());
  if (input.snapshot.truncated || visible.suppressedUnsafeNodes) {
    budget.reasons.add("source_truncated");
  }

  const candidates = visible.nodes.map((node) => {
    const depth = node.path.split("/").length;
    return toPathEntry("creative", node.path, node.kind, depth);
  });
  const entries = materializeBoundedEntries(candidates, budget, now);
  const reasons = frozenReasons(budget.reasons);
  return ok({
    entries: Object.freeze(entries),
    limits: limits.value,
    truncated: reasons.length > 0,
    truncationReasons: reasons,
    omittedEntryCount: reasons.length === 0 ? 0 : Math.max(0, candidates.length - entries.length),
    treeRevision: input.snapshot.treeRevision,
    policyVersion: policy.value.schemaVersion,
    visibleNodeChecksum
  });
}

/**
 * Limits are normalized in one place so every profile has the same ceiling. Main owns the input,
 * but the index still clamps structural limits defensively: engineering and creative directory
 * skeletons can never exceed depth two or two hundred visible entries.
 */
export function normalizeWorkspaceOutlineIndexLimits(
  input: WorkspaceOutlineIndexLimits
): Result<WorkspaceOutlineIndexLimits, UnifiedError> {
  for (const [field, value] of Object.entries(input)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      return indexError({
        code: "WORKSPACE_OUTLINE_LIMIT_INVALID",
        message: `The workspace outline ${field} limit is invalid.`,
        suggestedAction: "Use non-negative integer workspace outline limits."
      });
    }
  }
  return ok(
    Object.freeze({
      maxDepth: Math.min(input.maxDepth, WORKSPACE_OUTLINE_ENGINEERING_MAX_DEPTH),
      maxEntries: Math.min(input.maxEntries, WORKSPACE_OUTLINE_ENGINEERING_MAX_ENTRIES),
      maxScannedEntries: input.maxScannedEntries,
      maxBytes: input.maxBytes,
      maxDurationMs: input.maxDurationMs
    })
  );
}

function collectVisibleCreativeNodes(
  nodes: readonly CreativeProjectFileTreeNode[],
  policy: CreativeProjectFilePolicy
): {
  readonly nodes: readonly { readonly path: string; readonly kind: "directory" | "file" }[];
  readonly suppressedUnsafeNodes: boolean;
} {
  const visible: { path: string; kind: "directory" | "file" }[] = [];
  const seen = new Set<string>();
  let suppressedUnsafeNodes = false;

  const visit = (children: readonly CreativeProjectFileTreeNode[]): void => {
    for (const node of [...children].sort((left, right) => left.path.localeCompare(right.path))) {
      const normalized = normalizeCreativeProjectFilePath(node.path, node.kind, policy);
      if (
        !normalized.ok ||
        seen.has(`${node.kind}:${normalized.ok ? normalized.value : node.path}`)
      ) {
        suppressedUnsafeNodes = true;
        continue;
      }
      const path = normalized.value;
      seen.add(`${node.kind}:${path}`);
      visible.push({ path, kind: node.kind });
      if (node.kind === "directory") visit(node.children ?? []);
    }
  };

  visit(nodes);
  return {
    nodes: Object.freeze(
      visible.sort(
        (left, right) => left.path.localeCompare(right.path) || left.kind.localeCompare(right.kind)
      )
    ),
    suppressedUnsafeNodes
  };
}

function normalizeChapterIndex(snapshot: WorkspaceOutlineChapterIndexSnapshot): Result<
  {
    readonly revision: string;
    readonly entries: readonly WorkspaceOutlineChapterIndexEntry[];
  },
  UnifiedError
> {
  if (!isValidRevision(snapshot.revision)) return invalidWritingMetadata();
  const entries: WorkspaceOutlineChapterIndexEntry[] = [];
  const seen = new Set<string>();
  for (const entry of snapshot.entries) {
    const relativePath = normalizeWritingMetadataRelativePath(entry.relativePath);
    if (
      !isSafeMetadataString(entry.id) ||
      !isSafeMetadataString(entry.title) ||
      seen.has(entry.id) ||
      (entry.relativePath !== undefined && relativePath === undefined)
    ) {
      return invalidWritingMetadata();
    }
    if (
      entry.wordCount !== undefined &&
      (!Number.isSafeInteger(entry.wordCount) || entry.wordCount < 0)
    ) {
      return invalidWritingMetadata();
    }
    seen.add(entry.id);
    entries.push({
      id: entry.id,
      title: entry.title,
      ...(entry.wordCount === undefined ? {} : { wordCount: entry.wordCount }),
      ...(relativePath === undefined ? {} : { relativePath })
    });
  }
  return ok({
    revision: snapshot.revision,
    entries: Object.freeze(entries.sort((left, right) => left.id.localeCompare(right.id)))
  });
}

function normalizeStoryBibleIndex(snapshot: WorkspaceOutlineStoryBibleIndexSnapshot): Result<
  {
    readonly revision: string;
    readonly entries: readonly WorkspaceOutlineStoryBibleIndexEntry[];
  },
  UnifiedError
> {
  if (!isValidRevision(snapshot.revision)) return invalidWritingMetadata();
  const entries: WorkspaceOutlineStoryBibleIndexEntry[] = [];
  const seen = new Set<string>();
  for (const entry of snapshot.entries) {
    const relativePath = normalizeWritingMetadataRelativePath(entry.relativePath);
    if (
      !isSafeMetadataString(entry.assetId) ||
      !isSafeMetadataString(entry.title) ||
      !isSafeMetadataString(entry.assetType) ||
      seen.has(entry.assetId) ||
      (entry.relativePath !== undefined && relativePath === undefined)
    ) {
      return invalidWritingMetadata();
    }
    seen.add(entry.assetId);
    entries.push({
      assetId: entry.assetId,
      title: entry.title,
      assetType: entry.assetType,
      ...(relativePath === undefined ? {} : { relativePath })
    });
  }
  return ok({
    revision: snapshot.revision,
    entries: Object.freeze(entries.sort((left, right) => left.assetId.localeCompare(right.assetId)))
  });
}

function materializeBoundedEntries(
  candidates: readonly WorkspaceOutlineIndexEntry[],
  budget: TraversalBudget,
  now: () => number
): WorkspaceOutlineIndexEntry[] {
  const entries: WorkspaceOutlineIndexEntry[] = [];
  for (const candidate of candidates) {
    if (durationExceeded(budget, now)) {
      budget.reasons.add("max_duration");
      budget.stopped = true;
      break;
    }
    if (budget.scannedEntries >= budget.limits.maxScannedEntries) {
      budget.reasons.add("max_scanned_entries");
      budget.stopped = true;
      break;
    }
    budget.scannedEntries += 1;
    const bytes = entryMetadataBytes(candidate.kind, candidate.relativePath ?? candidate.id);
    if (budget.scannedBytes + bytes > budget.limits.maxBytes) {
      budget.reasons.add("max_bytes");
      budget.stopped = true;
      break;
    }
    budget.scannedBytes += bytes;
    if (candidate.depth !== undefined && candidate.depth > budget.limits.maxDepth) {
      budget.reasons.add("max_depth");
      continue;
    }
    if (entries.length >= budget.limits.maxEntries) {
      budget.reasons.add("max_entries");
      budget.stopped = true;
      break;
    }
    entries.push(candidate);
  }
  return entries;
}

function createBudget(limits: WorkspaceOutlineIndexLimits, startedAt: number): TraversalBudget {
  return {
    limits,
    startedAt,
    scannedEntries: 0,
    scannedBytes: 0,
    stopped: false,
    reasons: new Set<WorkspaceOutlineIndexTruncationReason>()
  };
}

interface TraversalBudget {
  readonly limits: WorkspaceOutlineIndexLimits;
  readonly startedAt: number;
  scannedEntries: number;
  scannedBytes: number;
  stopped: boolean;
  readonly reasons: Set<WorkspaceOutlineIndexTruncationReason>;
}

function durationExceeded(budget: TraversalBudget, now: () => number): boolean {
  return now() - budget.startedAt >= budget.limits.maxDurationMs;
}

function remainingDuration(budget: TraversalBudget, now: () => number): number {
  return Math.max(0, budget.limits.maxDurationMs - Math.max(0, now() - budget.startedAt));
}

function normalizeGuardedEntry(
  entry: {
    readonly name: string;
    readonly relativePath: string;
    readonly kind: "directory" | "file";
  },
  parent: string
): { readonly relativePath: string; readonly kind: "directory" | "file" } | undefined {
  if (
    !isSafePathSegment(entry.name) ||
    typeof entry.relativePath !== "string" ||
    (entry.kind !== "directory" && entry.kind !== "file")
  ) {
    return undefined;
  }
  const expected = parent.length === 0 ? entry.name : `${parent}/${entry.name}`;
  if (entry.relativePath !== expected || !isSafeRelativePath(entry.relativePath)) return undefined;
  return { relativePath: entry.relativePath, kind: entry.kind };
}

function sortGuardedEntries(
  entries: readonly {
    readonly name: string;
    readonly relativePath: string;
    readonly kind: "directory" | "file";
  }[]
) {
  return [...entries].sort(
    (left, right) =>
      left.name.localeCompare(right.name) ||
      left.kind.localeCompare(right.kind) ||
      left.relativePath.localeCompare(right.relativePath)
  );
}

function isBlockedEngineeringRoot(relativePath: string): boolean {
  const root = relativePath.split("/")[0];
  return root !== undefined && ENGINEERING_BLOCKED_ROOTS.has(root.toLocaleLowerCase());
}

function isSafeRelativePath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    !path.includes(":") &&
    path.split("/").every(isSafePathSegment)
  );
}

function normalizeWritingMetadataRelativePath(value: unknown): string | undefined {
  return typeof value === "string" && isSafeRelativePath(value) ? value : undefined;
}

function isSafePathSegment(segment: string): boolean {
  return (
    typeof segment === "string" &&
    segment.length > 0 &&
    segment !== "." &&
    segment !== ".." &&
    !segment.includes("/") &&
    !segment.includes("\\") &&
    !segment.includes("\0") &&
    !segment.includes(":") &&
    !DEVICE_NAME.test(segment)
  );
}

function toPathEntry(
  source: "engineering" | "creative",
  relativePath: string,
  kind: "directory" | "file",
  depth: number
): WorkspaceOutlineIndexEntry {
  return {
    kind,
    id: `${source}:${relativePath}`,
    label: relativePath.split("/").at(-1) ?? relativePath,
    relativePath,
    depth
  };
}

function entryMetadataBytes(kind: WorkspaceOutlineIndexEntry["kind"], value: string): number {
  return Buffer.byteLength(`${kind}\u0000${value}`, "utf8");
}

function frozenReasons(
  reasons: ReadonlySet<WorkspaceOutlineIndexTruncationReason>
): readonly WorkspaceOutlineIndexTruncationReason[] {
  return Object.freeze([...reasons].sort());
}

function isValidRevision(value: string): boolean {
  return (
    typeof value === "string" && value.length > 0 && value.length <= 512 && !value.includes("\0")
  );
}

function isSafeMetadataString(value: unknown): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= 2_048 && !value.includes("\0")
  );
}

function invalidWritingMetadata(): Result<never, UnifiedError> {
  return indexError({
    code: "WORKSPACE_OUTLINE_WRITING_METADATA_INVALID",
    message: "The writing metadata index is invalid.",
    suggestedAction: "Refresh the project metadata before starting the Agent run."
  });
}

function indexError<T = never>(input: {
  readonly code: string;
  readonly message: string;
  readonly suggestedAction: string;
}): Result<T, UnifiedError> {
  return err(createIndexError(input));
}

function createIndexError(input: {
  readonly code: string;
  readonly message: string;
  readonly suggestedAction: string;
}): UnifiedError {
  return createUnifiedError({
    code: input.code,
    category: "ValidationError",
    message: input.message,
    recoverability: "user-action",
    suggestedAction: input.suggestedAction,
    traceId: "workspace-outline-index-repository"
  });
}

function metadataError<T = never>(traceId: string, code: string): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code,
      category: "StorageError",
      message: "Workspace writing metadata could not be read safely.",
      recoverability: "user-action",
      suggestedAction: "Reopen the project and remove redirected or invalid metadata paths.",
      traceId
    })
  );
}

function metadataDurationExceeded<T = never>(traceId: string): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "WORKSPACE_OUTLINE_METADATA_DURATION_EXCEEDED",
      category: "StorageError",
      message: "Workspace writing metadata exceeded the outline time limit.",
      recoverability: "user-action",
      suggestedAction: "Refresh the workspace outline or reduce the metadata read scope.",
      traceId
    })
  );
}

function isMetadataDurationExceeded(error: UnifiedError): boolean {
  return error.code === "WORKSPACE_OUTLINE_METADATA_DURATION_EXCEEDED";
}

function entryMetadataError<T = never>(traceId: string): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "WORKSPACE_OUTLINE_ENGINEERING_PATH_REJECTED",
      category: "StorageError",
      message: "Engineering workspace metadata could not be listed safely.",
      recoverability: "user-action",
      suggestedAction: "Reopen the workspace and remove redirected project paths.",
      traceId
    })
  );
}

function positiveLimit(value: number | undefined, fallback: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value === undefined || value <= 0) return fallback;
  return Math.min(value, maximum);
}

function normalizeMetadataReadDuration(value: number | undefined): number {
  return Number.isSafeInteger(value) && value !== undefined && value >= 0
    ? value
    : DEFAULT_WRITING_METADATA_MAX_DURATION_MS;
}

function parseChapterFrontmatter(text: string): WorkspaceOutlineChapterIndexEntry | undefined {
  const source = text.startsWith("\ufeff") ? text.slice(1) : text;
  const opening = /^---\r?\n/u.exec(source);
  if (opening === null) return undefined;
  const closing = /\r?\n---(?:\r?\n|$)/gu;
  closing.lastIndex = opening[0].length;
  const closingMatch = closing.exec(source);
  if (closingMatch === null || closingMatch.index < opening[0].length) return undefined;
  try {
    const document = loadYaml(source.slice(opening[0].length, closingMatch.index));
    if (!isRecord(document)) return undefined;
    const id = document["id"];
    const title = document["title"];
    const wordCount = document["wordCount"];
    if (!isSafeMetadataString(id) || !isSafeMetadataString(title)) return undefined;
    if (
      wordCount !== undefined &&
      (typeof wordCount !== "number" || !Number.isSafeInteger(wordCount) || wordCount < 0)
    ) {
      return undefined;
    }
    return {
      id,
      title,
      ...(wordCount === undefined ? {} : { wordCount })
    };
  } catch {
    return undefined;
  }
}

function hasCompleteChapterFrontmatter(text: string): boolean {
  const source = text.startsWith("\ufeff") ? text.slice(1) : text;
  const opening = /^---\r?\n/u.exec(source);
  if (opening === null) return false;
  const closing = /\r?\n---(?:\r?\n|$)/gu;
  closing.lastIndex = opening[0].length;
  return closing.exec(source) !== null;
}

function parseStoryBibleAssetHeader(
  text: string
): WorkspaceOutlineStoryBibleIndexEntry | undefined {
  const values = extractTopLevelJsonStrings(text, ["id", "title", "type"]);
  const id = values?.["id"];
  const title = values?.["title"];
  const type = values?.["type"];
  if (
    values === undefined ||
    !isSafeMetadataString(id) ||
    !isSafeMetadataString(title) ||
    !isSafeMetadataString(type)
  ) {
    return undefined;
  }
  return {
    assetId: id,
    title,
    assetType: type
  };
}

function hasStoryBibleAssetHeader(text: string): boolean {
  return parseStoryBibleAssetHeader(text) !== undefined;
}

/**
 * Extracts selected string-valued fields from a JSON object prefix. It stops as soon as every
 * requested field is found, so normal Story Bible records never require their summary/details body
 * to be decoded. A prefix without all fields is rejected rather than falling back to a full read.
 */
function extractTopLevelJsonStrings(
  text: string,
  required: readonly string[]
): Readonly<Record<string, string>> | undefined {
  const wanted = new Set(required);
  const result: Record<string, string> = {};
  let cursor = skipJsonWhitespace(text, 0);
  if (text[cursor] !== "{") return undefined;
  cursor += 1;

  while (cursor < text.length) {
    cursor = skipJsonWhitespace(text, cursor);
    if (text[cursor] === "}") break;
    const key = readJsonString(text, cursor);
    if (key === undefined) return undefined;
    cursor = skipJsonWhitespace(text, key.end);
    if (text[cursor] !== ":") return undefined;
    cursor = skipJsonWhitespace(text, cursor + 1);
    // Story Bible body fields are intentionally never scanned just to discover later metadata.
    // Valid project assets write id/type/title before these fields; unusual ordering degrades
    // audibly instead of reading summary/details content.
    if (
      (key.value === "summary" || key.value === "details") &&
      !required.every((field) => result[field] !== undefined)
    ) {
      return undefined;
    }
    const value = readJsonValue(text, cursor);
    if (value === undefined) return undefined;
    if (wanted.has(key.value) && value.kind === "string") result[key.value] = value.value;
    if (required.every((field) => result[field] !== undefined)) return result;
    cursor = skipJsonWhitespace(text, value.end);
    if (text[cursor] === ",") {
      cursor += 1;
      continue;
    }
    if (text[cursor] === "}") break;
    return undefined;
  }
  return required.every((field) => result[field] !== undefined) ? result : undefined;
}

function readJsonValue(
  text: string,
  start: number
):
  | { readonly kind: "string"; readonly value: string; readonly end: number }
  | { readonly kind: "other"; readonly end: number }
  | undefined {
  if (text[start] === '"') {
    const string = readJsonString(text, start);
    return string === undefined
      ? undefined
      : { kind: "string", value: string.value, end: string.end };
  }
  if (text[start] === "{" || text[start] === "[") {
    const end = skipJsonCompoundValue(text, start);
    return end === undefined ? undefined : { kind: "other", end };
  }
  let cursor = start;
  while (cursor < text.length && !/[\s,}\]]/u.test(text[cursor] ?? "")) cursor += 1;
  return cursor === start ? undefined : { kind: "other", end: cursor };
}

function readJsonString(
  text: string,
  start: number
): { readonly value: string; readonly end: number } | undefined {
  if (text[start] !== '"') return undefined;
  let cursor = start + 1;
  while (cursor < text.length) {
    const current = text[cursor];
    if (current === "\\") {
      cursor += 1;
      if (cursor >= text.length) return undefined;
      if (text[cursor] === "u") {
        cursor += 4;
        if (cursor >= text.length) return undefined;
      }
      cursor += 1;
      continue;
    }
    if (current === '"') {
      try {
        const value = JSON.parse(text.slice(start, cursor + 1));
        return typeof value === "string" ? { value, end: cursor + 1 } : undefined;
      } catch {
        return undefined;
      }
    }
    const codePoint = current?.codePointAt(0);
    if (codePoint !== undefined && codePoint < 0x20) return undefined;
    cursor += 1;
  }
  return undefined;
}

function skipJsonCompoundValue(text: string, start: number): number | undefined {
  let cursor = start;
  let depth = 0;
  while (cursor < text.length) {
    const current = text[cursor];
    if (current === '"') {
      const string = readJsonString(text, cursor);
      if (string === undefined) return undefined;
      cursor = string.end;
      continue;
    }
    if (current === "{" || current === "[") depth += 1;
    if (current === "}" || current === "]") {
      depth -= 1;
      if (depth === 0) return cursor + 1;
      if (depth < 0) return undefined;
    }
    cursor += 1;
  }
  return undefined;
}

function skipJsonWhitespace(text: string, start: number): number {
  let cursor = start;
  while (/\s/u.test(text[cursor] ?? "")) cursor += 1;
  return cursor;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNotFound(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function isContained(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return (
    relativePath.length === 0 ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
      !isAbsolute(relativePath))
  );
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLocaleLowerCase() === right.toLocaleLowerCase()
    : left === right;
}

function hasVerifiedFileIdentity(stats: Stats): boolean {
  return stats.dev !== 0 && stats.ino !== 0 && stats.isFile();
}

function hasSameFileIdentity(left: Stats, right: Stats): boolean {
  return (
    hasVerifiedFileIdentity(left) &&
    hasVerifiedFileIdentity(right) &&
    left.dev === right.dev &&
    left.ino === right.ino
  );
}

function checksum(value: unknown): string {
  return createHash("sha256").update(stableSerialize(value), "utf8").digest("hex");
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
  return JSON.stringify(value) ?? "null";
}
