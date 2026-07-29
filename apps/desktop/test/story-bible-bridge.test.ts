import { describe, expect, test, vi } from "vitest";

import type {
  NovelStudioApi,
  StoryBibleConsistencyReport,
  StoryBibleSnapshot
} from "@novel-studio/application";
import { ok } from "@novel-studio/shared";

import { createStoryBibleBridge } from "../src/renderer/story-bible-bridge.js";

const snapshot: StoryBibleSnapshot = {
  characters: [
    {
      schemaVersion: "1.0",
      id: "chr_hero",
      type: "character",
      title: "Hero",
      status: "active",
      summary: "A procedural protagonist with a hidden oath.",
      details: {
        role: "lead",
        futureDetailField: ["kept"]
      },
      futureRootField: { enabled: true },
      createdAt: "2026-07-05T00:00:00.000Z",
      updatedAt: "2026-07-05T00:00:00.000Z"
    }
  ],
  worldAssets: [
    {
      schemaVersion: "1.0",
      id: "loc_capital",
      type: "world.location",
      title: "Capital",
      status: "active",
      summary: "The capital bans open flame after midnight.",
      createdAt: "2026-07-05T00:00:00.000Z",
      updatedAt: "2026-07-05T00:00:00.000Z"
    }
  ],
  foreshadows: [
    {
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
      createdAt: "2026-07-05T00:00:00.000Z",
      updatedAt: "2026-07-05T00:00:00.000Z"
    }
  ],
  memories: [
    {
      schemaVersion: "1.0",
      id: "mem_oath",
      type: "memory.long-term",
      title: "Oath",
      status: "active",
      origin: "user-confirmed-ai",
      confidence: "confirmed",
      content: "The hero never reveals the old oath aloud.",
      createdAt: "2026-07-05T00:00:00.000Z",
      updatedAt: "2026-07-05T00:00:00.000Z"
    }
  ]
};

