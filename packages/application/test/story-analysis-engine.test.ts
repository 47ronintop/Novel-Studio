import { describe, expect, test } from "vitest";
import { validateStoryAnalysisBundle, type StoryAnalysisBundle } from "@novel-studio/schemas";
import {
  checksumStoryAnalysisSelectors,
  materializeStoryObserverOutput,
  refreshStoryAnalysisStaleness,
  transitionStoryAnalysisRecord,
  type MaterializedStoryObserverOutput,
  type StoryAnalysisAsset,
  type StoryAnalysisAssetRead
} from "../src/story-analysis-engine.js";

const RUN_ID = `run_${"a".repeat(32)}`;
const CHAPTER_HASH = "a".repeat(64);
const INDEX_REVISION = "b".repeat(64);
const CHARACTER_ID = `chr_${"1".repeat(32)}`;
const SECOND_CHARACTER_ID = `chr_${"2".repeat(32)}`;
const LOCATION_ID = `loc_${"3".repeat(32)}`;
const OTHER_LOCATION_ID = `loc_${"4".repeat(32)}`;
const ITEM_ID = `item_${"5".repeat(32)}`;
const SECOND_ITEM_ID = `item_${"6".repeat(32)}`;
const FORESHADOW_ID = `fsh_${"6".repeat(32)}`;
const FACTION_ID = `fac_${"7".repeat(32)}`;
const RULE_ID = `rule_${"8".repeat(32)}`;
const GLOSSARY_ID = `term_${"9".repeat(32)}`;
const LORE_ID = `lore_${"a".repeat(32)}`;
const BODY = "林默到了北站。顾岚把铜钥匙交给他。";

