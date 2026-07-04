import { describe, expect, test } from "vitest";

import { reduceRendererShortcut } from "../src/renderer/shortcuts";

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
});
