import { describe, expect, test } from "vitest";

import {
  appendStoryBibleTimelineEvent,
  createStoryBibleTimelineEvent,
  readStoryBibleTimeline,
  updateStoryBibleTimelineEvent,
  validateStoryBibleTimeline
} from "../src/story-bible-timeline.js";

describe("Story Bible timeline model", () => {
  test("sorts projected events while preserving stored fields", () => {
    const details = {
      futureTimelineField: { kept: true },
      events: [
        {
          id: "evt_second",
          title: "第二件事",
          sequence: 20,
          timeLabel: "第二日",
          summary: "继续调查。",
          chapterIds: ["ch_02"],
          characterIds: ["chr_hero"],
          locationIds: ["loc_archive"],
          causes: ["evt_first"],
          effects: [],
          futureEventField: ["kept"]
        },
        {
          id: "evt_first",
          title: "第一件事",
          sequence: 10,
          chapterIds: ["ch_01"]
        },
        { title: "缺少 ID 的旧数据", sequence: 30 }
      ]
    };

    const model = readStoryBibleTimeline(details);

    expect(model.events.map((event) => event.id)).toEqual(["evt_first", "evt_second"]);
    expect(model.events[0]).toMatchObject({
      timeLabel: "",
      characterIds: [],
      locationIds: [],
      causes: [],
      effects: []
    });
    expect(model.events[1]?.futureEventField).toEqual(["kept"]);
  });

  test("updates and appends events without dropping unknown data", () => {
    const details = {
      futureTimelineField: { kept: true },
      events: [
        {
          id: "evt_first",
          title: "第一件事",
          sequence: 1,
          futureEventField: { kept: true }
        },
        { title: "无 ID 数据保持原样" }
      ]
    };
    const updated = updateStoryBibleTimelineEvent(details, "evt_first", {
      title: "改名后的事件",
      timeLabel: "第一日"
    });
    const created = createStoryBibleTimelineEvent(
      readStoryBibleTimeline(updated).events,
      "0123456789abcdef0123456789abcdef"
    );
    const appended = appendStoryBibleTimelineEvent(updated, created);

    expect(updated).toMatchObject({
      futureTimelineField: { kept: true },
      events: [
        {
          id: "evt_first",
          title: "改名后的事件",
          timeLabel: "第一日",
          futureEventField: { kept: true }
        },
        { title: "无 ID 数据保持原样" }
      ]
    });
    expect(created).toMatchObject({
      id: "evt_0123456789abcdef0123456789abcdef",
      sequence: 2,
      title: "新事件"
    });
    expect((appended["events"] as Array<{ id?: string }>).at(-1)?.id).toBe(
      "evt_0123456789abcdef0123456789abcdef"
    );
  });

  test("reports duplicate IDs, invalid sequences, missing titles, and self references", () => {
    const issues = validateStoryBibleTimeline({
      events: [
        {
          id: "evt_repeat",
          title: "",
          sequence: 0,
          causes: ["evt_repeat"]
        },
        {
          id: "evt_repeat",
          title: "重复事件",
          sequence: 2,
          effects: []
        }
      ]
    });

    expect(issues).toEqual([
      { code: "duplicate-id", eventId: "evt_repeat" },
      { code: "missing-title", eventId: "evt_repeat" },
      { code: "invalid-sequence", eventId: "evt_repeat" },
      { code: "self-reference", eventId: "evt_repeat" }
    ]);
  });
});
