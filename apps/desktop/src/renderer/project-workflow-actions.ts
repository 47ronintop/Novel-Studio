import type { DesktopShellState, NovelStudioApi } from "@novel-studio/application";
import type {
  ChapterEditorProps,
  ConfigStudioPanelProps,
  ModelSettingsPanelProps,
  PlainFileEditorProps,
  ProjectWorkflowProps,
  StoryBibleEditorProps,
  StoryBibleSummaryProps
} from "@novel-studio/ui";
import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { ChapterEditorBridge } from "./chapter-editor-bridge.js";
import type { ProjectWorkflowBridge } from "./project-workflow-bridge.js";
import type { SettingsBridge } from "./settings-bridge.js";
import type { StoryBibleBridge } from "./story-bible-bridge.js";
import { guardDirtyStoryBibleDraft } from "./story-bible-draft-guard.js";
import type { StudioBridge } from "./studio-bridge.js";

export interface ProjectWorkflowActionInputs {
  readonly api: NovelStudioApi | undefined;
  readonly chapterBridge: ChapterEditorBridge | undefined;
  readonly projectWorkflow?: ProjectWorkflowProps | undefined;
  readonly projectWorkflowBridge: ProjectWorkflowBridge | undefined;
  readonly settingsBridge: SettingsBridge | undefined;
  readonly storyBibleBridge: StoryBibleBridge | undefined;
  readonly studioBridge: StudioBridge | undefined;
  readonly beforeWorkspaceTransition?: (() => Promise<boolean>) | undefined;
  readonly setChapterEditor: Dispatch<SetStateAction<ChapterEditorProps | undefined>>;
  readonly clearFileEditor?: (() => void) | undefined;
  readonly setFileEditor?: Dispatch<SetStateAction<PlainFileEditorProps | undefined>> | undefined;
  readonly setProjectWorkflow: Dispatch<SetStateAction<ProjectWorkflowProps | undefined>>;
  readonly setSettings: Dispatch<SetStateAction<ModelSettingsPanelProps | undefined>>;
  readonly setShellState: Dispatch<SetStateAction<DesktopShellState>>;
  readonly setStoryBible: Dispatch<SetStateAction<StoryBibleSummaryProps | undefined>>;
  readonly setStoryBibleEditor: Dispatch<SetStateAction<StoryBibleEditorProps | undefined>>;
  readonly setStudio: Dispatch<SetStateAction<ConfigStudioPanelProps | undefined>>;
}

