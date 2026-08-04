import { describe, expect, test } from "vitest";

import {
  err,
  ok,
  type ChapterCatalogRepositoryPort,
  type ChapterSummary,
  createUnifiedError,
  type ForeshadowDetails,
  type UnifiedError
} from "@novel-studio/shared";

import {
  createStoryBibleSession,
  findStoryBibleMentionSuggestions,
  type ForeshadowAsset,
  type MemoryRecord,
  type StoryBibleAsset,
  type StoryBibleRegularAsset,
  type StoryBibleRepositoryPort,
  type StoryBibleSnapshot,
  type StoryBibleWriteCandidate
} from "../src/index.js";

const now = "2026-07-05T00:00:00.000Z";

describe("StoryBibleSession", () => {
  test("loads a snapshot and builds explicit Context Engine candidates", async () => {
    const writes: StoryBibleAsset[] = [];
    const memoryWrites: MemoryRecord[] = [];
    const session = createStoryBibleSession({
      repository: createMemoryStoryBibleRepository(writes, memoryWrites)
    });

    const savedCharacter = await session.saveStoryAsset(characterAsset());
    const savedWorld = await session.saveStoryAsset(worldAsset());
    const savedTimeline = await session.saveStoryAsset(timelineAsset());
    const savedMemory = await session.saveMemory(unconfirmedMemory());
    const snapshot = await session.loadStoryBible();
    const candidates = await session.buildContextCandidates({
      includeStatuses: ["active"]
    });

    expect(savedCharacter.ok).toBe(true);
    expect(savedWorld.ok).toBe(true);
    expect(savedTimeline.ok).toBe(true);
    expect(savedMemory.ok).toBe(true);
    expect(snapshot.ok).toBe(true);
    expect(candidates.ok).toBe(true);
    if (!candidates.ok) {
      return;
    }
    expect(candidates.value.map((candidate) => candidate.refType)).toEqual([
      "character",
      "world",
      "timeline",
      "memory"
    ]);
    expect(candidates.value).toContainEqual({
      refType: "memory",
      refId: "mem_possible_betrayal",
      content: "Possible envoy betrayal.",
      priority: 400,
      memoryConfidence: "ai-unconfirmed",
      sourceRefs: [{ entityType: "memory", entityId: "mem_possible_betrayal" }]
    });
  });

  test("passes authoritative chapter IDs to manual create and candidate save", async () => {
    const calls: { create?: unknown; save?: unknown } = {};
    const candidate = editableCharacterCandidate();
    const repository: StoryBibleRepositoryPort = {
      async readStoryBible() {
        return ok({ characters: [], worldAssets: [], foreshadows: [], memories: [] });
      },
      async saveStoryAsset() {
        return err(unexpectedWrite());
      },
      async createStoryAsset(input) {
        calls.create = input;
        return ok(persistedEditableCharacter(1));
      },
      async saveStoryAssetCandidate(input) {
        calls.save = input;
        return ok(persistedEditableCharacter(2));
      },
      async saveMemory() {
        return err(unexpectedWrite());
      }
    };
    const session = createStoryBibleSession({
      repository,
      chapterCatalog: createChapterCatalog([chapterSummary("ch_02"), chapterSummary("ch_01")])
    });
    if (session.createStoryAsset === undefined || session.saveStoryAssetCandidate === undefined) {
      throw new Error("manual Story Bible write methods are unavailable");
    }

    const created = await session.createStoryAsset({
      type: "character",
      value: { title: "Mira" }
    });
    const saved = await session.saveStoryAssetCandidate({
      candidate,
      baseRevision: 1,
      baseChecksum: "a".repeat(64)
    });

    expect(created.ok).toBe(true);
    expect(saved.ok).toBe(true);
    expect(calls.create).toMatchObject({ knownChapterIds: ["ch_02", "ch_01"] });
    expect(calls.save).toMatchObject({ knownChapterIds: ["ch_02", "ch_01"] });
  });

  test("passes chapter catalog errors through manual create and candidate save unchanged", async () => {
    const catalogError = createUnifiedError({
      code: "CHAPTER_CATALOG_READ_FAILED",
      category: "StorageError",
      message: "Could not read chapter catalog.",
      recoverability: "retryable",
      suggestedAction: "Retry.",
      traceId: "story-bible-session-manual-write-test"
    });
    let repositoryWriteCount = 0;
    const candidate = editableCharacterCandidate();
    const repository: StoryBibleRepositoryPort = {
      async readStoryBible() {
        return ok({ characters: [], worldAssets: [], foreshadows: [], memories: [] });
      },
      async saveStoryAsset() {
        return err(unexpectedWrite());
      },
      async createStoryAsset() {
        repositoryWriteCount += 1;
        return ok(persistedEditableCharacter(1));
      },
      async saveStoryAssetCandidate() {
        repositoryWriteCount += 1;
        return ok(persistedEditableCharacter(2));
      },
      async saveMemory() {
        return err(unexpectedWrite());
      }
    };
    const session = createStoryBibleSession({
      repository,
      chapterCatalog: {
        async listChapters() {
          return err(catalogError);
        }
      }
    });
    if (session.createStoryAsset === undefined || session.saveStoryAssetCandidate === undefined) {
      throw new Error("manual Story Bible write methods are unavailable");
    }

    const created = await session.createStoryAsset({
      type: "character",
      value: { title: "Mira" }
    });
    const saved = await session.saveStoryAssetCandidate({
      candidate,
      baseRevision: 1,
      baseChecksum: "a".repeat(64)
    });

    expect(created).toEqual(err(catalogError));
    expect(saved).toEqual(err(catalogError));
    expect(repositoryWriteCount).toBe(0);
  });

  test("rejects deleted-boundary changes through generic strict and legacy saves", async () => {
    let strictWriteCount = 0;
    let legacyWriteCount = 0;
    let current = persistedEditableCharacter(3);
    const repository: StoryBibleRepositoryPort = {
      async readStoryBible() {
        return ok({ characters: [current], worldAssets: [], foreshadows: [], memories: [] });
      },
      async readCompatibleStoryAsset() {
        return ok({
          asset: current,
          persistedSchemaVersion: "1.1" as const,
          checksum: "a".repeat(64),
          revision: 3,
          passthroughPresent: false,
          passthroughFieldCount: 0
        });
      },
      async saveStoryAsset(asset) {
        legacyWriteCount += 1;
        return ok(asset);
      },
      async saveStoryAssetCandidate(input) {
        strictWriteCount += 1;
        return ok({
          ...current,
          ...input.candidate,
          type: "character" as const,
          updatedAt: now,
          revision: 4
        });
      },
      async saveMemory() {
        return err(unexpectedWrite());
      }
    };
    const session = createStoryBibleSession({ repository });
    if (session.saveStoryAssetCandidate === undefined) throw new Error("strict save unavailable");

    const deleted = await session.saveStoryAssetCandidate({
      candidate: { ...editableCharacterCandidate(), status: "deleted" },
      baseRevision: 3,
      baseChecksum: "a".repeat(64)
    });
    const archived = await session.saveStoryAssetCandidate({
      candidate: { ...editableCharacterCandidate(), status: "archived" },
      baseRevision: 3,
      baseChecksum: "a".repeat(64)
    });
    current = { ...current, id: "chr_hero", status: "active" };
    const legacyDeleted = await session.saveStoryAsset({ ...characterAsset(), status: "deleted" });

    expect(deleted).toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_STATUS_TRANSITION_COMMAND_REQUIRED" }
    });
    expect(archived.ok).toBe(true);
    expect(legacyDeleted).toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_STATUS_TRANSITION_COMMAND_REQUIRED" }
    });
    expect(strictWriteCount).toBe(1);
    expect(legacyWriteCount).toBe(0);
  });

  test("authorizes only dedicated delete and server-resolved restore transitions", async () => {
    let current = persistedEditableCharacter(2);
    const transitionInputs: unknown[] = [];
    const repository: StoryBibleRepositoryPort = {
      async readStoryBible() {
        return ok({ characters: [current], worldAssets: [], foreshadows: [], memories: [] });
      },
      async readCompatibleStoryAsset() {
        return ok({
          asset: current,
          persistedSchemaVersion: "1.1" as const,
          checksum: "b".repeat(64),
          revision: 2,
          passthroughPresent: false,
          passthroughFieldCount: 0
        });
      },
      async saveStoryAsset() {
        return err(unexpectedWrite());
      },
      async saveStoryAssetStatusTransition(input) {
        transitionInputs.push(input);
        return ok({
          ...current,
          ...input.candidate,
          type: "character" as const,
          updatedAt: now,
          revision: 3
        });
      },
      async saveMemory() {
        return err(unexpectedWrite());
      }
    };
    const session = createStoryBibleSession({
      repository,
      resolveRestoreStatus: async (_assetId, revision) => {
        expect(revision).toBe(2);
        return ok("draft");
      }
    });
    if (session.saveStoryAssetStatusTransition === undefined) {
      throw new Error("status transition save unavailable");
    }

    const deleted = await session.saveStoryAssetStatusTransition({
      action: "move-to-deleted",
      candidate: { ...editableCharacterCandidate(), status: "deleted" },
      baseRevision: 2,
      baseChecksum: "b".repeat(64),
      expectedDeletionImpactChecksum: "c".repeat(64)
    });
    current = { ...current, status: "deleted" };
    const wrongRestore = await session.saveStoryAssetStatusTransition({
      action: "restore",
      candidate: { ...editableCharacterCandidate(), status: "active" },
      baseRevision: 2,
      baseChecksum: "b".repeat(64)
    });
    const restored = await session.saveStoryAssetStatusTransition({
      action: "restore",
      candidate: { ...editableCharacterCandidate(), status: "draft" },
      baseRevision: 2,
      baseChecksum: "b".repeat(64)
    });

    expect(deleted.ok).toBe(true);
    expect(wrongRestore).toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_STATUS_TRANSITION_INVALID" }
    });
    expect(restored.ok).toBe(true);
    expect(transitionInputs).toEqual([
      expect.objectContaining({
        statusTransition: {
          action: "move-to-deleted",
          expectedDeletionImpactChecksum: "c".repeat(64)
        }
      }),
      expect.objectContaining({
        statusTransition: { action: "restore", restoreStatus: "draft" }
      })
    ]);
  });

  test("uses the authoritative chapter catalog for reference-impact queries", async () => {
    let receivedChapterIds: readonly string[] | undefined;
    const repository: StoryBibleRepositoryPort = {
      ...createStaticStoryBibleRepository({
        characters: [characterAsset()],
        worldAssets: [],
        foreshadows: [],
        memories: []
      }),
      async getStoryBibleReferences(assetId, knownChapterIds) {
        receivedChapterIds = knownChapterIds;
        return ok({
          assetId,
          deletionImpactChecksum: "d".repeat(64),
          incoming: [],
          outgoing: [],
          canSetDeleted: true,
          deletionImpact: { affectedReferenceCount: 0, affectedAssetIds: [], cascades: false }
        });
      }
    };
    const session = createStoryBibleSession({
      repository,
      chapterCatalog: createChapterCatalog([chapterSummary("ch_02"), chapterSummary("ch_01")])
    });
    if (session.getStoryAssetReferences === undefined) {
      throw new Error("reference-impact query is unavailable");
    }

    const impact = await session.getStoryAssetReferences("chr_hero");

    expect(impact).toMatchObject({ ok: true, value: { assetId: "chr_hero" } });
    expect(receivedChapterIds).toEqual(["ch_02", "ch_01"]);
  });

  test("restores only deleted assets to the status resolved from History", async () => {
    const readCompatibleStoryAsset = async (status: "active" | "deleted") =>
      ok({
        asset: { ...characterAsset(), status },
        persistedSchemaVersion: "1.1" as const,
        checksum: "a".repeat(64),
        revision: 2,
        passthroughPresent: false,
        passthroughFieldCount: 0
      });
    const deletedSession = createStoryBibleSession({
      repository: {
        ...createStaticStoryBibleRepository({
          characters: [{ ...characterAsset(), status: "deleted" }],
          worldAssets: [],
          foreshadows: [],
          memories: []
        }),
        readCompatibleStoryAsset: () => readCompatibleStoryAsset("deleted")
      },
      resolveRestoreStatus: async () => ok("draft")
    });
    const activeSession = createStoryBibleSession({
      repository: {
        ...createStaticStoryBibleRepository({
          characters: [characterAsset()],
          worldAssets: [],
          foreshadows: [],
          memories: []
        }),
        readCompatibleStoryAsset: () => readCompatibleStoryAsset("active")
      },
      resolveRestoreStatus: async () => ok("draft")
    });
    if (
      deletedSession.resolveStoryAssetRestoreStatus === undefined ||
      activeSession.resolveStoryAssetRestoreStatus === undefined
    ) {
      throw new Error("restore status resolution is unavailable");
    }

    await expect(deletedSession.resolveStoryAssetRestoreStatus("chr_hero")).resolves.toEqual(
      ok("draft")
    );
    await expect(activeSession.resolveStoryAssetRestoreStatus("chr_hero")).resolves.toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_RESTORE_NOT_DELETED" }
    });
  });

  test("does not expose candidates from archived story assets", async () => {
    const session = createStoryBibleSession({
      repository: createStaticStoryBibleRepository({
        characters: [{ ...characterAsset(), status: "archived" }],
        worldAssets: [worldAsset()],
        foreshadows: [],
        memories: []
      })
    });

    const candidates = await session.buildContextCandidates({
      includeStatuses: ["active"]
    });

    expect(candidates.ok).toBe(true);
    if (!candidates.ok) {
      return;
    }
    expect(candidates.value.map((candidate) => candidate.refId)).toEqual(["loc_capital"]);
  });

  test("maps only active non-abandoned foreshadows to goal candidates before memories", async () => {
    const session = createStoryBibleSession({
      repository: createStaticStoryBibleRepository({
        characters: [],
        worldAssets: [],
        foreshadows: [
          foreshadowAsset({ id: "fsh_active" }),
          foreshadowAsset({
            id: "fsh_abandoned",
            details: { trackingStatus: "abandoned" }
          }),
          foreshadowAsset({ id: "fsh_archived", status: "archived" })
        ],
        memories: [unconfirmedMemory()]
      })
    });

    const candidates = await session.buildContextCandidates({ includeStatuses: ["active"] });

    expect(candidates.ok).toBe(true);
    if (!candidates.ok) {
      return;
    }
    expect(candidates.value).toEqual([
      {
        refType: "goal",
        refId: "fsh_active",
        content: "The old key will reveal its origin later.",
        priority: 350,
        sourceRefs: [{ entityType: "foreshadow", entityId: "fsh_active" }]
      },
      {
        refType: "memory",
        refId: "mem_possible_betrayal",
        content: "Possible envoy betrayal.",
        priority: 400,
        memoryConfidence: "ai-unconfirmed",
        sourceRefs: [{ entityType: "memory", entityId: "mem_possible_betrayal" }]
      }
    ]);
  });

  test("finds active Story Bible title and alias mentions in stable asset order", () => {
    const suggestions = findStoryBibleMentionSuggestions({
      snapshot: {
        characters: [
          {
            ...characterAsset(),
            title: "Mira",
            aliases: ["Captain Mira", "   "]
          },
          {
            ...characterAsset(),
            id: "chr_archived",
            title: "Archived Hero",
            status: "archived"
          }
        ],
        worldAssets: [worldAsset()],
        outline: {
          ...timelineAsset(),
          id: "outline_main",
          type: "outline",
          title: "Northern Passage"
        },
        foreshadows: [],
        memories: []
      },
      currentChapterBody: "CAPTAIN MIRA reaches the gate.",
      userRequest: "Check the Capital and Northern Passage references."
    });

    expect(suggestions).toEqual([
      {
        kind: "story_bible",
        refId: "story_bible:chr_hero",
        assetId: "chr_hero",
        label: "Mira"
      },
      {
        kind: "story_bible",
        refId: "story_bible:loc_capital",
        assetId: "loc_capital",
        label: "Capital"
      },
      {
        kind: "story_bible",
        refId: "story_bible:outline_main",
        assetId: "outline_main",
        label: "Northern Passage"
      }
    ]);
  });

  test("returns no mention suggestions when neither writing input names an asset", () => {
    expect(
      findStoryBibleMentionSuggestions({
        snapshot: {
          characters: [characterAsset()],
          worldAssets: [worldAsset()],
          foreshadows: [],
          memories: []
        },
        currentChapterBody: "An unnamed traveler waits.",
        userRequest: "Continue the scene."
      })
    ).toEqual([]);
  });

  test("reports minimal Story Bible consistency conflicts with jump targets", async () => {
    const session = createStoryBibleSession({
      repository: createStaticStoryBibleRepository({
        characters: [
          {
            ...characterAsset(),
            title: "Mira",
            aliases: ["Captain Mira"],
            summary: "Mira is established as an only child."
          }
        ],
        worldAssets: [
          {
            ...worldAsset(),
            id: "world_mira_family",
            title: "Mira Family Rumor",
            summary: "Conflict: Captain Mira has a younger brother in the capital."
          }
        ],
        foreshadows: [],
        memories: [
          {
            ...unconfirmedMemory(),
            id: "mem_mira_sibling_conflict",
            title: "Mira sibling conflict",
            confidence: "confirmed",
            origin: "user-confirmed-ai",
            content: "This contradicts Mira: Captain Mira later says her brother is alive."
          }
        ]
      })
    });

    const report = await session.buildConsistencyReport();

    expect(report.ok).toBe(true);
    if (!report.ok) {
      return;
    }
    expect(report.value).toEqual({
      status: "attention",
      checkedAt: "2026-07-05T00:00:00.000Z",
      issues: [
        {
          id: "story-consistency.character.chr_hero.world_mira_family",
          severity: "warning",
          title: "Character setting may conflict with another Story Bible entry",
          message:
            "Mira appears in Mira Family Rumor with an explicit conflict marker. Review both entries before continuing the chapter.",
          sourceRef: {
            kind: "character",
            id: "chr_hero",
            title: "Mira"
          },
          targetRef: {
            kind: "world",
            id: "world_mira_family",
            title: "Mira Family Rumor"
          },
          suggestedAction: "Open the linked Story Bible entry and resolve the setting conflict."
        },
        {
          id: "story-consistency.character.chr_hero.mem_mira_sibling_conflict",
          severity: "warning",
          title: "Character setting may conflict with a memory",
          message:
            "Mira appears in Mira sibling conflict with an explicit conflict marker. Review both entries before continuing the chapter.",
          sourceRef: {
            kind: "character",
            id: "chr_hero",
            title: "Mira"
          },
          targetRef: {
            kind: "memory",
            id: "mem_mira_sibling_conflict",
            title: "Mira sibling conflict"
          },
          suggestedAction: "Open the linked Story Bible entry and resolve the setting conflict."
        }
      ]
    });
  });

  test("reports every missing chapter referenced by a foreshadow", async () => {
    const session = createStoryBibleSession({
      repository: createStaticStoryBibleRepository({
        characters: [],
        worldAssets: [],
        foreshadows: [
          foreshadowAsset({
            details: {
              trackingStatus: "paid-off",
              plantedChapterId: "ch_missing_planted",
              plannedPayoffChapterId: "ch_missing_planned",
              actualPayoffChapterId: "ch_missing_actual",
              sourceRefs: [
                {
                  chapterId: "ch_missing_source",
                  excerpt: "A repeated bell rings.",
                  excerptHash: "a".repeat(64)
                }
              ]
            }
          })
        ],
        memories: []
      }),
      chapterCatalog: createChapterCatalog([chapterSummary("ch_existing")])
    });

    const report = await session.buildConsistencyReport();

    expect(report.ok).toBe(true);
    if (!report.ok) {
      return;
    }
    expect(report.value.issues.map((issue) => issue.id)).toEqual([
      "story-consistency.foreshadow.fsh_old_key.missing-chapter.ch_missing_actual",
      "story-consistency.foreshadow.fsh_old_key.missing-chapter.ch_missing_planned",
      "story-consistency.foreshadow.fsh_old_key.missing-chapter.ch_missing_planted",
      "story-consistency.foreshadow.fsh_old_key.missing-chapter.ch_missing_source"
    ]);
    expect(report.value.issues.every((issue) => issue.targetRef.kind === "chapter")).toBe(true);
  });

  test("reports missing chapter references from non-foreshadow Story Bible entries", async () => {
    const session = createStoryBibleSession({
      repository: createStaticStoryBibleRepository({
        characters: [
          {
            ...characterAsset(),
            schemaVersion: "1.1",
            id: "chr_11111111111111111111111111111111",
            title: "Mira",
            details: {
              currentState: {
                locationId: null,
                physical: "",
                emotional: "",
                heldItemIds: [],
                asOfChapterId: "ch_missing_state",
                asOfEventId: null
              },
              knowledgeStates: [],
              stateHistory: []
            }
          }
        ],
        worldAssets: [],
        foreshadows: [],
        memories: []
      }),
      chapterCatalog: createChapterCatalog([chapterSummary("ch_existing")])
    });

    const report = await session.buildConsistencyReport();

    expect(report).toMatchObject({
      ok: true,
      value: {
        issues: [
          {
            id: "story-consistency.character.chr_11111111111111111111111111111111.missing-chapter.ch_missing_state",
            title: "Story Bible entry references a missing chapter",
            targetRef: { kind: "chapter", id: "ch_missing_state" }
          }
        ]
      }
    });
  });

  test("reports duplicate non-deleted foreshadow evidence once with a stable issue id", async () => {
    const duplicateHash = "b".repeat(64);
    const duplicateSource = {
      chapterId: "ch_01",
      excerpt: "The key catches the firelight.",
      excerptHash: duplicateHash
    };
    const firstSnapshot: StoryBibleSnapshot = {
      characters: [],
      worldAssets: [],
      foreshadows: [
        foreshadowAsset({
          id: "fsh_beta",
          title: "Beta",
          details: { sourceRefs: [duplicateSource] }
        }),
        foreshadowAsset({
          id: "fsh_alpha",
          title: "Alpha",
          details: { sourceRefs: [duplicateSource] }
        }),
        foreshadowAsset({
          id: "fsh_deleted",
          title: "Deleted",
          status: "deleted",
          details: { sourceRefs: [duplicateSource] }
        })
      ],
      memories: []
    };
    const secondSnapshot: StoryBibleSnapshot = {
      ...firstSnapshot,
      foreshadows: [...firstSnapshot.foreshadows].reverse()
    };

    const firstReport = await createStoryBibleSession({
      repository: createStaticStoryBibleRepository(firstSnapshot)
    }).buildConsistencyReport();
    const secondReport = await createStoryBibleSession({
      repository: createStaticStoryBibleRepository(secondSnapshot)
    }).buildConsistencyReport();

    expect(firstReport.ok).toBe(true);
    expect(secondReport.ok).toBe(true);
    if (!firstReport.ok || !secondReport.ok) {
      return;
    }
    expect(firstReport.value.issues).toHaveLength(1);
    expect(firstReport.value.issues[0]).toMatchObject({
      id: `story-consistency.foreshadow.duplicate-source.ch_01.${duplicateHash}`,
      sourceRef: { kind: "foreshadow", id: "fsh_alpha" },
      targetRef: { kind: "foreshadow", id: "fsh_beta" }
    });
    expect(secondReport.value.issues.map((issue) => issue.id)).toEqual(
      firstReport.value.issues.map((issue) => issue.id)
    );
  });

  test("defensively reports paid-off foreshadows without an actual payoff chapter", async () => {
    const session = createStoryBibleSession({
      repository: createStaticStoryBibleRepository({
        characters: [],
        worldAssets: [],
        foreshadows: [
          foreshadowAsset({
            details: {
              trackingStatus: "paid-off"
            }
          })
        ],
        memories: []
      })
    });

    const report = await session.buildConsistencyReport();

    expect(report.ok).toBe(true);
    if (!report.ok) {
      return;
    }
    expect(report.value.issues).toContainEqual(
      expect.objectContaining({
        id: "story-consistency.foreshadow.fsh_old_key.paid-off-missing-actual-payoff-chapter",
        code: "FORESHADOW_PAID_OFF_ACTUAL_CHAPTER_MISSING",
        severity: "warning",
        sourceRef: expect.objectContaining({ kind: "foreshadow", id: "fsh_old_key" })
      })
    );
  });

  test("passes chapter catalog errors through unchanged", async () => {
    const catalogError = createUnifiedError({
      code: "CHAPTER_CATALOG_READ_FAILED",
      category: "StorageError",
      message: "Could not read chapter catalog.",
      recoverability: "retryable",
      suggestedAction: "Retry.",
      traceId: "story-bible-session-test"
    });
    const session = createStoryBibleSession({
      repository: createStaticStoryBibleRepository({
        characters: [],
        worldAssets: [],
        foreshadows: [],
        memories: []
      }),
      chapterCatalog: {
        async listChapters() {
          return err(catalogError);
        }
      }
    });

    const report = await session.buildConsistencyReport();

    expect(report).toEqual(err(catalogError));
  });

  test("uses the latest foreshadow update as the consistency check timestamp", async () => {
    const session = createStoryBibleSession({
      repository: createStaticStoryBibleRepository({
        characters: [characterAsset()],
        worldAssets: [],
        foreshadows: [
          foreshadowAsset({
            updatedAt: "2026-07-06T01:02:03.000Z"
          })
        ],
        memories: []
      })
    });

    const report = await session.buildConsistencyReport();

    expect(report.ok).toBe(true);
    if (!report.ok) {
      return;
    }
    expect(report.value.checkedAt).toBe("2026-07-06T01:02:03.000Z");
  });

  test("returns a stable unavailable error without a repository", async () => {
    const session = createStoryBibleSession();

    const result = await session.loadStoryBible();

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe("STORY_BIBLE_UNAVAILABLE");
  });
});

