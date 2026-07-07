import type {
  ActivityId,
  DesktopShellState,
  ProjectSearchResultItem
} from "@novel-studio/application";
import type { ChapterSummary } from "@novel-studio/shared";
import type { CSSProperties } from "react";
import type { ChapterEditorProps } from "./chapter-editor.js";
import type { ConfigStudioAssetType, ConfigStudioPanelProps } from "./config-studio-panel.js";
import type { ModelSettingsPanelProps } from "./model-settings-panel.js";
import {
  Bot,
  Boxes,
  Clock3,
  FilePlus,
  FolderTree,
  FolderOpen,
  FolderPlus,
  BookOpen,
  PanelBottom,
  PanelRight,
  Search,
  Settings,
  X
} from "lucide-react";

import { ChapterEditor } from "./chapter-editor.js";
import { CommandPalette } from "./command-palette.js";
import { ConfigStudioPanel } from "./config-studio-panel.js";
import { ModelSettingsPanel } from "./model-settings-panel.js";
import { AiWritingAssistantPanel, statusLabel } from "./workspace-shell-ai.js";
import { createPanelResizeHandler } from "./workspace-shell-layout.js";
import {
  ProjectSearchView,
  StoryBibleEditorView,
  TimelineMainView
} from "./workspace-shell-story-search.js";
import { AutosaveRecoveryNotice, OnboardingQuickStart } from "./workspace-shell-project-assist.js";
import type {
  AiWritingWorkflowProps,
  OnboardingProps,
  ProjectSearchProps,
  ProjectWorkflowProps,
  StoryBibleEditorKind,
  StoryBibleEditorProps,
  WorkspaceShellProps
} from "./workspace-shell-types.js";

