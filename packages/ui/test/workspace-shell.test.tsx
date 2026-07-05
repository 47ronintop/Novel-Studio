import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { createDesktopApplication } from "@novel-studio/application";
import { WorkspaceShell } from "@novel-studio/ui";

describe("WorkspaceShell", () => {
  test("renders the desktop IDE workspace regions", () => {
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
    expect(html).toContain('data-region="inspector"');
    expect(html).toContain('data-region="bottom-panel"');
    expect(html).toContain('aria-label="活动栏"');
    expect(html).toContain('aria-label="项目导航"');
    expect(html).toContain('aria-label="编辑区"');
    expect(html).toContain('aria-label="检查器"');
    expect(html).toContain('aria-label="底部面板"');
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

  test("renders Story Bible summaries and context eligibility", () => {
    const application = createDesktopApplication();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        shellState={application.getShellState()}
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
});
