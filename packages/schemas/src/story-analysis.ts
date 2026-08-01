import { createSchemaValidator, type ValidationIssue, type ValidationResult } from "./index.js";
import {
  STORY_BIBLE_V11_ASSET_TYPES,
  createStoryBibleCreateValueSchema,
  isStoryBibleV11AssetType,
  type StoryBibleV11AssetType
} from "./story-bible.js";

export const STORY_OBSERVATION_DOMAINS = [
  "character.behavior",
  "character.location",
  "character.resource",
  "character.relationship",
  "character.emotion",
  "character.information",
  "foreshadow",
  "timeline",
  "character.physical_state"
] as const;

export const STORY_EPISTEMIC_STATUSES = [
  "narrator_asserted",
  "dialogue_claim",
  "character_belief",
  "rumor",
  "model_inference",
  "uncertain"
] as const;

export const STORY_FACT_KINDS = [
  "character_behavior",
  "character_location",
  "character_held_items",
  "character_relationship",
  "character_emotional",
  "character_knowledge",
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
] as const;

export type StoryObservationDomain = (typeof STORY_OBSERVATION_DOMAINS)[number];
export type StoryEpistemicStatus = (typeof STORY_EPISTEMIC_STATUSES)[number];
export type StoryFactKind = (typeof STORY_FACT_KINDS)[number];

export interface StoryAnalysisChapterBinding {
  readonly chapterId: string;
  readonly checksum: string;
}

export interface StoryEvidenceRange {
  readonly start: number;
  readonly end: number;
  readonly excerptHash: string;
}

export interface StoryAnalysisRun {
  readonly schemaVersion: "1.1";
  readonly analysisRunId: string;
  readonly trigger: "manual" | "chapter_completed";
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly chapter: StoryAnalysisChapterBinding;
  readonly contextSnapshot: {
    readonly contextSnapshotId: string;
    readonly checksum: string;
  };
  readonly recalledAssets: readonly {
    readonly assetId: string;
    readonly revision: number;
    readonly checksum: string;
    readonly reason: string;
    readonly truncated: boolean;
  }[];
  readonly runtime: {
    readonly providerId: string;
    readonly modelId: string;
    readonly promptVersion: string;
    readonly promptChecksum: string;
    readonly extractorVersion: string;
  };
  readonly validation: {
    readonly observationCount: number;
    readonly acceptedCount: number;
    readonly rejectedCount: number;
    readonly errors: readonly { readonly code: string; readonly message: string }[];
  };
  readonly usage: {
    readonly usageRecordId: string | null;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly estimatedCost: number | null;
  };
  readonly status: "queued" | "running" | "completed" | "partial" | "failed" | "cancelled";
  readonly failure: {
    readonly code: string;
    readonly retryable: boolean;
    readonly reason: string;
  } | null;
}

export interface StoryObservation {
  readonly schemaVersion: "1.1";
  readonly observationId: string;
  readonly analysisRunId: string;
  readonly chapter: StoryAnalysisChapterBinding;
  readonly domain: StoryObservationDomain;
  readonly subject: {
    readonly mention: string;
    readonly expectedType: StoryBibleV11AssetType | null;
    readonly candidateAssetIds: readonly string[];
    readonly resolvedAssetId: string | null;
  };
  readonly fact: { readonly kind: StoryFactKind; readonly value: unknown };
  readonly evidence: readonly StoryEvidenceRange[];
  readonly epistemicStatus: StoryEpistemicStatus;
  readonly confidence: number;
  readonly reason: string;
}

export interface StoryAnalysisPatchOperation {
  readonly op: "add" | "replace" | "remove";
  readonly path: string;
  readonly beforeValueChecksum: string | null;
  readonly value?: unknown;
}

