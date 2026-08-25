import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, open, readdir, realpath, type FileHandle } from "node:fs/promises";
import { extname, isAbsolute, join, relative } from "node:path";

import { err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import {
  DEFAULT_CREATIVE_PROJECT_FILE_POLICY,
  normalizeCreativeProjectFilePath,
  normalizeCreativeProjectFilePolicy,
  type CreativeProjectFilePolicy
} from "./creative-project-file-repository.js";
import { storageError, validationError } from "./errors.js";
import { SearchIndexFileRepository, type SearchSourceRef } from "./search-index-repository.js";

// Hard limits for search queries
const MAX_QUERY_LENGTH = 1024;
const MAX_GLOB_LENGTH = 512;
const MAX_GLOB_COUNT = 32;
const MAX_RESULTS_HARD_LIMIT = 200;
const MAX_SNIPPET_BYTES = 512;
const MAX_TOTAL_RESULT_BYTES = 256 * 1024;
const MAX_FILE_SIZE_BYTES = 1024 * 1024; // 1 MB
const MAX_DIRECTORIES = 2_000;
const MAX_FILES = 10_000;
const MAX_TOTAL_SCANNED_BYTES = 16 * 1024 * 1024;
const SEARCH_DEADLINE_MS = 5_000;

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

/** Text formats that are safe and useful for engineering search. */
const searchableTextExtensions = new Set([
  ".astro",
  ".bash",
  ".c",
  ".cc",
  ".cjs",
  ".conf",
  ".cpp",
  ".cs",
  ".css",
  ".cts",
  ".cxx",
  ".fs",
  ".fsx",
  ".go",
  ".gql",
  ".graphql",
  ".h",
  ".hpp",
  ".htm",
  ".html",
  ".ini",
  ".java",
  ".js",
  ".json",
  ".jsonc",
  ".jsx",
  ".kt",
  ".kts",
  ".less",
  ".md",
  ".mdx",
  ".mjs",
  ".mts",
  ".php",
  ".prisma",
  ".proto",
  ".ps1",
  ".py",
  ".rb",
  ".rs",
  ".sass",
  ".scss",
  ".sh",
  ".svelte",
  ".sql",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".vue",
  ".xml",
  ".yaml",
  ".yml",
  ".zsh"
]);

const searchableExtensionlessNames = new Set([
  ".editorconfig",
  ".eslintrc",
  ".gitattributes",
  ".gitignore",
  ".prettierrc",
  "changelog",
  "codeowners",
  "contributing",
  "dockerfile",
  "license",
  "makefile",
  "readme"
]);

/** Names conventionally used for secrets, credentials, or private keys. */
const sensitiveFileNames = new Set([
  ".authinfo",
  ".gitconfig",
  ".netrc",
  ".npmrc",
  ".pypirc",
  "credentials",
  "credential",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "id_rsa",
  "secrets",
  "secret"
]);

const sensitiveFileSuffixes = [".key", ".pem", ".p12", ".pfx"];

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

export interface AgentPathDiscoveryItem {
  readonly relativePath: string;
  readonly entryKind: "file" | "directory";
  readonly stableRef?: string;
  readonly mutationRef?: string;
}

export interface AgentPathDiscoveryResults {
  readonly kind: "path_results";
  readonly items: readonly AgentPathDiscoveryItem[];
  readonly nextCursor: string | null;
  readonly truncated: boolean;
  readonly indexVersion: string;
}

export interface AgentProjectSearchRepositoryOptions {
  readonly projectRoot: string;
  readonly workspaceKind: "creativeProject" | "engineeringWorkspace";
  readonly traceId?: string;
  /** For creative projects — reuse existing search index repository. */
  readonly searchIndexRepository?: SearchIndexFileRepository;
  /** When present, search only user-owned creative files allowed by this policy. */
  readonly creativeProjectFilePolicy?: CreativeProjectFilePolicy;
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

function creativeSearchStableRef(source: SearchSourceRef): string {
  switch (source.kind) {
    case "chapter":
      return `chapter:${source.id}`;
    case "story-asset":
      return `story_bible:${source.id}`;
    case "memory":
      return `memory:${source.id}`;
  }
}

function truncateSnippet(text: string, maxBytes = MAX_SNIPPET_BYTES): string {
  const encoded = new TextEncoder().encode(text);
  if (encoded.byteLength <= maxBytes) return text;
  const suffix = "...";
  const contentBudget = Math.max(0, maxBytes - suffix.length);
  let result = "";
  let usedBytes = 0;
  for (const character of text) {
    const characterBytes = new TextEncoder().encode(character).byteLength;
    if (usedBytes + characterBytes > contentBudget) break;
    result += character;
    usedBytes += characterBytes;
  }
  return result + suffix;
}

function isWithinRoot(canonicalRoot: string, candidate: string): boolean {
  const pathRelative = relative(canonicalRoot, candidate);
  return pathRelative === "" || (!pathRelative.startsWith("..") && !isAbsolute(pathRelative));
}

function isSearchableEngineeringFile(fileName: string): boolean {
  const lowerName = fileName.toLowerCase();
  if (isSensitiveEngineeringFileName(lowerName)) {
    return false;
  }

  return (
    searchableTextExtensions.has(extname(lowerName)) || searchableExtensionlessNames.has(lowerName)
  );
}

function isSensitiveEngineeringFileName(fileName: string): boolean {
  const lowerName = fileName.toLowerCase();
  return (
    lowerName === ".env" ||
    lowerName.startsWith(".env.") ||
    sensitiveFileNames.has(lowerName) ||
    sensitiveFileSuffixes.some((suffix) => lowerName.endsWith(suffix)) ||
    /(?:^|[._-])(credential|credentials|key|keys|secret|secrets)(?:[._-]|$)/.test(lowerName)
  );
}

function hasSameIdentity(left: Stats, right: Stats): boolean {
  return (
    left.dev !== 0 &&
    left.ino !== 0 &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.isFile() &&
    right.isFile()
  );
}

async function readBoundedFile(
  handle: FileHandle,
  expectedSize: number,
  maxFileSizeBytes = MAX_FILE_SIZE_BYTES
): Promise<Uint8Array | undefined> {
  if (expectedSize < 0 || expectedSize > maxFileSizeBytes) return undefined;
  const bytes = Buffer.allocUnsafe(expectedSize);
  let bytesRead = 0;
  while (bytesRead < bytes.length) {
    const result = await handle.read(bytes, bytesRead, bytes.length - bytesRead, bytesRead);
    if (result.bytesRead === 0) return undefined;
    bytesRead += result.bytesRead;
  }
  return bytes;
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
  let expression = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index] ?? "";
    if (character === "*" && pattern[index + 1] === "*") {
      index += 1;
      if (pattern[index + 1] === "/") {
        index += 1;
        expression += "(?:.*/)?";
      } else {
        expression += ".*";
      }
      continue;
    }
    if (character === "*") {
      expression += "[^/]*";
      continue;
    }
    if (character === "?") {
      expression += "[^/]";
      continue;
    }
    expression += /[.+^${}()|[\]\\]/u.test(character) ? `\\${character}` : character;
  }
  try {
    return new RegExp(`^${expression}$`, "u").test(relativePath);
  } catch {
    return false;
  }
}

