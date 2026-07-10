// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { describe, expect, test } from "vitest";

import { createDesktopApplication } from "@novel-studio/application";
import type { ApplicationCommandId } from "@novel-studio/application";
import type { ModelSettingsPanelProps } from "../src/index.js";
import { WorkspaceShell } from "../src/index.js";

describe("WorkspaceShell", () => {
  test("applies persisted theme and accent preferences to the workbench root", () => {
    const application = createDesktopApplication();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        appearancePreferences={{ theme: "light", accentColor: "amber" }}
        shellState={application.getShellState()}
        commands={application.listCommands()}
        commandPaletteOpen={false}
      />
    );

    expect(html).toContain('data-theme="light"');
    expect(html).toContain('data-accent="amber"');
  });

  test("defines workbench theme and accent token scopes without changing semantic colors", () => {
    const css = readFileSync(join(process.cwd(), "packages", "ui", "src", "styles.css"), "utf8");

    expect(css).toContain('.ns-shell[data-theme="light"]');
    expect(css).toContain('.ns-shell[data-theme="system"]');
    expect(css).toContain('.ns-shell[data-accent="blue"]');
    expect(css).toContain('.ns-shell[data-accent="amber"]');

    const accentScopes = [...css.matchAll(/\.ns-shell\[data-accent="(?:blue|amber)"\]\s*\{([^}]*)\}/g)]
      .map((match) => match[1])
      .join("\n");
    expect(accentScopes).not.toMatch(/--ns-(?:danger|warning|success|info)/);
  });

  test("renders the VS Code style application shell regions", () => {
    const application = createDesktopApplication();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        shellState={application.getShellState()}
        commands={application.listCommands()}
        commandPaletteOpen={false}
      />
    );

    expect(html).toContain('data-region="activity-bar"');
    expect(html).toContain('data-region="navigator"');
    expect(html).toContain('data-region="editor-area"');
    expect(html).toContain('data-region="ai-panel"');
    expect(html).toContain('data-region="status-bar"');
    expect(html).toContain('aria-label="活动栏"');
    expect(html).toContain('aria-label="项目导航"');
    expect(html).toContain('aria-label="编辑区"');
    expect(html).toContain('aria-label="AI 对话面板"');
    expect(html).toContain('aria-label="状态栏"');
    expect(html).toContain('aria-label="Navigator resize handle"');
    expect(html).toContain('aria-label="AI panel resize handle"');
    expect(html).toContain('aria-label="章节 分组"');
    expect(html).toContain('aria-label="AI 写作工作流"');
    expect(html).toContain("Markdown");
  });

  test("keeps duplicate save/context metadata out of the AI panel and uses an IDE editor surface", () => {
    const application = createDesktopApplication();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        shellState={{ ...application.getShellState(), saveStatus: "Unsaved" }}
        commands={application.listCommands()}
        commandPaletteOpen={false}
      />
    );

    const aiPanelIndex = html.indexOf('data-region="ai-panel"');
    const statusBarIndex = html.indexOf('data-region="status-bar"');
    const aiPanelHtml = html.slice(aiPanelIndex, statusBarIndex);

    expect(html).toContain('data-editor-layout="ide"');
    expect(html).toContain('class="ns-editor-surface"');
    expect(aiPanelHtml).not.toContain('class="ns-meta-list"');
    expect(aiPanelHtml).not.toContain("<dt>保存</dt>");
  });

  test("renders the editor tab strip without unfinished disabled copy", () => {
    const application = createDesktopApplication();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        shellState={application.getShellState()}
        commands={application.listCommands()}
        commandPaletteOpen={false}
      />
    );

    expect(html).toContain('aria-label="打开命令面板"');
    expect(html).toContain('title="打开命令面板"');
    expect(html).toContain('aria-label="章节标签"');
    expect(html).not.toContain("标签切换会在后续里程碑补齐");
    expect(html).not.toContain('aria-disabled="true"');
  });

  test("renders an ordinary file editor without chapter-only panels", () => {
    const application = createDesktopApplication();
    const calls: string[] = [];
    const tree = WorkspaceShell({
      shellState: application.getShellState(),
      commands: application.listCommands(),
      commandPaletteOpen: false,
      fileEditor: {
        path: "notes/scene.md",
        fileName: "scene.md",
        content: "Scene one\n",
        dirty: true,
        saveStatus: "Unsaved",
        onContentChange: (content) => calls.push(`content:${content}`),
        onSave: () => calls.push("save")
      }
    });

    findElementByAriaLabel(tree, "保存普通文件")?.props.onClick?.();
    const html = renderToStaticMarkup(tree);

    expect(calls).toEqual(["save"]);
    expect(html).toContain('aria-label="普通文件编辑器"');
    expect(html).toContain("notes/scene.md");
    expect(html).toContain("Scene one");
    expect(html).not.toContain('aria-label="鐗堟湰鍘嗗彶"');
    expect(html).not.toContain("Selection review");
  });

  test("switches bottom panel tabs and renders the active panel content", () => {
    const application = createDesktopApplication();
    const selectedTabs: string[] = [];
    const tree = WorkspaceShell({
      shellState: {
        ...application.getShellState(),
        activeBottomPanelTab: "搜索"
      },
      commands: application.listCommands(),
      commandPaletteOpen: false,
      search: {
        query: "oath",
        status: "results-ready",
        entryCount: 4,
        results: [],
        onQueryChange: () => undefined,
        onSearch: () => undefined,
        onRebuildIndex: () => undefined
      },
      onBottomPanelTabSelect: (tab) => selectedTabs.push(tab)
    });
    const searchTab = findElementByAriaLabel(tree, "切换底部面板：搜索");

    expect(searchTab).toBeDefined();
    expect(searchTab?.props.disabled).toBeUndefined();
    searchTab?.props.onClick?.();

    expect(selectedTabs).toEqual(["搜索"]);

    const html = renderToStaticMarkup(tree);
    expect(html).toContain('aria-label="底部面板内容：搜索"');
    expect(html).toContain("搜索摘要");
    expect(html).toContain("索引条目 4");
    expect(html).toContain("当前查询 oath");
  });

  test("marks navigator, AI panel, and bottom panel hidden in focus mode", () => {
    const application = createDesktopApplication();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        shellState={{
          ...application.getShellState(),
          focusMode: true,
          navigatorCollapsed: false,
          inspectorCollapsed: false,
          bottomPanelVisible: true
        }}
        commands={application.listCommands()}
        commandPaletteOpen={false}
        chapterEditor={{
          chapter: {
            frontmatter: {
              schemaVersion: "1.0",
              id: "ch_focus",
              type: "chapter",
              title: "Focus Chapter",
              order: 1,
              status: "draft",
              createdAt: "2026-07-07T00:00:00.000Z",
              updatedAt: "2026-07-07T00:00:00.000Z"
            },
            body: "Focus body."
          },
          saveStatus: "Saved",
          dirty: false,
          versionHistory: []
        }}
      />
    );

    expect(html).toContain('data-focus-mode="true"');
    expect(html).toContain('data-region="navigator"');
    expect(html).toContain('data-focus-hidden="true"');
    expect(html).toContain('data-region="ai-panel"');
    expect(html).toContain('data-region="bottom-panel"');
    expect(html).toContain('aria-label="编辑区"');
    expect(html).toContain('aria-label="状态栏"');
  });

  test("renders project health diagnostics in the problems panel", () => {
    const application = createDesktopApplication();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        shellState={{
          ...application.getShellState(),
          activeBottomPanelTab: "问题"
        }}
        commands={application.listCommands()}
        commandPaletteOpen={false}
        projectWorkflow={{
          projectRootInput: "D:/Novel",
          chapters: [],
          health: {
            status: "blocked",
            checkedAt: "2026-07-05T00:10:00.000Z",
            summary: {
              errorCount: 1,
              warningCount: 1,
              infoCount: 3
            },
            issues: [
              {
                id: "references.recovery_missing_chapter.ch_missing",
                severity: "error",
                source: "references",
                title: "Recovery record points to a missing chapter",
                message: "Recovery draft ch_missing no longer matches a chapter.",
                suggestedAction: "Review recovery history before clearing it."
              },
              {
                id: "recovery.dirty_drafts",
                severity: "warning",
                source: "recovery",
                title: "Recoverable drafts available",
                message: "There is 1 dirty recovery draft.",
                suggestedAction: "Open recovery review before continuing long edits."
              }
            ]
          },
          onProjectRootChange: () => undefined,
          onOpenProject: () => undefined,
          onCreateProject: () => undefined,
          onCreateChapter: () => undefined,
          onSelectChapter: () => undefined
        }}
      />
    );

    expect(html).toContain('aria-label="Project health diagnostics"');
    expect(html).toContain("Project Health blocked");
    expect(html).toContain("Errors 1");
    expect(html).toContain("Warnings 1");
    expect(html).toContain("Recovery record points to a missing chapter");
    expect(html).toContain("Recoverable drafts available");
  });

  test("opens directly into the writing workspace instead of a marketing page", () => {
    const application = createDesktopApplication();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        shellState={application.getShellState()}
        commands={application.listCommands()}
        commandPaletteOpen={false}
      />
    );

    expect(html).toContain("未命名章节");
    expect(html).toContain("继续写下一场");
    expect(html).not.toMatch(/hero|marketing|landing/i);
  });

  test("renders localized activity buttons with active state and click wiring", () => {
    const application = createDesktopApplication();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        shellState={application.getShellState()}
        commands={application.listCommands()}
        commandPaletteOpen={false}
        onActivitySelect={() => undefined}
      />
    );

    expect(html).toContain('aria-label="工作区"');
    expect(html).toContain('aria-label="搜索"');
    expect(html).toContain('aria-label="时间线"');
    expect(html).toContain('aria-label="AI 工作流"');
    expect(html).toContain('aria-label="创作系统"');
    expect(html).toContain('aria-label="设置"');
    expect(html).toContain('data-activity-id="workspace"');
    expect(html).toContain('aria-current="page"');
  });

  test("renders localized empty states for non-workspace activities", () => {
    const application = createDesktopApplication();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        shellState={{ ...application.getShellState(), activeActivity: "search" }}
        commands={application.listCommands()}
        commandPaletteOpen={false}
      />
    );

    expect(html).toContain("搜索项目");
    expect(html).toContain("全文搜索将在索引完成后显示结果。");
  });

  test("renders the M20 project search panel with results", () => {
    const application = createDesktopApplication();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        shellState={{ ...application.getShellState(), activeActivity: "search" }}
        commands={application.listCommands()}
        commandPaletteOpen={false}
        search={{
          query: "oath",
          status: "results-ready",
          entryCount: 4,
          generatedAt: "2026-07-05T00:00:00.000Z",
          results: [
            {
              id: "chapter:ch_opening",
              type: "chapter",
              title: "开篇",
              snippet: "The hero keeps a hidden oath.",
              score: 2,
              sourceRef: {
                kind: "chapter",
                id: "ch_opening",
                relativePath: "chapters/ch_opening.md"
              }
            }
          ],
          onQueryChange: () => undefined,
          onSearch: () => undefined,
          onRebuildIndex: () => undefined
        }}
      />
    );

    expect(html).toContain('aria-label="项目全文搜索"');
    expect(html).toContain('aria-label="搜索关键词"');
    expect(html).toContain("重建索引");
    expect(html).toContain("索引条目 4");
    expect(html).toContain("开篇");
    expect(html).toContain("chapters/ch_opening.md");
    expect(html).toContain("The hero keeps a hidden oath.");
  });

  test("opens a search result through a structured click callback", () => {
    const application = createDesktopApplication();
    const openedResults: string[] = [];
    const tree = WorkspaceShell({
      shellState: { ...application.getShellState(), activeActivity: "search" },
      commands: application.listCommands(),
      commandPaletteOpen: false,
      search: {
        query: "oath",
        status: "results-ready",
        entryCount: 4,
        results: [
          {
            id: "chapter:ch_opening",
            type: "chapter",
            title: "开篇",
            snippet: "The hero keeps a hidden oath.",
            score: 2,
            sourceRef: {
              kind: "chapter",
              id: "ch_opening",
              relativePath: "chapters/ch_opening.md"
            }
          }
        ],
        onQueryChange: () => undefined,
        onSearch: () => undefined,
        onRebuildIndex: () => undefined
      },
      onSearchResultOpen: (result) => openedResults.push(result.sourceRef.id)
    });
    const openResult = findElementByAriaLabel(tree, "打开搜索结果：开篇");

    expect(openResult).toBeDefined();
    openResult?.props.onClick?.();

    expect(openedResults).toEqual(["ch_opening"]);
  });

  test("renders a chapter editor when chapter data is available", () => {
    const application = createDesktopApplication();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        chapterEditor={{
          chapter: {
            frontmatter: {
              schemaVersion: "1.0",
              id: "ch_01JZ7P9QK2R6D4W8K3A1B5C9D0",
              type: "chapter",
              title: "第一章",
              order: 1,
              status: "draft",
              createdAt: "2026-07-03T00:00:00.000Z",
              updatedAt: "2026-07-03T00:00:00.000Z"
            },
            body: "原始章节正文。\n"
          },
          dirty: true,
          saveStatus: "Unsaved",
          versionHistory: [
            {
              versionId: "ver_01",
              label: "Before AI apply",
              createdAt: "2026-07-03T00:00:00.000Z"
            }
          ],
          diffPreview: {
            title: "AI suggestion",
            changes: [
              {
                kind: "insert",
                value: "A revised opening paragraph.\n"
              }
            ]
          }
        }}
        shellState={application.getShellState()}
        commands={application.listCommands()}
        commandPaletteOpen={false}
      />
    );

    expect(html).toContain("第一章");
    expect(html).toContain("已修改");
    expect(html).toContain("版本历史");
    expect(html).toContain("AI suggestion");
  });

  test("renders project workflow controls and chapter selection", () => {
    const application = createDesktopApplication();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        shellState={application.getShellState()}
        commands={application.listCommands()}
        commandPaletteOpen={false}
        projectWorkflow={{
          projectRootInput: "D:/Novel/M12",
          status: "creating",
          feedback: {
            kind: "error",
            message: "project.json could not be read."
          },
          chapters: [
            {
              id: "ch_opening",
              title: "开篇",
              order: 1,
              status: "draft",
              updatedAt: "2026-07-04T00:00:00.000Z"
            }
          ],
          activeChapterId: "ch_opening",
          onProjectRootChange: () => undefined,
          onOpenProject: () => undefined,
          onCreateProject: () => undefined,
          onCreateChapter: () => undefined,
          onSelectChapter: () => undefined
        }}
      />
    );

    expect(html).toContain('aria-label="项目路径"');
    expect(html).toContain('aria-label="打开项目"');
    expect(html).toContain('aria-label="创建项目"');
    expect(html).toContain('aria-label="新建章节"');
    expect(html).toContain("正在创建");
    expect(html).toContain('role="status"');
    expect(html).toContain("project.json could not be read.");
    expect(html).toContain('aria-current="true"');
    expect(html).toContain("开篇");
  });

  test("renders onboarding quick start actions and invokes callbacks", () => {
    const application = createDesktopApplication();
    const calls: string[] = [];
    const tree = WorkspaceShell({
      shellState: { ...application.getShellState(), inspectorCollapsed: false },
      commands: application.listCommands(),
      commandPaletteOpen: false,
      projectWorkflow: {
        projectRootInput: "D:/Novel/Example",
        chapters: [],
        onProjectRootChange: () => undefined,
        onOpenProject: () => calls.push("open"),
        onCreateProject: () => calls.push("create"),
        onCreateChapter: () => calls.push("chapter"),
        onSelectChapter: () => undefined
      },
      onboarding: {
        visible: true,
        dismissed: false,
        steps: [
          { id: "project", label: "创建或打开项目", completed: false },
          { id: "chapter", label: "新建第一章", completed: false },
          { id: "ai", label: "用 AI 生成建议", completed: false }
        ],
        onCreateExampleProject: () => calls.push("example"),
        onCreateProject: () => calls.push("create"),
        onOpenProject: () => calls.push("open"),
        onCreateFirstChapter: () => calls.push("chapter"),
        onDismiss: () => calls.push("dismiss")
      }
    });

    const createExample = findElementByAriaLabel(tree, "创建示例项目");
    const createProject = findElementByAriaLabel(tree, "创建新项目");
    const openProject = findElementByAriaLabel(tree, "打开已有项目");
    const createFirstChapter = findElementByAriaLabel(tree, "新建第一章");
    const dismiss = findElementByAriaLabel(tree, "隐藏快速开始");

    createExample?.props.onClick?.();
    createProject?.props.onClick?.();
    openProject?.props.onClick?.();
    createFirstChapter?.props.onClick?.();
    dismiss?.props.onClick?.();

    expect(calls).toEqual(["example", "create", "open", "chapter", "dismiss"]);

    const html = renderToStaticMarkup(tree);
    expect(html).toContain('aria-label="快速开始"');
    expect(html).toContain("创建示例项目");
    expect(html).toContain("创建或打开项目");
    expect(html).toContain("新建第一章");
    expect(html).not.toMatch(/marketing|landing/i);
  });

  test("renders plugin management inside settings with refresh wiring", () => {
    const application = createDesktopApplication();
    const refreshCalls: string[] = [];
    const settings = {
      activeSection: "plugins",
      defaultProfileId: "model_default",
      selectedProfileId: "model_default",
      profiles: [
        {
          id: "model_default",
          provider: "openai-compatible",
          displayName: "Default Model",
          baseUrl: "https://api.example.com/v1",
          modelName: "example-model",
          apiKeyRef: "secret://model_default/api_key",
          temperature: 0.7,
          maxTokens: 4096,
          timeoutMs: 60000
        }
      ],
      draft: {
        id: "model_default",
        provider: "openai-compatible",
        displayName: "Default Model",
        baseUrl: "https://api.example.com/v1",
        modelName: "example-model",
        apiKeyRefInput: "",
        temperature: "0.7",
        maxTokens: "4096",
        topP: "",
        reasoningEffortEnabled: false,
        timeoutMs: "60000"
      },
      saveStatus: "idle",
      plugins: {
        status: "loaded",
        entries: [
          {
            pluginId: "novel.timeline-tools",
            enabled: true,
            manifestPath: "plugins/novel.timeline-tools/plugin.json",
            grantedPermissions: [{ permission: "asset:read", scopes: ["timeline"] }],
            manifestStatus: "valid"
          }
        ],
        feedback: { kind: "info", message: "插件注册表已加载。" },
        onRefresh: () => refreshCalls.push("refresh"),
        onSetEnabled: () => refreshCalls.push("toggle")
      }
    } satisfies ModelSettingsPanelProps & {
      readonly plugins: {
        readonly status: "loaded";
        readonly entries: readonly {
          readonly pluginId: string;
          readonly enabled: boolean;
          readonly manifestPath: string;
          readonly grantedPermissions: readonly {
            readonly permission: string;
            readonly scopes: readonly string[];
          }[];
          readonly manifestStatus: "valid";
        }[];
        readonly feedback: { readonly kind: "info"; readonly message: string };
        readonly onRefresh: () => void;
        readonly onSetEnabled: () => void;
      };
    };
    const tree = (
      <WorkspaceShell
        shellState={{ ...application.getShellState(), activeActivity: "settings" }}
        commands={application.listCommands()}
        commandPaletteOpen={false}
        settings={settings}
      />
    );
    const host = document.createElement("div");
    document.body.append(host);
    let root: Root | undefined;

    act(() => {
      root = createRoot(host);
      root.render(tree);
    });

    act(() => {
      host
        .querySelector<HTMLButtonElement>('button[aria-label="刷新插件注册表"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(refreshCalls).toEqual(["refresh"]);

    act(() => {
      root?.unmount();
    });
    host.remove();

    const html = renderToStaticMarkup(tree);
    expect(html).toContain('aria-label="插件管理"');
    expect(html).toContain("novel.timeline-tools");
    expect(html).toContain("plugins/novel.timeline-tools/plugin.json");
    expect(html).toContain("asset:read · timeline");
    const pluginSection = html.slice(html.indexOf('aria-label="插件管理"'));
    expect(pluginSection).not.toContain("secret://");
  });

  test("renders AI selection review controls in the inspector", () => {
    const application = createDesktopApplication();
    const calls: string[] = [];
    const tree = WorkspaceShell({
      shellState: { ...application.getShellState(), inspectorCollapsed: false },
      commands: application.listCommands(),
      commandPaletteOpen: false,
      aiWritingWorkflow: {
        status: "suggestion-ready",
        instruction: "Rewrite selection.",
        selectionReview: {
          status: "pending",
          originalText: "Opening line.",
          proposedText: "The opening line tightened.",
          rangeLabel: "0-13",
          compareLabel: "Opening line. -> The opening line tightened.",
          canUndo: false
        },
        onInstructionChange: () => undefined,
        onGenerateSuggestion: () => undefined,
        onApplySuggestion: () => calls.push("accept"),
        onRejectSelectionReview: () => calls.push("reject"),
        onUndoSelectionReview: () => calls.push("undo"),
        onRetrySuggestion: () => undefined,
        onCancelStreaming: () => undefined
      }
    });

    findElementByAriaLabel(tree, "Accept selection AI preview")?.props.onClick?.();
    findElementByAriaLabel(tree, "Reject selection AI preview")?.props.onClick?.();
    findElementByAriaLabel(tree, "Undo selection AI rejection")?.props.onClick?.();

    expect(calls).toEqual(["accept", "reject", "undo"]);
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('aria-label="Selection AI review"');
    expect(html).toContain("Opening line. -&gt; The opening line tightened.");
  });

  test("switches chapter editor tabs through the project workflow callback", () => {
    const application = createDesktopApplication();
    const selectedChapters: string[] = [];
    const tree = WorkspaceShell({
      shellState: application.getShellState(),
      commands: application.listCommands(),
      commandPaletteOpen: false,
      projectWorkflow: {
        projectRootInput: "D:/Novel/M34",
        chapters: [
          {
            id: "ch_opening",
            title: "开篇",
            order: 1,
            status: "draft",
            updatedAt: "2026-07-04T00:00:00.000Z"
          },
          {
            id: "ch_second",
            title: "第二章",
            order: 2,
            status: "draft",
            updatedAt: "2026-07-04T00:00:00.000Z"
          }
        ],
        activeChapterId: "ch_opening",
        onProjectRootChange: () => undefined,
        onOpenProject: () => undefined,
        onCreateProject: () => undefined,
        onCreateChapter: () => undefined,
        onSelectChapter: (chapterId) => selectedChapters.push(chapterId)
      }
    });
    const secondTab = findElementByAriaLabel(tree, "切换章节标签：第二章");

    expect(secondTab).toBeDefined();
    expect(secondTab?.props.disabled).toBeUndefined();
    secondTab?.props.onClick?.();
    expect(selectedChapters).toEqual(["ch_second"]);

    const html = renderToStaticMarkup(tree);
    expect(html).toContain('aria-label="章节标签"');
    expect(html).toContain('aria-selected="true"');
    expect(html).not.toContain("标签切换会在后续里程碑补齐");
  });

  test("renders split view layout controls and shell-owned panel dimensions", () => {
    const application = createDesktopApplication();
    const executedCommands: ApplicationCommandId[] = [];
    const tree = WorkspaceShell({
      shellState: {
        ...application.getShellState(),
        inspectorCollapsed: false,
        bottomPanelVisible: true,
        workspaceLayout: {
          splitView: true,
          navigatorWidth: 300,
          inspectorWidth: 360,
          bottomPanelHeight: 240
        }
      },
      commands: application.listCommands(),
      commandPaletteOpen: false,
      onCommandExecute: (commandId) => executedCommands.push(commandId)
    });
    const splitToggle = findElementByAriaLabel(tree, "切换 Split View");

    expect(splitToggle).toBeDefined();
    splitToggle?.props.onClick?.();
    expect(executedCommands).toEqual(["workspace.toggle-split-view"]);

    const html = renderToStaticMarkup(tree);
    expect(html).toContain('data-split-view="true"');
    expect(html).toContain("--ns-navigator-width:300px");
    expect(html).toContain("--ns-ai-panel-width:360px");
    expect(html).toContain("--ns-bottom-panel-height:240px");
    expect(html).toContain('aria-label="拆分参考窗格"');
  });

  test("renders plugin command disabled reasons in the command palette", () => {
    const application = createDesktopApplication();
    const executedCommands: ApplicationCommandId[] = [];
    const tree = WorkspaceShell({
      shellState: application.getShellState(),
      commands: [
        ...application.listCommands(),
        {
          id: "plugin:novel.structure-tools:outline.audit",
          title: "Audit Outline",
          scope: "plugin",
          riskLevel: "safe",
          defaultShortcut: "",
          disabledReason: "Plugin is disabled.",
          source: {
            kind: "plugin",
            pluginId: "novel.structure-tools",
            contributionId: "outline.audit"
          }
        }
      ],
      commandPaletteOpen: true,
      onCommandExecute: (commandId) => executedCommands.push(commandId)
    });
    const command = findElementByAriaLabel(tree, "Execute command: Audit Outline");

    expect(command).toBeDefined();
    expect(command?.props.disabled).toBe(true);
    command?.props.onClick?.();
    expect(executedCommands).toEqual([]);

    const html = renderToStaticMarkup(tree);
    expect(html).toContain("Plugin");
    expect(html).toContain("Audit Outline");
    expect(html).toContain("Plugin is disabled.");
  });

  test("renders only runtime-open chapter tabs with dirty and close affordances", () => {
    const application = createDesktopApplication();
    const closedTabs: string[] = [];
    const tree = WorkspaceShell({
      shellState: application.getShellState(),
      commands: application.listCommands(),
      commandPaletteOpen: false,
      projectWorkflow: {
        projectRootInput: "D:/Novel/M37",
        chapters: [
          {
            id: "ch_opening",
            title: "开篇",
            order: 1,
            status: "draft",
            updatedAt: "2026-07-04T00:00:00.000Z"
          },
          {
            id: "ch_second",
            title: "第二章",
            order: 2,
            status: "draft",
            updatedAt: "2026-07-04T00:00:00.000Z"
          },
          {
            id: "ch_third",
            title: "第三章",
            order: 3,
            status: "draft",
            updatedAt: "2026-07-04T00:00:00.000Z"
          }
        ],
        openChapterTabIds: ["ch_opening", "ch_second"],
        dirtyChapterIds: ["ch_second"],
        activeChapterId: "ch_opening",
        onProjectRootChange: () => undefined,
        onOpenProject: () => undefined,
        onCreateProject: () => undefined,
        onCreateChapter: () => undefined,
        onSelectChapter: () => undefined,
        onCloseChapterTab: (chapterId) => closedTabs.push(chapterId)
      }
    });
    const closeSecond = findElementByAriaLabel(tree, "关闭章节标签：第二章");

    expect(closeSecond).toBeDefined();
    closeSecond?.props.onClick?.();
    expect(closedTabs).toEqual(["ch_second"]);

    const html = renderToStaticMarkup(tree);
    expect(html).toContain("开篇");
    expect(html).toContain("第二章");
    expect(html).toContain('data-dirty="true"');
    expect(html).toContain('aria-label="关闭章节标签：第二章"');
    expect(html).not.toContain('aria-label="切换章节标签：第三章"');
    expect(html).not.toContain('aria-label="关闭章节标签：第三章"');
  });

  test("renders an autosave recovery notice from project workflow recovery state", () => {
    const application = createDesktopApplication();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        shellState={{ ...application.getShellState(), inspectorCollapsed: false }}
        commands={application.listCommands()}
        commandPaletteOpen={false}
        projectWorkflow={{
          projectRootInput: "D:/Novel/M38",
          chapters: [
            {
              id: "ch_opening",
              title: "Opening",
              order: 1,
              status: "draft",
              updatedAt: "2026-07-04T00:00:00.000Z"
            }
          ],
          openChapterTabIds: ["ch_opening"],
          dirtyChapterIds: ["ch_opening"],
          activeChapterId: "ch_opening",
          recovery: {
            availableItems: [
              {
                sessionId: "session_prj_m38_ch_opening",
                chapterId: "ch_opening",
                updatedAt: "2026-07-05T00:05:00.000Z"
              }
            ]
          },
          onProjectRootChange: () => undefined,
          onOpenProject: () => undefined,
          onCreateProject: () => undefined,
          onCreateChapter: () => undefined,
          onSelectChapter: () => undefined
        }}
      />
    );

    expect(html).toContain('aria-label="Autosave recovery"');
    expect(html).toContain("Recoverable drafts 1");
    expect(html).toContain("Opening");
    expect(html).toContain('data-dirty="true"');
  });

  test("renders recovery review preview, apply, and discard actions", () => {
    const application = createDesktopApplication();
    const calls: string[] = [];
    const tree = WorkspaceShell({
      shellState: application.getShellState(),
      commands: application.listCommands(),
      commandPaletteOpen: false,
      projectWorkflow: {
        projectRootInput: "D:/Novel/M49",
        chapters: [
          {
            id: "ch_opening",
            title: "Opening",
            order: 1,
            status: "draft",
            updatedAt: "2026-07-04T00:00:00.000Z"
          }
        ],
        openChapterTabIds: ["ch_opening"],
        dirtyChapterIds: ["ch_opening"],
        activeChapterId: "ch_opening",
        recovery: {
          availableItems: [
            {
              sessionId: "session_prj_m49_ch_opening",
              chapterId: "ch_opening",
              updatedAt: "2026-07-06T00:05:00.000Z"
            }
          ],
          review: {
            status: "idle",
            selectedDraft: {
              sessionId: "session_prj_m49_ch_opening",
              chapterId: "ch_opening",
              chapterTitle: "Opening",
              updatedAt: "2026-07-06T00:05:00.000Z",
              body: "unsaved recovered opening\n"
            }
          }
        },
        onProjectRootChange: () => undefined,
        onOpenProject: () => undefined,
        onCreateProject: () => undefined,
        onCreateChapter: () => undefined,
        onSelectChapter: () => undefined,
        onPreviewRecoveryDraft: (sessionId) => calls.push(`preview:${sessionId}`),
        onApplyRecoveryDraft: (sessionId) => calls.push(`apply:${sessionId}`),
        onDiscardRecoveryDraft: (sessionId) => calls.push(`discard:${sessionId}`)
      }
    });

    findElementByAriaLabel(tree, "预览恢复草稿：Opening")?.props.onClick?.();
    findElementByAriaLabel(tree, "应用恢复草稿：Opening")?.props.onClick?.();
    findElementByAriaLabel(tree, "丢弃恢复草稿：Opening")?.props.onClick?.();

    expect(calls).toEqual([
      "preview:session_prj_m49_ch_opening",
      "apply:session_prj_m49_ch_opening",
      "discard:session_prj_m49_ch_opening"
    ]);

    const html = renderToStaticMarkup(tree);
    expect(html).toContain('aria-label="恢复草稿预览"');
    expect(html).toContain("unsaved recovered opening");
    expect(html).toContain("应用恢复草稿");
    expect(html).toContain("丢弃恢复草稿");
  });

  test("renders Story Bible summaries and context eligibility", () => {
    const application = createDesktopApplication();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        shellState={{ ...application.getShellState(), inspectorCollapsed: false }}
        commands={application.listCommands()}
        commandPaletteOpen={false}
        storyBible={{
          assets: [
            {
              id: "chr_hero",
              title: "Hero",
              type: "character",
              status: "active",
              summary: "A procedural protagonist with a hidden oath."
            },
            {
              id: "mem_oath",
              title: "Oath",
              type: "memory.long-term",
              status: "active",
              summary: "The hero never reveals the old oath aloud.",
              contextEligible: true
            }
          ]
        }}
      />
    );

    expect(html).toContain('aria-label="故事圣经摘要"');
    expect(html).toContain("Hero");
    expect(html).toContain("Oath");
    expect(html).toContain("可进入上下文");
  });

  test("renders the M21 Story Bible editor view", () => {
    const application = createDesktopApplication();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        shellState={{ ...application.getShellState(), activeActivity: "storyBible" }}
        commands={application.listCommands()}
        commandPaletteOpen={false}
        storyBibleEditor={{
          activeKind: "character",
          status: "idle",
          entries: [
            {
              id: "chr_hero",
              kind: "character",
              title: "Hero",
              status: "active",
              body: "A procedural protagonist with a hidden oath."
            }
          ],
          draft: {
            kind: "character",
            title: "Hero",
            body: "A procedural protagonist with a hidden oath.",
            status: "active"
          },
          onKindSelect: () => undefined,
          onEntrySelect: () => undefined,
          onDraftChange: () => undefined,
          onNewDraft: () => undefined,
          onSave: () => undefined
        }}
      />
    );

    expect(html).toContain('aria-label="故事圣经"');
    expect(html).toContain('aria-label="故事圣经编辑器"');
    expect(html).toContain("人物");
    expect(html).toContain("世界观");
    expect(html).toContain("大纲");
    expect(html).toContain("时间线");
    expect(html).toContain("记忆");
    expect(html).toContain('aria-label="设定标题"');
    expect(html).toContain('aria-label="设定正文"');
    expect(html).toContain("保存设定");
    expect(html).toContain("Hero");
  });

  test("renders Story Bible consistency warnings with jump actions", () => {
    const application = createDesktopApplication();
    const openedEntries: string[] = [];
    const tree = WorkspaceShell({
      shellState: { ...application.getShellState(), activeActivity: "storyBible" },
      commands: application.listCommands(),
      commandPaletteOpen: false,
      storyBibleEditor: {
        activeKind: "character",
        status: "idle",
        entries: [
          {
            id: "chr_hero",
            kind: "character",
            title: "Mira",
            status: "active",
            body: "Mira is established as an only child."
          },
          {
            id: "world_mira_family",
            kind: "world",
            title: "Mira Family Rumor",
            status: "active",
            body: "Conflict: Captain Mira has a younger brother in the capital."
          }
        ],
        consistency: {
          status: "attention",
          checkedAt: "2026-07-05T00:00:00.000Z",
          issues: [
            {
              id: "story-consistency.character.chr_hero.world_mira_family",
              severity: "warning",
              title: "Character setting may conflict with another Story Bible entry",
              message:
                "Mira appears in Mira Family Rumor with an explicit conflict marker. Review both entries before continuing the chapter.",
              sourceRef: {
                kind: "character",
                id: "chr_hero",
                title: "Mira"
              },
              targetRef: {
                kind: "world",
                id: "world_mira_family",
                title: "Mira Family Rumor"
              },
              suggestedAction: "Open the linked Story Bible entry and resolve the setting conflict."
            }
          ]
        },
        draft: {
          kind: "character",
          title: "Mira",
          body: "Mira is established as an only child.",
          status: "active"
        },
        onKindSelect: () => undefined,
        onEntrySelect: (entryId) => openedEntries.push(entryId),
        onDraftChange: () => undefined,
        onNewDraft: () => undefined,
        onSave: () => undefined
      }
    });
    const jumpButton = findElementByAriaLabel(tree, "Open consistency target: Mira Family Rumor");

    expect(jumpButton).toBeDefined();
    jumpButton?.props.onClick?.();
    expect(openedEntries).toEqual(["world_mira_family"]);

    const html = renderToStaticMarkup(tree);
    expect(html).toContain('aria-label="Story Bible consistency warnings"');
    expect(html).toContain("Story Bible consistency attention");
    expect(html).toContain("Character setting may conflict with another Story Bible entry");
    expect(html).toContain("Mira Family Rumor");
    expect(html).toContain("Open target");
  });

  test("renders the timeline activity as a real main view with entry navigation", () => {
    const application = createDesktopApplication();
    const openedEntries: string[] = [];
    const tree = WorkspaceShell({
      shellState: { ...application.getShellState(), activeActivity: "timeline" },
      commands: application.listCommands(),
      commandPaletteOpen: false,
      storyBibleEditor: {
        activeKind: "timeline",
        status: "idle",
        entries: [
          {
            id: "timeline_main",
            kind: "timeline",
            title: "主线时间线",
            status: "active",
            body: "第一幕到第三幕的关键事件。"
          }
        ],
        draft: {
          kind: "timeline",
          title: "主线时间线",
          body: "第一幕到第三幕的关键事件。",
          status: "active"
        },
        onKindSelect: () => undefined,
        onEntrySelect: () => undefined,
        onDraftChange: () => undefined,
        onNewDraft: () => undefined,
        onSave: () => undefined
      },
      onTimelineEntryOpen: (entryId) => openedEntries.push(entryId)
    });
    const openTimeline = findElementByAriaLabel(tree, "打开时间线条目：主线时间线");

    expect(openTimeline).toBeDefined();
    openTimeline?.props.onClick?.();
    expect(openedEntries).toEqual(["timeline_main"]);

    const html = renderToStaticMarkup(tree);
    expect(html).toContain('aria-label="时间线主视图"');
    expect(html).toContain("主线时间线");
    expect(html).toContain("第一幕到第三幕的关键事件。");
    expect(html).not.toContain("完整可视化编辑会在后续里程碑补齐");
  });

  test("renders the timeline workspace as an ordered event rail with metrics", () => {
    const application = createDesktopApplication();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        shellState={{ ...application.getShellState(), activeActivity: "timeline" }}
        commands={application.listCommands()}
        commandPaletteOpen={false}
        storyBibleEditor={{
          activeKind: "timeline",
          status: "idle",
          entries: [
            {
              id: "timeline_main",
              kind: "timeline",
              title: "Main Timeline",
              status: "active",
              body: "Arrival happens before the council summons.",
              timelineEvents: [
                {
                  id: "evt_council",
                  sequence: 20,
                  title: "Council summons",
                  status: "draft",
                  summary: "The council asks for the sealed archive.",
                  chapterIds: ["ch_02"]
                },
                {
                  id: "evt_arrival",
                  sequence: 10,
                  title: "Hero arrives",
                  status: "active",
                  summary: "The hero enters the capital.",
                  chapterIds: ["ch_01"]
                }
              ]
            }
          ],
          draft: {
            kind: "timeline",
            title: "Main Timeline",
            body: "Arrival happens before the council summons.",
            status: "active"
          },
          onKindSelect: () => undefined,
          onEntrySelect: () => undefined,
          onDraftChange: () => undefined,
          onNewDraft: () => undefined,
          onSave: () => undefined
        }}
        onTimelineEntryOpen={() => undefined}
      />
    );

    expect(html).toContain('aria-label="Timeline event rail"');
    expect(html.indexOf("Hero arrives")).toBeLessThan(html.indexOf("Council summons"));
    expect(html).toContain("Events 2");
    expect(html).toContain("Linked chapters 2");
    expect(html).toContain("active");
    expect(html).toContain("draft");
    expect(html).toContain("ch_01");
    expect(html).toContain("ch_02");
    expect(html).toContain('aria-label="Edit timeline: Main Timeline"');
  });

  test("renders the M23 Studio editor view", () => {
    const application = createDesktopApplication();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        shellState={{ ...application.getShellState(), activeActivity: "studio" }}
        commands={application.listCommands()}
        commandPaletteOpen={false}
        studio={{
          assets: [
            {
              assetType: "prompt",
              assetId: "prompt_reviewer_default",
              title: "默认审稿 Prompt"
            }
          ],
          selectedAsset: {
            assetType: "prompt",
            assetId: "prompt_reviewer_default",
            title: "默认审稿 Prompt",
            validationStatus: "valid",
            content: '{\n  "schemaVersion": "1.0"\n}'
          },
          versions: [],
          status: "idle",
          onAssetSelect: () => undefined,
          onContentChange: () => undefined,
          onSave: () => undefined,
          onRestoreVersion: () => undefined
        }}
      />
    );

    expect(html).toContain('aria-label="创作系统工作台"');
    expect(html).toContain("默认审稿 Prompt");
    expect(html).toContain("保存配置资产");
    expect(html).toContain("版本历史");
  });
});

interface InspectableElementProps {
  readonly children?: ReactNode;
  readonly disabled?: boolean;
  readonly onClick?: () => void;
  readonly "aria-label"?: string;
}

function findElementByAriaLabel(
  node: ReactNode,
  ariaLabel: string
): ReactElement<InspectableElementProps> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findElementByAriaLabel(child, ariaLabel);
      if (match !== undefined) {
        return match;
      }
    }
    return undefined;
  }

  if (!isValidElement<InspectableElementProps>(node)) {
    return undefined;
  }

  if (node.props["aria-label"] === ariaLabel) {
    return node;
  }

  if (typeof node.type === "function") {
    const renderComponent = node.type as (props: InspectableElementProps) => ReactNode;
    const match = findElementByAriaLabel(renderComponent(node.props), ariaLabel);
    if (match !== undefined) {
      return match;
    }
  }

  return findElementByAriaLabel(node.props.children, ariaLabel);
}
