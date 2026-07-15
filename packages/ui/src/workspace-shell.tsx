import type {
  ActivityId,
  DesktopShellState,
  ProjectSearchResultItem
} from "@novel-studio/application";
import type { ChapterSummary } from "@novel-studio/shared";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties
} from "react";
import type { ChapterEditorProps } from "./chapter-editor.js";
import type { ConfigStudioPanelProps } from "./config-studio-panel.js";
import {
  DEFAULT_EDITOR_PREFERENCES,
  editorFontFamilyValue
} from "./editor-toolbar.js";
import {
  Bot,
  Boxes,
  Clock3,
  FilePlus,
  FolderTree,
  BookOpen,
  Maximize2,
  PanelBottom,
  PanelRight,
  Search,
  Settings
} from "lucide-react";

import { ChapterEditor } from "./chapter-editor.js";
import { AgentConversationNavigator } from "./agent-conversation-navigator.js";
import { AgentConversationView } from "./agent-conversation-view.js";
import { PlanArtifactReview } from "./plan-artifact-review.js";
import { CodeMirrorDocumentEditor } from "./codemirror-document-editor.js";
import { CommandPalette } from "./command-palette.js";
import { ConfigStudioPanel } from "./config-studio-panel.js";
import {
  chapterDocumentLabel,
  EditorDocumentBar,
  type EditorDocumentTab
} from "./editor-document-bar.js";
import { EditorFindReplace, type EditorFindMode } from "./editor-find-replace.js";
import { SettingsWorkspace } from "./settings-workspace.js";
import { AiWritingAssistantPanel, statusLabel } from "./workspace-shell-ai.js";
import { createPanelResizeHandler } from "./workspace-shell-layout.js";
import {
  ProjectSearchView,
  StoryBibleEditorView,
  TimelineMainView
} from "./workspace-shell-story-search.js";
import { AutosaveRecoveryNotice, OnboardingQuickStart } from "./workspace-shell-project-assist.js";
import { WorkspaceNavigator } from "./workspace-navigator.js";
import { DiffReview } from "./diff-review.js";
import { RollbackReview } from "./change-set-review.js";
import { WorkspaceStatusBar } from "./workspace-status-bar.js";
import type {
  AiWritingWorkflowProps,
  OnboardingProps,
  PlainFileEditorProps,
  ProjectSearchProps,
  ProjectWorkflowProps,
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

export function WorkspaceShell(props: WorkspaceShellProps) {
  return <WorkspaceShellContent {...props} />;
}

function WorkspaceShellContent({
  appearancePreferences,
  shellState,
  commands,
  commandPaletteOpen,
  commandPaletteFeedback,
  commandPaletteQuery,
  commandPaletteSelectedCommandId,
  chapterEditor,
  projectWorkflow,
  aiWritingWorkflow,
  agentConversationWorkspace,
  search,
  settings,
  studio,
  storyBible,
  storyBibleEditor,
  fileEditor,
  onboarding,
  onCommandPaletteOpen,
  onCommandPaletteQueryChange,
  onCommandPaletteActiveCommandChange,
  onCommandExecute,
  onBottomPanelTabSelect,
  onSearchResultOpen,
  onTimelineEntryOpen,
  onActivitySelect,
  onSettingsClose,
  navigatorSearchQuery,
  onNavigatorSearchQueryChange,
  onNavigatorExpandedSectionIdsChange
}: WorkspaceShellProps) {
  const [fileSelection, setFileSelection] = useState({ anchor: 0, head: 0 });
  const appearance = appearancePreferences ?? {
    theme: "dark" as const,
    accentColor: "teal" as const
  };
  const focusMode = shellState.focusMode === true;
  const settingsMode = shellState.activeActivity === "settings";
  const editorActivity =
    shellState.activeActivity === "workspace" || shellState.activeActivity === "ai";
  const hasActiveDocument =
    editorActivity && (fileEditor !== undefined || chapterEditor !== undefined);
  const activeBottomPanelTab =
    shellState.bottomPanelTabs.includes(shellState.activeBottomPanelTab) === true
      ? shellState.activeBottomPanelTab
      : (shellState.bottomPanelTabs[0] ?? "工作流运行");
  const workspaceLayout = shellState.workspaceLayout ?? defaultWorkspaceLayout;
  const workspaceGridStyle = {
    "--ns-navigator-width":
      focusMode || shellState.navigatorCollapsed ? "0px" : `${workspaceLayout.navigatorWidth}px`,
    "--ns-ai-panel-width": focusMode ? "0px" : `${workspaceLayout.inspectorWidth}px`,
    "--ns-bottom-panel-height":
      !focusMode && shellState.bottomPanelVisible ? `${workspaceLayout.bottomPanelHeight}px` : "0px"
  } as CSSProperties;

  useEffect(() => {
    setFileSelection({ anchor: 0, head: 0 });
  }, [fileEditor?.path]);

  return (
    <div
      className="ns-shell"
      data-accent={appearance.accentColor}
      data-focus-mode={focusMode}
      data-has-active-document={hasActiveDocument}
      data-settings-mode={settingsMode}
      data-theme={appearance.theme}
    >
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
      </header>

      {settingsMode ? (
        <SettingsWorkspace onClose={onSettingsClose} settings={settings} />
      ) : (
        <>
      <div
        className="ns-workspace-grid"
        data-agent-conversation={
          shellState.activeActivity === "ai" && agentConversationWorkspace !== undefined
        }
        data-focus-mode={focusMode}
            data-split-view={workspaceLayout.splitView}
            style={workspaceGridStyle}
          >
        <aside
          className="ns-activity-bar"
          data-focus-hidden={focusMode}
          data-region="activity-bar"
          aria-label="活动栏"
        >
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

        {shellState.activeActivity === "ai" && agentConversationWorkspace !== undefined ? (
          <div
            className="ns-agent-conversation-navigator-region"
            data-collapsed={focusMode || shellState.navigatorCollapsed}
            data-focus-hidden={focusMode || shellState.navigatorCollapsed}
          >
            <AgentConversationNavigator {...agentConversationWorkspace.navigator} />
          </div>
        ) : (
          <WorkspaceNavigator
            activeActivity={shellState.activeActivity}
            collapsed={focusMode || shellState.navigatorCollapsed}
            expandedSectionIds={shellState.navigatorExpandedSectionIds}
            fileTree={projectWorkflow?.fileTree}
            focusHidden={focusMode}
            onActivitySelect={onActivitySelect}
            onExpandedSectionIdsChange={onNavigatorExpandedSectionIdsChange}
            onSearchQueryChange={onNavigatorSearchQueryChange}
            projectWorkflow={projectWorkflow}
            searchQuery={navigatorSearchQuery}
            sections={shellState.navigatorSections}
            storyBibleEditor={storyBibleEditor}
            studio={studio}
          />
        )}

        <div
          aria-label="Navigator resize handle"
          aria-orientation="vertical"
          aria-valuemax={420}
          aria-valuemin={220}
          aria-valuenow={workspaceLayout.navigatorWidth}
          className="ns-resize-handle ns-resize-handle-navigator"
          data-focus-hidden={focusMode}
          onPointerDown={createPanelResizeHandler("navigator")}
          role="separator"
        />

        <main aria-label="编辑区" className="ns-editor-area" data-region="editor-area">
          {shellState.activeActivity === "ai" &&
          agentConversationWorkspace?.mainReview?.kind === "rollback" ? (
            <RollbackReview review={agentConversationWorkspace.mainReview.props} />
          ) : shellState.activeActivity === "ai" &&
            agentConversationWorkspace?.mainReview?.kind === "change_set" ? (
            <DiffReview review={agentConversationWorkspace.mainReview.props} />
          ) : shellState.activeActivity === "ai" &&
            agentConversationWorkspace?.mainReview?.kind === "plan" ? (
            <PlanArtifactReview {...agentConversationWorkspace.mainReview.props} />
          ) : aiWritingWorkflow?.agentRun?.rollbackReview !== undefined &&
          aiWritingWorkflow.agentRun.rollbackReview.open !== false &&
          shellState.activeActivity === "workspace" ? (
            <RollbackReview review={aiWritingWorkflow.agentRun.rollbackReview} />
          ) : aiWritingWorkflow?.agentRun?.changeSetReview !== undefined &&
          aiWritingWorkflow.agentRun.changeSetReview.open !== false &&
          shellState.activeActivity === "workspace" ? (
            <DiffReview review={aiWritingWorkflow.agentRun.changeSetReview} />
          ) : shellState.activeActivity === "workspace" || shellState.activeActivity === "ai" ? (
            <WorkspaceEditorSurface
              chapterEditor={chapterEditor}
              fileEditor={fileEditor}
              onboarding={onboarding}
              projectWorkflow={projectWorkflow}
              splitView={workspaceLayout.splitView}
              onFileSelectionChange={setFileSelection}
            />
          ) : (
            <ActivityEmptyState
              activityId={shellState.activeActivity}
              aiWritingWorkflow={aiWritingWorkflow}
              search={search}
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
          data-focus-hidden={focusMode}
          onPointerDown={createPanelResizeHandler("ai")}
          role="separator"
        />

        <aside
          aria-label="AI 对话面板"
          className="ns-ai-panel"
          data-focus-hidden={focusMode}
          data-region="ai-panel"
        >
          <div className="ns-panel-header">
            <span>
              {shellState.activeActivity === "ai" && agentConversationWorkspace !== undefined
                ? "Agent 运行"
                : "AI 对话"}
            </span>
            <PanelRight aria-hidden="true" size={15} />
          </div>
          {shellState.activeActivity === "ai" && agentConversationWorkspace !== undefined ? (
            <AgentConversationView {...agentConversationWorkspace.view} />
          ) : aiWritingWorkflow === undefined ? (
            <section className="ns-ai-workflow ns-ai-placeholder" aria-label="AI 写作工作流">
              <div className="ns-editor-panel-header">
                <span>对话式写作助手</span>
                <span className="ns-muted">未加载</span>
              </div>
              <p className="ns-ai-context">打开项目章节后，可以在这里向 AI 提出续写或修改要求。</p>
              <section className="ns-ai-composer" aria-label="AI 输入区">
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
            </section>
          ) : (
            <AiWritingAssistantPanel workflow={aiWritingWorkflow} />
          )}
          {storyBible === undefined ? null : (
            <details className="ns-story-bible-summary" aria-label="故事圣经摘要">
              <summary>故事圣经</summary>
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
            </details>
          )}
        </aside>

        <section
          aria-label="底部面板"
          className="ns-bottom-panel"
          data-focus-hidden={focusMode}
          data-region="bottom-panel"
          data-visible={!focusMode && shellState.bottomPanelVisible}
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

          <WorkspaceStatusBar
            chapterEditor={editorActivity ? chapterEditor : undefined}
            fileEditor={editorActivity ? fileEditor : undefined}
            fileSelection={fileSelection}
          />
        </>
      )}

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
  fileEditor,
  onboarding,
  projectWorkflow,
  splitView,
  onFileSelectionChange
}: {
  readonly chapterEditor: ChapterEditorProps | undefined;
  readonly fileEditor: PlainFileEditorProps | undefined;
  readonly onboarding: OnboardingProps | undefined;
  readonly projectWorkflow: ProjectWorkflowProps | undefined;
  readonly splitView: boolean;
  readonly onFileSelectionChange: (
    selection: { readonly anchor: number; readonly head: number }
  ) => void;
}) {
  const [findMode, setFindMode] = useState<EditorFindMode>("closed");
  const activeChapterId =
    projectWorkflow?.activeChapterId ?? chapterEditor?.chapter.frontmatter.id ?? undefined;
  const chapterTabs = projectWorkflow?.chapters ?? [];
  const openChapterTabIds = projectWorkflow?.openChapterTabIds ?? [];
  const explicitVisibleTabs = openChapterTabIds
    .map((chapterId) => chapterTabs.find((chapter) => chapter.id === chapterId))
    .filter((chapter): chapter is ChapterSummary => chapter !== undefined);
  const runtimeChapter = chapterEditor?.chapter.frontmatter;
  const visibleTabs =
    explicitVisibleTabs.length === 0 && openChapterTabIds.length === 0 && runtimeChapter !== undefined
      ? [
          {
            id: runtimeChapter.id,
            title: runtimeChapter.title,
            order: runtimeChapter.order,
            status: runtimeChapter.status,
            updatedAt: runtimeChapter.updatedAt
          }
        ]
      : explicitVisibleTabs;
  const dirtyChapterIds = new Set(projectWorkflow?.dirtyChapterIds ?? []);
  const chapterDocumentTabs: readonly EditorDocumentTab[] = visibleTabs.map((chapter) => ({
    id: `chapter:${chapter.id}`,
    label: chapterDocumentLabel(chapter.title),
    active: fileEditor === undefined && chapter.id === activeChapterId,
    dirty:
      dirtyChapterIds.has(chapter.id) ||
      (chapterEditor?.chapter.frontmatter.id === chapter.id && chapterEditor.dirty),
    onSelect: () => {
      setFindMode("closed");
      projectWorkflow?.onSelectChapter(chapter.id);
    },
    ...(projectWorkflow?.onCloseChapterTab === undefined
      ? {}
      : {
          onClose: () => {
            setFindMode("closed");
            projectWorkflow.onCloseChapterTab?.(chapter.id);
          }
        })
  }));
  const documentTabs: readonly EditorDocumentTab[] =
    fileEditor === undefined
      ? chapterDocumentTabs
      : [
          ...chapterDocumentTabs,
          {
            id: `file:${fileEditor.path}`,
            label: fileEditor.fileName,
            active: true,
            dirty: fileEditor.dirty,
            ...(fileEditor.onClose === undefined
              ? {}
              : {
                  onClose: () => {
                    setFindMode("closed");
                    fileEditor.onClose?.();
                  }
                })
          }
        ];
  const activeDirty = fileEditor?.dirty ?? chapterEditor?.dirty ?? false;
  const activeSaving =
    fileEditor?.saveStatus === "Saving" || chapterEditor?.saveStatus === "Saving";
  const activeSave = fileEditor?.onSave ?? chapterEditor?.onSave;
  const activeFocusModeToggle =
    fileEditor?.onFocusModeToggle ?? chapterEditor?.onFocusModeToggle;
  const selectionAiPreviewCommand = chapterEditor?.runtime?.selectionAiPreviewCommand;
  const selectionAction =
    fileEditor === undefined &&
    selectionAiPreviewCommand !== undefined &&
    selectionAiPreviewCommand.disabledReason === undefined &&
    chapterEditor?.onSelectionAiPreview !== undefined
      ? {
          label: selectionAiPreviewCommand.label,
          onInvoke: () =>
            chapterEditor.onSelectionAiPreview?.(selectionAiPreviewCommand.commandId)
        }
      : undefined;

  useEffect(() => {
    setFindMode("closed");
  }, [activeChapterId, fileEditor?.path]);

  return (
    <div className="ns-editor-workspace">
      <EditorDocumentBar
        dirty={activeDirty}
        saving={activeSaving}
        tabs={documentTabs}
        onFind={() => setFindMode("find")}
        {...(selectionAction === undefined ? {} : { selectionAction })}
        {...(activeSave === undefined ? {} : { onSave: activeSave })}
        {...(activeFocusModeToggle === undefined
          ? {}
          : { onFocusModeToggle: activeFocusModeToggle })}
      />
      <div className="ns-editor-panes" data-editor-layout="ide" data-split-view={splitView}>
        <section className="ns-editor-surface" aria-label="章节编辑器表面">
          <OnboardingQuickStart onboarding={onboarding} />
          <AutosaveRecoveryNotice projectWorkflow={projectWorkflow} />
          {fileEditor ? (
            <PlainFileEditor
              editor={fileEditor}
              findMode={findMode}
              onFindModeChange={setFindMode}
              onSelectionChange={onFileSelectionChange}
            />
          ) : chapterEditor ? (
            <ChapterEditor
              {...chapterEditor}
              findMode={findMode}
              onFindModeChange={setFindMode}
            />
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
    </div>
  );
}

function PlainFileEditor({
  editor,
  findMode,
  onFindModeChange,
  onSelectionChange
}: {
  readonly editor: PlainFileEditorProps;
  readonly findMode: EditorFindMode;
  readonly onFindModeChange: (mode: EditorFindMode) => void;
  readonly onSelectionChange: (
    selection: { readonly anchor: number; readonly head: number }
  ) => void;
}) {
  const editorFocusRef = useRef<() => void>(() => undefined);
  const editorSelectionRef = useRef<
    (selection: { readonly anchor: number; readonly head: number }) => void
  >(() => undefined);
  const editorPreferences = editor.editorPreferences ?? DEFAULT_EDITOR_PREFERENCES;
  const registerEditorFocus = useCallback((focus: () => void) => {
    editorFocusRef.current = focus;
  }, []);
  const registerEditorSelection = useCallback(
    (select: (selection: { readonly anchor: number; readonly head: number }) => void) => {
      editorSelectionRef.current = select;
    },
    []
  );
  const requestEditorFocus = useCallback(() => editorFocusRef.current(), []);
  const requestEditorSelection = useCallback(
    (selection: { readonly anchor: number; readonly head: number }) =>
      editorSelectionRef.current(selection),
    []
  );
  const editorStyle = {
    "--ns-editor-font-family": editorFontFamilyValue(editorPreferences.fontFamily),
    "--ns-editor-font-size": `${editorPreferences.fontSize}px`,
    "--ns-editor-line-height": String(editorPreferences.lineHeight)
  } as CSSProperties;

  return (
    <section className="ns-editor-layout ns-file-editor-layout" aria-label="普通文件编辑器">
      {editor.feedback === undefined ? null : (
        <p className="ns-project-feedback" data-kind={editor.feedback.kind} role="status">
          {editor.feedback.message}
        </p>
      )}
      <EditorFindReplace
        body={editor.content}
        mode={findMode}
        onModeChange={onFindModeChange}
        onRequestEditorFocus={requestEditorFocus}
        onSelectionChange={requestEditorSelection}
        {...(editor.onContentChange === undefined ? {} : { onBodyChange: editor.onContentChange })}
      />
      <div
        className="ns-editor-body ns-file-editor-body"
        data-runtime-id="codemirror"
        style={editorStyle}
      >
        <CodeMirrorDocumentEditor
          ariaLabel="普通文件正文"
          body={editor.content}
          readOnly={editor.onContentChange === undefined}
          onEditorFocusRegister={registerEditorFocus}
          onEditorSelectionRegister={registerEditorSelection}
          onFindModeChange={onFindModeChange}
          onSelectionChange={onSelectionChange}
          {...(editor.onContentChange === undefined
            ? {}
            : { onBodyChange: editor.onContentChange })}
        />
      </div>
    </section>
  );
}

function ActivityEmptyState({
  activityId,
  aiWritingWorkflow,
  search,
  studio,
  storyBibleEditor,
  onSearchResultOpen,
  onTimelineEntryOpen
}: {
  readonly activityId: ActivityId;
  readonly aiWritingWorkflow: AiWritingWorkflowProps | undefined;
  readonly search: ProjectSearchProps | undefined;
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
