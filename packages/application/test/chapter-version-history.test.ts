import { describe, expect, test } from "vitest";

import { ok } from "@novel-studio/shared";
import type {
  ChapterDocument,
  ChapterDraftRepositoryPort,
  ChapterHistoryRepositoryPort,
  ChapterVersionSummary
} from "@novel-studio/shared";

import { createChapterEditorSession } from "../src/chapter-editor-session.js";

const chapterId = "ch_01JZ7P9QK2R6D4W8K3A1B5C9D0";
const loadedChapter: ChapterDocument = {
  frontmatter: {
    schemaVersion: "1.0",
    id: chapterId,
    type: "chapter",
    title: "第一章",
    order: 1,
    status: "draft",
    createdAt: "2026-07-03T00:00:00.000Z",
    updatedAt: "2026-07-03T00:00:00.000Z"
  },
  body: "原始章节正文。\n"
};

describe("chapter version history", () => {
  test("lists versions, previews a version, restores with before-rollback, and keeps AI diffs as suggestions", async () => {
    const historyCalls: string[] = [];
    const chapterWrites: string[] = [];

    const historyRepository: ChapterHistoryRepositoryPort = {
      async snapshotChapterVersion(input) {
        historyCalls.push(`snapshot:${input.reason}`);
        return ok({
          versionId: "ver_before",
          reason: input.reason,
          createdBy: input.createdBy ?? "system",
          createdAt: "2026-07-04T00:00:00.000Z",
          parentVersionId: input.parentVersionId ?? null
        });
      },
      async listChapterVersions(requestedChapterId) {
        historyCalls.push(`list:${requestedChapterId}`);
        return ok([
          {
            versionId: "ver_02",
            reason: "before-rollback",
            createdBy: "user",
            createdAt: "2026-07-04T00:00:00.000Z",
            parentVersionId: null
          },
          {
            versionId: "ver_01",
            reason: "manual-save",
            createdBy: "user",
            createdAt: "2026-07-03T00:00:00.000Z",
            parentVersionId: null
          }
        ] satisfies readonly ChapterVersionSummary[]);
      },
      async readChapterVersion(requestedChapterId, versionId) {
        historyCalls.push(`read:${requestedChapterId}:${versionId}`);
        return ok({ versionId, body: "回滚目标正文。\n" });
      }
    };

    const chapterRepository: ChapterDraftRepositoryPort = {
      async readChapter(requestedChapterId) {
        expect(requestedChapterId).toBe(chapterId);
        return ok(loadedChapter);
      },
      async writeChapter(chapter) {
        chapterWrites.push(chapter.body);
        return ok(chapter);
      }
    };

    const session = createChapterEditorSession({
      chapterId,
      repository: chapterRepository,
      historyRepository,
      now: () => "2026-07-04T00:00:00.000Z"
    });

    await session.load();
    session.edit("当前编辑草稿。\n");

    const versions = await session.listVersions();
    expect(versions.ok).toBe(true);
    if (!versions.ok) {
      throw new Error(versions.error.message);
    }
    expect(versions.value.map((entry) => entry.versionId)).toEqual(["ver_02", "ver_01"]);

    const preview = await session.previewVersion("ver_01");
    expect(preview.ok).toBe(true);
    if (!preview.ok) {
      throw new Error(preview.error.message);
    }
    expect(preview.value.body).toBe("回滚目标正文。\n");

    const restored = await session.restoreVersion("ver_01");
    expect(restored.ok).toBe(true);
    if (!restored.ok) {
      throw new Error(restored.error.message);
    }

    expect(historyCalls).toContain("snapshot:before-rollback");
    expect(historyCalls).toContain(`read:${chapterId}:ver_01`);
    expect(chapterWrites).toEqual(["回滚目标正文。\n"]);
    expect(restored.value.dirty).toBe(false);
    expect(restored.value.saveStatus).toBe("Saved");
    expect(restored.value.chapter.body).toBe("回滚目标正文。\n");

    const diffPreview = session.previewSuggestionDiff("AI revised opening.\n");
    expect(diffPreview.title).toBe("AI suggestion");
    expect(diffPreview.changes[0]?.kind).toBe("replace");
    expect(diffPreview.changes[0]?.value).toBe("AI revised opening.\n");
    expect(historyCalls).not.toContain("snapshot:before-ai-apply");
  });
});
