import { mkdtemp, realpath, rm } from "node:fs/promises";
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
    await api.workspace.chooseEngineeringDirectory();
    await api.workspace.openEngineeringWorkspace("selection_1");
    await api.workspace.refreshEngineeringTree();
    await api.workspace.readTextFile("notes/scene.md");
    await api.workspace.saveTextFile({
      path: "notes/scene.md",
      content: "updated",
      expectedChecksum: "sha256:old"
    });

    expect(calls.map(({ channel }) => channel)).toEqual([
      "application:project:choose-open-creative-directory",
      "application:project:open-creative-project",
      "application:project:choose-create-parent-directory",
      "application:project:preview-creative-project",
      "application:project:create-creative-project",
      "application:workspace:choose-engineering-directory",
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

  test("projects chapter and recovery results before crossing IPC", async () => {
    const snapshot = projectSnapshot();
    const handlers = createApplicationIpcHandlers({
      createProjectChapter: async () => ok(snapshot),
      applyRecoveryDraft: async () =>
        ok({
          workspace: snapshot,
          chapterEditor: {
            state: {
              chapter: {
                frontmatter: {
                  schemaVersion: "1.0",
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
              saveStatus: "Unsaved"
            },
            versions: []
          }
        })
    } as unknown as DesktopApplication);

    const chapter = await handlers["application:project:create-chapter"]({
      chapterId: "chapter_1",
      title: "One"
    });
    const recovered = await handlers["application:project:apply-recovery-draft"]("recovery_1");

    expect(JSON.stringify(chapter)).not.toContain("projectRoot");
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
