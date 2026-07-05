import type {
  ActivityId,
  ApplicationCommand,
  ApplicationCommandId,
  DesktopShellState,
  ProjectSearchResultItem
} from "@novel-studio/application";
import type { ChapterSummary } from "@novel-studio/shared";
import type { CSSProperties } from "react";
import type { ChapterEditorProps } from "./chapter-editor.js";
import type { ConfigStudioPanelProps } from "./config-studio-panel.js";
import type { ModelSettingsPanelProps } from "./model-settings-panel.js";
import {
  Bot,
  Boxes,
  Check,
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
  Sparkles,
  X
} from "lucide-react";

import { ChapterEditor } from "./chapter-editor.js";
import { CommandPalette } from "./command-palette.js";
import { ConfigStudioPanel } from "./config-studio-panel.js";
import { ModelSettingsPanel } from "./model-settings-panel.js";

export interface WorkspaceShellProps {
  readonly shellState: DesktopShellState;
  readonly commands: readonly ApplicationCommand[];
  readonly commandPaletteOpen: boolean;
  readonly chapterEditor?: ChapterEditorProps;
  readonly projectWorkflow?: ProjectWorkflowProps;
  readonly aiWritingWorkflow?: AiWritingWorkflowProps;
  readonly search?: ProjectSearchProps;
  readonly settings?: ModelSettingsPanelProps;
  readonly studio?: ConfigStudioPanelProps;
  readonly storyBible?: StoryBibleSummaryProps;
  readonly storyBibleEditor?: StoryBibleEditorProps;
  readonly onCommandPaletteOpen?: () => void;
  readonly onCommandExecute?: (commandId: ApplicationCommandId) => void;
  readonly onBottomPanelTabSelect?: ((tab: string) => void) | undefined;
  readonly onSearchResultOpen?: ((result: ProjectSearchResultItem) => void) | undefined;
  readonly onTimelineEntryOpen?: ((entryId: string) => void) | undefined;
  readonly onActivitySelect?: (activityId: ActivityId) => void;
}

export interface ProjectWorkflowProps {
  readonly projectRootInput: string;
  readonly status?: ProjectWorkflowStatus;
  readonly feedback?: ProjectWorkflowFeedback;
  readonly chapters: readonly ChapterSummary[];
  readonly activeChapterId?: string;
  readonly openChapterTabIds?: readonly string[];
  readonly dirtyChapterIds?: readonly string[];
  readonly recovery?: ProjectWorkflowRecoveryProps;
  readonly onProjectRootChange: (projectRoot: string) => void;
  readonly onOpenProject: () => void;
  readonly onCreateProject: () => void;
  readonly onCreateChapter: () => void;
  readonly onSelectChapter: (chapterId: string) => void;
  readonly onCloseChapterTab?: (chapterId: string) => void;
}

export interface ProjectWorkflowRecoveryProps {
  readonly availableItems: readonly ProjectWorkflowRecoveryItemProps[];
}

export interface ProjectWorkflowRecoveryItemProps {
  readonly sessionId: string;
  readonly chapterId: string;
  readonly updatedAt: string;
}

export type ProjectWorkflowStatus = "idle" | "opening" | "creating";

export interface ProjectWorkflowFeedback {
  readonly kind: "info" | "error";
  readonly message: string;
}

export type AiWritingWorkflowStatus =
  "idle" | "generating" | "suggestion-ready" | "applied" | "failed";

export interface AiWritingWorkflowProps {
  readonly status: AiWritingWorkflowStatus;
  readonly instruction: string;
  readonly summary?: string;
  readonly contextTraceLabel?: string;
  readonly observability?: AiWorkflowObservabilityProps;
  readonly history?: AiWorkflowRunHistoryProps;
  readonly failure?: AiWorkflowFailureDiagnosticProps;
  readonly retryPolicy?: AiWorkflowRetryPolicyProps;
  readonly diffPreview?: ChapterEditorProps["diffPreview"];
  readonly onInstructionChange: (instruction: string) => void;
  readonly onGenerateSuggestion: () => void;
  readonly onApplySuggestion: () => void;
  readonly onRetrySuggestion: () => void;
}

export interface AiWorkflowFailureDiagnosticProps {
  readonly title: string;
  readonly code: string;
  readonly message: string;
  readonly recoverabilityLabel: string;
  readonly suggestedAction: string;
}