const activities = [
  { id: "workspace", label: "工作区", icon: FolderTree },
  { id: "search", label: "搜索", icon: Search },
  { id: "storyBible", label: "故事圣经", icon: BookOpen },
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

const storyBibleKindByNavigatorSection: ReadonlyMap<string, StoryBibleEditorKind> = new Map([
  ["characters", "character"],
  ["world", "world"],
  ["outline", "outline"],
  ["timeline", "timeline"],
  ["memories", "memory"]
]);

const studioAssetTypeByNavigatorSection: ReadonlyMap<string, ConfigStudioAssetType> = new Map([
  ["prompts", "prompt"],
  ["agents", "agent"],
  ["workflows", "workflow"]
]);

const bottomPanelLabels: ReadonlyMap<string, string> = new Map([
  ["Workflow Run", "工作流运行"],
  ["Problems", "问题"],
  ["Search", "搜索"],
  ["Logs", "日志"]
]);

const defaultWorkspaceLayout: DesktopShellState["workspaceLayout"] = {
  splitView: false,
  navigatorWidth: 260,
  inspectorWidth: 320,
  bottomPanelHeight: 220
};

export function WorkspaceShell({
  shellState,
  commands,
  commandPaletteOpen,
  commandPaletteFeedback,
  commandPaletteQuery,
  commandPaletteSelectedCommandId,
  chapterEditor,
  projectWorkflow,
  aiWritingWorkflow,
  search,
  settings,
  studio,
  storyBible,
  storyBibleEditor,
  onboarding,
  onCommandPaletteOpen,
  onCommandPaletteQueryChange,
  onCommandPaletteActiveCommandChange,
  onCommandExecute,
  onBottomPanelTabSelect,
  onSearchResultOpen,
  onTimelineEntryOpen,
  onActivitySelect
}: WorkspaceShellProps) {
  const activeBottomPanelTab =
    shellState.bottomPanelTabs.includes(shellState.activeBottomPanelTab) === true
      ? shellState.activeBottomPanelTab
      : (shellState.bottomPanelTabs[0] ?? "工作流运行");
  const workspaceLayout = shellState.workspaceLayout ?? defaultWorkspaceLayout;
  const workspaceGridStyle = {
    "--ns-navigator-width": shellState.navigatorCollapsed
      ? "0px"
      : `${workspaceLayout.navigatorWidth}px`,
    "--ns-ai-panel-width": `${workspaceLayout.inspectorWidth}px`,
    "--ns-bottom-panel-height": shellState.bottomPanelVisible
      ? `${workspaceLayout.bottomPanelHeight}px`
      : "0px"
  } as CSSProperties;

  return (
    <div className="ns-shell" data-theme="dark">
      <header className="ns-titlebar">
        <div className="ns-project-status">
          <span className="ns-project-title">{shellState.projectTitle}</span>
          <span className="ns-save-status">{saveStatusLabel(shellState.saveStatus)}</span>
        </div>
        <button
          aria-label="打开命令面板"
          className="ns-command-button"
          data-focus-order="1"
          onClick={onCommandPaletteOpen}
          title="打开命令面板"
          type="button"
        >
          命令面板 <kbd>Ctrl/Cmd+K</kbd>
        </button>
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
        </div>
      </header>

      <div
        className="ns-workspace-grid"
        data-split-view={workspaceLayout.splitView}
        style={workspaceGridStyle}
      >
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
            {shellState.navigatorSections.map((section) => {
              const label = navigatorSectionLabels.get(section.id) ?? section.title;
              return (
                <li key={section.id}>
                  <details
                    aria-label={`${label} 分组`}
                    className="ns-tree-group"
                    data-selected={navigatorSectionSelected(section.id, shellState.activeActivity)}
                    open
                  >
                    <summary
                      className="ns-tree-row"
                      onClick={() =>
                        handleNavigatorSectionOpen({
                          sectionId: section.id,
                          onActivitySelect,
                          storyBibleEditor,
                          studio
                        })
                      }
                    >
                      <span>{label}</span>
                      <span>{section.itemCount}</span>
                    </summary>
                    {section.id === "chapters" && projectWorkflow !== undefined ? (
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
                    ) : null}
                  </details>
                </li>
              );
            })}
          </ul>
        </nav>

        <div
          aria-label="Navigator resize handle"
          aria-orientation="vertical"
          aria-valuemax={420}
          aria-valuemin={220}
          aria-valuenow={workspaceLayout.navigatorWidth}
          className="ns-resize-handle ns-resize-handle-navigator"
          onPointerDown={createPanelResizeHandler("navigator")}
          role="separator"
        />

        <main aria-label="编辑区" className="ns-editor-area" data-region="editor-area">
          {shellState.activeActivity === "workspace" || shellState.activeActivity === "ai" ? (
            <WorkspaceEditorSurface
              chapterEditor={chapterEditor}
              onboarding={onboarding}
              projectWorkflow={projectWorkflow}
              splitView={workspaceLayout.splitView}
            />
          ) : (
            <ActivityEmptyState
              activityId={shellState.activeActivity}
              aiWritingWorkflow={aiWritingWorkflow}
              search={search}
              settings={settings}
              studio={studio}
              storyBibleEditor={storyBibleEditor}
              onSearchResultOpen={onSearchResultOpen}
              onTimelineEntryOpen={onTimelineEntryOpen}
            />
          )}
        </main>

        <div
          aria-label="AI panel resize handle"
          aria-orientation="vertical"
          aria-valuemax={520}
          aria-valuemin={280}
          aria-valuenow={workspaceLayout.inspectorWidth}
          className="ns-resize-handle ns-resize-handle-ai"
          onPointerDown={createPanelResizeHandler("ai")}
          role="separator"
        />

        <aside aria-label="AI 对话面板" className="ns-ai-panel" data-region="ai-panel">
          <div className="ns-panel-header">
            <span>AI 对话</span>
            <PanelRight aria-hidden="true" size={15} />
          </div>
          {aiWritingWorkflow === undefined ? (
            <section className="ns-ai-workflow ns-ai-placeholder" aria-label="AI 写作工作流">
              <div className="ns-editor-panel-header">
                <span>对话式写作助手</span>
                <span className="ns-muted">未加载</span>
              </div>
              <p className="ns-ai-context">打开项目章节后，可以在这里向 AI 提出续写或修改要求。</p>
              <textarea
                aria-label="AI 写作指令"
                className="ns-ai-instruction"
                disabled
                placeholder="和 AI 说明你想怎么改写或续写当前章节"
              />
              <div className="ns-ai-actions">
                <button className="ns-icon-text-button" disabled type="button">
                  生成建议
                </button>
              </div>
            </section>
          ) : (
            <AiWritingAssistantPanel workflow={aiWritingWorkflow} />
          )}
          <dl className="ns-meta-list">
            <div>
              <dt>保存</dt>
              <dd>{saveStatusLabel(shellState.saveStatus)}</dd>
            </div>
            <div>
              <dt>上下文</dt>
              <dd>{aiWritingWorkflow?.contextTraceLabel ?? "暂无工作流运行"}</dd>
            </div>
          </dl>
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
                aria-label={`切换底部面板：${bottomPanelLabels.get(tab) ?? tab}`}
                aria-selected={tab === activeBottomPanelTab}
                className="ns-bottom-tab"
                data-focus-order={index === 0 ? "4" : undefined}
                key={tab}
                onClick={() => onBottomPanelTabSelect?.(tab)}
                role="tab"
                title={`切换到底部面板：${bottomPanelLabels.get(tab) ?? tab}`}
                type="button"
              >
                {bottomPanelLabels.get(tab) ?? tab}
              </button>
            ))}
          </div>
          <BottomPanelContent
            activeTab={activeBottomPanelTab}
            aiWritingWorkflow={aiWritingWorkflow}
            projectWorkflow={projectWorkflow}
            search={search}
          />
        </section>
      </div>

      <StatusBar
        aiWritingWorkflow={aiWritingWorkflow}
        chapterEditor={chapterEditor}
        shellState={shellState}
      />

      <CommandPalette
        commands={commands}
        executionFeedback={commandPaletteFeedback}
        onActiveCommandChange={onCommandPaletteActiveCommandChange}
        onCommandExecute={onCommandExecute}
        onQueryChange={onCommandPaletteQueryChange}
        open={commandPaletteOpen || shellState.commandPaletteOpen}
        query={commandPaletteQuery}
        selectedCommandId={commandPaletteSelectedCommandId}
      />
    </div>
  );
}

