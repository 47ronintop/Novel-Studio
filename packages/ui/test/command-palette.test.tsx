import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { DEFAULT_APPLICATION_COMMANDS } from "@novel-studio/application";
import { CommandPalette, isCommandPaletteShortcut } from "@novel-studio/ui";

describe("CommandPalette", () => {
  test("recognizes Ctrl/Cmd+K as the command palette shortcut", () => {
    expect(isCommandPaletteShortcut({ key: "k", ctrlKey: true, metaKey: false })).toBe(true);
    expect(isCommandPaletteShortcut({ key: "K", ctrlKey: false, metaKey: true })).toBe(true);
    expect(isCommandPaletteShortcut({ key: "p", ctrlKey: true, metaKey: false })).toBe(false);
  });

  test("renders only safe commands with visible risk levels", () => {
    const html = renderToStaticMarkup(
      <CommandPalette commands={DEFAULT_APPLICATION_COMMANDS} open={true} />
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="命令面板"');
    expect(html).toContain("打开命令面板");
    expect(html).toContain("切换项目导航");
    expect(html).toContain("安全");
    expect(html).not.toContain("destructive");
  });

  test("does not render when closed", () => {
    const html = renderToStaticMarkup(
      <CommandPalette commands={DEFAULT_APPLICATION_COMMANDS} open={false} />
    );

    expect(html).toBe("");
  });
});
