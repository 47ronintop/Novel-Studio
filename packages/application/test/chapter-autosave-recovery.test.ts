import { describe, expect, test } from "vitest";

import { ok } from "@novel-studio/shared";
import type {
  ChapterDocument,
  ChapterDraftRepositoryPort,
  ChapterHistoryRepositoryPort,
  RecoveryRecord,
  RecoveryRepositoryPort
} from "@novel-studio/shared";

import { createChapterEditorSession } from "../src/chapter-editor-session.js";

const chapterId = "ch_recovery";
const loadedChapter: ChapterDocument = {
  frontmatter: {
    schemaVersion: "1.0",
    id: chapterId,
    type: "chapter",
    title: "Recovery Chapter",
    order: 1,
    status: "draft",
    createdAt: "2026-07-05T00:00:00.000Z",
    updatedAt: "2026-07-05T00:00:00.000Z"
  },
  body: "persisted body\n"
};

describe("chapter autosave recovery", () => {
  test("writes dirty recovery on edit and a clean marker after save", async () => {
    const recoveryRecords: RecoveryRecord[] = [];
    const repository: ChapterDraftRepositoryPort = {
      async readChapter() {
        return ok(loadedChapter);
      },
      async writeChapter(chapter) {
        return ok(chapter);
      }
    };
    const historyRepository: ChapterHistoryRepositoryPort = {
      async snapshotChapterVersion(input) {
        return ok({
          versionId: "ver_saved",
          reason: input.reason,
          createdBy: input.createdBy ?? "system",
          createdAt: "2026-07-05T00:01:00.000Z",
          parentVersionId: input.parentVersionId ?? null
        });
      },
      async listChapterVersions() {
        return ok([]);
      },
      async readChapterVersion() {
        return ok({ versionId: "ver_saved", body: loadedChapter.body });
      }
    };
    const recoveryRepository: RecoveryRepositoryPort = {
      async writeRecoveryRecord(record) {
        recoveryRecords.push(record);
        return ok(record);
      },
      async listRecoveryRecords() {
        return ok(recoveryRecords);
      }
    };

    const session = createChapterEditorSession({
      chapterId,
      projectId: "prj_recovery",
      sessionId: "session_prj_recovery_ch_recovery",
      repository,
      historyRepository,
      recoveryRepository,
      now: () => "2026-07-05T00:01:00.000Z"
    });

    await session.load();
    const edited = await session.edit("unsaved body\n");
    const saved = await session.save();

    expect(edited.ok).toBe(true);
    expect(saved.ok).toBe(true);
    expect(recoveryRecords).toHaveLength(2);
    expect(recoveryRecords[0]).toMatchObject({
      sessionId: "session_prj_recovery_ch_recovery",
      projectId: "prj_recovery",
      openAssetId: chapterId,
      assetType: "chapter",
      dirty: true,
      draftContentRef: {
        strategy: "inline",
        content: "unsaved body\n"
      }
    });
    expect(recoveryRecords[1]).toMatchObject({
      sessionId: "session_prj_recovery_ch_recovery",
      dirty: false,
      draftContentRef: {
        strategy: "inline",
        content: "unsaved body\n"
      }
    });
  });
});
