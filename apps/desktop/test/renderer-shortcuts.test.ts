import { describe, expect, test } from "vitest";

import { createShortcutConflictMatrix, reduceRendererShortcut } from "../src/renderer/shortcuts";

describe("renderer shortcuts", () => {
  test("opens the command palette on Ctrl+K", () => {
    const result = reduceRendererShortcut(
      { commandPaletteOpen: false },
      { key: "k", ctrlKey: true, metaKey: false }
    );

    expect(result).toEqual({
      handled: true,
      state: { commandPaletteOpen: true }
    });
  });

  test("opens the command palette on Cmd+K", () => {
    const result = reduceRendererShortcut(
      { commandPaletteOpen: false },
      { key: "K", ctrlKey: false, metaKey: true }
    );

    expect(result).toEqual({
      handled: true,
      state: { commandPaletteOpen: true }
    });
  });

  test("ignores unrelated shortcuts", () => {
    const result = reduceRendererShortcut(
      { commandPaletteOpen: false },
      { key: "p", ctrlKey: true, metaKey: false }
    );

    expect(result).toEqual({
      handled: false,
      state: { commandPaletteOpen: false }
    });
  });

  test("reports normalized shortcut conflicts across command declarations", () => {
    const matrix = createShortcutConflictMatrix([
      {
        commandId: "workspace.open-command-palette",
        label: "Command Palette",
        shortcut: "Ctrl/Cmd+K"
      },
      {
        commandId: "editor.insert-link",
        label: "Insert Link",
        shortcut: "cmd / ctrl + k"
      },
      {
        commandId: "workspace.toggle-bottom-panel",
        label: "Toggle Bottom Panel",
        shortcut: "Ctrl/Cmd+J"
      }
    ]);

    expect(matrix).toEqual({
      conflicts: [
        {
          normalizedShortcut: "ctrl/cmd+k",
          commandIds: ["workspace.open-command-palette", "editor.insert-link"],
          labels: ["Command Palette", "Insert Link"]
        }
      ],
      entries: [
        {
          commandId: "workspace.open-command-palette",
          label: "Command Palette",
          shortcut: "Ctrl/Cmd+K",
          normalizedShortcut: "ctrl/cmd+k"
        },
        {
          commandId: "editor.insert-link",
          label: "Insert Link",
          shortcut: "cmd / ctrl + k",
          normalizedShortcut: "ctrl/cmd+k"
        },
        {
          commandId: "workspace.toggle-bottom-panel",
          label: "Toggle Bottom Panel",
          shortcut: "Ctrl/Cmd+J",
          normalizedShortcut: "ctrl/cmd+j"
        }
      ]
    });
  });
});
