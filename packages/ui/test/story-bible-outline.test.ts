import { describe, expect, test } from "vitest";

import { readStoryBibleOutline, validateStoryBibleOutline } from "../src/story-bible-outline.js";

describe("Story Bible outline model", () => {
  test("keeps stored volume and chapter order while preserving unknown fields", () => {
    const model = readStoryBibleOutline({
      volumes: [
        {
          id: "vol_02",
          title: "第二卷",
          summary: "深入旧案。",
          chapterIds: ["ch_03", "ch_02"],
          futureVolumeField: { kept: true }
        },
        {
          id: "vol_01",
          title: "第一卷",
          chapterIds: ["ch_01"]
        }
      ],
      chapterOutlines: [
        {
          chapterId: "ch_03",
          goal: "取得证词",
          futureChapterField: ["kept"]
        }
      ]
    });

    expect(model.volumes.map((volume) => volume.id)).toEqual(["vol_02", "vol_01"]);
    expect(model.volumes[0]?.chapterIds).toEqual(["ch_03", "ch_02"]);
    expect(model.volumes[0]?.futureVolumeField).toEqual({ kept: true });
    expect(model.chapterOutlines[0]).toMatchObject({
      chapterId: "ch_03",
      goal: "取得证词",
      futureChapterField: ["kept"]
    });
  });

  test("reports duplicate assignments and every missing chapter reference deterministically", () => {
    const issues = validateStoryBibleOutline(
      {
        volumes: [
          { id: "vol_02", title: "第二卷", chapterIds: ["ch_02", "ch_missing"] },
          { id: "vol_01", title: "第一卷", chapterIds: ["ch_01", "ch_02"] }
        ],
        chapterOutlines: [
          { chapterId: "ch_missing", notes: "保留" },
          { chapterId: "ch_orphan", notes: "仍需处理" }
        ]
      },
      ["ch_01", "ch_02"]
    );

    expect(issues).toEqual([
      {
        code: "duplicate-chapter",
        chapterId: "ch_02",
        volumeIds: ["vol_02", "vol_01"]
      },
      { code: "missing-chapter", chapterId: "ch_missing" },
      { code: "missing-chapter", chapterId: "ch_orphan" }
    ]);
  });
});
