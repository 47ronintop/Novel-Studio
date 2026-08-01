import { createHash, randomUUID } from "node:crypto";

import {
  createStoryBibleV11Schema,
  getStoryBibleKnownDetailKeys,
  isStoryBibleV11AssetType,
  type StoryBibleReferenceTargetType,
  type StoryBibleV11AssetType
} from "@novel-studio/schemas";
import type { JsonObject, JsonValue } from "@novel-studio/shared";

export type StoryBibleSchemaVersion = "1.0" | "1.1";

export interface StoryBibleRelation extends JsonObject {
  readonly relationId: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly relationType: string;
  readonly direction: "directed" | "symmetric";
  readonly status: "active" | "ended" | "uncertain";
  readonly validFromChapterId: string | null;
  readonly validToChapterId: string | null;
  readonly inversePolicy: "derived" | "explicit" | "none";
  readonly inverseRelationId: string | null;
  readonly evidence: JsonObject[];
  readonly note: string;
}

export interface StoryBiblePassthrough extends JsonObject {
  readonly sourceSchemaVersion: "1.0";
  readonly rootFields: JsonObject;
  readonly detailFieldsByPointer: JsonObject;
}

export interface StoryBibleV11Asset extends JsonObject {
  readonly schemaVersion: "1.1";
  readonly id: string;
  readonly type: StoryBibleV11AssetType;
  readonly title: string;
  readonly status: "active" | "draft" | "archived" | "deleted";
  readonly summary: string;
  readonly aliases: string[];
  readonly relations: StoryBibleRelation[];
  readonly details: JsonObject;
  readonly extensions: JsonObject;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revision: number;
  readonly relatedEntityIds?: string[];
  readonly passthrough?: StoryBiblePassthrough;
}

/** Author-controlled fields accepted by the strict update path. */
export interface StoryBibleWriteCandidate extends JsonObject {
  readonly schemaVersion: "1.1";
  readonly id: string;
  readonly type: StoryBibleV11AssetType;
  readonly title: string;
  readonly status: "active" | "draft" | "archived" | "deleted";
  readonly summary: string;
  readonly aliases: string[];
  readonly relations: StoryBibleRelation[];
  readonly details: JsonObject;
  readonly extensions: JsonObject;
  readonly createdAt: string;
}

export interface StoryBibleCreateValue extends JsonObject {
  readonly title: string;
  readonly status?: "active" | "draft" | "archived";
  readonly summary?: string;
  readonly aliases?: string[];
  readonly relations?: StoryBibleRelation[];
  readonly details?: JsonObject;
  readonly extensions?: JsonObject;
}

export interface StoryBibleCompatibleAssetRead {
  readonly asset: StoryBibleV11Asset;
  readonly persistedSchemaVersion: StoryBibleSchemaVersion;
  readonly relativePath: string;
  readonly checksum: string;
  readonly revision: number;
  readonly passthroughPresent: boolean;
  readonly passthroughFieldCount: number;
}

export interface StoryBibleAdditionalReferenceTarget {
  readonly targetId: string;
  readonly targetType: StoryBibleReferenceTargetType;
}

export interface SaveStoryBibleCandidateInput {
  readonly candidate: StoryBibleWriteCandidate;
  readonly baseRevision: number;
  /** Required when upgrading v1.0; optional extra protection for v1.1. */
  readonly baseChecksum?: string;
  /** Main-generated IDs staged in the same atomic Change Set. */
  readonly additionalKnownAssetIds?: readonly string[];
  /** Main-derived typed targets staged in the same atomic consistency group. */
  readonly additionalKnownReferenceTargets?: readonly StoryBibleAdditionalReferenceTarget[];
  /** Application-owned chapter catalog snapshot used for strict chapter reference validation. */
  readonly knownChapterIds?: readonly string[];
  /**
   * Application-owned proof that this candidate belongs to an atomic consistency group.
   * Only cross-asset explicit-inverse pair checks are deferred to the group validator.
   */
  readonly deferProjectRelationPairValidation?: boolean;
}

