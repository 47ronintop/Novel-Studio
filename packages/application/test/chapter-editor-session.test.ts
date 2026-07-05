import { describe, expect, test } from "vitest";

import { isErr, isOk, ok } from "@novel-studio/shared";
import type { ChapterDocument } from "@novel-studio/shared";

import {
  createChapterEditorSession,
  type ChapterDraftRepositoryPort
} from "../src/chapter-editor-session.js";

const chapterId = "ch_01JZ7P9QK2R6D4W8K3A1B5C9D0";
const originalChapter = {
  frontmatter: {
    schemaVersion: "1.0",
    id: chapterId,
    type: "chapter",
    title: "第一章",
    order: 1,
    status: "draft" as const,
    createdAt: "2026-07-03T00:00:00.000Z",
    updatedAt: "2026-07-03T00:00:00.000Z"
  },
  body: "原始章节正文。\n"
} satisfies ChapterDocument;

describe("chapter editor session", () => {
  test("loads chapter data and flips to unsaved after editing before persistence", async () => {
    const repositoryCalls: string[] = [];
    const repository: ChapterDraftRepositoryPort = {
      async readChapter(requestedChapterId: string) {
        repositoryCalls.push(`read:${requestedChapterId}`);
        return ok(originalChapter);
      },
      async writeChapter(chapter) {
        repositoryCalls.push(`write:${chapter.frontmatter.id}`);
        return ok(chapter);
      }
    };

    const session = createChapterEditorSession({
      chapterId,
      repository,
      now: () => "2026-07-04T00:00:00.000Z"
    });

    const loaded = await session.load();

    expect(isOk(loaded)).toBe(true);
    if (isErr(loaded)) {
      throw new Error(loaded.error.message);
    }

    expect(loaded.value.chapter.frontmatter.id).toBe("ch_01JZ7P9QK2R6D4W8K3A1B5C9D0");
    expect(loaded.value.saveStatus).toBe("Saved");
    expect(loaded.value.dirty).toBe(false);

    const edited = await session.edit("A revised opening paragraph.\n");

    expect(isOk(edited)).toBe(true);
    if (isErr(edited)) {
      throw new Error(edited.error.message);
    }

    expect(repositoryCalls).toEqual([`read:${chapterId}`]);
    expect(edited.value.dirty).toBe(true);
    expect(edited.value.saveStatus).toBe("Unsaved");
    expect(edited.value.chapter.body).toContain("A revised opening paragraph.");

    const saved = await session.save();

    expect(isOk(saved)).toBe(true);
    if (isErr(saved)) {
      throw new Error(saved.error.message);
    }

    expect(repositoryCalls).toEqual([`read:${chapterId}`, `write:${chapterId}`]);
    expect(saved.value.dirty).toBe(false);
    expect(saved.value.saveStatus).toBe("Saved");
    expect(saved.value.chapter.frontmatter.updatedAt).toBe("2026-07-04T00:00:00.000Z");
  });
});
