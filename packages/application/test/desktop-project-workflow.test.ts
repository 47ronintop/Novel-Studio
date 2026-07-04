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

import { createDesktopApplication } from "../src/desktop-application.js";
import { createProjectWorkspaceSession } from "../src/project-workspace-session.js";

const tempRoots: string[] = [];

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("M12 desktop project workflow", () => {
  test("creates a project, creates chapters, switches active chapter, and saves through the active editor", async () => {
    const projectRoot = await createTempRoot();
    const application = createDesktopApplication({
      projectWorkspaceSession: createProjectWorkspaceSession({
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
          })
      })
    });

    const createdProject = await application.createProject({
      projectRoot,
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
    const selected = await application.selectProjectChapter("ch_second");
    const loaded = await application.loadActiveChapter();
    const edited = await application.editActiveChapter("第二章修改后正文\n");
    const saved = await application.saveActiveChapter();

    expect(isOk(createdProject)).toBe(true);
    expect(isOk(opening)).toBe(true);
    expect(isOk(second)).toBe(true);
    expect(isOk(selected)).toBe(true);
    expect(isOk(loaded)).toBe(true);
    expect(isOk(edited)).toBe(true);
    expect(isOk(saved)).toBe(true);
    if (isErr(saved)) {
      throw new Error(saved.error.message);
    }

    expect(application.getShellState().projectTitle).toBe("M12 Desktop");
    expect(application.getShellState().navigatorSections[0]).toMatchObject({
      id: "chapters",
      itemCount: 2
    });
    expect(saved.value.state.chapter.frontmatter.title).toBe("第二章");
    expect(saved.value.state.chapter.body).toBe("第二章修改后正文\n");
  });
});

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "novel-studio-m12-desktop-"));
  tempRoots.push(root);
  return root;
}
