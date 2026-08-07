import { createHash } from "node:crypto";

export const AI_WRITING_STYLE_CORPUS_SCHEMA_VERSION = "1.0" as const;
export const AI_WRITING_STYLE_CORPUS_VERSION = "writing-style-corpus@2.0.0" as const;
export const AI_WRITING_STYLE_RUBRIC_VERSION = "writing-style-rubric@2.0.0" as const;
export const AI_WRITING_STYLE_MATCHER_VERSION = "utf16-span-v1" as const;

export type WritingStyleCorpusSplit = "development" | "qualification";
export type WritingStyleCorpusConfidence = "low" | "medium" | "high";
export type WritingStyleCorpusRuleId =
  "stacked-simile" | "explanatory-contrast" | "mechanical-emotion" | "direct-realization";

export interface WritingStyleCorpusLabelV1 {
  readonly ruleId: WritingStyleCorpusRuleId;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly confidence: WritingStyleCorpusConfidence;
  readonly rationale: string;
}

export interface WritingStyleCorpusAnnotatorLabelsV1 {
  readonly status: "provisional" | "human_complete";
  readonly labels: readonly WritingStyleCorpusLabelV1[];
}

export interface WritingStyleCorpusSampleV1 {
  readonly sampleId: string;
  readonly split: WritingStyleCorpusSplit;
  readonly category: string;
  readonly source: "synthetic_reproducible" | "explicitly_licensed" | "redistributable";
  readonly text: string;
  readonly fixedNegative: boolean;
  readonly reviewStatus: "pending_human_review" | "human_reviewed";
  readonly annotatorLabels: {
    readonly annotatorA: WritingStyleCorpusAnnotatorLabelsV1;
    readonly annotatorB: WritingStyleCorpusAnnotatorLabelsV1;
  };
  readonly goldLabels: readonly WritingStyleCorpusLabelV1[];
}

export interface WritingStyleCorpusV1 {
  readonly schemaVersion: typeof AI_WRITING_STYLE_CORPUS_SCHEMA_VERSION;
  readonly corpusVersion: typeof AI_WRITING_STYLE_CORPUS_VERSION;
  readonly ruleVersion: "2.0";
  readonly sourcePolicy: "synthetic_only_no_user_project_text";
  readonly annotationStatus: "provisional_pending_human_review" | "human_qualified";
  readonly samples: readonly WritingStyleCorpusSampleV1[];
}

export interface WritingStyleCorpusManifestV1 {
  readonly schemaVersion: typeof AI_WRITING_STYLE_CORPUS_SCHEMA_VERSION;
  readonly corpusVersion: typeof AI_WRITING_STYLE_CORPUS_VERSION;
  readonly rubricVersion: typeof AI_WRITING_STYLE_RUBRIC_VERSION;
  readonly ruleVersion: "2.0";
  readonly matcherVersion: typeof AI_WRITING_STYLE_MATCHER_VERSION;
  readonly sampleCount: number;
  readonly splitCounts: { readonly development: number; readonly qualification: number };
  readonly corpusSha256: string;
  readonly rubricSha256: string;
  readonly goldLabelsSha256: string;
  readonly fixedNegativeSampleIds: readonly string[];
  readonly qualification: {
    readonly eligible: boolean;
    readonly precisionNumerator: number | null;
    readonly precisionDenominator: number | null;
    readonly fixedNegativeFalsePositives: number | null;
    readonly blockedBy: readonly string[];
  };
  readonly qualityOwner: {
    readonly id: string | null;
    readonly signed: boolean;
    readonly decision: "pending_human_review" | "qualified" | "rejected";
  };
}

export interface WritingStyleCorpusQualificationResult {
  readonly eligible: boolean;
  readonly reasons: readonly string[];
}

