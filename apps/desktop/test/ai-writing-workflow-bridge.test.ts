import { describe, expect, test } from "vitest";

import type {
  AiWritingSelectionPreview,
  AiWritingSuggestion,
  ChapterEditorSnapshot,
  ModelDiscoverySnapshot,
  ModelProfile,
  ModelSettingsSnapshot,
  NovelStudioApi,
  WorkflowRunRecord,
  WorkflowRunSummary
} from "@novel-studio/application";
import { createUnifiedError, err, ok } from "@novel-studio/shared";

import { createAiWritingWorkflowBridge } from "../src/renderer/ai-writing-workflow-bridge.js";

const appliedSnapshot: ChapterEditorSnapshot = {
  state: {
    chapter: {
      frontmatter: {
        schemaVersion: "1.0",
        id: "ch_01JZ7P9QK2R6D4W8K3A1B5C9D0",
        type: "chapter",
        title: "第一章",
        order: 1,
        status: "draft",
        createdAt: "2026-07-04T00:00:00.000Z",
        updatedAt: "2026-07-04T00:00:00.000Z"
      },
      body: "Opening line.\nAI continuation draft.\n"
    },
    dirty: true,
    saveStatus: "Unsaved"
  },
  versions: []
};

const suggestion: AiWritingSuggestion = {
  suggestionId: "sug_m14",
  workflowRunId: "wfrun_m14",
  status: "pending-confirmation",
  proposedBody: "Opening line.\nAI continuation draft.\n",
  summary: "Generated a local mock continuation for review.",
  conversationMessages: [],
  styleReview: {
    status: "attention",
    hitCount: 2,
    hits: [
      {
        ruleId: "mechanical-emotion",
        title: "模板化情绪词",
        severity: "notice",
        matchedText: "冷冷",
        positionLabel: "第 16 字附近",
        suggestion: "改成可观察的动作、语气或环境反应。"
      },
      {
        ruleId: "stacked-simile",
        title: "连续比喻",
        severity: "notice",
        matchedText: "像风像雨",
        positionLabel: "第 28 字附近",
        suggestion: "保留一个更准确的比喻，另一个改成动作或感官细节。"
      }
    ]
  },
  diffPreview: {
    title: "AI suggestion",
    changes: [
      {
        kind: "replace",
        value: "Opening line.\nAI continuation draft.\n"
      }
    ]
  },
  contextTrace: {
    selectionReason: "priority_then_budget",
    includedRefs: [
      {
        refType: "chapter",
        refId: "ch_01JZ7P9QK2R6D4W8K3A1B5C9D0",
        tokenEstimate: 4
      }
    ],
    excludedRefs: []
  },
  observability: {
    workflowRunId: "wfrun_m14",
    workflowTitle: "Continue Chapter",
    generatedAt: "2026-07-05T00:00:00.000Z",
    context: {
      sourceCount: 1,
      tokenEstimate: 4,
      selectionReason: "priority_then_budget"
    },
    model: {
      profileId: "mock_m14",
      displayName: "M14 Mock Writer",
      provider: "mock",
      modelName: "mock-writer"
    },
    usage: {
      inputTokens: 16,
      outputTokens: 8,
      totalTokens: 24,
      usageStatus: "estimated",
      cost: {
        amount: 0,
        currency: "USD",
        status: "estimated"
      }
    },
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
  }
};

const selectionPreview: AiWritingSelectionPreview = {
  previewId: "sug_selection_m74",
  workflowRunId: "wfrun_selection_m74",
  previewOnly: true,
  proposedText: "The opening line tightened.",
  summary: "Rewrites only the selected sentence.",
  styleReview: {
    status: "attention",
    hitCount: 1,
    hits: [
      {
        ruleId: "mechanical-emotion",
        title: "模板化情绪词",
        severity: "notice",
        matchedText: "冷冷",
        positionLabel: "第 4 字附近",
        suggestion: "改成可观察的动作、语气或环境反应。"
      }
    ]
  },
  review: {
    status: "pending",
    originalText: "Opening line.",
    proposedText: "The opening line tightened.",
    rangeLabel: "0-13",
    compareLabel: "Opening line. -> The opening line tightened."
  },
  selection: {
    startOffset: 0,
    endOffset: 13,
    selectedText: "Opening line."
  },
  diffPreview: {
    title: "Selection AI preview",
    changes: [
      {
        kind: "replace",
        value: "The opening line tightened.\n"
      }
    ]
  },
  contextTrace: {
    selectionReason: "Rewrite selection.",
    includedRefs: [
      {
        refType: "chapter",
        refId: "ch_01JZ7P9QK2R6D4W8K3A1B5C9D0",
        tokenEstimate: 4
      }
    ],
    excludedRefs: []
  },
  observability: {
    workflowRunId: "wfrun_selection_m74",
    workflowTitle: "Selection Preview",
    generatedAt: "2026-07-05T00:00:00.000Z",
    context: {
      sourceCount: 1,
      tokenEstimate: 4,
      selectionReason: "Rewrite selection."
    },
    model: {
      profileId: "mock_m14",
      displayName: "M14 Mock Writer",
      provider: "mock",
      modelName: "mock-writer"
    },
    usage: {
      inputTokens: 16,
      outputTokens: 8,
      totalTokens: 24,
      usageStatus: "estimated",
      cost: {
        amount: 0,
        currency: "USD",
        status: "estimated"
      }
    },
    steps: []
  }
};

