import type { LlmCost } from "@novel-studio/llm-adapter";

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
}

export interface AgentUsageCostTotal {
  readonly currency: string;
  readonly actualAmount: number;
  readonly estimatedAmount: number;
}

export interface AgentUsageDailyBucket {
  readonly localDate: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedTokens: number;
  readonly reasoningTokens: number;
  readonly totalTokens: number;
  readonly costs: readonly AgentUsageCostTotal[];
  readonly hasUnknownCost: boolean;
}

export interface AgentUsageRunSummary {
  readonly usageId: string;
  readonly runId: string;
  readonly conversationId: string;
  readonly projectId: string;
  readonly provider: string;
  readonly model: string;
  readonly totalTokens: number;
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
