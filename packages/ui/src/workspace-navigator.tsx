import type { ActivityId, NavigatorSection } from "@novel-studio/application";
import { FilePlus, FolderOpen, FolderPlus, MoreHorizontal, Search } from "lucide-react";
import type { ReactNode } from "react";

import type { ConfigStudioAssetType, ConfigStudioPanelProps } from "./config-studio-panel.js";
import type {
  ProjectWorkflowProps,
  StoryBibleEditorKind,
  StoryBibleEditorProps
} from "./workspace-shell-types.js";

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

export interface WorkspaceNavigatorProps {
  readonly activeActivity: ActivityId;
  readonly sections: readonly NavigatorSection[];
  readonly expandedSectionIds?: readonly string[] | undefined;
  readonly searchQuery?: string | undefined;
  readonly projectWorkflow?: ProjectWorkflowProps | undefined;
  readonly storyBibleEditor?: StoryBibleEditorProps | undefined;
  readonly studio?: ConfigStudioPanelProps | undefined;
  readonly collapsed?: boolean | undefined;
  readonly focusHidden?: boolean | undefined;
  readonly onSearchQueryChange?: ((query: string) => void) | undefined;
  readonly onExpandedSectionIdsChange?: ((sectionIds: readonly string[]) => void) | undefined;
  readonly onRenameChapter?: ProjectWorkflowProps["onRenameChapter"] | undefined;
  readonly onDuplicateChapter?: ProjectWorkflowProps["onDuplicateChapter"] | undefined;
  readonly onDeleteChapter?: ProjectWorkflowProps["onDeleteChapter"] | undefined;
  readonly onActivitySelect?: ((activityId: ActivityId) => void) | undefined;
}

