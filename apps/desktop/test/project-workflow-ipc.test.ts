import { describe, expect, test } from "vitest";

import { ok, type Result, type UnifiedError } from "@novel-studio/shared";
import type {
  ApplicationCommand,
  DesktopApplication,
  DesktopShellState,
  ProjectWorkspaceSnapshot
} from "@novel-studio/application";

import { createApplicationIpcHandlers } from "../src/main/ipc-handlers.js";
import { createNovelStudioApi } from "../src/preload/api.js";

const shellState: DesktopShellState = {
  projectTitle: "M12",
  activeActivity: "workspace",
  navigatorCollapsed: false,
  inspectorCollapsed: false,
  bottomPanelVisible: true,
  activeBottomPanelTab: "Logs",
  workspaceLayout: {
    splitView: false,
    navigatorWidth: 260,
    inspectorWidth: 320,
    bottomPanelHeight: 220
  },
  commandPaletteOpen: false,
  saveStatus: "Saved",
  navigatorSections: [{ id: "chapters", title: "Chapters", itemCount: 1 }],
  bottomPanelTabs: ["Logs"]
};

const workspaceSnapshot: ProjectWorkspaceSnapshot = {
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
  chapters: [
    {
      id: "ch_opening",
      title: "开篇",
      order: 1,
      status: "draft",
      updatedAt: "2026-07-04T00:00:00.000Z"
    }
  ],
  recovery: {
    availableItems: []
  },
  activeChapterId: "ch_opening"
};

describe("M12 project workflow IPC", () => {
  test("exposes project workflow commands through preload without renderer filesystem access", async () => {
    const calls: string[] = [];
    const api = createNovelStudioApi({
      async invoke(channel, ...args) {
        calls.push(`${channel}:${args.length}`);
        return ok(workspaceSnapshot);
      }
    });

    await api.project.open("D:/Novel/M12");
    await api.project.create({
      projectRoot: "D:/Novel/M12",
      projectId: "prj_m12",
      title: "M12",
      language: "zh-CN"
    });
    await api.project.createChapter({
      chapterId: "ch_opening",
      title: "开篇"
    });
    await api.project.selectChapter("ch_opening");

    expect(calls).toEqual([
      "application:project:open:1",
      "application:project:create:1",
      "application:project:create-chapter:1",
      "application:project:select-chapter:1"
    ]);
  });

  test("routes project workflow IPC channels to the Application layer", async () => {
    const application = createFakeApplication();
    const handlers = createApplicationIpcHandlers(application);

    await expect(handlers["application:project:open"]("D:/Novel/M12")).resolves.toEqual(
      ok(workspaceSnapshot)
    );
    await expect(
      handlers["application:project:create"]({
        projectRoot: "D:/Novel/M12",
        projectId: "prj_m12",
        title: "M12",
        language: "zh-CN"
      })
    ).resolves.toEqual(ok(workspaceSnapshot));
    await expect(
      handlers["application:project:create-chapter"]({
        chapterId: "ch_opening",
        title: "开篇"
      })
    ).resolves.toEqual(ok(workspaceSnapshot));
    await expect(handlers["application:project:select-chapter"]("ch_opening")).resolves.toEqual(
      ok(workspaceSnapshot)
    );
  });
});

function createFakeApplication(): DesktopApplication {
  return {
    getShellState: () => shellState,
    listCommands: (): readonly ApplicationCommand[] => [],
    executeCommand: () => ok(shellState),
    openProject: () => Promise.resolve(ok(workspaceSnapshot)),
    createProject: () => Promise.resolve(ok(workspaceSnapshot)),
    listProjectChapters: () => Promise.resolve(ok(workspaceSnapshot.chapters)),
    createProjectChapter: () => Promise.resolve(ok(workspaceSnapshot)),
    selectProjectChapter: () => Promise.resolve(ok(workspaceSnapshot)),
    loadActiveChapter: unsupported,
    editActiveChapter: unsupported,
    saveActiveChapter: unsupported,
    listActiveChapterVersions: unsupported,
    previewActiveChapterVersion: unsupported,
    restoreActiveChapterVersion: unsupported,
    previewActiveChapterSuggestionDiff: () => ok({ title: "AI suggestion", changes: [] }),
    listModelProfiles: unsupported,
    saveModelProfile: unsupported,
    testModelProfileConnection: unsupported,
    loadConfigAsset: unsupported,
    saveConfigAsset: unsupported,
    restoreConfigAssetVersion: unsupported
  };
}

async function unsupported<T>(): Promise<Result<T, UnifiedError>> {
  throw new Error("Not used by this test.");
}
