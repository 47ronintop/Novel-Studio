import type { DesktopShellState, NovelStudioApi } from "@novel-studio/application";
import type {
  ChapterEditorProps,
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

export interface ProjectWorkflowActionInputs {
  readonly api: NovelStudioApi | undefined;
  readonly chapterBridge: ChapterEditorBridge | undefined;
  readonly chapterEditor?: ChapterEditorProps | undefined;
  readonly saveCurrentChapter?: (() => Promise<boolean>) | undefined;
  readonly confirmForeshadowAnalysisSave?: ((message: string) => boolean) | undefined;
  readonly projectWorkflow?: ProjectWorkflowProps | undefined;
  readonly projectWorkflowBridge: ProjectWorkflowBridge | undefined;
  readonly settingsBridge: SettingsBridge | undefined;
  readonly storyBibleBridge: StoryBibleBridge | undefined;
  readonly beforeWorkspaceTransition?: (() => Promise<boolean>) | undefined;
  readonly beforeCreateChapter?: (() => Promise<boolean>) | undefined;
  readonly setChapterEditor: Dispatch<SetStateAction<ChapterEditorProps | undefined>>;
  readonly clearFileEditor?: (() => void) | undefined;
  readonly setFileEditor?: Dispatch<SetStateAction<PlainFileEditorProps | undefined>> | undefined;
  readonly setProjectWorkflow: Dispatch<SetStateAction<ProjectWorkflowProps | undefined>>;
  readonly setSettings: Dispatch<SetStateAction<ModelSettingsPanelProps | undefined>>;
  readonly setShellState: Dispatch<SetStateAction<DesktopShellState>>;
  readonly setStoryBible: Dispatch<SetStateAction<StoryBibleSummaryProps | undefined>>;
  readonly setStoryBibleEditor: Dispatch<SetStateAction<StoryBibleEditorProps | undefined>>;
}

export function useProjectWorkflowActions({
  api,
  chapterBridge,
  chapterEditor,
  saveCurrentChapter,
  confirmForeshadowAnalysisSave,
  projectWorkflow,
  projectWorkflowBridge,
  settingsBridge,
  storyBibleBridge,
  beforeWorkspaceTransition,
  beforeCreateChapter,
  setChapterEditor,
  clearFileEditor,
  setFileEditor,
  setProjectWorkflow,
  setSettings,
  setShellState,
  setStoryBible,
  setStoryBibleEditor
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
      storyBibleBridge
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
    async (nextWorkflow: ProjectWorkflowProps, previousProjectId?: string) => {
      if (
        nextWorkflow.status === "ready" &&
        nextWorkflow.projectId !== undefined &&
        nextWorkflow.projectId !== previousProjectId
      ) {
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

  const guardStoryBibleDraft = useCallback(() => {
    const analysis = storyBibleBridge?.getEditorProps().foreshadowAnalysis;
    if (analysis?.status === "review" && analysis.review.step === "applying") {
      return Promise.resolve(false);
    }
    return guardDirtyStoryBibleDraft(
      storyBibleBridge,
      (bridge, editor) => {
        setStoryBibleEditor(editor);
        setStoryBible(bridge.getProps());
      },
      undefined,
      projectWorkflow === undefined
        ? undefined
        : { chapterIds: projectWorkflow.chapters.map((chapter) => chapter.id) }
    );
  }, [projectWorkflow?.chapters, setStoryBible, setStoryBibleEditor, storyBibleBridge]);

  const runWorkspaceTransition = useCallback(
    async (operation: () => Promise<ProjectWorkflowProps>, status: "opening" | "creating") => {
      if (beforeWorkspaceTransition !== undefined && !(await beforeWorkspaceTransition())) return;
      if (!(await guardStoryBibleDraft())) return;

      const previous = projectWorkflowBridge?.getProps();
      if (previous === undefined) return;
      setProjectWorkflow({ ...previous, status });
      try {
        await refreshWorkspaceTransition(await operation(), previous.projectId);
      } catch (error) {
        restoreWorkspaceTransition(previous, error);
      }
    },
    [
      beforeWorkspaceTransition,
      guardStoryBibleDraft,
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

  const handleFolderImportCandidateToggle = useCallback(
    (relativePath: string, selected: boolean) => {
      setProjectWorkflow(
        projectWorkflowBridge?.setFolderImportCandidateSelected(relativePath, selected)
      );
    },
    [projectWorkflowBridge, setProjectWorkflow]
  );

  const handleFolderImportCancel = useCallback(() => {
    setProjectWorkflow(projectWorkflowBridge?.cancelFolderImport());
  }, [projectWorkflowBridge, setProjectWorkflow]);

  const handleFolderImportConfirm = useCallback(() => {
    if (projectWorkflowBridge === undefined) return;
    void runWorkspaceTransition(() => projectWorkflowBridge.confirmFolderImport(), "creating");
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

  const handleStoryBibleStatusActionRequest = useCallback<
    NonNullable<StoryBibleEditorProps["onStatusActionRequest"]>
  >(
    (action) => {
      if (storyBibleBridge === undefined) return;
      const pending = storyBibleBridge.requestStatusAction(action);
      setStoryBibleEditor(storyBibleBridge.getEditorProps());
      void pending.then(setStoryBibleEditor);
    },
    [setStoryBibleEditor, storyBibleBridge]
  );

  const handleStoryBibleStatusActionCancel = useCallback(() => {
    if (storyBibleBridge === undefined) return;
    setStoryBibleEditor(storyBibleBridge.cancelStatusAction());
  }, [setStoryBibleEditor, storyBibleBridge]);

  const handleStoryBibleStatusActionConfirm = useCallback(() => {
    if (storyBibleBridge === undefined) return;
    const pending = storyBibleBridge.confirmStatusAction();
    setStoryBibleEditor(storyBibleBridge.getEditorProps());
    void pending.then((prepared) => {
      setStoryBibleEditor(prepared.editor);
      if (!prepared.readyToSave) return;
      setStoryBibleEditor(storyBibleBridge.beginSave());
      void storyBibleBridge
        .saveDraft({ chapterIds: (projectWorkflow?.chapters ?? []).map((chapter) => chapter.id) })
        .then((nextStoryBibleEditor) => {
          setStoryBibleEditor(nextStoryBibleEditor);
          setStoryBible(storyBibleBridge.getProps());
        });
    });
  }, [projectWorkflow?.chapters, setStoryBible, setStoryBibleEditor, storyBibleBridge]);

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

  const handleOpenForeshadowAnalysis = useCallback(() => {
    if (storyBibleBridge === undefined) return;
    const currentChapterId =
      projectWorkflow?.activeChapterId ?? chapterEditor?.chapter.frontmatter.id;
    setStoryBibleEditor(storyBibleBridge.openForeshadowAnalysis(currentChapterId));
  }, [
    chapterEditor?.chapter.frontmatter.id,
    projectWorkflow?.activeChapterId,
    setStoryBibleEditor,
    storyBibleBridge
  ]);

  const handleToggleForeshadowAnalysisChapter = useCallback(
    (chapterId: string) => {
      if (storyBibleBridge === undefined) return;
      setStoryBibleEditor(storyBibleBridge.toggleForeshadowAnalysisChapter(chapterId));
    },
    [setStoryBibleEditor, storyBibleBridge]
  );

  const handleCloseForeshadowAnalysis = useCallback(() => {
    if (storyBibleBridge === undefined) return;
    setStoryBibleEditor(storyBibleBridge.closeForeshadowAnalysis());
  }, [setStoryBibleEditor, storyBibleBridge]);

  const handleToggleForeshadowAnalysisCandidate = useCallback(
    (candidateId: string) => {
      if (storyBibleBridge === undefined) return;
      setStoryBibleEditor(storyBibleBridge.toggleForeshadowAnalysisCandidate(candidateId));
    },
    [setStoryBibleEditor, storyBibleBridge]
  );

  const handlePreviewForeshadowAnalysisChanges = useCallback(async () => {
    if (storyBibleBridge === undefined) return;
    const start = storyBibleBridge.beginForeshadowAnalysisPreview();
    setStoryBibleEditor(start.editor);
    if (!start.started || start.token === undefined) return;
    const chapterIdsInOrder = [...(projectWorkflow?.chapters ?? [])]
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
      .map((chapter) => chapter.id);
    const completion = await storyBibleBridge.prepareForeshadowAnalysisPreview(
      start.token,
      chapterIdsInOrder
    );
    if (completion.applied) setStoryBibleEditor(completion.editor);
  }, [projectWorkflow?.chapters, setStoryBibleEditor, storyBibleBridge]);

  const handleBackToForeshadowAnalysisCandidates = useCallback(() => {
    if (storyBibleBridge === undefined) return;
    setStoryBibleEditor(storyBibleBridge.backToForeshadowAnalysisCandidates());
  }, [setStoryBibleEditor, storyBibleBridge]);

  const saveForeshadowAnalysisChanges = useCallback(
    async (retryFailedOnly: boolean) => {
      if (storyBibleBridge === undefined) return;
      const start = storyBibleBridge.beginForeshadowAnalysisSave(retryFailedOnly);
      if (!start.started || start.token === undefined) return;
      setStoryBibleEditor(start.editor);
      const completion = await storyBibleBridge.saveForeshadowAnalysisChanges(start.token);
      if (!completion.applied) return;
      setStoryBibleEditor(completion.editor);
      setStoryBible(storyBibleBridge.getProps());
    },
    [setStoryBible, setStoryBibleEditor, storyBibleBridge]
  );

  const handleConfirmForeshadowAnalysisChanges = useCallback(
    () => void saveForeshadowAnalysisChanges(false),
    [saveForeshadowAnalysisChanges]
  );

  const handleRetryFailedForeshadowAnalysisChanges = useCallback(
    () => void saveForeshadowAnalysisChanges(true),
    [saveForeshadowAnalysisChanges]
  );

  const handleDetectForeshadows = useCallback(async () => {
    if (storyBibleBridge === undefined) return;
    const preparation = storyBibleBridge.prepareForeshadowAnalysis();
    setStoryBibleEditor(preparation.editor);
    if (preparation.token === undefined) return;
    const selectedChapterIds = preparation.editor.foreshadowAnalysis.selectedChapterIds;
    const guardResult = await guardDirtyChapterForForeshadowAnalysis(
      selectedChapterIds,
      chapterEditor,
      saveCurrentChapter,
      confirmForeshadowAnalysisSave
    );
    if (guardResult !== "ready") {
      const transition =
        guardResult === "cancelled"
          ? storyBibleBridge.cancelForeshadowAnalysisPreparation(preparation.token)
          : storyBibleBridge.failForeshadowAnalysisPreparation(
              preparation.token,
              "当前章节保存失败，未开始识别。"
            );
      if (transition.applied) setStoryBibleEditor(transition.editor);
      return;
    }

    const start = storyBibleBridge.beginForeshadowAnalysis(preparation.token);
    if (!start.started) return;
    setStoryBibleEditor(start.editor);
    const completion = await storyBibleBridge.detectForeshadows(preparation.token);
    if (completion.applied) setStoryBibleEditor(completion.editor);
  }, [
    chapterEditor,
    confirmForeshadowAnalysisSave,
    saveCurrentChapter,
    setStoryBibleEditor,
    storyBibleBridge
  ]);

  const handleCreateChapter = useCallback(() => {
    void (async () => {
      if (beforeWorkspaceTransition !== undefined && !(await beforeWorkspaceTransition())) return;
      if (!(await guardStoryBibleDraft())) return;
      if (beforeCreateChapter !== undefined && !(await beforeCreateChapter())) return;
      const next = await projectWorkflowBridge?.createChapter();
      if (next !== undefined) await refreshProjectWorkflow(next);
    })();
  }, [
    beforeCreateChapter,
    beforeWorkspaceTransition,
    guardStoryBibleDraft,
    projectWorkflowBridge,
    refreshProjectWorkflow
  ]);

  return {
    refreshProjectWorkflow,
    handleProjectTitleChange,
    handleProjectFolderNameChange,
    handleChooseCreateParentDirectory,
    handleOpenProject,
    handleFolderImportCandidateToggle,
    handleFolderImportCancel,
    handleFolderImportConfirm,
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
    handleStoryBibleStatusActionRequest,
    handleStoryBibleStatusActionCancel,
    handleStoryBibleStatusActionConfirm,
    handleSaveStoryBibleDraft,
    handleOpenForeshadowAnalysis,
    handleToggleForeshadowAnalysisChapter,
    handleDetectForeshadows,
    handleToggleForeshadowAnalysisCandidate,
    handlePreviewForeshadowAnalysisChanges,
    handleBackToForeshadowAnalysisCandidates,
    handleConfirmForeshadowAnalysisChanges,
    handleRetryFailedForeshadowAnalysisChanges,
    handleCloseForeshadowAnalysis,
    guardStoryBibleDraft
  };
}

export async function guardDirtyChapterForForeshadowAnalysis(
  selectedChapterIds: readonly string[],
  chapterEditor: ChapterEditorProps | undefined,
  saveCurrentChapter: (() => Promise<boolean>) | undefined,
  confirmSave: (message: string) => boolean = confirmForeshadowAnalysisSave
): Promise<"ready" | "cancelled" | "save-failed"> {
  if (
    chapterEditor?.dirty !== true ||
    !selectedChapterIds.includes(chapterEditor.chapter.frontmatter.id)
  ) {
    return "ready";
  }
  if (!confirmSave("当前章节尚未保存。是否先保存，再开始识别伏笔？")) {
    return "cancelled";
  }
  if (saveCurrentChapter === undefined) return "save-failed";
  try {
    return (await saveCurrentChapter()) ? "ready" : "save-failed";
  } catch {
    return "save-failed";
  }
}

function confirmForeshadowAnalysisSave(message: string): boolean {
  return globalThis.window?.confirm(message) === true;
}
