import { createHash } from "node:crypto";

import { evaluateAiWritingStyle } from "./ai-writing-style-evaluator.js";

export const AI_WRITING_STYLE_CORPUS_SCHEMA_VERSION = "1.0" as const;
export const AI_WRITING_STYLE_CORPUS_VERSION = "writing-style-corpus@2.0.0" as const;
export const AI_WRITING_STYLE_RUBRIC_VERSION = "writing-style-rubric@2.0.0" as const;
export const AI_WRITING_STYLE_MATCHER_VERSION = "utf16-span-v2" as const;

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
  readonly precisionNumerator: number;
  readonly precisionDenominator: number;
  readonly fixedNegativeFalsePositives: number;
}

export interface WritingStyleCorpusArtifactVerificationInput {
  /** Exact checked-in corpus bytes, including the final newline. */
  readonly corpusBytes?: string;
  /** Exact checked-in rubric bytes. Omit only while evidence is unavailable. */
  readonly rubricBytes?: string;
}

export interface WritingStyleCorpusArtifactVerificationResult {
  readonly verified: boolean;
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
  const hasCompleteQualificationMetrics =
    isRecord(qualification) &&
    isNonNegativeSafeInteger(qualification.precisionNumerator) &&
    isNonNegativeSafeInteger(qualification.precisionDenominator) &&
    isNonNegativeSafeInteger(qualification.fixedNegativeFalsePositives);
  const hasPendingQualificationMetrics =
    isRecord(qualification) &&
    qualification.precisionNumerator === null &&
    qualification.precisionDenominator === null &&
    qualification.fixedNegativeFalsePositives === null;
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
    (!hasCompleteQualificationMetrics && !hasPendingQualificationMetrics) ||
    (hasCompleteQualificationMetrics &&
      Number(qualification.precisionNumerator) > Number(qualification.precisionDenominator)) ||
    !Array.isArray(qualification.blockedBy) ||
    !qualification.blockedBy.every((reason): reason is string => typeof reason === "string") ||
    !isRecord(qualityOwner) ||
    (qualityOwner.id !== null && typeof qualityOwner.id !== "string") ||
    typeof qualityOwner.signed !== "boolean" ||
    !isQualityOwnerDecision(qualityOwnerDecision) ||
    (qualityOwner.signed === true &&
      (typeof qualityOwner.id !== "string" ||
        qualityOwner.id.trim().length === 0 ||
        qualityOwnerDecision !== "qualified"))
  ) {
    invalid();
  }
  const parsedQualification = qualification as {
    readonly eligible: boolean;
    readonly precisionNumerator: number | null;
    readonly precisionDenominator: number | null;
    readonly fixedNegativeFalsePositives: number | null;
    readonly blockedBy: readonly string[];
  };
  const parsedQualityOwner = qualityOwner as {
    readonly id: string | null;
    readonly signed: boolean;
    readonly decision: WritingStyleCorpusManifestV1["qualityOwner"]["decision"];
  };
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
      eligible: parsedQualification.eligible,
      precisionNumerator: parsedQualification.precisionNumerator,
      precisionDenominator: parsedQualification.precisionDenominator,
      fixedNegativeFalsePositives: parsedQualification.fixedNegativeFalsePositives,
      blockedBy: [...parsedQualification.blockedBy]
    },
    qualityOwner: {
      id: parsedQualityOwner.id,
      signed: parsedQualityOwner.signed,
      decision: parsedQualityOwner.decision
    }
  });
}

