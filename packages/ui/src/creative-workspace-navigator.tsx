import type { CreativeNavigatorMode } from "@novel-studio/shared";
import {
  BookOpenText,
  Clock3,
  FilePlus2,
  FileText,
  FolderPlus,
  Globe2,
  Milestone,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  UserRound,
  type LucideIcon
} from "lucide-react";
import { useId, type KeyboardEvent, type MouseEvent } from "react";

import { ProjectFileTree, type ProjectFileTreeNode } from "./project-file-tree.js";
import type {
  CreativeProjectFilesNavigatorProps,
  CreativeWorkspaceNavigatorProps,
  StoryBibleEditorKind
} from "./workspace-shell-types.js";

const STORY_KINDS: readonly StoryBibleEditorKind[] = [
  "character",
  "world",
  "outline",
  "foreshadow",
  "timeline"
];

const SINGLETON_KINDS = new Set<StoryBibleEditorKind>(["outline", "timeline"]);

const CREATIVE_PROJECT_FILE_EXTENSIONS = new Set([
  ".md",
  ".txt",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".csv"
]);

const BLOCKED_CREATIVE_PROJECT_PATH_SEGMENTS = new Set([
  "project.json",
  "settings.json",
  "chapters",
  "characters",
  "world",
  "outline",
  "timeline",
  "foreshadows",
  "memories",
  "prompts",
  "agents",
  "workflow",
  "workflows",
  "plugins",
  "history",
  "cache",
  ".novel-studio",
  ".git",
  ".svn",
  ".hg",
  "node_modules",
  "dist",
  "release",
  "build",
  "out",
  "coverage",
  ".cache",
  "__pycache__"
]);

const WINDOWS_DEVICE_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9"
]);

const storyKindLabels: Readonly<Record<StoryBibleEditorKind, string>> = {
  character: "人物",
  world: "世界观",
  outline: "大纲",
  foreshadow: "伏笔",
  timeline: "时间线"
};

const storyKindIcons: Readonly<Record<StoryBibleEditorKind, LucideIcon>> = {
  character: UserRound,
  world: Globe2,
  outline: BookOpenText,
  foreshadow: Milestone,
  timeline: Clock3
};