const defaultModelProfile: ModelProfile = {
  id: "model_default",
  provider: "openai-compatible",
  displayName: "Default Model",
  baseUrl: "https://api.example.com/v1",
  apiKeyRef: "secret://model_default/api_key",
  modelName: "example-model",
  temperature: 0.7,
  maxTokens: 4096,
  topP: 1,
  timeoutMs: 60000
};

describe("AI writing workflow bridge", () => {
  test("loads shared model discovery and saves selected model on the default profile", async () => {
    const calls: string[] = [];
    const bridge = createAiWritingWorkflowBridge(createApi(calls));

    const loaded = await bridge.loadModelDiscovery();
    const selected = await bridge.selectDiscoveredModel("gpt-5");

    expect(loaded.modelDiscovery).toMatchObject({
      profileId: "model_default",
      status: "loaded",
      models: [
        { id: "example-model", displayName: "example-model" },
        { id: "gpt-5", displayName: "gpt-5" }
      ]
    });
    expect(selected.selectedModelName).toBe("gpt-5");
    expect(selected.modelDiscovery?.models[1]?.reasoningStrength).toMatchObject({
      status: "available",
      providerParamName: "reasoning_effort",
      allowedValues: ["low", "medium", "high"]
    });
    expect(calls).toEqual([
      "settings.listModelProfiles",
      "settings.discoverModelOptions:model_default",
      "settings.saveModelProfile:model_default:gpt-5:false"
    ]);
  });

  test("tracks selected reasoning effort and sends it with streaming requests", async () => {
    const calls: string[] = [];
    const api = createApi(calls);
    const bridge = createAiWritingWorkflowBridge(api);

    await bridge.loadModelDiscovery();
    await bridge.selectDiscoveredModel("gpt-5");
    const selected = bridge.selectReasoningEffort("high");
    bridge.beginStreamingGenerate("Continue with reasoning.");
    await bridge.generateStreamingSuggestion("Continue with reasoning.", () => undefined);

    expect(selected.selectedReasoningEffort).toBe("high");
    expect(calls).toContain("ai.stream:Continue with reasoning.:high");
  });

  test("keeps model and reasoning controls after a streaming suggestion completes", async () => {
    const calls: string[] = [];
    const api = createApi(calls);
    const bridge = createAiWritingWorkflowBridge(api);

    await bridge.loadModelDiscovery();
    await bridge.selectDiscoveredModel("gpt-5");
    bridge.selectReasoningEffort("high");
    bridge.beginStreamingGenerate("Continue with controls.");
    const finalProps = await bridge.generateStreamingSuggestion(
      "Continue with controls.",
      () => undefined
    );

    expect(finalProps.status).toBe("suggestion-ready");
    expect(finalProps.modelDiscovery).toMatchObject({
      profileId: "model_default",
      status: "loaded"
    });
    expect(finalProps.selectedModelName).toBe("gpt-5");
    expect(finalProps.selectedReasoningEffort).toBe("high");
  });

  test("keeps the suggestion terminal state when push completion follows suggestion", async () => {
    const api = createApi([]);
    const delayedHistory = createDeferred<Result<WorkflowRunSummary[], UnifiedError>>();
    let historyCalls = 0;
    api.ai.listWorkflowRuns = async () => {
      historyCalls += 1;
      return historyCalls === 1 ? delayedHistory.promise : ok([]);
    };
    let listener:
      | ((event: import("@novel-studio/application").AiWritingSuggestionStreamPushEvent) => void)
      | undefined;
    api.ai.onChapterSuggestionStreamEvent = (nextListener) => {
      listener = nextListener;
      return () => undefined;
    };
    api.ai.startChapterSuggestionStream = async (request) => {
      queueMicrotask(() => {
        listener?.({
          streamId: request.streamId,
          sequence: 1,
          type: "event",
          event: { type: "suggestion", suggestion }
        });
        listener?.({
          streamId: request.streamId,
          sequence: 2,
          type: "completed"
        });
        setTimeout(() => delayedHistory.resolve(ok([workflowRunSummary()])), 0);
      });
      return ok({ streamId: request.streamId });
    };
    api.ai.cancelChapterSuggestionStream = async () => ok(undefined);
    const bridge = createAiWritingWorkflowBridge(api);

    bridge.beginStreamingGenerate("Continue with push streaming.");
    const finalProps = await bridge.generateStreamingSuggestion(
      "Continue with push streaming.",
      () => undefined
    );

    expect(finalProps.status).toBe("suggestion-ready");
    expect(finalProps.summary).toBe(suggestion.summary);
  });

  test("generates a preview-only suggestion and applies it through the preload API", async () => {
    const calls: string[] = [];
    const bridge = createAiWritingWorkflowBridge(createApi(calls));

    const initial = bridge.getProps();
    const generating = bridge.beginGenerate("续写当前场景");
    const generated = await bridge.generateSuggestion("续写当前场景");
    const applied = await bridge.applySuggestion();

    expect(initial.status).toBe("idle");
    expect(generating.status).toBe("generating");
    expect(generated.status).toBe("suggestion-ready");
    expect(generated.summary).toBe("Generated a local mock continuation for review.");
    expect(generated.diffPreview?.changes[0]?.value).toContain("AI continuation draft.");
    expect(generated.styleReview).toEqual(suggestion.styleReview);
    expect(generated.contextTraceLabel).toBe("1 source / 4 tokens");
    expect(generated.observability?.usageLabel).toBe("24 tokens · estimated");
    expect(generated.observability?.modelLabel).toBe("M14 Mock Writer / mock-writer");
    expect(generated.history?.runs[0]).toMatchObject({
      workflowRunId: "wfrun_m14",
      workflowTitle: "Continue Chapter",
      statusLabel: "待确认"
    });
    expect(generated.history?.selectedRun?.steps.map((step) => step.label)).toEqual([
      "构建上下文",
      "运行写作 Agent",
      "等待用户确认"
    ]);
    expect(generated.observability?.steps.map((step) => step.label)).toEqual([
      "构建上下文",
      "运行写作 Agent",
      "等待用户确认"
    ]);
    expect(applied.chapter.body).toContain("AI continuation draft.");
    expect(applied.dirty).toBe(true);
    expect(applied.saveStatus).toBe("Unsaved");
    expect(calls).toEqual(["ai.generate:续写当前场景", "ai.apply:sug_m14"]);
  });

  test("tracks streaming preview deltas and cancellation locally", () => {
    const bridge = createAiWritingWorkflowBridge(createApi([]));

    const streaming = bridge.beginStreamingGenerate("Continue with streaming.");
    const firstDelta = bridge.appendStreamDelta("The city");
    const secondDelta = bridge.appendStreamDelta(" answered.");
    const cancelled = bridge.cancelStreaming();

    expect(streaming).toMatchObject({
      status: "streaming",
      instruction: "Continue with streaming.",
      streamPreview: ""
    });
    expect(firstDelta.streamPreview).toBe("The city");
    expect(secondDelta.streamPreview).toBe("The city answered.");
    expect(cancelled).toMatchObject({
      status: "cancelled",
      instruction: "Continue with streaming.",
      streamPreview: "The city answered."
    });
  });

  test("streams deltas through the preload API and aborts the active stream", async () => {
    const calls: string[] = [];
    const api = createApi(calls);
    const aborted = createDeferred<undefined>();
    const updates: string[] = [];
    api.ai.streamChapterSuggestion = async function* (_request, options) {
      calls.push("ai.stream:start");
      yield ok({ type: "delta", value: "The city" });
      await aborted.promise;
      calls.push(`ai.stream:aborted:${String(options?.signal?.aborted)}`);
      yield ok({ type: "delta", value: " should not append" });
    };
    const bridge = createAiWritingWorkflowBridge(api);

    bridge.beginStreamingGenerate("Continue with streaming.");
    const streaming = bridge.generateStreamingSuggestion(
      "Continue with streaming.",
      (nextProps) => {
        updates.push(nextProps.streamPreview ?? "");
        if (nextProps.streamPreview === "The city") {
          const cancelled = bridge.cancelStreaming();
          updates.push(cancelled.streamPreview ?? "");
          aborted.resolve(undefined);
        }
      }
    );
    const finalProps = await streaming;

    expect(finalProps).toMatchObject({
      status: "cancelled",
      streamPreview: "The city"
    });
    expect(updates).toEqual(["The city", "The city"]);
    expect(calls).toEqual(["ai.stream:start", "ai.stream:aborted:true"]);
  });

  test("renders failed state when streaming returns an error before any delta", async () => {
    const calls: string[] = [];
    const api = createApi(calls);
    const updates: string[] = [];
    api.ai.streamChapterSuggestion = async function* () {
      calls.push("ai.stream:start");
      yield err(
        createUnifiedError({
          code: "AI_STREAM_FAILED",
          category: "LLMAdapterError",
          message: "Provider streaming response timed out before returning an SSE chunk.",
          recoverability: "retryable",
          suggestedAction: "Retry with non-streaming.",
          traceId: "ai-writing-workflow"
        })
      );
    };
    const bridge = createAiWritingWorkflowBridge(api);

    bridge.beginStreamingGenerate("Continue with streaming.");
    const finalProps = await bridge.generateStreamingSuggestion(
      "Continue with streaming.",
      (nextProps) => updates.push(`${nextProps.status}:${nextProps.failure?.message ?? ""}`)
    );

    expect(finalProps.status).toBe("failed");
    expect(finalProps.failure).toMatchObject({
      code: "AI_STREAM_FAILED",
      message: "Provider streaming response timed out before returning an SSE chunk."
    });
    expect(updates).toEqual([
      "failed:Provider streaming response timed out before returning an SSE chunk."
    ]);
    expect(calls).toEqual(["ai.stream:start"]);
  });

  test("renders failed state when the streaming iterator throws before yielding a delta", async () => {
    const calls: string[] = [];
    const api = createApi(calls);
    const updates: string[] = [];
    api.ai.streamChapterSuggestion = async function* () {
      calls.push("ai.stream:start");
      throw new Error("Provider socket closed before the first SSE chunk.");
      yield ok({ type: "delta", value: "" });
    };
    const bridge = createAiWritingWorkflowBridge(api);

    bridge.beginStreamingGenerate("Continue with streaming.");
    const finalProps = await bridge.generateStreamingSuggestion(
      "Continue with streaming.",
      (nextProps) => {
        updates.push(`${nextProps.status}:${nextProps.failure?.message ?? ""}`);
      }
    );

    expect(finalProps.status).toBe("failed");
    expect(finalProps.failure).toMatchObject({
      code: "AI_STREAM_FAILED",
      message: "Provider socket closed before the first SSE chunk."
    });
    expect(updates).toEqual(["failed:Provider socket closed before the first SSE chunk."]);
    expect(calls).toEqual(["ai.stream:start"]);
  });

  test("renders failed state when streaming returns a normalized provider error before yielding a delta", async () => {
    const calls: string[] = [];
    const api = createApi(calls);
    const updates: string[] = [];
    api.ai.streamChapterSuggestion = async function* () {
      calls.push("ai.stream:start");
      yield err(
        createUnifiedError({
          code: "AI_STREAM_FAILED",
          category: "LLMAdapterError",
          message: "Provider returned a non-SSE streaming response.",
          recoverability: "retryable",
          suggestedAction: "Check the model provider response and retry.",
          traceId: "desktop-ipc-handlers",
          redactedDetail: {
            status: 502,
            body: {
              bodyPreview: "<html>Provider console</html>"
            }
          }
        })
      );
    };
    const bridge = createAiWritingWorkflowBridge(api);

    bridge.beginStreamingGenerate("Continue with streaming.");
    const finalProps = await bridge.generateStreamingSuggestion(
      "Continue with streaming.",
      (nextProps) => {
        updates.push(`${nextProps.status}:${nextProps.failure?.message ?? ""}`);
      }
    );

    expect(finalProps.status).toBe("failed");
    expect(finalProps.failure).toMatchObject({
      code: "AI_STREAM_FAILED",
      message: "Provider returned a non-SSE streaming response.",
      suggestedAction: "Check the model provider response and retry."
    });
    expect(updates).toEqual(["failed:Provider returned a non-SSE streaming response."]);
    expect(calls).toEqual(["ai.stream:start"]);
  });

  test("fails instead of staying streaming when the stream closes without a final suggestion", async () => {
    const calls: string[] = [];
    const api = createApi(calls);
    const updates: string[] = [];
    api.ai.streamChapterSuggestion = async function* () {
      calls.push("ai.stream:start");
      yield ok({ type: "delta", value: "Partial answer" });
    };
    const bridge = createAiWritingWorkflowBridge(api);

    bridge.beginStreamingGenerate("Continue with streaming.");
    const finalProps = await bridge.generateStreamingSuggestion(
      "Continue with streaming.",
      (nextProps) => {
        updates.push(`${nextProps.status}:${nextProps.streamPreview ?? ""}`);
      }
    );

    expect(finalProps.status).toBe("failed");
    expect(finalProps.streamPreview).toBe("Partial answer");
    expect(finalProps.failure).toMatchObject({
      code: "AI_STREAM_ENDED_WITHOUT_SUGGESTION",
      message: "AI streaming ended before returning a final suggestion."
    });
    expect(updates).toEqual(["streaming:Partial answer", "failed:Partial answer"]);
    expect(calls).toEqual(["ai.stream:start"]);
  });

  test("shows a runtime notice when streaming automatically ignores unsupported reasoning effort", async () => {
    const calls: string[] = [];
    const api = createApi(calls);
    const updates: string[] = [];
    api.ai.streamChapterSuggestion = async function* () {
      calls.push("ai.stream:start");
      yield ok({
        type: "notice",
        message: "该模型/端点不支持推理强度调节，已自动忽略 reasoning_effort 并重试。"
      });
      yield ok({ type: "delta", value: "Opening line.\nAI continuation.\n" });
      yield ok({
        type: "suggestion",
        suggestion: {
          ...suggestion,
          runtimeNotice: "该模型/端点不支持推理强度调节，已自动忽略 reasoning_effort 并重试。"
        }
      });
    };
    const bridge = createAiWritingWorkflowBridge(api);

    bridge.beginStreamingGenerate("Continue with streaming.");
    const finalProps = await bridge.generateStreamingSuggestion(
      "Continue with streaming.",
      (nextProps) => {
        if (nextProps.runtimeNotice !== undefined) {
          updates.push(nextProps.runtimeNotice);
        }
      }
    );

    expect(finalProps.status).toBe("suggestion-ready");
    expect(finalProps.runtimeNotice).toBe(
      "该模型/端点不支持推理强度调节，已自动忽略 reasoning_effort 并重试。"
    );
    expect(updates).toContain(
      "该模型/端点不支持推理强度调节，已自动忽略 reasoning_effort 并重试。"
    );
  });

  test("maps returned chat messages and clears the composer after a successful send", async () => {
    const calls: string[] = [];
    const api = createApi(calls);
    api.ai.generateChapterSuggestion = async (request) => {
      calls.push(`ai.generate:${request.instruction}`);
      return ok({
        ...suggestion,
        conversationMessages: [
          {
            messageId: "msg_user_1",
            role: "user",
            content: "续写这段。",
            createdAt: "2026-07-05T00:00:00.000Z",
            workflowRunId: "wfrun_m14",
            suggestionId: "sug_m14"
          },
          {
            messageId: "msg_assistant_1",
            role: "assistant",
            content: "Generated a local mock continuation for review.",
            createdAt: "2026-07-05T00:00:00.000Z",
            workflowRunId: "wfrun_m14",
            suggestionId: "sug_m14"
          }
        ]
      });
    };
    const bridge = createAiWritingWorkflowBridge(api);

    bridge.beginGenerate("续写这段。");
    const generated = await bridge.generateSuggestion("续写这段。");

    expect(generated.instruction).toBe("");
    expect(generated.conversationMessages).toEqual([
      {
        messageId: "msg_user_1",
        role: "user",
        content: "续写这段。",
        createdAtLabel: "2026-07-05 00:00"
      },
      {
        messageId: "msg_assistant_1",
        role: "assistant",
        content: "Generated a local mock continuation for review.",
        createdAtLabel: "2026-07-05 00:00"
      }
    ]);
    expect(calls).toEqual(["ai.generate:续写这段。"]);
  });

  test("generates selection-aware preview without creating an applyable suggestion", async () => {
    const calls: string[] = [];
    const bridge = createAiWritingWorkflowBridge(createApi(calls));

    const generated = await bridge.generateSelectionPreview({
      instruction: "Rewrite selection.",
      command: {
        commandId: "editor.ai.preview-selection",
        runtimeId: "textarea",
        selection: {
          startOffset: 0,
          endOffset: 13,
          characterCount: 13,
          lineStart: 1,
          lineEnd: 1,
          selectedTextPreview: "Opening line.",
          collapsed: false
        }
      },
      selectedText: "Opening line."
    });

    expect(generated.status).toBe("suggestion-ready");
    expect(generated.summary).toBe("Rewrites only the selected sentence.");
    expect(generated.diffPreview).toEqual(selectionPreview.diffPreview);
    expect(generated.styleReview).toEqual(selectionPreview.styleReview);
    expect(generated.selectionReview).toEqual({
      status: "pending",
      originalText: "Opening line.",
      proposedText: "The opening line tightened.",
      rangeLabel: "0-13",
      compareLabel: "Opening line. -> The opening line tightened.",
      canUndo: false
    });
    const applied = await bridge.applySelectionPreview();

    expect(applied.chapter.body).toContain("AI continuation draft.");
    expect(applied.dirty).toBe(true);
    expect(calls).toEqual([
      "ai.selection:Rewrite selection.:0-13",
      "ai.apply-selection:sug_selection_m74"
    ]);
  });

  test("closes the selection review after applying it through the shared accept action", async () => {
    const calls: string[] = [];
    const bridge = createAiWritingWorkflowBridge(createApi(calls));
    await bridge.generateSelectionPreview({
      instruction: "Rewrite selection.",
      command: {
        commandId: "editor.ai.preview-selection",
        runtimeId: "textarea",
        selection: {
          startOffset: 0,
          endOffset: 13,
          characterCount: 13,
          lineStart: 1,
          lineEnd: 1,
          selectedTextPreview: "Opening line.",
          collapsed: false
        }
      },
      selectedText: "Opening line."
    });

    await bridge.applySuggestion();

    expect(bridge.getProps().selectionReview).toBeUndefined();
    expect(calls).toEqual([
      "ai.selection:Rewrite selection.:0-13",
      "ai.apply-selection:sug_selection_m74"
    ]);
  });

  test("rejects and restores a selection preview review without calling the preload API", async () => {
    const calls: string[] = [];
    const bridge = createAiWritingWorkflowBridge(createApi(calls));

    await bridge.generateSelectionPreview({
      instruction: "Rewrite selection.",
      command: {
        commandId: "editor.ai.preview-selection",
        runtimeId: "textarea",
        selection: {
          startOffset: 0,
          endOffset: 13,
          characterCount: 13,
          lineStart: 1,
          lineEnd: 1,
          selectedTextPreview: "Opening line.",
          collapsed: false
        }
      },
      selectedText: "Opening line."
    });

    const rejected = bridge.rejectSelectionPreview();
    const restored = bridge.undoSelectionPreviewRejection();

    expect(rejected.status).toBe("cancelled");
    expect(rejected.selectionReview).toMatchObject({
      status: "rejected",
      canUndo: true
    });
    expect(restored.status).toBe("suggestion-ready");
    expect(restored.selectionReview).toMatchObject({
      status: "pending",
      canUndo: false
    });
    expect(calls).toEqual(["ai.selection:Rewrite selection.:0-13"]);
  });

  test("keeps failed workflow diagnostics visible and allows user-triggered retry", async () => {
    const calls: string[] = [];
    const api = createApi(calls);
    let failedOnce = false;
    api.ai.generateChapterSuggestion = async (request) => {
      calls.push(`ai.generate:${request.instruction}`);
      if (!failedOnce) {
        failedOnce = true;
        return err(
          createUnifiedError({
            code: "AGENT_MODEL_CALL_FAILED",
            category: "AgentError",
            message: "The agent model call failed.",
            recoverability: "retryable",
            suggestedAction: "Inspect the model profile and retry the workflow step.",
            traceId: "ai-writing-workflow"
          })
        );
      }

      return ok(suggestion);
    };
    api.ai.listWorkflowRuns = async () => ok([failedWorkflowRunSummary()]);
    api.ai.readWorkflowRun = async () => ok(failedWorkflowRunRecord());
    const bridge = createAiWritingWorkflowBridge(api);

    const failed = await bridge.generateSuggestion("续写当前场景");
    const retrying = bridge.beginGenerate(failed.instruction);
    const retried = await bridge.generateSuggestion(retrying.instruction);

    expect(failed.status).toBe("failed");
    expect(failed.failure).toEqual({
      title: "工作流失败",
      code: "AGENT_MODEL_CALL_FAILED",
      message: "The agent model call failed.",
      recoverabilityLabel: "可重试",
      suggestedAction: "Inspect the model profile and retry the workflow step."
    });
    expect(failed.retryPolicy).toEqual({
      modeLabel: "手动重试",
      maxAttemptsLabel: "最多 1 次",
      backoffLabel: "用户手动重试",
      retryableCodesLabel: "LLM_TIMEOUT / LLM_RATE_LIMITED / LLM_PROVIDER_ERROR"
    });
    expect(failed.history?.selectedRun?.statusLabel).toBe("失败");
    expect(failed.history?.selectedRun?.errorLabel).toBe(
      "AGENT_MODEL_CALL_FAILED · The agent model call failed."
    );
    expect(retried.status).toBe("suggestion-ready");
    expect(calls).toEqual(["ai.generate:续写当前场景", "ai.generate:续写当前场景"]);
  });
});