export function qualifyWritingStyleCorpus(
  corpus: WritingStyleCorpusV1,
  manifest: WritingStyleCorpusManifestV1,
  artifact?: WritingStyleCorpusArtifactVerificationInput
): WritingStyleCorpusQualificationResult {
  const reasons: string[] = [];
  const computed = computeQualificationMetrics(corpus);
  if (manifest.sampleCount !== corpus.samples.length) reasons.push("sample_count_mismatch");
  if (!sameSplitCounts(corpus, manifest.splitCounts)) reasons.push("split_counts_mismatch");
  if (!sameFixedNegativeIds(corpus, manifest.fixedNegativeSampleIds)) {
    reasons.push("fixed_negative_set_mismatch");
  }
  if (!hasCompleteHumanAnnotations(corpus)) reasons.push("human_annotation_pending");
  if (
    !manifest.qualityOwner.signed ||
    manifest.qualityOwner.id === null ||
    manifest.qualityOwner.id.trim().length === 0 ||
    manifest.qualityOwner.decision !== "qualified"
  ) {
    reasons.push("quality_owner_signoff_pending");
  }
  if (
    manifest.qualification.precisionNumerator !== computed.precisionNumerator ||
    manifest.qualification.precisionDenominator !== computed.precisionDenominator ||
    manifest.qualification.fixedNegativeFalsePositives !== computed.fixedNegativeFalsePositives
  ) {
    reasons.push("qualification_metrics_mismatch");
  }
  const precision =
    computed.precisionDenominator === 0
      ? undefined
      : computed.precisionNumerator / computed.precisionDenominator;
  if (precision === undefined || precision < 0.9) reasons.push("precision_not_qualified");
  if (computed.fixedNegativeFalsePositives !== 0) {
    reasons.push("fixed_negative_false_positive");
  }
  reasons.push(...verifyWritingStyleCorpusArtifact(corpus, manifest, artifact).reasons);

  const eligibleWithoutManifestClaim = reasons.length === 0;
  if (manifest.qualification.eligible !== eligibleWithoutManifestClaim) {
    reasons.push("manifest_eligibility_mismatch");
  }
  if (
    (eligibleWithoutManifestClaim && manifest.qualification.blockedBy.length > 0) ||
    (!eligibleWithoutManifestClaim && manifest.qualification.blockedBy.length === 0)
  ) {
    reasons.push("manifest_blocked_by_mismatch");
  }
  return {
    eligible: reasons.length === 0,
    reasons: [...new Set(reasons)],
    ...computed
  };
}

/**
 * Verifies the immutable artifact bytes that are deliberately not retained by
 * the parsed corpus model. A missing byte source is evidence missing, never a
 * successful verification.
 */
