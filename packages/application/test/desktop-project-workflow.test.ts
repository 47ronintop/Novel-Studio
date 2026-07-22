import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { createUnifiedError, err, isErr, isOk, ok } from "@novel-studio/shared";
import type { Result, UnifiedError } from "@novel-studio/shared";
import {
  ChapterFileRepository,
  HistoryRepository,
  ProjectCreationFileRepository,
  ProjectFileRepository,
  RecoveryRepository
} from "@novel-studio/repository";

import {
  createDesktopApplication,
  toProjectWorkspaceSnapshotDto
} from "../src/desktop-application.js";
import type { ChapterEditorSession } from "../src/chapter-editor-session.js";
import type { EngineeringWorkspaceSession } from "../src/engineering-workspace-session.js";
import { createProjectWorkspaceSession } from "../src/project-workspace-session.js";
import type { StoryBibleSession } from "../src/story-bible-session.js";
import type {
  ProjectCreationRepositoryPort,
  ProjectWorkspaceSession,
  ProjectWorkspaceSnapshot
} from "../src/project-workspace-session.js";

const tempRoots: string[] = [];

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("M12 desktop project workflow", () => {
  test("prepares a creative workspace without changing the active application until commit", async () => {
    const oldSnapshot = projectSnapshot("D:/Novel/Old", "prj_old", "Old Project");
    const candidateSnapshot = projectSnapshot("D:/Novel/New", "prj_new", "New Project");
    const oldCalls: string[] = [];
    const candidateCalls: string[] = [];
    const oldSession = fakeProjectSession(oldSnapshot, oldCalls);
    const candidateSession = fakeProjectSession(candidateSnapshot, candidateCalls);
    const application = createDesktopApplication({
      projectWorkspaceSession: oldSession,
      createProjectWorkspaceSession: () => candidateSession,
      projectCreationRepository: fakeCreationRepository(),
      createWorkspaceActivationId: () => "activation_creative"
    });
    const beforeShell = application.getShellState();
    expect(beforeShell).toMatchObject({
      projectTitle: "Old Project",
      workspaceContext: {
        kind: "creativeProject",
        workspaceId: "prj_old",
        projectId: "prj_old",
        displayName: "Old Project"
      }
    });
    expect(application.getActiveProjectWorkspace()).toEqual(ok(oldSnapshot));

    const prepared = await application.prepareOpenCreativeProject("D:/Novel/New");

    expect(prepared).toMatchObject({
      ok: true,
      value: {
        activationId: "activation_creative",
        context: {
          kind: "creativeProject",
          workspaceId: "prj_new",
          projectId: "prj_new",
          contentRoot: "D:/Novel/New",
          stateRoot: "D:/Novel/New"
        }
      }
    });
    expect(application.getShellState()).toEqual(beforeShell);
    expect(await application.listProjectChapters()).toEqual(ok(oldSnapshot.chapters));
    expect(oldCalls).toContain("list");
    expect(candidateCalls).toEqual(["open:D:/Novel/New"]);
    if (!prepared.ok) {
      throw new Error(prepared.error.message);
    }

    const committed = application.commitWorkspaceActivation(prepared.value.activationId);

    expect(committed.context).toMatchObject({
      kind: "creativeProject",
      workspaceId: "prj_new",
      projectId: "prj_new"
    });
    expect(committed).toMatchObject({
      creativeProject: {
        project: { projectId: "prj_new", title: "New Project" },
        lock: { ownerId: "window_test" }
      }
    });
    expect(hasForbiddenRootKey(committed)).toBe(false);
    expect(application.getShellState().workspaceContext).toEqual(committed.context);
    expect(await application.listProjectChapters()).toEqual(ok(candidateSnapshot.chapters));
  });

  test("forces engineering mode and disables creative chapter workflows after engineering commit", async () => {
    const oldSnapshot = projectSnapshot("D:/Novel/Old", "prj_old", "Old Project");
    const legacyChapterCalls: string[] = [];
    const aiFactoryCalls: string[] = [];
    const application = createDesktopApplication({
      projectWorkspaceSession: fakeProjectSession(oldSnapshot),
      chapterEditorSession: {
        async load() {
          legacyChapterCalls.push("load");
          throw new Error("legacy chapter editor must not be used in engineering context");
        }
      } as unknown as ChapterEditorSession,
      createAiWritingWorkflowSession() {
        aiFactoryCalls.push("create");
        throw new Error("creative AI workflow must not be created in engineering context");
      },
      createEngineeringWorkspaceSession: () => fakeEngineeringWorkspaceSession(),
      createWorkspaceActivationId: () => "activation_engineering"
    });

    const prepared = await application.prepareOpenEngineeringWorkspace("D:/Source");
    if (!prepared.ok) throw new Error(prepared.error.message);
    application.commitWorkspaceActivation(prepared.value.activationId);

    expect(application.getShellState()).toMatchObject({
      workspaceContext: { kind: "engineeringWorkspace", workspaceId: "ws_source" },
      workbenchMode: "engineering"
    });
    await expect(application.loadActiveChapter()).resolves.toMatchObject({
      ok: false,
      error: { code: "CHAPTER_EDITOR_UNAVAILABLE" }
    });
    await expect(
      application.generateActiveChapterSuggestion({ instruction: "Continue." })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "AI_WRITING_WORKFLOW_UNAVAILABLE" }
    });
    expect(legacyChapterCalls).toEqual([]);
    expect(aiFactoryCalls).toEqual([]);
  });

  test("commits the complete creative activation when cache invalidation hooks throw", async () => {
    const oldSnapshot = projectSnapshot("D:/Novel/Old", "prj_old", "Old Project");
    const candidateSnapshot = projectSnapshot("D:/Novel/New", "prj_new", "New Project");
    const candidateSession = fakeProjectSession(candidateSnapshot);
    const application = createDesktopApplication({
      projectWorkspaceSession: fakeProjectSession(oldSnapshot),
      createProjectWorkspaceSession: () => candidateSession,
      projectCreationRepository: fakeCreationRepository(),
      createWorkspaceActivationId: () => "activation_hook_failure",
      onActiveProjectRootChange() {
        throw new Error("root hook failed");
      },
      storyBibleSession: {
        getSnapshot: () => undefined,
        clearSnapshot() {
          throw new Error("cache reset failed");
        }
      } as unknown as StoryBibleSession
    });

    const prepared = await application.prepareOpenCreativeProject("D:/Novel/New");
    if (!prepared.ok) throw new Error(prepared.error.message);

    expect(() => application.commitWorkspaceActivation(prepared.value.activationId)).not.toThrow();
    expect(application.getShellState()).toMatchObject({
      workspaceContext: { kind: "creativeProject", workspaceId: "prj_new" },
      projectTitle: "New Project"
    });
    await expect(application.listProjectChapters()).resolves.toEqual(
      ok(candidateSnapshot.chapters)
    );
  });

  test("refreshes project-scoped bindings after legacy open and create operations", async () => {
    const openedSnapshot = projectSnapshot("D:/Novel/Opened", "prj_opened", "Opened Project");
    const createdSnapshot = projectSnapshot("D:/Novel/Created", "prj_created", "Created Project");
    let activeSnapshot = projectSnapshot("D:/Novel/Old", "prj_old", "Old Project");
    const activeRoots: Array<string | undefined> = [];
    let cacheClearCount = 0;
    const projectSession = {
      getSnapshot: () => activeSnapshot,
      getActiveChapterEditorSession: () => undefined,
      async openProject() {
        activeSnapshot = openedSnapshot;
        return ok(openedSnapshot);
      },
      async createProjectInParent() {
        activeSnapshot = createdSnapshot;
        return ok(createdSnapshot);
      }
    } as unknown as ProjectWorkspaceSession;
    const application = createDesktopApplication({
      projectWorkspaceSession: projectSession,
      onActiveProjectRootChange: (projectRoot) => activeRoots.push(projectRoot),
      storyBibleSession: {
        getSnapshot: () => undefined,
        clearSnapshot: () => {
          cacheClearCount += 1;
        }
      } as unknown as StoryBibleSession
    });

    await expect(application.openProject("D:/Novel/Opened")).resolves.toEqual(ok(openedSnapshot));
    await expect(
      application.createProjectInParent({
        parentDirectory: "D:/Novel",
        folderName: "Created",
        projectId: "prj_created",
        title: "Created Project",
        language: "en"
      })
    ).resolves.toEqual(ok(createdSnapshot));

    expect(activeRoots).toEqual(["D:/Novel/Opened", "D:/Novel/Created"]);
    expect(cacheClearCount).toBe(2);
  });

  test("discards a created creative candidate by releasing its lock before child cleanup", async () => {
    const oldSnapshot = projectSnapshot("D:/Novel/Old", "prj_old", "Old Project");
    const candidateSnapshot = projectSnapshot(
      "D:/Novel/Parent/new-book",
      "prj_new_book",
      "New Book"
    );
    const order: string[] = [];
    const candidateSession = fakeProjectSession(candidateSnapshot, order);
    const creationRepository = fakeCreationRepository(order);
    const application = createDesktopApplication({
      projectWorkspaceSession: fakeProjectSession(oldSnapshot),
      createProjectWorkspaceSession: () => candidateSession,
      projectCreationRepository: creationRepository,
      createWorkspaceActivationId: () => "activation_create"
    });

    const prepared = await application.prepareCreateCreativeProject({
      parentDirectory: "D:/Novel/Parent",
      folderName: "new-book",
      projectId: "prj_new_book",
      title: "New Book",
      language: "en"
    });
    expect(prepared).toMatchObject({ ok: true });
    if (!prepared.ok) {
      throw new Error(prepared.error.message);
    }

    const discarded = await application.discardWorkspaceActivation(prepared.value.activationId);

    expect(discarded).toEqual(ok(undefined));
    expect(order).toEqual([
      "create:D:/Novel/Parent/new-book",
      "release:D:/Novel/Parent/new-book",
      "cleanup:D:/Novel/Parent/new-book"
    ]);
    expect(application.getShellState().projectTitle).toBe("Old Project");
  });

  test("reports the first discard cleanup failure after attempting every cleanup step", async () => {
    const candidateSnapshot = projectSnapshot(
      "D:/Novel/Parent/new-book",
      "prj_new_book",
      "New Book"
    );
    const order: string[] = [];
    const releaseFailure = createUnifiedError({
      code: "PROJECT_LOCK_RELEASE_FAILED",
      category: "StorageError",
      message: "Project lock release failed.",
      recoverability: "retryable",
      suggestedAction: "Retry cleanup.",
      traceId: "task5-discard-release"
    });
    const cleanupFailure = createUnifiedError({
      code: "PROJECT_CREATE_CLEANUP_FAILED",
      category: "StorageError",
      message: "Project cleanup failed.",
      recoverability: "retryable",
      suggestedAction: "Retry cleanup.",
      traceId: "task5-discard-cleanup"
    });
    const application = createDesktopApplication({
      createProjectWorkspaceSession: () =>
        fakeProjectSession(candidateSnapshot, order, err(releaseFailure)),
      projectCreationRepository: fakeCreationRepository(order, err(cleanupFailure)),
      createWorkspaceActivationId: () => "activation_create_failure"
    });
    const prepared = await application.prepareCreateCreativeProject({
      parentDirectory: "D:/Novel/Parent",
      folderName: "new-book",
      projectId: "prj_new_book",
      title: "New Book",
      language: "en"
    });
    if (!prepared.ok) throw new Error(prepared.error.message);

    const discarded = await application.discardWorkspaceActivation(prepared.value.activationId);

    expect(discarded).toEqual(err(releaseFailure));
    expect(order).toEqual([
      "create:D:/Novel/Parent/new-book",
      "release:D:/Novel/Parent/new-book",
      "cleanup:D:/Novel/Parent/new-book"
    ]);
  });

  test("shutdown discards prepared candidates before releasing the active workspace", async () => {
    const order: string[] = [];
    const oldSnapshot = projectSnapshot("D:/Novel/Old", "prj_old", "Old Project");
    const candidateSnapshot = projectSnapshot(
      "D:/Novel/Parent/new-book",
      "prj_new_book",
      "New Book"
    );
    const application = createDesktopApplication({
      projectWorkspaceSession: fakeProjectSession(oldSnapshot, order),
      createProjectWorkspaceSession: () => fakeProjectSession(candidateSnapshot, order),
      projectCreationRepository: fakeCreationRepository(order),
      createWorkspaceActivationId: () => "activation_shutdown"
    });
    const prepared = await application.prepareCreateCreativeProject({
      parentDirectory: "D:/Novel/Parent",
      folderName: "new-book",
      projectId: "prj_new_book",
      title: "New Book",
      language: "en"
    });
    if (!prepared.ok) throw new Error(prepared.error.message);

    expect(await application.shutdown()).toEqual(ok(undefined));
    expect(order).toEqual([
      "create:D:/Novel/Parent/new-book",
      "release:D:/Novel/Parent/new-book",
      "cleanup:D:/Novel/Parent/new-book",
      "release:D:/Novel/Old"
    ]);
  });

  test("projects workspace snapshots without renderer-visible roots", () => {
    const source = projectSnapshot("D:/Novel/Secret", "prj_secret", "Secret Project");

    const dto = toProjectWorkspaceSnapshotDto(source);

    expect(dto).toMatchObject({
      project: { projectId: "prj_secret" },
      lock: { ownerId: "window_test" }
    });
    expect(hasForbiddenRootKey(dto)).toBe(false);
    expect(source.projectRoot).toBe("D:/Novel/Secret");
    expect(source.lock?.projectRoot).toBe("D:/Novel/Secret");
  });

  test("creates a project in a child directory through the desktop application", async () => {
    const parentDirectory = await createTempRoot();
    const canonicalParent = await realpath(parentDirectory);
    const application = createDesktopApplication({
      projectWorkspaceSession: createProjectWorkspaceSession({
        projectCreationRepository: new ProjectCreationFileRepository({
          now: () => "2026-07-19T00:00:00.000Z"
        }),
        now: () => "2026-07-19T00:00:00.000Z",
        createProjectRepository: (root) =>
          new ProjectFileRepository({
            projectRoot: root,
            now: () => "2026-07-19T00:00:00.000Z"
          }),
        createChapterRepository: (root) =>
          new ChapterFileRepository({
            projectRoot: root,
            now: () => "2026-07-19T00:00:00.000Z"
          }),
        createHistoryRepository: (root) =>
          new HistoryRepository({
            projectRoot: root,
            now: () => "2026-07-19T00:00:00.000Z",
            createVersionId: () => "ver_task4_desktop"
          }),
        createRecoveryRepository: (root) => new RecoveryRepository({ projectRoot: root })
      })
    });

    const created = await application.createProjectInParent({
      parentDirectory,
      folderName: "desktop-child",
      projectId: "prj_task4_desktop",
      title: "Desktop Child Project",
      language: "en"
    });

    expect(isOk(created)).toBe(true);
    if (isErr(created)) {
      throw new Error(created.error.message);
    }
    expect(created.value.projectRoot).toBe(join(canonicalParent, "desktop-child"));
    expect(created.value.project.title).toBe("Desktop Child Project");
    expect(application.getShellState().projectTitle).toBe("Desktop Child Project");
  });

  test("creates a project, creates chapters, switches active chapter, and saves through the active editor", async () => {
    const projectRoot = await createTempRoot();
    const application = createDesktopApplication({
      projectWorkspaceSession: createProjectWorkspaceSession({
        projectCreationRepository: new ProjectCreationFileRepository({
          now: () => "2026-07-04T00:00:00.000Z"
        }),
        now: () => "2026-07-04T00:00:00.000Z",
        createProjectRepository: (root) =>
          new ProjectFileRepository({
            projectRoot: root,
            now: () => "2026-07-04T00:00:00.000Z"
          }),
        createChapterRepository: (root) =>
          new ChapterFileRepository({
            projectRoot: root,
            now: () => "2026-07-04T00:00:00.000Z"
          }),
        createHistoryRepository: (root) =>
          new HistoryRepository({
            projectRoot: root,
            now: () => "2026-07-04T00:00:00.000Z",
            createVersionId: () => "ver_m12_desktop"
          }),
        createRecoveryRepository: (root) =>
          new RecoveryRepository({
            projectRoot: root
          })
      })
    });

    const createdProject = await application.createProjectInParent({
      parentDirectory: projectRoot,
      folderName: "m12-desktop",
      projectId: "prj_m12_desktop",
      title: "M12 Desktop",
      language: "zh-CN"
    });
    const opening = await application.createProjectChapter({
      chapterId: "ch_opening",
      title: "开篇",
      body: "开篇正文\n"
    });
    const second = await application.createProjectChapter({
      chapterId: "ch_second",
      title: "第二章",
      body: "第二章正文\n"
    });
    const selected = await application.selectProjectChapterAndLoad("ch_second");
    const edited = await application.editActiveChapter("第二章修改后正文\n");
    const saved = await application.saveActiveChapter();

    expect(isOk(createdProject)).toBe(true);
    expect(isOk(opening)).toBe(true);
    expect(isOk(second)).toBe(true);
    expect(isOk(selected)).toBe(true);
    expect(isOk(edited)).toBe(true);
    expect(isOk(saved)).toBe(true);
    if (isErr(selected)) {
      throw new Error(selected.error.message);
    }
    if (isErr(saved)) {
      throw new Error(saved.error.message);
    }

    expect(application.getShellState().projectTitle).toBe("M12 Desktop");
    expect(application.getShellState().navigatorSections[0]).toMatchObject({
      id: "chapters",
      itemCount: 2
    });
    expect(selected.value.workspace.activeChapterId).toBe("ch_second");
    expect(selected.value.chapterEditor.state.chapter.frontmatter.title).toBe("第二章");
    expect(hasForbiddenRootKey(selected.value)).toBe(false);
    expect(saved.value.state.chapter.frontmatter.title).toBe("第二章");
    expect(saved.value.state.chapter.body).toBe("第二章修改后正文\n");
  });
});

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "novel-studio-m12-desktop-"));
  tempRoots.push(root);
  return root;
}

