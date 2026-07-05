import { describe, expect, test } from "vitest";

import type { ApplicationCommandId, DesktopShellState } from "@novel-studio/application";
import { ok } from "@novel-studio/shared";

import { createCommandExecutionBridge } from "../src/renderer/command-execution-bridge.js";

const nextShellState: DesktopShellState = {
  projectTitle: "M29",
  activeActivity: "workspace",
  navigatorCollapsed: true,
  inspectorCollapsed: false,
  bottomPanelVisible: true,
  commandPaletteOpen: false,
  saveStatus: "Saved",
  navigatorSections: [],
  bottomPanelTabs: []
};

describe("M29 command execution bridge", () => {
  test("executes a command through the preload API and returns the updated shell state", async () => {
    const calls: string[] = [];
    const bridge = createCommandExecutionBridge({
      commands: {
        list: async () => [],
        execute: async (commandId: string) => {
          calls.push(`commands.execute:${commandId}`);
          return ok(nextShellState);
        }
      }
    });

    const result = await bridge.execute("workspace.toggle-navigator");

    expect(calls).toEqual(["commands.execute:workspace.toggle-navigator"]);
    expect(result).toEqual(ok(nextShellState));
  });

  test("keeps command identifiers constrained to application command ids", () => {
    const commandId: ApplicationCommandId = "workspace.toggle-bottom-panel";

    expect(commandId).toBe("workspace.toggle-bottom-panel");
  });
});