export function parseWritingStyleCorpus(value: unknown): WritingStyleCorpusV1 {
  if (!isRecord(value) || value.schemaVersion !== "1.0") invalid();
  if (
    value.corpusVersion !== AI_WRITING_STYLE_CORPUS_VERSION ||
    value.ruleVersion !== "2.0" ||
    value.sourcePolicy !== "synthetic_only_no_user_project_text" ||
    (value.annotationStatus !== "provisional_pending_human_review" &&
      value.annotationStatus !== "human_qualified") ||
    !Array.isArray(value.samples)
  ) {
    invalid();
  }
  const samples = value.samples.map(parseSample);
  if (samples.length < 200) invalid();
  const ids = new Set<string>();
  for (const sample of samples) {
    if (ids.has(sample.sampleId)) invalid();
    ids.add(sample.sampleId);
  }
  return deepFreeze({
    schemaVersion: "1.0",
    corpusVersion: AI_WRITING_STYLE_CORPUS_VERSION,
    ruleVersion: "2.0",
    sourcePolicy: "synthetic_only_no_user_project_text",
    annotationStatus: value.annotationStatus,
    samples
  });
}

export function parseWritingStyleCorpusManifest(value: unknown): WritingStyleCorpusManifestV1 {
  if (!isRecord(value) || value.schemaVersion !== "1.0") invalid();
  const splitCounts = value.splitCounts;
  const qualification = value.qualification;
  const qualityOwner = value.qualityOwner;
  const qualityOwnerDecision = isRecord(qualityOwner) ? qualityOwner.decision : undefined;
  if (
    value.corpusVersion !== AI_WRITING_STYLE_CORPUS_VERSION ||
    value.rubricVersion !== AI_WRITING_STYLE_RUBRIC_VERSION ||
    value.ruleVersion !== "2.0" ||
    value.matcherVersion !== AI_WRITING_STYLE_MATCHER_VERSION ||
    !isSafeInteger(value.sampleCount) ||
    !isRecord(splitCounts) ||
    !isSafeInteger(splitCounts.development) ||
    !isSafeInteger(splitCounts.qualification) ||
    !isSha256(value.corpusSha256) ||
    !isSha256(value.rubricSha256) ||
    !isSha256(value.goldLabelsSha256) ||
    !Array.isArray(value.fixedNegativeSampleIds) ||
    !value.fixedNegativeSampleIds.every((id): id is string => typeof id === "string") ||
    !isRecord(qualification) ||
    typeof qualification.eligible !== "boolean" ||
    !isNullableSafeInteger(qualification.precisionNumerator) ||
    !isNullableSafeInteger(qualification.precisionDenominator) ||
    !isNullableSafeInteger(qualification.fixedNegativeFalsePositives) ||
    !Array.isArray(qualification.blockedBy) ||
    !qualification.blockedBy.every((reason): reason is string => typeof reason === "string") ||
    !isRecord(qualityOwner) ||
    (qualityOwner.id !== null && typeof qualityOwner.id !== "string") ||
    typeof qualityOwner.signed !== "boolean" ||
    !isQualityOwnerDecision(qualityOwnerDecision)
  ) {
    invalid();
  }
  return deepFreeze({
    schemaVersion: "1.0",
    corpusVersion: AI_WRITING_STYLE_CORPUS_VERSION,
    rubricVersion: AI_WRITING_STYLE_RUBRIC_VERSION,
    ruleVersion: "2.0",
    matcherVersion: AI_WRITING_STYLE_MATCHER_VERSION,
    sampleCount: value.sampleCount,
    splitCounts: {
      development: splitCounts.development,
      qualification: splitCounts.qualification
    },
    corpusSha256: value.corpusSha256,
    rubricSha256: value.rubricSha256,
    goldLabelsSha256: value.goldLabelsSha256,
    fixedNegativeSampleIds: [...value.fixedNegativeSampleIds],
    qualification: {
      eligible: qualification.eligible,
      precisionNumerator: qualification.precisionNumerator,
      precisionDenominator: qualification.precisionDenominator,
      fixedNegativeFalsePositives: qualification.fixedNegativeFalsePositives,
      blockedBy: [...qualification.blockedBy]
    },
    qualityOwner: {
      id: qualityOwner.id,
      signed: qualityOwner.signed,
      decision: qualityOwnerDecision
    }
  });
}

