import type { ActivityId, NavigatorSection } from "@novel-studio/application";
import type { WorkspaceContextDto } from "@novel-studio/shared";
import {
  Bot,
  Brain,
  ChevronRight,
  Clock3,
  FilePlus,
  FileText,
  FolderOpen,
  FolderPlus,
  Globe2,
  ListTree,
  MessageSquareText,
  MoreHorizontal,
  Search,
  UserRound,
  Workflow as WorkflowIcon,
  type LucideIcon
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

import type { ConfigStudioAssetType, ConfigStudioPanelProps } from "./config-studio-panel.js";
import { CreativeWorkspaceNavigator } from "./creative-workspace-navigator.js";
import type {
  CreativeWorkspaceNavigatorProps,
  ProjectFileTreeItemProps,
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

export interface EngineeringWorkspaceNavigatorProps {
  readonly activeActivity: ActivityId;
  readonly sections: readonly NavigatorSection[];
  readonly expandedSectionIds?: readonly string[] | undefined;
  readonly searchQuery?: string | undefined;
  readonly projectWorkflow?: ProjectWorkflowProps | undefined;
  readonly fileTree?: readonly ProjectFileTreeItemProps[] | undefined;
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

export interface EmptyWorkspaceNavigatorProps {
  readonly onOpenProject?: (() => void) | undefined;
  readonly onCreateProject?: (() => void) | undefined;
}

export interface WorkspaceNavigatorProps {
  readonly workspaceContext: WorkspaceContextDto;
  readonly creative?: CreativeWorkspaceNavigatorProps | undefined;
  readonly engineering?: EngineeringWorkspaceNavigatorProps | undefined;
  readonly none: EmptyWorkspaceNavigatorProps;
  readonly collapsed?: boolean | undefined;
  readonly focusHidden?: boolean | undefined;
}

export function WorkspaceNavigator({
  workspaceContext,
  creative,
  engineering,
  none,
  collapsed = false,
  focusHidden = false
}: WorkspaceNavigatorProps) {
  if (workspaceContext.kind === "creativeProject") {
    if (creative === undefined) {
      return (
        <UnavailableWorkspaceNavigator
          collapsed={collapsed}
          focusHidden={focusHidden}
          message="正在加载创作导航"
        />
      );
    }

    return (
      <div
        className="ns-navigator-context"
        data-collapsed={collapsed}
        data-focus-hidden={focusHidden}
      >
        <CreativeWorkspaceNavigator {...creative} />
      </div>
    );
  }

  if (workspaceContext.kind === "engineeringWorkspace") {
    if (engineering === undefined) {
      return (
        <UnavailableWorkspaceNavigator
          collapsed={collapsed}
          focusHidden={focusHidden}
          message="正在加载工程导航"
        />
      );
    }

    return (
      <LegacyEngineeringWorkspaceNavigator
        {...engineering}
        collapsed={collapsed}
        focusHidden={focusHidden}
      />
    );
  }

  return (
    <nav
      aria-label="工作区导航"
      className="ns-navigator ns-empty-workspace-navigator"
      data-collapsed={collapsed}
      data-focus-hidden={focusHidden}
      data-region="navigator"
    >
      <div className="ns-panel-header">
        <span>工作区</span>
      </div>
      <div className="ns-empty-workspace-actions">
        <p>尚未打开工作区</p>
        <button
          aria-label="打开项目"
          className="ns-icon-text-button"
          disabled={none.onOpenProject === undefined}
          onClick={none.onOpenProject}
          type="button"
        >
          <FolderOpen aria-hidden="true" size={14} />
          打开项目
        </button>
        <button
          aria-label="创建项目"
          className="ns-icon-text-button"
          disabled={none.onCreateProject === undefined}
          onClick={none.onCreateProject}
          type="button"
        >
          <FolderPlus aria-hidden="true" size={14} />
          创建项目
        </button>
      </div>
    </nav>
  );
}

function UnavailableWorkspaceNavigator({
  collapsed,
  focusHidden,
  message
}: {
  readonly collapsed: boolean;
  readonly focusHidden: boolean;
  readonly message: string;
}) {
  return (
    <nav
      aria-label="工作区导航"
      className="ns-navigator ns-empty-workspace-navigator"
      data-collapsed={collapsed}
      data-focus-hidden={focusHidden}
      data-region="navigator"
    >
      <div className="ns-panel-header">
        <span>工作区</span>
      </div>
      <div className="ns-empty-workspace-actions">
        <p>{message}</p>
      </div>
    </nav>
  );
}

function LegacyEngineeringWorkspaceNavigator({
  activeActivity,
  sections,
  expandedSectionIds = ["novel-studio", ...sections.map((section) => section.id)],
  searchQuery = "",
  projectWorkflow,
  fileTree,
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
}: EngineeringWorkspaceNavigatorProps) {
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  const expanded = new Set(expandedSectionIds);
  const novelStudioExpanded = expanded.has("novel-studio");

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
      {projectWorkflow === undefined ? null : (
        <ProjectWorkflowControls projectWorkflow={projectWorkflow} />
      )}
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
        {fileTree === undefined || fileTree.length === 0 ? null : (
          <li>
            <section
              aria-label="Files"
              className="ns-tree-group"
              data-expanded={expanded.has("files")}
              data-navigator-group="files"
            >
              <button
                aria-expanded={expanded.has("files")}
                aria-label="Toggle file tree"
                className="ns-tree-row"
                onClick={() =>
                  onExpandedSectionIdsChange?.(toggleSection(expandedSectionIds, "files"))
                }
                type="button"
              >
                <ChevronRight
                  aria-hidden="true"
                  className="ns-tree-chevron"
                  data-navigator-chevron={expanded.has("files") ? "expanded" : "collapsed"}
                  size={14}
                />
                <FolderOpen
                  aria-hidden="true"
                  className="ns-tree-type-icon"
                  data-navigator-type-icon="files"
                  size={14}
                />
                <span className="ns-tree-row-label">文件</span>
                <span className="ns-tree-row-count">{fileTree.length}</span>
              </button>
              {expanded.has("files") ? (
                <ul className="ns-navigator-item-list">
                  {fileTree.flatMap((item) =>
                    renderFileTreeItem(item, {
                      expandedSectionIds,
                      expanded,
                      onExpandedSectionIdsChange,
                      onOpenFile: projectWorkflow?.onOpenFile,
                      query: normalizedQuery,
                      depth: 0
                    })
                  )}
                </ul>
              ) : null}
            </section>
          </li>
        )}
        <li>
          <section
            aria-label="Novel Studio asset groups"
            className="ns-tree-group"
            data-expanded={novelStudioExpanded}
            data-navigator-group="novel-studio"
          >
            <button
              aria-expanded={novelStudioExpanded}
              aria-label="Toggle Novel Studio asset groups"
              className="ns-tree-row"
              onClick={() =>
                onExpandedSectionIdsChange?.(toggleSection(expandedSectionIds, "novel-studio"))
              }
              type="button"
            >
              <ChevronRight
                aria-hidden="true"
                className="ns-tree-chevron"
                data-navigator-chevron={novelStudioExpanded ? "expanded" : "collapsed"}
                size={14}
              />
              <ListTree
                aria-hidden="true"
                className="ns-tree-type-icon"
                data-navigator-type-icon="novel-studio"
                size={14}
              />
              <span className="ns-tree-row-label">Novel Studio</span>
              <span className="ns-tree-row-count">{sections.length}</span>
            </button>
          </section>
        </li>
        {novelStudioExpanded
          ? sections.map((section) => {
              const label = navigatorSectionLabels.get(section.id) ?? section.title;
              const SectionIcon = navigatorSectionIcon(section.id);
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
                      <ChevronRight
                        aria-hidden="true"
                        className="ns-tree-chevron"
                        data-navigator-chevron={isExpanded ? "expanded" : "collapsed"}
                        size={14}
                      />
                      <SectionIcon
                        aria-hidden="true"
                        className="ns-tree-type-icon"
                        data-navigator-type-icon={`section:${section.id}`}
                        size={14}
                      />
                      <span className="ns-tree-row-label">{label}</span>
                      <span className="ns-tree-row-count">{items.length}</span>
                    </button>
                    {isExpanded ? <ul className="ns-navigator-item-list">{items}</ul> : null}
                  </section>
                </li>
              );
            })
          : null}
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
        aria-label="项目标题"
        className="ns-project-path"
        onChange={(event) => projectWorkflow.onProjectTitleChange?.(event.currentTarget.value)}
        placeholder="项目标题"
        value={projectWorkflow.projectTitleInput ?? ""}
      />
      <input
        aria-label="项目文件夹名称"
        className="ns-project-path"
        onChange={(event) => projectWorkflow.onProjectFolderNameChange?.(event.currentTarget.value)}
        placeholder="文件夹名称"
        value={projectWorkflow.projectFolderNameInput ?? ""}
      />
      <div className="ns-project-actions">
        <button
          aria-label="选择项目父文件夹"
          className="ns-icon-text-button"
          disabled={isProjectWorkflowBusy(projectWorkflow)}
          onClick={projectWorkflow.onChooseCreateParentDirectory}
          title="选择父文件夹"
          type="button"
        >
          <FolderOpen aria-hidden="true" size={14} />
          {projectWorkflow.selectedParentDisplayName ?? "选择父文件夹"}
        </button>
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
      {projectWorkflow.creationPreview === undefined ? null : (
        <p className="ns-project-feedback" role="status">
          {projectWorkflow.creationPreview.parentDisplayName} /{" "}
          {projectWorkflow.creationPreview.targetDisplayName}
        </p>
      )}
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
                <span className="ns-navigator-item-label">
                  <FileText
                    aria-hidden="true"
                    className="ns-navigator-type-icon"
                    data-navigator-type-icon="chapter"
                    size={14}
                  />
                  <span>{highlightText(chapter.title, input.query)}</span>
                </span>
                <span className="ns-navigator-item-count">
                  {formatChapterMeta(chapter.wordCount)}
                </span>
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
        .map((entry) => {
          const EntryIcon = navigatorStoryBibleIcon(entry.kind);
          return (
            <li key={entry.id}>
              <button
                className="ns-navigator-asset-button"
                onClick={() => {
                  input.onActivitySelect?.(
                    input.sectionId === "timeline" ? "timeline" : "storyBible"
                  );
                  input.storyBibleEditor?.onKindSelect(entry.kind);
                  input.storyBibleEditor?.onEntrySelect(entry.id);
                }}
                type="button"
              >
                <span className="ns-navigator-item-label">
                  <EntryIcon
                    aria-hidden="true"
                    className="ns-navigator-type-icon"
                    data-navigator-type-icon={`story:${entry.kind}`}
                    size={14}
                  />
                  <span>{highlightText(entry.title, input.query)}</span>
                </span>
                <span className="ns-navigator-item-count">{entry.status}</span>
              </button>
            </li>
          );
        }) ?? []
    );
  }

  const studioAssetType = studioAssetTypeByNavigatorSection.get(input.sectionId);
  if (studioAssetType !== undefined) {
    return (
      input.studio?.assets
        .filter((asset) => asset.assetType === studioAssetType)
        .map((asset) => {
          const AssetIcon = navigatorStudioAssetIcon(asset.assetType);
          return (
            <li key={`${asset.assetType}:${asset.assetId}`}>
              <button
                className="ns-navigator-asset-button"
                onClick={() => {
                  input.onActivitySelect?.("studio");
                  input.studio?.onAssetSelect?.(asset.assetType, asset.assetId);
                }}
                type="button"
              >
                <span className="ns-navigator-item-label">
                  <AssetIcon
                    aria-hidden="true"
                    className="ns-navigator-type-icon"
                    data-navigator-type-icon={`asset:${asset.assetType}`}
                    size={14}
                  />
                  <span>{highlightText(asset.title, input.query)}</span>
                </span>
                <span className="ns-navigator-item-count">{asset.assetType}</span>
              </button>
            </li>
          );
        }) ?? []
    );
  }

  return [];
}

