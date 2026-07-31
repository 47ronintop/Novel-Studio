import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { createForeshadowEvidence } from "@novel-studio/shared";

import { SearchIndexFileRepository } from "../src/index.js";

const now = "2026-07-05T00:00:00.000Z";

describe("SearchIndexFileRepository", () => {
  test("rebuilds a cache index from chapters and Story Bible assets", async () => {
    const projectRoot = await createSearchProject();
    const repository = new SearchIndexFileRepository({
      projectRoot,
      now: () => now
    });

    const rebuilt = await repository.rebuildIndex();

    expect(rebuilt.ok).toBe(true);
    if (!rebuilt.ok) {
      return;
    }
    expect(rebuilt.value.entryCount).toBe(5);
    expect(rebuilt.value.entries.map((entry) => entry.type)).toEqual([
      "chapter",
      "story.character",
      "story.world",
      "story.foreshadow",
      "memory"
    ]);

    const cacheText = await readFile(join(projectRoot, "cache", "indexes", "search.json"), "utf8");
    expect(JSON.parse(cacheText)).toMatchObject({
      schemaVersion: "1.0",
      generatedAt: now,
      entryCount: 5
    });
  });

  test("indexes foreshadow summaries, evidence, notes, and related Story Bible titles", async () => {
    const projectRoot = await createSearchProject();
    const repository = new SearchIndexFileRepository({
      projectRoot,
      now: () => now
    });

    const rebuilt = await repository.rebuildIndex();

    expect(rebuilt.ok).toBe(true);
    if (!rebuilt.ok) {
      return;
    }
    const foreshadow = rebuilt.value.entries.find((entry) => entry.type === "story.foreshadow");
    expect(foreshadow).toMatchObject({
      id: "story.foreshadow:fsh_018f12a7b91c4a2f9437c3d764e9a120",
      title: "The Returning Bell",
      sourceRef: {
        kind: "story-asset",
        id: "fsh_018f12a7b91c4a2f9437c3d764e9a120",
        relativePath: "foreshadows/fsh_018f12a7b91c4a2f9437c3d764e9a120.json"
      }
    });
    expect(foreshadow?.text).toContain("A slow-burning promise beneath the city gate.");
    expect(foreshadow?.text).toContain("A silver bell rings beneath the sealed arch.");
    expect(foreshadow?.text).toContain("Unmask the steward before the final council.");
    expect(foreshadow?.text).toContain("City Gate");

    const evidenceResults = await repository.search({ query: "silver bell" });
    expect(evidenceResults.ok).toBe(true);
    if (evidenceResults.ok) {
      expect(evidenceResults.value.results).toContainEqual(
        expect.objectContaining({
          type: "story.foreshadow",
          sourceRef: expect.objectContaining({
            relativePath: "foreshadows/fsh_018f12a7b91c4a2f9437c3d764e9a120.json"
          })
        })
      );
    }
  });

  test("searches the rebuilt index with stable snippets and source refs", async () => {
    const projectRoot = await createSearchProject();
    const repository = new SearchIndexFileRepository({
      projectRoot,
      now: () => now
    });
    await repository.rebuildIndex();

    const results = await repository.search({ query: "hidden oath", limit: 5 });

    expect(results.ok).toBe(true);
    if (!results.ok) {
      return;
    }
    expect(results.value.results.length).toBeGreaterThanOrEqual(2);
    expect(results.value.results[0]).toMatchObject({
      type: "chapter",
      title: "开篇",
      sourceRef: {
        kind: "chapter",
        id: "ch_opening",
        relativePath: "chapters/ch_opening.md"
      }
    });
    expect(results.value.results[0]?.snippet).toContain("hidden oath");
  });

  test("reads legacy v1.0 caches that do not contain foreshadow entries", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-search-legacy-"));
    await mkdir(join(projectRoot, "cache", "indexes"), { recursive: true });
    await writeFile(
      join(projectRoot, "cache", "indexes", "search.json"),
      `${JSON.stringify({
        schemaVersion: "1.0",
        generatedAt: now,
        entryCount: 1,
        entries: [
          {
            id: "memory:mem_legacy",
            type: "memory",
            title: "Legacy memory",
            text: "A remembered signal remains searchable.",
            updatedAt: now,
            sourceRef: {
              kind: "memory",
              id: "mem_legacy",
              relativePath: "memories/long-term/mem_legacy.json"
            }
          }
        ]
      })}\n`,
      "utf8"
    );
    const repository = new SearchIndexFileRepository({ projectRoot });

    const results = await repository.search({ query: "remembered signal" });

    expect(results.ok).toBe(true);
    if (results.ok) {
      expect(results.value).toMatchObject({
        generatedAt: now,
        entryCount: 1,
        results: [{ type: "memory", title: "Legacy memory" }]
      });
    }
  });

  test("invalidates the cache so a restarted repository rebuilds from current sources", async () => {
    const projectRoot = await createSearchProject();
    const repository = new SearchIndexFileRepository({ projectRoot, now: () => now });
    await repository.rebuildIndex();
    const characterPath = join(projectRoot, "characters", "chr_hero.json");
    const character = JSON.parse(await readFile(characterPath, "utf8")) as Record<string, unknown>;
    await writeFile(
      characterPath,
      `${JSON.stringify({ ...character, summary: "The renewed promise is now current." }, null, 2)}\n`,
      "utf8"
    );
    const sourceAfterEdit = await readFile(characterPath, "utf8");

    const invalidated = await repository.invalidate();

    expect(invalidated).toEqual({ ok: true, value: undefined });
    await expect(readFile(characterPath, "utf8")).resolves.toBe(sourceAfterEdit);
    await expect(
      readFile(join(projectRoot, "cache", "indexes", "search.json"), "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(repository.invalidate()).resolves.toEqual({ ok: true, value: undefined });

    const restarted = new SearchIndexFileRepository({ projectRoot, now: () => now });
    const searched = await restarted.search({ query: "renewed promise" });
    expect(searched.ok).toBe(true);
    if (searched.ok) {
      expect(searched.value.results).toContainEqual(
        expect.objectContaining({ type: "story.character", title: "Hero" })
      );
    }
  });

  test("clears the memory snapshot and reports cache deletion failures", async () => {
    const projectRoot = await createSearchProject();
    const repository = new SearchIndexFileRepository({
      projectRoot,
      removeIndexFile: async () => {
        throw Object.assign(new Error("cache is locked"), { code: "EACCES" });
      }
    });
    await repository.rebuildIndex();

    const invalidated = await repository.invalidate();

    expect(invalidated.ok).toBe(false);
    if (!invalidated.ok) {
      expect(invalidated.error).toMatchObject({
        code: "SEARCH_INDEX_INVALIDATE_FAILED",
        redactedDetail: {
          filePath: "cache/indexes/search.json",
          reason: "cache is locked"
        }
      });
    }
  });
});

async function createSearchProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-search-"));
  await mkdir(join(projectRoot, "chapters"), { recursive: true });
  await mkdir(join(projectRoot, "characters"), { recursive: true });
  await mkdir(join(projectRoot, "world"), { recursive: true });
  await mkdir(join(projectRoot, "foreshadows"), { recursive: true });
  await mkdir(join(projectRoot, "memories", "long-term"), { recursive: true });

  await writeFile(
    join(projectRoot, "chapters", "ch_opening.md"),
    [
      "---",
      "schemaVersion: '1.0'",
      "id: ch_opening",
      "type: chapter",
      "title: 开篇",
      "order: 1",
      "status: draft",
      `createdAt: '${now}'`,
      `updatedAt: '${now}'`,
      "---",
      "",
      "The hero keeps a hidden oath beneath the city gate."
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    join(projectRoot, "characters", "chr_hero.json"),
    `${JSON.stringify(
      {
        schemaVersion: "1.0",
        id: "chr_hero",
        type: "character",
        title: "Hero",
        status: "active",
        summary: "A protagonist bound by a hidden oath.",
        createdAt: now,
        updatedAt: now
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    join(projectRoot, "world", "loc_gate.json"),
    `${JSON.stringify(
      {
        schemaVersion: "1.0",
        id: "loc_gate",
        type: "world.location",
        title: "City Gate",
        status: "active",
        summary: "The northern gate is sealed at midnight.",
        createdAt: now,
        updatedAt: now
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  const foreshadowEvidence = await createForeshadowEvidence(
    "ch_opening",
    "A silver bell rings beneath the sealed arch."
  );
  await writeFile(
    join(projectRoot, "foreshadows", "fsh_018f12a7b91c4a2f9437c3d764e9a120.json"),
    `${JSON.stringify(
      {
        schemaVersion: "1.0",
        id: "fsh_018f12a7b91c4a2f9437c3d764e9a120",
        type: "foreshadow",
        title: "The Returning Bell",
        status: "active",
        summary: "A slow-burning promise beneath the city gate.",
        details: {
          trackingStatus: "planted",
          plantedChapterId: "ch_opening",
          sourceRefs: [foreshadowEvidence],
          notes: "Unmask the steward before the final council."
        },
        relatedEntityIds: ["loc_gate"],
        createdAt: now,
        updatedAt: now
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    join(projectRoot, "memories", "long-term", "mem_oath.json"),
    `${JSON.stringify(
      {
        schemaVersion: "1.0",
        id: "mem_oath",
        type: "memory.long-term",
        title: "Oath",
        status: "active",
        origin: "user-confirmed-ai",
        confidence: "confirmed",
        content: "The hidden oath must never be spoken aloud.",
        createdAt: now,
        updatedAt: now
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  return projectRoot;
}
