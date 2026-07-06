import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { isErr, isOk } from "@novel-studio/shared";
import type { RecoveryRecord, RecoveryRepositoryPort } from "@novel-studio/shared";
import { createUnifiedError, err, ok } from "@novel-studio/shared";
import {
  ChapterFileRepository,
  HistoryRepository,
  ProjectFileRepository
} from "@novel-studio/repository";

import { createProjectWorkspaceSession } from "../src/project-workspace-session.js";
import type {
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
  test("creates a project, creates chapters, and switches the active editor chapter", async () => {
    const projectRoot = await createTempRoot();
    const session = createProjectWorkspaceSession({
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
    const selected = await session.selectChapter("ch_second");

    expect(isOk(createdProject)).toBe(true);
    expect(isOk(createdChapter)).toBe(true);
    expect(isOk(secondChapter)).toBe(true);
    expect(isOk(selected)).toBe(true);
    if (isErr(selected)) {
      throw new Error(selected.error.message);
    }

    expect(selected.value.activeChapterId).toBe("ch_second");
    expect(selected.value.chapters.map((chapter) => chapter.id)).toEqual([
      "ch_opening",
      "ch_second"
    ]);

    const editor = session.getActiveChapterEditorSession();
    const loaded = await editor?.load();
    expect(loaded?.ok).toBe(true);
    if (loaded?.ok !== true) {
      throw new Error("Active chapter did not load.");
    }
    expect(loaded.value.chapter.frontmatter.title).toBe("第二章");
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

  test("acquires project locks before activation and preserves current workspace on conflict", async () => {
    const firstRoot = await createTempRoot();
    const secondRoot = await createTempRoot();
    const locks = new Map<string, ProjectWorkspaceLock>();
    const session = createProjectWorkspaceSession({
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
