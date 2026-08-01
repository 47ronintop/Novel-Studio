import { createSchemaValidator, type ValidationIssue, type ValidationResult } from "./index.js";

export const STORY_BIBLE_V11_ASSET_TYPES = [
  "character",
  "world.location",
  "world.faction",
  "world.rule",
  "world.glossary",
  "world.item",
  "world.lore",
  "outline",
  "foreshadow",
  "timeline.events"
] as const;

export type StoryBibleV11AssetType = (typeof STORY_BIBLE_V11_ASSET_TYPES)[number];
export type StoryBibleReferenceTargetType = StoryBibleV11AssetType | "timeline.event";
export type StoryBibleSchemaMode = "writeStrict" | "persistedStrict";

export interface StoryBibleSemanticValidationOptions {
  readonly assetType?: StoryBibleV11AssetType;
  /** Complete Repository-owned reference target inventory, including timeline event IDs. */
  readonly knownReferenceTargets?: ReadonlyMap<string, StoryBibleReferenceTargetType>;
  /** Invalid reference fingerprints inherited unchanged from the persisted asset. */
  readonly inheritedInvalidReferenceCounts?: ReadonlyMap<string, number>;
  /** Complete Application-owned chapter catalog for chapter reference validation. */
  readonly knownChapterIds?: ReadonlySet<string>;
  /** Missing chapter reference fingerprints inherited unchanged from the persisted asset. */
  readonly inheritedInvalidChapterReferenceCounts?: ReadonlyMap<string, number>;
  /** @deprecated Prefer knownReferenceTargets so reference types can also be checked. */
  readonly knownAssetIds?: ReadonlySet<string>;
  readonly registeredExtensionNamespaces?: ReadonlySet<string>;
  /** Repository-only compatibility for an asset upgraded in place from v1.0. */
  readonly allowLegacyId?: boolean;
}

export interface StoryBibleDeclaredReference {
  readonly path: string;
  readonly constraintKey: string;
  readonly targetId: string;
  readonly expectedTargetTypes: readonly StoryBibleReferenceTargetType[];
  readonly relationId?: string;
  readonly relationType?: string;
}

export interface StoryBibleInspectedReference extends StoryBibleDeclaredReference {
  readonly integrity: "valid" | "missing" | "type-mismatch";
  readonly actualTargetType?: StoryBibleReferenceTargetType;
}

export interface StoryBibleDeclaredChapterReference {
  readonly path: string;
  readonly constraintKey: string;
  readonly chapterId: string;
  readonly relationId?: string;
}

export interface StoryBibleInspectedChapterReference extends StoryBibleDeclaredChapterReference {
  readonly integrity: "valid" | "missing";
}

type Schema = Record<string, unknown>;

const STRING = Object.freeze({ type: "string" });
const NON_EMPTY_STRING = Object.freeze({ type: "string", minLength: 1 });
const ASSET_ID = Object.freeze({ type: "string", minLength: 1, maxLength: 128 });
const CHAPTER_ID = Object.freeze({ type: "string", pattern: "^ch_[A-Za-z0-9_-]+$" });
const HASH = Object.freeze({ type: "string", pattern: "^[a-f0-9]{64}$" });
const ENTRY_REVISION = Object.freeze({ type: "integer", minimum: 1 });

const TYPE_SCHEMA_FILE_NAMES: Readonly<Record<StoryBibleV11AssetType, string>> = Object.freeze({
  character: "story-character",
  "world.location": "story-world-location",
  "world.faction": "story-world-faction",
  "world.rule": "story-world-rule",
  "world.glossary": "story-world-glossary",
  "world.item": "story-world-item",
  "world.lore": "story-world-lore",
  outline: "story-outline",
  foreshadow: "story-foreshadow",
  "timeline.events": "story-timeline"
});

const TYPE_ID_PATTERNS: Readonly<Record<StoryBibleV11AssetType, string>> = Object.freeze({
  character: "^chr_[a-f0-9]{32}$",
  "world.location": "^loc_[a-f0-9]{32}$",
  "world.faction": "^fac_[a-f0-9]{32}$",
  "world.rule": "^rule_[a-f0-9]{32}$",
  "world.glossary": "^term_[a-f0-9]{32}$",
  "world.item": "^item_[a-f0-9]{32}$",
  "world.lore": "^lore_[a-f0-9]{32}$",
  outline: "^outline_main$",
  foreshadow: "^fsh_[a-f0-9]{32}$",
  "timeline.events": "^timeline_main$"
});

const ANY_ASSET_REFERENCE_TYPES: readonly StoryBibleV11AssetType[] = STORY_BIBLE_V11_ASSET_TYPES;
const CHARACTER_REFERENCE_TYPES = Object.freeze(["character"] as const);
const LOCATION_REFERENCE_TYPES = Object.freeze(["world.location"] as const);
const FACTION_REFERENCE_TYPES = Object.freeze(["world.faction"] as const);
const RULE_REFERENCE_TYPES = Object.freeze(["world.rule"] as const);
const GLOSSARY_REFERENCE_TYPES = Object.freeze(["world.glossary"] as const);
const ITEM_REFERENCE_TYPES = Object.freeze(["world.item"] as const);
const FORESHADOW_REFERENCE_TYPES = Object.freeze(["foreshadow"] as const);
const TIMELINE_EVENT_REFERENCE_TYPES = Object.freeze(["timeline.event"] as const);

const DETAIL_SCHEMAS: Readonly<Record<StoryBibleV11AssetType, Schema>> = Object.freeze({
  character: characterDetailsSchema(),
  "world.location": worldLocationDetailsSchema(),
  "world.faction": worldFactionDetailsSchema(),
  "world.rule": worldRuleDetailsSchema(),
  "world.glossary": worldGlossaryDetailsSchema(),
  "world.item": worldItemDetailsSchema(),
  "world.lore": worldLoreDetailsSchema(),
  outline: outlineDetailsSchema(),
  foreshadow: foreshadowDetailsSchema(),
  "timeline.events": timelineDetailsSchema()
});

export function isStoryBibleV11AssetType(value: unknown): value is StoryBibleV11AssetType {
  return (
    typeof value === "string" && (STORY_BIBLE_V11_ASSET_TYPES as readonly string[]).includes(value)
  );
}

export function storyBibleSchemaFileName(type: StoryBibleV11AssetType): string {
  return TYPE_SCHEMA_FILE_NAMES[type];
}

export function getStoryBibleKnownDetailKeys(type: StoryBibleV11AssetType): readonly string[] {
  const properties = DETAIL_SCHEMAS[type]["properties"];
  return isRecord(properties) ? Object.freeze(Object.keys(properties)) : Object.freeze([]);
}

