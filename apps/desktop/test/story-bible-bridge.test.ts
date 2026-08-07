import { describe, expect, test, vi } from "vitest";

import type {
  ForeshadowAnalysisResultDto,
  NovelStudioApi,
  StoryBibleAsset,
  StoryBibleConsistencyReport,
  StoryBibleEditableAsset,
  StoryBibleExplicitInversePreview,
  StoryBibleReferenceImpact,
  StoryBibleSnapshot
} from "@novel-studio/application";
import {
  createUnifiedError,
  err,
  hashForeshadowEvidence,
  ok,
  type JsonObject
} from "@novel-studio/shared";

import {
  createStoryBibleBridge,
  type StoryBibleBridge
} from "../src/renderer/story-bible-bridge.js";

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

const analysisResult: ForeshadowAnalysisResultDto = {
  analysisId: "analysis-01",
  chapterIds: ["ch_01", "ch_02"],
  candidates: [
    {
      candidateId: "candidate-new",
      kind: "new",
      evidence: {
        chapterId: "ch_01",
        excerpt: "He slipped the old key into his sleeve.",
        excerptHash: "1".repeat(64)
      },
      reason: "The key is emphasized without an immediate explanation.",
      duplicateForeshadowIds: [],
      suggested: {
        title: "Old key",
        summary: "The key's purpose remains hidden.",
        trackingStatus: "planted",
        plantedChapterId: "ch_01"
      }
    }
  ],
  usage: {
    inputTokens: 120,
    outputTokens: 80,
    totalTokens: 200,
    usageStatus: "actual",
    cost: { amount: 0, currency: "USD", status: "unknown" }
  },
  createdAt: "2026-07-30T00:00:00.000Z"
};