interface PathCursor {
  readonly query: string;
  readonly kind: "file" | "directory" | "any";
  readonly maxResults: number;
  readonly offset: number;
  readonly indexVersion: string;
}

function encodePathCursor(cursor: PathCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodePathCursor(value: string | undefined): PathCursor | undefined {
  if (value === undefined || value.length === 0 || value.length > 4096) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    if (
      typeof parsed.query !== "string" ||
      (parsed.kind !== "file" && parsed.kind !== "directory" && parsed.kind !== "any") ||
      typeof parsed.maxResults !== "number" ||
      !Number.isInteger(parsed.maxResults) ||
      typeof parsed.offset !== "number" ||
      !Number.isInteger(parsed.offset) ||
      parsed.offset < 0 ||
      typeof parsed.indexVersion !== "string"
    ) {
      return undefined;
    }
    return parsed as unknown as PathCursor;
  } catch {
    return undefined;
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

    if (
      this.options.workspaceKind === "creativeProject" &&
      this.options.creativeProjectFilePolicy === undefined
    ) {
      return this.searchCreativeProject(input.query, maxResults, includeGlobs, excludeGlobs);
    }
    return this.searchFileSystem(
      input.query,
      maxResults,
      includeGlobs,
      excludeGlobs,
      input.signal,
      this.options.creativeProjectFilePolicy
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

  public async findPaths(input: {
    readonly query: string;
    readonly entryKind?: "file" | "directory" | "any";
    readonly cursor?: string;
    readonly maxResults?: number;
    readonly signal?: AbortSignal;
  }): Promise<Result<AgentPathDiscoveryResults, UnifiedError>> {
    const query = input.query;
    const kind = input.entryKind ?? "any";
    const maxResults = Math.min(input.maxResults ?? 50, MAX_RESULTS_HARD_LIMIT);
    const globSegments = query.split("/");
    if (
      query.length === 0 ||
      query.length > MAX_GLOB_LENGTH ||
      query.includes("..") ||
      query.includes("\\") ||
      query.includes(":") ||
      isAbsolute(query) ||
      globSegments.some((segment) => windowsDeviceNames.test(segment)) ||
      (kind !== "file" && kind !== "directory" && kind !== "any")
    ) {
      return err(
        validationError({
          code: "AGENT_SEARCH_GLOB_INVALID",
          message: "Path glob pattern is invalid.",
          suggestedAction: "Use a project-relative glob without traversal.",
          traceId: this.traceId
        })
      );
    }
    if (
      !Number.isInteger(maxResults) ||
      maxResults < 1 ||
      (input.cursor !== undefined && (input.cursor.length === 0 || input.cursor.length > 4096))
    ) {
      return err(
        validationError({
          code: "AGENT_SEARCH_CURSOR_INVALID",
          message: "Path search pagination is invalid.",
          suggestedAction: "Use a positive result limit and a current cursor.",
          traceId: this.traceId
        })
      );
    }
    let canonicalRoot: string;
    let rootStat: Stats;
    try {
      canonicalRoot = await this.canonicalRoot;
      rootStat = await lstat(canonicalRoot);
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
    const configuredPolicy =
      this.options.creativeProjectFilePolicy ??
      (this.options.workspaceKind === "creativeProject"
        ? DEFAULT_CREATIVE_PROJECT_FILE_POLICY
        : undefined);
    const policy =
      configuredPolicy === undefined
        ? undefined
        : normalizeCreativeProjectFilePolicy(configuredPolicy);
    if (policy !== undefined && !policy.ok) return policy;
    const state = {
      directories: 0,
      files: 0,
      truncated: false,
      aborted: false
    };
    const matches: AgentPathDiscoveryItem[] = [];
    const visit = async (directory: string, depth: number): Promise<void> => {
      if (state.aborted || state.truncated || state.directories >= MAX_DIRECTORIES || depth > 64) {
        state.truncated = true;
        return;
      }
      state.directories += 1;
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        if (input.signal?.aborted) {
          state.aborted = true;
          return;
        }
        if (entry.isSymbolicLink() || windowsDeviceNames.test(entry.name)) continue;
        const fullPath = join(directory, entry.name);
        const relativePath = relative(canonicalRoot, fullPath).replaceAll("\\", "/");
        if (relativePath.length === 0 || relativePath.length > 1024) continue;
        const isDirectory = entry.isDirectory();
        if (
          isDirectory &&
          this.options.workspaceKind === "engineeringWorkspace" &&
          (blockedRoots.has(entry.name.toLowerCase()) || isSensitiveEngineeringFileName(entry.name))
        ) {
          continue;
        }
        if (!isDirectory && !entry.isFile()) continue;
        if (!isDirectory) {
          state.files += 1;
          if (state.files > MAX_FILES) {
            state.truncated = true;
            return;
          }
          if (
            this.options.workspaceKind === "engineeringWorkspace" &&
            !isSearchableEngineeringFile(entry.name)
          ) {
            continue;
          }
        }
        if (
          policy?.value &&
          !normalizeCreativeProjectFilePath(
            relativePath,
            isDirectory ? "directory" : "file",
            policy.value
          ).ok
        ) {
          continue;
        }
        if (
          matchesGlob(relativePath, query) &&
          (kind === "any" || (kind === "directory" ? isDirectory : !isDirectory))
        ) {
          matches.push({
            relativePath,
            entryKind: isDirectory ? "directory" : "file",
            ...(!isDirectory ? { stableRef: `file:${relativePath}` } : {})
          });
        }
        if (isDirectory) await visit(fullPath, depth + 1);
        if (state.truncated || state.aborted) return;
      }
    };
    await visit(canonicalRoot, 0);
    const indexVersion = sha256(
      JSON.stringify({
        workspaceKind: this.options.workspaceKind,
        root: canonicalRoot,
        rootIdentity: [rootStat.dev, rootStat.ino, rootStat.mtimeMs],
        policy: policy?.value ?? null,
        entries: matches.map((item) => [item.relativePath, item.entryKind])
      })
    );
    const cursor = decodePathCursor(input.cursor);
    if (
      input.cursor !== undefined &&
      (cursor === undefined ||
        cursor.query !== query ||
        cursor.kind !== kind ||
        cursor.maxResults !== maxResults ||
        cursor.indexVersion !== indexVersion)
    ) {
      return err(
        validationError({
          code: "AGENT_SEARCH_CURSOR_INVALID",
          message: "Path search cursor is invalid or stale.",
          suggestedAction: "Start a new path search.",
          traceId: this.traceId
        })
      );
    }
    const offset = cursor?.offset ?? 0;
    const ordered = matches.sort((left, right) =>
      left.relativePath.localeCompare(right.relativePath)
    );
    const items = ordered.slice(offset, offset + maxResults);
    const hasMore = offset + items.length < ordered.length || state.truncated;
    const nextCursor = hasMore
      ? encodePathCursor({
          query,
          kind,
          maxResults,
          offset: offset + items.length,
          indexVersion
        })
      : null;
    return ok({
      kind: "path_results",
      items: Object.freeze(items),
      nextCursor,
      truncated: state.truncated || hasMore,
      indexVersion
    });
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
        stableRef: creativeSearchStableRef(item.sourceRef),
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

  private async searchFileSystem(
    query: string,
    maxResults: number,
    includeGlobs: readonly string[] | undefined,
    excludeGlobs: readonly string[] | undefined,
    signal?: AbortSignal,
    creativeProjectFilePolicy?: CreativeProjectFilePolicy
  ): Promise<Result<AgentSearchResults, UnifiedError>> {
    const normalizedCreativePolicy =
      creativeProjectFilePolicy === undefined
        ? undefined
        : normalizeCreativeProjectFilePolicy(creativeProjectFilePolicy);
    if (normalizedCreativePolicy !== undefined && !normalizedCreativePolicy.ok) {
      return normalizedCreativePolicy;
    }
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
    const state = {
      totalBytes: 0,
      totalHits: 0,
      scannedBytes: 0,
      directoriesVisited: 0,
      filesVisited: 0,
      visibleEntriesVisited: 0,
      deadlineAt: Date.now() + SEARCH_DEADLINE_MS,
      truncated: false
    };

    await this.traverseDirectory(
      canonicalRoot,
      canonicalRoot,
      query.toLowerCase(),
      includeGlobs,
      excludeGlobs,
      maxResults,
      items,
      state,
      signal,
      normalizedCreativePolicy?.value,
      0
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
      indexVersion:
        normalizedCreativePolicy === undefined
          ? "1.1"
          : `creative-project-files/${normalizedCreativePolicy.value.schemaVersion}`
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
    state: {
      totalBytes: number;
      totalHits: number;
      scannedBytes: number;
      directoriesVisited: number;
      filesVisited: number;
      visibleEntriesVisited: number;
      deadlineAt: number;
      truncated: boolean;
    },
    signal?: AbortSignal,
    creativeProjectFilePolicy?: CreativeProjectFilePolicy,
    depth = 0
  ): Promise<void> {
    if (signal?.aborted || state.truncated) return;
    if (Date.now() >= state.deadlineAt || state.directoriesVisited >= MAX_DIRECTORIES) {
      state.truncated = true;
      return;
    }

    let resolvedDirectory: string;
    try {
      resolvedDirectory = await realpath(dirPath);
    } catch {
      return;
    }
    if (!isWithinRoot(canonicalRoot, resolvedDirectory)) return;
    state.directoriesVisited++;

    let entries;
    try {
      entries = await readdir(resolvedDirectory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (signal?.aborted || state.truncated) break;
      if (Date.now() >= state.deadlineAt) {
        state.truncated = true;
        break;
      }
      if (entry.isSymbolicLink() || windowsDeviceNames.test(entry.name)) continue;

      const fullPath = join(resolvedDirectory, entry.name);
      const entryRelative = relative(canonicalRoot, fullPath).replaceAll("\\", "/");

      if (entry.isDirectory()) {
        if (creativeProjectFilePolicy === undefined) {
          if (blockedRoots.has(entry.name.toLowerCase())) continue;
        } else {
          if (
            !normalizeCreativeProjectFilePath(entryRelative, "directory", creativeProjectFilePolicy)
              .ok
          ) {
            continue;
          }
          if (state.visibleEntriesVisited >= creativeProjectFilePolicy.maxItems) {
            state.truncated = true;
            break;
          }
          state.visibleEntriesVisited++;
          if (depth + 1 >= creativeProjectFilePolicy.maxDepth) {
            state.truncated = true;
            continue;
          }
        }
        await this.traverseDirectory(
          fullPath,
          canonicalRoot,
          queryLower,
          includeGlobs,
          excludeGlobs,
          maxResults,
          items,
          state,
          signal,
          creativeProjectFilePolicy,
          depth + 1
        );
      } else if (entry.isFile()) {
        if (state.filesVisited >= MAX_FILES) {
          state.truncated = true;
          break;
        }
        state.filesVisited++;
        if (creativeProjectFilePolicy === undefined) {
          if (!isSearchableEngineeringFile(entry.name)) continue;
        } else {
          if (
            !normalizeCreativeProjectFilePath(entryRelative, "file", creativeProjectFilePolicy).ok
          ) {
            continue;
          }
          if (state.visibleEntriesVisited >= creativeProjectFilePolicy.maxItems) {
            state.truncated = true;
            break;
          }
          state.visibleEntriesVisited++;
        }
        if (!matchesGlobs(entryRelative, includeGlobs, excludeGlobs)) continue;

        const bytes = await this.readVerifiedEngineeringFile(
          fullPath,
          canonicalRoot,
          state,
          creativeProjectFilePolicy?.maxTextBytes
        );
        if (bytes === undefined) {
          if (state.scannedBytes >= MAX_TOTAL_SCANNED_BYTES) state.truncated = true;
          continue;
        }
        let content: string;
        try {
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

  private async readVerifiedEngineeringFile(
    fullPath: string,
    canonicalRoot: string,
    state: { scannedBytes: number; truncated: boolean },
    maxFileSizeBytes = MAX_FILE_SIZE_BYTES
  ): Promise<Uint8Array | undefined> {
    if (state.scannedBytes >= MAX_TOTAL_SCANNED_BYTES) {
      state.truncated = true;
      return undefined;
    }

    let handle: FileHandle | undefined;
    try {
      // O_NOFOLLOW closes the final-component symlink race. The identity checks below
      // reject path swaps and traversal through a reparse point before any bytes are read.
      handle = await open(fullPath, constants.O_RDONLY | constants.O_NOFOLLOW);
      const openedStat = await handle.stat();
      if (!openedStat.isFile() || openedStat.size > maxFileSizeBytes) return undefined;
      if (state.scannedBytes + openedStat.size > MAX_TOTAL_SCANNED_BYTES) {
        state.truncated = true;
        return undefined;
      }

      const [pathStat, resolvedPath] = await Promise.all([lstat(fullPath), realpath(fullPath)]);
      if (!hasSameIdentity(openedStat, pathStat) || !isWithinRoot(canonicalRoot, resolvedPath)) {
        return undefined;
      }

      await this.afterPathIdentityVerified(fullPath);
      const bytes = await readBoundedFile(handle, openedStat.size, maxFileSizeBytes);
      if (bytes === undefined) return undefined;
      const postReadStat = await handle.stat();
      if (
        !hasSameIdentity(openedStat, postReadStat) ||
        postReadStat.size !== openedStat.size ||
        postReadStat.mtimeMs !== openedStat.mtimeMs ||
        postReadStat.ctimeMs !== openedStat.ctimeMs
      ) {
        return undefined;
      }
      state.scannedBytes += bytes.byteLength;
      return bytes;
    } catch {
      return undefined;
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  /** Allows a specialized repository implementation to observe a verified file path identity. */
  protected async afterPathIdentityVerified(_fullPath: string): Promise<void> {
    // Default implementation deliberately has no side effect.
    void _fullPath;
  }
}
