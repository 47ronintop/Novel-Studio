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

  test("keeps the current chapter when the next-chapter reminder is canceled", async () => {
    const state = createState();
    const selectChapterAndLoad = vi.fn(async () => ({
      projectWorkflow: workflow("ch_02"),
      chapterEditor: chapterEditor("ch_02")
    }));
    const beforeNavigateToChapter = vi.fn(async () => false);
    const navigation = createWorkspaceNavigation({
      ...state.dependencies([]),
      beforeNavigateToChapter,
      projectWorkflowBridge: { selectChapterAndLoad }
    });

    await navigation.navigateToChapter("ch_02");

    expect(beforeNavigateToChapter).toHaveBeenCalledWith("ch_02");
    expect(selectChapterAndLoad).not.toHaveBeenCalled();
    expect(state.projectWorkflow?.activeChapterId).toBe("ch_old");
  });

  test("checks a dirty Story Bible draft before the next-chapter reminder", async () => {
    const state = createState();
    const canLeaveStoryBibleDraft = vi.fn(async () => false);
    const beforeNavigateToChapter = vi.fn(async () => true);
    const selectChapterAndLoad = vi.fn();
    const navigation = createWorkspaceNavigation({
      ...state.dependencies([]),
      canLeaveStoryBibleDraft,
      beforeNavigateToChapter,
      projectWorkflowBridge: { selectChapterAndLoad }
    });

    await navigation.navigateToChapter("ch_02");

    expect(canLeaveStoryBibleDraft).toHaveBeenCalledOnce();
    expect(beforeNavigateToChapter).not.toHaveBeenCalled();
    expect(selectChapterAndLoad).not.toHaveBeenCalled();
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
        beginCreate: () => nextStory,
        cancelDraft: () => nextStory,
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

  test("opens story analysis directly from the writing surface", () => {
    const log: string[] = [];
    const state = createState({ creativeNavigatorMode: "writing", activeActivity: "workspace" });
    const currentStory = storyEditor("world_note", "world");
    const selectKind = vi.fn(() => currentStory);
    const navigation = createWorkspaceNavigation({
      ...state.dependencies(log),
      openStoryAnalysisReview: () => log.push("story.analysis.open"),
      storyBibleBridge: {
        getEditorProps() {
          log.push("story.getEditorProps");
          return currentStory;
        },
        selectKind,
        selectEntry: () => currentStory,
        beginCreate: () => currentStory,
        cancelDraft: () => currentStory
      }
    });

    navigation.navigateToStoryAnalysis();

    expect(log).toEqual([
      "story.getEditorProps",
      "story.analysis.open",
      "state.navigator:story",
      "state.activity:storyBible"
    ]);
    expect(selectKind).not.toHaveBeenCalled();
    expect(state.storyBibleEditor).toBe(currentStory);
  });

  test("begins a typed story draft before committing the creative story surface", () => {
    const log: string[] = [];
    const state = createState({
      workbenchMode: "engineering",
      creativeNavigatorMode: "writing",
      activeActivity: "workspace"
    });
    const nextStory = { ...storyEditor("", "foreshadow"), viewMode: "detail" as const };
    const navigation = createWorkspaceNavigation({
      ...state.dependencies(log),
      storyBibleBridge: {
        selectKind: () => nextStory,
        selectEntry: () => nextStory,
        cancelDraft: () => nextStory,
        beginCreate(kind) {
          log.push(`story.beginCreate:${kind}`);
          return nextStory;
        }
      }
    });

    navigation.createStoryEntry("foreshadow");

    expect(log).toEqual([
      "story.beginCreate:foreshadow",
      "state.workbench:creative",
      "state.navigator:story",
      "state.activity:storyBible"
    ]);
    expect(state.storyBibleEditor).toBe(nextStory);
  });

  test("forwards the selected world asset type before committing the story surface", () => {
    const log: string[] = [];
    const state = createState();
    const nextStory = { ...storyEditor("", "world"), viewMode: "detail" as const };
    const navigation = createWorkspaceNavigation({
      ...state.dependencies(log),
      storyBibleBridge: {
        selectKind: () => nextStory,
        selectEntry: () => nextStory,
        cancelDraft: () => nextStory,
        beginCreate(kind, assetType) {
          log.push(`story.beginCreate:${kind}:${assetType ?? "none"}`);
          return nextStory;
        }
      }
    });

    navigation.createStoryEntry("world", "world.faction");

    expect(log[0]).toBe("story.beginCreate:world:world.faction");
    expect(state.storyBibleEditor).toBe(nextStory);
  });

  test("opens the timeline activity in list mode before committing its surface", () => {
    const log: string[] = [];
    const state = createState({
      workbenchMode: "engineering",
      creativeNavigatorMode: "writing",
      activeActivity: "search"
    });
    const timelineList = storyEditor("", "timeline");
    const navigation = createWorkspaceNavigation({
      ...state.dependencies(log),
      storyBibleBridge: {
        selectKind(kind) {
          log.push(`story.selectKind:${kind}`);
          return timelineList;
        },
        selectEntry: () => timelineList,
        beginCreate: () => timelineList,
        cancelDraft: () => timelineList
      }
    });

    navigation.navigateToTimeline();

    expect(log).toEqual([
      "story.selectKind:timeline",
      "state.workbench:creative",
      "state.navigator:story",
      "state.activity:timeline"
    ]);
    expect(state.storyBibleEditor).toBe(timelineList);
    expect(state.storyBibleEditor?.viewMode).toBe("list");
  });

  test("opens a timeline entry in detail without switching to the Story Bible activity", () => {
    const log: string[] = [];
    const state = createState({ creativeNavigatorMode: "story", activeActivity: "timeline" });
    const timelineDetail = storyEditor("timeline_main", "timeline");
    const navigation = createWorkspaceNavigation({
      ...state.dependencies(log),
      storyBibleBridge: {
        selectKind: () => timelineDetail,
        selectEntry(entryId) {
          log.push(`story.selectEntry:${entryId}`);
          return timelineDetail;
        },
        beginCreate: () => timelineDetail,
        cancelDraft: () => timelineDetail
      }
    });

    navigation.navigateToTimelineEntry("timeline_main");

    expect(log).toEqual(["story.selectEntry:timeline_main"]);
    expect(state.shellState.activeActivity).toBe("timeline");
    expect(state.storyBibleEditor).toBe(timelineDetail);
  });

  test("keeps the current story detail when its dirty guard cancels navigation", async () => {
    const state = createState({ creativeNavigatorMode: "story", activeActivity: "storyBible" });
    const previousEditor = state.storyBibleEditor;
    const selectKind = vi.fn(() => storyEditor("", "world"));
    const navigation = createWorkspaceNavigation({
      ...state.dependencies([]),
      canLeaveStoryBibleDraft: vi.fn(async () => false),
      storyBibleBridge: {
        selectKind,
        selectEntry: () => storyEditor("", "character"),
        beginCreate: () => storyEditor("", "character"),
        cancelDraft: () => storyEditor("", "character")
      }
    });

    navigation.navigateToStoryKind("world");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(selectKind).not.toHaveBeenCalled();
    expect(state.storyBibleEditor).toBe(previousEditor);
    expect(state.shellState.activeActivity).toBe("storyBible");
  });

  test("cancels a draft without changing the active Story Bible surface", () => {
    const state = createState({ creativeNavigatorMode: "story", activeActivity: "timeline" });
    const timelineList = storyEditor("", "timeline");
    const navigation = createWorkspaceNavigation({
      ...state.dependencies([]),
      storyBibleBridge: {
        selectKind: () => timelineList,
        selectEntry: () => timelineList,
        beginCreate: () => timelineList,
        cancelDraft: () => timelineList
      }
    });

    navigation.cancelStoryDraft();

    expect(state.storyBibleEditor).toBe(timelineList);
    expect(state.shellState.activeActivity).toBe("timeline");
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

  test("keeps the creative workbench unchanged when the dirty-file guard cancels an engineering switch", async () => {
    const state = createState({
      workbenchMode: "creative",
      creativeNavigatorMode: "writing",
      activeActivity: "workspace"
    });
    const previousShell = state.shellState;
    const previousFile = state.fileEditor;
    const canLeaveCreativeFile = vi.fn(async () => false);
    const navigation = createWorkspaceNavigation({
      ...state.dependencies([]),
      canLeaveCreativeFile
    });

    navigation.selectWorkbench("engineering");
    await Promise.resolve();

    expect(canLeaveCreativeFile).toHaveBeenCalledOnce();
    expect(state.shellState).toBe(previousShell);
    expect(state.fileEditor).toBe(previousFile);
  });

  test("keeps the engineering workbench unchanged when the dirty-file guard cancels a creative switch", async () => {
    const state = createState({
      workbenchMode: "engineering",
      creativeNavigatorMode: "writing",
      activeActivity: "workspace"
    });
    const previousShell = state.shellState;
    const canLeaveCreativeFile = vi.fn(async () => false);
    const navigation = createWorkspaceNavigation({
      ...state.dependencies([]),
      canLeaveCreativeFile
    });

    navigation.selectWorkbench("creative");
    await Promise.resolve();

    expect(canLeaveCreativeFile).toHaveBeenCalledOnce();
    expect(state.shellState).toBe(previousShell);
  });

  test("does not open an engineering file when the dirty-file guard is canceled", async () => {
    const state = createState({
      workbenchMode: "creative",
      creativeNavigatorMode: "writing",
      activeActivity: "workspace"
    });
    const previousShell = state.shellState;
    const previousFile = state.fileEditor;
    const previousChapter = state.chapterEditor;
    const canLeaveCreativeFile = vi.fn(async () => false);
    const openFile = vi.fn(async (path: string) => fileEditor(path));
    const navigation = createWorkspaceNavigation({
      ...state.dependencies([]),
      canLeaveCreativeFile,
      plainFileBridge: { openFile }
    });

    await navigation.navigateToFile("notes/target.md");

    expect(canLeaveCreativeFile).toHaveBeenCalledOnce();
    expect(openFile).not.toHaveBeenCalled();
    expect(state.shellState).toBe(previousShell);
    expect(state.fileEditor).toBe(previousFile);
    expect(state.chapterEditor).toBe(previousChapter);
  });

  test("does not open a creative file when the dirty-file guard is canceled", async () => {
    const state = createState({
      workbenchMode: "creative",
      creativeNavigatorMode: "story",
      activeActivity: "workspace"
    });
    const previousShell = state.shellState;
    const previousFile = state.fileEditor;
    const previousChapter = state.chapterEditor;
    const canLeaveCreativeFile = vi.fn(async () => false);
    const requestOpenFile = vi.fn(async () => true);
    const openFile = vi.fn(async (path: string) => fileEditor(path));
    const setCreativeFileEditor = vi.fn();
    const navigation = createWorkspaceNavigation({
      ...state.dependencies([]),
      canLeaveCreativeFile,
      creativeProjectFilesBridge: {
        requestOpenFile,
        clearActiveFile: vi.fn()
      },
      creativePlainFileBridge: {
        openFile,
        clear: vi.fn()
      },
      setCreativeFileEditor
    });

    await navigation.navigateToCreativeFile("notes/target.md");

    expect(canLeaveCreativeFile).toHaveBeenCalledOnce();
    expect(requestOpenFile).not.toHaveBeenCalled();
    expect(openFile).not.toHaveBeenCalled();
    expect(setCreativeFileEditor).not.toHaveBeenCalled();
    expect(state.shellState).toBe(previousShell);
    expect(state.fileEditor).toBe(previousFile);
    expect(state.chapterEditor).toBe(previousChapter);
  });

  test.each(["writing", "story"] as const)(
    "opens a creative file without changing the %s navigation mode",
    async (creativeNavigatorMode) => {
      const state = createState({
        workbenchMode: "creative",
        creativeNavigatorMode,
        activeActivity: "storyBible"
      });
      const setCreativeFileEditor = vi.fn();
      const navigation = createWorkspaceNavigation({
        ...state.dependencies([]),
        creativeProjectFilesBridge: {
          requestOpenFile: vi.fn(async () => true),
          clearActiveFile: vi.fn()
        },
        creativePlainFileBridge: {
          openFile: vi.fn(async (path: string) => fileEditor(path)),
          clear: vi.fn()
        },
        setCreativeFileEditor
      });

      await navigation.navigateToCreativeFile("notes/target.md");

      expect(setCreativeFileEditor).toHaveBeenCalledWith(
        expect.objectContaining({ path: "notes/target.md" })
      );
      expect(state.shellState).toMatchObject({
        workbenchMode: "creative",
        creativeNavigatorMode,
        activeActivity: "workspace"
      });
      expect(state.chapterEditor).toBeUndefined();
    }
  );

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

  test("opens the engineering directory picker from an unbound shell", () => {
    const state = createState({
      projectTitle: "未打开项目",
      workspaceContext: { kind: "none" },
      workbenchMode: "creative"
    });
    const openEngineeringWorkspace = vi.fn();
    const navigation = createWorkspaceNavigation({
      ...state.dependencies([]),
      openEngineeringWorkspace
    });

    navigation.selectWorkbench("engineering");

    expect(openEngineeringWorkspace).toHaveBeenCalledOnce();
    expect(state.shellState.workbenchMode).toBe("creative");
  });

  test("opens the supplied central review without changing the active activity", () => {
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

    expect(log).toEqual(["state.review:plan"]);
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
        conversationPanelMode: "docked",
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
    viewMode: id.length === 0 ? "list" : "detail",
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
    draft: storyDraft(id, kind),
    onKindSelect: () => undefined,
    onEntrySelect: () => undefined,
    onDraftChange: () => undefined,
    onFiltersChange: () => undefined,
    onNewDraft: () => undefined,
    onCancelDraft: () => undefined,
    onSave: () => undefined
  };
}

function storyDraft(
  id: string,
  kind: StoryBibleEditorProps["activeKind"]
): StoryBibleEditorProps["draft"] {
  const common = {
    ...(id.length === 0 ? {} : { id }),
    title: "",
    status: "draft" as const,
    summary: "",
    aliases: [],
    relatedEntityIds: []
  };
  switch (kind) {
    case "character":
      return { ...common, kind, assetType: "character", details: {} };
    case "world":
      return { ...common, kind, assetType: "world.location", details: {} };
    case "outline":
      return { ...common, kind, assetType: "outline", details: {} };
    case "foreshadow":
      return {
        ...common,
        kind,
        assetType: "foreshadow",
        details: { trackingStatus: "planned", origin: "manual" }
      };
    case "timeline":
      return { ...common, kind, assetType: "timeline.events", details: {} };
  }
}