export type StoryBibleStatusTransitionAuthorization =
  | {
      readonly action: "move-to-deleted";
      readonly expectedDeletionImpactChecksum: string;
    }
  | {
      readonly action: "restore";
      readonly restoreStatus: "active" | "draft" | "archived";
    };

export interface SaveStoryBibleStatusTransitionInput extends SaveStoryBibleCandidateInput {
  /** Issued only by the dedicated Application status command. */
  readonly statusTransition: StoryBibleStatusTransitionAuthorization;
}

export interface CreateStoryBibleAssetInput {
  readonly type: StoryBibleV11AssetType;
  readonly value: StoryBibleCreateValue;
  /** Application-reserved ID; never accepted from model tool arguments. */
  readonly reservedAssetId?: string;
  /** Main-generated IDs staged in the same atomic Change Set. */
  readonly additionalKnownAssetIds?: readonly string[];
  /** Main-derived typed targets staged in the same atomic consistency group. */
  readonly additionalKnownReferenceTargets?: readonly StoryBibleAdditionalReferenceTarget[];
  /** Application-owned chapter catalog snapshot used for strict chapter reference validation. */
  readonly knownChapterIds?: readonly string[];
  /**
   * Application-owned proof that this candidate belongs to an atomic consistency group.
   * Only cross-asset explicit-inverse pair checks are deferred to the group validator.
   */
  readonly deferProjectRelationPairValidation?: boolean;
}

export interface StoryBibleCandidateGroupEntry {
  readonly relativePath: string;
  readonly candidateContent: string;
}

export interface ValidateStoryBibleCandidateGroupInput {
  readonly candidates: readonly StoryBibleCandidateGroupEntry[];
  /** Application-owned chapter catalog snapshot used for strict chapter reference validation. */
  readonly knownChapterIds?: readonly string[];
}

export interface PreparedStoryBibleCreate {
  readonly asset: StoryBibleV11Asset;
  readonly relativePath: string;
  readonly content: string;
}

export interface PreparedStoryBibleWrite {
  readonly asset: StoryBibleV11Asset;
  readonly current: StoryBibleCompatibleAssetRead;
  readonly relativePath: string;
  readonly content: string;
  readonly baseContent: string;
  readonly baseRevision: number;
  readonly baseChecksum: string;
}

export const STORY_BIBLE_CANDIDATE_ROOT_FIELDS = Object.freeze([
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
] as const);

const LEGACY_ROOT_FIELDS = new Set([
  "schemaVersion",
  "id",
  "type",
  "title",
  "status",
  "summary",
  "aliases",
  "details",
  "relatedEntityIds",
  "createdAt",
  "updatedAt"
]);

export function isStoryBibleWriteCandidate(value: unknown): value is StoryBibleWriteCandidate {
  if (!isRecord(value)) return false;
  return Object.keys(value).every((key) =>
    (STORY_BIBLE_CANDIDATE_ROOT_FIELDS as readonly string[]).includes(key)
  );
}

export function createStoryBibleAssetId(type: StoryBibleV11AssetType): string {
  if (type === "outline") return "outline_main";
  if (type === "timeline.events") return "timeline_main";
  const prefix: Readonly<
    Record<Exclude<StoryBibleV11AssetType, "outline" | "timeline.events">, string>
  > = {
    character: "chr",
    "world.location": "loc",
    "world.faction": "fac",
    "world.rule": "rule",
    "world.glossary": "term",
    "world.item": "item",
    "world.lore": "lore",
    foreshadow: "fsh"
  };
  return `${prefix[type]}_${randomUUID().replaceAll("-", "").toLowerCase()}`;
}

export function isStoryBibleAssetIdForType(assetId: string, type: StoryBibleV11AssetType): boolean {
  if (type === "outline") return assetId === "outline_main";
  if (type === "timeline.events") return assetId === "timeline_main";
  const prefixes: Readonly<
    Record<Exclude<StoryBibleV11AssetType, "outline" | "timeline.events">, string>
  > = {
    character: "chr",
    "world.location": "loc",
    "world.faction": "fac",
    "world.rule": "rule",
    "world.glossary": "term",
    "world.item": "item",
    "world.lore": "lore",
    foreshadow: "fsh"
  };
  return new RegExp(`^${prefixes[type]}_[a-f0-9]{32}$`, "u").test(assetId);
}