export function createStoryBibleV11Schema(
  type: StoryBibleV11AssetType,
  mode: StoryBibleSchemaMode = "writeStrict"
): Schema {
  const properties: Schema = {
    schemaVersion: { const: "1.1" },
    id: { type: "string", pattern: TYPE_ID_PATTERNS[type] },
    type: { const: type },
    title: { type: "string", minLength: 1, maxLength: 512 },
    status: { type: "string", enum: ["active", "draft", "archived", "deleted"] },
    summary: { type: "string", maxLength: 100_000 },
    aliases: stringArray(256),
    relations: { type: "array", items: relationSchema(), maxItems: 10_000 },
    details: DETAIL_SCHEMAS[type],
    extensions: extensionSchema(),
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    revision: { type: "integer", minimum: 1 }
  };
  if (mode === "persistedStrict") {
    properties["relatedEntityIds"] = stringArray(10_000);
    properties["passthrough"] = passthroughSchema();
  }

  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: `schema.${TYPE_SCHEMA_FILE_NAMES[type]}.v1.1.${mode}`,
    title: `${type} Story Bible asset (${mode})`,
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "id",
      "type",
      "title",
      "status",
      "summary",
      "aliases",
      "relations",
      "details",
      "extensions",
      "createdAt",
      "updatedAt",
      "revision"
    ],
    properties
  };
}

export function createStoryBibleWriteCandidateSchema(
  type: StoryBibleV11AssetType,
  options: Pick<StoryBibleSemanticValidationOptions, "allowLegacyId"> = {}
): Schema {
  const full = createStoryBibleV11Schema(type, "writeStrict");
  const properties = isRecord(full["properties"]) ? { ...full["properties"] } : {};
  delete properties["updatedAt"];
  delete properties["revision"];
  if (options.allowLegacyId === true) {
    properties["id"] = { type: "string", minLength: 1, maxLength: 128 };
  }
  return {
    ...full,
    $id: `schema.${TYPE_SCHEMA_FILE_NAMES[type]}.v1.1.candidateStrict`,
    title: `${type} Story Bible asset (candidateStrict)`,
    required: [
      "schemaVersion",
      "id",
      "type",
      "title",
      "status",
      "summary",
      "aliases",
      "relations",
      "details",
      "extensions",
      "createdAt"
    ],
    properties
  };
}

export function createStoryBibleDefaultDetails(type: StoryBibleV11AssetType): Schema {
  switch (type) {
    case "outline":
      return { volumes: [], chapterOutlines: [] };
    case "foreshadow":
      return { trackingStatus: "planned", milestones: [] };
    case "timeline.events":
      return { events: [] };
    case "character":
      return {
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
      };
    case "world.item":
      return { stateHistory: [] };
    case "world.location":
    case "world.faction":
    case "world.rule":
    case "world.glossary":
    case "world.lore":
      return {};
  }
}

export function createStoryBibleCreateValueSchema(type: StoryBibleV11AssetType): Schema {
  const candidate = createStoryBibleWriteCandidateSchema(type);
  const candidateProperties = isRecord(candidate["properties"]) ? candidate["properties"] : {};
  const details = isRecord(candidateProperties["details"])
    ? { ...candidateProperties["details"], default: createStoryBibleDefaultDetails(type) }
    : { type: "object", default: createStoryBibleDefaultDetails(type) };
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: `schema.${TYPE_SCHEMA_FILE_NAMES[type]}.v1.1.createValue`,
    title: `${type} Story Bible create value`,
    type: "object",
    additionalProperties: false,
    required: ["title"],
    properties: {
      title: candidateProperties["title"],
      status: { type: "string", enum: ["active", "draft", "archived"], default: "active" },
      summary: { ...asSchema(candidateProperties["summary"]), default: "" },
      aliases: { ...asSchema(candidateProperties["aliases"]), default: [] },
      relations: { ...asSchema(candidateProperties["relations"]), default: [] },
      details,
      extensions: { ...asSchema(candidateProperties["extensions"]), default: {} }
    }
  };
}

export function validateStoryBibleCreateValue(
  type: StoryBibleV11AssetType,
  value: unknown
): ValidationResult {
  return createSchemaValidator(createStoryBibleCreateValueSchema(type))(value);
}

export function describeStoryBibleType(type: StoryBibleV11AssetType): Schema {
  return {
    schemaVersion: "1.1",
    type,
    createValueSchema: createStoryBibleCreateValueSchema(type),
    writeCandidateSchema: createStoryBibleWriteCandidateSchema(type),
    writableRootFields: [
      "title",
      "status",
      "summary",
      "aliases",
      "relations",
      "details",
      "extensions"
    ],
    systemManagedFields: [
      "schemaVersion",
      "id",
      "type",
      "createdAt",
      "updatedAt",
      "revision",
      "relatedEntityIds",
      "passthrough"
    ],
    referenceConstraints: {
      relationSourceMustEqualOwner: true,
      relationTargetMustExist: true,
      relationIdUniqueWithinProject: true,
      explicitInverseMustBeReciprocal: true,
      typedDetailReferencesMustExist: true,
      chapterReferencesMustExist: true,
      arrayIndexPatchAllowed: false,
      stableEntryCollections: [
        "volumes",
        "chapterOutlines",
        "beats",
        "events",
        "knowledgeStates",
        "stateHistory",
        "milestones"
      ]
    },
    defaultDetails: createStoryBibleDefaultDetails(type)
  };
}

export function validateStoryBibleWriteCandidate(
  value: unknown,
  options: StoryBibleSemanticValidationOptions = {}
): ValidationResult {
  const record = isRecord(value) ? value : undefined;
  const type = options.assetType ?? record?.["type"];
  if (!isStoryBibleV11AssetType(type)) {
    return {
      valid: false,
      issues: [issue("/type", "#/properties/type", "enum", "must be a supported Story Bible type")]
    };
  }
  const structural = createSchemaValidator(createStoryBibleWriteCandidateSchema(type, options))(
    value
  );
  if (!structural.valid || record === undefined) return structural;
  const semanticIssues = validateSemantics(record, type, options);
  return { valid: semanticIssues.length === 0, issues: semanticIssues };
}

export function validateStoryBibleV11Asset(
  value: unknown,
  mode: StoryBibleSchemaMode = "writeStrict",
  options: StoryBibleSemanticValidationOptions = {}
): ValidationResult {
  const record = isRecord(value) ? value : undefined;
  const type = options.assetType ?? record?.["type"];
  if (!isStoryBibleV11AssetType(type)) {
    return {
      valid: false,
      issues: [issue("/type", "#/properties/type", "enum", "must be a supported Story Bible type")]
    };
  }

  const schema = createStoryBibleV11Schema(type, mode);
  if (options.allowLegacyId === true && isRecord(schema["properties"])) {
    schema["properties"]["id"] = { type: "string", minLength: 1, maxLength: 128 };
  }
  const structural = createSchemaValidator(schema)(value);
  if (!structural.valid || record === undefined) return structural;
  const semanticIssues = validateSemantics(record, type, options);
  return { valid: semanticIssues.length === 0, issues: semanticIssues };
}

