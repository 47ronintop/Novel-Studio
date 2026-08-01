// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { NovelStudioApi, StoryAnalysisCompletionEvent } from "@novel-studio/application";
import type {
  ChapterEditorProps,
  ProjectWorkflowProps,
  StoryBibleEditorProps
} from "@novel-studio/ui";
import { ok } from "@novel-studio/shared";

import {
  chapterCompletionFeedback,
  chapterStatusErrorMessage,
  useStoryAnalysisWorkspace
} from "../src/renderer/story-analysis-workspace.js";
import type { ChapterEditorBridge } from "../src/renderer/chapter-editor-bridge.js";
import type { StoryBibleBridge } from "../src/renderer/story-bible-bridge.js";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("Story Analysis workspace chapter completion feedback", () => {
  let root: Root | undefined;
  let host: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = undefined;
    host = undefined;
  });

  test("maps completion dispositions without offering a duplicate analysis action", () => {
    const onAnalyze = vi.fn();

    expect(chapterCompletionFeedback({ status: "not-triggered" }, onAnalyze)).toBeUndefined();
    expect(chapterCompletionFeedback({ status: "disabled", mode: "off" }, onAnalyze)).toEqual({
      kind: "info",
      message: "章节已完成，章后资料分析当前已关闭。"
    });
    expect(
      chapterCompletionFeedback(
        { status: "scheduled", mode: "background-review", chapterId: "chapter-1" },
        onAnalyze
      )
    ).toEqual({
      kind: "info",
      message: "章节已完成，资料分析已在后台启动。"
    });
    expect(
      chapterCompletionFeedback({ status: "unavailable", code: "MODEL_MISSING" }, onAnalyze)
    ).toEqual({
      kind: "error",
      message: "章节已保存，但资料分析暂不可用（MODEL_MISSING）。"
    });
    expect(onAnalyze).not.toHaveBeenCalled();
  });

  test("passes the completed chapter to the prompt analysis action", () => {
    const onAnalyze = vi.fn();
    const feedback = chapterCompletionFeedback(
      { status: "prompt", mode: "prompt", chapterId: "chapter-1" },
      onAnalyze
    );

    expect(feedback).toMatchObject({
      kind: "info",
      action: { label: "立即分析" }
    });
    feedback?.action?.onInvoke();
    expect(onAnalyze).toHaveBeenCalledWith("chapter-1");
  });

  test("keeps a useful status-save error fallback", () => {
    expect(chapterStatusErrorMessage(new Error("write failed"))).toBe("write failed");
    expect(chapterStatusErrorMessage(new Error("   "))).toBe("章节状态保存失败，请重试。");
    expect(chapterStatusErrorMessage(undefined)).toBe("章节状态保存失败，请重试。");
  });

  test("clears a scheduled marker when completion arrives before the status save resolves", async () => {
    const editor = {
      chapter: { frontmatter: { id: "ch_01" } }
    } as ChapterEditorProps;
    const workflow = {
      activeChapterId: "ch_01",
      chapters: [
        { id: "ch_01", order: 1, status: "done" },
        { id: "ch_02", order: 2, status: "draft" }
      ]
    } as ProjectWorkflowProps;
    let completionListener: ((event: StoryAnalysisCompletionEvent) => void) | undefined;
    let resolveSave:
      | ((value: {
          readonly editor: ChapterEditorProps;
          readonly completionAnalysis: {
            readonly status: "scheduled";
            readonly mode: "background-review";
            readonly chapterId: string;
          };
        }) => void)
      | undefined;
    const saveWithStatus = vi.fn(
      () =>
        new Promise<{
          readonly editor: ChapterEditorProps;
          readonly completionAnalysis: {
            readonly status: "scheduled";
            readonly mode: "background-review";
            readonly chapterId: string;
          };
        }>((resolve) => {
          resolveSave = resolve;
        })
    );
    const api = {
      storyAnalysis: {
        onCompletion: (listener: (event: StoryAnalysisCompletionEvent) => void) => {
          completionListener = listener;
          return () => undefined;
        },
        list: async () => ok([]),
        read: async () => ok(undefined),
        analyzeChapter: async () => ok(undefined)
      },
      settings: {
        readStoryAnalysisSettings: async () =>
          ok({
            completionMode: "background-review" as const,
            storyBibleMaintenanceMode: "review" as const
          })
      }
    } as unknown as NovelStudioApi;
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    let workspace: ReturnType<typeof useStoryAnalysisWorkspace> | undefined;

    function Harness() {
      workspace = useStoryAnalysisWorkspace({
        api,
        activeCreativeProjectId: "project-01",
        activeCreativeWorkspaceId: "workspace-01",
        activeChapterId: "ch_01",
        projectWorkflow: workflow,
        chapterBridge: { saveWithStatus } as unknown as ChapterEditorBridge,
        chapterEditor: editor,
        projectWorkflowBridge: undefined,
        storyBibleBridge: undefined,
        storyBibleEditor: undefined,
        setChapterEditor: () => undefined,
        setProjectWorkflow: () => undefined,
        setStoryBible: () => undefined,
        setStoryBibleEditor: () => undefined
      });
      return null;
    }

    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(createElement(Harness));
      await Promise.resolve();
    });
    expect(completionListener).toBeDefined();

    act(() => workspace?.onChapterStatusChange("done"));
    completionListener?.({
      schemaVersion: "1.0",
      projectId: "project-01",
      chapterId: "ch_01",
      workflowRunId: "wfrun_story_fast_completion",
      trigger: "chapter_completed",
      workflowStatus: "pending-confirmation",
      storyBibleChanged: false
    });
    await act(async () => {
      resolveSave?.({
        editor,
        completionAnalysis: {
          status: "scheduled",
          mode: "background-review",
          chapterId: "ch_01"
        }
      });
      await Promise.resolve();
    });

    await expect(workspace?.beforeNavigateToChapter("ch_02")).resolves.toBe(true);
    expect(confirm).not.toHaveBeenCalled();

    act(() => workspace?.onChapterStatusChange("done"));
    completionListener?.({
      schemaVersion: "1.0",
      projectId: "project-01",
      chapterId: "ch_01",
      workflowRunId: "wfrun_story_manual_completion",
      trigger: "manual",
      workflowStatus: "pending-confirmation",
      storyBibleChanged: false
    });
    await act(async () => {
      resolveSave?.({
        editor,
        completionAnalysis: {
          status: "scheduled",
          mode: "background-review",
          chapterId: "ch_01"
        }
      });
      await Promise.resolve();
    });

    await expect(workspace?.beforeNavigateToChapter("ch_02")).resolves.toBe(false);
    expect(confirm).toHaveBeenCalledOnce();
  });

  test("ignores completion events from the previous project scope", async () => {
    const listeners = new Set<(event: StoryAnalysisCompletionEvent) => void>();
    const api = {
      storyAnalysis: {
        onCompletion: (listener: (event: StoryAnalysisCompletionEvent) => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        list: async () => ok([])
      },
      settings: {
        readStoryAnalysisSettings: async () =>
          ok({
            completionMode: "background-review" as const,
            storyBibleMaintenanceMode: "safe-auto" as const
          })
      }
    } as unknown as NovelStudioApi;
    const storyBibleEditor = { dirty: false } as StoryBibleEditorProps;
    const handleStoryAnalysisExternalUpdate = vi.fn(async () => storyBibleEditor);
    const getSnapshotBinding = vi.fn((workspaceId: string) => ({ workspaceId }));
    const storyBibleBridge = {
      getSnapshot: () => ({}),
      getSnapshotBinding,
      getProps: () => ({ assets: [] }),
      handleStoryAnalysisExternalUpdate
    } as unknown as StoryBibleBridge;
    const setChapterEditor = vi.fn();
    const setStoryBible = vi.fn();
    const setStoryBibleEditor = vi.fn();

    function Harness({ projectId, workspaceId }: { projectId: string; workspaceId: string }) {
      useStoryAnalysisWorkspace({
        api,
        activeCreativeProjectId: projectId,
        activeCreativeWorkspaceId: workspaceId,
        activeChapterId: undefined,
        projectWorkflow: undefined,
        chapterBridge: undefined,
        chapterEditor: undefined,
        projectWorkflowBridge: undefined,
        storyBibleBridge,
        storyBibleEditor: undefined,
        setChapterEditor,
        setProjectWorkflow: () => undefined,
        setStoryBible,
        setStoryBibleEditor
      });
      return null;
    }

    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(createElement(Harness, { projectId: "project-a", workspaceId: "workspace-a" }));
      await Promise.resolve();
    });

    await act(async () => {
      root?.render(createElement(Harness, { projectId: "project-b", workspaceId: "workspace-b" }));
      await Promise.resolve();
    });
    expect(listeners.size).toBe(1);

    const staleEvent: StoryAnalysisCompletionEvent = {
      schemaVersion: "1.0",
      projectId: "project-a",
      chapterId: "ch_01",
      workflowRunId: "wfrun_story_project_a",
      trigger: "chapter_completed",
      workflowStatus: "applied",
      storyBibleChanged: true
    };
    await act(async () => {
      for (const listener of [...listeners]) listener(staleEvent);
      await Promise.resolve();
    });
    expect(handleStoryAnalysisExternalUpdate).not.toHaveBeenCalled();
    expect(setStoryBible).not.toHaveBeenCalled();

    await act(async () => {
      for (const listener of [...listeners]) {
        listener({
          ...staleEvent,
          projectId: "project-b",
          workflowRunId: "wfrun_story_project_b"
        });
      }
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(getSnapshotBinding).toHaveBeenCalledWith("workspace-b"));
    expect(handleStoryAnalysisExternalUpdate).toHaveBeenCalledWith({
      projectId: "workspace-b",
      updateId: "wfrun_story_project_b"
    });
  });
});
