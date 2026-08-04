import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import type { AgentContextScope } from "./agent-context-scope.js";
import type { AgentContextPrecision } from "./context-snapshot.js";

/** The lower/upper clamp for the fallback output reserve when a profile lacks a valid maximum output. */
export const CONTEXT_BUDGET_OUTPUT_RESERVE_MIN = 4096;
export const CONTEXT_BUDGET_OUTPUT_RESERVE_MAX = 16384;

/**
 * A provider-aware context budget. The context window is a single pool shared by input and output,
 * so the safe input budget is what remains after reserving room for the model's output, the tool
 * schemas, and the system guidance: `contextWindow - outputReserve - toolReserve - systemReserve`.
 * Every field is a finite, non-negative token count.
 */
export interface ContextBudgetSnapshotV10 {
  readonly schemaVersion: "1.0";
  readonly contextBudgetSnapshotId: string;
  readonly contextWindow: number;
  readonly maxOutputTokens: number;
  readonly contextWindowSemantics: "shared_input_output_window";
  readonly safeInputBudget: number;
  readonly requiredContextTokens: number;
  readonly outputReserve: number;
  readonly toolReserve: number;
  readonly systemReserve: number;
  readonly usedTokens: number;
  readonly remainingTokens: number;
  readonly precision: AgentContextPrecision;
  readonly provider: string;
  readonly model: string;
  readonly calculatedAt: string;
}

export interface ContextBudgetAuditProof {
  readonly budgetContractVersion: string;
  readonly modelProfileId: string;
  readonly requestedMaxOutputTokens: number | null;
  readonly operandsChecksum: string;
  readonly systemMaterializationChecksum: string;
  readonly usedMaterializationChecksum: string;
  readonly toolCatalog: {
    readonly facadeVersion: "v1" | "v2";
    readonly catalogRevision: string;
    readonly descriptorChecksum: string;
    readonly descriptorCount: number;
  };
  readonly sharing?: {
    readonly defaultsRevision: string;
    readonly grantRevision: string;
  };
}

/** C4 snapshots add the immutable proof for every resolved operand. */
export interface ContextBudgetSnapshotV11 extends Omit<ContextBudgetSnapshotV10, "schemaVersion"> {
  readonly schemaVersion: "1.1";
  readonly audit: ContextBudgetAuditProof;
}

export type ContextBudgetSnapshot = ContextBudgetSnapshotV10 | ContextBudgetSnapshotV11;

/**
 * The renderer's preview reference for a budget. It carries only a draft reference; the model facts,
 * reserves, and token counts are resolved server-side (never trusted from the renderer).
 */
export interface PreviewContextBudgetCommand {
  /** Legacy workspace-only identity; standalone commands omit it. */
  readonly projectId?: string;
  readonly scope?: AgentContextScope;
  readonly conversationId: string;
  readonly commandId: string;
  readonly runDraftId: string;
  readonly expectedDraftRevision: number;
  readonly runDraftChecksum: string;
}

export interface CalculateContextBudgetInput {
  readonly contextBudgetSnapshotId: string;
  readonly provider: string;
  readonly model: string;
  readonly contextWindow: number;
  /** The profile's declared maximum output tokens. Undefined or invalid falls back to the clamp. */
  readonly maxOutputTokens?: number;
  readonly toolReserve: number;
  readonly systemReserve: number;
  readonly requiredContextTokens: number;
  readonly usedTokens: number;
  readonly precision: AgentContextPrecision;
  readonly calculatedAt: string;
}

export type ContextPackingPriority = "required" | "active" | "pinned" | "summary" | "automatic";

export interface ContextPackingSource {
  readonly sourceId: string;
  readonly priority: ContextPackingPriority;
  readonly tokens: number;
  /** Stable semantic order inside one priority. Defaults to zero, then sourceId breaks ties. */
  readonly order?: number;
}

