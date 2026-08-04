import type {
  LlmCacheInputTokenSemantics,
  LlmCacheOutcome,
  LlmCacheUsageStatus,
  LlmCost,
  LlmPromptCacheBypassReason,
  LlmPromptCacheMode
} from "@novel-studio/llm-adapter";
import type { AgentContextScope } from "@novel-studio/agent-engine";

export interface AgentUsageDateRange {
  readonly fromLocalDate: string;
  readonly toLocalDate: string;
}

export interface AgentUsageQuery {
  readonly range: AgentUsageDateRange;
  readonly provider?: string;
  readonly model?: string;
  readonly projectId?: string;
  readonly detailLocalDate?: string;
  readonly includeModelBreakdown?: boolean;
}

export interface AgentUsageModelTotal {
  readonly provider: string;
  readonly model: string;
  readonly totalTokens: number;
}

export interface AgentUsageCostTotal {
  readonly currency: string;
  readonly actualAmount: number;
  readonly estimatedAmount: number;
  readonly estimatedCacheSavings?: number;
}

export interface AgentUsageDailyBucket {
  readonly localDate: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedTokens: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly cacheEligibleInputTokens?: number;
  readonly cacheHitRate?: number;
  readonly reasoningTokens: number;
  readonly totalTokens: number;
  readonly costs: readonly AgentUsageCostTotal[];
  readonly hasUnknownCost: boolean;
  readonly models?: readonly AgentUsageModelTotal[];
}

export interface AgentUsageRunSummary {
  readonly scope: AgentContextScope;
  readonly usageId: string;
  readonly runId: string;
  readonly conversationId: string;
  readonly projectId?: string;
  readonly provider: string;
  readonly model: string;
  readonly totalTokens: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly cacheEligibleInputTokens?: number;
  readonly cacheHitRate?: number;
  readonly cacheOutcome?: LlmCacheOutcome;
  readonly cacheBypassReason?: LlmPromptCacheBypassReason;
  readonly cacheUsageStatus?: LlmCacheUsageStatus;
  readonly cacheInputTokenSemantics?: LlmCacheInputTokenSemantics;
  readonly cacheMode?: LlmPromptCacheMode | null;
  readonly cachePrefixChecksum?: string | null;
  readonly estimatedCacheSavings?: {
    readonly amount: number;
    readonly currency: string;
  };
  readonly usageStatus: "actual" | "estimated" | "missing";
  readonly cost: LlmCost;
  readonly timestamp: string;
}

export interface AgentUsageReport {
  readonly query: AgentUsageQuery;
  readonly days: readonly AgentUsageDailyBucket[];
  readonly runs: readonly AgentUsageRunSummary[];
  readonly generatedAt: string;
}

export interface ClearAgentUsageCommand {
  readonly commandId: string;
  readonly range: AgentUsageDateRange;
}

export type AgentUsageMetricProfile = "standalone" | "writing" | "creative_general" | "engineering";

export interface AgentUsageSourceMetric {
  readonly sourceKind:
    | "disk_file"
    | "editor_buffer"
    | "story_bible_asset"
    | "project_conventions"
    | "workspace_outline"
    | "compaction_summary"
    | "system_guidance"
    | "conversation"
    | "tool_result"
    | "user_request";
  readonly tokenCount: number;
  readonly truncated: boolean;
  readonly exclusionReason:
    "none" | "user_excluded" | "budget" | "policy" | "stale" | "unsupported";
}

export interface AgentUsageStyleObservation {
  readonly rule: string;
  readonly version: string;
  readonly confidence: number;
  readonly userOutcome: "accepted" | "ignored" | "dismissed" | "no_action";
}

/** Local-only DTO matching the strict agent-engine 2.0 usage artifact. */
export interface AgentUsageMetricRecord {
  readonly schemaVersion: "2.0";
  readonly storageScope: "local_only";
  readonly usageId: string;
  readonly runId: string;
  readonly recordedAt: string;
  readonly semanticVersionSetChecksum: string;
  readonly guidanceVersion: "3.0";
  readonly contextProfileId: AgentUsageMetricProfile;
  readonly messageOrderVersion: "2.0";
  readonly toolCatalogVersion: "2.0";
  readonly runOutcome:
    | "completed"
    | "blocked"
    | "cancelled"
    | "failed"
    | "limit_reached"
    | "awaiting_approval"
    | "awaiting_input"
    | "stale"
    | "capability_changed";
  readonly pendingOutcome:
    "none" | "awaiting_approval" | "awaiting_input" | "change_set_pending" | "recovery_pending";
  readonly recoveryOutcome:
    "not_required" | "pending" | "recovered" | "rolled_back" | "failed" | "outcome_unknown";
  readonly modelRoundCount: number;
  readonly toolCallCount: number;
  readonly toolFailureCount: number;
  readonly approvalWaitCount: number;
  readonly approvalWaitMs: number;
  readonly sources: readonly AgentUsageSourceMetric[];
  readonly cacheOutcome: "hit" | "miss" | "bypass" | "unknown";
  readonly cacheVerifiedInputTokens: number | null;
  readonly changeSetOutcome:
    "none" | "generated" | "approved" | "rejected" | "applied" | "rolled_back" | "undone" | "stale";
  readonly styleObservations: readonly AgentUsageStyleObservation[];
  readonly eventRefs: readonly string[];
}
