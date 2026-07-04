import { describe, expect, test } from "vitest";

import { ok, type Result, type UnifiedError } from "@novel-studio/shared";
import type {
  AiWritingSuggestion,
  ApplicationCommand,
  ChapterEditorSnapshot,
  DesktopApplication,
  DesktopShellState
} from "@novel-studio/application";

import { createApplicationIpcHandlers } from "../src/main/ipc-handlers.js";
import { createNovelStudioApi } from "../src/preload/api.js";

const shellState: DesktopShellState = {
  projectTitle: "M14",
  activeActivity: "workspace",
  navigatorCollapsed: false,
  inspectorCollapsed: false,
  bottomPanelVisible: true,
  commandPaletteOpen: false,
  saveStatus: "Saved",
  navigatorSections: [],
  bottomPanelTabs: []
};

const suggestion: AiWritingSuggestion = {
  suggestionId: "sug_m14",
  workflowRunId: "wfrun_m14",
  status: "pending-confirmation",
  proposedBody: "Opening line.\nAI continuation.\n",
  summary: "Continues the current scene.",
  diffPreview: {
    title: "AI suggestion",
    changes: [{ kind: "replace", value: "Opening line.\nAI continuation.\n" }]
  },
  contextTrace: {
    selectionReason: "Continue.",
    includedRefs: [],
    excludedRefs: []
  }
};

describe("M14 AI writing workflow IPC", () => {
  test("exposes generate and apply through the preload API", async () => {
    const calls: string[] = [];
    const api = createNovelStudioApi({
      async invoke(channel, ...args) {
        calls.push(`${channel}:${args.length}`);
        return channel === "application:ai:apply-chapter-suggestion"
          ? ok(chapterSnapshot())
          : ok(suggestion);
      }
    });

    await api.ai.generateChapterSuggestion({ instruction: "Continue." });
    await api.ai.applyChapterSuggestion("sug_m14");

    expect(calls).toEqual([
      "application:ai:generate-chapter-suggestion:1",
      "application:ai:apply-chapter-suggestion:1"
    ]);
  });

  test("routes AI writing IPC channels to the Application layer", async () => {
    const handlers = createApplicationIpcHandlers(createFakeApplication());

    await expect(
      handlers["application:ai:generate-chapter-suggestion"]({ instruction: "Continue." })
    ).resolves.toEqual(ok(suggestion));
    await expect(handlers["application:ai:apply-chapter-suggestion"]("sug_m14")).resolves.toEqual(
      ok(chapterSnapshot())
    );
  });
});

function createFakeApplication(): DesktopApplication {
  return {
    getShellState: () => shellState,
    listCommands: (): readonly ApplicationCommand[] => [],
    executeCommand: () => ok(shellState),
    openProject: unsupported,
    createProject: unsupported,
    listProjectChapters: unsupported,
    createProjectChapter: unsupported,
    selectProjectChapter: unsupported,
    generateActiveChapterSuggestion: async () => ok(suggestion),
    applyActiveChapterSuggestion: async () => ok(chapterSnapshot()),
    loadActiveChapter: unsupported,
    editActiveChapter: unsupported,
    saveActiveChapter: unsupported,
    listActiveChapterVersions: unsupported,
    previewActiveChapterVersion: unsupported,
    restoreActiveChapterVersion: unsupported,
    previewActiveChapterSuggestionDiff: () => ok({ title: "AI suggestion", changes: [] }),
    listModelProfiles: unsupported,
    saveModelProfile: unsupported,
    testModelProfileConnection: unsupported,
    loadConfigAsset: unsupported,
    saveConfigAsset: unsupported,
    restoreConfigAssetVersion: unsupported
  };
}

function chapterSnapshot(): ChapterEditorSnapshot {
  return {
    state: {
      chapter: {
        frontmatter: {
          schemaVersion: "1.0",
          id: "ch_m14",
          type: "chapter",
          title: "M14",
          order: 1,
          status: "draft",
          createdAt: "2026-07-04T00:00:00.000Z",
          updatedAt: "2026-07-04T00:00:00.000Z"
        },
        body: "Opening line.\nAI continuation.\n"
      },
      dirty: true,
      saveStatus: "Unsaved"
    },
    versions: []
  };
}

async function unsupported<T>(): Promise<Result<T, UnifiedError>> {
  throw new Error("Not used by this test.");
}