export function checksumStoryBibleText(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function canonicalStoryBibleJson(asset: StoryBibleV11Asset): string {
  const {
    schemaVersion,
    id,
    type,
    title,
    status,
    summary,
    aliases,
    relations,
    details,
    extensions,
    createdAt,
    updatedAt,
    revision,
    relatedEntityIds,
    passthrough
  } = asset;
  const canonical: StoryBibleV11Asset = {
    schemaVersion,
    id,
    type,
    title,
    status,
    summary,
    aliases,
    relations,
    details,
    extensions,
    createdAt,
    updatedAt,
    revision,
    ...(relatedEntityIds === undefined ? {} : { relatedEntityIds }),
    ...(passthrough === undefined ? {} : { passthrough })
  };
  return `${JSON.stringify(canonical, null, 2)}\n`;
}

export function adaptLegacyStoryBibleAsset(input: {
  readonly asset: JsonObject;
  readonly checksum: string;
  readonly relativePath: string;
}): StoryBibleCompatibleAssetRead {
  const type = input.asset["type"];
  if (!isStoryBibleV11AssetType(type)) {
    throw new Error("Legacy Story Bible asset has an unsupported type.");
  }
  const assetId = stringValue(input.asset["id"]);
  if (assetId === undefined) throw new Error("Legacy Story Bible asset is missing an id.");
  const rawDetails = isRecord(input.asset["details"]) ? (input.asset["details"] as JsonObject) : {};
  const normalizedDetails = sanitizeLegacyDetails(
    type,
    normalizeLegacyDetails(type, assetId, rawDetails)
  );
  const rootFields: JsonObject = {};
  for (const [key, value] of Object.entries(input.asset)) {
    if (!LEGACY_ROOT_FIELDS.has(key)) rootFields[key] = value as JsonValue;
  }
  const detailFieldsByPointer = collectLegacyDetailPassthrough(type, rawDetails);
  const passthrough: StoryBiblePassthrough = {
    sourceSchemaVersion: "1.0",
    rootFields,
    detailFieldsByPointer
  };
  assertPassthroughBounds(passthrough);
  const relatedIds = stringArray(input.asset["relatedEntityIds"]);
  const relations = relatedIds.map((targetId, index) =>
    legacyRelation(assetId, targetId, input.checksum, index)
  );
  const asset: StoryBibleV11Asset = {
    schemaVersion: "1.1",
    id: assetId,
    type,
    title: stringValue(input.asset["title"]) ?? assetId,
    status: legacyStatus(input.asset["status"]),
    summary: stringValue(input.asset["summary"]) ?? "",
    aliases: stringArray(input.asset["aliases"]),
    relations,
    details: normalizedDetails,
    extensions: {},
    createdAt: dateValue(input.asset["createdAt"]),
    updatedAt: dateValue(input.asset["updatedAt"]),
    revision: 0,
    ...(relatedIds.length === 0 ? {} : { relatedEntityIds: relatedIds }),
    passthrough
  };
  return {
    asset,
    persistedSchemaVersion: "1.0",
    relativePath: input.relativePath,
    checksum: input.checksum,
    revision: 0,
    passthroughPresent: hasPassthroughFields(passthrough),
    passthroughFieldCount: passthroughFieldCount(passthrough)
  };
}

export function compatibleV11StoryBibleAsset(input: {
  readonly asset: StoryBibleV11Asset;
  readonly checksum: string;
  readonly relativePath: string;
}): StoryBibleCompatibleAssetRead {
  const passthrough = input.asset.passthrough;
  if (passthrough !== undefined) assertPassthroughBounds(passthrough);
  return {
    asset: input.asset,
    persistedSchemaVersion: "1.1",
    relativePath: input.relativePath,
    checksum: input.checksum,
    revision: input.asset.revision,
    passthroughPresent: passthrough !== undefined && hasPassthroughFields(passthrough),
    passthroughFieldCount: passthrough === undefined ? 0 : passthroughFieldCount(passthrough)
  };
}

export function deriveRelatedEntityIds(
  relations: readonly StoryBibleRelation[]
): readonly string[] | undefined {
  const ids = [...new Set(relations.map((relation) => relation.targetId))].sort(compareBinary);
  return ids.length === 0 ? undefined : ids;
}

function collectLegacyDetailPassthrough(
  type: StoryBibleV11AssetType,
  details: JsonObject
): JsonObject {
  const captured: JsonObject = {};
  collectUnknownFields(details, storyBibleDetailsSchema(type), "", captured);
  return captured;
}

function sanitizeLegacyDetails(type: StoryBibleV11AssetType, details: JsonObject): JsonObject {
  const sanitized = sanitizeKnownFields(details, storyBibleDetailsSchema(type));
  return isRecord(sanitized) ? sanitized : {};
}

function storyBibleDetailsSchema(type: StoryBibleV11AssetType): JsonObject {
  const assetSchema = createStoryBibleV11Schema(type);
  const properties = isRecord(assetSchema["properties"]) ? assetSchema["properties"] : undefined;
  return properties !== undefined && isRecord(properties["details"]) ? properties["details"] : {};
}

function collectUnknownFields(
  value: JsonValue,
  rawSchema: JsonObject,
  pointer: string,
  captured: JsonObject
): void {
  const schema = selectSchemaBranch(rawSchema, value);
  if (Array.isArray(value)) {
    const itemSchema = isRecord(schema["items"]) ? schema["items"] : undefined;
    if (itemSchema === undefined) return;
    for (const [index, entry] of value.entries()) {
      collectUnknownFields(entry, itemSchema, `${pointer}/${index}`, captured);
    }
    return;
  }
  if (!isRecord(value)) return;
  const properties = isRecord(schema["properties"]) ? schema["properties"] : undefined;
  if (properties === undefined) return;
  const additionalProperties = schema["additionalProperties"];
  for (const [key, entry] of Object.entries(value)) {
    const childPointer = `${pointer}/${escapePointer(key)}`;
    const propertySchema = properties[key];
    if (isRecord(propertySchema)) {
      collectUnknownFields(entry, propertySchema, childPointer, captured);
    } else if (additionalProperties === false) {
      captured[childPointer] = { value: entry };
    } else if (isRecord(additionalProperties)) {
      collectUnknownFields(entry, additionalProperties, childPointer, captured);
    }
  }
}

function sanitizeKnownFields(value: JsonValue, rawSchema: JsonObject): JsonValue {
  const schema = selectSchemaBranch(rawSchema, value);
  if (Array.isArray(value)) {
    const itemSchema = isRecord(schema["items"]) ? schema["items"] : undefined;
    return itemSchema === undefined
      ? value
      : value.map((entry) => sanitizeKnownFields(entry, itemSchema));
  }
  if (!isRecord(value)) return value;
  const properties = isRecord(schema["properties"]) ? schema["properties"] : undefined;
  if (properties === undefined) return value;
  const additionalProperties = schema["additionalProperties"];
  const sanitized: JsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    const propertySchema = properties[key];
    if (isRecord(propertySchema)) {
      sanitized[key] = sanitizeKnownFields(entry, propertySchema);
    } else if (additionalProperties !== false) {
      sanitized[key] = isRecord(additionalProperties)
        ? sanitizeKnownFields(entry, additionalProperties)
        : entry;
    }
  }
  return sanitized;
}

