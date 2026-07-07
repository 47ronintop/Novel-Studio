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
          expandedSectionIds: ["chapters", "characters", "prompts"]
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
    expect(html).toContain('<mark>开篇</mark>');
  });

  test("wires section collapse, search, chapter actions, and guarded delete", () => {
    const calls: string[] = [];
    (globalThis as { window?: unknown }).window = {
      prompt: () => "改名后的开篇",
      confirm: () => true
    };
    const tree = WorkspaceNavigator(
      createNavigatorProps({
        expandedSectionIds: ["chapters", "characters"],
        onSearchQueryChange: (query) => calls.push(`search:${query}`),
        onExpandedSectionIdsChange: (sectionIds) =>
          calls.push(`expanded:${sectionIds.join(",")}`),
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
      "expanded:chapters",
      "rename:ch_opening:改名后的开篇",
      "duplicate:ch_opening",
      "delete:ch_opening"
    ]);
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
    expandedSectionIds: ["chapters", "characters", "prompts"],
    searchQuery: "",
    projectWorkflow: {
      projectRootInput: "D:/Novel/VUI06",
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
      onProjectRootChange: () => undefined,
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
  if (!isValidElement(node)) {
    return undefined;
  }

  const element = node as ReactElement<NavigatorTestElementProps>;
  if (element.props["aria-label"] === ariaLabel) {
    return element;
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
