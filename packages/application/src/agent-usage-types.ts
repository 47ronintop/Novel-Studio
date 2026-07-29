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