export interface AiWorkflowRetryPolicyProps {
  readonly modeLabel: string;
  readonly maxAttemptsLabel: string;
  readonly backoffLabel: string;
  readonly retryableCodesLabel: string;
}

export type AiWorkflowObservedStepKind = "context" | "agent" | "confirmation";
export type AiWorkflowObservedStepStatus =
  "pending" | "running" | "completed" | "waiting-confirmation" | "failed";

export interface AiWorkflowObservedStepProps {
  readonly stepId: string;
  readonly label: string;
  readonly kind: AiWorkflowObservedStepKind;
  readonly status: AiWorkflowObservedStepStatus;
}

export interface AiWorkflowObservabilityProps {
  readonly workflowRunId: string;
  readonly workflowTitle: string;
  readonly contextLabel: string;
  readonly modelLabel: string;
  readonly usageLabel: string;
  readonly costLabel: string;
  readonly generatedAtLabel: string;
  readonly steps: readonly AiWorkflowObservedStepProps[];
}

export interface AiWorkflowRunHistoryProps {
  readonly runs: readonly AiWorkflowRunHistoryItemProps[];
  readonly selectedRun?: AiWorkflowRunHistoryDetailProps;
}

export interface AiWorkflowRunHistoryItemProps {
  readonly workflowRunId: string;
  readonly workflowTitle: string;
  readonly statusLabel: string;
  readonly updatedAtLabel: string;
  readonly modelLabel: string;
  readonly usageLabel: string;
  readonly costLabel: string;
}

export interface AiWorkflowRunHistoryDetailProps extends AiWorkflowRunHistoryItemProps {
  readonly contextLabel: string;
  readonly steps: readonly AiWorkflowObservedStepProps[];
  readonly errorLabel?: string;
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
  readonly onResultOpen?: ((result: ProjectSearchResultItem) => void) | undefined;
}

export interface StoryBibleSummaryAsset {
  readonly id: string;
  readonly title: string;
  readonly type: string;
  readonly status: string;
  readonly summary: string;
  readonly contextEligible?: boolean;
}

export type StoryBibleEditorKind = "character" | "world" | "outline" | "timeline" | "memory";
export type StoryBibleEditorStatus = "idle" | "saving" | "saved" | "error";

export interface StoryBibleEditorEntry {
  readonly id: string;
  readonly kind: StoryBibleEditorKind;
  readonly title: string;
  readonly status: string;
  readonly body: string;
  readonly timelineEvents?: readonly StoryTimelineEvent[];
}

export interface StoryTimelineEvent {
  readonly id: string;
  readonly sequence: number;
  readonly title: string;
  readonly status: string;
  readonly summary: string;
  readonly chapterIds: readonly string[];
}

export interface StoryBibleEditorDraft {
  readonly id?: string;
  readonly kind: StoryBibleEditorKind;
  readonly title: string;
  readonly body: string;
  readonly status: string;
}

