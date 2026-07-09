import { buildContextBundle, type ContextBundleTrace } from "@novel-studio/context-engine";
import type { LlmModelProfile, LlmParameters, LlmUsage } from "@novel-studio/llm-adapter";
import {
  completeWorkflowStep,
  evaluateNextWorkflowAction,
  parseWorkflowDefinition,
  startWorkflowRun,
  type WorkflowDefinition,
  type WorkflowRunState
} from "@novel-studio/workflow-engine";
import {
  createUnifiedError,
  err,
  ok,
  type JsonObject,
  type Result,
  type UnifiedError
} from "@novel-studio/shared";

import type { ModelRuntimeProfile } from "./model-settings-session.js";
import { createChapterSuggestionLlmRequest } from "./ai-writing-llm-requests.js";
import { warningRuntimeNotice } from "./ai-writing-runtime-notices.js";
import { reviewAiWritingStyle } from "./ai-writing-style-rules.js";
import type {
  AiWritingConversationMessage,
  AiWritingSuggestion,
  AiWritingSuggestionStreamEvent,
  AiWritingSuggestionStreamRequest,
  AiWritingWorkflowObservability,
  AiWritingWorkflowSessionOptions,
  WorkflowRunErrorSummary,
  WorkflowRunRecord,
  WorkflowRunRecordStatus,
  WorkflowRunRetryPolicySummary
} from "./ai-writing-workflow-types.js";

const streamingWorkflowDefinition: WorkflowDefinition = {
  schemaVersion: "1.0",
  id: "wf_ai_continue_chapter",
  type: "workflow.definition",
  title: "Continue Chapter",
  status: "active",
  entryStepId: "build_context",
  steps: [
    { id: "build_context", kind: "context", nextStepId: "write_suggestion" },
    {
      id: "write_suggestion",
      kind: "agent",
      agentId: "agent_chapter_writer",
      nextStepId: "confirm_apply"
    },
    { id: "confirm_apply", kind: "confirmation" }
  ],
  createdAt: "2026-07-04T00:00:00.000Z",
  updatedAt: "2026-07-04T00:00:00.000Z"
};

export interface StreamChapterSuggestionForSessionInput {
  readonly options: AiWritingWorkflowSessionOptions;
  readonly request: AiWritingSuggestionStreamRequest;
  readonly conversationMessages: AiWritingConversationMessage[];
  readonly now: () => string;
  readonly createWorkflowRunId: () => string;
  readonly createSuggestionId: () => string;
  readonly createConversationMessageId: () => string;
  readonly storeSuggestion: (stored: {
    readonly suggestion: AiWritingSuggestion;
    readonly workflow: WorkflowDefinition;
    readonly runState: WorkflowRunState;
  }) => void;
}

