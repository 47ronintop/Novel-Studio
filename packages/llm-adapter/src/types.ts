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

/** Provider request field represented by the normalized reasoning control. */
export type LlmReasoningProviderParamName =
  | "reasoning_effort"
  | "reasoning"
  | "anthropic_effort"
  | "anthropic_thinking_budget"
  | "gemini_thinking_level"
  | "gemini_thinking_budget";

/** Main-authored, model-specific reasoning contract accepted by a provider adapter. */
export interface LlmReasoningCapability {
  readonly providerParamName: LlmReasoningProviderParamName;
  readonly allowedValues: readonly string[];
  readonly defaultValue: string;
}

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
    /** Provider-owned continuation state that must be replayed with this tool call. */
    readonly providerMetadata?: JsonObject;
  }[];
}

export interface LlmToolDefinition {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description?: string;
    readonly parameters?: JsonObject;
    /** Request provider-side strict argument validation when the protocol supports it. */
    readonly strict?: boolean;
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
  /** Explicitly enables generic reasoning controls for an endpoint without model metadata. */
  readonly reasoningEffortEnabled?: boolean;
  /** Frozen capability resolved by Main; null explicitly forbids static or manual fallback. */
  readonly reasoningCapability?: LlmReasoningCapability | null;
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

/** Provider-declared string; callers must validate it against the selected model's capabilities. */
export type LlmReasoningEffort = string;

export type LlmPromptCacheMode =
  "none" | "automatic_prefix" | "explicit_breakpoints" | "explicit_resource";

export type LlmCacheOutcome = "hit" | "miss" | "bypass" | "unknown";
export type LlmCacheUsageStatus = "actual" | "derived" | "unavailable";
export type LlmCacheInputTokenSemantics =
  "included_in_input" | "excluded_from_input" | "unavailable";

export type LlmPromptCacheBypassReason =
  | "policy_none"
  | "unsupported_provider"
  | "below_minimum_tokens"
  | "identity_unverified"
  | "resource_unavailable"
  | "resource_create_failed"
  | "resource_expired"
  | "cache_error"
  | "usage_unavailable";

/** Main-authored cache metadata. Provider adapters may consume it but never derive its identity. */
export interface LlmPromptCacheRequest {
  readonly mode: LlmPromptCacheMode;
  readonly policyVersion: string;
  readonly identityChecksum: string;
  /** Main-only frozen endpoint identity used to verify a live explicit resource lookup. */
  readonly connectionIdentityChecksum?: string;
  /** Main-only frozen account identity used to verify a live explicit resource lookup. */
  readonly accountIsolationChecksum?: string;
  readonly logicalPrefixChecksum: string;
  /** Number of leading `messages` entries in the stable prefix, including the system message. */
  readonly stablePrefixMessageCount: number;
  readonly minimumCacheableTokens: number;
  readonly eligibleInputTokens?: number;
  readonly ttlSeconds?: number;
  /** Main-owned opaque provider resource name. It must never be rendered or written to usage data. */
  readonly resourceRef?: string;
  /** Checksum of the provider-native bytes used to create an explicit resource. */
  readonly physicalPrefixChecksum?: string;
  /** Provider-reported tokens written while Main created an explicit resource for this request. */
  readonly resourceWriteTokens?: number;
  readonly bypassReason?: LlmPromptCacheBypassReason;
}

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
  readonly promptCache?: LlmPromptCacheRequest;
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
  readonly cachedTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly cacheEligibleInputTokens?: number;
  readonly cacheOutcome?: LlmCacheOutcome;
  readonly cacheBypassReason?: LlmPromptCacheBypassReason;
  readonly cacheUsageStatus?: LlmCacheUsageStatus;
  readonly cacheInputTokenSemantics?: LlmCacheInputTokenSemantics;
  readonly cachePhysicalPrefixChecksum?: string;
  readonly reasoningTokens?: number;
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
  /** Provider-owned continuation state; callers must preserve it without interpreting it. */
  readonly providerMetadata?: JsonObject;
}

/**
 * All provider-declared finish reasons surfaced through the stream pipeline.
 * Values beyond `tool_calls` and `stop` indicate truncated or interrupted rounds
 * and MUST NOT trigger tool-call execution — the agent loop enforces fail-closed
 * dispatch based on this value.
 */
export type LlmRoundFinishReason =
  "tool_calls" | "stop" | "length" | "content_filter" | "aborted" | "error" | "unknown";

export interface LlmStreamRoundCompletedEvent {
  readonly type: "round_completed";
  readonly finishReason: LlmRoundFinishReason;
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
