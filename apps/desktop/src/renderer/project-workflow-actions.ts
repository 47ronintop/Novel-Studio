import type { DesktopShellState, NovelStudioApi } from "@novel-studio/application";
import type {
  ChapterEditorProps,
  ConfigStudioPanelProps,
  ModelSettingsPanelProps,
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
import type { StudioBridge } from "./studio-bridge.js";

export interface ProjectWorkflowActionInputs {
  readonly api: NovelStudioApi | undefined;
  readonly chapterBridge: ChapterEditorBridge | undefined;
  readonly projectWorkflowBridge: ProjectWorkflowBridge | undefined;
  readonly settingsBridge: SettingsBridge | undefined;
  readonly storyBibleBridge: StoryBibleBridge | undefined;
  readonly studioBridge: StudioBridge | undefined;
  readonly setChapterEditor: Dispatch<SetStateAction<ChapterEditorProps | undefined>>;
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
  projectWorkflowBridge,
  settingsBridge,
  storyBibleBridge,
  studioBridge,
  setChapterEditor,
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
        setChapterEditor(undefined);
        setChapterEditor(await chapterBridge.load());
      }
      if (storyBibleBridge !== undefined) {
        setStoryBible(await storyBibleBridge.load());
        setStoryBibleEditor(storyBibleBridge.getEditorProps());
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
      settingsBridge,
      setChapterEditor,
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

  const handleProjectRootChange = useCallback(
    (projectRoot: string) => {
      setProjectWorkflow(projectWorkflowBridge?.setProjectRootInput(projectRoot));
    },
    [projectWorkflowBridge, setProjectWorkflow]
  );

  const handleOpenProject = useCallback(() => {
    if (projectWorkflowBridge === undefined) {
      return;
    }

    setProjectWorkflow({ ...projectWorkflowBridge.getProps(), status: "opening" });
    void projectWorkflowBridge.openProject().then(refreshProjectWorkflow);
  }, [projectWorkflowBridge, refreshProjectWorkflow, setProjectWorkflow]);

  const handleCreateProject = useCallback(() => {
    if (projectWorkflowBridge === undefined) {
      return;
    }

    setProjectWorkflow({ ...projectWorkflowBridge.getProps(), status: "creating" });
    void projectWorkflowBridge.createProject().then(refreshProjectWorkflow);
  }, [projectWorkflowBridge, refreshProjectWorkflow, setProjectWorkflow]);

  const handleCreateExampleProject = useCallback(() => {
    if (projectWorkflowBridge === undefined) {
      return;
    }

    setProjectWorkflow({ ...projectWorkflowBridge.getProps(), status: "creating" });
    void projectWorkflowBridge.createExampleProject().then(refreshProjectWorkflow);
  }, [projectWorkflowBridge, refreshProjectWorkflow, setProjectWorkflow]);

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

  const handleSelectChapter = useCallback(
    (chapterId: string) => {
      void projectWorkflowBridge?.selectChapter(chapterId).then(refreshProjectWorkflow);
    },
    [projectWorkflowBridge, refreshProjectWorkflow]
  );

  const handleCloseChapterTab = useCallback(
    (chapterId: string) => {
      void projectWorkflowBridge?.closeChapterTab(chapterId).then(refreshProjectWorkflow);
    },
    [projectWorkflowBridge, refreshProjectWorkflow]
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

  return {
    refreshProjectWorkflow,
    handleProjectRootChange,
    handleOpenProject,
    handleCreateProject,
    handleCreateExampleProject,
    handleCreateChapter,
    handleRenameChapter,
    handleDuplicateChapter,
    handleDeleteChapter,
    handleSelectChapter,
    handleCloseChapterTab,
    handlePreviewRecoveryDraft,
    handleApplyRecoveryDraft,
    handleDiscardRecoveryDraft
  };
}
