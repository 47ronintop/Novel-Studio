import { createHash } from "node:crypto";

import {
  STORY_EPISTEMIC_STATUSES,
  STORY_FACT_KINDS,
  STORY_OBSERVATION_DOMAINS,
  isStoryBibleV11AssetType,
  validateStoryBibleCreateValue,
  validateStoryAnalysisBundle,
  type StoryAnalysisBundle,
  type StoryAnalysisDependency,
  type StoryAnalysisPatchOperation,
  type StoryChangeSuggestion,
  type StoryEpistemicStatus,
  type StoryEvidenceRange,
  type StoryFactDelta,
  type StoryFactKind,
  type StoryObservation,
  type StoryObservationDomain,
  type StoryReviewIssue,
  type StoryBibleV11AssetType
} from "@novel-studio/schemas";
import {
  createUnifiedError,
  err,
  ok,
  type JsonObject,
  type JsonValue,
  type Result,
  type UnifiedError
} from "@novel-studio/shared";

import { checksumStoryBibleSelectorValue } from "./story-bible-patch.js";

const MAX_OBSERVATIONS = 1_000;
const MAX_EVIDENCE_RANGES = 100;
const MAX_REASON_LENGTH = 10_000;
const MAX_MENTION_LENGTH = 512;
const MAX_EXCERPT_LENGTH = 2_000;

const WORLD_DETAIL_FIELDS = Object.freeze({
  "world.location": new Set(["geography", "culture", "constraints"]),
  "world.faction": new Set(["goals", "structure", "membersOrInfluence", "resources"]),
  "world.rule": new Set([
    "rule",
    "statement",
    "scope",
    "costs",
    "constraints",
    "limitations",
    "exceptions"
  ]),
  "world.glossary": new Set(["definition", "termAliases", "firstAppearance"]),
  "world.item": new Set(["appearance", "origin", "abilities", "limitations"]),
  "world.lore": new Set(["body", "periods", "institutions", "customs", "legends", "systems"])
} satisfies Readonly<
  Record<Extract<StoryBibleV11AssetType, `world.${string}`>, ReadonlySet<string>>
>);

const OBJECTIVE_FACT_KINDS = new Set<StoryFactKind>([
  "character_behavior",
  "character_location",
  "character_held_items",
  "character_relationship",
  "character_emotional",
  "character_physical",
  "world_item_holder",
  "world_item_location",
  "world_item_state",
  "world_detail",
  "outline_actual_outcome",
  "outline_deviation",
  "foreshadow_milestone",
  "timeline_event",
  "new_entity"
]);

const FACTS_BY_DOMAIN: Readonly<Record<StoryObservationDomain, ReadonlySet<StoryFactKind>>> = {
  "character.behavior": new Set([
    "character_behavior",
    "outline_actual_outcome",
    "outline_deviation"
  ]),
  "character.location": new Set(["character_location"]),
  "character.resource": new Set([
    "character_held_items",
    "world_item_holder",
    "world_item_location",
    "world_item_state",
    "new_entity"
  ]),
  "character.relationship": new Set(["character_relationship"]),
  "character.emotion": new Set(["character_emotional"]),
  "character.information": new Set(["character_knowledge", "world_detail"]),
  foreshadow: new Set(["foreshadow_milestone", "new_entity"]),
  timeline: new Set(["timeline_event", "outline_actual_outcome", "outline_deviation"]),
  "character.physical_state": new Set(["character_physical"])
};

export interface StoryAnalysisAsset extends JsonObject {
  readonly schemaVersion: "1.1";
  readonly id: string;
  readonly type: StoryBibleV11AssetType;
  readonly title: string;
  readonly status: "active" | "draft" | "archived" | "deleted";
  readonly summary: string;
  readonly aliases: string[];
  readonly relations: JsonObject[];
  readonly details: JsonObject;
  readonly extensions: JsonObject;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revision: number;
}

export interface StoryAnalysisAssetRead {
  readonly asset: StoryAnalysisAsset;
  readonly checksum: string;
}

export interface MaterializeStoryObserverInput {
  readonly analysisRunId: string;
  readonly chapter: {
    readonly chapterId: string;
    readonly checksum: string;
    readonly body: string;
  };
  readonly assets: readonly StoryAnalysisAssetRead[];
  readonly indexRevision: string;
  readonly promptVersion: string;
  readonly extractorVersion: string;
  readonly output: unknown;
  readonly createdAt: string;
  readonly existingIdempotencyKeys?: ReadonlySet<string>;
}

export interface StoryObserverValidationError {
  readonly code: string;
  readonly message: string;
}

export interface MaterializedStoryObserverOutput {
  readonly observations: readonly StoryObservation[];
  readonly factDeltas: readonly StoryFactDelta[];
  readonly records: readonly (StoryChangeSuggestion | StoryReviewIssue)[];
  readonly validation: {
    readonly observationCount: number;
    readonly acceptedCount: number;
    readonly rejectedCount: number;
    readonly errors: readonly StoryObserverValidationError[];
  };
}

interface RawStoryObservation {
  readonly domain: StoryObservationDomain;
  readonly subjectMention: string;
  readonly expectedType: StoryBibleV11AssetType | null;
  readonly fact: { readonly kind: StoryFactKind; readonly value: JsonValue };
  readonly evidence: readonly {
    readonly start: number;
    readonly end: number;
    readonly excerpt: string;
  }[];
  readonly epistemicStatus: StoryEpistemicStatus;
  readonly confidence: number;
  readonly reason: string;
}

interface EntityResolution {
  readonly mention: string;
  readonly expectedType: StoryBibleV11AssetType | null;
  readonly candidates: readonly StoryAnalysisAssetRead[];
  readonly resolved: StoryAnalysisAssetRead | null;
  readonly dependency: Extract<StoryAnalysisDependency, { readonly kind: "type_index" }>;
}

interface RouteContext {
  readonly input: MaterializeStoryObserverInput;
  readonly observation: StoryObservation;
  readonly raw: RawStoryObservation;
  readonly resolution: EntityResolution;
  readonly assetsById: ReadonlyMap<string, StoryAnalysisAssetRead>;
  readonly timeline: TimelineAccumulator;
  readonly holders: HolderAccumulator;
  readonly relationships: RelationshipAccumulator;
}

interface TimelineContribution {
  readonly context: RouteContext;
  readonly event?: JsonObject;
  readonly stateChange?: JsonObject;
}

interface TimelineAccumulator {
  readonly timeline: StoryAnalysisAssetRead | undefined;
  readonly consistencyGroupId: string;
  readonly stateEventId: string;
  readonly contributions: TimelineContribution[];
}

interface AccumulatedTarget {
  readonly target: StoryAnalysisAssetRead;
  readonly contexts: RouteContext[];
  readonly dependencies: StoryAnalysisDependency[];
}

interface HolderAccumulator {
  readonly assetsById: ReadonlyMap<string, StoryAnalysisAssetRead>;
  readonly holderIdByItemId: Map<string, string | null>;
  readonly itemIdsByCharacterId: Map<string, Set<string>>;
  readonly claimedHolderIdByItemId: Map<string, string | null>;
  readonly touchedCharacters: Map<string, AccumulatedTarget>;
  readonly touchedItems: Map<string, AccumulatedTarget>;
  conflicted: boolean;
}

interface RelationshipAccumulator {
  readonly chapterChecksum: string;
  readonly assetsById: ReadonlyMap<string, StoryAnalysisAssetRead>;
  readonly projectionsByOwnerId: Map<string, RelationshipProjection>;
  readonly unitsByKey: Map<string, RelationshipUnit>;
  readonly claimedStatusByUnitKey: Map<string, string>;
}

interface RelationshipProjection {
  readonly owner: StoryAnalysisAssetRead;
  readonly baseRelations: readonly JsonObject[];
  readonly tracksByExistingIndex: Map<number, RelationshipTrack>;
  readonly tracksBySemanticKey: Map<string, RelationshipTrack>;
  readonly tracks: RelationshipTrack[];
}

interface RelationshipTrack {
  readonly owner: StoryAnalysisAssetRead;
  readonly semanticKey: string;
  readonly baseIndex: number | null;
  currentRelation: JsonObject;
  unitKey: string | null;
}

interface RelationshipUnit {
  readonly key: string;
  readonly tracks: Set<RelationshipTrack>;
  readonly contexts: RouteContext[];
  readonly dependencies: StoryAnalysisDependency[];
  conflicted: boolean;
}

type RouteOutcome =
  | { readonly kind: "deltas"; readonly deltas: readonly StoryFactDelta[] }
  | { readonly kind: "issue"; readonly issue: StoryReviewIssue };

interface ItemHolderTransition {
  readonly item: StoryAnalysisAssetRead;
  readonly nextHolder: StoryAnalysisAssetRead | null;
}

export function materializeStoryObserverOutput(
  input: MaterializeStoryObserverInput
): Result<MaterializedStoryObserverOutput, UnifiedError> {
  const root = parseObserverRoot(input.output);
  if (!root.ok) return root;

  const assets = input.assets
    .filter((entry) => entry.asset.status !== "deleted")
    .slice()
    .sort((left, right) => compareText(left.asset.id, right.asset.id));
  const assetsById = new Map(assets.map((entry) => [entry.asset.id, entry] as const));
  const errors: StoryObserverValidationError[] = [];
  const observations: StoryObservation[] = [];
  const deltas: StoryFactDelta[] = [];
  const records: (StoryChangeSuggestion | StoryReviewIssue)[] = [];
  const existingKeys = input.existingIdempotencyKeys ?? new Set<string>();
  const timeline = createTimelineAccumulator(input, assets);
  const holders = createHolderAccumulator(assets, assetsById);
  const relationships = createRelationshipAccumulator(input, assetsById);

  for (const [index, candidate] of root.value.entries()) {
    const parsed = parseRawObservation(candidate, input.chapter.body);
    if (!parsed.ok) {
      errors.push({ code: `observation_${index}_${parsed.code}`, message: parsed.message });
      continue;
    }

    const raw = parsed.value;
    const resolution = resolveEntity(
      raw.subjectMention,
      raw.expectedType,
      assets,
      input.indexRevision
    );
    const observationId = stableId("obs", `${input.analysisRunId}:${index}:${stableJson(raw)}`);
    const observation: StoryObservation = {
      schemaVersion: "1.1",
      observationId,
      analysisRunId: input.analysisRunId,
      chapter: {
        chapterId: input.chapter.chapterId,
        checksum: input.chapter.checksum
      },
      domain: raw.domain,
      subject: {
        mention: raw.subjectMention,
        expectedType: raw.expectedType,
        candidateAssetIds: resolution.candidates.map((entry) => entry.asset.id),
        resolvedAssetId: resolution.resolved?.asset.id ?? null
      },
      fact: raw.fact,
      evidence: raw.evidence.map(({ start, end, excerpt }) => ({
        start,
        end,
        excerptHash: checksumText(excerpt)
      })),
      epistemicStatus: raw.epistemicStatus,
      confidence: raw.confidence,
      reason: raw.reason
    };
    observations.push(observation);

    const route = routeObservation({
      input,
      observation,
      raw,
      resolution,
      assetsById,
      timeline,
      holders,
      relationships
    });
    if (route.kind === "issue") {
      if (!existingKeys.has(route.issue.idempotencyKey)) records.push(route.issue);
      continue;
    }
    deltas.push(...route.deltas);
  }

  deltas.push(...materializeHolderDeltas(holders));
  deltas.push(...materializeRelationshipDeltas(relationships));
  const timelineDelta = materializeTimelineDelta(timeline);
  if (timelineDelta !== undefined) {
    deltas.push(timelineDelta);
  }
  const deduplicatedDeltas = deduplicateDeltas(deltas);
  for (const delta of deduplicatedDeltas) {
    if (!existingKeys.has(delta.idempotencyKey)) records.push(toSuggestion(delta, input.createdAt));
  }
  for (const issue of createOverdueForeshadowIssues(input, assets)) {
    if (!existingKeys.has(issue.idempotencyKey)) records.push(issue);
  }

  const conflictResolution = deduplicateAndResolveConflicts(records, input);
  const conflictedGroupIds = new Set([
    ...conflictResolution.conflictedGroupIds,
    ...(holders.conflicted ? [timeline.consistencyGroupId] : [])
  ]);
  return ok({
    observations,
    factDeltas: deduplicatedDeltas.filter(
      (delta) => !conflictedGroupIds.has(delta.consistencyGroupId)
    ),
    records: conflictResolution.records.filter(
      (record) =>
        record.recordType === "review_issue" || !conflictedGroupIds.has(record.consistencyGroupId)
    ),
    validation: {
      observationCount: root.value.length,
      acceptedCount: observations.length,
      rejectedCount: root.value.length - observations.length,
      errors
    }
  });
}

