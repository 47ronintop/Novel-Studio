import type { CreativeNavigatorMode } from "@novel-studio/shared";
import {
  BookOpenText,
  Brain,
  Clock3,
  FilePlus2,
  FileText,
  Globe2,
  MoreHorizontal,
  Plus,
  Search,
  UserRound,
  type LucideIcon
} from "lucide-react";
import { useId, type KeyboardEvent, type MouseEvent } from "react";

import type {
  CreativeWorkspaceNavigatorProps,
  StoryBibleEditorKind
} from "./workspace-shell-types.js";

const STORY_KINDS: readonly StoryBibleEditorKind[] = [
  "character",
  "world",
  "outline",
  "timeline",
  "memory"
];

const SINGLETON_KINDS = new Set<StoryBibleEditorKind>(["outline", "timeline"]);

const storyKindLabels: Readonly<Record<StoryBibleEditorKind, string>> = {
  character: "人物",
  world: "世界观",
  outline: "大纲",
  timeline: "时间线",
  memory: "记忆"
};

const storyKindIcons: Readonly<Record<StoryBibleEditorKind, LucideIcon>> = {
  character: UserRound,
  world: Globe2,
  outline: BookOpenText,
  timeline: Clock3,
  memory: Brain
};

export function CreativeWorkspaceNavigator(props: CreativeWorkspaceNavigatorProps) {
  const instanceId = useId().replaceAll(":", "");
  const writingTabId = `${instanceId}-creative-writing-tab`;
  const storyTabId = `${instanceId}-creative-story-tab`;
  const writingPanelId = `${instanceId}-creative-writing-panel`;
  const storyPanelId = `${instanceId}-creative-story-panel`;

  return (
    <nav
      aria-label="创作导航"
      className="ns-navigator ns-creative-navigator"
      data-region="navigator"
    >
      <div className="ns-panel-header">
        <span className="ns-creative-project-title">{props.projectTitle}</span>
        <span className="ns-creative-project-menu" aria-hidden="true">
          <MoreHorizontal size={15} />
        </span>
      </div>
      <div aria-label="创作导航模式" className="ns-creative-mode-tabs" role="tablist">
        <button
          aria-controls={writingPanelId}
          aria-selected={props.mode === "writing"}
          className="ns-creative-mode-tab"
          data-creative-mode="writing"
          id={writingTabId}
          onClick={() => props.onModeSelect("writing")}
          onKeyDown={(event) => handleModeTabKeyDown(event, "writing", props.onModeSelect)}
          role="tab"
          tabIndex={props.mode === "writing" ? 0 : -1}
          type="button"
        >
          写作
        </button>
        <button
          aria-controls={storyPanelId}
          aria-selected={props.mode === "story"}
          className="ns-creative-mode-tab"
          data-creative-mode="story"
          id={storyTabId}
          onClick={() => props.onModeSelect("story")}
          onKeyDown={(event) => handleModeTabKeyDown(event, "story", props.onModeSelect)}
          role="tab"
          tabIndex={props.mode === "story" ? 0 : -1}
          type="button"
        >
          故事资料
        </button>
      </div>
      <section
        aria-labelledby={writingTabId}
        className="ns-creative-panel"
        hidden={props.mode !== "writing"}
        id={writingPanelId}
        role="tabpanel"
      >
        <WritingProjection {...props} />
      </section>
      <section
        aria-labelledby={storyTabId}
        className="ns-creative-panel"
        hidden={props.mode !== "story"}
        id={storyPanelId}
        role="tabpanel"
      >
        <StoryProjection {...props} />
      </section>
    </nav>
  );
}

