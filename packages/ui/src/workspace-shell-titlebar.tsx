import { Maximize2, PanelBottom, PanelRight, Search } from "lucide-react";

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
              aria-label="切换底部面板"
              className="ns-icon-button"
              onClick={() => onCommandExecute?.("workspace.toggle-bottom-panel")}
              title="切换底部面板"
              type="button"
            >
              <PanelBottom aria-hidden="true" size={14} />
            </button>
            <button
              aria-label="切换 Split View"
              className="ns-icon-button"
              onClick={() => onCommandExecute?.("workspace.toggle-split-view")}
              title="切换 Split View"
              type="button"
            >
              <PanelRight aria-hidden="true" size={14} />
            </button>
            <button
              aria-label="切换专注模式"
              className="ns-icon-button"
              onClick={() => onCommandExecute?.("workspace.toggle-focus-mode")}
              title="切换专注模式"
              type="button"
            >
              <Maximize2 aria-hidden="true" size={14} />
            </button>
          </div>
        )}
      </div>
    </header>
  );
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