export function collectStoryBibleDeclaredReferences(
  value: unknown
): readonly StoryBibleDeclaredReference[] {
  if (!isRecord(value) || !isStoryBibleV11AssetType(value["type"])) return [];
  const asset = value;
  const type = value["type"];
  const details = isRecord(asset["details"]) ? asset["details"] : {};
  const references: StoryBibleDeclaredReference[] = [];

  for (const [index, relation] of recordArray(asset["relations"]).entries()) {
    const relationId = stringValue(relation["relationId"]);
    pushDeclaredReference(references, {
      value: relation["targetId"],
      path: `/relations/${index}/targetId`,
      constraintKey: `relation:${relationId ?? index}:targetId`,
      expectedTargetTypes: ANY_ASSET_REFERENCE_TYPES,
      ...(relationId === undefined ? {} : { relationId }),
      ...(typeof relation["relationType"] === "string"
        ? { relationType: relation["relationType"] }
        : {})
    });
  }

  switch (type) {
    case "character":
      collectCharacterReferences(details, references);
      break;
    case "world.location":
      pushDeclaredReference(references, {
        value: details["regionId"],
        path: "/details/regionId",
        constraintKey: "world.location.regionId",
        expectedTargetTypes: LOCATION_REFERENCE_TYPES
      });
      pushDeclaredReferenceArray(references, {
        value: details["factionIds"],
        path: "/details/factionIds",
        constraintKey: "world.location.factionIds",
        expectedTargetTypes: FACTION_REFERENCE_TYPES
      });
      break;
    case "world.faction":
      pushDeclaredReferenceArray(references, {
        value: details["memberIds"],
        path: "/details/memberIds",
        constraintKey: "world.faction.memberIds",
        expectedTargetTypes: CHARACTER_REFERENCE_TYPES
      });
      for (const field of ["allyIds", "enemyIds"] as const) {
        pushDeclaredReferenceArray(references, {
          value: details[field],
          path: `/details/${field}`,
          constraintKey: `world.faction.${field}`,
          expectedTargetTypes: FACTION_REFERENCE_TYPES
        });
      }
      pushDeclaredReferenceArray(references, {
        value: details["influenceLocationIds"],
        path: "/details/influenceLocationIds",
        constraintKey: "world.faction.influenceLocationIds",
        expectedTargetTypes: LOCATION_REFERENCE_TYPES
      });
      break;
    case "world.rule":
      pushDeclaredReferenceArray(references, {
        value: details["knownViolationEventIds"],
        path: "/details/knownViolationEventIds",
        constraintKey: "world.rule.knownViolationEventIds",
        expectedTargetTypes: TIMELINE_EVENT_REFERENCE_TYPES
      });
      break;
    case "world.glossary":
      pushDeclaredReferenceArray(references, {
        value: details["relatedRuleIds"],
        path: "/details/relatedRuleIds",
        constraintKey: "world.glossary.relatedRuleIds",
        expectedTargetTypes: RULE_REFERENCE_TYPES
      });
      break;
    case "world.item":
      pushDeclaredReference(references, {
        value: details["holderId"],
        path: "/details/holderId",
        constraintKey: "world.item.holderId",
        expectedTargetTypes: CHARACTER_REFERENCE_TYPES
      });
      pushDeclaredReference(references, {
        value: details["currentLocationId"],
        path: "/details/currentLocationId",
        constraintKey: "world.item.currentLocationId",
        expectedTargetTypes: LOCATION_REFERENCE_TYPES
      });
      pushDeclaredReference(references, {
        value: details["asOfEventId"],
        path: "/details/asOfEventId",
        constraintKey: "world.item.asOfEventId",
        expectedTargetTypes: TIMELINE_EVENT_REFERENCE_TYPES
      });
      collectStateHistoryReferences(details["stateHistory"], "world.item", references);
      break;
    case "world.lore":
      pushDeclaredReferenceArray(references, {
        value: details["relatedRuleIds"],
        path: "/details/relatedRuleIds",
        constraintKey: "world.lore.relatedRuleIds",
        expectedTargetTypes: RULE_REFERENCE_TYPES
      });
      pushDeclaredReferenceArray(references, {
        value: details["relatedGlossaryIds"],
        path: "/details/relatedGlossaryIds",
        constraintKey: "world.lore.relatedGlossaryIds",
        expectedTargetTypes: GLOSSARY_REFERENCE_TYPES
      });
      break;
    case "outline":
      collectOutlineReferences(details, references);
      break;
    case "foreshadow":
      collectForeshadowReferences(details, references);
      break;
    case "timeline.events":
      collectTimelineReferences(details, references);
      break;
  }

  return references;
}

export function inspectStoryBibleReferences(
  value: unknown,
  knownReferenceTargets: ReadonlyMap<string, StoryBibleReferenceTargetType>
): readonly StoryBibleInspectedReference[] {
  return collectStoryBibleDeclaredReferences(value).map((reference) => {
    const actualTargetType = knownReferenceTargets.get(reference.targetId);
    if (actualTargetType === undefined) return { ...reference, integrity: "missing" };
    if (!reference.expectedTargetTypes.includes(actualTargetType)) {
      return { ...reference, integrity: "type-mismatch", actualTargetType };
    }
    return { ...reference, integrity: "valid", actualTargetType };
  });
}

export function storyBibleReferenceFingerprint(reference: StoryBibleDeclaredReference): string {
  return JSON.stringify([
    reference.constraintKey,
    reference.targetId,
    [...reference.expectedTargetTypes]
  ]);
}

