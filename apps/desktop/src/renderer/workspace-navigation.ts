import type {
  ActivityId,
  DesktopShellState,
  EngineeringWorkspaceSnapshot
} from "@novel-studio/application";
import type { WorkbenchMode, WorkspaceContextDto } from "@novel-studio/shared";
import type {
  AgentConversationMainReview,
  ChapterEditorProps,
  PlainFileEditorProps,
  ProjectWorkflowProps,
  StoryBibleEditorKind,
  StoryBibleEditorProps,
  StoryBibleWorldAssetType
} from "@novel-studio/ui";

import type { PlainFileEditorBridge } from "./plain-file-editor-bridge.js";
import type { CreativeProjectFilesBridge } from "./creative-project-files-bridge.js";
import type { EngineeringWorkspaceBridge } from "./engineering-workspace-bridge.js";
import type { ChapterEditorBridge } from "./chapter-editor-bridge.js";
import type { ProjectWorkflowBridge } from "./project-workflow-bridge.js";
import type { StoryBibleBridge } from "./story-bible-bridge.js";

type StateSetter<T> = (next: T | ((current: T) => T)) => void;

export interface WorkspaceNavigation {
  selectWorkbench(mode: WorkbenchMode): void;
  openCreativeProject(): void;
  openEngineeringWorkspace(): void;
  createCreativeProject(): void;
  navigateToChapter(chapterId: string): Promise<void>;
  navigateToStoryKind(kind: StoryBibleEditorKind): void;
  navigateToStoryAnalysis(): void;
  navigateToStoryEntry(entryId: string): void;
  createStoryEntry(kind: StoryBibleEditorKind, assetType?: StoryBibleWorldAssetType): void;
  navigateToTimeline(): void;
  navigateToTimelineEntry(entryId: string): void;
  cancelStoryDraft(): void;
  cancelStoryExplicitInversePreview(): Promise<void>;
  navigateToFile(path: string): Promise<void>;
  navigateToCreativeFile(path: string): Promise<void>;
  openMainReview(review: AgentConversationMainReview): void;
}

export interface WorkspaceNavigationDependencies {
  readonly getWorkspaceContext: () => WorkspaceContextDto;
  readonly projectWorkflowBridge?: Pick<ProjectWorkflowBridge, "selectChapterAndLoad"> | undefined;
  readonly chapterEditorBridge?: Pick<ChapterEditorBridge, "adopt"> | undefined;
  readonly storyBibleBridge?:
    | (Pick<StoryBibleBridge, "selectKind" | "selectEntry" | "beginCreate" | "cancelDraft"> &
        Partial<
          Pick<
            StoryBibleBridge,
            "selectEntryForEditing" | "getEditorProps" | "cancelExplicitInversePreview"
          >
        >)
    | undefined;
  readonly plainFileBridge?: Pick<PlainFileEditorBridge, "openFile"> | undefined;
  readonly creativePlainFileBridge?: Pick<PlainFileEditorBridge, "openFile" | "clear"> | undefined;
  readonly creativeProjectFilesBridge?:
    Pick<CreativeProjectFilesBridge, "requestOpenFile" | "clearActiveFile"> | undefined;
  readonly canLeaveCreativeFile?: (() => Promise<boolean>) | undefined;
  readonly canLeaveStoryBibleDraft?: (() => Promise<boolean>) | undefined;
  readonly beforeNavigateToChapter?: ((chapterId: string) => Promise<boolean>) | undefined;
  readonly openStoryAnalysisReview?: (() => void) | undefined;
  readonly setShellState: StateSetter<DesktopShellState>;
  readonly setProjectWorkflow: (next: ProjectWorkflowProps | undefined) => void;
  readonly setChapterEditor: (next: ChapterEditorProps | undefined) => void;
  readonly setFileEditor: (next: PlainFileEditorProps | undefined) => void;
  readonly setCreativeFileEditor?: ((next: PlainFileEditorProps | undefined) => void) | undefined;
  readonly setStoryBibleEditor: (next: StoryBibleEditorProps | undefined) => void;
  readonly setMainReview: (review: AgentConversationMainReview) => void;
  readonly engineeringWorkspaceBridge?:
    Pick<EngineeringWorkspaceBridge, "attachCreativeProject"> | undefined;
  readonly setEngineeringWorkspace?:
    ((workspace: EngineeringWorkspaceSnapshot) => void) | undefined;
  readonly openCreativeProject: () => void;
  readonly openEngineeringWorkspace: () => void;
  readonly createCreativeProject: () => void;
  readonly onNavigationFeedback?: ((message: string) => void) | undefined;
}

