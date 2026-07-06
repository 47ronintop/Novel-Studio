import { describe, expect, test } from "vitest";

import { err, ok, type UnifiedError, createUnifiedError } from "@novel-studio/shared";

import {
  createStoryBibleSession,
  type MemoryRecord,
  type StoryBibleAsset,
  type StoryBibleRepositoryPort,
  type StoryBibleSnapshot
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

  test("does not expose candidates from archived story assets", async () => {
    const session = createStoryBibleSession({
      repository: createStaticStoryBibleRepository({
        characters: [{ ...characterAsset(), status: "archived" }],
        worldAssets: [worldAsset()],
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
      const outline = assets.find((asset) => asset.type === "outline");
      const timeline = assets.find((asset) => asset.type === "timeline.events");
      return ok({
        characters: assets.filter((asset) => asset.type === "character"),
        worldAssets: assets.filter((asset) => asset.type.startsWith("world.")),
        ...(outline === undefined ? {} : { outline }),
        ...(timeline === undefined ? {} : { timeline }),
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

function timelineAsset(): StoryBibleAsset {
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
