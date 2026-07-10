import { describe, expect, test } from "vitest";

import { calculateWritingMetrics } from "../src/editor-toolbar.js";

describe("editor metrics", () => {
  test("counts Chinese characters and English words as writing units", () => {
    const metrics = calculateWritingMetrics("她走进雨里。\nA quiet room waits.");

    expect(metrics.lineCount).toBe(2);
    expect(metrics.writingUnitCount).toBe(9);
    expect(metrics.readingTimeMinutes).toBe(1);
  });
});
