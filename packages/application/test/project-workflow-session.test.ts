import { access, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { isErr, isOk } from "@novel-studio/shared";
import type { RecoveryRecord, RecoveryRepositoryPort } from "@novel-studio/shared";
import { createUnifiedError, err, ok } from "@novel-studio/shared";
import {
  ChapterFileRepository,
  HistoryRepository,
  ProjectCreationFileRepository,
  ProjectFileRepository
} from "@novel-studio/repository";

import { createProjectWorkspaceSession } from "../src/project-workspace-session.js";
import type {
  CreateCreativeProjectInput,
  ProjectChapterRepositoryPort,
  ProjectCreationRepositoryPort,
  ProjectWorkspaceLock,
  ProjectWorkspaceLockPort
} from "../src/project-workspace-session.js";

const tempRoots: string[] = [];

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("M12 project workflow session", () => {
  test("creates and activates a project in a dedicated child directory", async () => {
    const parentDirectory = await createTempRoot();
    const canonicalParent = await realpath(parentDirectory);
    const receivedInputs: CreateCreativeProjectInput[] = [];
    const fileRepository = new ProjectCreationFileRepository({
      now: () => "2026-07-19T00:00:00.000Z"
    });
    const projectCreationRepository: ProjectCreationRepositoryPort = {
      previewProjectInParent: (input) => fileRepository.previewProjectInParent(input),
      createProjectInParent(input) {
        receivedInputs.push(input);
        return fileRepository.createProjectInParent(input);
      },
      cleanupCreatedProject: (projectRoot) => fileRepository.cleanupCreatedProject(projectRoot)
    };
    const session = createProjectWorkspaceSession({
      projectCreationRepository,
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
          createVersionId: () => "ver_task4"
        }),
      createRecoveryRepository: () => emptyRecoveryRepository()
    });
    const input: CreateCreativeProjectInput = {
      parentDirectory,
      folderName: "project-folder",
      projectId: "prj_task4",
      title: "A Separate Project Title",
      language: "zh-CN",
      projectType: "novel",
      targetWordCount: 120000
    };

    const created = await session.createProjectInParent(input);
    const chapter = await session.createChapter({
      chapterId: "ch_task4",
      title: "Task 4",
      body: "Child project chapter\n"
    });

    expect(receivedInputs).toEqual([input]);
    expect(isOk(created)).toBe(true);
    expect(isOk(chapter)).toBe(true);
    if (isErr(created)) {
      throw new Error(created.error.message);
    }
    expect(created.value.projectRoot).toBe(join(canonicalParent, "project-folder"));
    expect(created.value.project.title).toBe("A Separate Project Title");
    expect(created.value.project.stats).toMatchObject({ targetWordCount: 120000 });
    expect(created.value.activeChapterId).toBeUndefined();
    expect(session.getSnapshot()?.activeChapterId).toBe("ch_task4");
  });

  test.each([
    { failureMode: "result" as const, expectedCode: "TEST_RECOVERY_READ_FAILED" },
    { failureMode: "throw" as const, expectedCode: "PROJECT_ACTIVATION_FAILED" }
  ])(
    "keeps the active workspace and lock when child project activation fails via $failureMode",
    async ({ failureMode, expectedCode }) => {
      const existingRoot = await createTempRoot();
      const parentDirectory = await createTempRoot();
      const canonicalParent = await realpath(parentDirectory);
      const candidateRoot = join(canonicalParent, "candidate-project");
      const locks = new Map<string, ProjectWorkspaceLock>();
      const cleanedRoots: string[] = [];
      const fileRepository = new ProjectCreationFileRepository({
        now: () => "2026-07-19T00:00:00.000Z"
      });
      const projectCreationRepository: ProjectCreationRepositoryPort = {
        previewProjectInParent: (input) => fileRepository.previewProjectInParent(input),
        createProjectInParent: (input) => fileRepository.createProjectInParent(input),
        async cleanupCreatedProject(projectRoot) {
          cleanedRoots.push(projectRoot);
          return fileRepository.cleanupCreatedProject(projectRoot);
        }
      };
      const session = createProjectWorkspaceSession({
        projectCreationRepository,
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
            createVersionId: () => "ver_task4_atomic"
          }),
        createRecoveryRepository: (root) =>
          root === candidateRoot
            ? {
                async writeRecoveryRecord(record) {
                  return ok(record);
                },
                async listRecoveryRecords() {
                  if (failureMode === "throw") {
                    throw new Error("Candidate recovery threw unexpectedly.");
                  }
                  return err(
                    createUnifiedError({
                      code: "TEST_RECOVERY_READ_FAILED",
                      category: "StorageError",
                      message: "Candidate recovery could not be read.",
                      recoverability: "retryable",
                      suggestedAction: "Retry the test operation.",
                      traceId: "test-task4-activation"
                    })
                  );
                }
              }
            : emptyRecoveryRepository(),
        createProjectLockRepository: (root) =>
          createMemoryLockRepository(root, "window_task4", locks)
      });
      await session.createProject({
        projectRoot: existingRoot,
        projectId: "prj_existing_task4",
        title: "Existing Project",
        language: "en"
      });
      await session.createChapter({
        chapterId: "ch_existing_task4",
        title: "Existing Chapter",
        body: "Existing body\n"
      });
      const previousSnapshot = session.getSnapshot();
      const previousEditor = session.getActiveChapterEditorSession();

      const failed = await session.createProjectInParent({
        parentDirectory,
        folderName: "candidate-project",
        projectId: "prj_candidate_task4",
        title: "Candidate Project",
        language: "en"
      });

      expect(isErr(failed)).toBe(true);
      if (isErr(failed)) {
        expect(failed.error.code).toBe(expectedCode);
      }
      expect(session.getSnapshot()).toBe(previousSnapshot);
      expect(session.getActiveChapterEditorSession()).toBe(previousEditor);
      expect(locks.has(existingRoot)).toBe(true);
      expect(locks.has(candidateRoot)).toBe(false);
      expect(cleanedRoots).toEqual([candidateRoot]);
      await expect(pathExists(candidateRoot)).resolves.toBe(false);
    }
  );

  test("reports candidate cleanup failure instead of hiding it behind a lock failure", async () => {
    const parentDirectory = await createTempRoot();
    const fileRepository = new ProjectCreationFileRepository({
      now: () => "2026-07-19T00:00:00.000Z"
    });
    const lockFailure = createUnifiedError({
      code: "TEST_PROJECT_LOCK_FAILED",
      category: "StorageError",
      message: "Lock failed.",
      recoverability: "retryable",
      suggestedAction: "Retry the lock.",
      traceId: "test-project-lock"
    });
    const cleanupFailure = createUnifiedError({
      code: "TEST_PROJECT_CLEANUP_FAILED",
      category: "StorageError",
      message: "Cleanup failed.",
      recoverability: "retryable",
      suggestedAction: "Inspect the candidate folder.",
      traceId: "test-project-cleanup"
    });
    const session = createProjectWorkspaceSession({
      projectCreationRepository: {
        previewProjectInParent: (input) => fileRepository.previewProjectInParent(input),
        createProjectInParent: (input) => fileRepository.createProjectInParent(input),
        cleanupCreatedProject: async () => err(cleanupFailure)
      },
      createProjectRepository: (root) => new ProjectFileRepository({ projectRoot: root }),
      createChapterRepository: (root) => new ChapterFileRepository({ projectRoot: root }),
      createHistoryRepository: (root) => new HistoryRepository({ projectRoot: root }),
      createRecoveryRepository: () => emptyRecoveryRepository(),
      createProjectLockRepository: () => ({
        acquireProjectLock: async () => err(lockFailure),
        releaseProjectLock: async () => ok(undefined)
      })
    });

    const created = await session.createProjectInParent({
      parentDirectory,
      folderName: "cleanup-failure",
      projectId: "prj_cleanup_failure",
      title: "Cleanup Failure",
      language: "en"
    });

    expect(created).toMatchObject({
      ok: false,
      error: {
        code: "PROJECT_CREATE_CLEANUP_FAILED",
        redactedDetail: {
          primaryErrorCode: "TEST_PROJECT_LOCK_FAILED",
          cleanupErrorCode: "TEST_PROJECT_CLEANUP_FAILED"
        }
      }
    });
  });

  test("keeps the active workspace when the creation repository rejects the request", async () => {
    const existingRoot = await createTempRoot();
    const parentDirectory = await createTempRoot();
    let cleanupCalls = 0;
    const projectCreationRepository: ProjectCreationRepositoryPort = {
      async previewProjectInParent() {
        throw new Error("not used");
      },
      async createProjectInParent() {
        return err(
          createUnifiedError({
            code: "TEST_PROJECT_CREATE_REJECTED",
            category: "ValidationError",
            message: "Project creation was rejected.",
            recoverability: "user-action",
            suggestedAction: "Choose another folder name.",
            traceId: "test-task4-create-rejected"
          })
        );
      },
      async cleanupCreatedProject() {
        cleanupCalls += 1;
        return ok(undefined);
      }
    };
    const session = createProjectWorkspaceSession({
      projectCreationRepository,
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
          createVersionId: () => "ver_task4_rejected"
        }),
      createRecoveryRepository: () => emptyRecoveryRepository()
    });
    await session.createProject({
      projectRoot: existingRoot,
      projectId: "prj_existing_rejected",
      title: "Existing Before Rejection",
      language: "en"
    });
    await session.createChapter({
      chapterId: "ch_existing_rejected",
      title: "Existing Chapter",
      body: "Existing body\n"
    });
    const previousSnapshot = session.getSnapshot();
    const previousEditor = session.getActiveChapterEditorSession();

    const failed = await session.createProjectInParent({
      parentDirectory,
      folderName: "rejected-project",
      projectId: "prj_rejected",
      title: "Rejected Project",
      language: "en"
    });

    expect(isErr(failed)).toBe(true);
    if (isErr(failed)) {
      expect(failed.error.code).toBe("TEST_PROJECT_CREATE_REJECTED");
    }
    expect(session.getSnapshot()).toBe(previousSnapshot);
    expect(session.getActiveChapterEditorSession()).toBe(previousEditor);
    expect(cleanupCalls).toBe(0);
  });

  test("creates a project, creates chapters, and atomically selects and loads a chapter", async () => {
    const projectRoot = await createTempRoot();
    const session = createProjectWorkspaceSession({
      projectCreationRepository: new ProjectCreationFileRepository(),
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
          createVersionId: () => "ver_m12"
        }),
      createRecoveryRepository: () => emptyRecoveryRepository()
    });

    const createdProject = await session.createProject({
      projectRoot,
      projectId: "prj_m12_app",
      title: "M12 App Project",
      language: "zh-CN"
    });
    const createdChapter = await session.createChapter({
      chapterId: "ch_opening",
      title: "开篇",
      body: "开篇正文\n"
    });
    const secondChapter = await session.createChapter({
      chapterId: "ch_second",
      title: "第二章",
      body: "第二章正文\n"
    });
    const selected = await session.selectChapterAndLoad("ch_second");

    expect(isOk(createdProject)).toBe(true);
    expect(isOk(createdChapter)).toBe(true);
    expect(isOk(secondChapter)).toBe(true);
    expect(isOk(selected)).toBe(true);
    if (isErr(selected)) {
      throw new Error(selected.error.message);
    }

    expect(selected.value.workspace.activeChapterId).toBe("ch_second");
    expect(selected.value.workspace.chapters.map((chapter) => chapter.id)).toEqual([
      "ch_opening",
      "ch_second"
    ]);
    expect(selected.value.chapterEditor.state.chapter.frontmatter.title).toBe("第二章");
    expect(session.getActiveChapterEditorSession()?.getState()).toEqual(
      selected.value.chapterEditor.state
    );
  });

  test("keeps the previous workspace and loaded editor when candidate chapter loading fails", async () => {
    const projectRoot = await createTempRoot();
    const failingChapterId = "ch_second";
    const session = createProjectWorkspaceSession({
      projectCreationRepository: new ProjectCreationFileRepository(),
      now: () => "2026-07-04T00:00:00.000Z",
      createProjectRepository: (root) =>
        new ProjectFileRepository({
          projectRoot: root,
          now: () => "2026-07-04T00:00:00.000Z"
        }),
      createChapterRepository: (root) => {
        const repository = new ChapterFileRepository({
          projectRoot: root,
          now: () => "2026-07-04T00:00:00.000Z"
        });
        const readChapter = repository.readChapter.bind(repository);
        repository.readChapter = (chapterId) =>
          chapterId === failingChapterId
            ? Promise.resolve(
                err(
                  createUnifiedError({
                    code: "TEST_CHAPTER_LOAD_FAILED",
                    category: "StorageError",
                    message: "Candidate chapter could not be loaded.",
                    recoverability: "retryable",
                    suggestedAction: "Retry chapter navigation.",
                    traceId: "project-workspace-session-test"
                  })
                )
              )
            : readChapter(chapterId);
        return repository as ProjectChapterRepositoryPort;
      },
      createHistoryRepository: (root) =>
        new HistoryRepository({
          projectRoot: root,
          now: () => "2026-07-04T00:00:00.000Z",
          createVersionId: () => "ver_atomic_selection"
        }),
      createRecoveryRepository: () => emptyRecoveryRepository()
    });

    await session.createProject({
      projectRoot,
      projectId: "prj_atomic_selection",
      title: "Atomic Selection",
      language: "zh-CN"
    });
    await session.createChapter({
      chapterId: "ch_opening",
      title: "开篇",
      body: "旧章节正文\n"
    });
    await session.createChapter({
      chapterId: "ch_second",
      title: "第二章",
      body: "候选章节正文\n"
    });
    await session.selectChapter("ch_opening");
    const previousEditor = session.getActiveChapterEditorSession();
    const previousLoaded = await previousEditor?.load();
    expect(previousLoaded?.ok).toBe(true);
    const previousSnapshot = session.getSnapshot();
    const previousEditorState = previousEditor?.getState();
    const selected = await session.selectChapterAndLoad("ch_second");

    expect(isErr(selected)).toBe(true);
    if (isErr(selected)) {
      expect(selected.error.code).toBe("TEST_CHAPTER_LOAD_FAILED");
    }
    expect(session.getSnapshot()).toBe(previousSnapshot);
    expect(session.getActiveChapterEditorSession()).toBe(previousEditor);
    expect(previousEditor?.getState()).toEqual(previousEditorState);
  });

  test("renames, duplicates, and soft-deletes chapters from the workspace navigator", async () => {
    const projectRoot = await createTempRoot();
    const session = createProjectWorkspaceSession({
      projectCreationRepository: new ProjectCreationFileRepository(),
      now: () => "2026-07-07T00:00:00.000Z",
      createProjectRepository: (root) =>
        new ProjectFileRepository({
          projectRoot: root,
          now: () => "2026-07-07T00:00:00.000Z"
        }),
      createChapterRepository: (root) =>
        new ChapterFileRepository({
          projectRoot: root,
          now: () => "2026-07-07T00:00:00.000Z"
        }),
      createHistoryRepository: (root) =>
        new HistoryRepository({
          projectRoot: root,
          now: () => "2026-07-07T00:00:00.000Z",
          createVersionId: () => "ver_vui_06"
        }),
      createRecoveryRepository: () => emptyRecoveryRepository()
    });

    await session.createProject({
      projectRoot,
      projectId: "prj_vui_06",
      title: "VUI 06 Project",
      language: "zh-CN"
    });
    await session.createChapter({
      chapterId: "ch_opening",
      title: "开篇",
      body: "第一段正文\n"
    });

    const renamed = await session.renameChapter({
      chapterId: "ch_opening",
      title: "改名后的开篇"
    });
    const duplicated = await session.duplicateChapter({
      sourceChapterId: "ch_opening",
      chapterId: "ch_opening_copy",
      title: "开篇副本"
    });
    const deleted = await session.deleteChapter({ chapterId: "ch_opening" });

    expect(isOk(renamed)).toBe(true);
    expect(isOk(duplicated)).toBe(true);
    expect(isOk(deleted)).toBe(true);
    if (isErr(deleted)) {
      throw new Error(deleted.error.message);
    }
    expect(deleted.value.activeChapterId).toBe("ch_opening_copy");
    expect(deleted.value.chapters.map((chapter) => chapter.id)).toEqual(["ch_opening_copy"]);
    expect(deleted.value.chapters[0]).toMatchObject({
      title: "开篇副本",
      order: 2,
      status: "draft"
    });

    const deletedChapter = await new ChapterFileRepository({
      projectRoot,
      now: () => "2026-07-07T00:00:00.000Z"
    }).readChapter("ch_opening");
    expect(isOk(deletedChapter)).toBe(true);
    if (isErr(deletedChapter)) {
      throw new Error(deletedChapter.error.message);
    }
    expect(deletedChapter.value.frontmatter.status).toBe("deleted");
    expect(deletedChapter.value.body).toBe("第一段正文\n");
  });

  test("exposes dirty chapter recovery records in the workspace snapshot", async () => {
    const projectRoot = await createTempRoot();
    const recoveryRecords: RecoveryRecord[] = [
      {
        schemaVersion: "1.0",
        sessionId: "session_prj_m38_ch_opening",
        projectId: "prj_m38_app",
        openAssetId: "ch_opening",
        assetType: "chapter",
        dirty: true,
        draftContentRef: {
          strategy: "inline",
          content: "unsaved opening\n"
        },
        updatedAt: "2026-07-05T00:05:00.000Z"
      },
      {
        schemaVersion: "1.0",
        sessionId: "session_prj_m38_ch_clean",
        projectId: "prj_m38_app",
        openAssetId: "ch_clean",
        assetType: "chapter",
        dirty: false,
        draftContentRef: {
          strategy: "inline",
          content: "saved chapter\n"
        },
        updatedAt: "2026-07-05T00:04:00.000Z"
      }
    ];
    const recoveryRepository: RecoveryRepositoryPort = {
      async writeRecoveryRecord(record) {
        recoveryRecords.unshift(record);
        return { ok: true, value: record };
      },
      async listRecoveryRecords() {
        return { ok: true, value: recoveryRecords };
      }
    };
    const session = createProjectWorkspaceSession({
      projectCreationRepository: new ProjectCreationFileRepository(),
      now: () => "2026-07-05T00:00:00.000Z",
      createProjectRepository: (root) =>
        new ProjectFileRepository({
          projectRoot: root,
          now: () => "2026-07-05T00:00:00.000Z"
        }),
      createChapterRepository: (root) =>
        new ChapterFileRepository({
          projectRoot: root,
          now: () => "2026-07-05T00:00:00.000Z"
        }),
      createHistoryRepository: (root) =>
        new HistoryRepository({
          projectRoot: root,
          now: () => "2026-07-05T00:00:00.000Z",
          createVersionId: () => "ver_m38"
        }),
      createRecoveryRepository: () => recoveryRepository
    });

    await session.createProject({
      projectRoot,
      projectId: "prj_m38_app",
      title: "M38 App Project",
      language: "zh-CN"
    });
    await session.createChapter({
      chapterId: "ch_opening",
      title: "Opening",
      body: "persisted opening\n"
    });

    const snapshot = session.getSnapshot();

    expect(snapshot?.recovery.availableItems).toEqual([
      {
        sessionId: "session_prj_m38_ch_opening",
        chapterId: "ch_opening",
        updatedAt: "2026-07-05T00:05:00.000Z"
      }
    ]);
  });

  test("previews, applies, and discards chapter recovery drafts without deleting records", async () => {
    const projectRoot = await createTempRoot();
    const recoveryWrites: RecoveryRecord[] = [];
    const recoveryRecords: RecoveryRecord[] = [
      {
        schemaVersion: "1.0",
        sessionId: "session_prj_m49_app_ch_opening",
        projectId: "prj_m49_app",
        openAssetId: "ch_opening",
        assetType: "chapter",
        dirty: true,
        draftContentRef: {
          strategy: "inline",
          content: "unsaved recovered opening\n"
        },
        updatedAt: "2026-07-06T00:05:00.000Z"
      },
      {
        schemaVersion: "1.0",
        sessionId: "session_prj_m49_app_ch_second",
        projectId: "prj_m49_app",
        openAssetId: "ch_second",
        assetType: "chapter",
        dirty: true,
        draftContentRef: {
          strategy: "inline",
          content: "discarded recovered second\n"
        },
        updatedAt: "2026-07-06T00:06:00.000Z"
      }
    ];
    const recoveryRepository: RecoveryRepositoryPort = {
      async writeRecoveryRecord(record) {
        recoveryWrites.push(record);
        const existingIndex = recoveryRecords.findIndex(
          (entry) => entry.sessionId === record.sessionId
        );
        if (existingIndex >= 0) {
          recoveryRecords.splice(existingIndex, 1, record);
        } else {
          recoveryRecords.unshift(record);
        }
        return { ok: true, value: record };
      },
      async listRecoveryRecords() {
        return { ok: true, value: recoveryRecords };
      }
    };
    const session = createProjectWorkspaceSession({
      projectCreationRepository: new ProjectCreationFileRepository(),
      now: () => "2026-07-06T00:10:00.000Z",
      createProjectRepository: (root) =>
        new ProjectFileRepository({
          projectRoot: root,
          now: () => "2026-07-06T00:00:00.000Z"
        }),
      createChapterRepository: (root) =>
        new ChapterFileRepository({
          projectRoot: root,
          now: () => "2026-07-06T00:00:00.000Z"
        }),
      createHistoryRepository: (root) =>
        new HistoryRepository({
          projectRoot: root,
          now: () => "2026-07-06T00:00:00.000Z",
          createVersionId: () => "ver_m49"
        }),
      createRecoveryRepository: () => recoveryRepository
    });

    await session.createProject({
      projectRoot,
      projectId: "prj_m49_app",
      title: "M49 App Project",
      language: "zh-CN"
    });
    await session.createChapter({
      chapterId: "ch_opening",
      title: "Opening",
      body: "persisted opening\n"
    });
    await session.createChapter({
      chapterId: "ch_second",
      title: "Second",
      body: "persisted second\n"
    });

    const preview = await session.previewRecoveryDraft("session_prj_m49_app_ch_opening");
    const applied = await session.applyRecoveryDraft("session_prj_m49_app_ch_opening");
    const activeEditorState = session.getActiveChapterEditorSession()?.getState();
    const discarded = await session.discardRecoveryDraft("session_prj_m49_app_ch_second");

    expect(isOk(preview)).toBe(true);
    if (isErr(preview)) {
      throw new Error(preview.error.message);
    }
    expect(preview.value).toMatchObject({
      sessionId: "session_prj_m49_app_ch_opening",
      chapterId: "ch_opening",
      chapterTitle: "Opening",
      updatedAt: "2026-07-06T00:05:00.000Z",
      body: "unsaved recovered opening\n"
    });
    expect(isOk(applied)).toBe(true);
    if (isErr(applied)) {
      throw new Error(applied.error.message);
    }
    expect(applied.value.chapterEditor.state.chapter.body).toBe("unsaved recovered opening\n");
    expect(applied.value.chapterEditor.state.dirty).toBe(true);
    expect(applied.value.workspace.recovery.availableItems).toHaveLength(1);
    expect(activeEditorState?.chapter.body).toBe(applied.value.chapterEditor.state.chapter.body);
    expect(activeEditorState?.dirty).toBe(applied.value.chapterEditor.state.dirty);
    expect(isOk(discarded)).toBe(true);
    expect(session.getSnapshot()?.recovery.availableItems).toEqual([]);
    expect(recoveryWrites.map((record) => [record.sessionId, record.dirty])).toEqual([
      ["session_prj_m49_app_ch_opening", true],
      ["session_prj_m49_app_ch_opening", false],
      ["session_prj_m49_app_ch_second", false]
    ]);
    expect(recoveryRecords.map((record) => [record.sessionId, record.dirty])).toEqual([
      ["session_prj_m49_app_ch_opening", false],
      ["session_prj_m49_app_ch_second", false]
    ]);
  });

  test("builds project health diagnostics for recovery and reference issues", async () => {
    const projectRoot = await createTempRoot();
    const recoveryRecords: RecoveryRecord[] = [
      {
        schemaVersion: "1.0",
        sessionId: "session_prj_m40_ch_missing",
        projectId: "prj_m40_app",
        openAssetId: "ch_missing",
        assetType: "chapter",
        dirty: true,
        draftContentRef: {
          strategy: "inline",
          content: "orphan draft\n"
        },
        updatedAt: "2026-07-05T00:05:00.000Z"
      }
    ];
    const session = createProjectWorkspaceSession({
      projectCreationRepository: new ProjectCreationFileRepository(),
      now: () => "2026-07-05T00:10:00.000Z",
      createProjectRepository: (root) =>
        new ProjectFileRepository({
          projectRoot: root,
          now: () => "2026-07-05T00:00:00.000Z"
        }),
      createChapterRepository: (root) =>
        new ChapterFileRepository({
          projectRoot: root,
          now: () => "2026-07-05T00:00:00.000Z"
        }),
      createHistoryRepository: (root) =>
        new HistoryRepository({
          projectRoot: root,
          now: () => "2026-07-05T00:00:00.000Z",
          createVersionId: () => "ver_m40"
        }),
      createRecoveryRepository: () => ({
        async writeRecoveryRecord(record) {
          recoveryRecords.unshift(record);
          return { ok: true, value: record };
        },
        async listRecoveryRecords() {
          return { ok: true, value: recoveryRecords };
        }
      })
    });

    const createdProject = await session.createProject({
      projectRoot,
      projectId: "prj_m40_app",
      title: "M40 App Project",
      language: "zh-CN"
    });

    expect(isOk(createdProject)).toBe(true);
    if (isErr(createdProject)) {
      throw new Error(createdProject.error.message);
    }

    expect(createdProject.value.health).toMatchObject({
      status: "blocked",
      checkedAt: "2026-07-05T00:10:00.000Z",
      summary: {
        errorCount: 1,
        warningCount: 1
      }
    });
    expect(createdProject.value.health.issues.map((issue) => issue.id)).toContain(
      "references.recovery_missing_chapter.ch_missing"
    );
    expect(createdProject.value.health.issues.map((issue) => issue.source)).toContain("recovery");
  });

  test("keeps clean recovery records hidden and rejects file-ref draft recovery review", async () => {
    const projectRoot = await createTempRoot();
    const recoveryRecords: RecoveryRecord[] = [
      {
        schemaVersion: "1.0",
        sessionId: "session_prj_m51_ch_clean",
        projectId: "prj_m51_app",
        openAssetId: "ch_clean",
        assetType: "chapter",
        dirty: false,
        draftContentRef: {
          strategy: "inline",
          content: "processed draft\n"
        },
        updatedAt: "2026-07-06T00:04:00.000Z"
      },
      {
        schemaVersion: "1.0",
        sessionId: "session_prj_m51_ch_file_ref",
        projectId: "prj_m51_app",
        openAssetId: "ch_file_ref",
        assetType: "chapter",
        dirty: true,
        draftContentRef: {
          strategy: "file-ref",
          path: "history/recovery/file-ref.md"
        },
        updatedAt: "2026-07-06T00:05:00.000Z"
      }
    ];
    const session = createProjectWorkspaceSession({
      projectCreationRepository: new ProjectCreationFileRepository(),
      now: () => "2026-07-06T00:10:00.000Z",
      createProjectRepository: (root) =>
        new ProjectFileRepository({
          projectRoot: root,
          now: () => "2026-07-06T00:00:00.000Z"
        }),
      createChapterRepository: (root) =>
        new ChapterFileRepository({
          projectRoot: root,
          now: () => "2026-07-06T00:00:00.000Z"
        }),
      createHistoryRepository: (root) =>
        new HistoryRepository({
          projectRoot: root,
          now: () => "2026-07-06T00:00:00.000Z",
          createVersionId: () => "ver_m51"
        }),
      createRecoveryRepository: () => ({
        async writeRecoveryRecord(record) {
          recoveryRecords.unshift(record);
          return ok(record);
        },
        async listRecoveryRecords() {
          return ok(recoveryRecords);
        }
      })
    });

    const created = await session.createProject({
      projectRoot,
      projectId: "prj_m51_app",
      title: "M51 App Project",
      language: "zh-CN"
    });
    await session.createChapter({
      chapterId: "ch_file_ref",
      title: "File Ref",
      body: "persisted file ref\n"
    });
    const preview = await session.previewRecoveryDraft("session_prj_m51_ch_file_ref");
    const apply = await session.applyRecoveryDraft("session_prj_m51_ch_file_ref");

    expect(isOk(created)).toBe(true);
    expect(session.getSnapshot()?.recovery.availableItems).toEqual([
      {
        sessionId: "session_prj_m51_ch_file_ref",
        chapterId: "ch_file_ref",
        updatedAt: "2026-07-06T00:05:00.000Z"
      }
    ]);
    expect(isErr(preview)).toBe(true);
    if (isErr(preview)) {
      expect(preview.error.code).toBe("RECOVERY_DRAFT_CONTENT_UNAVAILABLE");
    }
    expect(isErr(apply)).toBe(true);
    if (isErr(apply)) {
      expect(apply.error.code).toBe("RECOVERY_DRAFT_CONTENT_UNAVAILABLE");
    }
  });

  test("acquires project locks before activation and preserves current workspace on conflict", async () => {
    const firstRoot = await createTempRoot();
    const secondRoot = await createTempRoot();
    const locks = new Map<string, ProjectWorkspaceLock>();
    const session = createProjectWorkspaceSession({
      projectCreationRepository: new ProjectCreationFileRepository(),
      now: () => "2026-07-06T00:00:00.000Z",
      createProjectRepository: (root) =>
        new ProjectFileRepository({
          projectRoot: root,
          now: () => "2026-07-06T00:00:00.000Z"
        }),
      createChapterRepository: (root) =>
        new ChapterFileRepository({
          projectRoot: root,
          now: () => "2026-07-06T00:00:00.000Z"
        }),
      createHistoryRepository: (root) =>
        new HistoryRepository({
          projectRoot: root,
          now: () => "2026-07-06T00:00:00.000Z",
          createVersionId: () => "ver_m47"
        }),
      createRecoveryRepository: () => emptyRecoveryRepository(),
      createProjectLockRepository: (root) => createMemoryLockRepository(root, "window_a", locks)
    });
    const conflictingSession = createProjectWorkspaceSession({
      projectCreationRepository: new ProjectCreationFileRepository(),
      now: () => "2026-07-06T00:01:00.000Z",
      createProjectRepository: (root) =>
        new ProjectFileRepository({
          projectRoot: root,
          now: () => "2026-07-06T00:01:00.000Z"
        }),
      createChapterRepository: (root) =>
        new ChapterFileRepository({
          projectRoot: root,
          now: () => "2026-07-06T00:01:00.000Z"
        }),
      createHistoryRepository: (root) =>
        new HistoryRepository({
          projectRoot: root,
          now: () => "2026-07-06T00:01:00.000Z",
          createVersionId: () => "ver_m47_conflict"
        }),
      createRecoveryRepository: () => emptyRecoveryRepository(),
      createProjectLockRepository: (root) => createMemoryLockRepository(root, "window_b", locks)
    });

    const firstProject = await session.createProject({
      projectRoot: firstRoot,
      projectId: "prj_m47_first",
      title: "M47 First",
      language: "zh-CN"
    });
    await new ProjectFileRepository({
      projectRoot: secondRoot,
      now: () => "2026-07-06T00:00:00.000Z"
    }).createProject({
      projectId: "prj_m47_second",
      title: "M47 Second",
      language: "zh-CN"
    });
    locks.set(secondRoot, {
      schemaVersion: "1.0",
      ownerId: "window_other",
      projectRoot: secondRoot,
      acquiredAt: "2026-07-06T00:00:30.000Z"
    });

    const conflict = await session.openProject(secondRoot);
    const secondWindowConflict = await conflictingSession.openProject(firstRoot);

    expect(isOk(firstProject)).toBe(true);
    if (isErr(firstProject)) {
      throw new Error(firstProject.error.message);
    }
    expect(firstProject.value.lock).toEqual({
      schemaVersion: "1.0",
      ownerId: "window_a",
      projectRoot: firstRoot,
      acquiredAt: "2026-07-06T00:00:00.000Z"
    });
    expect(isErr(conflict)).toBe(true);
    if (!conflict.ok) {
      expect(conflict.error.code).toBe("PROJECT_LOCK_CONFLICT");
    }
    expect(session.getSnapshot()?.project.title).toBe("M47 First");
    expect(isErr(secondWindowConflict)).toBe(true);
    if (!secondWindowConflict.ok) {
      expect(secondWindowConflict.error.code).toBe("PROJECT_LOCK_CONFLICT");
      expect(secondWindowConflict.error.redactedDetail).toEqual({
        ownerId: "window_a",
        acquiredAt: "2026-07-06T00:00:00.000Z"
      });
    }

    const released = await session.releaseProjectLock();
    const reopenedAfterRelease = await conflictingSession.openProject(firstRoot);

    expect(released).toEqual(ok(undefined));
    expect(isOk(reopenedAfterRelease)).toBe(true);
    if (isErr(reopenedAfterRelease)) {
      throw new Error(reopenedAfterRelease.error.message);
    }
    expect(reopenedAfterRelease.value.lock).toMatchObject({
      ownerId: "window_b",
      projectRoot: firstRoot
    });
  });
});

