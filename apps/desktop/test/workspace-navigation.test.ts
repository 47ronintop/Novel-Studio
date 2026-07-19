import { describe, expect, test, vi } from "vitest";

import type { DesktopShellState } from "@novel-studio/application";
import type {
  AgentConversationMainReview,
  ChapterEditorProps,
  PlainFileEditorProps,
  ProjectWorkflowProps,
  StoryBibleEditorProps
} from "@novel-studio/ui";

import { createWorkspaceNavigation } from "../src/renderer/workspace-navigation.js";

describe("workspace navigation", () => {
  test("commits a prepared chapter selection in the canonical navigation order", async () => {
    const log: string[] = [];
    const state = createState({
      workbenchMode: "engineering",
      creativeNavigatorMode: "story",
      activeActivity: "search"
    });
    const nextWorkflow = workflow("ch_01");
    const nextEditor = chapterEditor("ch_01");
    const navigation = createWorkspaceNavigation({
      ...state.dependencies(log),
      projectWorkflowBridge: {
        async selectChapterAndLoad(chapterId) {
          log.push(`project.selectChapterAndLoad:${chapterId}`);
          return { projectWorkflow: nextWorkflow, chapterEditor: nextEditor };
        }
      }
    });

    await navigation.navigateToChapter("ch_01");

    expect(log).toEqual([
      "project.selectChapterAndLoad:ch_01",
      "state.workbench:creative",
      "state.navigator:writing",
      "state.activity:workspace",
      "state.surface:editor"
    ]);
    expect(state.projectWorkflow).toBe(nextWorkflow);
    expect(state.chapterEditor).toBe(nextEditor);
    expect(state.fileEditor).toBeUndefined();
  });

  test("does not commit any renderer state when chapter preparation fails", async () => {
    const state = createState();
    const onNavigationFeedback = vi.fn();
    const previousShell = state.shellState;
    const previousWorkflow = state.projectWorkflow;
    const previousChapter = state.chapterEditor;
    const previousFile = state.fileEditor;
    const navigation = createWorkspaceNavigation({
      ...state.dependencies([]),
      onNavigationFeedback,
      projectWorkflowBridge: {
        async selectChapterAndLoad() {
          throw new Error("chapter load failed");
        }
      }
    });

    await expect(navigation.navigateToChapter("ch_missing")).resolves.toBeUndefined();

    expect(onNavigationFeedback).toHaveBeenCalledWith("chapter load failed");
    expect(state.shellState).toBe(previousShell);
    expect(state.projectWorkflow).toBe(previousWorkflow);
    expect(state.chapterEditor).toBe(previousChapter);
    expect(state.fileEditor).toBe(previousFile);
  });

  test("selects a story entry before committing the creative story surface", () => {
    const log: string[] = [];
    const state = createState({
      workbenchMode: "engineering",
      creativeNavigatorMode: "writing",
      activeActivity: "timeline"
    });
    const nextStory = storyEditor("timeline_main", "timeline");
    const navigation = createWorkspaceNavigation({
      ...state.dependencies(log),
      storyBibleBridge: {
        selectKind: () => nextStory,
        selectEntry(entryId) {
          log.push(`story.selectEntry:${entryId}`);
          return nextStory;
        }
      }
    });

    navigation.navigateToStoryEntry("timeline_main");

    expect(log).toEqual([
      "story.selectEntry:timeline_main",
      "state.workbench:creative",
      "state.navigator:story",
      "state.activity:storyBible"
    ]);
    expect(state.storyBibleEditor).toBe(nextStory);
  });

  test("keeps the engineering editor and shell unchanged when file preparation fails", async () => {
    const state = createState({
      workbenchMode: "engineering",
      creativeNavigatorMode: "writing",
      activeActivity: "workspace"
    });
    const previousShell = state.shellState;
    const previousFile = state.fileEditor;
    const previousChapter = state.chapterEditor;
    const onNavigationFeedback = vi.fn();
    const navigation = createWorkspaceNavigation({
      ...state.dependencies([]),
      onNavigationFeedback,
      plainFileBridge: {
        async openFile() {
          throw new Error("file open failed");
        }
      }
    });

    await expect(navigation.navigateToFile("notes/missing.md")).resolves.toBeUndefined();

    expect(onNavigationFeedback).toHaveBeenCalledWith("file open failed");
    expect(state.shellState).toBe(previousShell);
    expect(state.fileEditor).toBe(previousFile);
    expect(state.chapterEditor).toBe(previousChapter);
  });

  test("delegates workspace lifecycle intents and rejects creative mode in engineering context", () => {
    const state = createState({
      workspaceContext: {
        kind: "engineeringWorkspace",
        workspaceId: "workspace_engineering",
        displayName: "Engineering",
        capabilities: ["engineeringWorkbench", "generalFileContext"]
      },
      workbenchMode: "engineering"
    });
    const openCreativeProject = vi.fn();
    const openEngineeringWorkspace = vi.fn();
    const createCreativeProject = vi.fn();
    const onNavigationFeedback = vi.fn();
    const navigation = createWorkspaceNavigation({
      ...state.dependencies([]),
      openCreativeProject,
      openEngineeringWorkspace,
      createCreativeProject,
      onNavigationFeedback
    });

    navigation.openCreativeProject();
    navigation.openEngineeringWorkspace();
    navigation.createCreativeProject();
    navigation.selectWorkbench("creative");

    expect(openCreativeProject).toHaveBeenCalledOnce();
    expect(openEngineeringWorkspace).toHaveBeenCalledOnce();
    expect(createCreativeProject).toHaveBeenCalledOnce();
    expect(state.shellState.workbenchMode).toBe("engineering");
    expect(onNavigationFeedback).toHaveBeenCalledWith(
      "当前工程工作区不提供创作工作台。请先打开创作项目。"
    );
  });

  test("opens the supplied central review before selecting the Agent activity", () => {
    const log: string[] = [];
    const state = createState({ activeActivity: "workspace" });
    const review = { kind: "plan", props: {} } as AgentConversationMainReview;
    const navigation = createWorkspaceNavigation({
      ...state.dependencies(log),
      setMainReview(nextReview) {
        log.push(`state.review:${nextReview.kind}`);
        state.mainReview = nextReview;
      }
    });

    navigation.openMainReview(review);

    expect(log).toEqual(["state.review:plan", "state.activity:ai"]);
    expect(state.mainReview).toBe(review);
  });
});

