import { describe, expect, test } from "vitest";

import {
  checksumStoryBibleSelectorValue,
  prepareStoryBiblePatch,
  type StoryBiblePatchAsset
} from "../src/index.js";

describe("Story Bible stable-entry patching", () => {
  test("rebases one unchanged chapter outline across an unrelated outer revision", () => {
    const asset = outlineAsset();
    const result = prepareStoryBiblePatch({
      asset,
      baseRevision: 4,
      entryRef: {
        collection: "chapterOutlines",
        entryId: "cho_22222222222222222222222222222222",
        baseEntryRevision: 1
      },
      dependencies: [
        {
          path: "/details/premise",
          valueChecksum: checksumStoryBibleSelectorValue("Find the archive.")
        }
      ],
      operations: [{ op: "replace", path: "/actualOutcome", value: "The archive was empty." }],
      knownAssetIds: new Set([asset.id])
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        latestBaseRevision: 5,
        rebased: true,
        entryRevision: 2,
        candidate: {
          schemaVersion: "1.1",
          details: {
            chapterOutlines: [
              {
                chapterOutlineId: "cho_22222222222222222222222222222222",
                entryRevision: 2,
                actualOutcome: "The archive was empty."
              }
            ]
          }
        }
      }
    });
    if (result.ok) {
      expect(result.value.candidate["revision"]).toBeUndefined();
      expect(result.value.candidate["passthrough"]).toBeUndefined();
    }
  });

  test("rejects changed entries, changed dependencies, and root-level stale patches", () => {
    const asset = outlineAsset();
    const entryConflict = prepareStoryBiblePatch({
      asset,
      baseRevision: 4,
      entryRef: {
        collection: "chapterOutlines",
        entryId: "cho_22222222222222222222222222222222",
        baseEntryRevision: 2
      },
      operations: [{ op: "replace", path: "/actualOutcome", value: "Changed" }]
    });
    const dependencyConflict = prepareStoryBiblePatch({
      asset,
      baseRevision: 4,
      entryRef: {
        collection: "chapterOutlines",
        entryId: "cho_22222222222222222222222222222222",
        baseEntryRevision: 1
      },
      dependencies: [{ path: "/details/premise", valueChecksum: "0".repeat(64) }],
      operations: [{ op: "replace", path: "/actualOutcome", value: "Changed" }]
    });
    const rootConflict = prepareStoryBiblePatch({
      asset,
      baseRevision: 4,
      operations: [{ op: "replace", path: "/summary", value: "Changed" }]
    });

    expect(entryConflict).toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_ENTRY_REVISION_CONFLICT" }
    });
    expect(dependencyConflict).toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_PATCH_DEPENDENCY_CONFLICT" }
    });
    expect(rootConflict).toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_REVISION_CONFLICT" }
    });
  });

  test("forbids array indexes and stable-entry identity changes", () => {
    const asset = outlineAsset();
    const indexed = prepareStoryBiblePatch({
      asset,
      baseRevision: 5,
      operations: [
        {
          op: "replace",
          path: "/details/chapterOutlines/0/actualOutcome",
          value: "Changed"
        }
      ]
    });
    const identity = prepareStoryBiblePatch({
      asset,
      baseRevision: 5,
      entryRef: {
        collection: "chapterOutlines",
        entryId: "cho_22222222222222222222222222222222",
        baseEntryRevision: 1
      },
      operations: [
        {
          op: "replace",
          path: "/chapterOutlineId",
          value: "cho_33333333333333333333333333333333"
        }
      ]
    });

    expect(indexed).toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_PATCH_ARRAY_INDEX_FORBIDDEN" }
    });
    expect(identity).toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_PATCH_FIELD_FORBIDDEN" }
    });
  });
});

function outlineAsset(): StoryBiblePatchAsset {
  return {
    schemaVersion: "1.1",
    id: "outline_main",
    type: "outline",
    title: "Main Outline",
    status: "active",
    summary: "",
    aliases: [],
    relations: [],
    details: {
      premise: "Find the archive.",
      volumes: [],
      chapterOutlines: [
        {
          chapterOutlineId: "cho_22222222222222222222222222222222",
          chapterId: "ch_01",
          entryRevision: 1,
          goal: "Enter the archive.",
          conflict: "The gate is sealed.",
          turningPoint: "The key breaks.",
          notes: "",
          povCharacterId: null,
          characterIds: [],
          locationIds: [],
          foreshadowIds: [],
          beats: [],
          expectedStateChanges: [],
          actualOutcome: null,
          deviations: []
        }
      ]
    },
    extensions: {},
    createdAt: "2026-07-31T00:00:00.000Z",
    updatedAt: "2026-07-31T01:00:00.000Z",
    revision: 5
  };
}