export function useProjectWorkflowActions({
  api,
  chapterBridge,
  projectWorkflow,
  projectWorkflowBridge,
  settingsBridge,
  storyBibleBridge,
  studioBridge,
  beforeWorkspaceTransition,
  setChapterEditor,
  clearFileEditor,
  setFileEditor,
  setProjectWorkflow,
  setSettings,
  setShellState,
  setStoryBible,
  setStoryBibleEditor,
  setStudio
}: ProjectWorkflowActionInputs) {
  const refreshProjectWorkflow = useCallback(
    async (nextWorkflow: ProjectWorkflowProps) => {
      setProjectWorkflow(nextWorkflow);
      if (api !== undefined) {
        setShellState(await api.getShellState());
      }
      if (chapterBridge !== undefined && nextWorkflow.activeChapterId !== undefined) {
        clearFileEditor?.();
        setFileEditor?.(undefined);
        setChapterEditor(undefined);
        setChapterEditor(await chapterBridge.load());
      }
      if (storyBibleBridge !== undefined) {
        if (nextWorkflow.projectId === undefined) {
          storyBibleBridge.clear();
          setStoryBible(undefined);
          setStoryBibleEditor(undefined);
        } else {
          setStoryBible(await storyBibleBridge.load(nextWorkflow.projectId));
          setStoryBibleEditor(storyBibleBridge.getEditorProps());
        }
      }
      if (settingsBridge !== undefined) {
        setSettings(await settingsBridge.load());
      }
      if (studioBridge !== undefined) {
        setStudio(await studioBridge.load());
      }
    },
    [
      api,
      chapterBridge,
      clearFileEditor,
      settingsBridge,
      setChapterEditor,
      setFileEditor,
      setProjectWorkflow,
      setSettings,
      setShellState,
      setStoryBible,
      setStoryBibleEditor,
      setStudio,
      storyBibleBridge,
      studioBridge
    ]
  );

  const handleProjectTitleChange = useCallback(
    (title: string) => {
      setProjectWorkflow(projectWorkflowBridge?.setProjectTitleInput(title));
    },
    [projectWorkflowBridge, setProjectWorkflow]
  );

  const handleProjectFolderNameChange = useCallback(
    (folderName: string) => {
      setProjectWorkflow(projectWorkflowBridge?.setProjectFolderNameInput(folderName));
    },
    [projectWorkflowBridge, setProjectWorkflow]
  );

  const handleChooseCreateParentDirectory = useCallback(() => {
    void projectWorkflowBridge?.chooseCreateParentDirectory().then(setProjectWorkflow);
  }, [projectWorkflowBridge, setProjectWorkflow]);

  const clearProjectBoundStory = useCallback(() => {
    storyBibleBridge?.clear();
    setStoryBible(undefined);
    setStoryBibleEditor(undefined);
  }, [setStoryBible, setStoryBibleEditor, storyBibleBridge]);

  const refreshWorkspaceTransition = useCallback(
    async (nextWorkflow: ProjectWorkflowProps) => {
      if (nextWorkflow.status === "ready" && nextWorkflow.feedback === undefined) {
        clearProjectBoundStory();
      }
      await refreshProjectWorkflow(nextWorkflow);
    },
    [clearProjectBoundStory, refreshProjectWorkflow]
  );

  const restoreWorkspaceTransition = useCallback(
    (previous: ProjectWorkflowProps, error: unknown) => {
      setProjectWorkflow({
        ...previous,
        feedback: {
          kind: "error",
          message: error instanceof Error ? error.message : String(error)
        }
      });
    },
    [setProjectWorkflow]
  );

  const runWorkspaceTransition = useCallback(
    async (operation: () => Promise<ProjectWorkflowProps>, status: "opening" | "creating") => {
      if (beforeWorkspaceTransition !== undefined && !(await beforeWorkspaceTransition())) return;

      const previous = projectWorkflowBridge?.getProps();
      if (previous === undefined) return;
      setProjectWorkflow({ ...previous, status });
      try {
        await refreshWorkspaceTransition(await operation());
      } catch (error) {
        restoreWorkspaceTransition(previous, error);
      }
    },
    [
      beforeWorkspaceTransition,
      projectWorkflowBridge,
      refreshWorkspaceTransition,
      restoreWorkspaceTransition,
      setProjectWorkflow
    ]
  );

  const handleOpenProject = useCallback(() => {
    if (projectWorkflowBridge === undefined) {
      return;
    }

    void runWorkspaceTransition(() => projectWorkflowBridge.openProject(), "opening");
  }, [projectWorkflowBridge, runWorkspaceTransition]);

  const handleCreateProject = useCallback(() => {
    if (projectWorkflowBridge === undefined) {
      return;
    }

    void runWorkspaceTransition(() => projectWorkflowBridge.createProject(), "creating");
  }, [projectWorkflowBridge, runWorkspaceTransition]);

  const handleCreateExampleProject = useCallback(() => {
    if (projectWorkflowBridge === undefined) {
      return;
    }

    void runWorkspaceTransition(() => projectWorkflowBridge.createExampleProject(), "creating");
  }, [projectWorkflowBridge, runWorkspaceTransition]);

  const handleCreateChapter = useCallback(() => {
    void projectWorkflowBridge?.createChapter().then(refreshProjectWorkflow);
  }, [projectWorkflowBridge, refreshProjectWorkflow]);

  const handleRenameChapter = useCallback(
    (chapterId: string, title: string) => {
      void projectWorkflowBridge?.renameChapter(chapterId, title).then(refreshProjectWorkflow);
    },
    [projectWorkflowBridge, refreshProjectWorkflow]
  );

  const handleDuplicateChapter = useCallback(
    (chapterId: string) => {
      void projectWorkflowBridge?.duplicateChapter(chapterId).then(refreshProjectWorkflow);
    },
    [projectWorkflowBridge, refreshProjectWorkflow]
  );

  const handleDeleteChapter = useCallback(
    (chapterId: string) => {
      void projectWorkflowBridge?.deleteChapter(chapterId).then(refreshProjectWorkflow);
    },
    [projectWorkflowBridge, refreshProjectWorkflow]
  );

  const handleCloseChapterTab = useCallback(
    (chapterId: string) => {
      void projectWorkflowBridge
        ?.closeChapterTab(chapterId)
        .then((result) => {
          setProjectWorkflow(result.projectWorkflow);
          if (result.chapterEditor !== undefined) {
            clearFileEditor?.();
            setFileEditor?.(undefined);
            setChapterEditor(chapterBridge?.adopt(result.chapterEditor) ?? result.chapterEditor);
          }
        })
        .catch(() => undefined);
    },
    [
      chapterBridge,
      clearFileEditor,
      projectWorkflowBridge,
      setChapterEditor,
      setFileEditor,
      setProjectWorkflow
    ]
  );

  const handlePreviewRecoveryDraft = useCallback(
    (sessionId: string) => {
      void projectWorkflowBridge?.previewRecoveryDraft(sessionId).then(setProjectWorkflow);
    },
    [projectWorkflowBridge, setProjectWorkflow]
  );

  const handleApplyRecoveryDraft = useCallback(
    (sessionId: string) => {
      if (projectWorkflowBridge === undefined) {
        return;
      }

      void projectWorkflowBridge.applyRecoveryDraft(sessionId).then(async (result) => {
        setProjectWorkflow(result.projectWorkflow);
        if (result.chapterEditor !== undefined) {
          setChapterEditor(result.chapterEditor);
        }
        if (api !== undefined) {
          setShellState(await api.getShellState());
        }
      });
    },
    [api, projectWorkflowBridge, setChapterEditor, setProjectWorkflow, setShellState]
  );

  const handleDiscardRecoveryDraft = useCallback(
    (sessionId: string) => {
      void projectWorkflowBridge?.discardRecoveryDraft(sessionId).then(setProjectWorkflow);
    },
    [projectWorkflowBridge, setProjectWorkflow]
  );

  const handleStoryBibleDraftChange = useCallback<StoryBibleEditorProps["onDraftChange"]>(
    (kind, draft) => {
      if (storyBibleBridge === undefined) return;
      setStoryBibleEditor(storyBibleBridge.updateDraft(kind, draft));
    },
    [setStoryBibleEditor, storyBibleBridge]
  );

  const handleStoryBibleFiltersChange = useCallback<StoryBibleEditorProps["onFiltersChange"]>(
    (filters) => {
      if (storyBibleBridge === undefined) return;
      setStoryBibleEditor(storyBibleBridge.updateFilters(filters));
    },
    [setStoryBibleEditor, storyBibleBridge]
  );

  const handleSaveStoryBibleDraft = useCallback(
    (chapterIds: readonly string[]) => {
      if (storyBibleBridge === undefined) return;

      setStoryBibleEditor(storyBibleBridge.beginSave());
      void storyBibleBridge.saveDraft({ chapterIds }).then((nextStoryBibleEditor) => {
        setStoryBibleEditor(nextStoryBibleEditor);
        setStoryBible(storyBibleBridge.getProps());
      });
    },
    [setStoryBible, setStoryBibleEditor, storyBibleBridge]
  );

  const guardStoryBibleDraft = useCallback(
    () =>
      guardDirtyStoryBibleDraft(
        storyBibleBridge,
        (bridge, editor) => {
          setStoryBibleEditor(editor);
          setStoryBible(bridge.getProps());
        },
        undefined,
        projectWorkflow === undefined
          ? undefined
          : { chapterIds: projectWorkflow.chapters.map((chapter) => chapter.id) }
      ),
    [projectWorkflow?.chapters, setStoryBible, setStoryBibleEditor, storyBibleBridge]
  );

  return {
    refreshProjectWorkflow,
    handleProjectTitleChange,
    handleProjectFolderNameChange,
    handleChooseCreateParentDirectory,
    handleOpenProject,
    handleCreateProject,
    handleCreateExampleProject,
    handleCreateChapter,
    handleRenameChapter,
    handleDuplicateChapter,
    handleDeleteChapter,
    handleCloseChapterTab,
    handlePreviewRecoveryDraft,
    handleApplyRecoveryDraft,
    handleDiscardRecoveryDraft,
    handleStoryBibleDraftChange,
    handleStoryBibleFiltersChange,
    handleSaveStoryBibleDraft,
    guardStoryBibleDraft
  };
}
