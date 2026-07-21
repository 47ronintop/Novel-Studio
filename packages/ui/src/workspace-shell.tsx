import type {
  ActivityId,
  DesktopShellState,
  ProjectSearchResultItem
} from "@novel-studio/application";
import type { ChapterSummary } from "@novel-studio/shared";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { ChapterEditorProps } from "./chapter-editor.js";
import type { ConfigStudioPanelProps } from "./config-studio-panel.js";
import { DEFAULT_EDITOR_PREFERENCES, editorFontFamilyValue } from "./editor-toolbar.js";
import {
  FilePlus,
  Maximize2,
  PanelBottom,
  PanelRight,
  Search
} from "lucide-react";

import { ChapterEditor } from "./chapter-editor.js";
import { AgentConversationView } from "./agent-conversation-view.js";
import { AiSelectionReview } from "./ai-selection-review.js";
import { AiWorkflowHistoryPanel } from "./ai-workflow-history-panel.js";
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
import { createPanelResizeHandler } from "./workspace-shell-layout.js";
import {
  ProjectSearchView,
  StoryBibleEditorView,
  TimelineMainView
} from "./workspace-shell-story-search.js";
import { AutosaveRecoveryNotice, OnboardingQuickStart } from "./workspace-shell-project-assist.js";
import { WorkspaceShellNavigator } from "./workspace-shell-navigator.js";
import { DiffReview } from "./diff-review.js";
import { RollbackReview } from "./change-set-review.js";
import { WorkspaceStatusBar } from "./workspace-status-bar.js";
import { WorkbenchSwitcher } from "./workbench-switcher.js";
import { PlainFileConflictReview } from "./plain-file-conflict-review.js";
import { WorkspaceActivityBar } from "./workspace-shell-activity.js";
import { RecoveryReview } from "./recovery-review.js";
import type {
  AgentConversationMainReview,
  AiWritingWorkflowProps,
  OnboardingProps,
  PlainFileEditorProps,
  ProjectSearchProps,
  ProjectWorkflowProps,
  StoryBibleEditorProps,
  WorkspaceShellProps
} from "./workspace-shell-types.js";

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
  storyBibleEditor,
  creativeNavigator,
  engineeringNavigator,
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
  onNavigatorExpandedSectionIdsChange,
  onWorkbenchSelect,
  onOpenEngineeringWorkspace
}: WorkspaceShellProps) {
  const [fileSelection, setFileSelection] = useState({ anchor: 0, head: 0 });
  const appearance = appearancePreferences ?? {
    theme: "dark" as const,
    accentColor: "teal" as const
  };
  const focusMode = shellState.focusMode === true;
  const settingsMode = shellState.activeActivity === "settings";
  const editorActivity = shellState.activeActivity === "workspace";
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
    "--ns-ai-panel-width":
      focusMode || shellState.inspectorCollapsed ? "0px" : `${workspaceLayout.inspectorWidth}px`,
    "--ns-bottom-panel-height":
      !focusMode && shellState.bottomPanelVisible ? `${workspaceLayout.bottomPanelHeight}px` : "0px"
  } as CSSProperties;
  const chapterRecoveryReview = toChapterRecoveryReview(projectWorkflow);
  const mainReview =
    agentConversationWorkspace?.mainReview?.kind === "recovery"
      ? agentConversationWorkspace.mainReview
      : (chapterRecoveryReview ?? agentConversationWorkspace?.mainReview);

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
        <WorkbenchSwitcher mode={shellState.workbenchMode} {...(shellState.workspaceContext.kind === "engineeringWorkspace" ? { creativeDisabledReason: "当前工作区不是创作项目。" } : {})} onSelect={onWorkbenchSelect ?? (() => undefined)} />
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
      </header>

      <div
        className="ns-workspace-grid"
        data-agent-conversation={agentConversationWorkspace !== undefined}
        data-focus-mode={focusMode}
        data-split-view={workspaceLayout.splitView}
        style={workspaceGridStyle}
      >
        <WorkspaceActivityBar
          focusHidden={focusMode}
          onActivitySelect={onActivitySelect}
          shellState={shellState}
        />

        <WorkspaceShellNavigator
          collapsed={focusMode || shellState.navigatorCollapsed}
          creative={creativeNavigator}
          engineeringNavigator={engineeringNavigator}
          onOpenEngineeringWorkspace={onOpenEngineeringWorkspace}
          focusHidden={focusMode}
          navigatorSearchQuery={navigatorSearchQuery}
          onActivitySelect={onActivitySelect}
          onNavigatorExpandedSectionIdsChange={onNavigatorExpandedSectionIdsChange}
          onNavigatorSearchQueryChange={onNavigatorSearchQueryChange}
          projectWorkflow={projectWorkflow}
          shellState={shellState}
          storyBibleEditor={storyBibleEditor}
          studio={studio}
        />

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
          {settingsMode ? (
            <div data-region="settings-workspace">
              <SettingsWorkspace onClose={onSettingsClose} settings={settings} />
            </div>
          ) : mainReview !== undefined ? (
            <AgentConversationMainReviewView review={mainReview} />
          ) : shellState.activeActivity === "workspace" ? (
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
              search={search}
              studio={studio}
              storyBibleEditor={storyBibleEditor}
              onSearchResultOpen={onSearchResultOpen}
              onTimelineEntryOpen={onTimelineEntryOpen}
            />
          )}
        </main>

        {shellState.inspectorCollapsed ? null : (
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
        )}

        <aside
          aria-label="AI 对话面板"
          className="ns-ai-panel"
          data-focus-hidden={focusMode}
          data-region="ai-panel"
        >
          {agentConversationWorkspace !== undefined ? (
            <AgentConversationView
              {...agentConversationWorkspace.view}
              navigator={agentConversationWorkspace.navigator}
              {...(mainReview === undefined ? {} : { mainReview })}
            />
          ) : (
            <AgentConversationView
              loading={false}
              createDisabled={true}
              onCreate={() => undefined}
              onArchive={() => undefined}
              onRestore={() => undefined}
              onReturnToActive={() => undefined}
              composer={{
                request: "",
                operationMode: "execution",
                contextMode: "writing",
                writePolicy: "write_before_confirmation",
                writePolicyAcknowledged: false,
                active: false,
                disabled: true,
                disabledReason: "打开创作项目或工程工作区后，Agent 会在这里保持可用。",
                onRequestChange: () => undefined,
                onOperationModeChange: () => undefined,
                onContextModeChange: () => undefined,
                onWritePolicyChange: () => undefined,
                onWritePolicyAcknowledgedChange: () => undefined,
                onSend: () => undefined,
                onStop: () => undefined
              }}
            />
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
    const history = aiWritingWorkflow?.history;
    if (history !== undefined) {
      return (
        <div className="ns-bottom-panel-content ns-bottom-panel-workflow-history" aria-label="底部面板内容：工作流运行">
          <div className="ns-bottom-panel-workflow-summary">
            <strong>工作流运行</strong>
            <span>当前状态 {aiWritingWorkflowStatusLabel(aiWritingWorkflow?.status)}</span>
            <span>最近运行 {runCount}</span>
          </div>
          <AiWorkflowHistoryPanel history={history} />
        </div>
      );
    }
    return (
      <div className="ns-bottom-panel-content" aria-label="底部面板内容：工作流运行">
        <strong>工作流运行</strong>
        <span>
          当前状态{" "}
          {aiWritingWorkflow === undefined ? "未加载" : aiWritingWorkflowStatusLabel(aiWritingWorkflow.status)}
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

function AgentConversationMainReviewView({
  review
}: {
  readonly review: AgentConversationMainReview;
}) {
  switch (review.kind) {
    case "recovery":
      return <RecoveryReview {...review.props} />;
    case "rollback":
      return <RollbackReview review={review.props} />;
    case "change_set":
      return <DiffReview review={review.props} />;
    case "selection":
      return <AiSelectionReview review={review.props} />;
    case "plan":
      return <PlanArtifactReview {...review.props} />;
  }
}

function toChapterRecoveryReview(
  projectWorkflow: ProjectWorkflowProps | undefined
): AgentConversationMainReview | undefined {
  const recovery = projectWorkflow?.recovery;
  if (recovery === undefined || recovery.availableItems.length === 0) return undefined;
  return {
    kind: "recovery",
    props: {
      source: "chapter_autosave",
      recovery,
      chapters: projectWorkflow?.chapters ?? [],
      onPreview: (sessionId) => projectWorkflow?.onPreviewRecoveryDraft?.(sessionId),
      onApply: (sessionId) => projectWorkflow?.onApplyRecoveryDraft?.(sessionId),
      onDiscard: (sessionId) => projectWorkflow?.onDiscardRecoveryDraft?.(sessionId)
    }
  };
}

function aiWritingWorkflowStatusLabel(status: AiWritingWorkflowProps["status"] | undefined): string {
  if (status === undefined) return "未加载";
  switch (status) {
    case "idle":
      return "空闲";
    case "generating":
      return "生成中";
    case "streaming":
      return "流式生成";
    case "suggestion-ready":
      return "建议待审阅";
    case "applied":
      return "已应用";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
  }
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
  readonly onFileSelectionChange: (selection: {
    readonly anchor: number;
    readonly head: number;
  }) => void;
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
    explicitVisibleTabs.length === 0 &&
    openChapterTabIds.length === 0 &&
    runtimeChapter !== undefined
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
  const activeSave = fileEditor?.conflict === undefined ? (fileEditor?.onSave ?? chapterEditor?.onSave) : undefined;
  const activeFocusModeToggle = fileEditor?.onFocusModeToggle ?? chapterEditor?.onFocusModeToggle;
  const selectionAiPreviewCommand = chapterEditor?.runtime?.selectionAiPreviewCommand;
  const selectionAction =
    fileEditor === undefined &&
    selectionAiPreviewCommand !== undefined &&
    selectionAiPreviewCommand.disabledReason === undefined &&
    chapterEditor?.onSelectionAiPreview !== undefined
      ? {
          label: selectionAiPreviewCommand.label,
          onInvoke: () => chapterEditor.onSelectionAiPreview?.(selectionAiPreviewCommand.commandId)
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
          {fileEditor?.conflict !== undefined ? (
            <PlainFileConflictReview
              fileName={fileEditor.fileName}
              conflict={fileEditor.conflict}
              onReloadFromDisk={fileEditor.onReloadFromDisk ?? (() => undefined)}
              onKeepDraft={fileEditor.onKeepDraft ?? (() => undefined)}
            />
          ) : fileEditor ? (
            <PlainFileEditor
              editor={fileEditor}
              findMode={findMode}
              onFindModeChange={setFindMode}
              onSelectionChange={onFileSelectionChange}
            />
          ) : chapterEditor ? (
            <ChapterEditor {...chapterEditor} findMode={findMode} onFindModeChange={setFindMode} />
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
  readonly onSelectionChange: (selection: {
    readonly anchor: number;
    readonly head: number;
  }) => void;
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
      {editor.readOnlyReason === undefined ? null : (
        <p className="ns-file-read-only-reason" role="status">
          只读：{editor.readOnlyReason}
        </p>
      )}
      {editor.conflict === undefined ? null : (
        <section className="ns-project-feedback" data-kind="error" aria-label="文件保存冲突">
          <p>磁盘文件已更改，请检查后选择重新加载或保留当前草稿。</p>
          <pre>{editor.conflict.diskContent}</pre>
          <div className="ns-project-actions">
            <button type="button" onClick={editor.onReloadFromDisk}>
              从磁盘重新加载
            </button>
            <button type="button" onClick={editor.onKeepDraft}>
              保留草稿
            </button>
          </div>
        </section>
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
  search,
  studio,
  storyBibleEditor,
  onSearchResultOpen,
  onTimelineEntryOpen
}: {
  readonly activityId: ActivityId;
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

function activityViewCopy(activityId: Exclude<ActivityId, "workspace" | "storyBible">): {
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
