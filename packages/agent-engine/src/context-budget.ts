import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

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
export interface ContextBudgetSnapshot {
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

/**
 * The renderer's preview reference for a budget. It carries only a draft reference; the model facts,
 * reserves, and token counts are resolved server-side (never trusted from the renderer).
 */
export interface PreviewContextBudgetCommand {
  readonly projectId: string;
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
): Result<ContextBudgetSnapshot, UnifiedError> {
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
  const safeInputBudget = input.contextWindow - outputReserve - input.toolReserve - input.systemReserve;
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
 * One deterministic UTF-8 estimator used when no provider tokenizer is injected. It approximates a
 * token as four UTF-8 bytes — coarse, but stable and provider-independent — and always marks its
 * output `estimated` so downstream accounting never mistakes it for reported usage.
 */
export function createDeterministicTokenEstimator(): AgentTokenEstimator {
  return {
    count(text: string): AgentTokenCount {
      const bytes = utf8ByteLength(text);
      return { tokens: Math.ceil(bytes / 4), precision: "estimated" };
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
