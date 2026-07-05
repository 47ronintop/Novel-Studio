import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

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
    expect(rebuilt.value.entryCount).toBe(4);
    expect(rebuilt.value.entries.map((entry) => entry.type)).toEqual([
      "chapter",
      "story.character",
      "story.world",
      "memory"
    ]);

    const cacheText = await readFile(join(projectRoot, "cache", "indexes", "search.json"), "utf8");
    expect(JSON.parse(cacheText)).toMatchObject({
      schemaVersion: "1.0",
      generatedAt: now,
      entryCount: 4
    });
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
});

async function createSearchProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-search-"));
  await mkdir(join(projectRoot, "chapters"), { recursive: true });
  await mkdir(join(projectRoot, "characters"), { recursive: true });
  await mkdir(join(projectRoot, "world"), { recursive: true });
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
