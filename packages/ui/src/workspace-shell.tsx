import type { ApplicationCommand, DesktopShellState } from "@novel-studio/application";
import type { ChapterSummary } from "@novel-studio/shared";
import type { ChapterEditorProps } from "./chapter-editor.js";
import {
  Bot,
  Boxes,
  Check,
  Clock3,
  FilePlus,
  FolderTree,
  FolderOpen,
  FolderPlus,
  PanelBottom,
  PanelRight,
  Search,
  Settings,
  Sparkles
} from "lucide-react";

import { ChapterEditor } from "./chapter-editor.js";
import { CommandPalette } from "./command-palette.js";

export interface WorkspaceShellProps {
  readonly shellState: DesktopShellState;
  readonly commands: readonly ApplicationCommand[];
  readonly commandPaletteOpen: boolean;
  readonly chapterEditor?: ChapterEditorProps;
  readonly projectWorkflow?: ProjectWorkflowProps;
  readonly aiWritingWorkflow?: AiWritingWorkflowProps;
  readonly storyBible?: StoryBibleSummaryProps;
}

export interface ProjectWorkflowProps {
  readonly projectRootInput: string;
  readonly status?: ProjectWorkflowStatus;
  readonly feedback?: ProjectWorkflowFeedback;
  readonly chapters: readonly ChapterSummary[];
  readonly activeChapterId?: string;
  readonly onProjectRootChange: (projectRoot: string) => void;
  readonly onOpenProject: () => void;
  readonly onCreateProject: () => void;
  readonly onCreateChapter: () => void;
  readonly onSelectChapter: (chapterId: string) => void;
}

export type ProjectWorkflowStatus = "idle" | "opening" | "creating";

export interface ProjectWorkflowFeedback {
  readonly kind: "info" | "error";
  readonly message: string;
}

export type AiWritingWorkflowStatus = "idle" | "generating" | "suggestion-ready" | "applied";

export interface AiWritingWorkflowProps {
  readonly status: AiWritingWorkflowStatus;
  readonly instruction: string;
  readonly summary?: string;
  readonly contextTraceLabel?: string;
  readonly diffPreview?: ChapterEditorProps["diffPreview"];
  readonly onInstructionChange: (instruction: string) => void;
  readonly onGenerateSuggestion: () => void;
  readonly onApplySuggestion: () => void;
}

export interface StoryBibleSummaryProps {
  readonly assets: readonly StoryBibleSummaryAsset[];
}

