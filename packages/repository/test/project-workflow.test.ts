import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { isErr, isOk } from "@novel-studio/shared";

import {
  ChapterFileRepository,
  ProjectFileRepository,
  ProjectLockFileRepository
} from "../src/index.js";

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
    expect(
      await readFile(join(projectRoot, "prompts", "prompt_reviewer_default.json"), "utf8")
    ).toContain("默认审稿 Prompt");
    expect(
      await readFile(join(projectRoot, "agents", "agent_reviewer_default.json"), "utf8")
    ).toContain("默认审稿 Agent");
    expect(
      await readFile(join(projectRoot, "workflow", "wf_review_chapter.json"), "utf8")
    ).toContain("审稿当前章节");
  });

  test("does not overwrite existing files when initializing a folder as a project", async () => {
    const projectRoot = await createTempRoot();
    await writeFile(join(projectRoot, "project.json"), '{"user":"draft"}\n', "utf8");
    const repository = new ProjectFileRepository({
      projectRoot,
      now: () => "2026-07-04T00:00:00.000Z"
    });

    const created = await repository.createProject({
      projectId: "prj_existing_folder",
      title: "Existing Folder",
      language: "zh-CN"
    });

    expect(isErr(created)).toBe(true);
    if (!created.ok) {
      expect(created.error.code).toBe("PROJECT_CREATE_CONFLICT");
      expect(created.error.redactedDetail).toEqual({ relativePath: "project.json" });
    }
    expect(await readFile(join(projectRoot, "project.json"), "utf8")).toBe('{"user":"draft"}\n');
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

  test("acquires a project lock, rejects conflicting owners, and releases only by owner", async () => {
    const projectRoot = await createTempRoot();
    const firstOwner = new ProjectLockFileRepository({
      projectRoot,
      ownerId: "window_a",
      now: () => "2026-07-06T00:00:00.000Z"
    });
    const secondOwner = new ProjectLockFileRepository({
      projectRoot,
      ownerId: "window_b",
      now: () => "2026-07-06T00:01:00.000Z"
    });

    const acquired = await firstOwner.acquireProjectLock();
    const firstLockContent = await readFile(
      join(projectRoot, ".novel-studio", "project-lock.json"),
      "utf8"
    );
    const conflicting = await secondOwner.acquireProjectLock();
    const nonOwnerRelease = await secondOwner.releaseProjectLock();
    const ownerRelease = await firstOwner.releaseProjectLock();
    const reacquired = await secondOwner.acquireProjectLock();

    expect(isOk(acquired)).toBe(true);
    if (isErr(acquired)) {
      throw new Error(acquired.error.message);
    }
    expect(acquired.value).toEqual({
      schemaVersion: "1.0",
      ownerId: "window_a",
      projectRoot,
      acquiredAt: "2026-07-06T00:00:00.000Z"
    });
    expect(firstLockContent).toContain('"ownerId": "window_a"');
    expect(isErr(conflicting)).toBe(true);
    if (!conflicting.ok) {
      expect(conflicting.error.code).toBe("PROJECT_LOCK_CONFLICT");
      expect(conflicting.error.redactedDetail).toEqual({
        ownerId: "window_a",
        acquiredAt: "2026-07-06T00:00:00.000Z"
      });
    }
    expect(isErr(nonOwnerRelease)).toBe(true);
    if (!nonOwnerRelease.ok) {
      expect(nonOwnerRelease.error.code).toBe("PROJECT_LOCK_OWNER_MISMATCH");
    }
    expect(isOk(ownerRelease)).toBe(true);
    expect(isOk(reacquired)).toBe(true);
    if (isErr(reacquired)) {
      throw new Error(reacquired.error.message);
    }
    expect(reacquired.value.ownerId).toBe("window_b");
  });

  test("reports stale project locks without deleting the protected lock file", async () => {
    const projectRoot = await createTempRoot();
    await mkdir(join(projectRoot, ".novel-studio"), { recursive: true });
    await writeFile(
      join(projectRoot, ".novel-studio", "project-lock.json"),
      `${JSON.stringify(
        {
          schemaVersion: "1.0",
          ownerId: "crashed_window",
          projectRoot,
          acquiredAt: "2026-07-06T00:00:00.000Z"
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    const nextOwner = new ProjectLockFileRepository({
      projectRoot,
      ownerId: "window_b",
      now: () => "2026-07-06T03:00:00.000Z",
      staleAfterMs: 60 * 60 * 1000
    });

    const result = await nextOwner.acquireProjectLock();
    const lockContent = await readFile(
      join(projectRoot, ".novel-studio", "project-lock.json"),
      "utf8"
    );

    expect(isErr(result)).toBe(true);
    if (!result.ok) {
      expect(result.error.code).toBe("PROJECT_LOCK_STALE");
      expect(result.error.recoverability).toBe("user-action");
      expect(result.error.redactedDetail).toEqual({
        ownerId: "crashed_window",
        acquiredAt: "2026-07-06T00:00:00.000Z",
        staleAfterMs: 3600000
      });
    }
    expect(lockContent).toContain('"ownerId": "crashed_window"');
  });
});

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "novel-studio-m12-"));
  tempRoots.push(root);
  return root;
}
