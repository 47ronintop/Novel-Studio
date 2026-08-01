import type { ProjectSearchResultItem } from "@novel-studio/application";
import type { ForeshadowTrackingStatus, JsonObject } from "@novel-studio/shared";
import {
  ArrowLeft,
  ArchiveRestore,
  Check,
  Clock3,
  FilePlus,
  Inbox,
  LoaderCircle,
  Pencil,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  X
} from "lucide-react";
import { useRef } from "react";

import type {
  ProjectSearchProps,
  StoryBibleConsistencyIssueProps,
  StoryBibleEditorEntry,
  StoryBibleEditorKind,
  StoryBibleEditorProps,
  StoryTimelineEvent,
  StoryBibleWorldAssetType
} from "./workspace-shell-types.js";
import { StoryBibleForeshadowEditor } from "./story-bible-foreshadow-editor.js";
import { StoryBibleForeshadowAnalysis } from "./story-bible-foreshadow-analysis.js";
import {
  STORY_BIBLE_FORESHADOW_STATUS_OPTIONS,
  isStoryBibleForeshadowOverdue,
  storyBibleForeshadowStatusLabel,
  storyBibleForeshadowValidationMessage,
  validateStoryBibleForeshadow
} from "./story-bible-foreshadow.js";
import { StoryBibleOutlineEditor } from "./story-bible-outline-editor.js";
import {
  storyBibleOutlineValidationMessage,
  validateStoryBibleOutline
} from "./story-bible-outline.js";
import { StoryBibleTimelineEditor } from "./story-bible-timeline-editor.js";
import {
  CharacterDetailFields as StrictCharacterDetailFields,
  WorldDetailFields as StrictWorldDetailFields
} from "./story-bible-character-world-editor.js";
import { StoryAnalysisReviewView } from "./story-analysis-review.js";
import {
  storyBibleTimelineValidationMessage,
  validateStoryBibleTimeline
} from "./story-bible-timeline.js";

const WORLD_ASSET_TYPE_OPTIONS: ReadonlyArray<{
  readonly value: StoryBibleWorldAssetType;
  readonly label: string;
}> = [
  { value: "world.location", label: "地点" },
  { value: "world.faction", label: "势力" },
  { value: "world.rule", label: "规则" },
  { value: "world.glossary", label: "术语" },
  { value: "world.item", label: "物品" },
  { value: "world.lore", label: "背景资料" }
];

const STORY_BIBLE_KINDS: readonly StoryBibleEditorKind[] = [
  "character",
  "world",
  "outline",
  "foreshadow",
  "timeline"
];

export function TimelineMainView({
  editor,
  onTimelineEntryOpen
}: {
  readonly editor: StoryBibleEditorProps | undefined;
  readonly onTimelineEntryOpen: ((entryId: string) => void) | undefined;
}) {
  const timelineEntries = editor?.entries.filter((entry) => entry.kind === "timeline") ?? [];
  const timelineEvents = collectTimelineEvents(timelineEntries);

  return (
    <section className="ns-timeline-view" aria-label="时间线主视图">
      <div className="ns-timeline-header">
        <h1>时间线</h1>
        <span>{timelineEvents.length} 个事件</span>
      </div>
      <TimelineEventRail
        chapterOptions={editor?.chapterOptions ?? []}
        entries={timelineEntries}
        events={timelineEvents}
        onOpen={(entryId) => onTimelineEntryOpen?.(entryId)}
      />
    </section>
  );
}

type TimelineEditorEntry = Extract<StoryBibleEditorEntry, { readonly kind: "timeline" }>;
type TimelineRailEvent = StoryTimelineEvent & {
  readonly parentEntryId: string;
  readonly parentTitle: string;
};

function collectTimelineEvents(
  entries: readonly TimelineEditorEntry[],
  query = ""
): readonly TimelineRailEvent[] {
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  return entries
    .flatMap((entry) =>
      entry.timelineEvents.map((event) => ({
        ...event,
        parentEntryId: event.parentEntryId ?? entry.id,
        parentTitle: entry.title
      }))
    )
    .filter((event) => {
      if (normalizedQuery.length === 0) return true;
      return [
        event.title,
        event.timeLabel,
        event.summary,
        ...event.chapterIds,
        ...event.characterIds,
        ...event.locationIds
      ].some((value) => value.toLocaleLowerCase("zh-CN").includes(normalizedQuery));
    })
    .sort(
      (left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id, "en-US")
    );
}