function createApi(calls: string[]): NovelStudioApi {
  let modelSnapshot: ModelSettingsSnapshot = {
    defaultProfileId: "model_default",
    profiles: [defaultModelProfile]
  };

  return {
    getShellState: async () => ({
      projectTitle: "M14",
      activeActivity: "workspace",
      navigatorCollapsed: false,
      inspectorCollapsed: false,
      bottomPanelVisible: true,
      commandPaletteOpen: false,
      saveStatus: "Saved",
      navigatorSections: [],
      bottomPanelTabs: []
    }),
    commands: {
      list: async () => [],
      execute: async () =>
        ok({
          projectTitle: "M14",
          activeActivity: "workspace",
          navigatorCollapsed: false,
          inspectorCollapsed: false,
          bottomPanelVisible: true,
          commandPaletteOpen: false,
          saveStatus: "Saved",
          navigatorSections: [],
          bottomPanelTabs: []
        })
    },
    project: {
      chooseOpenDirectory: async () => {
        throw new Error("not used");
      },
      chooseCreateDirectory: async () => {
        throw new Error("not used");
      },
      open: async () => {
        throw new Error("not used");
      },
      create: async () => {
        throw new Error("not used");
      },
      listChapters: async () => {
        throw new Error("not used");
      },
      createChapter: async () => {
        throw new Error("not used");
      },
      selectChapter: async () => {
        throw new Error("not used");
      }
    },
    ai: {
      generateChapterSuggestion: async (request) => {
        calls.push(`ai.generate:${request.instruction}`);
        return ok(suggestion);
      },
      streamChapterSuggestion: async function* (request) {
        calls.push(`ai.stream:${request.instruction}:${request.reasoningEffort ?? "none"}`);
        yield ok({ type: "delta", value: '{"proposedBody":"' });
        yield ok({ type: "delta", value: 'Opening line.\\nAI continuation draft.\\n"' });
        yield ok({
          type: "delta",
          value: ',"summary":"Generated a local mock continuation for review."}'
        });
        yield ok({ type: "suggestion", suggestion });
      },
      generateSelectionPreview: async (request) => {
        calls.push(
          `ai.selection:${request.instruction}:${request.selection.startOffset}-${request.selection.endOffset}`
        );
        return ok(selectionPreview);
      },
      applySelectionPreview: async (previewId) => {
        calls.push(`ai.apply-selection:${previewId}`);
        return ok(appliedSnapshot);
      },
      applyChapterSuggestion: async (suggestionId) => {
        calls.push(`ai.apply:${suggestionId}`);
        return ok(appliedSnapshot);
      },
      listWorkflowRuns: async () => ok([workflowRunSummary()]),
      readWorkflowRun: async () => ok(workflowRunRecord())
    },
    search: {
      rebuildIndex: async () => {
        throw new Error("not used");
      },
      query: async () => {
        throw new Error("not used");
      }
    },
    storyBible: {
      load: async () => {
        throw new Error("not used");
      },
      saveAsset: async () => {
        throw new Error("not used");
      },
      saveMemory: async () => {
        throw new Error("not used");
      },
      buildConsistencyReport: async () => {
        throw new Error("not used");
      },
      buildContextCandidates: async () => {
        throw new Error("not used");
      }
    },
    chapter: {
      load: async () => {
        throw new Error("not used");
      },
      edit: async () => {
        throw new Error("not used");
      },
      save: async () => {
        throw new Error("not used");
      },
      listVersions: async () => {
        throw new Error("not used");
      },
      previewVersion: async () => {
        throw new Error("not used");
      },
      restoreVersion: async () => {
        throw new Error("not used");
      },
      previewSuggestionDiff: async () => {
        throw new Error("not used");
      }
    },
    settings: {
      listModelProfiles: async () => {
        calls.push("settings.listModelProfiles");
        return ok(modelSnapshot);
      },
      saveModelProfile: async (profile, options) => {
        calls.push(
          `settings.saveModelProfile:${profile.id}:${profile.modelName}:${
            options?.makeDefault === true
          }`
        );
        modelSnapshot = {
          defaultProfileId:
            options?.makeDefault === true ? profile.id : modelSnapshot.defaultProfileId,
          profiles: modelSnapshot.profiles.map((entry) =>
            entry.id === profile.id ? profile : entry
          )
        };
        return ok(modelSnapshot);
      },
      testModelProfileConnection: async () => {
        throw new Error("not used");
      },
      discoverModelOptions: async (profileId) => {
        calls.push(`settings.discoverModelOptions:${profileId}`);
        const profile =
          modelSnapshot.profiles.find((entry) => entry.id === profileId) ?? defaultModelProfile;
        const discovery: ModelDiscoverySnapshot = {
          profileId,
          provider: profile.provider,
          status: "loaded",
          models: [
            {
              id: "example-model",
              displayName: "example-model",
              provider: profile.provider
            },
            {
              id: "gpt-5",
              displayName: "gpt-5",
              provider: profile.provider,
              reasoningStrength: {
                status: "available",
                providerParamName: "reasoning_effort",
                allowedValues: ["low", "medium", "high"],
                defaultValue: "medium"
              }
            }
          ],
          reasoningStrength: {
            status: "hidden",
            reason: "Select a whitelisted reasoning model before exposing reasoning controls."
          }
        };
        return ok(discovery);
      }
    },
    studio: {
      loadConfigAsset: async () => {
        throw new Error("not used");
      },
      saveConfigAsset: async () => {
        throw new Error("not used");
      },
      restoreConfigAssetVersion: async () => {
        throw new Error("not used");
      }
    }
  };
}