export function collectStoryBibleDeclaredChapterReferences(
  value: unknown
): readonly StoryBibleDeclaredChapterReference[] {
  if (!isRecord(value) || !isStoryBibleV11AssetType(value["type"])) return [];
  const asset = value;
  const type = value["type"];
  const details = isRecord(asset["details"]) ? asset["details"] : {};
  const references: StoryBibleDeclaredChapterReference[] = [];

  for (const [relationIndex, relation] of recordArray(asset["relations"]).entries()) {
    const relationId = stringValue(relation["relationId"]);
    const relationKey = `relation:${relationId ?? relationIndex}`;
    for (const field of ["validFromChapterId", "validToChapterId"] as const) {
      pushDeclaredChapterReference(references, {
        value: relation[field],
        path: `/relations/${relationIndex}/${field}`,
        constraintKey: `${relationKey}:${field}`,
        ...(relationId === undefined ? {} : { relationId })
      });
    }
    for (const [evidenceIndex, evidence] of recordArray(relation["evidence"]).entries()) {
      pushDeclaredChapterReference(references, {
        value: evidence["chapterId"],
        path: `/relations/${relationIndex}/evidence/${evidenceIndex}/chapterId`,
        constraintKey: `${relationKey}:evidence:chapterId`,
        ...(relationId === undefined ? {} : { relationId })
      });
    }
  }

  switch (type) {
    case "character": {
      const currentState = isRecord(details["currentState"]) ? details["currentState"] : {};
      pushDeclaredChapterReference(references, {
        value: currentState["asOfChapterId"],
        path: "/details/currentState/asOfChapterId",
        constraintKey: "character.currentState.asOfChapterId"
      });
      for (const [index, knowledge] of recordArray(details["knowledgeStates"]).entries()) {
        const knowledgeKey = stringValue(knowledge["knowledgeStateId"]) ?? String(index);
        for (const field of [
          "sourceChapterId",
          "validFromChapterId",
          "validToChapterId"
        ] as const) {
          pushDeclaredChapterReference(references, {
            value: knowledge[field],
            path: `/details/knowledgeStates/${index}/${field}`,
            constraintKey: `character.knowledge:${knowledgeKey}:${field}`
          });
        }
      }
      collectStateHistoryChapterReferences(details["stateHistory"], "character", references);
      break;
    }
    case "world.item":
      pushDeclaredChapterReference(references, {
        value: details["asOfChapterId"],
        path: "/details/asOfChapterId",
        constraintKey: "world.item.asOfChapterId"
      });
      collectStateHistoryChapterReferences(details["stateHistory"], "world.item", references);
      break;
    case "world.glossary":
      pushDeclaredChapterReference(references, {
        value: details["firstAppearanceChapterId"],
        path: "/details/firstAppearanceChapterId",
        constraintKey: "world.glossary.firstAppearanceChapterId"
      });
      break;
    case "outline":
      for (const [index, volume] of recordArray(details["volumes"]).entries()) {
        const volumeKey = stringValue(volume["volumeId"]) ?? String(index);
        pushDeclaredChapterReferenceArray(references, {
          value: volume["chapterIds"],
          path: `/details/volumes/${index}/chapterIds`,
          constraintKey: `outline.volume:${volumeKey}:chapterIds`
        });
      }
      for (const [index, chapter] of recordArray(details["chapterOutlines"]).entries()) {
        const chapterKey = stringValue(chapter["chapterOutlineId"]) ?? String(index);
        pushDeclaredChapterReference(references, {
          value: chapter["chapterId"],
          path: `/details/chapterOutlines/${index}/chapterId`,
          constraintKey: `outline.chapter:${chapterKey}:chapterId`
        });
      }
      break;
    case "foreshadow":
      for (const field of [
        "plantedChapterId",
        "plannedPayoffChapterId",
        "actualPayoffChapterId"
      ] as const) {
        pushDeclaredChapterReference(references, {
          value: details[field],
          path: `/details/${field}`,
          constraintKey: `foreshadow.${field}`
        });
      }
      for (const [index, source] of recordArray(details["sourceRefs"]).entries()) {
        pushDeclaredChapterReference(references, {
          value: source["chapterId"],
          path: `/details/sourceRefs/${index}/chapterId`,
          constraintKey: "foreshadow.sourceRefs:chapterId"
        });
      }
      for (const [index, milestone] of recordArray(details["milestones"]).entries()) {
        const milestoneKey = stringValue(milestone["milestoneId"]) ?? String(index);
        pushDeclaredChapterReference(references, {
          value: milestone["chapterId"],
          path: `/details/milestones/${index}/chapterId`,
          constraintKey: `foreshadow.milestone:${milestoneKey}:chapterId`
        });
      }
      break;
    case "timeline.events":
      for (const [index, event] of recordArray(details["events"]).entries()) {
        const eventKey = stringValue(event["eventId"]) ?? String(index);
        pushDeclaredChapterReferenceArray(references, {
          value: event["chapterIds"],
          path: `/details/events/${index}/chapterIds`,
          constraintKey: `timeline.event:${eventKey}:chapterIds`
        });
      }
      break;
    case "world.location":
    case "world.faction":
    case "world.rule":
    case "world.lore":
      break;
  }
  return references;
}

export function inspectStoryBibleChapterReferences(
  value: unknown,
  knownChapterIds: ReadonlySet<string>
): readonly StoryBibleInspectedChapterReference[] {
  return collectStoryBibleDeclaredChapterReferences(value).map((reference) => ({
    ...reference,
    integrity: knownChapterIds.has(reference.chapterId) ? "valid" : "missing"
  }));
}

export function storyBibleChapterReferenceFingerprint(
  reference: StoryBibleDeclaredChapterReference
): string {
  return JSON.stringify([reference.constraintKey, reference.chapterId]);
}

function collectStateHistoryChapterReferences(
  value: unknown,
  ownerType: "character" | "world.item",
  references: StoryBibleDeclaredChapterReference[]
): void {
  for (const [index, entry] of recordArray(value).entries()) {
    const entryKey = stringValue(entry["stateHistoryId"]) ?? String(index);
    pushDeclaredChapterReference(references, {
      value: entry["chapterId"],
      path: `/details/stateHistory/${index}/chapterId`,
      constraintKey: `${ownerType}.stateHistory:${entryKey}:chapterId`
    });
  }
}

function pushDeclaredChapterReferenceArray(
  output: StoryBibleDeclaredChapterReference[],
  input: {
    readonly value: unknown;
    readonly path: string;
    readonly constraintKey: string;
  }
): void {
  if (!Array.isArray(input.value)) return;
  for (const [index, value] of input.value.entries()) {
    pushDeclaredChapterReference(output, { ...input, value, path: `${input.path}/${index}` });
  }
}

function pushDeclaredChapterReference(
  output: StoryBibleDeclaredChapterReference[],
  input: {
    readonly value: unknown;
    readonly path: string;
    readonly constraintKey: string;
    readonly relationId?: string;
  }
): void {
  if (typeof input.value !== "string" || input.value.length === 0) return;
  output.push({
    path: input.path,
    constraintKey: input.constraintKey,
    chapterId: input.value,
    ...(input.relationId === undefined ? {} : { relationId: input.relationId })
  });
}

function collectCharacterReferences(
  details: Record<string, unknown>,
  references: StoryBibleDeclaredReference[]
): void {
  for (const [secretIndex, secret] of recordArray(details["secrets"]).entries()) {
    const secretKey = stringValue(secret["secretId"]) ?? String(secretIndex);
    pushDeclaredReferenceArray(references, {
      value: secret["knownByIds"],
      path: `/details/secrets/${secretIndex}/knownByIds`,
      constraintKey: `character.secret:${secretKey}:knownByIds`,
      expectedTargetTypes: CHARACTER_REFERENCE_TYPES
    });
  }
  const currentState = isRecord(details["currentState"]) ? details["currentState"] : {};
  pushDeclaredReference(references, {
    value: currentState["locationId"],
    path: "/details/currentState/locationId",
    constraintKey: "character.currentState.locationId",
    expectedTargetTypes: LOCATION_REFERENCE_TYPES
  });
  pushDeclaredReferenceArray(references, {
    value: currentState["heldItemIds"],
    path: "/details/currentState/heldItemIds",
    constraintKey: "character.currentState.heldItemIds",
    expectedTargetTypes: ITEM_REFERENCE_TYPES
  });
  pushDeclaredReference(references, {
    value: currentState["asOfEventId"],
    path: "/details/currentState/asOfEventId",
    constraintKey: "character.currentState.asOfEventId",
    expectedTargetTypes: TIMELINE_EVENT_REFERENCE_TYPES
  });
  collectStateHistoryReferences(details["stateHistory"], "character", references);
}

function collectStateHistoryReferences(
  value: unknown,
  ownerType: "character" | "world.item",
  references: StoryBibleDeclaredReference[]
): void {
  for (const [index, entry] of recordArray(value).entries()) {
    const entryKey = stringValue(entry["stateHistoryId"]) ?? String(index);
    pushDeclaredReference(references, {
      value: entry["timelineEventId"],
      path: `/details/stateHistory/${index}/timelineEventId`,
      constraintKey: `${ownerType}.stateHistory:${entryKey}:timelineEventId`,
      expectedTargetTypes: TIMELINE_EVENT_REFERENCE_TYPES
    });
  }
}