describe("Story Bible bridge", () => {
  test("loads Story Bible snapshot and maps it to UI summary props", async () => {
    const calls: string[] = [];
    const bridge = createStoryBibleBridge(createApi(calls));

    const props = await bridge.load("workspace-01");

    expect(calls).toEqual(["storyBible.load", "storyBible.buildConsistencyReport"]);
    expect(props.assets.map((asset) => asset.title)).toEqual([
      "Hero",
      "Capital",
      "Old key",
      "Oath"
    ]);
    expect(bridge.getEditorProps().entries.some((entry) => entry.id.startsWith("fsh_"))).toBe(
      false
    );
    expect(props.assets[2]).toMatchObject({
      id: "fsh_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      type: "foreshadow",
      contextEligible: true
    });
    expect(props.assets[3]).toMatchObject({
      id: "mem_oath",
      type: "memory.long-term",
      contextEligible: true
    });
    expect(bridge.getSnapshot()).toBe(snapshot);
    expect(bridge.getSnapshotBinding("workspace-01")).toEqual({
      workspaceId: "workspace-01",
      snapshot
    });
  });

  test("loads Story Bible consistency warnings into editor props", async () => {
    const bridge = createStoryBibleBridge(
      createApi([], snapshot, {
        status: "attention",
        checkedAt: "2026-07-05T00:00:00.000Z",
        issues: [
          {
            id: "story-consistency.character.chr_hero.mem_oath",
            severity: "warning",
            title: "Character setting may conflict with a memory",
            message: "Hero appears in Oath with an explicit conflict marker.",
            sourceRef: {
              kind: "character",
              id: "chr_hero",
              title: "Hero"
            },
            targetRef: {
              kind: "memory",
              id: "mem_oath",
              title: "Oath"
            },
            suggestedAction: "Open the linked Story Bible entry and resolve the setting conflict."
          }
        ]
      })
    );

    await bridge.load("workspace-01");

    expect(bridge.getEditorProps().consistency).toMatchObject({
      status: "attention",
      issues: [
        {
          targetRef: {
            id: "mem_oath",
            title: "Oath"
          }
        }
      ]
    });
  });

  test("filters consistency issues whose references are not navigable before the UI redesign", async () => {
    const bridge = createStoryBibleBridge(
      createApi([], snapshot, {
        status: "attention",
        checkedAt: "2026-07-05T00:00:00.000Z",
        issues: [
          {
            id: "story-consistency.foreshadow.missing-chapter.fsh_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.ch_missing",
            severity: "warning",
            title: "Foreshadow references a missing chapter",
            message: "Old key references a chapter that no longer exists.",
            sourceRef: {
              kind: "foreshadow",
              id: "fsh_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              title: "Old key"
            },
            targetRef: {
              kind: "chapter",
              id: "ch_missing",
              title: "ch_missing"
            },
            suggestedAction: "Update or remove the missing chapter reference."
          }
        ]
      })
    );

    await bridge.load("workspace-01");

    expect(bridge.getEditorProps().consistency).toMatchObject({
      status: "attention",
      issues: []
    });
  });

  test("edits and saves Story Bible asset drafts through the preload API", async () => {
    const calls: string[] = [];
    const bridge = createStoryBibleBridge(createApi(calls));
    await bridge.load("workspace-01");

    bridge.selectEntry("chr_hero");
    bridge.updateDraft({ title: "Hero Revised", body: "A revised oath holder." });
    const editor = await bridge.saveDraft();

    expect(calls).toContain("storyBible.saveAsset:chr_hero:Hero Revised");
    expect(editor.feedback).toEqual({
      kind: "info",
      message: "故事圣经已保存。"
    });
    expect(bridge.getProps().assets[0]?.title).toBe("Hero Revised");
    expect(bridge.getSnapshot().characters[0]).toMatchObject({
      futureRootField: { enabled: true },
      details: {
        role: "lead",
        futureDetailField: ["kept"]
      }
    });
  });

  test("creates confirmed memory drafts through the preload API", async () => {
    const calls: string[] = [];
    const bridge = createStoryBibleBridge(createApi(calls));

    bridge.selectKind("memory");
    bridge.updateDraft({ title: "Hidden Oath", body: "The oath is never spoken aloud." });
    await bridge.saveDraft();

    expect(calls).toContain("storyBible.saveMemory:mem_hidden_oath:Hidden Oath");
  });

  test("maps structured timeline events for the timeline workspace", async () => {
    const bridge = createStoryBibleBridge(
      createApi([], {
        ...snapshot,
        timeline: {
          schemaVersion: "1.0",
          id: "timeline_main",
          type: "timeline.events",
          title: "Main Timeline",
          status: "active",
          summary: "Arrival happens before the council summons.",
          details: {
            events: [
              {
                id: "evt_council",
                sequence: 20,
                title: "Council summons",
                status: "draft",
                summary: "The council asks for the sealed archive.",
                chapterIds: ["ch_02"]
              },
              {
                id: "evt_arrival",
                sequence: 10,
                title: "Hero arrives",
                status: "active",
                summary: "The hero enters the capital.",
                chapterIds: ["ch_01"]
              }
            ]
          },
          createdAt: "2026-07-05T00:00:00.000Z",
          updatedAt: "2026-07-05T00:00:00.000Z"
        }
      })
    );

    await bridge.load("workspace-01");
    const timelineEntry = bridge
      .getEditorProps()
      .entries.find((entry) => entry.id === "timeline_main");

    expect(timelineEntry?.timelineEvents?.map((event) => event.id)).toEqual([
      "evt_arrival",
      "evt_council"
    ]);
    expect(timelineEntry?.timelineEvents?.[0]).toMatchObject({
      parentEntryId: "timeline_main",
      title: "Hero arrives",
      status: "active",
      sequence: 10,
      chapterIds: ["ch_01"]
    });
  });

  test("clears the previous workspace snapshot while the next one is loading", async () => {
    let loadCount = 0;
    let resolveNextLoad: ((value: ReturnType<typeof ok<StoryBibleSnapshot>>) => void) | undefined;
    const api = createApi([]);
    const bridge = createStoryBibleBridge({
      ...api,
      storyBible: {
        ...api.storyBible,
        load: () => {
          loadCount += 1;
          if (loadCount === 1) return Promise.resolve(ok(snapshot));
          return new Promise<ReturnType<typeof ok<StoryBibleSnapshot>>>((resolve) => {
            resolveNextLoad = resolve;
          });
        }
      }
    });

    await bridge.load("workspace-a");
    const loadingWorkspaceB = bridge.load("workspace-b");

    await vi.waitFor(() => expect(resolveNextLoad).toBeDefined());
    expect(bridge.getSnapshotBinding("workspace-a")).toBeUndefined();
    expect(bridge.getSnapshot()).toEqual({
      characters: [],
      worldAssets: [],
      foreshadows: [],
      memories: []
    });

    resolveNextLoad?.(ok({ ...snapshot, characters: [] }));
    await loadingWorkspaceB;

    expect(bridge.getSnapshotBinding("workspace-b")?.snapshot.characters).toEqual([]);
  });

  test("discards a late Story Bible load from the previous workspace", async () => {
    const pendingLoads: Array<(value: ReturnType<typeof ok<StoryBibleSnapshot>>) => void> = [];
    const api = createApi([]);
    const bridge = createStoryBibleBridge({
      ...api,
      storyBible: {
        ...api.storyBible,
        load: () =>
          new Promise<ReturnType<typeof ok<StoryBibleSnapshot>>>((resolve) => {
            pendingLoads.push(resolve);
          })
      }
    });

    const loadingWorkspaceA = bridge.load("workspace-a");
    await vi.waitFor(() => expect(pendingLoads).toHaveLength(1));
    const loadingWorkspaceB = bridge.load("workspace-b");
    await vi.waitFor(() => expect(pendingLoads).toHaveLength(2));

    pendingLoads[1]?.(ok({ ...snapshot, characters: [] }));
    await loadingWorkspaceB;
    pendingLoads[0]?.(ok(snapshot));
    await loadingWorkspaceA;

    expect(bridge.getSnapshotBinding("workspace-a")).toBeUndefined();
    expect(bridge.getSnapshotBinding("workspace-b")?.snapshot.characters).toEqual([]);
  });
});

