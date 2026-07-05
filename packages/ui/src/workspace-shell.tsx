import type {
  ActivityId,
  ApplicationCommand,
  DesktopShellState,
  ProjectSearchResultItem
} from "@novel-studio/application";
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
  readonly search?: ProjectSearchProps;
  readonly storyBible?: StoryBibleSummaryProps;
  readonly onActivitySelect?: (activityId: ActivityId) => void;
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

export type ProjectSearchStatus =
  "idle" | "indexing" | "searching" | "results-ready" | "empty" | "error";

export interface ProjectSearchProps {
  readonly query: string;
  readonly status: ProjectSearchStatus;
  readonly entryCount?: number;
  readonly generatedAt?: string;
  readonly feedback?: ProjectWorkflowFeedback;
  readonly results: readonly ProjectSearchResultItem[];
  readonly onQueryChange: (query: string) => void;
  readonly onSearch: () => void;
  readonly onRebuildIndex: () => void;
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
  { id: "workspace", label: "工作区", icon: FolderTree },
  { id: "search", label: "搜索", icon: Search },
  { id: "timeline", label: "时间线", icon: Clock3 },
  { id: "ai", label: "AI 工作流", icon: Bot },
  { id: "studio", label: "创作系统", icon: Boxes },
  { id: "settings", label: "设置", icon: Settings }
] as const;

const navigatorSectionLabels: ReadonlyMap<string, string> = new Map([
  ["chapters", "章节"],
  ["characters", "人物"],
  ["world", "世界观"],
  ["outline", "大纲"],
  ["timeline", "时间线"],
  ["memories", "记忆"],
  ["prompts", "提示词"],
  ["agents", "Agent"],
  ["workflows", "工作流"]
]);

const bottomPanelLabels: ReadonlyMap<string, string> = new Map([
  ["Workflow Run", "工作流运行"],
  ["Problems", "问题"],
  ["Search", "搜索"],
  ["Logs", "日志"]
]);

