import type {
  ActivityId,
  ApplicationCommand,
  ApplicationCommandId,
  DesktopShellState,
  NovelStudioApi,
  ProjectSearchResultItem,
  UserPreferencesSaveInput
} from "@novel-studio/application";
import type {
  AiWritingWorkflowProps,
  ChapterEditorRuntimeProps,
  ChapterEditorProps,
  CommandPaletteFeedback,
  ConfigStudioPanelProps,
  ModelSettingsDraft,
  ModelSettingsPanelProps,
  OnboardingProps,
  ProjectWorkflowProps,
  ProjectSearchProps,
  StoryBibleEditorDraft,
  StoryBibleEditorKind,
  StoryBibleEditorProps,
  StoryBibleSummaryProps
} from "@novel-studio/ui";
import { WorkspaceShell } from "@novel-studio/ui";
import { useCallback, useEffect, useState } from "react";

import { createAiWritingWorkflowBridge } from "./ai-writing-workflow-bridge.js";
import { createChapterEditorBridge } from "./chapter-editor-bridge.js";
import { createCommandExecutionBridge } from "./command-execution-bridge.js";
import { createProjectWorkflowBridge } from "./project-workflow-bridge.js";
import { createProjectSearchBridge } from "./project-search-bridge.js";
import { createStoryBibleBridge } from "./story-bible-bridge.js";
import { createSettingsBridge } from "./settings-bridge.js";
import { createStudioBridge } from "./studio-bridge.js";
import { reduceRendererShortcut } from "./shortcuts.js";
import { createTextareaChapterEditorRuntimeProps } from "./editor-runtime.js";

declare global {
  interface Window {
    novelStudio?: NovelStudioApi;
  }
}

const rendererShellState: DesktopShellState = {
  projectTitle: "未打开项目",
  activeActivity: "workspace",
  navigatorCollapsed: false,
  inspectorCollapsed: false,
  bottomPanelVisible: true,
  activeBottomPanelTab: "工作流运行",
  workspaceLayout: {
    splitView: false,
    navigatorWidth: 260,
    inspectorWidth: 320,
    bottomPanelHeight: 220
  },
  commandPaletteOpen: false,
  saveStatus: "Saved",
  navigatorSections: [
    { id: "chapters", title: "章节", itemCount: 0 },
    { id: "characters", title: "人物", itemCount: 0 },
    { id: "world", title: "世界观", itemCount: 0 },
    { id: "outline", title: "大纲", itemCount: 0 },
    { id: "timeline", title: "时间线", itemCount: 0 },
    { id: "memories", title: "记忆", itemCount: 0 },
    { id: "prompts", title: "提示词", itemCount: 0 },
    { id: "agents", title: "Agent", itemCount: 0 },
    { id: "workflows", title: "工作流", itemCount: 0 }
  ],
  bottomPanelTabs: ["工作流运行", "问题", "搜索", "日志"]
};

