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

  test("forwards navigator chapter rename, duplicate, and delete actions through the preload API", async () => {
    const calls: string[] = [];
    let chapters: readonly ChapterSummary[] = [
      {
        id: "ch_opening",
        title: "开篇",
        order: 1,
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
      chooseOpenProjectRoot: "D:/Novel/VUI06"
    });
    const bridge = createProjectWorkflowBridge(api, {
      createChapterId: () => "ch_opening_copy"
    });

    await bridge.openProject();
    const renamed = await bridge.renameChapter("ch_opening", "改名后的开篇");
    const duplicated = await bridge.duplicateChapter("ch_opening");
    const deleted = await bridge.deleteChapter("ch_opening");

    expect(renamed.chapters[0]?.title).toBe("改名后的开篇");
    expect(duplicated.chapters.map((chapter) => chapter.id)).toEqual([
      "ch_opening",
      "ch_opening_copy"
    ]);
    expect(deleted.chapters.map((chapter) => chapter.id)).toEqual(["ch_opening_copy"]);
    expect(calls).toContain("project.renameChapter:ch_opening:改名后的开篇");
    expect(calls).toContain(
      "project.duplicateChapter:ch_opening:ch_opening_copy:改名后的开篇 副本"
    );
    expect(calls).toContain("project.deleteChapter:ch_opening");
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
      "project.readDirectory:D:/Novel/Dialog Open",
      "project.chooseCreateDirectory",
      "project.create:prj_dialog:Dialog Create"
    ]);
  });

  test("loads the local file tree immediately after opening a valid project", async () => {
    const calls: string[] = [];
    const fileTree = [
      {
        id: "file:project.json",
        name: "project.json",
        kind: "file" as const,
        path: "project.json"
      },
      {
        id: "folder:chapters",
        name: "chapters",
        kind: "directory" as const,
        path: "chapters",
        children: [
          {
            id: "file:chapters/ch_opening.md",
            name: "ch_opening.md",
            kind: "file" as const,
            path: "chapters/ch_opening.md"
          }
        ]
      }
    ];
    const api = createApi({
      record: calls,
      getChapters: () => [
        {
          id: "ch_opening",
          title: "Opening",
          order: 1,
          status: "draft",
          updatedAt: "2026-07-04T00:00:00.000Z"
        }
      ],
      setChapters: () => undefined,
      chooseOpenProjectRoot: "D:/Novel/Valid",
      fileTree
    });
    const bridge = createProjectWorkflowBridge(api);

    const opened = await bridge.openProject();

    expect(opened.fileTree?.map((item) => item.name)).toEqual(["project.json", "chapters"]);
    expect(opened.chapters.map((chapter) => chapter.id)).toEqual(["ch_opening"]);
    expect(opened.canInitializeProject).toBeUndefined();
    expect(calls).toEqual([
      "project.chooseOpenDirectory",
      "project.open:D:/Novel/Valid",
      "project.readDirectory:D:/Novel/Valid"
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
    expect(calls).toEqual([
      "project.chooseOpenDirectory",
      "project.open:D:/Broken Project",
      "project.readDirectory:D:/Broken Project"
    ]);
  });

  test("falls back to an ordinary folder file tree when project metadata is missing", async () => {
    const calls: string[] = [];
    const api = createApi({
      record: calls,
      getChapters: () => [],
      setChapters: () => undefined,
      chooseOpenProjectRoot: "D:/Draft Folder",
      openErrorMessage: "project.json could not be read.",
      fileTree: [
        {
          id: "file:INDEX.md",
          name: "INDEX.md",
          kind: "file",
          path: "INDEX.md"
        },
        {
          id: "folder:notes",
          name: "notes",
          kind: "directory",
          path: "notes",
          children: [
            {
              id: "file:notes/scene.md",
              name: "scene.md",
              kind: "file",
              path: "notes/scene.md"
            }
          ]
        }
      ]
    });
    const bridge = createProjectWorkflowBridge(api);

    const opened = await bridge.openProject();

    expect(opened.projectRootInput).toBe("D:/Draft Folder");
    expect(opened.fileTree?.map((item) => item.name)).toEqual(["INDEX.md", "notes"]);
    expect(opened.canInitializeProject).toBe(true);
    expect(opened.feedback).toEqual({
      kind: "info",
      message: "已作为普通文件夹打开。可浏览文件，初始化后启用 Novel Studio 项目功能。"
    });
    expect(calls).toEqual([
      "project.chooseOpenDirectory",
      "project.open:D:/Draft Folder",
      "project.readDirectory:D:/Draft Folder"
    ]);
  });

  test("initializes the currently opened ordinary folder as a Novel Studio project", async () => {
    const calls: string[] = [];
    const fileTree = [
      {
        id: "file:notes.md",
        name: "notes.md",
        kind: "file" as const,
        path: "notes.md"
      }
    ];
    const api = createApi({
      record: calls,
      getChapters: () => [],
      setChapters: () => undefined,
      chooseOpenProjectRoot: "D:/Draft Folder",
      openErrorMessage: "project.json could not be read.",
      fileTree
    });
    const bridge = createProjectWorkflowBridge(api, {
      createProjectId: () => "prj_initialized"
    });

    await bridge.openProject();
    const initialized = await bridge.initializeProject();

    expect(initialized.projectRootInput).toBe("D:/Draft Folder");
    expect(initialized.fileTree?.map((item) => item.name)).toEqual(["notes.md"]);
    expect(initialized.canInitializeProject).toBeUndefined();
    expect(initialized.feedback).toEqual({
      kind: "info",
      message: "已初始化为 Novel Studio 项目。普通文件仍保留在文件视图中。"
    });
    expect(calls).toEqual([
      "project.chooseOpenDirectory",
      "project.open:D:/Draft Folder",
      "project.readDirectory:D:/Draft Folder",
      "project.create:prj_initialized:Draft Folder"
    ]);
  });
});