export interface ContextPackingDecision {
  readonly sourceId: string;
  readonly priority: ContextPackingPriority;
  readonly originalTokens: number;
  readonly includedTokens: number;
  readonly status: "included" | "truncated" | "excluded";
  readonly reason: "fits" | "summary_limit" | "budget_limit";
}

export interface DeterministicContextPackingPlan {
  readonly availableTokens: number;
  readonly usedTokens: number;
  readonly remainingTokens: number;
  readonly decisions: readonly ContextPackingDecision[];
}

export interface PlanDeterministicContextPackingInput {
  readonly availableTokens: number;
  readonly summaryTokenLimit: number;
  readonly sources: readonly ContextPackingSource[];
}

/**
 * Finalize context source selection before a Provider call. Required, active, and pinned sources
 * are atomic and fail closed when they do not fit. Summary has its own aggregate cap; automatic
 * sources consume only the remainder and may be deterministically truncated or excluded.
 */
export function planDeterministicContextPacking(
  input: PlanDeterministicContextPackingInput
): Result<DeterministicContextPackingPlan, UnifiedError> {
  if (!isTokenCount(input.availableTokens) || !isTokenCount(input.summaryTokenLimit)) {
    return err(invalidPacking("limits"));
  }
  const sourceIds = new Set<string>();
  for (const source of input.sources) {
    if (
      !isSourceId(source.sourceId) ||
      sourceIds.has(source.sourceId) ||
      !isPackingPriority(source.priority) ||
      !isTokenCount(source.tokens) ||
      (source.order !== undefined && !isTokenCount(source.order))
    ) {
      return err(invalidPacking("sources"));
    }
    sourceIds.add(source.sourceId);
  }

  const ordered = [...input.sources].sort(
    (left, right) =>
      packingPriorityRank(left.priority) - packingPriorityRank(right.priority) ||
      (left.order ?? 0) - (right.order ?? 0) ||
      left.sourceId.localeCompare(right.sourceId)
  );
  const atomicTokens = ordered
    .filter((source) => isAtomicPackingPriority(source.priority))
    .reduce((sum, source) => sum + source.tokens, 0);
  if (!Number.isSafeInteger(atomicTokens)) return err(invalidPacking("sources.tokens"));
  if (atomicTokens > input.availableTokens) {
    const requiredTokens = ordered
      .filter((source) => source.priority === "required")
      .reduce((sum, source) => sum + source.tokens, 0);
    return err(
      insufficientPacking(
        requiredTokens > input.availableTokens
          ? "CONTEXT_PACKING_REQUIRED_OVERFLOW"
          : "CONTEXT_PACKING_ACTIVE_OR_PINNED_OVERFLOW",
        input.availableTokens,
        atomicTokens
      )
    );
  }

  let remaining = input.availableTokens;
  let summaryRemaining = input.summaryTokenLimit;
  const decisions: ContextPackingDecision[] = [];
  for (const source of ordered) {
    if (isAtomicPackingPriority(source.priority)) {
      remaining -= source.tokens;
      decisions.push(decision(source, source.tokens, "fits"));
      continue;
    }
    const allowed =
      source.priority === "summary"
        ? Math.min(source.tokens, remaining, summaryRemaining)
        : Math.min(source.tokens, remaining);
    remaining -= allowed;
    if (source.priority === "summary") summaryRemaining -= allowed;
    const reason =
      allowed === source.tokens
        ? "fits"
        : source.priority === "summary" && summaryRemaining === 0
          ? "summary_limit"
          : "budget_limit";
    decisions.push(decision(source, allowed, reason));
  }
  return ok({
    availableTokens: input.availableTokens,
    usedTokens: input.availableTokens - remaining,
    remainingTokens: remaining,
    decisions
  });
}

/**
 * Compute a provider-aware context budget. Every operand is validated as a finite, non-negative safe
 * integer (the context window must be strictly positive) before any subtraction, so the result can
 * never contain NaN, Infinity, or a value produced by overflow. The output reserve uses the profile's
 * declared maximum output when it is valid, and otherwise `min(16K, max(4K, floor(window * 0.15)))`.
 * The budget is rejected when reserves consume the whole window or the safe input budget cannot cover
 * the required context tokens.
 */
