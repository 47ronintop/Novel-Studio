import { buildContextBundle, type ContextBundleTrace } from "@novel-studio/context-engine";
import { runAgent, type AgentConfig } from "@novel-studio/agent-engine";
import type {
  LlmAdapter,
  LlmModelProfile,
  LlmParameters,
  LlmProviderId,
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

import type {
  ChapterEditorSession,
  ChapterEditorSnapshot,
  ChapterSuggestionDiffPreview
} from "./chapter-editor-session.js";
import type { ModelRuntimeProfile } from "./model-settings-session.js";

export interface AiWritingSuggestionRequest {
  readonly instruction: string;
}

export interface AiWritingSuggestion {
  readonly suggestionId: string;
  readonly workflowRunId: string;
  readonly status: "pending-confirmation" | "applied";
  readonly proposedBody: string;
  readonly summary: string;
  readonly diffPreview: ChapterSuggestionDiffPreview;
  readonly contextTrace: ContextBundleTrace;
  readonly observability: AiWritingWorkflowObservability;
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

export interface AiWritingWorkflowSession {
  generateChapterSuggestion(
    request: AiWritingSuggestionRequest
  ): Promise<Result<AiWritingSuggestion, UnifiedError>>;
  applyChapterSuggestion(suggestionId: string): Result<ChapterEditorSnapshot, UnifiedError>;
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
  readonly createAgentRunId?: () => string;
  readonly createHandoffId?: () => string;
}

interface StoredSuggestion {
  readonly suggestion: AiWritingSuggestion;
  readonly workflow: WorkflowDefinition;
  readonly runState: WorkflowRunState;
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

export function createAgentBackedAiWritingWorkflowSession(
  options: AiWritingWorkflowSessionOptions
): AiWritingWorkflowSession {
  const now = options.now ?? (() => new Date().toISOString());
  const createWorkflowRunId = options.createWorkflowRunId ?? (() => `wfrun_${Date.now()}`);
  const createSuggestionId = options.createSuggestionId ?? (() => `sug_${Date.now()}`);
  const createAgentRunId = options.createAgentRunId ?? (() => `agentrun_${Date.now()}`);
  const createHandoffId = options.createHandoffId ?? (() => `handoff_${Date.now()}`);
  const suggestions = new Map<string, StoredSuggestion>();

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

      const suggestion: AiWritingSuggestion = {
        suggestionId: createSuggestionId(),
        workflowRunId: runState.workflowRunId,
        status: "pending-confirmation",
        proposedBody: output.proposedBody,
        summary: output.summary,
        diffPreview: options.chapterEditorSession.previewSuggestionDiff(output.proposedBody),
        contextTrace: contextBundle.value.trace,
        observability: createObservability({
          workflowRunId: runState.workflowRunId,
          workflowTitle: parsedWorkflow.value.title,
          generatedAt: now(),
          contextTrace: contextBundle.value.trace,
          modelProfile: runtimeProfile.value.modelProfile,
          usage: handoff.value.usage
        })
      };
      suggestions.set(suggestion.suggestionId, {
        suggestion,
        workflow: parsedWorkflow.value,
        runState
      });

      return ok(suggestion);
    },
    applyChapterSuggestion(suggestionId) {
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

      const edited = options.chapterEditorSession.edit(stored.suggestion.proposedBody);
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