function createState(overrides: Partial<DesktopShellState> = {}) {
  const state = {
    shellState: {
      projectTitle: "Project",
      activeActivity: "workspace",
      workspaceContext: {
        kind: "creativeProject",
        workspaceId: "project_1",
        projectId: "project_1",
        displayName: "Project",
        capabilities: ["creativeWorkbench", "writingContext"]
      },
      workbenchMode: "creative",
      creativeNavigatorMode: "writing",
      engineeringExpandedPathIds: [],
      navigatorCollapsed: false,
      inspectorCollapsed: false,
      bottomPanelVisible: true,
      activeBottomPanelTab: "problems",
      focusMode: false,
      workspaceLayout: {
        splitView: false,
        navigatorWidth: 280,
        inspectorWidth: 360,
        bottomPanelHeight: 220
      },
      commandPaletteOpen: false,
      saveStatus: "Saved",
      navigatorSections: [],
      bottomPanelTabs: ["problems"]
    } satisfies DesktopShellState,
    projectWorkflow: workflow("ch_old") as ProjectWorkflowProps | undefined,
    chapterEditor: chapterEditor("ch_old") as ChapterEditorProps | undefined,
    fileEditor: fileEditor("notes/current.md") as PlainFileEditorProps | undefined,
    storyBibleEditor: storyEditor("character_new", "character") as
      StoryBibleEditorProps | undefined,
    mainReview: undefined as AgentConversationMainReview | undefined,
    pendingSurface: undefined as "editor" | "file" | undefined,
    dependencies(log: string[]) {
      return {
        getWorkspaceContext: () => state.shellState.workspaceContext,
        setShellState(
          next: DesktopShellState | ((current: DesktopShellState) => DesktopShellState)
        ) {
          const previous = state.shellState;
          const resolved = typeof next === "function" ? next(previous) : next;
          if (resolved.workbenchMode !== previous.workbenchMode) {
            log.push(`state.workbench:${resolved.workbenchMode}`);
          }
          if (resolved.creativeNavigatorMode !== previous.creativeNavigatorMode) {
            log.push(`state.navigator:${resolved.creativeNavigatorMode}`);
          }
          if (resolved.activeActivity !== previous.activeActivity) {
            log.push(`state.activity:${resolved.activeActivity}`);
          }
          state.shellState = resolved;
          if (state.pendingSurface !== undefined) {
            log.push(`state.surface:${state.pendingSurface}`);
            state.pendingSurface = undefined;
          }
        },
        setProjectWorkflow(next: ProjectWorkflowProps | undefined) {
          state.projectWorkflow = next;
        },
        setChapterEditor(next: ChapterEditorProps | undefined) {
          state.chapterEditor = next;
          if (next !== undefined) state.pendingSurface = "editor";
        },
        setFileEditor(next: PlainFileEditorProps | undefined) {
          state.fileEditor = next;
          if (next !== undefined) state.pendingSurface = "file";
        },
        setStoryBibleEditor(next: StoryBibleEditorProps | undefined) {
          state.storyBibleEditor = next;
        },
        setMainReview(next: AgentConversationMainReview) {
          state.mainReview = next;
        },
        openCreativeProject: () => undefined,
        openEngineeringWorkspace: () => undefined,
        createCreativeProject: () => undefined
      };
    }
  };
  state.shellState = { ...state.shellState, ...overrides };
  return state;
}

function workflow(activeChapterId: string): ProjectWorkflowProps {
  return {
    projectId: "project_1",
    chapters: [],
    activeChapterId,
    openChapterTabIds: [activeChapterId],
    onOpenProject: () => undefined,
    onCreateProject: () => undefined,
    onCreateChapter: () => undefined,
    onSelectChapter: () => undefined
  };
}

function chapterEditor(chapterId: string): ChapterEditorProps {
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

function fileEditor(path: string): PlainFileEditorProps {
  return {
    path,
    fileName: path.split("/").at(-1) ?? path,
    content: "content",
    dirty: false,
    saveStatus: "Saved"
  };
}

function storyEditor(id: string, kind: StoryBibleEditorProps["activeKind"]): StoryBibleEditorProps {
  return {
    activeKind: kind,
    entries: [],
    draft: { id, kind, title: "", body: "", status: "draft" },
    saveStatus: "idle",
    onKindSelect: () => undefined,
    onEntrySelect: () => undefined,
    onDraftChange: () => undefined,
    onNewDraft: () => undefined,
    onSave: () => undefined
  };
}
