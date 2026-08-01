import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, test } from "vitest";
import {
  err,
  hashForeshadowEvidence,
  normalizeForeshadowEvidence,
  ok,
  type JsonObject
} from "@novel-studio/shared";

import {
  StoryBibleFileRepository,
  WorkspaceOutlineProjectMetadataRepository,
  type ForeshadowAsset,
  type MemoryRecord,
  type PreparedStoryBibleCreate,
  type StoryBibleAsset,
  type StoryBibleRegularAsset,
  type StoryBibleWriteCandidate
} from "../src/index.js";
import { storageError } from "../src/errors.js";

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

  test("opens a project that has no Story Bible directories", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-story-bible-empty-"));
    tempRoots.push(projectRoot);
    const repository = new StoryBibleFileRepository({ projectRoot });

    const snapshot = await repository.readStoryBible();

    expect(snapshot).toEqual({
      ok: true,
      value: {
        characters: [],
        worldAssets: [],
        foreshadows: [],
        memories: []
      }
    });
    await expect(readdir(projectRoot)).resolves.toEqual([]);
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
    const legacyPath = join(legacyDirectory, "legacy-capital-record.json");
    const canonicalPath = join(projectRoot, "world", "loc_legacy_capital.json");
    await mkdir(legacyDirectory, { recursive: true });
    const legacyContent = `${JSON.stringify(
      { ...worldAsset(), id: "loc_legacy_capital", legacyWorldField: "keep" },
      null,
      2
    )}\n`;
    await writeFile(legacyPath, legacyContent, "utf8");
    let historySnapshot:
      { readonly relativePath: string; readonly baseContent: string } | undefined;
    const repository = new StoryBibleFileRepository({
      projectRoot,
      beforeStoryAssetCandidateWrite: async (prepared) => {
        await expect(readFile(legacyPath, "utf8")).rejects.toThrow();
        await expect(readFile(canonicalPath, "utf8")).resolves.toBe(legacyContent);
        historySnapshot = {
          relativePath: prepared.relativePath,
          baseContent: prepared.baseContent
        };
        return ok(undefined);
      }
    });

    await expect(repository.readStoryBible()).resolves.toMatchObject({
      ok: true,
      value: {
        worldAssets: [{ id: "loc_legacy_capital", type: "world.location" }]
      }
    });

    const compatible = await repository.readCompatibleStoryAsset("loc_legacy_capital");
    expect(compatible).toMatchObject({
      ok: true,
      value: {
        relativePath: "world/locations/legacy-capital-record.json",
        persistedSchemaVersion: "1.0",
        revision: 0,
        asset: { id: "loc_legacy_capital", type: "world.location" }
      }
    });
    await expect(repository.listStoryBible()).resolves.toMatchObject({
      ok: true,
      value: { items: [{ assetId: "loc_legacy_capital", type: "world.location" }] }
    });
    await expect(repository.readStoryAssetForAgent("loc_legacy_capital")).resolves.toMatchObject({
      ok: true,
      value: {
        relativePath: "world/locations/legacy-capital-record.json",
        persistedSchemaVersion: "1.0",
        asset: { id: "loc_legacy_capital", type: "world.location" }
      }
    });
    if (!compatible.ok) return;

    const candidate = candidateFrom(compatible.value.asset, { title: "Upgraded Capital" });
    const readOnlyPrepared = await repository.prepareStoryAssetCandidateReadOnly({
      candidate,
      baseRevision: compatible.value.revision,
      baseChecksum: compatible.value.checksum
    });
    expect(readOnlyPrepared).toMatchObject({
      ok: true,
      value: {
        relativePath: "world/loc_legacy_capital.json",
        baseContent: legacyContent,
        baseChecksum: compatible.value.checksum,
        current: { relativePath: "world/locations/legacy-capital-record.json" }
      }
    });
    await expect(readFile(legacyPath, "utf8")).resolves.toBe(legacyContent);
    await expect(readFile(canonicalPath, "utf8")).rejects.toThrow();

    const prepared = await repository.prepareStoryAssetCandidate({
      candidate,
      baseRevision: compatible.value.revision,
      baseChecksum: compatible.value.checksum
    });
    expect(prepared).toMatchObject({
      ok: true,
      value: {
        relativePath: "world/loc_legacy_capital.json",
        baseContent: legacyContent,
        baseChecksum: compatible.value.checksum,
        current: { relativePath: "world/loc_legacy_capital.json" }
      }
    });
    await expect(readFile(legacyPath, "utf8")).rejects.toThrow();
    await expect(readFile(canonicalPath, "utf8")).resolves.toBe(legacyContent);
    expect(JSON.parse(await readFile(canonicalPath, "utf8"))).toMatchObject({
      schemaVersion: "1.0",
      id: "loc_legacy_capital"
    });
    await expect(repository.readStoryAssetForAgent("loc_legacy_capital")).resolves.toMatchObject({
      ok: true,
      value: {
        relativePath: "world/loc_legacy_capital.json",
        persistedSchemaVersion: "1.0",
        checksum: compatible.value.checksum
      }
    });

    const upgraded = await repository.saveStoryAssetCandidate({
      candidate,
      baseRevision: compatible.value.revision,
      baseChecksum: compatible.value.checksum
    });
    expect(upgraded).toMatchObject({
      ok: true,
      value: { schemaVersion: "1.1", id: "loc_legacy_capital", revision: 1 }
    });
    expect(historySnapshot).toEqual({
      relativePath: "world/loc_legacy_capital.json",
      baseContent: legacyContent
    });
    await expect(readFile(legacyPath, "utf8")).rejects.toThrow();
    await expect(readFile(canonicalPath, "utf8")).resolves.toContain('"schemaVersion": "1.1"');
    await expect(repository.listStoryBible()).resolves.toMatchObject({
      ok: true,
      value: { items: [{ assetId: "loc_legacy_capital", revision: 1 }] }
    });
  });

  test("rejects recursively stored v1.1 world assets", async () => {
    const projectRoot = await createTempProject();
    const assetId = "loc_11111111111111111111111111111111";
    const canonicalPath = join(projectRoot, "world", `${assetId}.json`);
    const legacyDirectory = join(projectRoot, "world", "locations");
    const repository = new StoryBibleFileRepository({
      projectRoot,
      createAssetId: () => assetId
    });
    const created = await repository.createStoryAsset({
      type: "world.location",
      value: { title: "Strict Capital" }
    });
    expect(created.ok).toBe(true);
    const content = await readFile(canonicalPath, "utf8");
    await mkdir(legacyDirectory, { recursive: true });
    await writeFile(join(legacyDirectory, "old-name.json"), content, "utf8");
    await rm(canonicalPath);

    await expect(repository.readCompatibleStoryAsset(assetId)).resolves.toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_ASSET_INVALID" }
    });
    await expect(repository.listStoryBible()).resolves.toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_ASSET_INVALID" }
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

  test("builds a v1.1 compatibility view without changing the v1.0 file", async () => {
    const projectRoot = await createTempProject();
    const path = join(projectRoot, "characters", "chr_legacy.json");
    const legacy = {
      ...characterAsset(),
      id: "chr_legacy",
      details: { role: "Archivist", legacyDetail: { keep: true } },
      legacyRoot: ["keep"]
    };
    const content = `${JSON.stringify(legacy, null, 2)}\n`;
    await writeFile(path, content, "utf8");
    const repository = new StoryBibleFileRepository({ projectRoot });

    const read = await repository.readCompatibleStoryAsset("chr_legacy");

    expect(read).toMatchObject({
      ok: true,
      value: {
        persistedSchemaVersion: "1.0",
        revision: 0,
        passthroughPresent: true,
        passthroughFieldCount: 2,
        asset: {
          schemaVersion: "1.1",
          id: "chr_legacy",
          revision: 0,
          details: { role: "Archivist" },
          passthrough: {
            rootFields: { legacyRoot: ["keep"] },
            detailFieldsByPointer: { "/legacyDetail": { value: { keep: true } } }
          }
        }
      }
    });
    await expect(readFile(path, "utf8")).resolves.toBe(content);
  });

  test("lazily upgrades v1.0 with checksum CAS and preserves passthrough", async () => {
    const projectRoot = await createTempProject();
    const path = join(projectRoot, "characters", "chr_legacy.json");
    await writeFile(
      path,
      `${JSON.stringify(
        {
          ...characterAsset(),
          id: "chr_legacy",
          details: { role: "Archivist", legacyDetail: "keep" },
          legacyRoot: true
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    const repository = new StoryBibleFileRepository({
      projectRoot,
      now: () => "2026-07-31T01:00:00.000Z"
    });
    const read = await repository.readCompatibleStoryAsset("chr_legacy");
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const candidate = candidateFrom(read.value.asset, { title: "Updated Archivist" });

    const saved = await repository.saveStoryAssetCandidate({
      candidate,
      baseRevision: 0,
      baseChecksum: read.value.checksum
    });

    expect(saved).toMatchObject({
      ok: true,
      value: {
        schemaVersion: "1.1",
        id: "chr_legacy",
        title: "Updated Archivist",
        revision: 1,
        updatedAt: "2026-07-31T01:00:00.000Z",
        passthrough: {
          sourceSchemaVersion: "1.0",
          rootFields: { legacyRoot: true },
          detailFieldsByPointer: { "/legacyDetail": { value: "keep" } }
        }
      }
    });
    const persisted = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    expect(persisted["legacyRoot"]).toBeUndefined();
    expect((persisted["details"] as Record<string, unknown>)["legacyDetail"]).toBeUndefined();
  });

  test("keeps the current asset when the before-write history hook fails", async () => {
    const projectRoot = await createTempProject();
    const path = join(projectRoot, "characters", "chr_legacy.json");
    const before = `${JSON.stringify({ ...characterAsset(), id: "chr_legacy" }, null, 2)}\n`;
    await writeFile(path, before, "utf8");
    const repository = new StoryBibleFileRepository({
      projectRoot,
      beforeStoryAssetCandidateWrite: async () =>
        err(
          storageError({
            code: "STORY_BIBLE_HISTORY_FAILED",
            message: "The Story Bible history snapshot failed.",
            suggestedAction: "Retry the save.",
            traceId: "trace_story_bible_history_failure"
          })
        )
    });
    const read = await repository.readCompatibleStoryAsset("chr_legacy");
    expect(read.ok).toBe(true);
    if (!read.ok) return;

    const saved = await repository.saveStoryAssetCandidate({
      candidate: candidateFrom(read.value.asset, { title: "Not persisted" }),
      baseRevision: read.value.revision,
      baseChecksum: read.value.checksum
    });

    expect(saved).toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_HISTORY_FAILED" }
    });
    await expect(readFile(path, "utf8")).resolves.toBe(before);
  });

  test("rejects passthrough writes and stale legacy checksums without replacing the file", async () => {
    const projectRoot = await createTempProject();
    const path = join(projectRoot, "characters", "chr_legacy.json");
    await writeFile(
      path,
      `${JSON.stringify({ ...characterAsset(), id: "chr_legacy", legacyRoot: true }, null, 2)}\n`,
      "utf8"
    );
    const repository = new StoryBibleFileRepository({ projectRoot });
    const read = await repository.readCompatibleStoryAsset("chr_legacy");
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const before = await readFile(path, "utf8");
    const candidate = candidateFrom(read.value.asset);

    const managedField = await repository.saveStoryAssetCandidate({
      candidate: { ...candidate, passthrough: { forged: true } } as StoryBibleWriteCandidate,
      baseRevision: 0,
      baseChecksum: read.value.checksum
    });
    const stale = await repository.saveStoryAssetCandidate({
      candidate,
      baseRevision: 0,
      baseChecksum: "0".repeat(64)
    });

    expect(managedField).toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_CANDIDATE_INVALID" }
    });
    expect(stale).toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_LEGACY_CHECKSUM_CONFLICT" }
    });
    await expect(readFile(path, "utf8")).resolves.toBe(before);
  });

  test("creates world item and lore assets with v1.1 ids and canonical paths", async () => {
    const projectRoot = await createTempProject();
    const ids = {
      "world.item": "item_11111111111111111111111111111111",
      "world.lore": "lore_22222222222222222222222222222222"
    } as const;
    const repository = new StoryBibleFileRepository({
      projectRoot,
      now: () => "2026-07-31T02:00:00.000Z",
      createAssetId: (type) => ids[type as keyof typeof ids]
    });

    const item = await repository.createStoryAsset({
      type: "world.item",
      value: { title: "Archive Key" }
    });
    const lore = await repository.createStoryAsset({
      type: "world.lore",
      value: { title: "Old Port History", details: { body: "The old port predates the city." } }
    });

    expect(item).toMatchObject({
      ok: true,
      value: { id: ids["world.item"], schemaVersion: "1.1", revision: 1 }
    });
    expect(lore).toMatchObject({
      ok: true,
      value: { id: ids["world.lore"], schemaVersion: "1.1", revision: 1 }
    });
    await expect(
      readFile(join(projectRoot, "world", `${ids["world.item"]}.json`), "utf8")
    ).resolves.toContain('"type": "world.item"');
    await expect(
      readFile(join(projectRoot, "world", `${ids["world.lore"]}.json`), "utf8")
    ).resolves.toContain('"type": "world.lore"');
  });

  test("owns entry revisions for created and manually edited stable outline entries", async () => {
    const projectRoot = await createTempProject();
    const repository = new StoryBibleFileRepository({ projectRoot });
    const volumeId = `vol_${"1".repeat(32)}`;
    const chapterOutlineId = `cho_${"2".repeat(32)}`;
    const firstBeatId = `beat_${"3".repeat(32)}`;
    const secondBeatId = `beat_${"4".repeat(32)}`;
    const created = await repository.createStoryAsset({
      type: "outline",
      knownChapterIds: ["ch_01"],
      value: {
        title: "Main outline",
        details: {
          volumes: [
            {
              volumeId,
              entryRevision: 77,
              title: "Volume one",
              summary: "",
              goals: [],
              chapterIds: ["ch_01"]
            }
          ],
          chapterOutlines: [
            {
              chapterOutlineId,
              chapterId: "ch_01",
              entryRevision: 88,
              goal: "Enter the archive.",
              conflict: "The door is sealed.",
              turningPoint: "The old key turns.",
              notes: "",
              povCharacterId: null,
              characterIds: [],
              locationIds: [],
              foreshadowIds: [],
              beats: [
                {
                  beatId: firstBeatId,
                  entryRevision: 99,
                  title: "Reach the door",
                  purpose: "",
                  result: "",
                  scene: ""
                }
              ],
              expectedStateChanges: [],
              actualOutcome: null,
              deviations: []
            }
          ]
        }
      }
    });
    expect(created).toMatchObject({
      ok: true,
      value: {
        revision: 1,
        details: {
          volumes: [{ volumeId, entryRevision: 1 }],
          chapterOutlines: [
            {
              chapterOutlineId,
              entryRevision: 1,
              beats: [{ beatId: firstBeatId, entryRevision: 1 }]
            }
          ]
        }
      }
    });
    if (!created.ok) return;
    const firstRead = await repository.readCompatibleStoryAsset("outline_main");
    if (!firstRead.ok) return;
    const firstDetails = structuredClone(firstRead.value.asset.details);
    const firstChapter = (firstDetails["chapterOutlines"] as JsonObject[])[0];
    const firstBeat = (firstChapter?.["beats"] as JsonObject[])[0];
    if (firstChapter === undefined || firstBeat === undefined) return;
    firstBeat["title"] = "Open the door";
    (firstChapter["beats"] as JsonObject[]).push({
      beatId: secondBeatId,
      entryRevision: 123,
      title: "Cross the threshold",
      purpose: "",
      result: "",
      scene: ""
    });

    const saved = await repository.saveStoryAssetCandidate({
      candidate: candidateFrom(firstRead.value.asset, { details: firstDetails }),
      baseRevision: firstRead.value.revision,
      baseChecksum: firstRead.value.checksum,
      knownChapterIds: ["ch_01"]
    });

    expect(saved).toMatchObject({
      ok: true,
      value: {
        revision: 2,
        details: {
          volumes: [{ volumeId, entryRevision: 1 }],
          chapterOutlines: [
            {
              chapterOutlineId,
              entryRevision: 1,
              beats: [
                { beatId: firstBeatId, entryRevision: 2 },
                { beatId: secondBeatId, entryRevision: 1 }
              ]
            }
          ]
        }
      }
    });
  });

  test("rejects stale v1.1 revisions and invalid relation targets", async () => {
    const projectRoot = await createTempProject();
    const repository = new StoryBibleFileRepository({
      projectRoot,
      createAssetId: () => "chr_11111111111111111111111111111111"
    });
    const created = await repository.createStoryAsset({
      type: "character",
      value: { title: "Mira" }
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const read = await repository.readCompatibleStoryAsset(created.value.id);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const relation: import("../src/index.js").StoryBibleRelation = {
      relationId: "rel_22222222222222222222222222222222",
      sourceId: created.value.id,
      targetId: "loc_33333333333333333333333333333333",
      relationType: "character.located-in",
      direction: "directed",
      status: "active",
      validFromChapterId: null,
      validToChapterId: null,
      inversePolicy: "derived",
      inverseRelationId: null,
      evidence: [],
      note: ""
    };

    const invalidReference = await repository.saveStoryAssetCandidate({
      candidate: candidateFrom(read.value.asset, { relations: [relation] }),
      baseRevision: 1,
      baseChecksum: read.value.checksum
    });
    const staleRevision = await repository.saveStoryAssetCandidate({
      candidate: candidateFrom(read.value.asset, { title: "Mira Updated" }),
      baseRevision: 0,
      baseChecksum: read.value.checksum
    });

    expect(invalidReference).toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_CANDIDATE_INVALID" }
    });
    expect(staleRevision).toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_REVISION_CONFLICT" }
    });
  });

  test("requires dedicated commands for strict deleted-boundary transitions", async () => {
    const projectRoot = await createTempProject();
    const assetId = "chr_11111111111111111111111111111111";
    const repository = new StoryBibleFileRepository({
      projectRoot,
      createAssetId: () => assetId
    });
    const created = await repository.createStoryAsset({
      type: "character",
      value: { title: "Mira" }
    });
    if (!created.ok) throw new Error(created.error.message);
    const active = await repository.readCompatibleStoryAsset(assetId);
    if (!active.ok) throw new Error(active.error.message);
    const genericDelete = await repository.saveStoryAssetCandidate({
      candidate: candidateFrom(active.value.asset, { status: "deleted" }),
      baseRevision: active.value.revision,
      baseChecksum: active.value.checksum
    });
    const impact = await repository.getStoryBibleReferences(assetId);
    if (!impact.ok) throw new Error(impact.error.message);
    const deleted = await repository.saveStoryAssetStatusTransition({
      candidate: candidateFrom(active.value.asset, { status: "deleted" }),
      baseRevision: active.value.revision,
      baseChecksum: active.value.checksum,
      statusTransition: {
        action: "move-to-deleted",
        expectedDeletionImpactChecksum: impact.value.deletionImpactChecksum
      }
    });
    if (!deleted.ok) throw new Error(deleted.error.message);
    const deletedRead = await repository.readCompatibleStoryAsset(assetId);
    if (!deletedRead.ok) throw new Error(deletedRead.error.message);
    const genericRestore = await repository.saveStoryAssetCandidate({
      candidate: candidateFrom(deletedRead.value.asset, { status: "active" }),
      baseRevision: deletedRead.value.revision,
      baseChecksum: deletedRead.value.checksum
    });
    const restored = await repository.saveStoryAssetStatusTransition({
      candidate: candidateFrom(deletedRead.value.asset, { status: "draft" }),
      baseRevision: deletedRead.value.revision,
      baseChecksum: deletedRead.value.checksum,
      statusTransition: { action: "restore", restoreStatus: "draft" }
    });

    expect(genericDelete).toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_STATUS_TRANSITION_COMMAND_REQUIRED" }
    });
    expect(deleted).toMatchObject({ ok: true, value: { status: "deleted", revision: 2 } });
    expect(genericRestore).toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_STATUS_TRANSITION_COMMAND_REQUIRED" }
    });
    expect(restored).toMatchObject({ ok: true, value: { status: "draft", revision: 3 } });
  });

  test("rejects stale deletion-impact proof without replacing the target", async () => {
    const projectRoot = await createTempProject();
    const assetId = "chr_22222222222222222222222222222222";
    const repository = new StoryBibleFileRepository({
      projectRoot,
      createAssetId: () => assetId
    });
    const created = await repository.createStoryAsset({
      type: "character",
      value: { title: "Mira" }
    });
    if (!created.ok) throw new Error(created.error.message);
    const read = await repository.readCompatibleStoryAsset(assetId);
    const before = await repository.getStoryBibleReferences(assetId);
    if (!read.ok || !before.ok) throw new Error("Expected a readable Story Bible asset.");
    await repository.saveStoryAsset({
      ...(await foreshadowAsset()),
      relatedEntityIds: [assetId]
    });

    const deleted = await repository.saveStoryAssetStatusTransition({
      candidate: candidateFrom(read.value.asset, { status: "deleted" }),
      baseRevision: read.value.revision,
      baseChecksum: read.value.checksum,
      statusTransition: {
        action: "move-to-deleted",
        expectedDeletionImpactChecksum: before.value.deletionImpactChecksum
      }
    });
    const after = await repository.readCompatibleStoryAsset(assetId);

    expect(deleted).toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_DELETION_IMPACT_CHANGED" }
    });
    expect(after).toMatchObject({ ok: true, value: { asset: { status: "active" }, revision: 1 } });
  });

  test("rechecks deletion impact after the before-write hook", async () => {
    const projectRoot = await createTempProject();
    const assetId = "chr_23232323232323232323232323232323";
    const setup = new StoryBibleFileRepository({
      projectRoot,
      createAssetId: () => assetId
    });
    const created = await setup.createStoryAsset({
      type: "character",
      value: { title: "Mira" }
    });
    if (!created.ok) throw new Error(created.error.message);
    const read = await setup.readCompatibleStoryAsset(assetId);
    const impact = await setup.getStoryBibleReferences(assetId);
    if (!read.ok || !impact.ok) throw new Error("Expected a readable Story Bible asset.");
    const repository = new StoryBibleFileRepository({
      projectRoot,
      beforeStoryAssetCandidateWrite: async () => {
        const source = { ...(await foreshadowAsset()), relatedEntityIds: [assetId] };
        await mkdir(join(projectRoot, "foreshadows"), { recursive: true });
        await writeFile(
          join(projectRoot, "foreshadows", `${source.id}.json`),
          `${JSON.stringify(source, null, 2)}\n`,
          "utf8"
        );
        return ok(undefined);
      }
    });

    const deleted = await repository.saveStoryAssetStatusTransition({
      candidate: candidateFrom(read.value.asset, { status: "deleted" }),
      baseRevision: read.value.revision,
      baseChecksum: read.value.checksum,
      statusTransition: {
        action: "move-to-deleted",
        expectedDeletionImpactChecksum: impact.value.deletionImpactChecksum
      }
    });
    const after = await repository.readCompatibleStoryAsset(assetId);

    expect(deleted).toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_DELETION_IMPACT_CHANGED" }
    });
    expect(after).toMatchObject({ ok: true, value: { asset: { status: "active" }, revision: 1 } });
  });

  test("blocks legacy IPC-style creation, deletion, and restoration across deleted", async () => {
    const projectRoot = await createTempProject();
    const repository = new StoryBibleFileRepository({ projectRoot });
    const newDeleted = await repository.saveStoryAsset({
      ...characterAsset(),
      id: "chr_new_deleted",
      status: "deleted"
    });
    await repository.saveStoryAsset(characterAsset());
    const deletedExisting = await repository.saveStoryAsset({
      ...characterAsset(),
      status: "deleted"
    });
    const path = join(projectRoot, "characters", "chr_hero.json");
    await writeFile(
      path,
      `${JSON.stringify({ ...characterAsset(), status: "deleted" }, null, 2)}\n`,
      "utf8"
    );
    const restoredExisting = await repository.saveStoryAsset(characterAsset());

    expect(newDeleted).toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_STATUS_TRANSITION_COMMAND_REQUIRED" }
    });
    expect(deletedExisting).toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_STATUS_TRANSITION_COMMAND_REQUIRED" }
    });
    expect(restoredExisting).toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_STATUS_TRANSITION_COMMAND_REQUIRED" }
    });
  });

  test("rejects missing and mistyped detail references before create", async () => {
    const missingRoot = await createTempProject();
    const missingRepository = new StoryBibleFileRepository({
      projectRoot: missingRoot,
      createAssetId: () => "chr_11111111111111111111111111111111"
    });
    const missing = await missingRepository.createStoryAsset({
      type: "character",
      value: {
        title: "Mira",
        details: {
          currentState: {
            locationId: "loc_22222222222222222222222222222222",
            physical: "",
            emotional: "",
            heldItemIds: [],
            asOfChapterId: null,
            asOfEventId: null
          },
          knowledgeStates: [],
          stateHistory: []
        }
      }
    });

    const mistypedRoot = await createTempProject();
    const characterId = "chr_33333333333333333333333333333333";
    const itemId = "item_44444444444444444444444444444444";
    const mistypedRepository = new StoryBibleFileRepository({
      projectRoot: mistypedRoot,
      createAssetId: (type) => (type === "character" ? characterId : itemId)
    });
    await mistypedRepository.createStoryAsset({ type: "character", value: { title: "Mira" } });
    const mistyped = await mistypedRepository.createStoryAsset({
      type: "world.item",
      value: { title: "Key", details: { currentLocationId: characterId, stateHistory: [] } }
    });

    expect(missing).toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_CANDIDATE_INVALID" }
    });
    expect(mistyped).toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_CANDIDATE_INVALID" }
    });
  });

  test("accepts a typed timeline event target staged in the same consistency group", async () => {
    const projectRoot = await createTempProject();
    const characterId = "chr_11111111111111111111111111111111";
    const eventId = "evt_22222222222222222222222222222222";
    const repository = new StoryBibleFileRepository({
      projectRoot,
      createAssetId: () => characterId
    });
    const input = {
      type: "character" as const,
      knownChapterIds: ["ch_01"],
      value: {
        title: "Mira",
        details: {
          stateHistory: [
            {
              stateHistoryId: "sth_33333333333333333333333333333333",
              entryRevision: 1,
              timelineEventId: eventId,
              chapterId: "ch_01",
              note: "Chapter state"
            }
          ]
        }
      }
    };

    const withoutGroupProof = await repository.prepareCreateStoryAsset(input);
    const withGroupProof = await repository.prepareCreateStoryAsset({
      ...input,
      additionalKnownReferenceTargets: [{ targetId: eventId, targetType: "timeline.event" }]
    });

    expect(withoutGroupProof).toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_CANDIDATE_INVALID" }
    });
    expect(withGroupProof).toMatchObject({ ok: true });
  });

  test("fails closed without a chapter catalog and validates declared chapter references", async () => {
    const projectRoot = await createTempProject();
    const repository = new StoryBibleFileRepository({
      projectRoot,
      createAssetId: () => "chr_11111111111111111111111111111111"
    });
    const input = {
      type: "character" as const,
      value: {
        title: "Mira",
        details: {
          currentState: {
            locationId: null,
            physical: "",
            emotional: "",
            heldItemIds: [],
            asOfChapterId: "ch_01",
            asOfEventId: null
          }
        }
      }
    };

    const withoutCatalog = await repository.prepareCreateStoryAsset(input);
    const withExistingChapter = await repository.prepareCreateStoryAsset({
      ...input,
      knownChapterIds: ["ch_01"]
    });
    const withMissingChapter = await repository.prepareCreateStoryAsset({
      ...input,
      knownChapterIds: ["ch_other"]
    });

    expect(withoutCatalog).toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_CANDIDATE_INVALID" }
    });
    expect(withExistingChapter).toMatchObject({ ok: true });
    expect(withMissingChapter).toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_CANDIDATE_INVALID" }
    });
  });

  test("preserves inherited missing chapter references as warnings but rejects new ones", async () => {
    const projectRoot = await createTempProject();
    const characterId = "chr_11111111111111111111111111111111";
    const repository = new StoryBibleFileRepository({
      projectRoot,
      createAssetId: () => characterId
    });
    const created = await repository.createStoryAsset({
      type: "character",
      value: { title: "Mira" }
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const assetPath = join(projectRoot, "characters", `${characterId}.json`);
    const persisted = JSON.parse(await readFile(assetPath, "utf8")) as JsonObject;
    const details = persisted["details"] as JsonObject;
    const currentState = details["currentState"] as JsonObject;
    currentState["asOfChapterId"] = "ch_missing_one";
    await writeFile(assetPath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");

    const read = await repository.readCompatibleStoryAsset(characterId);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const saved = await repository.saveStoryAssetCandidate({
      candidate: candidateFrom(read.value.asset, { title: "Mira Updated" }),
      baseRevision: read.value.revision,
      baseChecksum: read.value.checksum,
      knownChapterIds: ["ch_existing"]
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const impact = await repository.getStoryBibleReferences(characterId, ["ch_existing"]);
    expect(impact).toMatchObject({
      ok: true,
      value: {
        outgoing: [
          expect.objectContaining({
            targetAssetId: "ch_missing_one",
            path: "/details/currentState/asOfChapterId",
            integrity: "missing",
            expectedTargetTypes: ["chapter"],
            warnings: [expect.objectContaining({ code: "chapter-missing" })]
          })
        ]
      }
    });

    const reread = await repository.readCompatibleStoryAsset(characterId);
    expect(reread.ok).toBe(true);
    if (!reread.ok) return;
    const nextDetails = structuredClone(reread.value.asset.details);
    nextDetails["knowledgeStates"] = [
      {
        knowledgeStateId: "knw_22222222222222222222222222222222",
        entryRevision: 1,
        subject: "Archive oath",
        state: "known",
        sourceChapterId: "ch_missing_two",
        validFromChapterId: null,
        validToChapterId: null,
        note: ""
      }
    ];
    const newlyInvalid = await repository.saveStoryAssetCandidate({
      candidate: candidateFrom(reread.value.asset, { details: nextDetails }),
      baseRevision: reread.value.revision,
      baseChecksum: reread.value.checksum,
      knownChapterIds: ["ch_existing"]
    });
    expect(newlyInvalid).toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_CANDIDATE_INVALID" }
    });
  });

  test("preserves inherited missing references as warnings but rejects newly added ones", async () => {
    const projectRoot = await createTempProject();
    const characterId = "chr_11111111111111111111111111111111";
    const missingLocationId = "loc_22222222222222222222222222222222";
    const missingItemId = "item_33333333333333333333333333333333";
    const repository = new StoryBibleFileRepository({
      projectRoot,
      createAssetId: () => characterId
    });
    const created = await repository.createStoryAsset({
      type: "character",
      value: { title: "Mira" }
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const assetPath = join(projectRoot, "characters", `${characterId}.json`);
    const persisted = JSON.parse(await readFile(assetPath, "utf8")) as JsonObject;
    const details = persisted["details"] as JsonObject;
    const currentState = details["currentState"] as JsonObject;
    currentState["locationId"] = missingLocationId;
    await writeFile(assetPath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");

    const read = await repository.readCompatibleStoryAsset(characterId);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const saved = await repository.saveStoryAssetCandidate({
      candidate: candidateFrom(read.value.asset, { title: "Mira Updated" }),
      baseRevision: read.value.revision,
      baseChecksum: read.value.checksum
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const impact = await repository.getStoryBibleReferences(characterId);
    expect(impact).toMatchObject({
      ok: true,
      value: {
        outgoing: [
          expect.objectContaining({
            targetAssetId: missingLocationId,
            integrity: "missing",
            expectedTargetTypes: ["world.location"],
            warnings: [expect.objectContaining({ code: "target-missing" })]
          })
        ]
      }
    });

    const reread = await repository.readCompatibleStoryAsset(characterId);
    expect(reread.ok).toBe(true);
    if (!reread.ok) return;
    const nextDetails = structuredClone(reread.value.asset.details);
    const nextState = nextDetails["currentState"] as JsonObject;
    nextState["heldItemIds"] = [missingItemId];
    const newlyInvalid = await repository.saveStoryAssetCandidate({
      candidate: candidateFrom(reread.value.asset, { details: nextDetails }),
      baseRevision: reread.value.revision,
      baseChecksum: reread.value.checksum
    });
    expect(newlyInvalid).toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_CANDIDATE_INVALID" }
    });
  });

  test("enforces project-unique relation IDs and reciprocal explicit inverses", async () => {
    const projectRoot = await createTempProject();
    const characterId = "chr_11111111111111111111111111111111";
    const secondCharacterId = "chr_22222222222222222222222222222222";
    const locationId = "loc_33333333333333333333333333333333";
    const relationId = "rel_44444444444444444444444444444444";
    const inverseRelationId = "rel_55555555555555555555555555555555";
    let characterCount = 0;
    const repository = new StoryBibleFileRepository({
      projectRoot,
      createAssetId: (type) => {
        if (type === "world.location") return locationId;
        characterCount += 1;
        return characterCount === 1 ? characterId : secondCharacterId;
      }
    });
    await repository.createStoryAsset({ type: "world.location", value: { title: "Archive" } });
    const first = await repository.createStoryAsset({
      type: "character",
      value: {
        title: "Mira",
        relations: [directedRelation({ relationId, sourceId: "server", targetId: locationId })]
      }
    });
    expect(first.ok).toBe(true);
    const duplicate = await repository.createStoryAsset({
      type: "character",
      value: {
        title: "Nia",
        relations: [directedRelation({ relationId, sourceId: "server", targetId: locationId })]
      }
    });
    expect(duplicate).toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_CANDIDATE_INVALID" }
    });

    const characterPath = join(projectRoot, "characters", `${characterId}.json`);
    const locationPath = join(projectRoot, "world", `${locationId}.json`);
    const character = JSON.parse(await readFile(characterPath, "utf8")) as JsonObject;
    const location = JSON.parse(await readFile(locationPath, "utf8")) as JsonObject;
    character["relations"] = [
      directedRelation({
        relationId,
        sourceId: characterId,
        targetId: locationId,
        inversePolicy: "explicit",
        inverseRelationId
      })
    ];
    location["relations"] = [
      directedRelation({
        relationId: inverseRelationId,
        sourceId: locationId,
        targetId: characterId,
        relationType: "world.contains-character",
        inversePolicy: "explicit",
        inverseRelationId: relationId
      })
    ];
    await writeFile(characterPath, `${JSON.stringify(character, null, 2)}\n`, "utf8");
    const inheritedInverseWarning = await repository.getStoryBibleReferences(characterId);
    expect(inheritedInverseWarning).toMatchObject({
      ok: true,
      value: {
        outgoing: [
          expect.objectContaining({
            relationId,
            warnings: [expect.objectContaining({ code: "explicit-inverse-invalid" })]
          })
        ]
      }
    });
    await writeFile(locationPath, `${JSON.stringify(location, null, 2)}\n`, "utf8");

    const read = await repository.readCompatibleStoryAsset(characterId);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const unchangedPair = await repository.prepareStoryAssetCandidate({
      candidate: candidateFrom(read.value.asset, { title: "Mira Updated" }),
      baseRevision: read.value.revision,
      baseChecksum: read.value.checksum
    });
    expect(unchangedPair.ok).toBe(true);

    const inconsistentRelations = structuredClone(read.value.asset.relations);
    const currentRelation = inconsistentRelations[0];
    expect(currentRelation).toBeDefined();
    if (currentRelation === undefined) return;
    inconsistentRelations[0] = { ...currentRelation, status: "ended" };
    const inconsistentPair = await repository.prepareStoryAssetCandidate({
      candidate: candidateFrom(read.value.asset, { relations: inconsistentRelations }),
      baseRevision: read.value.revision,
      baseChecksum: read.value.checksum
    });
    expect(inconsistentPair).toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_CANDIDATE_INVALID" }
    });
  });

  test("defers only explicit-inverse pair checks for application-owned consistency groups", async () => {
    const projectRoot = await createTempProject();
    const characterId = "chr_11111111111111111111111111111111";
    const locationId = "loc_22222222222222222222222222222222";
    const relationId = "rel_33333333333333333333333333333333";
    const inverseRelationId = "rel_44444444444444444444444444444444";
    const duplicateRelationId = "rel_55555555555555555555555555555555";
    const repository = new StoryBibleFileRepository({ projectRoot });
    const character = await repository.createStoryAsset({
      type: "character",
      reservedAssetId: characterId,
      value: { title: "Mira" }
    });
    const location = await repository.createStoryAsset({
      type: "world.location",
      reservedAssetId: locationId,
      value: { title: "Archive" }
    });
    expect(character.ok && location.ok).toBe(true);
    if (!character.ok || !location.ok) return;
    const characterRead = await repository.readCompatibleStoryAsset(characterId);
    expect(characterRead.ok).toBe(true);
    if (!characterRead.ok) return;
    const explicitRelation = directedRelation({
      relationId,
      sourceId: characterId,
      targetId: locationId,
      inversePolicy: "explicit",
      inverseRelationId
    });

    const strict = await repository.prepareStoryAssetCandidate({
      candidate: candidateFrom(characterRead.value.asset, { relations: [explicitRelation] }),
      baseRevision: characterRead.value.revision,
      baseChecksum: characterRead.value.checksum
    });
    const deferred = await repository.prepareStoryAssetCandidate({
      candidate: candidateFrom(characterRead.value.asset, { relations: [explicitRelation] }),
      baseRevision: characterRead.value.revision,
      baseChecksum: characterRead.value.checksum,
      deferProjectRelationPairValidation: true
    });
    expect(strict).toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_CANDIDATE_INVALID" }
    });
    expect(deferred).toMatchObject({ ok: true });
    await expect(
      repository.saveStoryAssetCandidate({
        candidate: candidateFrom(characterRead.value.asset, { relations: [explicitRelation] }),
        baseRevision: characterRead.value.revision,
        baseChecksum: characterRead.value.checksum,
        deferProjectRelationPairValidation: true
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_CANDIDATE_INVALID" }
    });
    await expect(
      repository.createStoryAsset({
        type: "character",
        reservedAssetId: "chr_66666666666666666666666666666666",
        deferProjectRelationPairValidation: true,
        value: {
          title: "Nia",
          relations: [
            directedRelation({
              relationId: "rel_77777777777777777777777777777777",
              sourceId: "server-owned",
              targetId: locationId,
              inversePolicy: "explicit",
              inverseRelationId: "rel_88888888888888888888888888888888"
            })
          ]
        }
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_CANDIDATE_INVALID" }
    });

    const locationRead = await repository.readCompatibleStoryAsset(locationId);
    expect(locationRead.ok).toBe(true);
    if (!locationRead.ok) return;
    const savedLocation = await repository.saveStoryAssetCandidate({
      candidate: candidateFrom(locationRead.value.asset, {
        relations: [
          directedRelation({
            relationId: duplicateRelationId,
            sourceId: locationId,
            targetId: characterId
          })
        ]
      }),
      baseRevision: locationRead.value.revision,
      baseChecksum: locationRead.value.checksum
    });
    expect(savedLocation.ok).toBe(true);
    const duplicate = await repository.prepareStoryAssetCandidate({
      candidate: candidateFrom(characterRead.value.asset, {
        relations: [
          directedRelation({
            relationId: duplicateRelationId,
            sourceId: characterId,
            targetId: locationId,
            inversePolicy: "explicit",
            inverseRelationId
          })
        ]
      }),
      baseRevision: characterRead.value.revision,
      baseChecksum: characterRead.value.checksum,
      deferProjectRelationPairValidation: true
    });
    expect(duplicate).toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_CANDIDATE_INVALID" }
    });
    expect(JSON.stringify(duplicate)).toContain("uniqueRelationId");
  });

  test("validates a complete explicit-inverse create group and rejects either half alone", async () => {
    const projectRoot = await createTempProject();
    const repository = new StoryBibleFileRepository({ projectRoot });
    const pair = await prepareExplicitRelationCreatePair(repository);
    expect(pair.character.relativePath).toBe(`characters/${pair.character.asset.id}.json`);
    expect(pair.location.relativePath).toBe(`world/${pair.location.asset.id}.json`);

    await expect(
      repository.validateStoryBibleCandidateGroup({ candidates: storyBibleGroupCandidates(pair) })
    ).resolves.toEqual({ ok: true, value: undefined });
    const missingInverse = await repository.validateStoryBibleCandidateGroup({
      candidates: storyBibleGroupCandidates(pair).slice(0, 1)
    });
    expect(missingInverse).toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_CANDIDATE_INVALID" }
    });

    const persistedTargetRoot = await createTempProject();
    const persistedTargetRepository = new StoryBibleFileRepository({
      projectRoot: persistedTargetRoot
    });
    const persistedLocation = await persistedTargetRepository.createStoryAsset({
      type: "world.location",
      reservedAssetId: pair.location.asset.id,
      value: { title: "Archive" }
    });
    expect(persistedLocation.ok).toBe(true);
    const oneSidedCharacter = await persistedTargetRepository.prepareCreateStoryAsset({
      type: "character",
      reservedAssetId: pair.character.asset.id,
      deferProjectRelationPairValidation: true,
      value: {
        title: "Mira",
        relations: pair.character.asset.relations
      }
    });
    expect(oneSidedCharacter.ok).toBe(true);
    if (!oneSidedCharacter.ok) return;
    const explicitInverseMissing = await persistedTargetRepository.validateStoryBibleCandidateGroup(
      {
        candidates: [
          {
            relativePath: oneSidedCharacter.value.relativePath,
            candidateContent: oneSidedCharacter.value.content
          }
        ]
      }
    );
    expect(JSON.stringify(explicitInverseMissing)).toContain("explicitInverse");
  });

  test("accepts atomic status and validity updates to both sides of an explicit inverse", async () => {
    const projectRoot = await createTempProject();
    const repository = new StoryBibleFileRepository({ projectRoot });
    const pair = await prepareExplicitRelationCreatePair(repository);
    for (const candidate of storyBibleGroupCandidates(pair)) {
      await writeFile(
        join(projectRoot, candidate.relativePath),
        candidate.candidateContent,
        "utf8"
      );
    }
    const characterRead = await repository.readCompatibleStoryAsset(pair.character.asset.id);
    const locationRead = await repository.readCompatibleStoryAsset(pair.location.asset.id);
    expect(characterRead.ok && locationRead.ok).toBe(true);
    if (!characterRead.ok || !locationRead.ok) return;
    const updateRelations = (relations: readonly import("../src/index.js").StoryBibleRelation[]) =>
      relations.map((relation) => ({
        ...relation,
        status: "ended" as const,
        validFromChapterId: "ch_01",
        validToChapterId: "ch_02"
      }));
    const characterUpdate = await repository.prepareStoryAssetCandidate({
      candidate: candidateFrom(characterRead.value.asset, {
        relations: updateRelations(characterRead.value.asset.relations)
      }),
      baseRevision: characterRead.value.revision,
      baseChecksum: characterRead.value.checksum,
      knownChapterIds: ["ch_01", "ch_02"],
      deferProjectRelationPairValidation: true
    });
    const locationUpdate = await repository.prepareStoryAssetCandidate({
      candidate: candidateFrom(locationRead.value.asset, {
        relations: updateRelations(locationRead.value.asset.relations)
      }),
      baseRevision: locationRead.value.revision,
      baseChecksum: locationRead.value.checksum,
      knownChapterIds: ["ch_01", "ch_02"],
      deferProjectRelationPairValidation: true
    });
    expect(characterUpdate.ok && locationUpdate.ok).toBe(true);
    if (!characterUpdate.ok || !locationUpdate.ok) return;

    await expect(
      repository.validateStoryBibleCandidateGroup({
        candidates: [
          {
            relativePath: characterUpdate.value.relativePath,
            candidateContent: characterUpdate.value.content
          },
          {
            relativePath: locationUpdate.value.relativePath,
            candidateContent: locationUpdate.value.content
          }
        ],
        knownChapterIds: ["ch_01", "ch_02"]
      })
    ).resolves.toEqual({ ok: true, value: undefined });
  });

  test("rejects malformed explicit-inverse pairs in the final group projection", async () => {
    const projectRoot = await createTempProject();
    const repository = new StoryBibleFileRepository({ projectRoot });
    const pair = await prepareExplicitRelationCreatePair(repository);
    const thirdRelationId = "rel_55555555555555555555555555555555";
    const cases: readonly {
      readonly name: string;
      readonly mutate: (assets: JsonObject[]) => void;
      readonly keyword: string;
    }[] = [
      {
        name: "non-reciprocal inverse ids",
        mutate: (assets) => {
          const relation = (assets[1]?.["relations"] as JsonObject[] | undefined)?.[0];
          if (relation !== undefined) relation["inverseRelationId"] = thirdRelationId;
        },
        keyword: "explicitInverse"
      },
      {
        name: "endpoints that are not reversed",
        mutate: (assets) => {
          const relation = (assets[1]?.["relations"] as JsonObject[] | undefined)?.[0];
          if (relation !== undefined) relation["targetId"] = pair.location.asset.id;
        },
        keyword: "explicitInverse"
      },
      {
        name: "different statuses",
        mutate: (assets) => {
          const relation = (assets[1]?.["relations"] as JsonObject[] | undefined)?.[0];
          if (relation !== undefined) relation["status"] = "ended";
        },
        keyword: "inverseConsistency"
      },
      {
        name: "different valid-from chapters",
        mutate: (assets) => {
          const relation = (assets[1]?.["relations"] as JsonObject[] | undefined)?.[0];
          if (relation !== undefined) relation["validFromChapterId"] = "ch_01";
        },
        keyword: "inverseConsistency"
      },
      {
        name: "different valid-to chapters",
        mutate: (assets) => {
          const relation = (assets[1]?.["relations"] as JsonObject[] | undefined)?.[0];
          if (relation !== undefined) relation["validToChapterId"] = "ch_02";
        },
        keyword: "inverseConsistency"
      }
    ];

    for (const testCase of cases) {
      const assets = [
        structuredClone(pair.character.asset) as JsonObject,
        structuredClone(pair.location.asset) as JsonObject
      ];
      testCase.mutate(assets);
      const result = await repository.validateStoryBibleCandidateGroup({
        candidates: [
          {
            relativePath: pair.character.relativePath,
            candidateContent: `${JSON.stringify(assets[0], null, 2)}\n`
          },
          {
            relativePath: pair.location.relativePath,
            candidateContent: `${JSON.stringify(assets[1], null, 2)}\n`
          }
        ],
        knownChapterIds: ["ch_01", "ch_02"]
      });
      expect(result, testCase.name).toMatchObject({
        ok: false,
        error: { code: "STORY_BIBLE_CANDIDATE_INVALID" }
      });
      expect(JSON.stringify(result), testCase.name).toContain(testCase.keyword);
    }
  });

  test("rejects duplicate relations, malformed group entries, and path or identity mismatches", async () => {
    const projectRoot = await createTempProject();
    const repository = new StoryBibleFileRepository({ projectRoot });
    const pair = await prepareExplicitRelationCreatePair(repository);
    const candidates = storyBibleGroupCandidates(pair);
    const characterAsset = structuredClone(pair.character.asset) as JsonObject;
    const locationAsset = structuredClone(pair.location.asset) as JsonObject;
    const characterRelation = (characterAsset["relations"] as JsonObject[])[0];
    const locationRelation = (locationAsset["relations"] as JsonObject[])[0];
    expect(characterRelation && locationRelation).toBeDefined();
    if (characterRelation === undefined || locationRelation === undefined) return;
    characterRelation["inversePolicy"] = "derived";
    characterRelation["inverseRelationId"] = null;
    locationRelation["relationId"] = characterRelation["relationId"] as string;
    locationRelation["inversePolicy"] = "derived";
    locationRelation["inverseRelationId"] = null;
    const duplicateRelation = await repository.validateStoryBibleCandidateGroup({
      candidates: [
        {
          relativePath: pair.character.relativePath,
          candidateContent: `${JSON.stringify(characterAsset, null, 2)}\n`
        },
        {
          relativePath: pair.location.relativePath,
          candidateContent: `${JSON.stringify(locationAsset, null, 2)}\n`
        }
      ]
    });
    expect(JSON.stringify(duplicateRelation)).toContain("uniqueRelationId");

    const baselineCharacterId = "chr_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const baselineLocationId = "loc_cccccccccccccccccccccccccccccccc";
    const pairRelationId = pair.character.asset.relations[0]?.relationId;
    expect(pairRelationId).toBeDefined();
    if (pairRelationId === undefined) return;
    const baselineCharacter = await repository.createStoryAsset({
      type: "character",
      reservedAssetId: baselineCharacterId,
      value: { title: "Baseline Character" }
    });
    const baselineLocation = await repository.createStoryAsset({
      type: "world.location",
      reservedAssetId: baselineLocationId,
      value: {
        title: "Baseline Location",
        relations: [
          directedRelation({
            relationId: pairRelationId,
            sourceId: baselineLocationId,
            targetId: baselineCharacterId
          })
        ]
      }
    });
    expect(baselineCharacter.ok && baselineLocation.ok).toBe(true);
    const projectDuplicate = await repository.validateStoryBibleCandidateGroup({
      candidates: storyBibleGroupCandidates(pair)
    });
    expect(JSON.stringify(projectDuplicate)).toContain("uniqueRelationId");

    const changedIdAsset = structuredClone(pair.character.asset) as JsonObject;
    changedIdAsset["id"] = "chr_66666666666666666666666666666666";
    changedIdAsset["relations"] = [];
    const [firstCandidate, secondCandidate] = candidates;
    expect(firstCandidate && secondCandidate).toBeDefined();
    if (firstCandidate === undefined || secondCandidate === undefined) return;
    const invalidResults = await Promise.all([
      repository.validateStoryBibleCandidateGroup({ candidates: [] }),
      repository.validateStoryBibleCandidateGroup({
        candidates: [{ relativePath: pair.character.relativePath, candidateContent: "{" }]
      }),
      repository.validateStoryBibleCandidateGroup({
        candidates: [
          {
            relativePath: pair.character.relativePath,
            candidateContent: `${JSON.stringify({ ...pair.character.asset, schemaVersion: "1.0" })}\n`
          }
        ]
      }),
      repository.validateStoryBibleCandidateGroup({
        candidates: [{ ...firstCandidate, relativePath: pair.location.relativePath }]
      }),
      repository.validateStoryBibleCandidateGroup({
        candidates: [
          firstCandidate,
          { ...secondCandidate, relativePath: firstCandidate.relativePath }
        ]
      }),
      repository.validateStoryBibleCandidateGroup({
        candidates: [
          firstCandidate,
          { ...secondCandidate, candidateContent: firstCandidate.candidateContent }
        ]
      }),
      repository.validateStoryBibleCandidateGroup({
        candidates: [
          {
            relativePath: pair.character.relativePath,
            candidateContent: `${JSON.stringify(changedIdAsset, null, 2)}\n`
          }
        ]
      }),
      repository.validateStoryBibleCandidateGroup({
        candidates: [
          {
            relativePath: pair.character.relativePath,
            candidateContent: pair.location.content
          }
        ]
      })
    ]);
    for (const result of invalidResults) {
      expect(result).toMatchObject({
        ok: false,
        error: { code: "STORY_BIBLE_CANDIDATE_INVALID" }
      });
    }
  });

  test("validates references against final asset and timeline-event targets", async () => {
    const projectRoot = await createTempProject();
    const repository = new StoryBibleFileRepository({ projectRoot });
    const pair = await prepareExplicitRelationCreatePair(repository);
    const missingAsset = structuredClone(pair.character.asset) as JsonObject;
    const missingDetails = missingAsset["details"] as JsonObject;
    const missingState = missingDetails["currentState"] as JsonObject;
    missingState["locationId"] = "loc_77777777777777777777777777777777";
    const mistypedAsset = structuredClone(pair.character.asset) as JsonObject;
    const mistypedDetails = mistypedAsset["details"] as JsonObject;
    const mistypedState = mistypedDetails["currentState"] as JsonObject;
    mistypedState["locationId"] = pair.character.asset.id;

    for (const invalidAsset of [missingAsset, mistypedAsset]) {
      const result = await repository.validateStoryBibleCandidateGroup({
        candidates: [
          {
            relativePath: pair.character.relativePath,
            candidateContent: `${JSON.stringify(invalidAsset, null, 2)}\n`
          },
          {
            relativePath: pair.location.relativePath,
            candidateContent: pair.location.content
          }
        ]
      });
      expect(result).toMatchObject({
        ok: false,
        error: { code: "STORY_BIBLE_CANDIDATE_INVALID" }
      });
    }

    const characterId = "chr_88888888888888888888888888888888";
    const eventId = "evt_99999999999999999999999999999999";
    const timeline = await repository.prepareCreateStoryAsset({
      type: "timeline.events",
      reservedAssetId: "timeline_main",
      value: {
        title: "Timeline",
        details: {
          events: [
            {
              eventId,
              entryRevision: 1,
              title: "Arrival",
              sequence: 1,
              time: { mode: "sequence-only", label: "", uncertain: false },
              summary: "Mira arrives.",
              chapterIds: [],
              characterIds: [],
              locationIds: [],
              parallelEventIds: [],
              causes: [],
              effects: [],
              stateChanges: []
            }
          ]
        }
      }
    });
    const character = await repository.prepareCreateStoryAsset({
      type: "character",
      reservedAssetId: characterId,
      additionalKnownReferenceTargets: [{ targetId: eventId, targetType: "timeline.event" }],
      value: {
        title: "Mira",
        details: {
          stateHistory: [
            {
              stateHistoryId: "sth_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              entryRevision: 1,
              timelineEventId: eventId,
              chapterId: null,
              note: "Arrival state"
            }
          ]
        }
      }
    });
    expect(timeline.ok && character.ok).toBe(true);
    if (!timeline.ok || !character.ok) return;
    await expect(
      repository.validateStoryBibleCandidateGroup({
        candidates: [
          { relativePath: timeline.value.relativePath, candidateContent: timeline.value.content },
          { relativePath: character.value.relativePath, candidateContent: character.value.content }
        ]
      })
    ).resolves.toEqual({ ok: true, value: undefined });
  });

  test("inherits unchanged bad references in a group but rejects newly introduced ones", async () => {
    const projectRoot = await createTempProject();
    const characterId = "chr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const repository = new StoryBibleFileRepository({ projectRoot });
    const created = await repository.createStoryAsset({
      type: "character",
      reservedAssetId: characterId,
      value: { title: "Mira" }
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const path = join(projectRoot, "characters", `${characterId}.json`);
    const persisted = JSON.parse(await readFile(path, "utf8")) as JsonObject;
    const persistedDetails = persisted["details"] as JsonObject;
    const persistedState = persistedDetails["currentState"] as JsonObject;
    persistedState["locationId"] = "loc_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    persistedState["asOfChapterId"] = "ch_missing_old";
    await writeFile(path, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");

    const read = await repository.readCompatibleStoryAsset(characterId);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const prepared = await repository.prepareStoryAssetCandidate({
      candidate: candidateFrom(read.value.asset, { title: "Mira Updated" }),
      baseRevision: read.value.revision,
      baseChecksum: read.value.checksum,
      knownChapterIds: ["ch_existing"]
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    await expect(
      repository.validateStoryBibleCandidateGroup({
        candidates: [
          {
            relativePath: prepared.value.relativePath,
            candidateContent: prepared.value.content
          }
        ],
        knownChapterIds: ["ch_existing"]
      })
    ).resolves.toEqual({ ok: true, value: undefined });

    const newBadReference = JSON.parse(prepared.value.content) as JsonObject;
    const badReferenceDetails = newBadReference["details"] as JsonObject;
    const badReferenceState = badReferenceDetails["currentState"] as JsonObject;
    badReferenceState["heldItemIds"] = ["item_cccccccccccccccccccccccccccccccc"];
    const newBadChapter = JSON.parse(prepared.value.content) as JsonObject;
    const badChapterDetails = newBadChapter["details"] as JsonObject;
    const badChapterState = badChapterDetails["currentState"] as JsonObject;
    badChapterState["asOfChapterId"] = "ch_missing_new";
    const invalidResults = await Promise.all(
      [newBadReference, newBadChapter].map((asset) =>
        repository.validateStoryBibleCandidateGroup({
          candidates: [
            {
              relativePath: prepared.value.relativePath,
              candidateContent: `${JSON.stringify(asset, null, 2)}\n`
            }
          ],
          knownChapterIds: ["ch_existing"]
        })
      )
    );
    for (const result of invalidResults) {
      expect(result).toMatchObject({
        ok: false,
        error: { code: "STORY_BIBLE_CANDIDATE_INVALID" }
      });
    }
  });

  test("allows only registered or unchanged extension namespaces", async () => {
    const projectRoot = await createTempProject();
    const id = "lore_11111111111111111111111111111111";
    const registered = new StoryBibleFileRepository({
      projectRoot,
      createAssetId: () => id,
      registeredExtensionNamespaces: new Set(["com.example.notes"])
    });
    const created = await registered.createStoryAsset({
      type: "world.lore",
      value: {
        title: "Old Port",
        extensions: { "com.example.notes": { source: "author" } }
      }
    });
    expect(created.ok).toBe(true);

    const unregistered = new StoryBibleFileRepository({ projectRoot });
    const read = await unregistered.readCompatibleStoryAsset(id);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const unchanged = await unregistered.saveStoryAssetCandidate({
      candidate: candidateFrom(read.value.asset, { title: "Old Port History" }),
      baseRevision: 1,
      baseChecksum: read.value.checksum
    });
    expect(unchanged.ok).toBe(true);
    if (!unchanged.ok) return;
    const reread = await unregistered.readCompatibleStoryAsset(id);
    expect(reread.ok).toBe(true);
    if (!reread.ok) return;
    const changed = await unregistered.saveStoryAssetCandidate({
      candidate: candidateFrom(reread.value.asset, {
        extensions: { "com.example.notes": { source: "agent" } }
      }),
      baseRevision: 2,
      baseChecksum: reread.value.checksum
    });

    expect(changed).toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_CANDIDATE_INVALID" }
    });
  });

  test("lists every Story Bible asset with stable cursor pagination and query filters", async () => {
    const projectRoot = await createTempProject();
    const ids = {
      character: "chr_11111111111111111111111111111111",
      "world.location": "loc_22222222222222222222222222222222",
      "world.lore": "lore_33333333333333333333333333333333"
    } as const;
    const repository = new StoryBibleFileRepository({
      projectRoot,
      createAssetId: (type) => ids[type as keyof typeof ids]
    });
    await repository.createStoryAsset({
      type: "world.location",
      value: { title: "旧港", summary: "雾中的港口" }
    });
    await repository.createStoryAsset({
      type: "character",
      value: { title: "林砚", aliases: ["阿砚"], details: { role: "记者" } }
    });
    await repository.createStoryAsset({
      type: "world.lore",
      value: { title: "旧港沿革", details: { body: "旧港建立于大潮之前。" } }
    });

    const first = await repository.listStoryBible({ limit: 2 });
    expect(first).toMatchObject({
      ok: true,
      value: {
        items: [
          { assetId: ids.character, type: "character", revision: 1 },
          { assetId: ids["world.location"], type: "world.location", revision: 1 }
        ]
      }
    });
    expect(first.ok && first.value.nextCursor).toEqual(expect.any(String));
    if (!first.ok || first.value.nextCursor === null) return;

    const second = await repository.listStoryBible({ cursor: first.value.nextCursor, limit: 2 });
    expect(second).toMatchObject({
      ok: true,
      value: {
        indexRevision: first.value.indexRevision,
        nextCursor: null,
        items: [{ assetId: ids["world.lore"], type: "world.lore" }]
      }
    });
    const queried = await repository.listStoryBible({
      types: ["character", "world.lore"],
      statuses: ["active"],
      query: "大潮"
    });
    expect(queried).toMatchObject({
      ok: true,
      value: { items: [{ assetId: ids["world.lore"] }] }
    });
  });

  test("rejects a pagination cursor after the Story Bible index changes", async () => {
    const projectRoot = await createTempProject();
    const repository = new StoryBibleFileRepository({
      projectRoot,
      createAssetId: (type) =>
        type === "character"
          ? "chr_11111111111111111111111111111111"
          : "loc_22222222222222222222222222222222"
    });
    const created = await repository.createStoryAsset({
      type: "character",
      value: { title: "林砚" }
    });
    await repository.createStoryAsset({ type: "world.location", value: { title: "旧港" } });
    expect(created.ok).toBe(true);
    const first = await repository.listStoryBible({ limit: 1 });
    expect(first.ok).toBe(true);
    if (!created.ok || !first.ok || first.value.nextCursor === null) return;

    const read = await repository.readCompatibleStoryAsset(created.value.id);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    await repository.saveStoryAssetCandidate({
      candidate: candidateFrom(read.value.asset, { title: "林砚（更新）" }),
      baseRevision: read.value.revision,
      baseChecksum: read.value.checksum
    });

    await expect(
      repository.listStoryBible({ cursor: first.value.nextCursor, limit: 1 })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_CURSOR_STALE" }
    });
  });

  test("returns an Agent-safe asset view without passthrough or unregistered extensions", async () => {
    const projectRoot = await createTempProject();
    const path = join(projectRoot, "characters", "chr_legacy.json");
    await writeFile(
      path,
      `${JSON.stringify(
        {
          ...characterAsset(),
          id: "chr_legacy",
          details: { role: "Archivist", legacySecret: "must-not-leak" },
          legacyRoot: { secret: "must-not-leak" }
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    const upgradeRepository = new StoryBibleFileRepository({
      projectRoot,
      registeredExtensionNamespaces: new Set(["com.example.visible", "com.example.hidden"])
    });
    const legacy = await upgradeRepository.readCompatibleStoryAsset("chr_legacy");
    expect(legacy.ok).toBe(true);
    if (!legacy.ok) return;
    const upgraded = await upgradeRepository.saveStoryAssetCandidate({
      candidate: candidateFrom(legacy.value.asset, {
        extensions: {
          "com.example.visible": { note: "visible" },
          "com.example.hidden": { secret: "hidden" }
        }
      }),
      baseRevision: 0,
      baseChecksum: legacy.value.checksum
    });
    expect(upgraded.ok).toBe(true);
    const repository = new StoryBibleFileRepository({
      projectRoot,
      registeredExtensionNamespaces: new Set(["com.example.visible"])
    });

    const read = await repository.readStoryAssetForAgent("chr_legacy");

    expect(read).toMatchObject({
      ok: true,
      value: {
        revision: 1,
        asset: {
          id: "chr_legacy",
          extensions: { "com.example.visible": { note: "visible" } }
        },
        passthrough: {
          present: true,
          sourceSchemaVersion: "1.0",
          fieldCount: 2,
          rootFieldNames: ["legacyRoot"],
          detailPointers: ["/legacySecret"]
        }
      }
    });
    if (!read.ok) return;
    expect(JSON.stringify(read.value)).not.toContain("must-not-leak");
    expect(JSON.stringify(read.value)).not.toContain("com.example.hidden");
    expect(read.value.asset).not.toHaveProperty("passthrough");
  });

  test("reports incoming, outgoing, and soft-delete reference impact", async () => {
    const projectRoot = await createTempProject();
    const characterId = "chr_11111111111111111111111111111111";
    const locationId = "loc_22222222222222222222222222222222";
    const repository = new StoryBibleFileRepository({
      projectRoot,
      createAssetId: (type) => (type === "character" ? characterId : locationId)
    });
    await repository.createStoryAsset({ type: "world.location", value: { title: "旧港" } });
    await repository.createStoryAsset({
      type: "character",
      value: {
        title: "林砚",
        relations: [
          {
            relationId: "rel_33333333333333333333333333333333",
            sourceId: "server-owned-on-create",
            targetId: locationId,
            relationType: "character.located-in",
            direction: "directed",
            status: "active",
            validFromChapterId: null,
            validToChapterId: null,
            inversePolicy: "derived",
            inverseRelationId: null,
            evidence: [],
            note: ""
          }
        ],
        details: {
          currentState: {
            locationId,
            physical: "",
            emotional: "",
            heldItemIds: [],
            asOfChapterId: null,
            asOfEventId: null
          },
          knowledgeStates: [],
          stateHistory: []
        }
      }
    });

    const locationReferences = await repository.getStoryBibleReferences(locationId);
    expect(locationReferences).toMatchObject({
      ok: true,
      value: {
        assetId: locationId,
        canSetDeleted: true,
        incoming: [
          { sourceAssetId: characterId, targetAssetId: locationId, kind: "detail" },
          { sourceAssetId: characterId, targetAssetId: locationId, kind: "relation" }
        ],
        deletionImpact: { affectedReferenceCount: 2, cascades: false }
      }
    });
    const characterReferences = await repository.getStoryBibleReferences(characterId);
    expect(characterReferences).toMatchObject({
      ok: true,
      value: {
        outgoing: expect.arrayContaining([
          expect.objectContaining({ targetAssetId: locationId, kind: "detail" }),
          expect.objectContaining({ targetAssetId: locationId, kind: "relation" })
        ])
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

function candidateFrom(
  asset: import("../src/index.js").StoryBibleV11Asset,
  patch: Partial<StoryBibleWriteCandidate> = {}
): StoryBibleWriteCandidate {
  return {
    schemaVersion: "1.1",
    id: asset.id,
    type: asset.type,
    title: asset.title,
    status: asset.status,
    summary: asset.summary,
    aliases: [...asset.aliases],
    relations: [...asset.relations],
    details: asset.details,
    extensions: asset.extensions,
    createdAt: asset.createdAt,
    ...patch
  };
}

function directedRelation(input: {
  readonly relationId: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly relationType?: string;
  readonly inversePolicy?: "derived" | "explicit" | "none";
  readonly inverseRelationId?: string | null;
  readonly status?: "active" | "ended" | "uncertain";
  readonly validFromChapterId?: string | null;
  readonly validToChapterId?: string | null;
}): import("../src/index.js").StoryBibleRelation {
  return {
    relationId: input.relationId,
    sourceId: input.sourceId,
    targetId: input.targetId,
    relationType: input.relationType ?? "character.located-in",
    direction: "directed",
    status: input.status ?? "active",
    validFromChapterId: input.validFromChapterId ?? null,
    validToChapterId: input.validToChapterId ?? null,
    inversePolicy: input.inversePolicy ?? "derived",
    inverseRelationId: input.inverseRelationId ?? null,
    evidence: [],
    note: ""
  };
}

async function prepareExplicitRelationCreatePair(repository: StoryBibleFileRepository): Promise<{
  readonly character: PreparedStoryBibleCreate;
  readonly location: PreparedStoryBibleCreate;
}> {
  const characterId = "chr_11111111111111111111111111111111";
  const locationId = "loc_22222222222222222222222222222222";
  const relationId = "rel_33333333333333333333333333333333";
  const inverseRelationId = "rel_44444444444444444444444444444444";
  const character = await repository.prepareCreateStoryAsset({
    type: "character",
    reservedAssetId: characterId,
    additionalKnownAssetIds: [locationId],
    deferProjectRelationPairValidation: true,
    value: {
      title: "Mira",
      relations: [
        directedRelation({
          relationId,
          sourceId: characterId,
          targetId: locationId,
          inversePolicy: "explicit",
          inverseRelationId
        })
      ]
    }
  });
  const location = await repository.prepareCreateStoryAsset({
    type: "world.location",
    reservedAssetId: locationId,
    additionalKnownAssetIds: [characterId],
    deferProjectRelationPairValidation: true,
    value: {
      title: "Archive",
      relations: [
        directedRelation({
          relationId: inverseRelationId,
          sourceId: locationId,
          targetId: characterId,
          relationType: "world.contains-character",
          inversePolicy: "explicit",
          inverseRelationId: relationId
        })
      ]
    }
  });
  if (!character.ok || !location.ok) {
    throw new Error(
      `Could not prepare explicit relation pair: ${JSON.stringify({ character, location })}`
    );
  }
  return { character: character.value, location: location.value };
}

function storyBibleGroupCandidates(pair: {
  readonly character: PreparedStoryBibleCreate;
  readonly location: PreparedStoryBibleCreate;
}): readonly { readonly relativePath: string; readonly candidateContent: string }[] {
  return [
    { relativePath: pair.character.relativePath, candidateContent: pair.character.content },
    { relativePath: pair.location.relativePath, candidateContent: pair.location.content }
  ];
}
