import { renderToStaticMarkup } from "react-dom/server";
import { isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, describe, expect, test } from "vitest";

import { WorkspaceNavigator } from "../src/workspace-navigator.js";
import type { WorkspaceNavigatorProps } from "../src/workspace-navigator.js";

describe("WorkspaceNavigator", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  test("renders a searchable project asset tree with chapter and asset metadata", () => {
    const html = renderToStaticMarkup(
      <WorkspaceNavigator
        {...createNavigatorProps({
          searchQuery: "开篇",
          expandedSectionIds: ["novel-studio", "chapters", "characters", "prompts"]
        })}
      />
    );

    expect(html).toContain('aria-label="项目导航"');
    expect(html).toContain('aria-label="筛选项目资产"');
    expect(html).toContain('aria-label="章节 分组"');
    expect(html).toContain("开篇");
    expect(html).toContain("1,234 字");
    expect(html).toContain("未保存");
    expect(html).toContain("draft");
    expect(html).not.toContain("第二章");
    expect(html).toContain("林照月");
    expect(html).toContain("主角");
    expect(html).toContain("续写章节");
    expect(html).toContain("prompt");
    expect(html).toContain("<mark>开篇</mark>");
    expect(html).toContain("ns-tree-chevron");
    expect(html).toContain('data-navigator-chevron="expanded"');
    expect(html).toContain('data-navigator-type-icon="section:chapters"');
    expect(html).toContain('data-navigator-type-icon="chapter"');
    expect(html).toContain('data-navigator-type-icon="story:character"');
    expect(html).toContain('data-navigator-type-icon="asset:prompt"');
    expect(html).toContain('data-active="true"');
  });

  test("renders engineering workspace files before collapsible Novel Studio asset groups", () => {
    const html = renderToStaticMarkup(
      <WorkspaceNavigator
        {...createNavigatorProps({
          fileTree: [
            {
              id: "folder:docs",
              name: "docs",
              kind: "directory",
              path: "docs",
              children: [
                {
                  id: "file:docs/INDEX.md",
                  name: "INDEX.md",
                  kind: "file",
                  path: "docs/INDEX.md"
                }
              ]
            },
            {
              id: "file:project.json",
              name: "project.json",
              kind: "file",
              path: "project.json"
            }
          ],
          expandedSectionIds: ["files", "folder:docs", "novel-studio", "chapters"]
        })}
      />
    );

    const filesIndex = html.indexOf('data-navigator-group="files"');
    const assetsIndex = html.indexOf('data-navigator-group="novel-studio"');

    expect(filesIndex).toBeGreaterThan(-1);
    expect(assetsIndex).toBeGreaterThan(filesIndex);
    expect(html).toContain("docs");
    expect(html).toContain("INDEX.md");
    expect(html).toContain("project.json");
    expect(html).toContain('data-navigator-file-kind="directory"');
    expect(html).toContain('data-navigator-file-kind="file"');
    expect(html).toContain('aria-label="Novel Studio asset groups"');
  });

  test("opens file rows and keeps folder rows as expand/collapse controls", () => {
    const calls: string[] = [];
    const baseProjectWorkflow = createNavigatorProps().projectWorkflow;
    if (baseProjectWorkflow === undefined) {
      throw new Error("Expected default project workflow props.");
    }
    const tree = WorkspaceNavigator(
      createNavigatorProps({
        fileTree: [
          {
            id: "folder:docs",
            name: "docs",
            kind: "directory",
            path: "docs",
            children: [
              {
                id: "file:docs/INDEX.md",
                name: "INDEX.md",
                kind: "file",
                path: "docs/INDEX.md"
              }
            ]
          }
        ],
        expandedSectionIds: ["files", "folder:docs", "novel-studio"],
        onExpandedSectionIdsChange: (sectionIds) => calls.push(`expanded:${sectionIds.join(",")}`),
        projectWorkflow: {
          ...baseProjectWorkflow,
          onOpenFile: (path) => calls.push(`open:${path}`)
        }
      })
    );

    findElementByAriaLabel(tree, "Toggle folder docs")?.props.onClick?.();
    findElementByAriaLabel(tree, "Open file INDEX.md")?.props.onClick?.();

    expect(calls).toEqual([
      "expanded:files,novel-studio",
      "open:docs/INDEX.md"
    ]);
  });

  test("does not expose in-place project initialization for ordinary folders", () => {
    const tree = WorkspaceNavigator(createNavigatorProps());

    expect(findElementByAriaLabel(tree, "初始化为 Novel Studio 项目")).toBeUndefined();
  });

  test("wires section collapse, search, chapter actions, and guarded delete", () => {
    const calls: string[] = [];
    (globalThis as { window?: unknown }).window = {
      prompt: () => "改名后的开篇",
      confirm: () => true
    };
    const tree = WorkspaceNavigator(
      createNavigatorProps({
        expandedSectionIds: ["novel-studio", "chapters", "characters"],
        onSearchQueryChange: (query) => calls.push(`search:${query}`),
        onExpandedSectionIdsChange: (sectionIds) => calls.push(`expanded:${sectionIds.join(",")}`),
        onRenameChapter: (chapterId, title) => calls.push(`rename:${chapterId}:${title}`),
        onDuplicateChapter: (chapterId) => calls.push(`duplicate:${chapterId}`),
        onDeleteChapter: (chapterId) => calls.push(`delete:${chapterId}`)
      })
    );

    findElementByAriaLabel(tree, "筛选项目资产")?.props.onChange?.({
      currentTarget: { value: "角色" }
    });
    findElementByAriaLabel(tree, "切换导航分组：人物")?.props.onClick?.();
    findElementByAriaLabel(tree, "重命名章节：开篇")?.props.onClick?.();
    findElementByAriaLabel(tree, "复制章节：开篇")?.props.onClick?.();
    findElementByAriaLabel(tree, "确认删除章节：开篇")?.props.onClick?.();

    expect(calls).toEqual([
      "search:角色",
      "expanded:novel-studio,chapters",
      "rename:ch_opening:改名后的开篇",
      "duplicate:ch_opening",
      "delete:ch_opening"
    ]);
  });

  test("lets the Novel Studio parent collapse even when child groups remain expanded", () => {
    const collapsedHtml = renderToStaticMarkup(
      <WorkspaceNavigator
        {...createNavigatorProps({
          expandedSectionIds: ["chapters", "characters", "prompts"]
        })}
      />
    );

    expect(collapsedHtml).toContain('data-navigator-group="novel-studio"');
    expect(collapsedHtml).toContain('data-expanded="false"');
    expect(collapsedHtml).not.toContain('aria-label="章节 分组"');
    expect(collapsedHtml).not.toContain('aria-label="人物 分组"');

    const calls: string[] = [];
    const expandedTree = WorkspaceNavigator(
      createNavigatorProps({
        expandedSectionIds: ["novel-studio", "chapters", "characters"],
        onExpandedSectionIdsChange: (sectionIds) => calls.push(sectionIds.join(","))
      })
    );

    findElementByAriaLabel(expandedTree, "Toggle Novel Studio asset groups")?.props.onClick?.();

    expect(calls).toEqual(["chapters,characters"]);
  });
});

