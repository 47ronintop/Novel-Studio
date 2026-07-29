import { describe, expect, test } from "vitest";

import {
  STORY_BIBLE_FORESHADOW_STATUS_OPTIONS,
  isStoryBibleForeshadowOverdue,
  storyBibleForeshadowValidationMessage,
  validateStoryBibleForeshadow
} from "../src/story-bible-foreshadow.js";

describe("Story Bible foreshadow tracking", () => {
  test("exposes the fixed six-state workflow in author-facing order", () => {
    expect(STORY_BIBLE_FORESHADOW_STATUS_OPTIONS).toEqual([
      { value: "planned", label: "待埋" },
      { value: "planted", label: "已埋" },
      { value: "progressing", label: "推进中" },
      { value: "ready-to-payoff", label: "待回收" },
      { value: "paid-off", label: "已回收" },
      { value: "abandoned", label: "已放弃" }
    ]);
  });

  test("derives overdue only after the planned payoff chapter for active tracking states", () => {
    const chapters = [
      { id: "ch_03", order: 30 },
      { id: "ch_01", order: 10 },
      { id: "ch_02", order: 20 }
    ];

    expect(
      isStoryBibleForeshadowOverdue(
        { trackingStatus: "progressing", plannedPayoffChapterId: "ch_02" },
        chapters,
        "ch_03"
      )
    ).toBe(true);
    expect(
      isStoryBibleForeshadowOverdue(
        { trackingStatus: "progressing", plannedPayoffChapterId: "ch_02" },
        chapters,
        "ch_02"
      )
    ).toBe(false);
    expect(
      isStoryBibleForeshadowOverdue(
        { trackingStatus: "paid-off", plannedPayoffChapterId: "ch_01" },
        chapters,
        "ch_03"
      )
    ).toBe(false);
  });

  test("requires an actual payoff chapter and complete evidence before saving", () => {
    const issues = validateStoryBibleForeshadow(
      {
        id: "fsh_current",
        title: "旧钥匙",
        status: "active",
        details: {
          trackingStatus: "paid-off",
          actualPayoffChapterId: "",
          sourceRefs: [
            { chapterId: "", excerpt: "原文", excerptHash: "0".repeat(64) },
            { chapterId: "ch_01", excerpt: "  ", excerptHash: "0".repeat(64) }
          ]
        }
      },
      []
    );

    expect(issues.map((issue) => issue.code)).toEqual([
      "paid-off-missing-actual-chapter",
      "evidence-missing-chapter",
      "evidence-missing-excerpt"
    ]);
    expect(issues.map(storyBibleForeshadowValidationMessage)).toEqual([
      "状态设为“已回收”时，必须选择实际回收章节。",
      "第 1 条原文证据缺少章节。",
      "第 2 条原文证据缺少原文片段。"
    ]);
  });

  test("detects normalized duplicate evidence inside the draft and across non-deleted assets", () => {
    const issues = validateStoryBibleForeshadow(
      {
        id: "fsh_current",
        title: "旧钥匙",
        status: "active",
        details: {
          trackingStatus: "planted",
          sourceRefs: [
            {
              chapterId: "ch_01",
              excerpt: "  Cafe\u0301\r\n线索  ",
              excerptHash: "1".repeat(64)
            },
            {
              chapterId: "ch_01",
              excerpt: "Caf\u00e9\n线索",
              excerptHash: "2".repeat(64)
            },
            {
              chapterId: "ch_02",
              excerpt: "门后的脚步声",
              excerptHash: "3".repeat(64)
            }
          ]
        }
      },
      [
        {
          id: "fsh_other",
          title: "门后的人",
          status: "active",
          details: {
            trackingStatus: "progressing",
            sourceRefs: [
              {
                chapterId: "ch_02",
                excerpt: "门后的脚步声",
                excerptHash: "4".repeat(64)
              }
            ]
          }
        },
        {
          id: "fsh_deleted",
          title: "已删除伏笔",
          status: "deleted",
          details: {
            trackingStatus: "abandoned",
            sourceRefs: [
              {
                chapterId: "ch_01",
                excerpt: "Caf\u00e9\n线索",
                excerptHash: "5".repeat(64)
              }
            ]
          }
        }
      ]
    );

    expect(issues).toEqual([
      {
        code: "duplicate-evidence-in-draft",
        sourceIndex: 1,
        duplicateSourceIndex: 0,
        chapterId: "ch_01"
      },
      {
        code: "duplicate-evidence-in-asset",
        sourceIndex: 2,
        duplicateAssetId: "fsh_other",
        duplicateAssetTitle: "门后的人",
        chapterId: "ch_02"
      }
    ]);
  });

  test("does not enforce duplicate evidence when the current asset is deleted", () => {
    const issues = validateStoryBibleForeshadow(
      {
        title: "待删除伏笔",
        status: "deleted",
        details: {
          trackingStatus: "abandoned",
          sourceRefs: [
            { chapterId: "ch_01", excerpt: "重复片段", excerptHash: "1".repeat(64) },
            { chapterId: "ch_01", excerpt: "重复片段", excerptHash: "2".repeat(64) }
          ]
        }
      },
      [
        {
          id: "fsh_other",
          title: "其他伏笔",
          status: "active",
          details: {
            trackingStatus: "planted",
            sourceRefs: [{ chapterId: "ch_01", excerpt: "重复片段", excerptHash: "3".repeat(64) }]
          }
        }
      ]
    );

    expect(issues).toEqual([]);
  });
});
