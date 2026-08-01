import type {
  ActivityId,
  ApplicationCommand,
  ApplicationCommandId,
  DesktopShellState,
  EngineeringWorkspaceSnapshot,
  ProjectSearchResultItem,
  UserPreferencesSaveInput
} from "@novel-studio/application";
import type { UserAppearancePreferences } from "@novel-studio/shared";
import type {
  AgentConversationMainReview,
  ChapterEditorSelection,
  ChapterEditorProps,
  CommandPaletteFeedback,
  StoryBibleSummaryProps
} from "@novel-studio/ui";
import { ProjectCreateDialog } from "@novel-studio/ui";
import { useCallback, useEffect, useRef, useState } from "react";

import { createAiWritingWorkflowBridge } from "./ai-writing-workflow-bridge.js";
import { createChapterEditorBridge } from "./chapter-editor-bridge.js";
import { createCommandExecutionBridge } from "./command-execution-bridge.js";
import { createProjectWorkflowBridge } from "./project-workflow-bridge.js";
import { createProjectSearchBridge, openProjectSearchResult } from "./project-search-bridge.js";
import { createStoryBibleBridge } from "./story-bible-bridge.js";
import { createEngineeringWorkspaceBridge } from "./engineering-workspace-bridge.js";
import { createSettingsBridge } from "./settings-bridge.js";
import { createStudioBridge } from "./studio-bridge.js";
import { createAgentRunBridge } from "./agent-run-bridge.js";
import {
  decorateAgentConversationWorkspace,
  resolveAgentConversationWorkspacePresentation,
  useAgentConversationWorkspace,
  useAgentRunWorkspaceEffects,
  useStandaloneConversationSelection,
  type PendingAgentConversationMainReview
} from "./agent-conversation-workspace.js";
import {
  agentScopeFromWorkspaceContext,
  createChapterEditorRuntime,
  createOnboardingProps,
  getNovelStudioApi,
  persistAppearancePreferences,
  rendererCommands,
  rendererShellState,
  resolveActivityTransition,
  shellPreferencesFromState,
  ensureCreativeWorkspaceContext
} from "./app-shell-support.js";
import { useRendererAppEffects } from "./renderer-app-effects.js";
import { RendererWorkspaceShell } from "./renderer-workspace-shell.js";
import { useProjectWorkflowActions } from "./project-workflow-actions.js";
import { useAiWritingWorkflowActions } from "./ai-writing-workflow-actions.js";
import { useAgentUsageSettingsActions } from "./agent-usage-settings-actions.js";
import { useModelSettingsActions, useSettingsPanelActions } from "./settings-panel-actions.js";
import { useShellPreferenceActions } from "./shell-preference-actions.js";
import { createWorkspaceNavigation, type WorkspaceNavigation } from "./workspace-navigation.js";
import { useStudioActions } from "./studio-actions.js";
import { useStoryAnalysisWorkspace } from "./story-analysis-workspace.js";
import {
  createCreativeProjectFileShellBindings,
  useWorkspaceFileEditorRuntime
} from "./workspace-file-editor-runtime.js";

