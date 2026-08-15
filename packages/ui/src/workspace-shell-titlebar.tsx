import {
  Check,
  ChevronDown,
  PanelBottom,
  PanelRight,
  PanelRightClose,
  PanelRightOpen,
  Maximize2,
  Search
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ConversationPanelMode } from "@novel-studio/shared";
import type { ApplicationCommandId } from "@novel-studio/application";

import { WorkbenchSwitcher } from "./workbench-switcher.js";
import type { WorkspaceShellProps } from "./workspace-shell-types.js";

interface WorkspaceShellTitlebarProps {
  readonly onCommandExecute: WorkspaceShellProps["onCommandExecute"];
  readonly onCommandPaletteOpen: WorkspaceShellProps["onCommandPaletteOpen"];
  readonly onWorkbenchSelect: WorkspaceShellProps["onWorkbenchSelect"];
  readonly settingsMode: boolean;
  readonly shellState: WorkspaceShellProps["shellState"];
}

export function WorkspaceShellTitlebar({
  onCommandExecute,
  onCommandPaletteOpen,
  onWorkbenchSelect,
  settingsMode,
  shellState
}: WorkspaceShellTitlebarProps) {
  const [conversationMenuOpen, setConversationMenuOpen] = useState(false);
  const conversationControlRef = useRef<HTMLDivElement>(null);
  const conversationPanelMode = shellState.workspaceLayout.conversationPanelMode;

  useEffect(() => {
    if (!conversationMenuOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!conversationControlRef.current?.contains(event.target as Node)) {
        setConversationMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [conversationMenuOpen]);
  return (
    <header className="ns-titlebar">
      <div className="ns-project-status">
        <span className="ns-project-title">{shellState.projectTitle}</span>
        <span className="ns-save-status">{saveStatusLabel(shellState.saveStatus)}</span>
      </div>
      <WorkbenchSwitcher
        mode={shellState.workbenchMode}
        {...(shellState.workspaceContext.kind === "engineeringWorkspace"
          ? { creativeDisabledReason: "当前工作区不是创作项目。" }
          : {})}
        onSelect={onWorkbenchSelect ?? (() => undefined)}
      />
      <div className="ns-titlebar-actions">
        <button
          aria-label="打开命令面板"
          className="ns-command-button"
          data-focus-order="1"
          onClick={onCommandPaletteOpen}
          title="搜索项目或运行命令 Ctrl/Cmd+K"
          type="button"
        >
          <Search aria-hidden="true" size={14} />
          <span>搜索项目或运行命令</span>
          <kbd>⌘K</kbd>
        </button>
        {settingsMode ? null : (
          <div className="ns-layout-controls" aria-label="布局控制">
            <button
              aria-label={shellState.bottomPanelVisible ? "收起任务面板" : "打开任务面板"}
              className="ns-icon-button"
              onClick={() => onCommandExecute?.("workspace.toggle-bottom-panel")}
              title={shellState.bottomPanelVisible ? "收起任务面板" : "打开任务面板"}
              type="button"
            >
              <PanelBottom aria-hidden="true" size={14} />
            </button>
            {conversationPanelMode === "docked" ? (
              <button
                aria-label="展开会话面板"
                className="ns-icon-button"
                onClick={() => onCommandExecute?.("workspace.set-conversation-panel-expanded")}
                title="展开会话面板"
                type="button"
              >
                <Maximize2 aria-hidden="true" size={14} />
              </button>
            ) : null}
            <div className="ns-conversation-layout-control" ref={conversationControlRef}>
              <button
                aria-label={conversationPanelAriaLabel(conversationPanelMode)}
                className="ns-icon-button ns-conversation-layout-primary"
                onClick={() => onCommandExecute?.("workspace.toggle-split-view")}
                title={conversationPanelTitle(conversationPanelMode)}
                type="button"
              >
                {conversationPanelMode === "collapsed" ? (
                  <PanelRightOpen aria-hidden="true" size={14} />
                ) : conversationPanelMode === "expanded" ? (
                  <PanelRightClose aria-hidden="true" size={14} />
                ) : (
                  <PanelRight aria-hidden="true" size={14} />
                )}
              </button>
              <button
                aria-expanded={conversationMenuOpen}
                aria-haspopup="menu"
                aria-label="选择会话面板布局"
                className="ns-icon-button ns-conversation-layout-menu-trigger"
                onClick={() => setConversationMenuOpen((open) => !open)}
                title="选择会话面板布局"
                type="button"
              >
                <ChevronDown aria-hidden="true" size={12} />
              </button>
              {conversationMenuOpen ? (
                <div aria-label="会话面板布局" className="ns-conversation-layout-menu" role="menu">
                  {conversationPanelModes.map((entry) => (
                    <button
                      aria-checked={entry.mode === conversationPanelMode}
                      className="ns-conversation-layout-menu-item"
                      key={entry.mode}
                      onClick={() => {
                        onCommandExecute?.(entry.commandId);
                        setConversationMenuOpen(false);
                      }}
                      role="menuitemradio"
                      type="button"
                    >
                      <span>{entry.label}</span>
                      {entry.mode === conversationPanelMode ? (
                        <Check aria-hidden="true" size={13} />
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}

const conversationPanelModes: readonly {
  readonly mode: ConversationPanelMode;
  readonly label: string;
  readonly commandId: ApplicationCommandId;
}[] = [
  {
    mode: "docked",
    label: "停靠",
    commandId: "workspace.set-conversation-panel-docked"
  },
  {
    mode: "collapsed",
    label: "收起",
    commandId: "workspace.set-conversation-panel-collapsed"
  },
  {
    mode: "expanded",
    label: "展开",
    commandId: "workspace.set-conversation-panel-expanded"
  }
];

function conversationPanelTitle(
  mode: WorkspaceShellProps["shellState"]["workspaceLayout"]["conversationPanelMode"]
): string {
  switch (mode) {
    case "collapsed":
      return "恢复会话面板（当前已收起）";
    case "expanded":
      return "恢复编辑器（当前会话面板已展开）";
    case "docked":
      return "收起会话面板";
    default:
      return "收起会话面板";
  }
}

function conversationPanelAriaLabel(
  mode: WorkspaceShellProps["shellState"]["workspaceLayout"]["conversationPanelMode"]
): string {
  switch (mode) {
    case "collapsed":
      return "恢复会话面板并展开布局";
    case "expanded":
      return "恢复停靠会话面板布局";
    case "docked":
      return "收起会话面板并展开布局";
    default:
      return "收起会话面板并展开布局";
  }
}

function saveStatusLabel(status: WorkspaceShellProps["shellState"]["saveStatus"]): string {
  switch (status) {
    case "Saved":
      return "已保存";
    case "Saving":
      return "保存中";
    case "Unsaved":
      return "未保存";
    case "Recovery available":
      return "有可恢复内容";
  }
}