function WritingProjection(props: CreativeWorkspaceNavigatorProps) {
  const normalizedQuery = normalizeQuery(props.searchQuery);
  const filteredChapters = props.chapters.filter((chapter) =>
    chapter.title.toLocaleLowerCase().includes(normalizedQuery)
  );

  return (
    <>
      <NavigatorSearch
        ariaLabel="筛选章节"
        onChange={props.onSearchQueryChange}
        placeholder="筛选章节"
        value={props.searchQuery}
      />
      <div className="ns-creative-section-header">
        <span>章节 {props.chapters.length}</span>
        <button
          aria-label="新建章节"
          className="ns-icon-button"
          onClick={props.onCreateChapter}
          title="新建章节"
          type="button"
        >
          <FilePlus2 aria-hidden="true" size={14} />
        </button>
      </div>
      {props.chapters.length === 0 ? (
        <div className="ns-creative-empty">
          <span>还没有章节</span>
          <button className="ns-icon-text-button" onClick={props.onCreateChapter} type="button">
            <Plus aria-hidden="true" size={14} />
            创建第一章
          </button>
        </div>
      ) : filteredChapters.length === 0 ? (
        <div className="ns-creative-empty">
          <span>未找到匹配章节</span>
          <button
            aria-label="清除章节筛选"
            className="ns-icon-text-button"
            onClick={() => props.onSearchQueryChange("")}
            type="button"
          >
            清除筛选
          </button>
        </div>
      ) : (
        <ul className="ns-creative-list" aria-label="章节列表">
          {filteredChapters.map((chapter) => {
            const active = chapter.id === props.activeChapterId;
            const dirty = props.dirtyChapterIds.includes(chapter.id);
            return (
              <li
                className="ns-creative-chapter-row"
                data-active={active}
                data-chapter-id={chapter.id}
                data-dirty={dirty}
                key={chapter.id}
              >
                <button
                  aria-current={active ? "page" : undefined}
                  className="ns-creative-row-main"
                  onClick={() => props.onChapterOpen(chapter.id)}
                  type="button"
                >
                  <span className="ns-creative-row-label">
                    <FileText aria-hidden="true" size={14} />
                    <span>{highlightText(chapter.title, normalizedQuery)}</span>
                  </span>
                  <span className="ns-creative-row-count">
                    {formatChapterMeta(chapter.wordCount)}
                  </span>
                  <span className="ns-creative-row-meta">
                    <span>{chapter.status}</span>
                    {dirty ? <span>未保存</span> : null}
                  </span>
                </button>
                <ChapterActionMenu chapterId={chapter.id} props={props} title={chapter.title} />
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function StoryProjection(props: CreativeWorkspaceNavigatorProps) {
  const activeKind = props.storyBible.activeKind;
  const normalizedQuery = normalizeQuery(props.searchQuery);
  const activeEntries = props.storyBible.entries
    .filter((entry) => entry.kind === activeKind)
    .filter((entry) =>
      [entry.title, entry.status, entry.body].some((value) =>
        value.toLocaleLowerCase().includes(normalizedQuery)
      )
    );
  const activeKindHasEntry = props.storyBible.entries.some((entry) => entry.kind === activeKind);
  const canCreate = !SINGLETON_KINDS.has(activeKind) || !activeKindHasEntry;

  return (
    <>
      <NavigatorSearch
        ariaLabel="筛选故事资料"
        onChange={props.onSearchQueryChange}
        placeholder={`筛选${storyKindLabels[activeKind]}`}
        value={props.searchQuery}
      />
      <div aria-label="故事资料分类" className="ns-story-kind-list">
        {STORY_KINDS.map((kind) => {
          const KindIcon = storyKindIcons[kind];
          const count = props.storyBible.entries.filter((entry) => entry.kind === kind).length;
          return (
            <button
              aria-pressed={kind === activeKind}
              className="ns-story-kind-button"
              data-story-kind={kind}
              key={kind}
              onClick={() => props.onStoryKindOpen(kind)}
              type="button"
            >
              <span className="ns-creative-row-label">
                <KindIcon aria-hidden="true" size={14} />
                <span>{storyKindLabels[kind]}</span>
              </span>
              <span className="ns-creative-row-count">{count}</span>
            </button>
          );
        })}
      </div>
      <div className="ns-creative-section-header">
        <span>{storyKindLabels[activeKind]}</span>
        {canCreate ? (
          <button
            aria-label={`新建${storyKindLabels[activeKind]}`}
            className="ns-icon-button"
            onClick={() => props.onStoryEntryCreate(activeKind)}
            title={`新建${storyKindLabels[activeKind]}`}
            type="button"
          >
            <Plus aria-hidden="true" size={14} />
          </button>
        ) : null}
      </div>
      {activeEntries.length === 0 ? (
        <div className="ns-creative-empty">
          <span>
            {normalizedQuery.length === 0
              ? `还没有${storyKindLabels[activeKind]}`
              : "未找到匹配资料"}
          </span>
          {normalizedQuery.length > 0 ? (
            <button
              aria-label="清除故事资料筛选"
              className="ns-icon-text-button"
              onClick={() => props.onSearchQueryChange("")}
              type="button"
            >
              清除筛选
            </button>
          ) : null}
        </div>
      ) : (
        <ul className="ns-creative-list" aria-label={`${storyKindLabels[activeKind]}列表`}>
          {activeEntries.map((entry) => {
            const EntryIcon = storyKindIcons[entry.kind];
            return (
              <li key={entry.id}>
                <button
                  aria-current={props.storyBible.draft.id === entry.id ? "page" : undefined}
                  className="ns-story-entry-button"
                  data-story-entry-id={entry.id}
                  onClick={() => props.onStoryEntryOpen(entry.id)}
                  type="button"
                >
                  <span className="ns-creative-row-label">
                    <EntryIcon aria-hidden="true" size={14} />
                    <span>{highlightText(entry.title, normalizedQuery)}</span>
                  </span>
                  <span className="ns-creative-row-count">{entry.status}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function NavigatorSearch({
  ariaLabel,
  onChange,
  placeholder,
  value
}: {
  readonly ariaLabel: string;
  readonly onChange: (query: string) => void;
  readonly placeholder: string;
  readonly value: string;
}) {
  return (
    <label className="ns-navigator-search">
      <Search aria-hidden="true" size={14} />
      <input
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={placeholder}
        value={value}
      />
    </label>
  );
}

function ChapterActionMenu({
  chapterId,
  props,
  title
}: {
  readonly chapterId: string;
  readonly props: CreativeWorkspaceNavigatorProps;
  readonly title: string;
}) {
  return (
    <details className="ns-navigator-actions">
      <summary aria-label={`章节更多操作：${title}`} title={`章节更多操作：${title}`}>
        <MoreHorizontal aria-hidden="true" size={14} />
      </summary>
      <div className="ns-navigator-action-menu">
        <button
          aria-label={`重命名章节：${title}`}
          onClick={(event) => {
            stopRowOpen(event);
            const nextTitle = promptForChapterTitle(title);
            if (nextTitle !== undefined) {
              props.onChapterRename(chapterId, nextTitle);
            }
          }}
          type="button"
        >
          重命名
        </button>
        <button
          aria-label={`复制章节：${title}`}
          onClick={(event) => {
            stopRowOpen(event);
            props.onChapterDuplicate(chapterId);
          }}
          type="button"
        >
          复制
        </button>
        <button
          aria-label={`删除章节：${title}`}
          onClick={(event) => {
            stopRowOpen(event);
            if (confirmChapterDelete(title)) {
              props.onChapterDelete(chapterId);
            }
          }}
          type="button"
        >
          删除
        </button>
      </div>
    </details>
  );
}

function handleModeTabKeyDown(
  event: KeyboardEvent<HTMLButtonElement>,
  currentMode: CreativeNavigatorMode,
  onModeSelect: (mode: CreativeNavigatorMode) => void
): void {
  const modes: readonly CreativeNavigatorMode[] = ["writing", "story"];
  const currentIndex = modes.indexOf(currentMode);
  let nextMode: CreativeNavigatorMode | undefined;

  switch (event.key) {
    case "ArrowLeft":
      nextMode = modes[(currentIndex - 1 + modes.length) % modes.length];
      break;
    case "ArrowRight":
      nextMode = modes[(currentIndex + 1) % modes.length];
      break;
    case "Home":
      nextMode = modes[0];
      break;
    case "End":
      nextMode = modes[modes.length - 1];
      break;
    default:
      return;
  }

  event.preventDefault();
  if (nextMode === undefined) {
    return;
  }
  const target = event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(
    `[data-creative-mode="${nextMode}"]`
  );
  target?.focus();
  onModeSelect(nextMode);
}

function stopRowOpen(event: MouseEvent<HTMLButtonElement>): void {
  event.stopPropagation();
}

function normalizeQuery(query: string): string {
  return query.trim().toLocaleLowerCase();
}

function highlightText(value: string, query: string) {
  if (query.length === 0) {
    return value;
  }

  const index = value.toLocaleLowerCase().indexOf(query);
  if (index < 0) {
    return value;
  }

  return (
    <>
      {value.slice(0, index)}
      <mark>{value.slice(index, index + query.length)}</mark>
      {value.slice(index + query.length)}
    </>
  );
}

function formatChapterMeta(wordCount: number | undefined): string {
  return wordCount === undefined ? "未统计" : `${wordCount.toLocaleString("en-US")} 字`;
}

function promptForChapterTitle(currentTitle: string): string | undefined {
  const nextTitle = globalThis.window?.prompt("输入新的章节标题", currentTitle)?.trim();
  return nextTitle === undefined || nextTitle.length === 0 ? undefined : nextTitle;
}

function confirmChapterDelete(title: string): boolean {
  return (
    globalThis.window?.confirm(
      `确认删除章节“${title}”？章节文件会被标记为 deleted，不会物理移除。`
    ) === true
  );
}
