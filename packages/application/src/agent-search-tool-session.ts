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
      return ok(buildToolResult(result.value));
    },

    async findReferences(input) {
      const result = await searchRepository.findReferences({
        stableRef: input.stableRef,
        signal: input.signal
      });
      if (!result.ok) return result;
      return ok(buildToolResult(result.value));
    }
  };
}

function buildToolResult(sr: SearchRepositoryResult): AgentSearchToolResult {
  return {
    kind: "untrusted_project_data",
    items: sr.items.map((item) => ({
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
    totalHits: sr.totalHits,
    truncated: sr.truncated,
    indexVersion: sr.indexVersion
  };
}
