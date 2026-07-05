import { describe, expect, test } from "vitest";

import { ok, type ChapterSummary } from "@novel-studio/shared";
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
  chapters: []
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
    expect(createdChapter.chapters[0]?.title).toBe("Untitled Chapter 1");
    expect(selected.activeChapterId).toBe("ch_generated");
    expect(calls).toEqual([
      "project.create:prj_generated:M12",
      "project.createChapter:ch_generated:Untitled Chapter 1",
      "project.selectChapter:ch_generated"
    ]);
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
      message: "Open project canceled."
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
}): NovelStudioApi {
  return {
    getShellState: async () => ({
      projectTitle: "M12",
      activeActivity: "workspace",
      navigatorCollapsed: false,
      inspectorCollapsed: false,
      bottomPanelVisible: true,
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
        return ok({ ...emptySnapshot, projectRoot, chapters: options.getChapters() });
      },
      create: async (input) => {
        options.record.push(`project.create:${input.projectId}:${input.title}`);
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
          chapters: nextChapters,
          activeChapterId: input.chapterId
        });
      },
      selectChapter: async (chapterId) => {
        options.record.push(`project.selectChapter:${chapterId}`);
        return ok({
          ...emptySnapshot,
          chapters: options.getChapters(),
          activeChapterId: chapterId
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