function createMemoryStoryBibleRepository(
  assets: StoryBibleAsset[],
  memories: MemoryRecord[]
): StoryBibleRepositoryPort {
  return {
    async readStoryBible() {
      const outline = assets.find(
        (asset): asset is StoryBibleRegularAsset => asset.type === "outline"
      );
      const timeline = assets.find(
        (asset): asset is StoryBibleRegularAsset => asset.type === "timeline.events"
      );
      return ok({
        characters: assets.filter(
          (asset): asset is StoryBibleRegularAsset => asset.type === "character"
        ),
        worldAssets: assets.filter((asset): asset is StoryBibleRegularAsset =>
          asset.type.startsWith("world.")
        ),
        ...(outline === undefined ? {} : { outline }),
        ...(timeline === undefined ? {} : { timeline }),
        foreshadows: assets.filter(
          (asset): asset is ForeshadowAsset => asset.type === "foreshadow"
        ),
        memories
      });
    },
    async saveStoryAsset(asset) {
      assets.push(asset);
      return ok(asset);
    },
    async saveMemory(memory) {
      memories.push(memory);
      return ok(memory);
    }
  };
}

function createStaticStoryBibleRepository(snapshot: StoryBibleSnapshot): StoryBibleRepositoryPort {
  return {
    async readStoryBible() {
      return ok(snapshot);
    },
    async saveStoryAsset() {
      return err(unexpectedWrite());
    },
    async saveMemory() {
      return err(unexpectedWrite());
    }
  };
}

