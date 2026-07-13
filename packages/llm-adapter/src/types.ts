import type { JsonObject, JsonValue, Result, UnifiedError } from "@novel-studio/shared";

export type LlmProviderId =
  | "mock"
  | "openai-compatible"
  | "openai"
  | "anthropic"
  | "google-gemini"
  | "openrouter"
  | "deepseek"
  | "zhipu"
  | "tongyi-qianwen"
  | "ollama"
  | "lm-studio"
  | "vllm";

export type LlmMode = "streaming" | "non-streaming";

export type LlmMessageRole = "system" | "developer" | "user" | "assistant" | "tool";

export interface LlmMessage {
  readonly role: LlmMessageRole;
  readonly content: string;
  readonly toolCallId?: string;
  readonly toolCalls?: readonly {
    readonly id: string;
    readonly name: string;
    readonly arguments: string;
  }[];
}

export interface LlmToolDefinition {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description?: string;
    readonly parameters?: JsonObject;
  };
}

export interface LlmModelProfile {
  readonly id: string;
  readonly provider: LlmProviderId;
  readonly displayName: string;
  readonly modelName: string;
  readonly baseUrl?: string;
  readonly apiKeyRef?: string;
  readonly timeoutMs?: number;
  readonly tokenPricing?: LlmTokenPricing;
}

export interface LlmTokenPricing {
  readonly inputPerMillion: number;
  readonly outputPerMillion: number;
  readonly currency: string;
}

export interface LlmParameters {
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly topP?: number;
  readonly reasoningEffort?: LlmReasoningEffort;
}

export type LlmReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface LlmRequest {
  readonly schemaVersion: "1.0";
  readonly requestId: string;
  readonly traceId: string;
  readonly mode: LlmMode;
  readonly modelProfile: LlmModelProfile;
  readonly messages: readonly LlmMessage[];
  readonly parameters: LlmParameters;
  readonly abortSignal?: AbortSignal;
  readonly responseFormat?: JsonValue;
  readonly tools?: readonly LlmToolDefinition[];
}

export interface LlmTextContent {
  readonly type: "text";
  readonly value: string;
}

export interface LlmJsonContent {
  readonly type: "json";
  readonly value: JsonValue;
}

export type LlmContent = LlmTextContent | LlmJsonContent;

export type LlmUsageStatus = "missing" | "estimated" | "actual";
export type LlmCostStatus = "unknown" | "estimated" | "actual";

export interface LlmCost {
  readonly amount: number;
  readonly currency: string;
  readonly status: LlmCostStatus;
}

export interface LlmUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly usageStatus: LlmUsageStatus;
  readonly cost: LlmCost;
}

export interface LlmProviderWarning {
  readonly type: "warning";
  readonly code: string;
  readonly message: string;
}

export type LlmErrorCode =
  | "LLM_TIMEOUT"
  | "LLM_RATE_LIMITED"
  | "LLM_RETRY_EXHAUSTED"
  | "LLM_PROVIDER_ERROR"
  | "LLM_MALFORMED_RESPONSE"
  | "LLM_UNSUPPORTED_MODE"
  | "LLM_ABORTED";

export interface LlmRetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly backoffMultiplier: number;
  readonly retryableCodes: readonly LlmErrorCode[];
}

export type LlmScheduler = (delayMs: number) => Promise<void>;

export interface LlmResponse {
  readonly schemaVersion: "1.0";
  readonly requestId: string;
  readonly provider: LlmProviderId;
  readonly modelName: string;
  readonly status: "success";
  readonly content: LlmContent;
  readonly usage: LlmUsage;
  readonly warnings?: readonly LlmProviderWarning[];
  readonly createdAt: string;
}

export interface LlmStreamStartEvent {
  readonly type: "start";
  readonly requestId: string;
  readonly provider: LlmProviderId;
  readonly modelName: string;
  readonly createdAt: string;
}

export interface LlmStreamDeltaEvent {
  readonly type: "delta";
  readonly value: string;
}

export interface LlmStreamUsageEvent {
  readonly type: "usage";
  readonly usage: LlmUsage;
}

export interface LlmStreamDoneEvent {
  readonly type: "done";
  readonly requestId: string;
  readonly provider: LlmProviderId;
  readonly modelName: string;
  readonly createdAt: string;
}

export interface LlmStreamToolCallDeltaEvent {
  readonly type: "tool_call_delta";
  readonly toolCallId: string;
  readonly name?: string;
  readonly argumentsDelta?: string;
}

export interface LlmStreamRoundCompletedEvent {
  readonly type: "round_completed";
  readonly finishReason: "tool_calls" | "stop";
}

export type LlmStreamEvent =
  | LlmStreamStartEvent
  | LlmStreamDeltaEvent
  | LlmStreamUsageEvent
  | LlmStreamDoneEvent
  | LlmStreamToolCallDeltaEvent
  | LlmStreamRoundCompletedEvent
  | LlmProviderWarning;

export type LlmStreamResult = Result<LlmStreamEvent, UnifiedError>;

export interface LlmProviderCompletion {
  readonly content: LlmContent;
  readonly usage?: LlmUsage;
  readonly warnings?: readonly LlmProviderWarning[];
}

export type LlmProviderStreamEvent =
  | LlmStreamDeltaEvent
  | LlmStreamUsageEvent
  | LlmStreamToolCallDeltaEvent
  | LlmStreamRoundCompletedEvent
  | LlmProviderWarning;

export interface LlmProvider {
  readonly id: LlmProviderId;
  complete(request: LlmRequest): Promise<LlmProviderCompletion>;
  stream(request: LlmRequest): AsyncIterable<LlmProviderStreamEvent>;
}

export interface LlmAdapter {
  complete(request: LlmRequest): Promise<Result<LlmResponse, UnifiedError>>;
  stream(request: LlmRequest): AsyncIterable<LlmStreamResult>;
}

export interface LlmAdapterOptions {
  readonly provider: LlmProvider;
  readonly clock?: () => string;
  readonly retryPolicy?: LlmRetryPolicy;
  readonly scheduler?: LlmScheduler;
}

export interface LlmProviderFailureInput {
  readonly code: LlmErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly redactedDetail?: JsonObject;
}
