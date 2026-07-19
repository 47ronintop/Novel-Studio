import { describe, expect, test } from "vitest";

import type { NovelStudioApi } from "@novel-studio/application";
import { ok } from "@novel-studio/shared";

import { createPlainFileEditorBridge } from "../src/renderer/plain-file-editor-bridge.js";

describe("plain file editor bridge", () => {
  test("loads and saves a workspace file with its expected checksum", async () => {
    const calls: unknown[] = [];
    const api = createApi(calls);
    const bridge = createPlainFileEditorBridge(api);

    const loaded = await bridge.openFile("notes/scene.md");
    bridge.updateContent("Scene two\n");
    const saved = await bridge.save();

    expect(loaded).toMatchObject({
      path: "notes/scene.md",
      content: "Scene one\n",
      dirty: false,
      saveStatus: "Saved"
    });
    expect(saved).toMatchObject({
      content: "Scene two\n",
      dirty: false,
      saveStatus: "Saved"
    });
    expect(calls).toEqual([
      ["read", "notes/scene.md"],
      [
        "save",
        {
          path: "notes/scene.md",
          content: "Scene two\n",
          expectedChecksum: "sha256:one"
        }
      ]
    ]);
  });

  test("keeps the draft and exposes disk state when save detects a conflict", async () => {
    const api = createApi([], true);
    const bridge = createPlainFileEditorBridge(api);
    await bridge.openFile("notes/scene.md");
    bridge.updateContent("My draft\n");

    const conflicted = await bridge.save();

    expect(conflicted).toMatchObject({
      content: "My draft\n",
      dirty: true,
      saveStatus: "Unsaved",
      conflict: {
        diskContent: "Changed elsewhere\n",
        draftContent: "My draft\n",
        diskChecksum: "sha256:disk"
      }
    });
    expect(conflicted?.onReloadFromDisk).toBeTypeOf("function");
    expect(conflicted?.onKeepDraft).toBeTypeOf("function");

    conflicted?.onReloadFromDisk?.();
    expect(bridge.getProps()).toMatchObject({
      content: "Changed elsewhere\n",
      dirty: false,
      saveStatus: "Saved"
    });
    expect(bridge.getProps()?.conflict).toBeUndefined();
  });

  test("rechecks the acknowledged disk checksum when a kept draft is saved again", async () => {
    const calls: unknown[] = [];
    const bridge = createPlainFileEditorBridge(createApi(calls, true));
    await bridge.openFile("notes/scene.md");
    bridge.updateContent("My draft\n");
    const conflicted = await bridge.save();

    conflicted?.onKeepDraft?.();
    expect(bridge.getProps()).toMatchObject({
      content: "My draft\n",
      dirty: true,
      saveStatus: "Unsaved"
    });
    expect(bridge.getProps()?.conflict).toBeUndefined();

    const saved = await bridge.save();

    expect(saved).toMatchObject({ content: "My draft\n", dirty: false, saveStatus: "Saved" });
    expect(calls.at(-1)).toEqual([
      "save",
      {
        path: "notes/scene.md",
        content: "My draft\n",
        expectedChecksum: "sha256:disk"
      }
    ]);
  });
});

function createApi(calls: unknown[], conflict = false): NovelStudioApi {
  let conflictPending = conflict;
  return {
    workspace: {
      async readTextFile(path) {
        calls.push(["read", path]);
        return ok({
          path,
          content: "Scene one\n",
          checksum: "sha256:one",
          byteLength: 10
        });
      },
      async saveTextFile(input) {
        calls.push(["save", input]);
        if (conflictPending) {
          conflictPending = false;
          return ok({
            kind: "conflict" as const,
            current: {
              path: input.path,
              content: "Changed elsewhere\n",
              checksum: "sha256:disk",
              byteLength: 18
            },
            attemptedContent: input.content
          });
        }
        return ok({
          kind: "saved" as const,
          document: {
            path: input.path,
            content: input.content,
            checksum: "sha256:two",
            byteLength: input.content.length
          }
        });
      }
    }
  } as unknown as NovelStudioApi;
}
