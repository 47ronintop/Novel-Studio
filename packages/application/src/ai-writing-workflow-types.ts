import type { ContextBundleTrace } from "@novel-studio/context-engine";
import type {
  LlmAdapter,
  LlmCostStatus,
  LlmModelProfile,
  LlmParameters,
  LlmProviderId,
  LlmReasoningEffort,
  LlmUsage,
  LlmUsageStatus
} from "@novel-studio/llm-adapter";
import type { JsonObject, Recoverability, Result, UnifiedError } from "@novel-studio/shared";

import type {
  ChapterEditorSession,
  ChapterEditorSnapshot,
  ChapterSuggestionDiffPreview
} from "./chapter-editor-session.js";
import type { AiWritingStyleReview } from "./ai-writing-style-rules.js";
import type { ModelRuntimeProfile } from "./model-settings-session.js";

export interface AiWritingSuggestionRequest {
  readonly instruction: string;
  readonly reasoningEffort?: LlmReasoningEffort;
}

export interface AiWritingSuggestionStreamRequest extends AiWritingSuggestionRequest {
  readonly abortSignal?: AbortSignal;
}

export interface AiWritingSuggestionStreamStartRequest extends AiWritingSuggestionRequest {
  readonly streamId: string;
}

export interface AiWritingConversationMessage {
  readonly messageId: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly createdAt: string;
  readonly workflowRunId?: string;
  readonly suggestionId?: string;
}

export interface AiWritingSelectionRange {
  readonly startOffset: number;
  readonly endOffset: number;
  readonly selectedText: string;
}

export interface AiWritingSelectionPreviewRequest {
  readonly instruction: string;
  readonly selection: AiWritingSelectionRange;
}

export interface AiWritingSuggestion {
  readonly suggestionId: string;
  readonly workflowRunId: string;
  readonly status: "pending-confirmation" | "applied";
  readonly proposedBody: string;
  readonly summary: string;
  readonly runtimeNotice?: string;
  readonly conversationMessages: readonly AiWritingConversationMessage[];
  readonly styleReview: AiWritingStyleReview;
  readonly diffPreview: ChapterSuggestionDiffPreview;
  readonly contextTrace: ContextBundleTrace;
  readonly observability: AiWritingWorkflowObservability;
}

export type AiWritingSuggestionStreamEvent =
  | {
      readonly type: "delta";
      readonly value: string;
    }
  | {
      readonly type: "notice";
      readonly message: string;
    }
  | {
      readonly type: "suggestion";
      readonly suggestion: AiWritingSuggestion;
    };

export interface AiWritingSuggestionStreamHandle {
  readonly streamId: string;
}

export type AiWritingSuggestionStreamPushEvent =
  | {
      readonly streamId: string;
      readonly sequence: number;
      readonly type: "event";
      readonly event: AiWritingSuggestionStreamEvent;
    }
  | {
      readonly streamId: string;
      readonly sequence: number;
      readonly type: "error";
      readonly error: UnifiedError;
    }
  | {
      readonly streamId: string;
      readonly sequence: number;
      readonly type: "completed";
    };

export type AiWritingSuggestionStreamNext =
  | {
      readonly done: true;
    }
  | {
      readonly done: false;
      readonly event: AiWritingSuggestionStreamEvent;
    };

export interface AiWritingSelectionPreview {
  readonly previewId: string;
  readonly workflowRunId: string;
  readonly previewOnly: true;
  readonly proposedText: string;
  readonly summary: string;
  readonly styleReview: AiWritingStyleReview;
  readonly review: AiWritingSelectionReview;
  readonly selection: AiWritingSelectionRange;
  readonly diffPreview: ChapterSuggestionDiffPreview;
  readonly contextTrace: ContextBundleTrace;
  readonly observability: AiWritingWorkflowObservability;
}

export interface AiWritingSelectionReview {
  readonly status: "pending";
  readonly originalText: string;
  readonly proposedText: string;
  readonly rangeLabel: string;
  readonly compareLabel: string;
}

export type AiWorkflowObservedStepKind = "context" | "agent" | "confirmation";
export type AiWorkflowObservedStepStatus =
  "pending" | "running" | "completed" | "waiting-confirmation" | "failed";

export interface AiWorkflowObservedStep {
  readonly stepId: string;
  readonly label: string;
  readonly kind: AiWorkflowObservedStepKind;
  readonly status: AiWorkflowObservedStepStatus;
}

