import { describe, expect, test, vi } from "vitest";

import type {
  NovelStudioApi,
  StoryBibleConsistencyReport,
  StoryBibleSnapshot
} from "@novel-studio/application";
import { createUnifiedError, err, ok } from "@novel-studio/shared";

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
      aliases: ["Oath bearer"],
      relatedEntityIds: ["loc_capital"],
      details: {
        role: "lead",
        arc: {
          start: "Avoids responsibility",
          futureArcField: "kept"
        },
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
    expect(bridge.getEditorProps().entries).toContainEqual(
      expect.objectContaining({
        id: "fsh_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        kind: "foreshadow",
        assetType: "foreshadow",
        summary: "The key will reveal who sealed the archive.",
        details: expect.objectContaining({ trackingStatus: "planned" }),
        createdAt: "2026-07-05T00:00:00.000Z",
        updatedAt: "2026-07-05T00:00:00.000Z"
      })
    );
    expect(bridge.getEditorProps().entries.some((entry) => entry.id === "mem_oath")).toBe(false);
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

  test("keeps memory consistency refs out of the author UI while allowing foreshadow refs", async () => {
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
          },
          {
            id: "story-consistency.foreshadow.fsh_key.loc_capital",
            severity: "warning",
            title: "Foreshadow and location need review",
            message: "The key conflicts with the archive location.",
            sourceRef: {
              kind: "foreshadow",
              id: "fsh_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              title: "Old key"
            },
            targetRef: {
              kind: "world",
              id: "loc_capital",
              title: "Capital"
            },
            suggestedAction: "Review the linked entries."
          }
        ]
      })
    );

    await bridge.load("workspace-01");

    expect(bridge.getEditorProps().consistency).toMatchObject({
      status: "attention",
      issues: [
        {
          id: "story-consistency.foreshadow.fsh_key.loc_capital",
          sourceRef: { kind: "foreshadow", id: "fsh_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
          targetRef: { kind: "world", id: "loc_capital" }
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
    expect(bridge.getEditorProps()).toMatchObject({ viewMode: "detail", dirty: false });
    bridge.updateDraft("character", {
      title: "Hero Revised",
      summary: "A revised oath holder.",
      details: { role: "mentor" }
    });
    expect(bridge.getEditorProps().dirty).toBe(true);
    const editor = await bridge.saveDraft();

    expect(calls).toContain("storyBible.saveAsset:chr_hero:Hero Revised");
    expect(editor.feedback).toEqual({
      kind: "info",
      message: "故事圣经已保存。"
    });
    expect(bridge.getProps().assets[0]?.title).toBe("Hero Revised");
    expect(bridge.getSnapshot().characters[0]).toMatchObject({
      futureRootField: { enabled: true },
      aliases: ["Oath bearer"],
      relatedEntityIds: ["loc_capital"],
      details: {
        role: "mentor",
        arc: {
          start: "Avoids responsibility",
          futureArcField: "kept"
        },
        futureDetailField: ["kept"]
      }
    });
    expect(editor).toMatchObject({ viewMode: "detail", dirty: false });
  });

  test("deep-merges edited character details without dropping unknown nested fields", async () => {
    const bridge = createStoryBibleBridge(createApi([]));
    await bridge.load("workspace-01");

    bridge.selectEntry("chr_hero");
    bridge.updateDraft("character", {
      details: {
        arc: {
          start: "Accepts the investigation"
        }
      }
    });
    await bridge.saveDraft();

    expect(bridge.getSnapshot().characters[0]?.details).toMatchObject({
      role: "lead",
      futureDetailField: ["kept"],
      arc: {
        start: "Accepts the investigation",
        futureArcField: "kept"
      }
    });
  });

  test("retains the dirty detail draft when Story Bible saving fails", async () => {
    const api = createApi([]);
    vi.spyOn(api.storyBible, "saveAsset").mockResolvedValue(
      err(
        createUnifiedError({
          code: "STORY_BIBLE_SAVE_FAILED",
          category: "StorageError",
          message: "Story Bible storage is unavailable.",
          recoverability: "retryable",
          suggestedAction: "Retry after storage is available.",
          traceId: "story-bible-test"
        })
      )
    );
    const bridge = createStoryBibleBridge(api);
    await bridge.load("workspace-01");
    bridge.selectEntry("chr_hero");
    bridge.updateDraft("character", { title: "Unsaved Hero" });

    const editor = await bridge.saveDraft();

    expect(editor).toMatchObject({
      viewMode: "detail",
      status: "error",
      dirty: true,
      draft: { id: "chr_hero", title: "Unsaved Hero" },
      feedback: { kind: "error", message: "Story Bible storage is unavailable." }
    });
    expect(bridge.getSnapshot().characters[0]?.title).toBe("Hero");
  });

  test("moves between list and detail, tracks dirty drafts, and rejects cross-kind patches", async () => {
    const bridge = createStoryBibleBridge(createApi([]));
    await bridge.load("workspace-01");

    expect(bridge.getEditorProps()).toMatchObject({
      activeKind: "character",
      viewMode: "list",
      dirty: false,
      externalUpdate: { status: "none" }
    });
    expect(bridge.updateFilters({ query: "hero", status: "draft" }).filters).toMatchObject({
      query: "hero",
      status: "draft",
      worldAssetType: "all",
      foreshadowTrackingStatus: "all"
    });
    expect(bridge.selectEntry("chr_hero")).toMatchObject({
      activeKind: "character",
      viewMode: "detail",
      dirty: false
    });
    expect(() => bridge.updateDraft("world", { title: "Wrong kind" })).toThrowError(
      /active character draft/u
    );
    expect(() =>
      bridge.updateDraft("character", {
        assetType: "world.location"
      } as never)
    ).toThrowError(/asset type/u);

    bridge.updateDraft("character", { title: "Local edit" });
    expect(bridge.getEditorProps().dirty).toBe(true);
    expect(bridge.cancelDraft()).toMatchObject({ viewMode: "list", dirty: false });
    expect(bridge.beginCreate("foreshadow")).toMatchObject({
      activeKind: "foreshadow",
      viewMode: "detail",
      dirty: false,
      draft: {
        kind: "foreshadow",
        assetType: "foreshadow",
        details: { trackingStatus: "planned", origin: "manual" }
      }
    });
  });

  test.each([
    ["character", "character", "chr_"],
    ["world", "world.location", "loc_"],
    ["world", "world.faction", "fac_"],
    ["world", "world.rule", "rule_"],
    ["world", "world.glossary", "term_"],
    ["foreshadow", "foreshadow", "fsh_"]
  ] as const)(
    "creates %s/%s IDs from an injected 32-hex identity",
    async (kind, assetType, prefix) => {
      const calls: string[] = [];
      const bridge = createStoryBibleBridge(createApi(calls), {
        createAssetIdentity: () => "b".repeat(32)
      });

      bridge.beginCreate(kind, kind === "world" ? assetType : undefined);
      bridge.updateDraft(kind, {
        title: "中文标题不会进入 ID",
        summary: "A new structured asset."
      } as never);
      const saved = await bridge.saveDraft();

      expect(calls).toContain(
        `storyBible.saveAsset:${prefix}${"b".repeat(32)}:中文标题不会进入 ID`
      );
      expect(saved.draft.id).toBe(`${prefix}${"b".repeat(32)}`);
      expect(saved).toMatchObject({ viewMode: "detail", dirty: false });
    }
  );

  test("requires a concrete world type before beginning a world draft", () => {
    const bridge = createStoryBibleBridge(createApi([]));

    expect(() => bridge.beginCreate("world")).toThrowError(/world asset type/u);
    expect(bridge.beginCreate("world", "world.glossary")).toMatchObject({
      activeKind: "world",
      viewMode: "detail",
      draft: {
        kind: "world",
        assetType: "world.glossary"
      }
    });
  });

  test("clears incompatible details when a new world draft changes type", () => {
    const bridge = createStoryBibleBridge(createApi([]));

    bridge.beginCreate("world", "world.rule");
    bridge.updateDraft("world", { details: { rule: "Magic echoes once." } });
    const editor = bridge.updateDraft("world", { assetType: "world.glossary" });

    expect(editor.draft).toMatchObject({
      kind: "world",
      assetType: "world.glossary",
      details: {}
    });
  });

  test.each([
    ["outline", "outline_main"],
    ["timeline", "timeline_main"]
  ] as const)("keeps the %s singleton ID fixed", async (kind, expectedId) => {
    const calls: string[] = [];
    const bridge = createStoryBibleBridge(createApi(calls), {
      createAssetIdentity: () => {
        throw new Error("singleton assets must not request a random identity");
      }
    });

    bridge.beginCreate(kind);
    bridge.updateDraft(kind, { title: "Main", summary: "Singleton summary." });
    const saved = await bridge.saveDraft();

    expect(calls).toContain(`storyBible.saveAsset:${expectedId}:Main`);
    expect(saved.draft.id).toBe(expectedId);
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
          foreshadows:
            asset.type === "foreshadow"
              ? replaceAsset(currentSnapshot.foreshadows, asset)
              : currentSnapshot.foreshadows,
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

function replaceAsset<
  T extends StoryBibleSnapshot["characters"][number] | StoryBibleSnapshot["foreshadows"][number]
>(assets: readonly T[], asset: T): readonly T[] {
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