function emptyRecoveryRepository(): RecoveryRepositoryPort {
  return {
    async writeRecoveryRecord(record) {
      return { ok: true, value: record };
    },
    async listRecoveryRecords() {
      return { ok: true, value: [] };
    }
  };
}

function createMemoryLockRepository(
  projectRoot: string,
  ownerId: string,
  locks: Map<string, ProjectWorkspaceLock>
): ProjectWorkspaceLockPort {
  return {
    async acquireProjectLock() {
      const existing = locks.get(projectRoot);
      if (existing !== undefined && existing.ownerId !== ownerId) {
        return err(
          createUnifiedError({
            code: "PROJECT_LOCK_CONFLICT",
            category: "StorageError",
            message: "Project is already locked by another Novel Studio window.",
            recoverability: "user-action",
            suggestedAction: "Close the other window or resolve the stale lock.",
            traceId: "test-project-lock",
            redactedDetail: {
              ownerId: existing.ownerId,
              acquiredAt: existing.acquiredAt
            }
          })
        );
      }

      const lock = {
        schemaVersion: "1.0" as const,
        ownerId,
        projectRoot,
        acquiredAt: ownerId === "window_a" ? "2026-07-06T00:00:00.000Z" : "2026-07-06T00:01:00.000Z"
      };
      locks.set(projectRoot, lock);
      return ok(lock);
    },
    async releaseProjectLock() {
      if (locks.get(projectRoot)?.ownerId === ownerId) {
        locks.delete(projectRoot);
      }
      return ok(undefined);
    }
  };
}

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "novel-studio-m12-app-"));
  tempRoots.push(root);
  return root;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
