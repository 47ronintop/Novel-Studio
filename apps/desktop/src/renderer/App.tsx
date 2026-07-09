import type {
  ActivityId,
  ApplicationCommand,
  ApplicationCommandId,
  DesktopShellState,
  ProjectSearchResultItem,
  UserPreferencesSaveInput
} from "@novel-studio/application";
import type {
  ChapterEditorSelection,
  ChapterEditorProps,
  CommandPaletteFeedback,
  ConfigStudioPanelProps,
  EditorPreferences,
  ModelSettingsAppearancePreferences,
  ModelSettingsDraft,
  PlainFileEditorProps,
  SettingsPanelSection,
  StoryBibleEditorDraft,
  StoryBibleEditorKind,
  StoryBibleSummaryProps
} from "@novel-studio/ui";
import { DEFAULT_EDITOR_PREFERENCES } from "@novel-studio/ui";
import { useCallback, useState } from "react";

import { createAiWritingWorkflowBridge } from "./ai-writing-workflow-bridge.js";
import { createChapterEditorBridge } from "./chapter-editor-bridge.js";
import { createCommandExecutionBridge } from "./command-execution-bridge.js";
import { createProjectWorkflowBridge } from "./project-workflow-bridge.js";
import { createProjectSearchBridge } from "./project-search-bridge.js";
import { createStoryBibleBridge } from "./story-bible-bridge.js";
import { createSettingsBridge } from "./settings-bridge.js";
import { createStudioBridge } from "./studio-bridge.js";
import { createPlainFileEditorBridge } from "./plain-file-editor-bridge.js";
import {
  createChapterEditorRuntime,
  createChapterEditorSelectionCommand,
  createOnboardingProps,
  getNovelStudioApi,
  rendererCommands,
  rendererShellState,
  shellPreferencesFromState
} from "./app-shell-support.js";
import { useRendererAppEffects } from "./renderer-app-effects.js";
import { RendererWorkspaceShell } from "./renderer-workspace-shell.js";
import { useProjectWorkflowActions } from "./project-workflow-actions.js";

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
  const [storyBibleBridge] = useState(() =>
    api === undefined ? undefined : createStoryBibleBridge(api)
  );
  const [settingsBridge] = useState(() =>
    api === undefined ? undefined : createSettingsBridge(api)
  );
  const [aiWritingWorkflowBridge] = useState(() =>
    api === undefined ? undefined : createAiWritingWorkflowBridge(api)
  );
  const [studioBridge] = useState(() => (api === undefined ? undefined : createStudioBridge(api)));
  const [commandExecutionBridge] = useState(() =>
    api === undefined ? undefined : createCommandExecutionBridge(api)
  );
  const [shellState, setShellState] = useState<DesktopShellState>(rendererShellState);
  const [commands, setCommands] = useState<readonly ApplicationCommand[]>(rendererCommands);
  const [chapterEditor, setChapterEditor] = useState<ChapterEditorProps | undefined>();
  const [fileEditor, setFileEditor] = useState<PlainFileEditorProps | undefined>();
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
  const [appearancePreferences, setAppearancePreferences] = useState<
    Omit<ModelSettingsAppearancePreferences, "editor">
  >({
    theme: "dark",
    density: "compact"
  });

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
    refreshProjectWorkflow,
    handleProjectRootChange,
    handleOpenProject,
    handleCreateProject,
    handleInitializeProject,
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

  const handleActivitySelect = useCallback(
    (activityId: ActivityId) => {
      setShellState((current) => {
        const next = {
          ...current,
          activeActivity: activityId
        };
        persistUserPreferences({ shell: shellPreferencesFromState(next) });
        return next;
      });
    },
    [persistUserPreferences]
  );

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

  const handleNavigatorExpandedSectionIdsChange = useCallback(
    (sectionIds: readonly string[]) => {
      setShellState((current) => {
        const next = {
          ...current,
          navigatorExpandedSectionIds: [...sectionIds]
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

        setShellState(result.value);
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
        },
        onEditorPreferencesChange: (preferences: EditorPreferences) => {
          setEditorPreferences(preferences);
          persistUserPreferences({ editor: preferences });
        },
        onFocusModeToggle: () => handleCommandExecute("workspace.toggle-focus-mode")
      };
    },
    [editorPreferences, handleCommandExecute, persistUserPreferences, plainFileBridge]
  );

  const handleOpenFile = useCallback(
    (path: string) => {
      const projectRoot = projectWorkflowBridge?.getProps().projectRootInput.trim();
      if (plainFileBridge === undefined || projectRoot === undefined || projectRoot.length === 0) {
        return;
      }

      void plainFileBridge.openFile(projectRoot, path).then((nextFileEditor) => {
        setFileEditor(decorateFileEditor(nextFileEditor));
        setChapterEditor(undefined);
        setShellState((current) => ({
          ...current,
          activeActivity: "workspace"
        }));
      });
    },
    [decorateFileEditor, plainFileBridge, projectWorkflowBridge]
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
      if (result.sourceRef.kind === "chapter") {
        setShellState((current) => ({
          ...current,
          activeActivity: "workspace"
        }));
        if (projectWorkflowBridge !== undefined) {
          void projectWorkflowBridge
            .selectChapter(result.sourceRef.id)
            .then(refreshProjectWorkflow);
        }
        return;
      }

      setShellState((current) => ({
        ...current,
        activeActivity: "storyBible"
      }));
      if (storyBibleBridge !== undefined) {
        setStoryBibleEditor(storyBibleBridge.selectEntry(result.sourceRef.id));
      }
    },
    [projectWorkflowBridge, refreshProjectWorkflow, storyBibleBridge]
  );

  const handleAiInstructionChange = useCallback(
    (instruction: string) => {
      if (aiWritingWorkflowBridge === undefined) {
        return;
      }

      setAiWritingWorkflow(aiWritingWorkflowBridge.setInstruction(instruction));
    },
    [aiWritingWorkflowBridge]
  );

  const handleGenerateAiSuggestion = useCallback(() => {
    if (aiWritingWorkflowBridge === undefined || aiWritingWorkflow === undefined) {
      return;
    }

    const instruction =
      aiWritingWorkflow.instruction.trim().length === 0
        ? "Continue the active chapter."
        : aiWritingWorkflow.instruction;
    setAiWritingWorkflow(aiWritingWorkflowBridge.beginStreamingGenerate(instruction));
    void aiWritingWorkflowBridge
      .generateStreamingSuggestion(instruction, setAiWritingWorkflow)
      .then((nextAiWritingWorkflow) => {
        setAiWritingWorkflow(nextAiWritingWorkflow);
        const diffPreview = nextAiWritingWorkflow.diffPreview;
        if (diffPreview === undefined) {
          return;
        }

        setChapterEditor((current) =>
          current === undefined
            ? current
            : {
                ...current,
                diffPreview
              }
        );
      });
  }, [aiWritingWorkflow, aiWritingWorkflowBridge]);

  const handleSelectionAiPreview = useCallback(
    (commandId: string) => {
      if (
        aiWritingWorkflowBridge === undefined ||
        aiWritingWorkflow === undefined ||
        chapterEditor === undefined ||
        chapterSelection === undefined
      ) {
        return;
      }

      const command = createChapterEditorSelectionCommand(chapterEditor, {
        commandId,
        selection: chapterSelection
      });
      if (command === undefined || command.selection.collapsed) {
        return;
      }

      const instruction =
        aiWritingWorkflow.instruction.trim().length === 0
          ? "Rewrite the selected text."
          : aiWritingWorkflow.instruction;
      const selectedText = chapterEditor.chapter.body.slice(
        command.selection.startOffset,
        command.selection.endOffset
      );

      setAiWritingWorkflow(aiWritingWorkflowBridge.beginGenerate(instruction));
      void aiWritingWorkflowBridge
        .generateSelectionPreview({
          instruction,
          command,
          selectedText
        })
        .then((nextAiWritingWorkflow) => {
          setAiWritingWorkflow(nextAiWritingWorkflow);
          const diffPreview = nextAiWritingWorkflow.diffPreview;
          if (diffPreview === undefined) {
            return;
          }

          setChapterEditor((current) =>
            current === undefined
              ? current
              : {
                  ...current,
                  diffPreview,
                  ...(nextAiWritingWorkflow.selectionReview === undefined
                    ? {}
                    : { selectionReview: nextAiWritingWorkflow.selectionReview })
                }
          );
        });
    },
    [aiWritingWorkflow, aiWritingWorkflowBridge, chapterEditor, chapterSelection]
  );

  const handleApplyAiSuggestion = useCallback(() => {
    if (aiWritingWorkflowBridge === undefined) {
      return;
    }

    void aiWritingWorkflowBridge.applySuggestion().then((nextChapterEditor) => {
      setChapterEditor(nextChapterEditor);
      setAiWritingWorkflow(aiWritingWorkflowBridge.getProps());
    });
  }, [aiWritingWorkflowBridge]);

  const handleRejectSelectionReview = useCallback(() => {
    if (aiWritingWorkflowBridge === undefined) {
      return;
    }

    const nextAiWritingWorkflow = aiWritingWorkflowBridge.rejectSelectionPreview();
    setAiWritingWorkflow(nextAiWritingWorkflow);
    setChapterEditor((current) => {
      if (current === undefined) {
        return current;
      }
      const { selectionReview, ...withoutSelectionReview } = current;
      void selectionReview;
      return nextAiWritingWorkflow.selectionReview === undefined
        ? withoutSelectionReview
        : {
            ...withoutSelectionReview,
            selectionReview: nextAiWritingWorkflow.selectionReview
          };
    });
  }, [aiWritingWorkflowBridge]);

  const handleUndoSelectionReview = useCallback(() => {
    if (aiWritingWorkflowBridge === undefined) {
      return;
    }

    const nextAiWritingWorkflow = aiWritingWorkflowBridge.undoSelectionPreviewRejection();
    setAiWritingWorkflow(nextAiWritingWorkflow);
    setChapterEditor((current) => {
      if (current === undefined) {
        return current;
      }
      const { selectionReview, ...withoutSelectionReview } = current;
      void selectionReview;
      return nextAiWritingWorkflow.selectionReview === undefined
        ? withoutSelectionReview
        : {
            ...withoutSelectionReview,
            selectionReview: nextAiWritingWorkflow.selectionReview
          };
    });
  }, [aiWritingWorkflowBridge]);

  const handleCancelAiStreaming = useCallback(() => {
    if (aiWritingWorkflowBridge === undefined) {
      return;
    }

    setAiWritingWorkflow(aiWritingWorkflowBridge.cancelStreaming());
  }, [aiWritingWorkflowBridge]);

  const handleAiModelSelect = useCallback(
    (modelName: string) => {
      if (aiWritingWorkflowBridge === undefined) {
        return;
      }

      void aiWritingWorkflowBridge
        .selectDiscoveredModel(modelName)
        .then((nextAiWritingWorkflow) => {
          setAiWritingWorkflow(nextAiWritingWorkflow);
          if (settingsBridge !== undefined) {
            void settingsBridge.load().then(setSettings);
          }
        });
    },
    [aiWritingWorkflowBridge, settingsBridge]
  );

  const handleStoryBibleKindSelect = useCallback(
    (kind: StoryBibleEditorKind) => {
      if (storyBibleBridge === undefined) {
        return;
      }

      setStoryBibleEditor(storyBibleBridge.selectKind(kind));
    },
    [storyBibleBridge]
  );

  const handleStoryBibleEntrySelect = useCallback(
    (entryId: string) => {
      if (storyBibleBridge === undefined) {
        return;
      }

      setStoryBibleEditor(storyBibleBridge.selectEntry(entryId));
    },
    [storyBibleBridge]
  );

  const handleTimelineEntryOpen = useCallback(
    (entryId: string) => {
      setShellState((current) => ({
        ...current,
        activeActivity: "storyBible"
      }));
      if (storyBibleBridge === undefined) {
        return;
      }

      setStoryBibleEditor(storyBibleBridge.selectEntry(entryId));
    },
    [storyBibleBridge]
  );

  const handleStoryBibleDraftChange = useCallback(
    (draft: Partial<StoryBibleEditorDraft>) => {
      if (storyBibleBridge === undefined) {
        return;
      }

      setStoryBibleEditor(storyBibleBridge.updateDraft(draft));
    },
    [storyBibleBridge]
  );

  const handleNewStoryBibleDraft = useCallback(() => {
    if (storyBibleBridge === undefined || storyBibleEditor === undefined) {
      return;
    }

    setStoryBibleEditor(storyBibleBridge.selectKind(storyBibleEditor.activeKind));
  }, [storyBibleBridge, storyBibleEditor]);

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
    },
    [settingsBridge]
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
          editorPreferences,
          appearancePreferences: {
            ...appearancePreferences,
            editor: editorPreferences
          },
          onAppearancePreferencesChange: (
            preferences: Omit<ModelSettingsAppearancePreferences, "editor">
          ) => {
            setAppearancePreferences(preferences);
            persistUserPreferences({ appearance: preferences });
          },
          onEditorPreferencesChange: (preferences: EditorPreferences) => {
            setEditorPreferences(preferences);
            persistUserPreferences({ editor: preferences });
          }
        };
  const onboarding = createOnboardingProps({
    dismissed: onboardingDismissed,
    shellState,
    chapterEditor,
    projectWorkflow,
    onCreateExampleProject: handleCreateExampleProject,
    onCreateProject: handleCreateProject,
    onOpenProject: handleOpenProject,
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
      aiWritingWorkflow={aiWritingWorkflow}
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
      onRejectSelectionReview={handleRejectSelectionReview}
      onUndoSelectionReview={handleUndoSelectionReview}
      onCancelAiStreaming={handleCancelAiStreaming}
      onProjectRootChange={handleProjectRootChange}
      onOpenProject={handleOpenProject}
      onCreateProject={handleCreateProject}
      onInitializeProject={handleInitializeProject}
      onCreateChapter={handleCreateChapter}
      onOpenFile={handleOpenFile}
      onRenameChapter={handleRenameChapter}
      onDuplicateChapter={handleDuplicateChapter}
      onDeleteChapter={handleDeleteChapter}
      onSelectChapter={handleSelectChapter}
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
      onStoryBibleKindSelect={handleStoryBibleKindSelect}
      onStoryBibleEntrySelect={handleStoryBibleEntrySelect}
      onStoryBibleDraftChange={handleStoryBibleDraftChange}
      onNewStoryBibleDraft={handleNewStoryBibleDraft}
      onSaveStoryBibleDraft={handleSaveStoryBibleDraft}
      onCommandExecute={handleCommandExecute}
      onCommandPaletteActiveCommandChange={handleCommandPaletteActiveCommandChange}
      onCommandPaletteOpen={handleCommandPaletteOpen}
      onCommandPaletteQueryChange={handleCommandPaletteQueryChange}
      onBottomPanelTabSelect={handleBottomPanelTabSelect}
      onSearchResultOpen={handleSearchResultOpen}
      onTimelineEntryOpen={handleTimelineEntryOpen}
      onActivitySelect={handleActivitySelect}
      navigatorSearchQuery={navigatorSearchQuery}
      onNavigatorSearchQueryChange={setNavigatorSearchQuery}
      onNavigatorExpandedSectionIdsChange={handleNavigatorExpandedSectionIdsChange}
    />
  );
}