export interface StoryBibleSummaryAsset {
  readonly id: string;
  readonly title: string;
  readonly type: string;
  readonly status: string;
  readonly summary: string;
  readonly contextEligible?: boolean;
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
  chapterEditor,
  projectWorkflow,
  aiWritingWorkflow,
  storyBible
}: WorkspaceShellProps) {
  return (
    <div className="ns-shell" data-theme="dark">
      <header className="ns-titlebar">
        <div className="ns-project-status">
          <span className="ns-project-title">{shellState.projectTitle}</span>
          <span className="ns-save-status">{shellState.saveStatus}</span>
        </div>
        <button className="ns-command-button" data-focus-order="1" type="button">
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
                {...(selected ? { "aria-current": "page" as const } : {})}
                aria-label={activity.label}
                className="ns-activity-button"
                data-focus-order={selected ? "2" : undefined}
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
          {projectWorkflow === undefined ? null : (
            <div className="ns-project-workflow">
              <input
                aria-label="Project path"
                className="ns-project-path"
                onChange={(event) => projectWorkflow.onProjectRootChange(event.currentTarget.value)}
                placeholder="Select or type a project folder"
                value={projectWorkflow.projectRootInput}
              />
              <div className="ns-project-actions">
                <button
                  aria-label="Open project"
                  className="ns-icon-text-button"
                  disabled={isProjectWorkflowBusy(projectWorkflow)}
                  onClick={projectWorkflow.onOpenProject}
                  title="Open project"
                  type="button"
                >
                  <FolderOpen aria-hidden="true" size={14} />
                  {projectWorkflow.status === "opening" ? "Opening" : "Open"}
                </button>
                <button
                  aria-label="Create project"
                  className="ns-icon-text-button"
                  disabled={isProjectWorkflowBusy(projectWorkflow)}
                  onClick={projectWorkflow.onCreateProject}
                  title="Create project"
                  type="button"
                >
                  <FolderPlus aria-hidden="true" size={14} />
                  {projectWorkflow.status === "creating" ? "Creating" : "Create"}
                </button>
                <button
                  aria-label="Create chapter"
                  className="ns-icon-text-button"
                  disabled={isProjectWorkflowBusy(projectWorkflow)}
                  onClick={projectWorkflow.onCreateChapter}
                  title="Create chapter"
                  type="button"
                >
                  <FilePlus aria-hidden="true" size={14} />
                  Chapter
                </button>
              </div>
              {projectWorkflow.feedback === undefined ? null : (
                <p
                  className="ns-project-feedback"
                  data-kind={projectWorkflow.feedback.kind}
                  role="status"
                >
                  {projectWorkflow.feedback.message}
                </p>
              )}
            </div>
          )}
          <ul className="ns-tree">
            {shellState.navigatorSections.map((section) => (
              <li className="ns-tree-row" key={section.id}>
                <span>{section.title}</span>
                <span>{section.itemCount}</span>
              </li>
            ))}
          </ul>
          {projectWorkflow === undefined ? null : (
            <ul className="ns-chapter-tree" aria-label="Chapters">
              {projectWorkflow.chapters.map((chapter) => (
                <li key={chapter.id}>
                  <button
                    {...(projectWorkflow.activeChapterId === chapter.id
                      ? { "aria-current": "true" as const }
                      : {})}
                    className="ns-chapter-row"
                    onClick={() => projectWorkflow.onSelectChapter(chapter.id)}
                    type="button"
                  >
                    <span>{chapter.title}</span>
                    <span>{chapter.order}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </nav>

        <main aria-label="Editor Area" className="ns-editor-area" data-region="editor-area">
          <div className="ns-tabs" role="tablist" aria-label="Open assets">
            <button
              aria-selected="true"
              className="ns-tab"
              data-focus-order="3"
              role="tab"
              type="button"
            >
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
              <dd>{aiWritingWorkflow?.contextTraceLabel ?? "No workflow run"}</dd>
            </div>
          </dl>
          {aiWritingWorkflow === undefined ? null : (
            <section className="ns-ai-workflow" aria-label="AI writing workflow">
              <div className="ns-editor-panel-header">
                <span>AI Workflow</span>
                <span className="ns-muted">{statusLabel(aiWritingWorkflow.status)}</span>
              </div>
              <textarea
                aria-label="AI writing instruction"
                className="ns-ai-instruction"
                onChange={(event) =>
                  aiWritingWorkflow.onInstructionChange(event.currentTarget.value)
                }
                value={aiWritingWorkflow.instruction}
              />
              <div className="ns-ai-actions">
                <button
                  aria-label="Generate AI suggestion"
                  className="ns-icon-text-button"
                  disabled={aiWritingWorkflow.status === "generating"}
                  onClick={aiWritingWorkflow.onGenerateSuggestion}
                  title="Generate AI suggestion"
                  type="button"
                >
                  <Sparkles aria-hidden="true" size={14} />
                  Generate
                </button>
                <button
                  aria-label="Apply AI suggestion"
                  className="ns-icon-text-button"
                  disabled={aiWritingWorkflow.status !== "suggestion-ready"}
                  onClick={aiWritingWorkflow.onApplySuggestion}
                  title="Apply AI suggestion"
                  type="button"
                >
                  <Check aria-hidden="true" size={14} />
                  Apply
                </button>
              </div>
              {aiWritingWorkflow.summary === undefined ? null : (
                <p className="ns-ai-summary">{aiWritingWorkflow.summary}</p>
              )}
              {aiWritingWorkflow.contextTraceLabel === undefined ? null : (
                <p className="ns-ai-context">{aiWritingWorkflow.contextTraceLabel}</p>
              )}
            </section>
          )}
          {storyBible === undefined ? null : (
            <section className="ns-story-bible-summary" aria-label="Story Bible summary">
              <div className="ns-editor-panel-header">
                <span>Story Bible</span>
                <span className="ns-muted">{storyBible.assets.length}</span>
              </div>
              <ul className="ns-story-bible-list">
                {storyBible.assets.map((asset) => (
                  <li className="ns-story-bible-item" key={asset.id}>
                    <div className="ns-story-bible-title">
                      <span>{asset.title}</span>
                      <span>{asset.type}</span>
                    </div>
                    <p>{asset.summary}</p>
                    <div className="ns-story-bible-meta">
                      <span>{asset.status}</span>
                      {asset.contextEligible === true ? <span>Context eligible</span> : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>

        <section
          aria-label="Bottom Panel"
          className="ns-bottom-panel"
          data-region="bottom-panel"
          data-visible={shellState.bottomPanelVisible}
        >
          <div className="ns-bottom-tabs" role="tablist" aria-label="Bottom panel tabs">
            <PanelBottom aria-hidden="true" size={15} />
            {shellState.bottomPanelTabs.map((tab, index) => (
              <button
                aria-selected={index === 0}
                className="ns-bottom-tab"
                data-focus-order={index === 0 ? "4" : undefined}
                key={tab}
                role="tab"
                type="button"
              >
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

function isProjectWorkflowBusy(projectWorkflow: ProjectWorkflowProps): boolean {
  return projectWorkflow.status === "opening" || projectWorkflow.status === "creating";
}

function statusLabel(status: AiWritingWorkflowStatus): string {
  switch (status) {
    case "idle":
      return "Idle";
    case "generating":
      return "Generating";
    case "suggestion-ready":
      return "Ready";
    case "applied":
      return "Applied";
  }
}