function projectSnapshot(
  projectRoot: string,
  projectId: string,
  title: string
): ProjectWorkspaceSnapshot {
  return {
    projectRoot,
    project: {
      schemaVersion: "1.0",
      projectId,
      title,
      projectType: "novel",
      language: "en",
      createdAt: "2026-07-19T00:00:00.000Z",
      updatedAt: "2026-07-19T00:00:00.000Z"
    },
    settings: {
      schemaVersion: "1.0",
      autosave: {},
      history: {},
      models: {}
    },
    chapters: [],
    recovery: { availableItems: [] },
    health: {
      status: "healthy",
      checkedAt: "2026-07-19T00:00:00.000Z",
      summary: { errorCount: 0, warningCount: 0, infoCount: 1 },
      issues: []
    },
    lock: {
      schemaVersion: "1.0",
      ownerId: "window_test",
      projectRoot,
      acquiredAt: "2026-07-19T00:00:00.000Z"
    }
  };
}

function fakeProjectSession(
  snapshot: ProjectWorkspaceSnapshot,
  calls: string[] = [],
  releaseResult: Result<void, UnifiedError> = ok(undefined)
): ProjectWorkspaceSession {
  return {
    getSnapshot: () => snapshot,
    getActiveChapterEditorSession: () => undefined,
    async openProject(projectRoot: string) {
      calls.push(`open:${projectRoot}`);
      return ok(snapshot);
    },
    async createProjectInParent() {
      calls.push(`create:${snapshot.projectRoot}`);
      return ok(snapshot);
    },
    async listChapters() {
      calls.push("list");
      return ok(snapshot.chapters);
    },
    async releaseProjectLock() {
      calls.push(`release:${snapshot.projectRoot}`);
      return releaseResult;
    }
  } as unknown as ProjectWorkspaceSession;
}