export function transitionStoryAnalysisRecord(input: {
  readonly bundle: StoryAnalysisBundle;
  readonly recordId: string;
  readonly expectedRevision: number;
  readonly transition:
    | { readonly status: "accepted" | "applied" | "rejected" | "stale" | "failed" }
    | {
        readonly status: "resolved";
        readonly decision: string;
        readonly changeSetId: string | null;
        readonly actor: "author" | "system";
      }
    | { readonly status: "dismissed"; readonly reason: string }
    | { readonly status: "issue_stale"; readonly supersededByIssueId: string | null };
  readonly updatedAt: string;
}): Result<StoryAnalysisBundle, UnifiedError> {
  const index = input.bundle.records.findIndex(
    (record) => recordIdentity(record) === input.recordId
  );
  if (index === -1)
    return err(engineError("STORY_ANALYSIS_RECORD_NOT_FOUND", "Analysis record was not found."));
  const current = input.bundle.records[index];
  if (current === undefined)
    return err(engineError("STORY_ANALYSIS_RECORD_NOT_FOUND", "Analysis record was not found."));
  if (current.revision !== input.expectedRevision) {
    return err(
      engineError(
        "STORY_ANALYSIS_RECORD_REVISION_CONFLICT",
        "Analysis record changed before the transition."
      )
    );
  }

  const transitioned =
    current.recordType === "change"
      ? transitionSuggestion(current, input.transition, input.updatedAt)
      : transitionIssue(current, input.transition, input.updatedAt);
  if (!transitioned.ok) return transitioned;

  const records = input.bundle.records.slice();
  records[index] = transitioned.value;
  const bundle: StoryAnalysisBundle = { ...input.bundle, records };
  const validation = validateStoryAnalysisBundle(bundle);
  return validation.valid
    ? ok(bundle)
    : err(
        engineError(
          "STORY_ANALYSIS_TRANSITION_INVALID",
          "Analysis transition produced invalid state."
        )
      );
}

export function refreshStoryAnalysisStaleness(input: {
  readonly bundle: StoryAnalysisBundle;
  readonly currentChapterChecksum: string;
  readonly assets: readonly StoryAnalysisAssetRead[];
  readonly indexRevision: string;
  readonly updatedAt: string;
}): StoryAnalysisBundle {
  const assets = input.assets.filter((entry) => entry.asset.status !== "deleted");
  const assetsById = new Map(assets.map((entry) => [entry.asset.id, entry] as const));
  const observationsById = new Map(
    input.bundle.observations.map(
      (observation) => [observation.observationId, observation] as const
    )
  );

  const refreshedRecords = input.bundle.records.map((record) => {
    if (!isReviewableRecord(record)) return record;
    let stale = false;
    let rebased = false;
    const dependencies = record.dependencies.map((dependency): StoryAnalysisDependency => {
      if (dependency.kind === "chapter") {
        stale ||= dependency.checksum !== input.currentChapterChecksum;
        return dependency;
      }
      if (dependency.kind === "asset_fields") {
        const asset = assetsById.get(dependency.assetId);
        if (asset === undefined) {
          stale = true;
          return dependency;
        }
        const checksum = checksumSelectors(asset.asset, dependency.selectors);
        if (checksum !== dependency.valueChecksum) {
          stale = true;
          return dependency;
        }
        if (asset.asset.revision !== dependency.baseRevision) {
          rebased = true;
          return { ...dependency, baseRevision: asset.asset.revision };
        }
        return dependency;
      }

      if (dependency.indexRevision === input.indexRevision) return dependency;
      if (record.recordType !== "change") {
        stale = true;
        return dependency;
      }
      const observation = record.observationIds
        .map((observationId) => observationsById.get(observationId))
        .find((entry) => entry !== undefined);
      const resolution =
        observation === undefined
          ? undefined
          : resolveDependencyQuery(dependency, observation, assets, input.indexRevision);
      if (resolution === undefined) {
        stale = true;
        return dependency;
      }
      const referencedAssetIds = referencedIds(record, assetsById);
      if (record.action === "create" && resolution.candidates.length > 0) {
        stale = true;
      } else if (
        record.action === "patch" &&
        (resolution.resolved === null || !referencedAssetIds.has(resolution.resolved.asset.id))
      ) {
        stale = true;
      } else {
        rebased = true;
      }
      return { ...dependency, indexRevision: input.indexRevision };
    });

    const target =
      record.recordType === "change" && record.target !== null
        ? {
            ...record.target,
            baseRevision:
              assetsById.get(record.target.assetId)?.asset.revision ?? record.target.baseRevision
          }
        : null;
    if (stale) {
      return record.recordType === "change"
        ? {
            ...record,
            status: "stale" as const,
            revision: record.revision + 1,
            updatedAt: input.updatedAt,
            dependencies,
            target
          }
        : {
            ...record,
            status: "stale" as const,
            revision: record.revision + 1,
            updatedAt: input.updatedAt,
            dependencies
          };
    }
    if (!rebased) return record;
    return record.recordType === "change"
      ? { ...record, dependencies, target }
      : { ...record, dependencies };
  });
  const staleGroupIds = new Set(
    refreshedRecords.flatMap((record) =>
      record.recordType === "change" && record.status === "stale" ? [record.consistencyGroupId] : []
    )
  );
  const records = refreshedRecords.map((record) =>
    record.recordType === "change" &&
    staleGroupIds.has(record.consistencyGroupId) &&
    (record.status === "pending" || record.status === "accepted")
      ? {
          ...record,
          status: "stale" as const,
          revision: record.revision + 1,
          updatedAt: input.updatedAt
        }
      : record
  );
  return { ...input.bundle, records };
}

export function checksumStoryAnalysisSelectors(
  asset: StoryAnalysisAsset,
  selectors: readonly string[]
): string {
  return checksumSelectors(asset, selectors);
}

function parseObserverRoot(value: unknown): Result<readonly unknown[], UnifiedError> {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["observations"]) ||
    !Array.isArray(value["observations"]) ||
    value["observations"].length > MAX_OBSERVATIONS
  ) {
    return err(
      engineError(
        "STORY_OBSERVER_OUTPUT_INVALID",
        "Story Observer output must contain only a bounded observations array."
      )
    );
  }
  return ok(value["observations"]);
}

function parseRawObservation(
  value: unknown,
  chapterBody: string
):
  | { readonly ok: true; readonly value: RawStoryObservation }
  | {
      readonly ok: false;
      readonly code: string;
      readonly message: string;
    } {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "domain",
      "subjectMention",
      "expectedType",
      "fact",
      "evidence",
      "epistemicStatus",
      "confidence",
      "reason"
    ])
  ) {
    return rejected("shape", "Observation fields do not match the Observer contract.");
  }
  if (!isObservationDomain(value["domain"]))
    return rejected("domain", "Observation domain is invalid.");
  if (
    typeof value["subjectMention"] !== "string" ||
    value["subjectMention"].trim().length === 0 ||
    value["subjectMention"].length > MAX_MENTION_LENGTH
  ) {
    return rejected("subject", "Observation subject mention is invalid.");
  }
  const expectedType = value["expectedType"];
  if (expectedType !== null && !isStoryBibleV11AssetType(expectedType)) {
    return rejected("subject_type", "Observation expected type is invalid.");
  }
  if (!isRecord(value["fact"]) || !hasExactKeys(value["fact"], ["kind", "value"])) {
    return rejected("fact", "Observation fact is invalid.");
  }
  const factKind = value["fact"]["kind"];
  if (!isFactKind(factKind) || !FACTS_BY_DOMAIN[value["domain"]].has(factKind)) {
    return rejected("fact_kind", "Observation fact does not belong to its domain.");
  }
  if (!isJsonValue(value["fact"]["value"])) {
    return rejected("fact_value", "Observation fact value is not JSON data.");
  }
  const evidence = parseEvidence(value["evidence"], chapterBody);
  if (evidence === undefined)
    return rejected("evidence", "Observation evidence does not match the saved chapter.");
  if (!isEpistemicStatus(value["epistemicStatus"])) {
    return rejected("epistemic", "Observation epistemic status is invalid.");
  }
  if (
    typeof value["confidence"] !== "number" ||
    !Number.isFinite(value["confidence"]) ||
    value["confidence"] < 0 ||
    value["confidence"] > 1
  ) {
    return rejected("confidence", "Observation confidence is invalid.");
  }
  if (
    typeof value["reason"] !== "string" ||
    value["reason"].trim().length === 0 ||
    value["reason"].length > MAX_REASON_LENGTH
  ) {
    return rejected("reason", "Observation reason is invalid.");
  }

  return {
    ok: true,
    value: {
      domain: value["domain"],
      subjectMention: value["subjectMention"].trim(),
      expectedType,
      fact: { kind: factKind, value: structuredClone(value["fact"]["value"]) },
      evidence,
      epistemicStatus: value["epistemicStatus"],
      confidence: value["confidence"],
      reason: value["reason"].trim()
    }
  };
}

function parseEvidence(
  value: unknown,
  chapterBody: string
): RawStoryObservation["evidence"] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_EVIDENCE_RANGES) {
    return undefined;
  }
  const codePoints = Array.from(chapterBody);
  const evidence: { start: number; end: number; excerpt: string }[] = [];
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      !hasExactKeys(entry, ["start", "end", "excerpt"]) ||
      !Number.isSafeInteger(entry["start"]) ||
      !Number.isSafeInteger(entry["end"]) ||
      Number(entry["start"]) < 0 ||
      Number(entry["end"]) <= Number(entry["start"]) ||
      Number(entry["end"]) > codePoints.length ||
      typeof entry["excerpt"] !== "string" ||
      entry["excerpt"].length === 0 ||
      Array.from(entry["excerpt"]).length > MAX_EXCERPT_LENGTH ||
      codePoints.slice(Number(entry["start"]), Number(entry["end"])).join("") !== entry["excerpt"]
    ) {
      return undefined;
    }
    evidence.push({
      start: Number(entry["start"]),
      end: Number(entry["end"]),
      excerpt: entry["excerpt"]
    });
  }
  return evidence;
}

function routeObservation(context: RouteContext): RouteOutcome {
  const { raw, resolution } = context;
  if (raw.epistemicStatus !== "narrator_asserted" && OBJECTIVE_FACT_KINDS.has(raw.fact.kind)) {
    return {
      kind: "issue",
      issue: createIssue(context, "ambiguity", {
        reason: "Non-objective claims cannot update objective Story Bible fields.",
        fact: raw.fact
      })
    };
  }

  if (raw.fact.kind === "new_entity") return routeNewEntity(context);
  if (resolution.candidates.length !== 1 || resolution.resolved === null) {
    return {
      kind: "issue",
      issue: createIssue(
        context,
        resolution.candidates.length > 1 ? "ambiguity" : "unresolved_entity",
        {
          mention: raw.subjectMention,
          candidateAssetIds: resolution.candidates.map((entry) => entry.asset.id),
          fact: raw.fact
        }
      )
    };
  }

  const routed = routeResolvedFact(context, resolution.resolved);
  return (
    routed ?? {
      kind: "issue",
      issue: createIssue(context, "ambiguity", {
        reason: "The fact could not be mapped to a safe structured field.",
        fact: raw.fact
      })
    }
  );
}