export async function* streamChapterSuggestionForSession(
  input: StreamChapterSuggestionForSessionInput
): AsyncIterable<Result<AiWritingSuggestionStreamEvent, UnifiedError>> {
  const { options, request, now } = input;
  const chapterState = options.chapterEditorSession.getState();
  if (chapterState === undefined) {
    yield aiWorkflowError({
      code: "AI_WORKFLOW_CHAPTER_NOT_LOADED",
      message: "No active chapter is loaded for AI writing.",
      suggestedAction: "Open a project chapter before generating AI writing suggestions."
    });
    return;
  }

  const parsedWorkflow = parseWorkflowDefinition(streamingWorkflowDefinition, {
    traceId: "ai-writing-workflow"
  });
  if (!parsedWorkflow.ok) {
    yield parsedWorkflow;
    return;
  }

  let runState = startWorkflowRun(parsedWorkflow.value, {
    workflowRunId: input.createWorkflowRunId(),
    traceId: "ai-writing-workflow",
    now
  });

  const contextAction = evaluateNextWorkflowAction(parsedWorkflow.value, runState);
  if (!contextAction.ok) {
    yield contextAction;
    return;
  }
  if (contextAction.value.kind !== "build-context") {
    yield invalidWorkflowAction(contextAction.value.kind);
    return;
  }

  const contextBundle = buildContextBundle({
    schemaVersion: "1.0",
    contextBundleId: `ctx_${runState.workflowRunId}`,
    workflowRunId: runState.workflowRunId,
    traceId: "ai-writing-workflow",
    goal: request.instruction,
    budget: { maxTokens: 1024 },
    candidates: [
      {
        refType: "chapter",
        refId: chapterState.chapter.frontmatter.id,
        content: chapterState.chapter.body,
        priority: 1,
        tokenEstimate: 4,
        sourceRefs: [
          {
            entityType: "chapter",
            entityId: chapterState.chapter.frontmatter.id
          }
        ]
      }
    ]
  });
  if (!contextBundle.ok) {
    yield contextBundle;
    return;
  }

  const afterContext = completeWorkflowStep(parsedWorkflow.value, runState, {
    stepId: contextAction.value.stepId,
    traceId: "ai-writing-workflow",
    now
  });
  if (!afterContext.ok) {
    yield afterContext;
    return;
  }
  runState = afterContext.value;

  const agentAction = evaluateNextWorkflowAction(parsedWorkflow.value, runState);
  if (!agentAction.ok) {
    yield agentAction;
    return;
  }
  if (agentAction.value.kind !== "run-agent") {
    yield invalidWorkflowAction(agentAction.value.kind);
    return;
  }

  const runtimeProfile = await resolveModelRuntimeProfile(options);
  if (!runtimeProfile.ok) {
    yield runtimeProfile;
    return;
  }

  const llmRequest = createChapterSuggestionLlmRequest({
    workflowRunId: runState.workflowRunId,
    instruction: request.instruction,
    currentBody: chapterState.chapter.body,
    contextTrace: contextBundle.value.trace,
    modelProfile: runtimeProfile.value.modelProfile,
    parameters: withRequestedReasoningEffort(
      runtimeProfile.value.parameters,
      request.reasoningEffort
    ),
    conversationMessages: input.conversationMessages,
    mode: "streaming",
    ...(request.abortSignal === undefined ? {} : { abortSignal: request.abortSignal })
  });
  let streamedText = "";
  let usage = missingWorkflowUsage();
  let runtimeNotice: string | undefined;

  try {
    for await (const result of options.llmAdapter.stream(llmRequest)) {
      if (request.abortSignal?.aborted === true) {
        return;
      }
      if (!result.ok) {
        await recordFailedRun({
          options,
          workflowId: parsedWorkflow.value.id,
          runState,
          generatedAt: now(),
          contextTrace: contextBundle.value.trace,
          modelProfile: runtimeProfile.value.modelProfile,
          workflowTitle: parsedWorkflow.value.title,
          error: result.error
        });
        yield result;
        return;
      }

      const event = result.value;
      if (event.type === "delta") {
        streamedText += event.value;
        yield ok({
          type: "delta",
          value: event.value
        });
      }
      if (event.type === "usage") {
        usage = event.usage;
      }
      if (event.type === "warning") {
        runtimeNotice = warningRuntimeNotice(event);
        yield ok({
          type: "notice",
          message: runtimeNotice
        });
      }
    }
  } catch (error) {
    const failure = createUnifiedError({
      code: "AI_STREAM_FAILED",
      category: "LLMAdapterError",
      message: error instanceof Error ? error.message : "AI streaming failed.",
      recoverability: "retryable",
      suggestedAction: "Check the model provider response and retry.",
      traceId: "ai-writing-workflow"
    });
    await recordFailedRun({
      options,
      workflowId: parsedWorkflow.value.id,
      runState,
      generatedAt: now(),
      contextTrace: contextBundle.value.trace,
      modelProfile: runtimeProfile.value.modelProfile,
      workflowTitle: parsedWorkflow.value.title,
      error: failure
    });
    yield err(failure);
    return;
  }

  if (request.abortSignal?.aborted === true) {
    return;
  }

  const output = toAiWritingOutput(streamedText, chapterState.chapter.body);
  if (output === undefined) {
    const failure = createUnifiedError({
      code: "AI_WORKFLOW_OUTPUT_INVALID",
      category: "UserError",
      message: "AI writing output did not include a proposed chapter body.",
      recoverability: "user-action",
      suggestedAction: "Retry the AI writing workflow with a valid structured output.",
      traceId: "ai-writing-workflow"
    });
    await recordFailedRun({
      options,
      workflowId: parsedWorkflow.value.id,
      runState,
      generatedAt: now(),
      contextTrace: contextBundle.value.trace,
      modelProfile: runtimeProfile.value.modelProfile,
      workflowTitle: parsedWorkflow.value.title,
      error: failure
    });
    yield err(failure);
    return;
  }

  const afterAgent = completeWorkflowStep(parsedWorkflow.value, runState, {
    stepId: agentAction.value.stepId,
    traceId: "ai-writing-workflow",
    now
  });
  if (!afterAgent.ok) {
    yield afterAgent;
    return;
  }
  runState = afterAgent.value;

  const confirmationAction = evaluateNextWorkflowAction(parsedWorkflow.value, runState);
  if (!confirmationAction.ok) {
    yield confirmationAction;
    return;
  }
  if (confirmationAction.value.kind !== "wait-for-confirmation") {
    yield invalidWorkflowAction(confirmationAction.value.kind);
    return;
  }

  const generatedAt = now();
  const observability = createObservability({
    workflowRunId: runState.workflowRunId,
    workflowTitle: parsedWorkflow.value.title,
    generatedAt,
    contextTrace: contextBundle.value.trace,
    modelProfile: runtimeProfile.value.modelProfile,
    usage
  });
  const suggestionId = input.createSuggestionId();
  const nextConversationMessages = appendConversationTurn(input.conversationMessages, {
    instruction: request.instruction,
    summary: output.summary,
    generatedAt,
    workflowRunId: runState.workflowRunId,
    suggestionId,
    createConversationMessageId: input.createConversationMessageId
  });
  const suggestion: AiWritingSuggestion = {
    suggestionId,
    workflowRunId: runState.workflowRunId,
    status: "pending-confirmation",
    proposedBody: output.proposedBody,
    summary: output.summary,
    ...(runtimeNotice === undefined ? {} : { runtimeNotice }),
    conversationMessages: nextConversationMessages,
    styleReview: reviewAiWritingStyle(output.proposedBody),
    diffPreview: options.chapterEditorSession.previewSuggestionDiff(output.proposedBody),
    contextTrace: contextBundle.value.trace,
    observability
  };

  if (options.workflowRunHistory !== undefined) {
    const recorded = await options.workflowRunHistory.recordWorkflowRun(
      createWorkflowRunRecord({
        workflowId: parsedWorkflow.value.id,
        status: suggestion.status,
        startedAt: runState.createdAt,
        updatedAt: generatedAt,
        observability,
        retryPolicy: defaultRetryPolicySummary()
      })
    );
    if (!recorded.ok) {
      yield recorded;
      return;
    }
  }

  input.storeSuggestion({
    suggestion,
    workflow: parsedWorkflow.value,
    runState
  });
  yield ok({
    type: "suggestion",
    suggestion
  });
}

