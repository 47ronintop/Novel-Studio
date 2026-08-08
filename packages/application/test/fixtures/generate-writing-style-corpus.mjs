import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const directory = dirname(fileURLToPath(import.meta.url));
const corpusPath = join(directory, "writing-style-corpus.json");
const manifestPath = join(directory, "writing-style-corpus-manifest.json");
const rubricPath = join(directory, "writing-style-annotation-rubric.md");

const RULE_VERSION = "2.0";
const CORPUS_VERSION = "writing-style-corpus@2.0.0";
const RUBRIC_VERSION = "writing-style-rubric@2.0.0";

const patterns = [
  {
    category: "clean_narrative",
    fixedNegative: true,
    text: (n) => `第${n}盏灯在雨里亮着，她把伞沿往旁边让了让。`,
    labels: () => []
  },
  {
    category: "stacked_simile",
    fixedNegative: false,
    text: (n) => `第${n}阵风像薄刃一样掠过，像水一样漫进袖口。`,
    labels: (text) => [label(text, "stacked-simile", "像薄刃一样掠过，像水", "medium")]
  },
  {
    category: "explanatory_contrast",
    fixedNegative: false,
    text: (n) => `第${n}次沉默不是害怕，是她终于决定离开。`,
    labels: (text) => [label(text, "explanatory-contrast", "不是害怕，是", "medium")]
  },
  {
    category: "dialogue",
    fixedNegative: true,
    text: (n) => `“第${n}次我不是害怕，是不想再等。”她说。`,
    labels: () => []
  },
  {
    category: "quotation",
    fixedNegative: true,
    text: (n) => `档案写着：“第${n}号样本终于明白了流程。”`,
    labels: () => []
  },
  {
    category: "factual_correction",
    fixedNegative: true,
    text: (n) => `记录不是周三，是周四；第${n}页的日期已经改正。`,
    labels: () => []
  },
  {
    category: "non_emotional_pressure",
    fixedNegative: true,
    text: (n) => `她把第${n}卷胶片压下去，免得风把纸角卷起。`,
    labels: () => []
  },
  {
    category: "single_emotion",
    fixedNegative: false,
    text: (n) => `第${n}次电话响起时，他呼吸一滞，随后按下接听。`,
    labels: (text) => [label(text, "mechanical-emotion", "呼吸一滞", "low")]
  },
  {
    category: "clustered_emotion",
    fixedNegative: false,
    text: (n) => `第${n}封信落地，他呼吸一滞，指尖发紧，心口一沉。`,
    labels: (text) => [
      label(text, "mechanical-emotion", "呼吸一滞", "medium"),
      label(text, "mechanical-emotion", "指尖发紧", "medium"),
      label(text, "mechanical-emotion", "心口一沉", "medium")
    ]
  },
  {
    category: "direct_realization",
    fixedNegative: false,
    text: (n) => `走到第${n}级台阶，他终于明白门后没有人。`,
    labels: (text) => [label(text, "direct-realization", "终于明白", "medium")]
  },
  {
    category: "unicode_offsets",
    fixedNegative: false,
    text: (n) => `😀第${n}行\r\nÁ她终于意识到该回家了。`,
    labels: (text) => [label(text, "direct-realization", "终于意识到", "medium")]
  }
];

function label(text, ruleId, phrase, confidence) {
  const startOffset = text.indexOf(phrase);
  if (startOffset < 0) throw new Error(`Missing phrase ${phrase}`);
  return {
    ruleId,
    startOffset,
    endOffset: startOffset + phrase.length,
    confidence,
    rationale: `Synthetic candidate span for ${ruleId}.`
  };
}

function sampleFor(index) {
  const pattern = patterns[(index - 1) % patterns.length];
  const split = index <= 140 ? "development" : "qualification";
  const text = pattern.text(index);
  const labels = pattern.labels(text);
  return {
    sampleId: `ws2-${String(index).padStart(3, "0")}`,
    split,
    category: pattern.category,
    source: "synthetic_reproducible",
    text,
    fixedNegative: pattern.fixedNegative,
    reviewStatus: "pending_human_review",
    annotatorLabels: {
      annotatorA: { status: "provisional", labels },
      annotatorB: { status: "provisional", labels }
    },
    goldLabels: labels
  };
}

function buildCorpus() {
  return {
    schemaVersion: "1.0",
    corpusVersion: CORPUS_VERSION,
    ruleVersion: RULE_VERSION,
    sourcePolicy: "synthetic_only_no_user_project_text",
    annotationStatus: "provisional_pending_human_review",
    samples: Array.from({ length: 200 }, (_, index) => sampleFor(index + 1))
  };
}

function jsonBytes(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function buildArtifacts() {
  const corpus = buildCorpus();
  const corpusText = jsonBytes(corpus);
  const rubricText = await readFile(rubricPath, "utf8");
  const goldLabels = corpus.samples.map((sample) => ({
    sampleId: sample.sampleId,
    labels: sample.goldLabels
  }));
  const fixedNegativeSampleIds = corpus.samples
    .filter((sample) => sample.fixedNegative)
    .map((sample) => sample.sampleId);
  const manifest = {
    schemaVersion: "1.0",
    corpusVersion: CORPUS_VERSION,
    rubricVersion: RUBRIC_VERSION,
    ruleVersion: RULE_VERSION,
    matcherVersion: "utf16-span-v2",
    sampleCount: corpus.samples.length,
    splitCounts: {
      development: corpus.samples.filter((sample) => sample.split === "development").length,
      qualification: corpus.samples.filter((sample) => sample.split === "qualification").length
    },
    corpusSha256: sha256(corpusText),
    rubricSha256: sha256(rubricText),
    goldLabelsSha256: sha256(jsonBytes(goldLabels)),
    fixedNegativeSampleIds,
    qualification: {
      eligible: false,
      precisionNumerator: null,
      precisionDenominator: null,
      fixedNegativeFalsePositives: null,
      blockedBy: [
        "Two independent human annotations and a blind editorial quality-owner sign-off are pending."
      ]
    },
    qualityOwner: { id: null, signed: false, decision: "pending_human_review" }
  };
  return { corpusText, manifestText: jsonBytes(manifest) };
}

const artifacts = await buildArtifacts();
if (globalThis.process.argv.includes("--check")) {
  const [currentCorpus, currentManifest] = await Promise.all([
    readFile(corpusPath, "utf8"),
    readFile(manifestPath, "utf8")
  ]);
  if (currentCorpus !== artifacts.corpusText || currentManifest !== artifacts.manifestText) {
    throw new Error("WRITING_STYLE_CORPUS_NOT_REPRODUCIBLE");
  }
} else {
  await writeFile(corpusPath, artifacts.corpusText, "utf8");
  await writeFile(manifestPath, artifacts.manifestText, "utf8");
}