function routeResolvedFact(
  context: RouteContext,
  subject: StoryAnalysisAssetRead
): RouteOutcome | undefined {
  const kind = context.raw.fact.kind;
  switch (kind) {
    case "character_location":
      return routeCharacterLocation(context, subject);
    case "character_held_items":
      return routeCharacterHeldItems(context, subject);
    case "character_relationship":
      return routeCharacterRelationship(context, subject);
    case "character_emotional":
      return routeCharacterState(context, subject, "emotional");
    case "character_physical":
      return routeCharacterState(context, subject, "physical");
    case "character_knowledge":
      return routeCharacterKnowledge(context, subject);
    case "foreshadow_milestone":
      return routeForeshadow(context, subject);
    case "character_behavior":
    case "timeline_event":
      return routeTimelineEvent(context, kind === "character_behavior" ? subject : undefined);
    case "outline_actual_outcome":
    case "outline_deviation":
      return routeOutlineResult(context, subject, kind);
    case "world_item_holder":
    case "world_item_location":
    case "world_item_state":
      return routeWorldItem(context, subject, kind);
    case "world_detail":
      return routeWorldDetail(context, subject);
    case "new_entity":
      return undefined;
  }
}

function routeWorldDetail(context: RouteContext, subject: StoryAnalysisAssetRead): RouteOutcome {
  const allowedFields = isWorldDetailType(subject.asset.type)
    ? WORLD_DETAIL_FIELDS[subject.asset.type]
    : undefined;
  const value = context.raw.fact.value;
  if (
    allowedFields === undefined ||
    !isRecord(value) ||
    !hasExactKeys(value, ["fields"]) ||
    !isRecord(value["fields"])
  ) {
    return unsafeStructuredFactIssue(context, "World detail fields do not match the target type.");
  }

  const fields = Object.entries(value["fields"]).sort(([left], [right]) =>
    compareText(left, right)
  );
  if (fields.length === 0 || fields.some(([field]) => !allowedFields.has(field))) {
    return unsafeStructuredFactIssue(
      context,
      "World detail updates contain unsupported or reference-bearing fields."
    );
  }

  const nextDetails = structuredClone(subject.asset.details);
  for (const [field, fieldValue] of fields) nextDetails[field] = structuredClone(fieldValue);
  const validation = validateStoryBibleCreateValue(subject.asset.type, {
    title: subject.asset.title,
    status: subject.asset.status === "deleted" ? "draft" : subject.asset.status,
    summary: subject.asset.summary,
    aliases: subject.asset.aliases,
    relations: subject.asset.relations,
    details: nextDetails,
    extensions: subject.asset.extensions
  });
  if (!validation.valid) {
    return unsafeStructuredFactIssue(
      context,
      "World detail values do not satisfy the strict Story Bible schema."
    );
  }

  return patchFields(context, subject, {
    fields: fields.map(([field, fieldValue]) => [`/details/${field}`, fieldValue] as const),
    extraDependencies: [context.resolution.dependency]
  });
}

function routeNewEntity(context: RouteContext): RouteOutcome {
  const value = context.raw.fact.value;
  if (
    context.raw.expectedType === null ||
    context.resolution.candidates.length > 0 ||
    !isRecord(value) ||
    !hasOnlyKeys(value, ["title", "summary"]) ||
    typeof value["title"] !== "string" ||
    value["title"].trim().length === 0 ||
    (value["summary"] !== undefined && typeof value["summary"] !== "string")
  ) {
    return {
      kind: "issue",
      issue: createIssue(
        context,
        context.resolution.candidates.length > 0 ? "ambiguity" : "unresolved_entity",
        {
          mention: context.raw.subjectMention,
          candidateAssetIds: context.resolution.candidates.map((entry) => entry.asset.id),
          fact: context.raw.fact
        }
      )
    };
  }

  const semantic = stableJson({
    chapter: context.input.chapter.checksum,
    type: context.raw.expectedType,
    title: value["title"].trim()
  });
  const proposedAssetId = createAssetId(context.raw.expectedType, semantic);
  const createValue: JsonObject = {
    title: value["title"].trim(),
    status: "draft",
    summary: typeof value["summary"] === "string" ? value["summary"] : "",
    aliases: [],
    relations: [],
    extensions: {}
  };
  const delta = createDelta(context, {
    action: "create",
    target: null,
    proposedAssetType: context.raw.expectedType,
    proposedAssetId,
    createValue,
    operations: [],
    dependencies: [context.resolution.dependency, chapterDependency(context.input)]
  });
  return { kind: "deltas", deltas: [delta] };
}

function routeCharacterLocation(
  context: RouteContext,
  subject: StoryAnalysisAssetRead
): RouteOutcome | undefined {
  if (subject.asset.type !== "character" || !isRecord(context.raw.fact.value)) return undefined;
  const value = context.raw.fact.value;
  if (!hasExactKeys(value, ["locationMention"])) return undefined;
  let locationId: string | null = null;
  const dependencies: StoryAnalysisDependency[] = [context.resolution.dependency];
  if (value["locationMention"] !== null) {
    if (typeof value["locationMention"] !== "string") return undefined;
    const location = resolveEntity(
      value["locationMention"],
      "world.location",
      context.input.assets,
      context.input.indexRevision
    );
    if (location.resolved === null) return unresolvedRelatedEntity(context, location);
    locationId = location.resolved.asset.id;
    dependencies.push(location.dependency);
  }
  return patchStateFields(context, subject, {
    stateFields: [["/details/currentState/locationId", locationId]],
    extraDependencies: dependencies
  });
}

function routeCharacterHeldItems(
  context: RouteContext,
  subject: StoryAnalysisAssetRead
): RouteOutcome | undefined {
  if (subject.asset.type !== "character" || !isRecord(context.raw.fact.value)) return undefined;
  const value = context.raw.fact.value;
  if (!hasExactKeys(value, ["itemMentions"]) || !isUniqueStringArray(value["itemMentions"])) {
    return undefined;
  }
  const itemReads: StoryAnalysisAssetRead[] = [];
  const dependencies: StoryAnalysisDependency[] = [context.resolution.dependency];
  for (const mention of value["itemMentions"]) {
    const item = resolveEntity(
      mention,
      "world.item",
      context.input.assets,
      context.input.indexRevision
    );
    if (item.resolved === null) return unresolvedRelatedEntity(context, item);
    itemReads.push(item.resolved);
    dependencies.push(item.dependency);
  }
  const desiredItemIds = new Set(itemReads.map((entry) => entry.asset.id));
  const transitions: ItemHolderTransition[] = itemReads.map((item) => ({
    item,
    nextHolder: subject
  }));
  for (const [itemId, holderId] of context.holders.holderIdByItemId) {
    const candidate = context.assetsById.get(itemId);
    if (holderId === subject.asset.id && candidate !== undefined && !desiredItemIds.has(itemId)) {
      transitions.push({ item: candidate, nextHolder: null });
    }
  }
  return synchronizeItemHolders(context, {
    transitions,
    heldItemsOverride: {
      character: subject,
      itemIds: itemReads.map((entry) => entry.asset.id)
    },
    extraDependencies: dependencies
  });
}

function synchronizeItemHolders(
  context: RouteContext,
  input: {
    readonly transitions: readonly ItemHolderTransition[];
    readonly heldItemsOverride?: {
      readonly character: StoryAnalysisAssetRead;
      readonly itemIds: readonly string[];
    };
    readonly extraDependencies: readonly StoryAnalysisDependency[];
  }
): RouteOutcome {
  if (context.timeline.timeline === undefined) {
    return unsafeStructuredFactIssue(
      context,
      "A timeline singleton is required before holder changes can be synchronized."
    );
  }

  const accumulator = context.holders;
  const transitions = [
    ...new Map(input.transitions.map((entry) => [entry.item.asset.id, entry])).values()
  ];
  const validated: {
    readonly transition: ItemHolderTransition;
    readonly oldHolder: StoryAnalysisAssetRead | null;
    readonly nextHolderId: string | null;
  }[] = [];
  for (const transition of transitions) {
    if (
      transition.item.asset.type !== "world.item" ||
      (transition.nextHolder !== null && transition.nextHolder.asset.type !== "character")
    ) {
      return unsafeStructuredFactIssue(
        context,
        "Item holder synchronization requires valid item and character assets."
      );
    }
    const holderId = accumulator.holderIdByItemId.get(transition.item.asset.id) ?? null;
    const oldHolder = holderId === null ? null : accumulator.assetsById.get(holderId);
    if (
      holderId !== null &&
      (oldHolder === null || oldHolder === undefined || oldHolder.asset.type !== "character")
    ) {
      return unsafeStructuredFactIssue(
        context,
        `The persisted holder ${holderId} cannot be resolved to an active character.`
      );
    }
    const nextHolderId = transition.nextHolder?.asset.id ?? null;
    if (
      accumulator.claimedHolderIdByItemId.has(transition.item.asset.id) &&
      accumulator.claimedHolderIdByItemId.get(transition.item.asset.id) !== nextHolderId
    ) {
      accumulator.conflicted = true;
      return {
        kind: "issue",
        issue: createIssue(context, "conflict", {
          reason: "The same analysis run assigned incompatible holders to one item.",
          itemId: transition.item.asset.id,
          claimedHolderIds: [
            accumulator.claimedHolderIdByItemId.get(transition.item.asset.id) ?? null,
            nextHolderId
          ]
        })
      };
    }
    validated.push({ transition, oldHolder: oldHolder ?? null, nextHolderId });
  }

  for (const { transition, oldHolder, nextHolderId } of validated) {
    accumulator.claimedHolderIdByItemId.set(transition.item.asset.id, nextHolderId);
    if (oldHolder !== null) {
      accumulator.itemIdsByCharacterId.get(oldHolder.asset.id)?.delete(transition.item.asset.id);
      touchAccumulatedTarget(
        accumulator.touchedCharacters,
        oldHolder,
        context,
        input.extraDependencies
      );
    }
    if (transition.nextHolder !== null) {
      const heldItems = accumulator.itemIdsByCharacterId.get(transition.nextHolder.asset.id);
      if (heldItems === undefined) {
        return unsafeStructuredFactIssue(
          context,
          "The new item holder does not have a writable held-item projection."
        );
      }
      heldItems.add(transition.item.asset.id);
      touchAccumulatedTarget(
        accumulator.touchedCharacters,
        transition.nextHolder,
        context,
        input.extraDependencies
      );
    }
    accumulator.holderIdByItemId.set(transition.item.asset.id, nextHolderId);
    touchAccumulatedTarget(
      accumulator.touchedItems,
      transition.item,
      context,
      input.extraDependencies
    );
  }
  if (input.heldItemsOverride !== undefined) {
    touchAccumulatedTarget(
      accumulator.touchedCharacters,
      input.heldItemsOverride.character,
      context,
      input.extraDependencies
    );
  }
  return { kind: "deltas", deltas: [] };
}

function createHolderAccumulator(
  assets: readonly StoryAnalysisAssetRead[],
  assetsById: ReadonlyMap<string, StoryAnalysisAssetRead>
): HolderAccumulator {
  const holderIdByItemId = new Map<string, string | null>();
  const itemIdsByCharacterId = new Map<string, Set<string>>();
  for (const entry of assets) {
    if (entry.asset.type === "character") itemIdsByCharacterId.set(entry.asset.id, new Set());
  }
  for (const entry of assets) {
    if (entry.asset.type !== "world.item") continue;
    const persistedHolderId = entry.asset.details["holderId"];
    const holderId = typeof persistedHolderId === "string" ? persistedHolderId : null;
    holderIdByItemId.set(entry.asset.id, holderId);
    if (holderId !== null && assetsById.get(holderId)?.asset.type === "character") {
      itemIdsByCharacterId.get(holderId)?.add(entry.asset.id);
    }
  }
  return {
    assetsById,
    holderIdByItemId,
    itemIdsByCharacterId,
    claimedHolderIdByItemId: new Map(),
    touchedCharacters: new Map(),
    touchedItems: new Map(),
    conflicted: false
  };
}

function touchAccumulatedTarget(
  targets: Map<string, AccumulatedTarget>,
  target: StoryAnalysisAssetRead,
  context: RouteContext,
  dependencies: readonly StoryAnalysisDependency[]
): void {
  const current = targets.get(target.asset.id);
  if (current === undefined) {
    targets.set(target.asset.id, {
      target,
      contexts: [context],
      dependencies: [...dependencies]
    });
    return;
  }
  current.contexts.push(context);
  current.dependencies.push(...dependencies);
}