function appendConversationTurn(
  conversationMessages: AiWritingConversationMessage[],
  input: {
    readonly instruction: string;
    readonly summary: string;
    readonly generatedAt: string;
    readonly workflowRunId: string;
    readonly suggestionId: string;
    readonly createConversationMessageId: () => string;
  }
): readonly AiWritingConversationMessage[] {
  conversationMessages.push(
    {
      messageId: input.createConversationMessageId(),
      role: "user",
      content: input.instruction,
      createdAt: input.generatedAt,
      workflowRunId: input.workflowRunId,
      suggestionId: input.suggestionId
    },
    {
      messageId: input.createConversationMessageId(),
      role: "assistant",
      content: input.summary,
      createdAt: input.generatedAt,
      workflowRunId: input.workflowRunId,
      suggestionId: input.suggestionId
    }
  );

  return [...conversationMessages];
}

function toAiWritingOutput(
  value: string,
  currentBody: string
): { readonly proposedBody: string; readonly summary: string } | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (isJsonObject(parsed)) {
      const proposedBody = parsed["proposedBody"];
      const summary = parsed["summary"];
      if (typeof proposedBody === "string" && typeof summary === "string") {
        return { proposedBody, summary };
      }
    }
  } catch {
    return {
      proposedBody: `${currentBody}${value}`,
      summary: "Streamed AI continuation ready for review."
    };
  }

  return undefined;
}