function createApi(options: {
  readonly record: string[];
  readonly getChapters: () => readonly ChapterSummary[];
  readonly setChapters: (chapters: readonly ChapterSummary[]) => void;
  readonly chooseOpenProjectRoot?: string;
  readonly chooseCreateProjectRoot?: string;
  readonly openErrorMessage?: string;
  readonly fileTree?: NonNullable<
    ReturnType<typeof createProjectWorkflowBridge>["getProps"]
  >["fileTree"];
  readonly recovery?: ProjectWorkspaceSnapshot["recovery"];
}): NovelStudioApi {
  let activeProjectRoot = emptySnapshot.projectRoot;

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
        activeProjectRoot = projectRoot;
        return ok({
          ...emptySnapshot,
          projectRoot,
          chapters: options.getChapters(),
          ...(options.recovery === undefined ? {} : { recovery: options.recovery })
        });
      },
      create: async (input) => {
        options.record.push(`project.create:${input.projectId}:${input.title}`);
        activeProjectRoot = input.projectRoot;
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
          projectRoot: activeProjectRoot,
          chapters: nextChapters,
          activeChapterId: input.chapterId
        });
      },
      renameChapter: async (input) => {
        options.record.push(`project.renameChapter:${input.chapterId}:${input.title}`);
        const nextChapters = options
          .getChapters()
          .map((chapter) =>
            chapter.id === input.chapterId
              ? { ...chapter, title: input.title, updatedAt: "2026-07-04T00:00:00.000Z" }
              : chapter
          );
        options.setChapters(nextChapters);
        return ok({
          ...emptySnapshot,
          projectRoot: activeProjectRoot,
          chapters: nextChapters,
          activeChapterId: input.chapterId
        });
      },
      duplicateChapter: async (input) => {
        options.record.push(
          `project.duplicateChapter:${input.sourceChapterId}:${input.chapterId}:${input.title}`
        );
        const source = options
          .getChapters()
          .find((chapter) => chapter.id === input.sourceChapterId);
        const nextChapters = [
          ...options.getChapters(),
          {
            id: input.chapterId,
            title: input.title,
            order: (source?.order ?? options.getChapters().length) + 1,
            status: "draft" as const,
            updatedAt: "2026-07-04T00:00:00.000Z"
          }
        ];
        options.setChapters(nextChapters);
        return ok({
          ...emptySnapshot,
          projectRoot: activeProjectRoot,
          chapters: nextChapters,
          activeChapterId: input.chapterId
        });
      },
      deleteChapter: async (input) => {
        options.record.push(`project.deleteChapter:${input.chapterId}`);
        const nextChapters = options
          .getChapters()
          .filter((chapter) => chapter.id !== input.chapterId);
        options.setChapters(nextChapters);
        return ok({
          ...emptySnapshot,
          projectRoot: activeProjectRoot,
          chapters: nextChapters,
          activeChapterId: nextChapters[0]?.id
        });
      },
      selectChapter: async (chapterId) => {
        options.record.push(`project.selectChapter:${chapterId}`);
        return ok({
          ...emptySnapshot,
          projectRoot: activeProjectRoot,
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
            projectRoot: activeProjectRoot,
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
          projectRoot: activeProjectRoot,
          chapters: options.getChapters(),
          recovery: {
            availableItems: []
          },
          activeChapterId: "ch_opening"
        });
      },
      readDirectory: async (projectRoot) => {
        options.record.push(`project.readDirectory:${projectRoot}`);
        if (options.fileTree !== undefined) {
          return ok(options.fileTree);
        }

        return {
          ok: false,
          error: {
            schemaVersion: "1.0",
            errorId: "err_directory_read_failed",
            code: "PROJECT_DIRECTORY_READ_FAILED",
            category: "StorageError",
            message: "Project directory could not be read.",
            recoverability: "user-action",
            suggestedAction: "Choose a folder that exists on this computer.",
            traceId: "test",
            createdAt: "2026-07-05T00:00:00.000Z"
          }
        };
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
