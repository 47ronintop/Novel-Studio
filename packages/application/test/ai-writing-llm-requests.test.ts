import { describe, expect, test } from "vitest";

import {
  createChapterSuggestionLlmRequest,
  validateWritingRequestContextBudget
} from "../src/ai-writing-llm-requests.js";

const modelProfile = {
  id: "model_test",
  provider: "openai-compatible" as const,
  displayName: "Test model",
  modelName: "test-model"
};

describe("AI writing request context budget", () => {
  test("accepts a serialized request that fits the input budget", () => {
    const request = createChapterSuggestionLlmRequest({
      workflowRunId: "run_fit",
      instruction: "Continue.",
      currentBody: "Short body.",
      contextTrace: { includedRefs: [], excludedRefs: [], selectionReason: "test" },
      modelProfile,
      parameters: { maxTokens: 32 },
      conversationMessages: []
    });

    const result = validateWritingRequestContextBudget({
      request,
      contextWindow: 10_000
    });

    expect(result.ok).toBe(true);
  });

  test("rejects a request when maxTokens leaves no room for its serialized input", () => {
    const request = createChapterSuggestionLlmRequest({
      workflowRunId: "run_overflow",
      instruction: "Continue this very long instruction.",
      currentBody: "A".repeat(200),
      contextTrace: { includedRefs: [], excludedRefs: [], selectionReason: "test" },
      modelProfile,
      parameters: { maxTokens: 64 },
      conversationMessages: []
    });

    const result = validateWritingRequestContextBudget({
      request,
      contextWindow: 256
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "AI_WORKFLOW_CONTEXT_BUDGET_EXCEEDED" }
    });
  });
});
