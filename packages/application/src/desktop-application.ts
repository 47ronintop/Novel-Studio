import { createUnifiedError, err, ok } from "@novel-studio/shared";
import type { Result, UnifiedError } from "@novel-studio/shared";

import {
  DEFAULT_APPLICATION_COMMANDS,
  findApplicationCommand,
  isSafeCommand
} from "./command-registry.js";
import type { ApplicationCommand, ApplicationCommandId } from "./command-registry.js";

export type ActivityId = "workspace" | "search" | "timeline" | "ai" | "studio" | "settings";

export type SaveStatus = "Saved" | "Saving" | "Unsaved" | "Recovery available";

export interface NavigatorSection {
  readonly id: string;
  readonly title: string;
  readonly itemCount: number;
}

export interface DesktopShellState {
  readonly projectTitle: string;
  readonly activeActivity: ActivityId;
  readonly navigatorCollapsed: boolean;
  readonly inspectorCollapsed: boolean;
  readonly bottomPanelVisible: boolean;
  readonly commandPaletteOpen: boolean;
  readonly saveStatus: SaveStatus;
  readonly navigatorSections: readonly NavigatorSection[];
  readonly bottomPanelTabs: readonly string[];
}

export interface DesktopApplication {
  getShellState(): DesktopShellState;
  listCommands(): readonly ApplicationCommand[];
  executeCommand(commandId: string): Result<DesktopShellState, UnifiedError>;
}

const DEFAULT_SHELL_STATE: DesktopShellState = {
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

export function createDesktopApplication(): DesktopApplication {
  let shellState = DEFAULT_SHELL_STATE;

  return {
    getShellState: () => shellState,
    listCommands: () => DEFAULT_APPLICATION_COMMANDS,
    executeCommand: (commandId: string) => {
      const command = findApplicationCommand(commandId);

      if (command === undefined || !isSafeCommand(command)) {
        return err(
          createUnifiedError({
            code: "APPLICATION_COMMAND_NOT_ALLOWED",
            category: "UserError",
            message: "The requested command is not available in the desktop shell.",
            recoverability: "user-action",
            suggestedAction: "Choose an available command from the command palette.",
            traceId: "application-command-bridge"
          })
        );
      }

      shellState = reduceShellState(shellState, command.id);

      return ok(shellState);
    }
  };
}

function reduceShellState(
  shellState: DesktopShellState,
  commandId: ApplicationCommandId
): DesktopShellState {
  switch (commandId) {
    case "workspace.open-command-palette":
      return { ...shellState, commandPaletteOpen: true };
    case "workspace.toggle-navigator":
      return { ...shellState, navigatorCollapsed: !shellState.navigatorCollapsed };
    case "workspace.toggle-inspector":
      return { ...shellState, inspectorCollapsed: !shellState.inspectorCollapsed };
    case "workspace.toggle-bottom-panel":
      return { ...shellState, bottomPanelVisible: !shellState.bottomPanelVisible };
  }
}