function createNavigatorProps(
  overrides: Partial<WorkspaceNavigatorProps> = {}
): WorkspaceNavigatorProps {
  return {
    activeActivity: "workspace",
    sections: [
      { id: "chapters", title: "章节", itemCount: 2 },
      { id: "characters", title: "人物", itemCount: 1 },
      { id: "prompts", title: "提示词", itemCount: 1 }
    ],
    expandedSectionIds: ["novel-studio", "chapters", "characters", "prompts"],
    searchQuery: "",
    fileTree: undefined,
    projectWorkflow: {
      projectTitleInput: "VUI06",
      projectFolderNameInput: "VUI06",
      chapters: [
        {
          id: "ch_opening",
          title: "开篇",
          order: 1,
          status: "draft",
          updatedAt: "2026-07-07T00:00:00.000Z",
          wordCount: 1234
        },
        {
          id: "ch_second",
          title: "第二章",
          order: 2,
          status: "draft",
          updatedAt: "2026-07-07T00:00:00.000Z"
        }
      ],
      activeChapterId: "ch_opening",
      dirtyChapterIds: ["ch_opening"],
      onProjectTitleChange: () => undefined,
      onProjectFolderNameChange: () => undefined,
      onOpenProject: () => undefined,
      onCreateProject: () => undefined,
      onCreateChapter: () => undefined,
      onSelectChapter: () => undefined,
      onRenameChapter: () => undefined,
      onDuplicateChapter: () => undefined,
      onDeleteChapter: () => undefined
    },
    storyBibleEditor: {
      activeKind: "character",
      status: "idle",
      entries: [
        {
          id: "char_linzhaoyue",
          kind: "character",
          title: "林照月",
          status: "主角",
          body: "开篇出现。"
        }
      ],
      draft: {
        kind: "character",
        title: "林照月",
        body: "开篇出现。",
        status: "主角"
      },
      onKindSelect: () => undefined,
      onEntrySelect: () => undefined,
      onDraftChange: () => undefined,
      onNewDraft: () => undefined,
      onSave: () => undefined
    },
    studio: {
      status: "idle",
      assets: [
        {
          assetType: "prompt",
          assetId: "prompt_continue",
          title: "续写章节"
        }
      ],
      selectedAsset: {
        assetType: "prompt",
        assetId: "prompt_continue",
        title: "续写章节",
        validationStatus: "valid",
        content: "{}"
      },
      versions: []
    },
    onSearchQueryChange: () => undefined,
    onExpandedSectionIdsChange: () => undefined,
    onActivitySelect: () => undefined,
    ...overrides
  };
}

function findElementByAriaLabel(
  node: ReactNode,
  ariaLabel: string
): ReactElement<NavigatorTestElementProps> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElementByAriaLabel(child, ariaLabel);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }

  if (!isValidElement(node)) {
    return undefined;
  }

  const element = node as ReactElement<NavigatorTestElementProps>;
  if (element.props["aria-label"] === ariaLabel) {
    return element;
  }

  if (typeof element.type === "function") {
    const renderComponent = element.type as (props: NavigatorTestElementProps) => ReactNode;
    const found = findElementByAriaLabel(renderComponent(element.props), ariaLabel);
    if (found !== undefined) {
      return found;
    }
  }

  const children = element.props.children as ReactNode;
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findElementByAriaLabel(child, ariaLabel);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }

  return findElementByAriaLabel(children, ariaLabel);
}

interface NavigatorTestElementProps {
  readonly [key: string]: unknown;
  readonly children?: ReactNode;
  readonly onChange?: (event: { readonly currentTarget: { readonly value: string } }) => void;
  readonly onClick?: () => void;
}