function TimelineEventRail({
  chapterOptions,
  entries,
  events,
  onOpen,
  query = ""
}: {
  readonly chapterOptions: StoryBibleEditorProps["chapterOptions"];
  readonly entries: readonly TimelineEditorEntry[];
  readonly events: readonly TimelineRailEvent[];
  readonly onOpen: (entryId: string) => void;
  readonly query?: string;
}) {
  const linkedChapterCount = new Set(events.flatMap((event) => event.chapterIds)).size;
  const chapterById = new Map(chapterOptions.map((chapter) => [chapter.id, chapter]));

  if (events.length === 0) {
    const entry = entries[0];
    return (
      <div className="ns-timeline-empty">
        <span>
          {query.trim().length > 0
            ? "未找到匹配事件"
            : entry === undefined
              ? "还没有时间线"
              : "暂无时间线事件"}
        </span>
        {entry === undefined || query.trim().length > 0 ? null : (
          <button
            aria-label={`打开时间线设置：${entry.title}`}
            className="ns-icon-text-button"
            onClick={() => onOpen(entry.id)}
            type="button"
          >
            打开时间线设置
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="ns-timeline-rail-layout">
      <div className="ns-timeline-summary" aria-label="时间线统计">
        <span>事件 {events.length}</span>
        <span>关联章节 {linkedChapterCount}</span>
      </div>
      <ol className="ns-timeline-event-rail" aria-label="时间线事件轨道">
        {events.map((event, index) => (
          <li className="ns-timeline-event" key={`${event.id}:${index}`}>
            <span className="ns-timeline-sequence">{event.sequence}</span>
            <div className="ns-timeline-event-body">
              <div className="ns-timeline-entry-header">
                <strong>{event.title}</strong>
                <span>{event.timeLabel || "未设置时间"}</span>
              </div>
              <p>{event.summary || "暂无摘要"}</p>
              {event.chapterIds.length === 0 ? null : (
                <div className="ns-timeline-event-meta">
                  {event.chapterIds.map((chapterId) => {
                    const chapter = chapterById.get(chapterId);
                    return (
                      <span key={chapterId}>
                        {chapter === undefined ? chapterId : `${chapter.order}. ${chapter.title}`}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
            <button
              aria-label={`编辑时间线事件：${event.title}`}
              className="ns-icon-button"
              onClick={() => onOpen(event.id)}
              title="编辑事件"
              type="button"
            >
              <Pencil aria-hidden="true" size={14} />
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function StoryBibleEditorView({ editor }: { readonly editor: StoryBibleEditorProps }) {
  const foreshadowAnalysisTriggerRef = useRef<HTMLButtonElement>(null);
  const analysisReviewOpen = editor.analysisReview?.open === true;
  const kindLabel = storyBibleKindLabel(editor.activeKind);
  const categoryEntries = editor.entries.filter((entry) => entry.kind === editor.activeKind);
  const visibleEntries = filterStoryBibleEntries(categoryEntries, editor);
  const singleton = editor.activeKind === "outline" || editor.activeKind === "timeline";
  const canCreate = !singleton || categoryEntries.length === 0;
  const detailTitle = editor.draft.title.trim() || `新建${kindLabel}`;
  const categoryCount =
    editor.activeKind === "timeline"
      ? categoryEntries.reduce(
          (count, entry) => count + (entry.kind === "timeline" ? entry.timelineEvents.length : 0),
          0
        )
      : categoryEntries.length;
  const foreshadowAnalysisOpen =
    editor.activeKind === "foreshadow" && editor.foreshadowAnalysis.status !== "closed";
  const closeForeshadowAnalysis = () => {
    editor.onForeshadowAnalysisClose();
    globalThis.setTimeout(() => foreshadowAnalysisTriggerRef.current?.focus(), 0);
  };

  return (
    <section
      aria-label="故事圣经"
      className="ns-story-editor"
      data-analysis-review-open={analysisReviewOpen}
      data-view-mode={editor.viewMode}
    >
      <div className="ns-story-editor-header">
        <div className="ns-story-title-group">
          {analysisReviewOpen || editor.viewMode === "detail" ? (
            <button
              aria-label={analysisReviewOpen ? "关闭资料更新建议" : `返回${kindLabel}列表`}
              className="ns-icon-button"
              onClick={() =>
                analysisReviewOpen
                  ? editor.analysisReview?.onClose()
                  : editor.onKindSelect(editor.activeKind)
              }
              title={analysisReviewOpen ? "关闭资料更新建议" : `返回${kindLabel}列表`}
              type="button"
            >
              <ArrowLeft aria-hidden="true" size={16} />
            </button>
          ) : null}
          <div>
            <h1>
              {analysisReviewOpen
                ? "资料更新建议"
                : editor.viewMode === "detail"
                  ? detailTitle
                  : kindLabel}
            </h1>
            <span className="ns-muted">
              {analysisReviewOpen
                ? `${editor.analysisReview?.pendingCount ?? 0} 条待处理 · ${editor.analysisReview?.openIssueCount ?? 0} 个问题`
                : editor.viewMode === "detail"
                  ? `${kindLabel}${editor.dirty ? " · 未保存" : ""}`
                  : editor.activeKind === "timeline"
                    ? `${categoryCount} 个事件`
                    : `${categoryCount} 项`}
            </span>
          </div>
          {analysisReviewOpen ? null : (
            <label className="ns-story-responsive-kind-switch">
              <span className="ns-visually-hidden">切换故事资料分类</span>
              <select
                aria-label="切换故事资料分类"
                onChange={(event) =>
                  editor.onKindSelect(event.currentTarget.value as StoryBibleEditorKind)
                }
                value={editor.activeKind}
              >
                {STORY_BIBLE_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {storyBibleKindLabel(kind)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {analysisReviewOpen ? null : (
          <div className="ns-story-toolbar">
            {editor.analysisReview === undefined ? null : (
              <button
                aria-controls="ns-story-analysis-review"
                aria-expanded={false}
                className="ns-icon-text-button ns-story-analysis-trigger"
                onClick={editor.analysisReview.onOpen}
                type="button"
              >
                <Inbox aria-hidden="true" size={14} />
                资料更新建议
                {editor.analysisReview.pendingCount + editor.analysisReview.openIssueCount ===
                0 ? null : (
                  <span className="ns-story-analysis-trigger-count">
                    {editor.analysisReview.pendingCount + editor.analysisReview.openIssueCount}
                  </span>
                )}
              </button>
            )}
            {editor.viewMode === "list" ? (
              <>
                <label className="ns-story-search-control">
                  <Search aria-hidden="true" size={14} />
                  <span className="ns-visually-hidden">搜索{kindLabel}</span>
                  <input
                    aria-label={`搜索${kindLabel}`}
                    className="ns-search-input"
                    onChange={(event) =>
                      editor.onFiltersChange({ query: event.currentTarget.value })
                    }
                    placeholder={`搜索${kindLabel}`}
                    value={editor.filters.query}
                  />
                </label>
                {editor.activeKind === "timeline" ? null : (
                  <label className="ns-story-filter-control">
                    <span>状态</span>
                    <select
                      aria-label="筛选资料状态"
                      onChange={(event) =>
                        editor.onFiltersChange({
                          status: event.currentTarget
                            .value as StoryBibleEditorProps["filters"]["status"]
                        })
                      }
                      value={editor.filters.status}
                    >
                      <option value="available">未删除</option>
                      <option value="active">启用</option>
                      <option value="draft">草稿</option>
                      <option value="archived">归档</option>
                      <option value="deleted">已删除</option>
                      <option value="all">全部（含已删除）</option>
                    </select>
                  </label>
                )}
                {editor.activeKind === "world" ? (
                  <label className="ns-story-filter-control">
                    <span>类型</span>
                    <select
                      aria-label="筛选世界观类型"
                      onChange={(event) =>
                        editor.onFiltersChange({
                          worldAssetType: event.currentTarget.value as
                            StoryBibleWorldAssetType | "all"
                        })
                      }
                      value={editor.filters.worldAssetType}
                    >
                      <option value="all">全部</option>
                      {WORLD_ASSET_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {editor.activeKind === "foreshadow" ? (
                  <>
                    <button
                      aria-controls="ns-foreshadow-analysis"
                      aria-expanded={editor.foreshadowAnalysis.status !== "closed"}
                      aria-label="AI 识别伏笔"
                      className="ns-icon-text-button"
                      disabled={editor.foreshadowAnalysis.status !== "closed"}
                      onClick={editor.onForeshadowAnalysisOpen}
                      ref={foreshadowAnalysisTriggerRef}
                      title="AI 识别伏笔"
                      type="button"
                    >
                      <Sparkles aria-hidden="true" size={14} />
                      AI 识别
                    </button>
                    <label className="ns-story-filter-control">
                      <span>跟踪</span>
                      <select
                        aria-label="筛选伏笔跟踪状态"
                        onChange={(event) =>
                          editor.onFiltersChange({
                            foreshadowTrackingStatus: event.currentTarget.value as
                              ForeshadowTrackingStatus | "all"
                          })
                        }
                        value={editor.filters.foreshadowTrackingStatus}
                      >
                        <option value="all">全部</option>
                        {STORY_BIBLE_FORESHADOW_STATUS_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                ) : null}
                {canCreate ? (
                  <StoryBibleCreateControl editor={editor} kindLabel={kindLabel} />
                ) : null}
              </>
            ) : null}
          </div>
        )}
      </div>

      {analysisReviewOpen && editor.analysisReview !== undefined ? (
        <StoryAnalysisReviewView
          chapterOptions={editor.chapterOptions}
          entries={editor.entries}
          review={editor.analysisReview}
        />
      ) : null}

      {editor.activeKind === "foreshadow" && editor.viewMode === "list" ? (
        <StoryBibleForeshadowAnalysis
          analysis={editor.foreshadowAnalysis}
          chapterOptions={editor.chapterOptions}
          entries={editor.entries}
          onBack={editor.onForeshadowAnalysisBack}
          onCandidateToggle={editor.onForeshadowAnalysisCandidateToggle}
          onChapterToggle={editor.onForeshadowAnalysisChapterToggle}
          onClose={closeForeshadowAnalysis}
          onConfirm={editor.onForeshadowAnalysisConfirm}
          onPreview={editor.onForeshadowAnalysisPreview}
          onRetryFailed={editor.onForeshadowAnalysisRetryFailed}
          onStart={editor.onForeshadowAnalysisStart}
        />
      ) : null}

      {editor.externalUpdate.status === "available" ? (
        <div className="ns-story-external-update">
          <span role="status">{editor.externalUpdate.message}</span>
          <div className="ns-story-external-update-actions">
            <button
              aria-label="重新加载外部更新"
              className="ns-icon-text-button"
              onClick={editor.onExternalUpdateReload}
              type="button"
            >
              <RotateCcw aria-hidden="true" size={14} />
              重新加载
            </button>
            <button
              aria-label="继续编辑当前草稿"
              className="ns-icon-text-button"
              onClick={editor.onExternalUpdateContinue}
              type="button"
            >
              <Pencil aria-hidden="true" size={14} />
              继续编辑
            </button>
          </div>
        </div>
      ) : null}

      {editor.consistency === undefined || editor.consistency.issues.length === 0 ? null : (
        <section className="ns-story-consistency" aria-label="Story Bible consistency warnings">
          <div className="ns-story-consistency-header">
            <strong>Story Bible consistency {editor.consistency.status}</strong>
            <span>Checked {editor.consistency.checkedAt}</span>
          </div>
          <ol>
            {editor.consistency.issues.map((issue) => (
              <StoryBibleConsistencyIssue
                issue={issue}
                key={issue.id}
                onEntrySelect={editor.onEntrySelect}
              />
            ))}
          </ol>
        </section>
      )}

      {editor.viewMode === "list" ? (
        editor.activeKind === "timeline" ? (
          <TimelineEventRail
            chapterOptions={editor.chapterOptions}
            entries={visibleEntries.filter((entry) => entry.kind === "timeline")}
            events={collectTimelineEvents(
              visibleEntries.filter((entry) => entry.kind === "timeline"),
              editor.filters.query
            )}
            onOpen={editor.onEntrySelect}
            query={editor.filters.query}
          />
        ) : foreshadowAnalysisOpen ? null : (
          <StoryBibleList editor={editor} entries={visibleEntries} kindLabel={kindLabel} />
        )
      ) : (
        <StoryBibleDetailForm editor={editor} kindLabel={kindLabel} />
      )}
    </section>
  );
}

function StoryBibleCreateControl({
  editor,
  kindLabel
}: {
  readonly editor: StoryBibleEditorProps;
  readonly kindLabel: string;
}) {
  if (editor.activeKind !== "world") {
    return (
      <button
        aria-label={`新建${kindLabel}`}
        className="ns-icon-text-button"
        onClick={() => editor.onNewDraft()}
        type="button"
      >
        <FilePlus aria-hidden="true" size={14} />
        新建{kindLabel}
      </button>
    );
  }

  return (
    <details className="ns-story-create-menu">
      <summary aria-label="新建世界观" className="ns-icon-text-button">
        <FilePlus aria-hidden="true" size={14} />
        新建世界观
      </summary>
      <div aria-label="选择世界观类型" className="ns-story-create-options" role="menu">
        {WORLD_ASSET_TYPE_OPTIONS.map((option) => (
          <button
            aria-label={`新建${option.label}`}
            key={option.value}
            onClick={() => editor.onNewDraft(option.value)}
            role="menuitem"
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
    </details>
  );
}

function StoryBibleList({
  editor,
  entries,
  kindLabel
}: {
  readonly editor: StoryBibleEditorProps;
  readonly entries: readonly StoryBibleEditorEntry[];
  readonly kindLabel: string;
}) {
  const filtersActive =
    editor.filters.query.trim().length > 0 ||
    editor.filters.status !== "available" ||
    (editor.activeKind === "world" && editor.filters.worldAssetType !== "all") ||
    (editor.activeKind === "foreshadow" && editor.filters.foreshadowTrackingStatus !== "all");
  const columns = storyBibleListColumns(editor.activeKind);

  return (
    <div
      aria-label={`${kindLabel}列表`}
      className="ns-story-list-view"
      data-story-list-kind={editor.activeKind}
    >
      {entries.length === 0 ? (
        <div className="ns-story-entry-empty">
          <span>{filtersActive ? "未找到匹配资料" : `还没有${kindLabel}`}</span>
          {filtersActive ? (
            <button
              className="ns-icon-text-button"
              onClick={() =>
                editor.onFiltersChange({
                  query: "",
                  status: "available",
                  worldAssetType: "all",
                  foreshadowTrackingStatus: "all"
                })
              }
              type="button"
            >
              <X aria-hidden="true" size={14} />
              清除筛选
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <div aria-hidden="true" className="ns-story-list-columns">
            {columns.map((column) => (
              <span key={column}>{column}</span>
            ))}
          </div>
          <ol className="ns-story-compact-list">
            {entries.map((entry) => (
              <li key={entry.id}>
                <button
                  aria-label={`打开${kindLabel}：${entry.title}`}
                  className="ns-story-list-row"
                  data-story-entry-id={entry.id}
                  onClick={() => editor.onEntrySelect(entry.id)}
                  type="button"
                >
                  <StoryBibleListRowContent editor={editor} entry={entry} />
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

function StoryBibleListRowContent({
  editor,
  entry
}: {
  readonly editor: StoryBibleEditorProps;
  readonly entry: StoryBibleEditorEntry;
}) {
  const title = (
    <span className="ns-story-list-title">
      <strong>{entry.title}</strong>
      {entry.aliases.length > 0 ? <small>{entry.aliases.join("、")}</small> : null}
    </span>
  );
  const status = (
    <span className="ns-story-list-status" data-status={entry.status}>
      {storyAssetStatusLabel(entry.status)}
    </span>
  );
  const summary = <span className="ns-story-list-summary">{entry.summary || "暂无摘要"}</span>;

  if (entry.kind === "character") {
    return (
      <>
        {title}
        <span className="ns-story-list-role">
          {detailString(entry.details, "role") || "未设置"}
        </span>
        {status}
        {summary}
      </>
    );
  }
  if (entry.kind === "world") {
    return (
      <>
        <span className="ns-story-world-type">{worldAssetTypeLabel(entry.assetType)}</span>
        {title}
        {status}
        {summary}
      </>
    );
  }
  if (entry.kind === "foreshadow") {
    const overdue = isStoryBibleForeshadowOverdue(
      entry.details,
      editor.chapterOptions,
      editor.currentChapterId
    );
    const actualPayoff = storyBibleChapterLabel(
      entry.details.actualPayoffChapterId,
      editor.chapterOptions
    );
    return (
      <>
        {title}
        <span
          className="ns-foreshadow-tracking-status"
          data-tracking-status={entry.details.trackingStatus}
        >
          {storyBibleForeshadowStatusLabel(entry.details.trackingStatus)}
          {overdue ? <small className="ns-foreshadow-overdue">逾期</small> : null}
        </span>
        <span className="ns-foreshadow-chapter" data-foreshadow-column="planted">
          <small>埋设</small>
          <span>
            {storyBibleChapterLabel(entry.details.plantedChapterId, editor.chapterOptions)}
          </span>
        </span>
        <span className="ns-foreshadow-chapter" data-foreshadow-column="planned-payoff">
          <small>计划回收</small>
          <span>
            {storyBibleChapterLabel(entry.details.plannedPayoffChapterId, editor.chapterOptions)}
          </span>
        </span>
        <span className="ns-foreshadow-chapter" data-foreshadow-column="actual-payoff">
          <small>实际回收</small>
          <span>{actualPayoff}</span>
        </span>
        <time dateTime={entry.updatedAt}>{formatStoryDate(entry.updatedAt)}</time>
        <span className="ns-foreshadow-row-secondary">
          实际回收：{actualPayoff} · 更新：{formatStoryDate(entry.updatedAt)}
        </span>
      </>
    );
  }

  return (
    <>
      {title}
      {summary}
      {status}
      <time dateTime={entry.updatedAt}>{formatStoryDate(entry.updatedAt)}</time>
    </>
  );
}

function storyBibleListColumns(kind: StoryBibleEditorKind): readonly string[] {
  switch (kind) {
    case "character":
      return ["姓名", "身份定位", "状态", "摘要"];
    case "world":
      return ["类型", "标题", "状态", "摘要"];
    case "foreshadow":
      return ["标题", "跟踪状态", "埋设章", "计划回收章", "实际回收章", "更新"];
    case "outline":
    case "timeline":
      return ["标题", "摘要", "状态", "更新"];
  }
}

function StoryBibleDetailForm({
  editor,
  kindLabel
}: {
  readonly editor: StoryBibleEditorProps;
  readonly kindLabel: string;
}) {
  const validationMessages =
    editor.draft.kind === "outline"
      ? validateStoryBibleOutline(
          editor.draft.details,
          editor.chapterOptions.map((chapter) => chapter.id)
        ).map(storyBibleOutlineValidationMessage)
      : editor.draft.kind === "foreshadow"
        ? validateStoryBibleForeshadow(
            editor.draft,
            editor.entries.filter((entry) => entry.kind === "foreshadow")
          ).map(storyBibleForeshadowValidationMessage)
        : editor.draft.kind === "timeline"
          ? validateStoryBibleTimeline(editor.draft.details).map(
              storyBibleTimelineValidationMessage
            )
          : [];
  const validationKindLabel =
    editor.draft.kind === "outline"
      ? "大纲"
      : editor.draft.kind === "foreshadow"
        ? "伏笔"
        : "时间线";

  return (
    <form
      aria-label="故事圣经编辑器"
      className="ns-story-editor-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (validationMessages.length > 0) return;
        editor.onSave();
      }}
    >
      <StoryBibleDetailFields editor={editor} />

      {validationMessages.length === 0 ? null : (
        <section
          aria-label={`${validationKindLabel}保存校验`}
          className="ns-story-validation"
          role="alert"
        >
          <strong>无法保存{validationKindLabel}</strong>
          <ul>
            {validationMessages.map((message, index) => (
              <li key={`${index}:${message}`}>{message}</li>
            ))}
          </ul>
        </section>
      )}

      {editor.draft.createdAt === undefined && editor.draft.updatedAt === undefined ? null : (
        <dl className="ns-story-metadata">
          {editor.draft.createdAt === undefined ? null : (
            <div>
              <dt>创建</dt>
              <dd>{formatStoryDateTime(editor.draft.createdAt)}</dd>
            </div>
          )}
          {editor.draft.updatedAt === undefined ? null : (
            <div>
              <dt>更新</dt>
              <dd>{formatStoryDateTime(editor.draft.updatedAt)}</dd>
            </div>
          )}
        </dl>
      )}

      <StoryBibleStatusActionPanel editor={editor} />
      <StoryBibleExplicitInversePreviewPanel editor={editor} />

      <div className="ns-story-editor-actions">
        <span className="ns-muted">{editor.dirty ? "有未保存修改" : kindLabel}</span>
        <div>
          <StoryBibleStatusActionButton editor={editor} />
          {editor.dirty || editor.draft.id === undefined ? (
            <button
              aria-label={editor.draft.id === undefined ? "取消新建" : "放弃修改"}
              className="ns-icon-text-button"
              disabled={editor.status === "saving"}
              onClick={editor.onCancelDraft}
              type="button"
            >
              <RotateCcw aria-hidden="true" size={14} />
              {editor.draft.id === undefined ? "取消新建" : "放弃修改"}
            </button>
          ) : null}
          <button
            aria-label="保存设定"
            className="ns-icon-text-button"
            disabled={
              editor.status === "saving" ||
              editor.explicitInversePreview !== undefined ||
              editor.draft.title.trim().length === 0 ||
              validationMessages.length > 0
            }
            type="submit"
          >
            <Check aria-hidden="true" size={14} />
            {editor.status === "saving" ? "保存中" : "保存设定"}
          </button>
        </div>
      </div>
      {editor.feedback === undefined ? null : (
        <p className="ns-project-feedback" data-kind={editor.feedback.kind} role="status">
          {editor.feedback.message}
        </p>
      )}
    </form>
  );
}

function StoryBibleExplicitInversePreviewPanel({
  editor
}: {
  readonly editor: StoryBibleEditorProps;
}) {
  const preview = editor.explicitInversePreview;
  if (preview === undefined) return null;
  const applying = preview.status === "applying";
  return (
    <section
      aria-label="显式双向关系变更预览"
      className="ns-story-status-confirmation"
      role="dialog"
    >
      <div className="ns-story-status-confirmation-header">
        <strong>确认双端关系变更</strong>
        <span>{preview.files.length} 项资料属于同一一致性组</span>
      </div>
      <p>确认后才会原子写入全部端点；任一端失败时不会保留半套关系。</p>
      <ol className="ns-story-status-reference-list">
        {preview.files.map((file) => (
          <li key={file.assetId}>
            <strong>{file.title}</strong>
            <span>{file.side === "source" ? "当前资料" : "反向端资料"}</span>
            <code>{file.hunkCount} 处差异</code>
          </li>
        ))}
      </ol>
      <small className="ns-muted">预览有效至 {formatStoryDateTime(preview.expiresAt)}</small>
      <div className="ns-story-status-confirmation-actions">
        <button
          aria-label="取消双端关系预览"
          className="ns-icon-text-button"
          disabled={applying}
          onClick={editor.onExplicitInversePreviewCancel}
          type="button"
        >
          取消并保留草稿
        </button>
        <button
          aria-label="确认保存双端关系"
          className="ns-icon-text-button"
          disabled={applying}
          onClick={editor.onSave}
          type="button"
        >
          {applying ? "原子保存中" : "确认原子保存"}
        </button>
      </div>
    </section>
  );
}

function StoryBibleStatusActionButton({ editor }: { readonly editor: StoryBibleEditorProps }) {
  if (
    editor.draft.id === undefined ||
    editor.onStatusActionRequest === undefined ||
    (editor.draft.kind === "outline" && editor.draft.status !== "deleted") ||
    (editor.draft.kind === "timeline" && editor.draft.status !== "deleted")
  ) {
    return null;
  }

  const restoring = editor.draft.status === "deleted";
  const action = restoring ? "restore" : "move-to-deleted";
  const label = restoring ? "恢复资料" : "移入已删除";
  const busy = editor.statusAction?.status === "loading";
  return (
    <button
      aria-label={label}
      className="ns-icon-text-button"
      data-story-status-action={action}
      disabled={editor.status === "saving" || editor.dirty || busy}
      onClick={() => editor.onStatusActionRequest?.(action)}
      title={editor.dirty ? "请先保存或放弃当前修改" : label}
      type="button"
    >
      {busy ? (
        <LoaderCircle aria-hidden="true" className="ns-spin" size={14} />
      ) : restoring ? (
        <ArchiveRestore aria-hidden="true" size={14} />
      ) : (
        <Trash2 aria-hidden="true" size={14} />
      )}
      {busy ? "检查中" : label}
    </button>
  );
}

function StoryBibleStatusActionPanel({ editor }: { readonly editor: StoryBibleEditorProps }) {
  const state = editor.statusAction;
  if (state === undefined || state.status === "idle" || state.status === "loading") return null;

  const deleting = state.action === "move-to-deleted";
  const title = deleting ? "移入已删除确认" : "恢复资料确认";
  const confirmLabel = deleting ? "确认移入已删除" : "确认恢复资料";
  return (
    <section aria-label={title} className="ns-story-status-confirmation" role="dialog">
      <div className="ns-story-status-confirmation-header">
        <strong>{title}</strong>
        <span>{state.assetTitle}</span>
      </div>

      {state.status === "error" ? (
        <p className="ns-project-feedback" data-kind="error" role="alert">
          {state.message}
        </p>
      ) : deleting ? (
        <>
          <p>不会物理删除，也不会级联修改引用方；现有引用会保留并明确标记为失效。</p>
          <p>
            {state.affectedReferenceCount} 条入向引用，涉及 {state.affectedAssetIds.length} 项资料。
          </p>
          {state.incoming.length === 0 ? (
            <p className="ns-muted">没有入向引用。</p>
          ) : (
            <ol className="ns-story-status-reference-list">
              {state.incoming.map((reference) => (
                <li key={`${reference.sourceAssetId}:${reference.path}`}>
                  <strong>{reference.sourceTitle}</strong>
                  <span data-integrity={reference.integrity}>
                    {reference.relationType ?? reference.kind} ·{" "}
                    {storyReferenceIntegrityLabel(reference.integrity)}
                  </span>
                  <code>{reference.path}</code>
                </li>
              ))}
            </ol>
          )}
          {state.canSetDeleted ? null : (
            <p className="ns-project-feedback" data-kind="error" role="alert">
              大纲和时间线单例不能移入已删除。
            </p>
          )}
        </>
      ) : (
        <p>恢复后资料会重新进入可用列表；原有引用不会被自动改写。</p>
      )}

      <div className="ns-story-status-confirmation-actions">
        {state.status === "error" ? (
          <button
            aria-label={deleting ? "重新检查删除影响" : "重试恢复资料"}
            className="ns-icon-text-button"
            onClick={() => editor.onStatusActionRequest?.(state.action)}
            type="button"
          >
            <RotateCcw aria-hidden="true" size={14} />
            重试
          </button>
        ) : null}
        <button
          aria-label={deleting ? "取消移入已删除" : "取消恢复资料"}
          className="ns-icon-text-button"
          onClick={editor.onStatusActionCancel}
          type="button"
        >
          取消
        </button>
        {state.status === "confirmation" ? (
          <button
            aria-label={confirmLabel}
            className="ns-icon-text-button"
            disabled={deleting && !state.canSetDeleted}
            onClick={editor.onStatusActionConfirm}
            type="button"
          >
            {deleting ? (
              <Trash2 aria-hidden="true" size={14} />
            ) : (
              <ArchiveRestore aria-hidden="true" size={14} />
            )}
            {confirmLabel}
          </button>
        ) : null}
      </div>
    </section>
  );
}

function storyReferenceIntegrityLabel(
  integrity: "valid" | "deleted" | "missing" | "type-mismatch"
): string {
  switch (integrity) {
    case "valid":
      return "有效";
    case "deleted":
      return "目标已删除";
    case "missing":
      return "目标缺失";
    case "type-mismatch":
      return "类型不匹配";
  }
}

function StoryBibleDetailFields({ editor }: { readonly editor: StoryBibleEditorProps }) {
  switch (editor.draft.kind) {
    case "character":
      return <StrictCharacterDetailFields editor={editor} />;
    case "world":
      return <StrictWorldDetailFields editor={editor} />;
    case "outline":
      return <StoryBibleOutlineEditor editor={editor} />;
    case "foreshadow":
      return <StoryBibleForeshadowEditor editor={editor} />;
    case "timeline":
      return <StoryBibleTimelineEditor editor={editor} />;
  }
}

function filterStoryBibleEntries(
  entries: readonly StoryBibleEditorEntry[],
  editor: StoryBibleEditorProps
): readonly StoryBibleEditorEntry[] {
  const query = editor.filters.query.trim().toLocaleLowerCase("zh-CN");
  return entries.filter((entry) => {
    if (
      editor.activeKind !== "timeline" &&
      ((editor.filters.status === "available" && entry.status === "deleted") ||
        (editor.filters.status !== "available" &&
          editor.filters.status !== "all" &&
          entry.status !== editor.filters.status))
    ) {
      return false;
    }
    if (
      entry.kind === "world" &&
      editor.filters.worldAssetType !== "all" &&
      entry.assetType !== editor.filters.worldAssetType
    ) {
      return false;
    }
    if (
      entry.kind === "foreshadow" &&
      editor.filters.foreshadowTrackingStatus !== "all" &&
      entry.details.trackingStatus !== editor.filters.foreshadowTrackingStatus
    ) {
      return false;
    }
    if (query.length === 0) return true;
    return [
      entry.title,
      entry.summary,
      entry.status,
      entry.assetType,
      ...(entry.kind === "world" ? [worldAssetTypeLabel(entry.assetType)] : []),
      ...entry.aliases,
      ...collectJsonStrings(entry.details)
    ].some((value) => value.toLocaleLowerCase("zh-CN").includes(query));
  });
}

function storyBibleChapterLabel(
  chapterId: string | undefined,
  chapters: StoryBibleEditorProps["chapterOptions"]
): string {
  if (chapterId === undefined || chapterId.length === 0) return "未设置";
  const chapter = chapters.find((candidate) => candidate.id === chapterId);
  return chapter === undefined ? `${chapterId}（已不存在）` : `${chapter.order}. ${chapter.title}`;
}

function detailString(details: JsonObject, key: string): string {
  const value = details[key];
  return typeof value === "string" ? value : "";
}

function collectJsonStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectJsonStrings);
  if (typeof value === "object" && value !== null) {
    return Object.values(value).flatMap(collectJsonStrings);
  }
  return [];
}

function worldAssetTypeLabel(assetType: StoryBibleWorldAssetType): string {
  switch (assetType) {
    case "world.location":
      return "地点";
    case "world.faction":
      return "势力";
    case "world.rule":
      return "规则";
    case "world.glossary":
      return "术语";
    case "world.item":
      return "物品";
    case "world.lore":
      return "背景资料";
  }
}

function storyAssetStatusLabel(status: StoryBibleEditorEntry["status"]): string {
  switch (status) {
    case "active":
      return "启用";
    case "draft":
      return "草稿";
    case "archived":
      return "归档";
    case "deleted":
      return "已删除";
  }
}

function formatStoryDate(value: string): string {
  return value.slice(0, 10);
}

function formatStoryDateTime(value: string): string {
  return `${value.slice(0, 10)} ${value.slice(11, 16)}`;
}

function StoryBibleConsistencyIssue({
  issue,
  onEntrySelect
}: {
  readonly issue: StoryBibleConsistencyIssueProps;
  readonly onEntrySelect: (entryId: string) => void;
}) {
  return (
    <li className="ns-story-consistency-issue" data-severity={issue.severity}>
      <div>
        <strong>{issue.title}</strong>
        <span>{issue.sourceRef.title}</span>
        <span>{issue.targetRef.title}</span>
      </div>
      <p>{issue.message}</p>
      <span>{issue.suggestedAction}</span>
      <button
        aria-label={`Open consistency target: ${issue.targetRef.title}`}
        className="ns-icon-text-button"
        onClick={() => onEntrySelect(issue.targetRef.id)}
        type="button"
      >
        Open target
      </button>
    </li>
  );
}

const storyBibleKindLabels: Readonly<Record<StoryBibleEditorKind, string>> = {
  character: "人物",
  world: "世界观",
  outline: "大纲",
  foreshadow: "伏笔",
  timeline: "时间线"
};

function storyBibleKindLabel(kind: StoryBibleEditorKind): string {
  return storyBibleKindLabels[kind];
}

export function ProjectSearchView({ search }: { readonly search: ProjectSearchProps }) {
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
    case "story.foreshadow":
      return "伏笔";
    case "memory":
      return "记忆";
  }
}

function formatSearchDate(value: string): string {
  return `索引 ${value.slice(0, 10)} ${value.slice(11, 16)}`;
}
