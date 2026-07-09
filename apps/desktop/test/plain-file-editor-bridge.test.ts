import { describe, expect, test } from "vitest";

import { ok } from "@novel-studio/shared";
import type { NovelStudioApi } from "@novel-studio/application";

import { createPlainFileEditorBridge } from "../src/renderer/plain-file-editor-bridge.js";

describe("plain file editor bridge", () => {
  test("loads, edits, and saves an ordinary text file by project-relative path", async () => {
    const calls: string[] = [];
    const api = createApi(calls);
    const bridge = createPlainFileEditorBridge(api);

    const loaded = await bridge.openFile("D:/Draft Folder", "notes/scene.md");
    const edited = bridge.updateContent("Scene two\n");
    const saving = bridge.beginSave();
    const saved = await bridge.save();

    expect(loaded).toMatchObject({
      path: "notes/scene.md",
      fileName: "scene.md",
      content: "Scene one\n",
      dirty: false,
      saveStatus: "Saved"
    });
    expect(edited).toMatchObject({
      content: "Scene two\n",
      dirty: true,
      saveStatus: "Unsaved"
    });
    expect(saving?.saveStatus).toBe("Saving");
    expect(saved).toMatchObject({
      content: "Scene two\n",
      dirty: false,
      saveStatus: "Saved"
    });
    expect(calls).toEqual([
      "file.readText:D:/Draft Folder:notes/scene.md",
      "file.writeText:D:/Draft Folder:notes/scene.md:Scene two\n"
    ]);
  });
});

function createApi(calls: string[]): NovelStudioApi {
  return {
    getShellState: async () => {
      throw new Error("not used");
    },
    commands: {
      list: async () => {
        throw new Error("not used");
      },
      execute: async () => {
        throw new Error("not used");
      }
    },
    project: {
      chooseOpenDirectory: async () => {
        throw new Error("not used");
      },
      chooseCreateDirectory: async () => {
        throw new Error("not used");
      },
      open: async () => {
        throw new Error("not used");
      },
      readDirectory: async () => {
        throw new Error("not used");
      },
      create: async () => {
        throw new Error("not used");
      },
      listChapters: async () => {
        throw new Error("not used");
      },
      createChapter: async () => {
        throw new Error("not used");
      },
      renameChapter: async () => {
        throw new Error("not used");
      },
      duplicateChapter: async () => {
        throw new Error("not used");
      },
      deleteChapter: async () => {
        throw new Error("not used");
      },
      selectChapter: async () => {
        throw new Error("not used");
      },
      previewRecoveryDraft: async () => {
        throw new Error("not used");
      },
      applyRecoveryDraft: async () => {
        throw new Error("not used");
      },
      discardRecoveryDraft: async () => {
        throw new Error("not used");
      }
    },
    file: {
      readText: async (projectRoot, path) => {
        calls.push(`file.readText:${projectRoot}:${path}`);
        return ok({ path, content: "Scene one\n" });
      },
      writeText: async (projectRoot, path, content) => {
        calls.push(`file.writeText:${projectRoot}:${path}:${content}`);
        return ok({ path });
      }
    },
    ai: {
      generateChapterSuggestion: async () => {
        throw new Error("not used");
      },
      streamChapterSuggestion: () => {
        throw new Error("not used");
      },
      generateSelectionPreview: async () => {
        throw new Error("not used");
      },
      applySelectionPreview: async () => {
        throw new Error("not used");
      },
      applyChapterSuggestion: async () => {
        throw new Error("not used");
      },
      listWorkflowRuns: async () => {
        throw new Error("not used");
      },
      readWorkflowRun: async () => {
        throw new Error("not used");
      }
    },
    search: {
      rebuildIndex: async () => {
        throw new Error("not used");
      },
      query: async () => {
        throw new Error("not used");
      }
    },
    chapter: {
      load: async () => {
        throw new Error("not used");
      },
      edit: async () => {
        throw new Error("not used");
      },
      save: async () => {
        throw new Error("not used");
      },
      listVersions: async () => {
        throw new Error("not used");
      },
      previewVersion: async () => {
        throw new Error("not used");
      },
      restoreVersion: async () => {
        throw new Error("not used");
      },
      previewSuggestionDiff: async () => {
        throw new Error("not used");
      }
    },
    settings: {
      listModelProfiles: async () => {
        throw new Error("not used");
      },
      discoverModelOptions: async () => {
        throw new Error("not used");
      },
      saveModelProfile: async () => {
        throw new Error("not used");
      },
      saveModelSecret: async () => {
        throw new Error("not used");
      },
      testModelProfileConnection: async () => {
        throw new Error("not used");
      }
    },
    plugins: {
      loadRegistry: async () => {
        throw new Error("not used");
      },
      setEnabled: async () => {
        throw new Error("not used");
      }
    },
    storyBible: {
      load: async () => {
        throw new Error("not used");
      },
      saveAsset: async () => {
        throw new Error("not used");
      },
      saveMemory: async () => {
        throw new Error("not used");
      },
      buildConsistencyReport: async () => {
        throw new Error("not used");
      },
      buildContextCandidates: async () => {
        throw new Error("not used");
      }
    },
    studio: {
      loadConfigAsset: async () => {
        throw new Error("not used");
      },
      saveConfigAsset: async () => {
        throw new Error("not used");
      },
      restoreConfigAssetVersion: async () => {
        throw new Error("not used");
      }
    },
    preferences: {
      load: async () => {
        throw new Error("not used");
      },
      save: async () => {
        throw new Error("not used");
      }
    }
  };
}
