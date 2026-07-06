import { describe, expect, test } from "vitest";

import { ok, type ChapterDocument, type ChapterSummary } from "@novel-studio/shared";
import type { NovelStudioApi, ProjectWorkspaceSnapshot } from "@novel-studio/application";

import { createProjectWorkflowBridge } from "../src/renderer/project-workflow-bridge.js";

const emptySnapshot: ProjectWorkspaceSnapshot = {
  projectRoot: "D:/Novel/M12",
  project: {
    schemaVersion: "1.0",
    projectId: "prj_m12",
    title: "M12",
    projectType: "novel",
    language: "zh-CN",
    createdAt: "2026-07-04T00:00:00.000Z",
    updatedAt: "2026-07-04T00:00:00.000Z"
  },
  settings: {
    schemaVersion: "1.0",
    autosave: {},
    history: {},
    models: {}
  },
  chapters: [],
  recovery: {
    availableItems: []
  }
};

const recoveredChapter: ChapterDocument = {
  frontmatter: {
    schemaVersion: "1.0",
    id: "ch_opening",
    title: "Opening",
    order: 1,
    status: "draft",
    createdAt: "2026-07-04T00:00:00.000Z",
    updatedAt: "2026-07-06T00:05:00.000Z"
  },
  body: "unsaved recovered opening\n"
};

