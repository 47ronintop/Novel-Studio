import type { ProjectSearchResultItem } from "@novel-studio/application";
import type { ForeshadowTrackingStatus, JsonObject } from "@novel-studio/shared";
import {
  ArrowLeft,
  Check,
  Clock3,
  FilePlus,
  Pencil,
  RotateCcw,
  Search,
  Sparkles,
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
  { value: "world.glossary", label: "术语" }
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
    <section aria-label="故事圣经" className="ns-story-editor" data-view-mode={editor.viewMode}>
      <div className="ns-story-editor-header">
        <div className="ns-story-title-group">
          {editor.viewMode === "detail" ? (
            <button
              aria-label={`返回${kindLabel}列表`}
              className="ns-icon-button"
              onClick={() => editor.onKindSelect(editor.activeKind)}
              title={`返回${kindLabel}列表`}
              type="button"
            >
              <ArrowLeft aria-hidden="true" size={16} />
            </button>
          ) : null}
          <div>
            <h1>{editor.viewMode === "detail" ? detailTitle : kindLabel}</h1>
            <span className="ns-muted">
              {editor.viewMode === "detail"
                ? `${kindLabel}${editor.dirty ? " · 未保存" : ""}`
                : editor.activeKind === "timeline"
                  ? `${categoryCount} 个事件`
                  : `${categoryCount} 项`}
            </span>
          </div>
        </div>
        {editor.viewMode === "list" ? (
          <div className="ns-story-toolbar">
            <label className="ns-story-search-control">
              <Search aria-hidden="true" size={14} />
              <span className="ns-visually-hidden">搜索{kindLabel}</span>
              <input
                aria-label={`搜索${kindLabel}`}
                className="ns-search-input"
                onChange={(event) => editor.onFiltersChange({ query: event.currentTarget.value })}
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
                  <option value="all">全部</option>
                  <option value="active">启用</option>
                  <option value="draft">草稿</option>
                  <option value="archived">归档</option>
                  <option value="deleted">已删除</option>
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
                      worldAssetType: event.currentTarget.value as StoryBibleWorldAssetType | "all"
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
            {canCreate ? <StoryBibleCreateControl editor={editor} kindLabel={kindLabel} /> : null}
          </div>
        ) : null}
      </div>

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
        <p className="ns-story-external-update" role="status">
          {editor.externalUpdate.message}
        </p>
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
    editor.filters.status !== "all" ||
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
                  status: "all",
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

      <div className="ns-story-editor-actions">
        <span className="ns-muted">{editor.dirty ? "有未保存修改" : kindLabel}</span>
        <div>
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

function StoryBibleDetailFields({ editor }: { readonly editor: StoryBibleEditorProps }) {
  switch (editor.draft.kind) {
    case "character":
      return <CharacterDetailFields editor={editor} />;
    case "world":
      return <WorldDetailFields editor={editor} />;
    case "outline":
      return <StoryBibleOutlineEditor editor={editor} />;
    case "foreshadow":
      return <StoryBibleForeshadowEditor editor={editor} />;
    case "timeline":
      return <StoryBibleTimelineEditor editor={editor} />;
  }
}

function CharacterDetailFields({ editor }: { readonly editor: StoryBibleEditorProps }) {
  if (editor.draft.kind !== "character") return null;
  const goals = detailStrings(editor.draft.details, "goals");
  const conflicts = detailStrings(editor.draft.details, "conflicts");
  const arc = detailObject(editor.draft.details, "arc");
  const turningPoints = detailStrings(arc, "turningPoints");
  const appearanceChapterIds = detailStrings(editor.draft.details, "appearanceChapterIds");

  const updateGoal = (index: number, value: string) => {
    const nextGoals = [...goals];
    while (nextGoals.length <= index) nextGoals.push("");
    nextGoals[index] = value;
    editor.onDraftChange("character", {
      details: { goals: trimTrailingEmptyStrings(nextGoals) }
    });
  };

  return (
    <>
      <div className="ns-story-form-grid ns-story-form-grid-compact">
        <StoryTextInput
          ariaLabel="人物姓名"
          label="姓名"
          onChange={(title) => editor.onDraftChange("character", { title })}
          value={editor.draft.title}
        />
        <StoryTextInput
          ariaLabel="身份定位"
          label="身份定位"
          onChange={(role) => editor.onDraftChange("character", { details: { role } })}
          value={detailString(editor.draft.details, "role")}
        />
        <StoryTextArea
          ariaLabel="人物简介"
          label="简介"
          onChange={(summary) => editor.onDraftChange("character", { summary })}
          value={editor.draft.summary}
          wide
        />
        <StoryTextArea
          ariaLabel="外在目标"
          label="外在目标"
          onChange={(value) => updateGoal(0, value)}
          value={goals[0] ?? ""}
        />
        <StoryTextArea
          ariaLabel="内在目标"
          label="内在目标"
          onChange={(value) => updateGoal(1, value)}
          value={goals[1] ?? ""}
        />
        <StoryTextArea
          ariaLabel="主要冲突"
          label="主要冲突"
          onChange={(value) =>
            editor.onDraftChange("character", { details: { conflicts: splitStoryLines(value) } })
          }
          value={conflicts.join("\n")}
          wide
        />
        <StoryTextArea
          ariaLabel="人物弧起点"
          label="人物弧起点"
          onChange={(start) => editor.onDraftChange("character", { details: { arc: { start } } })}
          value={detailString(arc, "start")}
        />
        <StoryTextArea
          ariaLabel="人物弧目标状态"
          label="人物弧目标状态"
          onChange={(end) => editor.onDraftChange("character", { details: { arc: { end } } })}
          value={detailString(arc, "end")}
        />
        <StoryTextArea
          ariaLabel="人物弧转折"
          label="人物弧转折"
          onChange={(value) =>
            editor.onDraftChange("character", {
              details: { arc: { turningPoints: splitStoryLines(value) } }
            })
          }
          value={turningPoints.join("\n")}
          wide
        />
        <StoryRelatedIdsField
          ariaLabel="关联人物与资料"
          editor={editor}
          label="关联人物 / 资料 ID"
        />
        <StoryChapterSelect
          ariaLabel="关联章节"
          chapterIds={appearanceChapterIds}
          editor={editor}
          onChange={(chapterIds) =>
            editor.onDraftChange("character", { details: { appearanceChapterIds: chapterIds } })
          }
        />
      </div>
      <details className="ns-story-supplemental">
        <summary>补充设定</summary>
        <div className="ns-story-form-grid ns-story-form-grid-compact">
          <StoryStatusField editor={editor} />
          <StoryAliasesField editor={editor} />
        </div>
      </details>
    </>
  );
}

function WorldDetailFields({ editor }: { readonly editor: StoryBibleEditorProps }) {
  if (editor.draft.kind !== "world") return null;
  const definitions = worldDetailFieldDefinitions(editor.draft.assetType);

  return (
    <div className="ns-story-form-grid ns-story-form-grid-compact">
      <StoryTextInput
        ariaLabel="世界观标题"
        label="标题"
        onChange={(title) => editor.onDraftChange("world", { title })}
        value={editor.draft.title}
      />
      <label className="ns-story-field">
        <span>类型</span>
        <select
          aria-label="世界观类型"
          disabled={editor.draft.id !== undefined}
          onChange={(event) =>
            editor.onDraftChange("world", {
              assetType: event.currentTarget.value as StoryBibleWorldAssetType
            })
          }
          value={editor.draft.assetType}
        >
          {WORLD_ASSET_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <StoryTextArea
        ariaLabel="世界观摘要"
        label="摘要"
        onChange={(summary) => editor.onDraftChange("world", { summary })}
        value={editor.draft.summary}
        wide
      />
      {definitions.map((definition) => (
        <StoryTextArea
          ariaLabel={definition.label}
          key={definition.key}
          label={definition.label}
          onChange={(value) =>
            editor.onDraftChange("world", {
              details: {
                [definition.key]: definition.lines ? splitStoryLines(value) : value
              }
            })
          }
          value={
            definition.lines
              ? detailStrings(editor.draft.details, definition.key).join("\n")
              : detailString(editor.draft.details, definition.key)
          }
          wide
        />
      ))}
      <StoryAliasesField editor={editor} />
      <StoryRelatedIdsField ariaLabel="关联资料 ID" editor={editor} label="关联资料 ID" />
      <StoryStatusField editor={editor} />
    </div>
  );
}

function StoryTextInput({
  ariaLabel,
  label,
  onChange,
  value
}: {
  readonly ariaLabel: string;
  readonly label: string;
  readonly onChange: (value: string) => void;
  readonly value: string;
}) {
  return (
    <label className="ns-story-field">
      <span>{label}</span>
      <input
        aria-label={ariaLabel}
        className="ns-search-input"
        onChange={(event) => onChange(event.currentTarget.value)}
        value={value}
      />
    </label>
  );
}

function StoryTextArea({
  ariaLabel,
  compact = true,
  label,
  onChange,
  value,
  wide = false
}: {
  readonly ariaLabel: string;
  readonly compact?: boolean;
  readonly label: string;
  readonly onChange: (value: string) => void;
  readonly value: string;
  readonly wide?: boolean;
}) {
  return (
    <label className={`ns-story-field${wide ? " ns-story-field-wide" : ""}`}>
      <span>{label}</span>
      <textarea
        aria-label={ariaLabel}
        className={`ns-story-textarea${compact ? " ns-story-textarea-compact" : ""}`}
        onChange={(event) => onChange(event.currentTarget.value)}
        value={value}
      />
    </label>
  );
}

function StoryStatusField({ editor }: { readonly editor: StoryBibleEditorProps }) {
  return (
    <label className="ns-story-field">
      <span>资料状态</span>
      <select
        aria-label="资料状态"
        onChange={(event) =>
          editor.onDraftChange(editor.draft.kind, {
            status: event.currentTarget.value as StoryBibleEditorProps["draft"]["status"]
          })
        }
        value={editor.draft.status}
      >
        <option value="active">启用</option>
        <option value="draft">草稿</option>
        <option value="archived">归档</option>
        <option value="deleted">已删除</option>
      </select>
    </label>
  );
}

function StoryAliasesField({ editor }: { readonly editor: StoryBibleEditorProps }) {
  return (
    <label className="ns-story-field ns-story-field-wide">
      <span>别名</span>
      <textarea
        aria-label="资料别名"
        className="ns-story-textarea ns-story-textarea-compact"
        onChange={(event) =>
          editor.onDraftChange(editor.draft.kind, {
            aliases: splitStoryLines(event.currentTarget.value)
          })
        }
        placeholder="每行一个别名"
        value={editor.draft.aliases.join("\n")}
      />
    </label>
  );
}

function StoryRelatedIdsField({
  ariaLabel,
  editor,
  label
}: {
  readonly ariaLabel: string;
  readonly editor: StoryBibleEditorProps;
  readonly label: string;
}) {
  return (
    <label className="ns-story-field ns-story-field-wide">
      <span>{label}</span>
      <textarea
        aria-label={ariaLabel}
        className="ns-story-textarea ns-story-textarea-compact"
        onChange={(event) =>
          editor.onDraftChange(editor.draft.kind, {
            relatedEntityIds: splitStoryLines(event.currentTarget.value)
          })
        }
        placeholder="每行一个资料 ID"
        value={editor.draft.relatedEntityIds.join("\n")}
      />
    </label>
  );
}

function StoryChapterSelect({
  ariaLabel,
  chapterIds,
  editor,
  onChange
}: {
  readonly ariaLabel: string;
  readonly chapterIds: readonly string[];
  readonly editor: StoryBibleEditorProps;
  readonly onChange: (chapterIds: string[]) => void;
}) {
  const knownIds = new Set(editor.chapterOptions.map((chapter) => chapter.id));
  const missingIds = chapterIds.filter((chapterId) => !knownIds.has(chapterId));
  return (
    <label className="ns-story-field ns-story-field-wide">
      <span>{ariaLabel}</span>
      <select
        aria-label={ariaLabel}
        className="ns-story-multi-select"
        multiple
        onChange={(event) =>
          onChange(Array.from(event.currentTarget.selectedOptions, (option) => option.value))
        }
        size={Math.min(Math.max(editor.chapterOptions.length + missingIds.length, 2), 5)}
        value={[...chapterIds]}
      >
        {editor.chapterOptions.length === 0 && missingIds.length === 0 ? (
          <option disabled value="">
            暂无章节
          </option>
        ) : null}
        {editor.chapterOptions.map((chapter) => (
          <option key={chapter.id} value={chapter.id}>
            {chapter.order}. {chapter.title}
          </option>
        ))}
        {missingIds.map((chapterId) => (
          <option key={chapterId} value={chapterId}>
            {chapterId}（章节已不存在）
          </option>
        ))}
      </select>
    </label>
  );
}

interface WorldDetailFieldDefinition {
  readonly key: string;
  readonly label: string;
  readonly lines?: boolean;
}

function worldDetailFieldDefinitions(
  assetType: StoryBibleWorldAssetType
): readonly WorldDetailFieldDefinition[] {
  switch (assetType) {
    case "world.location":
      return [
        { key: "geography", label: "地理" },
        { key: "culture", label: "文化" },
        { key: "constraints", label: "限制", lines: true }
      ];
    case "world.faction":
      return [
        { key: "goals", label: "目标", lines: true },
        { key: "structure", label: "结构" },
        { key: "membersOrInfluence", label: "成员或影响范围" }
      ];
    case "world.rule":
      return [
        { key: "rule", label: "规则正文" },
        { key: "scope", label: "适用范围" },
        { key: "constraints", label: "限制或例外", lines: true }
      ];
    case "world.glossary":
      return [
        { key: "definition", label: "定义" },
        { key: "firstAppearance", label: "首次出现说明" }
      ];
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
      editor.filters.status !== "all" &&
      entry.status !== editor.filters.status
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

function detailStrings(details: JsonObject, key: string): string[] {
  const value = details[key];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function detailObject(details: JsonObject, key: string): JsonObject {
  const value = details[key];
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function trimTrailingEmptyStrings(values: readonly string[]): string[] {
  const result = [...values];
  while (result.at(-1) === "") result.pop();
  return result;
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
  }
}

function splitStoryLines(value: string): string[] {
  return value.length === 0 ? [] : value.replace(/\r\n?/gu, "\n").split("\n");
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
