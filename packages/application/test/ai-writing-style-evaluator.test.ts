import { describe, expect, test } from "vitest";

import {
  AI_WRITING_STYLE_RULE_VERSION,
  evaluateAiWritingStyle
} from "../src/ai-writing-style-evaluator.js";

describe("AI writing style evaluator", () => {
  test("uses one frozen version and separates introduced findings from pre-existing ones", () => {
    const baselineText = "他呼吸一滞，仍然没有回头。";
    const candidateText = `${baselineText}\n她指尖发紧，呼吸一滞。`;

    const evaluation = evaluateAiWritingStyle({ baselineText, candidateText });

    expect(evaluation.ruleVersion).toBe(AI_WRITING_STYLE_RULE_VERSION);
    expect(evaluation.enforcement).toBe("advisory");
    expect(evaluation.hitCount).toBe(2);
    expect(evaluation.hits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          matchedText: "呼吸一滞",
          changeKind: "pre_existing",
          confidence: "medium",
          defaultCollapsed: true
        }),
        expect.objectContaining({
          matchedText: "指尖发紧",
          changeKind: "introduced",
          confidence: "medium",
          defaultCollapsed: false
        }),
        expect.objectContaining({
          matchedText: "呼吸一滞",
          changeKind: "introduced",
          confidence: "medium",
          defaultCollapsed: false
        })
      ])
    );
  });

  test("keeps independent edits separate when the same phrase appears in both edits", () => {
    const evaluation = evaluateAiWritingStyle({
      baselineText: "他呼吸一滞。中间。",
      candidateText: "她指尖发紧。他呼吸一滞。中间。她呼吸一滞。"
    });

    expect(evaluation.hits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ matchedText: "指尖发紧", changeKind: "introduced" }),
        expect.objectContaining({ matchedText: "呼吸一滞", changeKind: "pre_existing" }),
        expect.objectContaining({ matchedText: "呼吸一滞", changeKind: "introduced" })
      ])
    );
    expect(evaluation.hitCount).toBe(2);
  });

  test("does not mark an unchanged finding introduced when text is deleted before it", () => {
    const evaluation = evaluateAiWritingStyle({
      baselineText: "他啊终于明白该离开了。",
      candidateText: "他终于明白该离开了。"
    });

    expect(evaluation.hits[0]).toMatchObject({
      matchedText: "终于明白",
      changeKind: "pre_existing"
    });
  });

  test("bounds large replacements and keeps the advisory result available", () => {
    const evaluation = evaluateAiWritingStyle({
      baselineText: "甲".repeat(600),
      candidateText: `${"乙".repeat(600)}她终于明白了。`
    });

    expect(evaluation).toMatchObject({ status: "attention", hitCount: 1 });
    expect(evaluation.hits[0]).toMatchObject({
      matchedText: "终于明白",
      changeKind: "introduced"
    });
  });

  test("keeps cold phrases guidance-only and promotes only repeated or clustered emotional cliches", () => {
    const coldPhraseOnly = evaluateAiWritingStyle({
      baselineText: "",
      candidateText: "她冷冷地把话压下去。"
    });
    const singlePhrase = evaluateAiWritingStyle({
      baselineText: "",
      candidateText: "他呼吸一滞，望向窗外。"
    });
    const cluster = evaluateAiWritingStyle({
      baselineText: "",
      candidateText: "他呼吸一滞，指尖发紧，心口一沉。"
    });

    expect(coldPhraseOnly).toMatchObject({ status: "clean", hitCount: 0, hits: [] });
    expect(singlePhrase).toMatchObject({ status: "clean", hitCount: 0 });
    expect(singlePhrase.hits[0]).toMatchObject({ confidence: "low", defaultCollapsed: true });
    expect(cluster).toMatchObject({ status: "attention", hitCount: 3 });
    expect(cluster.hits.every((hit) => hit.confidence === "medium")).toBe(true);
  });

  test("parses structural patterns per sentence and excludes quotations and factual correction", () => {
    const evaluation = evaluateAiWritingStyle({
      baselineText: "",
      candidateText:
        "“不是害怕，是失望。”她说。不是下午三点，是下午四点。她不是害怕，是终于明白自己想离开。她像雪一样落下，像刀锋一样贴近。"
    });

    expect(evaluation.hits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleId: "explanatory-contrast", matchedText: "不是害怕，是" }),
        expect.objectContaining({ ruleId: "stacked-simile" })
      ])
    );
    expect(evaluation.hits).toHaveLength(3);
    expect(evaluation.hits).toEqual(
      expect.arrayContaining([expect.objectContaining({ ruleId: "direct-realization" })])
    );
  });

  test("reports UTF-16 offsets, 1-based line/column, and grapheme-safe excerpts", () => {
    const candidateText = "😀\r\nA\u0301她终于明白该离开了。";
    const evaluation = evaluateAiWritingStyle({ baselineText: "", candidateText });
    const hit = evaluation.hits[0];

    expect(hit).toMatchObject({
      ruleId: "direct-realization",
      startOffset: 7,
      endOffset: 11,
      start: { offset: 7, line: 2, column: 4 },
      end: { offset: 11, line: 2, column: 8 }
    });
    expect(hit?.excerpt).toEqual({
      text: candidateText,
      startOffset: 0,
      endOffset: candidateText.length
    });
    expect(hit?.excerpt.text).toContain("A\u0301");
    expect(candidateText).toBe("😀\r\nA\u0301她终于明白该离开了。");
  });
});