function createWorkflowRunRecord(input: {
  readonly workflowId: string;
  readonly status: WorkflowRunRecordStatus;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly observability: AiWritingWorkflowObservability;
  readonly error?: WorkflowRunErrorSummary;
  readonly retryPolicy?: WorkflowRunRetryPolicySummary;
}): WorkflowRunRecord {
  const record: WorkflowRunRecord = {
    schemaVersion: "1.0",
    workflowRunId: input.observability.workflowRunId,
    workflowId: input.workflowId,
    workflowTitle: input.observability.workflowTitle,
    status: input.status,
    startedAt: input.startedAt,
    updatedAt: input.updatedAt,
    context: {
      sourceCount: input.observability.context.sourceCount,
      tokenEstimate: input.observability.context.tokenEstimate,
      selectionReason: input.observability.context.selectionReason
    },
    model: {
      profileId: input.observability.model.profileId,
      displayName: input.observability.model.displayName,
      provider: input.observability.model.provider,
      modelName: input.observability.model.modelName
    },
    usage: {
      inputTokens: input.observability.usage.inputTokens,
      outputTokens: input.observability.usage.outputTokens,
      totalTokens: input.observability.usage.totalTokens,
      usageStatus: input.observability.usage.usageStatus,
      cost: {
        amount: input.observability.usage.cost.amount,
        currency: input.observability.usage.cost.currency,
        status: input.observability.usage.cost.status
      }
    },
    steps: input.observability.steps.map((step) => ({
      stepId: step.stepId,
      label: step.label,
      kind: step.kind,
      status: step.status
    }))
  };

  return {
    ...record,
    ...(input.error === undefined ? {} : { error: input.error }),
    ...(input.retryPolicy === undefined ? {} : { retryPolicy: input.retryPolicy })
  };
}

function createObservability(input: {
  readonly workflowRunId: string;
  readonly workflowTitle: string;
  readonly generatedAt: string;
  readonly contextTrace: ContextBundleTrace;
  readonly modelProfile: LlmModelProfile;
  readonly usage: LlmUsage;
}): AiWritingWorkflowObservability {
  return {
    workflowRunId: input.workflowRunId,
    workflowTitle: input.workflowTitle,
    generatedAt: input.generatedAt,
    context: {
      sourceCount: input.contextTrace.includedRefs.length,
      tokenEstimate: input.contextTrace.includedRefs.reduce(
        (total, ref) => total + ref.tokenEstimate,
        0
      ),
      selectionReason: input.contextTrace.selectionReason
    },
    model: {
      profileId: input.modelProfile.id,
      displayName: input.modelProfile.displayName,
      provider: input.modelProfile.provider,
      modelName: input.modelProfile.modelName
    },
    usage: input.usage,
    steps: [
      {
        stepId: "build_context",
        label: "构建上下文",
        kind: "context",
        status: "completed"
      },
      {
        stepId: "write_suggestion",
        label: "运行写作 Agent",
        kind: "agent",
        status: "completed"
      },
      {
        stepId: "confirm_apply",
        label: "等待用户确认",
        kind: "confirmation",
        status: "waiting-confirmation"
      }
    ]
  };
}

function createFailureObservability(input: {
  readonly workflowRunId: string;
  readonly workflowTitle: string;
  readonly generatedAt: string;
  readonly contextTrace: ContextBundleTrace;
  readonly modelProfile: LlmModelProfile;
}): AiWritingWorkflowObservability {
  return {
    workflowRunId: input.workflowRunId,
    workflowTitle: input.workflowTitle,
    generatedAt: input.generatedAt,
    context: {
      sourceCount: input.contextTrace.includedRefs.length,
      tokenEstimate: input.contextTrace.includedRefs.reduce(
        (total, ref) => total + ref.tokenEstimate,
        0
      ),
      selectionReason: input.contextTrace.selectionReason
    },
    model: {
      profileId: input.modelProfile.id,
      displayName: input.modelProfile.displayName,
      provider: input.modelProfile.provider,
      modelName: input.modelProfile.modelName
    },
    usage: missingWorkflowUsage(),
    steps: [
      {
        stepId: "build_context",
        label: "构建上下文",
        kind: "context",
        status: "completed"
      },
      {
        stepId: "write_suggestion",
        label: "运行写作 Agent",
        kind: "agent",
        status: "failed"
      },
      {
        stepId: "confirm_apply",
        label: "等待用户确认",
        kind: "confirmation",
        status: "pending"
      }
    ]
  };
}