describe("project workflow bridge", () => {
  test("opens, creates, creates chapters, and selects chapters through the preload API", async () => {
    const calls: string[] = [];
    let chapters: readonly ChapterSummary[] = [];
    const api = createApi({
      record: calls,
      getChapters: () => chapters,
      setChapters: (nextChapters) => {
        chapters = nextChapters;
      }
    });
    const bridge = createProjectWorkflowBridge(api, {
      createProjectId: () => "prj_generated",
      createChapterId: () => "ch_generated"
    });

    bridge.setProjectRootInput("D:/Novel/M12");
    const createdProject = await bridge.createProject();
    const createdChapter = await bridge.createChapter();
    const selected = await bridge.selectChapter("ch_generated");

    expect(createdProject.projectRootInput).toBe("D:/Novel/M12");
    expect(createdChapter.chapters[0]?.title).toBe("未命名章节 1");
    expect(createdChapter.openChapterTabIds).toEqual(["ch_generated"]);
    expect(selected.activeChapterId).toBe("ch_generated");
    expect(selected.openChapterTabIds).toEqual(["ch_generated"]);
    expect(calls).toEqual([
      "project.create:prj_generated:M12",
      "project.createChapter:ch_generated:未命名章节 1",
      "project.selectChapter:ch_generated"
    ]);
  });

  test("creates an example project with a sample chapter through the preload API", async () => {
    const calls: string[] = [];
    let chapters: readonly ChapterSummary[] = [];
    const api = createApi({
      record: calls,
      getChapters: () => chapters,
      setChapters: (nextChapters) => {
        chapters = nextChapters;
      }
    });
    const bridge = createProjectWorkflowBridge(api, {
      createProjectId: () => "prj_example",
      createChapterId: () => "ch_example"
    });

    bridge.setProjectRootInput("D:/Novel/Example Project");
    const example = await bridge.createExampleProject();

    expect(example.projectRootInput).toBe("D:/Novel/Example Project");
    expect(example.activeChapterId).toBe("ch_example");
    expect(example.openChapterTabIds).toEqual(["ch_example"]);
    expect(example.chapters[0]?.title).toBe("示例章节");
    expect(calls).toEqual([
      "project.create:prj_example:示例小说项目",
      "project.createChapter:ch_example:示例章节"
    ]);
  });

  test("tracks runtime open chapter tabs and selects a neighbor when closing the active tab", async () => {
    const calls: string[] = [];
    let chapters: readonly ChapterSummary[] = [
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
    ];
    const api = createApi({
      record: calls,
      getChapters: () => chapters,
      setChapters: (nextChapters) => {
        chapters = nextChapters;
      },
      chooseOpenProjectRoot: "D:/Novel/M37"
    });
    const bridge = createProjectWorkflowBridge(api);

    await bridge.openProject();
    await bridge.selectChapter("ch_opening");
    await bridge.selectChapter("ch_second");
    const closed = await bridge.closeChapterTab("ch_second");

    expect(closed.openChapterTabIds).toEqual(["ch_opening"]);
    expect(closed.activeChapterId).toBe("ch_opening");
    expect(calls).toContain("project.selectChapter:ch_opening");
  });

  test("maps workspace recovery records to dirty chapter tabs and a recovery notice", async () => {
    const calls: string[] = [];
    const chapters: readonly ChapterSummary[] = [
      {
        id: "ch_opening",
        title: "Opening",
        order: 1,
        status: "draft",
        updatedAt: "2026-07-04T00:00:00.000Z"
      }
    ];
    const api = createApi({
      record: calls,
      getChapters: () => chapters,
      setChapters: () => undefined,
      chooseOpenProjectRoot: "D:/Novel/M38",
      recovery: {
        availableItems: [
          {
            sessionId: "session_prj_m38_ch_opening",
            chapterId: "ch_opening",
            updatedAt: "2026-07-05T00:05:00.000Z"
          }
        ]
      }
    });
    const bridge = createProjectWorkflowBridge(api);

    const opened = await bridge.openProject();

    expect(opened.dirtyChapterIds).toEqual(["ch_opening"]);
    expect(opened.recovery?.availableItems[0]?.chapterId).toBe("ch_opening");
  });

  test("previews, applies, and discards recovery drafts through the preload API", async () => {
    const calls: string[] = [];
    const chapters: readonly ChapterSummary[] = [
      {
        id: "ch_opening",
        title: "Opening",
        order: 1,
        status: "draft",
        updatedAt: "2026-07-04T00:00:00.000Z"
      }
    ];
    const recovery = {
      availableItems: [
        {
          sessionId: "session_prj_m49_ch_opening",
          chapterId: "ch_opening",
          updatedAt: "2026-07-06T00:05:00.000Z"
        }
      ]
    };
    const api = createApi({
      record: calls,
      getChapters: () => chapters,
      setChapters: () => undefined,
      chooseOpenProjectRoot: "D:/Novel/M49",
      recovery
    });
    const bridge = createProjectWorkflowBridge(api);

    await bridge.openProject();
    const previewed = await bridge.previewRecoveryDraft("session_prj_m49_ch_opening");
    const applied = await bridge.applyRecoveryDraft("session_prj_m49_ch_opening");
    const discarded = await bridge.discardRecoveryDraft("session_prj_m49_ch_opening");

    expect(previewed.recovery?.review?.selectedDraft?.body).toBe("unsaved recovered opening\n");
    expect(applied.projectWorkflow.recovery?.availableItems).toEqual([]);
    expect(applied.chapterEditor.chapter.body).toBe("unsaved recovered opening\n");
    expect(applied.chapterEditor.dirty).toBe(true);
    expect(discarded.recovery?.availableItems).toEqual([]);
    expect(calls).toContain("project.previewRecoveryDraft:session_prj_m49_ch_opening");
    expect(calls).toContain("project.applyRecoveryDraft:session_prj_m49_ch_opening");
    expect(calls).toContain("project.discardRecoveryDraft:session_prj_m49_ch_opening");
  });

  test("uses native directory selection when no project path is typed", async () => {
    const calls: string[] = [];
    let chapters: readonly ChapterSummary[] = [];
    const api = createApi({
      record: calls,
      getChapters: () => chapters,
      setChapters: (nextChapters) => {
        chapters = nextChapters;
      },
      chooseOpenProjectRoot: "D:/Novel/Dialog Open",
      chooseCreateProjectRoot: "D:/Novel/Dialog Create"
    });
    const bridge = createProjectWorkflowBridge(api, {
      createProjectId: () => "prj_dialog"
    });

    const opened = await bridge.openProject();
    const created = await bridge.createProject();

    expect(opened.projectRootInput).toBe("D:/Novel/Dialog Open");
    expect(created.projectRootInput).toBe("D:/Novel/Dialog Create");
    expect(calls).toEqual([
      "project.chooseOpenDirectory",
      "project.open:D:/Novel/Dialog Open",
      "project.chooseCreateDirectory",
      "project.create:prj_dialog:Dialog Create"
    ]);
  });

  test("reports directory selection cancellation and project errors without throwing", async () => {
    const calls: string[] = [];
    const api = createApi({
      record: calls,
      getChapters: () => [],
      setChapters: () => undefined,
      chooseOpenProjectRoot: undefined,
      openErrorMessage: "project.json could not be read."
    });
    const bridge = createProjectWorkflowBridge(api);

    const canceled = await bridge.openProject();
    bridge.setProjectRootInput("D:/Broken Project");
    const failed = await bridge.openProject();

    expect(canceled.feedback).toEqual({
      kind: "info",
      message: "已取消打开项目。"
    });
    expect(failed.feedback).toEqual({
      kind: "error",
      message: "project.json could not be read."
    });
    expect(calls).toEqual(["project.chooseOpenDirectory", "project.open:D:/Broken Project"]);
  });
});

