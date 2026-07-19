import { describe, expect, test, vi } from "vitest";

import type {
  NovelStudioApi,
  ProjectWorkspaceSnapshotDto,
  WorkspaceActivationDto
} from "@novel-studio/application";
import { createUnifiedError, err, ok } from "@novel-studio/shared";

import { createProjectWorkflowBridge } from "../src/renderer/project-workflow-bridge.js";

describe("project workflow bridge", () => {
  test("opens a creative project explicitly without an ordinary-folder fallback", async () => {
    const openCreativeProject = vi.fn(async () => ok(creativeActivation()));
    const api = createApi({ openCreativeProject });
    const bridge = createProjectWorkflowBridge(api);

    const opened = await bridge.openProject();

    expect(openCreativeProject).toHaveBeenCalledWith("selection_open");
    expect(opened).toMatchObject({
      projectId: "prj_m12",
      activeChapterId: "chapter_1",
      status: "ready"
    });
    expect(opened.chapters[0]).toMatchObject({ id: "chapter_1" });
    expect(opened).not.toHaveProperty("fileTree");
    expect(opened).not.toHaveProperty("canInitializeProject");
    expect(JSON.stringify(opened)).not.toContain("D:/");
  });

  test("keeps the current project when an explicit creative open fails", async () => {
    const failure = createUnifiedError({
      code: "PROJECT_OPEN_FAILED",
      category: "StorageError",
      message: "Not a Novel Studio project.",
      recoverability: "user-action",
      suggestedAction: "Choose a creative project.",
      traceId: "project-workflow-bridge-test"
    });
    let fail = false;
    const api = createApi({
      openCreativeProject: vi.fn(async () => (fail ? err(failure) : ok(creativeActivation())))
    });
    const bridge = createProjectWorkflowBridge(api);
    await bridge.openProject();
    fail = true;

    const failed = await bridge.openProject();

    expect(failed.projectId).toBe("prj_m12");
    expect(failed.feedback).toMatchObject({ kind: "error", message: failure.message });
    expect(failed).not.toHaveProperty("fileTree");
    expect(failed).not.toHaveProperty("canInitializeProject");
  });

  test("mirrors title into folder name only until the folder is edited manually", async () => {
    const previewCreativeProject = vi.fn(async (input) =>
      ok({
        folderName: input.folderName,
        parentDisplayName: "Books",
        targetDisplayName: input.folderName
      })
    );
    const createCreativeProject = vi.fn(async () => ok(creativeActivation("prj_new", "Final")));
    const bridge = createProjectWorkflowBridge(
      createApi({ previewCreativeProject, createCreativeProject }),
      { createProjectId: () => "prj_new" }
    );

    bridge.setProjectTitleInput("First Title");
    expect(bridge.getProps().projectFolderNameInput).toBe("First Title");
    bridge.setProjectFolderNameInput("custom-folder");
    bridge.setProjectTitleInput("Final Title");
    expect(bridge.getProps().projectFolderNameInput).toBe("custom-folder");

    const selected = await bridge.chooseCreateParentDirectory();
    expect(selected).toMatchObject({
      selectedParentDisplayName: "Books",
      creationPreview: { targetDisplayName: "custom-folder" }
    });
    await bridge.createProject();

    expect(createCreativeProject).toHaveBeenCalledWith({
      parentSelectionId: "selection_parent",
      folderName: "custom-folder",
      projectId: "prj_new",
      title: "Final Title",
      language: "zh-CN"
    });
  });

  test("ignores a stale preview response after the folder name changes", async () => {
    const first = deferred<ReturnType<typeof ok>>();
    const second = deferred<ReturnType<typeof ok>>();
    const previewCreativeProject = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const bridge = createProjectWorkflowBridge(createApi({ previewCreativeProject }));
    await bridge.chooseCreateParentDirectory();

    bridge.setProjectFolderNameInput("first");
    bridge.setProjectFolderNameInput("second");
    second.resolve(
      ok({ folderName: "second", parentDisplayName: "Books", targetDisplayName: "second" })
    );
    await Promise.resolve();
    first.resolve(
      ok({ folderName: "first", parentDisplayName: "Books", targetDisplayName: "first" })
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(bridge.getProps().creationPreview?.folderName).toBe("second");
  });

  test("keeps chapter and recovery results on renderer-safe project DTOs", async () => {
    const selected = { ...creativeSnapshot(), activeChapterId: "chapter_2" };
    const api = createApi({
      selectChapter: vi.fn(async () => ok(selected)),
      discardRecoveryDraft: vi.fn(async () => ok(selected))
    });
    const bridge = createProjectWorkflowBridge(api);
    await bridge.openProject();

    const chapter = await bridge.selectChapter("chapter_2");
    const recovered = await bridge.discardRecoveryDraft("recovery_1");

    expect(chapter.activeChapterId).toBe("chapter_2");
    expect(recovered.activeChapterId).toBe("chapter_2");
    expect(JSON.stringify(recovered)).not.toContain("projectRoot");
  });
});

function createApi(overrides: Record<string, unknown> = {}): NovelStudioApi {
  const project = {
    chooseOpenCreativeDirectory: async () =>
      ok({ canceled: false, selectionId: "selection_open", displayName: "M12" }),
    chooseCreateParentDirectory: async () =>
      ok({ canceled: false, selectionId: "selection_parent", displayName: "Books" }),
    openCreativeProject: async () => ok(creativeActivation()),
    previewCreativeProject: async (input: { folderName: string }) =>
      ok({
        folderName: input.folderName,
        parentDisplayName: "Books",
        targetDisplayName: input.folderName
      }),
    createCreativeProject: async () => ok(creativeActivation("prj_new", "New")),
    listChapters: async () => ok(creativeSnapshot().chapters),
    createChapter: async () => ok(creativeSnapshot()),
    renameChapter: async () => ok(creativeSnapshot()),
    duplicateChapter: async () => ok(creativeSnapshot()),
    deleteChapter: async () => ok(creativeSnapshot()),
    selectChapter: async () => ok(creativeSnapshot()),
    previewRecoveryDraft: async () => {
      throw new Error("not used");
    },
    applyRecoveryDraft: async () => {
      throw new Error("not used");
    },
    discardRecoveryDraft: async () => ok(creativeSnapshot()),
    ...overrides
  };
  return { project } as unknown as NovelStudioApi;
}

function creativeActivation(
  projectId = "prj_m12",
  title = "M12"
): WorkspaceActivationDto {
  const creativeProject = creativeSnapshot(projectId, title);
  return {
    context: {
      kind: "creativeProject",
      workspaceId: projectId,
      projectId,
      displayName: title,
      capabilities: ["creativeWorkbench", "writingContext"]
    },
    creativeProject
  };
}

function creativeSnapshot(
  projectId = "prj_m12",
  title = "M12"
): ProjectWorkspaceSnapshotDto {
  return {
    project: {
      schemaVersion: "1.0",
      projectId,
      title,
      projectType: "novel",
      language: "zh-CN",
      createdAt: "2026-07-19T00:00:00.000Z",
      updatedAt: "2026-07-19T00:00:00.000Z"
    },
    settings: { schemaVersion: "1.0", autosave: {}, history: {}, models: {} },
    chapters: [
      { id: "chapter_1", title: "One", order: 1, status: "draft", updatedAt: "2026-07-19" },
      { id: "chapter_2", title: "Two", order: 2, status: "draft", updatedAt: "2026-07-19" }
    ],
    recovery: { availableItems: [] },
    health: {
      status: "healthy",
      checkedAt: "2026-07-19T00:00:00.000Z",
      summary: { errorCount: 0, warningCount: 0, infoCount: 0 },
      issues: []
    },
    activeChapterId: "chapter_1"
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
