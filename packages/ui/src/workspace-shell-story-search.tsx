import type { ProjectSearchResultItem } from "@novel-studio/application";
import { ArrowLeft, Check, Clock3, FilePlus, RotateCcw, Search, X } from "lucide-react";

import type {
  ProjectSearchProps,
  StoryBibleConsistencyIssueProps,
  StoryBibleEditorEntry,
  StoryBibleEditorKind,
  StoryBibleEditorProps
} from "./workspace-shell-types.js";

export function TimelineMainView({
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
        parentEntryId: event.parentEntryId ?? entry.id,
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
                <span>{entry.summary}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function StoryBibleEditorView({ editor }: { readonly editor: StoryBibleEditorProps }) {
  const kindLabel = storyBibleKindLabel(editor.activeKind);
  const categoryEntries = editor.entries.filter((entry) => entry.kind === editor.activeKind);
  const visibleEntries = filterStoryBibleEntries(categoryEntries, editor);
  const singleton = editor.activeKind === "outline" || editor.activeKind === "timeline";
  const canCreate = !singleton || categoryEntries.length === 0;
  const detailTitle = editor.draft.title.trim() || `新建${kindLabel}`;

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
                : `${categoryEntries.length} 项`}
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
            <label className="ns-story-filter-control">
              <span>状态</span>
              <select
                aria-label="筛选资料状态"
                onChange={(event) =>
                  editor.onFiltersChange({
                    status: event.currentTarget.value as StoryBibleEditorProps["filters"]["status"]
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
            {canCreate ? (
              <button
                aria-label={`新建${kindLabel}`}
                className="ns-icon-text-button"
                onClick={editor.onNewDraft}
                type="button"
              >
                <FilePlus aria-hidden="true" size={14} />
                新建{kindLabel}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

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
        <StoryBibleList editor={editor} entries={visibleEntries} kindLabel={kindLabel} />
      ) : (
        <StoryBibleDetailForm editor={editor} kindLabel={kindLabel} />
      )}
    </section>
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
  const filtersActive = editor.filters.query.trim().length > 0 || editor.filters.status !== "all";

  return (
    <div aria-label={`${kindLabel}列表`} className="ns-story-list-view">
      {entries.length === 0 ? (
        <div className="ns-story-entry-empty">
          <span>{filtersActive ? "未找到匹配资料" : `还没有${kindLabel}`}</span>
          {filtersActive ? (
            <button
              className="ns-icon-text-button"
              onClick={() => editor.onFiltersChange({ query: "", status: "all" })}
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
            <span>标题</span>
            <span>摘要</span>
            <span>状态</span>
            <span>更新</span>
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
                  <span className="ns-story-list-title">
                    <strong>{entry.title}</strong>
                    {entry.aliases.length > 0 ? <small>{entry.aliases.join("、")}</small> : null}
                  </span>
                  <span className="ns-story-list-summary">{entry.summary || "暂无摘要"}</span>
                  <span className="ns-story-list-status" data-status={entry.status}>
                    {storyAssetStatusLabel(entry.status)}
                  </span>
                  <time dateTime={entry.updatedAt}>{formatStoryDate(entry.updatedAt)}</time>
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

function StoryBibleDetailForm({
  editor,
  kindLabel
}: {
  readonly editor: StoryBibleEditorProps;
  readonly kindLabel: string;
}) {
  return (
    <form
      aria-label="故事圣经编辑器"
      className="ns-story-editor-form"
      onSubmit={(event) => {
        event.preventDefault();
        editor.onSave();
      }}
    >
      <div className="ns-story-form-grid">
        <label className="ns-story-field">
          <span>标题</span>
          <input
            aria-label="设定标题"
            className="ns-search-input"
            onChange={(event) =>
              editor.onDraftChange(editor.draft.kind, { title: event.currentTarget.value })
            }
            value={editor.draft.title}
          />
        </label>
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
        <label className="ns-story-field ns-story-field-wide">
          <span>摘要</span>
          <textarea
            aria-label="设定正文"
            className="ns-story-textarea"
            onChange={(event) =>
              editor.onDraftChange(editor.draft.kind, { summary: event.currentTarget.value })
            }
            value={editor.draft.summary}
          />
        </label>
        <label className="ns-story-field ns-story-field-wide">
          <span>关联资料 ID</span>
          <textarea
            aria-label="关联资料 ID"
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
      </div>

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
            className="ns-icon-text-button"
            disabled={editor.status === "saving" || editor.draft.title.trim().length === 0}
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

function filterStoryBibleEntries(
  entries: readonly StoryBibleEditorEntry[],
  editor: StoryBibleEditorProps
): readonly StoryBibleEditorEntry[] {
  const query = editor.filters.query.trim().toLocaleLowerCase("zh-CN");
  return entries.filter((entry) => {
    if (editor.filters.status !== "all" && entry.status !== editor.filters.status) return false;
    if (query.length === 0) return true;
    return [entry.title, entry.summary, entry.status, entry.assetType, ...entry.aliases].some(
      (value) => value.toLocaleLowerCase("zh-CN").includes(query)
    );
  });
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