export function verifyWritingStyleCorpusArtifact(
  corpus: WritingStyleCorpusV1,
  manifest: WritingStyleCorpusManifestV1,
  input: WritingStyleCorpusArtifactVerificationInput | undefined
): WritingStyleCorpusArtifactVerificationResult {
  const reasons: string[] = [];
  if (input?.corpusBytes === undefined) {
    reasons.push("corpus_checksum_unverified");
  } else if (
    sha256Utf8(input.corpusBytes) !== manifest.corpusSha256 ||
    !sameCorpusJson(input.corpusBytes, corpus)
  ) {
    reasons.push("corpus_checksum_mismatch");
  }
  if (input?.rubricBytes === undefined) {
    reasons.push("rubric_checksum_unverified");
  } else if (sha256Utf8(input.rubricBytes) !== manifest.rubricSha256) {
    reasons.push("rubric_checksum_mismatch");
  }
  if (manifest.goldLabelsSha256 !== sha256Utf8(canonicalGoldLabels(corpus))) {
    reasons.push("gold_labels_checksum_mismatch");
  }
  return { verified: reasons.length === 0, reasons };
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
  validateLabelsForText(sample.text, sample.goldLabels);
  validateLabelsForText(sample.text, sample.annotatorLabels.annotatorA.labels);
  validateLabelsForText(sample.text, sample.annotatorLabels.annotatorB.labels);
  if (
    sample.fixedNegative &&
    (sample.annotatorLabels.annotatorA.labels.length > 0 ||
      sample.annotatorLabels.annotatorB.labels.length > 0)
  ) {
    invalid();
  }
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

function validateLabelsForText(text: string, labels: readonly WritingStyleCorpusLabelV1[]): void {
  const keys = new Set<string>();
  let previous: string | undefined;
  for (const label of labels) {
    if (
      label.endOffset > text.length ||
      !isUtf16Boundary(text, label.startOffset) ||
      !isUtf16Boundary(text, label.endOffset)
    ) {
      invalid();
    }
    const key = labelKey(label);
    if (keys.has(key) || (previous !== undefined && previous > key)) invalid();
    keys.add(key);
    previous = key;
  }
}

function isUtf16Boundary(text: string, offset: number): boolean {
  if (offset < 0 || offset > text.length) return false;
  if (offset === 0 || offset === text.length) return true;
  const before = text.charCodeAt(offset - 1);
  const after = text.charCodeAt(offset);
  return !(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff);
}

function labelKey(label: WritingStyleCorpusLabelV1): string {
  return `${label.startOffset.toString().padStart(12, "0")}:${label.endOffset
    .toString()
    .padStart(12, "0")}:${label.ruleId}`;
}

function computeQualificationMetrics(corpus: WritingStyleCorpusV1): {
  readonly precisionNumerator: number;
  readonly precisionDenominator: number;
  readonly fixedNegativeFalsePositives: number;
} {
  let precisionNumerator = 0;
  let precisionDenominator = 0;
  let fixedNegativeFalsePositives = 0;
  for (const sample of corpus.samples) {
    const predictions = evaluateAiWritingStyle({
      baselineText: "",
      candidateText: sample.text
    }).hits;
    if (sample.fixedNegative) fixedNegativeFalsePositives += predictions.length;
    if (sample.split !== "qualification") continue;
    const expected = new Set(
      sample.goldLabels
        .filter((label) => label.confidence !== "low")
        .map((label) => `${label.ruleId}:${label.startOffset}:${label.endOffset}`)
    );
    for (const prediction of predictions) {
      if (prediction.confidence === "low") continue;
      precisionDenominator += 1;
      const predictionKey = `${prediction.ruleId}:${prediction.startOffset}:${prediction.endOffset}`;
      if (expected.delete(predictionKey)) {
        precisionNumerator += 1;
      }
    }
  }
  return { precisionNumerator, precisionDenominator, fixedNegativeFalsePositives };
}

function sameSplitCounts(
  corpus: WritingStyleCorpusV1,
  expected: WritingStyleCorpusManifestV1["splitCounts"]
): boolean {
  return (
    corpus.samples.filter((sample) => sample.split === "development").length ===
      expected.development &&
    corpus.samples.filter((sample) => sample.split === "qualification").length ===
      expected.qualification
  );
}

function sameFixedNegativeIds(corpus: WritingStyleCorpusV1, ids: readonly string[]): boolean {
  const expected = corpus.samples
    .filter((sample) => sample.fixedNegative)
    .map((sample) => sample.sampleId);
  return expected.length === ids.length && expected.every((id, index) => id === ids[index]);
}

function hasCompleteHumanAnnotations(corpus: WritingStyleCorpusV1): boolean {
  return (
    corpus.annotationStatus === "human_qualified" &&
    corpus.samples.every((sample) => {
      const { annotatorA, annotatorB } = sample.annotatorLabels;
      return (
        sample.reviewStatus === "human_reviewed" &&
        annotatorA.status === "human_complete" &&
        annotatorB.status === "human_complete" &&
        sameLabels(sample.goldLabels, annotatorA.labels) &&
        sameLabels(sample.goldLabels, annotatorB.labels)
      );
    })
  );
}

function sameLabels(
  left: readonly WritingStyleCorpusLabelV1[],
  right: readonly WritingStyleCorpusLabelV1[]
): boolean {
  return (
    left.length === right.length &&
    left.every((label, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        label.ruleId === other.ruleId &&
        label.startOffset === other.startOffset &&
        label.endOffset === other.endOffset &&
        label.confidence === other.confidence
      );
    })
  );
}

function canonicalGoldLabels(corpus: WritingStyleCorpusV1): string {
  return `${JSON.stringify(
    corpus.samples.map((sample) => ({ sampleId: sample.sampleId, labels: sample.goldLabels })),
    null,
    2
  )}\n`;
}

function sameCorpusJson(bytes: string, corpus: WritingStyleCorpusV1): boolean {
  try {
    return JSON.stringify(JSON.parse(bytes)) === JSON.stringify(corpus);
  } catch {
    return false;
  }
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

function isNonNegativeSafeInteger(value: unknown): value is number {
  return isSafeInteger(value) && value >= 0;
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