const rendererCommands: readonly ApplicationCommand[] = [
  {
    id: "workspace.open-command-palette",
    title: "打开命令面板",
    scope: "workspace",
    riskLevel: "safe",
    defaultShortcut: "Ctrl/Cmd+K"
  },
  {
    id: "workspace.toggle-navigator",
    title: "切换项目导航",
    scope: "workspace",
    riskLevel: "safe",
    defaultShortcut: "Ctrl/Cmd+B"
  },
  {
    id: "workspace.toggle-inspector",
    title: "切换检查器",
    scope: "workspace",
    riskLevel: "safe",
    defaultShortcut: "Ctrl/Cmd+Shift+I"
  },
  {
    id: "workspace.toggle-bottom-panel",
    title: "切换底部面板",
    scope: "workspace",
    riskLevel: "safe",
    defaultShortcut: "Ctrl/Cmd+J"
  },
  {
    id: "workspace.toggle-split-view",
    title: "切换拆分视图",
    scope: "workspace",
    riskLevel: "safe",
    defaultShortcut: "Ctrl/Cmd+\\"
  },
  {
    id: "workspace.narrow-navigator",
    title: "收窄项目导航",
    scope: "workspace",
    riskLevel: "safe",
    defaultShortcut: "Ctrl/Cmd+Alt+["
  },
  {
    id: "workspace.widen-navigator",
    title: "加宽项目导航",
    scope: "workspace",
    riskLevel: "safe",
    defaultShortcut: "Ctrl/Cmd+Alt+]"
  },
  {
    id: "workspace.narrow-inspector",
    title: "收窄检查器",
    scope: "workspace",
    riskLevel: "safe",
    defaultShortcut: "Ctrl/Cmd+Alt+Shift+["
  },
  {
    id: "workspace.widen-inspector",
    title: "加宽检查器",
    scope: "workspace",
    riskLevel: "safe",
    defaultShortcut: "Ctrl/Cmd+Alt+Shift+]"
  }
];

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
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const result = reduceRendererShortcut(shortcutState, event);

      if (result.handled) {
        event.preventDefault();
        setShortcutState(result.state);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [shortcutState]);

  useEffect(() => {
    if (api === undefined) {
      return;
    }

    let active = true;

    void api.getShellState().then((nextShellState) => {
      if (active) {
        setShellState(nextShellState);
      }
    });
    void api.commands.list().then((nextCommands) => {
      if (active) {
        setCommands(nextCommands);
      }
    });
    void api.preferences.load().then((result) => {
      if (!active || !result.ok) {
        return;
      }

      setOnboardingDismissed(result.value.onboarding.dismissed);
      setShellState((current) => applyShellPreferences(current, result.value.shell));
    });

    return () => {
      active = false;
    };
  }, [api]);

  useEffect(() => {
    if (chapterBridge === undefined) {
      return;
    }

    let active = true;

    void chapterBridge.load().then((nextChapterEditor) => {
      if (active) {
        setChapterEditor(nextChapterEditor);
      }
    });

    return () => {
      active = false;
    };
  }, [chapterBridge]);

  useEffect(() => {
    if (storyBibleBridge === undefined) {
      return;
    }

    let active = true;

    void storyBibleBridge.load().then((nextStoryBible) => {
      if (active) {
        setStoryBible(nextStoryBible);
        setStoryBibleEditor(storyBibleBridge.getEditorProps());
      }
    });

    return () => {
      active = false;
    };
  }, [storyBibleBridge]);

  useEffect(() => {
    if (settingsBridge === undefined) {
      return;
    }

    let active = true;

    void settingsBridge.load().then((nextSettings) => {
      if (active) {
        setSettings(nextSettings);
      }
    });

    return () => {
      active = false;
    };
  }, [settingsBridge]);

  useEffect(() => {
    if (studioBridge === undefined) {
      return;
    }

    let active = true;

    void studioBridge.load().then((nextStudio) => {
      if (active) {
        setStudio(nextStudio);
      }
    });

    return () => {
      active = false;
    };
  }, [studioBridge]);

  const handleBodyChange = useCallback(
    (nextBody: string) => {
      if (chapterBridge === undefined) {
        return;
      }

      void chapterBridge.edit(nextBody).then(setChapterEditor);
    },
    [chapterBridge]
  );

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

  const refreshProjectWorkflow = useCallback(
    async (nextWorkflow: NonNullable<typeof projectWorkflow>) => {
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
    [api, chapterBridge, settingsBridge, storyBibleBridge, studioBridge]
  );

  const handleProjectRootChange = useCallback(
    (projectRoot: string) => {
      if (projectWorkflowBridge === undefined) {
        return;
      }

      setProjectWorkflow(projectWorkflowBridge.setProjectRootInput(projectRoot));
    },
    [projectWorkflowBridge]
  );

  const handleOpenProject = useCallback(() => {
    if (projectWorkflowBridge === undefined) {
      return;
    }

    setProjectWorkflow({
      ...projectWorkflowBridge.getProps(),
      status: "opening"
    });
    void projectWorkflowBridge.openProject().then(refreshProjectWorkflow);
  }, [projectWorkflowBridge, refreshProjectWorkflow]);

  const handleCreateProject = useCallback(() => {
    if (projectWorkflowBridge === undefined) {
      return;
    }

    setProjectWorkflow({
      ...projectWorkflowBridge.getProps(),
      status: "creating"
    });
    void projectWorkflowBridge.createProject().then(refreshProjectWorkflow);
  }, [projectWorkflowBridge, refreshProjectWorkflow]);

  const handleCreateExampleProject = useCallback(() => {
    if (projectWorkflowBridge === undefined) {
      return;
    }

    setProjectWorkflow({
      ...projectWorkflowBridge.getProps(),
      status: "creating"
    });
    void projectWorkflowBridge.createExampleProject().then(refreshProjectWorkflow);
  }, [projectWorkflowBridge, refreshProjectWorkflow]);

  const handleCreateChapter = useCallback(() => {
    if (projectWorkflowBridge === undefined) {
      return;
    }

    void projectWorkflowBridge.createChapter().then(refreshProjectWorkflow);
  }, [projectWorkflowBridge, refreshProjectWorkflow]);

  const handleSelectChapter = useCallback(
    (chapterId: string) => {
      if (projectWorkflowBridge === undefined) {
        return;
      }

      void projectWorkflowBridge.selectChapter(chapterId).then(refreshProjectWorkflow);
    },
    [projectWorkflowBridge, refreshProjectWorkflow]
  );

  const handleCloseChapterTab = useCallback(
    (chapterId: string) => {
      if (projectWorkflowBridge === undefined) {
        return;
      }

      void projectWorkflowBridge.closeChapterTab(chapterId).then(refreshProjectWorkflow);
    },
    [projectWorkflowBridge, refreshProjectWorkflow]
  );

  const handlePreviewRecoveryDraft = useCallback(
    (sessionId: string) => {
      if (projectWorkflowBridge === undefined) {
        return;
      }

      void projectWorkflowBridge.previewRecoveryDraft(sessionId).then(setProjectWorkflow);
    },
    [projectWorkflowBridge]
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
    [api, projectWorkflowBridge]
  );

  const handleDiscardRecoveryDraft = useCallback(
    (sessionId: string) => {
      if (projectWorkflowBridge === undefined) {
        return;
      }

      void projectWorkflowBridge.discardRecoveryDraft(sessionId).then(setProjectWorkflow);
    },
    [projectWorkflowBridge]
  );

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
    setAiWritingWorkflow(aiWritingWorkflowBridge.beginGenerate(instruction));
    void aiWritingWorkflowBridge.generateSuggestion(instruction).then((nextAiWritingWorkflow) => {
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

  const handleApplyAiSuggestion = useCallback(() => {
    if (aiWritingWorkflowBridge === undefined) {
      return;
    }

    void aiWritingWorkflowBridge.applySuggestion().then((nextChapterEditor) => {
      setChapterEditor(nextChapterEditor);
      setAiWritingWorkflow(aiWritingWorkflowBridge.getProps());
    });
  }, [aiWritingWorkflowBridge]);

  const handleCancelAiStreaming = useCallback(() => {
    if (aiWritingWorkflowBridge === undefined) {
      return;
    }

    setAiWritingWorkflow(aiWritingWorkflowBridge.cancelStreaming());
  }, [aiWritingWorkflowBridge]);

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
          runtime: createChapterEditorRuntime(chapterEditor),
          onBodyChange: handleBodyChange,
          onSave: handleSave,
          onVersionPreview: handleVersionPreview,
          onVersionRestore: handleVersionRestore
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
    <WorkspaceShell
      {...(aiWritingWorkflow === undefined
        ? {}
        : {
            aiWritingWorkflow: {
              ...aiWritingWorkflow,
              onInstructionChange: handleAiInstructionChange,
              onGenerateSuggestion: handleGenerateAiSuggestion,
              onApplySuggestion: handleApplyAiSuggestion,
              onRetrySuggestion: handleGenerateAiSuggestion,
              onCancelStreaming: handleCancelAiStreaming
            } satisfies AiWritingWorkflowProps
          })}
      {...(projectWorkflow === undefined
        ? {}
        : {
            projectWorkflow: {
              ...projectWorkflow,
              onProjectRootChange: handleProjectRootChange,
              onOpenProject: handleOpenProject,
              onCreateProject: handleCreateProject,
              onCreateChapter: handleCreateChapter,
              onSelectChapter: handleSelectChapter,
              onCloseChapterTab: handleCloseChapterTab,
              onPreviewRecoveryDraft: handlePreviewRecoveryDraft,
              onApplyRecoveryDraft: handleApplyRecoveryDraft,
              onDiscardRecoveryDraft: handleDiscardRecoveryDraft
            }
          })}
      {...(projectSearch === undefined
        ? {}
        : {
            search: {
              ...projectSearch,
              onQueryChange: handleSearchQueryChange,
              onSearch: handleProjectSearch,
              onRebuildIndex: handleRebuildSearchIndex
            } satisfies ProjectSearchProps
          })}
      {...(settings === undefined
        ? {}
        : {
            settings: {
              ...settings,
              onSelectProfile: handleSettingsProfileSelect,
              onDraftChange: handleSettingsDraftChange,
              onNewProfile: handleNewSettingsProfile,
              onSaveProfile: handleSaveSettingsProfile,
              onTestConnection: handleTestSettingsConnection,
              onMakeDefault: handleMakeSettingsDefault,
              ...(settings.plugins === undefined
                ? {}
                : {
                    plugins: {
                      ...settings.plugins,
                      onRefresh: handleRefreshPluginRegistry,
                      onSetEnabled: handleSetPluginEnabled
                    }
                  })
            } satisfies ModelSettingsPanelProps
          })}
      {...(studio === undefined
        ? {}
        : {
            studio: {
              ...studio,
              onAssetSelect: handleStudioAssetSelect,
              onContentChange: handleStudioContentChange,
              onWorkflowNodeEdit: handleStudioWorkflowNodeEdit,
              onSave: handleStudioSave,
              onRestoreVersion: handleStudioRestoreVersion
            } satisfies ConfigStudioPanelProps
          })}
      {...(interactiveChapterEditor === undefined
        ? {}
        : { chapterEditor: interactiveChapterEditor })}
      onboarding={onboarding}
      {...(storyBible === undefined ? {} : { storyBible })}
      {...(storyBibleEditor === undefined
        ? {}
        : {
            storyBibleEditor: {
              ...storyBibleEditor,
              onKindSelect: handleStoryBibleKindSelect,
              onEntrySelect: handleStoryBibleEntrySelect,
              onDraftChange: handleStoryBibleDraftChange,
              onNewDraft: handleNewStoryBibleDraft,
              onSave: handleSaveStoryBibleDraft
            } satisfies StoryBibleEditorProps
          })}
      shellState={shellState}
      commands={commands}
      commandPaletteOpen={shortcutState.commandPaletteOpen}
      commandPaletteFeedback={commandPaletteFeedback}
      commandPaletteQuery={commandPaletteQuery}
      commandPaletteSelectedCommandId={commandPaletteSelectedCommandId}
      onCommandExecute={handleCommandExecute}
      onCommandPaletteActiveCommandChange={handleCommandPaletteActiveCommandChange}
      onCommandPaletteOpen={handleCommandPaletteOpen}
      onCommandPaletteQueryChange={handleCommandPaletteQueryChange}
      onBottomPanelTabSelect={handleBottomPanelTabSelect}
      onSearchResultOpen={handleSearchResultOpen}
      onTimelineEntryOpen={handleTimelineEntryOpen}
      onActivitySelect={handleActivitySelect}
    />
  );
}

function getNovelStudioApi(): NovelStudioApi | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return window.novelStudio;
}

