import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { isErr, isOk } from "@novel-studio/shared";

import { ChapterFileRepository, ProjectFileRepository } from "../src/index.js";

const tempRoots: string[] = [];

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("M12 project workflow repository support", () => {
  test("creates a project folder with valid metadata and settings", async () => {
    const projectRoot = await createTempRoot();
    const repository = new ProjectFileRepository({
      projectRoot,
      now: () => "2026-07-04T00:00:00.000Z"
    });

    const created = await repository.createProject({
      projectId: "prj_m12_workflow",
      title: "M12 Workflow Project",
      language: "zh-CN"
    });

    expect(isOk(created)).toBe(true);
    if (isErr(created)) {
      throw new Error(created.error.message);
    }

    expect(created.value.project.title).toBe("M12 Workflow Project");
    expect(created.value.project.stats?.chapterCount).toBe(0);
    expect(created.value.settings.autosave.enabled).toBe(true);
    expect(await readFile(join(projectRoot, "project.json"), "utf8")).toContain(
      "M12 Workflow Project"
    );
    expect(await readFile(join(projectRoot, "settings.json"), "utf8")).toContain(
      "secret://model_default/api_key"
    );
    expect(
      JSON.parse(await readFile(join(projectRoot, "plugins", "plugins.json"), "utf8"))
    ).toEqual({
      schemaVersion: "1.0",
      plugins: []
    });
  });

  test("creates, lists, and reads chapters in project order", async () => {
    const projectRoot = await createTempRoot();
    const projectRepository = new ProjectFileRepository({
      projectRoot,
      now: () => "2026-07-04T00:00:00.000Z"
    });
    const chapterRepository = new ChapterFileRepository({
      projectRoot,
      now: () => "2026-07-04T00:00:00.000Z"
    });
    await projectRepository.createProject({
      projectId: "prj_m12_chapters",
      title: "M12 Chapters",
      language: "zh-CN"
    });

    const second = await chapterRepository.createChapter({
      chapterId: "ch_second",
      title: "第二章",
      order: 2,
      body: "第二章正文\n"
    });
    const first = await chapterRepository.createChapter({
      chapterId: "ch_first",
      title: "第一章",
      order: 1,
      body: "第一章正文\n"
    });
    const chapters = await chapterRepository.listChapters();

    expect(isOk(first)).toBe(true);
    expect(isOk(second)).toBe(true);
    expect(isOk(chapters)).toBe(true);
    if (isErr(chapters)) {
      throw new Error(chapters.error.message);
    }

    expect(chapters.value.map((chapter) => chapter.id)).toEqual(["ch_first", "ch_second"]);
    expect(chapters.value[0]?.title).toBe("第一章");

    const loaded = await chapterRepository.readChapter("ch_first");
    expect(isOk(loaded)).toBe(true);
    if (isErr(loaded)) {
      throw new Error(loaded.error.message);
    }
    expect(loaded.value.body).toBe("第一章正文\n");
  });
});

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "novel-studio-m12-"));
  tempRoots.push(root);
  return root;
}
