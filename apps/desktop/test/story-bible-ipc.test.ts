import { describe, expect, test, vi } from "vitest";

import { ok, type Result, type UnifiedError } from "@novel-studio/shared";
import type {
  ApplicationCommand,
  DesktopApplication,
  DesktopShellState,
  ForeshadowAsset,
  MemoryRecord,
  StoryBibleAsset,
  StoryBibleConsistencyReport,
  StoryBibleContextCandidate,
  StoryBibleSnapshot
} from "@novel-studio/application";

import { createApplicationIpcHandlers } from "../src/main/ipc-handlers.js";
import { createNovelStudioApi } from "../src/preload/api.js";

const now = "2026-07-05T00:00:00.000Z";

const shellState: DesktopShellState = {
  projectTitle: "M16",
  activeActivity: "workspace",
  navigatorCollapsed: false,
  inspectorCollapsed: false,
  bottomPanelVisible: true,
  commandPaletteOpen: false,
  saveStatus: "Saved",
  navigatorSections: [],
  bottomPanelTabs: []
};

const snapshot: StoryBibleSnapshot = {
  characters: [characterAsset()],
  worldAssets: [worldAsset()],
  foreshadows: [foreshadowAsset()],
  memories: [memoryRecord()]
};

describe("M16 Story Bible IPC", () => {
  test("exposes Story Bible commands through preload without renderer filesystem access", async () => {
    const calls: string[] = [];
    const api = createNovelStudioApi({
      async invoke(channel, ...args) {
        calls.push(`${channel}:${args.length}`);
        if (channel === "application:story-bible:build-context-candidates") {
          return ok(contextCandidates());
        }
        if (channel === "application:story-bible:build-consistency-report") {
          return ok(consistencyReport());
        }
        if (channel === "application:story-bible:save-asset") {
          return ok(characterAsset());
        }
        if (channel === "application:story-bible:save-memory") {
          return ok(memoryRecord());
        }
        return ok(snapshot);
      }
    });

    await api.storyBible.load();
    await api.storyBible.saveAsset(characterAsset());
    await api.storyBible.saveMemory(memoryRecord());
    await api.storyBible.buildConsistencyReport();
    await api.storyBible.buildContextCandidates({ includeStatuses: ["active"] });

    expect(calls).toEqual([
      "application:story-bible:load:0",
      "application:story-bible:save-asset:1",
      "application:story-bible:save-memory:1",
      "application:story-bible:build-consistency-report:0",
      "application:story-bible:build-context-candidates:1"
    ]);
  });

  test("routes Story Bible IPC channels to the Application layer", async () => {
    const handlers = createApplicationIpcHandlers(createFakeApplication());

    await expect(handlers["application:story-bible:load"]()).resolves.toEqual(ok(snapshot));
    await expect(handlers["application:story-bible:save-asset"](characterAsset())).resolves.toEqual(
      ok(characterAsset())
    );
    await expect(handlers["application:story-bible:save-memory"](memoryRecord())).resolves.toEqual(
      ok(memoryRecord())
    );
    await expect(handlers["application:story-bible:build-consistency-report"]()).resolves.toEqual(
      ok(consistencyReport())
    );
    await expect(
      handlers["application:story-bible:build-context-candidates"]({ includeStatuses: ["active"] })
    ).resolves.toEqual(ok(contextCandidates()));
  });

  test("preserves unknown foreshadow fields and emits canonical field order through IPC", async () => {
    const asset: ForeshadowAsset = {
      futureRootField: { enabled: true },
      ...foreshadowAsset(),
      details: {
        ...foreshadowAsset().details,
        futureDetailField: ["kept"]
      }
    };
    const saveStoryBibleAsset = vi.fn(async (input: StoryBibleAsset) => ok(input));
    const handlers = createApplicationIpcHandlers({
      ...createFakeApplication(),
      saveStoryBibleAsset
    });

    await expect(handlers["application:story-bible:save-asset"](asset)).resolves.toEqual(ok(asset));
    expect(saveStoryBibleAsset).toHaveBeenCalledWith(asset);
    expect(Object.keys(saveStoryBibleAsset.mock.calls[0]?.[0] ?? {})).toEqual([
      "schemaVersion",
      "id",
      "type",
      "title",
      "status",
      "summary",
      "details",
      "createdAt",
      "updatedAt",
      "futureRootField"
    ]);
  });

  test("rejects unsupported Story Bible schema versions at the IPC boundary", async () => {
    const saveStoryBibleAsset = vi.fn(async (input: StoryBibleAsset) => ok(input));
    const handlers = createApplicationIpcHandlers({
      ...createFakeApplication(),
      saveStoryBibleAsset
    });

    await handlers["application:story-bible:save-asset"]({
      ...characterAsset(),
      schemaVersion: "2.0"
    });

    expect(saveStoryBibleAsset).toHaveBeenCalledWith(
      expect.objectContaining({ id: "", type: "character" })
    );
    expect(saveStoryBibleAsset).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: "chr_hero" })
    );
  });

  test("does not pass structurally invalid foreshadow details through IPC", async () => {
    const saveStoryBibleAsset = vi.fn(async (input: StoryBibleAsset) => ok(input));
    const handlers = createApplicationIpcHandlers({
      ...createFakeApplication(),
      saveStoryBibleAsset
    });

    await handlers["application:story-bible:save-asset"]({
      ...foreshadowAsset(),
      details: {}
    });

    expect(saveStoryBibleAsset).toHaveBeenCalledWith(
      expect.objectContaining({ id: "", type: "character" })
    );
    expect(saveStoryBibleAsset).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "foreshadow" })
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
    loadStoryBible: async () => ok(snapshot),
    saveStoryBibleAsset: async () => ok(characterAsset()),
    saveStoryBibleMemory: async () => ok(memoryRecord()),
    buildStoryBibleConsistencyReport: async () => ok(consistencyReport()),
    buildStoryBibleContextCandidates: async () => ok(contextCandidates()),
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

