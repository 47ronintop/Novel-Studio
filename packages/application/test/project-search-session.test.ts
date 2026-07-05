import { describe, expect, test } from "vitest";

import { createProjectSearchSession, type ProjectSearchRepositoryPort } from "../src/index.js";
import { ok } from "@novel-studio/shared";

const snapshot = {
  schemaVersion: "1.0",
  generatedAt: "2026-07-05T00:00:00.000Z",
  entryCount: 1,
  entries: [
    {
      id: "chapter:ch_opening",
      type: "chapter",
      title: "开篇",
      text: "The hero keeps a hidden oath.",
      updatedAt: "2026-07-05T00:00:00.000Z",
      sourceRef: {
        kind: "chapter",
        id: "ch_opening",
        relativePath: "chapters/ch_opening.md"
      }
    }
  ]
} as const;

describe("ProjectSearchSession", () => {
  test("rebuilds and searches through the repository port", async () => {
    const calls: string[] = [];
    const session = createProjectSearchSession({
      repository: createRepository(calls)
    });

    const rebuilt = await session.rebuildIndex();
    const searched = await session.search({ query: "oath" });

    expect(rebuilt).toEqual(ok(snapshot));
    expect(searched.ok).toBe(true);
    expect(calls).toEqual(["rebuildIndex", "search:oath"]);
  });
});

function createRepository(calls: string[]): ProjectSearchRepositoryPort {
  return {
    async rebuildIndex() {
      calls.push("rebuildIndex");
      return ok(snapshot);
    },
    async search(input) {
      calls.push(`search:${input.query}`);
      return ok({
        query: input.query,
        generatedAt: snapshot.generatedAt,
        entryCount: snapshot.entryCount,
        results: [
          {
            id: "chapter:ch_opening",
            type: "chapter",
            title: "开篇",
            snippet: "The hero keeps a hidden oath.",
            score: 2,
            sourceRef: snapshot.entries[0].sourceRef
          }
        ]
      });
    }
  };
}
