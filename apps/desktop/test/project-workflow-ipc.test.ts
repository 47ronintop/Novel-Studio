import { describe, expect, test } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { ok, type ChapterDocument, type Result, type UnifiedError } from "@novel-studio/shared";
import type {
  ApplicationCommand,
  DesktopApplication,
  DesktopShellState,
  ProjectRecoveryDraftPreview,
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

const recoveryPreview: ProjectRecoveryDraftPreview = {
  sessionId: "session_prj_m49_ch_opening",
  chapterId: "ch_opening",
  chapterTitle: "开篇",
  updatedAt: "2026-07-06T00:05:00.000Z",
  body: "恢复草稿正文\n"
};

const recoveredChapter: ChapterDocument = {
  frontmatter: {
    schemaVersion: "1.0",
    id: "ch_opening",
    title: "开篇",
    order: 1,
    status: "draft",
    createdAt: "2026-07-04T00:00:00.000Z",
    updatedAt: "2026-07-06T00:05:00.000Z"
  },
  body: "恢复草稿正文\n"
};

const recoveryApplyResult = {
  workspace: workspaceSnapshot,
  chapterEditor: {
    state: {
      chapter: recoveredChapter,
      dirty: true,
      saveStatus: "Unsaved" as const
    },
    versions: []
  }
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
    await api.project.readDirectory("D:/Novel/M12");
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
    await api.project.previewRecoveryDraft("session_prj_m49_ch_opening");
    await api.project.applyRecoveryDraft("session_prj_m49_ch_opening");
    await api.project.discardRecoveryDraft("session_prj_m49_ch_opening");

    expect(calls).toEqual([
      "application:project:open:1",
      "application:project:read-directory:1",
      "application:project:create:1",
      "application:project:create-chapter:1",
      "application:project:select-chapter:1",
      "application:project:preview-recovery-draft:1",
      "application:project:apply-recovery-draft:1",
      "application:project:discard-recovery-draft:1"
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
    await expect(
      handlers["application:project:preview-recovery-draft"]("session_prj_m49_ch_opening")
    ).resolves.toEqual(ok(recoveryPreview));
    await expect(
      handlers["application:project:apply-recovery-draft"]("session_prj_m49_ch_opening")
    ).resolves.toEqual(ok(recoveryApplyResult));
    await expect(
      handlers["application:project:discard-recovery-draft"]("session_prj_m49_ch_opening")
    ).resolves.toEqual(ok(workspaceSnapshot));
  });

  test("reads ordinary folder trees through the project directory IPC channel", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-folder-"));
    try {
      await mkdir(join(projectRoot, "notes"));
      await writeFile(join(projectRoot, "INDEX.md"), "# Index\n", "utf8");
      await writeFile(join(projectRoot, "notes", "scene.md"), "Scene\n", "utf8");

      const handlers = createApplicationIpcHandlers(createFakeApplication());
      const result = await handlers["application:project:read-directory"](projectRoot);

      expect(result).toEqual(
        ok([
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
          },
          {
            id: "file:INDEX.md",
            name: "INDEX.md",
            kind: "file",
            path: "INDEX.md"
          }
        ])
      );
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
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
    previewRecoveryDraft: () => Promise.resolve(ok(recoveryPreview)),
    applyRecoveryDraft: () => Promise.resolve(ok(recoveryApplyResult)),
    discardRecoveryDraft: () => Promise.resolve(ok(workspaceSnapshot)),
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
    restoreConfigAssetVersion: unsupported,
    loadUserPreferences: unsupported,
    saveUserPreferences: unsupported
  };
}

async function unsupported<T>(): Promise<Result<T, UnifiedError>> {
  throw new Error("Not used by this test.");
}
