import type { ApplicationCommand, DesktopShellState } from "@novel-studio/application";
import { WorkspaceShell } from "@novel-studio/ui";
import { useEffect, useState } from "react";

import { reduceRendererShortcut } from "./shortcuts.js";

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

  return (
    <WorkspaceShell
      shellState={rendererShellState}
      commands={rendererCommands}
      commandPaletteOpen={shortcutState.commandPaletteOpen}
    />
  );
}