export function App() {
  const [api] = useState(() => getNovelStudioApi());
  const [chapterBridge] = useState(() =>
    api === undefined ? undefined : createChapterEditorBridge(api)
  );
  const [projectWorkflowBridge] = useState(() =>
    api === undefined ? undefined : createProjectWorkflowBridge(api)
  );
  const [projectSearchBridge] = useState(() =>
    api === undefined ? undefined : createProjectSearchBridge(api)
  );
  const [engineeringWorkspaceBridge] = useState(() =>
    api === undefined ? undefined : createEngineeringWorkspaceBridge(api)
  );
  const [storyBibleBridge] = useState(() =>
    api === undefined ? undefined : createStoryBibleBridge(api)
  );
  const [settingsBridge] = useState(() =>
    api === undefined ? undefined : createSettingsBridge(api)
  );
  const [aiWritingWorkflowBridge] = useState(() =>
    api === undefined ? undefined : createAiWritingWorkflowBridge(api)
  );
  const [agentRunBridge] = useState(() =>
    api === undefined ? undefined : createAgentRunBridge(api)
  );
  const [studioBridge] = useState(() => (api === undefined ? undefined : createStudioBridge(api)));
  const [commandExecutionBridge] = useState(() =>
    api === undefined ? undefined : createCommandExecutionBridge(api)
  );
  const [shellState, setShellState] = useState<DesktopShellState>(rendererShellState);
  const [commands, setCommands] = useState<readonly ApplicationCommand[]>(rendererCommands);
  const [chapterEditor, setChapterEditor] = useState<ChapterEditorProps | undefined>();
  const [engineeringWorkspace, setEngineeringWorkspace] = useState<
    EngineeringWorkspaceSnapshot | undefined
  >(() => engineeringWorkspaceBridge?.getProps().workspace);
  const [chapterSelection, setChapterSelection] = useState<ChapterEditorSelection | undefined>();
  const [projectWorkflow, setProjectWorkflow] = useState(() => projectWorkflowBridge?.getProps());
  const [projectSearch, setProjectSearch] = useState(() => projectSearchBridge?.getProps());
  const [storyBible, setStoryBible] = useState<StoryBibleSummaryProps | undefined>(() =>
    storyBibleBridge?.getProps()
  );
  const [storyBibleEditor, setStoryBibleEditor] = useState(() =>
    storyBibleBridge?.getEditorProps()
  );
  const [settings, setSettings] = useState(() => settingsBridge?.getProps());
  const [aiWritingWorkflow, setAiWritingWorkflow] = useState(() =>
    aiWritingWorkflowBridge?.getProps()
  );
  const [agentRun, setAgentRun] = useState(() => agentRunBridge?.getProps());
  const workspaceContext = shellState.workspaceContext;
  const activeProjectId =
    workspaceContext.kind === "none" ? undefined : workspaceContext.workspaceId;
  const activeAgentScope = agentScopeFromWorkspaceContext(workspaceContext);
  const activeCreativeProjectId =
    workspaceContext.kind === "creativeProject" ? workspaceContext.projectId : undefined;
  const activeCreativeWorkspaceId =
    workspaceContext.kind === "creativeProject" ? workspaceContext.workspaceId : undefined;
  const persistUserPreferences = useCallback(
    (input: UserPreferencesSaveInput) => {
      if (api === undefined) return;
      void api.preferences.save(input);
    },
    [api]
  );
  const standaloneConversationSelection =
    useStandaloneConversationSelection(persistUserPreferences);
  const fileEditorRuntime = useWorkspaceFileEditorRuntime({
    api,
    activeCreativeProjectId,
    activeCreativeWorkspaceId,
    creativeExpandedPathIds: shellState.creativeFileExpandedPathIds,
    creativeWorkspaceActive: shellState.workspaceContext.kind === "creativeProject",
    chapterBridge,
    projectWorkflowBridge,
    persistUserPreferences,
    setChapterEditor
  });
  const {
    fileEditor,
    fileEditorScope,
    plainFileBridge,
    creativePlainFileBridgeRef,
    creativeProjectFilesBridge,
    creativeProjectFiles,
    editorPreferences,
    setEditorPreferences,
    onEditorPreferencesChange,
    onFocusModeToggle,
    focusModeToggleRef,
    activeCreativeFileRef,
    setEngineeringFileEditor,
    setCreativeFileEditor,
    clearFileEditor,
    clearCreativeFile,
    clearWorkspaceFileEditors,
    guardCreativeFile,
    guardWorkspaceFileEditors
  } = fileEditorRuntime;
  const guardWorkspaceTransition = useCallback(async () => {
    const analysis = storyBibleBridge?.getEditorProps().foreshadowAnalysis;
    if (analysis?.status === "review" && analysis.review.step === "applying") return false;
    return guardWorkspaceFileEditors();
  }, [guardWorkspaceFileEditors, storyBibleBridge]);
  const [pendingMainReview, setPendingMainReview] = useState<
    PendingAgentConversationMainReview | undefined
  >();
  const workspaceNavigationRef = useRef<WorkspaceNavigation | undefined>(undefined);
  const agentConversationWorkspace = useAgentConversationWorkspace({
    api,
    agentRunBridge,
    agentRun,
    scope: activeAgentScope,
    projectId: activeProjectId,
    workspaceKind: shellState.workspaceContext.kind,
    onAgentRunChange: setAgentRun,
    onOpenMainReview: (review) => workspaceNavigationRef.current?.openMainReview(review),
    getStandaloneSelectedConversationId: standaloneConversationSelection.getSelectedConversationId,
    onStandaloneSelectedConversationIdChange:
      standaloneConversationSelection.onSelectedConversationIdChange
  });
  const agentConversationWorkspacePresentation = resolveAgentConversationWorkspacePresentation(
    agentConversationWorkspace.workspace,
    activeProjectId,
    pendingMainReview,
    agentConversationWorkspace.scope
  );
  const [studio, setStudio] = useState(() => studioBridge?.getProps());
  const [shortcutState, setShortcutState] = useState({ commandPaletteOpen: false });
  const [commandPaletteFeedback, setCommandPaletteFeedback] = useState<
    CommandPaletteFeedback | undefined
  >(undefined);
  const [commandPaletteQuery, setCommandPaletteQuery] = useState("");
  const [commandPaletteSelectedCommandId, setCommandPaletteSelectedCommandId] = useState<
    ApplicationCommandId | undefined
  >(undefined);
  const [navigatorSearchQuery, setNavigatorSearchQuery] = useState("");
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [projectCreateDialogOpen, setProjectCreateDialogOpen] = useState(false);
  const [appearancePreferences, setAppearancePreferences] = useState<UserAppearancePreferences>({
    theme: "dark",
    accentColor: "teal"
  });
  const [appearanceFeedback, setAppearanceFeedback] = useState<
    { readonly kind: "info" | "error"; readonly message: string } | undefined
  >();
  const lastNonSettingsActivityRef = useRef<ActivityId>("workspace");

  useEffect(() => {
    if (agentConversationWorkspacePresentation.shouldClearPendingMainReview) {
      setPendingMainReview(undefined);
    }
  }, [agentConversationWorkspacePresentation.shouldClearPendingMainReview]);

  useEffect(() => {
    if (api === undefined) return;
    return api.menu.onNativeCommand((commandId) => {
      const nav = workspaceNavigationRef.current;
      if (nav === undefined) return;
      if (commandId === "createCreativeProject") nav.createCreativeProject();
      else if (commandId === "openCreativeProject") nav.openCreativeProject();
      else if (commandId === "openEngineeringFolder") nav.openEngineeringWorkspace();
    });
  }, [api]);

  useEffect(() => {
    if (
      projectCreateDialogOpen &&
      projectWorkflow?.status === "ready" &&
      projectWorkflow.feedback === undefined
    ) {
      setProjectCreateDialogOpen(false);
    }
  }, [projectCreateDialogOpen, projectWorkflow?.status, projectWorkflow?.feedback]);

  useEffect(() => {
    const next = ensureCreativeWorkspaceContext(shellState, projectWorkflow?.projectId);
    if (next !== shellState) setShellState(next);
  }, [projectWorkflow?.projectId, shellState.projectTitle, shellState.workspaceContext.kind]);

  useEffect(() => {
    if (
      projectWorkflowBridge === undefined ||
      activeCreativeProjectId === undefined ||
      projectWorkflow?.projectId === activeCreativeProjectId
    ) {
      return;
    }

    let active = true;
    void projectWorkflowBridge.loadActiveProject(activeCreativeProjectId).then((next) => {
      if (active) setProjectWorkflow(next);
    });
    return () => {
      active = false;
    };
  }, [activeCreativeProjectId, projectWorkflow?.projectId, projectWorkflowBridge]);

  useEffect(
    () => engineeringWorkspaceBridge?.subscribe((next) => setEngineeringWorkspace(next.workspace)),
    [engineeringWorkspaceBridge]
  );

  const activeAgentResourceRef =
    activeCreativeFileRef ?? storyBibleBridge?.getActiveResourceRef() ?? null;

  useRendererAppEffects({
    api,
    aiWritingWorkflowBridge,
    chapterBridge,
    storyBibleBridge,
    storyBibleWorkspaceId: activeCreativeWorkspaceId,
    settingsBridge,
    studioBridge,
    shortcutState,
    setShortcutState,
    setShellState,
    setCommands,
    setOnboardingDismissed,
    setEditorPreferences,
    setAppearancePreferences,
    setStandaloneSelectedConversationId: standaloneConversationSelection.setSelectedConversationId,
    setChapterEditor,
    setStoryBible,
    setStoryBibleEditor,
    setSettings,
    setAiWritingWorkflow,
    setStudio
  });

  const handleBodyChange = useCallback(
    (nextBody: string) => {
      if (chapterBridge === undefined) {
        return;
      }

      void chapterBridge.edit(nextBody).then(setChapterEditor);
    },
    [chapterBridge]
  );

  const handleSelectionChange = useCallback((selection: ChapterEditorSelection) => {
    setChapterSelection(selection);
  }, []);

  const saveCurrentChapter = useCallback(async (): Promise<boolean> => {
    if (chapterBridge === undefined) {
      return false;
    }

    const savingEditor = chapterBridge.beginSave();
    if (savingEditor !== undefined) {
      setChapterEditor(savingEditor);
    }

    try {
      const saved = await chapterBridge.save();
      setChapterEditor(saved);
      return !saved.dirty;
    } catch {
      setChapterEditor((current) =>
        current === undefined || current.saveStatus !== "Saving"
          ? current
          : {
              ...current,
              saveStatus: "Unsaved"
            }
      );
      return false;
    }
  }, [chapterBridge]);

  const handleSave = useCallback(() => {
    void saveCurrentChapter();
  }, [saveCurrentChapter]);

  const handleVersionPreview = useCallback(
    (versionId: string) => {
      if (chapterBridge === undefined) {
        return;
      }

      void chapterBridge.previewVersion(versionId).then((preview) => {
        setChapterEditor((current) =>
          current === undefined
            ? current
            : {
                ...current,
                diffPreview: {
                  title: `Version ${versionId}`,
                  changes: [
                    {
                      kind: "replace",
                      value: preview.body
                    }
                  ]
                }
              }
        );
      });
    },
    [chapterBridge]
  );

  const handleVersionRestore = useCallback(
    (versionId: string) => {
      if (chapterBridge === undefined) {
        return;
      }

      void chapterBridge.restoreVersion(versionId).then(setChapterEditor);
    },
    [chapterBridge]
  );
  const {
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
  } = useProjectWorkflowActions({
    api,
    chapterBridge,
    chapterEditor,
    saveCurrentChapter,
    projectWorkflow,
    projectWorkflowBridge,
    settingsBridge,
    storyBibleBridge,
    studioBridge,
    beforeWorkspaceTransition: guardWorkspaceTransition,
    setChapterEditor,
    clearFileEditor,
    setProjectWorkflow,
    setSettings,
    setShellState,
    setStoryBible,
    setStoryBibleEditor,
    setStudio
  });
  const guardAgentStart = useCallback(async () => {
    if (activeCreativeFileRef !== null && !(await guardCreativeFile())) return false;
    return guardStoryBibleDraft();
  }, [activeCreativeFileRef, guardCreativeFile, guardStoryBibleDraft]);

  useAgentRunWorkspaceEffects({
    agentRunBridge,
    scope: activeAgentScope,
    projectId: activeProjectId,
    workspaceKind: shellState.workspaceContext.kind,
    surfaceContextMode:
      shellState.workspaceContext.kind === "creativeProject"
        ? shellState.workbenchMode === "engineering" || shellState.creativeNavigatorMode === "files"
          ? "general_file"
          : "writing"
        : undefined,
    activeResourceRef: activeAgentResourceRef,
    beforeStart: guardAgentStart,
    conversationId: agentConversationWorkspace.selectedConversationId,
    activeChapterId: projectWorkflow?.activeChapterId ?? chapterEditor?.chapter.frontmatter.id,
    chapterEditor,
    fileEditor,
    storyBibleSnapshotBinding: storyBibleBridge?.getSnapshotBinding(activeCreativeWorkspaceId),
    settings,
    onAgentRunChange: setAgentRun
  });

  const publishStoryBibleEditor = useCallback(
    (editor: NonNullable<typeof storyBibleEditor>) => {
      setStoryBibleEditor(editor);
      if (storyBibleBridge !== undefined) setStoryBible(storyBibleBridge.getProps());
    },
    [setStoryBible, setStoryBibleEditor, storyBibleBridge]
  );
  const handleStoryBibleExternalUpdateReload = useCallback(() => {
    if (storyBibleBridge === undefined) return;
    void storyBibleBridge.reloadExternalUpdate().then(publishStoryBibleEditor);
  }, [publishStoryBibleEditor, storyBibleBridge]);
  const handleStoryBibleExternalUpdateContinue = useCallback(() => {
    if (storyBibleBridge === undefined) return;
    publishStoryBibleEditor(storyBibleBridge.continueExternalUpdate());
  }, [publishStoryBibleEditor, storyBibleBridge]);

  useEffect(() => {
    if (agentRunBridge === undefined || storyBibleBridge === undefined) return;
    let active = true;
    const unsubscribe = agentRunBridge.subscribeProjectFilesChanged((event) => {
      void storyBibleBridge.handleExternalUpdate(event).then((editor) => {
        if (active) publishStoryBibleEditor(editor);
      });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [agentRunBridge, publishStoryBibleEditor, storyBibleBridge]);
  const {
    handleCreativeNavigatorModeSelect,
    handleCreativeFileExpandedPathIdsChange,
    handleNavigatorExpandedSectionIdsChange,
    handleEngineeringExpandedPathIdsChange
  } = useShellPreferenceActions(setShellState, persistUserPreferences);
  const handleOpenEngineeringWorkspace = useCallback(() => {
    if (api === undefined || engineeringWorkspaceBridge === undefined) return;

    void (async () => {
      if (!(await guardWorkspaceTransition())) return;
      const next = await engineeringWorkspaceBridge.openEngineeringWorkspace();
      if (next.status !== "ready" || next.workspace === undefined) return;
      setShellState(await api.getShellState());
    })().catch(() => undefined);
  }, [api, engineeringWorkspaceBridge, guardWorkspaceTransition]);

  const applyActivity = useCallback(
    (activityId: ActivityId) => {
      setShellState((current) => {
        const transition = resolveActivityTransition(
          current.activeActivity,
          lastNonSettingsActivityRef.current,
          activityId
        );
        lastNonSettingsActivityRef.current = transition.lastNonSettingsActivity;
        const next = {
          ...current,
          activeActivity: transition.activeActivity
        };
        persistUserPreferences({ shell: shellPreferencesFromState(next) });
        return next;
      });
    },
    [persistUserPreferences]
  );

  const handleSettingsClose = useCallback(() => {
    applyActivity(lastNonSettingsActivityRef.current);
  }, [applyActivity]);

  const handleBottomPanelTabSelect = useCallback(
    (tab: string) => {
      setShellState((current) => {
        const next = {
          ...current,
          activeBottomPanelTab: tab
        };
        persistUserPreferences({ shell: shellPreferencesFromState(next) });
        return next;
      });
    },
    [persistUserPreferences]
  );

  const handleCommandPaletteOpen = useCallback(() => {
    setCommandPaletteFeedback(undefined);
    setCommandPaletteQuery("");
    setCommandPaletteSelectedCommandId(undefined);
    setShortcutState((current) => ({
      ...current,
      commandPaletteOpen: true
    }));
  }, []);

  const handleCommandPaletteClose = useCallback(() => {
    setCommandPaletteFeedback(undefined);
    setCommandPaletteQuery("");
    setCommandPaletteSelectedCommandId(undefined);
    setShortcutState((current) => ({
      ...current,
      commandPaletteOpen: false
    }));
  }, []);

  const handleCommandPaletteQueryChange = useCallback((query: string) => {
    setCommandPaletteQuery(query);
    setCommandPaletteSelectedCommandId(undefined);
  }, []);

  const handleCommandPaletteActiveCommandChange = useCallback((commandId: ApplicationCommandId) => {
    setCommandPaletteSelectedCommandId(commandId);
  }, []);

  const handleCommandExecute = useCallback(
    (commandId: ApplicationCommandId) => {
      if (commandExecutionBridge === undefined) {
        return;
      }

      void (async () => {
        if (commandId === "workspace.close-current" && !(await guardWorkspaceTransition())) {
          return;
        }
        const result = await commandExecutionBridge.execute(commandId);
        if (!result.ok) {
          setCommandPaletteFeedback({
            kind: "error",
            message: result.error.message
          });
          setShortcutState((current) => ({
            ...current,
            commandPaletteOpen: true
          }));
          return;
        }

        if (commandId === "workspace.close-current") {
          clearWorkspaceFileEditors();
          engineeringWorkspaceBridge?.clear();
          setProjectWorkflow(undefined);
          setChapterEditor(undefined);
          setEngineeringWorkspace(undefined);
          setStoryBibleEditor(undefined);
          setPendingMainReview(undefined);
        }

        setShellState((current) => {
          const transition = resolveActivityTransition(
            current.activeActivity,
            lastNonSettingsActivityRef.current,
            result.value.activeActivity
          );
          lastNonSettingsActivityRef.current = transition.lastNonSettingsActivity;
          return {
            ...result.value,
            activeActivity: transition.activeActivity
          };
        });
        persistUserPreferences({ shell: shellPreferencesFromState(result.value) });
        setCommandPaletteFeedback(undefined);
        setCommandPaletteQuery("");
        setCommandPaletteSelectedCommandId(undefined);
        setShortcutState((current) => ({
          ...current,
          commandPaletteOpen: false
        }));
      })();
    },
    [
      commandExecutionBridge,
      clearWorkspaceFileEditors,
      engineeringWorkspaceBridge,
      guardWorkspaceTransition,
      persistUserPreferences
    ]
  );
  focusModeToggleRef.current = () => handleCommandExecute("workspace.toggle-focus-mode");

  const workspaceNavigation = createWorkspaceNavigation({
    getWorkspaceContext: () => shellState.workspaceContext,
    projectWorkflowBridge,
    chapterEditorBridge: chapterBridge,
    storyBibleBridge,
    plainFileBridge,
    creativePlainFileBridge: creativePlainFileBridgeRef.current,
    creativeProjectFilesBridge,
    canLeaveCreativeFile: guardWorkspaceTransition,
    canLeaveStoryBibleDraft: guardStoryBibleDraft,
    setShellState,
    setProjectWorkflow,
    setChapterEditor,
    setFileEditor: setEngineeringFileEditor,
    setCreativeFileEditor,
    setStoryBibleEditor,
    setMainReview: (review: AgentConversationMainReview) => {
      if (activeProjectId !== undefined) {
        setPendingMainReview({ projectId: activeProjectId, review });
      }
    },
    openCreativeProject: handleOpenProject,
    openEngineeringWorkspace: handleOpenEngineeringWorkspace,
    createCreativeProject: () => setProjectCreateDialogOpen(true),
    engineeringWorkspaceBridge,
    setEngineeringWorkspace,
    onNavigationFeedback: (message) =>
      setProjectWorkflow((current) =>
        current === undefined ? current : { ...current, feedback: { kind: "info", message } }
      )
  });
  workspaceNavigationRef.current = workspaceNavigation;
  const creativeProjectFileShell = createCreativeProjectFileShellBindings({
    navigator: creativeProjectFiles,
    bridge: creativeProjectFilesBridge,
    expandedPathIds: shellState.creativeFileExpandedPathIds,
    fileEditorScope,
    onExpandedPathIdsChange: handleCreativeFileExpandedPathIdsChange,
    onFileOpen: (path) => void workspaceNavigation.navigateToCreativeFile(path),
    onNavigatorModeSelect: handleCreativeNavigatorModeSelect,
    guardCreativeFile,
    clearCreativeFile,
    onReturnToWriting: () => {
      if (chapterBridge !== undefined && projectWorkflowBridge?.getProps().activeChapterId) {
        void chapterBridge.load().then(setChapterEditor);
      }
    }
  });
  const handleActivitySelect = useCallback(
    (activityId: ActivityId) => {
      if (activityId === "timeline" && shellState.workspaceContext.kind === "creativeProject") {
        workspaceNavigation.navigateToTimeline();
        return;
      }
      if (activityId === "workspace") {
        workspaceNavigation.selectWorkbench(
          shellState.workspaceContext.kind === "engineeringWorkspace"
            ? "engineering"
            : shellState.workbenchMode
        );
      }
      applyActivity(activityId);
    },
    [applyActivity, shellState.workbenchMode, shellState.workspaceContext.kind, workspaceNavigation]
  );

  const handleSearchQueryChange = useCallback(
    (query: string) => {
      if (projectSearchBridge === undefined) {
        return;
      }

      setProjectSearch(projectSearchBridge.setQuery(query));
    },
    [projectSearchBridge]
  );

  const handleProjectSearch = useCallback(() => {
    if (projectSearchBridge === undefined) {
      return;
    }

    setProjectSearch(projectSearchBridge.beginSearch());
    void projectSearchBridge.search().then(setProjectSearch);
  }, [projectSearchBridge]);

  const handleRebuildSearchIndex = useCallback(() => {
    if (projectSearchBridge === undefined) {
      return;
    }

    setProjectSearch(projectSearchBridge.beginRebuildIndex());
    void projectSearchBridge.rebuildIndex().then(setProjectSearch);
  }, [projectSearchBridge]);

  const handleSearchResultOpen = useCallback(
    (result: ProjectSearchResultItem) => {
      void openProjectSearchResult(workspaceNavigation, result);
    },
    [workspaceNavigation]
  );

  const {
    handleAiInstructionChange,
    handleGenerateAiSuggestion,
    handleSelectionAiPreview,
    handleRewriteSelection,
    handleReviewSelectionStyle,
    handleApplyAiSuggestion,
    handleRejectSelectionReview,
    handleUndoSelectionReview,
    handleCancelAiStreaming,
    handleAiModelSelect,
    handleAiReasoningEffortSelect
  } = useAiWritingWorkflowActions({
    aiWritingWorkflow,
    aiWritingWorkflowBridge,
    chapterEditor,
    chapterSelection,
    settingsBridge,
    setAiWritingWorkflow,
    setChapterEditor,
    setSettings
  });
  const agentConversationWorkspaceForShell = decorateAgentConversationWorkspace({
    workspace: agentConversationWorkspacePresentation.workspace,
    workspaceKind: shellState.workspaceContext.kind,
    chapterEditor,
    chapterSelection,
    aiWritingWorkflow,
    onRewriteSelection: handleRewriteSelection,
    onReviewSelectionStyle: handleReviewSelectionStyle,
    onApplySelection: handleApplyAiSuggestion,
    onRejectSelection: handleRejectSelectionReview,
    onUndoSelection: handleUndoSelectionReview
  });

  const handleAppearancePreferencesChange = useCallback(
    (preferences: UserAppearancePreferences) => {
      setAppearancePreferences(preferences);
      setAppearanceFeedback(undefined);
      void persistAppearancePreferences(api?.preferences, preferences).then(setAppearanceFeedback);
    },
    [api]
  );

  const {
    handleSettingsProfileSelect,
    handleDiscoverSettingsModelOptions,
    handleSettingsSectionSelect,
    handleSettingsDraftChange,
    handleNewSettingsProfile,
    handleSaveSettingsProfile,
    handleTestSettingsConnection,
    handleMakeSettingsDefault,
    handleRefreshPluginRegistry,
    handleSetPluginEnabled
  } = useModelSettingsActions(settingsBridge, setSettings);
  const agentUsageSettingsActions = useAgentUsageSettingsActions(settingsBridge, setSettings);
  const settingsPanelActions = useSettingsPanelActions(settingsBridge, setSettings);

  const {
    handleStudioAssetSelect,
    handleStudioContentChange,
    handleStudioWorkflowNodeSelect,
    handleStudioWorkflowEdgeSelect,
    handleStudioWorkflowNodeEdit,
    handleStudioWorkflowSemanticEdit,
    handleStudioWorkflowLayoutChange,
    handleStudioWorkflowNodeDragCommit,
    handleStudioSave,
    handleStudioRestoreVersion
  } = useStudioActions(studioBridge, setStudio);

  const storyAnalysisWorkspace = useStoryAnalysisWorkspace({
    api,
    activeCreativeProjectId,
    activeCreativeWorkspaceId,
    activeChapterId: projectWorkflow?.activeChapterId,
    chapterBridge,
    chapterEditor,
    projectWorkflowBridge,
    storyBibleBridge,
    storyBibleEditor,
    setChapterEditor,
    setProjectWorkflow,
    setStoryBible,
    setStoryBibleEditor
  });
  const interactiveChapterEditor =
    chapterEditor === undefined
      ? undefined
      : {
          ...chapterEditor,
          runtime: createChapterEditorRuntime(chapterEditor, chapterSelection),
          editorPreferences,
          onBodyChange: handleBodyChange,
          onSelectionChange: handleSelectionChange,
          onEditorPreferencesChange,
          onFocusModeToggle,
          onSelectionReviewAccept: handleApplyAiSuggestion,
          onSelectionReviewReject: handleRejectSelectionReview,
          onSelectionReviewUndo: handleUndoSelectionReview,
          onSelectionAiPreview: handleSelectionAiPreview,
          onSave: handleSave,
          onStatusChange: storyAnalysisWorkspace.onChapterStatusChange,
          onVersionPreview: handleVersionPreview,
          onVersionRestore: handleVersionRestore
        };
  const interactiveSettings =
    settings === undefined
      ? undefined
      : {
          ...settings,
          appearanceFeedback,
          editorPreferences,
          appearancePreferences: {
            ...appearancePreferences,
            editor: editorPreferences
          },
          onAppearancePreferencesChange: handleAppearancePreferencesChange,
          onEditorPreferencesChange,
          usage:
            settings.usage === undefined
              ? undefined
              : {
                  ...settings.usage,
                  ...agentUsageSettingsActions
                },
          network:
            settings.network === undefined
              ? undefined
              : {
                  ...settings.network,
                  ...settingsPanelActions.network
                },
          toolSources:
            settings.toolSources === undefined
              ? undefined
              : {
                  ...settings.toolSources,
                  ...settingsPanelActions.toolSources
                }
        };
  const onboarding = createOnboardingProps({
    dismissed: onboardingDismissed,
    shellState,
    chapterEditor,
    projectWorkflow,
    onCreateExampleProject: handleCreateExampleProject,
    onCreateProject: workspaceNavigation.createCreativeProject,
    onOpenProject: workspaceNavigation.openCreativeProject,
    onCreateFirstChapter: handleCreateChapter,
    onDismiss: () => {
      setOnboardingDismissed(true);
      persistUserPreferences({
        onboarding: { dismissed: true },
        shell: shellPreferencesFromState(shellState)
      });
    }
  });

  return (
    <>
      <RendererWorkspaceShell
        appearancePreferences={appearancePreferences}
        aiWritingWorkflow={aiWritingWorkflow}
        agentConversationWorkspace={agentConversationWorkspaceForShell}
        projectWorkflow={projectWorkflow}
        projectSearch={projectSearch}
        settings={interactiveSettings}
        studio={studio}
        chapterEditor={interactiveChapterEditor}
        fileEditor={fileEditor}
        fileEditorScope={fileEditorScope}
        creativeProjectFiles={creativeProjectFileShell.navigator}
        onboarding={onboarding}
        storyBible={storyBible}
        storyBibleEditor={storyAnalysisWorkspace.storyBibleEditor}
        shellState={shellState}
        commands={commands}
        commandPaletteOpen={shortcutState.commandPaletteOpen}
        commandPaletteFeedback={commandPaletteFeedback}
        commandPaletteQuery={commandPaletteQuery}
        commandPaletteSelectedCommandId={commandPaletteSelectedCommandId}
        onAiInstructionChange={handleAiInstructionChange}
        onGenerateAiSuggestion={handleGenerateAiSuggestion}
        onApplyAiSuggestion={handleApplyAiSuggestion}
        onAiModelSelect={handleAiModelSelect}
        onAiReasoningEffortSelect={handleAiReasoningEffortSelect}
        onRejectSelectionReview={handleRejectSelectionReview}
        onUndoSelectionReview={handleUndoSelectionReview}
        onCancelAiStreaming={handleCancelAiStreaming}
        onProjectTitleChange={handleProjectTitleChange}
        onProjectFolderNameChange={handleProjectFolderNameChange}
        onChooseCreateParentDirectory={handleChooseCreateParentDirectory}
        onCreateChapter={handleCreateChapter}
        onRenameChapter={handleRenameChapter}
        onDuplicateChapter={handleDuplicateChapter}
        onDeleteChapter={handleDeleteChapter}
        onCloseChapterTab={handleCloseChapterTab}
        onPreviewRecoveryDraft={handlePreviewRecoveryDraft}
        onApplyRecoveryDraft={handleApplyRecoveryDraft}
        onDiscardRecoveryDraft={handleDiscardRecoveryDraft}
        onSearchQueryChange={handleSearchQueryChange}
        onProjectSearch={handleProjectSearch}
        onRebuildSearchIndex={handleRebuildSearchIndex}
        onSettingsProfileSelect={handleSettingsProfileSelect}
        onSettingsSectionSelect={handleSettingsSectionSelect}
        onSettingsDraftChange={handleSettingsDraftChange}
        onNewSettingsProfile={handleNewSettingsProfile}
        onSaveSettingsProfile={handleSaveSettingsProfile}
        onTestSettingsConnection={handleTestSettingsConnection}
        onMakeSettingsDefault={handleMakeSettingsDefault}
        onDiscoverSettingsModelOptions={handleDiscoverSettingsModelOptions}
        onRefreshPluginRegistry={handleRefreshPluginRegistry}
        onSetPluginEnabled={handleSetPluginEnabled}
        onStudioAssetSelect={handleStudioAssetSelect}
        onStudioContentChange={handleStudioContentChange}
        onStudioWorkflowNodeSelect={handleStudioWorkflowNodeSelect}
        onStudioWorkflowEdgeSelect={handleStudioWorkflowEdgeSelect}
        onStudioWorkflowNodeEdit={handleStudioWorkflowNodeEdit}
        onStudioWorkflowSemanticEdit={handleStudioWorkflowSemanticEdit}
        onStudioWorkflowLayoutChange={handleStudioWorkflowLayoutChange}
        onStudioWorkflowNodeDragCommit={handleStudioWorkflowNodeDragCommit}
        onStudioSave={handleStudioSave}
        onStudioRestoreVersion={handleStudioRestoreVersion}
        onStoryBibleDraftChange={handleStoryBibleDraftChange}
        onStoryBibleFiltersChange={handleStoryBibleFiltersChange}
        onStoryBibleStatusActionRequest={handleStoryBibleStatusActionRequest}
        onStoryBibleStatusActionCancel={handleStoryBibleStatusActionCancel}
        onStoryBibleStatusActionConfirm={handleStoryBibleStatusActionConfirm}
        onCreativeNavigatorModeSelect={creativeProjectFileShell.onNavigatorModeSelect}
        engineeringWorkspace={engineeringWorkspace}
        onEngineeringExpandedPathIdsChange={handleEngineeringExpandedPathIdsChange}
        onRefreshEngineeringTree={() => void engineeringWorkspaceBridge?.refreshEngineeringTree()}
        onWorkbenchSelect={workspaceNavigation.selectWorkbench}
        onOpenEngineeringWorkspace={handleOpenEngineeringWorkspace}
        onSaveStoryBibleDraft={handleSaveStoryBibleDraft}
        onStoryBibleExternalUpdateReload={handleStoryBibleExternalUpdateReload}
        onStoryBibleExternalUpdateContinue={handleStoryBibleExternalUpdateContinue}
        onForeshadowAnalysisOpen={handleOpenForeshadowAnalysis}
        onForeshadowAnalysisChapterToggle={handleToggleForeshadowAnalysisChapter}
        onForeshadowAnalysisStart={handleDetectForeshadows}
        onForeshadowAnalysisCandidateToggle={handleToggleForeshadowAnalysisCandidate}
        onForeshadowAnalysisPreview={handlePreviewForeshadowAnalysisChanges}
        onForeshadowAnalysisBack={handleBackToForeshadowAnalysisCandidates}
        onForeshadowAnalysisConfirm={handleConfirmForeshadowAnalysisChanges}
        onForeshadowAnalysisRetryFailed={handleRetryFailedForeshadowAnalysisChanges}
        onForeshadowAnalysisClose={handleCloseForeshadowAnalysis}
        onCommandExecute={handleCommandExecute}
        onCommandPaletteActiveCommandChange={handleCommandPaletteActiveCommandChange}
        onCommandPaletteClose={handleCommandPaletteClose}
        onCommandPaletteOpen={handleCommandPaletteOpen}
        onCommandPaletteQueryChange={handleCommandPaletteQueryChange}
        onBottomPanelTabSelect={handleBottomPanelTabSelect}
        onSearchResultOpen={handleSearchResultOpen}
        onActivitySelect={handleActivitySelect}
        onSettingsClose={handleSettingsClose}
        navigatorSearchQuery={navigatorSearchQuery}
        onNavigatorSearchQueryChange={setNavigatorSearchQuery}
        onNavigatorExpandedSectionIdsChange={handleNavigatorExpandedSectionIdsChange}
        navigation={workspaceNavigation}
      />
      <ProjectCreateDialog
        open={projectCreateDialogOpen}
        titleInput={projectWorkflow?.projectTitleInput ?? ""}
        folderNameInput={projectWorkflow?.projectFolderNameInput ?? ""}
        {...(projectWorkflow?.selectedParentDisplayName === undefined
          ? {}
          : { selectedParentDisplayName: projectWorkflow.selectedParentDisplayName })}
        {...(projectWorkflow?.creationPreview === undefined
          ? {}
          : { creationPreview: projectWorkflow.creationPreview })}
        busy={projectWorkflow?.status === "creating"}
        {...(projectWorkflow?.feedback === undefined ? {} : { feedback: projectWorkflow.feedback })}
        onTitleChange={handleProjectTitleChange}
        onFolderNameChange={handleProjectFolderNameChange}
        onChooseParentDirectory={handleChooseCreateParentDirectory}
        onCancel={() => setProjectCreateDialogOpen(false)}
        onCreate={handleCreateProject}
      />
    </>
  );
}