function materializeHolderDeltas(accumulator: HolderAccumulator): StoryFactDelta[] {
  if (accumulator.conflicted) return [];
  const deltas: StoryFactDelta[] = [];
  for (const plan of [...accumulator.touchedCharacters.values()].sort((left, right) =>
    compareText(left.target.asset.id, right.target.asset.id)
  )) {
    const context = plan.contexts[0];
    if (context === undefined) continue;
    const outcome = patchStateFields(context, plan.target, {
      stateFields: [
        [
          "/details/currentState/heldItemIds",
          [...(accumulator.itemIdsByCharacterId.get(plan.target.asset.id) ?? [])].sort(compareText)
        ]
      ],
      extraDependencies: deduplicateDependencies(plan.dependencies)
    });
    if (outcome.kind === "deltas" && outcome.deltas[0] !== undefined) {
      deltas.push(mergeDeltaContexts(outcome.deltas[0], plan.contexts));
    }
  }
  for (const plan of [...accumulator.touchedItems.values()].sort((left, right) =>
    compareText(left.target.asset.id, right.target.asset.id)
  )) {
    const context = plan.contexts[0];
    if (context === undefined) continue;
    const outcome = patchStateFields(context, plan.target, {
      stateFields: [
        ["/details/holderId", accumulator.holderIdByItemId.get(plan.target.asset.id) ?? null]
      ],
      extraDependencies: deduplicateDependencies(plan.dependencies)
    });
    if (outcome.kind === "deltas" && outcome.deltas[0] !== undefined) {
      deltas.push(mergeDeltaContexts(outcome.deltas[0], plan.contexts));
    }
  }
  return deltas;
}

function mergeDeltaContexts(
  delta: StoryFactDelta,
  contexts: readonly RouteContext[]
): StoryFactDelta {
  const uniqueContexts = deduplicateRouteContexts(contexts);
  return {
    ...delta,
    observationIds: uniqueContexts.map((entry) => entry.observation.observationId),
    evidence: deduplicateEvidence(uniqueContexts.flatMap((entry) => entry.observation.evidence)),
    confidence: Math.max(...uniqueContexts.map((entry) => entry.observation.confidence))
  };
}

function createRelationshipAccumulator(
  input: MaterializeStoryObserverInput,
  assetsById: ReadonlyMap<string, StoryAnalysisAssetRead>
): RelationshipAccumulator {
  return {
    chapterChecksum: input.chapter.checksum,
    assetsById,
    projectionsByOwnerId: new Map(),
    unitsByKey: new Map(),
    claimedStatusByUnitKey: new Map()
  };
}

function routeCharacterRelationship(
  context: RouteContext,
  subject: StoryAnalysisAssetRead
): RouteOutcome | undefined {
  if (subject.asset.type !== "character" || !isRecord(context.raw.fact.value)) return undefined;
  const value = context.raw.fact.value;
  if (
    !hasOnlyKeys(value, ["targetMention", "relationType", "direction", "status", "note"]) ||
    typeof value["targetMention"] !== "string" ||
    typeof value["relationType"] !== "string" ||
    !/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u.test(value["relationType"]) ||
    (value["direction"] !== undefined &&
      value["direction"] !== "directed" &&
      value["direction"] !== "symmetric") ||
    (value["status"] !== undefined &&
      value["status"] !== "active" &&
      value["status"] !== "ended" &&
      value["status"] !== "uncertain") ||
    (value["note"] !== undefined && typeof value["note"] !== "string")
  ) {
    return undefined;
  }
  const target = resolveEntity(
    value["targetMention"],
    "character",
    context.input.assets,
    context.input.indexRevision
  );
  if (target.resolved === null) return unresolvedRelatedEntity(context, target);
  const direction = value["direction"] === "symmetric" ? "symmetric" : "directed";
  const [owner, counterpart] =
    direction === "symmetric" && compareText(subject.asset.id, target.resolved.asset.id) > 0
      ? [target.resolved, subject]
      : [subject, target.resolved];
  if (direction === "symmetric" && owner.asset.id === counterpart.asset.id) {
    return unsafeStructuredFactIssue(context, "A symmetric relationship requires two endpoints.");
  }

  const semanticKey = relationshipSemanticKey({
    direction,
    sourceId: owner.asset.id,
    targetId: counterpart.asset.id,
    relationType: value["relationType"]
  });
  const existingTrack = findRelationshipTrack(context.relationships, owner, semanticKey);
  const existing = existingTrack?.currentRelation;
  const nextStatus =
    value["status"] === "ended" || value["status"] === "uncertain" ? value["status"] : "active";
  let relationshipUnitKey = semanticKey;
  let inverseTrack: RelationshipTrack | undefined;

  if (direction === "directed" && existing?.["inversePolicy"] === "explicit") {
    const relationId = existing["relationId"];
    const inverseRelationId = existing["inverseRelationId"];
    if (typeof relationId !== "string" || typeof inverseRelationId !== "string") {
      return unsafeStructuredFactIssue(
        context,
        "The explicit relationship does not identify a reciprocal relation."
      );
    }

    const inverseOccurrences = findRelationshipTracksByRelationId(
      context.relationships,
      inverseRelationId
    );
    const inverseOccurrence = inverseOccurrences.length === 1 ? inverseOccurrences[0] : undefined;
    const inverse = inverseOccurrence?.track.currentRelation;
    if (
      inverseOccurrence === undefined ||
      inverse === undefined ||
      inverseOccurrence.owner.asset.id !== inverse["sourceId"] ||
      inverse["direction"] !== "directed" ||
      inverse["inversePolicy"] !== "explicit" ||
      inverse["inverseRelationId"] !== relationId ||
      inverse["sourceId"] !== counterpart.asset.id ||
      inverse["targetId"] !== owner.asset.id ||
      inverse["status"] !== existing["status"] ||
      inverse["validFromChapterId"] !== existing["validFromChapterId"] ||
      inverse["validToChapterId"] !== existing["validToChapterId"]
    ) {
      return unsafeStructuredFactIssue(
        context,
        "The explicit relationship inverse is missing or inconsistent."
      );
    }
    inverseTrack = inverseOccurrence.track;
    relationshipUnitKey = explicitRelationshipUnitKey(relationId, inverseRelationId);
  }

  const claimedStatus = context.relationships.claimedStatusByUnitKey.get(relationshipUnitKey);
  if (claimedStatus !== undefined && claimedStatus !== nextStatus) {
    markRelationshipUnitConflicted(context.relationships, relationshipUnitKey);
    return {
      kind: "issue",
      issue: createIssue(context, "conflict", {
        reason: "The same analysis run assigned incompatible statuses to one relationship.",
        sourceId: owner.asset.id,
        targetId: counterpart.asset.id,
        relationType: value["relationType"],
        statuses: [claimedStatus, nextStatus]
      })
    };
  }

  const nextValidFromChapterId =
    existing !== undefined &&
    (typeof existing["validFromChapterId"] === "string" || existing["validFromChapterId"] === null)
      ? existing["validFromChapterId"]
      : context.input.chapter.chapterId;
  const nextValidToChapterId = nextStatus === "ended" ? context.input.chapter.chapterId : null;
  const evidence = mergeRelationEvidence(
    existing?.["evidence"],
    context.observation.evidence.map((entry) => ({
      chapterId: context.input.chapter.chapterId,
      ...entry
    }))
  );
  const relation: JsonObject = {
    relationId:
      typeof existing?.["relationId"] === "string"
        ? existing["relationId"]
        : stableId(
            "rel",
            stableJson({
              direction,
              sourceId: owner.asset.id,
              targetId: counterpart.asset.id,
              relationType: value["relationType"]
            })
          ),
    sourceId: owner.asset.id,
    targetId: counterpart.asset.id,
    relationType: value["relationType"],
    direction,
    status: nextStatus,
    validFromChapterId: nextValidFromChapterId,
    validToChapterId: nextValidToChapterId,
    inversePolicy:
      direction === "symmetric"
        ? "derived"
        : existing?.["inversePolicy"] === "derived" || existing?.["inversePolicy"] === "explicit"
          ? existing["inversePolicy"]
          : "none",
    inverseRelationId:
      direction === "directed" && existing?.["inversePolicy"] === "explicit"
        ? (existing["inverseRelationId"] ?? null)
        : null,
    evidence,
    note:
      typeof value["note"] === "string"
        ? mergeRelationNote(existing?.["note"], value["note"])
        : typeof existing?.["note"] === "string"
          ? existing["note"]
          : ""
  };
  const track =
    existingTrack ?? createRelationshipTrack(context.relationships, owner, semanticKey, relation);
  track.currentRelation = relation;

  const dependencies = [context.resolution.dependency, target.dependency];
  if (inverseTrack !== undefined) {
    inverseTrack.currentRelation = {
      ...inverseTrack.currentRelation,
      status: nextStatus,
      validFromChapterId: nextValidFromChapterId,
      validToChapterId: nextValidToChapterId
    };
    registerRelationshipUnit(
      context.relationships,
      relationshipUnitKey,
      [track, inverseTrack],
      context,
      dependencies
    );
  } else {
    registerRelationshipUnit(
      context.relationships,
      relationshipUnitKey,
      [track],
      context,
      dependencies
    );
  }
  context.relationships.claimedStatusByUnitKey.set(relationshipUnitKey, nextStatus);
  return { kind: "deltas", deltas: [] };
}

function mergeRelationEvidence(existing: unknown, next: readonly JsonObject[]): JsonObject[] {
  const byValue = new Map<string, JsonObject>();
  for (const entry of [...objectArray(existing), ...next]) {
    byValue.set(stableJson(entry), structuredClone(entry));
  }
  return [...byValue.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([, entry]) => entry);
}

function mergeRelationNote(existing: unknown, next: string): string {
  const lines = [existing, next]
    .flatMap((value) => (typeof value === "string" ? value.split(/\r?\n/gu) : []))
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return [...new Set(lines)].join("\n");
}

function relationshipSemanticKey(input: {
  readonly direction: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly relationType: string;
}): string {
  return stableJson(input);
}

function relationshipSemanticKeyForRelation(relation: JsonObject): string {
  return stableJson({
    direction: relation["direction"],
    sourceId: relation["sourceId"],
    targetId: relation["targetId"],
    relationType: relation["relationType"]
  });
}

function explicitRelationshipUnitKey(relationId: string, inverseRelationId: string): string {
  return stableJson({
    kind: "explicit-inverse",
    relationIds: [relationId, inverseRelationId].sort(compareText)
  });
}

function relationshipProjection(
  accumulator: RelationshipAccumulator,
  owner: StoryAnalysisAssetRead
): RelationshipProjection {
  const current = accumulator.projectionsByOwnerId.get(owner.asset.id);
  if (current !== undefined) return current;
  const projection: RelationshipProjection = {
    owner,
    baseRelations: objectArray(owner.asset.relations),
    tracksByExistingIndex: new Map(),
    tracksBySemanticKey: new Map(),
    tracks: []
  };
  accumulator.projectionsByOwnerId.set(owner.asset.id, projection);
  return projection;
}

function findRelationshipTrack(
  accumulator: RelationshipAccumulator,
  owner: StoryAnalysisAssetRead,
  semanticKey: string
): RelationshipTrack | undefined {
  const projection = relationshipProjection(accumulator, owner);
  const tracked = projection.tracksBySemanticKey.get(semanticKey);
  if (tracked !== undefined) return tracked;
  const baseIndex = projection.baseRelations.findIndex(
    (relation) => relationshipSemanticKeyForRelation(relation) === semanticKey
  );
  return baseIndex === -1 ? undefined : relationshipTrackAtExistingIndex(projection, baseIndex);
}

function createRelationshipTrack(
  accumulator: RelationshipAccumulator,
  owner: StoryAnalysisAssetRead,
  semanticKey: string,
  relation: JsonObject
): RelationshipTrack {
  const projection = relationshipProjection(accumulator, owner);
  const tracked = projection.tracksBySemanticKey.get(semanticKey);
  if (tracked !== undefined) return tracked;
  const track: RelationshipTrack = {
    owner,
    semanticKey,
    baseIndex: null,
    currentRelation: structuredClone(relation),
    unitKey: null
  };
  projection.tracksBySemanticKey.set(semanticKey, track);
  projection.tracks.push(track);
  return track;
}