export function qualifyWritingStyleCorpus(
  corpus: WritingStyleCorpusV1,
  manifest: WritingStyleCorpusManifestV1
): WritingStyleCorpusQualificationResult {
  const reasons: string[] = [];
  if (manifest.sampleCount !== corpus.samples.length) reasons.push("sample_count_mismatch");
  if (corpus.annotationStatus !== "human_qualified") reasons.push("human_annotation_pending");
  if (!manifest.qualityOwner.signed || manifest.qualityOwner.decision !== "qualified") {
    reasons.push("quality_owner_signoff_pending");
  }
  const precision =
    manifest.qualification.precisionNumerator === null ||
    manifest.qualification.precisionDenominator === null ||
    manifest.qualification.precisionDenominator === 0
      ? undefined
      : manifest.qualification.precisionNumerator / manifest.qualification.precisionDenominator;
  if (precision === undefined || precision < 0.9) reasons.push("precision_not_qualified");
  if (manifest.qualification.fixedNegativeFalsePositives !== 0) {
    reasons.push("fixed_negative_false_positive");
  }
  return { eligible: reasons.length === 0, reasons };
}

export function sha256Utf8(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function parseSample(value: unknown): WritingStyleCorpusSampleV1 {
  if (!isRecord(value)) invalid();
  const annotatorLabels = value.annotatorLabels;
  if (!isRecord(annotatorLabels)) invalid();
  const sample = {
    sampleId: value.sampleId,
    split: value.split,
    category: value.category,
    source: value.source,
    text: value.text,
    fixedNegative: value.fixedNegative,
    reviewStatus: value.reviewStatus,
    annotatorLabels: {
      annotatorA: parseAnnotator(annotatorLabels.annotatorA),
      annotatorB: parseAnnotator(annotatorLabels.annotatorB)
    },
    goldLabels: parseLabels(value.goldLabels)
  };
  if (
    typeof sample.sampleId !== "string" ||
    !["development", "qualification"].includes(String(sample.split)) ||
    typeof sample.category !== "string" ||
    !["synthetic_reproducible", "explicitly_licensed", "redistributable"].includes(
      String(sample.source)
    ) ||
    typeof sample.text !== "string" ||
    typeof sample.fixedNegative !== "boolean" ||
    !["pending_human_review", "human_reviewed"].includes(String(sample.reviewStatus))
  ) {
    invalid();
  }
  if (sample.fixedNegative && sample.goldLabels.length > 0) invalid();
  return sample as WritingStyleCorpusSampleV1;
}

function parseAnnotator(value: unknown): WritingStyleCorpusAnnotatorLabelsV1 {
  if (!isRecord(value) || !["provisional", "human_complete"].includes(String(value.status))) {
    invalid();
  }
  return {
    status: value.status,
    labels: parseLabels(value.labels)
  } as WritingStyleCorpusAnnotatorLabelsV1;
}

function parseLabels(value: unknown): readonly WritingStyleCorpusLabelV1[] {
  if (!Array.isArray(value)) invalid();
  return value.map((labelValue) => {
    if (!isRecord(labelValue)) invalid();
    const ruleId = labelValue.ruleId;
    const startOffset = labelValue.startOffset;
    const endOffset = labelValue.endOffset;
    const confidence = labelValue.confidence;
    const rationale = labelValue.rationale;
    if (
      !isWritingStyleRuleId(ruleId) ||
      !isSafeInteger(startOffset) ||
      !isSafeInteger(endOffset) ||
      startOffset < 0 ||
      endOffset <= startOffset ||
      !isWritingStyleConfidence(confidence) ||
      typeof rationale !== "string"
    ) {
      invalid();
    }
    return { ruleId, startOffset, endOffset, confidence, rationale };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWritingStyleRuleId(value: unknown): value is WritingStyleCorpusRuleId {
  return (
    value === "stacked-simile" ||
    value === "explanatory-contrast" ||
    value === "mechanical-emotion" ||
    value === "direct-realization"
  );
}

function isWritingStyleConfidence(value: unknown): value is WritingStyleCorpusConfidence {
  return value === "low" || value === "medium" || value === "high";
}

function isQualityOwnerDecision(
  value: unknown
): value is WritingStyleCorpusManifestV1["qualityOwner"]["decision"] {
  return value === "pending_human_review" || value === "qualified" || value === "rejected";
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isNullableSafeInteger(value: unknown): value is number | null {
  return value === null || isSafeInteger(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function invalid(): never {
  throw new Error("AI_WRITING_STYLE_CORPUS_INVALID");
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
