import type { ApplicationCommand, DesktopShellState } from "@novel-studio/application";
import type { ChapterEditorProps } from "./chapter-editor.js";
import {
  Bot,
  Boxes,
  Clock3,
  FolderTree,
  PanelBottom,
  PanelRight,
  Search,
  Settings
} from "lucide-react";

import { ChapterEditor } from "./chapter-editor.js";
import { CommandPalette } from "./command-palette.js";

export interface WorkspaceShellProps {
  readonly shellState: DesktopShellState;
  readonly commands: readonly ApplicationCommand[];
  readonly commandPaletteOpen: boolean;
  readonly chapterEditor?: ChapterEditorProps;
}

const activities = [
  { id: "workspace", label: "Workspace", icon: FolderTree },
  { id: "search", label: "Search", icon: Search },
  { id: "timeline", label: "Timeline", icon: Clock3 },
  { id: "ai", label: "AI Workflow", icon: Bot },
  { id: "studio", label: "Studio", icon: Boxes },
  { id: "settings", label: "Settings", icon: Settings }
] as const;

export function WorkspaceShell({
  shellState,
  commands,
  commandPaletteOpen,
  chapterEditor
}: WorkspaceShellProps) {
  return (
    <div className="ns-shell" data-theme="dark">
      <header className="ns-titlebar">
        <div className="ns-project-status">
          <span className="ns-project-title">{shellState.projectTitle}</span>
          <span className="ns-save-status">{shellState.saveStatus}</span>
        </div>
        <button className="ns-command-button" type="button">
          Command Palette <kbd>Ctrl/Cmd+K</kbd>
        </button>
      </header>

      <div className="ns-workspace-grid">
        <aside className="ns-activity-bar" data-region="activity-bar" aria-label="Activity Bar">
          {activities.map((activity) => {
            const Icon = activity.icon;
            const selected = activity.id === shellState.activeActivity;

            return (
              <button
                aria-label={activity.label}
                className="ns-activity-button"
                data-selected={selected}
                key={activity.id}
                title={activity.label}
                type="button"
              >
                <Icon aria-hidden="true" size={18} />
              </button>
            );
          })}
        </aside>

        <nav
          aria-label="Project Navigator"
          className="ns-navigator"
          data-collapsed={shellState.navigatorCollapsed}
          data-region="navigator"
        >
          <div className="ns-panel-header">
            <span>Project</span>
            <span>{shellState.navigatorSections.length}</span>
          </div>
          <ul className="ns-tree">
            {shellState.navigatorSections.map((section) => (
              <li className="ns-tree-row" key={section.id}>
                <span>{section.title}</span>
                <span>{section.itemCount}</span>
              </li>
            ))}
          </ul>
        </nav>

        <main aria-label="Editor Area" className="ns-editor-area" data-region="editor-area">
          <div className="ns-tabs" role="tablist" aria-label="Open assets">
            <button aria-selected="true" className="ns-tab" role="tab" type="button">
              Untitled Chapter
            </button>
          </div>
          <section className="ns-editor-surface" aria-label="Chapter editor surface">
            {chapterEditor ? (
              <ChapterEditor {...chapterEditor} />
            ) : (
              <>
                <div className="ns-document-title">Untitled Chapter</div>
                <p>Write the next scene</p>
                <div className="ns-editor-line" />
                <div className="ns-editor-line ns-editor-line-short" />
              </>
            )}
          </section>
        </main>

        <aside
          aria-label="Inspector"
          className="ns-inspector"
          data-collapsed={shellState.inspectorCollapsed}
          data-region="inspector"
        >
          <div className="ns-panel-header">
            <span>Inspector</span>
            <PanelRight aria-hidden="true" size={15} />
          </div>
          <dl className="ns-meta-list">
            <div>
              <dt>Status</dt>
              <dd>{shellState.saveStatus}</dd>
            </div>
            <div>
              <dt>History</dt>
              <dd>No snapshots yet</dd>
            </div>
            <div>
              <dt>Context</dt>
              <dd>No workflow run</dd>
            </div>
          </dl>
        </aside>

        <section
          aria-label="Bottom Panel"
          className="ns-bottom-panel"
          data-region="bottom-panel"
          data-visible={shellState.bottomPanelVisible}
        >
          <div className="ns-bottom-tabs">
            <PanelBottom aria-hidden="true" size={15} />
            {shellState.bottomPanelTabs.map((tab) => (
              <button className="ns-bottom-tab" key={tab} type="button">
                {tab}
              </button>
            ))}
          </div>
        </section>
      </div>

      <CommandPalette
        commands={commands}
        open={commandPaletteOpen || shellState.commandPaletteOpen}
      />
    </div>
  );
}
