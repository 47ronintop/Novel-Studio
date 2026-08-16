import { describe, expect, test } from "vitest";

import type { NovelStudioApi } from "@novel-studio/application";
import { createUnifiedError, err, ok } from "@novel-studio/shared";

import { createPlainFileEditorBridge } from "../src/renderer/plain-file-editor-bridge.js";

describe("plain file editor bridge", () => {
  test("loads and saves a workspace file with its expected checksum", async () => {
    const calls: unknown[] = [];
    const api = createApi(calls);
    const bridge = createPlainFileEditorBridge(api);

    const loaded = await bridge.openFile("notes/scene.md");
    expect(bridge.getPersistedChecksum()).toBe("sha256:one");
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
    expect(bridge.getPersistedChecksum()).toBe("sha256:two");
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

  test("preserves a read-only reason and omits edit/save callbacks for managed files", async () => {
    const api = createApi([]);
    api.workspace.readTextFile = async () =>
      ok({
        path: "chapters/ch_01.md",
        content: "managed",
        checksum: "checksum",
        byteLength: 7,
        readOnlyReason: "由 Novel Studio 管理"
      });
    const bridge = createPlainFileEditorBridge(api);

    const opened = await bridge.openFile("chapters/ch_01.md");

    expect(opened).toMatchObject({ readOnlyReason: "由 Novel Studio 管理" });
    expect(opened.onContentChange).toBeUndefined();
    expect(opened.onSave).toBeUndefined();
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

  test("uses the current creative tree revision when saving an already-open file", async () => {
    const saves: CreativeSaveInput[] = [];
    let treeRevision: string | undefined = "tree-open";
    const api = createCreativeApi({
      onSave: async (input) => {
        saves.push(input);
        return ok({
          kind: "saved" as const,
          treeRevision: "tree-saved",
          document: {
            path: input.path,
            content: input.content,
            checksum: "sha256:saved",
            nodeRevision: "node-saved"
          }
        });
      }
    });
    const bridge = createPlainFileEditorBridge(api, {
      scope: "creativeProjectFile",
      identity: { projectId: "project-01", workspaceId: "workspace-01" },
      getTreeRevision: () => treeRevision
    });

    await bridge.openFile("notes/scene.md");
    treeRevision = "tree-current";
    bridge.updateContent("Scene two\n");
    await bridge.save();

    expect(saves).toEqual([
      {
        projectId: "project-01",
        workspaceId: "workspace-01",
        path: "notes/scene.md",
        content: "Scene two\n",
        expectedTreeRevision: "tree-current",
        expectedNodeRevision: "node-open",
        expectedChecksum: "sha256:open"
      }
    ]);
  });

  test("keeps nested source documents read-only without invoking creative save", async () => {
    const saves: unknown[] = [];
    const api = {
      creativeProjectFiles: {
        async readTextFile(request: { readonly path: string }) {
          return ok({
            path: request.path,
            content: "Source\n",
            checksum: "sha256:source",
            nodeRevision: "node-source",
            readOnlyReason: "来源文件，只读"
          });
        },
        async saveTextFile(request: unknown) {
          saves.push(request);
          return ok({});
        }
      }
    } as unknown as NovelStudioApi;
    const bridge = createPlainFileEditorBridge(api, {
      scope: "creativeProjectFile",
      identity: { projectId: "project-01", workspaceId: "workspace-01" },
      getTreeRevision: () => "tree-source"
    });

    const opened = await bridge.openFile("source/notes.md");
    bridge.updateContent("Changed\n");
    await bridge.save();

    expect(opened).toMatchObject({
      content: "Source\n",
      readOnlyReason: "来源文件，只读"
    });
    expect(bridge.getProps()).toMatchObject({ content: "Source\n", dirty: false });
    expect(saves).toEqual([]);
  });

  test("uses creative conflict revisions when keeping a draft before saving again", async () => {
    const saves: CreativeSaveInput[] = [];
    let treeRevision: string | undefined = "tree-open";
    const api = createCreativeApi({
      onSave: async (input) => {
        saves.push(input);
        return saves.length === 1
          ? ok({
              kind: "conflict" as const,
              treeRevision: "tree-disk",
              current: {
                path: input.path,
                content: "Changed elsewhere\n",
                checksum: "sha256:disk",
                nodeRevision: "node-disk"
              }
            })
          : ok({
              kind: "saved" as const,
              treeRevision: "tree-after-save",
              document: {
                path: input.path,
                content: input.content,
                checksum: "sha256:after-save",
                nodeRevision: "node-after-save"
              }
            });
      }
    });
    const bridge = createPlainFileEditorBridge(api, {
      scope: "creativeProjectFile",
      identity: { projectId: "project-01", workspaceId: "workspace-01" },
      getTreeRevision: () => treeRevision
    });

    await bridge.openFile("notes/scene.md");
    bridge.updateContent("My draft\n");
    const conflicted = await bridge.save();
    treeRevision = undefined;
    conflicted?.onKeepDraft?.();
    await bridge.save();

    expect(saves.at(-1)).toEqual({
      projectId: "project-01",
      workspaceId: "workspace-01",
      path: "notes/scene.md",
      content: "My draft\n",
      expectedTreeRevision: "tree-disk",
      expectedNodeRevision: "node-disk",
      expectedChecksum: "sha256:disk"
    });
  });

  test("uses creative conflict revisions when reloading disk before saving again", async () => {
    const saves: CreativeSaveInput[] = [];
    let treeRevision: string | undefined = "tree-open";
    const api = createCreativeApi({
      onSave: async (input) => {
        saves.push(input);
        return saves.length === 1
          ? ok({
              kind: "conflict" as const,
              treeRevision: "tree-disk",
              current: {
                path: input.path,
                content: "Changed elsewhere\n",
                checksum: "sha256:disk",
                nodeRevision: "node-disk"
              }
            })
          : ok({
              kind: "saved" as const,
              treeRevision: "tree-after-save",
              document: {
                path: input.path,
                content: input.content,
                checksum: "sha256:after-save",
                nodeRevision: "node-after-save"
              }
            });
      }
    });
    const bridge = createPlainFileEditorBridge(api, {
      scope: "creativeProjectFile",
      identity: { projectId: "project-01", workspaceId: "workspace-01" },
      getTreeRevision: () => treeRevision
    });

    await bridge.openFile("notes/scene.md");
    bridge.updateContent("My draft\n");
    const conflicted = await bridge.save();
    treeRevision = undefined;
    conflicted?.onReloadFromDisk?.();
    bridge.updateContent("Resolved draft\n");
    await bridge.save();

    expect(saves.at(-1)).toEqual({
      projectId: "project-01",
      workspaceId: "workspace-01",
      path: "notes/scene.md",
      content: "Resolved draft\n",
      expectedTreeRevision: "tree-disk",
      expectedNodeRevision: "node-disk",
      expectedChecksum: "sha256:disk"
    });
  });

  test("keeps the active file snapshot when preparing another file fails", async () => {
    const api = createApi([]);
    const readTextFile = api.workspace.readTextFile;
    let fail = false;
    api.workspace.readTextFile = (path) =>
      fail
        ? Promise.resolve(
            err(
              createUnifiedError({
                code: "ENGINEERING_FILE_READ_FAILED",
                category: "StorageError",
                message: "File could not be read.",
                recoverability: "retryable",
                suggestedAction: "Retry file navigation.",
                traceId: "plain-file-editor-bridge-test"
              })
            )
          )
        : readTextFile(path);
    const bridge = createPlainFileEditorBridge(api);
    await bridge.openFile("notes/current.md");
    const previous = JSON.stringify(bridge.getProps());
    fail = true;

    await expect(bridge.openFile("notes/missing.md")).rejects.toThrow("File could not be read.");

    expect(JSON.stringify(bridge.getProps())).toBe(previous);
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

interface CreativeSaveInput {
  readonly projectId: string;
  readonly workspaceId: string;
  readonly path: string;
  readonly content: string;
  readonly expectedTreeRevision: string;
  readonly expectedNodeRevision: string;
  readonly expectedChecksum: string;
}

function createCreativeApi(input: {
  readonly onSave: (request: CreativeSaveInput) => Promise<unknown>;
}): NovelStudioApi {
  return {
    creativeProjectFiles: {
      async readTextFile(request: { readonly path: string }) {
        return ok({
          path: request.path,
          content: "Scene one\n",
          checksum: "sha256:open",
          nodeRevision: "node-open"
        });
      },
      async saveTextFile(request: CreativeSaveInput) {
        return input.onSave(request);
      }
    }
  } as unknown as NovelStudioApi;
}