function createOnboardingProps(input: {
  readonly dismissed: boolean;
  readonly shellState: DesktopShellState;
  readonly chapterEditor: ChapterEditorProps | undefined;
  readonly projectWorkflow: ProjectWorkflowProps | undefined;
  readonly onCreateExampleProject: () => void;
  readonly onCreateProject: () => void;
  readonly onOpenProject: () => void;
  readonly onCreateFirstChapter: () => void;
  readonly onDismiss: () => void;
}): OnboardingProps {
  const hasProject =
    input.shellState.projectTitle !== "未打开项目" ||
    (input.projectWorkflow?.projectRootInput.trim().length ?? 0) > 0;
  const hasChapter =
    input.chapterEditor !== undefined || (input.projectWorkflow?.chapters.length ?? 0) > 0;

  return {
    visible: true,
    dismissed: input.dismissed,
    steps: [
      {
        id: "project",
        label: "创建或打开项目",
        completed: hasProject
      },
      {
        id: "chapter",
        label: "新建第一章",
        completed: hasChapter
      },
      {
        id: "ai",
        label: "用 AI 生成建议",
        completed: false
      }
    ],
    onCreateExampleProject: input.onCreateExampleProject,
    onCreateProject: input.onCreateProject,
    onOpenProject: input.onOpenProject,
    onCreateFirstChapter: input.onCreateFirstChapter,
    onDismiss: input.onDismiss
  };
}

