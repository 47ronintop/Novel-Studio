import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { ChapterFileRepository, StoryBibleFileRepository } from "../src/index.js";

const tempRoots: string[] = [];
const timestamp = "2026-07-31T00:00:00.000Z";

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

describe("Story Bible scale gate", () => {
  test(
    "discovers any of 500 assets with stable pagination beside 300 chapters",
    async () => {
      const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-story-bible-scale-"));
      tempRoots.push(projectRoot);
      await mkdir(join(projectRoot, "chapters"), { recursive: true });
      await mkdir(join(projectRoot, "characters"), { recursive: true });

      const targetIndex = 499;
      await writeInBatches(
        Array.from({ length: 300 }, (_, index) => async () => {
          const chapterId = `ch_scale_${String(index + 1).padStart(3, "0")}`;
          await writeFile(
            join(projectRoot, "chapters", `${chapterId}.md`),
            chapterDocument(chapterId, index + 1),
            "utf8"
          );
        })
      );
      await writeInBatches(
        Array.from({ length: 500 }, (_, index) => async () => {
          const asset = characterAsset(index, index === targetIndex);
          await writeFile(
            join(projectRoot, "characters", `${asset.id}.json`),
            `${JSON.stringify(asset, null, 2)}\n`,
            "utf8"
          );
        })
      );

      const chapters = await new ChapterFileRepository({ projectRoot }).listChapters();
      expect(chapters).toMatchObject({ ok: true });
      if (!chapters.ok) return;
      expect(chapters.value).toHaveLength(300);
      expect(chapters.value.at(-1)).toMatchObject({ order: 300, title: "Chapter 300" });

      const repository = new StoryBibleFileRepository({ projectRoot });
      const discovered = await repository.listStoryBible({ query: "Needle 499", limit: 10 });
      expect(discovered).toMatchObject({
        ok: true,
        value: {
          items: [{ title: "Needle 499", type: "character", revision: 1 }],
          nextCursor: null
        }
      });
      if (!discovered.ok) return;
      const targetId = discovered.value.items[0]?.assetId;
      if (targetId === undefined) throw new Error("Expected the scale target asset.");
      await expect(repository.readStoryAssetForAgent(targetId)).resolves.toMatchObject({
        ok: true,
        value: {
          asset: { id: targetId, title: "Needle 499" },
          revision: 1,
          passthrough: { present: false }
        }
      });

      const seen = new Set<string>();
      let cursor: string | undefined;
      let indexRevision: string | undefined;
      do {
        const page = await repository.listStoryBible({ limit: 100, ...(cursor ? { cursor } : {}) });
        expect(page.ok).toBe(true);
        if (!page.ok) return;
        indexRevision ??= page.value.indexRevision;
        expect(page.value.indexRevision).toBe(indexRevision);
        for (const item of page.value.items) seen.add(item.assetId);
        cursor = page.value.nextCursor ?? undefined;
      } while (cursor !== undefined);
      expect(seen.size).toBe(500);
      expect(seen.has(targetId)).toBe(true);
    },
    60_000
  );
});

async function writeInBatches(tasks: readonly (() => Promise<void>)[]): Promise<void> {
  for (let start = 0; start < tasks.length; start += 50) {
    await Promise.all(tasks.slice(start, start + 50).map((task) => task()));
  }
}

function chapterDocument(chapterId: string, order: number): string {
  return `---\nschemaVersion: "1.0"\nid: "${chapterId}"\ntype: "chapter"\ntitle: "Chapter ${order}"\norder: ${order}\nstatus: "draft"\ncreatedAt: "${timestamp}"\nupdatedAt: "${timestamp}"\n---\n\nBody ${order}.\n`;
}

function characterAsset(index: number, target: boolean) {
  const identity = (index + 1).toString(16).padStart(32, "0");
  return {
    schemaVersion: "1.1",
    id: `chr_${identity}`,
    type: "character",
    title: target ? "Needle 499" : `Character ${String(index).padStart(3, "0")}`,
    status: "active",
    summary: `Scale fixture ${index}.`,
    aliases: [],
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
    createdAt: timestamp,
    updatedAt: timestamp,
    revision: 1
  };
}