function relationshipTrackAtExistingIndex(
  projection: RelationshipProjection,
  index: number
): RelationshipTrack {
  const tracked = projection.tracksByExistingIndex.get(index);
  if (tracked !== undefined) return tracked;
  const baseRelation = projection.baseRelations[index];
  if (baseRelation === undefined) {
    throw new Error("The requested relationship baseline does not exist.");
  }
  const semanticKey = relationshipSemanticKeyForRelation(baseRelation);
  const bySemanticKey = projection.tracksBySemanticKey.get(semanticKey);
  if (bySemanticKey !== undefined) {
    projection.tracksByExistingIndex.set(index, bySemanticKey);
    return bySemanticKey;
  }
  const track: RelationshipTrack = {
    owner: projection.owner,
    semanticKey,
    baseIndex: index,
    currentRelation: structuredClone(baseRelation),
    unitKey: null
  };
  projection.tracksByExistingIndex.set(index, track);
  projection.tracksBySemanticKey.set(semanticKey, track);
  projection.tracks.push(track);
  return track;
}

function findRelationshipTracksByRelationId(
  accumulator: RelationshipAccumulator,
  relationId: string
): {
  readonly owner: StoryAnalysisAssetRead;
  readonly track: RelationshipTrack;
}[] {
  const matches: {
    readonly owner: StoryAnalysisAssetRead;
    readonly track: RelationshipTrack;
  }[] = [];
  const owners = [...accumulator.assetsById.values()].sort((left, right) =>
    compareText(left.asset.id, right.asset.id)
  );
  for (const owner of owners) {
    const projection = relationshipProjection(accumulator, owner);
    for (const [index, relation] of projection.baseRelations.entries()) {
      if (relation["relationId"] !== relationId) continue;
      matches.push({
        owner,
        track: relationshipTrackAtExistingIndex(projection, index)
      });
    }
  }
  return matches;
}

function relationshipUnit(accumulator: RelationshipAccumulator, unitKey: string): RelationshipUnit {
  const existing = accumulator.unitsByKey.get(unitKey);
  if (existing !== undefined) return existing;
  const unit: RelationshipUnit = {
    key: unitKey,
    tracks: new Set(),
    contexts: [],
    dependencies: [],
    conflicted: false
  };
  accumulator.unitsByKey.set(unitKey, unit);
  return unit;
}

function registerRelationshipUnit(
  accumulator: RelationshipAccumulator,
  unitKey: string,
  tracks: readonly RelationshipTrack[],
  context: RouteContext,
  dependencies: readonly StoryAnalysisDependency[]
): void {
  const unit = relationshipUnit(accumulator, unitKey);
  for (const track of tracks) {
    if (track.unitKey !== null && track.unitKey !== unitKey) {
      throw new Error("A relationship track cannot belong to multiple semantic units.");
    }
    track.unitKey = unitKey;
    unit.tracks.add(track);
  }
  unit.contexts.push(context);
  unit.dependencies.push(...dependencies);
}

function markRelationshipUnitConflicted(
  accumulator: RelationshipAccumulator,
  unitKey: string
): void {
  relationshipUnit(accumulator, unitKey).conflicted = true;
}

function materializeRelationshipDeltas(accumulator: RelationshipAccumulator): StoryFactDelta[] {
  const activeUnits = new Map(
    [...accumulator.unitsByKey].filter(([, unit]) => !unit.conflicted && unit.tracks.size > 0)
  );
  if (activeUnits.size === 0) return [];

  const groupIdByUnitKey = relationshipGroupIds(accumulator, activeUnits);
  const deltas: StoryFactDelta[] = [];
  const projections = [...accumulator.projectionsByOwnerId.values()].sort((left, right) =>
    compareText(left.owner.asset.id, right.owner.asset.id)
  );
  for (const projection of projections) {
    const unitsByKey = new Map<string, RelationshipUnit>();
    for (const track of projection.tracks) {
      if (track.unitKey === null) continue;
      const unit = activeUnits.get(track.unitKey);
      if (unit !== undefined) unitsByKey.set(track.unitKey, unit);
    }
    if (unitsByKey.size === 0) continue;

    const groupIds = new Set(
      [...unitsByKey.keys()].flatMap((unitKey) => {
        const groupId = groupIdByUnitKey.get(unitKey);
        return groupId === undefined ? [] : [groupId];
      })
    );
    if (groupIds.size !== 1) continue;
    const groupId = groupIds.values().next().value;
    if (groupId === undefined) continue;

    const contexts = deduplicateRouteContexts(
      [...unitsByKey.values()].flatMap((unit) => unit.contexts)
    );
    const context = contexts[0];
    if (context === undefined) continue;
    const nextRelations = materializeRelationshipProjection(projection, activeUnits);
    if (stableJson(nextRelations) === stableJson(projection.baseRelations)) continue;

    const routed = patchFields(context, projection.owner, {
      fields: [["/relations", nextRelations]],
      extraDependencies: deduplicateDependencies(
        [...unitsByKey.values()].flatMap((unit) => unit.dependencies)
      ),
      consistencyGroupId: groupId
    });
    if (routed.kind === "deltas" && routed.deltas[0] !== undefined) {
      deltas.push(mergeDeltaContexts(routed.deltas[0], contexts));
    }
  }
  return deltas;
}

function relationshipGroupIds(
  accumulator: RelationshipAccumulator,
  activeUnits: ReadonlyMap<string, RelationshipUnit>
): ReadonlyMap<string, string> {
  const unitKeysByOwnerId = new Map<string, Set<string>>();
  for (const [unitKey, unit] of activeUnits) {
    for (const track of unit.tracks) {
      const current = unitKeysByOwnerId.get(track.owner.asset.id) ?? new Set<string>();
      current.add(unitKey);
      unitKeysByOwnerId.set(track.owner.asset.id, current);
    }
  }

  const groupIdByUnitKey = new Map<string, string>();
  for (const seed of [...activeUnits.keys()].sort(compareText)) {
    if (groupIdByUnitKey.has(seed)) continue;
    const component = new Set<string>();
    const pending = [seed];
    while (pending.length > 0) {
      const currentKey = pending.pop();
      if (currentKey === undefined || component.has(currentKey)) continue;
      const unit = activeUnits.get(currentKey);
      if (unit === undefined) continue;
      component.add(currentKey);
      for (const track of unit.tracks) {
        for (const relatedKey of unitKeysByOwnerId.get(track.owner.asset.id) ?? []) {
          if (!component.has(relatedKey)) pending.push(relatedKey);
        }
      }
    }
    const unitKeys = [...component].sort(compareText);
    const groupId = stableId(
      "cgrp",
      stableJson({
        chapterChecksum: accumulator.chapterChecksum,
        scope: "relationship-component",
        unitKeys
      })
    );
    for (const unitKey of unitKeys) groupIdByUnitKey.set(unitKey, groupId);
  }
  return groupIdByUnitKey;
}

function materializeRelationshipProjection(
  projection: RelationshipProjection,
  activeUnits: ReadonlyMap<string, RelationshipUnit>
): JsonObject[] {
  const relations = projection.baseRelations.map((relation) => structuredClone(relation));
  for (const track of projection.tracks) {
    if (track.unitKey === null || !activeUnits.has(track.unitKey)) continue;
    if (track.baseIndex === null) {
      relations.push(structuredClone(track.currentRelation));
    } else {
      relations[track.baseIndex] = structuredClone(track.currentRelation);
    }
  }
  return relations;
}

function routeCharacterState(
  context: RouteContext,
  subject: StoryAnalysisAssetRead,
  field: "emotional" | "physical"
): RouteOutcome | undefined {
  if (subject.asset.type !== "character" || !isRecord(context.raw.fact.value)) return undefined;
  const value = context.raw.fact.value;
  if (!hasExactKeys(value, ["state"]) || typeof value["state"] !== "string") return undefined;
  return patchStateFields(context, subject, {
    stateFields: [[`/details/currentState/${field}`, value["state"]]],
    extraDependencies: [context.resolution.dependency]
  });
}

function routeCharacterKnowledge(
  context: RouteContext,
  subject: StoryAnalysisAssetRead
): RouteOutcome | undefined {
  if (subject.asset.type !== "character" || !isRecord(context.raw.fact.value)) return undefined;
  const value = context.raw.fact.value;
  const states = new Set(["known", "believed", "suspected", "misunderstood", "forgotten"]);
  if (
    !hasOnlyKeys(value, ["subject", "state", "note"]) ||
    typeof value["subject"] !== "string" ||
    value["subject"].trim().length === 0 ||
    typeof value["state"] !== "string" ||
    !states.has(value["state"]) ||
    (value["note"] !== undefined && typeof value["note"] !== "string")
  ) {
    return undefined;
  }
  const current = objectArray(subject.asset.details["knowledgeStates"]);
  const knowledge: JsonObject = {
    knowledgeStateId: stableId(
      "knw",
      `${subject.asset.id}:${value["subject"]}:${context.input.chapter.checksum}`
    ),
    entryRevision: 1,
    subject: value["subject"].trim(),
    state: value["state"],
    sourceChapterId: context.input.chapter.chapterId,
    validFromChapterId: context.input.chapter.chapterId,
    validToChapterId: null,
    note: typeof value["note"] === "string" ? value["note"] : ""
  };
  return patchFields(context, subject, {
    fields: [["/details/knowledgeStates", [...current, knowledge]]],
    extraDependencies: [context.resolution.dependency]
  });
}

function routeForeshadow(
  context: RouteContext,
  subject: StoryAnalysisAssetRead
): RouteOutcome | undefined {
  if (subject.asset.type !== "foreshadow" || !isRecord(context.raw.fact.value)) return undefined;
  const value = context.raw.fact.value;
  const kinds = new Set(["plan", "plant", "progress", "payoff"]);
  if (
    !hasOnlyKeys(value, ["kind", "note"]) ||
    typeof value["kind"] !== "string" ||
    !kinds.has(value["kind"]) ||
    (value["note"] !== undefined && typeof value["note"] !== "string")
  ) {
    return undefined;
  }
  const current = objectArray(subject.asset.details["milestones"]);
  const evidence = context.observation.evidence[0];
  if (evidence === undefined) return undefined;
  const milestone: JsonObject = {
    milestoneId: stableId(
      "fsm",
      `${subject.asset.id}:${value["kind"]}:${context.input.chapter.checksum}:${stableJson(context.observation.evidence)}`
    ),
    entryRevision: 1,
    kind: value["kind"],
    chapterId: context.input.chapter.chapterId,
    timelineEventId: null,
    evidence: {
      start: evidence.start,
      end: evidence.end,
      excerptHash: evidence.excerptHash
    },
    note: typeof value["note"] === "string" ? value["note"] : ""
  };
  const statusByKind: Readonly<Record<string, string>> = {
    plan: "planned",
    plant: "planted",
    progress: "progressing",
    payoff: "paid-off"
  };
  const trackingStatus = statusByKind[value["kind"]];
  if (trackingStatus === undefined) return undefined;
  return patchFields(context, subject, {
    fields: [
      ["/details/milestones", [...current, milestone]],
      ["/details/trackingStatus", trackingStatus]
    ],
    extraDependencies: [context.resolution.dependency]
  });
}

