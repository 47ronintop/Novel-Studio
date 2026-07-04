import { err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import { contextError } from "./errors.js";
import type {
  ContextBuildInput,
  ContextBundle,
  ContextBundleItem,
  ContextCandidate,
  ContextExcludedRef,
  ContextIncludedRef,
  MemoryConfidence
} from "./types.js";

const DEFAULT_ALLOWED_MEMORY_CONFIDENCE: readonly MemoryConfidence[] = ["confirmed"];
const DEFAULT_MAX_CHAPTER_CANDIDATES = 3;

export function buildContextBundle(input: ContextBuildInput): Result<ContextBundle, UnifiedError> {
  const budgetValidation = validateBudget(input);
  if (!budgetValidation.ok) {
    return budgetValidation;
  }

  const stuffingValidation = validateChapterCandidateLimit(input);
  if (!stuffingValidation.ok) {
    return stuffingValidation;
  }

  const tokenEstimator = input.tokenEstimator ?? estimateTokens;
  const allowedMemoryConfidence =
    input.policy?.memoryConfidence ?? DEFAULT_ALLOWED_MEMORY_CONFIDENCE;
  const candidates = sortCandidates(input.candidates);
  const items: ContextBundleItem[] = [];
  const includedRefs: ContextIncludedRef[] = [];
  const excludedRefs: ContextExcludedRef[] = [];
  let estimatedTokens = 0;

  for (const candidate of candidates) {
    const tokenEstimate = estimateCandidateTokens(candidate, tokenEstimator);

    if (!isMemoryAllowed(candidate, allowedMemoryConfidence)) {
      excludedRefs.push(excludedRef(candidate, "memory_confidence_filtered", tokenEstimate));
      continue;
    }

    if (estimatedTokens + tokenEstimate > input.budget.maxTokens) {
      excludedRefs.push(excludedRef(candidate, "budget_exceeded", tokenEstimate));
      continue;
    }

    items.push({
      refType: candidate.refType,
      refId: candidate.refId,
      content: candidate.content,
      tokenEstimate,
      sourceRefs: candidate.sourceRefs
    });
    includedRefs.push({
      refType: candidate.refType,
      refId: candidate.refId,
      tokenEstimate
    });
    estimatedTokens += tokenEstimate;
  }

  return ok({
    schemaVersion: "1.0",
    contextBundleId: input.contextBundleId,
    workflowRunId: input.workflowRunId,
    budget: {
      maxTokens: input.budget.maxTokens,
      estimatedTokens
    },
    items,
    trace: {
      selectionReason: input.goal,
      includedRefs,
      excludedRefs
    }
  });
}

function validateBudget(input: ContextBuildInput): Result<true, UnifiedError> {
  if (!Number.isInteger(input.budget.maxTokens) || input.budget.maxTokens < 1) {
    return err(
      contextError({
        code: "CONTEXT_BUDGET_INVALID",
        message: "Context budget maxTokens must be a positive integer.",
        suggestedAction: "Set a positive context token budget before building context.",
        traceId: input.traceId,
        redactedDetail: { maxTokens: input.budget.maxTokens }
      })
    );
  }

  return ok(true);
}

function validateChapterCandidateLimit(input: ContextBuildInput): Result<true, UnifiedError> {
  const maxChapterCandidates = input.policy?.maxChapterCandidates ?? DEFAULT_MAX_CHAPTER_CANDIDATES;
  const chapterCandidateCount = input.candidates.filter(
    (candidate) => candidate.refType === "chapter"
  ).length;

  if (chapterCandidateCount > maxChapterCandidates) {
    return err(
      contextError({
        code: "CONTEXT_FULL_NOVEL_STUFFING_BLOCKED",
        message: "Context build rejected too many chapter candidates in one request.",
        suggestedAction:
          "Pass explicit chapter fragments or lower the chapter candidate count before retrying.",
        traceId: input.traceId,
        redactedDetail: {
          chapterCandidateCount,
          maxChapterCandidates
        }
      })
    );
  }

  return ok(true);
}

function sortCandidates(candidates: readonly ContextCandidate[]): readonly ContextCandidate[] {
  return candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((left, right) => {
      const priorityDelta = left.candidate.priority - right.candidate.priority;
      return priorityDelta === 0 ? left.index - right.index : priorityDelta;
    })
    .map((entry) => entry.candidate);
}

function estimateCandidateTokens(
  candidate: ContextCandidate,
  tokenEstimator: (content: string) => number
): number {
  if (candidate.tokenEstimate !== undefined) {
    return candidate.tokenEstimate;
  }

  return tokenEstimator(candidate.content);
}

function estimateTokens(content: string): number {
  const nonWhitespaceCharacters = content.replace(/\s/g, "").length;
  return Math.ceil(nonWhitespaceCharacters / 4);
}

function isMemoryAllowed(
  candidate: ContextCandidate,
  allowedMemoryConfidence: readonly MemoryConfidence[]
): boolean {
  if (candidate.refType !== "memory") {
    return true;
  }

  return (
    candidate.memoryConfidence !== undefined &&
    allowedMemoryConfidence.includes(candidate.memoryConfidence)
  );
}

function excludedRef(
  candidate: ContextCandidate,
  reason: ContextExcludedRef["reason"],
  tokenEstimate: number
): ContextExcludedRef {
  return {
    refType: candidate.refType,
    refId: candidate.refId,
    reason,
    tokenEstimate
  };
}
