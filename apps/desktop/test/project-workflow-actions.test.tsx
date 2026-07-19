// @vitest-environment jsdom
import { act, type SetStateAction } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";

import type {
  ChapterEditorProps,
  ProjectWorkflowProps,
  StoryBibleEditorProps,
  StoryBibleSummaryProps
} from "@novel-studio/ui";
import { useProjectWorkflowActions } from "../src/renderer/project-workflow-actions.js";
import type { ProjectWorkflowBridge } from "../src/renderer/project-workflow-bridge.js";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("useProjectWorkflowActions", () => {
  let root: Root | undefined;
  let host: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = undefined;
    host = undefined;
  });

  test("preserves project-bound story projections while workspace transitions are pending", () => {
    const storyBibleStates: Array<StoryBibleSummaryProps | undefined> = [];
    const storyBibleEditorStates: Array<StoryBibleEditorProps | undefined> = [];
    const neverSettles = new Promise<ProjectWorkflowProps>(() => undefined);
    const workflow = createWorkflow();
    const bridge = {
      getProps: () => workflow,
      openProject: () => neverSettles,
      createProject: () => neverSettles,
      createExampleProject: () => neverSettles
    } as unknown as ProjectWorkflowBridge;
    let actions: ReturnType<typeof useProjectWorkflowActions> | undefined;

    function Harness() {
      actions = useProjectWorkflowActions({
        api: undefined,
        chapterBridge: undefined,
        projectWorkflowBridge: bridge,
        settingsBridge: undefined,
        storyBibleBridge: undefined,
        studioBridge: undefined,
        setChapterEditor: () => undefined,
        setProjectWorkflow: () => undefined,
        setSettings: () => undefined,
        setShellState: () => undefined,
        setStoryBible: (next) => storyBibleStates.push(resolveState(next)),
        setStoryBibleEditor: (next) => storyBibleEditorStates.push(resolveState(next)),
        setStudio: () => undefined
      });
      return null;
    }

    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(<Harness />));

    act(() => {
      actions?.handleOpenProject();
      actions?.handleCreateProject();
      actions?.handleCreateExampleProject();
    });

    expect(storyBibleStates).toEqual([]);
    expect(storyBibleEditorStates).toEqual([]);
  });

  test("clears project-bound story projections only after successful activation", async () => {
    const storyBibleStates: Array<StoryBibleSummaryProps | undefined> = [];
    const storyBibleEditorStates: Array<StoryBibleEditorProps | undefined> = [];
    const currentWorkflow = {
      ...createWorkflow(),
      projectId: "project-a",
      status: "ready" as const
    };
    const nextWorkflow = { ...createWorkflow(), projectId: "project-b", status: "ready" as const };
    let resolveOpenProject: ((workflow: ProjectWorkflowProps) => void) | undefined;
    const opening = new Promise<ProjectWorkflowProps>((resolve) => {
      resolveOpenProject = resolve;
    });
    const bridge = {
      getProps: () => currentWorkflow,
      openProject: () => opening
    } as unknown as ProjectWorkflowBridge;
    let actions: ReturnType<typeof useProjectWorkflowActions> | undefined;

    function Harness() {
      actions = useProjectWorkflowActions({
        api: undefined,
        chapterBridge: undefined,
        projectWorkflowBridge: bridge,
        settingsBridge: undefined,
        storyBibleBridge: undefined,
        studioBridge: undefined,
        setChapterEditor: () => undefined,
        setProjectWorkflow: () => undefined,
        setSettings: () => undefined,
        setShellState: () => undefined,
        setStoryBible: (next) => storyBibleStates.push(resolveState(next)),
        setStoryBibleEditor: (next) => storyBibleEditorStates.push(resolveState(next)),
        setStudio: () => undefined
      });
      return null;
    }

    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(<Harness />));

    act(() => actions?.handleOpenProject());
    expect(storyBibleStates).toEqual([]);
    expect(storyBibleEditorStates).toEqual([]);

    await act(async () => {
      resolveOpenProject?.(nextWorkflow);
      await opening;
    });

    expect(storyBibleStates).toEqual([undefined]);
    expect(storyBibleEditorStates).toEqual([undefined]);
  });

  test("keeps project-bound story projections when activation is canceled", async () => {
    const storyBibleStates: Array<StoryBibleSummaryProps | undefined> = [];
    const storyBibleEditorStates: Array<StoryBibleEditorProps | undefined> = [];
    const currentWorkflow = {
      ...createWorkflow(),
      projectId: "project-a",
      status: "ready" as const
    };
    const canceled = Promise.resolve({
      ...currentWorkflow,
      feedback: { kind: "info" as const, message: "Project opening was canceled." }
    });
    const bridge = {
      getProps: () => currentWorkflow,
      openProject: () => canceled
    } as unknown as ProjectWorkflowBridge;
    let actions: ReturnType<typeof useProjectWorkflowActions> | undefined;

    function Harness() {
      actions = useProjectWorkflowActions({
        api: undefined,
        chapterBridge: undefined,
        projectWorkflowBridge: bridge,
        settingsBridge: undefined,
        storyBibleBridge: undefined,
        studioBridge: undefined,
        setChapterEditor: () => undefined,
        setProjectWorkflow: () => undefined,
        setSettings: () => undefined,
        setShellState: () => undefined,
        setStoryBible: (next) => storyBibleStates.push(resolveState(next)),
        setStoryBibleEditor: (next) => storyBibleEditorStates.push(resolveState(next)),
        setStudio: () => undefined
      });
      return null;
    }

    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(<Harness />));

    await act(async () => {
      actions?.handleOpenProject();
      await canceled;
    });

    expect(storyBibleStates).toEqual([]);
    expect(storyBibleEditorStates).toEqual([]);
  });

  test("adopts the prepared successor when closing the active chapter tab", async () => {
    const nextWorkflow = { ...createWorkflow(), activeChapterId: "chapter_1" };
    const preparedEditor = createChapterEditor("chapter_1");
    const adoptedEditor = { ...preparedEditor, saveStatus: "Unsaved" as const };
    const closeChapterTab = vi.fn(async () => ({
      projectWorkflow: nextWorkflow,
      chapterEditor: preparedEditor
    }));
    const adopt = vi.fn(() => adoptedEditor);
    const load = vi.fn();
    const workflowStates: Array<ProjectWorkflowProps | undefined> = [];
    const editorStates: Array<ChapterEditorProps | undefined> = [];
    const fileStates: unknown[] = [];
    const bridge = { closeChapterTab } as unknown as ProjectWorkflowBridge;
    let actions: ReturnType<typeof useProjectWorkflowActions> | undefined;

    function Harness() {
      actions = useProjectWorkflowActions({
        api: undefined,
        chapterBridge: { adopt, load } as never,
        projectWorkflowBridge: bridge,
        settingsBridge: undefined,
        storyBibleBridge: undefined,
        studioBridge: undefined,
        setChapterEditor: (next) => editorStates.push(resolveState(next)),
        setFileEditor: (next) => fileStates.push(resolveState(next)),
        setProjectWorkflow: (next) => workflowStates.push(resolveState(next)),
        setSettings: () => undefined,
        setShellState: () => undefined,
        setStoryBible: () => undefined,
        setStoryBibleEditor: () => undefined,
        setStudio: () => undefined
      });
      return null;
    }

    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(<Harness />));

    await act(async () => {
      actions?.handleCloseChapterTab("chapter_2");
      await Promise.resolve();
    });

    expect(closeChapterTab).toHaveBeenCalledWith("chapter_2");
    expect(adopt).toHaveBeenCalledWith(preparedEditor);
    expect(load).not.toHaveBeenCalled();
    expect(workflowStates).toEqual([nextWorkflow]);
    expect(editorStates).toEqual([adoptedEditor]);
    expect(fileStates).toEqual([undefined]);
  });

  test("restores the previous project workflow with feedback when project opening rejects", async () => {
    const currentWorkflow = {
      ...createWorkflow(),
      projectId: "project-a",
      status: "ready" as const
    };
    const workflowStates: Array<ProjectWorkflowProps | undefined> = [];
    const bridge = {
      getProps: () => currentWorkflow,
      openProject: async () => {
        throw new Error("Project chooser failed.");
      }
    } as unknown as ProjectWorkflowBridge;
    let actions: ReturnType<typeof useProjectWorkflowActions> | undefined;

    function Harness() {
      actions = useProjectWorkflowActions({
        api: undefined,
        chapterBridge: undefined,
        projectWorkflowBridge: bridge,
        settingsBridge: undefined,
        storyBibleBridge: undefined,
        studioBridge: undefined,
        setChapterEditor: () => undefined,
        setProjectWorkflow: (next) => workflowStates.push(resolveState(next)),
        setSettings: () => undefined,
        setShellState: () => undefined,
        setStoryBible: () => undefined,
        setStoryBibleEditor: () => undefined,
        setStudio: () => undefined
      });
      return null;
    }

    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(<Harness />));

    await act(async () => {
      actions?.handleOpenProject();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(workflowStates.at(-1)).toEqual({
      ...currentWorkflow,
      feedback: { kind: "error", message: "Project chooser failed." }
    });
  });
});

function createWorkflow(): ProjectWorkflowProps {
  return {
    chapters: [],
    onOpenProject: () => undefined,
    onCreateProject: () => undefined,
    onCreateChapter: () => undefined,
    onSelectChapter: () => undefined
  };
}

function resolveState<T>(action: SetStateAction<T | undefined>): T | undefined {
  return typeof action === "function" ? undefined : (action as T | undefined);
}

function createChapterEditor(chapterId: string): ChapterEditorProps {
  return {
    chapter: {
      frontmatter: {
        schemaVersion: "1.0",
        id: chapterId,
        title: chapterId,
        order: 1,
        status: "draft",
        createdAt: "2026-07-19T00:00:00.000Z",
        updatedAt: "2026-07-19T00:00:00.000Z"
      },
      body: "body"
    },
    dirty: false,
    saveStatus: "Saved",
    versions: [],
    onBodyChange: () => undefined,
    onSave: () => undefined
  };
}
