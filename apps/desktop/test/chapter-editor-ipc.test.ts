import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import type { ChapterEditorSnapshot, ChapterVersionSummary } from "@novel-studio/application";
import type { Result, UnifiedError } from "@novel-studio/shared";

import { createProjectDesktopApplication } from "../src/main/application-composition.js";
import { createApplicationIpcHandlers } from "../src/main/ipc-handlers.js";

const fixtureRoot = join(process.cwd(), "fixtures", "projects", "minimal-chapter");
const chapterId = "ch_01JZ7P9QK2R6D4W8K3A1B5C9D0";
const tempRoots: string[] = [];

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("chapter editor IPC vertical slice", () => {
  test("opens a fixture chapter, saves through Repository, lists versions, and restores a snapshot", async () => {
    const projectRoot = await copyFixtureProject();
    const handlers = createApplicationIpcHandlers(
      createProjectDesktopApplication({
        projectRoot,
        chapterId,
        projectTitle: "未命名长篇项目",
        now: () => "2026-07-04T00:00:00.000Z",
        createVersionId: (() => {
          const ids = ["ver_manual_save", "ver_before_rollback"];
          return () => ids.shift() ?? "ver_extra";
        })()
      })
    );

    const loaded = await handlers["application:chapter:load"]();
    assertOk<ChapterEditorSnapshot>(loaded);

    expect(loaded.value.state.chapter.body).toBe("原始章节正文。\n");

    const edited = await handlers["application:chapter:edit"]("保存后的章节正文。\n");
    assertOk<ChapterEditorSnapshot>(edited);
    expect(edited.value.state.saveStatus).toBe("Unsaved");

    const saved = await handlers["application:chapter:save"]();
    assertOk<ChapterEditorSnapshot>(saved);
    expect(saved.value.state.saveStatus).toBe("Saved");
    expect(await readFile(join(projectRoot, "chapters", `${chapterId}.md`), "utf8")).toContain(
      "保存后的章节正文。"
    );

    const listed = await handlers["application:chapter:list-versions"]();
    assertOk<readonly ChapterVersionSummary[]>(listed);
    expect(listed.value.map((entry) => entry.versionId)).toEqual(["ver_manual_save"]);
    expect(listed.value[0]?.reason).toBe("manual-save");

    const preview = await handlers["application:chapter:preview-version"]("ver_manual_save");
    assertOk<{ readonly body: string }>(preview);
    expect(preview.value.body).toBe("保存后的章节正文。\n");

    const diff =
      await handlers["application:chapter:preview-suggestion-diff"]("AI 建议但尚未应用。\n");
    assertOk<{ readonly changes: readonly { readonly kind: string; readonly value: string }[] }>(
      diff
    );
    expect(diff.value.changes[0]).toMatchObject({
      kind: "replace",
      value: "AI 建议但尚未应用。\n"
    });

    const secondEdit = await handlers["application:chapter:edit"]("回滚前的当前正文。\n");
    assertOk<ChapterEditorSnapshot>(secondEdit);

    const restored = await handlers["application:chapter:restore-version"]("ver_manual_save");
    assertOk<ChapterEditorSnapshot>(restored);
    expect(restored.value.state.chapter.body).toBe("保存后的章节正文。\n");
    expect(
      await readFile(
        join(projectRoot, "history", "chapters", chapterId, "ver_before_rollback.md"),
        "utf8"
      )
    ).toBe("回滚前的当前正文。\n");
  });
});

async function copyFixtureProject(): Promise<string> {
  const target = await mkdtemp(join(tmpdir(), "novel-studio-desktop-ipc-"));
  tempRoots.push(target);
  await mkdir(join(target, "chapters"), { recursive: true });
  await writeFile(join(target, "project.json"), await readFile(join(fixtureRoot, "project.json")));
  await writeFile(
    join(target, "settings.json"),
    await readFile(join(fixtureRoot, "settings.json"))
  );
  await writeFile(
    join(target, "chapters", `${chapterId}.md`),
    await readFile(join(fixtureRoot, "chapters", `${chapterId}.md`))
  );

  return target;
}

function assertOk<T>(
  result: unknown
): asserts result is Result<T, UnifiedError> & { readonly ok: true } {
  expect(result).toMatchObject({ ok: true });
}
