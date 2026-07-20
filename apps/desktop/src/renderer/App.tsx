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
  ConfigStudioPanelProps,
  EditorPreferences,
  ModelSettingsDraft,
  PlainFileEditorProps,
  SettingsPanelSection,
  StoryBibleEditorDraft,
  StoryBibleSummaryProps
} from "@novel-studio/ui";
import { DEFAULT_EDITOR_PREFERENCES } from "@novel-studio/ui";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { createAiWritingWorkflowBridge } from "./ai-writing-workflow-bridge.js";
import { createChapterEditorBridge } from "./chapter-editor-bridge.js";
import { createCommandExecutionBridge } from "./command-execution-bridge.js";
import { createProjectWorkflowBridge } from "./project-workflow-bridge.js";
import { createProjectSearchBridge, openProjectSearchResult } from "./project-search-bridge.js";
import { createStoryBibleBridge } from "./story-bible-bridge.js";
import { createEngineeringWorkspaceBridge } from "./engineering-workspace-bridge.js";
import { createSettingsBridge } from "./settings-bridge.js";
import { createStudioBridge } from "./studio-bridge.js";
import { createPlainFileEditorBridge } from "./plain-file-editor-bridge.js";
import { createAgentRunBridge } from "./agent-run-bridge.js";
import {
  resolveAgentConversationWorkspacePresentation,
  useAgentConversationWorkspace,
  type PendingAgentConversationMainReview
} from "./agent-conversation-workspace.js";
import {
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
import { useShellPreferenceActions } from "./shell-preference-actions.js";
import { createWorkspaceNavigation, type WorkspaceNavigation } from "./workspace-navigation.js";

export function App() {
  const [api] = useState(() => getNovelStudioApi());
  const [chapterBridge] = useState(() =>
    api === undefined ? undefined : createChapterEditorBridge(api)
  );
  const [plainFileBridge] = useState(() =>
    api === undefined ? undefined : createPlainFileEditorBridge(api)
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
  const [fileEditor, setFileEditor] = useState<PlainFileEditorProps | undefined>();
  const [engineeringWorkspace, setEngineeringWorkspace] = useState<EngineeringWorkspaceSnapshot | undefined>(() => engineeringWorkspaceBridge?.getProps().workspace);
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
  const activeProjectId = projectWorkflow?.projectId ?? "prj_minimal_chapter";
  const [pendingMainReview, setPendingMainReview] = useState<
    PendingAgentConversationMainReview | undefined
  >();
  const workspaceNavigationRef = useRef<WorkspaceNavigation | undefined>(undefined);
  const agentConversationWorkspace = useAgentConversationWorkspace({
    api,
    agentRunBridge,
    agentRun,
    projectId: activeProjectId,
    onAgentRunChange: setAgentRun,
    onOpenMainReview: (review) => workspaceNavigationRef.current?.openMainReview(review)
  });
  const agentConversationWorkspacePresentation = resolveAgentConversationWorkspacePresentation(
    agentConversationWorkspace.workspace,
    activeProjectId,
    pendingMainReview
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
  const [editorPreferences, setEditorPreferences] = useState<EditorPreferences>(
    DEFAULT_EDITOR_PREFERENCES
  );
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
    const next = ensureCreativeWorkspaceContext(shellState, projectWorkflow?.projectId);
    if (next !== shellState) setShellState(next);
  }, [projectWorkflow?.projectId, shellState.projectTitle, shellState.workspaceContext.kind]);
  useEffect(() => engineeringWorkspaceBridge?.subscribe((next) => setEngineeringWorkspace(next.workspace)), [engineeringWorkspaceBridge]);

  useLayoutEffect(() => {
    if (agentRunBridge === undefined) {
      return;
    }

    const activeChapterId =
      projectWorkflow?.activeChapterId ?? chapterEditor?.chapter.frontmatter.id;
    const next = agentRunBridge.syncContext({
      projectId: activeProjectId,
      ...(agentConversationWorkspace.selectedConversationId === undefined
        ? {}
        : { conversationId: agentConversationWorkspace.selectedConversationId }),
      ...(activeChapterId === undefined ? {} : { activeChapterId }),
      ...(chapterEditor === undefined ? {} : { chapterEditor }),
      ...(fileEditor === undefined ? {} : { fileEditor }),
      ...(settings === undefined ? {} : { settings })
    });
    setAgentRun(next);
  }, [
    agentConversationWorkspace.selectedConversationId,
    agentRunBridge,
    chapterEditor,
    fileEditor,
    activeProjectId,
    projectWorkflow,
    settings
  ]);

  useEffect(() => {
    if (agentRunBridge === undefined) {
      return;
    }

    return agentRunBridge.subscribe(() => {
      setAgentRun(agentRunBridge.getProps());
    });
  }, [agentRunBridge]);

  useEffect(() => {
    if (agentRunBridge === undefined) {
      return;
    }

    const projectId = projectWorkflow?.projectId ?? "prj_minimal_chapter";
    void agentRunBridge.load(projectId).then(setAgentRun);
  }, [agentRunBridge, projectWorkflow?.projectId]);

  useRendererAppEffects({
    api,
    aiWritingWorkflowBridge,
    chapterBridge,
    storyBibleBridge,
    settingsBridge,
    studioBridge,
    shortcutState,
    setShortcutState,
    setShellState,
    setCommands,
    setOnboardingDismissed,
    setEditorPreferences,
    setAppearancePreferences,
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

  const handleSave = useCallback(() => {
    if (chapterBridge === undefined) {
      return;
    }

    const savingEditor = chapterBridge.beginSave();
    if (savingEditor !== undefined) {
      setChapterEditor(savingEditor);
    }

    void chapterBridge.save().then(setChapterEditor, () => {
      setChapterEditor((current) =>
        current === undefined || current.saveStatus !== "Saving"
          ? current
          : {
              ...current,
              saveStatus: "Unsaved"
            }
      );
    });
  }, [chapterBridge]);

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
    handleDiscardRecoveryDraft
  } = useProjectWorkflowActions({
    api,
    chapterBridge,
    projectWorkflowBridge,
    settingsBridge,
    storyBibleBridge,
    studioBridge,
    setChapterEditor,
    setFileEditor,
    setProjectWorkflow,
    setSettings,
    setShellState,
    setStoryBible,
    setStoryBibleEditor,
    setStudio
  });

  const persistUserPreferences = useCallback(
    (input: UserPreferencesSaveInput) => {
      if (api === undefined) {
        return;
      }

      void api.preferences.save(input);
    },
    [api]
  );
  const {
    handleCreativeNavigatorModeSelect,
    handleNavigatorExpandedSectionIdsChange,
    handleEngineeringExpandedPathIdsChange
  } = useShellPreferenceActions(setShellState, persistUserPreferences);
  const handleOpenEngineeringWorkspace = useCallback(() => {
    if (api === undefined || engineeringWorkspaceBridge === undefined) {
      return;
    }

    void engineeringWorkspaceBridge
      .openEngineeringWorkspace()
      .then(async (next) => {
        if (next.status !== "ready" || next.workspace === undefined) {
          return;
        }
        setShellState(await api.getShellState());
      })
      .catch(() => undefined);
  }, [api, engineeringWorkspaceBridge]);

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

      void commandExecutionBridge.execute(commandId).then((result) => {
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
      });
    },
    [commandExecutionBridge, persistUserPreferences]
  );

  const decorateFileEditor = useCallback(
    (nextFileEditor: PlainFileEditorProps | undefined): PlainFileEditorProps | undefined => {
      if (nextFileEditor === undefined) {
        return undefined;
      }

      return {
        ...nextFileEditor,
        editorPreferences,
        ...(nextFileEditor.readOnlyReason === undefined
          ? {
              onContentChange: (content: string) => {
                const updated = plainFileBridge?.updateContent(content);
                setFileEditor(decorateFileEditor(updated));
              },
              onSave: () => {
                const saving = plainFileBridge?.beginSave();
                if (saving !== undefined) {
                  setFileEditor(decorateFileEditor(saving));
                }
                void plainFileBridge?.save().then((saved) => {
                  setFileEditor(decorateFileEditor(saved));
                });
              }
            }
          : {}),
        onClose: () => {
          plainFileBridge?.clear();
          setFileEditor(undefined);
          if (
            chapterBridge !== undefined &&
            projectWorkflowBridge?.getProps().activeChapterId !== undefined
          ) {
            void chapterBridge.load().then(setChapterEditor);
          }
        },
        onReloadFromDisk: () => {
          nextFileEditor.onReloadFromDisk?.();
          setFileEditor(decorateFileEditor(plainFileBridge?.getProps()));
        },
        onKeepDraft: () => {
          nextFileEditor.onKeepDraft?.();
          setFileEditor(decorateFileEditor(plainFileBridge?.getProps()));
        },
        onEditorPreferencesChange: (preferences: EditorPreferences) => {
          setEditorPreferences(preferences);
          persistUserPreferences({ editor: preferences });
        },
        onFocusModeToggle: () => handleCommandExecute("workspace.toggle-focus-mode")
      };
    },
    [
      chapterBridge,
      editorPreferences,
      handleCommandExecute,
      persistUserPreferences,
      plainFileBridge,
      projectWorkflowBridge
    ]
  );

  const workspaceNavigation = createWorkspaceNavigation({
    getWorkspaceContext: () => shellState.workspaceContext,
    projectWorkflowBridge,
    chapterEditorBridge: chapterBridge,
    storyBibleBridge,
    plainFileBridge,
    setShellState,
    setProjectWorkflow,
    setChapterEditor,
    setFileEditor: (next) =>
      setFileEditor(next === undefined ? undefined : decorateFileEditor(next)),
    setStoryBibleEditor,
    setMainReview: (review: AgentConversationMainReview) =>
      setPendingMainReview({ projectId: activeProjectId, review }),
    openCreativeProject: handleOpenProject,
    openEngineeringWorkspace: handleOpenEngineeringWorkspace,
    createCreativeProject: handleCreateProject,
    engineeringWorkspaceBridge,
    setEngineeringWorkspace,
    onNavigationFeedback: (message) =>
      setProjectWorkflow((current) =>
        current === undefined ? current : { ...current, feedback: { kind: "info", message } }
      )
  });
  workspaceNavigationRef.current = workspaceNavigation;
  const handleActivitySelect = useCallback(
    (activityId: ActivityId) => {
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

  const handleStoryBibleDraftChange = useCallback(
    (draft: Partial<StoryBibleEditorDraft>) => {
      if (storyBibleBridge === undefined) {
        return;
      }

      setStoryBibleEditor(storyBibleBridge.updateDraft(draft));
    },
    [storyBibleBridge]
  );

  const handleSaveStoryBibleDraft = useCallback(() => {
    if (storyBibleBridge === undefined) {
      return;
    }

    setStoryBibleEditor(storyBibleBridge.beginSave());
    void storyBibleBridge.saveDraft().then((nextStoryBibleEditor) => {
      setStoryBibleEditor(nextStoryBibleEditor);
      setStoryBible(storyBibleBridge.getProps());
    });
  }, [storyBibleBridge]);

  const handleSettingsProfileSelect = useCallback(
    (profileId: string) => {
      if (settingsBridge === undefined) {
        return;
      }

      setSettings(settingsBridge.selectProfile(profileId));
      void settingsBridge.discoverModelOptions(profileId).then(setSettings);
    },
    [settingsBridge]
  );

  const handleDiscoverSettingsModelOptions = useCallback(
    (profileId: string) => {
      if (settingsBridge === undefined) {
        return;
      }

      void settingsBridge.discoverModelOptions(profileId).then(setSettings);
    },
    [settingsBridge]
  );

  const handleSettingsSectionSelect = useCallback(
    (section: SettingsPanelSection) => {
      if (settingsBridge === undefined) {
        return;
      }

      setSettings(settingsBridge.selectSection(section));
      if (section === "usage") {
        const pending = settingsBridge.loadAgentUsage();
        setSettings(settingsBridge.getProps());
        void pending.then(setSettings);
      }
    },
    [settingsBridge]
  );

  const handleAppearancePreferencesChange = useCallback(
    (preferences: UserAppearancePreferences) => {
      setAppearancePreferences(preferences);
      setAppearanceFeedback(undefined);
      void persistAppearancePreferences(api?.preferences, preferences).then(setAppearanceFeedback);
    },
    [api]
  );

  const handleSettingsDraftChange = useCallback(
    (draft: Partial<ModelSettingsDraft>) => {
      if (settingsBridge === undefined) {
        return;
      }

      setSettings(settingsBridge.updateDraft(draft));
    },
    [settingsBridge]
  );

  const handleNewSettingsProfile = useCallback(() => {
    if (settingsBridge === undefined) {
      return;
    }

    setSettings(settingsBridge.newProfile());
  }, [settingsBridge]);

  const handleSaveSettingsProfile = useCallback(() => {
    if (settingsBridge === undefined) {
      return;
    }

    setSettings(settingsBridge.beginSave());
    void settingsBridge.saveDraft().then(setSettings);
  }, [settingsBridge]);

  const handleTestSettingsConnection = useCallback(
    (profileId: string) => {
      if (settingsBridge === undefined) {
        return;
      }

      setSettings(settingsBridge.beginTestConnection(profileId));
      void settingsBridge.testConnection(profileId).then(setSettings);
    },
    [settingsBridge]
  );

  const handleMakeSettingsDefault = useCallback(
    (profileId: string) => {
      if (settingsBridge === undefined) {
        return;
      }

      setSettings(settingsBridge.beginSave());
      void settingsBridge.makeDefault(profileId).then(setSettings);
    },
    [settingsBridge]
  );

  const handleRefreshPluginRegistry = useCallback(() => {
    if (settingsBridge === undefined) {
      return;
    }

    void settingsBridge.loadPlugins().then(setSettings);
  }, [settingsBridge]);

  const handleSetPluginEnabled = useCallback(
    (pluginId: string, enabled: boolean) => {
      if (settingsBridge === undefined) {
        return;
      }

      void settingsBridge.setPluginEnabled(pluginId, enabled).then(setSettings);
    },
    [settingsBridge]
  );

  const agentUsageSettingsActions = useAgentUsageSettingsActions(settingsBridge, setSettings);

  const handleStudioAssetSelect = useCallback<NonNullable<ConfigStudioPanelProps["onAssetSelect"]>>(
    (assetType, assetId) => {
      if (studioBridge === undefined) {
        return;
      }

      void studioBridge.selectAsset(assetType, assetId).then(setStudio);
    },
    [studioBridge]
  );

  const handleStudioContentChange = useCallback<
    NonNullable<ConfigStudioPanelProps["onContentChange"]>
  >(
    (nextContent) => {
      if (studioBridge === undefined) {
        return;
      }

      setStudio(studioBridge.updateContent(nextContent));
    },
    [studioBridge]
  );

  const handleStudioWorkflowNodeSelect = useCallback<
    NonNullable<ConfigStudioPanelProps["onWorkflowNodeSelect"]>
  >(
    (nodeId) => {
      if (studioBridge === undefined) {
        return;
      }

      setStudio(studioBridge.selectWorkflowNode(nodeId));
    },
    [studioBridge]
  );

  const handleStudioWorkflowEdgeSelect = useCallback<
    NonNullable<ConfigStudioPanelProps["onWorkflowEdgeSelect"]>
  >(
    (edgeId) => {
      if (studioBridge === undefined) {
        return;
      }

      setStudio(studioBridge.selectWorkflowEdge(edgeId));
    },
    [studioBridge]
  );

  const handleStudioWorkflowNodeEdit = useCallback<
    NonNullable<ConfigStudioPanelProps["onWorkflowNodeEdit"]>
  >(
    (edit) => {
      if (studioBridge === undefined) {
        return;
      }

      setStudio(studioBridge.applyWorkflowNodeEdit(edit));
    },
    [studioBridge]
  );

  const handleStudioWorkflowSemanticEdit = useCallback<
    NonNullable<ConfigStudioPanelProps["onWorkflowSemanticEdit"]>
  >(
    (edit) => {
      if (studioBridge === undefined) {
        return;
      }

      setStudio(studioBridge.applyWorkflowSemanticEdit(edit));
    },
    [studioBridge]
  );

  const handleStudioWorkflowLayoutChange = useCallback<
    NonNullable<ConfigStudioPanelProps["onWorkflowLayoutChange"]>
  >(
    (edit) => {
      if (studioBridge === undefined) {
        return;
      }

      setStudio(studioBridge.updateWorkflowGraphLayout(edit));
    },
    [studioBridge]
  );

  const handleStudioWorkflowNodeDragCommit = useCallback<
    NonNullable<ConfigStudioPanelProps["onWorkflowNodeDragCommit"]>
  >(
    (edit) => {
      if (studioBridge === undefined) {
        return;
      }

      setStudio(studioBridge.commitWorkflowNodeDrag(edit));
    },
    [studioBridge]
  );

  const handleStudioSave = useCallback<NonNullable<ConfigStudioPanelProps["onSave"]>>(() => {
    if (studioBridge === undefined) {
      return;
    }

    setStudio(studioBridge.beginSave());
    void studioBridge.save().then(setStudio);
  }, [studioBridge]);

  const handleStudioRestoreVersion = useCallback<
    NonNullable<ConfigStudioPanelProps["onRestoreVersion"]>
  >(
    (versionId) => {
      if (studioBridge === undefined) {
        return;
      }

      setStudio(studioBridge.beginRestore());
      void studioBridge.restoreVersion(versionId).then(setStudio);
    },
    [studioBridge]
  );

  const interactiveChapterEditor =
    chapterEditor === undefined
      ? undefined
      : {
          ...chapterEditor,
          runtime: createChapterEditorRuntime(chapterEditor, chapterSelection),
          editorPreferences,
          onBodyChange: handleBodyChange,
          onSelectionChange: handleSelectionChange,
          onEditorPreferencesChange: (preferences: EditorPreferences) => {
            setEditorPreferences(preferences);
            persistUserPreferences({ editor: preferences });
          },
          onFocusModeToggle: () => handleCommandExecute("workspace.toggle-focus-mode"),
          onSelectionReviewAccept: handleApplyAiSuggestion,
          onSelectionReviewReject: handleRejectSelectionReview,
          onSelectionReviewUndo: handleUndoSelectionReview,
          onSelectionAiPreview: handleSelectionAiPreview,
          onSave: handleSave,
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
          onEditorPreferencesChange: (preferences: EditorPreferences) => {
            setEditorPreferences(preferences);
            persistUserPreferences({ editor: preferences });
          },
          usage:
            settings.usage === undefined
              ? undefined
              : {
                  ...settings.usage,
                  ...agentUsageSettingsActions
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
    <RendererWorkspaceShell
      appearancePreferences={appearancePreferences}
      aiWritingWorkflow={aiWritingWorkflow}
      agentConversationWorkspace={agentConversationWorkspacePresentation.workspace}
      projectWorkflow={projectWorkflow}
      projectSearch={projectSearch}
      settings={interactiveSettings}
      studio={studio}
      chapterEditor={interactiveChapterEditor}
      fileEditor={fileEditor}
      onboarding={onboarding}
      storyBible={storyBible}
      storyBibleEditor={storyBibleEditor}
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
      onCreativeNavigatorModeSelect={handleCreativeNavigatorModeSelect}
      engineeringWorkspace={engineeringWorkspace}
      onEngineeringExpandedPathIdsChange={handleEngineeringExpandedPathIdsChange}
      onRefreshEngineeringTree={() => void engineeringWorkspaceBridge?.refreshEngineeringTree()}
      onWorkbenchSelect={workspaceNavigation.selectWorkbench}
      onOpenEngineeringWorkspace={handleOpenEngineeringWorkspace}
      onSaveStoryBibleDraft={handleSaveStoryBibleDraft}
      onCommandExecute={handleCommandExecute}
      onCommandPaletteActiveCommandChange={handleCommandPaletteActiveCommandChange}
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
  );
}