function selectSchemaBranch(schema: JsonObject, value: JsonValue): JsonObject {
  const branches = Array.isArray(schema["oneOf"])
    ? schema["oneOf"]
    : Array.isArray(schema["anyOf"])
      ? schema["anyOf"]
      : undefined;
  if (branches === undefined) return schema;
  const candidates = branches.filter(isRecord);
  return candidates.find((candidate) => schemaTypeMatches(candidate, value)) ?? schema;
}

function schemaTypeMatches(schema: JsonObject, value: JsonValue): boolean {
  const type = schema["type"];
  if (type === undefined) return true;
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return isRecord(value);
  if (type === "string") return typeof value === "string";
  if (type === "boolean") return typeof value === "boolean";
  if (type === "number") return typeof value === "number";
  if (type === "integer") return Number.isInteger(value);
  return false;
}

function normalizeLegacyDetails(
  type: StoryBibleV11AssetType,
  assetId: string,
  details: JsonObject
): JsonObject {
  const knownKeys = new Set(getStoryBibleKnownDetailKeys(type));
  const normalized: JsonObject = {};
  for (const [key, value] of Object.entries(details)) {
    if (knownKeys.has(key)) normalized[key] = value;
  }
  if (type === "character" && Array.isArray(normalized["goals"])) {
    normalized["goals"] = {
      external: stringArray(normalized["goals"]).join("\n"),
      internal: ""
    };
  }
  if (type === "outline") return normalizeLegacyOutline(details);
  if (type === "timeline.events") return normalizeLegacyTimeline(details);
  if (type === "foreshadow") return normalizeLegacyForeshadow(details);
  if (type === "world.rule" && normalized["statement"] === undefined) {
    const rule = stringValue(normalized["rule"]);
    if (rule !== undefined) normalized["statement"] = rule;
  }
  if (type === "character") {
    normalized["knowledgeStates"] ??= [];
    normalized["stateHistory"] ??= [];
  }
  if (type === "world.item") normalized["stateHistory"] ??= [];
  void assetId;
  return normalized;
}