export function WorkspaceShell({
  shellState,
  commands,
  commandPaletteOpen,
  chapterEditor,
  projectWorkflow,
  aiWritingWorkflow,
  search,
  storyBible,
  onActivitySelect
}: WorkspaceShellProps) {
  return (
    <div className="ns-shell" data-theme="dark">
      <header className="ns-titlebar">
        <div className="ns-project-status">
          <span className="ns-project-title">{shellState.projectTitle}</span>
          <span className="ns-save-status">{shellState.saveStatus}</span>
        </div>
        <button className="ns-command-button" data-focus-order="1" type="button">
          命令面板 <kbd>Ctrl/Cmd+K</kbd>
        </button>
      </header>

      <div className="ns-workspace-grid">
        <aside className="ns-activity-bar" data-region="activity-bar" aria-label="活动栏">
          {activities.map((activity) => {
            const Icon = activity.icon;
            const selected = activity.id === shellState.activeActivity;

            return (
              <button
                {...(selected ? { "aria-current": "page" as const } : {})}
                aria-label={activity.label}
                className="ns-activity-button"
                data-activity-id={activity.id}
                data-focus-order={selected ? "2" : undefined}
                data-selected={selected}
                key={activity.id}
                onClick={() => onActivitySelect?.(activity.id)}
                title={activity.label}
                type="button"
              >
                <Icon aria-hidden="true" size={18} />
              </button>
            );
          })}
        </aside>

        <nav
          aria-label="项目导航"
          className="ns-navigator"
          data-collapsed={shellState.navigatorCollapsed}
          data-region="navigator"
        >
          <div className="ns-panel-header">
            <span>项目</span>
            <span>{shellState.navigatorSections.length}</span>
          </div>
          {projectWorkflow === undefined ? null : (
            <div className="ns-project-workflow">
              <input
                aria-label="项目路径"
                className="ns-project-path"
                onChange={(event) => projectWorkflow.onProjectRootChange(event.currentTarget.value)}
                placeholder="选择或输入项目文件夹"
                value={projectWorkflow.projectRootInput}
              />
              <div className="ns-project-actions">
                <button
                  aria-label="打开项目"
                  className="ns-icon-text-button"
                  disabled={isProjectWorkflowBusy(projectWorkflow)}
                  onClick={projectWorkflow.onOpenProject}
                  title="打开项目"
                  type="button"
                >
                  <FolderOpen aria-hidden="true" size={14} />
                  {projectWorkflow.status === "opening" ? "正在打开" : "打开项目"}
                </button>
                <button
                  aria-label="创建项目"
                  className="ns-icon-text-button"
                  disabled={isProjectWorkflowBusy(projectWorkflow)}
                  onClick={projectWorkflow.onCreateProject}
                  title="创建项目"
                  type="button"
                >
                  <FolderPlus aria-hidden="true" size={14} />
                  {projectWorkflow.status === "creating" ? "正在创建" : "创建项目"}
                </button>
                <button
                  aria-label="新建章节"
                  className="ns-icon-text-button"
                  disabled={isProjectWorkflowBusy(projectWorkflow)}
                  onClick={projectWorkflow.onCreateChapter}
                  title="新建章节"
                  type="button"
                >
                  <FilePlus aria-hidden="true" size={14} />
                  新建章节
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
                <span>{navigatorSectionLabels.get(section.id) ?? section.title}</span>
                <span>{section.itemCount}</span>
              </li>
            ))}
          </ul>
          {projectWorkflow === undefined ? null : (
            <ul className="ns-chapter-tree" aria-label="章节">
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

        <main aria-label="编辑区" className="ns-editor-area" data-region="editor-area">
          {shellState.activeActivity === "workspace" ? (
            <WorkspaceEditorSurface chapterEditor={chapterEditor} />
          ) : (
            <ActivityEmptyState
              activityId={shellState.activeActivity}
              aiWritingWorkflow={aiWritingWorkflow}
              search={search}
            />
          )}
        </main>

        <aside
          aria-label="检查器"
          className="ns-inspector"
          data-collapsed={shellState.inspectorCollapsed}
          data-region="inspector"
        >
          <div className="ns-panel-header">
            <span>检查器</span>
            <PanelRight aria-hidden="true" size={15} />
          </div>
          <dl className="ns-meta-list">
            <div>
              <dt>状态</dt>
              <dd>{saveStatusLabel(shellState.saveStatus)}</dd>
            </div>
            <div>
              <dt>历史</dt>
              <dd>暂无快照</dd>
            </div>
            <div>
              <dt>上下文</dt>
              <dd>{aiWritingWorkflow?.contextTraceLabel ?? "暂无工作流运行"}</dd>
            </div>
          </dl>
          {aiWritingWorkflow === undefined ? null : (
            <section className="ns-ai-workflow" aria-label="AI 写作工作流">
              <div className="ns-editor-panel-header">
                <span>AI 工作流</span>
                <span className="ns-muted">{statusLabel(aiWritingWorkflow.status)}</span>
              </div>
              <textarea
                aria-label="AI 写作指令"
                className="ns-ai-instruction"
                onChange={(event) =>
                  aiWritingWorkflow.onInstructionChange(event.currentTarget.value)
                }
                value={aiWritingWorkflow.instruction}
              />
              <div className="ns-ai-actions">
                <button
                  aria-label="生成 AI 建议"
                  className="ns-icon-text-button"
                  disabled={aiWritingWorkflow.status === "generating"}
                  onClick={aiWritingWorkflow.onGenerateSuggestion}
                  title="生成 AI 建议"
                  type="button"
                >
                  <Sparkles aria-hidden="true" size={14} />
                  生成
                </button>
                <button
                  aria-label="应用 AI 建议"
                  className="ns-icon-text-button"
                  disabled={aiWritingWorkflow.status !== "suggestion-ready"}
                  onClick={aiWritingWorkflow.onApplySuggestion}
                  title="应用 AI 建议"
                  type="button"
                >
                  <Check aria-hidden="true" size={14} />
                  应用
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
            <section className="ns-story-bible-summary" aria-label="故事圣经摘要">
              <div className="ns-editor-panel-header">
                <span>故事圣经</span>
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
                      {asset.contextEligible === true ? <span>可进入上下文</span> : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>

        <section
          aria-label="底部面板"
          className="ns-bottom-panel"
          data-region="bottom-panel"
          data-visible={shellState.bottomPanelVisible}
        >
          <div className="ns-bottom-tabs" role="tablist" aria-label="底部面板标签">
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
                {bottomPanelLabels.get(tab) ?? tab}
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

function WorkspaceEditorSurface({
  chapterEditor
}: {
  readonly chapterEditor: ChapterEditorProps | undefined;
}) {
  return (
    <>
      <div className="ns-tabs" role="tablist" aria-label="打开的资产">
        <button
          aria-selected="true"
          className="ns-tab"
          data-focus-order="3"
          role="tab"
          type="button"
        >
          {chapterEditor?.chapter.frontmatter.title ?? "未命名章节"}
        </button>
      </div>
      <section className="ns-editor-surface" aria-label="章节编辑器表面">
        {chapterEditor ? (
          <ChapterEditor {...chapterEditor} />
        ) : (
          <>
            <div className="ns-document-title">未命名章节</div>
            <p>继续写下一场</p>
            <div className="ns-editor-line" />
            <div className="ns-editor-line ns-editor-line-short" />
          </>
        )}
      </section>
    </>
  );
}

function ActivityEmptyState({
  activityId,
  aiWritingWorkflow,
  search
}: {
  readonly activityId: ActivityId;
  readonly aiWritingWorkflow: AiWritingWorkflowProps | undefined;
  readonly search: ProjectSearchProps | undefined;
}) {
  if (activityId === "search" && search !== undefined) {
    return <ProjectSearchView search={search} />;
  }

  if (activityId === "ai") {
    return (
      <section className="ns-activity-view" aria-label="AI 工作流主视图">
        <h1>AI 工作流</h1>
        <p>AI 输出保持建议态，应用到正文前需要你确认。</p>
        {aiWritingWorkflow === undefined ? (
          <p>打开项目章节后可以生成写作建议。</p>
        ) : (
          <div className="ns-activity-view-actions">
            <span>当前状态：{statusLabel(aiWritingWorkflow.status)}</span>
          </div>
        )}
      </section>
    );
  }
  if (activityId === "workspace") {
    return null;
  }

  const copy = activityViewCopy(activityId);

  return (
    <section className="ns-activity-view" aria-label={`${copy.title}视图`}>
      <h1>{copy.title}</h1>
      <p>{copy.description}</p>
      <div className="ns-activity-view-actions">
        <span>{copy.nextAction}</span>
      </div>
    </section>
  );
}

function ProjectSearchView({ search }: { readonly search: ProjectSearchProps }) {
  const busy = search.status === "indexing" || search.status === "searching";

  return (
    <section className="ns-search-view" aria-label="项目全文搜索">
      <h1>搜索项目</h1>
      <form
        className="ns-search-toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          search.onSearch();
        }}
      >
        <label className="ns-search-input-label">
          <span>关键词</span>
          <input
            aria-label="搜索关键词"
            className="ns-search-input"
            onChange={(event) => search.onQueryChange(event.currentTarget.value)}
            placeholder="搜索章节、人物、世界观和记忆"
            value={search.query}
          />
        </label>
        <button
          className="ns-icon-text-button"
          disabled={busy || search.query.trim().length === 0}
          type="submit"
        >
          <Search aria-hidden="true" size={14} />
          {search.status === "searching" ? "搜索中" : "搜索"}
        </button>
        <button
          className="ns-icon-text-button"
          disabled={busy}
          onClick={search.onRebuildIndex}
          type="button"
        >
          <Clock3 aria-hidden="true" size={14} />
          {search.status === "indexing" ? "重建中" : "重建索引"}
        </button>
      </form>

      <div className="ns-search-meta" role="status">
        <span>索引条目 {search.entryCount ?? 0}</span>
        <span>
          {search.generatedAt === undefined ? "尚未重建" : formatSearchDate(search.generatedAt)}
        </span>
      </div>

      {search.feedback === undefined ? null : (
        <p className="ns-project-feedback" data-kind={search.feedback.kind} role="status">
          {search.feedback.message}
        </p>
      )}

      {search.results.length === 0 ? (
        <div className="ns-search-empty">
          {search.status === "empty" ? "没有找到匹配结果。" : "输入关键词后搜索，或先重建索引。"}
        </div>
      ) : (
        <ol className="ns-search-results" aria-label="搜索结果">
          {search.results.map((result) => (
            <li className="ns-search-result" key={result.id}>
              <div className="ns-search-result-header">
                <span>{searchResultTypeLabel(result.type)}</span>
                <strong>{result.title}</strong>
                <span>分数 {result.score}</span>
              </div>
              <p>{result.snippet}</p>
              <div className="ns-search-result-source">{result.sourceRef.relativePath}</div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function searchResultTypeLabel(type: ProjectSearchResultItem["type"]): string {
  switch (type) {
    case "chapter":
      return "章节";
    case "story.character":
      return "人物";
    case "story.world":
      return "世界观";
    case "story.outline":
      return "大纲";
    case "story.timeline":
      return "时间线";
    case "memory":
      return "记忆";
  }
}

function formatSearchDate(value: string): string {
  return `索引 ${value.slice(0, 10)} ${value.slice(11, 16)}`;
}

function activityViewCopy(activityId: Exclude<ActivityId, "workspace" | "ai">): {
  readonly title: string;
  readonly description: string;
  readonly nextAction: string;
} {
  switch (activityId) {
    case "search":
      return {
        title: "搜索项目",
        description: "全文搜索将在索引完成后显示结果。",
        nextAction: "下一步：接入可重建搜索索引。"
      };
    case "timeline":
      return {
        title: "时间线",
        description: "时间线事件已进入 Story Bible 数据层，完整可视化编辑会在后续里程碑补齐。",
        nextAction: "下一步：打开故事圣经时间线编辑器。"
      };
    case "studio":
      return {
        title: "创作系统",
        description: "提示词、Agent 和工作流配置已经有安全边界，完整编辑体验会继续产品化。",
        nextAction: "下一步：完善 Prompt / Agent / Workflow Studio。"
      };
    case "settings":
      return {
        title: "设置",
        description: "模型 profile、插件和隐私设置将集中在这里管理。",
        nextAction: "下一步：补齐设置分区和连接测试入口。"
      };
  }
}

function isProjectWorkflowBusy(projectWorkflow: ProjectWorkflowProps): boolean {
  return projectWorkflow.status === "opening" || projectWorkflow.status === "creating";
}

function statusLabel(status: AiWritingWorkflowStatus): string {
  switch (status) {
    case "idle":
      return "空闲";
    case "generating":
      return "生成中";
    case "suggestion-ready":
      return "待确认";
    case "applied":
      return "已应用";
  }
}

function saveStatusLabel(status: DesktopShellState["saveStatus"]): string {
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
