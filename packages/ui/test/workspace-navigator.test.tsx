// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { CreativeWorkspaceNavigator } from "../src/creative-workspace-navigator.js";
import { EngineeringWorkspaceNavigator } from "../src/engineering-workspace-navigator.js";
import type {
  CreativeWorkspaceNavigatorProps,
  StoryBibleEditorProps
} from "../src/workspace-shell-types.js";
import { WorkspaceNavigator } from "../src/workspace-navigator.js";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("CreativeWorkspaceNavigator", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  test("renders exactly writing and story tabs without removed project-tree groups", () => {
    render(<CreativeWorkspaceNavigator {...createCreativeProps()} />);

    const tablist = requiredElement<HTMLElement>(
      host,
      '[role="tablist"][aria-label="创作导航模式"]'
    );
    const tabs = tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]');

    expect(tabs).toHaveLength(2);
    expect(tabs[0]?.textContent).toContain("写作");
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
    expect(tabs[1]?.textContent).toContain("故事资料");
    expect(host.textContent).not.toContain("Novel Studio");
    expect(host.textContent).not.toContain("提示词");
    expect(host.textContent).not.toContain("Agent");
    expect(host.textContent).not.toContain("工作流");
    expect(host.querySelector('[data-project-file-tree="true"]')).toBeNull();
  });

  test("shows real chapter count, active and dirty state, create action, and title filtering", () => {
    const calls: string[] = [];
    render(
      <CreativeWorkspaceNavigator
        {...createCreativeProps({
          searchQuery: "OPENING",
          onCreateChapter: () => calls.push("create")
        })}
      />
    );

    expect(host.textContent).toContain("章节 2");
    expect(host.textContent).toContain("Opening");
    expect(host.textContent).not.toContain("第二章");
    expect(host.textContent).toContain("1,234 字");
    expect(host.textContent).toContain("未保存");
    expect(
      requiredElement(host, '[data-chapter-id="ch_opening"]').getAttribute("data-active")
    ).toBe("true");
    click(requiredElement(host, 'button[aria-label="新建章节"]'));
    expect(calls).toEqual(["create"]);
  });

  test("distinguishes an empty project from an empty filtered result and clears the filter", () => {
    const calls: string[] = [];
    const emptyProjectProps = createCreativeProps({ chapters: [] });
    Reflect.deleteProperty(emptyProjectProps, "activeChapterId");
    render(<CreativeWorkspaceNavigator {...emptyProjectProps} />);
    expect(host.textContent).toContain("还没有章节");

    render(
      <CreativeWorkspaceNavigator
        {...createCreativeProps({
          searchQuery: "不存在",
          onSearchQueryChange: (query) => calls.push(query)
        })}
      />
    );
    expect(host.textContent).toContain("未找到匹配章节");
    click(requiredElement(host, 'button[aria-label="清除章节筛选"]'));
    expect(calls).toEqual([""]);
  });

  test("chapter menu actions do not open the chapter row", () => {
    const calls: string[] = [];
    vi.spyOn(window, "prompt").mockReturnValue("新的开篇");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <CreativeWorkspaceNavigator
        {...createCreativeProps({
          onChapterOpen: (id) => calls.push(`open:${id}`),
          onChapterRename: (id, title) => calls.push(`rename:${id}:${title}`),
          onChapterDuplicate: (id) => calls.push(`duplicate:${id}`),
          onChapterDelete: (id) => calls.push(`delete:${id}`)
        })}
      />
    );

    click(requiredElement(host, 'button[aria-label="重命名章节：Opening"]'));
    click(requiredElement(host, 'button[aria-label="复制章节：Opening"]'));
    click(requiredElement(host, 'button[aria-label="删除章节：Opening"]'));

    expect(calls).toEqual([
      "rename:ch_opening:新的开篇",
      "duplicate:ch_opening",
      "delete:ch_opening"
    ]);
  });

  test("shows story kinds in the required order with real counts and singleton create rules", () => {
    const storyBible = createStoryBible({ activeKind: "outline" });
    render(<CreativeWorkspaceNavigator {...createCreativeProps({ mode: "story", storyBible })} />);

    const kindButtons = Array.from(host.querySelectorAll<HTMLButtonElement>("[data-story-kind]"));
    expect(kindButtons.map((button) => button.dataset.storyKind)).toEqual([
      "character",
      "world",
      "outline",
      "timeline",
      "memory"
    ]);
    expect(
      kindButtons.map((button) => button.querySelector(".ns-creative-row-label")?.textContent)
    ).toEqual(["人物", "世界观", "大纲", "时间线", "记忆"]);
    expect(
      kindButtons.map((button) => button.querySelector(".ns-creative-row-count")?.textContent)
    ).toEqual(["1", "1", "1", "1", "1"]);
    expect(host.querySelector('button[aria-label="新建大纲"]')).toBeNull();

    const calls: string[] = [];
    render(
      <CreativeWorkspaceNavigator
        {...createCreativeProps({
          mode: "story",
          storyBible: createStoryBible({ activeKind: "character" }),
          onStoryEntryCreate: (kind) => calls.push(kind)
        })}
      />
    );
    click(requiredElement(host, 'button[aria-label="新建人物"]'));
    expect(calls).toEqual(["character"]);
  });

  test("filters only the active story kind and opens timeline_main as a story entry", () => {
    const calls: string[] = [];
    render(
      <CreativeWorkspaceNavigator
        {...createCreativeProps({
          mode: "story",
          searchQuery: "雨夜",
          storyBible: createStoryBible({ activeKind: "timeline" }),
          onStoryEntryOpen: (id) => calls.push(id)
        })}
      />
    );

    expect(host.textContent).toContain("主时间线");
    expect(host.textContent).not.toContain("林照月");
    click(requiredElement(host, 'button[data-story-entry-id="timeline_main"]'));
    expect(calls).toEqual(["timeline_main"]);
  });

  test("supports ArrowLeft ArrowRight Home End and unique tabpanel ids", () => {
    const calls: string[] = [];
    render(
      <>
        <CreativeWorkspaceNavigator
          {...createCreativeProps({ onModeSelect: (mode) => calls.push(mode) })}
        />
        <CreativeWorkspaceNavigator {...createCreativeProps({ projectTitle: "第二个项目" })} />
      </>
    );

    const tablists = host.querySelectorAll<HTMLElement>(
      '[role="tablist"][aria-label="创作导航模式"]'
    );
    const firstTabs = tablists[0]?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    if (firstTabs === undefined || firstTabs.length !== 2) {
      throw new Error("Expected two creative navigator tabs.");
    }
    const writingTab = firstTabs[0];
    const storyTab = firstTabs[1];
    if (writingTab === undefined || storyTab === undefined) {
      throw new Error("Expected writing and story tabs.");
    }

    writingTab.focus();
    keydown(writingTab, "ArrowRight");
    expect(calls).toEqual(["story"]);
    expect(document.activeElement).toBe(storyTab);

    keydown(storyTab, "Home");
    keydown(writingTab, "End");
    keydown(storyTab, "ArrowLeft");
    expect(calls).toEqual(["story", "writing", "story", "writing"]);

    const controls = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]')).map(
      (tab) => tab.getAttribute("aria-controls")
    );
    expect(new Set(controls).size).toBe(controls.length);
    controls.forEach((id) =>
      expect(id === null ? null : host.querySelector(`#${id}`)).not.toBeNull()
    );
  });

  function render(node: ReactNode): void {
    act(() => root.render(node));
  }
});