function unexpectedWrite(): UnifiedError {
  return createUnifiedError({
    code: "UNEXPECTED_WRITE",
    category: "ValidationError",
    message: "Unexpected write.",
    recoverability: "fatal",
    suggestedAction: "Fix the test setup.",
    traceId: "story-bible-session-test"
  });
}

function characterAsset(): StoryBibleRegularAsset {
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

function worldAsset(): StoryBibleRegularAsset {
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

function timelineAsset(): StoryBibleRegularAsset {
  return {
    schemaVersion: "1.0",
    id: "timeline_main",
    type: "timeline.events",
    title: "Main Timeline",
    status: "active",
    summary: "Arrival happens before the council summons.",
    createdAt: now,
    updatedAt: now
  };
}

function editableCharacterCandidate(): StoryBibleWriteCandidate {
  return {
    schemaVersion: "1.1",
    id: "chr_11111111111111111111111111111111",
    type: "character",
    title: "Mira",
    status: "active",
    summary: "An archivist.",
    aliases: [],
    relations: [],
    details: { knowledgeStates: [], stateHistory: [] },
    extensions: {},
    createdAt: now
  };
}

function persistedEditableCharacter(revision: number): StoryBibleRegularAsset {
  return {
    ...editableCharacterCandidate(),
    type: "character",
    updatedAt: now,
    revision
  };
}

interface ForeshadowAssetOverrides {
  readonly id?: string;
  readonly title?: string;
  readonly status?: ForeshadowAsset["status"];
  readonly updatedAt?: string;
  readonly details?: Partial<ForeshadowDetails>;
}

function foreshadowAsset(overrides: ForeshadowAssetOverrides = {}): ForeshadowAsset {
  return {
    schemaVersion: "1.0",
    id: overrides.id ?? "fsh_old_key",
    type: "foreshadow",
    title: overrides.title ?? "Old Key",
    status: overrides.status ?? "active",
    summary: "The old key will reveal its origin later.",
    details: {
      trackingStatus: "planted",
      sourceRefs: [],
      ...overrides.details
    },
    createdAt: now,
    updatedAt: overrides.updatedAt ?? now
  };
}

function createChapterCatalog(
  chapters: readonly ChapterSummary[]
): Pick<ChapterCatalogRepositoryPort, "listChapters"> {
  return {
    async listChapters() {
      return ok(chapters);
    }
  };
}

function chapterSummary(id: string): ChapterSummary {
  return {
    id,
    title: id,
    order: 1,
    status: "draft",
    updatedAt: now
  };
}

function unconfirmedMemory(): MemoryRecord {
  return {
    schemaVersion: "1.0",
    id: "mem_possible_betrayal",
    type: "memory.long-term",
    title: "Possible Betrayal",
    status: "active",
    origin: "ai-unconfirmed",
    confidence: "needs-review",
    content: "Possible envoy betrayal.",
    createdAt: now,
    updatedAt: now
  };
}