function createApi(options: {
  readonly record: string[];
  readonly getChapters: () => readonly ChapterSummary[];
  readonly setChapters: (chapters: readonly ChapterSummary[]) => void;
  readonly chooseOpenProjectRoot?: string;
  readonly chooseCreateProjectRoot?: string;
  readonly openErrorMessage?: string;
  readonly recovery?: ProjectWorkspaceSnapshot["recovery"];
}): NovelStudioApi {
  let currentProjectRoot = emptySnapshot.projectRoot;

  return {
    getShellState: async () => ({
      projectTitle: "M12",
      activeActivity: "workspace",
      navigatorCollapsed: false,
      inspectorCollapsed: false,
      bottomPanelVisible: true,
      activeBottomPanelTab: "工作流运行",
      workspaceLayout: {
        splitView: false,
        navigatorWidth: 260,
        inspectorWidth: 320,
        bottomPanelHeight: 220
      },
      commandPaletteOpen: false,
      saveStatus: "Saved",
      navigatorSections: [],
      bottomPanelTabs: []
    }),
    commands: {
      list: async () => [],
      execute: async () =>
        ok({
          projectTitle: "M12",
          activeActivity: "workspace",
          navigatorCollapsed: false,
          inspectorCollapsed: false,
          bottomPanelVisible: true,
          activeBottomPanelTab: "工作流运行",
          workspaceLayout: {
            splitView: false,
            navigatorWidth: 260,
            inspectorWidth: 320,
            bottomPanelHeight: 220
          },
          commandPaletteOpen: false,
          saveStatus: "Saved",
          navigatorSections: [],
          bottomPanelTabs: []
        })
    },
    project: {
      chooseOpenDirectory: async () => {
        options.record.push("project.chooseOpenDirectory");
        return ok(
          options.chooseOpenProjectRoot === undefined
            ? { canceled: true }
            : { canceled: false, projectRoot: options.chooseOpenProjectRoot }
        );
      },
      chooseCreateDirectory: async () => {
        options.record.push("project.chooseCreateDirectory");
        return ok(
          options.chooseCreateProjectRoot === undefined
            ? { canceled: true }
            : { canceled: false, projectRoot: options.chooseCreateProjectRoot }
        );
      },
      open: async (projectRoot) => {
        options.record.push(`project.open:${projectRoot}`);
        if (options.openErrorMessage !== undefined) {
          return {
            ok: false,
            error: {
              schemaVersion: "1.0",
              errorId: "err_open_failed",
              code: "PROJECT_FILE_MISSING",
              category: "StorageError",
              message: options.openErrorMessage,
              recoverability: "user-action",
              suggestedAction: "Choose a valid Novel Studio project folder.",
              traceId: "test",
              createdAt: "2026-07-05T00:00:00.000Z"
            }
          };
        }
        currentProjectRoot = projectRoot;
        return ok({
          ...emptySnapshot,
          projectRoot,
          chapters: options.getChapters(),
          ...(options.recovery === undefined ? {} : { recovery: options.recovery })
        });
      },
      create: async (input) => {
        options.record.push(`project.create:${input.projectId}:${input.title}`);
        currentProjectRoot = input.projectRoot;
        return ok({ ...emptySnapshot, projectRoot: input.projectRoot, chapters: [] });
      },
      listChapters: async () => ok(options.getChapters()),
      createChapter: async (input) => {
        options.record.push(`project.createChapter:${input.chapterId}:${input.title}`);
        const nextChapters = [
          ...options.getChapters(),
          {
            id: input.chapterId,
            title: input.title,
            order: input.order ?? 1,
            status: "draft" as const,
            updatedAt: "2026-07-04T00:00:00.000Z"
          }
        ];
        options.setChapters(nextChapters);
        return ok({
          ...emptySnapshot,
          projectRoot: currentProjectRoot,
          chapters: nextChapters,
          activeChapterId: input.chapterId
        });
      },
      selectChapter: async (chapterId) => {
        options.record.push(`project.selectChapter:${chapterId}`);
        return ok({
          ...emptySnapshot,
          projectRoot: currentProjectRoot,
          chapters: options.getChapters(),
          activeChapterId: chapterId
        });
      },
      previewRecoveryDraft: async (sessionId) => {
        options.record.push(`project.previewRecoveryDraft:${sessionId}`);
        return ok({
          sessionId,
          chapterId: "ch_opening",
          chapterTitle: "Opening",
          updatedAt: "2026-07-06T00:05:00.000Z",
          body: "unsaved recovered opening\n"
        });
      },
      applyRecoveryDraft: async (sessionId) => {
        options.record.push(`project.applyRecoveryDraft:${sessionId}`);
        return ok({
          workspace: {
            ...emptySnapshot,
            projectRoot: currentProjectRoot,
            chapters: options.getChapters(),
            recovery: {
              availableItems: []
            },
            activeChapterId: "ch_opening"
          },
          chapterEditor: {
            state: {
              chapter: recoveredChapter,
              dirty: true,
              saveStatus: "Unsaved" as const
            },
            versions: []
          }
        });
      },
      discardRecoveryDraft: async (sessionId) => {
        options.record.push(`project.discardRecoveryDraft:${sessionId}`);
        return ok({
          ...emptySnapshot,
          projectRoot: currentProjectRoot,
          chapters: options.getChapters(),
          recovery: {
            availableItems: []
          },
          activeChapterId: "ch_opening"
        });
      }
    },
    chapter: {
      load: async () => {
        throw new Error("not used");
      },
      edit: async () => {
        throw new Error("not used");
      },
      save: async () => {
        throw new Error("not used");
      },
      listVersions: async () => {
        throw new Error("not used");
      },
      previewVersion: async () => {
        throw new Error("not used");
      },
      restoreVersion: async () => {
        throw new Error("not used");
      },
      previewSuggestionDiff: async () => {
        throw new Error("not used");
      }
    },
    settings: {
      listModelProfiles: async () => {
        throw new Error("not used");
      },
      saveModelProfile: async () => {
        throw new Error("not used");
      },
      testModelProfileConnection: async () => {
        throw new Error("not used");
      }
    },
    studio: {
      loadConfigAsset: async () => {
        throw new Error("not used");
      },
      saveConfigAsset: async () => {
        throw new Error("not used");
      },
      restoreConfigAssetVersion: async () => {
        throw new Error("not used");
      }
    }
  };
}