function StatusBar({
  aiWritingWorkflow,
  chapterEditor,
  shellState
}: {
  readonly aiWritingWorkflow: AiWritingWorkflowProps | undefined;
  readonly chapterEditor: ChapterEditorProps | undefined;
  readonly shellState: DesktopShellState;
}) {
  const chapterLabel = chapterEditor?.chapter.frontmatter.title ?? "未命名章节";
  const aiStatus =
    aiWritingWorkflow === undefined ? "AI 未加载" : `AI ${statusLabel(aiWritingWorkflow.status)}`;

  return (
    <footer aria-label="状态栏" className="ns-status-bar" data-region="status-bar">
      <span>{saveStatusLabel(shellState.saveStatus)}</span>
      <span>{chapterLabel}</span>
      <span>Markdown</span>
      <span>{aiStatus}</span>
    </footer>
  );
}

function navigatorSectionSelected(sectionId: string, activeActivity: ActivityId): boolean {
  if (sectionId === "chapters") {
    return activeActivity === "workspace";
  }

  if (sectionId === "timeline") {
    return activeActivity === "timeline";
  }

  if (storyBibleKindByNavigatorSection.has(sectionId)) {
    return activeActivity === "storyBible";
  }

  if (studioAssetTypeByNavigatorSection.has(sectionId)) {
    return activeActivity === "studio";
  }

  return false;
}

function BottomPanelContent({
  activeTab,
  aiWritingWorkflow,
  projectWorkflow,
  search
}: {
  readonly activeTab: string;
  readonly aiWritingWorkflow: AiWritingWorkflowProps | undefined;
  readonly projectWorkflow: ProjectWorkflowProps | undefined;
  readonly search: ProjectSearchProps | undefined;
}) {
  const label = bottomPanelLabels.get(activeTab) ?? activeTab;

  if (activeTab === "工作流运行") {
    const runCount = aiWritingWorkflow?.history?.runs.length ?? 0;
    return (
      <div className="ns-bottom-panel-content" aria-label="底部面板内容：工作流运行">
        <strong>工作流运行</strong>
        <span>
          当前状态{" "}
          {aiWritingWorkflow === undefined ? "未加载" : statusLabel(aiWritingWorkflow.status)}
        </span>
        <span>最近运行 {runCount}</span>
        <span>
          {aiWritingWorkflow?.failure === undefined
            ? "暂无失败诊断"
            : `失败诊断 ${aiWritingWorkflow.failure.code}`}
        </span>
      </div>
    );
  }

  if (activeTab === "问题") {
    if (projectWorkflow?.health !== undefined) {
      const health = projectWorkflow.health;
      return (
        <div className="ns-project-health" aria-label="Project health diagnostics">
          <div className="ns-project-health-summary">
            <strong>Project Health {health.status}</strong>
            <span>Checked {health.checkedAt}</span>
            <span>Errors {health.summary.errorCount}</span>
            <span>Warnings {health.summary.warningCount}</span>
            <span>Info {health.summary.infoCount}</span>
          </div>
          <ol className="ns-project-health-list">
            {health.issues.map((issue) => (
              <li className="ns-project-health-issue" data-severity={issue.severity} key={issue.id}>
                <div>
                  <strong>{issue.title}</strong>
                  <span>{issue.source}</span>
                </div>
                <p>{issue.message}</p>
                <span>{issue.suggestedAction}</span>
              </li>
            ))}
          </ol>
        </div>
      );
    }

    return (
      <div className="ns-bottom-panel-content" aria-label="底部面板内容：问题">
        <strong>问题</strong>
        <span>底部面板已进入可切换状态。</span>
        <span>仍待补齐：自动保存恢复、时间线可视化、项目健康诊断。</span>
        <span>当前问题均为产品化缺口，不阻断章节编辑和保存。</span>
      </div>
    );
  }

  if (activeTab === "搜索") {
    return (
      <div className="ns-bottom-panel-content" aria-label="底部面板内容：搜索">
        <strong>搜索摘要</strong>
        <span>索引条目 {search?.entryCount ?? 0}</span>
        <span>
          当前查询 {search?.query.trim() === "" || search === undefined ? "未输入" : search.query}
        </span>
        <span>结果数量 {search?.results.length ?? 0}</span>
      </div>
    );
  }

  if (activeTab === "日志") {
    return (
      <div className="ns-bottom-panel-content" aria-label="底部面板内容：日志">
        <strong>日志</strong>
        <span>本地 beta 不采集 telemetry。</span>
        <span>CI 和默认工作流不会访问真实模型 endpoint。</span>
        <span>安装产物通过 artifact secret scan 后才记录为可用。</span>
      </div>
    );
  }

  return (
    <div className="ns-bottom-panel-content" aria-label={`底部面板内容：${label}`}>
      <strong>{label}</strong>
      <span>该面板暂无内容。</span>
    </div>
  );
}

