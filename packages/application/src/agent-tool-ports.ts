/**
 * Task 0.3 — Port interfaces for the three new executor categories introduced in Phase 0.
 * These ports are declared here so Application can inject them into AgentRunSession
 * without the run session knowing about concrete implementations.
 * Phase A/B/C/D implementations inject the real executors; absent ports return UNAVAILABLE.
 */
import type { JsonObject, Result, UnifiedError } from "@novel-studio/shared";

// ── Phase A: Search ──────────────────────────────────────────────────────────

export interface AgentSearchResultItem {
  /** Project-relative path (UTF-8, forward slashes). */
  readonly relativePath: string;
  /** Stable content reference (checksum or index-assigned ID). */
  readonly stableRef: string;
  /** Explicit range unit for start/end values. */
  readonly rangeUnit: "utf16_offset" | "line_column";
  readonly rangeStart: number;
  readonly rangeEnd: number;
  /** Bounded snippet of the matched text. */
  readonly snippet: string;
  /** SHA-256 of the source file at the time of indexing. */
  readonly sourceChecksum: string;
  /** SHA-256 of this result record (path + range + snippet). */
  readonly resultDigest: string;
  readonly truncated: boolean;
}

export interface AgentSearchToolResult {
  readonly kind: "untrusted_project_data";
  readonly items: readonly AgentSearchResultItem[];
  readonly totalHits: number;
  readonly truncated: boolean;
  /** Increments when the index schema changes and forces a rebuild. */
  readonly indexVersion: string;
}

export interface AgentSearchToolExecutor {
  searchText(input: {
    readonly runId: string;
    readonly projectId: string;
    readonly contextMode?: "standalone_chat" | "writing" | "general_file";
    readonly query: string;
    readonly includeGlobs?: readonly string[];
    readonly excludeGlobs?: readonly string[];
    readonly maxResults?: number;
    readonly signal: AbortSignal;
  }): Promise<Result<AgentSearchToolResult, UnifiedError>>;

  findReferences(input: {
    readonly runId: string;
    readonly projectId: string;
    readonly contextMode?: "standalone_chat" | "writing" | "general_file";
    readonly stableRef: string;
    readonly signal: AbortSignal;
  }): Promise<Result<AgentSearchToolResult, UnifiedError>>;
}

// ── Phase C: Controlled task execution ──────────────────────────────────────

export interface AgentTaskExecutionOutput {
  readonly exitCode: number;
  readonly stdoutSummary: string;
  readonly stderrSummary: string;
  readonly truncated: boolean;
  readonly durationMs: number;
  readonly terminationReason:
    "completed" | "timeout" | "cancelled" | "resource_limit" | "host_crash";
}

export interface AgentTaskSandboxPort {
  /** Launch a pre-snapshotted task inside the verified OS sandbox. */
  launch(input: {
    readonly taskId: string;
    /** Opaque attestation ID from Main's qualification store. */
    readonly attestationId: string;
    readonly executionSnapshotId: string;
    readonly signal: AbortSignal;
  }): Promise<Result<AgentTaskExecutionOutput, UnifiedError>>;
}

// ── Phase D: External network reads ─────────────────────────────────────────

export interface AgentNetworkReadResult {
  readonly kind: "untrusted_remote_data";
  readonly url: string;
  readonly fetchedAt: string;
  readonly contentDigest: string;
  readonly contentSummary: string;
  readonly truncated: boolean;
  readonly sourceLabel: string;
}

export interface AgentNetworkToolExecutor {
  webSearch(input: {
    readonly runId: string;
    readonly query: string;
    readonly signal: AbortSignal;
  }): Promise<Result<AgentNetworkReadResult, UnifiedError>>;

  fetchUrl(input: {
    readonly runId: string;
    readonly url: string;
    readonly signal: AbortSignal;
  }): Promise<Result<AgentNetworkReadResult, UnifiedError>>;
}

// ── Phase E: External (plugin/MCP) tools ────────────────────────────────────

/** Outcome when the external tool's delivery cannot be confirmed. */
export type AgentExternalToolOutcome =
  | { readonly status: "completed"; readonly result: JsonObject }
  | { readonly status: "outcome_unknown"; readonly reason: string };

export interface AgentExternalToolExecutor {
  callTool(input: {
    readonly runId: string;
    /** Canonical namespaced tool ID, e.g. "plugin:acme/summarise" or "mcp:local/list". */
    readonly canonicalToolId: string;
    readonly toolArguments: JsonObject;
    readonly idempotencyKey?: string;
    readonly signal: AbortSignal;
  }): Promise<Result<AgentExternalToolOutcome, UnifiedError>>;
}
