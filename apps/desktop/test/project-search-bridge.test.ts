import { describe, expect, test, vi } from "vitest";

import type { ProjectSearchResultItem } from "@novel-studio/application";

import { openProjectSearchResult } from "../src/renderer/project-search-bridge.js";

describe("project search navigation bridge", () => {
  test("routes chapter and Story Bible results through WorkspaceNavigation", async () => {
    const navigateToChapter = vi.fn(async () => undefined);
    const navigateToStoryEntry = vi.fn();
    const navigation = { navigateToChapter, navigateToStoryEntry };

    await openProjectSearchResult(navigation, result("chapter", "ch_01"));
    await openProjectSearchResult(navigation, result("story-asset", "timeline_main"));
    await openProjectSearchResult(navigation, result("memory", "memory_01"));

    expect(navigateToChapter).toHaveBeenCalledWith("ch_01");
    expect(navigateToStoryEntry.mock.calls).toEqual([["timeline_main"], ["memory_01"]]);
  });
});

function result(
  kind: ProjectSearchResultItem["sourceRef"]["kind"],
  id: string
): ProjectSearchResultItem {
  return {
    id: `result_${id}`,
    type: kind === "chapter" ? "chapter" : kind === "memory" ? "memory" : "story.timeline",
    title: id,
    snippet: id,
    score: 1,
    sourceRef: { kind, id, relativePath: `${id}.md` }
  };
}
