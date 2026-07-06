import type { ProjectSearchResultItem } from "@novel-studio/application";
import { Check, Clock3, FilePlus, Search } from "lucide-react";

import type {
  ProjectSearchProps,
  StoryBibleConsistencyIssueProps,
  StoryBibleEditorKind,
  StoryBibleEditorProps
} from "./workspace-shell.js";

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

export function StoryBibleEditorView({ editor }: { readonly editor: StoryBibleEditorProps }) {
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
    case "memory":
      return "记忆";
  }
}

function formatSearchDate(value: string): string {
  return `索引 ${value.slice(0, 10)} ${value.slice(11, 16)}`;
}