describe("WorkspaceNavigator", () => {
  test("renders a controlled bounded engineering tree without creative asset actions", () => {
    const html = renderToStaticMarkup(
      <EngineeringWorkspaceNavigator
        displayName="工程目录"
        tree={{
          nodes: [
            {
              id: "folder:src",
              name: "src",
              kind: "directory",
              path: "src",
              children: [
                {
                  id: "file:src/main.ts",
                  name: "main.ts",
                  kind: "file",
                  path: "src/main.ts",
                  readOnlyReason: "managed file"
                }
              ]
            },
            { id: "file:README.md", name: "README.md", kind: "file", path: "README.md" }
          ],
          truncated: true
        }}
        expandedPathIds={["folder:src"]}
        onExpandedPathIdsChange={() => undefined}
        onFileOpen={() => undefined}
        onRefresh={() => undefined}
      />
    );

    expect(html).toContain("工程目录");
    expect(html).toContain("列表已截断，请缩小目录范围");
    expect(html).toContain("managed file");
    expect(html).not.toContain("章节");
    expect(html).not.toContain("故事圣经");
    expect(html).not.toContain("搜索");
    expect(html).not.toContain("时间线");
    expect(html).not.toContain("创作系统");
  });

  test("switches by workspace context and never renders the legacy tree for creative projects", () => {
    const creativeHtml = renderWorkspaceNavigator({ kind: "creativeProject" });
    const engineeringHtml = renderWorkspaceNavigator({ kind: "engineeringWorkspace" });
    const noneHtml = renderWorkspaceNavigator({ kind: "none" });

    expect(creativeHtml).toContain("写作");
    expect(creativeHtml).not.toContain("Novel Studio");
    expect(creativeHtml).not.toContain('data-navigator-group="files"');
    expect(engineeringHtml).toContain('data-navigator-group="files"');
    expect(engineeringHtml).toContain("project.json");
    // Project lifecycle entry points belong to the native File menu and central dialog,
    // not inside the Navigator. These buttons must not appear in any Navigator variant.
    expect(noneHtml).not.toContain("打开项目");
    expect(noneHtml).not.toContain("创建项目");
    expect(noneHtml).not.toContain("打开工程目录");
    expect(noneHtml).not.toContain("Novel Studio");
  });

  test("creative Navigator has no persistent project-creation form or lifecycle buttons", () => {
    const creativeHtml = renderWorkspaceNavigator({ kind: "creativeProject" });

    expect(creativeHtml).not.toContain("打开项目");
    expect(creativeHtml).not.toContain("创建项目");
    expect(creativeHtml).not.toContain("打开工程目录");
    // No inline folder-name or title inputs for project creation
    expect(creativeHtml).not.toMatch(/input[^>]*placeholder[^>]*(项目名称|文件夹|folder)/i);
  });
});