function createApi(
  calls: string[],
  initialSnapshot: StoryBibleSnapshot = snapshot,
  consistencyReport: StoryBibleConsistencyReport = {
    status: "healthy",
    checkedAt: "2026-07-05T00:00:00.000Z",
    issues: []
  }
): NovelStudioApi {
  let currentSnapshot = initialSnapshot;

  return {
    getShellState: async () => ({
      projectTitle: "M16",
      activeActivity: "workspace",
      navigatorCollapsed: false,
      inspectorCollapsed: false,
      bottomPanelVisible: true,
      commandPaletteOpen: false,
      saveStatus: "Saved",
      navigatorSections: [],
      bottomPanelTabs: []
    }),
    commands: {
      list: async () => [],
      execute: async () =>
        ok({
          projectTitle: "M16",
          activeActivity: "workspace",
          navigatorCollapsed: false,
          inspectorCollapsed: false,
          bottomPanelVisible: true,
          commandPaletteOpen: false,
          saveStatus: "Saved",
          navigatorSections: [],
          bottomPanelTabs: []
        })
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
      create: async () => {
        throw new Error("not used");
      },
      listChapters: async () => {
        throw new Error("not used");
      },
      createChapter: async () => {
        throw new Error("not used");
      },
      selectChapter: async () => {
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
    ai: {
      generateChapterSuggestion: async () => {
        throw new Error("not used");
      },
      applyChapterSuggestion: async () => {
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
      saveModelProfile: async () => {
        throw new Error("not used");
      },
      testModelProfileConnection: async () => {
        throw new Error("not used");
      }
    },
    storyBible: {
      load: async () => {
        calls.push("storyBible.load");
        return ok(currentSnapshot);
      },
      saveAsset: async (asset) => {
        calls.push(`storyBible.saveAsset:${asset.id}:${asset.title}`);
        currentSnapshot = {
          ...currentSnapshot,
          characters:
            asset.type === "character"
              ? replaceAsset(currentSnapshot.characters, asset)
              : currentSnapshot.characters,
          worldAssets: asset.type.startsWith("world.")
            ? replaceAsset(currentSnapshot.worldAssets, asset)
            : currentSnapshot.worldAssets,
          ...(asset.type === "outline" ? { outline: asset } : {}),
          ...(asset.type === "timeline.events" ? { timeline: asset } : {})
        };
        return ok(asset);
      },
      saveMemory: async (memory) => {
        calls.push(`storyBible.saveMemory:${memory.id}:${memory.title}`);
        currentSnapshot = {
          ...currentSnapshot,
          memories: replaceMemory(currentSnapshot.memories, memory)
        };
        return ok(memory);
      },
      buildConsistencyReport: async () => {
        calls.push("storyBible.buildConsistencyReport");
        return ok(consistencyReport);
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
    }
  };
}

function replaceAsset<T extends StoryBibleSnapshot["characters"][number]>(
  assets: readonly T[],
  asset: T
): readonly T[] {
  const exists = assets.some((entry) => entry.id === asset.id);
  if (!exists) {
    return [...assets, asset];
  }

  return assets.map((entry) => (entry.id === asset.id ? asset : entry));
}

function replaceMemory(
  memories: StoryBibleSnapshot["memories"],
  memory: StoryBibleSnapshot["memories"][number]
): StoryBibleSnapshot["memories"] {
  const exists = memories.some((entry) => entry.id === memory.id);
  if (!exists) {
    return [...memories, memory];
  }

  return memories.map((entry) => (entry.id === memory.id ? memory : entry));
}
