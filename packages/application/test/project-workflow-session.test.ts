import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { isErr, isOk } from "@novel-studio/shared";
import {
  ChapterFileRepository,
  HistoryRepository,
  ProjectFileRepository
} from "@novel-studio/repository";

import { createProjectWorkspaceSession } from "../src/project-workspace-session.js";

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
        })
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
});

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "novel-studio-m12-app-"));
  tempRoots.push(root);
  return root;
}
