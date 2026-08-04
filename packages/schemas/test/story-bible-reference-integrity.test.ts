import { describe, expect, test } from "vitest";

import {
  collectStoryBibleDeclaredChapterReferences,
  collectStoryBibleDeclaredReferences,
  inspectStoryBibleChapterReferences,
  inspectStoryBibleReferences,
  storyBibleChapterReferenceFingerprint,
  storyBibleReferenceFingerprint,
  validateStoryBibleCreateValue,
  validateStoryBibleV11Asset,
  type StoryBibleReferenceTargetType
} from "../src/index.js";

const CHARACTER_ID = "chr_11111111111111111111111111111111";
const LOCATION_ID = "loc_22222222222222222222222222222222";
const EVENT_ID = "evt_33333333333333333333333333333333";
const SECOND_EVENT_ID = "evt_55555555555555555555555555555555";

describe("Story Bible reference integrity schema", () => {
  test("declares every typed cross-asset reference field", () => {
    const references = [
      ...collectStoryBibleDeclaredReferences({
        type: "character",
        relations: [relation(LOCATION_ID)],
        details: {
          secrets: [{ secretId: "sec_1", knownByIds: [CHARACTER_ID] }],
          currentState: {
            locationId: LOCATION_ID,
            heldItemIds: ["item_1"],
            asOfEventId: EVENT_ID
          },
          stateHistory: [{ stateHistoryId: "sth_1", timelineEventId: EVENT_ID }]
        }
      }),
      ...collectStoryBibleDeclaredReferences({
        type: "world.location",
        details: { regionId: LOCATION_ID, factionIds: ["fac_1"] }
      }),
      ...collectStoryBibleDeclaredReferences({
        type: "world.faction",
        details: {
          memberIds: [CHARACTER_ID],
          allyIds: ["fac_1"],
          enemyIds: ["fac_2"],
          influenceLocationIds: [LOCATION_ID]
        }
      }),
      ...collectStoryBibleDeclaredReferences({
        type: "world.rule",
        details: { knownViolationEventIds: [EVENT_ID] }
      }),
      ...collectStoryBibleDeclaredReferences({
        type: "world.glossary",
        details: { relatedRuleIds: ["rule_1"] }
      }),
      ...collectStoryBibleDeclaredReferences({
        type: "world.item",
        details: {
          holderId: CHARACTER_ID,
          currentLocationId: LOCATION_ID,
          asOfEventId: EVENT_ID,
          stateHistory: [{ stateHistoryId: "sth_2", timelineEventId: EVENT_ID }]
        }
      }),
      ...collectStoryBibleDeclaredReferences({
        type: "world.lore",
        details: { relatedRuleIds: ["rule_1"], relatedGlossaryIds: ["term_1"] }
      }),
      ...collectStoryBibleDeclaredReferences({
        type: "outline",
        details: {
          chapterOutlines: [
            {
              chapterOutlineId: "cho_1",
              povCharacterId: CHARACTER_ID,
              characterIds: [CHARACTER_ID],
              locationIds: [LOCATION_ID],
              foreshadowIds: ["fsh_1"]
            }
          ]
        }
      }),
      ...collectStoryBibleDeclaredReferences({
        type: "foreshadow",
        details: { milestones: [{ milestoneId: "fsm_1", timelineEventId: EVENT_ID }] }
      }),
      ...collectStoryBibleDeclaredReferences({
        type: "timeline.events",
        details: {
          events: [
            {
              eventId: EVENT_ID,
              time: { anchorEventId: SECOND_EVENT_ID },
              parallelEventIds: [SECOND_EVENT_ID],
              characterIds: [CHARACTER_ID],
              locationIds: [LOCATION_ID],
              stateChanges: [{ subjectId: CHARACTER_ID }]
            }
          ]
        }
      })
    ];

    expect(
      references.map((reference) => [reference.path, reference.expectedTargetTypes.join("|")])
    ).toEqual([
      ["/relations/0/targetId", expect.stringContaining("world.location")],
      ["/details/secrets/0/knownByIds/0", "character"],
      ["/details/currentState/locationId", "world.location"],
      ["/details/currentState/heldItemIds/0", "world.item"],
      ["/details/currentState/asOfEventId", "timeline.event"],
      ["/details/stateHistory/0/timelineEventId", "timeline.event"],
      ["/details/regionId", "world.location"],
      ["/details/factionIds/0", "world.faction"],
      ["/details/memberIds/0", "character"],
      ["/details/allyIds/0", "world.faction"],
      ["/details/enemyIds/0", "world.faction"],
      ["/details/influenceLocationIds/0", "world.location"],
      ["/details/knownViolationEventIds/0", "timeline.event"],
      ["/details/relatedRuleIds/0", "world.rule"],
      ["/details/holderId", "character"],
      ["/details/currentLocationId", "world.location"],
      ["/details/asOfEventId", "timeline.event"],
      ["/details/stateHistory/0/timelineEventId", "timeline.event"],
      ["/details/relatedRuleIds/0", "world.rule"],
      ["/details/relatedGlossaryIds/0", "world.glossary"],
      ["/details/chapterOutlines/0/povCharacterId", "character"],
      ["/details/chapterOutlines/0/characterIds/0", "character"],
      ["/details/chapterOutlines/0/locationIds/0", "world.location"],
      ["/details/chapterOutlines/0/foreshadowIds/0", "foreshadow"],
      ["/details/milestones/0/timelineEventId", "timeline.event"],
      ["/details/events/0/time/anchorEventId", "timeline.event"],
      ["/details/events/0/parallelEventIds/0", "timeline.event"],
      ["/details/events/0/characterIds/0", "character"],
      ["/details/events/0/locationIds/0", "world.location"],
      ["/details/events/0/stateChanges/0/subjectId", expect.stringContaining("character")]
    ]);
  });

  test("checks target existence and type while allowing only inherited invalid occurrences", () => {
    const asset = characterAsset(LOCATION_ID);
    const missingTargets = new Map<string, StoryBibleReferenceTargetType>([
      [CHARACTER_ID, "character"]
    ]);
    const wrongTargets = new Map<string, StoryBibleReferenceTargetType>([
      [CHARACTER_ID, "character"],
      [LOCATION_ID, "character"]
    ]);
    const validTargets = new Map<string, StoryBibleReferenceTargetType>([
      [CHARACTER_ID, "character"],
      [LOCATION_ID, "world.location"]
    ]);

    expect(
      validateStoryBibleV11Asset(asset, "writeStrict", {
        knownReferenceTargets: missingTargets
      }).issues
    ).toEqual(expect.arrayContaining([expect.objectContaining({ keyword: "referenceExists" })]));
    expect(
      validateStoryBibleV11Asset(asset, "writeStrict", {
        knownReferenceTargets: wrongTargets
      }).issues
    ).toEqual(expect.arrayContaining([expect.objectContaining({ keyword: "referenceType" })]));
    expect(
      validateStoryBibleV11Asset(asset, "writeStrict", {
        knownReferenceTargets: validTargets
      })
    ).toEqual({ valid: true, issues: [] });

    const [missing] = inspectStoryBibleReferences(asset, missingTargets);
    expect(missing?.integrity).toBe("missing");
    if (missing === undefined) return;
    expect(
      validateStoryBibleV11Asset(asset, "writeStrict", {
        knownReferenceTargets: missingTargets,
        inheritedInvalidReferenceCounts: new Map([[storyBibleReferenceFingerprint(missing), 1]])
      })
    ).toEqual({ valid: true, issues: [] });
  });

  test("requires explicit inverse IDs only for directed explicit relations", () => {
    const missingInverse = characterAsset(null, [
      {
        ...relation(LOCATION_ID),
        inversePolicy: "explicit",
        inverseRelationId: null
      }
    ]);
    const unexpectedInverse = characterAsset(null, [
      {
        ...relation(LOCATION_ID),
        inversePolicy: "derived",
        inverseRelationId: "rel_99999999999999999999999999999999"
      }
    ]);

    expect(validateStoryBibleV11Asset(missingInverse).issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ keyword: "explicitInverse" })])
    );
    expect(validateStoryBibleV11Asset(unexpectedInverse).issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ keyword: "inversePolicy" })])
    );
  });

  test("validates timeline event links without treating narrative causes and effects as IDs", () => {
    const narrative = timelineAsset([
      timelineEvent(EVENT_ID, { causes: ["A promise is broken"], effects: ["The gate opens"] })
    ]);
    const missingParallel = timelineAsset([
      timelineEvent(EVENT_ID, { parallelEventIds: [SECOND_EVENT_ID] })
    ]);
    const selfParallel = timelineAsset([timelineEvent(EVENT_ID, { parallelEventIds: [EVENT_ID] })]);
    const anchorCycle = timelineAsset([
      timelineEvent(EVENT_ID, { anchorEventId: SECOND_EVENT_ID }),
      timelineEvent(SECOND_EVENT_ID, { anchorEventId: EVENT_ID, sequence: 2 })
    ]);

    expect(validateStoryBibleV11Asset(narrative)).toEqual({ valid: true, issues: [] });
    expect(validateStoryBibleV11Asset(missingParallel).issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ keyword: "eventReference" })])
    );
    expect(validateStoryBibleV11Asset(selfParallel).issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ keyword: "eventSelfReference" })])
    );
    expect(validateStoryBibleV11Asset(anchorCycle).issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ keyword: "eventCycle" })])
    );
  });

  test("keeps outline and timeline singleton assets outside the deleted boundary", () => {
    const deletedTimeline = timelineAsset([]);
    deletedTimeline["status"] = "deleted";
    expect(validateStoryBibleV11Asset(deletedTimeline).issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ keyword: "singletonDelete" })])
    );

    expect(
      validateStoryBibleCreateValue("timeline.events", { title: "Timeline", status: "deleted" })
    ).toEqual(
      expect.objectContaining({
        valid: false,
        issues: expect.arrayContaining([expect.objectContaining({ keyword: "enum" })])
      })
    );
  });

  test("declares and validates every chapter reference field with inherited compatibility", () => {
    const chapterId = "ch_01";
    const missingChapterId = "ch_missing";
    const references = [
      ...collectStoryBibleDeclaredChapterReferences({
        type: "character",
        relations: [
          {
            ...relation(LOCATION_ID),
            validFromChapterId: chapterId,
            validToChapterId: missingChapterId,
            evidence: [{ chapterId, start: 0, end: 1, excerptHash: "a".repeat(64) }]
          }
        ],
        details: {
          currentState: { asOfChapterId: chapterId },
          knowledgeStates: [
            {
              knowledgeStateId: "knw_1",
              sourceChapterId: chapterId,
              validFromChapterId: chapterId,
              validToChapterId: missingChapterId
            }
          ],
          stateHistory: [{ stateHistoryId: "sth_1", chapterId }]
        }
      }),
      ...collectStoryBibleDeclaredChapterReferences({
        type: "world.item",
        details: {
          asOfChapterId: chapterId,
          stateHistory: [{ stateHistoryId: "sth_2", chapterId }]
        }
      }),
      ...collectStoryBibleDeclaredChapterReferences({
        type: "world.glossary",
        details: { firstAppearanceChapterId: chapterId }
      }),
      ...collectStoryBibleDeclaredChapterReferences({
        type: "outline",
        details: {
          volumes: [{ volumeId: "vol_1", chapterIds: [chapterId] }],
          chapterOutlines: [{ chapterOutlineId: "cho_1", chapterId }]
        }
      }),
      ...collectStoryBibleDeclaredChapterReferences({
        type: "foreshadow",
        details: {
          plantedChapterId: chapterId,
          plannedPayoffChapterId: chapterId,
          actualPayoffChapterId: missingChapterId,
          sourceRefs: [{ chapterId }],
          milestones: [{ milestoneId: "fsm_1", chapterId }]
        }
      }),
      ...collectStoryBibleDeclaredChapterReferences({
        type: "timeline.events",
        details: { events: [{ eventId: EVENT_ID, chapterIds: [chapterId] }] }
      })
    ];

    expect(references.map((reference) => reference.path)).toEqual([
      "/relations/0/validFromChapterId",
      "/relations/0/validToChapterId",
      "/relations/0/evidence/0/chapterId",
      "/details/currentState/asOfChapterId",
      "/details/knowledgeStates/0/sourceChapterId",
      "/details/knowledgeStates/0/validFromChapterId",
      "/details/knowledgeStates/0/validToChapterId",
      "/details/stateHistory/0/chapterId",
      "/details/asOfChapterId",
      "/details/stateHistory/0/chapterId",
      "/details/firstAppearanceChapterId",
      "/details/volumes/0/chapterIds/0",
      "/details/chapterOutlines/0/chapterId",
      "/details/plantedChapterId",
      "/details/plannedPayoffChapterId",
      "/details/actualPayoffChapterId",
      "/details/sourceRefs/0/chapterId",
      "/details/milestones/0/chapterId",
      "/details/events/0/chapterIds/0"
    ]);

    const asset = characterAsset(null);
    const details = asset["details"] as Record<string, unknown>;
    details["currentState"] = { asOfChapterId: missingChapterId };
    const missing = inspectStoryBibleChapterReferences(asset, new Set())[0];
    expect(missing?.integrity).toBe("missing");
    if (missing === undefined) return;
    expect(
      validateStoryBibleV11Asset(asset, "writeStrict", { knownChapterIds: new Set() }).issues
    ).toEqual(expect.arrayContaining([expect.objectContaining({ keyword: "chapterReference" })]));
    expect(
      validateStoryBibleV11Asset(asset, "writeStrict", {
        knownChapterIds: new Set(),
        inheritedInvalidChapterReferenceCounts: new Map([
          [storyBibleChapterReferenceFingerprint(missing), 1]
        ])
      })
    ).toEqual({ valid: true, issues: [] });
    expect(
      validateStoryBibleV11Asset(asset, "writeStrict", {
        knownChapterIds: new Set([missingChapterId])
      })
    ).toEqual({ valid: true, issues: [] });
  });
});