function consistencyReport(): StoryBibleConsistencyReport {
  return {
    status: "healthy",
    checkedAt: now,
    issues: []
  };
}

function contextCandidates(): readonly StoryBibleContextCandidate[] {
  return [
    {
      refType: "character",
      refId: "chr_hero",
      content: "A procedural protagonist with a hidden oath.",
      priority: 100,
      sourceRefs: [{ entityType: "character", entityId: "chr_hero" }]
    }
  ];
}

function characterAsset(): StoryBibleAsset {
  return {
    schemaVersion: "1.0",
    id: "chr_hero",
    type: "character",
    title: "Hero",
    status: "active",
    summary: "A procedural protagonist with a hidden oath.",
    createdAt: now,
    updatedAt: now
  };
}

function worldAsset(): StoryBibleAsset {
  return {
    schemaVersion: "1.0",
    id: "loc_capital",
    type: "world.location",
    title: "Capital",
    status: "active",
    summary: "The capital bans open flame after midnight.",
    createdAt: now,
    updatedAt: now
  };
}

function foreshadowAsset(): ForeshadowAsset {
  return {
    schemaVersion: "1.0",
    id: "fsh_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    type: "foreshadow",
    title: "Old key",
    status: "active",
    summary: "The key will reveal who sealed the archive.",
    details: {
      trackingStatus: "planned",
      plannedPayoffChapterId: "ch_05",
      origin: "manual"
    },
    createdAt: now,
    updatedAt: now
  };
}

function memoryRecord(): MemoryRecord {
  return {
    schemaVersion: "1.0",
    id: "mem_oath",
    type: "memory.long-term",
    title: "Oath",
    status: "active",
    origin: "user-confirmed-ai",
    confidence: "confirmed",
    content: "The hero never reveals the old oath aloud.",
    createdAt: now,
    updatedAt: now
  };
}

async function unsupported<T>(): Promise<Result<T, UnifiedError>> {
  throw new Error("Not used by this test.");
}