export function WorkspaceNavigator({
  activeActivity,
  sections,
  expandedSectionIds = sections.map((section) => section.id),
  searchQuery = "",
  projectWorkflow,
  storyBibleEditor,
  studio,
  collapsed = false,
  focusHidden = false,
  onSearchQueryChange,
  onExpandedSectionIdsChange,
  onRenameChapter,
  onDuplicateChapter,
  onDeleteChapter,
  onActivitySelect
}: WorkspaceNavigatorProps) {
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  const expanded = new Set(expandedSectionIds);

  return (
    <nav
      aria-label="项目导航"
      className="ns-navigator"
      data-collapsed={collapsed}
      data-focus-hidden={focusHidden}
      data-region="navigator"
    >
      <div className="ns-panel-header">
        <span>项目资产</span>
        <span>{sections.length}</span>
      </div>
      {projectWorkflow === undefined ? null : <ProjectWorkflowControls projectWorkflow={projectWorkflow} />}
      <label className="ns-navigator-search">
        <Search aria-hidden="true" size={14} />
        <input
          aria-label="筛选项目资产"
          onChange={(event) => onSearchQueryChange?.(event.currentTarget.value)}
          placeholder="筛选章节、设定或工作流"
          value={searchQuery}
        />
      </label>
      <ul className="ns-tree">
        {sections.map((section) => {
          const label = navigatorSectionLabels.get(section.id) ?? section.title;
          const items = buildSectionItems({
            sectionId: section.id,
            query: normalizedQuery,
            projectWorkflow,
            storyBibleEditor,
            studio,
            onRenameChapter,
            onDuplicateChapter,
            onDeleteChapter,
            onActivitySelect
          });
          const isExpanded = expanded.has(section.id);
          return (
            <li key={section.id}>
              <section
                aria-label={`${label} 分组`}
                className="ns-tree-group"
                data-selected={navigatorSectionSelected(section.id, activeActivity)}
                data-expanded={isExpanded}
              >
                <button
                  aria-expanded={isExpanded}
                  aria-label={`切换导航分组：${label}`}
                  className="ns-tree-row"
                  onClick={() =>
                    onExpandedSectionIdsChange?.(toggleSection(expandedSectionIds, section.id))
                  }
                  type="button"
                >
                  <span>{label}</span>
                  <span>{items.length}</span>
                </button>
                {isExpanded ? <ul className="ns-navigator-item-list">{items}</ul> : null}
              </section>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function ProjectWorkflowControls({
  projectWorkflow
}: {
  readonly projectWorkflow: ProjectWorkflowProps;
}) {
  return (
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
        <p className="ns-project-feedback" data-kind={projectWorkflow.feedback.kind} role="status">
          {projectWorkflow.feedback.message}
        </p>
      )}
    </div>
  );
}

function buildSectionItems(input: {
  readonly sectionId: string;
  readonly query: string;
  readonly projectWorkflow?: ProjectWorkflowProps | undefined;
  readonly storyBibleEditor?: StoryBibleEditorProps | undefined;
  readonly studio?: ConfigStudioPanelProps | undefined;
  readonly onRenameChapter?: ProjectWorkflowProps["onRenameChapter"] | undefined;
  readonly onDuplicateChapter?: ProjectWorkflowProps["onDuplicateChapter"] | undefined;
  readonly onDeleteChapter?: ProjectWorkflowProps["onDeleteChapter"] | undefined;
  readonly onActivitySelect?: ((activityId: ActivityId) => void) | undefined;
}): ReactNode[] {
  if (input.sectionId === "chapters") {
    return (
      input.projectWorkflow?.chapters
        .filter((chapter) =>
          matchesQuery(input.query, [
            chapter.title,
            chapter.status,
            chapter.wordCount?.toString() ?? "",
            chapter.updatedAt
          ])
        )
        .map((chapter) => (
          <li key={chapter.id}>
            <div
              className="ns-navigator-item"
              data-active={input.projectWorkflow?.activeChapterId === chapter.id}
            >
              <button
                {...(input.projectWorkflow?.activeChapterId === chapter.id
                  ? { "aria-current": "true" as const }
                  : {})}
                className="ns-navigator-item-main"
                onClick={() => input.projectWorkflow?.onSelectChapter(chapter.id)}
                type="button"
              >
                <span>{highlightText(chapter.title, input.query)}</span>
                <span>{formatChapterMeta(chapter.wordCount)}</span>
              </button>
              <div className="ns-navigator-item-meta">
                <span>{chapter.status}</span>
                {input.projectWorkflow?.dirtyChapterIds?.includes(chapter.id) === true ? (
                  <span>未保存</span>
                ) : null}
                <span>{chapter.updatedAt}</span>
              </div>
              {renderChapterMoreMenu({
                chapterId: chapter.id,
                title: chapter.title,
                workflow: input.projectWorkflow,
                onRenameChapter: input.onRenameChapter,
                onDuplicateChapter: input.onDuplicateChapter,
                onDeleteChapter: input.onDeleteChapter
              })}
            </div>
          </li>
        )) ?? []
    );
  }

  const storyBibleKind = storyBibleKindByNavigatorSection.get(input.sectionId);
  if (storyBibleKind !== undefined) {
    return (
      input.storyBibleEditor?.entries
        .filter((entry) => entry.kind === storyBibleKind)
        .filter((entry) => matchesQuery(input.query, [entry.title, entry.status, entry.body]))
        .map((entry) => (
          <li key={entry.id}>
            <button
              className="ns-navigator-asset-button"
              onClick={() => {
                input.onActivitySelect?.(input.sectionId === "timeline" ? "timeline" : "storyBible");
                input.storyBibleEditor?.onKindSelect(entry.kind);
                input.storyBibleEditor?.onEntrySelect(entry.id);
              }}
              type="button"
            >
              <span>{highlightText(entry.title, input.query)}</span>
              <span>{entry.status}</span>
            </button>
          </li>
        )) ?? []
    );
  }

  const studioAssetType = studioAssetTypeByNavigatorSection.get(input.sectionId);
  if (studioAssetType !== undefined) {
    return (
      input.studio?.assets
        .filter((asset) => asset.assetType === studioAssetType)
        .map((asset) => (
          <li key={`${asset.assetType}:${asset.assetId}`}>
            <button
              className="ns-navigator-asset-button"
              onClick={() => {
                input.onActivitySelect?.("studio");
                input.studio?.onAssetSelect?.(asset.assetType, asset.assetId);
              }}
              type="button"
            >
              <span>{highlightText(asset.title, input.query)}</span>
              <span>{asset.assetType}</span>
            </button>
          </li>
        )) ?? []
    );
  }

  return [];
}

function renderChapterMoreMenu({
  chapterId,
  title,
  workflow,
  onRenameChapter,
  onDuplicateChapter,
  onDeleteChapter
}: {
  readonly chapterId: string;
  readonly title: string;
  readonly workflow: ProjectWorkflowProps | undefined;
  readonly onRenameChapter?: ProjectWorkflowProps["onRenameChapter"] | undefined;
  readonly onDuplicateChapter?: ProjectWorkflowProps["onDuplicateChapter"] | undefined;
  readonly onDeleteChapter?: ProjectWorkflowProps["onDeleteChapter"] | undefined;
}) {
  const renameChapter = onRenameChapter ?? workflow?.onRenameChapter;
  const duplicateChapter = onDuplicateChapter ?? workflow?.onDuplicateChapter;
  const deleteChapter = onDeleteChapter ?? workflow?.onDeleteChapter;

  return (
    <details className="ns-navigator-actions">
      <summary aria-label={`章节更多操作：${title}`} title={`章节更多操作：${title}`}>
        <MoreHorizontal aria-hidden="true" size={14} />
      </summary>
      <div className="ns-navigator-action-menu">
        <button
          aria-label={`重命名章节：${title}`}
          onClick={() => {
            const nextTitle = promptForChapterTitle(title);
            if (nextTitle !== undefined) {
              renameChapter?.(chapterId, nextTitle);
            }
          }}
          type="button"
        >
          重命名
        </button>
        <button
          aria-label={`复制章节：${title}`}
          onClick={() => duplicateChapter?.(chapterId)}
          type="button"
        >
          复制
        </button>
        <button
          aria-label={`确认删除章节：${title}`}
          onClick={() => {
            if (confirmChapterDelete(title)) {
              deleteChapter?.(chapterId);
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

function isProjectWorkflowBusy(projectWorkflow: ProjectWorkflowProps): boolean {
  return projectWorkflow.status === "opening" || projectWorkflow.status === "creating";
}

function toggleSection(
  expandedSectionIds: readonly string[],
  sectionId: string
): readonly string[] {
  if (expandedSectionIds.includes(sectionId)) {
    return expandedSectionIds.filter((id) => id !== sectionId);
  }

  return [...expandedSectionIds, sectionId];
}

function navigatorSectionSelected(sectionId: string, activeActivity: ActivityId): boolean {
  if (sectionId === "chapters") {
    return activeActivity === "workspace";
  }
  if (sectionId === "prompts" || sectionId === "agents" || sectionId === "workflows") {
    return activeActivity === "studio";
  }
  if (sectionId === "timeline") {
    return activeActivity === "timeline";
  }

  return activeActivity === "storyBible";
}

function matchesQuery(query: string, values: readonly string[]): boolean {
  if (query.length === 0) {
    return true;
  }

  return values.some((value) => value.toLocaleLowerCase().includes(query));
}

function highlightText(value: string, query: string): ReactNode {
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
  const prompt = (globalThis as { window?: { prompt?: Window["prompt"] } }).window?.prompt;
  const nextTitle = prompt?.("输入新的章节标题", currentTitle)?.trim();
  return nextTitle === undefined || nextTitle.length === 0 ? undefined : nextTitle;
}

function confirmChapterDelete(title: string): boolean {
  const confirm = (globalThis as { window?: { confirm?: Window["confirm"] } }).window?.confirm;
  return confirm?.(`确认删除章节“${title}”？章节文件会被标记为 deleted，不会物理移除。`) === true;
}
