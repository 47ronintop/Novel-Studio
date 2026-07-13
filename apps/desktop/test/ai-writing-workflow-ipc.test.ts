import { describe, expect, test } from "vitest";

import { ok, type Result, type UnifiedError } from "@novel-studio/shared";
import type {
  AiWritingSuggestion,
  AiWritingSelectionPreview,
  ApplicationCommand,
  ChapterEditorSnapshot,
  DesktopApplication,
  DesktopShellState,
  WorkflowRunRecord,
  WorkflowRunSummary
} from "@novel-studio/application";

import { createApplicationIpcHandlers } from "../src/main/ipc-handlers.js";
import { createNovelStudioApi } from "../src/preload/api.js";

const shellState: DesktopShellState = {
  projectTitle: "M14",
  activeActivity: "workspace",
  navigatorCollapsed: false,
  inspectorCollapsed: false,
  bottomPanelVisible: true,
  commandPaletteOpen: false,
  saveStatus: "Saved",
  navigatorSections: [],
  bottomPanelTabs: []
};

const cleanStyleReview = {
  status: "clean" as const,
  hitCount: 0,
  hits: []
};

const suggestion: AiWritingSuggestion = {
  suggestionId: "sug_m14",
  workflowRunId: "wfrun_m14",
  status: "pending-confirmation",
  proposedBody: "Opening line.\nAI continuation.\n",
  summary: "Continues the current scene.",
  conversationMessages: [],
  styleReview: cleanStyleReview,
  diffPreview: {
    title: "AI suggestion",
    changes: [{ kind: "replace", value: "Opening line.\nAI continuation.\n" }]
  },
  contextTrace: {
    selectionReason: "Continue.",
    includedRefs: [],
    excludedRefs: []
  },
  observability: {
    workflowRunId: "wfrun_m14",
    workflowTitle: "Continue Chapter",
    generatedAt: "2026-07-04T00:00:00.000Z",
    context: {
      sourceCount: 0,
      tokenEstimate: 0,
      selectionReason: "Continue."
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
    steps: []
  }
};

const selectionPreview: AiWritingSelectionPreview = {
  previewId: "sug_selection_m74",
  workflowRunId: "wfrun_selection_m74",
  previewOnly: true,
  proposedText: "The opening line tightened.",
  summary: "Rewrites only the selected sentence.",
  styleReview: cleanStyleReview,
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
    changes: [{ kind: "replace", value: "The opening line tightened.\n" }]
  },
  contextTrace: {
    selectionReason: "Rewrite.",
    includedRefs: [],
    excludedRefs: []
  },
  observability: {
    workflowRunId: "wfrun_selection_m74",
    workflowTitle: "Selection Preview",
    generatedAt: "2026-07-04T00:00:00.000Z",
    context: {
      sourceCount: 0,
      tokenEstimate: 0,
      selectionReason: "Rewrite."
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
    steps: []
  }
};

describe("M14 AI writing workflow IPC", () => {
  test("exposes clone-safe start, subscribe, and cancel stream methods to the renderer", () => {
    const api = createNovelStudioApi({
      async invoke() {
        throw new Error("not used");
      }
    });
    const streamApi = api.ai as unknown as Record<string, unknown>;

    expect(typeof streamApi["startChapterSuggestionStream"]).toBe("function");
    expect(typeof streamApi["onChapterSuggestionStreamEvent"]).toBe("function");
    expect(typeof streamApi["cancelChapterSuggestionStream"]).toBe("function");
    expect("streamChapterSuggestion" in streamApi).toBe(false);
  });

  test("exposes generate and apply through the preload API", async () => {
    const calls: string[] = [];
    const api = createNovelStudioApi({
      async invoke(channel, ...args) {
        calls.push(`${channel}:${args.length}`);
        return channel === "application:ai:apply-chapter-suggestion"
          ? ok(chapterSnapshot())
          : ok(suggestion);
      }
    });

    await api.ai.generateChapterSuggestion({ instruction: "Continue." });
    await api.ai.applyChapterSuggestion("sug_m14");

    expect(calls).toEqual([
      "application:ai:generate-chapter-suggestion:1",
      "application:ai:apply-chapter-suggestion:1"
    ]);
  });

  test("exposes selection preview generation through the preload API", async () => {
    const calls: string[] = [];
    const api = createNovelStudioApi({
      async invoke(channel, ...args) {
        calls.push(`${channel}:${args.length}`);
        return ok(selectionPreview);
      }
    });

    await api.ai.generateSelectionPreview({
      instruction: "Rewrite.",
      selection: {
        startOffset: 0,
        endOffset: 13,
        selectedText: "Opening line."
      }
    });

    expect(calls).toEqual(["application:ai:generate-selection-preview:1"]);
  });

  test("exposes selection preview apply through the preload API", async () => {
    const calls: string[] = [];
    const api = createNovelStudioApi({
      async invoke(channel, ...args) {
        calls.push(`${channel}:${args.length}`);
        return ok(chapterSnapshot());
      }
    });

    await api.ai.applySelectionPreview("sug_selection_m76");

    expect(calls).toEqual(["application:ai:apply-selection-preview:1"]);
  });

  test("routes AI writing IPC channels to the Application layer", async () => {
    const handlers = createApplicationIpcHandlers(createFakeApplication());

    await expect(
      handlers["application:ai:generate-chapter-suggestion"]({ instruction: "Continue." })
    ).resolves.toEqual(ok(suggestion));
    await expect(handlers["application:ai:apply-chapter-suggestion"]("sug_m14")).resolves.toEqual(
      ok(chapterSnapshot())
    );
  });

  test("routes selection preview IPC channel to the Application layer", async () => {
    const handlers = createApplicationIpcHandlers(createFakeApplication());

    await expect(
      handlers["application:ai:generate-selection-preview"]({
        instruction: "Rewrite.",
        selection: {
          startOffset: 0,
          endOffset: 13,
          selectedText: "Opening line."
        }
      })
    ).resolves.toEqual(ok(selectionPreview));
  });

  test("routes selection preview apply IPC channel to the Application layer", async () => {
    const handlers = createApplicationIpcHandlers(createFakeApplication());

    await expect(
      handlers["application:ai:apply-selection-preview"]("sug_selection_m76")
    ).resolves.toEqual(ok(chapterSnapshot()));
  });

  test("exposes workflow run history through the preload API", async () => {
    const calls: string[] = [];
    const api = createNovelStudioApi({
      async invoke(channel, ...args) {
        calls.push(`${channel}:${args.length}`);
        return channel === "application:ai:read-workflow-run"
          ? ok(workflowRunRecord())
          : ok([workflowRunSummary()]);
      }
    });

    await api.ai.listWorkflowRuns();
    await api.ai.readWorkflowRun("wfrun_m14");

    expect(calls).toEqual([
      "application:ai:list-workflow-runs:0",
      "application:ai:read-workflow-run:1"
    ]);
  });

  test("streams chapter suggestion events through the preload API", async () => {
    const calls: string[] = [];
    let listener: ((payload: unknown) => void) | undefined;
    const api = createNovelStudioApi({
      async invoke(channel, ...args) {
        calls.push(`${channel}:${args.length}`);
        if (channel === "application:ai:start-chapter-suggestion-push-stream") {
          return ok({ streamId: "stream_m14" });
        }
        if (channel === "application:ai:cancel-chapter-suggestion-push-stream") {
          return ok(undefined);
        }
        throw new Error(`Unexpected channel: ${channel}`);
      },
      on(channel, nextListener) {
        calls.push(`${channel}:listener`);
        listener = nextListener;
        return () => undefined;
      }
    });

    const events: unknown[] = [];
    const unsubscribe = api.ai.onChapterSuggestionStreamEvent((event) => events.push(event));
    await api.ai.startChapterSuggestionStream({ streamId: "stream_m14", instruction: "Continue." });
    listener?.({
      streamId: "stream_m14",
      sequence: 1,
      type: "event",
      event: { type: "delta", value: "The city" }
    });
    listener?.({ streamId: "stream_m14", sequence: 2, type: "completed" });
    unsubscribe();

    expect(events).toEqual([
      {
        streamId: "stream_m14",
        sequence: 1,
        type: "event",
        event: { type: "delta", value: "The city" }
      },
      { streamId: "stream_m14", sequence: 2, type: "completed" }
    ]);
    expect(calls).toEqual([
      "application:ai:chapter-suggestion-push-event:listener",
      "application:ai:start-chapter-suggestion-push-stream:1"
    ]);
  });

  test("cancels the preload stream when the caller aborts", async () => {
    const calls: string[] = [];
    const api = createNovelStudioApi({
      async invoke(channel, ...args) {
        calls.push(`${channel}:${args.length}`);
        if (channel === "application:ai:start-chapter-suggestion-push-stream") {
          return ok({ streamId: "stream_cancel_m14" });
        }
        if (channel === "application:ai:cancel-chapter-suggestion-push-stream") {
          return ok(undefined);
        }
        throw new Error(`Unexpected channel: ${channel}`);
      }
    });

    await api.ai.startChapterSuggestionStream({
      streamId: "stream_cancel_m14",
      instruction: "Continue."
    });
    await api.ai.cancelChapterSuggestionStream("stream_cancel_m14");

    expect(calls).toContain("application:ai:cancel-chapter-suggestion-push-stream:1");
  });

  test("routes workflow run history IPC channels to the Application layer", async () => {
    const handlers = createApplicationIpcHandlers(createFakeApplication());

    await expect(handlers["application:ai:list-workflow-runs"]()).resolves.toEqual(
      ok([workflowRunSummary()])
    );
    await expect(handlers["application:ai:read-workflow-run"]("wfrun_m14")).resolves.toEqual(
      ok(workflowRunRecord())
    );
  });

  test("routes AI stream IPC channels to the Application layer and aborts on cancel", async () => {
    let abortSignal: AbortSignal | undefined;
    const application = createFakeApplication();
    application.streamActiveChapterSuggestion = (request) => {
      abortSignal = request.abortSignal;
      return (async function* () {
        yield ok({ type: "delta", value: "The city" });
        yield ok({ type: "suggestion", suggestion });
      })();
    };
    const handlers = createApplicationIpcHandlers(application);

    const started = await handlers["application:ai:start-chapter-suggestion-stream"]({
      instruction: "Continue."
    });

    expect(started).toMatchObject({ ok: true, value: { streamId: expect.any(String) } });
    if (!isOkStreamStart(started)) {
      throw new Error("Expected the stream to start.");
    }

    await expect(
      handlers["application:ai:next-chapter-suggestion-stream"](started.value.streamId)
    ).resolves.toEqual(ok({ done: false, event: { type: "delta", value: "The city" } }));
    await expect(
      handlers["application:ai:cancel-chapter-suggestion-stream"](started.value.streamId)
    ).resolves.toEqual(ok(undefined));
    expect(abortSignal?.aborted).toBe(true);
  });

  test("pushes clone-safe stream events from main without exposing an iterator", async () => {
    const published: unknown[] = [];
    const application = createFakeApplication();
    application.streamActiveChapterSuggestion = () =>
      (async function* () {
        yield ok({ type: "delta", value: "The city" });
      })();
    const handlers = createApplicationIpcHandlers(application, {
      publishAiSuggestionStreamEvent: (event) => published.push(event)
    });

    await expect(
      handlers["application:ai:start-chapter-suggestion-push-stream"]({
        streamId: "push_m14",
        instruction: "Continue."
      })
    ).resolves.toEqual(ok({ streamId: "push_m14" }));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(published).toHaveLength(2);
    expect(() => structuredClone(published)).not.toThrow();
    expect(published).toEqual([
      {
        streamId: "push_m14",
        sequence: 1,
        type: "event",
        event: { type: "delta", value: "The city" }
      },
      { streamId: "push_m14", sequence: 2, type: "completed" }
    ]);
  });

  test("converts a non-cloneable application stream payload into a terminal stream error", async () => {
    const published: Array<Record<string, unknown>> = [];
    const application = createFakeApplication();
    application.streamActiveChapterSuggestion = () =>
      (async function* () {
        yield ok({
          type: "suggestion",
          suggestion: {
            ...suggestion,
            nonCloneable: () => undefined
          }
        } as unknown as import("@novel-studio/application").AiWritingSuggestionStreamEvent);
      })();
    const handlers = createApplicationIpcHandlers(application, {
      publishAiSuggestionStreamEvent: (event) => published.push(event)
    });

    await handlers["application:ai:start-chapter-suggestion-push-stream"]({
      streamId: "push_non_cloneable",
      instruction: "Continue."
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(published).toMatchObject([
      {
        streamId: "push_non_cloneable",
        sequence: 1,
        type: "error",
        error: { code: "AI_STREAM_PAYLOAD_NOT_CLONEABLE" }
      },
      { streamId: "push_non_cloneable", sequence: 2, type: "completed" }
    ]);
    expect(() => structuredClone(published)).not.toThrow();
  });

  test("normalizes thrown AI stream iterator errors and removes the failed stream", async () => {
    const application = createFakeApplication();
    application.streamActiveChapterSuggestion = () =>
      (async function* () {
        const error = new Error("Provider returned a non-SSE streaming response.") as Error & {
          status: number;
          body: { readonly bodyPreview: string };
        };
        error.status = 502;
        error.body = { bodyPreview: "<html>Provider console</html>" };
        throw error;
        yield ok({ type: "delta", value: "" });
      })();
    const handlers = createApplicationIpcHandlers(application);

    const started = await handlers["application:ai:start-chapter-suggestion-stream"]({
      instruction: "Continue."
    });

    expect(started).toMatchObject({ ok: true, value: { streamId: expect.any(String) } });
    if (!isOkStreamStart(started)) {
      throw new Error("Expected the stream to start.");
    }

    await expect(
      handlers["application:ai:next-chapter-suggestion-stream"](started.value.streamId)
    ).resolves.toMatchObject({
      ok: false,
      error: {
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
      }
    });

    await expect(
      handlers["application:ai:next-chapter-suggestion-stream"](started.value.streamId)
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: "AI_STREAM_NOT_FOUND"
      }
    });
  });
});

function createFakeApplication(): DesktopApplication {
  return {
    getShellState: () => shellState,
    listCommands: (): readonly ApplicationCommand[] => [],
    executeCommand: () => ok(shellState),
    openProject: unsupported,
    createProject: unsupported,
    listProjectChapters: unsupported,
    createProjectChapter: unsupported,
    selectProjectChapter: unsupported,
    generateActiveChapterSuggestion: async () => ok(suggestion),
    generateActiveSelectionPreview: async () => ok(selectionPreview),
    applyActiveSelectionPreview: async () => ok(chapterSnapshot()),
    applyActiveChapterSuggestion: async () => ok(chapterSnapshot()),
    listWorkflowRuns: async () => ok([workflowRunSummary()]),
    readWorkflowRun: async () => ok(workflowRunRecord()),
    loadActiveChapter: unsupported,
    editActiveChapter: unsupported,
    saveActiveChapter: unsupported,
    listActiveChapterVersions: unsupported,
    previewActiveChapterVersion: unsupported,
    restoreActiveChapterVersion: unsupported,
    previewActiveChapterSuggestionDiff: () => ok({ title: "AI suggestion", changes: [] }),
    listModelProfiles: unsupported,
    saveModelProfile: unsupported,
    testModelProfileConnection: unsupported,
    loadConfigAsset: unsupported,
    saveConfigAsset: unsupported,
    restoreConfigAssetVersion: unsupported
  };
}

function workflowRunSummary(): WorkflowRunSummary {
  return {
    workflowRunId: "wfrun_m14",
    workflowTitle: "Continue Chapter",
    status: "pending-confirmation",
    updatedAt: "2026-07-04T00:00:00.000Z",
    modelLabel: "M14 Mock Writer / mock-writer",
    usageLabel: "0 tokens · missing",
    costLabel: "USD 0.000000 · unknown"
  };
}

function workflowRunRecord(): WorkflowRunRecord {
  return {
    schemaVersion: "1.0",
    workflowRunId: "wfrun_m14",
    workflowId: "wf_ai_continue_chapter",
    workflowTitle: "Continue Chapter",
    status: "pending-confirmation",
    startedAt: "2026-07-04T00:00:00.000Z",
    updatedAt: "2026-07-04T00:00:00.000Z",
    context: {
      sourceCount: 0,
      tokenEstimate: 0,
      selectionReason: "Continue."
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
    steps: []
  };
}

function chapterSnapshot(): ChapterEditorSnapshot {
  return {
    state: {
      chapter: {
        frontmatter: {
          schemaVersion: "1.0",
          id: "ch_m14",
          type: "chapter",
          title: "M14",
          order: 1,
          status: "draft",
          createdAt: "2026-07-04T00:00:00.000Z",
          updatedAt: "2026-07-04T00:00:00.000Z"
        },
        body: "Opening line.\nAI continuation.\n"
      },
      dirty: true,
      saveStatus: "Unsaved"
    },
    versions: []
  };
}

async function unsupported<T>(): Promise<Result<T, UnifiedError>> {
  throw new Error("Not used by this test.");
}

function isOkStreamStart(
  value: unknown
): value is { readonly ok: true; readonly value: { readonly streamId: string } } {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    value.ok === true &&
    "value" in value &&
    typeof value.value === "object" &&
    value.value !== null &&
    "streamId" in value.value &&
    typeof value.value.streamId === "string"
  );
}