function normalizeLegacyOutline(details: JsonObject): JsonObject {
  const volumes = recordArray(details["volumes"]).map((volume, index) => ({
    volumeId: stableEntryId("vol", volume["id"] ?? volume["title"] ?? index, index),
    entryRevision: 1,
    title: stringValue(volume["title"]) ?? `Volume ${index + 1}`,
    summary: stringValue(volume["summary"]) ?? "",
    goals: stringArray(volume["goals"]),
    chapterIds: stringArray(volume["chapterIds"])
  }));
  const chapterOutlines = recordArray(details["chapterOutlines"]).map((chapter, index) => {
    const beats = recordArray(chapter["beats"]).map((beat, beatIndex) => ({
      beatId: stableEntryId(
        "beat",
        beat["beatId"] ?? beat["id"] ?? beat["title"] ?? beatIndex,
        beatIndex
      ),
      entryRevision: positiveInteger(beat["entryRevision"]),
      title: stringValue(beat["title"]) ?? `Beat ${beatIndex + 1}`,
      purpose: stringValue(beat["purpose"]) ?? "",
      result: stringValue(beat["result"]) ?? "",
      scene: stringValue(beat["scene"]) ?? ""
    }));
    return {
      chapterOutlineId: stableEntryId(
        "cho",
        chapter["chapterOutlineId"] ?? chapter["chapterId"] ?? index,
        index
      ),
      chapterId: stringValue(chapter["chapterId"]) ?? `ch_legacy_${index + 1}`,
      entryRevision: positiveInteger(chapter["entryRevision"]),
      goal: stringValue(chapter["goal"]) ?? "",
      conflict: stringValue(chapter["conflict"]) ?? "",
      turningPoint: stringValue(chapter["turningPoint"]) ?? "",
      notes: stringValue(chapter["notes"]) ?? "",
      povCharacterId: stringValue(chapter["povCharacterId"]) ?? null,
      characterIds: stringArray(chapter["characterIds"]),
      locationIds: stringArray(chapter["locationIds"]),
      foreshadowIds: stringArray(chapter["foreshadowIds"]),
      beats,
      expectedStateChanges: stringArray(chapter["expectedStateChanges"]),
      actualOutcome: stringValue(chapter["actualOutcome"]) ?? null,
      deviations: stringArray(chapter["deviations"])
    };
  });
  return {
    ...(typeof details["premise"] === "string" ? { premise: details["premise"] } : {}),
    ...(Array.isArray(details["themes"]) ? { themes: stringArray(details["themes"]) } : {}),
    volumes,
    chapterOutlines
  };
}