function routeTimelineEvent(
  context: RouteContext,
  behaviorSubject?: StoryAnalysisAssetRead
): RouteOutcome | undefined {
  if (!isRecord(context.raw.fact.value)) return undefined;
  const value = context.raw.fact.value;
  if (
    !hasOnlyKeys(value, ["title", "summary", "timeLabel"]) ||
    typeof value["title"] !== "string" ||
    value["title"].trim().length === 0 ||
    typeof value["summary"] !== "string" ||
    (value["timeLabel"] !== undefined && typeof value["timeLabel"] !== "string")
  ) {
    return undefined;
  }
  const timeline = context.timeline.timeline;
  if (timeline === undefined) return undefined;
  const current = objectArray(timeline.asset.details["events"]);
  const sequence =
    current.reduce(
      (maximum, event) =>
        Number.isSafeInteger(event["sequence"])
          ? Math.max(maximum, Number(event["sequence"]))
          : maximum,
      0
    ) + 1;
  const event: JsonObject = {
    eventId: stableId(
      "evt",
      `${value["title"]}:${context.input.chapter.checksum}:${behaviorSubject?.asset.id ?? "timeline"}`
    ),
    entryRevision: 1,
    title: value["title"].trim(),
    sequence,
    time: {
      mode: value["timeLabel"] === undefined ? "sequence-only" : "relative",
      label: typeof value["timeLabel"] === "string" ? value["timeLabel"] : "",
      anchorEventId: null,
      offset: null,
      uncertain: context.raw.epistemicStatus !== "narrator_asserted"
    },
    duration: null,
    summary: value["summary"],
    chapterIds: [context.input.chapter.chapterId],
    characterIds: behaviorSubject?.asset.type === "character" ? [behaviorSubject.asset.id] : [],
    locationIds: [],
    parallelEventIds: [],
    causes: [],
    effects: [],
    stateChanges: []
  };
  context.timeline.contributions.push({ context, event });
  return { kind: "deltas", deltas: [] };
}

function routeOutlineResult(
  context: RouteContext,
  subject: StoryAnalysisAssetRead,
  kind: "outline_actual_outcome" | "outline_deviation"
): RouteOutcome | undefined {
  const outline =
    subject.asset.type === "outline"
      ? subject
      : [...context.assetsById.values()].find((entry) => entry.asset.type === "outline");
  if (outline === undefined || !isRecord(context.raw.fact.value)) return undefined;
  const value = context.raw.fact.value;
  if (!hasExactKeys(value, ["text"]) || typeof value["text"] !== "string") return undefined;
  const chapterOutlines = objectArray(outline.asset.details["chapterOutlines"]);
  const chapterOutline = chapterOutlines.find(
    (entry) => entry["chapterId"] === context.input.chapter.chapterId
  );
  if (
    chapterOutline === undefined ||
    typeof chapterOutline["chapterOutlineId"] !== "string" ||
    !Number.isSafeInteger(chapterOutline["entryRevision"])
  ) {
    return undefined;
  }
  const operations: StoryAnalysisPatchOperation[] = [];
  if (kind === "outline_actual_outcome") {
    operations.push(operationFor(chapterOutline, "/actualOutcome", value["text"]));
  } else {
    const deviations = stringArray(chapterOutline["deviations"]);
    operations.push(operationFor(chapterOutline, "/deviations", [...deviations, value["text"]]));
  }
  const selectors = ["/details/chapterOutlines"];
  const delta = createDelta(context, {
    action: "patch",
    target: {
      assetId: outline.asset.id,
      baseRevision: outline.asset.revision,
      entryRef: {
        collection: "chapterOutlines",
        entryId: chapterOutline["chapterOutlineId"],
        baseEntryRevision: Number(chapterOutline["entryRevision"])
      }
    },
    proposedAssetType: null,
    proposedAssetId: null,
    createValue: null,
    operations,
    dependencies: [
      assetFieldsDependency(outline, selectors),
      context.resolution.dependency,
      chapterDependency(context.input)
    ]
  });
  return { kind: "deltas", deltas: [delta] };
}

function routeWorldItem(
  context: RouteContext,
  subject: StoryAnalysisAssetRead,
  kind: "world_item_holder" | "world_item_location" | "world_item_state"
): RouteOutcome | undefined {
  if (subject.asset.type !== "world.item" || !isRecord(context.raw.fact.value)) return undefined;
  const value = context.raw.fact.value;
  const dependencies: StoryAnalysisDependency[] = [context.resolution.dependency];
  if (kind === "world_item_holder") {
    if (!hasExactKeys(value, ["holderMention"])) return undefined;
    let nextHolder: StoryAnalysisAssetRead | null = null;
    if (value["holderMention"] !== null) {
      if (typeof value["holderMention"] !== "string") return undefined;
      const holder = resolveEntity(
        value["holderMention"],
        "character",
        context.input.assets,
        context.input.indexRevision
      );
      if (holder.resolved === null) return unresolvedRelatedEntity(context, holder);
      nextHolder = holder.resolved;
      dependencies.push(holder.dependency);
    }
    return synchronizeItemHolders(context, {
      transitions: [{ item: subject, nextHolder }],
      extraDependencies: dependencies
    });
  }
  let path: string;
  let nextValue: JsonValue;
  if (kind === "world_item_state") {
    if (!hasExactKeys(value, ["state"]) || typeof value["state"] !== "string") return undefined;
    path = "/details/state";
    nextValue = value["state"];
  } else {
    const key = "locationMention";
    const expectedType = "world.location";
    if (!hasExactKeys(value, [key])) return undefined;
    if (value[key] === null) {
      nextValue = null;
    } else {
      if (typeof value[key] !== "string") return undefined;
      const related = resolveEntity(
        value[key],
        expectedType,
        context.input.assets,
        context.input.indexRevision
      );
      if (related.resolved === null) return unresolvedRelatedEntity(context, related);
      dependencies.push(related.dependency);
      nextValue = related.resolved.asset.id;
    }
    path = "/details/currentLocationId";
  }
  return patchStateFields(context, subject, {
    stateFields: [[path, nextValue]],
    extraDependencies: dependencies
  });
}

function patchStateFields(
  context: RouteContext,
  target: StoryAnalysisAssetRead,
  input: {
    readonly stateFields: readonly (readonly [string, JsonValue])[];
    readonly extraDependencies: readonly StoryAnalysisDependency[];
  }
): RouteOutcome {
  if (context.timeline.timeline === undefined) {
    return unsafeStructuredFactIssue(
      context,
      "A timeline singleton is required before state history can reference an event."
    );
  }

  const stateHistory = objectArray(target.asset.details["stateHistory"]);
  const stateHistoryId = stableId("sth", `${target.asset.id}:${context.timeline.stateEventId}`);
  const hasHistory = stateHistory.some((entry) => entry["stateHistoryId"] === stateHistoryId);
  const nextHistory: JsonObject[] = hasHistory
    ? stateHistory
    : [
        ...stateHistory,
        {
          stateHistoryId,
          entryRevision: 1,
          timelineEventId: context.timeline.stateEventId,
          chapterId: context.input.chapter.chapterId,
          note: "Confirmed state changes are recorded in the linked timeline event."
        }
      ];

  for (const [path, value] of input.stateFields) {
    context.timeline.contributions.push({
      context,
      stateChange: {
        subjectId: target.asset.id,
        path,
        before: structuredClone(readPointer(target.asset, path) ?? null),
        after: structuredClone(value),
        note: context.raw.reason
      }
    });
  }
  const isCharacter = target.asset.type === "character";
  return patchFields(context, target, {
    fields: [
      ...input.stateFields,
      [
        isCharacter ? "/details/currentState/asOfChapterId" : "/details/asOfChapterId",
        context.input.chapter.chapterId
      ],
      [
        isCharacter ? "/details/currentState/asOfEventId" : "/details/asOfEventId",
        context.timeline.stateEventId
      ],
      ["/details/stateHistory", nextHistory]
    ],
    extraDependencies: input.extraDependencies,
    consistencyGroupId: context.timeline.consistencyGroupId
  });
}

function createTimelineAccumulator(
  input: MaterializeStoryObserverInput,
  assets: readonly StoryAnalysisAssetRead[]
): TimelineAccumulator {
  const stateEventId = stableId("evt", `chapter-state:${input.chapter.checksum}`);
  return {
    timeline: assets.find((entry) => entry.asset.type === "timeline.events"),
    consistencyGroupId: stableId("cgrp", `chapter-timeline:${input.chapter.checksum}`),
    stateEventId,
    contributions: []
  };
}

function materializeTimelineDelta(accumulator: TimelineAccumulator): StoryFactDelta | undefined {
  const timeline = accumulator.timeline;
  if (timeline === undefined) return undefined;

  const current = objectArray(timeline.asset.details["events"]);
  const existingEventIds = new Set(
    current.flatMap((event) => (typeof event["eventId"] === "string" ? [event["eventId"]] : []))
  );
  const maximumSequence = current.reduce(
    (maximum, event) =>
      Number.isSafeInteger(event["sequence"])
        ? Math.max(maximum, Number(event["sequence"]))
        : maximum,
    0
  );
  const nextEvents: JsonObject[] = [];
  const contexts: RouteContext[] = [];
  for (const contribution of accumulator.contributions) {
    const eventId = contribution.event?.["eventId"];
    if (
      contribution.event === undefined ||
      typeof eventId !== "string" ||
      existingEventIds.has(eventId)
    ) {
      continue;
    }
    existingEventIds.add(eventId);
    nextEvents.push({
      ...structuredClone(contribution.event),
      sequence: maximumSequence + nextEvents.length + 1
    });
    contexts.push(contribution.context);
  }

  const stateContributions = stableStateContributions(accumulator.contributions);
  if (stateContributions.length > 0 && !existingEventIds.has(accumulator.stateEventId)) {
    nextEvents.push({
      eventId: accumulator.stateEventId,
      entryRevision: 1,
      title: "Chapter state changes",
      sequence: maximumSequence + nextEvents.length + 1,
      time: {
        mode: "sequence-only",
        label: "",
        anchorEventId: null,
        offset: null,
        uncertain: false
      },
      duration: null,
      summary: "Confirmed character and item state changes from chapter analysis.",
      chapterIds: [stateContributions[0]?.context.input.chapter.chapterId ?? ""],
      characterIds: [
        ...new Set(
          stateContributions.flatMap((entry) => {
            const subjectId = entry.stateChange?.["subjectId"];
            return typeof subjectId === "string" &&
              entry.context.assetsById.get(subjectId)?.asset.type === "character"
              ? [subjectId]
              : [];
          })
        )
      ].sort(compareText),
      locationIds: [],
      parallelEventIds: [],
      causes: [],
      effects: [],
      stateChanges: stateContributions.flatMap((entry) =>
        entry.stateChange === undefined ? [] : [structuredClone(entry.stateChange)]
      )
    });
    contexts.push(...stateContributions.map((entry) => entry.context));
  }

  if (nextEvents.length === 0 || contexts.length === 0) return undefined;
  const uniqueContexts = deduplicateRouteContexts(contexts);
  const first = uniqueContexts[0];
  if (first === undefined) return undefined;
  const evidence = deduplicateEvidence(
    uniqueContexts.flatMap((entry) => entry.observation.evidence)
  );
  const confidence = Math.min(...uniqueContexts.map((entry) => entry.observation.confidence));
  const reason = `Materialize ${nextEvents.length} deterministic timeline event(s) for this chapter.`;
  const timelineContext: RouteContext = {
    ...first,
    observation: {
      ...first.observation,
      domain: "timeline",
      evidence,
      epistemicStatus: "narrator_asserted",
      confidence,
      reason
    },
    raw: {
      ...first.raw,
      domain: "timeline",
      epistemicStatus: "narrator_asserted",
      confidence,
      reason
    }
  };
  const routed = patchFields(timelineContext, timeline, {
    fields: [["/details/events", [...current, ...nextEvents]]],
    extraDependencies: uniqueContexts.map((entry) => entry.resolution.dependency),
    consistencyGroupId: accumulator.consistencyGroupId
  });
  if (routed.kind !== "deltas") return undefined;
  const delta = routed.deltas[0];
  return delta === undefined
    ? undefined
    : {
        ...delta,
        observationIds: uniqueContexts.map((entry) => entry.observation.observationId),
        evidence,
        epistemicStatus: "narrator_asserted",
        confidence,
        reason
      };
}

