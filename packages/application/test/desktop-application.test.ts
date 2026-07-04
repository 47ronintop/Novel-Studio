import { describe, expect, test } from "vitest";

import { createDesktopApplication } from "../src/desktop-application.js";
import { DEFAULT_APPLICATION_COMMANDS, isSafeCommand } from "../src/command-registry.js";

describe("desktop application command bridge", () => {
  test("exposes a shell state DTO for the desktop workspace", () => {
    const application = createDesktopApplication();

    expect(application.getShellState()).toMatchObject({
      projectTitle: "No project open",
      activeActivity: "workspace",
      navigatorCollapsed: false,
      inspectorCollapsed: false,
      bottomPanelVisible: true,
      saveStatus: "Saved"
    });
  });

  test("registers only safe M4 commands with risk levels", () => {
    expect(DEFAULT_APPLICATION_COMMANDS).toEqual([
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
    ]);
    expect(DEFAULT_APPLICATION_COMMANDS.every(isSafeCommand)).toBe(true);
  });

  test("executes safe workspace commands without filesystem access", () => {
    const application = createDesktopApplication();

    const result = application.executeCommand("workspace.toggle-navigator");

    expect(result.ok).toBe(true);
    expect(application.getShellState().navigatorCollapsed).toBe(true);
  });

  test("rejects unknown commands at the Application boundary", () => {
    const application = createDesktopApplication();

    const result = application.executeCommand("fs:read-file");

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "APPLICATION_COMMAND_NOT_ALLOWED",
        category: "UserError",
        recoverability: "user-action"
      }
    });
  });
});