function workflowRunSummary(): WorkflowRunSummary {
  return {
    workflowRunId: "wfrun_m14",
    workflowTitle: "Continue Chapter",
    status: "pending-confirmation",
    updatedAt: "2026-07-05T00:00:00.000Z",
    modelLabel: "M14 Mock Writer / mock-writer",
    usageLabel: "24 tokens · estimated",
    costLabel: "USD 0.000000 · estimated"
  };
}

function workflowRunRecord(): WorkflowRunRecord {
  return {
    schemaVersion: "1.0",
    workflowRunId: "wfrun_m14",
    workflowId: "wf_ai_continue_chapter",
    workflowTitle: "Continue Chapter",
    status: "pending-confirmation",
    startedAt: "2026-07-05T00:00:00.000Z",
    updatedAt: "2026-07-05T00:00:00.000Z",
    context: {
      sourceCount: 1,
      tokenEstimate: 4,
      selectionReason: "priority_then_budget"
    },
    model: {
      profileId: "mock_m14",
      displayName: "M14 Mock Writer",
      provider: "mock",
      modelName: "mock-writer"
    },
    usage: {
      inputTokens: 16,
      outputTokens: 8,
      totalTokens: 24,
      usageStatus: "estimated",
      cost: {
        amount: 0,
        currency: "USD",
        status: "estimated"
      }
    },
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

function failedWorkflowRunSummary(): WorkflowRunSummary {
  return {
    workflowRunId: "wfrun_failed_m26",
    workflowTitle: "Continue Chapter",
    status: "failed",
    updatedAt: "2026-07-05T00:01:00.000Z",
    modelLabel: "M14 Mock Writer / mock-writer",
    usageLabel: "0 tokens · missing",
    costLabel: "USD 0.000000 · unknown"
  };
}

function failedWorkflowRunRecord(): WorkflowRunRecord {
  return {
    schemaVersion: "1.0",
    workflowRunId: "wfrun_failed_m26",
    workflowId: "wf_ai_continue_chapter",
    workflowTitle: "Continue Chapter",
    status: "failed",
    startedAt: "2026-07-05T00:01:00.000Z",
    updatedAt: "2026-07-05T00:01:00.000Z",
    context: {
      sourceCount: 1,
      tokenEstimate: 4,
      selectionReason: "续写当前场景"
    },
    model: {
      profileId: "mock_m14",
      displayName: "M14 Mock Writer",
      provider: "mock",
      modelName: "mock-writer"
    },
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      usageStatus: "missing",
      cost: {
        amount: 0,
        currency: "USD",
        status: "unknown"
      }
    },
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
    ],
    error: {
      code: "AGENT_MODEL_CALL_FAILED",
      message: "The agent model call failed.",
      recoverability: "retryable",
      suggestedAction: "Inspect the model profile and retry the workflow step.",
      retryable: true
    },
    retryPolicy: {
      mode: "manual",
      maxAttempts: 1,
      backoffLabel: "用户手动重试",
      retryableCodes: ["LLM_TIMEOUT", "LLM_RATE_LIMITED", "LLM_PROVIDER_ERROR"]
    }
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}