export function calculateContextBudget(
  input: CalculateContextBudgetInput
): Result<ContextBudgetSnapshotV10, UnifiedError> {
  if (!isPositiveTokenCount(input.contextWindow)) {
    return err(invalidBudget(input, "contextWindow"));
  }
  for (const [field, value] of [
    ["toolReserve", input.toolReserve],
    ["systemReserve", input.systemReserve],
    ["requiredContextTokens", input.requiredContextTokens],
    ["usedTokens", input.usedTokens]
  ] as const) {
    if (!isTokenCount(value)) {
      return err(invalidBudget(input, field));
    }
  }

  const outputReserve = resolveOutputReserve(input.contextWindow, input.maxOutputTokens);
  const safeInputBudget =
    input.contextWindow - outputReserve - input.toolReserve - input.systemReserve;
  if (safeInputBudget <= 0 || safeInputBudget < input.requiredContextTokens) {
    return err(insufficientBudget(input, outputReserve, safeInputBudget));
  }

  return ok({
    schemaVersion: "1.0",
    contextBudgetSnapshotId: input.contextBudgetSnapshotId,
    contextWindow: input.contextWindow,
    maxOutputTokens: outputReserve,
    contextWindowSemantics: "shared_input_output_window",
    safeInputBudget,
    requiredContextTokens: input.requiredContextTokens,
    outputReserve,
    toolReserve: input.toolReserve,
    systemReserve: input.systemReserve,
    usedTokens: input.usedTokens,
    remainingTokens: Math.max(0, safeInputBudget - input.usedTokens),
    precision: input.precision,
    provider: input.provider,
    model: input.model,
    calculatedAt: input.calculatedAt
  });
}

/**
 * Combine per-source precisions into the budget's overall precision by taking the least-confident
 * value: any `unknown` makes the whole budget `unknown`, any `estimated` makes it `estimated`, and an
 * all-`reported` (or empty) set stays `reported`. A local estimate must never be reported as actual.
 */
export function aggregateContextPrecision(
  precisions: readonly AgentContextPrecision[]
): AgentContextPrecision {
  if (precisions.includes("unknown")) return "unknown";
  if (precisions.includes("estimated")) return "estimated";
  return "reported";
}

export interface AgentTokenCount {
  readonly tokens: number;
  readonly precision: AgentContextPrecision;
}

/**
 * A token estimator keyed by model profile. Provider/tokenizer implementations report exact counts
 * (`reported`); the deterministic fallback returns `estimated`. It never returns `reported` for a
 * local estimate.
 */
export interface AgentTokenEstimator {
  count(text: string, modelProfileId: string): AgentTokenCount;
}

/**
 * One deterministic UTF-8 estimator used when no provider tokenizer is injected. It charges one
 * token per UTF-8 byte: intentionally conservative, but an upper bound for byte-based tokenizer
 * inputs, so CJK and emoji cannot make a context budget look smaller than its serialized text. It
 * always marks its output `estimated` so downstream accounting never mistakes it for reported usage.
 */
export function createDeterministicTokenEstimator(): AgentTokenEstimator {
  return {
    count(text: string): AgentTokenCount {
      return { tokens: utf8ByteLength(text), precision: "estimated" };
    }
  };
}

function resolveOutputReserve(contextWindow: number, maxOutputTokens?: number): number {
  if (maxOutputTokens !== undefined && isPositiveTokenCount(maxOutputTokens)) {
    return maxOutputTokens;
  }
  const fromWindow = Math.floor(contextWindow * 0.15);
  return Math.min(
    CONTEXT_BUDGET_OUTPUT_RESERVE_MAX,
    Math.max(CONTEXT_BUDGET_OUTPUT_RESERVE_MIN, fromWindow)
  );
}

function isTokenCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isPositiveTokenCount(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function isPackingPriority(value: unknown): value is ContextPackingPriority {
  return (
    value === "required" ||
    value === "active" ||
    value === "pinned" ||
    value === "summary" ||
    value === "automatic"
  );
}

function isAtomicPackingPriority(value: ContextPackingPriority): boolean {
  return value === "required" || value === "active" || value === "pinned";
}

function packingPriorityRank(value: ContextPackingPriority): number {
  switch (value) {
    case "required":
      return 0;
    case "active":
      return 1;
    case "pinned":
      return 2;
    case "summary":
      return 3;
    case "automatic":
      return 4;
  }
}

function decision(
  source: ContextPackingSource,
  includedTokens: number,
  reason: ContextPackingDecision["reason"]
): ContextPackingDecision {
  return {
    sourceId: source.sourceId,
    priority: source.priority,
    originalTokens: source.tokens,
    includedTokens,
    status:
      includedTokens === source.tokens
        ? "included"
        : includedTokens === 0
          ? "excluded"
          : "truncated",
    reason
  };
}

function isSourceId(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return false;
  return ![...value].some((character) => {
    const codePoint = character.codePointAt(0) as number;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (const codePoint of text) {
    const code = codePoint.codePointAt(0) ?? 0;
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code <= 0xffff) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

function invalidBudget(input: CalculateContextBudgetInput, field: string): UnifiedError {
  return createUnifiedError({
    code: "AGENT_CONTEXT_BUDGET_INVALID",
    category: "ValidationError",
    message: "The context budget could not be calculated from the provided model facts.",
    recoverability: "user-action",
    suggestedAction: "Choose a model whose context window and reserves are valid token counts.",
    traceId: "context-budget",
    redactedDetail: { provider: input.provider, model: input.model, field }
  });
}

function insufficientBudget(
  input: CalculateContextBudgetInput,
  outputReserve: number,
  safeInputBudget: number
): UnifiedError {
  return createUnifiedError({
    code: "AGENT_CONTEXT_BUDGET_INSUFFICIENT",
    category: "UserError",
    message: "The selected model does not leave enough context for this Agent run.",
    recoverability: "user-action",
    suggestedAction:
      "Choose a model with a larger context window, or reduce the required context before starting the run.",
    traceId: "context-budget",
    redactedDetail: {
      provider: input.provider,
      model: input.model,
      contextWindow: input.contextWindow,
      outputReserve,
      toolReserve: input.toolReserve,
      systemReserve: input.systemReserve,
      safeInputBudget,
      requiredContextTokens: input.requiredContextTokens
    }
  });
}

function invalidPacking(field: string): UnifiedError {
  return createUnifiedError({
    code: "CONTEXT_PACKING_INPUT_INVALID",
    category: "ValidationError",
    message: "The context packing inputs are invalid.",
    recoverability: "user-action",
    suggestedAction: "Refresh the context preview and retry.",
    traceId: "context-budget-packing",
    redactedDetail: { field }
  });
}

function insufficientPacking(
  code: "CONTEXT_PACKING_REQUIRED_OVERFLOW" | "CONTEXT_PACKING_ACTIVE_OR_PINNED_OVERFLOW",
  availableTokens: number,
  atomicTokens: number
): UnifiedError {
  return createUnifiedError({
    code,
    category: "UserError",
    message:
      code === "CONTEXT_PACKING_ACTIVE_OR_PINNED_OVERFLOW"
        ? "The active or pinned context does not fit in the selected model."
        : "The required Agent request does not fit in the selected model.",
    recoverability: "user-action",
    suggestedAction:
      code === "CONTEXT_PACKING_ACTIVE_OR_PINNED_OVERFLOW"
        ? "Reduce the selected context or choose a model with a larger context window."
        : "Choose a model with a larger context window.",
    traceId: "context-budget-packing",
    redactedDetail: { availableTokens, atomicTokens }
  });
}
