import { describe, expect, test } from "vitest";

import { validateStoryBibleCandidate } from "../src/index.js";

const createdAt = "2026-07-31T00:00:00.000Z";

describe("Story Bible candidate validation", () => {
  test("accepts a strict world lore candidate", () => {
    const result = validateStoryBibleCandidate({
      schemaVersion: "1.1",
      id: "lore_11111111111111111111111111111111",
      type: "world.lore",
      title: "Old Port History",
      status: "active",
      summary: "The old port predates the city.",
      aliases: [],
      relations: [],
      details: {
        body: "The first harbour was built around the winter spring.",
        periods: ["Founding era"]
      },
      extensions: {},
      createdAt
    });

    expect(result).toEqual({ valid: true, issues: [] });
  });

  test.each([
    ["passthrough", { passthrough: { sourceSchemaVersion: "1.0" } }],
    ["server revision", { revision: 7 }],
    ["unknown root field", { futureRootField: true }]
  ])("rejects %s in author candidates", (_caseName, extra) => {
    const result = validateStoryBibleCandidate({
      ...characterCandidate(),
      ...extra
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.keyword === "additionalProperties")).toBe(true);
  });

  test("rejects unknown detail fields and missing relation targets", () => {
    const candidate = characterCandidate();
    const unknownDetail = validateStoryBibleCandidate({
      ...candidate,
      details: { futureDetailField: true }
    });
    const invalidReference = validateStoryBibleCandidate(
      {
        ...candidate,
        relations: [
          {
            relationId: "rel_22222222222222222222222222222222",
            sourceId: candidate.id,
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
          }
        ]
      },
      { knownAssetIds: new Set([candidate.id]) }
    );

    expect(unknownDetail.valid).toBe(false);
    expect(invalidReference).toMatchObject({
      valid: false,
      issues: [{ instancePath: "/relations/0/targetId", keyword: "assetReference" }]
    });
  });

  test("enforces the canonical owner and inverse policy for symmetric relations", () => {
    const candidate = characterCandidate();
    const targetId = "chr_00000000000000000000000000000000";
    const result = validateStoryBibleCandidate(
      {
        ...candidate,
        relations: [
          {
            relationId: "rel_22222222222222222222222222222222",
            sourceId: candidate.id,
            targetId,
            relationType: "character.sibling",
            direction: "symmetric",
            status: "active",
            validFromChapterId: null,
            validToChapterId: null,
            inversePolicy: "explicit",
            inverseRelationId: "rel_33333333333333333333333333333333",
            evidence: [],
            note: ""
          }
        ]
      },
      { knownAssetIds: new Set([candidate.id, targetId]) }
    );

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.keyword)).toEqual(
      expect.arrayContaining(["symmetricOwner", "symmetricInverse"])
    );
  });
});

function characterCandidate() {
  return {
    schemaVersion: "1.1",
    id: "chr_11111111111111111111111111111111",
    type: "character",
    title: "Mira",
    status: "active",
    summary: "An archivist.",
    aliases: [],
    relations: [],
    details: { knowledgeStates: [], stateHistory: [] },
    extensions: {},
    createdAt
  } as const;
}
