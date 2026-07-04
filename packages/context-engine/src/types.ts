export type ContextRefType = "chapter" | "memory" | "character" | "world" | "timeline" | "goal";
export type MemoryConfidence = "confirmed" | "ai-unconfirmed" | "low" | "unknown";
export type ContextExclusionReason = "budget_exceeded" | "memory_confidence_filtered";

export interface ContextSourceRange {
  readonly startLine: number;
  readonly endLine: number;
}

export interface ContextSourceRef {
  readonly entityType: string;
  readonly entityId: string;
  readonly range?: ContextSourceRange;
}

export interface ContextCandidate {
  readonly refType: ContextRefType;
  readonly refId: string;
  readonly content: string;
  readonly priority: number;
  readonly sourceRefs: readonly ContextSourceRef[];
  readonly memoryConfidence?: MemoryConfidence;
  readonly tokenEstimate?: number;
}

export interface ContextBuildPolicy {
  readonly memoryConfidence?: readonly MemoryConfidence[];
  readonly maxChapterCandidates?: number;
}

export interface ContextBudgetInput {
  readonly maxTokens: number;
}

export interface ContextBuildInput {
  readonly schemaVersion: "1.0";
  readonly contextBundleId: string;
  readonly workflowRunId: string;
  readonly traceId: string;
  readonly goal: string;
  readonly budget: ContextBudgetInput;
  readonly policy?: ContextBuildPolicy;
  readonly candidates: readonly ContextCandidate[];
  readonly tokenEstimator?: (content: string) => number;
}

export interface ContextBundleBudget {
  readonly maxTokens: number;
  readonly estimatedTokens: number;
}

export interface ContextBundleItem {
  readonly refType: ContextRefType;
  readonly refId: string;
  readonly content: string;
  readonly tokenEstimate: number;
  readonly sourceRefs: readonly ContextSourceRef[];
}

export interface ContextIncludedRef {
  readonly refType: ContextRefType;
  readonly refId: string;
  readonly tokenEstimate: number;
}

export interface ContextExcludedRef {
  readonly refType: ContextRefType;
  readonly refId: string;
  readonly reason: ContextExclusionReason;
  readonly tokenEstimate: number;
}

export interface ContextBundleTrace {
  readonly selectionReason: string;
  readonly includedRefs: readonly ContextIncludedRef[];
  readonly excludedRefs: readonly ContextExcludedRef[];
}

export interface ContextBundle {
  readonly schemaVersion: "1.0";
  readonly contextBundleId: string;
  readonly workflowRunId: string;
  readonly budget: ContextBundleBudget;
  readonly items: readonly ContextBundleItem[];
  readonly trace: ContextBundleTrace;
}
