// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, test } from "vitest";

import { createDesktopApplication } from "@novel-studio/application";
import type { ApplicationCommandId } from "@novel-studio/application";
import type {
  AgentConversationNavigatorProps,
  AgentConversationViewProps,
  ModelSettingsPanelProps,
  StoryBibleEditorProps
} from "../src/index.js";
import { WorkspaceShell } from "../src/index.js";
import { workspaceActivitiesFor } from "../src/workspace-shell-activity.js";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("WorkspaceShell", () => {
  test("renders the top workbench selector in the title bar", () => {
    const application = createDesktopApplication();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        shellState={application.getShellState()}
        commands={application.listCommands()}
        commandPaletteOpen={false}
        onWorkbenchSelect={() => undefined}
      />
    );

    expect(html).toContain('aria-label="当前工作台：创作工作台"');
    expect(html.indexOf('aria-label="当前工作台：创作工作台"')).toBeLessThan(
      html.indexOf('aria-label="打开命令面板"')
    );
  });

  test("routes command palette close actions to the close callback", () => {
    const application = createDesktopApplication();
    const calls: string[] = [];
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    act(() => {
      root.render(
        <WorkspaceShell
          shellState={application.getShellState()}
          commands={application.listCommands()}
          commandPaletteOpen={true}
          onCommandPaletteOpen={() => calls.push("open")}
          onCommandPaletteClose={() => calls.push("close")}
        />
      );
    });
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="关闭命令面板"]')?.click());

    expect(calls).toEqual(["close"]);
    act(() => root.unmount());
    host.remove();
  });

  test("keeps project activities above bottom activities", () => {
    const application = createDesktopApplication();
    const groups = workspaceActivitiesFor(application.getShellState());
    const legacyActivityId = ["a", "i"].join("");

    expect(groups.projectActivities.map((activity) => activity.id)).toEqual([
      "workspace",
      "search",
      "timeline"
    ]);
    expect(groups.bottomActivities.map((activity) => activity.id)).toEqual(["studio", "settings"]);

    const html = renderToStaticMarkup(
      <WorkspaceShell
        shellState={application.getShellState()}
        commands={application.listCommands()}
        commandPaletteOpen={false}
      />
    );
    const activityBar = html.slice(
      html.indexOf('data-region="activity-bar"'),
      html.indexOf("</aside>", html.indexOf('data-region="activity-bar"'))
    );

    expect(activityBar).toContain('data-region="project-activities"');
    expect(activityBar).toContain('data-region="bottom-activities"');
    expect(activityBar.indexOf('data-region="project-activities"')).toBeLessThan(
      activityBar.indexOf('data-region="bottom-activities"')
    );
    expect(activityBar).not.toContain(`data-activity-id="${legacyActivityId}"`);
  });

  test("keeps only settings in the engineering bottom activity group", () => {
    const application = createDesktopApplication();
    const groups = workspaceActivitiesFor({
      ...application.getShellState(),
      workbenchMode: "engineering",
      workspaceContext: {
        kind: "engineeringWorkspace",
        workspaceId: "workspace_test",
        displayName: "工程工作区",
        capabilities: ["engineeringWorkbench", "generalFileContext"]
      }
    });

    expect(groups.projectActivities.map((activity) => activity.id)).toEqual(["workspace"]);
    expect(groups.bottomActivities.map((activity) => activity.id)).toEqual(["settings"]);
  });

  test("renders settings inside the central Editor Area and keeps Navigator, Agent Surface, and Status Bar mounted", () => {
    const application = createDesktopApplication();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        shellState={{ ...application.getShellState(), activeActivity: "settings" }}
        commands={application.listCommands()}
        commandPaletteOpen={false}
        settings={createSettingsProps()}
        onSettingsClose={() => undefined}
      />
    );

    // Settings form must be reachable
    expect(html).toContain('data-region="settings-workspace"');
    expect(html).toContain('aria-label="关闭设置"');
    expect(html).toContain('aria-label="打开命令面板"');
    // Shell chrome MUST remain mounted when settings is open
    expect(html).toContain('data-region="activity-bar"');
    expect(html).toContain('data-region="editor-area"');
    expect(html).toContain('data-region="ai-panel"');
    expect(html).toContain('data-region="status-bar"');
    // Settings workspace is nested inside the editor area, not floating above the whole shell
    const editorAreaStart = html.indexOf('data-region="editor-area"');
    const settingsStart = html.indexOf('data-region="settings-workspace"');
    expect(settingsStart).toBeGreaterThan(editorAreaStart);
    // Layout controls should not duplicate inside settings form
    expect(html).not.toContain('aria-label="切换 Split View"');
  });

  test("closes the settings workspace from its close button and Escape", async () => {
    const application = createDesktopApplication();
    const calls: string[] = [];
    const host = document.createElement("div");
    document.body.append(host);
    let root: Root | undefined;

    await act(async () => {
      root = createRoot(host);
      root.render(
        <WorkspaceShell
          shellState={{ ...application.getShellState(), activeActivity: "settings" }}
          commands={application.listCommands()}
          commandPaletteOpen={false}
          settings={createSettingsProps()}
          onSettingsClose={() => calls.push("close")}
        />
      );
    });

    await act(async () => {
      host
        .querySelector<HTMLButtonElement>('button[aria-label="关闭设置"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(calls).toEqual(["close"]);

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(calls).toEqual(["close", "close"]);

    await act(async () => root?.unmount());
    host.remove();
  });

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
    expect(css).toContain('.ns-shell[data-theme="ink-gold"]');
    expect(css).toContain('.ns-shell[data-theme="ink-gold"][data-accent="blue"]');
    expect(css).toContain('.ns-shell[data-theme="ink-gold"][data-accent="amber"]');
    expect(css).toContain("--ns-gilded-accent: linear-gradient");
    expect(css).toContain('.ns-shell[data-accent="blue"]');
    expect(css).toContain('.ns-shell[data-accent="amber"]');

    const accentScopes = [
      ...css.matchAll(/\.ns-shell\[data-accent="(?:blue|amber)"\]\s*\{([^}]*)\}/g)
    ]
      .map((match) => match[1])
      .join("\n");
    expect(accentScopes).not.toMatch(/--ns-(?:danger|warning|success|info)/);
  });

  test("applies the ink-gold theme value to the workbench root", () => {
    const application = createDesktopApplication();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        appearancePreferences={{ theme: "ink-gold", accentColor: "teal" }}
        shellState={application.getShellState()}
        commands={application.listCommands()}
        commandPaletteOpen={false}
      />
    );

    expect(html).toContain('data-theme="ink-gold"');
  });

  test("positions find replace as a responsive editor overlay", () => {
    const css = readFileSync(join(process.cwd(), "packages", "ui", "src", "styles.css"), "utf8");

    expect(css).toMatch(/\.ns-editor-surface,\s*\.ns-editor-layout\s*\{[^}]*position:\s*relative/s);
    expect(css).toMatch(
      /\.ns-editor-find-replace\s*\{[^}]*display:\s*grid[^}]*position:\s*absolute[^}]*right:\s*8px[^}]*top:\s*8px[^}]*width:\s*420px[^}]*z-index:\s*30/s
    );
    expect(css).toMatch(
      /@media\s*\(max-width:\s*520px\)[\s\S]*?\.ns-editor-find-replace\s*\{[^}]*left:\s*8px[^}]*right:\s*8px[^}]*width:\s*auto/s
    );
  });

  test("collapses Bottom Panel, then Navigator, then Agent on narrow workspaces", () => {
    const css = readFileSync(join(process.cwd(), "packages", "ui", "src", "styles.css"), "utf8");
    const narrowStart = css.indexOf("@media (max-width: 1279px)");
    const nextMediaStart = css.indexOf("@media", narrowStart + 1);
    const narrowWorkspace = css.slice(
      narrowStart,
      nextMediaStart === -1 ? undefined : nextMediaStart
    );

    expect(narrowStart).toBeGreaterThanOrEqual(0);
    expect(narrowWorkspace).toMatch(
      /\[data-agent-conversation="true"\]\[data-focus-mode="false"\][^{]*\.ns-agent-conversation-navigator-region[^{]*\{[^}]*display:\s*none/s
    );
    expect(narrowWorkspace).toMatch(
      /\[data-agent-conversation="true"\]\[data-focus-mode="false"\][^{]*\.ns-ai-panel\s*\{[^}]*display:\s*grid/s
    );
    expect(narrowWorkspace).toMatch(
      /\.ns-workspace-grid\[data-focus-mode="true"\]\s*\{[^}]*grid-template-areas:\s*"editor"[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s
    );
    expect(narrowWorkspace).toMatch(/\.ns-bottom-panel\s*\{[^}]*display:\s*none/s);
    expect(narrowWorkspace).toMatch(
      /grid-template-columns:\s*48px\s+minmax\(180px,\s*250px\)\s+4px\s+minmax\(0,\s*1fr\)\s+4px\s+minmax\(280px/s
    );
    expect(narrowWorkspace).not.toMatch(
      /\.ns-ai-panel,\s*\.ns-resize-handle-ai\s*\{[^}]*display:\s*none/s
    );
    expect(css).toMatch(
      /@media\s*\(max-width:\s*900px\)[\s\S]*?\.ns-navigator-context[^}]*display:\s*none/s
    );
    expect(css).toMatch(
      /@media\s*\(max-width:\s*900px\)[\s\S]*?\.ns-navigator,\s*\.ns-navigator-context[^}]*display:\s*none/s
    );
    expect(css).toMatch(
      /@media\s*\(max-width:\s*760px\)[\s\S]*?\.ns-ai-panel[^}]*display:\s*none/s
    );
    expect(css).toMatch(/\.ns-ai-panel\s*\{[^}]*min-width:\s*280px/s);
  });

  test("disables non-essential transitions and animations under prefers-reduced-motion", () => {
    const css = readFileSync(join(process.cwd(), "packages", "ui", "src", "styles.css"), "utf8");
    const reduceMotionBlocks = [
      ...css.matchAll(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([^}]*\{[^}]*\}[^}]*)\}/gs)
    ];
    const combined = reduceMotionBlocks.map((match) => match[0]).join("\n");

    // Must broadly disable animation/transition duration, not just target a single component.
    expect(combined).toMatch(/\*[^{]*\{[^}]*transition-duration:\s*0\.01ms\s*!important/s);
    expect(combined).toMatch(/\*[^{]*\{[^}]*animation-duration:\s*0\.01ms\s*!important/s);
    expect(combined).toMatch(/animation-iteration-count:\s*1\s*!important/s);
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
    expect(html).toContain('aria-label="工作区导航"');
    expect(html).toContain('aria-label="编辑区"');
    expect(html).toContain('aria-label="AI 对话面板"');
    expect(html).toContain('aria-label="状态栏"');
    expect(html).toContain('aria-label="Navigator resize handle"');
    expect(html).toContain('aria-label="AI panel resize handle"');
    expect(html).not.toContain('aria-label="Novel Studio asset groups"');
    // Unbound Agent must render the FULL Agent Conversation View (Composer included, inert),
    // not a placeholder message. This proves the Agent shell never disappears pre-binding.
    expect(html).toContain('aria-label="Agent 会话主视图"');
    expect(html).toContain('aria-label="会话输入区"');
    expect(html).not.toContain('aria-label="Agent 未绑定工作区"');
    expect(html).not.toContain('aria-label="AI 写作工作流"');
    expect(html).not.toContain("Markdown");
  });

  test("keeps one complete inert Agent surface mounted before any workspace is bound", () => {
    const application = createDesktopApplication();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        shellState={{
          ...application.getShellState(),
          workspaceContext: { kind: "none" }
        }}
        commands={application.listCommands()}
        commandPaletteOpen={false}
      />
    );

    // Exactly one Agent Conversation View and one composer region, always present.
    expect(html.match(/aria-label="Agent 会话主视图"/g) ?? []).toHaveLength(1);
    expect(html.match(/aria-label="会话输入区"/g) ?? []).toHaveLength(1);
    // The Composer stays visible but inert; first-run conversation creation is not a UI gate.
    expect(html).toMatch(/aria-label="启动 Agent 运行"[^>]*disabled/);
    expect(html).not.toContain('aria-label="新建会话"');
    // No virtual conversation/run should ever be synthesized for the unbound state.
    expect(html).not.toContain("prj_minimal_chapter");
  });

  test("renders compact status for the active chapter only", () => {
    const application = createDesktopApplication();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        shellState={{ ...application.getShellState(), saveStatus: "Unsaved" }}
        commands={application.listCommands()}
        commandPaletteOpen={false}
        chapterEditor={{
          chapter: {
            frontmatter: {
              schemaVersion: "1.0",
              id: "ch_status",
              type: "chapter",
              title: "Status Chapter",
              order: 1,
              status: "draft",
              createdAt: "2026-07-07T00:00:00.000Z",
              updatedAt: "2026-07-07T00:00:00.000Z"
            },
            body: "她走进雨里。\nA quiet room waits."
          },
          saveStatus: "Saved",
          dirty: false,
          versionHistory: [],
          runtime: {
            runtimeId: "codemirror",
            adapterLabel: "CodeMirror 6 Runtime",
            documentMode: "Markdown",
            activeRangeLabel: "Lines 1-2",
            cursorPositionLabel: "行 2，列 3",
            autosaveLabel: "Autosave armed",
            shortcutProfileLabel: "Default shortcuts",
            warnings: []
          }
        }}
      />
    );
    const statusBar = html.slice(html.indexOf('data-region="status-bar"'));

    expect(statusBar).toContain("已保存");
    expect(statusBar).toContain("9 字");
    expect(statusBar).toContain("约 1 分钟阅读");
    expect(statusBar).toContain("行 2，列 3");
    expect(statusBar).toContain("Markdown");
    expect(statusBar).not.toContain("Status Chapter");
    expect(statusBar).not.toContain("AI");
    expect(statusBar).not.toContain("CodeMirror");
    expect(statusBar).not.toContain("Default shortcuts");
  });

  test("hides document status outside editor activities", () => {
    const application = createDesktopApplication();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        shellState={{ ...application.getShellState(), activeActivity: "search" }}
        commands={application.listCommands()}
        commandPaletteOpen={false}
        chapterEditor={{
          chapter: {
            frontmatter: {
              schemaVersion: "1.0",
              id: "ch_hidden_status",
              type: "chapter",
              title: "Hidden Status",
              order: 1,
              status: "draft",
              createdAt: "2026-07-07T00:00:00.000Z",
              updatedAt: "2026-07-07T00:00:00.000Z"
            },
            body: "Hidden while searching"
          },
          saveStatus: "Saved",
          dirty: false,
          versionHistory: []
        }}
      />
    );

    // The Status Bar chrome stays mounted (design point 8: hidden only via explicit
    // collapse/focus/narrow layout, never as a side effect of navigating elsewhere),
    // but it must not leak document-specific status while outside an editor activity.
    expect(html).toContain('data-region="status-bar"');
    expect(html).not.toContain("Hidden Status");
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
    expect(html).toContain('title="搜索项目或运行命令 Ctrl/Cmd+K"');
    expect(html).toContain('aria-label="打开的文档"');
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
        onSave: () => calls.push("save"),
        onClose: () => calls.push("close")
      }
    });

    findElementByAriaLabel(tree, "保存当前文档")?.props.onClick?.();
    findElementByAriaLabel(tree, "关闭文档：scene.md")?.props.onClick?.();
    const html = renderToStaticMarkup(tree);

    expect(calls).toEqual(["save", "close"]);
    expect(html).toContain('aria-label="普通文件编辑器"');
    expect(html).toContain('aria-label="scene.md"');
    expect(html).not.toContain("notes/scene.md");
    expect(html).toContain('aria-label="普通文件正文"');
    expect(html).toContain('data-runtime-id="codemirror"');
    expect(html).not.toContain('class="ns-editor-header"');
    expect(html).not.toContain('aria-label="编辑器工具栏"');
    expect(html).not.toContain('aria-label="鐗堟湰鍘嗗彶"');
    expect(html).not.toContain("Selection review");
  });

  test("opens shared find and replace for an ordinary file and restores focus", async () => {
    const application = createDesktopApplication();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    try {
      await act(async () => {
        root.render(
          <WorkspaceShell
            shellState={application.getShellState()}
            commands={application.listCommands()}
            commandPaletteOpen={false}
            fileEditor={{
              path: "notes/scene.md",
              fileName: "scene.md",
              content: "Moon over moon.",
              dirty: false,
              saveStatus: "Saved",
              onContentChange: () => undefined
            }}
          />
        );
      });

      await act(async () => {
        host
          .querySelector<HTMLButtonElement>('[aria-label="查找当前文档"]')
          ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(host.querySelector('[aria-label="查找替换"]')).not.toBeNull();
      expect(host.querySelector('[aria-label="替换为"]')).toBeNull();

      const content = host.querySelector<HTMLElement>(".cm-content");
      expect(content?.textContent).toBe("Moon over moon.");
      expect(host.querySelector(".ns-file-editor-body textarea")).toBeNull();
      await act(async () => {
        content?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "h", ctrlKey: true, bubbles: true })
        );
      });
      expect(host.querySelector('[aria-label="替换为"]')).not.toBeNull();

      await act(async () => {
        host
          .querySelector<HTMLElement>('[aria-label="查找替换"]')
          ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      });
      expect(host.querySelector('[aria-label="查找替换"]')).toBeNull();
      expect(document.activeElement).toBe(content);

      await act(async () => {
        host
          .querySelector<HTMLButtonElement>('[aria-label="查找当前文档"]')
          ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      const query = host.querySelector<HTMLInputElement>('[aria-label="查找内容"]');
      await act(async () => {
        const valueSetter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value"
        )?.set;
        valueSetter?.call(query, "Moon");
        query?.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => {
        host
          .querySelector<HTMLButtonElement>('[aria-label="下一处"]')
          ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(host.querySelector('[data-region="status-bar"]')?.textContent).toContain(
        "已选择 4 字"
      );
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  test("moves an available selection AI command into the document bar", () => {
    const application = createDesktopApplication();
    const commands: string[] = [];
    const tree = WorkspaceShell({
      shellState: application.getShellState(),
      commands: application.listCommands(),
      commandPaletteOpen: false,
      chapterEditor: {
        chapter: {
          frontmatter: {
            schemaVersion: "1.0",
            id: "ch_selection",
            type: "chapter",
            title: "Selection",
            order: 1,
            status: "draft",
            createdAt: "2026-07-07T00:00:00.000Z",
            updatedAt: "2026-07-07T00:00:00.000Z"
          },
          body: "Selection body"
        },
        saveStatus: "Unsaved",
        dirty: true,
        versionHistory: [],
        runtime: {
          runtimeId: "codemirror",
          adapterLabel: "CodeMirror 6 Runtime",
          documentMode: "Markdown",
          activeRangeLabel: "Selection 0-9",
          cursorPositionLabel: "已选择 9 字",
          selectionAiPreviewCommand: {
            commandId: "editor.ai.preview-selection",
            label: "Preview selection rewrite"
          },
          autosaveLabel: "Autosave armed",
          shortcutProfileLabel: "Default shortcuts",
          warnings: []
        },
        onSelectionAiPreview: (commandId) => commands.push(commandId)
      }
    });

    findElementByAriaLabel(tree, "Preview selection rewrite")?.props.onClick?.();
    expect(commands).toEqual(["editor.ai.preview-selection"]);
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
          projectTitleInput: "Novel",
          projectFolderNameInput: "Novel",
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
          onProjectTitleChange: () => undefined,
          onProjectFolderNameChange: () => undefined,
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
    const legacyActivityId = ["a", "i"].join("");
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
    expect(html).toContain('aria-label="创作系统"');
    expect(html).toContain('aria-label="设置"');
    expect(html).toContain('data-activity-id="workspace"');
    expect(html).not.toContain(`data-activity-id="${legacyActivityId}"`);
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
          entryCount: 5,
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
            },
            {
              id: "story.foreshadow:fsh_018f12a7b91c4a2f9437c3d764e9a120",
              type: "story.foreshadow",
              title: "旧钥匙的来源",
              snippet: "第一章出现的旧钥匙将在第五章揭示来源。",
              score: 2,
              sourceRef: {
                kind: "story-asset",
                id: "fsh_018f12a7b91c4a2f9437c3d764e9a120",
                relativePath: "foreshadows/fsh_018f12a7b91c4a2f9437c3d764e9a120.json"
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
    expect(html).toContain("索引条目 5");
    expect(html).toContain("开篇");
    expect(html).toContain("chapters/ch_opening.md");
    expect(html).toContain("The hero keeps a hidden oath.");
    expect(html).toContain("<span>伏笔</span>");
    expect(html).toContain("foreshadows/fsh_018f12a7b91c4a2f9437c3d764e9a120.json");
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

    expect(html).toContain('aria-label="章节编辑器"');
    expect(html).toContain('data-dirty="true"');
    expect(html).toContain("版本历史");
    expect(html).toContain("AI suggestion");
  });

  test("renders the focused creative navigator for a creative project context", () => {
    const application = createDesktopApplication();
    const storyBibleEditor = createStoryBibleEditorProps({
      entries: [
        {
          id: "character_lin",
          kind: "character",
          assetType: "character",
          title: "林照月",
          status: "active",
          summary: "开篇出现。",
          aliases: [],
          relatedEntityIds: [],
          details: { role: "主角" },
          createdAt: "2026-07-05T00:00:00.000Z",
          updatedAt: "2026-07-05T00:00:00.000Z"
        }
      ],
      draft: {
        kind: "character",
        assetType: "character",
        title: "林照月",
        summary: "开篇出现。",
        status: "active",
        aliases: [],
        relatedEntityIds: [],
        details: { role: "主角" }
      }
    });
    const html = renderToStaticMarkup(
      <WorkspaceShell
        shellState={{
          ...application.getShellState(),
          projectTitle: "长安旧梦",
          workspaceContext: {
            kind: "creativeProject",
            workspaceId: "workspace_1",
            projectId: "project_1",
            displayName: "长安旧梦",
            capabilities: ["creativeWorkbench", "writingContext"]
          },
          creativeNavigatorMode: "writing"
        }}
        commands={application.listCommands()}
        commandPaletteOpen={false}
        creativeNavigator={{
          projectTitle: "长安旧梦",
          mode: "writing",
          searchQuery: "",
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
          dirtyChapterIds: ["ch_opening"],
          storyBible: storyBibleEditor,
          onModeSelect: () => undefined,
          onSearchQueryChange: () => undefined,
          onCreateChapter: () => undefined,
          onChapterOpen: () => undefined,
          onChapterRename: () => undefined,
          onChapterDuplicate: () => undefined,
          onChapterDelete: () => undefined,
          onStoryKindOpen: () => undefined
        }}
        projectWorkflow={{
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
          onProjectTitleChange: () => undefined,
          onProjectFolderNameChange: () => undefined,
          onOpenProject: () => undefined,
          onCreateProject: () => undefined,
          onCreateChapter: () => undefined,
          onSelectChapter: () => undefined
        }}
        storyBibleEditor={storyBibleEditor}
      />
    );

    expect(html).toContain('role="tab"');
    expect(html).toContain("写作");
    expect(html).toContain("故事资料");
    expect(html).toContain('aria-label="新建章节"');
    expect(html).toContain('data-chapter-id="ch_opening"');
    expect(html).toContain("未保存");
    expect(html).toContain("开篇");
    expect(html).not.toContain('aria-label="项目标题"');
    expect(html).not.toContain("Novel Studio");
    expect(html).not.toContain("提示词");
    expect(html).not.toContain('data-navigator-type-icon="section:workflows"');
  });

  test("renders onboarding quick start actions and invokes callbacks", () => {
    const application = createDesktopApplication();
    const calls: string[] = [];
    const tree = WorkspaceShell({
      shellState: { ...application.getShellState(), inspectorCollapsed: false },
      commands: application.listCommands(),
      commandPaletteOpen: false,
      projectWorkflow: {
        projectTitleInput: "Example",
        projectFolderNameInput: "Example",
        chapters: [],
        onProjectTitleChange: () => undefined,
        onProjectFolderNameChange: () => undefined,
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
        contextWindow: "",
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

  test("renders AI selection review controls in the central area", () => {
    const application = createDesktopApplication();
    const calls: string[] = [];
    const tree = WorkspaceShell({
      shellState: {
        ...application.getShellState(),
        inspectorCollapsed: false,
        workspaceContext: {
          kind: "creativeProject",
          workspaceId: "project-selection-review",
          projectId: "project-selection-review",
          displayName: "Selection Review",
          capabilities: ["creativeWorkbench", "writingContext"]
        }
      },
      commands: application.listCommands(),
      commandPaletteOpen: false,
      agentConversationWorkspace: {
        navigator: emptyConversationNavigator(),
        view: emptyConversationView(),
        mainReview: {
          kind: "selection",
          props: {
            status: "pending",
            originalText: "Opening line.",
            proposedText: "The opening line tightened.",
            rangeLabel: "0-13",
            compareLabel: "Opening line. -> The opening line tightened.",
            canUndo: true,
            onAccept: () => calls.push("accept"),
            onReject: () => calls.push("reject"),
            onUndo: () => calls.push("undo")
          }
        }
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
        projectTitleInput: "M34",
        projectFolderNameInput: "M34",
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
        openChapterTabIds: ["ch_opening", "ch_second"],
        activeChapterId: "ch_opening",
        onProjectTitleChange: () => undefined,
        onProjectFolderNameChange: () => undefined,
        onOpenProject: () => undefined,
        onCreateProject: () => undefined,
        onCreateChapter: () => undefined,
        onSelectChapter: (chapterId) => selectedChapters.push(chapterId)
      }
    });
    const secondTab = findElementByAriaLabel(tree, "第二章.md");

    expect(secondTab).toBeDefined();
    expect(secondTab?.props.disabled).toBeUndefined();
    secondTab?.props.onClick?.();
    expect(selectedChapters).toEqual(["ch_second"]);

    const html = renderToStaticMarkup(tree);
    expect(html).toContain('aria-label="文档标签"');
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
    const command = findElementByAriaLabel(tree, "执行命令：Audit Outline");

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
        projectTitleInput: "M37",
        projectFolderNameInput: "M37",
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
        onProjectTitleChange: () => undefined,
        onProjectFolderNameChange: () => undefined,
        onOpenProject: () => undefined,
        onCreateProject: () => undefined,
        onCreateChapter: () => undefined,
        onSelectChapter: () => undefined,
        onCloseChapterTab: (chapterId) => closedTabs.push(chapterId)
      }
    });
    const closeSecond = findElementByAriaLabel(tree, "关闭文档：第二章.md");

    expect(closeSecond).toBeDefined();
    closeSecond?.props.onClick?.();
    expect(closedTabs).toEqual(["ch_second"]);

    const html = renderToStaticMarkup(tree);
    expect(html).toContain("开篇");
    expect(html).toContain("第二章");
    expect(html).toContain('data-dirty="true"');
    expect(html).toContain('aria-label="关闭文档：第二章.md"');
    expect(html).not.toContain('aria-label="切换文档：第三章.md"');
    expect(html).not.toContain('aria-label="关闭文档：第三章.md"');
  });

  test("renders only explicitly opened chapter documents with markdown labels", () => {
    const application = createDesktopApplication();
    const projectWorkflow = {
      projectTitleInput: "M37",
      projectFolderNameInput: "M37",
      chapters: [
        {
          id: "ch_opening",
          title: "开篇",
          order: 1,
          status: "draft" as const,
          updatedAt: "2026-07-04T00:00:00.000Z"
        },
        {
          id: "ch_second",
          title: "第二章",
          order: 2,
          status: "draft" as const,
          updatedAt: "2026-07-04T00:00:00.000Z"
        },
        {
          id: "ch_third",
          title: "第三章",
          order: 3,
          status: "draft" as const,
          updatedAt: "2026-07-04T00:00:00.000Z"
        }
      ],
      activeChapterId: "ch_opening",
      onProjectTitleChange: () => undefined,
      onProjectFolderNameChange: () => undefined,
      onOpenProject: () => undefined,
      onCreateProject: () => undefined,
      onCreateChapter: () => undefined,
      onSelectChapter: () => undefined
    };
    const explicitHtml = renderToStaticMarkup(
      <WorkspaceShell
        shellState={application.getShellState()}
        commands={application.listCommands()}
        commandPaletteOpen={false}
        projectWorkflow={{ ...projectWorkflow, openChapterTabIds: ["ch_opening"] }}
      />
    );
    const implicitHtml = renderToStaticMarkup(
      <WorkspaceShell
        shellState={application.getShellState()}
        commands={application.listCommands()}
        commandPaletteOpen={false}
        projectWorkflow={projectWorkflow}
      />
    );

    expect(explicitHtml).toContain("开篇.md");
    expect(explicitHtml).not.toContain("第二章.md");
    expect(explicitHtml).not.toContain("第三章.md");
    expect(implicitHtml).not.toContain('class="ns-document-tab"');
  });

  test("renders the runtime-loaded chapter while workflow tab metadata is initializing", () => {
    const application = createDesktopApplication();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        shellState={application.getShellState()}
        commands={application.listCommands()}
        commandPaletteOpen={false}
        projectWorkflow={{
          projectTitleInput: "Startup",
          projectFolderNameInput: "Startup",
          chapters: [],
          openChapterTabIds: [],
          activeChapterId: "ch_first",
          onProjectTitleChange: () => undefined,
          onProjectFolderNameChange: () => undefined,
          onOpenProject: () => undefined,
          onCreateProject: () => undefined,
          onCreateChapter: () => undefined,
          onSelectChapter: () => undefined
        }}
        chapterEditor={{
          chapter: {
            frontmatter: {
              schemaVersion: "1.0",
              id: "ch_first",
              type: "chapter",
              title: "第一章",
              order: 1,
              status: "draft",
              createdAt: "2026-07-04T00:00:00.000Z",
              updatedAt: "2026-07-04T00:00:00.000Z"
            },
            body: "这是第一章的正文。"
          },
          saveStatus: "Saved",
          dirty: false,
          versionHistory: []
        }}
      />
    );

    expect(html).toContain('aria-label="第一章.md"');
    expect(html.match(/class="ns-document-tab"/g)).toHaveLength(1);
  });

  test("routes available autosave recovery drafts to the central review", () => {
    const application = createDesktopApplication();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        shellState={{ ...application.getShellState(), inspectorCollapsed: false }}
        commands={application.listCommands()}
        commandPaletteOpen={false}
        projectWorkflow={{
          projectTitleInput: "M38",
          projectFolderNameInput: "M38",
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
          onProjectTitleChange: () => undefined,
          onProjectFolderNameChange: () => undefined,
          onOpenProject: () => undefined,
          onCreateProject: () => undefined,
          onCreateChapter: () => undefined,
          onSelectChapter: () => undefined
        }}
      />
    );

    expect(html).toContain('aria-label="章节恢复审阅"');
    expect(html).not.toContain('aria-label="Autosave recovery"');
    expect(html).not.toContain('aria-label="预览恢复草稿：Opening"');
    expect(html).not.toContain('aria-label="应用恢复草稿：Opening"');
    expect(html).not.toContain('aria-label="丢弃恢复草稿：Opening"');
    expect(html).toContain("章节草稿恢复");
    expect(html).toContain("Opening");
    expect(html).toContain('aria-label="预览恢复草稿"');
    expect(html).toContain('aria-label="应用恢复草稿"');
    expect(html).toContain('aria-label="丢弃恢复草稿"');
  });

  test("renders recovery review preview, apply, and discard actions", () => {
    const application = createDesktopApplication();
    const calls: string[] = [];
    const tree = WorkspaceShell({
      shellState: application.getShellState(),
      commands: application.listCommands(),
      commandPaletteOpen: false,
      projectWorkflow: {
        projectTitleInput: "M49",
        projectFolderNameInput: "M49",
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
        onProjectTitleChange: () => undefined,
        onProjectFolderNameChange: () => undefined,
        onOpenProject: () => undefined,
        onCreateProject: () => undefined,
        onCreateChapter: () => undefined,
        onSelectChapter: () => undefined,
        onPreviewRecoveryDraft: (sessionId) => calls.push(`preview:${sessionId}`),
        onApplyRecoveryDraft: (sessionId) => calls.push(`apply:${sessionId}`),
        onDiscardRecoveryDraft: (sessionId) => calls.push(`discard:${sessionId}`)
      }
    });

    findElementByAriaLabel(tree, "预览恢复草稿")?.props.onClick?.();
    findElementByAriaLabel(tree, "应用恢复草稿")?.props.onClick?.();
    findElementByAriaLabel(tree, "丢弃恢复草稿")?.props.onClick?.();

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

  test("keeps Story Bible summaries out of the unique Agent surface", () => {
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

    expect(html).toContain('aria-label="AI 对话面板"');
    expect(html).not.toContain('aria-label="故事圣经摘要"');
    expect(html).not.toContain("Hero");
    expect(html).not.toContain("Oath");
    expect(html).not.toContain("可进入上下文");
  });

  test("renders a focused Story Bible list without duplicate category tabs or entry aside", () => {
    const application = createDesktopApplication();
    const openedEntries: string[] = [];
    const createdKinds: string[] = [];
    const tree = WorkspaceShell({
      shellState: { ...application.getShellState(), activeActivity: "storyBible" },
      commands: application.listCommands(),
      commandPaletteOpen: false,
      storyBibleEditor: createStoryBibleEditorProps({
        entries: [
          {
            id: "chr_hero",
            kind: "character",
            assetType: "character",
            title: "Hero",
            status: "active",
            summary: "A procedural protagonist with a hidden oath.",
            aliases: ["Oath bearer"],
            relatedEntityIds: [],
            details: {},
            createdAt: "2026-07-05T00:00:00.000Z",
            updatedAt: "2026-07-06T00:00:00.000Z"
          },
          {
            id: "world_capital",
            kind: "world",
            assetType: "world.location",
            title: "Capital",
            status: "active",
            summary: "The old capital.",
            aliases: [],
            relatedEntityIds: [],
            details: {},
            createdAt: "2026-07-05T00:00:00.000Z",
            updatedAt: "2026-07-05T00:00:00.000Z"
          }
        ],
        onEntrySelect: (entryId) => openedEntries.push(entryId),
        onNewDraft: () => createdKinds.push("character")
      })
    });
    const openHero = findElementByAriaLabel(tree, "打开人物：Hero");
    const createCharacter = findElementByAriaLabel(tree, "新建人物");

    openHero?.props.onClick?.();
    createCharacter?.props.onClick?.();
    const html = renderToStaticMarkup(tree);

    expect(openedEntries).toEqual(["chr_hero"]);
    expect(createdKinds).toEqual(["character"]);
    expect(html).toContain('aria-label="人物列表"');
    expect(html).toContain('aria-label="搜索人物"');
    expect(html).toContain('aria-label="筛选资料状态"');
    expect(html.match(/aria-label="新建人物"/gu)).toHaveLength(1);
    expect(html).toContain("Hero");
    expect(html).not.toContain("Capital");
    expect(html).not.toContain('aria-label="故事圣经分类"');
    expect(html).not.toContain('aria-label="故事圣经编辑器"');
  });

  test("renders character identity and summary columns without expanding the category surface", () => {
    const application = createDesktopApplication();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        shellState={{ ...application.getShellState(), activeActivity: "storyBible" }}
        commands={application.listCommands()}
        commandPaletteOpen={false}
        storyBibleEditor={createStoryBibleEditorProps({
          entries: [
            {
              id: "chr_hero",
              kind: "character",
              assetType: "character",
              title: "林舟",
              status: "active",
              summary: "为查清旧案进入王都。",
              aliases: ["阿舟"],
              relatedEntityIds: [],
              details: { role: "主角" },
              createdAt: "2026-07-05T00:00:00.000Z",
              updatedAt: "2026-07-06T00:00:00.000Z"
            }
          ]
        })}
      />
    );

    expect(html).toContain('data-story-list-kind="character"');
    expect(html).toContain("姓名");
    expect(html).toContain("身份定位");
    expect(html).toContain("主角");
    expect(html).toContain("为查清旧案进入王都。");
  });

  test("renders focused character fields and keeps secondary settings collapsed", () => {
    const application = createDesktopApplication();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        shellState={{ ...application.getShellState(), activeActivity: "storyBible" }}
        commands={application.listCommands()}
        commandPaletteOpen={false}
        storyBibleEditor={createStoryBibleEditorProps({
          viewMode: "detail",
          chapterOptions: [{ id: "ch_01", title: "第一章", order: 1, status: "draft" }],
          draft: {
            id: "chr_hero",
            kind: "character",
            assetType: "character",
            title: "林舟",
            summary: "为查清旧案进入王都。",
            status: "active",
            aliases: ["阿舟"],
            relatedEntityIds: ["chr_friend"],
            details: {
              role: "主角",
              goals: ["查清旧案", "接受自己的身世"],
              conflicts: ["忠诚与真相不可兼得"],
              arc: {
                start: "逃避责任",
                turningPoints: ["发现老师隐瞒真相"],
                end: "主动承担后果"
              },
              appearanceChapterIds: ["ch_01"]
            }
          }
        })}
      />
    );

    for (const label of [
      "人物姓名",
      "身份定位",
      "人物简介",
      "外在目标",
      "内在目标",
      "主要冲突",
      "人物弧起点",
      "人物弧转折",
      "人物弧目标状态",
      "关联章节"
    ]) {
      expect(html).toContain(`aria-label="${label}"`);
    }
    expect(html).toContain("补充设定");
    expect(html).toContain("第一章");
  });

  test("filters one world list and requires an existing world type before creation", () => {
    const application = createDesktopApplication();
    const createdTypes: string[] = [];
    const tree = WorkspaceShell({
      shellState: { ...application.getShellState(), activeActivity: "storyBible" },
      commands: application.listCommands(),
      commandPaletteOpen: false,
      storyBibleEditor: createStoryBibleEditorProps({
        activeKind: "world",
        filters: {
          query: "",
          status: "all",
          worldAssetType: "world.location",
          foreshadowTrackingStatus: "all"
        },
        entries: [
          {
            id: "loc_capital",
            kind: "world",
            assetType: "world.location",
            title: "王都",
            status: "active",
            summary: "帝国中枢。",
            aliases: [],
            relatedEntityIds: [],
            details: { geography: "河谷平原" },
            createdAt: "2026-07-05T00:00:00.000Z",
            updatedAt: "2026-07-06T00:00:00.000Z"
          },
          {
            id: "fac_council",
            kind: "world",
            assetType: "world.faction",
            title: "议政会",
            status: "active",
            summary: "控制王都议会。",
            aliases: [],
            relatedEntityIds: [],
            details: { goals: ["维持旧秩序"] },
            createdAt: "2026-07-05T00:00:00.000Z",
            updatedAt: "2026-07-06T00:00:00.000Z"
          }
        ],
        onNewDraft: (assetType) => createdTypes.push(assetType ?? "missing")
      })
    });

    findElementByAriaLabel(tree, "新建规则")?.props.onClick?.();
    expect(createdTypes).toEqual(["world.rule"]);

    const html = renderToStaticMarkup(tree);
    expect(html).toContain('aria-label="筛选世界观类型"');
    expect(html).toContain('aria-label="选择世界观类型"');
    expect(html).toContain('data-story-list-kind="world"');
    expect(html).toContain('data-story-entry-id="loc_capital"');
    expect(html).not.toContain('data-story-entry-id="fac_council"');
    expect(html).toContain("地点");
  });

  test("locks an existing world asset type and shows only its minimum fields", () => {
    const application = createDesktopApplication();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        shellState={{ ...application.getShellState(), activeActivity: "storyBible" }}
        commands={application.listCommands()}
        commandPaletteOpen={false}
        storyBibleEditor={createStoryBibleEditorProps({
          activeKind: "world",
          viewMode: "detail",
          draft: {
            id: "rule_magic",
            kind: "world",
            assetType: "world.rule",
            title: "回声法则",
            summary: "所有法术都会留下回声。",
            status: "active",
            aliases: [],
            relatedEntityIds: [],
            details: {
              rule: "法术会在原地重复一次。",
              scope: "王都结界内",
              constraints: ["重复回声不可再次触发"]
            }
          }
        })}
      />
    );

    expect(html).toMatch(/aria-label="世界观类型"[^>]*disabled/u);
    expect(html).toContain('aria-label="规则正文"');
    expect(html).toContain('aria-label="适用范围"');
    expect(html).toContain('aria-label="限制或例外"');
    expect(html).not.toContain('aria-label="地理"');
  });

  test("renders the outline in stored volume order with unassigned and missing chapters", () => {
    const application = createDesktopApplication();
    const tree = (
      <WorkspaceShell
        shellState={{ ...application.getShellState(), activeActivity: "storyBible" }}
        commands={application.listCommands()}
        commandPaletteOpen={false}
        storyBibleEditor={createStoryBibleEditorProps({
          activeKind: "outline",
          viewMode: "detail",
          chapterOptions: [
            { id: "ch_01", title: "雨夜入城", order: 1, status: "draft" },
            { id: "ch_02", title: "无名档案", order: 2, status: "draft" },
            { id: "ch_03", title: "旧证词", order: 3, status: "draft" }
          ],
          draft: {
            id: "outline_main",
            kind: "outline",
            assetType: "outline",
            title: "主线大纲",
            summary: "旧案逐层揭开。",
            status: "active",
            aliases: [],
            relatedEntityIds: [],
            details: {
              volumes: [
                {
                  id: "vol_02",
                  title: "第二卷",
                  summary: "进入王都核心。",
                  chapterIds: ["ch_02", "ch_missing"]
                },
                { id: "vol_01", title: "第一卷", chapterIds: ["ch_01"] }
              ],
              chapterOutlines: [
                { chapterId: "ch_missing", goal: "保留旧章纲", notes: "等待作者清理" }
              ]
            }
          }
        })}
      />
    );
    const html = renderToStaticMarkup(tree);
    const save = findElementByAriaLabel(tree, "保存设定");

    expect(html).toContain('aria-label="大纲卷章树"');
    expect(html.indexOf("第二卷")).toBeLessThan(html.indexOf("第一卷"));
    expect(html.indexOf("无名档案")).toBeLessThan(html.indexOf("章节已不存在"));
    expect(html).toContain("未归卷");
    expect(html).toContain("旧证词");
    expect(html).toContain("ch_missing");
    expect(html).toContain("无法保存大纲");
    expect(save?.props.disabled).toBe(true);
  });

  test("edits volumes and chapter outlines without discarding unknown nested fields", () => {
    const application = createDesktopApplication();
    const updates: Array<{ readonly kind: string; readonly patch: unknown }> = [];
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    act(() => {
      root.render(
        <WorkspaceShell
          shellState={{ ...application.getShellState(), activeActivity: "storyBible" }}
          commands={application.listCommands()}
          commandPaletteOpen={false}
          storyBibleEditor={createStoryBibleEditorProps({
            activeKind: "outline",
            viewMode: "detail",
            chapterOptions: [
              { id: "ch_01", title: "雨夜入城", order: 1, status: "draft" },
              { id: "ch_02", title: "无名档案", order: 2, status: "draft" }
            ],
            draft: {
              id: "outline_main",
              kind: "outline",
              assetType: "outline",
              title: "主线大纲",
              summary: "旧案逐层揭开。",
              status: "active",
              aliases: [],
              relatedEntityIds: [],
              details: {
                volumes: [
                  {
                    id: "vol_01",
                    title: "第一卷",
                    summary: "进入王都。",
                    chapterIds: ["ch_01"],
                    futureVolumeField: { kept: true }
                  }
                ],
                chapterOutlines: [
                  {
                    chapterId: "ch_01",
                    goal: "找到案卷",
                    futureChapterField: ["kept"]
                  }
                ]
              }
            },
            onDraftChange: (kind, patch) => updates.push({ kind, patch })
          })}
        />
      );
    });

    act(() => {
      host
        .querySelector<HTMLButtonElement>('[aria-label="打开卷：第一卷"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const volumeTitle = host.querySelector<HTMLInputElement>('[aria-label="卷名称"]');
    expect(volumeTitle).not.toBeNull();
    act(() => {
      if (volumeTitle !== null) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
          volumeTitle,
          "第一卷：入城"
        );
      }
      volumeTitle?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(updates.at(-1)).toMatchObject({
      kind: "outline",
      patch: {
        details: {
          volumes: [
            {
              id: "vol_01",
              title: "第一卷：入城",
              futureVolumeField: { kept: true }
            }
          ]
        }
      }
    });

    act(() => {
      host
        .querySelector<HTMLButtonElement>('[aria-label="加入章节到第一卷"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(updates.at(-1)).toMatchObject({
      patch: { details: { volumes: [{ chapterIds: ["ch_01", "ch_02"] }] } }
    });

    act(() => {
      host
        .querySelector<HTMLButtonElement>('[aria-label="打开章纲：雨夜入城"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host.querySelector('[aria-label="章纲目标"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="章纲冲突"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="章纲转折"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="章纲备注"]')).not.toBeNull();

    const chapterGoal = host.querySelector<HTMLTextAreaElement>('[aria-label="章纲目标"]');
    act(() => {
      if (chapterGoal !== null) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
          chapterGoal,
          "取得关键证词"
        );
      }
      chapterGoal?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(updates.at(-1)).toMatchObject({
      kind: "outline",
      patch: {
        details: {
          chapterOutlines: [
            {
              chapterId: "ch_01",
              goal: "取得关键证词",
              futureChapterField: ["kept"]
            }
          ]
        }
      }
    });

    act(() => root.unmount());
    host.remove();
  });

  test("adds and reorders volumes while moving real chapters in and out", () => {
    const application = createDesktopApplication();
    const updates: Array<{ readonly kind: string; readonly patch: unknown }> = [];
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    act(() => {
      root.render(
        <WorkspaceShell
          shellState={{ ...application.getShellState(), activeActivity: "storyBible" }}
          commands={application.listCommands()}
          commandPaletteOpen={false}
          storyBibleEditor={createStoryBibleEditorProps({
            activeKind: "outline",
            viewMode: "detail",
            chapterOptions: [
              { id: "ch_01", title: "雨夜入城", order: 1, status: "draft" },
              { id: "ch_02", title: "无名档案", order: 2, status: "draft" }
            ],
            draft: {
              id: "outline_main",
              kind: "outline",
              assetType: "outline",
              title: "主线大纲",
              summary: "",
              status: "active",
              aliases: [],
              relatedEntityIds: [],
              details: {
                volumes: [
                  { id: "vol_01", title: "第一卷", summary: "", chapterIds: ["ch_01"] },
                  { id: "vol_02", title: "第二卷", summary: "", chapterIds: [] }
                ],
                chapterOutlines: []
              }
            },
            onDraftChange: (kind, patch) => updates.push({ kind, patch })
          })}
        />
      );
    });

    act(() => host.querySelector<HTMLButtonElement>('[aria-label="新增卷"]')?.click());
    expect(updates.at(-1)).toMatchObject({
      patch: {
        details: {
          volumes: [
            { id: "vol_01" },
            { id: "vol_02" },
            { id: "vol_03", title: "第3卷", chapterIds: [] }
          ]
        }
      }
    });

    act(() => host.querySelector<HTMLButtonElement>('[aria-label="下移卷：第一卷"]')?.click());
    expect(updates.at(-1)).toMatchObject({
      patch: { details: { volumes: [{ id: "vol_02" }, { id: "vol_01" }] } }
    });

    act(() => host.querySelector<HTMLButtonElement>('[aria-label="打开卷：第二卷"]')?.click());
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="加入章节到第二卷"]')?.click());
    expect(updates.at(-1)).toMatchObject({
      patch: {
        details: {
          volumes: [
            { id: "vol_01", chapterIds: ["ch_01"] },
            { id: "vol_02", chapterIds: ["ch_02"] }
          ]
        }
      }
    });

    act(() => host.querySelector<HTMLButtonElement>('[aria-label="打开章纲：雨夜入城"]')?.click());
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="移出本卷：雨夜入城"]')?.click());
    expect(updates.at(-1)).toMatchObject({
      patch: {
        details: {
          volumes: [
            { id: "vol_01", chapterIds: [] },
            { id: "vol_02", chapterIds: [] }
          ]
        }
      }
    });

    act(() => root.unmount());
    host.remove();
  });

  test("renders the foreshadow tracker with chapter titles, status filtering, and overdue state", () => {
    const application = createDesktopApplication();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        shellState={{ ...application.getShellState(), activeActivity: "storyBible" }}
        commands={application.listCommands()}
        commandPaletteOpen={false}
        storyBibleEditor={createStoryBibleEditorProps({
          activeKind: "foreshadow",
          currentChapterId: "ch_03",
          chapterOptions: [
            { id: "ch_03", title: "真相迫近", order: 3, status: "draft" },
            { id: "ch_01", title: "雨夜入城", order: 1, status: "draft" },
            { id: "ch_02", title: "无名档案", order: 2, status: "draft" }
          ],
          filters: {
            query: "",
            status: "all",
            worldAssetType: "all",
            foreshadowTrackingStatus: "progressing"
          },
          entries: [
            {
              id: "fsh_key",
              kind: "foreshadow",
              assetType: "foreshadow",
              title: "生锈的钥匙",
              status: "active",
              summary: "钥匙会打开旧档案室。",
              aliases: [],
              relatedEntityIds: [],
              details: {
                trackingStatus: "progressing",
                plantedChapterId: "ch_01",
                plannedPayoffChapterId: "ch_02"
              },
              createdAt: "2026-07-05T00:00:00.000Z",
              updatedAt: "2026-07-06T00:00:00.000Z"
            },
            {
              id: "fsh_paid",
              kind: "foreshadow",
              assetType: "foreshadow",
              title: "已经回收的暗号",
              status: "active",
              summary: "",
              aliases: [],
              relatedEntityIds: [],
              details: {
                trackingStatus: "paid-off",
                actualPayoffChapterId: "ch_03"
              },
              createdAt: "2026-07-05T00:00:00.000Z",
              updatedAt: "2026-07-07T00:00:00.000Z"
            }
          ],
          draft: {
            kind: "foreshadow",
            assetType: "foreshadow",
            title: "",
            status: "active",
            summary: "",
            aliases: [],
            relatedEntityIds: [],
            details: { trackingStatus: "planned", origin: "manual" }
          }
        })}
      />
    );

    expect(html).toContain('aria-label="筛选伏笔跟踪状态"');
    for (const heading of ["跟踪状态", "埋设章", "计划回收章", "实际回收章", "更新"]) {
      expect(html).toContain(heading);
    }
    expect(html).toContain('data-story-entry-id="fsh_key"');
    expect(html).not.toContain('data-story-entry-id="fsh_paid"');
    expect(html).toContain("推进中");
    expect(html).toContain("逾期");
    expect(html).toContain("1. 雨夜入城");
    expect(html).toContain("2. 无名档案");
    expect(html).toContain("2026-07-06");
  });

  test("renders the focused foreshadow editor and blocks invalid or duplicate evidence", () => {
    const application = createDesktopApplication();
    const tree = (
      <WorkspaceShell
        shellState={{ ...application.getShellState(), activeActivity: "storyBible" }}
        commands={application.listCommands()}
        commandPaletteOpen={false}
        storyBibleEditor={createStoryBibleEditorProps({
          activeKind: "foreshadow",
          viewMode: "detail",
          currentChapterId: "ch_02",
          chapterOptions: [
            { id: "ch_02", title: "无名档案", order: 2, status: "draft" },
            { id: "ch_01", title: "雨夜入城", order: 1, status: "draft" }
          ],
          entries: [
            {
              id: "fsh_other",
              kind: "foreshadow",
              assetType: "foreshadow",
              title: "门后的人",
              status: "active",
              summary: "",
              aliases: [],
              relatedEntityIds: [],
              details: {
                trackingStatus: "planted",
                sourceRefs: [
                  {
                    chapterId: "ch_01",
                    excerpt: "他把钥匙收进袖口。",
                    excerptHash: "1".repeat(64)
                  }
                ]
              },
              createdAt: "2026-07-05T00:00:00.000Z",
              updatedAt: "2026-07-05T00:00:00.000Z"
            }
          ],
          draft: {
            id: "fsh_key",
            kind: "foreshadow",
            assetType: "foreshadow",
            title: "生锈的钥匙",
            status: "active",
            summary: "钥匙会打开旧档案室。",
            aliases: [],
            relatedEntityIds: ["loc_archive"],
            details: {
              trackingStatus: "paid-off",
              actualPayoffChapterId: "",
              sourceRefs: [
                {
                  chapterId: "ch_01",
                  excerpt: "  他把钥匙收进袖口。  ",
                  excerptHash: "2".repeat(64)
                }
              ],
              notes: "等待确认回收场景。"
            }
          }
        })}
      />
    );
    const html = renderToStaticMarkup(tree);
    const save = findElementByAriaLabel(tree, "保存设定");

    for (const label of [
      "伏笔标题",
      "伏笔跟踪状态",
      "伏笔摘要",
      "埋设章节",
      "计划回收章节",
      "实际回收章节",
      "伏笔备注",
      "伏笔关联资料 ID",
      "证据 1 章节",
      "证据 1 原文片段"
    ]) {
      expect(html).toContain(`aria-label="${label}"`);
    }
    for (const status of ["待埋", "已埋", "推进中", "待回收", "已回收", "已放弃"]) {
      expect(html).toContain(status);
    }
    expect(html.indexOf("1. 雨夜入城")).toBeLessThan(html.indexOf("2. 无名档案"));
    expect(html).toContain("无法保存伏笔");
    expect(html).toContain("必须选择实际回收章节");
    expect(html).toContain("已存在于伏笔“门后的人”");
    expect(save?.props.disabled).toBe(true);
  });

  test("renders the common Story Bible detail form", () => {
    const application = createDesktopApplication();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        shellState={{ ...application.getShellState(), activeActivity: "storyBible" }}
        commands={application.listCommands()}
        commandPaletteOpen={false}
        storyBibleEditor={createStoryBibleEditorProps({
          viewMode: "detail",
          entries: [
            {
              id: "chr_hero",
              kind: "character",
              assetType: "character",
              title: "Hero",
              status: "active",
              summary: "A procedural protagonist with a hidden oath.",
              aliases: [],
              relatedEntityIds: [],
              details: {},
              createdAt: "2026-07-05T00:00:00.000Z",
              updatedAt: "2026-07-05T00:00:00.000Z"
            }
          ],
          draft: {
            id: "chr_hero",
            kind: "character",
            assetType: "character",
            title: "Hero",
            summary: "A procedural protagonist with a hidden oath.",
            status: "active",
            aliases: ["Oath bearer"],
            relatedEntityIds: ["world_capital"],
            details: {},
            createdAt: "2026-07-05T00:00:00.000Z",
            updatedAt: "2026-07-06T00:00:00.000Z"
          }
        })}
      />
    );

    expect(html).toContain('aria-label="故事圣经"');
    expect(html).toContain('aria-label="故事圣经编辑器"');
    expect(html).toContain("人物");
    expect(html).not.toContain('aria-label="故事圣经分类"');
    expect(html).not.toContain("记忆");
    expect(html).toContain('aria-label="返回人物列表"');
    expect(html).toContain('aria-label="人物姓名"');
    expect(html).toContain('aria-label="人物简介"');
    expect(html).toContain('aria-label="资料状态"');
    expect(html).toContain('aria-label="资料别名"');
    expect(html).toContain('aria-label="关联人物与资料"');
    expect(html).toContain("保存设定");
    expect(html).toContain("Hero");
  });

  test("filters the Story Bible list and offers one clear action when nothing matches", () => {
    const application = createDesktopApplication();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        shellState={{ ...application.getShellState(), activeActivity: "storyBible" }}
        commands={application.listCommands()}
        commandPaletteOpen={false}
        storyBibleEditor={createStoryBibleEditorProps({
          filters: {
            query: "missing",
            status: "active",
            worldAssetType: "all",
            foreshadowTrackingStatus: "all"
          },
          entries: [
            {
              id: "chr_hero",
              kind: "character",
              assetType: "character",
              title: "Hero",
              status: "active",
              summary: "A procedural protagonist.",
              aliases: [],
              relatedEntityIds: [],
              details: {},
              createdAt: "2026-07-05T00:00:00.000Z",
              updatedAt: "2026-07-05T00:00:00.000Z"
            }
          ]
        })}
      />
    );

    expect(html).toContain("未找到匹配资料");
    expect(html).toContain("清除筛选");
    expect(html).not.toContain('data-story-entry-id="chr_hero"');
    expect(html.match(/清除筛选/gu)).toHaveLength(1);
  });

  test("routes Story Bible back and discard commands through separate callbacks", () => {
    const application = createDesktopApplication();
    const calls: string[] = [];
    const tree = WorkspaceShell({
      shellState: { ...application.getShellState(), activeActivity: "storyBible" },
      commands: application.listCommands(),
      commandPaletteOpen: false,
      storyBibleEditor: createStoryBibleEditorProps({
        viewMode: "detail",
        dirty: true,
        draft: {
          id: "chr_hero",
          kind: "character",
          assetType: "character",
          title: "Hero",
          summary: "Changed summary.",
          status: "active",
          aliases: [],
          relatedEntityIds: [],
          details: {}
        },
        onKindSelect: (kind) => calls.push(`back:${kind}`),
        onCancelDraft: () => calls.push("discard")
      })
    });

    findElementByAriaLabel(tree, "返回人物列表")?.props.onClick?.();
    findElementByAriaLabel(tree, "放弃修改")?.props.onClick?.();

    expect(calls).toEqual(["back:character", "discard"]);
  });

  test("renders Story Bible consistency warnings with jump actions", () => {
    const application = createDesktopApplication();
    const openedEntries: string[] = [];
    const tree = WorkspaceShell({
      shellState: { ...application.getShellState(), activeActivity: "storyBible" },
      commands: application.listCommands(),
      commandPaletteOpen: false,
      storyBibleEditor: createStoryBibleEditorProps({
        viewMode: "detail",
        entries: [
          {
            id: "chr_hero",
            kind: "character",
            assetType: "character",
            title: "Mira",
            status: "active",
            summary: "Mira is established as an only child.",
            aliases: [],
            relatedEntityIds: [],
            details: {},
            createdAt: "2026-07-05T00:00:00.000Z",
            updatedAt: "2026-07-05T00:00:00.000Z"
          },
          {
            id: "world_mira_family",
            kind: "world",
            assetType: "world.glossary",
            title: "Mira Family Rumor",
            status: "active",
            summary: "Conflict: Captain Mira has a younger brother in the capital.",
            aliases: [],
            relatedEntityIds: ["chr_hero"],
            details: {},
            createdAt: "2026-07-05T00:00:00.000Z",
            updatedAt: "2026-07-05T00:00:00.000Z"
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
          assetType: "character",
          title: "Mira",
          summary: "Mira is established as an only child.",
          status: "active",
          aliases: [],
          relatedEntityIds: [],
          details: {}
        },
        onEntrySelect: (entryId) => openedEntries.push(entryId)
      })
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
      storyBibleEditor: createStoryBibleEditorProps({
        activeKind: "timeline",
        viewMode: "list",
        entries: [
          {
            id: "timeline_main",
            kind: "timeline",
            assetType: "timeline.events",
            title: "主线时间线",
            status: "active",
            summary: "第一幕到第三幕的关键事件。",
            aliases: [],
            relatedEntityIds: [],
            details: {},
            createdAt: "2026-07-05T00:00:00.000Z",
            updatedAt: "2026-07-05T00:00:00.000Z",
            timelineEvents: []
          }
        ],
        draft: {
          kind: "timeline",
          assetType: "timeline.events",
          title: "主线时间线",
          summary: "第一幕到第三幕的关键事件。",
          status: "active",
          aliases: [],
          relatedEntityIds: [],
          details: {}
        }
      }),
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
    const openedEntries: string[] = [];
    const tree = (
      <WorkspaceShell
        shellState={{ ...application.getShellState(), activeActivity: "timeline" }}
        commands={application.listCommands()}
        commandPaletteOpen={false}
        storyBibleEditor={createStoryBibleEditorProps({
          activeKind: "timeline",
          viewMode: "list",
          entries: [
            {
              id: "timeline_main",
              kind: "timeline",
              assetType: "timeline.events",
              title: "Main Timeline",
              status: "active",
              summary: "Arrival happens before the council summons.",
              aliases: [],
              relatedEntityIds: [],
              details: {},
              createdAt: "2026-07-05T00:00:00.000Z",
              updatedAt: "2026-07-05T00:00:00.000Z",
              timelineEvents: [
                {
                  id: "event_01",
                  parentEntryId: "timeline_main",
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
            assetType: "timeline.events",
            title: "Main Timeline",
            summary: "Arrival happens before the council summons.",
            status: "active",
            aliases: [],
            relatedEntityIds: [],
            details: {}
          }
        })}
        onTimelineEntryOpen={(entryId) => openedEntries.push(entryId)}
      />
    );
    const openEvent = findElementByAriaLabel(tree, "Edit timeline: Main Timeline");
    openEvent?.props.onClick?.();
    const html = renderToStaticMarkup(tree);

    expect(openedEntries).toEqual(["timeline_main"]);
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

  test("renders timeline detail inside the timeline activity and returns to its list", () => {
    const application = createDesktopApplication();
    const calls: string[] = [];
    const tree = WorkspaceShell({
      shellState: { ...application.getShellState(), activeActivity: "timeline" },
      commands: application.listCommands(),
      commandPaletteOpen: false,
      storyBibleEditor: createStoryBibleEditorProps({
        activeKind: "timeline",
        viewMode: "detail",
        draft: {
          id: "timeline_main",
          kind: "timeline",
          assetType: "timeline.events",
          title: "Main Timeline",
          summary: "Ordered events.",
          status: "active",
          aliases: [],
          relatedEntityIds: [],
          details: {}
        },
        onKindSelect: (kind) => calls.push(kind)
      })
    });

    findElementByAriaLabel(tree, "返回时间线列表")?.props.onClick?.();
    const html = renderToStaticMarkup(tree);

    expect(calls).toEqual(["timeline"]);
    expect(html).toContain('aria-label="故事圣经编辑器"');
    expect(html).toContain('aria-label="返回时间线列表"');
    expect(html).not.toContain('aria-label="时间线主视图"');
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

function createSettingsProps(): ModelSettingsPanelProps {
  return {
    activeSection: "models",
    defaultProfileId: "",
    profiles: [],
    draft: {
      id: "model_default",
      provider: "openai-compatible",
      displayName: "Default Model",
      baseUrl: "",
      modelName: "example-model",
      contextWindow: "",
      apiKeyRefInput: "",
      temperature: "0.7",
      maxTokens: "4096",
      topP: "1",
      reasoningEffortEnabled: false,
      timeoutMs: "60000"
    },
    saveStatus: "idle"
  };
}

function createStoryBibleEditorProps(
  overrides: Partial<StoryBibleEditorProps> = {}
): StoryBibleEditorProps {
  return {
    activeKind: "character",
    viewMode: "list",
    status: "idle",
    dirty: false,
    entries: [],
    chapterOptions: [],
    filters: {
      query: "",
      status: "all",
      worldAssetType: "all",
      foreshadowTrackingStatus: "all"
    },
    externalUpdate: { status: "none" },
    draft: {
      kind: "character",
      assetType: "character",
      title: "",
      status: "active",
      summary: "",
      aliases: [],
      relatedEntityIds: [],
      details: {}
    },
    onKindSelect: () => undefined,
    onEntrySelect: () => undefined,
    onDraftChange: () => undefined,
    onFiltersChange: () => undefined,
    onNewDraft: () => undefined,
    onCancelDraft: () => undefined,
    onSave: () => undefined,
    ...overrides
  };
}

function emptyConversationNavigator(): AgentConversationNavigatorProps {
  return {
    conversations: [],
    searchQuery: "",
    filter: "active",
    loading: false,
    onSearchQueryChange: () => undefined,
    onFilterChange: () => undefined,
    onCreate: () => undefined,
    onSelect: () => undefined,
    onArchive: () => undefined,
    onRestore: () => undefined
  };
}

function emptyConversationView(): AgentConversationViewProps {
  return {
    loading: false,
    onCreate: () => undefined,
    onArchive: () => undefined,
    onRestore: () => undefined,
    onReturnToActive: () => undefined
  };
}

interface InspectableElementProps {
  readonly disabled?: boolean;
  readonly onClick?: () => void;
}

function findElementByAriaLabel(
  node: ReactNode,
  ariaLabel: string
): { readonly props: InspectableElementProps } | undefined {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);

  act(() => {
    root.render(node);
  });

  const element = Array.from(host.querySelectorAll<HTMLElement>("[aria-label]")).find(
    (candidate) => candidate.getAttribute("aria-label") === ariaLabel
  );
  if (element === undefined) {
    act(() => root.unmount());
    host.remove();
    return undefined;
  }

  return {
    props: {
      ...(element instanceof HTMLButtonElement && element.disabled ? { disabled: true } : {}),
      onClick: () => {
        act(() => {
          element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        act(() => root.unmount());
        host.remove();
      }
    }
  };
}
