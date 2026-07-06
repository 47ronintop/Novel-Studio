import { buildContextBundle, type ContextBundleTrace } from "@novel-studio/context-engine";
import { runAgent, type AgentConfig } from "@novel-studio/agent-engine";
import type {
  LlmModelProfile,
  LlmParameters,
  LlmRequest,
  LlmUsage
} from "@novel-studio/llm-adapter";
import {
  completeWorkflowStep,
  confirmWorkflowStep,
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
import type {
  AiWritingSelectionPreview,
  AiWritingSelectionRange,
  AiWritingSelectionReview,
  AiWritingSuggestion,
  AiWritingWorkflowObservability,
  AiWritingWorkflowSession,
  AiWritingWorkflowSessionOptions,
  WorkflowRunErrorSummary,
  WorkflowRunRecord,
  WorkflowRunRecordStatus,
  WorkflowRunRetryPolicySummary
} from "./ai-writing-workflow-types.js";

export type * from "./ai-writing-workflow-types.js";

interface StoredSuggestion {
  readonly suggestion: AiWritingSuggestion;
  readonly workflow: WorkflowDefinition;
  readonly runState: WorkflowRunState;
}

interface StoredSelectionPreview {
  readonly preview: AiWritingSelectionPreview;
}

const workflowDefinition: WorkflowDefinition = {
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

const agentConfig: AgentConfig = {
  schemaVersion: "1.0",
  id: "agent_chapter_writer",
  type: "agent.config",
  title: "Chapter Writer",
  status: "active",
  agentRole: "writer",
  promptTemplateId: "prompt_continue_chapter",
  inputSchemaId: "schema.ai-writing.input.v1",
  outputSchemaId: "schema.ai-writing.output.v1",
  modelProfileId: "mock_m14",
  createdAt: "2026-07-04T00:00:00.000Z",
  updatedAt: "2026-07-04T00:00:00.000Z"
};

const selectionPreviewAgentConfig: AgentConfig = {
  ...agentConfig,
  id: "agent_selection_rewriter",
  title: "Selection Rewriter",
  promptTemplateId: "prompt_rewrite_selection",
  inputSchemaId: "schema.ai-selection-preview.input.v1",
  outputSchemaId: "schema.ai-selection-preview.output.v1"
};

export function createAgentBackedAiWritingWorkflowSession(
  options: AiWritingWorkflowSessionOptions
): AiWritingWorkflowSession {
  const now = options.now ?? (() => new Date().toISOString());
  const createWorkflowRunId = options.createWorkflowRunId ?? (() => `wfrun_${Date.now()}`);
  const createSuggestionId = options.createSuggestionId ?? (() => `sug_${Date.now()}`);
  const createAgentRunId = options.createAgentRunId ?? (() => `agentrun_${Date.now()}`);
  const createHandoffId = options.createHandoffId ?? (() => `handoff_${Date.now()}`);
  const suggestions = new Map<string, StoredSuggestion>();
  const selectionPreviews = new Map<string, StoredSelectionPreview>();

  return {
    async generateChapterSuggestion(request) {
      const chapterState = options.chapterEditorSession.getState();
      if (chapterState === undefined) {
        return aiWorkflowError({
          code: "AI_WORKFLOW_CHAPTER_NOT_LOADED",
          message: "No active chapter is loaded for AI writing.",
          suggestedAction: "Open a project chapter before generating AI writing suggestions."
        });
      }

      const parsedWorkflow = parseWorkflowDefinition(workflowDefinition, {
        traceId: "ai-writing-workflow"
      });
      if (!parsedWorkflow.ok) {
        return parsedWorkflow;
      }

      let runState = startWorkflowRun(parsedWorkflow.value, {
        workflowRunId: createWorkflowRunId(),
        traceId: "ai-writing-workflow",
        now
      });

      const contextAction = evaluateNextWorkflowAction(parsedWorkflow.value, runState);
      if (!contextAction.ok) {
        return contextAction;
      }
      if (contextAction.value.kind !== "build-context") {
        return invalidWorkflowAction(contextAction.value.kind);
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
        return contextBundle;
      }

      const afterContext = completeWorkflowStep(parsedWorkflow.value, runState, {
        stepId: contextAction.value.stepId,
        traceId: "ai-writing-workflow",
        now
      });
      if (!afterContext.ok) {
        return afterContext;
      }
      runState = afterContext.value;

      const agentAction = evaluateNextWorkflowAction(parsedWorkflow.value, runState);
      if (!agentAction.ok) {
        return agentAction;
      }
      if (agentAction.value.kind !== "run-agent") {
        return invalidWorkflowAction(agentAction.value.kind);
      }
      const runtimeProfile = await resolveModelRuntimeProfile(options);
      if (!runtimeProfile.ok) {
        return runtimeProfile;
      }

      const handoff = await runAgent({
        schemaVersion: "1.0",
        agentRunId: createAgentRunId(),
        handoffId: createHandoffId(),
        workflowRunId: runState.workflowRunId,
        traceId: "ai-writing-workflow",
        agent: agentConfig,
        toAgentId: "application",
        input: {
          instruction: request.instruction,
          currentBody: chapterState.chapter.body
        },
        contextBundle: contextBundle.value,
        llmRequest: createLlmRequest(
          runState.workflowRunId,
          request.instruction,
          runtimeProfile.value.modelProfile,
          runtimeProfile.value.parameters
        ),
        llmAdapter: options.llmAdapter,
        validateSchema: validateAiWritingSchema,
        now
      });
      if (!handoff.ok) {
        if (options.workflowRunHistory !== undefined) {
          const recorded = await options.workflowRunHistory.recordWorkflowRun(
            createWorkflowRunRecord({
              workflowId: parsedWorkflow.value.id,
              status: "failed",
              startedAt: runState.createdAt,
              updatedAt: now(),
              observability: createFailureObservability({
                workflowRunId: runState.workflowRunId,
                workflowTitle: parsedWorkflow.value.title,
                generatedAt: now(),
                contextTrace: contextBundle.value.trace,
                modelProfile: runtimeProfile.value.modelProfile
              }),
              error: toWorkflowRunErrorSummary(handoff.error),
              retryPolicy: defaultRetryPolicySummary()
            })
          );
          if (!recorded.ok) {
            return recorded;
          }
        }

        return handoff;
      }

      const output = toAiWritingOutput(handoff.value.payload);
      if (output === undefined) {
        return aiWorkflowError({
          code: "AI_WORKFLOW_OUTPUT_INVALID",
          message: "AI writing output did not include a proposed chapter body.",
          suggestedAction: "Retry the AI writing workflow with a valid structured output."
        });
      }

      const afterAgent = completeWorkflowStep(parsedWorkflow.value, runState, {
        stepId: agentAction.value.stepId,
        traceId: "ai-writing-workflow",
        now
      });
      if (!afterAgent.ok) {
        return afterAgent;
      }
      runState = afterAgent.value;

      const confirmationAction = evaluateNextWorkflowAction(parsedWorkflow.value, runState);
      if (!confirmationAction.ok) {
        return confirmationAction;
      }
      if (confirmationAction.value.kind !== "wait-for-confirmation") {
        return invalidWorkflowAction(confirmationAction.value.kind);
      }

      const generatedAt = now();
      const observability = createObservability({
        workflowRunId: runState.workflowRunId,
        workflowTitle: parsedWorkflow.value.title,
        generatedAt,
        contextTrace: contextBundle.value.trace,
        modelProfile: runtimeProfile.value.modelProfile,
        usage: handoff.value.usage
      });
      const suggestion: AiWritingSuggestion = {
        suggestionId: createSuggestionId(),
        workflowRunId: runState.workflowRunId,
        status: "pending-confirmation",
        proposedBody: output.proposedBody,
        summary: output.summary,
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
          return recorded;
        }
      }

      suggestions.set(suggestion.suggestionId, {
        suggestion,
        workflow: parsedWorkflow.value,
        runState
      });

      return ok(suggestion);
    },
    async generateSelectionPreview(request) {
      const chapterState = options.chapterEditorSession.getState();
      if (chapterState === undefined) {
        return aiWorkflowError({
          code: "AI_WORKFLOW_CHAPTER_NOT_LOADED",
          message: "No active chapter is loaded for AI writing.",
          suggestedAction: "Open a project chapter before generating AI writing suggestions."
        });
      }

      const validatedSelection = validateSelectionRange(
        chapterState.chapter.body,
        request.selection
      );
      if (!validatedSelection.ok) {
        return validatedSelection;
      }

      const parsedWorkflow = parseWorkflowDefinition(workflowDefinition, {
        traceId: "ai-selection-preview"
      });
      if (!parsedWorkflow.ok) {
        return parsedWorkflow;
      }

      let runState = startWorkflowRun(parsedWorkflow.value, {
        workflowRunId: createWorkflowRunId(),
        traceId: "ai-selection-preview",
        now
      });

      const contextAction = evaluateNextWorkflowAction(parsedWorkflow.value, runState);
      if (!contextAction.ok) {
        return contextAction;
      }
      if (contextAction.value.kind !== "build-context") {
        return invalidWorkflowAction(contextAction.value.kind);
      }

      const contextBundle = buildContextBundle({
        schemaVersion: "1.0",
        contextBundleId: `ctx_${runState.workflowRunId}`,
        workflowRunId: runState.workflowRunId,
        traceId: "ai-selection-preview",
        goal: request.instruction,
        budget: { maxTokens: 1024 },
        candidates: [
          {
            refType: "chapter",
            refId: chapterState.chapter.frontmatter.id,
            content: validatedSelection.value.selectedText,
            priority: 1,
            tokenEstimate: estimateSelectionTokens(validatedSelection.value.selectedText),
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
        return contextBundle;
      }

      const afterContext = completeWorkflowStep(parsedWorkflow.value, runState, {
        stepId: contextAction.value.stepId,
        traceId: "ai-selection-preview",
        now
      });
      if (!afterContext.ok) {
        return afterContext;
      }
      runState = afterContext.value;

      const agentAction = evaluateNextWorkflowAction(parsedWorkflow.value, runState);
      if (!agentAction.ok) {
        return agentAction;
      }
      if (agentAction.value.kind !== "run-agent") {
        return invalidWorkflowAction(agentAction.value.kind);
      }

      const runtimeProfile = await resolveModelRuntimeProfile(options);
      if (!runtimeProfile.ok) {
        return runtimeProfile;
      }

      const handoff = await runAgent({
        schemaVersion: "1.0",
        agentRunId: createAgentRunId(),
        handoffId: createHandoffId(),
        workflowRunId: runState.workflowRunId,
        traceId: "ai-selection-preview",
        agent: selectionPreviewAgentConfig,
        toAgentId: "application",
        input: {
          instruction: request.instruction,
          currentBody: chapterState.chapter.body,
          selection: {
            startOffset: validatedSelection.value.startOffset,
            endOffset: validatedSelection.value.endOffset,
            selectedText: validatedSelection.value.selectedText
          }
        },
        contextBundle: contextBundle.value,
        llmRequest: createSelectionPreviewLlmRequest(
          runState.workflowRunId,
          request.instruction,
          validatedSelection.value,
          runtimeProfile.value.modelProfile,
          runtimeProfile.value.parameters
        ),
        llmAdapter: options.llmAdapter,
        validateSchema: validateAiWritingSchema,
        now
      });
      if (!handoff.ok) {
        return handoff;
      }

      const output = toSelectionPreviewOutput(handoff.value.payload);
      if (output === undefined) {
        return aiWorkflowError({
          code: "AI_WORKFLOW_OUTPUT_INVALID",
          message: "AI selection preview output did not include replacement text.",
          suggestedAction: "Retry the AI selection preview with a valid structured output."
        });
      }

      const afterAgent = completeWorkflowStep(parsedWorkflow.value, runState, {
        stepId: agentAction.value.stepId,
        traceId: "ai-selection-preview",
        now
      });
      if (!afterAgent.ok) {
        return afterAgent;
      }
      runState = afterAgent.value;

      const generatedAt = now();
      const observability = createObservability({
        workflowRunId: runState.workflowRunId,
        workflowTitle: "Selection Preview",
        generatedAt,
        contextTrace: contextBundle.value.trace,
        modelProfile: runtimeProfile.value.modelProfile,
        usage: handoff.value.usage
      });
      const nextBody = replaceSelection(
        chapterState.chapter.body,
        validatedSelection.value,
        output.proposedText
      );
      const preview: AiWritingSelectionPreview = {
        previewId: createSuggestionId(),
        workflowRunId: runState.workflowRunId,
        previewOnly: true,
        proposedText: output.proposedText,
        summary: output.summary,
        review: createSelectionReview(validatedSelection.value, output.proposedText),
        selection: validatedSelection.value,
        diffPreview: {
          title: "Selection AI preview",
          changes: [
            {
              kind: "replace",
              value: nextBody
            }
          ]
        },
        contextTrace: contextBundle.value.trace,
        observability
      };
      selectionPreviews.set(preview.previewId, { preview });

      return ok(preview);
    },
    async applySelectionPreview(previewId) {
      const stored = selectionPreviews.get(previewId);
      if (stored === undefined) {
        return aiWorkflowError({
          code: "AI_WORKFLOW_SELECTION_PREVIEW_NOT_FOUND",
          message: "The requested AI selection preview is not available.",
          suggestedAction: "Generate a new selection preview before applying it."
        });
      }

      const replacement = stored.preview.diffPreview.changes[0];
      if (replacement === undefined || replacement.kind !== "replace") {
        return aiWorkflowError({
          code: "AI_WORKFLOW_SELECTION_PREVIEW_INVALID",
          message: "The stored AI selection preview does not include a replacement diff.",
          suggestedAction: "Generate a new selection preview before applying it."
        });
      }

      const edited = await options.chapterEditorSession.applyAiEdit(replacement.value);
      if (!edited.ok) {
        return edited;
      }

      const versions = await options.chapterEditorSession.listVersions();
      if (!versions.ok) {
        return versions;
      }

      return ok({
        state: edited.value,
        versions: versions.value
      });
    },
    async applyChapterSuggestion(suggestionId) {
      const stored = suggestions.get(suggestionId);
      if (stored === undefined) {
        return aiWorkflowError({
          code: "AI_WORKFLOW_SUGGESTION_NOT_FOUND",
          message: "The requested AI writing suggestion is not available.",
          suggestedAction: "Generate a new AI writing suggestion before applying it."
        });
      }

      const confirmed = confirmWorkflowStep(stored.workflow, stored.runState, {
        stepId: "confirm_apply",
        traceId: "ai-writing-workflow",
        now
      });
      if (!confirmed.ok) {
        return confirmed;
      }

      const completed = completeWorkflowStep(stored.workflow, confirmed.value, {
        stepId: "confirm_apply",
        traceId: "ai-writing-workflow",
        now
      });
      if (!completed.ok) {
        return completed;
      }

      const edited = await options.chapterEditorSession.applyAiEdit(stored.suggestion.proposedBody);
      if (!edited.ok) {
        return edited;
      }

      suggestions.set(suggestionId, {
        ...stored,
        suggestion: {
          ...stored.suggestion,
          status: "applied"
        },
        runState: completed.value
      });

      return ok({
        state: edited.value,
        versions: []
      });
    }
  };
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

const defaultModelProfile: LlmModelProfile = {
  id: "mock_m14",
  provider: "mock",
  displayName: "M14 Mock Writer",
  modelName: "mock-writer"
};

const defaultParameters: LlmParameters = {
  temperature: 0.7,
  maxTokens: 1200
};

async function resolveModelRuntimeProfile(
  options: AiWritingWorkflowSessionOptions
): Promise<Result<ModelRuntimeProfile, UnifiedError>> {
  if (options.resolveModelRuntimeProfile !== undefined) {
    return options.resolveModelRuntimeProfile();
  }

  return ok({
    modelProfile: options.modelProfile ?? defaultModelProfile,
    parameters: options.parameters ?? defaultParameters
  });
}

function createLlmRequest(
  workflowRunId: string,
  instruction: string,
  modelProfile: LlmModelProfile,
  parameters: LlmParameters
): LlmRequest {
  return {
    schemaVersion: "1.0",
    requestId: `llm_${workflowRunId}`,
    traceId: "ai-writing-workflow",
    mode: "non-streaming",
    modelProfile,
    messages: [
      {
        role: "system",
        content: "Return JSON with proposedBody and summary for a chapter writing suggestion."
      },
      {
        role: "user",
        content: instruction
      }
    ],
    parameters,
    responseFormat: {
      type: "json_object"
    }
  };
}

function createSelectionPreviewLlmRequest(
  workflowRunId: string,
  instruction: string,
  selection: AiWritingSelectionRange,
  modelProfile: LlmModelProfile,
  parameters: LlmParameters
): LlmRequest {
  return {
    schemaVersion: "1.0",
    requestId: `llm_${workflowRunId}`,
    traceId: "ai-selection-preview",
    mode: "non-streaming",
    modelProfile,
    messages: [
      {
        role: "system",
        content: "Return JSON with proposedText and summary for a selected text rewrite."
      },
      {
        role: "user",
        content: [
          `Instruction: ${instruction}`,
          `Selection offsets: ${selection.startOffset}-${selection.endOffset}`,
          `Selected text: ${selection.selectedText}`
        ].join("\n")
      }
    ],
    parameters,
    responseFormat: {
      type: "json_object"
    }
  };
}

function validateAiWritingSchema(input: {
  readonly schemaId: string;
  readonly value: JsonObject;
}): { readonly valid: boolean; readonly redactedDetail?: JsonObject } {
  if (input.schemaId === "schema.ai-writing.input.v1") {
    return {
      valid:
        typeof input.value["instruction"] === "string" &&
        typeof input.value["currentBody"] === "string"
    };
  }
  if (input.schemaId === "schema.ai-selection-preview.input.v1") {
    const selection = input.value["selection"];
    return {
      valid:
        typeof input.value["instruction"] === "string" &&
        typeof input.value["currentBody"] === "string" &&
        typeof selection === "object" &&
        selection !== null &&
        !Array.isArray(selection)
    };
  }
  if (input.schemaId === "schema.ai-selection-preview.output.v1") {
    return {
      valid: toSelectionPreviewOutput(input.value) !== undefined
    };
  }

  return {
    valid: toAiWritingOutput(input.value) !== undefined
  };
}

function toAiWritingOutput(
  value: JsonObject
): { readonly proposedBody: string; readonly summary: string } | undefined {
  const proposedBody = value["proposedBody"];
  const summary = value["summary"];
  if (typeof proposedBody !== "string" || typeof summary !== "string") {
    return undefined;
  }

  return { proposedBody, summary };
}

function toSelectionPreviewOutput(
  value: JsonObject
): { readonly proposedText: string; readonly summary: string } | undefined {
  const proposedText = value["proposedText"];
  const summary = value["summary"];
  if (typeof proposedText !== "string" || typeof summary !== "string") {
    return undefined;
  }

  return { proposedText, summary };
}

function validateSelectionRange(
  body: string,
  selection: AiWritingSelectionRange
): Result<AiWritingSelectionRange, UnifiedError> {
  if (
    !Number.isInteger(selection.startOffset) ||
    !Number.isInteger(selection.endOffset) ||
    selection.startOffset < 0 ||
    selection.endOffset > body.length ||
    selection.startOffset >= selection.endOffset
  ) {
    return aiWorkflowError({
      code: "AI_WORKFLOW_SELECTION_INVALID",
      message: "AI selection preview requires a non-empty selection inside the active chapter.",
      suggestedAction: "Select text in the active chapter before requesting a selection preview."
    });
  }

  const selectedText = body.slice(selection.startOffset, selection.endOffset);
  if (selectedText !== selection.selectedText) {
    return aiWorkflowError({
      code: "AI_WORKFLOW_SELECTION_STALE",
      message: "The selected text no longer matches the active chapter.",
      suggestedAction: "Refresh the selection and request the preview again."
    });
  }

  return ok(selection);
}

function replaceSelection(
  body: string,
  selection: AiWritingSelectionRange,
  proposedText: string
): string {
  return `${body.slice(0, selection.startOffset)}${proposedText}${body.slice(selection.endOffset)}`;
}

function createSelectionReview(
  selection: AiWritingSelectionRange,
  proposedText: string
): AiWritingSelectionReview {
  return {
    status: "pending",
    originalText: selection.selectedText,
    proposedText,
    rangeLabel: `${selection.startOffset}-${selection.endOffset}`,
    compareLabel: `${selection.selectedText} -> ${proposedText}`
  };
}

function estimateSelectionTokens(selectedText: string): number {
  return Math.max(1, Math.ceil(selectedText.length / 4));
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
