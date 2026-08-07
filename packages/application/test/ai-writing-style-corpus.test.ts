import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import {
  parseWritingStyleCorpus,
  parseWritingStyleCorpusManifest,
  qualifyWritingStyleCorpus,
  sha256Utf8
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
});
