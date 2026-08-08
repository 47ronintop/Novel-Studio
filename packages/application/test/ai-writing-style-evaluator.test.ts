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

  test("keeps a moved equivalent finding pre-existing after unchanged findings consume their matches", () => {
    const evaluation = evaluateAiWritingStyle({
      baselineText: "甲终于明白该离开了。乙终于明白该留下来。",
      candidateText: "乙终于明白该留下来。甲终于明白该离开了。"
    });

    expect(evaluation.hits).toHaveLength(2);
    expect(evaluation.hits.every((hit) => hit.changeKind === "pre_existing")).toBe(true);
    expect(evaluation.hitCount).toBe(0);
  });

  test("does not let a newly-added duplicate consume an unchanged baseline equivalent", () => {
    const evaluation = evaluateAiWritingStyle({
      baselineText: "他终于明白该离开了。",
      candidateText: "他终于明白该离开了。她终于明白该留下来。"
    });

    expect(evaluation.hits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ changeKind: "pre_existing" }),
        expect.objectContaining({ changeKind: "introduced" })
      ])
    );
    expect(evaluation.hitCount).toBe(1);
  });

  test("deduplicates the same rule and span before qualification can count it twice", () => {
    const duplicatedPhrasePack = {
      packId: "duplicate-regression",
      language: "zh-CN" as const,
      title: "重复规则回归",
      rules: [
        {
          ruleId: "direct-realization" as const,
          title: "直白顿悟句",
          description: "测试重复规则输出。",
          promptInstruction: "测试。",
          severity: "notice" as const,
          suggestion: "测试。",
          phrases: ["终于明白", "终于明白"]
        }
      ]
    };
    const evaluation = evaluateAiWritingStyle({
      baselineText: "",
      candidateText: "她终于明白了。",
      rulePack: duplicatedPhrasePack
    });

    expect(evaluation.hits).toHaveLength(1);
    expect(evaluation.hitCount).toBe(1);
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
        "“不是害怕，是失望。”她说。「她像雪一样落下，像刀锋一样贴近。」她说。不是下午三点，是下午四点。她不是害怕，是终于明白自己想离开。她像雪一样落下，像刀锋一样贴近。"
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

  test("extends a stacked-simile span through the first grapheme after the second 像", () => {
    const candidateText = "她像雪一样落下，像👩🏽‍💻般沉默。";
    const evaluation = evaluateAiWritingStyle({ baselineText: "", candidateText });
    const hit = evaluation.hits.find((entry) => entry.ruleId === "stacked-simile");

    expect(hit).toMatchObject({
      startOffset: candidateText.indexOf("像"),
      endOffset: candidateText.indexOf("般"),
      matchedText: "像雪一样落下，像👩🏽‍💻"
    });
  });

  test("excludes generic phrase findings inside quoted dialogue", () => {
    const evaluation = evaluateAiWritingStyle({
      baselineText: "",
      candidateText:
        "“他呼吸一滞，终于意识到自己错了。”她说。「他终于明白了。」'她心口一沉。'旁白里，她终于明白该离开了。"
    });

    expect(evaluation.hits).toHaveLength(1);
    expect(evaluation.hits[0]).toMatchObject({
      ruleId: "direct-realization",
      matchedText: "终于明白"
    });
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