describe("Story Analysis engine", () => {
  test("materializes all nine observation domains in one strict Observer response", () => {
    const output = {
      observations: [
        observation("character.behavior", "阿默", "character_behavior", {
          title: "抵达北站",
          summary: "林默抵达北站。"
        }),
        observation("character.location", "林默", "character_location", {
          locationMention: "北站"
        }),
        observation("character.resource", "林默", "character_held_items", {
          itemMentions: ["铜钥匙"]
        }),
        observation("character.relationship", "林默", "character_relationship", {
          targetMention: "顾岚",
          relationType: "character.trust"
        }),
        observation("character.emotion", "林默", "character_emotional", {
          state: "紧张"
        }),
        observation(
          "character.information",
          "林默",
          "character_knowledge",
          { subject: "顾岚在北站", state: "known" },
          "dialogue_claim"
        ),
        observation("foreshadow", "雨夜钥匙", "foreshadow_milestone", {
          kind: "progress",
          note: "钥匙转交给林默。"
        }),
        observation("timeline", "主时间线", "timeline_event", {
          title: "钥匙转交",
          summary: "顾岚把钥匙交给林默。"
        }),
        observation("character.physical_state", "林默", "character_physical", {
          state: "疲惫"
        })
      ]
    };

    const materialized = materialize(output);

    expect(materialized.ok).toBe(true);
    if (!materialized.ok) return;
    expect(materialized.value.validation).toMatchObject({
      observationCount: 9,
      acceptedCount: 9,
      rejectedCount: 0
    });
    expect(new Set(materialized.value.observations.map((entry) => entry.domain))).toEqual(
      new Set([
        "character.behavior",
        "character.location",
        "character.resource",
        "character.relationship",
        "character.emotion",
        "character.information",
        "foreshadow",
        "timeline",
        "character.physical_state"
      ])
    );
    expect(materialized.value.observations[0]?.subject).toMatchObject({
      mention: "阿默",
      resolvedAssetId: CHARACTER_ID,
      candidateAssetIds: [CHARACTER_ID]
    });
    expect(materialized.value.records.every((record) => record.revision === 1)).toBe(true);
    expect(validateStoryAnalysisBundle(bundleFor(materialized.value))).toEqual({
      valid: true,
      issues: []
    });
  });

  test("rejects evidence that does not match the saved Unicode character range", () => {
    const invalid = observation("character.location", "林默", "character_location", {
      locationMention: "北站"
    });
    invalid.evidence = [{ ...evidence(), excerpt: "错误摘录" }];

    const result = materialize({ observations: [invalid] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.validation).toMatchObject({
      observationCount: 1,
      acceptedCount: 0,
      rejectedCount: 1
    });
    expect(result.value.factDeltas).toEqual([]);
    expect(result.value.records).toEqual([]);
  });

  test("never routes dialogue, belief, rumor, or inference into objective location fields", () => {
    const result = materialize({
      observations: [
        observation(
          "character.location",
          "林默",
          "character_location",
          { locationMention: "北站" },
          "rumor"
        )
      ]
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.factDeltas).toEqual([]);
    expect(result.value.records).toEqual([
      expect.objectContaining({
        recordType: "review_issue",
        issueType: "ambiguity",
        status: "open"
      })
    ]);
  });

  test.each(["dialogue_claim", "rumor"])(
    "routes %s relationship claims to review instead of objective relations",
    (epistemicStatus) => {
      const result = materialize({
        observations: [
          observation(
            "character.relationship",
            "林默",
            "character_relationship",
            { targetMention: "顾岚", relationType: "character.trust" },
            epistemicStatus
          )
        ]
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.factDeltas).toEqual([]);
      expect(result.value.records).toEqual([
        expect.objectContaining({
          recordType: "review_issue",
          issueType: "ambiguity",
          status: "open"
        })
      ]);
    }
  );

  test("routes narrator-asserted relationships into objective relation suggestions", () => {
    const result = materialize({
      observations: [
        observation("character.relationship", "林默", "character_relationship", {
          targetMention: "顾岚",
          relationType: "character.trust"
        })
      ]
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.factDeltas).toEqual([
      expect.objectContaining({
        action: "patch",
        epistemicStatus: "narrator_asserted",
        operations: [expect.objectContaining({ path: "/relations" })]
      })
    ]);
    expect(result.value.records).toEqual([
      expect.objectContaining({ recordType: "change", status: "pending" })
    ]);
  });

  test("canonicalizes symmetric relationships and reuses one stable relation across directions and chapters", () => {
    const forward = materialize({
      observations: [
        observation("character.relationship", "林默", "character_relationship", {
          targetMention: "顾岚",
          relationType: "character.ally",
          direction: "symmetric"
        })
      ]
    });
    const reverse = materialize(
      {
        observations: [
          observation("character.relationship", "顾岚", "character_relationship", {
            targetMention: "林默",
            relationType: "character.ally",
            direction: "symmetric"
          })
        ]
      },
      { chapterId: "ch_02", chapterChecksum: "f".repeat(64) }
    );

    expect(forward.ok).toBe(true);
    expect(reverse.ok).toBe(true);
    if (!forward.ok || !reverse.ok) return;
    const forwardRelation = requireAt(
      operationValue(forward.value, CHARACTER_ID, "/relations") as StoryAnalysisAsset["relations"],
      0,
      "Expected the forward relation."
    );
    const reverseRelation = requireAt(
      operationValue(reverse.value, CHARACTER_ID, "/relations") as StoryAnalysisAsset["relations"],
      0,
      "Expected the reverse relation."
    );
    expect(forward.value.factDeltas).toEqual([
      expect.objectContaining({ target: expect.objectContaining({ assetId: CHARACTER_ID }) })
    ]);
    expect(reverse.value.factDeltas).toEqual([
      expect.objectContaining({ target: expect.objectContaining({ assetId: CHARACTER_ID }) })
    ]);
    expect(forwardRelation).toMatchObject({
      sourceId: CHARACTER_ID,
      targetId: SECOND_CHARACTER_ID,
      direction: "symmetric",
      inversePolicy: "derived",
      inverseRelationId: null
    });
    expect(reverseRelation["relationId"]).toBe(forwardRelation["relationId"]);

    const assetsWithRelation = assets().map((entry) =>
      entry.asset.id === CHARACTER_ID
        ? {
            ...entry,
            asset: { ...entry.asset, relations: [structuredClone(forwardRelation)] }
          }
        : entry
    );
    const updated = materialize(
      {
        observations: [
          observation("character.relationship", "顾岚", "character_relationship", {
            targetMention: "林默",
            relationType: "character.ally",
            direction: "symmetric",
            note: "第二章再次确认同盟。"
          })
        ]
      },
      { chapterId: "ch_02", chapterChecksum: "f".repeat(64), assets: assetsWithRelation }
    );
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    const updatedRelations = operationValue(
      updated.value,
      CHARACTER_ID,
      "/relations"
    ) as StoryAnalysisAsset["relations"];
    expect(updatedRelations).toHaveLength(1);
    expect(updatedRelations[0]).toMatchObject({
      relationId: forwardRelation["relationId"],
      sourceId: CHARACTER_ID,
      targetId: SECOND_CHARACTER_ID,
      note: "第二章再次确认同盟。"
    });
    expect(
      (updatedRelations[0]?.["evidence"] as readonly Record<string, unknown>[]).map(
        (entry) => entry["chapterId"]
      )
    ).toEqual(["ch_01", "ch_02"]);
  });

  test("keeps directed relationship IDs stable across chapter observations", () => {
    const first = materialize({
      observations: [
        observation("character.relationship", "林默", "character_relationship", {
          targetMention: "顾岚",
          relationType: "character.trust",
          direction: "directed"
        })
      ]
    });
    const second = materialize(
      {
        observations: [
          observation("character.relationship", "林默", "character_relationship", {
            targetMention: "顾岚",
            relationType: "character.trust",
            direction: "directed"
          })
        ]
      },
      { chapterId: "ch_02", chapterChecksum: "e".repeat(64) }
    );

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    const firstRelation = requireAt(
      operationValue(first.value, CHARACTER_ID, "/relations") as StoryAnalysisAsset["relations"],
      0,
      "Expected the first directed relation."
    );
    const secondRelation = requireAt(
      operationValue(second.value, CHARACTER_ID, "/relations") as StoryAnalysisAsset["relations"],
      0,
      "Expected the second directed relation."
    );
    expect(secondRelation["relationId"]).toBe(firstRelation["relationId"]);
  });

  test("accumulates repeated relationship observations into one canonical replacement", () => {
    const first = observation("character.relationship", "林默", "character_relationship", {
      targetMention: "顾岚",
      relationType: "character.trust",
      direction: "directed",
      status: "active",
      note: "第一处关系证据。"
    });
    const second = observation("character.relationship", "林默", "character_relationship", {
      targetMention: "顾岚",
      relationType: "character.trust",
      direction: "directed",
      status: "active",
      note: "第二处关系证据。"
    });
    second.evidence = [evidenceForExcerpt("顾岚把铜钥匙交给他。")];

    const result = materialize({ observations: [first, second] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const relations = operationValue(
      result.value,
      CHARACTER_ID,
      "/relations"
    ) as StoryAnalysisAsset["relations"];
    expect(relations).toHaveLength(1);
    expect(relations[0]).toMatchObject({
      sourceId: CHARACTER_ID,
      targetId: SECOND_CHARACTER_ID,
      relationType: "character.trust",
      status: "active",
      note: "第一处关系证据。\n第二处关系证据。"
    });
    expect(relations[0]?.["evidence"]).toHaveLength(2);
    expect(result.value.factDeltas).toHaveLength(1);
    expect(result.value.factDeltas[0]?.observationIds).toHaveLength(2);
    expect(result.value.records).toEqual([
      expect.objectContaining({ recordType: "change", status: "pending" })
    ]);
  });

  test("deduplicates repeated relationship notes by line in stable order", () => {
    const first = observation("character.relationship", "林默", "character_relationship", {
      targetMention: "顾岚",
      relationType: "character.trust",
      direction: "directed",
      status: "active",
      note: "第一行\n共享行"
    });
    const second = observation("character.relationship", "林默", "character_relationship", {
      targetMention: "顾岚",
      relationType: "character.trust",
      direction: "directed",
      status: "active",
      note: "共享行\n第二行"
    });
    const result = materialize({ observations: [first, second, structuredClone(second)] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const relation = requireAt(
      operationValue(result.value, CHARACTER_ID, "/relations") as StoryAnalysisAsset["relations"],
      0,
      "Expected the merged relationship."
    );
    expect(relation["note"]).toBe("第一行\n共享行\n第二行");
    expect(relation["evidence"]).toHaveLength(1);
    expect(result.value.factDeltas[0]?.observationIds).toHaveLength(3);
  });

  test("accumulates distinct relationships owned by one character without replacement conflicts", () => {
    const result = materialize({
      observations: [
        observation("character.relationship", "林默", "character_relationship", {
          targetMention: "顾岚",
          relationType: "character.trust",
          direction: "directed"
        }),
        observation("character.relationship", "林默", "character_relationship", {
          targetMention: "顾岚",
          relationType: "character.owes-debt",
          direction: "directed"
        })
      ]
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const relations = operationValue(
      result.value,
      CHARACTER_ID,
      "/relations"
    ) as StoryAnalysisAsset["relations"];
    expect(relations.map((relation) => relation["relationType"])).toEqual([
      "character.trust",
      "character.owes-debt"
    ]);
    expect(result.value.factDeltas).toHaveLength(1);
    expect(result.value.records).toEqual([
      expect.objectContaining({ recordType: "change", status: "pending" })
    ]);
  });

  test("keeps independent relationship owners in separate consistency groups", () => {
    const result = materialize({
      observations: [
        observation("character.relationship", "林默", "character_relationship", {
          targetMention: "顾岚",
          relationType: "character.trust",
          direction: "directed"
        }),
        observation("character.relationship", "顾岚", "character_relationship", {
          targetMention: "林默",
          relationType: "character.owes-debt",
          direction: "directed"
        })
      ]
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.factDeltas).toHaveLength(2);
    expect(new Set(result.value.factDeltas.map((delta) => delta.consistencyGroupId))).toHaveLength(
      2
    );
    expect(
      result.value.factDeltas.filter((delta) => delta.target?.assetId === CHARACTER_ID)
    ).toHaveLength(1);
    expect(
      result.value.factDeltas.filter((delta) => delta.target?.assetId === SECOND_CHARACTER_ID)
    ).toHaveLength(1);
  });

  test("keeps an independent relationship when another semantic relationship conflicts", () => {
    const result = materialize({
      observations: [
        observation("character.relationship", "林默", "character_relationship", {
          targetMention: "顾岚",
          relationType: "character.trust",
          direction: "directed",
          status: "active"
        }),
        observation("character.relationship", "林默", "character_relationship", {
          targetMention: "顾岚",
          relationType: "character.trust",
          direction: "directed",
          status: "ended"
        }),
        observation("character.relationship", "林默", "character_relationship", {
          targetMention: "顾岚",
          relationType: "character.owes-debt",
          direction: "directed",
          status: "active"
        })
      ]
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const relations = operationValue(
      result.value,
      CHARACTER_ID,
      "/relations"
    ) as StoryAnalysisAsset["relations"];
    expect(relations).toHaveLength(1);
    expect(relations[0]).toMatchObject({
      relationType: "character.owes-debt",
      status: "active"
    });
    expect(result.value.factDeltas).toHaveLength(1);
    expect(result.value.records).toEqual([
      expect.objectContaining({ recordType: "review_issue", issueType: "conflict" }),
      expect.objectContaining({
        recordType: "change",
        target: expect.objectContaining({ assetId: CHARACTER_ID })
      })
    ]);
  });

  test("updates both sides of an explicit inverse relationship atomically", () => {
    const result = materialize(
      {
        observations: [
          observation("character.relationship", "林默", "character_relationship", {
            targetMention: "顾岚",
            relationType: "character.trust",
            direction: "directed",
            status: "ended"
          })
        ]
      },
      {
        chapterId: "ch_02",
        chapterChecksum: "d".repeat(64),
        assets: assetsWithExplicitRelationship(true)
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const primaryRelations = operationValue(
      result.value,
      CHARACTER_ID,
      "/relations"
    ) as StoryAnalysisAsset["relations"];
    const inverseRelations = operationValue(
      result.value,
      SECOND_CHARACTER_ID,
      "/relations"
    ) as StoryAnalysisAsset["relations"];
    expect(primaryRelations[0]).toMatchObject({
      relationId: `rel_${"a".repeat(32)}`,
      status: "ended",
      validFromChapterId: "ch_01",
      validToChapterId: "ch_02"
    });
    expect(inverseRelations[0]).toMatchObject({
      relationId: `rel_${"b".repeat(32)}`,
      status: "ended",
      validFromChapterId: "ch_01",
      validToChapterId: "ch_02"
    });
    expect(result.value.factDeltas).toHaveLength(2);
    expect(new Set(result.value.factDeltas.map((delta) => delta.consistencyGroupId))).toHaveLength(
      1
    );

    const missingInverse = materialize(
      {
        observations: [
          observation("character.relationship", "林默", "character_relationship", {
            targetMention: "顾岚",
            relationType: "character.trust",
            direction: "directed",
            status: "ended"
          })
        ]
      },
      { assets: assetsWithExplicitRelationship(false) }
    );
    expect(missingInverse.ok).toBe(true);
    if (!missingInverse.ok) return;
    expect(missingInverse.value.factDeltas).toEqual([]);
    expect(missingInverse.value.records).toEqual([
      expect.objectContaining({ recordType: "review_issue", issueType: "ambiguity" })
    ]);

    const inconsistentAssets = assetsWithExplicitRelationship(true).map((entry) =>
      entry.asset.id === SECOND_CHARACTER_ID
        ? {
            ...entry,
            asset: {
              ...entry.asset,
              relations: entry.asset.relations.map((relation) => ({
                ...relation,
                status: "uncertain"
              }))
            }
          }
        : entry
    );
    const inconsistentInverse = materialize(
      {
        observations: [
          observation("character.relationship", "林默", "character_relationship", {
            targetMention: "顾岚",
            relationType: "character.trust",
            direction: "directed",
            status: "ended"
          })
        ]
      },
      { assets: inconsistentAssets }
    );
    expect(inconsistentInverse.ok).toBe(true);
    if (!inconsistentInverse.ok) return;
    expect(inconsistentInverse.value.factDeltas).toEqual([]);
    expect(inconsistentInverse.value.records).toEqual([
      expect.objectContaining({ recordType: "review_issue", issueType: "ambiguity" })
    ]);
  });

  test("drops an explicit inverse pair for opposing statuses in either observation order", () => {
    const orders = [
      [
        observation("character.relationship", "林默", "character_relationship", {
          targetMention: "顾岚",
          relationType: "character.trust",
          direction: "directed",
          status: "ended"
        }),
        observation("character.relationship", "顾岚", "character_relationship", {
          targetMention: "林默",
          relationType: "character.trusted-by",
          direction: "directed",
          status: "active"
        })
      ],
      [
        observation("character.relationship", "顾岚", "character_relationship", {
          targetMention: "林默",
          relationType: "character.trusted-by",
          direction: "directed",
          status: "active"
        }),
        observation("character.relationship", "林默", "character_relationship", {
          targetMention: "顾岚",
          relationType: "character.trust",
          direction: "directed",
          status: "ended"
        })
      ]
    ];

    for (const observations of orders) {
      const result = materialize(
        { observations },
        {
          chapterId: "ch_02",
          chapterChecksum: "c".repeat(64),
          assets: assetsWithExplicitRelationship(true)
        }
      );
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.value.factDeltas).toEqual([]);
      expect(result.value.records).toEqual([
        expect.objectContaining({ recordType: "review_issue", issueType: "conflict" })
      ]);
    }
  });

  test.each([
    ["world.location", "北站", LOCATION_ID, "geography", "位于北境铁路枢纽"],
    ["world.faction", "北境商会", FACTION_ID, "structure", "由七席理事会共治"],
    ["world.rule", "誓约律", RULE_ID, "statement", "真名誓约不可撤回"],
    ["world.glossary", "灰潮", GLOSSARY_ID, "definition", "每十年出现的灵力低谷"],
    ["world.item", "铜钥匙", ITEM_ID, "appearance", "齿缘有一道新鲜裂纹"],
    ["world.lore", "北境旧史", LORE_ID, "body", "北境曾由三座自治城共同统治。"]
  ] as const)(
    "routes strict %s field updates for an existing world asset",
    (expectedType, mention, assetId, field, value) => {
      const candidate = observation(
        "character.information",
        mention,
        "world_detail",
        { fields: { [field]: value } },
        "narrator_asserted",
        expectedType
      );

      const result = materialize({ observations: [candidate] });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.records).toEqual([
        expect.objectContaining({
          recordType: "change",
          target: expect.objectContaining({ assetId }),
          evidence: [
            expect.objectContaining({ start: expect.any(Number), end: expect.any(Number) })
          ],
          epistemicStatus: "narrator_asserted",
          operations: [
            expect.objectContaining({
              path: `/details/${field}`,
              value
            })
          ]
        })
      ]);
    }
  );

  test("records character and item state changes in stateHistory through one timeline event", () => {
    const itemState = observation(
      "character.resource",
      "铜钥匙",
      "world_item_state",
      { state: "齿缘开裂" },
      "narrator_asserted",
      "world.item"
    );
    const result = materialize({
      observations: [
        observation("character.physical_state", "林默", "character_physical", {
          state: "右手擦伤"
        }),
        itemState
      ]
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const changes = result.value.records.filter((record) => record.recordType === "change");
    const characterChange = changes.find((record) => record.target?.assetId === CHARACTER_ID);
    const itemChange = changes.find((record) => record.target?.assetId === ITEM_ID);
    const timelineChange = changes.find((record) => record.target?.assetId === "timeline_main");
    expect(characterChange).toBeDefined();
    expect(itemChange).toBeDefined();
    expect(timelineChange).toBeDefined();

    const characterHistory = characterChange?.operations.find(
      (operation) => operation.path === "/details/stateHistory"
    )?.value as readonly Record<string, unknown>[] | undefined;
    const itemHistory = itemChange?.operations.find(
      (operation) => operation.path === "/details/stateHistory"
    )?.value as readonly Record<string, unknown>[] | undefined;
    const eventId = characterHistory?.at(-1)?.["timelineEventId"];
    expect(eventId).toMatch(/^evt_[a-f0-9]{32}$/u);
    expect(itemHistory?.at(-1)?.["timelineEventId"]).toBe(eventId);
    expect(
      characterChange?.operations.find(
        (operation) => operation.path === "/details/currentState/asOfEventId"
      )?.value
    ).toBe(eventId);
    expect(
      itemChange?.operations.find((operation) => operation.path === "/details/asOfEventId")?.value
    ).toBe(eventId);
    expect(timelineChange?.consistencyGroupId).toBe(characterChange?.consistencyGroupId);
    expect(itemChange?.consistencyGroupId).toBe(characterChange?.consistencyGroupId);
    expect(timelineChange?.operations).toEqual([
      expect.objectContaining({
        path: "/details/events",
        value: [
          expect.objectContaining({
            eventId,
            stateChanges: expect.arrayContaining([
              expect.objectContaining({
                subjectId: CHARACTER_ID,
                path: "/details/currentState/physical"
              }),
              expect.objectContaining({ subjectId: ITEM_ID, path: "/details/state" })
            ])
          })
        ]
      })
    ]);
    expect(validateStoryAnalysisBundle(bundleFor(result.value))).toEqual({
      valid: true,
      issues: []
    });
  });

  test("moves an item between holders through one complete consistency group", () => {
    const result = materialize(
      {
        observations: [
          observation(
            "character.resource",
            "铜钥匙",
            "world_item_holder",
            { holderMention: "林默" },
            "narrator_asserted",
            "world.item"
          )
        ]
      },
      { assets: assetsWithItemHolder(SECOND_CHARACTER_ID) }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(operationValue(result.value, ITEM_ID, "/details/holderId")).toBe(CHARACTER_ID);
    expect(
      operationValue(result.value, SECOND_CHARACTER_ID, "/details/currentState/heldItemIds")
    ).toEqual([]);
    expect(operationValue(result.value, CHARACTER_ID, "/details/currentState/heldItemIds")).toEqual(
      [ITEM_ID]
    );
    expect(new Set(result.value.factDeltas.map((delta) => delta.consistencyGroupId))).toHaveLength(
      1
    );
  });

  test("clears the old character projection when an item holder becomes null", () => {
    const result = materialize(
      {
        observations: [
          observation(
            "character.resource",
            "铜钥匙",
            "world_item_holder",
            { holderMention: null },
            "narrator_asserted",
            "world.item"
          )
        ]
      },
      { assets: assetsWithItemHolder(SECOND_CHARACTER_ID) }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(operationValue(result.value, ITEM_ID, "/details/holderId")).toBeNull();
    expect(
      operationValue(result.value, SECOND_CHARACTER_ID, "/details/currentState/heldItemIds")
    ).toEqual([]);
    expect(new Set(result.value.factDeltas.map((delta) => delta.consistencyGroupId))).toHaveLength(
      1
    );
  });

  test("routes dangling persisted item holders to review without emitting partial patches", () => {
    const missingHolderId = `chr_${"9".repeat(32)}`;
    const result = materialize(
      {
        observations: [
          observation(
            "character.resource",
            "铜钥匙",
            "world_item_holder",
            { holderMention: "林默" },
            "narrator_asserted",
            "world.item"
          )
        ]
      },
      { assets: assetsWithItemHolder(missingHolderId) }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.factDeltas).toEqual([]);
    expect(result.value.records).toEqual([
      expect.objectContaining({ recordType: "review_issue", issueType: "ambiguity" })
    ]);
  });

  test("treats character held-item lists as transfers and removals, not one-sided projections", () => {
    const transfer = materialize(
      {
        observations: [
          observation("character.resource", "林默", "character_held_items", {
            itemMentions: ["铜钥匙"]
          })
        ]
      },
      { assets: assetsWithItemHolder(SECOND_CHARACTER_ID) }
    );
    expect(transfer.ok).toBe(true);
    if (!transfer.ok) return;
    expect(operationValue(transfer.value, ITEM_ID, "/details/holderId")).toBe(CHARACTER_ID);
    expect(
      operationValue(transfer.value, SECOND_CHARACTER_ID, "/details/currentState/heldItemIds")
    ).toEqual([]);
    expect(
      operationValue(transfer.value, CHARACTER_ID, "/details/currentState/heldItemIds")
    ).toEqual([ITEM_ID]);

    const removal = materialize(
      {
        observations: [
          observation("character.resource", "林默", "character_held_items", {
            itemMentions: []
          })
        ]
      },
      { assets: assetsWithItemHolder(CHARACTER_ID) }
    );
    expect(removal.ok).toBe(true);
    if (!removal.ok) return;
    expect(operationValue(removal.value, ITEM_ID, "/details/holderId")).toBeNull();
    expect(
      operationValue(removal.value, CHARACTER_ID, "/details/currentState/heldItemIds")
    ).toEqual([]);
    expect(new Set(removal.value.factDeltas.map((delta) => delta.consistencyGroupId))).toHaveLength(
      1
    );
  });

  test("accumulates two item assignments to one holder into one character delta", () => {
    const result = materialize({
      observations: [
        observation(
          "character.resource",
          "铜钥匙",
          "world_item_holder",
          { holderMention: "林默" },
          "narrator_asserted",
          "world.item"
        ),
        observation(
          "character.resource",
          "银徽章",
          "world_item_holder",
          { holderMention: "林默" },
          "narrator_asserted",
          "world.item"
        )
      ]
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(operationValue(result.value, CHARACTER_ID, "/details/currentState/heldItemIds")).toEqual(
      [ITEM_ID, SECOND_ITEM_ID]
    );
    expect(operationValue(result.value, ITEM_ID, "/details/holderId")).toBe(CHARACTER_ID);
    expect(operationValue(result.value, SECOND_ITEM_ID, "/details/holderId")).toBe(CHARACTER_ID);
    expect(
      result.value.factDeltas.filter((delta) => delta.target?.assetId === CHARACTER_ID)
    ).toHaveLength(1);
    expect(new Set(result.value.factDeltas.map((delta) => delta.consistencyGroupId))).toHaveLength(
      1
    );
  });

  test("accumulates cross transfers from the shared run baseline without replacement conflicts", () => {
    const result = materialize(
      {
        observations: [
          observation(
            "character.resource",
            "铜钥匙",
            "world_item_holder",
            { holderMention: "顾岚" },
            "narrator_asserted",
            "world.item"
          ),
          observation(
            "character.resource",
            "银徽章",
            "world_item_holder",
            { holderMention: "林默" },
            "narrator_asserted",
            "world.item"
          )
        ]
      },
      { assets: assetsWithTwoItemHolders() }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(operationValue(result.value, CHARACTER_ID, "/details/currentState/heldItemIds")).toEqual(
      [SECOND_ITEM_ID]
    );
    expect(
      operationValue(result.value, SECOND_CHARACTER_ID, "/details/currentState/heldItemIds")
    ).toEqual([ITEM_ID]);
    expect(operationValue(result.value, ITEM_ID, "/details/holderId")).toBe(SECOND_CHARACTER_ID);
    expect(operationValue(result.value, SECOND_ITEM_ID, "/details/holderId")).toBe(CHARACTER_ID);
    expect(result.value.records.every((record) => record.recordType === "change")).toBe(true);
  });

  test("drops the complete holder consistency group when one item receives conflicting holders", () => {
    const result = materialize({
      observations: [
        observation(
          "character.resource",
          "铜钥匙",
          "world_item_holder",
          { holderMention: "林默" },
          "narrator_asserted",
          "world.item"
        ),
        observation(
          "character.resource",
          "铜钥匙",
          "world_item_holder",
          { holderMention: "顾岚" },
          "narrator_asserted",
          "world.item"
        )
      ]
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.factDeltas).toEqual([]);
    expect(result.value.records).toEqual([
      expect.objectContaining({ recordType: "review_issue", issueType: "conflict" })
    ]);
  });

  test("deterministically emits an overdue foreshadow review issue from outline chapter order", () => {
    const overdueAssets = assets().map((entry): StoryAnalysisAssetRead => {
      if (entry.asset.id === FORESHADOW_ID) {
        return {
          ...entry,
          asset: {
            ...entry.asset,
            details: {
              ...entry.asset.details,
              trackingStatus: "progressing",
              plannedPayoffChapterId: "ch_02"
            }
          }
        };
      }
      if (entry.asset.id === "outline_main") {
        return {
          ...entry,
          asset: {
            ...entry.asset,
            details: {
              ...entry.asset.details,
              volumes: [
                {
                  volumeId: `vol_${"b".repeat(32)}`,
                  entryRevision: 1,
                  title: "第一卷",
                  summary: "",
                  goals: [],
                  chapterIds: ["ch_01", "ch_02", "ch_03"]
                }
              ]
            }
          }
        };
      }
      return entry;
    });

    const result = materialize({ observations: [] }, { chapterId: "ch_03", assets: overdueAssets });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.records).toEqual([
      expect.objectContaining({
        recordType: "review_issue",
        issueType: "overdue_foreshadow",
        affectedRefs: [`story_bible:${FORESHADOW_ID}`],
        claims: [
          expect.objectContaining({
            value: expect.objectContaining({
              foreshadowId: FORESHADOW_ID,
              plannedPayoffChapterId: "ch_02",
              currentChapterId: "ch_03"
            }),
            evidence: [expect.objectContaining({ start: 0, end: Array.from(BODY).length })]
          })
        ]
      })
    ]);
    expect(validateStoryAnalysisBundle(bundleFor(result.value, "ch_03"))).toEqual({
      valid: true,
      issues: []
    });
  });

  test("materializes reviewable field diffs with evidence and epistemic status for all five data categories", () => {
    const result = materialize({
      observations: [
        observation("character.physical_state", "林默", "character_physical", {
          state: "轻微擦伤"
        }),
        observation(
          "character.information",
          "北站",
          "world_detail",
          { fields: { culture: "旅客会在站台留下纸鹤" } },
          "narrator_asserted",
          "world.location"
        ),
        observation(
          "timeline",
          "主线大纲",
          "outline_actual_outcome",
          {
            text: "林默拿到钥匙并抵达北站。"
          },
          "narrator_asserted",
          "outline"
        ),
        observation("foreshadow", "雨夜钥匙", "foreshadow_milestone", {
          kind: "progress",
          note: "钥匙转交给林默。"
        }),
        observation("timeline", "主时间线", "timeline_event", {
          title: "钥匙转交",
          summary: "顾岚把钥匙交给林默。"
        })
      ]
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const targetTypes = new Map(assets().map((entry) => [entry.asset.id, entry.asset.type]));
    const suggestions = result.value.records.filter((record) => record.recordType === "change");
    expect(
      new Set(suggestions.map((record) => targetTypes.get(record.target?.assetId ?? "")))
    ).toEqual(new Set(["character", "world.location", "outline", "foreshadow", "timeline.events"]));
    for (const suggestion of suggestions) {
      expect(suggestion.evidence.length).toBeGreaterThan(0);
      expect(suggestion.epistemicStatus).toBe("narrator_asserted");
      expect(suggestion.operations.length).toBeGreaterThan(0);
      expect(suggestion.operations.every((operation) => "beforeValueChecksum" in operation)).toBe(
        true
      );
    }
  });

  test("deduplicates identical facts and turns contradictory field values into a review issue", () => {
    const same = observation("character.location", "林默", "character_location", {
      locationMention: "北站"
    });
    const duplicate = materialize({ observations: [same, structuredClone(same)] });
    expect(duplicate.ok).toBe(true);
    if (duplicate.ok) {
      expect(duplicate.value.factDeltas).toHaveLength(2);
      expect(duplicate.value.records).toHaveLength(2);
      expect(
        duplicate.value.factDeltas.find((delta) => delta.target?.assetId === CHARACTER_ID)
          ?.observationIds
      ).toHaveLength(2);
    }

    const conflict = materialize({
      observations: [
        same,
        observation("character.location", "林默", "character_location", {
          locationMention: "南站"
        })
      ]
    });
    expect(conflict.ok).toBe(true);
    if (!conflict.ok) return;
    expect(conflict.value.factDeltas).toEqual([]);
    expect(conflict.value.records).toEqual([
      expect.objectContaining({ recordType: "review_issue", issueType: "conflict" })
    ]);
  });

  test("rebases unrelated asset revisions but marks relevant field changes stale", () => {
    const result = materialize({
      observations: [
        observation("character.location", "林默", "character_location", {
          locationMention: "北站"
        })
      ]
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const original = bundleFor(result.value);
    const unrelatedAssets = assets().map((entry) =>
      entry.asset.id === CHARACTER_ID
        ? {
            ...entry,
            asset: { ...entry.asset, title: "林默（修订）", revision: 4 }
          }
        : entry
    );

    const rebased = refreshStoryAnalysisStaleness({
      bundle: original,
      currentChapterChecksum: CHAPTER_HASH,
      assets: unrelatedAssets,
      indexRevision: INDEX_REVISION,
      updatedAt: "2026-07-31T00:00:05.000Z"
    });
    const rebasedSuggestion = rebased.records.find((entry) => entry.recordType === "change");
    expect(rebasedSuggestion?.status).toBe("pending");
    expect(
      rebasedSuggestion?.dependencies.find((entry) => entry.kind === "asset_fields")
    ).toMatchObject({ baseRevision: 4 });

    const relevantAssets = assets().map((entry) =>
      entry.asset.id === CHARACTER_ID
        ? {
            ...entry,
            asset: {
              ...entry.asset,
              revision: 4,
              details: {
                ...entry.asset.details,
                currentState: {
                  ...(entry.asset.details["currentState"] as Record<string, unknown>),
                  locationId: OTHER_LOCATION_ID
                }
              }
            }
          }
        : entry
    ) as StoryAnalysisAssetRead[];
    const stale = refreshStoryAnalysisStaleness({
      bundle: original,
      currentChapterChecksum: CHAPTER_HASH,
      assets: relevantAssets,
      indexRevision: INDEX_REVISION,
      updatedAt: "2026-07-31T00:00:05.000Z"
    });
    expect(stale.records.find((entry) => entry.recordType === "change")).toMatchObject({
      status: "stale",
      revision: 2
    });
  });

  test("enforces suggestion and issue transitions with record revision CAS", () => {
    const suggestionResult = materialize({
      observations: [
        observation("character.location", "林默", "character_location", {
          locationMention: "北站"
        })
      ]
    });
    expect(suggestionResult.ok).toBe(true);
    if (!suggestionResult.ok) return;
    const suggestionBundle = bundleFor(suggestionResult.value);
    const suggestion = requireAt(suggestionBundle.records, 0, "Expected a suggestion record.");
    const accepted = transitionStoryAnalysisRecord({
      bundle: suggestionBundle,
      recordId: suggestion.recordType === "change" ? suggestion.suggestionId : suggestion.issueId,
      expectedRevision: 1,
      transition: { status: "accepted" },
      updatedAt: "2026-07-31T00:00:05.000Z"
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.value.records[0]).toMatchObject({ status: "accepted", revision: 2 });
    expect(
      transitionStoryAnalysisRecord({
        bundle: accepted.value,
        recordId: suggestion.recordType === "change" ? suggestion.suggestionId : suggestion.issueId,
        expectedRevision: 1,
        transition: { status: "rejected" },
        updatedAt: "2026-07-31T00:00:06.000Z"
      })
    ).toMatchObject({ ok: false, error: { code: "STORY_ANALYSIS_RECORD_REVISION_CONFLICT" } });

    const issueResult = materialize({
      observations: [
        observation(
          "character.location",
          "林默",
          "character_location",
          { locationMention: "北站" },
          "rumor"
        )
      ]
    });
    expect(issueResult.ok).toBe(true);
    if (!issueResult.ok) return;
    const issueBundle = bundleFor(issueResult.value);
    const issue = requireAt(issueBundle.records, 0, "Expected a review issue record.");
    const resolved = transitionStoryAnalysisRecord({
      bundle: issueBundle,
      recordId: issue.recordType === "review_issue" ? issue.issueId : issue.suggestionId,
      expectedRevision: 1,
      transition: {
        status: "resolved",
        decision: "Keep this as character knowledge only.",
        changeSetId: null,
        actor: "author"
      },
      updatedAt: "2026-07-31T00:00:05.000Z"
    });
    expect(resolved).toMatchObject({
      ok: true,
      value: { records: [{ status: "resolved", revision: 2 }] }
    });
  });

  test("field checksums ignore unrelated roots and remain deterministic", () => {
    const character = requireValue(
      assets().find((entry) => entry.asset.id === CHARACTER_ID),
      "Expected the character fixture."
    );
    const selectors = ["/details/currentState/locationId"];
    const checksum = checksumStoryAnalysisSelectors(character.asset, selectors);
    expect(
      checksumStoryAnalysisSelectors({ ...character.asset, title: "Unrelated" }, selectors)
    ).toBe(checksum);
  });
});

function requireAt<T>(values: readonly T[], index: number, message: string): T {
  return requireValue(values[index], message);
}

function requireValue<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

function materialize(
  output: unknown,
  overrides: {
    readonly chapterId?: string;
    readonly chapterChecksum?: string;
    readonly assets?: StoryAnalysisAssetRead[];
  } = {}
) {
  return materializeStoryObserverOutput({
    analysisRunId: RUN_ID,
    chapter: {
      chapterId: overrides.chapterId ?? "ch_01",
      checksum: overrides.chapterChecksum ?? CHAPTER_HASH,
      body: BODY
    },
    assets: overrides.assets ?? assets(),
    indexRevision: INDEX_REVISION,
    promptVersion: "story-observer-v1",
    extractorVersion: "story-fact-router-v1",
    output,
    createdAt: "2026-07-31T00:00:03.000Z"
  });
}

function operationValue(
  output: MaterializedStoryObserverOutput,
  assetId: string,
  path: string
): unknown {
  const delta = output.factDeltas.find((entry) => entry.target?.assetId === assetId);
  return delta?.operations.find((operation) => operation.path === path)?.value;
}

function assetsWithItemHolder(holderId: string | null): StoryAnalysisAssetRead[] {
  return assets().map((entry): StoryAnalysisAssetRead => {
    if (entry.asset.type === "character") {
      return {
        ...entry,
        asset: {
          ...entry.asset,
          details: {
            ...entry.asset.details,
            currentState: {
              ...(entry.asset.details["currentState"] as Record<string, unknown>),
              heldItemIds: entry.asset.id === holderId ? [ITEM_ID] : []
            }
          }
        }
      };
    }
    if (entry.asset.id === ITEM_ID) {
      return {
        ...entry,
        asset: {
          ...entry.asset,
          details: { ...entry.asset.details, holderId }
        }
      };
    }
    return entry;
  });
}

function assetsWithTwoItemHolders(): StoryAnalysisAssetRead[] {
  return assets().map((entry): StoryAnalysisAssetRead => {
    if (entry.asset.type === "character") {
      return {
        ...entry,
        asset: {
          ...entry.asset,
          details: {
            ...entry.asset.details,
            currentState: {
              ...(entry.asset.details["currentState"] as Record<string, unknown>),
              heldItemIds:
                entry.asset.id === CHARACTER_ID
                  ? [ITEM_ID]
                  : entry.asset.id === SECOND_CHARACTER_ID
                    ? [SECOND_ITEM_ID]
                    : []
            }
          }
        }
      };
    }
    if (entry.asset.id === ITEM_ID || entry.asset.id === SECOND_ITEM_ID) {
      return {
        ...entry,
        asset: {
          ...entry.asset,
          details: {
            ...entry.asset.details,
            holderId: entry.asset.id === ITEM_ID ? CHARACTER_ID : SECOND_CHARACTER_ID
          }
        }
      };
    }
    return entry;
  });
}

function assetsWithExplicitRelationship(includeInverse: boolean): StoryAnalysisAssetRead[] {
  const primaryRelation: StoryAnalysisAsset["relations"][number] = {
    relationId: `rel_${"a".repeat(32)}`,
    sourceId: CHARACTER_ID,
    targetId: SECOND_CHARACTER_ID,
    relationType: "character.trust",
    direction: "directed",
    status: "active",
    validFromChapterId: "ch_01",
    validToChapterId: null,
    inversePolicy: "explicit",
    inverseRelationId: `rel_${"b".repeat(32)}`,
    evidence: [],
    note: ""
  };
  const inverseRelation: StoryAnalysisAsset["relations"][number] = {
    relationId: `rel_${"b".repeat(32)}`,
    sourceId: SECOND_CHARACTER_ID,
    targetId: CHARACTER_ID,
    relationType: "character.trusted-by",
    direction: "directed",
    status: "active",
    validFromChapterId: "ch_01",
    validToChapterId: null,
    inversePolicy: "explicit",
    inverseRelationId: `rel_${"a".repeat(32)}`,
    evidence: [],
    note: ""
  };
  return assets().map((entry) => {
    if (entry.asset.id === CHARACTER_ID) {
      return { ...entry, asset: { ...entry.asset, relations: [primaryRelation] } };
    }
    if (entry.asset.id === SECOND_CHARACTER_ID) {
      return {
        ...entry,
        asset: { ...entry.asset, relations: includeInverse ? [inverseRelation] : [] }
      };
    }
    return entry;
  });
}

function observation(
  domain: string,
  subjectMention: string,
  kind: string,
  value: unknown,
  epistemicStatus = "narrator_asserted",
  expectedTypeOverride?: StoryAnalysisAsset["type"]
): Record<string, unknown> {
  const expectedTypes: Record<string, string> = {
    "character.behavior": "character",
    "character.location": "character",
    "character.resource": "character",
    "character.relationship": "character",
    "character.emotion": "character",
    "character.information": "character",
    foreshadow: "foreshadow",
    timeline: "timeline.events",
    "character.physical_state": "character"
  };
  return {
    domain,
    subjectMention,
    expectedType: expectedTypeOverride ?? expectedTypes[domain],
    fact: { kind, value },
    evidence: [evidence()],
    epistemicStatus,
    confidence: 0.9,
    reason: "The saved chapter states this fact."
  };
}

function evidence(): { start: number; end: number; excerpt: string } {
  return evidenceForExcerpt("林默到了北站。");
}

function evidenceForExcerpt(excerpt: string): { start: number; end: number; excerpt: string } {
  const body = Array.from(BODY);
  const excerptPoints = Array.from(excerpt);
  const start = body.join("").indexOf(excerpt);
  return { start, end: start + excerptPoints.length, excerpt };
}

function bundleFor(
  output: MaterializedStoryObserverOutput,
  chapterId = "ch_01"
): StoryAnalysisBundle {
  return {
    schemaVersion: "1.1",
    analysisRun: {
      schemaVersion: "1.1",
      analysisRunId: RUN_ID,
      trigger: "manual",
      createdAt: "2026-07-31T00:00:00.000Z",
      startedAt: "2026-07-31T00:00:01.000Z",
      completedAt: "2026-07-31T00:00:02.000Z",
      chapter: { chapterId, checksum: CHAPTER_HASH },
      contextSnapshot: { contextSnapshotId: `ctx_${"7".repeat(32)}`, checksum: "c".repeat(64) },
      recalledAssets: assets().map((entry) => ({
        assetId: entry.asset.id,
        revision: entry.asset.revision,
        checksum: entry.checksum,
        reason: "test-fixture",
        truncated: false
      })),
      runtime: {
        providerId: "test-provider",
        modelId: "test-model",
        promptVersion: "story-observer-v1",
        promptChecksum: "d".repeat(64),
        extractorVersion: "story-fact-router-v1"
      },
      validation: output.validation,
      usage: { usageRecordId: null, inputTokens: 10, outputTokens: 10, estimatedCost: null },
      status: "completed",
      failure: null
    },
    observations: output.observations,
    factDeltas: output.factDeltas,
    records: output.records
  };
}

function assets(): StoryAnalysisAssetRead[] {
  return [
    asset("character", CHARACTER_ID, "林默", ["阿默"], {
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
    }),
    asset("character", SECOND_CHARACTER_ID, "顾岚", [], {
      currentState: {},
      knowledgeStates: [],
      stateHistory: []
    }),
    asset("world.location", LOCATION_ID, "北站", [], {}),
    asset("world.location", OTHER_LOCATION_ID, "南站", [], {}),
    asset("world.faction", FACTION_ID, "北境商会", [], {}),
    asset("world.rule", RULE_ID, "誓约律", [], {}),
    asset("world.glossary", GLOSSARY_ID, "灰潮", [], {}),
    asset("world.item", ITEM_ID, "铜钥匙", [], {
      holderId: null,
      currentLocationId: null,
      state: "完好",
      asOfChapterId: null,
      asOfEventId: null,
      stateHistory: []
    }),
    asset("world.item", SECOND_ITEM_ID, "银徽章", [], {
      holderId: null,
      currentLocationId: null,
      state: "完好",
      asOfChapterId: null,
      asOfEventId: null,
      stateHistory: []
    }),
    asset("world.lore", LORE_ID, "北境旧史", [], {}),
    asset("foreshadow", FORESHADOW_ID, "雨夜钥匙", [], {
      trackingStatus: "planted",
      milestones: []
    }),
    asset("timeline.events", "timeline_main", "主时间线", [], { events: [] }),
    asset("outline", "outline_main", "主线大纲", [], {
      volumes: [],
      chapterOutlines: [
        {
          chapterOutlineId: `cho_${"8".repeat(32)}`,
          chapterId: "ch_01",
          entryRevision: 1,
          goal: "",
          conflict: "",
          turningPoint: "",
          notes: "",
          characterIds: [],
          locationIds: [],
          foreshadowIds: [],
          beats: [],
          expectedStateChanges: [],
          actualOutcome: null,
          deviations: []
        }
      ]
    })
  ];
}

function asset(
  type: StoryAnalysisAsset["type"],
  id: string,
  title: string,
  aliases: string[],
  details: Record<string, unknown>
): StoryAnalysisAssetRead {
  return {
    asset: {
      schemaVersion: "1.1",
      id,
      type,
      title,
      status: "active",
      summary: "",
      aliases,
      relations: [],
      details: details as StoryAnalysisAsset["details"],
      extensions: {},
      createdAt: "2026-07-31T00:00:00.000Z",
      updatedAt: "2026-07-31T00:00:00.000Z",
      revision: 3
    },
    checksum: id
      .padEnd(64, "0")
      .slice(-64)
      .replace(/[^a-f0-9]/g, "0")
  };
}
