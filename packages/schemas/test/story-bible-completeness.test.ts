import { describe, expect, test } from "vitest";
import { evaluateStoryBibleCompleteness } from "../src/index.js";

describe("Story Bible completeness evaluator", () => {
  test("marks a character with only a title as insufficient", () => {
    const report = evaluateStoryBibleCompleteness({
      type: "character",
      title: "林默",
      summary: "",
      details: {}
    });

    expect(report.status).toBe("insufficient");
    expect(report.required.missing).toBeGreaterThan(0);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/details/role", status: "missing" }),
        expect.objectContaining({ path: "/details/goals", status: "missing" })
      ])
    );
  });

  test("marks a character with substantive core and recommended fields complete", () => {
    const report = evaluateStoryBibleCompleteness({
      type: "character",
      title: "林默",
      summary: "一名在旧城中寻找失踪兄长的调查记者。",
      details: {
        role: "主角，调查记者",
        goals: ["找到失踪的兄长", "揭开旧城改造真相"],
        personality: "谨慎、执着，习惯先观察再行动。",
        voice: "语气克制，常用短句记录事实。",
        conflicts: ["对抗开发集团", "不愿面对家庭秘密"],
        arc: { start: "回避冲突", turningPoints: ["发现关键证据"], targetState: "主动承担责任" },
        limitations: ["缺乏正面战斗能力"]
      }
    });
    expect(report.status).toBe("complete");
    expect(report.score).toBe(100);
    expect(report.required.missing).toBe(0);
    expect(report.recommended.missing).toBe(0);
  });

  test("recognizes the structured character fields used by the editor", () => {
    const report = evaluateStoryBibleCompleteness({
      type: "character",
      title: "沈砚",
      summary: "负责守护旧港秘密的调查员。",
      details: {
        role: "旧港调查员",
        goals: { external: "找到失踪者", internal: "承认自己的责任" },
        personality: {
          traits: ["谨慎观察环境", "执着追查真相"],
          values: ["诚实且守信"],
          fears: [],
          desires: []
        },
        voice: {
          tone: "语气克制而简洁",
          vocabulary: ["倾向使用事实与短句"],
          catchphrases: [],
          forbiddenExpressions: []
        },
        conflicts: ["与开发集团对抗"],
        arc: { start: "回避", turningPoints: ["发现证据"], targetState: "承担责任" },
        limitations: ["不会正面战斗"]
      }
    });

    expect(report.status).toBe("complete");
    expect(report.required.missing).toBe(0);
    expect(report.recommended.missing).toBe(0);
  });

  test("accepts rule statement as an alternative to rule", () => {
    const report = evaluateStoryBibleCompleteness({
      type: "world.rule",
      title: "潮汐法则",
      summary: "潮汐法则规定了海门开启的代价与范围。",
      details: {
        statement: "每次开启海门都会交换一段记忆。",
        scope: "海门及其守门人"
      }
    });

    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "/details/rule|/details/statement",
          status: "present",
          suggestedAction: ""
        })
      ])
    );
    expect(report.required.missing).toBe(0);
  });

  test("uses the substantive rule alternative when both fields are present", () => {
    const report = evaluateStoryBibleCompleteness({
      type: "world.rule",
      title: "潮汐法则",
      summary: "潮汐法则。",
      details: {
        rule: "交换记忆。",
        statement: "每次开启海门都会交换一段记忆，并在月相变化时扩大代价。",
        scope: "海门及其守门人"
      }
    });

    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "/details/rule|/details/statement",
          status: "present",
          suggestedAction: ""
        })
      ])
    );
  });

  test("requires an actual payoff chapter for paid-off foreshadowing", () => {
    const report = evaluateStoryBibleCompleteness({
      type: "foreshadow",
      title: "旧钥匙的来源",
      summary: "旧钥匙的来历将在后续章节揭晓。",
      details: {
        trackingStatus: "paid-off",
        milestones: []
      }
    });

    expect(report.status).toBe("insufficient");
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/details/actualPayoffChapterId", status: "missing" })
      ])
    );
  });

  test("requires a payoff milestone for paid-off foreshadowing", () => {
    const report = evaluateStoryBibleCompleteness({
      type: "foreshadow",
      title: "旧钥匙的来源",
      summary: "旧钥匙的来历已经揭晓。",
      details: {
        trackingStatus: "paid-off",
        actualPayoffChapterId: "ch_12",
        milestones: [{ kind: "plan", chapterId: "ch_03" }]
      }
    });

    expect(report.status).toBe("insufficient");
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "/details/milestones[kind=payoff]",
          status: "missing"
        })
      ])
    );
  });

  test("does not mutate the input details", () => {
    const details = { role: "配角", goals: ["守护城门"] };
    const before = JSON.stringify(details);

    evaluateStoryBibleCompleteness({
      type: "character",
      title: "守门人",
      summary: "一名守护城门的配角。",
      details
    });

    expect(JSON.stringify(details)).toBe(before);
  });
});
