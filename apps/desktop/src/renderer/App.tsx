import type {
  ApplicationCommand,
  DesktopShellState,
  NovelStudioApi
} from "@novel-studio/application";
import type { ChapterEditorProps } from "@novel-studio/ui";
import { WorkspaceShell } from "@novel-studio/ui";
import { useCallback, useEffect, useState } from "react";

import { createChapterEditorBridge } from "./chapter-editor-bridge.js";
import { reduceRendererShortcut } from "./shortcuts.js";

declare global {
  interface Window {
    novelStudio?: NovelStudioApi;
  }
}

const rendererShellState: DesktopShellState = {
  projectTitle: "No project open",
  activeActivity: "workspace",
  navigatorCollapsed: false,
  inspectorCollapsed: false,
  bottomPanelVisible: true,
  commandPaletteOpen: false,
  saveStatus: "Saved",
  navigatorSections: [
    { id: "chapters", title: "Chapters", itemCount: 0 },
    { id: "characters", title: "Characters", itemCount: 0 },
    { id: "world", title: "World", itemCount: 0 },
    { id: "outline", title: "Outline", itemCount: 0 },
    { id: "timeline", title: "Timeline", itemCount: 0 },
    { id: "memories", title: "Memories", itemCount: 0 },
    { id: "prompts", title: "Prompts", itemCount: 0 },
    { id: "agents", title: "Agents", itemCount: 0 },
    { id: "workflows", title: "Workflows", itemCount: 0 }
  ],
  bottomPanelTabs: ["Workflow Run", "Problems", "Search", "Logs"]
};

const rendererCommands: readonly ApplicationCommand[] = [
  {
    id: "workspace.open-command-palette",
    title: "Open Command Palette",
    scope: "workspace",
    riskLevel: "safe",
    defaultShortcut: "Ctrl/Cmd+K"
  },
  {
    id: "workspace.toggle-navigator",
    title: "Toggle Navigator",
    scope: "workspace",
    riskLevel: "safe",
    defaultShortcut: "Ctrl/Cmd+B"
  },
  {
    id: "workspace.toggle-inspector",
    title: "Toggle Inspector",
    scope: "workspace",
    riskLevel: "safe",
    defaultShortcut: "Ctrl/Cmd+Shift+I"
  },
  {
    id: "workspace.toggle-bottom-panel",
    title: "Toggle Bottom Panel",
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
  const [shellState, setShellState] = useState<DesktopShellState>(rendererShellState);
  const [commands, setCommands] = useState<readonly ApplicationCommand[]>(rendererCommands);
  const [chapterEditor, setChapterEditor] = useState<ChapterEditorProps | undefined>();
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
      {...(interactiveChapterEditor === undefined
        ? {}
        : { chapterEditor: interactiveChapterEditor })}
      shellState={shellState}
      commands={commands}
      commandPaletteOpen={shortcutState.commandPaletteOpen}
    />
  );
}

function getNovelStudioApi(): NovelStudioApi | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return window.novelStudio;
}