function stableStateContributions(
  contributions: readonly TimelineContribution[]
): readonly TimelineContribution[] {
  const byField = new Map<string, TimelineContribution[]>();
  for (const contribution of contributions) {
    const subjectId = contribution.stateChange?.["subjectId"];
    const path = contribution.stateChange?.["path"];
    if (typeof subjectId !== "string" || typeof path !== "string") continue;
    const key = `${subjectId}:${path}`;
    const entries = byField.get(key) ?? [];
    entries.push(contribution);
    byField.set(key, entries);
  }
  return [...byField.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .flatMap(([, entries]) => {
      const byValue = new Map<string, TimelineContribution>();
      for (const entry of entries) {
        byValue.set(stableJson(entry.stateChange?.["after"]), entry);
      }
      return byValue.size === 1 ? [[...byValue.values()][0] as TimelineContribution] : [];
    });
}

function deduplicateRouteContexts(contexts: readonly RouteContext[]): RouteContext[] {
  const byObservation = new Map<string, RouteContext>();
  for (const context of contexts) {
    byObservation.set(context.observation.observationId, context);
  }
  return [...byObservation.values()];
}

function patchFields(
  context: RouteContext,
  target: StoryAnalysisAssetRead,
  input: {
    readonly fields: readonly (readonly [string, JsonValue])[];
    readonly extraDependencies: readonly StoryAnalysisDependency[];
    readonly consistencyGroupId?: string;
  }
): RouteOutcome {
  const operations = input.fields.map(([path, value]) => operationFor(target.asset, path, value));
  const selectors = input.fields.map(([path]) => path);
  const delta = createDelta(context, {
    action: "patch",
    target: { assetId: target.asset.id, baseRevision: target.asset.revision, entryRef: null },
    proposedAssetType: null,
    proposedAssetId: null,
    createValue: null,
    operations,
    dependencies: [
      assetFieldsDependency(target, selectors),
      ...input.extraDependencies,
      chapterDependency(context.input)
    ],
    ...(input.consistencyGroupId === undefined
      ? {}
      : { consistencyGroupId: input.consistencyGroupId })
  });
  return { kind: "deltas", deltas: [delta] };
}

function createDelta(
  context: RouteContext,
  value: Omit<
    StoryFactDelta,
    | "schemaVersion"
    | "deltaId"
    | "analysisRunId"
    | "observationIds"
    | "chapter"
    | "domain"
    | "consistencyGroupId"
    | "evidence"
    | "epistemicStatus"
    | "confidence"
    | "reason"
    | "idempotencyKey"
  > & { readonly consistencyGroupId?: string }
): StoryFactDelta {
  const semantic = stableJson({
    chapterChecksum: context.input.chapter.checksum,
    promptVersion: context.input.promptVersion,
    extractorVersion: context.input.extractorVersion,
    domain: context.raw.domain,
    action: value.action,
    target: value.target,
    proposedAssetType: value.proposedAssetType,
    proposedAssetId: value.proposedAssetId,
    createValue: value.createValue,
    operations: value.operations
  });
  const idempotencyKey = checksumText(semantic);
  return {
    schemaVersion: "1.1",
    deltaId: stableId("dlt", `${context.input.analysisRunId}:${idempotencyKey}`),
    analysisRunId: context.input.analysisRunId,
    observationIds: [context.observation.observationId],
    chapter: context.observation.chapter,
    domain: context.observation.domain,
    action: value.action,
    target: value.target,
    proposedAssetType: value.proposedAssetType,
    proposedAssetId: value.proposedAssetId,
    createValue: value.createValue,
    dependencies: deduplicateDependencies(value.dependencies),
    consistencyGroupId: value.consistencyGroupId ?? stableId("cgrp", idempotencyKey),
    operations: value.operations,
    evidence: context.observation.evidence,
    epistemicStatus: context.observation.epistemicStatus,
    confidence: context.observation.confidence,
    reason: context.observation.reason,
    idempotencyKey
  };
}

function createIssue(
  context: RouteContext,
  issueType: StoryReviewIssue["issueType"],
  claim: JsonValue
): StoryReviewIssue {
  const dependencies = deduplicateDependencies([
    context.resolution.dependency,
    chapterDependency(context.input)
  ]);
  const idempotencyKey = checksumText(
    stableJson({
      chapterChecksum: context.input.chapter.checksum,
      promptVersion: context.input.promptVersion,
      extractorVersion: context.input.extractorVersion,
      issueType,
      subject: context.observation.subject,
      claim
    })
  );
  return {
    schemaVersion: "1.1",
    issueId: stableId("issue", idempotencyKey),
    recordType: "review_issue",
    revision: 1,
    createdAt: context.input.createdAt,
    updatedAt: context.input.createdAt,
    analysisRunId: context.input.analysisRunId,
    chapter: context.observation.chapter,
    issueType,
    status: "open",
    claims: [{ value: claim, evidence: context.observation.evidence }],
    affectedRefs:
      context.observation.subject.resolvedAssetId === null
        ? []
        : [`story_bible:${context.observation.subject.resolvedAssetId}`],
    dependencies,
    idempotencyKey,
    resolution: null,
    dismissalReason: null,
    supersededByIssueId: null
  };
}

function createOverdueForeshadowIssues(
  input: MaterializeStoryObserverInput,
  assets: readonly StoryAnalysisAssetRead[]
): readonly StoryReviewIssue[] {
  const bodyLength = Array.from(input.chapter.body).length;
  if (bodyLength === 0) return [];
  const outline = assets.find((entry) => entry.asset.type === "outline");
  if (outline === undefined) return [];

  const evidence: StoryEvidenceRange[] = [
    { start: 0, end: bodyLength, excerptHash: checksumText(input.chapter.body) }
  ];
  const issues: StoryReviewIssue[] = [];
  for (const foreshadow of assets
    .filter((entry) => entry.asset.type === "foreshadow")
    .slice()
    .sort((left, right) => compareText(left.asset.id, right.asset.id))) {
    const trackingStatus = foreshadow.asset.details["trackingStatus"];
    const plannedPayoffChapterId = foreshadow.asset.details["plannedPayoffChapterId"];
    if (
      (trackingStatus !== "planted" &&
        trackingStatus !== "progressing" &&
        trackingStatus !== "ready-to-payoff") ||
      typeof plannedPayoffChapterId !== "string"
    ) {
      continue;
    }
    const chapterOrder = resolveChapterOrder(
      outline.asset.details,
      input.chapter.chapterId,
      plannedPayoffChapterId
    );
    if (chapterOrder === undefined) continue;
    const currentOrder = chapterOrder.get(input.chapter.chapterId);
    const payoffOrder = chapterOrder.get(plannedPayoffChapterId);
    if (currentOrder === undefined || payoffOrder === undefined || currentOrder <= payoffOrder) {
      continue;
    }

    const claim: JsonObject = {
      foreshadowId: foreshadow.asset.id,
      title: foreshadow.asset.title,
      trackingStatus,
      plannedPayoffChapterId,
      currentChapterId: input.chapter.chapterId
    };
    const dependencies = deduplicateDependencies([
      assetFieldsDependency(foreshadow, [
        "/details/trackingStatus",
        "/details/plannedPayoffChapterId"
      ]),
      assetFieldsDependency(outline, ["/details/volumes", "/details/chapterOutlines"]),
      chapterDependency(input)
    ]);
    const idempotencyKey = checksumText(
      stableJson({
        chapterChecksum: input.chapter.checksum,
        promptVersion: input.promptVersion,
        extractorVersion: input.extractorVersion,
        issueType: "overdue_foreshadow",
        claim
      })
    );
    issues.push({
      schemaVersion: "1.1",
      issueId: stableId("issue", idempotencyKey),
      recordType: "review_issue",
      revision: 1,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
      analysisRunId: input.analysisRunId,
      chapter: { chapterId: input.chapter.chapterId, checksum: input.chapter.checksum },
      issueType: "overdue_foreshadow",
      status: "open",
      claims: [{ value: claim, evidence }],
      affectedRefs: [`story_bible:${foreshadow.asset.id}`],
      dependencies,
      idempotencyKey,
      resolution: null,
      dismissalReason: null,
      supersededByIssueId: null
    });
  }
  return issues;
}

function resolveChapterOrder(
  details: JsonObject,
  currentChapterId: string,
  plannedPayoffChapterId: string
): ReadonlyMap<string, number> | undefined {
  const chapterOutlineOrder = objectArray(details["chapterOutlines"]).flatMap((entry) =>
    typeof entry["chapterId"] === "string" ? [entry["chapterId"]] : []
  );
  const volumeOrder = objectArray(details["volumes"]).flatMap((entry) =>
    stringArray(entry["chapterIds"])
  );
  const ordered = [volumeOrder, chapterOutlineOrder].find(
    (candidate) =>
      candidate.includes(currentChapterId) && candidate.includes(plannedPayoffChapterId)
  );
  if (ordered === undefined) return undefined;
  return new Map(ordered.map((chapterId, index) => [chapterId, index]));
}

function unsafeStructuredFactIssue(context: RouteContext, reason: string): RouteOutcome {
  return {
    kind: "issue",
    issue: createIssue(context, "ambiguity", { reason, fact: context.raw.fact })
  };
}

function unresolvedRelatedEntity(
  context: RouteContext,
  resolution: EntityResolution
): RouteOutcome {
  return {
    kind: "issue",
    issue: createIssue(
      context,
      resolution.candidates.length > 1 ? "ambiguity" : "unresolved_entity",
      {
        mention: resolution.mention,
        expectedType: resolution.expectedType,
        candidateAssetIds: resolution.candidates.map((entry) => entry.asset.id)
      }
    )
  };
}

function resolveEntity(
  mention: string,
  expectedType: StoryBibleV11AssetType | null,
  assets: readonly StoryAnalysisAssetRead[],
  indexRevision: string
): EntityResolution {
  const normalizedMention = normalizeEntityName(mention);
  const candidates = assets
    .filter(
      (entry) =>
        entry.asset.status !== "deleted" &&
        (expectedType === null || entry.asset.type === expectedType) &&
        [entry.asset.title, ...entry.asset.aliases].some(
          (name) => normalizeEntityName(name) === normalizedMention
        )
    )
    .slice()
    .sort((left, right) => compareText(left.asset.id, right.asset.id));
  return {
    mention,
    expectedType,
    candidates,
    resolved: candidates.length === 1 ? (candidates[0] ?? null) : null,
    dependency: {
      kind: "type_index",
      assetType: expectedType ?? inferTypeForUnscopedQuery(candidates),
      querySignature: entityQuerySignature(mention, expectedType),
      indexRevision
    }
  };
}

function inferTypeForUnscopedQuery(
  candidates: readonly StoryAnalysisAssetRead[]
): StoryBibleV11AssetType {
  return candidates[0]?.asset.type ?? "character";
}

function resolveDependencyQuery(
  dependency: Extract<StoryAnalysisDependency, { readonly kind: "type_index" }>,
  observation: StoryObservation,
  assets: readonly StoryAnalysisAssetRead[],
  indexRevision: string
): EntityResolution | undefined {
  const mentions = [observation.subject.mention, ...collectStrings(observation.fact.value)];
  for (const mention of mentions) {
    if (entityQuerySignature(mention, dependency.assetType) === dependency.querySignature) {
      return resolveEntity(mention, dependency.assetType, assets, indexRevision);
    }
  }
  return undefined;
}

function referencedIds(
  record: StoryChangeSuggestion,
  assetsById: ReadonlyMap<string, StoryAnalysisAssetRead>
): ReadonlySet<string> {
  const values: unknown[] = [record.target?.assetId, record.proposedAssetId, record.createValue];
  for (const operation of record.operations) values.push(operation.value);
  return new Set(values.flatMap(collectStrings).filter((value) => assetsById.has(value)));
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  return isRecord(value) ? Object.values(value).flatMap(collectStrings) : [];
}

function entityQuerySignature(
  mention: string,
  expectedType: StoryBibleV11AssetType | null
): string {
  return checksumText(
    stableJson({ expectedType, normalizedMention: normalizeEntityName(mention) })
  );
}

function operationFor(
  source: JsonObject,
  path: string,
  value: JsonValue
): StoryAnalysisPatchOperation {
  const before = readPointer(source, path);
  return {
    op: before === undefined ? "add" : "replace",
    path,
    beforeValueChecksum: before === undefined ? null : checksumStoryBibleSelectorValue(before),
    value: structuredClone(value)
  };
}

function assetFieldsDependency(
  target: StoryAnalysisAssetRead,
  selectors: readonly string[]
): Extract<StoryAnalysisDependency, { readonly kind: "asset_fields" }> {
  const stableSelectors = [...new Set(selectors)].sort(compareText);
  return {
    kind: "asset_fields",
    assetId: target.asset.id,
    baseRevision: target.asset.revision,
    selectors: stableSelectors,
    valueChecksum: checksumSelectors(target.asset, stableSelectors)
  };
}

function chapterDependency(
  input: MaterializeStoryObserverInput
): Extract<StoryAnalysisDependency, { readonly kind: "chapter" }> {
  return {
    kind: "chapter",
    chapterId: input.chapter.chapterId,
    checksum: input.chapter.checksum
  };
}

function checksumSelectors(asset: StoryAnalysisAsset, selectors: readonly string[]): string {
  return checksumText(
    stableJson(
      [...selectors]
        .sort(compareText)
        .map((selector) => ({ selector, value: readPointer(asset, selector) }))
    )
  );
}

function toSuggestion(delta: StoryFactDelta, createdAt: string): StoryChangeSuggestion {
  return {
    ...delta,
    suggestionId: stableId("sug", delta.idempotencyKey),
    recordType: "change",
    status: "pending",
    revision: 1,
    createdAt,
    updatedAt: createdAt
  };
}

function deduplicateDeltas(deltas: readonly StoryFactDelta[]): readonly StoryFactDelta[] {
  const byKey = new Map<string, StoryFactDelta>();
  for (const delta of deltas) {
    const existing = byKey.get(delta.idempotencyKey);
    if (existing === undefined) {
      byKey.set(delta.idempotencyKey, delta);
      continue;
    }
    byKey.set(delta.idempotencyKey, {
      ...existing,
      observationIds: [...new Set([...existing.observationIds, ...delta.observationIds])],
      evidence: deduplicateEvidence([...existing.evidence, ...delta.evidence]),
      confidence: Math.max(existing.confidence, delta.confidence)
    });
  }
  return [...byKey.values()];
}

function deduplicateAndResolveConflicts(
  records: readonly (StoryChangeSuggestion | StoryReviewIssue)[],
  input: MaterializeStoryObserverInput
): {
  readonly records: readonly (StoryChangeSuggestion | StoryReviewIssue)[];
  readonly conflictedGroupIds: ReadonlySet<string>;
} {
  const byKey = new Map<string, StoryChangeSuggestion | StoryReviewIssue>();
  for (const record of records) {
    const existing = byKey.get(record.idempotencyKey);
    if (existing === undefined) {
      byKey.set(record.idempotencyKey, record);
    } else if (existing.recordType === "change" && record.recordType === "change") {
      byKey.set(record.idempotencyKey, {
        ...existing,
        observationIds: [...new Set([...existing.observationIds, ...record.observationIds])],
        evidence: deduplicateEvidence([...existing.evidence, ...record.evidence]),
        confidence: Math.max(existing.confidence, record.confidence)
      });
    }
  }

  const unique = [...byKey.values()];
  const claimsByTargetPath = new Map<string, StoryChangeSuggestion[]>();
  for (const record of unique) {
    if (record.recordType !== "change" || record.action !== "patch" || record.target === null)
      continue;
    for (const operation of record.operations) {
      const key = `${record.target.assetId}:${operation.path}`;
      const claims = claimsByTargetPath.get(key) ?? [];
      claims.push(record);
      claimsByTargetPath.set(key, claims);
    }
  }
  const conflictingIds = new Set<string>();
  const conflictedGroupIds = new Set<string>();
  const conflictIssues: StoryReviewIssue[] = [];
  for (const [targetPath, suggestions] of claimsByTargetPath) {
    const values = new Set(
      suggestions.flatMap((suggestion) =>
        suggestion.operations
          .filter((operation) => `${suggestion.target?.assetId}:${operation.path}` === targetPath)
          .map((operation) => stableJson(operation.value))
      )
    );
    if (values.size <= 1) continue;
    suggestions.forEach((suggestion) => conflictingIds.add(suggestion.suggestionId));
    suggestions.forEach((suggestion) => conflictedGroupIds.add(suggestion.consistencyGroupId));
    const idempotencyKey = checksumText(
      stableJson({
        chapter: input.chapter.checksum,
        targetPath,
        values: [...values].sort(compareText)
      })
    );
    if (input.existingIdempotencyKeys?.has(idempotencyKey) === true) continue;
    conflictIssues.push({
      schemaVersion: "1.1",
      issueId: stableId("issue", idempotencyKey),
      recordType: "review_issue",
      revision: 1,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
      analysisRunId: input.analysisRunId,
      chapter: { chapterId: input.chapter.chapterId, checksum: input.chapter.checksum },
      issueType: "conflict",
      status: "open",
      claims: suggestions.map((suggestion) => ({
        value: {
          suggestionId: suggestion.suggestionId,
          targetPath,
          operations: suggestion.operations
        },
        evidence: suggestion.evidence
      })),
      affectedRefs: [`story_bible:${targetPath.split(":", 1)[0] ?? targetPath}`],
      dependencies: deduplicateDependencies(suggestions.flatMap((entry) => entry.dependencies)),
      idempotencyKey,
      resolution: null,
      dismissalReason: null,
      supersededByIssueId: null
    });
  }
  return {
    records: [
      ...unique.filter(
        (record) =>
          record.recordType === "review_issue" ||
          (!conflictingIds.has(record.suggestionId) &&
            !conflictedGroupIds.has(record.consistencyGroupId))
      ),
      ...conflictIssues
    ],
    conflictedGroupIds
  };
}

function transitionSuggestion(
  current: StoryChangeSuggestion,
  transition: Parameters<typeof transitionStoryAnalysisRecord>[0]["transition"],
  updatedAt: string
): Result<StoryChangeSuggestion, UnifiedError> {
  if (
    transition.status === "resolved" ||
    transition.status === "dismissed" ||
    transition.status === "issue_stale"
  ) {
    return err(
      engineError(
        "STORY_ANALYSIS_TRANSITION_INVALID",
        "Issue transition cannot target a suggestion."
      )
    );
  }
  const allowed: Readonly<
    Record<StoryChangeSuggestion["status"], readonly StoryChangeSuggestion["status"][]>
  > = {
    pending: ["accepted", "rejected", "stale", "failed"],
    accepted: ["applied", "stale", "failed"],
    applied: [],
    rejected: [],
    stale: [],
    failed: []
  };
  if (transition.status === current.status) return ok(current);
  if (!allowed[current.status].includes(transition.status)) {
    return err(
      engineError("STORY_ANALYSIS_TRANSITION_INVALID", "Suggestion transition is not allowed.")
    );
  }
  return ok({
    ...current,
    status: transition.status,
    revision: current.revision + 1,
    updatedAt
  });
}

function transitionIssue(
  current: StoryReviewIssue,
  transition: Parameters<typeof transitionStoryAnalysisRecord>[0]["transition"],
  updatedAt: string
): Result<StoryReviewIssue, UnifiedError> {
  if (current.status !== "open") {
    return err(
      engineError("STORY_ANALYSIS_TRANSITION_INVALID", "Only open issues can transition.")
    );
  }
  if (transition.status === "resolved") {
    if (transition.decision.trim().length === 0) {
      return err(
        engineError("STORY_ANALYSIS_TRANSITION_INVALID", "Issue resolution requires a decision.")
      );
    }
    return ok({
      ...current,
      status: "resolved",
      revision: current.revision + 1,
      updatedAt,
      resolution: {
        decision: transition.decision.trim(),
        changeSetId: transition.changeSetId,
        actor: transition.actor,
        resolvedAt: updatedAt
      }
    });
  }
  if (transition.status === "dismissed") {
    if (transition.reason.trim().length === 0) {
      return err(
        engineError("STORY_ANALYSIS_TRANSITION_INVALID", "Issue dismissal requires a reason.")
      );
    }
    return ok({
      ...current,
      status: "dismissed",
      revision: current.revision + 1,
      updatedAt,
      dismissalReason: transition.reason.trim()
    });
  }
  if (transition.status === "issue_stale") {
    return ok({
      ...current,
      status: "stale",
      revision: current.revision + 1,
      updatedAt,
      supersededByIssueId: transition.supersededByIssueId
    });
  }
  return err(
    engineError(
      "STORY_ANALYSIS_TRANSITION_INVALID",
      "Suggestion transition cannot target an issue."
    )
  );
}

function isReviewableRecord(record: StoryChangeSuggestion | StoryReviewIssue): boolean {
  return record.recordType === "change"
    ? record.status === "pending" || record.status === "accepted"
    : record.status === "open";
}

function recordIdentity(record: StoryChangeSuggestion | StoryReviewIssue): string {
  return record.recordType === "change" ? record.suggestionId : record.issueId;
}

function deduplicateDependencies(
  dependencies: readonly StoryAnalysisDependency[]
): StoryAnalysisDependency[] {
  const byKey = new Map<string, StoryAnalysisDependency>();
  for (const dependency of dependencies) byKey.set(stableJson(dependency), dependency);
  return [...byKey.values()];
}

function deduplicateEvidence(evidence: readonly StoryEvidenceRange[]): StoryEvidenceRange[] {
  const byKey = new Map<string, StoryEvidenceRange>();
  for (const entry of evidence)
    byKey.set(`${entry.start}:${entry.end}:${entry.excerptHash}`, entry);
  return [...byKey.values()].sort(
    (left, right) => left.start - right.start || left.end - right.end
  );
}

function readPointer(value: JsonObject, pointer: string): JsonValue | undefined {
  if (!pointer.startsWith("/") || pointer.includes("\0")) return undefined;
  let current: JsonValue = value;
  for (const segment of pointer
    .slice(1)
    .split("/")
    .map((entry) => entry.replaceAll("~1", "/").replaceAll("~0", "~"))) {
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return undefined;
    }
    const next: JsonValue | undefined = current[segment];
    if (next === undefined) return undefined;
    current = next;
  }
  return current;
}