function WorkspaceEditorSurface({
  chapterEditor,
  onboarding,
  projectWorkflow,
  splitView
}: {
  readonly chapterEditor: ChapterEditorProps | undefined;
  readonly onboarding: OnboardingProps | undefined;
  readonly projectWorkflow: ProjectWorkflowProps | undefined;
  readonly splitView: boolean;
}) {
  const activeChapterId =
    projectWorkflow?.activeChapterId ?? chapterEditor?.chapter.frontmatter.id ?? undefined;
  const chapterTabs = projectWorkflow?.chapters ?? [];
  const openChapterTabIds =
    projectWorkflow?.openChapterTabIds ?? chapterTabs.map((chapter) => chapter.id);
  const visibleTabs = openChapterTabIds
    .map((chapterId) => chapterTabs.find((chapter) => chapter.id === chapterId))
    .filter((chapter): chapter is ChapterSummary => chapter !== undefined);
  const dirtyChapterIds = new Set(projectWorkflow?.dirtyChapterIds ?? []);

  return (
    <>
      <div className="ns-tabs" role="tablist" aria-label="章节标签">
        {visibleTabs.length === 0 ? (
          <span
            aria-selected="true"
            className="ns-tab ns-tab-static"
            data-focus-order="3"
            role="tab"
          >
            {chapterEditor?.chapter.frontmatter.title ?? "未命名章节"}
          </span>
        ) : (
          visibleTabs.map((chapter, index) => (
            <div
              aria-selected={chapter.id === activeChapterId}
              className="ns-tab"
              data-dirty={dirtyChapterIds.has(chapter.id)}
              data-focus-order={index === 0 ? "3" : undefined}
              key={chapter.id}
              role="tab"
            >
              <button
                aria-label={`切换章节标签：${chapter.title}`}
                className="ns-tab-select"
                onClick={() => projectWorkflow?.onSelectChapter(chapter.id)}
                type="button"
              >
                <span>{chapter.title}</span>
                {dirtyChapterIds.has(chapter.id) ? <span aria-label="未保存">●</span> : null}
              </button>
              {visibleTabs.length <= 1 ? null : (
                <button
                  aria-label={`关闭章节标签：${chapter.title}`}
                  className="ns-tab-close"
                  onClick={() => projectWorkflow?.onCloseChapterTab?.(chapter.id)}
                  title={`关闭章节标签：${chapter.title}`}
                  type="button"
                >
                  <X aria-hidden="true" size={13} />
                </button>
              )}
            </div>
          ))
        )}
      </div>
      <div className="ns-editor-panes" data-split-view={splitView}>
        <section className="ns-editor-surface" aria-label="章节编辑器表面">
          <OnboardingQuickStart onboarding={onboarding} />
          <AutosaveRecoveryNotice projectWorkflow={projectWorkflow} />
          {chapterEditor ? (
            <ChapterEditor {...chapterEditor} />
          ) : (
            <section className="ns-empty-editor" aria-label="空章节工作区">
              <div>
                <div className="ns-document-title">未命名章节</div>
                <p>继续写下一场。创建第一章后开始写正文，或先打开已有项目继续编辑。</p>
              </div>
              <button
                aria-label="新建第一章"
                className="ns-icon-text-button"
                disabled={projectWorkflow === undefined || isProjectWorkflowBusy(projectWorkflow)}
                onClick={projectWorkflow?.onCreateChapter}
                type="button"
              >
                <FilePlus aria-hidden="true" size={14} />
                新建第一章
              </button>
              <div className="ns-editor-line" />
              <div className="ns-editor-line ns-editor-line-short" />
            </section>
          )}
        </section>
        {splitView ? (
          <aside className="ns-split-reference-pane" aria-label="拆分参考窗格">
            <div className="ns-editor-panel-header">
              <span>参考窗格</span>
              <span className="ns-muted">Split View</span>
            </div>
            <p>保留当前章节编辑器，同时为故事圣经、搜索结果或版本对照预留并排空间。</p>
          </aside>
        ) : null}
      </div>
    </>
  );
}

