import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import {
  parseWritingStyleCorpus,
  parseWritingStyleCorpusManifest,
  qualifyWritingStyleCorpus,
  sha256Utf8,
  verifyWritingStyleCorpusArtifact
} from "../src/ai-writing-style-corpus.js";

const fixtureDirectory = join(process.cwd(), "packages/application/test/fixtures");
const corpusBytes = readFileSync(join(fixtureDirectory, "writing-style-corpus.json"), "utf8");
const manifestBytes = readFileSync(
  join(fixtureDirectory, "writing-style-corpus-manifest.json"),
  "utf8"
);
const rubricBytes = readFileSync(
  join(fixtureDirectory, "writing-style-annotation-rubric.md"),
  "utf8"
);

describe("Writing Style 2.0 corpus contract", () => {
  test("contains a reproducible 200-sample synthetic candidate corpus", () => {
    const corpus = parseWritingStyleCorpus(JSON.parse(corpusBytes));
    const manifest = parseWritingStyleCorpusManifest(JSON.parse(manifestBytes));
    expect(corpus.samples).toHaveLength(200);
    expect(manifest.sampleCount).toBe(200);
    expect(manifest.splitCounts).toEqual({ development: 140, qualification: 60 });
    expect(manifest.corpusSha256).toBe(sha256Utf8(corpusBytes));
    expect(manifest.rubricSha256).toBe(sha256Utf8(rubricBytes));
    expect(manifest.goldLabelsSha256).toBe(
      sha256Utf8(
        `${JSON.stringify(
          corpus.samples.map((sample) => ({
            sampleId: sample.sampleId,
            labels: sample.goldLabels
          })),
          null,
          2
        )}\n`
      )
    );

    const categories = new Set(corpus.samples.map((sample) => sample.category));
    expect(categories).toEqual(
      new Set([
        "clean_narrative",
        "stacked_simile",
        "explanatory_contrast",
        "dialogue",
        "quotation",
        "factual_correction",
        "non_emotional_pressure",
        "single_emotion",
        "clustered_emotion",
        "direct_realization",
        "unicode_offsets"
      ])
    );
  });

  test("requires two human labels and blind quality-owner sign-off before qualification", () => {
    const corpus = parseWritingStyleCorpus(JSON.parse(corpusBytes));
    const manifest = parseWritingStyleCorpusManifest(JSON.parse(manifestBytes));
    expect(manifest.qualification.eligible).toBe(false);
    expect(manifest.qualityOwner).toMatchObject({ id: null, signed: false });
    expect(qualifyWritingStyleCorpus(corpus, manifest)).toMatchObject({
      eligible: false,
      reasons: expect.arrayContaining(["human_annotation_pending", "quality_owner_signoff_pending"])
    });
    for (const sample of corpus.samples) {
      expect(sample.annotatorLabels.annotatorA.status).toBe("provisional");
      expect(sample.annotatorLabels.annotatorB.status).toBe("provisional");
      if (sample.fixedNegative) expect(sample.goldLabels).toEqual([]);
      expect(sample.text).not.toContain("用户项目");
      for (const label of sample.goldLabels) {
        expect(label.ruleId).not.toBe("guidanceOnly");
        expect(label.endOffset).toBeGreaterThan(label.startOffset);
      }
    }
  });

  test("fails closed on fewer than 200 samples or forged manifest versions", () => {
    const corpus = JSON.parse(corpusBytes) as Record<string, unknown>;
    const samples = [...(corpus.samples as unknown[])].slice(0, 199);
    expect(() => parseWritingStyleCorpus({ ...corpus, samples })).toThrow(
      "AI_WRITING_STYLE_CORPUS_INVALID"
    );
    const manifest = JSON.parse(manifestBytes) as Record<string, unknown>;
    expect(() => parseWritingStyleCorpusManifest({ ...manifest, matcherVersion: "other" })).toThrow(
      "AI_WRITING_STYLE_CORPUS_INVALID"
    );
  });

  test("computes qualification from frozen evaluator output rather than manifest claims", () => {
    const rawCorpus = JSON.parse(corpusBytes) as Record<string, unknown>;
    const reviewedCorpusBytes = jsonBytes({
      ...rawCorpus,
      annotationStatus: "human_qualified",
      samples: (rawCorpus.samples as Array<Record<string, unknown>>).map((sample) => ({
        ...sample,
        reviewStatus: "human_reviewed",
        annotatorLabels: {
          annotatorA: { status: "human_complete", labels: sample.goldLabels },
          annotatorB: { status: "human_complete", labels: sample.goldLabels }
        }
      }))
    });
    const reviewedCorpus = parseWritingStyleCorpus(JSON.parse(reviewedCorpusBytes));
    const rawManifest = JSON.parse(manifestBytes) as Record<string, unknown>;
    const preliminaryManifest = parseWritingStyleCorpusManifest({
      ...rawManifest,
      corpusSha256: sha256Utf8(reviewedCorpusBytes),
      qualification: {
        eligible: false,
        precisionNumerator: null,
        precisionDenominator: null,
        fixedNegativeFalsePositives: null,
        blockedBy: ["metrics pending"]
      },
      qualityOwner: { id: null, signed: false, decision: "pending_human_review" }
    });
    const computed = qualifyWritingStyleCorpus(reviewedCorpus, preliminaryManifest, {
      corpusBytes: reviewedCorpusBytes,
      rubricBytes
    });
    const qualifiedManifest = parseWritingStyleCorpusManifest({
      ...rawManifest,
      corpusSha256: sha256Utf8(reviewedCorpusBytes),
      qualification: {
        eligible: true,
        precisionNumerator: computed.precisionNumerator,
        precisionDenominator: computed.precisionDenominator,
        fixedNegativeFalsePositives: computed.fixedNegativeFalsePositives,
        blockedBy: []
      },
      qualityOwner: { id: "editorial-owner", signed: true, decision: "qualified" }
    });

    expect(
      qualifyWritingStyleCorpus(reviewedCorpus, qualifiedManifest, {
        corpusBytes: reviewedCorpusBytes,
        rubricBytes
      })
    ).toMatchObject({
      eligible: true,
      precisionNumerator: 41,
      precisionDenominator: 41,
      fixedNegativeFalsePositives: 0
    });

    const forgedMetrics = parseWritingStyleCorpusManifest({
      ...qualifiedManifest,
      qualification: { ...qualifiedManifest.qualification, precisionNumerator: 40 }
    });
    expect(
      qualifyWritingStyleCorpus(reviewedCorpus, forgedMetrics, {
        corpusBytes: reviewedCorpusBytes,
        rubricBytes
      }).reasons
    ).toContain("qualification_metrics_mismatch");

    const forgedEligibility = parseWritingStyleCorpusManifest({
      ...qualifiedManifest,
      qualification: { ...qualifiedManifest.qualification, eligible: false, blockedBy: ["forged"] }
    });
    expect(
      qualifyWritingStyleCorpus(reviewedCorpus, forgedEligibility, {
        corpusBytes: reviewedCorpusBytes,
        rubricBytes
      }).reasons
    ).toContain("manifest_eligibility_mismatch");
  });

  test("fails closed on missing artifact evidence, stale fixed-negative sets, and non-canonical labels", () => {
    const corpus = parseWritingStyleCorpus(JSON.parse(corpusBytes));
    const manifest = parseWritingStyleCorpusManifest(JSON.parse(manifestBytes));
    expect(verifyWritingStyleCorpusArtifact(corpus, manifest, undefined)).toMatchObject({
      verified: false,
      reasons: expect.arrayContaining(["corpus_checksum_unverified", "rubric_checksum_unverified"])
    });
    expect(
      verifyWritingStyleCorpusArtifact(corpus, manifest, { corpusBytes, rubricBytes })
    ).toEqual({ verified: true, reasons: [] });

    const staleNegativeSet = parseWritingStyleCorpusManifest({
      ...manifest,
      fixedNegativeSampleIds: [...manifest.fixedNegativeSampleIds].reverse()
    });
    expect(
      qualifyWritingStyleCorpus(corpus, staleNegativeSet, { corpusBytes, rubricBytes }).reasons
    ).toContain("fixed_negative_set_mismatch");

    const rawCorpus = JSON.parse(corpusBytes) as Record<string, unknown>;
    const samples = [...(rawCorpus.samples as Array<Record<string, unknown>>)];
    const unicodeSampleIndex = samples.findIndex((sample) => sample.sampleId === "ws2-011");
    const unicodeSample = samples[unicodeSampleIndex] as Record<string, unknown>;
    samples[unicodeSampleIndex] = {
      ...unicodeSample,
      goldLabels: [
        {
          ...(unicodeSample.goldLabels as Array<Record<string, unknown>>)[0],
          startOffset: 1
        }
      ]
    };
    expect(() => parseWritingStyleCorpus({ ...rawCorpus, samples })).toThrow(
      "AI_WRITING_STYLE_CORPUS_INVALID"
    );
    const duplicatedSample = samples.find((sample) => sample.sampleId === "ws2-002") as Record<
      string,
      unknown
    >;
    const duplicateLabels = duplicatedSample.goldLabels as Array<Record<string, unknown>>;
    expect(() =>
      parseWritingStyleCorpus({
        ...rawCorpus,
        samples: (rawCorpus.samples as Array<Record<string, unknown>>).map((sample) =>
          sample.sampleId === "ws2-002"
            ? { ...sample, goldLabels: [...duplicateLabels, duplicateLabels[0]] }
            : sample
        )
      })
    ).toThrow("AI_WRITING_STYLE_CORPUS_INVALID");
    expect(() =>
      parseWritingStyleCorpusManifest({
        ...manifest,
        qualityOwner: { id: null, signed: true, decision: "qualified" }
      })
    ).toThrow("AI_WRITING_STYLE_CORPUS_INVALID");
    expect(() =>
      parseWritingStyleCorpusManifest({
        ...manifest,
        qualification: {
          ...manifest.qualification,
          precisionNumerator: 1,
          precisionDenominator: null,
          fixedNegativeFalsePositives: null
        }
      })
    ).toThrow("AI_WRITING_STYLE_CORPUS_INVALID");
    expect(() =>
      parseWritingStyleCorpusManifest({
        ...manifest,
        qualification: {
          ...manifest.qualification,
          precisionNumerator: 2,
          precisionDenominator: 1,
          fixedNegativeFalsePositives: 0
        }
      })
    ).toThrow("AI_WRITING_STYLE_CORPUS_INVALID");
  });
});

function jsonBytes(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