function renderFileTreeItem(
  item: ProjectFileTreeItemProps,
  input: {
    readonly expandedSectionIds: readonly string[];
    readonly expanded: ReadonlySet<string>;
    readonly onExpandedSectionIdsChange?: ((sectionIds: readonly string[]) => void) | undefined;
    readonly onOpenFile?: ((path: string) => void) | undefined;
    readonly query: string;
    readonly depth: number;
  }
): ReactNode[] {
  if (!matchesQuery(input.query, [item.name, item.path])) {
    return [];
  }

  const isDirectory = item.kind === "directory";
  const isExpanded = input.expanded.has(item.id);
  const children = item.children ?? [];

  return [
    <li key={item.id}>
      <div
        className="ns-navigator-file-item"
        data-navigator-file-kind={item.kind}
        style={
          { "--ns-tree-depth": input.depth } as CSSProperties & Record<"--ns-tree-depth", number>
        }
      >
        <button
          aria-expanded={isDirectory ? isExpanded : undefined}
          aria-label={isDirectory ? `Toggle folder ${item.name}` : `Open file ${item.name}`}
          className="ns-navigator-asset-button"
          onClick={() => {
            if (isDirectory) {
              input.onExpandedSectionIdsChange?.(toggleSection(input.expandedSectionIds, item.id));
              return;
            }
            input.onOpenFile?.(item.path);
          }}
          type="button"
        >
          <span className="ns-navigator-item-label">
            {isDirectory ? (
              <ChevronRight
                aria-hidden="true"
                className="ns-tree-chevron"
                data-navigator-chevron={isExpanded ? "expanded" : "collapsed"}
                size={14}
              />
            ) : (
              <span aria-hidden="true" className="ns-file-chevron-spacer" />
            )}
            {isDirectory ? (
              <FolderOpen
                aria-hidden="true"
                className="ns-navigator-type-icon"
                data-navigator-type-icon="file:directory"
                size={14}
              />
            ) : (
              <FileText
                aria-hidden="true"
                className="ns-navigator-type-icon"
                data-navigator-type-icon="file:file"
                size={14}
              />
            )}
            <span>{highlightText(item.name, input.query)}</span>
          </span>
          <span className="ns-navigator-item-count">{isDirectory ? children.length : ""}</span>
        </button>
      </div>
      {isDirectory && isExpanded ? (
        <ul className="ns-navigator-item-list">
          {children.flatMap((child) =>
            renderFileTreeItem(child, {
              ...input,
              depth: input.depth + 1
            })
          )}
        </ul>
      ) : null}
    </li>
  ];
}

function navigatorSectionIcon(sectionId: string): LucideIcon {
  switch (sectionId) {
    case "chapters":
      return FileText;
    case "characters":
      return UserRound;
    case "world":
      return Globe2;
    case "outline":
      return ListTree;
    case "timeline":
      return Clock3;
    case "memories":
      return Brain;
    case "prompts":
      return MessageSquareText;
    case "agents":
      return Bot;
    case "workflows":
      return WorkflowIcon;
    default:
      return FileText;
  }
}

function navigatorStoryBibleIcon(kind: StoryBibleEditorKind): LucideIcon {
  switch (kind) {
    case "character":
      return UserRound;
    case "world":
      return Globe2;
    case "outline":
      return ListTree;
    case "timeline":
      return Clock3;
    case "memory":
      return Brain;
    default:
      return FileText;
  }
}

function navigatorStudioAssetIcon(type: ConfigStudioAssetType): LucideIcon {
  switch (type) {
    case "prompt":
      return MessageSquareText;
    case "agent":
      return Bot;
    case "workflow":
      return WorkflowIcon;
    default:
      return FileText;
  }
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