function createAssetId(type: StoryBibleV11AssetType, seed: string): string {
  const prefixes: Readonly<Record<StoryBibleV11AssetType, string>> = {
    character: "chr",
    "world.location": "loc",
    "world.faction": "fac",
    "world.rule": "rule",
    "world.glossary": "term",
    "world.item": "item",
    "world.lore": "lore",
    outline: "outline",
    foreshadow: "fsh",
    "timeline.events": "timeline"
  };
  if (type === "outline") return "outline_main";
  if (type === "timeline.events") return "timeline_main";
  return stableId(prefixes[type], seed);
}

function stableId(prefix: string, seed: string): string {
  return `${prefix}_${checksumText(`${prefix}:${seed}`).slice(0, 32)}`;
}

function checksumText(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizeEntityName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("und");
}

function stableJson(value: unknown): string {
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function isObservationDomain(value: unknown): value is StoryObservationDomain {
  return (
    typeof value === "string" && STORY_OBSERVATION_DOMAINS.includes(value as StoryObservationDomain)
  );
}

function isEpistemicStatus(value: unknown): value is StoryEpistemicStatus {
  return (
    typeof value === "string" && STORY_EPISTEMIC_STATUSES.includes(value as StoryEpistemicStatus)
  );
}

function isFactKind(value: unknown): value is StoryFactKind {
  return typeof value === "string" && STORY_FACT_KINDS.includes(value as StoryFactKind);
}

function isWorldDetailType(
  value: StoryBibleV11AssetType
): value is keyof typeof WORLD_DETAIL_FIELDS {
  return Object.prototype.hasOwnProperty.call(WORLD_DETAIL_FIELDS, value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function isUniqueStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === "string" && entry.trim().length > 0) &&
    new Set(value).size === value.length
  );
}

function objectArray(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter(isRecord).map((entry) => structuredClone(entry)) : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function hasExactKeys(value: JsonObject, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && hasOnlyKeys(value, keys);
}

function hasOnlyKeys(value: JsonObject, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function rejected(
  code: string,
  message: string
): {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
} {
  return { ok: false, code, message };
}

function engineError(code: string, message: string): UnifiedError {
  return createUnifiedError({
    code,
    category: "ValidationError",
    message,
    recoverability: "user-action",
    suggestedAction: "Refresh the saved chapter and Story Bible, then analyze again.",
    traceId: "story-analysis-engine"
  });
}
