import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, afterEach } from "vitest";

import { isErr, isOk } from "@novel-studio/shared";

import { ChapterFileRepository } from "../src/chapter-repository.js";

const fixtureRoot = join(process.cwd(), "fixtures", "projects", "minimal-chapter");
const tempRoots: string[] = [];

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("ChapterFileRepository", () => {
  test("reads and writes a chapter fixture through the project folder", async () => {
    const projectRoot = await copyFixtureProject();
    const repository = new ChapterFileRepository({ projectRoot, traceId: "trace_chapter_repo" });

    const loaded = await repository.readChapter("ch_01JZ7P9QK2R6D4W8K3A1B5C9D0");

    expect(isOk(loaded)).toBe(true);
    if (isErr(loaded)) {
      throw new Error(loaded.error.message);
    }

    expect(loaded.value.frontmatter.title).toBe("第一章");
    expect(loaded.value.body).toContain("原始章节正文");

    const updated = {
      ...loaded.value,
      body: `${loaded.value.body}A revised opening paragraph.\n`,
      frontmatter: {
        ...loaded.value.frontmatter,
        updatedAt: "2026-07-04T00:00:00.000Z"
      }
    };
    const saved = await repository.writeChapter(updated);

    expect(isOk(saved)).toBe(true);
    if (isErr(saved)) {
      throw new Error(saved.error.message);
    }

    expect(
      await readFile(join(projectRoot, "chapters", "ch_01JZ7P9QK2R6D4W8K3A1B5C9D0.md"), "utf8")
    ).toContain("A revised opening paragraph.");
  });
});

async function copyFixtureProject(): Promise<string> {
  const target = await mkdtemp(join(tmpdir(), "novel-studio-chapter-"));
  tempRoots.push(target);
  await mkdir(join(target, "chapters"), { recursive: true });
  await writeFile(join(target, "project.json"), await readFile(join(fixtureRoot, "project.json")));
  await writeFile(
    join(target, "settings.json"),
    await readFile(join(fixtureRoot, "settings.json"))
  );
  await writeFile(
    join(target, "chapters", "ch_01JZ7P9QK2R6D4W8K3A1B5C9D0.md"),
    await readFile(join(fixtureRoot, "chapters", "ch_01JZ7P9QK2R6D4W8K3A1B5C9D0.md"))
  );
  return target;
}