function normalizeLegacyTimeline(details: JsonObject): JsonObject {
  const events = recordArray(details["events"]).map((event, index) => {
    const eventId = stableEntryId("evt", event["eventId"] ?? event["id"] ?? index, index);
    const rawTime = isRecord(event["time"]) ? event["time"] : undefined;
    const time =
      rawTime === undefined
        ? {
            mode: "sequence-only",
            label: stringValue(event["timeLabel"]) ?? "",
            uncertain: false
          }
        : {
            mode: stringValue(rawTime["mode"]) ?? "unknown",
            label: stringValue(rawTime["label"]) ?? "",
            ...(typeof rawTime["absolute"] === "string" ? { absolute: rawTime["absolute"] } : {}),
            ...(typeof rawTime["anchorEventId"] === "string"
              ? {
                  anchorEventId: normalizeEventReference(
                    rawTime["anchorEventId"],
                    eventsIdentitySeed(details)
                  )
                }
              : {}),
            ...(isRecord(rawTime["offset"]) ? { offset: rawTime["offset"] as JsonObject } : {}),
            uncertain: rawTime["uncertain"] === true
          };
    return {
      eventId,
      entryRevision: positiveInteger(event["entryRevision"]),
      title: stringValue(event["title"]) ?? eventId,
      sequence: positiveInteger(event["sequence"], index + 1),
      time,
      ...(typeof event["duration"] === "string" ? { duration: event["duration"] } : {}),
      summary: stringValue(event["summary"]) ?? "",
      chapterIds: stringArray(event["chapterIds"]),
      characterIds: stringArray(event["characterIds"]),
      locationIds: stringArray(event["locationIds"]),
      parallelEventIds: stringArray(event["parallelEventIds"]),
      causes: normalizeLegacyEventReferences(event["causes"], details),
      effects: normalizeLegacyEventReferences(event["effects"], details),
      stateChanges: recordArray(event["stateChanges"])
    };
  });
  return { events };
}

function normalizeLegacyForeshadow(details: JsonObject): JsonObject {
  const sourceRefs = recordArray(details["sourceRefs"]);
  const trackingStatus = stringValue(details["trackingStatus"]) ?? "planned";
  const milestones = sourceRefs.map((source, index) => {
    const chapterId = stringValue(source["chapterId"]) ?? "ch_legacy";
    const excerpt = stringValue(source["excerpt"]) ?? "?";
    const kind =
      trackingStatus === "paid-off" && chapterId === details["actualPayoffChapterId"]
        ? "payoff"
        : "plant";
    return {
      milestoneId: stableEntryId("fsm", `${chapterId}:${source["excerptHash"] ?? index}`, index),
      entryRevision: 1,
      kind,
      chapterId,
      timelineEventId: null,
      evidence: {
        start: 0,
        end: Math.max(1, excerpt.length),
        excerptHash: stringValue(source["excerptHash"]) ?? checksumStoryBibleText(excerpt)
      },
      note: "Migrated from v1.0 source evidence; verify the chapter character range."
    };
  });
  if (trackingStatus === "paid-off" && !milestones.some((entry) => entry.kind === "payoff")) {
    const chapterId = stringValue(details["actualPayoffChapterId"]);
    if (chapterId !== undefined) {
      milestones.push({
        milestoneId: stableEntryId("fsm", `payoff:${chapterId}`, milestones.length),
        entryRevision: 1,
        kind: "payoff",
        chapterId,
        timelineEventId: null,
        evidence: { start: 0, end: 1, excerptHash: "0".repeat(64) },
        note: "Migrated from the v1.0 payoff chapter; attach exact evidence before relying on it."
      });
    }
  }
  return {
    trackingStatus,
    ...(typeof details["plantedChapterId"] === "string"
      ? { plantedChapterId: details["plantedChapterId"] }
      : {}),
    ...(typeof details["plannedPayoffChapterId"] === "string"
      ? { plannedPayoffChapterId: details["plannedPayoffChapterId"] }
      : {}),
    ...(typeof details["actualPayoffChapterId"] === "string"
      ? { actualPayoffChapterId: details["actualPayoffChapterId"] }
      : {}),
    ...(typeof details["origin"] === "string" ? { origin: details["origin"] } : {}),
    ...(typeof details["notes"] === "string" ? { notes: details["notes"] } : {}),
    sourceRefs: sourceRefs as JsonObject[],
    milestones
  };
}