async function recordFailedRun(input: {
  readonly options: AiWritingWorkflowSessionOptions;
  readonly workflowId: string;
  readonly runState: WorkflowRunState;
  readonly generatedAt: string;
  readonly contextTrace: ContextBundleTrace;
  readonly modelProfile: LlmModelProfile;
  readonly workflowTitle: string;
  readonly error: UnifiedError;
}): Promise<void> {
  if (input.options.workflowRunHistory === undefined) {
    return;
  }

  await input.options.workflowRunHistory.recordWorkflowRun(
    createWorkflowRunRecord({
      workflowId: input.workflowId,
      status: "failed",
      startedAt: input.runState.createdAt,
      updatedAt: input.generatedAt,
      observability: createFailureObservability({
        workflowRunId: input.runState.workflowRunId,
        workflowTitle: input.workflowTitle,
        generatedAt: input.generatedAt,
        contextTrace: input.contextTrace,
        modelProfile: input.modelProfile
      }),
      error: toWorkflowRunErrorSummary(input.error),
      retryPolicy: defaultRetryPolicySummary()
    })
  );
}

function toWorkflowRunErrorSummary(error: UnifiedError): WorkflowRunErrorSummary {
  return {
    code: error.code,
    message: error.message,
    recoverability: error.code === "AGENT_MODEL_CALL_FAILED" ? "retryable" : error.recoverability,
    suggestedAction: error.suggestedAction,
    retryable: error.code === "AGENT_MODEL_CALL_FAILED" || error.recoverability === "retryable"
  };
}

function defaultRetryPolicySummary(): WorkflowRunRetryPolicySummary {
  return {
    mode: "manual",
    maxAttempts: 1,
    backoffLabel: "用户手动重试",
    retryableCodes: ["LLM_TIMEOUT", "LLM_RATE_LIMITED", "LLM_PROVIDER_ERROR"]
  };
}

function missingWorkflowUsage(): LlmUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    usageStatus: "missing",
    cost: {
      amount: 0,
      currency: "USD",
      status: "unknown"
    }
  };
}

async function resolveModelRuntimeProfile(
  options: AiWritingWorkflowSessionOptions
): Promise<Result<ModelRuntimeProfile, UnifiedError>> {
  if (options.resolveModelRuntimeProfile !== undefined) {
    return options.resolveModelRuntimeProfile();
  }

  return ok({
    modelProfile: options.modelProfile ?? {
      id: "mock_m14",
      provider: "mock",
      displayName: "M14 Mock Writer",
      modelName: "mock-writer"
    },
    parameters: options.parameters ?? {
      temperature: 0.7,
      maxTokens: 1200
    }
  });
}

function withRequestedReasoningEffort(
  parameters: LlmParameters,
  reasoningEffort: LlmParameters["reasoningEffort"] | undefined
): LlmParameters {
  return reasoningEffort === undefined ? parameters : { ...parameters, reasoningEffort };
}

function invalidWorkflowAction<T>(kind: string): Result<T, UnifiedError> {
  return aiWorkflowError({
    code: "AI_WORKFLOW_INVALID_ACTION",
    message: `Unexpected AI workflow action: ${kind}.`,
    suggestedAction: "Inspect the AI writing workflow definition."
  });
}

function aiWorkflowError<T>(input: {
  readonly code: string;
  readonly message: string;
  readonly suggestedAction: string;
}): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: input.code,
      category: "UserError",
      message: input.message,
      recoverability: "user-action",
      suggestedAction: input.suggestedAction,
      traceId: "ai-writing-workflow"
    })
  );
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
