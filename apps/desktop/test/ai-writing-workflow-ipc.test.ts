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

const suggestion: AiWritingSuggestion = {
  suggestionId: "sug_m14",
  workflowRunId: "wfrun_m14",
  status: "pending-confirmation",
  proposedBody: "Opening line.\nAI continuation.\n",
  summary: "Continues the current scene.",
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
    let nextCount = 0;
    const api = createNovelStudioApi({
      async invoke(channel, ...args) {
        calls.push(`${channel}:${args.length}`);
        if (channel === "application:ai:start-chapter-suggestion-stream") {
          return ok({ streamId: "stream_m14" });
        }
        if (channel === "application:ai:next-chapter-suggestion-stream") {
          nextCount += 1;
          return nextCount === 1
            ? ok({ done: false, event: { type: "delta", value: "The city" } })
            : ok({ done: true });
        }
        if (channel === "application:ai:cancel-chapter-suggestion-stream") {
          return ok(undefined);
        }
        throw new Error(`Unexpected channel: ${channel}`);
      }
    });

    const events = [];
    for await (const event of api.ai.streamChapterSuggestion({ instruction: "Continue." })) {
      events.push(event);
    }

    expect(events).toEqual([ok({ type: "delta", value: "The city" })]);
    expect(calls).toEqual([
      "application:ai:start-chapter-suggestion-stream:1",
      "application:ai:next-chapter-suggestion-stream:1",
      "application:ai:next-chapter-suggestion-stream:1"
    ]);
  });

  test("cancels the preload stream when the caller aborts", async () => {
    const calls: string[] = [];
    const controller = new AbortController();
    const api = createNovelStudioApi({
      async invoke(channel, ...args) {
        calls.push(`${channel}:${args.length}`);
        if (channel === "application:ai:start-chapter-suggestion-stream") {
          return ok({ streamId: "stream_cancel_m14" });
        }
        if (channel === "application:ai:next-chapter-suggestion-stream") {
          return ok({ done: false, event: { type: "delta", value: "The city" } });
        }
        if (channel === "application:ai:cancel-chapter-suggestion-stream") {
          return ok(undefined);
        }
        throw new Error(`Unexpected channel: ${channel}`);
      }
    });

    const iterator = api.ai
      .streamChapterSuggestion({ instruction: "Continue." }, { signal: controller.signal })
      [Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: ok({ type: "delta", value: "The city" })
    });
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await iterator.return?.();

    expect(calls).toContain("application:ai:cancel-chapter-suggestion-stream:1");
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