export function CreativeWorkspaceNavigator(props: CreativeWorkspaceNavigatorProps) {
  const instanceId = useId().replaceAll(":", "");
  const writingTabId = `${instanceId}-creative-writing-tab`;
  const storyTabId = `${instanceId}-creative-story-tab`;
  const filesTabId = `${instanceId}-creative-files-tab`;
  const writingPanelId = `${instanceId}-creative-writing-panel`;
  const storyPanelId = `${instanceId}-creative-story-panel`;
  const filesPanelId = `${instanceId}-creative-files-panel`;

  return (
    <nav
      aria-label="项目导航"
      className="ns-navigator ns-creative-navigator"
      data-region="navigator"
    >
      <div className="ns-panel-header">
        <span className="ns-creative-project-title" title={props.projectTitle}>
          {props.projectTitle}
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
        <button
          aria-controls={filesPanelId}
          aria-selected={props.mode === "files"}
          className="ns-creative-mode-tab"
          data-creative-mode="files"
          id={filesTabId}
          onClick={() => props.onModeSelect("files")}
          onKeyDown={(event) => handleModeTabKeyDown(event, "files", props.onModeSelect)}
          role="tab"
          tabIndex={props.mode === "files" ? 0 : -1}
          type="button"
        >
          项目文件
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
      <section
        aria-labelledby={filesTabId}
        className="ns-creative-panel"
        hidden={props.mode !== "files"}
        id={filesPanelId}
        role="tabpanel"
      >
        {props.mode === "files" ? <ProjectFilesProjection {...props} /> : null}
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
      [entry.title, entry.status, entry.summary].some((value) =>
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

function ProjectFilesProjection(props: CreativeWorkspaceNavigatorProps) {
  const files = props.projectFiles;
  if (files === undefined || files.loading === true) {
    return (
      <div className="ns-creative-empty" role="status">
        正在加载项目文件…
      </div>
    );
  }

  if (files.errorMessage !== undefined) {
    return (
      <div className="ns-creative-empty" role="alert">
        <span>{safeProjectFileFeedback(files.errorMessage)}</span>
        <button
          aria-label="重新加载项目文件"
          className="ns-icon-text-button"
          onClick={files.onRefresh}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={14} />
          重试
        </button>
      </div>
    );
  }

  const visibleNodes = filterProjectFileTreeNodes(files.nodes, "");
  const normalizedQuery = normalizeQuery(props.searchQuery);
  const filteredNodes = filterProjectFileTreeNodes(visibleNodes, normalizedQuery);
  const knownNodes = collectProjectFileNodes(visibleNodes);
  const knownNodePaths = new Set(knownNodes.map((node) => node.path));
  const knownFilePaths = new Set(
    knownNodes.filter((node) => node.kind === "file").map((node) => node.path)
  );
  const activeFilePath =
    files.activeFilePath !== undefined && knownFilePaths.has(files.activeFilePath)
      ? files.activeFilePath
      : undefined;
  const expandedPathIds =
    normalizedQuery.length === 0
      ? files.expandedPathIds
      : Array.from(
          new Set([...files.expandedPathIds, ...collectExpandedDirectoryPathIds(filteredNodes)])
        );
  const fileCount = knownNodes.filter((node) => node.kind === "file").length;

  return (
    <>
      <NavigatorSearch
        ariaLabel="筛选项目文件"
        onChange={props.onSearchQueryChange}
        placeholder="筛选项目文件"
        value={props.searchQuery}
      />
      <div className="ns-creative-section-header">
        <span>项目文件 {fileCount}</span>
        <div className="ns-navigator-header-actions">
          <button
            aria-label="刷新项目文件"
            className="ns-icon-button"
            onClick={files.onRefresh}
            title="刷新项目文件"
            type="button"
          >
            <RefreshCw aria-hidden="true" size={14} />
          </button>
          <button
            aria-label="新建项目文件"
            className="ns-icon-button"
            onClick={() => createProjectTextFile(files)}
            title="新建项目文件"
            type="button"
          >
            <FilePlus2 aria-hidden="true" size={14} />
          </button>
          <button
            aria-label="新建项目目录"
            className="ns-icon-button"
            onClick={() => createProjectDirectory(files)}
            title="新建项目目录"
            type="button"
          >
            <FolderPlus aria-hidden="true" size={14} />
          </button>
          <details className="ns-navigator-actions" data-project-file-actions="true">
            <summary aria-label="项目文件更多操作" title="项目文件更多操作">
              <MoreHorizontal aria-hidden="true" size={14} />
            </summary>
            <div className="ns-navigator-action-menu">
              <button
                disabled={knownNodePaths.size === 0}
                onClick={() => renameProjectPath(files, activeFilePath, knownNodes)}
                type="button"
              >
                重命名
              </button>
              <button
                disabled={knownNodePaths.size === 0}
                onClick={() => deleteProjectPath(files, activeFilePath, knownNodePaths)}
                type="button"
              >
                <Trash2 aria-hidden="true" size={13} />
                删除
              </button>
            </div>
          </details>
        </div>
      </div>
      {files.truncated === true ? (
        <p className="ns-engineering-truncated">项目文件列表已截断，请缩小目录范围</p>
      ) : null}
      {filteredNodes.length === 0 ? (
        <div className="ns-creative-empty">
          <span>{normalizedQuery.length === 0 ? "还没有项目文件" : "未找到匹配项目文件"}</span>
          {normalizedQuery.length === 0 ? (
            <button
              className="ns-icon-text-button"
              onClick={() => createProjectTextFile(files)}
              type="button"
            >
              <Plus aria-hidden="true" size={14} />
              新建文件
            </button>
          ) : (
            <button
              aria-label="清除项目文件筛选"
              className="ns-icon-text-button"
              onClick={() => props.onSearchQueryChange("")}
              type="button"
            >
              清除筛选
            </button>
          )}
        </div>
      ) : (
        <ProjectFileTree
          {...(activeFilePath === undefined ? {} : { activeFilePath })}
          ariaLabel="项目文件列表"
          expandedPathIds={expandedPathIds}
          nodes={filteredNodes}
          onExpandedPathIdsChange={files.onExpandedPathIdsChange}
          onFileOpen={(path) => {
            if (knownFilePaths.has(path)) files.onFileOpen(path);
          }}
        />
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
  const modes: readonly CreativeNavigatorMode[] = ["writing", "story", "files"];
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

function createProjectTextFile(files: CreativeProjectFilesNavigatorProps): void {
  const path = promptForCreativeProjectPath("输入项目内新文件路径", "notes/untitled.md", "file");
  if (path !== undefined) files.onCreateTextFile(path);
}

function createProjectDirectory(files: CreativeProjectFilesNavigatorProps): void {
  const path = promptForCreativeProjectPath("输入项目内新目录路径", "notes", "directory");
  if (path !== undefined) files.onCreateDirectory(path);
}

function renameProjectPath(
  files: CreativeProjectFilesNavigatorProps,
  activeFilePath: string | undefined,
  knownNodes: readonly ProjectFileTreeNode[]
): void {
  const knownByPath = new Map(knownNodes.map((node) => [node.path, node]));
  const sourcePath = promptForKnownCreativeProjectPath(
    "输入要重命名的项目路径",
    activeFilePath,
    knownByPath
  );
  if (sourcePath === undefined) return;
  const source = knownByPath.get(sourcePath);
  if (source === undefined) return;
  const targetPath = promptForCreativeProjectPath("输入新的项目内路径", sourcePath, source.kind);
  if (targetPath !== undefined && targetPath !== sourcePath) {
    files.onRenamePath(sourcePath, targetPath);
  }
}

function deleteProjectPath(
  files: CreativeProjectFilesNavigatorProps,
  activeFilePath: string | undefined,
  knownNodePaths: ReadonlySet<string>
): void {
  const path = promptForKnownCreativeProjectPath(
    "输入要删除的项目路径",
    activeFilePath,
    knownNodePaths
  );
  if (
    path !== undefined &&
    globalThis.window?.confirm(`确认删除项目文件“${path}”？此操作无法撤销。`) === true
  ) {
    files.onDeletePath(path);
  }
}

function promptForKnownCreativeProjectPath(
  message: string,
  initialValue: string | undefined,
  known: ReadonlySet<string> | ReadonlyMap<string, ProjectFileTreeNode>
): string | undefined {
  const path = normalizeCreativeProjectPath(
    globalThis.window?.prompt(message, initialValue ?? "")?.trim()
  );
  return path !== undefined && known.has(path) ? path : undefined;
}

function promptForCreativeProjectPath(
  message: string,
  initialValue: string,
  kind: ProjectFileTreeNode["kind"]
): string | undefined {
  const path = normalizeCreativeProjectPath(
    globalThis.window?.prompt(message, initialValue)?.trim()
  );
  return path !== undefined && isAllowedCreativeProjectPath(path, kind) ? path : undefined;
}

function filterProjectFileTreeNodes(
  nodes: readonly ProjectFileTreeNode[],
  query: string
): readonly ProjectFileTreeNode[] {
  const normalizedQuery = normalizeQuery(query);
  const visibleNodes: ProjectFileTreeNode[] = [];
  for (const node of nodes) {
    if (!isVisibleCreativeProjectNode(node)) continue;
    const children =
      node.kind === "directory"
        ? filterProjectFileTreeNodes(node.children ?? [], normalizedQuery)
        : undefined;
    const matchesQuery =
      normalizedQuery.length === 0 ||
      node.name.toLocaleLowerCase().includes(normalizedQuery) ||
      node.path.toLocaleLowerCase().includes(normalizedQuery);
    if (node.kind === "directory") {
      if (!matchesQuery && (children === undefined || children.length === 0)) continue;
      visibleNodes.push({
        id: node.id,
        name: node.name,
        path: node.path,
        kind: "directory",
        children: children ?? []
      });
      continue;
    }
    if (!matchesQuery) continue;
    visibleNodes.push({
      id: node.id,
      name: node.name,
      path: node.path,
      kind: "file"
    });
  }
  return visibleNodes;
}

function isVisibleCreativeProjectNode(node: ProjectFileTreeNode): boolean {
  const path = normalizeCreativeProjectPath(node.path);
  if (path === undefined || path !== node.path || node.readOnlyReason !== undefined) return false;
  const segments = path.split("/");
  return node.name === segments.at(-1) && isAllowedCreativeProjectPath(path, node.kind);
}

function isAllowedCreativeProjectPath(path: string, kind: ProjectFileTreeNode["kind"]): boolean {
  const segments = path.split("/");
  if (segments.some((segment) => isBlockedCreativeProjectSegment(segment))) return false;
  if (kind === "directory") return true;
  const fileName = segments.at(-1);
  return fileName !== undefined && CREATIVE_PROJECT_FILE_EXTENSIONS.has(fileExtension(fileName));
}

function normalizeCreativeProjectPath(path: string | undefined): string | undefined {
  if (path === undefined || path.length === 0 || path.includes("\\")) return undefined;
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path) || path.includes("//")) return undefined;
  const segments = path.split("/");
  return segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
    ? undefined
    : path;
}

function isBlockedCreativeProjectSegment(segment: string): boolean {
  const normalized = segment.toLocaleLowerCase();
  return (
    BLOCKED_CREATIVE_PROJECT_PATH_SEGMENTS.has(normalized) ||
    WINDOWS_DEVICE_NAMES.has(normalized.split(".")[0] ?? normalized)
  );
}

function fileExtension(fileName: string): string {
  const index = fileName.lastIndexOf(".");
  return index <= 0 ? "" : fileName.slice(index).toLocaleLowerCase();
}

function collectProjectFileNodes(
  nodes: readonly ProjectFileTreeNode[]
): readonly ProjectFileTreeNode[] {
  return nodes.flatMap((node) => [node, ...collectProjectFileNodes(node.children ?? [])]);
}

function collectExpandedDirectoryPathIds(nodes: readonly ProjectFileTreeNode[]): readonly string[] {
  return nodes.flatMap((node) => {
    const childIds = collectExpandedDirectoryPathIds(node.children ?? []);
    return node.kind === "directory" ? [`folder:${node.path}`, ...childIds] : childIds;
  });
}

function safeProjectFileFeedback(message: string): string {
  const normalized = message.toLocaleLowerCase();
  return [...BLOCKED_CREATIVE_PROJECT_PATH_SEGMENTS].some((segment) =>
    normalized.includes(segment)
  ) ||
    normalized.includes("../") ||
    normalized.includes("\\")
    ? "项目文件请求被安全策略拒绝。"
    : message;
}