function ActivityEmptyState({
  activityId,
  aiWritingWorkflow,
  search,
  settings,
  studio,
  storyBibleEditor,
  onSearchResultOpen,
  onTimelineEntryOpen
}: {
  readonly activityId: ActivityId;
  readonly aiWritingWorkflow: AiWritingWorkflowProps | undefined;
  readonly search: ProjectSearchProps | undefined;
  readonly settings: ModelSettingsPanelProps | undefined;
  readonly studio: ConfigStudioPanelProps | undefined;
  readonly storyBibleEditor: StoryBibleEditorProps | undefined;
  readonly onSearchResultOpen: ((result: ProjectSearchResultItem) => void) | undefined;
  readonly onTimelineEntryOpen: ((entryId: string) => void) | undefined;
}) {
  if (activityId === "search" && search !== undefined) {
    return <ProjectSearchView search={{ ...search, onResultOpen: onSearchResultOpen }} />;
  }

  if (activityId === "storyBible" && storyBibleEditor !== undefined) {
    return <StoryBibleEditorView editor={storyBibleEditor} />;
  }

  if (activityId === "settings" && settings !== undefined) {
    return <ModelSettingsPanel {...settings} />;
  }

  if (activityId === "studio" && studio !== undefined) {
    return <ConfigStudioPanel {...studio} />;
  }

  if (activityId === "timeline") {
    return <TimelineMainView editor={storyBibleEditor} onTimelineEntryOpen={onTimelineEntryOpen} />;
  }

  if (activityId === "storyBible") {
    return (
      <section className="ns-activity-view" aria-label="故事圣经视图">
        <h1>故事圣经</h1>
        <p>打开项目后可以编辑人物、世界观、大纲、时间线和记忆。</p>
        <div className="ns-activity-view-actions">
          <span>下一步：打开项目并加载故事圣经。</span>
        </div>
      </section>
    );
  }

  if (activityId === "ai") {
    return (
      <section className="ns-activity-view" aria-label="AI 工作流主视图">
        <h1>AI 写作助手</h1>
        <p>像对话一样提出写作要求，AI 只生成建议；写入正文前仍需要你确认应用。</p>
        {aiWritingWorkflow === undefined ? (
          <p>打开项目章节后可以生成写作建议。</p>
        ) : (
          <AiWritingAssistantPanel workflow={aiWritingWorkflow} />
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

function activityViewCopy(activityId: Exclude<ActivityId, "workspace" | "ai" | "storyBible">): {
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

function handleNavigatorSectionOpen({
  sectionId,
  onActivitySelect,
  storyBibleEditor,
  studio
}: {
  readonly sectionId: string;
  readonly onActivitySelect: ((activityId: ActivityId) => void) | undefined;
  readonly storyBibleEditor: StoryBibleEditorProps | undefined;
  readonly studio: ConfigStudioPanelProps | undefined;
}) {
  const storyBibleKind = storyBibleKindByNavigatorSection.get(sectionId);
  if (storyBibleKind !== undefined) {
    if (sectionId === "timeline") {
      onActivitySelect?.("timeline");
    } else {
      onActivitySelect?.("storyBible");
    }
    storyBibleEditor?.onKindSelect(storyBibleKind);
    return;
  }

  const studioAssetType = studioAssetTypeByNavigatorSection.get(sectionId);
  if (studioAssetType !== undefined) {
    onActivitySelect?.("studio");
    const firstAsset = studio?.assets.find((asset) => asset.assetType === studioAssetType);
    if (firstAsset !== undefined) {
      studio?.onAssetSelect?.(firstAsset.assetType, firstAsset.assetId);
    }
    return;
  }

  if (sectionId === "chapters") {
    onActivitySelect?.("workspace");
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
