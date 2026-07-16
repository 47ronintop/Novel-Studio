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

  test("records system guidance as an auditable system-layer source that never goes stale", () => {
    const exports = engineExports as unknown as Record<string, unknown>;
    const createSnapshot = exports["createAgentContextSnapshot"];
    const findStale = exports["findStaleContextSources"];
    if (typeof createSnapshot !== "function" || typeof findStale !== "function") return;

    const snapshot = createSnapshot({
      contextSnapshotId: "context_guidance",
      runId: "run_guidance",
      createdAt: "2026-07-16T00:00:00.000Z",
      sources: [
        {
          refId: "system_guidance:writing",
          sourceKind: "system_guidance",
          content: "写作模式指导 + 文风规则",
          dirty: false
        },
        {
          refId: "chapter_01",
          sourceKind: "editor_buffer",
          relativePath: "chapters/ch_01.md",
          content: "Chapter body",
          dirty: false
        }
      ]
    }) as {
      readonly sources: readonly {
        readonly refId: string;
        readonly sourceKind: string;
        readonly layer: string;
        readonly checksum: string;
      }[];
    };

    // The guidance layer is recorded as an auditable source with a checksum ("查看来源" surfaces it).
    const guidance = snapshot.sources.find(
      (source) => source.refId === "system_guidance:writing"
    );
    expect(guidance).toMatchObject({ sourceKind: "system_guidance", layer: "system" });
    expect(guidance?.checksum).toMatch(/^[0-9a-f]{64}$/);

    // System-authored guidance is fixed; the staleness check never reads it back or flags it, even
    // when the current reader does not surface it at all.
    expect(
      findStale(snapshot, [{ refId: "chapter_01", content: "Chapter body" }])
    ).toEqual([]);
  });
});
