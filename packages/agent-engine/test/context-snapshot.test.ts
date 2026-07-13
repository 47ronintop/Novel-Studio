import { describe, expect, test } from "vitest";

import * as engineExports from "../src/index.js";

describe("Agent Context Snapshot", () => {
  test("records source origin and checksum and detects stale sources", () => {
    const exports = engineExports as unknown as Record<string, unknown>;
    const createSnapshot = exports["createAgentContextSnapshot"];
    const findStale = exports["findStaleContextSources"];
    expect(typeof createSnapshot).toBe("function");
    expect(typeof findStale).toBe("function");
    if (typeof createSnapshot !== "function" || typeof findStale !== "function") return;

    const snapshot = createSnapshot({
      contextSnapshotId: "context_01",
      runId: "run_01",
      createdAt: "2026-07-13T00:00:00.000Z",
      sources: [
        {
          refId: "chapter_01",
          sourceKind: "editor_buffer",
          relativePath: "chapters/ch_01.md",
          content: "Unsaved chapter text",
          dirty: true
        },
        {
          refId: "story_01",
          sourceKind: "story_bible_asset",
          assetId: "chr_hero",
          content: "Hero facts",
          dirty: false
        }
      ]
    }) as {
      readonly sources: readonly { readonly refId: string; readonly checksum: string }[];
    };
    expect(snapshot.sources[0]).toMatchObject({
      refId: "chapter_01",
      sourceKind: "editor_buffer",
      relativePath: "chapters/ch_01.md",
      dirty: true
    });
    expect(snapshot.sources[0]?.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(
      findStale(snapshot, [
        { refId: "chapter_01", content: "Changed buffer" },
        { refId: "story_01", content: "Hero facts" }
      ])
    ).toEqual(["chapter_01"]);
  });
});
