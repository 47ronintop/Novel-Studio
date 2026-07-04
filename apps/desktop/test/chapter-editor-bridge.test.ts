import { describe, expect, test } from "vitest";

import { ok } from "@novel-studio/shared";
import type { ChapterEditorSnapshot, NovelStudioApi } from "@novel-studio/application";

import { createChapterEditorBridge } from "../src/renderer/chapter-editor-bridge.js";

const snapshot = {
  state: {
    chapter: {
      frontmatter: {
        schemaVersion: "1.0",
        id: "ch_01JZ7P9QK2R6D4W8K3A1B5C9D0",
        type: "chapter",
        title: "第一章",
        order: 1,
        status: "draft",
        createdAt: "2026-07-03T00:00:00.000Z",
        updatedAt: "2026-07-03T00:00:00.000Z"
      },
      body: "原始章节正文。\n"
    },
    dirty: false,
    saveStatus: "Saved"
  },
  versions: [
    {
      versionId: "ver_manual_save",
      reason: "manual-save",
      createdBy: "user",
      createdAt: "2026-07-04T00:00:00.000Z",
      parentVersionId: null
    }
  ]
} satisfies ChapterEditorSnapshot;

describe("chapter editor bridge", () => {
  test("loads, edits, saves, and previews versions through the preload Application API", async () => {
    const calls: string[] = [];
    const api: NovelStudioApi = {
      getShellState: async () => ({
        projectTitle: "Minimal Chapter Project"
      }),
      commands: {
        list: async () => [],
        execute: async (commandId) => {
          calls.push(`command:${commandId}`);
          return ok({ projectTitle: "Minimal Chapter Project" });
        }
      },
      chapter: {
        load: async () => {
          calls.push("chapter.load");
          return ok(snapshot);
        },
        edit: async (body) => {
          calls.push(`chapter.edit:${body}`);
          return ok({
            ...snapshot,
            state: {
              ...snapshot.state,
              chapter: {
                ...snapshot.state.chapter,
                body
              },
              dirty: true,
              saveStatus: "Unsaved"
            }
          });
        },
        save: async () => {
          calls.push("chapter.save");
          return ok(snapshot);
        },
        listVersions: async () => {
          calls.push("chapter.listVersions");
          return ok(snapshot.versions);
        },
        previewVersion: async (versionId) => {
          calls.push(`chapter.previewVersion:${versionId}`);
          return ok({
            versionId,
            body: "保存后的章节正文。\n"
          });
        },
        restoreVersion: async (versionId) => {
          calls.push(`chapter.restoreVersion:${versionId}`);
          return ok(snapshot);
        },
        previewSuggestionDiff: async (body) => {
          calls.push(`chapter.previewSuggestionDiff:${body}`);
          return ok({
            title: "AI suggestion",
            changes: [{ kind: "replace", value: body }]
          });
        }
      }
    };
    const bridge = createChapterEditorBridge(api);

    const loaded = await bridge.load();
    const edited = await bridge.edit("A revised opening paragraph.\n");
    const saved = await bridge.save();
    const versions = await bridge.listVersions();
    const preview = await bridge.previewVersion("ver_manual_save");
    const diff = await bridge.previewSuggestionDiff("AI revised opening.\n");

    expect(loaded.chapter.body).toBe("原始章节正文。\n");
    expect(loaded.versionHistory[0]?.label).toBe("Manual save");
    expect(edited.saveStatus).toBe("Unsaved");
    expect(saved.saveStatus).toBe("Saved");
    expect(versions[0]?.versionId).toBe("ver_manual_save");
    expect(preview.body).toBe("保存后的章节正文。\n");
    expect(diff.changes[0]?.value).toBe("AI revised opening.\n");
    expect(calls).toEqual([
      "chapter.load",
      "chapter.edit:A revised opening paragraph.\n",
      "chapter.save",
      "chapter.listVersions",
      "chapter.previewVersion:ver_manual_save",
      "chapter.previewSuggestionDiff:AI revised opening.\n"
    ]);
  });

  test("returns immediate Saving props before the save request resolves", async () => {
    let resolveSave: (result: ReturnType<typeof ok<ChapterEditorSnapshot>>) => void = () =>
      undefined;
    const saveResult = new Promise<ReturnType<typeof ok<ChapterEditorSnapshot>>>((resolve) => {
      resolveSave = resolve;
    });
    const api: NovelStudioApi = {
      getShellState: async () => ({
        projectTitle: "Minimal Chapter Project"
      }),
      commands: {
        list: async () => [],
        execute: async () => ok({ projectTitle: "Minimal Chapter Project" })
      },
      chapter: {
        load: async () => ok(snapshot),
        edit: async (body) =>
          ok({
            ...snapshot,
            state: {
              ...snapshot.state,
              chapter: {
                ...snapshot.state.chapter,
                body
              },
              dirty: true,
              saveStatus: "Unsaved"
            }
          }),
        save: () => saveResult,
        listVersions: async () => ok(snapshot.versions),
        previewVersion: async (versionId) =>
          ok({
            versionId,
            body: "保存后的章节正文。\n"
          }),
        restoreVersion: async () => ok(snapshot),
        previewSuggestionDiff: async (body) =>
          ok({
            title: "AI suggestion",
            changes: [{ kind: "replace", value: body }]
          })
      }
    };
    const bridge = createChapterEditorBridge(api);

    await bridge.load();
    await bridge.edit("A revised opening paragraph.\n");
    const saving = bridge.beginSave();
    const savePromise = bridge.save();
    resolveSave(ok(snapshot));
    const saved = await savePromise;

    expect(saving?.saveStatus).toBe("Saving");
    expect(saving?.dirty).toBe(true);
    expect(saved.saveStatus).toBe("Saved");
  });
});
