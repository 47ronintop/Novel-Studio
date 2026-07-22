import { describe, expect, test, vi } from "vitest";

import type {
  NovelStudioApi,
  ProjectWorkspaceSnapshotDto,
  WorkspaceActivationDto
} from "@novel-studio/application";
import { createUnifiedError, err, ok } from "@novel-studio/shared";

import { createProjectWorkflowBridge } from "../src/renderer/project-workflow-bridge.js";

describe("project workflow bridge", () => {
  test("hydrates the active startup project before rendering its chapter navigator", async () => {
    const getActiveWorkspace = vi.fn(async () => ok(creativeSnapshot()));
    const bridge = createProjectWorkflowBridge(createApi({ getActiveWorkspace }));

    const loaded = await bridge.loadActiveProject("prj_m12");

    expect(getActiveWorkspace).toHaveBeenCalledOnce();
    expect(loaded).toMatchObject({
      projectId: "prj_m12",
      activeChapterId: "chapter_1",
      status: "ready"
    });
    expect(loaded.chapters.map((chapter) => chapter.id)).toEqual(["chapter_1", "chapter_2"]);
  });

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

  test("restores its internal ready state when project opening unexpectedly rejects", async () => {
    let rejectSelection = false;
    const bridge = createProjectWorkflowBridge(
      createApi({
        chooseOpenCreativeDirectory: async () => {
          if (rejectSelection) throw new Error("Project chooser crashed.");
          return ok({ canceled: false, selectionId: "selection_open", displayName: "M12" });
        }
      })
    );
    await bridge.openProject();
    rejectSelection = true;

    const failed = await bridge.openProject();

    expect(failed).toMatchObject({
      projectId: "prj_m12",
      status: "ready",
      feedback: { kind: "error", message: "Project chooser crashed." }
    });
    expect(bridge.getProps()).toMatchObject({
      projectId: "prj_m12",
      status: "ready",
      feedback: { kind: "error", message: "Project chooser crashed." }
    });
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

  test("passes the raw edited folder name to Repository-backed preview and creation", async () => {
    const previewCreativeProject = vi.fn(async (input) =>
      ok({
        folderName: input.folderName,
        parentDisplayName: "Books",
        targetDisplayName: input.folderName
      })
    );
    const createCreativeProject = vi.fn(async () => ok(creativeActivation("prj_raw", "Raw")));
    const bridge = createProjectWorkflowBridge(
      createApi({ previewCreativeProject, createCreativeProject }),
      { createProjectId: () => "prj_raw" }
    );
    bridge.setProjectTitleInput("Raw Folder Project");
    bridge.setProjectFolderNameInput("Novel. ");

    await bridge.chooseCreateParentDirectory();
    await bridge.createProject();

    expect(previewCreativeProject).toHaveBeenLastCalledWith({
      parentSelectionId: "selection_parent",
      folderName: "Novel. "
    });
    expect(createCreativeProject).toHaveBeenCalledWith(
      expect.objectContaining({
        parentSelectionId: "selection_parent",
        folderName: "Novel. "
      })
    );
  });

  test("restores its internal idle state when project creation unexpectedly rejects", async () => {
    const bridge = createProjectWorkflowBridge(
      createApi({
        createCreativeProject: async () => {
          throw new Error("Project creation crashed.");
        }
      })
    );
    bridge.setProjectTitleInput("New Project");
    await bridge.chooseCreateParentDirectory();

    const failed = await bridge.createProject();

    expect(failed).toMatchObject({
      status: "idle",
      feedback: { kind: "error", message: "Project creation crashed." }
    });
    expect(bridge.getProps()).toMatchObject({
      status: "idle",
      feedback: { kind: "error", message: "Project creation crashed." }
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
      selectChapterAndLoad: vi.fn(async () =>
        ok({ workspace: selected, chapterEditor: chapterEditorSnapshot("chapter_2", "Two") })
      ),
      discardRecoveryDraft: vi.fn(async () => ok(selected))
    });
    const bridge = createProjectWorkflowBridge(api);
    await bridge.openProject();

    const chapter = await bridge.selectChapterAndLoad("chapter_2");
    const recovered = await bridge.discardRecoveryDraft("recovery_1");

    expect(chapter.projectWorkflow.activeChapterId).toBe("chapter_2");
    expect(chapter.chapterEditor.chapter.frontmatter.id).toBe("chapter_2");
    expect(recovered.activeChapterId).toBe("chapter_2");
    expect(JSON.stringify(recovered)).not.toContain("projectRoot");
  });

  test("does not change the workflow snapshot or open tabs when atomic selection fails", async () => {
    const failure = createUnifiedError({
      code: "CHAPTER_LOAD_FAILED",
      category: "StorageError",
      message: "Chapter could not be loaded.",
      recoverability: "retryable",
      suggestedAction: "Retry chapter navigation.",
      traceId: "project-workflow-bridge-test"
    });
    const bridge = createProjectWorkflowBridge(
      createApi({ selectChapterAndLoad: vi.fn(async () => err(failure)) })
    );
    await bridge.openProject();
    const previous = JSON.stringify(bridge.getProps());

    await expect(bridge.selectChapterAndLoad("chapter_2")).rejects.toThrow(failure.message);

    expect(JSON.stringify(bridge.getProps())).toBe(previous);
  });

  test("keeps the active chapter and open tabs when closing the active tab cannot load its successor", async () => {
    const failure = createUnifiedError({
      code: "CHAPTER_LOAD_FAILED",
      category: "StorageError",
      message: "Successor chapter could not be loaded.",
      recoverability: "retryable",
      suggestedAction: "Retry closing the chapter tab.",
      traceId: "project-workflow-close-tab-test"
    });
    let failSuccessor = false;
    const selectChapter = vi.fn(async () => ok(creativeSnapshot()));
    const selectChapterAndLoad = vi.fn(async (chapterId: string) => {
      if (failSuccessor) return err(failure);
      return ok({
        workspace: { ...creativeSnapshot(), activeChapterId: chapterId },
        chapterEditor: chapterEditorSnapshot(chapterId, chapterId === "chapter_1" ? "One" : "Two")
      });
    });
    const bridge = createProjectWorkflowBridge(createApi({ selectChapter, selectChapterAndLoad }));
    await bridge.openProject();
    await bridge.selectChapterAndLoad("chapter_2");
    const previous = JSON.stringify(bridge.getProps());
    failSuccessor = true;

    await expect(bridge.closeChapterTab("chapter_2")).rejects.toThrow(failure.message);

    expect(selectChapterAndLoad).toHaveBeenLastCalledWith("chapter_1");
    expect(selectChapter).not.toHaveBeenCalled();
    expect(JSON.stringify(bridge.getProps())).toBe(previous);
  });

  test("returns the prepared successor editor when closing the active tab succeeds", async () => {
    const selectChapter = vi.fn(async () => ok(creativeSnapshot()));
    const selectChapterAndLoad = vi.fn(async (chapterId: string) =>
      ok({
        workspace: { ...creativeSnapshot(), activeChapterId: chapterId },
        chapterEditor: chapterEditorSnapshot(chapterId, chapterId === "chapter_1" ? "One" : "Two")
      })
    );
    const bridge = createProjectWorkflowBridge(createApi({ selectChapter, selectChapterAndLoad }));
    await bridge.openProject();
    await bridge.selectChapterAndLoad("chapter_2");

    const closed = await bridge.closeChapterTab("chapter_2");

    expect(closed.projectWorkflow.activeChapterId).toBe("chapter_1");
    expect(closed.projectWorkflow.openChapterTabIds).toEqual(["chapter_1"]);
    expect(closed.chapterEditor?.chapter.frontmatter.id).toBe("chapter_1");
    expect(selectChapter).not.toHaveBeenCalled();
  });
});

function createApi(overrides: Record<string, unknown> = {}): NovelStudioApi {
  const project = {
    getActiveWorkspace: async () => ok(creativeSnapshot()),
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
    selectChapterAndLoad: async () =>
      ok({
        workspace: creativeSnapshot(),
        chapterEditor: chapterEditorSnapshot("chapter_1", "One")
      }),
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

function chapterEditorSnapshot(chapterId: string, title: string) {
  return {
    state: {
      chapter: {
        frontmatter: {
          schemaVersion: "1.0" as const,
          id: chapterId,
          title,
          order: chapterId === "chapter_1" ? 1 : 2,
          status: "draft",
          createdAt: "2026-07-19T00:00:00.000Z",
          updatedAt: "2026-07-19T00:00:00.000Z"
        },
        body: `${title} body`
      },
      dirty: false,
      saveStatus: "Saved" as const
    },
    versions: []
  };
}

function creativeActivation(projectId = "prj_m12", title = "M12"): WorkspaceActivationDto {
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

function creativeSnapshot(projectId = "prj_m12", title = "M12"): ProjectWorkspaceSnapshotDto {
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
