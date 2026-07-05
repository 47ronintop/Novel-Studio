import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, test } from "vitest";

import { StoryBibleFileRepository, type MemoryRecord, type StoryBibleAsset } from "../src/index.js";

const tempRoots: string[] = [];

const now = "2026-07-05T00:00:00.000Z";

describe("StoryBibleFileRepository", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  test("saves and loads characters, world assets, outline, timeline, and memories", async () => {
    const projectRoot = await createTempProject();
    const repository = new StoryBibleFileRepository({
      projectRoot,
      traceId: "trace_story_bible_test"
    });

    await expect(repository.saveStoryAsset(characterAsset())).resolves.toMatchObject({ ok: true });
    await expect(repository.saveStoryAsset(worldAsset())).resolves.toMatchObject({ ok: true });
    await expect(repository.saveStoryAsset(outlineAsset())).resolves.toMatchObject({ ok: true });
    await expect(repository.saveStoryAsset(timelineAsset())).resolves.toMatchObject({ ok: true });
    await expect(repository.saveMemory(memoryRecord())).resolves.toMatchObject({ ok: true });

    const snapshot = await repository.readStoryBible();

    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) {
      return;
    }
    expect(snapshot.value.characters.map((asset) => asset.id)).toEqual(["chr_hero"]);
    expect(snapshot.value.worldAssets.map((asset) => asset.id)).toEqual(["loc_capital"]);
    expect(snapshot.value.outline?.id).toBe("outline_main");
    expect(snapshot.value.timeline?.id).toBe("timeline_main");
    expect(snapshot.value.memories.map((memory) => memory.id)).toEqual(["mem_oath"]);
    await expect(readFile(join(projectRoot, "outline", "outline.json"), "utf8")).resolves.toContain(
      "outline_main"
    );
    await expect(readFile(join(projectRoot, "timeline", "events.json"), "utf8")).resolves.toContain(
      "timeline_main"
    );
  });

  test("rejects invalid story assets before writing", async () => {
    const projectRoot = await createTempProject();
    const repository = new StoryBibleFileRepository({
      projectRoot,
      traceId: "trace_story_bible_invalid"
    });
    const invalidAsset = {
      ...characterAsset(),
      id: "",
      title: ""
    };

    const result = await repository.saveStoryAsset(invalidAsset);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe("STORY_BIBLE_ASSET_INVALID");
    await expect(readFile(join(projectRoot, "characters", ".json"), "utf8")).rejects.toThrow();
  });

  test("returns a stable error when a persisted memory is malformed", async () => {
    const projectRoot = await createTempProject();
    await mkdir(join(projectRoot, "memories", "long-term"), { recursive: true });
    await writeFile(
      join(projectRoot, "memories", "long-term", "mem_bad.json"),
      JSON.stringify({ schemaVersion: "1.0", id: "bad" }),
      "utf8"
    );
    const repository = new StoryBibleFileRepository({
      projectRoot,
      traceId: "trace_story_bible_malformed"
    });

    const result = await repository.readStoryBible();

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe("STORY_BIBLE_MEMORY_INVALID");
    expect(JSON.stringify(result.error)).not.toContain("sk-");
  });
});

async function createTempProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "novel-studio-story-bible-"));
  tempRoots.push(root);
  await Promise.all(
    ["characters", "world", "outline", "timeline", join("memories", "long-term")].map((directory) =>
      mkdir(join(root, directory), { recursive: true })
    )
  );
  return root;
}

function characterAsset(): StoryBibleAsset {
  return {
    schemaVersion: "1.0",
    id: "chr_hero",
    type: "character",
    title: "Hero",
    status: "active",
    summary: "A procedural protagonist with a hidden oath.",
    aliases: ["Archivist"],
    details: {
      goals: ["Protect the archive"],
      conflicts: ["Cannot speak the old oath aloud"]
    },
    relatedEntityIds: ["loc_capital"],
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
    details: {
      constraints: ["No open flame after midnight"]
    },
    relatedEntityIds: ["chr_hero"],
    createdAt: now,
    updatedAt: now
  };
}

function outlineAsset(): StoryBibleAsset {
  return {
    schemaVersion: "1.0",
    id: "outline_main",
    type: "outline",
    title: "Main Outline",
    status: "active",
    summary: "The first volume introduces the archive oath.",
    details: {
      volumes: [{ id: "vol_01", title: "Volume One", chapterIds: ["ch_01"] }]
    },
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
    details: {
      events: [{ id: "evt_arrival", sequence: 1, chapterIds: ["ch_01"] }]
    },
    relatedEntityIds: ["chr_hero", "loc_capital"],
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
    sourceRefs: [{ entityType: "character", entityId: "chr_hero" }],
    createdAt: now,
    updatedAt: now
  };
}