export type StoryAnalysisDependency =
  | {
      readonly kind: "asset_fields";
      readonly assetId: string;
      readonly baseRevision: number;
      readonly selectors: readonly string[];
      readonly valueChecksum: string;
    }
  | {
      readonly kind: "type_index";
      readonly assetType: StoryBibleV11AssetType;
      readonly querySignature: string;
      readonly indexRevision: string;
    }
  | {
      readonly kind: "chapter";
      readonly chapterId: string;
      readonly checksum: string;
    };

export interface StoryFactDelta {
  readonly schemaVersion: "1.1";
  readonly deltaId: string;
  readonly analysisRunId: string;
  readonly observationIds: readonly string[];
  readonly chapter: StoryAnalysisChapterBinding;
  readonly domain: StoryObservationDomain;
  readonly action: "create" | "patch";
  readonly target: {
    readonly assetId: string;
    readonly baseRevision: number;
    readonly entryRef: Record<string, unknown> | null;
  } | null;
  readonly proposedAssetType: StoryBibleV11AssetType | null;
  readonly proposedAssetId: string | null;
  readonly createValue: Record<string, unknown> | null;
  readonly dependencies: readonly StoryAnalysisDependency[];
  readonly consistencyGroupId: string;
  readonly operations: readonly StoryAnalysisPatchOperation[];
  readonly evidence: readonly StoryEvidenceRange[];
  readonly epistemicStatus: StoryEpistemicStatus;
  readonly confidence: number;
  readonly reason: string;
  readonly idempotencyKey: string;
}

