/**
 * Task A.2 — Application-layer search tool session.
 * Implements AgentSearchToolExecutor using AgentProjectSearchRepository.
 * Returns results in the `untrusted_project_data` envelope.
 *
 * The repository is injected via structural typing (duck-typed interface) to avoid
 * cross-package TypeScript resolution issues in the worktree composite build.
 */
import { ok, type Result, type UnifiedError } from "@novel-studio/shared";

import type { AgentSearchToolExecutor, AgentSearchToolResult } from "./agent-tool-ports.js";

/** Structural interface matching AgentProjectSearchRepository from @novel-studio/repository. */
interface SearchRepositoryPort {
  searchText(input: {
    readonly query: string;
    readonly includeGlobs?: readonly string[];
    readonly excludeGlobs?: readonly string[];
    readonly maxResults?: number;
    readonly signal?: AbortSignal;
  }): Promise<Result<SearchRepositoryResult, UnifiedError>>;

  findReferences(input: {
    readonly stableRef: string;
    readonly signal?: AbortSignal;
  }): Promise<Result<SearchRepositoryResult, UnifiedError>>;
  findPaths(input: {
    readonly query: string;
    readonly entryKind?: "file" | "directory" | "any";
    readonly cursor?: string;
    readonly maxResults?: number;
    readonly signal?: AbortSignal;
  }): Promise<
    Result<
      {
        readonly kind: "path_results";
        readonly items: readonly {
          readonly relativePath: string;
          readonly entryKind: "file" | "directory";
          readonly stableRef?: string;
          readonly mutationRef?: string;
        }[];
        readonly nextCursor: string | null;
        readonly truncated: boolean;
        readonly indexVersion: string;
      },
      UnifiedError
    >
  >;
}

interface SearchRepositoryResult {
  readonly items: ReadonlyArray<{
    readonly relativePath: string;
    readonly stableRef: string;
    readonly range: {
      readonly unit: "utf16_offset" | "line_column";
      readonly start: number;
      readonly end: number;
    };
    readonly snippet: string;
    readonly sourceChecksum: string;
    readonly resultDigest: string;
    readonly truncated: boolean;
  }>;
  readonly totalHits: number;
  readonly truncated: boolean;
  readonly indexVersion: string;
}

export interface AgentSearchToolSessionOptions {
  readonly searchRepository: SearchRepositoryPort;
  readonly traceId?: string;
}

export function createAgentSearchToolSession(
  options: AgentSearchToolSessionOptions
): AgentSearchToolExecutor {
  const { searchRepository } = options;

  return {
    async searchText(input) {
      const result = await searchRepository.searchText({
        query: input.query,
        ...(input.includeGlobs !== undefined ? { includeGlobs: input.includeGlobs } : {}),
        ...(input.excludeGlobs !== undefined ? { excludeGlobs: input.excludeGlobs } : {}),
        ...(input.maxResults !== undefined ? { maxResults: input.maxResults } : {}),
        ...(input.signal !== undefined ? { signal: input.signal } : {})
      });
      if (!result.ok) return result;
      return ok(buildToolResult(result.value, input.contextMode));
    },

    async findReferences(input) {
      const result = await searchRepository.findReferences({
        stableRef:
          input.contextMode === "general_file" && input.stableRef.startsWith("file:")
            ? input.stableRef.slice("file:".length)
            : input.stableRef,
        signal: input.signal
      });
      if (!result.ok) return result;
      return ok(buildToolResult(result.value, input.contextMode));
    },
    async findPaths(input) {
      const result = await searchRepository.findPaths({
        query: input.query,
        ...(input.kind !== undefined ? { entryKind: input.kind } : {}),
        ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
        ...(input.maxResults !== undefined ? { maxResults: input.maxResults } : {}),
        signal: input.signal
      });
      if (!result.ok) return result;
      return ok({
        kind: "untrusted_project_data",
        items: result.value.items,
        nextCursor: result.value.nextCursor,
        truncated: result.value.truncated,
        indexRevision: result.value.indexVersion
      });
    }
  };
}

function buildToolResult(
  sr: SearchRepositoryResult,
  contextMode: "standalone_chat" | "writing" | "general_file" | undefined
): AgentSearchToolResult {
  const visibleItems = sr.items.flatMap((item) => {
    const stableRef = providerVisibleStableRef(item.stableRef, contextMode);
    return stableRef === undefined ? [] : [{ ...item, stableRef }];
  });
  return {
    kind: "untrusted_project_data",
    items: visibleItems.map((item) => ({
      relativePath: item.relativePath,
      stableRef: item.stableRef,
      rangeUnit: item.range.unit,
      rangeStart: item.range.start,
      rangeEnd: item.range.end,
      snippet: item.snippet,
      sourceChecksum: item.sourceChecksum,
      resultDigest: item.resultDigest,
      truncated: item.truncated
    })),
    totalHits: visibleItems.length,
    truncated: sr.truncated || visibleItems.length !== sr.items.length,
    indexVersion: sr.indexVersion
  };
}

function providerVisibleStableRef(
  stableRef: string,
  contextMode: "standalone_chat" | "writing" | "general_file" | undefined
): string | undefined {
  if (contextMode === "writing") {
    return stableRef.startsWith("chapter:") || stableRef.startsWith("story_bible:")
      ? stableRef
      : undefined;
  }
  if (stableRef.startsWith("file:")) {
    return stableRef.length > "file:".length ? stableRef : undefined;
  }
  if (stableRef.includes(":")) return undefined;
  return stableRef.length > 0 ? `file:${stableRef}` : undefined;
}