function collectOutlineReferences(
  details: Record<string, unknown>,
  references: StoryBibleDeclaredReference[]
): void {
  for (const [index, chapter] of recordArray(details["chapterOutlines"]).entries()) {
    const chapterKey = stringValue(chapter["chapterOutlineId"]) ?? String(index);
    const basePath = `/details/chapterOutlines/${index}`;
    const baseKey = `outline.chapter:${chapterKey}`;
    pushDeclaredReference(references, {
      value: chapter["povCharacterId"],
      path: `${basePath}/povCharacterId`,
      constraintKey: `${baseKey}:povCharacterId`,
      expectedTargetTypes: CHARACTER_REFERENCE_TYPES
    });
    pushDeclaredReferenceArray(references, {
      value: chapter["characterIds"],
      path: `${basePath}/characterIds`,
      constraintKey: `${baseKey}:characterIds`,
      expectedTargetTypes: CHARACTER_REFERENCE_TYPES
    });
    pushDeclaredReferenceArray(references, {
      value: chapter["locationIds"],
      path: `${basePath}/locationIds`,
      constraintKey: `${baseKey}:locationIds`,
      expectedTargetTypes: LOCATION_REFERENCE_TYPES
    });
    pushDeclaredReferenceArray(references, {
      value: chapter["foreshadowIds"],
      path: `${basePath}/foreshadowIds`,
      constraintKey: `${baseKey}:foreshadowIds`,
      expectedTargetTypes: FORESHADOW_REFERENCE_TYPES
    });
  }
}

function collectForeshadowReferences(
  details: Record<string, unknown>,
  references: StoryBibleDeclaredReference[]
): void {
  for (const [index, milestone] of recordArray(details["milestones"]).entries()) {
    const milestoneKey = stringValue(milestone["milestoneId"]) ?? String(index);
    pushDeclaredReference(references, {
      value: milestone["timelineEventId"],
      path: `/details/milestones/${index}/timelineEventId`,
      constraintKey: `foreshadow.milestone:${milestoneKey}:timelineEventId`,
      expectedTargetTypes: TIMELINE_EVENT_REFERENCE_TYPES
    });
  }
}

function collectTimelineReferences(
  details: Record<string, unknown>,
  references: StoryBibleDeclaredReference[]
): void {
  for (const [eventIndex, event] of recordArray(details["events"]).entries()) {
    const eventKey = stringValue(event["eventId"]) ?? String(eventIndex);
    const basePath = `/details/events/${eventIndex}`;
    const baseKey = `timeline.event:${eventKey}`;
    const time = isRecord(event["time"]) ? event["time"] : {};
    pushDeclaredReference(references, {
      value: time["anchorEventId"],
      path: `${basePath}/time/anchorEventId`,
      constraintKey: `${baseKey}:time:anchorEventId`,
      expectedTargetTypes: TIMELINE_EVENT_REFERENCE_TYPES
    });
    pushDeclaredReferenceArray(references, {
      value: event["parallelEventIds"],
      path: `${basePath}/parallelEventIds`,
      constraintKey: `${baseKey}:parallelEventIds`,
      expectedTargetTypes: TIMELINE_EVENT_REFERENCE_TYPES
    });
    pushDeclaredReferenceArray(references, {
      value: event["characterIds"],
      path: `${basePath}/characterIds`,
      constraintKey: `${baseKey}:characterIds`,
      expectedTargetTypes: CHARACTER_REFERENCE_TYPES
    });
    pushDeclaredReferenceArray(references, {
      value: event["locationIds"],
      path: `${basePath}/locationIds`,
      constraintKey: `${baseKey}:locationIds`,
      expectedTargetTypes: LOCATION_REFERENCE_TYPES
    });
    for (const [stateChangeIndex, stateChange] of recordArray(event["stateChanges"]).entries()) {
      pushDeclaredReference(references, {
        value: stateChange["subjectId"],
        path: `${basePath}/stateChanges/${stateChangeIndex}/subjectId`,
        constraintKey: `${baseKey}:stateChanges:subjectId`,
        expectedTargetTypes: ANY_ASSET_REFERENCE_TYPES
      });
    }
  }
}

function pushDeclaredReferenceArray(
  output: StoryBibleDeclaredReference[],
  input: {
    readonly value: unknown;
    readonly path: string;
    readonly constraintKey: string;
    readonly expectedTargetTypes: readonly StoryBibleReferenceTargetType[];
  }
): void {
  if (!Array.isArray(input.value)) return;
  for (const [index, value] of input.value.entries()) {
    pushDeclaredReference(output, { ...input, value, path: `${input.path}/${index}` });
  }
}

function pushDeclaredReference(
  output: StoryBibleDeclaredReference[],
  input: {
    readonly value: unknown;
    readonly path: string;
    readonly constraintKey: string;
    readonly expectedTargetTypes: readonly StoryBibleReferenceTargetType[];
    readonly relationId?: string;
    readonly relationType?: string;
  }
): void {
  if (typeof input.value !== "string" || input.value.length === 0) return;
  output.push({
    path: input.path,
    constraintKey: input.constraintKey,
    targetId: input.value,
    expectedTargetTypes: input.expectedTargetTypes,
    ...(input.relationId === undefined ? {} : { relationId: input.relationId }),
    ...(input.relationType === undefined ? {} : { relationType: input.relationType })
  });
}