export interface StoryChangeSuggestion extends StoryFactDelta {
  readonly suggestionId: string;
  readonly recordType: "change";
  readonly status: "pending" | "accepted" | "applied" | "rejected" | "stale" | "failed";
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface StoryReviewIssue {
  readonly schemaVersion: "1.1";
  readonly issueId: string;
  readonly recordType: "review_issue";
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly analysisRunId: string;
  readonly chapter: StoryAnalysisChapterBinding;
  readonly issueType: "conflict" | "ambiguity" | "unresolved_entity" | "overdue_foreshadow";
  readonly status: "open" | "resolved" | "dismissed" | "stale";
  readonly claims: readonly {
    readonly value: unknown;
    readonly evidence: readonly StoryEvidenceRange[];
  }[];
  readonly affectedRefs: readonly string[];
  readonly dependencies: readonly StoryAnalysisDependency[];
  readonly idempotencyKey: string;
  readonly resolution: {
    readonly decision: string;
    readonly changeSetId: string | null;
    readonly actor: "author" | "system";
    readonly resolvedAt: string;
  } | null;
  readonly dismissalReason: string | null;
  readonly supersededByIssueId: string | null;
}

export interface StoryAnalysisBundle {
  readonly schemaVersion: "1.1";
  readonly analysisRun: StoryAnalysisRun;
  readonly observations: readonly StoryObservation[];
  readonly factDeltas: readonly StoryFactDelta[];
  readonly records: readonly (StoryChangeSuggestion | StoryReviewIssue)[];
}

type Schema = Record<string, unknown>;

let cachedValidator: ReturnType<typeof createSchemaValidator> | undefined;

export function createStoryAnalysisBundleSchema(): Schema {
  const evidence = strictObject(
    {
      start: { type: "integer", minimum: 0 },
      end: { type: "integer", minimum: 1 },
      excerptHash: hashSchema()
    },
    ["start", "end", "excerptHash"]
  );
  const chapter = strictObject(
    { chapterId: chapterIdSchema(), checksum: hashSchema() },
    ["chapterId", "checksum"]
  );
  const dependency = {
    oneOf: [
      strictObject(
        {
          kind: { const: "asset_fields" },
          assetId: assetIdSchema(),
          baseRevision: { type: "integer", minimum: 0 },
          selectors: stringArray(100),
          valueChecksum: hashSchema()
        },
        ["kind", "assetId", "baseRevision", "selectors", "valueChecksum"]
      ),
      strictObject(
        {
          kind: { const: "type_index" },
          assetType: { enum: [...STORY_BIBLE_V11_ASSET_TYPES] },
          querySignature: hashSchema(),
          indexRevision: hashSchema()
        },
        ["kind", "assetType", "querySignature", "indexRevision"]
      ),
      strictObject(
        { kind: { const: "chapter" }, chapterId: chapterIdSchema(), checksum: hashSchema() },
        ["kind", "chapterId", "checksum"]
      )
    ]
  };
  const operation = strictObject(
    {
      op: { enum: ["add", "replace", "remove"] },
      path: { type: "string", pattern: "^/", maxLength: 2048 },
      beforeValueChecksum: nullable(hashSchema()),
      value: {}
    },
    ["op", "path", "beforeValueChecksum"]
  );
  const target = strictObject(
    {
      assetId: assetIdSchema(),
      baseRevision: { type: "integer", minimum: 0 },
      entryRef: nullable({ type: "object" })
    },
    ["assetId", "baseRevision", "entryRef"]
  );
  const factDeltaProperties: Schema = {
    schemaVersion: { const: "1.1" },
    deltaId: idSchema("dlt"),
    analysisRunId: idSchema("run"),
    observationIds: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      uniqueItems: true,
      items: idSchema("obs")
    },
    chapter,
    domain: { enum: [...STORY_OBSERVATION_DOMAINS] },
    action: { enum: ["create", "patch"] },
    target: nullable(target),
    proposedAssetType: nullable({ enum: [...STORY_BIBLE_V11_ASSET_TYPES] }),
    proposedAssetId: nullable(assetIdSchema()),
    createValue: nullable({ type: "object" }),
    dependencies: { type: "array", maxItems: 100, items: dependency },
    consistencyGroupId: idSchema("cgrp"),
    operations: { type: "array", maxItems: 100, items: operation },
    evidence: { type: "array", minItems: 1, maxItems: 100, items: evidence },
    epistemicStatus: { enum: [...STORY_EPISTEMIC_STATUSES] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    reason: { type: "string", minLength: 1, maxLength: 10_000 },
    idempotencyKey: hashSchema()
  };
  const factDeltaRequired = Object.keys(factDeltaProperties);
  const factDelta = strictObject(factDeltaProperties, factDeltaRequired);
  const suggestion = strictObject(
    {
      ...factDeltaProperties,
      suggestionId: idSchema("sug"),
      recordType: { const: "change" },
      status: { enum: ["pending", "accepted", "applied", "rejected", "stale", "failed"] },
      revision: { type: "integer", minimum: 1 },
      createdAt: dateTimeSchema(),
      updatedAt: dateTimeSchema()
    },
    [
      ...factDeltaRequired,
      "suggestionId",
      "recordType",
      "status",
      "revision",
      "createdAt",
      "updatedAt"
    ]
  );
  const issue = strictObject(
    {
      schemaVersion: { const: "1.1" },
      issueId: idSchema("issue"),
      recordType: { const: "review_issue" },
      revision: { type: "integer", minimum: 1 },
      createdAt: dateTimeSchema(),
      updatedAt: dateTimeSchema(),
      analysisRunId: idSchema("run"),
      chapter,
      issueType: { enum: ["conflict", "ambiguity", "unresolved_entity", "overdue_foreshadow"] },
      status: { enum: ["open", "resolved", "dismissed", "stale"] },
      claims: {
        type: "array",
        minItems: 1,
        maxItems: 100,
        items: strictObject(
          { value: {}, evidence: { type: "array", minItems: 1, maxItems: 100, items: evidence } },
          ["value", "evidence"]
        )
      },
      affectedRefs: stringArray(1_000),
      dependencies: { type: "array", maxItems: 100, items: dependency },
      idempotencyKey: hashSchema(),
      resolution: nullable(
        strictObject(
          {
            decision: { type: "string", minLength: 1, maxLength: 10_000 },
            changeSetId: nullable({ type: "string", minLength: 1, maxLength: 128 }),
            actor: { enum: ["author", "system"] },
            resolvedAt: dateTimeSchema()
          },
          ["decision", "changeSetId", "actor", "resolvedAt"]
        )
      ),
      dismissalReason: nullable({ type: "string", minLength: 1, maxLength: 10_000 }),
      supersededByIssueId: nullable(idSchema("issue"))
    },
    [
      "schemaVersion",
      "issueId",
      "recordType",
      "revision",
      "createdAt",
      "updatedAt",
      "analysisRunId",
      "chapter",
      "issueType",
      "status",
      "claims",
      "affectedRefs",
      "dependencies",
      "idempotencyKey",
      "resolution",
      "dismissalReason",
      "supersededByIssueId"
    ]
  );
  const observation = strictObject(
    {
      schemaVersion: { const: "1.1" },
      observationId: idSchema("obs"),
      analysisRunId: idSchema("run"),
      chapter,
      domain: { enum: [...STORY_OBSERVATION_DOMAINS] },
      subject: strictObject(
        {
          mention: { type: "string", minLength: 1, maxLength: 512 },
          expectedType: nullable({ enum: [...STORY_BIBLE_V11_ASSET_TYPES] }),
          candidateAssetIds: {
            type: "array",
            maxItems: 100,
            uniqueItems: true,
            items: assetIdSchema()
          },
          resolvedAssetId: nullable(assetIdSchema())
        },
        ["mention", "expectedType", "candidateAssetIds", "resolvedAssetId"]
      ),
      fact: strictObject(
        { kind: { enum: [...STORY_FACT_KINDS] }, value: {} },
        ["kind", "value"]
      ),
      evidence: { type: "array", minItems: 1, maxItems: 100, items: evidence },
      epistemicStatus: { enum: [...STORY_EPISTEMIC_STATUSES] },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      reason: { type: "string", minLength: 1, maxLength: 10_000 }
    },
    [
      "schemaVersion",
      "observationId",
      "analysisRunId",
      "chapter",
      "domain",
      "subject",
      "fact",
      "evidence",
      "epistemicStatus",
      "confidence",
      "reason"
    ]
  );
  const analysisRun = strictObject(
    {
      schemaVersion: { const: "1.1" },
      analysisRunId: idSchema("run"),
      trigger: { enum: ["manual", "chapter_completed"] },
      createdAt: dateTimeSchema(),
      startedAt: nullable(dateTimeSchema()),
      completedAt: nullable(dateTimeSchema()),
      chapter,
      contextSnapshot: strictObject(
        {
          contextSnapshotId: { type: "string", minLength: 1, maxLength: 128 },
          checksum: hashSchema()
        },
        ["contextSnapshotId", "checksum"]
      ),
      recalledAssets: {
        type: "array",
        maxItems: 10_000,
        items: strictObject(
          {
            assetId: assetIdSchema(),
            revision: { type: "integer", minimum: 0 },
            checksum: hashSchema(),
            reason: { type: "string", minLength: 1, maxLength: 256 },
            truncated: { type: "boolean" }
          },
          ["assetId", "revision", "checksum", "reason", "truncated"]
        )
      },
      runtime: strictObject(
        {
          providerId: { type: "string", minLength: 1, maxLength: 256 },
          modelId: { type: "string", minLength: 1, maxLength: 256 },
          promptVersion: { type: "string", minLength: 1, maxLength: 256 },
          promptChecksum: hashSchema(),
          extractorVersion: { type: "string", minLength: 1, maxLength: 256 }
        },
        ["providerId", "modelId", "promptVersion", "promptChecksum", "extractorVersion"]
      ),
      validation: strictObject(
        {
          observationCount: { type: "integer", minimum: 0 },
          acceptedCount: { type: "integer", minimum: 0 },
          rejectedCount: { type: "integer", minimum: 0 },
          errors: {
            type: "array",
            maxItems: 1_000,
            items: strictObject(
              {
                code: { type: "string", minLength: 1, maxLength: 256 },
                message: { type: "string", minLength: 1, maxLength: 10_000 }
              },
              ["code", "message"]
            )
          }
        },
        ["observationCount", "acceptedCount", "rejectedCount", "errors"]
      ),
      usage: strictObject(
        {
          usageRecordId: nullable({ type: "string", minLength: 1, maxLength: 256 }),
          inputTokens: { type: "integer", minimum: 0 },
          outputTokens: { type: "integer", minimum: 0 },
          estimatedCost: nullable({ type: "number", minimum: 0 })
        },
        ["usageRecordId", "inputTokens", "outputTokens", "estimatedCost"]
      ),
      status: { enum: ["queued", "running", "completed", "partial", "failed", "cancelled"] },
      failure: nullable(
        strictObject(
          {
            code: { type: "string", minLength: 1, maxLength: 256 },
            retryable: { type: "boolean" },
            reason: { type: "string", minLength: 1, maxLength: 10_000 }
          },
          ["code", "retryable", "reason"]
        )
      )
    },
    [
      "schemaVersion",
      "analysisRunId",
      "trigger",
      "createdAt",
      "startedAt",
      "completedAt",
      "chapter",
      "contextSnapshot",
      "recalledAssets",
      "runtime",
      "validation",
      "usage",
      "status",
      "failure"
    ]
  );

  return strictObject(
    {
      schemaVersion: { const: "1.1" },
      analysisRun,
      observations: { type: "array", maxItems: 10_000, items: observation },
      factDeltas: { type: "array", maxItems: 10_000, items: factDelta },
      records: { type: "array", maxItems: 10_000, items: { oneOf: [suggestion, issue] } }
    },
    ["schemaVersion", "analysisRun", "observations", "factDeltas", "records"]
  );
}

export function validateStoryAnalysisBundle(value: unknown): ValidationResult {
  cachedValidator ??= createSchemaValidator(createStoryAnalysisBundleSchema());
  const structural = cachedValidator(value);
  if (!structural.valid || !isRecord(value)) return structural;
  const issues: ValidationIssue[] = [];
  const run = isRecord(value["analysisRun"]) ? value["analysisRun"] : {};
  const runId = run["analysisRunId"];
  const chapter = run["chapter"];
  const observations = recordArray(value["observations"]);
  const observationIds = new Set(observations.map((entry) => entry["observationId"]));
  const ids = new Set<string>();

  validateRunLifecycle(run, observations.length, issues);
  for (const [index, observation] of observations.entries()) {
    validateOwnedRecord(observation, runId, chapter, `/observations/${index}`, issues);
    validateEvidenceRanges(observation["evidence"], `/observations/${index}/evidence`, issues);
    validateObservationSubject(observation, `/observations/${index}`, issues);
    addUniqueId(ids, observation["observationId"], `/observations/${index}/observationId`, issues);
  }
  for (const [index, delta] of recordArray(value["factDeltas"]).entries()) {
    validateOwnedRecord(delta, runId, chapter, `/factDeltas/${index}`, issues);
    validateDelta(delta, `/factDeltas/${index}`, observationIds, issues);
    validateEvidenceRanges(delta["evidence"], `/factDeltas/${index}/evidence`, issues);
    addUniqueId(ids, delta["deltaId"], `/factDeltas/${index}/deltaId`, issues);
  }
  for (const [index, record] of recordArray(value["records"]).entries()) {
    validateOwnedRecord(record, runId, chapter, `/records/${index}`, issues);
    if (record["recordType"] === "change") {
      validateDelta(record, `/records/${index}`, observationIds, issues);
      validateEvidenceRanges(record["evidence"], `/records/${index}/evidence`, issues);
      addUniqueId(ids, record["suggestionId"], `/records/${index}/suggestionId`, issues);
    } else {
      for (const [claimIndex, claim] of recordArray(record["claims"]).entries()) {
        validateEvidenceRanges(
          claim["evidence"],
          `/records/${index}/claims/${claimIndex}/evidence`,
          issues
        );
      }
      validateIssueState(record, `/records/${index}`, issues);
      addUniqueId(ids, record["issueId"], `/records/${index}/issueId`, issues);
    }
  }
  return { valid: issues.length === 0, issues };
}

function validateRunLifecycle(
  run: Record<string, unknown>,
  persistedObservationCount: number,
  issues: ValidationIssue[]
): void {
  const status = run["status"];
  const startedAt = run["startedAt"];
  const completedAt = run["completedAt"];
  const failure = run["failure"];
  if (status === "queued" && (startedAt !== null || completedAt !== null || failure !== null)) {
    issues.push(issue("/analysisRun", "lifecycle", "queued runs must not be started or completed"));
  }
  if (status === "running" && (typeof startedAt !== "string" || completedAt !== null || failure !== null)) {
    issues.push(issue("/analysisRun", "lifecycle", "running runs require startedAt only"));
  }
  if (
    (status === "completed" || status === "partial" || status === "cancelled") &&
    (typeof startedAt !== "string" || typeof completedAt !== "string")
  ) {
    issues.push(issue("/analysisRun", "lifecycle", "terminal runs require start and completion times"));
  }
  if (status === "failed" && (typeof completedAt !== "string" || !isRecord(failure))) {
    issues.push(issue("/analysisRun", "lifecycle", "failed runs require a failure and completion time"));
  }
  if (status !== "failed" && failure !== null) {
    issues.push(issue("/analysisRun/failure", "lifecycle", "only failed runs may contain failure"));
  }

  const validation = isRecord(run["validation"]) ? run["validation"] : {};
  const observationCount = Number(validation["observationCount"]);
  const acceptedCount = Number(validation["acceptedCount"]);
  const rejectedCount = Number(validation["rejectedCount"]);
  if (observationCount !== acceptedCount + rejectedCount) {
    issues.push(
      issue(
        "/analysisRun/validation",
        "observationCount",
        "observationCount must equal acceptedCount plus rejectedCount"
      )
    );
  }
  if (acceptedCount !== persistedObservationCount) {
    issues.push(
      issue(
        "/analysisRun/validation/acceptedCount",
        "observationCount",
        "acceptedCount must equal the persisted observation count"
      )
    );
  }
}

function validateObservationSubject(
  observation: Record<string, unknown>,
  path: string,
  issues: ValidationIssue[]
): void {
  const subject = isRecord(observation["subject"]) ? observation["subject"] : {};
  const resolvedAssetId = subject["resolvedAssetId"];
  if (
    typeof resolvedAssetId === "string" &&
    !arrayValue(subject["candidateAssetIds"]).includes(resolvedAssetId)
  ) {
    issues.push(
      issue(
        `${path}/subject/resolvedAssetId`,
        "entityResolution",
        "resolvedAssetId must be one of candidateAssetIds"
      )
    );
  }
}

function validateOwnedRecord(
  record: Record<string, unknown>,
  runId: unknown,
  chapter: unknown,
  path: string,
  issues: ValidationIssue[]
): void {
  if (record["analysisRunId"] !== runId) {
    issues.push(issue(`${path}/analysisRunId`, "analysisRunBinding", "must match the owning run"));
  }
  if (stableJson(record["chapter"]) !== stableJson(chapter)) {
    issues.push(issue(`${path}/chapter`, "chapterBinding", "must match the owning run chapter"));
  }
}

function validateDelta(
  delta: Record<string, unknown>,
  path: string,
  observationIds: ReadonlySet<unknown>,
  issues: ValidationIssue[]
): void {
  for (const observationId of arrayValue(delta["observationIds"])) {
    if (!observationIds.has(observationId)) {
      issues.push(issue(`${path}/observationIds`, "observationBinding", "must reference an observation in the bundle"));
    }
  }
  if (delta["action"] === "create") {
    if (
      delta["target"] !== null ||
      typeof delta["proposedAssetType"] !== "string" ||
      typeof delta["proposedAssetId"] !== "string" ||
      !isRecord(delta["createValue"]) ||
      arrayValue(delta["operations"]).length !== 0
    ) {
      issues.push(issue(path, "createContract", "create deltas require a reserved ID and createValue only"));
      return;
    }
    if (isStoryBibleV11AssetType(delta["proposedAssetType"])) {
      const validation = createSchemaValidator(
        createStoryBibleCreateValueSchema(delta["proposedAssetType"])
      )(delta["createValue"]);
      for (const entry of validation.issues) {
        issues.push({ ...entry, instancePath: `${path}/createValue${entry.instancePath}` });
      }
    }
    return;
  }
  if (
    !isRecord(delta["target"]) ||
    delta["proposedAssetType"] !== null ||
    delta["proposedAssetId"] !== null ||
    delta["createValue"] !== null ||
    arrayValue(delta["operations"]).length === 0
  ) {
    issues.push(issue(path, "patchContract", "patch deltas require a target and operations only"));
  }
}

function validateIssueState(
  record: Record<string, unknown>,
  path: string,
  issues: ValidationIssue[]
): void {
  const status = record["status"];
  const resolution = record["resolution"];
  const dismissalReason = record["dismissalReason"];
  if (status === "resolved" && !isRecord(resolution)) {
    issues.push(issue(`${path}/resolution`, "issueLifecycle", "resolved issues require a resolution"));
  }
  if (status !== "resolved" && resolution !== null) {
    issues.push(issue(`${path}/resolution`, "issueLifecycle", "only resolved issues may contain a resolution"));
  }
  if (status === "dismissed" && typeof dismissalReason !== "string") {
    issues.push(issue(`${path}/dismissalReason`, "issueLifecycle", "dismissed issues require a reason"));
  }
  if (status !== "dismissed" && dismissalReason !== null) {
    issues.push(issue(`${path}/dismissalReason`, "issueLifecycle", "only dismissed issues may contain a reason"));
  }
}

function validateEvidenceRanges(value: unknown, path: string, issues: ValidationIssue[]): void {
  for (const [index, evidence] of recordArray(value).entries()) {
    if (Number(evidence["end"]) <= Number(evidence["start"])) {
      issues.push(issue(`${path}/${index}/end`, "evidenceRange", "must be greater than start"));
    }
  }
}

function addUniqueId(
  ids: Set<string>,
  value: unknown,
  path: string,
  issues: ValidationIssue[]
): void {
  if (typeof value !== "string") return;
  if (ids.has(value)) issues.push(issue(path, "uniqueRecordId", "must be unique in the bundle"));
  ids.add(value);
}

function strictObject(properties: Schema, required: readonly string[] = []): Schema {
  return {
    type: "object",
    additionalProperties: false,
    ...(required.length === 0 ? {} : { required: [...required] }),
    properties
  };
}

function nullable(schema: Schema): Schema {
  return { anyOf: [schema, { type: "null" }] };
}

function stringArray(maxItems: number): Schema {
  return { type: "array", maxItems, uniqueItems: true, items: { type: "string" } };
}

function idSchema(prefix: string): Schema {
  return { type: "string", pattern: `^${prefix}_[a-f0-9]{32}$` };
}

function assetIdSchema(): Schema {
  return { type: "string", minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9_-]+$" };
}

function chapterIdSchema(): Schema {
  return { type: "string", pattern: "^ch_[A-Za-z0-9_-]+$" };
}

function hashSchema(): Schema {
  return { type: "string", pattern: "^[a-f0-9]{64}$" };
}

function dateTimeSchema(): Schema {
  return { type: "string", format: "date-time" };
}

function issue(path: string, keyword: string, message: string): ValidationIssue {
  return { instancePath: path, schemaPath: "#/storyAnalysis", keyword, message };
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableJson(value: unknown): string {
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => (left === right ? 0 : left < right ? -1 : 1))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}
