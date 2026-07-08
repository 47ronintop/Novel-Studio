import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { calculateWritingMetrics, EditorToolbar } from "../src/editor-toolbar.js";

describe("editor toolbar", () => {
  test("counts Chinese characters and English words as writing units", () => {
    const metrics = calculateWritingMetrics("她走进雨里。\nA quiet room waits.");

    expect(metrics.lineCount).toBe(2);
    expect(metrics.writingUnitCount).toBe(9);
    expect(metrics.readingTimeMinutes).toBe(1);
  });

  test("renders compact editor controls without preference selectors", () => {
    const html = renderToStaticMarkup(
      <EditorToolbar
        metrics={calculateWritingMetrics("她走进雨里。\nA quiet room waits.")}
        preferences={{
          fontFamily: "serif",
          fontSize: 16,
          lineHeight: 1.8
        }}
        findReplaceOpen={false}
        onFindReplaceToggle={() => undefined}
        onFocusModeToggle={() => undefined}
        onPreferencesChange={() => undefined}
      />
    );

    expect(html).toContain('aria-label="编辑器工具栏"');
    expect(html).toContain('aria-label="打开查找替换"');
    expect(html).toContain('aria-label="切换专注模式"');
    expect(html).not.toContain('aria-label="编辑器字体"');
    expect(html).not.toContain('aria-label="编辑器行高"');
    expect(html).not.toContain("<select");
  });
});
