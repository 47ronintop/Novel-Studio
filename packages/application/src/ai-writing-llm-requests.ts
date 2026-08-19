import type { ContextBundleItem, ContextBundleTrace } from "@novel-studio/context-engine";
import type {
  LlmMode,
  LlmModelProfile,
  LlmParameters,
  LlmRequest
} from "@novel-studio/llm-adapter";

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
