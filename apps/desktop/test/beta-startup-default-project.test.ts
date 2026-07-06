import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  createBootstrappedDefaultDesktopApplication,
  DEFAULT_FIXTURE_CHAPTER_ID
} from "../src/main/application-composition.js";

const tempRoots: string[] = [];

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("beta startup default project", () => {
  test("bootstraps a writable default project without relying on source fixtures", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-empty-default-"));
    tempRoots.push(projectRoot);

    const application = await createBootstrappedDefaultDesktopApplication({
      projectRoot,
      now: () => "2026-07-05T00:00:00.000Z"
    });

    const shellState = application.getShellState();
    const loaded = await application.loadActiveChapter();
    const chapters = await application.listProjectChapters();

    expect(shellState.projectTitle).toBe("未命名长篇项目");
    expect(shellState.navigatorSections.find((section) => section.id === "chapters")).toMatchObject(
      {
        itemCount: 1
      }
    );
    expect(loaded).toMatchObject({
      ok: true,
      value: {
        state: {
          chapter: {
            frontmatter: {
              id: DEFAULT_FIXTURE_CHAPTER_ID,
              title: "第一章"
            },
            body: "这是第一章的正文。你可以直接开始写作。\n"
          },
          saveStatus: "Saved"
        }
      }
    });
    expect(chapters).toMatchObject({
      ok: true,
      value: [
        {
          id: DEFAULT_FIXTURE_CHAPTER_ID,
          title: "第一章"
        }
      ]
    });
  });

  test("releases the bootstrapped project lock during shutdown", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-lock-default-"));
    tempRoots.push(projectRoot);

    const application = await createBootstrappedDefaultDesktopApplication({
      projectRoot,
      now: () => "2026-07-06T00:00:00.000Z"
    });

    await expect(access(join(projectRoot, ".novel-studio", "project-lock.json"))).resolves.toBe(
      undefined
    );

    const shutdown = await application.shutdown();

    expect(shutdown).toEqual({ ok: true, value: undefined });
    await expect(access(join(projectRoot, ".novel-studio", "project-lock.json"))).rejects.toThrow();
  });
});
