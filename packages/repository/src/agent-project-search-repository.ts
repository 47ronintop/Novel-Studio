import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { extname, isAbsolute, join, relative } from "node:path";

import { err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import { storageError, validationError } from "./errors.js";
import { SearchIndexFileRepository } from "./search-index-repository.js";

// Hard limits for search queries
const MAX_QUERY_LENGTH = 1024;
const MAX_GLOB_LENGTH = 512;
const MAX_GLOB_COUNT = 32;
const MAX_RESULTS_HARD_LIMIT = 200;
const MAX_SNIPPET_BYTES = 512;
const MAX_TOTAL_RESULT_BYTES = 256 * 1024;
const MAX_FILE_SIZE_BYTES = 1024 * 1024; // 1 MB

/** Blocked directory roots for engineering workspace traversal. */
const blockedRoots = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".cache",
  ".novel-studio",
  "history",
  ".svn",
  ".hg",
  "__pycache__",
  ".next",
  ".nuxt",
  "coverage",
  ".nyc_output"
]);

/** Extensions considered binary / not searchable. */
const binaryExtensions = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar",
  ".exe", ".dll", ".so", ".dylib", ".bin",
  ".mp3", ".mp4", ".avi", ".mov", ".mkv",
  ".woff", ".woff2", ".eot", ".ttf", ".otf",
  ".pyc", ".class", ".o", ".a",
  ".db", ".sqlite", ".sqlite3"
]);

const windowsDeviceNames = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export interface AgentSearchResultRange {
  readonly unit: "utf16_offset" | "line_column";
  readonly start: number;
  readonly end: number;
}

export interface AgentSearchResult {
  readonly relativePath: string;
  readonly stableRef: string;
  readonly range: AgentSearchResultRange;
  readonly snippet: string;
  readonly sourceChecksum: string;
  readonly resultDigest: string;
  readonly truncated: boolean;
}

export interface AgentSearchResults {
  readonly kind: "search_results";
  readonly items: readonly AgentSearchResult[];
  readonly totalHits: number;
  readonly truncated: boolean;
  readonly indexVersion: string;
}

export interface AgentProjectSearchRepositoryOptions {
  readonly projectRoot: string;
  readonly workspaceKind: "creativeProject" | "engineeringWorkspace";
  readonly traceId?: string;
  /** For creative projects — reuse existing search index repository. */
  readonly searchIndexRepository?: SearchIndexFileRepository;
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function resultDigestFor(
  relativePath: string,
  rangeStart: number,
  rangeEnd: number,
  snippet: string
): string {
  return sha256(`${relativePath}:${rangeStart}:${rangeEnd}:${snippet}`);
}

function truncateSnippet(text: string, maxBytes = MAX_SNIPPET_BYTES): string {
  const encoded = new TextEncoder().encode(text);
  if (encoded.byteLength <= maxBytes) return text;
  return text.slice(0, maxBytes) + "…";
}

function extractSnippetWithLineRange(
  content: string,
  lineIndex: number
): { snippet: string; start: number; end: number } {
  const lines = content.split("\n");
  const contextLines = 2;
  const startIdx = Math.max(0, lineIndex - contextLines);
  const endIdx = Math.min(lines.length - 1, lineIndex + contextLines);
  const snippet = lines.slice(startIdx, endIdx + 1).join("\n");
  return {
    snippet: truncateSnippet(snippet),
    start: startIdx + 1,
    end: endIdx + 1
  };
}

function matchesGlob(relativePath: string, pattern: string): boolean {
  if (pattern.includes("..") || isAbsolute(pattern)) return false;
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "___DOUBLESTAR___")
    .replace(/\*/g, "[^/]*")
    .replace(/___DOUBLESTAR___/g, ".*");
  try {
    return new RegExp(`^${escaped}$`).test(relativePath);
  } catch {
    return false;
  }
}

function matchesGlobs(
  relativePath: string,
  includeGlobs: readonly string[] | undefined,
  excludeGlobs: readonly string[] | undefined
): boolean {
  if (includeGlobs !== undefined && includeGlobs.length > 0) {
    if (!includeGlobs.some((glob) => matchesGlob(relativePath, glob))) return false;
  }
  if (excludeGlobs !== undefined && excludeGlobs.length > 0) {
    if (excludeGlobs.some((glob) => matchesGlob(relativePath, glob))) return false;
  }
  return true;
}

export class AgentProjectSearchRepository {
  private readonly traceId: string;
  private readonly canonicalRoot: Promise<string>;