function validateSemantics(
  asset: Record<string, unknown>,
  type: StoryBibleV11AssetType,
  options: StoryBibleSemanticValidationOptions
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const assetId = String(asset["id"]);
  const relations = recordArray(asset["relations"]);
  const relationIds = new Set<string>();
  for (const [index, relation] of relations.entries()) {
    const path = `/relations/${index}`;
    const relationId = String(relation["relationId"]);
    if (relationIds.has(relationId)) {
      issues.push(
        issue(
          `${path}/relationId`,
          "#/relations/relationId",
          "uniqueRelationId",
          "must be unique within the asset"
        )
      );
    }
    relationIds.add(relationId);
    if (relation["sourceId"] !== assetId) {
      issues.push(
        issue(
          `${path}/sourceId`,
          "#/relations/sourceId",
          "relationOwner",
          "must equal the owning asset id"
        )
      );
    }
    const targetId = String(relation["targetId"]);
    if (
      options.knownReferenceTargets === undefined &&
      options.knownAssetIds !== undefined &&
      relation["relationType"] !== "legacy.related" &&
      !options.knownAssetIds.has(targetId)
    ) {
      issues.push(
        issue(
          `${path}/targetId`,
          "#/relations/targetId",
          "assetReference",
          "must reference an existing Story Bible asset"
        )
      );
    }
    if (relation["direction"] === "symmetric") {
      if (assetId.localeCompare(targetId, "en-US") >= 0) {
        issues.push(
          issue(
            `${path}/sourceId`,
            "#/relations/sourceId",
            "symmetricOwner",
            "must be the binary-sort lower endpoint"
          )
        );
      }
      if (relation["inversePolicy"] !== "derived" || relation["inverseRelationId"] !== null) {
        issues.push(
          issue(
            path,
            "#/relations",
            "symmetricInverse",
            "must use a derived inverse and null inverseRelationId"
          )
        );
      }
    }
    if (relation["direction"] === "directed") {
      if (relation["inversePolicy"] === "explicit") {
        if (relation["inverseRelationId"] === null) {
          issues.push(
            issue(
              `${path}/inverseRelationId`,
              "#/relations/inverseRelationId",
              "explicitInverse",
              "must identify the explicit inverse relation"
            )
          );
        } else if (relation["inverseRelationId"] === relationId) {
          issues.push(
            issue(
              `${path}/inverseRelationId`,
              "#/relations/inverseRelationId",
              "explicitInverse",
              "must not reference the same relation"
            )
          );
        }
      } else if (relation["inverseRelationId"] !== null) {
        issues.push(
          issue(
            `${path}/inverseRelationId`,
            "#/relations/inverseRelationId",
            "inversePolicy",
            "must be null unless inversePolicy is explicit"
          )
        );
      }
    }
    for (const [evidenceIndex, evidence] of recordArray(relation["evidence"]).entries()) {
      if (Number(evidence["end"]) <= Number(evidence["start"])) {
        issues.push(
          issue(
            `${path}/evidence/${evidenceIndex}/end`,
            "#/relations/evidence/end",
            "evidenceRange",
            "must be greater than start"
          )
        );
      }
    }
  }

  const extensions = isRecord(asset["extensions"]) ? asset["extensions"] : {};
  if (options.registeredExtensionNamespaces !== undefined) {
    for (const namespace of Object.keys(extensions)) {
      if (!options.registeredExtensionNamespaces.has(namespace)) {
        issues.push(
          issue(
            `/extensions/${escapePointer(namespace)}`,
            "#/properties/extensions",
            "registeredExtension",
            "must use a registered extension namespace"
          )
        );
      }
    }
  }

  const details = isRecord(asset["details"]) ? asset["details"] : {};
  switch (type) {
    case "character":
      validateUniqueEntryIds(
        details["knowledgeStates"],
        "knowledgeStateId",
        "/details/knowledgeStates",
        issues
      );
      validateUniqueEntryIds(
        details["stateHistory"],
        "stateHistoryId",
        "/details/stateHistory",
        issues
      );
      break;
    case "world.item":
      validateUniqueEntryIds(
        details["stateHistory"],
        "stateHistoryId",
        "/details/stateHistory",
        issues
      );
      break;
    case "outline":
      validateOutline(details, issues);
      break;
    case "foreshadow":
      validateForeshadow(details, issues);
      break;
    case "timeline.events":
      validateTimeline(details, issues);
      break;
    case "world.location":
    case "world.faction":
    case "world.rule":
    case "world.glossary":
    case "world.lore":
      break;
  }
  if (options.knownReferenceTargets !== undefined) {
    const inheritedCounts = options.inheritedInvalidReferenceCounts ?? new Map<string, number>();
    const consumedInheritedCounts = new Map<string, number>();
    for (const reference of inspectStoryBibleReferences(asset, options.knownReferenceTargets)) {
      if (reference.integrity === "valid") continue;
      const fingerprint = storyBibleReferenceFingerprint(reference);
      const consumed = (consumedInheritedCounts.get(fingerprint) ?? 0) + 1;
      consumedInheritedCounts.set(fingerprint, consumed);
      if (consumed <= (inheritedCounts.get(fingerprint) ?? 0)) continue;
      if (reference.integrity === "missing") {
        issues.push(
          issue(
            reference.path,
            "#/references",
            "referenceExists",
            "must reference an existing Story Bible target"
          )
        );
      } else {
        issues.push(
          issue(
            reference.path,
            "#/references",
            "referenceType",
            `must reference ${reference.expectedTargetTypes.join(" or ")}`
          )
        );
      }
    }
  }
  if (options.knownChapterIds !== undefined) {
    const inheritedCounts =
      options.inheritedInvalidChapterReferenceCounts ?? new Map<string, number>();
    const consumedInheritedCounts = new Map<string, number>();
    for (const reference of inspectStoryBibleChapterReferences(asset, options.knownChapterIds)) {
      if (reference.integrity === "valid") continue;
      const fingerprint = storyBibleChapterReferenceFingerprint(reference);
      const consumed = (consumedInheritedCounts.get(fingerprint) ?? 0) + 1;
      consumedInheritedCounts.set(fingerprint, consumed);
      if (consumed <= (inheritedCounts.get(fingerprint) ?? 0)) continue;
      issues.push(
        issue(
          reference.path,
          "#/chapterReferences",
          "chapterReference",
          "must reference an existing project chapter"
        )
      );
    }
  }
  return issues;
}

function validateOutline(details: Record<string, unknown>, issues: ValidationIssue[]): void {
  validateUniqueEntryIds(details["volumes"], "volumeId", "/details/volumes", issues);
  validateUniqueEntryIds(
    details["chapterOutlines"],
    "chapterOutlineId",
    "/details/chapterOutlines",
    issues
  );
  const chapterIds = new Set<string>();
  for (const [index, chapter] of recordArray(details["chapterOutlines"]).entries()) {
    const chapterId = String(chapter["chapterId"]);
    if (chapterIds.has(chapterId)) {
      issues.push(
        issue(
          `/details/chapterOutlines/${index}/chapterId`,
          "#/details/chapterOutlines/chapterId",
          "uniqueChapterOutline",
          "must appear only once"
        )
      );
    }
    chapterIds.add(chapterId);
    validateUniqueEntryIds(
      chapter["beats"],
      "beatId",
      `/details/chapterOutlines/${index}/beats`,
      issues
    );
  }
}

function validateForeshadow(details: Record<string, unknown>, issues: ValidationIssue[]): void {
  validateUniqueEntryIds(details["milestones"], "milestoneId", "/details/milestones", issues);
  const milestones = recordArray(details["milestones"]);
  if (
    details["trackingStatus"] === "paid-off" &&
    !milestones.some((milestone) => milestone["kind"] === "payoff")
  ) {
    issues.push(
      issue(
        "/details/milestones",
        "#/details/milestones",
        "payoffMilestone",
        "must contain a payoff milestone when trackingStatus is paid-off"
      )
    );
  }
}

function validateTimeline(details: Record<string, unknown>, issues: ValidationIssue[]): void {
  const events = recordArray(details["events"]);
  validateUniqueEntryIds(events, "eventId", "/details/events", issues);
  const ids = new Set(events.map((event) => String(event["eventId"])));
  const graph = new Map<string, string[]>();
  for (const [index, event] of events.entries()) {
    const eventId = String(event["eventId"]);
    const references = stringValues(event["parallelEventIds"]);
    const dependencies: string[] = [];
    const time = isRecord(event["time"]) ? event["time"] : {};
    if (typeof time["anchorEventId"] === "string") {
      references.push(time["anchorEventId"]);
      dependencies.push(time["anchorEventId"]);
    }
    for (const reference of references) {
      if (reference === eventId) {
        issues.push(
          issue(
            `/details/events/${index}`,
            "#/details/events",
            "eventSelfReference",
            "must not reference itself"
          )
        );
      } else if (!ids.has(reference)) {
        issues.push(
          issue(
            `/details/events/${index}`,
            "#/details/events",
            "eventReference",
            "must reference an event in the same timeline"
          )
        );
      }
    }
    graph.set(
      eventId,
      dependencies.filter((dependency) => ids.has(dependency))
    );
  }
  if (hasCycle(graph)) {
    issues.push(
      issue(
        "/details/events",
        "#/details/events",
        "eventCycle",
        "must not contain a dependency cycle"
      )
    );
  }
}

