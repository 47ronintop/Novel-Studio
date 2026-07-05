import type {
  ActivityId,
  ApplicationCommand,
  DesktopShellState,
  NovelStudioApi
} from "@novel-studio/application";
import type {
  AiWritingWorkflowProps,
  ChapterEditorProps,
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
import { createProjectWorkflowBridge } from "./project-workflow-bridge.js";
import { createProjectSearchBridge } from "./project-search-bridge.js";
import { createStoryBibleBridge } from "./story-bible-bridge.js";
import { reduceRendererShortcut } from "./shortcuts.js";

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
  const [aiWritingWorkflowBridge] = useState(() =>
    api === undefined ? undefined : createAiWritingWorkflowBridge(api)
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
  const [aiWritingWorkflow, setAiWritingWorkflow] = useState(() =>
    aiWritingWorkflowBridge?.getProps()
  );
  const [shortcutState, setShortcutState] = useState({ commandPaletteOpen: false });

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
    },
    [api, chapterBridge, storyBibleBridge]
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

  const handleActivitySelect = useCallback((activityId: ActivityId) => {
    setShellState((current) => ({
      ...current,
      activeActivity: activityId
    }));
  }, []);

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

  const interactiveChapterEditor =
    chapterEditor === undefined
      ? undefined
      : {
          ...chapterEditor,
          onBodyChange: handleBodyChange,
          onSave: handleSave,
          onVersionPreview: handleVersionPreview,
          onVersionRestore: handleVersionRestore
        };

  return (
    <WorkspaceShell
      {...(aiWritingWorkflow === undefined
        ? {}
        : {
            aiWritingWorkflow: {
              ...aiWritingWorkflow,
              onInstructionChange: handleAiInstructionChange,
              onGenerateSuggestion: handleGenerateAiSuggestion,
              onApplySuggestion: handleApplyAiSuggestion
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
              onSelectChapter: handleSelectChapter
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
      {...(interactiveChapterEditor === undefined
        ? {}
        : { chapterEditor: interactiveChapterEditor })}
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