function normalizeLegacyEventReferences(value: unknown, details: JsonObject): string[] {
  const seeds = eventsIdentitySeed(details);
  return stringArray(value).map((eventId) => normalizeEventReference(eventId, seeds));
}

function normalizeEventReference(value: string, seeds: ReadonlyMap<string, string>): string {
  return /^evt_[a-f0-9]{32}$/u.test(value) ? value : (seeds.get(value) ?? value);
}

function eventsIdentitySeed(details: JsonObject): ReadonlyMap<string, string> {
  const seeds = new Map<string, string>();
  for (const [index, event] of recordArray(details["events"]).entries()) {
    const legacyId = stringValue(event["eventId"]) ?? stringValue(event["id"]);
    if (legacyId !== undefined) seeds.set(legacyId, stableEntryId("evt", legacyId, index));
  }
  return seeds;
}

function legacyRelation(
  sourceId: string,
  targetId: string,
  checksum: string,
  index: number
): StoryBibleRelation {
  return {
    relationId: stableEntryId("rel", `${sourceId}:${targetId}:${checksum}`, index),
    sourceId,
    targetId,
    relationType: "legacy.related",
    direction: "directed",
    status: "uncertain",
    validFromChapterId: null,
    validToChapterId: null,
    inversePolicy: "none",
    inverseRelationId: null,
    evidence: [],
    note: "Migrated from relatedEntityIds; classify this relation before relying on its semantics."
  };
}

function stableEntryId(prefix: string, seed: unknown, index: number): string {
  const candidate = typeof seed === "string" ? seed : JSON.stringify(seed);
  if (new RegExp(`^${prefix}_[a-f0-9]{32}$`, "u").test(candidate)) return candidate;
  const digest = createHash("sha256")
    .update(`${prefix}:${index}:${candidate}`, "utf8")
    .digest("hex")
    .slice(0, 32);
  return `${prefix}_${digest}`;
}

function passthroughFieldCount(value: StoryBiblePassthrough): number {
  return Object.keys(value.rootFields).length + Object.keys(value.detailFieldsByPointer).length;
}

function hasPassthroughFields(value: StoryBiblePassthrough): boolean {
  return passthroughFieldCount(value) > 0;
}

function assertPassthroughBounds(value: StoryBiblePassthrough): void {
  const serialized = JSON.stringify(value);
  if (new TextEncoder().encode(serialized).byteLength > 256 * 1024) {
    throw new Error("Legacy Story Bible passthrough exceeds the 256 KiB limit.");
  }
  const bounds = countJson(value, 0);
  if (bounds.depth > 32 || bounds.nodes > 10_000) {
    throw new Error("Legacy Story Bible passthrough exceeds structural limits.");
  }
}

function countJson(
  value: JsonValue,
  depth: number
): { readonly nodes: number; readonly depth: number } {
  if (value === null || typeof value !== "object") return { nodes: 1, depth };
  const children = Array.isArray(value) ? value : Object.values(value);
  let nodes = 1;
  let maxDepth = depth;
  for (const child of children) {
    const counted = countJson(child, depth + 1);
    nodes += counted.nodes;
    maxDepth = Math.max(maxDepth, counted.depth);
  }
  return { nodes, depth: maxDepth };
}

function legacyStatus(value: unknown): StoryBibleV11Asset["status"] {
  return value === "draft" || value === "archived" || value === "deleted" ? value : "active";
}

function dateValue(value: unknown): string {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? value
    : "1970-01-01T00:00:00.000Z";
}

function positiveInteger(value: unknown, fallback = 1): number {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function recordArray(value: unknown): JsonObject[] {
  return Array.isArray(value) ? (value.filter(isRecord) as JsonObject[]) : [];
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapePointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function compareBinary(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}