function validateUniqueEntryIds(
  value: unknown,
  key: string,
  basePath: string,
  issues: ValidationIssue[]
): void {
  const seen = new Set<string>();
  for (const [index, entry] of recordArray(value).entries()) {
    const entryId = String(entry[key]);
    if (seen.has(entryId)) {
      issues.push(
        issue(
          `${basePath}/${index}/${key}`,
          `#${basePath}/${key}`,
          "uniqueEntryId",
          "must be unique within the collection"
        )
      );
    }
    seen.add(entryId);
  }
}

function hasCycle(graph: ReadonlyMap<string, readonly string[]>): boolean {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dependency of graph.get(id) ?? []) {
      if (visit(dependency)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return [...graph.keys()].some(visit);
}

function characterDetailsSchema(): Schema {
  return strictObject({
    role: STRING,
    personality: {
      oneOf: [
        STRING,
        stringArray(),
        strictObject({
          traits: stringArray(),
          values: stringArray(),
          fears: stringArray(),
          desires: stringArray()
        })
      ]
    },
    voice: {
      oneOf: [
        STRING,
        strictObject({
          tone: STRING,
          vocabulary: stringArray(),
          catchphrases: stringArray(),
          forbiddenExpressions: stringArray()
        })
      ]
    },
    goals: {
      oneOf: [stringArray(), strictObject({ external: STRING, internal: STRING })]
    },
    conflicts: stringArray(),
    arc: strictObject({ start: STRING, turningPoints: stringArray(), targetState: STRING }),
    secrets: {
      type: "array",
      items: strictObject(
        {
          secretId: { type: "string", pattern: "^sec_[a-f0-9]{32}$" },
          content: NON_EMPTY_STRING,
          knownByIds: stringArray(),
          revealStatus: { type: "string", enum: ["hidden", "partial", "revealed"] }
        },
        ["content", "knownByIds", "revealStatus"]
      )
    },
    abilities: stringArray(),
    limitations: stringArray(),
    currentState: strictObject({
      locationId: nullable(ASSET_ID),
      physical: STRING,
      emotional: STRING,
      heldItemIds: stringArray(),
      asOfChapterId: nullable(CHAPTER_ID),
      asOfEventId: nullable({ type: "string", pattern: "^evt_[a-f0-9]{32}$" })
    }),
    knowledgeStates: {
      type: "array",
      items: strictObject(
        {
          knowledgeStateId: { type: "string", pattern: "^knw_[a-f0-9]{32}$" },
          entryRevision: ENTRY_REVISION,
          subject: NON_EMPTY_STRING,
          state: {
            type: "string",
            enum: ["known", "believed", "suspected", "misunderstood", "forgotten"]
          },
          sourceChapterId: nullable(CHAPTER_ID),
          validFromChapterId: nullable(CHAPTER_ID),
          validToChapterId: nullable(CHAPTER_ID),
          note: STRING
        },
        ["knowledgeStateId", "entryRevision", "subject", "state"]
      )
    },
    stateHistory: stateHistorySchema()
  });
}

function worldLocationDetailsSchema(): Schema {
  return strictObject({
    geography: STRING,
    culture: STRING,
    constraints: textOrStringArray(),
    regionId: nullable(ASSET_ID),
    factionIds: stringArray()
  });
}

function worldFactionDetailsSchema(): Schema {
  return strictObject({
    goals: textOrStringArray(),
    structure: STRING,
    membersOrInfluence: STRING,
    memberIds: stringArray(),
    resources: stringArray(),
    allyIds: stringArray(),
    enemyIds: stringArray(),
    influenceLocationIds: stringArray()
  });
}

function worldRuleDetailsSchema(): Schema {
  return strictObject({
    rule: STRING,
    statement: STRING,
    scope: STRING,
    costs: stringArray(),
    constraints: textOrStringArray(),
    limitations: stringArray(),
    exceptions: stringArray(),
    knownViolationEventIds: stringArray()
  });
}

function worldGlossaryDetailsSchema(): Schema {
  return strictObject({
    definition: STRING,
    termAliases: stringArray(),
    firstAppearance: STRING,
    firstAppearanceChapterId: nullable(CHAPTER_ID),
    relatedRuleIds: stringArray()
  });
}

function worldItemDetailsSchema(): Schema {
  return strictObject({
    appearance: STRING,
    origin: STRING,
    abilities: stringArray(),
    limitations: stringArray(),
    holderId: nullable(ASSET_ID),
    currentLocationId: nullable(ASSET_ID),
    state: STRING,
    asOfChapterId: nullable(CHAPTER_ID),
    asOfEventId: nullable({ type: "string", pattern: "^evt_[a-f0-9]{32}$" }),
    stateHistory: stateHistorySchema()
  });
}

function worldLoreDetailsSchema(): Schema {
  return strictObject({
    body: STRING,
    periods: stringArray(),
    institutions: stringArray(),
    customs: stringArray(),
    legends: stringArray(),
    systems: stringArray(),
    relatedRuleIds: stringArray(),
    relatedGlossaryIds: stringArray()
  });
}

function outlineDetailsSchema(): Schema {
  const beat = strictObject(
    {
      beatId: { type: "string", pattern: "^beat_[a-f0-9]{32}$" },
      entryRevision: ENTRY_REVISION,
      title: NON_EMPTY_STRING,
      purpose: STRING,
      result: STRING,
      scene: STRING
    },
    ["beatId", "entryRevision", "title"]
  );
  return strictObject(
    {
      premise: STRING,
      themes: stringArray(),
      volumes: {
        type: "array",
        items: strictObject(
          {
            volumeId: { type: "string", pattern: "^vol_[a-f0-9]{32}$" },
            entryRevision: ENTRY_REVISION,
            title: NON_EMPTY_STRING,
            summary: STRING,
            goals: stringArray(),
            chapterIds: stringArray()
          },
          ["volumeId", "entryRevision", "title", "summary", "goals", "chapterIds"]
        )
      },
      chapterOutlines: {
        type: "array",
        items: strictObject(
          {
            chapterOutlineId: { type: "string", pattern: "^cho_[a-f0-9]{32}$" },
            chapterId: CHAPTER_ID,
            entryRevision: ENTRY_REVISION,
            goal: STRING,
            conflict: STRING,
            turningPoint: STRING,
            notes: STRING,
            povCharacterId: nullable(ASSET_ID),
            characterIds: stringArray(),
            locationIds: stringArray(),
            foreshadowIds: stringArray(),
            beats: { type: "array", items: beat },
            expectedStateChanges: stringArray(),
            actualOutcome: nullable(STRING),
            deviations: stringArray()
          },
          [
            "chapterOutlineId",
            "chapterId",
            "entryRevision",
            "goal",
            "conflict",
            "turningPoint",
            "notes",
            "characterIds",
            "locationIds",
            "foreshadowIds",
            "beats",
            "expectedStateChanges",
            "deviations"
          ]
        )
      }
    },
    ["volumes", "chapterOutlines"]
  );
}

function foreshadowDetailsSchema(): Schema {
  return strictObject(
    {
      trackingStatus: {
        type: "string",
        enum: ["planned", "planted", "progressing", "ready-to-payoff", "paid-off", "abandoned"]
      },
      plantedChapterId: CHAPTER_ID,
      plannedPayoffChapterId: CHAPTER_ID,
      actualPayoffChapterId: CHAPTER_ID,
      origin: { type: "string", enum: ["manual", "ai-confirmed"] },
      notes: STRING,
      sourceRefs: {
        type: "array",
        items: strictObject(
          {
            chapterId: CHAPTER_ID,
            excerpt: { type: "string", minLength: 1 },
            excerptHash: HASH
          },
          ["chapterId", "excerpt", "excerptHash"]
        )
      },
      milestones: {
        type: "array",
        items: strictObject(
          {
            milestoneId: { type: "string", pattern: "^fsm_[a-f0-9]{32}$" },
            entryRevision: ENTRY_REVISION,
            kind: { type: "string", enum: ["plan", "plant", "progress", "payoff", "abandon"] },
            chapterId: CHAPTER_ID,
            timelineEventId: nullable({ type: "string", pattern: "^evt_[a-f0-9]{32}$" }),
            evidence: strictObject(
              {
                start: { type: "integer", minimum: 0 },
                end: { type: "integer", minimum: 1 },
                excerptHash: HASH
              },
              ["start", "end", "excerptHash"]
            ),
            note: STRING
          },
          ["milestoneId", "entryRevision", "kind", "chapterId", "evidence", "note"]
        )
      }
    },
    ["trackingStatus", "milestones"]
  );
}

function timelineDetailsSchema(): Schema {
  const time = strictObject(
    {
      mode: { type: "string", enum: ["absolute", "relative", "sequence-only", "unknown"] },
      label: STRING,
      absolute: STRING,
      anchorEventId: nullable({ type: "string", pattern: "^evt_[a-f0-9]{32}$" }),
      offset: nullable(
        strictObject(
          {
            value: { type: "number" },
            unit: {
              type: "string",
              enum: ["minute", "hour", "day", "week", "month", "year", "custom"]
            }
          },
          ["value", "unit"]
        )
      ),
      uncertain: { type: "boolean" }
    },
    ["mode", "label", "uncertain"]
  );
  return strictObject(
    {
      events: {
        type: "array",
        items: strictObject(
          {
            eventId: { type: "string", pattern: "^evt_[a-f0-9]{32}$" },
            entryRevision: ENTRY_REVISION,
            title: NON_EMPTY_STRING,
            sequence: { type: "integer", minimum: 1 },
            time,
            duration: nullable(STRING),
            summary: STRING,
            chapterIds: stringArray(),
            characterIds: stringArray(),
            locationIds: stringArray(),
            parallelEventIds: stringArray(),
            causes: stringArray(),
            effects: stringArray(),
            stateChanges: {
              type: "array",
              items: strictObject(
                {
                  subjectId: ASSET_ID,
                  path: NON_EMPTY_STRING,
                  before: {},
                  after: {},
                  note: STRING
                },
                ["subjectId", "path", "before", "after", "note"]
              )
            }
          },
          [
            "eventId",
            "entryRevision",
            "title",
            "sequence",
            "time",
            "summary",
            "chapterIds",
            "characterIds",
            "locationIds",
            "parallelEventIds",
            "causes",
            "effects",
            "stateChanges"
          ]
        )
      }
    },
    ["events"]
  );
}

function stateHistorySchema(): Schema {
  return {
    type: "array",
    items: strictObject(
      {
        stateHistoryId: { type: "string", pattern: "^sth_[a-f0-9]{32}$" },
        entryRevision: ENTRY_REVISION,
        timelineEventId: { type: "string", pattern: "^evt_[a-f0-9]{32}$" },
        chapterId: nullable(CHAPTER_ID),
        note: STRING
      },
      ["stateHistoryId", "entryRevision", "timelineEventId", "note"]
    )
  };
}

function relationSchema(): Schema {
  return strictObject(
    {
      relationId: { type: "string", pattern: "^rel_[a-f0-9]{32}$" },
      sourceId: ASSET_ID,
      targetId: ASSET_ID,
      relationType: { type: "string", pattern: "^[a-z][a-z0-9-]*(?:\\.[a-z][a-z0-9-]*)+$" },
      direction: { type: "string", enum: ["directed", "symmetric"] },
      status: { type: "string", enum: ["active", "ended", "uncertain"] },
      validFromChapterId: nullable(CHAPTER_ID),
      validToChapterId: nullable(CHAPTER_ID),
      inversePolicy: { type: "string", enum: ["derived", "explicit", "none"] },
      inverseRelationId: nullable({ type: "string", pattern: "^rel_[a-f0-9]{32}$" }),
      evidence: {
        type: "array",
        items: strictObject(
          {
            chapterId: CHAPTER_ID,
            start: { type: "integer", minimum: 0 },
            end: { type: "integer", minimum: 1 },
            excerptHash: HASH
          },
          ["chapterId", "start", "end", "excerptHash"]
        )
      },
      note: STRING
    },
    [
      "relationId",
      "sourceId",
      "targetId",
      "relationType",
      "direction",
      "status",
      "validFromChapterId",
      "validToChapterId",
      "inversePolicy",
      "inverseRelationId",
      "evidence",
      "note"
    ]
  );
}

function extensionSchema(): Schema {
  return {
    type: "object",
    propertyNames: {
      pattern: "^(?:[a-z][a-z0-9-]*(?:\\.[a-z][a-z0-9-]*)+|[a-z][a-z0-9-]*/[a-z][a-z0-9-]*)$"
    },
    additionalProperties: true,
    maxProperties: 128
  };
}

function passthroughSchema(): Schema {
  return strictObject(
    {
      sourceSchemaVersion: { const: "1.0" },
      rootFields: { type: "object", additionalProperties: true, maxProperties: 256 },
      detailFieldsByPointer: {
        type: "object",
        propertyNames: { pattern: "^/" },
        additionalProperties: strictObject({ value: {} }, ["value"]),
        maxProperties: 2048
      }
    },
    ["sourceSchemaVersion", "rootFields", "detailFieldsByPointer"]
  );
}

function strictObject(properties: Schema, required: readonly string[] = []): Schema {
  return {
    type: "object",
    additionalProperties: false,
    ...(required.length === 0 ? {} : { required }),
    properties
  };
}

function stringArray(maxItems = 10_000): Schema {
  return { type: "array", items: STRING, maxItems, uniqueItems: true };
}

function textOrStringArray(): Schema {
  return { oneOf: [STRING, stringArray()] };
}

function nullable(schema: Schema): Schema {
  return { anyOf: [schema, { type: "null" }] };
}

function issue(
  instancePath: string,
  schemaPath: string,
  keyword: string,
  message: string
): ValidationIssue {
  return { instancePath, schemaPath, keyword, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asSchema(value: unknown): Schema {
  return isRecord(value) ? value : {};
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function stringValues(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function escapePointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}
