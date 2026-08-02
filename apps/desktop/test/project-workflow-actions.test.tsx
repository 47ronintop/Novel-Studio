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
import {
  guardDirtyChapterForForeshadowAnalysis,
  useProjectWorkflowActions
} from "../src/renderer/project-workflow-actions.js";
import type { ProjectWorkflowBridge } from "../src/renderer/project-workflow-bridge.js";
import type { StoryBibleBridge } from "../src/renderer/story-bible-bridge.js";

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
    vi.restoreAllMocks();
  });

  test("does not create a chapter when the maintenance reminder is canceled", async () => {
    const beforeCreateChapter = vi.fn(async () => false);
    const createChapter = vi.fn(async () => createWorkflow());
    let actions: ReturnType<typeof useProjectWorkflowActions> | undefined;

    function Harness() {
      actions = useProjectWorkflowActions({
        api: undefined,
        chapterBridge: undefined,
        projectWorkflowBridge: { createChapter } as unknown as ProjectWorkflowBridge,
        settingsBridge: undefined,
        storyBibleBridge: undefined,
        studioBridge: undefined,
        beforeCreateChapter,
        setChapterEditor: () => undefined,
        setProjectWorkflow: () => undefined,
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
      actions?.handleCreateChapter();
      await Promise.resolve();
    });

    expect(beforeCreateChapter).toHaveBeenCalledTimes(1);
    expect(createChapter).not.toHaveBeenCalled();
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

  test("does not start project transitions when the dirty-file guard is canceled", async () => {
    const currentWorkflow = {
      ...createWorkflow(),
      projectId: "project-a",
      status: "ready" as const
    };
    const getProps = vi.fn(() => currentWorkflow);
    const openProject = vi.fn(async () => currentWorkflow);
    const createProject = vi.fn(async () => currentWorkflow);
    const createExampleProject = vi.fn(async () => currentWorkflow);
    const beforeWorkspaceTransition = vi.fn(async () => false);
    const workflowStates: Array<ProjectWorkflowProps | undefined> = [];
    const bridge = {
      getProps,
      openProject,
      createProject,
      createExampleProject
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
        beforeWorkspaceTransition,
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
      actions?.handleCreateProject();
      actions?.handleCreateExampleProject();
      await Promise.resolve();
    });

    expect(beforeWorkspaceTransition).toHaveBeenCalledTimes(3);
    expect(getProps).not.toHaveBeenCalled();
    expect(openProject).not.toHaveBeenCalled();
    expect(createProject).not.toHaveBeenCalled();
    expect(createExampleProject).not.toHaveBeenCalled();
    expect(workflowStates).toEqual([]);
  });

  test("saves a dirty Story Bible after the file guard before opening a project", async () => {
    const currentWorkflow = {
      ...createWorkflow(),
      projectId: "project-a",
      status: "ready" as const
    };
    const saving = { ...createStoryBibleEditor("Saving"), dirty: true, status: "saving" as const };
    const saved = { ...createStoryBibleEditor("Saved"), dirty: false };
    let currentEditor: StoryBibleEditorProps = {
      ...createStoryBibleEditor("Unsaved"),
      dirty: true
    };
    const beforeWorkspaceTransition = vi.fn(async () => true);
    const openProject = vi.fn(async () => currentWorkflow);
    const storyBibleBridge = {
      getEditorProps: vi.fn(() => currentEditor),
      beginSave: vi.fn(() => saving),
      saveDraft: vi.fn(async () => {
        currentEditor = saved;
        return saved;
      }),
      getProps: vi.fn(() => ({ assets: [] })),
      clear: vi.fn(),
      load: vi.fn(async () => ({ assets: [] }))
    } as unknown as StoryBibleBridge;
    const bridge = {
      getProps: vi.fn(() => currentWorkflow),
      openProject
    } as unknown as ProjectWorkflowBridge;
    let actions: ReturnType<typeof useProjectWorkflowActions> | undefined;
    vi.spyOn(window, "confirm").mockReturnValue(true);

    function Harness() {
      actions = useProjectWorkflowActions({
        api: undefined,
        chapterBridge: undefined,
        projectWorkflowBridge: bridge,
        settingsBridge: undefined,
        storyBibleBridge,
        studioBridge: undefined,
        beforeWorkspaceTransition,
        setChapterEditor: () => undefined,
        setProjectWorkflow: () => undefined,
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

    expect(beforeWorkspaceTransition).toHaveBeenCalledOnce();
    expect(storyBibleBridge.saveDraft).toHaveBeenCalledOnce();
    expect(openProject).toHaveBeenCalledOnce();
    expect(beforeWorkspaceTransition.mock.invocationCallOrder[0]).toBeLessThan(
      storyBibleBridge.saveDraft.mock.invocationCallOrder[0]
    );
    expect(storyBibleBridge.saveDraft.mock.invocationCallOrder[0]).toBeLessThan(
      openProject.mock.invocationCallOrder[0]
    );
  });

  test("allows a project transition after explicitly discarding a dirty Story Bible draft", async () => {
    const currentWorkflow = {
      ...createWorkflow(),
      projectId: "project-a",
      status: "ready" as const
    };
    const discarded = createStoryBibleEditor("Discarded");
    const openProject = vi.fn(async () => currentWorkflow);
    const storyBibleBridge = {
      getEditorProps: vi.fn(() => ({ ...createStoryBibleEditor("Unsaved"), dirty: true })),
      cancelDraft: vi.fn(() => discarded),
      getProps: vi.fn(() => ({ assets: [] })),
      clear: vi.fn(),
      load: vi.fn(async () => ({ assets: [] }))
    } as unknown as StoryBibleBridge;
    const bridge = {
      getProps: vi.fn(() => currentWorkflow),
      openProject
    } as unknown as ProjectWorkflowBridge;
    let actions: ReturnType<typeof useProjectWorkflowActions> | undefined;
    vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);

    function Harness() {
      actions = useProjectWorkflowActions({
        api: undefined,
        chapterBridge: undefined,
        projectWorkflowBridge: bridge,
        settingsBridge: undefined,
        storyBibleBridge,
        studioBridge: undefined,
        setChapterEditor: () => undefined,
        setProjectWorkflow: () => undefined,
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

    expect(storyBibleBridge.cancelDraft).toHaveBeenCalledOnce();
    expect(openProject).toHaveBeenCalledOnce();
  });

  test("does not switch projects when the Story Bible bridge refuses to discard a dirty draft", async () => {
    const currentWorkflow = {
      ...createWorkflow(),
      projectId: "project-a",
      status: "ready" as const
    };
    const retained = { ...createStoryBibleEditor("Unsaved"), dirty: true };
    const openProject = vi.fn(async () => currentWorkflow);
    const storyBibleBridge = {
      getEditorProps: vi.fn(() => retained),
      cancelDraft: vi.fn(() => retained),
      getProps: vi.fn(() => ({ assets: [] })),
      clear: vi.fn(),
      load: vi.fn(async () => ({ assets: [] }))
    } as unknown as StoryBibleBridge;
    const bridge = {
      getProps: vi.fn(() => currentWorkflow),
      openProject
    } as unknown as ProjectWorkflowBridge;
    let actions: ReturnType<typeof useProjectWorkflowActions> | undefined;
    vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);

    function Harness() {
      actions = useProjectWorkflowActions({
        api: undefined,
        chapterBridge: undefined,
        projectWorkflowBridge: bridge,
        settingsBridge: undefined,
        storyBibleBridge,
        studioBridge: undefined,
        setChapterEditor: () => undefined,
        setProjectWorkflow: () => undefined,
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

    expect(storyBibleBridge.cancelDraft).toHaveBeenCalledOnce();
    expect(openProject).not.toHaveBeenCalled();
    expect(storyBibleBridge.clear).not.toHaveBeenCalled();
  });

  test("does not start a project transition or clear the draft when Story Bible saving fails", async () => {
    const currentWorkflow = {
      ...createWorkflow(),
      projectId: "project-a",
      status: "ready" as const
    };
    const saving = { ...createStoryBibleEditor("Saving"), dirty: true, status: "saving" as const };
    const failed = { ...createStoryBibleEditor("Unsaved"), dirty: true, status: "error" as const };
    let currentEditor: StoryBibleEditorProps = {
      ...createStoryBibleEditor("Unsaved"),
      dirty: true
    };
    const openProject = vi.fn(async () => currentWorkflow);
    const storyBibleBridge = {
      getEditorProps: vi.fn(() => currentEditor),
      beginSave: vi.fn(() => saving),
      saveDraft: vi.fn(async () => {
        currentEditor = failed;
        return failed;
      }),
      getProps: vi.fn(() => ({ assets: [] })),
      clear: vi.fn()
    } as unknown as StoryBibleBridge;
    const bridge = {
      getProps: vi.fn(() => currentWorkflow),
      openProject
    } as unknown as ProjectWorkflowBridge;
    let actions: ReturnType<typeof useProjectWorkflowActions> | undefined;
    vi.spyOn(window, "confirm").mockReturnValue(true);

    function Harness() {
      actions = useProjectWorkflowActions({
        api: undefined,
        chapterBridge: undefined,
        projectWorkflowBridge: bridge,
        settingsBridge: undefined,
        storyBibleBridge,
        studioBridge: undefined,
        setChapterEditor: () => undefined,
        setProjectWorkflow: () => undefined,
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

    expect(bridge.getProps).not.toHaveBeenCalled();
    expect(openProject).not.toHaveBeenCalled();
    expect(storyBibleBridge.clear).not.toHaveBeenCalled();
    expect(storyBibleBridge.getEditorProps()).toBe(failed);
  });

  test("does not start any project transition when a dirty Story Bible draft is kept", async () => {
    const currentWorkflow = {
      ...createWorkflow(),
      projectId: "project-a",
      status: "ready" as const
    };
    const openProject = vi.fn(async () => currentWorkflow);
    const createProject = vi.fn(async () => currentWorkflow);
    const createExampleProject = vi.fn(async () => currentWorkflow);
    const storyBibleBridge = {
      getEditorProps: vi.fn(() => ({ ...createStoryBibleEditor("Unsaved"), dirty: true })),
      getProps: vi.fn(() => ({ assets: [] })),
      clear: vi.fn()
    } as unknown as StoryBibleBridge;
    const bridge = {
      getProps: vi.fn(() => currentWorkflow),
      openProject,
      createProject,
      createExampleProject
    } as unknown as ProjectWorkflowBridge;
    let actions: ReturnType<typeof useProjectWorkflowActions> | undefined;
    vi.spyOn(window, "confirm").mockReturnValue(false);

    function Harness() {
      actions = useProjectWorkflowActions({
        api: undefined,
        chapterBridge: undefined,
        projectWorkflowBridge: bridge,
        settingsBridge: undefined,
        storyBibleBridge,
        studioBridge: undefined,
        setChapterEditor: () => undefined,
        setProjectWorkflow: () => undefined,
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
      actions?.handleCreateProject();
      actions?.handleCreateExampleProject();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(bridge.getProps).not.toHaveBeenCalled();
    expect(openProject).not.toHaveBeenCalled();
    expect(createProject).not.toHaveBeenCalled();
    expect(createExampleProject).not.toHaveBeenCalled();
    expect(storyBibleBridge.clear).not.toHaveBeenCalled();
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

  test("publishes Story Bible draft, filter, and save state through the bridge", async () => {
    const draftEditor = createStoryBibleEditor("draft");
    const filteredEditor = createStoryBibleEditor("filtered");
    const savingEditor = createStoryBibleEditor("saving");
    const savedEditor = createStoryBibleEditor("saved");
    const summary: StoryBibleSummaryProps = { assets: [] };
    let resolveSave: ((editor: StoryBibleEditorProps) => void) | undefined;
    const saved = new Promise<StoryBibleEditorProps>((resolve) => {
      resolveSave = resolve;
    });
    const storyBibleBridge = {
      updateDraft: vi.fn(() => draftEditor),
      updateFilters: vi.fn(() => filteredEditor),
      beginSave: vi.fn(() => savingEditor),
      saveDraft: vi.fn(() => saved),
      getProps: vi.fn(() => summary)
    } as unknown as StoryBibleBridge;
    const editorStates: Array<StoryBibleEditorProps | undefined> = [];
    const summaryStates: Array<StoryBibleSummaryProps | undefined> = [];
    let actions: ReturnType<typeof useProjectWorkflowActions> | undefined;

    function Harness() {
      actions = useProjectWorkflowActions({
        api: undefined,
        chapterBridge: undefined,
        projectWorkflowBridge: undefined,
        settingsBridge: undefined,
        storyBibleBridge,
        studioBridge: undefined,
        setChapterEditor: () => undefined,
        setProjectWorkflow: () => undefined,
        setSettings: () => undefined,
        setShellState: () => undefined,
        setStoryBible: (next) => summaryStates.push(resolveState(next)),
        setStoryBibleEditor: (next) => editorStates.push(resolveState(next)),
        setStudio: () => undefined
      });
      return null;
    }

    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(<Harness />));

    act(() => {
      actions?.handleStoryBibleDraftChange("character", { title: "Revised" });
      actions?.handleStoryBibleFiltersChange({ query: "hero" });
      actions?.handleSaveStoryBibleDraft(["ch_01"]);
    });
    expect(editorStates).toEqual([draftEditor, filteredEditor, savingEditor]);

    await act(async () => {
      resolveSave?.(savedEditor);
      await saved;
    });

    expect(storyBibleBridge.updateDraft).toHaveBeenCalledWith("character", {
      title: "Revised"
    });
    expect(storyBibleBridge.updateFilters).toHaveBeenCalledWith({ query: "hero" });
    expect(storyBibleBridge.saveDraft).toHaveBeenCalledWith({ chapterIds: ["ch_01"] });
    expect(editorStates).toEqual([draftEditor, filteredEditor, savingEditor, savedEditor]);
    expect(summaryStates).toEqual([summary]);
  });

  test("guards only a selected dirty current chapter before foreshadow analysis", async () => {
    const dirtyChapter = { ...createChapterEditor("ch_01"), dirty: true as const };
    const saveCurrentChapter = vi.fn(async () => true);
    const confirmSave = vi.fn(() => false);

    await expect(
      guardDirtyChapterForForeshadowAnalysis(
        ["ch_02"],
        dirtyChapter,
        saveCurrentChapter,
        confirmSave
      )
    ).resolves.toBe("ready");
    expect(confirmSave).not.toHaveBeenCalled();
    expect(saveCurrentChapter).not.toHaveBeenCalled();

    await expect(
      guardDirtyChapterForForeshadowAnalysis(
        ["ch_01"],
        dirtyChapter,
        saveCurrentChapter,
        confirmSave
      )
    ).resolves.toBe("cancelled");
    expect(confirmSave).toHaveBeenCalledTimes(1);
    expect(saveCurrentChapter).not.toHaveBeenCalled();

    confirmSave.mockReturnValue(true);
    await expect(
      guardDirtyChapterForForeshadowAnalysis(
        ["ch_01"],
        dirtyChapter,
        saveCurrentChapter,
        confirmSave
      )
    ).resolves.toBe("ready");
    expect(saveCurrentChapter).toHaveBeenCalledTimes(1);

    saveCurrentChapter.mockResolvedValueOnce(false);
    await expect(
      guardDirtyChapterForForeshadowAnalysis(
        ["ch_01"],
        dirtyChapter,
        saveCurrentChapter,
        confirmSave
      )
    ).resolves.toBe("save-failed");

    saveCurrentChapter.mockRejectedValueOnce(new Error("disk full"));
    await expect(
      guardDirtyChapterForForeshadowAnalysis(
        ["ch_01"],
        dirtyChapter,
        saveCurrentChapter,
        confirmSave
      )
    ).resolves.toBe("save-failed");
  });

  test("saves a selected dirty chapter before starting read-only foreshadow analysis", async () => {
    const events: string[] = [];
    const selectingEditor: StoryBibleEditorProps = {
      ...createStoryBibleEditor("selecting"),
      activeKind: "foreshadow",
      foreshadowAnalysis: { status: "selecting", selectedChapterIds: ["ch_01"] }
    };
    const preparingEditor: StoryBibleEditorProps = {
      ...selectingEditor,
      foreshadowAnalysis: { status: "preparing", selectedChapterIds: ["ch_01"] }
    };
    const scanningEditor: StoryBibleEditorProps = {
      ...selectingEditor,
      foreshadowAnalysis: { status: "scanning", selectedChapterIds: ["ch_01"] }
    };
    const reviewedEditor: StoryBibleEditorProps = {
      ...selectingEditor,
      foreshadowAnalysis: {
        status: "review",
        selectedChapterIds: ["ch_01"],
        result: {
          analysisId: "analysis-01",
          chapterIds: ["ch_01"],
          candidates: [],
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            usageStatus: "missing",
            cost: { amount: 0, currency: "USD", status: "unknown" }
          },
          createdAt: "2026-07-30T00:00:00.000Z"
        },
        review: { step: "candidates", selectedCandidateIds: [] }
      }
    };
    const storyBibleBridge = {
      prepareForeshadowAnalysis: vi.fn(() => ({ editor: preparingEditor, token: 1 })),
      cancelForeshadowAnalysisPreparation: vi.fn(() => ({
        editor: selectingEditor,
        applied: true
      })),
      failForeshadowAnalysisPreparation: vi.fn(() => ({
        editor: selectingEditor,
        applied: true
      })),
      beginForeshadowAnalysis: vi.fn(() => {
        events.push("begin-analysis");
        return { editor: scanningEditor, started: true };
      }),
      detectForeshadows: vi.fn(async () => {
        events.push("detect");
        return { editor: reviewedEditor, applied: true };
      })
    } as unknown as StoryBibleBridge;
    const saveCurrentChapter = vi.fn(async () => {
      events.push("save-chapter");
      return true;
    });
    const editorStates: Array<StoryBibleEditorProps | undefined> = [];
    let actions: ReturnType<typeof useProjectWorkflowActions> | undefined;

    function Harness() {
      actions = useProjectWorkflowActions({
        api: undefined,
        chapterBridge: undefined,
        chapterEditor: { ...createChapterEditor("ch_01"), dirty: true },
        saveCurrentChapter,
        confirmForeshadowAnalysisSave: () => true,
        projectWorkflowBridge: undefined,
        settingsBridge: undefined,
        storyBibleBridge,
        studioBridge: undefined,
        setChapterEditor: () => undefined,
        setProjectWorkflow: () => undefined,
        setSettings: () => undefined,
        setShellState: () => undefined,
        setStoryBible: () => undefined,
        setStoryBibleEditor: (next) => editorStates.push(resolveState(next)),
        setStudio: () => undefined
      });
      return null;
    }

    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(<Harness />));

    await act(async () => {
      await actions?.handleDetectForeshadows();
    });

    expect(events).toEqual(["save-chapter", "begin-analysis", "detect"]);
    expect(editorStates).toEqual([preparingEditor, scanningEditor, reviewedEditor]);
  });

  test("reports a selected dirty chapter save failure without starting analysis", async () => {
    const preparingEditor: StoryBibleEditorProps = {
      ...createStoryBibleEditor("preparing"),
      activeKind: "foreshadow",
      foreshadowAnalysis: { status: "preparing", selectedChapterIds: ["ch_01"] }
    };
    const failedEditor: StoryBibleEditorProps = {
      ...preparingEditor,
      foreshadowAnalysis: {
        status: "error",
        selectedChapterIds: ["ch_01"],
        message: "当前章节保存失败，未开始识别。"
      }
    };
    const beginForeshadowAnalysis = vi.fn();
    const detectForeshadows = vi.fn();
    const failForeshadowAnalysisPreparation = vi.fn(() => ({
      editor: failedEditor,
      applied: true
    }));
    const storyBibleBridge = {
      prepareForeshadowAnalysis: vi.fn(() => ({ editor: preparingEditor, token: 7 })),
      cancelForeshadowAnalysisPreparation: vi.fn(),
      failForeshadowAnalysisPreparation,
      beginForeshadowAnalysis,
      detectForeshadows
    } as unknown as StoryBibleBridge;
    const editorStates: Array<StoryBibleEditorProps | undefined> = [];
    let actions: ReturnType<typeof useProjectWorkflowActions> | undefined;

    function Harness() {
      actions = useProjectWorkflowActions({
        api: undefined,
        chapterBridge: undefined,
        chapterEditor: { ...createChapterEditor("ch_01"), dirty: true },
        saveCurrentChapter: async () => false,
        confirmForeshadowAnalysisSave: () => true,
        projectWorkflowBridge: undefined,
        settingsBridge: undefined,
        storyBibleBridge,
        studioBridge: undefined,
        setChapterEditor: () => undefined,
        setProjectWorkflow: () => undefined,
        setSettings: () => undefined,
        setShellState: () => undefined,
        setStoryBible: () => undefined,
        setStoryBibleEditor: (next) => editorStates.push(resolveState(next)),
        setStudio: () => undefined
      });
      return null;
    }

    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(<Harness />));

    await act(async () => {
      await actions?.handleDetectForeshadows();
    });

    expect(failForeshadowAnalysisPreparation).toHaveBeenCalledWith(
      7,
      "当前章节保存失败，未开始识别。"
    );
    expect(beginForeshadowAnalysis).not.toHaveBeenCalled();
    expect(detectForeshadows).not.toHaveBeenCalled();
    expect(editorStates).toEqual([preparingEditor, failedEditor]);
  });

  test("does not write back an analysis result rejected by a stale token", async () => {
    const preparingEditor = createStoryBibleEditor("preparing");
    const scanningEditor = createStoryBibleEditor("scanning");
    const clearedEditor = createStoryBibleEditor("idle");
    const storyBibleBridge = {
      prepareForeshadowAnalysis: vi.fn(() => ({ editor: preparingEditor, token: 9 })),
      beginForeshadowAnalysis: vi.fn(() => ({ editor: scanningEditor, started: true })),
      detectForeshadows: vi.fn(async () => ({ editor: clearedEditor, applied: false }))
    } as unknown as StoryBibleBridge;
    const editorStates: Array<StoryBibleEditorProps | undefined> = [];
    let actions: ReturnType<typeof useProjectWorkflowActions> | undefined;

    function Harness() {
      actions = useProjectWorkflowActions({
        api: undefined,
        chapterBridge: undefined,
        projectWorkflowBridge: undefined,
        settingsBridge: undefined,
        storyBibleBridge,
        studioBridge: undefined,
        setChapterEditor: () => undefined,
        setProjectWorkflow: () => undefined,
        setSettings: () => undefined,
        setShellState: () => undefined,
        setStoryBible: () => undefined,
        setStoryBibleEditor: (next) => editorStates.push(resolveState(next)),
        setStudio: () => undefined
      });
      return null;
    }

    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(<Harness />));

    await act(async () => {
      await actions?.handleDetectForeshadows();
    });

    expect(editorStates).toEqual([preparingEditor, scanningEditor]);
  });

  test("confirmation updates only Story Bible projections", async () => {
    const result = {
      analysisId: "analysis-confirm",
      chapterIds: ["ch_01"],
      candidates: [],
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        usageStatus: "missing" as const,
        cost: { amount: 0, currency: "USD", status: "unknown" as const }
      },
      createdAt: "2026-07-30T00:00:00.000Z"
    };
    const change = {
      changeId: "new:candidate-new",
      operation: "create" as const,
      assetId: "fsh_new",
      title: "窗台徽章",
      sourceCandidateIds: ["candidate-new"],
      fields: [{ field: "title" as const, after: "窗台徽章" }],
      evidenceAdditions: [],
      status: "applying" as const
    };
    const applyingEditor: StoryBibleEditorProps = {
      ...createStoryBibleEditor("applying"),
      activeKind: "foreshadow",
      foreshadowAnalysis: {
        status: "review",
        selectedChapterIds: ["ch_01"],
        result,
        review: {
          step: "applying",
          selectedCandidateIds: ["candidate-new"],
          changes: [change]
        }
      }
    };
    const completedEditor: StoryBibleEditorProps = {
      ...applyingEditor,
      foreshadowAnalysis: {
        status: "review",
        selectedChapterIds: ["ch_01"],
        result,
        review: {
          step: "results",
          selectedCandidateIds: ["candidate-new"],
          changes: [{ ...change, status: "succeeded" }],
          outcome: "completed"
        }
      }
    };
    const summary: StoryBibleSummaryProps = { assets: [] };
    const storyBibleBridge = {
      beginForeshadowAnalysisSave: vi.fn(() => ({
        editor: applyingEditor,
        started: true,
        token: 12
      })),
      saveForeshadowAnalysisChanges: vi.fn(async () => ({
        editor: completedEditor,
        applied: true
      })),
      getEditorProps: () => applyingEditor,
      getProps: () => summary
    } as unknown as StoryBibleBridge;
    const editorStates: Array<StoryBibleEditorProps | undefined> = [];
    const summaryStates: Array<StoryBibleSummaryProps | undefined> = [];
    const setChapterEditor = vi.fn();
    const setProjectWorkflow = vi.fn();
    const setSettings = vi.fn();
    const setShellState = vi.fn();
    const setStudio = vi.fn();
    let actions: ReturnType<typeof useProjectWorkflowActions> | undefined;

    function Harness() {
      actions = useProjectWorkflowActions({
        api: undefined,
        chapterBridge: undefined,
        projectWorkflowBridge: undefined,
        settingsBridge: undefined,
        storyBibleBridge,
        studioBridge: undefined,
        setChapterEditor,
        setProjectWorkflow,
        setSettings,
        setShellState,
        setStoryBible: (next) => summaryStates.push(resolveState(next)),
        setStoryBibleEditor: (next) => editorStates.push(resolveState(next)),
        setStudio
      });
      return null;
    }

    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(<Harness />));

    await act(async () => {
      actions?.handleConfirmForeshadowAnalysisChanges();
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
    });

    expect(editorStates).toEqual([applyingEditor, completedEditor]);
    expect(summaryStates).toEqual([summary]);
    expect(setChapterEditor).not.toHaveBeenCalled();
    expect(setProjectWorkflow).not.toHaveBeenCalled();
    expect(setSettings).not.toHaveBeenCalled();
    expect(setShellState).not.toHaveBeenCalled();
    expect(setStudio).not.toHaveBeenCalled();
    await expect(actions?.guardStoryBibleDraft()).resolves.toBe(false);
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

function createStoryBibleEditor(title: string): StoryBibleEditorProps {
  return {
    activeKind: "character",
    viewMode: "detail",
    status: "idle",
    dirty: false,
    entries: [],
    chapterOptions: [],
    foreshadowAnalysis: { status: "closed", selectedChapterIds: [] },
    filters: {
      query: "",
      status: "all",
      worldAssetType: "all",
      foreshadowTrackingStatus: "all"
    },
    externalUpdate: { status: "none" },
    draft: {
      kind: "character",
      assetType: "character",
      title,
      status: "active",
      summary: "",
      aliases: [],
      relatedEntityIds: [],
      details: {}
    },
    onKindSelect: () => undefined,
    onEntrySelect: () => undefined,
    onDraftChange: () => undefined,
    onFiltersChange: () => undefined,
    onNewDraft: () => undefined,
    onCancelDraft: () => undefined,
    onSave: () => undefined,
    onForeshadowAnalysisOpen: () => undefined,
    onForeshadowAnalysisChapterToggle: () => undefined,
    onForeshadowAnalysisStart: () => undefined,
    onForeshadowAnalysisCandidateToggle: () => undefined,
    onForeshadowAnalysisPreview: () => undefined,
    onForeshadowAnalysisBack: () => undefined,
    onForeshadowAnalysisConfirm: () => undefined,
    onForeshadowAnalysisRetryFailed: () => undefined,
    onForeshadowAnalysisClose: () => undefined
  };
}
