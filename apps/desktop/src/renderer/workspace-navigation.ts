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
  StoryBibleEditorProps
} from "@novel-studio/ui";

import type { PlainFileEditorBridge } from "./plain-file-editor-bridge.js";
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
  navigateToStoryEntry(entryId: string): void;
  createStoryEntry(kind: StoryBibleEditorKind): void;
  navigateToFile(path: string): Promise<void>;
  openMainReview(review: AgentConversationMainReview): void;
}

export interface WorkspaceNavigationDependencies {
  readonly getWorkspaceContext: () => WorkspaceContextDto;
  readonly projectWorkflowBridge?: Pick<ProjectWorkflowBridge, "selectChapterAndLoad"> | undefined;
  readonly chapterEditorBridge?: Pick<ChapterEditorBridge, "adopt"> | undefined;
  readonly storyBibleBridge?: Pick<StoryBibleBridge, "selectKind" | "selectEntry"> | undefined;
  readonly plainFileBridge?: Pick<PlainFileEditorBridge, "openFile"> | undefined;
  readonly setShellState: StateSetter<DesktopShellState>;
  readonly setProjectWorkflow: (next: ProjectWorkflowProps | undefined) => void;
  readonly setChapterEditor: (next: ChapterEditorProps | undefined) => void;
  readonly setFileEditor: (next: PlainFileEditorProps | undefined) => void;
  readonly setStoryBibleEditor: (next: StoryBibleEditorProps | undefined) => void;
  readonly setMainReview: (review: AgentConversationMainReview) => void;
  readonly engineeringWorkspaceBridge?: Pick<
    EngineeringWorkspaceBridge,
    "attachCreativeProject"
  > | undefined;
  readonly setEngineeringWorkspace?: ((workspace: EngineeringWorkspaceSnapshot) => void) | undefined;
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
      if (mode === "creative" && !hasCreativeContext(dependencies.getWorkspaceContext())) {
        dependencies.onNavigationFeedback?.("当前工程工作区不提供创作工作台。请先打开创作项目。");
        return;
      }

      if (
        mode === "engineering" &&
        dependencies.getWorkspaceContext().kind !== "engineeringWorkspace" &&
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
    },
    openCreativeProject: dependencies.openCreativeProject,
    openEngineeringWorkspace: dependencies.openEngineeringWorkspace,
    createCreativeProject: dependencies.createCreativeProject,
    async navigateToChapter(chapterId) {
      const bridge = dependencies.projectWorkflowBridge;
      if (bridge === undefined) return;

      try {
        const next = await bridge.selectChapterAndLoad(chapterId);
        dependencies.setProjectWorkflow(next.projectWorkflow);
        dependencies.setChapterEditor(
          dependencies.chapterEditorBridge?.adopt(next.chapterEditor) ?? next.chapterEditor
        );
        dependencies.setFileEditor(undefined);
        commitCreativeSurface(dependencies.setShellState, "writing", "workspace");
      } catch (error) {
        dependencies.onNavigationFeedback?.(toErrorMessage(error));
      }
    },
    navigateToStoryKind(kind) {
      if (!hasCreativeContext(dependencies.getWorkspaceContext())) return;
      const bridge = dependencies.storyBibleBridge;
      if (bridge === undefined) return;

      dependencies.setStoryBibleEditor(bridge.selectKind(kind));
      commitCreativeSurface(dependencies.setShellState, "story", "storyBible");
    },
    navigateToStoryEntry(entryId) {
      if (!hasCreativeContext(dependencies.getWorkspaceContext())) return;
      const bridge = dependencies.storyBibleBridge;
      if (bridge === undefined) return;

      dependencies.setStoryBibleEditor(bridge.selectEntry(entryId));
      commitCreativeSurface(dependencies.setShellState, "story", "storyBible");
    },
    createStoryEntry(kind) {
      if (!hasCreativeContext(dependencies.getWorkspaceContext())) return;
      const bridge = dependencies.storyBibleBridge;
      if (bridge === undefined) return;

      dependencies.setStoryBibleEditor(bridge.selectKind(kind));
      commitCreativeSurface(dependencies.setShellState, "story", "storyBible");
    },
    async navigateToFile(path) {
      const bridge = dependencies.plainFileBridge;
      if (bridge === undefined) return;

      try {
        const next = await bridge.openFile(path);
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
    openMainReview(review) {
      dependencies.setMainReview(review);
    }
  };
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
