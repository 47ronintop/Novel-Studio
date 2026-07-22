import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";

import type { DesktopApplication, ProjectWorkspaceSnapshot } from "@novel-studio/application";
import { ok } from "@novel-studio/shared";

import { createApplicationIpcHandlers } from "../src/main/ipc-handlers.js";
import { createNovelStudioApi } from "../src/preload/api.js";

describe("Task 5 explicit workspace IPC", () => {
  test("exposes only opaque project/workspace operations through preload", async () => {
    const calls: Array<{ channel: string; args: readonly unknown[] }> = [];
    const api = createNovelStudioApi({
      async invoke(channel, ...args) {
        calls.push({ channel, args });
        return ok({ canceled: false, selectionId: "selection_1", displayName: "Novel" });
      }
    });

    await api.project.getActiveWorkspace();
    await api.project.chooseOpenCreativeDirectory();
    await api.project.openCreativeProject("selection_1");
    await api.project.chooseCreateParentDirectory();
    await api.project.previewCreativeProject({
      parentSelectionId: "selection_1",
      folderName: "new-book"
    });
    await api.project.createCreativeProject({
      parentSelectionId: "selection_1",
      folderName: "new-book",
      projectId: "prj_new",
      title: "New Book",
      language: "en"
    });
    await api.project.selectChapterAndLoad("chapter_1");
    await api.workspace.chooseEngineeringDirectory();
    await api.workspace.chooseTextFile();
    await api.workspace.openEngineeringWorkspace("selection_1");
    await api.workspace.refreshEngineeringTree();
    await api.workspace.readTextFile("notes/scene.md");
    await api.workspace.saveTextFile({
      path: "notes/scene.md",
      content: "updated",
      expectedChecksum: "sha256:old"
    });

    expect(calls.map(({ channel }) => channel)).toEqual([
      "application:project:get-active-workspace",
      "application:project:choose-open-creative-directory",
      "application:project:open-creative-project",
      "application:project:choose-create-parent-directory",
      "application:project:preview-creative-project",
      "application:project:create-creative-project",
      "application:project:select-chapter-and-load",
      "application:workspace:choose-engineering-directory",
      "application:workspace:choose-text-file",
      "application:workspace:open-engineering-workspace",
      "application:workspace:refresh-engineering-tree",
      "application:workspace:read-text-file",
      "application:workspace:save-text-file"
    ]);
  });

  test("keeps canonical directory paths in main-only selection tokens", async () => {
    const root = await mkdtemp(join(tmpdir(), "novel-studio-selection-"));
    try {
      const canonicalRoot = await realpath(root);
      const coordinator = {
        openCreativeProject: vi.fn(async (path: string) => ok({ path })),
        createCreativeProject: vi.fn(async () => ok({})),
        openEngineeringWorkspace: vi.fn(async (path: string) => ok({ path }))
      };
      const handlers = createApplicationIpcHandlers(undefined, {
        chooseOpenProjectDirectory: async () => root,
        chooseCreateProjectDirectory: async () => root,
        chooseEngineeringDirectory: async () => root,
        workspaceActivationCoordinator: coordinator as never
      }) as Record<string, (...args: readonly unknown[]) => Promise<unknown>>;

      const selected = await handlers["application:project:choose-open-creative-directory"]();
      expect(selected).toMatchObject({
        ok: true,
        value: { canceled: false, displayName: expect.any(String) }
      });
      expect(JSON.stringify(selected)).not.toContain(canonicalRoot);
      const selectionId = (selected as { value: { selectionId: string } }).value.selectionId;

      await handlers["application:project:open-creative-project"](selectionId);
      expect(coordinator.openCreativeProject).toHaveBeenCalledWith(canonicalRoot);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("returns only a project-relative path for selected context files", async () => {
    const root = await mkdtemp(join(tmpdir(), "novel-studio-project-file-"));
    const outsideRoot = await mkdtemp(join(tmpdir(), "novel-studio-outside-file-"));
    try {
      const projectFile = join(root, "notes.md");
      const outsideFile = join(outsideRoot, "outside.md");
      await Promise.all([
        writeFile(projectFile, "inside", "utf8"),
        writeFile(outsideFile, "outside", "utf8")
      ]);
      let selectedPath = projectFile;
      const handlers = createApplicationIpcHandlers(undefined, {
        chooseProjectTextFile: async () => selectedPath,
        agentRuntimeManager: {
          currentWorkspace: () => ({
            workspaceId: "workspace_01",
            contentRoot: root,
            stateRoot: root
          }),
          subscribeAgentRunEvents: () => () => undefined
        } as never
      });

      const selected = await handlers["application:workspace:choose-text-file"]();

      expect(selected).toEqual({
        ok: true,
        value: { canceled: false, relativePath: "notes.md", displayName: "notes.md" }
      });
      expect(JSON.stringify(selected)).not.toContain(await realpath(root));

      selectedPath = outsideFile;
      await expect(handlers["application:workspace:choose-text-file"]()).resolves.toMatchObject({
        ok: false,
        error: { code: "PROJECT_FILE_SELECTION_INVALID" }
      });
    } finally {
      await Promise.all([
        rm(root, { recursive: true, force: true }),
        rm(outsideRoot, { recursive: true, force: true })
      ]);
    }
  });

  test("projects chapter and recovery results before crossing IPC", async () => {
    const snapshot = projectSnapshot();
    const chapterEditor = {
      state: {
        chapter: {
          frontmatter: {
            schemaVersion: "1.0" as const,
            id: "chapter_1",
            title: "One",
            order: 1,
            status: "draft",
            createdAt: "2026-07-19T00:00:00.000Z",
            updatedAt: "2026-07-19T00:00:00.000Z"
          },
          body: "Draft"
        },
        dirty: true,
        saveStatus: "Unsaved" as const
      },
      versions: []
    };
    const handlers = createApplicationIpcHandlers({
      getActiveProjectWorkspace: () => ok(snapshot),
      createProjectChapter: async () => ok(snapshot),
      selectProjectChapterAndLoad: async () => ok({ workspace: snapshot, chapterEditor }),
      applyRecoveryDraft: async () =>
        ok({
          workspace: snapshot,
          chapterEditor
        })
    } as unknown as DesktopApplication);

    const activeWorkspace = await handlers["application:project:get-active-workspace"]();
    const chapter = await handlers["application:project:create-chapter"]({
      chapterId: "chapter_1",
      title: "One"
    });
    const selected = await handlers["application:project:select-chapter-and-load"]("chapter_1");
    const recovered = await handlers["application:project:apply-recovery-draft"]("recovery_1");

    expect(JSON.stringify(activeWorkspace)).not.toContain("projectRoot");
    expect(activeWorkspace).toMatchObject({
      ok: true,
      value: { project: { projectId: "prj_secret" } }
    });
    expect(JSON.stringify(chapter)).not.toContain("projectRoot");
    expect(JSON.stringify(selected)).not.toContain("projectRoot");
    expect(selected).toMatchObject({
      ok: true,
      value: { workspace: { project: { projectId: "prj_secret" } }, chapterEditor }
    });
    expect(JSON.stringify(recovered)).not.toContain("projectRoot");
  });
});

function projectSnapshot(): ProjectWorkspaceSnapshot {
  return {
    projectRoot: "D:/Novel/Secret",
    project: {
      schemaVersion: "1.0",
      projectId: "prj_secret",
      title: "Secret",
      projectType: "novel",
      language: "en",
      createdAt: "2026-07-19T00:00:00.000Z",
      updatedAt: "2026-07-19T00:00:00.000Z"
    },
    settings: { schemaVersion: "1.0", autosave: {}, history: {}, models: {} },
    chapters: [],
    recovery: { availableItems: [] },
    health: {
      status: "healthy",
      checkedAt: "2026-07-19T00:00:00.000Z",
      summary: { errorCount: 0, warningCount: 0, infoCount: 0 },
      issues: []
    },
    lock: {
      schemaVersion: "1.0",
      ownerId: "window_test",
      projectRoot: "D:/Novel/Secret",
      acquiredAt: "2026-07-19T00:00:00.000Z"
    }
  };
}
