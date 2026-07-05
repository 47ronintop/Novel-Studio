import { describe, expect, test } from "vitest";

import { isErr, isOk, ok } from "@novel-studio/shared";
import type {
  ChapterDocument,
  ChapterDraftRepositoryPort,
  ChapterHistoryRepositoryPort
} from "@novel-studio/shared";

import { createChapterEditorSession } from "../src/chapter-editor-session.js";
import { createDesktopApplication } from "../src/desktop-application.js";
import { DEFAULT_APPLICATION_COMMANDS, isSafeCommand } from "../src/command-registry.js";

const chapterId = "ch_01JZ7P9QK2R6D4W8K3A1B5C9D0";
const chapter = {
  frontmatter: {
    schemaVersion: "1.0",
    id: chapterId,
    type: "chapter",
    title: "第一章",
    order: 1,
    status: "draft",
    createdAt: "2026-07-03T00:00:00.000Z",
    updatedAt: "2026-07-03T00:00:00.000Z"
  },
  body: "原始章节正文。\n"
} satisfies ChapterDocument;

describe("desktop application command bridge", () => {
  test("exposes a shell state DTO for the desktop workspace", () => {
    const application = createDesktopApplication();

    expect(application.getShellState()).toMatchObject({
      projectTitle: "未打开项目",
      activeActivity: "workspace",
      navigatorCollapsed: false,
      inspectorCollapsed: false,
      bottomPanelVisible: true,
      activeBottomPanelTab: "工作流运行",
      saveStatus: "Saved"
    });
  });

  test("registers only safe M4 commands with risk levels", () => {
    expect(DEFAULT_APPLICATION_COMMANDS).toEqual([
      {
        id: "workspace.open-command-palette",
        title: "打开命令面板",
        scope: "workspace",
        riskLevel: "safe",
        defaultShortcut: "Ctrl/Cmd+K"
      },
      {
        id: "workspace.toggle-navigator",
        title: "切换项目导航",
        scope: "workspace",
        riskLevel: "safe",
        defaultShortcut: "Ctrl/Cmd+B"
      },
      {
        id: "workspace.toggle-inspector",
        title: "切换检查器",
        scope: "workspace",
        riskLevel: "safe",
        defaultShortcut: "Ctrl/Cmd+Shift+I"
      },
      {
        id: "workspace.toggle-bottom-panel",
        title: "切换底部面板",
        scope: "workspace",
        riskLevel: "safe",
        defaultShortcut: "Ctrl/Cmd+J"
      }
    ]);
    expect(DEFAULT_APPLICATION_COMMANDS.every(isSafeCommand)).toBe(true);
  });

  test("executes safe workspace commands without filesystem access", () => {
    const application = createDesktopApplication();

    const result = application.executeCommand("workspace.toggle-navigator");

    expect(result.ok).toBe(true);
    expect(application.getShellState().navigatorCollapsed).toBe(true);
  });

  test("toggles bottom panel visibility without changing the active bottom tab", () => {
    const application = createDesktopApplication();

    const result = application.executeCommand("workspace.toggle-bottom-panel");

    expect(result.ok).toBe(true);
    expect(application.getShellState()).toMatchObject({
      bottomPanelVisible: false,
      activeBottomPanelTab: "工作流运行"
    });
  });

  test("rejects unknown commands at the Application boundary", () => {
    const application = createDesktopApplication();

    const result = application.executeCommand("fs:read-file");

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "APPLICATION_COMMAND_NOT_ALLOWED",
        category: "UserError",
        recoverability: "user-action"
      }
    });
  });

  test("delegates active chapter editing through an injected Application session", async () => {
    const writes: ChapterDocument[] = [];
    const historyCalls: string[] = [];
    const repository: ChapterDraftRepositoryPort = {
      async readChapter(requestedChapterId) {
        expect(requestedChapterId).toBe(chapterId);
        return ok(chapter);
      },
      async writeChapter(nextChapter) {
        writes.push(nextChapter);
        return ok(nextChapter);
      }
    };
    const historyRepository: ChapterHistoryRepositoryPort = {
      async snapshotChapterVersion(input) {
        historyCalls.push(`snapshot:${input.reason}:${input.body}`);
        return ok({
          versionId: "ver_manual_save",
          reason: input.reason,
          createdBy: input.createdBy ?? "system",
          createdAt: "2026-07-04T00:00:00.000Z",
          parentVersionId: input.parentVersionId ?? null
        });
      },
      async listChapterVersions(requestedChapterId) {
        historyCalls.push(`list:${requestedChapterId}`);
        return ok([
          {
            versionId: "ver_manual_save",
            reason: "manual-save",
            createdBy: "user",
            createdAt: "2026-07-04T00:00:00.000Z",
            parentVersionId: null
          }
        ]);
      },
      async readChapterVersion(requestedChapterId, versionId) {
        historyCalls.push(`read:${requestedChapterId}:${versionId}`);
        return ok({ versionId, body: "保存后的章节正文。\n" });
      }
    };
    const application = createDesktopApplication({
      chapterEditorSession: createChapterEditorSession({
        chapterId,
        repository,
        historyRepository,
        now: () => "2026-07-04T00:00:00.000Z"
      }),
      projectTitle: "Minimal Chapter Project",
      navigatorSections: [{ id: "chapters", title: "Chapters", itemCount: 1 }]
    });

    const loaded = await application.loadActiveChapter();

    expect(isOk(loaded)).toBe(true);
    if (isErr(loaded)) {
      throw new Error(loaded.error.message);
    }
    expect(loaded.value.state.chapter.body).toBe("原始章节正文。\n");
    expect(application.getShellState()).toMatchObject({
      projectTitle: "Minimal Chapter Project",
      saveStatus: "Saved",
      navigatorSections: [{ id: "chapters", title: "Chapters", itemCount: 1 }]
    });

    const edited = await application.editActiveChapter("保存后的章节正文。\n");

    expect(isOk(edited)).toBe(true);
    if (isErr(edited)) {
      throw new Error(edited.error.message);
    }
    expect(edited.value.state.saveStatus).toBe("Unsaved");
    expect(application.getShellState().saveStatus).toBe("Unsaved");

    const saved = await application.saveActiveChapter();

    expect(isOk(saved)).toBe(true);
    if (isErr(saved)) {
      throw new Error(saved.error.message);
    }
    expect(saved.value.state.saveStatus).toBe("Saved");
    expect(writes.map((entry) => entry.body)).toEqual(["保存后的章节正文。\n"]);
    expect(historyCalls).toContain("snapshot:manual-save:保存后的章节正文。\n");

    const versions = await application.listActiveChapterVersions();

    expect(isOk(versions)).toBe(true);
    if (isErr(versions)) {
      throw new Error(versions.error.message);
    }
    expect(versions.value[0]?.reason).toBe("manual-save");

    const diff = application.previewActiveChapterSuggestionDiff("AI 建议正文。\n");

    expect(diff.ok).toBe(true);
    if (!diff.ok) {
      throw new Error(diff.error.message);
    }
    expect(diff.value.changes[0]?.kind).toBe("replace");
    expect(historyCalls).not.toContain("snapshot:before-ai-apply:AI 建议正文。\n");
  });
});