export interface AiWritingWorkflowObservability {
  readonly workflowRunId: string;
  readonly workflowTitle: string;
  readonly generatedAt: string;
  readonly context: {
    readonly sourceCount: number;
    readonly tokenEstimate: number;
    readonly selectionReason: string;
  };
  readonly model: {
    readonly profileId: string;
    readonly displayName: string;
    readonly provider: LlmProviderId;
    readonly modelName: string;
  };
  readonly usage: LlmUsage;
  readonly steps: readonly AiWorkflowObservedStep[];
}

export type WorkflowRunRecordStatus = "pending-confirmation" | "applied" | "failed";

export interface WorkflowRunContextSummary extends JsonObject {
  sourceCount: number;
  tokenEstimate: number;
  selectionReason: string;
}

export interface WorkflowRunModelSummary extends JsonObject {
  profileId: string;
  displayName: string;
  provider: string;
  modelName: string;
}

export interface WorkflowRunCostSummary extends JsonObject {
  amount: number;
  currency: string;
  status: LlmCostStatus;
}

export interface WorkflowRunUsageSummary extends JsonObject {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  usageStatus: LlmUsageStatus;
  cost: WorkflowRunCostSummary;
}

export interface WorkflowRunStepRecord extends JsonObject {
  stepId: string;
  label: string;
  kind: AiWorkflowObservedStepKind;
  status: AiWorkflowObservedStepStatus;
}

export interface WorkflowRunErrorSummary extends JsonObject {
  code: string;
  message: string;
  recoverability?: Recoverability;
  suggestedAction?: string;
  retryable?: boolean;
}

export interface WorkflowRunRetryPolicySummary extends JsonObject {
  mode: "manual";
  maxAttempts: number;
  backoffLabel: string;
  retryableCodes: string[];
}

export interface WorkflowRunRecord extends JsonObject {
  schemaVersion: "1.0";
  workflowRunId: string;
  workflowId: string;
  workflowTitle: string;
  status: WorkflowRunRecordStatus;
  startedAt: string;
  updatedAt: string;
  context: WorkflowRunContextSummary;
  model: WorkflowRunModelSummary;
  usage: WorkflowRunUsageSummary;
  steps: WorkflowRunStepRecord[];
  error?: WorkflowRunErrorSummary;
  retryPolicy?: WorkflowRunRetryPolicySummary;
}

export interface WorkflowRunSummary extends JsonObject {
  workflowRunId: string;
  workflowTitle: string;
  status: WorkflowRunRecordStatus;
  updatedAt: string;
  modelLabel: string;
  usageLabel: string;
  costLabel: string;
}

export interface WorkflowRunHistoryPort {
  recordWorkflowRun(record: WorkflowRunRecord): Promise<Result<WorkflowRunRecord, UnifiedError>>;
  listWorkflowRuns(): Promise<Result<WorkflowRunSummary[], UnifiedError>>;
  readWorkflowRun(workflowRunId: string): Promise<Result<WorkflowRunRecord, UnifiedError>>;
}

export interface AiWritingWorkflowSession {
  generateChapterSuggestion(
    request: AiWritingSuggestionRequest
  ): Promise<Result<AiWritingSuggestion, UnifiedError>>;
  streamChapterSuggestion(
    request: AiWritingSuggestionStreamRequest
  ): AsyncIterable<Result<AiWritingSuggestionStreamEvent, UnifiedError>>;
  generateSelectionPreview(
    request: AiWritingSelectionPreviewRequest
  ): Promise<Result<AiWritingSelectionPreview, UnifiedError>>;
  applySelectionPreview(previewId: string): Promise<Result<ChapterEditorSnapshot, UnifiedError>>;
  applyChapterSuggestion(
    suggestionId: string
  ): Promise<Result<ChapterEditorSnapshot, UnifiedError>>;
}

export interface AiWritingWorkflowSessionOptions {
  readonly chapterEditorSession: ChapterEditorSession;
  readonly llmAdapter: LlmAdapter;
  readonly modelProfile?: LlmModelProfile;
  readonly parameters?: LlmParameters;
  readonly resolveModelRuntimeProfile?: () => Promise<Result<ModelRuntimeProfile, UnifiedError>>;
  readonly now?: () => string;
  readonly createWorkflowRunId?: () => string;
  readonly createSuggestionId?: () => string;
  readonly createConversationMessageId?: () => string;
  readonly createAgentRunId?: () => string;
  readonly createHandoffId?: () => string;
  readonly workflowRunHistory?: Pick<WorkflowRunHistoryPort, "recordWorkflowRun">;
}
