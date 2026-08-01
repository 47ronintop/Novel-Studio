import { describe, expect, test } from "vitest";
import {
  validateStoryBibleV11Asset,
  validateStoryBibleWriteCandidate
} from "@novel-studio/schemas";

import { adaptLegacyStoryBibleAsset, type StoryBibleWriteCandidate } from "../src/index.js";

describe("Story Bible v1.1 legacy compatibility", () => {
  test("moves unknown nested character fields into pointer passthrough", () => {
    const read = adaptLegacyStoryBibleAsset({
      asset: {
        schemaVersion: "1.0",
        id: "chr_legacy",
        type: "character",
        title: "Legacy archivist",
        status: "active",
        summary: "",
        aliases: [],
        details: {
          arc: {
            start: "Guards the archive alone.",
            turningPoints: ["Accepts help."],
            targetState: "Trusts the team.",
            legacyBeat: { chapter: "ch_01", note: "Keep exactly." },
            "legacy/key~name": true
          },
          secrets: [
            {
              content: "The map is forged.",
              knownByIds: [],
              revealStatus: "hidden",
              legacyCipher: [3, 1, 4]
            }
          ]
        },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      },
      checksum: "a".repeat(64),
      relativePath: "characters/chr_legacy.json"
    });

    expect(read.asset.details).toMatchObject({
      arc: {
        start: "Guards the archive alone.",
        turningPoints: ["Accepts help."],
        targetState: "Trusts the team."
      },
      secrets: [
        {
          content: "The map is forged.",
          knownByIds: [],
          revealStatus: "hidden"
        }
      ]
    });
    expect(read.asset.details).not.toHaveProperty("arc.legacyBeat");
    expect(read.asset.details).not.toHaveProperty("secrets.0.legacyCipher");
    expect(read.asset.passthrough?.detailFieldsByPointer).toEqual({
      "/arc/legacyBeat": {
        value: { chapter: "ch_01", note: "Keep exactly." }
      },
      "/arc/legacy~1key~0name": { value: true },
      "/secrets/0/legacyCipher": { value: [3, 1, 4] }
    });
    expect(read.passthroughFieldCount).toBe(3);

    const candidate: StoryBibleWriteCandidate = {
      schemaVersion: "1.1",
      id: read.asset.id,
      type: read.asset.type,
      title: read.asset.title,
      status: read.asset.status,
      summary: read.asset.summary,
      aliases: read.asset.aliases,
      relations: read.asset.relations,
      details: read.asset.details,
      extensions: read.asset.extensions,
      createdAt: read.asset.createdAt
    };
    expect(
      validateStoryBibleWriteCandidate(candidate, {
        allowLegacyId: true
      })
    ).toEqual({ valid: true, issues: [] });
    expect(
      validateStoryBibleV11Asset({ ...read.asset, revision: 1 }, "persistedStrict", {
        allowLegacyId: true
      })
    ).toEqual({ valid: true, issues: [] });
  });
});