  public constructor(private readonly options: AgentProjectSearchRepositoryOptions) {
    this.traceId = options.traceId ?? "agent-project-search-repository";
    this.canonicalRoot = realpath(options.projectRoot);
  }

  public async searchText(input: {
    readonly query: string;
    readonly includeGlobs?: readonly string[];
    readonly excludeGlobs?: readonly string[];
    readonly maxResults?: number;
    readonly signal?: AbortSignal;
  }): Promise<Result<AgentSearchResults, UnifiedError>> {
    if (input.query.length === 0 || input.query.length > MAX_QUERY_LENGTH) {
      return err(
        validationError({
          code: "AGENT_SEARCH_QUERY_INVALID",
          message: "Search query must be between 1 and 1024 characters.",
          suggestedAction: "Provide a non-empty query within the character limit.",
          traceId: this.traceId
        })
      );
    }

    const includeGlobs = input.includeGlobs?.slice(0, MAX_GLOB_COUNT);
    const excludeGlobs = input.excludeGlobs?.slice(0, MAX_GLOB_COUNT);
    for (const glob of [...(includeGlobs ?? []), ...(excludeGlobs ?? [])]) {
      const globSegments = glob.split("/");
      const hasDeviceName = globSegments.some((seg) => windowsDeviceNames.test(seg));
      if (
        glob.length > MAX_GLOB_LENGTH ||
        glob.includes("..") ||
        isAbsolute(glob) ||
        hasDeviceName
      ) {
        return err(
          validationError({
            code: "AGENT_SEARCH_GLOB_INVALID",
            message: "Search glob pattern is invalid.",
            suggestedAction: "Use a simple glob pattern without traversal.",
            traceId: this.traceId
          })
        );
      }
    }

    const maxResults = Math.min(input.maxResults ?? 50, MAX_RESULTS_HARD_LIMIT);

    if (this.options.workspaceKind === "creativeProject") {
      return this.searchCreativeProject(input.query, maxResults, includeGlobs, excludeGlobs);
    }
    return this.searchEngineeringWorkspace(
      input.query,
      maxResults,
      includeGlobs,
      excludeGlobs,
      input.signal
    );
  }

  public async findReferences(input: {
    readonly stableRef: string;
    readonly signal?: AbortSignal;
  }): Promise<Result<AgentSearchResults, UnifiedError>> {
    const ref = input.stableRef;
    if (
      ref.length === 0 ||
      ref.length > MAX_QUERY_LENGTH ||
      ref.includes("..") ||
      ref.includes("\\") ||
      isAbsolute(ref) ||
      windowsDeviceNames.test(ref.split("/").at(-1) ?? ref)
    ) {
      return err(
        validationError({
          code: "AGENT_SEARCH_REF_INVALID",
          message: "The stable reference is invalid.",
          suggestedAction: "Use a valid project-relative path or stable asset ID.",
          traceId: this.traceId
        })
      );
    }

    const baseName = ref.split("/").at(-1) ?? ref;
    const signalOpt = input.signal === undefined ? {} : { signal: input.signal };
    return this.searchText({ query: baseName, maxResults: MAX_RESULTS_HARD_LIMIT, ...signalOpt });
  }

  private async searchCreativeProject(
    query: string,
    maxResults: number,
    includeGlobs: readonly string[] | undefined,
    excludeGlobs: readonly string[] | undefined
  ): Promise<Result<AgentSearchResults, UnifiedError>> {
    const searchRepo =
      this.options.searchIndexRepository ??
      new SearchIndexFileRepository({
        projectRoot: this.options.projectRoot,
        traceId: this.traceId
      });

    const searchResult = await searchRepo.search({ query, limit: maxResults });
    if (!searchResult.ok) return searchResult;

    const items: AgentSearchResult[] = [];
    let totalBytes = 0;
    let truncated = false;

    for (const item of searchResult.value.results) {
      const rp = item.sourceRef.relativePath;
      if (!matchesGlobs(rp, includeGlobs, excludeGlobs)) continue;

      const snippet = truncateSnippet(item.snippet);
      const snippetBytes = new TextEncoder().encode(snippet).byteLength;
      if (totalBytes + snippetBytes > MAX_TOTAL_RESULT_BYTES) {
        truncated = true;
        break;
      }
      totalBytes += snippetBytes;

      const sourceChecksum = sha256(item.id);
      items.push({
        relativePath: rp,
        stableRef: item.sourceRef.id,
        range: { unit: "line_column", start: 1, end: 1 },
        snippet,
        sourceChecksum,
        resultDigest: resultDigestFor(rp, 1, 1, snippet),
        truncated: false
      });

      if (items.length >= maxResults) {
        truncated = searchResult.value.results.length > maxResults;
        break;
      }
    }

    return ok({
      kind: "search_results",
      items: Object.freeze(items),
      totalHits: searchResult.value.results.length,
      truncated,
      indexVersion: "1.0"
    });
  }