function characterAsset(
  locationId: string | null,
  relations: readonly Record<string, unknown>[] = []
): Record<string, unknown> {
  return {
    schemaVersion: "1.1",
    id: CHARACTER_ID,
    type: "character",
    title: "Mira",
    status: "active",
    summary: "",
    aliases: [],
    relations,
    details: { currentState: { locationId } },
    extensions: {},
    createdAt: "2026-07-31T00:00:00.000Z",
    updatedAt: "2026-07-31T00:00:00.000Z",
    revision: 1
  };
}

function relation(targetId: string): Record<string, unknown> {
  return {
    relationId: "rel_44444444444444444444444444444444",
    sourceId: CHARACTER_ID,
    targetId,
    relationType: "character.located-in",
    direction: "directed",
    status: "active",
    validFromChapterId: null,
    validToChapterId: null,
    inversePolicy: "derived",
    inverseRelationId: null,
    evidence: [],
    note: ""
  };
}

function timelineAsset(events: readonly Record<string, unknown>[]): Record<string, unknown> {
  return {
    schemaVersion: "1.1",
    id: "timeline_main",
    type: "timeline.events",
    title: "Timeline",
    status: "active",
    summary: "",
    aliases: [],
    relations: [],
    details: { events },
    extensions: {},
    createdAt: "2026-07-31T00:00:00.000Z",
    updatedAt: "2026-07-31T00:00:00.000Z",
    revision: 1
  };
}

function timelineEvent(
  eventId: string,
  overrides: {
    readonly anchorEventId?: string | null;
    readonly parallelEventIds?: readonly string[];
    readonly causes?: readonly string[];
    readonly effects?: readonly string[];
    readonly sequence?: number;
  } = {}
): Record<string, unknown> {
  return {
    eventId,
    entryRevision: 1,
    title: eventId,
    sequence: overrides.sequence ?? 1,
    time: {
      mode: overrides.anchorEventId === undefined ? "unknown" : "relative",
      label: "",
      anchorEventId: overrides.anchorEventId ?? null,
      offset: null,
      uncertain: false
    },
    duration: null,
    summary: "",
    chapterIds: [],
    characterIds: [],
    locationIds: [],
    parallelEventIds: [...(overrides.parallelEventIds ?? [])],
    causes: [...(overrides.causes ?? [])],
    effects: [...(overrides.effects ?? [])],
    stateChanges: []
  };
}
