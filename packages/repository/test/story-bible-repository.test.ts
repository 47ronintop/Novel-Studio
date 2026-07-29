import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, test } from "vitest";
import { hashForeshadowEvidence, normalizeForeshadowEvidence } from "@novel-studio/shared";

import {
  StoryBibleFileRepository,
  WorkspaceOutlineProjectMetadataRepository,
  type ForeshadowAsset,
  type MemoryRecord,
  type StoryBibleAsset,
  type StoryBibleRegularAsset
} from "../src/index.js";

const tempRoots: string[] = [];

const now = "2026-07-05T00:00:00.000Z";

describe("StoryBibleFileRepository", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  test("saves and loads characters, world assets, outline, foreshadows, timeline, and memories", async () => {
    const projectRoot = await createTempProject();
    const repository = new StoryBibleFileRepository({
      projectRoot,
      traceId: "trace_story_bible_test"
    });

    await expect(repository.saveStoryAsset(characterAsset())).resolves.toMatchObject({ ok: true });
    await expect(repository.saveStoryAsset(worldAsset())).resolves.toMatchObject({ ok: true });
    await expect(repository.saveStoryAsset(outlineAsset())).resolves.toMatchObject({ ok: true });
    await expect(repository.saveStoryAsset(await foreshadowAsset())).resolves.toMatchObject({
      ok: true
    });
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
    expect(snapshot.value.foreshadows.map((asset) => asset.id)).toEqual([
      "fsh_018f12a7b91c4a2f9437c3d764e9a120"
    ]);
    expect(snapshot.value.timeline?.id).toBe("timeline_main");
    expect(snapshot.value.memories.map((memory) => memory.id)).toEqual(["mem_oath"]);
    await expect(readFile(join(projectRoot, "outline", "outline.json"), "utf8")).resolves.toContain(
      "outline_main"
    );
    await expect(readFile(join(projectRoot, "timeline", "events.json"), "utf8")).resolves.toContain(
      "timeline_main"
    );
    await expect(
      readFile(
        join(projectRoot, "foreshadows", "fsh_018f12a7b91c4a2f9437c3d764e9a120.json"),
        "utf8"
      )
    ).resolves.toContain("foreshadow");
  });

  test("returns an empty foreshadow collection for an empty directory", async () => {
    const projectRoot = await createTempProject();
    await mkdir(join(projectRoot, "foreshadows"), { recursive: true });
    const repository = new StoryBibleFileRepository({ projectRoot });

    const snapshot = await repository.readStoryBible();

    expect(snapshot).toMatchObject({ ok: true, value: { foreshadows: [] } });
  });

  test("keeps old projects without a foreshadows directory readable", async () => {
    const projectRoot = await createTempProject();
    const repository = new StoryBibleFileRepository({ projectRoot });

    const snapshot = await repository.readStoryBible();

    expect(snapshot).toMatchObject({ ok: true, value: { foreshadows: [] } });
    await expect(readFile(join(projectRoot, "foreshadows"), "utf8")).rejects.toThrow();
  });

  test("does not read nested JSON as a foreshadow asset", async () => {
    const projectRoot = await createTempProject();
    const nestedDirectory = join(projectRoot, "foreshadows", "nested");
    await mkdir(nestedDirectory, { recursive: true });
    await writeFile(
      join(nestedDirectory, "nested.json"),
      `${JSON.stringify(await foreshadowAsset(), null, 2)}\n`,
      "utf8"
    );
    const repository = new StoryBibleFileRepository({ projectRoot });

    const snapshot = await repository.readStoryBible();

    expect(snapshot).toMatchObject({ ok: true, value: { foreshadows: [] } });
  });

  test("rejects a foreshadow whose direct filename does not match its id", async () => {
    const projectRoot = await createTempProject();
    await mkdir(join(projectRoot, "foreshadows"), { recursive: true });
    await writeFile(
      join(projectRoot, "foreshadows", "fsh_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json"),
      `${JSON.stringify(await foreshadowAsset(), null, 2)}\n`,
      "utf8"
    );
    const repository = new StoryBibleFileRepository({ projectRoot });

    const snapshot = await repository.readStoryBible();

    expect(snapshot).toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_ASSET_INVALID" }
    });
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

  test("rejects character and world ids that traverse out of their asset directories", async () => {
    const projectRoot = await createTempProject();
    const repository = new StoryBibleFileRepository({ projectRoot });

    const characterResult = await repository.saveStoryAsset({
      ...characterAsset(),
      id: "../escaped-character"
    });
    const worldResult = await repository.saveStoryAsset({
      ...worldAsset(),
      id: "..\\escaped-world"
    });

    expect(characterResult).toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_ASSET_INVALID" }
    });
    expect(worldResult).toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_ASSET_INVALID" }
    });
    await expect(readFile(join(projectRoot, "escaped-character.json"), "utf8")).rejects.toThrow();
    await expect(readFile(join(projectRoot, "escaped-world.json"), "utf8")).rejects.toThrow();
    expect(await readdir(join(projectRoot, "world"))).toEqual([]);
  });

  test("rejects redirected Story Bible directories for reads and writes", async () => {
    const projectRoot = await createTempProject();
    const outsideRoot = await mkdtemp(join(tmpdir(), "novel-studio-story-bible-outside-"));
    tempRoots.push(outsideRoot);
    const charactersPath = join(projectRoot, "characters");
    await rm(charactersPath, { recursive: true, force: true });
    if (!(await tryCreateDirectoryLink(outsideRoot, charactersPath))) {
      return;
    }
    const repository = new StoryBibleFileRepository({ projectRoot });

    const readResult = await repository.readStoryBible();

    expect(readResult).toMatchObject({
      ok: false,
      error: { code: "PROJECT_STORAGE_PATH_REJECTED" }
    });
    await rm(charactersPath, { recursive: true, force: true });
    await mkdir(charactersPath, { recursive: true });

    const foreshadowsPath = join(projectRoot, "foreshadows");
    if (!(await tryCreateDirectoryLink(outsideRoot, foreshadowsPath))) {
      return;
    }
    const writeResult = await repository.saveStoryAsset(await foreshadowAsset());

    expect(writeResult).toMatchObject({
      ok: false,
      error: { code: "PROJECT_STORAGE_PATH_REJECTED" }
    });
    expect(await readdir(outsideRoot)).toEqual([]);
  });

  test("rejects Story Bible assets stored under a mismatched directory or singleton path", async () => {
    const projectRoot = await createTempProject();
    const repository = new StoryBibleFileRepository({ projectRoot });
    const misplacedWorld = worldAsset();
    const misplacedWorldPath = join(projectRoot, "characters", `${misplacedWorld.id}.json`);
    await writeFile(misplacedWorldPath, `${JSON.stringify(misplacedWorld, null, 2)}\n`, "utf8");

    await expect(repository.readStoryBible()).resolves.toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_ASSET_INVALID" }
    });

    await rm(misplacedWorldPath, { force: true });
    const misplacedForeshadow = await foreshadowAsset();
    const misplacedForeshadowPath = join(
      projectRoot,
      "characters",
      `${misplacedForeshadow.id}.json`
    );
    await writeFile(
      misplacedForeshadowPath,
      `${JSON.stringify(misplacedForeshadow, null, 2)}\n`,
      "utf8"
    );

    await expect(repository.readStoryBible()).resolves.toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_ASSET_INVALID" }
    });

    await rm(misplacedForeshadowPath, { force: true });
    await writeFile(
      join(projectRoot, "outline", "outline.json"),
      `${JSON.stringify(timelineAsset(), null, 2)}\n`,
      "utf8"
    );

    await expect(repository.readStoryBible()).resolves.toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_ASSET_INVALID" }
    });
  });

  test("keeps recursively stored legacy world assets readable", async () => {
    const projectRoot = await createTempProject();
    const legacyDirectory = join(projectRoot, "world", "locations");
    await mkdir(legacyDirectory, { recursive: true });
    await writeFile(
      join(legacyDirectory, "legacy-capital-record.json"),
      `${JSON.stringify({ ...worldAsset(), id: "loc_legacy_capital" }, null, 2)}\n`,
      "utf8"
    );
    const repository = new StoryBibleFileRepository({ projectRoot });

    await expect(repository.readStoryBible()).resolves.toMatchObject({
      ok: true,
      value: {
        worldAssets: [{ id: "loc_legacy_capital", type: "world.location" }]
      }
    });
  });

  test("rejects foreshadows that fail their schema", async () => {
    const projectRoot = await createTempProject();
    const repository = new StoryBibleFileRepository({ projectRoot });
    const validAsset = await foreshadowAsset();
    const invalidAsset = {
      ...validAsset,
      details: {
        sourceRefs: validAsset.details.sourceRefs
      }
    } as StoryBibleAsset;

    const result = await repository.saveStoryAsset(invalidAsset);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_ASSET_INVALID" }
    });
    await expect(
      readFile(join(projectRoot, "foreshadows", `${validAsset.id}.json`), "utf8")
    ).rejects.toThrow();
  });

  test("rejects non-normalized or hash-mismatched foreshadow evidence", async () => {
    const projectRoot = await createTempProject();
    const repository = new StoryBibleFileRepository({ projectRoot });
    const validAsset = await foreshadowAsset();
    const rawExcerpt = "  线索\r\n继续  ";
    const nonNormalizedAsset: ForeshadowAsset = {
      ...validAsset,
      id: "fsh_11111111111111111111111111111111",
      details: {
        ...validAsset.details,
        sourceRefs: [
          {
            chapterId: "ch_01",
            excerpt: rawExcerpt,
            excerptHash: await hashForeshadowEvidence(rawExcerpt)
          }
        ]
      }
    };
    const mismatchedHashAsset: ForeshadowAsset = {
      ...validAsset,
      id: "fsh_22222222222222222222222222222222",
      details: {
        ...validAsset.details,
        sourceRefs: [
          {
            chapterId: "ch_01",
            excerpt: validAsset.details.sourceRefs?.[0]?.excerpt ?? "",
            excerptHash: "0".repeat(64)
          }
        ]
      }
    };

    await expect(repository.saveStoryAsset(nonNormalizedAsset)).resolves.toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_ASSET_INVALID" }
    });
    await expect(repository.saveStoryAsset(mismatchedHashAsset)).resolves.toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_ASSET_INVALID" }
    });
  });

  test("rejects invalid foreshadow evidence loaded from disk", async () => {
    const projectRoot = await createTempProject();
    const asset = await foreshadowAsset();
    const invalidAsset: ForeshadowAsset = {
      ...asset,
      details: {
        ...asset.details,
        sourceRefs: (asset.details.sourceRefs ?? []).map((sourceRef) => ({
          ...sourceRef,
          excerptHash: "0".repeat(64)
        }))
      }
    };
    await mkdir(join(projectRoot, "foreshadows"), { recursive: true });
    await writeFile(
      join(projectRoot, "foreshadows", `${invalidAsset.id}.json`),
      `${JSON.stringify(invalidAsset, null, 2)}\n`,
      "utf8"
    );
    const repository = new StoryBibleFileRepository({ projectRoot });

    const snapshot = await repository.readStoryBible();

    expect(snapshot).toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_ASSET_INVALID" }
    });
  });

  test("preserves v1.0 schema versions and unknown root and details fields", async () => {
    const projectRoot = await createTempProject();
    const repository = new StoryBibleFileRepository({ projectRoot });
    const asset: StoryBibleAsset = {
      ...characterAsset(),
      futureRootField: { enabled: true },
      details: {
        ...characterAsset().details,
        futureDetailField: ["kept"]
      }
    };

    await expect(repository.saveStoryAsset(asset)).resolves.toMatchObject({ ok: true });
    const persisted = JSON.parse(
      await readFile(join(projectRoot, "characters", `${asset.id}.json`), "utf8")
    ) as Record<string, unknown>;
    const snapshot = await repository.readStoryBible();

    expect(persisted).toMatchObject({
      schemaVersion: "1.0",
      futureRootField: { enabled: true },
      details: { futureDetailField: ["kept"] }
    });
    expect(snapshot).toMatchObject({
      ok: true,
      value: {
        characters: [
          {
            schemaVersion: "1.0",
            futureRootField: { enabled: true },
            details: { futureDetailField: ["kept"] }
          }
        ]
      }
    });
  });

  test("writes canonical Story Bible metadata keys before body and unknown fields", async () => {
    const projectRoot = await createTempProject();
    const repository = new StoryBibleFileRepository({ projectRoot });
    const unorderedAsset = {
      futureRootField: { kept: true },
      updatedAt: now,
      createdAt: now,
      relatedEntityIds: ["loc_capital"],
      details: { goals: ["Protect the archive"] },
      aliases: ["Archivist"],
      summary: "Canonical metadata remains prefix-readable.",
      status: "active",
      title: "Canonical Hero",
      type: "character",
      id: "chr_canonical",
      schemaVersion: "1.0"
    } satisfies StoryBibleRegularAsset;

    await expect(repository.saveStoryAsset(unorderedAsset)).resolves.toMatchObject({ ok: true });
    const persisted = JSON.parse(
      await readFile(join(projectRoot, "characters", `${unorderedAsset.id}.json`), "utf8")
    ) as Record<string, unknown>;
    const metadata = new WorkspaceOutlineProjectMetadataRepository({ projectRoot });
    const storyBibleIndex = await metadata.readStoryBibleIndex();

    expect(Object.keys(persisted)).toEqual([
      "schemaVersion",
      "id",
      "type",
      "title",
      "status",
      "summary",
      "aliases",
      "details",
      "relatedEntityIds",
      "createdAt",
      "updatedAt",
      "futureRootField"
    ]);
    expect(storyBibleIndex).toMatchObject({
      ok: true,
      value: {
        entries: [
          {
            assetId: "chr_canonical",
            assetType: "character",
            title: "Canonical Hero",
            relativePath: "characters/chr_canonical.json"
          }
        ]
      }
    });
  });

  test("sorts collection titles with stable id tie breakers", async () => {
    const projectRoot = await createTempProject();
    const repository = new StoryBibleFileRepository({ projectRoot });
    const firstForeshadow = await foreshadowAsset({
      id: "fsh_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      title: "同名"
    });
    const secondForeshadow = await foreshadowAsset({
      id: "fsh_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      title: "同名"
    });

    await Promise.all([
      repository.saveStoryAsset({ ...characterAsset(), id: "chr_z", title: "同名" }),
      repository.saveStoryAsset({ ...characterAsset(), id: "chr_a", title: "同名" }),
      repository.saveStoryAsset({ ...worldAsset(), id: "loc_z", title: "同名" }),
      repository.saveStoryAsset({ ...worldAsset(), id: "loc_a", title: "同名" }),
      repository.saveStoryAsset(secondForeshadow),
      repository.saveStoryAsset(firstForeshadow)
    ]);

    const snapshot = await repository.readStoryBible();

    expect(snapshot).toMatchObject({
      ok: true,
      value: {
        characters: [{ id: "chr_a" }, { id: "chr_z" }],
        worldAssets: [{ id: "loc_a" }, { id: "loc_z" }],
        foreshadows: [{ id: firstForeshadow.id }, { id: secondForeshadow.id }]
      }
    });
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

async function tryCreateDirectoryLink(target: string, path: string): Promise<boolean> {
  try {
    await symlink(target, path, "junction");
    return true;
  } catch {
    // Directory links can be unavailable in restricted Windows environments.
    return false;
  }
}

function characterAsset(): StoryBibleRegularAsset {
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

function worldAsset(): StoryBibleRegularAsset {
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

function outlineAsset(): StoryBibleRegularAsset {
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

function timelineAsset(): StoryBibleRegularAsset {
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

async function foreshadowAsset(overrides: Partial<ForeshadowAsset> = {}): Promise<ForeshadowAsset> {
  const excerpt = normalizeForeshadowEvidence("他把那把生锈的钥匙收进袖口。");
  return {
    schemaVersion: "1.0",
    id: "fsh_018f12a7b91c4a2f9437c3d764e9a120",
    type: "foreshadow",
    title: "旧钥匙的来源",
    status: "active",
    summary: "第一章出现的旧钥匙将在第五章揭示来源。",
    details: {
      trackingStatus: "planted",
      plantedChapterId: "ch_01",
      plannedPayoffChapterId: "ch_05",
      sourceRefs: [
        {
          chapterId: "ch_01",
          excerpt,
          excerptHash: await hashForeshadowEvidence(excerpt)
        }
      ],
      origin: "ai-confirmed",
      notes: ""
    },
    relatedEntityIds: ["chr_hero"],
    createdAt: now,
    updatedAt: now,
    ...overrides
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