describe("Story Bible bridge", () => {
  test("reports the selected Story Bible draft without confusing it with a chapter", async () => {
    const calls: string[] = [];
    const reports: Array<{
      readonly resourceKind: "story_bible";
      readonly resourceId: string;
      readonly rendererRevision: number;
      readonly acknowledgedRevision: number;
      readonly dirty: boolean;
      readonly bufferChecksum: string;
    }> = [];
    const api = createApi(calls);
    api.writingEditor = {
      reportState: async (report) => {
        if (report.resourceKind !== "story_bible")
          throw new Error("Expected a Story Bible report.");
        reports.push(report);
        return {
          ok: true,
          acknowledgement: {
            workspaceId: report.workspaceId,
            resourceKind: report.resourceKind,
            resourceId: report.resourceId,
            editorInstanceId: report.editorInstanceId,
            rendererRevision: report.rendererRevision
          }
        };
      }
    };
    const bridge = createStoryBibleBridge(api);

    await bridge.load("project-01");
    bridge.selectEntry("chr_hero");
    await expect(
      bridge.openWritingEditor({ workspaceId: "project-01", editorInstanceId: "editor-01" })
    ).resolves.toEqual({ status: "connected", rendererRevision: 1 });
    bridge.updateDraft("character", { summary: "Unsaved story bible draft" });
    await expect(
      bridge.reportWritingEditorState({ workspaceId: "project-01", editorInstanceId: "editor-01" })
    ).resolves.toEqual({ status: "connected", rendererRevision: 2 });

    expect(reports).toHaveLength(4);
    expect(reports[0]).toMatchObject({
      resourceKind: "story_bible",
      resourceId: "chr_hero",
      dirty: false,
      rendererRevision: 1,
      acknowledgedRevision: 0
    });
    expect(reports[2]).toMatchObject({
      resourceKind: "story_bible",
      resourceId: "chr_hero",
      dirty: true,
      rendererRevision: 2,
      acknowledgedRevision: 1
    });
    expect(reports.every((report) => /^[a-f0-9]{64}$/u.test(report.bufferChecksum))).toBe(true);
  });

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
    expect(bridge.getEditorProps().filters.status).toBe("available");
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

  test("loads a compatible editing baseline and submits only a strict v1.1 candidate", async () => {
    const baseApi = createApi([]);
    const relation = {
      relationId: `rel_${"1".repeat(32)}`,
      sourceId: "chr_hero",
      targetId: "loc_capital",
      relationType: "legacy.related",
      direction: "directed" as const,
      status: "uncertain" as const,
      validFromChapterId: null,
      validToChapterId: null,
      inversePolicy: "none" as const,
      inverseRelationId: null,
      evidence: [],
      note: "Migrated relation"
    };
    const knowledgeStateId = `knw_${"4".repeat(32)}`;
    const stateHistoryId = `sth_${"5".repeat(32)}`;
    let editable: StoryBibleEditableAsset = {
      asset: {
        schemaVersion: "1.1",
        id: "chr_hero",
        type: "character",
        title: "Hero",
        status: "active",
        summary: "A procedural protagonist with a hidden oath.",
        aliases: ["Oath bearer"],
        relations: [relation],
        relatedEntityIds: ["loc_capital"],
        details: {
          role: "lead",
          appearanceChapterIds: ["ch_01"],
          knowledgeStates: [
            {
              knowledgeStateId,
              entryRevision: 2,
              subject: "The oath",
              state: "known",
              sourceChapterId: "ch_01",
              validFromChapterId: "ch_01",
              validToChapterId: null,
              note: "Learned in the archive"
            }
          ],
          stateHistory: [
            {
              stateHistoryId,
              entryRevision: 3,
              timelineEventId: `evt_${"6".repeat(32)}`,
              chapterId: "ch_01",
              note: "Accepted the oath"
            }
          ]
        },
        extensions: {},
        passthrough: {
          sourceSchemaVersion: "1.0",
          rootFields: { futureRootField: { enabled: true } },
          detailFieldsByPointer: { "/futureDetailField": { value: ["kept"] } }
        },
        revision: 0,
        createdAt: "2026-07-05T00:00:00.000Z",
        updatedAt: "2026-07-05T00:00:00.000Z"
      },
      persistedSchemaVersion: "1.0",
      checksum: "a".repeat(64),
      revision: 0,
      passthroughPresent: true,
      passthroughFieldCount: 2
    };
    let currentSnapshot = snapshot;
    const readAsset = vi.fn<NovelStudioApi["storyBible"]["readAsset"]>(async () => ok(editable));
    const saveAssetCandidate = vi.fn<NovelStudioApi["storyBible"]["saveAssetCandidate"]>(
      async (input) => {
        const saved: StoryBibleAsset = {
          ...input.candidate,
          type: "character",
          details: input.candidate.details,
          relatedEntityIds: input.candidate.relations.map((item) => item.targetId),
          passthrough: editable.asset.passthrough,
          revision: 1,
          updatedAt: "2026-07-31T01:00:00.000Z"
        };
        editable = {
          ...editable,
          asset: saved,
          persistedSchemaVersion: "1.1",
          checksum: "b".repeat(64),
          revision: 1
        };
        currentSnapshot = { ...currentSnapshot, characters: [saved] };
        return ok(saved);
      }
    );
    const entryIdentities = ["9".repeat(32), "a".repeat(32)];
    const bridge = createStoryBibleBridge(
      {
        ...baseApi,
        storyBible: {
          ...baseApi.storyBible,
          load: async () => ok(currentSnapshot),
          readAsset,
          createAsset: async () => {
            throw new Error("not used");
          },
          saveAssetCandidate
        }
      },
      {
        createEntryIdentity: () => {
          const identity = entryIdentities.shift();
          if (identity === undefined) throw new Error("unexpected entry identity request");
          return identity;
        }
      }
    );

    await bridge.load("workspace-01");
    await bridge.selectEntryForEditing("chr_hero");
    bridge.updateDraft("character", {
      title: "Hero Strict",
      details: {
        knowledgeStates: [
          ...((bridge.getEditorProps().draft.details["knowledgeStates"] as JsonObject[]) ?? []),
          {
            entryRevision: 1,
            subject: "The hidden door",
            state: "suspected",
            sourceChapterId: null,
            validFromChapterId: null,
            validToChapterId: null,
            note: ""
          }
        ],
        stateHistory: [
          ...((bridge.getEditorProps().draft.details["stateHistory"] as JsonObject[]) ?? []),
          {
            entryRevision: 1,
            timelineEventId: `evt_${"7".repeat(32)}`,
            chapterId: null,
            note: "Investigates the door"
          }
        ]
      }
    });
    const editor = await bridge.saveDraft();

    expect(readAsset).toHaveBeenCalledWith("chr_hero");
    expect(saveAssetCandidate).toHaveBeenCalledTimes(1);
    const command = saveAssetCandidate.mock.calls[0]?.[0];
    expect(command).toMatchObject({
      baseRevision: 0,
      baseChecksum: "a".repeat(64),
      candidate: {
        schemaVersion: "1.1",
        id: "chr_hero",
        type: "character",
        title: "Hero Strict",
        relations: [relation],
        createdAt: "2026-07-05T00:00:00.000Z"
      }
    });
    expect(command?.candidate).not.toHaveProperty("passthrough");
    expect(command?.candidate).not.toHaveProperty("revision");
    expect(command?.candidate).not.toHaveProperty("updatedAt");
    expect(command?.candidate).not.toHaveProperty("relatedEntityIds");
    expect(command?.candidate.details).not.toHaveProperty("appearanceChapterIds");
    expect(command?.candidate.details["knowledgeStates"]).toMatchObject([
      { knowledgeStateId, entryRevision: 2 },
      { entryRevision: 1 }
    ]);
    expect(command?.candidate.details["knowledgeStates"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ knowledgeStateId: expect.stringMatching(/^knw_[a-f0-9]{32}$/u) })
      ])
    );
    const savedKnowledgeStates = command?.candidate.details["knowledgeStates"] as
      JsonObject[] | undefined;
    expect(savedKnowledgeStates?.[1]?.["knowledgeStateId"]).toBe(`knw_${"9".repeat(32)}`);
    expect(command?.candidate.details["stateHistory"]).toMatchObject([
      { stateHistoryId, entryRevision: 3 },
      { entryRevision: 1 }
    ]);
    expect(command?.candidate.details["stateHistory"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stateHistoryId: expect.stringMatching(/^sth_[a-f0-9]{32}$/u) })
      ])
    );
    const savedStateHistory = command?.candidate.details["stateHistory"] as
      JsonObject[] | undefined;
    expect(savedStateHistory?.[1]?.["stateHistoryId"]).toBe(`sth_${"a".repeat(32)}`);
    expect(editor).toMatchObject({
      dirty: false,
      draft: { id: "chr_hero", title: "Hero Strict" }
    });
  });

  test("uses the server-returned ID when a strict asset is created", async () => {
    const baseApi = createApi([]);
    const serverId = `chr_${"2".repeat(32)}`;
    let currentSnapshot: StoryBibleSnapshot = { ...snapshot, characters: [] };
    let createdEditable: StoryBibleEditableAsset | undefined;
    const createAsset = vi.fn<NovelStudioApi["storyBible"]["createAsset"]>(async (input) => {
      const created: StoryBibleAsset = {
        schemaVersion: "1.1",
        id: serverId,
        type: "character",
        title: input.value.title,
        status: input.value.status ?? "active",
        summary: input.value.summary ?? "",
        aliases: [...(input.value.aliases ?? [])],
        relations: [],
        details: {
          currentState: {
            locationId: null,
            physical: "",
            emotional: "",
            heldItemIds: [],
            asOfChapterId: null,
            asOfEventId: null
          },
          knowledgeStates: [],
          stateHistory: []
        },
        extensions: {},
        createdAt: "2026-07-31T01:00:00.000Z",
        updatedAt: "2026-07-31T01:00:00.000Z",
        revision: 1
      };
      currentSnapshot = { ...currentSnapshot, characters: [created] };
      createdEditable = {
        asset: created,
        persistedSchemaVersion: "1.1",
        checksum: "c".repeat(64),
        revision: 1,
        passthroughPresent: false,
        passthroughFieldCount: 0
      };
      return ok(created);
    });
    const bridge = createStoryBibleBridge(
      {
        ...baseApi,
        storyBible: {
          ...baseApi.storyBible,
          load: async () => ok(currentSnapshot),
          readAsset: async () =>
            createdEditable === undefined
              ? err(createUnifiedError({ code: "NOT_CREATED", message: "not created" }))
              : ok(createdEditable),
          createAsset,
          saveAssetCandidate: async () => {
            throw new Error("not used");
          }
        }
      },
      {
        createAssetIdentity: () => {
          throw new Error("strict creation must not generate an asset ID in the renderer");
        }
      }
    );

    await bridge.load("workspace-01");
    bridge.beginCreate("character");
    bridge.updateDraft("character", { title: "Server-created hero" });
    const editor = await bridge.saveDraft();

    expect(createAsset).toHaveBeenCalledWith({
      type: "character",
      value: {
        title: "Server-created hero",
        status: "active",
        summary: "",
        aliases: [],
        relations: [],
        details: {},
        extensions: {}
      }
    });
    expect(editor).toMatchObject({ dirty: false, draft: { id: serverId } });
  });

  test("deep-merges edited character details without dropping unknown nested fields", async () => {
    const bridge = createStoryBibleBridge(createApi([]));
    await bridge.load("workspace-01");

    bridge.selectEntry("chr_hero");
    bridge.updateDraft("character", {
      details: {
        appearanceChapterIds: ["ch_01"],
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
    expect(bridge.getSnapshot().characters[0]?.details).not.toHaveProperty("appearanceChapterIds");
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
    expect(bridge.getActiveResourceRef()).toEqual({
      kind: "story_bible",
      refId: "story_bible:chr_hero",
      assetId: "chr_hero",
      label: "Hero"
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
    expect(bridge.getActiveResourceRef()).toMatchObject({ label: "Hero" });
    expect(bridge.cancelDraft()).toMatchObject({ viewMode: "list", dirty: false });
    expect(bridge.getActiveResourceRef()).toBeNull();
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

  test("reloads and selects the only Story Bible asset changed by an Agent apply once", async () => {
    const baseApi = createApi([]);
    let currentSnapshot = snapshot;
    const load = vi.fn(async () => ok(currentSnapshot));
    const bridge = createStoryBibleBridge({
      ...baseApi,
      storyBible: { ...baseApi.storyBible, load }
    });
    await bridge.load("workspace-01");
    load.mockClear();
    const createdForeshadow = {
      schemaVersion: "1.0" as const,
      id: "fsh_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      type: "foreshadow" as const,
      title: "Agent planted clue",
      status: "active" as const,
      summary: "A newly tracked clue.",
      details: { trackingStatus: "planned" as const, origin: "ai-confirmed" as const },
      createdAt: "2026-07-31T00:00:00.000Z",
      updatedAt: "2026-07-31T00:00:00.000Z"
    };
    currentSnapshot = {
      ...snapshot,
      foreshadows: [...snapshot.foreshadows, createdForeshadow]
    };
    const change = {
      projectId: "workspace-01",
      reason: "agent-change-set-apply" as const,
      versionGroupId: "vg_apply_01",
      relativePaths: [`foreshadows/${createdForeshadow.id}.json`]
    };

    const editor = await bridge.handleExternalUpdate(change);
    await bridge.handleExternalUpdate(change);

    expect(load).toHaveBeenCalledOnce();
    expect(editor).toMatchObject({
      activeKind: "foreshadow",
      viewMode: "detail",
      dirty: false,
      draft: { id: createdForeshadow.id, title: "Agent planted clue" },
      externalUpdate: { status: "none" }
    });
  });

  test("refreshes safely after an automatic Story Analysis write", async () => {
    const baseApi = createApi([]);
    const originalHero = snapshot.characters[0];
    if (originalHero === undefined) throw new Error("Expected a character fixture.");
    let currentSnapshot: StoryBibleSnapshot = snapshot;
    const load = vi.fn(async () => ok(currentSnapshot));
    const bridge = createStoryBibleBridge({
      ...baseApi,
      storyBible: { ...baseApi.storyBible, load }
    });
    await bridge.load("workspace-01");
    load.mockClear();
    currentSnapshot = {
      ...snapshot,
      characters: [{ ...originalHero, title: "Auto-updated hero" }]
    };

    const editor = await bridge.handleStoryAnalysisExternalUpdate({
      projectId: "workspace-01",
      updateId: "wfrun_story_auto_refresh"
    });

    expect(load).toHaveBeenCalledOnce();
    expect(bridge.getSnapshot().characters[0]).toMatchObject({ title: "Auto-updated hero" });
    expect(editor).toMatchObject({
      activeKind: "character",
      viewMode: "list",
      dirty: false,
      externalUpdate: { status: "none" }
    });

    currentSnapshot = {
      ...snapshot,
      characters: [{ ...originalHero, title: "Second applied group" }]
    };
    await bridge.handleStoryAnalysisExternalUpdate({
      projectId: "workspace-01",
      updateId: "apply_second_group"
    });
    await bridge.handleStoryAnalysisExternalUpdate({
      projectId: "workspace-01",
      updateId: "apply_second_group"
    });

    expect(load).toHaveBeenCalledTimes(2);
    expect(bridge.getSnapshot().characters[0]).toMatchObject({ title: "Second applied group" });
  });

  test("keeps a dirty draft when an automatic Story Analysis write completes", async () => {
    const baseApi = createApi([]);
    const load = vi.fn(async () => ok(snapshot));
    const bridge = createStoryBibleBridge({
      ...baseApi,
      storyBible: { ...baseApi.storyBible, load }
    });
    await bridge.load("workspace-01");
    bridge.selectEntry("chr_hero");
    bridge.updateDraft("character", { title: "Local hero" });
    load.mockClear();

    const editor = await bridge.handleStoryAnalysisExternalUpdate({
      projectId: "workspace-01",
      updateId: "wfrun_story_dirty"
    });

    expect(load).not.toHaveBeenCalled();
    expect(editor).toMatchObject({
      dirty: true,
      draft: { id: "chr_hero", title: "Local hero" },
      externalUpdate: {
        status: "available",
        versionGroupId: "story_analysis_wfrun_story_dirty"
      }
    });
  });

  test("ignores an older external refresh failure after a newer refresh succeeds", async () => {
    const baseApi = createApi([]);
    let rejectOlderRefresh: ((reason?: unknown) => void) | undefined;
    let loadCount = 0;
    const load = vi.fn(() => {
      loadCount += 1;
      if (loadCount === 2) {
        return new Promise<ReturnType<typeof ok<StoryBibleSnapshot>>>((_, reject) => {
          rejectOlderRefresh = reject;
        });
      }
      return Promise.resolve(ok(snapshot));
    });
    const bridge = createStoryBibleBridge({
      ...baseApi,
      storyBible: { ...baseApi.storyBible, load }
    });
    await bridge.load("workspace-01");

    const olderRefresh = bridge.handleExternalUpdate({
      projectId: "workspace-01",
      reason: "agent-change-set-apply",
      versionGroupId: "vg_apply_older",
      relativePaths: ["characters/chr_hero.json"]
    });
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    const latest = await bridge.handleExternalUpdate({
      projectId: "workspace-01",
      reason: "agent-change-set-apply",
      versionGroupId: "vg_apply_latest",
      relativePaths: ["characters/chr_hero.json"]
    });
    rejectOlderRefresh?.(new Error("stale load failed"));
    await olderRefresh;

    expect(latest).toMatchObject({
      status: "idle",
      viewMode: "detail",
      draft: { id: "chr_hero" },
      externalUpdate: { status: "none" }
    });
    expect(bridge.getEditorProps()).toMatchObject({
      status: "idle",
      draft: { id: "chr_hero" },
      externalUpdate: { status: "none" }
    });
  });

  test("returns to the category list when undo removes the open Story Bible asset", async () => {
    const baseApi = createApi([]);
    let currentSnapshot = snapshot;
    const bridge = createStoryBibleBridge({
      ...baseApi,
      storyBible: {
        ...baseApi.storyBible,
        load: async () => ok(currentSnapshot)
      }
    });
    await bridge.load("workspace-01");
    bridge.selectEntry("chr_hero");
    currentSnapshot = { ...snapshot, characters: [] };

    const editor = await bridge.handleExternalUpdate({
      projectId: "workspace-01",
      reason: "agent-run-undo",
      versionGroupId: "vg_undo_01",
      relativePaths: ["characters/chr_hero.json"]
    });

    expect(editor).toMatchObject({
      activeKind: "character",
      viewMode: "list",
      dirty: false,
      externalUpdate: { status: "none" }
    });
    expect(bridge.getActiveResourceRef()).toBeNull();
  });

  test("preserves a dirty draft across Agent updates and rejects a stale continued save", async () => {
    const baseApi = createApi([]);
    let currentSnapshot = snapshot;
    const load = vi.fn(async () => ok(currentSnapshot));
    const saveAsset = vi.fn<NovelStudioApi["storyBible"]["saveAsset"]>(async (asset) => ok(asset));
    const bridge = createStoryBibleBridge({
      ...baseApi,
      storyBible: { ...baseApi.storyBible, load, saveAsset }
    });
    await bridge.load("workspace-01");
    bridge.selectEntry("chr_hero");
    bridge.updateDraft("character", { title: "Local hero" });
    load.mockClear();
    const originalHero = snapshot.characters[0];
    if (originalHero === undefined) throw new Error("Expected a character fixture.");
    currentSnapshot = {
      ...snapshot,
      characters: [
        {
          ...originalHero,
          title: "Agent hero",
          futureRootField: { enabled: false },
          updatedAt: "2026-07-31T00:00:00.000Z"
        }
      ]
    };

    const pending = await bridge.handleExternalUpdate({
      projectId: "workspace-01",
      reason: "agent-change-set-apply",
      versionGroupId: "vg_apply_dirty",
      relativePaths: ["characters/chr_hero.json"]
    });

    expect(load).not.toHaveBeenCalled();
    expect(pending).toMatchObject({
      dirty: true,
      draft: { id: "chr_hero", title: "Local hero" },
      externalUpdate: {
        status: "available",
        affectedEntryIds: ["chr_hero"],
        versionGroupId: "vg_apply_dirty"
      }
    });
    expect(bridge.cancelDraft()).toMatchObject({
      viewMode: "list",
      dirty: false,
      externalUpdate: { status: "available" }
    });
    expect(bridge.selectEntry("chr_hero")).toMatchObject({
      viewMode: "detail",
      dirty: false,
      draft: { title: "Hero" },
      externalUpdate: { status: "available" }
    });
    bridge.updateDraft("character", { title: "Local after discard" });

    const conflicted = await bridge.saveDraft();

    expect(saveAsset).not.toHaveBeenCalled();
    expect(conflicted).toMatchObject({
      status: "error",
      dirty: true,
      draft: { title: "Local after discard" },
      externalUpdate: { status: "available" },
      feedback: {
        kind: "error",
        message: "该资料已由 Agent 更新，当前草稿与最新版本冲突。请重新加载后再编辑。"
      }
    });
    expect(bridge.getSnapshot().characters[0]).toMatchObject({
      title: "Agent hero",
      futureRootField: { enabled: false }
    });
    expect(bridge.continueExternalUpdate()).toMatchObject({
      dirty: true,
      externalUpdate: { status: "none" }
    });
    expect(bridge.updateDraft("character", { summary: "Continue local editing" })).toMatchObject({
      dirty: true,
      externalUpdate: { status: "none" }
    });

    const reloaded = await bridge.reloadExternalUpdate();
    expect(reloaded).toMatchObject({
      viewMode: "detail",
      dirty: false,
      draft: { id: "chr_hero", title: "Agent hero" },
      externalUpdate: { status: "none" }
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
    const saved = await bridge.saveDraft(kind === "outline" ? { chapterIds: [] } : undefined);

    expect(calls).toContain(`storyBible.saveAsset:${expectedId}:Main`);
    expect(saved.draft.id).toBe(expectedId);
  });

  test("blocks outline saves with duplicate or missing chapter references", async () => {
    const calls: string[] = [];
    const bridge = createStoryBibleBridge(
      createApi(calls, {
        ...snapshot,
        outline: {
          schemaVersion: "1.0",
          id: "outline_main",
          type: "outline",
          title: "Main Outline",
          status: "active",
          summary: "The investigation outline.",
          details: {
            volumes: [
              { id: "vol_01", title: "Volume One", chapterIds: ["ch_01"] },
              {
                id: "vol_02",
                title: "Volume Two",
                chapterIds: ["ch_01", "ch_missing"]
              }
            ],
            chapterOutlines: [{ chapterId: "ch_missing", notes: "Keep until reviewed." }]
          },
          createdAt: "2026-07-05T00:00:00.000Z",
          updatedAt: "2026-07-05T00:00:00.000Z"
        }
      })
    );
    await bridge.load("workspace-01");
    bridge.selectEntry("outline_main");
    bridge.updateDraft("outline", { summary: "Changed but not valid yet." });
    bridge.beginSave();

    const saved = await bridge.saveDraft({ chapterIds: ["ch_01"] });

    expect(saved).toMatchObject({ status: "error", dirty: true, viewMode: "detail" });
    expect(saved.feedback?.message).toContain("ch_01");
    expect(saved.feedback?.message).toContain("ch_missing");
    expect(calls.some((call) => call.startsWith("storyBible.saveAsset:"))).toBe(false);
  });

  test("normalizes foreshadow evidence, recomputes its hash, and preserves unknown fields", async () => {
    const rawExcerpt = "  Cafe\u0301\r\n线索  ";
    const baseForeshadow = snapshot.foreshadows[0];
    if (baseForeshadow === undefined) throw new Error("Expected the fixture foreshadow.");
    const api = createApi([], {
      ...snapshot,
      foreshadows: [
        {
          ...baseForeshadow,
          details: {
            trackingStatus: "planted",
            plannedPayoffChapterId: "ch_02",
            sourceRefs: [
              {
                chapterId: "ch_01",
                excerpt: "旧片段",
                excerptHash: "1".repeat(64),
                futureSourceField: { kept: true }
              }
            ],
            futureDetailField: ["kept"]
          }
        }
      ]
    });
    const saveAsset = vi.spyOn(api.storyBible, "saveAsset");
    const bridge = createStoryBibleBridge(api);
    await bridge.load("workspace-01");
    bridge.selectEntry("fsh_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    bridge.updateDraft("foreshadow", {
      details: {
        trackingStatus: "planted",
        plannedPayoffChapterId: "",
        sourceRefs: [
          {
            chapterId: "ch_01",
            excerpt: rawExcerpt,
            excerptHash: "0".repeat(64),
            futureSourceField: { kept: true }
          }
        ]
      }
    });

    const saved = await bridge.saveDraft({ chapterIds: ["ch_01", "ch_02"] });

    expect(saved).toMatchObject({ status: "saved", dirty: false });
    expect(saveAsset).toHaveBeenCalledOnce();
    expect(bridge.getSnapshot().foreshadows[0]?.details).toMatchObject({
      trackingStatus: "planted",
      futureDetailField: ["kept"],
      sourceRefs: [
        {
          chapterId: "ch_01",
          excerpt: "Caf\u00e9\n线索",
          excerptHash: await hashForeshadowEvidence(rawExcerpt),
          futureSourceField: { kept: true }
        }
      ]
    });
    expect(bridge.getSnapshot().foreshadows[0]?.details).not.toHaveProperty(
      "plannedPayoffChapterId"
    );
  });

  test("saves paid-off foreshadows without an actual payoff chapter as a warning-only condition", async () => {
    const calls: string[] = [];
    const bridge = createStoryBibleBridge(createApi(calls));
    await bridge.load("workspace-01");
    bridge.selectEntry("fsh_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    bridge.updateDraft("foreshadow", {
      details: { trackingStatus: "paid-off", actualPayoffChapterId: "" }
    });

    const saved = await bridge.saveDraft({ chapterIds: ["ch_01", "ch_05"] });

    expect(saved).toMatchObject({ status: "saved", dirty: false });
    expect(calls.some((call) => call.startsWith("storyBible.saveAsset:"))).toBe(true);
  });

  test("blocks duplicate foreshadow evidence across non-deleted assets before calling preload", async () => {
    const calls: string[] = [];
    const duplicateExcerpt = "他把钥匙收进袖口。";
    const baseForeshadow = snapshot.foreshadows[0];
    if (baseForeshadow === undefined) throw new Error("Expected the fixture foreshadow.");
    const bridge = createStoryBibleBridge(
      createApi(calls, {
        ...snapshot,
        foreshadows: [
          {
            ...baseForeshadow,
            title: "生锈的钥匙",
            details: {
              trackingStatus: "planted",
              sourceRefs: [
                {
                  chapterId: "ch_01",
                  excerpt: duplicateExcerpt,
                  excerptHash: "1".repeat(64)
                }
              ]
            }
          },
          {
            ...baseForeshadow,
            id: "fsh_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            title: "门后的人",
            details: {
              trackingStatus: "progressing",
              sourceRefs: [
                {
                  chapterId: "ch_01",
                  excerpt: `  ${duplicateExcerpt}  `,
                  excerptHash: "2".repeat(64)
                }
              ]
            }
          }
        ]
      })
    );
    await bridge.load("workspace-01");
    bridge.selectEntry("fsh_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    bridge.updateDraft("foreshadow", { summary: "尝试保存重复来源。" });

    const saved = await bridge.saveDraft({ chapterIds: ["ch_01"] });

    expect(saved).toMatchObject({ status: "error", dirty: true });
    expect(saved.feedback?.message).toContain("已存在于伏笔“生锈的钥匙”");
    expect(calls.some((call) => call.startsWith("storyBible.saveAsset:"))).toBe(false);
  });

  test("does not save a foreshadow after the active workspace changes while evidence is hashed", async () => {
    const calls: string[] = [];
    const bridge = createStoryBibleBridge(createApi(calls));
    await bridge.load("workspace-01");
    bridge.selectEntry("fsh_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    bridge.updateDraft("foreshadow", {
      details: {
        trackingStatus: "planted",
        sourceRefs: [
          {
            chapterId: "ch_01",
            excerpt: "他把钥匙收进袖口。",
            excerptHash: "0".repeat(64)
          }
        ]
      }
    });

    let resolveDigest: ((value: ArrayBuffer) => void) | undefined;
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest").mockImplementation(
      () =>
        new Promise<ArrayBuffer>((resolve) => {
          resolveDigest = resolve;
        })
    );
    try {
      const saving = bridge.saveDraft({ chapterIds: ["ch_01"] });
      await vi.waitFor(() => expect(digest).toHaveBeenCalledOnce());
      bridge.clear();
      resolveDigest?.(new Uint8Array(32).buffer);
      const saved = await saving;

      expect(saved).toBe(bridge.getEditorProps());
      expect(saved).toMatchObject({ viewMode: "list", status: "idle", dirty: false });
      expect(calls.some((call) => call.startsWith("storyBible.saveAsset:"))).toBe(false);
    } finally {
      digest.mockRestore();
    }
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
                timeLabel: "第二日",
                summary: "The council asks for the sealed archive.",
                chapterIds: ["ch_02"],
                characterIds: ["chr_council"],
                locationIds: ["loc_archive"],
                causes: ["evt_arrival"],
                effects: []
              },
              {
                id: "evt_arrival",
                sequence: 10,
                title: "Hero arrives",
                status: "active",
                timeLabel: "第一日",
                summary: "The hero enters the capital.",
                chapterIds: ["ch_01"],
                characterIds: ["chr_hero"],
                locationIds: ["loc_capital"],
                causes: [],
                effects: ["evt_council"]
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
      timeLabel: "第一日",
      chapterIds: ["ch_01"],
      characterIds: ["chr_hero"],
      locationIds: ["loc_capital"],
      causes: [],
      effects: ["evt_council"]
    });

    const selected = bridge.selectEntry("evt_council");
    expect(selected).toMatchObject({
      activeKind: "timeline",
      activeTimelineEventId: "evt_council",
      viewMode: "detail",
      draft: { id: "timeline_main", assetType: "timeline.events" }
    });
  });

  test("saves timeline event fields while preserving unknown root and event data", async () => {
    const timelineSnapshot: StoryBibleSnapshot = {
      ...snapshot,
      timeline: {
        schemaVersion: "1.0",
        id: "timeline_main",
        type: "timeline.events",
        title: "Main Timeline",
        status: "active",
        summary: "Ordered events.",
        details: {
          futureTimelineField: { kept: true },
          events: [
            {
              id: "evt_arrival",
              sequence: 1,
              title: "Hero arrives",
              timeLabel: "First day",
              summary: "The hero enters the capital.",
              chapterIds: ["ch_01"],
              characterIds: ["chr_hero"],
              locationIds: ["loc_capital"],
              causes: [],
              effects: [],
              futureEventField: ["kept"]
            }
          ]
        },
        futureRootField: { kept: true },
        createdAt: "2026-07-05T00:00:00.000Z",
        updatedAt: "2026-07-05T00:00:00.000Z"
      }
    };
    const api = createApi([], timelineSnapshot);
    const saveAsset = vi.spyOn(api.storyBible, "saveAsset");
    const bridge = createStoryBibleBridge(api, {
      now: () => "2026-07-06T00:00:00.000Z"
    });

    await bridge.load("workspace-01");
    bridge.selectEntry("evt_arrival");
    const currentEvents = bridge.getEditorProps().draft.details["events"];
    expect(Array.isArray(currentEvents)).toBe(true);
    bridge.updateDraft("timeline", {
      details: {
        events: [
          {
            ...((currentEvents as Array<Record<string, unknown>>)[0] ?? {}),
            timeLabel: "First night",
            effects: ["evt_council"]
          }
        ]
      }
    });

    const saved = await bridge.saveDraft();

    expect(saved).toMatchObject({
      status: "saved",
      dirty: false,
      activeTimelineEventId: "evt_arrival"
    });
    expect(saveAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "timeline_main",
        type: "timeline.events",
        futureRootField: { kept: true },
        details: {
          futureTimelineField: { kept: true },
          events: [
            expect.objectContaining({
              id: "evt_arrival",
              timeLabel: "First night",
              effects: ["evt_council"],
              futureEventField: ["kept"]
            })
          ]
        }
      })
    );
  });

  test("rejects invalid timeline event sequences and self references before persistence", async () => {
    const calls: string[] = [];
    const bridge = createStoryBibleBridge(
      createApi(calls, {
        ...snapshot,
        timeline: {
          schemaVersion: "1.0",
          id: "timeline_main",
          type: "timeline.events",
          title: "Main Timeline",
          status: "active",
          summary: "",
          details: {
            events: [
              {
                id: "evt_invalid",
                sequence: 0,
                title: "Invalid event",
                causes: ["evt_invalid"]
              }
            ]
          },
          createdAt: "2026-07-05T00:00:00.000Z",
          updatedAt: "2026-07-05T00:00:00.000Z"
        }
      })
    );

    await bridge.load("workspace-01");
    bridge.selectEntry("timeline_main");
    const result = await bridge.saveDraft();

    expect(result).toMatchObject({
      status: "error",
      dirty: true,
      feedback: { kind: "error" }
    });
    expect(result.feedback?.message).toContain("顺序必须是大于 0 的整数");
    expect(result.feedback?.message).toContain("不能把自身设为前因或后果");
    expect(calls.some((call) => call.startsWith("storyBible.saveAsset:"))).toBe(false);
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

  test("opens foreshadow analysis on the current chapter and enforces the five chapter limit", async () => {
    const calls: string[] = [];
    const baseApi = createApi(calls);
    const detectForeshadows = vi.fn(async (input: { readonly chapterIds: readonly string[] }) => {
      calls.push(`storyBible.detectForeshadows:${input.chapterIds.join(",")}`);
      return ok({ ...analysisResult, chapterIds: input.chapterIds });
    });
    const bridge = createStoryBibleBridge({
      ...baseApi,
      storyBible: { ...baseApi.storyBible, detectForeshadows }
    });

    await bridge.load("workspace-01");
    bridge.selectKind("foreshadow");
    bridge.openForeshadowAnalysis("ch_01");
    for (const chapterId of ["ch_02", "ch_03", "ch_04", "ch_05", "ch_06"]) {
      bridge.toggleForeshadowAnalysisChapter(chapterId);
    }

    expect(bridge.getEditorProps().foreshadowAnalysis).toEqual({
      status: "selecting",
      selectedChapterIds: ["ch_01", "ch_02", "ch_03", "ch_04", "ch_05"]
    });
    const preparation = bridge.prepareForeshadowAnalysis();
    expect(preparation.editor.foreshadowAnalysis.status).toBe("preparing");
    expect(preparation.token).toEqual(expect.any(Number));
    if (preparation.token === undefined) throw new Error("Expected an analysis token.");
    expect(bridge.prepareForeshadowAnalysis().token).toBeUndefined();
    expect(bridge.beginForeshadowAnalysis(preparation.token)).toMatchObject({ started: true });

    const reviewed = await bridge.detectForeshadows(preparation.token);

    expect(detectForeshadows).toHaveBeenCalledWith({
      chapterIds: ["ch_01", "ch_02", "ch_03", "ch_04", "ch_05"]
    });
    expect(reviewed.applied).toBe(true);
    expect(reviewed.editor.foreshadowAnalysis).toMatchObject({
      status: "review",
      selectedChapterIds: ["ch_01", "ch_02", "ch_03", "ch_04", "ch_05"],
      result: { analysisId: "analysis-01" }
    });
    expect(calls.some((call) => call.startsWith("storyBible.saveAsset:"))).toBe(false);
  });

  test("keeps a closed foreshadow analysis closed when a scan resolves late", async () => {
    let resolveAnalysis:
      | ((value: Awaited<ReturnType<NovelStudioApi["storyBible"]["detectForeshadows"]>>) => void)
      | undefined;
    const calls: string[] = [];
    const baseApi = createApi(calls);
    const bridge = createStoryBibleBridge({
      ...baseApi,
      storyBible: {
        ...baseApi.storyBible,
        detectForeshadows: () =>
          new Promise((resolve) => {
            resolveAnalysis = resolve;
          })
      }
    });

    await bridge.load("workspace-01");
    bridge.selectKind("foreshadow");
    bridge.openForeshadowAnalysis("ch_01");
    const preparation = bridge.prepareForeshadowAnalysis();
    if (preparation.token === undefined) throw new Error("Expected an analysis token.");
    bridge.beginForeshadowAnalysis(preparation.token);
    const pending = bridge.detectForeshadows(preparation.token);
    await vi.waitFor(() => expect(resolveAnalysis).toBeDefined());

    bridge.closeForeshadowAnalysis();
    resolveAnalysis?.(ok(analysisResult));
    const completion = await pending;

    expect(completion.applied).toBe(false);
    expect(bridge.getEditorProps().foreshadowAnalysis).toEqual({
      status: "closed",
      selectedChapterIds: []
    });
    expect(calls.some((call) => call.startsWith("storyBible.saveAsset:"))).toBe(false);
  });

  test("does not let an old preparation start a reopened foreshadow analysis", async () => {
    const bridge = createStoryBibleBridge(createApi([]));
    await bridge.load("workspace-01");
    bridge.selectKind("foreshadow");
    bridge.openForeshadowAnalysis("ch_01");
    const oldPreparation = bridge.prepareForeshadowAnalysis();
    if (oldPreparation.token === undefined) throw new Error("Expected an analysis token.");

    bridge.closeForeshadowAnalysis();
    bridge.openForeshadowAnalysis("ch_01");
    const staleStart = bridge.beginForeshadowAnalysis(oldPreparation.token);

    expect(staleStart.started).toBe(false);
    expect(staleStart.editor.foreshadowAnalysis).toEqual({
      status: "selecting",
      selectedChapterIds: ["ch_01"]
    });
  });

  test("turns a current preparation save failure into a visible analysis error", async () => {
    const bridge = createStoryBibleBridge(createApi([]));
    await bridge.load("workspace-01");
    bridge.selectKind("foreshadow");
    bridge.openForeshadowAnalysis("ch_01");
    const preparation = bridge.prepareForeshadowAnalysis();
    if (preparation.token === undefined) throw new Error("Expected an analysis token.");

    const failure = bridge.failForeshadowAnalysisPreparation(
      preparation.token,
      "当前章节保存失败，未开始识别。"
    );

    expect(failure.applied).toBe(true);
    expect(failure.editor.foreshadowAnalysis).toEqual({
      status: "error",
      selectedChapterIds: ["ch_01"],
      message: "当前章节保存失败，未开始识别。"
    });
    expect(bridge.failForeshadowAnalysisPreparation(preparation.token, "不应覆盖")).toMatchObject({
      applied: false
    });
  });

  test("previews selected candidates without writing and groups one target update", async () => {
    const calls: string[] = [];
    const baseApi = createApi(calls);
    const result = analysisWithUpdateCandidate();
    const bridge = createStoryBibleBridge(
      {
        ...baseApi,
        storyBible: {
          ...baseApi.storyBible,
          detectForeshadows: async () => ok(result)
        }
      },
      {
        createAssetIdentity: () => "c".repeat(32),
        now: () => "2026-07-30T12:00:00.000Z"
      }
    );
    await enterForeshadowReview(bridge);

    bridge.toggleForeshadowAnalysisCandidate("candidate-new");
    bridge.toggleForeshadowAnalysisCandidate("candidate-progress");
    const previewStart = bridge.beginForeshadowAnalysisPreview();
    expect(previewStart.started).toBe(true);
    if (previewStart.token === undefined) throw new Error("Expected a preview token.");
    const preview = await bridge.prepareForeshadowAnalysisPreview(previewStart.token, [
      "ch_01",
      "ch_02"
    ]);

    expect(preview.applied).toBe(true);
    expect(preview.editor.foreshadowAnalysis).toMatchObject({
      status: "review",
      review: {
        step: "confirmation",
        selectedCandidateIds: ["candidate-new", "candidate-progress"],
        changes: [
          {
            changeId: "new:candidate-new",
            operation: "create",
            status: "pending"
          },
          {
            changeId: "update:fsh_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            operation: "update",
            status: "pending"
          }
        ]
      }
    });
    expect(calls.some((call) => call.startsWith("storyBible.saveAsset:"))).toBe(false);

    bridge.backToForeshadowAnalysisCandidates();
    bridge.closeForeshadowAnalysis();
    expect(calls.some((call) => call.startsWith("storyBible.saveAsset:"))).toBe(false);
  });

  test("applies foreshadow confirmations through strict create and revisioned update APIs", async () => {
    const baseApi = createApi([]);
    const target = snapshot.foreshadows[0];
    if (target === undefined) throw new Error("Expected a foreshadow fixture.");
    const serverCreatedId = `fsh_${"e".repeat(32)}`;
    let currentSnapshot = snapshot;
    const editableTarget: StoryBibleEditableAsset = {
      asset: {
        ...target,
        schemaVersion: "1.1",
        aliases: [],
        relations: [],
        details: { ...target.details, milestones: [] },
        extensions: {},
        passthrough: {
          sourceSchemaVersion: "1.0",
          rootFields: {},
          detailFieldsByPointer: {}
        },
        revision: 0
      },
      persistedSchemaVersion: "1.0",
      checksum: "7".repeat(64),
      revision: 0,
      passthroughPresent: true,
      passthroughFieldCount: 0
    };
    const createAsset = vi.fn<NovelStudioApi["storyBible"]["createAsset"]>(async (input) => {
      const created = {
        schemaVersion: "1.1" as const,
        id: serverCreatedId,
        type: "foreshadow" as const,
        title: input.value.title,
        status: input.value.status ?? "active",
        summary: input.value.summary ?? "",
        aliases: [...(input.value.aliases ?? [])],
        relations: [...(input.value.relations ?? [])].map((relation) => ({
          ...relation,
          sourceId: serverCreatedId
        })),
        details: input.value.details ?? { trackingStatus: "planned", milestones: [] },
        extensions: input.value.extensions ?? {},
        createdAt: "2026-07-30T12:00:00.000Z",
        updatedAt: "2026-07-30T12:00:00.000Z",
        revision: 1
      } as StoryBibleAsset;
      currentSnapshot = {
        ...currentSnapshot,
        foreshadows: [...currentSnapshot.foreshadows, created as never]
      };
      return ok(created);
    });
    const saveAssetCandidate = vi.fn<NovelStudioApi["storyBible"]["saveAssetCandidate"]>(
      async (input) => {
        const saved = {
          ...input.candidate,
          type: "foreshadow" as const,
          updatedAt: "2026-07-30T12:00:00.000Z",
          revision: 1
        } as StoryBibleAsset;
        currentSnapshot = {
          ...currentSnapshot,
          foreshadows: currentSnapshot.foreshadows.map((asset) =>
            asset.id === saved.id ? (saved as never) : asset
          )
        };
        return ok(saved);
      }
    );
    const saveAsset = vi.fn(baseApi.storyBible.saveAsset);
    const bridge = createStoryBibleBridge(
      {
        ...baseApi,
        storyBible: {
          ...baseApi.storyBible,
          load: async () => ok(currentSnapshot),
          readAsset: async () => ok(editableTarget),
          createAsset,
          saveAssetCandidate,
          saveAsset,
          detectForeshadows: async () => ok(analysisWithUpdateCandidate())
        }
      },
      {
        createAssetIdentity: () => "d".repeat(32),
        now: () => "2026-07-30T12:00:00.000Z"
      }
    );
    await enterForeshadowReview(bridge);
    bridge.toggleForeshadowAnalysisCandidate("candidate-new");
    bridge.toggleForeshadowAnalysisCandidate("candidate-progress");
    const previewStart = bridge.beginForeshadowAnalysisPreview();
    if (previewStart.token === undefined) throw new Error("Expected a preview token.");
    await bridge.prepareForeshadowAnalysisPreview(previewStart.token, ["ch_01", "ch_02"]);
    const saveStart = bridge.beginForeshadowAnalysisSave(false);
    if (saveStart.token === undefined) throw new Error("Expected a save token.");

    const result = await bridge.saveForeshadowAnalysisChanges(saveStart.token);

    expect(result.editor.foreshadowAnalysis).toMatchObject({
      status: "review",
      review: {
        outcome: "completed",
        changes: [
          { changeId: "new:candidate-new", assetId: serverCreatedId, status: "succeeded" },
          {
            changeId: "update:fsh_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            status: "succeeded"
          }
        ]
      }
    });
    expect(saveAsset).not.toHaveBeenCalled();
    expect(createAsset).toHaveBeenCalledTimes(1);
    const createCommand = createAsset.mock.calls[0]?.[0];
    expect(createCommand).toMatchObject({
      type: "foreshadow",
      value: {
        title: "Old key",
        details: {
          trackingStatus: "planted",
          milestones: [{ entryRevision: 1, kind: "plant", chapterId: "ch_01" }]
        }
      }
    });
    expect(createCommand?.value).not.toHaveProperty("id");
    expect(createCommand?.value).not.toHaveProperty("revision");
    expect(saveAssetCandidate).toHaveBeenCalledTimes(1);
    const updateCommand = saveAssetCandidate.mock.calls[0]?.[0];
    expect(updateCommand).toMatchObject({
      baseRevision: 0,
      baseChecksum: "7".repeat(64),
      candidate: {
        schemaVersion: "1.1",
        id: target.id,
        details: {
          trackingStatus: "ready-to-payoff",
          milestones: [{ entryRevision: 1, kind: "progress", chapterId: "ch_02" }]
        }
      }
    });
    expect(updateCommand?.candidate).not.toHaveProperty("passthrough");
    expect(updateCommand?.candidate).not.toHaveProperty("revision");
    expect(updateCommand?.candidate).not.toHaveProperty("updatedAt");
  });

  test("keeps successful confirmation changes out of failed-only retry", async () => {
    const calls: string[] = [];
    const baseApi = createApi(calls);
    const originalSaveAsset = baseApi.storyBible.saveAsset;
    const saveAttempts = new Map<string, number>();
    const saveAsset = vi.fn<NovelStudioApi["storyBible"]["saveAsset"]>(async (asset) => {
      const attempt = (saveAttempts.get(asset.id) ?? 0) + 1;
      saveAttempts.set(asset.id, attempt);
      if (asset.id === "fsh_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" && attempt === 1) {
        return err(
          createUnifiedError({
            code: "STORY_BIBLE_WRITE_FAILED",
            message: "Target update failed.",
            recoverability: "retryable",
            suggestedAction: "Retry the failed change."
          })
        );
      }
      return originalSaveAsset(asset);
    });
    const bridge = createStoryBibleBridge(
      {
        ...baseApi,
        storyBible: {
          ...baseApi.storyBible,
          detectForeshadows: async () => ok(analysisWithUpdateCandidate()),
          saveAsset
        }
      },
      {
        createAssetIdentity: () => "d".repeat(32),
        now: () => "2026-07-30T12:00:00.000Z"
      }
    );
    await enterForeshadowReview(bridge);
    bridge.toggleForeshadowAnalysisCandidate("candidate-new");
    bridge.toggleForeshadowAnalysisCandidate("candidate-progress");
    const previewStart = bridge.beginForeshadowAnalysisPreview();
    if (previewStart.token === undefined) throw new Error("Expected a preview token.");
    await bridge.prepareForeshadowAnalysisPreview(previewStart.token, ["ch_01", "ch_02"]);

    const saveStart = bridge.beginForeshadowAnalysisSave(false);
    expect(saveStart.started).toBe(true);
    if (saveStart.token === undefined) throw new Error("Expected a save token.");
    expect(bridge.selectKind("character").activeKind).toBe("foreshadow");
    const partial = await bridge.saveForeshadowAnalysisChanges(saveStart.token);

    expect(partial.applied).toBe(true);
    expect(partial.editor.foreshadowAnalysis).toMatchObject({
      status: "review",
      review: {
        step: "results",
        outcome: "partial_failure",
        changes: [
          { changeId: "new:candidate-new", status: "succeeded" },
          {
            changeId: "update:fsh_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            status: "failed",
            errorMessage: "Target update failed."
          }
        ]
      }
    });
    expect(saveAsset.mock.calls.map(([asset]) => asset.id)).toEqual([
      `fsh_${"d".repeat(32)}`,
      "fsh_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    ]);

    const retryStart = bridge.beginForeshadowAnalysisSave(true);
    expect(retryStart.started).toBe(true);
    if (retryStart.token === undefined) throw new Error("Expected a retry token.");
    const completed = await bridge.saveForeshadowAnalysisChanges(retryStart.token);

    expect(completed.editor.foreshadowAnalysis).toMatchObject({
      status: "review",
      review: {
        step: "results",
        outcome: "completed",
        changes: [
          { changeId: "new:candidate-new", status: "succeeded" },
          {
            changeId: "update:fsh_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            status: "succeeded"
          }
        ]
      }
    });
    expect(saveAsset.mock.calls.map(([asset]) => asset.id)).toEqual([
      `fsh_${"d".repeat(32)}`,
      "fsh_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "fsh_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    ]);
    expect(bridge.getEditorProps().entries).toContainEqual(
      expect.objectContaining({ id: `fsh_${"d".repeat(32)}`, title: "Old key" })
    );
  });

  test("plans updates from the latest snapshot and preserves external fields", async () => {
    const calls: string[] = [];
    const baseApi = createApi(calls);
    const originalTarget = snapshot.foreshadows[0];
    if (originalTarget === undefined) throw new Error("Expected a foreshadow fixture.");
    const latestTarget = {
      ...originalTarget,
      externalRootField: { revision: 2 },
      details: {
        ...originalTarget.details,
        externalDetailField: "keep-latest"
      }
    };
    const latestSnapshot: StoryBibleSnapshot = {
      ...snapshot,
      foreshadows: [latestTarget]
    };
    let loadCount = 0;
    const savedAssets: Array<StoryBibleSnapshot["foreshadows"][number]> = [];
    const bridge = createStoryBibleBridge(
      {
        ...baseApi,
        storyBible: {
          ...baseApi.storyBible,
          load: async () => ok(++loadCount === 1 ? snapshot : latestSnapshot),
          detectForeshadows: async () => ok(analysisWithUpdateCandidate()),
          saveAsset: async (asset) => {
            if (asset.type === "foreshadow") savedAssets.push(asset);
            return ok(asset);
          }
        }
      },
      { now: () => "2026-07-30T12:00:00.000Z" }
    );
    await enterForeshadowReview(bridge);
    bridge.toggleForeshadowAnalysisCandidate("candidate-progress");
    const previewStart = bridge.beginForeshadowAnalysisPreview();
    if (previewStart.token === undefined) throw new Error("Expected a preview token.");
    await bridge.prepareForeshadowAnalysisPreview(previewStart.token, ["ch_01", "ch_02"]);
    const saveStart = bridge.beginForeshadowAnalysisSave(false);
    if (saveStart.token === undefined) throw new Error("Expected a save token.");

    await bridge.saveForeshadowAnalysisChanges(saveStart.token);

    expect(savedAssets).toHaveLength(1);
    expect(savedAssets[0]).toMatchObject({
      id: latestTarget.id,
      externalRootField: { revision: 2 },
      details: {
        externalDetailField: "keep-latest",
        trackingStatus: "ready-to-payoff"
      }
    });
  });

  test("returns to candidate review when a target changes after preview", async () => {
    const calls: string[] = [];
    const baseApi = createApi(calls);
    const originalTarget = snapshot.foreshadows[0];
    if (originalTarget === undefined) throw new Error("Expected a foreshadow fixture.");
    let currentSnapshot = snapshot;
    const saveAsset = vi.fn<NovelStudioApi["storyBible"]["saveAsset"]>(async (asset) => ok(asset));
    const bridge = createStoryBibleBridge({
      ...baseApi,
      storyBible: {
        ...baseApi.storyBible,
        load: async () => ok(currentSnapshot),
        detectForeshadows: async () => ok(analysisWithUpdateCandidate()),
        saveAsset
      }
    });
    await enterForeshadowReview(bridge);
    bridge.toggleForeshadowAnalysisCandidate("candidate-progress");
    const previewStart = bridge.beginForeshadowAnalysisPreview();
    if (previewStart.token === undefined) throw new Error("Expected a preview token.");
    await bridge.prepareForeshadowAnalysisPreview(previewStart.token, ["ch_01", "ch_02"]);
    currentSnapshot = {
      ...snapshot,
      foreshadows: [
        {
          ...originalTarget,
          summary: "Agent changed this after preview.",
          updatedAt: "2026-07-30T12:05:00.000Z"
        }
      ]
    };
    const saveStart = bridge.beginForeshadowAnalysisSave(false);
    if (saveStart.token === undefined) throw new Error("Expected a save token.");

    const completion = await bridge.saveForeshadowAnalysisChanges(saveStart.token);

    expect(completion.applied).toBe(true);
    expect(completion.editor.foreshadowAnalysis).toMatchObject({
      status: "review",
      review: {
        step: "candidates",
        selectedCandidateIds: ["candidate-progress"],
        message: "故事资料已在预览后发生变化，请重新预览并确认。"
      }
    });
    expect(saveAsset).not.toHaveBeenCalled();
  });

  test("does not save when a referenced chapter disappears after preview", async () => {
    const calls: string[] = [];
    const baseApi = createApi(calls);
    const saveAsset = vi.fn<NovelStudioApi["storyBible"]["saveAsset"]>(async (asset) => ok(asset));
    const bridge = createStoryBibleBridge({
      ...baseApi,
      project: {
        ...baseApi.project,
        listChapters: async () =>
          ok([
            {
              id: "ch_01",
              title: "Chapter 1",
              order: 1,
              status: "draft",
              updatedAt: "2026-07-30T00:00:00.000Z"
            }
          ])
      },
      storyBible: {
        ...baseApi.storyBible,
        detectForeshadows: async () => ok(analysisWithUpdateCandidate()),
        saveAsset
      }
    });
    await enterForeshadowReview(bridge);
    bridge.toggleForeshadowAnalysisCandidate("candidate-progress");
    const previewStart = bridge.beginForeshadowAnalysisPreview();
    if (previewStart.token === undefined) throw new Error("Expected a preview token.");
    await bridge.prepareForeshadowAnalysisPreview(previewStart.token, ["ch_01", "ch_02"]);
    const saveStart = bridge.beginForeshadowAnalysisSave(false);
    if (saveStart.token === undefined) throw new Error("Expected a save token.");

    const completion = await bridge.saveForeshadowAnalysisChanges(saveStart.token);

    expect(completion.editor.foreshadowAnalysis).toMatchObject({
      status: "review",
      review: {
        step: "candidates",
        message: "候选引用的章节已发生变化，请重新识别后再保存。"
      }
    });
    expect(saveAsset).not.toHaveBeenCalled();
  });

  test("keeps saved results visible when post-save refresh APIs reject", async () => {
    for (const rejectedApi of ["load", "consistency"] as const) {
      const calls: string[] = [];
      const baseApi = createApi(calls);
      const originalLoad = baseApi.storyBible.load;
      const originalConsistency = baseApi.storyBible.buildConsistencyReport;
      let loadCount = 0;
      let consistencyCount = 0;
      const bridge = createStoryBibleBridge(
        {
          ...baseApi,
          storyBible: {
            ...baseApi.storyBible,
            load: async () => {
              loadCount += 1;
              if (rejectedApi === "load" && loadCount === 4) {
                throw new Error("refresh load rejected");
              }
              return originalLoad();
            },
            buildConsistencyReport: async () => {
              consistencyCount += 1;
              if (rejectedApi === "consistency" && consistencyCount === 2) {
                throw new Error("refresh consistency rejected");
              }
              return originalConsistency();
            },
            detectForeshadows: async () => ok(analysisResult)
          }
        },
        {
          createAssetIdentity: () => (rejectedApi === "load" ? "e" : "f").repeat(32),
          now: () => "2026-07-30T12:00:00.000Z"
        }
      );
      await enterForeshadowReview(bridge);
      bridge.toggleForeshadowAnalysisCandidate("candidate-new");
      const previewStart = bridge.beginForeshadowAnalysisPreview();
      if (previewStart.token === undefined) throw new Error("Expected a preview token.");
      await bridge.prepareForeshadowAnalysisPreview(previewStart.token, ["ch_01", "ch_02"]);
      const saveStart = bridge.beginForeshadowAnalysisSave(false);
      if (saveStart.token === undefined) throw new Error("Expected a save token.");

      const completion = await bridge.saveForeshadowAnalysisChanges(saveStart.token);

      expect(completion.applied).toBe(true);
      expect(completion.editor.foreshadowAnalysis).toMatchObject({
        status: "review",
        review: {
          step: "results",
          outcome: "completed",
          changes: [{ changeId: "new:candidate-new", status: "succeeded" }],
          message:
            rejectedApi === "load"
              ? "变更已保存，但故事资料刷新失败；重新打开项目后可查看。"
              : "变更已保存，但一致性检查刷新失败。"
        }
      });
    }
  });

  test("rechecks incoming references before preparing a soft-delete save", async () => {
    const calls: string[] = [];
    const statusApi = createStatusTransitionApi(createApi(calls), snapshot);
    const impact = referenceImpact();
    const getReferences = vi.fn(async () => ok(impact));
    const bridge = createStoryBibleBridge({
      ...statusApi.api,
      storyBible: { ...statusApi.api.storyBible, getReferences }
    });
    await bridge.load("workspace-01");
    await bridge.selectEntryForEditing("chr_hero");

    const pending = bridge.requestStatusAction("move-to-deleted");
    expect(bridge.getEditorProps().statusAction).toMatchObject({
      status: "loading",
      action: "move-to-deleted",
      assetId: "chr_hero"
    });
    const preview = await pending;
    expect(preview.statusAction).toMatchObject({
      status: "confirmation",
      affectedReferenceCount: 1,
      affectedAssetIds: ["fsh_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]
    });

    const prepared = await bridge.confirmStatusAction();

    expect(getReferences).toHaveBeenCalledTimes(2);
    expect(prepared).toMatchObject({
      readyToSave: true,
      editor: { dirty: true, draft: { id: "chr_hero", status: "deleted" } }
    });
    bridge.beginSave();
    const saved = await bridge.saveDraft({ chapterIds: ["ch_01", "ch_05"] });
    expect(saved).toMatchObject({
      status: "saved",
      dirty: false,
      draft: { id: "chr_hero", status: "deleted" },
      statusAction: { status: "idle" }
    });
    expect(statusApi.saveStatusTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "move-to-deleted",
        expectedDeletionImpactChecksum: impact.deletionImpactChecksum,
        candidate: expect.objectContaining({ id: "chr_hero", status: "deleted" })
      })
    );
  });

  test("fails closed when soft-delete reference impact changes after preview", async () => {
    const baseApi = createApi([]);
    const getReferences = vi
      .fn<NonNullable<NovelStudioApi["storyBible"]["getReferences"]>>()
      .mockResolvedValueOnce(ok(referenceImpact()))
      .mockResolvedValueOnce(
        ok({
          ...referenceImpact(),
          deletionImpactChecksum: "e".repeat(64),
          deletionImpact: {
            affectedReferenceCount: 0,
            affectedAssetIds: [],
            cascades: false
          },
          incoming: []
        })
      );
    const bridge = createStoryBibleBridge({
      ...baseApi,
      storyBible: { ...baseApi.storyBible, getReferences }
    });
    await bridge.load("workspace-01");
    bridge.selectEntry("chr_hero");
    await bridge.requestStatusAction("move-to-deleted");

    const prepared = await bridge.confirmStatusAction();

    expect(prepared.readyToSave).toBe(false);
    expect(prepared.editor).toMatchObject({
      dirty: false,
      draft: { status: "active" },
      statusAction: {
        status: "error",
        message: "入向引用影响已变化，请重新检查后再确认。"
      }
    });
  });

  test("clears stale status proof and restores the baseline after a transition save fails", async () => {
    const statusApi = createStatusTransitionApi(createApi([]), snapshot);
    const saveStatusTransition = vi.fn<
      NonNullable<NovelStudioApi["storyBible"]["saveStatusTransition"]>
    >(async () =>
      err(
        createUnifiedError({
          code: "STORY_BIBLE_DELETION_IMPACT_CHANGED",
          category: "ValidationError",
          message: "References changed.",
          recoverability: "user-action",
          suggestedAction: "Review references again.",
          traceId: "story-bible-bridge-status-test"
        })
      )
    );
    const bridge = createStoryBibleBridge({
      ...statusApi.api,
      storyBible: {
        ...statusApi.api.storyBible,
        getReferences: async () => ok(referenceImpact()),
        saveStatusTransition
      }
    });
    await bridge.load("workspace-01");
    await bridge.selectEntryForEditing("chr_hero");
    await bridge.requestStatusAction("move-to-deleted");
    await bridge.confirmStatusAction();
    bridge.beginSave();

    const failed = await bridge.saveDraft();

    expect(failed).toMatchObject({
      status: "error",
      dirty: false,
      draft: { id: "chr_hero", status: "active" },
      feedback: { kind: "error", message: "References changed." }
    });
    expect(saveStatusTransition).toHaveBeenCalledTimes(1);
  });

  test("restores the status recorded before deletion instead of assuming active", async () => {
    const hero = snapshot.characters[0];
    if (hero === undefined) throw new Error("Expected a character fixture.");
    const deletedSnapshot: StoryBibleSnapshot = {
      ...snapshot,
      characters: [{ ...hero, status: "deleted" }]
    };
    const baseApi = createApi([], deletedSnapshot);
    const resolveRestoreStatus = vi.fn(async () => ok("draft" as const));
    const bridge = createStoryBibleBridge({
      ...baseApi,
      storyBible: { ...baseApi.storyBible, resolveRestoreStatus }
    });
    await bridge.load("workspace-01");
    bridge.selectEntry("chr_hero");

    const preview = await bridge.requestStatusAction("restore");
    expect(preview.statusAction).toMatchObject({ status: "confirmation", action: "restore" });
    const prepared = await bridge.confirmStatusAction();

    expect(resolveRestoreStatus).toHaveBeenCalledWith("chr_hero");
    expect(prepared).toMatchObject({
      readyToSave: true,
      editor: { dirty: true, draft: { status: "draft" }, statusAction: { status: "idle" } }
    });
  });

  test("previews explicit inverse endpoints, cancels with zero writes, then applies atomically", async () => {
    const relationId = `rel_${"1".repeat(32)}`;
    const inverseRelationId = `rel_${"2".repeat(32)}`;
    const source = strictCharacterAsset("chr_source", "Source", []);
    const target = strictCharacterAsset("chr_target", "Target", []);
    let currentSnapshot: StoryBibleSnapshot = {
      characters: [source, target],
      worldAssets: [],
      foreshadows: [],
      memories: []
    };
    let sourceEditable = strictEditable(source, "a".repeat(64), 1);
    const targetEditable = strictEditable(target, "b".repeat(64), 1);
    const baseApi = createApi([], currentSnapshot);
    const saveAssetCandidate = vi.fn<NovelStudioApi["storyBible"]["saveAssetCandidate"]>(async () =>
      ok(source)
    );
    const prepareExplicitInverseChange = vi.fn<
      NonNullable<NovelStudioApi["storyBible"]["prepareExplicitInverseChange"]>
    >(async () => {
      const prepared = explicitInversePreview("chr_source", "chr_target");
      return ok({
        ...prepared,
        changeSet: {
          ...prepared.changeSet,
          files: prepared.changeSet.files.filter((file) => file.assetId === "chr_target")
        }
      });
    });
    const applyExplicitInverseChange = vi.fn<
      NonNullable<NovelStudioApi["storyBible"]["applyExplicitInverseChange"]>
    >(async (input) => {
      const sourceRelation = {
        relationId,
        sourceId: "chr_source",
        targetId: "chr_target",
        relationType: "character.relationship",
        direction: "directed" as const,
        status: "active" as const,
        validFromChapterId: null,
        validToChapterId: null,
        inversePolicy: "explicit" as const,
        inverseRelationId,
        evidence: [],
        note: ""
      };
      const savedSource = { ...source, relations: [sourceRelation], revision: 2 };
      const savedTarget = {
        ...target,
        relations: [
          {
            ...sourceRelation,
            relationId: inverseRelationId,
            sourceId: "chr_target",
            targetId: "chr_source",
            inverseRelationId: relationId
          }
        ],
        revision: 2
      };
      currentSnapshot = { ...currentSnapshot, characters: [savedSource, savedTarget] };
      sourceEditable = strictEditable(savedSource, "c".repeat(64), 2);
      return ok({
        schemaVersion: "1.0",
        previewId: input.previewId,
        applied: true,
        batch: {
          schemaVersion: "1.0",
          applyBatchId: "apply_1",
          changeSetId: "change_set_1",
          selectionChecksum: "d".repeat(64),
          groups: [{ consistencyGroupId: "group_1", status: "applied" }]
        }
      });
    });
    const cancelExplicitInverseChange = vi
      .fn<NonNullable<NovelStudioApi["storyBible"]["cancelExplicitInverseChange"]>>()
      .mockResolvedValueOnce(
        err(
          createUnifiedError({
            code: "STORY_BIBLE_EXPLICIT_INVERSE_CANCEL_FAILED",
            category: "ValidationError",
            message: "Cancel failed.",
            recoverability: "user-action",
            suggestedAction: "Retry cancellation.",
            traceId: "story-bible-bridge-explicit-inverse-test"
          })
        )
      )
      .mockImplementation(async (input) =>
        ok({
          schemaVersion: "1.0",
          previewId: input.previewId,
          canceled: true
        })
      );
    const bridge = createStoryBibleBridge({
      ...baseApi,
      storyBible: {
        ...baseApi.storyBible,
        load: async () => ok(currentSnapshot),
        readAsset: async (assetId) =>
          ok(assetId === "chr_source" ? sourceEditable : targetEditable),
        createAsset: async () => {
          throw new Error("not used");
        },
        saveAssetCandidate,
        prepareExplicitInverseChange,
        applyExplicitInverseChange,
        cancelExplicitInverseChange
      }
    });
    await bridge.load("workspace-01");
    await bridge.selectEntryForEditing("chr_source");
    bridge.updateDraft("character", {
      relations: [
        {
          relationId,
          sourceId: "chr_source",
          targetId: "chr_target",
          relationType: "character.relationship",
          direction: "directed",
          status: "active",
          validFromChapterId: null,
          validToChapterId: null,
          inversePolicy: "explicit",
          inverseRelationId: null,
          evidence: [],
          note: ""
        }
      ]
    });

    const preview = await bridge.saveDraft();
    expect(preview.explicitInversePreview).toMatchObject({
      status: "confirmation",
      files: [
        { assetId: "chr_source", side: "source" },
        { assetId: "chr_target", side: "inverse" }
      ]
    });
    expect(saveAssetCandidate).not.toHaveBeenCalled();
    expect(applyExplicitInverseChange).not.toHaveBeenCalled();

    const failedCancellation = await bridge.cancelExplicitInversePreview();
    expect(failedCancellation).toMatchObject({
      dirty: true,
      explicitInversePreview: { status: "confirmation", previewId: "preview_explicit_1" },
      feedback: { kind: "error", message: "Cancel failed." }
    });

    const cancelled = await bridge.cancelExplicitInversePreview();
    expect(cancelled.dirty).toBe(true);
    expect(cancelled.explicitInversePreview).toBeUndefined();
    expect(cancelExplicitInverseChange).toHaveBeenCalledTimes(2);
    expect(cancelExplicitInverseChange).toHaveBeenLastCalledWith({
      previewId: "preview_explicit_1",
      revision: 2,
      checksum: "e".repeat(64)
    });
    expect(applyExplicitInverseChange).not.toHaveBeenCalled();
    await bridge.saveDraft();
    const saved = await bridge.saveDraft();

    expect(prepareExplicitInverseChange).toHaveBeenCalledTimes(2);
    expect(applyExplicitInverseChange).toHaveBeenCalledWith({
      previewId: "preview_explicit_1",
      revision: 2,
      checksum: "e".repeat(64)
    });
    expect(saveAssetCandidate).not.toHaveBeenCalled();
    expect(saved).toMatchObject({
      status: "saved",
      dirty: false,
      draft: { id: "chr_source" }
    });
    expect(saved.explicitInversePreview).toBeUndefined();
    expect(bridge.getSnapshot().characters).toHaveLength(2);
  });

  test("blocks opening a relation target while the current draft is dirty", async () => {
    const source = strictCharacterAsset("chr_source", "Source", []);
    const target = strictCharacterAsset("chr_target", "Target", []);
    const currentSnapshot: StoryBibleSnapshot = {
      characters: [source, target],
      worldAssets: [],
      foreshadows: [],
      memories: []
    };
    const baseApi = createApi([], currentSnapshot);
    const bridge = createStoryBibleBridge({
      ...baseApi,
      storyBible: {
        ...baseApi.storyBible,
        load: async () => ok(currentSnapshot),
        readAsset: async (assetId) =>
          ok(strictEditable(assetId === "chr_source" ? source : target, "a".repeat(64), 1))
      }
    });
    await bridge.load("workspace-01");
    await bridge.selectEntryForEditing("chr_source");
    bridge.updateDraft("character", { title: "Unsaved source" });

    const blocked = bridge.selectEntry("chr_target");
    expect(blocked).toMatchObject({
      dirty: true,
      draft: { id: "chr_source", title: "Unsaved source" },
      feedback: { kind: "error" }
    });

    bridge.cancelDraft();
    const opened = bridge.selectEntry("chr_target");
    expect(opened).toMatchObject({ dirty: false, draft: { id: "chr_target", title: "Target" } });
  });
});

function strictCharacterAsset(id: string, title: string, relations: JsonObject[]): StoryBibleAsset {
  return {
    schemaVersion: "1.1",
    id,
    type: "character",
    title,
    status: "active",
    summary: `${title} summary`,
    aliases: [],
    relations,
    details: {},
    extensions: {},
    revision: 1,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-31T00:00:00.000Z"
  };
}

function strictEditable(
  asset: StoryBibleAsset,
  checksum: string,
  revision: number
): StoryBibleEditableAsset {
  return {
    asset,
    persistedSchemaVersion: "1.1",
    checksum,
    revision,
    passthroughPresent: false,
    passthroughFieldCount: 0
  };
}

function explicitInversePreview(
  sourceAssetId: string,
  targetAssetId: string
): StoryBibleExplicitInversePreview {
  return {
    schemaVersion: "1.0",
    previewId: "preview_explicit_1",
    expiresAt: "2026-08-01T00:10:00.000Z",
    sourceAssetId,
    affectedAssetIds: [sourceAssetId, targetAssetId],
    changeSet: {
      schemaVersion: "1.1",
      changeSetId: "change_set_1",
      revision: 2,
      runId: "run_1",
      projectId: "project_1",
      checkpointId: "checkpoint_1",
      contextSnapshotId: "context_1",
      status: "awaiting_approval",
      checksum: "e".repeat(64),
      approvalToken: "",
      files: [sourceAssetId, targetAssetId].map((assetId) => ({
        relativePath: `story/characters/${assetId}.json`,
        assetType: "text" as const,
        assetId,
        baseChecksum: "a".repeat(64),
        candidateChecksum: "b".repeat(64),
        baseContent: "{}\n",
        candidateContent: "{}\n",
        hunks: [],
        validation: { status: "valid" as const, checks: [] },
        selected: true,
        consistencyGroupId: "group_1"
      })),
      createdAt: "2026-08-01T00:00:00.000Z"
    }
  };
}

function referenceImpact(): StoryBibleReferenceImpact {
  return {
    assetId: "chr_hero",
    deletionImpactChecksum: "d".repeat(64),
    incoming: [
      {
        sourceAssetId: "fsh_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        sourceType: "foreshadow",
        sourceTitle: "Old key",
        sourceStatus: "active",
        sourceRevision: 2,
        targetAssetId: "chr_hero",
        targetType: "character",
        targetTitle: "Hero",
        targetStatus: "active",
        targetReferenceType: "character",
        expectedTargetTypes: ["character"],
        integrity: "valid",
        warnings: [],
        kind: "detail",
        path: "/details/relatedCharacterIds/0"
      }
    ],
    outgoing: [],
    canSetDeleted: true,
    deletionImpact: {
      affectedReferenceCount: 1,
      affectedAssetIds: ["fsh_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
      cascades: false
    }
  };
}

function createStatusTransitionApi(baseApi: NovelStudioApi, initialSnapshot: StoryBibleSnapshot) {
  const source = initialSnapshot.characters[0];
  if (source === undefined) throw new Error("Expected a character fixture.");
  let currentSnapshot = initialSnapshot;
  let editable: StoryBibleEditableAsset = {
    asset: {
      ...source,
      schemaVersion: "1.1",
      aliases: [...(source.aliases ?? [])],
      relations: [],
      extensions: {},
      revision: 0,
      passthrough: {
        sourceSchemaVersion: "1.0",
        rootFields: {},
        detailFieldsByPointer: {}
      }
    },
    persistedSchemaVersion: "1.0",
    checksum: "a".repeat(64),
    revision: 0,
    passthroughPresent: true,
    passthroughFieldCount: 0
  };
  const saveStatusTransition = vi.fn<
    NonNullable<NovelStudioApi["storyBible"]["saveStatusTransition"]>
  >(async (input) => {
    const saved: StoryBibleAsset = {
      ...input.candidate,
      type: "character",
      updatedAt: "2026-07-31T02:00:00.000Z",
      revision: editable.revision + 1
    };
    editable = {
      ...editable,
      asset: saved,
      persistedSchemaVersion: "1.1",
      checksum: "b".repeat(64),
      revision: editable.revision + 1
    };
    currentSnapshot = { ...currentSnapshot, characters: [saved] };
    return ok(saved);
  });
  return {
    saveStatusTransition,
    api: {
      ...baseApi,
      storyBible: {
        ...baseApi.storyBible,
        load: async () => ok(currentSnapshot),
        readAsset: async () => ok(editable),
        createAsset: async () => {
          throw new Error("not used");
        },
        saveAssetCandidate: async () => {
          throw new Error("generic candidate save must not handle deleted transitions");
        },
        saveStatusTransition
      }
    }
  } satisfies { readonly api: NovelStudioApi; readonly saveStatusTransition: unknown };
}

async function enterForeshadowReview(bridge: StoryBibleBridge): Promise<void> {
  await bridge.load("workspace-01");
  bridge.selectKind("foreshadow");
  bridge.openForeshadowAnalysis("ch_01");
  const preparation = bridge.prepareForeshadowAnalysis();
  if (preparation.token === undefined) throw new Error("Expected an analysis token.");
  bridge.beginForeshadowAnalysis(preparation.token);
  const completion = await bridge.detectForeshadows(preparation.token);
  if (!completion.applied) throw new Error("Expected analysis results.");
}

function analysisWithUpdateCandidate(): ForeshadowAnalysisResultDto {
  return {
    ...analysisResult,
    candidates: [
      ...analysisResult.candidates,
      {
        candidateId: "candidate-progress",
        kind: "progress",
        targetForeshadowId: "fsh_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        evidence: {
          chapterId: "ch_02",
          excerpt: "The archive lock matches the old key.",
          excerptHash: "2".repeat(64)
        },
        reason: "The key now points to a specific locked archive.",
        duplicateForeshadowIds: [],
        suggested: {
          trackingStatus: "ready-to-payoff",
          summary: "The key is ready to open the archive."
        }
      }
    ]
  };
}

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
        return ok(
          ["ch_01", "ch_02", "ch_03", "ch_05"].map((id, index) => ({
            id,
            title: `Chapter ${index + 1}`,
            order: index + 1,
            status: "draft" as const,
            updatedAt: "2026-07-30T00:00:00.000Z"
          }))
        );
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
      },
      detectForeshadows: async () => {
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