function fakeCreationRepository(
  order: string[] = [],
  cleanupResult: Result<void, UnifiedError> = ok(undefined)
): ProjectCreationRepositoryPort {
  return {
    async previewProjectInParent(input) {
      return ok({
        parentDirectory: input.parentDirectory,
        folderName: input.folderName,
        projectRoot: join(input.parentDirectory, input.folderName),
        parentDisplayName: "Parent",
        targetDisplayName: input.folderName
      });
    },
    async createProjectInParent(input) {
      order.push(`create:${join(input.parentDirectory, input.folderName)}`);
      return ok({
        projectRoot: join(input.parentDirectory, input.folderName),
        snapshot: projectSnapshot(
          join(input.parentDirectory, input.folderName),
          input.projectId,
          input.title
        )
      });
    },
    async cleanupCreatedProject(projectRoot) {
      order.push(`cleanup:${projectRoot}`);
      return cleanupResult;
    }
  };
}

function fakeEngineeringWorkspaceSession(): EngineeringWorkspaceSession {
  const activation = {
    context: {
      kind: "engineeringWorkspace" as const,
      workspaceId: "ws_source",
      displayName: "Source",
      contentRoot: "D:/Source",
      stateRoot: "C:/State/ws_source",
      capabilities: ["engineeringWorkbench", "generalFileContext"] as const
    },
    snapshot: {
      workspaceId: "ws_source",
      displayName: "Source",
      tree: { nodes: [], truncated: false }
    }
  };
  return {
    getActivation: () => activation,
    getSnapshot: () => activation.snapshot,
    async openEngineeringWorkspace() {
      return ok(activation);
    },
    async releaseWorkspaceLock() {
      return ok(undefined);
    }
  } as unknown as EngineeringWorkspaceSession;
}

function hasForbiddenRootKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasForbiddenRootKey);
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, entry]) =>
      key === "projectRoot" ||
      key === "contentRoot" ||
      key === "stateRoot" ||
      hasForbiddenRootKey(entry)
  );
}
