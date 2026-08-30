import type { ContextBundleItem, ContextBundleTrace } from "@novel-studio/context-engine";
import { calculateContextBudget, createDeterministicTokenEstimator } from "@novel-studio/agent-engine";
import type {
  LlmMode,
  LlmModelProfile,
  LlmParameters,
  LlmRequest
} from "@novel-studio/llm-adapter";
import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import type {
  AiWritingConversationMessage,
  AiWritingSelectionRange
} from "./ai-writing-workflow-types.js";
import { formatAiWritingStyleRulesForPrompt } from "./ai-writing-style-rules.js";

export function createChapterSuggestionLlmRequest(input: {
  readonly workflowRunId: string;
  readonly instruction: string;
  readonly currentBody: string;
  readonly contextTrace: ContextBundleTrace;
  readonly modelProfile: LlmModelProfile;
  readonly parameters: LlmParameters;
  readonly conversationMessages: readonly AiWritingConversationMessage[];
  readonly contextItems?: readonly ContextBundleItem[];
  readonly promptTemplate?: string;
  readonly mode?: LlmMode;
  readonly abortSignal?: AbortSignal;
}): LlmRequest {
  const request: LlmRequest = {
    schemaVersion: "1.0",
    requestId: `llm_${input.workflowRunId}`,
    traceId: "ai-writing-workflow",
    mode: input.mode ?? "non-streaming",
    modelProfile: input.modelProfile,
    messages: [
      {
        role: "system",
        content: [
          input.promptTemplate ??
            "Return JSON with proposedBody and summary for a chapter writing suggestion.",
          formatAiWritingStyleRulesForPrompt()
        ].join("\n\n")
      },
      {
        role: "user",
        content: [
          `Instruction: ${input.instruction}`,
          formatPreviousConversation(input.conversationMessages),
          `Current chapter body:\n${input.currentBody}`,
          formatContextItems(input.contextItems),
          `Available context refs: ${input.contextTrace.includedRefs
            .map((ref) => `${ref.refType}:${ref.refId}`)
            .join(", ")}`
        ]
          .filter((section) => section.length > 0)
          .join("\n\n")
      }
    ],
    parameters: input.parameters,
    responseFormat: {
      type: "json_object"
    }
  };

  return input.abortSignal === undefined
    ? request
    : {
        ...request,
        abortSignal: input.abortSignal
      };
}

export function createSelectionPreviewLlmRequest(input: {
  readonly workflowRunId: string;
  readonly instruction: string;
  readonly selection: AiWritingSelectionRange;
  readonly modelProfile: LlmModelProfile;
  readonly parameters: LlmParameters;
  readonly contextItems?: readonly ContextBundleItem[];
  readonly promptTemplate?: string;
}): LlmRequest {
  return {
    schemaVersion: "1.0",
    requestId: `llm_${input.workflowRunId}`,
    traceId: "ai-selection-preview",
    mode: "non-streaming",
    modelProfile: input.modelProfile,
    messages: [
      {
        role: "system",
        content: [
          input.promptTemplate ??
            "Return JSON with proposedText and summary for a selected text rewrite.",
          formatAiWritingStyleRulesForPrompt()
        ].join("\n\n")
      },
      {
        role: "user",
        content: [
          `Instruction: ${input.instruction}`,
          `Selection offsets: ${input.selection.startOffset}-${input.selection.endOffset}`,
          `Selected text: ${input.selection.selectedText}`,
          formatContextItems(input.contextItems)
        ].join("\n")
      }
    ],
    parameters: input.parameters,
    responseFormat: {
      type: "json_object"
    }
  };
}

export function withRequestedReasoningEffort(
  parameters: LlmParameters,
  reasoningEffort: LlmParameters["reasoningEffort"] | undefined
): LlmParameters {
  return reasoningEffort === undefined ? parameters : { ...parameters, reasoningEffort };
}

/**
 * Guard legacy writing requests at the provider boundary. The old workflow's context bundle limit
 * only covers selected material, so this check measures the fully serialized request as sent.
 * Unknown windows remain compatible with older callers; modern runtimes fail closed before start.
 */
export function validateWritingRequestContextBudget(input: {
  readonly request: Pick<
    LlmRequest,
    "requestId" | "traceId" | "messages" | "responseFormat" | "parameters" | "modelProfile"
  >;
  readonly contextWindow?: number;
}): Result<void, UnifiedError> {
  if (input.contextWindow === undefined) return ok(undefined);

  const serialized = JSON.stringify({
    messages: input.request.messages,
    responseFormat: input.request.responseFormat
  });
  const estimatedTokens = createDeterministicTokenEstimator().count(
    serialized,
    input.request.modelProfile.id
  ).tokens;
  const budget = calculateContextBudget({
    contextBudgetSnapshotId: `legacy_${input.request.requestId}`,
    provider: input.request.modelProfile.provider,
    model: input.request.modelProfile.modelName,
    contextWindow: input.contextWindow,
    ...(input.request.parameters.maxTokens === undefined
      ? {}
      : { maxOutputTokens: input.request.parameters.maxTokens }),
    toolReserve: 0,
    systemReserve: 0,
    requiredContextTokens: estimatedTokens,
    usedTokens: estimatedTokens,
    precision: "estimated",
    calculatedAt: new Date().toISOString()
  });
  if (budget.ok) return ok(undefined);

  return err(
    createUnifiedError({
      code: "AI_WORKFLOW_CONTEXT_BUDGET_EXCEEDED",
      category: "UserError",
      message: "The AI writing request exceeds the selected model's context window.",
      recoverability: "user-action",
      suggestedAction: "Shorten the chapter or conversation, or choose a model with a larger context window.",
      traceId: input.request.traceId,
      redactedDetail: {
        contextWindow: input.contextWindow,
        estimatedInputTokens: estimatedTokens,
        maxOutputTokens: input.request.parameters.maxTokens ?? null
      }
    })
  );
}

function formatPreviousConversation(messages: readonly AiWritingConversationMessage[]): string {
  if (messages.length === 0) {
    return "";
  }

  return [
    "Previous conversation:",
    ...messages.map((message) => {
      const label = message.role === "user" ? "User" : "Assistant";
      return `${label}: ${message.content}`;
    })
  ].join("\n");
}

function formatContextItems(items: readonly ContextBundleItem[] | undefined): string {
  if (items === undefined || items.length === 0) return "";
  return [
    "Context material:",
    ...items.map((item) => `[${item.refType}:${item.refId}]\n${item.content}`)
  ].join("\n\n");
}