export interface StoryBibleEditorProps {
  readonly activeKind: StoryBibleEditorKind;
  readonly status: StoryBibleEditorStatus;
  readonly entries: readonly StoryBibleEditorEntry[];
  readonly draft: StoryBibleEditorDraft;
  readonly feedback?: ProjectWorkflowFeedback;
  readonly onKindSelect: (kind: StoryBibleEditorKind) => void;
  readonly onEntrySelect: (entryId: string) => void;
  readonly onDraftChange: (draft: Partial<StoryBibleEditorDraft>) => void;
  readonly onNewDraft: () => void;
  readonly onSave: () => void;
}

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
  chapterEditor,
  projectWorkflow,
  aiWritingWorkflow,
  search,
  settings,
  studio,
  storyBible,
  storyBibleEditor,
  onCommandPaletteOpen,
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
    "--ns-navigator-width": `${workspaceLayout.navigatorWidth}px`,
    "--ns-inspector-width": `${workspaceLayout.inspectorWidth}px`,
    "--ns-bottom-panel-height": `${workspaceLayout.bottomPanelHeight}px`
  } as CSSProperties;

  return (
    <div className="ns-shell" data-theme="dark">
      <header className="ns-titlebar">
        <div className="ns-project-status">
          <span className="ns-project-title">{shellState.projectTitle}</span>
          <span className="ns-save-status">{shellState.saveStatus}</span>
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
            aria-label="切换 Split View"
            className="ns-icon-button"
            onClick={() => onCommandExecute?.("workspace.toggle-split-view")}
            title="切换 Split View"
            type="button"
          >
            <PanelRight aria-hidden="true" size={14} />
          </button>
          <button
            aria-label="收窄导航面板"
            className="ns-icon-button"
            onClick={() => onCommandExecute?.("workspace.narrow-navigator")}
            title="收窄导航面板"
            type="button"
          >
            -
          </button>
          <button
            aria-label="加宽导航面板"
            className="ns-icon-button"
            onClick={() => onCommandExecute?.("workspace.widen-navigator")}
            title="加宽导航面板"
            type="button"
          >
            +
          </button>
          <button
            aria-label="收窄检查器"
            className="ns-icon-button"
            onClick={() => onCommandExecute?.("workspace.narrow-inspector")}
            title="收窄检查器"
            type="button"
          >
            [
          </button>
          <button
            aria-label="加宽检查器"
            className="ns-icon-button"
            onClick={() => onCommandExecute?.("workspace.widen-inspector")}
            title="加宽检查器"
            type="button"
          >
            ]
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
            <WorkspaceEditorSurface
              chapterEditor={chapterEditor}
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
                {aiWritingWorkflow.status === "failed" ? (
                  <button
                    aria-label="重试 AI 工作流"
                    className="ns-icon-text-button"
                    onClick={aiWritingWorkflow.onRetrySuggestion}
                    title="重试 AI 工作流"
                    type="button"
                  >
                    <Sparkles aria-hidden="true" size={14} />
                    重试
                  </button>
                ) : null}
              </div>
              {aiWritingWorkflow.summary === undefined ? null : (
                <p className="ns-ai-summary">{aiWritingWorkflow.summary}</p>
              )}
              {aiWritingWorkflow.contextTraceLabel === undefined ? null : (
                <p className="ns-ai-context">{aiWritingWorkflow.contextTraceLabel}</p>
              )}
              {aiWritingWorkflow.observability === undefined ? null : (
                <AiWorkflowObservabilityView observability={aiWritingWorkflow.observability} />
              )}
              {aiWritingWorkflow.failure === undefined ? null : (
                <AiWorkflowFailureDiagnosticView failure={aiWritingWorkflow.failure} />
              )}
              {aiWritingWorkflow.retryPolicy === undefined ? null : (
                <AiWorkflowRetryPolicyView retryPolicy={aiWritingWorkflow.retryPolicy} />
              )}
              {aiWritingWorkflow.history === undefined ? null : (
                <AiWorkflowRunHistoryView history={aiWritingWorkflow.history} />
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
            search={search}
          />
        </section>
      </div>

      <CommandPalette
        commands={commands}
        onCommandExecute={onCommandExecute}
        open={commandPaletteOpen || shellState.commandPaletteOpen}
      />
    </div>
  );
}

function BottomPanelContent({
  activeTab,
  aiWritingWorkflow,
  search
}: {
  readonly activeTab: string;
  readonly aiWritingWorkflow: AiWritingWorkflowProps | undefined;
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

function AiWorkflowRunHistoryView({ history }: { readonly history: AiWorkflowRunHistoryProps }) {
  return (
    <section className="ns-ai-run-history" aria-label="工作流运行历史">
      <div className="ns-ai-observability-header">
        <span>工作流运行历史</span>
        <span>{history.runs.length}</span>
      </div>
      {history.runs.length === 0 ? (
        <p className="ns-ai-history-empty">暂无工作流运行记录</p>
      ) : (
        <ol className="ns-ai-history-list" aria-label="最近工作流运行">
          {history.runs.map((run) => (
            <li className="ns-ai-history-row" key={run.workflowRunId}>
              <div>
                <span>{run.workflowTitle}</span>
                <span>{run.updatedAtLabel}</span>
              </div>
              <div>
                <span>{run.statusLabel}</span>
                <span>{run.modelLabel}</span>
              </div>
              <div>
                <span>{run.usageLabel}</span>
                <span>{run.costLabel}</span>
              </div>
            </li>
          ))}
        </ol>
      )}
      {history.selectedRun === undefined ? null : (
        <div className="ns-ai-history-detail" aria-label="工作流运行详情">
          <dl className="ns-ai-observability-metrics">
            <div>
              <dt>上下文</dt>
              <dd>{history.selectedRun.contextLabel}</dd>
            </div>
            <div>
              <dt>模型</dt>
              <dd>{history.selectedRun.modelLabel}</dd>
            </div>
            <div>
              <dt>Token</dt>
              <dd>{history.selectedRun.usageLabel}</dd>
            </div>
          </dl>
          <ol className="ns-ai-step-list" aria-label="历史工作流步骤">
            {history.selectedRun.steps.map((step) => (
              <li className="ns-ai-step" data-status={step.status} key={step.stepId}>
                <span>{step.label}</span>
                <span>{aiStepStatusLabel(step.status)}</span>
              </li>
            ))}
          </ol>
          {history.selectedRun.errorLabel === undefined ? null : (
            <p className="ns-ai-history-error">{history.selectedRun.errorLabel}</p>
          )}
        </div>
      )}
    </section>
  );
}

function AiWorkflowFailureDiagnosticView({
  failure
}: {
  readonly failure: AiWorkflowFailureDiagnosticProps;
}) {
  return (
    <section className="ns-ai-failure" aria-label="失败诊断">
      <div className="ns-ai-observability-header">
        <span>{failure.title}</span>
        <span>{failure.recoverabilityLabel}</span>
      </div>
      <dl className="ns-ai-observability-metrics">
        <div>
          <dt>错误</dt>
          <dd>{failure.code}</dd>
        </div>
        <div>
          <dt>说明</dt>
          <dd>{failure.message}</dd>
        </div>
        <div>
          <dt>建议</dt>
          <dd>{failure.suggestedAction}</dd>
        </div>
      </dl>
    </section>
  );
}

function AiWorkflowRetryPolicyView({
  retryPolicy
}: {
  readonly retryPolicy: AiWorkflowRetryPolicyProps;
}) {
  return (
    <section className="ns-ai-retry-policy" aria-label="重试策略">
      <div className="ns-ai-observability-header">
        <span>重试策略</span>
        <span>{retryPolicy.modeLabel}</span>
      </div>
      <dl className="ns-ai-observability-metrics">
        <div>
          <dt>次数</dt>
          <dd>{retryPolicy.maxAttemptsLabel}</dd>
        </div>
        <div>
          <dt>退避</dt>
          <dd>{retryPolicy.backoffLabel}</dd>
        </div>
        <div>
          <dt>错误</dt>
          <dd>{retryPolicy.retryableCodesLabel}</dd>
        </div>
      </dl>
    </section>
  );
}

function AiWorkflowObservabilityView({
  observability
}: {
  readonly observability: AiWorkflowObservabilityProps;
}) {
  return (
    <section className="ns-ai-observability" aria-label="AI 工作流运行观测">
      <div className="ns-ai-observability-header">
        <span>{observability.workflowTitle}</span>
        <span>{observability.generatedAtLabel}</span>
      </div>
      <dl className="ns-ai-observability-metrics">
        <div>
          <dt>上下文</dt>
          <dd>{observability.contextLabel}</dd>
        </div>
        <div>
          <dt>模型</dt>
          <dd>{observability.modelLabel}</dd>
        </div>
        <div>
          <dt>Token</dt>
          <dd>{observability.usageLabel}</dd>
        </div>
        <div>
          <dt>成本</dt>
          <dd>{observability.costLabel}</dd>
        </div>
      </dl>
      <ol className="ns-ai-step-list" aria-label="AI 工作流步骤">
        {observability.steps.map((step) => (
          <li className="ns-ai-step" data-status={step.status} key={step.stepId}>
            <span>{step.label}</span>
            <span>{aiStepStatusLabel(step.status)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function WorkspaceEditorSurface({
  chapterEditor,
  projectWorkflow,
  splitView
}: {
  readonly chapterEditor: ChapterEditorProps | undefined;
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
          <AutosaveRecoveryNotice projectWorkflow={projectWorkflow} />
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

function AutosaveRecoveryNotice({
  projectWorkflow
}: {
  readonly projectWorkflow: ProjectWorkflowProps | undefined;
}) {
  const recoveryItems = projectWorkflow?.recovery?.availableItems ?? [];
  if (recoveryItems.length === 0) {
    return null;
  }

  const recoveredTitles = recoveryItems
    .map(
      (item) => projectWorkflow?.chapters.find((chapter) => chapter.id === item.chapterId)?.title
    )
    .filter((title): title is string => title !== undefined);

  return (
    <section className="ns-recovery-notice" aria-label="Autosave recovery">
      <div>
        <strong>Recoverable drafts {recoveryItems.length}</strong>
        <span>{recoveredTitles.join(", ")}</span>
      </div>
      <span>{recoveryItems[0]?.updatedAt}</span>
    </section>
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

function TimelineMainView({
  editor,
  onTimelineEntryOpen
}: {
  readonly editor: StoryBibleEditorProps | undefined;
  readonly onTimelineEntryOpen: ((entryId: string) => void) | undefined;
}) {
  const timelineEntries = editor?.entries.filter((entry) => entry.kind === "timeline") ?? [];
  const timelineEvents = timelineEntries
    .flatMap((entry) =>
      (entry.timelineEvents ?? []).map((event) => ({
        ...event,
        parentEntryId: entry.id,
        parentTitle: entry.title
      }))
    )
    .sort((left, right) => left.sequence - right.sequence || left.title.localeCompare(right.title));
  const linkedChapterCount = new Set(timelineEvents.flatMap((event) => event.chapterIds)).size;
  const activeCount = timelineEvents.filter((event) => event.status === "active").length;
  const draftCount = timelineEvents.filter((event) => event.status === "draft").length;

  return (
    <section className="ns-timeline-view" aria-label="时间线主视图">
      <div className="ns-timeline-header">
        <div>
          <h1>时间线</h1>
          <p>集中查看故事圣经中的时间线条目，点击后进入可编辑详情。</p>
        </div>
        <span>{timelineEntries.length} 条</span>
      </div>

      {timelineEvents.length > 0 ? (
        <>
          <div className="ns-timeline-summary" aria-label="Timeline metrics">
            <span>Events {timelineEvents.length}</span>
            <span>Linked chapters {linkedChapterCount}</span>
            <span>active {activeCount}</span>
            <span>draft {draftCount}</span>
          </div>
          <ol className="ns-timeline-event-rail" aria-label="Timeline event rail">
            {timelineEvents.map((event) => (
              <li className="ns-timeline-event" key={event.id}>
                <span className="ns-timeline-sequence">{event.sequence}</span>
                <div className="ns-timeline-event-body">
                  <div className="ns-timeline-entry-header">
                    <strong>{event.title}</strong>
                    <span>{event.status}</span>
                  </div>
                  <p>{event.summary}</p>
                  <div className="ns-timeline-event-meta">
                    <span>{event.parentTitle}</span>
                    {event.chapterIds.map((chapterId) => (
                      <span key={chapterId}>{chapterId}</span>
                    ))}
                  </div>
                </div>
                <button
                  aria-label={`Edit timeline: ${event.parentTitle}`}
                  className="ns-icon-text-button"
                  onClick={() => onTimelineEntryOpen?.(event.parentEntryId)}
                  type="button"
                >
                  Edit
                </button>
              </li>
            ))}
          </ol>
        </>
      ) : timelineEntries.length === 0 ? (
        <div className="ns-timeline-empty">当前项目还没有时间线条目。</div>
      ) : (
        <ol className="ns-timeline-list" aria-label="时间线条目">
          {timelineEntries.map((entry) => (
            <li key={entry.id}>
              <button
                aria-label={`打开时间线条目：${entry.title}`}
                className="ns-timeline-entry-button"
                onClick={() => onTimelineEntryOpen?.(entry.id)}
                type="button"
              >
                <span className="ns-timeline-entry-header">
                  <strong>{entry.title}</strong>
                  <span>{entry.status}</span>
                </span>
                <span>{entry.body}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function StoryBibleEditorView({ editor }: { readonly editor: StoryBibleEditorProps }) {
  const visibleEntries = editor.entries.filter((entry) => entry.kind === editor.activeKind);

  return (
    <section className="ns-story-editor" aria-label="故事圣经编辑器">
      <div className="ns-story-editor-header">
        <div>
          <h1>故事圣经</h1>
          <p>维护人物、世界观、大纲、时间线和记忆。保存前始终由你确认。</p>
        </div>
        <button className="ns-icon-text-button" onClick={editor.onNewDraft} type="button">
          <FilePlus aria-hidden="true" size={14} />
          新建设定
        </button>
      </div>

      <div className="ns-story-editor-grid">
        <aside className="ns-story-editor-list" aria-label="故事圣经分类">
          <div className="ns-story-kind-tabs" role="tablist" aria-label="故事圣经分类">
            {storyBibleKindOptions.map((option) => (
              <button
                aria-selected={editor.activeKind === option.kind}
                className="ns-story-kind-tab"
                key={option.kind}
                onClick={() => editor.onKindSelect(option.kind)}
                role="tab"
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
          <ol className="ns-story-entry-list" aria-label="故事圣经条目">
            {visibleEntries.length === 0 ? (
              <li className="ns-story-entry-empty">当前分类还没有条目。</li>
            ) : (
              visibleEntries.map((entry) => (
                <li key={entry.id}>
                  <button
                    className="ns-story-entry-button"
                    onClick={() => editor.onEntrySelect(entry.id)}
                    type="button"
                  >
                    <span>{entry.title}</span>
                    <span>{entry.status}</span>
                  </button>
                </li>
              ))
            )}
          </ol>
        </aside>

        <form
          className="ns-story-editor-form"
          onSubmit={(event) => {
            event.preventDefault();
            editor.onSave();
          }}
        >
          <label className="ns-story-field">
            <span>标题</span>
            <input
              aria-label="设定标题"
              className="ns-search-input"
              onChange={(event) => editor.onDraftChange({ title: event.currentTarget.value })}
              value={editor.draft.title}
            />
          </label>
          <label className="ns-story-field">
            <span>{editor.activeKind === "memory" ? "记忆内容" : "摘要"}</span>
            <textarea
              aria-label="设定正文"
              className="ns-story-textarea"
              onChange={(event) => editor.onDraftChange({ body: event.currentTarget.value })}
              value={editor.draft.body}
            />
          </label>
          <div className="ns-story-editor-actions">
            <span className="ns-muted">{storyBibleKindLabel(editor.activeKind)}</span>
            <button
              className="ns-icon-text-button"
              disabled={editor.status === "saving" || editor.draft.title.trim().length === 0}
              type="submit"
            >
              <Check aria-hidden="true" size={14} />
              {editor.status === "saving" ? "保存中" : "保存设定"}
            </button>
          </div>
          {editor.feedback === undefined ? null : (
            <p className="ns-project-feedback" data-kind={editor.feedback.kind} role="status">
              {editor.feedback.message}
            </p>
          )}
        </form>
      </div>
    </section>
  );
}

const storyBibleKindOptions: readonly {
  readonly kind: StoryBibleEditorKind;
  readonly label: string;
}[] = [
  { kind: "character", label: "人物" },
  { kind: "world", label: "世界观" },
  { kind: "outline", label: "大纲" },
  { kind: "timeline", label: "时间线" },
  { kind: "memory", label: "记忆" }
];

function storyBibleKindLabel(kind: StoryBibleEditorKind): string {
  return storyBibleKindOptions.find((option) => option.kind === kind)?.label ?? "故事圣经";
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
              <button
                aria-label={`打开搜索结果：${result.title}`}
                className="ns-search-result-button"
                onClick={() => search.onResultOpen?.(result)}
                type="button"
              >
                <span className="ns-search-result-header">
                  <span>{searchResultTypeLabel(result.type)}</span>
                  <strong>{result.title}</strong>
                  <span>分数 {result.score}</span>
                </span>
                <span>{result.snippet}</span>
                <span className="ns-search-result-source">{result.sourceRef.relativePath}</span>
              </button>
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
    case "failed":
      return "失败";
  }
}

function aiStepStatusLabel(status: AiWorkflowObservedStepStatus): string {
  switch (status) {
    case "pending":
      return "待执行";
    case "running":
      return "运行中";
    case "completed":
      return "已完成";
    case "waiting-confirmation":
      return "待确认";
    case "failed":
      return "失败";
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
