import { renderToStaticMarkup } from "react-dom/server";
import { isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { describe, expect, test } from "vitest";

import { DEFAULT_APPLICATION_COMMANDS } from "@novel-studio/application";
import type { ApplicationCommand } from "@novel-studio/application";
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

  test("executes a safe command when its command button is clicked", () => {
    const executedCommands: string[] = [];
    const tree = CommandPalette({
      commands: DEFAULT_APPLICATION_COMMANDS,
      onCommandExecute: (commandId) => executedCommands.push(commandId),
      open: true
    });
    const commandButton = findElementByAriaLabel(tree, "Execute command: 切换项目导航");

    expect(commandButton).toBeDefined();
    commandButton?.props.onClick?.();

    expect(executedCommands).toEqual(["workspace.toggle-navigator"]);
  });

  test("filters safe commands by query and groups them by scope", () => {
    const html = renderToStaticMarkup(
      <CommandPalette commands={commandFixtures} open={true} query="split" />
    );

    expect(html).toContain('data-command-group="workspace"');
    expect(html).toContain("Toggle split view");
    expect(html).not.toContain("Toggle navigator");
    expect(html).not.toContain("Dangerous delete");
  });

  test("moves active command with the keyboard and executes with Enter", () => {
    const activeCommands: string[] = [];
    const executedCommands: string[] = [];
    const tree = CommandPalette({
      commands: commandFixtures,
      onActiveCommandChange: (commandId) => activeCommands.push(commandId),
      onCommandExecute: (commandId) => executedCommands.push(commandId),
      open: true,
      query: "toggle",
      selectedCommandId: "workspace.toggle-navigator"
    });
    const input = findElementByAriaLabel(tree, "Search commands");

    expect(input).toBeDefined();
    input?.props.onKeyDown?.({
      key: "ArrowDown",
      preventDefault: () => undefined
    });
    input?.props.onKeyDown?.({
      key: "Enter",
      preventDefault: () => undefined
    });

    expect(activeCommands).toEqual(["workspace.toggle-split-view"]);
    expect(executedCommands).toEqual(["workspace.toggle-navigator"]);
  });

  test("renders command execution feedback", () => {
    const html = renderToStaticMarkup(
      <CommandPalette
        commands={commandFixtures}
        executionFeedback={{
          kind: "error",
          message: "The requested command is not available."
        }}
        open={true}
      />
    );

    expect(html).toContain('role="status"');
    expect(html).toContain("The requested command is not available.");
  });

  test("does not render when closed", () => {
    const html = renderToStaticMarkup(
      <CommandPalette commands={DEFAULT_APPLICATION_COMMANDS} open={false} />
    );

    expect(html).toBe("");
  });
});

const commandFixtures: readonly ApplicationCommand[] = [
  {
    id: "workspace.toggle-navigator",
    title: "Toggle navigator",
    scope: "workspace",
    riskLevel: "safe",
    defaultShortcut: "Ctrl+B"
  },
  {
    id: "workspace.toggle-split-view",
    title: "Toggle split view",
    scope: "workspace",
    riskLevel: "safe",
    defaultShortcut: "Ctrl+\\"
  },
  {
    id: "workspace.toggle-bottom-panel",
    title: "Dangerous delete",
    scope: "workspace",
    riskLevel: "destructive",
    defaultShortcut: "Ctrl+D"
  }
];

interface InspectableElementProps {
  readonly children?: ReactNode;
  readonly onClick?: () => void;
  readonly onKeyDown?: (event: { readonly key: string; preventDefault(): void }) => void;
  readonly "aria-label"?: string;
}

function findElementByAriaLabel(
  node: ReactNode,
  ariaLabel: string
): ReactElement<InspectableElementProps> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findElementByAriaLabel(child, ariaLabel);
      if (match !== undefined) {
        return match;
      }
    }
    return undefined;
  }

  if (!isValidElement<InspectableElementProps>(node)) {
    return undefined;
  }

  if (node.props["aria-label"] === ariaLabel) {
    return node;
  }

  return findElementByAriaLabel(node.props.children, ariaLabel);
}