  private async searchEngineeringWorkspace(
    query: string,
    maxResults: number,
    includeGlobs: readonly string[] | undefined,
    excludeGlobs: readonly string[] | undefined,
    signal?: AbortSignal
  ): Promise<Result<AgentSearchResults, UnifiedError>> {
    let canonicalRoot: string;
    try {
      canonicalRoot = await this.canonicalRoot;
    } catch {
      return err(
        storageError({
          code: "AGENT_SEARCH_ROOT_UNAVAILABLE",
          message: "The project root could not be resolved.",
          suggestedAction: "Ensure the project root directory exists.",
          traceId: this.traceId
        })
      );
    }

    const items: AgentSearchResult[] = [];
    const state = { totalBytes: 0, totalHits: 0, truncated: false };

    await this.traverseDirectory(
      canonicalRoot,
      canonicalRoot,
      query.toLowerCase(),
      includeGlobs,
      excludeGlobs,
      maxResults,
      items,
      state,
      signal
    );

    const sorted = [...items].sort((a, b) => {
      const pathCmp = a.relativePath.localeCompare(b.relativePath);
      return pathCmp !== 0 ? pathCmp : a.range.start - b.range.start;
    });

    return ok({
      kind: "search_results",
      items: Object.freeze(sorted),
      totalHits: state.totalHits,
      truncated: state.truncated,
      indexVersion: "1.1"
    });
  }

  private async traverseDirectory(
    dirPath: string,
    canonicalRoot: string,
    queryLower: string,
    includeGlobs: readonly string[] | undefined,
    excludeGlobs: readonly string[] | undefined,
    maxResults: number,
    items: AgentSearchResult[],
    state: { totalBytes: number; totalHits: number; truncated: boolean },
    signal?: AbortSignal
  ): Promise<void> {
    if (signal?.aborted || state.truncated) return;

    let entries;
    try {
      entries = await readdir(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (signal?.aborted || state.truncated) break;
      if (entry.isSymbolicLink() || windowsDeviceNames.test(entry.name)) continue;

      const fullPath = join(dirPath, entry.name);
      const entryRelative = relative(canonicalRoot, fullPath).replaceAll("\\", "/");

      if (entry.isDirectory()) {
        if (blockedRoots.has(entry.name.toLowerCase())) continue;
        await this.traverseDirectory(
          fullPath,
          canonicalRoot,
          queryLower,
          includeGlobs,
          excludeGlobs,
          maxResults,
          items,
          state,
          signal
        );
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (binaryExtensions.has(ext)) continue;
        if (!matchesGlobs(entryRelative, includeGlobs, excludeGlobs)) continue;

        let fileStat;
        try {
          fileStat = await lstat(fullPath);
        } catch {
          continue;
        }
        if (fileStat.isSymbolicLink() || fileStat.size > MAX_FILE_SIZE_BYTES) continue;

        let bytes: Uint8Array;
        let content: string;
        try {
          bytes = await readFile(fullPath);
          content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch {
          continue;
        }
        if (content.includes("\0")) continue;

        const sourceChecksum = sha256Bytes(bytes);
        const lines = content.split("\n");

        for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
          if (!lines[lineIdx]?.toLowerCase().includes(queryLower)) continue;

          state.totalHits++;
          if (items.length >= maxResults) {
            state.truncated = true;
            break;
          }

          const { snippet, start, end } = extractSnippetWithLineRange(content, lineIdx);
          const snippetBytes = new TextEncoder().encode(snippet).byteLength;
          if (state.totalBytes + snippetBytes > MAX_TOTAL_RESULT_BYTES) {
            state.truncated = true;
            break;
          }
          state.totalBytes += snippetBytes;

          items.push({
            relativePath: entryRelative,
            stableRef: entryRelative,
            range: { unit: "line_column", start, end },
            snippet,
            sourceChecksum,
            resultDigest: resultDigestFor(entryRelative, start, end, snippet),
            truncated: false
          });
        }
        if (state.truncated) break;
      }
    }
  }
}