function shellPreferencesFromState(
  shellState: DesktopShellState
): NonNullable<UserPreferencesSaveInput["shell"]> {
  return {
    navigatorCollapsed: shellState.navigatorCollapsed,
    inspectorCollapsed: shellState.inspectorCollapsed,
    bottomPanelVisible: shellState.bottomPanelVisible,
    activeBottomPanelTab: shellState.activeBottomPanelTab,
    workspaceLayout: shellState.workspaceLayout
  };
}

function applyShellPreferences(
  shellState: DesktopShellState,
  preferences: NonNullable<UserPreferencesSaveInput["shell"]>
): DesktopShellState {
  return {
    ...shellState,
    ...(preferences.navigatorCollapsed === undefined
      ? {}
      : { navigatorCollapsed: preferences.navigatorCollapsed }),
    ...(preferences.inspectorCollapsed === undefined
      ? {}
      : { inspectorCollapsed: preferences.inspectorCollapsed }),
    ...(preferences.bottomPanelVisible === undefined
      ? {}
      : { bottomPanelVisible: preferences.bottomPanelVisible }),
    ...(preferences.activeBottomPanelTab === undefined
      ? {}
      : { activeBottomPanelTab: preferences.activeBottomPanelTab }),
    workspaceLayout: {
      ...shellState.workspaceLayout,
      ...preferences.workspaceLayout
    }
  };
}

function createChapterEditorRuntime(chapterEditor: ChapterEditorProps): ChapterEditorRuntimeProps {
  return createTextareaChapterEditorRuntimeProps({
    body: chapterEditor.chapter.body,
    saveStatus: chapterEditor.saveStatus,
    ...(chapterEditor.diffPreview === undefined ? {} : { diffPreview: chapterEditor.diffPreview })
  });
}