function renderWorkspaceNavigator(context: {
  readonly kind: "creativeProject" | "engineeringWorkspace" | "none";
}): string {
  const workspaceContext =
    context.kind === "creativeProject"
      ? {
          kind: "creativeProject" as const,
          workspaceId: "workspace_1",
          projectId: "project_1",
          displayName: "长安旧梦",
          capabilities: ["creativeWorkbench" as const]
        }
      : context.kind === "engineeringWorkspace"
        ? {
            kind: "engineeringWorkspace" as const,
            workspaceId: "workspace_2",
            displayName: "工程目录",
            capabilities: ["engineeringWorkbench" as const]
          }
        : ({ kind: "none" } as const);

  const element = WorkspaceNavigator({
    workspaceContext,
    creative: createCreativeProps(),
    engineering: {
      activeActivity: "workspace",
      sections: [{ id: "chapters", title: "章节", itemCount: 0 }],
      expandedSectionIds: ["files", "novel-studio", "chapters"],
      fileTree: [
        {
          id: "file:project.json",
          name: "project.json",
          kind: "file",
          path: "project.json"
        }
      ]
    },
    none: {
      onOpenProject: () => undefined,
      onCreateProject: () => undefined
    }
  });

  return renderToStaticMarkup(element);
}

function createCreativeProps(
  overrides: Partial<CreativeWorkspaceNavigatorProps> = {}
): CreativeWorkspaceNavigatorProps {
  return {
    projectTitle: "长安旧梦",
    mode: "writing",
    searchQuery: "",
    chapters: [
      {
        id: "ch_opening",
        title: "Opening",
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
        updatedAt: "2026-07-08T00:00:00.000Z"
      }
    ],
    activeChapterId: "ch_opening",
    dirtyChapterIds: ["ch_opening"],
    storyBible: createStoryBible(),
    onModeSelect: () => undefined,
    onSearchQueryChange: () => undefined,
    onCreateChapter: () => undefined,
    onChapterOpen: () => undefined,
    onChapterRename: () => undefined,
    onChapterDuplicate: () => undefined,
    onChapterDelete: () => undefined,
    onStoryKindOpen: () => undefined,
    onStoryEntryOpen: () => undefined,
    onStoryEntryCreate: () => undefined,
    ...overrides
  };
}

function createStoryBible(overrides: Partial<StoryBibleEditorProps> = {}): StoryBibleEditorProps {
  return {
    activeKind: "character",
    status: "idle",
    entries: [
      {
        id: "character_lin",
        kind: "character",
        title: "林照月",
        status: "主角",
        body: "开篇出现。"
      },
      {
        id: "world_changan",
        kind: "world",
        title: "长安城",
        status: "完成",
        body: "雨夜中的旧城。"
      },
      {
        id: "outline_main",
        kind: "outline",
        title: "主大纲",
        status: "完成",
        body: "三幕结构。"
      },
      {
        id: "timeline_main",
        kind: "timeline",
        title: "主时间线",
        status: "完成",
        body: "雨夜开场。"
      },
      {
        id: "memory_letter",
        kind: "memory",
        title: "旧信记忆",
        status: "活动",
        body: "林照月记得那封信。"
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
    onSave: () => undefined,
    ...overrides
  };
}

function requiredElement<T extends Element = HTMLElement>(
  container: ParentNode,
  selector: string
): T {
  const element = container.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Missing test element: ${selector}`);
  }
  return element;
}

function click(element: Element): void {
  act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

function keydown(element: Element, key: string): void {
  act(() => element.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key })));
}
