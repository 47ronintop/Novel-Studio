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
    onSave: () => undefined
  };
}