export function createWorkspaceNavigation(
  dependencies: WorkspaceNavigationDependencies
): WorkspaceNavigation {
  return {
    selectWorkbench(mode) {
      if (dependencies.canLeaveCreativeFile !== undefined) {
        void dependencies.canLeaveCreativeFile().then((allowed) => {
          if (allowed) {
            if (mode === "engineering") clearCreativeFile();
            selectWorkbench(mode);
          }
        });
        return;
      }
      selectWorkbench(mode);
    },
    openCreativeProject: dependencies.openCreativeProject,
    openEngineeringWorkspace: dependencies.openEngineeringWorkspace,
    createCreativeProject: dependencies.createCreativeProject,
    async navigateToChapter(chapterId) {
      if (!(await canLeaveCreativeFile())) return;
      if ((await dependencies.canLeaveStoryBibleDraft?.()) === false) return;
      if ((await dependencies.beforeNavigateToChapter?.(chapterId)) === false) return;
      const bridge = dependencies.projectWorkflowBridge;
      if (bridge === undefined) return;

      try {
        const next = await bridge.selectChapterAndLoad(chapterId);
        dependencies.setProjectWorkflow(next.projectWorkflow);
        dependencies.setChapterEditor(
          dependencies.chapterEditorBridge?.adopt(next.chapterEditor) ?? next.chapterEditor
        );
        clearCreativeFile();
        dependencies.setFileEditor(undefined);
        commitCreativeSurface(dependencies.setShellState, "writing", "workspace");
      } catch (error) {
        dependencies.onNavigationFeedback?.(toErrorMessage(error));
      }
    },
    navigateToStoryKind(kind) {
      navigateToStory(() => {
        const bridge = dependencies.storyBibleBridge;
        if (bridge === undefined) return;
        dependencies.setStoryBibleEditor(bridge.selectKind(kind));
      });
    },
    navigateToStoryAnalysis() {
      navigateToStory(() => {
        const bridge = dependencies.storyBibleBridge;
        if (bridge === undefined || dependencies.openStoryAnalysisReview === undefined) return;
        dependencies.setStoryBibleEditor(
          bridge.getEditorProps?.() ?? bridge.selectKind("character")
        );
        dependencies.openStoryAnalysisReview();
      });
    },
    navigateToStoryEntry(entryId) {
      navigateToStory(() => {
        const bridge = dependencies.storyBibleBridge;
        if (bridge === undefined) return;
        openStoryBibleEntry(bridge, entryId);
      });
    },
    createStoryEntry(kind, assetType) {
      navigateToStory(() => {
        const bridge = dependencies.storyBibleBridge;
        if (bridge === undefined) return;
        dependencies.setStoryBibleEditor(bridge.beginCreate(kind, assetType));
      });
    },
    navigateToTimeline() {
      navigateToStory(() => {
        const bridge = dependencies.storyBibleBridge;
        if (bridge === undefined) return;
        dependencies.setStoryBibleEditor(bridge.selectKind("timeline"));
      }, "timeline");
    },
    navigateToTimelineEntry(entryId) {
      navigateToStory(() => {
        const bridge = dependencies.storyBibleBridge;
        if (bridge === undefined) return;
        openStoryBibleEntry(bridge, entryId);
      }, "timeline");
    },
    cancelStoryDraft() {
      if (!hasCreativeContext(dependencies.getWorkspaceContext())) return;
      const bridge = dependencies.storyBibleBridge;
      if (bridge === undefined) return;
      dependencies.setStoryBibleEditor(bridge.cancelDraft());
    },
    async cancelStoryExplicitInversePreview() {
      if (!hasCreativeContext(dependencies.getWorkspaceContext())) return;
      const bridge = dependencies.storyBibleBridge;
      if (bridge?.cancelExplicitInversePreview === undefined) return;
      dependencies.setStoryBibleEditor(await bridge.cancelExplicitInversePreview());
    },
    async navigateToFile(path) {
      if (!(await canLeaveCreativeFile())) return;
      const bridge = dependencies.plainFileBridge;
      if (bridge === undefined) return;

      try {
        const next = await bridge.openFile(path);
        clearCreativeFile();
        dependencies.setFileEditor(next);
        dependencies.setChapterEditor(undefined);
        dependencies.setShellState((current) => ({
          ...current,
          workbenchMode: "engineering",
          activeActivity: "workspace"
        }));
      } catch (error) {
        dependencies.onNavigationFeedback?.(toErrorMessage(error));
      }
    },
    async navigateToCreativeFile(path) {
      if (!hasCreativeContext(dependencies.getWorkspaceContext())) return;
      if (!(await canLeaveCreativeFile())) return;
      const files = dependencies.creativeProjectFilesBridge;
      const editor = dependencies.creativePlainFileBridge;
      if (files === undefined || editor === undefined) return;
      if (!(await files.requestOpenFile(path))) return;
      try {
        const next = await editor.openFile(path);
        (dependencies.setCreativeFileEditor ?? dependencies.setFileEditor)(next);
        dependencies.setChapterEditor(undefined);
        dependencies.setShellState((current) => ({
          ...current,
          workbenchMode: "creative",
          activeActivity: "workspace"
        }));
      } catch (error) {
        files.clearActiveFile();
        dependencies.onNavigationFeedback?.(toErrorMessage(error));
      }
    },
    openMainReview(review) {
      dependencies.setMainReview(review);
    }
  };

  function openStoryBibleEntry(
    bridge: NonNullable<WorkspaceNavigationDependencies["storyBibleBridge"]>,
    entryId: string
  ): void {
    if (bridge.selectEntryForEditing === undefined || bridge.getEditorProps === undefined) {
      dependencies.setStoryBibleEditor(bridge.selectEntry(entryId));
      return;
    }
    const pending = bridge.selectEntryForEditing(entryId);
    dependencies.setStoryBibleEditor(bridge.getEditorProps());
    void pending.then(dependencies.setStoryBibleEditor, (error: unknown) => {
      dependencies.onNavigationFeedback?.(toErrorMessage(error));
    });
  }

  function selectWorkbench(mode: WorkbenchMode): void {
    const workspaceContext = dependencies.getWorkspaceContext();
    if (mode === "creative" && !hasCreativeContext(workspaceContext)) {
      dependencies.onNavigationFeedback?.("当前工程工作区不提供创作工作台。请先打开创作项目。");
      return;
    }

    if (mode === "engineering" && workspaceContext.kind === "none") {
      dependencies.openEngineeringWorkspace();
      return;
    }

    if (
      mode === "engineering" &&
      workspaceContext.kind !== "engineeringWorkspace" &&
      dependencies.engineeringWorkspaceBridge !== undefined
    ) {
      void dependencies.engineeringWorkspaceBridge.attachCreativeProject().then(
        (next) => {
          if (next.status !== "ready" || next.workspace === undefined) {
            throw new Error(next.feedback?.message ?? "无法载入创作项目的工程视图。");
          }
          dependencies.setEngineeringWorkspace?.(next.workspace);
          dependencies.setShellState((current) => ({ ...current, workbenchMode: mode }));
        },
        (error: unknown) => {
          dependencies.onNavigationFeedback?.(toErrorMessage(error));
        }
      );
      return;
    }

    dependencies.setShellState((current) => ({ ...current, workbenchMode: mode }));
  }

  async function canLeaveCreativeFile(): Promise<boolean> {
    return (await dependencies.canLeaveCreativeFile?.()) !== false;
  }

  function clearCreativeFile(): void {
    dependencies.creativePlainFileBridge?.clear();
    dependencies.creativeProjectFilesBridge?.clearActiveFile();
    (dependencies.setCreativeFileEditor ?? dependencies.setFileEditor)(undefined);
  }

  function navigateToStory(select: () => void, activityId: ActivityId = "storyBible"): void {
    if (!hasCreativeContext(dependencies.getWorkspaceContext())) return;
    if (
      dependencies.canLeaveCreativeFile !== undefined ||
      dependencies.canLeaveStoryBibleDraft !== undefined
    ) {
      void guardStoryNavigation().then((allowed) => {
        if (allowed) commitStorySelection(select, activityId);
      });
      return;
    }
    commitStorySelection(select, activityId);
  }

  async function guardStoryNavigation(): Promise<boolean> {
    return (
      (await canLeaveCreativeFile()) && (await dependencies.canLeaveStoryBibleDraft?.()) !== false
    );
  }

  function commitStorySelection(select: () => void, activityId: ActivityId): void {
    select();
    clearCreativeFile();
    dependencies.setFileEditor(undefined);
    commitCreativeSurface(dependencies.setShellState, "story", activityId);
  }
}

function commitCreativeSurface(
  setShellState: StateSetter<DesktopShellState>,
  creativeNavigatorMode: DesktopShellState["creativeNavigatorMode"],
  activeActivity: ActivityId
): void {
  setShellState((current) => ({
    ...current,
    workbenchMode: "creative",
    creativeNavigatorMode,
    activeActivity
  }));
}

function hasCreativeContext(context: WorkspaceContextDto): boolean {
  return context.kind === "creativeProject";
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
