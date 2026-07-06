import { describe, expect, test } from "vitest";

import type {
  AiWritingSelectionPreview,
  AiWritingSuggestion,
  ChapterEditorSnapshot,
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

describe("AI writing workflow bridge", () => {
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
        throw new Error("not used");
      },
      saveModelProfile: async () => {
        throw new Error("not used");
      },
      testModelProfileConnection: async () => {
        throw new Error("not used");
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
