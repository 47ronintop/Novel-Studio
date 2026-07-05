import { describe, expect, test } from "vitest";

import type {
  ApplicationCommand,
  DesktopApplication,
  DesktopShellState,
  ProjectSearchIndex,
  ProjectSearchResults
} from "@novel-studio/application";
import { createApplicationIpcHandlers } from "../src/main/ipc-handlers.js";
import { createNovelStudioApi } from "../src/preload/api.js";
import { ok, type Result, type UnifiedError } from "@novel-studio/shared";

const shellState: DesktopShellState = {
  projectTitle: "M20",
  activeActivity: "search",
  navigatorCollapsed: false,
  inspectorCollapsed: false,
  bottomPanelVisible: true,
  commandPaletteOpen: false,
  saveStatus: "Saved",
  navigatorSections: [],
  bottomPanelTabs: []
};

const indexSnapshot: ProjectSearchIndex = {
  schemaVersion: "1.0",
  generatedAt: "2026-07-05T00:00:00.000Z",
  entryCount: 1,
  entries: [
    {
      id: "chapter:ch_opening",
      type: "chapter",
      title: "开篇",
      text: "The hero keeps a hidden oath.",
      updatedAt: "2026-07-05T00:00:00.000Z",
      sourceRef: {
        kind: "chapter",
        id: "ch_opening",
        relativePath: "chapters/ch_opening.md"
      }
    }
  ]
};

const searchResults: ProjectSearchResults = {
  query: "oath",
  generatedAt: indexSnapshot.generatedAt,
  entryCount: 1,
  results: [
    {
      id: "chapter:ch_opening",
      type: "chapter",
      title: "开篇",
      snippet: "The hero keeps a hidden oath.",
      score: 2,
      sourceRef: indexSnapshot.entries[0].sourceRef
    }
  ]
};

describe("M20 project search IPC", () => {
  test("exposes project search through preload without renderer filesystem access", async () => {
    const calls: string[] = [];
    const api = createNovelStudioApi({
      async invoke(channel, ...args) {
        calls.push(`${channel}:${args.length}`);
        return channel === "application:search:rebuild-index"
          ? ok(indexSnapshot)
          : ok(searchResults);
      }
    });

    await api.search.rebuildIndex();
    await api.search.query({ query: "oath" });

    expect(calls).toEqual(["application:search:rebuild-index:0", "application:search:query:1"]);
  });

  test("routes project search IPC channels to the Application layer", async () => {
    const handlers = createApplicationIpcHandlers(createFakeApplication());

    await expect(handlers["application:search:rebuild-index"]()).resolves.toEqual(
      ok(indexSnapshot)
    );
    await expect(handlers["application:search:query"]({ query: "oath" })).resolves.toEqual(
      ok(searchResults)
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
    rebuildProjectSearchIndex: async () => ok(indexSnapshot),
    searchProject: async () => ok(searchResults),
    loadStoryBible: unsupported,
    saveStoryBibleAsset: unsupported,
    saveStoryBibleMemory: unsupported,
    buildStoryBibleContextCandidates: unsupported,
    generateActiveChapterSuggestion: unsupported,
    applyActiveChapterSuggestion: unsupported,
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

async function unsupported<T>(): Promise<Result<T, UnifiedError>> {
  throw new Error("Not used by this test.");
}
